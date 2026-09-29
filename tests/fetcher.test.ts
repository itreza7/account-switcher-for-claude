import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cookieFetch } from '../src/core/fetcher';
import { activeFetch } from '../src/sites/site';
import { installChromeMock, makeCookie } from './chrome-mock';

const URL_ = 'https://claude.ai/api/organizations/x?a=1';
const cookies = [makeCookie({ name: 'sessionKey', value: 'abc', domain: '.claude.ai' }), makeCookie({ name: 'o', value: '1', domain: '.claude.ai' })];

let mock: ReturnType<typeof installChromeMock>;
beforeEach(() => {
  mock = installChromeMock();
  vi.unstubAllGlobals();
});

describe('cookieFetch', () => {
  it('adds a DNR rule with the cookie header and scoped condition, then removes it', async () => {
    let ruleDuringFetch: chrome.declarativeNetRequest.Rule | undefined;
    const fetchMock = vi.fn(async () => {
      ruleDuringFetch = mock.state.sessionRules[0];
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await cookieFetch(cookies)(URL_, { method: 'GET' });
    expect(await res.text()).toBe('ok');

    expect(ruleDuringFetch).toBeDefined();
    const rule = ruleDuringFetch as unknown as {
      id: number;
      action: { type: string; requestHeaders: { header: string; operation: string; value: string }[] };
      condition: Record<string, unknown>;
    };
    expect(rule.action.type).toBe('modifyHeaders');
    expect(rule.action.requestHeaders).toEqual([{ header: 'cookie', operation: 'set', value: 'sessionKey=abc; o=1' }]);
    expect(rule.condition).toEqual({
      regexFilter: '^https://claude\\.ai/api/organizations/x\\?a=1$',
      tabIds: [-1],
      initiatorDomains: ['test-extension-id'],
      resourceTypes: ['xmlhttprequest'],
    });
    expect(new RegExp(rule.condition.regexFilter as string).test(URL_)).toBe(true);
    expect(mock.state.sessionRules).toEqual([]);

    const first = mock.chrome.declarativeNetRequest.updateSessionRules.mock.calls[0]?.[0];
    expect(first?.removeRuleIds).toEqual([rule.id]);
  });

  it('fetches with credentials omit and passes through init', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await cookieFetch(cookies)(URL_, { credentials: 'include', headers: { a: 'b' } });
    expect(fetchMock).toHaveBeenCalledWith(URL_, {
      credentials: 'omit',
      headers: { a: 'b' },
      signal: expect.any(AbortSignal),
    });
  });

  it('removes the rule even when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(cookieFetch(cookies)(URL_)).rejects.toThrow('offline');
    expect(mock.state.sessionRules).toEqual([]);
  });

  it('throws when no cookie matches the url, without touching rules', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(cookieFetch(cookies)('https://example.com/x')).rejects.toThrow('No cookies for example.com');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mock.chrome.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled();
  });

  it('serializes with netLock: no other request runs while the rule is installed', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        events.push(`start ${url}`);
        if (url === URL_) await gate;
        events.push(`end ${url}`);
        return new Response('ok');
      }),
    );

    const a = cookieFetch(cookies)(URL_);
    const b = activeFetch('https://claude.ai/other');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual([`start ${URL_}`]);
    release();
    await Promise.all([a, b]);
    expect(events).toEqual([`start ${URL_}`, `end ${URL_}`, 'start https://claude.ai/other', 'end https://claude.ai/other']);
    expect(mock.state.sessionRules).toEqual([]);
  });
});
