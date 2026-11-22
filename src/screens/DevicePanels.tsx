import { useEffect, useState } from 'react';
import { exportBackupText, importBackupText, previewBackup, setReminderDays, type BackupPreview } from '../app/actions';
import { clearHandle } from '../audio/media';
import type { Payload } from '../persist/backup';
import type { SlsDb } from '../persist/store';
import { promptInstall, resetAppCache, usePwa } from '../pwa/state';
import { autosaveSupported, chooseAutosaveFile, forgetAutosave, loadAutosaveHandle, permissionOf, writeBackup, type FileHandleLike } from '../storage/autosave';
import { formatBytes, readStorageStatus, requestPersistence, type StorageStatus } from '../storage/status';
import { Field, Panel } from '../ui/components';
import type { useAction } from './shared';

type Run = ReturnType<typeof useAction>['run'];
const when = (iso: unknown) => (iso ? new Date(String(iso)).toLocaleString() : 'never');

export function BackupPanel({ db, payload, run, busy }: { db: SlsDb; payload: Payload; run: Run; busy: boolean }) {
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<BackupPreview | { ok: false; code: string; message: string } | null>(null); const [confirm, setConfirm] = useState(false);
  const [handle, setHandle] = useState<FileHandleLike | null>(null); const [perm, setPerm] = useState(''); const days = Number(payload.settings.backupReminderDays) || 7;
  useEffect(() => { if (autosaveSupported()) void loadAutosaveHandle().then(async (h) => { setHandle(h); if (h) setPerm(await permissionOf(h)); }).catch(() => undefined); }, []);
  const download = () => run('BACKUP EXPORTED', 'Backup file downloaded. Keep it somewhere safe: it is the only protection against cleared browser data.', async () => {
    const text = await exportBackupText(db, new Date()); const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `system-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const choose = async (f: File | null) => { setFile(f); setConfirm(false); setPreview(null); if (f) { try { setPreview(await previewBackup(await f.text())); } catch (e) { setPreview({ ok: false, code: 'unreadable', message: e instanceof Error ? e.message : String(e) }); } } };
  const doImport = () => { if (!file || !confirm || !preview?.ok) return; return run('BACKUP IMPORTED', (r: string[]) => `Backup restored. ${r.length ? `Repaired: ${r.join('; ')}` : 'All data validated.'} A snapshot of your previous data was kept.`, async () => {
    const r = await importBackupText(db, await file.text(), new Date()); if (!r.ok) throw new Error(`Import refused (${r.code}): ${r.message}. Your current data was not changed.`); setFile(null); setPreview(null); setConfirm(false); return r.warnings ?? [];
  }); };
  return (
    <Panel title="Backup">
      <p className="hint">Last export: {when(payload.meta.lastExportAt)}. Your data lives only in this browser; clearing site data deletes it. Export regularly and keep the file somewhere safe.</p>
      <button type="button" className="btn btn--primary" disabled={busy} onClick={download}>Export backup</button>
      <Field id="reminder-days" label="Remind me to export every" hint="A reminder also appears after a rank promotion.">{(p) => <select {...p} value={days} onChange={(e) => run('REMINDER SAVED', `Reminders every ${e.target.value} days.`, () => setReminderDays(db, Number(e.target.value) as 3 | 7 | 14 | 30))}>{[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}</select>}</Field>
      <Field id="import-file" label="Import a backup file" hint="Replaces all current data after validation. A snapshot of the current data is kept first. Days between the backup and now (up to 3) are not penalised.">
        {(p) => <input type="file" accept="application/json,.json" {...p} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />}</Field>
      {preview && !preview.ok && <p className="error" role="alert">Import refused ({preview.code}): {preview.message}. Your current data was not changed.</p>}
      {preview?.ok && <dl aria-label="Backup preview"><dt>Player</dt><dd>{preview.name}: rank {preview.rank}, level {preview.level}, {preview.totalXp} XP</dd><dt>Last game day</dt><dd>{preview.lastDay || 'none yet'}</dd><dt>Contents</dt><dd>{preview.quests} recurring quests, {preview.days} recorded days, {preview.ledger} ledger entries</dd><dt>Exported</dt><dd>{when(preview.exportedAt)} by version {preview.appVersion}</dd></dl>}
      <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I understand this replaces my current data</label>
      <button type="button" className="btn" disabled={busy || !file || !confirm || !preview?.ok} onClick={doImport}>Import backup</button>
      {autosaveSupported() && (
        <>
          <h3>Automatic backup file (Chrome and Edge on desktop)</h3>
          <p className="hint">Saves a backup to a file you choose once per game day. The browser asks for permission again each session; nothing is ever sent anywhere.</p>
          {handle ? <p>Auto-save file: {handle.name ?? 'chosen'} ({perm === 'granted' ? 'permission granted this session' : 'permission needed this session'})</p> : <p className="hint">No auto-save file chosen.</p>}
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn" disabled={busy} onClick={() => run('AUTO-SAVE FILE CHOSEN', 'Backups will be saved there once per game day.', async () => { const h = await chooseAutosaveFile(); setHandle(h); setPerm(await permissionOf(h, true)); })}>{handle ? 'Choose a different file' : 'Choose auto-save file'}</button>
            {handle && <button type="button" className="btn" disabled={busy} onClick={() => run('AUTO-SAVE READY', 'Saved now.', async () => { setPerm(await permissionOf(handle, true)); const r = await writeBackup(db, handle); if (r !== 'saved') throw new Error(r === 'permission' ? 'Permission was not granted.' : 'The file could not be written.'); })}>Allow and save now</button>}
            {handle && <button type="button" className="btn" disabled={busy} onClick={() => run('AUTO-SAVE OFF', 'Auto-save file forgotten.', async () => { await forgetAutosave(); await clearHandle().catch(() => undefined); setHandle(null); setPerm(''); })}>Stop auto-save</button>}
          </div>
        </>
      )}
    </Panel>
  );
}
export function StoragePanel({ run, busy }: { run: Run; busy: boolean }) {
  const [s, setS] = useState<StorageStatus | null>(null); const load = () => readStorageStatus().then(setS).catch(() => setS({ available: false, persisted: null, usage: null, quota: null }));
  useEffect(() => { void load(); }, []);
  return (
    <Panel title="Storage status">
      {!s ? <p className="hint" role="status">Checking storage</p> : !s.available ? <p>Storage status is not available in this browser. Your data is still saved, but the browser may clear it; export backups regularly.</p> : (<>
        <p>Persistent storage: <strong>{s.persisted === null ? 'unknown' : s.persisted ? 'granted' : 'not granted'}</strong>{s.persisted === false ? ' (the browser may clear data when space is low)' : ''}</p>
        <p>Used: {formatBytes(s.usage)} of about {formatBytes(s.quota)} available to this site.</p>
        {s.persisted === false && <button type="button" className="btn" disabled={busy} onClick={() => run('STORAGE REQUEST', (g: boolean | null) => (g ? 'Persistent storage granted.' : 'The browser did not grant persistent storage. Export backups regularly.'), async () => { const g = await requestPersistence(); await load(); return g; })}>Request persistent storage</button>}
      </>)}
    </Panel>
  );
}
export function InstallPanel({ run, busy }: { run: Run; busy: boolean }) {
  const pwa = usePwa();
  return (
    <Panel title="Install and offline">
      <p>{pwa.installed ? 'Running as an installed app.' : 'Running in the browser.'} Offline start: <strong>{pwa.registered ? 'ready' : 'not available yet'}</strong>. Everything except installing and updating works without a network.</p>
      {pwa.canInstall && <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run('INSTALL', (r: string) => (r === 'accepted' ? 'Installing.' : 'Install cancelled.'), promptInstall)}>Install app</button>}
      <ul>
        <li>Chrome or Edge on Windows, Mac, Linux: use the install icon in the address bar, or the browser menu, then Install.</li>
        <li>Chrome on Android: menu, then Install app (or Add to Home screen).</li>
        <li>Safari on iPhone or iPad (iOS 16.4 or later): Share, then Add to Home Screen.</li>
      </ul>
      <p className="hint">Installing does not move your data anywhere: it stays in this browser profile. Updates keep your data.</p>
      <button type="button" className="btn" disabled={busy} onClick={() => run('APP CACHE RESET', (r: { workers: number; caches: number }) => `Removed ${r.workers} service worker(s) and ${r.caches} cache(s). Your data was not touched. Reloading.`, async () => { const r = await resetAppCache(); setTimeout(() => window.location.reload(), 600); return r; })}>Reset app cache (keeps your data)</button>
    </Panel>
  );
}
