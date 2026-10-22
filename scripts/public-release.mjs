// The public half of store-release.mjs. All writes use frozen sources and saved artifacts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo = 'frostdev-ops/glaze';
const siteRepo = 'frostdev-ops/frostdev.io';
const siteURL = 'https://frostdev.io';
const feedRoute = '/projects/glaze/appcast.xml';
const publicKey = '0lbeC9MO1QDsjSGjs6iyxSBwXKMpEiKVoB+5wZwQEqY=';
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const command = (bin, args, cwd, env) => execFileSync(bin, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trimEnd();
const git = (args, cwd, env) => command('git', args, cwd, env);
const gh = (args, cwd, env) => command('gh', args, cwd, env);
const api = (endpoint, cwd, env) => JSON.parse(gh(['api', endpoint], cwd, env));
const isRepo = (remote, expected) => remote.replace(/\.git$/, '').replace(/^git@github.com:/, 'https://github.com/') === `https://github.com/${expected}`;
const contains = (ancestor, descendant, cwd, env) => {
  try { git(['merge-base', '--is-ancestor', ancestor, descendant], cwd, env); return true; }
  catch (error) { if (error.status === 1) return false; throw error; }
};
function curl(url, file, cwd, env) {
  command('curl', ['-fsSL', '--connect-timeout', '10', '--max-time', '120', url, '-o', file], cwd, env);
}
function tagCommit(cwd, env, tag) {
  const rows = git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], cwd, env).split('\n').filter(Boolean).map(row => row.split(/\s+/));
  return rows.find(row => row[1].endsWith('^{}'))?.[0] || rows[0]?.[0];
}
export function checkTag(manifest, root, env) {
  const tag = `v${manifest.version}`;
  const remote = tagCommit(root, env, tag);
  let local;
  try { local = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], root, env); }
  catch (error) { if (error.status !== 128) throw error; }
  if ((remote && remote !== manifest.sourceCommit) || (local && local !== manifest.sourceCommit)) {
    throw new Error(`${tag} already identifies another commit. Published tags are never moved; bump the version.`);
  }
}
// Steps that run third-party code (npm and npx packages with their install scripts, the website's build) must not see
// what this Mac can do: the store and Apple credentials in the environment, the SSH agent, GitHub tokens, cloud
// credentials, or the real home directory, where stores.env, ~/.ssh, ~/.npmrc and the Keychain's helpers live. They get an
// allowlist of variables, not a denylist of the secrets we know about, and a HOME that exists only for the step. Proxy
// and CA settings pass through because npm cannot reach its registry without them.
const KEPT = [
  'PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'TZ', 'TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'CI', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
];
export function isolatedEnv(env, home) {
  const kept = Object.fromEntries(KEPT.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  return {
    ...kept, HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'), XDG_DATA_HOME: path.join(home, '.local/share'),
    npm_config_cache: path.join(home, '.npm'), npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1',
  };
}
export async function withIsolatedEnv(env, step) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-isolated-'));
  try { return await step(isolatedEnv(env, home)); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
// Releasing at or below a version the live feed already offers helps no one and cannot be taken back once published.
export function refuseStaleCandidate(previous, version) {
  if (previous.some(item => item.version === version)) throw new Error('This version is already in the public feed. Resume its original --out/--source-ref; do not rebuild it.');
  const candidate = version.split('.').map(Number);
  for (const item of previous) {
    if (!/^\d+\.\d+\.\d+$/.test(item.version)) continue;
    const old = item.version.split('.').map(Number);
    const index = old.findIndex((value, i) => value !== candidate[i]);
    if (index >= 0 && old[index] > candidate[index]) throw new Error('The candidate version is older than the public update feed; bump it before releasing.');
  }
}
// What publishing does about one GitHub release asset. A published release is never changed; a draft may be completed.
export function assetAction(release, name, existing, same) {
  if (existing && same) return 'keep';
  if (!release.draft) throw new Error(`Published release asset ${name} is missing or different; refusing to change a published candidate.`);
  return existing ? 'replace' : 'upload';
}
export function publicPreflight(opt, env, root, manifest) {
  if (!opt.stores.includes('chrome') || !opt.stores.includes('firefox')) throw new Error('A full release needs both Chrome and Firefox packages. Use build/submit for store-only work.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Public releases require a stable major.minor.patch version.');
  for (const bin of ['gh', 'git', 'curl', 'ssh', 'rsync', 'xcodebuild', 'xcrun', 'lipo', 'python3']) command('/usr/bin/which', [bin], root, env);
  if (process.platform !== 'darwin') throw new Error('The universal DMG release must run on a Mac.');
  if (!env.NOTARY_PROFILE && !(env.ASC_KEY_PATH && env.ASC_KEY_ID && env.ASC_ISSUER_ID)) throw new Error('Set NOTARY_PROFILE or ASC_KEY_PATH/ASC_KEY_ID/ASC_ISSUER_ID for DMG notarization.');
  if (!env.SPARKLE_BIN) throw new Error('Set SPARKLE_BIN to the pinned Sparkle 2.10.0 bin directory.');
  for (const bin of ['generate_keys', 'sign_update']) fs.accessSync(path.join(env.SPARKLE_BIN, bin), fs.constants.X_OK);
  const key = command(path.join(env.SPARKLE_BIN, 'generate_keys'), ['--account', env.SAFARI_UPDATE_KEY_ACCOUNT || 'ed25519', '-p'], root, env);
  if (key !== (env.SAFARI_UPDATE_PUBLIC_KEY || publicKey)) throw new Error('The Sparkle Keychain public key differs from the application key.');
  if (!isRepo(git(['remote', 'get-url', '--push', 'origin'], root, env), repo)) throw new Error('Glaze origin must be frostdev-ops/glaze.');
  const site = env.FROSTDEV_SITE_DIR;
  if (!site || !isRepo(git(['remote', 'get-url', '--push', 'origin'], site, env), siteRepo)) throw new Error('FROSTDEV_SITE_DIR must be the frostdev-ops/frostdev.io checkout.');
  for (const target of [repo, siteRepo]) {
    if (!api(`repos/${target}`, root, env).permissions?.push) throw new Error(`GitHub write access is missing for ${target}.`);
  }
  for (const file of ['scripts/prepare-glaze-release.mjs', 'src/data/glazeRelease.json']) api(`repos/${siteRepo}/contents/${file}?ref=main`, root, env);
  checkTag(manifest, root, env);
  command('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'loothing-vps', 'test -d /opt/frostdev-public/releases'], root, env);
  console.log('Public release: GitHub, notarization, Sparkle key, website checkout and deploy access checked.');
}
function entries(file, root, env) {
  return JSON.parse(command('python3', ['-c', `import json,sys,xml.etree.ElementTree as E
t=E.parse(sys.argv[1]); c=t.getroot().findall('channel')
assert t.getroot().tag=='rss' and len(c)==1, 'Invalid appcast'
n='{http://www.andymatuschak.org/xml-namespaces/sparkle}'
print(json.dumps([dict(e.attrib, version=e.get(n+'version')) for i in c[0].findall('item') for e in [i.find('enclosure')] if e is not None]))`, file], root, env));
}
export function preservesFeed(base, next) {
  const byVersion = new Map(next.map(item => [item.version, item]));
  if (byVersion.size !== next.length || next.some(item => !item.version)) throw new Error('Appcast versions must be unique and nonempty.');
  for (const item of base) {
    if (JSON.stringify(byVersion.get(item.version)) !== JSON.stringify(item)) throw new Error(`Appcast would replace or drop existing version ${item.version}.`);
  }
}
// Receipts name files inside their release workspace. A lexical check alone would also accept a symlink to an
// unrelated file outside it, so verify the resolved filesystem path before hashing or reading an artifact.
export function artifactPath(out, file, message = 'Artifact path leaves the release directory.') {
  const leaves = (base, target) => {
    const relative = path.relative(base, target);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  };
  const target = path.resolve(out, file);
  if (path.isAbsolute(file) || leaves(path.resolve(out), target)) throw new Error(message);
  const resolved = fs.realpathSync(target);
  if (leaves(fs.realpathSync(out), resolved)) throw new Error(message);
  return resolved;
}
export function verifyPublic(manifest, out, root, env) {
  const state = manifest.public;
  if (!state?.ready || state.sourceCommit !== manifest.sourceCommit) throw new Error('Public packages are incomplete. Run release first.');
  const name = `glaze-${manifest.version}-safari-macos`;
  const names = { dmg: `${name}.dmg`, macZip: `${name}.zip`, dmgChecksum: `${name}.dmg.sha256`, macChecksum: `${name}.sha256`, appcast: 'appcast.xml', sums: 'SHA256SUMS' };
  for (const [key, filename] of Object.entries(names)) {
    if (!state.files?.[key] || path.basename(state.files[key].path) !== filename) throw new Error(`Public artifact ${filename} is missing.`);
  }
  for (const item of Object.values(state.files)) {
    const message = 'A public artifact changed or leaves the release directory.';
    if (sha(artifactPath(out, item.path, message)) !== item.sha256) throw new Error(message);
  }
  const first = entries(path.join(out, state.files.appcast.path), root, env)[0];
  const dmg = path.join(out, state.files.dmg.path);
  if (first?.version !== manifest.version || first.url !== `https://github.com/${repo}/releases/download/v${manifest.version}/${path.basename(dmg)}` || Number(first.length) !== fs.statSync(dmg).size) throw new Error('The appcast must start with the exact release DMG/version/length.');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(env.SAFARI_UPDATE_PUBLIC_KEY || publicKey, 'base64')]), format: 'der', type: 'spki' });
  if (!verifySignature(null, fs.readFileSync(dmg), key, Buffer.from(first['{http://www.andymatuschak.org/xml-namespaces/sparkle}edSignature'] || '', 'base64'))) throw new Error('The signed update feed does not authenticate this DMG.');
}
export async function preparePublic({ manifest, save, out, root, env, run }) {
  if (manifest.public?.ready) { verifyPublic(manifest, out, root, env); return; }
  const dir = path.join(out, 'public'); fs.mkdirSync(dir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-public-'));
  try {
    const source = path.join(temp, 'source');
    await run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, source], root, env);
    git(['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', manifest.sourceCommit], source, env);
    const base = path.join(temp, 'appcast-base.xml');
    curl(`${siteURL}${feedRoute}`, base, root, env);
    // Never rebuild/replace an already published same-version candidate without its saved receipts.
    refuseStaleCandidate(entries(base, root, env), manifest.version);
    await run('sh', ['scripts/build-safari.sh'], source, { ...env, DIST: '' }, path.join(out, 'logs/universal-mac-build.log'));
    const name = `glaze-${manifest.version}-safari-macos`;
    const files = {};
    for (const [key, suffix] of Object.entries({ dmg: '.dmg', macZip: '.zip', dmgChecksum: '.dmg.sha256', macChecksum: '.sha256' })) {
      const dest = path.join(dir, name + suffix);
      fs.copyFileSync(path.join(source, 'release', manifest.version, 'github', name + suffix), dest);
      files[key] = { path: path.relative(out, dest), sha256: sha(dest) };
    }
    const appcast = path.join(dir, 'appcast.xml');
    // Use the current helper with the frozen release's manifest/project, without changing its sources.
    fs.copyFileSync(path.join(root, 'scripts/safari-appcast.sh'), path.join(source, 'scripts/safari-appcast.sh'));
    await run('sh', ['scripts/safari-appcast.sh', path.join(out, files.dmg.path), env.SPARKLE_BIN], source,
      { ...env, SAFARI_REQUIRE_UNIVERSAL: '1', SAFARI_APPCAST_BASE: base, SAFARI_APPCAST_OUT: appcast }, path.join(out, 'logs/appcast-signing.log'));
    preservesFeed(entries(base, root, env), entries(appcast, root, env));
    files.appcast = { path: path.relative(out, appcast), sha256: sha(appcast) };
    const sums = path.join(dir, 'SHA256SUMS');
    fs.writeFileSync(sums, [...Object.values(files), manifest.files.chrome, manifest.files.firefox].map(item => `${item.sha256}  ${path.basename(item.path)}\n`).join(''));
    files.sums = { path: path.relative(out, sums), sha256: sha(sums) };
    manifest.public = { sourceCommit: manifest.sourceCommit, files, ready: true };
    verifyPublic(manifest, out, root, env); save();
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
async function workflow(repoName, name, commit, root, env) {
  const deadline = Date.now() + 30 * 60 * 1000;
  console.log(`Waiting for ${repoName} ${name} on ${commit}.`);
  while (Date.now() < deadline) {
    const runs = JSON.parse(gh(['run', 'list', '--repo', repoName, '--workflow', name, '--commit', commit, '--event', 'push', '--limit', '10', '--json', 'databaseId,status,conclusion,url'], root, env));
    const latest = runs[0];
    if (latest?.status === 'completed') {
      if (latest.conclusion !== 'success') throw new Error(`Required workflow failed: ${latest.url}. Fix or rerun it, then resume.`);
      return latest.url;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error(`Timed out waiting for ${repoName} ${name}; resume after checking GitHub Actions.`);
}
function releaseInfo(tag, root, env) {
  try { return api(`repos/${repo}/releases/tags/${tag}`, root, env); }
  catch (error) { if (!String(error.stderr).includes('(HTTP 404)')) throw error; }
  // The tags endpoint omits drafts, including the one the Package workflow creates for the tag.
  const drafts = api(`repos/${repo}/releases?per_page=100`, root, env).filter(release => release.draft && release.tag_name === tag);
  if (drafts.length > 1) throw new Error(`Several draft releases use ${tag}; delete the extras on GitHub, then resume.`);
  return drafts[0] || null;
}
function verifyAsset(asset, expected, tag, root, env) {
  if (asset.digest) return asset.digest === `sha256:${expected}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-asset-'));
  try {
    gh(['release', 'download', tag, '--repo', repo, '--pattern', asset.name, '--dir', temp], root, env);
    return sha(path.join(temp, asset.name)) === expected;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
function publishSource(manifest, root, env) {
  git(['fetch', '--quiet', 'origin', 'main'], root, env);
  if (!contains(manifest.sourceCommit, 'origin/main', root, env)) {
    if (!contains('origin/main', manifest.sourceCommit, root, env)) throw new Error('Release source diverges from remote main. Integrate and validate it first.');
    git(['push', 'origin', `${manifest.sourceCommit}:refs/heads/main`], root, env);
  }
  checkTag(manifest, root, env);
  const tag = `v${manifest.version}`;
  try { git(['rev-parse', '--verify', `refs/tags/${tag}`], root, env); }
  catch { git(['-c', 'core.hooksPath=/dev/null', 'tag', '-a', tag, manifest.sourceCommit, '-m', `Glaze ${manifest.version}`], root, env); }
  git(['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], root, env);
  if (tagCommit(root, env, tag) !== manifest.sourceCommit) throw new Error('Remote release tag verification failed.');
  return tag;
}
export async function publishPublic(context) {
  const { manifest, save, out, root, env, run } = context;
  const state = manifest.public;
  if (state) { state.complete = false; save(); }
  verifyPublic(manifest, out, root, env);
  const tag = publishSource(manifest, root, env);
  state.packageCI = await workflow(repo, 'package.yml', manifest.sourceCommit, root, env); save();
  const notes = path.join(out, 'public/release-notes.md'); fs.writeFileSync(notes, manifest.notes + '\n');
  let release = releaseInfo(tag, root, env);
  if (!release) {
    gh(['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `Glaze ${manifest.version}`, '--notes-file', notes], root, env);
    release = releaseInfo(tag, root, env);
  }
  const assets = [...Object.values(state.files), manifest.files.chrome, manifest.files.firefox];
  for (const item of assets) {
    const file = path.join(out, item.path);
    const existing = release.assets.find(asset => asset.name === path.basename(file));
    const action = assetAction(release, path.basename(file), existing, existing && verifyAsset(existing, item.sha256, tag, root, env));
    if (action === 'keep') continue;
    gh(['release', 'upload', tag, '--repo', repo, file, ...(action === 'replace' ? ['--clobber'] : [])], root, env);
  }
  release = releaseInfo(tag, root, env);
  for (const item of assets) {
    const asset = release.assets.find(asset => asset.name === path.basename(item.path));
    if (!asset || !verifyAsset(asset, item.sha256, tag, root, env)) throw new Error(`GitHub asset verification failed: ${item.path}`);
  }
  if (release.draft) gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest', '--title', `Glaze ${manifest.version}`, '--notes-file', notes], root, env);
  release = releaseInfo(tag, root, env);
  if (release.draft) throw new Error('GitHub release is still a draft.');
  for (const item of assets) command('curl', ['-fILsS', '--connect-timeout', '10', '--max-time', '60', `https://github.com/${repo}/releases/download/${tag}/${path.basename(item.path)}`], root, env);
  state.githubURL = release.html_url; save();
  await publishWebsite(context);
  // Always recheck live state on resume; a saved receipt alone is not completion.
  const live = path.join(out, 'public/live-appcast.xml');
  curl(`${siteURL}${feedRoute}`, live, root, env);
  if (sha(live) !== state.files.appcast.sha256) throw new Error('Live update feed differs from the signed release feed.');
  state.complete = true; delete state.error; save();
  console.log(`Public release verified: ${state.githubURL}; ${siteURL}/glaze; signed update feed.`);
}
// Everything in the website preparation that runs its dependencies' code sees only `bare`: see isolatedEnv.
function publishWebsite(context) {
  return withIsolatedEnv(context.env, bare => publishWebsiteWith(context, bare));
}
async function publishWebsiteWith({ manifest, save, out, root, env, run }, bare) {
  const state = manifest.public;
  const site = path.join(out, 'website');
  if (!fs.existsSync(site)) {
    await run('git', ['clone', '--quiet', '--no-checkout', env.FROSTDEV_SITE_DIR, site], root, env);
    git(['remote', 'set-url', 'origin', `https://github.com/${siteRepo}.git`], site, env);
  }
  const feed = path.join(out, state.files.appcast.path);
  if (!state.siteCommit) {
    // A fresh --no-checkout clone has no index yet; its files only look deleted.
    if (fs.existsSync(path.join(site, '.git/index')) && git(['status', '--porcelain', '--untracked-files=all'], site, env)) throw new Error(`Website preparation is incomplete at ${site}. Review its diff, then remove only this generated clone and resume.`);
    git(['fetch', '--quiet', 'origin', 'main'], site, env);
    git(['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', 'origin/main'], site, env);
    if (!fs.existsSync(path.join(site, 'scripts/prepare-glaze-release.mjs'))) throw new Error('The website release helper must be committed and pushed to frostdev.io main first.');
    const current = path.join(site, 'public/projects/glaze/appcast.xml');
    preservesFeed(entries(current, root, env), entries(feed, root, env));
    // The current public feed can advance independently of the local website clone.
    const live = path.join(out, 'public/live-before-site.xml'); curl(`${siteURL}${feedRoute}`, live, root, env);
    preservesFeed(entries(live, root, env), entries(feed, root, env));
    const source = path.join(out, 'website-glaze-source');
    if (!fs.existsSync(source)) await run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, source], root, env);
    git(['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', manifest.sourceCommit], source, env);
    await run('node', ['scripts/prepare-glaze-release.mjs', manifest.version, source, feed], site, bare, path.join(out, 'logs/website-prepare.log'));
    await run('npm', ['ci'], site, bare, path.join(out, 'logs/website-install.log'));
    await run('node', ['scripts/looks.mjs'], site, bare, path.join(out, 'logs/website-looks.log'));
    await run('npm', ['run', 'test:gallery'], site, bare, path.join(out, 'logs/website-gallery.log'));
    await run('npm', ['run', 'check'], site, bare, path.join(out, 'logs/website-check.log'));
    await run('npm', ['run', 'build'], site, bare, path.join(out, 'logs/website-build.log'));
    await run('node', ['scripts/prepare-glaze-release.mjs', '--verify', manifest.version, source, feed], site, bare, path.join(out, 'logs/website-output-check.log'));
    git(['diff', '--check'], site, env);
    const paths = ['src/data/glazeRelease.json', 'src/content/glaze-docs', 'public/projects/glaze/appcast.xml', 'vendor/glaze', 'vendor/glaze-scene'];
    git(['add', '--', ...paths], site, env);
    if (git(['diff', '--cached', '--name-only'], site, env)) git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `Publish Glaze ${manifest.version} downloads and signed update feed`], site, env);
    state.siteCommit = git(['rev-parse', 'HEAD'], site, env); save();
  }
  if (git(['rev-parse', 'HEAD'], site, env) !== state.siteCommit || git(['status', '--porcelain', '--untracked-files=all'], site, env)) throw new Error('The saved website candidate changed. Review it before resuming.');
  git(['fetch', '--quiet', 'origin', 'main'], site, env);
  const remote = git(['rev-parse', 'origin/main'], site, env);
  if (remote !== state.siteCommit) {
    if (!contains(remote, state.siteCommit, site, env)) throw new Error('Website main advanced. Review the new main, discard the generated website clone and clear public.siteCommit in release.json, then resume to rebuild and validate integration.');
    git(['push', 'origin', `${state.siteCommit}:refs/heads/main`], site, env);
  }
  state.websiteCI = await workflow(siteRepo, 'site.yml', state.siteCommit, root, env); save();
  // deploy stages, activates atomically, and verifies origin/public routes with rollback on failure.
  // A previous successful activation can be verified without trying to create its existing stage again.
  let staged = false;
  try { command('ssh', ['-o', 'BatchMode=yes', 'loothing-vps', `test -f /opt/frostdev-public/releases/${state.siteCommit}/.complete`], root, env); staged = true; }
  catch (error) { if (error.status !== 1) throw error; }
  if (!fs.existsSync(path.join(site, 'dist/index.html'))) {
    await run('npm', ['ci'], site, bare, path.join(out, 'logs/website-install.log'));
    await run('npm', ['run', 'check'], site, bare, path.join(out, 'logs/website-check.log'));
    await run('npm', ['run', 'build'], site, bare, path.join(out, 'logs/website-build.log'));
  }
  if (!staged) await run('bash', ['ops/deploy.sh', 'stage'], site, env, path.join(out, 'logs/website-stage.log'));
  // CI and staging take time. Refuse to activate if someone promoted a newer website meanwhile.
  git(['fetch', '--quiet', 'origin', 'main'], site, env);
  if (git(['rev-parse', 'origin/main'], site, env) !== state.siteCommit) throw new Error('Website main advanced before activation; review and regenerate the website candidate.');
  const liveFeed = path.join(out, 'public/live-before-activate.xml'); curl(`${siteURL}${feedRoute}`, liveFeed, root, env);
  preservesFeed(entries(liveFeed, root, env), entries(feed, root, env));
  await run('bash', ['ops/deploy.sh', 'activate'], site, env, path.join(out, 'logs/website-deploy.log'));
  for (const route of ['/glaze', '/guides/glaze-chrome', '/guides/glaze-safari', '/guides/glaze-install', '/guides/glaze-development', feedRoute]) {
    const actual = path.join(out, 'public/live-check'); curl(siteURL + route, actual, root, env);
    const expected = path.join(site, 'dist', route.endsWith('.xml') ? route.slice(1) : `${route.slice(1)}/index.html`);
    if (sha(actual) !== sha(expected)) throw new Error(`Public website content differs at ${route}.`);
  }
  state.websiteURL = `${siteURL}/glaze`; save();
}
