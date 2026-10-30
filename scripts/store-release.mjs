#!/usr/bin/env node
// Build committed Glaze sources in isolated clones and submit the exact, checksummed artifacts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { appleApp, appleBuild, amo, chromeStatus, submitChrome, submitFirefox, submitApple, syncFirefoxListing, previewAppleListing } from './store-api.mjs';
import { readListings, writeChromeKit, describeChanges } from './store-listings.mjs';
import { publicPreflight, preparePublic, publishPublic, withIsolatedEnv, artifactPath, publicStores } from './public-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The one place the Firefox linter's version is chosen. npx runs it (and whatever npm resolves for its dependencies) with
// no credentials and a temporary HOME: see isolatedEnv in public-release.mjs.
export const WEB_EXT = 'web-ext@10.8.0';
const defaults = {
  CWS_PUBLISHER_ID: '82318a69-812d-438a-842f-e87fcaec1bd6',
  CWS_EXTENSION_ID: 'jmmaeoajomodnbnlmdikjooalmcilooh',
  CWS_SERVICE_ACCOUNT: 'cws-publisher@frostdev-507119.iam.gserviceaccount.com',
  AMO_ADDON_ID: 'glaze@frostdev.io', ASC_BUNDLE_ID: 'io.frostdev.Glaze', SAFARI_TEAM_ID: '22AAZFMTV8',
};
const usage = `Usage: node scripts/store-release.mjs [release|doctor|plan|build|submit|publish|listings] [options]

  release              Build, submit stores, tag/push GitHub, deploy website/feed (default).
  doctor               Read-only store and public-release prerequisite checks.
  plan                 Show source/targets/output without network access or writes.
  build                Test and build packages, with no uploads.
  submit               Resume store submissions only from verified packages.
  publish              Resume GitHub and website publication of saved public packages.
  listings             Dry run: what each store's listing would change, per language. Writes nothing.

  --config FILE        Credentials file (default ~/.config/glaze/stores.env).
  --stores LIST        chrome,firefox,apple (default all three).
  --apple-platforms LIST  MAC_OS,IOS (default both).
  --source-ref REF     Committed release source (default HEAD).
  --firefox-ref REF    Compatibility source (default dev/firefox).
  --out DIRECTORY     Release workspace (default release/<version>/stores/<source SHA>).
  --notes FILE        Plain-text GitHub release notes (default current CHANGELOG.md entry).
  --help               Show this help.

Every store publishes as soon as its review approves the submission. See RELEASING.md for credentials and recovery.`;
const expand = value => value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
const requireValue = (value, label) => { if (!value) throw new Error(`${label} is required`); return value; };

