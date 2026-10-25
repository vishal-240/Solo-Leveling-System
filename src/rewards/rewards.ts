// P5: level/rank events, reward grants, attribute-point allocation, titles/badges, achievements (spec 3.3-3.6, 3.10).
// Everything is derived from the XP ledger and is idempotent: every event/grant has a deterministic id, so re-running
// syncProgression (after reloads, retries, re-completions) never grants anything twice.
import { RANKS, attrLevelFromXp, grantShield, levelFromXp, rankForLevel, rewardsForLevel, totalXpToReach, type Rank } from '../engine/progression';
import type { Obj, Payload } from '../persist/backup';

export const ATTRS = ['academics', 'fitness', 'coding', 'discipline', 'recovery'] as const;
export type AllocationMode = 'manual' | 'balanced' | 'momentum';
export const RANK_TITLES: Record<string, string> = { D: 'Initiate', C: 'Vanguard', B: 'Sentinel', A: 'Paragon', S: 'Sovereign' };
const DROP_KINDS = ['frame', 'accent', 'effect', 'bar'] as const;
const MOMENTUM_WINDOW_MS = 14 * 86_400_000;
const RESPEC_INTERVAL_MS = 7 * 86_400_000;

/** Attribute titles at attribute levels 10, 25 and 50 (spec 3.4). They grant no points and change no XP. */
export const ATTRIBUTE_TITLE_LEVELS = [10, 25, 50] as const;
export const ATTRIBUTE_TITLE_NAMES: Record<string, [string, string, string]> = {
  academics: ['Scholar', 'Savant', 'Sage'], fitness: ['Conditioned', 'Peak Form', 'Apex Body'], coding: ['Builder', 'Architect', 'Systems Master'],
  discipline: ['Steadfast', 'Ironbound', 'Unbreakable'], recovery: ['Restored', 'Resilient', 'Renewed'],
};
export class RewardError extends Error { constructor(public code: string, message?: string) { super(message ?? code); } }
const rows = (p: Payload, k: 'levelEvents' | 'rankEvents' | 'rewardGrants' | 'attributes' | 'xpTransactions' | 'systemMessages' | 'achievements' | 'streaks' | 'dayRecords' | 'occurrences' | 'timerSessions' | 'penaltyEvents'): Obj[] => p[k];
const ids = (p: Payload, k: Parameters<typeof rows>[1]) => new Set(rows(p, k).map((r) => r.id));
const playerXp = (p: Payload) => rows(p, 'xpTransactions').filter((t) => t.scope === 'player').reduce((s, t) => s + Number(t.appliedDelta), 0);
const iso = (d: Date) => d.toISOString();

function dropKind(level: number): (typeof DROP_KINDS)[number] {
  let idx = 0;
  for (let l = 5; l < level; l += 5) if (rewardsForLevel(l).cosmeticDrop) idx++;
  return DROP_KINDS[idx % DROP_KINDS.length]!;
}
export interface PlannedGrant { source: 'level' | 'rank'; kind: string; itemId?: string; amount?: number }
/** The full reward list for one level (3.6): one AP value, at most one shield, one title/badge, cosmetics, Level Mark. */
export function grantsForLevel(L: number): PlannedGrant[] {
  const r = rewardsForLevel(L), rank = rankForLevel(L);
  const g: PlannedGrant[] = [{ source: 'level', kind: 'levelMark', itemId: `levelmark:${L}` }, { source: 'level', kind: 'attributePoints', amount: r.attributePoints }];
  if (r.streakShield) g.push({ source: 'level', kind: 'streakShield', amount: 1 });
  if (r.rankPromotion) g.push({ source: 'rank', kind: 'title', itemId: `title:rank-${rank}` }, { source: 'rank', kind: 'cosmetic', itemId: `frame:rank-${rank}` },
    { source: 'rank', kind: 'cosmetic', itemId: `theme:rank-${rank}` }, ...(rank === 'S' ? [{ source: 'rank' as const, kind: 'cosmetic', itemId: 'theme:shadow-sovereign' }] : []));
  else if (r.titleOrBadge) g.push({ source: 'level', kind: 'badge', itemId: `badge:level-${L}` });
  if (r.cosmeticDrop) g.push({ source: 'level', kind: 'cosmetic', itemId: `cosmetic:${dropKind(L)}:${L}` });
  return g;
}

