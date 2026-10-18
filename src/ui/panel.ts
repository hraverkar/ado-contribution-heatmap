/**
 * Reusable slide-over panel.
 *
 * Rendered inside the extension iframe rather than through the host's panel
 * service, because a host panel would need its own contribution and a second
 * document — and the data it shows already lives in this frame.
 *
 * Behaves as a modal dialog: focus moves in on open, Tab is trapped inside,
 * Escape closes, and focus returns to whatever opened it.
 */

import { button, clear, el } from './dom.js';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface PanelHandle {
  /** Removes the panel and restores focus. */
  close(): void;
  readonly element: HTMLElement;
}

export interface PanelOptions {
  readonly title: string;
  readonly description?: string;
  readonly content: HTMLElement;
  readonly host: HTMLElement;
  readonly onClose?: () => void;
}

/** Opens a panel inside `host`, replacing any panel already there. */
export function openPanel(options: PanelOptions): PanelHandle {
  const previouslyFocused = document.activeElement;
  clear(options.host);

  const titleId = 'ch-panel-title';
  const descriptionId = 'ch-panel-description';

  const closeButton = button('Close', {
    className: 'ch-panel__close',
    attrs: { 'aria-label': 'Close panel' },
  });

  const panel = el(
    'div',
    {
      className: 'ch-panel',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        ...(options.description ? { 'aria-describedby': descriptionId } : {}),
      },
    },
    [
      el('header', { className: 'ch-panel__header' }, [
        el('div', {}, [
          el('h2', { className: 'ch-panel__title', text: options.title, attrs: { id: titleId } }),
          options.description
            ? el('p', {
                className: 'ch-panel__description',
                text: options.description,
                attrs: { id: descriptionId },
              })
            : null,
        ]),
        closeButton,
      ]),
      el('div', { className: 'ch-panel__body' }, [options.content]),
    ],
  );

  const backdrop = el('div', { className: 'ch-panel__backdrop', attrs: { 'aria-hidden': 'true' } });

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    clear(options.host);
    options.onClose?.();
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKeyDown, true);

  options.host.appendChild(backdrop);
  options.host.appendChild(panel);

  const initialFocus = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  (initialFocus ?? panel).focus();

  return { close, element: panel };
}
