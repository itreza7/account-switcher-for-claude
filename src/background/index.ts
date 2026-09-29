import { runAutoSwitch } from '../core/autoswitch';
import { RULE_ID } from '../core/fetcher';
import { switchNext } from '../core/rotation';
import type { Handlers, MessageType, Request, Response } from '../core/messages';
import { updateBadge } from '../core/badge';
import { snapshotCookies } from '../core/cookies';
import { getAccount, loadState, mutate, toView } from '../core/storage';
import { loginAnother, reconcileActive, removeAccount, renameAccount, saveCurrent, switchTo } from '../core/switcher';
import { availableUpdate, checkForUpdate } from '../core/update';
import { refreshUsage } from '../core/usage';
import type { AutoSwitchMode, RotationStrategy, Settings, StateView } from '../core/types';
import { listAdapters } from '../sites';
import { friendlyError } from '../ui/errors';
import { t } from '../ui/i18n';

const ALARM = 'poll';
const UPDATE_ALARM = 'update-check';
const MODES: AutoSwitchMode[] = ['off', 'notify', 'switch'];
const STRATEGIES: RotationStrategy[] = ['next', 'next-available', 'best'];

const WELCOME_PAGE = 'src/welcome/index.html';
const BADGE_DEBOUNCE_MS = 150;

const warn = (what: string) => (e: unknown) => console.warn(what, e);

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function sanitize(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof patch.pollMinutes === 'number' && Number.isFinite(patch.pollMinutes))
    out.pollMinutes = clamp(Math.round(patch.pollMinutes), 1, 60);
  if (typeof patch.threshold === 'number' && Number.isFinite(patch.threshold))
    out.threshold = clamp(patch.threshold, 50, 100);
  if (typeof patch.cooldownMinutes === 'number' && Number.isFinite(patch.cooldownMinutes))
    out.cooldownMinutes = clamp(patch.cooldownMinutes, 0, 240);
  if (patch.autoSwitchMode !== undefined && MODES.includes(patch.autoSwitchMode))
    out.autoSwitchMode = patch.autoSwitchMode;
  if (patch.rotationStrategy !== undefined && STRATEGIES.includes(patch.rotationStrategy))
    out.rotationStrategy = patch.rotationStrategy;
  return out;
}

/** Picks up a login done by hand in the browser, so the active account is right before anything reads it. */
async function reconcileAll(): Promise<void> {
  await Promise.all(listAdapters().map((a) => reconcileActive(a).catch(warn('reconcile failed'))));
}

async function ensureAlarm(force = false): Promise<void> {
  const { settings } = await loadState();
  if (!force && (await chrome.alarms.get(ALARM))) return;
  await chrome.alarms.create(ALARM, { periodInMinutes: settings.pollMinutes });
}

async function ensureUpdateAlarm(): Promise<void> {
  if (await chrome.alarms.get(UPDATE_ALARM)) return;
  await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 24 * 60 });
}

function onWorkerEvent(): void {
  void ensureAlarm().catch(warn('alarm setup failed'));
  void ensureUpdateAlarm().catch(warn('update alarm setup failed'));
  void checkForUpdate();
}

export const handlers: Handlers = {
  async getState(): Promise<StateView> {
    await reconcileAll();
    const s = await loadState();
    const adapters = listAdapters();
    // Only a boolean leaves this function; the cookies themselves never do.
    const live = Object.fromEntries(
      await Promise.all(
        adapters.map(async (a) => [a.id, await snapshotCookies(a).then((c) => a.isLoggedIn(c), () => false)] as const),
      ),
    );
    return {
      sites: adapters.map((a) => ({ id: a.id, name: a.name, hasUsage: !!a.fetchUsage })),
      accounts: s.accounts.map(toView),
      active: s.active,
      usage: s.usage,
      settings: s.settings,
      live,
      update: availableUpdate(s.update, chrome.runtime.getManifest().version),
    };
  },
  async saveCurrent(req) {
    const view = await saveCurrent(req.siteId, req.label);
    void refreshUsage(view.id).catch(warn('refreshUsage failed'));
    return view;
  },
  loginAnother: (req) => loginAnother(req.siteId),
  async switch(req) {
    await switchTo(req.accountId);
    void refreshUsage(req.accountId).catch(warn('refreshUsage failed'));
  },
  async switchNext(req) {
    const view = await switchNext(req.siteId);
    void refreshUsage(view.id).catch(warn('refreshUsage failed'));
    return view;
  },
  rename: (req) => renameAccount(req.accountId, req.label),
  remove: (req) => removeAccount(req.accountId),
  refreshUsage: (req) => refreshUsage(req.accountId),
  async updateSettings(req) {
    const patch = sanitize(req.patch);
    const settings = await mutate((draft) => {
      draft.settings = { ...draft.settings, ...patch };
      return draft.settings;
    });
    await ensureAlarm(true);
    return settings;
  },
};