// ---- attribute-point allocation ----
const statOf = (a: Obj) => Number(a.statPoints ?? 0);
function momentumXp(p: Payload, attr: string, now: Date): number {
  return rows(p, 'xpTransactions').filter((t) => t.scope === attr && ['quest_award', 'partial_bank', 'reversal'].includes(String(t.kind)) && Date.parse(String(t.at)) >= now.getTime() - MOMENTUM_WINDOW_MS)
    .reduce((s, t) => s + Number(t.appliedDelta), 0);
}
function pickAttribute(p: Payload, mode: Exclude<AllocationMode, 'manual'>, now: Date): Obj {
  const attrs = ATTRS.map((id) => rows(p, 'attributes').find((a) => a.id === id)).filter((a): a is Obj => !!a);
  const order = (a: Obj) => ATTRS.indexOf(a.id as (typeof ATTRS)[number]);
  const balanced = (list: Obj[]) => [...list].sort((a, b) => statOf(a) - statOf(b) || Number(a.level) - Number(b.level) || order(a) - order(b))[0]!;
  if (mode === 'balanced') return balanced(attrs);
  const best = Math.max(...attrs.map((a) => momentumXp(p, String(a.id), now)));
  return balanced(attrs.filter((a) => momentumXp(p, String(a.id), now) === best)); // ties fall back to Balanced
}
function pushGrant(p: Payload, g: Obj): boolean {
  if (rows(p, 'rewardGrants').some((x) => x.id === g.id)) return false;
  rows(p, 'rewardGrants').push(g); return true;
}
function autoAllocate(p: Payload, points: number, mode: Exclude<AllocationMode, 'manual'>, now: Date, tag: string) {
  const added = new Map<string, number>();
  for (let i = 0; i < points; i++) { const a = pickAttribute(p, mode, now); a.statPoints = statOf(a) + 1; added.set(String(a.id), (added.get(String(a.id)) ?? 0) + 1); }
  for (const [attr, n] of added) pushGrant(p, { id: `alloc:${tag}:${attr}`, source: { type: 'level', ref: tag }, kind: 'statPoints', itemId: attr, amount: n, at: iso(now) });
}
const mode = (p: Payload): AllocationMode => (['balanced', 'momentum'].includes(String(p.player.allocationMode)) ? p.player.allocationMode : 'manual') as AllocationMode;

function message(p: Payload, id: string, kind: string, text: string, now: Date) {
  if (!rows(p, 'systemMessages').some((m) => m.id === id)) rows(p, 'systemMessages').push({ id, at: iso(now), kind, text, read: false });
}

