/**
 * Diagnostic logging.
 *
 * A single seam for the few places that need to surface a problem to a
 * developer's console. Two rules hold everywhere:
 *
 *  - No access token, Authorization header, or raw API payload is ever logged.
 *    Only the extension's own message and the caught value are passed through,
 *    and callers are responsible for keeping the message free of secrets.
 *  - Nothing is sent anywhere. There is no telemetry, no analytics and no
 *    remote log sink; these calls reach the browser console and stop there.
 */

const PREFIX = '[contribution-heatmap]';

export function logWarning(message: string, cause?: unknown): void {
  if (cause === undefined) {
    console.warn(`${PREFIX} ${message}`);
    return;
  }
  console.warn(`${PREFIX} ${message}`, cause);
}

export function logError(message: string, cause?: unknown): void {
  if (cause === undefined) {
    console.error(`${PREFIX} ${message}`);
    return;
  }
  console.error(`${PREFIX} ${message}`, cause);
}
