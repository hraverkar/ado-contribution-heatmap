/**
 * Repository discovery.
 *
 * Azure DevOps only returns repositories the caller is authorised to read, so
 * the result of these calls is already scoped to the current user's
 * permissions — there is no separate authorisation check to perform.
 *
 * Listing at organisation scope also yields each repository's project, which is
 * why the extension never needs the Project and Team (`vso.project`) scope.
 */

import { API_VERSION } from '../config/constants.js';
import { AppError } from '../models/errors.js';
import type { Repository } from '../models/repository.js';
import type { HttpClient } from './httpClient.js';

interface RawRepository {
  id?: unknown;
  name?: unknown;
  webUrl?: unknown;
  remoteUrl?: unknown;
  url?: unknown;
  defaultBranch?: unknown;
  isDisabled?: unknown;
  size?: unknown;
  project?: { id?: unknown; name?: unknown } | null;
}

interface RepositoryListResponse {
  count?: unknown;
  value?: unknown;
}

export type RepositoryScope =
  | { readonly kind: 'project'; readonly projectId: string; readonly projectName: string }
  | { readonly kind: 'organization' };

export interface ListRepositoriesOptions {
  readonly signal?: AbortSignal;
}

/** Lists every Git repository visible to the current user within `scope`. */
export async function listRepositories(
  http: HttpClient,
  scope: RepositoryScope,
  options: ListRepositoriesOptions = {},
): Promise<Repository[]> {
  const path =
    scope.kind === 'project'
      ? `${encodeURIComponent(scope.projectId)}/_apis/git/repositories`
      : '_apis/git/repositories';

  const response = await http.getJson<RepositoryListResponse>(path, {
    query: {
      'api-version': API_VERSION,
      includeLinks: false,
      includeAllUrls: false,
      includeHidden: false,
    },
    signal: options.signal,
  });

  if (!response || !Array.isArray(response.value)) {
    throw new AppError({
      kind: 'malformed-response',
      message: 'Azure DevOps returned an unexpected repository list.',
      detail: 'Try refreshing. If this keeps happening, the service may be having trouble.',
    });
  }

  const fallbackProject =
    scope.kind === 'project' ? { id: scope.projectId, name: scope.projectName } : null;

  const repositories: Repository[] = [];
  for (const raw of response.value as RawRepository[]) {
    const repository = normalizeRepository(raw, fallbackProject);
    if (repository) {
      repositories.push(repository);
    }
  }

  repositories.sort((a, b) => {
    if (a.projectName !== b.projectName) {
      return a.projectName.localeCompare(b.projectName, undefined, { sensitivity: 'base' });
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  return repositories;
}

/**
 * Converts one API record into a {@link Repository}, or `null` when required
 * fields are missing. Partial records are skipped rather than allowed to crash
 * a whole scan.
 */
export function normalizeRepository(
  raw: RawRepository | null | undefined,
  fallbackProject: { id: string; name: string } | null,
): Repository | null {
  if (!raw || typeof raw.id !== 'string' || raw.id.length === 0) {
    return null;
  }
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : raw.id;
  const projectId =
    typeof raw.project?.id === 'string' && raw.project.id.length > 0
      ? raw.project.id
      : (fallbackProject?.id ?? '');
  const projectName =
    typeof raw.project?.name === 'string' && raw.project.name.length > 0
      ? raw.project.name
      : (fallbackProject?.name ?? '');

  const webUrl =
    typeof raw.webUrl === 'string' && raw.webUrl.length > 0
      ? raw.webUrl
      : typeof raw.remoteUrl === 'string' && raw.remoteUrl.length > 0
        ? raw.remoteUrl
        : '';

  return {
    id: raw.id,
    name,
    projectId,
    projectName,
    webUrl,
    isDisabled: raw.isDisabled === true,
    defaultBranch: typeof raw.defaultBranch === 'string' ? raw.defaultBranch : undefined,
    size: typeof raw.size === 'number' ? raw.size : undefined,
  };
}

/**
 * Repositories worth scanning.
 *
 * Disabled repositories reject commit queries, and a repository Azure DevOps
 * reports as zero bytes with no default branch has never received a commit.
 * Both are dropped before the scan rather than costing a request each. A
 * repository whose size is simply not reported is kept — skipping it on a
 * missing field would silently lose real activity.
 */
export function scannableRepositories(repositories: readonly Repository[]): Repository[] {
  return repositories.filter((repository) => {
    if (repository.isDisabled) {
      return false;
    }
    const definitelyEmpty = repository.defaultBranch === undefined && repository.size === 0;
    return !definitelyEmpty;
  });
}
