import { beforeEach, describe, expect, it } from 'vitest';
import {
  AVATAR_COLORS,
  avatarIndex,
  initials,
  isStale,
  needsAutoRefresh,
  resetHint,
  showEmail,
  siteAction,
  stepIndex,
  visibleSites,
  windowView,
} from '../src/popup/view';
import { installChromeMock } from './chrome-mock';

beforeEach(() => {
  installChromeMock();
});

describe('initials', () => {
  it('uses the first letters of up to two words', () => {
    expect(initials('Work account')).toBe('WA');
    expect(initials('personal')).toBe('P');
    expect(initials('  one two three ')).toBe('OT');
  });
  it('handles empty labels and non-latin letters', () => {
    expect(initials('   ')).toBe('?');
    expect(initials('élan vital')).toBe('ÉV');
  });
});

describe('avatarIndex', () => {
  it('is stable and within range', () => {
    expect(avatarIndex('uuid-1')).toBe(avatarIndex('uuid-1'));
    for (const k of ['a', 'b', 'me@example.com', '', 'x'.repeat(200)]) {
      const i = avatarIndex(k);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(AVATAR_COLORS);
    }
  });
  it('spreads different keys over several colors', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => avatarIndex(`account-${i}`)));
    expect(seen.size).toBeGreaterThan(4);
  });
});

describe('showEmail', () => {
  it('hides missing or duplicate emails', () => {
    expect(showEmail('Work', undefined)).toBe(false);
    expect(showEmail('me@x.com', 'ME@x.com ')).toBe(false);
    expect(showEmail('Work', 'me@x.com')).toBe(true);
  });
});

describe('isStale', () => {
  it('is stale after two poll intervals', () => {
    expect(isStale(0, 5, 10 * 60_000)).toBe(false);
    expect(isStale(0, 5, 10 * 60_000 + 1)).toBe(true);
  });
});

describe('windowView', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  it('rounds and levels', () => {
    expect(windowView({ utilization: 42.4, resetsAt: null }, 90, now)).toEqual({ pct: 42, level: 'ok' });
    expect(windowView({ utilization: 75, resetsAt: null }, 90, now)).toEqual({ pct: 75, level: 'warn' });
    expect(windowView({ utilization: 95, resetsAt: null }, 90, now)).toEqual({ pct: 95, level: 'danger' });
  });
  it('is 0 after the window reset', () => {
    expect(windowView({ utilization: 95, resetsAt: new Date(now - 1).toISOString() }, 90, now)).toEqual({
      pct: 0,
      level: 'ok',
    });
  });
});

describe('stepIndex', () => {
  const keys = { prev: 'ArrowUp', next: 'ArrowDown' };
  it('wraps and supports Home/End', () => {
    expect(stepIndex(0, 3, 'ArrowDown', keys)).toBe(1);
    expect(stepIndex(2, 3, 'ArrowDown', keys)).toBe(0);
    expect(stepIndex(0, 3, 'ArrowUp', keys)).toBe(2);
    expect(stepIndex(1, 3, 'Home', keys)).toBe(0);
    expect(stepIndex(1, 3, 'End', keys)).toBe(2);
    expect(stepIndex(-1, 3, 'ArrowUp', keys)).toBe(2);
  });
  it('ignores other keys and empty lists', () => {
    expect(stepIndex(0, 3, 'a', keys)).toBeNull();
    expect(stepIndex(0, 0, 'ArrowDown', keys)).toBeNull();
  });
});

describe('siteAction', () => {
  it('saves only an unsaved live session', () => {
    expect(siteAction(true, null)).toBe('save');
    expect(siteAction(true, 'a1')).toBe('login');
    expect(siteAction(false, null)).toBe('login');
  });
});

describe('visibleSites', () => {
  const sites = [{ id: 'claude' }, { id: 'console' }];
  it('hides sites after the first until they have an account', () => {
    expect(visibleSites(sites, [{ siteId: 'claude' }])).toEqual([{ id: 'claude' }]);
    expect(visibleSites(sites, [{ siteId: 'console' }])).toEqual(sites);
    expect(visibleSites(sites, [])).toEqual([{ id: 'claude' }]);
  });
});

describe('resetHint', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const at = (h: number): string => new Date(now + h * 3_600_000).toISOString();
  const usage = (five: number, week: number, fiveReset: string | null = at(2), weekReset: string | null = at(50)) => ({
    fiveHour: { utilization: five, resetsAt: fiveReset },
    sevenDay: { utilization: week, resetsAt: weekReset },
    extra: {},
    fetchedAt: now,
  });
  it('is null when nothing is at warn or danger', () => {
    expect(resetHint(usage(10, 20), 90, now)).toBeNull();
    expect(resetHint(null, 90, now)).toBeNull();
  });
  it('picks the higher window and its level', () => {
    expect(resetHint(usage(75, 20), 90, now)).toEqual({ window: 'fiveHour', level: 'warn', resetsAt: at(2) });
    expect(resetHint(usage(75, 95), 90, now)).toEqual({ window: 'sevenDay', level: 'danger', resetsAt: at(50) });
    expect(resetHint(usage(80, 80), 90, now)?.window).toBe('fiveHour');
  });
  it('skips windows without a known reset time', () => {
    expect(resetHint(usage(95, 75, null), 90, now)).toEqual({ window: 'sevenDay', level: 'warn', resetsAt: at(50) });
    expect(resetHint(usage(95, 75, null, null), 90, now)).toBeNull();
  });
});

describe('needsAutoRefresh', () => {
  const now = 1_000_000_000;
  const min = 60_000;
  it('refreshes when there is no usage data', () => {
    expect(needsAutoRefresh([], 5, now)).toBe(true);
    expect(needsAutoRefresh([{ usage: null }], 5, now)).toBe(true);
  });
  it('skips when all data is newer than half a poll interval', () => {
    expect(needsAutoRefresh([{ usage: { fetchedAt: now - 2 * min } }, { usage: null }], 5, now)).toBe(false);
  });
  it('refreshes when any data is at least half a poll interval old', () => {
    expect(needsAutoRefresh([{ usage: { fetchedAt: now - 2 * min } }, { usage: { fetchedAt: now - 2.5 * min } }], 5, now)).toBe(true);
  });
});
