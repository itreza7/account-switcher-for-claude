import { beforeEach, describe, expect, it } from 'vitest';
import { clearCookies, cookieHeaderFor, restoreCookies, snapshotCookies } from '../src/core/cookies';
import { claudeAdapter } from '../src/sites/claude';
import { installChromeMock, makeCookie } from './chrome-mock';

let mock: ReturnType<typeof installChromeMock>;

beforeEach(() => {
  mock = installChromeMock();
});

describe('snapshotCookies', () => {
  it('keeps claude.ai cookies and excludes host-only cookies of subdomains', async () => {
    mock.state.cookies.push(
      makeCookie({ name: 'sessionKey', domain: '.claude.ai' }),
      makeCookie({ name: 'lastActiveOrg', domain: 'claude.ai' }),
      makeCookie({ name: 'sub', domain: 'api.claude.ai' }),
    );
    const names = (await snapshotCookies(claudeAdapter)).map((c) => c.name).sort();
    expect(names).toEqual(['lastActiveOrg', 'sessionKey']);
  });

  it('dedupes cookies returned for more than one domain query', async () => {
    const c = makeCookie({ name: 'sessionKey', domain: '.claude.ai' });
    mock.state.cookies.push(c);
    const adapter = { ...claudeAdapter, cookieDomains: ['claude.ai', 'claude.ai'] };
    expect(await snapshotCookies(adapter)).toHaveLength(1);
  });

  it('keeps cookies with the same name but a different partition key', async () => {
    mock.state.cookies.push(
      makeCookie({ name: 'p', domain: '.claude.ai', partitionKey: { topLevelSite: 'https://a.com' } }),
      makeCookie({ name: 'p', domain: '.claude.ai', partitionKey: { topLevelSite: 'https://b.com' } }),
    );
    expect(await snapshotCookies(claudeAdapter)).toHaveLength(2);
  });
});

describe('clearCookies', () => {
  it('removes every site cookie using a scheme + domain + path url', async () => {
    mock.state.cookies.push(
      makeCookie({ name: 'sessionKey', domain: '.claude.ai', path: '/' }),
      makeCookie({ name: 'other', domain: 'claude.ai', secure: false }),
    );
    await clearCookies(claudeAdapter);
    expect(mock.state.cookies).toEqual([]);
    const urls = mock.chrome.cookies.remove.mock.calls.map(([d]) => d.url).sort();
    expect(urls).toEqual(['http://claude.ai/', 'https://claude.ai/']);
  });

  it('passes partitionKey and storeId through', async () => {
    const pk = { topLevelSite: 'https://a.com' };
    mock.state.cookies.push(makeCookie({ name: 'p', domain: '.claude.ai', partitionKey: pk, storeId: '7' }));
    await clearCookies(claudeAdapter);
    expect(mock.chrome.cookies.remove).toHaveBeenCalledWith({
      url: 'https://claude.ai/',
      name: 'p',
      partitionKey: pk,
      storeId: '7',
    });
  });
});

