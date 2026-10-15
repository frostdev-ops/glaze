// PDF and picture import (W23). lib/doctext.js's helpers for them; features/import.js handing a file to the reader's
// frame; then every fixture in test/fixtures/import (made by scripts/import-fixtures.js and scripts/import-check.js;
// none is a real student's) through the code the reader runs: pdf.js (lib/pdfjs) for PDFs, the OCR worker itself
// (lib/ocr.js, in a vm with a worker's globals) for pictures and scanned pages, and each import flow's extractor
// (lib/classes.js, lib/syllabus.js, lib/gpa.js). A fixture's accuracy is the share of its known fields the extractor
// got exactly right. Each is printed and must not fall below what was measured when this was written (ACCURACY).
// What the reader does in a browser (decoding pictures, drawing scanned pages, the frame) is scripts/import-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const D = require('../lib/doctext.js');
const C = require('../lib/classes.js');
globalThis.GZ_CLASSES = C; // lib/syllabus.js reads class times with it
const S = require('../lib/syllabus.js');
const G = require('../lib/gpa.js');

const root = path.join(__dirname, '..');
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures/import', f));
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ---- the helpers ---------------------------------------------------------------------------------------------------
test('kind: by the first bytes where they say, else by name and type', () => {
  assert.equal(D.kind('notes.txt', 'text/plain', ascii('%PDF-1.7\n')), 'pdf', 'a PDF with the wrong name still reads');
  assert.equal(D.kind('scan', '', fixture('timetable-photo.jpg').subarray(0, 16)), 'image');
  assert.equal(D.kind('x', '', fixture('timetable.png').subarray(0, 16)), 'image');
  assert.equal(D.kind('x', '', fixture('timetable.webp').subarray(0, 16)), 'image');
  assert.equal(D.kind('IMG_0001.HEIC', '', ascii('\0\0\0\x18ftypheic\0\0\0\0')), 'image');
  assert.equal(D.kind('a.avif', '', ascii('\0\0\0\x1cftypavif')), 'image');
  assert.equal(D.kind('Transcript.PDF', ''), 'pdf');
  assert.equal(D.kind('photo', 'image/heic'), 'image');
  assert.equal(D.kind('s.docx', '', ascii('PK\x03\x04')), 'docx');
  assert.equal(D.kind('s.pptx', ''), 'pptx');
  assert.equal(D.kind('page.HTM', ''), 'html');
  assert.equal(D.kind('notes.md', ''), 'text');
  assert.equal(D.kind('data.xlsx', ''), '');
});

test('imageSize: from the header, before decoding', () => {
  assert.deepEqual(D.imageSize(fixture('timetable.png')), { w: 860, h: 600 });
  assert.deepEqual(D.imageSize(fixture('timetable.webp')), { w: 860, h: 600 });
  assert.deepEqual(D.imageSize(fixture('timetable-photo.jpg')), { w: 860, h: 600 });
  const b = (n, ...xs) => { const u = new Uint8Array(n); xs.forEach(([at, v]) => u.set(v, at)); return u; };
  assert.deepEqual(D.imageSize(b(10, [0, ascii('GIF89a')], [6, [0x20, 0x03, 0x58, 0x02]])), { w: 800, h: 600 });
  assert.deepEqual(D.imageSize(b(26, [0, ascii('BM')], [18, [0x40, 0x1f, 0, 0]], [22, [0x30, 0xe8, 0xff, 0xff]])), { w: 8000, h: 6096 }, 'a BMP stored top-down');
  // A JPEG whose frame header comes after a big EXIF block (a phone's thumbnail).
  const jpeg = b(70010, [0, [0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]], [65539, [0xff, 0xc0, 0, 17, 8, 0x0b, 0xd0, 0x0f, 0xc0]]);
  assert.deepEqual(D.imageSize(jpeg), { w: 4032, h: 3024 });
  // HEIC: a grid's whole picture (its largest 'ispe'), not a 512-pixel tile's.
  const heic = b(120, [4, ascii('ftypheic')], [40, ascii('ispe')], [48, [0, 0, 2, 0, 0, 0, 2, 0]], [80, ascii('ispe')], [88, [0, 0, 0x0f, 0xc0, 0, 0, 0x0b, 0xd0]]);
  assert.deepEqual(D.imageSize(heic), { w: 4032, h: 3024 });
  assert.equal(D.imageSize(ascii('%PDF-1.7')), null);
  assert.equal(D.imageSize(b(30, [0, [0xff, 0xd8, 0x00]])), null, 'a broken JPEG says nothing');
});

