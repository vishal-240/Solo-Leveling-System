import { attrLevelFromXp, attrTotalToReach, deductionFor, levelFromXp, rankForLevel, timedTier, totalXpToReach } from '../engine/progression';
import { emptyPayload, SCHEMA_VERSION, validatePayload, type Obj, type Payload } from '../persist/backup';
import { dayEndForSettings, gameDayKeyForSettings, getPolicyForDay, shiftDayKey, type SettingsLike } from './calendar';
import { syncProgressionInPlace } from '../rewards/rewards';
import { generateOccurrencesForDay, isProtectedRestDay, newUlid, type QuestOccurrence, type QuestSnapshot } from './domain';

export interface ClosedDaySummary { dayKey: string; completed: number; missed: number; xpEarned: number; xpForfeited: number; xpDeducted: number; restDay: boolean }
export interface DayCloseResult {
  payload: Payload; currentDayKey: string; initialized: boolean; noOp: boolean; closedDays: ClosedDaySummary[];
  generatedToday: number; absenceReport: boolean; penaltyQuestId?: string;
}
type MissCause = { dayKey: string; occurrence: QuestOccurrence; trigger: 'hard_miss' | 'important_miss' | 'repeat_failure' };
const arr = (p: Payload, key: keyof Payload): Obj[] => p[key] as Obj[];
const clone = (p: Payload): Payload => structuredClone(p);
const dayNumber = (k: string) => Date.parse(`${k}T00:00:00.000Z`) / 86_400_000;
const xpForScope = (p: Payload, scope: string) => arr(p, 'xpTransactions').filter((x) => x.scope === scope).reduce((n, x) => n + Number(x.appliedDelta ?? 0), 0);
const isMandatory = (o: QuestOccurrence) => o.snapshot.mandatory || o.snapshot.important;
const dueKey = (o: QuestOccurrence) => o.dueDayKey || o.dayKey;

