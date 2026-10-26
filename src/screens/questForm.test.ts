import { describe, expect, it } from 'vitest';
import { buildFromForm, emptyForm, formFromDefinition, scheduleLabel, validateForm } from './questForm';

const today = '2026-10-20';
describe('quest form model', () => {
  it('validates title, blocks, schedule, times and deadlines', () => {
    expect(validateForm(emptyForm(), today).title).toMatch(/title/i);
    expect(validateForm({ ...emptyForm(), title: 'x'.repeat(61) }, today).title).toMatch(/60/);
    expect(validateForm({ ...emptyForm(), title: 'T', kind: 'timed', blocks: 9, repeat: 'daily' }, today).blocks).toBeDefined();
    expect(validateForm({ ...emptyForm(), title: 'T', kind: 'timed', repeat: 'once' }, today).timedOnce).toMatch(/must repeat/);
    expect(validateForm({ ...emptyForm(), title: 'T', repeat: 'weekdays' }, today).days).toBeDefined();
    expect(validateForm({ ...emptyForm(), title: 'T', repeat: 'everyNDays', n: '0' }, today).n).toBeDefined();
    expect(validateForm({ ...emptyForm(), title: 'T', deadlineTime: '25:00' }, today).deadlineTime).toBeDefined();
    expect(validateForm({ ...emptyForm(), title: 'T', onceDeadlineDay: '2026-10-19' }, today).onceDeadlineDay).toBeDefined();
    expect(validateForm({ ...emptyForm(), title: 'T' }, today)).toEqual({});
  });
  it('builds one-off and recurring definitions the domain accepts, implying mandatory from important', () => {
    expect(buildFromForm({ ...emptyForm(), title: ' Read ' }, today)).toEqual({ kind: 'oneoff', input: { title: 'Read', category: 'discipline', difficulty: 'easy', mandatory: false, important: false } });
    const r = buildFromForm({ ...emptyForm(), title: 'Run', repeat: 'weekdays', days: [5, 1], important: true, deadlineTime: '18:30', difficulty: 'hard', category: 'fitness' }, today);
    expect(r).toMatchObject({ kind: 'recurring', def: { kind: 'standard', difficulty: 'hard', mandatory: true, important: true, deadlineTime: '18:30', schedule: { type: 'weekdays', days: [1, 5] } } });
    expect(buildFromForm({ ...emptyForm(), title: 'Focus', kind: 'timed', blocks: 4, repeat: 'everyNDays', n: '3' }, today)).toMatchObject({ def: { kind: 'timed', targetBlocks: 4, schedule: { type: 'everyNDays', n: 3, anchorDayKey: today } } });
  });
  it('round-trips a definition through the form', () => {
    const def = { title: 'A', category: 'coding' as const, kind: 'timed' as const, targetBlocks: 3, mandatory: true, important: false, schedule: { type: 'weekly' as const } };
    const f = formFromDefinition(def); expect(f).toMatchObject({ kind: 'timed', blocks: 3, repeat: 'weekly' }); expect(scheduleLabel(def.schedule)).toBe('Weekly');
  });
});
