// Glaze Writer wears the Look in the real unpacked extension, on the synthetic assignment attempt (test/fixtures/
// ultra-writer-attempt.html): on a solid Look the paper chrome is the mockup's (ground, surface, opaque); on a Look with a
// background the ground is the page's (the wallpaper shows) and the bars and side panel are the page's glass. The
// Submission heading stays a pill its text's width. The paper's caret is drawn the text's height. Screenshots of each Look at
// 1440px.
// GETs only, synthetic; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-look-check.js [screenshot directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test';
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create', DISCUSSION = '/ultra/courses/_101_1/discussion/_9_1';
const shots = process.argv[2] || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-look');
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const checks = [], errors = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// The Looks: Frost as the mockups draw it, Frost on a gradient wallpaper with glass, the same with the owner's lower surface
// opacity, and the light Paper preset on a wallpaper.
const WALL = { kind: 'gradient', colors: ['#1e3a8a', '#0ea5e9', '#312e81'], style: 'linear', angle: 135, dim: 30 };
const LOOKS = [
  { name: 'solid', preset: 'Frost', bg: { kind: 'solid' }, look: {} },
  { name: 'wallpaper', preset: 'Frost', bg: WALL, look: { glass: 12 } },
  { name: 'wallpaper-45', preset: 'Frost', bg: WALL, look: { glass: 12, surfaceOpacity: 45 } },
  { name: 'light-wallpaper', preset: 'Paper', bg: WALL, look: { glass: 12 } },
];