export function onMessage(
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: Response<unknown>) => void,
): boolean {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
    sendResponse({ ok: false, error: 'Forbidden sender' });
    return false;
  }
  const req = msg as Request | null;
  const handler = req && Object.hasOwn(handlers, req.type) ? handlers[req.type as MessageType] : undefined;
  if (!handler) {
    sendResponse({ ok: false, error: `Unknown message type: ${String(req?.type)}` });
    return false;
  }
  (handler as (r: unknown) => Promise<unknown>)(req)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
}

export async function onAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name === UPDATE_ALARM) return checkForUpdate();
  if (alarm.name !== ALARM) return;
  try {
    await reconcileAll();
    await refreshUsage();
    await runAutoSwitch();
  } catch (e) {
    console.warn('poll failed', e);
  }
}

export async function onNotificationButton(id: string, buttonIndex: number): Promise<void> {
  const prefix = 'autoswitch:';
  if (!id.startsWith(prefix) || buttonIndex !== 0) return;
  const accountId = id.slice(prefix.length);
  try {
    if (await getAccount(accountId)) {
      await switchTo(accountId);
      await mutate((d) => {
        d.autoSwitch.lastActionAt = Date.now();
      });
      void refreshUsage(accountId).catch(warn('refreshUsage failed'));
    }
  } catch (e) {
    console.warn('notification switch failed', e);
  } finally {
    await chrome.notifications.clear(id);
  }
}

/** Keyboard shortcut: rotate the Claude site, and say what happened (there is no popup to show it). */
export async function onCommand(command: string): Promise<void> {
  if (command !== 'switch-next') return;
  const iconUrl = chrome.runtime.getURL('icon-128.png');
  try {
    const view = await handlers.switchNext({ siteId: 'claude' });
    await chrome.notifications.clear('rotated');
    await chrome.notifications.create('rotated', {
      type: 'basic',
      iconUrl,
      title: t('bg_switched_title'),
      message: t('bg_rotated_message', { name: view.label }),
    });
  } catch (e) {
    await chrome.notifications.clear('rotate-failed');
    await chrome.notifications.create('rotate-failed', {
      type: 'basic',
      iconUrl,
      title: t('bg_rotateFailed_title'),
      message: friendlyError(e),
    });
  }
}

/** First install: show the welcome page. Updates and restarts stay quiet. */
export function onInstalled(details: chrome.runtime.InstalledDetails): void {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_PAGE) }).catch(warn('welcome page failed'));
  }
  onWorkerEvent();
}

let badgeTimer: ReturnType<typeof setTimeout> | undefined;

/** Re-draws the toolbar badge when stored state changes. Only key names are checked, never the payload. */
export function onStorageChanged(changes: Record<string, unknown>, area: string): void {
  if (area !== 'local' || !('state' in changes)) return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => void updateBadge().catch(warn('badge update failed')), BADGE_DEBOUNCE_MS);
}

chrome.runtime.onMessage.addListener(onMessage);
chrome.commands.onCommand.addListener((c) => void onCommand(c));
chrome.runtime.onInstalled.addListener(onInstalled);
chrome.runtime.onStartup.addListener(onWorkerEvent);
chrome.storage.onChanged.addListener(onStorageChanged);
chrome.alarms.onAlarm.addListener((a) => void onAlarm(a));
chrome.notifications.onButtonClicked.addListener((id, i) => void onNotificationButton(id, i));
void ensureAlarm().catch(warn('alarm setup failed'));
void ensureUpdateAlarm().catch(warn('update alarm setup failed'));
void updateBadge().catch(warn('badge update failed'));
// Session rules survive a worker restart; drop a cookie rule left behind by a killed cookieFetch.
void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }).catch(warn('rule cleanup failed'));
