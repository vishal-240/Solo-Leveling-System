import { describe, expect, it, vi } from 'vitest';
import type { Payload } from '../persist/backup';
import { createRegisteredPayload } from '../quests/dayClose';
import { autosaveIfDue, writeBackup, type FileHandleLike } from './autosave';
import { reminderState } from './reminders';
import { describeStorageError, formatBytes, readStorageStatus, requestPersistence } from './status';

vi.mock('../app/actions', () => ({ exportBackupText: async () => '{"backup":true}' }));
describe('storage status', () => {
  it('reads persistence and usage, and degrades cleanly when unsupported or failing', async () => {
    expect(await readStorageStatus({ storage: { persisted: async () => true, estimate: async () => ({ usage: 2048, quota: 5e9 }) } } as unknown as Navigator)).toEqual({ available: true, persisted: true, usage: 2048, quota: 5e9 });
    expect(await readStorageStatus({} as Navigator)).toEqual({ available: false, persisted: null, usage: null, quota: null });
    expect(await readStorageStatus({ storage: { persisted: async () => { throw new Error('x'); }, estimate: async () => { throw new Error('y'); } } } as unknown as Navigator)).toEqual({ available: true, persisted: null, usage: null, quota: null });
    expect(await requestPersistence({ storage: { persist: async () => false } } as unknown as Navigator)).toBe(false); expect(await requestPersistence({} as Navigator)).toBeNull();
    expect([formatBytes(null), formatBytes(512), formatBytes(2048), formatBytes(5 * 1024 ** 2), formatBytes(3 * 1024 ** 3)]).toEqual(['unknown', '512 B', '2.0 KB', '5.0 MB', '3.0 GB']);
  });
  it('turns storage failures into actionable messages', () => {
    const q = Object.assign(new Error('x'), { name: 'QuotaExceededError' }); expect(describeStorageError(q)).toMatch(/Storage is full.*not saved.*Export a backup/); expect(describeStorageError(new Error('QuotaExceeded: quota'))).toMatch(/Storage is full/);
    expect(describeStorageError(Object.assign(new Error('x'), { name: 'InvalidStateError' }))).toMatch(/not allowing the app to store data/); expect(describeStorageError(Object.assign(new Error('x'), { name: 'SecurityError' }))).toMatch(/Nothing was saved/);
    expect(describeStorageError(new Error('Database is newer than this app'))).toMatch(/newer version/); expect(describeStorageError(new Error('plain'))).toBe('plain'); expect(describeStorageError('str')).toBe('str');
  });
});
const base = (over: (p: Payload) => void = () => undefined): Payload => { const p = createRegisteredPayload('V', 'UTC', '04:00'); p.player.createdAt = '2026-10-01T00:00:00.000Z'; over(p); return p; };
const D = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 12));
describe('backup reminders', () => {
  it('is due only after the configured interval since the last export (or registration)', () => {
    expect(reminderState(base(), D(6)).due).toBe(false); expect(reminderState(base(), D(8))).toMatchObject({ due: true, reason: 'interval', days: 7, lastExportAt: null });
    expect(reminderState(base((p) => { p.settings.backupReminderDays = 30; }), D(20)).due).toBe(false); expect(reminderState(base((p) => { p.settings.backupReminderDays = 3; }), D(5)).due).toBe(true);
    expect(reminderState(base((p) => { p.meta.lastExportAt = D(10).toISOString(); }), D(15)).due).toBe(false); expect(reminderState(base((p) => { p.meta.lastExportAt = D(10).toISOString(); }), D(19))).toMatchObject({ due: true, ageDays: 9 });
    expect(reminderState(base((p) => { p.settings.backupReminderDays = 99; }), D(8)).days).toBe(7);
  });
  it('is also due after a rank promotion that is newer than the last export, and clears once exported', () => {
    const rank = (p: Payload) => { p.rankEvents.push({ id: 'rank:D', rank: 'D', level: 10, at: D(2).toISOString() }); };
    expect(reminderState(base(rank), D(3))).toMatchObject({ due: true, reason: 'rank' }); expect(reminderState(base((p) => { rank(p); p.meta.lastExportAt = D(2.5).toISOString(); }), D(3)).due).toBe(false);
  });
  it('stays quiet while snoozed and does not guess without a baseline', () => {
    expect(reminderState(base((p) => { p.meta.reminderSnoozedUntil = D(9).toISOString(); }), D(8)).due).toBe(false); expect(reminderState(base((p) => { p.meta.reminderSnoozedUntil = D(9).toISOString(); }), D(10)).due).toBe(true);
    expect(reminderState(base((p) => { delete p.player.createdAt; }), D(400))).toMatchObject({ due: false, reason: null });
  });
});
describe('optional auto-save file (Chromium only)', () => {
  const handle = (perm: string, fail = false) => { const writes: string[] = []; const h: FileHandleLike = { name: 'b.json', queryPermission: async () => perm, requestPermission: async () => 'granted', createWritable: async () => { if (fail) throw new Error('disk'); return { write: async (d: string) => { writes.push(d); }, close: async () => undefined }; } }; return { h, writes }; };
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
  it('saves once per game day and only with permission already granted', async () => {
    const s = store(); const { h, writes } = handle('granted'); const db = {} as never; expect(await autosaveIfDue(db, null, '2026-10-24', new Date(), s)).toBe('none');
    expect(await autosaveIfDue(db, h, '2026-10-24', new Date(), s)).toBe('saved'); expect(await autosaveIfDue(db, h, '2026-10-24', new Date(), s)).toBe('skipped'); expect(writes).toEqual(['{"backup":true}']); expect(await autosaveIfDue(db, h, '2026-10-25', new Date(), s)).toBe('saved');
  });
  it('never prompts by itself, and a failed write does not mark the day as saved', async () => {
    const s = store(); const p = handle('prompt'); expect(await autosaveIfDue({} as never, p.h, 'd', new Date(), s)).toBe('permission'); expect(p.writes).toEqual([]);
    const f = handle('granted', true); expect(await autosaveIfDue({} as never, f.h, 'd', new Date(), s)).toBe('failed'); expect(s.getItem('sls-autosave-day')).toBeNull(); expect(await writeBackup({} as never, handle('denied').h)).toBe('permission');
  });
});