// ---- achievements (catalogue is an implementation choice: the spec requires visible and hidden achievements without listing them) ----
const completed = (p: Payload) => rows(p, 'occurrences').filter((o) => o.state === 'COMPLETED' && o.source !== 'penalty').length;
const minAttr = (p: Payload) => Math.min(...ATTRS.map((id) => Number(rows(p, 'attributes').find((a) => a.id === id)?.level ?? 0)));
const dailyLongest = (p: Payload) => Number(rows(p, 'streaks').find((s) => s.scope === 'daily')?.longest ?? 0);
const clear = (r: Obj, minDone = 1) => { const s = (r.summary ?? {}) as Obj; return Number(s.missed) === 0 && Number(s.completed) >= minDone; };
function clearRun(p: Payload, minDone: number): number {
  let best = 0, run = 0, prev = '';
  for (const r of [...rows(p, 'dayRecords')].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    run = clear(r, minDone) && (!prev || Date.parse(`${r.id}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`) === 86_400_000 || run === 0) ? run + 1 : clear(r, minDone) ? 1 : 0;
    best = Math.max(best, run); prev = String(r.id);
  }
  return best;
}
const hours = (p: Payload) => rows(p, 'timerSessions').reduce((s, t) => s + Number(t.activeMs), 0) / 3_600_000;
export interface AchievementDef { id: string; name: string; hidden: boolean; target: number; value: (p: Payload) => number }
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_quest', name: 'First Quest', hidden: false, target: 1, value: completed },
  { id: 'first_level_up', name: 'First Level Up', hidden: false, target: 2, value: (p) => levelFromXp(playerXp(p)) },
  { id: 'streak_7', name: '7-Day Streak', hidden: false, target: 7, value: dailyLongest },
  { id: 'streak_30', name: '30-Day Streak', hidden: false, target: 30, value: dailyLongest },
  { id: 'streak_100', name: '100-Day Streak', hidden: false, target: 100, value: dailyLongest },
  { id: 'quests_100', name: '100 Quests', hidden: false, target: 100, value: completed },
  { id: 'quests_500', name: '500 Quests', hidden: false, target: 500, value: completed },
  { id: 'quests_1000', name: '1,000 Quests', hidden: false, target: 1000, value: completed },
  { id: 'timed_50h', name: '50 Hours Focused', hidden: false, target: 50, value: hours },
  { id: 'timed_100h', name: '100 Hours Focused', hidden: false, target: 100, value: hours },
  { id: 'rank_d', name: 'Rank D', hidden: false, target: 1, value: (p) => (rows(p, 'rankEvents').some((r) => r.rank === 'D') ? 1 : 0) },
  { id: 'attributes_10', name: 'Well Rounded', hidden: false, target: 10, value: minAttr },
  { id: 'full_clear', name: 'Full Clear', hidden: false, target: 1, value: (p) => rows(p, 'dayRecords').filter((r) => clear(r)).length },
  { id: 'full_clear_7', name: 'Seven Clear Days', hidden: false, target: 7, value: (p) => clearRun(p, 1) },
  { id: 'rest_respected', name: 'Rest Respected', hidden: false, target: 1, value: (p) => rows(p, 'dayRecords').filter((r) => ((r.summary ?? {}) as Obj).restDay === true).length },
  { id: 'backup_created', name: 'Backup Created', hidden: false, target: 1, value: (p) => (p.meta.lastExportAt ? 1 : 0) },
  { id: 'penalty_cleared', name: 'Penalty Cleared', hidden: true, target: 1, value: (p) => rows(p, 'occurrences').filter((o) => o.source === 'penalty' && o.state === 'COMPLETED').length },
  { id: 'balanced_hunter', name: 'Balanced Hunter', hidden: true, target: 20, value: minAttr },
  { id: 'untouched', name: 'Untouched', hidden: true, target: 1, value: (p) => (rows(p, 'rankEvents').some((r) => r.rank === 'C') && rows(p, 'penaltyEvents').length === 0 ? 1 : 0) },
  { id: 'perfect_week', name: 'Perfect Week', hidden: true, target: 7, value: (p) => clearRun(p, 3) },
  { id: 'all_attributes_max', name: 'Complete Mastery', hidden: true, target: 50, value: minAttr },
];
function updateAchievements(p: Payload, now: Date) {
  for (const d of ACHIEVEMENTS) {
    const v = d.value(p); let row = rows(p, 'achievements').find((a) => a.id === d.id);
    if (!row) { row = { id: d.id, progress: 0 }; rows(p, 'achievements').push(row); }
    row.progress = Math.max(Number(row.progress), Math.min(v, d.target));
    if (!row.unlockedAt && v >= d.target) { row.unlockedAt = iso(now); message(p, `msg:ach:${d.id}`, 'ACHIEVEMENT UNLOCKED', `ACHIEVEMENT UNLOCKED: ${d.hidden ? '' : ''}${d.name}`, now); }
  }
}

/** Idempotent reconciler (in place): level events, rank events and all level rewards for every level reached, plus achievements. */
export function syncProgressionInPlace(p: Payload, now: Date): void {
  const level = levelFromXp(Math.max(0, playerXp(p))), have = ids(p, 'levelEvents'), haveRank = ids(p, 'rankEvents');
  for (let L = 2; L <= level; L++) {
    if (have.has(`level:${L}`)) continue;
    rows(p, 'levelEvents').push({ id: `level:${L}`, level: L, at: iso(now), totalXp: totalXpToReach(L) });
    message(p, `msg:level:${L}`, 'LEVEL UP', `LEVEL UP: ${L}`, now);
    const r = rewardsForLevel(L);
    if (r.rankPromotion) {
      const rank = rankForLevel(L);
      if (!haveRank.has(`rank:${rank}`)) rows(p, 'rankEvents').push({ id: `rank:${rank}`, rank, level: L, at: iso(now) });
      message(p, `msg:rank:${rank}`, 'RANK PROMOTION', `RANK PROMOTION: ${rank}`, now);
    }
    for (const g of grantsForLevel(L)) {
      const id = `grant:${g.source}:${L}:${g.kind}:${g.itemId ?? ''}`;
      if (!pushGrant(p, { id, source: { type: g.source, ref: L }, kind: g.kind, ...(g.itemId ? { itemId: g.itemId } : {}), ...(g.amount !== undefined ? { amount: g.amount } : {}), at: iso(now) })) continue;
      if (g.kind === 'streakShield') {
        const s = grantShield({ held: Number(p.player.streakShields ?? 0), queued: Number(p.player.queuedShields ?? 0) }); // D17
        p.player.streakShields = s.held; p.player.queuedShields = s.queued;
      } else if (g.kind === 'attributePoints') {
        const m = mode(p);
        if (m === 'manual') p.player.unspentPoints = Number(p.player.unspentPoints ?? 0) + Number(g.amount);
        else autoAllocate(p, Number(g.amount), m, now, `L${L}`);
      }
    }
  }
  syncAttributeTitles(p, now);
  updateAchievements(p, now);
}
/** Idempotent: one title grant and one System message per attribute threshold reached, however many are crossed at once.
 *  Grants are never revoked when later undos or deductions lower current progress (the spec requires no revocation). */
