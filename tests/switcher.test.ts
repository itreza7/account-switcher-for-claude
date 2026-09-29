import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadState } from '../src/core/storage';
import {
  loginAnother,
  removeAccount,
  renameAccount,
  saveCurrent,
  switchTo,
  withSwitchLock,
} from '../src/core/switcher';
import { installChromeMock, makeCookie } from './chrome-mock';

let mock: ReturnType<typeof installChromeMock>;

/** Session key -> the identity the fake API returns for it. Two keys may map to one account. */
const SESSIONS: Record<string, { uuid: string; email: string; org: string }> = {
  kA: { uuid: 'uA', email: 'a@x.com', org: 'oA' },
  kA2: { uuid: 'uA', email: 'a@x.com', org: 'oA' },
  kB: { uuid: 'uB', email: 'b@x.com', org: 'oB' },
  kC: { uuid: 'uC', email: 'c@x.com', org: 'oC' },
};

function liveKey(): string | undefined {
  return mock.state.cookies.find((c) => c.name === 'sessionKey')?.value;
}

function setSession(key: string, extra: Record<string, string> = {}) {
  mock.state.cookies = [
    makeCookie({ name: 'sessionKey', domain: '.claude.ai', value: key }),
    ...Object.entries(extra).map(([name, value]) => makeCookie({ name, domain: 'claude.ai', value })),
  ];
}

function liveValue(name: string): string | undefined {
  return mock.state.cookies.find((c) => c.name === name)?.value;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mock = installChromeMock();
  fetchMock = vi.fn(async (url: string) => {
    const s = SESSIONS[liveKey() ?? ''];
    if (!s) return new Response('no', { status: 401 });
    if (url.endsWith('/api/organizations')) {
      return new Response(JSON.stringify([{ uuid: s.org, capabilities: ['chat', 'claude_pro'] }]));
    }
    if (url.endsWith('/api/account')) {
      return new Response(JSON.stringify({ uuid: s.uuid, email_address: s.email }));
    }
    return new Response('nf', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('saveCurrent', () => {
  it('throws when not logged in', async () => {
    await expect(saveCurrent('claude')).rejects.toThrow('Not logged in to Claude');
  });

  it('creates an account, marks it active and returns a view without cookies', async () => {
    setSession('kA', { pref: '1' });
    const view = await saveCurrent('claude');
    expect(view).toMatchObject({ siteId: 'claude', label: 'a@x.com', identity: { key: 'uA', plan: 'Pro' } });
    expect('cookies' in view).toBe(false);
    const s = await loadState();
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0]?.cookies.map((c) => c.name).sort()).toEqual(['pref', 'sessionKey']);
    expect(s.active.claude).toBe(view.id);
  });

  it('uses the given label, trimmed', async () => {
    setSession('kA');
    expect((await saveCurrent('claude', '  Work  ')).label).toBe('Work');
  });

  it('updates the existing account for the same identity instead of adding one', async () => {
    setSession('kA');
    const first = await saveCurrent('claude', 'Work');
    setSession('kA2', { fresh: 'yes' });
    const second = await saveCurrent('claude');
    expect(second.id).toBe(first.id);
    expect(second.label).toBe('Work');
    const s = await loadState();
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0]?.cookies.find((c) => c.name === 'sessionKey')?.value).toBe('kA2');
    expect(s.accounts[0]?.cookies.some((c) => c.name === 'fresh')).toBe(true);
    expect((await saveCurrent('claude', 'Renamed')).label).toBe('Renamed');
  });

  it('creates a second account for a different identity', async () => {
    setSession('kA');
    await saveCurrent('claude');
    setSession('kB');
    const b = await saveCurrent('claude');
    const s = await loadState();
    expect(s.accounts).toHaveLength(2);
    expect(s.active.claude).toBe(b.id);
  });
});

async function saveBoth() {
  setSession('kA', { marker: 'A' });
  const a = await saveCurrent('claude');
  setSession('kB', { marker: 'B' });
  const b = await saveCurrent('claude');
  return { a, b };
}

