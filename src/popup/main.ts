import { send } from '../core/messages';
import type { AccountView, AutoSwitchMode, RotationStrategy, SiteId, SiteView, StateView, UsageEntry } from '../core/types';
import { h, type Child } from '../ui/dom';
import { friendlyError } from '../ui/errors';
import { localizeDocument, t } from '../ui/i18n';
import { icon, type IconName } from '../ui/icons';
import { getShortcut, keycaps } from '../ui/shortcut';
import { formatAgo, formatResetsIn, formatWindowResets } from './format';
import {
  avatarIndex,
  initials,
  isStale,
  needsAutoRefresh,
  resetHint,
  showEmail,
  siteAction,
  stepIndex,
  visibleSites,
  windowView,
  type WindowView,
} from './view';

type Menu = { kind: 'row'; id: string } | { kind: 'add' };
interface MenuItem {
  label: string;
  icon: IconName;
  danger?: boolean;
  run: () => void;
}

const root = document.getElementById('app') as HTMLElement;
const toastRegion = h('div', { class: 'toast-region', 'aria-live': 'polite' });
document.body.append(toastRegion);

let state: StateView | null = null;
let loadError: string | null = null;
/** The one inline error banner; a new error replaces it. */
let errorMsg: string | null = null;
/** A render was skipped while a menu, rename or confirm was open. */
let dirty = false;
let shortcut = '';
let refreshing = false;
let busyKey: string | null = null;
let editingId: string | null = null;
let confirmId: string | null = null;
let menu: Menu | null = null;
let tabSite: SiteId | null = readTab();
/** data-fk of the element to focus after the next paint. */
let pendingFocus: string | null = null;

// The strategy/mode labels are literal keys so the i18n check can see them.
const STRATEGY: Record<RotationStrategy, () => string> = {
  next: () => t('common_strategy_next'),
  'next-available': () => t('common_strategy_nextAvailable'),
  best: () => t('common_strategy_best'),
};
const MODE: Record<AutoSwitchMode, () => string> = {
  off: () => t('common_mode_off'),
  notify: () => t('common_mode_notify'),
  switch: () => t('common_mode_switch'),
};

/* ---------- Small helpers ---------- */

const TAB_KEY = 'popup.tab';

function readTab(): SiteId | null {
  try {
    return localStorage.getItem(TAB_KEY);
  } catch {
    return null;
  }
}

function saveTab(id: SiteId): void {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    // Storage can be blocked; the tab just is not remembered.
  }
}

/** aria-disabled keeps keyboard focus on a button while an action runs. */
const ariaDisabled = (on: boolean): Record<string, string | undefined> => ({ 'aria-disabled': on ? 'true' : undefined });

const focusKey = (key: string): Record<string, string> => ({ 'data-fk': key });

const menuTrigger = (m: Menu): string => (m.kind === 'row' ? `more:${m.id}` : 'add-more');

const menuTriggerId = (m: Menu): string => (m.kind === 'row' ? `more-${m.id}` : 'add-more');

const MENU_ID = 'menu';

const sameMenu = (a: Menu | null, b: Menu): boolean => a?.kind === b.kind && (a.kind === 'add' || a.id === (b as { id: string }).id);

const isInteracting = (): boolean => editingId !== null || confirmId !== null || menu !== null;

function spinner(size = 14): SVGSVGElement {
  const el = icon('loaderCircle', size);
  el.classList.add('icon-spin');
  return el;
}

function currentSite(s: StateView): SiteView | null {
  const sites = visibleSites(s.sites, s.accounts);
  return sites.find((x) => x.id === tabSite) ?? sites[0] ?? null;
}

/* ---------- Toasts and errors ---------- */

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Keeps the toast above the sticky footer. */
function placeToasts(): void {
  const footer = root.querySelector<HTMLElement>('.footer');
  toastRegion.style.bottom = footer ? `${footer.offsetHeight + 8}px` : '';
}

/** One success toast at a time; a new one replaces the old one and it hides by itself. */
function toast(text: string): void {
  clearTimeout(toastTimer);
  toastRegion.replaceChildren(h('div', { class: 'toast toast-success' }, icon('circleCheck', 16), h('span', { class: 'toast-body' }, text)));
  placeToasts();
  toastTimer = setTimeout(() => toastRegion.replaceChildren(), 2500);
}

