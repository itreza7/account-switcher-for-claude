import { listAdapters } from '../sites';
import { effective, pickNext, staleAfterMs } from './rotation';
import type { SiteId, Settings, Usage } from './types';
import { loadState, mutate } from './storage';
import { switchTo } from './switcher';

export type Decision =
  | { action: 'none' }
  | { action: 'notify' | 'switch'; siteId: SiteId; from: string; to: string; reason: string };

interface DecideInput {
  siteId: SiteId;
  activeId: string | null;
  accounts: { id: string; usage: Usage | null }[];
  settings: Settings;
  now: number;
  lastActionAt: number | null;
}

const NONE: Decision = { action: 'none' };

export function decide(input: DecideInput): Decision {
  const { siteId, activeId, accounts, settings, now, lastActionAt } = input;
  if (settings.autoSwitchMode === 'off') return NONE;
  const active = accounts.find((a) => a.id === activeId);
  if (!active || !active.usage) return NONE;
  if (lastActionAt !== null && now - lastActionAt < settings.cooldownMinutes * 60_000) return NONE;

  const staleAfter = staleAfterMs(settings.pollMinutes);
  const th = settings.threshold;

  if (now - active.usage.fetchedAt > staleAfter) return NONE;
  const five = effective(active.usage.fiveHour, now);
  const week = effective(active.usage.sevenDay, now);
  if (five < th && week < th) return NONE;
  const reason = five >= th ? `5-hour limit at ${Math.round(five)}%` : `weekly limit at ${Math.round(week)}%`;

  const to = pickNext({
    // Plain 'next' could land on a limited account; auto-switch only moves to one with room.
    strategy: settings.rotationStrategy === 'next' ? 'next-available' : settings.rotationStrategy,
    activeId: active.id,
    accounts,
    threshold: th,
    staleAfterMs: staleAfter,
    now,
  });
  if (!to) return NONE;
  return { action: settings.autoSwitchMode, siteId, from: active.id, to, reason };
}

export async function runAutoSwitch(now: number = Date.now()): Promise<void> {
  for (const adapter of listAdapters()) {
    if (!adapter.fetchUsage) continue;
    const state = await loadState();
    const siteAccounts = state.accounts.filter((a) => a.siteId === adapter.id);
    const decision = decide({
      siteId: adapter.id,
      activeId: state.active[adapter.id] ?? null,
      accounts: siteAccounts.map((a) => ({ id: a.id, usage: state.usage[a.id]?.usage ?? null })),
      settings: state.settings,
      now,
      lastActionAt: state.autoSwitch.lastActionAt,
    });
    if (decision.action === 'none') continue;

    const target = siteAccounts.find((a) => a.id === decision.to);
    const label = target?.label ?? decision.to;
    const iconUrl = chrome.runtime.getURL('icon-128.png');

    if (decision.action === 'switch') {
      await switchTo(decision.to);
      await chrome.notifications.create(`switched:${decision.to}`, {
        type: 'basic',
        iconUrl,
        title: 'Claude account switched',
        message: `Switched to ${label}: ${decision.reason}`,
      });
    } else {
      await chrome.notifications.create(`autoswitch:${decision.to}`, {
        type: 'basic',
        iconUrl,
        title: 'Claude limit near',
        message: `${decision.reason}. Switch to ${label}?`,
        buttons: [{ title: 'Switch now' }],
        requireInteraction: true,
      });
    }
    await mutate((draft) => {
      draft.autoSwitch.lastActionAt = now;
    });
  }
}
