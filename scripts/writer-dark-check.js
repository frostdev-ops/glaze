// Glaze Writer's dark page in the real unpacked extension: papers.html opens one synthetic paper (headings, coloured runs,
// every highlighter under plain, black and white text, a link, a table, a footnote and a page break) in the student's
// light and dark palettes (auto light and dark following the system), with Settings → Writer → Light page off and on, at
// 1280 and 640 px. It reads the colours the page draws (canvas-resolved, so oklch() and color-mix() count), checks the
// pages lay out the same in every scheme, that print's copy stays white with the source colours, that the palette follows
// the system live and the ⋯ menu's Light page saves, and that a light page in a dark Look draws the sheet pixel for pixel
// as BASE (default c8e99a04, from git archive) did. Local extension pages only; no network.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-dark-check.js [screenshot directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const S = require('../lib/writer-schema.js');
const G = require('../defaults.js');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-writer-dark-check'));
const BASE = process.env.BASE || 'c8e99a04';
const KEY = 'bb.school.test|_900_1|_101_1|_7_1';
const checks = [], errors = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// The paper, as the paper schema holds it.
const HL = Object.keys(S.HIGHLIGHT);
const HTML = [
  '<h1>Dark page check</h1>',
  '<p>Plain ink, <span data-gz-color="000000">black run</span>, <span data-gz-color="FFFFFF">white run</span>, <span data-gz-color="FF0000">red run</span>, <span data-gz-color="000080">navy run</span>, <a href="https://example.com/">a link</a>.<sup class="gz-footnote" data-footnote="A footnote on the first page."></sup></p>',
  ...HL.map((n) => `<p><span data-gz-highlight="${n}">${n} plain</span> <span data-gz-highlight="${n}"><span data-gz-color="000000">${n} black</span></span> <span data-gz-highlight="${n}"><span data-gz-color="FFFFFF">${n} white</span></span></p>`),
  '<table><tbody><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr><tr><td><p>Cell C</p></td><td><p>Cell D</p></td></tr></tbody></table>',
  '<hr class="gz-page-break">',
  '<h2>After the break</h2>',
  '<p>The second page.</p>',
].join('');
const DOC = S.parse(S.paper, HTML, { document: true }).toJSON();

// What the page draws, as sRGB bytes: each colour string resolved through a canvas (so oklch() and color-mix() resolve too).
const READ = () => {
  const g = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)]; };
  const cs = (el) => getComputedStyle(el);
  const zoom = document.querySelector('.gp-zoom'), sheet = zoom.querySelector('.gp-sheet'), pm = zoom.querySelector('.gp-flow .ProseMirror');
  const run = (hex) => pm.querySelector(`[data-gz-color="${hex}"]`);
  // A highlight's band and the text on it: its own colour run inside, or the band's inherited ink.
  const bands = [...pm.querySelectorAll('p')].filter((p) => p.querySelector('[data-gz-highlight]')).map((p) => {
    const [plain, black, white] = p.querySelectorAll('[data-gz-highlight]');
    const ink = (band) => rgb(cs(band.querySelector('[data-gz-color]') || band).color);
    return { name: plain.dataset.gzHighlight, bg: rgb(cs(plain).backgroundColor), plain: ink(plain), black: ink(black), white: ink(white) };
  });
  const td = pm.querySelector('td');
  return {
    dark: document.documentElement.hasAttribute('data-dark'), lightPage: document.documentElement.hasAttribute('data-light-page'),
    sheet: rgb(cs(sheet).backgroundColor), ink: rgb(cs(pm).color),
    black: rgb(cs(run('000000')).color), white: rgb(cs(run('FFFFFF')).color), red: rgb(cs(run('FF0000')).color), navy: rgb(cs(run('000080')).color),
    link: rgb(cs(pm.querySelector('a')).color), border: rgb(cs(td).borderTopColor), note: rgb(cs(zoom.querySelector('.gp-notes')).color),
    // The caret drawn beside the pages (.gp-cursor, outside .gp-zoom): the sheet's ink there too (0bc2d482).
    caret: rgb(cs(document.querySelector('.gp-size > .gp-cursor')).backgroundColor),
    bands,
    // The layout: pages, each page's top, the text's height (colours must not move a line).
    layout: { pages: zoom.querySelectorAll('.gp-sheet').length, tops: [...zoom.querySelectorAll('.gp-sheet')].map((s) => s.style.top), height: pm.offsetHeight },
  };
};

