// Performance budget (W0). What every Ultra, Canvas and Moodle page pays for, checked statically, so a change can't
// quietly grow it: the size of each site's first content script, the size of the detector every other https page runs, no fast
// timers, and no new whole-page sweeps.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../manifest.json');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const size = (f) => fs.statSync(path.join(root, f)).size;

// A ratchet per site: the measured size plus about 2%. W0 measured 457,988 bytes in 14 files; W0b moved the five
// translation files, lib/zip.js and lib/drafts.js to on-demand loading (lib/background.js 'glaze:load'): 290,457 bytes in
// 7, under the plan's 300 KB. Wave 1 and 2 hooks took it to 295,451; W0c moved the palette, the keys, the course menu's
// popover, the folder previews and Download all to features/*.js: 248,536. Wave 2 and W12 hooks took it to 253,374; W0d
// moved the draft backup, Ultra's what-if calculator, the document buttons and your place in a course: 223,687. Waves 3
// and 4 took the one script every site loaded to 228,144; B0b split it into the shared content.js and each site's own
// part (content-ultra.js, content-canvas.js; Moodle has none), so each site has its own first script and its own
// baseline. New features load on demand too. When a cut lands, lower that site's baseline to its new total. B7 (the
// owner's Ultra dashboard, floating widgets and nav rework) may grow Ultra's, by the owner's decision: raised from 206,952
// for it (216,000, then 221,000 for B7c's nav at first paint and B8's tabs), and lowered to what B7 and B8 actually
// measure once they land.
// Ultra resets to the measured c30814e release total. B11 surface hooks fit its existing 2% allowance;
// pet/editor code stays lazy. Moodle resets its stale 171,507 baseline to the measured 172,222-byte release;
// the course-surface correction keeps the complete change within release + 2%. Canvas retains its original baseline.
// Look parts (mods phase 1) add hooks to content.js, by the owner's decision (2026-10-16): LMS rules 427 bytes on every
// site; the nav layout (x.nav) 525 on Ultra, 545 on Canvas and 488 on Moodle; and the Look's parts themselves (package A)
// 794 on every site: GZ_CTX.parts(), the check for a Look that has parts, the preview hand-over and two more values of
// defaults.js's bg.kind. Everything else about them loads on demand (lib/lookparts.js, features/lookparts.js).
const FIRST_SCRIPT_BASELINE = { ultra: 225195 + 427 + 525 + 794, canvas: 201446 + 427 + 545 + 794, moodle: 172222 + 427 + 488 + 794 };
// Look parts put small hooks in the first script; the owner approved raising the baseline for them
// (2026-10-16). One line per package, the bytes it added: the motion package's moment emitter ('glaze:moment', the
// completion and new-grade call sites) and the hook that loads features/motionx.js when a Look has animations, effects or a
// pointer effect.
// Measured against 56c6aaf, including the review fixes and each site's emitter call sites.
// The scene package's: starting lib/scene.js for a shader or layers Look once the parts are in, and remembering what a device
// could not draw (syncScene), including the pending-load eligibility recheck: 1,178 bytes on every site. Measured against 316b924.
const LOOK_PARTS = [{ ultra: 1955, canvas: 2035, moodle: 1947 }, { ultra: 1178, canvas: 1178, moodle: 1178 }];
// Code mods (mods phase 2, package S), by the owner's decision: the loader that asks the worker for mods
// that are on and only then loads features/mods.js, and asks again when they or Glaze's switch change: at most 732 bytes on every
// site. Measured against 9a54ae1; re-reading the list after loading saves 6 bytes.
// API v1 (package A2): the mods' Look parts over the student's in GZ_CTX.parts(), a mod's background in the scene's place,
// the sweep's call to the mods (cards, the nav) and a replaced completion effect: 439 bytes on every site, measured
// against aa2ed9f.
// Declarative widgets (mods-widgets package): the same loader also starts features/modwidgets.js on every browser, since it
// no longer waits for the manifest's sandbox: 256 bytes on every site. Measured against 3e613b9.
// Installed mods' Look parts (mods-parts package): loading features/lookparts.js when mods are installed, re-reading on a
// change to them, their order or the blocklist, and a mod's background kind in the scene: 125 bytes on every site.
// Measured against eb00d4dd.
const CODE_MODS = { ultra: 732 + 439 + 256 + 125, canvas: 732 + 439 + 256 + 125, moodle: 732 + 439 + 256 + 125 };
// Media backgrounds (mods phase 4), raised by what they add, as the Look parts' hooks were: the scene sync picks lib/scene-media.js
// instead of lib/scene.js for a video or animation (the module's name, its element and the check that the right one is running)
// and defaults.js's bg.kind has 'media': 479 bytes on every site. Measured against 795dfd5. The player, Lottie and the file
// handling all load on demand.
// Mod background visibility: repaint CSS from the effective kind when parts change, 59 bytes against 1d0c9b43.
const MEDIA_BG = { ultra: 479 + 59, canvas: 479 + 59, moodle: 479 + 59 };
// Glaze's own navigation bar (owner decisions 2026-10-19: it replaces each site's nav from first paint, on by default, with a
// rail or top bar, floating or embedded, its own state inside a course and the course tabs in it): defaults.js's navbar
// settings on every site (414 bytes), and on Ultra the words theme.css reserves the bar's room from and the hook that loads
// features/navbar.js (677). The bar itself, its model and its sheet load on demand. Measured against 21a5d51c.
const NAVBAR = { ultra: 414 + 677, canvas: 414, moodle: 414 };
// Ultra's and Canvas's first scripts are the manifest's; Moodle's is what lib/background.js registers for a Moodle host:
// Canvas's without its part.
const entry = (pattern) => m.content_scripts.find((c) => c.matches.includes(pattern)).js;
const FIRST_SCRIPT = { ultra: entry('https://*/ultra'), canvas: entry('https://*.instructure.com/*'), moodle: entry('https://*.instructure.com/*').filter((f) => f !== 'content-canvas.js') };

