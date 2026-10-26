// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { DRAFT_KEY } from '../onboarding/model';
import { registerPlayer } from '../onboarding/register';
import { SlsDb, loadPayload } from '../persist/store';
import { SystemMessage } from './components';
import { defaultDraft } from '../onboarding/model';

const css = readFileSync('src/ui/tokens.css', 'utf8');
const tok = (n: string) => css.match(new RegExp(`--${n}:(#[0-9a-fA-F]{6})`))![1]!;
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(tok(a)), lum(tok(b))].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
const a11y = async (el: Element) => {
  const r = await axe.run(el as HTMLElement, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: false } } });
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(',')}`);
};
let db: SlsDb;
beforeEach(async () => {
  window.localStorage.clear(); document.documentElement.removeAttribute('data-effects');
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  db = new SlsDb(`ui-${Math.random()}`); await db.open();
});
afterEach(cleanup);
const click = (name: RegExp | string) => userEvent.click(screen.getByRole('button', { name }));
const heading = (n: RegExp) => screen.findByRole('heading', { name: n });

describe('design tokens, responsiveness and effects (static checks; no real layout engine in this environment)', () => {
  it('text colours meet WCAG AA contrast on every surface', () => {
    for (const fg of ['text', 'text-muted', 'accent', 'danger', 'warn', 'ok']) for (const bg of ['bg', 'surface', 'surface-2']) expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(ratio('accent-ink', 'accent')).toBeGreaterThanOrEqual(4.5); expect(ratio('focus', 'bg')).toBeGreaterThanOrEqual(3); expect(ratio('edge', 'bg')).toBeGreaterThanOrEqual(3);
  });
  it('declares the 360 px / 1440 px layouts, 44 px targets, visible focus and reduced-motion handling', () => {
    expect(css).toMatch(/@media \(min-width:768px\)/); expect(css).toMatch(/@media \(max-width:420px\)/); expect(css).toMatch(/\.nav\{display:flex;position:fixed;[^}]*bottom:0/);
    expect(css).toMatch(/min-height:44px/); expect(css).toMatch(/:focus-visible\{outline:3px solid/); expect(css).toMatch(/prefers-reduced-motion:reduce/);
    expect(css).toMatch(/\[data-effects="reduced"\]/); expect(css).toMatch(/\[data-effects="minimal"\]/); expect(readFileSync('index.html', 'utf8')).toMatch(/viewport-fit=cover/);
  });
  it('System messages use polite status, and assertive alert only for penalties', () => {
    render(<><SystemMessage title="LEVEL UP" /><SystemMessage title="PENALTY QUEST ISSUED" kind="penalty" /></>);
    expect(screen.getByText('LEVEL UP').parentElement!.getAttribute('role')).toBe('status'); expect(screen.getByText('PENALTY QUEST ISSUED').parentElement!.getAttribute('role')).toBe('alert');
  });
});
describe('accessibility harness sanity', () => {
  it('actually detects serious violations (unnamed button, unlabelled input)', async () => {
    const { container } = render(<div><button type="button" /><input type="text" /></div>);
    expect((await a11y(container)).join()).toMatch(/button-name|label/);
  });
});
describe('Player Awakening end to end', () => {
  it('walks all seven steps with validation, skipping, registration and confirmation', async () => {
    const user = userEvent.setup(); const { container } = render(<App db={db} />);
    await heading(/player awakening/i); expect(await a11y(container)).toEqual([]);
    await click('Begin');
    await user.type(screen.getByLabelText(/player name/i), 'x'.repeat(30)); await click('Continue');
    expect((await screen.findByRole('alert')).textContent).toMatch(/24 characters/); expect(screen.getByLabelText(/player name/i).getAttribute('aria-invalid')).toBe('true');
    await user.clear(screen.getByLabelText(/player name/i)); await user.type(screen.getByLabelText(/player name/i), 'Vishal'); expect(await a11y(container)).toEqual([]); await click('Continue');
    expect(document.activeElement!.textContent).toBe('Attributes'); expect(await a11y(container)).toEqual([]); await click(/skip/i);
    await click('Add quest'); expect(screen.getByText(/1 to 60 characters/)).toBeTruthy();
    await user.click(screen.getByLabelText(/study session/i)); await user.click(screen.getByLabelText(/^workout/i));
    await user.type(screen.getByLabelText(/quest title/i), 'Read paper'); await click('Add quest'); expect(screen.getByRole('list', { name: /your quests/i })).toBeTruthy();
    expect(await a11y(container)).toEqual([]); await click('Continue');
    const tz = screen.getByLabelText(/timezone/i); await user.clear(tz); await user.type(tz, 'Mars/Base'); await click('Continue'); expect((await screen.findByRole('alert')).textContent).toMatch(/valid timezone/i);
    await user.clear(tz); await user.type(tz, 'Asia/Kolkata'); fireEvent.change(screen.getByLabelText(/daily reset time/i), { target: { value: '05:30' } }); expect(await a11y(container)).toEqual([]); await click('Continue');
    await user.selectOptions(screen.getByLabelText(/^effects/i), 'reduced'); await user.selectOptions(screen.getByLabelText(/allocation/i), 'balanced');
    expect(screen.getByText(/cannot verify activity/i)).toBeTruthy(); expect(await a11y(container)).toEqual([]); expect(document.documentElement.dataset.effects).toBe('reduced'); await click('Continue');
    expect(await a11y(container)).toEqual([]); await user.dblClick(screen.getByRole('button', { name: /confirm registration/i }));
    expect(await screen.findByText('PLAYER REGISTERED')).toBeTruthy(); expect(screen.getByText('DAILY QUEST UPDATED').parentElement!.textContent).toMatch(/3 quests generated/);
    const p = await loadPayload(db);
    expect(p.player).toMatchObject({ name: 'Vishal', allocationMode: 'balanced' }); expect(p.settings).toMatchObject({ timezone: 'Asia/Kolkata', resetTime: '05:30', effects: 'reduced' });
    expect([p.templates.length, p.occurrences.length, p.xpTransactions.length, p.rewardGrants.length, p.levelEvents.length]).toEqual([3, 3, 0, 0, 0]);
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull(); expect(await a11y(container)).toEqual([]);
    await click('Enter the System'); expect(await heading(/^quests$/i)).toBeTruthy(); expect(within(screen.getByRole('list', { name: /today's quests/i })).getAllByRole('listitem')).toHaveLength(3);
  });
  it('skipping every optional step registers with defaults', async () => {
    render(<App db={db} />); await heading(/player awakening/i); await click('Begin');
    for (let i = 0; i < 5; i++) await click(/skip/i);
    await click(/confirm registration/i); await screen.findByText('PLAYER REGISTERED');
    const p = await loadPayload(db); expect(p.player.name).toBe('Player'); expect(p.settings.resetTime).toBe('04:00'); expect(p.templates).toHaveLength(0);
    expect(screen.getByText('NO QUESTS YET').parentElement!.textContent).toMatch(/no quests yet/i); expect(screen.queryByText('DAILY QUEST UPDATED')).toBeNull();
  });
  it('resumes a partially completed onboarding after a reload, without registering anything', async () => {
    const user = userEvent.setup(); const first = render(<App db={db} />); await heading(/player awakening/i); await click('Begin');
    await user.type(screen.getByLabelText(/player name/i), 'Vishal'); await click('Continue'); await screen.findByLabelText(/academics goal/i); first.unmount();
    expect((await loadPayload(db)).templates).toHaveLength(0); expect(Object.keys((await loadPayload(db)).meta)).toHaveLength(0);
    render(<App db={db} />); await screen.findByLabelText(/academics goal/i); await click('Back'); expect((screen.getByLabelText(/player name/i) as HTMLInputElement).value).toBe('Vishal');
  });
  it('a corrupt saved draft falls back to a clean start', async () => {
    window.localStorage.setItem(DRAFT_KEY, '{"step":42}'); render(<App db={db} />); await heading(/player awakening/i); expect(screen.getByRole('button', { name: 'Begin' })).toBeTruthy();
  });
  it('never initialises twice: a registered database shows the shell, and a second registration is rejected', async () => {
    await registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name: 'Vishal', starters: ['study'] }, new Date('2026-10-20T10:00:00Z'));
    const before = await loadPayload(db); render(<App db={db} />);
    expect(await heading(/^quests$/i)).toBeTruthy(); expect(screen.queryByText(/player awakening/i)).toBeNull();
    await expect(registerPlayer(db, defaultDraft({ timezone: 'UTC' }))).rejects.toMatchObject({ code: 'ALREADY_REGISTERED' }); const after = await loadPayload(db); expect([after.player.name, after.templates, after.settings]).toEqual([before.player.name, before.templates, before.settings]); // opening the shell only runs idempotent day close
  });
});
describe('application shell', () => {
  beforeEach(async () => { await registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name: 'Vishal', effects: 'minimal', starters: ['study'] }, new Date('2026-10-20T10:00:00Z')); });
  it('has no serious accessibility violations, shows real status and System messages, and applies the effects tier', async () => {
    const { container } = render(<App db={db} />); await heading(/^quests$/i);
    expect(await a11y(container)).toEqual([]); expect(screen.getByText(/Vishal \| Rank E \| Level 1/)).toBeTruthy(); expect(screen.getAllByText('DAILY QUEST UPDATED').length).toBeGreaterThan(0); await waitFor(() => expect(document.documentElement.dataset.effects).toBe('minimal'));
  });
  it('navigates by keyboard, exposes the current page and clearly marks unfinished screens', async () => {
    const user = userEvent.setup(); render(<App db={db} />); await heading(/^quests$/i);
    await user.tab(); expect((document.activeElement as HTMLElement).textContent).toBe('Skip to content');
    const nav = screen.getByRole('navigation', { name: /primary/i }); expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Quests', 'Status', 'History', 'Settings']);
    for (let i = 0; i < 6 && document.activeElement !== within(nav).getByRole('button', { name: 'History' }); i++) await user.tab();
    await user.keyboard('{Enter}'); expect(await heading(/^history$/i)).toBeTruthy(); expect(within(nav).getByRole('button', { name: 'History' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/do not exist yet/i).textContent).toMatch(/P8/);
  });
});
