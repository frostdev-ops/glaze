// The sidebar with course tabs on Blackboard Ultra, on the synthetic Ultra course (test/fixtures/ultra-course.html, no
// account or outside network): one working dock at a time (the document on screen), a placement made in a course
// frame kept through switching and a refresh, rapid switching and Back/Forward, and no sidebar work in hidden documents.
// Hold /private/tmp/claude-501/glaze-heavy.lock and run under nice.
// NODE_PATH=<installed playwright> nice -n 15 node scripts/sidebar-ultra-tabs-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test', uid = '_42_1';
const G = require(path.join(ext, 'defaults.js'));
const html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-ultra-tabs-'));
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-sidebar-ultra-tabs-evidence'));
let page, checks = 0;
const errors = [], failures = [];
const ok = (v, label) => { if (!v) throw Error(label); console.log(`ok   ${label}`); checks++; };
const probe = (v, label) => { if (v) ok(v, label); else { failures.push(label); console.error(`FAIL ${label}`); } };
const wait = async (read, accepts, label, ms = 20000) => { let v; const end = Date.now() + ms; do { v = await read(); if (accepts(v)) return v; await page.waitForTimeout(150); } while (Date.now() < end); throw Error(`${label} (last: ${JSON.stringify(v)})`); };

// Every document of this tab: the page and each course-tab frame, whether it is on screen, and whether its dock shows.
const docs = () => page.evaluate(() => {
  const vis = (d, e) => !!e && e.getClientRects().length > 0 && d.defaultView.getComputedStyle(e).visibility !== 'hidden' && d.defaultView.getComputedStyle(e).display !== 'none';
  const one = (d, name, onScreen) => {
    const host = d.querySelector('[data-gz-sidebar-host]');
    return { name, path: d.location.pathname, onScreen, dock: onScreen && vis(d, host) && !!host.querySelector('#gz-sb-widgets'), mode: d.documentElement.dataset.gzSidebar || null,
      hidden: d.documentElement.hasAttribute('data-gz-ctab-framed'), tiles: [...d.querySelectorAll('.gz-sb-dock > .gz-w')].map((t) => t.dataset.tile) };
  };
  const box = document.getElementById('gz-ctabs-frames');
  const frames = [...document.querySelectorAll('#gz-ctabs-frames > iframe')].map((f) => {
    let d = null; try { d = f.contentDocument; } catch { /* another origin */ }
    const onScreen = !!box?.hasAttribute('data-on') && f.style.visibility !== 'hidden' && f.style.display !== 'none' && !f.inert;
    return d?.documentElement ? one(d, f.name, onScreen) : { name: f.name, onScreen, dock: false };
  });
  return [one(document, 'top', !document.documentElement.hasAttribute('data-gz-ctab-framed')), ...frames];
});
const onScreen = async () => (await docs()).filter((d) => d.onScreen);
const settled = (name) => wait(async () => { const d = await docs(); return { live: d.filter((x) => x.dock).map((x) => x.name), shown: d.filter((x) => x.onScreen).map((x) => x.name), pic: await page.evaluate(() => !!document.querySelector('#gz-ctabs-frames .gz-ctabs-pic')) }; },
  (s) => s.live.length === 1 && s.shown.length === 1 && s.live[0] === s.shown[0] && !s.pic && (!name || s.shown[0] === name), `one dock, on the document on screen${name ? ` (${name})` : ''}`);
const oneDock = async (label, name) => {
  const s = await settled(name).catch((e) => ({ error: e.message }));
  probe(!s.error, `${label}: exactly one visible dock, the one on screen${s.error ? ` (${s.error})` : ` (${s.live[0]})`}`);
  if (s.error && process.env.DEBUG) console.log('DEBUG', JSON.stringify(await docs()), await page.evaluate(() => { const h = document.querySelector('[data-gz-sidebar-host]'); return JSON.stringify({ url: location.pathname, host: h && [h.id, h.className, h.getClientRects().length, getComputedStyle(h).visibility, getComputedStyle(h).display], sb: document.documentElement.dataset.gzSidebar }); }));
  return s;
};

