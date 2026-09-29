// End-to-end test: loads dist/ into a throwaway Chrome profile and points claude.ai at a local fake
// server (3 fake accounts), so the real cookie jar, DNR header injection and tab reloads are exercised.
// Run with `npm run e2e`. Needs Google Chrome (or CHROME_PATH) and openssl.
import puppeteer from 'puppeteer-core';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '../dist');
const OUT = path.join(HERE, 'out/');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cas-e2e-'));
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=claude.ai',
  '-addext', 'subjectAltName=DNS:claude.ai,DNS:api.github.com', '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'),
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---- fake claude.ai ----
const USERS = {
  'sk-A': { uuid: 'user-a', email: 'a@example.com', org: 'org-a', caps: ['chat', 'claude_pro'], five: 93, week: 40 },
  'sk-B': { uuid: 'user-b', email: 'b@example.com', org: 'org-b', caps: ['chat', 'claude_max'], five: 10, week: 20 },
  'sk-C': { uuid: 'user-c', email: 'c@example.com', org: 'org-c', caps: ['chat'], five: 0, week: 0 },
};
const log = [];
const cookieOf = (req, name) =>
  (req.headers.cookie ?? '').split(/;\s*/).map((p) => p.split('=')).find(([k]) => k === name)?.[1];
const server = https.createServer({ key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) }, (req, res) => {
  const sk = cookieOf(req, 'sessionKey');
  const u = USERS[sk];
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/')) log.push({ path, cookie: req.headers.cookie ?? '', sk });
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (path === '/repos/itreza7/account-switcher-for-claude/releases/latest') {
    // Real GitHub sends this CORS header; the extension has no api.github.com permission and relies on it.
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://github.com/itreza7/account-switcher-for-claude/releases/tag/v9.9.9' }));
  }
  const login = path.match(/^\/login-as\/([ABC])$/);
  if (login) {
    res.writeHead(302, {
      'set-cookie': [
        `sessionKey=sk-${login[1]}; Domain=.claude.ai; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400`,
        `lastActiveOrg=${USERS['sk-' + login[1]].org}; Path=/; Secure; SameSite=Lax; Max-Age=86400`,
      ],
      location: '/',
    });
    return res.end();
  }
  if (path === '/api/organizations') return u ? json(200, [{ uuid: u.org, name: u.org, capabilities: u.caps }]) : json(401, { error: 'unauth' });
  if (path === '/api/account') return u ? json(200, { uuid: u.uuid, email_address: u.email, full_name: u.email }) : json(401, {});
  const usage = path.match(/^\/api\/organizations\/([^/]+)\/usage$/);
  if (usage) {
    if (!u || u.org !== usage[1]) return json(403, { error: 'forbidden' });
    const inH = (h) => new Date(Date.now() + h * 3600e3).toISOString();
    return json(200, {
      five_hour: { utilization: u.five, resets_at: inH(2.2) },
      seven_day: { utilization: u.week, resets_at: inH(70) },
      seven_day_opus: { utilization: 5, resets_at: inH(70) },
      seven_day_oauth_apps: null,
    });
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>fake claude</title><h1>fake claude.ai — ${u ? u.email : 'logged out'}</h1>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

/** README images (DOCS=1): popup in light + dark, and the settings page, at 2x. */
async function docScreenshots(browser, extId) {
  const DOCS_DIR = path.resolve(HERE, '../docs');
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const shoot = async (page, scheme, width, file) => {
    const p = await browser.newPage();
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await p.setViewport({ width, height: 600, deviceScaleFactor: 2 });
    await p.goto(`chrome-extension://${extId}/src/${page}/index.html`);
    await sleep(2500); // let the popup's usage refresh finish
    // The fake server always offers v9.9.9; that banner is test noise, not part of the normal view.
    await p.evaluate(() => document.querySelector('.banner.info')?.remove());
    const height = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.screenshot({ path: path.join(DOCS_DIR, file), clip: { x: 0, y: 0, width, height } });
    await p.close();
  };
  // Show default settings, not the ones the test changed.
  const reset = await browser.newPage();
  await reset.goto(`chrome-extension://${extId}/src/options/index.html`);
  await reset.evaluate(() =>
    chrome.runtime.sendMessage({
      type: 'updateSettings',
      patch: { pollMinutes: 5, threshold: 90, autoSwitchMode: 'notify', cooldownMinutes: 10, rotationStrategy: 'best' },
    }),
  );
  await reset.close();
  await shoot('popup', 'light', 360, 'popup-light.png');
  await shoot('popup', 'dark', 360, 'popup-dark.png');
  await shoot('options', 'light', 640, 'settings.png');
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  enableExtensions: [DIST],
  acceptInsecureCerts: true,
  userDataDir: path.join(TMP, 'profile'),
  args: ['--no-first-run', '--no-default-browser-check', `--host-resolver-rules=MAP claude.ai 127.0.0.1:${PORT}, MAP api.github.com 127.0.0.1:${PORT}`, '--ignore-certificate-errors'],
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  sw.on('console', (m) => console.log('   [sw]', m.type(), m.text()));
  const jarKey = () => sw.evaluate(async () => (await chrome.cookies.get({ url: 'https://claude.ai/', name: 'sessionKey' }))?.value ?? null);
  const state = () => sw.evaluate(async () => (await chrome.storage.local.get('state')).state);

  const site = await browser.newPage();
  let reloads = 0;
  site.on('load', () => reloads++);
  await site.goto('https://claude.ai/login-as/A');
  check('fake site reachable, logged in as A', (await site.title()) === 'fake claude' && (await jarKey()) === 'sk-A');

  const popupErrors = [];
  const openPopup = async () => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => popupErrors.push(String(e)));
    await p.setViewport({ width: 380, height: 600 });
    await p.goto(`chrome-extension://${extId}/src/popup/index.html`);
    await sleep(600);
    return p;
  };
  const text = (p) => p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  const clickText = async (p, label, scope = '') => {
    const [el] = await p.$$(`xpath/${scope}//button[normalize-space(.)="${label}"]`);
    if (!el) throw new Error('button not found: ' + label);
    await el.click();
  };
  const claudeSection = '(//section[contains(concat(" ",@class," ")," site ")])[1]';

  let popup = await openPopup();
  check('update banner: newer GitHub release is offered', (await text(popup)).includes('Version 9.9.9 is available'), await text(popup));

  // 1. Save A
  await clickText(popup, 'Save current session', claudeSection);
  await sleep(1500);
  let s = await state();
  const a = s.accounts.find((x) => x.identity.email === 'a@example.com');
  check('save A: account created with identity + plan', !!a && a.identity.plan === 'Pro' && a.identity.orgId === 'org-a', a && JSON.stringify(a.identity));
  check('save A: marked active', s.active.claude === a?.id);
  check('save A: cookies captured (sessionKey + lastActiveOrg)', a?.cookies.map((c) => c.name).sort().join(',') === 'lastActiveOrg,sessionKey');
  check('save A: usage fetched via live session', s.usage[a?.id]?.usage?.fiveHour?.utilization === 93, JSON.stringify(s.usage[a?.id]));
  check('save A: extra windows parsed, null window skipped', !!s.usage[a?.id]?.usage?.extra?.seven_day_opus && !('seven_day_oauth_apps' in (s.usage[a?.id]?.usage?.extra ?? {})));
  const popupText = await text(popup);
  check('popup never receives cookies', !popupText.includes('sk-A') && !(await popup.evaluate(() => document.documentElement.outerHTML)).includes('sk-A'));

  // 2. Log in another
  await clickText(popup, 'Log in another account', claudeSection);
  await sleep(1200);
  check('login another: jar cleared', (await jarKey()) === null);
  check('login another: site tab sent to /login', site.url() === 'https://claude.ai/login', site.url());
  s = await state();
  check('login another: active = null, A still saved', s.active.claude === null && s.accounts.length === 1);

  // 3. Log in B and save
  await site.goto('https://claude.ai/login-as/B');
  popup = await openPopup();
  check('popup hint shows unsaved session', (await text(popup)).includes('Current session is not saved'));
  await clickText(popup, 'Save current session', claudeSection);
  await sleep(1500);
  s = await state();
  const b = s.accounts.find((x) => x.identity.email === 'b@example.com');
  check('save B: created, Max, active', !!b && b.identity.plan === 'Max' && s.active.claude === b.id);

  // 4. Refresh usage for all: A inactive must go through DNR cookie injection
  log.length = 0;
  await clickText(popup, '↻');
  await sleep(2500);
  s = await state();
  const aUsageReqs = log.filter((l) => l.path === '/api/organizations/org-a/usage');
  const bUsageReqs = log.filter((l) => l.path === '/api/organizations/org-b/usage');
  check('inactive A usage: request carried A cookies (DNR injection works)', aUsageReqs.length > 0 && aUsageReqs.every((l) => l.sk === 'sk-A'), JSON.stringify(aUsageReqs));
  check('inactive A usage: stored 93% / 40%', s.usage[a.id]?.usage?.fiveHour?.utilization === 93 && s.usage[a.id]?.usage?.sevenDay?.utilization === 40 && !s.usage[a.id]?.error, JSON.stringify(s.usage[a.id]));
  check('active B usage: request carried B cookies only', bUsageReqs.length > 0 && bUsageReqs.every((l) => l.sk === 'sk-B' && !l.cookie.includes('sk-A')), JSON.stringify(bUsageReqs));
  check('jar still B after inactive fetch (no leak into browser)', (await jarKey()) === 'sk-B');
  check('DNR rule removed after fetch', (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 0);
  await site.reload();
  check('normal page load after injection uses B', (await site.evaluate(() => document.body.innerText)).includes('b@example.com'));
  await popup.close();
  popup = await openPopup();
  await popup.screenshot({ path: OUT + '4-popup-two-accounts.png' });
  const pt = await text(popup);
  check('popup shows both accounts + bars', pt.includes('a@example.com') && pt.includes('b@example.com') && pt.includes('93%') && pt.includes('Active'), pt);

  // 5. Switch to A
  reloads = 0;
  const rowA = `//div[contains(concat(" ",@class," ")," account ")][.//span[@title="a@example.com"]]`;
  await clickText(popup, 'Switch', rowA);
  await sleep(1500);
  s = await state();
  check('switch to A: jar = sk-A', (await jarKey()) === 'sk-A');
  check('switch to A: active = A', s.active.claude === a.id);
  check('switch to A: claude tab reloaded as A', reloads >= 1 && (await site.evaluate(() => document.body.innerText)).includes('a@example.com'));
  check('switch to A: lastActiveOrg restored too', await sw.evaluate(async () => (await chrome.cookies.get({ url: 'https://claude.ai/', name: 'lastActiveOrg' }))?.value) === 'org-a');

  // 6. Auto-switch notify: A is at 93% >= 90
  const fireAlarm = () => sw.evaluate(() => chrome.alarms.create('poll', { delayInMinutes: 0.005 }));
  await fireAlarm();
  await sleep(4000);
  const notes = await sw.evaluate(() => new Promise((r) => chrome.notifications.getAll(r)));
  check('auto-switch notify: notification to switch to B', Object.keys(notes).includes(`autoswitch:${b.id}`), JSON.stringify(notes));
  check('auto-switch notify: did NOT switch', (await jarKey()) === 'sk-A');

  // 7. Mode = switch, cooldown 0 via options page
  const opts = await browser.newPage();
  await opts.goto(`chrome-extension://${extId}/src/options/index.html`);
  await sleep(500);
  await opts.select('select', 'switch');
  const numInputs = await opts.$$('input[type=number]');
  const labels = await Promise.all(numInputs.map((i) => i.evaluate((e) => e.id || e.name)));
  const cd = numInputs[labels.findIndex((l) => /cool/i.test(l))];
  await cd.evaluate((e) => { e.value = ''; });
  await cd.type('0');
  await clickText(opts, 'Save');
  await sleep(800);
  s = await state();
  check('options save: mode switch, cooldown 0', s.settings.autoSwitchMode === 'switch' && s.settings.cooldownMinutes === 0, JSON.stringify(s.settings));
  check('options save: alarm period kept', (await sw.evaluate(() => chrome.alarms.get('poll')))?.periodInMinutes === s.settings.pollMinutes);
  await fireAlarm();
  await sleep(4000);
  s = await state();
  check('auto-switch: switched A -> B', (await jarKey()) === 'sk-B' && s.active.claude === b.id);

  // 8. Unsaved session guard
  await site.goto('https://claude.ai/login-as/C');
  popup = await openPopup();
  await clickText(popup, 'Switch', rowA);
  await sleep(1500);
  check('unsaved C: switch refused, C kept', (await jarKey()) === 'sk-C' && (await text(popup)).includes('not saved'), await text(popup));
  await clickText(popup, 'Log in another account', claudeSection);
  await sleep(1000);
  check('unsaved C: login-another refused, C kept', (await jarKey()) === 'sk-C');

  // 9. Manual login as a SAVED account while state says another is active
  await site.goto('https://claude.ai/login-as/A'); // state still says B active
  popup = await openPopup();
  const rowB = `//div[contains(concat(" ",@class," ")," account ")][.//span[@title="b@example.com"]]`;
  await clickText(popup, 'Switch', rowB);
  await sleep(1500);
  s = await state();
  const storedB = s.accounts.find((x) => x.id === b.id);
  check('manual A login then switch to B: B cookies not overwritten by A', storedB.cookies.find((c) => c.name === 'sessionKey').value === 'sk-B' && (await jarKey()) === 'sk-B');

  // 10. Rename + remove
  await popup.close();
  popup = await openPopup();
  await clickText(popup, '✎', rowA);
  await popup.keyboard.down('Meta'); await popup.keyboard.press('a'); await popup.keyboard.up('Meta');
  await popup.keyboard.type('Work');
  await popup.keyboard.press('Enter');
  await sleep(600);
  s = await state();
  check('rename A -> Work', s.accounts.find((x) => x.id === a.id)?.label === 'Work');
  popup.on('dialog', (d) => d.accept());
  const rowWork = `//div[contains(concat(" ",@class," ")," account ")][.//span[@title="a@example.com"]]`;
  const [rm] = await popup.$$(`xpath/${rowWork}//button[@title="Remove"]`);
  await rm.click();
  await sleep(800);
  s = await state();
  check('remove A: gone from storage + usage', !s.accounts.some((x) => x.id === a.id) && !s.usage[a.id]);
  check('remove A: browser cookies untouched', (await jarKey()) === 'sk-B');
  await popup.screenshot({ path: OUT + '5-popup-final.png' });

  // 11. cswap-style rotation. Now: only B saved, B live.
  check('rotation: no "Switch to next" with one account', !(await text(popup)).includes('Switch to next'));
  const saveAs = async (who) => {
    let p = await openPopup();
    await clickText(p, 'Log in another account', claudeSection);
    await sleep(1000);
    await site.goto(`https://claude.ai/login-as/${who}`);
    p = await openPopup();
    await clickText(p, 'Save current session', claudeSection);
    await sleep(1500);
    return p;
  };
  await saveAs('A');
  popup = await saveAs('C'); // order: B, A, C — active C
  await clickText(popup, '↻');
  await sleep(2500);
  s = await state();
  check('rotation: order B, A, C with fresh usage', s.accounts.map((x) => x.identity.email[0]).join('') === 'bac' && s.accounts.every((x) => s.usage[x.id]?.usage), s.accounts.map((x) => x.identity.email).join());
  const setStrategy = async (value) => {
    const o = await browser.newPage();
    await o.goto(`chrome-extension://${extId}/src/options/index.html`);
    await sleep(400);
    await o.select('#rotationStrategy', value);
    await clickText(o, 'Save');
    await sleep(600);
    const shortcutText = await o.evaluate(() => document.getElementById('shortcut').textContent);
    await o.close();
    return shortcutText;
  };
  const next = async () => {
    const p = await openPopup();
    await clickText(p, 'Switch to next', claudeSection);
    await sleep(1500);
    await p.close();
    return jarKey();
  };
  // default 'best': from C -> A is at 93% (unavailable), B has 10/20 -> B
  check('rotation best: C -> B (A is near limit)', (await state()).settings.rotationStrategy === 'best' && (await next()) === 'sk-B');
  const sc = await setStrategy('next');
  check('options shows the shortcut', /Alt\+Shift\+S|⌥⇧S/.test(sc), sc);
  check('rotation next: B -> A (plain order, ignores limit)', (await next()) === 'sk-A');
  check('rotation next: A -> C', (await next()) === 'sk-C');
  check('rotation next: C -> B (wraps)', (await next()) === 'sk-B');
  await setStrategy('next-available');
  check('rotation next-available: B -> C (skips A at 93%)', (await next()) === 'sk-C');
  check('rotation next-available: C -> B (wraps, skips A)', (await next()) === 'sk-B');
  check('rotation: claude tab follows the switch', (await site.evaluate(() => document.body.innerText)).includes('b@example.com'));
  s = await state();
  check('rotation: active matches jar', s.accounts.find((x) => x.id === s.active.claude)?.identity.email === 'b@example.com');
  popup = await openPopup();
  await popup.screenshot({ path: OUT + '6-popup-rotation.png' });
  check('popup footer shows strategy', (await text(popup)).includes('Next: next available'), await text(popup));
  if (process.env.DOCS) await docScreenshots(browser, extId);

  check('no popup page errors', popupErrors.length === 0, popupErrors.join(' / '));
  check('no leftover DNR rules', (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 0);
} catch (e) {
  console.log('CRASH', e);
  results.push({ name: 'crash', ok: false });
} finally {
  await browser.close();
  server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}
