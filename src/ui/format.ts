/**
 * Display formatting. Locale-aware where it helps, deterministic where the
 * value is a label rather than prose.
 */

const integerFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "1,284" */
export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return integerFormatter.format(Math.round(value));
}

/** "7.3" */
export function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    return '0.0';
  }
  return decimalFormatter.format(value);
}

/** Singular/plural helper: `pluralize(1, 'commit')` gives "1 commit". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}

/** "14:32" in the viewer's locale. */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "25 Aug 2026, 14:32" in the viewer's locale. */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3 days ago" / "just now". Falls back to an absolute date beyond a month. */
export function formatRelative(timestamp: number, now: number = Date.now()): string {
  const deltaMs = now - timestamp;
  if (!Number.isFinite(deltaMs)) {
    return '';
  }
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 31) {
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Truncates long text for single-line display, preserving whole words. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const slice = value.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
