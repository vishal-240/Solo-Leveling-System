import { describe, expect, it } from 'vitest';
import { DIFFICULTY_XP, attrLevelFromXp, levelFromXp } from '../engine/progression';
import { emptyPayload, validatePayload, type Obj, type Payload } from '../persist/backup';
import { dayEndAt, dayEndForSettings, gameDayKeyAt, gameDayKeyForSettings, getPolicyForDay, shiftDayKey } from './calendar';
import {
  addRestDay, archiveTemplate, changeResetPolicy, createOneOff, createTemplate, editTemplate,
  generateOccurrencesForDay, getTemplateDefinitions, isProtectedRestDay, pauseTemplate, removeRestDay, resumeTemplate, skipOccurrence,
  type QuestDefinition,
} from './domain';
import { closeDayPayload, createRegisteredPayload } from './dayClose';
import { syncProgressionInPlace } from '../rewards/rewards';

const t0 = new Date('2026-10-20T00:00:00.000Z');
const def = (over: Partial<QuestDefinition> = {}): QuestDefinition => ({ title: 'Study algorithms', category: 'coding', kind: 'standard', difficulty: 'medium',
  mandatory: true, important: false, schedule: { type: 'daily' }, ...over });
function xpRow(id: string, scope: string, delta: number, at = '2026-10-20T00:00:00.000Z'): Obj {
  return { id, at, dayKey: at.slice(0, 10), scope, kind: 'quest_award', requestedDelta: delta, appliedDelta: delta, idempotencyKey: `test:${id}` };
}
function registered(name = 'Vishal', zone = 'UTC', reset = '04:00'): Payload { return createRegisteredPayload(name, zone, reset); }