function ensureCoreMetadata(p: Payload): void {
  if (!Object.keys(p.meta).length) { p.meta.schemaVersion = SCHEMA_VERSION; p.meta.appVersion = '0.1.0'; }
}
function ensureFiveAttributes(p: Payload): void {
  const ids = new Set(arr(p, 'attributes').map((a) => String(a.id)));
  for (const id of ['academics', 'fitness', 'coding', 'discipline', 'recovery']) if (!ids.has(id)) arr(p, 'attributes').push({ id, xpTotal: 0, level: 1, statPoints: 0 });
}
function addMessage(p: Payload, now: Date, kind: string, text: string, dayKey: string): void {
  if (arr(p, 'systemMessages').some((m) => m.kind === kind && m.dayKey === dayKey)) return;
  arr(p, 'systemMessages').push({ id: newUlid(now), at: now.toISOString(), dayKey, kind, text, read: false });
}
function activePenalty(p: Payload, now: Date): QuestOccurrence | undefined {
  const deadlines = (p.meta.penaltyDeadlines && typeof p.meta.penaltyDeadlines === 'object' ? p.meta.penaltyDeadlines : {}) as Record<string, string>;
  return arr(p, 'occurrences').find((x) => x.source === 'penalty' && x.state === 'OPEN' && (!deadlines[String(x.id)] || Date.parse(deadlines[String(x.id)]!) > now.getTime())) as unknown as QuestOccurrence | undefined;
}
function expirePenaltyQuests(p: Payload, now: Date, currentDayKey: string): void {
  const deadlines = (p.meta.penaltyDeadlines && typeof p.meta.penaltyDeadlines === 'object' ? p.meta.penaltyDeadlines : {}) as Record<string, string>;
  for (const raw of arr(p, 'occurrences')) {
    const o = raw as unknown as QuestOccurrence;
    if (o.source !== 'penalty' || o.state !== 'OPEN' || !deadlines[o.id] || Date.parse(deadlines[o.id]!) > now.getTime()) continue;
    o.state = 'MISSED'; o.resolvedAt = now.toISOString();
    p.meta.shieldsSuspendedAfterFailedPenalty = true;
    addMessage(p, now, 'PENALTY QUEST FAILED', 'PENALTY QUEST FAILED — no further XP deduction was applied.', currentDayKey);
  }
}
function appendDeduction(p: Payload, occurrence: QuestOccurrence, dayKey: string, now: Date): number {
  if (!isMandatory(occurrence) || occurrence.source === 'penalty' || occurrence.source === 'rest') return 0;
  const category = occurrence.snapshot.category;
  const scopes = ['player', category];
  if (scopes.some((scope) => arr(p, 'xpTransactions').some((t) => t.occurrenceId === occurrence.id && t.scope === scope && t.kind === 'penalty_deduction'))) return 0;
  const requested = deductionFor(occurrence.snapshot.potentialXp, occurrence.snapshot.penaltyTier, Number(occurrence.awardedXp ?? 0));
  const playerXp = Math.max(0, xpForScope(p, 'player'));
  const attributeXp = Math.max(0, xpForScope(p, category));
  const playerFloor = totalXpToReach(levelFromXp(playerXp));
  const attributeFloor = attrTotalToReach(attrLevelFromXp(attributeXp));
  // Spec §3.7 requires the same bounded amount to be deducted from player and category XP.
  const applied = Math.max(0, Math.min(requested, playerXp - playerFloor, attributeXp - attributeFloor));
  const common = { at: now.toISOString(), dayKey, occurrenceId: occurrence.id, kind: 'penalty_deduction', requestedDelta: -requested, appliedDelta: -applied };
  for (const scope of scopes) arr(p, 'xpTransactions').push({ id: newUlid(now), ...common, scope, idempotencyKey: `miss:${occurrence.id}:${scope}` });
  return applied;
}
function refreshCaches(p: Payload): void {
  const playerXp = xpForScope(p, 'player');
  p.player.xpTotal = playerXp; p.player.level = levelFromXp(Math.max(0, playerXp)); p.player.rank = rankForLevel(Number(p.player.level));
  for (const attribute of arr(p, 'attributes')) {
    const xp = Math.max(0, xpForScope(p, String(attribute.id)));
    attribute.xpTotal = xp; attribute.level = attrLevelFromXp(xp);
  }
}
function getStreak(p: Payload, scope: string): Obj {
  let streak = arr(p, 'streaks').find((s) => s.scope === scope);
  if (!streak) { streak = { id: newUlid(), scope, current: 0, longest: 0 }; arr(p, 'streaks').push(streak); }
  return streak;
}
function advanceStreak(streak: Obj): void {
  streak.current = Number(streak.current ?? 0) + 1;
  streak.longest = Math.max(Number(streak.longest ?? 0), Number(streak.current));
}
function updateStreaksForDay(p: Payload, dayKey: string, due: QuestOccurrence[], restDay: boolean, now: Date): boolean {
  const mandatory = due.filter((o) => o.source !== 'penalty' && o.source !== 'rest' && isMandatory(o));
  const eligibleMandatory = mandatory.filter((o) => o.state !== 'EXEMPT');
  const daily = getStreak(p, 'daily');
  const dailyHasEligible = eligibleMandatory.length > 0;
  const misses = eligibleMandatory.filter((o) => o.state === 'MISSED' || o.state === 'PARTIAL' || o.state === 'SKIPPED' || o.state === 'LAPSED');
  const allComplete = eligibleMandatory.length > 0 && eligibleMandatory.every((o) => o.state === 'COMPLETED');
  const suspended = Boolean(p.meta.shieldsSuspendedAfterFailedPenalty) || Boolean(p.meta.pendingPenaltyQuestForCatchup) || Boolean(activePenalty(p, now));
  const held = Math.max(0, Math.min(3, Number(p.player.streakShields ?? 0)));
  const queued = Math.max(0, Number(p.player.queuedShields ?? 0));
  let protectedByShield = false;
  if (!restDay && misses.length && !suspended && held > 0) {
    protectedByShield = true;
    // D17: when held at cap, consume a held shield and immediately deliver one queued shield.
    if (queued > 0) { p.player.streakShields = held; p.player.queuedShields = queued - 1; }
    else p.player.streakShields = held - 1;
    const shieldKey = `shield-consume:${dayKey}`;
    p.meta.shieldConsumptionKeys = Array.isArray(p.meta.shieldConsumptionKeys) ? p.meta.shieldConsumptionKeys : [];
    if (!(p.meta.shieldConsumptionKeys as string[]).includes(shieldKey)) (p.meta.shieldConsumptionKeys as string[]).push(shieldKey);
    addMessage(p, now, 'STREAK SHIELD USED', 'A Streak Shield protected your streaks for this missed day.', dayKey);
  }
  if (!restDay && dailyHasEligible) {
    if (misses.length && !protectedByShield) { daily.current = 0; daily.lastDayKey = dayKey; }
    else if (allComplete) { advanceStreak(daily); daily.lastDayKey = dayKey; }
  }
  // Quest streaks are based on scheduled occurrences, not on whether a mandatory
  // quest happened to exist that day. A shield preserves all streaks for that day.
  if (!restDay) for (const occ of due) {
    if (occ.source !== 'recurring' || !occ.templateVersionId || occ.state === 'EXEMPT') continue;
    const version = arr(p, 'templateVersions').find((v) => v.id === occ.templateVersionId);
    if (!version) continue;
    const scope = String(version.templateId); const streak = getStreak(p, scope);
    if (occ.state === 'COMPLETED') { advanceStreak(streak); streak.lastDayKey = dayKey; }
    else if (isMandatory(occ) && misses.includes(occ) && !protectedByShield) { streak.current = 0; streak.lastDayKey = dayKey; }
  }
  if (p.meta.shieldsSuspendedAfterFailedPenalty && allComplete) p.meta.shieldsSuspendedAfterFailedPenalty = false;
  return protectedByShield;
}
function appendFailureWindow(p: Payload, dayKey: string, missed: QuestOccurrence[], triggers: MissCause[], repeatState: { triggered: boolean }): void {
  let failures = Array.isArray(p.meta.failureWindow) ? p.meta.failureWindow as { dayKey: string; occurrenceId: string; category: string }[] : [];
  failures = failures.filter((m) => dayNumber(dayKey) - dayNumber(m.dayKey) < 7 && m.dayKey <= dayKey);
  for (const occ of missed.filter((o) => isMandatory(o))) {
    if (!failures.some((m) => m.occurrenceId === occ.id)) failures.push({ dayKey, occurrenceId: occ.id, category: occ.snapshot.category });
    if (!repeatState.triggered && failures.length >= 3) {
      triggers.push({ dayKey, occurrence: occ, trigger: 'repeat_failure' });
      failures = []; repeatState.triggered = true;
    }
  }
  p.meta.failureWindow = failures;
}
function logPenaltyTriggers(p: Payload, causes: MissCause[], now: Date, currentDayKey: string): string | undefined {
  if (!causes.length) return undefined;
  const active = activePenalty(p, now); const issueOne = !active;
  let penaltyId: string | undefined;
  if (issueOne) {
    const first = causes[0]!.occurrence; const id = newUlid(now); penaltyId = id;
    const snapshot: QuestSnapshot = { title: `PENALTY QUEST: complete a 30-minute timed session in ${first.snapshot.category}`,
      category: first.snapshot.category, kind: 'timed', targetBlocks: 2, mandatory: true, important: false, potentialXp: 0, penaltyTier: 'easy' };
    arr(p, 'occurrences').push({ id, dayKey: currentDayKey, dueDayKey: currentDayKey, source: 'penalty', snapshot, state: 'OPEN', awardedXp: 0,
      dayEndsAt: dayEndForSettings(currentDayKey, p.settings as SettingsLike).toISOString() });
    const deadlines = (p.meta.penaltyDeadlines && typeof p.meta.penaltyDeadlines === 'object' ? p.meta.penaltyDeadlines : {}) as Record<string, string>;
    deadlines[id] = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(); p.meta.penaltyDeadlines = deadlines;
    const penaltyCauses = (p.meta.penaltyCauses && typeof p.meta.penaltyCauses === 'object' ? p.meta.penaltyCauses : {}) as Record<string, string[]>;
    penaltyCauses[id] = causes.map((c) => `${c.trigger}:${c.occurrence.id}`); p.meta.penaltyCauses = penaltyCauses;
    addMessage(p, now, 'PENALTY QUEST ISSUED', `PENALTY QUEST ISSUED — ${causes.length} trigger(s) recorded. Complete the 30-minute ${first.snapshot.category} session within 48 hours.`, currentDayKey);
  }
  for (const cause of causes) {
    const existing = arr(p, 'penaltyEvents').some((e) => e.idempotencyKey === `penalty-trigger:${cause.occurrence.id}:${cause.trigger}`);
    if (existing) continue;
    const playerDeduction = arr(p, 'xpTransactions').find((t) => t.occurrenceId === cause.occurrence.id && t.scope === 'player' && t.kind === 'penalty_deduction');
    const categoryDeduction = arr(p, 'xpTransactions').find((t) => t.occurrenceId === cause.occurrence.id && t.scope === cause.occurrence.snapshot.category && t.kind === 'penalty_deduction');
    arr(p, 'penaltyEvents').push({ id: newUlid(now), dayKey: cause.dayKey, occurrenceId: cause.occurrence.id, trigger: cause.trigger,
      deductionRequested: Math.abs(Number(playerDeduction?.requestedDelta ?? 0)), deductionApplied: Math.abs(Number(playerDeduction?.appliedDelta ?? categoryDeduction?.appliedDelta ?? 0)),
      ...(penaltyId ? { penaltyOccurrenceId: penaltyId } : {}), idempotencyKey: `penalty-trigger:${cause.occurrence.id}:${cause.trigger}` });
  }
  return penaltyId;
}

