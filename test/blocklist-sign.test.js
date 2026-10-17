// The owner's signing tool (scripts/blocklist-sign.mjs): the key stays private and outside the repo, a list is signed with a
// rising seq and 30 days of life, and what it signs is what the extension accepts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('../lib/blocklist.js');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'scripts/blocklist-sign.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-blocklist-sign-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const load = () => import(tool);
const NOW = Date.parse('2026-10-17T12:34:56.789Z');
const BAD = 'aaaaaaaaaaaaaaaa', HASH = 'wzEaOI1xdoprftf5JrWf_NQBMKNMhHb94dBxHQEBzCY';
const write = (name, value) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(value)); return f; };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('keygen writes a private key only its owner can read, prints the public half and never overwrites', async () => {
  const { keygen } = await load();
  const file = path.join(dir, 'owner.key');
  const pub = keygen(file);
  assert.match(pub, /^[\w-]{43}$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const before = fs.readFileSync(file);
  assert.throws(() => keygen(file), /already exists; refusing to overwrite/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.notEqual(keygen(path.join(dir, 'second.key')), pub, 'every run makes a new key');
  assert.match(fs.readFileSync(file, 'utf8'), /^-----BEGIN PRIVATE KEY-----/);
});

test('keygen refuses a place inside the repo, even through a link', async () => {
  const { keygen } = await load();
  const inside = path.join(root, 'test', 'never-written.key');
  assert.throws(() => keygen(inside), /outside the repo/);
  assert.equal(fs.existsSync(inside), false);
  const link = path.join(dir, 'into-the-repo');
  fs.symlinkSync(path.join(root, 'test'), link);
  assert.throws(() => keygen(path.join(link, 'never-written.key')), /outside the repo/);
  assert.equal(fs.existsSync(inside), false);
});

test('sign: seq one higher and written back, 30 days of life, sorted entries, and the extension accepts the result', async () => {
  const { keygen, sign } = await load();
  const key = path.join(dir, 'sign.key');
  const pub = keygen(key);
  const list = write('list.json', { mods: ['m5xw6z3mn5zxi2lo', BAD, BAD], bundles: [HASH], authors: [], reasons: { [BAD]: 'Sends grades away.' }, note: 'kept in the working file' });
  const out = path.join(dir, 'list.signed.json');
  const first = sign(key, list, out, { now: NOW, force: true });
  assert.equal(first.list.seq, 1);
  assert.deepEqual([first.list.issued, first.list.expires], ['2026-10-17T12:34:56Z', '2026-11-16T12:34:56Z']);
  assert.deepEqual(first.list.mods, [BAD, 'm5xw6z3mn5zxi2lo'], 'sorted, once each');
  assert.deepEqual(read(out), first);
  assert.deepEqual(read(list), { mods: ['m5xw6z3mn5zxi2lo', BAD, BAD], bundles: [HASH], authors: [], reasons: { [BAD]: 'Sends grades away.' }, note: 'kept in the working file', seq: 1 }, 'the working file keeps its fields and gets the seq');
  // What the extension does with it.
  const v = await B.verify(read(out), { key: pub, now: NOW });
  assert.equal(v.ok, true);
  assert.equal(B.match(v.list, { id: BAD }).reason, 'Sends grades away.');
  assert.equal((await B.verify(read(out), { key: pub, now: NOW + 8 * 864e5 })).ok, true);
  assert.equal(B.current({ list: first.list }, NOW + 8 * 864e5), true);
  assert.equal(B.current({ list: first.list }, NOW + 31 * 864e5), false);
  assert.deepEqual(await B.verify(read(out), { key: pub, now: NOW + 31 * 864e5 }), { ok: false, error: 'expired' });
  // The next signing is seq 2, and only that one is accepted over the first.
  const second = sign(key, list, out, { now: NOW + 36e5, force: true });
  assert.equal(second.list.seq, 2);
  assert.equal((await B.verify(read(out), { key: pub, now: NOW, seq: 1 })).ok, true);
  assert.deepEqual(await B.verify(first, { key: pub, now: NOW, seq: 2 }), { ok: false, error: 'rollback' });
});

test('sign refuses a key the extension does not trust, an invalid list, a readable key file or a huge list, and writes nothing', async () => {
  const { keygen, sign } = await load();
  const key = path.join(dir, 'refuse.key');
  keygen(key);
  const good = { mods: [BAD], bundles: [], authors: [], reasons: {} };
  const out = path.join(dir, 'refuse.signed.json');
  const list = write('refuse.json', good);
  const attempt = (name, value, opts = {}) => {
    const l = value === undefined ? list : write(name, value);
    const before = fs.readFileSync(l, 'utf8');
    assert.throws(() => sign(opts.key || key, l, out, { now: NOW, force: true, ...opts }), opts.error, name);
    assert.equal(fs.existsSync(out), false, `${name}: nothing signed`);
    assert.equal(fs.readFileSync(l, 'utf8'), before, `${name}: the working file is untouched`);
  };
  // Not the pinned key (the placeholder is pinned until the owner pastes theirs).
  assert.throws(() => sign(key, list, out, { now: NOW }), /not the key pinned as OWNER_KEY/);
  assert.equal(fs.existsSync(out), false);
  attempt('bad-id.json', { ...good, mods: ['Not-An-Id'] }, { error: /not a valid list/ });
  attempt('bad-hash.json', { ...good, bundles: ['short'] }, { error: /not a valid list/ });
  attempt('stray-reason.json', { ...good, reasons: { bbbbbbbbbbbbbbbb: 'x' } }, { error: /not a valid list/ });
  attempt('long-reason.json', { ...good, reasons: { [BAD]: 'x'.repeat(201) } }, { error: /not a valid list/ });
  attempt('mods-string.json', { ...good, mods: BAD }, { error: /not a valid list/ });
  attempt('bad-seq.json', { ...good, seq: -1 }, { error: /seq must be a whole number/ });
  attempt('bad-seq2.json', { ...good, seq: 1.5 }, { error: /seq must be a whole number/ });
  const loose = path.join(dir, 'loose.key');
  keygen(loose);
  fs.chmodSync(loose, 0o644);
  attempt(undefined, undefined, { key: loose, error: /can be read by others/ });
  // Too big for the extension to take: refused here.
  const many = Array.from({ length: 7000 }, (_, i) => crypto.createHash('sha256').update(String(i)).digest('base64url'));
  attempt('huge.json', { ...good, bundles: many }, { error: /over \d+ bytes/ });
});

test('sign refuses output aliases of the private key or working list without changing either', async () => {
  const { keygen, sign } = await load();
  for (const target of ['key', 'list']) for (const alias of ['direct', 'symlink', 'hardlink']) {
    const name = `${target}-${alias}`;
    const key = path.join(dir, `${name}.key`);
    keygen(key);
    const list = write(`${name}.json`, { mods: [BAD] });
    const dest = target === 'key' ? key : list;
    const out = alias === 'direct' ? dest : path.join(dir, `${name}.out`);
    if (alias === 'symlink') fs.symlinkSync(dest, out);
    if (alias === 'hardlink') fs.linkSync(dest, out);
    const before = [fs.readFileSync(key), fs.readFileSync(list)];
    assert.throws(() => sign(key, list, out, { now: NOW, force: true }), /must not overwrite/, name);
    assert.deepEqual([fs.readFileSync(key), fs.readFileSync(list)], before, name);
  }
});

test('the command line: usage, keygen and sign end to end', async () => {
  const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', cwd: dir });
  assert.equal(run().status, 2);
  assert.equal(run('keygen').status, 2);
  assert.equal(run('sign', 'only-one').status, 2);
  const key = path.join(dir, 'cli.key');
  const made = run('keygen', key);
  assert.equal(made.status, 0, made.stderr);
  assert.match(made.stdout, /PENDING_OWNER_KEY/);
  assert.match(made.stdout, /[\w-]{43}\n$/);
  assert.equal(run('keygen', key).status, 1, 'no overwriting from the command line either');
  const list = write('cli.json', { mods: [BAD], bundles: [], authors: [] });
  const refused = run('sign', key, list);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /not the key pinned/);
  assert.equal(fs.existsSync(path.join(dir, 'cli.signed.json')), false);
  const done = run('sign', key, list, '--force-unpinned');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /Signed seq 1: 1 mods, 0 bundles, 0 authors/);
  const signed = read(path.join(dir, 'cli.signed.json'));
  assert.equal(signed.list.seq, 1);
  assert.equal(read(list).seq, 1);
  const pub = made.stdout.trim().split('\n').pop();
  assert.equal((await B.verify(signed, { key: pub })).ok, true);
});
