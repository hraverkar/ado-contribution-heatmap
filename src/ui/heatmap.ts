/**
 * Contribution calendar renderer.
 *
 * Layout: a CSS grid of seven weekday rows by N week columns. Each weekday row
 * is a `role="row"` with `display: contents`, so the DOM keeps proper grid
 * semantics while the cells still flow into the parent grid visually. That
 * combination gives correct weekday alignment without faking table structure.
 *
 * Accessibility:
 *  - Every day is a focusable `gridcell` whose accessible name states the full
 *    date, the commit count and the repository count, so intensity is never
 *    conveyed by colour alone.
 *  - The legend labels each level with its numeric band for the same reason.
 *  - A roving tabindex plus the standard ARIA grid key bindings (arrows for
 *    week/day, Home/End, PageUp/PageDown) make the whole year reachable with
 *    one Tab stop.
 *  - An optional pattern overlay adds texture per level for viewers who cannot
 *    separate the greens.
 */

import type { CalendarCell, CalendarGrid } from '../heatmap/calendar.js';
import type { IntensityThresholds } from '../heatmap/intensity.js';
import { describeLevels } from '../heatmap/intensity.js';
import { formatDayFull, weekdayShortName } from '../util/dates.js';
import { el, replaceChildren } from './dom.js';
import { pluralize } from './format.js';

/** Weekday rows that carry a visible label, mirroring common calendar practice. */
const LABELLED_WEEKDAYS = new Set([1, 3, 5]);

export interface HeatmapOptions {
  readonly grid: CalendarGrid;
  readonly thresholds: IntensityThresholds;
  readonly usePatterns: boolean;
  readonly selectedDate: string | null;
  readonly contributorName?: string;
  readonly onSelectDay: (date: string) => void;
}

/**
 * Cell size for a given number of week columns.
 *
 * A 30-day range would look sparse at the density a full year needs, so short
 * ranges get larger cells. The steps are fixed rather than continuous, which
 * keeps the calendar recognisable as the same object across range changes.
 */
export function cellMetrics(totalWeeks: number): { cell: number; gap: number } {
  if (totalWeeks <= 8) {
    return { cell: 26, gap: 5 };
  }
  if (totalWeeks <= 16) {
    return { cell: 18, gap: 4 };
  }
  if (totalWeeks <= 30) {
    return { cell: 14, gap: 3 };
  }
  return { cell: 11, gap: 3 };
}

/** Accessible name for one day cell. */
export function cellLabel(cell: CalendarCell): string {
  if (cell.date === null) {
    return '';
  }
  const date = formatDayFull(cell.date);
  if (cell.count === 0) {
    return `${date}: no commits`;
  }
  return `${date}: ${pluralize(cell.count, 'commit')} across ${pluralize(cell.repositories, 'repository', 'repositories')}`;
}

/** Tooltip body, matching the accessible name but formatted for reading. */
export function tooltipLines(cell: CalendarCell): string[] {
  if (cell.date === null) {
    return [];
  }
  if (cell.count === 0) {
    return [formatDayFull(cell.date), 'No commits'];
  }
  return [
    formatDayFull(cell.date),
    pluralize(cell.count, 'commit'),
    pluralize(cell.repositories, 'repository', 'repositories'),
  ];
}

