/**
 * Per-repository rollup backing the breakdown table.
 */

import type { ContributionEvent, RepositorySummary } from '../models/contribution.js';
import type { Repository } from '../models/repository.js';

export type RepositorySortColumn = 'name' | 'count' | 'activeDays' | 'lastActivity';
export type SortDirection = 'asc' | 'desc';

export interface RepositorySort {
  readonly column: RepositorySortColumn;
  readonly direction: SortDirection;
}

/**
 * Rolls events up per repository.
 *
 * Repositories with no events in the range are omitted, so the table lists
 * exactly what the user actually worked in. `repositories` is used only to
 * recover the web URL and project name for deep links.
 */
export function summarizeRepositories(
  events: readonly ContributionEvent[],
  repositories: readonly Repository[] = [],
): RepositorySummary[] {
  const byId = new Map<string, Repository>();
  for (const repository of repositories) {
    byId.set(repository.id, repository);
  }

  const accumulators = new Map<
    string,
    {
      repositoryName: string;
      projectName: string;
      count: number;
      days: Set<string>;
      lastActivity: number | null;
    }
  >();

  for (const event of events) {
    let accumulator = accumulators.get(event.repositoryId);
    if (!accumulator) {
      accumulator = {
        repositoryName: event.repositoryName,
        projectName: event.projectName,
        count: 0,
        days: new Set<string>(),
        lastActivity: null,
      };
      accumulators.set(event.repositoryId, accumulator);
    }
    accumulator.count += 1;
    accumulator.days.add(event.date);
    if (accumulator.lastActivity === null || event.timestamp > accumulator.lastActivity) {
      accumulator.lastActivity = event.timestamp;
    }
  }

  const summaries: RepositorySummary[] = [];
  for (const [repositoryId, accumulator] of accumulators) {
    const repository = byId.get(repositoryId);
    summaries.push({
      repositoryId,
      repositoryName: repository?.name ?? accumulator.repositoryName,
      projectName: repository?.projectName ?? accumulator.projectName,
      count: accumulator.count,
      activeDays: accumulator.days.size,
      lastActivity: accumulator.lastActivity,
      webUrl: repository?.webUrl ?? '',
    });
  }

  return summaries;
}

/** Returns a sorted copy. Ties always fall back to repository name, ascending. */
export function sortRepositorySummaries(
  summaries: readonly RepositorySummary[],
  sort: RepositorySort,
): RepositorySummary[] {
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...summaries].sort((a, b) => {
    const primary = compareByColumn(a, b, sort.column) * factor;
    if (primary !== 0) {
      return primary;
    }
    return a.repositoryName.localeCompare(b.repositoryName, undefined, { sensitivity: 'base' });
  });
}

function compareByColumn(
  a: RepositorySummary,
  b: RepositorySummary,
  column: RepositorySortColumn,
): number {
  switch (column) {
    case 'name':
      return a.repositoryName.localeCompare(b.repositoryName, undefined, { sensitivity: 'base' });
    case 'count':
      return a.count - b.count;
    case 'activeDays':
      return a.activeDays - b.activeDays;
    case 'lastActivity':
      // Repositories without activity sort as the oldest.
      return (a.lastActivity ?? -Infinity) - (b.lastActivity ?? -Infinity);
    default:
      return 0;
  }
}
