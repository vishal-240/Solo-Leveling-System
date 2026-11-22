// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { exportBackupText } from '../app/actions';
import { timeline } from '../history/testFixture';
import { SlsDb, loadPayload, replaceAll } from '../persist/store';

let from: SlsDb; let to: SlsDb;
beforeEach(async () => {
  window.localStorage.clear(); window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  if (!File.prototype.text) File.prototype.text = function (this: Blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsText(this); }); };
  from = new SlsDb(`rf-${Math.random()}`); to = new SlsDb(`rt-${Math.random()}`); await from.open(); await to.open();
});
afterEach(cleanup);
describe('restoring after a wipe or on a new device', () => {
  it('offers restore on the first screen, previews the file, restores everything once and does not replay old events', async () => {
    await replaceAll(from, timeline()); const original = await loadPayload(from); const text = await exportBackupText(from, new Date(Date.now() - 5 * 86_400_000)); // exported 5 days ago: the days since then get the transfer grace
    render(<App db={to} />); await screen.findByRole('heading', { name: /player awakening/i }); expect((screen.getByRole('button', { name: 'Restore this backup' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), new File(['nope'], 'bad.json', { type: 'application/json' })); expect(await screen.findByText(/Restore refused \(not_json\)/)).toBeTruthy(); expect(await loadPayload(to)).toMatchObject({ meta: {} });
    await userEvent.upload(screen.getByLabelText(/choose a backup file/i), new File([text], 'ok.json', { type: 'application/json' })); expect((await screen.findByLabelText('Backup preview')).textContent).toMatch(/V: rank E, level 3/);
    await userEvent.click(screen.getByRole('button', { name: 'Restore this backup' })); expect(await screen.findByRole('heading', { name: /^quests$/i, level: 1 })).toBeTruthy(); await new Promise((r) => setTimeout(r, 100));
    const restored = await loadPayload(to); const ids = (rows: { id?: unknown }[]) => rows.map((r) => String(r.id)).sort();
    // every original row is present exactly once; the only additions are the game days that passed since the backup (processed once, with the 3-day transfer grace)
    for (const t of ['xpTransactions', 'levelEvents', 'rewardGrants', 'occurrences'] as const) { expect(ids(restored[t])).toEqual(expect.arrayContaining(ids(original[t]))); expect(new Set(ids(restored[t])).size).toBe(restored[t].length); }
    expect(ids(restored.levelEvents)).toEqual(ids(original.levelEvents)); expect(ids(restored.rewardGrants)).toEqual(ids(original.rewardGrants)); expect(restored.meta.transferGrace).toHaveLength(3);
    expect(new Set(restored.xpTransactions.map((t) => t.idempotencyKey)).size).toBe(restored.xpTransactions.length);
    expect(screen.queryByRole('dialog')).toBeNull(); // restored history is baselined, never replayed as a cinematic
  });
});
