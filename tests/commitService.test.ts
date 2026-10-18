import { describe, expect, it, vi } from 'vitest';

import {
  buildCommitQuery,
  commitsPath,
  fetchRepositoryCommits,
  normalizeCommit,
  shortCommitId,
} from '../src/api/commitService.js';
import type { HttpClient } from '../src/api/httpClient.js';
import { COMMIT_PAGE_SIZE, MAX_COMMIT_PAGES } from '../src/config/constants.js';
import { buildIdentitySet } from '../src/util/identityMatch.js';
import { makeRepository, testUser } from './helpers.js';

const repository = makeRepository({
  id: 'repo-1',
  name: 'Repo One',
  projectId: 'project-1',
  projectName: 'Contoso',
  webUrl: 'https://dev.azure.com/contoso/Contoso/_git/RepoOne',
});

const identity = buildIdentitySet(testUser);

function rawCommit(overrides: Record<string, unknown> = {}) {
  return {
    commitId: 'aaaabbbbccccddddeeeeffff0000111122223333',
    author: { name: 'Ada Lovelace', email: 'ada@example.com', date: '2026-08-25T10:15:00Z' },
    committer: { name: 'Ada Lovelace', email: 'ada@example.com', date: '2026-08-25T10:15:00Z' },
    comment: 'Add analytical engine notes',
    remoteUrl: 'https://dev.azure.com/contoso/Contoso/_git/RepoOne/commit/aaaa',
    ...overrides,
  };
}

/** Serves pre-canned pages and records the queries it was asked for. */
function stubClient(pages: unknown[][]): HttpClient & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  let index = 0;
  return {
    calls,
    async getJson<T>(_path: string, options?: { query?: Record<string, unknown> }): Promise<T | null> {
      calls.push(options?.query ?? {});
      const page = pages[index] ?? [];
      index += 1;
      return { count: page.length, value: page } as T;
    },
  };
}

describe('commitsPath', () => {
  it('scopes the path to the repository’s project', () => {
    expect(commitsPath(repository)).toBe('project-1/_apis/git/repositories/repo-1/commits');
  });

  it('omits the project segment when it is unknown', () => {
    expect(commitsPath({ ...repository, projectId: '' })).toBe(
      '_apis/git/repositories/repo-1/commits',
    );
  });

  it('encodes ids that need it', () => {
    expect(commitsPath({ ...repository, id: 'a b/c' })).toContain('a%20b%2Fc');
  });
});

describe('buildCommitQuery', () => {
  const range = { start: '2026-08-01', end: '2026-08-31' };

  it('sends a bounded date window', () => {
    const query = buildCommitQuery(range, 'ada@example.com', 0);
    expect(query['searchCriteria.fromDate']).toBeDefined();
    expect(query['searchCriteria.toDate']).toBeDefined();
    expect(new Date(query['searchCriteria.fromDate'] as string).getTime()).toBeLessThan(
      new Date(query['searchCriteria.toDate'] as string).getTime(),
    );
  });

  it('passes the author alias through', () => {
    expect(buildCommitQuery(range, 'ada@example.com', 0)['searchCriteria.author']).toBe(
      'ada@example.com',
    );
  });

  it('omits the author for a deep scan', () => {
    expect(buildCommitQuery(range, undefined, 0)['searchCriteria.author']).toBeUndefined();
  });

  it('omits $skip on the first page and sets it afterwards', () => {
    expect(buildCommitQuery(range, undefined, 0)['searchCriteria.$skip']).toBeUndefined();
    expect(buildCommitQuery(range, undefined, 500)['searchCriteria.$skip']).toBe(500);
  });

  it('never asks for content-bearing extras', () => {
    const query = buildCommitQuery(range, undefined, 0);
    expect(query['searchCriteria.includeLinks']).toBe(false);
    expect(query['searchCriteria.includeWorkItems']).toBe(false);
    expect(query['searchCriteria.includePushData']).toBe(false);
    expect(query['searchCriteria.includeUserImageUrl']).toBe(false);
  });
});

