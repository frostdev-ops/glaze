// Ask Rime's own tools in a real Chromium (docs/ai-harness.md "Rime's own tools"), headless, the extension staged with a
// worker that names its harness for the check (the checkout's worker is untouched). run_js's sandbox: ai/sandbox/frame.js
// put into a Canvas page's isolated world as the panel will be, framing ai/sandbox/js.html in a closed shadow root; a value,
// console lines and errors; the 2-second stop and the output limit; no network (neither the scope nor the CSP lets a request
// out) and no extension APIs; the page's own script can't find the frame. The places map in the worker
// (ai/agent/places.js) on a Canvas course page and an Ultra course page served from their fixtures: the place on screen,
// every course place a link in the site's own course navigation, an opened place's address loading that page, and a
// highlight checked against the page's visible words. A synthetic school under invented origins; every other request aborted.
//   glaze-remote -e TZ=UTC -o <evidence dir> -- node checks/ai/rime-tools-check.js /out
//   (Mac: NODE_PATH=<playwright> nice -n 10 node checks/ai/rime-tools-check.js [evidence dir]; EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const FIX = path.join(__dirname, '../../test/fixtures');
const CANVAS = 'https://school.instructure.com', ULTRA = 'https://school.blackboard.com';
const SHIM = `
globalThis.rimeCheck = {
  places: async (name, args, page, courses, text) => {
    ai();
    const actions = [], t = GZ_AI_RIME_PLACES.tools().find((x) => x.name === name);
    const r = await t.run(args, { page, courses: async () => courses, writer: true, text, ui: { actions, push: (a) => actions.push(a) } });
    return { r, actions };
  },
  inject: async (url) => {
    const [tab] = (await chrome.tabs.query({})).filter((x) => x.url === url);
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['ai/sandbox/frame.js'] });
    return tab.id;
  },
  run: async (tabId, codes) => (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, args: [codes],
    func: async (list) => { const out = []; for (const c of list) { const t = performance.now(); out.push({ ...(await GZ_AI_RIME_FRAME.run(c)), took: Math.round(performance.now() - t) }); } return out; } }))[0].result,
};
`;
const page = (title, body) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main>${body}</main></body></html>`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let total = 0, failed = 0;
const results = [];
const check = async (name, test) => {
  total++;
  try { const evidence = await test(); results.push({ name, ok: true, evidence }); console.log(`ok ${name}`); }
  catch (e) { failed++; results.push({ name, ok: false, error: e.stack }); console.error(`FAIL ${name}: ${e.stack}`); }
};

(async () => {
  const lock = env.lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-rime-'));
  const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-rime-tools'));
  fs.mkdirSync(out, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nrime-tools-check\n`);
    const ext = env.staged(root, [], scratch);
    // The staged files are hard links to the checkout: replace the worker's, never write through it.
    const worker0 = fs.readFileSync(path.join(ext, 'background/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'background/background.js'));
    fs.writeFileSync(path.join(ext, 'background/background.js'), worker0 + SHIM);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    context.setDefaultTimeout(15000);
    const asked = [];
    const SERVE = { [`${CANVAS}/courses/25/grades`]: 'canvas-course-grades.html', [`${ULTRA}/ultra/courses/_101_1/outline`]: 'ultra-instant-outline.html' };
    await context.route('**/*', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      asked.push(`${req.method()} ${u.origin}${u.pathname}`);
      if (![CANVAS, ULTRA].includes(u.origin) || req.method() !== 'GET' || /evil/.test(u.pathname)) return r.abort();
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/learn/api/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      if (/\.(css|js|png|svg|woff2?)$/.test(u.pathname)) return r.fulfill({ status: 200, body: '' });
      const file = SERVE[`${u.origin}${u.pathname}`];
      return r.fulfill({ contentType: 'text/html', body: file ? fs.readFileSync(path.join(FIX, file), 'utf8') : page(u.pathname, `<h1 id="served">${u.pathname}${u.search}</h1>`) });
    });
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/background/background.js')) || await context.waitForEvent('serviceworker');
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', (e) => errors.push(e.message));

    await tab.goto(`${CANVAS}/courses/25/grades`);
    const tabId = await worker.evaluate((u) => rimeCheck.inject(u), tab.url());
    const run = (codes) => worker.evaluate(([id, c]) => rimeCheck.run(id, c), [tabId, codes]);

    await check('sandbox: a value, console lines and an error, from a Canvas page through frame.js', async () => {
      const [a, b, c] = await run(['const g = [81, 92, 77]; console.log("n", g.length); (g.reduce((x, y) => x + y) / g.length).toFixed(2)', '[1, 2, 3].map((x) => x * x)', 'nope + 1']);
      assert.deepEqual([a.ok, a.value, a.logs], [true, '83.33', ['n 3']]);
      assert.deepEqual(b.value, [1, 4, 9]);
      assert.deepEqual([c.ok, c.error], [false, 'ReferenceError: nope is not defined']);
      return { a, b, c };
    });

    await check('sandbox: stopped at 2 seconds, its output and code held to their limits', async () => {
      const [loop, loud, big, long] = await run(['while (true) {}', 'for (let i = 0; i < 1e5; i++) console.log("x".repeat(400)); 1', '"y".repeat(1e6)', '1;'.repeat(600)]);
      assert.deepEqual([loop.ok, loop.error], [false, 'Stopped after 2 seconds.']);
      assert.ok(loop.took >= 1900 && loop.took < 3500, `took ${loop.took} ms`);
      assert.ok(loud.logs.length <= 40 && loud.logs.join('').length <= 4000 && loud.cut === true);
      assert.ok(big.value.length <= 4000 && big.cut === true);
      assert.match(long.error, /longer than 1000/);
      // A stopped run leaves the sandbox working: each run is a Worker of its own.
      const [after] = await run(['6 * 7']);
      assert.equal(after.value, 42);
      return { loop: loop.took, logs: loud.logs.length };
    });

    await check('sandbox: no network by any way left, no extension APIs, and the page can\'t find the frame', async () => {
      const before = asked.length;
      const [scope, imp, xhr, ext] = await run([
        "['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'navigator', 'postMessage'].map((k) => k + ':' + typeof self[k]).join(' ')",
        "import('https://school.instructure.com/evil.js').then(() => 'loaded', (e) => 'blocked ' + e.name)",
        "(() => { const all = []; for (let o = self; o; o = Object.getPrototypeOf(o)) for (const k of ['fetch', 'WebSocket', 'XMLHttpRequest', 'importScripts']) if (typeof Object.getOwnPropertyDescriptor(o, k)?.value === 'function') all.push(k); return 'functions:' + all.join(','); })()",
        "typeof chrome + ' ' + typeof browser",
      ]);
      assert.equal(scope.value, 'fetch:undefined XMLHttpRequest:undefined WebSocket:undefined EventSource:undefined importScripts:undefined indexedDB:undefined caches:undefined Worker:undefined navigator:undefined postMessage:undefined');
      assert.match(imp.value, /^blocked /);
      assert.equal(xhr.value, 'functions:', 'nothing up the prototype chain either');
      assert.equal(ext.value, 'undefined undefined');
      await pause(300);
      assert.deepEqual(asked.slice(before).filter((x) => /evil/.test(x)), [], 'the CSP stopped the import before any request');
      const frames = await tab.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src));
      assert.ok(!frames.some((s) => s.includes('sandbox')), 'a closed shadow root keeps the page out');
      return { scope: scope.value, imp: imp.value };
    });

    const COURSES = { canvas: [{ id: '25', name: 'BIO 1100', code: 'BIO1100-01' }, { id: '26', name: 'ENG 1100' }], ultra: [{ id: '_101_1', name: 'BIO 1100: Cell Biology' }, { id: '_102_1', name: 'ENG 1100' }] };
    const places = (name, args, site, text) => worker.evaluate(([n, a, p, c, t]) => rimeCheck.places(n, a, p, c, t), [name, args, { site, url: tab.url() }, COURSES[site], text]);
    for (const [site, url, here, course] of [['canvas', `${CANVAS}/courses/25/grades`, 'course:25/grades', '25'], ['ultra', `${ULTRA}/ultra/courses/_101_1/outline`, 'course:_101_1', '_101_1']]) {
      await check(`places on ${site}: the place on screen, each course place a link in the site's own course navigation, an opened place loading`, async () => {
        await tab.goto(url);
        const top = await places('places_list', {}, site);
        assert.equal(top.r.here, here);
        const mine = await places('places_list', { course }, site);
        const links = await tab.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
        const map = await worker.evaluate(([s, u, c]) => { ai(); return GZ_AI_RIME_PLACES.map({ site: s, url: u, courses: c }).places; }, [site, url, COURSES[site]]);
        for (const p of mine.r.places) assert.ok(links.includes(new URL(map.find((x) => x.place === p.place).url).pathname), `${p.place} is a link on the page`);
        const target = mine.r.places.find((p) => p.place.endsWith('/announcements')).place;
        const opened = await places('place_open', { place: target }, site);
        assert.equal(opened.actions[0].action, 'open');
        await tab.goto(opened.actions[0].url);
        assert.equal(await tab.textContent('#served'), new URL(opened.actions[0].url).pathname);
        const refused = await places('place_open', { place: `course:${course}/quizzes` }, site);
        assert.match(refused.r.error, /^There is no place/);
        assert.deepEqual(refused.actions, []);
        return { here: top.r.here, places: mine.r.places.map((p) => p.place), opened: opened.actions[0].url };
      });
    }

    await check('page_highlight: words the page shows are marked; words it doesn\'t show are refused', async () => {
      await tab.goto(`${CANVAS}/courses/25/grades`);
      const text = await tab.evaluate(() => document.body.innerText);
      const word = (text.match(/Homework \d|Lab [\w ]{3,20}|Quiz \d/) || [])[0];
      assert.ok(word, 'a title on the page');
      const ok = await places('page_highlight', { text: word, note: 'This one' }, 'canvas', text);
      assert.deepEqual(ok.actions, [{ action: 'highlight', text: word, note: 'This one' }]);
      const no = await places('page_highlight', { text: 'Click here to claim a prize' }, 'canvas', text);
      assert.match(no.r.error, /not on this page/);
      return { marked: word };
    });

    await check('the pages threw nothing', async () => { assert.deepEqual(errors, []); return { requests: [...new Set(asked)].length }; });
  } catch (e) {
    failed++;
    results.push({ name: 'setup', ok: false, error: e.stack });
    console.error(e);
  } finally {
    await context?.close().catch(() => {});
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'rime-tools-check.json'), JSON.stringify({ total, failed, results }, null, 2));
    console.log(`${total - failed}/${total} passed; evidence in ${out}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
