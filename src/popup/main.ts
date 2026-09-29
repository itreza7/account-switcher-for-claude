import { send } from '../core/messages';
import type { AccountView, RotationStrategy, SiteView, StateView, UsageEntry, UsageWindow } from '../core/types';
import { effectivePct, formatAgo, formatResetsIn, usageLevel } from './format';

type PropValue = string | boolean | ((e: Event) => void) | undefined;
type Child = Node | string | null | false | undefined;

/** Builds DOM without innerHTML so account data can never be parsed as markup. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, PropValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v as string;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const root = document.getElementById('app') as HTMLElement;

let state: StateView | null = null;
let error: string | null = null;
let refreshing = false;
let busyKey: string | null = null;
let editingId: string | null = null;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function loadState(): Promise<void> {
  try {
    state = await send('getState');
  } catch (e) {
    error = msg(e);
  }
}

async function act(key: string, fn: () => Promise<unknown>): Promise<void> {
  if (busyKey) return;
  busyKey = key;
  error = null;
  render();
  try {
    await fn();
  } catch (e) {
    error = msg(e);
  } finally {
    busyKey = null;
  }
  await loadState();
  render();
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  render();
  try {
    await send('refreshUsage', {});
  } catch (e) {
    error = msg(e);
  } finally {
    refreshing = false;
  }
  await loadState();
  render();
}

function meter(name: string, w: UsageWindow, threshold: number, now: number): HTMLElement {
  const pct = effectivePct(w, now);
  const bar = h('div', {});
  bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'meter-head' },
      h('span', {}, `${name} ${Math.round(pct)}%`),
      h('span', { class: 'reset' }, formatResetsIn(w.resetsAt, now)),
    ),
    h('div', { class: `bar ${usageLevel(pct, threshold)}` }, bar),
  );
}

function usageBlock(entry: UsageEntry | undefined, s: StateView, now: number): HTMLElement {
  const usage = entry?.usage ?? null;
  const parts: Child[] = [];
  if (!usage || (!usage.fiveHour && !usage.sevenDay)) {
    parts.push(h('div', { class: 'muted' }, 'No data yet'));
  } else {
    if (usage.fiveHour) parts.push(meter('5-hour', usage.fiveHour, s.settings.threshold, now));
    if (usage.sevenDay) parts.push(meter('Weekly', usage.sevenDay, s.settings.threshold, now));
    if (now - usage.fetchedAt > 2 * s.settings.pollMinutes * 60_000) {
      parts.push(h('div', { class: 'muted' }, `updated ${formatAgo(usage.fetchedAt, now)}`));
    }
  }
  if (entry?.error) {
    const short = entry.error.length > 80 ? `${entry.error.slice(0, 80)}…` : entry.error;
    parts.push(h('div', { class: 'muted', title: entry.error }, short));
  }
  return h('div', { class: 'usage' }, ...parts);
}

function labelEl(a: AccountView): HTMLElement {
  if (editingId !== a.id) {
    return h('span', { class: 'label', title: a.label, ondblclick: () => startEdit(a.id) }, a.label);
  }
  const input = h('input', { class: 'label-input', value: a.label, maxlength: '80', 'aria-label': 'Account label' });
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    editingId = null;
    const v = input.value.trim();
    if (save && v && v !== a.label) void act(`rename:${a.id}`, () => send('rename', { accountId: a.id, label: v }));
    else render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return input;
}

function startEdit(id: string): void {
  if (busyKey) return;
  editingId = id;
  render(true);
}

function accountRow(a: AccountView, s: StateView, isActive: boolean, hasUsage: boolean, now: number): HTMLElement {
  const busy = busyKey !== null;
  const sub = h(
    'div',
    { class: 'sub' },
    a.identity.email ? h('span', { class: 'email', title: a.identity.email }, a.identity.email) : null,
    a.identity.plan ? h('span', { class: 'badge' }, a.identity.plan) : null,
    isActive ? h('span', { class: 'badge active' }, 'Active') : null,
  );
  return h(
    'div',
    { class: isActive ? 'account active' : 'account' },
    h(
      'div',
      { class: 'row' },
      labelEl(a),
      h('button', { class: 'icon', title: 'Rename', 'aria-label': 'Rename', disabled: busy, onclick: () => startEdit(a.id) }, '✎'),
      isActive
        ? null
        : h(
            'button',
            { disabled: busy, onclick: () => void act(`switch:${a.id}`, () => send('switch', { accountId: a.id })) },
            busyKey === `switch:${a.id}` ? 'Switching…' : 'Switch',
          ),
      h(
        'button',
        {
          class: 'icon',
          title: 'Remove',
          'aria-label': 'Remove',
          disabled: busy,
          onclick: () => {
            if (!confirm(`Remove ${a.label}? This only forgets it in the extension.`)) return;
            void act(`remove:${a.id}`, () => send('remove', { accountId: a.id }));
          },
        },
        '✕',
      ),
    ),
    sub,
    hasUsage ? usageBlock(s.usage[a.id], s, now) : null,
  );
}

function siteSection(site: SiteView, s: StateView, now: number): HTMLElement {
  const busy = busyKey !== null;
  const accounts = s.accounts.filter((a) => a.siteId === site.id);
  const activeId = s.active[site.id] ?? null;
  return h(
    'section',
    { class: 'site' },
    h(
      'div',
      { class: 'site-head' },
      h('h2', {}, site.name),
      h(
        'button',
        { class: 'primary', disabled: busy, onclick: () => void act(`save:${site.id}`, () => send('saveCurrent', { siteId: site.id })) },
        busyKey === `save:${site.id}` ? 'Saving…' : 'Save current session',
      ),
      h(
        'button',
        {
          disabled: busy,
          onclick: () => {
            void act(`login:${site.id}`, async () => {
              await send('loginAnother', { siteId: site.id });
              window.close();
            });
          },
        },
        'Log in another account',
      ),
      accounts.length >= 2
        ? h(
            'button',
            {
              disabled: busy,
              title: `Rotation: ${STRATEGY_LABEL[s.settings.rotationStrategy]}`,
              onclick: () => void act(`next:${site.id}`, () => send('switchNext', { siteId: site.id })),
            },
            busyKey === `next:${site.id}` ? 'Switching…' : 'Switch to next',
          )
        : null,
    ),
    activeId === null && accounts.length > 0 ? h('p', { class: 'hint' }, 'Current session is not saved') : null,
    accounts.length === 0 ? h('p', { class: 'empty' }, 'No saved accounts.') : null,
    ...accounts.map((a) => accountRow(a, s, a.id === activeId, site.hasUsage, now)),
  );
}

const STRATEGY_LABEL: Record<RotationStrategy, string> = {
  next: 'next in order',
  'next-available': 'next available',
  best: 'most quota left',
};

function footerText(s: StateView): string {
  const { autoSwitchMode: m, threshold: t, rotationStrategy: r } = s.settings;
  const auto = m === 'off' ? 'Auto-switch: off' : `Auto-switch: ${m === 'notify' ? 'notify' : 'switch'} at ${t}%`;
  return `Next: ${STRATEGY_LABEL[r]} · ${auto}`;
}

function render(force = false): void {
  // Background updates would destroy the inline input; finishing the edit renders again.
  if (editingId !== null && !force) return;
  const now = Date.now();
  const header = h(
    'div',
    { class: 'header' },
    h('h1', {}, 'Claude accounts'),
    h(
      'button',
      { class: 'icon', title: 'Refresh usage', 'aria-label': 'Refresh usage', disabled: refreshing, onclick: () => void refresh() },
      h('span', { class: refreshing ? 'spin on' : 'spin' }, '↻'),
    ),
    h(
      'button',
      { class: 'icon', title: 'Settings', 'aria-label': 'Settings', onclick: () => void chrome.runtime.openOptionsPage() },
      '⚙',
    ),
  );
  const banner = error
    ? h(
        'div',
        { class: 'banner', role: 'alert' },
        h('span', {}, error),
        h(
          'button',
          {
            'aria-label': 'Dismiss',
            onclick: () => {
              error = null;
              render();
            },
          },
          '✕',
        ),
      )
    : null;
  const update = state?.update
    ? h(
        'div',
        { class: 'banner info', role: 'status' },
        h('span', {}, `Version ${state.update.version} is available.`),
        h('button', { onclick: () => void chrome.tabs.create({ url: state!.update!.url }) }, 'Download'),
      )
    : null;
  const body = state
    ? [...state.sites.map((site) => siteSection(site, state!, now)), h('div', { class: 'footer' }, footerText(state))]
    : [h('p', { class: 'empty pad' }, error ? '' : 'Loading…')];
  root.replaceChildren(header, ...(banner ? [banner] : []), ...(update ? [update] : []), ...body);
}

let debounce: ReturnType<typeof setTimeout> | undefined;
chrome.storage.onChanged.addListener((changes, area) => {
  // Only the key name is checked: the payload contains cookies and must never be read.
  if (area !== 'local' || !('state' in changes)) return;
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    await loadState();
    render();
  }, 200);
});

render();
void (async () => {
  await loadState();
  render();
  await refresh();
})();
