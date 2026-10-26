// Checks Chromium and FFmpeg in PLAYWRIGHT_BROWSERS_PATH against ci/*.pins before either runs.
//   NODE_PATH=<node_modules holding the pinned playwright> PLAYWRIGHT_BROWSERS_PATH=<dir> node scripts/ci-chromium.js [--print]
// Playwright checks a download's size, not its bytes, and its Chromium build is fixed by playwright-core's browsers.json
// (ci/playwright.pins pins that package). A pin is "<name>-<revision> <version or -> <platform>-<arch> <sha256>",
// over every extracted file's path and bytes (a link's target), sorted; the marker files Playwright writes are left out.
// --print gives the line for this machine: to upgrade, bump the pinned Playwright, install, and record the new lines.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MARKERS = new Set(['INSTALLATION_COMPLETE', 'DEPENDENCIES_VALIDATED']);

function treeHash(dir) {
  const lines = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name, full = path.join(dir, r);
      if (!rel && MARKERS.has(e.name)) continue;
      if (e.isSymbolicLink()) lines.push(`l ${r} ${fs.readlinkSync(full)}`);
      else if (e.isDirectory()) { lines.push(`d ${r}`); walk(r); }
      else if (e.isFile()) lines.push(`f ${r} ${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      else throw new Error(`${r} is neither a file, a directory nor a link`);
    }
  };
  walk('');
  if (!lines.some((l) => l.startsWith('f '))) throw new Error(`${dir} holds no files`);
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

function parsePins(text) {
  const pins = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^((?:chromium|ffmpeg)-\d+) (\d+(?:\.\d+){3}|-) ([a-z0-9]+-[a-z0-9]+) ([0-9a-f]{64})$/);
    if (!m) throw new Error(`bad pin: ${line}`);
    const key = `${m[1]} ${m[3]}`;
    if (pins.has(key)) throw new Error(`${key} is pinned twice`);
    pins.set(key, { version: m[2], hash: m[4] });
  }
  return pins;
}

// The installed build as { dir, line }, where line is its pin.
function installed(env = process.env, platform = `${process.platform}-${process.arch}`, name = 'chromium') {
  if (!env.PLAYWRIGHT_BROWSERS_PATH || !path.isAbsolute(env.PLAYWRIGHT_BROWSERS_PATH)) throw new Error('set PLAYWRIGHT_BROWSERS_PATH to the absolute directory playwright installed into');
  const core = path.dirname(require.resolve('playwright-core/package.json'));
  const build = JSON.parse(fs.readFileSync(path.join(core, 'browsers.json'), 'utf8')).browsers.find((b) => b.name === name);
  if (!build || build.revisionOverrides) throw new Error(`unsupported build descriptor for ${name}`);
  const dir = path.join(env.PLAYWRIGHT_BROWSERS_PATH, `${name}-${build.revision}`);
  if (!fs.existsSync(path.join(dir, 'INSTALLATION_COMPLETE'))) throw new Error(`${dir} is not a finished Playwright install`);
  return { dir, line: `${name}-${build.revision} ${build.browserVersion || '-'} ${platform} ${treeHash(dir)}` };
}

function check(line, pinText) {
  const [build, version, platform, hash] = line.split(' ');
  const want = parsePins(pinText).get(`${build} ${platform}`);
  if (!want) throw new Error(`no pin for ${build} on ${platform}; installed: ${line}`);
  if (want.version !== version) throw new Error(`${build} is version ${version}, pinned as ${want.version}`);
  if (want.hash !== hash) throw new Error(`${build} on ${platform} hashes to ${hash}, pinned ${want.hash}`);
}

function verify(env = process.env) {
  const lines = ['chromium', 'ffmpeg'].map((name) => {
    const { line } = installed(env, undefined, name);
    check(line, fs.readFileSync(path.join(__dirname, `../ci/${name}.pins`), 'utf8'));
    return line;
  });
  for (const line of lines) console.log(`ci-chromium: ${line.split(' ').slice(0, 3).join(' ')} matches its pin`);
}

if (require.main === module) {
  try {
    if (process.argv[2] === '--print') for (const name of ['chromium', 'ffmpeg']) console.log(installed(process.env, undefined, name).line);
    else verify();
  } catch (error) {
    console.error(`ci-chromium: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { treeHash, parsePins, installed, check, verify };
