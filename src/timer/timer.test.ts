import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { validatePayload, type Obj, type Payload } from '../persist/backup';
import { SlsDb, loadPayload, replaceAll } from '../persist/store';
import { closeDayPayload, createRegisteredPayload } from '../quests/dayClose';
import { createOneOff, createTemplate, generateOccurrencesForDay, type QuestDefinition } from '../quests/domain';
import * as T from './timer';
import * as RT from './runtime';
import { COMPLETE_CONFIRM_TEXT, SELF_REPORT_NOTICE, gapPrompt } from './text';

const T0 = Date.UTC(2026, 9, 20, 10, 0, 0); // game day 2026-10-20 (UTC, reset 04:00) ends 2026-10-21T04:00Z
const at = (m: number) => new Date(T0 + m * 60_000);
const timed = (over: Partial<QuestDefinition> = {}): QuestDefinition => ({ title: 'Deep work', category: 'coding', kind: 'timed', targetBlocks: 4,
  mandatory: true, important: false, schedule: { type: 'daily' }, ...over });
function setup(defs: QuestDefinition[] = [timed()]) {
  let p = createRegisteredPayload('V', 'UTC', '04:00');
  for (const d of defs) p = createTemplate(p, d, '2026-10-20', at(0)).payload;
  p = generateOccurrencesForDay(p, '2026-10-20', at(0)).payload;
  return { p, ids: p.occurrences.map((o) => String(o.id)) };
}
const run = (p: Payload, id: string, from: number, to: number) => { for (let m = from + 8; m <= to; m += 8) p = T.heartbeat(p, id, at(m)).payload; return p; };
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as T.TimerError).code; } return 'no-error'; };
const seedBase = (p: Payload, amount = 50): Payload => { const q = structuredClone(p); // prior XP so a 100 XP award does not cross a level
  for (const scope of ['player', 'coding']) q.xpTransactions.push({ id: `seed-${scope}`, at: '2026-10-01T00:00:00Z', dayKey: '2026-10-01', scope, kind: 'quest_award', requestedDelta: amount, appliedDelta: amount, idempotencyKey: `seed:${scope}` });
  return q; };
const xp = (p: Payload, scope: string) => p.xpTransactions.filter((t) => t.scope === scope).reduce((s, t) => s + Number(t.appliedDelta), 0);
const valid = (p: Payload) => expect(validatePayload(p).errors).toEqual([]);

