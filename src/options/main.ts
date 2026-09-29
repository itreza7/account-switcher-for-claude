import { send } from '../core/messages';
import type { AutoSwitchMode, RotationStrategy, Settings } from '../core/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const form = $<HTMLFormElement>('form');
const poll = $<HTMLInputElement>('pollMinutes');
const threshold = $<HTMLInputElement>('threshold');
const mode = $<HTMLSelectElement>('autoSwitchMode');
const cooldown = $<HTMLInputElement>('cooldownMinutes');
const strategy = $<HTMLSelectElement>('rotationStrategy');
const status = $<HTMLElement>('status');
const saveBtn = $<HTMLButtonElement>('save');

function fill(s: Settings): void {
  poll.value = String(s.pollMinutes);
  threshold.value = String(s.threshold);
  mode.value = s.autoSwitchMode;
  cooldown.value = String(s.cooldownMinutes);
  strategy.value = s.rotationStrategy;
}

function setStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle('err', isError);
}

async function load(): Promise<void> {
  try {
    fill((await send('getState')).settings);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  }
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const patch: Partial<Settings> = {
    pollMinutes: Number(poll.value),
    threshold: Number(threshold.value),
    autoSwitchMode: mode.value as AutoSwitchMode,
    cooldownMinutes: Number(cooldown.value),
    rotationStrategy: strategy.value as RotationStrategy,
  };
  saveBtn.disabled = true;
  setStatus('');
  try {
    fill(await send('updateSettings', { patch }));
    setStatus('Saved');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e), true);
  } finally {
    saveBtn.disabled = false;
  }
});

async function showShortcut(): Promise<void> {
  const cmd = (await chrome.commands.getAll()).find((c) => c.name === 'switch-next');
  $<HTMLElement>('shortcut').textContent = cmd?.shortcut
    ? ` (${cmd.shortcut}; change it at chrome://extensions/shortcuts)`
    : ' (not set; set it at chrome://extensions/shortcuts)';
}

void load();
void showShortcut();
