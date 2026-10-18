/** Inclusive range of local calendar days, both `YYYY-MM-DD`. */
export interface DateRange {
  readonly start: string;
  readonly end: string;
}

export type DateRangePresetId =
  | 'last-30'
  | 'last-90'
  | 'last-180'
  | 'last-365'
  | 'current-year'
  | 'custom';

export interface DateRangePreset {
  readonly id: DateRangePresetId;
  readonly label: string;
}

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  { id: 'last-30', label: 'Last 30 days' },
  { id: 'last-90', label: 'Last 90 days' },
  { id: 'last-180', label: 'Last 180 days' },
  { id: 'last-365', label: 'Last 365 days' },
  { id: 'current-year', label: 'Current year' },
  { id: 'custom', label: 'Custom range' },
];
