import type { CommitRecord } from './commit.js';

/**
 * Activity types the calendar can display.
 *
 * Version 1 only produces `commit` events. The aggregation, statistics and
 * rendering layers are all keyed by {@link ContributionType}, so adding pull
 * requests, reviews or work items later means adding a producer in `src/api`
 * and a label here — the heatmap itself does not change.
 */
export type ContributionType = 'commit';

export const CONTRIBUTION_TYPES: readonly ContributionType[] = ['commit'];

/**
 * A single dated activity. `source` carries the type-specific payload so new
 * contribution types can add their own fields without widening this interface.
 */
export interface ContributionEvent {
  readonly type: ContributionType;
  readonly id: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly projectId: string;
  readonly projectName: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  readonly timestamp: number;
  readonly title: string;
  readonly actorName: string;
  readonly actorEmail: string;
  readonly url: string;
  readonly source: CommitRecord;
}

/** All activity that happened on one calendar day. */
export interface DayContribution {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  /** Total events across all types. */
  readonly count: number;
  /** Number of distinct repositories touched that day. */
  readonly repositories: number;
  /** Event counts broken down by contribution type. */
  readonly countsByType: Readonly<Record<ContributionType, number>>;
  /** Events, ordered oldest first. */
  readonly events: readonly ContributionEvent[];
}

/** Sparse map of `YYYY-MM-DD` to that day's activity. Days with no activity are absent. */
export type ContributionMap = ReadonlyMap<string, DayContribution>;

/** Per-repository rollup shown in the breakdown table. */
export interface RepositorySummary {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly projectName: string;
  readonly count: number;
  readonly activeDays: number;
  /** Epoch milliseconds of the most recent event, or `null` when there is none. */
  readonly lastActivity: number | null;
  readonly webUrl: string;
}

/** Headline numbers rendered above the calendar. */
export interface ContributionStatistics {
  readonly total: number;
  readonly activeDays: number;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly averagePerActiveDay: number;
  readonly repositoriesWithActivity: number;
  readonly busiestDay: { readonly date: string; readonly count: number } | null;
}
