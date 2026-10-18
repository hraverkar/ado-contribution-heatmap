import { describe, expect, it, vi } from 'vitest';

import { MemoryCache } from '../src/services/cacheService.js';
import { mapWithConcurrency } from '../src/services/concurrency.js';
import { ContributionService, scanCacheKey, scopeKey } from '../src/services/contributionService.js';
import type { HttpClient } from '../src/api/httpClient.js';
import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/services/preferencesService.js';
import { buildIdentitySet } from '../src/util/identityMatch.js';
import { testUser } from './helpers.js';

describe('MemoryCache', () => {
  it('stores and reads back a value', () => {
    const cache = new MemoryCache<number>();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
  });

  it('returns undefined for a missing key', () => {
    expect(new MemoryCache<number>().get('missing')).toBeUndefined();
  });

  it('expires entries after the TTL', () => {
    let now = 1000;
    const cache = new MemoryCache<number>({ ttlMs: 100, now: () => now });
    cache.set('a', 1);
    now = 1099;
    expect(cache.get('a')).toBe(1);
    now = 1100;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('supports explicit deletion and clearing', () => {
    const cache = new MemoryCache<number>();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      async (item) => item * 2,
      { limit: 2 },
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, index) => index),
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return null;
      },
      { limit: 3 },
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], async () => 1, { limit: 4 })).toEqual([]);
  });

  it('normalises a nonsensical limit', async () => {
    expect(await mapWithConcurrency([1, 2], async (item) => item, { limit: 0 })).toEqual([1, 2]);
  });

  it('reports progress once per completed item', async () => {
    const onProgress = vi.fn();
    await mapWithConcurrency([1, 2, 3], async (item) => item, { limit: 2, onProgress });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.at(-1)?.[0]).toBe(3);
    expect(onProgress.mock.calls.at(-1)?.[1]).toBe(3);
  });

  it('stops scheduling once the signal aborts', async () => {
    const controller = new AbortController();
    const worker = vi.fn().mockImplementation(async (item: number) => {
      if (item === 1) {
        controller.abort();
      }
      return item;
    });
    await mapWithConcurrency([0, 1, 2, 3, 4, 5], worker, {
      limit: 1,
      signal: controller.signal,
    });
    expect(worker.mock.calls.length).toBeLessThan(6);
  });
});

describe('normalizePreferences', () => {
  it('returns defaults for junk input', () => {
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences('nope')).toEqual(DEFAULT_PREFERENCES);
    expect(normalizePreferences(42)).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid values', () => {
    const preferences = normalizePreferences({
      scope: 'organization',
      presetId: 'last-90',
      weekStartsOn: 1,
      usePatterns: true,
      matchEmailLocalPart: true,
      deepScan: true,
      customAliases: ['a@b.com'],
      sort: { column: 'name', direction: 'asc' },
    });
    expect(preferences.scope).toBe('organization');
    expect(preferences.presetId).toBe('last-90');
    expect(preferences.weekStartsOn).toBe(1);
    expect(preferences.usePatterns).toBe(true);
    expect(preferences.sort).toEqual({ column: 'name', direction: 'asc' });
  });

  it('rejects an unknown preset and sort column', () => {
    const preferences = normalizePreferences({
      presetId: 'last-9999',
      sort: { column: 'evil', direction: 'sideways' },
    });
    expect(preferences.presetId).toBe(DEFAULT_PREFERENCES.presetId);
    expect(preferences.sort.column).toBe(DEFAULT_PREFERENCES.sort.column);
    expect(preferences.sort.direction).toBe('desc');
  });

  it('discards an invalid custom range', () => {
    expect(
      normalizePreferences({ customRange: { start: '2026-02-30', end: '2026-03-01' } }).customRange,
    ).toBeNull();
    expect(normalizePreferences({ customRange: 'nope' }).customRange).toBeNull();
  });

  it('keeps a valid custom range', () => {
    expect(
      normalizePreferences({ customRange: { start: '2026-01-01', end: '2026-02-01' } }).customRange,
    ).toEqual({ start: '2026-01-01', end: '2026-02-01' });
  });

  it('cleans and caps custom aliases', () => {
    const preferences = normalizePreferences({
      customAliases: [' a@b.com ', '', 42, ...Array.from({ length: 20 }, (_, i) => `x${i}@y.com`)],
    });
    expect(preferences.customAliases).toHaveLength(10);
    expect(preferences.customAliases[0]).toBe('a@b.com');
  });

  it('coerces a non-array alias field to an empty list', () => {
    expect(normalizePreferences({ customAliases: 'a@b.com' }).customAliases).toEqual([]);
  });
});

