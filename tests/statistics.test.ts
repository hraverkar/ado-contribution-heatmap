import { describe, expect, it } from 'vitest';

import {
  computeCurrentStreak,
  computeLongestStreak,
  computeStatistics,
} from '../src/services/statisticsService.js';
import { aggregateContributions } from '../src/services/aggregationService.js';
import { makeEvent, mapFromCounts } from './helpers.js';

const empty = aggregateContributions([]);

describe('computeLongestStreak', () => {
  it('is zero with no activity', () => {
    expect(computeLongestStreak(empty, { start: '2026-08-01', end: '2026-08-31' })).toBe(0);
  });

  it('is one for a single active day', () => {
    const map = mapFromCounts({ '2026-08-10': 1 });
    expect(computeLongestStreak(map, { start: '2026-08-01', end: '2026-08-31' })).toBe(1);
  });

  it('counts consecutive days', () => {
    const map = mapFromCounts({
      '2026-08-10': 1,
      '2026-08-11': 2,
      '2026-08-12': 1,
    });
    expect(computeLongestStreak(map, { start: '2026-08-01', end: '2026-08-31' })).toBe(3);
  });

  it('picks the longest of several runs', () => {
    const map = mapFromCounts({
      '2026-08-02': 1,
      '2026-08-03': 1,
      '2026-08-10': 1,
      '2026-08-11': 1,
      '2026-08-12': 1,
      '2026-08-13': 1,
      '2026-08-20': 1,
    });
    expect(computeLongestStreak(map, { start: '2026-08-01', end: '2026-08-31' })).toBe(4);
  });

  it('does not bridge a gap', () => {
    const map = mapFromCounts({ '2026-08-10': 1, '2026-08-12': 1 });
    expect(computeLongestStreak(map, { start: '2026-08-01', end: '2026-08-31' })).toBe(1);
  });

  it('counts a streak that crosses a month and year boundary', () => {
    const map = mapFromCounts({
      '2025-12-30': 1,
      '2025-12-31': 1,
      '2026-01-01': 1,
      '2026-01-02': 1,
    });
    expect(computeLongestStreak(map, { start: '2025-12-01', end: '2026-01-31' })).toBe(4);
  });

  it('counts a streak across a leap day', () => {
    const map = mapFromCounts({
      '2024-02-28': 1,
      '2024-02-29': 1,
      '2024-03-01': 1,
    });
    expect(computeLongestStreak(map, { start: '2024-02-01', end: '2024-03-31' })).toBe(3);
  });

  it('is bounded by the range, ignoring activity outside it', () => {
    const map = mapFromCounts({
      '2026-07-30': 1,
      '2026-07-31': 1,
      '2026-08-01': 1,
      '2026-08-02': 1,
    });
    expect(computeLongestStreak(map, { start: '2026-08-01', end: '2026-08-31' })).toBe(2);
  });

  it('is zero for an inverted range', () => {
    const map = mapFromCounts({ '2026-08-10': 1 });
    expect(computeLongestStreak(map, { start: '2026-08-31', end: '2026-08-01' })).toBe(0);
  });
});

describe('computeCurrentStreak', () => {
  const range = { start: '2026-08-01', end: '2026-08-25' };

  it('is zero with no activity', () => {
    expect(computeCurrentStreak(empty, range, '2026-08-25')).toBe(0);
  });

  it('counts a run ending on the final day', () => {
    const map = mapFromCounts({
      '2026-08-23': 1,
      '2026-08-24': 1,
      '2026-08-25': 1,
    });
    expect(computeCurrentStreak(map, range, '2026-08-25')).toBe(3);
  });

  it('keeps the streak alive when today has no commits yet', () => {
    const map = mapFromCounts({ '2026-08-23': 1, '2026-08-24': 1 });
    expect(computeCurrentStreak(map, range, '2026-08-25')).toBe(2);
  });

  it('breaks when yesterday is also empty', () => {
    const map = mapFromCounts({ '2026-08-22': 1, '2026-08-23': 1 });
    expect(computeCurrentStreak(map, range, '2026-08-25')).toBe(0);
  });

  it('does not extend the grace day when the range ends in the past', () => {
    const map = mapFromCounts({ '2026-08-23': 1, '2026-08-24': 1 });
    expect(computeCurrentStreak(map, range, '2026-09-10')).toBe(0);
  });

  it('is bounded by the start of the range', () => {
    const map = mapFromCounts({
      '2026-07-30': 1,
      '2026-07-31': 1,
      '2026-08-01': 1,
    });
    expect(computeCurrentStreak(map, { start: '2026-08-01', end: '2026-08-01' }, '2026-08-01')).toBe(
      1,
    );
  });

  it('is zero for an inverted range', () => {
    expect(computeCurrentStreak(empty, { start: '2026-08-25', end: '2026-08-01' })).toBe(0);
  });
});

