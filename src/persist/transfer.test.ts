import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { exportBackup } from './backup';
import { SlsDb, importBackup, loadPayload, transferGraceDays } from './store';
import { closeDayPayload } from '../quests/dayClose';
import { at, timeline } from '../history/testFixture';

describe('D16 transfer grace after a backup import', () => {
  it('protects up to 3 unprocessed days from the backup day, never today or processed days', async () => {
    const p = timeline(); const iso = at('2026-10-24', 11).toISOString();
    expect(transferGraceDays(p, iso, at('2026-10-30', 10))).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']); // capped at 3
    expect(transferGraceDays(p, iso, at('2026-10-26', 10))).toEqual(['2026-10-24', '2026-10-25']);
    expect(transferGraceDays(p, iso, at('2026-10-24', 12))).toEqual([]); // imported the same game day: nothing to forgive
    expect(transferGraceDays({ ...p, player: {} }, iso, at('2026-10-30', 10))).toEqual([]);
  });
  it('exempts exactly those days at the next day close and penalises later missed days normally', async () => {
    const db = new SlsDb(`tg-${Math.random()}`); await db.open(); const text = await exportBackup(timeline(), '1.0.0', at('2026-10-24', 11));
    const r = await importBackup(db, text, at('2026-10-30', 10)); expect(r.ok).toBe(true); const imported = await loadPayload(db); expect(imported.meta.transferGrace).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    const closed = closeDayPayload(imported, at('2026-10-30', 11)).payload; const state = (d: string, title: string) => closed.occurrences.find((o) => o.dayKey === d && (o.snapshot as { title: string }).title === title)?.state;
    expect(['2026-10-24', '2026-10-25', '2026-10-26'].map((d) => state(d, 'A'))).toEqual(['EXEMPT', 'EXEMPT', 'EXEMPT']); expect(['2026-10-27', '2026-10-28', '2026-10-29'].map((d) => state(d, 'A'))).toEqual(['MISSED', 'MISSED', 'MISSED']);
    const days = closed.xpTransactions.filter((t) => t.kind === 'penalty_deduction' && String(t.dayKey) >= '2026-10-24').map((t) => String(t.dayKey));
    expect(days.some((d) => ['2026-10-24', '2026-10-25', '2026-10-26'].includes(d))).toBe(false);
    const again = closeDayPayload(closed, at('2026-10-30', 12)).payload; expect(again.xpTransactions).toEqual(closed.xpTransactions); // retry is idempotent
  });
  it('a rejected import grants no grace and changes nothing', async () => {
    const db = new SlsDb(`tg2-${Math.random()}`); await db.open(); const before = await loadPayload(db); const r = await importBackup(db, '{"format":"nope"}', at('2026-10-30', 10)); expect(r.ok).toBe(false); expect(await loadPayload(db)).toEqual(before);
  });
});
