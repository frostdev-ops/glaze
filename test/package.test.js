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

test('every web-accessible resource is in the package, and only the stickers the extension uses', () => {
  const m = JSON.parse(read('manifest.json'));
  const roots = packaged();
  for (const r of m.web_accessible_resources.flatMap((w) => w.resources)) {
    // A pattern is covered by a packaged folder its fixed part is in.
    assert.ok(inPackage(r.split('*')[0].replace(/\/$/, ''), roots) || inPackage(r, roots), `${r} is web-accessible but package.sh leaves it out`);
    if (!r.includes('*')) assert.ok(fs.existsSync(path.join(root, r)), `${r} doesn't exist`);
  }
  // The study buddy's three pictures, not the whole sticker folder.
  assert.deepEqual(roots.filter((p) => p.startsWith('assets/art/stickers')).sort(),
    ['', '-happy', '-sleepy'].map((s) => `assets/art/stickers/critters/study-buddy${s}.webp`).sort());
});
