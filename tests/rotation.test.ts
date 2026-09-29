import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Account, type StoreState, type Usage } from '../src/core/types';
import { installChromeMock } from './chrome-mock';

const switchTo = vi.fn(async (_id: string) => {});
vi.mock('../src/core/switcher', () => ({ switchTo: (id: string) => switchTo(id) }));

const { pickNext, switchNext } = await import('../src/core/rotation');

const NOW = Date.parse('2026-01-01T12:00:00Z');
const future = new Date(NOW + 3_600_000).toISOString();
const past = new Date(NOW - 1000).toISOString();
const STALE = 10 * 60_000;

const usage = (five: number, week: number, o: { fetchedAt?: number; fiveReset?: string } = {}): Usage => ({
  fiveHour: { utilization: five, resetsAt: o.fiveReset ?? future },
  sevenDay: { utilization: week, resetsAt: future },
  extra: {},
  fetchedAt: o.fetchedAt ?? NOW,
});

type Strategy = Parameters<typeof pickNext>[0]['strategy'];
const pick = (strategy: Strategy, activeId: string | null, accounts: { id: string; usage: Usage | null }[]) =>
  pickNext({ strategy, activeId, accounts, threshold: 90, staleAfterMs: STALE, now: NOW });

describe('pickNext', () => {
  const abc = [
    { id: 'a', usage: usage(10, 10) },
    { id: 'b', usage: usage(20, 20) },
    { id: 'c', usage: usage(5, 5) },
  ];

  it('next: the account after the active one, wrapping around', () => {
    expect(pick('next', 'a', abc)).toBe('b');
    expect(pick('next', 'b', abc)).toBe('c');
    expect(pick('next', 'c', abc)).toBe('a');
  });

  it('next: ignores usage, even a limited or unknown account', () => {
    expect(pick('next', 'a', [abc[0]!, { id: 'b', usage: usage(99, 99) }])).toBe('b');
    expect(pick('next', 'a', [abc[0]!, { id: 'b', usage: null }])).toBe('b');
  });

  it('no active account: starts from the first one', () => {
    expect(pick('next', null, abc)).toBe('a');
    expect(pick('next', 'deleted', abc)).toBe('a');
  });

  it('only the active account -> null', () => {
    expect(pick('next', 'a', [abc[0]!])).toBeNull();
    expect(pick('best', 'a', [abc[0]!])).toBeNull();
  });

  it('next-available: skips near-limit, unknown and stale accounts', () => {
    const accounts = [
      { id: 'a', usage: usage(10, 10) },
      { id: 'b', usage: usage(90, 10) }, // at threshold
      { id: 'c', usage: null },
      { id: 'd', usage: usage(1, 1, { fetchedAt: NOW - STALE - 1 }) },
      { id: 'e', usage: usage(50, 50) },
    ];
    expect(pick('next-available', 'a', accounts)).toBe('e');
  });

  it('next-available: wraps around', () => {
    expect(pick('next-available', 'c', abc)).toBe('a');
  });

  it('next-available: a window reset in the past counts as 0', () => {
    const accounts = [abc[0]!, { id: 'b', usage: usage(99, 10, { fiveReset: past }) }];
    expect(pick('next-available', 'a', accounts)).toBe('b');
  });

  it('best: most quota left, independent of who is active', () => {
    expect(pick('best', 'a', abc)).toBe('c');
    expect(pick('best', 'b', abc)).toBe('c');
  });

  it('best: tie on peak -> lower 5-hour -> saved order', () => {
    const tie = [
      { id: 'x', usage: usage(99, 99) },
      { id: 'a', usage: usage(30, 30) },
      { id: 'b', usage: usage(20, 30) },
      { id: 'c', usage: usage(20, 30) },
    ];
    expect(pick('best', 'x', tie)).toBe('b');
    expect(pick('best', 'b', tie)).toBe('c');
  });

  it('none available -> null', () => {
    const hot = [{ id: 'a', usage: usage(10, 10) }, { id: 'b', usage: usage(95, 10) }];
    expect(pick('next-available', 'a', hot)).toBeNull();
    expect(pick('best', 'a', hot)).toBeNull();
  });
});

describe('switchNext', () => {
  let mock: ReturnType<typeof installChromeMock>;
  const acc = (id: string, siteId = 'claude'): Account => ({
    id,
    siteId,
    label: `L-${id}`,
    identity: { key: id },
    cookies: [{ name: 'sessionKey', value: 'secret' } as chrome.cookies.Cookie],
    createdAt: 0,
    updatedAt: 0,
  });
  const seed = (accounts: Account[], active: string | null, usageMap: Record<string, Usage> = {}, strategy: Strategy = 'next') => {
    const state: StoreState = {
      schemaVersion: 1,
      accounts,
      active: { claude: active },
      usage: Object.fromEntries(Object.entries(usageMap).map(([k, u]) => [k, { usage: u, lastAttemptAt: NOW }])),
      settings: { ...DEFAULT_SETTINGS, rotationStrategy: strategy },
      autoSwitch: { lastActionAt: null },
    };
    mock.state.storage.state = state;
  };

  beforeEach(() => {
    mock = installChromeMock();
    switchTo.mockClear();
  });

  it('switches to the picked account of the same site and returns a view without cookies', async () => {
    seed([acc('a'), acc('other', 'console'), acc('b')], 'a');
    const view = await switchNext('claude', NOW);
    expect(switchTo).toHaveBeenCalledWith('b');
    expect(view).toMatchObject({ id: 'b', label: 'L-b' });
    expect(view).not.toHaveProperty('cookies');
  });

  it('uses the saved strategy', async () => {
    seed([acc('a'), acc('b'), acc('c')], 'a', { a: usage(10, 10), b: usage(80, 80), c: usage(5, 5) }, 'best');
    await switchNext('claude', NOW);
    expect(switchTo).toHaveBeenCalledWith('c');
  });

  it('explains when there is only one account', async () => {
    seed([acc('a')], 'a');
    await expect(switchNext('claude', NOW)).rejects.toThrow('Save at least two accounts first');
    expect(switchTo).not.toHaveBeenCalled();
  });

  it('explains when no account is available', async () => {
    seed([acc('a'), acc('b')], 'a', { b: usage(95, 10) }, 'next-available');
    await expect(switchNext('claude', NOW)).rejects.toThrow('No other account is available');
    expect(switchTo).not.toHaveBeenCalled();
  });
});
