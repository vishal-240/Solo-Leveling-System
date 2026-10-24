// P4 runtime: each action is one atomic IndexedDB transaction under the single-writer lock (spec 5.3, 6.3).
import { mutatePayload, type SlsDb } from '../persist/store';
import type { Payload } from '../persist/backup';
import { withSingleWriterLock } from '../quests/runtime';
import * as T from './timer';

const run = <R>(db: SlsDb, f: (p: Payload) => { payload: Payload; result: R }) => withSingleWriterLock(() => mutatePayload(db, (cur) => f(cur)));
export const startTimerDb = (db: SlsDb, occ: string, now = new Date()) => run(db, (p) => T.startTimer(p, occ, now));
export const resumeTimerDb = (db: SlsDb, occ: string, now = new Date()) => run(db, (p) => T.resumeTimer(p, occ, now));
export const pauseTimerDb = (db: SlsDb, occ: string, now = new Date()) => run(db, (p) => T.pauseTimer(p, occ, now));
export const heartbeatDb = (db: SlsDb, occ: string, now = new Date()) => run(db, (p) => T.heartbeat(p, occ, now));
export const resolveGapDb = (db: SlsDb, occ: string, countedMs: number, now = new Date()) => run(db, (p) => T.resolveGap(p, occ, countedMs, now));
export const completeTimerDb = (db: SlsDb, occ: string, confirmed: boolean, now = new Date()) => run(db, (p) => T.completeTimer(p, occ, confirmed, now));
export const bankPartialDb = (db: SlsDb, occ: string, now = new Date()) => run(db, (p) => T.bankPartial(p, occ, now));
export const completeStandardDb = (db: SlsDb, occ: string, confirmed: boolean, now = new Date()) => run(db, (p) => T.completeStandardQuest(p, occ, confirmed, now));
export const undoCompletionDb = (db: SlsDb, occ: string, now = new Date()) => run(db, (p) => T.undoCompletion(p, occ, now));
export const settleSessionsDb = (db: SlsDb, now = new Date()) => run(db, (p) => ({ payload: T.settleSessions(p, now), result: undefined }));
