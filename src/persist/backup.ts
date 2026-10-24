// P2: backup envelope, validation pipeline and migrations (spec 6.5, section 4 invariants). Pure; no storage access.
import { z } from 'zod';
import { attrLevelFromXp, levelFromXp, rankForLevel } from '../engine/progression';

export const FORMAT = 'sls-backup';
export const FORMAT_VERSION = 1;
/** Current schema: 3, as in the frozen spec's 6.5 example (no approved decision sets another). Schemas 1-2 were never
 *  released, so there is no migration path from them and backups below MIN_SUPPORTED_SCHEMA are rejected. */
export const SCHEMA_VERSION = 3;
export const MIN_SUPPORTED_SCHEMA = 3;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024; // spec requires a size check but gives no number: chosen here
export const SINGLETONS = ['meta', 'player', 'settings'] as const; // objects in the payload (6.5)
export const COLLECTIONS = ['attributes', 'templates', 'templateVersions', 'occurrences', 'timerSessions', 'xpTransactions',
  'levelEvents', 'rankEvents', 'rewardGrants', 'streaks', 'penaltyEvents', 'restDays', 'dayRecords', 'achievements',
  'systemMessages'] as const; // arrays
export type Obj = Record<string, unknown>;
export type Collection = (typeof COLLECTIONS)[number];
export type Payload = { meta: Obj; player: Obj; settings: Obj } & { [K in Collection]: Obj[] };
export interface Summary { playerName: string; level: number; rank: string; totalXp: number; lastDayKey: string }
export interface Envelope {
  format: string; formatVersion: number; schemaVersion: number; appVersion: string; exportedAt: string;
  summary: Summary; payloadSha256: string; payload: Payload;
}
export type Result<T> = { ok: true; value: T; warnings?: string[] } | { ok: false; code: string; message: string };

export const emptyPayload = (): Payload => ({ meta: {}, player: {}, settings: {},
  ...Object.fromEntries(COLLECTIONS.map((c) => [c, []])) } as Payload);

// ---- Zod schemas for every table (data model, spec section 4). Later-phase fields are optional. ----
const id = z.string().min(1);
const iso = z.iso.datetime({ offset: true });
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((k) => new Date(`${k}T00:00:00Z`).toISOString().startsWith(k), 'not a real date');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const nn = z.number().int().min(0);
const ATTR = z.enum(['academics', 'fitness', 'coding', 'discipline', 'recovery']);
const tz = z.string().refine((t) => { try { new Intl.DateTimeFormat('en', { timeZone: t }); return true; } catch { return false; } }, 'unknown timezone');
const tier = z.enum(['easy', 'medium', 'hard']);
const kind = z.enum(['standard', 'timed']);
const obj = z.looseObject;
const schedule = z.discriminatedUnion('type', [
  obj({ type: z.literal('daily') }), obj({ type: z.literal('weekly') }),
  obj({ type: z.literal('weekdays'), days: z.array(z.number().int().min(0).max(6)).min(1) }),
  obj({ type: z.literal('everyNDays'), n: z.number().int().min(1), anchorDayKey: dayKey }),
]);
const snapshot = obj({ title: z.string().min(1), category: ATTR, kind, difficulty: tier.optional(),
  targetBlocks: z.number().int().min(1).max(8).optional(), mandatory: z.boolean(), important: z.boolean(),
  potentialXp: nn, penaltyTier: tier });
