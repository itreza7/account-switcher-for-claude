import { createLock } from './lock';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './types';
import type { Account, AccountView, StoreState } from './types';

const KEY = 'state';

/** Each entry upgrades stored data from version N to N + 1. Empty until schema v2 exists. */
const migrations: Record<number, (raw: Partial<StoreState>) => Partial<StoreState>> = {};

const lock = createLock();

function migrate(raw: Partial<StoreState>): Partial<StoreState> {
  let cur = raw;
  let v = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : 1;
  while (v < SCHEMA_VERSION) {
    const step = migrations[v];
    if (step) cur = step(cur);
    v++;
  }
  return cur;
}

function withDefaults(raw: Partial<StoreState> | undefined): StoreState {
  const s = raw ? migrate(raw) : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: s.accounts ?? [],
    active: s.active ?? {},
    usage: s.usage ?? {},
    settings: { ...DEFAULT_SETTINGS, ...s.settings },
    autoSwitch: { lastActionAt: s.autoSwitch?.lastActionAt ?? null },
  };
}

export async function loadState(): Promise<StoreState> {
  const stored = await chrome.storage.local.get(KEY);
  return withDefaults(stored[KEY] as Partial<StoreState> | undefined);
}

/** Read-modify-write under one lock so concurrent callers never overwrite each other. */
export function mutate<T>(fn: (draft: StoreState) => T | Promise<T>): Promise<T> {
  return lock(async () => {
    const draft = await loadState();
    const result = await fn(draft);
    await chrome.storage.local.set({ [KEY]: draft });
    return result;
  });
}

export async function getAccount(id: string): Promise<Account | undefined> {
  const state = await loadState();
  return state.accounts.find((a) => a.id === id);
}

export function toView(a: Account): AccountView {
  const { cookies: _cookies, ...view } = a;
  return view;
}
