// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import axe from 'axe-core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { defaultDraft } from '../onboarding/model';
import { registerPlayer } from '../onboarding/register';
import { SlsDb } from '../persist/store';
import { replaceAll } from '../persist/store';
import { timeline } from '../history/testFixture';
import { HistoryScreen } from './HistoryScreen';

const a11y = async (el: Element) => (await axe.run(el as HTMLElement, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }, rules: { 'color-contrast': { enabled: false } } }))
  .violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(',')}`);
let db: SlsDb;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T10:30:00Z')); window.localStorage.clear();
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  db = new SlsDb(`h-${Math.random()}`);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const openHistory = async () => { render(<App db={db} />); await userEvent.click(await within(await screen.findByRole('navigation', { name: /primary/i })).findByRole('button', { name: 'History' })); await screen.findByRole('group', { name: /history views/i }); };
const view = (n: string) => userEvent.click(screen.getByRole('button', { name: n }));

describe('History screen with an empty player', () => {
  it('shows honest empty states in every view', async () => {
    await db.open(); await registerPlayer(db, { ...defaultDraft({ timezone: 'UTC' }), name: 'V' }, new Date()); await openHistory();
    expect(screen.getByText('NO HISTORY YET')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Previous month' }).hasAttribute('disabled')).toBe(true); expect(screen.getByRole('button', { name: 'Next month' }).hasAttribute('disabled')).toBe(true);
    await view('Charts'); expect(screen.getByText(/no xp has been recorded yet/i)).toBeTruthy(); await view('XP ledger'); expect(screen.getByText(/no xp has been recorded yet/i)).toBeTruthy();
    await view('Achievements'); expect(screen.getByText(/0 of \d+ unlocked/)).toBeTruthy(); expect(screen.getAllByText('Hidden achievement').length).toBeGreaterThan(0);
  });
});
describe('History screen with recorded days', () => {
  beforeEach(async () => { await db.open(); await replaceAll(db, timeline()); });
  it('renders the calendar from game days, selects a day and explains its outcome', async () => {
    await openHistory(); const cal = screen.getByRole('table', { name: /october 2026/i });
    expect(within(cal).getByRole('button', { name: /^20 October 2026: All quests completed, 2 completed, 0 missed, net \+150 XP$/ })).toBeTruthy();
    expect(within(cal).getByRole('button', { name: /^23 October 2026: Protected rest day/ })).toBeTruthy(); expect(within(cal).getByRole('button', { name: /^24 October 2026: In progress/ }).getAttribute('aria-current')).toBe('date');
    expect(within(cal).getByRole('button', { name: '25 October 2026: future day' }).hasAttribute('disabled')).toBe(true); expect(within(cal).getByRole('button', { name: /^1 October 2026: No data/ })).toBeTruthy();
    await userEvent.click(within(cal).getByRole('button', { name: /^21 October 2026:/ }));
    const detail = screen.getByRole('heading', { name: 'Day 2026-10-21' }).closest('section')!; expect(detail.textContent).toMatch(/Quests missed/); expect(detail.textContent).toMatch(/deducted 10/); expect(within(detail).getByRole('list', { name: /quests on 2026-10-21/i }).textContent).toMatch(/a: missed/i);
    expect(within(detail).getByRole('list', { name: /events on 2026-10-21/i }).textContent).toMatch(/XP DEDUCTED/); expect(await a11y(document.body)).toEqual([]);
  });
  it('limits month navigation to months that can contain data', async () => {
    await openHistory(); expect(screen.getByRole('button', { name: 'Next month' }).hasAttribute('disabled')).toBe(true); expect(screen.getByRole('button', { name: 'Previous month' }).hasAttribute('disabled')).toBe(true); // October is both first and current
  });
  it('charts: weekly and monthly views with data tables that match the ledger total', async () => {
    await openHistory(); await view('Charts'); expect(screen.getByRole('img', { name: /weekly net xp/i })).toBeTruthy(); expect(screen.getByText(/equals your ledger total/i)).toBeTruthy();
    const t = screen.getByRole('table', { name: /weekly xp data/i }); expect(within(t).getAllByRole('row')).toHaveLength(2); await userEvent.click(screen.getByRole('button', { name: 'Monthly' })); expect(screen.getByRole('table', { name: /monthly xp data/i })).toBeTruthy();
    expect(screen.getByRole('table', { name: /quest completion statistics/i }).textContent).toMatch(/50% \(3\/6\)/); expect(screen.getByText(/not counted/i)).toBeTruthy(); expect(await a11y(document.body)).toEqual([]);
  });
  it('ledger: filters by kind, scope and selected day; shows floor-limited amounts', async () => {
    await openHistory(); await view('XP ledger'); expect(await a11y(document.body)).toEqual([]);
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'penalty_deduction'); const rows = () => within(screen.getByRole('table', { name: /xp ledger entries/i })).getAllByRole('row').slice(1);
    expect(rows()).toHaveLength(4); expect(rows().every((r) => /Penalty deduction/.test(r.textContent!))).toBe(true); expect(screen.getByRole('table', { name: /xp ledger entries/i }).textContent).toMatch(/limited by level floor/);
    await userEvent.selectOptions(screen.getByLabelText('Scope'), 'coding'); expect(rows()).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('Kind'), ''); await userEvent.selectOptions(screen.getByLabelText('Scope'), ''); await userEvent.click(screen.getByLabelText(/only the selected day/i)); expect(screen.getByText(/no ledger entries match these filters/i)).toBeTruthy();
  });
  it('system log: categories, newest first, selected-day filter, no duplicate level notifications', async () => {
    await openHistory(); await view('System log'); const items = () => within(screen.getByRole('list', { name: /system events/i })).getAllByRole('listitem');
    const all = items().length; expect(screen.getByRole('status').textContent).toMatch(new RegExp(`of ${all} events`)); expect(items().filter((i) => /LEVEL UP/.test(i.textContent!)).length).toBe(2);
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Penalties'); expect(items()).toHaveLength(2); expect(items()[0]!.textContent).toMatch(/XP DEDUCTED/); expect(await a11y(document.body)).toEqual([]);
  });
  it('achievement gallery separates unlocked, locked and hidden', async () => {
    await openHistory(); await view('Achievements'); const list = screen.getByRole('list', { name: 'Achievements' }); expect(within(list).getByText('First Quest').closest('li')!.textContent).toMatch(/Unlocked/);
    expect(within(list).getAllByText('Hidden achievement').length).toBeGreaterThanOrEqual(4); expect(await a11y(document.body)).toEqual([]);
  });
  it('shows an error state instead of crashing when stored data is unreadable', async () => {
    const p = { ...timeline(), occurrences: null as never }; render(<HistoryScreen db={db} payload={p} refresh={async () => undefined} />);
    expect(await screen.findByText('HISTORY UNAVAILABLE')).toBeTruthy(); expect(screen.getByRole('alert').textContent).toMatch(/not changed/i);
  });
});
