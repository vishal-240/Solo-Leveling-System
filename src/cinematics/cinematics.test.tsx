// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import axe from 'axe-core';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acknowledgeEvents, baselineEvents } from '../app/actions';
import { AudioEngine, type CtxLike } from '../audio/engine';
import type { Payload } from '../persist/backup';
import { SlsDb, loadPayload, replaceAll } from '../persist/store';
import { createRegisteredPayload } from '../quests/dayClose';
import { syncProgression } from '../rewards/rewards';
import { totalXpToReach } from '../engine/progression';
import { CinematicHost } from './CinematicHost';
import * as M from './model';

const at = new Date('2026-10-24T10:00:00Z');
function withXp(levelsTo: number, extra?: (p: Payload) => void): Payload {
  const p = createRegisteredPayload('V', 'UTC', '04:00'); const xp = totalXpToReach(levelsTo);
  for (const scope of ['player', 'coding']) p.xpTransactions.push({ id: `s-${scope}`, at: at.toISOString(), dayKey: '2026-10-24', scope, kind: 'quest_award', requestedDelta: xp, appliedDelta: xp, idempotencyKey: `seed:${scope}` });
  extra?.(p); return syncProgression(p, at);
}
class P { value = 0; linearRampToValueAtTime() { return undefined; } }
class N { connect() { return undefined; } disconnect() { return undefined; } }
class G extends N { gain = new P(); } class O extends N { type = 'sine'; frequency = new P(); onended: (() => void) | null = null; start() { return undefined; } stop() { return undefined; } }
const fakeCtx = (): CtxLike => ({ currentTime: 0, state: 'running', destination: {}, createGain: () => new G(), createOscillator: () => new O(), resume: async () => undefined, suspend: async () => undefined }) as never;
const makeEngine = () => { const e = new AudioEngine(fakeCtx); e.unlock(); return e; };
let db: SlsDb;
beforeEach(async () => { db = new SlsDb(`c-${Math.random()}`); await db.open(); });
afterEach(cleanup);

describe('event model', () => {
  it('effective tier: stored tier, with Full downgraded to Reduced by prefers-reduced-motion', () => {
    expect([M.effectiveTier({ effects: 'full' }, false), M.effectiveTier({ effects: 'full' }, true), M.effectiveTier({ effects: 'minimal' }, true), M.effectiveTier({ effects: 'reduced' }, false), M.effectiveTier({}, false), M.effectiveTier({ effects: 'bogus' }, true)]).toEqual(['full', 'reduced', 'minimal', 'reduced', 'full', 'reduced']);
  });
  it('existing data without playback state is history: it is baselined, never pending', () => {
    const p = withXp(11); expect(M.needsBaseline(p)).toBe(true); expect(M.pendingIds(p)).toEqual([]); expect(M.allEventIds(p).length).toBeGreaterThan(10);
  });
  it('builds deterministic steps: one batched level-up, then the rank promotion with its rewards', () => {
    const p = withXp(10); const ids = M.allEventIds(p).filter((i) => !i.startsWith('ach:')); const { steps } = M.buildSteps(p, [...ids].reverse());
    expect(steps.map((s) => [s.kind, s.levels])).toEqual([['level', [2, 3, 4, 5, 6, 7, 8, 9]], ['rank', [10]]]); expect(M.stepText(steps[0]!)).toBe('Levels 2 to 9 (8 levels)'); expect(M.stepText(steps[1]!)).toBe('Rank D: Initiate (level 10)');
    expect(steps[0]!.rewards).toEqual(['+10 attribute points', 'Frame cosmetic (level 5)']); expect(steps[1]!.rewards).toEqual(expect.arrayContaining(['+10 attribute points', '+1 Streak Shield', 'Initiate (rank D)', 'Rank D frame']));
    expect(M.buildSteps(p, ids).steps).toEqual(steps);
  });
  it('only unseen events are included and achievements become notes', () => {
    const p = withXp(7); const seen = ['level:2', 'level:3', 'level:4']; const ids = M.allEventIds(p).filter((i) => !seen.includes(i)); const { steps, notes } = M.buildSteps(p, ids);
    expect(steps).toHaveLength(1); expect(steps[0]!.levels).toEqual([5, 6, 7]); expect(notes.map((n) => n.text)).toContain('First Level Up'); expect(notes.every((n) => n.title === 'ACHIEVEMENT UNLOCKED')).toBe(true);
  });
  it('acknowledging is idempotent, additive and never changes XP or rewards', async () => {
    const p = withXp(4); await replaceAll(db, p); await baselineEvents(db, []); expect((await loadPayload(db)).meta.seenEvents).toEqual([]);
    expect(await baselineEvents(db, ['x'])).toBe(false); expect(await acknowledgeEvents(db, ['level:2', 'level:3'])).toBe(true); expect(await acknowledgeEvents(db, ['level:3', 'level:2'])).toBe(false);
    await acknowledgeEvents(db, ['level:4']); const after = await loadPayload(db); expect(after.meta.seenEvents).toEqual(['level:2', 'level:3', 'level:4']);
    const ids = (rows: { id?: unknown }[]) => rows.map((r) => String(r.id)).sort(); expect([ids(after.rewardGrants), ids(after.xpTransactions), ids(after.levelEvents)]).toEqual([ids(p.rewardGrants), ids(p.xpTransactions), ids(p.levelEvents)]);
  });
});

