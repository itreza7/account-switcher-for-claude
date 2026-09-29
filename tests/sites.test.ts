import { afterEach, describe, expect, it, vi } from 'vitest';
import { claudeAdapter } from '../src/sites/claude';
import { consoleAdapter } from '../src/sites/console';
import { getAdapter, listAdapters } from '../src/sites';
import type { SiteFetch } from '../src/sites/site';
import { makeCookie } from './chrome-mock';

/** Builds a SiteFetch from a url -> body map. A number value is an HTTP status with no body. */
function fakeFetch(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const hit = routes[url];
    if (hit === undefined) return new Response('nf', { status: 404 });
    if (typeof hit === 'number') return new Response('err', { status: hit });
    return new Response(JSON.stringify(hit), { status: 200 });
  });
  return fn as unknown as SiteFetch & typeof fn;
}

afterEach(() => vi.useRealTimers());

describe('registry', () => {
  it('lists both adapters and resolves by id', () => {
    expect(listAdapters().map((a) => a.id)).toEqual(['claude', 'console']);
    expect(getAdapter('console')).toBe(consoleAdapter);
    expect(() => getAdapter('nope')).toThrow(/Unknown site/);
  });
});

describe('claude adapter basics', () => {
  it('cookieFilter accepts claude.ai and rejects other hosts', () => {
    const f = claudeAdapter.cookieFilter;
    expect(f(makeCookie({ name: 'a', domain: '.claude.ai' }))).toBe(true);
    expect(f(makeCookie({ name: 'a', domain: 'claude.ai' }))).toBe(true);
    expect(f(makeCookie({ name: 'a', domain: 'platform.claude.com' }))).toBe(false);
    expect(f(makeCookie({ name: 'a', domain: 'api.claude.ai' }))).toBe(false);
  });

  it('isLoggedIn needs a non-empty sessionKey', () => {
    expect(claudeAdapter.isLoggedIn([makeCookie({ name: 'sessionKey', domain: '.claude.ai' })])).toBe(true);
    expect(claudeAdapter.isLoggedIn([makeCookie({ name: 'sessionKey', domain: '.claude.ai', value: '' })])).toBe(false);
    expect(claudeAdapter.isLoggedIn([makeCookie({ name: 'other', domain: '.claude.ai' })])).toBe(false);
  });
});

describe('claude fetchIdentity', () => {
  const ORGS = 'https://claude.ai/api/organizations';
  const ACC = 'https://claude.ai/api/account';

  it('picks the chat org and reads account details and plan', async () => {
    const f = fakeFetch({
      [ORGS]: [
        { uuid: 'api-org', name: 'API', capabilities: ['api'] },
        { uuid: 'chat-org', name: 'Me', capabilities: ['chat', 'claude_max'] },
      ],
      [ACC]: { uuid: 'acc-1', email_address: 'me@x.com', full_name: 'Me Myself' },
    });
    expect(await claudeAdapter.fetchIdentity(f)).toEqual({
      key: 'acc-1',
      email: 'me@x.com',
      name: 'Me Myself',
      orgId: 'chat-org',
      orgName: 'Me',
      plan: 'Max',
    });
    expect(f.mock.calls[0]?.[1]).toMatchObject({ headers: { accept: 'application/json' } });
  });

  it('falls back to the first org and org uuid when the account call fails', async () => {
    const f = fakeFetch({ [ORGS]: [{ uuid: 'o1', capabilities: [] }], [ACC]: 500 });
    const id = await claudeAdapter.fetchIdentity(f);
    expect(id).toEqual({ key: 'o1', orgId: 'o1', plan: 'Free' });
  });

  it('uses email as key when the account has no uuid, and tolerates odd shapes', async () => {
    const f = fakeFetch({
      [ORGS]: [null, 5, { name: 'no uuid' }, { uuid: 'o1', capabilities: ['chat', 'raven', 7] }],
      [ACC]: { account: { email_address: 'a@b.c', display_name: 'Disp' } },
    });
    const id = await claudeAdapter.fetchIdentity(f);
    expect(id).toMatchObject({ key: 'a@b.c', email: 'a@b.c', name: 'Disp', plan: 'Team' });
  });

  it('maps claude_pro to Pro', async () => {
    const f = fakeFetch({ [ORGS]: [{ uuid: 'o', capabilities: ['chat', 'claude_pro'] }] });
    expect((await claudeAdapter.fetchIdentity(f)).plan).toBe('Pro');
  });

  it('throws a clear error on non-OK status', async () => {
    const f = fakeFetch({ [ORGS]: 401 });
    await expect(claudeAdapter.fetchIdentity(f)).rejects.toThrow(`HTTP 401 from ${ORGS}`);
  });

  it('throws when no organization is returned', async () => {
    const f = fakeFetch({ [ORGS]: [] });
    await expect(claudeAdapter.fetchIdentity(f)).rejects.toThrow(/No organization/);
  });
});