function showError(text: string): void {
  errorMsg = text;
  render();
}

function dismissError(): void {
  errorMsg = null;
  paint();
}

/* ---------- Data and actions ---------- */

async function loadState(): Promise<void> {
  try {
    state = await send('getState');
    loadError = null;
  } catch (e) {
    if (state) showError(friendlyError(e));
    else loadError = friendlyError(e);
  }
}

/** Runs one background action at a time and shows its result as a toast. */
async function act<T>(key: string, fn: () => Promise<T>, onOk?: (value: T) => void): Promise<void> {
  if (busyKey) return;
  busyKey = key;
  errorMsg = null;
  paint();
  try {
    const value = await fn();
    onOk?.(value);
  } catch (e) {
    errorMsg = friendlyError(e);
  } finally {
    busyKey = null;
  }
  await loadState();
  paint();
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  errorMsg = null;
  render();
  try {
    await send('refreshUsage', {});
  } catch (e) {
    errorMsg = friendlyError(e);
  } finally {
    refreshing = false;
  }
  await loadState();
  render();
}

function runSiteAction(s: StateView, site: SiteView): void {
  if (siteAction(s.live[site.id] ?? false, s.active[site.id] ?? null) === 'save') {
    void act(`save:${site.id}`, () => send('saveCurrent', { siteId: site.id }), (a) =>
      toast(t('popup_savedToast', { label: a.label })),
    );
    return;
  }
  void act(`login:${site.id}`, async () => {
    await send('loginAnother', { siteId: site.id });
    window.close();
  });
}

const switchTo = (a: AccountView): void =>
  void act(`switch:${a.id}`, () => send('switch', { accountId: a.id }), () => toast(t('popup_switchedTo', { label: a.label })));

function siteActionLabel(s: StateView, site: SiteView): string {
  const action = siteAction(s.live[site.id] ?? false, s.active[site.id] ?? null);
  return action === 'save' ? t('popup_saveCurrent', { site: site.name }) : t('popup_loginAnother', { site: site.name });
}

/* ---------- Menu, rename, remove ---------- */

function openMenu(m: Menu): void {
  if (busyKey || sameMenu(menu, m)) return;
  menu = m;
  pendingFocus = 'menuitem:0';
  paint();
}

function closeMenu(restoreFocus: boolean): void {
  if (!menu) return;
  if (restoreFocus) pendingFocus = menuTrigger(menu);
  menu = null;
  paint();
}

/** Closes the menu without rebuilding the page, so the click that closed it still lands on its target. */
function dismissMenuQuietly(): void {
  menu = null;
  root.querySelector('.menu')?.remove();
  for (const el of root.querySelectorAll('[aria-haspopup="menu"][aria-expanded="true"]')) {
    el.setAttribute('aria-expanded', 'false');
    el.removeAttribute('aria-controls');
  }
  repaintIfDirty();
}

/** Shows state that arrived while a menu, rename or confirm was open. Deferred so the click that closed it lands first. */
function repaintIfDirty(): void {
  if (!dirty) return;
  setTimeout(() => {
    if (dirty && !isInteracting()) paint();
  }, 0);
}

function toggleMenu(m: Menu): void {
  if (sameMenu(menu, m)) closeMenu(true);
  else openMenu(m);
}

function startRename(id: string): void {
  editingId = id;
  paint();
}

function askRemove(id: string): void {
  confirmId = id;
  pendingFocus = `cancel:${id}`;
  paint();
}

function cancelRemove(): void {
  if (confirmId === null) return;
  pendingFocus = `more:${confirmId}`;
  confirmId = null;
  paint();
}

function confirmRemove(a: AccountView): void {
  confirmId = null;
  pendingFocus = null;
  void act(`remove:${a.id}`, () => send('remove', { accountId: a.id }), () =>
    toast(t('popup_removed', { label: a.label })),
  );
}

function selectTab(id: SiteId): void {
  tabSite = id;
  saveTab(id);
  menu = null;
  confirmId = null;
  pendingFocus = `tab:${id}`;
  paint(true);
}

/* ---------- Rendering ---------- */

