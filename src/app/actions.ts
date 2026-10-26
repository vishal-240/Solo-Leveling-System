// P7 action layer: every UI action is a thin, atomic wrapper over the existing domain functions (no business rules live in React).
import { importBackup, loadPayload, mutatePayload, type SlsDb } from '../persist/store';
import { exportBackup, type Payload } from '../persist/backup';
import { gameDayKeyForSettings, shiftDayKey, type SettingsLike } from '../quests/calendar';
import { addRestDay, archiveTemplate, changeResetPolicy, createOneOff, createTemplate, editTemplate, generateOccurrencesForDay, pauseTemplate, removeRestDay, resumeTemplate,
  type OneOffInput, type QuestDefinition, type RestDayInput } from '../quests/domain';
import { processDayClose, skipQuestOccurrence, withSingleWriterLock } from '../quests/runtime';
import * as R from '../rewards/rewards';

export const todayKey = (p: Payload, now: Date) => gameDayKeyForSettings(now, p.settings as SettingsLike);
const tx = <T>(db: SlsDb, f: (p: Payload) => { payload: Payload; result: T }) => withSingleWriterLock(() => mutatePayload(db, f));

export const runDayClose = (db: SlsDb, now = new Date()) => processDayClose(db, now);
/** New recurring quest: template effective today, and today's occurrence is generated in the same atomic write. */
export const createRecurringQuest = (db: SlsDb, def: QuestDefinition, now = new Date()) => tx(db, (p) => {
  const dk = todayKey(p, now); const t = createTemplate(p, def, dk, now);
  return { payload: generateOccurrencesForDay(t.payload, dk, now).payload, result: t.result };
});
export const createOneOffQuest = (db: SlsDb, input: OneOffInput, now = new Date()) => tx(db, (p) => createOneOff(p, input, todayKey(p, now), now));
/** Edits, pauses, resumes and removals apply from tomorrow: today's generated occurrence is never rewritten. */
export const editQuest = (db: SlsDb, id: string, patch: Partial<QuestDefinition>, now = new Date()) => tx(db, (p) => editTemplate(p, id, patch, shiftDayKey(todayKey(p, now), 1), now));
export const pauseQuest = (db: SlsDb, id: string, now = new Date()) => tx(db, (p) => pauseTemplate(p, id, shiftDayKey(todayKey(p, now), 1), undefined, now));
export const resumeQuest = (db: SlsDb, id: string, now = new Date()) => tx(db, (p) => resumeTemplate(p, id, shiftDayKey(todayKey(p, now), 1), now));
export const removeQuest = (db: SlsDb, id: string, now = new Date()) => tx(db, (p) => archiveTemplate(p, id, shiftDayKey(todayKey(p, now), 1)));
export const skipQuest = (db: SlsDb, occurrenceId: string, now = new Date()) => skipQuestOccurrence(db, occurrenceId, now);

export const changeReset = (db: SlsDb, timezone: string, resetTime: string, now = new Date()) =>
  tx(db, (p) => changeResetPolicy(p, todayKey(p, now), timezone, resetTime, now));
export const addRest = (db: SlsDb, input: RestDayInput, now = new Date()) => tx(db, (p) => addRestDay(p, input, p.settings as SettingsLike, now));
export const removeRest = (db: SlsDb, id: string) => tx(db, (p) => ({ payload: removeRestDay(p, id), result: true }));

export function validateName(name: string): string | undefined {
  if (!name.trim()) return 'Name is required.'; if (name.trim().length > 24) return 'Name must be 24 characters or fewer.';
  if (/[\u0000-\u001f]/.test(name)) return 'Name contains invalid characters.'; return undefined;
}
export const updateProfile = (db: SlsDb, name: string, startingTitle: string) => tx(db, (p) => {
  const e = validateName(name); if (e) throw new Error(e);
  if (startingTitle.trim().length > 32) throw new Error('Title must be 32 characters or fewer.');
  const q = structuredClone(p); q.player.name = name.trim(); if (startingTitle.trim()) q.player.startingTitle = startingTitle.trim(); else delete q.player.startingTitle;
  return { payload: q, result: true };
});
export const updatePreferences = (db: SlsDb, effects: 'full' | 'reduced' | 'minimal', musicEnabled: boolean) => tx(db, (p) => {
  const q = structuredClone(p); const audio = (q.settings.audio ?? { master: 1, music: 0.5, sfx: 0.8, musicEnabled: false }) as Record<string, unknown>;
  q.settings.effects = effects; q.settings.audio = { ...audio, musicEnabled }; return { payload: q, result: true };
});
export const setMode = (db: SlsDb, m: R.AllocationMode) => tx(db, (p) => ({ payload: R.setAllocationMode(p, m), result: true }));
export const allocate = (db: SlsDb, attr: string, n: number, now = new Date()) => tx(db, (p) => ({ payload: R.allocatePoints(p, attr, n, now), result: true }));
export const distribute = (db: SlsDb, m: 'balanced' | 'momentum', now = new Date()) => tx(db, (p) => ({ payload: R.distributeBanked(p, m, now), result: true }));
export const respecPoints = (db: SlsDb, now = new Date()) => tx(db, (p) => ({ payload: R.respec(p, now), result: true }));
export const equipTitleItem = (db: SlsDb, id: string) => tx(db, (p) => ({ payload: R.equipTitle(p, id), result: true }));
export const equipFrameItem = (db: SlsDb, id: string) => tx(db, (p) => ({ payload: R.equipFrame(p, id), result: true }));

/** Records the export time, then serialises the stored data with the existing backup codec. */
export const exportBackupText = (db: SlsDb, now = new Date()) => withSingleWriterLock(async () => {
  await mutatePayload(db, (p) => { const q = structuredClone(p); q.meta.lastExportAt = now.toISOString(); return { payload: q, result: true }; });
  return exportBackup(await loadPayload(db), __APP_VERSION__, now);
});
export const importBackupText = (db: SlsDb, text: string, now = new Date()) => withSingleWriterLock(() => importBackup(db, text, now));
