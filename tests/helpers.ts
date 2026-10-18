/** Test factories. Kept minimal so each test states only what it cares about. */

import type { CommitRecord } from '../src/models/commit.js';
import type { ContributionEvent, ContributionMap } from '../src/models/contribution.js';
import type { Repository } from '../src/models/repository.js';
import type { CurrentUser } from '../src/models/user.js';
import { aggregateContributions, commitToEvent } from '../src/services/aggregationService.js';

let sequence = 0;

/** Local-midnight epoch millis for a day key, optionally offset by hours. */
export function timestampFor(date: string, hours = 12): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, hours).getTime();
}

export function makeRepository(overrides: Partial<Repository> = {}): Repository {
  sequence += 1;
  return {
    id: `repo-${sequence}`,
    name: `Repo ${sequence}`,
    projectId: 'project-1',
    projectName: 'Contoso',
    webUrl: `https://dev.azure.com/contoso/Contoso/_git/Repo${sequence}`,
    isDisabled: false,
    defaultBranch: 'refs/heads/main',
    size: 1024,
    ...overrides,
  };
}

export function makeCommit(
  date: string,
  overrides: Partial<CommitRecord> = {},
): CommitRecord {
  sequence += 1;
  const timestamp = overrides.timestamp ?? timestampFor(date);
  return {
    id: `commit-${sequence}`,
    repositoryId: 'repo-1',
    repositoryName: 'Repo 1',
    projectId: 'project-1',
    projectName: 'Contoso',
    authorName: 'Ada Lovelace',
    authorEmail: 'ada@example.com',
    date,
    timestamp,
    message: `Commit on ${date}`,
    url: 'https://dev.azure.com/contoso/Contoso/_git/Repo1/commit/abc',
    ...overrides,
  };
}

export function makeEvent(
  date: string,
  overrides: Partial<CommitRecord> = {},
): ContributionEvent {
  return commitToEvent(makeCommit(date, overrides));
}

/** Builds a contribution map from `{ 'YYYY-MM-DD': count }`. */
export function mapFromCounts(counts: Record<string, number>): ContributionMap {
  const events: ContributionEvent[] = [];
  for (const [date, count] of Object.entries(counts)) {
    for (let index = 0; index < count; index += 1) {
      events.push(makeEvent(date));
    }
  }
  return aggregateContributions(events);
}

export const testUser: CurrentUser = {
  id: '11111111-2222-3333-4444-555555555555',
  uniqueName: 'ada@example.com',
  displayName: 'Ada Lovelace',
  descriptor: 'aad.YWJj',
  imageUrl: '',
};
