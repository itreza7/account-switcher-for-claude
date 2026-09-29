export type SiteId = string;

/** A cookie as read from chrome.cookies. Stored as-is so it can be restored later. */
export type StoredCookie = chrome.cookies.Cookie;

export interface AccountIdentity {
  /** Stable unique key used to detect duplicates (e.g. account uuid, or email). */
  key: string;
  email?: string;
  name?: string;
  orgId?: string;
  orgName?: string;
  plan?: string;
}

export interface Account {
  id: string;
  siteId: SiteId;
  label: string;
  identity: AccountIdentity;
  cookies: StoredCookie[];
  createdAt: number;
  updatedAt: number;
}

/** Account without secrets. The only account shape that ever leaves the background worker. */
export type AccountView = Omit<Account, 'cookies'>;

export interface UsageWindow {
  /** Percent used, 0-100. */
  utilization: number;
  /** ISO timestamp, or null when unknown. */
  resetsAt: string | null;
}

export interface Usage {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  /** Other windows the API returns (e.g. seven_day_opus), keyed by API name. */
  extra: Record<string, UsageWindow>;
  fetchedAt: number;
}

export interface UsageEntry {
  /** Last good value, kept even when a later fetch fails. */
  usage: Usage | null;
  error?: string;
  lastAttemptAt: number;
}

export type AutoSwitchMode = 'off' | 'notify' | 'switch';

/** How "switch to next" picks the target (cswap-style). */
export type RotationStrategy = 'next' | 'next-available' | 'best';

export interface Settings {
  pollMinutes: number;
  /** Percent (0-100). At or above this, the account counts as "near limit". */
  threshold: number;
  autoSwitchMode: AutoSwitchMode;
  cooldownMinutes: number;
  rotationStrategy: RotationStrategy;
}

export const DEFAULT_SETTINGS: Settings = {
  pollMinutes: 5,
  threshold: 90,
  autoSwitchMode: 'notify',
  cooldownMinutes: 10,
  rotationStrategy: 'best',
};

export interface StoreState {
  schemaVersion: number;
  accounts: Account[];
  /** Active account id per site, or null when the current browser session is not a saved account. */
  active: Record<SiteId, string | null>;
  /** Keyed by account id. */
  usage: Record<string, UsageEntry>;
  settings: Settings;
  autoSwitch: { lastActionAt: number | null };
}

export const SCHEMA_VERSION = 1;

export interface SiteView {
  id: SiteId;
  name: string;
  hasUsage: boolean;
}

export interface StateView {
  sites: SiteView[];
  accounts: AccountView[];
  active: Record<SiteId, string | null>;
  usage: Record<string, UsageEntry>;
  settings: Settings;
}
