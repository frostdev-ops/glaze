// The notes app's pure parts (lib/notes.js): the sanitizer against hostile pastes, Markdown out, the library's changes
// as the worker applies them (two tabs, the trash, files), and the export zip's round trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../lib/notes.js');
const Z = require('../lib/zip.js');
const D = require('../lib/doctext.js');

const S = (html, opts) => N.sanitize(html, opts);
const BASE = 'https://school.instructure.com/courses/7/pages/week-1';
const ALLOWED = new Set(['href', 'title', 'rel', 'target', 'data-gz-file', 'data-gz-kind', 'alt', 'data-check', 'data-done', 'start', 'colspan', 'rowspan']);

test('sanitizer: hostile pastes come out inert', () => {
  const table = [
    ['<script>alert(1)</script>ok', 'ok'],
    ['<SCRIPT SRC=//evil.example/x.js></SCRIPT>ok', 'ok'],
    ['<img src=x onerror=alert(1)>', ''],
    ['<img src="https://evil.example/pixel.gif" onerror="alert(1)">', '<a href="https://evil.example/pixel.gif" rel="noopener noreferrer" target="_blank">pixel.gif</a>'],
    ['<p onclick="alert(1)" style="color:red" class="x" id="y">hi</p>', '<p>hi</p>'],
    ['<a href="javascript:alert(1)">x</a>', 'x'],
    ['<a href="  JaVaScRiPt:alert(1)">x</a>', 'x'],
    ['<a href="java\tscript:alert(1)">x</a>', 'x'],
    ['<a href="java&#x09;script:alert(1)">x</a>', 'x'],
    ['<a href="&#106;avascript:alert(1)">x</a>', 'x'],
    ['<a href="&#106avascript:alert(1)">x</a>', 'x'], // no base: a relative address is dropped
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', 'x'],
    ['<a href="vbscript:msgbox(1)">x</a>', 'x'],
    ['<a href="https://user:pw@evil.example/">x</a>', 'x'],
    ['<iframe src="https://evil.example" srcdoc="<script>alert(1)</script>"></iframe>after', 'after'],
    ['<form action="https://evil.example"><input name=q value=1><button>Go</button>text</form>', 'text'],
    ['<svg><script>alert(1)</script><a xlink:href="javascript:alert(1)">x</a></svg>after', 'after'],
    ['<math><mtext><img src=x onerror=alert(1)></mtext></math>after', 'after'],
    ['<style>@import "https://evil.example/x.css";</style>after', 'after'],
    ['<!--<script>alert(1)</script>-->after', 'after'],
    ['<noscript><p title="</noscript><img src=x onerror=alert(1)>">', '"&gt;'], // read as a scripting browser reads it
    ['<textarea><script>alert(1)</script></textarea>after', 'after'],
    ['<object data="x.swf"><embed src="x.swf"></object>after', 'after'],
    ['<video src=x onerror=alert(1)></video><audio src=x></audio>after', 'after'],
    ['<scr<script>ipt>alert(1)</script>', 'ipt&gt;alert(1)'],
    ['<p>a < b && c > d</p>', '<p>a &lt; b &amp;&amp; c &gt; d</p>'],
    ['<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'],
    ['<a href="https://ok.example/?a=1&b=&quot;2&quot;" title="&quot; onmouseover=&quot;alert(1)">x</a>', '<a href="https://ok.example/?a=1&amp;b=%222%22" title="&quot; onmouseover=&quot;alert(1)" rel="noopener noreferrer" target="_blank">x</a>'],
    ['<img data-gz-file="../../etc/passwd" alt="x">', ''],
    ['<a data-gz-file="not-an-id">x</a>', 'x'],
    ['<base href="https://evil.example/"><a href="/x">x</a>', 'x'],
    ['<meta http-equiv="refresh" content="0;url=https://evil.example">after', 'after'],
    ['<p>unclosed <b>bold', '<p>unclosed <strong>bold</strong></p>'],
    ['<div><div><div>' + '<span>'.repeat(5000) + 'deep', null],
    ['<plaintext><script>alert(1)</script>', ''],
    ['x\u0000y', 'xy'],
  ];
  for (const [input, want] of table) {
    const out = S(input);
    if (want !== null) assert.equal(out, want, input);
    assert.doesNotMatch(out, /<(script|iframe|svg|math|style|form|input|object|embed|textarea|noscript|base|meta)/i, input);
    // Every attribute is one of the allowed ones (a value can't hold a raw quote, so its text can't pose as one).
    for (const [, name] of out.matchAll(/\s([\w:-]+)="/g)) assert.ok(ALLOWED.has(name), `${name} in ${out}`);
    assert.doesNotMatch(out, /href="(?!https?:|mailto:)/i, input);
    assert.equal(S(out), out, `stable: ${input}`);
  }
});

test('sanitizer: formatting is kept, links made absolute and safe, other markup reduced to it', () => {
  assert.equal(S('<h1>A</h1><h4>B</h4><p><b>b</b><i>i</i><u>u</u><strike>s</strike><code>c</code><sub>1</sub><sup>2</sup></p>'),
    '<h1>A</h1><h3>B</h3><p><strong>b</strong><em>i</em><u>u</u><s>s</s><code>c</code><sub>1</sub><sup>2</sup></p>');
  assert.equal(S('<ul data-check><li data-done="true">done</li><li data-done="no">todo</li></ul><ol start="3"><li>x</li></ol>'),
    '<ul data-check="true"><li data-done="true">done</li><li>todo</li></ul><ol start="3"><li>x</li></ol>');
  assert.equal(S('<blockquote>q</blockquote><pre>  code\n    more</pre><hr>'), '<blockquote>q</blockquote><pre>  code\n    more</pre><hr>');
  assert.equal(S('<a href="/courses/7/files/9">Slides</a>', { base: BASE }), '<a href="https://school.instructure.com/courses/7/files/9" rel="noopener noreferrer" target="_blank">Slides</a>');
  assert.equal(S('<a href="mailto:prof@school.edu">mail</a>'), '<a href="mailto:prof@school.edu" rel="noopener noreferrer" target="_blank">mail</a>');
  assert.equal(S('<a href="https://x.example" data-gz-kind="page" target="_top" rel="opener">p</a>'), '<a href="https://x.example/" data-gz-kind="page" rel="noopener noreferrer" target="_blank">p</a>');
  const file = '0b6a1c4e-1f2a-4b3c-9d8e-7f6a5b4c3d2e';
  assert.equal(S(`<img data-gz-file="${file}" alt="graph" src="blob:https://school.instructure.com/abc" width="9999">`), `<img data-gz-file="${file}" alt="graph">`);
  assert.equal(S(`<a data-gz-file="${file}" href="https://evil.example">notes.pdf</a>`), `<a data-gz-file="${file}">notes.pdf</a>`);
  assert.equal(S('<table><tr><th colspan="2">h</th><td rowspan="999">x</td></tr></table>'), '<table><tr><th colspan="2">h</th><td>x</td></tr></table>');
  // Google Docs: the whole paste wrapped in a not-bold <b>, styling in spans.
  assert.equal(S('<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Bold</span> <span style="font-style:italic">it</span> <span style="text-decoration:underline">u</span> <span>plain</span></p></b>'),
    '<p><strong>Bold</strong> <em>it</em> <u>u</u> plain</p>');
  // HTML's own implied ends.
  assert.equal(S('<p>one<p>two<ul><li>a<li>b</ul>'), '<p>one</p><p>two</p><ul><li>a</li><li>b</li></ul>');
  assert.equal(S('<p>a</b>b</p>'), '<p>ab</p>');
});

test('plain text and Markdown out of a note', () => {
  const html = S('<h2>Week 1</h2><p>Cells <strong>divide</strong> and <em>grow</em>.<br>Next line</p><ul data-check><li data-done="true">Read ch. 1</li><li>Lab report</li></ul><ol><li>one</li><li>two</li></ol><blockquote>A quote</blockquote><pre>let x = 1;\n  y()</pre><p><a href="https://school.instructure.com/courses/7/files/9">Slides [1]</a></p>');
  assert.equal(N.text(html), 'Week 1\nCells divide and grow.\nNext line\nRead ch. 1\nLab report\none\ntwo\nA quote\nlet x = 1;\ny()\nSlides [1]');
  assert.equal(N.markdown(html), [
    '## Week 1', '', 'Cells **divide** and *grow*.\\', 'Next line', '', '- [x] Read ch. 1', '- [ ] Lab report', '', '1. one', '2. two', '', '> A quote', '',
    '```', 'let x = 1;', '  y()', '```', '', '[Slides \\[1\\]](<https://school.instructure.com/courses/7/files/9>)'].join('\n'));
  const file = '0b6a1c4e-1f2a-4b3c-9d8e-7f6a5b4c3d2e';
  assert.equal(N.markdown(`<p><img data-gz-file="${file}" alt="cell"></p>`, { path: (id) => (id === file ? '../files/x.png' : null) }), '![cell](<../files/x.png>)');
  assert.equal(N.markdown('<p>a `b` c</p><p><code>x`y</code></p>'), 'a \\`b\\` c\n\n``x`y``');
  assert.equal(N.markdown('<table><tr><th>a|b</th><th>c</th></tr><tr><td>1</td></tr></table>'), '| a\\|b | c |\n| --- | --- |\n| 1 |  |');
});

// ---- the library's changes, as the worker applies them ----------------------------------------------------------
const KEY = 'notesIdx:https://school.instructure.com/5';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const world = () => {
  const store = {}, db = { bodies: new Map(), files: new Map(), blobs: new Map() };
  const local = { get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}), set: async (o) => { Object.assign(store, structuredClone(o)); return true; } };
  const idb = {
    get: async (s, k) => db[s].get(k), put: async (s, k, v) => { db[s].set(k, v); }, del: async (s, ks) => { for (const k of ks) db[s].delete(k); },
    scan: async (s, p) => [...db[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...db[s].keys()].filter((k) => k.startsWith(p)),
    estimate: async () => ({ usage: 1e6, quota: 1e9 }),
  };
  let now = Date.UTC(2026, 9, 1);
  const run = (m, at = now) => N.run({ key: KEY, ...m }, { local }, idb, at);
  // The bodies kept for a note (one per revision until the last one's commit lets the earlier go).
  const bodies = (n) => [...db.bodies.keys()].filter((k) => k.startsWith(`https://school.instructure.com/5/${n}/`));
  return { store, db, local, idb, run, bodies, idx: () => N.clean(store[KEY]), tick: (ms = 1000) => (now += ms), get now() { return now; } };
};

test('two tabs save the same note: the first lands, the second becomes a copy, nothing is lost', async () => {
  const w = world();
  assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>start</p>', title: 'Bio', copy: id(90) }), { ok: true, id: id(1), rev: 1 });
  // Tab A and tab B both opened revision 1, then both typed.
  const a = await w.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>from A</p>', copy: id(91), copyTitle: 'Bio (copy)' });
  const b = await w.run({ op: 'save', id: id(1), base: 1, sid: 'c', html: '<p>from B</p>', copy: id(92), copyTitle: 'Bio (copy)' });
  assert.deepEqual(a, { ok: true, id: id(1), rev: 2 });
  assert.deepEqual(b, { ok: true, id: id(92), rev: 1, conflict: true });
  const idx = w.idx();
  assert.equal(idx.notes[id(1)].rev, 2);
  assert.equal(idx.notes[id(92)].title, 'Bio (copy)');
  assert.equal((await w.run({ op: 'load', id: id(1) })).html, '<p>from A</p>');
  assert.equal((await w.run({ op: 'load', id: id(92) })).html, '<p>from B</p>');
  // A retry of a save that landed (its answer was lost) is recognised, not copied again.
  assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>from A, and more</p>', copy: id(93) }), { ok: true, id: id(1), rev: 2, again: true });
  assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 1, sid: 'c', html: '<p>from B</p>', copy: id(92) }), { ok: true, id: id(92), rev: 1, conflict: true, again: true });
  assert.equal(Object.keys(w.idx().notes).length, 2);
  // The body is sanitized by the worker too, whatever the page sent.
  await w.run({ op: 'save', id: id(1), base: 2, sid: 'd', html: '<p onclick="x()">ok<script>bad()</script></p>', copy: id(94) });
  assert.equal((await w.run({ op: 'load', id: id(1) })).html, '<p>ok</p>');
});

