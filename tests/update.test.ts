import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadState } from '../src/core/storage';
import { availableUpdate, checkForUpdate, compareVersions } from '../src/core/update';
import { installChromeMock } from './chrome-mock';

const PAGE = 'https://github.com/itreza7/account-switcher-for-claude/releases/tag/v0.2.0';

describe('compareVersions', () => {
  it('compares numerically, part by part', () => {
    expect(compareVersions('0.10.0', '0.9.1')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });
});

describe('availableUpdate', () => {
  it('only offers a newer version', () => {
    const u = (latestVersion: string | null) => ({ latestVersion, url: PAGE, checkedAt: 1 });
    expect(availableUpdate(u('0.2.0'), '0.1.0')).toEqual({ version: '0.2.0', url: PAGE });
    expect(availableUpdate(u('0.1.0'), '0.1.0')).toBeNull();
    expect(availableUpdate(u('0.0.9'), '0.1.0')).toBeNull();
    expect(availableUpdate(u(null), '0.1.0')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    installChromeMock();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores the latest release without cookies', async () => {
    reply({ tag_name: 'v0.2.0', html_url: PAGE });
    await checkForUpdate(123);
    expect((await loadState()).update).toEqual({ latestVersion: '0.2.0', url: PAGE, checkedAt: 123 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/itreza7/account-switcher-for-claude/releases/latest');
    expect(init.credentials).toBe('omit');
  });

  it('rejects a release URL outside this repo (the popup links to it)', async () => {
    reply({ tag_name: 'v0.2.0', html_url: PAGE });
    await checkForUpdate(1);
    reply({ tag_name: 'v9.0.0', html_url: 'https://evil.example/releases/' });
    await checkForUpdate(2);
    expect((await loadState()).update).toEqual({ latestVersion: '0.2.0', url: PAGE, checkedAt: 1 });
  });

  it('rejects odd tags, HTTP errors and network errors, keeping the old value', async () => {
    reply({ tag_name: 'v0.2.0', html_url: PAGE });
    await checkForUpdate(1);
    reply({ tag_name: 'nightly', html_url: PAGE });
    await checkForUpdate(2);
    reply({ message: 'Not Found' }, 404);
    await checkForUpdate(3);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(checkForUpdate(4)).resolves.toBeUndefined();
    expect((await loadState()).update.checkedAt).toBe(1);
  });
});