test('pgm: grey on white paper; a mostly dark picture turned around', () => {
  const px = (...rgba) => Uint8ClampedArray.from(rgba);
  const body = (p) => [...p.subarray(p.length - 2)];
  const light = D.pgm(px(255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255), 3, 1);
  assert.equal(new TextDecoder().decode(light.subarray(0, 11)), 'P5\n3 1\n255\n');
  assert.deepEqual(body(light), [255, 0]);
  assert.deepEqual(body(D.pgm(px(20, 20, 20, 255, 230, 230, 230, 255, 20, 20, 20, 255), 3, 1)), [25, 235], 'dark theme: light text becomes dark ink');
  assert.deepEqual(body(D.pgm(px(0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0), 3, 1)), [0, 255], 'transparent is paper');
});

test('pdfText: runs in drawing order; a new line, a tab across a cell gap, a space across a word gap', () => {
  // y up, as in a PDF; the page's viewport flips it.
  const run = (str, x, y, width, size = 10, hasEOL = false) => ({ str, transform: [size, 0, 0, size, x, y], width, hasEOL });
  const page = { vt: [1, 0, 0, -1, 0, 792], items: [
    run('Course', 50, 700, 30), run(' ', 80, 700, 40), run('Title', 120, 700, 22), { type: 'beginMarkedContent' },
    run('BIO', 50, 685, 16), run('1100', 68, 685, 20), run('Biology', 120, 685, 35, 10, true),
    run('', 0, 0, 0, 0, true),
    run('Two columns: the right one', 320, 700, 120), run('starts a line, not a cell.', 50, 600, 110),
  ] };
  assert.equal(D.pdfText([page]), 'Course\tTitle\nBIO 1100\tBiology\nTwo columns: the right one\nstarts a line, not a cell.');
  assert.equal(D.pdfText([page, { items: [run('Page two', 50, 700, 40)] }]).split('\n\n')[1], 'Page two', 'pages are split by a blank line');
  // A page turned a quarter: its text reads across the page as shown.
  const turned = { vt: [0, 1, 1, 0, 0, 0], items: [{ str: 'Fall', transform: [0, 10, -10, 0, 700, 50], width: 20 }, { str: '2025', transform: [0, 10, -10, 0, 700, 73], width: 22 }] };
  assert.equal(D.pdfText([turned]), 'Fall 2025');
});

test('ocrText: lines, cells by their gaps, slips mended, and how sure it was', () => {
  const word = (text, x0, x1, confidence = 95) => ({ text, confidence, bbox: { x0, y0: 10, x1, y1: 24 } });
  const line = (...words) => ({ bbox: { x0: 0, y0: 6, x1: 500, y1: 40 }, words });
  const r = D.ocrText({ blocks: [{ paragraphs: [{ lines: [
    line(word('MATH', 0, 40), word('1350', 46, 80), word('Calculus', 120, 180), word('|', 186, 190, 60), word('©', 200, 204, 20)),
    line(word('‘Principles', 0, 80, 40), word('MTWR_', 100, 150)),
    line(word('Chemistry', 0, 70), word('||', 76, 82)),
    line(word('=', 0, 5, 10)),
  ] }] }] });
  assert.equal(r.text, 'MATH 1350\tCalculus I\nPrinciples\tMTWR\nChemistry II');
  assert.deepEqual(r.unsure, ['MATH 1350\tCalculus I', 'Principles\tMTWR']);
  assert.equal(r.conf, Math.round((95 * 3 + 60 + 40 + 95 + 95 + 95) / 8));
  assert.deepEqual(D.ocrText({}), { text: '', conf: 0, unsure: [] });
});

