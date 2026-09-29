import type { SiteAdapter } from '../sites/site';
import type { StoredCookie } from './types';

function cookieUrl(c: StoredCookie): string {
  return (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
}

function isExpired(c: StoredCookie): boolean {
  return !c.session && c.expirationDate !== undefined && c.expirationDate * 1000 <= Date.now();
}

export async function snapshotCookies(adapter: SiteAdapter): Promise<StoredCookie[]> {
  const seen = new Set<string>();
  const out: StoredCookie[] = [];
  for (const domain of adapter.cookieDomains) {
    for (const c of await chrome.cookies.getAll({ domain })) {
      const id = JSON.stringify([c.name, c.domain, c.path, c.partitionKey ?? null]);
      if (seen.has(id)) continue;
      seen.add(id);
      if (adapter.cookieFilter(c)) out.push(c);
    }
  }
  return out;
}

export async function clearCookies(adapter: SiteAdapter): Promise<void> {
  const cookies = await snapshotCookies(adapter);
  await Promise.all(
    cookies.map((c) =>
      chrome.cookies.remove({
        url: cookieUrl(c),
        name: c.name,
        ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
        ...(c.storeId ? { storeId: c.storeId } : {}),
      }),
    ),
  );
}

export async function restoreCookies(adapter: SiteAdapter, cookies: StoredCookie[]): Promise<void> {
  const failed: string[] = [];
  for (const c of cookies) {
    if (!adapter.cookieFilter(c) || isExpired(c)) continue;
    const details: chrome.cookies.SetDetails = {
      url: cookieUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
    };
    if (c.sameSite !== 'unspecified') details.sameSite = c.sameSite;
    if (!c.hostOnly) details.domain = c.domain;
    if (!c.session && c.expirationDate !== undefined) details.expirationDate = c.expirationDate;
    if (c.partitionKey) details.partitionKey = c.partitionKey;
    try {
      // chrome.cookies.set resolves null (and sets lastError) when Chrome rejects the cookie.
      const res = await chrome.cookies.set(details);
      if (!res) failed.push(c.name);
    } catch {
      failed.push(c.name);
    }
  }
  if (failed.length) throw new Error(`Failed to restore cookies: ${failed.join(', ')}`);
}

export function cookieHeaderFor(url: string, cookies: StoredCookie[]): string {
  const u = new URL(url);
  const host = u.hostname;
  const isHttps = u.protocol === 'https:';
  return cookies
    .filter((c) => {
      if (isExpired(c)) return false;
      if (c.secure && !isHttps) return false;
      const d = c.domain.replace(/^\./, '');
      const domainOk = c.hostOnly ? host === d : host === d || host.endsWith('.' + d);
      return domainOk && pathMatches(u.pathname, c.path);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}
