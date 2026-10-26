import { useEffect, useMemo, useRef, useState } from 'react';
import { Field, Panel, SystemMessage } from '../ui/components';
import { ATTR_KEYS, STARTERS, STEPS, SKIPPABLE, clearDraft, defaultDraft, definitionsFor, effectiveName, loadDraft, saveDraft, skipStep, validateStep,
  type AttrKey, type CustomQuest, type Draft, type Errors, type StepId } from './model';
import { OnboardingError, registerPlayer } from './register';
import type { SlsDb } from '../persist/store';
import { SELF_REPORT_NOTICE } from '../timer/text';

const safeStorage = () => { try { return window.localStorage; } catch { return undefined; } };
const TITLES: Record<StepId, string> = { awakening: 'Awakening', player: 'Player registration', attributes: 'Attributes', quests: 'Recurring quests', reset: 'Daily reset', rules: 'System rules', confirm: 'Confirmation' };
const CATEGORY_LABEL: Record<AttrKey, string> = { academics: 'Academics', fitness: 'Fitness', coding: 'Coding', discipline: 'Discipline', recovery: 'Recovery' };

export function Onboarding({ db, onRegistered, now = () => new Date(), storage = safeStorage() }: { db: SlsDb; onRegistered: () => void; now?: () => Date; storage?: Storage }) {
  const base = useMemo(() => defaultDraft({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches }), []);
  const [draft, setDraft] = useState<Draft>(() => loadDraft(storage, base));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [done, setDone] = useState<{ quests: number; generated: number } | null>(null);
  const [custom, setCustom] = useState<CustomQuest>({ title: '', category: 'discipline', difficulty: 'easy', mandatory: false });
  const [customError, setCustomError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const step = STEPS[draft.step]!;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => { if (!done) saveDraft(storage, draft); }, [draft, done, storage]);
  useEffect(() => { document.documentElement.dataset.effects = draft.effects; }, [draft.effects]);
  useEffect(() => { if (first.current) { first.current = false; return; } heading.current?.focus(); }, [draft.step, done]);

  const go = (n: number) => { setErrors({}); setFailure(''); set({ step: Math.max(0, Math.min(STEPS.length - 1, n)) }); };
  const next = () => { const e = validateStep(step, draft); setErrors(e); if (Object.keys(e).length === 0) go(draft.step + 1); };
  const skip = () => { setDraft((d) => ({ ...skipStep(step, d, base), step: d.step + 1 })); setErrors({}); };
  async function register() {
    if (busy) return; setBusy(true); setFailure('');
    try { setDone(await registerPlayer(db, draft, now())); clearDraft(storage); }
    catch (err) { if (err instanceof OnboardingError) { clearDraft(storage); onRegistered(); return; } setFailure(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  const addCustom = () => {
    if (!custom.title.trim() || custom.title.length > 60) { setCustomError('Quest title must be 1 to 60 characters.'); return; }
    if (draft.custom.length >= 10) { setCustomError('Up to 10 custom quests.'); return; }
    setCustomError(''); set({ custom: [...draft.custom, { ...custom, title: custom.title.trim() }] }); setCustom({ ...custom, title: '' });
  };

  if (done) return (
    <main id="main" className="shell__main" tabIndex={-1}>
      <h1 ref={heading} tabIndex={-1}>System</h1>
      <Panel title="Registration complete" enter>
        <SystemMessage title="PLAYER REGISTERED" kind="ok">Welcome, {effectiveName(draft)}.</SystemMessage>
        {done.generated > 0
          ? <SystemMessage title="DAILY QUEST UPDATED">{done.generated} quest{done.generated === 1 ? '' : 's'} generated for today from {done.quests} recurring quest{done.quests === 1 ? '' : 's'}.</SystemMessage>
          : <SystemMessage title="NO QUESTS YET">You have no quests yet. Create your first quest on the Quests screen.</SystemMessage>}
        <div className="actions"><button type="button" className="btn btn--primary" onClick={onRegistered}>Enter the System</button></div>
      </Panel>
    </main>
  );
  return (
    <main id="main" className="shell__main" tabIndex={-1}>
      <h1>Player Awakening</h1>
      <ol className="progress-dots" aria-label={`Step ${draft.step + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => <li key={s} aria-current={i === draft.step ? 'step' : undefined}><span className="sr-only">{s}</span></li>)}
      </ol>
      <Panel title={`${draft.step + 1}. ${TITLES[step]}`} enter>
        <h2 className="sr-only" ref={heading} tabIndex={-1}>{TITLES[step]}</h2>
        {step === 'awakening' && (<>
          <SystemMessage title="PLAYER DETECTED">The System has chosen you. Real effort becomes quests, quests become levels.</SystemMessage>
          <p className="hint">Seven short steps. Every step except this one can be skipped to defaults.</p>
        </>)}
        {step === 'player' && (<>
          <Field id="name" label="Player name" hint={`Leave empty to be called "Player". Up to 24 characters.`} error={errors.name}>{(p) => <input type="text" {...p} value={draft.name} autoComplete="nickname" onChange={(e) => set({ name: e.target.value })} />}</Field>
          <Field id="title" label="Starting title (optional)" error={errors.title}>{(p) => <input type="text" {...p} value={draft.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
        </>)}
        {step === 'attributes' && (<>
          <p className="hint">Five attributes, each with its own XP and level. A one-line goal is optional.</p>
          {ATTR_KEYS.map((k) => (
            <Field key={k} id={`goal-${k}`} label={`${CATEGORY_LABEL[k]} goal (optional)`} error={errors[`goal-${k}`]}>{(p) => <input type="text" {...p} value={draft.goals[k]} onChange={(e) => set({ goals: { ...draft.goals, [k]: e.target.value } })} />}</Field>
          ))}
        </>)}
        {step === 'quests' && (<>
          <fieldset className="checks"><legend>Starter daily quests</legend>
            {STARTERS.map((s) => (
              <label key={s.id} className="check"><input type="checkbox" checked={draft.starters.includes(s.id)}
                onChange={(e) => set({ starters: e.target.checked ? [...draft.starters, s.id] : draft.starters.filter((x) => x !== s.id) })} />{s.label}{s.def.mandatory ? ' (mandatory)' : ''}</label>
            ))}
          </fieldset>
          <h3>Your own quest</h3>
          <Field id="custom-title" label="Quest title" error={customError}>{(p) => <input type="text" {...p} value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value })} />}</Field>
          <Field id="custom-category" label="Category">{(p) => <select {...p} value={custom.category} onChange={(e) => setCustom({ ...custom, category: e.target.value as AttrKey })}>{ATTR_KEYS.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}</select>}</Field>
          <Field id="custom-difficulty" label="Difficulty">{(p) => <select {...p} value={custom.difficulty} onChange={(e) => setCustom({ ...custom, difficulty: e.target.value as CustomQuest['difficulty'] })}><option value="easy">Easy (50 XP)</option><option value="medium">Medium (100 XP)</option><option value="hard">Hard (200 XP)</option></select>}</Field>
          <label className="check"><input type="checkbox" checked={custom.mandatory} onChange={(e) => setCustom({ ...custom, mandatory: e.target.checked })} />Mandatory (missing it has consequences)</label>
          <button type="button" className="btn" onClick={addCustom}>Add quest</button>
          {draft.custom.length > 0 && (
            <ul aria-label="Your quests">{draft.custom.map((c, i) => (
              <li key={`${c.title}-${i}`}>{c.title} ({CATEGORY_LABEL[c.category]}, {c.difficulty}{c.mandatory ? ', mandatory' : ''}){' '}
                <button type="button" className="btn" onClick={() => set({ custom: draft.custom.filter((_, j) => j !== i) })} aria-label={`Remove ${c.title}`}>Remove</button></li>
            ))}</ul>
          )}
        </>)}
        {step === 'reset' && (<>
          <Field id="timezone" label="Timezone" hint="IANA name, for example Asia/Kolkata. The System follows this timezone, not the device's." error={errors.timezone}>
            {(p) => <input type="text" {...p} list="tz-list" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} />}</Field>
          <datalist id="tz-list">{(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []).map((z) => <option key={z} value={z} />)}</datalist>
          <Field id="reset" label="Daily reset time" hint="A new game day starts at this time. Default 04:00." error={errors.resetTime}>{(p) => <input type="time" {...p} value={draft.resetTime} onChange={(e) => set({ resetTime: e.target.value })} />}</Field>
        </>)}
        {step === 'rules' && (<>
          <p>Penalties: <strong>Strict</strong> (fixed). Missing a mandatory quest forfeits its XP and applies a bounded deduction; levels are never lost.</p>
          <p>Timers: elapsed time is measured from timestamps. If more than 10 minutes pass with no activity signal, you are asked how much counts. {SELF_REPORT_NOTICE}</p>
          <Field id="effects" label="Effects" hint="Reduced and Minimal remove motion and glow.">{(p) => <select {...p} value={draft.effects} onChange={(e) => set({ effects: e.target.value as Draft['effects'] })}><option value="full">Full</option><option value="reduced">Reduced</option><option value="minimal">Minimal</option></select>}</Field>
          <label className="check"><input type="checkbox" checked={draft.musicEnabled} onChange={(e) => set({ musicEnabled: e.target.checked })} />Allow ambient music (nothing plays until you start it)</label>
          <Field id="alloc" label="Attribute-point allocation" hint="Manual banks points for you to spend. Balanced and Momentum allocate automatically.">{(p) => <select {...p} value={draft.allocationMode} onChange={(e) => set({ allocationMode: e.target.value as Draft['allocationMode'] })}><option value="manual">Manual</option><option value="balanced">Balanced</option><option value="momentum">Momentum</option></select>}</Field>
        </>)}
        {step === 'confirm' && (<>
          <SystemMessage title="READY TO REGISTER">Review, then confirm.</SystemMessage>
          <dl>
            <dt>Player</dt><dd>{effectiveName(draft)}{draft.title.trim() ? `, ${draft.title.trim()}` : ''}</dd>
            <dt>Daily quests</dt><dd>{definitionsFor(draft).length}</dd>
            <dt>Daily reset</dt><dd>{draft.resetTime} ({draft.timezone})</dd>
            <dt>Effects / allocation</dt><dd>{draft.effects} / {draft.allocationMode}</dd>
          </dl>
          {failure && <p className="error" role="alert">Registration failed: {failure}</p>}
        </>)}
        <div className="actions">
          {draft.step > 0 ? <button type="button" className="btn" onClick={() => go(draft.step - 1)}>Back</button> : <span />}
          <span>
            {SKIPPABLE.includes(step) && <button type="button" className="btn" onClick={skip}>Skip (use defaults)</button>}{' '}
            {step === 'confirm'
              ? <button type="button" className="btn btn--primary" onClick={register} disabled={busy}>{busy ? 'Registering' : 'Confirm registration'}</button>
              : <button type="button" className="btn btn--primary" onClick={next}>{step === 'awakening' ? 'Begin' : 'Continue'}</button>}
          </span>
        </div>
      </Panel>
    </main>
  );
}
