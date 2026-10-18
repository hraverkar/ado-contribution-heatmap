/**
 * Filter toolbar: scope, repository, date range, and the refresh action.
 *
 * The toolbar is a pure view over {@link ToolbarState}. It reports intent
 * through callbacks and never mutates state itself, so the app controller stays
 * the single place that decides whether a change needs new data or only a
 * recalculation of what is already cached.
 */

import type { DateRange, DateRangePresetId } from '../models/dateRange.js';
import { DATE_RANGE_PRESETS } from '../models/dateRange.js';
import type { Repository } from '../models/repository.js';
import type { CurrentUser } from '../models/user.js';
import type { ScopeKind } from '../services/preferencesService.js';
import { formatDayMedium, isValidDayKey, todayKey } from '../util/dates.js';
import { MAX_CUSTOM_RANGE_DAYS, MIN_SUPPORTED_DAY } from '../config/constants.js';
import { button, el, field, select } from './dom.js';

export interface ToolbarState {
  readonly scope: ScopeKind;
  readonly hasProject: boolean;
  readonly projectName: string | null;
  readonly repositories: readonly Repository[];
  readonly members: readonly CurrentUser[];
  readonly selectedMemberIds: readonly string[];
  readonly membersLoading: boolean;
  readonly membersError: string | null;
  readonly selectedRepositoryId: string | null;
  readonly presetId: DateRangePresetId;
  readonly customRange: DateRange | null;
  readonly resolvedRange: DateRange;
  readonly usePatterns: boolean;
  /** True when the requested custom range had to be clamped to drawable bounds. */
  readonly rangeAdjusted: boolean;
  readonly busy: boolean;
}

export interface ToolbarCallbacks {
  readonly onScopeChange: (scope: ScopeKind) => void;
  readonly onRepositoryChange: (repositoryId: string | null) => void;
  readonly onMembersChange: (memberIds: readonly string[]) => void;
  readonly onPresetChange: (preset: DateRangePresetId) => void;
  readonly onCustomRangeChange: (range: DateRange) => void;
  readonly onPatternsChange: (usePatterns: boolean) => void;
  readonly onRefresh: () => void;
  readonly onOpenSettings: () => void;
}

export const ALL_REPOSITORIES_VALUE = '__all__';

/** Builds the repository dropdown options, grouped label-wise by project. */
export function repositoryOptions(
  repositories: readonly Repository[],
): { value: string; label: string }[] {
  const projectCount = new Set(repositories.map((repository) => repository.projectName)).size;

  const options = repositories.map((repository) => ({
    value: repository.id,
    label:
      projectCount > 1 && repository.projectName
        ? `${repository.projectName} / ${repository.name}`
        : repository.name,
  }));

  return [{ value: ALL_REPOSITORIES_VALUE, label: 'All repositories' }, ...options];
}