describe('normalizeCommit', () => {
  it('maps a well-formed record', () => {
    const record = normalizeCommit(rawCommit(), repository);
    expect(record).not.toBeNull();
    expect(record?.id).toBe('aaaabbbbccccddddeeeeffff0000111122223333');
    expect(record?.repositoryName).toBe('Repo One');
    expect(record?.projectName).toBe('Contoso');
    expect(record?.authorEmail).toBe('ada@example.com');
    expect(record?.message).toBe('Add analytical engine notes');
    expect(record?.timestamp).toBe(Date.parse('2026-08-25T10:15:00Z'));
  });

  it('derives the day key in local time', () => {
    const timestamp = Date.parse('2026-08-25T10:15:00Z');
    const expected = new Date(timestamp);
    const record = normalizeCommit(rawCommit(), repository);
    expect(record?.date).toBe(
      `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`,
    );
  });

  it('keeps only the first line of the message', () => {
    const record = normalizeCommit(
      rawCommit({ comment: 'Subject line\n\nA longer body paragraph.' }),
      repository,
    );
    expect(record?.message).toBe('Subject line');
  });

  it('drops a record with no commit id', () => {
    expect(normalizeCommit(rawCommit({ commitId: undefined }), repository)).toBeNull();
    expect(normalizeCommit(rawCommit({ commitId: '' }), repository)).toBeNull();
    expect(normalizeCommit(null, repository)).toBeNull();
    expect(normalizeCommit(undefined, repository)).toBeNull();
  });

  it('drops a record with an unparseable date', () => {
    expect(normalizeCommit(rawCommit({ author: { date: 'not-a-date' } }), repository)).toBeNull();
    expect(normalizeCommit(rawCommit({ author: null, committer: null }), repository)).toBeNull();
  });

  it('tolerates a missing author email', () => {
    const record = normalizeCommit(
      rawCommit({ author: { name: 'Ada', date: '2026-08-25T10:15:00Z' } }),
      repository,
    );
    expect(record?.authorEmail).toBe('');
    expect(record?.authorName).toBe('Ada');
  });

  it('tolerates a missing message', () => {
    expect(normalizeCommit(rawCommit({ comment: undefined }), repository)?.message).toBe('');
  });

  it('falls back to the committer when the author is absent', () => {
    const record = normalizeCommit(
      rawCommit({
        author: null,
        committer: { name: 'Bot', email: 'bot@example.com', date: '2026-08-25T10:15:00Z' },
      }),
      repository,
    );
    expect(record?.authorName).toBe('Bot');
  });

  it('builds a commit URL when remoteUrl is missing', () => {
    const record = normalizeCommit(rawCommit({ remoteUrl: undefined }), repository);
    expect(record?.url).toBe(
      'https://dev.azure.com/contoso/Contoso/_git/RepoOne/commit/aaaabbbbccccddddeeeeffff0000111122223333',
    );
  });

  it('leaves the URL empty when nothing can build one', () => {
    const record = normalizeCommit(rawCommit({ remoteUrl: undefined }), {
      ...repository,
      webUrl: '',
    });
    expect(record?.url).toBe('');
  });

  it('carries missing repository metadata through as empty strings', () => {
    const record = normalizeCommit(rawCommit(), {
      ...repository,
      projectId: '',
      projectName: '',
    });
    expect(record?.projectName).toBe('');
  });
});

describe('shortCommitId', () => {
  it('truncates to eight characters', () => {
    expect(shortCommitId('aaaabbbbccccdddd')).toBe('aaaabbbb');
    expect(shortCommitId('abc')).toBe('abc');
  });
});

