import { h } from './dom';

export const SWITCH_COMMAND = 'switch-next';
export const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts';

/** The user's current key for "switch to next", or '' when none is set. */
export async function getShortcut(): Promise<string> {
  const commands = await chrome.commands.getAll();
  return commands.find((c) => c.name === SWITCH_COMMAND)?.shortcut ?? '';
}

/** "Alt+Shift+S" → [Alt, Shift, S]; macOS "⌥⇧S" → [⌥, ⇧, S]. */
export function shortcutKeys(shortcut: string): string[] {
  if (!shortcut) return [];
  if (shortcut.includes('+')) return shortcut.split('+').filter(Boolean);
  const mods = shortcut.match(/^[⌘⌥⇧⌃]*/)![0];
  return [...mods, shortcut.slice(mods.length)].filter(Boolean);
}

/** Keycap elements for a shortcut string (styled by .kbd in theme.css). */
export function keycaps(shortcut: string): HTMLElement {
  return h('span', { class: 'kbds' }, ...shortcutKeys(shortcut).map((k) => h('kbd', { class: 'kbd' }, k)));
}
