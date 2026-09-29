import { getAdapter } from '../sites';
import { activeFetch } from '../sites/site';
import type { SiteAdapter } from '../sites/site';
import { clearCookies, restoreCookies, snapshotCookies } from './cookies';
import { createLock } from './lock';
import { getAccount, loadState, mutate, toView } from './storage';
import type { AccountIdentity, AccountView, SiteId, StoreState } from './types';

const lock = createLock();

/** Cookie swaps must never interleave. switchTo/loginAnother/saveCurrent already take it; do not nest them inside this. */
export function withSwitchLock<T>(fn: () => Promise<T>): Promise<T> {
  return lock(fn);
}

/**
 * Save the live cookies into the saved account they belong to (matched by identity, so a manual
 * login never overwrites a different account) and mark that account active. Caller must hold the
 * switch lock. Returns that account id, or null when logged out or the identity can't be read.
 * Throws when the live session is an account that is not saved, so callers never wipe it.
 */
export async function syncLiveSession(adapter: SiteAdapter): Promise<string | null> {
  const cookies = await snapshotCookies(adapter);
  if (!adapter.isLoggedIn(cookies)) return null;
  let identity: AccountIdentity;
  try {
    identity = await adapter.fetchIdentity(activeFetch);
  } catch {
    // Offline or expired session: nothing worth keeping, and it must not block switching.
    return null;
  }
  const state = await loadState();
  const match = state.accounts.find((a) => a.siteId === adapter.id && a.identity.key === identity.key);
  if (!match) {
    // The browser is on an account we don't know, so no saved account is active any more.
    await mutate((d) => {
      d.active[adapter.id] = null;
    });
    throw new Error(`The current ${adapter.name} session is not saved. Save it first.`);
  }
  await mutate((d) => {
    const a = d.accounts.find((x) => x.id === match.id);
    if (!a) return;
    a.cookies = cookies;
    a.identity = identity;
    a.updatedAt = Date.now();
    d.active[adapter.id] = a.id;
  });
  return match.id;
}

/**
 * Re-points the active account at whichever saved account owns the live session, with no network
 * call: the live session token is compared with the saved ones. A logged-out browser leaves the
 * active account alone (loginAnother and the user's next login decide); an unknown token clears it.
 */
export async function reconcileActive(adapter: SiteAdapter): Promise<void> {
  const live = adapter.sessionToken(await snapshotCookies(adapter));
  if (live === undefined) return;
  const target = (s: StoreState): string | null => {
    const active = s.accounts.find((a) => a.id === s.active[adapter.id]);
    if (active && adapter.sessionToken(active.cookies) === live) return active.id;
    return s.accounts.find((a) => a.siteId === adapter.id && adapter.sessionToken(a.cookies) === live)?.id ?? null;
  };
  // Most calls change nothing, so skip the write (and the storage event it fires).
  const before = await loadState();
  if (target(before) === (before.active[adapter.id] ?? null)) return;
  await mutate((d) => {
    d.active[adapter.id] = target(d);
  });
}

async function reloadTabs(adapter: SiteAdapter): Promise<void> {
  const tabs = await chrome.tabs.query({ url: adapter.tabUrlPatterns });
  await Promise.allSettled(tabs.flatMap((t) => (t.id === undefined ? [] : [chrome.tabs.reload(t.id)])));
}

export function saveCurrent(siteId: SiteId, label?: string): Promise<AccountView> {
  return lock(async () => {
    const adapter = getAdapter(siteId);
    const cookies = await snapshotCookies(adapter);
    if (!adapter.isLoggedIn(cookies)) throw new Error(`Not logged in to ${adapter.name}`);
    const identity = await adapter.fetchIdentity(activeFetch);
    const wanted = label?.trim() || undefined;
    return mutate((d) => {
      const now = Date.now();
      let acc = d.accounts.find((a) => a.siteId === siteId && a.identity.key === identity.key);
      if (acc) {
        acc.cookies = cookies;
        acc.identity = identity;
        acc.updatedAt = now;
        if (wanted) acc.label = wanted;
      } else {
        const n = d.accounts.filter((a) => a.siteId === siteId).length + 1;
        acc = {
          id: crypto.randomUUID(),
          siteId,
          label: wanted ?? identity.email ?? identity.name ?? `Account ${n}`,
          identity,
          cookies,
          createdAt: now,
          updatedAt: now,
        };
        d.accounts.push(acc);
      }
      d.active[siteId] = acc.id;
      return toView(acc);
    });
  });
}

/** Clears the site's cookies and opens the login page. Never calls a logout endpoint, so saved sessions stay valid. */
export function loginAnother(siteId: SiteId): Promise<void> {
  return lock(async () => {
    const adapter = getAdapter(siteId);
    await syncLiveSession(adapter);
    await clearCookies(adapter);
    await mutate((d) => {
      d.active[siteId] = null;
    });
    const tabs = await chrome.tabs.query({ url: adapter.tabUrlPatterns });
    const tabId = tabs.find((t) => t.id !== undefined)?.id;
    if (tabId !== undefined) await chrome.tabs.update(tabId, { url: adapter.loginUrl, active: true });
    else await chrome.tabs.create({ url: adapter.loginUrl });
  });
}

export function switchTo(accountId: string): Promise<void> {
  return lock(async () => {
    const found = await getAccount(accountId);
    if (!found) throw new Error('Account not found');
    const adapter = getAdapter(found.siteId);
    await syncLiveSession(adapter);
    // Re-read: the sync may have just updated this account's cookies (when it is already active).
    const target = (await getAccount(accountId)) ?? found;

    const before = await snapshotCookies(adapter);
    try {
      await clearCookies(adapter);
      await restoreCookies(adapter, target.cookies);
    } catch (err) {
      try {
        await clearCookies(adapter);
        await restoreCookies(adapter, before);
      } catch {
        // Rollback is best effort; report the original failure.
      }
      throw err;
    }
    await mutate((d) => {
      d.active[adapter.id] = target.id;
    });
    await reloadTabs(adapter);
  });
}

export async function renameAccount(accountId: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Label cannot be empty');
  await mutate((d) => {
    const a = d.accounts.find((x) => x.id === accountId);
    if (!a) throw new Error('Account not found');
    a.label = trimmed;
    a.updatedAt = Date.now();
  });
}

/** Removes the saved account only; the browser's cookies are left alone. */
export async function removeAccount(accountId: string): Promise<void> {
  await mutate((d) => {
    const a = d.accounts.find((x) => x.id === accountId);
    if (!a) return;
    d.accounts = d.accounts.filter((x) => x.id !== accountId);
    delete d.usage[accountId];
    if (d.active[a.siteId] === accountId) d.active[a.siteId] = null;
  });
}