// ---- features/import.js: the reader's frame -------------------------------------------------------------------------
const importer = () => {
  const frames = [];
  const document = {
    documentElement: { append: (f) => { f.parent = true; frames.push(f); } },
    createElement: () => {
      const f = { style: {}, attrs: {}, on: {}, posted: [], parent: false, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.parent = false; } };
      f.addEventListener = (type, fn) => { f.on[type] = fn; };
      f.contentWindow = { postMessage: (m, origin, ports) => f.posted.push({ m, origin, ports }) };
      return f;
    },
  };
  const timers = [];
  const ctx = vm.createContext({
    document, MessageChannel, URL, Uint8Array, Blob, Promise,
    setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {},
    chrome: { runtime: { getURL: (p) => `chrome-extension://glazeid/${p}` } },
    GZ_I18N: { locale: () => 'de' }, GZ_DOCTEXT: D,
    GZ_CTX: { t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'de-DE', need: async () => {} },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'features/import.js'), 'utf8'), ctx);
  return { I: ctx.GZ_IMPORT, frames, timers };
};
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };

test('import: a PDF goes to the reader page in a frame of its own, over a channel only it holds, to its origin only', async () => {
  const { I, frames } = importer();
  const file = new File([fixture('timetable.pdf')], 'timetable.pdf');
  const said = [];
  const p = I.read(file, { progress: (s) => said.push(s) });
  await settle();
  const [f] = frames;
  assert.equal(f.src, 'chrome-extension://glazeid/reader.html');
  assert.equal(f.attrs['aria-hidden'], 'true');
  assert.equal(f.tabIndex, -1);
  assert.equal(f.posted.length, 0, 'nothing is sent before the reader has loaded');
  f.on.load();
  const [{ m, origin, ports }] = f.posted;
  assert.equal(origin, 'chrome-extension://glazeid', 'never "*": a frame the page navigated elsewhere gets nothing');
  assert.deepEqual([m.type, m.kind, m.file, [...m.langs]], ['glaze:read', 'pdf', file, ['deu']], 'with the page language’s OCR model');
  assert.equal(ports.length, 1);
  ports[0].postMessage({ type: 'progress', stage: 'text', page: 1, pages: 2 });
  ports[0].postMessage({ type: 'progress', stage: 'text', page: 1, pages: 2 });
  ports[0].postMessage({ type: 'done', text: 'BIO 1100', pages: 2, ocr: null });
  const r = await p;
  assert.equal(r.text, 'BIO 1100');
  assert.deepEqual(said, ['Reading page 1 of 2…'], 'the same words once');
  assert.equal(f.parent, false, 'the frame is gone once the text is back');
});

