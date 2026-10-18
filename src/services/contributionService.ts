/**
 * Orchestrates a contribution scan: discover repositories, fetch the current
 * user's commits from each, and hand back normalised events.
 *
 * Request volume is the thing this module exists to control:
 *
 *  - Repository lists and commit results are cached per scope for the session.
 *  - The cache records the *range* it covers, so narrowing the date filter
 *    (365 days down to 30) is answered from memory, and widening refetches only
 *    the union that is actually needed.
 *  - Repositories are scanned through a bounded worker pool rather than all at
 *    once, and each request retries with backoff on throttling.
 *  - Empty and disabled repositories are skipped before they cost a request.
 *
 * A repository that fails is reported on the result and the scan continues; one
 * inaccessible repository must not blank the page.
 */

import { REQUEST_CONCURRENCY } from '../config/constants.js';
import { fetchRepositoryCommits } from '../api/commitService.js';
import type { HttpClient } from '../api/httpClient.js';
import type { RepositoryScope } from '../api/repositoryService.js';
import { listRepositories, scannableRepositories } from '../api/repositoryService.js';
import type { ContributionEvent } from '../models/contribution.js';
import type { DateRange } from '../models/dateRange.js';
import type { AppError } from '../models/errors.js';
import { toAppError } from '../models/errors.js';
import type { Repository } from '../models/repository.js';
import type { IdentitySet } from '../models/user.js';
import { containsRange, unionRange } from '../util/dates.js';
import { commitToEvent } from './aggregationService.js';
import { MemoryCache } from './cacheService.js';
import { mapWithConcurrency } from './concurrency.js';

export type ScanPhase = 'repositories' | 'commits' | 'complete';

export interface ScanProgress {
  readonly phase: ScanPhase;
  readonly completed: number;
  readonly total: number;
  readonly repositoryName?: string;
}

export interface RepositoryFailure {
  readonly repositoryName: string;
  readonly error: AppError;
}

export interface ScanRequest {
  readonly scope: RepositoryScope;
  readonly range: DateRange;
  readonly identity: IdentitySet;
  readonly deepScan?: boolean;
  /** Ignores caches and re-reads everything. */
  readonly forceRefresh?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ScanProgress) => void;
}

export interface ScanResult {
  /** Every repository considered, whether or not it had activity. */
  readonly repositories: readonly Repository[];
  /** Events across the *fetched* range; callers filter to the visible range. */
  readonly events: readonly ContributionEvent[];
  readonly fetchedRange: DateRange;
  /** Repositories where the page ceiling stopped the scan short. */
  readonly truncatedRepositories: readonly string[];
  readonly failures: readonly RepositoryFailure[];
  /** True when the result came entirely from the session cache. */
  readonly servedFromCache: boolean;
}

interface CachedScan {
  readonly range: DateRange;
  readonly repositories: readonly Repository[];
  readonly events: readonly ContributionEvent[];
  readonly truncatedRepositories: readonly string[];
  readonly failures: readonly RepositoryFailure[];
}

export class ContributionService {
  private readonly repositoryCache = new MemoryCache<Repository[]>();
  private readonly scanCache = new MemoryCache<CachedScan>();

  constructor(private readonly http: HttpClient) {}

  /** Drops every cached repository list and commit result. */
  clearCache(): void {
    this.repositoryCache.clear();
    this.scanCache.clear();
  }

  async scan(request: ScanRequest): Promise<ScanResult> {
    const cacheKey = scanCacheKey(request);

    if (request.forceRefresh) {
      this.repositoryCache.delete(scopeKey(request.scope));
      this.scanCache.delete(cacheKey);
    }

    const cached = this.scanCache.get(cacheKey);
    if (cached && containsRange(cached.range, request.range)) {
      request.onProgress?.({ phase: 'complete', completed: 1, total: 1 });
      return {
        repositories: cached.repositories,
        events: cached.events,
        fetchedRange: cached.range,
        truncatedRepositories: cached.truncatedRepositories,
        failures: cached.failures,
        servedFromCache: true,
      };
    }

    // Widening the window refetches the union so the cache never claims to
    // cover days it has not actually read.
    const targetRange = cached ? unionRange(cached.range, request.range) : request.range;

    const repositories = await this.loadRepositories(request);
    const targets = scannableRepositories(repositories);

    request.onProgress?.({ phase: 'commits', completed: 0, total: targets.length });

    const results = await mapWithConcurrency(
      targets,
      async (repository) => {
        try {
          return await fetchRepositoryCommits(this.http, repository, {
            range: targetRange,
            identity: request.identity,
            deepScan: request.deepScan ?? false,
            signal: request.signal,
          });
        } catch (caught) {
          return {
            repository,
            commits: [],
            truncated: false,
            error: toAppError(caught, `Could not read commits from ${repository.name}.`),
          };
        }
      },
      {
        limit: REQUEST_CONCURRENCY,
        signal: request.signal,
        onProgress: (completed, total, repository) => {
          request.onProgress?.({
            phase: 'commits',
            completed,
            total,
            repositoryName: repository.name,
          });
        },
      },
    );

    const events: ContributionEvent[] = [];
    const truncatedRepositories: string[] = [];
    const failures: RepositoryFailure[] = [];

    for (const result of results) {
      if (!result) {
        continue;
      }
      for (const commit of result.commits) {
        events.push(commitToEvent(commit));
      }
      if (result.truncated) {
        truncatedRepositories.push(result.repository.name);
      }
      if (result.error) {
        failures.push({ repositoryName: result.repository.name, error: result.error });
      }
    }

    events.sort((a, b) => a.timestamp - b.timestamp);

    const scan: CachedScan = {
      range: targetRange,
      repositories,
      events,
      truncatedRepositories,
      failures,
    };
    this.scanCache.set(cacheKey, scan);

    request.onProgress?.({ phase: 'complete', completed: targets.length, total: targets.length });

    return {
      repositories,
      events,
      fetchedRange: targetRange,
      truncatedRepositories,
      failures,
      servedFromCache: false,
    };
  }

  private async loadRepositories(request: ScanRequest): Promise<Repository[]> {
    const key = scopeKey(request.scope);
    const cached = this.repositoryCache.get(key);
    if (cached) {
      request.onProgress?.({
        phase: 'repositories',
        completed: cached.length,
        total: cached.length,
      });
      return cached;
    }

    request.onProgress?.({ phase: 'repositories', completed: 0, total: 0 });
    const repositories = await listRepositories(this.http, request.scope, {
      signal: request.signal,
    });
    this.repositoryCache.set(key, repositories);
    request.onProgress?.({
      phase: 'repositories',
      completed: repositories.length,
      total: repositories.length,
    });
    return repositories;
  }
}

export function scopeKey(scope: RepositoryScope): string {
  return scope.kind === 'project' ? `project:${scope.projectId}` : 'organization';
}

/**
 * Cache identity. Aliases and scan mode change *which* commits come back, so
 * they must partition the cache; the date range must not, because range
 * containment is handled explicitly.
 */
export function scanCacheKey(request: ScanRequest): string {
  const aliases = [...request.identity.queryAliases].map((alias) => alias.toLowerCase()).sort();
  const localParts = request.identity.matchLocalParts.size > 0 ? 'local' : 'strict';
  const mode = request.deepScan ? 'deep' : 'filtered';
  return `${scopeKey(request.scope)}|${mode}|${localParts}|${aliases.join(' ')}`;
}
