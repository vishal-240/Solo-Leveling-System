import { useState } from 'react';
import { Field } from '../ui/components';
import { ATTRS, WEEKDAYS, buildFromForm, emptyForm, validateForm, type Built, type FormState, type Repeat } from './questForm';

const LABEL: Record<string, string> = { academics: 'Academics', fitness: 'Fitness', coding: 'Coding', discipline: 'Discipline', recovery: 'Recovery' };
export function QuestForm({ today, initial, mode, onSubmit, onCancel, busy }: { today: string; initial?: FormState; mode: 'create' | 'edit'; onSubmit: (b: Built) => Promise<boolean>; onCancel?: () => void; busy: boolean }) {
  const [f, setF] = useState<FormState>(initial ?? { ...emptyForm(), repeat: mode === 'edit' ? 'daily' : 'once' });
  const [advanced, setAdvanced] = useState(mode === 'edit'); const [errors, setErrors] = useState<ReturnType<typeof validateForm>>({});
  const set = (p: Partial<FormState>) => setF((s) => ({ ...s, ...p }));
  const submit = async () => {
    const e = validateForm(f, today); setErrors(e); if (Object.keys(e).length) return;
    if (await onSubmit(buildFromForm(f, today)) && mode === 'create') { setF({ ...emptyForm(), repeat: f.repeat }); setErrors({}); }
  };
  const id = mode === 'edit' ? 'edit' : 'new';
  return (
    <div>
      {mode === 'create' && <div role="group" aria-label="Creation mode" className="actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn" aria-pressed={!advanced} onClick={() => setAdvanced(false)}>Quick</button>
        <button type="button" className="btn" aria-pressed={advanced} onClick={() => setAdvanced(true)}>Advanced</button></div>}
      <Field id={`${id}-title`} label="Quest title" error={errors.title}>{(p) => <input type="text" {...p} value={f.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
      <Field id={`${id}-category`} label="Category">{(p) => <select {...p} value={f.category} onChange={(e) => set({ category: e.target.value as FormState['category'] })}>{ATTRS.map((a) => <option key={a} value={a}>{LABEL[a]}</option>)}</select>}</Field>
      {advanced && <Field id={`${id}-kind`} label="Type" hint="Timed quests use the built-in timer: 25 XP per full 15-minute block (up to 200).">{(p) => <select {...p} value={f.kind} onChange={(e) => set({ kind: e.target.value as FormState['kind'], repeat: e.target.value === 'timed' && f.repeat === 'once' ? 'daily' : f.repeat })}><option value="standard">Standard (difficulty)</option><option value="timed">Timed (blocks)</option></select>}</Field>}
      {f.kind === 'timed'
        ? <Field id={`${id}-blocks`} label="Target blocks (15 minutes each)" error={errors.blocks}>{(p) => <input type="number" min={1} max={8} {...p} value={f.blocks} onChange={(e) => set({ blocks: Number(e.target.value) })} />}</Field>
        : <Field id={`${id}-difficulty`} label="Difficulty">{(p) => <select {...p} value={f.difficulty} onChange={(e) => set({ difficulty: e.target.value as FormState['difficulty'] })}><option value="easy">Easy (50 XP)</option><option value="medium">Medium (100 XP)</option><option value="hard">Hard (200 XP)</option></select>}</Field>}
      <label className="check"><input type="checkbox" checked={f.repeat !== 'once'} onChange={(e) => set({ repeat: e.target.checked ? 'daily' : 'once' })} disabled={f.kind === 'timed' || (mode === 'edit')} />Repeat</label>
      {errors.timedOnce && <span className="error" role="alert">{errors.timedOnce}</span>}
      {advanced && f.repeat !== 'once' && <Field id={`${id}-repeat`} label="Schedule">{(p) => <select {...p} value={f.repeat} onChange={(e) => set({ repeat: e.target.value as Repeat })}><option value="daily">Daily</option><option value="weekdays">Selected weekdays</option><option value="weekly">Weekly</option><option value="everyNDays">Every N days</option></select>}</Field>}
      {advanced && f.repeat === 'weekdays' && <fieldset className="checks"><legend>Weekdays</legend>{WEEKDAYS.map((d, i) => <label key={d} className="check"><input type="checkbox" checked={f.days.includes(i)} onChange={(e) => set({ days: e.target.checked ? [...f.days, i] : f.days.filter((x) => x !== i) })} />{d}</label>)}{errors.days && <span className="error" role="alert">{errors.days}</span>}</fieldset>}
      {advanced && f.repeat === 'everyNDays' && <Field id={`${id}-n`} label="Repeat every N days" error={errors.n}>{(p) => <input type="text" inputMode="numeric" {...p} value={f.n} onChange={(e) => set({ n: e.target.value })} />}</Field>}
      {advanced && <>
        <label className="check"><input type="checkbox" checked={f.mandatory || f.important} disabled={f.important} onChange={(e) => set({ mandatory: e.target.checked })} />Mandatory (missing it has consequences)</label>
        <label className="check"><input type="checkbox" checked={f.important} onChange={(e) => set({ important: e.target.checked, mandatory: e.target.checked ? true : f.mandatory })} />Important (implies mandatory; a miss triggers a penalty quest)</label>
        <Field id={`${id}-deadline`} label="Deadline time (optional)" hint="Informational: a quest stays completable until the game day ends." error={errors.deadlineTime}>{(p) => <input type="time" {...p} value={f.deadlineTime} onChange={(e) => set({ deadlineTime: e.target.value })} />}</Field>
        {f.repeat === 'once' && <Field id={`${id}-once`} label="Deadline date (optional, one-off only)" error={errors.onceDeadlineDay}>{(p) => <input type="date" {...p} value={f.onceDeadlineDay} onChange={(e) => set({ onceDeadlineDay: e.target.value })} />}</Field>}
      </>}
      {mode === 'edit' && <p className="hint">Changes apply from tomorrow. Today's generated quest stays as it is.</p>}
      <div className="actions"><span>{onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}</span>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={submit}>{mode === 'edit' ? 'Save changes' : 'Create quest'}</button></div>
    </div>
  );
}
