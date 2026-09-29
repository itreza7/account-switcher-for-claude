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

/** README images (DOCS=1), all at 2x. The popup is opened as a tab at its real 360px width. */
const DOCS_DIR = path.resolve(HERE, '../docs');
async function shoot(browser, extId, page, { scheme = 'light', width, file, full = false, wait = 2500 }) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const p = await browser.newPage();
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await p.setViewport({ width, height: 600, deviceScaleFactor: 2 });
  await p.goto(`chrome-extension://${extId}/src/${page}/index.html`);
  // The fake server always offers v9.9.9; that banner is test noise, not part of the normal view.
  await p.addStyleTag({ content: '.banners:not(:has(.banner-accent)){display:none !important}' });
  await sleep(wait); // let the usage refresh and the fonts settle
  const out = path.join(DOCS_DIR, file);
  if (full) await p.screenshot({ path: out, fullPage: true });
  else {
    const height = await p.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
    await p.screenshot({ path: out, clip: { x: 0, y: 0, width, height } });
  }
  await p.close();
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
  const badge = () =>
    sw.evaluate(async () => ({ text: await chrome.action.getBadgeText({}), color: await chrome.action.getBadgeBackgroundColor({}) }));
  /** The badge is redrawn a moment after storage changes, so wait for the expected text. */
  const waitBadge = async (text, ms = 4000) => {
    const end = Date.now() + ms;
    let b = await badge();
    while (b.text !== text && Date.now() < end) {
      await sleep(150);
      b = await badge();
    }
    return b;
  };
  const until = async (fn, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = await fn();
        if (v) return v;
      } catch {
        // not ready yet
      }
      await sleep(100);
    }
    return false;
  };

  // ---- 0. Welcome page opens once on install ----
  const welcomeUrl = `chrome-extension://${extId}/src/welcome/index.html`;
  const welcomePages = async () => (await browser.pages()).filter((p) => p.url().endsWith('src/welcome/index.html'));
  await until(async () => (await welcomePages()).length > 0, 8000);
  const welcome = (await welcomePages())[0];
  check('welcome: tab opened on install', !!welcome && welcome.url() === welcomeUrl, welcome?.url());
  if (welcome) {
    await sleep(500);
    check('welcome: title + heading render', (await welcome.title()) === 'Welcome - Account Switcher for Claude' &&
      (await welcome.$eval('h1', (e) => e.textContent)) === 'Welcome to Account Switcher for Claude', await welcome.title());
    check('welcome: all 3 steps, tips and both actions render', (await welcome.$$('.step')).length === 3 && (await welcome.$$('.tip')).length === 3 &&
      (await welcome.$$('.actions .btn')).length === 2 && !(await welcome.evaluate(() => document.body.innerText.includes('undefined'))));
  }
  check('badge: empty before any account is saved', (await badge()).text === '');

  const site = await browser.newPage();
  let reloads = 0;
  site.on('load', () => reloads++);
  await site.goto('https://claude.ai/login-as/A');
  check('fake site reachable, logged in as A', (await site.title()) === 'fake claude' && (await jarKey()) === 'sk-A');

  const pageErrors = [];
  const openPopup = async () => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => pageErrors.push(String(e)));
    await p.setViewport({ width: 360, height: 600 });
    await p.goto(`chrome-extension://${extId}/src/popup/index.html`);
    await p.bringToFront();
    await sleep(700);
    return p;
  };
  const openOptions = async () => {
    const p = await browser.newPage();
    p.on('pageerror', (e) => pageErrors.push(String(e)));
    await p.setViewport({ width: 1000, height: 900 });
    await p.goto(`chrome-extension://${extId}/src/options/index.html`);
    await p.waitForFunction(() => !document.getElementById('cards').inert);
    return p;
  };
  const text = (p) => p.evaluate(() => document.body.innerText.replace(/\n+/g, ' | '));
  const has = async (p, s) => (await text(p)).toLowerCase().includes(s.toLowerCase());
  const clickText = async (p, label, scope = '') => {
    const [el] = await p.$$(`xpath/${scope}//button[normalize-space(.)="${label}"]`);
    if (!el) throw new Error('button not found: ' + label);
    await el.click();
  };
  const mainOf = (id) => `[data-account-id="${id}"] .row-main`;
  const moreOf = (id) => `[data-fk="more:${id}"]`;
  const focusedKey = (p) => p.evaluate(() => document.activeElement?.dataset?.fk ?? null);
  const toastText = (p, kind) =>
    p.evaluate((k) => [...document.querySelectorAll(`.toast-${k}`)].map((e) => e.textContent).join(' | '), kind);
  const errorBanner = (p) => p.evaluate(() => document.querySelector('.banners .banner-error[role="alert"] .banner-body')?.textContent ?? null);
  const menuItem = async (p, id, label) => {
    await p.click(moreOf(id));
    await p.waitForSelector('.menu');
    await clickText(p, label, '//div[@role="menu"]');
  };
  /** "Add account" is a split button: the main part acts on the current site, the chevron opens a menu with one entry per site.
   *  Pick the Claude entry ("Save current …" or "Log in to another …") from that menu. */
  const addClaude = async (p) => {
    await p.click('[data-fk="add-more"]');
    await p.waitForSelector('#menu');
    const [el] = await p.$$('xpath///div[@role="menu"]//button[@role="menuitem"][contains(., "Claude account")]');
    if (!el) throw new Error('no Claude entry in the Add account menu');
    await el.click();
  };
  /** Saves the unsaved live session: the banner button, or the empty-state button when nothing is saved. */
  const saveUnsaved = async (p) => {
    await p.click('[data-fk="banner-save"], [data-fk="empty-cta"]');
    await sleep(1500);
  };

  // ---- 1. Empty state, update banner, save A ----
  let popup = await openPopup();
  check('empty state: title, 3 steps and "Save this account" (no rows, no footer)',
    (await has(popup, 'Add your first account')) && (await popup.$$('.steps li')).length === 3 && (await has(popup, 'Save this account')) &&
      (await popup.$$('.account')).length === 0 && !(await popup.$('.footer')), await text(popup));
  check('update banner: newer GitHub release is offered', await has(popup, 'Version 9.9.9 is available'), await text(popup));
  if (process.env.DOCS) await shoot(browser, extId, 'popup', { width: 360, file: 'popup-empty.png' });

  await popup.click('[data-fk="empty-cta"]');
  await popup.waitForSelector('.toast-success', { timeout: 5000 }).catch(() => {});
  const saveToast = await toastText(popup, 'success');
  await sleep(1200);
  let s = await state();
  const a = s.accounts.find((x) => x.identity.email === 'a@example.com');
  check('save A: success toast "Saved …"', /^Saved a@example\.com/.test(saveToast), saveToast);
  check('save A: account created with identity + plan', !!a && a.identity.plan === 'Pro' && a.identity.orgId === 'org-a', a && JSON.stringify(a.identity));
  check('save A: marked active', s.active.claude === a?.id);
  check('save A: cookies captured (sessionKey + lastActiveOrg)', a?.cookies.map((c) => c.name).sort().join(',') === 'lastActiveOrg,sessionKey');
  check('save A: usage fetched via live session', s.usage[a?.id]?.usage?.fiveHour?.utilization === 93, JSON.stringify(s.usage[a?.id]));
  check('save A: extra windows parsed, null window skipped', !!s.usage[a?.id]?.usage?.extra?.seven_day_opus && !('seven_day_oauth_apps' in (s.usage[a?.id]?.usage?.extra ?? {})));
  const popupText = await text(popup);
  check('popup never receives cookies', !popupText.includes('sk-A') && !(await popup.evaluate(() => document.documentElement.outerHTML)).includes('sk-A'));
  check('save A: row shows Active pill, Pro plan, 93%', (await popup.$$('.account.active')).length === 1 && (await has(popup, 'Pro')) && popupText.includes('93%'), popupText);
  let b93 = await waitBadge('93%');
  check('badge: shows the higher of 5h/weekly for A (93 vs 40) "93%"', b93.text === '93%', JSON.stringify(b93));
  check('badge: danger color at/above threshold', b93.color.join() === '201,60,50,255', b93.color.join());

  // ---- 2. Log in another ----
  await addClaude(popup);
  await sleep(1200);
  check('login another: jar cleared', (await jarKey()) === null);
  check('login another: site tab sent to /login', site.url() === 'https://claude.ai/login', site.url());
  s = await state();
  check('login another: active = null, A still saved', s.active.claude === null && s.accounts.length === 1);
  check('badge: cleared when no account is active', (await waitBadge('')).text === '');

  // ---- 3. Log in B; the unsaved banner saves it ----
  await site.goto('https://claude.ai/login-as/B');
  popup = await openPopup();
  check('unsaved banner: shown for an unsaved session next to a saved account',
    await has(popup, "isn't saved yet") && !!(await popup.$('.banner-accent [data-fk="banner-save"]')), await text(popup));
  await saveUnsaved(popup);
  s = await state();
  const b = s.accounts.find((x) => x.identity.email === 'b@example.com');
  check('unsaved banner: Save button saves B (Max, active)', !!b && b.identity.plan === 'Max' && s.active.claude === b.id);
  check('unsaved banner: gone after saving', !(await popup.$('.banner-accent')));
  check('badge: shows B higher window "20%" (5h 10, weekly 20; ok color)', (await waitBadge('20%')).color.join() === '34,106,62,255', JSON.stringify(await badge()));

  // ---- 4. Refresh usage for all: A inactive must go through DNR cookie injection ----
  log.length = 0;
  await popup.click('button[aria-label="Refresh usage"]');
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
  check('popup shows both accounts + bars', pt.includes('a@example.com') && pt.includes('b@example.com') && pt.includes('93%') && pt.includes('40%') && (await has(popup, 'Active')), pt);
  check('popup: near-limit meter is styled danger, ok meter is not',
    (await popup.$$(`${mainOf(a.id)} .meter-fill.is-danger`)).length >= 1 && (await popup.$$(`${mainOf(b.id)} .meter-fill.is-danger`)).length === 0);

  check('popup: near-limit A shows "Resets in …" in the sub-line, B shows none',
    /^Resets in /.test(await popup.$eval(`[data-account-id="${a.id}"] .sub-line .reset-hint.is-danger`, (e) => e.textContent).catch(() => '')) &&
      (await popup.$(`[data-account-id="${b.id}"] .reset-hint`)) === null);
  check('popup: split Add button (main + chevron) when several sites exist', !!(await popup.$('.btn-split [data-fk="add"]')) && !!(await popup.$('.btn-split [data-fk="add-more"]')));
  await popup.click('[data-fk="add-more"]');
  await popup.waitForSelector('#menu');
  const addItems = await popup.$$eval('#menu [role="menuitem"]', (els) => els.length);
  check('popup: chevron opens the site menu (one entry per site)', addItems >= 2 && (await popup.$eval('#add-more', (e) => e.getAttribute('aria-expanded'))) === 'true', String(addItems));
  await popup.keyboard.press('Escape');
  check('popup: Escape closes the site menu', (await popup.$('#menu')) === null);
  const refreshCalls = async () => (await sw.evaluate(() => 0), log.filter((l) => l.path.endsWith('/usage')).length);
  log.length = 0;
  await popup.close();
  popup = await openPopup();
  await sleep(1000);
  check('popup: opening with fresh usage does not refresh again', (await refreshCalls()) === 0, String(await refreshCalls()));

  // ---- 5. Switch to A by clicking its row ----
  reloads = 0;
  await popup.click(mainOf(a.id));
  await popup.waitForSelector('.toast-success', { timeout: 4000 }).catch(() => {});
  const rowSwitchToast = await toastText(popup, 'success');
  await sleep(1500);
  s = await state();
  check('switch to A: row click shows the toast "Switched to a@example.com"', rowSwitchToast === 'Switched to a@example.com', rowSwitchToast);
  check('switch to A: jar = sk-A', (await jarKey()) === 'sk-A');
  check('switch to A: active = A', s.active.claude === a.id);
  check('switch to A: claude tab reloaded as A', reloads >= 1 && (await site.evaluate(() => document.body.innerText)).includes('a@example.com'));
  check('switch to A: lastActiveOrg restored too', await sw.evaluate(async () => (await chrome.cookies.get({ url: 'https://claude.ai/', name: 'lastActiveOrg' }))?.value) === 'org-a');
  check('switch to A: Active pill moved to A', await popup.evaluate((id) => document.querySelector(`[data-account-id="${id}"]`)?.classList.contains('active'), a.id));
  check('badge: back to "93%" after switching to A', (await waitBadge('93%')).text === '93%');

  // ---- 5b. Keyboard: ArrowDown / ArrowUp move focus between rows, Enter switches ----
  await popup.bringToFront();
  await popup.focus(mainOf(a.id));
  await popup.keyboard.press('ArrowDown');
  check('keyboard: ArrowDown moves focus A -> B', (await focusedKey(popup)) === `main:${b.id}`, await focusedKey(popup));
  await popup.keyboard.press('ArrowDown');
  check('keyboard: ArrowDown wraps B -> A', (await focusedKey(popup)) === `main:${a.id}`, await focusedKey(popup));
  await popup.keyboard.press('ArrowUp');
  check('keyboard: ArrowUp wraps A -> B', (await focusedKey(popup)) === `main:${b.id}`, await focusedKey(popup));
  await popup.keyboard.press('Enter');
  await sleep(1500);
  s = await state();
  check('keyboard: Enter on focused row switches to B', (await jarKey()) === 'sk-B' && s.active.claude === b.id);
  check('keyboard: focus stays on the row after the switch', (await focusedKey(popup)) === `main:${b.id}`, await focusedKey(popup));
  check('badge: "20%" after switching to B', (await waitBadge('20%')).text === '20%');
  await popup.click(mainOf(a.id)); // back to A for the auto-switch scenarios
  await sleep(1500);
  check('switch back to A by click', (await jarKey()) === 'sk-A' && (await state()).active.claude === a.id);

  // ---- 6. Auto-switch notify: A is at 93% >= 90 ----
  const fireAlarm = () => sw.evaluate(() => chrome.alarms.create('poll', { delayInMinutes: 0.005 }));
  await fireAlarm();
  await sleep(4000);
  const notes = await sw.evaluate(() => new Promise((r) => chrome.notifications.getAll(r)));
  check('auto-switch notify: notification to switch to B', Object.keys(notes).includes(`autoswitch:${b.id}`), JSON.stringify(notes));
  check('auto-switch notify: did NOT switch', (await jarKey()) === 'sk-A');

  // ---- 7. Settings auto-save: mode = switch, cooldown 0 ----
  let opts = await openOptions();
  const readSaved = async (o) => (await o.waitForSelector('#toasts .toast-success', { timeout: 3000 }).catch(() => null)) && (await o.$eval('#toasts .toast-success', (e) => e.textContent));
  check('options: controls filled from settings', (await opts.$eval('#threshold', (e) => e.value)) === '90' && (await opts.$eval('#pollMinutes', (e) => e.value)) === '5' &&
    (await opts.$eval('#autoSwitchMode [aria-checked="true"]', (e) => e.dataset.value)) === 'notify');
  check('options: cooldown + warning hidden unless needed', await opts.$eval('#switchWarn', (e) => e.hidden));
  await opts.click('#autoSwitchMode [data-value="switch"]');
  check('options: changing the mode shows the "Saved" toast', (await readSaved(opts)) === 'Saved');
  check('options: switching mode reveals warning + cooldown', !(await opts.$eval('#switchWarn', (e) => e.hidden)) && !(await opts.$eval('#cooldownField', (e) => e.hidden)));
  await opts.focus('#cooldownMinutes');
  await opts.$eval('#cooldownMinutes', (e) => e.select());
  await opts.keyboard.type('0');
  await sleep(1000);
  s = await state();
  check('options auto-save: mode switch, cooldown 0', s.settings.autoSwitchMode === 'switch' && s.settings.cooldownMinutes === 0, JSON.stringify(s.settings));
  // threshold slider by keyboard: 90 -> 85
  await opts.focus('#threshold');
  for (let i = 0; i < 5; i++) await opts.keyboard.press('ArrowLeft');
  check('options: slider shows the live value', (await opts.$eval('#thresholdValue', (e) => e.textContent)) === '85%');
  await sleep(1000);
  s = await state();
  check('options auto-save: threshold 85', s.settings.threshold === 85, String(s.settings.threshold));
  // stepper
  await opts.click('[data-stepper]:has(#pollMinutes) [data-step="1"]');
  await sleep(1000);
  s = await state();
  check('options auto-save: poll stepper + -> 6', s.settings.pollMinutes === 6, String(s.settings.pollMinutes));
  check('options save: alarm period follows', (await sw.evaluate(() => chrome.alarms.get('poll')))?.periodInMinutes === 6);
  await opts.close();
  opts = await openOptions();
  check('options persist after reload: threshold, poll, mode, cooldown',
    (await opts.$eval('#threshold', (e) => e.value)) === '85' && (await opts.$eval('#thresholdValue', (e) => e.textContent)) === '85%' &&
      (await opts.$eval('#pollMinutes', (e) => e.value)) === '6' && (await opts.$eval('#cooldownMinutes', (e) => e.value)) === '0' &&
      (await opts.$eval('#autoSwitchMode [aria-checked="true"]', (e) => e.dataset.value)) === 'switch');
  // back to the defaults the later steps expect
  await opts.focus('#threshold');
  for (let i = 0; i < 5; i++) await opts.keyboard.press('ArrowRight');
  await opts.click('[data-stepper]:has(#pollMinutes) [data-step="-1"]');
  await sleep(1000);
  s = await state();
  check('options auto-save: threshold back to 90, poll back to 5', s.settings.threshold === 90 && s.settings.pollMinutes === 5, JSON.stringify(s.settings));
  await opts.close();
  await fireAlarm();
  await sleep(4000);
  s = await state();
  check('auto-switch: switched A -> B', (await jarKey()) === 'sk-B' && s.active.claude === b.id);
  check('badge: "20%" after the auto-switch to B', (await waitBadge('20%')).text === '20%');

  // ---- 8. Unsaved session guard ----
  await site.goto('https://claude.ai/login-as/C');
  popup = await openPopup();
  check('reconcile: unsaved C shows the unsaved banner on open, no click needed', !!(await popup.$('.banner-accent [data-fk="banner-save"]')) && (await state()).active.claude === null, await text(popup));
  check('reconcile: no row is marked Active while an unsaved account is live', (await popup.$$('.account.active')).length === 0);
  await popup.click(mainOf(a.id));
  await popup.waitForSelector('.banner-error', { timeout: 5000 }).catch(() => {});
  await sleep(500);
  check('unsaved C: switch refused, C kept', (await jarKey()) === 'sk-C');
  const errMsg = await errorBanner(popup);
  check('unsaved C: error banner (role=alert) explains it', !!errMsg && errMsg.includes("isn't saved"), String(errMsg));
  check('errors are banners, not toasts', (await popup.$('.toast-error')) === null);
  check('unsaved C: unsaved banner still shown after the refusal', !!(await popup.$('.banner-accent')));
  await sleep(3200);
  check('error banner stays until closed (success toasts would be gone by now)', !!(await errorBanner(popup)));
  await popup.click('.banner-error button[aria-label="Close"]');
  check('error banner: Close button removes it', (await popup.$('.banner-error')) === null);
  const refused = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'loginAnother', siteId: 'claude' }));
  await sleep(500);
  check('unsaved C: login-another refused, C kept', refused?.ok === false && (await jarKey()) === 'sk-C', JSON.stringify(refused));

  // ---- 9. Manual login as a SAVED account while state says another is active ----
  await site.goto('https://claude.ai/login-as/A');
  popup = await openPopup();
  check('reconcile: manual login as saved A is marked Active on open, no click needed',
    (await popup.evaluate((id) => document.querySelector(`[data-account-id="${id}"]`)?.classList.contains('active'), a.id)) &&
      (await state()).active.claude === a.id && !(await popup.$('.banner-accent')), String((await state()).active.claude));
  check('reconcile: badge follows the manual login (A "93%")', (await waitBadge('93%')).text === '93%');
  await popup.click(mainOf(b.id));
  await sleep(1500);
  s = await state();
  const storedB = s.accounts.find((x) => x.id === b.id);
  check('manual A login then switch to B: B cookies not overwritten by A', storedB.cookies.find((c) => c.name === 'sessionKey').value === 'sk-B' && (await jarKey()) === 'sk-B');

  // ---- 10. Rename + remove through the ⋯ menu ----
  await popup.close();
  popup = await openPopup();
  await popup.click(moreOf(a.id));
  await popup.waitForSelector('.menu');
  const items = await popup.$$eval('.menu [role="menuitem"]', (els) => els.map((e) => e.textContent.trim()));
  check('menu: ⋯ opens Rename + Remove', items.join() === 'Rename,Remove', items.join());
  await popup.keyboard.press('Escape');
  check('menu: Escape closes it', (await popup.$('.menu')) === null);
  await menuItem(popup, a.id, 'Rename');
  await popup.waitForSelector('.label-input');
  check('rename: inline input shown with current label focused', (await popup.$eval('.label-input', (e) => e.value)) === 'a@example.com' && (await popup.evaluate(() => document.activeElement?.classList.contains('label-input'))));
  await popup.keyboard.type('Work');
  await popup.keyboard.press('Enter');
  await sleep(700);
  s = await state();
  check('rename A -> Work', s.accounts.find((x) => x.id === a.id)?.label === 'Work');
  // A is near its limit, so its sub-line shows the reset hint in place of the email.
  check('rename: success toast + row shows the new label (reset hint replaces the email in the sub-line)', (await toastText(popup, 'success')) === 'Renamed' &&
    (await popup.$eval(`[data-account-id="${a.id}"] .label`, (e) => e.textContent)) === 'Work' && (await popup.$(`[data-account-id="${a.id}"] .sub-line .reset-hint`)) !== null);
  check('rename: Enter did not switch accounts', (await jarKey()) === 'sk-B');
  await menuItem(popup, a.id, 'Remove');
  await popup.waitForSelector('.confirm');
  check('remove: inline confirmation asks first', await has(popup, 'Remove Work? It only forgets it here.'));
  await clickText(popup, 'Cancel', '//div[contains(concat(" ",@class," ")," confirm ")]');
  await sleep(300);
  check('remove: Cancel keeps the account', (await popup.$('.confirm')) === null && (await state()).accounts.some((x) => x.id === a.id));
  await menuItem(popup, a.id, 'Remove');
  await popup.waitForSelector('.confirm');
  await popup.click('.confirm .btn-danger');
  await sleep(800);
  s = await state();
  check('remove A: gone from storage + usage', !s.accounts.some((x) => x.id === a.id) && !s.usage[a.id]);
  check('remove A: success toast', (await toastText(popup, 'success')).includes('Removed Work'), await toastText(popup, 'success'));
  check('remove A: browser cookies untouched', (await jarKey()) === 'sk-B');
  await popup.screenshot({ path: OUT + '5-popup-final.png' });

  // ---- 11. cswap-style rotation. Now: only B saved, B live. ----
  check('rotation: no "Switch to next" with one account', (await popup.$('[data-fk="next"]')) === null);
  const saveAs = async (who) => {
    let p = await openPopup();
    await addClaude(p);
    await sleep(1000);
    await site.goto(`https://claude.ai/login-as/${who}`);
    p = await openPopup();
    await saveUnsaved(p);
    return p;
  };
  await saveAs('A');
  popup = await saveAs('C'); // order: B, A, C, active C
  await popup.click('button[aria-label="Refresh usage"]');
  await sleep(2500);
  s = await state();
  check('rotation: order B, A, C with fresh usage', s.accounts.map((x) => x.identity.email[0]).join('') === 'bac' && s.accounts.every((x) => s.usage[x.id]?.usage), s.accounts.map((x) => x.identity.email).join());
  const setStrategy = async (value) => {
    const o = await openOptions();
    await o.click(`#rotationStrategy [data-value="${value}"]`);
    await sleep(700);
    const keys = await o.$$eval('#shortcutKeys .kbd', (els) => els.map((e) => e.textContent).join('+'));
    await o.close();
    return keys;
  };
  const next = async ({ wantToast = false } = {}) => {
    const p = await openPopup();
    await p.click('[data-fk="next"]');
    let toast = '';
    if (wantToast) {
      await p.waitForSelector('.toast-success', { timeout: 4000 }).catch(() => {});
      toast = await toastText(p, 'success');
    }
    await sleep(1500);
    await p.close();
    return wantToast ? [await jarKey(), toast] : jarKey();
  };
  // default 'best': from C -> A is at 93% (unavailable), B has 10/20 -> B
  const [afterBest, switchToast] = await next({ wantToast: true });
  check('rotation best: C -> B (A is near limit)', (await state()).settings.rotationStrategy === 'best' && afterBest === 'sk-B');
  check('switch toast: "Switched to b@example.com" after Switch to next', switchToast === 'Switched to b@example.com', switchToast);
  const sc = await setStrategy('next');
  check('options shows the shortcut as keycaps', /Alt\+Shift\+S|⌥\+⇧\+S/.test(sc), sc);
  check('options: strategy change auto-saved', (await state()).settings.rotationStrategy === 'next');
  check('rotation next: B -> A (plain order, ignores limit)', (await next()) === 'sk-A');
  check('rotation next: A -> C', (await next()) === 'sk-C');
  check('rotation next: C -> B (wraps)', (await next()) === 'sk-B');
  await setStrategy('next-available');
  check('rotation next-available: B -> C (skips A at 93%)', (await next()) === 'sk-C');
  check('rotation next-available: C -> B (wraps, skips A)', (await next()) === 'sk-B');
  check('rotation: claude tab follows the switch', (await site.evaluate(() => document.body.innerText)).includes('b@example.com'));
  s = await state();
  check('rotation: active matches jar', s.accounts.find((x) => x.id === s.active.claude)?.identity.email === 'b@example.com');
  check('badge: follows the rotation ("20%")', (await waitBadge('20%')).text === '20%');
  popup = await openPopup();
  await popup.screenshot({ path: OUT + '6-popup-rotation.png' });
  check('popup footer shows strategy', await has(popup, 'Next: Next available'), await text(popup));

  // ---- 12. Welcome page: still exactly one tab from the install ----
  check('welcome: opened exactly once during the whole run', (await welcomePages()).length === 1, String((await welcomePages()).length));

  if (process.env.DOCS) {
    // Realistic labels: B active with light usage, A near its limit, C fresh.
    const byMail = (m) => s.accounts.find((x) => x.identity.email === m).id;
    const cfg = await openOptions();
    await cfg.evaluate(
      async (renames) => {
        for (const r of renames) await chrome.runtime.sendMessage({ type: 'rename', ...r });
        await chrome.runtime.sendMessage({
          type: 'updateSettings',
          patch: { pollMinutes: 5, threshold: 90, autoSwitchMode: 'notify', cooldownMinutes: 10, rotationStrategy: 'best' },
        });
      },
      [
        { accountId: byMail('b@example.com'), label: 'Work' },
        { accountId: byMail('a@example.com'), label: 'Personal' },
        { accountId: byMail('c@example.com'), label: 'Side project' },
      ],
    );
    await cfg.close();
    await popup.click('button[aria-label="Refresh usage"]');
    await sleep(2500);
    await popup.close();
    await shoot(browser, extId, 'popup', { scheme: 'light', width: 360, file: 'popup-light.png' });
    await shoot(browser, extId, 'popup', { scheme: 'dark', width: 360, file: 'popup-dark.png' });
    await shoot(browser, extId, 'options', { width: 1000, file: 'settings.png', full: true, wait: 1500 });
    await shoot(browser, extId, 'welcome', { width: 1000, file: 'welcome.png', full: true, wait: 1000 });
  }

  check('no page errors in popup/options', pageErrors.length === 0, pageErrors.join(' / '));
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
