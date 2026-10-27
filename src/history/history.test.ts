import { describe, expect, it } from 'vitest';
import { levelFromXp, totalXpToReach } from '../engine/progression';
import { validatePayload, type Payload } from '../persist/backup';
import { closeDayPayload } from '../quests/dayClose';
import { playerView } from '../app/selectors';
import { syncProgression } from '../rewards/rewards';
import { undoCompletion } from '../timer/timer';
import * as H from './history';
import { at, complete, timeline } from './testFixture';

const TODAY = '2026-10-24';
const base = () => timeline();
const mk = (p: Payload) => H.indexHistory(p, TODAY);

describe('date and game-day arithmetic', () => {
  it('builds month grids for both week starts, leap February and year wrap', () => {
    const mon = H.monthGrid('2026-10', 1); expect([mon.length, mon[0]![3], mon[0]![2]]).toEqual([5, '2026-10-01', null]); expect(mon.flat().filter(Boolean)).toHaveLength(31);
    expect(H.monthGrid('2026-10', 0)[0]![4]).toBe('2026-10-01'); expect(H.monthGrid('2028-02', 1).flat().filter(Boolean)).toHaveLength(29);
    expect(H.shiftMonth('2026-12', 1)).toBe('2027-01'); expect(H.shiftMonth('2026-01', -1)).toBe('2025-12'); expect(H.weekdayOf('2026-10-01')).toBe(4);
    expect(H.weekStartKey('2026-10-24', 1)).toBe('2026-10-19'); expect(H.weekStartKey('2026-10-25', 1)).toBe('2026-10-19'); expect(H.weekStartKey('2026-10-25', 0)).toBe('2026-10-25');
  });
  it('maps instants to game days using the reset time and timezone, not midnight', () => {
    const p = base(); p.settings = { ...p.settings, timezone: 'Asia/Kolkata', resetTime: '04:00' };
    expect(H.dayKeyOfInstant(p, '2026-10-21T22:00:00Z')).toBe('2026-10-21'); // 03:30 IST is still the previous game day
    expect(H.dayKeyOfInstant(p, '2026-10-21T22:30:00Z')).toBe('2026-10-22'); // 04:00 IST starts the next
  });
});
describe('day summaries', () => {
  const idx = mk(base()); const s = (k: string) => H.summaryFor(idx, k);
  it('classifies every day from persisted records', () => {
    expect([s('2026-10-20').status, s('2026-10-21').status, s('2026-10-22').status, s('2026-10-23').status, s('2026-10-24').status]).toEqual(['clear', 'missed', 'mixed', 'rest', 'in-progress']);
    expect(s('2026-10-20')).toMatchObject({ completed: 2, xpEarned: 150, xpDeducted: 0, xpNet: 150 });
    expect(s('2026-10-21')).toMatchObject({ missed: 1, lapsed: 1, xpEarned: 0, xpDeducted: 10, xpNet: -10 }); // 25 requested, limited to 10 by the attribute's level floor
    expect(s('2026-10-22')).toMatchObject({ completed: 1, missed: 1 }); expect(s('2026-10-23')).toMatchObject({ exempt: 2, xpNet: 0 });
  });
  it('never reports future or unrecorded days as missed', () => {
    for (const k of ['2026-10-25', '2026-11-30', '2026-10-01', '2025-01-01']) expect(s(k).status).toBe('nodata');
    expect(idx.first).toBe('2026-10-20');
  });
  it('day nets add up to the ledger total shown on Status', () => {
    const p = base(); const total = [...mk(p).days.values()].reduce((a, d) => a + d.xpNet, 0);
    expect(total).toBe(playerView(p).total); expect(levelFromXp(total)).toBeGreaterThanOrEqual(2);
  });
});
describe('charts reconcile with the ledger', () => {
  it('weekly and monthly buckets sum to the player ledger total, with empty buckets filled', () => {
    const p = base(); p.xpTransactions.push(...[['2026-09-28', 40], ['2026-10-05', 20]].map(([d, n]) => ({ id: `seed${d}`, at: `${d}T08:00:00.000Z`, dayKey: String(d), scope: 'player', kind: 'quest_award', requestedDelta: n, appliedDelta: n, idempotencyKey: `seed:${d}` })));
    const idx = mk(p), ledger = p.xpTransactions.filter((t) => t.scope === 'player').reduce((a, t) => a + Number(t.appliedDelta), 0);
    const w = H.xpBuckets(p, idx, 'week'), m = H.xpBuckets(p, idx, 'month');
    expect(w.total).toBe(ledger); expect(w.buckets.reduce((a, b) => a + b.net, 0)).toBe(ledger); expect(m.total).toBe(ledger);
    expect(w.buckets.map((b) => b.key)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']); expect(w.buckets[2]!.net).toBe(0); expect(m.buckets.map((b) => b.key)).toEqual(['2026-09', '2026-10']);
    expect(w.buckets.every((b) => b.net === b.earned - b.deducted)).toBe(true);
  });
  it('an undone completion is netted out, not double counted', () => {
    let p = base(); p.xpTransactions.push({ id: 'seed', at: '2026-10-24T01:00:00.000Z', dayKey: '2026-10-24', scope: 'player', kind: 'quest_award', requestedDelta: 5, appliedDelta: 5, idempotencyKey: 'seed' });
    p = closeDayPayload(p, at('2026-10-24', 10)).payload; const before = playerView(p).total;
    const open = p.occurrences.find((o) => o.dayKey === '2026-10-24' && o.state === 'OPEN' && (o.snapshot as { title: string }).title === 'B')!;
    // B is worth 50; level 3 starts at 160, so completing and undoing stays inside the current level only when XP allows: use the real undo rule
    const done = complete(p, '2026-10-24', 'B', at('2026-10-24', 11)); const crossed = levelFromXp(before + 50) > levelFromXp(before);
    if (!crossed) { const u = undoCompletion(done, String(open.id), at('2026-10-24', 11, 1)).payload; const i = mk(u); expect(H.summaryFor(i, '2026-10-24').xpEarned).toBe(5); expect(H.ledgerRows(u).filter((r) => r.kind === 'reversal').length).toBe(2); }
    else expect(() => undoCompletion(done, String(open.id), at('2026-10-24', 11, 1))).toThrow();
  });
  it('attribute breakdown matches each scope in the ledger and shares use a stated denominator', () => {
    const p = base(), a = H.attributeBreakdown(p), coding = a.find((x) => x.id === 'coding')!;
    expect(coding.net).toBe(p.xpTransactions.filter((t) => t.scope === 'coding').reduce((s, t) => s + Number(t.appliedDelta), 0)); expect(coding.share).toBe(1);
    expect(a.filter((x) => x.id !== 'coding').every((x) => x.net === 0 && x.share === 0)).toBe(true); expect(H.attributeBreakdown({ ...base(), xpTransactions: [] }).every((x) => x.share === null)).toBe(true);
  });
  it('completion rate counts only processed, scheduled, resolved quests', () => {
    const [w7, w30, all] = H.completionStats(base(), TODAY) as [H.CompletionStats, H.CompletionStats, H.CompletionStats];
    expect(all).toMatchObject({ completed: 3, missed: 2, lapsed: 1, excluded: 3, denominator: 6, rate: 0.5, days: 4 }); // excluded: 2 exempt quests and the lapsed rest-day affordance expect(w7).toEqual({ ...all, label: 'Last 7 days' }); expect(w30.denominator).toBe(6);
    expect(H.completionStats(base(), '2026-12-31')[0]).toMatchObject({ denominator: 0, rate: null }); // old data falls out of a short window
  });
});
describe('XP ledger view', () => {
  it('lists newest first, filters by scope, kind and day, and flags floor-limited amounts', () => {
    const p = base(), all = H.ledgerRows(p);
    expect(all.map((r) => r.at)).toEqual([...all.map((r) => r.at)].sort().reverse()); expect(H.ledgerRows(p, { scope: 'coding' }).every((r) => r.scope === 'coding')).toBe(true);
    const ded = H.ledgerRows(p, { kind: 'penalty_deduction', scope: 'player' }); expect(ded).toHaveLength(2); expect(ded.some((r) => r.clamped)).toBe(true); expect(ded.find((r) => r.clamped)).toMatchObject({ requested: -25, applied: -10 });
    expect(H.ledgerRows(p, { dayKey: '2026-10-20' }).every((r) => r.dayKey === '2026-10-20')).toBe(true); expect(H.ledgerRows(p, { dayKey: '2030-01-01' })).toEqual([]);
    expect(H.ledgerRows(p, { scope: 'player', kind: 'quest_award' }).map((r) => r.quest).sort()).toEqual(['A', 'B', 'B']);
  });
});
describe('System log', () => {
  it('is chronological, categorised, free of duplicate or invented events, and idempotent', () => {
    const p = base(), log = H.systemLog(p);
    expect(log.map((e) => e.at)).toEqual([...log.map((e) => e.at)].sort().reverse()); expect(new Set(log.map((e) => e.id)).size).toBe(log.length);
    const by = (c: H.LogCategory) => log.filter((e) => e.category === c);
    expect(by('Progression').map((e) => e.detail).sort()).toEqual(p.levelEvents.map((e) => `Level ${e.level}`).sort());
    expect(by('Penalties')).toHaveLength(p.xpTransactions.filter((t) => t.scope === 'player' && t.kind === 'penalty_deduction').length + p.penaltyEvents.length); expect(by('Penalties')).toHaveLength(2); expect(by('Notifications').some((e) => e.title === 'LEVEL UP' || e.title === 'RANK PROMOTION')).toBe(false);
    expect(by('Rewards').length).toBe(p.rewardGrants.length);
    const again = H.systemLog(syncProgression(closeDayPayload(p, at('2026-10-24', 10)).payload, at('2026-10-24', 12))); expect(again).toHaveLength(log.length);
    expect(H.systemLog(p, { category: 'Penalties' }).every((e) => e.category === 'Penalties')).toBe(true); expect(H.systemLog(p, { dayKey: '2026-10-21' }).some((e) => e.category === 'Penalties')).toBe(true);
    expect(validatePayload(p).errors).toEqual([]);
  });
  it('explains floor-limited penalties and has an empty log for an empty payload', () => {
    expect(H.systemLog(base(), { category: 'Penalties' }).some((e) => /limited by the level floor/.test(e.detail))).toBe(true);
    expect(H.systemLog({ ...base(), levelEvents: [], rankEvents: [], rewardGrants: [], penaltyEvents: [], systemMessages: [], xpTransactions: [] })).toEqual([]);
  });
});
describe('achievement gallery', () => {
  it('shows unlocked achievements, hides undiscovered hidden ones and clamps progress', () => {
    const g = H.achievementGallery(base()); expect(g.find((i) => i.id === 'first_quest')).toMatchObject({ unlocked: true }); expect(g.filter((i) => i.hidden && !i.unlocked).length).toBeGreaterThanOrEqual(4);
    expect(g.every((i) => i.progress <= i.target)).toBe(true); expect(totalXpToReach(3)).toBeGreaterThan(0);
  });
});
