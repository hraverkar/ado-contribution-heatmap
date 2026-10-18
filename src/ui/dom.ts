/**
 * Minimal DOM helpers.
 *
 * Everything the extension renders comes from Azure DevOps API data — commit
 * messages, author names, repository names — so nothing is ever assigned
 * through `innerHTML`. These helpers only set `textContent` and attributes,
 * which makes injection through a crafted commit message structurally
 * impossible rather than a thing to remember.
 */

type Falsy = null | undefined | false;
export type Child = Node | string | number | Falsy;

export interface ElementOptions {
  readonly className?: string;
  readonly text?: string | number;
  readonly title?: string;
  readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly dataset?: Readonly<Record<string, string | number | undefined>>;
  readonly on?: Readonly<Partial<Record<keyof HTMLElementEventMap, EventListener>>>;
}

/** Creates an element, applying options and appending children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options.className) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = String(options.text);
  }
  if (options.title !== undefined) {
    element.title = options.title;
  }
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) {
        continue;
      }
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (options.dataset) {
    for (const [name, value] of Object.entries(options.dataset)) {
      if (value === undefined) {
        continue;
      }
      element.dataset[name] = String(value);
    }
  }
  if (options.on) {
    for (const [name, listener] of Object.entries(options.on)) {
      if (listener) {
        element.addEventListener(name, listener as EventListener);
      }
    }
  }

  append(element, children);
  return element;
}

/** Appends children, skipping falsy entries. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Removes every child of a node. */
export function clear(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/** Replaces a node's children in one pass. */
export function replaceChildren(node: Node, children: readonly Child[]): void {
  clear(node);
  append(node, children);
}

/** Looks up a required element, failing loudly during development. */
export function requireElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }
  return element as T;
}

/** Convenience wrapper for an accessible icon-free button. */
export function button(
  label: string,
  options: ElementOptions & { readonly onClick?: (event: MouseEvent) => void } = {},
): HTMLButtonElement {
  const { onClick, ...rest } = options;
  const element = el('button', {
    ...rest,
    text: label,
    attrs: { type: 'button', ...(rest.attrs ?? {}) },
  });
  if (onClick) {
    element.addEventListener('click', onClick as EventListener);
  }
  return element;
}

/** Builds a labelled `<select>` with the given options. */
export function select(
  id: string,
  options: readonly { readonly value: string; readonly label: string }[],
  selectedValue: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const element = el('select', { className: 'ch-select', attrs: { id } });
  for (const option of options) {
    const optionElement = el('option', { text: option.label, attrs: { value: option.value } });
    if (option.value === selectedValue) {
      optionElement.selected = true;
    }
    element.appendChild(optionElement);
  }
  element.addEventListener('change', () => onChange(element.value));
  return element;
}

/** Wraps a control with a visible label. */
export function field(labelText: string, control: HTMLElement, controlId: string): HTMLElement {
  return el('div', { className: 'ch-field' }, [
    el('label', { className: 'ch-field__label', text: labelText, attrs: { for: controlId } }),
    control,
  ]);
}
