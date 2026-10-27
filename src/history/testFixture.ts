// Test-only fixture: five game days (UTC, reset 04:00) built through the real domain functions.
// d0 2026-10-20 both quests completed | d1 2026-10-21 ignored (miss + deduction) | d2 2026-10-22 only B completed | d3 2026-10-23 protected rest day | d4 2026-10-24 open (today)
import type { Payload } from '../persist/backup';
import { closeDayPayload, createRegisteredPayload } from '../quests/dayClose';
import { addRestDay, createTemplate, type QuestDefinition } from '../quests/domain';
import { completeStandardQuest } from '../timer/timer';

export const at = (day: string, h: number, m = 0) => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
const def = (title: string, difficulty: 'easy' | 'medium', mandatory: boolean): QuestDefinition => ({ title, category: 'coding', kind: 'standard', difficulty, mandatory, important: false, schedule: { type: 'daily' } });
export const complete = (p: Payload, day: string, title: string, when: Date): Payload => {
  const o = p.occurrences.find((x) => x.dayKey === day && x.state === 'OPEN' && (x.snapshot as { title: string }).title === title)!;
  return completeStandardQuest(p, String(o.id), true, when).payload;
};
export function timeline(): Payload {
  let p = createRegisteredPayload('V', 'UTC', '04:00'); p.player.lastProcessedDayKey = '2026-10-19';
  p = createTemplate(p, def('A', 'medium', true), '2026-10-20', at('2026-10-20', 9)).payload;
  p = createTemplate(p, def('B', 'easy', false), '2026-10-20', at('2026-10-20', 9)).payload;
  p = closeDayPayload(p, at('2026-10-20', 10)).payload; p = complete(p, '2026-10-20', 'A', at('2026-10-20', 11)); p = complete(p, '2026-10-20', 'B', at('2026-10-20', 11, 5));
  p = closeDayPayload(p, at('2026-10-21', 10)).payload;
  p = closeDayPayload(p, at('2026-10-22', 10)).payload; p = complete(p, '2026-10-22', 'B', at('2026-10-22', 11));
  p = addRestDay(p, { kind: 'adhoc', dayKey: '2026-10-23' }, p.settings as never, at('2026-10-22', 12)).payload;
  p = closeDayPayload(p, at('2026-10-23', 10)).payload;
  p = closeDayPayload(p, at('2026-10-24', 10)).payload;
  return p;
}
