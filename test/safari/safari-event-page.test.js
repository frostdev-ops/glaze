// Safari runs Glaze's background as an event page, never a service worker (tools/build/event-page.js says why): its manifest,
// as tools/build/safari-manifest.sh makes it, loads the shim, every script the worker imports and then the worker, each
// one a file Safari ships.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const E = require('../../tools/build/event-page.js');

const root = path.join(__dirname, '../../extension');
const source = fs.readFileSync(path.join(root, 'background/background.js'), 'utf8');
const DROP = fs.readFileSync(path.join(__dirname, '../../tools/build/safari-drop.txt'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
const dropped = (f) => DROP.some((d) => (d.endsWith('/') ? f.startsWith(d) : f === d));
// Safari's manifest from a staged copy: with its own worker beside it, or (a bare manifest) the checkout's.
const safari = (withWorker) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-safari-event-page-'));
  try {
    fs.copyFileSync(path.join(root, 'manifest.json'), path.join(dir, 'manifest.json'));
    if (withWorker) { fs.mkdirSync(path.join(dir, 'background')); fs.writeFileSync(path.join(dir, 'background/background.js'), withWorker); }
    execFileSync('sh', [path.join(__dirname, '../../tools/build/safari-manifest.sh'), path.join(dir, 'manifest.json')]);
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('Safari\'s background is a non-persistent event page of the shim, every import in order, then the worker', () => {
  const { background } = safari(null);
  assert.equal(background.service_worker, undefined);
  assert.equal(background.persistent, false);
  assert.equal(background.scripts[0], 'background/event-page.js');
  assert.equal(background.scripts.at(-1), 'background/background.js');
  assert.deepEqual(background.scripts, E.scripts(source));
  assert.equal(new Set(background.scripts).size, background.scripts.length, 'each script once');
  const top = E.imports(source);
  assert.ok(top.length > 20 && top.every((f) => background.scripts.includes(f)), 'every script the worker imports');
  for (const f of ['courses/download.js', 'pearson/embed.js', 'writer/drafts.js', 'documents/doc-files.js', 'i18n/pt-BR.js']) assert.ok(background.scripts.includes(f), f);
  for (const f of background.scripts) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} is a background script but isn't in the extension`);
    assert.ok(!dropped(f), `${f} is a background script but Safari drops it`);
  }
});

test('a staged copy\'s own worker decides the list', () => {
  const { background } = safari("importScripts('../core/a.js', '../core/b.js');\nimportScripts('../core/a.js');\n");
  assert.deepEqual(background, { scripts: ['background/event-page.js', 'core/a.js', 'core/b.js', 'background/background.js'], persistent: false });
});

test('the shim leaves a real importScripts alone and stands in where there is none', () => {
  const run = (g) => { new Function('globalThis', fs.readFileSync(path.join(root, 'background/event-page.js'), 'utf8'))(g); return g; };
  const real = () => 'real';
  assert.equal(run({ importScripts: real }).importScripts, real);
  assert.equal(run({}).importScripts(), undefined);
});
