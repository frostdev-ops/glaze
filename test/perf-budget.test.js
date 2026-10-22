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
// Navigation opt-outs refresh installed parts: 11 bytes in content.js's storage-key matcher (owner-approved budget raise).
const NAV_LAYOUT_REFRESH = 11;
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
// Moodle navigation: the shared content.js first-paint words and lazy adapter/renderer hooks add 1026 bytes on
// every site against 8f3085b0. Moodle has no initial site part; all data, panels and observation remain on demand.
const NAVBAR = { ultra: 414 + 677 + 1026, canvas: 414 + 1026, moodle: 414 + 1026 };
// Canvas course tabs' first paint (the owner approved raising first-script budgets, 2026-10-19): content-canvas.js writes
// data-gz-ctabs from this browser tab's last strip before the first paint, as content-ultra.js does, so canvas.css holds the
// strip's exact room (570 bytes on Canvas), with content.js's hook for it (34 on every site). Measured against 54c0fdba.
const CANVAS_TABS = { ultra: 34, canvas: 570, moodle: 34 };
// Hidden modules on Canvas (owner-approved raise, 2026-10-19): content-canvas.js's hook that loads features/folders.js where a
// course lists its modules, and who is signed in for its key (594 bytes on Canvas). The feature itself loads on demand.
// Measured against 14b9cc71.
const HIDE_MODULES = { ultra: 0, canvas: 594, moodle: 0 };
// Load audit: early course-tab themes, bounded sweeps and storage guards (+253 shared bytes), plus the 60 s
// course/color snapshot and mutation-scoped color lifts (+1340 Canvas). Existing headroom covers the rest;
// raise only enough for the excess over each site's budget.
const LOAD_AUDIT = { ultra: 246, canvas: 1201, moodle: 0 };
// Dashboard audit: response headers add 35 shared bytes; bounded course pagination, shared identity and progress
// expiry/retry add 1659 Canvas bytes. Raise only the excess after existing headroom and the 2% allowance.
const DASH_AUDIT = { ultra: 34, canvas: 1660, moodle: 0 };
// Review of the audits: draft cleanup where storage has no key listing (once a day, all sites), and Canvas's course
// snapshot bound to the account Canvas names on each page. Raise only the excess, as above.
const AUDIT_REVIEW = { ultra: 258, canvas: 329, moodle: 234 };
// The sidebar's switch (owner-approved raise, 2026-10-19): defaults.js's enhance.sidebar, 107 bytes on every site. The
// sidebar's state, its worker writes and everything else load on demand. Measured against 7860886e.
const SIDEBAR = { ultra: 107, canvas: 107, moodle: 107 };
// The sidebar on Canvas (owner-approved raise, 2026-10-19): content.js's stylesheet for it (features/sidebar.css, 24 bytes on
// every site) and content-canvas.js's hook that loads features/sidebar.js on the top page, with Better To Do and the widgets
// following it (683 bytes on Canvas). The sidebar, its layout and the dock load on demand. Measured against 3fdb8735.
const SIDEBAR_UI = { ultra: 24, canvas: 24 + 683, moodle: 24 };
// The sidebar broker's account reader reuses each site's cached identity (owner-approved raise). Measured against
// af936dcf: content.js's GZ_CTX.account adds 97 shared bytes; identity checks and their deadline stay in the worker.
const SIDEBAR_ACCOUNT = { ultra: 97, canvas: 97, moodle: 97 };
// The sidebar on Blackboard Ultra (owner-approved raise, 2026-10-19): content-ultra.js's hook that loads features/sidebar.js
// on the top page, with Better To Do and the widgets following it (503 bytes on Ultra). The Ultra adapter, the Courses
// page's board without its column and the dock load on demand. Measured against c1c01563.
const SIDEBAR_ULTRA = { ultra: 503, canvas: 0, moodle: 0 };
// The sidebar in course tabs' frames (owner-approved raise, 2026-10-19): content-ultra.js's and content-canvas.js's hooks
// also load it in a tab's frame, with only the dock's widgets there (238 bytes on Ultra, 128 on Canvas). Which document
// works it, the relay through the page around the frame and pausing the others load on demand. Measured against b6dd6f62.
const SIDEBAR_FRAMES = { ultra: 238, canvas: 128, moodle: 0 };
// The sidebar's settings (owner-approved raise, 2026-10-19; Phase 6 settings, 2026-10-20): defaults.js's synced sidebar group
// with its two rules (a typed title, the page kinds), 1915 bytes on every site, and each site part's per-site switch in its
// hook (39 bytes on Ultra, 40 on Canvas). The style, layout and appearance they set apply on demand. Measured against 7769ec18.
const SIDEBAR_SETTINGS = { ultra: 1915 + 39, canvas: 1915 + 40, moodle: 1915 };
// Fresh defaults (owner-approved first-script hooks, 2026-10-20): read the local install flag alongside sync settings,
// and use Notes/Pet defaults only while their switches are absent. Nothing is uploaded before sync arrives.
// Measured against 86fdc1ee: defaults.js and content.js only; the layout and migration remain lazy.
const FRESH_DEFAULTS = 631;
// Contrast roles (owner-approved raise, 2026-10-21): defaults.js's contrast pairs gain the roles theme.css gives the muted
// and faint inks, errors and the bright accent on the tint, so the editor flags a custom palette that fails them, and course
// tint moves the bright accent until it reads on the tint: 693 bytes on every site, raised by the excess over each budget.
// Measured against c14b035.
const CONTRAST_ROLES = { ultra: 510, canvas: 605, moodle: 671 };
// Ultra with Glaze off (WP-C1; the owner's audit-fix allowance, 2026-10-21): content.js takes content-ultra.js's early sheets
// off when the first decision is off, waits for storage before the sweep on Ultra too, and keeps only first paint's settings
// in the page's sessionStorage and skips off-state draft maintenance (982 bytes on every site); content-ultra.js starts
// widgets and sidebar once settings are in, including concurrent layout changes (230 on Ultra). Measured against a7e4bc9.
const ULTRA_OFF = { ultra: 982 + 230, canvas: 982, moodle: 982 };
// Four-digit en-US years (WP-G1; the owner's audit-fix allowance, 2026-10-21): lib/page.js's DATE and DUE take the year as
// (\d{4}|\d{2})(?!\d), so "10/25/2026, 11:59 PM" keeps its year and its time: 12 bytes on every site. Measured against 0035441.
const EN_US_YEARS = 12;
// Dark documents (WP-D1; owner's audit-fix allowance): merge docPages into stored enhance, ignoring late reads from
// earlier clicks. content.js adds 242 bytes on Ultra, Canvas and Moodle, measured against 6abefdc.
const DOC_PAGES = 242;
// Look offers (WP-T2; the owner's audit-fix allowance): lib/i18n.js's English plural forms for the offer's three counted
// sentences (the parts a Look hides, fades and restyles), 577 bytes on every site; the offer itself is the editor's.
// Measured against 9371c51.
const LOOK_OFFER = 577;
// LMS consent (WP-C2, owner decision 2026-10-21, from the 10 KB allowance across the audit fixes): content.js's wait for the
// student's yes on an Ultra site off Blackboard's own hosts and its due list kept per site (827 bytes on every site), and
// content-ultra.js's course records kept per site with their own gate (148 on Ultra). The question itself (features/
// consent.js) loads on demand. Measured against a7e4bc9.
// Review against 28b5425: detected-kind consent gating and default-port early-sheet guard included.
const LMS_CONSENT = { ultra: 1146, canvas: 898, moodle: 898 };
// Ultra's own Sign Out (WP-U1; the owner's audit-fix allowance, 2026-10-22): content-ultra.js's page-transition click handler
// leaves native fragment actions and logout route/query links alone, so course tabs see the trusted click and forget their
// pictures: 243 bytes on Ultra. Measured against immutable package base c1bdd3e.
const ULTRA_SIGNOUT = { ultra: 243, canvas: 0, moodle: 0 };
// LMS request discipline (WP-A1; the owner's audit-fix allowance): content-ultra.js's failure gates for /users/me and each
// gradebook (a minute, a 401 until the page changes), the hook that reads gradebooks and paged course contents through
// lib/ultra.js and the site's queue, on-screen cards only, and the check that keeps an incomplete or pre-paging read from
// calling old items new (1,350 bytes on Ultra). Canvas's Link-following list reads shrink its part (-55, not counted);
// the queue (lib/lmsq.js) loads on demand. Measured against 7bf3623.
// Review versus immutable f8dc85a: liveness/auth/member failure guards and incomplete Canvas-list checks included.
const LMS_REQUESTS = { ultra: 1769, canvas: 201, moodle: 0 };
// Shortcut roles and IME (WP-N2; the owner's audit-fix allowance): content.js's keyOn skips menus, menubars, lists, grids, trees and
// comboboxes across composed event paths, preserves queued IME flags and ignores Safari keyCode 229: 365 bytes/site. Canvas's
// frame word also distinguishes course Hide from a disabled menu (+8 bytes). Measured against immutable WP-N2 base f8dc85a.
const NAV_KEYS = 365;
const NAV_FRAME_HIDE = { ultra: 0, canvas: 8, moodle: 0 };
// English plurals (WP-B4; the owner's audit-fix allowance, 2026-10-21): lib/i18n.js's EN table gains the singular and plural
// forms of ten counted sentences ("1 font", "Changes 1 animation."), so English never shows "1 fonts": 1,183 bytes on every
// site. Measured against f61431b.
// Review preserves plural target cards in the singular style description (+4 bytes versus implementation).
const EN_PLURALS = 1187;
// Background startup recovery (owner-approved raise, 2026-10-19): content.js's scene startup waits at most 10 s for the
// worker's answer with lib/scene-host.js, asks again through its retries, still starts on an answer that comes late (a
// course tab's frame stayed on the gradient while a reply never came), tries again once the page is back on screen, and
// starts a scene whose WebGL context the browser took back again on a new canvas: 1456 bytes on every site. Measured
// against 74ac1e12.
const SCENE_RECOVERY = 1456;
// Ultra's and Canvas's first scripts are the manifest's; Moodle's is what lib/background.js registers for a Moodle host:
// Canvas's without its part.
const entry = (pattern) => m.content_scripts.find((c) => c.matches.includes(pattern)).js;
const FIRST_SCRIPT = { ultra: entry('https://*/ultra'), canvas: entry('https://*.instructure.com/*'), moodle: entry('https://*.instructure.com/*').filter((f) => f !== 'content-canvas.js') };

