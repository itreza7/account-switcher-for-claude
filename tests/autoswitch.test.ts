import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings, type Usage } from '../src/core/types';
import { installChromeMock } from './chrome-mock';

const switchTo = vi.fn(async (_id: string) => {});
vi.mock('../src/core/switcher', () => ({ switchTo: (id: string) => switchTo(id) }));

const { decide, runAutoSwitch } = await import('../src/core/autoswitch');

const NOW = Date.parse('2026-01-01T12:00:00Z');
const MIN = 60_000;
const future = new Date(NOW + 3_600_000).toISOString();
const past = new Date(NOW - 1000).toISOString();

const usage = (five: number | null, seven: number | null, o: { fetchedAt?: number; fiveReset?: string; sevenReset?: string } = {}): Usage => ({
  fiveHour: five === null ? null : { utilization: five, resetsAt: o.fiveReset ?? future },
  sevenDay: seven === null ? null : { utilization: seven, resetsAt: o.sevenReset ?? future },
  extra: {},
  fetchedAt: o.fetchedAt ?? NOW,
});

const settings = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, autoSwitchMode: 'switch', threshold: 90, pollMinutes: 5, cooldownMinutes: 10, ...p });

const input = (accounts: { id: string; usage: Usage | null }[], over: Partial<Parameters<typeof decide>[0]> = {}) => ({
  siteId: 'claude',
  activeId: 'a',
  accounts,
  settings: settings(),
  now: NOW,
  lastActionAt: null,
  ...over,
});

describe('decide', () => {
  const hot = { id: 'a', usage: usage(95, 10) };
  const cool = { id: 'b', usage: usage(10, 10) };

  it('switches from a hot active account to a cool one', () => {
    expect(decide(input([hot, cool]))).toEqual({
      action: 'switch',
      siteId: 'claude',
      from: 'a',
      to: 'b',
      reason: '5-hour limit at 95%',
    });
  });

  it('mode off -> none', () => {
    expect(decide(input([hot, cool], { settings: settings({ autoSwitchMode: 'off' }) }))).toEqual({ action: 'none' });
  });

  it('notify mode returns notify', () => {
    expect(decide(input([hot, cool], { settings: settings({ autoSwitchMode: 'notify' }) })).action).toBe('notify');
  });

  it('none when no active, active missing, or active usage null', () => {
    expect(decide(input([hot, cool], { activeId: null })).action).toBe('none');
    expect(decide(input([hot, cool], { activeId: 'zzz' })).action).toBe('none');
    expect(decide(input([{ id: 'a', usage: null }, cool])).action).toBe('none');
  });

  it('cooldown blocks; passes exactly at the boundary', () => {
    expect(decide(input([hot, cool], { lastActionAt: NOW - 9 * MIN })).action).toBe('none');
    expect(decide(input([hot, cool], { lastActionAt: NOW - 10 * MIN })).action).toBe('switch');
    expect(decide(input([hot, cool], { settings: settings({ cooldownMinutes: 0 }), lastActionAt: NOW })).action).toBe('switch');
  });

  it('threshold boundary: == threshold is near-limit, below is not', () => {
    expect(decide(input([{ id: 'a', usage: usage(90, 0) }, cool])).action).toBe('switch');
    expect(decide(input([{ id: 'a', usage: usage(89.9, 0) }, cool])).action).toBe('none');
  });

  it('weekly limit reason', () => {
    const d = decide(input([{ id: 'a', usage: usage(10, 95) }, cool]));
    expect(d).toMatchObject({ action: 'switch', reason: 'weekly limit at 95%' });
  });

  it('window whose reset is in the past counts as 0 (active not near-limit)', () => {
    expect(decide(input([{ id: 'a', usage: usage(99, 10, { fiveReset: past }) }, cool])).action).toBe('none');
    // resetsAt == now counts as reset
    expect(decide(input([{ id: 'a', usage: usage(99, 10, { fiveReset: new Date(NOW).toISOString() }) }, cool])).action).toBe('none');
  });

  it('reset-in-past window on a candidate makes it eligible', () => {
    const c = { id: 'b', usage: usage(99, 5, { fiveReset: past }) };
    expect(decide(input([hot, c]))).toMatchObject({ action: 'switch', to: 'b' });
  });

  it('stale active usage -> none; stale candidate skipped', () => {
    const stale = NOW - 10 * MIN - 1;
    expect(decide(input([{ id: 'a', usage: usage(95, 0, { fetchedAt: stale }) }, cool])).action).toBe('none');
    expect(decide(input([hot, { id: 'b', usage: usage(1, 1, { fetchedAt: stale }) }, { id: 'c', usage: usage(50, 50) }]))).toMatchObject({ to: 'c' });
    // exactly 2 * poll is still fresh
    expect(decide(input([hot, { id: 'b', usage: usage(1, 1, { fetchedAt: NOW - 10 * MIN }) }]))).toMatchObject({ to: 'b' });
  });

  it('candidates need both windows below threshold; null window counts as 0; null usage skipped', () => {
    const c1 = { id: 'c1', usage: usage(95, 0) };
    const c2 = { id: 'c2', usage: usage(0, 90) };
    const c3 = { id: 'c3', usage: null };
    const c4 = { id: 'c4', usage: usage(null, null) };
    expect(decide(input([hot, c1, c2, c3, c4]))).toMatchObject({ to: 'c4' });
    expect(decide(input([hot, c1, c2, c3])).action).toBe('none');
  });

  it('picks lowest max(five, seven)', () => {
    const b = { id: 'b', usage: usage(10, 60) };
    const c = { id: 'c', usage: usage(50, 40) };
    expect(decide(input([hot, b, c]))).toMatchObject({ to: 'c' });
  });

  it('tie on max -> lower fiveHour; then input order', () => {
    const b = { id: 'b', usage: usage(40, 40) };
    const c = { id: 'c', usage: usage(20, 40) };
    const d = { id: 'd', usage: usage(20, 40) };
    expect(decide(input([hot, b, c, d]))).toMatchObject({ to: 'c' });
    expect(decide(input([hot, d, c]))).toMatchObject({ to: 'd' });
  });

  it('no candidate -> none', () => {
    expect(decide(input([hot, { id: 'b', usage: usage(95, 95) }])).action).toBe('none');
    expect(decide(input([hot])).action).toBe('none');
  });
});

