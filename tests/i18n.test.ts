import { beforeEach, describe, expect, it } from 'vitest';
import catalogJson from '../public/_locales/en/messages.json' with { type: 'json' };
import { t } from '../src/ui/i18n';
import { installChromeMock } from './chrome-mock';

const catalog = catalogJson as Record<string, { message: string; description?: string }>;
const sources = import.meta.glob<string>(['../src/**/*.ts', '../src/**/*.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const tsFiles = Object.entries(sources).filter(([f]) => f.endsWith('.ts'));

/** Keys the source uses. Only literal keys count, so dynamic keys (t(`x_${y}`)) are not allowed. */
function usedKeys(): Map<string, string> {
  const used = new Map<string, string>();
  for (const [file, src] of Object.entries(sources)) {
    const patterns = file.endsWith('.html')
      ? [/data-i18n(?:-title|-aria-label)?="([^"]+)"/g, /__MSG_(\w+)__/g]
      : [/\bt\(\s*'([^']+)'/g, /__MSG_(\w+)__/g];
    for (const re of patterns) for (const m of src.matchAll(re)) used.set(m[1]!, file);
  }
  return used;
}

beforeEach(() => {
  installChromeMock();
});

describe('i18n catalog', () => {
  it('has every key the code uses', () => {
    const missing = [...usedKeys()].filter(([k]) => !(k in catalog)).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });

  it('has no unused keys', () => {
    const used = usedKeys();
    expect(Object.keys(catalog).filter((k) => !used.has(k))).toEqual([]);
  });

  it('uses only valid key names and no raw $ (chrome.i18n treats $ as a placeholder)', () => {
    for (const [k, v] of Object.entries(catalog)) {
      expect(k, k).toMatch(/^[A-Za-z0-9_]+$/);
      expect(v.message, k).not.toMatch(/\$/);
    }
  });

  it('never uses dynamic keys', () => {
    const bad = tsFiles.filter(([, src]) => /\bt\(\s*[`"]/.test(src)).map(([f]) => f);
    expect(bad).toEqual([]);
  });
});

describe('t', () => {
  it('fills named placeholders and leaves unknown ones', () => {
    expect(t('error_notSaved', { site: 'Claude' })).toBe(
      "The Claude account you're logged in with isn't saved. Save it first so it isn't lost.",
    );
    expect(t('error_notSaved')).toContain('{site}');
  });

  it('returns the key when a message is missing', () => {
    expect(t('does_not_exist')).toBe('does_not_exist');
  });
});
