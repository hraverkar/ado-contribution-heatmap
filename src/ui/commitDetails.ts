/**
 * Day details panel: what happened on one calendar day.
 *
 * Shows commit *metadata* only — repository, message subject, author, short
 * SHA, and time. No diff, file list, or file content is fetched or displayed;
 * "Open" hands the user off to the Azure DevOps commit page, where normal
 * repository permissions apply.
 */

import { shortCommitId } from '../api/commitService.js';
import type { ContributionEvent, DayContribution } from '../models/contribution.js';
import { formatDayFull } from '../util/dates.js';
import { el } from './dom.js';
import { formatTime, pluralize } from './format.js';

export interface CommitDetailsOptions {
  readonly day: DayContribution;
  /** Opens an Azure DevOps URL outside the extension iframe. */
  readonly onOpenCommit: (url: string) => void;
}

/** Panel heading for a day. */
export function dayPanelTitle(day: DayContribution): string {
  return formatDayFull(day.date);
}

/** Panel subheading summarising the day. */
export function dayPanelDescription(day: DayContribution): string {
  if (day.count === 0) {
    return 'No commits on this day.';
  }
  return `${pluralize(day.count, 'commit')} across ${pluralize(day.repositories, 'repository', 'repositories')}`;
}

/** Renders the list of commits for a day. */
export function renderCommitDetails(options: CommitDetailsOptions): HTMLElement {
  const { day, onOpenCommit } = options;

  if (day.count === 0) {
    return el('p', {
      className: 'ch-panel__empty',
      text: 'Nothing was committed on this day.',
    });
  }

  const grouped = groupByRepository(day.events);
  const container = el('div', { className: 'ch-commits' });

  for (const [repositoryName, events] of grouped) {
    container.appendChild(
      el('section', { className: 'ch-commits__group' }, [
        el('h3', { className: 'ch-commits__repo' }, [
          el('span', { className: 'ch-commits__repo-name', text: repositoryName }),
          el('span', {
            className: 'ch-commits__repo-count',
            text: pluralize(events.length, 'commit'),
          }),
        ]),
        renderCommitList(events, onOpenCommit),
      ]),
    );
  }

  return container;
}

/** Groups a day's events by repository, most active repository first. */
export function groupByRepository(
  events: readonly ContributionEvent[],
): Map<string, ContributionEvent[]> {
  const groups = new Map<string, ContributionEvent[]>();
  for (const event of events) {
    const key = event.repositoryName || 'Unknown repository';
    const existing = groups.get(key);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  return new Map(
    [...groups.entries()].sort((a, b) => {
      if (a[1].length !== b[1].length) {
        return b[1].length - a[1].length;
      }
      return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
    }),
  );
}

function renderCommitList(
  events: readonly ContributionEvent[],
  onOpenCommit: (url: string) => void,
): HTMLElement {
  const list = el('ul', { className: 'ch-commits__list' });

  // Newest first reads better in a day view than the chronological storage order.
  const ordered = [...events].sort((a, b) => b.timestamp - a.timestamp);

  for (const event of ordered) {
    const openButton = el(
      'button',
      {
        className: 'ch-button ch-button--subtle ch-commits__open',
        attrs: {
          type: 'button',
          'aria-label': `Open commit ${shortCommitId(event.id)} in Azure DevOps`,
          ...(event.url ? {} : { disabled: 'true' }),
        },
        on: { click: () => event.url && onOpenCommit(event.url) },
      },
      ['Open'],
    );

    list.appendChild(
      el('li', { className: 'ch-commits__item' }, [
        el('div', { className: 'ch-commits__main' }, [
          el('p', {
            className: 'ch-commits__message',
            text: event.title || '(no commit message)',
            title: event.title,
          }),
          el('p', { className: 'ch-commits__meta' }, [
            el('span', { className: 'ch-commits__author', text: event.actorName || 'Unknown author' }),
            el('span', { className: 'ch-commits__separator', text: '·', attrs: { 'aria-hidden': 'true' } }),
            el('code', {
              className: 'ch-commits__sha',
              text: shortCommitId(event.id),
              title: event.id,
            }),
            el('span', { className: 'ch-commits__separator', text: '·', attrs: { 'aria-hidden': 'true' } }),
            el('time', {
              className: 'ch-commits__time',
              text: formatTime(event.timestamp),
              attrs: { datetime: new Date(event.timestamp).toISOString() },
            }),
          ]),
        ]),
        openButton,
      ]),
    );
  }

  return list;
}