const SINGLETON_SCHEMAS = {
  meta: z.union([obj({}).refine((o) => Object.keys(o).length === 0), obj({ schemaVersion: z.number().int().min(1), appVersion: z.string().min(1),
    installId: z.string().optional(), lastExportAt: iso.optional(), lastImportAt: iso.optional() })]),
  player: z.union([obj({}).refine((o) => Object.keys(o).length === 0), obj({ name: z.string().min(1), createdAt: iso.optional(),
    allocationMode: z.enum(['manual', 'balanced', 'momentum']).optional(), unspentPoints: nn.optional(),
    streakShields: z.number().int().min(0).max(3).optional(), queuedShields: nn.optional(), equippedTitleId: z.string().optional(),
    equippedFrameId: z.string().optional(), lastProcessedDayKey: dayKey.optional() })]),
  settings: obj({ timezone: tz.optional(), resetTime: hhmm.optional(), weekStart: z.number().int().min(0).max(6).optional(),
    resetPolicyHistory: z.array(obj({ effectiveFromDayKey: dayKey, timezone: tz, resetTime: hhmm })).optional(),
    penaltyStrictness: z.literal('strict').optional(), effects: z.enum(['full', 'reduced', 'minimal']).optional(),
    audio: obj({ master: z.number().min(0).max(1), music: z.number().min(0).max(1), sfx: z.number().min(0).max(1), musicEnabled: z.boolean() }).optional(),
    backupReminderDays: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).optional(), lastBackupAt: iso.optional() }),
};
const schemas: Record<Collection, z.ZodTypeAny> = {
  attributes: obj({ id: ATTR, xpTotal: nn, level: z.number().int().min(1).max(50), statPoints: nn.optional() }),
  templates: obj({ id, status: z.enum(['active', 'paused', 'archived']), currentVersion: z.number().int().min(1).optional(), createdAt: iso.optional() }),
  templateVersions: obj({ id, templateId: id, version: z.number().int().min(1).optional(), effectiveFromDayKey: dayKey,
    title: z.string().min(1), category: ATTR, kind, difficulty: tier.optional(), targetBlocks: z.number().int().min(1).max(8).optional(),
    mandatory: z.boolean(), important: z.boolean(), deadlineTime: hhmm.optional(), schedule,
    pausedFromDayKey: dayKey.optional(), resumeDayKey: dayKey.optional() })
    .refine((t) => (t.kind === 'timed' ? t.targetBlocks !== undefined : t.difficulty !== undefined), 'timed needs targetBlocks, standard needs difficulty')
    .refine((t) => !t.important || t.mandatory, 'important implies mandatory'),
  occurrences: obj({ id, dayKey, dueDayKey: dayKey.optional(), source: z.enum(['recurring', 'oneoff', 'penalty', 'rest']),
    templateVersionId: z.string().min(1).optional(), snapshot,
    state: z.enum(['OPEN', 'COMPLETED', 'PARTIAL', 'SKIPPED', 'MISSED', 'LAPSED', 'EXEMPT']),
    completedAt: iso.optional(), awardedXp: nn.optional() }),
  timerSessions: obj({ id, occurrenceId: id, status: z.enum(['running', 'paused', 'closed']),
    segments: z.array(obj({ start: iso, end: iso.optional() })), activeMs: z.number().min(0), lastHeartbeatAt: iso,
    gapAdjustmentsMs: z.array(z.number().min(0)).optional() }),
  xpTransactions: obj({ id, at: iso, dayKey, scope: z.union([z.literal('player'), ATTR]),
    kind: z.enum(['quest_award', 'partial_bank', 'reversal', 'penalty_deduction']), occurrenceId: z.string().min(1).optional(),
    requestedDelta: z.number().int(), appliedDelta: z.number().int(), idempotencyKey: id }),
  levelEvents: obj({ id, level: z.number().int().min(2), at: iso, totalXp: nn.optional() }),
  rankEvents: obj({ id, rank: z.enum(['D', 'C', 'B', 'A', 'S']), level: z.number().int().min(10), at: iso }),
  rewardGrants: obj({ id, source: obj({ type: z.enum(['level', 'rank', 'achievement']), ref: z.union([z.string(), z.number()]) }),
    kind: z.enum(['attributePoints', 'statPoints', 'title', 'badge', 'cosmetic', 'streakShield', 'levelMark']),
    itemId: z.string().optional(), amount: nn.optional(), at: iso }),
  streaks: obj({ id, scope: z.string().min(1), current: nn, longest: nn, lastDayKey: dayKey.optional() })
    .refine((s) => s.longest >= s.current, 'longest < current'),
  penaltyEvents: obj({ id, dayKey, trigger: z.enum(['hard_miss', 'important_miss', 'repeat_failure']), occurrenceId: z.string().min(1).optional(),
    deductionRequested: nn, deductionApplied: nn, penaltyOccurrenceId: z.string().min(1).optional(), idempotencyKey: id })
    .refine((e) => e.deductionApplied <= e.deductionRequested, 'applied exceeds requested'),
  restDays: obj({ id, kind: z.enum(['recurring', 'adhoc']), weekday: z.number().int().min(0).max(6).optional(), dayKey: dayKey.optional(), declaredAt: iso })
    .refine((r) => (r.kind === 'recurring' ? r.weekday !== undefined : r.dayKey !== undefined), 'recurring needs weekday, adhoc needs dayKey'),
  dayRecords: obj({ id: dayKey, processedAt: iso, dayEndsAt: iso, summary: obj({ completed: nn, missed: nn, xpEarned: nn, xpForfeited: nn, xpDeducted: nn, restDay: z.boolean() }) }),
  achievements: obj({ id, progress: z.number().min(0), unlockedAt: iso.optional() }),
  systemMessages: obj({ id, at: iso, kind: z.string().min(1), text: z.string(), read: z.boolean() }),
};
const payloadSchema = z.object({ ...SINGLETON_SCHEMAS, ...Object.fromEntries(COLLECTIONS.map((c) => [c, z.array(schemas[c])])) });
const envelopeSchema = z.object({
  format: z.literal(FORMAT), formatVersion: z.literal(FORMAT_VERSION), schemaVersion: z.number().int().min(1),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+/), exportedAt: iso,
  summary: z.object({ playerName: z.string(), level: z.number().int().min(1), rank: z.enum(['E', 'D', 'C', 'B', 'A', 'S']),
    totalXp: nn, lastDayKey: z.union([z.literal(''), dayKey]) }),
  payloadSha256: z.string().regex(/^[0-9a-f]{64}$/), payload: z.record(z.string(), z.unknown()),
});

