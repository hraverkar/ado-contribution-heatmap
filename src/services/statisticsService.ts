/**
 * Headline statistics derived from an aggregated contribution map.
 *
 * Every figure is computed strictly within the selected date range, so changing
 * the range or the repository filter recalculates from cached data without any
 * further network traffic.
 */

import type { ContributionMap, ContributionStatistics } from '../models/contribution.js';
import type { DateRange } from '../models/dateRange.js';
import { addDays, diffInDays, enumerateDays } from '../util/dates.js';

export interface StatisticsOptions {
  /**
   * The viewer's current local day. When the range ends today, a streak that
   * ran through yesterday is still counted as current — not having committed
   * yet today should not read as a broken streak.
   */
  readonly today?: string;
}

/**
 * Longest run of consecutive active days anywhere inside `range`.
 *
 * Runs are bounded by the range: activity outside it never extends a streak.
 */
export function computeLongestStreak(map: ContributionMap, range: DateRange): number {
  const span = diffInDays(range.start, range.end);
  if (span < 0) {
    return 0;
  }
  let longest = 0;
  let current = 0;
  let cursor = range.start;
  for (let index = 0; index <= span; index += 1) {
    const day = map.get(cursor);
    if (day && day.count > 0) {
      current += 1;
      if (current > longest) {
        longest = current;
      }
    } else {
      current = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return longest;
}

/**
 * Run of consecutive active days ending at the end of `range`.
 *
 * When the range ends on `today` and today has no activity yet, the streak is
 * measured back from yesterday instead of reporting zero.
 */
export function computeCurrentStreak(
  map: ContributionMap,
  range: DateRange,
  today?: string,
): number {
  if (diffInDays(range.start, range.end) < 0) {
    return 0;
  }

  let cursor = range.end;
  const endsToday = today !== undefined && today === range.end;
  const endDay = map.get(cursor);
  if (!endDay || endDay.count === 0) {
    if (!endsToday) {
      return 0;
    }
    cursor = addDays(cursor, -1);
    if (cursor < range.start) {
      return 0;
    }
  }

  let streak = 0;
  while (cursor >= range.start) {
    const day = map.get(cursor);
    if (!day || day.count === 0) {
      break;
    }
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Computes every summary figure shown above the calendar. */
export function computeStatistics(
  map: ContributionMap,
  range: DateRange,
  options: StatisticsOptions = {},
): ContributionStatistics {
  let total = 0;
  let activeDays = 0;
  let busiestDay: { date: string; count: number } | null = null;
  const repositories = new Set<string>();

  for (const date of enumerateDays(range)) {
    const day = map.get(date);
    if (!day || day.count === 0) {
      continue;
    }
    total += day.count;
    activeDays += 1;
    for (const event of day.events) {
      repositories.add(event.repositoryId);
    }
    if (!busiestDay || day.count > busiestDay.count) {
      busiestDay = { date, count: day.count };
    }
  }

  return {
    total,
    activeDays,
    currentStreak: computeCurrentStreak(map, range, options.today),
    longestStreak: computeLongestStreak(map, range),
    averagePerActiveDay: activeDays === 0 ? 0 : total / activeDays,
    repositoriesWithActivity: repositories.size,
    busiestDay,
  };
}
