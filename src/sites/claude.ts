import type { AccountIdentity, Usage, UsageWindow } from '../core/types';
import type { SiteAdapter, SiteFetch } from './site';

export type Json = Record<string, unknown>;

export function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

export async function getJson(fetch: SiteFetch, url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  try {
    return await res.json();
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

interface Org {
  uuid: string;
  name?: string;
  capabilities: string[];
}

function parseOrgs(data: unknown): Org[] {
  if (!Array.isArray(data)) return [];
  const orgs: Org[] = [];
  for (const o of data) {
    if (!isRecord(o)) continue;
    const uuid = str(o.uuid);
    if (!uuid) continue;
    const caps = Array.isArray(o.capabilities) ? o.capabilities.filter((c): c is string => typeof c === 'string') : [];
    orgs.push({ uuid, name: str(o.name), capabilities: caps });
  }
  return orgs;
}

function planFromCapabilities(caps: string[]): string {
  if (caps.includes('claude_max')) return 'Max';
  if (caps.includes('claude_pro')) return 'Pro';
  if (caps.includes('raven')) return 'Team';
  return 'Free';
}

/** Best effort: the account endpoint's shape is not documented, so accept a few layouts. */
async function fetchAccountInfo(fetch: SiteFetch, origin: string) {
  try {
    const data = await getJson(fetch, `${origin}/api/account`);
    if (!isRecord(data)) return {};
    const acc = isRecord(data.account) ? data.account : data;
    return {
      uuid: str(acc.uuid),
      email: str(acc.email_address) ?? str(acc.email),
      name: str(acc.full_name) ?? str(acc.display_name),
    };
  } catch {
    return {};
  }
}

/** Shared by the Claude and Console adapters. Throws when the organizations call fails or is empty. */
export async function identityFromOrigin(
  fetch: SiteFetch,
  origin: string,
  opts: { withPlan: boolean },
): Promise<AccountIdentity> {
  const orgs = parseOrgs(await getJson(fetch, `${origin}/api/organizations`));
  const org = orgs.find((o) => o.capabilities.includes('chat')) ?? orgs[0];
  if (!org) throw new Error(`No organization found at ${origin}`);
  const acc = await fetchAccountInfo(fetch, origin);
  const identity: AccountIdentity = {
    key: acc.uuid ?? acc.email ?? org.uuid,
    orgId: org.uuid,
  };
  if (acc.email) identity.email = acc.email;
  if (acc.name) identity.name = acc.name;
  if (org.name) identity.orgName = org.name;
  if (opts.withPlan) identity.plan = planFromCapabilities(org.capabilities);
  return identity;
}

function parseWindow(v: unknown): UsageWindow | null {
  if (!isRecord(v)) return null;
  const u = v.utilization;
  if (typeof u !== 'number' || !Number.isFinite(u)) return null;
  return { utilization: Math.min(100, Math.max(0, u)), resetsAt: str(v.resets_at) ?? null };
}

export const claudeAdapter: SiteAdapter = {
  id: 'claude',
  name: 'Claude',
  homeUrl: 'https://claude.ai/',
  loginUrl: 'https://claude.ai/login',
  tabUrlPatterns: ['https://claude.ai/*'],
  cookieDomains: ['claude.ai'],
  // getAll({ domain: 'claude.ai' }) also returns subdomain cookies; keep only the claude.ai session ones.
  cookieFilter: (c) => c.domain === 'claude.ai' || c.domain === '.claude.ai',
  isLoggedIn: (cookies) => cookies.some((c) => c.name === 'sessionKey' && c.value !== ''),
  fetchIdentity: (fetch) => identityFromOrigin(fetch, 'https://claude.ai', { withPlan: true }),
  async fetchUsage(fetch, identity): Promise<Usage> {
    if (!identity.orgId) throw new Error('Missing organization id');
    const data = await getJson(fetch, `https://claude.ai/api/organizations/${identity.orgId}/usage`);
    if (!isRecord(data)) throw new Error('Unexpected usage response');
    const usage: Usage = { fiveHour: null, sevenDay: null, extra: {}, fetchedAt: Date.now() };
    for (const [key, value] of Object.entries(data)) {
      const w = parseWindow(value);
      if (key === 'five_hour') usage.fiveHour = w;
      else if (key === 'seven_day') usage.sevenDay = w;
      else if (w) usage.extra[key] = w;
    }
    return usage;
  },
};
