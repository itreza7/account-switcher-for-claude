import { switchTo } from './switcher';
import { loadState, toView } from './storage';
import type { AccountView, RotationStrategy, SiteId, Usage, UsageWindow } from './types';

/** A window whose reset time has passed is back to 0. */
export function effective(w: UsageWindow | null, now: number): number {
  if (!w) return 0;
  if (w.resetsAt !== null) {
    const t = Date.parse(w.resetsAt);
    if (!Number.isNaN(t) && t <= now) return 0;
  }
  return w.utilization;
}

export interface PickInput {
  strategy: RotationStrategy;
  activeId: string | null;
  /** In rotation (saved) order. */
  accounts: { id: string; usage: Usage | null }[];
  threshold: number;
  staleAfterMs: number;
  now: number;
}

/** Returns the account to switch to, or null when none qualifies. Never returns the active account. */
export function pickNext(input: PickInput): string | null {
  const { strategy, activeId, accounts, threshold, staleAfterMs, now } = input;
  const start = accounts.findIndex((a) => a.id === activeId);
  // Rotation order: the accounts after the active one, wrapping around.
  const ordered = [...accounts.slice(start + 1), ...accounts.slice(0, Math.max(start, 0))].filter(
    (a) => a.id !== activeId,
  );
  if (strategy === 'next') return ordered[0]?.id ?? null;

  const available = ordered.flatMap((a) => {
    if (!a.usage || now - a.usage.fetchedAt > staleAfterMs) return [];
    const five = effective(a.usage.fiveHour, now);
    const week = effective(a.usage.sevenDay, now);
    return five < threshold && week < threshold ? [{ id: a.id, five, peak: Math.max(five, week) }] : [];
  });
  if (strategy === 'next-available') return available[0]?.id ?? null;

  // 'best': saved order (not rotation order) breaks ties, so the result does not depend on who is active.
  const pos = (id: string) => accounts.findIndex((a) => a.id === id);
  available.sort((a, b) => a.peak - b.peak || a.five - b.five || pos(a.id) - pos(b.id));
  return available[0]?.id ?? null;
}

export const staleAfterMs = (pollMinutes: number) => 2 * pollMinutes * 60_000;

export async function switchNext(siteId: SiteId, now: number = Date.now()): Promise<AccountView> {
  const state = await loadState();
  const accounts = state.accounts.filter((a) => a.siteId === siteId);
  const to = pickNext({
    strategy: state.settings.rotationStrategy,
    activeId: state.active[siteId] ?? null,
    accounts: accounts.map((a) => ({ id: a.id, usage: state.usage[a.id]?.usage ?? null })),
    threshold: state.settings.threshold,
    staleAfterMs: staleAfterMs(state.settings.pollMinutes),
    now,
  });
  const target = accounts.find((a) => a.id === to);
  if (!target) {
    throw new Error(
      accounts.length < 2
        ? 'Save at least two accounts first'
        : 'No other account is available (all near limit or no usage data)',
    );
  }
  await switchTo(target.id);
  return toView(target);
}
