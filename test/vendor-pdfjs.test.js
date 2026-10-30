// The Chrome Web Store rejects minified pdf.js as obfuscated code (2026-10-26, quoting core-js's old-IE fallback, which
// builds a javascript: URL and an ActiveXObject). Glaze ships pdf.js's readable legacy build, without that fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const modules = fs.readdirSync(path.join(root, 'lib/pdfjs')).filter((f) => /\.m?js$/.test(f));
// A call of the old global escape or unescape function; not a method (RegExp.escape), core-js's $escape, or its definition.
const OLD_ESCAPE = /(?<![\w$.]|function )(?:un)?escape\s*\(/;

test('the readable pdf.js modules ship, and only those; the reader loads the two it needs', () => {
  assert.deepEqual(modules.sort(), ['pdf.mjs', 'pdf.worker.mjs', 'pdf_viewer.mjs']);
  const reader = read('reader.js');
  assert.match(reader, /lib\/pdfjs\/pdf\.mjs/);
  assert.match(reader, /lib\/pdfjs\/pdf\.worker\.mjs/);
  assert.doesNotMatch(reader, /\.min\.mjs/);
});

test('the pdf.js modules and the viewer stylesheet are readable: short lines, no source map left pointing at a file that is not shipped', () => {
  for (const f of [...modules, 'pdf_viewer.css']) {
    const lines = read(`lib/pdfjs/${f}`).split('\n');
    const average = lines.reduce((n, l) => n + l.length, 0) / lines.length;
    assert.ok(average < 80, `lib/pdfjs/${f} averages ${Math.round(average)} characters a line`);
    assert.ok(!lines.some((l) => /sourceMappingURL/.test(l)), `lib/pdfjs/${f} names a source map`);
  }
});

test("core-js's old-IE fallback is gone from every module", () => {
  for (const f of modules) {
    const src = read(`lib/pdfjs/${f}`);
    assert.ok(!/ActiveXObject|javascript:|['"]java['"]\s*\+/i.test(src), `lib/pdfjs/${f} has the old-IE fallback`);
    assert.ok(src.includes('module.exports = Object.create || function create(O, Properties)'), `lib/pdfjs/${f} lost the Object.create polyfill`);
  }
});

test('each module names the pinned version and the script that built it', () => {
  const version = read('scripts/vendor-pdfjs.sh').match(/^version=(\S+)$/m)[1];
  for (const f of modules) assert.equal(read(`lib/pdfjs/${f}`).split('\n')[0], `// pdf.js ${version} legacy build (Apache-2.0, lib/pdfjs/LICENSE). Built by scripts/vendor-pdfjs.sh.`);
});

test('the core-js bundled into each module ships its pinned MIT permission notice', () => {
  const script = read('scripts/vendor-pdfjs.sh');
  const license = read('lib/pdfjs/LICENSE_CORE_JS');
  const version = script.match(/^core_js=(\S+)$/m)[1];
  for (const f of modules) assert.ok(read(`lib/pdfjs/${f}`).includes(`license: 'https://github.com/zloirock/core-js/blob/v${version}/LICENSE'`), f);
  assert.match(license, /Copyright \(c\) 2013–2025 Denis Pushkarev/);
  assert.match(license, /Copyright \(c\) 2025–2026 CoreJS Company/);
  assert.match(license, /The above copyright notice and this permission notice shall be included/);
  const hash = require('node:crypto').createHash('sha256').update(license).digest('hex');
  assert.equal(hash, script.match(/^core_js_license_sha256=(\S+)$/m)[1]);
});

test('no module makes code from text: no eval, and core-js keeps no Function fallback', () => {
  for (const f of modules) {
    const src = read(`lib/pdfjs/${f}`);
    assert.doesNotMatch(src, /\beval\s*\(/, `lib/pdfjs/${f} calls eval`);
    assert.doesNotMatch(src, /(^|[^\w$.])Function\s*\(\s*['"`]/m, `lib/pdfjs/${f} makes a function from text`);
  }
});

// The worker's Brotli decoder ships no packed data (scripts/vendor-pdfjs-brotli.js): it reads Brotli's dictionary from
// google/brotli's dictionary.bin beside it, and its tables are numbers. It still undoes real Brotli: Node's own
// compressor, at its best setting, leans on that dictionary and its transforms.
test("the worker's Brotli decoder reads the pinned dictionary file, keeps no packed strings, and still undoes Brotli", () => {
  const crypto = require('node:crypto');
  const vm = require('node:vm');
  const zlib = require('node:zlib');
  const script = read('scripts/vendor-pdfjs.sh');
  const dictionary = fs.readFileSync(path.join(root, 'lib/pdfjs/brotli-dictionary.bin'));
  assert.equal(crypto.createHash('sha256').update(dictionary).digest('hex'), script.match(/^brotli_dictionary_sha256=(\S+)$/m)[1]);
  assert.match(read('lib/pdfjs/LICENSE_BROTLI'), /by the Brotli Authors/);
  const src = read('lib/pdfjs/pdf.worker.mjs');
  assert.match(src, /\nlet BROTLI_DICTIONARY = null;\ntry \{\n  const response = await fetch\(new URL\("\.\/brotli-dictionary\.bin", import\.meta\.url\)\);/);
  const code = src.slice(src.indexOf('let makeBrotliDecode = () => {'), src.indexOf('\nlet BrotliDecode = makeBrotliDecode();'));
  assert.doesNotMatch(code, /\^ 3;|\^ 236;|charCodeAt\([^)]*\) - \d|unpackDictionaryData/);
  const decoder = (bytes) => vm.runInNewContext(`(${code.slice(code.indexOf('() =>')).replace(/;\s*$/, '')})()`, { BROTLI_DICTIONARY: bytes });
  const decode = decoder(new Uint8Array(dictionary));
  for (const text of ['Homework 3 is due Friday at 11:59 pm; the midterm covers chapters four to six. ',
    '<div class="syllabus"><h2>Office hours</h2><p>Tuesday and Thursday</p></div> ', 'Привет, мир. 你好，世界。 नमस्ते। Größe, café. ']) {
    const input = Buffer.from(text.repeat(30));
    const packed = zlib.brotliCompressSync(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } });
    const out = decode(new Int8Array(packed.buffer, packed.byteOffset, packed.length));
    assert.ok(Buffer.from(out.buffer, out.byteOffset, out.length).equals(input), text.slice(0, 20));
  }
  // Without the file, a Brotli stream fails on its own; nothing else needs it.
  assert.throws(() => decoder(null)(new Int8Array(4)), /Brotli dictionary unavailable/);
  assert.match(script, /\nnode scripts\/vendor-pdfjs-brotli\.js lib\/pdfjs\/pdf\.worker\.mjs lib\/pdfjs\/brotli-dictionary\.bin\n/);
});

// pdf.js used the old escape and unescape functions for UTF-8, file names and the viewer's link hashes;
// scripts/vendor-pdfjs.sh writes them out. Each replacement gives what the original gave, and throws where it threw, on
// text built to hit every edge.
test("pdf.js's escape and unescape calls are written out and decode exactly as before", () => {
  const vm = require('node:vm');
  const pick = (src, name) => src.slice(src.indexOf(`function ${name}(str) {`), src.indexOf('\n}\n', src.indexOf(`function ${name}(str) {`)) + 2);
  const sample = (n) => {
    const pool = ['a', 'Z', '0', ' ', '%', '%4', '%41', '%u00e9', '%u12', '@', '*', '/', '+', '.', '_', '-', '~', '"', '\x00', '\x7f', '\x80', '\xc3', '\xa9',
      '\xe2', '\x82', '\xac', '\xf0', '\x9f', '\x98', '\x80', '\xff', 'é', '€', '😀', '\ud800', '\udc00', 'ẞ'];
    return Array.from({ length: n }, (_, i) => pool[(i * 7 + n * 13) % pool.length]).join('');
  };
  const outcome = (f, s) => { try { return ['ok', f(s)]; } catch (e) { return ['throws', e.constructor.name]; } };
  for (const f of modules) assert.doesNotMatch(read(`lib/pdfjs/${f}`), OLD_ESCAPE, `lib/pdfjs/${f} still calls escape or unescape`);
  for (const f of ['pdf.mjs', 'pdf.worker.mjs']) {
    const src = read(`lib/pdfjs/${f}`);
    const ctx = vm.createContext({});
    vm.runInContext(pick(src, 'stringToUTF8String') + pick(src, 'utf8StringToString'), ctx);
    for (let n = 0; n < 400; n++) {
      const s = sample(n % 40), bytes = s.replace(/[^\x00-\xff]/g, 'x');
      assert.deepEqual(outcome(ctx.stringToUTF8String, s), outcome((x) => decodeURIComponent(escape(x)), s), `stringToUTF8String ${JSON.stringify(s)}`);
      assert.deepEqual(outcome(ctx.stringToUTF8String, bytes), outcome((x) => decodeURIComponent(escape(x)), bytes), `stringToUTF8String ${JSON.stringify(bytes)}`);
      assert.deepEqual(outcome(ctx.utf8StringToString, s), outcome((x) => unescape(encodeURIComponent(x)), s), `utf8StringToString ${JSON.stringify(s)}`);
    }
  }
  const network = read('lib/pdfjs/pdf.mjs');
  const percent = network.match(/\n    filename = filename(\.replace\(.*\));\n/)[1];
  assert.ok(network.includes(`\n        part = part${percent};\n`));
  const decode = vm.runInNewContext(`(s) => s${percent}`);
  for (let n = 0; n < 400; n++) { const s = sample(n % 40); assert.equal(decode(s), unescape(s), JSON.stringify(s)); }
  // The viewer writes a destination into a link's #hash, and reads one back out of the address.
  const viewer = read('lib/pdfjs/pdf_viewer.mjs');
  const hashOf = viewer.match(/\n        return this\.getAnchorUrl\("#" \+ dest(\.replace\(.*\))\);\n/)[1];
  assert.ok(viewer.includes(`\n        return this.getAnchorUrl("#" + str${hashOf});\n`));
  const encode = vm.runInNewContext(`(s) => s${hashOf}`);
  for (let n = 0; n < 400; n++) { const s = sample(n % 40); assert.equal(encode(s), escape(s), JSON.stringify(s)); }
  for (const line of ['    dest = hash%;', '    console.error(`PDFLinkService.setHash: "${hash%}" is not a valid destination.`);',
    '    const hash = getCurrentHash()%.substring(1);']) assert.ok(viewer.includes(`\n${line.replace('%', () => percent)}\n`), line);
});

// The three modules, loaded once, in node with no DOM library: pdf.mjs and its worker as they are, then the viewer, which
// at load asks for an animation frame and reads the page's root style and a new element's style, to learn which CSS it
// can use; a stub of those three is there only while it loads.
let loaded = null;
const load = () => loaded ||= (async () => {
  const { pathToFileURL } = require('node:url');
  const url = (f) => pathToFileURL(path.join(root, 'lib/pdfjs', f)).href;
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = () => {}; // pdf.js warns at import that node has no canvas
  try {
    const pdfjs = await import(url('pdf.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = url('pdf.worker.mjs');
    const worker = await import(url('pdf.worker.mjs'));
    globalThis.window = { requestAnimationFrame() {} };
    globalThis.document = { documentElement: { style: {} }, createElement: () => ({ style: {} }) };
    try { return { pdfjs, worker, viewer: await import(url('pdf_viewer.mjs')) }; } finally { delete globalThis.window; delete globalThis.document; }
  } finally { [console.log, console.warn] = [log, warn]; }
})();

test('pdf.mjs, its worker and the viewer load in node, the viewer with only a stub of the page it styles', async () => {
  const { pdfjs, worker, viewer } = await load();
  assert.equal(pdfjs.version, read('scripts/vendor-pdfjs.sh').match(/^version=(\S+)$/m)[1]);
  for (const name of ['getDocument', 'AnnotationEditorType', 'AnnotationMode', 'GlobalWorkerOptions']) assert.ok(pdfjs[name], name);
  assert.equal(typeof worker.WorkerMessageHandler, 'function');
  for (const name of ['PDFViewer', 'EventBus', 'PDFLinkService', 'PDFFindController', 'PDFScriptingManager', 'GenericL10n', 'AnnotationLayerBuilder', 'TextLayerBuilder']) {
    assert.equal(typeof viewer[name], 'function', name);
  }
});

test('the viewer stylesheet ships with every picture it names, each only a picture, under the licences beside them', () => {
  const script = read('scripts/vendor-pdfjs.sh');
  const css = read('lib/pdfjs/pdf_viewer.css');
  assert.equal(css.split('\n')[0], `/* pdf.js ${script.match(/^version=(\S+)$/m)[1]} legacy viewer styles (Apache-2.0, lib/pdfjs/LICENSE). Built by scripts/vendor-pdfjs.sh. */`);
  assert.doesNotMatch(css, /@import|url\(\s*["']?(?:[a-z]+:)?\/\//i, 'the stylesheet reaches nothing outside the extension');
  const named = [...new Set([...css.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]).filter((u) => !/^(?:data:|#)/.test(u)))].sort();
  assert.ok(named.length > 20 && named.every((u) => /^images\/[\w-]+\.(?:svg|gif)$/.test(u)), named.join(', '));
  assert.deepEqual(fs.readdirSync(path.join(root, 'lib/pdfjs/images')).sort().map((f) => `images/${f}`), named);
  let mpl = 0;
  for (const f of named.filter((u) => u.endsWith('.svg'))) {
    const svg = read(`lib/pdfjs/${f}`);
    assert.doesNotMatch(svg, /<script|<foreignObject|javascript:|\son\w+\s*=|href\s*=\s*["'](?!#)/i, `lib/pdfjs/${f} is more than a picture`);
    // pdf.js's own pictures are under its Apache-2.0 licence; one of Firefox's carries the MPL-2.0 notice instead.
    if (/Mozilla Public\s+(?:-\s+)?License, v\. 2\.0/.test(svg)) mpl++;
  }
  assert.ok(mpl > 0);
  assert.match(read('lib/pdfjs/LICENSE'), /Apache License\s+Version 2\.0/);
  assert.match(read('lib/pdfjs/LICENSE_MPL'), /^Mozilla Public License Version 2\.0\n/);
  const crypto = require('node:crypto');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'lib/pdfjs/LICENSE_MPL'))).digest('hex'), script.match(/^mpl_license_sha256=(\S+)$/m)[1]);
});

// A PDF can carry JavaScript for its forms, which pdf.js runs in a sandbox it imports (pdf.sandbox.mjs, not shipped).
// scripts/vendor-pdfjs.sh cuts that import: the viewer imports nothing, and a document with scripts opens without them.
test('the viewer runs no PDF scripts: its import of the form-script sandbox is cut', async () => {
  const src = read('lib/pdfjs/pdf_viewer.mjs');
  assert.doesNotMatch(src, /\bimport\s*\(|QuickJSSandbox/);
  assert.match(src, /\nclass GenericScripting \{\n  constructor\(\) \{\n    \/\/ .+\n    throw new Error\("PDF scripts are off in Glaze\."\);\n  \}\n/);
  const { viewer } = await load();
  const said = [], error = console.error;
  globalThis.window = { addEventListener() {} };
  console.error = (...args) => said.push(args);
  try {
    const manager = new viewer.PDFScriptingManager({ eventBus: new viewer.EventBus() });
    await manager.setDocument({ getFieldObjects: async () => new Map([['total', [{ id: '7R' }]]]), getCalculationOrderIds: async () => null,
      getJSActions: async () => ({ OpenAction: ['app.alert("hi")'] }) });
    assert.equal(manager.ready, false);
  } finally { console.error = error; delete globalThis.window; }
  assert.deepEqual(said.map(([where, e]) => [where, e?.message]), [['setDocument:', 'PDF scripts are off in Glaze.']]);
});

// ---- extractPages, in node ----------------------------------------------------------------------------------------------
// A tiny PDF: a page per entry, its label printed on it, with its own /Rotate or one its page tree gives every page.
const pdfOf = (pages, { treeRotate } = {}) => {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const { label = '', rotate } of pages) {
    const text = label ? `BT /F1 24 Tf 20 20 Td (${label}) Tj ET` : '';
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R${rotate === undefined ? '' : ` /Rotate ${rotate}`} >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length}${treeRotate === undefined ? '' : ` /Rotate ${treeRotate}`} >>`;
  let out = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  return new TextEncoder().encode(`${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
};
const A = pdfOf([{ label: 'A1' }, { label: 'A2', rotate: 90 }, { label: 'A3' }]);
const B = pdfOf([{ label: 'B1' }], { treeRotate: 180 });
const BLANK = pdfOf([{}]);
// pdf.js reads its own bytes back: each page as its text ('' for a blank one) and its rotation (its /Rotate, or its tree's).
const opened = async (bytes) => (await load()).pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
const pagesOf = async (bytes) => {
  const doc = await opened(bytes);
  try {
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      out.push(`${(await page.getTextContent()).items.map((item) => item.str).join('')} ${page.rotate}`);
    }
    return out;
  } finally { await doc.loadingTask.destroy(); }
};
// extractPages on A, as the pages panel will call it; a document entry of bytes merges that file in.
const fromA = async (pageInfos) => {
  const doc = await opened(A);
  try { return await doc.extractPages(pageInfos); } finally { await doc.loadingTask.destroy(); }
};

test('extractPages rearranges pages in node: reorder, delete, duplicate, merge, and a blank page merged in', async () => {
  assert.deepEqual(await pagesOf(A), ['A1 0', 'A2 90', 'A3 0']);
  assert.deepEqual(await pagesOf(B), ['B1 180'], 'the page tree turns its page');
  assert.deepEqual(await pagesOf(await fromA([{ document: null, includePages: [0, 1, 2], pageIndices: [2, 0, 1] }])), ['A2 90', 'A3 0', 'A1 0'], 'reorder');
  assert.deepEqual(await pagesOf(await fromA([{ document: null, excludePages: [1] }])), ['A1 0', 'A3 0'], 'delete');
  assert.deepEqual(await pagesOf(await fromA([{ document: null, includePages: [0] }, { document: null, includePages: [0] }, { document: null, includePages: [1] }])),
    ['A1 0', 'A1 0', 'A2 90'], 'duplicate');
  assert.deepEqual(await pagesOf(await fromA([{ document: null }, { document: B.slice() }])), ['A1 0', 'A2 90', 'A3 0', 'B1 180'], 'merge keeps an inherited turn');
  // A blank page is the page of a one-page empty PDF, merged in (pdf.js's own blank is an image page, which needs a canvas).
  assert.deepEqual(await pagesOf(await fromA([{ document: null, includePages: [0] }, { document: BLANK.slice() }, { document: null, includePages: [1, 2] }])),
    ['A1 0', ' 0', 'A2 90', 'A3 0'], 'blank page');
});

// The one patch to pdf.js's code (scripts/vendor-pdfjs.sh): an entry's rotations[i] turns its source page i further.
test("extractPages turns pages by each entry's rotations: /Rotate is the page's own turn plus the extra, mod 360", async () => {
  assert.deepEqual(await pagesOf(await fromA([{ document: null, rotations: [90, 270, -90] }, { document: B.slice(), rotations: { 0: 90 } }])),
    ['A1 90', 'A2 0', 'A3 270', 'B1 270']);
  assert.deepEqual(await pagesOf(await fromA([{ document: null, includePages: [2, 0], pageIndices: [0, 1], rotations: { 2: 180 } }])), ['A1 0', 'A3 180'],
    'keyed by source page, wherever the page lands');
  assert.deepEqual(await pagesOf(await fromA([{ document: null, includePages: [1] }, { document: null, includePages: [1], rotations: { 1: 450 } }])), ['A2 90', 'A2 180'],
    'each copy of a page turns on its own');
  for (const bad of [45, 1.5, '90']) assert.equal(await fromA([{ document: null, rotations: [bad] }]), null, `${JSON.stringify(bad)} is refused, as pdf.js refuses a bad entry`);
});