describe('fetchRepositoryCommits', () => {
  const range = { start: '2026-08-01', end: '2026-08-31' };

  it('returns matching commits', async () => {
    const client = stubClient([[rawCommit()]]);
    const result = await fetchRepositoryCommits(client, repository, { range, identity });
    expect(result.commits).toHaveLength(1);
    expect(result.error).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('issues one query per alias', async () => {
    const client = stubClient([[], []]);
    await fetchRepositoryCommits(client, repository, { range, identity });
    expect(client.calls).toHaveLength(identity.queryAliases.length);
    expect(client.calls.map((call) => call['searchCriteria.author'])).toEqual([
      ...identity.queryAliases,
    ]);
  });

  it('de-duplicates a commit returned by two alias queries', async () => {
    const client = stubClient([[rawCommit()], [rawCommit()]]);
    const result = await fetchRepositoryCommits(client, repository, { range, identity });
    expect(result.commits).toHaveLength(1);
  });

  it('discards commits authored by someone else', async () => {
    const client = stubClient([
      [rawCommit({ author: { name: 'Grace Hopper', email: 'grace@example.com', date: '2026-08-25T10:00:00Z' } })],
    ]);
    const result = await fetchRepositoryCommits(client, repository, { range, identity });
    expect(result.commits).toHaveLength(0);
  });

  it('follows pagination until a short page arrives', async () => {
    const fullPage = Array.from({ length: COMMIT_PAGE_SIZE }, (_, index) =>
      rawCommit({ commitId: `page1-${index}` }),
    );
    const shortPage = [rawCommit({ commitId: 'page2-0' })];
    const singleAlias = buildIdentitySet({ ...testUser, displayName: '' });

    const client = stubClient([fullPage, shortPage]);
    const result = await fetchRepositoryCommits(client, repository, {
      range,
      identity: singleAlias,
    });

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.['searchCriteria.$skip']).toBe(COMMIT_PAGE_SIZE);
    expect(result.commits).toHaveLength(COMMIT_PAGE_SIZE + 1);
    expect(result.truncated).toBe(false);
  });

  it('stops and reports truncation at the page ceiling', async () => {
    const singleAlias = buildIdentitySet({ ...testUser, displayName: '' });
    const pages = Array.from({ length: MAX_COMMIT_PAGES + 2 }, (_, page) =>
      Array.from({ length: COMMIT_PAGE_SIZE }, (_, index) =>
        rawCommit({ commitId: `p${page}-${index}` }),
      ),
    );

    const client = stubClient(pages);
    const result = await fetchRepositoryCommits(client, repository, {
      range,
      identity: singleAlias,
    });

    expect(client.calls).toHaveLength(MAX_COMMIT_PAGES);
    expect(result.truncated).toBe(true);
  });

  it('sends no author criterion in deep-scan mode', async () => {
    const client = stubClient([[rawCommit()]]);
    await fetchRepositoryCommits(client, repository, { range, identity, deepScan: true });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.['searchCriteria.author']).toBeUndefined();
  });

  it('still verifies identity locally during a deep scan', async () => {
    const client = stubClient([
      [
        rawCommit({ commitId: 'mine' }),
        rawCommit({
          commitId: 'theirs',
          author: { name: 'Grace Hopper', email: 'grace@example.com', date: '2026-08-25T10:00:00Z' },
        }),
      ],
    ]);
    const result = await fetchRepositoryCommits(client, repository, {
      range,
      identity,
      deepScan: true,
    });
    expect(result.commits.map((commit) => commit.id)).toEqual(['mine']);
  });

  it('returns nothing when there are no aliases to query', async () => {
    const client = stubClient([[rawCommit()]]);
    const anonymous = buildIdentitySet({ ...testUser, uniqueName: '', displayName: '' });
    const result = await fetchRepositoryCommits(client, repository, {
      range,
      identity: anonymous,
    });
    expect(client.calls).toHaveLength(0);
    expect(result.commits).toEqual([]);
  });

  it('captures a failure on the result instead of throwing', async () => {
    const failing: HttpClient = {
      getJson: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const result = await fetchRepositoryCommits(failing, repository, { range, identity });
    expect(result.error).not.toBeNull();
    expect(result.commits).toEqual([]);
  });

  it('treats a 404 (null response) as no commits', async () => {
    const missing: HttpClient = { async getJson() { return null; } };
    const result = await fetchRepositoryCommits(missing, repository, { range, identity });
    expect(result.commits).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('reports a malformed payload as an error', async () => {
    const malformed: HttpClient = {
      async getJson<T>(): Promise<T | null> {
        return { count: 1, value: 'not-an-array' } as T;
      },
    };
    const result = await fetchRepositoryCommits(malformed, repository, { range, identity });
    expect(result.error?.kind).toBe('malformed-response');
  });

  it('skips malformed records but keeps the good ones', async () => {
    const client = stubClient([
      [rawCommit({ commitId: 'good' }), { commitId: undefined }, { nonsense: true }],
    ]);
    const result = await fetchRepositoryCommits(client, repository, { range, identity });
    expect(result.commits.map((commit) => commit.id)).toEqual(['good']);
  });
});
