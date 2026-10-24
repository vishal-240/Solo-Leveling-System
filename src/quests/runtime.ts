import { mutatePayload, type SlsDb } from '../persist/store';
import type { Payload } from '../persist/backup';
import { shiftDayKey, type SettingsLike } from './calendar';
import {
  addRestDay, archiveTemplate, changeResetPolicy, createOneOff, createTemplate, editTemplate, pauseTemplate,
  removeRestDay, resumeTemplate, skipOccurrence, type OneOffInput, type QuestDefinition, type RestDayInput,
} from './domain';
import { closeDayPayload, type DayCloseResult } from './dayClose';

let localTail: Promise<void> = Promise.resolve();
const LEASE_KEY = 'sls-system-single-writer-lease-v1';
const LOCK_NAME = 'sls-system-day-close-v1';

type LockManagerMaybe = { request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> };
function canUseStorage(): boolean {
  try { if (typeof localStorage === 'undefined') return false; const key = `${LEASE_KEY}-probe`; localStorage.setItem(key, '1'); localStorage.removeItem(key); return true; } catch { return false; }
}
async function wait(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }
/** Web Locks first, with a BroadcastChannel + localStorage lease fallback for older browsers. */
export async function withSingleWriterLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManagerMaybe }).locks : undefined;
  if (locks?.request) return locks.request(LOCK_NAME, { mode: 'exclusive' }, work);
  // The in-tab queue prevents same-tab races even if browser storage is unavailable.
  let releaseLocal!: () => void;
  const previous = localTail;
  localTail = new Promise<void>((resolve) => { releaseLocal = resolve; });
  await previous;
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let channel: BroadcastChannel | undefined;
  try { if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel(`${LEASE_KEY}-channel`); } catch { /* fallback still uses storage */ }
  let claimed = false;
  try {
    if (!canUseStorage()) {
      // Keep the channel open until finally; closing it here would make the final
      // lock-released post throw and could mask the actual result.
      channel?.postMessage({ type: 'lock-unavailable', owner });
      // Environments without Web Locks or shared storage (e.g. test runners) only get
      // an in-process mutex. Production browsers normally take the Web Locks branch.
      return await work();
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      let lease: { owner?: string; expiresAt?: number } | undefined;
      try { lease = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as typeof lease; } catch { lease = undefined; }
      if (!lease?.owner || Number(lease.expiresAt ?? 0) <= Date.now() || lease.owner === owner) {
        const proposed = { owner, expiresAt: Date.now() + 10 * 60_000 };
        localStorage.setItem(LEASE_KEY, JSON.stringify(proposed));
        let check: { owner?: string } | undefined;
        try { check = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as typeof check; } catch { check = undefined; }
        if (check?.owner === owner) { claimed = true; break; }
      }
      await wait(50 + Math.floor(Math.random() * 50));
    }
    if (!claimed) throw new Error('Could not acquire the day-close lock; no data was changed. Retry once other tabs are closed.');
    channel?.postMessage({ type: 'lock-acquired', owner, expiresAt: Date.now() + 10 * 60_000 });
    return await work();
  } finally {
    if (claimed && canUseStorage()) {
      try { const lease = JSON.parse(localStorage.getItem(LEASE_KEY) ?? 'null') as { owner?: string } | null; if (lease?.owner === owner) localStorage.removeItem(LEASE_KEY); } catch { /* ignore cleanup-only storage failures */ }
    }
    channel?.postMessage({ type: 'lock-released', owner }); channel?.close(); releaseLocal();
  }
}

export async function addQuestTemplate(db: SlsDb, definition: QuestDefinition, currentGameDayKey: string, now = new Date()) {
  const effective = currentGameDayKey;
  return mutatePayload(db, (p) => createTemplate(p, definition, effective, now));
}
export async function editQuestTemplate(db: SlsDb, templateId: string, patch: Partial<QuestDefinition>, currentGameDayKey: string, now = new Date()) {
  return mutatePayload(db, (p) => editTemplate(p, templateId, patch, shiftDayKey(currentGameDayKey, 1), now));
}
export async function pauseQuestTemplate(db: SlsDb, templateId: string, currentGameDayKey: string, resumeDayKey?: string, now = new Date()) {
  return mutatePayload(db, (p) => pauseTemplate(p, templateId, shiftDayKey(currentGameDayKey, 1), resumeDayKey, now));
}
export async function resumeQuestTemplate(db: SlsDb, templateId: string, currentGameDayKey: string, now = new Date()) {
  return mutatePayload(db, (p) => resumeTemplate(p, templateId, shiftDayKey(currentGameDayKey, 1), now));
}
export async function deleteQuestTemplate(db: SlsDb, templateId: string, currentGameDayKey: string) {
  return mutatePayload(db, (p) => archiveTemplate(p, templateId, shiftDayKey(currentGameDayKey, 1)));
}
export async function changeTimezoneAndReset(db: SlsDb, currentGameDayKey: string, timezone: string, resetTime: string, now = new Date()) {
  return mutatePayload(db, (p) => changeResetPolicy(p, currentGameDayKey, timezone, resetTime, now));
}
export async function addOneOffQuest(db: SlsDb, input: OneOffInput, currentGameDayKey: string, now = new Date()) {
  return mutatePayload(db, (p) => createOneOff(p, input, currentGameDayKey, now));
}
export async function skipQuestOccurrence(db: SlsDb, occurrenceId: string, now = new Date()) {
  return mutatePayload(db, (p) => skipOccurrence(p, occurrenceId, p.settings as SettingsLike, now));
}
export async function addProtectedRestDay(db: SlsDb, input: RestDayInput, now = new Date()) {
  return mutatePayload(db, (p) => addRestDay(p, input, p.settings as SettingsLike, now));
}
export async function removeProtectedRestDay(db: SlsDb, restDayId: string) {
  return mutatePayload(db, (p) => ({ payload: removeRestDay(p, restDayId), result: true }));
}
export async function processDayClose(db: SlsDb, now = new Date()): Promise<Omit<DayCloseResult, 'payload'>> {
  return withSingleWriterLock(() => mutatePayload(db, (current: Payload) => {
    const result = closeDayPayload(current, now);
    const { payload, ...summary } = result;
    return { payload, result: summary };
  }));
}