test('loading an oversized stored body fails without exposing an editable shortened copy or changing storage', async () => {
  const w = world();
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>original</p>' });
  const key = w.bodies(id(1))[0];
  const html = '<p>x</p>'.repeat(60000);
  w.db.bodies.set(key, { html });
  const before = structuredClone(w.store);
  const r = await w.run({ op: 'load', id: id(1) });
  assert.deepEqual({ ok: r.ok, error: r.error, hasHtml: 'html' in r }, { ok: false, error: 'big', hasHtml: false });
  assert.deepEqual(w.store, before);
  assert.equal(w.db.bodies.get(key).html.length, html.length);
});

test('backup notes over the raw-input budget remain flagged and counted as skipped', async () => {
  const site = 'https://school.instructure.com';
  const data = N.parseExport({ format: 'glaze-notes', version: 1, site, files: [], folders: [], notes: [
    { id: id(1), html: 'x'.repeat(N.LIMIT.body * 2 + 1) },
    { id: id(2), html: '<p>fine</p>' },
  ] }, { site });
  assert.equal(data.notes.length, 2, 'oversized notes must not disappear from import accounting');
  assert.equal(data.notes[0].big, true);
  assert.deepEqual(await world().run({ op: 'import', notes: data.notes }), { ok: true, done: 1, skipped: 1 });
});

test('saving into a note trashed or deleted for good in another tab keeps the text as a copy', async () => {
  const w = world();
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>x</p>', title: 'T', copy: id(90) });
  await w.run({ op: 'trash', ids: [id(1)] });
  const r = await w.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>typed after</p>', copy: id(91), copyTitle: 'T (copy)' });
  assert.equal(r.conflict, true);
  assert.ok(!w.idx().notes[id(91)].del, 'the copy is in the library, not the trash');
  await w.run({ op: 'purge', ids: [id(1)] });
  assert.deepEqual(w.bodies(id(1)), []);
  // A late save for the note deleted for good: a copy, never the old note back.
  const late = await w.run({ op: 'save', id: id(1), base: 1, sid: 'c', html: '<p>late</p>', copy: id(92) });
  assert.equal(late.id, id(92));
  assert.equal(w.idx().notes[id(1)], undefined);
  // A new note whose id was deleted can't be created over the tombstone either.
  assert.equal((await w.run({ op: 'save', id: id(1), base: 0, sid: 'd', html: '<p>again</p>', copy: id(93) })).id, id(93));
});