for (const [site, files] of Object.entries(FIRST_SCRIPT)) {
  test(`the first content script on ${site} stays within its budget`, () => {
    const total = files.reduce((n, f) => n + size(f), 0);
    const baseline = FIRST_SCRIPT_BASELINE[site] + LOOK_PARTS.reduce((n, p) => n + p[site], 0) + CODE_MODS[site] + NAV_LAYOUT_REFRESH + MEDIA_BG[site] + NAVBAR[site] + CANVAS_TABS[site] + HIDE_MODULES[site] + LOAD_AUDIT[site] + DASH_AUDIT[site] + AUDIT_REVIEW[site] + SIDEBAR[site] + SIDEBAR_ACCOUNT[site] + SIDEBAR_UI[site] + SIDEBAR_ULTRA[site] + SIDEBAR_FRAMES[site] + SIDEBAR_SETTINGS[site] + FRESH_DEFAULTS + CONTRAST_ROLES[site] + ULTRA_OFF[site] + EN_US_YEARS + LOOK_OFFER + LMS_CONSENT[site] + ULTRA_SIGNOUT[site] + LMS_REQUESTS[site] + DOC_PAGES + NAV_KEYS + NAV_FRAME_HIDE[site] + EN_PLURALS + SCENE_RECOVERY, budget = Math.round(baseline * 1.02);
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
  ['features/coursemenu.js', 'getComputedStyle(g)', 1], // WP-N2: only the focused roving group, once per horizontal arrow key
  ['features/navbar.js', 'getComputedStyle(e)', 1], // WP-N2: only the old opener and same-id bar copies, on panel close/reposition
  ['features/docreview.js', 'getComputedStyle(el)', 1], // only the viewer's ancestors on entry and while focused; reject fixed-position traps

  ['features/mods.js', 'getComputedStyle(x.canvas)', 1], // one mounted mod canvas per slot while checking whether its Worker should pause
  ['features/navbar-canvas.js', 'getComputedStyle(el)', 1], // school logo background, one header mark per replacement
  ['features/coursetabs.js', 'getComputedStyle(parent.document.documentElement)', 1], // a Canvas tab's frame: the bar's two room variables on the page around, when the bar or the window changes
  ['features/sidebar.js', 'getComputedStyle(html())', 1], // the root's navigation offsets in a batched sidebar layout pass
  ['features/sidebar.js', 'getComputedStyle(x)', 1], // only the drawer's focusable controls, on Tab or a focus escape
  ['features/sidebar.js', 'getComputedStyle(node)', 1], // one exact overview or Rubric and at most 30 ancestors at projection start; Rubric overflow checks stop at 400 descendants
  // Three bounded sites in a batched layout pass: known course tool panels, known header ancestors (hidden routes),
  // and the native discussion host's ancestors up to its nearest scroller. No descendant or whole-page style sweep.
  ['features/sidebar.js', 'getComputedStyle(p)', 3],
  ['features/sidebar.js', 'getComputedStyle(m)', 1], // Ultra: the page's one content element's start padding (Glaze's bar), when the sidebar is laid out
  ['features/sidebar.js', 'getComputedStyle(panel.grid)', 1], // one verified assessment overview grid, to identify Ultra's current native sidebar shell
  ['features/widgets.js', 'getComputedStyle(html)', 1], // the root's two room variables for Glaze's bar, when floating tiles are placed
  // WP-T2: only where a Look's colour rule meets Glaze settings: the root's palette, Glaze's item, and that part's ancestors
  // up to the first solid background.
  ['features/rules.js', 'getComputedStyle(el)', 1],

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
const ULTRA_SHEETS = ['features/coursetabs.css', 'theme.css', 'extras.css', 'motion.css', 'features/apps.css', 'features/surfaces.css', 'features/rules.css', 'features/navlayout.css', 'features/sidebar.css'];
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
