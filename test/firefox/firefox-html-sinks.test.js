// Firefox Add-ons' linter warns on every innerHTML or outerHTML assignment, insertAdjacentHTML and document.write, and a
// release needs zero warnings (RELEASING.md). Writer and ProseMirror parse HTML with DOMParser or build elements instead;
// older features' sinks are rewritten on dev/firefox.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '../../extension');
const shipped = execFileSync('git', ['ls-files', '-z', '--', '*.js', '*.mjs'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter((f) => /(?:^|\/)(?:writer|papers)[-.]|^vendor\/pm\.js$/.test(f) && !/^(test|scripts|safari)\//.test(f));
const SINK = /\.(?:inner|outer)HTML\s*=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/;

test('Writer\'s scripts and ProseMirror write no HTML through the sinks Firefox Add-ons flags', () => {
  assert.ok(shipped.includes('vendor/pm.js') && shipped.includes('writer/page/writer.js'), 'the scan covers vendored and own code');
  const found = shipped.flatMap((f) => fs.readFileSync(path.join(root, f), 'utf8').split('\n')
    .map((line, i) => (SINK.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean));
  assert.deepEqual(found, []);
});

test('ProseMirror parses pasted HTML with DOMParser, as scripts/vendor-prosemirror.sh patches it', () => {
  const pm = fs.readFileSync(path.join(root, 'vendor/pm.js'), 'utf8');
  assert.match(pm, /doc3 = new globalThis\.DOMParser\(\)\.parseFromString\(maybeWrapTrusted\("<body>" \+ html\), "text\/html"\);\n {4}elt = doc3\.body;/);
});

// Pearson's scripts and the MathLive runtime they load (tools/vendor/vendor-mathlive.sh rewrites its sinks): the 4.0.3
// Firefox package failed its lint on 23 of these.
test('Pearson\'s scripts and MathLive write no HTML through the sinks Firefox Add-ons flags', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'content/pearson.js', 'pearson', 'vendor/mathlive'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter((f) => /\.m?js$/.test(f));
  assert.ok(files.includes('vendor/mathlive/mathlive.mjs') && files.includes('content/pearson.js') && files.includes('pearson/render.mjs'), 'the scan covers MathLive and Pearson\'s own code');
  const found = files.flatMap((f) => fs.readFileSync(path.join(root, f), 'utf8').split('\n')
    .map((line, i) => (SINK.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean));
  assert.deepEqual(found, []);
});
