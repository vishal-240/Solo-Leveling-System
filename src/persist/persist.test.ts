import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as B from './backup';
import * as S from './store';
import { totalXpToReach } from '../engine/progression';

const T = '2026-10-24T10:00:00Z';
const tx = (id: string, o: object = {}) => ({ id, scope: 'player', at: T, dayKey: '2026-10-24', kind: 'quest_award',
  requestedDelta: 50, appliedDelta: 50, idempotencyKey: `k-${id}`, ...o });
const sample = (): B.Payload => {
  const p = B.emptyPayload();
  p.meta = { schemaVersion: 3, appVersion: '1.0.0', installId: 'i1' };
  p.player = { name: 'Vishal', createdAt: T, allocationMode: 'balanced', unspentPoints: 2, streakShields: 1, lastProcessedDayKey: '2026-10-24' };
  p.settings = { timezone: 'Asia/Kolkata', resetTime: '04:00', weekStart: 1, penaltyStrictness: 'strict', effects: 'full', backupReminderDays: 7,
    resetPolicyHistory: [{ effectiveFromDayKey: '2026-10-01', timezone: 'Asia/Kolkata', resetTime: '04:00' }],
    audio: { master: 1, music: 0.5, sfx: 0.8, musicEnabled: false } };
  p.attributes = [{ id: 'coding', xpTotal: 100, level: 2, statPoints: 1 }];
  p.templates = [{ id: 't1', status: 'active', currentVersion: 1 }];
  p.templateVersions = [{ id: 'v1', templateId: 't1', version: 1, effectiveFromDayKey: '2026-10-01', title: 'Study', category: 'academics',
    kind: 'standard', difficulty: 'medium', mandatory: true, important: false, schedule: { type: 'daily' } }];
  p.occurrences = [{ id: 'o1', dayKey: '2026-10-24', source: 'recurring', templateVersionId: 'v1', state: 'COMPLETED', completedAt: T, awardedXp: 100,
    snapshot: { title: 'Study', category: 'coding', kind: 'standard', difficulty: 'medium', mandatory: true, important: false, potentialXp: 100, penaltyTier: 'medium' } }];
  p.timerSessions = [{ id: 's1', occurrenceId: 'o1', status: 'closed', segments: [{ start: T, end: T }], activeMs: 900000, lastHeartbeatAt: T }];
  const total = totalXpToReach(10) + 5;
  p.xpTransactions = [tx('a', { requestedDelta: total, appliedDelta: total }), tx('b', { scope: 'coding', appliedDelta: 100, requestedDelta: 100, occurrenceId: 'o1' })];
  p.levelEvents = [{ id: 'l1', level: 10, at: T }];
  p.rankEvents = [{ id: 'r1', rank: 'D', level: 10, at: T }];
  p.rewardGrants = [{ id: 'g1', source: { type: 'level', ref: 10 }, kind: 'streakShield', amount: 1, at: T }];
  p.streaks = [{ id: 'st1', scope: 'daily', current: 3, longest: 5, lastDayKey: '2026-10-24' }];
  p.penaltyEvents = [{ id: 'pe1', dayKey: '2026-10-23', trigger: 'hard_miss', deductionRequested: 80, deductionApplied: 30, idempotencyKey: 'miss:o0' }];
  p.restDays = [{ id: 'rd1', kind: 'recurring', weekday: 0, declaredAt: T }];
  const sum = { completed: 1, missed: 0, xpEarned: 100, xpForfeited: 0, xpDeducted: 0, restDay: false };
  p.dayRecords = [{ id: '2026-10-23', processedAt: T, dayEndsAt: T, summary: sum }, { id: '2026-10-24', processedAt: T, dayEndsAt: T, summary: sum }];
  p.achievements = [{ id: 'ach1', progress: 1, unlockedAt: T }];
  p.systemMessages = [{ id: 'm1', at: T, kind: 'LEVEL UP', text: 'LEVEL UP', read: false }];
  return p;
};
const now = new Date(T);
const env = async (mut?: (p: B.Payload) => void) => { const p = sample(); mut?.(p); return JSON.parse(await B.exportBackup(p, '1.0.0', now)); };
const code = async (e: unknown) => { const r = await B.validateBackup(typeof e === 'string' ? e : JSON.stringify(e)); return r.ok ? 'ok' : r.code; };
const resign = async (e: any) => { e.payloadSha256 = await B.sha256Hex(B.canonical(e.payload)); return e; };
const errs = (m: (p: any) => void) => { const p = sample(); m(p); return B.validatePayload(p).errors.join('|'); };

