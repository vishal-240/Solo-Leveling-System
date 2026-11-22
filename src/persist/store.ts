// P2: IndexedDB persistence (Dexie), snapshots, atomic import (spec 6.3, 6.5).
import Dexie from 'dexie';
import { gameDayKeyForSettings, type SettingsLike } from '../quests/calendar';
import { COLLECTIONS, SCHEMA_VERSION, SINGLETONS, emptyPayload, validateBackup, validatePayload, type Obj, type Payload, type Result } from './backup';
const TABLES = [...SINGLETONS, ...COLLECTIONS] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
// Narrow table facade: Dexie's generic Table type triggers TS2589 here.
interface T {
  get(k: string): Promise<any>; toArray(): Promise<any[]>; clear(): Promise<void>; bulkAdd(r: unknown[]): Promise<unknown>;
  add(r: unknown): Promise<unknown>; delete(k: string): Promise<void>; bulkPut(r: unknown[]): Promise<unknown>; bulkDelete(k: string[]): Promise<void>; put(r: unknown): Promise<unknown>;
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
async function writePayloadInsideTransaction(db: SlsDb, p: Payload): Promise<void> {
  for (const t of SINGLETONS) { await tbl(db, t).clear(); if (Object.keys(p[t]).length) await tbl(db, t).bulkAdd([{ ...p[t], id: 'singleton' }]); }
  for (const t of COLLECTIONS) { await tbl(db, t).clear(); await tbl(db, t).bulkAdd(p[t]); }
}
export async function replaceAll(db: SlsDb, p: Payload): Promise<void> {
  type Tx = { transaction(m: string, t: string[], f: () => Promise<void>): Promise<void> };
  await (db as unknown as Tx).transaction('rw', [...TABLES], async () => writePayloadInsideTransaction(db, p));
}
/** Atomically read, validate, mutate and write all game tables; used by day close and quest commands. */
export async function mutatePayload<T>(db: SlsDb, mutator: (current: Payload) => { payload: Payload; result: T }): Promise<T> {
  type Tx = { transaction<R>(m: string, t: string[], f: () => Promise<R>): Promise<R> };
  return (db as unknown as Tx).transaction('rw', [...TABLES], async () => {
    await assertOpenable(db);
    const current = await loadPayload(db); const before = fingerprint(current); // taken before the mutator can touch `current`
    const changed = mutator(current);
    const validation = validatePayload(changed.payload, changedIds(before, changed.payload)); // rows untouched by this action are not re-checked against the schema
    if (validation.errors.length) throw new Error(`Refusing to commit invalid payload: ${validation.errors.join('; ')}`);
    await writeChanges(db, before, validation.payload ?? changed.payload); // only changed rows are written, so a single action on years of history stays fast
    return changed.result;
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
  const next = v.value.payload; const grace = transferGraceDays(next, v.value.exportedAt, now);
  next.meta = { ...next.meta, lastImportAt: now.toISOString(), ...(grace.length ? { transferGrace: grace } : {}) };
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

/** D16 transfer grace: unprocessed days from the backup's export day onward, up to the day before the import and at most 3, are exempt so moving devices is not punished. */
export function transferGraceDays(p: Payload, exportedAt: string, now: Date): string[] {
  try {
    const settings = p.settings as SettingsLike; const exportDay = gameDayKeyForSettings(new Date(exportedAt), settings), today = gameDayKeyForSettings(now, settings);
    const last = typeof p.player.lastProcessedDayKey === 'string' ? p.player.lastProcessedDayKey : null; if (!last) return [];
    const out: string[] = []; const t = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 86_400_000; const key = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
    for (let d = Math.max(t(last) + 1, t(exportDay)); d < t(today) && out.length < 3; d++) out.push(key(d)); return out;
  } catch { return []; }
}

type Fingerprint = Map<string, Map<string, string>>;
function fingerprint(p: Payload): Fingerprint {
  const out: Fingerprint = new Map();
  for (const t of SINGLETONS) out.set(t, new Map(Object.keys(p[t]).length ? [['singleton', JSON.stringify(p[t])]] : []));
  for (const t of COLLECTIONS) out.set(t, new Map(p[t].map((r) => [String(r.id), JSON.stringify(r)])));
  return out;
}
/** Writes only the rows that differ from the fingerprint of what was read (puts for new/changed rows, deletes for removed ones). Runs inside the caller's transaction. */
async function writeChanges(db: SlsDb, before: Fingerprint, next: Payload): Promise<void> {
  for (const t of SINGLETONS) {
    const old = before.get(t)!.get('singleton'); const has = Object.keys(next[t]).length > 0; const json = has ? JSON.stringify(next[t]) : undefined;
    if (json === old) continue; if (has) await tbl(db, t).put({ ...next[t], id: 'singleton' }); else await tbl(db, t).delete('singleton');
  }
  for (const t of COLLECTIONS) {
    const old = before.get(t)!; const put: unknown[] = []; const seen = new Set<string>();
    for (const r of next[t]) { const id = String(r.id); seen.add(id); if (old.get(id) !== JSON.stringify(r)) put.push(r); }
    const del = [...old.keys()].filter((id) => !seen.has(id));
    if (del.length) await tbl(db, t).bulkDelete(del); if (put.length) await tbl(db, t).bulkPut(put);
  }
}

function changedIds(before: Fingerprint, next: Payload): Partial<Record<(typeof COLLECTIONS)[number], Set<string>>> {
  const out: Partial<Record<(typeof COLLECTIONS)[number], Set<string>>> = {};
  for (const t of COLLECTIONS) { const old = before.get(t)!; const set = new Set<string>(); for (const r of next[t]) if (old.get(String(r.id)) !== JSON.stringify(r)) set.add(String(r.id)); out[t] = set; }
  return out;
}
