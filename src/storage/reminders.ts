import type { Payload } from '../persist/backup';
export interface Reminder { due: boolean; reason: 'interval' | 'rank' | null; days: number; ageDays: number | null; lastExportAt: string | null }
const DAY = 86_400_000;
/** Backup reminder (spec 6.5): last export (or registration, if never exported) older than the configured interval, or a rank promotion since the last export. Snoozed reminders stay quiet. */
export function reminderState(p: Payload, now: Date): Reminder {
  const d = Number(p.settings.backupReminderDays); const days = [3, 7, 14, 30].includes(d) ? d : 7;
  const last = typeof p.meta.lastExportAt === 'string' ? Date.parse(p.meta.lastExportAt) : NaN; const created = typeof p.player.createdAt === 'string' ? Date.parse(p.player.createdAt) : NaN;
  const base = Number.isFinite(last) ? last : created; const lastExportAt = Number.isFinite(last) ? String(p.meta.lastExportAt) : null;
  if (!Number.isFinite(base)) return { due: false, reason: null, days, ageDays: null, lastExportAt };
  const snooze = typeof p.meta.reminderSnoozedUntil === 'string' ? Date.parse(p.meta.reminderSnoozedUntil) : NaN; const ageDays = Math.floor((now.getTime() - base) / DAY);
  const rank = p.rankEvents.some((e) => Date.parse(String(e.at)) > (Number.isFinite(last) ? last : created));
  const reason = rank ? 'rank' : now.getTime() - base > days * DAY ? 'interval' : null;
  return { due: !!reason && !(snooze > now.getTime()), reason, days, ageDays, lastExportAt };
}
