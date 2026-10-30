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

test('the permission and zip lists ship the same files, with only exclusions after -x', () => {
  const script = read('package.sh').replace(/\\\n/g, ' ');
  const permissions = script.match(/^chmod -R a\+rX (.+)$/m)[1].trim().split(/\s+/);
  const zip = script.match(/^zip -q -r -X "\$OUT" (.+)$/m)[1].trim().split(/\s+/);
  const exclude = zip.indexOf('-x');
  assert.ok(exclude > 0);
  assert.deepEqual(zip.slice(exclude + 1), ["'*.DS_Store'"], 'runtime files after -x would be excluded');
  assert.deepEqual(zip.slice(0, exclude).sort(), permissions.sort());
  for (const file of ['writer-mcp.js', 'writer-kinds.js', 'pdf-kind.js', 'pdf-kind.css', 'slides-kind.js', 'slides-kind.css']) {
    assert.ok(permissions.includes(file), `${file} needs readable permissions and a place in the zip`);
  }
});

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

test('every web-accessible resource is in the package, and only the art the extension uses', () => {
  const m = JSON.parse(read('manifest.json'));
  const roots = packaged();
  for (const r of m.web_accessible_resources.flatMap((w) => w.resources)) {
    // A pattern is covered by a packaged folder its fixed part is in.
    assert.ok(inPackage(r.split('*')[0].replace(/\/$/, ''), roots) || inPackage(r, roots), `${r} is web-accessible but package.sh leaves it out`);
    if (!r.includes('*')) assert.ok(fs.existsSync(path.join(root, r)), `${r} doesn't exist`);
  }
  // The art the extension uses, and nothing else from assets/art (never its contact sheet or README): the pets, the
  // sticker folders holding Look stickers and the pet game's buddy looks, plus the pointer sets; and the editor's example
  // shaders.
  assert.deepEqual(roots.filter((p) => p.startsWith('assets/')).sort(), ['assets/art/cursors', 'assets/art/pets', 'assets/art/stickers', 'assets/logo-dark.svg', 'assets/logo.svg', 'assets/shaders']);
  const L = require('../lib/lookx.js');
  const files = (dir) => fs.readdirSync(path.join(root, dir), { recursive: true }).filter((f) => !fs.statSync(path.join(root, dir, f)).isDirectory() && !f.endsWith('.DS_Store')).map((f) => `${dir}/${f}`).sort();
  const P = require('../lib/pet.js');
  const art = [...L.BUNDLED.keys(), ...Object.values(P.WEAR).map((x) => `critters/${x.art}`)];
  assert.deepEqual(files('assets/art/stickers'), [...new Set(art)].map(L.file).sort());
  assert.ok(['', '-happy', '-sleepy'].every((s) => L.BUNDLED.has(`critters/study-buddy${s}`)));
  assert.deepEqual(files('assets/art/cursors'), Object.entries(L.CURSORS).flatMap(([c, { svg }]) => ['default', 'pointer'].flatMap((k) => [`${k}.png`, ...(svg ? [`${k}.svg`, `${k}@2x.png`] : [])]).map((f) => `assets/art/cursors/${c}/${f}`)).sort());
});

test('every relative link and source in the extension\'s pages is a file the package ships', () => {
  // The editor once linked PRIVACY.md, which isn't packaged: the link opened a missing extension page.
  const roots = packaged();
  for (const page of fs.readdirSync(root).filter((f) => f.endsWith('.html'))) {
    assert.ok(inPackage(page, roots), `${page} is left out`);
    for (const [, url] of read(page).matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      // Another site's address, an anchor, or a root path (the preview's stand-in Ultra links to its own pages).
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(url) || !url) continue;
      const file = url.split(/[?#]/)[0];
      assert.ok(fs.existsSync(path.join(root, file)) && inPackage(file, roots), `${page} links ${url}, which the package doesn't ship`);
    }
  }
});