describe('scan cache keys', () => {
  const identity = buildIdentitySet(testUser);

  it('separates project scope from organization scope', () => {
    expect(scopeKey({ kind: 'project', projectId: 'p1', projectName: 'X' })).toBe('project:p1');
    expect(scopeKey({ kind: 'organization' })).toBe('organization');
  });

  it('is stable regardless of alias ordering', () => {
    const a = buildIdentitySet(testUser, { customAliases: ['x@y.com', 'z@y.com'] });
    const b = buildIdentitySet(testUser, { customAliases: ['z@y.com', 'x@y.com'] });
    const base = { scope: { kind: 'organization' } as const, range: { start: '2026-01-01', end: '2026-01-31' } };
    expect(scanCacheKey({ ...base, identity: a })).toBe(scanCacheKey({ ...base, identity: b }));
  });

  it('does not vary with the date range, which is handled by containment', () => {
    const scope = { kind: 'organization' } as const;
    expect(scanCacheKey({ scope, identity, range: { start: '2026-01-01', end: '2026-01-31' } })).toBe(
      scanCacheKey({ scope, identity, range: { start: '2020-01-01', end: '2026-12-31' } }),
    );
  });

  it('partitions on scan mode and on looser matching', () => {
    const scope = { kind: 'organization' } as const;
    const range = { start: '2026-01-01', end: '2026-01-31' };
    const loose = buildIdentitySet(testUser, { matchEmailLocalPart: true });

    expect(scanCacheKey({ scope, identity, range, deepScan: true })).not.toBe(
      scanCacheKey({ scope, identity, range, deepScan: false }),
    );
    expect(scanCacheKey({ scope, identity: loose, range })).not.toBe(
      scanCacheKey({ scope, identity, range }),
    );
  });

  it('partitions cache entries by all selected contributor identities', () => {
    const scope = { kind: 'organization' } as const;
    const range = { start: '2026-01-01', end: '2026-01-31' };
    const grace = buildIdentitySet({
      ...testUser,
      id: 'grace-id',
      uniqueName: 'grace@example.com',
      displayName: 'Grace Hopper',
    });
    expect(scanCacheKey({ scope, identity, additionalIdentities: [grace], range })).not.toBe(
      scanCacheKey({ scope, identity, range }),
    );
  });
});

