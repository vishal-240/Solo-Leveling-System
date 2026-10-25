// P4 timer domain (spec 3.9, 3.13). Pure functions over a Payload with an injected clock; elapsed time is always
// reconstructed from stored timestamps, never from a running JavaScript timer.
import { BLOCK_MS, timedBlocks, timedXp } from '../engine/progression';
import type { Obj, Payload } from '../persist/backup';
import { levelFromXp, totalXpToReach } from '../engine/progression';
import { refreshProgressionCaches, newUlid } from '../quests/domain';
import { syncProgressionInPlace } from '../rewards/rewards';

export const GAP_THRESHOLD_MS = 10 * 60_000;
export const UNDO_WINDOW_MS = 2 * 60_000;
export const ONE_OFF_DAILY_XP_CAP = 300;
export type TimerErrorCode = 'NOT_FOUND' | 'NOT_OPEN' | 'NOT_TIMED' | 'NOT_STANDARD' | 'DAY_ENDED' | 'ONE_TIMER_ONLY' | 'ALREADY_RUNNING'
  | 'NOT_RUNNING' | 'NOT_PAUSED' | 'NO_SESSION' | 'GAP_PENDING' | 'NO_GAP' | 'INVALID_GAP_ANSWER' | 'CONFIRMATION_REQUIRED'
  | 'NOT_ENOUGH_TIME' | 'NOTHING_TO_BANK' | 'USE_COMPLETE' | 'NOT_BANKABLE' | 'ALREADY_COMPLETED' | 'UNDO_EXPIRED' | 'UNDO_USED'
  | 'UNDO_BLOCKED' | 'NOT_COMPLETED' | 'DUPLICATE_AWARD';
export class TimerError extends Error {
  constructor(public code: TimerErrorCode, message?: string, public gapMs?: number) { super(message ?? code); }
}
type R<T> = { payload: Payload; result: T };
const arr = (p: Payload, k: 'timerSessions' | 'occurrences' | 'xpTransactions'): Obj[] => p[k];
const fail = (c: TimerErrorCode, m?: string, gap?: number): never => { throw new TimerError(c, m, gap); };
const ms = (iso: unknown) => Date.parse(String(iso));
type Seg = { start: string; end?: string };

function getOcc(p: Payload, id: string): Obj { return arr(p, 'occurrences').find((o) => o.id === id) ?? fail('NOT_FOUND', `occurrence ${id}`); }
const snap = (o: Obj) => o.snapshot as { kind: string; targetBlocks?: number; category: string; potentialXp: number };
const sessionOf = (p: Payload, occId: string) => arr(p, 'timerSessions').find((s) => s.occurrenceId === occId);
const dayEnd = (o: Obj) => (o.dayEndsAt ? ms(o.dayEndsAt) : Infinity);
const effNow = (o: Obj, now: Date) => Math.min(now.getTime(), dayEnd(o));
const lastSeg = (s: Obj) => (s.segments as Seg[])[(s.segments as Seg[]).length - 1]!;

/** Active milliseconds at `now`, from timestamps only. Time after an unanswered >10 min gap is excluded. */
export function activeMsAt(s: Obj, o: Obj, now: Date): number {
  const base = Number(s.activeMs);
  if (s.status !== 'running') return base;
  const start = ms(lastSeg(s).start), hb = ms(s.lastHeartbeatAt), en = effNow(o, now);
  return base + Math.max(0, (en - hb > GAP_THRESHOLD_MS ? hb : en) - start);
}
/** Length of the unattended gap awaiting the honesty prompt (0 if none). */
export function pendingGapMs(s: Obj, o: Obj, now: Date): number {
  if (s.status !== 'running') return 0;
  const g = effNow(o, now) - ms(s.lastHeartbeatAt);
  return g > GAP_THRESHOLD_MS ? g : 0;
}
export interface TimerView { occurrenceId: string; status: string; activeMs: number; blocks: number; targetBlocks: number; pendingGapMs: number }
export function timerViews(p: Payload, now: Date): TimerView[] {
  return arr(p, 'timerSessions').filter((s) => s.status !== 'closed').flatMap((s) => {
    const o = arr(p, 'occurrences').find((x) => x.id === s.occurrenceId);
    if (!o || o.state !== 'OPEN') return [];
    const a = activeMsAt(s, o, now);
    return [{ occurrenceId: String(o.id), status: String(s.status), activeMs: a, blocks: timedBlocks(a), targetBlocks: Number(snap(o).targetBlocks ?? 0), pendingGapMs: pendingGapMs(s, o, now) }];
  });
}

