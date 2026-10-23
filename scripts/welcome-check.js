// Glaze's first screen (features/welcome.html) through each of its states, in headless Chrome with the real unpacked
// extension. The browser's permission prompt can't be answered headless, so chrome.permissions is the check's: it decides
// what is held and answers each request when the check says. Screenshots of every state, wide and narrow, go to the
// evidence directory.
// NODE_PATH=<installed playwright> node scripts/welcome-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-welcome-'));
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };

// Runs before the page's own scripts: what is held (the built-in hosts, and whatever the check grants), each request
// parked until the check answers it, and every message the page sends the worker.
const stub = () => {
  const held = new Set(['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*']);
  const covers = (o) => held.has('https://*/*') && o.startsWith('https://') || [...held].some((p) => p === o || (p.startsWith('https://*.') && (o.startsWith('https://') && new URL(o.replace('/*', '/')).hostname.endsWith(p.slice(10, -2)))));
  const added = new Set(), removed = new Set();
  globalThis.__gz = { held, asked: [], sent: [], answer: null };
  chrome.permissions.contains = async ({ origins = [] }) => origins.every(covers);
  chrome.permissions.request = ({ origins = [] }) => new Promise((resolve) => {
    if (!navigator.userActivation.isActive) throw new Error('This function must be called during a user gesture');
    __gz.asked.push(origins);
    __gz.answer = (ok) => { if (ok) { origins.forEach((o) => held.add(o)); added.forEach((f) => f({ origins })); } resolve(ok); };
  });
  chrome.permissions.onAdded = { addListener: (f) => added.add(f) };
  chrome.permissions.onRemoved = { addListener: (f) => removed.add(f) };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...rest) => { __gz.sent.push(m); return m?.type === 'glaze:allow' ? Promise.resolve() : send(m, ...rest); };
};

(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.addInitScript(stub);
    const url = `chrome-extension://${id}/features/welcome.html`;
    const open = async (viewport, motion = 'no-preference') => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto(url);
      await page.waitForFunction(() => document.querySelector('#terrain.live'), null, { timeout: 15000 }).catch(() => {});
      await pause(1200);
      return page;
    };
    const state = (page) => page.evaluate(() => ({
      act: document.querySelector('#go').dataset.act, label: document.querySelector('#go .label').textContent, bar: document.querySelector('.bar').dataset.state || '',
      disabled: document.querySelector('#go').getAttribute('aria-disabled'), error: !document.querySelector('#error').hidden, readOnly: document.querySelector('#address').readOnly,
      focus: document.activeElement?.id, all: document.querySelector('#all').getAttribute('aria-pressed'), another: !document.querySelector('#another').hidden,
      said: document.querySelector('#said').textContent, busy: document.querySelector('#go').hasAttribute('data-busy'),
    }));
    const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const type = async (page, text) => { await page.fill('#address', ''); await page.type('#address', text, { delay: 25 }); await pause(250); };

    for (const [w, viewport] of [['wide', { width: 1440, height: 900 }], ['narrow', { width: 390, height: 844 }]]) {
      const page = await open(viewport);
      let s = await state(page);
      check(s.focus === 'address' && s.act === 'none' && s.disabled === 'true' && s.label === 'Allow', `${w}: the field has focus and Allow waits for an address`);
      check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() === '#27cdf1'), `${w}: it wears the Frostdev palette`);
      check(await page.evaluate(() => document.querySelector('#terrain').classList.contains('live')), `${w}: the terrain draws`);
      await shot(page, `${w}-1-idle`);

      await page.fill('#address', '');
      await page.evaluate(() => { const i = document.querySelector('#address'); i.value = 'https://BB.School.EDU/ultra/course?x=1'; i.dispatchEvent(new ClipboardEvent('paste', { bubbles: true })); });
      await pause(250);
      s = await state(page);
      check(s.act === 'allow' && s.disabled === 'false' && s.label === 'Allow', `${w}: a pasted school page asks to Allow`);
      check(await page.inputValue('#address') === 'bb.school.edu', `${w}: and shows as the site Glaze will ask for`);
      await shot(page, `${w}-2-typed`);

      await type(page, 'school.instructure.com');
      s = await state(page);
      check(s.act === 'open' && s.bar === 'ready' && s.label === 'Open', `${w}: a built-in host can be opened straight away`);
      await shot(page, `${w}-3-builtin`);

      await type(page, 'not a site');
      await page.keyboard.press('Enter');
      await pause(400);
      s = await state(page);
      check(s.error && s.bar === 'bad' && (await page.evaluate(() => globalThis.__gz.asked.length)) === 0, `${w}: what isn't an address is refused, with nothing asked`);
      await shot(page, `${w}-4-invalid`);
      await page.keyboard.press('Backspace');
      check(!(await state(page)).error, `${w}: the error goes with the next key`);

      await type(page, 'bb.school.edu');
      await page.click('#go');
      await pause(300);
      s = await state(page);
      check(s.busy && s.readOnly, `${w}: while the browser asks, the button spins and the field holds`);
      check(JSON.stringify(await page.evaluate(() => globalThis.__gz.asked.at(-1))) === '["https://bb.school.edu/*"]', `${w}: it asks for exactly that host`);
      await shot(page, `${w}-5-asking`);
      await page.evaluate(() => globalThis.__gz.answer(false));
      await pause(300);
      s = await state(page);
      check(!s.busy && !s.readOnly && s.act === 'allow' && !s.said, `${w}: refused, it is as it was, with nothing said`);

      await page.click('#go');
      await pause(200);
      await page.evaluate(() => globalThis.__gz.answer(true));
      await pause(450);
      s = await state(page);
      check(s.bar === 'done' && s.act === 'open' && s.focus === 'go' && s.another && s.said === 'Allowed bb.school.edu', `${w}: granted, the bar settles and Open has focus`);
      check(JSON.stringify(await page.evaluate(() => globalThis.__gz.sent.at(-1))) === '{"type":"glaze:allow","origin":"https://bb.school.edu"}', `${w}: the worker hears which site`);
      await shot(page, `${w}-6-granted`);
      await pause(900);
      await shot(page, `${w}-6b-granted-settled`);

      await page.click('#another');
      await pause(300);
      s = await state(page);
      check(s.focus === 'address' && s.act === 'none' && !s.another, `${w}: Another school starts over`);

      await page.click('#all');
      await pause(200);
      check(JSON.stringify(await page.evaluate(() => globalThis.__gz.asked.at(-1))) === '["https://*/*"]', `${w}: All sites asks for every https site`);
      await page.evaluate(() => globalThis.__gz.answer(true));
      await pause(400);
      s = await state(page);
      check(s.all === 'true' && s.said === 'All sites allowed', `${w}: All sites held shows as held`);
      await type(page, 'moodle.school.edu');
      check((await state(page)).act === 'open', `${w}: with all sites held, any school opens`);
      await shot(page, `${w}-7-all-sites`);
      await page.close();
    }

    const calm = await open({ width: 1440, height: 900 }, 'reduce');
    check(await calm.evaluate(() => document.documentElement.getAttribute('data-gz-motion') === 'off'), 'reduced motion: the Look\'s motion is off');
    const ph = await calm.evaluate(() => document.querySelector('#address').placeholder);
    await pause(3200);
    check(ph === await calm.evaluate(() => document.querySelector('#address').placeholder), 'reduced motion: the examples hold still');
    await shot(calm, 'wide-8-reduced-motion');
    await calm.close();

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
