// P8 read models. Everything is derived from persisted records (ledger, occurrences, day records, events); nothing is inferred or invented.
// All dates are game-day keys (YYYY-MM-DD) computed with the configured reset time and timezone, never raw midnights.
import { attrLevelFromXp } from '../engine/progression';
import type { Obj, Payload } from '../persist/backup';
import { gameDayKeyForSettings, type SettingsLike } from '../quests/calendar';
import { itemName } from '../app/selectors';
import { ACHIEVEMENTS, ATTRS } from '../rewards/rewards';

// ---- day-key arithmetic (pure calendar maths on keys) ----
export const dayNum = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86_400_000;
export const keyOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
export const addDays = (k: string, d: number) => keyOf(dayNum(k) + d);
export const weekdayOf = (k: string) => (((dayNum(k) + 4) % 7) + 7) % 7; // 0 = Sunday
export const monthOf = (k: string) => k.slice(0, 7);
export const shiftMonth = (m: string, by: number) => { const t = +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1) + by; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const weekStartKey = (k: string, weekStart: number) => addDays(k, -((weekdayOf(k) - weekStart + 7) % 7));
export const weekStartOf = (p: Payload) => { const w = Number(p.settings.weekStart); return Number.isInteger(w) && w >= 0 && w <= 6 ? w : 1; };
export const todayOf = (p: Payload, now: Date) => gameDayKeyForSettings(now, p.settings as SettingsLike);
export const dayKeyOfInstant = (p: Payload, iso: string) => gameDayKeyForSettings(new Date(iso), p.settings as SettingsLike);

/** Month grid: weeks of 7 cells, null outside the month. */
export function monthGrid(month: string, weekStart: number): (string | null)[][] {
  const first = `${month}-01`, count = dayNum(`${shiftMonth(month, 1)}-01`) - dayNum(first), lead = (weekdayOf(first) - weekStart + 7) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const formatInstant = (iso: string, tz: string) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); } catch { return iso; } };

// ---- per-day summaries ----
export type DayStatus = 'clear' | 'mixed' | 'missed' | 'rest' | 'empty' | 'exempt' | 'in-progress' | 'nodata';
export const STATUS_LABEL: Record<DayStatus, string> = { clear: 'All quests completed', mixed: 'Some completed, some missed', missed: 'Quests missed', rest: 'Protected rest day', empty: 'No quests scheduled', exempt: 'Quests exempt or skipped', 'in-progress': 'In progress', nodata: 'No data' };
export const STATUS_GLYPH: Record<DayStatus, string> = { clear: '✓', mixed: '±', missed: '✗', rest: 'R', empty: '·', exempt: '–', 'in-progress': '…', nodata: '' };
export interface DaySummary { dayKey: string; status: DayStatus; processed: boolean; completed: number; missed: number; partial: number; lapsed: number; skipped: number; exempt: number; open: number;
  xpEarned: number; xpDeducted: number; xpNet: number; xpForfeited: number; penaltyQuests: number }
