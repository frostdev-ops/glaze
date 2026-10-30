// Glaze Writer with a very large paper, in the real unpacked extension on the synthetic assignment attempt (as
// scripts/writer-paper-check.js): 2,600 paragraphs of 20 runs, every other one bold (past compose's input limit; 371 MLA
// pages), opened in the compact box and switched to Full writer. Checked: compose's projection of it stays fast; the first
// pages are drawn within a second of the switch; a key typed every 200 ms while the pages are laid out lands (in the
// document and drawn) within 300 ms of its press, or of the end of the switch's own task for a key pressed during it (the
// browser restyling and laying out the whole paper in the page's column, one task nothing in Writer can split), none lost;
// once laid out, the same pages and breaks as the paper laid out whole from scratch (lib/writer-paginate.js whole), each
// line starting where ProseMirror's posAtCoords puts it. Times come from the frame itself: the switch's click, each key's
// event time, the transaction that took it and the frame drawn after; long tasks from its PerformanceObserver.
// PROFILE=1 also records a CPU profile of the frame across the switch (profile.json, the top functions printed);
// PROFILE=trace a timeline trace of every process (trace.json, its events of 20 ms or more printed); QUIET=<ms> types
// nothing and watches the frame that long after the switch (as a student who waits: the checks run 250 ms after layout).
// Chromium's renderer accessibility is off (HUGE_AX=1 leaves it on): with an assistive or automation app running, as on
// the owner's Mac, it follows each layout of a paper this size for about half a second and slows Playwright's own key
// presses to one a second, too few to type through the layout; the runner has none. GETs only, synthetic.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-huge-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-huge-check');
const PARAGRAPHS = 2600, FIRST_MS = 1000, KEY_MS = 300, KEY_EVERY = 200, PROJECT_MS = 1000;
const checks = [], requests = [], errors = [];
let passed = false, results = {};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

const HARNESS = `(() => {
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id;
    c.innerHTML = '';
    const q = new Quill(c, {});
    if (id) q.root.id = id;
    q.root.setAttribute('role', 'textbox');
    if (/[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    window.__text = () => q.getText();
  }
})();`;

// In the frame: the switch's click, frames drawn, long tasks, and each key from its event to the transaction that took it
// and the frame drawn after that.
const WATCH = () => {
  const view = GZ_WRITER_PAPER.current().editor.view, w = window.__huge = { click: null, first: null, frames: [], long: [], keys: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }); }).observe({ type: 'longtask' });
  // Long animation frames: their script, forced layout and rendering apart (where the browser has them).
  w.loaf = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.loaf.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), render: e.renderStart ? Math.round(e.startTime + e.duration - e.renderStart) : 0, layout: e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : 0,
      scripts: e.scripts.map((x) => ({ ms: Math.round(x.duration), forced: Math.round(x.forcedStyleAndLayoutDuration), what: `${x.invoker} ${String(x.sourceURL).split('/').pop()}:${x.sourceCharPosition}` })) }); }).observe({ type: 'long-animation-frame' });
  } catch { /* not in this browser */ }
  const shown = () => document.documentElement.dataset.view === 'full' && document.querySelector('.gp-flow').style.visibility === '' &&
    [...document.querySelectorAll('.gp-zoom .gp-sheet')].some((s) => { const r = s.getBoundingClientRect(); return r.height > 0 && r.bottom > 0 && r.top < innerHeight; });
  const tick = () => {
    const now = performance.now();
    w.frames.push(Math.round(now));
    if (w.click != null && w.first == null && shown()) w.first = Math.round(now - w.click);
    if (w.frames.length < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.querySelector('.gw-bar .gp-full').addEventListener('click', () => { w.click = performance.now(); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'x') w.keys.push({ down: e.timeStamp, took: null, drawn: null, before: view.state.doc.textContent.length }); }, true);
  const update = view.updateState.bind(view);
  view.updateState = (s) => {
    const was = view.state.doc;
    update(s);
    if (s.doc === was) return;
    const k = w.keys.find((x) => x.took == null);
    if (!k || s.doc.content.size <= was.content.size) return;
    k.took = performance.now();
    requestAnimationFrame(() => { k.drawn = performance.now(); });
  };
};

