// What the browser checks share: where their heavy-run lock lives and which Chromium they launch.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The directory a check creates (mkdir, so a second holder fails with EEXIST) while it runs. GLAZE_LOCK overrides the
// default in the OS temp directory, which every machine has. The parent is made here so that only a held lock can fail
// the mkdir that takes it.
function lockPath(env = process.env, tmp = os.tmpdir()) {
  const lock = path.resolve(env.GLAZE_LOCK || path.join(tmp, 'glaze-heavy.lock'));
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  return lock;
}

// CHROME names a browser to use; unset gives undefined.
const chromePath = (env = process.env) => env.CHROME || undefined;

// Playwright launch options: CHROME, else the Chromium Playwright installed. `headless: true` alone picks Playwright's
// headless shell, which cannot load an extension; channel "chromium" is the full browser in new headless mode.
const chromeLaunch = (env = process.env) => (chromePath(env) ? { executablePath: chromePath(env) } : { channel: 'chromium' });

module.exports = { lockPath, chromePath, chromeLaunch };
