import { vi } from 'vitest';
import raw from '../public/_locales/en/messages.json' with { type: 'json' };

/** The real English catalog, keyed case-insensitively like chrome.i18n. */
const catalog: Record<string, string> = Object.fromEntries(
  Object.entries(raw as Record<string, { message: string }>).map(([k, v]) => [k.toLowerCase(), v.message]),
);

type Cookie = chrome.cookies.Cookie;

/** Chrome's domain-match rule used by cookies.getAll({ domain }). */
function domainMatches(cookieDomain: string, domain: string): boolean {
  const c = cookieDomain.replace(/^\./, '');
  return c === domain || c.endsWith('.' + domain);
}

/**
 * Minimal in-memory fake of the chrome.* APIs this extension uses.
 * Call installChromeMock() in beforeEach; it replaces globalThis.chrome and returns the backing state.
 */
export function installChromeMock() {
  const state = {
    storage: {} as Record<string, unknown>,
    cookies: [] as Cookie[],
    tabs: [] as chrome.tabs.Tab[],
    sessionRules: [] as chrome.declarativeNetRequest.Rule[],
    alarms: {} as Record<string, chrome.alarms.AlarmCreateInfo>,
    notifications: {} as Record<string, chrome.notifications.NotificationOptions>,
    badge: { text: '', color: '' as string | number[], textColor: '' as string | number[], title: '' },
  };

  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

  const chromeMock = {
    runtime: {
      id: 'test-extension-id',
      getManifest: vi.fn(() => ({ version: '0.1.0' })),
      getURL: (p: string) => `chrome-extension://test-extension-id/${p.replace(/^\//, '')}`,
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      openOptionsPage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          if (keys == null) return clone(state.storage);
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in state.storage) out[k] = clone(state.storage[k]);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) state.storage[k] = clone(v);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state.storage[k];
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    cookies: {
      getAll: vi.fn(async (details: { domain?: string; name?: string } = {}) =>
        state.cookies
          .filter((c) => (details.domain ? domainMatches(c.domain, details.domain) : true))
          .filter((c) => (details.name ? c.name === details.name : true))
          .map(clone),
      ),
      remove: vi.fn(async ({ url, name }: { url: string; name: string }) => {
        const host = new URL(url).hostname;
        const i = state.cookies.findIndex((c) => c.name === name && c.domain.replace(/^\./, '') === host);
        if (i >= 0) return { url, name, storeId: '0', ...{ removed: state.cookies.splice(i, 1) } };
        return null;
      }),
      set: vi.fn(async (d: chrome.cookies.SetDetails) => {
        const host = new URL(d.url).hostname;
        const hostOnly = d.domain === undefined;
        const domain = hostOnly ? host : d.domain!.startsWith('.') ? d.domain! : '.' + d.domain;
        const cookie: Cookie = {
          name: d.name ?? '',
          value: d.value ?? '',
          domain,
          hostOnly,
          path: d.path ?? '/',
          secure: d.secure ?? false,
          httpOnly: d.httpOnly ?? false,
          sameSite: d.sameSite ?? 'unspecified',
          session: d.expirationDate === undefined,
          expirationDate: d.expirationDate,
          storeId: '0',
        };
        state.cookies = state.cookies.filter(
          (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path),
        );
        state.cookies.push(cookie);
        return clone(cookie);
      }),
    },
    tabs: {
      query: vi.fn(async (q: { url?: string | string[] } = {}) => {
        if (!q.url) return clone(state.tabs);
        const patterns = (Array.isArray(q.url) ? q.url : [q.url]).map(
          (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'),
        );
        return clone(state.tabs.filter((t) => t.url && patterns.some((r) => r.test(t.url!))));
      }),
      reload: vi.fn(async () => {}),
      create: vi.fn(async (p: { url?: string }) => {
        const tab = { id: state.tabs.length + 1, url: p.url } as chrome.tabs.Tab;
        state.tabs.push(tab);
        return clone(tab);
      }),
      update: vi.fn(async (id: number, p: { url?: string; active?: boolean }) => {
        const tab = state.tabs.find((t) => t.id === id);
        if (tab && p.url) tab.url = p.url;
        return clone(tab);
      }),
      TAB_ID_NONE: -1,
    },
    declarativeNetRequest: {
      updateSessionRules: vi.fn(
        async (o: { removeRuleIds?: number[]; addRules?: chrome.declarativeNetRequest.Rule[] }) => {
          state.sessionRules = state.sessionRules.filter((r) => !o.removeRuleIds?.includes(r.id));
          state.sessionRules.push(...(o.addRules ?? []).map(clone));
        },
      ),
      getSessionRules: vi.fn(async () => clone(state.sessionRules)),
    },
    alarms: {
      create: vi.fn(async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
        state.alarms[name] = info;
      }),
      clear: vi.fn(async (name: string) => delete state.alarms[name]),
      get: vi.fn(async (name: string) => (state.alarms[name] ? { name, ...state.alarms[name] } : undefined)),
      onAlarm: { addListener: vi.fn() },
    },
    commands: { onCommand: { addListener: vi.fn() }, getAll: vi.fn(async () => []) },
    i18n: {
      getMessage: vi.fn((key: string) => {
        if (key === '@@bidi_dir') return 'ltr';
        if (key === '@@ui_locale') return 'en';
        return catalog[key.toLowerCase()] ?? '';
      }),
      getUILanguage: vi.fn(() => 'en'),
    },
    action: {
      setBadgeText: vi.fn(async ({ text }: { text: string }) => {
        state.badge.text = text;
      }),
      setBadgeBackgroundColor: vi.fn(async ({ color }: { color: string | number[] }) => {
        state.badge.color = color;
      }),
      setBadgeTextColor: vi.fn(async ({ color }: { color: string | number[] }) => {
        state.badge.textColor = color;
      }),
      setTitle: vi.fn(async ({ title }: { title: string }) => {
        state.badge.title = title;
      }),
    },
    notifications: {
      create: vi.fn(async (id: string, opts: chrome.notifications.NotificationOptions) => {
        state.notifications[id] = opts;
        return id;
      }),
      clear: vi.fn(async (id: string) => delete state.notifications[id]),
      onButtonClicked: { addListener: vi.fn() },
      onClicked: { addListener: vi.fn() },
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
  return { chrome: chromeMock, state };
}

export function makeCookie(partial: Partial<Cookie> & Pick<Cookie, 'name' | 'domain'>): Cookie {
  return {
    value: 'v',
    hostOnly: !partial.domain.startsWith('.'),
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: false,
    expirationDate: 4102444800,
    storeId: '0',
    ...partial,
  };
}
