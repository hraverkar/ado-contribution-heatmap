/**
 * Calendar geometry.
 *
 * Produces the week-by-weekday grid the renderer draws. This module is pure:
 * given a range and a contribution map it returns positions, counts and levels,
 * with no DOM involvement, which is what makes the layout unit-testable.
 *
 * The grid always begins on the first day of the week containing `range.start`
 * and ends on the last day of the week containing `range.end`, so every column
 * is a full seven-cell week and weekday rows line up. Cells outside the range
 * are emitted as placeholders rather than omitted, which keeps positioning
 * correct without special-casing the first and last columns.
 */

import type { ContributionMap } from '../models/contribution.js';
import type { DateRange } from '../models/dateRange.js';
import { addDays, diffInDays, endOfWeek, monthShortName, parseDayKey, startOfWeek } from '../util/dates.js';
import type { IntensityThresholds } from './intensity.js';
import { levelFor } from './intensity.js';

export interface CalendarCell {
  /** Day key, or `null` for a padding cell outside the requested range. */
  readonly date: string | null;
  /** 0 = Sunday … 6 = Saturday, relative to the configured week start. */
  readonly weekday: number;
  /** Column index within the grid. */
  readonly weekIndex: number;
  readonly count: number;
  readonly repositories: number;
  readonly level: number;
}

export interface CalendarWeek {
  readonly weekIndex: number;
  /** Always seven cells, ordered by weekday row. */
  readonly cells: readonly CalendarCell[];
}

export interface MonthLabel {
  /** Column the label sits above. */
  readonly weekIndex: number;
  readonly label: string;
}

export interface CalendarGrid {
  readonly weeks: readonly CalendarWeek[];
  readonly monthLabels: readonly MonthLabel[];
  /** Weekday row order, e.g. `[0,1,2,3,4,5,6]` for a Sunday-first calendar. */
  readonly weekdayOrder: readonly number[];
  readonly range: DateRange;
  readonly weekStartsOn: number;
  readonly totalWeeks: number;
  /** Number of in-range days represented, i.e. non-padding cells. */
  readonly dayCount: number;
}

export interface BuildCalendarOptions {
  /** 0 = Sunday (default), 1 = Monday. */
  readonly weekStartsOn?: number;
  readonly thresholds?: IntensityThresholds;
}

const PADDING_CELL_LEVEL = 0;

/** Builds the full calendar grid for a range. */
export function buildCalendar(
  range: DateRange,
  contributions: ContributionMap,
  options: BuildCalendarOptions = {},
): CalendarGrid {
  const weekStartsOn = normalizeWeekStart(options.weekStartsOn);
  const thresholds = options.thresholds ?? [1, 2, 3, 4];

  const span = diffInDays(range.start, range.end);
  if (span < 0) {
    return {
      weeks: [],
      monthLabels: [],
      weekdayOrder: weekdayOrderFor(weekStartsOn),
      range,
      weekStartsOn,
      totalWeeks: 0,
      dayCount: 0,
    };
  }

  const gridStart = startOfWeek(range.start, weekStartsOn);
  const gridEnd = endOfWeek(range.end, weekStartsOn);
  const totalWeeks = Math.floor(diffInDays(gridStart, gridEnd) / 7) + 1;

  const weeks: CalendarWeek[] = [];
  let dayCount = 0;
  let cursor = gridStart;

  for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex += 1) {
    const cells: CalendarCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const inRange = cursor >= range.start && cursor <= range.end;
      if (inRange) {
        const day = contributions.get(cursor);
        const count = day?.count ?? 0;
        cells.push({
          date: cursor,
          weekday: row,
          weekIndex,
          count,
          repositories: day?.repositories ?? 0,
          level: levelFor(count, thresholds),
        });
        dayCount += 1;
      } else {
        cells.push({
          date: null,
          weekday: row,
          weekIndex,
          count: 0,
          repositories: 0,
          level: PADDING_CELL_LEVEL,
        });
      }
      cursor = addDays(cursor, 1);
    }
    weeks.push({ weekIndex, cells });
  }

  return {
    weeks,
    monthLabels: buildMonthLabels(weeks),
    weekdayOrder: weekdayOrderFor(weekStartsOn),
    range,
    weekStartsOn,
    totalWeeks,
    dayCount,
  };
}

/**
 * One label per month, positioned above the first column that contains a day of
 * that month. A label is dropped when its column is the very last one, where
 * there is not enough width to read it.
 */
export function buildMonthLabels(weeks: readonly CalendarWeek[]): MonthLabel[] {
  const labels: MonthLabel[] = [];
  let previousMonth = -1;
  let previousYear = -1;

  for (const week of weeks) {
    const firstRealCell = week.cells.find((cell) => cell.date !== null);
    if (!firstRealCell || firstRealCell.date === null) {
      continue;
    }
    const date = parseDayKey(firstRealCell.date);
    const month = date.getMonth();
    const year = date.getFullYear();
    if (month !== previousMonth || year !== previousYear) {
      labels.push({ weekIndex: week.weekIndex, label: monthShortName(month) });
      previousMonth = month;
      previousYear = year;
    }
  }

  if (labels.length > 1 && weeks.length > 1) {
    const last = labels[labels.length - 1] as MonthLabel;
    if (last.weekIndex === weeks.length - 1) {
      labels.pop();
    }
  }

  return labels;
}

/** Weekday row order for a given week start. */
export function weekdayOrderFor(weekStartsOn: number): number[] {
  const start = normalizeWeekStart(weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => (start + index) % 7);
}

function normalizeWeekStart(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return ((Math.trunc(value) % 7) + 7) % 7;
}

/** Flattens a grid to its in-range cells, oldest first. */
export function calendarDays(grid: CalendarGrid): CalendarCell[] {
  const cells: CalendarCell[] = [];
  for (const week of grid.weeks) {
    for (const cell of week.cells) {
      if (cell.date !== null) {
        cells.push(cell);
      }
    }
  }
  return cells.sort((a, b) => ((a.date as string) < (b.date as string) ? -1 : 1));
}