function closeOneDay(p: Payload, dayKey: string, now: Date, repeatTriggers: MissCause[], repeatState: { triggered: boolean }): ClosedDaySummary {
  const generated = generateOccurrencesForDay(p, dayKey, now);
  // Carry generated payload arrays back into the working object.
  p.occurrences = generated.payload.occurrences;
  const due = arr(p, 'occurrences').filter((raw) => dueKey(raw as unknown as QuestOccurrence) === dayKey) as unknown as QuestOccurrence[];
  const protectedRest = generated.protectedRestDay || isProtectedRestDay(p, dayKey, p.settings as SettingsLike);
  for (const occ of due) {
    if (occ.source === 'penalty') {
      // Penalty deadlines are wall-clock 48-hour deadlines, not day-end deadlines.
      const deadlines = (p.meta.penaltyDeadlines && typeof p.meta.penaltyDeadlines === 'object' ? p.meta.penaltyDeadlines : {}) as Record<string, string>;
      if (occ.state === 'OPEN' && deadlines[occ.id] && Date.parse(deadlines[occ.id]!) <= now.getTime()) {
        occ.state = 'MISSED'; occ.resolvedAt = now.toISOString(); p.meta.shieldsSuspendedAfterFailedPenalty = true;
        addMessage(p, now, 'PENALTY QUEST FAILED', 'PENALTY QUEST FAILED — no further XP deduction was applied.', dayKey);
      }
      continue;
    }
    if (occ.state === 'EXEMPT' || occ.state === 'COMPLETED' || occ.state === 'LAPSED' || occ.state === 'SKIPPED') continue;
    if (protectedRest && occ.state === 'OPEN' && occ.source !== 'rest') { occ.state = 'EXEMPT'; continue; }
    if (occ.state === 'OPEN') occ.state = isMandatory(occ) ? 'MISSED' : 'LAPSED';
    if (occ.state === 'MISSED' || occ.state === 'PARTIAL') {
      if (isMandatory(occ) && !protectedRest) {
        const tier = occ.snapshot.kind === 'timed' ? timedTier(Number(occ.snapshot.targetBlocks)) : occ.snapshot.penaltyTier;
        occ.snapshot.penaltyTier = tier;
        appendDeduction(p, occ, dayKey, now);
        if (tier === 'hard') repeatTriggers.push({ dayKey, occurrence: occ, trigger: 'hard_miss' });
        if (occ.snapshot.important) repeatTriggers.push({ dayKey, occurrence: occ, trigger: 'important_miss' });
      }
    }
    if (occ.state === 'MISSED' || occ.state === 'PARTIAL' || occ.state === 'LAPSED' || occ.state === 'SKIPPED') {
      const forfeited = Math.max(0, Number(occ.snapshot.potentialXp) - Number(occ.awardedXp ?? 0));
      occ.xpForfeited = forfeited;
    }
  }
  const missList = due.filter((o) => (o.state === 'MISSED' || o.state === 'PARTIAL') && isMandatory(o) && o.source !== 'penalty' && o.source !== 'rest');
  appendFailureWindow(p, dayKey, missList, repeatTriggers, repeatState);
  const protectedByShield = updateStreaksForDay(p, dayKey, due, protectedRest, now);
  void protectedByShield;
  refreshCaches(p);
  const missedCount = due.filter((o) => o.state === 'MISSED' || (o.state === 'PARTIAL' && isMandatory(o))).length;
  const completedCount = due.filter((o) => o.state === 'COMPLETED').length;
  const xpForfeited = due.reduce((s, o) => s + Number((o as unknown as Obj).xpForfeited ?? 0), 0);
  const xpEarned = arr(p, 'xpTransactions').filter((t) => t.dayKey === dayKey && t.scope === 'player' && (t.kind === 'quest_award' || t.kind === 'partial_bank'))
    .reduce((s, t) => s + Math.max(0, Number(t.appliedDelta ?? 0)), 0);
  const xpDeducted = arr(p, 'xpTransactions').filter((t) => t.dayKey === dayKey && t.scope === 'player' && t.kind === 'penalty_deduction')
    .reduce((s, t) => s + Math.abs(Math.min(0, Number(t.appliedDelta ?? 0))), 0);
  const policy = getPolicyForDay(p.settings as SettingsLike, dayKey);
  const record: Obj = { id: dayKey, processedAt: now.toISOString(), dayEndsAt: dayEndForSettings(dayKey, p.settings as SettingsLike).toISOString(),
    resetPolicy: { timezone: policy.timezone, resetTime: policy.resetTime },
    summary: { completed: completedCount, missed: missedCount, xpEarned, xpForfeited, xpDeducted, restDay: protectedRest } };
  if (arr(p, 'dayRecords').some((d) => d.id === dayKey)) throw new Error(`Day ${dayKey} already has a record but was not advanced by the cursor`);
  arr(p, 'dayRecords').push(record);
  p.player.lastProcessedDayKey = dayKey;
  return { dayKey, completed: completedCount, missed: missedCount, xpEarned, xpForfeited, xpDeducted, restDay: protectedRest };
}

