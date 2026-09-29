import { getAdapter } from '../sites';
import { activeFetch, type SiteFetch } from '../sites/site';
import { cookieFetch } from './fetcher';
import { loadState, mutate } from './storage';
import { syncLiveSession, withSwitchLock } from './switcher';
import type { Account, Usage } from './types';

type Outcome = { usage: Usage } | { error: string } | null;

async function fetchOne(account: Account): Promise<Outcome> {
  const adapter = getAdapter(account.siteId);
  const fetchUsage = adapter.fetchUsage;
  if (!fetchUsage) return null;
  const run = (f: SiteFetch) => fetchUsage.call(adapter, f, account.identity);

  const state = await loadState();
  if (state.active[account.siteId] !== account.id) return run(cookieFetch(account.cookies)).then(ok, fail);

  // Active session: hold the switch lock so cookies can't change mid-request, and only trust the
  // live jar when it is verifiably this account (the user may have logged in as someone else by hand).
  return withSwitchLock(async () => {
    const liveId = await syncLiveSession(adapter).catch(() => null);
    const latest = (await loadState()).accounts.find((a) => a.id === account.id) ?? account;
    const f = liveId === account.id ? activeFetch : cookieFetch(latest.cookies);
    return run(f).then(ok, fail);
  });
}

const ok = (usage: Usage): Outcome => ({ usage });
const fail = (e: unknown): Outcome => ({ error: e instanceof Error ? e.message : String(e) });

export async function refreshUsage(accountId?: string): Promise<void> {
  const { accounts } = await loadState();
  let targets: Account[];
  if (accountId !== undefined) {
    const one = accounts.find((a) => a.id === accountId);
    if (!one) throw new Error(`Unknown account: ${accountId}`);
    targets = [one];
  } else {
    targets = accounts.filter((a) => {
      try {
        return !!getAdapter(a.siteId).fetchUsage;
      } catch {
        return false;
      }
    });
  }

  for (const account of targets) {
    let outcome: Outcome;
    try {
      outcome = await fetchOne(account);
    } catch (e) {
      outcome = fail(e);
    }
    if (!outcome) continue;
    const now = Date.now();
    await mutate((draft) => {
      if (!draft.accounts.some((a) => a.id === account.id)) return;
      const prev = draft.usage[account.id];
      draft.usage[account.id] =
        'usage' in outcome
          ? { usage: outcome.usage, lastAttemptAt: now }
          : { usage: prev?.usage ?? null, error: outcome.error, lastAttemptAt: now };
    });
  }
}
