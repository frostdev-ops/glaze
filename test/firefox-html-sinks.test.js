// Firefox Add-ons' linter warns on every innerHTML or outerHTML assignment, insertAdjacentHTML and document.write, and a
// release needs zero warnings (RELEASING.md). Writer and ProseMirror parse HTML with DOMParser or build elements instead;
// older features' sinks are rewritten on dev/firefox.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const shipped = execFileSync('git', ['ls-files', '-z', '--', '*.js', '*.mjs'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter((f) => /(?:^|\/)(?:writer|papers)[-.]|^lib\/pm\.js$/.test(f) && !/^(test|scripts|safari)\//.test(f));
const SINK = /\.(?:inner|outer)HTML\s*=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/;

test('Writer\'s scripts and ProseMirror write no HTML through the sinks Firefox Add-ons flags', () => {
  assert.ok(shipped.includes('lib/pm.js') && shipped.includes('features/writer.js'), 'the scan covers vendored and own code');
  const found = shipped.flatMap((f) => fs.readFileSync(path.join(root, f), 'utf8').split('\n')
    .map((line, i) => (SINK.test(line) ? `${f}:${i + 1}` : null)).filter(Boolean));
  assert.deepEqual(found, []);
});

test('ProseMirror parses pasted HTML with DOMParser, as scripts/vendor-prosemirror.sh patches it', () => {
  const pm = fs.readFileSync(path.join(root, 'lib/pm.js'), 'utf8');
  assert.match(pm, /doc3 = new globalThis\.DOMParser\(\)\.parseFromString\(maybeWrapTrusted\(html\), "text\/html"\);\n {4}elt = doc3\.body;/);
});
