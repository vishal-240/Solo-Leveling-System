// P9 event playback model. Cinematics are driven by newly committed progression events (level, rank, achievement records), never by the current level.
// Playback state is a set of acknowledged event ids stored in `meta.seenEvents` (so reloads and restores never replay old events).
import { itemName } from '../app/selectors';
import type { Obj, Payload } from '../persist/backup';
import { ACHIEVEMENTS, RANK_TITLES } from '../rewards/rewards';

export type Tier = 'full' | 'reduced' | 'minimal';
export const effectiveTier = (settings: Obj, prefersReduced: boolean): Tier => { const t = settings.effects === 'reduced' || settings.effects === 'minimal' ? settings.effects : 'full'; return t === 'full' && prefersReduced ? 'reduced' : (t as Tier); };
export const allEventIds = (p: Payload): string[] => [...p.levelEvents.map((e) => String(e.id)), ...p.rankEvents.map((e) => String(e.id)), ...p.achievements.filter((a) => a.unlockedAt).map((a) => `ach:${a.id}`)];
/** `null` means playback was never initialised for this data: everything that already exists is history and is acknowledged silently. */
export const seenSet = (p: Payload): Set<string> | null => (Array.isArray(p.meta.seenEvents) ? new Set((p.meta.seenEvents as unknown[]).map(String)) : null);
export const pendingIds = (p: Payload): string[] => { const seen = seenSet(p); return seen ? allEventIds(p).filter((id) => !seen.has(id)) : []; };
export const needsBaseline = (p: Payload) => Object.keys(p.meta).length > 0 && seenSet(p) === null;

export interface Step { kind: 'level' | 'rank'; levels: number[]; rank?: string; rankName?: string; rewards: string[]; ids: string[] }
export interface Note { id: string; title: string; text: string }
const rewardLines = (p: Payload, levels: number[]): string[] => {
  const set = new Set(levels); const grants = p.rewardGrants.filter((g) => set.has(Number((g.source as Obj | undefined)?.ref)) && ['level', 'rank'].includes(String((g.source as Obj).type)));
  const ap = grants.filter((g) => g.kind === 'attributePoints').reduce((s, g) => s + Number(g.amount ?? 0), 0), sh = grants.filter((g) => g.kind === 'streakShield').length;
  return [...(ap ? [`+${ap} attribute point${ap === 1 ? '' : 's'}`] : []), ...(sh ? [`+${sh} Streak Shield${sh === 1 ? '' : 's'}`] : []),
    ...grants.filter((g) => ['title', 'badge', 'cosmetic'].includes(String(g.kind))).map((g) => itemName(String(g.itemId)))];
};
/** Deterministic order: ascending level; a rank promotion is its own step, preceded by one batched level-up step for the ordinary levels before it. */
export function buildSteps(p: Payload, ids: string[]): { steps: Step[]; notes: Note[] } {
  const want = new Set(ids), levels = p.levelEvents.filter((e) => want.has(String(e.id))).map((e) => Number(e.level)).sort((a, b) => a - b);
  const ranks = new Map(p.rankEvents.filter((e) => want.has(String(e.id))).map((e) => [Number(e.level), e]));
  const steps: Step[] = []; let batch: number[] = [];
  const flush = () => { if (batch.length) { steps.push({ kind: 'level', levels: batch, rewards: rewardLines(p, batch), ids: batch.map((l) => `level:${l}`) }); batch = []; } };
  for (const L of levels) {
    const r = ranks.get(L); if (!r) { batch.push(L); continue; } flush();
    steps.push({ kind: 'rank', levels: [L], rank: String(r.rank), rankName: RANK_TITLES[String(r.rank)], rewards: rewardLines(p, [L]), ids: [`level:${L}`, String(r.id)] });
  }
  flush();
  const notes = ids.filter((i) => i.startsWith('ach:')).sort().map((i) => ({ id: i, title: 'ACHIEVEMENT UNLOCKED', text: ACHIEVEMENTS.find((a) => a.id === i.slice(4))?.name ?? i.slice(4) }));
  return { steps, notes };
}
export const stepTitle = (s: Step) => (s.kind === 'rank' ? 'RANK PROMOTION' : 'LEVEL UP');
export const stepText = (s: Step) => s.kind === 'rank' ? `Rank ${s.rank}${s.rankName ? `: ${s.rankName}` : ''} (level ${s.levels[0]})` : s.levels.length === 1 ? `Level ${s.levels[0]}` : `Levels ${s.levels[0]} to ${s.levels[s.levels.length - 1]} (${s.levels.length} levels)`;
