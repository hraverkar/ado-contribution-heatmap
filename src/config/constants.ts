/**
 * Central configuration. Nothing in this file is a secret; the extension holds
 * no credentials of any kind.
 */

/** Azure DevOps REST API version used for every request. */
export const API_VERSION = '7.1';

/** Resource area id of the Git REST APIs (GitRestClient.RESOURCE_AREA_ID). */
export const GIT_RESOURCE_AREA_ID = '4e080c62-fa21-4fbc-8fef-2a10a2b38049';

/** Contribution ids of the host services this extension consumes. */
export const SERVICE_IDS = {
  location: 'ms.vss-features.location-service',
  projectPage: 'ms.vss-tfs-web.tfs-page-data-service',
  hostNavigation: 'ms.vss-features.host-navigation-service',
} as const;

/** Maximum commits requested per page. Azure DevOps caps `$top` server-side. */
export const COMMIT_PAGE_SIZE = 500;

/**
 * Hard ceiling on pages fetched per repository/alias pair. Prevents a runaway
 * scan of a very large repository; the UI reports when this is hit.
 */
export const MAX_COMMIT_PAGES = 40;

/** Maximum number of Azure DevOps requests in flight at once. */
export const REQUEST_CONCURRENCY = 6;

/** Per-request timeout in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Retry policy for transient failures (429/5xx/network). */
export const RETRY = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
} as const;

/** Cache lifetime for a browser session, in milliseconds. */
export const CACHE_TTL_MS = 15 * 60 * 1000;

/** localStorage key holding user preferences (never credentials). */
export const PREFERENCES_STORAGE_KEY = 'adoContributionHeatmap.preferences.v1';

/**
 * Earliest day a custom range may start.
 *
 * Custom ranges come from a `<input type="date">`, which happily yields years
 * like 1000 or 9999. Without a floor those produce ranges of hundreds of
 * thousands of days, which is a hung tab rather than a slow one.
 */
export const MIN_SUPPORTED_DAY = '2000-01-01';

/** Longest custom range, in days. Five years is well past any useful calendar. */
export const MAX_CUSTOM_RANGE_DAYS = 1826;

/** Number of intensity levels above zero. */
export const INTENSITY_LEVELS = 4;
