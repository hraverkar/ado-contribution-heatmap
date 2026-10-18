import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../src/api/httpClient.js';
import {
  listRepositories,
  normalizeRepository,
  scannableRepositories,
} from '../src/api/repositoryService.js';
import { makeRepository } from './helpers.js';

function stub(response: unknown): HttpClient & { paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    async getJson<T>(path: string): Promise<T | null> {
      paths.push(path);
      return response as T;
    },
  };
}

describe('normalizeRepository', () => {
  const raw = {
    id: 'repo-1',
    name: 'Repo One',
    webUrl: 'https://dev.azure.com/contoso/Contoso/_git/RepoOne',
    defaultBranch: 'refs/heads/main',
    isDisabled: false,
    size: 4096,
    project: { id: 'project-1', name: 'Contoso' },
  };

  it('maps a well-formed record', () => {
    expect(normalizeRepository(raw, null)).toEqual({
      id: 'repo-1',
      name: 'Repo One',
      projectId: 'project-1',
      projectName: 'Contoso',
      webUrl: 'https://dev.azure.com/contoso/Contoso/_git/RepoOne',
      isDisabled: false,
      defaultBranch: 'refs/heads/main',
      size: 4096,
    });
  });

  it('drops a record with no id', () => {
    expect(normalizeRepository({ ...raw, id: undefined }, null)).toBeNull();
    expect(normalizeRepository(null, null)).toBeNull();
    expect(normalizeRepository(undefined, null)).toBeNull();
  });

  it('falls back to the id when the name is missing', () => {
    expect(normalizeRepository({ ...raw, name: undefined }, null)?.name).toBe('repo-1');
  });

  it('uses the fallback project when the record omits one', () => {
    const record = normalizeRepository({ ...raw, project: null }, {
      id: 'fallback-id',
      name: 'Fallback',
    });
    expect(record?.projectId).toBe('fallback-id');
    expect(record?.projectName).toBe('Fallback');
  });

  it('leaves project metadata empty when nothing supplies it', () => {
    const record = normalizeRepository({ ...raw, project: undefined }, null);
    expect(record?.projectId).toBe('');
    expect(record?.projectName).toBe('');
  });

  it('falls back to remoteUrl, then to an empty string', () => {
    expect(
      normalizeRepository({ ...raw, webUrl: undefined, remoteUrl: 'https://x/_git/y' }, null)
        ?.webUrl,
    ).toBe('https://x/_git/y');
    expect(
      normalizeRepository({ ...raw, webUrl: undefined, remoteUrl: undefined }, null)?.webUrl,
    ).toBe('');
  });

  it('treats a missing isDisabled as enabled', () => {
    expect(normalizeRepository({ ...raw, isDisabled: undefined }, null)?.isDisabled).toBe(false);
  });

  it('leaves size and defaultBranch undefined when absent', () => {
    const record = normalizeRepository({ ...raw, size: undefined, defaultBranch: undefined }, null);
    expect(record?.size).toBeUndefined();
    expect(record?.defaultBranch).toBeUndefined();
  });
});

describe('listRepositories', () => {
  const payload = {
    count: 2,
    value: [
      { id: 'b', name: 'Beta', project: { id: 'p', name: 'Contoso' } },
      { id: 'a', name: 'Alpha', project: { id: 'p', name: 'Contoso' } },
    ],
  };

  it('scopes the request to a project', async () => {
    const client = stub(payload);
    await listRepositories(client, {
      kind: 'project',
      projectId: 'project-1',
      projectName: 'Contoso',
    });
    expect(client.paths[0]).toBe('project-1/_apis/git/repositories');
  });

  it('queries the whole organization when asked', async () => {
    const client = stub(payload);
    await listRepositories(client, { kind: 'organization' });
    expect(client.paths[0]).toBe('_apis/git/repositories');
  });

  it('sorts by project then repository name', async () => {
    const client = stub({
      count: 3,
      value: [
        { id: '1', name: 'Zeta', project: { id: 'p1', name: 'Alpha Project' } },
        { id: '2', name: 'Alpha', project: { id: 'p2', name: 'Beta Project' } },
        { id: '3', name: 'Alpha', project: { id: 'p1', name: 'Alpha Project' } },
      ],
    });
    const repositories = await listRepositories(client, { kind: 'organization' });
    expect(repositories.map((repository) => repository.id)).toEqual(['3', '1', '2']);
  });

  it('returns an empty list when the user can read nothing', async () => {
    const client = stub({ count: 0, value: [] });
    expect(await listRepositories(client, { kind: 'organization' })).toEqual([]);
  });

  it('skips malformed entries rather than failing', async () => {
    const client = stub({ count: 3, value: [{ id: 'ok', name: 'OK' }, null, { name: 'no id' }] });
    const repositories = await listRepositories(client, { kind: 'organization' });
    expect(repositories.map((repository) => repository.id)).toEqual(['ok']);
  });

  it('raises a malformed-response error when value is not an array', async () => {
    await expect(
      listRepositories(stub({ count: 1, value: 'nope' }), { kind: 'organization' }),
    ).rejects.toMatchObject({ kind: 'malformed-response' });
  });

  it('raises a malformed-response error for a null body', async () => {
    await expect(
      listRepositories(stub(null), { kind: 'organization' }),
    ).rejects.toMatchObject({ kind: 'malformed-response' });
  });
});

describe('scannableRepositories', () => {
  it('keeps a normal repository', () => {
    const repository = makeRepository();
    expect(scannableRepositories([repository])).toEqual([repository]);
  });

  it('drops disabled repositories', () => {
    expect(scannableRepositories([makeRepository({ isDisabled: true })])).toEqual([]);
  });

  it('drops a repository that is definitively empty', () => {
    expect(
      scannableRepositories([makeRepository({ defaultBranch: undefined, size: 0 })]),
    ).toEqual([]);
  });

  it('keeps a repository whose size is simply not reported', () => {
    const repository = makeRepository({ defaultBranch: undefined, size: undefined });
    expect(scannableRepositories([repository])).toEqual([repository]);
  });

  it('keeps a repository with no default branch but a non-zero size', () => {
    const repository = makeRepository({ defaultBranch: undefined, size: 2048 });
    expect(scannableRepositories([repository])).toEqual([repository]);
  });
});
