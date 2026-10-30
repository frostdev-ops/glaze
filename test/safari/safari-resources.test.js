// Safari's app bundles only what its Xcode project lists for the two extension targets (Mac and iOS); the release
// scripts put the Chrome package in the project's Resources folder and build the project as it is. So everything the
// package ships, and everything the manifest, the loader and the pages name, must be listed there (scripts/safari-resources.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const S = require('../scripts/safari-resources.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const m = require('../manifest.json');
// The paths package.sh zips (as test/package.test.js reads them), and every file under them.
const roots = read('package.sh').match(/^zip -q -r -X "\$OUT" ([\s\S]*?)-x /m)[1].replace(/\\\n/g, ' ').trim().split(/\s+/);
// Code mods' sandbox files (mods/) are Chrome's alone: scripts/safari-manifest.sh drops them from the staged copy, as Safari
// has no manifest sandbox.
const shipped = roots.flatMap((r) => (fs.statSync(path.join(root, r)).isDirectory() ? S.walk(path.join(root, r), `${r}/`) : [r])).filter((f) => !f.startsWith('mods/') && f !== 'features/mods.js');

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
    ...m.web_accessible_resources.flatMap((w) => w.resources).filter((r) => !r.startsWith('mods/')).flatMap((r) => shipped.filter((f) => new RegExp(`^${r.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`).test(f))),
    // On demand (lib/background.js LOADABLE), and each site's stylesheets (content.js SHEETS: theme, motion, extras; `${site}.css`).
    ...JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"')).filter((f) => f !== 'features/mods.js'),
    'theme.css', 'motion.css', 'extras.css', 'canvas.css', 'moodle.css',
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

// Safari has no manifest sandbox (MDN: not on macOS or iOS), so, as in the Firefox package, code mods' sandbox page, CSP,
// bootstrap and their web-accessible entries go from every staged copy: each staging path runs scripts/safari-manifest.sh on
// the unzipped Chrome package before the resource check and the build. The page side goes too.
test('the Safari staging drops code mods\' sandbox and keeps everything else bundled', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-safari-stage-'));
  try {
    execFileSync('bash', ['package.sh'], { cwd: root, env: { ...process.env, DIST: dist }, stdio: 'pipe' });
    const stage = path.join(dist, 'Resources');
    execFileSync('unzip', ['-q', path.join(dist, `glaze-v${m.version}.zip`), '-d', stage]);
    assert.ok(fs.existsSync(path.join(stage, 'mods/host.html')), 'the Chrome package has them');
    execFileSync('sh', [path.join(root, 'scripts/safari-manifest.sh'), path.join(stage, 'manifest.json')]);
    const staged = S.walk(stage);
    const sm = JSON.parse(fs.readFileSync(path.join(stage, 'manifest.json'), 'utf8'));
    assert.ok(!staged.some((f) => f.startsWith('mods/') || f === 'features/mods.js'), 'no host, bootstrap or sandbox content runtime');
    // Declarative widgets are not code: their page side, the renderer they share and the cleaner stay.
    for (const f of ['features/modwidgets.js', 'features/modui.js', 'lib/modwidget.js']) assert.ok(staged.includes(f), `${f} stays`);
    assert.equal(sm.sandbox, undefined);
    assert.equal(sm.content_security_policy.sandbox, undefined);
    assert.ok(sm.web_accessible_resources.every((e) => e.resources.length && e.resources.every((r) => !r.startsWith('mods/'))));
    assert.deepEqual(S.missing(staged), [], 'what is staged is all bundled (scripts/safari-resources.js passes)');
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
  for (const f of ['scripts/package-safari.sh', 'scripts/appstore-safari.sh', 'scripts/appstore-ios.sh', 'scripts/stage-safari-dmg.py']) {
    const src = read(f), unzip = src.indexOf('unzip'), rewrite = src.indexOf('safari-manifest.sh');
    assert.ok(unzip > 0 && rewrite > unzip, `${f} rewrites the staged manifest after unzipping`);
    const check = src.indexOf('safari-resources.js');
    assert.ok(check === -1 || check > rewrite, `${f}: before its resource check`);
  }
});
