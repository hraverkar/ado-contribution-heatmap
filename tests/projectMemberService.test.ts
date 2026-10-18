import { describe, expect, it } from 'vitest';

import type { HttpClient } from '../src/api/httpClient.js';
import {
  listProjectMembers,
  memberLabel,
  normalizeProjectMember,
} from '../src/api/projectMemberService.js';

describe('normalizeProjectMember', () => {
  it('maps an Azure DevOps identity', () => {
    expect(
      normalizeProjectMember({
        id: 'member-1',
        displayName: 'Ada Lovelace',
        uniqueName: 'ada@example.com',
        descriptor: 'aad.ada',
      }),
    ).toEqual({
      id: 'member-1',
      displayName: 'Ada Lovelace',
      uniqueName: 'ada@example.com',
      descriptor: 'aad.ada',
      imageUrl: '',
    });
  });

  it('skips identities without an id', () => {
    expect(normalizeProjectMember(null)).toBeNull();
    expect(normalizeProjectMember({ displayName: 'No id' })).toBeNull();
  });

  it('uses a useful fallback label', () => {
    expect(memberLabel({ id: 'id-1', displayName: '', uniqueName: 'user@example.com', descriptor: '', imageUrl: '' }))
      .toBe('user@example.com');
  });
});

describe('listProjectMembers', () => {
  it('loads members from every team and de-duplicates by identity id', async () => {
    const paths: string[] = [];
    const client: HttpClient = {
      async getJson<T>(path: string): Promise<T | null> {
        paths.push(path);
        if (path.endsWith('/teams')) {
          return {
            count: 2,
            value: [{ id: 'team-a' }, { id: 'team-b' }],
          } as T;
        }
        if (path.endsWith('/team-a/members')) {
          return {
            value: [
              { identity: { id: 'ada', displayName: 'Ada Lovelace', uniqueName: 'ada@example.com' } },
              { identity: { id: 'grace', displayName: 'Grace Hopper', uniqueName: 'grace@example.com' } },
            ],
          } as T;
        }
        return {
          value: [
            { identity: { id: 'ada', displayName: 'Ada Lovelace', uniqueName: 'ada@example.com' } },
          ],
        } as T;
      },
    };

    const members = await listProjectMembers(client, 'project/one');

    expect(paths[0]).toBe('_apis/projects/project%2Fone/teams');
    expect(paths).toContain('_apis/projects/project%2Fone/teams/team-a/members');
    expect(paths).toContain('_apis/projects/project%2Fone/teams/team-b/members');
    expect(members.map((member) => member.id)).toEqual(['ada', 'grace']);
  });

  it('throws a clear malformed-response error instead of returning a partial list', async () => {
    const client: HttpClient = {
      async getJson<T>(path: string): Promise<T | null> {
        return (path.endsWith('/teams')
          ? { value: [{ id: 'team-a' }] }
          : { value: 'unexpected' }) as T;
      },
    };

    await expect(listProjectMembers(client, 'project-1')).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('requires a project id', async () => {
    const client: HttpClient = { async getJson() { return null; } };
    await expect(listProjectMembers(client, '')).rejects.toMatchObject({ kind: 'no-project' });
  });
});
