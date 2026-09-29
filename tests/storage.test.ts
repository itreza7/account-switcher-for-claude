import { beforeEach, describe, expect, it } from 'vitest';
import { getAccount, loadState, mutate, toView } from '../src/core/storage';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../src/core/types';
import type { Account } from '../src/core/types';
import { installChromeMock, makeCookie } from './chrome-mock';

let mock: ReturnType<typeof installChromeMock>;

function makeAccount(id: string): Account {
  return {
    id,
    siteId: 'claude',
    label: id,
    identity: { key: id },
    cookies: [makeCookie({ name: 'sessionKey', domain: '.claude.ai' })],
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  mock = installChromeMock();
});

describe('loadState', () => {
  it('returns defaults when nothing is stored', async () => {
    const s = await loadState();
    expect(s).toEqual({
      schemaVersion: SCHEMA_VERSION,
      accounts: [],
      active: {},
      usage: {},
      settings: DEFAULT_SETTINGS,
      autoSwitch: { lastActionAt: null },
    });
  });

  it('merges settings field by field and fills missing top-level fields', async () => {
    mock.state.storage.state = { schemaVersion: 1, settings: { threshold: 70 }, accounts: [makeAccount('a')] };
    const s = await loadState();
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, threshold: 70 });
    expect(s.accounts).toHaveLength(1);
    expect(s.active).toEqual({});
    expect(s.usage).toEqual({});
    expect(s.autoSwitch.lastActionAt).toBeNull();
  });

  it('reads and writes only local storage under one key', async () => {
    await mutate((d) => {
      d.accounts.push(makeAccount('a'));
    });
    expect(Object.keys(mock.state.storage)).toEqual(['state']);
  });
});

describe('mutate', () => {
  it('persists changes and returns the callback result', async () => {
    const r = await mutate((d) => {
      d.active.claude = 'x';
      return 42;
    });
    expect(r).toBe(42);
    expect((await loadState()).active.claude).toBe('x');
  });

  it('serializes concurrent read-modify-write calls', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        mutate(async (d) => {
          const n = d.accounts.length;
          await new Promise((r) => setTimeout(r, 5 - (i % 5)));
          d.accounts.push(makeAccount(`a${n}`));
        }),
      ),
    );
    const ids = (await loadState()).accounts.map((a) => a.id);
    expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => `a${i}`));
  });

  it('does not save when the callback throws, and keeps the queue alive', async () => {
    await expect(
      mutate((d) => {
        d.accounts.push(makeAccount('bad'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await loadState()).accounts).toEqual([]);
    await mutate((d) => {
      d.active.claude = 'ok';
    });
    expect((await loadState()).active.claude).toBe('ok');
  });
});

describe('getAccount / toView', () => {
  it('finds accounts by id', async () => {
    await mutate((d) => {
      d.accounts.push(makeAccount('a'));
    });
    expect((await getAccount('a'))?.id).toBe('a');
    expect(await getAccount('nope')).toBeUndefined();
  });

  it('toView strips cookies', () => {
    const v = toView(makeAccount('a'));
    expect('cookies' in v).toBe(false);
    expect(v.id).toBe('a');
  });
});