/** A background update must not destroy an open input, menu or confirm; closing it paints again. */
function render(): void {
  if (isInteracting()) dirty = true;
  else paint();
}

function paint(resetScroll = false): void {
  dirty = false;
  const focus = pendingFocus ?? (document.activeElement as HTMLElement | null)?.dataset?.fk ?? null;
  pendingFocus = null;
  const scroll = root.querySelector('.panel')?.scrollTop ?? 0;
  root.replaceChildren(...view());
  const panel = root.querySelector('.panel');
  if (panel && !resetScroll) panel.scrollTop = scroll;
  if (menu) placeMenu(menu);
  placeToasts();
  const input = root.querySelector<HTMLInputElement>('.label-input');
  if (input) {
    input.focus();
    input.select();
  } else if (focus) {
    root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(focus)}"]`)?.focus();
  }
}

function view(): Node[] {
  const header = headerEl();
  if (!state) return [header, loadError ? loadErrorEl(loadError) : skeletonEl()];
  const s = state;
  const site = currentSite(s);
  if (!site) return [header];
  const accounts = s.accounts.filter((a) => a.siteId === site.id);
  const sites = visibleSites(s.sites, s.accounts);
  const tabs = sites.length > 1 ? tabsEl(sites, site, s) : null;
  const nodes: (Node | null)[] = [
    header,
    bannersEl(s, site, accounts.length),
    tabs,
    accounts.length ? listEl(s, site, accounts, tabs !== null) : emptyEl(s, site),
    accounts.length ? footerEl(s, site, accounts) : null,
    menu ? menuEl(s, menu) : null,
  ];
  return nodes.filter((n): n is Node => n !== null);
}

function headerEl(): HTMLElement {
  const refreshIcon = icon('refreshCw');
  if (refreshing) refreshIcon.classList.add('icon-spin');
  return h(
    'header',
    { class: 'header' },
    h('img', { src: '/logo.svg', width: 20, height: 20, alt: '' }),
    h('h1', { class: 'header-title' }, t('extShortName')),
    h(
      'button',
      {
        class: 'btn btn-icon',
        'aria-label': t('popup_refresh'),
        title: t('popup_refresh'),
        ...ariaDisabled(refreshing),
        onclick: () => void refresh(),
      },
      refreshIcon,
    ),
    h(
      'button',
      {
        class: 'btn btn-icon',
        'aria-label': t('common_settings'),
        title: t('common_settings'),
        onclick: () => void chrome.runtime.openOptionsPage(),
      },
      icon('settings'),
    ),
  );
}

function skeletonEl(): HTMLElement {
  const row = () =>
    h(
      'div',
      { class: 'account skeleton-row' },
      h('span', { class: 'skeleton sk-avatar' }),
      h('span', { class: 'sk-lines' }, h('span', { class: 'skeleton sk-bar' }), h('span', { class: 'skeleton sk-bar sk-short' })),
    );
  return h(
    'div',
    { class: 'panel', role: 'status', 'aria-busy': 'true' },
    h('span', { class: 'visually-hidden' }, t('popup_loading')),
    h('div', { class: 'list' }, row(), row(), row()),
  );
}

function loadErrorEl(message: string): HTMLElement {
  return h(
    'div',
    { class: 'panel' },
    h(
      'div',
      { class: 'empty' },
      icon('circleAlert', 24),
      h('p', { class: 'muted' }, message),
      h('button', { class: 'btn', onclick: () => void reload() }, t('popup_retry')),
    ),
  );
}

async function reload(): Promise<void> {
  await loadState();
  paint();
}

