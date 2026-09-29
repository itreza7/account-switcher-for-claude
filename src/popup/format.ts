import type { UsageWindow } from '../core/types';
import { t } from '../ui/i18n';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const WARN_PCT = 70;

export function formatDuration(ms: number): string {
  if (ms < MIN) return t('popup_durLessThanMin');
  if (ms >= DAY) return t('popup_durDaysHours', { d: Math.floor(ms / DAY), h: Math.floor((ms % DAY) / HOUR) });
  if (ms >= HOUR) return t('popup_durHoursMinutes', { h: Math.floor(ms / HOUR), m: Math.floor((ms % HOUR) / MIN) });
  return t('popup_durMinutes', { m: Math.floor(ms / MIN) });
}

/** Time left until a reset, or null when unknown or already past. */
function msUntil(resetsAt: string | null, now: number): number | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  return Number.isNaN(at) ? null : at - now;
}

/** "resets in 2h 13m", "reset" once passed, '' when unknown. */
export function formatResetsIn(resetsAt: string | null, now: number): string {
  const left = msUntil(resetsAt, now);
  if (left === null) return '';
  if (left <= 0) return t('popup_reset');
  return t('popup_resetsIn', { time: formatDuration(left) });
}

/** "Resets in 2h 13m" for the row sub-line. '' when unknown or already past. */
export function formatWindowResets(resetsAt: string | null, now: number): string {
  const left = msUntil(resetsAt, now);
  return left === null || left <= 0 ? '' : t('popup_windowResets', { time: formatDuration(left) });
}

export function formatAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < MIN) return t('popup_justNow');
  return t('popup_ago', { time: formatDuration(diff) });
}

export type UsageLevel = 'ok' | 'warn' | 'danger';

export function usageLevel(pct: number, threshold: number): UsageLevel {
  if (pct >= threshold) return 'danger';
  if (pct >= WARN_PCT) return 'warn';
  return 'ok';
}

/** A window that already reset is back to 0 even if the cached value is stale. */
export function effectivePct(window: UsageWindow, now: number): number {
  if (window.resetsAt) {
    const t = Date.parse(window.resetsAt);
    if (!Number.isNaN(t) && t <= now) return 0;
  }
  return window.utilization;
}
