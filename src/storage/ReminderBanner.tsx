import { snoozeReminder } from '../app/actions';
import type { Payload } from '../persist/backup';
import type { SlsDb } from '../persist/store';
import { SystemMessage } from '../ui/components';
import { reminderState } from './reminders';

export function ReminderBanner({ db, payload, refresh, onOpenSettings, now = new Date() }: { db: SlsDb; payload: Payload; refresh: () => Promise<void>; onOpenSettings: () => void; now?: Date }) {
  const r = reminderState(payload, now); if (!r.due) return null;
  const text = r.reason === 'rank' ? 'You have been promoted since your last backup. Export one now to protect your progress.'
    : r.lastExportAt ? `Your last backup was ${r.ageDays} day${r.ageDays === 1 ? '' : 's'} ago. Your data lives only in this browser.` : `You have not exported a backup yet (${r.ageDays} day${r.ageDays === 1 ? '' : 's'} of progress). Your data lives only in this browser.`;
  return (
    <SystemMessage title="BACKUP REMINDER" kind="reward">{' '}{text}{' '}
      <button type="button" className="btn btn--primary" onClick={onOpenSettings}>Open backup settings</button>{' '}
      <button type="button" className="btn" onClick={() => { void snoozeReminder(db, new Date()).then(refresh).catch(() => undefined); }}>Remind me tomorrow</button>
    </SystemMessage>
  );
}
