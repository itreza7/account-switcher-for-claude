import type { UsageWindow } from '../core/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const WARN_PCT = 70;

export function formatDuration(ms: number): string {
  if (ms < MIN) return '<1m';
  if (ms >= DAY) {
    const d = Math.floor(ms / DAY);
    return `${d}d ${Math.floor((ms % DAY) / HOUR)}h`;
  }
  if (ms >= HOUR) {
    const h = Math.floor(ms / HOUR);
    return `${h}h ${Math.floor((ms % HOUR) / MIN)}m`;
  }
  return `${Math.floor(ms / MIN)}m`;
}

export function formatResetsIn(resetsAt: string | null, now: number): string {
  if (!resetsAt) return '';
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return '';
  if (t <= now) return 'reset';
  return `resets in ${formatDuration(t - now)}`;
}

export function formatAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  if (diff < MIN) return 'just now';
  return `${formatDuration(diff)} ago`;
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
