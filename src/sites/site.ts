import { createLock } from '../core/lock';
import type { AccountIdentity, SiteId, StoredCookie, Usage } from '../core/types';

/** Fetch bound to one account's session. Adapters must use this, never global fetch. */
export type SiteFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SiteAdapter {
  id: SiteId;
  name: string;
  homeUrl: string;
  loginUrl: string;
  /** Match patterns for open tabs to reload after a switch. */
  tabUrlPatterns: string[];
  /** Domains passed to chrome.cookies.getAll({ domain }) to collect candidate cookies. */
  cookieDomains: string[];
  /** Final say on which cookies belong to this site's session. */
  cookieFilter(cookie: StoredCookie): boolean;
  /** True when the cookies contain a logged-in session. */
  isLoggedIn(cookies: StoredCookie[]): boolean;
  fetchIdentity(fetch: SiteFetch): Promise<AccountIdentity>;
  /** Only sites with plan limits implement this. */
  fetchUsage?(fetch: SiteFetch, identity: AccountIdentity): Promise<Usage>;
}

/**
 * All extension network calls go through this lock. cookieFetch temporarily injects another
 * account's Cookie header, so no other extension request may run at the same time.
 */
export const netLock = createLock();

/** A hung request would hold netLock forever. */
export const FETCH_TIMEOUT_MS = 15_000;

/** Fetch using the browser's current cookie jar (the active session). */
export const activeFetch: SiteFetch = (url, init) =>
  netLock(() =>
    fetch(url, { credentials: 'include', ...init, signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
  );