/** Sessions whose day ended or whose occurrence is no longer open are closed using the same rule as activeMsAt():
 *  time counts up to the day end (never beyond) when the last heartbeat was within 10 minutes of it, otherwise only up to the
 *  last heartbeat (the unattended interval is not counted automatically). Closed sessions are skipped, so retries are idempotent. */
function settleOrphans(p: Payload, now: Date): void {
  for (const s of arr(p, 'timerSessions')) {
    if (s.status !== 'running') continue;
    const o = arr(p, 'occurrences').find((x) => x.id === s.occurrenceId);
    if (o && o.state === 'OPEN' && now.getTime() < dayEnd(o)) continue;
    const seg = lastSeg(s), hb = ms(s.lastHeartbeatAt);
    const en = o ? effNow(o, now) : hb;
    const end = Math.max(ms(seg.start), en - hb > GAP_THRESHOLD_MS ? hb : en);
    s.activeMs = Number(s.activeMs) + (end - ms(seg.start));
    seg.end = new Date(end).toISOString(); s.status = 'closed'; s.closedReason = 'day_ended';
  }
}
/** Settle orphaned sessions without any other change (used on app open and by tests). Idempotent. */
export function settleSessions(input: Payload, now: Date): Payload { const p = structuredClone(input); settleOrphans(p, now); return p; }
function openTimed(p: Payload, id: string, now: Date): Obj {
  const o = getOcc(p, id);
  if (snap(o).kind !== 'timed') fail('NOT_TIMED');
  if (o.state === 'COMPLETED') fail('ALREADY_COMPLETED');
  if (o.state !== 'OPEN') fail('NOT_OPEN');
  if (now.getTime() >= dayEnd(o)) fail('DAY_ENDED');
  return o;
}
const noGap = (s: Obj, o: Obj, now: Date) => { const g = pendingGapMs(s, o, now); if (g) fail('GAP_PENDING', 'Answer the gap prompt first', g); };
function settle(s: Obj, o: Obj, now: Date, status: 'paused' | 'closed') {
  const seg = lastSeg(s), en = Math.max(effNow(o, now), ms(seg.start));
  s.activeMs = Number(s.activeMs) + (en - ms(seg.start)); seg.end = new Date(en).toISOString(); s.status = status;
}

export function startTimer(input: Payload, occId: string, now: Date): R<string> {
  const p = structuredClone(input); settleOrphans(p, now);
  const o = openTimed(p, occId, now);
  if (arr(p, 'timerSessions').some((s) => s.status === 'running' && s.occurrenceId !== occId)) fail('ONE_TIMER_ONLY', 'Another timer is running');
  const s = sessionOf(p, occId);
  if (s?.status === 'running') fail('ALREADY_RUNNING');
  if (s) { s.status = 'running'; (s.segments as Seg[]).push({ start: now.toISOString() }); s.lastHeartbeatAt = now.toISOString(); return { payload: p, result: String(s.id) }; }
  const id = newUlid(now);
  arr(p, 'timerSessions').push({ id, occurrenceId: String(o.id), status: 'running', segments: [{ start: now.toISOString() }], activeMs: 0,
    lastHeartbeatAt: now.toISOString(), gapAdjustmentsMs: [] });
  return { payload: p, result: id };
}
const running = (p: Payload, occId: string) => sessionOf(p, occId) ?? fail('NO_SESSION');
export function heartbeat(input: Payload, occId: string, now: Date): R<void> {
  const p = structuredClone(input); const o = openTimed(p, occId, now), s = running(p, occId);
  if (s.status !== 'running') fail('NOT_RUNNING'); noGap(s, o, now);
  s.lastHeartbeatAt = new Date(Math.max(ms(s.lastHeartbeatAt), now.getTime())).toISOString(); return { payload: p, result: undefined };
}
export function pauseTimer(input: Payload, occId: string, now: Date): R<void> {
  const p = structuredClone(input); const o = openTimed(p, occId, now), s = running(p, occId);
  if (s.status !== 'running') fail('NOT_RUNNING'); noGap(s, o, now); settle(s, o, now, 'paused'); return { payload: p, result: undefined };
}
export const resumeTimer = (input: Payload, occId: string, now: Date): R<string> => {
  const p = structuredClone(input); openTimed(p, occId, now);
  if (running(p, occId).status !== 'paused') fail('NOT_PAUSED');
  return startTimer(p, occId, now);
};
/** Honesty prompt answer: `countedMs` of the gap (0..gap) is added; the session is then paused until the player resumes. */
export function resolveGap(input: Payload, occId: string, countedMs: number, now: Date): R<void> {
  const p = structuredClone(input); const o = openTimed(p, occId, now), s = running(p, occId);
  const gap = pendingGapMs(s, o, now);
  if (!gap) fail('NO_GAP');
  if (!Number.isFinite(countedMs) || countedMs < 0 || countedMs > gap) fail('INVALID_GAP_ANSWER', 'Counted time must be between 0 and the gap', gap);
  const seg = lastSeg(s), hb = ms(s.lastHeartbeatAt);
  s.activeMs = Number(s.activeMs) + Math.max(0, hb - ms(seg.start)) + Math.round(countedMs);
  seg.end = new Date(Math.max(hb, ms(seg.start))).toISOString(); (s.gapAdjustmentsMs as number[]).push(Math.round(countedMs)); s.status = 'paused';
  return { payload: p, result: undefined };
}

