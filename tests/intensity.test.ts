import { describe, expect, it } from 'vitest';

import {
  computeIntensityThresholds,
  describeLevels,
  levelFor,
  quantile,
} from '../src/heatmap/intensity.js';

describe('quantile', () => {
  it('handles empty and single-element inputs', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([7], 0.5)).toBe(7);
  });

  it('interpolates linearly', () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
  });

  it('clamps out-of-bounds fractions', () => {
    expect(quantile([1, 2, 3], -1)).toBe(1);
    expect(quantile([1, 2, 3], 5)).toBe(3);
  });
});

describe('computeIntensityThresholds', () => {
  it('falls back to 1..4 with no activity', () => {
    expect(computeIntensityThresholds([])).toEqual([1, 2, 3, 4]);
    expect(computeIntensityThresholds([0, 0, 0])).toEqual([1, 2, 3, 4]);
  });

  it('always starts level 1 at a single contribution', () => {
    expect(computeIntensityThresholds([5, 9, 20])[0]).toBe(1);
    expect(computeIntensityThresholds([1])[0]).toBe(1);
  });

  it('produces strictly increasing thresholds', () => {
    for (const counts of [[1], [1, 1, 1], [2, 2, 2], [1, 2, 3, 4, 5], [3, 3, 3, 40]]) {
      const thresholds = computeIntensityThresholds(counts);
      for (let index = 1; index < thresholds.length; index += 1) {
        expect(thresholds[index]).toBeGreaterThan(thresholds[index - 1] as number);
      }
    }
  });

  it('ignores zero and negative counts', () => {
    expect(computeIntensityThresholds([0, -3, 10, 20, 30])).toEqual(
      computeIntensityThresholds([10, 20, 30]),
    );
  });

  it('scales with a heavier distribution', () => {
    const light = computeIntensityThresholds([1, 1, 2, 2, 3]);
    const heavy = computeIntensityThresholds([10, 20, 30, 40, 50]);
    expect(heavy[3]).toBeGreaterThan(light[3] as number);
  });

  it('is not dragged upward by a single outlier', () => {
    const steady = computeIntensityThresholds([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    const withOutlier = computeIntensityThresholds([2, 2, 2, 2, 2, 2, 2, 2, 2, 400]);
    expect(withOutlier).toEqual(steady);
  });

  it('honours a custom level count', () => {
    expect(computeIntensityThresholds([1, 5, 10], 2)).toHaveLength(2);
    expect(computeIntensityThresholds([], 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('levelFor', () => {
  const thresholds = [1, 6, 11, 15];

  it('maps zero and negatives to level 0', () => {
    expect(levelFor(0, thresholds)).toBe(0);
    expect(levelFor(-4, thresholds)).toBe(0);
    expect(levelFor(Number.NaN, thresholds)).toBe(0);
  });

  it('maps counts into the right band', () => {
    expect(levelFor(1, thresholds)).toBe(1);
    expect(levelFor(5, thresholds)).toBe(1);
    expect(levelFor(6, thresholds)).toBe(2);
    expect(levelFor(10, thresholds)).toBe(2);
    expect(levelFor(11, thresholds)).toBe(3);
    expect(levelFor(14, thresholds)).toBe(3);
    expect(levelFor(15, thresholds)).toBe(4);
    expect(levelFor(9999, thresholds)).toBe(4);
  });

  it('never renders a positive count as empty', () => {
    expect(levelFor(1, [5, 10, 20, 40])).toBe(1);
  });
});

describe('describeLevels', () => {
  it('labels each band with its count range', () => {
    expect(describeLevels([1, 6, 11, 15])).toEqual(['0', '1–5', '6–10', '11–14', '15+']);
  });

  it('collapses single-count bands to one number', () => {
    expect(describeLevels([1, 2, 3, 4])).toEqual(['0', '1', '2', '3', '4+']);
  });

  it('always describes the zero band first', () => {
    expect(describeLevels([1, 2, 3, 4])[0]).toBe('0');
  });
});