describe('ContributionService', () => {
  const identity = buildIdentitySet({ ...testUser, displayName: '' });
  const scope = { kind: 'organization' } as const;

  /** Counts requests so cache behaviour can be asserted directly. */
  function countingClient(): HttpClient & { requests: string[] } {
    const requests: string[] = [];
    return {
      requests,
      async getJson<T>(path: string): Promise<T | null> {
        requests.push(path);
        if (path.endsWith('_apis/git/repositories')) {
          return {
            count: 1,
            value: [
              {
                id: 'repo-1',
                name: 'Repo One',
                project: { id: 'p1', name: 'Contoso' },
                defaultBranch: 'refs/heads/main',
                size: 100,
                webUrl: 'https://dev.azure.com/c/p/_git/RepoOne',
              },
            ],
          } as T;
        }
        return {
          count: 1,
          value: [
            {
              commitId: 'sha-1',
              author: { name: 'Ada', email: 'ada@example.com', date: '2026-06-15T09:00:00Z' },
              comment: 'Work',
              remoteUrl: 'https://dev.azure.com/c/p/_git/RepoOne/commit/sha-1',
            },
          ],
        } as T;
      },
    };
  }

  it('fetches repositories and commits on a cold scan', async () => {
    const client = countingClient();
    const service = new ContributionService(client);
    const result = await service.scan({
      scope,
      identity,
      range: { start: '2026-01-01', end: '2026-12-31' },
    });

    expect(result.repositories).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.servedFromCache).toBe(false);
    expect(result.failures).toEqual([]);
  });

  it('serves a narrower range from cache without new requests', async () => {
    const client = countingClient();
    const service = new ContributionService(client);

    await service.scan({ scope, identity, range: { start: '2026-01-01', end: '2026-12-31' } });
    const requestsAfterFirst = client.requests.length;

    const second = await service.scan({
      scope,
      identity,
      range: { start: '2026-06-01', end: '2026-06-30' },
    });

    expect(second.servedFromCache).toBe(true);
    expect(client.requests).toHaveLength(requestsAfterFirst);
  });

  it('refetches when the range widens beyond what was read', async () => {
    const client = countingClient();
    const service = new ContributionService(client);

    await service.scan({ scope, identity, range: { start: '2026-06-01', end: '2026-06-30' } });
    const requestsAfterFirst = client.requests.length;

    const second = await service.scan({
      scope,
      identity,
      range: { start: '2026-01-01', end: '2026-12-31' },
    });

    expect(second.servedFromCache).toBe(false);
    expect(client.requests.length).toBeGreaterThan(requestsAfterFirst);
    // The cache now covers the union of both windows.
    expect(second.fetchedRange).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('refetches on an explicit refresh', async () => {
    const client = countingClient();
    const service = new ContributionService(client);
    const range = { start: '2026-01-01', end: '2026-12-31' };

    await service.scan({ scope, identity, range });
    const requestsAfterFirst = client.requests.length;

    const second = await service.scan({ scope, identity, range, forceRefresh: true });
    expect(second.servedFromCache).toBe(false);
    expect(client.requests.length).toBeGreaterThan(requestsAfterFirst);
  });

  it('reports progress through the repository and commit phases', async () => {
    const phases: string[] = [];
    const service = new ContributionService(countingClient());
    await service.scan({
      scope,
      identity,
      range: { start: '2026-01-01', end: '2026-12-31' },
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(phases).toContain('repositories');
    expect(phases).toContain('commits');
    expect(phases.at(-1)).toBe('complete');
  });

  it('keeps going when one repository fails', async () => {
    const client: HttpClient = {
      async getJson<T>(path: string): Promise<T | null> {
        if (path.endsWith('_apis/git/repositories')) {
          return {
            count: 2,
            value: [
              { id: 'good', name: 'Good', project: { id: 'p', name: 'P' }, defaultBranch: 'refs/heads/main', size: 10 },
              { id: 'bad', name: 'Bad', project: { id: 'p', name: 'P' }, defaultBranch: 'refs/heads/main', size: 10 },
            ],
          } as T;
        }
        if (path.includes('/bad/')) {
          throw new Error('nope');
        }
        return { count: 0, value: [] } as T;
      },
    };

    const result = await new ContributionService(client).scan({
      scope,
      identity,
      range: { start: '2026-01-01', end: '2026-12-31' },
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.repositoryName).toBe('Bad');
    expect(result.repositories).toHaveLength(2);
  });

  it('drops every cache on clearCache', async () => {
    const client = countingClient();
    const service = new ContributionService(client);
    const range = { start: '2026-01-01', end: '2026-12-31' };

    await service.scan({ scope, identity, range });
    const requestsAfterFirst = client.requests.length;
    service.clearCache();
    await service.scan({ scope, identity, range });

    expect(client.requests.length).toBeGreaterThan(requestsAfterFirst);
  });
});
