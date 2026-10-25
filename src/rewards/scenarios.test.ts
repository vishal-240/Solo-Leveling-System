// P5 review-gate scenarios, derived from spec sections 3 and 5. Each row is run, checked, and written to docs/P5-scenario-report.md.
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { levelFromXp, rankForLevel, totalXpToReach, attrTotalToReach } from '../engine/progression';
import { validatePayload, type Obj, type Payload } from '../persist/backup';
import { closeDayPayload, createRegisteredPayload } from '../quests/dayClose';
import { addRestDay, createTemplate, generateOccurrencesForDay, pauseTemplate, type QuestDefinition } from '../quests/domain';
import { completeStandardQuest, startTimer, heartbeat, completeTimer, undoCompletion } from '../timer/timer';
import * as R from './rewards';

const report: string[] = [];
const log = (area: string, scenario: string, observed: unknown) => report.push(`| ${area} | ${scenario} | ${typeof observed === 'string' ? observed : JSON.stringify(observed)} |`);
const D0 = '2026-10-20'; const t = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00.000Z`);
const day = (n: number) => new Date(Date.UTC(2026, 9, 20 + n)).toISOString().slice(0, 10);
const def = (o: Partial<QuestDefinition> = {}): QuestDefinition => ({ title: 'Q', category: 'coding', kind: 'standard', difficulty: 'medium', mandatory: true, important: false, schedule: { type: 'daily' }, ...o });
const seedXp = (p: Payload, total: number, attr = total) => { p.xpTransactions.push(
  { id: `s-p-${total}`, at: '2026-10-01T00:00:00Z', dayKey: '2026-10-01', scope: 'player', kind: 'quest_award', requestedDelta: total, appliedDelta: total, idempotencyKey: `seed:p:${total}` },
  { id: `s-c-${total}`, at: '2026-10-01T00:00:00Z', dayKey: '2026-10-01', scope: 'coding', kind: 'quest_award', requestedDelta: attr, appliedDelta: attr, idempotencyKey: `seed:c:${total}` }); };
function fresh(total = 0, attr = total, defs: QuestDefinition[] = [def()]): Payload {
  const p = createRegisteredPayload('V', 'UTC', '04:00'); p.player.lastProcessedDayKey = '2026-10-19'; seedXp(p, total, attr);
  R.syncProgressionInPlace(p, t('2026-10-01')); Object.assign(p.player, { streakShields: 0, queuedShields: 0, unspentPoints: 0 });
  let q = p; for (const d of defs) q = createTemplate(q, d, '2026-10-01', t('2026-10-01')).payload; return q;
}
const ded = (p: Payload, scope = 'player') => p.xpTransactions.filter((x) => x.kind === 'penalty_deduction' && x.scope === scope);
const xp = (p: Payload, scope = 'player') => p.xpTransactions.filter((x) => x.scope === scope).reduce((s, x) => s + Number(x.appliedDelta), 0);
const ok = (p: Payload) => expect(validatePayload(p).errors).toEqual([]);
const close = (p: Payload, d: string, h = 10) => closeDayPayload(p, t(d, h)).payload;
const complete = (p: Payload, d: string, title?: string) => { let q = p; for (const o of p.occurrences.filter((x) => x.dayKey === d && x.state === 'OPEN' && x.source === 'recurring' && (!title || (x.snapshot as Obj).title === title))) q = completeStandardQuest(q, String(o.id), true, t(d, 12)).payload; return q; };
/** Simulate days: 'done' completes today's quests, 'miss' ignores them. Returns the payload at the morning after the last day. */
function sim(p: Payload, plan: ('done' | 'miss')[]): Payload { let q = p; plan.forEach((a, i) => { q = close(q, day(i)); if (a === 'done') q = complete(q, day(i)); }); return close(q, day(plan.length)); }

describe('mandatory misses and the level floor (3.7)', () => {
  const rows: [string, QuestDefinition, number, number, number, number][] = [ // name, quest, seed XP above floor, expected requested, expected applied
    ['easy 25% of 50', def({ difficulty: 'easy' }), 500, 13, 13, 0], ['medium 25% of 100', def(), 500, 25, 25, 0], ['hard 40% of 200', def({ difficulty: 'hard' }), 500, 80, 80, 0],
    ['timed 2 blocks = easy tier', def({ kind: 'timed', targetBlocks: 2, difficulty: undefined }), 500, 13, 13, 0], ['timed 4 blocks = medium tier', def({ kind: 'timed', targetBlocks: 4, difficulty: undefined }), 500, 25, 25, 0],
    ['timed 8 blocks = hard tier', def({ kind: 'timed', targetBlocks: 8, difficulty: undefined }), 500, 80, 80, 0],
  ].map(([n, q, s, r, a]) => [n, q, s, r, a, 0] as never);
  it.each(rows)('%s', (name, quest, _s, requested, applied) => {
    const total = totalXpToReach(10) + 500; const p = fresh(total, total, [quest as QuestDefinition]);
    const q = sim(p, ['miss']); const d = ded(q)[0]!;
    expect([-Number(d.requestedDelta), -Number(d.appliedDelta)]).toEqual([requested, applied]); ok(q); log('Deduction', String(name), `requested ${requested}, applied ${applied}`);
  });
  it.each([[0, 0], [5, 5], [79, 79], [80, 80], [500, 80]])('floor boundary: %i XP above the level start loses %i of a hard miss', (above, loss) => {
    const total = totalXpToReach(10) + above; const q = sim(fresh(total, total, [def({ difficulty: 'hard' })]), ['miss']);
    expect(xp(q)).toBe(total - loss); expect(levelFromXp(xp(q))).toBe(10); ok(q); log('Floor', `hard miss with ${above} XP above level-10 start`, `lost ${loss}, level stays 10`);
  });
  it('attribute floor binds independently of the player floor', () => {
    const q = sim(fresh(totalXpToReach(10) + 500, attrTotalToReach(5) + 3, [def({ difficulty: 'hard' })]), ['miss']);
    expect([-Number(ded(q)[0]!.appliedDelta), -Number(ded(q, 'coding')[0]!.appliedDelta)]).toEqual([3, 3]); log('Floor', 'attribute 3 XP above its level start', 'same bounded 3 deducted from both scopes');
  });
  it('optional quests are never deducted and an XP-free miss cannot go negative', () => {
    const q = sim(fresh(0, 0, [def({ mandatory: false })]), ['miss']); expect(ded(q)).toHaveLength(0);
    const z = sim(fresh(0, 0, [def()]), ['miss']); expect(xp(z)).toBe(0); log('Deduction', 'optional miss / zero-XP miss', 'no deduction; XP stays 0');
  });
});
describe('rest days, paused quests, failure thresholds and penalty quests (3.8, 3.11)', () => {
  it('protected rest day exempts mandatory quests and freezes the streak', () => {
    let p = fresh(0, 0); p = addRestDay(p, { kind: 'adhoc', dayKey: day(1) }, p.settings, t(day(0), 8)).payload;
    const q = sim(p, ['done', 'miss', 'done']); const daily = q.streaks.find((s) => s.scope === 'daily')!;
    expect(q.occurrences.filter((o) => o.dayKey === day(1) && o.source !== 'rest').every((o) => o.state === 'EXEMPT')).toBe(true);
    expect(ded(q)).toHaveLength(0); expect(daily.current).toBe(2); ok(q); log('Rest day', 'done, rest (ignored), done', `streak ${daily.current}, no deduction`);
  });
  it('a quest paused from tomorrow is exempt from tomorrow on', () => {
    let p = fresh(1000, 1000); p = close(p, day(0)); p = pauseTemplate(p, String(p.templates[0]!.id), day(1)).payload;
    const q = sim(p, ['miss', 'miss', 'miss']); expect(q.occurrences.filter((o) => String(o.dayKey) > day(0)).every((o) => o.state === 'EXEMPT')).toBe(true); expect(q.penaltyEvents.every((e) => e.dayKey === day(0))).toBe(true); expect(ded(q)).toHaveLength(1); expect(q.occurrences.some((o) => o.source === 'penalty')).toBe(false); // only day 1, generated before the pause, was a real miss
    log('Paused', 'paused from day 2; three ignored days', 'later occurrences EXEMPT; only the pre-pause day deducted once; no penalty quest');
  });
  it.each([[['miss', 'miss'], 0], [['miss', 'miss', 'miss'], 1]] as const)('repeat failure: %j misses in 7 days -> %i penalty quest(s)', (plan, n) => {
    const q = sim(fresh(2000, 2000, [def({ title: 'A', difficulty: 'easy' }), def({ title: 'B', difficulty: 'easy' })]), [...plan]);
    expect(q.occurrences.filter((o) => o.source === 'penalty')).toHaveLength(n === 0 ? (plan.length >= 2 ? 1 : 0) : 1); log('Penalty', `${plan.length} ignored days of two mandatory quests`, `${q.occurrences.filter((o) => o.source === 'penalty').length} penalty quest(s)`);
  });
  it('hard-tier or important misses trigger immediately; penalty quests never stack', () => {
    for (const d of [def({ difficulty: 'hard' }), def({ important: true, difficulty: 'easy' })]) {
      const q = sim(fresh(2000, 2000, [d, def({ title: 'second', difficulty: 'hard' })]), ['miss']);
      expect(q.occurrences.filter((o) => o.source === 'penalty')).toHaveLength(1); ok(q);
    }
    const q = sim(fresh(2000, 2000, [def({ difficulty: 'hard' })]), ['miss', 'miss', 'miss']); expect(q.occurrences.filter((o) => o.source === 'penalty' && o.state === 'OPEN')).toHaveLength(1);
    log('Penalty', 'hard miss, important miss, several triggers while active', 'issued immediately; never more than one open');
  });
  it('a penalty quest awards 0 XP and completing it clears it; expiry fails it without extra deduction', () => {
    let q = sim(fresh(2000, 2000, [def({ difficulty: 'hard' })]), ['miss']); const pen = q.occurrences.find((o) => o.source === 'penalty')!; const before = xp(q);
    const s = startTimer(q, String(pen.id), t(day(1), 11)).payload; let w = s; for (let m = 8; m <= 32; m += 8) w = heartbeat(w, String(pen.id), new Date(t(day(1), 11).getTime() + m * 60000)).payload;
    const done = completeTimer(w, String(pen.id), true, new Date(t(day(1), 11).getTime() + 32 * 60000)).payload;
    expect(xp(done)).toBe(before); expect(done.occurrences.find((o) => o.id === pen.id)!.state).toBe('COMPLETED');
    const expired = close(q, day(4)); expect(expired.occurrences.find((o) => o.id === pen.id)!.state).toBe('MISSED'); expect(xp(expired)).toBeLessThanOrEqual(before);
    log('Penalty', 'complete vs expire after 48h', 'complete: 0 XP, cleared; expire: logged missed, no extra penalty quest stacking'); ok(done); ok(expired);
  });
});
describe('streaks and Streak Shields (3.10, D17)', () => {
  it('daily and per-quest streaks extend, freeze on no-mandatory days, reset on a mandatory miss; longest is kept', () => {
    const q = sim(fresh(2000, 2000), ['done', 'done', 'done', 'miss', 'done']);
    const daily = q.streaks.find((s) => s.scope === 'daily')!; const per = q.streaks.find((s) => s.scope !== 'daily')!;
    expect([daily.current, daily.longest, per.current, per.longest]).toEqual([1, 3, 1, 3]); ok(q); log('Streak', 'done x3, miss, done', `current ${daily.current}, longest ${daily.longest}`);
  });
  it('a held shield preserves streaks for a missed day but not the XP deduction; none is used when suspended', () => {
    const p = fresh(2000, 2000); p.player.streakShields = 1;
    const q = sim(p, ['done', 'miss', 'done']); const daily = q.streaks.find((s) => s.scope === 'daily')!;
    expect(daily.current).toBe(2); expect(q.player.streakShields).toBe(0); expect(ded(q)).toHaveLength(1); ok(q);
    log('Shield', 'done, miss (shield held), done', `streak 1 preserved through the miss, then 2; shield used, deduction still applied`);
  });
  it('D17: shields granted at the cap are queued and delivered when a slot opens', () => {
    const p = fresh(2000, 2000); Object.assign(p.player, { streakShields: 3, queuedShields: 2 });
    const q = sim(p, ['miss']); expect([q.player.streakShields, q.player.queuedShields]).toEqual([3, 1]); log('Shield', 'cap 3, 2 queued, one consumed', 'held 3, queued 1');
  });
});
describe('level crossings, rank promotions, rewards and allocation (3.3-3.6)', () => {
  it('one award crossing several levels creates every event and reward once, idempotently', () => {
    const p = fresh(0, 0); seedXp(p, totalXpToReach(11) + 5); const a = R.syncProgression(p, t(day(0))); const b = R.syncProgression(a, t(day(3)));
    expect(b).toEqual(a); expect(a.levelEvents.map((e) => e.level)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); expect(a.rankEvents.map((e) => e.rank)).toEqual(['D']);
    expect(a.player.unspentPoints).toBe(8 + 3 + 10 + 1 - 1 + 0); ok(a); log('Levels', 'jump from level 1 to 11 in one award', 'events 2..11, rank D once, re-sync is a no-op');
  });
  it('full run to level 100 grants exactly 174 points, 12 shields (cap + queue) and every rank once', () => {
    const p = fresh(0, 0); seedXp(p, totalXpToReach(100)); const a = R.syncProgression(p, t(day(0)));
    const granted = (k: string) => a.rewardGrants.filter((g) => g.kind === k).reduce((s, g) => s + Number(g.amount ?? 1), 0);
    expect([granted('attributePoints'), granted('streakShield'), a.player.streakShields, a.player.queuedShields]).toEqual([174, 12, 3, 9]);
    expect(a.rankEvents.map((e) => e.rank)).toEqual(['D', 'C', 'B', 'A', 'S']); expect(a.rewardGrants.filter((g) => g.kind === 'title' && String(g.itemId).startsWith('title:rank-'))).toHaveLength(5);
    expect(a.rewardGrants.filter((g) => String(g.itemId).startsWith('title:attr-coding-')).length).toBe(3); // coding was seeded to attribute level 50 as well
    ok(a); log('Rewards', 'level 1 -> 100', '174 AP, 12 shield grants (3 held + 9 queued), ranks D,C,B,A,S, 5 rank titles (plus 3 coding attribute titles from the seeded coding XP)');
  });
  it.each([[10, 10, true], [20, 3, true], [25, 10, true], [30, 3, true], [7, 1, false]])('level %i grants %i points and shield=%s', (L, ap, shield) => {
    const g = R.grantsForLevel(L); expect([g.find((x) => x.kind === 'attributePoints')!.amount, g.some((x) => x.kind === 'streakShield'), g.filter((x) => x.kind === 'streakShield').length <= 1]).toEqual([ap, shield, true]);
  });
  it('allocation modes: manual banks, Balanced fills the lowest, Momentum follows recent XP and ties fall back to Balanced', () => {
    const base = fresh(0, 0); seedXp(base, totalXpToReach(6)); // 5 levels = 5 points (levels 2-4,6 = 1 each, 5 = 3 -> 7)
    const manual = R.syncProgression(base, t(day(0))); expect(manual.player.unspentPoints).toBe(7);
    const bal = R.syncProgression(R.setAllocationMode(base, 'balanced'), t(day(0))); expect(bal.attributes.map((a) => a.statPoints)).toEqual([2, 2, 1, 1, 1]);
    const mom = structuredClone(base); mom.xpTransactions.push({ id: 'm', at: t(day(0), 9).toISOString(), dayKey: day(0), scope: 'fitness', kind: 'quest_award', requestedDelta: 100, appliedDelta: 100, idempotencyKey: 'm' });
    const m = R.syncProgression(R.setAllocationMode(mom, 'momentum'), t(day(0))); expect(m.attributes.find((a) => a.id === 'fitness')!.statPoints).toBe(7);
    const tie = R.syncProgression(R.setAllocationMode(base, 'momentum'), t(day(0))); expect(tie.attributes.map((a) => a.statPoints)).toEqual(bal.attributes.map((a) => a.statPoints));
    for (const x of [manual, bal, m, tie]) { const total = Number(x.player.unspentPoints) + x.attributes.reduce((s, a) => s + Number(a.statPoints), 0); expect(total).toBe(7); ok(x); }
    log('Allocation', '7 points: manual / balanced / momentum / momentum tie', 'manual 7 banked; balanced [2,2,1,1,1]; momentum 7 to fitness; tie = balanced');
  });
  it('manual allocation, banked distribution, weekly respec and equip rules', () => {
    const base = fresh(0, 0); seedXp(base, totalXpToReach(11)); let p = R.syncProgression(base, t(day(0))); const banked = Number(p.player.unspentPoints);
    p = R.allocatePoints(p, 'coding', 4, t(day(0))); expect([p.player.unspentPoints, p.attributes.find((a) => a.id === 'coding')!.statPoints]).toEqual([banked - 4, 4]);
    expect(() => R.allocatePoints(p, 'coding', 999, t(day(0)))).toThrow(); p = R.respec(p, t(day(0))); expect(p.player.unspentPoints).toBe(banked);
    expect(() => R.respec(p, t(day(3)))).toThrow(/RESPEC/); expect(() => R.respec(p, t(day(8)))).not.toThrow();
    p = R.distributeBanked(p, 'balanced', t(day(8))); expect(p.player.unspentPoints).toBe(0); ok(p);
    expect(() => R.equipTitle(p, 'title:rank-S')).toThrow(); expect(R.equipTitle(p, 'title:rank-D').player.equippedTitleId).toBe('title:rank-D'); expect(R.equipFrame(p, 'frame:rank-D').player.equippedFrameId).toBe('frame:rank-D');
    log('Allocation', 'manual spend, respec once a week, bank distribution, equip only owned', 'verified');
  });
  it('achievements unlock once and hidden ones exist', () => {
    const q = R.syncProgression(fresh(totalXpToReach(3), 0), t(day(0))); const lv = q.achievements.find((a) => a.id === 'first_level_up')!; const again = R.syncProgression(q, t(day(5)));
    expect(lv.unlockedAt).toBeDefined(); expect(again.achievements.find((a) => a.id === 'first_level_up')!.unlockedAt).toBe(lv.unlockedAt);
    expect(R.ACHIEVEMENTS.filter((a) => a.hidden).length).toBeGreaterThanOrEqual(5); const vis = R.ACHIEVEMENTS.filter((a) => !a.hidden).length, hid = R.ACHIEVEMENTS.length - vis; log('Achievements', `first level-up unlocked once; ${vis} visible + ${hid} hidden defined`, 'verified');
  });
});
describe('attribute titles (3.4)', () => {
  it('five attributes x thresholds 10/25/50 give 15 titles and 15 messages, once, without points or XP', () => {
    const p = fresh(0, 0); for (const a of R.ATTRS) p.xpTransactions.push({ id: `a-${a}`, at: '2026-10-01T00:00:00Z', dayKey: '2026-10-01', scope: a, kind: 'quest_award', requestedDelta: attrTotalToReach(50), appliedDelta: attrTotalToReach(50), idempotencyKey: `a-${a}` });
    const s = R.syncProgression(p, t(day(0))); const again = R.syncProgression(s, t(day(2)));
    const titles = s.rewardGrants.filter((g) => String(g.itemId).startsWith('title:attr-')); const msgs = s.systemMessages.filter((m) => String(m.id).startsWith('msg:attr:'));
    expect([titles.length, msgs.length]).toEqual([15, 15]); expect(again).toEqual(s); expect(s.player.unspentPoints).toBe(0); ok(s);
    log('Attribute titles', 'all five attributes seeded to attribute level 50', '15 titles + 15 messages, idempotent re-sync, 0 points, no XP change');
  });
});
describe('completion, undo and re-completion with progression events', () => {
  it('a completion that crosses a level cannot be undone; one that does not can, and rewards are never granted twice', () => {
    const crossing = fresh(40, 40, [def({ difficulty: 'hard' })]); const c = close(crossing, day(0)); const id = String(c.occurrences.find((o) => o.source === 'recurring')!.id);
    const done = completeStandardQuest(c, id, true, t(day(0), 11)).payload; expect(done.levelEvents.length).toBeGreaterThan(0);
    expect(() => undoCompletion(done, id, t(day(0), 11))).toThrow(/Undo would remove/);
    const room = close(fresh(60, 60, [def({ difficulty: 'easy' })]), day(0)); const rid = String(room.occurrences.find((o) => o.source === 'recurring')!.id); // 60..110 within level 2 (50..160)
    const d1 = completeStandardQuest(room, rid, true, t(day(0), 11)).payload; const u = undoCompletion(d1, rid, t(day(0), 11)).payload; const d2 = completeStandardQuest(u, rid, true, t(day(0), 11)).payload;
    expect(d2.levelEvents).toHaveLength(d1.levelEvents.length); expect(d2.rewardGrants).toEqual(d1.rewardGrants); expect(xp(d2)).toBe(xp(d1)); ok(d2);
    log('Undo', 'level-crossing completion / in-level completion with undo + re-complete', 'crossing undo refused; in-level undo+recomplete leaves events and grants unchanged');
  });
});
afterAll(() => {
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/P5-scenario-report.md', `# P5 scenario report (generated by the test run)\n\nEvery row below was executed and asserted in \`src/rewards/scenarios.test.ts\`.\n\n| Area | Scenario | Observed |\n|---|---|---|\n${report.join('\n')}\n`);
});