for (const [site, files] of Object.entries(FIRST_SCRIPT)) {
  test(`the first content script on ${site} stays within its budget`, () => {
    const total = files.reduce((n, f) => n + size(f), 0);
    const baseline = FIRST_SCRIPT_BASELINE[site] + LOOK_PARTS.reduce((n, p) => n + p[site], 0) + CODE_MODS[site] + MEDIA_BG[site] + NAVBAR[site], budget = Math.round(baseline * 1.02);
    assert.ok(total <= budget, `${site}: ${total} bytes in ${files.length} files: over the budget of ${budget} (${baseline} + 2%). Load new code on demand instead, or put what only one site does in its part.`);
  });
}

test('each site loads the shared core and its own part, and no other site\'s', () => {
  const core = FIRST_SCRIPT.moodle;
  assert.equal(core.at(-1), 'content.js');
  assert.ok(!core.some((f) => /^content-/.test(f)), 'Moodle has no part');
  assert.deepEqual(FIRST_SCRIPT.ultra, [...core.slice(0, -1), 'lib/nav.js', 'content-ultra.js', 'content.js']);
  assert.deepEqual(FIRST_SCRIPT.canvas, [...core.slice(0, -1), 'content-canvas.js', 'content.js']);
});

test('the detector that runs on every other https page stays under 2 KB', () => {
  assert.ok(m.content_scripts.some((c) => c.js.length === 1 && c.js[0] === 'lib/detect.js'));
  assert.ok(size('lib/detect.js') < 2048, `lib/detect.js is ${size('lib/detect.js')} bytes`);
});

// ---- runtime work, read from the source -------------------------------------------------------------------------
// Every first-party script Glaze ships, at any depth (features/, lib/, i18n/ and the root), whether it is in the
// first content script, loaded on demand or in the extension's pages. Not the vendored three.js or OCR engine, nor the tools,
// tests and app wrappers around the extension, nor the share relay (server/), which runs on a server.
const NOT_SHIPPED = new Set(['scripts', 'test', 'safari', 'store', 'assets', 'dist', 'release', 'node_modules', 'docs', 'server']);
const VENDORED = new Set(['lib/three.min.js', 'lib/tesseract/tesseract-core-simd-lstm.js', 'lib/lottie/lottie_light_canvas.min.js']); // pdf.js is .mjs, not scanned
const shipped = (dir = '') => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = dir ? `${dir}/${e.name}` : e.name;
  if (e.name.startsWith('.')) return [];
  if (e.isDirectory()) return dir || !NOT_SHIPPED.has(e.name) ? shipped(rel) : [];
  return e.name.endsWith('.js') && !VENDORED.has(rel) ? [rel] : [];
});
const CODE = shipped();

