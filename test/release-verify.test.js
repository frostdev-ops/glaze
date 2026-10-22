// The checks that stand between a built release and an upload: verify (store packages), verifyPublic (the DMG, its signed
// feed and the checksums), the refusals to release older than the live feed or to move a published tag or asset.
// Pure helpers and throwaway files only; the stages that upload, tag or deploy are never run.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-verify-'));
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const write = (dir, file, data) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), data); return { path: file, sha256: sha(data) }; };
const store = () => import('../scripts/store-release.mjs');
const pub = () => import('../scripts/public-release.mjs');

// ---- store-release verify: what must be true of the saved packages before any upload ----

const built = (dir, stores = ['chrome', 'firefox'], applePlatforms = []) => ({
  ready: true, stores, applePlatforms,
  files: {
    chrome: write(dir, 'glaze-v1.0.0.zip', 'chrome zip'),
    firefox: write(dir, 'glaze-v1.0.0-firefox.zip', 'firefox zip'),
    firefoxSource: write(dir, 'glaze-v1.0.0-source.zip', 'source zip'),
    MAC_OS: write(dir, 'glaze-1.0.0-appstore.pkg', 'pkg'),
    IOS: write(dir, 'glaze-1.0.0-ios.ipa', 'ipa'),
  },
});

test('verify passes for intact packages and ignores stores that were not selected', async () => {
  const { verify } = await store(), dir = scratch();
  try {
    const manifest = built(dir);
    assert.doesNotThrow(() => verify(manifest, dir));
    delete manifest.files.IOS; // not selected, so not needed
    assert.doesNotThrow(() => verify(manifest, dir));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify refuses packages that were never completed', async () => {
  const { verify } = await store(), dir = scratch();
  try {
    const manifest = built(dir);
    manifest.ready = false;
    assert.throws(() => verify(manifest, dir), /Packages are incomplete\. Run build or release first\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify refuses a package whose bytes changed since they were checksummed', async () => {
  const { verify } = await store(), dir = scratch();
  try {
    const manifest = built(dir);
    fs.appendFileSync(path.join(dir, 'glaze-v1.0.0-firefox.zip'), 'x');
    assert.throws(() => verify(manifest, dir), /Checksum changed for glaze-v1\.0\.0-firefox\.zip; refusing upload\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify requires every artifact of every selected store, Apple platforms included', async () => {
  const { verify } = await store(), dir = scratch();
  try {
    let manifest = built(dir);
    delete manifest.files.firefoxSource;
    assert.throws(() => verify(manifest, dir), /Artifact firefoxSource is required/);
    manifest = built(dir, ['chrome', 'apple'], ['MAC_OS', 'IOS']);
    delete manifest.files.IOS;
    assert.throws(() => verify(manifest, dir), /Artifact IOS is required/);
    manifest = built(dir, ['chrome', 'apple'], ['MAC_OS']);
    assert.doesNotThrow(() => verify(manifest, dir));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verify refuses an artifact path that leaves the release directory', async () => {
  const { verify } = await store(), dir = scratch(), outside = scratch();
  try {
    const manifest = built(path.join(dir, 'out'));
    const file = write(outside, 'evil.zip', 'chrome zip');
    manifest.files.chrome = { path: path.relative(path.join(dir, 'out'), path.join(outside, 'evil.zip')), sha256: file.sha256 };
    assert.throws(() => verify(manifest, path.join(dir, 'out')), /Artifact path leaves the release directory\./);
    manifest.files.chrome = { path: path.join(outside, 'evil.zip'), sha256: file.sha256 };
    assert.throws(() => verify(manifest, path.join(dir, 'out')), /leaves the release directory/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('verify refuses an artifact symlink that leaves the release directory', async () => {
  const { verify } = await store(), outer = scratch(), out = path.join(outer, 'release');
  try {
    const manifest = built(out, ['chrome']);
    const file = path.join(out, manifest.files.chrome.path);
    fs.renameSync(file, path.join(outer, 'outside.zip'));
    fs.symlinkSync(path.join(outer, 'outside.zip'), file);
    assert.throws(() => verify(manifest, out), /Artifact path leaves the release directory/);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

// ---- public-release: never older than the live feed, never a version that is already in it ----

test('a candidate that is already in the live feed is never rebuilt', async () => {
  const { refuseStaleCandidate } = await pub();
  assert.throws(() => refuseStaleCandidate([{ version: '3.3.3' }, { version: '3.3.4' }], '3.3.4'), /already in the public feed\. Resume its original --out\/--source-ref; do not rebuild it\./);
});

test('a candidate older than anything in the live feed is refused, at any component', async () => {
  const { refuseStaleCandidate } = await pub();
  for (const live of ['3.3.5', '3.4.0', '4.0.0', '3.10.0']) {
    assert.throws(() => refuseStaleCandidate([{ version: live }], '3.3.4'), /older than the public update feed; bump it before releasing\./, live);
  }
});

test('a newer candidate passes, however the feed is ordered', async () => {
  const { refuseStaleCandidate } = await pub();
  assert.doesNotThrow(() => refuseStaleCandidate([{ version: '3.3.3' }, { version: '3.2.9' }, { version: '2.9.9' }], '3.3.4'));
  assert.doesNotThrow(() => refuseStaleCandidate([{ version: '3.3.4-rc1' }, { version: '3.9.0-beta' }], '3.3.4'), 'non-release labels are not ordered against it');
  assert.doesNotThrow(() => refuseStaleCandidate([], '1.0.0'));
  assert.doesNotThrow(() => refuseStaleCandidate([{ version: '3.3.9' }, { version: '3.3.3' }].reverse(), '3.4.0'));
  assert.throws(() => refuseStaleCandidate([{ version: '3.3.3' }, { version: '3.3.9' }], '3.3.4'), /older than the public update feed/, 'a newer entry anywhere in the feed counts');
});

test('the signed feed must keep every existing entry byte for byte', async () => {
  const { preservesFeed } = await pub();
  const base = [{ version: '3.3.2', url: 'u2', length: '2' }, { version: '3.3.3', url: 'u3', length: '3' }];
  const next = [{ version: '3.3.4', url: 'u4', length: '4' }, ...base];
  assert.doesNotThrow(() => preservesFeed(base, next));
  assert.throws(() => preservesFeed(base, next.slice(0, 2)), /would replace or drop existing version 3\.3\.3/);
  assert.throws(() => preservesFeed(base, [next[0], { ...base[0], length: '999' }, base[1]]), /would replace or drop existing version 3\.3\.2/);
  assert.throws(() => preservesFeed(base, [...next, next[0]]), /unique and nonempty/);
  assert.throws(() => preservesFeed(base, [{ url: 'x' }, ...base]), /unique and nonempty/);
});

// ---- public-release: GitHub assets are only replaced while the release is a draft ----

test('asset action: matching bytes are kept, whatever the release state', async () => {
  const { assetAction } = await pub();
  assert.equal(assetAction({ draft: true }, 'a.dmg', { name: 'a.dmg' }, true), 'keep');
  assert.equal(assetAction({ draft: false }, 'a.dmg', { name: 'a.dmg' }, true), 'keep');
});

test('asset action: a draft gets missing assets uploaded and different ones replaced', async () => {
  const { assetAction } = await pub();
  assert.equal(assetAction({ draft: true }, 'a.dmg', undefined, false), 'upload');
  assert.equal(assetAction({ draft: true }, 'a.dmg', { name: 'a.dmg' }, false), 'replace');
});

test('asset action: a published release is never changed, whether the asset is missing or different', async () => {
  const { assetAction } = await pub();
  for (const existing of [undefined, { name: 'a.dmg' }]) {
    assert.throws(() => assetAction({ draft: false }, 'a.dmg', existing, false), /Published release asset a\.dmg is missing or different; refusing to change a published candidate\./);
  }
});

test('publishing uploads with --clobber only when the draft action says replace', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/public-release.mjs'), 'utf8');
  assert.match(source, /assetAction\(release, path\.basename\(file\), existing, [^\n]*\)/);
  assert.match(source, /\.\.\.\(action === 'replace' \? \['--clobber'\] : \[\]\)/);
  assert.doesNotMatch(source, /existing \? \['--clobber'\]/, 'clobbering must go through the draft check');
});

// ---- public-release: an existing tag at another commit is never moved ----

const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).trim();

test('checkTag accepts an unused tag or one at the release commit, and refuses one at another commit, remote or local', async () => {
  const { checkTag } = await pub(), base = scratch();
  try {
    const bare = path.join(base, 'origin.git'), work = path.join(base, 'work');
    gitIn(base, 'init', '-q', '--bare', '--initial-branch=main', bare);
    gitIn(base, 'clone', '-q', bare, work);
    fs.writeFileSync(path.join(work, 'a'), '1'); gitIn(work, 'add', 'a'); gitIn(work, 'commit', '-qm', 'one');
    const first = gitIn(work, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(work, 'a'), '2'); gitIn(work, 'commit', '-qam', 'two');
    const second = gitIn(work, 'rev-parse', 'HEAD');
    const env = process.env;
    assert.doesNotThrow(() => checkTag({ version: '1.0.0', sourceCommit: second }, work, env), 'no tag anywhere');
    gitIn(work, 'tag', '-a', 'v1.0.0', first, '-m', 'one');
    assert.throws(() => checkTag({ version: '1.0.0', sourceCommit: second }, work, env), /v1\.0\.0 already identifies another commit\. Published tags are never moved; bump the version\./, 'local tag elsewhere');
    assert.doesNotThrow(() => checkTag({ version: '1.0.0', sourceCommit: first }, work, env), 'local tag at the release commit');
    gitIn(work, 'push', '-q', 'origin', 'v1.0.0');
    gitIn(work, 'tag', '-d', 'v1.0.0');
    assert.throws(() => checkTag({ version: '1.0.0', sourceCommit: second }, work, env), /never moved/, 'remote tag elsewhere');
    assert.doesNotThrow(() => checkTag({ version: '1.0.0', sourceCommit: first }, work, env), 'annotated remote tag at the release commit');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ---- public-release verifyPublic: the DMG, the signed feed and the checksum files ----

const hasPython = spawnSync('python3', ['--version']).status === 0;
const VERSION = '9.9.9', NAME = `glaze-${VERSION}-safari-macos`;
const feed = (entries) => `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Glaze</title>
${entries.map((e) => `<item><enclosure url="${e.url}" length="${e.length}" type="application/octet-stream" sparkle:version="${e.version}" sparkle:edSignature="${e.signature}"/></item>`).join('\n')}
</channel></rss>
`;

// A complete public/ directory, signed with a throwaway Ed25519 key that the environment names as the update key.
const publicRelease = (dir, { sign = true, mutate } = {}) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const dmgBytes = Buffer.from('dmg bytes');
  const entry = {
    version: VERSION, url: `https://github.com/frostdev-ops/glaze/releases/download/v${VERSION}/${NAME}.dmg`, length: dmgBytes.length,
    signature: crypto.sign(null, dmgBytes, privateKey).toString('base64'),
  };
  if (mutate) mutate(entry);
  const files = {
    dmg: write(dir, `public/${NAME}.dmg`, dmgBytes),
    macZip: write(dir, `public/${NAME}.zip`, 'zip'),
    dmgChecksum: write(dir, `public/${NAME}.dmg.sha256`, 'x'),
    macChecksum: write(dir, `public/${NAME}.sha256`, 'y'),
    appcast: write(dir, 'public/appcast.xml', feed([entry, { version: '9.9.8', url: 'https://example.invalid/old.dmg', length: 1, signature: 'AAAA' }])),
    sums: write(dir, 'public/SHA256SUMS', 'sums'),
  };
  const manifest = { version: VERSION, sourceCommit: 'c'.repeat(40), public: { ready: true, sourceCommit: 'c'.repeat(40), files } };
  return { manifest, env: { ...process.env, SAFARI_UPDATE_PUBLIC_KEY: key }, privateKey };
};
const rehash = (dir, manifest, key) => { manifest.public.files[key].sha256 = sha(fs.readFileSync(path.join(dir, manifest.public.files[key].path))); };

test('verifyPublic accepts a complete, correctly signed release', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub(), dir = scratch();
  try {
    const { manifest, env } = publicRelease(dir);
    assert.doesNotThrow(() => verifyPublic(manifest, dir, dir, env));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verifyPublic refuses an incomplete release, or one saved for another commit', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub(), dir = scratch();
  try {
    let { manifest, env } = publicRelease(dir);
    manifest.public.ready = false;
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /Public packages are incomplete\. Run release first\./);
    ({ manifest, env } = publicRelease(dir));
    manifest.public.sourceCommit = 'd'.repeat(40);
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /Public packages are incomplete/);
    ({ manifest, env } = publicRelease(dir));
    delete manifest.public.files.sums;
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /Public artifact SHA256SUMS is missing\./);
    ({ manifest, env } = publicRelease(dir));
    manifest.public.files.dmg.path = 'public/other.dmg';
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /Public artifact glaze-9\.9\.9-safari-macos\.dmg is missing\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verifyPublic refuses an artifact that changed', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub(), dir = scratch();
  try {
    const { manifest, env } = publicRelease(dir);
    fs.appendFileSync(path.join(dir, manifest.public.files.macZip.path), 'tampered');
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /A public artifact changed or leaves the release directory\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verifyPublic refuses an artifact outside the release directory, relative or absolute', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub(), outer = scratch(), out = path.join(outer, 'release');
  try {
    const { manifest, env } = publicRelease(out);
    manifest.public.files.sums = write(outer, 'SHA256SUMS', 'sums'); // a real file with the right name, one level up
    manifest.public.files.sums.path = '../SHA256SUMS';
    assert.throws(() => verifyPublic(manifest, out, out, env), /A public artifact changed or leaves the release directory\./);
    manifest.public.files.sums.path = path.join(outer, 'SHA256SUMS');
    assert.throws(() => verifyPublic(manifest, out, out, env), /A public artifact changed or leaves the release directory\./);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

test('verifyPublic refuses a correctly checksummed artifact symlink outside the release directory', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub(), outer = scratch(), out = path.join(outer, 'release');
  try {
    const { manifest, env } = publicRelease(out);
    const file = path.join(out, manifest.public.files.sums.path);
    const outside = path.join(outer, 'SHA256SUMS');
    fs.renameSync(file, outside);
    fs.symlinkSync(outside, file);
    assert.throws(() => verifyPublic(manifest, out, out, env), /A public artifact changed or leaves the release directory/);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

test('verifyPublic requires the feed to start with this exact DMG, version and length', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub();
  for (const [what, mutate] of [
    ['version', (e) => { e.version = '9.9.7'; }],
    ['url', (e) => { e.url = 'https://example.invalid/other.dmg'; }],
    ['length', (e) => { e.length = 5; }],
  ]) {
    const dir = scratch();
    try {
      const { manifest, env } = publicRelease(dir, { mutate });
      assert.throws(() => verifyPublic(manifest, dir, dir, env), /The appcast must start with the exact release DMG\/version\/length\./, what);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('verifyPublic refuses a feed whose signature does not authenticate the DMG, or has none', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub();
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  for (const [what, mutate] of [
    ['another key', (e) => { e.signature = crypto.sign(null, Buffer.from('dmg bytes'), other).toString('base64'); }],
    ['no signature', (e) => { e.signature = ''; }],
  ]) {
    const dir = scratch();
    try {
      const { manifest, env } = publicRelease(dir, { mutate });
      assert.throws(() => verifyPublic(manifest, dir, dir, env), /The signed update feed does not authenticate this DMG\./, what);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('verifyPublic refuses a DMG that was swapped after signing, even with a refreshed checksum', { skip: !hasPython && 'needs python3' }, async () => {
  const { verifyPublic } = await pub(), dir = scratch();
  try {
    const { manifest, env } = publicRelease(dir);
    fs.writeFileSync(path.join(dir, manifest.public.files.dmg.path), 'dmg bytes!');
    rehash(dir, manifest, 'dmg');
    // The feed still names the old length, so a swapped DMG of another size is caught by the length check first.
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /exact release DMG\/version\/length/);
    fs.writeFileSync(path.join(dir, manifest.public.files.dmg.path), 'dmg BYTES');
    rehash(dir, manifest, 'dmg');
    assert.throws(() => verifyPublic(manifest, dir, dir, env), /does not authenticate this DMG/, 'same length, different bytes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
