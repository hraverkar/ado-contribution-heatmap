/**
 * Local-calendar date helpers.
 *
 * The heatmap is a calendar of the *viewer's* days, so every commit timestamp
 * is bucketed using the browser's local timezone. All helpers work on "day
 * keys": `YYYY-MM-DD` strings that carry no time or timezone information.
 *
 * Arithmetic goes through `Date.setDate` on local-midnight dates, which keeps
 * the wall-clock day stable across daylight-saving transitions.
 */

import { MAX_CUSTOM_RANGE_DAYS, MIN_SUPPORTED_DAY } from '../config/constants.js';
import type { DateRange, DateRangePresetId } from '../models/dateRange.js';

const MS_PER_DAY = 86_400_000;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const MONTH_SHORT_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const;

const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** `true` when `value` is a syntactically valid and real calendar day key. */
export function isValidDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_KEY_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  // Round-trips only when the day actually exists (rejects e.g. 2025-02-30).
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Converts a `Date` to its local calendar day key. */
export function toDayKey(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Converts epoch milliseconds to the local calendar day key. */
export function dayKeyFromTimestamp(timestamp: number): string {
  return toDayKey(new Date(timestamp));
}

/** Returns local midnight of the given day key. Throws on malformed input. */
export function parseDayKey(key: string): Date {
  if (!isValidDayKey(key)) {
    throw new RangeError(`Invalid day key: ${String(key)}`);
  }
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/** Shifts a day key by `days` (may be negative). */
export function addDays(key: string, days: number): string {
  const date = parseDayKey(key);
  date.setDate(date.getDate() + days);
  return toDayKey(date);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function diffInDays(from: string, to: string): number {
  const a = parseDayKey(from);
  const b = parseDayKey(to);
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / MS_PER_DAY);
}

/** Day-of-week index for a day key: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return parseDayKey(key).getDay();
}

/** Rolls a day key back to the first day of its week. */
export function startOfWeek(key: string, weekStartsOn: number = 0): string {
  const offset = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDays(key, -offset);
}

/** Rolls a day key forward to the last day of its week. */
export function endOfWeek(key: string, weekStartsOn: number = 0): string {
  return addDays(startOfWeek(key, weekStartsOn), 6);
}

/** Every day key from `start` to `end`, inclusive. Empty when the range is inverted. */
export function enumerateDays(range: DateRange): string[] {
  const span = diffInDays(range.start, range.end);
  if (span < 0) {
    return [];
  }
  const days: string[] = new Array<string>(span + 1);
  let cursor = range.start;
  for (let index = 0; index <= span; index += 1) {
    days[index] = cursor;
    cursor = addDays(cursor, 1);
  }
  return days;
}

/** Inclusive containment test. */
export function isWithinRange(key: string, range: DateRange): boolean {
  return key >= range.start && key <= range.end;
}

/** Number of days covered by an inclusive range; 0 when inverted. */
export function rangeLength(range: DateRange): number {
  const span = diffInDays(range.start, range.end);
  return span < 0 ? 0 : span + 1;
}

/** Orders a range so `start` never follows `end`. */
export function normalizeRange(range: DateRange): DateRange {
  return range.start <= range.end ? range : { start: range.end, end: range.start };
}

/**
 * Resolves a preset into concrete dates, relative to `today`.
 *
 * `last-N` ranges are inclusive of today, so `last-30` covers 30 calendar days
 * ending today. `current-year` runs from 1 January to today.
 */
export function resolveDateRange(
  preset: DateRangePresetId,
  today: string,
  custom?: DateRange,
): DateRange {
  switch (preset) {
    case 'last-30':
      return { start: addDays(today, -29), end: today };
    case 'last-90':
      return { start: addDays(today, -89), end: today };
    case 'last-180':
      return { start: addDays(today, -179), end: today };
    case 'last-365':
      return { start: addDays(today, -364), end: today };
    case 'current-year':
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case 'custom': {
      if (!custom || !isValidDayKey(custom.start) || !isValidDayKey(custom.end)) {
        return { start: addDays(today, -364), end: today };
      }
      // Clamped here as well as at the input, because a custom range can also
      // arrive from localStorage, which the user can edit by hand.
      return clampDateRange(custom, today);
    }
    default:
      return { start: addDays(today, -364), end: today };
  }
}

/**
 * Constrains a user-supplied range to something the calendar can actually draw.
 *
 * A date input accepts any well-formed year, so `1000-01-01` or `9999-12-31`
 * are both reachable by typing. Rendering those means hundreds of thousands of
 * day cells and an equally absurd API window, so the range is bounded on three
 * axes: no later than today, no earlier than {@link MIN_SUPPORTED_DAY}, and no
 * longer than {@link MAX_CUSTOM_RANGE_DAYS}.
 *
 * Over-long ranges keep their end date and move the start forward, because the
 * recent end is the part the user is usually looking at.
 */
export function clampDateRange(
  range: DateRange,
  today: string,
  options: { readonly minDay?: string; readonly maxDays?: number } = {},
): DateRange {
  const minDay = options.minDay ?? MIN_SUPPORTED_DAY;
  const maxDays = Math.max(1, options.maxDays ?? MAX_CUSTOM_RANGE_DAYS);
  const ordered = normalizeRange(range);

  let end = ordered.end > today ? today : ordered.end;
  if (end < minDay) {
    end = minDay;
  }

  let start = ordered.start < minDay ? minDay : ordered.start;
  if (start > end) {
    start = end;
  }
  if (diffInDays(start, end) + 1 > maxDays) {
    start = addDays(end, -(maxDays - 1));
  }

  return { start, end };
}

/** True when clamping would change the range, i.e. the input was out of bounds. */
export function isRangeClamped(range: DateRange, today: string): boolean {
  const clamped = clampDateRange(range, today);
  const ordered = normalizeRange(range);
  return clamped.start !== ordered.start || clamped.end !== ordered.end;
}

/** Smallest range that contains both inputs. */
export function unionRange(a: DateRange, b: DateRange): DateRange {
  return {
    start: a.start <= b.start ? a.start : b.start,
    end: a.end >= b.end ? a.end : b.end,
  };
}

/** `true` when `inner` lies entirely inside `outer`. */
export function containsRange(outer: DateRange, inner: DateRange): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

/** "August 25, 2026" */
export function formatDayLong(key: string): string {
  const date = parseDayKey(key);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "Aug 25, 2026" */
export function formatDayMedium(key: string): string {
  const date = parseDayKey(key);
  return `${MONTH_SHORT_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "Tuesday, August 25, 2026" */
export function formatDayFull(key: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(key)]}, ${formatDayLong(key)}`;
}

export function monthShortName(monthIndex: number): string {
  return MONTH_SHORT_NAMES[monthIndex] ?? '';
}

export function weekdayShortName(weekdayIndex: number): string {
  return WEEKDAY_SHORT_NAMES[weekdayIndex] ?? '';
}

export function weekdayLongName(weekdayIndex: number): string {
  return WEEKDAY_NAMES[weekdayIndex] ?? '';
}

/**
 * Converts a day key to an ISO instant at the *start* of that local day, for
 * use as an Azure DevOps `fromDate` bound.
 */
export function startOfDayIso(key: string): string {
  return parseDayKey(key).toISOString();
}

/**
 * Converts a day key to an ISO instant at the last millisecond of that local
 * day, for use as an Azure DevOps `toDate` bound. Azure DevOps treats `toDate`
 * as inclusive, so this must stay inside the day rather than roll over.
 */
export function endOfDayIso(key: string): string {
  const nextMidnight = parseDayKey(addDays(key, 1)).getTime();
  return new Date(nextMidnight - 1).toISOString();
}

/** Today's local day key. Injectable clock keeps this testable. */
export function todayKey(now: Date = new Date()): string {
  return toDayKey(now);
}