function syncAttributeTitles(p: Payload, now: Date) {
  for (const attr of ATTRS) {
    const xp = Math.max(0, rows(p, 'xpTransactions').filter((t) => t.scope === attr).reduce((s, t) => s + Number(t.appliedDelta), 0));
    const level = attrLevelFromXp(xp);
    ATTRIBUTE_TITLE_LEVELS.forEach((T, i) => {
      if (level < T) return;
      pushGrant(p, { id: `grant:attribute:${attr}:${T}:title`, source: { type: 'level', ref: `attribute:${attr}:${T}` }, kind: 'title', itemId: `title:attr-${attr}-${T}`, at: iso(now) });
      message(p, `msg:attr:${attr}:${T}`, 'ATTRIBUTE LEVEL UP', `ATTRIBUTE LEVEL ${T}: ${attr.toUpperCase()}. TITLE EARNED: ${ATTRIBUTE_TITLE_NAMES[attr]![i]}`, now);
    });
  }
}
export function syncProgression(input: Payload, now: Date): Payload { const p = structuredClone(input); syncProgressionInPlace(p, now); return p; }

// ---- player actions ----
export function setAllocationMode(input: Payload, m: AllocationMode): Payload { const p = structuredClone(input); p.player.allocationMode = m; return p; }
/** Manual allocation of banked points to one attribute. */
export function allocatePoints(input: Payload, attr: string, n: number, now: Date): Payload {
  const p = structuredClone(input), a = rows(p, 'attributes').find((x) => x.id === attr);
  if (!a) throw new RewardError('UNKNOWN_ATTRIBUTE');
  if (!Number.isInteger(n) || n < 1) throw new RewardError('INVALID_AMOUNT');
  if (Number(p.player.unspentPoints ?? 0) < n) throw new RewardError('NOT_ENOUGH_POINTS');
  p.player.unspentPoints = Number(p.player.unspentPoints) - n; a.statPoints = statOf(a) + n;
  const seq = Number(p.meta.allocSeq ?? 0) + 1; p.meta.allocSeq = seq;
  pushGrant(p, { id: `alloc:manual:${seq}`, source: { type: 'level', ref: 'manual' }, kind: 'statPoints', itemId: attr, amount: n, at: iso(now) });
  return p;
}
/** Distribute all banked points automatically ("on request", 3.5). */
export function distributeBanked(input: Payload, m: Exclude<AllocationMode, 'manual'>, now: Date): Payload {
  const p = structuredClone(input), n = Number(p.player.unspentPoints ?? 0);
  if (n > 0) { const seq = Number(p.meta.allocSeq ?? 0) + 1; p.meta.allocSeq = seq; autoAllocate(p, n, m, now, `bank${seq}`); p.player.unspentPoints = 0; }
  return p;
}
/** Respec once per 7 days: all stat points return to the bank. */
export function respec(input: Payload, now: Date): Payload {
  const p = structuredClone(input), last = Date.parse(String(p.meta.lastRespecAt ?? ''));
  if (Number.isFinite(last) && now.getTime() - last < RESPEC_INTERVAL_MS) throw new RewardError('RESPEC_TOO_SOON');
  let back = 0; for (const a of rows(p, 'attributes')) { back += statOf(a); a.statPoints = 0; }
  p.player.unspentPoints = Number(p.player.unspentPoints ?? 0) + back; p.meta.lastRespecAt = iso(now); return p;
}
export const ownedItems = (p: Payload, kind: 'title' | 'badge' | 'cosmetic') => rows(p, 'rewardGrants').filter((g) => g.kind === kind).map((g) => String(g.itemId));
export function equipTitle(input: Payload, itemId: string): Payload {
  const p = structuredClone(input);
  if (!ownedItems(p, 'title').includes(itemId) && !ownedItems(p, 'badge').includes(itemId)) throw new RewardError('NOT_OWNED');
  p.player.equippedTitleId = itemId; return p;
}
export function equipFrame(input: Payload, itemId: string): Payload {
  const p = structuredClone(input);
  if (!ownedItems(p, 'cosmetic').includes(itemId) || !itemId.startsWith('frame:')) throw new RewardError('NOT_OWNED');
  p.player.equippedFrameId = itemId; return p;
}
export const RANK_LIST: readonly Rank[] = RANKS.map((r) => r.rank);
