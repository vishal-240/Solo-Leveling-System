import { useState } from 'react';
import { importBackupText, previewBackup, type BackupPreview } from '../app/actions';
import type { SlsDb } from '../persist/store';
import { describeStorageError } from '../storage/status';
import { Field } from '../ui/components';

/** Restore path for a new or wiped browser: pick a backup file, see what it contains, then restore. Nothing is replaced because there is no data yet. */
export function RestorePanel({ db, onRestored }: { db: SlsDb; onRestored: () => void }) {
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<BackupPreview | { ok: false; code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const choose = async (f: File | null) => { setFile(f); setPreview(null); setError(''); if (f) { try { setPreview(await previewBackup(await f.text())); } catch (e) { setPreview({ ok: false, code: 'unreadable', message: e instanceof Error ? e.message : String(e) }); } } };
  const restore = async () => {
    if (!file || !preview?.ok || busy) return; setBusy(true); setError('');
    try { const r = await importBackupText(db, await file.text(), new Date()); if (!r.ok) setError(`Restore refused (${r.code}): ${r.message}. Nothing was changed.`); else onRestored(); } catch (e) { setError(describeStorageError(e)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="restore-title">
      <h3 id="restore-title">Already have a backup?</h3>
      <p className="hint">Restore your progress from a backup file exported earlier, for example after moving to a new device or clearing browser data.</p>
      <Field id="restore-file" label="Choose a backup file">{(p) => <input type="file" accept="application/json,.json" {...p} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />}</Field>
      {preview && !preview.ok && <p className="error" role="alert">Restore refused ({preview.code}): {preview.message}. Nothing was changed.</p>}
      {preview?.ok && <dl aria-label="Backup preview"><dt>Player</dt><dd>{preview.name}: rank {preview.rank}, level {preview.level}, {preview.totalXp} XP</dd><dt>Contents</dt><dd>{preview.quests} recurring quests, {preview.days} recorded days, {preview.ledger} ledger entries</dd></dl>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn" disabled={!preview?.ok || busy} onClick={restore}>Restore this backup</button>
    </section>
  );
}
