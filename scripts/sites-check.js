// Settings → Backup and privacy → Sites (options.html), headless, with the real unpacked extension and its real worker:
// adding a school's site the first screen's way (allowed, checked, listed with its LMS; or turned down, its grant handed
// back, with the course sites nearby), Remove handing the grant back unless the manifest requires the host, and embedded
// Settings (a frame in a school's page) keeping Sites in a tab of its own. The browser's prompt has no answer headless, so
// the page's chrome.permissions is the check's: what is held, each request parked until the check answers it, and what
// is handed back. The schools stand in the staged copy's host_permissions (the student's grant) so the worker's own check
// reaches them; the page still sees the product's required hosts. canvas.school.edu answers as Canvas, bb.school.edu as
// Blackboard, www.school.edu is a school's main website linking to it, and bb.nowhere.edu doesn't exist.
// NODE_PATH=<installed playwright> nice node scripts/sites-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const BB = 'https://bb.school.edu', CANVAS = 'https://canvas.school.edu', WWW = 'https://www.school.edu';
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), [`${BB}/*`, `${CANVAS}/*`, `${WWW}/*`]);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sites-'));
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(100); }
  return false;
};
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
const OPTIONS = `chrome-extension://${id}/options.html`;

// Settings' own tab only: the product's required hosts (the check can add one), what is held, each request parked, what is
// handed back, and every message to the worker (passed on).
const stub = (required) => {
  if (location.pathname !== '/options.html' || window.top !== window) return;
  const manifest = chrome.runtime.getManifest.bind(chrome.runtime);
  globalThis.__gz = { required, held: new Set(required), asked: [], removed: [], sent: [], answer: null };
  chrome.runtime.getManifest = () => ({ ...manifest(), host_permissions: __gz.required });
  chrome.permissions.getAll = async () => ({ permissions: [], origins: [...__gz.held] });
  chrome.permissions.request = ({ origins = [] }) => new Promise((resolve) => {
    if (!navigator.userActivation.isActive) throw new Error('This function must be called during a user gesture');
    __gz.asked.push(origins);
    __gz.answer = (ok) => { __gz.answer = null; if (ok) origins.forEach((o) => __gz.held.add(o)); resolve(ok); };
  });
  chrome.permissions.remove = async ({ origins = [] }) => { __gz.removed.push(origins); origins.forEach((o) => __gz.held.delete(o)); return true; };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...rest) => { if (m?.type === 'glaze:allow' || m?.type === 'glaze:sites') __gz.sent.push(m); return send(m, ...rest); };
};

