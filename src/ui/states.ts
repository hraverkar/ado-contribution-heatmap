/**
 * Loading, empty and error presentation.
 *
 * Users see a plain-language summary and, where it helps, one concrete next
 * step. Raw stack traces, exception types and API payloads stay in the console.
 */

import type { AppError, AppErrorKind } from '../models/errors.js';
import type { ScanProgress } from '../services/contributionService.js';
import { button, el } from './dom.js';
import { formatInteger } from './format.js';

export interface EmptyStateOptions {
  readonly title: string;
  readonly description?: string;
  readonly hint?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}

/** Progress text for a running scan. */
export function progressMessage(progress: ScanProgress | null): string {
  if (!progress) {
    return 'Loading your contributions...';
  }
  if (progress.phase === 'repositories') {
    return progress.total > 0
      ? `Found ${formatInteger(progress.total)} repositories...`
      : 'Finding repositories...';
  }
  if (progress.phase === 'commits') {
    if (progress.total === 0) {
      return 'Loading your contributions...';
    }
    return `Scanning repositories ${formatInteger(progress.completed)} / ${formatInteger(progress.total)}...`;
  }
  return 'Finishing up...';
}

/** Indeterminate loading block with live progress text. */
export function renderLoadingState(progress: ScanProgress | null): HTMLElement {
  const percent =
    progress && progress.phase === 'commits' && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : null;

  return el('div', { className: 'ch-state ch-state--loading', attrs: { role: 'status', 'aria-live': 'polite' } }, [
    el('div', { className: 'ch-spinner', attrs: { 'aria-hidden': 'true' } }),
    el('p', { className: 'ch-state__title', text: progressMessage(progress) }),
    percent === null
      ? null
      : el(
          'div',
          {
            className: 'ch-progress',
            attrs: {
              role: 'progressbar',
              'aria-valuemin': '0',
              'aria-valuemax': '100',
              'aria-valuenow': String(percent),
              'aria-label': 'Repository scan progress',
            },
          },
          [
            el('div', {
              className: 'ch-progress__bar',
              attrs: { style: `width:${percent}%` },
            }),
          ],
        ),
  ]);
}

/** Neutral empty state with an optional call to action. */
export function renderEmptyState(options: EmptyStateOptions): HTMLElement {
  return el('div', { className: 'ch-state ch-state--empty', attrs: { role: 'status' } }, [
    el('p', { className: 'ch-state__title', text: options.title }),
    options.description ? el('p', { className: 'ch-state__body', text: options.description }) : null,
    options.hint ? el('p', { className: 'ch-state__hint', text: options.hint }) : null,
    options.actionLabel && options.onAction
      ? button(options.actionLabel, { className: 'ch-button ch-button--primary', onClick: options.onAction })
      : null,
  ]);
}

/** Troubleshooting guidance keyed by error category. */
export function troubleshootingFor(kind: AppErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'Reload this page to refresh your Azure DevOps sign-in, then try again.';
    case 'permission':
      return 'Your account needs Read access to Azure Repos in this project. A project administrator can grant it under Project settings, Repositories, Security.';
    case 'rate-limited':
      return 'Azure DevOps is throttling requests. Wait a minute, then retry. Narrowing the date range or scanning a single project reduces the number of requests.';
    case 'network':
      return 'Check your connection and any corporate proxy, then retry.';
    case 'timeout':
      return 'The request took too long. A shorter date range or a single project usually completes faster.';
    case 'malformed-response':
      return 'Azure DevOps returned something unexpected. This is usually temporary.';
    case 'not-found':
      return 'The project or repository may have been renamed or deleted. Reload the page.';
    case 'no-project':
      return 'Open the Contribution Heatmap from inside a project, or switch the scope to the whole organization.';
    default:
      return 'Try again. If the problem continues, reload the page.';
  }
}

/** Error block with a friendly message, guidance, and a retry action. */
export function renderErrorState(error: AppError, onRetry?: () => void): HTMLElement {
  return el('div', { className: 'ch-state ch-state--error', attrs: { role: 'alert' } }, [
    el('p', { className: 'ch-state__title', text: error.message }),
    el('p', { className: 'ch-state__body', text: error.detail ?? troubleshootingFor(error.kind) }),
    error.detail ? el('p', { className: 'ch-state__hint', text: troubleshootingFor(error.kind) }) : null,
    onRetry
      ? button('Retry', { className: 'ch-button ch-button--primary', onClick: onRetry })
      : null,
  ]);
}

/** Non-blocking warning strip for partial failures. */
export function renderNotice(message: string, tone: 'warning' | 'info' = 'warning'): HTMLElement {
  return el('div', {
    className: `ch-notice ch-notice--${tone}`,
    text: message,
    attrs: { role: 'status' },
  });
}
