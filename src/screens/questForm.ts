// Pure form model for quest creation/editing (validation mirrors the domain rules; the domain layer re-validates on save).
import type { AttributeKey, Difficulty, OneOffInput, QuestDefinition, QuestSchedule } from '../quests/domain';
export type Repeat = 'once' | 'daily' | 'weekdays' | 'weekly' | 'everyNDays';
export interface FormState {
  title: string; category: AttributeKey; kind: 'standard' | 'timed'; difficulty: Difficulty; blocks: number; mandatory: boolean; important: boolean;
  deadlineTime: string; repeat: Repeat; days: number[]; n: string; onceDeadlineDay: string;
}
export const ATTRS: AttributeKey[] = ['academics', 'fitness', 'coding', 'discipline', 'recovery'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const emptyForm = (): FormState => ({ title: '', category: 'discipline', kind: 'standard', difficulty: 'easy', blocks: 4, mandatory: false, important: false, deadlineTime: '', repeat: 'once', days: [], n: '2', onceDeadlineDay: '' });
export function formFromDefinition(d: QuestDefinition): FormState {
  const s = d.schedule;
  return { ...emptyForm(), title: d.title, category: d.category, kind: d.kind, difficulty: d.difficulty ?? 'easy', blocks: d.targetBlocks ?? 4, mandatory: d.mandatory, important: d.important,
    deadlineTime: d.deadlineTime ?? '', repeat: s.type === 'daily' ? 'daily' : s.type, days: s.type === 'weekdays' ? s.days : [], n: s.type === 'everyNDays' ? String(s.n) : '2' };
}
export type Errors = Partial<Record<'title' | 'blocks' | 'days' | 'n' | 'deadlineTime' | 'onceDeadlineDay' | 'timedOnce', string>>;
export function validateForm(f: FormState, today: string): Errors {
  const e: Errors = {};
  if (!f.title.trim()) e.title = 'Enter a quest title.'; else if (f.title.trim().length > 60) e.title = 'Title must be 60 characters or fewer.';
  if (f.kind === 'timed') {
    if (!Number.isInteger(f.blocks) || f.blocks < 1 || f.blocks > 8) e.blocks = 'Timed quests need 1 to 8 blocks of 15 minutes.';
    if (f.repeat === 'once') e.timedOnce = 'Timed quests must repeat: choose a schedule other than "once".';
  }
  if (f.repeat === 'weekdays' && f.days.length === 0) e.days = 'Choose at least one weekday.';
  if (f.repeat === 'everyNDays' && !(Number.isInteger(Number(f.n)) && Number(f.n) >= 1 && Number(f.n) <= 365)) e.n = 'Enter a whole number of days from 1 to 365.';
  if (f.deadlineTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.deadlineTime)) e.deadlineTime = 'Use the format HH:MM.';
  if (f.repeat === 'once' && f.onceDeadlineDay && (!/^\d{4}-\d{2}-\d{2}$/.test(f.onceDeadlineDay) || f.onceDeadlineDay < today)) e.onceDeadlineDay = 'The deadline date cannot be before today.';
  return e;
}
export type Built = { kind: 'recurring'; def: QuestDefinition } | { kind: 'oneoff'; input: OneOffInput };
export function buildFromForm(f: FormState, today: string): Built {
  const important = f.important, mandatory = f.mandatory || important;
  if (f.repeat === 'once') return { kind: 'oneoff', input: { title: f.title.trim(), category: f.category, difficulty: f.difficulty, mandatory, important,
    ...(f.onceDeadlineDay ? { deadlineDayKey: f.onceDeadlineDay } : {}), ...(f.deadlineTime ? { deadlineTime: f.deadlineTime } : {}) } };
  const schedule: QuestSchedule = f.repeat === 'daily' ? { type: 'daily' } : f.repeat === 'weekly' ? { type: 'weekly' }
    : f.repeat === 'weekdays' ? { type: 'weekdays', days: [...f.days].sort((a, b) => a - b) } : { type: 'everyNDays', n: Number(f.n), anchorDayKey: today };
  const base = { title: f.title.trim(), category: f.category, mandatory, important, schedule, ...(f.deadlineTime ? { deadlineTime: f.deadlineTime } : {}) };
  return { kind: 'recurring', def: f.kind === 'timed' ? { ...base, kind: 'timed', targetBlocks: f.blocks } : { ...base, kind: 'standard', difficulty: f.difficulty } };
}
export const scheduleLabel = (s: QuestSchedule) => s.type === 'daily' ? 'Daily' : s.type === 'weekly' ? 'Weekly' : s.type === 'weekdays' ? s.days.map((d) => WEEKDAYS[d]!.slice(0, 3)).join(', ') : `Every ${s.n} days`;
