import { send } from '../core/messages';
import type { AutoSwitchMode, Settings } from '../core/types';
import { h } from '../ui/dom';
import { friendlyError } from '../ui/errors';
import { icon, type IconName } from '../ui/icons';
import { localizeDocument, t } from '../ui/i18n';
import { getShortcut, keycaps, SHORTCUTS_PAGE } from '../ui/shortcut';

const WELCOME_URL = 'src/welcome/index.html';
const SAVE_DELAY_MS = 400;
const TOAST_MS = 1800;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const poll = $<HTMLInputElement>('pollMinutes');
const threshold = $<HTMLInputElement>('threshold');
const thresholdValue = $<HTMLOutputElement>('thresholdValue');
const cooldown = $<HTMLInputElement>('cooldownMinutes');

/** Description under the auto-switch control, per mode. */
const MODE_TEXT: Record<AutoSwitchMode, () => string> = {
  off: () => t('options_auto_desc_off'),
  notify: () => t('options_auto_desc_notify'),
  switch: () => t('options_auto_desc_switch'),
};

// ---------- Saving ----------

let current: Settings | null = null;
let pending: Partial<Settings> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight = 0;
let chain: Promise<void> = Promise.resolve();

/** Queues a patch and saves it after `delay` ms. New patches within the delay are merged. */
function queueSave(patch: Partial<Settings>, delay = 0): void {
  Object.assign(pending, patch);
  clearTimeout(timer);
  timer = setTimeout(flush, delay);
}

function flush(): void {
  timer = undefined;
  const patch = pending;
  pending = {};
  inflight++;
  // One save at a time keeps the order of changes.
  chain = chain.then(() => persist(patch));
}

async function persist(patch: Partial<Settings>): Promise<void> {
  try {
    const saved = await send('updateSettings', { patch });
    current = saved;
    if (settled()) fill(saved);
    showToast('success', t('options_saved'));
  } catch (e) {
    // Put the controls back to the last saved values so they never lie.
    if (settled() && current) fill(current);
    showToast('error', friendlyError(e));
  } finally {
    inflight--;
  }
}

/** True when no newer change is waiting, so a response can safely redraw the controls. */
const settled = (): boolean => inflight <= 1 && timer === undefined;

// ---------- Toasts ----------

function showToast(kind: 'success' | 'error', message: string): void {
  const region = $<HTMLElement>('toasts');
  region.replaceChildren();
  const toast = h(
    'div',
    { class: `toast toast-${kind}` },
    icon(kind === 'success' ? 'circleCheck' : 'circleAlert'),
    h('div', { class: 'toast-body' }, message),
  );
  if (kind === 'success') {
    setTimeout(() => toast.remove(), TOAST_MS);
  } else {
    const close = h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': t('common_close'), onclick: () => toast.remove() }, icon('x', 14));
    toast.append(close);
  }
  region.append(toast);
}

// ---------- Controls ----------