describe('computeStatistics', () => {
  const range = { start: '2026-08-01', end: '2026-08-31' };

  it('returns zeros for an empty map', () => {
    const stats = computeStatistics(empty, range, { today: '2026-08-31' });
    expect(stats).toEqual({
      total: 0,
      activeDays: 0,
      currentStreak: 0,
      longestStreak: 0,
      averagePerActiveDay: 0,
      repositoriesWithActivity: 0,
      busiestDay: null,
    });
  });

  it('handles exactly one commit', () => {
    const stats = computeStatistics(mapFromCounts({ '2026-08-10': 1 }), range);
    expect(stats.total).toBe(1);
    expect(stats.activeDays).toBe(1);
    expect(stats.averagePerActiveDay).toBe(1);
    expect(stats.busiestDay).toEqual({ date: '2026-08-10', count: 1 });
  });

  it('averages over active days only', () => {
    const stats = computeStatistics(
      mapFromCounts({ '2026-08-10': 3, '2026-08-11': 6 }),
      range,
    );
    expect(stats.total).toBe(9);
    expect(stats.activeDays).toBe(2);
    expect(stats.averagePerActiveDay).toBe(4.5);
  });

  it('counts distinct repositories across the range', () => {
    const map = aggregateContributions([
      makeEvent('2026-08-10', { repositoryId: 'a' }),
      makeEvent('2026-08-11', { repositoryId: 'a' }),
      makeEvent('2026-08-12', { repositoryId: 'b' }),
    ]);
    expect(computeStatistics(map, range).repositoriesWithActivity).toBe(2);
  });

  it('excludes activity outside the range from every figure', () => {
    const map = mapFromCounts({ '2026-07-15': 10, '2026-08-10': 2 });
    const stats = computeStatistics(map, range);
    expect(stats.total).toBe(2);
    expect(stats.activeDays).toBe(1);
    expect(stats.busiestDay).toEqual({ date: '2026-08-10', count: 2 });
  });

  it('identifies the busiest day and keeps the earliest on a tie', () => {
    const map = mapFromCounts({ '2026-08-10': 5, '2026-08-20': 5, '2026-08-15': 2 });
    expect(computeStatistics(map, range).busiestDay).toEqual({ date: '2026-08-10', count: 5 });
  });

  it('reports both streaks', () => {
    const map = mapFromCounts({
      '2026-08-01': 1,
      '2026-08-02': 1,
      '2026-08-03': 1,
      '2026-08-04': 1,
      '2026-08-30': 1,
      '2026-08-31': 1,
    });
    const stats = computeStatistics(map, range, { today: '2026-08-31' });
    expect(stats.longestStreak).toBe(4);
    expect(stats.currentStreak).toBe(2);
  });

  it('handles a full 365-day range', () => {
    const counts: Record<string, number> = {};
    for (let day = 1; day <= 28; day += 1) {
      counts[`2026-02-${String(day).padStart(2, '0')}`] = day;
    }
    const stats = computeStatistics(mapFromCounts(counts), {
      start: '2025-08-26',
      end: '2026-08-25',
    });
    expect(stats.activeDays).toBe(28);
    expect(stats.total).toBe((28 * 29) / 2);
    expect(stats.longestStreak).toBe(28);
  });
});
