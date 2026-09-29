// `never` param lets typed handlers like (e: KeyboardEvent) => void be passed without casts.
type Handler = (e: never) => void;
export type PropValue = string | number | boolean | Handler | undefined | null;
export type Child = Node | string | null | false | undefined;

/**
 * Builds DOM without innerHTML so account data can never be parsed as markup.
 * Props starting with "on" become event listeners; true/false toggle boolean attributes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, PropValue> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c) el.append(c);
  return el;
}
