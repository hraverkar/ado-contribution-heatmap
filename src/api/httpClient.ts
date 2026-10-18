/**
 * Minimal authenticated JSON client for the Azure DevOps REST APIs.
 *
 * Everything this client talks to is the Azure DevOps organisation the
 * extension is installed in; there is no other origin. The bearer token comes
 * from the host frame via the extension SDK for the duration of a single
 * request and is never written to storage, logged, or attached to any other
 * destination.
 *
 * Responsibilities kept here so callers stay simple:
 *  - timeouts,
 *  - retry with exponential backoff and jitter for 429/5xx/network errors,
 *  - `Retry-After` honouring,
 *  - one automatic token refresh when the host returns an auth challenge,
 *  - detection of Azure DevOps' HTML sign-in response (served as HTTP 200/203),
 *  - translation of every failure into a typed {@link AppError}.
 */

import { REQUEST_TIMEOUT_MS, RETRY } from '../config/constants.js';
import { AppError, toAppError } from '../models/errors.js';
import { delay } from '../services/concurrency.js';

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface HttpClientOptions {
  /** Absolute base URL of the organisation, with a trailing slash. */
  readonly baseUrl: string;
  /** Supplies a bearer token. `forceRefresh` bypasses any caching. */
  readonly getToken: (forceRefresh: boolean) => Promise<string>;
  readonly timeoutMs?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  readonly query?: QueryParams;
  readonly signal?: AbortSignal;
  /** Treat HTTP 404 as an empty result instead of an error. */
  readonly allowNotFound?: boolean;
}

export interface HttpClient {
  getJson<T>(path: string, options?: RequestOptions): Promise<T | null>;
}

/** Builds a query string, dropping `undefined` and `null` values. */
export function buildQueryString(params: QueryParams | undefined): string {
  if (!params) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.append(key, String(value));
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

/** Joins a base URL and a relative path without doubling or dropping slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const relative = path.startsWith('/') ? path.slice(1) : path;
  return `${base}${relative}`;
}

/** Parses a `Retry-After` header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(headerValue: string | null, now: number = Date.now()): number | null {
  if (!headerValue) {
    return null;
  }
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(headerValue);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - now);
  }
  return null;
}

/** Exponential backoff with full jitter, clamped to the configured maximum. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(RETRY.baseDelayMs * 2 ** (attempt - 1), RETRY.maxDelayMs);
  return Math.round(exponential * (0.5 + random() * 0.5));
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function getJson<T>(path: string, requestOptions: RequestOptions = {}): Promise<T | null> {
    const url = joinUrl(options.baseUrl, path) + buildQueryString(requestOptions.query);
    let forceTokenRefresh = false;
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= RETRY.maxAttempts; attempt += 1) {
      try {
        const token = await options.getToken(forceTokenRefresh);
        const response = await fetchWithTimeout(
          fetchImpl,
          url,
          token,
          timeoutMs,
          requestOptions.signal,
        );

        if (response.status === 404 && requestOptions.allowNotFound) {
          return null;
        }

        if (response.ok || response.status === 203) {
          const contentType = response.headers.get('content-type') ?? '';
          if (!contentType.toLowerCase().includes('json')) {
            // Azure DevOps answers an unauthenticated request with a sign-in
            // page under a 200/203 status rather than a 401.
            lastError = new AppError({
              kind: 'auth',
              message: 'Your Azure DevOps session could not be verified.',
              detail: 'Reload the page to sign in again, then retry.',
              status: response.status,
              retryable: true,
            });
            if (!forceTokenRefresh) {
              forceTokenRefresh = true;
              continue;
            }
            throw lastError;
          }
          return (await parseJson<T>(response)) as T;
        }

        const error = await errorForResponse(response);

        if (error.kind === 'auth' && !forceTokenRefresh) {
          forceTokenRefresh = true;
          lastError = error;
          continue;
        }

        if (!error.retryable || attempt === RETRY.maxAttempts) {
          throw error;
        }

        lastError = error;
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        await delay(retryAfter ?? backoffDelay(attempt), requestOptions.signal);
        continue;
      } catch (caught) {
        const error = toAppError(caught, 'Unable to reach Azure DevOps.');
        if (error.kind === 'timeout' && requestOptions.signal?.aborted) {
          throw error;
        }
        if (!error.retryable || attempt === RETRY.maxAttempts) {
          throw error;
        }
        lastError = error;
        await delay(backoffDelay(attempt), requestOptions.signal);
      }
    }

    throw (
      lastError ??
      new AppError({ kind: 'unknown', message: 'Unable to reach Azure DevOps.' })
    );
  }

  return { getJson };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    return await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-TFS-FedAuthRedirect': 'Suppress',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (caught) {
    throw new AppError({
      kind: 'malformed-response',
      message: 'Azure DevOps returned a response this extension could not read.',
      detail: 'This is usually temporary. Try refreshing.',
      cause: caught,
    });
  }
}

async function errorForResponse(response: Response): Promise<AppError> {
  const status = response.status;
  const detail = await readErrorDetail(response);

  if (status === 401) {
    return new AppError({
      kind: 'auth',
      message: 'Your Azure DevOps session has expired.',
      detail: 'Reload the page to sign in again.',
      status,
      retryable: true,
    });
  }
  if (status === 403) {
    return new AppError({
      kind: 'permission',
      message: 'You do not have permission to read this data.',
      detail:
        detail ??
        'The extension needs read access to Azure Repos. Ask a project administrator to grant Read on the repositories you expect to see.',
      status,
      retryable: false,
    });
  }
  if (status === 404) {
    return new AppError({
      kind: 'not-found',
      message: 'That Azure DevOps resource no longer exists.',
      status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new AppError({
      kind: 'rate-limited',
      message: 'Azure DevOps is rate limiting this request.',
      detail: 'Waiting before trying again.',
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AppError({
      kind: 'network',
      message: 'Azure DevOps reported a temporary server error.',
      status,
      retryable: true,
    });
  }
  return new AppError({
    kind: 'unknown',
    message: 'Azure DevOps rejected this request.',
    detail: detail ?? `The service responded with status ${status}.`,
    status,
    retryable: false,
  });
}

/**
 * Extracts the `message` field from an Azure DevOps error envelope.
 *
 * Only that field is surfaced; the raw body, stack traces and internal
 * exception types are discarded.
 */
async function readErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('json')) {
      return undefined;
    }
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === 'string' && body.message.trim().length > 0) {
      return body.message.trim().slice(0, 300);
    }
  } catch {
    // A body we cannot read is not itself an error worth reporting.
  }
  return undefined;
}
