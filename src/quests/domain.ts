import { DIFFICULTY_XP, attrLevelFromXp, attrTotalToReach, deductionFor, levelFromXp, rankForLevel, timedTier, totalXpToReach } from '../engine/progression';
import { dayEndForSettings, dayStartForSettings, gameDayKeyAt, getPolicyForDay, shiftDayKey, weekdayOf, type ResetPolicyEntry, type SettingsLike } from './calendar';
import type { Obj, Payload } from '../persist/backup';

export type AttributeKey = 'academics' | 'fitness' | 'coding' | 'discipline' | 'recovery';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestKind = 'standard' | 'timed';
export type QuestSchedule = { type: 'daily' } | { type: 'weekdays'; days: number[] } | { type: 'weekly' } | { type: 'everyNDays'; n: number; anchorDayKey: string };
export interface QuestDefinition {
  title: string; category: AttributeKey; kind: QuestKind; difficulty?: Difficulty; targetBlocks?: number;
  mandatory: boolean; important: boolean; deadlineTime?: string; schedule: QuestSchedule;
}
export type QuestVersion = QuestDefinition & { id: string; templateId: string; version: number; effectiveFromDayKey: string; pausedFromDayKey?: string; resumeDayKey?: string };
export type QuestTemplate = { id: string; status: 'active' | 'paused' | 'archived'; currentVersion: number; createdAt: string; archivedFromDayKey?: string };
export type OccurrenceState = 'OPEN' | 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'MISSED' | 'LAPSED' | 'EXEMPT';
export interface QuestSnapshot {
  title: string; category: AttributeKey; kind: QuestKind; difficulty?: Difficulty; targetBlocks?: number;
  mandatory: boolean; important: boolean; potentialXp: number; penaltyTier: Difficulty;
}
export interface QuestOccurrence extends Obj {
  id: string; dayKey: string; dueDayKey: string; source: 'recurring' | 'oneoff' | 'penalty' | 'rest';
  templateVersionId?: string; snapshot: QuestSnapshot; state: OccurrenceState; completedAt?: string; awardedXp: number; dayEndsAt?: string;
}
export interface DomainResult<T = void> { payload: Payload; result: T }

const ATTRIBUTES: AttributeKey[] = ['academics', 'fitness', 'coding', 'discipline', 'recovery'];
const clone = (p: Payload): Payload => structuredClone(p);
const records = (p: Payload, key: keyof Payload): Obj[] => p[key] as Obj[];