describe('restoreCookies', () => {
  it('sets domain only for non-host-only cookies', async () => {
    await restoreCookies(claudeAdapter, [
      makeCookie({ name: 'wide', domain: '.claude.ai' }),
      makeCookie({ name: 'narrow', domain: 'claude.ai' }),
    ]);
    const calls = Object.fromEntries(mock.chrome.cookies.set.mock.calls.map(([d]) => [d.name, d]));
    expect(calls.wide.domain).toBe('.claude.ai');
    expect(calls.narrow).not.toHaveProperty('domain');
    expect(calls.wide.url).toBe('https://claude.ai/');
    expect(calls.wide).not.toHaveProperty('storeId');
  });

  it('omits sameSite when unspecified and expirationDate for session cookies', async () => {
    await restoreCookies(claudeAdapter, [
      makeCookie({ name: 's', domain: '.claude.ai', sameSite: 'unspecified', session: true, expirationDate: undefined }),
      makeCookie({ name: 'p', domain: '.claude.ai', sameSite: 'lax' }),
    ]);
    const calls = Object.fromEntries(mock.chrome.cookies.set.mock.calls.map(([d]) => [d.name, d]));
    expect(calls.s).not.toHaveProperty('sameSite');
    expect(calls.s).not.toHaveProperty('expirationDate');
    expect(calls.p.sameSite).toBe('lax');
    expect(calls.p.expirationDate).toBe(4102444800);
  });

  it('skips expired cookies and cookies the adapter filters out', async () => {
    await restoreCookies(claudeAdapter, [
      makeCookie({ name: 'old', domain: '.claude.ai', expirationDate: 1000 }),
      makeCookie({ name: 'foreign', domain: 'platform.claude.com' }),
    ]);
    expect(mock.chrome.cookies.set).not.toHaveBeenCalled();
  });

  it('passes partitionKey through', async () => {
    const pk = { topLevelSite: 'https://a.com' };
    await restoreCookies(claudeAdapter, [makeCookie({ name: 'p', domain: '.claude.ai', partitionKey: pk })]);
    expect(mock.chrome.cookies.set.mock.calls[0]?.[0].partitionKey).toEqual(pk);
  });

  it('tries every cookie, then throws one error naming the failures', async () => {
    mock.chrome.cookies.set.mockImplementation(async (d: chrome.cookies.SetDetails) => {
      if (d.name === 'bad1') throw new Error('nope');
      if (d.name === 'bad2') return null as never;
      return {} as chrome.cookies.Cookie;
    });
    await expect(
      restoreCookies(claudeAdapter, [
        makeCookie({ name: 'bad1', domain: '.claude.ai' }),
        makeCookie({ name: 'good', domain: '.claude.ai' }),
        makeCookie({ name: 'bad2', domain: '.claude.ai' }),
      ]),
    ).rejects.toThrow(/bad1, bad2/);
    expect(mock.chrome.cookies.set).toHaveBeenCalledTimes(3);
  });
});

describe('cookieHeaderFor', () => {
  const url = 'https://claude.ai/api/organizations';

  it('joins matching cookies', () => {
    const h = cookieHeaderFor(url, [
      makeCookie({ name: 'a', value: '1', domain: '.claude.ai' }),
      makeCookie({ name: 'b', value: '2', domain: 'claude.ai' }),
    ]);
    expect(h).toBe('a=1; b=2');
  });

  it('matches subdomains only for domain cookies, exact host for host-only', () => {
    const cookies = [
      makeCookie({ name: 'wide', domain: '.claude.ai' }),
      makeCookie({ name: 'narrow', domain: 'claude.ai' }),
    ];
    expect(cookieHeaderFor('https://api.claude.ai/x', cookies)).toBe('wide=v');
  });

  it('rejects look-alike hosts', () => {
    const cookies = [makeCookie({ name: 'a', domain: '.claude.ai' })];
    expect(cookieHeaderFor('https://evilclaude.ai/', cookies)).toBe('');
    expect(cookieHeaderFor('https://claude.ai.evil.com/', cookies)).toBe('');
  });

  it('matches path prefixes on segment boundaries', () => {
    const cookies = [makeCookie({ name: 'a', domain: '.claude.ai', path: '/api' })];
    expect(cookieHeaderFor('https://claude.ai/api', cookies)).toBe('a=v');
    expect(cookieHeaderFor('https://claude.ai/api/x', cookies)).toBe('a=v');
    expect(cookieHeaderFor('https://claude.ai/apix', cookies)).toBe('');
    expect(cookieHeaderFor('https://claude.ai/', cookies)).toBe('');
  });

  it('sends secure cookies only over https', () => {
    const cookies = [makeCookie({ name: 'a', domain: '.claude.ai', secure: true })];
    expect(cookieHeaderFor('http://claude.ai/', cookies)).toBe('');
    expect(cookieHeaderFor('https://claude.ai/', cookies)).toBe('a=v');
  });

  it('skips expired cookies but keeps session cookies', () => {
    const cookies = [
      makeCookie({ name: 'old', domain: '.claude.ai', expirationDate: 1000 }),
      makeCookie({ name: 'sess', domain: '.claude.ai', session: true, expirationDate: undefined }),
    ];
    expect(cookieHeaderFor(url, cookies)).toBe('sess=v');
  });
});