// Source without its comments: /* … */ blocks, and // to the end of a line where // starts a comment (not https://).
const executable = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}()])\/\/[^\n]*/gm, '$1');
// Calls of `name`, however written: f(…), f (…), f/* … */(…), f // …⏎(…), f?.(…), f?./* … */(…), obj.f(…), obj['f'](…), split over
// lines. Comments don't count. Each comes back as `name(args)` with its whitespace and comments squeezed out, so an
// allowlist names the exact call. Out of reach: a renamed alias (const si = setInterval) and .call/.apply; review
// catches those.
const calls = (name, src) => {
  const out = [];
  const head = new RegExp(`(?:(?<![\\w$])${name}|\\[\\s*(['"\`])${name}\\1\\s*\\])\\s*(?:(?:\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)\\s*)*(?:\\?\\.\\s*(?:(?:\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*)\\s*)*)?\\(`, 'g');
  for (const hit of src.matchAll(head)) {
    const before = src.slice(0, hit.index);
    const line = before.slice(before.lastIndexOf('\n') + 1);
    if (/(^|[\s;{}()])\/\//.test(line) || /^\s*\*/.test(line)) continue; // a line comment, or inside a /** block's lines
    if (before.search(/(^|\s)\/\*(?![\s\S]*\*\/)/) !== -1) continue; // inside an unclosed /* block
    let depth = 0, j = hit.index + hit[0].length - 1;
    for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')' && --depth === 0) break; }
    const args = executable(src.slice(hit.index + hit[0].length, j)).replace(/\s+/g, ' ').trim();
    out.push({ call: `${name}(${args})`, args, at: before.split('\n').length });
  }
  return out;
};
const found = (names, keep = () => true) => CODE.flatMap((file) => {
  const src = read(file);
  return names.flatMap((n) => calls(n, src)).filter(keep).map((c) => ({ file, ...c }));
});
const lastArg = (args) => {
  let depth = 0, cut = 0;
  for (let i = 0; i < args.length; i++) {
    if ('([{'.includes(args[i])) depth++;
    else if (')]}'.includes(args[i])) depth--;
    else if (args[i] === ',' && depth === 0) cut = i + 1;
  }
  return args.slice(cut).trim();
};
// Each reviewed call by file and exact text, with how many times it appears: one more of the same, or one fewer, fails.
const review = (list, seen, what) => {
  const count = new Map();
  for (const c of seen) count.set(`${c.file} ${c.call}`, (count.get(`${c.file} ${c.call}`) || 0) + 1);
  const want = new Map(list.map(([file, call, n]) => [`${file} ${call}`, n]));
  for (const c of seen) {
    const k = `${c.file} ${c.call}`;
    assert.ok(want.has(k), `${c.file}:${c.at} ${c.call}\n  ${what}`);
  }
  for (const [k, n] of want) assert.equal(count.get(k) || 0, n, `${k}: reviewed as ${n} call(s), found ${count.get(k) || 0}; update the list with the change`);
};

// Timers that fire faster than once a minute, each reviewed: bounded in time, and the clear that ends it must stay.
const FAST_INTERVALS = [
  // Download all: a 15 s keep-alive to the service worker only while a zip streams; cleared when its port closes.
  ['features/download.js', "setInterval(() => { if (!closed) post({ type: 'ping' }); }, 15000)", 1, /\bclearInterval\s*\(\s*ping\s*\)/],
];

test('no setInterval fires faster than once a minute unless it is reviewed, and its clear is still there', () => {
  const fast = found(['setInterval'], (c) => {
    const delay = lastArg(c.args);
    return !(/^[\d_\s*]+$/.test(delay) && delay.split('*').reduce((n, x) => n * Number(x.replace(/_/g, '')), 1) >= 60000);
  });
  review(FAST_INTERVALS, fast, 'fires under a minute (or its delay is not a literal). Use a timeout to the next event, or add it to FAST_INTERVALS with why it is bounded.');
  for (const [file, call, , clear] of FAST_INTERVALS) assert.match(executable(read(file)), clear, `${file}: the clear that bounds ${call} is gone (a comment doesn't count)`);
});

