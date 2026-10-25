import { describe, expect, it } from 'vitest';
import { attrTotalToReach, totalXpToReach } from '../engine/progression';
import { validatePayload, type Payload } from '../persist/backup';
import { closeDayPayload, createRegisteredPayload } from '../quests/dayClose';
import { createTemplate, type QuestDefinition } from '../quests/domain';
import { completeStandardQuest, undoCompletion } from '../timer/timer';
import * as R from './rewards';

const now = new Date('2026-10-20T10:00:00Z');
const base = (): Payload => { const p = createRegisteredPayload('V', 'UTC', '04:00'); p.player.lastProcessedDayKey = '2026-10-19'; return p; };
const seed = (p: Payload, scope: string, xp: number, id = `s-${scope}-${xp}`) => p.xpTransactions.push({ id, at: '2026-10-01T00:00:00Z', dayKey: '2026-10-01', scope, kind: 'quest_award', requestedDelta: xp, appliedDelta: xp, idempotencyKey: id });
const titles = (p: Payload, attr: string) => p.rewardGrants.filter((g) => String(g.itemId).startsWith(`title:attr-${attr}-`)).map((g) => g.itemId);
const msgs = (p: Payload, attr: string) => p.systemMessages.filter((m) => String(m.id).startsWith(`msg:attr:${attr}:`)).map((m) => m.id);
const ok = (p: Payload) => expect(validatePayload(p).errors).toEqual([]);

describe('attribute titles and System messages at attribute levels 10, 25, 50 (spec 3.4)', () => {
  const cases = R.ATTRS.flatMap((a) => R.ATTRIBUTE_TITLE_LEVELS.map((T) => [a, T] as const));
  it.each(cases)('%s level %i: exactly one title and one message once reached, none just below', (attr, T) => {
    const below = base(); seed(below, attr, attrTotalToReach(T) - 1);
    expect(titles(R.syncProgression(below, now), attr)).not.toContain(`title:attr-${attr}-${T}`);
    const at = base(); seed(at, attr, attrTotalToReach(T)); const s = R.syncProgression(at, now);
    expect(titles(s, attr)).toContain(`title:attr-${attr}-${T}`); expect(msgs(s, attr)).toContain(`msg:attr:${attr}:${T}`);
    expect(s.rewardGrants.filter((g) => g.itemId === `title:attr-${attr}-${T}`)).toHaveLength(1);
    expect(s).toEqual(R.syncProgression(s, new Date(now.getTime() + 86_400_000))); ok(s); // idempotent
  });
  it('one award crossing several thresholds processes every one; other attributes are untouched', () => {
    const p = base(); seed(p, 'coding', attrTotalToReach(50)); const s = R.syncProgression(p, now);
    expect(titles(s, 'coding')).toEqual(['title:attr-coding-10', 'title:attr-coding-25', 'title:attr-coding-50']);
    expect(msgs(s, 'coding')).toHaveLength(3); expect(titles(s, 'fitness')).toEqual([]); ok(s);
    const mid = base(); seed(mid, 'fitness', attrTotalToReach(30)); expect(titles(R.syncProgression(mid, now), 'fitness')).toEqual(['title:attr-fitness-10', 'title:attr-fitness-25']);
  });
  it('attribute titles grant no points and change no XP, even when the player level is unaffected', () => {
    const p = base(); seed(p, 'academics', attrTotalToReach(25)); const s = R.syncProgression(p, now);
    expect(s.player.unspentPoints).toBe(0); expect(s.attributes.every((a) => Number(a.statPoints ?? 0) === 0)).toBe(true);
    expect(s.xpTransactions).toHaveLength(1); expect(s.levelEvents.length).toBeGreaterThanOrEqual(0);
    expect(s.rewardGrants.filter((g) => g.kind === 'attributePoints' && String(g.id).includes('attribute'))).toHaveLength(0);
  });
  it('undo, re-completion and deductions never duplicate or revoke attribute titles', () => {
    const def: QuestDefinition = { title: 'Q', category: 'coding', kind: 'standard', difficulty: 'easy', mandatory: true, important: false, schedule: { type: 'daily' } };
    let p = base(); seed(p, 'player', totalXpToReach(10) + 500); seed(p, 'coding', attrTotalToReach(10) - 30);
    p = createTemplate(p, def, '2026-10-01', now).payload; p = closeDayPayload(p, now).payload;
    const occ = String(p.occurrences.find((o) => o.source === 'recurring')!.id);
    const done = completeStandardQuest(p, occ, true, now).payload; // +50 crosses coding level 10
    expect(titles(done, 'coding')).toEqual(['title:attr-coding-10']); expect(msgs(done, 'coding')).toHaveLength(1);
    const undone = undoCompletion(done, occ, now).payload;
    expect(titles(undone, 'coding')).toEqual(['title:attr-coding-10']); // not revoked
    const again = completeStandardQuest(undone, occ, true, now).payload;
    expect(titles(again, 'coding')).toEqual(['title:attr-coding-10']); expect(msgs(again, 'coding')).toHaveLength(1);
    expect(again.rewardGrants.filter((g) => g.kind === 'title')).toEqual(done.rewardGrants.filter((g) => g.kind === 'title'));
    ok(again);
    const missed = closeDayPayload(closeDayPayload(again, new Date('2026-10-22T10:00:00Z')).payload, new Date('2026-10-23T10:00:00Z')).payload;
    expect(titles(missed, 'coding')).toEqual(['title:attr-coding-10']); ok(missed);
  });
});
