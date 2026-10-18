import { describe, expect, it, vi } from 'vitest';

import {
  backoffDelay,
  buildQueryString,
  createHttpClient,
  joinUrl,
  parseRetryAfter,
} from '../src/api/httpClient.js';
import { RETRY } from '../src/config/constants.js';
import { AppError } from '../src/models/errors.js';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function htmlResponse(status = 203): Response {
  return new Response('<html><body>Sign in</body></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function client(fetchImpl: typeof fetch, getToken = async () => 'test-token') {
  return createHttpClient({
    baseUrl: 'https://dev.azure.com/contoso/',
    getToken,
    fetchImpl,
    timeoutMs: 1000,
  });
}

describe('buildQueryString', () => {
  it('returns an empty string for no params', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString({})).toBe('');
  });

  it('drops null and undefined values', () => {
    expect(buildQueryString({ a: 1, b: undefined, c: null, d: false })).toBe('?a=1&d=false');
  });

  it('encodes values', () => {
    expect(buildQueryString({ author: 'ada lovelace@x.com' })).toBe(
      '?author=ada+lovelace%40x.com',
    );
  });
});

describe('joinUrl', () => {
  it('joins without doubling slashes', () => {
    expect(joinUrl('https://dev.azure.com/x/', '_apis/git')).toBe('https://dev.azure.com/x/_apis/git');
    expect(joinUrl('https://dev.azure.com/x', '/_apis/git')).toBe('https://dev.azure.com/x/_apis/git');
    expect(joinUrl('https://dev.azure.com/x', '_apis/git')).toBe('https://dev.azure.com/x/_apis/git');
  });
});

describe('parseRetryAfter', () => {
  it('reads a seconds value', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-08-25T10:00:00Z');
    expect(parseRetryAfter('Tue, 25 Aug 2026 10:00:30 GMT', now)).toBe(30_000);
  });

  it('never returns a negative wait for a past date', () => {
    const now = Date.parse('2026-08-25T10:00:00Z');
    expect(parseRetryAfter('Tue, 25 Aug 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('returns null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and stays within the cap', () => {
    const deterministic = () => 1;
    expect(backoffDelay(1, deterministic)).toBe(RETRY.baseDelayMs);
    expect(backoffDelay(2, deterministic)).toBe(RETRY.baseDelayMs * 2);
    expect(backoffDelay(10, deterministic)).toBe(RETRY.maxDelayMs);
  });

  it('applies jitter of at least half the nominal delay', () => {
    expect(backoffDelay(1, () => 0)).toBe(RETRY.baseDelayMs / 2);
  });
});

describe('createHttpClient', () => {
  it('returns parsed JSON on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ count: 1, value: [1] }));
    const result = await client(fetchImpl as unknown as typeof fetch).getJson<{ count: number }>(
      '_apis/git/repositories',
    );
    expect(result?.count).toBe(1);
  });

  it('sends a bearer token and suppresses the federated-auth redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await client(fetchImpl as unknown as typeof fetch).getJson('_apis/git/repositories');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['X-TFS-FedAuthRedirect']).toBe('Suppress');
    expect(init.credentials).toBe('omit');
  });

  it('builds the full URL from base, path and query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    await client(fetchImpl as unknown as typeof fetch).getJson('_apis/git/repositories', {
      query: { 'api-version': '7.1' },
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      'https://dev.azure.com/contoso/_apis/git/repositories?api-version=7.1',
    );
  });

  it('returns null for 404 when the caller allows it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const result = await client(fetchImpl as unknown as typeof fetch).getJson('_apis/x', {
      allowNotFound: true,
    });
    expect(result).toBeNull();
  });

  it('raises a not-found error for 404 otherwise', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).getJson('_apis/x'),
    ).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('raises a permission error for 403 and does not retry it', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Access denied.' }, 403));
    await expect(
      client(fetchImpl as unknown as typeof fetch).getJson('_apis/x'),
    ).rejects.toMatchObject({ kind: 'permission' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces only the message field from an error envelope', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: 'Access denied.', stackTrace: 'internal', typeKey: 'X' }, 403),
      );
    try {
      await client(fetchImpl as unknown as typeof fetch).getJson('_apis/x');
      expect.unreachable('should have thrown');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.detail).toBe('Access denied.');
      expect(JSON.stringify(appError)).not.toContain('stackTrace');
    }
  });

  it('retries a 429 and honours Retry-After', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client(fetchImpl as unknown as typeof fetch).getJson<{ ok: boolean }>(
      '_apis/x',
    );
    expect(result?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up on persistent rate limiting after the retry budget', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '0' } }));
    await expect(
      client(fetchImpl as unknown as typeof fetch).getJson('_apis/x'),
    ).rejects.toMatchObject({ kind: 'rate-limited' });
    expect(fetchImpl).toHaveBeenCalledTimes(RETRY.maxAttempts);
  });

  it('retries a 500 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await client(fetchImpl as unknown as typeof fetch).getJson<{ ok: boolean }>(
      '_apis/x',
    );
    expect(result?.ok).toBe(true);
  });

  it('treats an HTML sign-in page as an auth failure and refreshes the token once', async () => {
    const getToken = vi.fn().mockResolvedValue('token');
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse(203));

    await expect(
      client(fetchImpl as unknown as typeof fetch, getToken).getJson('_apis/x'),
    ).rejects.toMatchObject({ kind: 'auth' });

    expect(getToken).toHaveBeenCalledWith(false);
    expect(getToken).toHaveBeenCalledWith(true);
  });

  it('recovers when a refreshed token succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await client(fetchImpl as unknown as typeof fetch).getJson<{ ok: boolean }>(
      '_apis/x',
    );
    expect(result?.ok).toBe(true);
  });

  it('reports malformed JSON as such', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(
      client(fetchImpl as unknown as typeof fetch).getJson('_apis/x'),
    ).rejects.toMatchObject({ kind: 'malformed-response' });
  });

  it('classifies a network failure and retries it', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const result = await client(fetchImpl as unknown as typeof fetch).getJson<{ ok: boolean }>(
      '_apis/x',
    );
    expect(result?.ok).toBe(true);
  });

  it('surfaces a persistent network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      client(fetchImpl as unknown as typeof fetch).getJson('_apis/x'),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(
      client(fetchImpl as unknown as typeof fetch).getJson('_apis/x', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