describe('claude fetchUsage', () => {
  const url = 'https://claude.ai/api/organizations/o1/usage';
  const identity = { key: 'k', orgId: 'o1' };

  it('maps main windows and collects extra windows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const f = fakeFetch({
      [url]: {
        five_hour: { utilization: 42.5, resets_at: '2026-01-01T00:00:00Z' },
        seven_day: { utilization: 10, resets_at: null },
        seven_day_opus: { utilization: 77, resets_at: '2026-01-02T00:00:00Z' },
        seven_day_sonnet: null,
        extra_usage: { is_enabled: false },
        weird: { utilization: null, resets_at: null },
      },
    });
    const u = await claudeAdapter.fetchUsage!(f, identity);
    expect(u).toEqual({
      fiveHour: { utilization: 42.5, resetsAt: '2026-01-01T00:00:00Z' },
      sevenDay: { utilization: 10, resetsAt: null },
      extra: { seven_day_opus: { utilization: 77, resetsAt: '2026-01-02T00:00:00Z' } },
      fetchedAt: 1_700_000_000_000,
    });
  });

  it('handles null windows', async () => {
    const f = fakeFetch({ [url]: { five_hour: null, seven_day: null } });
    const u = await claudeAdapter.fetchUsage!(f, identity);
    expect(u.fiveHour).toBeNull();
    expect(u.sevenDay).toBeNull();
    expect(u.extra).toEqual({});
  });

  it('treats a null utilization as an unknown window', async () => {
    const f = fakeFetch({ [url]: { five_hour: { utilization: null, resets_at: null } } });
    expect((await claudeAdapter.fetchUsage!(f, identity)).fiveHour).toBeNull();
  });

  it('clamps utilization to 0..100', async () => {
    const f = fakeFetch({
      [url]: { five_hour: { utilization: 130, resets_at: null }, seven_day: { utilization: -5, resets_at: null } },
    });
    const u = await claudeAdapter.fetchUsage!(f, identity);
    expect(u.fiveHour?.utilization).toBe(100);
    expect(u.sevenDay?.utilization).toBe(0);
  });

  it('requires orgId and a JSON object', async () => {
    await expect(claudeAdapter.fetchUsage!(fakeFetch({}), { key: 'k' })).rejects.toThrow(/organization id/);
    await expect(claudeAdapter.fetchUsage!(fakeFetch({ [url]: [1] }), identity)).rejects.toThrow(/Unexpected/);
    await expect(claudeAdapter.fetchUsage!(fakeFetch({ [url]: 403 }), identity)).rejects.toThrow(`HTTP 403 from ${url}`);
  });
});

describe('console adapter', () => {
  it('cookieFilter accepts anthropic.com and platform.claude.com only', () => {
    const f = consoleAdapter.cookieFilter;
    expect(f(makeCookie({ name: 'a', domain: '.anthropic.com' }))).toBe(true);
    expect(f(makeCookie({ name: 'a', domain: 'console.anthropic.com' }))).toBe(true);
    expect(f(makeCookie({ name: 'a', domain: 'platform.claude.com' }))).toBe(true);
    expect(f(makeCookie({ name: 'a', domain: '.platform.claude.com' }))).toBe(true);
    expect(f(makeCookie({ name: 'a', domain: '.claude.ai' }))).toBe(false);
  });

  it('has no usage support', () => {
    expect(consoleAdapter.fetchUsage).toBeUndefined();
  });

  it('falls back to the second host and omits the plan', async () => {
    const f = fakeFetch({
      'https://console.anthropic.com/api/organizations': [{ uuid: 'c1', name: 'Org', capabilities: ['api'] }],
    });
    const id = await consoleAdapter.fetchIdentity(f);
    expect(id).toEqual({ key: 'c1', orgId: 'c1', orgName: 'Org' });
  });

  it('throws a clear error when no host answers', async () => {
    await expect(consoleAdapter.fetchIdentity(fakeFetch({}))).rejects.toThrow('Could not read Console identity');
  });
});
