// Real Notes/Settings sharing in headless Chrome, with an Ultra fixture and the local relay only.
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/share-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { relay, diskStore } = require('../server/relay.js');
const G = require('../defaults.js');
const ext = fs.realpathSync(path.join(__dirname, '..'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const site = 'https://bb.school.test';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await pause(100); }
  return false;
};
const failures = [];
let checks = 0;
const check = (ok, name, detail = '') => {
  checks++; console.log(`${ok ? 'ok' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures.push(name);
};
// Deliberately use Page.mouse, including cross-origin frame controls. No DOM-generated action clicks.
const click = async (page, locator, dwell = 750) => {
  await locator.waitFor({ state: 'visible' });
  // Center controls so the Settings sticky header cannot intercept the mouse click.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  if (dwell) await pause(dwell); // the embedded control must have a stable, visible box before consent
  const r = await locator.boundingBox();
  if (!r) throw Error('control has no box');
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-share-check-'));
  const out = process.argv[2];
  let ctx, server;
  const errors = [];
  try {
    server = relay({ db: path.join(tmp, 'relay.db'), store: diskStore(path.join(tmp, 'blobs')) });
    const address = await server.listen(0, '127.0.0.1');
    const relayURL = `http://127.0.0.1:${address.port}`;
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
    });
    ctx.setDefaultTimeout(10000);
    const html = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-course.html'), 'utf8');
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:' || u.origin === relayURL) return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ json: { id: '_42_1' } });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ json: { results: [] } });
      if (u.origin === 'https://cdn.school.test') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(sw.url()).host}`;
    const settings = await ctx.newPage(); settings.on('pageerror', (e) => errors.push(String(e)));
    settings.on('dialog', (d) => d.accept());
    await settings.goto(`${base}/options.html#sharing/sessions`);
    const look = G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, G.GZ_LOOKS.find((l) => l.name === 'Aurora Night'));
    await settings.evaluate(async ({ patch, relayURL }) => {
      await chrome.storage.sync.set({ ...patch, enhance: { ...patch.enhance, notes: true }, shareRelay: relayURL });
    }, { patch: { ...G.GZ_DEFAULTS, ...look }, relayURL });
    await settings.reload();
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-bg'));
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#gz-cmd input').fill('Notes');
    await click(page, page.locator('#gz-cmd-list li').filter({ hasText: /^NotesGlaze/ }).first());
    await click(page, page.locator('#gz-nt .gz-nt-head button').filter({ hasText: /^New note$/ }));
    await page.locator('#gz-nt .gz-nt-ed input').first().fill('Share check note');
    await page.locator('#gz-nt [contenteditable="true"]').fill('Local relay browser check');
    await click(page, page.locator('#gz-nt .gz-nt-ed button').filter({ hasText: /^Share$/ }));
    await until(() => Promise.resolve(page.frames().some((f) => f.url() === `${base}/sharing/quick.html`)));
    const quick = page.frames().find((f) => f.url() === `${base}/sharing/quick.html`);
    if (!quick) throw Error('share frame did not open');
    await quick.locator('#who').waitFor({ state: 'visible' });
    await quick.evaluate(() => document.querySelector('#share').click());
    check(!await quick.locator('#note-shared').isVisible(), 'synthetic clicks cannot share');
    await click(page, quick.locator('#share'), 0);
    await pause(100);
    check(await quick.locator('#note-shared').isVisible() || /wait|visible|covered|Settings/i.test(await quick.locator('#status').textContent()), 'an early real click acts or explains why it was refused');
    const height = await page.locator('.gz-nt-share-frame').evaluate((el) => el.getBoundingClientRect().height);
    console.log(`Notes frame height: ${height}px`);
    check(height >= 200, 'Notes share frame retains its height', `${height}px`);
    const palette = await quick.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-ink').trim());
    check(palette === look.colors['--gz-ink'], 'quick panel wears the selected Look palette', palette);
    if (!await quick.locator('#note-shared').isVisible()) {
      // An ancestor filter makes IOv2 refuse consent even though Chrome delivers a real mouse click.
      // This intentionally adverse school-page style must fail closed and offer a way to recover.
      await page.locator('#gz-nt').evaluate((el) => { el.style.filter = 'brightness(1)'; });
      await pause(250);
      await click(page, quick.locator('#share'));
      check(!await quick.locator('#note-shared').isVisible(), 'a filtered ancestor cannot borrow a share click');
      check(/visible|covered|Settings/i.test(await quick.locator('#status').textContent()), 'refused visibility check explains how to recover');
      const pagesBefore = new Set(ctx.pages());
      await click(page, quick.locator('#settings'));
      const recovered = await until(() => Promise.resolve(ctx.pages().some((p) => !pagesBefore.has(p) && p.url() === `${base}/options.html#sharing/sessions`)), 2000);
      check(recovered, 'refused embedded clicks can still open trusted Settings by mouse');
      for (const p of ctx.pages()) if (!pagesBefore.has(p)) await p.close();
      await page.bringToFront();
      await page.locator('#gz-nt').evaluate((el) => { el.style.removeProperty('filter'); });
      await click(page, quick.locator('#share'));
    }
    const shared = await until(() => quick.locator('#note-shared').isVisible(), 4000);
    check(shared, 'real mouse click shares a note from the themed Notes dialog', await quick.locator('#status').textContent());
    const quickFill = await quick.locator('#name').evaluate((el) => getComputedStyle(el).backgroundColor);
    const notesFill = await page.locator('#gz-nt input[type="search"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    check(quickFill === notesFill, 'quick inputs use the same Look surface as Notes', `${quickFill} / ${notesFill}`);
    check(await quick.locator('#name').evaluate((el) => getComputedStyle(el).fontFamily) === await page.locator('#gz-nt input[type="search"]').evaluate((el) => getComputedStyle(el).fontFamily), 'quick inputs use the Notes Look font stack');
    check(await page.evaluate(() => document.querySelector('.gz-nt-share-frame').shadowRoot === null && !document.querySelector('.gz-nt-share iframe')), 'share frame stays in a closed shadow root');
    for (const size of [{ width: 375, height: 660 }, { width: 1280, height: 400 }]) {
      await page.setViewportSize(size); await pause(900);
      const h = await page.locator('.gz-nt-share-frame').evaluate((el) => el.getBoundingClientRect().height);
      console.log(`Notes frame ${size.width}x${size.height}: ${h}px`);
      check(h >= Math.min(200, size.height * .4), `share frame stays usable at ${size.width}x${size.height}`, `${h}px`);
    }
    await page.setViewportSize({ width: 1280, height: 860 }); await pause(900);
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'notes-share.png') }); }

    await settings.bringToFront();
    const freshSources = await until(() => settings.locator('#ss-sources input').count(), 2000);
    check(freshSources, 'an already open Settings tab refreshes newly written Notes sources');
    if (!freshSources) await settings.reload();
    await settings.locator('#ss-sources input').first().waitFor();
    await settings.locator('#ss-title').fill('Settings share check');
    await click(settings, settings.locator('#ss-sources input').last());
    await click(settings, settings.locator('#ss-create'));
    const created = await until(() => settings.locator('.ss-session h4').filter({ hasText: 'Settings share check' }).count());
    check(created, 'Settings creates an encrypted note session by mouse', await settings.locator('#ss-status').textContent());
    if (created) {
      const session = settings.locator('.ss-session').filter({ hasText: 'Settings share check' });
      check(await session.evaluate((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(el).color === getComputedStyle(document.body).color && parseFloat(getComputedStyle(el).borderRadius) > 0), 'Settings session cards use the Look surface, ink and shape');
      await click(settings, session.getByRole('button', { name: 'Read local session' }));
      check(await until(() => session.locator('.ss-read').count()), 'Settings can read its shared local note');
      // Invite material is read only in an extension-owned top frame, never in the school page.
      const link = await settings.evaluate(async () => {
        const s = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'list' });
        return (await chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'link', sid: s.sessions.find((x) => x.title === 'Settings share check').sid, edit: true })).link;
      });
      await click(settings, session.getByRole('button', { name: 'Leave this device' }));
      await until(async () => !await settings.locator('.ss-session h4').filter({ hasText: 'Settings share check' }).count());
      await settings.locator('#ss-invite').fill(link);
      await click(settings, settings.locator('#ss-join'));
      check(await until(() => settings.locator('.ss-session h4').filter({ hasText: 'Settings share check' }).count()), 'Settings joins an invite through the local relay by mouse', await settings.locator('#ss-status').textContent());
      const joined = settings.locator('.ss-session').filter({ hasText: 'Settings share check' });
      await click(settings, joined.getByRole('button', { name: 'Copy into Notes' }));
      check(await until(async () => !await joined.getByRole('button', { name: 'Copy into Notes' }).count()), 'joined session attaches to Notes');
    }
    const quickLink = await settings.evaluate(async () => {
      const s = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'list' });
      return (await chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'link', sid: s.sessions.find((x) => x.title === 'Share check note').sid, edit: true })).link;
    });
    await click(settings, settings.locator('.ss-session').filter({ has: settings.locator('h4').filter({ hasText: /^Share check note$/ }) }).getByRole('button', { name: 'Leave this device' }));
    await page.bringToFront();
    await quick.locator('#invite').fill(quickLink);
    await click(page, quick.locator('#join'));
    await click(page, quick.locator('#ask-yes'));
    check(await until(async () => /Joined\./.test(await quick.locator('#status').textContent())), 'quick panel joins and attaches a note through the local relay by mouse', await quick.locator('#status').textContent());
    for (const name of ['Library', 'Terminal']) {
      const patch = G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, G.GZ_LOOKS.find((l) => l.name === name));
      await settings.evaluate((patch) => chrome.storage.sync.set(patch), patch);
      check(await until(() => quick.evaluate((ink) => document.documentElement.style.getPropertyValue('--gz-ink') === ink, patch.colors['--gz-ink'])), `quick panel follows a live Look change to ${name}`);
      const pagesBefore = new Set(ctx.pages());
      await click(page, quick.locator('#settings'));
      const ready = await until(() => Promise.resolve(ctx.pages().some((p) => !pagesBefore.has(p) && p.url() === `${base}/options.html#sharing/sessions`)), 2000);
      const opened = ctx.pages().find((p) => !pagesBefore.has(p));
      check(ready, `Settings navigation works with ${name}`);
      await opened?.close(); await page.bringToFront();
    }
    if (out) await settings.screenshot({ path: path.join(out, 'settings-share.png') });
    check(errors.length === 0, 'no page script errors', errors.join('\n'));
  } finally {
    await ctx?.close(); await server?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`cleanup: browser closed, relay closed, profile removed (${!fs.existsSync(tmp)})`);
  }
  console.log(`${checks - failures.length}/${checks} sharing browser checks passed`);
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(String(e).replace(/https?:\/\/[^\s"']+\/j#1\.[er]\.[\w-]+/g, '[invite]')); process.exitCode = 1; });