test('a failed read fails closed: no write, and a lost body is an error, never an empty note', async () => {
  const w = world();
  const broken = { get: async () => { throw new Error('io'); }, set: async () => { throw new Error('nope'); } };
  assert.deepEqual(await N.run({ key: KEY, op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>x</p>', copy: id(2) }, { local: broken }, w.idb), { ok: false, error: 'read' });
  assert.equal(w.db.bodies.size, 0);
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>x</p>', copy: id(90) });
  w.db.bodies.clear();
  assert.deepEqual(await w.run({ op: 'load', id: id(1) }), { ok: false, error: 'missing' });
  assert.deepEqual(await w.run({ op: 'load', id: id(9) }), { ok: false, error: 'gone' });
  // An index write that fails fails the save; the page tries again from the same base.
  const once = { ...w.local, set: async () => false };
  assert.deepEqual(await N.run({ key: KEY, op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>y</p>', copy: id(91) }, { local: once }, w.idb, w.now), { ok: false, error: 'write' });
  assert.equal((await w.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>y</p>', copy: id(91) })).rev, 2);
  // Only this site's and account's index.
  assert.deepEqual(await N.run({ key: 'notes:https://school.instructure.com/5', op: 'tidy' }, { local: w.local }, w.idb), { ok: false, error: 'bad' });
});

test('the trash: 30 days, restore, Empty trash keeps what was trashed after it was pressed', async () => {
  const w = world();
  for (const n of [1, 2, 3]) await w.run({ op: 'save', id: id(n), base: 0, sid: `s${n}`, html: `<p>${n}</p>`, title: `N${n}`, copy: id(90 + n) });
  await w.run({ op: 'trash', ids: [id(1)] });
  w.tick(5 * 864e5);
  await w.run({ op: 'trash', ids: [id(2)] }, w.now);
  assert.deepEqual(N.list(w.idx(), { trash: true }).map(([k]) => k).sort(), [id(1), id(2)]);
  await w.run({ op: 'restore', ids: [id(2)] }, w.now);
  assert.equal(w.idx().notes[id(2)].del, undefined);
  // Day 31 for note 1: gone, with its body, on the next change of any kind.
  await w.run({ op: 'tidy' }, w.now + 26 * 864e5 + 1);
  assert.equal(w.idx().notes[id(1)], undefined);
  assert.ok(w.idx().gone[id(1)]);
  assert.deepEqual(w.bodies(id(1)), []);
  // Empty trash pressed at t; another tab trashed note 3 just after: it stays.
  const t = w.tick();
  await w.run({ op: 'trash', ids: [id(2)] }, t - 10);
  await w.run({ op: 'trash', ids: [id(3)] }, t + 10);
  await w.run({ op: 'empty', at: t }, t + 20);
  assert.equal(w.idx().notes[id(2)], undefined);
  assert.ok(w.idx().notes[id(3)].del);
});

test('folders: per course, reorder, rename, and deleting one does what the student chose with its notes', async () => {
  const w = world();
  await w.run({ op: 'folder', id: id(10), name: 'Labs', course: '42', cn: 'BIO 1100' });
  await w.run({ op: 'folder', id: id(11), name: 'Essays' });
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>1</p>', title: 'L1', folder: id(10), copy: id(90) });
  await w.run({ op: 'save', id: id(2), base: 0, sid: 'b', html: '<p>2</p>', title: 'E1', folder: id(11), copy: id(91) });
  assert.equal(w.idx().notes[id(1)].course, '42', 'a course folder gives its notes its course');
  assert.equal(w.idx().notes[id(1)].cn, 'BIO 1100');
  await w.run({ op: 'order', ids: [id(11), id(10)] });
  assert.deepEqual(N.folderList(w.idx()).map(([k]) => k), [id(11), id(10)]);
  await w.run({ op: 'folder', id: id(10), name: 'Lab reports' });
  assert.equal(w.idx().folders[id(10)].name, 'Lab reports');
  await w.run({ op: 'folderDel', id: id(10), notes: 'keep' });
  assert.equal(w.idx().notes[id(1)].folder, '');
  assert.ok(!w.idx().notes[id(1)].del);
  await w.run({ op: 'folderDel', id: id(11), notes: 'trash' });
  assert.ok(w.idx().notes[id(2)].del);
  // Restoring the folder brings back the notes that went with it.
  await w.run({ op: 'restore', ids: [id(11)] });
  assert.equal(w.idx().notes[id(2)].del, undefined);
  assert.equal(w.idx().notes[id(2)].folder, id(11));
  assert.deepEqual(await w.run({ op: 'folderDel', id: id(11), notes: 'maybe' }), { ok: false, error: 'bad' });
});

test('rename and move: each field is set only by a change made after its last one', async () => {
  const w = world();
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>1</p>', title: 'First', copy: id(90) }, 100);
  await w.run({ op: 'meta', id: id(1), title: 'Newer', at: 300 }, 400);
  await w.run({ op: 'meta', id: id(1), title: 'Older', course: '9', at: 200 }, 500);
  assert.equal(w.idx().notes[id(1)].title, 'Newer');
  assert.equal(w.idx().notes[id(1)].course, '9', 'a different field from the same late change still lands');
  assert.deepEqual(await w.run({ op: 'meta', id: id(5), title: 'x' }), { ok: false, error: 'gone' });
});

test('rename and move: a time from a clock that ran ahead does not block the changes after it', async () => {
  const w = world();
  const day = 864e5;
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>1</p>', title: 'First', copy: id(90) }, 100);
  // Renamed when the page's clock was a day ahead: stamped no later than the worker's now.
  await w.run({ op: 'meta', id: id(1), title: 'Ahead', at: 100 + day }, 200);
  assert.ok(w.idx().notes[id(1)].ft.title <= 200);
  await w.run({ op: 'meta', id: id(1), title: 'Now', at: 250 }, 300);
  assert.equal(w.idx().notes[id(1)].title, 'Now');
  // A time an earlier version stored ahead of the clock counts as older than any change made since.
  w.store[KEY].notes[id(1)].ft.title = 400 + day;
  await w.run({ op: 'meta', id: id(1), title: 'Healed', at: 450 }, 500);
  assert.equal(w.idx().notes[id(1)].title, 'Healed');
  await w.run({ op: 'save', id: id(2), base: 0, sid: 'b', html: '<p>2</p>', title: 'Second', copy: id(91), at: 600 + day }, 700);
  assert.deepEqual(Object.values(w.idx().notes[id(2)].ft), [700, 700, 700], 'a new note is stamped no later than now either');
});

test('files: pictures by their bytes, sizes capped, unused ones cleared', async () => {
  const w = world();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>x</p>', copy: id(90) });
  assert.deepEqual(await w.run({ op: 'file', id: id(20), kind: 'image', name: 'a.png', data: N.b64(png), note: id(1) }), { ok: true, id: id(20) });
  assert.deepEqual(await w.run({ op: 'file', id: id(21), kind: 'image', name: 'a.png', data: N.b64(svg), note: id(1) }), { ok: false, error: 'type' });
  assert.deepEqual(await w.run({ op: 'file', id: id(22), kind: 'file', name: '../../x.svg', data: N.b64(svg), note: id(1) }), { ok: true, id: id(22) });
  assert.equal(w.db.files.get(`https://school.instructure.com/5/${id(22)}`).type, 'application/octet-stream', 'an attachment is only ever bytes to download');
  assert.equal(w.db.files.get(`https://school.instructure.com/5/${id(22)}`).name, '.._.._x.svg');
  const big = 'A'.repeat(Math.ceil((N.LIMIT.image + 10) / 3) * 4);
  assert.deepEqual(await w.run({ op: 'file', id: id(23), kind: 'image', name: 'b.png', data: big, note: id(1) }), { ok: false, error: 'big' });
  const got = await w.run({ op: 'getFile', id: id(20) });
  assert.deepEqual([...N.unb64(got.data)], [...png]);
  // The picture is used by the note; the attachment isn't, and the note is gone: cleared at once.
  await w.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: `<p><img data-gz-file="${id(20)}"></p>`, copy: id(91) });
  await w.run({ op: 'tidy' });
  assert.ok(w.db.files.has(`https://school.instructure.com/5/${id(20)}`));
  assert.ok(w.db.files.has(`https://school.instructure.com/5/${id(22)}`), 'an unused file of a live note waits a day (undo, a paste not yet saved)');
  await w.run({ op: 'tidy' }, w.now + 2 * 864e5);
  assert.ok(!w.db.files.has(`https://school.instructure.com/5/${id(22)}`) && !w.db.blobs.has(`https://school.instructure.com/5/${id(22)}`));
  // Everything on this device is capped as well.
  w.db.files.set('https://other.instructure.com/1/x', { size: N.LIMIT.total });
  assert.deepEqual(await w.run({ op: 'file', id: id(24), kind: 'image', name: 'c.png', data: N.b64(png), note: id(1) }), { ok: false, error: 'full' });
  const use = await w.run({ op: 'usage' });
  assert.equal(use.quota, 1e9);
  assert.ok(use.mine >= png.length);
});

test('search: titles on the page, text in the worker, accents and case folded', async () => {
  const w = world();
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>Mitose und Meiose</p>', title: 'Zellteilung', copy: id(90) });
  await w.run({ op: 'save', id: id(2), base: 0, sid: 'b', html: '<p>Résumé of the café</p>', title: 'Week 2', copy: id(91) });
  assert.deepEqual((await w.run({ op: 'search', q: 'cafe RESUME' })).ids, [id(2)]);
  const idx = w.idx();
  assert.deepEqual(N.list(idx, { q: 'zell' }).map(([k]) => k), [id(1)]);
  assert.deepEqual(N.list(idx, { q: 'meiose', found: new Set([id(1)]) }).map(([k]) => k), [id(1)]);
  assert.deepEqual(N.list(idx, { sort: 'title' }).map(([, n]) => n.title), ['Week 2', 'Zellteilung']);
});

test('export zip: Markdown plus pictures, and importing it round-trips with nothing executed', async () => {
  const w = world();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const site = 'https://school.instructure.com';
  const notes = [{ id: id(1), title: 'Week 1: cells', folder: id(10), course: '42', created: 1, at: 2, html: S(`<h2>Cells</h2><p><img data-gz-file="${id(20)}" alt="diagram"> <a data-gz-file="${id(21)}">lab.pdf</a></p>`) }];
  const files = [{ id: id(20), kind: 'image', name: 'd.png', type: 'image/png', bytes: png }, { id: id(21), kind: 'file', name: 'lab.pdf', type: 'application/octet-stream', bytes: new Uint8Array([37, 80, 68, 70]) }];
  const entries = N.exportZip({ site, folders: [{ id: id(10), name: 'Bio/Labs', course: '42', order: 0 }], notes, files });
  assert.deepEqual(entries.map((e) => e.name), ['notes.json', 'notes/Bio_Labs/Week 1_ cells.md', `files/${id(20)}.png`, `files/${id(21)}/lab.pdf`]);
  assert.match(new TextDecoder().decode(entries[1].data), new RegExp(`!\\[diagram\\]\\(<\\.\\./\\.\\./files/${id(20)}\\.png>\\)`));
  const bytes = new Uint8Array(await new Blob(Z.zip(entries)).arrayBuffer());
  const z = D.unzip(bytes);
  const back = N.parseExport(await z.text('notes.json'), { site });
  assert.equal(back.notes[0].title, 'Week 1: cells');
  assert.equal(back.notes[0].course, '42');
  assert.equal(back.notes[0].folder, back.folders[0].id);
  const img = back.files.find((f) => f.kind === 'image');
  assert.deepEqual([...await z.bytes(img.path)], [...png]);
  assert.deepEqual([back.notes[0].id, back.folders[0].id, img.id], [id(1), id(10), id(20)], 'notes, folders and files keep their ids');
  assert.ok(back.notes[0].html.includes(`data-gz-file="${img.id}"`));
  // Into an empty library: the same note, folder and text.
  for (const f of back.files) await w.run({ op: 'file', id: f.id, kind: f.kind, name: f.name, data: N.b64(await z.bytes(f.path)), note: back.notes[0].id });
  assert.deepEqual(await w.run({ op: 'import', folders: back.folders, notes: back.notes }), { ok: true, done: 1, skipped: 0 });
  const idx = w.idx();
  assert.equal(idx.folders[back.folders[0].id].name, 'Bio/Labs');
  assert.equal(N.text((await w.run({ op: 'load', id: back.notes[0].id })).html), N.text(notes[0].html));
  // From another site: course links aren't kept. A hostile export: scripts gone, paths outside files/ refused.
  const evil = JSON.stringify({ format: 'glaze-notes', version: 1, site: 'https://evil.example', folders: [], files: [{ id: id(30), kind: 'image', name: 'x', path: '../../x', size: 3 }, { id: id(31), kind: 'image', name: 'y', path: 'files/y', size: 1e9 }],
    notes: [{ id: id(2), title: 'x', course: '42', html: '<p>hi<script>alert(1)</script><img src=x onerror=alert(1)></p>' }] });
  const e = N.parseExport(evil, { site });
  assert.deepEqual(e.files, []);
  assert.equal(e.notes[0].html, '<p>hi</p>');
  assert.equal(e.notes[0].course, '');
  assert.throws(() => N.parseExport('{"format":"other"}', { site }), /not a Glaze notes export/);
});

// ---- Codex W19a review regressions ------------------------------------------------------------------------------
test('a failed save leaves the note as it was: its committed text and revision, and the retry lands', async () => {
  const w = world();
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>committed</p>', title: 'T', copy: id(90) });
  const failing = { get: w.local.get, set: async () => false };
  assert.deepEqual(await N.run({ key: KEY, op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>attempted</p>', copy: id(91) }, { local: failing }, w.idb, w.now), { ok: false, error: 'write' });
  assert.deepEqual(await w.run({ op: 'load', id: id(1) }), { ok: true, html: '<p>committed</p>', rev: 1 }, 'what another tab reads is still revision 1');
  assert.deepEqual((await w.run({ op: 'search', q: 'attempted' })).ids, [], 'search reads committed text only');
  assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>attempted</p>', copy: id(91) }), { ok: true, id: id(1), rev: 2 });
  assert.deepEqual(await w.run({ op: 'load', id: id(1) }), { ok: true, html: '<p>attempted</p>', rev: 2 });
  assert.deepEqual(w.bodies(id(1)), [`https://school.instructure.com/5/${id(1)}/2`], 'the superseded revision goes once the new one is committed');
});

test('clean-up keeps files staged for a note not saved yet (a paste, an import), and drops those of a note deleted for good', async () => {
  const w = world();
  const png = N.b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  // Tab one pastes a picture into a new note; tab two opens Notes (clean-up) before tab one's first save.
  assert.equal((await w.run({ op: 'file', id: id(20), kind: 'image', name: 'a.png', data: png, note: id(1) })).ok, true);
  assert.equal((await w.run({ op: 'tidy' }, w.now + 1)).freed, 0);
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: `<p><img data-gz-file="${id(20)}"></p>`, title: 'T', copy: id(90) }, w.now + 2);
  assert.equal((await w.run({ op: 'getFile', id: id(20) })).ok, true);
  // An import's files go in before its notes.
  assert.equal((await w.run({ op: 'file', id: id(21), kind: 'image', name: 'b.png', data: png, note: id(2) })).ok, true);
  await w.run({ op: 'tidy' }, w.now + 3);
  assert.deepEqual(await w.run({ op: 'import', notes: [{ id: id(2), title: 'I', created: 1, at: 2, html: `<p><img data-gz-file="${id(21)}"></p>` }] }, w.now + 4), { ok: true, done: 1, skipped: 0 });
  assert.equal((await w.run({ op: 'getFile', id: id(21) })).ok, true);
  // Deleted for good: its picture goes at once, not a day later.
  await w.run({ op: 'trash', ids: [id(1)] });
  await w.run({ op: 'purge', ids: [id(1)] });
  assert.equal((await w.run({ op: 'getFile', id: id(20) })).ok, false);
});

test('a permanent deletion whose clean-up failed is finished by the next clean-up', async () => {
  const w = world();
  const png = N.b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  await w.run({ op: 'file', id: id(20), kind: 'image', name: 'a.png', data: png, note: id(1) });
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: `<p>private <img data-gz-file="${id(20)}"></p>`, title: 'T', copy: id(90) });
  await w.run({ op: 'trash', ids: [id(1)] });
  const broken = { ...w.idb, del: async () => { throw new Error('io'); } };
  const r = await N.run({ key: KEY, op: 'purge', ids: [id(1)] }, { local: w.local }, broken, w.now);
  assert.equal(r.ok, true, 'the deletion is committed; the clean-up after it failed');
  assert.equal(w.idx().notes[id(1)], undefined);
  assert.equal(w.bodies(id(1)).length, 1, 'left behind by the failure');
  // Weeks later, after the tombstone has gone too: a healthy clean-up removes the body, its file and its bytes.
  await w.run({ op: 'tidy' }, w.now + 40 * 864e5);
  assert.deepEqual(w.bodies(id(1)), []);
  assert.equal((await w.run({ op: 'getFile', id: id(20) })).ok, false);
  assert.equal(w.db.blobs.size, 0);
  // Bytes left without their file (a failed upload) go too.
  w.db.blobs.set(`https://school.instructure.com/5/${id(30)}`, new Uint8Array(1));
  await w.run({ op: 'tidy' });
  assert.equal(w.db.blobs.size, 0);
});

test('the sanitizer bounds its work on deep or huge input, not only what it keeps', () => {
  for (const n of [4000, 16000]) {
    const deep = `${'<div>'.repeat(n)}text${'</div>'.repeat(n)}`;
    const root = N.parse(deep);
    assert.ok(root.steps <= 60 * 2 * n, `${n} nested: ${root.steps} steps`);
    assert.ok(N.sanitize(deep).length < 600, 'output stays small: 48 levels at most');
    const p = N.parse(`${'<p><span>'.repeat(n)}x`);
    assert.ok(p.steps <= 60 * 2 * n, `${n} unclosed: ${p.steps} steps`);
  }
  // A flood of tags stops at the token budget.
  const flood = '<b>x</b>'.repeat(400000);
  assert.ok(N.sanitize(flood).length < '<strong>x</strong>'.length * 300000);
});

// WID-1: the node budget cut a note off at its 40,000th node and the save still answered ok, so a pasted 2,000-row sheet or
// a note of 25,000 short paragraphs came back shorter, with nothing said. Now what fits is kept whole, and what has to be
// cut is refused as 'big' (a visible warning on the page) instead of stored cut.
const paras = (n) => Array.from({ length: n }, (_, i) => `<p>line ${i}</p>`).join('');
const sheet = (rows, cols = 10) => `<table>${Array.from({ length: rows }, (_, r) => `<tr>${Array.from({ length: cols }, (_, c) => `<td>${r}.${c}</td>`).join('')}</tr>`).join('')}</table>`;
const count = (html, tag) => (html.match(new RegExp(`<${tag}>`, 'g')) || []).length;

test('a long note and a big pasted sheet are kept whole (under the 2 MB body limit, past the old node budget)', async () => {
  assert.equal(count(S(paras(25000)), 'p'), 25000);
  assert.equal(count(S(sheet(2000)), 'tr'), 2000);
  assert.equal(N.sanitized(paras(25000)).cut, false);
  const w = world();
  const html = paras(25000);
  assert.ok(html.length < N.LIMIT.body / 4);
  assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html, copy: id(90), title: 'Long' }), { ok: true, id: id(1), rev: 1 });
  assert.equal(count((await w.run({ op: 'load', id: id(1) })).html, 'p'), 25000, 'every paragraph is stored');
  await w.run({ op: 'save', id: id(2), base: 0, sid: 'b', html: sheet(2000), copy: id(91), title: 'Sheet' });
  assert.equal(count((await w.run({ op: 'load', id: id(2) })).html, 'tr'), 2000, 'every row is stored');
});

test('a note past the sanitizer\'s budgets is refused as big, never stored cut; the stored note stays as it was', async () => {
  const w = world();
  const huge = paras(60000), flood = '<b>x</b>'.repeat(400000);
  for (const [html, why] of [[huge, 'nodes'], [flood, 'tokens'], ['x'.repeat(N.LIMIT.body * 2 + 1), 'input longer than the body limit allows twice over']]) {
    assert.equal(N.parse(html).cut, true, why);
    assert.equal(N.sanitized(html).cut, true, why);
  }
  assert.equal(N.parse('<p>fits</p>').cut, false);
  assert.equal(N.parse('').cut, false);
  assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: huge, copy: id(90), title: 'Big' }), { ok: false, error: 'big' }, 'a new note');
  assert.equal(w.idx().notes[id(1)], undefined, 'nothing stored');
  assert.deepEqual(w.bodies(id(1)), []);
  assert.deepEqual(await w.run({ op: 'save', id: id(2), base: 0, sid: 'b', html: '<p>small</p>', copy: id(91), title: 'Small' }), { ok: true, id: id(2), rev: 1 });
  assert.deepEqual(await w.run({ op: 'save', id: id(2), base: 1, sid: 'c', html: huge, copy: id(92) }), { ok: false, error: 'big' }, 'an edit');
  assert.deepEqual(await w.run({ op: 'load', id: id(2) }), { ok: true, html: '<p>small</p>', rev: 1 }, 'the note is as it was');
  assert.equal(w.idx().notes[id(2)].rev, 1);
});

