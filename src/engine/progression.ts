// Pure domain engine for Spec v1.0 (FROZEN). No I/O, no clock. Section refs are to the spec.
export type Rank = 'E' | 'D' | 'C' | 'B' | 'A' | 'S';
export type Tier = 'easy' | 'medium' | 'hard';

export const PLAYER_COEFFICIENT = 50; // 3.2 (frozen)
export const ATTR_COEFFICIENT = 40; // 3.4
export const ATTR_CAP = 50;
export const RANKS: readonly { rank: Rank; level: number }[] = [
  { rank: 'E', level: 1 }, { rank: 'D', level: 10 }, { rank: 'C', level: 25 },
  { rank: 'B', level: 45 }, { rank: 'A', level: 70 }, { rank: 'S', level: 100 },
]; // 3.3
const RANK_LEVELS = new Set([10, 25, 45, 70, 100]);

const round10 = (x: number) => Math.round(x / 10) * 10;

/** XP to advance from level L to L+1 (3.2). */
export const needPlayer = (L: number) => Math.max(10, round10(PLAYER_COEFFICIENT * L ** 1.2));
/** Cumulative XP required to reach level L. */
export function totalXpToReach(L: number): number {
  let t = 0;
  for (let l = 1; l < L; l++) t += needPlayer(l);
  return t;
}
export function levelFromXp(xp: number): number {
  let L = 1, t = 0;
  while (t + needPlayer(L) <= xp) { t += needPlayer(L); L++; }
  return L;
}
export function rankForLevel(L: number): Rank {
  let r: Rank = 'E';
  for (const x of RANKS) if (L >= x.level) r = x.rank;
  return r;
}
export function levelTable(max = 100) {
  return Array.from({ length: max }, (_, i) => ({ level: i + 1, need: needPlayer(i + 1), total: totalXpToReach(i + 1) }));
}

/** Attribute curve (3.4), level cap 50. */
export const needAttr = (L: number) => Math.max(10, round10(ATTR_COEFFICIENT * L ** 1.25));
export function attrTotalToReach(L: number): number {
  let t = 0;
  for (let l = 1; l < L; l++) t += needAttr(l);
  return t;
}
export function attrLevelFromXp(xp: number): number {
  let L = 1, t = 0;
  while (L < ATTR_CAP && t + needAttr(L) <= xp) { t += needAttr(L); L++; }
  return L;
}

/** Quest XP (3.1). */
export const DIFFICULTY_XP: Record<Tier, number> = { easy: 50, medium: 100, hard: 200 };
export const BLOCK_MS = 15 * 60 * 1000;
export const MAX_BLOCKS = 8;
export const timedBlocks = (activeMs: number) => Math.floor(Math.max(0, activeMs) / BLOCK_MS);
/** 25 XP per full block, never above the target or the 200 XP cap (3.1, 3.9). */
export const timedXp = (blocks: number, targetBlocks: number) =>
  25 * Math.max(0, Math.min(blocks, targetBlocks, MAX_BLOCKS));

/** Deductions (3.7). Rate by penalty tier; timed quests map by target blocks. */
export const DEDUCTION_RATE: Record<Tier, number> = { easy: 0.25, medium: 0.25, hard: 0.4 };
export const timedTier = (targetBlocks: number): Tier => (targetBlocks <= 2 ? 'easy' : targetBlocks <= 5 ? 'medium' : 'hard');
export const deductionFor = (potentialXp: number, tier: Tier, earnedXp = 0) =>
  Math.round(DEDUCTION_RATE[tier] * Math.max(0, potentialXp - earnedXp)); // partial: unearned fraction only (3.9)
/** Floored at the start of the current level: never negative, never de-levels (3.7). */
export function applyDeduction(totalXp: number, requested: number) {
  const floor = totalXpToReach(levelFromXp(totalXp));
  const applied = Math.max(0, Math.min(requested, totalXp - floor));
  return { requested, applied, newTotal: totalXp - applied };
}

/** Level-up rewards (3.5, 3.6): one attribute-point value per level, at most one shield per level. */
export function rewardsForLevel(L: number) {
  if (L < 2) throw new RangeError('Level 1 is the starting level and grants nothing');
  const rank = RANK_LEVELS.has(L);
  const fifth = L % 5 === 0;
  return {
    level: L,
    attributePoints: rank ? 10 : fifth ? 3 : 1,
    levelMark: true,
    cosmeticDrop: fifth && !rank, // rank levels get the rank frame instead
    rankPromotion: rank,
    streakShield: L % 10 === 0 || rank, // boolean: never more than one
    titleOrBadge: L % 10 === 0 || rank,
  };
}

/** D17: shields earned at the cap of 3 are queued and delivered when a slot opens. */
export const MAX_SHIELDS = 3;
export interface Shields { held: number; queued: number }
export const grantShield = (s: Shields): Shields =>
  s.held < MAX_SHIELDS ? { held: s.held + 1, queued: s.queued } : { held: s.held, queued: s.queued + 1 };
export const consumeShield = (s: Shields): Shields => {
  if (s.held < 1) return s;
  return s.queued > 0 ? { held: s.held, queued: s.queued - 1 } : { held: s.held - 1, queued: 0 };
};