(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    require('./check-env.js').noFirstRun(ctx);
    await ctx.addInitScript(stub, require('../manifest.json').host_permissions);
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === BB && u.pathname === '/learn/api/public/v1/system/version') return route.fulfill({ contentType: 'application/json', body: '{"learn":{"major":4001,"minor":2,"patch":0}}' });
      if (u.origin === CANVAS && u.pathname === '/api/v1/users/self') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthenticated","errors":[{"message":"user authorization required"}]}' });
      if (u.origin === WWW && u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>School</title><a href="https://bb.school.edu/">Blackboard</a> <a href="https://apply.school.edu/">Apply</a>' });
      if (u.origin === WWW && u.pathname === '/settings') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>School</title><iframe src="${OPTIONS}#backup/sites" style="width:1100px;height:760px;border:0"></iframe>` });
      if ([BB, CANVAS, WWW].includes(u.origin)) return route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' });
      return route.abort();
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    const local = () => sw.evaluate(() => chrome.storage.local.get(['canvas', 'moodle', 'ultra']));

    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && !m.location().url.startsWith('chrome-extension:'))) errors.push(m.text()); });
    await page.goto(`${OPTIONS}#backup/sites`);
    await page.waitForSelector('#site-add', { state: 'visible', timeout: 15000 });
    await pause(800);
    const state = () => page.evaluate(() => ({
      note: !document.querySelector('#site-note').hidden, error: document.querySelector('#site-error').textContent,
      picks: [...document.querySelectorAll('#site-picks button')].map((b) => b.textContent), status: document.querySelector('#site-status').textContent,
      value: document.querySelector('#site-address').value, readOnly: document.querySelector('#site-address').readOnly,
      busy: document.querySelector('#site-allow').getAttribute('aria-busy'), focus: document.activeElement?.id || document.activeElement?.textContent,
      rows: [...document.querySelectorAll('#site-list li')].map((li) => [li.querySelector('.name > span').textContent, li.querySelector('.name small').textContent]),
    }));
    const gz = (fn, arg) => page.evaluate(fn, arg);
    const shot = (name) => page.locator('#sites').screenshot({ path: path.join(out, `${name}.png`) });
    const type = async (text) => { await page.fill('#site-address', ''); await page.type('#site-address', text, { delay: 15 }); };

    let s = await state();
    check(!s.note && s.rows.length === 0 && s.value === '', 'Sites opens with the address field above an empty list');
    await shot('settings-1-idle');

    await type('not a site');
    await page.keyboard.press('Enter');
    await pause(200);
    s = await state();
    check(s.note && s.error === 'Not a web address' && (await gz(() => __gz.asked.length)) === 0, 'what isn\'t an address is refused, with nothing asked');
    await shot('settings-2-invalid');
    await page.keyboard.press('Backspace');
    check(!(await state()).note, 'the error goes with the next key');

    await type('https://canvas.school.edu/courses/12?x=1');
    await page.click('#site-allow');
    await pause(200);
    s = await state();
    check(s.readOnly && s.busy === 'true', 'while the browser asks, the field holds and the button waits');
    check(JSON.stringify(await gz(() => __gz.asked.at(-1))) === `["${CANVAS}/*"]`, 'it asks for exactly that host');
    check(JSON.stringify(await gz(() => __gz.sent.at(-1))) === JSON.stringify({ type: 'glaze:allow', op: 'ask', origin: CANVAS }), 'after telling the worker');
    await shot('settings-3-asking');
    await gz(() => __gz.answer(false));
    await pause(300);
    s = await state();
    check(!s.readOnly && !s.busy && !s.note && !s.status && s.value === 'https://canvas.school.edu/courses/12?x=1', 'refused, it is as it was, with nothing said');

    await page.click('#site-allow');
    await pause(200);
    await gz(() => __gz.answer(true));
    check(await until(async () => (await state()).rows.some(([h]) => h === 'canvas.school.edu'), 15000), 'granted and checked, the site is listed');
    s = await state();
    check(JSON.stringify(s.rows) === '[["canvas.school.edu","Canvas"]]' && s.status === 'Allowed canvas.school.edu' && s.value === '' && s.focus === 'site-address', `with its LMS named, and the field ready for another (${JSON.stringify(s)})`);
    check((await local()).canvas?.includes(`${CANVAS}/*`), 'the worker checked it again and approved it');
    check(await until(async () => (await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id))).includes(`${CANVAS}/*`)), 'and registered it');
    check(JSON.stringify((await gz(() => __gz.sent)).filter((m) => m.type === 'glaze:allow').map((m) => m.op)) === '["ask","cancel","ask","yes"]', 'the worker heard ask, cancel (refused), ask, yes');
    check(JSON.stringify(await gz(() => __gz.removed)) === '[]', 'nothing handed back');
    await shot('settings-4-added');

    await type('www.school.edu');
    await page.click('#site-allow');
    await pause(200);
    await gz(() => __gz.answer(true));
    check(await until(async () => (await state()).note, 15000), 'a school\'s main website is turned down');
    s = await state();
    check(s.error === 'No course site at www.school.edu' && JSON.stringify(s.picks) === '["bb.school.edu","canvas.school.edu"]', `as no course site, with the one it links to first, then a course-site name on its domain (${JSON.stringify(s)})`);
    check(JSON.stringify(await gz(() => __gz.removed.at(-1))) === `["${WWW}/*"]`, 'its grant handed back');
    check(s.focus === 'bb.school.edu', 'the pick has focus');
    await shot('settings-5-no-course-site');
    await page.click('#site-picks button');
    await pause(200);
    check(JSON.stringify(await gz(() => __gz.asked.at(-1))) === `["${BB}/*"]`, 'picking it asks for that site');
    await gz(() => __gz.answer(true));
    check(await until(async () => (await state()).rows.some(([h]) => h === 'bb.school.edu'), 15000), 'and it is listed');
    s = await state();
    check(JSON.stringify(s.rows) === '[["bb.school.edu","Blackboard Ultra"],["canvas.school.edu","Canvas"]]' && !s.note, `as Blackboard Ultra (${JSON.stringify(s.rows)})`);
    await shot('settings-6-picked');

    await type('bb.nowhere.edu');
    await page.keyboard.press('Enter');
    await pause(200);
    await gz(() => __gz.answer(true));
    check(await until(async () => (await state()).note, 15000), 'a site that doesn\'t answer is turned down');
    s = await state();
    check(s.error === "Can't reach bb.nowhere.edu" && JSON.stringify(await gz(() => __gz.removed.at(-1))) === '["https://bb.nowhere.edu/*"]', 'as unreachable, its grant handed back');
    await shot('settings-7-unreachable');
    await page.fill('#site-address', '');

    // Remove: the worker forgets it, then the grant goes back; a host the manifest requires keeps its grant.
    const removeRow = (host) => page.click(`#site-list li:has(.name > span:text-is("${host}")) button`);
    const before = (await gz(() => __gz.removed)).length;
    await removeRow('canvas.school.edu');
    check(await until(async () => !(await state()).rows.some(([h]) => h === 'canvas.school.edu')), 'Remove takes the site off the list');
    check(await until(async () => JSON.stringify(await gz(() => __gz.removed.at(-1))) === `["${CANVAS}/*"]`), 'and hands its grant back');
    check(!(await local()).canvas?.includes(`${CANVAS}/*`), 'the worker forgot it');
    check((await state()).status === 'Removed canvas.school.edu. Glaze no longer runs there.', 'and says so');
    await shot('settings-8-removed');
    await gz((p) => { __gz.required = [...__gz.required, p]; }, `${BB}/*`);
    await removeRow('bb.school.edu');
    check(await until(async () => (await state()).rows.length === 0), 'a site on a required host is removed from the list');
    await pause(400);
    const kept = await gz(() => __gz.removed);
    check(kept.length === before + 1 && JSON.stringify(kept.at(-1)) === `["${CANVAS}/*"]` && await gz((p) => __gz.held.has(p), `${BB}/*`), `and its grant stays (${JSON.stringify(kept)})`);

    // Embedded Settings: Sites sits in the Backup panel, which opens in a tab of its own.
    const school = await ctx.newPage();
    school.on('pageerror', (e) => errors.push(String(e)));
    await school.goto(`${WWW}/settings`);
    const frame = await until(async () => school.frames().find((f) => f.url().startsWith(OPTIONS)));
    await frame.waitForSelector('#site-add', { state: 'attached', timeout: 15000 });
    await pause(800);
    const framed = await frame.evaluate(() => ({ embedded: document.documentElement.hasAttribute('data-embedded'), form: document.querySelector('#site-add').getClientRects().length,
      gated: document.querySelector('[data-editor-panel="backup"]').hasAttribute('data-gated'), gate: !!document.querySelector('[data-editor-panel="backup"] .embed-gate') }));
    check(framed.embedded && framed.gated && framed.gate && framed.form === 0, `embedded Settings keeps Sites in its own tab (${JSON.stringify(framed)})`);
    await school.close();

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`${results.length} ok, screenshots in ${out}`);
  } catch (e) {
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(path.join(tmp, 'profile'), { recursive: true, force: true });
  }
})();
