const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// The paths package.sh zips: the arguments of its `zip` command, up to the first option after them.
const packaged = () => {
  const cmd = read('package.sh').match(/^zip -q -r -X "\$OUT" ([\s\S]*?)-x /m)[1];
  return cmd.replace(/\\\n/g, ' ').trim().split(/\s+/);
};
const inPackage = (file, roots) => roots.some((r) => file === r || file.startsWith(`${r}/`));

test('every file the loader may inject is in the package', () => {
  const list = read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1];
  const files = JSON.parse(list.replace(/'/g, '"'));
  const roots = packaged();
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is loadable but doesn't exist`);
    assert.ok(inPackage(f, roots), `${f} is loadable but package.sh leaves it out`);
  }
});

test('every manifest content script and stylesheet is in the package', () => {
  const m = JSON.parse(read('manifest.json'));
  const roots = packaged();
  for (const cs of m.content_scripts) for (const f of [...(cs.js || []), ...(cs.css || [])]) assert.ok(inPackage(f, roots), `${f} is left out`);
});
