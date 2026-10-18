/**
 * Tests for the pure helpers inside the UI layer. Rendering itself needs a
 * browser and is exercised there; these cover the logic that decides *what*
 * gets rendered.
 */

import { describe, expect, it } from 'vitest';

import { cellMetrics, cellLabel, tooltipLines } from '../src/ui/heatmap.js';
import { formatDecimal, formatInteger, formatRelative, pluralize, truncate } from '../src/ui/format.js';
import { nextSort } from '../src/ui/repositoryTable.js';
import { parseAliases } from '../src/ui/settingsPanel.js';
import { progressMessage, troubleshootingFor } from '../src/ui/states.js';
import { parseColor, relativeLuminance, themeModeForBackground } from '../src/ui/theme.js';
import { repositoryOptions, ALL_REPOSITORIES_VALUE } from '../src/ui/toolbar.js';
import { makeRepository } from './helpers.js';

describe('cellMetrics', () => {
  it('enlarges cells for short ranges', () => {
    expect(cellMetrics(5).cell).toBeGreaterThan(cellMetrics(53).cell);
    expect(cellMetrics(14).cell).toBeGreaterThan(cellMetrics(53).cell);
  });

  it('is monotonically non-increasing as the range grows', () => {
    const sizes = [4, 8, 12, 16, 26, 30, 40, 53, 60].map((weeks) => cellMetrics(weeks).cell);
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]).toBeLessThanOrEqual(sizes[index - 1] as number);
    }
  });
});

describe('cellLabel', () => {
  const base = { weekday: 2, weekIndex: 0, level: 0, repositories: 0, count: 0 };

  it('is empty for a padding cell', () => {
    expect(cellLabel({ ...base, date: null })).toBe('');
  });

  it('states the date and that there were no commits', () => {
    expect(cellLabel({ ...base, date: '2026-08-25' })).toBe(
      'Tuesday, August 25, 2026: no commits',
    );
  });

  it('states counts, so intensity is never colour-only', () => {
    expect(cellLabel({ ...base, date: '2026-08-25', count: 7, repositories: 3 })).toBe(
      'Tuesday, August 25, 2026: 7 commits across 3 repositories',
    );
  });

  it('uses singular forms for a count of one', () => {
    expect(cellLabel({ ...base, date: '2026-08-25', count: 1, repositories: 1 })).toBe(
      'Tuesday, August 25, 2026: 1 commit across 1 repository',
    );
  });
});

describe('tooltipLines', () => {
  const base = { weekday: 2, weekIndex: 0, level: 0, repositories: 0, count: 0 };

  it('is empty for a padding cell', () => {
    expect(tooltipLines({ ...base, date: null })).toEqual([]);
  });

  it('shows the date and a no-commits line', () => {
    expect(tooltipLines({ ...base, date: '2026-08-25' })).toEqual([
      'Tuesday, August 25, 2026',
      'No commits',
    ]);
  });

  it('shows date, commit count and repository count', () => {
    expect(tooltipLines({ ...base, date: '2026-08-25', count: 7, repositories: 3 })).toEqual([
      'Tuesday, August 25, 2026',
      '7 commits',
      '3 repositories',
    ]);
  });
});

describe('formatting', () => {
  it('formats integers and decimals', () => {
    expect(formatInteger(1284)).toMatch(/1.284/);
    expect(formatInteger(Number.NaN)).toBe('0');
    expect(formatDecimal(7.32)).toMatch(/7.3/);
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe('0.0');
  });

  it('pluralises', () => {
    expect(pluralize(1, 'commit')).toBe('1 commit');
    expect(pluralize(2, 'commit')).toBe('2 commits');
    expect(pluralize(0, 'commit')).toBe('0 commits');
    expect(pluralize(1, 'repository', 'repositories')).toBe('1 repository');
    expect(pluralize(3, 'repository', 'repositories')).toBe('3 repositories');
  });

  it('describes relative times', () => {
    const now = Date.parse('2026-08-25T12:00:00Z');
    expect(formatRelative(now, now)).toBe('just now');
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(formatRelative(now - 1 * 3_600_000, now)).toBe('1 hour ago');
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe('2 days ago');
    expect(formatRelative(now - 1 * 86_400_000, now)).toBe('1 day ago');
  });

  it('truncates on a word boundary', () => {
    expect(truncate('short', 20)).toBe('short');
    expect(truncate('a very long commit message indeed', 20)).toMatch(/…$/);
    expect(truncate('a very long commit message indeed', 20).length).toBeLessThanOrEqual(20);
  });
});

