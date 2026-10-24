import { describe, expect, it } from 'vitest';
import * as P from './progression';

// Approved reference values from Spec v1.0 section 3.2 to 3.4.
const NEED: Record<number, [number, number]> = {
  1: [50, 0], 2: [110, 50], 3: [190, 160], 5: [340, 610], 9: [700, 2510], 10: [790, 3210], 15: [1290, 8160],
  20: [1820, 15650], 25: [2380, 25860], 30: [2960, 38910], 40: [4180, 73960], 45: [4820, 96130], 50: [5470, 121530],
  60: [6800, 182180], 70: [8190, 256410], 80: [9610, 344660], 90: [11070, 447280], 100: [12560, 564650],
};
describe('Player Level curve (3.2)', () => {
  it.each(Object.entries(NEED))('level %s matches approved values', (L, [need, total]) => {
    expect(P.needPlayer(+L)).toBe(need);
    expect(P.totalXpToReach(+L)).toBe(total);
  });
  it('full 1-100 table is complete and strictly increasing', () => {
    const t = P.levelTable(100);
    expect(t).toHaveLength(100);
    t.forEach((r, i) => i && expect(r.need).toBeGreaterThan(t[i - 1]!.need));
  });
  it('levelFromXp inverts totalXpToReach', () => {
    for (let L = 1; L <= 120; L++) {
      expect(P.levelFromXp(P.totalXpToReach(L))).toBe(L);
      expect(P.levelFromXp(P.totalXpToReach(L + 1) - 1)).toBe(L);
    }
  });
});
describe('Ranks and pacing (3.3)', () => {
  it('rank thresholds and totals', () => {
    expect(P.RANKS.map((r) => [r.rank, P.totalXpToReach(r.level)])).toEqual(
      [['E', 0], ['D', 3210], ['C', 25860], ['B', 96130], ['A', 256410], ['S', 564650]]);
    expect([1, 9, 10, 24, 25, 44, 45, 69, 70, 99, 100, 150].map(P.rankForLevel))
      .toEqual(['E', 'E', 'D', 'D', 'C', 'C', 'B', 'B', 'A', 'A', 'S', 'S']);
  });
  it('days to rank at 300/400/500 XP/day', () => {
    const days = (xp: number) => [10, 25, 45, 70, 100].map((l) => Math.round(P.totalXpToReach(l) / xp));
    expect(days(300)).toEqual([11, 86, 320, 855, 1882]);
    expect(days(400)).toEqual([8, 65, 240, 641, 1412]);
    expect(days(500)).toEqual([6, 52, 192, 513, 1129]);
  });
});
describe('Attribute curve (3.4)', () => {
  it('matches approved table and caps at 50', () => {
    expect([1, 5, 10].map(P.needAttr)).toEqual([40, 300, 710]);
    expect([5, 10, 20, 30, 40, 50].map(P.attrTotalToReach)).toEqual([530, 2830, 14210, 36060, 69540, 115530]);
    expect(P.attrLevelFromXp(10_000_000)).toBe(50);
  });
});
describe('Quest XP and timed rules (3.1, 3.9)', () => {
  it('difficulty XP', () => expect(Object.values(P.DIFFICULTY_XP)).toEqual([50, 100, 200]));
  it('timed XP: full blocks only, capped at 200', () => {
    expect(P.timedBlocks(14 * 60_000 + 59_000)).toBe(0);
    expect(P.timedBlocks(30 * 60_000)).toBe(2);
    expect(P.timedXp(8, 8)).toBe(200);
    expect(P.timedXp(12, 12)).toBe(200);
    expect(P.timedXp(5, 3)).toBe(75);
  });
});
describe('Deductions (3.7)', () => {
  it('rates by tier', () => {
    expect([P.deductionFor(50, 'easy'), P.deductionFor(100, 'medium'), P.deductionFor(200, 'hard')]).toEqual([13, 25, 80]);
    expect([1, 2, 3, 5, 6, 8].map(P.timedTier)).toEqual(['easy', 'easy', 'medium', 'medium', 'hard', 'hard']);
    expect(P.deductionFor(200, 'hard', 100)).toBe(40); // partial: unearned half only
  });
  it('is floored at the current level start and never de-levels', () => {
    const total = P.totalXpToReach(10) + 30;
    expect(P.applyDeduction(total, 80)).toEqual({ requested: 80, applied: 30, newTotal: P.totalXpToReach(10) });
    for (let xp = 0; xp < 5000; xp += 7) {
      const r = P.applyDeduction(xp, 1e9);
      expect(r.newTotal).toBeGreaterThanOrEqual(0);
      expect(P.levelFromXp(r.newTotal)).toBe(P.levelFromXp(xp));
    }
  });
});
describe('Rewards (3.5, 3.6)', () => {
  const lv = Array.from({ length: 99 }, (_, i) => P.rewardsForLevel(i + 2));
  it('attribute points total 174 (79 + 45 + 50)', () => {
    expect(lv.reduce((s, r) => s + r.attributePoints, 0)).toBe(174);
    expect(lv.filter((r) => r.attributePoints === 1)).toHaveLength(79);
    expect(lv.filter((r) => r.attributePoints === 3)).toHaveLength(15);
    expect(lv.filter((r) => r.attributePoints === 10).map((r) => r.level)).toEqual([10, 25, 45, 70, 100]);
  });
  it('exactly 12 shield levels, one shield each', () => {
    expect(lv.filter((r) => r.streakShield).map((r) => r.level)).toEqual([10, 20, 25, 30, 40, 45, 50, 60, 70, 80, 90, 100]);
  });
  it('rank levels get no separate cosmetic drop; level 20 stacks non-AP rewards', () => {
    expect(P.rewardsForLevel(10).cosmeticDrop).toBe(false);
    expect(P.rewardsForLevel(20)).toMatchObject({ attributePoints: 3, cosmeticDrop: true, streakShield: true, titleOrBadge: true });
    expect(() => P.rewardsForLevel(1)).toThrow();
  });
});
describe('D17 shield queue', () => {
  it('queues at the cap and delivers when a slot opens', () => {
    let s: P.Shields = { held: 0, queued: 0 };
    for (let i = 0; i < 5; i++) s = P.grantShield(s);
    expect(s).toEqual({ held: 3, queued: 2 });
    s = P.consumeShield(s);
    expect(s).toEqual({ held: 3, queued: 1 });
    s = P.consumeShield(s);
    expect(s).toEqual({ held: 3, queued: 0 });
    expect(P.consumeShield(s)).toEqual({ held: 2, queued: 0 });
    expect(P.consumeShield({ held: 0, queued: 0 })).toEqual({ held: 0, queued: 0 });
  });
});
