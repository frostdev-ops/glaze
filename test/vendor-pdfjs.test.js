// The Chrome Web Store rejects minified pdf.js as obfuscated code (2026-10-26, quoting core-js's old-IE fallback, which
// builds a javascript: URL and an ActiveXObject). Glaze ships pdf.js's readable legacy build, without that fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const modules = fs.readdirSync(path.join(root, 'lib/pdfjs')).filter((f) => /\.m?js$/.test(f));

test('the reader loads the readable pdf.js modules, and only those ship', () => {
  assert.deepEqual(modules.sort(), ['pdf.mjs', 'pdf.worker.mjs']);
  const reader = read('reader.js');
  assert.match(reader, /lib\/pdfjs\/pdf\.mjs/);
  assert.match(reader, /lib\/pdfjs\/pdf\.worker\.mjs/);
  assert.doesNotMatch(reader, /\.min\.mjs/);
});

test('the pdf.js modules are readable: short lines, no source map left pointing at a file that is not shipped', () => {
  for (const f of modules) {
    const lines = read(`lib/pdfjs/${f}`).split('\n');
    const average = lines.reduce((n, l) => n + l.length, 0) / lines.length;
    assert.ok(average < 80, `lib/pdfjs/${f} averages ${Math.round(average)} characters a line`);
    assert.ok(!lines.some((l) => /sourceMappingURL/.test(l)), `lib/pdfjs/${f} names a source map`);
  }
});

test("core-js's old-IE fallback is gone from both modules", () => {
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

test('neither module makes code from text: no eval, and core-js keeps no Function fallback', () => {
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
