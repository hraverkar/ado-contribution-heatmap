/**
 * Theme integration.
 *
 * `SDK.init({ applyTheme: true })` makes the host inject its palette as CSS
 * custom properties (`--background-color`, `--text-primary-color`, the
 * `--palette-*` ramp, and so on) and re-inject them whenever the user switches
 * themes. The stylesheet consumes those variables directly, so chrome follows
 * Azure DevOps automatically.
 *
 * The heatmap ramp is the one thing the host does not provide, because Azure
 * DevOps has no contribution-calendar palette. This module therefore only has
 * to answer one question — is the current theme light or dark — which it does
 * by measuring the luminance of the host's own background colour rather than by
 * guessing from a theme name. The answer lands on `<html data-theme>`, and the
 * stylesheet defines both ramps.
 */

const DARK_LUMINANCE_THRESHOLD = 0.4;

export type ThemeMode = 'light' | 'dark';

/** Parses `#rgb`, `#rrggbb`, `rgb()` and `rgba()` into 0-255 channels. */
export function parseColor(value: string): [number, number, number] | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1] as string;
    if (hex.length === 3) {
      const r = hex[0] as string;
      const g = hex[1] as string;
      const b = hex[2] as string;
      return [
        Number.parseInt(`${r}${r}`, 16),
        Number.parseInt(`${g}${g}`, 16),
        Number.parseInt(`${b}${b}`, 16),
      ];
    }
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }

  const rgbMatch = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(trimmed);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }

  return null;
}

/** Relative luminance in the 0-1 range, per WCAG's sRGB formula. */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const channels = rgb.map((channel) => {
    const normalized = Math.min(Math.max(channel, 0), 255) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Classifies a background colour string as a light or dark theme. */
export function themeModeForBackground(background: string): ThemeMode {
  const rgb = parseColor(background);
  if (!rgb) {
    return 'light';
  }
  return relativeLuminance(rgb) < DARK_LUMINANCE_THRESHOLD ? 'dark' : 'light';
}

function currentBackground(): string {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const themed = styles.getPropertyValue('--background-color').trim();
  if (themed) {
    return themed;
  }
  const bodyBackground = getComputedStyle(document.body).backgroundColor;
  return bodyBackground || '#ffffff';
}

/** Reads the host theme and records it on `<html data-theme>`. */
export function applyThemeMode(): ThemeMode {
  const mode = themeModeForBackground(currentBackground());
  document.documentElement.setAttribute('data-theme', mode);
  return mode;
}

/**
 * Keeps `data-theme` in sync with the host.
 *
 * The SDK dispatches `themeApplied` on every theme change; the `prefers-color-scheme`
 * listener is a safety net for hosts that do not.
 */
export function watchTheme(onChange?: (mode: ThemeMode) => void): void {
  const update = (): void => {
    const mode = applyThemeMode();
    onChange?.(mode);
  };

  update();
  window.addEventListener('themeApplied', update);

  if (typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
    }
  }
}
