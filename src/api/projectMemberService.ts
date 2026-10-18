/**
 * Discovers people in the teams belonging to the active Azure DevOps project.
 *
 * Only identity metadata is returned; commit activity remains read-only and is
 * fetched separately through the Git API.
 */

import { API_VERSION, REQUEST_CONCURRENCY } from '../config/constants.js';
import { AppError } from '../models/errors.js';
import type { CurrentUser } from '../models/user.js';
import type { HttpClient } from './httpClient.js';
import { mapWithConcurrency } from '../services/concurrency.js';

const TEAM_PAGE_SIZE = 100;

interface RawTeam {
  id?: unknown;
}

interface RawIdentity {
  id?: unknown;
  displayName?: unknown;
  uniqueName?: unknown;
  descriptor?: unknown;
  imageUrl?: unknown;
}

interface RawTeamMember {
  identity?: RawIdentity | null;
}

interface ListResponse {
  value?: unknown;
  count?: unknown;
}

/** Lists unique identities from every team visible in a project. */
export async function listProjectMembers(
  http: HttpClient,
  projectId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CurrentUser[]> {
  if (!projectId) {
    throw new AppError({
      kind: 'no-project',
      message: 'Open a project to view its contributors.',
    });
  }

  const teams = await listProjectTeams(http, projectId, options.signal);
  throwIfAborted(options.signal);
  const membersById = new Map<string, CurrentUser>();

  const teamMembers = await mapWithConcurrency(
    teams,
    async (team) => {
      const response = await http.getJson<ListResponse>(
        `_apis/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(team.id)}/members`,
        { query: { 'api-version': '7.1-preview.1' }, signal: options.signal },
      );
      if (!response || !Array.isArray(response.value)) {
        throw malformedMembersResponse();
      }
      return (response.value as RawTeamMember[])
        .map((record) => normalizeProjectMember(record?.identity))
        .filter((member): member is CurrentUser => member !== null);
    },
    { limit: REQUEST_CONCURRENCY, signal: options.signal },
  );
  throwIfAborted(options.signal);

  for (const team of teamMembers) {
    for (const member of team) {
      const existing = membersById.get(member.id);
      if (!existing || (!existing.uniqueName && member.uniqueName)) {
        membersById.set(member.id, member);
      }
    }
  }

  return [...membersById.values()].sort((left, right) =>
    memberLabel(left).localeCompare(memberLabel(right), undefined, { sensitivity: 'base' }),
  );
}

/** Converts an Azure DevOps team identity into the app's identity model. */
export function normalizeProjectMember(raw: RawIdentity | null | undefined): CurrentUser | null {
  if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
    return null;
  }

  return {
    id: raw.id,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
    uniqueName: typeof raw.uniqueName === 'string' ? raw.uniqueName : '',
    descriptor: typeof raw.descriptor === 'string' ? raw.descriptor : '',
    imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
  };
}

export function memberLabel(member: CurrentUser): string {
  return member.displayName || member.uniqueName || member.id;
}

async function listProjectTeams(
  http: HttpClient,
  projectId: string,
  signal?: AbortSignal,
): Promise<{ readonly id: string }[]> {
  const teams: { id: string }[] = [];
  let skip = 0;

  for (;;) {
    const response = await http.getJson<ListResponse>(
      `_apis/projects/${encodeURIComponent(projectId)}/teams`,
      {
        query: { 'api-version': API_VERSION, '$top': TEAM_PAGE_SIZE, '$skip': skip },
        signal,
      },
    );
    if (!response || !Array.isArray(response.value)) {
      throw malformedMembersResponse();
    }

    const batch = response.value as RawTeam[];
    for (const team of batch) {
      if (typeof team?.id === 'string' && team.id.length > 0) {
        teams.push({ id: team.id });
      }
    }
    if (batch.length < TEAM_PAGE_SIZE) {
      return teams;
    }
    skip += TEAM_PAGE_SIZE;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

function malformedMembersResponse(): AppError {
  return new AppError({
    kind: 'malformed-response',
    message: 'Azure DevOps returned an unexpected project member list.',
    detail: 'Try refreshing. If this keeps happening, the service may be having trouble.',
  });
}