// Watches every hidden document's Glaze sidebar nodes from the page itself (the main world): any change there counts.
const watchHidden = () => page.evaluate(() => {
  const all = [document, ...[...document.querySelectorAll('#gz-ctabs-frames > iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
  globalThis.__gzSbWatch?.forEach((o) => o.disconnect());
  globalThis.__gzSbWatch = [];
  const counts = {};
  for (const d of all) {
    const name = d === document ? 'top' : d.defaultView.name;
    counts[name] = { hidden: d.documentElement.hasAttribute('data-gz-ctab-framed'), n: 0, what: [] };
    // Glaze's sidebar parts only: the LMS's own column content, and other features' marks on it, are not sidebar work.
    const ours = (n) => { const e = n?.nodeType === 1 ? n : n?.parentElement; return !!e?.closest?.('.gz-sb-head, .gz-sb-pagehead, .gz-sb-resize, #gz-sb-widgets, #gz-sidebar, .gz-sb-edge, .gz-sb-launch, .gz-sb-backdrop, .gz-sb-menu'); };
    const o = new d.defaultView.MutationObserver((rs) => {
      for (const r of rs) {
        const mine = r.type === 'attributes' && (r.target === d.documentElement || r.target.hasAttribute?.('data-gz-sidebar-host')) ? /^(data-gz-(sidebar|sb)|role|aria-)/.test(r.attributeName) : ours(r.target) || [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && (n.matches?.('#gz-sidebar, .gz-sb-head, #gz-sb-widgets, .gz-w') || ours(n)));
        if (mine) { counts[name].n++; if (counts[name].what.length < 5) counts[name].what.push(`${r.type}:${r.attributeName || ''}:${r.target.id || r.target.className || r.target.nodeName}`); }
      }
    });
    o.observe(d.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    globalThis.__gzSbWatch.push(o);
  }
  globalThis.__gzSbCounts = counts;
});
const hiddenCounts = () => page.evaluate(() => globalThis.__gzSbCounts);

(async () => {
  let ctx;
  try {
    fs.mkdirSync(out, { recursive: true });
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      executablePath: process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
      headless: true, viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }), headers: { 'cache-control': 'no-store' } });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const recordKey = `sidebar:ultra:${site}/${uid}`;
    const settings = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, motion: { level: 'off' }, enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place', 'sidebar', 'notes', 'widgets'].includes(k)])), tabs: G.GZ_SANITIZE({}).tabs };
    await opts.evaluate(async ({ settings, site, uid, recordKey }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site], [`ctabs:${site}:${uid}`]: { tabs: [1, 2, 3].map((i) => ({ cid: `_${100 + i}_1`, name: `Synthetic course ${i}`, path: `/ultra/courses/_${100 + i}_1/outline`, top: 0, at: i, pin: false })) },
        [recordKey]: { v: 1, rev: 1, mig: 1, dock: [{ id: 'notes' }], dest: { notes: 'dock' } } });
    }, { settings, site, uid, recordKey });
    const record = () => opts.evaluate(async (k) => (await chrome.storage.local.get(k))[k], recordKey);
    page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    const tab = (cid) => ({
      click: async () => {
        const on = (await onScreen())[0];
        const root = on && on.name !== 'top' ? page.frameLocator(`#gz-ctabs-frames > iframe[name="${on.name}"]`) : page;
        const b = await root.locator(`#gz-ctabs [data-course-id="${cid}"]`).first().boundingBox({ timeout: 8000 });
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      },
    });
    const frame = (cid) => page.frameLocator(`#gz-ctabs-frames > iframe[name="gz-ctab:${cid}"]`);

    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').waitFor();
    await page.waitForTimeout(800); // the strip takes picks once its page settles
    await oneDock('the course page itself', 'top');
    await tab('_102_1').click();
    await oneDock('a course frame', 'gz-ctab:_102_1');
    const before = await record();
    await frame('_102_1').locator('.gz-sb-add').click();
    await frame('_102_1').locator('#gz-sb-adding .gz-sb-row', { hasText: 'Focus timer' }).locator('button').click();
    const after = await wait(record, (r) => r?.dest?.timer === 'dock', 'the frame\'s change stored');
    ok(after.rev > before.rev, 'the frame\'s placement committed through the page around it');
    await page.waitForTimeout(800);
    await tab('_101_1').click();
    await oneDock('back to the page', 'top');
    probe((await docs()).find((d) => d.name === 'top').tiles.includes('timer'), 'the page\'s dock shows the frame\'s placement');
    await tab('_103_1').click();
    await oneDock('a third course', 'gz-ctab:_103_1');
    probe((await docs()).find((d) => d.name === 'gz-ctab:_103_1').tiles.includes('timer'), 'a new frame\'s dock shows it too');
    await page.reload();
    await oneDock('after a refresh');
    await page.waitForTimeout(800);
    ok((await record()).dest.timer === 'dock', 'the placement survives a refresh');
    // Hidden documents do no sidebar work through resizes.
    await tab('_102_1').click();
    await oneDock('frame on screen', 'gz-ctab:_102_1');
    await page.waitForTimeout(800);
    await watchHidden();
    await page.setViewportSize({ width: 1200, height: 900 }); await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(1200);
    const counts = await hiddenCounts();
    for (const [name, c] of Object.entries(counts)) if (c.hidden) probe(c.n === 0, `hidden ${name}: no sidebar or dock changes through two resizes (${c.n}${c.what.length ? ': ' + c.what.join(', ') : ''})`);
    probe(Object.values(counts).some((c) => !c.hidden && c.n > 0), 'the document on screen did lay out (the watch works)');
    // Rapid switching, then Back and Forward.
    for (const cid of ['_103_1', '_101_1', '_102_1', '_103_1', '_101_1']) await tab(cid).click();
    await oneDock('rapid switching', 'top');
    // Back and Forward: two loads of the page make the history, a course frame over the second.
    await page.goto(`${site}/ultra/courses/_103_1/outline`);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').waitFor(); await page.waitForTimeout(800);
    await tab('_102_1').click();
    await oneDock('a frame before Back', 'gz-ctab:_102_1');
    for (const [go, label] of [['back', 'Back'], ['forward', 'Forward'], ['back', 'Back again'], ['forward', 'Forward again']]) {
      await (go === 'back' ? page.goBack() : page.goForward()).catch(() => {});
      await page.waitForTimeout(600);
      await oneDock(label);
    }
    await page.screenshot({ path: path.join(out, 'after-history.png') });
    ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    console.log(`${failures.length ? 'FAILED' : 'passed'}; ${checks} checks, ${failures.length} failures; evidence in ${out}`);
    if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
