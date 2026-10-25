// Registration (spec 2.1 step 7): one atomic write of the player, settings, attributes, quest templates and today's first quest list.
import type { Payload } from '../persist/backup';
import { mutatePayload, type SlsDb } from '../persist/store';
import { closeDayPayload, createRegisteredPayload } from '../quests/dayClose';
import { gameDayKeyForSettings } from '../quests/calendar';
import { createTemplate, newUlid } from '../quests/domain';
import { withSingleWriterLock } from '../quests/runtime';
import { definitionsFor, effectiveName, type Draft } from './model';

export class OnboardingError extends Error { constructor(public code: 'ALREADY_REGISTERED', message?: string) { super(message ?? code); } }
export function buildRegistration(d: Draft, now: Date): { payload: Payload; quests: number; generated: number } {
  let p = createRegisteredPayload(effectiveName(d), d.timezone, d.resetTime);
  p.player.createdAt = now.toISOString(); p.player.allocationMode = d.allocationMode;
  if (d.title.trim()) p.player.startingTitle = d.title.trim();
  p.meta.installId = newUlid(now);
  p.settings = { ...p.settings, effects: d.effects, backupReminderDays: 7, audio: { master: 1, music: 0.5, sfx: 0.8, musicEnabled: d.musicEnabled } };
  for (const a of p.attributes) { const g = d.goals[a.id as keyof Draft['goals']]?.trim(); if (g) a.goal = g; }
  const dayKey = gameDayKeyForSettings(now, p.settings as never);
  const defs = definitionsFor(d);
  for (const def of defs) p = createTemplate(p, def, dayKey, now).payload;
  const closed = closeDayPayload(p, now); // initialises the day-close cursor and generates today's occurrences
  return { payload: closed.payload, quests: defs.length, generated: closed.generatedToday };
}
/** Idempotent against double submission and reloads: a second registration is rejected without touching stored data. */
export function registerPlayer(db: SlsDb, d: Draft, now = new Date()) {
  return withSingleWriterLock(() => mutatePayload(db, (cur) => {
    if (Object.keys(cur.meta).length > 0) throw new OnboardingError('ALREADY_REGISTERED');
    const r = buildRegistration(d, now); return { payload: r.payload, result: { quests: r.quests, generated: r.generated } };
  }));
}