test('import skips a note it would have to cut, and the export reader carries that through a second reading', async () => {
  const w = world();
  const huge = paras(60000);
  assert.deepEqual(await w.run({ op: 'import', notes: [{ id: id(1), title: 'Huge', created: 1, at: 1000, html: huge }, { id: id(2), title: 'Fine', created: 1, at: 1000, html: '<p>ok</p>' }] }),
    { ok: true, done: 1, skipped: 1 });
  assert.equal(w.idx().notes[id(1)], undefined);
  assert.ok(w.idx().notes[id(2)]);
  // The editor's backup reads an export in the page, then hands the notes to the worker as JSON, which reads them again:
  // the first reading cuts, so it has to say so for the second.
  const site = 'https://school.instructure.com';
  const json = JSON.stringify({ format: 'glaze-notes', version: 1, site, folders: [], files: [], notes: [{ id: id(1), title: 'Huge', at: 5, html: huge }, { id: id(2), title: 'Fine', at: 5, html: '<p>ok</p>' }] });
  const first = N.parseExport(json, { site });
  assert.deepEqual(first.notes.map((n) => !!n.big), [true, false]);
  const second = N.parseExport({ format: 'glaze-notes', version: 1, site, folders: [], files: [], notes: JSON.parse(JSON.stringify(first.notes)) }, { site });
  assert.deepEqual(second.notes.map((n) => !!n.big), [true, false], 'still flagged');
  const w2 = world();
  assert.deepEqual(await w2.run({ op: 'import', notes: second.notes }), { ok: true, done: 1, skipped: 1 });
  assert.equal(w2.idx().notes[id(1)], undefined);
});