describe('schema version and format', () => {
  it('uses schema 3 (spec 6.5) with object singletons and array collections', async () => {
    expect(B.SCHEMA_VERSION).toBe(3);
    const e = await env();
    expect(e).toMatchObject({ format: 'sls-backup', formatVersion: 1, schemaVersion: 3 });
    for (const k of B.SINGLETONS) expect(Array.isArray(e.payload[k])).toBe(false);
    for (const k of B.COLLECTIONS) expect(Array.isArray(e.payload[k])).toBe(true);
  });
  it('fully populated sample is valid and round-trips losslessly', async () => {
    expect(B.validatePayload(sample()).errors).toEqual([]);
    const r = await B.validateBackup(await B.exportBackup(sample(), '1.0.0', now));
    expect(r.ok && r.value.payload).toEqual(sample());
    expect(r.ok && r.value.summary).toMatchObject({ level: 10, rank: 'D', playerName: 'Vishal', lastDayKey: '2026-10-24' });
    expect(r.ok && r.warnings).toEqual([]);
  });
  it('an empty (fresh) payload round-trips', async () => {
    const r = await B.validateBackup(await B.exportBackup(B.emptyPayload(), '1.0.0', now));
    expect(r.ok && r.value.payload).toEqual(B.emptyPayload());
  });
});
describe('every table rejects malformed records (not only missing ids)', () => {
  const bad: Record<string, (p: any) => void> = {
    meta: (p) => { p.meta.schemaVersion = '3'; }, player: (p) => { p.player.name = ''; }, settings: (p) => { p.settings.resetTime = '25:99'; },
    attributes: (p) => { p.attributes[0].level = 99; }, templates: (p) => { p.templates[0].status = 'deleted'; },
    templateVersions: (p) => { p.templateVersions[0].schedule = { type: 'weekdays', days: [9] }; },
    occurrences: (p) => { p.occurrences[0].state = 'DONE'; }, timerSessions: (p) => { p.timerSessions[0].activeMs = -1; },
    xpTransactions: (p) => { p.xpTransactions[0].at = 'yesterday'; }, levelEvents: (p) => { p.levelEvents[0].level = 1; },
    rankEvents: (p) => { p.rankEvents[0].rank = 'E'; }, rewardGrants: (p) => { p.rewardGrants[0].kind = 'gold'; },
    streaks: (p) => { p.streaks[0].longest = 1; }, penaltyEvents: (p) => { p.penaltyEvents[0].deductionApplied = 999; },
    restDays: (p) => { p.restDays[0] = { id: 'rd1', kind: 'adhoc', declaredAt: T }; },
    dayRecords: (p) => { p.dayRecords[0].summary.missed = -1; }, achievements: (p) => { p.achievements[0].progress = 'x'; },
    systemMessages: (p) => { p.systemMessages[0].read = 'no'; },
  };
  it('covers all 18 tables', () => expect(Object.keys(bad).sort()).toEqual([...B.SINGLETONS, ...B.COLLECTIONS].sort()));
  it.each(Object.keys(bad))('%s', (t) => {
    const p = sample(); bad[t]!(p);
    const r = B.validatePayload(p);
    expect(r.stage).toBe('schema');
    expect(r.errors.join('|')).toContain(t);
  });
  it('rejects nested/unknown values and impossible dates and timezones', () => {
    expect(errs((p) => { p.occurrences[0].snapshot.penaltyTier = 'extreme'; })).toMatch(/occurrences/);
    expect(errs((p) => { p.dayRecords[1].id = '2026-02-30'; })).toMatch(/dayRecords/);
    expect(errs((p) => { p.settings.timezone = 'Mars/Base'; })).toMatch(/settings/);
    expect(errs((p) => { p.templateVersions[0].kind = 'timed'; })).toMatch(/templateVersions/);
    expect(errs((p) => { p.templateVersions[0].important = true; p.templateVersions[0].mandatory = false; })).toMatch(/templateVersions/);
    expect(errs((p) => { p.xpTransactions[0].scope = 'nonsense'; })).toMatch(/xpTransactions/);
  });
  it('later-phase optional fields may be absent', () => {
    // This fixture tests optional fields, not a broken day-close cursor. When the
    // player cursor is absent, keep history empty; a separate invariant test below
    // verifies that existing day records require a matching lastProcessedDayKey.
    expect(errs((p) => { p.player = { name: 'V' }; p.settings = {}; p.restDays = []; p.dayRecords = []; p.attributes[0] = { id: 'coding', xpTotal: 100, level: 2 }; })).toBe('');
  });
});
describe('envelope and summary validation', () => {
  it('invalid envelope fields', async () => {
    const e = await env();
    expect(await code('{nope')).toBe('not_json');
    expect(await code('null')).toBe('bad_format');
    expect(await code({ ...e, format: 'x' })).toBe('bad_format');
    expect(await code({ ...e, formatVersion: 9 })).toBe('bad_format_version');
    for (const patch of [{ schemaVersion: 0 }, { schemaVersion: 3.5 }, { appVersion: 'x' }, { exportedAt: 'nope' }, { payloadSha256: 'abc' },
      { summary: { ...e.summary, rank: 'Z' } }, { summary: null }, { payload: 5 }])
      expect(await code({ ...e, ...patch })).toBe('bad_envelope');
    const m = structuredClone(e); delete m.exportedAt; expect(await code(m)).toBe('bad_envelope');
    expect(await code('x'.repeat(B.MAX_BACKUP_BYTES + 1))).toBe('too_large');
  });
  it('newer and unsupported-old schemas', async () => {
    const e = await env();
    expect(await code({ ...e, schemaVersion: 4 })).toBe('newer_schema');
    expect(await code({ ...e, schemaVersion: 2 })).toBe('old_schema');
  });
  it('rejects conflicting envelope and payload meta schema versions', async () => {
    const e = await env((p) => { p.meta.schemaVersion = 4; });
    expect(await code(await resign(e))).toBe('schema_mismatch');
    const fresh = await B.exportBackup(B.emptyPayload(), '1.0.0', now);
    expect((await B.validateBackup(fresh)).ok).toBe(true);
  });
  it.each(['playerName', 'level', 'rank', 'totalXp', 'lastDayKey'] as const)('mismatched summary.%s is rejected', async (k) => {
    const e = await env();
    e.summary[k] = { playerName: 'Eve', level: 11, rank: 'C', totalXp: 1, lastDayKey: '2026-01-01' }[k];
    expect(await code(e)).toBe('summary_mismatch');
  });
  it('checksum covers the canonical payload; key order does not matter', async () => {
    const e = await env(); const shuffled = { ...e, payload: Object.fromEntries(Object.entries(e.payload).reverse()) };
    expect(await code(shuffled)).toBe('ok');
    e.payload.xpTransactions[0].appliedDelta += 1; expect(await code(e)).toBe('checksum');
  });
  it('schema/table errors still caught when the checksum is valid', async () => {
    const e1 = await env(); delete e1.payload.occurrences; expect(await code(await resign(e1))).toBe('invalid_schema');
    const e2 = await env(); e2.payload.meta = []; expect(await code(await resign(e2))).toBe('invalid_schema');
  });
});
describe('references, invariants, ledger and caches', () => {
  it('referential integrity', () => {
    expect(errs((p) => { p.occurrences[0].templateVersionId = 'nope'; })).toMatch(/dangling templateVersionId/);
    expect(errs((p) => { p.templateVersions[0].templateId = 'nope'; })).toMatch(/dangling templateId/);
    expect(errs((p) => { p.timerSessions[0].occurrenceId = 'nope'; })).toMatch(/timerSessions: dangling/);
    expect(errs((p) => { p.xpTransactions[1].occurrenceId = 'nope'; })).toMatch(/xpTransactions: dangling/);
    expect(errs((p) => { p.penaltyEvents[0].occurrenceId = 'nope'; })).toMatch(/penaltyEvents: dangling/);
  });
  it('invariants', () => {
    expect(errs((p) => { p.xpTransactions[0].appliedDelta = -5; })).toMatch(/negative/);
    expect(errs((p) => { p.xpTransactions[1].idempotencyKey = 'k-a'; })).toMatch(/idempotency/);
    expect(errs((p) => { p.xpTransactions.push(tx('c', { occurrenceId: 'o1' }), tx('d', { occurrenceId: 'o1' })); })).toMatch(/award count|second award/);
    expect(errs((p) => { p.xpTransactions.push(tx('c', { occurrenceId: 'o1', kind: 'penalty_deduction' }), tx('d', { occurrenceId: 'o1', kind: 'penalty_deduction' })); })).toMatch(/deduction/);
    expect(errs((p) => { p.dayRecords[0].id = '2026-10-21'; })).toMatch(/sequential/);
    expect(errs((p) => { p.player.lastProcessedDayKey = '2026-10-20'; })).toMatch(/lastProcessedDayKey/);
    expect(errs((p) => { delete p.player.lastProcessedDayKey; })).toMatch(/lastProcessedDayKey/);
    expect(errs((p) => { p.levelEvents = [{ id: 'l1', level: 5, at: '2026-10-02T00:00:00Z' }, { id: 'l2', level: 4, at: '2026-10-03T00:00:00Z' }]; })).toMatch(/level decreased/);
    expect(errs((p) => { p.attributes.push({ ...p.attributes[0] }); })).toMatch(/duplicate ids/);
  });
  it('permits one award, one undo, and one second completion per ledger scope', () => {
    const p = sample();
    // Existing coding/o1 award is the first completion.
    p.xpTransactions.push(tx('rev-coding', { scope: 'coding', occurrenceId: 'o1', kind: 'reversal', appliedDelta: -100, requestedDelta: -100,
      at: '2026-10-24T10:01:00Z', idempotencyKey: 'o1:reversal:coding' }));
    p.xpTransactions.push(tx('again-coding', { scope: 'coding', occurrenceId: 'o1', appliedDelta: 100,
      at: '2026-10-24T10:02:00Z', idempotencyKey: 'o1:award2:coding' }));
    // Paired player ledger entry for the same user action has its own per-scope sequence.
    p.xpTransactions.push(tx('player-award', { occurrenceId: 'o1', appliedDelta: 50, idempotencyKey: 'o1:award:player' }));
    p.xpTransactions.push(tx('player-reversal', { occurrenceId: 'o1', kind: 'reversal', appliedDelta: -50, requestedDelta: -50,
      at: '2026-10-24T10:01:00Z', idempotencyKey: 'o1:reversal:player' }));
    p.xpTransactions.push(tx('player-award2', { occurrenceId: 'o1', appliedDelta: 50,
      at: '2026-10-24T10:02:00Z', idempotencyKey: 'o1:award2:player' }));
    expect(B.checkInvariants(p)).toEqual([]);
  });
  it('rejects repeated undo/recompletion cycles', () => {
    const p = sample();
    p.xpTransactions.push(tx('rev-1', { scope: 'coding', occurrenceId: 'o1', kind: 'reversal', appliedDelta: -100, requestedDelta: -100,
      at: '2026-10-24T10:01:00Z', idempotencyKey: 'o1:reversal1:coding' }));
    p.xpTransactions.push(tx('award-2', { scope: 'coding', occurrenceId: 'o1', at: '2026-10-24T10:02:00Z', idempotencyKey: 'o1:award2:coding' }));
    p.xpTransactions.push(tx('rev-2', { scope: 'coding', occurrenceId: 'o1', kind: 'reversal', appliedDelta: -100, requestedDelta: -100,
      at: '2026-10-24T10:03:00Z', idempotencyKey: 'o1:reversal2:coding' }));
    p.xpTransactions.push(tx('award-3', { scope: 'coding', occurrenceId: 'o1', at: '2026-10-24T10:04:00Z', idempotencyKey: 'o1:award3:coding' }));
    expect(B.checkInvariants(p).join('|')).toMatch(/award count|reversal is not valid/);
  });
  it('does not permit a partial bank and completion award for the same occurrence', () => {
    const p = sample();
    p.xpTransactions.push(tx('bank-coding', { scope: 'coding', occurrenceId: 'o1', kind: 'partial_bank',
      at: '2026-10-24T10:01:00Z', idempotencyKey: 'o1:partial:coding' }));
    expect(B.checkInvariants(p).join('|')).toMatch(/partial bank and completion/);
  });
  it('stale caches are repaired and reported; the repaired payload is returned', async () => {
    const e = await env((p) => { p.attributes[0]!.xpTotal = 99999; p.player.xpTotal = 1; });
    const r = await B.validateBackup(JSON.stringify(e));
    expect(r.ok && r.warnings).toEqual(['attribute coding cache repaired', 'player cache repaired']);
    expect(r.ok && r.value.payload.attributes[0]).toMatchObject({ xpTotal: 100, level: 2 });
  });
});
describe('migrations', () => {
  it('runs each step in order and fails loudly when one is missing', () => {
    const t: B.Migrations = { 3: (p) => ({ ...p, meta: { ...p.meta, a: 1 } }), 4: (p) => ({ ...p, meta: { ...p.meta, b: (p.meta.a as number) + 1 } }) };
    expect(B.migrate(sample(), 3, 5, t).meta).toMatchObject({ a: 1, b: 2 });
    expect(() => B.migrate(sample(), 3, 5, { 3: (p) => p })).toThrow(/missing migration 4->5/);
    expect(B.migrate(sample(), 3).meta).toEqual(sample().meta);
  });
  it('backup reminder interval', () => {
    expect(B.backupDue(undefined, now)).toBe(true);
    expect(B.backupDue('2026-10-20T00:00:00Z', now, 7)).toBe(false);
    expect(B.backupDue('2026-10-01T00:00:00Z', now, 7)).toBe(true);
  });
});
let db: S.SlsDb;
beforeEach(async () => { db = new S.SlsDb(`t-${Math.random()}`); await db.open(); });
describe('store', () => {
  it('fresh install, persistence across reopen, lossless load', async () => {
    expect(await S.startupCheck(db)).toEqual({ fresh: true, errors: [] });
    await S.replaceAll(db, sample());
    db.close(); await db.open();
    expect(await S.startupCheck(db)).toEqual({ fresh: false, errors: [] });
    expect(await S.loadPayload(db)).toEqual(sample());
  });
  it('downgrade protection and invalid saved data', async () => {
    const p = sample(); p.meta = { schemaVersion: 4, appVersion: '9.0.0' }; await S.replaceAll(db, p);
    await expect(S.assertOpenable(db)).rejects.toThrow(/newer/);
    const q = sample(); q.xpTransactions[0]!.appliedDelta = -1e9; await S.replaceAll(db, q);
    expect((await S.startupCheck(db)).errors.join()).toMatch(/negative/);
  });
  it('export -> import on a clean DB reproduces identical state', async () => {
    const text = await B.exportBackup(sample(), '1.0.0', now);
    expect((await S.importBackup(db, text)).ok).toBe(true);
    expect(await S.loadPayload(db)).toEqual(sample());
  });
  it('import replaces data, snapshots first, keeps 3 snapshots', async () => {
    await S.replaceAll(db, sample());
    const next = sample(); next.player = { name: 'Other', lastProcessedDayKey: '2026-10-24' };
    const text = await B.exportBackup(next, '1.0.0', now);
    for (let i = 0; i < 5; i++) expect((await S.importBackup(db, text, new Date(now.getTime() + i))).ok).toBe(true);
    expect((await S.loadPayload(db)).player.name).toBe('Other');
    expect(await S.listSnapshots(db)).toHaveLength(3);
  });
  it('rejected imports change nothing and take no snapshot', async () => {
    await S.replaceAll(db, sample());
    const e = await env(); e.payload.player.name = 'Evil';
    const lie = await env(); lie.summary.level = 50;
    const mismatch = await env((p) => { p.meta.schemaVersion = 4; }); await resign(mismatch);
    for (const bad of [JSON.stringify(e), JSON.stringify(lie), JSON.stringify(mismatch), '{"format":"sls-backup"}', JSON.stringify({ ...(await env()), schemaVersion: 9 })])
      expect((await S.importBackup(db, bad)).ok).toBe(false);
    expect(await S.loadPayload(db)).toEqual(sample());
    expect(await S.listSnapshots(db)).toHaveLength(0);
  });
  it('a failing atomic replace rolls back completely', async () => {
    await S.replaceAll(db, sample());
    const bad = sample(); bad.occurrences = [{ id: 'x' }, { id: 'x' }];
    await expect(S.replaceAll(db, bad)).rejects.toThrow();
    expect(await S.loadPayload(db)).toEqual(sample());
  });
  it('snapshot restore recovers state but refuses a corrupt snapshot', async () => {
    await S.replaceAll(db, sample());
    await S.takeSnapshot(db, 'manual', now);
    await S.replaceAll(db, B.emptyPayload());
    await S.restoreSnapshot(db, (await S.listSnapshots(db))[0]!.id);
    expect(await S.loadPayload(db)).toEqual(sample());
    const bad = sample(); bad.xpTransactions[0]!.appliedDelta = -5;
    await (db as any).table('snapshots').add({ id: 'zz', at: '2099-01-01', reason: 'x', json: JSON.stringify(bad) });
    await expect(S.restoreSnapshot(db, 'zz')).rejects.toThrow(/Snapshot invalid/);
    expect(await S.loadPayload(db)).toEqual(sample());
  });
});
