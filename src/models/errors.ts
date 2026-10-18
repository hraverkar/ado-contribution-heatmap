/**
 * Typed error taxonomy for the extension.
 *
 * Every failure surfaced to the UI is one of these. The UI maps `kind` to a
 * friendly message and a troubleshooting hint; raw stack traces and raw API
 * payloads are never rendered.
 */

export type AppErrorKind =
  | 'auth'
  | 'permission'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'malformed-response'
  | 'no-project'
  | 'timeout'
  | 'unknown';

export interface AppErrorOptions {
  /** Coarse category used by the UI to pick a message. */
  readonly kind: AppErrorKind;
  /** Short, user-safe summary. */
  readonly message: string;
  /** Optional extra line shown as troubleshooting detail (must be user-safe). */
  readonly detail?: string;
  /** HTTP status, when the failure came from a REST call. */
  readonly status?: number;
  /** Whether a retry could plausibly succeed. */
  readonly retryable?: boolean;
  /** Underlying cause, kept for console diagnostics only. */
  readonly cause?: unknown;
}

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail?: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.kind = options.kind;
    this.detail = options.detail;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableKind(options.kind);
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

function isRetryableKind(kind: AppErrorKind): boolean {
  return kind === 'network' || kind === 'rate-limited' || kind === 'timeout' || kind === 'unknown';
}

/** Normalises any thrown value into an {@link AppError}. */
export function toAppError(value: unknown, fallbackMessage = 'Something went wrong.'): AppError {
  if (value instanceof AppError) {
    return value;
  }
  if (value instanceof DOMException && value.name === 'AbortError') {
    return new AppError({
      kind: 'timeout',
      message: 'The request took too long and was cancelled.',
      cause: value,
    });
  }
  if (value instanceof TypeError) {
    // `fetch` rejects with a TypeError for network-level failures.
    return new AppError({
      kind: 'network',
      message: 'Could not reach Azure DevOps.',
      detail: 'Check your network connection and that the Azure DevOps service is reachable.',
      cause: value,
    });
  }
  return new AppError({ kind: 'unknown', message: fallbackMessage, cause: value });
}
