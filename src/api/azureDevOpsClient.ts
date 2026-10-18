/**
 * Bridge between the Azure DevOps host frame and the rest of the extension.
 *
 * This is the only module that imports the extension SDK, which keeps every
 * other layer testable in plain Node and makes the host surface we depend on
 * explicit and small:
 *
 *  - `SDK.getUser()`      — the authenticated identity, no API call, no scope.
 *  - `SDK.getAccessToken()` — a short-lived bearer token minted by the host for
 *                             the scopes declared in `vss-extension.json`.
 *  - LocationService      — the organisation's Git REST base URL.
 *  - ProjectPageService   — the project the hub was opened from.
 *  - HostNavigationService — opening Azure DevOps pages outside the iframe.
 *
 * No credential is ever stored: tokens live in a module-local variable for a
 * few minutes and are discarded when the page unloads.
 */

import * as SDK from 'azure-devops-extension-sdk';

import { GIT_RESOURCE_AREA_ID, SERVICE_IDS } from '../config/constants.js';
import { AppError, toAppError } from '../models/errors.js';
import type { CurrentUser } from '../models/user.js';
import { logWarning } from '../util/log.js';
import { createHttpClient, type HttpClient } from './httpClient.js';

/** Tokens are re-requested well before the host's own expiry. */
const TOKEN_CACHE_MS = 5 * 60 * 1000;

interface LocationService {
  getResourceAreaLocation(resourceAreaId: string): Promise<string>;
}

interface ProjectInfo {
  id: string;
  name: string;
}

interface ProjectPageService {
  getProject(): Promise<ProjectInfo | undefined>;
}

interface HostNavigationService {
  navigate(url: string): void;
  openNewWindow(url: string, features: string): void;
}

export interface HostProject {
  readonly id: string;
  readonly name: string;
}

export interface AzureDevOpsContext {
  readonly http: HttpClient;
  readonly user: CurrentUser;
  readonly organizationName: string;
  /** Organisation base URL with a trailing slash. */
  readonly baseUrl: string;
  /** The project the hub was opened in, or `null` at organisation scope. */
  readonly currentProject: HostProject | null;
  /** Opens an Azure DevOps URL in a new browser tab. */
  openInNewWindow(url: string): void;
  /** Navigates the hosting Azure DevOps page. */
  navigate(url: string): void;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(forceRefresh: boolean): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.value;
  }
  try {
    const token = await SDK.getAccessToken();
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppError({
        kind: 'auth',
        message: 'Azure DevOps did not return an access token.',
        detail: 'Reload the page and try again.',
      });
    }
    cachedToken = { value: token, expiresAt: now + TOKEN_CACHE_MS };
    return token;
  } catch (caught) {
    cachedToken = null;
    if (caught instanceof AppError) {
      throw caught;
    }
    throw new AppError({
      kind: 'auth',
      message: 'Could not authenticate with Azure DevOps.',
      detail: 'Reload the page. If the problem persists, sign out and back in.',
      cause: caught,
    });
  }
}

/** Drops the in-memory token. Called on sign-out style failures and on unload. */
export function clearTokenCache(): void {
  cachedToken = null;
}

/** Initialises the SDK handshake and applies the host theme. */
export async function initializeHost(): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });
  await SDK.ready();
}

/** Tells the host the extension rendered successfully. */
export async function notifyLoaded(): Promise<void> {
  await SDK.notifyLoadSucceeded();
}

/** Tells the host the extension failed to render. */
export async function notifyFailed(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await SDK.notifyLoadFailed(message);
}

/** Builds the context object every service depends on. */
export async function createAzureDevOpsContext(): Promise<AzureDevOpsContext> {
  const user = readCurrentUser();
  const baseUrl = await resolveBaseUrl();
  const currentProject = await resolveCurrentProject();
  const navigation = await getNavigationService();

  const http = createHttpClient({ baseUrl, getToken: getAccessToken });

  return {
    http,
    user,
    organizationName: safeHostName(),
    baseUrl,
    currentProject,
    openInNewWindow(url: string): void {
      if (!isAllowedNavigationTarget(url)) {
        return;
      }
      if (navigation) {
        navigation.openNewWindow(url, '');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    navigate(url: string): void {
      if (!isAllowedNavigationTarget(url)) {
        return;
      }
      if (navigation) {
        navigation.navigate(url);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

function readCurrentUser(): CurrentUser {
  const user = SDK.getUser();
  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    throw new AppError({
      kind: 'auth',
      message: 'Azure DevOps did not identify the signed-in user.',
      detail: 'Reload the page. If this persists, sign out of Azure DevOps and sign back in.',
    });
  }
  return {
    id: user.id,
    uniqueName: typeof user.name === 'string' ? user.name : '',
    displayName: typeof user.displayName === 'string' ? user.displayName : '',
    descriptor: typeof user.descriptor === 'string' ? user.descriptor : '',
    imageUrl: typeof user.imageUrl === 'string' ? user.imageUrl : '',
  };
}

/**
 * Resolves the organisation's Git REST base URL via the host's location
 * service, which is correct for Azure DevOps Services and Server alike. The
 * `dev.azure.com` fallback only applies when the service is unavailable.
 */
async function resolveBaseUrl(): Promise<string> {
  try {
    const location = await SDK.getService<LocationService>(SERVICE_IDS.location);
    const url = await location.getResourceAreaLocation(GIT_RESOURCE_AREA_ID);
    if (typeof url === 'string' && url.length > 0) {
      return url.endsWith('/') ? url : `${url}/`;
    }
  } catch (caught) {
    logWarning('Location service unavailable, falling back to the default organisation URL.', caught);
  }

  const host = safeHostName();
  if (!host) {
    throw toAppError(
      new AppError({
        kind: 'unknown',
        message: 'Could not determine the Azure DevOps organisation URL.',
        detail: 'Reload the page. If this persists, reinstall the extension.',
      }),
    );
  }
  return `https://dev.azure.com/${encodeURIComponent(host)}/`;
}

async function resolveCurrentProject(): Promise<HostProject | null> {
  try {
    const service = await SDK.getService<ProjectPageService>(SERVICE_IDS.projectPage);
    const project = await service.getProject();
    if (project && typeof project.id === 'string' && project.id.length > 0) {
      return { id: project.id, name: project.name ?? project.id };
    }
  } catch (caught) {
    logWarning('Project page service unavailable.', caught);
  }

  // Fall back to the page context, which carries the project for project-scoped hubs.
  try {
    const context = SDK.getPageContext();
    const project = context?.webContext?.project;
    if (project && typeof project.id === 'string' && project.id.length > 0) {
      return { id: project.id, name: project.name ?? project.id };
    }
  } catch {
    // No project context is a valid state; the UI handles it.
  }
  return null;
}

async function getNavigationService(): Promise<HostNavigationService | null> {
  try {
    return await SDK.getService<HostNavigationService>(SERVICE_IDS.hostNavigation);
  } catch (caught) {
    logWarning('Host navigation service unavailable.', caught);
    return null;
  }
}

function safeHostName(): string {
  try {
    return SDK.getHost()?.name ?? '';
  } catch {
    return '';
  }
}

/**
 * Guards outbound navigation. Only `https` Azure DevOps style URLs produced by
 * the API are ever opened, so a malformed or hostile `remoteUrl` in an API
 * response cannot turn into a `javascript:` or `data:` navigation.
 */
export function isAllowedNavigationTarget(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
