import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, StoreState, Usage, UsageEntry } from '../src/core/types';
import { claudeAdapter } from '../src/sites/claude';
import { activeFetch, type SiteFetch } from '../src/sites/site';
import { installChromeMock } from './chrome-mock';

const order: string[] = [];
const withSwitchLock = vi.fn(async <T>(fn: () => Promise<T>) => {
  order.push('lock:start');
  try {
    return await fn();
  } finally {
    order.push('lock:end');
  }
});
const syncLiveSession = vi.fn(async (): Promise<string | null> => null);
vi.mock('../src/core/switcher', () => ({
  withSwitchLock: <T>(fn: () => Promise<T>) => withSwitchLock(fn),
  syncLiveSession: () => syncLiveSession(),
}));

const cookieFetchSentinel = vi.fn(async () => new Response('x')) as unknown as SiteFetch;
const cookieFetch = vi.fn((_c: unknown) => cookieFetchSentinel);
vi.mock('../src/core/fetcher', () => ({ cookieFetch: (c: unknown) => cookieFetch(c) }));

const { refreshUsage } = await import('../src/core/usage');

const u = (n: number): Usage => ({ fiveHour: { utilization: n, resetsAt: null }, sevenDay: null, extra: {}, fetchedAt: 1 });
const acc = (id: string, cookieName = id): Account => ({
  id,
  siteId: 'claude',
  label: id,
  identity: { key: id },
  cookies: [{ name: cookieName } as chrome.cookies.Cookie],
  createdAt: 0,
  updatedAt: 0,
});

let mock: ReturnType<typeof installChromeMock>;
const stored = () => (mock.state.storage.state as StoreState).usage;
const seed = (accounts: Account[], active: string | null, usage: Record<string, UsageEntry> = {}) => {
  mock.state.storage.state = {
    schemaVersion: 1,
    accounts,
    active: { claude: active },
    usage,
    settings: {},
    autoSwitch: { lastActionAt: null },
  };
};

let fetchUsage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mock = installChromeMock();
  order.length = 0;
  withSwitchLock.mockClear();
  cookieFetch.mockClear();
  syncLiveSession.mockReset();
  syncLiveSession.mockResolvedValue(null);
  fetchUsage = vi.fn();
  vi.spyOn(claudeAdapter, 'fetchUsage').mockImplementation(fetchUsage as never);
});

describe('refreshUsage', () => {
  it('active account: uses activeFetch inside the switch lock; stores usage', async () => {
    seed([acc('a')], 'a');
    syncLiveSession.mockResolvedValue('a');
    fetchUsage.mockImplementation(async (f: SiteFetch) => {
      order.push(f === activeFetch ? 'active' : 'other');
      return u(42);
    });
    await refreshUsage('a');
    expect(order).toEqual(['lock:start', 'active', 'lock:end']);
    expect(cookieFetch).not.toHaveBeenCalled();
    expect(stored().a?.usage).toEqual(u(42));
    expect(stored().a?.error).toBeUndefined();
    expect(stored().a?.lastAttemptAt).toBeGreaterThan(0);
    expect(fetchUsage.mock.calls[0]?.[1]).toEqual({ key: 'a' });
  });

  it('non-active account: uses cookieFetch with its cookies, no lock', async () => {
    seed([acc('a'), acc('b', 'bcookie')], 'a');
    fetchUsage.mockImplementation(async (f: SiteFetch) => {
      expect(f).toBe(cookieFetchSentinel);
      return u(7);
    });
    await refreshUsage('b');
    expect(withSwitchLock).not.toHaveBeenCalled();
    expect((cookieFetch.mock.calls[0]?.[0] as chrome.cookies.Cookie[])[0]?.name).toBe('bcookie');
    expect(stored().b?.usage).toEqual(u(7));
  });

  it('active account whose live session is someone else falls back to cookieFetch', async () => {
    seed([acc('a'), acc('b')], 'a');
    syncLiveSession.mockResolvedValue('b');
    fetchUsage.mockResolvedValue(u(1));
    await refreshUsage('a');
    expect(cookieFetch).toHaveBeenCalledTimes(1);
  });

  it('active account with an unsaved live session falls back to cookieFetch', async () => {
    seed([acc('a')], 'a');
    syncLiveSession.mockRejectedValue(new Error('not saved'));
    fetchUsage.mockResolvedValue(u(1));
    await refreshUsage('a');
    expect(cookieFetch).toHaveBeenCalledTimes(1);
    expect(stored().a?.usage).toEqual(u(1));
  });

  it('failure keeps previous usage and records error', async () => {
    seed([acc('a')], null, { a: { usage: u(30), lastAttemptAt: 1 } });
    fetchUsage.mockRejectedValue(new Error('HTTP 403'));
    await expect(refreshUsage('a')).resolves.toBeUndefined();
    expect(stored().a?.usage).toEqual(u(30));
    expect(stored().a?.error).toBe('HTTP 403');
    expect(stored().a?.lastAttemptAt).toBeGreaterThan(1);
  });

  it('success after failure clears the error', async () => {
    seed([acc('a')], null, { a: { usage: u(30), error: 'old', lastAttemptAt: 1 } });
    fetchUsage.mockResolvedValue(u(31));
    await refreshUsage('a');
    expect(stored().a).toMatchObject({ usage: u(31) });
    expect('error' in (stored().a as object)).toBe(false);
  });

  it('all accounts: one failure does not stop the others', async () => {
    seed([acc('a'), acc('b')], null);
    fetchUsage.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(u(9));
    await refreshUsage();
    expect(stored().a).toMatchObject({ usage: null, error: 'boom' });
    expect(stored().b?.usage).toEqual(u(9));
  });

  it('skips accounts whose site has no fetchUsage', async () => {
    const other: Account = { ...acc('c'), siteId: 'console' };
    seed([other], null);
    await refreshUsage();
    expect(fetchUsage).not.toHaveBeenCalled();
    expect(stored().c).toBeUndefined();
  });

  it('does not write usage for an account deleted meanwhile', async () => {
    seed([acc('a')], null);
    fetchUsage.mockImplementation(async () => {
      (mock.state.storage.state as StoreState).accounts = [];
      return u(1);
    });
    await refreshUsage('a');
    expect(stored().a).toBeUndefined();
  });

  it('throws for a missing accountId', async () => {
    seed([acc('a')], null);
    await expect(refreshUsage('nope')).rejects.toThrow();
  });
});
