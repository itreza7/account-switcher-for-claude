import { FETCH_TIMEOUT_MS, netLock, type SiteFetch } from '../sites/site';
import type { StoredCookie } from './types';
import { cookieHeaderFor } from './cookies';

export const RULE_ID = 4242;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Fetch as an account that is NOT the active browser session, by overriding the Cookie header
 * with a one-request-wide DNR session rule. Runs inside netLock so no other extension request
 * can pick up the injected header.
 */
export function cookieFetch(cookies: StoredCookie[]): SiteFetch {
  return (url, init) =>
    netLock(async () => {
      const header = cookieHeaderFor(url, cookies);
      if (!header) throw new Error(`No cookies for ${new URL(url).hostname}`);

      // String literals cast to the enum types: the chrome mock has no runtime enum objects.
      const rule = {
        id: RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'cookie', operation: 'set', value: header }],
        },
        condition: {
          regexFilter: '^' + escapeRegex(url) + '$',
          tabIds: [chrome.tabs.TAB_ID_NONE],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest'],
        },
      } as unknown as chrome.declarativeNetRequest.Rule;

      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: [rule] });
      try {
        return await fetch(url, {
          ...init,
          credentials: 'omit',
          signal: init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } finally {
        await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
      }
    });
}
