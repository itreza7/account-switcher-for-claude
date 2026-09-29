import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type StoreState } from '../src/core/types';
import { installChromeMock, makeCookie } from './chrome-mock';

const sw = {
  saveCurrent: vi.fn(),
  loginAnother: vi.fn(),
  switchTo: vi.fn(async (_id: string) => {}),
  renameAccount: vi.fn(),
  removeAccount: vi.fn(),
  withSwitchLock: vi.fn(),
  reconcileActive: vi.fn(async (_adapter: unknown) => {}),
};
vi.mock('../src/core/switcher', () => ({
  saveCurrent: (...a: unknown[]) => sw.saveCurrent(...a),
  loginAnother: (...a: unknown[]) => sw.loginAnother(...a),
  switchTo: (id: string) => sw.switchTo(id),
  renameAccount: (...a: unknown[]) => sw.renameAccount(...a),
  removeAccount: (...a: unknown[]) => sw.removeAccount(...a),
  withSwitchLock: (fn: () => unknown) => sw.withSwitchLock(fn),
  reconcileActive: (a: unknown) => sw.reconcileActive(a),
}));
const refreshUsage = vi.fn(async (_id?: string) => {});
vi.mock('../src/core/usage', () => ({ refreshUsage: (id?: string) => refreshUsage(id) }));
const runAutoSwitch = vi.fn(async () => {});
vi.mock('../src/core/autoswitch', () => ({ runAutoSwitch: () => runAutoSwitch() }));
const switchNext = vi.fn(async (_siteId: string): Promise<unknown> => ({ id: 'n', label: 'Next one' }));
vi.mock('../src/core/rotation', async (orig) => ({
  ...(await orig<typeof import('../src/core/rotation')>()),
  switchNext: (siteId: string) => switchNext(siteId),
}));
const updateBadge = vi.fn(async () => {});
vi.mock('../src/core/badge', () => ({ updateBadge: () => updateBadge() }));
const checkForUpdate = vi.fn(async () => {});
vi.mock('../src/core/update', async (orig) => ({
  ...(await orig<typeof import('../src/core/update')>()),
  checkForUpdate: () => checkForUpdate(),
}));

let mock: ReturnType<typeof installChromeMock>;
let bg: typeof import('../src/background/index');

const GOOD = { id: 'test-extension-id', url: 'chrome-extension://test-extension-id/src/popup/index.html' };

function call(msg: unknown, sender: chrome.runtime.MessageSender = GOOD) {
  return new Promise<{ res: unknown; async: boolean }>((resolve) => {
    let ret: boolean | undefined;
    let pending: unknown;
    let got = false;
    const done = () => resolve({ res: pending, async: ret as boolean });
    ret = bg.onMessage(msg, sender, (res) => {
      pending = res;
      got = true;
      if (ret !== undefined) done();
    });
    if (got) done();
  });
}

const acc = (id: string) => ({ id, siteId: 'claude', label: `L${id}`, identity: { key: id }, cookies: [{ name: 'secret' }], createdAt: 1, updatedAt: 1 });

beforeEach(async () => {
  mock = installChromeMock();
  vi.clearAllMocks();
  vi.resetModules();
  bg = await import('../src/background/index');
});

describe('listeners', () => {
  it('registers everything synchronously at import and creates the poll alarm', async () => {
    expect(mock.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.notifications.onButtonClicked.addListener).toHaveBeenCalledTimes(1);
    expect(mock.chrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mock.state.alarms.poll).toEqual({ periodInMinutes: DEFAULT_SETTINGS.pollMinutes }));
    await vi.waitFor(() => expect(mock.state.alarms['update-check']).toEqual({ periodInMinutes: 24 * 60 }));
  });
});