/** Pure idempotent application service. All writes are committed by the persistence adapter as one transaction. */
export function closeDayPayload(input: Payload, now = new Date()): DayCloseResult {
  const p = clone(input); const settings = p.settings as SettingsLike;
  if (!String(p.player.name ?? '').trim()) throw new Error('Player registration is required before day close');
  const currentDayKey = gameDayKeyForSettings(now, settings);
  let initialized = false;
  let last = typeof p.player.lastProcessedDayKey === 'string' ? String(p.player.lastProcessedDayKey) : '';
  if (!last) {
    if (arr(p, 'dayRecords').length) throw new Error('Cannot initialize day-close cursor while day records exist');
    last = shiftDayKey(currentDayKey, -1); p.player.lastProcessedDayKey = last; initialized = true;
  }
  if (currentDayKey <= last) return { payload: p, currentDayKey, initialized, noOp: true, closedDays: [], generatedToday: 0, absenceReport: false };
  ensureCoreMetadata(p); ensureFiveAttributes(p);
  expirePenaltyQuests(p, now, currentDayKey);
  const closedDays: ClosedDaySummary[] = []; const triggers: MissCause[] = [];
  const repeatState = { triggered: false };
  let d = shiftDayKey(last, 1);
  while (d < currentDayKey) {
    const triggersBeforeDay = triggers.length;
    closedDays.push(closeOneDay(p, d, now, triggers, repeatState));
    // A trigger evaluated on an earlier absent day suspends shields on later catch-up days,
    // even though the single penalty quest's deadline must start only when the app is open.
    if (triggers.length > triggersBeforeDay) p.meta.pendingPenaltyQuestForCatchup = true;
    d = shiftDayKey(d, 1);
  }
  delete p.meta.pendingPenaltyQuestForCatchup;
  // Repeat-failure evaluation is limited to one trigger across the whole catch-up run.
  // One penalty quest at most per catch-up run; if a penalty is already active, later causes are only logged.
  const penaltyQuestId = logPenaltyTriggers(p, triggers, now, currentDayKey);
  const today = generateOccurrencesForDay(p, currentDayKey, now);
  p.occurrences = today.payload.occurrences;
  const generatedToday = today.generated.length;
  addMessage(p, now, closedDays.length > 1 ? 'ABSENCE REPORT' : 'DAILY QUEST UPDATED',
    closedDays.length > 1
      ? `ABSENCE REPORT — processed ${closedDays.length} day(s): ${closedDays.reduce((s, x) => s + x.missed, 0)} missed occurrence(s).`
      : 'DAILY QUEST UPDATED — your current game-day quests are ready.', currentDayKey);
  refreshCaches(p); syncProgressionInPlace(p, now);
  const validation = validatePayload(p);
  if (validation.errors.length) throw new Error(`Day-close invariant failed: ${validation.errors.join('; ')}`);
  return { payload: validation.payload ?? p, currentDayKey, initialized, noOp: false, closedDays, generatedToday,
    absenceReport: closedDays.length > 1, ...(penaltyQuestId ? { penaltyQuestId } : {}) };
}

/** Test-only helper creates the normal empty payload with a ready-to-use metadata schema. */
export function createRegisteredPayload(name: string, timezone = 'UTC', resetTime = '04:00'): Payload {
  const p = emptyPayload(); p.meta = { schemaVersion: SCHEMA_VERSION, appVersion: '0.1.0' };
  p.player = { name, createdAt: new Date(0).toISOString(), allocationMode: 'manual', unspentPoints: 0, streakShields: 0, queuedShields: 0 };
  p.settings = { timezone, resetTime, weekStart: 1, penaltyStrictness: 'strict' };
  for (const id of ['academics', 'fitness', 'coding', 'discipline', 'recovery']) arr(p, 'attributes').push({ id, xpTotal: 0, level: 1, statPoints: 0 });
  return p;
}