test('import reads file references in any spelling, and keeps only the ones the export declares', () => {
  const site = 'https://school.instructure.com';
  const f = id(7), undeclared = id(8);
  const json = JSON.stringify({ format: 'glaze-notes', version: 1, site, folders: [], files: [{ id: f, kind: 'image', name: 'a.png', path: `files/${f}.png`, size: 3 }],
    notes: [
      { id: id(1), title: 'single', html: `<p><img data-gz-file='${f}'></p>` },
      { id: id(2), title: 'unquoted', html: `<p><img data-gz-file=${f}></p>` },
      { id: id(3), title: 'case', html: `<p><IMG DATA-GZ-FILE="${f}"></p>` },
      { id: id(4), title: 'entity', html: `<p><img data-gz-file="&#x${f.charCodeAt(0).toString(16)};${f.slice(1)}"></p>` },
      { id: id(5), title: 'undeclared', html: `<p>a<img data-gz-file='${undeclared}'><a data-gz-file=${undeclared}>b</a></p>` },
    ] });
  const back = N.parseExport(json, { site });
  for (const n of back.notes.slice(0, 4)) assert.equal(n.html, `<p><img data-gz-file="${f}"></p>`, n.title);
  assert.equal(back.notes[4].html, '<p>ab</p>');
  assert.deepEqual([...N.refs(back.notes.map((n) => n.html).join(''))], [f]);
});

test('importing the same export twice adds nothing; a newer copy wins, an older one is skipped', async () => {
  const w = world();
  const notes = [{ id: id(1), title: 'Week 1', created: 1, at: 1000, html: '<p>from the export</p>' }, { id: id(2), title: 'Week 2', created: 1, at: 1000, html: '<p>two</p>' }];
  assert.deepEqual(await w.run({ op: 'import', notes }), { ok: true, done: 2, skipped: 0 });
  assert.deepEqual(await w.run({ op: 'import', notes }), { ok: true, done: 0, skipped: 2 });
  assert.equal(Object.keys(w.idx().notes).length, 2);
  // Edited here since: the export's older copy is skipped.
  await w.run({ op: 'save', id: id(1), base: 1, sid: 'x', html: '<p>edited here</p>', copy: id(90) });
  // A newer export of note 2 replaces it, as a new revision (other tabs reload or keep a copy).
  assert.deepEqual(await w.run({ op: 'import', notes: [notes[0], { ...notes[1], at: 2000, html: '<p>two, newer</p>' }] }), { ok: true, done: 1, skipped: 1 });
  assert.equal((await w.run({ op: 'load', id: id(1) })).html, '<p>edited here</p>');
  assert.deepEqual(await w.run({ op: 'load', id: id(2) }), { ok: true, html: '<p>two, newer</p>', rev: 2 });
  // Deleted for good here, then imported again from the backup: it comes back.
  await w.run({ op: 'trash', ids: [id(2)] });
  await w.run({ op: 'purge', ids: [id(2)] });
  assert.deepEqual(await w.run({ op: 'import', notes: [notes[1]] }), { ok: true, done: 1, skipped: 0 });
  assert.equal((await w.run({ op: 'load', id: id(2) })).html, '<p>two</p>');
});

// A backup as the options page makes one and the worker reads it: the library's notes with their text, the zip's
// notes.json, read in the page, then again in the worker. old: as Glaze 3.4.2 and earlier wrote it, without field times.
const backup = async (w, { old = false } = {}) => {
  const site = 'https://school.instructure.com', idx = w.idx();
  const notes = [];
  for (const [nid, n] of N.list(idx)) notes.push({ id: nid, ...n, html: (await w.run({ op: 'load', id: nid }, n.at)).html });
  const m = JSON.parse(new TextDecoder().decode(N.exportZip({ site, folders: N.folderList(idx).map(([fid, f]) => ({ id: fid, ...f })), notes, files: [] })[0].data));
  if (old) for (const x of [...m.notes, ...m.folders]) delete x.ft;
  const page = N.parseExport(m, { site });
  const data = N.parseExport(JSON.stringify({ ...m, folders: page.folders, notes: page.notes }), { site });
  return { folders: data.folders, notes: data.notes };
};
const moved = async () => {
  const src = world(), dst = world(), t = src.now;
  await src.run({ op: 'folder', id: id(10), name: 'Labs' }, t);
  await src.run({ op: 'folder', id: id(11), name: 'Lectures', course: '43' }, t);
  await src.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>Unchanged body</p>', title: 'Old title', folder: id(10), course: '42', copy: id(90) }, t + 1000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src) }, t + 2000), { ok: true, done: 1, skipped: 0 });
  return { src, dst, t };
};

test('a newer backup restores a rename made without touching the note text', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'meta', id: id(1), title: 'Renamed title', at: t + 3000 }, t + 3000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src) }, t + 4000), { ok: true, done: 1, skipped: 0 });
  const n = dst.idx().notes[id(1)];
  assert.equal(n.title, 'Renamed title');
  assert.equal(n.rev, 1, 'the text is not written again');
  assert.deepEqual(dst.bodies(id(1)), [`https://school.instructure.com/5/${id(1)}/1`]);
});

test('a newer backup restores a move to another folder, and the course that came with it', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'meta', id: id(1), folder: id(11), at: t + 3000 }, t + 3000);
  await dst.run({ op: 'import', ...await backup(src) }, t + 4000);
  assert.deepEqual([dst.idx().notes[id(1)].folder, dst.idx().notes[id(1)].course, dst.idx().notes[id(1)].title], [id(11), '43', 'Old title']);
});

test('a newer backup restores a course reassignment', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'meta', id: id(1), course: '77', cn: 'Chemistry', at: t + 3000 }, t + 3000);
  await dst.run({ op: 'import', ...await backup(src) }, t + 4000);
  assert.deepEqual([dst.idx().notes[id(1)].course, dst.idx().notes[id(1)].cn, dst.idx().notes[id(1)].folder], ['77', 'Chemistry', id(10)]);
});

test('a backup restores an explicitly cleared course inside a course folder', async () => {
  for (const newerBody of [false, true]) {
    const { src, dst, t } = await moved();
    await src.run({ op: 'meta', id: id(1), folder: id(11), at: t + 3000 }, t + 3000);
    await dst.run({ op: 'import', ...await backup(src) }, t + 4000);
    await src.run({ op: 'meta', id: id(1), course: '', at: t + 5000 }, t + 5000);
    if (newerBody) await src.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>New body</p>' }, t + 5500);
    const b = await backup(src);
    assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 6000), { ok: true, done: 1, skipped: 0 });
    const n = dst.idx().notes[id(1)];
    assert.deepEqual([n.course, n.cn, n.folder], ['', '', id(11)], 'the folder must not replace an explicit course choice');
    assert.equal(n.rev, newerBody ? 2 : 1);
    assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 7000), { ok: true, done: 0, skipped: 1 });
    const fresh = world();
    await fresh.run({ op: 'import', ...b }, t + 6000);
    assert.equal(fresh.idx().notes[id(1)].course, '', 'a first import keeps the same choice');
  }
});

test('importing the same newer backup twice changes the note once', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'meta', id: id(1), title: 'Renamed title', at: t + 3000 }, t + 3000);
  const b = await backup(src);
  assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 4000), { ok: true, done: 1, skipped: 0 });
  const after = dst.idx().notes[id(1)];
  assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 5000), { ok: true, done: 0, skipped: 1 });
  assert.deepEqual(dst.idx().notes[id(1)], after);
});