function bannersEl(s: StateView, site: SiteView, accountCount: number): HTMLElement | null {
  const items: HTMLElement[] = [];
  if (errorMsg) {
    items.push(
      h(
        'div',
        { class: 'banner banner-error', role: 'alert' },
        icon('circleAlert'),
        h('span', { class: 'banner-body' }, errorMsg),
        h('button', { class: 'btn btn-icon btn-sm', 'aria-label': t('common_close'), onclick: dismissError }, icon('x', 14)),
      ),
    );
  }
  if (s.update) {
    const url = s.update.url;
    items.push(
      h(
        'div',
        { class: 'banner', role: 'status' },
        icon('info'),
        h('span', { class: 'banner-body' }, t('popup_updateAvailable', { version: s.update.version })),
        h('button', { class: 'btn btn-sm', onclick: () => void chrome.tabs.create({ url }) }, t('popup_download')),
      ),
    );
  }
  // With no saved account the empty state already offers to save this session.
  if (accountCount > 0 && s.live[site.id] && (s.active[site.id] ?? null) === null) {
    items.push(
      h(
        'div',
        { class: 'banner banner-accent', role: 'status' },
        icon('info'),
        h('span', { class: 'banner-body' }, t('popup_unsavedBanner', { site: site.name })),
        h(
          'button',
          { class: 'btn btn-sm btn-primary', ...focusKey('banner-save'), ...ariaDisabled(busyKey !== null), onclick: () => runSiteAction(s, site) },
          t('common_save'),
        ),
      ),
    );
  }
  return items.length ? h('div', { class: 'banners' }, ...items) : null;
}

function tabsEl(sites: SiteView[], site: SiteView, s: StateView): HTMLElement {
  const onKey = (e: KeyboardEvent): void => {
    const i = stepIndex(sites.findIndex((x) => x.id === site.id), sites.length, e.key, { prev: 'ArrowLeft', next: 'ArrowRight' });
    if (i === null) return;
    e.preventDefault();
    selectTab(sites[i]!.id);
  };
  return h(
    'div',
    { class: 'tabs', role: 'tablist', 'aria-label': t('popup_sitesLabel'), onkeydown: onKey },
    ...sites.map((x) => {
      const selected = x.id === site.id;
      return h(
        'button',
        {
          class: 'tab',
          role: 'tab',
          id: `tab-${x.id}`,
          ...focusKey(`tab:${x.id}`),
          'aria-selected': selected ? 'true' : 'false',
          'aria-controls': 'panel',
          tabindex: selected ? 0 : -1,
          onclick: () => selectTab(x.id),
        },
        x.name,
        h('span', { class: 'tab-count tabular' }, String(s.accounts.filter((a) => a.siteId === x.id).length)),
      );
    }),
  );
}

function listEl(s: StateView, site: SiteView, accounts: AccountView[], inTabs: boolean): HTMLElement {
  const activeId = s.active[site.id] ?? null;
  const now = Date.now();
  const onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('row-main')) return;
    const mains = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.row-main')];
    const i = stepIndex(mains.indexOf(target), mains.length, e.key, { prev: 'ArrowUp', next: 'ArrowDown' });
    if (i === null) return;
    e.preventDefault();
    mains[i]?.focus();
  };
  return h(
    'div',
    { class: 'panel', id: 'panel', role: inTabs ? 'tabpanel' : undefined, 'aria-labelledby': inTabs ? `tab-${site.id}` : undefined },
    h(
      'div',
      { class: busyKey ? 'list is-busy' : 'list', role: 'list', 'aria-label': t('popup_accountsLabel'), onkeydown: onKey },
      ...accounts.map((a) => rowEl(a, s, a.id === activeId, site.hasUsage, now)),
    ),
  );
}

function avatarEl(a: AccountView): HTMLElement {
  return h('span', { class: `avatar av-${avatarIndex(a.identity.key)}`, 'aria-hidden': 'true' }, initials(a.label));
}

