import { FETCH_TIMEOUT_MS, netLock } from '../sites/site';
import { mutate } from './storage';
import type { StoreState } from './types';

export const GITHUB_REPO = 'itreza7/account-switcher-for-claude';
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/`;

/** Compares dotted numeric versions ("v1.10.0" > "1.9.3"). Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().replace(/^v/i, '').split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** The update to offer, or null when the installed version is current. */
export function availableUpdate(update: StoreState['update'], installed: string): { version: string; url: string } | null {
  if (!update.latestVersion || !update.url) return null;
  return compareVersions(update.latestVersion, installed) > 0 ? { version: update.latestVersion, url: update.url } : null;
}

/** Looks up the latest GitHub release. Failures keep the previous result. */
export async function checkForUpdate(now: number = Date.now()): Promise<void> {
  try {
    const res = await netLock(() =>
      fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        credentials: 'omit',
        headers: { accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} from GitHub`);
    const data: unknown = await res.json();
    const tag = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).tag_name : undefined;
    const url = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).html_url : undefined;
    if (typeof tag !== 'string' || !/^v?\d+(\.\d+)*$/.test(tag)) throw new Error('Unexpected release tag');
    // The popup links to this URL, so only ever accept this repo's release pages.
    if (typeof url !== 'string' || !url.startsWith(RELEASES_PAGE)) throw new Error('Unexpected release URL');
    await mutate((d) => {
      d.update = { latestVersion: tag.replace(/^v/i, ''), url, checkedAt: now };
    });
  } catch (e) {
    console.warn('update check failed', e);
  }
}
