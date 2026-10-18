import { describe, expect, it } from 'vitest';

import {
  sortRepositorySummaries,
  summarizeRepositories,
} from '../src/services/repositoryStatsService.js';
import { makeEvent, makeRepository, timestampFor } from './helpers.js';

describe('summarizeRepositories', () => {
  it('returns nothing for no events', () => {
    expect(summarizeRepositories([])).toEqual([]);
  });

  it('rolls up commits, active days and last activity', () => {
    const summaries = summarizeRepositories([
      makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Alpha' }),
      makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Alpha' }),
      makeEvent('2026-08-12', {
        repositoryId: 'a',
        repositoryName: 'Alpha',
        timestamp: timestampFor('2026-08-12', 17),
      }),
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.count).toBe(3);
    expect(summaries[0]?.activeDays).toBe(2);
    expect(summaries[0]?.lastActivity).toBe(timestampFor('2026-08-12', 17));
  });

  it('separates repositories', () => {
    const summaries = summarizeRepositories([
      makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Alpha' }),
      makeEvent('2026-08-10', { repositoryId: 'b', repositoryName: 'Beta' }),
    ]);
    expect(summaries.map((summary) => summary.repositoryId).sort()).toEqual(['a', 'b']);
  });

  it('omits repositories that had no activity', () => {
    const summaries = summarizeRepositories(
      [makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Alpha' })],
      [makeRepository({ id: 'a', name: 'Alpha' }), makeRepository({ id: 'z', name: 'Zeta' })],
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.repositoryId).toBe('a');
  });

  it('prefers repository metadata over the name carried on the event', () => {
    const summaries = summarizeRepositories(
      [makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Stale Name' })],
      [
        makeRepository({
          id: 'a',
          name: 'Renamed',
          projectName: 'Fabrikam',
          webUrl: 'https://dev.azure.com/x/y/_git/Renamed',
        }),
      ],
    );
    expect(summaries[0]?.repositoryName).toBe('Renamed');
    expect(summaries[0]?.projectName).toBe('Fabrikam');
    expect(summaries[0]?.webUrl).toBe('https://dev.azure.com/x/y/_git/Renamed');
  });

  it('falls back to event metadata when the repository is unknown', () => {
    const summaries = summarizeRepositories(
      [makeEvent('2026-08-10', { repositoryId: 'ghost', repositoryName: 'Ghost Repo' })],
      [],
    );
    expect(summaries[0]?.repositoryName).toBe('Ghost Repo');
    expect(summaries[0]?.webUrl).toBe('');
  });

  it('counts a day once even with many commits on it', () => {
    const events = Array.from({ length: 12 }, () =>
      makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Alpha' }),
    );
    const summaries = summarizeRepositories(events);
    expect(summaries[0]?.count).toBe(12);
    expect(summaries[0]?.activeDays).toBe(1);
  });
});

describe('sortRepositorySummaries', () => {
  const summaries = summarizeRepositories([
    makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Alpha' }),
    makeEvent('2026-08-11', { repositoryId: 'a', repositoryName: 'Alpha' }),
    makeEvent('2026-08-12', {
      repositoryId: 'b',
      repositoryName: 'beta',
      timestamp: timestampFor('2026-08-12', 20),
    }),
    makeEvent('2026-08-01', { repositoryId: 'c', repositoryName: 'Gamma' }),
    makeEvent('2026-08-02', { repositoryId: 'c', repositoryName: 'Gamma' }),
    makeEvent('2026-08-03', { repositoryId: 'c', repositoryName: 'Gamma' }),
  ]);

  it('sorts by commit count descending', () => {
    const sorted = sortRepositorySummaries(summaries, { column: 'count', direction: 'desc' });
    expect(sorted.map((summary) => summary.repositoryName)).toEqual(['Gamma', 'Alpha', 'beta']);
  });

  it('sorts by commit count ascending', () => {
    const sorted = sortRepositorySummaries(summaries, { column: 'count', direction: 'asc' });
    expect(sorted.map((summary) => summary.repositoryName)).toEqual(['beta', 'Alpha', 'Gamma']);
  });

  it('sorts by name case-insensitively', () => {
    const sorted = sortRepositorySummaries(summaries, { column: 'name', direction: 'asc' });
    expect(sorted.map((summary) => summary.repositoryName)).toEqual(['Alpha', 'beta', 'Gamma']);
  });

  it('sorts by active days', () => {
    const sorted = sortRepositorySummaries(summaries, { column: 'activeDays', direction: 'desc' });
    expect(sorted[0]?.repositoryName).toBe('Gamma');
  });

  it('sorts by last commit, newest first', () => {
    const sorted = sortRepositorySummaries(summaries, {
      column: 'lastActivity',
      direction: 'desc',
    });
    expect(sorted[0]?.repositoryName).toBe('beta');
  });

  it('does not mutate the input', () => {
    const original = [...summaries];
    sortRepositorySummaries(summaries, { column: 'name', direction: 'desc' });
    expect(summaries).toEqual(original);
  });

  it('breaks ties by name ascending', () => {
    const tied = summarizeRepositories([
      makeEvent('2026-08-10', { repositoryId: 'z', repositoryName: 'Zeta' }),
      makeEvent('2026-08-10', { repositoryId: 'a', repositoryName: 'Aardvark' }),
    ]);
    const sorted = sortRepositorySummaries(tied, { column: 'count', direction: 'desc' });
    expect(sorted.map((summary) => summary.repositoryName)).toEqual(['Aardvark', 'Zeta']);
  });
});