function rowEl(a: AccountView, s: StateView, isActive: boolean, hasUsage: boolean, now: number): HTMLElement {
  const switching = busyKey === `switch:${a.id}`;
  const cls = ['account', isActive && 'active', switching && 'is-busy'].filter(Boolean).join(' ');
  const attrs = { class: cls, role: 'listitem', 'data-account-id': a.id };
  if (confirmId === a.id) return h('div', attrs, confirmEl(a));
  if (editingId === a.id) return h('div', attrs, editEl(a));

  const busy = busyKey !== null;
  const email = a.identity.email;
  const plan = a.identity.plan;
  const subId = `sub-${a.id}`;
  const useId = `use-${a.id}`;
  const usage = hasUsage ? usageEl(s.usage[a.id], s, now) : null;
  const error = s.usage[a.id]?.error;
  const friendly = hasUsage && error ? friendlyError(error) : null;
  const hint = hasUsage ? resetHint(s.usage[a.id]?.usage, s.settings.threshold, now) : null;
  const hintText = hint ? formatWindowResets(hint.resetsAt, now) : '';
  const detail = hint && hintText
    ? h('span', { class: `reset-hint is-${hint.level}` }, hintText)
    : showEmail(a.label, email)
      ? h('span', { class: 'email', title: email }, email)
      : null;
  const sub =
    plan || detail
      ? h('span', { class: 'sub-line', id: subId }, plan ? h('span', { class: 'pill' }, plan) : null, detail)
      : null;
  const main = h(
    'button',
    {
      class: 'row-main',
      ...focusKey(`main:${a.id}`),
      'aria-label': isActive ? t('popup_activeAccount', { label: a.label }) : t('popup_switchTo', { label: a.label }),
      'aria-current': isActive ? 'true' : undefined,
      'aria-describedby': [sub && subId, usage?.tip && useId].filter(Boolean).join(' ') || undefined,
      ...ariaDisabled(busy),
      onclick: () => {
        if (!isActive) switchTo(a);
      },
    },
    avatarEl(a),
    h(
      'span',
      { class: 'who' },
      h(
        'span',
        { class: 'name-line' },
        h('span', { class: 'label', title: a.label }, a.label),
        isActive ? h('span', { class: 'pill pill-accent' }, t('common_active')) : null,
        switching ? h('span', { class: 'row-spin' }, spinner()) : null,
      ),
      sub,
    ),
    usage?.el,
    usage?.tip ? h('span', { class: 'visually-hidden', id: useId }, usage.tip) : null,
    friendly ? h('span', { class: 'row-error', title: friendly }, friendly) : null,
  );
  const open = sameMenu(menu, { kind: 'row', id: a.id });
  const more = h(
    'button',
    {
      class: 'btn btn-icon btn-sm row-more',
      ...focusKey(`more:${a.id}`),
      id: menuTriggerId({ kind: 'row', id: a.id }),
      'aria-label': t('popup_moreActions', { label: a.label }),
      'aria-haspopup': 'menu',
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': open ? MENU_ID : undefined,
      ...ariaDisabled(busy),
      onclick: () => toggleMenu({ kind: 'row', id: a.id }),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'ArrowDown') return;
        e.preventDefault();
        openMenu({ kind: 'row', id: a.id });
      },
    },
    icon('ellipsis'),
  );
  return h('div', attrs, main, more);
}

/** The two usage meters, a tooltip text for both, and stale / empty notes. */
function usageEl(entry: UsageEntry | undefined, s: StateView, now: number): { el: HTMLElement; tip: string } {
  const usage = entry?.usage ?? null;
  if (!usage || (!usage.fiveHour && !usage.sevenDay)) {
    return { el: h('span', { class: 'usage' }, h('span', { class: 'u-note subtle' }, t('popup_noUsage'))), tip: '' };
  }
  const stale = isStale(usage.fetchedAt, s.settings.pollMinutes, now);
  const windows = [
    { name: t('common_fiveHour'), short: t('popup_shortFiveHour'), w: usage.fiveHour },
    { name: t('common_weekly'), short: t('popup_shortWeekly'), w: usage.sevenDay },
  ];
  const tips: string[] = [];
  const lines = windows.flatMap(({ name, short, w }) => {
    if (!w) return [];
    const v = windowView(w, s.settings.threshold, now);
    const reset = formatResetsIn(w.resetsAt, now);
    tips.push(
      reset
        ? t('popup_usageTipReset', { name, percent: v.pct, reset })
        : t('popup_usageTip', { name, percent: v.pct }),
    );
    return [windowLine(short, v, stale)];
  });
  if (stale) tips.push(t('popup_updatedAgo', { time: formatAgo(usage.fetchedAt, now) }));
  return {
    el: h(
      'span',
      { class: 'usage', title: tips.join('\n') },
      lines,
    ),
    tip: tips.join('. '),
  };
}

function windowLine(short: string, v: WindowView, stale: boolean): HTMLElement {
  const fill = h('span', { class: v.level === 'ok' ? 'meter-fill' : `meter-fill is-${v.level}` });
  fill.style.width = `${Math.min(100, Math.max(0, v.pct))}%`;
  return h(
    'span',
    { class: 'u-win' },
    h('span', { class: 'u-name subtle' }, short),
    h('span', { class: stale ? 'meter is-stale' : 'meter' }, fill),
    h('span', { class: 'u-pct tabular' }, `${v.pct}%`),
  );
}

