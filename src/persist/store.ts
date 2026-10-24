// P2: IndexedDB persistence (Dexie), snapshots, atomic import (spec 6.3, 6.5).
import Dexie from 'dexie';
import { COLLECTIONS, SCHEMA_VERSION, SINGLETONS, emptyPayload, validateBackup, validatePayload, type Obj, type Payload, type Result } from './backup';
const TABLES = [...SINGLETONS, ...COLLECTIONS] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
// Narrow table facade: Dexie's generic Table type triggers TS2589 here.
interface T {
  get(k: string): Promise<any>; toArray(): Promise<any[]>; clear(): Promise<void>; bulkAdd(r: unknown[]): Promise<unknown>;
  add(r: unknown): Promise<unknown>; delete(k: string): Promise<void>;
  orderBy(i: string): { toArray(): Promise<any[]>; reverse(): { toArray(): Promise<any[]> } };
}
const tbl = (db: unknown, n: string) => (db as Dexie).table(n) as unknown as T;
export const DB_NAME = 'sls-system-v1'; // unique prefix: GitHub Pages origin is shared (6.3)
export const MAX_SNAPSHOTS = 3;

export class SlsDb extends Dexie {
  constructor(name = DB_NAME) {
    super(name);
    const def: Record<string, string> = { snapshots: 'id,at' };
    for (const t of TABLES) def[t] = t === 'xpTransactions' ? 'id,&idempotencyKey,scope' : 'id';
    this.version(1).stores(def);
  }
}
/** Downgrade protection: refuse a database written by a newer app. */
export async function assertOpenable(db: SlsDb): Promise<void> {
  const meta = await tbl(db, 'meta').get('singleton');
  if (meta && Number(meta.schemaVersion) > SCHEMA_VERSION) throw new Error('Database is newer than this app');
}
export async function loadPayload(db: SlsDb): Promise<Payload> {
  const p = emptyPayload();
  for (const t of SINGLETONS) { const { id: _id, ...rest } = (await tbl(db, t).get('singleton')) ?? { id: '' }; p[t] = rest as Obj; }
  for (const t of COLLECTIONS) p[t] = (await tbl(db, t).toArray()) as Obj[];
  return p;
}
/** Missing data is a fresh install (not an error); present-but-invalid data is reported. */
export async function startupCheck(db: SlsDb): Promise<{ fresh: boolean; errors: string[] }> {
  await assertOpenable(db);
  const p = await loadPayload(db);
  const fresh = Object.keys(p.meta).length === 0;
  return { fresh, errors: fresh ? [] : validatePayload(p).errors };
}
export async function replaceAll(db: SlsDb, p: Payload): Promise<void> {
  type Tx = { transaction(m: string, t: string[], f: () => Promise<void>): Promise<void> };
  await (db as unknown as Tx).transaction('rw', [...TABLES], async () => {
    for (const t of SINGLETONS) { await tbl(db, t).clear(); if (Object.keys(p[t]).length) await tbl(db, t).bulkAdd([{ ...p[t], id: 'singleton' }]); }
    for (const t of COLLECTIONS) { await tbl(db, t).clear(); await tbl(db, t).bulkAdd(p[t]); }
  });
}
export async function takeSnapshot(db: SlsDb, reason: string, now = new Date()): Promise<void> {
  const json = JSON.stringify(await loadPayload(db));
  await tbl(db, 'snapshots').add({ id: `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`, at: now.toISOString(), reason, json });
  const all = await tbl(db, 'snapshots').orderBy('at').toArray();
  for (const s of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) await tbl(db, 'snapshots').delete(s.id);
}
export const listSnapshots = (db: SlsDb) => tbl(db, 'snapshots').orderBy('at').reverse().toArray();
export async function restoreSnapshot(db: SlsDb, id: string): Promise<void> {
  const s = await tbl(db, 'snapshots').get(id);
  if (!s) throw new Error('Snapshot not found');
  const v = validatePayload(JSON.parse(s.json)); // a corrupt snapshot must not become live state
  if (v.errors.length || !v.payload) throw new Error(`Snapshot invalid: ${v.errors.join('; ')}`);
  await replaceAll(db, v.payload);
}
/** Steps 8-11: validate, snapshot current data, atomic replace, post-check with rollback. Never merges. */
export async function importBackup(db: SlsDb, text: string, now = new Date()): Promise<Result<true>> {
  const v = await validateBackup(text);
  if (!v.ok) return v;
  await takeSnapshot(db, 'pre-import', now);
  const before = await loadPayload(db);
  try {
    await replaceAll(db, v.value.payload);
    const errs = validatePayload(await loadPayload(db)).errors;
    if (errs.length) throw new Error(errs.join('; '));
  } catch (e) {
    await replaceAll(db, before);
    return { ok: false, code: 'import_failed', message: String(e) };
  }
  return { ok: true, value: true, warnings: v.warnings };
}