test('a backup keeps the destination\'s newer rename, field by field, even when its text is newer', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'meta', id: id(1), title: 'Renamed at the source', at: t + 3000 }, t + 3000);
  await src.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>Newer body</p>', copy: id(91) }, t + 3500);
  await dst.run({ op: 'meta', id: id(1), title: 'Renamed here', at: t + 4000 }, t + 4000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src) }, t + 5000), { ok: true, done: 1, skipped: 0 });
  assert.equal(dst.idx().notes[id(1)].title, 'Renamed here');
  assert.equal((await dst.run({ op: 'load', id: id(1) }, t + 5000)).html, '<p>Newer body</p>');
  // Only the title is newer here: the import is skipped as a whole.
  await dst.run({ op: 'meta', id: id(1), title: 'Renamed here again', at: t + 6000 }, t + 6000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src) }, t + 7000), { ok: true, done: 0, skipped: 1 });
  assert.equal(dst.idx().notes[id(1)].title, 'Renamed here again');
});

test('a backup from before field times still imports, its title and place travelling with its text', async () => {
  const src = world(), dst = world(), t = src.now;
  await src.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>One</p>', title: 'Old title', course: '42', copy: id(90) }, t + 1000);
  const first = await backup(src, { old: true });
  assert.equal(first.notes[0].ft, undefined);
  assert.deepEqual(await dst.run({ op: 'import', ...first }, t + 2000), { ok: true, done: 1, skipped: 0 });
  assert.deepEqual([dst.idx().notes[id(1)].title, dst.idx().notes[id(1)].course], ['Old title', '42']);
  assert.deepEqual(await dst.run({ op: 'import', ...first }, t + 3000), { ok: true, done: 0, skipped: 1 });
  await src.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>Two</p>', copy: id(91) }, t + 4000);
  await src.run({ op: 'meta', id: id(1), title: 'New title', at: t + 4000 }, t + 4000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src, { old: true }) }, t + 5000), { ok: true, done: 1, skipped: 0 });
  assert.equal(dst.idx().notes[id(1)].title, 'New title');
  assert.equal((await dst.run({ op: 'load', id: id(1) }, t + 5000)).html, '<p>Two</p>');
});

test('restoring a legacy backup does not date its fields at the restore time', async () => {
  for (const newerBody of [false, true]) {
    const src = world(), dst = world(), t = src.now;
    await src.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>One</p>', title: 'Old title' }, t + 1000);
    const old = await backup(src, { old: true });
    await src.run({ op: 'meta', id: id(1), title: 'Later title', at: t + 3000 }, t + 3000);
    if (newerBody) await src.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>Two</p>' }, t + 4000);
    const latest = await backup(src);
    // Both backups predate the restore, and the older one is restored first.
    await dst.run({ op: 'import', ...old }, t + 5000);
    assert.deepEqual(await dst.run({ op: 'import', ...latest }, t + 6000), { ok: true, done: 1, skipped: 0 });
    assert.equal(dst.idx().notes[id(1)].title, 'Later title');
    assert.equal(dst.idx().notes[id(1)].ft.title, t + 3000);
    assert.deepEqual(await dst.run({ op: 'import', ...latest }, t + 6500), { ok: true, done: 0, skipped: 1 });
    await dst.run({ op: 'meta', id: id(1), title: 'Local title', at: t + 7000 }, t + 7000);
    await dst.run({ op: 'import', ...latest }, t + 8000);
    assert.equal(dst.idx().notes[id(1)].title, 'Local title');
  }
});

test('backup field times keep only numeric known fields through both readings', async () => {
  const site = 'https://school.instructure.com', w = world(), t = w.now;
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', title: 'Keep', html: '<p>Keep</p>' }, t);
  const before = structuredClone(w.store);
  const hostile = JSON.parse('{"title":1e400,"folder":"9000000000000","course":-1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"del":1}');
  for (const ft of [hostile, { title: null, folder: true, course: {} }, [], 'bad', null]) {
    const raw = { format: 'glaze-notes', version: 1, site, folders: [], files: [], notes: [{ id: id(1), title: 'Replace', html: '<p>Replace</p>', at: t, ft }] };
    const page = N.parseExport(raw, { site });
    const worker = N.parseExport(JSON.stringify({ ...raw, ...page }), { site });
    if (ft && typeof ft === 'object') assert.deepEqual(worker.notes[0].ft, { title: 0, folder: 0, course: 0 });
    else assert.equal(worker.notes[0].ft, undefined);
    assert.deepEqual(await w.run({ op: 'import', ...worker }, t + 1000), { ok: true, done: 0, skipped: 1 });
    assert.deepEqual(w.store, before);
  }
  assert.equal({}.polluted, undefined);
});

test('metadata imports preserve trash and revisions, while a newer body restores and conflicts safely', async () => {
  const { src, dst, t } = await moved();
  await dst.run({ op: 'folderDel', id: id(10), notes: 'trash' }, t + 2500);
  await src.run({ op: 'meta', id: id(1), title: 'Renamed', at: t + 3000 }, t + 3000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src) }, t + 4000), { ok: true, done: 1, skipped: 0 });
  const n = dst.idx().notes[id(1)];
  assert.deepEqual([n.title, n.rev, n.del, n.with], ['Renamed', 1, t + 2500, id(10)]);
  assert.deepEqual(dst.bodies(id(1)), [`https://school.instructure.com/5/${id(1)}/1`]);
  await src.run({ op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>New body</p>' }, t + 5000);
  assert.deepEqual(await dst.run({ op: 'import', ...await backup(src) }, t + 6000), { ok: true, done: 1, skipped: 0 });
  const restored = dst.idx().notes[id(1)];
  assert.deepEqual([restored.rev, restored.del, restored.with, restored.folder], [2, undefined, undefined, '']);
  assert.deepEqual(dst.bodies(id(1)), [`https://school.instructure.com/5/${id(1)}/2`]);
  assert.deepEqual(await dst.run({ op: 'save', id: id(1), base: 1, sid: 'stale', copy: id(92), html: '<p>Unsaved tab</p>' }, t + 7000), { ok: true, id: id(92), rev: 1, conflict: true });
  assert.equal((await dst.run({ op: 'load', id: id(1) }, t + 7000)).html, '<p>New body</p>');
  assert.equal((await dst.run({ op: 'load', id: id(92) }, t + 7000)).html, '<p>Unsaved tab</p>');
});

test('future backup field times cannot overrule local edits', async () => {
  for (const future of [Date.UTC(2100, 0, 1), Number.MAX_VALUE]) {
    const { src, dst, t } = await moved();
    const b = await backup(src);
    b.notes[0].title = 'Future title';
    b.notes[0].ft.title = future;
    await dst.run({ op: 'meta', id: id(1), title: 'Local title', at: t + 3000 }, t + 3000);
    assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 4000), { ok: true, done: 0, skipped: 1 });
    assert.equal(dst.idx().notes[id(1)].title, 'Local title');
  }
});

test('future backup field times do not count repeat imports as changes', async () => {
  for (const future of [Date.UTC(2100, 0, 1), Number.MAX_VALUE]) {
    const { src, t } = await moved(), fresh = world(), b = await backup(src);
    b.notes[0].ft.title = future;
    assert.deepEqual(await fresh.run({ op: 'import', ...b }, t + 4000), { ok: true, done: 1, skipped: 0 });
    assert.deepEqual(await fresh.run({ op: 'import', ...b }, t + 5000), { ok: true, done: 0, skipped: 1 });
    assert.equal(fresh.idx().notes[id(1)].ft.title, t + 1000, 'a future field falls back to the backup edit time');
  }
});

test('a failed metadata import keeps the committed note and its body for a retry', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'meta', id: id(1), title: 'Renamed', at: t + 3000 }, t + 3000);
  const b = await backup(src), before = structuredClone(dst.store), bodies = structuredClone(dst.db.bodies);
  const set = dst.local.set;
  dst.local.set = async () => false;
  assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 4000), { ok: false, error: 'write' });
  assert.deepEqual(dst.store, before);
  assert.deepEqual(dst.db.bodies, bodies);
  dst.local.set = set;
  assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 5000), { ok: true, done: 1, skipped: 0 });
  assert.equal(dst.idx().notes[id(1)].title, 'Renamed');
});

test('a newer backup renames a folder here, once', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'folder', id: id(10), name: 'Lab reports', at: t + 3000 }, t + 3000);
  const b = await backup(src);
  assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 4000), { ok: true, done: 0, skipped: 1 });
  assert.equal(dst.idx().folders[id(10)].name, 'Lab reports');
  const after = structuredClone(dst.store);
  assert.deepEqual(await dst.run({ op: 'import', ...b }, t + 5000), { ok: true, done: 0, skipped: 1 });
  assert.deepEqual(dst.store, after);
});

test('a folder\'s newer rename here stays, while the backup\'s newer course still lands', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'folder', id: id(10), name: 'Renamed at the source', at: t + 3000 }, t + 3000);
  await dst.run({ op: 'folder', id: id(10), name: 'Renamed here', at: t + 4000 }, t + 4000);
  await src.run({ op: 'folder', id: id(10), course: '77', cn: 'Chemistry', at: t + 5000 }, t + 5000);
  await dst.run({ op: 'import', ...await backup(src) }, t + 6000);
  const f = dst.idx().folders[id(10)];
  assert.deepEqual([f.name, f.course, f.cn], ['Renamed here', '77', 'Chemistry']);
});