describe('game-day calendar and DST', () => {
  it('uses the configured reset time rather than the host timezone', () => {
    expect(gameDayKeyAt(new Date('2026-10-24T02:59:00.000Z'), 'UTC', '04:00')).toBe('2026-10-23');
    expect(gameDayKeyAt(new Date('2026-10-24T04:00:00.000Z'), 'UTC', '04:00')).toBe('2026-10-24');
    expect(gameDayKeyAt(new Date('2026-10-24T00:00:00.000Z'), 'Asia/Kolkata', '04:00')).toBe('2026-10-24');
  });
  it('moves a reset in a DST gap to the first valid local time after the gap', () => {
    expect(dayEndAt('2026-03-07', 'America/New_York', '02:30').toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(gameDayKeyAt(new Date('2026-03-08T06:45:00.000Z'), 'America/New_York', '02:30')).toBe('2026-03-07');
    expect(gameDayKeyAt(new Date('2026-03-08T07:15:00.000Z'), 'America/New_York', '02:30')).toBe('2026-03-08');
  });
  it('chooses the first occurrence of a repeated local reset time during a DST overlap', () => {
    expect(dayEndAt('2026-10-31', 'America/New_York', '01:30').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
  it('uses the reset-policy version effective on each game day', () => {
    const settings = { timezone: 'Asia/Kolkata', resetTime: '04:00', resetPolicyHistory: [
      { effectiveFromDayKey: '2026-10-01', timezone: 'Asia/Kolkata', resetTime: '04:00' },
      { effectiveFromDayKey: '2026-10-24', timezone: 'UTC', resetTime: '05:30' },
    ] };
    expect(getPolicyForDay(settings, '2026-10-23')).toMatchObject({ timezone: 'Asia/Kolkata', resetTime: '04:00' });
    expect(getPolicyForDay(settings, '2026-10-24')).toMatchObject({ timezone: 'UTC', resetTime: '05:30' });
  });
  it('shifts calendar day keys without depending on local machine time', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('applies timezone/reset changes prospectively without duplicating or skipping game-day keys', () => {
    const p = registered('V', 'Asia/Kolkata', '04:00');
    const changed = changeResetPolicy(p, '2026-10-24', 'America/Los_Angeles', '03:15', new Date('2026-10-24T10:00:00Z'));
    const settings = changed.payload.settings as any;
    expect(getPolicyForDay(settings, '2026-10-24')).toMatchObject({ timezone: 'Asia/Kolkata', resetTime: '04:00' });
    expect(getPolicyForDay(settings, '2026-10-25')).toMatchObject({ timezone: 'America/Los_Angeles', resetTime: '03:15' });
    const boundary = dayEndForSettings('2026-10-24', settings);
    expect(gameDayKeyForSettings(new Date(boundary.getTime() - 1), settings)).toBe('2026-10-24');
    expect(gameDayKeyForSettings(new Date(boundary.getTime() + 1), settings)).toBe('2026-10-25');
    const nextBoundary = dayEndForSettings('2026-10-25', settings);
    expect(gameDayKeyForSettings(new Date(nextBoundary.getTime() - 1), settings)).toBe('2026-10-25');
    expect(gameDayKeyForSettings(new Date(nextBoundary.getTime() + 1), settings)).toBe('2026-10-26');
  });
});

describe('template/version CRUD and occurrence generation', () => {
  it('creates a template with immutable version 1 and generates a frozen occurrence', () => {
    const p = registered(); const created = createTemplate(p, def(), '2026-10-20', t0);
    expect(created.result.currentVersion).toBe(1);
    const g = generateOccurrencesForDay(created.payload, '2026-10-20', t0);
    expect(g.generated).toHaveLength(1);
    expect(g.generated[0]).toMatchObject({ source: 'recurring', dayKey: '2026-10-20', dueDayKey: '2026-10-20', state: 'OPEN', snapshot: { title: 'Study algorithms', potentialXp: 100 } });
    expect(generateOccurrencesForDay(g.payload, '2026-10-20', t0).generated).toHaveLength(0);
    expect(validatePayload(g.payload).errors).toEqual([]);
  });
  it('edits take effect from the next day without rewriting generated occurrences', () => {
    const created = createTemplate(registered(), def(), '2026-10-20', t0);
    const today = generateOccurrencesForDay(created.payload, '2026-10-20', t0);
    const edited = editTemplate(today.payload, created.result.id, { title: 'New title' }, '2026-10-21', new Date(t0.getTime() + 1000));
    expect((edited.payload.occurrences[0] as Obj).snapshot).toMatchObject({ title: 'Study algorithms' });
    const next = generateOccurrencesForDay(edited.payload, '2026-10-21', new Date(t0.getTime() + 86_400_000));
    expect(next.generated[0]?.snapshot.title).toBe('New title');
    expect(getTemplateDefinitions(next.payload, created.result.id).map((v) => v.title)).toEqual(['Study algorithms', 'New title']);
  });
  it('pause begins next game day and resume creates a new effective version', () => {
    const created = createTemplate(registered(), def(), '2026-10-20', t0);
    const paused = pauseTemplate(created.payload, created.result.id, '2026-10-21', undefined, t0);
    expect(generateOccurrencesForDay(paused.payload, '2026-10-20', t0).generated[0]?.state).toBe('OPEN');
    expect(generateOccurrencesForDay(paused.payload, '2026-10-21', t0).generated[0]?.state).toBe('EXEMPT');
    const resumed = resumeTemplate(paused.payload, created.result.id, '2026-10-23', t0);
    expect(generateOccurrencesForDay(resumed.payload, '2026-10-23', t0).generated[0]?.state).toBe('OPEN');
  });
  it('an explicit resume date stops exemption on that day', () => {
    const created = createTemplate(registered(), def(), '2026-10-20', t0);
    const paused = pauseTemplate(created.payload, created.result.id, '2026-10-21', '2026-10-24', t0);
    expect(generateOccurrencesForDay(paused.payload, '2026-10-22', t0).generated[0]?.state).toBe('EXEMPT');
    expect(generateOccurrencesForDay(paused.payload, '2026-10-24', t0).generated[0]?.state).toBe('OPEN');
  });
  it('archives future occurrences but preserves completed and past history', () => {
    const created = createTemplate(registered(), def(), '2026-10-20', t0);
    const today = generateOccurrencesForDay(created.payload, '2026-10-20', t0);
    const tomorrow = generateOccurrencesForDay(today.payload, '2026-10-21', new Date(t0.getTime() + 86_400_000));
    const archived = archiveTemplate(tomorrow.payload, created.result.id, '2026-10-21');
    expect(generateOccurrencesForDay(archived.payload, '2026-10-20', t0).generated).toHaveLength(0); // already generated
    expect(generateOccurrencesForDay(archived.payload, '2026-10-21', t0).generated).toHaveLength(0);
    expect(archived.payload.occurrences.map((o) => o.dayKey)).toEqual(['2026-10-20']);
  });
  it.each([
    [{ type: 'daily' }, '2026-10-20', true],
    [{ type: 'weekdays', days: [1, 3, 5] }, '2026-10-20', false],
    [{ type: 'weekdays', days: [2, 4] }, '2026-10-20', true],
    [{ type: 'everyNDays', n: 3, anchorDayKey: '2026-10-20' }, '2026-10-23', true],
    [{ type: 'everyNDays', n: 3, anchorDayKey: '2026-10-20' }, '2026-10-22', false],
  ] as const)('matches recurrence schedule %j on %s', (schedule, dayKey, expected) => {
    const created = createTemplate(registered(), def({ schedule: schedule as QuestDefinition['schedule'] }), '2026-10-20', t0);
    expect(generateOccurrencesForDay(created.payload, dayKey, t0).generated.length > 0).toBe(expected);
  });
  it('creates one weekly occurrence per week, evaluated at week end, including mid-week creation', () => {
    const created = createTemplate(registered(), def({ schedule: { type: 'weekly' } }), '2026-10-21', t0);
    const wed = generateOccurrencesForDay(created.payload, '2026-10-21', t0);
    expect(wed.generated).toHaveLength(1);
    expect(wed.generated[0]).toMatchObject({ dayKey: '2026-10-21', dueDayKey: '2026-10-25' });
    expect(generateOccurrencesForDay(wed.payload, '2026-10-22', t0).generated).toHaveLength(0);
  });
  it('creates one-off quests with a deadline day and enforces mandatory/important consistency', () => {
    const created = createOneOff(registered(), { title: 'Submit lab', category: 'academics', difficulty: 'hard', mandatory: true,
      deadlineDayKey: '2026-10-22' }, '2026-10-20', t0);
    expect(created.result).toMatchObject({ source: 'oneoff', dayKey: '2026-10-20', dueDayKey: '2026-10-22', snapshot: { potentialXp: 200 } });
    expect(created.result.dayEndsAt).toBe(dayEndForSettings('2026-10-22', created.payload.settings as any).toISOString());
    expect(() => createOneOff(registered(), { title: 'Bad', category: 'coding', difficulty: 'easy', important: true, mandatory: false }, '2026-10-20', t0)).toThrow(/mandatory/);
  });
  it('switching standard/timed quest kinds removes incompatible fields', () => {
    const created = createTemplate(registered(), def(), '2026-10-20', t0);
    const edited = editTemplate(created.payload, created.result.id, { kind: 'timed', targetBlocks: 4 }, '2026-10-21', t0);
    expect(edited.result).toMatchObject({ kind: 'timed', targetBlocks: 4 });
    expect(edited.result).not.toHaveProperty('difficulty');
    expect(generateOccurrencesForDay(edited.payload, '2026-10-21', t0).generated[0]?.snapshot.potentialXp).toBe(100);
  });
});

describe('protected rest days and skip behavior', () => {
  it('enforces one recurring rest day and two ad-hoc dates per calendar month', () => {
    let p = registered('V', 'UTC', '04:00');
    p = addRestDay(p, { kind: 'recurring', weekday: 0 }, p.settings as any, new Date('2026-10-20T00:00:00Z')).payload;
    expect(() => addRestDay(p, { kind: 'recurring', weekday: 6 }, p.settings as any, t0)).toThrow(/Only one recurring/);
    p = addRestDay(p, { kind: 'adhoc', dayKey: '2026-10-25' }, p.settings as any, new Date('2026-10-20T00:00:00Z')).payload;
    p = addRestDay(p, { kind: 'adhoc', dayKey: '2026-10-26' }, p.settings as any, new Date('2026-10-20T00:00:00Z')).payload;
    expect(() => addRestDay(p, { kind: 'adhoc', dayKey: '2026-10-27' }, p.settings as any, new Date('2026-10-20T00:00:00Z'))).toThrow(/two ad-hoc/);
  });
  it('does not retroactively protect an already-started day', () => {
    const p = registered();
    const now = new Date('2026-10-20T05:00:00Z');
    // The spec requires date-specific rest days to be declared before the game day starts.
    // Reject the late declaration and ensure the original payload remains unprotected.
    expect(() => addRestDay(p, { kind: 'adhoc', dayKey: '2026-10-20' }, p.settings as any, now))
      .toThrow(/declared before that game day begins/);
    expect(isProtectedRestDay(p, '2026-10-20', p.settings as any)).toBe(false);
    expect((p.restDays as unknown[])).toHaveLength(0);
  });
  it('rest days exempt scheduled quests and add a non-mandatory Recovery quest', () => {
    const p = registered();
    const rest = addRestDay(p, { kind: 'recurring', weekday: 2 }, p.settings as any, new Date('2026-10-19T00:00:00Z'));
    const template = createTemplate(rest.payload, def(), '2026-10-20', t0);
    const generated = generateOccurrencesForDay(template.payload, '2026-10-20', t0);
    expect(generated.protectedRestDay).toBe(true);
    expect(generated.generated).toHaveLength(2);
    expect(generated.generated.find((o) => o.source === 'recurring')?.state).toBe('EXEMPT');
    expect(generated.generated.find((o) => o.source === 'rest')?.snapshot).toMatchObject({ category: 'recovery', mandatory: false, potentialXp: 50 });
  });
  it('skipping a paused/exempt mandatory occurrence does not turn the exemption into a miss', () => {
    const created = createTemplate(registered(), def(), '2026-10-20', t0);
    const paused = pauseTemplate(created.payload, created.result.id, '2026-10-21', undefined, t0);
    const generated = generateOccurrencesForDay(paused.payload, '2026-10-21', t0);
    expect(generated.generated[0]?.state).toBe('EXEMPT');
    expect(skipOccurrence(generated.payload, generated.generated[0]!.id, generated.payload.settings as any, t0).result.state).toBe('EXEMPT');
  });
  it('skipping optional quests is free; mandatory skip becomes a miss unless protected', () => {
    const p = registered(); const mandatory = createTemplate(p, def(), '2026-10-20', t0);
    const optional = createTemplate(mandatory.payload, def({ title: 'Optional', mandatory: false }), '2026-10-20', t0);
    const generated = generateOccurrencesForDay(optional.payload, '2026-10-20', t0);
    const m = generated.generated.find((o) => o.snapshot.mandatory)!;
    const o = generated.generated.find((x) => !x.snapshot.mandatory)!;
    expect(skipOccurrence(generated.payload, m.id, generated.payload.settings as any, t0).result.state).toBe('MISSED');
    expect(skipOccurrence(generated.payload, o.id, generated.payload.settings as any, t0).result.state).toBe('SKIPPED');
  });
});

describe('day close, absence handling and idempotency', () => {
  it("bootstraps a fresh player cursor at yesterday and generates today's quests", () => {
    const p = registered(); const created = createTemplate(p, def(), '2026-10-24', t0);
    const r = closeDayPayload(created.payload, new Date('2026-10-24T10:00:00Z'));
    expect(r.initialized).toBe(true); expect(r.currentDayKey).toBe('2026-10-24');
    expect(r.payload.player.lastProcessedDayKey).toBe('2026-10-23');
    expect(r.generatedToday).toBe(1); expect(r.closedDays).toEqual([]);
    expect(validatePayload(r.payload).errors).toEqual([]);
  });
  it('catches up missed days chronologically once and applies bounded deductions', () => {
    const p = registered(); p.player.lastProcessedDayKey = '2026-10-20';
    const total = 5000; p.xpTransactions = [xpRow('pl-seed', 'player', total), xpRow('attr-seed', 'coding', total)];
    p.player.xpTotal = total; p.player.level = levelFromXp(total);
    const coding = p.attributes.find((a) => a.id === 'coding')!; coding.xpTotal = total; coding.level = attrLevelFromXp(total);
    const created = createTemplate(p, def({ difficulty: 'easy' }), '2026-10-01', t0);
    const result = closeDayPayload(created.payload, new Date('2026-10-24T10:00:00Z'));
    expect(result.closedDays.map((d) => d.dayKey)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(result.closedDays.map((d) => d.missed)).toEqual([1, 1, 1]);
    expect(result.payload.dayRecords.map((d) => d.id)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(result.payload.player.lastProcessedDayKey).toBe('2026-10-23');
    expect(result.payload.xpTransactions.filter((t) => t.kind === 'penalty_deduction' && t.scope === 'player')).toHaveLength(3);
    expect(result.payload.penaltyEvents.some((e) => e.trigger === 'repeat_failure')).toBe(true);
    expect(result.penaltyQuestId).toBeTruthy();
    expect(validatePayload(result.payload).errors).toEqual([]);
  });
  it('does not consume additional shields on later absence days after the first penalty trigger', () => {
    const p = registered(); p.player.lastProcessedDayKey = '2026-10-20'; p.player.streakShields = 2;
    const total = 5000; p.xpTransactions = [xpRow('pl-seed', 'player', total), xpRow('attr-seed', 'coding', total)]; p.player.xpTotal = total; p.player.level = levelFromXp(total);
    const coding = p.attributes.find((a) => a.id === 'coding')!; coding.xpTotal = total; coding.level = attrLevelFromXp(total);
    syncProgressionInPlace(p, t0); Object.assign(p.player, { streakShields: 2, queuedShields: 0, unspentPoints: 0 }); // seeded history already had its level rewards
    const created = createTemplate(p, def({ difficulty: 'hard' }), '2026-10-01', t0);
    const result = closeDayPayload(created.payload, new Date('2026-10-24T10:00:00Z'));
    // Day 21 consumes one shield before its trigger is evaluated; the pending penalty
    // suspends shields on days 22 and 23 in the same catch-up run.
    expect(result.payload.player.streakShields).toBe(1);
    expect(result.payload.meta.pendingPenaltyQuestForCatchup).toBeUndefined();
    expect(result.penaltyQuestId).toBeTruthy();
  });
  it('emits at most one repeat-failure trigger during a single catch-up run', () => {
    const p = registered(); p.player.lastProcessedDayKey = '2026-10-20';
    const total = 5000; p.xpTransactions = [xpRow('pl-seed', 'player', total), xpRow('attr-seed', 'coding', total)]; p.player.xpTotal = total; p.player.level = levelFromXp(total);
    const coding = p.attributes.find((a) => a.id === 'coding')!; coding.xpTotal = total; coding.level = attrLevelFromXp(total);
    let created = createTemplate(p, def({ title: 'Hard A', difficulty: 'hard' }), '2026-10-01', t0);
    created = createTemplate(created.payload, def({ title: 'Hard B', difficulty: 'hard' }), '2026-10-01', t0);
    created = createTemplate(created.payload, def({ title: 'Hard C', difficulty: 'hard' }), '2026-10-01', t0);
    const result = closeDayPayload(created.payload, new Date('2026-10-24T10:00:00Z'));
    expect(result.payload.penaltyEvents.filter((e) => e.trigger === 'repeat_failure')).toHaveLength(1);
  });
  it('does not reprocess or double-penalize when the same now is retried', () => {
    const p = registered(); p.player.lastProcessedDayKey = '2026-10-22';
    p.xpTransactions = [xpRow('pl-seed', 'player', 5000), xpRow('attr-seed', 'coding', 5000)]; p.player.xpTotal = 5000; p.player.level = levelFromXp(5000);
    const coding = p.attributes.find((a) => a.id === 'coding')!; coding.xpTotal = 5000; coding.level = attrLevelFromXp(5000);
    const created = createTemplate(p, def({ difficulty: 'easy' }), '2026-10-01', t0);
    const first = closeDayPayload(created.payload, new Date('2026-10-24T10:00:00Z'));
    const second = closeDayPayload(first.payload, new Date('2026-10-24T10:00:00Z'));
    expect(first.closedDays.map((d) => d.dayKey)).toEqual(['2026-10-23']);
    expect(second.closedDays).toEqual([]); expect(second.generatedToday).toBe(0);
    expect(second.payload.xpTransactions.filter((t) => t.kind === 'penalty_deduction')).toHaveLength(2);
    expect(second.payload.dayRecords).toHaveLength(1);
  });
  it('does nothing on a backward clock and does not undo stored history', () => {
    const p = registered(); p.player.lastProcessedDayKey = '2026-10-24';
    const result = closeDayPayload(p, new Date('2026-10-23T10:00:00Z'));
    expect(result.noOp).toBe(true); expect(result.closedDays).toHaveLength(0); expect(result.payload.player.lastProcessedDayKey).toBe('2026-10-24');
  });
  it('lapses optional occurrences with no XP deduction and freezes protected rest days', () => {
    let p = registered(); p.player.lastProcessedDayKey = '2026-10-20';
    const optional = createTemplate(p, def({ mandatory: false }), '2026-10-01', t0);
    p = addRestDay(optional.payload, { kind: 'adhoc', dayKey: '2026-10-22' }, optional.payload.settings as any, new Date('2026-10-20T00:00:00Z')).payload;
    const result = closeDayPayload(p, new Date('2026-10-24T10:00:00Z'));
    expect(result.closedDays).toHaveLength(3);
    expect(result.payload.occurrences.find((o) => o.dayKey === '2026-10-21')?.state).toBe('LAPSED');
    expect(result.payload.occurrences.find((o) => o.dayKey === '2026-10-22' && o.source === 'recurring')?.state).toBe('EXEMPT');
    expect(result.payload.xpTransactions.some((t) => t.kind === 'penalty_deduction')).toBe(false);
  });
  it('closes a mandatory hard miss with exactly one deduction per scope and logs the trigger', () => {
    const p = registered(); p.player.lastProcessedDayKey = '2026-10-22';
    p.xpTransactions = [xpRow('pl-seed', 'player', 5000), xpRow('attr-seed', 'coding', 5000)]; p.player.xpTotal = 5000; p.player.level = levelFromXp(5000);
    const coding = p.attributes.find((a) => a.id === 'coding')!; coding.xpTotal = 5000; coding.level = attrLevelFromXp(5000);
    const created = createTemplate(p, def({ difficulty: 'hard' }), '2026-10-01', t0);
    const result = closeDayPayload(created.payload, new Date('2026-10-24T10:00:00Z'));
    expect(result.payload.xpTransactions.filter((t) => t.kind === 'penalty_deduction' && t.occurrenceId)).toHaveLength(2);
    expect(result.payload.penaltyEvents.some((e) => e.trigger === 'hard_miss')).toBe(true);
  });
});