describe('nextSort', () => {
  it('flips direction on the active column', () => {
    expect(nextSort({ column: 'count', direction: 'desc' }, 'count')).toEqual({
      column: 'count',
      direction: 'asc',
    });
    expect(nextSort({ column: 'count', direction: 'asc' }, 'count')).toEqual({
      column: 'count',
      direction: 'desc',
    });
  });

  it('uses a sensible initial direction for a new column', () => {
    expect(nextSort({ column: 'count', direction: 'desc' }, 'name')).toEqual({
      column: 'name',
      direction: 'asc',
    });
    expect(nextSort({ column: 'name', direction: 'asc' }, 'activeDays')).toEqual({
      column: 'activeDays',
      direction: 'desc',
    });
  });
});

describe('parseAliases', () => {
  it('splits on newlines and commas', () => {
    expect(parseAliases('a@x.com\nb@x.com, c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('trims and drops blanks', () => {
    expect(parseAliases('  a@x.com  \n\n   \n b@x.com ')).toEqual(['a@x.com', 'b@x.com']);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseAliases('A@X.com\na@x.com')).toEqual(['A@X.com']);
  });

  it('caps the list', () => {
    expect(parseAliases(Array.from({ length: 30 }, (_, i) => `a${i}@x.com`).join('\n'))).toHaveLength(
      10,
    );
  });

  it('returns nothing for empty input', () => {
    expect(parseAliases('')).toEqual([]);
    expect(parseAliases('   \n  ')).toEqual([]);
  });
});

describe('progressMessage', () => {
  it('falls back to a generic message', () => {
    expect(progressMessage(null)).toBe('Loading your contributions...');
  });

  it('describes repository discovery', () => {
    expect(progressMessage({ phase: 'repositories', completed: 0, total: 0 })).toBe(
      'Finding repositories...',
    );
    expect(progressMessage({ phase: 'repositories', completed: 24, total: 24 })).toMatch(
      /Found .*24 repositories/,
    );
  });

  it('counts repositories as they are scanned', () => {
    expect(progressMessage({ phase: 'commits', completed: 7, total: 24 })).toBe(
      'Scanning repositories 7 / 24...',
    );
  });
});

describe('troubleshootingFor', () => {
  it('gives specific guidance per error category', () => {
    expect(troubleshootingFor('permission')).toMatch(/Read access/i);
    expect(troubleshootingFor('rate-limited')).toMatch(/throttl/i);
    expect(troubleshootingFor('auth')).toMatch(/sign-in/i);
    expect(troubleshootingFor('no-project')).toMatch(/project/i);
  });

  it('never returns an empty string', () => {
    const kinds = [
      'auth',
      'permission',
      'not-found',
      'rate-limited',
      'network',
      'malformed-response',
      'no-project',
      'timeout',
      'unknown',
    ] as const;
    for (const kind of kinds) {
      expect(troubleshootingFor(kind).length).toBeGreaterThan(0);
    }
  });
});

describe('theme detection', () => {
  it('parses hex and rgb colours', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('#1f1f1f')).toEqual([31, 31, 31]);
    expect(parseColor('rgb(18, 20, 22)')).toEqual([18, 20, 22]);
    expect(parseColor('rgba(18, 20, 22, 0.5)')).toEqual([18, 20, 22]);
  });

  it('returns null for values it cannot read', () => {
    expect(parseColor('')).toBeNull();
    expect(parseColor('transparent')).toBeNull();
  });

  it('computes luminance at the extremes', () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 3);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 3);
  });

  it('classifies light and dark backgrounds', () => {
    expect(themeModeForBackground('#ffffff')).toBe('light');
    expect(themeModeForBackground('#f8f8f8')).toBe('light');
    expect(themeModeForBackground('#1f1f1f')).toBe('dark');
    expect(themeModeForBackground('rgb(29, 29, 29)')).toBe('dark');
  });

  it('defaults to light when the background is unreadable', () => {
    expect(themeModeForBackground('')).toBe('light');
  });
});

describe('repositoryOptions', () => {
  it('always offers an all-repositories option first', () => {
    const options = repositoryOptions([]);
    expect(options[0]?.value).toBe(ALL_REPOSITORIES_VALUE);
    expect(options[0]?.label).toBe('All repositories');
  });

  it('shows bare names within a single project', () => {
    const options = repositoryOptions([
      makeRepository({ id: 'a', name: 'Alpha', projectName: 'Contoso' }),
      makeRepository({ id: 'b', name: 'Beta', projectName: 'Contoso' }),
    ]);
    expect(options.map((option) => option.label)).toEqual(['All repositories', 'Alpha', 'Beta']);
  });

  it('qualifies names when several projects are in scope', () => {
    const options = repositoryOptions([
      makeRepository({ id: 'a', name: 'Alpha', projectName: 'Contoso' }),
      makeRepository({ id: 'b', name: 'Beta', projectName: 'Fabrikam' }),
    ]);
    expect(options.map((option) => option.label)).toEqual([
      'All repositories',
      'Contoso / Alpha',
      'Fabrikam / Beta',
    ]);
  });
});
