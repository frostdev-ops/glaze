// Safari's app bundles only what its Xcode project lists for the two extension targets (Mac and iOS); the release
// scripts put the Chrome package in the project's Resources folder and build the project as it is. So everything the
// package ships, and everything the manifest, the loader and the pages name, must be listed there (scripts/safari-resources.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../scripts/safari-resources.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const m = require('../manifest.json');
// The paths package.sh zips (as test/package.test.js reads them), and every file under them.
const roots = read('package.sh').match(/^zip -q -r -X "\$OUT" ([\s\S]*?)-x /m)[1].replace(/\\\n/g, ' ').trim().split(/\s+/);
const shipped = roots.flatMap((r) => (fs.statSync(path.join(root, r)).isDirectory() ? S.walk(path.join(root, r), `${r}/`) : [r]));

test('the parser reads both extension targets, and what each leaves out', () => {
  const sets = S.bundled();
  assert.deepEqual(Object.keys(sets).sort(), [...S.TARGETS].sort());
  for (const t of S.TARGETS) assert.ok(sets[t].has('manifest.json') && sets[t].has('lib/'), t);
  assert.deepEqual(S.missing(['lib/zip.js', 'nowhere.js']), S.TARGETS.map((t) => [t, 'nowhere.js']), 'a folder covers its files; nothing else does');
});

test('both Safari extension targets bundle every file the package ships', () => {
  assert.ok(shipped.length > 100 && shipped.includes('content-ultra.js') && shipped.includes('features/palette.js'));
  assert.deepEqual(S.missing(shipped), []);
});

test('and everything the manifest, the loader, the stylesheets and the preview name', () => {
  const named = [
    ...m.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    m.background.service_worker, m.action.default_popup, m.options_ui.page, ...Object.values(m.icons),
    // Web-accessible patterns: the files they match.
    ...m.web_accessible_resources.flatMap((w) => w.resources).flatMap((r) => shipped.filter((f) => new RegExp(`^${r.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(f))),
    // On demand (lib/background.js LOADABLE), and each site's stylesheets (content.js SHEETS: theme, motion, extras; `${site}.css`).
    ...JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"')),
    'theme.css', 'motion.css', 'extras.css', 'canvas.css', 'moodle.css', 'apps.css',
    ...[...read('preview.html').matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]),
  ];
  assert.ok(named.includes('content-canvas.js') && named.includes('assets/art/pets/cat/sprites.webp') && named.includes('features/lookx.css'));
  for (const f of named) assert.ok(shipped.includes(f), `${f} is named but not packaged`);
  assert.deepEqual(S.missing([...new Set(named)]), []);
});

test('every Safari release script checks its staged resources against the project before it builds', () => {
  for (const f of ['scripts/appstore-safari.sh', 'scripts/appstore-ios.sh', 'scripts/build-safari.sh']) {
    const src = read(f);
    const check = src.search(/^node scripts\/safari-resources\.js "\$/m);
    assert.ok(check > 0, `${f} runs the check`);
    assert.ok(check < src.indexOf('xcodebuild'), `${f}: before xcodebuild`);
  }
});
