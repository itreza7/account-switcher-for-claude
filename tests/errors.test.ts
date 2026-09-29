import { beforeEach, describe, expect, it, vi } from 'vitest';
import { friendlyError } from '../src/ui/errors';
import { installChromeMock } from './chrome-mock';

beforeEach(() => {
  installChromeMock();
});

describe('friendlyError', () => {
  it.each([
    ['HTTP 401 from https://claude.ai/api/organizations', /Session expired/],
    ['HTTP 403 from https://claude.ai/api/x', /Session expired/],
    ['HTTP 429 from https://claude.ai/api/x', /limiting requests/],
    ['HTTP 503 from https://claude.ai/api/x', /servers had a problem/],
    ['Failed to fetch', /Can't reach Claude/],
    ['TimeoutError: signal timed out', /too long/],
    ['Save at least two accounts first', /at least two accounts/],
    ['No other account is available (all near limit or no usage data)', /No other account is ready/],
    ['Account not found', /no longer exists/],
    ['No cookies for claude.ai', /Session expired/],
    ['HTTP 404 from https://claude.ai/api/x', /Couldn't read this account's data/],
    ['Invalid JSON from https://claude.ai/api/x', /Couldn't read this account's data/],
    ['Unexpected usage response', /Couldn't read this account's data/],
    ['No organization found at https://claude.ai', /Couldn't read this account's data/],
    ['Missing organization id', /Couldn't read this account's data/],
    ['Could not read Console identity', /Couldn't read this account's data/],
  ])('maps %s', (raw, want) => {
    expect(friendlyError(new Error(raw))).toMatch(want);
  });

  it('fills the site name', () => {
    expect(friendlyError('The current Claude session is not saved. Save it first.')).toBe(
      "The Claude account you're logged in with isn't saved. Save it first so it isn't lost.",
    );
    expect(friendlyError(new Error('Not logged in to Console'))).toBe("You're not logged in to Console. Log in first, then save.");
  });

  it('keeps the specific 401/429 rules ahead of the generic 4xx one', () => {
    expect(friendlyError('HTTP 401 from https://x')).toMatch(/Session expired/);
    expect(friendlyError('HTTP 429 from https://x')).toMatch(/limiting requests/);
  });

  it('hides raw text of unknown errors and logs it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(friendlyError(new Error('weird https://x.test/y'))).toBe('Something went wrong. Try again.');
    expect(warn).toHaveBeenCalledWith('Unhandled error', 'weird https://x.test/y');
    warn.mockRestore();
  });
});