/** Renders the toolbar. */
export function renderToolbar(state: ToolbarState, callbacks: ToolbarCallbacks): HTMLElement {
  const root = el('div', {
    className: 'ch-toolbar',
    attrs: { role: 'group', 'aria-label': 'Filters' },
  });

  root.appendChild(renderScopeField(state, callbacks));
  root.appendChild(renderRepositoryField(state, callbacks));
  root.appendChild(renderMemberField(state, callbacks));
  root.appendChild(renderRangeField(state, callbacks));

  if (state.presetId === 'custom') {
    root.appendChild(renderCustomRangeFields(state, callbacks));
  }

  function renderMemberField(state: ToolbarState, callbacks: ToolbarCallbacks): HTMLElement {
    const selected = new Set(state.selectedMemberIds);
    const dropdown = el('details', {
      className: 'ch-members',
      attrs: { id: 'ch-members-dropdown' },
    });
    const label = selected.size === 1 ? '1 contributor' : `${selected.size} contributors`;
    dropdown.appendChild(
      el('summary', {
        className: 'ch-button ch-members__trigger',
        text: label,
        attrs: {
          'aria-label': `${label} selected. Choose contributors`,
          'aria-controls': 'ch-members-options',
          title: 'Choose one or more project contributors to compare',
        },
      }),
    );

    const options = el('div', {
      className: 'ch-members__options',
      attrs: { id: 'ch-members-options', role: 'group', 'aria-label': 'Project contributors' },
    });

    if (state.membersLoading) {
      options.appendChild(el('p', { className: 'ch-field__hint', text: 'Loading project members…' }));
    } else if (state.members.length === 0) {
      options.appendChild(el('p', { className: 'ch-field__hint', text: 'No project members found.' }));
    } else {
      for (const member of state.members) {
        const id = `ch-member-${encodeURIComponent(member.id)}`;
        const checkbox = el('input', {
          className: 'ch-checkbox',
          attrs: { id, type: 'checkbox', value: member.id },
        });
        checkbox.checked = selected.has(member.id);
        checkbox.disabled = !state.hasProject || state.membersLoading;
        checkbox.addEventListener('change', () => {
          const next = new Set(state.selectedMemberIds);
          if (checkbox.checked) {
            next.add(member.id);
          } else {
            next.delete(member.id);
          }
          callbacks.onMembersChange([...next]);
        });
        options.appendChild(
          el('label', { className: 'ch-members__option', attrs: { for: id } }, [
            checkbox,
            el('span', {
              className: 'ch-members__name',
              text: member.displayName || member.uniqueName || member.id,
              title: member.uniqueName && member.uniqueName !== member.displayName ? member.uniqueName : undefined,
            }),
          ]),
        );
      }
    }

    if (!state.hasProject) {
      options.appendChild(
        el('p', { className: 'ch-field__hint', text: 'Open a project to choose its contributors.' }),
      );
    } else if (state.membersError) {
      options.appendChild(
        el('p', { className: 'ch-field__hint ch-field__hint--warning', text: state.membersError }),
      );
      options.appendChild(
        button('Retry member list', {
          className: 'ch-button ch-button--subtle',
          onClick: callbacks.onRefresh,
        }),
      );
    } else if (!state.membersLoading) {
      options.appendChild(
        el('p', {
          className: 'ch-field__hint',
          text: 'Choose multiple people to compare their calendars.',
        }),
      );
    }

    dropdown.appendChild(options);
    return el('div', { className: 'ch-field ch-members-field' }, [
      el('span', { className: 'ch-field__label', text: 'Contributors' }),
      dropdown,
    ]);
  }

  root.appendChild(el('div', { className: 'ch-toolbar__spacer' }));
  root.appendChild(renderPatternToggle(state, callbacks));

  const settingsButton = button('Author aliases', {
    className: 'ch-button',
    onClick: callbacks.onOpenSettings,
    attrs: { 'aria-haspopup': 'dialog' },
  });
  root.appendChild(settingsButton);

  const refreshButton = button(state.busy ? 'Refreshing…' : 'Refresh', {
    className: 'ch-button ch-button--primary',
    onClick: callbacks.onRefresh,
    attrs: { 'aria-label': 'Refresh contribution data from Azure DevOps' },
  });
  refreshButton.disabled = state.busy;
  root.appendChild(refreshButton);

  return root;
}

function renderScopeField(state: ToolbarState, callbacks: ToolbarCallbacks): HTMLElement {
  const options = [
    {
      value: 'project',
      label: state.projectName ? `This project (${state.projectName})` : 'This project',
    },
    { value: 'organization', label: 'All projects' },
  ];

  const control = select('ch-scope', options, state.scope, (value) => {
    callbacks.onScopeChange(value === 'organization' ? 'organization' : 'project');
  });
  control.disabled = state.busy || !state.hasProject;

  const wrapper = field('Scope', control, 'ch-scope');
  if (!state.hasProject) {
    wrapper.appendChild(
      el('span', {
        className: 'ch-field__hint',
        text: 'No project context — showing the whole organization.',
      }),
    );
  }
  return wrapper;
}

