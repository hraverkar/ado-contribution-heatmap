import { describe, expect, it } from 'vitest';

import { buildCalendar, calendarDays, weekdayOrderFor } from '../src/heatmap/calendar.js';
import type { CalendarCell } from '../src/heatmap/calendar.js';
import { aggregateContributions } from '../src/services/aggregationService.js';
import { addDays, enumerateDays, weekdayOf } from '../src/util/dates.js';
import { mapFromCounts } from './helpers.js';

const empty = aggregateContributions([]);

describe('weekdayOrderFor', () => {
  it('orders rows from the configured week start', () => {
    expect(weekdayOrderFor(0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(weekdayOrderFor(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('normalises out-of-range and invalid week starts', () => {
    expect(weekdayOrderFor(7)).toEqual(weekdayOrderFor(0));
    expect(weekdayOrderFor(-1)).toEqual(weekdayOrderFor(6));
    expect(weekdayOrderFor(Number.NaN)).toEqual(weekdayOrderFor(0));
  });
});

describe('buildCalendar', () => {
  it('returns an empty grid for an inverted range', () => {
    const grid = buildCalendar({ start: '2026-08-27', end: '2026-08-25' }, empty);
    expect(grid.totalWeeks).toBe(0);
    expect(grid.weeks).toEqual([]);
    expect(grid.dayCount).toBe(0);
  });

  it('gives every week exactly seven cells', () => {
    const grid = buildCalendar({ start: '2026-01-01', end: '2026-12-31' }, empty);
    for (const week of grid.weeks) {
      expect(week.cells).toHaveLength(7);
    }
  });

  it('represents every day in the range exactly once', () => {
    const range = { start: '2025-08-26', end: '2026-08-25' };
    const grid = buildCalendar(range, empty);
    const dates = calendarDays(grid).map((cell) => cell.date);
    expect(dates).toEqual(enumerateDays(range));
    expect(grid.dayCount).toBe(365);
  });

  it('places each day in the row matching its weekday', () => {
    const grid = buildCalendar({ start: '2026-08-01', end: '2026-09-30' }, empty);
    for (const week of grid.weeks) {
      week.cells.forEach((cell, row) => {
        if (cell.date !== null) {
          expect(weekdayOf(cell.date)).toBe(row);
          expect(cell.weekday).toBe(row);
        }
      });
    }
  });

  it('pads the leading and trailing partial weeks', () => {
    // 2026-08-25 is a Tuesday, so Sunday and Monday of week 0 are padding.
    const grid = buildCalendar({ start: '2026-08-25', end: '2026-08-29' }, empty);
    expect(grid.totalWeeks).toBe(1);
    const cells = grid.weeks[0]?.cells as readonly CalendarCell[];
    expect(cells[0]?.date).toBeNull();
    expect(cells[1]?.date).toBeNull();
    expect(cells[2]?.date).toBe('2026-08-25'); // Tuesday
    expect(cells[6]?.date).toBe('2026-08-29'); // Saturday, the last day in range
  });

  it('honours a Monday week start', () => {
    // With a Monday start, Monday 2026-08-24 is row 0.
    const grid = buildCalendar(
      { start: '2026-08-24', end: '2026-08-30' },
      empty,
      { weekStartsOn: 1 },
    );
    expect(grid.weekStartsOn).toBe(1);
    expect(grid.totalWeeks).toBe(1);
    expect(grid.weeks[0]?.cells[0]?.date).toBe('2026-08-24');
    expect(grid.weeks[0]?.cells[6]?.date).toBe('2026-08-30');
  });

  it('starts a Sunday-first grid on a Sunday even when the range starts midweek', () => {
    const grid = buildCalendar({ start: '2026-08-25', end: '2026-09-05' }, empty);
    const firstCellDate = grid.weeks[0]?.cells.find((cell) => cell.date !== null)?.date;
    expect(firstCellDate).toBe('2026-08-25');
    // The grid's own origin is the Sunday before.
    expect(grid.weeks[0]?.cells[0]?.date).toBeNull();
  });

  it('carries counts and repository totals onto the cells', () => {
    const contributions = mapFromCounts({ '2026-08-25': 7 });
    const grid = buildCalendar({ start: '2026-08-23', end: '2026-08-29' }, contributions, {
      thresholds: [1, 2, 3, 4],
    });
    const cell = calendarDays(grid).find((candidate) => candidate.date === '2026-08-25');
    expect(cell?.count).toBe(7);
    expect(cell?.repositories).toBe(1);
    expect(cell?.level).toBe(4);
  });

  it('gives days with no activity a zero count and level', () => {
    const grid = buildCalendar({ start: '2026-08-23', end: '2026-08-29' }, empty);
    for (const cell of calendarDays(grid)) {
      expect(cell.count).toBe(0);
      expect(cell.level).toBe(0);
    }
  });

  it('resizes with the range', () => {
    const short = buildCalendar({ start: addDays('2026-08-25', -29), end: '2026-08-25' }, empty);
    const long = buildCalendar({ start: addDays('2026-08-25', -364), end: '2026-08-25' }, empty);
    expect(short.dayCount).toBe(30);
    expect(long.dayCount).toBe(365);
    expect(long.totalWeeks).toBeGreaterThan(short.totalWeeks);
  });

  it('spans a leap day without shifting weekdays', () => {
    const range = { start: '2024-02-25', end: '2024-03-09' };
    const grid = buildCalendar(range, empty);
    const dates = calendarDays(grid).map((cell) => cell.date);
    expect(dates).toContain('2024-02-29');
    for (const week of grid.weeks) {
      week.cells.forEach((cell, row) => {
        if (cell.date !== null) {
          expect(weekdayOf(cell.date)).toBe(row);
        }
      });
    }
  });

  it('handles a single-day range', () => {
    const grid = buildCalendar({ start: '2026-08-25', end: '2026-08-25' }, empty);
    expect(grid.totalWeeks).toBe(1);
    expect(grid.dayCount).toBe(1);
    expect(calendarDays(grid)[0]?.date).toBe('2026-08-25');
  });
});

describe('month labels', () => {
  it('emits one label per month present in the range', () => {
    const grid = buildCalendar({ start: '2026-01-01', end: '2026-06-30' }, empty);
    const labels = grid.monthLabels.map((label) => label.label);
    expect(labels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
  });

  it('labels columns in ascending order', () => {
    const grid = buildCalendar({ start: '2025-08-26', end: '2026-08-25' }, empty);
    const indices = grid.monthLabels.map((label) => label.weekIndex);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it('re-labels a month that recurs in the next year', () => {
    const grid = buildCalendar({ start: '2025-08-26', end: '2026-08-25' }, empty);
    const augusts = grid.monthLabels.filter((label) => label.label === 'Aug');
    expect(augusts.length).toBeGreaterThanOrEqual(1);
  });

  it('drops a label that would sit on the final column', () => {
    const grid = buildCalendar({ start: '2026-01-01', end: '2026-06-30' }, empty);
    expect(grid.monthLabels.every((label) => label.weekIndex < grid.totalWeeks - 1)).toBe(true);
  });
});