/** Small ULID generator (48-bit timestamp + 80 random bits), avoiding another runtime dependency. */
export function newUlid(now = new Date()): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let time = now.getTime();
  let out = '';
  for (let i = 0; i < 10; i++) { out = alphabet[time % 32]! + out; time = Math.floor(time / 32); }
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let bits = 0, buffer = 0;
  for (const b of bytes) { buffer = (buffer << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(buffer >> bits) & 31]!; } }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31]!;
  return (out + '000000').slice(0, 26);
}
function assertDayKey(k: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || Number.isNaN(Date.parse(`${k}T00:00:00Z`)) || new Date(`${k}T00:00:00Z`).toISOString().slice(0, 10) !== k) throw new RangeError(`Invalid dayKey: ${k}`);
}
function validateDefinition(d: QuestDefinition): void {
  if (!d.title.trim()) throw new Error('Quest title is required');
  if (!ATTRIBUTES.includes(d.category)) throw new Error('Invalid quest category');
  if (d.important && !d.mandatory) throw new Error('Important quests must be mandatory');
  if (d.kind === 'timed') {
    if (d.targetBlocks === undefined || !Number.isInteger(d.targetBlocks) || d.targetBlocks < 1 || d.targetBlocks > 8) throw new Error('Timed quests require 1–8 target blocks');
    if (d.difficulty !== undefined) throw new Error('Timed quests cannot have a difficulty');
  } else if (!d.difficulty || !(['easy', 'medium', 'hard'] as string[]).includes(d.difficulty) || d.targetBlocks !== undefined) {
    throw new Error('Standard quests require a difficulty and cannot have target blocks');
  }
  if (d.deadlineTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.deadlineTime)) throw new Error('Deadline must use HH:MM');
  if (d.schedule.type === 'weekdays' && (!d.schedule.days.length || new Set(d.schedule.days).size !== d.schedule.days.length || d.schedule.days.some((n) => !Number.isInteger(n) || n < 0 || n > 6))) throw new Error('Weekday schedule must contain unique weekdays 0–6');
  if (d.schedule.type === 'everyNDays') { assertDayKey(d.schedule.anchorDayKey); if (!Number.isInteger(d.schedule.n) || d.schedule.n < 1) throw new Error('Custom recurrence interval must be a positive integer'); }
}
export function potentialXp(d: Pick<QuestDefinition, 'kind' | 'difficulty' | 'targetBlocks'>): number {
  if (d.kind === 'timed') return 25 * Math.max(0, Math.min(8, Number(d.targetBlocks) || 0));
  return DIFFICULTY_XP[d.difficulty ?? 'easy'];
}
export function penaltyTier(d: Pick<QuestDefinition, 'kind' | 'difficulty' | 'targetBlocks'>): Difficulty {
  return d.kind === 'timed' ? timedTier(Number(d.targetBlocks)) : d.difficulty ?? 'easy';
}
function latestVersion(p: Payload, template: QuestTemplate, onDay: string): QuestVersion | undefined {
  return records(p, 'templateVersions').filter((v) => v.templateId === template.id && String(v.effectiveFromDayKey) <= onDay)
    .sort((a, b) => String(a.effectiveFromDayKey).localeCompare(String(b.effectiveFromDayKey)) || Number(a.version ?? 1) - Number(b.version ?? 1)).at(-1) as unknown as QuestVersion | undefined;
}
function newestVersion(p: Payload, templateId: string): QuestVersion | undefined {
  return records(p, 'templateVersions').filter((v) => v.templateId === templateId)
    .sort((a, b) => Number(a.version ?? 1) - Number(b.version ?? 1)).at(-1) as unknown as QuestVersion | undefined;
}
function versionDefinition(v: QuestVersion): QuestDefinition {
  return { title: v.title, category: v.category, kind: v.kind, ...(v.difficulty ? { difficulty: v.difficulty } : {}),
    ...(v.targetBlocks !== undefined ? { targetBlocks: v.targetBlocks } : {}), mandatory: v.mandatory, important: v.important,
    ...(v.deadlineTime ? { deadlineTime: v.deadlineTime } : {}), schedule: structuredClone(v.schedule) };
}
function latestWeekStart(dayKey: string, weekStart: number): string {
  return shiftDayKey(dayKey, -((weekdayOf(dayKey) - weekStart + 7) % 7));
}
function scheduledOn(d: QuestDefinition, dayKey: string, weekStart: number): boolean {
  switch (d.schedule.type) {
    case 'daily': return true;
    case 'weekdays': return d.schedule.days.includes(weekdayOf(dayKey));
    case 'weekly': return dayKey === latestWeekStart(dayKey, weekStart);
    case 'everyNDays': {
      const delta = (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${d.schedule.anchorDayKey}T00:00:00Z`)) / 86_400_000;
      return Number.isInteger(delta) && delta >= 0 && delta % d.schedule.n === 0;
    }
  }
}
export function createTemplate(p: Payload, definition: QuestDefinition, effectiveFromDayKey: string, now = new Date()): DomainResult<QuestTemplate> {
  validateDefinition(definition); assertDayKey(effectiveFromDayKey);
  const out = clone(p); const templateId = newUlid(now); const versionId = newUlid(new Date(now.getTime() + 1));
  const template: QuestTemplate = { id: templateId, status: 'active', currentVersion: 1, createdAt: now.toISOString() };
  const version: QuestVersion = { ...structuredClone(definition), id: versionId, templateId, version: 1, effectiveFromDayKey };
  records(out, 'templates').push(template as unknown as Obj);
  records(out, 'templateVersions').push(version as unknown as Obj);
  return { payload: out, result: template };
}
export function editTemplate(p: Payload, templateId: string, patch: Partial<QuestDefinition>, effectiveFromDayKey: string, now = new Date()): DomainResult<QuestVersion> {
  assertDayKey(effectiveFromDayKey); const out = clone(p);
  const template = records(out, 'templates').find((t) => t.id === templateId) as unknown as QuestTemplate | undefined;
  if (!template || template.status === 'archived') throw new Error('Active quest template not found');
  const current = newestVersion(out, templateId);
  if (!current) throw new Error('No prior version exists to edit');
  const definition = { ...versionDefinition(current), ...structuredClone(patch) } as QuestDefinition;
  // A quest is either standard or timed: switching kinds removes the previous kind's fields.
  if (patch.kind === 'timed' && patch.difficulty === undefined) delete definition.difficulty;
  if (patch.kind === 'standard' && patch.targetBlocks === undefined) delete definition.targetBlocks;
  validateDefinition(definition);
  const number = Math.max(template.currentVersion, ...records(out, 'templateVersions').filter((v) => v.templateId === templateId).map((v) => Number(v.version ?? 1))) + 1;
  const version: QuestVersion = { ...definition, id: newUlid(new Date(now.getTime() + number)), templateId, version: number, effectiveFromDayKey };
  // Keep pause metadata only when the edited version remains in an active pause interval.
  if (current.pausedFromDayKey) version.pausedFromDayKey = current.pausedFromDayKey;
  if (current.resumeDayKey) version.resumeDayKey = current.resumeDayKey;
  records(out, 'templateVersions').push(version as unknown as Obj); template.currentVersion = number;
  return { payload: out, result: version };
}
export function pauseTemplate(p: Payload, templateId: string, pauseFromDayKey: string, resumeDayKey?: string, now = new Date()): DomainResult<QuestVersion> {
  assertDayKey(pauseFromDayKey); if (resumeDayKey) { assertDayKey(resumeDayKey); if (resumeDayKey <= pauseFromDayKey) throw new Error('Resume day must be after pause day'); }
  const out = clone(p); const template = records(out, 'templates').find((t) => t.id === templateId) as unknown as QuestTemplate | undefined;
  if (!template || template.status === 'archived') throw new Error('Active quest template not found');
  const current = newestVersion(out, templateId); if (!current) throw new Error('No version exists to pause');
  const number = Math.max(template.currentVersion, ...records(out, 'templateVersions').filter((v) => v.templateId === templateId).map((v) => Number(v.version ?? 1))) + 1;
  const version: QuestVersion = { ...versionDefinition(current), id: newUlid(new Date(now.getTime() + number)), templateId, version: number,
    effectiveFromDayKey: pauseFromDayKey, pausedFromDayKey: pauseFromDayKey, ...(resumeDayKey ? { resumeDayKey } : {}) };
  records(out, 'templateVersions').push(version as unknown as Obj); template.currentVersion = number; template.status = 'paused';
  return { payload: out, result: version };
}
export function resumeTemplate(p: Payload, templateId: string, effectiveFromDayKey: string, now = new Date()): DomainResult<QuestVersion> {
  assertDayKey(effectiveFromDayKey); const out = clone(p); const template = records(out, 'templates').find((t) => t.id === templateId) as unknown as QuestTemplate | undefined;
  if (!template || template.status === 'archived') throw new Error('Active quest template not found');
  const current = newestVersion(out, templateId); if (!current) throw new Error('No version exists to resume');
  const number = Math.max(template.currentVersion, ...records(out, 'templateVersions').filter((v) => v.templateId === templateId).map((v) => Number(v.version ?? 1))) + 1;
  const version: QuestVersion = { ...versionDefinition(current), id: newUlid(new Date(now.getTime() + number)), templateId, version: number, effectiveFromDayKey };
  records(out, 'templateVersions').push(version as unknown as Obj); template.currentVersion = number; template.status = 'active';
  return { payload: out, result: version };
}
export function archiveTemplate(p: Payload, templateId: string, archiveFromDayKey: string): DomainResult<QuestTemplate> {
  assertDayKey(archiveFromDayKey); const out = clone(p); const template = records(out, 'templates').find((t) => t.id === templateId) as unknown as QuestTemplate | undefined;
  if (!template) throw new Error('Quest template not found');
  template.status = 'archived'; template.archivedFromDayKey = archiveFromDayKey;
  const versions = new Set(records(out, 'templateVersions').filter((v) => v.templateId === templateId).map((v) => String(v.id)));
  // Delete only not-yet-resolved recurring occurrences from the effective archive day onward.
  // Completed occurrences and any occurrence with ledger/timer history are immutable history.
  const referenced = new Set<string>([
    ...records(out, 'xpTransactions').map((t) => String(t.occurrenceId ?? '')).filter(Boolean),
    ...records(out, 'timerSessions').map((t) => String(t.occurrenceId ?? '')).filter(Boolean),
    ...records(out, 'penaltyEvents').map((t) => String(t.occurrenceId ?? '')).filter(Boolean),
  ]);
  out.occurrences = out.occurrences.filter((o) => {
    const occursFromThisTemplate = o.source === 'recurring' && versions.has(String(o.templateVersionId ?? ''));
    const due = String(o.dueDayKey ?? o.dayKey);
    const unresolved = o.state === 'OPEN' || o.state === 'EXEMPT';
    return !(occursFromThisTemplate && due >= archiveFromDayKey && unresolved && !referenced.has(String(o.id)));
  });
  return { payload: out, result: template };
}
/**
 * Change timezone/reset time prospectively. The new policy starts at the next game-day
 * boundary, and dayKeyOffset maps the new wall-clock calendar back onto the monotonic
 * game-day sequence so a policy change cannot duplicate or skip a processed day.
 */
export function changeResetPolicy(p: Payload, currentGameDayKey: string, timezone: string, resetTime: string, now = new Date()): DomainResult<Obj> {
  assertDayKey(currentGameDayKey);
  // Validate timezone and HH:MM before cloning/mutating the payload.
  gameDayKeyAt(now, timezone, resetTime);
  const out = clone(p);
  const settings = out.settings as SettingsLike & { resetPolicyHistory?: ResetPolicyEntry[] };
  const active = getPolicyForDay(settings, currentGameDayKey);
  if (active.timezone === timezone && active.resetTime === resetTime) return { payload: out, result: out.settings };
  const nextDayKey = shiftDayKey(currentGameDayKey, 1);
  const boundary = dayEndForSettings(currentGameDayKey, settings);
  const rawNextKey = gameDayKeyAt(new Date(boundary.getTime() + 1), timezone, resetTime);
  const dayNumber = (key: string) => Date.parse(`${key}T00:00:00.000Z`) / 86_400_000;
  const offset = dayNumber(nextDayKey) - dayNumber(rawNextKey);
  let history = Array.isArray(settings.resetPolicyHistory) ? structuredClone(settings.resetPolicyHistory) : [];
  if (!history.length) {
    history = [{ effectiveFromDayKey: '0001-01-01', timezone: active.timezone, resetTime: active.resetTime, dayKeyOffset: 0 }];
  }
  // Discard only not-yet-effective future entries; retain the full effective history.
  history = history.filter((entry) => entry.effectiveFromDayKey <= currentGameDayKey);
  if (!history.length) history = [{ effectiveFromDayKey: '0001-01-01', timezone: active.timezone, resetTime: active.resetTime, dayKeyOffset: active.dayKeyOffset ?? 0 }];
  history.push({ effectiveFromDayKey: nextDayKey, timezone, resetTime, dayKeyOffset: offset });
  history.sort((a, b) => a.effectiveFromDayKey.localeCompare(b.effectiveFromDayKey));
  settings.resetPolicyHistory = history;
  settings.timezone = timezone;
  settings.resetTime = resetTime;
  return { payload: out, result: out.settings };
}

export interface OneOffInput { title: string; category: AttributeKey; difficulty: Difficulty; mandatory?: boolean; important?: boolean; deadlineDayKey?: string; deadlineTime?: string }
export function createOneOff(p: Payload, input: OneOffInput, createdDayKey: string, now = new Date()): DomainResult<QuestOccurrence> {
  assertDayKey(createdDayKey); if (!input.title.trim()) throw new Error('Quest title is required');
  if (!ATTRIBUTES.includes(input.category)) throw new Error('Invalid quest category');
  if (input.important && input.mandatory === false) throw new Error('Important quests must be mandatory');
  const dueDayKey = input.deadlineDayKey ?? createdDayKey; assertDayKey(dueDayKey); if (dueDayKey < createdDayKey) throw new Error('One-off deadline cannot precede its creation day');
  if (input.deadlineTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.deadlineTime)) throw new Error('Deadline must use HH:MM');
  const mandatory = input.mandatory ?? false; const important = input.important ?? false;
  const snap: QuestSnapshot = { title: input.title.trim(), category: input.category, kind: 'standard', difficulty: input.difficulty,
    mandatory, important, potentialXp: DIFFICULTY_XP[input.difficulty], penaltyTier: input.difficulty };
  const out = clone(p); const occ: QuestOccurrence = { id: newUlid(now), dayKey: createdDayKey, dueDayKey, source: 'oneoff', snapshot: snap,
    state: 'OPEN', awardedXp: 0, dayEndsAt: dayEndForSettings(dueDayKey, out.settings as SettingsLike).toISOString(),
    ...(input.deadlineTime ? { deadlineTime: input.deadlineTime } : {}) };
  records(out, 'occurrences').push(occ as unknown as Obj); return { payload: out, result: occ };
}

/** Skip one occurrence. Mandatory skips become MISSED unless the occurrence is protected by a rest day. */
export function skipOccurrence(p: Payload, occurrenceId: string, settings: SettingsLike, now = new Date()): DomainResult<QuestOccurrence> {
  const out = clone(p); const occ = records(out, 'occurrences').find((o) => o.id === occurrenceId) as unknown as QuestOccurrence | undefined;
  if (!occ) throw new Error('Occurrence not found');
  if (occ.state !== 'OPEN' && occ.state !== 'EXEMPT') throw new Error(`Cannot skip an occurrence in state ${occ.state}`);
  const protectedDay = isProtectedRestDay(out, occ.dueDayKey ?? occ.dayKey, settings);
  if (occ.state === 'EXEMPT' || protectedDay) {
    // Exempt (paused/rest-day) occurrences may still be completed for XP, but skipping
    // them must not convert an exemption into a mandatory miss.
    occ.state = 'EXEMPT';
  } else if (occ.snapshot.mandatory || occ.snapshot.important) occ.state = 'MISSED';
  else occ.state = 'SKIPPED';
  occ.resolvedAt = now.toISOString();
  return { payload: out, result: occ };
}

export type RestDayInput = { kind: 'recurring'; weekday: number } | { kind: 'adhoc'; dayKey: string }
export function addRestDay(p: Payload, input: RestDayInput, settings: SettingsLike, now = new Date()): DomainResult<Obj> {
  const out = clone(p); const rests = records(out, 'restDays');
  if (input.kind === 'recurring') {
    if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new Error('Weekday must be 0–6');
    if (rests.some((r) => r.kind === 'recurring')) throw new Error('Only one recurring rest weekday is allowed');
  } else {
    assertDayKey(input.dayKey);
    if (rests.some((r) => r.kind === 'adhoc' && r.dayKey === input.dayKey)) throw new Error('Rest day already exists for this date');
    const month = input.dayKey.slice(0, 7);
    if (rests.filter((r) => r.kind === 'adhoc' && String(r.dayKey).startsWith(month)).length >= 2) throw new Error('At most two ad-hoc rest days are allowed per calendar month');
    const start = dayStartForSettings(input.dayKey, settings);
    if (start.getTime() <= now.getTime()) throw new Error('An ad-hoc rest day must be declared before that game day begins');
  }
  const row: Obj = { id: newUlid(now), kind: input.kind, declaredAt: now.toISOString(), ...(input.kind === 'recurring' ? { weekday: input.weekday } : { dayKey: input.dayKey }) };
  rests.push(row); return { payload: out, result: row };
}
export function removeRestDay(p: Payload, restDayId: string): Payload {
  const out = clone(p); const arr = records(out, 'restDays'); const idx = arr.findIndex((r) => r.id === restDayId);
  if (idx < 0) throw new Error('Rest day not found'); arr.splice(idx, 1); return out;
}
export function isProtectedRestDay(p: Payload, dayKey: string, settings: SettingsLike): boolean {
  const start = dayStartForSettings(dayKey, settings).getTime(); const weekday = weekdayOf(dayKey);
  return records(p, 'restDays').some((r) => Date.parse(String(r.declaredAt)) < start &&
    ((r.kind === 'adhoc' && r.dayKey === dayKey) || (r.kind === 'recurring' && Number(r.weekday) === weekday)));
}

function makeSnapshot(v: QuestDefinition): QuestSnapshot {
  return { title: v.title, category: v.category, kind: v.kind, ...(v.difficulty ? { difficulty: v.difficulty } : {}),
    ...(v.targetBlocks !== undefined ? { targetBlocks: v.targetBlocks } : {}), mandatory: v.mandatory, important: v.important,
    potentialXp: potentialXp(v), penaltyTier: penaltyTier(v) };
}
function templatePausedOn(v: QuestVersion, day: string): boolean {
  return Boolean(v.pausedFromDayKey && day >= v.pausedFromDayKey && (!v.resumeDayKey || day < v.resumeDayKey));
}
function existingRecurring(p: Payload, v: QuestVersion, dueDayKey: string): boolean {
  // One occurrence per template per week, even if a new version becomes effective mid-week.
  return records(p, 'occurrences').some((o) => {
    if (o.source !== 'recurring' || (o.dueDayKey ?? o.dayKey) !== dueDayKey) return false;
    const existingVersion = records(p, 'templateVersions').find((x) => x.id === o.templateVersionId);
    return existingVersion?.templateId === v.templateId;
  });
}
export interface GeneratedDay { payload: Payload; generated: QuestOccurrence[]; protectedRestDay: boolean }
/** Generate the frozen occurrences for one game day. Repeating this operation is idempotent. */
export function generateOccurrencesForDay(p: Payload, dayKey: string, now = new Date()): GeneratedDay {
  assertDayKey(dayKey); const out = clone(p); const settings = out.settings as SettingsLike;
  const generated: QuestOccurrence[] = [];
  const restDay = isProtectedRestDay(out, dayKey, settings);
  const weekStart = Number.isInteger(settings.weekStart) ? Number(settings.weekStart) : 1;
  for (const raw of records(out, 'templates')) {
    const template = raw as unknown as QuestTemplate;
    if (template.status === 'archived' && (!template.archivedFromDayKey || dayKey >= template.archivedFromDayKey)) continue;
    if (template.archivedFromDayKey && dayKey >= template.archivedFromDayKey) continue;
    const version = latestVersion(out, template, dayKey); if (!version) continue;
    const def = versionDefinition(version); if (!scheduledOn(def, dayKey, weekStart)) {
      // Weekly items are shown throughout a week. If no occurrence has yet been made for that week
      // (e.g. the template was created mid-week), create one on the first eligible day.
      if (def.schedule.type !== 'weekly') continue;
      const start = latestWeekStart(dayKey, weekStart); const due = shiftDayKey(start, 6);
      if (existingRecurring(out, version, due)) continue;
      if (dayKey < version.effectiveFromDayKey || dayKey > due) continue;
    }
    let occurrenceDay = dayKey; let dueDay = dayKey;
    if (def.schedule.type === 'weekly') { const start = latestWeekStart(dayKey, weekStart); occurrenceDay = dayKey === start ? start : dayKey; dueDay = shiftDayKey(start, 6); }
    if (existingRecurring(out, version, dueDay)) continue;
    const paused = templatePausedOn(version, dayKey);
    const occurrence: QuestOccurrence = { id: newUlid(new Date(now.getTime() + generated.length)), dayKey: occurrenceDay, dueDayKey: dueDay,
      source: 'recurring', templateVersionId: version.id, snapshot: makeSnapshot(def), state: (restDay || paused) ? 'EXEMPT' : 'OPEN',
      awardedXp: 0, dayEndsAt: dayEndForSettings(dueDay, settings).toISOString() };
    records(out, 'occurrences').push(occurrence as unknown as Obj); generated.push(occurrence);
  }
  if (restDay && !records(out, 'occurrences').some((o) => o.source === 'rest' && o.dayKey === dayKey)) {
    const recovery: QuestOccurrence = { id: newUlid(new Date(now.getTime() + 99)), dayKey, dueDayKey: dayKey, source: 'rest',
      snapshot: { title: 'Rest Day Recovery', category: 'recovery', kind: 'standard', difficulty: 'easy', mandatory: false, important: false, potentialXp: 50, penaltyTier: 'easy' },
      state: 'OPEN', awardedXp: 0, dayEndsAt: dayEndForSettings(dayKey, settings).toISOString() };
    records(out, 'occurrences').push(recovery as unknown as Obj); generated.push(recovery);
  }
  return { payload: out, generated, protectedRestDay: restDay };
}

export function getTemplateDefinitions(p: Payload, templateId: string): QuestVersion[] {
  return records(p, 'templateVersions').filter((v) => v.templateId === templateId).sort((a, b) => String(a.effectiveFromDayKey).localeCompare(String(b.effectiveFromDayKey)) || Number(a.version ?? 1) - Number(b.version ?? 1)) as unknown as QuestVersion[];
}

/** Helper used by day-close: refresh cached progression values from the append-only player/attribute ledger. */
export function refreshProgressionCaches(p: Payload): void {
  const tx = records(p, 'xpTransactions');
  const playerXp = tx.filter((t) => t.scope === 'player').reduce((s, t) => s + Number(t.appliedDelta ?? 0), 0);
  p.player.xpTotal = playerXp; p.player.level = levelFromXp(playerXp); p.player.rank = rankForLevel(Number(p.player.level));
  for (const attr of records(p, 'attributes')) {
    const xp = tx.filter((t) => t.scope === attr.id).reduce((s, t) => s + Number(t.appliedDelta ?? 0), 0);
    attr.xpTotal = Math.max(0, xp); attr.level = attrLevelFromXp(Math.max(0, xp));
  }
  // Imported/old payloads can use the same schema shape but lack an attribute row; do not invent ids here.
}

/** Exposed for tests: compare a current total with the level floor used by §3.7. */
export function boundedMissDeduction(playerXp: number, attributeXp: number, requested: number): number {
  const playerFloor = totalXpToReach(levelFromXp(playerXp));
  const attrFloor = attrTotalToReach(attrLevelFromXp(attributeXp));
  return Math.max(0, Math.min(requested, playerXp - playerFloor, attributeXp - attrFloor));
}