// ---- awards, completion, banking, undo ----
const countKind = (p: Payload, occId: string, kind: string) => arr(p, 'xpTransactions').filter((t) => t.occurrenceId === occId && t.scope === 'player' && t.kind === kind).length;
function writeLedger(p: Payload, o: Obj, kind: 'quest_award' | 'partial_bank', xp: number, now: Date) {
  if (xp <= 0) return;
  const key = kind === 'quest_award' ? `award:${o.id}:${countKind(p, String(o.id), 'reversal')}` : `bank:${o.id}`;
  for (const scope of ['player', snap(o).category]) {
    const idem = `${key}:${scope}`;
    if (arr(p, 'xpTransactions').some((t) => t.idempotencyKey === idem)) fail('DUPLICATE_AWARD');
    arr(p, 'xpTransactions').push({ id: newUlid(now), at: now.toISOString(), dayKey: o.dayKey, scope, kind, occurrenceId: o.id, requestedDelta: xp, appliedDelta: xp, idempotencyKey: idem });
  }
}
const oneOffRoom = (p: Payload, o: Obj) => o.source !== 'oneoff' ? Infinity : Math.max(0, ONE_OFF_DAILY_XP_CAP -
  arr(p, 'occurrences').filter((x) => x.source === 'oneoff' && x.dayKey === o.dayKey && x.id !== o.id).reduce((s, x) => s + Number(x.awardedXp ?? 0), 0));
