/**
 * Repository breakdown table.
 *
 * Sortable on every column, and each row doubles as a filter: activating a row
 * scopes the calendar and statistics to that repository. Sorting and filtering
 * both work on data already in memory, so neither triggers a network request.
 */

import type { RepositorySummary } from '../models/contribution.js';
import type {
  RepositorySort,
  RepositorySortColumn,
} from '../services/repositoryStatsService.js';
import { sortRepositorySummaries } from '../services/repositoryStatsService.js';
import { el } from './dom.js';
import { formatDateTime, formatInteger, formatRelative } from './format.js';

interface ColumnDefinition {
  readonly key: RepositorySortColumn;
  readonly label: string;
  readonly numeric: boolean;
  /** Direction applied the first time a column is selected. */
  readonly initialDirection: 'asc' | 'desc';
}

const COLUMNS: readonly ColumnDefinition[] = [
  { key: 'name', label: 'Repository', numeric: false, initialDirection: 'asc' },
  { key: 'count', label: 'Commits', numeric: true, initialDirection: 'desc' },
  { key: 'activeDays', label: 'Active days', numeric: true, initialDirection: 'desc' },
  { key: 'lastActivity', label: 'Last commit', numeric: false, initialDirection: 'desc' },
];

export interface RepositoryTableOptions {
  readonly summaries: readonly RepositorySummary[];
  readonly sort: RepositorySort;
  readonly selectedRepositoryId: string | null;
  readonly onSortChange: (sort: RepositorySort) => void;
  readonly onSelectRepository: (repositoryId: string | null) => void;
}

/** Next sort state when a column header is activated. */
export function nextSort(current: RepositorySort, column: RepositorySortColumn): RepositorySort {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  const definition = COLUMNS.find((candidate) => candidate.key === column);
  return { column, direction: definition?.initialDirection ?? 'desc' };
}

/** Renders the breakdown table, or nothing when there is no activity. */
export function renderRepositoryTable(options: RepositoryTableOptions): HTMLElement {
  const { summaries, sort, selectedRepositoryId, onSortChange, onSelectRepository } = options;

  const section = el('section', {
    className: 'ch-breakdown',
    attrs: { 'aria-labelledby': 'ch-breakdown-heading' },
  });

  section.appendChild(
    el('div', { className: 'ch-breakdown__header' }, [
      el('h2', {
        className: 'ch-heading',
        text: 'Repositories',
        attrs: { id: 'ch-breakdown-heading' },
      }),
      selectedRepositoryId === null
        ? null
        : el(
            'button',
            {
              className: 'ch-button ch-button--subtle',
              attrs: { type: 'button' },
              on: { click: () => onSelectRepository(null) },
            },
            ['Clear repository filter'],
          ),
    ]),
  );

  if (summaries.length === 0) {
    section.appendChild(
      el('p', {
        className: 'ch-breakdown__empty',
        text: 'No repository activity in this period.',
      }),
    );
    return section;
  }

  const table = el('table', {
    className: 'ch-table',
    attrs: { 'aria-describedby': 'ch-breakdown-heading' },
  });

  table.appendChild(renderHead(sort, onSortChange));
  table.appendChild(
    renderBody(sortRepositorySummaries(summaries, sort), selectedRepositoryId, onSelectRepository),
  );

  section.appendChild(el('div', { className: 'ch-table__scroll' }, [table]));
  return section;
}

function renderHead(
  sort: RepositorySort,
  onSortChange: (sort: RepositorySort) => void,
): HTMLElement {
  const row = el('tr');

  for (const column of COLUMNS) {
    const isSorted = sort.column === column.key;
    const ariaSort = isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';

    const headerButton = el(
      'button',
      {
        className: 'ch-table__sort',
        attrs: { type: 'button' },
        on: { click: () => onSortChange(nextSort(sort, column.key)) },
      },
      [
        el('span', { text: column.label }),
        el('span', {
          className: 'ch-table__sort-indicator',
          text: isSorted ? (sort.direction === 'asc' ? '▲' : '▼') : '',
          attrs: { 'aria-hidden': 'true' },
        }),
      ],
    );

    row.appendChild(
      el(
        'th',
        {
          className: column.numeric ? 'ch-table__cell--numeric' : '',
          attrs: { scope: 'col', 'aria-sort': ariaSort },
        },
        [headerButton],
      ),
    );
  }

  return el('thead', {}, [row]);
}

function renderBody(
  summaries: readonly RepositorySummary[],
  selectedRepositoryId: string | null,
  onSelectRepository: (repositoryId: string | null) => void,
): HTMLElement {
  const body = el('tbody');

  for (const summary of summaries) {
    const isSelected = summary.repositoryId === selectedRepositoryId;

    const nameButton = el(
      'button',
      {
        className: 'ch-table__link',
        attrs: {
          type: 'button',
          'aria-pressed': isSelected ? 'true' : 'false',
          title: isSelected
            ? 'Show all repositories'
            : `Show only ${summary.repositoryName} in the calendar`,
        },
        on: {
          click: () => onSelectRepository(isSelected ? null : summary.repositoryId),
        },
      },
      [
        el('span', { className: 'ch-table__name', text: summary.repositoryName }),
        summary.projectName
          ? el('span', { className: 'ch-table__project', text: summary.projectName })
          : null,
      ],
    );

    const row = el('tr', {
      className: isSelected ? 'ch-table__row ch-table__row--selected' : 'ch-table__row',
    });

    row.appendChild(el('td', {}, [nameButton]));
    row.appendChild(
      el('td', { className: 'ch-table__cell--numeric', text: formatInteger(summary.count) }),
    );
    row.appendChild(
      el('td', { className: 'ch-table__cell--numeric', text: formatInteger(summary.activeDays) }),
    );
    row.appendChild(
      el('td', {
        text: summary.lastActivity === null ? '—' : formatRelative(summary.lastActivity),
        title: summary.lastActivity === null ? '' : formatDateTime(summary.lastActivity),
      }),
    );

    body.appendChild(row);
  }

  return body;
}