/** Renders the calendar, its month/weekday axes and the intensity legend. */
export function renderHeatmap(options: HeatmapOptions): HTMLElement {
  const { grid, thresholds, usePatterns, selectedDate, contributorName, onSelectDay } = options;

  const root = el('section', {
    className: 'ch-heatmap',
    attrs: {
      'aria-label': contributorName
        ? `${contributorName} contribution calendar`
        : 'Contribution calendar',
    },
    dataset: { patterns: usePatterns ? 'on' : 'off' },
  });

  if (grid.totalWeeks === 0) {
    return root;
  }

  const tooltip = el('div', {
    className: 'ch-tooltip',
    attrs: { role: 'presentation', hidden: true },
  });

  const scroll = el('div', {
    className: 'ch-heatmap__scroll',
    attrs: { tabindex: '0', role: 'region', 'aria-label': 'Contribution calendar, scrollable' },
  });

  const metrics = cellMetrics(grid.totalWeeks);
  const inner = el('div', {
    className: 'ch-heatmap__inner',
    attrs: {
      style: `--ch-weeks:${grid.totalWeeks};--ch-cell:${metrics.cell}px;--ch-gap:${metrics.gap}px`,
    },
  });

  inner.appendChild(renderMonthAxis(grid));
  inner.appendChild(renderWeekdayAxis(grid));

  const cells: HTMLButtonElement[] = [];
  const gridElement = el('div', {
    className: 'ch-grid',
    attrs: {
      role: 'grid',
      'aria-readonly': 'true',
      'aria-rowcount': '7',
      'aria-colcount': String(grid.totalWeeks),
      'aria-label': 'Commits per day',
    },
  });

  for (let row = 0; row < 7; row += 1) {
    const rowElement = el('div', {
      className: 'ch-grid__row',
      attrs: { role: 'row', 'aria-rowindex': String(row + 1) },
    });

    for (const week of grid.weeks) {
      const cell = week.cells[row] as CalendarCell;
      rowElement.appendChild(
        cell.date === null
          ? renderPaddingCell(week.weekIndex)
          : renderDayCell(cell, {
              selected: cell.date === selectedDate,
              onSelectDay,
              tooltip,
              register: (element) => cells.push(element),
            }),
      );
    }

    gridElement.appendChild(rowElement);
  }

  attachKeyboardNavigation(gridElement, cells, grid.totalWeeks);

  gridElement.addEventListener('mouseleave', () => hideTooltip(tooltip));
  gridElement.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget;
    if (!(next instanceof Node) || !gridElement.contains(next)) {
      hideTooltip(tooltip);
    }
  });

  inner.appendChild(gridElement);
  scroll.appendChild(inner);

  root.appendChild(scroll);
  root.appendChild(tooltip);
  root.appendChild(renderLegend(thresholds, usePatterns));
  root.appendChild(
    el('p', {
      className: 'ch-visually-hidden',
      text: 'Use the arrow keys to move between days. Left and right move by one week, up and down by one day. Press Enter to see that day’s commits.',
    }),
  );

  // Most-recent activity is the interesting end, so start scrolled there.
  requestAnimationFrame(() => {
    scroll.scrollLeft = scroll.scrollWidth;
  });

  return root;
}

interface DayCellContext {
  readonly selected: boolean;
  readonly onSelectDay: (date: string) => void;
  readonly tooltip: HTMLElement;
  readonly register: (element: HTMLButtonElement) => void;
}

function renderDayCell(cell: CalendarCell, context: DayCellContext): HTMLElement {
  const date = cell.date as string;

  const buttonElement = el('button', {
    className: 'ch-cell',
    attrs: {
      type: 'button',
      role: 'gridcell',
      'aria-colindex': String(cell.weekIndex + 1),
      'aria-label': cellLabel(cell),
      'aria-selected': context.selected ? 'true' : 'false',
      tabindex: '-1',
    },
    dataset: { date, level: cell.level, count: cell.count },
  });

  if (context.selected) {
    buttonElement.classList.add('ch-cell--selected');
  }

  const show = (): void => showTooltip(context.tooltip, buttonElement, cell);
  buttonElement.addEventListener('mouseenter', show);
  buttonElement.addEventListener('focus', show);
  buttonElement.addEventListener('click', () => context.onSelectDay(date));

  context.register(buttonElement);
  return buttonElement;
}

function renderPaddingCell(weekIndex: number): HTMLElement {
  return el('div', {
    className: 'ch-cell ch-cell--padding',
    attrs: { role: 'gridcell', 'aria-colindex': String(weekIndex + 1), 'aria-hidden': 'true' },
  });
}

function renderMonthAxis(grid: CalendarGrid): HTMLElement {
  const axis = el('div', { className: 'ch-months', attrs: { 'aria-hidden': 'true' } });
  for (const label of grid.monthLabels) {
    axis.appendChild(
      el('span', {
        className: 'ch-months__label',
        text: label.label,
        attrs: { style: `grid-column:${label.weekIndex + 1}` },
      }),
    );
  }
  return axis;
}

function renderWeekdayAxis(grid: CalendarGrid): HTMLElement {
  const axis = el('div', { className: 'ch-weekdays', attrs: { 'aria-hidden': 'true' } });
  for (const weekday of grid.weekdayOrder) {
    axis.appendChild(
      el('span', {
        className: 'ch-weekdays__label',
        text: LABELLED_WEEKDAYS.has(weekday) ? weekdayShortName(weekday) : '',
      }),
    );
  }
  return axis;
}

/**
 * Legend. Each swatch is labelled with the count band it represents, so the
 * scale is readable without relying on colour discrimination.
 */
function renderLegend(thresholds: IntensityThresholds, usePatterns: boolean): HTMLElement {
  const bands = describeLevels(thresholds);

  const swatches = bands.map((band, level) =>
    el('span', {
      className: 'ch-legend__swatch',
      dataset: { level },
      attrs: { title: `${band} commits`, 'aria-hidden': 'true' },
    }),
  );

  return el(
    'div',
    { className: 'ch-legend', dataset: { patterns: usePatterns ? 'on' : 'off' } },
    [
      el('span', { className: 'ch-legend__caption', text: 'Less' }),
      el('span', { className: 'ch-legend__scale' }, swatches),
      el('span', { className: 'ch-legend__caption', text: 'More' }),
      el('span', {
        className: 'ch-legend__bands',
        text: bands.map((band, level) => (level === 0 ? `${band}` : band)).join(' · '),
        attrs: { 'aria-label': `Intensity bands, commits per day: ${bands.join(', ')}` },
      }),
    ],
  );
}

