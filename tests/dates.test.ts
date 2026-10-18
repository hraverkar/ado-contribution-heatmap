import { describe, expect, it } from 'vitest';

import { MAX_CUSTOM_RANGE_DAYS } from '../src/config/constants.js';
import {
  addDays,
  clampDateRange,
  containsRange,
  diffInDays,
  enumerateDays,
  endOfDayIso,
  endOfWeek,
  formatDayFull,
  formatDayLong,
  isRangeClamped,
  isValidDayKey,
  isWithinRange,
  normalizeRange,
  rangeLength,
  resolveDateRange,
  startOfDayIso,
  startOfWeek,
  toDayKey,
  todayKey,
  unionRange,
  weekdayOf,
} from '../src/util/dates.js';

describe('isValidDayKey', () => {
  it('accepts well-formed calendar days', () => {
    expect(isValidDayKey('2026-08-25')).toBe(true);
    expect(isValidDayKey('2024-02-29')).toBe(true); // leap year
  });

  it('rejects malformed or impossible days', () => {
    expect(isValidDayKey('2025-02-29')).toBe(false); // not a leap year
    expect(isValidDayKey('2026-13-01')).toBe(false);
    expect(isValidDayKey('2026-00-10')).toBe(false);
    expect(isValidDayKey('2026-04-31')).toBe(false);
    expect(isValidDayKey('26-08-25')).toBe(false);
    expect(isValidDayKey('')).toBe(false);
    expect(isValidDayKey(null)).toBe(false);
    expect(isValidDayKey(20260825)).toBe(false);
  });
});

describe('toDayKey', () => {
  it('formats using local calendar fields, zero-padded', () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('is the inverse of parsing for every day of a leap February', () => {
    for (let day = 1; day <= 29; day += 1) {
      const key = toDayKey(new Date(2024, 1, day));
      expect(key).toBe(`2024-02-${String(day).padStart(2, '0')}`);
    }
  });
});

describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-08-25', 1)).toBe('2026-08-26');
    expect(addDays('2026-08-25', -1)).toBe('2026-08-24');
    expect(addDays('2026-08-25', 0)).toBe('2026-08-25');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('crosses year boundaries', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap day transitions', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('spans a full leap year correctly', () => {
    expect(addDays('2024-01-01', 366)).toBe('2025-01-01');
    expect(addDays('2025-01-01', 365)).toBe('2026-01-01');
  });
});

describe('diffInDays', () => {
  it('counts whole days in both directions', () => {
    expect(diffInDays('2026-08-25', '2026-08-25')).toBe(0);
    expect(diffInDays('2026-08-25', '2026-08-26')).toBe(1);
    expect(diffInDays('2026-08-26', '2026-08-25')).toBe(-1);
  });

  it('counts across a leap year and a common year', () => {
    expect(diffInDays('2024-01-01', '2025-01-01')).toBe(366);
    expect(diffInDays('2025-01-01', '2026-01-01')).toBe(365);
  });

  it('agrees with addDays over a long span', () => {
    expect(diffInDays('2025-08-26', addDays('2025-08-26', 364))).toBe(364);
  });
});

describe('weekdayOf', () => {
  it('returns 0 for Sunday and 6 for Saturday', () => {
    // 2026-08-23 is a Sunday.
    expect(weekdayOf('2026-08-23')).toBe(0);
    expect(weekdayOf('2026-08-24')).toBe(1);
    expect(weekdayOf('2026-08-29')).toBe(6);
  });
});

describe('startOfWeek / endOfWeek', () => {
  it('anchors to Sunday by default', () => {
    expect(startOfWeek('2026-08-25')).toBe('2026-08-23');
    expect(endOfWeek('2026-08-25')).toBe('2026-08-29');
  });

  it('anchors to Monday when asked', () => {
    expect(startOfWeek('2026-08-25', 1)).toBe('2026-08-24');
    expect(endOfWeek('2026-08-25', 1)).toBe('2026-08-30');
  });

  it('is idempotent on a day that already starts the week', () => {
    expect(startOfWeek('2026-08-23', 0)).toBe('2026-08-23');
    expect(startOfWeek('2026-08-24', 1)).toBe('2026-08-24');
  });

  it('handles the Sunday/Monday boundary in both conventions', () => {
    // Sunday 2026-08-23 belongs to the *previous* Monday-start week.
    expect(startOfWeek('2026-08-23', 1)).toBe('2026-08-17');
    expect(startOfWeek('2026-08-23', 0)).toBe('2026-08-23');
  });
});