(async () => {
  let context, held = false, tmp;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-look-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-look-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-look-'));
    fs.mkdirSync(shots, { recursive: true });
    const ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (req.isNavigationRequest() && [ATTEMPT, DISCUSSION].includes(u.pathname)) return r.fulfill({ contentType: 'text/html', body: fixture(u.pathname === ATTEMPT ? 'ultra-writer-attempt.html' : 'ultra-writer-discussion.html').replace('<head>', '<head><base href="/ultra/">') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(u.pathname.endsWith('/users/me') ? { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' } : { results: [] }) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    await worker.evaluate(async (site) => { await chrome.storage.local.set({ ultra: [site] }); }, site);
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();

    for (const L of LOOKS) {
      const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: L.preset, colors: G.GZ_PRESETS?.find?.(([n]) => n === L.preset)?.[1], bg: { ...G.GZ_DEFAULTS.bg, ...L.bg }, look: { ...G.GZ_DEFAULTS.look, ...L.look },
        enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
      await worker.evaluate(async ({ settings }) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(settings); }, { settings });
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`${L.name}: ${e.message}`));
      await p.goto(`${site}${ATTEMPT}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, `${L.name}: paper frame shown`);
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0), `${L.name}: pages drawn`);
      await pause(500);
      // Each part's own fill's alpha (0 transparent, 1 opaque), and whether the page paints a background.
      // A computed colour as [r, g, b, a] in 0–255 and 0–1 (Chrome writes a color-mix() as color(srgb …)).
      const rgba = (c) => { const m = c.match(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/); if (!m) return null; const v = (m[1] || m[2]).split(/[ ,/]+/).filter(Boolean).map(Number); return [...v.slice(0, 3).map((x) => Math.round(m[2] ? x * 255 : x)), v.length > 3 ? v[3] : 1]; };
      const alpha = (c) => rgba(c)?.[3] ?? null;
      const fills = await fr.evaluate(() => Object.fromEntries(['body', '.gp', '.gp-top', '.gp-tool', '.gp-canvas', '.gp-side', '.gp-status'].map((s) => [s, getComputedStyle(document.querySelector(s)).backgroundColor])));
      const a = Object.fromEntries(Object.entries(fills).map(([k, v]) => [k, alpha(v)]));
      const painted = await p.evaluate(() => { const k = document.documentElement.getAttribute('data-gz-bg'); return !!k && k !== 'solid'; });
      const host = await el.evaluate((f) => { const cs = getComputedStyle(f); return { radius: parseFloat(cs.borderTopLeftRadius), blur: cs.backdropFilter }; });
      const pill = await p.evaluate(() => { const h = document.querySelector('[class*="makeStylessubmission-"] > h2'), r = h.getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(h); return { w: r.width, text: t.getBoundingClientRect().width }; });
      console.log(L.name, JSON.stringify({ fills, painted, host, pill }));
      if (!painted) {
        check(['.gp', '.gp-tool', '.gp-side', '.gp-status'].every((k) => a[k] === 1), `${L.name}: the chrome is opaque on a solid Look, as the mockup`);
        if (L.preset === 'Frost') check(String(rgba(fills['.gp'])) === '6,13,24,1' && ['.gp-tool', '.gp-side', '.gp-status'].every((k) => String(rgba(fills[k])) === '13,27,46,1'), `${L.name}: Frost's ground and surface, as the mockup`);
        check(host.blur === 'none', `${L.name}: nothing to blur behind the frame on a solid background`);
      } else {
        check(['.gp', '.gp-top'].every((k) => a[k] === 0 || a[k] === null) && a['body'] === 0, `${L.name}: the ground is the page's (the wallpaper shows)`);
        check(['.gp-tool', '.gp-side', '.gp-status'].every((k) => a[k] > 0 && a[k] < 1), `${L.name}: the bars and side panel are the Look's glass`);
        check(/blur/.test(host.blur), `${L.name}: the frame blurs what is behind it`);
      }
      check(host.radius > 0, `${L.name}: the frame has the Look's corners`);
      // The title bar's quiet text: the mockup's faint ink on a ground, muted over a picture.
      const quiet = await fr.evaluate(() => { const c = (v) => { const x = document.createElement('i'); x.style.color = `var(${v})`; document.body.append(x); const r = getComputedStyle(x).color; x.remove(); return r; }; return { state: getComputedStyle(document.querySelector('.gp-top .gp-state')).color, faint: c('--gz-ink-faint'), muted: c('--gz-ink-muted') }; });
      check(quiet.state === (painted ? quiet.muted : quiet.faint), `${L.name}: the title bar's status is ${painted ? 'muted over the picture' : 'faint, as the mockup'}`);
      check(pill.w < pill.text + 80, `${L.name}: the Submission heading is a pill its text's width (${Math.round(pill.w)}px)`);
      await p.screenshot({ path: path.join(shots, `look-${L.name}.png`) });
      // The heading in a column that stretches its children (the fixture's is a block; Ultra's layout may change).
      const stretched = await p.evaluate(() => { const h = document.querySelector('[class*="makeStylessubmission-"] > h2'); Object.assign(h.parentElement.style, { display: 'flex', flexDirection: 'column' }); const w = h.getBoundingClientRect().width; h.parentElement.style.display = ''; return w; });
      check(stretched < pill.text + 80, `${L.name}: the Submission pill keeps its width in a flex column (${Math.round(stretched)}px)`);
      // Focus: over the page's dim, the ground and panels are opaque and the frame square.
      await fr.click('.gp-tbtn[aria-pressed]');
      await until(() => el.evaluate((f) => getComputedStyle(f).position === 'fixed'), `${L.name}: Focus fills the window`);
      await pause(300);
      const focus = await fr.evaluate(() => ['.gp', '.gp-tool', '.gp-side'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor));
      const focusHost = await el.evaluate((f) => parseFloat(getComputedStyle(f).borderTopLeftRadius));
      check(focus.every((c) => alpha(c) === 1) && focusHost === 0, `${L.name}: Focus is opaque and square (${focus.join(', ')})`);
      check(await fr.evaluate(() => getComputedStyle(document.querySelector('.gp-top .gp-state')).color) === quiet.faint, `${L.name}: Focus keeps the mockup's faint status`);
      await p.screenshot({ path: path.join(shots, `look-${L.name}-focus.png`) });
      await fr.click('.gp-tbtn[aria-pressed]');
      await until(() => el.evaluate((f) => getComputedStyle(f).position !== 'fixed'), `${L.name}: Focus ends`);
      if (L.name === 'solid') {
        // The caret: Safari draws the browser's from the line above's text to this line's, a whole line on double spacing,
        // so the paper hides it and draws its own the text's height, at ProseMirror's cursor.
        await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let end = 0; v.state.doc.descendants((n, pos) => { if (n.isTextblock && n.textContent.length > 20 && !end) end = pos + n.nodeSize - 1; }); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, end))); v.focus(); });
        await p.keyboard.type(' The river keeps what the town will not say, and the clearing keeps what the river cannot carry away from it', { delay: 2 });
        const at = async () => { await pause(120); return fr.evaluate(() => {
          const v = GZ_WRITER_PAPER.current().editor.view, c = document.querySelector('.gp-cursor'), k = v.coordsAtPos(v.state.selection.head, 1), r = c.getBoundingClientRect();
          const block = v.domAtPos(v.state.selection.head).node, el = block.nodeType === 1 ? block : block.parentElement, para = el.closest('p'), first = para.getClientRects()[0];
          return { shown: !c.hidden && getComputedStyle(c).display !== 'none', top: r.top, left: r.left + r.width / 2, height: r.height, want: { top: k.top, left: k.left, height: k.bottom - k.top }, line: parseFloat(getComputedStyle(para).lineHeight) * (v.dom.getBoundingClientRect().height / v.dom.offsetHeight), laterLine: k.top > first.top + 4, native: getComputedStyle(v.dom).caretColor, blinking: c.getAnimations().some((x) => x.playState === 'running') };
        }); };
        let c = await at();
        console.log('caret', JSON.stringify(c));
        check(c.native === 'rgba(0, 0, 0, 0)', 'the browser\'s caret is hidden on the paper');
        check(c.shown && c.laterLine && Math.abs(c.top - c.want.top) < 1 && Math.abs(c.left - c.want.left) < 1.5 && Math.abs(c.height - c.want.height) < 1, 'the drawn caret is at the cursor, on a later line of a paragraph');
        check(c.height < c.line * 0.65, `the drawn caret is the text's height, not the double-spaced line's (${c.height.toFixed(1)} of ${c.line.toFixed(1)}px)`);
        check(c.blinking, 'the drawn caret blinks');
        await fr.evaluate(() => GZ_WRITER_PAPER.current().zoom(1.5));
        c = await at();
        check(c.shown && Math.abs(c.top - c.want.top) < 1 && Math.abs(c.left - c.want.left) < 1.5 && Math.abs(c.height - c.want.height) < 1, 'the drawn caret follows the zoom');
        await fr.evaluate(() => GZ_WRITER_PAPER.current().zoom('fit'));
        await p.keyboard.press('Shift+ArrowLeft');
        check(!(await at()).shown, 'no drawn caret over a selected range');
        await p.keyboard.press('ArrowRight');
        check((await at()).shown, 'the drawn caret is back once the range collapses');
        await fr.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionstart', { data: '' })));
        c = await at();
        check(!c.shown && await fr.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror')).caretColor) === 'rgb(17, 17, 17)', 'while an input method composes, the browser\'s caret is back and the drawn one hidden');
        await fr.evaluate(() => document.querySelector('.ProseMirror').dispatchEvent(new CompositionEvent('compositionend', { data: '' })));
        check((await at()).shown, 'the drawn caret is back after composing');
        await fr.click('.gp-tab#gp-tab-outline');
        check(!(await at()).shown, 'no drawn caret once the paper loses focus');
        await fr.click('.gp-tab#gp-tab-checks');
        await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.focus());
        check((await at()).shown, 'the drawn caret is back with focus');
        await p.screenshot({ path: path.join(shots, 'caret.png'), caret: 'initial' });
      }
      await p.close();

      // A discussion's compose box: the Look's glass panel, its corners and blur.
      const d = await context.newPage();
      d.on('pageerror', (e) => errors.push(`${L.name} discussion: ${e.message}`));
      await d.goto(`${site}${DISCUSSION}`);
      const box = await until(async () => { const x = await d.$('iframe.gz-writer:not([data-gz-writer-frame="assignment"])'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && x; }, `${L.name}: compose frame shown`);
      const bf = await until(() => box.contentFrame(), 'compose document');
      await until(() => bf.evaluate(() => !!document.querySelector('.gw .ProseMirror')), `${L.name}: compose editor`);
      await pause(400);
      // As Ultra's own editor boxes on the page (theme.css): the surface at the Look's surface opacity, unblurred.
      const gw = rgba(await bf.evaluate(() => getComputedStyle(document.querySelector('.gw')).backgroundColor));
      const native = rgba(await d.evaluate(() => { const x = document.createElement('div'); x.style.background = 'var(--gz-surface-fill)'; document.querySelector('#site-wrap').append(x); const c = getComputedStyle(x).backgroundColor; x.remove(); return c; }));
      const cHost = await box.evaluate((f) => { const cs = getComputedStyle(f); return { radius: parseFloat(cs.borderTopLeftRadius), blur: cs.backdropFilter }; });
      check(String(gw) === String(native) && cHost.blur === 'none', `${L.name}: the compose box is the surface of Ultra's editor boxes (${gw})`);
      check(cHost.radius > 0, `${L.name}: the compose frame has the Look's corners`);
      await box.scrollIntoViewIfNeeded();
      await d.screenshot({ path: path.join(shots, `look-${L.name}-compose.png`) });
      await d.close();
    }
    assert.deepEqual(errors, [], `page errors:\n${errors.join('\n')}`);
    console.log(`\nwriter-look-check: ${checks.length} checks passed; screenshots in ${shots}`);
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