function editEl(a: AccountView): HTMLElement {
  const input = h('input', {
    class: 'input label-input',
    value: a.label,
    maxlength: 80,
    'aria-label': t('popup_renameLabel'),
  });
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    editingId = null;
    pendingFocus = `main:${a.id}`;
    const label = input.value.trim();
    if (save && label && label !== a.label) {
      void act(`rename:${a.id}`, () => send('rename', { accountId: a.id, label }), () => toast(t('popup_renamed')));
    } else {
      paint();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // Without this, the Enter keypress would land on the row button that gets focus next and switch to it.
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  return h('div', { class: 'row-edit' }, avatarEl(a), input);
}

function confirmEl(a: AccountView): HTMLElement {
  return h(
    'div',
    { class: 'confirm', role: 'group' },
    avatarEl(a),
    h(
      'div',
      { class: 'confirm-body' },
      h('p', { class: 'confirm-text' }, t('popup_removeConfirm', { label: a.label })),
      h(
        'div',
        { class: 'confirm-actions' },
        h('button', { class: 'btn btn-sm', ...focusKey(`cancel:${a.id}`), onclick: cancelRemove }, t('common_cancel')),
        h('button', { class: 'btn btn-sm btn-danger', onclick: () => confirmRemove(a) }, t('popup_remove')),
      ),
    ),
  );
}

function emptyEl(s: StateView, site: SiteView): HTMLElement {
  const live = s.live[site.id] ?? false;
  const step = (text: string) => h('li', {}, h('span', {}, text));
  return h(
    'div',
    { class: 'panel', id: 'panel' },
    h(
      'div',
      { class: 'empty' },
      h('img', { src: '/logo.svg', width: 40, height: 40, alt: '' }),
      h('h2', { class: 'empty-title' }, t('popup_emptyTitle')),
      h('ol', { class: 'steps' }, step(t('popup_emptyStep1')), step(t('popup_emptyStep2')), step(t('popup_emptyStep3'))),
      h(
        'button',
        {
          class: 'btn btn-primary',
          ...focusKey('empty-cta'),
          ...ariaDisabled(busyKey !== null),
          onclick: () => (live ? runSiteAction(s, site) : void chrome.tabs.create({ url: 'https://claude.ai' })),
        },
        busyKey?.startsWith('save:') ? spinner() : null,
        live ? t('popup_saveThisAccount') : t('popup_openClaude'),
      ),
    ),
  );
}

function footerEl(s: StateView, site: SiteView, accounts: AccountView[]): HTMLElement {
  const busy = busyKey !== null;
  const multi = s.sites.length > 1;
  const adding = busyKey?.startsWith('save:') || busyKey?.startsWith('login:');
  const add = h(
    'button',
    {
      class: 'btn btn-sm',
      ...focusKey('add'),
      ...ariaDisabled(busy),
      onclick: () => runSiteAction(s, site),
    },
    adding ? spinner() : icon('userPlus', 14),
    t('popup_addAccount'),
  );
  const open = menu?.kind === 'add';
  const more = multi
    ? h(
        'button',
        {
          class: 'btn btn-sm btn-split-more',
          id: menuTriggerId({ kind: 'add' }),
          ...focusKey('add-more'),
          'aria-label': t('popup_addMoreWays'),
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          'aria-controls': open ? MENU_ID : undefined,
          ...ariaDisabled(busy),
          onclick: () => toggleMenu({ kind: 'add' }),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            openMenu({ kind: 'add' });
          },
        },
        icon('chevronDown', 14),
      )
    : null;
  const keys = shortcut ? keycaps(shortcut) : null;
  keys?.setAttribute('aria-hidden', 'true');
  const next =
    accounts.length >= 2
      ? h(
          'button',
          {
            class: 'btn btn-sm',
            ...focusKey('next'),
            ...ariaDisabled(busy),
            onclick: () =>
              void act(`next:${site.id}`, () => send('switchNext', { siteId: site.id }), (a) =>
                toast(t('popup_switchedTo', { label: a.label })),
              ),
          },
          busyKey?.startsWith('next:') ? spinner() : icon('chevronsRight', 14),
          t('popup_switchNext'),
          keys,
        )
      : null;
  return h(
    'footer',
    { class: 'footer' },
    h('div', { class: 'footer-actions' }, h('div', { class: 'btn-split' }, add, more), next),
    h('p', { class: 'status subtle' }, statusText(s)),
  );
}

