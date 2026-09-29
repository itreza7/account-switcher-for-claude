import { beforeEach, describe, expect, it } from 'vitest';
import { updateBadge } from '../src/core/badge';
import { DEFAULT_SETTINGS, type Usage } from '../src/core/types';
import { installChromeMock } from './chrome-mock';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const MIN = 60_000;
const future = new Date(NOW + 3_600_000).toISOString();
const past = new Date(NOW - 1000).toISOString();

const usage = (five: number, week: number | null, o: { fetchedAt?: number; fiveReset?: string } = {}): Usage => ({
  fiveHour: { utilization: five, resetsAt: o.fiveReset ?? future },
  sevenDay: week === null ? null : { utilization: week, resetsAt: future },
  extra: {},
  fetchedAt: o.fetchedAt ?? NOW,
});

let mock: ReturnType<typeof installChromeMock>;

function seed(u: Usage | null, active: string | null = 'a') {
  mock.state.storage.state = {
    schemaVersion: 1,
    accounts: [{ id: 'a', siteId: 'claude', label: 'Work', identity: { key: 'a' }, cookies: [], createdAt: 0, updatedAt: 0 }],
    active: { claude: active },
    usage: u ? { a: { usage: u, lastAttemptAt: NOW } } : {},
    settings: { ...DEFAULT_SETTINGS, threshold: 90, pollMinutes: 5 },
    autoSwitch: { lastActionAt: null },
  };
}

beforeEach(() => {
  mock = installChromeMock();
});

describe('updateBadge', () => {
  it('clears the badge when no Claude account is active', async () => {
    seed(usage(50, 10), null);
    mock.state.badge.text = '50%';
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('');
    expect(mock.state.badge.title).toBe('Account Switcher for Claude');
  });

  it('clears the badge when the active account has no usage yet', async () => {
    seed(null);
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('');
  });

  it('is green below 70, amber from 70, red at the threshold', async () => {
    const colors: [number, string][] = [
      [50, '#226A3E'],
      [75, '#9A6400'],
      [95, '#C93C32'],
    ];
    for (const [five, color] of colors) {
      seed(usage(five, 10));
      await updateBadge(NOW);
      expect(mock.state.badge.text).toBe(`${five}%`);
      expect(mock.state.badge.color).toBe(color);
      expect(mock.state.badge.textColor).toBe('#FFFFFF');
    }
  });

  it('rounds the percent', async () => {
    seed(usage(72.6, 10));
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('73%');
  });

  it('shows 0% when the only window has reset', async () => {
    seed(usage(99, null, { fiveReset: past }));
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('0%');
    expect(mock.state.badge.color).toBe('#226A3E');
  });

  it('shows the higher window: weekly 99% beats 5-hour 10%, red, and marks it limiting', async () => {
    seed(usage(10, 99));
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('99%');
    expect(mock.state.badge.color).toBe('#C93C32');
    expect(mock.state.badge.title).toBe('Work\n5-hour: 10% · Weekly: 99% (limiting)');
  });

  it('ignores a reset 5-hour window and uses the weekly one', async () => {
    seed(usage(99, 40, { fiveReset: past }));
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('40%');
    expect(mock.state.badge.title).toBe('Work\n5-hour: 0% · Weekly: 40% (limiting)');
  });

  it('uses the weekly window when the 5-hour one is missing', async () => {
    seed({ fiveHour: null, sevenDay: { utilization: 55, resetsAt: future }, extra: {}, fetchedAt: NOW });
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('55%');
    expect(mock.state.badge.title).toBe('Work\nWeekly: 55% (limiting)');
  });

  it('clears the badge when both windows are missing', async () => {
    seed({ fiveHour: null, sevenDay: null, extra: {}, fetchedAt: NOW });
    mock.state.badge.text = '50%';
    await updateBadge(NOW);
    expect(mock.state.badge.text).toBe('');
  });

  it('is gray with a hint when the data is stale', async () => {
    seed(usage(95, 10, { fetchedAt: NOW - 10 * MIN - 1 }));
    await updateBadge(NOW);
    expect(mock.state.badge.color).toBe('#5F5D58');
    expect(mock.state.badge.title).toBe('Work\n5-hour: 95% · Weekly: 10%\nUsage may be out of date');
  });

  it('tooltip shows the label and both windows', async () => {
    seed(usage(93, 40));
    await updateBadge(NOW);
    expect(mock.state.badge.title).toBe('Work\n5-hour: 93% · Weekly: 40%');
  });

  it('tooltip skips the weekly window when there is none', async () => {
    seed(usage(20, null));
    await updateBadge(NOW);
    expect(mock.state.badge.title).toBe('Work\n5-hour: 20%');
  });
});