test('import: a read called off, failed or gone quiet removes the frame and says why', async () => {
  const { I, frames, timers } = importer();
  const ctl = new AbortController();
  const p1 = I.read(new File([fixture('timetable.png')], 'a.png'), { signal: ctl.signal });
  await settle();
  ctl.abort();
  await assert.rejects(p1, (e) => e.cancelled === true);
  assert.equal(frames[0].parent, false);

  const p2 = I.read(new File([ascii('%PDF-1.7 locked')], 'x.pdf'));
  await settle();
  frames[1].on.load();
  frames[1].posted[0].ports[0].postMessage({ type: 'error', code: 'locked' });
  await assert.rejects(p2, (e) => e.mine && /protected by a password/.test(e.message));
  assert.equal(frames[1].parent, false);

  const p3 = I.read(new File([ascii('%PDF-1.7')], 'y.pdf'));
  await settle();
  timers.at(-1).fn(); // a minute without a word from the reader
  await assert.rejects(p3, (e) => e.mine && /couldn't read that file/.test(e.message));
  assert.equal(frames[2].parent, false);
});

test('import: text, web pages and Word stay in the page; other files are refused with what Glaze reads', async () => {
  const { I, frames } = importer();
  assert.deepEqual({ ...await I.read(new File(['MWF 9-9:50'], 'a.txt', { type: 'text/plain' })) }, { text: 'MWF 9-9:50', ocr: null });
  assert.equal((await I.read(new File(['<table><tr><td>A</td><td>93</td></tr></table>'], 'a.html'))).text, 'A\t93');
  await assert.rejects(I.read(new File(['x'], 'grades.xlsx')), (e) => e.mine && /Glaze reads PDFs, pictures/.test(e.message));
  await assert.rejects(I.read(new File(['PK'], 'broken.docx')), (e) => e.mine && /couldn't read that file/.test(e.message));
  assert.equal(frames.length, 0);
  assert.equal(I.note(null), '');
  assert.match(I.note({ conf: 92, unsure: [] }), /^Glaze read this from a picture\. Check it/);
  assert.match(I.note({ conf: 92, unsure: ['x'] }), /wasn't sure of some of it/);
  assert.equal(I.doubt({ unsure: ['BIO 1100\tBiology\tMWF 9:00'] }, 'BIO 1100'), true);
  assert.equal(I.doubt({ unsure: ['ENG 1100'] }, 'BIO 1100'), false);
});

// ---- the engines, as the reader runs them ----------------------------------------------------------------------------
let pdfjs = null;
const pdf = async (bytes) => {
  if (!pdfjs) {
    const [log, warn] = [console.log, console.warn];
    console.log = console.warn = () => {}; // pdf.js warns at import that node has no canvas; text needs none
    try { pdfjs = await import(pathToFileURL(path.join(root, 'lib/pdfjs/pdf.min.mjs')).href); } finally { [console.log, console.warn] = [log, warn]; }
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'lib/pdfjs/pdf.worker.min.mjs')).href;
  }
  return pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
};
const pdfText = async (bytes) => {
  const task = await pdf(bytes);
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); pages.push({ items: (await p.getTextContent()).items, vt: p.getViewport({ scale: 1 }).transform }); }
    return pages.map((p) => D.pdfText([p]));
  } finally { await task.destroy(); }
};