describe('enumerateDays', () => {
  it('is inclusive at both ends', () => {
    expect(enumerateDays({ start: '2026-08-25', end: '2026-08-27' })).toEqual([
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
    ]);
  });

  it('returns a single day for a degenerate range', () => {
    expect(enumerateDays({ start: '2026-08-25', end: '2026-08-25' })).toEqual(['2026-08-25']);
  });

  it('returns nothing for an inverted range', () => {
    expect(enumerateDays({ start: '2026-08-27', end: '2026-08-25' })).toEqual([]);
  });

  it('produces exactly 365 days for a 365-day range', () => {
    const range = { start: addDays('2026-08-25', -364), end: '2026-08-25' };
    expect(enumerateDays(range)).toHaveLength(365);
  });

  it('produces 366 days across a leap year', () => {
    expect(enumerateDays({ start: '2024-01-01', end: '2024-12-31' })).toHaveLength(366);
  });
});

describe('range helpers', () => {
  it('measures inclusive length', () => {
    expect(rangeLength({ start: '2026-08-25', end: '2026-08-25' })).toBe(1);
    expect(rangeLength({ start: '2026-08-25', end: '2026-08-27' })).toBe(3);
    expect(rangeLength({ start: '2026-08-27', end: '2026-08-25' })).toBe(0);
  });

  it('tests containment inclusively', () => {
    const range = { start: '2026-08-01', end: '2026-08-31' };
    expect(isWithinRange('2026-08-01', range)).toBe(true);
    expect(isWithinRange('2026-08-31', range)).toBe(true);
    expect(isWithinRange('2026-07-31', range)).toBe(false);
    expect(isWithinRange('2026-09-01', range)).toBe(false);
  });

  it('orders inverted ranges', () => {
    expect(normalizeRange({ start: '2026-08-27', end: '2026-08-25' })).toEqual({
      start: '2026-08-25',
      end: '2026-08-27',
    });
  });

  it('unions to the outermost bounds', () => {
    expect(
      unionRange({ start: '2026-03-01', end: '2026-06-30' }, { start: '2026-01-01', end: '2026-04-30' }),
    ).toEqual({ start: '2026-01-01', end: '2026-06-30' });
  });

  it('detects range containment', () => {
    const outer = { start: '2026-01-01', end: '2026-12-31' };
    expect(containsRange(outer, { start: '2026-06-01', end: '2026-06-30' })).toBe(true);
    expect(containsRange(outer, outer)).toBe(true);
    expect(containsRange(outer, { start: '2025-12-31', end: '2026-06-30' })).toBe(false);
  });
});

describe('resolveDateRange', () => {
  const today = '2026-08-25';

  it('makes last-N ranges inclusive of today', () => {
    expect(resolveDateRange('last-30', today)).toEqual({ start: '2026-07-27', end: today });
    expect(rangeLength(resolveDateRange('last-30', today))).toBe(30);
    expect(rangeLength(resolveDateRange('last-90', today))).toBe(90);
    expect(rangeLength(resolveDateRange('last-180', today))).toBe(180);
    expect(rangeLength(resolveDateRange('last-365', today))).toBe(365);
  });

  it('runs the current year from 1 January', () => {
    expect(resolveDateRange('current-year', today)).toEqual({
      start: '2026-01-01',
      end: today,
    });
  });

  it('uses a supplied custom range', () => {
    expect(
      resolveDateRange('custom', today, { start: '2026-01-05', end: '2026-02-05' }),
    ).toEqual({ start: '2026-01-05', end: '2026-02-05' });
  });

  it('orders an inverted custom range', () => {
    expect(
      resolveDateRange('custom', today, { start: '2026-02-05', end: '2026-01-05' }),
    ).toEqual({ start: '2026-01-05', end: '2026-02-05' });
  });

  it('falls back to 365 days when a custom range is missing or invalid', () => {
    expect(resolveDateRange('custom', today)).toEqual(resolveDateRange('last-365', today));
    expect(
      resolveDateRange('custom', today, { start: 'nonsense', end: '2026-01-05' }),
    ).toEqual(resolveDateRange('last-365', today));
  });

  it('spans a leap day when the range crosses one', () => {
    const range = resolveDateRange('last-365', '2024-03-01');
    expect(enumerateDays(range)).toContain('2024-02-29');
  });
});

