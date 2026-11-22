// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { exportBackupText } from '../app/actions';
import { timeline } from '../history/testFixture';
import { defaultDraft } from '../onboarding/model';
import { registerPlayer } from '../onboarding/register';
import { SlsDb, loadPayload, replaceAll } from '../persist/store';
import { initPwa, resetPwaForTests } from '../pwa/state';

let db: SlsDb; let stop: (() => void) | null = null;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T10:30:00Z')); window.localStorage.clear(); resetPwaForTests();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  URL.createObjectURL = (() => 'blob:x') as never; URL.revokeObjectURL = (() => undefined) as never; HTMLAnchorElement.prototype.click = function () { /* no navigation in jsdom */ };
  if (!File.prototype.text) File.prototype.text = function (this: Blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this); }); };
  db = new SlsDb(`p10-${Math.random()}`); await db.open();
});
afterEach(() => { cleanup(); stop?.(); stop = null; vi.useRealTimers(); vi.restoreAllMocks(); Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true }); });
const register = (name = 'V') => registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name }, new Date());
const open = async (dest = 'Settings') => { render(<App db={db} />); await userEvent.click(await within(await screen.findByRole('navigation', { name: /primary/i })).findByRole('button', { name: dest })); await screen.findByRole('heading', { name: new RegExp(`^${dest}$`, 'i'), level: 1 }); };

