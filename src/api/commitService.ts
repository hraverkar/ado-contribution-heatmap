/**
 * Commit retrieval.
 *
 * Only commit *metadata* is requested. Change lists, file contents, diffs, work
 * item links and push details are all explicitly excluded from the query, so
 * source code never crosses the API boundary.
 *
 * Two-layer filtering keeps this both cheap and correct:
 *
 *  1. Azure DevOps narrows server-side using `searchCriteria.author` plus a
 *     `fromDate`/`toDate` window, once per alias. Only the current user's
 *     commits are transferred, instead of a repository's whole history.
 *  2. Every returned record is re-verified locally against the full identity
 *     set before it is counted, so an unexpectedly loose server-side match can
 *     never attribute another person's work to the viewer.
 *
 * A deep scan (no `author` criterion) is available for the rare case where none
 * of the aliases match; it costs far more requests and is opt-in.
 */

import { API_VERSION, COMMIT_PAGE_SIZE, MAX_COMMIT_PAGES } from '../config/constants.js';
import type { CommitRecord } from '../models/commit.js';
import type { DateRange } from '../models/dateRange.js';
import { AppError } from '../models/errors.js';
import type { Repository } from '../models/repository.js';
import type { IdentitySet } from '../models/user.js';
import { dayKeyFromTimestamp, endOfDayIso, startOfDayIso } from '../util/dates.js';
import { matchesIdentity } from '../util/identityMatch.js';
import type { HttpClient } from './httpClient.js';

interface RawCommitAuthor {
  name?: unknown;
  email?: unknown;
  date?: unknown;
}

interface RawCommit {
  commitId?: unknown;
  author?: RawCommitAuthor | null;
  committer?: RawCommitAuthor | null;
  comment?: unknown;
  commentTruncated?: unknown;
  remoteUrl?: unknown;
  url?: unknown;
}

interface CommitListResponse {
  count?: unknown;
  value?: unknown;
}

export interface FetchCommitsOptions {
  readonly range: DateRange;
  readonly identity: IdentitySet;
  /** When true, no `author` criterion is sent and matching happens locally. */
  readonly deepScan?: boolean;
  readonly signal?: AbortSignal;
}

export interface RepositoryCommitResult {
  readonly repository: Repository;
  readonly commits: readonly CommitRecord[];
  /** True when the page ceiling was reached and some history was not read. */
  readonly truncated: boolean;
  /** Set when this repository could not be read; the scan continues regardless. */
  readonly error: AppError | null;
}

/**
 * Fetches the current user's commits from one repository.
 *
 * Failures are captured on the result rather than thrown: one inaccessible
 * repository should degrade a single row of the breakdown, not the whole page.
 */
export async function fetchRepositoryCommits(
  http: HttpClient,
  repository: Repository,
  options: FetchCommitsOptions,
): Promise<RepositoryCommitResult> {
  const aliases = options.deepScan ? [undefined] : options.identity.queryAliases;

  if (aliases.length === 0) {
    return { repository, commits: [], truncated: false, error: null };
  }

  const byCommitId = new Map<string, CommitRecord>();
  let truncated = false;

  try {
    for (const alias of aliases) {
      const page = await fetchAllPages(http, repository, alias, options);
      truncated = truncated || page.truncated;
      for (const raw of page.commits) {
        const record = normalizeCommit(raw, repository);
        if (!record) {
          continue;
        }
        if (!matchesIdentity(options.identity, { name: record.authorName, email: record.authorEmail })) {
          continue;
        }
        // Overlapping alias queries return the same commit more than once.
        if (!byCommitId.has(record.id)) {
          byCommitId.set(record.id, record);
        }
      }
    }
  } catch (caught) {
    const error =
      caught instanceof AppError
        ? caught
        : new AppError({
            kind: 'unknown',
            message: `Could not read commits from ${repository.name}.`,
            cause: caught,
          });
    return { repository, commits: [...byCommitId.values()], truncated, error };
  }

  return { repository, commits: [...byCommitId.values()], truncated, error: null };
}

interface PagedCommits {
  readonly commits: readonly RawCommit[];
  readonly truncated: boolean;
}