const EARN = new Set(['quest_award', 'partial_bank', 'reversal']);
const num = (v: unknown) => Number(v) || 0;
export interface HistoryIndex { days: Map<string, DaySummary>; first: string | null; today: string }
export function indexHistory(p: Payload, today: string): HistoryIndex {
  const days = new Map<string, DaySummary>(); const records = new Map(p.dayRecords.map((d) => [String(d.id), d]));
  const blank = (k: string): DaySummary => ({ dayKey: k, status: 'nodata', processed: records.has(k), completed: 0, missed: 0, partial: 0, lapsed: 0, skipped: 0, exempt: 0, open: 0, xpEarned: 0, xpDeducted: 0, xpNet: 0, xpForfeited: num(((records.get(k)?.summary ?? {}) as Obj).xpForfeited), penaltyQuests: 0 });
  const get = (k: string) => { let s = days.get(k); if (!s) { s = blank(k); days.set(k, s); } return s; };
  for (const k of records.keys()) get(k);
  for (const o of p.occurrences) {
    const s = get(String(o.dayKey));
    if (o.source === 'penalty') { s.penaltyQuests++; continue; }
    const st = String(o.state); if (st === 'COMPLETED') s.completed++; else if (st === 'MISSED') s.missed++; else if (st === 'PARTIAL') s.partial++; else if (st === 'LAPSED') s.lapsed++; else if (st === 'SKIPPED') s.skipped++; else if (st === 'EXEMPT') s.exempt++; else s.open++;
  }
  for (const t of p.xpTransactions) if (t.scope === 'player') {
    const s = get(String(t.dayKey)), a = num(t.appliedDelta);
    if (EARN.has(String(t.kind))) s.xpEarned += a; else if (t.kind === 'penalty_deduction') s.xpDeducted += -a;
  }
  for (const s of days.values()) {
    s.xpNet = s.xpEarned - s.xpDeducted; const restDay = ((records.get(s.dayKey)?.summary ?? {}) as Obj).restDay === true; const bad = s.missed + s.partial + s.lapsed;
    s.status = restDay ? 'rest' : s.open > 0 && !s.processed ? 'in-progress' : s.open > 0 ? 'in-progress' : s.completed > 0 && bad === 0 ? 'clear' : s.completed > 0 ? 'mixed' : bad > 0 ? 'missed'
      : s.exempt + s.skipped > 0 ? 'exempt' : s.processed || s.xpEarned || s.xpDeducted ? 'empty' : 'nodata';
    if (s.dayKey > today) s.status = 'nodata'; // future days are never reported as anything
  }
  const keys = [...days.entries()].filter(([, s]) => s.status !== 'nodata').map(([k]) => k).sort();
  return { days, first: keys[0] ?? null, today };
}
export const summaryFor = (idx: HistoryIndex, k: string): DaySummary => idx.days.get(k) ?? { dayKey: k, status: 'nodata', processed: false, completed: 0, missed: 0, partial: 0, lapsed: 0, skipped: 0, exempt: 0, open: 0, xpEarned: 0, xpDeducted: 0, xpNet: 0, xpForfeited: 0, penaltyQuests: 0 };