test('a newer backup restores the folders\' order, and a newer order here stays', async () => {
  const { src, dst, t } = await moved();
  assert.deepEqual(N.folderList(dst.idx()).map(([k]) => k), [id(10), id(11)]);
  await src.run({ op: 'order', ids: [id(11), id(10)], at: t + 3000 }, t + 3000);
  const b = await backup(src);
  await dst.run({ op: 'import', ...b }, t + 4000);
  assert.deepEqual(N.folderList(dst.idx()).map(([k]) => k), [id(11), id(10)]);
  await dst.run({ op: 'order', ids: [id(10), id(11)], at: t + 5000 }, t + 5000);
  await dst.run({ op: 'import', ...b }, t + 6000);
  assert.deepEqual(N.folderList(dst.idx()).map(([k]) => k), [id(10), id(11)]);
});

const places = (w) => N.folderList(w.idx()).map(([k]) => k);
const orders = (w) => Object.values(w.idx().folders).map((f) => f.order).sort((a, b) => a - b);

test('a folder new to this device lands where the newer backup put it, before folders here', async () => {
  const src = world(), dst = world(), t = src.now;
  await src.run({ op: 'folder', id: id(10), name: 'First' }, t);
  await dst.run({ op: 'import', ...await backup(src) }, t + 1000);
  await src.run({ op: 'folder', id: id(11), name: 'New' }, t + 2000);
  await src.run({ op: 'order', ids: [id(11), id(10)], at: t + 3000 }, t + 3000);
  const b = await backup(src);
  await dst.run({ op: 'import', ...b }, t + 4000);
  assert.deepEqual(places(dst), places(src));
  assert.deepEqual(orders(dst), [0, 1]);
  assert.deepEqual([id(10), id(11)].map((k) => dst.idx().folders[k].ft.order), [t + 3000, t + 3000]);
  const after = structuredClone(dst.store);
  await dst.run({ op: 'import', ...b }, t + 5000);
  assert.deepEqual(dst.store, after);
});

test('folders only here follow the backup\'s folders, in their own order, their times untouched', async () => {
  const { src, dst, t } = await moved();
  await dst.run({ op: 'folder', id: id(12), name: 'Mine' }, t + 2500);
  await dst.run({ op: 'folder', id: id(14), name: 'Also mine' }, t + 2500);
  await dst.run({ op: 'order', ids: [id(14), id(10), id(12), id(11)], at: t + 2600 }, t + 2600);
  await src.run({ op: 'folder', id: id(13), name: 'New' }, t + 3000);
  await src.run({ op: 'order', ids: [id(13), id(11), id(10)], at: t + 3500 }, t + 3500);
  await dst.run({ op: 'import', ...await backup(src) }, t + 4000);
  assert.deepEqual(places(dst), [id(13), id(11), id(10), id(14), id(12)]);
  assert.deepEqual(orders(dst), [0, 1, 2, 3, 4]);
  assert.deepEqual([id(12), id(14)].map((k) => dst.idx().folders[k].ft.order), [t + 2600, t + 2600]);
});

test('a newer order here stays against an older backup, and a folder new here keeps the backup\'s neighbour', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'folder', id: id(13), name: 'New' }, t + 3000);
  await src.run({ op: 'order', ids: [id(10), id(13), id(11)], at: t + 3000 }, t + 3000);
  await dst.run({ op: 'order', ids: [id(11), id(10)], at: t + 5000 }, t + 5000);
  await dst.run({ op: 'import', ...await backup(src) }, t + 6000);
  assert.deepEqual(places(dst), [id(11), id(10), id(13)]);
  assert.deepEqual(orders(dst), [0, 1, 2]);
  assert.deepEqual([id(10), id(11), id(13)].map((k) => dst.idx().folders[k].ft.order), [t + 5000, t + 5000, t + 3000]);
});

test('a backup from before folder times adds its new folders after these, and leaves this order as it is', async () => {
  const { src, dst, t } = await moved();
  await src.run({ op: 'folder', id: id(13), name: 'New' }, t + 3000);
  await src.run({ op: 'order', ids: [id(13), id(11), id(10)], at: t + 3500 }, t + 3500);
  await dst.run({ op: 'import', ...await backup(src, { old: true }) }, t + 4000);
  assert.deepEqual(places(dst), [id(10), id(11), id(13)]);
  assert.deepEqual(dst.idx().folders[id(13)].ft, { name: 0, course: 0, order: 0 });
});

test('a backup from before folder times leaves a folder here as it is, and a later one still renames it', async () => {
  const src = world(), dst = world(), t = src.now;
  await src.run({ op: 'folder', id: id(10), name: 'Labs' }, t);
  await dst.run({ op: 'import', ...await backup(src, { old: true }) }, t + 1000);
  assert.equal(dst.idx().folders[id(10)].name, 'Labs');
  await src.run({ op: 'folder', id: id(10), name: 'Lab reports', at: t + 2000 }, t + 2000);
  await dst.run({ op: 'import', ...await backup(src, { old: true }) }, t + 3000);
  assert.equal(dst.idx().folders[id(10)].name, 'Labs');
  await dst.run({ op: 'import', ...await backup(src) }, t + 4000);
  assert.equal(dst.idx().folders[id(10)].name, 'Lab reports');
});

test('a folder deleted for good here comes back from a backup, as a note does', async () => {
  const { src, dst, t } = await moved();
  await dst.run({ op: 'folderDel', id: id(10), notes: 'keep' }, t + 2500);
  await dst.run({ op: 'purge', ids: [id(10)] }, t + 2600);
  assert.ok(dst.idx().gone[id(10)]);
  await src.run({ op: 'folder', id: id(10), name: 'Lab reports', at: t + 3000 }, t + 3000);
  await dst.run({ op: 'import', ...await backup(src) }, t + 4000);
  assert.equal(dst.idx().folders[id(10)].name, 'Lab reports');
  assert.equal(dst.idx().gone[id(10)], undefined);
});

test('folder times in a backup keep only numeric known fields, and a future one never overrules', async () => {
  const site = 'https://school.instructure.com', { dst, t } = await moved();
  const before = structuredClone(dst.store);
  const hostile = JSON.parse('{"name":1e400,"course":"9","order":-1,"__proto__":{"polluted":true},"del":1}');
  for (const ft of [hostile, { name: Date.UTC(2100, 0, 1), course: Number.MAX_VALUE, order: Date.UTC(2100, 0, 1) }, [], 'bad', null]) {
    const raw = { format: 'glaze-notes', version: 1, site, notes: [], files: [], folders: [{ id: id(10), name: 'Replace', course: '1', order: 9, ft }] };
    const worker = N.parseExport(JSON.stringify({ ...raw, ...N.parseExport(raw, { site }) }), { site });
    if (!ft || typeof ft !== 'object') assert.equal(worker.folders[0].ft, undefined);
    else assert.deepEqual(Object.keys(worker.folders[0].ft), ['name', 'course', 'order']);
    await dst.run({ op: 'import', ...worker }, t + 4000);
    assert.deepEqual(dst.store, before);
  }
  assert.equal({}.polluted, undefined);
});

test('the backup worker retains field times and counts metadata imports across batches', async () => {
  const S = require('../lib/sessions.js'), src = world(), dst = world(), t = src.now;
  let turns = 0;
  const worker = (w) => S.make({ local: w.local, sync: w.local, notes: w.idb, db: { all: async () => [] }, enqueue: async (f) => { turns++; return f(); } });
  const source = worker(src), target = worker(dst);
  try {
    await dst.local.set({ [KEY]: N.clean({}) });
    for (let i = 1; i <= 21; i++) await src.run({ op: 'save', id: id(i), base: 0, sid: `a${i}`, html: '<p>Body</p>', title: 'Old' }, t + 1000);
    const exported = async () => {
      const data = await source.backupNotes(KEY);
      for (const n of data.notes) {
        assert.deepEqual(n.ft, src.idx().notes[n.id].ft);
        const body = await source.handle({ op: 'notesRead', key: KEY, id: n.id });
        assert.equal(body.rev, n.rev);
        n.html = body.html;
      }
      const raw = JSON.parse(new TextDecoder().decode(N.exportZip(data)[0].data));
      return JSON.stringify({ ...raw, ...N.parseExport(raw, { site: data.site }) });
    };
    assert.deepEqual(await target.handle({ op: 'notesImport', key: KEY, json: await exported() }), { ok: true, done: 21, skipped: 0 });
    for (let i = 1; i <= 21; i++) await src.run({ op: 'meta', id: id(i), title: 'New', at: t + 3000 }, t + 3000);
    const json = await exported();
    assert.deepEqual(await target.handle({ op: 'notesImport', key: KEY, json }), { ok: true, done: 21, skipped: 0 });
    assert.deepEqual(await target.handle({ op: 'notesImport', key: KEY, json }), { ok: true, done: 0, skipped: 21 });
    for (const n of Object.values(dst.idx().notes)) assert.deepEqual([n.title, n.ft.title, n.rev], ['New', t + 3000, 1]);
    assert.equal(turns, 45, 'each read and each import takes one broker turn');
  } finally { source.stop(); target.stop(); }
});

