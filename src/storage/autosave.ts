// P10 (optional, spec 6.5 / D15): auto-save a backup file to a location the player chose, on Chromium desktop only. Permission must be re-granted each browser session.
import { exportBackupText } from '../app/actions';
import { clearHandle, loadHandle, saveHandle } from '../audio/media';
import type { SlsDb } from '../persist/store';

export interface Writable { write(d: string): Promise<void>; close(): Promise<void> }
export interface FileHandleLike { name?: string; queryPermission?(o: { mode: 'readwrite' }): Promise<string>; requestPermission?(o: { mode: 'readwrite' }): Promise<string>; createWritable(): Promise<Writable> }
type W = Window & { showSaveFilePicker?: (o: unknown) => Promise<FileHandleLike> };
export const autosaveSupported = (w: Window = window) => typeof (w as W).showSaveFilePicker === 'function';
export const KEY = 'sls-autosave-day';
export async function chooseAutosaveFile(w: Window = window): Promise<FileHandleLike> {
  const h = await (w as W).showSaveFilePicker!({ suggestedName: 'system-backup.json', types: [{ description: 'System backup', accept: { 'application/json': ['.json'] } }] }); await saveHandle(h); return h;
}
export const loadAutosaveHandle = async () => ((await loadHandle()) as FileHandleLike | null);
export const forgetAutosave = () => clearHandle();
export async function permissionOf(h: FileHandleLike, request = false): Promise<'granted' | 'prompt' | 'denied'> {
  try { let p = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'prompt'; if (p !== 'granted' && request) p = (await h.requestPermission?.({ mode: 'readwrite' })) ?? p; return p as 'granted' | 'prompt' | 'denied'; } catch { return 'denied'; }
}
export async function writeBackup(db: SlsDb, h: FileHandleLike, now = new Date()): Promise<'saved' | 'permission' | 'failed'> {
  try { if ((await permissionOf(h)) !== 'granted') return 'permission'; const text = await exportBackupText(db, now); const w = await h.createWritable(); await w.write(text); await w.close(); return 'saved'; } catch { return 'failed'; }
}
/** At most one automatic save per game day, and only when permission is already granted (never prompts by itself). */
export async function autosaveIfDue(db: SlsDb, h: FileHandleLike | null, dayKey: string, now = new Date(), store: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {
  if (!h) return 'none' as const; try { if (store.getItem(KEY) === dayKey) return 'skipped' as const; } catch { /* storage unavailable: just save */ }
  const r = await writeBackup(db, h, now); if (r === 'saved') { try { store.setItem(KEY, dayKey); } catch { /* ignore */ } } return r;
}
