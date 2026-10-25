// Player Awakening model (spec 2.1): seven steps, each skippable to defaults. Pure and testable.
import type { QuestDefinition } from '../quests/domain';

export const ATTR_KEYS = ['academics', 'fitness', 'coding', 'discipline', 'recovery'] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export const STEPS = ['awakening', 'player', 'attributes', 'quests', 'reset', 'rules', 'confirm'] as const;
export type StepId = (typeof STEPS)[number];
export const SKIPPABLE: readonly StepId[] = ['player', 'attributes', 'quests', 'reset', 'rules'];
export const DEFAULT_NAME = 'Player';
export const DEFAULT_RESET = '04:00';
export interface CustomQuest { title: string; category: AttrKey; difficulty: 'easy' | 'medium' | 'hard'; mandatory: boolean }
export interface Draft {
  step: number; name: string; title: string; goals: Record<AttrKey, string>; starters: string[]; custom: CustomQuest[];
  timezone: string; resetTime: string; effects: 'full' | 'reduced' | 'minimal'; musicEnabled: boolean; allocationMode: 'manual' | 'balanced' | 'momentum';
}
export const STARTERS: { id: string; label: string; def: Omit<QuestDefinition, 'schedule'> }[] = [
  { id: 'study', label: 'Study session (60 min, timed)', def: { title: 'Study session', category: 'academics', kind: 'timed', targetBlocks: 4, mandatory: true, important: false } },
  { id: 'workout', label: 'Workout', def: { title: 'Workout', category: 'fitness', kind: 'standard', difficulty: 'medium', mandatory: true, important: false } },
  { id: 'code', label: 'Coding practice (60 min, timed)', def: { title: 'Coding practice', category: 'coding', kind: 'timed', targetBlocks: 4, mandatory: true, important: false } },
  { id: 'plan', label: 'Plan tomorrow', def: { title: 'Plan tomorrow', category: 'discipline', kind: 'standard', difficulty: 'easy', mandatory: false, important: false } },
  { id: 'sleep', label: 'Sleep 7+ hours', def: { title: 'Sleep 7+ hours', category: 'recovery', kind: 'standard', difficulty: 'medium', mandatory: false, important: false } },
];
export const isValidTimezone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz.trim().length > 0; } catch { return false; } };
export const isValidReset = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export function defaultDraft(env: { timezone?: string; reducedMotion?: boolean } = {}): Draft {
  const tz = env.timezone && isValidTimezone(env.timezone) ? env.timezone : 'UTC';
  return { step: 0, name: '', title: '', goals: { academics: '', fitness: '', coding: '', discipline: '', recovery: '' }, starters: [], custom: [],
    timezone: tz, resetTime: DEFAULT_RESET, effects: env.reducedMotion ? 'reduced' : 'full', musicEnabled: false, allocationMode: 'manual' };
}
export type Errors = Record<string, string>;
/** Validation for the step being left. Skipping a skippable step bypasses it and restores that step's defaults. */
export function validateStep(step: StepId, d: Draft): Errors {
  const e: Errors = {};
  if (step === 'player') {
    if (d.name.trim().length > 24) e.name = 'Name must be 24 characters or fewer.';
    if (/[\u0000-\u001f]/.test(d.name)) e.name = 'Name contains invalid characters.';
    if (d.title.trim().length > 32) e.title = 'Title must be 32 characters or fewer.';
  }
  if (step === 'attributes') for (const k of ATTR_KEYS) if (d.goals[k].length > 80) e[`goal-${k}`] = 'Goal must be 80 characters or fewer.';
  if (step === 'quests') d.custom.forEach((c, i) => { if (!c.title.trim() || c.title.length > 60) e[`custom-${i}`] = 'Quest title must be 1 to 60 characters.'; });
  if (step === 'reset') {
    if (!isValidTimezone(d.timezone)) e.timezone = 'Enter a valid timezone, for example Asia/Kolkata.';
    if (!isValidReset(d.resetTime)) e.resetTime = 'Enter a time as HH:MM, for example 04:00.';
  }
  return e;
}
export function skipStep(step: StepId, d: Draft, base: Draft): Draft {
  const next = { ...d };
  if (step === 'player') Object.assign(next, { name: '', title: '' });
  if (step === 'attributes') next.goals = { ...base.goals };
  if (step === 'quests') Object.assign(next, { starters: [], custom: [] });
  if (step === 'reset') Object.assign(next, { timezone: base.timezone, resetTime: DEFAULT_RESET });
  if (step === 'rules') Object.assign(next, { effects: base.effects, musicEnabled: false, allocationMode: 'manual' as const });
  return next;
}
export const effectiveName = (d: Draft) => d.name.trim() || DEFAULT_NAME;
export function definitionsFor(d: Draft): QuestDefinition[] {
  const daily = { type: 'daily' as const };
  return [...STARTERS.filter((s) => d.starters.includes(s.id)).map((s) => ({ ...s.def, schedule: daily })),
    ...d.custom.map((c): QuestDefinition => ({ title: c.title.trim(), category: c.category, kind: 'standard', difficulty: c.difficulty, mandatory: c.mandatory, important: false, schedule: daily }))];
}
// ---- draft persistence (non-critical convenience; a failure only loses onboarding progress) ----
export const DRAFT_KEY = 'sls-onboarding-draft-v1';
export function loadDraft(storage: Pick<Storage, 'getItem'> | undefined, fallback: Draft): Draft {
  try {
    const raw = storage?.getItem(DRAFT_KEY); if (!raw) return fallback;
    const o = JSON.parse(raw) as Partial<Draft>; const d = { ...fallback, ...o, goals: { ...fallback.goals, ...(o.goals ?? {}) } };
    if (!Number.isInteger(d.step) || d.step < 0 || d.step >= STEPS.length || !Array.isArray(d.starters) || !Array.isArray(d.custom)) return fallback;
    return d;
  } catch { return fallback; }
}
export function saveDraft(storage: Pick<Storage, 'setItem'> | undefined, d: Draft) { try { storage?.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ } }
export function clearDraft(storage: Pick<Storage, 'removeItem'> | undefined) { try { storage?.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