describe('decide with rotation strategy', () => {
  // Active 'b' is hot; 'c' comes next in order, 'a' has the most room.
  const accts = [
    { id: 'a', usage: usage(5, 5) },
    { id: 'b', usage: usage(95, 10) },
    { id: 'c', usage: usage(50, 50) },
  ];
  const run = (rotationStrategy: Settings['rotationStrategy']) =>
    decide(input(accts, { activeId: 'b', settings: settings({ rotationStrategy }) }));

  it('best picks most quota left', () => {
    expect(run('best')).toMatchObject({ to: 'a' });
  });

  it('next-available picks the next one in order with room', () => {
    expect(run('next-available')).toMatchObject({ to: 'c' });
  });

  it('plain next is treated as next-available (never jumps into a limited account)', () => {
    const limitedNext = [accts[0]!, accts[1]!, { id: 'c', usage: usage(99, 10) }];
    const d = decide(input(limitedNext, { activeId: 'b', settings: settings({ rotationStrategy: 'next' }) }));
    expect(d).toMatchObject({ to: 'a' });
  });
});

describe('runAutoSwitch', () => {
  let mock: ReturnType<typeof installChromeMock>;

  const seed = (mode: Settings['autoSwitchMode'], lastActionAt: number | null = null) => {
    const acc = (id: string, label: string) => ({ id, siteId: 'claude', label, identity: { key: id }, cookies: [], createdAt: 0, updatedAt: 0 });
    mock.state.storage.state = {
      schemaVersion: 1,
      accounts: [acc('a', 'Work'), acc('b', 'Personal')],
      active: { claude: 'a' },
      usage: {
        a: { usage: usage(95, 10), lastAttemptAt: NOW },
        b: { usage: usage(5, 5), lastAttemptAt: NOW },
      },
      settings: settings({ autoSwitchMode: mode }),
      autoSwitch: { lastActionAt },
    };
  };

  beforeEach(() => {
    mock = installChromeMock();
    switchTo.mockClear();
  });

  it('switch mode: switches, notifies, stores lastActionAt', async () => {
    seed('switch');
    await runAutoSwitch(NOW);
    expect(switchTo).toHaveBeenCalledWith('b');
    const notes = Object.values(mock.state.notifications);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.message).toBe('Switched to Personal: 5-hour limit at 95%');
    expect(notes[0]?.iconUrl).toBe('chrome-extension://test-extension-id/icon-128.png');
    expect((mock.state.storage.state as { autoSwitch: { lastActionAt: number } }).autoSwitch.lastActionAt).toBe(NOW);
  });

  it('notify mode: no switch, notification with button, stores lastActionAt', async () => {
    seed('notify');
    await runAutoSwitch(NOW);
    expect(switchTo).not.toHaveBeenCalled();
    const n = mock.state.notifications['autoswitch:b'];
    expect(n?.title).toBe('Claude limit near');
    expect(n?.message).toContain('5-hour limit at 95%');
    expect(n?.message).toContain('Personal');
    expect(n?.buttons).toEqual([{ title: 'Switch now' }]);
    expect((mock.state.storage.state as { autoSwitch: { lastActionAt: number } }).autoSwitch.lastActionAt).toBe(NOW);
  });

  it('does nothing in off mode or during cooldown', async () => {
    seed('off');
    await runAutoSwitch(NOW);
    seed('switch', NOW - MIN);
    await runAutoSwitch(NOW);
    expect(switchTo).not.toHaveBeenCalled();
    expect(mock.state.notifications).toEqual({});
  });
});
