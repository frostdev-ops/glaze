// Checks what `npm install --ignore-scripts` put in a node_modules against pinned integrity values, before any of it runs.
//   node scripts/npm-integrity.js <node_modules/.package-lock.json> <pins file, or - for stdin> [required package name...]
// A pin is one line, "name@version sha512-<base64>", as `npm view <name>@<version> dist.integrity` prints it. npm
// checks each tarball against the integrity its registry metadata gives; this checks that metadata against ours. Every
// installed package must be pinned (so a new dependency, or another version, fails), must have come from the npm registry,
// and must carry exactly the pinned integrity. Pins for packages that were not installed (other platforms' esbuild
// binaries) are fine.
const fs = require('node:fs');

const REGISTRY = 'https://registry.npmjs.org/';

function parsePins(text) {
  const pins = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(@?[^@\s]+(?:\/[^@\s]+)?@\d+\.\d+\.\d+\S*)\s+(sha512-[A-Za-z0-9+/]+={0,2})$/);
    if (!m) throw new Error(`bad pin: ${line}`);
    if (pins.has(m[1])) throw new Error(`${m[1]} is pinned twice`);
    pins.set(m[1], m[2]);
  }
  return pins;
}

// Returns the verified "name@version" ids; throws one Error listing every problem found.
function check(lock, pinText, required = []) {
  if (!lock || typeof lock !== 'object' || !lock.packages || typeof lock.packages !== 'object') throw new Error('not an npm lockfile (no "packages")');
  const pins = parsePins(pinText), problems = [], ok = [], installed = new Set();
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key) continue; // the project itself
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = `${name}@${entry.version}`;
    installed.add(name);
    if (entry.link) { problems.push(`${id} is a link`); continue; }
    if (!String(entry.resolved || '').startsWith(REGISTRY)) { problems.push(`${id} was not fetched from the npm registry (${entry.resolved || 'no source recorded'})`); continue; }
    if (!/^sha512-/.test(entry.integrity || '')) { problems.push(`${id} has no integrity`); continue; }
    const want = pins.get(id);
    if (!want) problems.push(`unpinned package ${id}`);
    else if (want !== entry.integrity) problems.push(`integrity mismatch for ${id}: pinned ${want}, npm recorded ${entry.integrity}`);
    else ok.push(id);
  }
  for (const name of required) if (!installed.has(name)) problems.push(`required package ${name} is not installed`);
  if (problems.length) throw new Error(problems.join('\n'));
  return ok;
}

if (require.main === module) {
  const [lockFile, pinFile, ...required] = process.argv.slice(2);
  try {
    if (!lockFile || !pinFile) throw new Error('usage: npm-integrity.js <.package-lock.json> <pins|-> [required...]');
    let lock;
    try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (error) { throw new Error(`cannot read npm's lockfile ${lockFile} (${error.code || error.message}); nothing can be verified`); }
    const verified = check(lock, fs.readFileSync(pinFile === '-' ? 0 : pinFile, 'utf8'), required);
    console.log(`npm-integrity: ${verified.length} packages match their pinned integrity`);
  } catch (error) {
    console.error(`npm-integrity: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { check, parsePins };
