import { t } from '../ui/i18n';
import { effective, staleAfterMs } from './rotation';
import { loadState } from './storage';

const SITE = 'claude';
// Fills chosen for white text (WCAG AA).
const COLORS = { danger: '#C93C32', warn: '#9A6400', ok: '#226A3E', stale: '#5F5D58', text: '#FFFFFF' };
/** Percent at which the badge turns amber, below the user's threshold. */
const WARN_AT = 70;

function levelColor(percent: number, threshold: number, stale: boolean): string {
  if (stale) return COLORS.stale;
  if (percent >= threshold) return COLORS.danger;
  if (percent >= WARN_AT) return COLORS.warn;
  return COLORS.ok;
}

async function clearBadge(): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ text: '' }),
    chrome.action.setTitle({ title: t('extActionTitle') }),
  ]);
}

/**
 * Shows the active Claude account's usage on the toolbar icon: the higher of the 5-hour and weekly
 * windows, since that one blocks first. Clears it when there is nothing to show.
 */
export async function updateBadge(now: number = Date.now()): Promise<void> {
  const state = await loadState();
  const id = state.active[SITE];
  const account = id ? state.accounts.find((a) => a.id === id) : undefined;
  const usage = account ? state.usage[account.id]?.usage : null;
  if (!account || !usage) return clearBadge();

  const { threshold, pollMinutes } = state.settings;
  const five = usage.fiveHour ? Math.round(effective(usage.fiveHour, now)) : null;
  const week = usage.sevenDay ? Math.round(effective(usage.sevenDay, now)) : null;
  if (five === null && week === null) return clearBadge();
  const percent = Math.max(five ?? 0, week ?? 0);
  const weekLimits = week !== null && week > (five ?? 0);
  const stale = now - usage.fetchedAt > staleAfterMs(pollMinutes);
  const windows: string[] = [];
  if (five !== null) windows.push(t('bg_badge_window', { window: t('common_fiveHour'), percent: five }));
  if (week !== null) {
    const args = { window: t('common_weekly'), percent: week };
    windows.push(weekLimits ? t('bg_badge_windowLimiting', args) : t('bg_badge_window', args));
  }
  const lines = [account.label, windows.join(' · ')];
  if (stale) lines.push(t('bg_badge_stale'));

  await Promise.all([
    chrome.action.setBadgeText({ text: `${percent}%` }),
    chrome.action.setBadgeBackgroundColor({ color: levelColor(percent, threshold, stale) }),
    chrome.action.setBadgeTextColor({ color: COLORS.text }),
    chrome.action.setTitle({ title: lines.join('\n') }),
  ]);
}
