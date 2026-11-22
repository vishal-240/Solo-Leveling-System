import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { bigPayload } from '../perf/dataset';
import { SlsDb, loadPayload, mutatePayload, replaceAll } from './store';

/** Counts rows written per table (Dexie hooks fire for writes inside transactions). */
const counter = (db: SlsDb) => { const ops: Record<string, { create: number; update: number; delete: number }> = {}; const bump = (t: string, k: 'create' | 'update' | 'delete') => { (ops[t] ??= { create: 0, update: 0, delete: 0 })[k]++; };
  for (const t of db.tables.map((x) => x.name)) { db.table(t).hook('creating', () => { bump(t, 'create'); }); db.table(t).hook('updating', () => { bump(t, 'update'); }); db.table(t).hook('deleting', () => { bump(t, 'delete'); }); } return ops; };
const open = async () => { const db = new SlsDb(`inc-${Math.random()}`); await db.open(); return db; };
describe('incremental writes in mutatePayload', () => {
  it('writes only changed rows, handles inserts, updates, deletes and singletons, and leaves the store identical to the mutated payload', async () => {
    const db = await open(); const base = bigPayload(30, 3); await replaceAll(db, base); const ops = counter(db);
    await mutatePayload(db, (p) => { const q = structuredClone(p); q.player.name = 'Renamed'; q.occurrences[0]!.awardedXp = 99; q.systemMessages.splice(5, 2); q.systemMessages.push({ id: 'new', at: '2026-01-01T00:00:00.000Z', kind: 'X', text: 't', read: false }); delete q.meta.seenEvents; return { payload: q, result: 1 }; });
    expect(ops.xpTransactions).toBeUndefined(); expect(ops.occurrences).toEqual({ create: 0, update: 1, delete: 0 }); expect(ops.systemMessages).toEqual({ create: 1, update: 0, delete: 2 });
    const after = await loadPayload(db); expect(after.player.name).toBe('Renamed'); expect(after.meta.seenEvents).toBeUndefined(); expect(after.systemMessages).toHaveLength(base.systemMessages.length - 1); expect(after.systemMessages.at(-1)!.id).toBe('new'); expect(after.xpTransactions).toHaveLength(base.xpTransactions.length);
  });
  it('a no-op mutation writes nothing, and a failed validation writes nothing', async () => {
    const db = await open(); await replaceAll(db, bigPayload(10, 3)); const ops = counter(db);
    await mutatePayload(db, (p) => ({ payload: p, result: 0 })); expect(ops).toEqual({});
    const before = await loadPayload(db); await expect(mutatePayload(db, (p) => { const q = structuredClone(p); q.xpTransactions.find((t) => t.scope === 'player')!.appliedDelta = -1e9; return { payload: q, result: 0 }; })).rejects.toThrow(/Refusing to commit/); expect(await loadPayload(db)).toEqual(before);
  });
  it('rolls back the whole action when a write fails part-way', async () => {
    const db = await open(); await replaceAll(db, bigPayload(10, 3)); const before = await loadPayload(db);
    await expect(mutatePayload(db, (p) => { const q = structuredClone(p); q.player.name = 'X'; q.xpTransactions.push({ ...q.xpTransactions[0]!, id: 'dup' }); return { payload: q, result: 0 }; })).rejects.toThrow(); // duplicate idempotency key
    expect(await loadPayload(db)).toEqual(before);
  });
});
