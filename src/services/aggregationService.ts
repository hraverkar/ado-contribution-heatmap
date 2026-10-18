/**
 * Turns a flat list of activity into the per-day structure the calendar reads.
 *
 * Aggregation is deliberately generic over {@link ContributionType}: adding a
 * new activity source later means producing `ContributionEvent`s for it, and
 * nothing here or downstream changes.
 */

import type { CommitRecord } from '../models/commit.js';
import type {
  ContributionEvent,
  ContributionMap,
  ContributionType,
  DayContribution,
} from '../models/contribution.js';
import { CONTRIBUTION_TYPES } from '../models/contribution.js';
import type { DateRange } from '../models/dateRange.js';
import { isWithinRange } from '../util/dates.js';

/** Lifts a normalised commit into the generic contribution shape. */
export function commitToEvent(commit: CommitRecord): ContributionEvent {
  return {
    type: 'commit',
    id: commit.id,
    repositoryId: commit.repositoryId,
    repositoryName: commit.repositoryName,
    projectId: commit.projectId,
    projectName: commit.projectName,
    date: commit.date,
    timestamp: commit.timestamp,
    title: commit.message,
    actorName: commit.authorName,
    actorEmail: commit.authorEmail,
    url: commit.url,
    source: commit,
  };
}

/**
 * Identity of an event for de-duplication purposes.
 *
 * The same SHA legitimately exists in two repositories after a fork or a
 * cross-repo import, and both should count; the same SHA returned twice for one
 * repository (overlapping alias queries, paging overlap) should count once.
 */
export function eventKey(event: ContributionEvent): string {
  return `${event.type}:${event.repositoryId}:${event.id}`;
}

/** Removes duplicate records while preserving first-seen order. */
export function dedupeEvents(events: readonly ContributionEvent[]): ContributionEvent[] {
  const seen = new Set<string>();
  const result: ContributionEvent[] = [];
  for (const event of events) {
    const key = eventKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

/** Keeps only events whose local calendar day falls inside `range`. */
export function filterEventsByRange(
  events: readonly ContributionEvent[],
  range: DateRange,
): ContributionEvent[] {
  return events.filter((event) => isWithinRange(event.date, range));
}

/** Keeps only events from one repository. A `null` id means "all repositories". */
export function filterEventsByRepository(
  events: readonly ContributionEvent[],
  repositoryId: string | null,
): ContributionEvent[] {
  if (repositoryId === null) {
    return [...events];
  }
  return events.filter((event) => event.repositoryId === repositoryId);
}

function emptyCountsByType(): Record<ContributionType, number> {
  const counts = {} as Record<ContributionType, number>;
  for (const type of CONTRIBUTION_TYPES) {
    counts[type] = 0;
  }
  return counts;
}

/**
 * Buckets events by local calendar day.
 *
 * Input need not be sorted or de-duplicated; both are handled here. Days with
 * no activity are omitted from the map — the calendar renderer supplies the
 * zero-value for those.
 */
export function aggregateContributions(events: readonly ContributionEvent[]): ContributionMap {
  const unique = dedupeEvents(events);

  const buckets = new Map<
    string,
    {
      events: ContributionEvent[];
      repositories: Set<string>;
      countsByType: Record<ContributionType, number>;
    }
  >();

  for (const event of unique) {
    let bucket = buckets.get(event.date);
    if (!bucket) {
      bucket = { events: [], repositories: new Set(), countsByType: emptyCountsByType() };
      buckets.set(event.date, bucket);
    }
    bucket.events.push(event);
    bucket.repositories.add(event.repositoryId);
    bucket.countsByType[event.type] = (bucket.countsByType[event.type] ?? 0) + 1;
  }

  const result = new Map<string, DayContribution>();
  for (const [date, bucket] of buckets) {
    const sorted = [...bucket.events].sort(compareEvents);
    result.set(date, {
      date,
      count: sorted.length,
      repositories: bucket.repositories.size,
      countsByType: bucket.countsByType,
      events: sorted,
    });
  }
  return result;
}

/** Oldest first; ties broken by repository then id so ordering is stable. */
function compareEvents(a: ContributionEvent, b: ContributionEvent): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }
  if (a.repositoryName !== b.repositoryName) {
    return a.repositoryName < b.repositoryName ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Convenience accessor returning a zero-value day when nothing happened. */
export function dayAt(map: ContributionMap, date: string): DayContribution {
  return (
    map.get(date) ?? {
      date,
      count: 0,
      repositories: 0,
      countsByType: emptyCountsByType(),
      events: [],
    }
  );
}