describe('welcome page', () => {
  const WELCOME = 'chrome-extension://test-extension-id/src/welcome/index.html';

  it('opens on first install only', async () => {
    bg.onInstalled({ reason: 'install' });
    expect(mock.chrome.tabs.create).toHaveBeenCalledWith({ url: WELCOME });
    mock.chrome.tabs.create.mockClear();
    bg.onInstalled({ reason: 'update', previousVersion: '0.0.9' });
    bg.onInstalled({ reason: 'chrome_update' });
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('is what the onInstalled listener runs, and still sets up alarms', async () => {
    const listener = mock.chrome.runtime.onInstalled.addListener.mock.calls[0]![0] as typeof bg.onInstalled;
    mock.state.alarms = {};
    listener({ reason: 'update', previousVersion: '0.0.9' });
    await vi.waitFor(() => expect(mock.state.alarms.poll).toBeDefined());
    expect(mock.chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe('toolbar badge', () => {
  afterEach(() => vi.useRealTimers());

  it('draws once at start', () => {
    expect(updateBadge).toHaveBeenCalledTimes(1);
  });

  it('redraws once, debounced, when the state key changes in local storage', async () => {
    vi.useFakeTimers();
    updateBadge.mockClear();
    const listener = mock.chrome.storage.onChanged.addListener.mock.calls[0]![0] as typeof bg.onStorageChanged;
    listener({ state: {} }, 'local');
    listener({ state: {} }, 'local');
    expect(updateBadge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(updateBadge).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys and other areas', async () => {
    vi.useFakeTimers();
    updateBadge.mockClear();
    bg.onStorageChanged({ other: {} }, 'local');
    bg.onStorageChanged({ state: {} }, 'sync');
    await vi.advanceTimersByTimeAsync(500);
    expect(updateBadge).not.toHaveBeenCalled();
  });
});

describe('onMessage', () => {
  it('rejects a foreign sender id, a content-script/web sender url, and a missing url', async () => {
    for (const sender of [
      { id: 'evil', url: GOOD.url },
      { id: GOOD.id, url: 'https://claude.ai/' },
      { id: GOOD.id },
    ]) {
      const { res, async } = await call({ type: 'getState' }, sender);
      expect(res).toMatchObject({ ok: false });
      expect(async).toBe(false);
    }
  });

  it('getState returns sites, secret-free accounts, usage and settings', async () => {
    mock.state.storage.state = {
      schemaVersion: 1,
      accounts: [acc('a')],
      active: { claude: 'a' },
      usage: {},
      settings: {},
      autoSwitch: { lastActionAt: null },
    };
    const { res, async } = await call({ type: 'getState' });
    expect(async).toBe(true);
    const r = res as { ok: true; data: { sites: { id: string; hasUsage: boolean }[]; accounts: object[]; active: object; settings: object; update: unknown } };
    expect(r.ok).toBe(true);
    expect(r.data.sites.find((s) => s.id === 'claude')?.hasUsage).toBe(true);
    expect(r.data.accounts).toEqual([{ id: 'a', siteId: 'claude', label: 'La', identity: { key: 'a' }, createdAt: 1, updatedAt: 1 }]);
    expect(r.data.active).toEqual({ claude: 'a' });
    expect(r.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(r.data.update).toBeNull();
  });

  it('getState reports live per site from the session cookie and never leaks cookie values', async () => {
    const off = (await call({ type: 'getState' })).res as { data: { live: Record<string, boolean> } };
    expect(off.data.live.claude).toBe(false);

    mock.state.cookies = [makeCookie({ name: 'sessionKey', domain: '.claude.ai', value: 'sk-secret-value-123' })];
    const on = (await call({ type: 'getState' })).res as { data: { live: Record<string, boolean> } };
    expect(on.data.live.claude).toBe(true);
    expect(JSON.stringify(on)).not.toContain('sk-secret-value-123');
  });

  it('getState reconciles the active account for every site before reading state', async () => {
    await call({ type: 'getState' });
    expect(sw.reconcileActive.mock.calls.map((c) => (c[0] as { id: string }).id).sort()).toEqual(['claude', 'console']);
  });

  it('getState still answers when reconciling fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sw.reconcileActive.mockRejectedValueOnce(new Error('x'));
    expect(((await call({ type: 'getState' })).res as { ok: boolean }).ok).toBe(true);
    warn.mockRestore();
  });

  it('getState offers an update only when the release is newer than the installed 0.1.0', async () => {
    const url = 'https://github.com/itreza7/account-switcher-for-claude/releases/tag/v0.2.0';
    const withRelease = (latestVersion: string) => {
      mock.state.storage.state = { schemaVersion: 1, update: { latestVersion, url, checkedAt: 1 } };
    };
    withRelease('0.2.0');
    expect((await call({ type: 'getState' })).res).toMatchObject({ data: { update: { version: '0.2.0', url } } });
    withRelease('0.1.0');
    expect((await call({ type: 'getState' })).res).toMatchObject({ data: { update: null } });
  });

  it('errors from handlers become { ok: false }', async () => {
    sw.removeAccount.mockRejectedValueOnce(new Error('nope'));
    expect((await call({ type: 'remove', accountId: 'x' })).res).toEqual({ ok: false, error: 'nope' });
  });

  it('unknown type is rejected', async () => {
    expect((await call({ type: 'constructor' })).res).toMatchObject({ ok: false });
  });

  it('saveCurrent and switch trigger a background usage refresh', async () => {
    sw.saveCurrent.mockResolvedValueOnce({ id: 'n' });
    const s = await call({ type: 'saveCurrent', siteId: 'claude', label: 'x' });
    expect(s.res).toEqual({ ok: true, data: { id: 'n' } });
    expect(sw.saveCurrent).toHaveBeenCalledWith('claude', 'x');
    expect(refreshUsage).toHaveBeenCalledWith('n');
    await call({ type: 'switch', accountId: 'b' });
    expect(sw.switchTo).toHaveBeenCalledWith('b');
    expect(refreshUsage).toHaveBeenCalledWith('b');
  });

  it('refreshUsage message passes the account id', async () => {
    await call({ type: 'refreshUsage', accountId: 'q' });
    expect(refreshUsage).toHaveBeenCalledWith('q');
  });

  it('updateSettings clamps values, re-creates the alarm, and returns settings', async () => {
    const { res } = await call({
      type: 'updateSettings',
      patch: { pollMinutes: 999.4, threshold: 10, cooldownMinutes: -5, autoSwitchMode: 'switch' },
    });
    expect(res).toEqual({
      ok: true,
      data: { ...DEFAULT_SETTINGS, pollMinutes: 60, threshold: 50, cooldownMinutes: 0, autoSwitchMode: 'switch' },
    });
    expect((mock.state.storage.state as StoreState).settings.pollMinutes).toBe(60);
    expect(mock.state.alarms.poll).toEqual({ periodInMinutes: 60 });

    const r2 = await call({ type: 'updateSettings', patch: { pollMinutes: 0, threshold: 500, cooldownMinutes: 1000 } });
    expect(r2.res).toMatchObject({ data: { pollMinutes: 1, threshold: 100, cooldownMinutes: 240 } });
    expect(mock.state.alarms.poll).toEqual({ periodInMinutes: 1 });
  });

  it('updateSettings ignores invalid mode and non-numbers', async () => {
    const { res } = await call({
      type: 'updateSettings',
      patch: { autoSwitchMode: 'bogus', pollMinutes: 'x', threshold: Number.NaN, rotationStrategy: 'random' },
    });
    expect(res).toEqual({ ok: true, data: DEFAULT_SETTINGS });
  });

  it('updateSettings accepts a valid rotation strategy', async () => {
    const { res } = await call({ type: 'updateSettings', patch: { rotationStrategy: 'next-available' } });
    expect(res).toMatchObject({ ok: true, data: { rotationStrategy: 'next-available' } });
  });

  it('switchNext rotates the site, returns the target and refreshes its usage', async () => {
    const { res } = await call({ type: 'switchNext', siteId: 'claude' });
    expect(switchNext).toHaveBeenCalledWith('claude');
    expect(res).toEqual({ ok: true, data: { id: 'n', label: 'Next one' } });
    expect(refreshUsage).toHaveBeenCalledWith('n');
  });
});

describe('keyboard shortcut', () => {
  it('switch-next rotates Claude and notifies the new account', async () => {
    await bg.onCommand('switch-next');
    expect(switchNext).toHaveBeenCalledWith('claude');
    expect(mock.state.notifications.rotated).toMatchObject({ title: 'Claude account switched', message: 'Now using Next one' });
  });

  it('clears the previous notification first so a repeat press shows again', async () => {
    await bg.onCommand('switch-next');
    expect(mock.chrome.notifications.clear).toHaveBeenCalledWith('rotated');
    switchNext.mockRejectedValueOnce(new Error('Account not found'));
    await bg.onCommand('switch-next');
    expect(mock.chrome.notifications.clear).toHaveBeenCalledWith('rotate-failed');
    const clearOrder = mock.chrome.notifications.clear.mock.invocationCallOrder[0]!;
    expect(clearOrder).toBeLessThan(mock.chrome.notifications.create.mock.invocationCallOrder[0]!);
  });

  it('shows the error when rotation fails', async () => {
    switchNext.mockRejectedValueOnce(new Error('Save at least two accounts first'));
    await bg.onCommand('switch-next');
    expect(mock.state.notifications['rotate-failed']?.title).toBe('Could not switch Claude account');
    expect(mock.state.notifications['rotate-failed']?.message).toBe('Save at least two accounts to switch between them.');
  });

  it('ignores other commands', async () => {
    await bg.onCommand('other');
    expect(switchNext).not.toHaveBeenCalled();
  });
});

describe('alarm', () => {
  it('update-check alarm checks GitHub and does not poll usage', async () => {
    await bg.onAlarm({ name: 'update-check', scheduledTime: 0, persistAcrossSessions: false });
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(refreshUsage).not.toHaveBeenCalled();
  });

  it('poll alarm refreshes usage then runs auto-switch; ignores other alarms', async () => {
    await bg.onAlarm({ name: 'other', scheduledTime: 0, persistAcrossSessions: false });
    expect(refreshUsage).not.toHaveBeenCalled();
    await bg.onAlarm({ name: 'poll', scheduledTime: 0, persistAcrossSessions: false });
    expect(refreshUsage).toHaveBeenCalledWith(undefined);
    expect(runAutoSwitch).toHaveBeenCalledTimes(1);
    expect(sw.reconcileActive).toHaveBeenCalledTimes(2);
    expect(sw.reconcileActive.mock.invocationCallOrder[0]!).toBeLessThan(refreshUsage.mock.invocationCallOrder[0]!);
  });

  it('poll errors are caught', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    refreshUsage.mockRejectedValueOnce(new Error('x'));
    await expect(bg.onAlarm({ name: 'poll', scheduledTime: 0, persistAcrossSessions: false })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(runAutoSwitch).not.toHaveBeenCalled();
  });
});

describe('notification button', () => {
  beforeEach(() => {
    mock.state.storage.state = {
      schemaVersion: 1,
      accounts: [acc('b')],
      active: {},
      usage: {},
      settings: {},
      autoSwitch: { lastActionAt: null },
    };
    mock.state.notifications['autoswitch:b'] = {} as chrome.notifications.NotificationOptions;
  });

  it('button 0 on autoswitch:<id> switches, refreshes usage, and clears', async () => {
    await bg.onNotificationButton('autoswitch:b', 0);
    expect(sw.switchTo).toHaveBeenCalledWith('b');
    expect(refreshUsage).toHaveBeenCalledWith('b');
    expect(mock.state.notifications['autoswitch:b']).toBeUndefined();
  });

  it('ignores other ids and buttons', async () => {
    await bg.onNotificationButton('other:b', 0);
    await bg.onNotificationButton('autoswitch:b', 1);
    expect(sw.switchTo).not.toHaveBeenCalled();
  });
});
