/**
 * User preferences.
 *
 * Stored in `localStorage` under a single namespaced key. This holds display
 * choices and author aliases only — never tokens, never Azure DevOps content.
 * Every read is validated and falls back to defaults, so a corrupt or
 * hand-edited value cannot break the page. Storage being unavailable (private
 * browsing, blocked site data) is a normal, handled state.
 */

import { PREFERENCES_STORAGE_KEY } from '../config/constants.js';
import type { DateRange, DateRangePresetId } from '../models/dateRange.js';
import { DATE_RANGE_PRESETS } from '../models/dateRange.js';
import type { RepositorySort, RepositorySortColumn, SortDirection } from './repositoryStatsService.js';
import { isValidDayKey } from '../util/dates.js';

export type ScopeKind = 'project' | 'organization';

export interface Preferences {
  readonly scope: ScopeKind;
  readonly presetId: DateRangePresetId;
  readonly customRange: DateRange | null;
  readonly weekStartsOn: number;
  /** Adds texture to higher intensity levels for non-colour differentiation. */
  readonly usePatterns: boolean;
  readonly customAliases: readonly string[];
  readonly matchEmailLocalPart: boolean;
  readonly deepScan: boolean;
  readonly sort: RepositorySort;
}

export const DEFAULT_PREFERENCES: Preferences = {
  scope: 'project',
  presetId: 'last-365',
  customRange: null,
  weekStartsOn: 0,
  usePatterns: false,
  customAliases: [],
  matchEmailLocalPart: false,
  deepScan: false,
  sort: { column: 'count', direction: 'desc' },
};

const VALID_PRESETS = new Set<string>(DATE_RANGE_PRESETS.map((preset) => preset.id));
const VALID_SORT_COLUMNS = new Set<string>(['name', 'count', 'activeDays', 'lastActivity']);

/** Coerces an arbitrary parsed value into a valid {@link Preferences}. */
export function normalizePreferences(input: unknown): Preferences {
  if (typeof input !== 'object' || input === null) {
    return DEFAULT_PREFERENCES;
  }
  const raw = input as Record<string, unknown>;

  const customRange =
    typeof raw.customRange === 'object' && raw.customRange !== null
      ? (raw.customRange as Record<string, unknown>)
      : null;

  const sort =
    typeof raw.sort === 'object' && raw.sort !== null ? (raw.sort as Record<string, unknown>) : {};

  return {
    scope: raw.scope === 'organization' ? 'organization' : 'project',
    presetId: VALID_PRESETS.has(raw.presetId as string)
      ? (raw.presetId as DateRangePresetId)
      : DEFAULT_PREFERENCES.presetId,
    customRange:
      customRange && isValidDayKey(customRange.start) && isValidDayKey(customRange.end)
        ? { start: customRange.start as string, end: customRange.end as string }
        : null,
    weekStartsOn: raw.weekStartsOn === 1 ? 1 : 0,
    usePatterns: raw.usePatterns === true,
    customAliases: Array.isArray(raw.customAliases)
      ? raw.customAliases
          .filter((alias): alias is string => typeof alias === 'string')
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0)
          .slice(0, 10)
      : [],
    matchEmailLocalPart: raw.matchEmailLocalPart === true,
    deepScan: raw.deepScan === true,
    sort: {
      column: VALID_SORT_COLUMNS.has(sort.column as string)
        ? (sort.column as RepositorySortColumn)
        : DEFAULT_PREFERENCES.sort.column,
      direction: sort.direction === 'asc' ? ('asc' as SortDirection) : ('desc' as SortDirection),
    },
  };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPreferences(): Preferences {
  const store = storage();
  if (!store) {
    return DEFAULT_PREFERENCES;
  }
  try {
    const raw = store.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFERENCES;
    }
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(preferences: Preferences): void {
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Quota or private-mode failures are non-fatal; preferences simply do not persist.
  }
}
