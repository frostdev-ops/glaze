// What a package's manifest carries for Google (package.sh, tools/build/package-firefox.sh): the oauth2 key and the optional
// identity permission, each only while a feature that uses it is on. Google Calendar sync: lib/gcal.js ON, off until Google
// verifies the app. Drive: lib/google.js ON, and then only once its clients in lib/google-config.js are real (ready). Safari carries neither
// (tools/build/safari-manifest.sh): its sign-in goes through the app.
//   node tools/build/oauth-manifest.js <chrome|firefox> <manifest.json>   → the manifest, to stdout
const CALENDAR = 'https://www.googleapis.com/auth/calendar.app.created';

// target 'chrome' (Chrome, Edge and other Chromium stores) or 'firefox'; calendar: lib/gcal.js ON; drive: lib/google.js ON;
// config: lib/google-config.js.
function oauth(manifest, { target, calendar, drive, config }) {
  const { ready } = require('../../extension/lib/google.js');
  const m = structuredClone(manifest);
  const chrome = drive === true && target === 'chrome' && ready(config, 'chrome'), web = drive === true && ready(config, 'web');
  const scopes = [...(target === 'chrome' && calendar ? [CALENDAR] : []), ...(chrome ? config.scopes : [])];
  if (scopes.length) m.oauth2 = { client_id: chrome ? config.chrome : manifest.oauth2.client_id, scopes };
  else delete m.oauth2;
  const identity = target === 'chrome' ? calendar || chrome || web : web;
  const optional = (manifest.optional_permissions || []).filter((p) => identity || p !== 'identity');
  if (identity && !optional.includes('identity')) optional.unshift('identity');
  if (optional.length) m.optional_permissions = optional;
  else delete m.optional_permissions;
  return m;
}

if (require.main === module) {
  const [target, file] = process.argv.slice(2);
  if (!['chrome', 'firefox'].includes(target) || !file) throw new Error('usage: node tools/build/oauth-manifest.js <chrome|firefox> <manifest.json>');
  const m = JSON.parse(require('node:fs').readFileSync(file, 'utf8'));
  // The Chrome package keeps Calendar's client while Calendar is on; Firefox's starts from that package.
  const calendar = require('../../extension/lib/gcal.js').ON === true;
  const drive = require('../../extension/lib/google.js').ON === true;
  process.stdout.write(`${JSON.stringify(oauth(m, { target, calendar, drive, config: require('../../extension/lib/google-config.js') }), null, 2)}\n`);
}

module.exports = { CALENDAR, oauth };