// ---- charts ----
export interface Bucket { key: string; label: string; earned: number; deducted: number; net: number; forfeited: number }
/** XP per week/month over the whole history (empty buckets filled with zero). Bucket nets always sum to the ledger's player XP total. */
export function xpBuckets(p: Payload, idx: HistoryIndex, unit: 'week' | 'month'): { buckets: Bucket[]; total: number } {
  const keyFor = (d: string) => (unit === 'week' ? weekStartKey(d, weekStartOf(p)) : monthOf(d));
  const map = new Map<string, Bucket>(); const ensure = (k: string): Bucket => { let b = map.get(k); if (!b) { b = { key: k, label: unit === 'week' ? `Week of ${k}` : k, earned: 0, deducted: 0, net: 0, forfeited: 0 }; map.set(k, b); } return b; };
  for (const s of idx.days.values()) { if (s.status === 'nodata' && !s.xpEarned && !s.xpDeducted) continue; const b = ensure(keyFor(s.dayKey)); b.earned += s.xpEarned; b.deducted += s.xpDeducted; b.net += s.xpNet; b.forfeited += s.xpForfeited; }
  if (map.size === 0) return { buckets: [], total: 0 };
  const keys = [...map.keys()].sort(); const out: Bucket[] = []; const end = keyFor(idx.today);
  for (let k = keys[0]!; k <= end; k = unit === 'week' ? addDays(k, 7) : shiftMonth(k, 1)) out.push(map.get(k) ?? ensure(k));
  for (const k of keys) if (k > end) out.push(map.get(k)!); // defensive: never drop ledger data
  out.sort((a, b) => a.key.localeCompare(b.key));
  return { buckets: out, total: out.reduce((s, b) => s + b.net, 0) };
}
export interface AttrBreakdown { id: string; net: number; earned: number; deducted: number; level: number; share: number | null }
export function attributeBreakdown(p: Payload): AttrBreakdown[] {
  const rows = ATTRS.map((id) => { const tx = p.xpTransactions.filter((t) => t.scope === id); const earned = tx.filter((t) => EARN.has(String(t.kind))).reduce((s, t) => s + num(t.appliedDelta), 0);
    const deducted = -tx.filter((t) => t.kind === 'penalty_deduction').reduce((s, t) => s + num(t.appliedDelta), 0); const net = earned - deducted; return { id, net, earned, deducted, level: attrLevelFromXp(Math.max(0, net)) }; });
  const sum = rows.reduce((s, r) => s + Math.max(0, r.net), 0);
  return rows.map((r) => ({ ...r, share: sum > 0 ? Math.max(0, r.net) / sum : null }));
}
export interface CompletionStats { label: string; completed: number; missed: number; partial: number; lapsed: number; excluded: number; denominator: number; rate: number | null; days: number }
/** Denominator = scheduled non-penalty quests on PROCESSED days in the window that ended as completed, missed, partial or lapsed. Exempt, skipped, open and future quests are excluded. */
export function completionStats(p: Payload, today: string): CompletionStats[] {
  const processed = new Set(p.dayRecords.map((d) => String(d.id)));
  return ([['Last 7 days', 7], ['Last 30 days', 30], ['All time', null]] as const).map(([label, n]) => {
    const inWin = (k: string) => processed.has(k) && k <= today && (n === null || dayNum(k) > dayNum(today) - n);
    const c = { completed: 0, missed: 0, partial: 0, lapsed: 0, excluded: 0 };
    for (const o of p.occurrences) { if (o.source === 'penalty' || !inWin(String(o.dayKey))) continue; const st = String(o.state);
      if (o.source === 'rest') { if (st === 'COMPLETED') c.completed++; else c.excluded++; continue; } // the rest-day affordance never counts against you
      if (st === 'COMPLETED') c.completed++; else if (st === 'MISSED') c.missed++; else if (st === 'PARTIAL') c.partial++; else if (st === 'LAPSED') c.lapsed++; else c.excluded++; }
    const denominator = c.completed + c.missed + c.partial + c.lapsed;
    return { label, ...c, denominator, rate: denominator ? c.completed / denominator : null, days: [...processed].filter(inWin).length };
  });
}

// ---- XP ledger view ----
export interface LedgerRow { id: string; at: string; dayKey: string; scope: string; kind: string; requested: number; applied: number; clamped: boolean; quest: string }
export const KIND_LABEL: Record<string, string> = { quest_award: 'Quest award', partial_bank: 'Partial bank', reversal: 'Reversal (undo)', penalty_deduction: 'Penalty deduction' };
export function ledgerRows(p: Payload, f: { scope?: string; kind?: string; dayKey?: string } = {}): LedgerRow[] {
  const title = new Map(p.occurrences.map((o) => [String(o.id), String((o.snapshot as Obj | undefined)?.title ?? '')]));
  return p.xpTransactions.filter((t) => (!f.scope || t.scope === f.scope) && (!f.kind || t.kind === f.kind) && (!f.dayKey || t.dayKey === f.dayKey))
    .map((t, i) => ({ i, row: { id: String(t.id), at: String(t.at), dayKey: String(t.dayKey), scope: String(t.scope), kind: String(t.kind), requested: num(t.requestedDelta), applied: num(t.appliedDelta),
      clamped: num(t.appliedDelta) !== num(t.requestedDelta), quest: title.get(String(t.occurrenceId)) ?? '' } }))
    .sort((a, b) => b.row.at.localeCompare(a.row.at) || b.i - a.i).map((x) => x.row);
}

