import type { AccountView, Settings, SiteId, StateView } from './types';

/** Every popup/options -> background request, with its response type. */
export interface MessageMap {
  getState: { req: Record<string, never>; res: StateView };
  /** Save the browser's current session for a site as an account (updates it if the identity already exists). */
  saveCurrent: { req: { siteId: SiteId; label?: string }; res: AccountView };
  /** Keep the current session saved, clear the site's cookies, open the login page. */
  loginAnother: { req: { siteId: SiteId }; res: void };
  switch: { req: { accountId: string }; res: void };
  /** cswap-style rotation using settings.rotationStrategy. Returns the account switched to. */
  switchNext: { req: { siteId: SiteId }; res: AccountView };
  rename: { req: { accountId: string; label: string }; res: void };
  remove: { req: { accountId: string }; res: void };
  /** Refresh usage for one account, or all accounts with usage support when omitted. */
  refreshUsage: { req: { accountId?: string }; res: void };
  updateSettings: { req: { patch: Partial<Settings> }; res: Settings };
}

export type MessageType = keyof MessageMap;

export type Request<K extends MessageType = MessageType> = K extends MessageType
  ? { type: K } & MessageMap[K]['req']
  : never;

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export type Handlers = {
  [K in MessageType]: (req: MessageMap[K]['req']) => Promise<MessageMap[K]['res']>;
};

/** Send a typed request to the background worker. Throws on error responses. */
export async function send<K extends MessageType>(
  type: K,
  ...args: MessageMap[K]['req'] extends Record<string, never> ? [] : [MessageMap[K]['req']]
): Promise<MessageMap[K]['res']> {
  const res = (await chrome.runtime.sendMessage({ type, ...(args[0] ?? {}) })) as
    | Response<MessageMap[K]['res']>
    | undefined;
  if (!res) throw new Error('No response from background');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
