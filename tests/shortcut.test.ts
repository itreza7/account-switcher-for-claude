import { describe, expect, it } from 'vitest';
import { shortcutKeys } from '../src/ui/shortcut';

describe('shortcutKeys', () => {
  it.each([
    ['Alt+Shift+S', ['Alt', 'Shift', 'S']],
    ['Ctrl+Shift+F5', ['Ctrl', 'Shift', 'F5']],
    ['⌥⇧S', ['⌥', '⇧', 'S']],
    ['⌘⇧F12', ['⌘', '⇧', 'F12']],
    ['', []],
  ])('%s', (input, want) => {
    expect(shortcutKeys(input)).toEqual(want);
  });
});