// ---- System log ----
export type LogCategory = 'Progression' | 'Rewards' | 'Penalties' | 'Notifications';
export const LOG_CATEGORIES: LogCategory[] = ['Progression', 'Rewards', 'Penalties', 'Notifications'];
export interface LogEntry { id: string; at: string; dayKey: string; category: LogCategory; title: string; detail: string }
/** One entry per persisted record. Level and rank events come from their own records, so the redundant LEVEL UP / RANK PROMOTION notifications are not listed twice. */
export function systemLog(p: Payload, f: { category?: LogCategory; dayKey?: string } = {}): LogEntry[] {
  const out: (LogEntry & { seq: number })[] = []; let seq = 0;
  const add = (e: Omit<LogEntry, 'dayKey'> & { dayKey?: string }) => out.push({ ...e, dayKey: e.dayKey ?? dayKeyOfInstant(p, e.at), seq: seq++ });
  for (const e of p.levelEvents) add({ id: `level:${e.id}`, at: String(e.at), category: 'Progression', title: 'LEVEL UP', detail: `Level ${e.level}` });
  for (const e of p.rankEvents) add({ id: `rank:${e.id}`, at: String(e.at), category: 'Progression', title: 'RANK PROMOTION', detail: `Rank ${e.rank} at level ${e.level}` });
  for (const g of p.rewardGrants) { const k = String(g.kind); const detail = k === 'attributePoints' ? `+${g.amount} attribute point${g.amount === 1 ? '' : 's'}` : k === 'streakShield' ? '+1 Streak Shield' : k === 'statPoints' ? `+${g.amount} ${g.itemId} stat point${g.amount === 1 ? '' : 's'}` : itemName(String(g.itemId ?? k));
    add({ id: `grant:${g.id}`, at: String(g.at), category: 'Rewards', title: k === 'statPoints' ? 'POINTS ALLOCATED' : 'REWARD', detail }); }
  const title = new Map(p.occurrences.map((o) => [String(o.id), String((o.snapshot as Obj | undefined)?.title ?? '')]));
  for (const t of p.xpTransactions) if (t.scope === 'player' && t.kind === 'penalty_deduction') { const req = -num(t.requestedDelta), app = -num(t.appliedDelta); // attribute mirrors are the same deduction, listed once
    add({ id: `deduction:${t.id}`, at: String(t.at), dayKey: String(t.dayKey), category: 'Penalties', title: 'XP DEDUCTED', detail: `${app} XP deducted${title.get(String(t.occurrenceId)) ? ` for missing "${title.get(String(t.occurrenceId))}"` : ''}${app !== req ? ` (${req} requested, limited by the level floor)` : ''}` }); }
  for (const e of p.penaltyEvents) { const o = p.occurrences.find((x) => x.id === e.occurrenceId);
    add({ id: `penalty:${e.id}`, at: String(p.dayRecords.find((d) => d.id === e.dayKey)?.processedAt ?? `${e.dayKey}T12:00:00.000Z`), dayKey: String(e.dayKey), category: 'Penalties', title: 'PENALTY QUEST TRIGGERED', detail: `${String(e.trigger).replace(/_/g, ' ')}${o ? ` ("${(o.snapshot as Obj).title}")` : ''}` }); }
  for (const m of p.systemMessages) if (m.kind !== 'LEVEL UP' && m.kind !== 'RANK PROMOTION') add({ id: `msg:${m.id}`, at: String(m.at), dayKey: m.dayKey ? String(m.dayKey) : undefined, category: 'Notifications', title: String(m.kind), detail: String(m.text) });
  return out.filter((e) => (!f.category || e.category === f.category) && (!f.dayKey || e.dayKey === f.dayKey)).sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq).map(({ seq: _s, ...e }) => e);
}

// ---- achievements gallery ----
export interface GalleryItem { id: string; name: string; hidden: boolean; unlocked: boolean; unlockedAt?: string; progress: number; target: number }
export function achievementGallery(p: Payload): GalleryItem[] {
  const rows = new Map(p.achievements.map((a) => [String(a.id), a]));
  return ACHIEVEMENTS.map((d) => { const r = rows.get(d.id); return { id: d.id, name: d.name, hidden: d.hidden, unlocked: !!r?.unlockedAt, unlockedAt: r?.unlockedAt ? String(r.unlockedAt) : undefined, progress: Math.min(num(r?.progress), d.target), target: d.target }; });
}
