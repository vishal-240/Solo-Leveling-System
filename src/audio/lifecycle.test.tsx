// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { defaultDraft } from '../onboarding/model';
import { registerPlayer } from '../onboarding/register';
import { SlsDb } from '../persist/store';
import { installAudioLifecycle } from './index';
import { AudioEngine } from './engine';

afterEach(cleanup);
type Spy = { mock: { calls: unknown[][] } };
const net = (spyAdd: Spy, spyRemove: Spy) => {
  const count = (spy: Spy) => { const m: Record<string, number> = {}; for (const c of spy.mock.calls) { const k = String(c[0]); m[k] = (m[k] ?? 0) + 1; } return m; };
  const a = count(spyAdd), r = count(spyRemove); // only the events this app registers (the test tooling adds its own, e.g. selectionchange)
  const mine = new Set(['visibilitychange', 'click', 'pointerdown', 'keydown', 'touchend', 'beforeinstallprompt', 'appinstalled']);
  return Object.fromEntries(Object.keys({ ...a, ...r }).filter((k) => mine.has(k)).map((k) => [k, (a[k] ?? 0) - (r[k] ?? 0)]).filter(([, v]) => v !== 0));
};
describe('no leaked listeners or timers', () => {
  it('the audio lifecycle removes every listener it adds', () => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener'), dadd = vi.spyOn(document, 'addEventListener'), drem = vi.spyOn(document, 'removeEventListener');
    const stop = installAudioLifecycle(new AudioEngine(() => null)); stop(); expect(net(add, remove)).toEqual({}); expect(net(dadd, drem)).toEqual({}); vi.restoreAllMocks();
  });
  it('repeated navigation and unmounting the whole app leave no extra listeners behind', async () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
    const db = new SlsDb(`lk-${Math.random()}`); await db.open(); await registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name: 'V' }, new Date());
    const wadd = vi.spyOn(window, 'addEventListener'), wrem = vi.spyOn(window, 'removeEventListener'), dadd = vi.spyOn(document, 'addEventListener'), drem = vi.spyOn(document, 'removeEventListener');
    const v = render(<App db={db} />); const nav = await screen.findByRole('navigation', { name: /primary/i });
    for (let i = 0; i < 6; i++) for (const d of ['Status', 'History', 'Settings', 'Quests']) await userEvent.click(within(nav).getByRole('button', { name: d }));
    v.unmount(); await new Promise((r) => setTimeout(r, 50));
    const w = net(wadd, wrem), d = net(dadd, drem); expect(w).toEqual({}); expect(d).toEqual({}); vi.restoreAllMocks();
  });
  it('stopping music clears its timer', () => {
    vi.useFakeTimers(); const cleared = vi.spyOn(globalThis, 'clearInterval');
    const ctx = { currentTime: 0, state: 'running', destination: {}, createGain: () => ({ connect() {}, gain: { value: 0 } }), createOscillator: () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: '', onended: null }) };
    const e = new AudioEngine(() => ctx as never); e.unlock(); e.configure({ musicEnabled: true }); expect(e.startMusic()).toBe(true); e.stopMusic(); expect(cleared).toHaveBeenCalled(); vi.useRealTimers(); vi.restoreAllMocks();
  });
});