export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Obj)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sumFor = (p: Payload, scope: string) =>
  p.xpTransactions.filter((t) => t.scope === scope).reduce((s, t) => s + (Number(t.appliedDelta) || 0), 0);
export const playerTotalXp = (p: Payload) => sumFor(p, 'player');

export function summarize(p: Payload): Summary {
  const total = playerTotalXp(p);
  const level = levelFromXp(total);
  return { playerName: String(p.player.name ?? ''), level, rank: rankForLevel(level), totalXp: total,
    lastDayKey: String(p.player.lastProcessedDayKey ?? '') };
}

// ---- Step 5: referential integrity ----
export function checkReferences(p: Payload): string[] {
  const ids = (c: Collection) => new Set(p[c].map((r) => r.id));
  const [tpl, ver, occ] = [ids('templates'), ids('templateVersions'), ids('occurrences')];
  const e: string[] = [];
  const need = (rows: Obj[], key: string, set: Set<unknown>, label: string, optional = false) => {
    for (const r of rows) if ((r[key] !== undefined || !optional) && !set.has(r[key])) e.push(`${label}: dangling ${key} ${String(r[key])}`);
  };
  need(p.templateVersions, 'templateId', tpl, 'templateVersions');
  need(p.occurrences.filter((o) => o.templateVersionId !== undefined), 'templateVersionId', ver, 'occurrences');
  need(p.timerSessions, 'occurrenceId', occ, 'timerSessions');
  need(p.xpTransactions.filter((t) => t.occurrenceId !== undefined), 'occurrenceId', occ, 'xpTransactions');
  need(p.penaltyEvents.filter((t) => t.occurrenceId !== undefined), 'occurrenceId', occ, 'penaltyEvents');
  return e;
}

