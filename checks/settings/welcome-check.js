// Glaze's first screen (settings/welcome.html) through each of its states, in headless Chrome with the real unpacked
// extension: the setup wizard's steps (theme, motion, the feature slides, done), each choice read back from storage as the
// worker saved it, and the school step's. The browser's permission prompt can't be answered headless, so chrome.permissions is the check's: it decides
// what is held and answers each request when the check says. The schools are the check's too: bb.school.edu answers as
// Blackboard does, www.school.edu is a school's main website linking to it, and nothing else exists. Screenshots of every
// state, wide and narrow, go to the evidence directory.
// NODE_PATH=<installed playwright> node checks/settings/welcome-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
// The schools the check allows stand in the staged copy's host_permissions: the page's own requests to them need the real grant.
const ext = require('../../tools/dev/check-env.js').staged(process.env.EXT || path.join(__dirname, '../../extension'), ['https://bb.school.edu/*', 'https://www.school.edu/*', 'https://bb.nowhere.edu/*']);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-welcome-'));
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };

// Runs before the page's own scripts: what is held (the built-in hosts, and whatever the check grants), each request
// parked until the check answers it, and every message the page sends the worker.
const stub = (required) => {
  // Staged hosts stand in for optional grants; the page still sees the product's actual required hosts.
  const manifest = chrome.runtime.getManifest.bind(chrome.runtime);
  chrome.runtime.getManifest = () => ({ ...manifest(), host_permissions: required });
  const held = new Set(['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*']);
  const covers = (o) => held.has('https://*/*') && o.startsWith('https://') || [...held].some((p) => p === o || (p.startsWith('https://*.') && (o.startsWith('https://') && new URL(o.replace('/*', '/')).hostname.endsWith(p.slice(10, -2)))));
  const added = new Set(), removed = new Set();
  globalThis.__gz = { held, asked: [], sent: [], removed: [], answer: null };
  chrome.permissions.contains = async ({ origins = [] }) => origins.every(covers);
  chrome.permissions.getAll = async () => ({ origins: [...held] });
  chrome.permissions.request = ({ origins = [] }) => new Promise((resolve) => {
    if (!navigator.userActivation.isActive) throw new Error('This function must be called during a user gesture');
    __gz.asked.push(origins);
    __gz.answer = (ok) => { if (ok) { origins.forEach((o) => held.add(o)); added.forEach((f) => f({ origins })); } resolve(ok); };
  });
  chrome.permissions.remove = async ({ origins = [] }) => { __gz.removed.push(origins); origins.forEach((o) => held.delete(o)); removed.forEach((f) => f({ origins })); return true; };
  chrome.permissions.onAdded = { addListener: (f) => added.add(f) };
  chrome.permissions.onRemoved = { addListener: (f) => removed.add(f) };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...rest) => { __gz.sent.push(m); return m?.type === 'glaze:allow' ? Promise.resolve({ ok: true }) : send(m, ...rest); };
};