// Reading styles or every element: each site is bounded (one element, its ancestors, or the documented first pass).
const STYLE_READS = [
  // The long-tail sweep (content.js, "long tail"): the first pass reads every element once, capped at MAX_FULL; later
  // passes only the subtrees the mutation observer reports. Its own colour reads, and an InstUI icon's.
  ['content.js', "querySelectorAll('*')", 2],
  ['content.js', 'getComputedStyle(e)', 2],
  ['content.js', 'getComputedStyle(p)', 1], // a highlight's fill above an element
  ['content-ultra.js', 'getComputedStyle(p)', 1], // a course slot's probe
  ['features/docs.js', 'getComputedStyle(p)', 1], // the scroller above the document in focus mode
  ['features/petworld.js', 'getComputedStyle(n)', 1], // at most 30 ancestors when a pet/toy acquires a content anchor; never in the scroll handler
  ['features/place.js', 'getComputedStyle(p)', 1], // the scroller above a course's outline or Modules list
  ['features/coursetabs.js', 'getComputedStyle(p)', 1], // the scroller above the course tabs, once a tab switch lands
  ['features/coursetabs.js', 'getComputedStyle(list)', 1], // the tab strip's direction, once per arrow key
  ['features/insights.js', 'getComputedStyle(box)', 1], // Insights' dialog, once per saved picture, for its colors
  ['content.js', 'getComputedStyle(document.documentElement)', 1], // the palette's ink, once per highlighted element
  // One element, on its first hover or focus; one element under the pointer, to see if its text is cut short.
  ['content.js', 'getComputedStyle(el)', 2],
];

