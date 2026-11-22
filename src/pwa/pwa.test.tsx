// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaBanner } from './PwaBanner';
import { getPwaState, initPwa, promptInstall, resetAppCache, resetPwaForTests } from './state';

type Cb = { onNeedRefresh?: () => void; onOfflineReady?: () => void; onRegisterError?: (e: unknown) => void; onRegisteredSW?: (u: string, r?: ServiceWorkerRegistration) => void };
let cb: Cb; const updater = vi.fn(async () => undefined); let stop: () => void;
beforeEach(() => { resetPwaForTests(); window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never; updater.mockClear();
  stop = initPwa((o) => { cb = o; return updater; }); });
afterEach(() => { cleanup(); stop(); });

describe('update lifecycle', () => {
  it('shows a prompt when a new version waits, keeps the app usable, and reloads only on request', async () => {
    render(<PwaBanner timerRunning={false} />); expect(screen.queryByText('SYSTEM UPDATE AVAILABLE')).toBeNull(); act(() => cb.onNeedRefresh!());
    expect(await screen.findByText('SYSTEM UPDATE AVAILABLE')).toBeTruthy(); expect(updater).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Reload to update' })); expect(updater).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Later' })); expect(screen.queryByText('SYSTEM UPDATE AVAILABLE')).toBeNull();
  });
  it('blocks updating while a timer is running', async () => {
    render(<PwaBanner timerRunning />); act(() => cb.onNeedRefresh!()); const b = await screen.findByRole('button', { name: 'Reload to update' }); expect((b as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/Pause or finish your running timer/)).toBeTruthy();
    await userEvent.click(b); expect(updater).not.toHaveBeenCalled();
  });
  it('reports offline readiness and registration failure without blocking the app', async () => {
    render(<PwaBanner timerRunning={false} />); act(() => cb.onOfflineReady!()); expect(await screen.findByText('OFFLINE READY')).toBeTruthy(); await userEvent.click(screen.getByRole('button', { name: 'Dismiss' })); expect(screen.queryByText('OFFLINE READY')).toBeNull();
    act(() => cb.onRegisterError!(new Error('blocked'))); expect((await screen.findByText('OFFLINE START UNAVAILABLE')).parentElement!.textContent).toMatch(/still works while you are online/); expect(getPwaState().registerError).toBe('blocked');
  });
  it('survives a registration function that throws', () => { stop(); resetPwaForTests(); stop = initPwa(() => { throw new Error('no sw'); }); expect(getPwaState().registerError).toBe('no sw'); });
});
describe('install prompt', () => {
  it('captures beforeinstallprompt, prompts once and clears after install', async () => {
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome: 'accepted' as const }) });
    act(() => { window.dispatchEvent(e); }); expect(e.defaultPrevented).toBe(true); expect(getPwaState().canInstall).toBe(true); expect(await promptInstall()).toBe('accepted'); expect(e.prompt).toHaveBeenCalledTimes(1); expect(getPwaState().canInstall).toBe(false);
    expect(await promptInstall()).toBe('unavailable'); act(() => { window.dispatchEvent(new Event('appinstalled')); }); expect(getPwaState().installed).toBe(true);
  });
});
describe('recovery: reset app cache', () => {
  it('resets only this app cache and registration, never touching other apps or IndexedDB', async () => {
    const reg = { unregister: vi.fn(async () => true) }; const del = vi.fn(async () => true); const win = { navigator: { serviceWorker: { getRegistration: async () => reg } }, caches: { keys: async () => ['sls-system-precache-v2', 'workbox-precache-v2', 'other-app-runtime'], delete: del } } as unknown as Window;
    expect(await resetAppCache(win)).toEqual({ workers: 1, caches: 1 }); expect(reg.unregister).toHaveBeenCalledTimes(1); expect(del).toHaveBeenCalledTimes(1); expect(del).toHaveBeenCalledWith('sls-system-precache-v2');
    expect(await resetAppCache({ navigator: {} } as unknown as Window)).toEqual({ workers: 0, caches: 0 });
    const bad = { navigator: { serviceWorker: { getRegistration: async () => { throw new Error('x'); } } }, caches: { keys: async () => { throw new Error('y'); } } } as unknown as Window; expect(await resetAppCache(bad)).toEqual({ workers: 0, caches: 0 });
  });
});
