// Performance budget (W0). What every Ultra, Canvas and Moodle page pays for, checked statically, so a change can't
// quietly grow it: the size of each site's first content script, the size of the detector every other https page runs, no fast
// timers, and no new whole-page sweeps. The runtime numbers (time to themed, no light frame) are in parity/spikes/W0-perf.md.
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
// for it, and lowered to what B7 actually measures once it lands.
const FIRST_SCRIPT_BASELINE = { ultra: 216000, canvas: 201446, moodle: 171507 };
// Ultra's and Canvas's first scripts are the manifest's; Moodle's is what lib/background.js registers for a Moodle host:
// Canvas's without its part.
const entry = (pattern) => m.content_scripts.find((c) => c.matches.includes(pattern)).js;
const FIRST_SCRIPT = { ultra: entry('https://*/ultra'), canvas: entry('https://*.instructure.com/*'), moodle: entry('https://*.instructure.com/*').filter((f) => f !== 'content-canvas.js') };

for (const [site, files] of Object.entries(FIRST_SCRIPT)) {
  test(`the first content script on ${site} stays within its budget`, () => {
    const total = files.reduce((n, f) => n + size(f), 0);
    const budget = Math.round(FIRST_SCRIPT_BASELINE[site] * 1.02);
    assert.ok(total <= budget, `${site}: ${total} bytes in ${files.length} files: over the budget of ${budget} (${FIRST_SCRIPT_BASELINE[site]} + 2%). Load new code on demand instead, or put what only one site does in its part.`);
  });
}

test('each site loads the shared core and its own part, and no other site\'s', () => {
  const core = FIRST_SCRIPT.moodle;
  assert.equal(core.at(-1), 'content.js');
  assert.ok(!core.some((f) => /^content-/.test(f)), 'Moodle has no part');
  assert.deepEqual(FIRST_SCRIPT.ultra, [...core.slice(0, -1), 'content-ultra.js', 'content.js']);
  assert.deepEqual(FIRST_SCRIPT.canvas, [...core.slice(0, -1), 'content-canvas.js', 'content.js']);
});

test('the detector that runs on every other https page stays under 2 KB', () => {
  assert.ok(m.content_scripts.some((c) => c.js.length === 1 && c.js[0] === 'lib/detect.js'));
  assert.ok(size('lib/detect.js') < 2048, `lib/detect.js is ${size('lib/detect.js')} bytes`);
});

// ---- runtime work, read from the source -------------------------------------------------------------------------
// Every first-party script Glaze ships, at any depth (features/, lib/, i18n/ and the root), whether it is in the
// first content script, loaded on demand or in the extension's pages. Not the vendored three.js or OCR engine, nor the tools,
// tests and app wrappers around the extension.
const NOT_SHIPPED = new Set(['scripts', 'test', 'safari', 'store', 'assets', 'dist', 'release', 'node_modules', 'parity']);
const VENDORED = new Set(['lib/three.min.js', 'lib/tesseract/tesseract-core-simd-lstm.js']); // pdf.js is .mjs, not scanned
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
  // Ultra's hold-and-reveal: polls every 50 ms only while part of a page is held back; release() clears it when none is.
  ['content-ultra.js', 'setInterval(release, 50)', 1, /\bclearInterval\s*\(\s*gateTimer\s*\)/],
  // Download all: a 15 s keep-alive to the service worker only while a zip streams; cleared when its port closes.
  ['features/download.js', "setInterval(() => { if (!closed) port.postMessage({ type: 'ping' }); }, 15000)", 1, /\bclearInterval\s*\(\s*ping\s*\)/],
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
  ['features/place.js', 'getComputedStyle(p)', 1], // the scroller above a course's outline or Modules list
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
  assert.match(executable('if (!held.size) { clearInterval(gateTimer); gateTimer = 0; }'), clear);
  for (const gone of ['/* clearInterval(gateTimer); */ gateTimer = 0;', '// clearInterval(gateTimer);\ngateTimer = 0;', '/*\n * clearInterval(gateTimer)\n */']) assert.doesNotMatch(executable(gone), clear, gone);
});
