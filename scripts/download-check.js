// Canvas's Download all on a file server Glaze doesn't hold, headless: the real extension (a staged copy whose manifest is the
// shipped one, so it holds none of the file hosts) on the saved Modules page under an invented Canvas cloud host, its API and
// file servers answered by the check; all else aborts and DNS resolves nowhere. The worker meets the host, the module's header
// shows Glaze's Allow frame, and the check answers the frame's chrome.permissions.request (headless can't answer the browser's
// prompt). Allowed, the check also stands in for the grant in the worker (its chrome.permissions.contains says yes for that
// host, as the browser would once granted) and the zip completes; refused, the panel's error; a redirect to another host
// can't be asked for (the worker never sees where it goes): that file fails.
//   NODE_PATH=<installed playwright> nice node scripts/download-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const G = require('../defaults.js');
const env = require('./check-env.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '..'), []);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const O = 'https://school.instructure.com', A = 'files.cdn-a.test', B = 'files.cdn-b.test', C = 'files.cdn-c.test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-download-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const PAGE = fixture('canvas-modules.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
  .replace(/class="context_module_item (?!student-view attachment)/g, 'class="context_module_item attachment '); // a File row in each module: its button
// Each module one file: 73 on A (asked for, allowed), 74 on C (asked for, refused), 75 on A redirecting to B.
const FILES = { 73: { id: 9, name: 'notes.pdf', url: `https://${A}/9/notes.pdf?sig=a`, body: 'notes-pdf-bytes' }, 74: { id: 10, name: 'slides.pdf', url: `https://${C}/10/slides.pdf?sig=c`, body: 'slides' },
  75: { id: 11, name: 'lab.pdf', url: `https://${A}/redirect/11?sig=r`, body: 'lab' } };
const byId = Object.fromEntries(Object.values(FILES).map((f) => [f.id, f]));
const api = (u) => {
  const m = /^\/api\/v1\/courses\/25\/modules\/(\d+)\/items$/.exec(u.pathname);
  if (m) return FILES[m[1]] ? [{ id: 900 + +m[1], type: 'File', content_id: String(FILES[m[1]].id), title: FILES[m[1]].name }] : [];
  const f = /^\/api\/v1\/files\/(\d+)(\/public_url)?$/.exec(u.pathname);
  if (f && byId[f[1]]) return f[2] ? { public_url: byId[f[1]].url } : { id: +f[1], display_name: byId[f[1]].name, filename: byId[f[1]].name, size: byId[f[1]].body.length };
  if (u.pathname === '/api/v1/users/self' || u.pathname === '/api/v1/users/self/profile') return { id: '3', name: 'Sam' };
  return [];
};
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks++; console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };

(async () => {
  let ctx;
  const fetched = [], errors = [], apiAsked = [];
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce', acceptDownloads: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    env.noFirstRun(ctx);
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === O && u.pathname.startsWith('/api/v1/')) apiAsked.push(u.pathname + u.search);
      if (u.origin === O && u.pathname.startsWith('/api/v1/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(api(u)) });
      if (u.origin === O && u.pathname === '/courses/25/modules') return route.fulfill({ contentType: 'text/html', body: PAGE });
      if ([A, B, C].includes(u.hostname)) {
        fetched.push(u.href);
        if (u.pathname.startsWith('/redirect/')) return route.fulfill({ status: 302, headers: { location: `https://${B}/11/lab.pdf?sig=b` } });
        const f = Object.values(FILES).find((x) => new URL(x.url).pathname === u.pathname) || (u.hostname === B && byId[11]);
        return f ? route.fulfill({ contentType: 'application/pdf', body: f.body }) : route.fulfill({ status: 404, body: '' });
      }
      return route.abort();
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    await sw.evaluate((s) => chrome.storage.sync.set(s), G.GZ_SANITIZE({ preset: 'Frost', colors: { ...G.GZ_PRESETS.find(([n]) => n === 'Frost')[1] }, navbar: { on: false },
      enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), download: true } }));
    // The browser's real answer for each host, before the check stands in for any grant.
    const held = (h) => sw.evaluate((p) => chrome.permissions.contains({ origins: [p] }), `https://${h}/*`);
    ok(!await held(A) && !await held(B) && !await held(C), 'the staged copy holds none of the file servers');
    // Stand-in for the student's grant: the worker's contains says yes for the hosts the check grants, else the browser's answer.
    await sw.evaluate(() => {
      const P = chrome.permissions, real = P.contains.bind(P);
      globalThis.__gzGranted = new Set();
      P.contains = (o) => (o.origins.every((x) => __gzGranted.has(x)) ? Promise.resolve(true) : real(o));
    });
    const grant = (h) => sw.evaluate((p) => { __gzGranted.add(p); }, `https://${h}/*`);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${O}/courses/25/modules`);
    await until(() => page.evaluate(() => document.querySelectorAll('.gz-dl').length >= 3), 'Download all buttons').catch(async (e) => {
      console.error(JSON.stringify(await page.evaluate(() => ({ modules: [...document.querySelectorAll('.context_module[data-module-id]')].map((m) => [m.dataset.moduleId, m.className, m.querySelectorAll('.context_module_item').length]),
        glaze: [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith('data-gz')).length, buttons: document.querySelectorAll('.gz-dl').length })), null, 0), apiAsked.slice(0, 40));
      throw e;
    });
    const label = (mid) => page.locator(`#gz-dl-${mid}`).textContent();
    const allowFrame = () => page.frames().find((f) => f.url().startsWith(`chrome-extension://${id}/features/allow.html`));
    // The frame's chrome.permissions.request, recorded with whether it came inside the click, answered when the check says.
    const stub = (f) => f.evaluate(() => {
      globalThis.__gz = { calls: [] };
      chrome.permissions.request = (o) => { __gz.calls.push([o.origins, navigator.userActivation.isActive]); return new Promise((res) => { __gz.answer = res; }); };
    });
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), clip: { x: 0, y: 0, width: 1280, height: 600 } });
    const hover = (mid) => page.hover(`#context_module_${mid} .ig-header`);

    // 1. Allowed: the frame for A, its request inside the click, the file again, the zip.
    await hover(73);
    await page.click('#gz-dl-73');
    const fa = await until(async () => allowFrame(), 'the Allow frame');
    ok(fa.url().endsWith(`#${A}`), `the module's header shows Glaze's Allow frame for ${A}`);
    await until(() => fa.evaluate(() => !!document.getElementById('allow').textContent), 'its button');
    ok(await fa.locator('#allow').textContent() === `Allow ${A}`, `its one button says "Allow ${A}"`);
    ok(!fetched.some((u) => u.includes(A)), 'nothing was fetched from the file server before the grant');
    const marker = await sw.evaluate((k) => chrome.storage.session.get(k).then((r) => r[k]), `allow https://${A}/*`);
    ok(marker && !marker.kind, 'the worker noted it as a feature\'s ask (its grant is not taken for a school)');
    await until(() => page.evaluate(() => document.querySelector('.gz-dl-allow')?.getBoundingClientRect().width > 40), 'the frame fitted to its button');
    await hover(73);
    await shot('download-1-allow-frame');
    await stub(fa);
    const downloaded = page.waitForEvent('download', { timeout: 15000 });
    await fa.locator('#allow').click();
    const calls = await until(() => fa.evaluate(() => __gz.calls.length && __gz.calls), 'the request');
    ok(JSON.stringify(calls) === JSON.stringify([[[`https://${A}/*`], true]]), `the click asks for https://${A}/* alone, inside the click (${JSON.stringify(calls)})`);
    await grant(A);
    await fa.evaluate(() => __gz.answer(true));
    const d = await downloaded;
    const zip = fs.readFileSync(await d.path());
    ok(d.suggestedFilename().endsWith('.zip') && zip.includes(Buffer.from('notes.pdf')) && zip.includes(Buffer.from(FILES[73].body)), `the zip completes with notes.pdf (${d.suggestedFilename()}, ${zip.length} bytes)`);
    ok(await until(async () => /^Saved 1 file/.test(await label(73)), 'saved label'), `the panel says "${await label(73)}"`);
    ok(!allowFrame() && await page.locator('.gz-dl-allow').count() === 0, 'the frame is gone');
    await hover(73);
    await shot('download-2-saved');

    // 2. Refused: the panel's existing error, nothing fetched from C.
    await pause(6500); // the finished job's label clears after 6 s
    await hover(74);
    await page.click('#gz-dl-74');
    const fc = await until(async () => allowFrame(), 'the Allow frame for C');
    ok(fc.url().endsWith(`#${C}`), `a second host gets its own frame (${C})`);
    await until(() => fc.evaluate(() => !!document.getElementById('allow').textContent), 'its button');
    await stub(fc);
    await fc.locator('#allow').click();
    await until(() => fc.evaluate(() => __gz.calls.length), 'the request for C');
    await fc.evaluate(() => __gz.answer(false));
    ok(await until(async () => (await label(74)) === 'Download failed', 'failed label'), 'refused: the download stops with the panel\'s error, "Download failed"');
    ok(!fetched.some((u) => u.includes(C)), 'and nothing is fetched from that host');
    await hover(74);
    await shot('download-3-refused');

    // 3. A redirect from A (granted) to B, a host Glaze doesn't hold.
    await hover(75);
    await page.click('#gz-dl-75');
    const end = await until(async () => { const t = await label(75); return /Download failed|Saved|failed/.test(t) || allowFrame() ? t || 'frame' : null; }, 'the redirect file');
    const asked = allowFrame();
    console.log(`redirect ${A} → ${B}: ${asked ? `the frame asks for ${asked.url().split('#')[1]}` : `no frame for ${B}; the panel says "${end}"`}; requests: ${fetched.filter((u) => /redirect|cdn-b/.test(u)).join(', ')}`);
    // An extension's fetch never sees where a redirect goes (redirect: 'manual' gives an opaque answer with no Location), so the
    // worker can't name B to ask for it: the file fails with the panel's error. (Here A's grant is the check's stand-in, so
    // the 302 itself is a CORS answer too; with a real grant for A, B answers on CORS alone.)
    ok(!asked && end === 'Download failed', `a redirect to a host Glaze lacks: not asked for (the worker can't see it); the file fails ("${end}")`);
    await hover(75);
    await shot('download-4-redirect');
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`${checks} checks passed; screenshots in ${out}`);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(path.join(tmp, 'profile'), { recursive: true, force: true });
  }
})();
