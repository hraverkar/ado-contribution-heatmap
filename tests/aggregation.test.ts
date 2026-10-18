import { describe, expect, it } from 'vitest';

import {
  aggregateContributions,
  commitToEvent,
  dayAt,
  dedupeEvents,
  eventKey,
  filterEventsByRange,
  filterEventsByRepository,
} from '../src/services/aggregationService.js';
import { makeCommit, makeEvent, timestampFor } from './helpers.js';

describe('commitToEvent', () => {
  it('preserves the commit as the event source', () => {
    const commit = makeCommit('2026-08-25');
    const event = commitToEvent(commit);
    expect(event.type).toBe('commit');
    expect(event.id).toBe(commit.id);
    expect(event.date).toBe('2026-08-25');
    expect(event.title).toBe(commit.message);
    expect(event.source).toBe(commit);
  });
});

describe('dedupeEvents', () => {
  it('collapses the same commit returned twice for one repository', () => {
    const event = makeEvent('2026-08-25');
    expect(dedupeEvents([event, event, event])).toHaveLength(1);
  });

  it('keeps the same SHA when it appears in two repositories', () => {
    const first = makeEvent('2026-08-25', { id: 'shared-sha', repositoryId: 'repo-a' });
    const second = makeEvent('2026-08-25', { id: 'shared-sha', repositoryId: 'repo-b' });
    expect(dedupeEvents([first, second])).toHaveLength(2);
  });

  it('preserves first-seen order', () => {
    const a = makeEvent('2026-08-25', { id: 'a' });
    const b = makeEvent('2026-08-26', { id: 'b' });
    expect(dedupeEvents([a, b, a]).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('builds a key from type, repository and id', () => {
    const event = makeEvent('2026-08-25', { id: 'sha1', repositoryId: 'repo-x' });
    expect(eventKey(event)).toBe('commit:repo-x:sha1');
  });
});

describe('filterEventsByRange', () => {
  const events = [makeEvent('2026-07-31'), makeEvent('2026-08-01'), makeEvent('2026-08-31'), makeEvent('2026-09-01')];

  it('includes both boundary days', () => {
    const filtered = filterEventsByRange(events, { start: '2026-08-01', end: '2026-08-31' });
    expect(filtered.map((event) => event.date)).toEqual(['2026-08-01', '2026-08-31']);
  });

  it('returns nothing when the range excludes everything', () => {
    expect(filterEventsByRange(events, { start: '2027-01-01', end: '2027-01-31' })).toEqual([]);
  });
});

describe('filterEventsByRepository', () => {
  const events = [
    makeEvent('2026-08-25', { repositoryId: 'repo-a' }),
    makeEvent('2026-08-25', { repositoryId: 'repo-b' }),
  ];

  it('returns everything for a null id', () => {
    expect(filterEventsByRepository(events, null)).toHaveLength(2);
  });

  it('filters to one repository', () => {
    const filtered = filterEventsByRepository(events, 'repo-a');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.repositoryId).toBe('repo-a');
  });

  it('returns nothing for an unknown repository', () => {
    expect(filterEventsByRepository(events, 'repo-zzz')).toEqual([]);
  });
});

describe('aggregateContributions', () => {
  it('returns an empty map for no events', () => {
    expect(aggregateContributions([]).size).toBe(0);
  });

  it('buckets a single commit', () => {
    const map = aggregateContributions([makeEvent('2026-08-25')]);
    expect(map.size).toBe(1);
    const day = map.get('2026-08-25');
    expect(day?.count).toBe(1);
    expect(day?.repositories).toBe(1);
    expect(day?.countsByType.commit).toBe(1);
  });

  it('sums multiple commits on one day', () => {
    const map = aggregateContributions([
      makeEvent('2026-08-25'),
      makeEvent('2026-08-25'),
      makeEvent('2026-08-25'),
    ]);
    expect(map.get('2026-08-25')?.count).toBe(3);
  });

  it('counts distinct repositories per day', () => {
    const map = aggregateContributions([
      makeEvent('2026-08-25', { repositoryId: 'repo-a' }),
      makeEvent('2026-08-25', { repositoryId: 'repo-a' }),
      makeEvent('2026-08-25', { repositoryId: 'repo-b' }),
      makeEvent('2026-08-25', { repositoryId: 'repo-c' }),
    ]);
    const day = map.get('2026-08-25');
    expect(day?.count).toBe(4);
    expect(day?.repositories).toBe(3);
  });

  it('omits days with no activity', () => {
    const map = aggregateContributions([makeEvent('2026-08-25'), makeEvent('2026-08-27')]);
    expect([...map.keys()].sort()).toEqual(['2026-08-25', '2026-08-27']);
    expect(map.has('2026-08-26')).toBe(false);
  });

  it('de-duplicates before counting', () => {
    const event = makeEvent('2026-08-25');
    expect(aggregateContributions([event, event]).get('2026-08-25')?.count).toBe(1);
  });

  it('orders a day’s events oldest first', () => {
    const map = aggregateContributions([
      makeEvent('2026-08-25', { id: 'late', timestamp: timestampFor('2026-08-25', 18) }),
      makeEvent('2026-08-25', { id: 'early', timestamp: timestampFor('2026-08-25', 6) }),
    ]);
    expect(map.get('2026-08-25')?.events.map((event) => event.id)).toEqual(['early', 'late']);
  });

  it('breaks timestamp ties deterministically', () => {
    const timestamp = timestampFor('2026-08-25', 9);
    const forward = aggregateContributions([
      makeEvent('2026-08-25', { id: 'b', repositoryName: 'Beta', timestamp }),
      makeEvent('2026-08-25', { id: 'a', repositoryName: 'Alpha', timestamp }),
    ]);
    const reversed = aggregateContributions([
      makeEvent('2026-08-25', { id: 'a', repositoryName: 'Alpha', timestamp }),
      makeEvent('2026-08-25', { id: 'b', repositoryName: 'Beta', timestamp }),
    ]);
    expect(forward.get('2026-08-25')?.events.map((event) => event.id)).toEqual(
      reversed.get('2026-08-25')?.events.map((event) => event.id),
    );
  });

  it('handles commits either side of a year boundary', () => {
    const map = aggregateContributions([makeEvent('2025-12-31'), makeEvent('2026-01-01')]);
    expect(map.get('2025-12-31')?.count).toBe(1);
    expect(map.get('2026-01-01')?.count).toBe(1);
  });

  it('handles a leap day', () => {
    const map = aggregateContributions([makeEvent('2024-02-29'), makeEvent('2024-02-29')]);
    expect(map.get('2024-02-29')?.count).toBe(2);
  });
});

describe('dayAt', () => {
  it('returns the stored day when present', () => {
    const map = aggregateContributions([makeEvent('2026-08-25')]);
    expect(dayAt(map, '2026-08-25').count).toBe(1);
  });

  it('returns a zero-value day when absent', () => {
    const day = dayAt(aggregateContributions([]), '2026-08-25');
    expect(day).toEqual({
      date: '2026-08-25',
      count: 0,
      repositories: 0,
      countsByType: { commit: 0 },
      events: [],
    });
  });
});