function showTooltip(tooltip: HTMLElement, anchor: HTMLElement, cell: CalendarCell): void {
  const lines = tooltipLines(cell);
  if (lines.length === 0) {
    return;
  }

  replaceChildren(
    tooltip,
    lines.map((line, index) =>
      el('span', {
        className: index === 0 ? 'ch-tooltip__title' : 'ch-tooltip__line',
        text: line,
      }),
    ),
  );

  tooltip.hidden = false;

  const anchorBox = anchor.getBoundingClientRect();
  const parentBox = (tooltip.offsetParent ?? tooltip.parentElement)?.getBoundingClientRect();
  if (!parentBox) {
    return;
  }

  const tooltipWidth = tooltip.offsetWidth;
  const centred = anchorBox.left - parentBox.left + anchorBox.width / 2 - tooltipWidth / 2;
  const maxLeft = parentBox.width - tooltipWidth - 4;

  tooltip.style.left = `${Math.round(Math.min(Math.max(centred, 4), Math.max(maxLeft, 4)))}px`;
  tooltip.style.top = `${Math.round(anchorBox.top - parentBox.top - tooltip.offsetHeight - 8)}px`;
}

function hideTooltip(tooltip: HTMLElement): void {
  tooltip.hidden = true;
}

/**
 * Roving tabindex over the day cells.
 *
 * Positions are collapsed to a single chronological index (`column * 7 + row`),
 * which makes every movement a simple offset: one day is +/-1, one week is
 * +/-7, a page is +/-28. Padding slots outside the range are skipped by
 * continuing in the same direction, so the first and last weeks need no special
 * handling.
 */
function attachKeyboardNavigation(
  gridElement: HTMLElement,
  cells: readonly HTMLButtonElement[],
  totalWeeks: number,
): void {
  if (cells.length === 0) {
    return;
  }

  const totalSlots = totalWeeks * 7;
  const byIndex = new Map<number, HTMLButtonElement>();

  for (const cell of cells) {
    const index = slotIndexOf(cell);
    if (index !== null) {
      byIndex.set(index, cell);
    }
  }

  const ordered = [...byIndex.keys()].sort((a, b) => a - b);
  const firstIndex = ordered[0];
  const lastIndex = ordered[ordered.length - 1];
  if (firstIndex === undefined || lastIndex === undefined) {
    return;
  }

  let active = byIndex.get(lastIndex) as HTMLButtonElement;
  active.tabIndex = 0;

  const focusCell = (next: HTMLButtonElement | undefined): void => {
    if (!next || next === active) {
      return;
    }
    active.tabIndex = -1;
    next.tabIndex = 0;
    active = next;
    next.focus();
  };

  /** First real day at or beyond `from`, moving by `step` each time. */
  const seek = (from: number, step: number): HTMLButtonElement | undefined => {
    if (step === 0) {
      return undefined;
    }
    for (let index = from; index >= 0 && index < totalSlots; index += step) {
      const candidate = byIndex.get(index);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  };

  gridElement.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('ch-cell')) {
      return;
    }
    const current = slotIndexOf(target);
    if (current === null) {
      return;
    }

    let next: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowUp':
        next = seek(current - 1, -1);
        break;
      case 'ArrowDown':
        next = seek(current + 1, 1);
        break;
      case 'ArrowLeft':
        next = seek(current - 7, -1);
        break;
      case 'ArrowRight':
        next = seek(current + 7, 1);
        break;
      case 'PageUp':
        next = seek(current - 28, -1) ?? byIndex.get(firstIndex);
        break;
      case 'PageDown':
        next = seek(current + 28, 1) ?? byIndex.get(lastIndex);
        break;
      case 'Home':
        next = byIndex.get(firstIndex);
        break;
      case 'End':
        next = byIndex.get(lastIndex);
        break;
      default:
        return;
    }

    event.preventDefault();
    focusCell(next);
  });
}

/** Chronological slot index of a cell, or `null` if it is not positioned. */
function slotIndexOf(cell: HTMLElement): number | null {
  const rowAttribute = cell.closest('[aria-rowindex]')?.getAttribute('aria-rowindex');
  const columnAttribute = cell.getAttribute('aria-colindex');
  if (!rowAttribute || !columnAttribute) {
    return null;
  }
  const row = Number(rowAttribute) - 1;
  const column = Number(columnAttribute) - 1;
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) {
    return null;
  }
  return column * 7 + row;
}