async function fetchAllPages(
  http: HttpClient,
  repository: Repository,
  author: string | undefined,
  options: FetchCommitsOptions,
): Promise<PagedCommits> {
  const commits: RawCommit[] = [];
  let skip = 0;

  for (let page = 0; page < MAX_COMMIT_PAGES; page += 1) {
    const response = await http.getJson<CommitListResponse>(commitsPath(repository), {
      query: buildCommitQuery(options.range, author, skip),
      signal: options.signal,
      allowNotFound: true,
    });

    if (response === null) {
      // The repository disappeared or is not readable; treat as no commits.
      break;
    }
    if (!Array.isArray(response.value)) {
      throw new AppError({
        kind: 'malformed-response',
        message: `Azure DevOps returned unreadable commit data for ${repository.name}.`,
        detail: 'Try refreshing.',
      });
    }

    const batch = response.value as RawCommit[];
    commits.push(...batch);

    if (batch.length < COMMIT_PAGE_SIZE) {
      return { commits, truncated: false };
    }
    skip += COMMIT_PAGE_SIZE;
  }

  return { commits, truncated: true };
}

/** Project-scoped path; the project segment keeps the request unambiguous. */
export function commitsPath(repository: Repository): string {
  const project = repository.projectId ? `${encodeURIComponent(repository.projectId)}/` : '';
  return `${project}_apis/git/repositories/${encodeURIComponent(repository.id)}/commits`;
}

/**
 * Builds the commit query.
 *
 * The `include*` flags are pinned to `false` so Azure DevOps returns the
 * smallest possible record and never attaches change lists or work items.
 */
export function buildCommitQuery(
  range: DateRange,
  author: string | undefined,
  skip: number,
): Record<string, string | number | boolean | undefined> {
  return {
    'api-version': API_VERSION,
    'searchCriteria.fromDate': startOfDayIso(range.start),
    'searchCriteria.toDate': endOfDayIso(range.end),
    'searchCriteria.author': author,
    'searchCriteria.$top': COMMIT_PAGE_SIZE,
    'searchCriteria.$skip': skip > 0 ? skip : undefined,
    'searchCriteria.includeLinks': false,
    'searchCriteria.includeWorkItems': false,
    'searchCriteria.includePushData': false,
    'searchCriteria.includeUserImageUrl': false,
  };
}

/**
 * Converts one API record into a {@link CommitRecord}.
 *
 * Returns `null` when the record lacks a commit id or a parseable author date —
 * without those it cannot be placed on the calendar, and a malformed record is
 * safer dropped than guessed at.
 */
export function normalizeCommit(
  raw: RawCommit | null | undefined,
  repository: Repository,
): CommitRecord | null {
  if (!raw || typeof raw.commitId !== 'string' || raw.commitId.length === 0) {
    return null;
  }

  const author = raw.author ?? raw.committer ?? null;
  const timestamp = parseCommitDate(author?.date ?? (raw.committer?.date as unknown));
  if (timestamp === null) {
    return null;
  }

  return {
    id: raw.commitId,
    repositoryId: repository.id,
    repositoryName: repository.name,
    projectId: repository.projectId,
    projectName: repository.projectName,
    authorName: typeof author?.name === 'string' ? author.name : '',
    authorEmail: typeof author?.email === 'string' ? author.email : '',
    date: dayKeyFromTimestamp(timestamp),
    timestamp,
    message: firstLine(raw.comment),
    url: commitWebUrl(raw, repository),
  };
}

function parseCommitDate(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstLine(comment: unknown): string {
  if (typeof comment !== 'string') {
    return '';
  }
  const [line] = comment.split('\n');
  return (line ?? '').trim();
}

function commitWebUrl(raw: RawCommit, repository: Repository): string {
  if (typeof raw.remoteUrl === 'string' && raw.remoteUrl.startsWith('http')) {
    return raw.remoteUrl;
  }
  if (repository.webUrl && typeof raw.commitId === 'string') {
    return `${repository.webUrl}/commit/${raw.commitId}`;
  }
  return '';
}

/** Short display form of a commit SHA. */
export function shortCommitId(commitId: string): string {
  return commitId.slice(0, 8);
}