export function options(args) {
  const result = { command: 'release', stores: ['chrome', 'firefox', 'apple'], applePlatforms: ['MAC_OS', 'IOS'], sourceRef: 'HEAD', firefoxRef: 'dev/firefox', config: path.join(os.homedir(), '.config/glaze/stores.env') };
  if (args[0] && !args[0].startsWith('-')) result.command = args.shift();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    const value = requireValue(args[++i], arg);
    if (arg === '--config') { result.config = path.resolve(expand(value)); result.explicitConfig = true; }
    else if (arg === '--out') result.out = path.resolve(expand(value));
    else if (arg === '--firefox-ref') result.firefoxRef = value;
    else if (arg === '--source-ref') result.sourceRef = value;
    else if (arg === '--notes') result.notes = path.resolve(expand(value));
    else if (arg === '--stores') result.stores = [...new Set(value.split(','))];
    else if (arg === '--apple-platforms') result.applePlatforms = [...new Set(value.split(','))];
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!['release', 'doctor', 'plan', 'build', 'submit', 'publish', 'listings'].includes(result.command)) throw new Error(`Unknown command ${result.command}`);
  if (result.stores.some(s => !['chrome', 'firefox', 'apple'].includes(s))) throw new Error('Stores must be chrome,firefox,apple.');
  if (result.applePlatforms.some(s => !['MAC_OS', 'IOS'].includes(s))) throw new Error('Apple platforms must be MAC_OS,IOS.');
  return result;
}
// Values never printed or logged: everything in the credentials file, and credentials however they were given.
const secrets = new Set();
const CREDENTIALS = /^(?:ASC_KEY_|ASC_ISSUER_|AMO_JWT_|WEB_EXT_API_|NOTARY_)|TOKEN|SECRET|PASSWORD/;
const CREDENTIAL_FLAGS = new Set(['--api-key', '--api-issuer', '--apiKey', '--apiIssuer', '--key', '--key-id', '--issuer', '--keychain-profile', '--team-id', '--token', '--password', '--username', '-u', '-p']);
export function redact(text) {
  let result = String(text);
  for (const value of [...secrets].sort((a, b) => b.length - a.length)) result = result.split(value).join('[redacted]');
  return result;
}
// A command as logged: readable, with credential flag values and secret values replaced.
export function commandLine(command, args) {
  return redact([command, ...args.map((arg, i) => {
    const [flag] = String(arg).split('=');
    if (CREDENTIAL_FLAGS.has(args[i - 1])) return '[redacted]';
    return flag !== arg && CREDENTIAL_FLAGS.has(flag) ? `${flag}=[redacted]` : arg;
  })].join(' '));
}
export function environment(opt) {
  let configured = {};
  if (fs.existsSync(opt.config)) configured = parseEnv(fs.readFileSync(opt.config, 'utf8'));
  else if (opt.explicitConfig) throw new Error(`Missing config file ${opt.config}`);
  const env = { ...defaults, ...configured, ...process.env };
  env.AMO_JWT_ISSUER ||= env.WEB_EXT_API_KEY;
  env.AMO_JWT_SECRET ||= env.WEB_EXT_API_SECRET;
  if (env.ASC_KEY_PATH) env.ASC_KEY_PATH = path.resolve(path.dirname(opt.config), expand(env.ASC_KEY_PATH));
  for (const key of ['SPARKLE_BIN', 'FROSTDEV_SITE_DIR']) {
    if (env[key]) env[key] = path.resolve(path.dirname(opt.config), expand(env[key]));
  }
  // Short values such as "1" would hide unrelated text without hiding anything identifying.
  const hide = value => { if (typeof value === 'string' && value.length >= 4) secrets.add(value); };
  for (const [key, value] of Object.entries(configured)) { hide(value); hide(expand(value)); hide(env[key]); }
  for (const [key, value] of Object.entries(env)) if (CREDENTIALS.test(key)) hide(value);
  env.FROSTDEV_SITE_DIR ||= path.join(os.homedir(), 'Projects/frostdev.io');
  return env;
}
function executable(name) {
  try { execFileSync('/usr/bin/which', [name], { stdio: 'ignore' }); return true; } catch { return false; }
}
async function doctor(opt, env, remote = true) {
  let failures = 0;
  for (const store of opt.stores) {
    try {
      if (store === 'chrome') {
        if (!executable('gcloud')) throw new Error('Install Google Cloud CLI (gcloud).');
        if (remote) await chromeStatus(env);
      } else if (store === 'firefox') {
        requireValue(env.AMO_JWT_ISSUER, 'AMO_JWT_ISSUER'); requireValue(env.AMO_JWT_SECRET, 'AMO_JWT_SECRET');
        if (remote) await amo(env, '/versions/?filter=all_without_unlisted&page_size=1');
      } else {
        for (const key of ['ASC_KEY_PATH', 'ASC_KEY_ID', 'ASC_ISSUER_ID']) requireValue(env[key], key);
        if (!fs.existsSync(env.ASC_KEY_PATH)) throw new Error('ASC_KEY_PATH does not exist.');
        if (!executable('xcodebuild') || !executable('xcrun')) throw new Error('Install full Xcode and select it with xcode-select.');
        try { execFileSync('xcodebuild', ['-version'], { stdio: 'ignore', timeout: 30000 }); } catch { throw new Error('Select a full Xcode installation with xcode-select.'); }
        if (remote) await appleApp(env);
      }
      console.log(`${store}: ${remote ? 'credential/access check passed' : 'local prerequisites present'}`);
    } catch (error) { failures++; console.log(`${store}: ${redact(error.message)}`); }
  }
  return failures === 0;
}
export async function run(command, args, cwd, env, log) {
  // Tools can echo credentials passed as flags even when they are absent from stores.env.
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]), flag = arg.split('=')[0];
    const value = CREDENTIAL_FLAGS.has(flag) ? (arg.includes('=') ? arg.slice(flag.length + 1) : args[i + 1]) : null;
    if (value) secrets.add(String(value));
  }
  const line = commandLine(command, args);
  console.log(`Running ${line}`);
  const fd = log ? fs.openSync(log, 'w', 0o600) : null;
  try {
    if (fd !== null) fs.writeSync(fd, `$ ${line}\n`);
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      // Retain enough text to catch a credential split across chunks, and decode UTF-8 across chunk boundaries.
      const keep = Math.max(1, ...[...secrets].map(value => value.length)) - 1;
      for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        const decoder = new StringDecoder('utf8');
        let pending = '';
        const flush = (end = false) => {
          let cut = end ? pending.length : Math.max(0, pending.length - keep), previous;
          do {
            previous = cut;
            for (const value of secrets) {
              const start = cut ? pending.lastIndexOf(value, cut - 1) : -1;
              if (start >= 0 && start + value.length > cut) cut = start;
            }
          } while (cut !== previous);
          const text = redact(pending.slice(0, cut));
          pending = pending.slice(cut);
          if (text) { if (fd === null) output.write(text); else fs.writeSync(fd, text); }
        };
        stream.on('data', chunk => { pending += decoder.write(chunk); flush(); });
        stream.once('end', () => { pending += decoder.end(); flush(true); });
      }
      const stop = signal => child.kill(signal);
      const interrupt = () => stop('SIGINT');
      const terminate = () => stop('SIGTERM');
      process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
      child.once('error', reject);
      child.once('close', code => {
        process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
        code === 0 ? resolve() : reject(new Error(`${command} exited ${code}${log ? `; see ${log}` : ''}`));
      });
    });
  } finally { if (fd !== null) fs.closeSync(fd); }
}
// The helper and its Claude Desktop bundle carry Glaze's version: the bundle is glaze-mcp-<version>.mcpb on the release.
export function helperVersions(read, version) {
  for (const file of ['mcp/package.json', 'mcp/mcpb/manifest.json']) {
    const found = JSON.parse(read(file)).version;
    if (found !== version) throw new Error(`${file} is ${found}; manifest.json is ${version}.`);
  }
}
// pack-mcpb.js validates, packs and unpacks the bundle in the clone. It runs the MCPB CLI through npx, so it gets the
// isolated environment; a failed validate exits nonzero and stops the build.
export async function buildMcpb(source, out, env, version) {
  await withIsolatedEnv(env, isolated => run('node', ['mcp/scripts/pack-mcpb.js'], source, isolated, path.join(out, 'logs/mcpb-pack.log')));
  const dest = path.join(out, `glaze-mcp-${version}.mcpb`);
  fs.copyFileSync(path.join(source, 'dist', path.basename(dest)), dest);
  return dest;
}
function notes(source) {
  const version = json(path.join(source, 'manifest.json')).version;
  const text = fs.readFileSync(path.join(source, 'CHANGELOG.md'), 'utf8');
  const heading = `## [${version}]`;
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`CHANGELOG.md needs a ${version} entry before releasing.`);
  const section = text.slice(start).split('\n').slice(1).join('\n').split(/^## /m)[0].trim();
  return requireValue(section.replace(/^### /gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), 'Release notes');
}
async function build(opt, env, manifest, save, out) {
  if (manifest.ready) { verify(manifest, out); console.log('Reusing verified packages.'); return; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stores-'));
  try {
    const source = path.join(temp, 'source');
    await run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, source], root, env);
    git(['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '--detach', manifest.sourceCommit], source);
    manifest.notes = opt.notes ? fs.readFileSync(opt.notes, 'utf8').trim() : notes(source);
    // Stores take each language's notes from store/; these are the GitHub and website notes.
    if (!manifest.notes) throw new Error('Release notes must be nonempty.');
    await run('nice', ['-n', '15', 'node', '--test'], source, env, path.join(out, 'logs/tests-main.log'));
    const dist = path.join(temp, 'dist'); fs.mkdirSync(dist);
    if (opt.stores.includes('chrome') || opt.stores.includes('apple')) await run('bash', ['package.sh'], source, { ...env, DIST: dist });
    const artifact = (key, file) => { manifest.files[key] = { path: path.relative(out, file), sha256: digest(file) }; };
    if (opt.stores.includes('chrome')) {
      const dest = path.join(out, `glaze-v${manifest.version}.zip`);
      fs.copyFileSync(path.join(dist, path.basename(dest)), dest); artifact('chrome', dest);
    }
    if (publicStores(opt.stores)) artifact('mcpb', await buildMcpb(source, out, env, manifest.version));
    if (opt.stores.includes('firefox')) {
      const firefox = path.join(temp, 'firefox');
      await run('git', ['clone', '--quiet', '--shared', '--no-checkout', root, firefox], root, env);
      git(['-c', 'core.hooksPath=/dev/null', 'checkout', '--quiet', '-b', 'dev/firefox', manifest.firefoxBase], firefox);
      // Merge only in this disposable clone. The permanent compatibility branch and its worktree are untouched.
      await run('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Glaze release', '-c', 'user.email=release@frostdev.io', 'merge', '--no-edit', '--no-gpg-sign', manifest.sourceCommit], firefox, env, path.join(out, 'logs/firefox-merge.log'));
      manifest.firefoxCommit = git(['rev-parse', 'HEAD'], firefox);
      if (json(path.join(firefox, 'manifest.json')).version !== manifest.version) throw new Error('Firefox integration has a different version. Resolve the release/compatibility branches first.');
      await run('nice', ['-n', '15', 'node', '--test'], firefox, env, path.join(out, 'logs/tests-firefox.log'));
      await run('sh', ['scripts/package-firefox.sh'], firefox, { ...env, DIST: dist });
      const upload = path.join(out, `glaze-v${manifest.version}-firefox.zip`);
      fs.copyFileSync(path.join(dist, path.basename(upload)), upload);
      const review = path.join(out, `glaze-v${manifest.version}-source.zip`);
      await run('python3', [path.join(root, 'scripts/store-firefox-source.py'), 'create', firefox, upload, review], root, env);
      const extracted = path.join(temp, 'firefox-package'); fs.mkdirSync(extracted);
      await run('unzip', ['-q', upload, '-d', extracted], root, env);
      await withIsolatedEnv(env, isolated => run('npx', ['--yes', WEB_EXT, 'lint', '--no-config-discovery', '--warnings-as-errors', '--source-dir', extracted, '--output', 'json'], root, isolated, path.join(out, 'logs/firefox-lint.json')));
      const rebuilt = path.join(temp, 'reviewer'); fs.mkdirSync(rebuilt);
      await run('unzip', ['-q', review, '-d', rebuilt], root, env);
      await run('python3', ['reviewer/rebuild.py', 'verify'], rebuilt, env, path.join(out, 'logs/firefox-rebuild.log'));
      artifact('firefox', upload); artifact('firefoxSource', review);
    }
    if (opt.stores.includes('apple')) {
      for (const platform of opt.applePlatforms) {
        const script = platform === 'MAC_OS' ? 'appstore-safari.sh' : 'appstore-ios.sh';
        // Both scripts export signed packages here. Uploads are a separate, resumable phase.
        await run('sh', [`scripts/${script}`], source, { ...env, DIST: '', BUILD_NUMBER: manifest.buildNumber, APPSTORE_EXPORT_ONLY: '1', APPSTORE_UPLOAD: '' }, path.join(out, `logs/apple-${platform}-export.log`));
        const name = `glaze-${manifest.version}-${platform === 'MAC_OS' ? 'appstore.pkg' : 'ios.ipa'}`;
        const dest = path.join(out, name);
        fs.copyFileSync(path.join(source, 'release', manifest.version, 'app-store', name), dest);
        artifact(platform, dest);
      }
    }
    manifest.ready = true; save();
    fs.writeFileSync(path.join(out, 'SHA256SUMS'), Object.values(manifest.files).map(file => `${file.sha256}  ${file.path}\n`).join(''));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
export function verify(manifest, out) {
  if (!manifest.ready) throw new Error('Packages are incomplete. Run build or release first.');
  const required = manifest.stores.flatMap(store => store === 'chrome' ? ['chrome'] : store === 'firefox' ? ['firefox', 'firefoxSource'] : manifest.applePlatforms);
  if (publicStores(manifest.stores)) required.push('mcpb');
  for (const key of required) {
    const file = requireValue(manifest.files[key], `Artifact ${key}`);
    if (digest(artifactPath(out, file.path)) !== file.sha256) throw new Error(`Checksum changed for ${file.path}; refusing upload.`);
  }
}
async function uploadApple(env, manifest, receipt, save, out) {
  const app = await appleApp(env);
  for (const platform of manifest.applePlatforms) {
    const state = receipt[platform] ||= {};
    if (state.uploaded || state.submitted) continue;
    if (await appleBuild(env, manifest, platform, app)) {
      if (!state.uploadStarted) throw new Error(`Apple ${platform}: build ${manifest.buildNumber} already exists outside this upload. Use a new BUILD_NUMBER and --out directory.`);
      state.uploaded = true; save();
      console.log(`Apple ${platform}: build already uploaded; waiting for processing.`);
      continue;
    }
    // altool finds AuthKey_<ID>.p8 in API_PRIVATE_KEYS_DIR. The temporary copy is private and removed afterward.
    const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-asc-'));
    try {
      const key = path.join(keys, `AuthKey_${env.ASC_KEY_ID}.p8`);
      fs.copyFileSync(env.ASC_KEY_PATH, key); fs.chmodSync(key, 0o600);
      state.uploadStarted = true; save();
      await run('xcrun', ['altool', '--upload-package', manifest.files[platform].path, '--api-key', env.ASC_KEY_ID, '--api-issuer', env.ASC_ISSUER_ID, '--output-format', 'json'], root, { ...env, API_PRIVATE_KEYS_DIR: keys }, path.join(out, `logs/apple-${platform}-upload.log`));
      state.uploaded = true; save();
    } finally { fs.rmSync(keys, { recursive: true, force: true }); }
  }
}

// The Firefox compatibility source. dev/firefox is pushed to from other worktrees and machines too, so a build first
// fetches origin's copy: a local branch that has fallen behind or split from it stops the release instead of being built
// silently, and with no local branch the build starts from origin's. The branch itself is never moved. Without `fetch`
// (plan, and runs resuming saved packages) nothing touches the network and the refs are used as they are.
export function resolveFirefoxBase(ref, { cwd = root, fetch = true } = {}) {
  const rev = name => { try { return git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], cwd); } catch { return null; } };
  const contains = (ancestor, descendant) => { try { git(['merge-base', '--is-ancestor', ancestor, descendant], cwd); return true; } catch { return false; } };
  if (fetch) {
    try { git(['fetch', '--quiet', 'origin', '+refs/heads/dev/firefox:refs/remotes/origin/dev/firefox'], cwd); }
    catch (error) { throw new Error(`Could not fetch origin/dev/firefox (${String(error.stderr || error.message).trim().split('\n')[0]}). A release builds Firefox on the current compatibility branch.`); }
  }
  const local = rev('refs/heads/dev/firefox'), remote = rev('refs/remotes/origin/dev/firefox');
  if (!local && !remote) throw new Error('There is no dev/firefox branch, local or on origin.');
  if (fetch && local && remote && local !== remote) {
    if (contains(local, remote)) throw new Error('dev/firefox is behind origin/dev/firefox. Fast-forward it (git merge --ff-only origin/dev/firefox, in the worktree that has it checked out), then rerun.');
    if (!contains(remote, local)) throw new Error('dev/firefox and origin/dev/firefox have diverged. Integrate them without rebasing or force-pushing, then rerun.');
    console.log('Note: dev/firefox has commits that are not on origin yet.');
  }
  const permanent = local || remote;
  const base = ref === 'dev/firefox' ? permanent : rev(ref);
  if (!base) throw new Error(`--firefox-ref ${ref} does not name a commit.`);
  if (!contains(permanent, base)) throw new Error('--firefox-ref must contain the permanent dev/firefox branch and its compatibility fixes.');
  return base;
}

export async function main(args = process.argv.slice(2)) {
  const opt = options(args);
  if (opt.help) { console.log(usage); return; }
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Node.js 26 or newer is required, matching CI and the release validation suite.');
  const env = environment(opt);
  const commit = git(['rev-parse', '--verify', `${opt.sourceRef}^{commit}`]);
  const version = JSON.parse(git(['show', `${commit}:manifest.json`])).version;
  const out = opt.out || path.join(root, 'release', version, 'stores', commit.slice(0, 12));
  // The selected stores' listing text in every language, from the committed source: a gap stops here, before any build.
  const show = file => { try { return git(['show', `${commit}:${file}`]); } catch { throw new Error(`${file} is missing from ${commit.slice(0, 12)}.`); } };
  const listings = ['release', 'build', 'submit', 'plan', 'listings'].includes(opt.command) ? readListings(show, version, opt.stores) : null;
  if (opt.command === 'listings') { await previewListings(opt, env, listings, version); return; }
  if (['release', 'build', 'plan'].includes(opt.command) && publicStores(opt.stores)) helperVersions(show, version);
  // Only a run that is about to build needs the current branch; one resuming saved packages keeps the base they were built on.
  const saved = path.join(out, 'release.json');
  const building = ['release', 'build'].includes(opt.command) && !(fs.existsSync(saved) && json(saved).ready);
  const firefoxBase = opt.stores.includes('firefox') ? resolveFirefoxBase(opt.firefoxRef, { fetch: building }) : null;
  console.log(`Glaze ${version}, committed source ${commit}\nStores: ${opt.stores.join(', ')}\nApple platforms: ${opt.applePlatforms.join(', ')}\nFirefox compatibility base: ${firefoxBase || '(not selected)'}\nOutput: ${out}`);
  if (opt.command === 'plan') {
    console.log(`Full release: verify prerequisites; build/store checks; Claude Desktop bundle; universal notarized DMG; signed feed; store submissions; push main and immutable v${version}; wait Package CI; publish verified GitHub assets; prepare/test/push frostdev.io; wait Website CI; deploy and verify live pages/feed.\nWebsite checkout: ${redact(env.FROSTDEV_SITE_DIR)}\nNo builds, network calls, uploads, or branch changes performed.`); return;
  }
  if (['release', 'publish', 'doctor'].includes(opt.command)) publicPreflight(opt, env, root, { version, sourceCommit: commit });
  if (opt.command === 'doctor') { if (!await doctor(opt, env)) process.exitCode = 1; return; }
  if (['release', 'submit'].includes(opt.command) && !await doctor(opt, env)) throw new Error('Credential preflight failed; no packages were uploaded.');
  if (opt.command === 'build' && opt.stores.includes('apple') && !await doctor({ ...opt, stores: ['apple'] }, env, false)) throw new Error('Apple signing prerequisites are missing.');
  fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
  const lock = path.join(out, '.lock');
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx', 0o600); } catch { throw new Error(`Another run owns ${lock}. If it crashed, confirm its PID is no longer running before removing the lock.`); }
  fs.writeFileSync(lockFd, `${process.pid}\n`);
  try {
    const file = path.join(out, 'release.json');
    const targets = { chrome: chromeTarget(env), firefox: env.AMO_ADDON_ID, apple: env.ASC_BUNDLE_ID };
    const manifest = fs.existsSync(file) ? json(file) : {
      schema: 1, version, sourceCommit: commit, firefoxBase, stores: opt.stores, applePlatforms: opt.applePlatforms,
      buildNumber: env.BUILD_NUMBER || new Date().toISOString().replace(/\D/g, '').slice(0, 14), targets, files: {}, receipts: {}, ready: false,
    };
    for (const [name, value] of Object.entries({ version, sourceCommit: commit, stores: opt.stores, applePlatforms: opt.applePlatforms, targets })) {
      if (JSON.stringify(manifest[name]) !== JSON.stringify(value)) throw new Error(`${name} differs from the saved release. Use a separate --out directory.`);
    }
    if (!manifest.ready && manifest.firefoxBase !== firefoxBase) throw new Error('Firefox base changed during an incomplete build; use a separate --out directory.');
    const save = () => { fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); };
    save();
    if (!['submit', 'publish'].includes(opt.command)) await build(opt, env, manifest, save, out);
    verify(manifest, out);
    if (opt.command === 'build') { console.log(`Built and verified packages: ${out}`); return; }
    const publicContext = { manifest, save, out, root, env, run };
    if (opt.command === 'release') await preparePublic(publicContext);
    if (opt.command === 'publish') { await publishPublic(publicContext); return; }
    // Resolve paths only in the upload view; the persisted manifest remains relocatable.
    const upload = { ...manifest, listings, files: Object.fromEntries(Object.entries(manifest.files).map(([k, f]) => [k, { ...f, path: path.join(out, f.path) }])) };
    if (opt.stores.includes('chrome')) {
      writeChromeKit(chromeKitDir(version), listings);
      console.log(`Chrome listing: paste release/${version}/chrome-web-store/listing-<language>.txt into the dashboard, one per language.`);
    }
    let failures = 0;
    for (const store of opt.stores) {
      const receipt = manifest.receipts[store] ||= {};
      if (receipt.submitted) { console.log(`${store}: submission already recorded; skipped.`); continue; }
      try {
        if (store === 'chrome') await submitChrome(env, upload, receipt, save);
        else if (store === 'firefox') await submitFirefox(env, upload, receipt, save);
        else { await uploadApple(env, upload, receipt, save, out); await submitApple(env, upload, receipt, save); }
        delete receipt.error; save();
      } catch (error) { failures++; receipt.error = redact(error.message); save(); console.error(`${store}: ${receipt.error}`); }
    }
    if (opt.command === 'release') {
      try { await publishPublic(publicContext); }
      catch (error) { failures++; manifest.public.error = redact(error.message); save(); console.error(`Public release: ${manifest.public.error}`); }
    }
    console.log(`Receipts: ${file}`);
    if (failures) throw new Error(`${failures} release stage(s) need attention. Rerun release with the same --source-ref/--out/options to resume all stages; submit resumes stores only, publish resumes public publication only.`);
    console.log(opt.command === 'release' ? 'Release complete: stores submitted, GitHub release published, website and signed feed verified live. Store approval/public availability remains separate.' : 'All selected stores submitted. Public publication was not run; use release or publish for GitHub and frostdev.io. Store approval/public availability remains separate.');
  } finally { fs.closeSync(lockFd); fs.rmSync(lock, { force: true }); }
}
const chromeTarget = env => `${env.CWS_PUBLISHER_ID}/${env.CWS_EXTENSION_ID}`;
const chromeKitDir = version => path.join(root, 'release', version, 'chrome-web-store');
// The listings command: reads each store and reports per language what a release would change.
async function previewListings(opt, env, listings, version) {
  console.log(`Store listings for Glaze ${version}: what a release would change. Nothing is written.`);
  let failures = 0;
  for (const store of opt.stores) {
    try {
      const changes = [];
      if (store === 'chrome') {
        for (const { lang } of Object.values(listings)) changes.push({ store: 'Chrome', locale: lang, field: 'paste kit', action: 'write', detail: path.relative(root, path.join(chromeKitDir(version), `listing-${lang}.txt`)) });
      } else if (store === 'firefox') {
        requireValue(env.AMO_JWT_ISSUER, 'AMO_JWT_ISSUER'); requireValue(env.AMO_JWT_SECRET, 'AMO_JWT_SECRET');
        changes.push(...await syncFirefoxListing(env, listings, { write: false, version }));
      } else {
        for (const key of ['ASC_KEY_PATH', 'ASC_KEY_ID', 'ASC_ISSUER_ID']) requireValue(env[key], key);
        for (const platform of opt.applePlatforms) changes.push(...await previewAppleListing(env, platform, version, listings));
      }
      for (const line of describeChanges(changes)) console.log(line);
    } catch (error) { failures++; console.error(`${store}: ${redact(error.message)}`); }
  }
  if (failures) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`store-release: ${redact(error.message)}`); process.exitCode = 1; });
}
