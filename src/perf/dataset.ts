// Test-only synthetic history: N game days of quests, ledger entries, day records, events and rewards (about three years by default).
import { attrLevelFromXp, totalXpToReach } from '../engine/progression';
import type { Payload } from '../persist/backup';
import { emptyPayload } from '../persist/backup';

const key = (n: number) => new Date(Date.UTC(2023, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
export function bigPayload(days = 1095, perDay = 5): Payload {
  const p = emptyPayload(); p.meta = { schemaVersion: 3, appVersion: '1.0.0', seenEvents: [] }; p.player = { name: 'Big', createdAt: '2023-01-01T00:00:00.000Z', lastProcessedDayKey: key(days - 1) }; p.settings = { timezone: 'UTC', resetTime: '04:00' };
  p.attributes = ['academics', 'fitness', 'coding', 'discipline', 'recovery'].map((id) => ({ id, xpTotal: 0, level: 1 }));
  p.templates = [{ id: 't', status: 'active' }]; p.templateVersions = [{ id: 'v', templateId: 't', effectiveFromDayKey: key(0), title: 'Q', category: 'coding', kind: 'standard', difficulty: 'easy', mandatory: true, important: false, schedule: { type: 'daily' } }];
  let n = 0; let xp = 0; const level = new Set<number>();
  for (let d = 0; d < days; d++) {
    const dk = key(d), at = `${dk}T11:00:00.000Z`;
    p.dayRecords.push({ id: dk, processedAt: `${dk}T23:59:00.000Z`, dayEndsAt: `${key(d + 1)}T04:00:00.000Z`, summary: { completed: perDay - 1, missed: 1, xpEarned: 200, xpForfeited: 50, xpDeducted: 13, restDay: false } });
    for (let q = 0; q < perDay; q++) {
      const id = `o${n++}`, done = q < perDay - 1; p.occurrences.push({ id, dayKey: dk, source: 'recurring', templateVersionId: 'v', state: done ? 'COMPLETED' : 'MISSED', completedAt: done ? at : undefined, awardedXp: done ? 50 : 0, snapshot: { title: 'Q', category: 'coding', kind: 'standard', difficulty: 'easy', mandatory: true, important: false, potentialXp: 50, penaltyTier: 'easy' } });
      if (done) for (const scope of ['player', 'coding']) p.xpTransactions.push({ id: `x${n}-${scope}`, at, dayKey: dk, scope, kind: 'quest_award', occurrenceId: id, requestedDelta: 50, appliedDelta: 50, idempotencyKey: `award:${id}:0:${scope}` });
      else for (const scope of ['player', 'coding']) p.xpTransactions.push({ id: `d${n}-${scope}`, at, dayKey: dk, scope, kind: 'penalty_deduction', occurrenceId: id, requestedDelta: -13, appliedDelta: -13, idempotencyKey: `miss:${id}:${scope}` });
    }
    xp += 4 * 50 - 13; for (let L = 2; xp >= totalXpToReach(L) && !level.has(L); L++) { level.add(L); p.levelEvents.push({ id: `level:${L}`, level: L, at }); p.rewardGrants.push({ id: `g${L}`, source: { type: 'level', ref: L }, kind: 'attributePoints', amount: 1, at }); }
    p.systemMessages.push({ id: `m${d}`, at, kind: 'DAILY QUEST UPDATED', text: `${perDay} quests`, read: false });
  }
  const total = p.xpTransactions.filter((t) => t.scope === 'player').reduce((s, t) => s + Number(t.appliedDelta), 0); const coding = p.xpTransactions.filter((t) => t.scope === 'coding').reduce((s, t) => s + Number(t.appliedDelta), 0);
  p.attributes[2] = { id: 'coding', xpTotal: coding, level: attrLevelFromXp(coding) }; p.streaks = [{ id: 's', scope: 'daily', current: 5, longest: 40 }]; void total;
  return p;
}