test('no new whole-page style reads or element sweeps beyond the reviewed ones', () => {
  const sweeps = found(['getComputedStyle', 'querySelectorAll', 'getElementsByTagName'], (c) => !/^(querySelectorAll|getElementsByTagName)/.test(c.call) || /^(['"`])\*\1$/.test(c.args));
  review(STYLE_READS, sweeps, 'reads computed styles or every element. Keep it to one element or its ancestors and add it to STYLE_READS with why it is bounded; dark-mode gaps it would fix belong in canvas.css.');
});

test('the scans see the code they are meant to', () => {
  assert.ok(CODE.includes('content.js') && CODE.includes('content-ultra.js') && CODE.includes('content-canvas.js') && CODE.includes('lib/background.js') && CODE.includes('i18n/de.js') && !CODE.includes('lib/three.min.js'));
  assert.ok(!CODE.some((f) => f.startsWith('scripts/') || f.startsWith('test/') || f.startsWith('safari/')));
  // The forms a change might use, each caught.
  const forms = ['setInterval(f, 10)', 'setInterval (f, 10)', 'setInterval/* x */(f, 10)', 'window.setInterval(f, 10)', "window['setInterval'](f, 10)",
    'globalThis[ "setInterval" ](f, 10)', 'setInterval(\n  f,\n  10\n)', 'setInterval // why\n(f, 10)', 'globalThis.setInterval?.(f, 10)',
    "window['setInterval']?.(f, 10)", 'setInterval?.\n(f, 10)', 'globalThis.setInterval?. /* why */ (f, 10)'];
  for (const f of forms) assert.deepEqual(calls('setInterval', f).map((c) => c.call), ['setInterval(f, 10)'], f);
  for (const f of ['// setInterval(f, 10)', '/* setInterval(f, 10) */', 'mySetInterval(f, 10)', 'setIntervalX(f, 10)']) assert.deepEqual(calls('setInterval', f), [], f);
  assert.deepEqual(calls('getComputedStyle', 'x = getComputedStyle\n(el).color').map((c) => c.call), ['getComputedStyle(el)']);
  assert.deepEqual(calls('getComputedStyle', 'x = el && getComputedStyle?.(el)').map((c) => c.call), ['getComputedStyle(el)']);
  // A clear that is only a comment doesn't bound anything.
  const clear = FAST_INTERVALS[0][3];
  assert.match(executable('if (closed) { clearInterval(ping); }'), clear);
  for (const gone of ['/* clearInterval(ping); */ closed = true;', '// clearInterval(ping);\nclosed = true;', '/*\n * clearInterval(ping)\n */']) assert.doesNotMatch(executable(gone), clear, gone);
});

// ---- :has() on Ultra ----------------------------------------------------------------------------------------------
// Chrome flags every element a :has() is tried on, and checks the flagged ancestors of anything that changes whose
// features appear inside any :has() (a class test there: every class Ultra changes); a flagged ancestor holding a :has()
// before a combinator restyles its descendants by one invalidation set shared by all such rules. A :has() tried on any
// element (body's, or a bare div's) before a combinator, with a class test in some :has(), made every MUI ripple restyle
// the whole page (measured: 95 ms of style per press on a 9,400-element outline; 0.2 ms without those rules). Ultra's sheets:
// no class tests or descendant `*` in a :has(), and a :has() before a combinator sits on a class, id or attribute, or a tag
// that is not a page container.
const ULTRA_SHEETS = ['features/coursetabs.css', 'theme.css', 'extras.css', 'motion.css', 'features/apps.css', 'features/surfaces.css', 'features/rules.css', 'features/navlayout.css'];
// The containers a page is built of: flagged, one may hold the whole page.
const BROAD = new Set(['', '*', 'html', 'body', 'div', 'span', 'section', 'main']);
const hasRules = (css) => {
  css = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
  const out = [];
  for (let i = css.indexOf(':has('); i !== -1; i = css.indexOf(':has(', i + 5)) {
    let depth = 0, j = i + 4;
    for (; j < css.length; j++) { if (css[j] === '(') depth++; else if (css[j] === ')' && --depth === 0) break; }
    const arg = css.slice(i + 5, j).trim();
    // The compound it is on: back to the last combinator outside parentheses.
    let k = i - 1;
    for (depth = 0; k >= 0; k--) { const c = css[k]; if (c === ')') depth++; else if (c === '(') { if (!depth) break; depth--; } else if (!depth && /[\s>+~,{}]/.test(c)) break; }
    const compound = css.slice(k + 1, i);
    // Before a combinator: what follows it in the same complex selector (up to a comma, a brace or the parenthesis around it).
    let m = j + 1, rest = '';
    for (depth = 0; m < css.length; m++) { const c = css[m]; if (c === '(') depth++; else if (c === ')') { if (!depth) break; depth--; } else if (!depth && /[,{]/.test(c)) break; rest += depth ? '' : c; }
    const line = css.slice(0, i).split('\n').length;
    out.push({ arg, compound, nonSubject: /^\s*[>+~]|\s\S/.test(rest.replace(/::?[\w-]+(\([^)]*\))?/g, '').trimEnd()), line });
  }
  return out;
};
test('Ultra\'s :has() rules keep a small change from restyling the whole page', () => {
  for (const f of ULTRA_SHEETS) for (const h of hasRules(read(f))) {
    // A class test down a child chain (`> x > y[class*=…]`) is checked a fixed number of levels up: no walk up the page.
    const parts = h.arg.split(/,(?![^(]*\))/).map((x) => x.trim()).filter((x) => /\[class\s*[*^$~|]?=/.test(x) && !/^>\s*[^\s>+~]+(\s*>\s*[^\s>+~]+)*$/.test(x));
    assert.ok(!parts.length, `${f}:${h.line} :has(${h.arg}): a class test inside :has() makes every class change check it`);
    assert.ok(!/(^|[\s(,])\*(?=[\s),]|$)/.test(h.arg.replace(/^>\s*\*$/, '')), `${f}:${h.line} :has(${h.arg}): a descendant * makes every added node check it; :has(> *) only checks its parent`);
    if (!h.nonSubject) continue;
    const anchor = h.compound.replace(/:(is|where|not)\([^)]*\)/g, '');
    assert.ok(/[.#[]/.test(anchor) || !BROAD.has(anchor.trim().toLowerCase()), `${f}:${h.line} ${h.compound}:has(${h.arg}) before a combinator is tried on every ${anchor.trim() || 'element'}`);
  }
});
