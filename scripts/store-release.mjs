#!/usr/bin/env node
// Build committed Glaze sources in isolated clones and submit the exact, checksummed artifacts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { appleApp, appleBuild, amo, chromeStatus, submitChrome, submitFirefox, submitApple } from './store-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaults = {
  CWS_PUBLISHER_ID: '82318a69-812d-438a-842f-e87fcaec1bd6',
  CWS_EXTENSION_ID: 'jmmaeoajomodnbnlmdikjooalmcilooh',
  CWS_SERVICE_ACCOUNT: 'cws-publisher@frostdev-507119.iam.gserviceaccount.com',
  AMO_ADDON_ID: 'glaze@frostdev.io', ASC_BUNDLE_ID: 'io.frostdev.Glaze', SAFARI_TEAM_ID: '22AAZFMTV8',
};
const usage = `Usage: node scripts/store-release.mjs [release|doctor|plan|build|submit] [options]

  release              Check credentials, build, upload, and submit (default).
  doctor               Read-only credential and store-access checks.
  plan                 Show source/targets/output without network access or writes.
  build                Test and build packages, with no uploads.
  submit               Resume uploads/submissions from existing verified packages.

  --config FILE        Credentials file (default ~/.config/glaze/stores.env).
  --stores LIST        chrome,firefox,apple (default all three).
  --apple-platforms LIST  MAC_OS,IOS (default both).
  --source-ref REF     Committed release source (default HEAD).
  --firefox-ref REF    Compatibility source (default dev/firefox).
  --out DIRECTORY     Release workspace (default release/<version>/stores/<source SHA>).
  --notes FILE        Plain-text release notes (default current CHANGELOG.md entry).
  --help               Show this help.

Chrome is staged and Apple uses manual release after approval. Firefox listed submissions
may publish as soon as AMO approves them. See RELEASING.md for credentials and recovery.`;
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
  if (!['release', 'doctor', 'plan', 'build', 'submit'].includes(result.command)) throw new Error(`Unknown command ${result.command}`);
  if (result.stores.some(s => !['chrome', 'firefox', 'apple'].includes(s))) throw new Error('Stores must be chrome,firefox,apple.');
  if (result.applePlatforms.some(s => !['MAC_OS', 'IOS'].includes(s))) throw new Error('Apple platforms must be MAC_OS,IOS.');
  return result;
}
function environment(opt) {
  let configured = {};
  if (fs.existsSync(opt.config)) configured = parseEnv(fs.readFileSync(opt.config, 'utf8'));
  else if (opt.explicitConfig) throw new Error(`Missing config file ${opt.config}`);
  const env = { ...defaults, ...configured, ...process.env };
  env.AMO_JWT_ISSUER ||= env.WEB_EXT_API_KEY;
  env.AMO_JWT_SECRET ||= env.WEB_EXT_API_SECRET;
  if (env.ASC_KEY_PATH) env.ASC_KEY_PATH = path.resolve(path.dirname(opt.config), expand(env.ASC_KEY_PATH));
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
    } catch (error) { failures++; console.log(`${store}: ${error.message}`); }
  }
  return failures === 0;
}
async function run(command, args, cwd, env, log) {
  console.log(`Running ${command} ${args.join(' ')}`);
  const fd = log ? fs.openSync(log, 'w', 0o600) : null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: fd === null ? ['ignore', 'inherit', 'inherit'] : ['ignore', fd, fd] });
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
    if (!manifest.notes || (opt.stores.includes('apple') && manifest.notes.length > 4000)) throw new Error('Release notes must be nonempty and at most 4,000 characters for Apple. Use --notes FILE for shorter notes.');
    await run('nice', ['-n', '15', 'node', '--test'], source, env, path.join(out, 'logs/tests-main.log'));
    const dist = path.join(temp, 'dist'); fs.mkdirSync(dist);
    if (opt.stores.includes('chrome') || opt.stores.includes('apple')) await run('bash', ['package.sh'], source, { ...env, DIST: dist });
    const artifact = (key, file) => { manifest.files[key] = { path: path.relative(out, file), sha256: digest(file) }; };
    if (opt.stores.includes('chrome')) {
      const dest = path.join(out, `glaze-v${manifest.version}.zip`);
      fs.copyFileSync(path.join(dist, path.basename(dest)), dest); artifact('chrome', dest);
    }
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
      await run('npx', ['--yes', 'web-ext@10.8.0', 'lint', '--no-config-discovery', '--warnings-as-errors', '--source-dir', extracted, '--output', 'json'], root, env, path.join(out, 'logs/firefox-lint.json'));
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
function verify(manifest, out) {
  if (!manifest.ready) throw new Error('Packages are incomplete. Run build or release first.');
  const required = manifest.stores.flatMap(store => store === 'chrome' ? ['chrome'] : store === 'firefox' ? ['firefox', 'firefoxSource'] : manifest.applePlatforms);
  for (const key of required) {
    const file = requireValue(manifest.files[key], `Artifact ${key}`);
    if (path.isAbsolute(file.path) || path.relative(out, path.resolve(out, file.path)).startsWith('..')) throw new Error('Artifact path leaves the release directory.');
    if (digest(path.join(out, file.path)) !== file.sha256) throw new Error(`Checksum changed for ${file.path}; refusing upload.`);
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

export async function main(args = process.argv.slice(2)) {
  const opt = options(args);
  if (opt.help) { console.log(usage); return; }
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Node.js 26 or newer is required, matching CI and the release validation suite.');
  const env = environment(opt);
  if (opt.command === 'doctor') { if (!await doctor(opt, env)) process.exitCode = 1; return; }
  const commit = git(['rev-parse', '--verify', `${opt.sourceRef}^{commit}`]);
  const version = JSON.parse(git(['show', `${commit}:manifest.json`])).version;
  const firefoxBase = opt.stores.includes('firefox') ? git(['rev-parse', '--verify', `${opt.firefoxRef}^{commit}`]) : null;
  if (firefoxBase) {
    const permanent = git(['rev-parse', '--verify', 'dev/firefox^{commit}']);
    try { git(['merge-base', '--is-ancestor', permanent, firefoxBase]); } catch { throw new Error('--firefox-ref must contain the permanent dev/firefox branch and its compatibility fixes.'); }
  }
  const out = opt.out || path.join(root, 'release', version, 'stores', commit.slice(0, 12));
  console.log(`Glaze ${version}, committed source ${commit}\nStores: ${opt.stores.join(', ')}\nApple platforms: ${opt.applePlatforms.join(', ')}\nFirefox compatibility base: ${firefoxBase || '(not selected)'}\nOutput: ${out}`);
  if (opt.command === 'plan') { console.log('No builds, network calls, uploads, or branch changes performed.'); return; }
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
    for (const [name, value] of Object.entries({ sourceCommit: commit, stores: opt.stores, applePlatforms: opt.applePlatforms, targets })) {
      if (JSON.stringify(manifest[name]) !== JSON.stringify(value)) throw new Error(`${name} differs from the saved release. Use a separate --out directory.`);
    }
    if (!manifest.ready && manifest.firefoxBase !== firefoxBase) throw new Error('Firefox base changed during an incomplete build; use a separate --out directory.');
    const save = () => { fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file); };
    save();
    if (opt.command !== 'submit') await build(opt, env, manifest, save, out);
    verify(manifest, out);
    if (opt.command === 'build') { console.log(`Built and verified packages: ${out}`); return; }
    // Resolve paths only in the upload view; the persisted manifest remains relocatable.
    const upload = { ...manifest, files: Object.fromEntries(Object.entries(manifest.files).map(([k, f]) => [k, { ...f, path: path.join(out, f.path) }])) };
    let failures = 0;
    for (const store of opt.stores) {
      const receipt = manifest.receipts[store] ||= {};
      if (receipt.submitted) { console.log(`${store}: submission already recorded; skipped.`); continue; }
      try {
        if (store === 'chrome') await submitChrome(env, upload, receipt, save);
        else if (store === 'firefox') await submitFirefox(env, upload, receipt, save);
        else { await uploadApple(env, upload, receipt, save, out); await submitApple(env, upload, receipt, save); }
        delete receipt.error; save();
      } catch (error) { failures++; receipt.error = error.message; save(); console.error(`${store}: ${error.message}`); }
    }
    console.log(`Receipts: ${file}`);
    if (failures) throw new Error(`${failures} store(s) need attention. Resolve the reported issue and rerun submit with the same options.`);
    console.log('All selected releases submitted. Submission is separate from approval and public availability.');
  } finally { fs.closeSync(lockFd); fs.rmSync(lock, { force: true }); }
}
const chromeTarget = env => `${env.CWS_PUBLISHER_ID}/${env.CWS_EXTENSION_ID}`;
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`store-release: ${error.message}`); process.exitCode = 1; });
}