describe('switchTo', () => {
  it('swaps cookies, updates active and reloads matching tabs', async () => {
    const { a, b } = await saveBoth();
    mock.state.tabs.push(
      { id: 10, url: 'https://claude.ai/chat/1' } as chrome.tabs.Tab,
      { id: 11, url: 'https://example.com/' } as chrome.tabs.Tab,
    );
    await switchTo(a.id);
    expect(liveKey()).toBe('kA');
    expect(liveValue('marker')).toBe('A');
    expect((await loadState()).active.claude).toBe(a.id);
    expect(mock.chrome.tabs.reload.mock.calls).toEqual([[10]]);
    await switchTo(b.id);
    expect(liveKey()).toBe('kB');
    expect((await loadState()).active.claude).toBe(b.id);
  });

  it('saves the live session back into the outgoing account first', async () => {
    const { a, b } = await saveBoth();
    // B is active; the site rotated a cookie in the browser since the last save.
    mock.state.cookies.find((c) => c.name === 'marker')!.value = 'B-rotated';
    await switchTo(a.id);
    const stored = (await loadState()).accounts.find((x) => x.id === b.id)!;
    expect(stored.cookies.find((c) => c.name === 'marker')?.value).toBe('B-rotated');
  });

  it('saves a manual login into the matching account, never into the active one', async () => {
    const { a, b } = await saveBoth();
    // State says B is active, but the user logged in as A by hand.
    setSession('kA', { marker: 'manual-A' });
    await switchTo(a.id);
    const s = await loadState();
    const storedB = s.accounts.find((x) => x.id === b.id)!;
    expect(storedB.cookies.find((c) => c.name === 'sessionKey')?.value).toBe('kB');
    expect(storedB.cookies.find((c) => c.name === 'marker')?.value).toBe('B');
    const storedA = s.accounts.find((x) => x.id === a.id)!;
    expect(storedA.cookies.find((c) => c.name === 'marker')?.value).toBe('manual-A');
    expect(liveValue('marker')).toBe('manual-A');
  });

  it('refuses to switch away from an unsaved session and leaves cookies alone', async () => {
    const { a } = await saveBoth();
    setSession('kC', { marker: 'C' });
    await expect(switchTo(a.id)).rejects.toThrow('not saved');
    expect(liveKey()).toBe('kC');
    expect(mock.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  it('continues when the identity fetch fails', async () => {
    const { a, b } = await saveBoth();
    fetchMock.mockRejectedValue(new Error('offline'));
    await switchTo(a.id);
    expect(liveKey()).toBe('kA');
    const storedB = (await loadState()).accounts.find((x) => x.id === b.id)!;
    expect(storedB.cookies.find((c) => c.name === 'marker')?.value).toBe('B');
  });

  it('rolls back and keeps active unchanged when restoring fails', async () => {
    const { a, b } = await saveBoth();
    const realSet = mock.chrome.cookies.set.getMockImplementation()!;
    mock.chrome.cookies.set.mockImplementation(async (d: chrome.cookies.SetDetails) => {
      if (d.name === 'sessionKey' && d.value === 'kA') throw new Error('rejected');
      return realSet(d);
    });
    await expect(switchTo(a.id)).rejects.toThrow(/sessionKey/);
    expect(liveKey()).toBe('kB');
    expect((await loadState()).active.claude).toBe(b.id);
    expect(mock.chrome.tabs.reload).not.toHaveBeenCalled();
  });

  it('rejects unknown accounts', async () => {
    await expect(switchTo('missing')).rejects.toThrow('Account not found');
  });
});

describe('loginAnother', () => {
  it('refuses to clear an unsaved logged-in session', async () => {
    setSession('kC');
    await expect(loginAnother('claude')).rejects.toThrow('not saved');
    expect(liveKey()).toBe('kC');
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('keeps the session saved, clears cookies, deactivates and opens the login page', async () => {
    setSession('kA', { marker: 'A2' });
    const a = await saveCurrent('claude');
    mock.state.cookies.find((c) => c.name === 'marker')!.value = 'A3';
    await loginAnother('claude');
    expect(mock.state.cookies).toEqual([]);
    const s = await loadState();
    expect(s.active.claude).toBeNull();
    expect(s.accounts.find((x) => x.id === a.id)?.cookies.find((c) => c.name === 'marker')?.value).toBe('A3');
    expect(mock.chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://claude.ai/login' });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('logout'))).toBe(false);
  });

  it('reuses an open site tab', async () => {
    setSession('kA');
    await saveCurrent('claude');
    mock.state.tabs.push({ id: 5, url: 'https://claude.ai/chat/x' } as chrome.tabs.Tab);
    await loginAnother('claude');
    expect(mock.chrome.tabs.update).toHaveBeenCalledWith(5, { url: 'https://claude.ai/login', active: true });
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe('rename / remove', () => {
  it('renames with trimming and rejects empty labels', async () => {
    setSession('kA');
    const a = await saveCurrent('claude');
    await renameAccount(a.id, '  New  ');
    expect((await loadState()).accounts[0]?.label).toBe('New');
    await expect(renameAccount(a.id, '   ')).rejects.toThrow();
    await expect(renameAccount('missing', 'x')).rejects.toThrow('Account not found');
  });

  it('removes the account and usage, clears active, and leaves browser cookies alone', async () => {
    setSession('kA');
    const a = await saveCurrent('claude');
    const { mutate } = await import('../src/core/storage');
    await mutate((d) => {
      d.usage[a.id] = { usage: null, lastAttemptAt: 1 };
    });
    await removeAccount(a.id);
    const s = await loadState();
    expect(s.accounts).toEqual([]);
    expect(s.usage[a.id]).toBeUndefined();
    expect(s.active.claude).toBeNull();
    expect(liveKey()).toBe('kA');
    expect(mock.chrome.cookies.remove).not.toHaveBeenCalled();
  });
});

describe('withSwitchLock', () => {
  it('runs callers one at a time', async () => {
    const order: string[] = [];
    await Promise.all([
      withSwitchLock(async () => {
        order.push('a-start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('a-end');
      }),
      withSwitchLock(async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
});