describe('backup import preview and confirmation', () => {
  it('shows what a backup contains before replacing anything, refuses bad files, and imports only after confirmation', async () => {
    await replaceAll(db, timeline()); const text = await exportBackupText(db, new Date('2026-10-24T11:00:00Z')); await open();
    const input = screen.getByLabelText(/import a backup file/i); const btn = screen.getByRole('button', { name: /import backup/i }); expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.upload(input, new File(['{"x":1}'], 'bad.json', { type: 'application/json' })); expect(await screen.findByText(/Import refused \(bad_format\)/)).toBeTruthy(); expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.upload(input, new File([text], 'ok.json', { type: 'application/json' }));
    const dl = await screen.findByLabelText('Backup preview'); expect(dl.textContent).toMatch(/V: rank E, level 3/); expect(dl.textContent).toMatch(/Last game day2026-10-23/); expect(dl.textContent).toMatch(/\d+ recurring quests, 4 recorded days, \d+ ledger entries/);
    expect((btn as HTMLButtonElement).disabled).toBe(true); await userEvent.click(screen.getByLabelText(/replaces my current data/i)); expect((btn as HTMLButtonElement).disabled).toBe(false);
    const before = await loadPayload(db); await userEvent.click(btn); expect(await screen.findByText('BACKUP IMPORTED')).toBeTruthy(); const after = await loadPayload(db);
    expect(after.xpTransactions.length).toBe(before.xpTransactions.length); expect(after.levelEvents.length).toBe(before.levelEvents.length); expect(after.meta.lastImportAt).toBeDefined();
  });
  it('a corrupted backup is refused with the reason and leaves data untouched', async () => {
    await register(); await open(); const before = await loadPayload(db); const env = JSON.parse(await exportBackupText(db, new Date())); env.payload.player.name = 'Tampered';
    await userEvent.upload(screen.getByLabelText(/import a backup file/i), new File([JSON.stringify(env)], 'bad.json', { type: 'application/json' })); expect(await screen.findByText(/Import refused \(checksum\)/)).toBeTruthy(); expect(screen.getByText(/current data was not changed/)).toBeTruthy();
    const after = await loadPayload(db); expect({ ...after, meta: { ...after.meta, lastExportAt: 0 } }).toEqual({ ...before, meta: { ...before.meta, lastExportAt: 0 } });
  });
});
describe('reminders, storage status and install help', () => {
  it('saves the reminder interval and shows the last export time after exporting', async () => {
    await register(); await open(); await userEvent.selectOptions(screen.getByLabelText(/remind me to export every/i), '14'); await screen.findByText('REMINDER SAVED'); expect((await loadPayload(db)).settings.backupReminderDays).toBe(14);
    await userEvent.click(screen.getByRole('button', { name: /export backup/i })); await screen.findByText('BACKUP EXPORTED'); expect(screen.getByText(/Last export: (?!never)/)).toBeTruthy();
  });
  it('shows storage status, asks for persistence on request, and explains when it is unavailable', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 4096, quota: 2 * 1024 ** 3 }) } });
    await register(); await open(); const panel = (await screen.findByRole('heading', { name: 'Storage status' })).closest('section')!; await within(panel).findByText(/not granted/); expect(panel.textContent).toMatch(/Used: 4.0 KB of about 2.0 GB/);
    await userEvent.click(within(panel).getByRole('button', { name: /request persistent storage/i })); expect(await screen.findByText('Persistent storage granted.')).toBeTruthy();
    cleanup(); Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined }); await open(); expect(await screen.findByText(/Storage status is not available in this browser/)).toBeTruthy();
  });
  it('explains installation on each platform, reports install and offline state, and offers the cache reset', async () => {
    await register(); await open(); const panel = (await screen.findByRole('heading', { name: 'Install and offline' })).closest('section')!;
    expect(panel.textContent).toMatch(/Chrome or Edge.*Android.*Safari on iPhone/s); expect(panel.textContent).toMatch(/Running in the browser/); expect(panel.textContent).toMatch(/Offline start: not available yet/); expect(within(panel).getByRole('button', { name: /reset app cache/i })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /install app/i })).toBeNull(); const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    stop = initPwa(() => async () => undefined); act(() => { window.dispatchEvent(e); }); await userEvent.click(await within(panel).findByRole('button', { name: /install app/i })); expect(e.prompt).toHaveBeenCalled();
  });
});
describe('banners in the app shell', () => {
  it('shows a backup reminder after the interval, links to Settings, and stays quiet after "remind me tomorrow"', async () => {
    await register(); const p = await loadPayload(db); p.player.createdAt = '2026-09-01T00:00:00.000Z'; await replaceAll(db, p);
    render(<App db={db} />); expect(await screen.findByText('BACKUP REMINDER')).toBeTruthy(); expect(screen.getByText(/not exported a backup yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remind me tomorrow' })); await waitFor(() => expect(screen.queryByText('BACKUP REMINDER')).toBeNull()); expect(typeof (await loadPayload(db)).meta.reminderSnoozedUntil).toBe('string');
    cleanup(); render(<App db={db} />); await screen.findByRole('navigation', { name: /primary/i }); await new Promise((r) => setTimeout(r, 80)); expect(screen.queryByText('BACKUP REMINDER')).toBeNull();
  });
  it('opens the backup settings from the reminder', async () => {
    await register(); const p = await loadPayload(db); p.player.createdAt = '2026-09-01T00:00:00.000Z'; await replaceAll(db, p); render(<App db={db} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open backup settings' })); expect(await screen.findByRole('heading', { name: /^settings$/i, level: 1 })).toBeTruthy(); expect(screen.queryByText('BACKUP REMINDER')).toBeTruthy();
  });
  it('shows the update prompt inside the app', async () => {
    await register(); let cb!: { onNeedRefresh?: () => void }; stop = initPwa((o) => { cb = o; return async () => undefined; }); render(<App db={db} />); await screen.findByRole('navigation', { name: /primary/i });
    act(() => cb.onNeedRefresh!()); expect(await screen.findByText('SYSTEM UPDATE AVAILABLE')).toBeTruthy(); expect((screen.getByRole('button', { name: 'Reload to update' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
describe('storage failures', () => {
  it('reports a full or blocked store clearly, does not claim success, and changes nothing', async () => {
    await register(); await open('Quests'); const before = await loadPayload(db);
    const spy = vi.spyOn(Dexie.prototype, 'transaction').mockRejectedValue(Object.assign(new Error('full'), { name: 'QuotaExceededError' }));
    await userEvent.type(screen.getByLabelText(/quest title/i), 'Read'); await userEvent.click(screen.getByRole('button', { name: /create quest/i }));
    expect(await screen.findByText(/Storage is full, so this change was not saved/)).toBeTruthy(); expect(screen.queryByText('QUEST CREATED')).toBeNull(); spy.mockRestore();
    expect((await loadPayload(db)).occurrences).toEqual(before.occurrences); await userEvent.click(screen.getByRole('button', { name: /create quest/i })); expect(await screen.findByText('QUEST CREATED')).toBeTruthy();
  });
});
