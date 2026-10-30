import { useEffect, useState } from 'react';
import { addRest, changeReset, exportBackupText, importBackupText, removeRest, setMode, todayKey, updatePreferences, updateProfile, validateName } from '../app/actions';
import { isValidReset, isValidTimezone } from '../onboarding/model';
import { SCHEMA_VERSION } from '../persist/backup';
import { WEEKDAYS } from './questForm';
import type { AllocationMode } from '../rewards/rewards';
import { SELF_REPORT_NOTICE } from '../timer/text';
import { Field, Panel, SystemMessage } from '../ui/components';
import { Feedback, useAction, type ScreenProps } from './shared';
import { audio, applyMusicSource, prefsFromSettings } from '../audio';
import { clearMusicFile, saveMusicFile, validateMusicFile } from '../audio/media';
import { updateAudioSettings } from '../app/actions';

export function SettingsScreen({ db, payload, refresh }: ScreenProps) {
  const { run, busy, msg } = useAction(refresh);
  const s = payload.settings as Record<string, unknown>;
  const [name, setName] = useState(String(payload.player.name ?? '')); const [title, setTitle] = useState(String(payload.player.startingTitle ?? ''));
  const [tz, setTz] = useState(String(s.timezone ?? 'UTC')); const [reset, setReset] = useState(String(s.resetTime ?? '04:00'));
  const [weekday, setWeekday] = useState('0'); const [restDay, setRestDay] = useState('');
  const [effects, setEffects] = useState((s.effects as 'full' | 'reduced' | 'minimal') ?? 'full'); const saved = prefsFromSettings(s); const sa = (s.audio ?? {}) as { musicSource?: 'generated' | 'file'; musicFileName?: string };
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
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run('PREFERENCES SAVED', 'Preferences saved.', async () => { await updatePreferences(db, effects, saved.musicEnabled); document.documentElement.dataset.effects = effects; })}>Save preferences</button>
      </Panel>
      <SoundPanel db={db} saved={saved} source={sa.musicSource ?? 'generated'} fileName={sa.musicFileName} run={run} busy={busy} />
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

type Run = ReturnType<typeof useAction>['run'];
function SoundPanel({ db, saved, source, fileName, run, busy }: { db: ScreenProps['db']; saved: ReturnType<typeof prefsFromSettings>; source: 'generated' | 'file'; fileName?: string; run: Run; busy: boolean }) {
  const [master, setMaster] = useState(Math.round(saved.master * 100)); const [sfx, setSfx] = useState(Math.round(saved.sfx * 100)); const [music, setMusic] = useState(Math.round(saved.music * 100));
  const [muted, setMuted] = useState(saved.muted); const [allowed, setAllowed] = useState(saved.musicEnabled); const [src, setSrc] = useState(source); const [name, setName] = useState(fileName);
  const [note, setNote] = useState(''); const [playing, setPlaying] = useState(audio.musicPlaying);
  useEffect(() => audio.subscribe(() => setPlaying(audio.musicPlaying)), []);
  const preview = (p: Partial<{ master: number; sfx: number; music: number; muted: boolean }>) => audio.configure({ master: (p.master ?? master) / 100, sfx: (p.sfx ?? sfx) / 100, music: (p.music ?? music) / 100, muted: p.muted ?? muted });
  const values = () => ({ master: master / 100, sfx: sfx / 100, music: music / 100, muted, musicEnabled: allowed, musicSource: src, musicFileName: src === 'file' ? name : undefined });
  const save = (title: string, text: string, v = values()) => run(title, text, () => updateAudioSettings(db, v));
  const slider = (id: string, label: string, v: number, set: (n: number) => void, key: 'master' | 'sfx' | 'music') => (
    <div className="field"><label htmlFor={id}>{label}: {v}%</label><input id={id} type="range" min={0} max={100} step={5} value={v} onChange={(e) => { const n = Number(e.target.value); set(n); preview({ [key]: n }); }} style={{ minHeight: 44, width: '100%' }} /></div>);
  return (
    <Panel title="Sound and music">
      <p className="hint">Sounds are generated on your device. Nothing plays until you interact with the app, and sound is never the only way information is shown.</p>
      <label className="check"><input type="checkbox" checked={muted} onChange={(e) => { setMuted(e.target.checked); preview({ muted: e.target.checked }); }} />Mute all sound</label>
      {slider('vol-master', 'Master volume', master, setMaster, 'master')}{slider('vol-sfx', 'Sound effects volume', sfx, setSfx, 'sfx')}{slider('vol-music', 'Music volume', music, setMusic, 'music')}
      <label className="check"><input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />Allow ambient music (it starts only when you press Play music)</label>
      <Field id="music-source" label="Music source" hint="The generated loop is original and needs no file. Your own file stays on this device and is not included in backups.">
        {(p) => <select {...p} value={src} onChange={(e) => setSrc(e.target.value as 'generated' | 'file')}><option value="generated">Generated ambient loop</option><option value="file" disabled={!name}>My music file{name ? ` (${name})` : ' (none chosen)'}</option></select>}</Field>
      <Field id="music-file" label="Choose a music file (up to 10 MB)" error={note}>{(p) => <input type="file" accept="audio/*" {...p} onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return; const bad = validateMusicFile(f); if (bad) { setNote(bad); return; } setNote('');
        await run('MUSIC FILE SAVED', 'Saved on this device only.', async () => { await saveMusicFile(f); await applyMusicSource('file'); setName(f.name); setSrc('file'); await updateAudioSettings(db, { ...values(), musicSource: 'file', musicFileName: f.name }); });
      }} />}</Field>
      {name && <button type="button" className="btn" disabled={busy} onClick={() => run('MUSIC FILE REMOVED', 'The generated loop is used again.', async () => { await clearMusicFile(); await applyMusicSource('generated'); setName(undefined); setSrc('generated'); await updateAudioSettings(db, { ...values(), musicSource: 'generated', musicFileName: undefined }); })}>Remove my music file</button>}
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn" onClick={() => { audio.unlock(); audio.configure({ master: master / 100, sfx: sfx / 100, music: music / 100, muted, musicEnabled: allowed }); if (!audio.play('confirm')) setNote(muted ? 'Sound is muted.' : 'No sound could be played (sound may be muted, at 0%, or unavailable in this browser).'); else setNote(''); }}>Play test sound</button>
        <button type="button" className="btn" aria-pressed={playing} data-silent="true" onClick={() => { audio.unlock(); audio.configure({ musicEnabled: allowed }); if (playing) audio.stopMusic(); else if (!audio.startMusic()) setNote(allowed ? 'Music could not start in this browser.' : 'Tick "Allow ambient music" first.'); }}>{playing ? 'Stop music' : 'Play music'}</button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => save('SOUND SETTINGS SAVED', 'Sound settings saved.')}>Save sound settings</button>
      </div>
    </Panel>
  );
}