function renderRepositoryField(state: ToolbarState, callbacks: ToolbarCallbacks): HTMLElement {
  const control = select(
    'ch-repository',
    repositoryOptions(state.repositories),
    state.selectedRepositoryId ?? ALL_REPOSITORIES_VALUE,
    (value) => callbacks.onRepositoryChange(value === ALL_REPOSITORIES_VALUE ? null : value),
  );
  control.disabled = state.busy || state.repositories.length === 0;
  return field('Repository', control, 'ch-repository');
}

function renderRangeField(state: ToolbarState, callbacks: ToolbarCallbacks): HTMLElement {
  const control = select(
    'ch-range',
    DATE_RANGE_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
    state.presetId,
    (value) => callbacks.onPresetChange(value as DateRangePresetId),
  );
  control.disabled = state.busy;
  return field('Date range', control, 'ch-range');
}

/**
 * Custom range inputs.
 *
 * A `<input type="date">` will hand back any well-formed date the user types,
 * including years like 1000 or 9999, and `min`/`max` alone do not stop that —
 * they only set validity flags. So the value is clamped in code as well, and
 * the user is told when their input was adjusted rather than silently ignored.
 *
 * A change is only reported once both ends parse, so a half-typed date never
 * triggers a scan.
 */
function renderCustomRangeFields(
  state: ToolbarState,
  callbacks: ToolbarCallbacks,
): HTMLElement {
  const today = todayKey();
  // `resolvedRange` is what the calendar is actually drawing, already clamped.
  // Showing the raw stored value here would let the inputs disagree with the grid.
  const current = state.resolvedRange;

  const startInput = el('input', {
    className: 'ch-input',
    attrs: {
      id: 'ch-range-start',
      type: 'date',
      value: current.start,
      min: MIN_SUPPORTED_DAY,
      max: today,
      'aria-label': 'Start date',
    },
  });

  const endInput = el('input', {
    className: 'ch-input',
    attrs: {
      id: 'ch-range-end',
      type: 'date',
      value: current.end,
      min: MIN_SUPPORTED_DAY,
      max: today,
      'aria-label': 'End date',
    },
  });

  const emit = (): void => {
    const start = startInput.value;
    const end = endInput.value;
    if (!isValidDayKey(start) || !isValidDayKey(end)) {
      return;
    }

    // Report the raw request; the controller clamps, records that it did, and
    // re-renders. Mutating the inputs here would be undone by that re-render.
    callbacks.onCustomRangeChange({ start, end });
  };

  startInput.addEventListener('change', emit);
  endInput.addEventListener('change', emit);
  startInput.disabled = state.busy;
  endInput.disabled = state.busy;

  return el('div', { className: 'ch-toolbar__custom' }, [
    field('From', startInput, 'ch-range-start'),
    field('To', endInput, 'ch-range-end'),
    state.rangeAdjusted ? el('p', { className: 'ch-field__hint ch-field__hint--warning', text: adjustmentMessage(current), attrs: { role: 'status' } }) : null,
  ]);
}

/**
 * Pattern toggle.
 *
 * Adds a texture to each intensity level so the scale stays distinguishable
 * without relying on the green ramp.
 */
function renderPatternToggle(state: ToolbarState, callbacks: ToolbarCallbacks): HTMLElement {
  const input = el('input', {
    className: 'ch-checkbox',
    attrs: { id: 'ch-patterns', type: 'checkbox' },
  });
  input.checked = state.usePatterns;
  input.addEventListener('change', () => callbacks.onPatternsChange(input.checked));

  return el('div', { className: 'ch-toggle' }, [
    input,
    el('label', {
      className: 'ch-toggle__label',
      text: 'Patterns',
      attrs: { for: 'ch-patterns', title: 'Add texture to each intensity level' },
    }),
  ]);
}

/** Explains what the entered range was changed to, and why. */
function adjustmentMessage(effective: DateRange): string {
  return (
    `Adjusted to ${formatDayMedium(effective.start)} – ${formatDayMedium(effective.end)}. ` +
    `Ranges must fall between ${formatDayMedium(MIN_SUPPORTED_DAY)} and today, ` +
    `and cover at most ${MAX_CUSTOM_RANGE_DAYS} days.`
  );
}
