import { t } from './i18n';

// Background errors reach the UI as plain message strings, so they are matched by text.
// Each rule names the i18n key to show instead of the raw message.
const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\bHTTP 40[13]\b/, () => t('error_sessionExpired')],
  [/\bHTTP 429\b/, () => t('error_rateLimited')],
  [/\bHTTP 5\d\d\b/, () => t('error_server')],
  [/\bHTTP 4\d\d\b/, () => t('error_usageUnavailable')],
  [/No cookies for/, () => t('error_sessionExpired')],
  [
    /Invalid JSON|Unexpected usage response|No organization found|Missing organization id|Could not read .* identity/,
    () => t('error_usageUnavailable'),
  ],
  [/TimeoutError|timed? ?out|signal is aborted/i, () => t('error_timeout')],
  [/Failed to fetch|NetworkError|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|network/i, () => t('error_offline')],
  [/The current (.+) session is not saved/, (m) => t('error_notSaved', { site: m[1]! })],
  [/Not logged in to (.+)/, (m) => t('error_notLoggedIn', { site: m[1]! })],
  [/Save at least two accounts first/, () => t('error_needTwo')],
  [/No other account is available/, () => t('error_noneAvailable')],
  [/Account not found|Unknown account/, () => t('error_accountGone')],
  [/Label cannot be empty/, () => t('error_emptyLabel')],
  [/Failed to restore cookies/, () => t('error_restoreFailed')],
  [/No response from background|Receiving end does not exist|Extension context invalidated/, () => t('error_noBackground')],
];

export const rawMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A short, user-facing sentence for an error or error message. Unknown errors show a generic line; the raw text goes to the console. */
export function friendlyError(e: unknown): string {
  const raw = rawMessage(e);
  for (const [re, text] of RULES) {
    const m = raw.match(re);
    if (m) return text(m);
  }
  console.warn('Unhandled error', raw);
  return t('error_generic');
}