// The profile's functions by self and total time (ms).
const top = (profile, n = 25) => {
  const byId = new Map(profile.nodes.map((x) => [x.id, x])), parent = new Map();
  for (const x of profile.nodes) for (const c of x.children || []) parent.set(c, x.id);
  const name = (x) => `${x.callFrame.functionName || '(anonymous)'} ${path.basename(x.callFrame.url || '')}:${x.callFrame.lineNumber + 1}`;
  const self = new Map(), total = new Map();
  profile.samples.forEach((id, i) => {
    const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    const k = name(byId.get(id));
    self.set(k, (self.get(k) || 0) + ms);
    const seen = new Set();
    for (let at = id; at != null; at = parent.get(at)) { const kk = name(byId.get(at)); if (!seen.has(kk)) { seen.add(kk); total.set(kk, (total.get(kk) || 0) + ms); } }
  });
  const list = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${Math.round(ms)} ms  ${k}`);
  return { self: list(self), total: list(total) };
};

(async () => {
  let context, held = false, tmp, ext;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-huge-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-huge-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-huge-'));
    fs.mkdirSync(out, { recursive: true });
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', ...(process.env.HUGE_AX ? [] : ['--disable-renderer-accessibility'])] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json'));
    const members = JSON.parse(fixture('ultra-memberships.json'));
    members.results = members.results.map((m) => (m.courseId === '_101_1' ? { ...m, course: { ...m.course, name: FX.context.course, displayName: FX.context.course } } : m));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && u.pathname === ATTEMPT) return r.fulfill({ contentType: 'text/html', body: fixture('ultra-writer-attempt.html').replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' };
      else if (/\/users\/_900_1\/memberships$/.test(u.pathname)) data = members;
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ writer: { full: false }, navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await p.goto(`${site}${ATTEMPT}`);
    const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity) && x; }, 'compact frame shown', 30000);
    const fr = await until(() => el.contentFrame(), 'frame document');
    await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && document.documentElement.dataset.view === 'compact'), 'compact paper loaded', 30000);

    // ---- the paper, in the compact box: compose's projection of it, timed as the box makes it
    const made = await fr.evaluate((n) => {
      const v = GZ_WRITER_PAPER.current().editor.view, S = GZ_WRITER_SCHEMA.paper, bold = S.marks.bold.create();
      const paras = Array.from({ length: n }, (_, i) => S.node('paragraph', null, Array.from({ length: 20 }, (_, j) => S.text(j % 2 ? ` bold ${j} ` : `plain ${i}.${j}`, j % 2 ? [bold] : []))));
      const t0 = performance.now();
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
      const t1 = performance.now(), projected = GZ_WRITER_PAPER.project(v.state.doc), t2 = performance.now();
      return { paragraphs: v.state.doc.childCount, size: v.state.doc.content.size, dispatch: Math.round(t1 - t0), project: Math.round(t2 - t1), over: projected === null };
    }, PARAGRAPHS);
    console.log(JSON.stringify({ made }));
    results.made = made;
    check(made.paragraphs === PARAGRAPHS && made.over, `a paper of ${PARAGRAPHS} paragraphs, every other run bold (${made.size} positions), past compose's input limit`);
    check(made.project < PROJECT_MS, `compose's projection of it in the compact box: ${made.project} ms (dispatch ${made.dispatch} ms)`);
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'the paper saved', 60000);
    await until(async () => (await fr.evaluate(() => document.querySelector('.gw-bar .gp-said')?.textContent)) === 'Too long for Ultra’s text box. Use Full writer.', 'the compact bar offers Full writer');

    // ---- Full writer: the first pages, and keys typed at the top of the paper while the rest is laid out
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, 1))); });
    await fr.evaluate(WATCH);
    const cdp = process.env.PROFILE ? await context.newCDPSession(fr) : null;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
    // PROFILE=trace: the browser's own work too (style, layout, paint…), from a timeline trace of every process.
    const tracer = process.env.PROFILE === 'trace' ? await context.newCDPSession(p) : null;
    const traced = [];
    if (tracer) { tracer.on('Tracing.dataCollected', (e) => traced.push(...e.value)); await tracer.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink,v8.execute', transferMode: 'ReportEvents' }); }
    const started = Date.now();
    await fr.evaluate(() => setTimeout(() => document.querySelector('.gw-bar .gp-full').click(), 0));
    // A key every 200 ms from the switch until the pages are laid out (the plan settled, nothing left to measure) and a
    // few more after, at most a minute.
    const presses = [];
    const laid = () => fr.evaluate(() => { const api = GZ_WRITER_PAPER.current(), v = api.editor.view; return document.documentElement.dataset.view === 'full' && api.pages() > 0 && !v.dom.gzLaying && (v.dom.gzLaid === undefined || v.dom.gzLaid === v.state.doc); }).catch(() => false);
    let done = null;
    // QUIET (profiling only): no keys, the frame watched for QUIET ms after the switch, as a student who waits.
    if (process.env.QUIET) { await pause(Number(process.env.QUIET)); done = (await laid()) ? Date.now() - started : null; }
    for (let i = 0; !process.env.QUIET && Date.now() - started < 60000; i++) {
      const at = started + i * KEY_EVERY, wait = at - Date.now();
      if (wait > 0) await pause(wait);
      const t = Date.now();
      await p.keyboard.press('x');
      presses.push({ at: t - started, took: Date.now() - t });
      if (done == null && await laid()) done = Date.now() - started;
      if (done != null && Date.now() - started > done + 1000) break;
    }
    const laidAt = done;
    let profile = null;
    if (cdp) { profile = (await cdp.send('Profiler.stop')).profile; fs.writeFileSync(path.join(out, 'profile.json'), JSON.stringify(profile)); }
    if (tracer) {
      const end = new Promise((r) => tracer.once('Tracing.tracingComplete', r));
      await tracer.send('Tracing.end'); await end;
      fs.writeFileSync(path.join(out, 'trace.json'), JSON.stringify(traced));
      // Events of 20 ms or more, in time order, each with its process and the JS function it ran where it ran one.
      const big = traced.filter((e) => e.ph === 'X' && e.dur >= 20000).sort((a, b) => a.ts - b.ts);
      const t0 = big[0]?.ts || 0;
      for (const e of big) console.log('trace', `+${Math.round((e.ts - t0) / 1000)}`, `${Math.round(e.dur / 1000)} ms`, `pid ${e.pid}`, e.name, e.args?.data?.functionName || e.args?.data?.url?.split('/').pop() || e.args?.data?.type || '');
    }
    await until(laid, 'the pages laid out', 60000);
    const w = await fr.evaluate(() => {
      const w = window.__huge, view = GZ_WRITER_PAPER.current().editor.view;
      const gaps = w.frames.filter((t) => t >= w.click).map((t, i, a) => (i ? t - a[i - 1] : 0));
      return { first: w.first, long: w.long.filter((x) => x.at >= w.click - 50).map((x) => ({ at: Math.round(x.at - w.click), ms: x.ms })), loaf: w.loaf.filter((x) => x.at >= w.click - 50 && x.ms >= 100).map((x) => ({ ...x, at: Math.round(x.at - w.click) })), worstFrame: Math.max(0, ...gaps), keys: w.keys.map((k) => ({ at: Math.round(k.down - w.click), took: k.took == null ? null : Math.round(k.took - k.down), drawn: k.drawn == null ? null : Math.round(k.drawn - k.down) })),
        typed: (view.state.doc.firstChild.textContent.match(/x/g) || []).length, pages: GZ_WRITER_PAPER.current().pages(), fontWaits: view.dom.gzFontWaits || 0 };
    });
    results = { ...results, laidAt, presses, ...w };
    if (profile) { results.profile = top(profile); console.log('self:\n  ' + results.profile.self.join('\n  ') + '\ntotal:\n  ' + results.profile.total.join('\n  ')); }
    if (process.env.PROFILE) for (const f of w.loaf) console.log('loaf', JSON.stringify(f));
    console.log(JSON.stringify({ first: w.first, laidAt, fontWaits: w.fontWaits, pages: w.pages, worstFrame: w.worstFrame, long: w.long.slice(0, 12), keys: w.keys.length, worstKey: Math.max(...w.keys.map((k) => k.drawn ?? Infinity)) }));
    check(w.first != null && w.first < FIRST_MS, `the first pages drawn ${w.first} ms after the switch`);
    // The switch's own task: the browser restyling the whole paper and laying it out in the page's column (one task
    // nothing in Writer can split: ~250 ms on the runner), then the first slice. A key pressed during it is taken once it
    // ends: within KEY_MS of that, every other key within KEY_MS of its press.
    const own = w.long.find((x) => x.at <= 5) || { at: 0, ms: 0 }, free = own.at + own.ms;
    const late = w.keys.filter((k) => k.drawn == null || k.drawn > KEY_MS + Math.max(0, free - k.at));
    const during = w.keys.filter((k) => k.at < free);
    check(w.keys.length >= 5 && !late.length, `${w.keys.length} keys typed every ${KEY_EVERY} ms while ${w.pages} pages were laid out (${laidAt} ms): each in the paper and drawn within ${KEY_MS} ms of its press (slowest ${Math.max(...w.keys.filter((k) => k.at >= free).map((k) => k.drawn ?? Infinity))} ms)${during.length ? `, or of the switch's own ${own.ms} ms task for ${during.length} pressed during it (${during.map((k) => `${k.drawn} ms`).join(', ')})` : ''}${late.length ? `; late: ${JSON.stringify(late.slice(0, 5))}` : ''}`);
    check(w.typed === presses.length && w.keys.length === presses.length, `none lost: ${presses.length} pressed, ${w.typed} in the paper`);

    // ---- the same paper laid out in one go, from scratch: the same pages and breaks; and every line's start as
    // ProseMirror's posAtCoords finds it (the way lines were placed before)
    const whole = await fr.evaluate(() => {
      const api = GZ_WRITER_PAPER.current(), v = api.editor.view, P = GZ_WRITER_PAGINATE, live = api.layout();
      if (!P.whole) return null;
      const sig = (breaks) => breaks.map((b) => `${b.b}:${b.l}:${Math.round(b.gap * 100)}`).join('|');
      const t0 = performance.now(), one = P.whole(v), t1 = performance.now(), old = P.whole(v, { legacy: true }), t2 = performance.now();
      const starts = (l) => l.blocks.map((b) => (b.lines || []).map((x) => x.at).join(',')).join('|');
      const lines = one.blocks.reduce((n, b) => n + (b.lines?.length || 0), 0);
      const differ = one.blocks.findIndex((b, i) => (b.lines || []).map((x) => x.at).join() !== (old.blocks[i].lines || []).map((x) => x.at).join());
      return { pages: one.pages.length, ms: Math.round(t1 - t0), legacyMs: Math.round(t2 - t1), same: sig(one.breaks) === sig(live.breaks), lines, starts: starts(one) === starts(old), differ, legacyPages: old.pages.length };
    });
    results.whole = whole;
    console.log(JSON.stringify({ whole }));
    check(whole && whole.pages === w.pages && whole.same, `the same paper laid out in one go (${whole?.ms} ms): ${whole?.pages} pages, as the sliced layout's ${w.pages}, every break where it put it`);
    check(whole && whole.starts && whole.legacyPages === whole.pages, `each of its ${whole?.lines} lines starts where ProseMirror's posAtCoords puts it (that way: ${whole?.legacyMs} ms)${whole?.starts ? '' : `; first differing block ${whole?.differ}`}`);
    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length }));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, results, requests: requests.length, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