/** Radio group with roving tabindex; arrow keys move the selection. */
function radioGroup(group: HTMLElement, onChange: (value: string) => void): (value: string) => void {
  const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
  const select = (value: string): void => {
    for (const r of radios) {
      const on = r.dataset.value === value;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (r: HTMLElement): void => {
    select(r.dataset.value!);
    r.focus();
    onChange(r.dataset.value!);
  };
  const rtl = document.documentElement.dir === 'rtl';
  group.addEventListener('keydown', (ev) => {
    const i = radios.findIndex((r) => r === document.activeElement);
    if (i < 0) return;
    const forward = rtl ? ['ArrowLeft', 'ArrowDown'] : ['ArrowRight', 'ArrowDown'];
    const back = rtl ? ['ArrowRight', 'ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
    let next = -1;
    if (forward.includes(ev.key)) next = (i + 1) % radios.length;
    else if (back.includes(ev.key)) next = (i - 1 + radios.length) % radios.length;
    else if (ev.key === 'Home') next = 0;
    else if (ev.key === 'End') next = radios.length - 1;
    if (next < 0) return;
    ev.preventDefault();
    choose(radios[next]!);
  });
  for (const r of radios) r.addEventListener('click', () => choose(r));
  return select;
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** Number input with - / + buttons. Typing is allowed; values are clamped to min/max. */
function stepper(input: HTMLInputElement, key: 'pollMinutes' | 'cooldownMinutes'): () => void {
  const min = Number(input.min);
  const max = Number(input.max);
  const [dec, inc] = [...input.parentElement!.querySelectorAll<HTMLButtonElement>('[data-step]')];
  const sync = (): void => {
    const n = Number(input.value);
    dec!.disabled = n <= min;
    inc!.disabled = n >= max;
  };
  const commit = (n: number): void => {
    input.value = String(n);
    sync();
    queueSave({ [key]: n }, SAVE_DELAY_MS);
  };
  for (const btn of [dec!, inc!])
    btn.addEventListener('click', () => {
      const from = input.value === '' ? (current?.[key] ?? min) : Number(input.value);
      commit(clamp(Math.round(from) + Number(btn.dataset.step), min, max));
    });
  input.addEventListener('input', () => {
    if (input.value === '' || Number.isNaN(input.valueAsNumber)) return;
    sync();
    queueSave({ [key]: clamp(Math.round(input.valueAsNumber), min, max) }, SAVE_DELAY_MS);
  });
  // On leaving the field, show the clamped value, or the saved one if it was left empty.
  input.addEventListener('change', () => {
    const n = input.value === '' ? (current?.[key] ?? min) : clamp(Math.round(input.valueAsNumber), min, max);
    input.value = String(n);
    sync();
  });
  return sync;
}

function showThreshold(): void {
  thresholdValue.value = `${threshold.value}%`;
  threshold.setAttribute('aria-valuetext', `${threshold.value}%`);
}

/** Shows or hides the parts of the auto-switch card that depend on the mode. */
function showMode(mode: AutoSwitchMode): void {
  $('modeDesc').textContent = MODE_TEXT[mode]();
  $('switchWarn').hidden = mode !== 'switch';
  $('cooldownField').hidden = mode === 'off';
}

const selectMode = radioGroup($('autoSwitchMode'), (value) => {
  const mode = value as AutoSwitchMode;
  showMode(mode);
  queueSave({ autoSwitchMode: mode });
});

const selectStrategy = radioGroup($('rotationStrategy'), (value) => {
  queueSave({ rotationStrategy: value as Settings['rotationStrategy'] });
});

const syncPoll = stepper(poll, 'pollMinutes');
const syncCooldown = stepper(cooldown, 'cooldownMinutes');

/** Draws the settings into the controls. */
function fill(s: Settings): void {
  poll.value = String(s.pollMinutes);
  threshold.value = String(s.threshold);
  cooldown.value = String(s.cooldownMinutes);
  syncPoll();
  syncCooldown();
  showThreshold();
  selectMode(s.autoSwitchMode);
  showMode(s.autoSwitchMode);
  selectStrategy(s.rotationStrategy);
}

// ---------- Shortcut and footer ----------

async function showShortcut(): Promise<void> {
  const box = $('shortcutKeys');
  let shortcut = '';
  try {
    shortcut = await getShortcut();
  } catch {
    // Show "Not set" when Chrome cannot tell.
  }
  box.replaceChildren(shortcut ? keycaps(shortcut) : h('span', { class: 'subtle' }, t('options_shortcut_notSet')));
}

function setupFooter(): void {
  const manifest = chrome.runtime.getManifest();
  $('version').textContent = t('options_version', { version: manifest.version });
  if (manifest.homepage_url) $<HTMLAnchorElement>('homepage').href = manifest.homepage_url;
  $('showWelcome').addEventListener('click', () => void chrome.tabs.create({ url: chrome.runtime.getURL(WELCOME_URL) }));
  $('changeShortcut').addEventListener('click', () => void chrome.tabs.create({ url: SHORTCUTS_PAGE }));
}

function setupIcons(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-icon]'))
    el.replaceChildren(icon(el.dataset.icon as IconName, Number(el.dataset.size ?? 16)));
}

// ---------- Start ----------

async function load(): Promise<void> {
  try {
    current = (await send('getState')).settings;
    fill(current);
    $('cards').inert = false;
  } catch (e) {
    $('loadErrorText').textContent = friendlyError(e);
    $('loadError').hidden = false;
    $('cards').classList.add('is-failed');
  }
}

localizeDocument();
setupIcons();
setupFooter();
threshold.addEventListener('input', () => {
  showThreshold();
  queueSave({ threshold: Number(threshold.value) }, SAVE_DELAY_MS);
});
void load();
void showShortcut();
// The user may change the shortcut on Chrome's page, so read it again when they come back.
window.addEventListener('focus', () => void showShortcut());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void showShortcut();
});