// lib/ocr.js itself, in a vm with what a worker in the extension has: importScripts, fetch of its own files (anything
// else fails the test), DecompressionStream, postMessage.
const ocrWorker = () => {
  const asked = [];
  let answer = null, started = null;
  const own = (u) => { const url = new URL(u); asked.push(url.href); assert.ok(url.href.startsWith('chrome-extension://glaze/lib/'), `fetched ${url.href}`); return fs.readFileSync(path.join(root, url.pathname)); };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, URL, TextDecoder, TextEncoder, WebAssembly, Response, DecompressionStream, setTimeout, clearTimeout, performance, crypto,
    location: { href: 'chrome-extension://glaze/lib/ocr.js' },
    fetch: async (u) => new Response(own(String(u)), { headers: { 'content-type': String(u).endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }),
    postMessage: (m) => { if (m.type !== 'progress') answer?.(m); },
    WorkerGlobalScope: function WorkerGlobalScope() {},
  };
  ctx.self = ctx;
  ctx.importScripts = (p) => vm.runInContext(own(new URL(p, ctx.location.href)).toString(), ctx);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/ocr.js'), 'utf8'), ctx);
  const ask = (m) => new Promise((r) => { answer = r; ctx.onmessage({ data: m }); });
  // Started as the reader starts it for an English page, with a language it hasn't got thrown in.
  const start = () => (started ||= ask({ type: 'start', langs: ['eng', 'klingon'] }));
  return { asked, start, read: async (image) => { await start(); const r = await ask({ type: 'read', image }); assert.equal(r.type, 'done', r.why); return D.ocrText(JSON.parse(r.json)); } };
};
// A Chrome screenshot (8-bit RGB or RGBA PNG) as canvas pixels, for D.pgm as the reader makes it.
const png = (buf) => {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), type = buf[25];
  assert.ok(buf[24] === 8 && (type === 2 || type === 6) && !buf[28], 'an 8-bit RGB(A) PNG, not interlaced');
  const idat = [];
  for (let i = 8; i < buf.length; i += 12 + buf.readUInt32BE(i)) if (buf.toString('latin1', i + 4, i + 8) === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + buf.readUInt32BE(i)));
  const raw = zlib.inflateSync(Buffer.concat(idat)), n = type === 6 ? 4 : 3, stride = w * n, rgba = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= n ? cur[x - n] : 0, b = prev[x], c = x >= n ? prev[x - n] : 0, p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      cur[x] = line[x] + [0, a, b, (a + b) >> 1, paeth][f];
    }
    for (let x = 0; x < w; x++) { rgba.set(cur.subarray(x * n, x * n + 3), (y * w + x) * 4); rgba[(y * w + x) * 4 + 3] = n === 4 ? cur[x * 4 + 3] : 255; }
    prev = cur;
  }
  return D.pgm(rgba, w, h);
};
// A scanned page's picture, decoded by pdf.js, as canvas pixels (the reader draws the page instead; node has no canvas).
const scanned = async (bytes, n) => {
  const task = await pdf(bytes);
  const page = await (await task.promise).getPage(n);
  const ops = await page.getOperatorList();
  const name = ops.argsArray[ops.fnArray.indexOf(pdfjs.OPS.paintImageXObject)][0];
  const img = await new Promise((r) => page.objs.get(name, r));
  const { width: w, height: h, data } = img, k = data.length / (w * h), rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba.set(k === 1 ? [data[i], data[i], data[i]] : data.subarray(i * k, i * k + 3), i * 4); rgba[i * 4 + 3] = 255; }
  await task.destroy();
  return D.pgm(rgba, w, h);
};

// ---- what each flow makes of it, scored --------------------------------------------------------------------------
const FALL = Date.UTC(2026, 7, 24);
// Class schedule: per class, its meeting (days, start, end) and its place. Extra classes are counted apart.
const TIMETABLE = [['BIO 1100', '135', '09:00', '09:50', 'Science Hall 120'], ['BIO 1100L', '2', '14:00', '16:50', 'Science Hall 214'],
  ['ENG 1100', '24', '11:00', '12:15', 'Humanities 302'], ['MATH 1350', '1234', '13:00', '13:50', 'Math Building 105'], ['HIST 2010', '13', '15:30', '16:45', 'Library 210']];