test('Canvas links: only this site, link and title only', () => {
  const o = 'https://school.instructure.com';
  assert.deepEqual(N.canvasLinks('file', [{ id: 9, display_name: 'Slides.pdf', url: 'https://cdn.example/x?sig=1' }], o, '7'), [{ title: 'Slides.pdf', href: `${o}/courses/7/files/9`, kind: 'file' }]);
  assert.deepEqual(N.canvasLinks('page', [{ title: 'Week 1', url: 'week-1', html_url: `${o}/courses/7/pages/week-1` }, { title: 'Off', url: 'off', html_url: 'https://evil.example/x' }], o, '7').map((l) => l.href), [`${o}/courses/7/pages/week-1`, `${o}/courses/7/pages/off`]);
  assert.deepEqual(N.canvasLinks('module', [{ name: 'Unit 1', items: [{ title: 'Intro', type: 'Page', html_url: `${o}/courses/7/modules/items/3` }, { title: 'Heading', type: 'SubHeader' }, { title: 'Ext', type: 'ExternalUrl', html_url: 'https://evil.example' }] }], o, '7'),
    [{ title: 'Intro', href: `${o}/courses/7/modules/items/3`, kind: 'module', group: 'Unit 1' }]);
});

test('the index is cleaned whatever storage holds', () => {
  const idx = N.clean({ notes: { [id(1)]: { title: 5, folder: 'nope', course: 'x', rev: -1, del: 'soon', with: id(9) }, bad: {} }, folders: { [id(2)]: null }, gone: { [id(3)]: 'x' } });
  assert.deepEqual(Object.keys(idx.notes), [id(1)]);
  assert.deepEqual(idx.notes[id(1)], { title: '', folder: '', course: '', cn: '', created: 0, at: 0, rev: 0, ft: { title: 0, folder: 0, course: 0 }, ex: '', sid: '' });
  assert.deepEqual(idx.folders, {});
  assert.deepEqual(idx.gone, {});
  assert.equal(N.imageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0])), 'image/webp');
  assert.equal(N.imageType(new TextEncoder().encode('GIF89a......')), 'image/gif');
  assert.equal(N.imageType(new TextEncoder().encode('<html>')), null);
});

test('Ultra: notes kept per Ultra site and _N_N account, courses by Ultra id, and content links from the public contents API', () => {
  const o = 'https://school.blackboard.test';
  assert.ok(N.KEY.test(N.storeKey(o, '_5_1')));
  for (const k of ['notesIdx:https://school.blackboard.test/_5', 'notesIdx:https://school.blackboard.test/_5_1_2', 'notesIdx:https://school.blackboard.test/5_1']) assert.ok(!N.KEY.test(k), k);
  const idx = N.clean({ notes: { '00000000-0000-4000-8000-000000000001': { title: 'a', course: '_7_1' }, '00000000-0000-4000-8000-000000000002': { title: 'b', course: '_7' } } });
  assert.deepEqual(Object.values(idx.notes).map((n) => n.course), ['_7_1', ''], 'an Ultra course id is kept; anything else is no course');
  // The public contents API's items (content-ultra.js courseItems): title, parent and links only.
  const items = [
    { id: '_1_1', title: 'Week 1', links: [{ rel: 'alternate', href: '/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_1_1' }] },
    { id: '_2_1', parentId: '_1_1', title: 'Lab', links: [{ rel: 'self', href: '/learn/api/public/v1/courses/_7_1/contents/_2_1' }, { rel: 'alternate', href: `${o}/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_2_1` }] },
    { id: '_3_1', title: 'Other site', links: [{ rel: 'alternate', href: 'https://evil.example/ultra/redirect' }] },
    { id: '_4_1', title: 'Not Ultra', links: [{ rel: 'alternate', href: '/webapps/blackboard/x' }] },
    { id: '_5_1', title: 'Script', links: [{ rel: 'alternate', href: 'javascript:alert(1)' }] },
    { id: '_6_1', title: '', links: [{ rel: 'alternate', href: '/ultra/redirect?x=1' }] },
    { id: '_7_1', title: 'No links' }, null, 'x',
  ];
  assert.deepEqual(N.ultraLinks(items, o), [
    { title: 'Week 1', href: `${o}/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_1_1`, kind: 'item', group: '' },
    { title: 'Lab', href: `${o}/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_2_1`, kind: 'item', group: 'Week 1' },
  ]);
  assert.deepEqual(N.ultraLinks(null, o), []);
  assert.match(N.sanitize('<a href="https://school.blackboard.test/ultra/x" data-gz-kind="item">Lab</a>'), /data-gz-kind="item"/, 'an Ultra link keeps its kind in a note');
});

test('ids that name an object\'s own properties are refused, and nothing reaches the prototype', async () => {
  const w = world();
  await w.run({ op: 'folder', id: id(10), name: 'Labs' });
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>1</p>', title: 'L1', folder: id(10), copy: id(90) });
  try {
    for (const [i, bad] of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'].entries()) {
      for (const notes of ['keep', 'trash']) assert.deepEqual(await w.run({ op: 'folderDel', id: bad, notes }), { ok: false, error: 'bad' }, bad);
      assert.deepEqual(await w.run({ op: 'load', id: bad }), { ok: false, error: 'bad' }, bad);
      assert.deepEqual(await w.run({ op: 'meta', id: bad, title: 'x', course: '42' }), { ok: false, error: 'bad' }, bad);
      await w.run({ op: 'meta', id: id(1), folder: bad });
      assert.equal(w.idx().notes[id(1)].folder, '', bad);
      await w.run({ op: 'save', id: id(20 + i), base: 0, sid: bad, html: '<p>2</p>', folder: bad, copy: id(60 + i) });
      assert.equal(w.idx().notes[id(20 + i)].folder, '', bad);
      w.store[KEY].notes[id(1)].folder = bad;
      w.store[KEY].notes[id(1)].with = bad;
      assert.equal(N.clean(w.store[KEY]).notes[id(1)].folder, '', bad);
      assert.equal(N.clean(w.store[KEY]).notes[id(1)].with, undefined, bad);
    }
    for (const k of ['del', 'title', 'folder', 'with', 'ft']) assert.ok(!Object.hasOwn(Object.prototype, k) && !Object.hasOwn(Object, k), k);
  } finally {
    for (const k of ['del', 'title', 'folder', 'with', 'ft']) { delete Object.prototype[k]; delete Object[k]; }
  }
});

test('note operations refuse non-string ids instead of coercing them into stored keys', async () => {
  const w = world();
  await w.run({ op: 'folder', id: id(10), name: 'Labs' });
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>1</p>', folder: id(10) });
  await w.run({ op: 'file', id: id(2), note: id(1), kind: 'file', data: 'YQ==' });
  const before = structuredClone(w.store);
  for (const wrap of [(v) => [v], (v) => [[v]], () => ({ toString: 'not callable' })]) {
    for (const m of [
      { op: 'folderDel', id: id(10), notes: 'trash' }, { op: 'folder', id: id(10), name: 'Changed' },
      { op: 'load', id: id(1) }, { op: 'meta', id: id(1), title: 'Changed' },
      { op: 'save', id: id(1), base: 1, sid: 'b', html: '<p>2</p>' },
      { op: 'file', id: id(2), note: id(1), kind: 'file', data: 'Yg==' },
    ]) assert.deepEqual(await w.run({ ...m, id: wrap(m.id) }), { ok: false, error: 'bad' }, m.op);
    assert.equal((await w.run({ op: 'getFile', id: wrap(id(2)) })).ok, false);
    assert.deepEqual(await w.run({ op: 'save', id: id(1), base: 0, sid: 'b', html: '<p>2</p>', copy: wrap(id(3)) }), { ok: false, error: 'bad' });
    assert.deepEqual(await w.run({ op: 'file', id: id(2), note: wrap(id(1)), kind: 'file', data: 'Yg==' }), { ok: false, error: 'bad' });
  }
  assert.deepEqual(w.store, before, 'invalid ids change neither the folder nor its notes');
});

test('stored folder references and imported ids must be strings', async () => {
  const w = world();
  await w.run({ op: 'folder', id: id(10), name: 'Labs' });
  await w.run({ op: 'save', id: id(1), base: 0, sid: 'a', html: '<p>1</p>', folder: id(10) });
  for (const bad of [[id(10)], { toString: 'not callable' }]) {
    const raw = structuredClone(w.store[KEY]);
    Object.assign(raw.notes[id(1)], { folder: bad, with: bad, del: w.now });
    const n = N.clean(raw).notes[id(1)];
    assert.equal(n.folder, '');
    assert.equal(n.with, undefined);
  }
  const folders = [{ id: [id(20)], name: 'Invalid' }], notes = [{ id: [id(21)], html: '<p>Invalid</p>' }];
  assert.deepEqual(await w.run({ op: 'import', folders, notes }), { ok: true, done: 0, skipped: 0 });
  const parsed = N.parseExport(JSON.stringify({ format: 'glaze-notes', version: 1, folders, notes,
    files: [{ id: [id(22)], kind: 'file', path: 'files/a.txt', size: 1 }] }), { site: 'https://school.instructure.com' });
  assert.deepEqual(parsed, { folders: [], notes: [], files: [] });
});