describe('API date bounds', () => {
  it('starts at the first instant of the local day', () => {
    const iso = startOfDayIso('2026-08-25');
    expect(new Date(iso).getTime()).toBe(new Date(2026, 7, 25).getTime());
  });

  it('ends inside the same local day, not the next one', () => {
    const end = new Date(endOfDayIso('2026-08-25'));
    const nextMidnight = new Date(2026, 7, 26).getTime();
    expect(end.getTime()).toBe(nextMidnight - 1);
    expect(toDayKey(end)).toBe('2026-08-25');
  });
});

describe('formatting', () => {
  it('formats a long date', () => {
    expect(formatDayLong('2026-08-25')).toBe('August 25, 2026');
  });

  it('includes the weekday in the full format', () => {
    expect(formatDayFull('2026-08-25')).toBe('Tuesday, August 25, 2026');
  });
});

describe('todayKey', () => {
  it('uses the injected clock', () => {
    expect(todayKey(new Date(2026, 7, 25, 13, 30))).toBe('2026-08-25');
  });
});

describe('clampDateRange', () => {
  const today = '2026-08-26';

  it('leaves a sensible range untouched', () => {
    const range = { start: '2026-01-01', end: '2026-06-30' };
    expect(clampDateRange(range, today)).toEqual(range);
    expect(isRangeClamped(range, today)).toBe(false);
  });

  it('pulls a future end date back to today', () => {
    expect(clampDateRange({ start: '2026-01-01', end: '9999-12-31' }, today)).toEqual({
      start: '2026-01-01',
      end: today,
    });
  });

  it('raises an ancient start date to the supported floor', () => {
    const clamped = clampDateRange({ start: '1000-01-01', end: '2001-06-30' }, today);
    expect(clamped.start).toBe('2000-01-01');
    expect(clamped.end).toBe('2001-06-30');
  });

  it('caps an over-long range, keeping the end date', () => {
    const clamped = clampDateRange({ start: '2000-01-01', end: today }, today);
    expect(clamped.end).toBe(today);
    expect(rangeLength(clamped)).toBe(MAX_CUSTOM_RANGE_DAYS);
  });

  it('bounds the pathological inputs that used to hang the calendar', () => {
    for (const range of [
      { start: '1000-01-01', end: '2026-08-26' },
      { start: '2026-01-01', end: '9999-12-31' },
      { start: '1000-01-01', end: '9999-12-31' },
    ]) {
      const clamped = clampDateRange(range, today);
      expect(rangeLength(clamped)).toBeLessThanOrEqual(MAX_CUSTOM_RANGE_DAYS);
      expect(clamped.end <= today).toBe(true);
      expect(clamped.start >= '2000-01-01').toBe(true);
    }
  });

  it('orders an inverted range before clamping', () => {
    expect(clampDateRange({ start: '2026-06-30', end: '2026-01-01' }, today)).toEqual({
      start: '2026-01-01',
      end: '2026-06-30',
    });
  });

  it('collapses a range entirely below the floor onto the floor', () => {
    expect(clampDateRange({ start: '1990-01-01', end: '1995-01-01' }, today)).toEqual({
      start: '2000-01-01',
      end: '2000-01-01',
    });
  });

  it('reports whether an input needed adjusting', () => {
    expect(isRangeClamped({ start: '2026-01-01', end: '2026-06-30' }, today)).toBe(false);
    expect(isRangeClamped({ start: '1000-01-01', end: today }, today)).toBe(true);
    expect(isRangeClamped({ start: '2026-01-01', end: '2030-01-01' }, today)).toBe(true);
  });

  it('honours custom bounds', () => {
    const clamped = clampDateRange({ start: '2026-01-01', end: '2026-12-31' }, today, {
      minDay: '2026-03-01',
      maxDays: 10,
    });
    expect(clamped.end).toBe(today);
    expect(rangeLength(clamped)).toBe(10);
  });
});

describe('resolveDateRange with hostile custom input', () => {
  const today = '2026-08-26';

  it('never returns a range the calendar cannot draw', () => {
    for (const custom of [
      { start: '1000-01-01', end: '2026-08-26' },
      { start: '2026-01-01', end: '9999-12-31' },
      { start: '1000-01-01', end: '9999-12-31' },
    ]) {
      const resolved = resolveDateRange('custom', today, custom);
      expect(rangeLength(resolved)).toBeLessThanOrEqual(MAX_CUSTOM_RANGE_DAYS);
    }
  });

  it('still honours a legitimate custom range', () => {
    expect(resolveDateRange('custom', today, { start: '2026-01-05', end: '2026-02-05' })).toEqual({
      start: '2026-01-05',
      end: '2026-02-05',
    });
  });
});
