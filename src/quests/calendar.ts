/** Game-day and reset-time calculations for Spec §§5.2–5.5. Uses Intl so no device-local timezone assumptions leak in. */
export type ResetPolicy = { timezone: string; resetTime: string; dayKeyOffset: number; effectiveFromDayKey?: string };
export type ResetPolicyEntry = { timezone: string; resetTime: string; effectiveFromDayKey: string; dayKeyOffset?: number };
export type SettingsLike = Record<string, unknown> & { timezone?: string; resetTime?: string; resetPolicyHistory?: ResetPolicyEntry[] };

const DAY_MS = 86_400_000;
export const isDayKey = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
export function shiftDayKey(dayKey: string, amount: number): string {
  if (!isDayKey(dayKey)) throw new RangeError(`Invalid dayKey: ${dayKey}`);
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export const weekdayOf = (dayKey: string): number => new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
export const compareDayKeys = (a: string, b: string): number => a.localeCompare(b);

function formatter(timeZone: string): Intl.DateTimeFormat {
  // Constructing this also validates the IANA timezone.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
}
export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
export function zonedPartsAt(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}
const scalar = (p: ZonedParts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
const keyOf = (p: ZonedParts) => `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
const parseTime = (time: string): { hour: number; minute: number } => {
  const m = /^(\d{2}):([0-5]\d)$/.exec(time);
  if (!m || Number(m[1]) > 23) throw new RangeError(`Invalid reset time: ${time}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
};

/**
 * Converts a wall-clock local time into an instant. If the time occurs twice, selects
 * the earlier occurrence. If the time falls in a DST gap, selects the first valid local
 * time after the gap. This is used for reset boundaries, not for user-entered instants.
 */
export function zonedDateTimeToInstant(dayKey: string, time: string, timeZone: string): Date {
  if (!isDayKey(dayKey)) throw new RangeError(`Invalid dayKey: ${dayKey}`);
  const { hour, minute } = parseTime(time);
  // Validate the zone eagerly.
  formatter(timeZone);
  const [year, month, day] = dayKey.split('-').map(Number);
  const target: ZonedParts = { year: year!, month: month!, day: day!, hour, minute, second: 0 };
  const wall = scalar(target);
  const offsets = new Set<number>();
  // Sample both sides of possible offset changes (including 30-minute DST changes).
  for (let h = -36; h <= 36; h += 3) {
    const sample = wall + h * 3_600_000;
    const sampleDate = new Date(sample);
    const actual = zonedPartsAt(sampleDate, timeZone);
    offsets.add(scalar(actual) - Math.floor(sample / 1000) * 1000);
  }
  const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  const exact = candidates.filter((ms) => {
    const p = zonedPartsAt(new Date(ms), timeZone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute && p.second === 0;
  });
  if (exact.length) return new Date(Math.min(...exact)); // overlap: first occurrence

  // Gap: scan a small window around candidate instants and select the smallest valid
  // wall time not earlier than the requested wall time (e.g. 02:30 -> 03:00).
  const center = candidates.length ? candidates[Math.floor(candidates.length / 2)]! : wall;
  let best: { epoch: number; wallDelta: number } | undefined;
  const lo = Math.min(...candidates, center) - 3 * 3_600_000;
  const hi = Math.max(...candidates, center) + 3 * 3_600_000;
  for (let ms = Math.floor(lo / 60_000) * 60_000; ms <= hi; ms += 60_000) {
    const p = zonedPartsAt(new Date(ms), timeZone);
    if (p.year !== year || p.month !== month || p.day !== day) continue;
    const wallValue = scalar(p);
    if (wallValue < wall) continue;
    const delta = wallValue - wall;
    if (!best || delta < best.wallDelta || (delta === best.wallDelta && ms < best.epoch)) best = { epoch: ms, wallDelta: delta };
  }
  if (best) return new Date(best.epoch);
  throw new RangeError(`Could not resolve ${dayKey} ${time} in ${timeZone}`);
}

export function gameDayKeyAt(instant: Date, timezone: string, resetTime: string): string {
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Invalid instant');
  const local = zonedPartsAt(instant, timezone);
  const { hour, minute } = parseTime(resetTime);
  const today = keyOf(local);
  return local.hour < hour || (local.hour === hour && local.minute < minute) ? shiftDayKey(today, -1) : today;
}
export function dayStartAt(dayKey: string, timezone: string, resetTime: string): Date {
  return zonedDateTimeToInstant(dayKey, resetTime, timezone);
}
export function dayEndAt(dayKey: string, timezone: string, resetTime: string): Date {
  return zonedDateTimeToInstant(shiftDayKey(dayKey, 1), resetTime, timezone);
}
function resolvedHistory(settings: SettingsLike): ResetPolicyEntry[] {
  const history = Array.isArray(settings.resetPolicyHistory) ? settings.resetPolicyHistory : [];
  const sorted = [...history].filter((x) => typeof x.effectiveFromDayKey === 'string')
    .sort((a, b) => a.effectiveFromDayKey.localeCompare(b.effectiveFromDayKey));
  if (!sorted.length) return [{ effectiveFromDayKey: '0001-01-01', timezone: typeof settings.timezone === 'string' ? settings.timezone : 'UTC',
    resetTime: typeof settings.resetTime === 'string' ? settings.resetTime : '04:00', dayKeyOffset: 0 }];
  const out: ResetPolicyEntry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    formatter(entry.timezone); parseTime(entry.resetTime);
    let offset = typeof entry.dayKeyOffset === 'number' && Number.isInteger(entry.dayKeyOffset) ? entry.dayKeyOffset : 0;
    if (i > 0 && !(typeof entry.dayKeyOffset === 'number' && Number.isInteger(entry.dayKeyOffset))) {
      const prev = out[i - 1]!;
      const previousLabel = shiftDayKey(entry.effectiveFromDayKey, -1);
      const previousRawKey = shiftDayKey(previousLabel, -Number(prev.dayKeyOffset ?? 0));
      const transition = dayEndAt(previousRawKey, prev.timezone, prev.resetTime);
      const rawNewKey = gameDayKeyAt(new Date(transition.getTime() + 1), entry.timezone, entry.resetTime);
      offset = dayNumber(entry.effectiveFromDayKey) - dayNumber(rawNewKey);
    }
    out.push({ ...entry, dayKeyOffset: offset });
  }
  return out;
}
const dayNumber = (k: string) => Date.parse(`${k}T00:00:00.000Z`) / DAY_MS;
function dayEndForPolicyLabel(dayKey: string, policy: ResetPolicyEntry): Date {
  return dayEndAt(shiftDayKey(dayKey, -Number(policy.dayKeyOffset ?? 0)), policy.timezone, policy.resetTime);
}
export function getPolicyForDay(settings: SettingsLike, dayKey: string): ResetPolicy {
  const history = resolvedHistory(settings);
  const eligible = history.filter((x) => x.effectiveFromDayKey <= dayKey);
  const selected = eligible.at(-1) ?? history[0]!;
  return { timezone: selected.timezone, resetTime: selected.resetTime, dayKeyOffset: Number(selected.dayKeyOffset ?? 0), effectiveFromDayKey: selected.effectiveFromDayKey };
}
function getPolicyForInstant(settings: SettingsLike, instant: Date): ResetPolicy {
  const history = resolvedHistory(settings);
  let selected = history[0]!;
  for (let i = 1; i < history.length; i++) {
    const candidate = history[i]!;
    const boundary = dayEndForPolicyLabel(shiftDayKey(candidate.effectiveFromDayKey, -1), selected);
    if (instant.getTime() >= boundary.getTime()) selected = candidate;
    else break;
  }
  return { timezone: selected.timezone, resetTime: selected.resetTime, dayKeyOffset: Number(selected.dayKeyOffset ?? 0), effectiveFromDayKey: selected.effectiveFromDayKey };
}
export function gameDayKeyForSettings(instant: Date, settings: SettingsLike): string {
  const policy = getPolicyForInstant(settings, instant);
  const rawKey = gameDayKeyAt(instant, policy.timezone, policy.resetTime);
  return shiftDayKey(rawKey, policy.dayKeyOffset);
}
export function dayEndForSettings(dayKey: string, settings: SettingsLike): Date {
  const policy = getPolicyForDay(settings, dayKey);
  return dayEndForPolicyLabel(dayKey, { ...policy, effectiveFromDayKey: policy.effectiveFromDayKey ?? '0001-01-01' });
}
export function dayStartForSettings(dayKey: string, settings: SettingsLike): Date {
  return dayEndForSettings(shiftDayKey(dayKey, -1), settings);
}