const schedule = (text) => {
  const r = C.fromText(text, { lang: 'en', now: Date.UTC(2026, 9, 15) });
  let ok = 0;
  for (const [code, days, start, end, loc] of TIMETABLE) {
    const ps = r.entries.filter((e) => e.code === code || new RegExp(`\\b${code}\\b`).test(e.label)).flatMap((e) => e.periods);
    if (ps.some((p) => p.days.join('') === days && C.hhmm(p.start) === start && C.hhmm(p.end) === end)) ok++;
    if (ps.some((p) => p.loc === loc)) ok++;
  }
  const extra = r.entries.filter((e) => !TIMETABLE.some(([code]) => e.code === code || new RegExp(`\\b${code}\\b`).test(e.label))).length;
  return { ok, of: TIMETABLE.length * 2, extra };
};
// Syllabus: professor, office, each office hour and class time, each letter of the scale, each weight, each date.
const SYLLABI = {
  bio: { name: 'Dr. Amara Okafor', email: 'aokafor@frostdale.edu', office: 'Science Hall 214', hours: ['TU TH 14:00-15:30'],
    meetings: ['MO WE FR 09:00-09:50 | Science Hall 120', 'TU 14:00-16:50 | Science Hall 214'], scale: ['A 93', 'A- 90', 'B+ 87', 'B 83', 'B- 80', 'C 70', 'D 60', 'F 0'],
    weights: ['Homework 20', 'Lab reports 25', 'Midterm exam 20', 'Final exam 35'], dates: ['2026-10-14 exam', '2026-11-20 due', '2026-12-15 exam'] },
  hist: { name: 'Prof. Daniel Reyes', email: 'dreyes@frostdale.edu', office: 'Library 305', hours: ['MO 13:00-14:30'], meetings: ['MO WE 15:30-16:45 | Library 210'],
    scale: ['A 94', 'A- 90', 'B+ 87', 'B 84', 'B- 80', 'C 70', 'D 60', 'F 0'], weights: ['Reading responses 15', 'Map quizzes 10', 'Midterm exam 25', 'Research paper 25', 'Final exam 25'],
    dates: ['2026-09-16 exam', '2026-10-21 exam', '2026-11-18 due', '2026-12-14 exam'] },
};
const syllabus = (want) => (text) => {
  const r = S.extract(text, { start: FALL, md: true, hint: 'en' });
  const got = { hours: r.hours.map((m) => `${m.days.join(' ')} ${m.start}-${m.end}`), meetings: r.meetings.map((m) => `${m.days.join(' ')} ${m.start}-${m.end} | ${m.location}`),
    scale: (r.scale.value || []).map(([l, v]) => `${l} ${v}`), weights: (r.weights.value || []).map((w) => `${w.name} ${w.weight}`), dates: r.dates.map((d) => `${d.day} ${d.kind}`) };
  let ok = ['name', 'email', 'office'].filter((k) => r.prof[k].value === want[k]).length, of = 3;
  for (const k of ['hours', 'meetings', 'scale', 'weights', 'dates']) { of += want[k].length; ok += want[k].filter((x) => got[k].includes(x)).length; }
  return { ok, of, extra: Object.keys(got).reduce((n, k) => n + got[k].filter((x) => !want[k].includes(x)).length, 0) };
};
// Transcript: each term's name and GPA, each course's name, credits and grade.
const TRANSCRIPT = [['Fall 2025', 3.48, [['BIO 1000 Foundations of Biology', 3, 'A-'], ['CHEM 1010 General Chemistry I', 4, 'B+'], ['ENG 1000 Academic Writing', 3, 'A'], ['MATH 1300 Precalculus', 3, 'B']]],
  ['Spring 2026', 3.46, [['PSY 1010 Introduction to Psychology', 3, 'A'], ['CHEM 1020 General Chemistry II', 4, 'B'], ['COMM 1100 Public Speaking', 3, 'A-'], ['MATH 1340 Statistics', 3, 'B+'], ['ART 1050 Drawing I', 2, 'P']]],
  ['Summer 2026', 4, [['HIST 1500 American History', 3, 'A']]]];
const transcript = (text) => {
  const terms = G.parse(text);
  let ok = 0, of = 0;
  for (const [name, gpa, rows] of TRANSCRIPT) {
    const t = terms.find((x) => x.n === name);
    of += 2 + rows.length * 3;
    if (!t) continue;
    ok += 1 + (t.gpa === gpa);
    for (const [n, cr, g] of rows) {
      const c = t.c.find((x) => x.n === n) || t.c.find((x) => x.n.split(' ').slice(0, 2).join(' ') === n.split(' ').slice(0, 2).join(' '));
      if (c) ok += (c.n === n) + (c.cr === cr) + (c.g === g);
    }
  }
  return { ok, of, extra: terms.reduce((n, t) => n + t.c.length, 0) - 10 };
};