// ---- Step 6: invariants and ledger reconciliation (section 4) ----
const dayNum = (k: string) => Date.parse(`${k}T00:00:00Z`) / 86_400_000;
export function checkInvariants(p: Payload): string[] {
  const e: string[] = [];
  for (const c of COLLECTIONS) if (new Set(p[c].map((r) => r.id)).size !== p[c].length) e.push(`table ${c} has duplicate ids`);
  const keys = p.xpTransactions.map((t) => t.idempotencyKey);
  if (new Set(keys).size !== keys.length) e.push('idempotency keys not unique');
  if (playerTotalXp(p) < 0) e.push('player XP negative');

  // Validate occurrence ledgers independently per scope. A single user action can
  // legitimately append paired player + attribute rows; counting those together
  // would falsely report a duplicate award.
  const byOccScope = new Map<string, { occurrenceId: string; scope: string; rows: Obj[] }>();
  for (const t of p.xpTransactions) {
    if (typeof t.occurrenceId !== 'string') continue;
    const key = `${t.occurrenceId}\u0000${String(t.scope)}`;
    const group = byOccScope.get(key) ?? { occurrenceId: t.occurrenceId, scope: String(t.scope), rows: [] };
    group.rows.push(t);
    byOccScope.set(key, group);
  }
  for (const { occurrenceId, scope, rows } of byOccScope.values()) {
    const deductions = rows.filter((t) => t.kind === 'penalty_deduction');
    if (deductions.length > 1) e.push(`occurrence ${occurrenceId} scope ${scope}: more than one deduction`);

    // Completion may be awarded once, reversed once within the undo window, and
    // completed once more. It cannot then be reversed/re-completed indefinitely.
    // partial_bank is tracked separately: it is not a completion award.
    const completionEvents = rows
      .filter((t) => t.kind === 'quest_award' || t.kind === 'reversal')
      .map((t, index) => ({ t, index }))
      .sort((a, b) => String(a.t.at).localeCompare(String(b.t.at)) || a.index - b.index);
    const completionAwards = completionEvents.filter(({ t }) => t.kind === 'quest_award').length;
    const reversals = completionEvents.filter(({ t }) => t.kind === 'reversal').length;
    let awardsSeen = 0;
    let reversalsSeen = 0;
    let lastWasReversal = false;
    for (const { t } of completionEvents) {
      if (t.kind === 'quest_award') {
        awardsSeen++;
        if (awardsSeen === 1) {
          if (reversalsSeen !== 0) e.push(`occurrence ${occurrenceId} scope ${scope}: reversal precedes first award`);
        } else if (awardsSeen === 2) {
          if (reversalsSeen !== 1 || !lastWasReversal)
            e.push(`occurrence ${occurrenceId} scope ${scope}: second award requires one preceding reversal`);
        } else {
          e.push(`occurrence ${occurrenceId} scope ${scope}: award count exceeds allowed undo/recompletion sequence`);
        }
        lastWasReversal = false;
      } else if (t.kind === 'reversal') {
        reversalsSeen++;
        if (reversalsSeen > 1 || awardsSeen !== 1 || lastWasReversal)
          e.push(`occurrence ${occurrenceId} scope ${scope}: reversal is not valid in the award sequence`);
        lastWasReversal = true;
      }
    }
    if (completionAwards === 0 && reversals > 0) {
      // The loop above reports this too; this explicit invariant makes the error clear.
      e.push(`occurrence ${occurrenceId} scope ${scope}: reversal has no award`);
    }
    const partialBanks = rows.filter((t) => t.kind === 'partial_bank');
    if (partialBanks.length > 1) e.push(`occurrence ${occurrenceId} scope ${scope}: more than one partial bank`);
    if (partialBanks.length > 0 && completionAwards > 0)
      e.push(`occurrence ${occurrenceId} scope ${scope}: partial bank and completion awards cannot coexist`);
  }

  const days = p.dayRecords.map((d) => String(d.id)).sort();
  days.forEach((d, i) => { if (i && dayNum(d) - dayNum(days[i - 1]!) !== 1) e.push(`day records not sequential at ${d}`); });
  const lastProcessedDayKey = p.player.lastProcessedDayKey;
  if (days.length && (typeof lastProcessedDayKey !== 'string' || lastProcessedDayKey.length === 0))
    e.push('lastProcessedDayKey is required when day records exist');
  else if (days.length && lastProcessedDayKey !== days[days.length - 1])
    e.push('lastProcessedDayKey does not match the last day record');
  const lv = [...p.levelEvents].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((l) => Number(l.level));
  if (lv.some((l, i) => i && l < lv[i - 1]!)) e.push('level decreased over time');
  return e;
}
/** Cached XP/level must equal the ledger; mismatches are repaired and reported (section 4, invariant 4). */
export function repairCaches(p: Payload): { payload: Payload; repaired: string[] } {
  const repaired: string[] = [];
  const out = structuredClone(p);
  for (const a of out.attributes) {
    const xp = Math.max(0, sumFor(out, String(a.id)));
    const lvl = attrLevelFromXp(xp);
    if (a.xpTotal !== xp || a.level !== lvl) { repaired.push(`attribute ${String(a.id)} cache repaired`); a.xpTotal = xp; a.level = lvl; }
  }
  const total = playerTotalXp(out);
  if (out.player.xpTotal !== undefined && (out.player.xpTotal !== total || out.player.level !== levelFromXp(total))) {
    repaired.push('player cache repaired'); out.player.xpTotal = total; out.player.level = levelFromXp(total);
  }
  return { payload: out, repaired };
}
/** Steps 4-6 on a payload (used by import, startup and snapshot restore). */
export function validatePayload(p: unknown): { errors: string[]; stage?: 'schema' | 'integrity'; payload?: Payload; repaired: string[] } {
  const z4 = payloadSchema.safeParse(p);
  if (!z4.success) return { errors: z4.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 10), stage: 'schema', repaired: [] };
  const typed = p as Payload;
  const errors = [...checkReferences(typed), ...checkInvariants(typed)];
  if (errors.length) return { errors, stage: 'integrity', repaired: [] };
  const { payload, repaired } = repairCaches(typed);
  return { errors: [], payload, repaired };
}