(async () => {
  let context, held = false, tmp, base;
  const lock = require('./check-env.js').lockPath(), ext = [];
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-dark-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-dark-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-dark-'));
    fs.mkdirSync(out, { recursive: true });
    fs.rmSync(path.join(out, 'failure.txt'), { force: true });

    // One browser on one staged extension at a time; it seeds the palette and the paper, and opens papers.html.
    const launch = async (src, tag) => {
      const dir = env.staged(src, []);
      ext.push(dir);
      await require('./wait-for-browser.js')();
      context = await chromium.launchPersistentContext(path.join(tmp, `profile-${tag}`), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 1,
        args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
      env.noFirstRun(context); context.setDefaultTimeout(15000);
      await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).host;
      const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', auto: { on: true, mode: 'device', light: 'Paper', dark: 'Frost' },
        enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true }, writer: { proofing: false, ruler: true } });
      await worker.evaluate(async ({ settings, KEY, DOC }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
        await chrome.storage.local.set({ [`writerPaper:${KEY}`]: { key: KEY, doc: DOC, title: 'Dark page check', format: 'mla9', updated: Date.now(), revision: 1 },
          writerPapers: [{ key: KEY, title: 'Dark page check', course: 'ENGL 2110', url: '', words: 120, format: 'mla9', updated: Date.now(), submitted: null }] });
      }, { settings, KEY, DOC });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
      const setWriter = (patch) => worker.evaluate(async (patch) => { const w = (await chrome.storage.sync.get('writer')).writer || {}; await chrome.storage.sync.set({ writer: { ...w, ...patch } }); }, patch);
      const open = async (width, scheme) => {
        await page.setViewportSize({ width, height: width < 800 ? 1400 : 1800 });
        await page.emulateMedia({ colorScheme: scheme, media: 'screen' });
        await page.goto(`chrome-extension://${id}/papers.html?paper=${encodeURIComponent(KEY)}`);
        await until(() => page.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current?.()?.key() && document.querySelectorAll('.gp-zoom .gp-sheet').length > 0 && document.querySelector('.gp-zoom > .gp-flow')?.style.visibility !== 'hidden'), `${tag} paper laid out`);
        await page.evaluate(async () => { await document.fonts.ready; document.activeElement?.blur?.(); });
        // The drawn caret blinks; nothing else on the page moves.
        await page.evaluate(() => { const s = new CSSStyleSheet(); s.replaceSync('.gp-cursor { display: none !important; }'); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; });
        await pause(400);
      };
      const sheetShot = async (file) => {
        const box = await page.evaluate(() => { const r = document.querySelector('.gp-zoom .gp-sheet').getBoundingClientRect(); return { x: r.x + 2, y: r.y + 2, width: Math.min(r.width, innerWidth - r.x) - 4, height: Math.min(r.height, innerHeight - r.y) - 4 }; });
        return page.screenshot({ path: path.join(out, file), clip: box });
      };
      return { page, worker, setWriter, open, sheetShot, id };
    };

    // ---- the change: every scheme × Light page × width
    const B = await launch(root, 'new');
    const layouts = {};
    let compare = null;
    for (const width of [1280, 640]) {
      for (const scheme of ['light', 'dark']) {
        for (const lightPage of [false, true]) {
          await B.setWriter({ lightPage });
          await B.open(width, scheme);
          const name = `${width}-${scheme}-${lightPage ? 'lightpage' : 'page'}`;
          await until(() => B.page.evaluate((want) => document.documentElement.hasAttribute('data-dark') === want, scheme === 'dark'), `${name} data-dark follows the palette`);
          const r = await B.page.evaluate(READ);
          fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(r, null, 1));
          await B.page.screenshot({ path: path.join(out, `${name}.png`) });
          (layouts[width] ||= []).push([name, JSON.stringify(r.layout)]);
          check(r.lightPage === lightPage, `${name}: data-light-page follows writer.lightPage`);
          const darkPage = scheme === 'dark' && !lightPage;
          if (darkPage) {
            check(r.sheet.join() === '30,30,30', `${name}: the sheet is the dark page (${r.sheet})`);
            check(r.caret.join() === '230,230,230' && r.caret.join() === r.ink.join(), `${name}: the drawn caret is the dark page's light ink (${r.caret})`);
            check(lum(r.black) > 0.5, `${name}: black-marked text is light (luminance ${lum(r.black).toFixed(3)})`);
            check(r.white.join() === '255,255,255', `${name}: white-marked text is unchanged (${r.white})`);
            for (const k of ['ink', 'red', 'navy', 'link', 'note']) check(ratio(r[k], r.sheet) >= 4.5, `${name}: ${k} reads on the page (${ratio(r[k], r.sheet).toFixed(2)}:1, ${r[k]})`);
            check(ratio(r.border, r.sheet) >= 1.8, `${name}: table borders show (${ratio(r.border, r.sheet).toFixed(2)}:1)`);
            const blackBand = r.bands.find((b) => b.name === 'black');
            check(ratio(blackBand.bg, r.sheet) >= 1.5, `${name}: black highlight differs from the sheet (${ratio(blackBand.bg, r.sheet).toFixed(2)}:1, ${blackBand.bg})`);
            for (const b of r.bands) for (const k of ['plain', 'black', 'white']) check(ratio(b[k], b.bg) >= 4.5, `${name}: ${b.name} band, ${k} text ${ratio(b[k], b.bg).toFixed(2)}:1 (${b[k]} on ${b.bg})`);
          } else {
            check(r.sheet.join() === '255,255,255', `${name}: the sheet is white`);
            check(r.caret.join() === '17,17,17', `${name}: the drawn caret is the white page's ink (${r.caret})`);
            check(r.black.join() === '0,0,0' && r.white.join() === '255,255,255' && r.red.join() === '255,0,0' && r.navy.join() === '0,0,128', `${name}: runs draw their own colours`);
            check(r.ink.join() === '17,17,17' && r.link.join() === '5,99,193' && r.border.join() === '17,17,17', `${name}: ink, link and borders as before (${r.ink} ${r.link} ${r.border})`);
            check(r.bands.every((b) => b.bg.join() === S.HIGHLIGHT[b.name].match(/\w\w/g).map((x) => parseInt(x, 16)).join()), `${name}: every highlight draws its own colour`);
          }
          // ⋯ shows Light page only on a dark Look.
          await B.page.click('.gp-more');
          const items = await B.page.$$eval('.gp-menu [role^="menuitem"]', (els) => els.map((e) => [e.firstChild?.textContent || e.textContent, e.getAttribute('aria-checked')]));
          await B.page.keyboard.press('Escape');
          await B.page.mouse.click(5, 5);
          const item = items.find(([l]) => l === 'Light page');
          check(scheme === 'dark' ? item && item[1] === String(lightPage) : !item, `${name}: ⋯ ${scheme === 'dark' ? `has Light page, ${lightPage ? 'checked' : 'unchecked'}` : 'has no Light page'}`);
          if (width === 1280 && scheme === 'dark' && lightPage) { await B.sheetShot('compare-new.png'); compare = true; }
        }
      }
      check(new Set(layouts[width].map(([, l]) => l)).size === 1, `${width}: the pages lay out the same in every scheme (${layouts[width][0][1]})`);
    }

    // ---- live: the system's mode, the ⋯ toggle, print
    await B.setWriter({ lightPage: false });
    await B.open(1280, 'dark');
    await B.page.emulateMedia({ colorScheme: 'light' });
    await until(() => B.page.evaluate(() => !document.documentElement.hasAttribute('data-dark')), 'papers.html follows the system to light');
    check(true, 'papers.html follows the system\'s mode live (dark → light)');
    await B.page.emulateMedia({ colorScheme: 'dark' });
    await until(() => B.page.evaluate(() => document.documentElement.hasAttribute('data-dark')), 'papers.html follows the system to dark');
    check(true, 'papers.html follows the system\'s mode live (light → dark)');
    await B.page.click('.gp-more');
    await B.page.click('.gp-menu [role^="menuitem"]:has-text("Light page")');
    await until(async () => (await B.worker.evaluate(async () => (await chrome.storage.sync.get('writer')).writer?.lightPage)) === true && await B.page.evaluate(() => document.documentElement.hasAttribute('data-light-page')), '⋯ Light page saves');
    check(true, '⋯ → Light page turns the page white and saves writer.lightPage');
    await B.setWriter({ lightPage: false });
    await until(() => B.page.evaluate(() => !document.documentElement.hasAttribute('data-light-page')), 'Light page follows storage');
    check(true, 'the page follows writer.lightPage changed elsewhere (Settings)');
    // Exercise the shipped colour fallback, with the relative-colour @supports branch removed.
    const removed = await B.page.evaluate(() => {
      let n = 0;
      const drop = (sheet) => {
        for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
          const r = sheet.cssRules[i];
          if (r.conditionText?.includes('oklch')) { sheet.deleteRule(i); n++; }
          else if (r.cssRules) drop(r);
        }
      };
      drop([...document.styleSheets].find((s) => s.href?.endsWith('/writer-paper.css')));
      return n;
    });
    check(removed === 1, 'the relative-colour branch is removed for the fallback check');
    const fallback = await B.page.evaluate(READ);
    for (const k of ['ink', 'black', 'white', 'red', 'navy', 'link']) check(ratio(fallback[k], fallback.sheet) >= 4.5, `fallback: ${k} reads on the page (${ratio(fallback[k], fallback.sheet).toFixed(2)}:1)`);
    for (const b of fallback.bands) for (const k of ['plain', 'black', 'white']) check(ratio(b[k], b.bg) >= 4.5, `fallback: ${b.name} band, ${k} text ${ratio(b[k], b.bg).toFixed(2)}:1`);
    await B.page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    await B.page.emulateMedia({ media: 'print', colorScheme: 'dark' });
    const printed = await B.page.evaluate(() => {
      const g = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data.slice(0, 3)].join(); };
      const p = document.querySelector('.gp-print');
      return p && { sheet: rgb(getComputedStyle(p.querySelector('.gp-sheet')).backgroundColor), ink: rgb(getComputedStyle(p.querySelector('.ProseMirror')).color),
        black: rgb(getComputedStyle(p.querySelector('[data-gz-color="000000"]')).color), yellow: rgb(getComputedStyle(p.querySelector('[data-gz-highlight="yellow"]')).backgroundColor) };
    });
    check(printed && printed.sheet === '255,255,255' && printed.ink === '17,17,17' && printed.black === '0,0,0' && printed.yellow === '255,255,0', `print's copy on a dark Look is white with the source colours (${JSON.stringify(printed)})`);
    await B.page.screenshot({ path: path.join(out, 'print-dark-look.png') });
    await B.page.emulateMedia({ media: 'screen' });
    await B.page.evaluate(() => dispatchEvent(new Event('afterprint')));
    await context.close(); context = null;

    // ---- BASE: its papers.html was always dark with a white page, which a dark Look with Light page now draws
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-dark-base-'));
    execFileSync('/bin/sh', ['-c', `git -C "$1" archive "$2" | tar -x -C "$3"`, 'sh', root, BASE, base]);
    const A = await launch(base, 'base');
    await A.open(1280, 'dark');
    await A.sheetShot('compare-base.png');
    const diff = await A.page.evaluate(async ([a, b]) => {
      const img = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height); };
      const [x, y] = await Promise.all([img(a), img(b)]);
      if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
      let n = 0; for (let i = 0; i < x.data.length; i += 4) if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++;
      return { pixels: x.width * x.height, differ: n };
    }, ['compare-base.png', 'compare-new.png'].map((f) => `data:image/png;base64,${fs.readFileSync(path.join(out, f)).toString('base64')}`));
    check(diff.differ === 0, `a light page in a dark Look matches ${BASE}'s page pixel for pixel (${JSON.stringify(diff)})`);
    await context.close(); context = null;

    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    console.log(JSON.stringify({ checks: checks.length, shots: out }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (base) fs.rmSync(base, { recursive: true, force: true });
    for (const d of ext) fs.rmSync(d, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
