import { useState } from 'react';
import { addRest, changeReset, exportBackupText, importBackupText, removeRest, setMode, todayKey, updatePreferences, updateProfile, validateName } from '../app/actions';
import { isValidReset, isValidTimezone } from '../onboarding/model';
import { SCHEMA_VERSION } from '../persist/backup';
import { WEEKDAYS } from './questForm';
import type { AllocationMode } from '../rewards/rewards';
import { SELF_REPORT_NOTICE } from '../timer/text';
import { Field, Panel, SystemMessage } from '../ui/components';
import { Feedback, useAction, type ScreenProps } from './shared';

export function SettingsScreen({ db, payload, refresh }: ScreenProps) {
  const { run, busy, msg } = useAction(refresh);
  const s = payload.settings as Record<string, unknown>;
  const [name, setName] = useState(String(payload.player.name ?? '')); const [title, setTitle] = useState(String(payload.player.startingTitle ?? ''));
  const [tz, setTz] = useState(String(s.timezone ?? 'UTC')); const [reset, setReset] = useState(String(s.resetTime ?? '04:00'));
  const [weekday, setWeekday] = useState('0'); const [restDay, setRestDay] = useState('');
  const [effects, setEffects] = useState((s.effects as 'full' | 'reduced' | 'minimal') ?? 'full'); const [music, setMusic] = useState(Boolean((s.audio as { musicEnabled?: boolean } | undefined)?.musicEnabled));
  const [file, setFile] = useState<File | null>(null); const [confirmImport, setConfirmImport] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const mode = (['balanced', 'momentum'].includes(String(payload.player.allocationMode)) ? payload.player.allocationMode : 'manual') as AllocationMode;
  const today = todayKey(payload, new Date());
  const rests = payload.restDays as unknown as { id: string; kind: string; weekday?: number; dayKey?: string }[];
  const lastExport = payload.meta.lastExportAt ? new Date(String(payload.meta.lastExportAt)).toLocaleString() : 'never';

  const saveProfile = () => { const e = validateName(name); setErrs({ ...errs, name: e ?? '' }); if (!e) void run('PROFILE SAVED', 'Profile updated.', () => updateProfile(db, name, title)); };
  const saveReset = () => {
    const e: Record<string, string> = { ...errs, timezone: isValidTimezone(tz) ? '' : 'Enter a valid timezone, for example Asia/Kolkata.', resetTime: isValidReset(reset) ? '' : 'Enter a time as HH:MM.' }; setErrs(e);
    if (!e.timezone && !e.resetTime) void run('GAME DAY UPDATED', 'The new reset policy applies from the next game day. Today is unchanged.', () => changeReset(db, tz, reset, new Date()));
  };
  const download = async () => {
    await run('BACKUP EXPORTED', 'Backup file downloaded. Keep it somewhere safe: it is the only protection against cleared browser data.', async () => {
      const text = await exportBackupText(db, new Date()); const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `system-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  const doImport = async () => {
    if (!file || !confirmImport) return;
    await run('BACKUP IMPORTED', (r: string[]) => `Backup restored. ${r.length ? `Repaired: ${r.join('; ')}` : 'All data validated.'}`, async () => {
      const r = await importBackupText(db, await file.text(), new Date()); if (!r.ok) throw new Error(`Import refused (${r.code}): ${r.message}. Your current data was not changed.`);
      setFile(null); setConfirmImport(false); return r.warnings ?? [];
    });
  };
  return (
    <>
      <Feedback msg={msg} />
      <Panel title="Player profile">
        <Field id="set-name" label="Player name" error={errs.name}>{(p) => <input type="text" {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field id="set-title" label="Starting title (optional)">{(p) => <input type="text" {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={saveProfile}>Save profile</button>
      </Panel>
      <Panel title="Game day">
        <p className="hint">Today is game day {today}. A change applies from the next game day; history and today's quests are never rewritten.</p>
        <Field id="set-tz" label="Timezone" hint="IANA name, for example Asia/Kolkata." error={errs.timezone}>{(p) => <input type="text" {...p} value={tz} onChange={(e) => setTz(e.target.value)} />}</Field>
        <Field id="set-reset" label="Daily reset time" error={errs.resetTime}>{(p) => <input type="time" {...p} value={reset} onChange={(e) => setReset(e.target.value)} />}</Field>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={saveReset}>Save game day</button>
      </Panel>
      <Panel title="Protected rest days">
        <p className="hint">Quests on a rest day are exempt from penalties and streaks freeze. One recurring weekday, plus up to two dates per calendar month, declared before that game day begins.</p>
        {rests.length === 0 ? <p className="hint">No rest days configured.</p> : <ul aria-label="Rest days">{rests.map((r) => <li key={r.id}>{r.kind === 'recurring' ? `Every ${WEEKDAYS[r.weekday ?? 0]}` : r.dayKey}{' '}<button type="button" className="btn" disabled={busy} onClick={() => run('REST DAY REMOVED', 'Rest day removed.', () => removeRest(db, r.id))}>Remove rest day {r.kind === 'recurring' ? WEEKDAYS[r.weekday ?? 0] : r.dayKey}</button></li>)}</ul>}
        <Field id="rest-weekday" label="Recurring rest weekday">{(p) => <select {...p} value={weekday} onChange={(e) => setWeekday(e.target.value)}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>}</Field>
        <button type="button" className="btn" disabled={busy} onClick={() => run('REST DAY ADDED', 'Recurring rest weekday saved.', () => addRest(db, { kind: 'recurring', weekday: Number(weekday) }, new Date()))}>Set recurring rest day</button>
        <Field id="rest-date" label="One-off rest date">{(p) => <input type="date" {...p} value={restDay} onChange={(e) => setRestDay(e.target.value)} />}</Field>
        <button type="button" className="btn" disabled={busy || !restDay} onClick={() => run('REST DAY ADDED', `${restDay} is a protected rest day.`, () => addRest(db, { kind: 'adhoc', dayKey: restDay }, new Date()))}>Add rest date</button>
      </Panel>
      <Panel title="Progression and effects">
        <Field id="set-mode" label="Attribute-point allocation mode">{(p) => <select {...p} value={mode} onChange={(e) => run('MODE CHANGED', `Allocation mode is now ${e.target.value}.`, () => setMode(db, e.target.value as AllocationMode))}><option value="manual">Manual</option><option value="balanced">Balanced</option><option value="momentum">Momentum</option></select>}</Field>
        <Field id="set-effects" label="Effects" hint="Reduced and Minimal remove motion and glow.">{(p) => <select {...p} value={effects} onChange={(e) => setEffects(e.target.value as typeof effects)}><option value="full">Full</option><option value="reduced">Reduced</option><option value="minimal">Minimal</option></select>}</Field>
        <label className="check"><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />Allow ambient music (preference only; audio arrives in a later phase)</label>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run('PREFERENCES SAVED', 'Preferences saved.', async () => { await updatePreferences(db, effects, music); document.documentElement.dataset.effects = effects; })}>Save preferences</button>
      </Panel>
      <Panel title="Fixed rules">
        <p>Penalties: <strong>Strict</strong>. Timers: elapsed time from timestamps; a gap over 10 minutes asks how much counts. {SELF_REPORT_NOTICE} The specification does not make these configurable.</p>
      </Panel>
      <Panel title="Backup">
        <p className="hint">Last export: {lastExport}. Data lives only in this browser; clearing site data deletes it. Export regularly.</p>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={download}>Export backup</button>
        <Field id="import-file" label="Import a backup file" hint="Replaces all current data after validation. A snapshot of the current data is kept first.">{(p) => <input type="file" accept="application/json,.json" {...p} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
        <label className="check"><input type="checkbox" checked={confirmImport} onChange={(e) => setConfirmImport(e.target.checked)} />I understand this replaces my current data</label>
        <button type="button" className="btn" disabled={busy || !file || !confirmImport} onClick={doImport}>Import backup</button>
      </Panel>
      <Panel title="About">
        <p>SYSTEM version {__APP_VERSION__} · data schema {SCHEMA_VERSION} · Specification v1.0 (frozen)</p>
        <SystemMessage title="NOT YET IMPLEMENTED">Backup reminders, storage status and device checks arrive in a later phase.</SystemMessage>
      </Panel>
    </>
  );
}