function finish(p: Payload, o: Obj, xp: number, now: Date, state: 'COMPLETED' | 'PARTIAL', kind: 'quest_award' | 'partial_bank') {
  const paid = Math.min(xp, oneOffRoom(p, o));
  writeLedger(p, o, kind, paid, now);
  o.state = state; o.awardedXp = paid; if (state === 'COMPLETED') o.completedAt = now.toISOString(); else o.bankedAt = now.toISOString();
  refreshProgressionCaches(p); syncProgressionInPlace(p, now);
}
function sessionForCompletion(p: Payload, o: Obj, now: Date): { s: Obj; active: number } {
  const s = sessionOf(p, String(o.id)) ?? fail('NO_SESSION', 'Timed quests require the timer');
  if (s.status === 'running') { noGap(s, o, now); settle(s, o, now, 'paused'); }
  return { s, active: Number(s.activeMs) };
}
export function completeTimer(input: Payload, occId: string, confirmed: boolean, now: Date): R<number> {
  const p = structuredClone(input); settleOrphans(p, now); const o = openTimed(p, occId, now);
  if (confirmed !== true) fail('CONFIRMATION_REQUIRED');
  const { s, active } = sessionForCompletion(p, o, now);
  const target = Number(snap(o).targetBlocks), blocks = timedBlocks(active);
  if (blocks < target) fail('NOT_ENOUGH_TIME', `${blocks}/${target} blocks`);
  finish(p, o, o.source === 'penalty' ? 0 : timedXp(blocks, target), now, 'COMPLETED', 'quest_award'); s.status = 'closed'; s.closedReason = 'completed';
  return { payload: p, result: Number(o.awardedXp) };
}
export function bankPartial(input: Payload, occId: string, now: Date): R<number> {
  const p = structuredClone(input); settleOrphans(p, now); const o = openTimed(p, occId, now);
  if (o.source === 'penalty') fail('NOT_BANKABLE');
  const { s, active } = sessionForCompletion(p, o, now);
  const blocks = timedBlocks(active), target = Number(snap(o).targetBlocks);
  if (blocks >= target) fail('USE_COMPLETE'); if (blocks < 1) fail('NOTHING_TO_BANK');
  finish(p, o, timedXp(blocks, target), now, 'PARTIAL', 'partial_bank'); s.status = 'closed'; s.closedReason = 'banked';
  return { payload: p, result: Number(o.awardedXp) };
}
/** Non-timed quests: confirm-tap completion (same award path, same idempotency and undo rules). */
export function completeStandardQuest(input: Payload, occId: string, confirmed: boolean, now: Date): R<number> {
  const p = structuredClone(input); const o = getOcc(p, occId);
  if (snap(o).kind !== 'standard') fail('NOT_STANDARD');
  if (o.state === 'COMPLETED') fail('ALREADY_COMPLETED'); if (o.state !== 'OPEN') fail('NOT_OPEN');
  if (now.getTime() >= dayEnd(o)) fail('DAY_ENDED'); if (confirmed !== true) fail('CONFIRMATION_REQUIRED');
  finish(p, o, o.source === 'penalty' ? 0 : snap(o).potentialXp, now, 'COMPLETED', 'quest_award');
  return { payload: p, result: Number(o.awardedXp) };
}
/** Undo within 2 minutes via reversal entries (once per occurrence); the occurrence reopens and a timed session resumes as paused. */
export function undoCompletion(input: Payload, occId: string, now: Date): R<void> {
  const p = structuredClone(input); const o = getOcc(p, occId);
  if (o.state !== 'COMPLETED') fail('NOT_COMPLETED');
  if (now.getTime() - ms(o.completedAt) > UNDO_WINDOW_MS) fail('UNDO_EXPIRED');
  if (countKind(p, occId, 'reversal') >= 1) fail('UNDO_USED');
  const paid = Number(o.awardedXp ?? 0);
  // UNDO POLICY (conservative, documented in docs/IMPLEMENTATION_NOTES.md): the general rule allows undo for 2 minutes, but
  // the frozen invariant says levels and ranks never decrease (3.7). When reversing would drop the player below the start of
  // the current level, the invariant wins and the undo is refused (UNDO_BLOCKED) even inside the window. Level events and
  // rewards therefore always match the ledger and cannot be farmed by undo/re-complete. Only an explicit spec decision
  // (for example a reversible level-up) could change this.
  if (paid > 0) {
    const total = arr(p, 'xpTransactions').filter((t) => t.scope === 'player').reduce((a, t) => a + Number(t.appliedDelta), 0);
    if (total - paid < totalXpToReach(levelFromXp(total))) fail('UNDO_BLOCKED', 'Undo would remove a level that was already reached');
  }
  if (paid > 0) for (const scope of ['player', snap(o).category]) {
    const total = arr(p, 'xpTransactions').filter((t) => t.scope === scope).reduce((a, t) => a + Number(t.appliedDelta), 0);
    const applied = Math.min(paid, Math.max(0, total));
    arr(p, 'xpTransactions').push({ id: newUlid(now), at: now.toISOString(), dayKey: o.dayKey, scope, kind: 'reversal', occurrenceId: o.id,
      requestedDelta: -paid, appliedDelta: -applied, idempotencyKey: `reverse:${o.id}:${scope}` });
  }
  o.state = 'OPEN'; delete o.completedAt; o.awardedXp = 0;
  const s = sessionOf(p, occId); if (s && s.status === 'closed') { s.status = 'paused'; delete s.closedReason; }
  refreshProgressionCaches(p); syncProgressionInPlace(p, now); return { payload: p, result: undefined };
}
export const BLOCK_MINUTES = BLOCK_MS / 60_000;