// [fixture, how it is read, what reads it, lowest accuracy accepted]: the floor is what this code measured, so a change
// that reads worse fails.
const ocr = ocrWorker();
const ACCURACY = [
  ['timetable.pdf', 'text layer', schedule, 1],
  ['syllabus.pdf', 'text layer', syllabus(SYLLABI.bio), 1],
  ['syllabus-2col.pdf', 'text layer, two columns', syllabus(SYLLABI.hist), 20 / 22], // B and F wrap onto the next line of their column
  ['transcript.pdf', 'text layer', transcript, 1],
  ['transcript-scan.pdf', 'no text layer: OCR of the page', transcript, 34 / 36], // "P" read as "r"; Chemistry "II" as "I!", mended
  ['timetable.png', 'OCR, screenshot', schedule, 1],
  ['timetable.webp', 'OCR, screenshot', schedule, 1],
  // Tilted, soft and small: the meetings mostly come through, the places don't (the cells' gaps are lost), and
  // "BIO 1100L" reads as "BIO 1100.". The review marks every row of it; the student corrects there.
  ['timetable-photo.jpg', 'OCR, phone photo', schedule, 0.4],
  ['canvas-schedule-light.png', 'OCR, Canvas screenshot, light', schedule, 1],
  ['canvas-schedule-dark.png', 'OCR, Canvas screenshot, dark', schedule, 1],
];

test('the OCR worker starts on the bundled models only, and refuses a language it doesn\'t have', async () => {
  assert.deepEqual({ ...await ocr.start() }, { type: 'ready' });
  assert.deepEqual(ocr.asked.map((u) => u.replace('chrome-extension://glaze/', '')).sort(), ['lib/tesseract/eng.traineddata.gz', 'lib/tesseract/tesseract-core-simd-lstm.js', 'lib/tesseract/tesseract-core-simd-lstm.wasm']);
});

test('PDFs: a locked one says so, a broken one fails, a scanned one has no text layer', async () => {
  const locked = await pdf(fixture('locked.pdf'));
  await assert.rejects(locked.promise, (e) => e.name === 'PasswordException', 'the reader tells the student it is password-protected');
  const broken = await pdf(ascii('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF'));
  await assert.rejects(broken.promise.then((d) => d.getPage(1)));
  await Promise.all([locked.destroy(), broken.destroy()]);
  assert.deepEqual((await pdfText(fixture('transcript-scan.pdf'))).map((t) => t.replace(/\s/g, '').length), [0], 'the reader OCRs it');
});

test('extraction accuracy, per fixture', async (t) => {
  const table = [], low = [];
  for (const [f, how, score, floor] of ACCURACY) {
    if (!fs.existsSync(path.join(__dirname, 'fixtures/import', f))) { t.diagnostic(`${f}: missing (scripts/import-check.js makes it)`); continue; }
    const bytes = fixture(f);
    const at = Date.now();
    let text, conf = '';
    if (f.endsWith('.pdf') && how.startsWith('text')) text = (await pdfText(bytes)).join('\n\n');
    else {
      // A scanned page and a PNG as the reader hands them over (grey pixels); the photo and WebP as files, which the
      // engine decodes itself (node can't decode them; the browser run is scripts/import-check.js).
      const image = f.endsWith('.pdf') ? await scanned(bytes, 1) : f.endsWith('.png') ? png(bytes) : new Uint8Array(bytes);
      const r = await ocr.read(image);
      text = r.text;
      conf = ` OCR confidence ${r.conf}, unsure lines ${r.unsure.length},`;
    }
    const s = score(text);
    table.push(`${f} (${how}):${conf} ${s.ok}/${s.of} = ${Math.round((s.ok / s.of) * 100)}%, extra ${s.extra}, ${Date.now() - at} ms`);
    if (s.ok / s.of < floor - 1e-9) low.push(`${f}: ${s.ok}/${s.of}, below ${floor}\n${text}`);
  }
  t.diagnostic(`accuracy\n${table.join('\n')}`);
  assert.deepEqual(low, []);
});
