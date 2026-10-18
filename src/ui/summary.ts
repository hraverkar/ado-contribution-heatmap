/**
 * Headline statistics strip rendered above the calendar.
 */

import type { ContributionStatistics } from '../models/contribution.js';
import type { DateRange } from '../models/dateRange.js';
import { formatDayMedium, rangeLength } from '../util/dates.js';
import { el } from './dom.js';
import { formatDecimal, formatInteger } from './format.js';

interface Metric {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

function metricsFor(stats: ContributionStatistics, range: DateRange): Metric[] {
  const days = rangeLength(range);
  const coverage = days > 0 ? Math.round((stats.activeDays / days) * 100) : 0;

  return [
    {
      label: 'Commits',
      value: formatInteger(stats.total),
      detail: `${formatDayMedium(range.start)} to ${formatDayMedium(range.end)}`,
    },
    {
      label: 'Active days',
      value: formatInteger(stats.activeDays),
      detail: `${coverage}% of ${formatInteger(days)} days`,
    },
    {
      label: 'Current streak',
      value: `${formatInteger(stats.currentStreak)}`,
      detail: stats.currentStreak === 1 ? 'day' : 'days',
    },
    {
      label: 'Longest streak',
      value: `${formatInteger(stats.longestStreak)}`,
      detail: stats.longestStreak === 1 ? 'day' : 'days',
    },
    {
      label: 'Per active day',
      value: formatDecimal(stats.averagePerActiveDay),
      detail: 'commits',
    },
    {
      label: 'Repositories',
      value: formatInteger(stats.repositoriesWithActivity),
      detail: stats.busiestDay
        ? `busiest day ${formatDayMedium(stats.busiestDay.date)}`
        : 'with activity',
    },
  ];
}

/** Renders the statistics strip. */
export function renderSummary(stats: ContributionStatistics, range: DateRange): HTMLElement {
  const list = el('dl', { className: 'ch-summary' });

  for (const metric of metricsFor(stats, range)) {
    list.appendChild(
      el('div', { className: 'ch-summary__item' }, [
        el('dt', { className: 'ch-summary__label', text: metric.label }),
        el('dd', { className: 'ch-summary__value' }, [
          el('span', { className: 'ch-summary__number', text: metric.value }),
          metric.detail
            ? el('span', { className: 'ch-summary__detail', text: metric.detail })
            : null,
        ]),
      ]),
    );
  }

  return list;
}