describe('elapsed time, boundaries and pause/resume (fake clock)', () => {
  it('derives blocks from timestamps; partial blocks earn nothing', () => {
    const { p, ids } = setup(); const id = ids[0]!;
    expect(p.occurrences[0]!.dayEndsAt).toBeDefined();
    let q = T.startTimer(p, id, at(0)).payload; q = run(q, id, 0, 32); // heartbeats every 8 min
    const blocks = (m: number) => T.timerViews(q, at(m))[0]!.blocks;
    expect([blocks(14), blocks(15), blocks(29), blocks(30)]).toEqual([0, 1, 1, 2]);
    const early = run(T.startTimer(p, id, at(0)).payload, id, 0, 8);
    expect(code(() => T.bankPartial(early, id, at(14)))).toBe('NOTHING_TO_BANK');
  });
  it('pause/resume accumulates only active time', () => {
    const { p, ids } = setup(); const id = ids[0]!;
    let q = T.startTimer(p, id, at(0)).payload; q = T.heartbeat(q, id, at(8)).payload;
    q = T.pauseTimer(q, id, at(16)).payload;
    expect(T.timerViews(q, at(300))[0]!.activeMs).toBe(16 * 60_000); // an hour-plus pause counts nothing
    q = T.resumeTimer(q, id, at(76)).payload; q = T.heartbeat(q, id, at(80)).payload; q = T.pauseTimer(q, id, at(90)).payload;
    expect(T.timerViews(q, at(95))[0]).toMatchObject({ activeMs: 30 * 60_000, blocks: 2, status: 'paused' });
    valid(q);
  });
  it('only one timer may run at a time; paused timers do not block', () => {
    const { p, ids } = setup([timed(), timed({ title: 'Other' })]);
    let q = T.startTimer(p, ids[0]!, at(0)).payload;
    expect(code(() => T.startTimer(q, ids[1]!, at(1)))).toBe('ONE_TIMER_ONLY');
    expect(code(() => T.startTimer(q, ids[0]!, at(1)))).toBe('ALREADY_RUNNING');
    q = T.pauseTimer(q, ids[0]!, at(2)).payload;
    expect(code(() => T.startTimer(q, ids[1]!, at(3)))).toBe('no-error');
  });
  it('a session crossing the daily reset stops counting at the reset instant', () => {
    const { p, ids } = setup(); const id = ids[0]!, start = Date.UTC(2026, 9, 21, 3, 20);
    let q = T.startTimer(p, id, new Date(start)).payload;
    for (const m of [9, 18, 27, 36]) q = T.heartbeat(q, id, new Date(start + m * 60_000)).payload;
    expect(T.timerViews(q, new Date(Date.UTC(2026, 9, 21, 4, 30)))[0]!.activeMs).toBe(40 * 60_000);
    expect(code(() => T.completeTimer(q, id, true, new Date(Date.UTC(2026, 9, 21, 4, 5))))).toBe('DAY_ENDED');
  });
});
describe('settlement of sessions left running past the daily reset', () => {
  const END = Date.UTC(2026, 9, 21, 4, 0), at2 = (h: number, m: number, ms = 0) => new Date(Date.UTC(2026, 9, 21, h, m, 0, ms));
  const ticks = (p: Payload, id: string, start: Date, every: number, until: Date) => {
    for (let t = start.getTime() + every; t <= until.getTime(); t += every) p = T.heartbeat(p, id, new Date(t)).payload; return p;
  };
  const ses = (p: Payload) => p.timerSessions[0]!;
  const settled = (start: Date, every: number, lastHb: Date, settleAt = at2(4, 30)) => {
    const { p, ids } = setup(); let q = T.startTimer(p, ids[0]!, start).payload; q = ticks(q, ids[0]!, start, every, lastHb);
    return { before: q, after: T.settleSessions(q, settleAt) };
  };
  it('last heartbeat 5 minutes before the reset: time through the reset is preserved, nothing after it', () => {
    const { after } = settled(at2(2, 59), 8 * 60_000, at2(3, 55)); // heartbeats at 03:07 ... 03:55
    expect(ses(after)).toMatchObject({ status: 'closed', closedReason: 'day_ended', activeMs: 61 * 60_000 });
    expect(Date.parse(String((ses(after).segments as { end: string }[])[0]!.end))).toBe(END);
  });
  it('last heartbeat more than 10 minutes before the reset: the unattended interval is not counted', () => {
    const { after } = settled(at2(2, 0), 8 * 60_000, at2(3, 44)); // last heartbeat 03:44, 16 minutes before the reset
    expect(ses(after).activeMs).toBe(104 * 60_000);
  });
  it('the 10-minute boundary: exactly 10 counts to the reset, 1 ms more does not', () => {
    expect(ses(settled(at2(3, 0), 10 * 60_000, at2(3, 50)).after).activeMs).toBe(60 * 60_000);
    expect(ses(settled(at2(2, 59, 999), 10 * 60_000, at2(3, 49, 999)).after).activeMs).toBe(50 * 60_000);
  });
  it('retrying settlement (any number of times, any later time) never double counts', () => {
    const { after } = settled(at2(2, 59), 8 * 60_000, at2(3, 55));
    const again = T.settleSessions(T.settleSessions(after, at2(4, 31)), at2(9, 0));
    expect(again).toEqual(after);
    expect(ses(again).activeMs).toBe(61 * 60_000);
  });
  it('does nothing before the reset while the occurrence is still open; preserves time already accumulated', () => {
    const { p, ids } = setup(); const id = ids[0]!;
    let q = T.startTimer(p, id, at2(1, 0)).payload; q = T.heartbeat(q, id, at2(1, 8)).payload; q = T.pauseTimer(q, id, at2(1, 16)).payload;
    q = T.resumeTimer(q, id, at2(3, 0)).payload; q = ticks(q, id, at2(3, 0), 8 * 60_000, at2(3, 56));
    expect(T.settleSessions(q, at2(3, 59))).toEqual(q);
    expect(ses(T.settleSessions(q, at2(4, 10))).activeMs).toBe(16 * 60_000 + 60 * 60_000); // 16 min before the pause + 03:00-04:00
  });
  it('settled data stays valid, can be persisted, and blocks a stale completion', async () => {
    const { after, before } = settled(at2(2, 59), 8 * 60_000, at2(3, 55)); const id = String(ses(before).occurrenceId);
    expect(validatePayload(after).errors).toEqual([]);
    expect((() => { try { T.completeTimer(after, id, true, at2(4, 31)); } catch (e) { return (e as T.TimerError).code; } return 'no-error'; })()).toBe('DAY_ENDED');
    const db = new SlsDb(`settle-${Math.random()}`); await db.open(); await replaceAll(db, before);
    await RT.settleSessionsDb(db, at2(4, 30)); await RT.settleSessionsDb(db, at2(4, 31));
    expect((await loadPayload(db)).timerSessions[0]).toMatchObject({ status: 'closed', activeMs: 61 * 60_000 });
  });
});
describe('gap over 10 minutes and the honesty prompt', () => {
  it('exactly 10 minutes is fine; one millisecond more demands an answer', () => {
    const { p, ids } = setup(); const id = ids[0]!; const q = T.startTimer(p, id, at(0)).payload;
    expect(code(() => T.heartbeat(q, id, at(10)))).toBe('no-error');
    const late = new Date(at(10).getTime() + 1);
    expect(code(() => T.heartbeat(q, id, late))).toBe('GAP_PENDING');
    for (const f of [() => T.pauseTimer(q, id, late), () => T.completeTimer(q, id, true, late), () => T.bankPartial(q, id, late)])
      expect(code(f)).toBe('GAP_PENDING');
    expect(T.timerViews(q, late)[0]!.pendingGapMs).toBeGreaterThan(10 * 60_000);
  });
  it('defaults to counting nothing; the player may count part of the gap, never more', () => {
    const { p, ids } = setup(); const id = ids[0]!; let q = T.startTimer(p, id, at(0)).payload; q = T.heartbeat(q, id, at(8)).payload;
    const now = at(30), gap = T.timerViews(q, now)[0]!.pendingGapMs;
    expect(gap).toBe(22 * 60_000);
    expect(T.timerViews(q, now)[0]!.activeMs).toBe(8 * 60_000);
    expect(code(() => T.resolveGap(q, id, gap + 1, now))).toBe('INVALID_GAP_ANSWER');
    expect(code(() => T.resolveGap(q, id, -1, now))).toBe('INVALID_GAP_ANSWER');
    const zero = T.resolveGap(q, id, 0, now).payload, some = T.resolveGap(q, id, 5 * 60_000, now).payload;
    expect(T.timerViews(zero, now)[0]).toMatchObject({ activeMs: 8 * 60_000, status: 'paused', pendingGapMs: 0 });
    expect(T.timerViews(some, now)[0]!.activeMs).toBe(13 * 60_000);
    expect(code(() => T.resolveGap(zero, id, 0, now))).toBe('NO_GAP');
    valid(some);
  });
  it('gap prompt and notices never claim verification', () => {
    expect(gapPrompt(22 * 60_000)).toMatch(/Self-reported/);
    expect(SELF_REPORT_NOTICE).toMatch(/cannot verify/);
    const ui = ['src/timer/text.ts', 'src/main.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(ui).not.toMatch(/\b(verified|verifies|proof of|validated by the timer)\b/i);
    expect(COMPLETE_CONFIRM_TEXT).toMatch(/I performed this activity/);
  });
});
describe('completion, banking, double submission, undo (ledger invariants)', () => {
  const full = () => { const { p, ids } = setup(); const id = ids[0]!; let q = T.startTimer(p, id, at(0)).payload; q = run(q, id, 0, 60); return { q, id }; };
  it('requires confirmation and enough full blocks; then awards target XP once', () => {
    const { q, id } = full();
    expect(code(() => T.completeTimer(q, id, false, at(60)))).toBe('CONFIRMATION_REQUIRED');
    const early = setup().p; const eid = early.occurrences[0]!.id as string;
    expect(code(() => T.completeTimer(run(T.startTimer(early, eid, at(0)).payload, eid, 0, 40), eid, true, at(44)))).toBe('NOT_ENOUGH_TIME');
    const done = T.completeTimer(q, id, true, at(60));
    expect(done.result).toBe(100);
    expect([xp(done.payload, 'player'), xp(done.payload, 'coding')]).toEqual([100, 100]);
    expect(done.payload.occurrences[0]).toMatchObject({ state: 'COMPLETED', awardedXp: 100 });
    expect(done.payload.player).toMatchObject({ xpTotal: 100, level: 2 });
    valid(done.payload);
  });
  it('double submission and retries cannot award twice', () => {
    const { q, id } = full(); const done = T.completeTimer(q, id, true, at(60)).payload;
    expect(code(() => T.completeTimer(done, id, true, at(60)))).toBe('ALREADY_COMPLETED');
    expect(code(() => T.completeTimer(done, id, true, at(61)))).toBe('ALREADY_COMPLETED');
    expect(code(() => T.bankPartial(done, id, at(61)))).toBe('ALREADY_COMPLETED');
    expect(done.xpTransactions).toHaveLength(2);
  });
  it('undo within 2 minutes reverses via ledger; one undo per occurrence; re-completion allowed once', () => {
    const { q: q0, id } = full(); const q = seedBase(q0); const done = T.completeTimer(q, id, true, at(60)).payload;
    expect(code(() => T.undoCompletion(done, id, new Date(at(60).getTime() + 120_001)))).toBe('UNDO_EXPIRED');
    const undone = T.undoCompletion(done, id, new Date(at(60).getTime() + 120_000)).payload;
    expect([xp(undone, 'player'), xp(undone, 'coding')]).toEqual([50, 50]);
    expect(undone.occurrences[0]).toMatchObject({ state: 'OPEN', awardedXp: 0 });
    expect(T.timerViews(undone, at(62))[0]).toMatchObject({ status: 'paused', blocks: 4 });
    valid(undone);
    const again = T.completeTimer(undone, id, true, at(63)).payload;
    expect(xp(again, 'player')).toBe(150); valid(again);
    expect(new Set(again.xpTransactions.map((t) => t.idempotencyKey)).size).toBe(8);
    expect(again.levelEvents.map((e) => e.level)).toEqual([2]); // one level event despite undo and re-completion
    expect(code(() => T.undoCompletion(again, id, at(64)))).toBe('UNDO_USED');
    expect(code(() => T.undoCompletion(q, id, at(64)))).toBe('NOT_COMPLETED');
  });
  it('undo policy: inside the 2-minute window an undo that would remove a reached level is refused and changes nothing', () => {
    const { q, id } = full(); const done = T.completeTimer(q, id, true, at(60)).payload; // 0 -> 100 XP crosses level 2
    expect(done.levelEvents.map((e) => e.level)).toEqual([2]);
    const inside = new Date(at(60).getTime() + 30_000);
    expect(code(() => T.undoCompletion(done, id, inside))).toBe('UNDO_BLOCKED');
    expect(done.occurrences[0]).toMatchObject({ state: 'COMPLETED', awardedXp: 100 }); expect(xp(done, 'player')).toBe(100); valid(done);
    expect(code(() => T.undoCompletion(done, id, new Date(at(60).getTime() + 121_000)))).toBe('UNDO_EXPIRED'); // the window check applies first
  });
  it('banking partial progress awards full blocks only; day close deducts on the unearned remainder', () => {
    const { p, ids } = setup(); const id = ids[0]!; let q = T.startTimer(p, id, at(0)).payload; q = run(q, id, 0, 35);
    expect(code(() => T.bankPartial(q, id, at(60)))).toBe('GAP_PENDING');
    const banked = T.bankPartial(q, id, at(36)); // 36 min = 2 full blocks of 4
    expect(banked.result).toBe(50);
    expect(banked.payload.occurrences[0]).toMatchObject({ state: 'PARTIAL', awardedXp: 50 });
    valid(banked.payload);
    const before = structuredClone(banked.payload); before.player.lastProcessedDayKey = '2026-10-19'; // day-close cursor: day 20 is the first unprocessed day
    const closed = closeDayPayload(before, new Date('2026-10-21T05:00:00Z')).payload;
    const ded = closed.xpTransactions.find((t) => t.kind === 'penalty_deduction' && t.scope === 'player')!;
    expect(ded.requestedDelta).toBe(-13); // medium tier 25% of the unearned 50 XP, rounded
    valid(closed);
  });
  it('penalty quests complete with the timer but award 0 XP', () => {
    let { p } = setup([]); const id = 'pen1';
    p = structuredClone(p); p.occurrences.push({ id, dayKey: '2026-10-20', dueDayKey: '2026-10-20', source: 'penalty', state: 'OPEN', awardedXp: 0,
      dayEndsAt: '2026-10-21T04:00:00.000Z', snapshot: { title: 'PENALTY', category: 'coding', kind: 'timed', targetBlocks: 2, mandatory: true, important: false, potentialXp: 0, penaltyTier: 'easy' } });
    let q = T.startTimer(p, id, at(0)).payload; q = run(q, id, 0, 30);
    expect(code(() => T.bankPartial(q, id, at(30)))).toBe('NOT_BANKABLE');
    const done = T.completeTimer(q, id, true, at(30)).payload;
    expect(done.occurrences[0]).toMatchObject({ state: 'COMPLETED', awardedXp: 0 }); expect(done.xpTransactions).toHaveLength(0); valid(done);
  });
  it('standard quests share the award path; one-off XP is capped at 300 per day', () => {
    let p = createRegisteredPayload('V', 'UTC', '04:00'); const ids: string[] = [];
    for (let i = 0; i < 2; i++) { const r = createOneOff(p, { title: `one-off ${i}`, category: 'fitness', difficulty: 'hard' }, '2026-10-20', at(0)); p = r.payload; ids.push(r.result.id); }
    p = T.completeStandardQuest(p, ids[0]!, true, at(1)).payload; p = T.completeStandardQuest(p, ids[1]!, true, at(2)).payload;
    expect(xp(p, 'player')).toBe(300); expect(p.occurrences.map((o: Obj) => o.awardedXp)).toEqual([200, 100]); valid(p);
    expect(code(() => T.completeStandardQuest(p, ids[0]!, true, at(3)))).toBe('ALREADY_COMPLETED');
    expect(code(() => T.completeStandardQuest(p, ids[0]!, false, at(3)))).toBe('ALREADY_COMPLETED');
  });
});
describe('persistence: reload, app close and retry', () => {
  let db: SlsDb;
  beforeEach(async () => { db = new SlsDb(`timer-${Math.random()}`); await db.open(); });
  it('reconstructs a running session after reopening the database; retries cannot double award', async () => {
    const { p: p0, ids } = setup(); const id = ids[0]!; const p = seedBase(p0); await replaceAll(db, p);
    await RT.startTimerDb(db, id, at(0)); await RT.heartbeatDb(db, id, at(8));
    db.close(); await db.open(); // "app close"
    const view = T.timerViews(await loadPayload(db), at(12))[0]!;
    expect(view).toMatchObject({ status: 'running', activeMs: 12 * 60_000, blocks: 0 });
    for (const m of [16, 24, 32, 40, 48, 56]) await RT.heartbeatDb(db, id, at(m));
    await expect(RT.completeTimerDb(db, id, true, at(60))).resolves.toBeDefined();
    db.close(); await db.open(); // reload, then a retried submit
    await expect(RT.completeTimerDb(db, id, true, at(61))).rejects.toMatchObject({ code: 'ALREADY_COMPLETED' });
    const after = await loadPayload(db);
    expect(after.xpTransactions).toHaveLength(4); expect(validatePayload(after).errors).toEqual([]);
    await expect(RT.undoCompletionDb(db, id, at(61))).resolves.toBeUndefined();
    expect(xp(await loadPayload(db), 'player')).toBe(50);
  });
  it('a failed action leaves stored data untouched', async () => {
    const { p, ids } = setup(); await replaceAll(db, p); const stored = await loadPayload(db);
    await expect(RT.completeTimerDb(db, ids[0]!, true, at(5))).rejects.toMatchObject({ code: 'NO_SESSION' });
    expect(await loadPayload(db)).toEqual(stored);
  });
});
