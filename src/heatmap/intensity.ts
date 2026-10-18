/**
 * Intensity scale for the calendar.
 *
 * Thresholds are derived from the user's own distribution rather than fixed
 * constants, so a calendar stays readable whether someone lands one commit a
 * week or forty a day. Two properties keep the scale from feeling arbitrary:
 *
 *  - Level 1 always means "at least one contribution", so any activity is
 *    visible.
 *  - Cut points are quantiles of the *active* days only, rounded and forced
 *    strictly increasing, so they move smoothly with the data instead of
 *    snapping around a single outlier.
 *
 * The numeric band for every level is shown in the legend, so intensity is
 * never communicated by colour alone.
 */

import { INTENSITY_LEVELS } from '../config/constants.js';

/** 0 means "no contributions"; 1…N are the shaded levels. */
export type IntensityLevel = number;

/**
 * Minimum count required to reach each level, ascending.
 * `thresholds[0]` is the minimum for level 1 and is always 1.
 */
export type IntensityThresholds = readonly number[];

/** Linear-interpolated quantile of an ascending numeric array. */
export function quantile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) {
    return 0;
  }
  if (sortedAscending.length === 1) {
    return sortedAscending[0] as number;
  }
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const position = clamped * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedAscending[lowerIndex] as number;
  const upper = sortedAscending[upperIndex] as number;
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
}

/**
 * Derives level thresholds from per-day counts.
 *
 * Zero and negative counts are ignored. With no activity at all the scale falls
 * back to `1, 2, 3, 4` so the legend still renders something sensible.
 */
export function computeIntensityThresholds(
  counts: Iterable<number>,
  levels: number = INTENSITY_LEVELS,
): number[] {
  const levelCount = Math.max(1, Math.trunc(levels));
  const active: number[] = [];
  for (const count of counts) {
    if (Number.isFinite(count) && count > 0) {
      active.push(count);
    }
  }

  if (active.length === 0) {
    return Array.from({ length: levelCount }, (_, index) => index + 1);
  }

  active.sort((a, b) => a - b);

  const thresholds: number[] = [1];
  for (let level = 1; level < levelCount; level += 1) {
    const value = quantile(active, level / levelCount);
    thresholds.push(Math.max(2, Math.round(value)));
  }

  // Strictly increasing, so no two levels can collapse onto the same count.
  for (let index = 1; index < thresholds.length; index += 1) {
    const previous = thresholds[index - 1] as number;
    const current = thresholds[index] as number;
    if (current <= previous) {
      thresholds[index] = previous + 1;
    }
  }

  return thresholds;
}

/** Maps a count to its intensity level using the supplied thresholds. */
export function levelFor(count: number, thresholds: IntensityThresholds): IntensityLevel {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  let level = 0;
  for (let index = 0; index < thresholds.length; index += 1) {
    if (count >= (thresholds[index] as number)) {
      level = index + 1;
    } else {
      break;
    }
  }
  // A positive count is always at least level 1, even if thresholds are odd.
  return Math.max(level, 1);
}

/**
 * Human-readable count band for each level, for the legend and screen readers.
 * Index 0 is the "no contributions" band.
 */
export function describeLevels(thresholds: IntensityThresholds): string[] {
  const labels = ['0'];
  for (let index = 0; index < thresholds.length; index += 1) {
    const lower = thresholds[index] as number;
    const next = thresholds[index + 1];
    if (next === undefined) {
      labels.push(`${lower}+`);
    } else if (next - 1 <= lower) {
      labels.push(`${lower}`);
    } else {
      labels.push(`${lower}–${next - 1}`);
    }
  }
  return labels;
}