(async () => {
  let ctx;
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.addInitScript(stub, require('../../extension/manifest.json').host_permissions);
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.host === 'bb.school.edu' && u.pathname === '/learn/api/public/v1/system/version') return route.fulfill({ contentType: 'application/json', body: '{"learn":{"major":4001,"minor":2,"patch":0}}' });
      if (u.host === 'bb.school.edu') return route.fulfill({ status: 302, headers: { location: 'https://bb.school.edu/ultra' } });
      if (u.host === 'www.school.edu' && u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><a href="http://bb.school.edu/">Blackboard</a> <a href="https://apply.school.edu/">Apply</a>' });
      if (u.host === 'www.school.edu') return route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' });
      return route.abort();
    });
    const url = `chrome-extension://${id}/settings/welcome.html`;
    const open = async (viewport, motion = 'no-preference', hash = '#/school') => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(String(e)));
      // The check knocks on school sites that don't exist; the browser logs each miss. A file of Glaze's own that fails still counts.
      page.on('console', (m) => { if (m.type() === 'error' && !(m.text().startsWith('Failed to load resource') && !m.location().url.startsWith('chrome-extension:'))) errors.push(m.text()); });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto(url + hash);
      if (hash === '') await page.waitForFunction(() => document.querySelector('#terrain.live'), null, { timeout: 15000 }).catch(() => {});
      await pause(1200);
      return page;
    };
    const state = (page) => page.evaluate(() => ({
      act: document.querySelector('#go').dataset.act, label: document.querySelector('#go .label').textContent, bar: document.querySelector('.bar').dataset.state || '',
      disabled: document.querySelector('#go').getAttribute('aria-disabled'), error: !document.querySelector('#note').hidden, readOnly: document.querySelector('#address').readOnly,
      focus: document.activeElement?.id, all: document.querySelector('#all').getAttribute('aria-pressed'), another: !document.querySelector('#another').hidden,
      said: document.querySelector('#said').textContent, busy: document.querySelector('#go').hasAttribute('data-busy'),
    }));
    const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const type = async (page, text) => { await page.fill('#address', ''); await page.type('#address', text, { delay: 25 }); await pause(250); };

    // The wizard: what is shown, and what storage holds.
    const synced = (page, keys) => page.evaluate((k) => chrome.storage.sync.get(k), keys);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await pause(100); } };
    const step = (page) => page.evaluate(() => ({ step: document.documentElement.dataset.step, hash: location.hash, shown: [...document.querySelectorAll('.step')].filter((e) => !e.hidden).map((e) => e.id) }));
    const accent = (page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--gz-accent').trim());
    const checked = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.dataset.look || e.dataset.level || e.dataset.key), sel);
    const flip = (page, key) => page.click(`.switch[data-key="${key}"]`);
    const settle = () => pause(900);

    {
      const w = 'wide', page = await open({ width: 1440, height: 900 }, 'no-preference', '');
      let st = await step(page);
      check(st.step === 'start' && st.shown.join() === 'start', 'wizard: it opens on its splash');
      check(await accent(page) === '#27cdf1' && await page.evaluate(() => document.querySelector('#terrain').classList.contains('live')), 'wizard: the splash wears the Frostdev Look, its terrain drawn');
      check(await page.evaluate(() => document.activeElement?.id === 'begin'), 'wizard: Start has focus');
      await shot(page, `${w}-w1-start`);

      await page.click('#begin');
      await settle();
      st = await step(page);
      check(st.hash === '#/theme' && st.shown.join() === 'theme', 'wizard: Start goes to the theme');
      check(await page.evaluate(() => document.querySelectorAll('#looks .look').length) === 12, 'wizard: Glaze\'s own theme and the eleven Looks');
      check(JSON.stringify(await checked(page, '#looks .look')) === '["Frost"]' && await accent(page) === '#17c8f4', 'wizard: a fresh install wears Glaze\'s own theme, and the page wears it too');
      await shot(page, `${w}-w2-theme`);
      await page.click('.look[data-look="Synthwave"]');
      check(await until(async () => (await synced(page, 'colors')).colors?.['--gz-accent'] === '#f472b6'), 'wizard: a Look picked is saved');
      check(await until(async () => typeof (await synced(page, 'lookX')).lookX === 'string' && (await synced(page, 'lookX')).lookX !== ''), 'wizard: with its own parts');
      await settle();
      check(await accent(page) === '#f472b6' && await page.evaluate(() => document.querySelector('#terrain').classList.contains('live')), 'wizard: the page wears the Look picked, its scene drawn');
      await shot(page, `${w}-w3-theme-synthwave`);
      await page.click('.look[data-look="Library"]');
      await settle();
      check(await page.evaluate(() => document.documentElement.dataset.tone === 'light' && !document.querySelector('#terrain').classList.contains('live')), 'wizard: a light Look turns the page light, with no scene');
      await shot(page, `${w}-w4-theme-light`);
      await page.click('.look[data-look="Frostdev"]');
      check(await until(async () => (await synced(page, 'colors')).colors?.['--gz-accent'] === '#27cdf1'), 'wizard: the last Look picked is the one kept');
      await settle();
      // Arrow keys walk the cards and choose, as radios do.
      await page.keyboard.press('ArrowRight');
      await settle();
      check(JSON.stringify(await checked(page, '#looks .look')) === '["Aurora Night"]' && await page.evaluate(() => document.activeElement?.dataset.look === 'Aurora Night'), 'wizard: an arrow key moves to the next Look and wears it');
      await page.keyboard.press('ArrowLeft');
      check(await until(async () => (await synced(page, 'colors')).colors?.['--gz-accent'] === '#27cdf1'), 'wizard: and back');
      await settle();

      await page.click('#next');
      await settle();
      st = await step(page);
      check(st.hash === '#/motion' && JSON.stringify(await checked(page, '#levels .level')) === '["expressive"]', 'wizard: Next goes to motion, Expressive chosen');
      await shot(page, `${w}-w5-motion`);
      await page.click('.level[data-level="subtle"]');
      check(await until(async () => (await synced(page, 'motion')).motion?.level === 'subtle') && await page.evaluate(() => document.documentElement.dataset.gzMotion === 'subtle'), 'wizard: a motion level is saved and worn');
      await page.click('.level[data-level="off"]');
      check(await until(async () => (await synced(page, 'motion')).motion?.level === 'off') && await page.evaluate(() => document.documentElement.dataset.gzMotion === 'off'), 'wizard: Off holds the page still');
      await page.click('.level[data-level="expressive"]');
      check(await until(async () => (await synced(page, 'motion')).motion?.level === 'expressive'), 'wizard: and Expressive again');
      await flip(page, 'extras.pointerAnim');
      check(await until(async () => (await synced(page, 'extras')).extras?.pointerAnim === false), 'wizard: the pointer animation switch is saved');
      await flip(page, 'extras.pointerAnim');
      check(await until(async () => (await synced(page, 'extras')).extras?.pointerAnim === true), 'wizard: and back on');

      await page.click('#next');
      await settle();
      st = await step(page);
      check(st.hash === '#/nav' && st.shown.join() === 'nav', 'wizard: Next goes to navigation');
      await shot(page, `${w}-w6-nav`);
      await page.click('#next');
      await settle();
      st = await step(page);
      check(st.hash === '#/features/sidebar' && await page.evaluate(() => document.querySelectorAll('#chips .chip').length) === 9, 'wizard: features start at the sidebar, nine slides');
      const ids = ['sidebar', 'todo', 'notes', 'writer', 'search', 'grades', 'speed', 'buddy', 'reminders'];
      for (const id of ids) {
        if (id !== 'sidebar') {
          await page.click('#next');
          await settle();
        }
        check((await step(page)).hash === `#/features/${id}`, `wizard: Next walks to ${id}`);
        await shot(page, `${w}-w7-features-${id}`);
        if (id === 'notes') {
          check(JSON.stringify(await checked(page, '#feature-switches .switch')) === '["enhance.notes"]', 'wizard: a fresh install\'s notes are on');
          await flip(page, 'enhance.notes');
          check(await until(async () => (await synced(page, 'enhance')).enhance?.notes === false), 'wizard: notes turned off is saved');
        }
        if (id === 'search') {
          await flip(page, 'enhance.palette');
          check(await until(async () => (await synced(page, 'enhance')).enhance?.palette === false)
            && await page.evaluate(() => document.querySelector('.switch[data-key="enhance.search"]').getAttribute('aria-disabled') === 'true'), 'wizard: search waits on the command palette');
          await flip(page, 'enhance.palette');
          check(await until(async () => (await synced(page, 'enhance')).enhance?.palette === true), 'wizard: palette on again');
        }
        if (id === 'reminders') {
          check(JSON.stringify(await checked(page, '#feature-switches .switch')) === '[]', 'wizard: reminders stay off until chosen');
          await flip(page, 'enhance.remind');
          check(await until(async () => (await synced(page, 'enhance')).enhance?.remind === true), 'wizard: reminders turned on is saved');
        }
      }
      await page.click('#next');
      await settle();
      st = await step(page);
      check(st.hash === '#/ai' && st.shown.join() === 'ai', 'wizard: after the last feature, AI');
      await shot(page, `${w}-w8-ai`);
      await page.click('#back');
      await settle();
      check((await step(page)).hash === '#/features/reminders', 'wizard: Back from AI returns to the last feature');
      await page.click('#chips .chip:nth-child(3)');
      await settle();
      check((await step(page)).hash === '#/features/notes' && await page.evaluate(() => document.querySelector('#chips .chip:nth-child(3)').dataset.on === 'false'), 'wizard: a dot jumps to its slide and shows it off');
      await page.click('#back');
      await settle();
      check((await step(page)).hash === '#/features/todo', 'wizard: Back walks the slides back');
      await page.goBack();
      await settle();
      check((await step(page)).hash === '#/features/notes', 'wizard: the browser\'s back does too');
      await page.click('.rail [data-go="school"]');
      await settle();
      st = await step(page);
      check(st.hash === '#/school' && await page.evaluate(() => document.activeElement?.id === 'address'), 'wizard: the rail jumps to the school, its field focused');
      await page.close();
    }

    for (const [w, viewport] of [['wide', { width: 1440, height: 900 }], ['narrow', { width: 390, height: 844 }]]) {
      if (w === 'narrow') {
        const tour = await open(viewport, 'no-preference', '');
        await shot(tour, `${w}-w1-start`);
        for (const [hash, name] of [['#/theme', 'w2-theme'], ['#/motion', 'w5-motion'], ['#/nav', 'w6-nav'], ['#/features/sidebar', 'w7-features-sidebar'], ['#/features/buddy', 'w7-features-buddy'], ['#/ai', 'w8-ai']]) {
          await tour.evaluate((h) => { location.hash = h; }, hash);
          await settle();
          await shot(tour, `${w}-${name}`);
        }
        check(await tour.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}: nothing runs off the side`);
        await tour.close();
      }
      const page = await open(viewport);
      let s = await state(page);
      check(s.focus === 'address' && s.act === 'none' && s.disabled === 'true' && s.label === 'Allow', `${w}: the field has focus and Allow waits for an address${s.focus === 'address' ? '' : ` (focus: ${s.focus || 'none'})`}`);
      check(await accent(page) === '#27cdf1', `${w}: it wears the theme the student picked`);
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
      await page.waitForFunction(() => document.querySelector('.bar').dataset.state === 'done', null, { timeout: 8000 });
      await pause(300);
      s = await state(page);
      check(s.bar === 'done' && s.act === 'open' && s.focus === 'go' && s.another && s.said === 'Allowed bb.school.edu', `${w}: granted and checked, the bar settles and Open has focus`);
      check(await page.evaluate(() => !document.querySelector('#kind').hidden && document.querySelector('#kind').textContent === 'Blackboard'), `${w}: it names the LMS it found`);
      check(JSON.stringify(await page.evaluate(() => globalThis.__gz.sent.slice(-2))) === JSON.stringify([{ type: 'glaze:allow', op: 'ask', origin: 'https://bb.school.edu' }, { type: 'glaze:allow', op: 'yes', origin: 'https://bb.school.edu', kind: 'ultra', url: 'https://bb.school.edu/' }]), `${w}: the worker hears the site is coming, then what it is`);
      await shot(page, `${w}-6-granted`);
      await pause(900);
      await shot(page, `${w}-6b-granted-settled`);
      // Finish: what was chosen, and the school to open.
      check(await page.evaluate(() => document.querySelector('#next .label').textContent) === 'Finish', `${w}: the school's step finishes the wizard`);
      await page.click('#next');
      await settle();
      check((await step(page)).hash === '#/done', `${w}: Finish shows the end`);
      const summary = await page.evaluate(() => [...document.querySelectorAll('#summary dd')].map((d) => d.textContent));
      check(summary.includes('Frostdev') && summary.includes('Expressive') && summary.includes('bb.school.edu'), `${w}: the end lists the Look, the motion and the school (${summary.join(', ')})`);
      check(await page.evaluate(() => !document.querySelector('#open-school').hidden && document.querySelector('#open-school .label').textContent === 'bb.school.edu'), `${w}: and offers to open the school`);
      await pause(800);
      await shot(page, `${w}-w8-done`);
      await page.goBack();
      await settle();
      check((await step(page)).hash === '#/school' && (await state(page)).bar === 'done', `${w}: back at the school, still allowed`);

      await page.click('#another');
      await pause(300);
      s = await state(page);
      check(s.focus === 'address' && s.act === 'none' && !s.another, `${w}: Another school starts over`);

      // The school's main website instead of its course site.
      await type(page, 'www.school.edu');
      await page.click('#go');
      await pause(200);
      await page.evaluate(() => globalThis.__gz.answer(true));
      await page.waitForFunction(() => !document.querySelector('#note').hidden, null, { timeout: 15000 });
      await pause(300);
      check(await page.evaluate(() => document.querySelector('#error').textContent) === 'No course site at www.school.edu', `${w}: a site that isn't a course site is turned down`);
      check(JSON.stringify(await page.evaluate(() => globalThis.__gz.removed.at(-1))) === '["https://www.school.edu/*"]', `${w}: and its grant is handed back`);
      check(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#picks .pick')].map((b) => b.textContent))) === '["bb.school.edu"]', `${w}: the course site it links to is offered`);
      check(await page.evaluate(() => document.activeElement?.classList.contains('pick')), `${w}: and has focus`);
      await shot(page, `${w}-6c-not-a-course-site`);
      await page.click('#picks .pick');
      await pause(200);
      check(JSON.stringify(await page.evaluate(() => globalThis.__gz.asked.at(-1))) === '["https://bb.school.edu/*"]', `${w}: picking it asks for that site`);
      await page.evaluate(() => globalThis.__gz.answer(true));
      await page.waitForFunction(() => document.querySelector('.bar').dataset.state === 'done', null, { timeout: 8000 });
      check(await page.inputValue('#address') === 'bb.school.edu', `${w}: and it settles there`);
      await page.click('#another');
      await type(page, 'bb.nowhere.edu');
      await page.click('#go');
      await pause(200);
      await page.evaluate(() => globalThis.__gz.answer(true));
      await page.waitForFunction(() => !document.querySelector('#note').hidden, null, { timeout: 15000 });
      check(await page.evaluate(() => document.querySelector('#error').textContent) === "Can't reach bb.nowhere.edu" && JSON.stringify(await page.evaluate(() => globalThis.__gz.removed.at(-1))) === '["https://bb.nowhere.edu/*"]', `${w}: a site that doesn't answer is turned down, its grant handed back`);
      await page.fill('#address', '');

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
    check(await calm.evaluate(() => document.documentElement.getAttribute('data-gz-motion') === 'off'), 'reduced motion: the page\'s motion is off');
    const ph = await calm.evaluate(() => document.querySelector('#address').placeholder);
    await pause(3200);
    check(ph === await calm.evaluate(() => document.querySelector('#address').placeholder), 'reduced motion: the examples hold still');
    await shot(calm, 'wide-8-reduced-motion');
    // Firefox can revoke required hosts. Re-allowing one must never hand it back when its probe fails.
    await calm.evaluate(() => __gz.held.delete('https://*.instructure.com/*'));
    await type(calm, 'school.instructure.com');
    await calm.click('#go');
    await pause(200);
    await calm.evaluate(() => __gz.answer(true));
    await calm.waitForFunction(() => !document.querySelector('#note').hidden, null, { timeout: 15000 });
    check(await calm.evaluate(() => __gz.held.has('https://school.instructure.com/*') && !__gz.removed.flat().includes('https://school.instructure.com/*')), 'a required host re-granted on Firefox stays held after a failed probe');
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
