import type { SiteId, Usage, UsageWindow } from '../core/types';
import { effectivePct, usageLevel, type UsageLevel } from './format';

/** Number of avatar colors in theme.css (--avatar-0 .. --avatar-7). */
export const AVATAR_COLORS = 8;

/** 1-2 uppercase letters for an avatar: first letters of the first two words, else the first letter. */
export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0]!);
  return letters.length ? letters.join('').toUpperCase() : '?';
}

/** Stable color slot for an identity key (FNV-1a hash), so an account keeps its color. */
export function avatarIndex(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % AVATAR_COLORS;
}

/** The email is worth showing only when it adds information beyond the label. */
export function showEmail(label: string, email: string | undefined): email is string {
  return !!email && email.trim().toLowerCase() !== label.trim().toLowerCase();
}

/** Usage is stale when it is older than two poll intervals. */
export function isStale(fetchedAt: number, pollMinutes: number, now: number): boolean {
  return now - fetchedAt > 2 * pollMinutes * 60_000;
}

export interface WindowView {
  /** Rounded percent used, 0-100. */
  pct: number;
  level: UsageLevel;
}

export function windowView(w: UsageWindow, threshold: number, now: number): WindowView {
  const pct = effectivePct(w, now);
  return { pct: Math.round(pct), level: usageLevel(pct, threshold) };
}

export interface ResetHint {
  window: 'fiveHour' | 'sevenDay';
  level: 'warn' | 'danger';
  resetsAt: string;
}

/** The window to explain in the row: the one with the highest use that is at warn or danger and has a known reset time. */
export function resetHint(usage: Usage | null | undefined, threshold: number, now: number): ResetHint | null {
  if (!usage) return null;
  let best: (ResetHint & { pct: number }) | null = null;
  for (const [window, w] of [['fiveHour', usage.fiveHour], ['sevenDay', usage.sevenDay]] as const) {
    if (!w?.resetsAt) continue;
    const pct = effectivePct(w, now);
    const level = usageLevel(pct, threshold);
    if (level === 'ok' || (best && pct <= best.pct)) continue;
    best = { window, level, resetsAt: w.resetsAt, pct };
  }
  return best && { window: best.window, level: best.level, resetsAt: best.resetsAt };
}

/** Opening the popup refreshes usage unless all known usage is newer than half a poll interval. */
export function needsAutoRefresh(entries: { usage: { fetchedAt: number } | null }[], pollMinutes: number, now: number): boolean {
  const known = entries.filter((e) => e.usage);
  if (known.length === 0) return true;
  return known.some((e) => now - e.usage!.fetchedAt >= (pollMinutes / 2) * 60_000);
}

/** Moves an index by an arrow/Home/End key inside a list, wrapping at the ends. Null when the key is not handled. */
export function stepIndex(current: number, count: number, key: string, keys: { prev: string; next: string }): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === keys.next) return (current + 1) % count;
  if (key === keys.prev) return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

export type SiteAction = 'save' | 'login';

/** Saving comes first when the browser holds a session that is not saved yet. */
export function siteAction(live: boolean, activeId: string | null): SiteAction {
  return live && activeId === null ? 'save' : 'login';
}

/** Sites that get a tab: the first always, others only once they have an account. */
export function visibleSites<S extends { id: SiteId }>(sites: S[], accounts: { siteId: SiteId }[]): S[] {
  return sites.filter((s, i) => i === 0 || accounts.some((a) => a.siteId === s.id));
}
