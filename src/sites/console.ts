import type { SiteAdapter } from './site';
import { identityFromOrigin } from './claude';

// Endpoints are unverified guesses; try each host and fail clearly if none answers.
const ORIGINS = ['https://platform.claude.com', 'https://console.anthropic.com'];

export const consoleAdapter: SiteAdapter = {
  id: 'console',
  name: 'Console',
  homeUrl: 'https://platform.claude.com/',
  loginUrl: 'https://platform.claude.com/login',
  tabUrlPatterns: ['https://platform.claude.com/*', 'https://console.anthropic.com/*'],
  cookieDomains: ['anthropic.com', 'claude.com'],
  // Only the parent and platform cookies: other claude.com subdomains are not part of the Console session.
  cookieFilter: (c) =>
    c.domain.endsWith('anthropic.com') || ['claude.com', 'platform.claude.com'].includes(c.domain.replace(/^\./, '')),
  isLoggedIn: (cookies) => cookies.some((c) => c.name === 'sessionKey' && c.value !== ''),
  async fetchIdentity(fetch) {
    for (const origin of ORIGINS) {
      try {
        return await identityFromOrigin(fetch, origin, { withPlan: false });
      } catch {
        // try the next host
      }
    }
    throw new Error('Could not read Console identity');
  },
};