function statusText(s: StateView): string {
  const { autoSwitchMode: mode, threshold, rotationStrategy } = s.settings;
  const auto = mode === 'off' ? MODE.off() : t('popup_autoAt', { mode: MODE[mode](), threshold });
  return t('popup_status', { strategy: STRATEGY[rotationStrategy](), auto });
}

/* ---------- Popover menu ---------- */

function menuItems(s: StateView, m: Menu): MenuItem[] {
  if (m.kind === 'add') {
    return s.sites.map((site) => ({
      label: siteActionLabel(s, site),
      icon: siteAction(s.live[site.id] ?? false, s.active[site.id] ?? null) === 'save' ? 'check' : 'userPlus',
      run: () => runSiteAction(s, site),
    }));
  }
  return [
    { label: t('popup_rename'), icon: 'pencil', run: () => startRename(m.id) },
    { label: t('popup_remove'), icon: 'trash2', danger: true, run: () => askRemove(m.id) },
  ];
}

function menuEl(s: StateView, m: Menu): HTMLElement {
  const items = menuItems(s, m);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') {
      // No preventDefault: focus moves on naturally, then the menu closes.
      setTimeout(() => closeMenu(false), 0);
      return;
    }
    const els = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = stepIndex(els.indexOf(document.activeElement as HTMLElement), els.length, e.key, { prev: 'ArrowUp', next: 'ArrowDown' });
    if (i === null) return;
    e.preventDefault();
    els[i]?.focus();
  };
  const nodes: Child[] = [];
  items.forEach((item, i) => {
    if (item.danger && i > 0) nodes.push(h('div', { class: 'menu-sep', role: 'separator' }));
    nodes.push(
      h(
        'button',
        {
          class: item.danger ? 'menu-item menu-item-danger' : 'menu-item',
          role: 'menuitem',
          tabindex: -1,
          ...focusKey(`menuitem:${i}`),
          onclick: () => {
            menu = null;
            pendingFocus = menuTrigger(m);
            item.run();
          },
        },
        icon(item.icon),
        item.label,
      ),
    );
  });
  return h('div', { class: 'menu', id: MENU_ID, role: 'menu', 'aria-labelledby': menuTriggerId(m), onkeydown: onKey }, ...nodes);
}

/** Positions the fixed menu next to its trigger, flipping above when there is no room below. */
function placeMenu(m: Menu): void {
  const el = root.querySelector<HTMLElement>('.menu');
  const trigger = root.querySelector<HTMLElement>(`[data-fk="${CSS.escape(menuTrigger(m))}"]`);
  if (!el || !trigger) return;
  const r = trigger.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const edge = 4;
  const preferred = m.kind === 'add' ? r.left : r.right - box.width;
  const left = Math.min(Math.max(edge, preferred), window.innerWidth - box.width - edge);
  let top = r.bottom + edge;
  if (top + box.height > window.innerHeight - edge) top = Math.max(edge, r.top - box.height - edge);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

document.addEventListener('pointerdown', (e) => {
  if (!menu) return;
  const target = e.target as Element;
  if (target.closest('.menu') || target.closest('[aria-haspopup="menu"]')) return;
  dismissMenuQuietly();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (menu) {
    e.preventDefault();
    closeMenu(true);
  } else if (confirmId !== null) {
    e.preventDefault();
    cancelRemove();
  }
});

/* ---------- Startup ---------- */

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

localizeDocument();
paint();
void getShortcut()
  .then((value) => {
    shortcut = value;
    render();
  })
  .catch(() => {});
void (async () => {
  await loadState();
  render();
  const s = state as StateView | null;
  if (!s || needsAutoRefresh(Object.values(s.usage), s.settings.pollMinutes, Date.now())) await refresh();
})();
