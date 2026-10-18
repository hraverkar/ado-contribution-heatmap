/**
 * Author-alias settings.
 *
 * Azure DevOps knows the user's profile identity; Git knows whatever
 * `user.email` was configured on each machine. When those differ, commits go
 * unattributed. This panel is where a user reconciles the two by adding the
 * names or email addresses they actually commit under.
 *
 * Aliases are plain strings stored in the browser's local storage. They are not
 * credentials, and adding one grants no additional access: it only widens which
 * *already readable* commits are counted as the viewer's own.
 */

import type { IdentitySet } from '../models/user.js';
import { button, el } from './dom.js';

export interface SettingsValues {
  readonly customAliases: readonly string[];
  readonly matchEmailLocalPart: boolean;
  readonly deepScan: boolean;
}

export interface SettingsPanelOptions {
  readonly identity: IdentitySet;
  readonly values: SettingsValues;
  readonly onApply: (values: SettingsValues) => void;
  readonly onCancel: () => void;
}

/** Splits a textarea's contents into trimmed, de-duplicated aliases. */
export function parseAliases(raw: string): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const line of raw.split(/[\n,]/)) {
    const alias = line.trim();
    if (alias.length === 0) {
      continue;
    }
    const key = alias.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    aliases.push(alias);
  }
  return aliases.slice(0, 10);
}

/** Renders the settings form. */
export function renderSettingsPanel(options: SettingsPanelOptions): HTMLElement {
  const { identity, values, onApply, onCancel } = options;

  const detected = el('div', { className: 'ch-settings__detected' }, [
    el('p', { className: 'ch-settings__label', text: 'Detected from your Azure DevOps profile' }),
    el(
      'ul',
      { className: 'ch-settings__aliases' },
      identity.queryAliases
        .filter((alias) => !values.customAliases.includes(alias))
        .map((alias) => el('li', { text: alias })),
    ),
  ]);

  const textarea = el('textarea', {
    className: 'ch-textarea',
    attrs: {
      id: 'ch-aliases',
      rows: '4',
      spellcheck: 'false',
      placeholder: 'me@example.com\nMy Other Name',
      'aria-describedby': 'ch-aliases-help',
    },
  });
  textarea.value = values.customAliases.join('\n');

  const localPartInput = el('input', {
    className: 'ch-checkbox',
    attrs: { id: 'ch-local-part', type: 'checkbox' },
  });
  localPartInput.checked = values.matchEmailLocalPart;

  const deepScanInput = el('input', {
    className: 'ch-checkbox',
    attrs: { id: 'ch-deep-scan', type: 'checkbox' },
  });
  deepScanInput.checked = values.deepScan;

  const form = el('form', { className: 'ch-settings' });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onApply({
      customAliases: parseAliases(textarea.value),
      matchEmailLocalPart: localPartInput.checked,
      deepScan: deepScanInput.checked,
    });
  });

  form.appendChild(detected);

  form.appendChild(
    el('div', { className: 'ch-settings__field' }, [
      el('label', {
        className: 'ch-settings__label',
        text: 'Additional author names or emails',
        attrs: { for: 'ch-aliases' },
      }),
      textarea,
      el('p', {
        className: 'ch-settings__help',
        text: 'One per line. Use this when your Git user.email differs from your Azure DevOps sign-in.',
        attrs: { id: 'ch-aliases-help' },
      }),
    ]),
  );

  form.appendChild(
    checkboxRow(
      localPartInput,
      'ch-local-part',
      'Match any domain for these addresses',
      'Treats me@corp.com and me@corp.onmicrosoft.com as the same person. Looser, so it is off by default.',
    ),
  );

  form.appendChild(
    checkboxRow(
      deepScanInput,
      'ch-deep-scan',
      'Deep scan (ignore server-side author filter)',
      'Reads every commit in range and matches locally. Far more requests — use only when aliases alone miss your commits.',
    ),
  );

  form.appendChild(
    el('div', { className: 'ch-settings__actions' }, [
      button('Cancel', { className: 'ch-button', onClick: onCancel }),
      el('button', { className: 'ch-button ch-button--primary', attrs: { type: 'submit' } }, [
        'Apply and refresh',
      ]),
    ]),
  );

  return form;
}

function checkboxRow(
  input: HTMLInputElement,
  id: string,
  label: string,
  help: string,
): HTMLElement {
  return el('div', { className: 'ch-settings__field ch-settings__field--inline' }, [
    el('div', { className: 'ch-toggle' }, [
      input,
      el('label', { className: 'ch-toggle__label', text: label, attrs: { for: id } }),
    ]),
    el('p', { className: 'ch-settings__help', text: help }),
  ]);
}