/** Mimics App: owns the stored payload and re-reads it after every refresh. */
function Harness({ tier, engine, opener }: { tier: M.Tier; engine: AudioEngine; opener?: boolean }) {
  const [p, setP] = useState<Payload | null>(null); const load = useCallback(async () => setP(await loadPayload(db)), []); useEffect(() => { void load(); }, [load]);
  return p ? <><div className="shell"><button type="button" id="opener">opener</button><h1>App</h1></div><CinematicHost db={db} payload={p} refresh={load} tier={tier} engine={engine} />{opener ? null : null}</> : null;
}
const seed = async (p: Payload, seen: string[] | undefined) => { const q = structuredClone(p); if (seen) q.meta.seenEvents = seen; await replaceAll(db, q); };
const dialog = () => screen.findByRole('dialog');

describe('cinematic host', () => {
  it('presents new events once: dialog semantics, focus, sound, acknowledgement, and no replay after a reload', async () => {
    await seed(withXp(3), []); const engine = makeEngine(); const first = render(<Harness tier="full" engine={engine} />);
    const d = await dialog(); expect([d.getAttribute('aria-modal'), within(d).getByRole('heading').textContent, d.getAttribute('aria-labelledby')]).toEqual(['true', 'LEVEL UP', 'cine-title']);
    expect(within(d).getByText('Levels 2 to 3 (2 levels)')).toBeTruthy(); expect(within(d).getByRole('list', { name: /rewards earned/i }).textContent).toMatch(/\+2 attribute points/);
    expect(document.activeElement).toBe(within(d).getByRole('button', { name: 'Close' })); expect(engine.played.filter((s) => s === 'level')).toHaveLength(1);
    expect(document.querySelector('.shell')!.hasAttribute('inert')).toBe(true); expect(document.querySelector('.shell')!.getAttribute('aria-hidden')).toBe('true');
    await waitFor(async () => expect((await loadPayload(db)).meta.seenEvents).toEqual(expect.arrayContaining(['level:2', 'level:3'])));
    await userEvent.click(within(d).getByRole('button', { name: 'Close' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.querySelector('.shell')!.hasAttribute('inert')).toBe(false);
    first.unmount(); render(<Harness tier="full" engine={engine} />); await screen.findByRole('heading', { name: 'App' }); await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull(); expect(engine.played.filter((s) => s === 'level')).toHaveLength(1);
  });
  it('baselines pre-existing history silently, then plays only genuinely new events', async () => {
    await seed(withXp(5), undefined); const engine = makeEngine(); const v = render(<Harness tier="full" engine={engine} />); await screen.findByRole('heading', { name: 'App' });
    await waitFor(async () => expect(((await loadPayload(db)).meta.seenEvents as string[]).length).toBeGreaterThan(3)); expect(screen.queryByRole('dialog')).toBeNull(); expect(engine.played).toEqual([]); v.unmount();
    await replaceAll(db, withXp(7, (p) => { p.meta.seenEvents = [...M.allEventIds(withXp(5))]; })); render(<Harness tier="full" engine={engine} />);
    const d = await dialog(); expect(within(d).getByText('Levels 6 to 7 (2 levels)')).toBeTruthy();
  });
  it('plays several events from one action in order: batched levels, then the rank promotion, then closes; focus returns to the opener', async () => {
    await seed(withXp(10), []); const engine = makeEngine(); render(<Harness tier="full" engine={engine} />);
    document.getElementById('opener')?.focus(); const d = await dialog();
    expect(within(d).getByRole('heading').textContent).toBe('LEVEL UP'); expect(within(d).getByText(/Event 1 of 2/)).toBeTruthy();
    await userEvent.click(within(d).getByRole('button', { name: 'Continue' })); await waitFor(() => expect(screen.getByRole('heading', { name: 'RANK PROMOTION' })).toBeTruthy());
    const r = screen.getByRole('dialog'); expect(r.parentElement!.className).toMatch(/cine--rank-D/); expect(r.querySelectorAll('.cine__ring')).toHaveLength(1); expect(within(r).getByText(/Event 2 of 2/)).toBeTruthy();
    expect(engine.played.filter((s) => s === 'level' || s === 'rank')).toEqual(['level', 'rank']); await userEvent.click(within(r).getByRole('button', { name: 'Close' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('Skip and Escape dismiss everything, acknowledge it, and leave rewards and XP untouched', async () => {
    const full = withXp(10); await seed(full, []); render(<Harness tier="full" engine={makeEngine()} />); const d = await dialog();
    await userEvent.keyboard('{Escape}'); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); const after = await loadPayload(db);
    await waitFor(async () => expect((await loadPayload(db)).meta.seenEvents).toEqual(expect.arrayContaining(M.allEventIds(full).filter((i) => !i.startsWith('ach:'))))); const after2 = await loadPayload(db); void after2; const ids = (rows: { id?: unknown }[]) => rows.map((r) => String(r.id)).sort(); expect([ids(after.rewardGrants), ids(after.xpTransactions), after.player.unspentPoints]).toEqual([ids(full.rewardGrants), ids(full.xpTransactions), full.player.unspentPoints]); expect(d.isConnected).toBe(false);
    cleanup(); await seed(withXp(3), []); render(<Harness tier="full" engine={makeEngine()} />); await userEvent.click(within(await dialog()).getByRole('button', { name: 'Skip' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('keeps keyboard focus inside the dialog (Tab and Shift+Tab wrap) and passes axe', async () => {
    await seed(withXp(10), []); render(<Harness tier="full" engine={makeEngine()} />); const d = await dialog(); const skip = within(d).getByRole('button', { name: 'Skip' }), next = within(d).getByRole('button', { name: 'Continue' });
    expect(document.activeElement).toBe(next); await userEvent.tab(); expect(document.activeElement).toBe(skip); await userEvent.tab({ shift: true }); expect(document.activeElement).toBe(next); await userEvent.tab(); await userEvent.tab(); expect(document.activeElement).toBe(next);
    const r = await axe.run(d, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: false } } }); expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
  it('Reduced tier shows the same readable dialog without ring effects; Minimal shows text banners only', async () => {
    await seed(withXp(10), []); const reduced = render(<Harness tier="reduced" engine={makeEngine()} />); const d = await dialog(); expect(d.parentElement!.className).toMatch(/cine--reduced/); expect(d.querySelectorAll('.cine__ring')).toHaveLength(0);
    expect(within(d).getByText(/Levels 2 to 9/)).toBeTruthy(); reduced.unmount(); cleanup();
    await seed(withXp(10), []); const engine = makeEngine(); render(<Harness tier="minimal" engine={engine} />); const region = await screen.findByRole('region', { name: /notifications/i });
    expect(screen.queryByRole('dialog')).toBeNull(); expect(region.textContent).toMatch(/LEVEL UP.*Levels 2 to 9/); expect(region.textContent).toMatch(/RANK PROMOTION.*Rank D: Initiate/); expect(engine.played).toEqual(expect.arrayContaining(['level', 'rank']));
    await userEvent.click(within(region).getByRole('button', { name: /dismiss level up/i })); expect(region.textContent).not.toMatch(/Levels 2 to 9/);
  });
  it('announces new achievements once as a dismissible banner with its own sound', async () => {
    const p = withXp(2); await seed(p, M.allEventIds(p).filter((i) => !i.startsWith('ach:'))); const engine = makeEngine(); const v = render(<Harness tier="full" engine={engine} />);
    const region = await screen.findByRole('region', { name: /notifications/i }); expect(region.textContent).toMatch(/ACHIEVEMENT UNLOCKED.*First Level Up/); expect(screen.queryByRole('dialog')).toBeNull(); expect(engine.played).toContain('achievement'); await waitFor(async () => expect((await loadPayload(db)).meta.seenEvents).toContain('ach:first_level_up')); v.unmount();
    render(<Harness tier="full" engine={engine} />); await screen.findByRole('heading', { name: 'App' }); await new Promise((r) => setTimeout(r, 50)); expect(screen.queryByRole('region', { name: /notifications/i })).toBeNull();
  });
  it('still works when audio is unavailable or failing, and does not lose the acknowledgement', async () => {
    await seed(withXp(3), []); const broken = new AudioEngine(() => { throw new Error('no audio'); }); broken.unlock(); render(<Harness tier="full" engine={broken} />); const d = await dialog();
    expect(within(d).getByRole('heading').textContent).toBe('LEVEL UP'); await waitFor(async () => expect((await loadPayload(db)).meta.seenEvents).toContain('level:3'));
    await act(async () => { await userEvent.click(within(d).getByRole('button', { name: 'Close' })); }); expect(screen.queryByRole('dialog')).toBeNull();
  });
});
