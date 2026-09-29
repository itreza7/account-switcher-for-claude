import { beforeEach, describe, expect, it } from 'vitest';
import { effectivePct, formatAgo, formatDuration, formatResetsIn, formatWindowResets, usageLevel } from '../src/popup/format';
import { installChromeMock } from './chrome-mock';

const NOW = Date.parse('2026-01-01T12:00:00Z');
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

beforeEach(() => {
  installChromeMock();
});

describe('formatDuration', () => {
  it('formats ranges', () => {
    expect(formatDuration(0)).toBe('<1m');
    expect(formatDuration(59_999)).toBe('<1m');
    expect(formatDuration(45 * min)).toBe('45m');
    expect(formatDuration(2 * hour + 13 * min)).toBe('2h 13m');
    expect(formatDuration(hour)).toBe('1h 0m');
    expect(formatDuration(3 * day + 4 * hour + 5 * min)).toBe('3d 4h');
  });
});

describe('formatResetsIn', () => {
  it('handles null, past and future', () => {
    expect(formatResetsIn(null, NOW)).toBe('');
    expect(formatResetsIn('garbage', NOW)).toBe('');
    expect(formatResetsIn(new Date(NOW - 1000).toISOString(), NOW)).toBe('reset');
    expect(formatResetsIn(new Date(NOW).toISOString(), NOW)).toBe('reset');
    expect(formatResetsIn(new Date(NOW + 2 * hour + 13 * min).toISOString(), NOW)).toBe('resets in 2h 13m');
    expect(formatResetsIn(new Date(NOW + 10_000).toISOString(), NOW)).toBe('resets in <1m');
  });
});

describe('formatWindowResets', () => {
  it('is empty when unknown or past, named when in the future', () => {
    expect(formatWindowResets(null, NOW)).toBe('');
    expect(formatWindowResets('garbage', NOW)).toBe('');
    expect(formatWindowResets(new Date(NOW - 1000).toISOString(), NOW)).toBe('');
    expect(formatWindowResets(new Date(NOW + 2 * hour + 3 * min).toISOString(), NOW)).toBe('Resets in 2h 3m');
    expect(formatWindowResets(new Date(NOW + 3 * day + 2 * hour).toISOString(), NOW)).toBe('Resets in 3d 2h');
  });
});

describe('formatAgo', () => {
  it('formats elapsed time', () => {
    expect(formatAgo(NOW - 23 * min, NOW)).toBe('23m ago');
    expect(formatAgo(NOW - 10_000, NOW)).toBe('just now');
    expect(formatAgo(NOW + 5000, NOW)).toBe('just now');
    expect(formatAgo(NOW - 2 * day - hour, NOW)).toBe('2d 1h ago');
  });
});

describe('usageLevel', () => {
  it('uses threshold for danger and 70 for warn', () => {
    expect(usageLevel(0, 90)).toBe('ok');
    expect(usageLevel(69, 90)).toBe('ok');
    expect(usageLevel(70, 90)).toBe('warn');
    expect(usageLevel(89, 90)).toBe('warn');
    expect(usageLevel(90, 90)).toBe('danger');
    expect(usageLevel(100, 90)).toBe('danger');
  });
  it('danger wins when threshold is below 70', () => {
    expect(usageLevel(60, 50)).toBe('danger');
    expect(usageLevel(49, 50)).toBe('ok');
  });
});

describe('effectivePct', () => {
  it('returns 0 after reset', () => {
    expect(effectivePct({ utilization: 80, resetsAt: new Date(NOW - 1).toISOString() }, NOW)).toBe(0);
  });
  it('returns utilization otherwise', () => {
    expect(effectivePct({ utilization: 80, resetsAt: new Date(NOW + 1000).toISOString() }, NOW)).toBe(80);
    expect(effectivePct({ utilization: 42, resetsAt: null }, NOW)).toBe(42);
  });
});
