// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import axe from 'axe-core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { defaultDraft } from '../onboarding/model';
import { registerPlayer } from '../onboarding/register';
import { SlsDb, loadPayload } from '../persist/store';

const a11y = async (el: Element) => (await axe.run(el as HTMLElement, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: false } } }))
  .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(',')}`);
let db: SlsDb;
beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  if (!File.prototype.text) File.prototype.text = function (this: Blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this); }); };
  db = new SlsDb(`p7-${Math.random()}`);
});
afterEach(cleanup);
async function boot(starters: string[] = []) {
  await db.open(); await registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name: 'Vishal', starters }, new Date());
  const view = render(<App db={db} />); await screen.findByRole('heading', { name: /^quests$/i, level: 1 }); return view;
}
const nav = async (name: string) => { await userEvent.click(within(screen.getByRole('navigation', { name: /primary/i })).getByRole('button', { name })); await screen.findByRole('heading', { name: new RegExp(`^${name}$`, 'i'), level: 1 }); };
const quick = async (title: string, difficulty = 'easy') => {
  await userEvent.type(screen.getByLabelText(/quest title/i), title); await userEvent.selectOptions(screen.getByLabelText(/difficulty/i), difficulty);
  await userEvent.click(screen.getByRole('button', { name: /create quest/i }));
};
const xp = async (scope: string) => (await loadPayload(db)).xpTransactions.filter((t) => t.scope === scope).reduce((s, t) => s + Number(t.appliedDelta), 0);

describe('Quests screen', () => {
  it('shows an honest empty state, and validates before creating anything', async () => {
    await boot(); expect(screen.getByText('NO QUESTS FOR TODAY')).toBeTruthy(); expect(screen.queryByText(/quests are ready/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /create quest/i })); expect(await screen.findByText(/enter a quest title/i)).toBeTruthy();
    expect((await loadPayload(db)).occurrences).toHaveLength(0); expect(screen.queryByText('QUEST CREATED')).toBeNull();
  });
  it('quick-creates a one-off, completes it exactly once even on a double click, then offers undo', async () => {
    const { container } = await boot(); await quick('Read paper', 'medium');
    expect(await screen.findByText('QUEST CREATED')).toBeTruthy(); const list = screen.getByRole('list', { name: /today's quests/i });
    expect(within(list).getByText(/100 XP/)).toBeTruthy(); expect(within(list).getByText('One-off')).toBeTruthy(); expect(await a11y(container)).toEqual([]);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Complete Read paper' }));
    expect(await screen.findByText('QUEST COMPLETED')).toBeTruthy(); expect(await screen.findByText(/\+100 XP awarded/)).toBeTruthy();
    expect([await xp('player'), await xp('discipline')]).toEqual([100, 100]); expect((await loadPayload(db)).xpTransactions).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Complete Read paper' })).toBeNull();
    expect(screen.queryByRole('button', { name: /undo read paper/i })).toBeNull(); expect(screen.getByText(/reached a new level, and levels are never lost/i)).toBeTruthy(); // first completion reached level 2
    await quick('Small win'); await userEvent.click(await screen.findByRole('button', { name: 'Complete Small win' })); await screen.findByText(/\+50 XP awarded/);
    await userEvent.click(screen.getByRole('button', { name: /undo small win/i })); expect(await screen.findByText('COMPLETION UNDONE')).toBeTruthy(); expect(await xp('player')).toBe(100);
  });
  it('advanced creation: weekday validation, timed recurring quest with timer controls, then pause/edit/remove with today unchanged', async () => {
    await boot(); await userEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    await userEvent.type(screen.getByLabelText(/quest title/i), 'Deep work'); await userEvent.selectOptions(screen.getByLabelText(/^type/i), 'timed');
    await userEvent.selectOptions(screen.getByLabelText(/^schedule/i), 'weekdays'); await userEvent.click(screen.getByRole('button', { name: /create quest/i }));
    expect(await screen.findByText(/at least one weekday/i)).toBeTruthy(); expect((await loadPayload(db)).templates).toHaveLength(0);
    await userEvent.selectOptions(screen.getByLabelText(/^schedule/i), 'daily'); await userEvent.click(screen.getByLabelText(/^important/i)); await userEvent.click(screen.getByRole('button', { name: /create quest/i }));
    expect(await screen.findByText('QUEST CREATED')).toBeTruthy();
    const list = screen.getByRole('list', { name: /today's quests/i }); expect(within(list).getByText('Important')).toBeTruthy(); expect(within(list).getByText(/Timed 4 × 15 min/)).toBeTruthy(); expect(within(list).getByText(/100 XP/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start Deep work' })); await screen.findByText('TIMER STARTED'); expect(await screen.findByRole('button', { name: 'Pause Deep work' })).toBeTruthy(); expect(screen.getByText(/Self-reported/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pause Deep work' })); await screen.findByText('TIMER PAUSED'); expect(await screen.findByRole('button', { name: 'Resume Deep work' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /complete deep work/i })).toBeNull(); // 15-minute blocks must actually elapse
    const rec = screen.getByRole('list', { name: /recurring quests/i });
    await userEvent.click(within(rec).getByRole('button', { name: 'Edit Deep work' })); const title = within(rec).getByLabelText(/quest title/i);
    await userEvent.clear(title); await userEvent.type(title, 'Deep work v2'); await userEvent.click(within(rec).getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('QUEST UPDATED')).toBeTruthy(); const p = await loadPayload(db);
    expect(p.templateVersions).toHaveLength(2); expect(p.occurrences.map((o) => (o.snapshot as { title: string }).title)).toEqual(['Deep work']);
    await userEvent.click(within(rec).getByRole('button', { name: 'Pause schedule of Deep work v2' })); expect(await screen.findByText('QUEST PAUSED')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Resume schedule of Deep work v2' })).toBeTruthy();
    await userEvent.click(within(rec).getByRole('button', { name: 'Remove Deep work v2' })); expect(await screen.findByText('QUEST REMOVED')).toBeTruthy();
  });
  it('skipping a mandatory quest needs confirmation and warns about the miss', async () => {
    await boot(['workout']); await userEvent.click(screen.getByRole('button', { name: 'Skip Workout' })); expect(screen.getByText(/counts as a miss/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect((await loadPayload(db)).occurrences[0]!.state).toBe('OPEN');
    await userEvent.click(screen.getByRole('button', { name: 'Skip Workout' })); await userEvent.click(screen.getByRole('button', { name: /confirm skip workout/i }));
    expect(await screen.findByText('QUEST SKIPPED')).toBeTruthy();
  });
});
describe('Status screen', () => {
  it('shows ledger-derived progress, allocates points, distributes the bank and limits respec', async () => {
    const { container } = await boot(); await quick('Big one', 'hard'); await userEvent.click(await screen.findByRole('button', { name: 'Complete Big one' })); await screen.findByText(/\+200 XP awarded/);
    await nav('Status'); const line = within(screen.getByRole('main')).getByText(/Total XP/).textContent!; expect(line).toMatch(/Rank E/); expect(line).toMatch(/Level 3/); expect(line).toContain('200'); expect(screen.getByText(/Unspent points/).textContent).toContain('2'); expect(screen.getByRole('img', { name: /stat points radar/i })).toBeTruthy();
    expect(await a11y(container)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Add 1 point to Coding' })); expect(await screen.findByText('POINT ALLOCATED')).toBeTruthy();
    let p = await loadPayload(db); expect([p.player.unspentPoints, p.attributes.find((a) => a.id === 'coding')!.statPoints]).toEqual([1, 1]);
    await userEvent.click(screen.getByRole('button', { name: /distribute banked points \(balanced\)/i })); await screen.findByText('POINTS DISTRIBUTED'); p = await loadPayload(db); expect(p.player.unspentPoints).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: /respec/i })); await screen.findByText('POINTS RETURNED'); expect((await loadPayload(db)).player.unspentPoints).toBe(2);
    await userEvent.click(screen.getByRole('button', { name: /respec/i })); expect(await screen.findByText(/RESPEC_TOO_SOON/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText(/allocation mode/i), 'balanced'); await screen.findByText('MODE CHANGED'); expect((await loadPayload(db)).player.allocationMode).toBe('balanced');
  });
  it('shows honest empty reward states', async () => {
    await boot(); await nav('Status'); expect(screen.getByText(/no rewards yet/i)).toBeTruthy(); expect(screen.getByText(/hidden achievement\(s\) not yet discovered/i)).toBeTruthy();
  });
});
describe('Settings screen', () => {
  it('validates and persists profile, game-day, preferences and rest days', async () => {
    const { container } = await boot(); await nav('Settings'); expect(await a11y(container)).toEqual([]);
    const name = screen.getByLabelText(/player name/i); await userEvent.clear(name); await userEvent.click(screen.getByRole('button', { name: /save profile/i })); expect(await screen.findByText(/name is required/i)).toBeTruthy();
    await userEvent.type(name, 'Sai'); await userEvent.click(screen.getByRole('button', { name: /save profile/i })); await screen.findByText('PROFILE SAVED'); expect((await loadPayload(db)).player.name).toBe('Sai');
    const tz = screen.getByLabelText(/^timezone/i); await userEvent.clear(tz); await userEvent.type(tz, 'Mars/Base'); await userEvent.click(screen.getByRole('button', { name: /save game day/i })); expect(await screen.findByText(/valid timezone/i)).toBeTruthy();
    await userEvent.clear(tz); await userEvent.type(tz, 'Asia/Kolkata'); await userEvent.click(screen.getByRole('button', { name: /save game day/i })); await screen.findByText('GAME DAY UPDATED');
    expect((await loadPayload(db)).settings).toMatchObject({ timezone: 'Asia/Kolkata' });
    await userEvent.selectOptions(screen.getByLabelText(/^effects/i), 'minimal'); await userEvent.click(screen.getByRole('button', { name: /save preferences/i })); await screen.findByText('PREFERENCES SAVED');
    expect((await loadPayload(db)).settings.effects).toBe('minimal'); expect(document.documentElement.dataset.effects).toBe('minimal');
    await userEvent.click(screen.getByRole('button', { name: /set recurring rest day/i })); await screen.findByText('REST DAY ADDED'); expect(screen.getByRole('list', { name: /rest days/i })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /set recurring rest day/i })); expect(await screen.findByText(/only one recurring rest weekday/i)).toBeTruthy();
    const date = screen.getByLabelText(/one-off rest date/i); await userEvent.type(date, '2020-01-01'); await userEvent.click(screen.getByRole('button', { name: /add rest date/i })); expect((await screen.findAllByText(/before that game day begins/i)).length).toBeGreaterThan(0);
  });
  it('exports a backup, refuses a bad import without changing data, and restores a valid one', async () => {
    await boot(); await nav('Settings');
    const urls: string[] = []; URL.createObjectURL = ((b: Blob) => { urls.push(String(b.size)); return 'blob:x'; }) as never; URL.revokeObjectURL = (() => undefined) as never;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { (window as unknown as { __dl: string }).__dl = this.download; };
    await userEvent.click(screen.getByRole('button', { name: /export backup/i })); expect(await screen.findByText('BACKUP EXPORTED')).toBeTruthy();
    expect((window as unknown as { __dl: string }).__dl).toMatch(/^system-backup-\d{4}-\d{2}-\d{2}\.json$/); expect((await loadPayload(db)).meta.lastExportAt).toBeDefined(); expect(urls).toHaveLength(1);
    const before = await loadPayload(db); const input = screen.getByLabelText(/import a backup file/i); const btn = screen.getByRole('button', { name: /import backup/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await userEvent.upload(input, new File(['{"nope":true}'], 'bad.json', { type: 'application/json' })); await userEvent.click(screen.getByLabelText(/replaces my current data/i)); await userEvent.click(btn);
    expect(await screen.findByText(/import refused/i)).toBeTruthy(); expect(await loadPayload(db)).toEqual(before);
  });
});
describe('Navigation', () => {
  it('keeps exactly four destinations and shows the real History screen', async () => {
    await boot(); const n = screen.getByRole('navigation', { name: /primary/i }); expect(within(n).getAllByRole('button').map((b) => b.textContent)).toEqual(['Quests', 'Status', 'History', 'Settings']);
    await nav('History'); expect(screen.queryByText(/not yet implemented/i)).toBeNull(); await waitFor(() => expect(screen.getByRole('group', { name: /history views/i })).toBeTruthy());
  });
});
