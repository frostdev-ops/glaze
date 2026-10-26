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