// ---- Step 7: migrations (one pure function per version step) ----
export type Migrations = Record<number, (p: Payload) => Payload>;
export const MIGRATIONS: Migrations = {};
export function migrate(p: Payload, from: number, to = SCHEMA_VERSION, table: Migrations = MIGRATIONS): Payload {
  for (let v = from; v < to; v++) { const f = table[v]; if (!f) throw new Error(`missing migration ${v}->${v + 1}`); p = f(p); }
  return p;
}

export async function exportBackup(payload: Payload, appVersion: string, now: Date): Promise<string> {
  const env: Envelope = { format: FORMAT, formatVersion: FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, appVersion,
    exportedAt: now.toISOString(), summary: summarize(payload), payloadSha256: await sha256Hex(canonical(payload)), payload };
  return JSON.stringify(env, null, 1);
}
const fail = (code: string, message: string): Result<never> => ({ ok: false, code, message });

/** Import pipeline in spec order: size, parse, envelope, version, checksum, Zod, references, reconciliation, summary, migrate. */
export async function validateBackup(text: string): Promise<Result<Envelope>> {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) return fail('too_large', 'Backup file is too large');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('not_json', 'File is not valid JSON'); }
  const r0 = raw as Obj | null;
  if (!r0 || typeof r0 !== 'object' || r0.format !== FORMAT) return fail('bad_format', 'Not a System backup file');
  if (r0.formatVersion !== FORMAT_VERSION) return fail('bad_format_version', 'Unsupported backup format version');
  if (Number.isInteger(r0.schemaVersion) && (r0.schemaVersion as number) > SCHEMA_VERSION) return fail('newer_schema', 'Backup is from a newer app version');
  const e = envelopeSchema.safeParse(raw);
  if (!e.success) return fail('bad_envelope', e.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 8).join('; '));
  if (e.data.schemaVersion < MIN_SUPPORTED_SCHEMA) return fail('old_schema', `Schema ${e.data.schemaVersion} is no longer supported`);
  const env = raw as Envelope;
  if ((await sha256Hex(canonical(env.payload))) !== env.payloadSha256) return fail('checksum', 'Checksum mismatch: file is corrupted or edited');
  const v = validatePayload(env.payload);
  if (v.errors.length || !v.payload) return fail(v.stage === 'schema' ? 'invalid_schema' : 'invalid_data', v.errors.join('; '));
  // A fresh-install backup may have an empty meta singleton. Once meta contains
  // a schema version, it must agree with the envelope version or the database
  // downgrade guard could disagree with the import pipeline.
  const payloadSchemaVersion = v.payload.meta.schemaVersion;
  if (payloadSchemaVersion !== undefined && payloadSchemaVersion !== env.schemaVersion)
    return fail('schema_mismatch', 'Payload meta schemaVersion does not match backup envelope schemaVersion');
  const s = summarize(v.payload);
  const bad = (Object.keys(s) as (keyof Summary)[]).filter((k) => s[k] !== env.summary[k]);
  if (bad.length) return fail('summary_mismatch', `Summary does not match ledger/payload: ${bad.join(', ')}`);
  return { ok: true, value: { ...env, payload: migrate(v.payload, env.schemaVersion), schemaVersion: SCHEMA_VERSION }, warnings: v.repaired };
}
export const backupDue = (lastExportAt: string | undefined, now: Date, days = 7) =>
  !lastExportAt || now.getTime() - Date.parse(lastExportAt) > days * 86_400_000;
