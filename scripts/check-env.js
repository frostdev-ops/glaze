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

// A copy of the extension at `src` whose manifest also holds `hosts`: a school's own host, which Glaze reaches on Chrome
// once the student grants it, and which a headless browser can't grant (its prompt has no answer there). Every file but the
// manifest is a hard link to the source's (a plain copy across devices), so it is cheap: write nothing into it but the
// manifest. It goes when the process exits. → its real path: Chrome derives an unpacked extension's id from it.
function staged(src, hosts, tmp = os.tmpdir()) {
  const from = fs.realpathSync(src);
  const to = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'glaze-staged-')));
  process.once('exit', () => fs.rmSync(to, { recursive: true, force: true }));
  const link = (a, b) => {
    for (const e of fs.readdirSync(a, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const x = path.join(a, e.name), y = path.join(b, e.name);
      if (e.isDirectory()) { fs.mkdirSync(y); link(x, y); } else if (e.isFile()) { try { fs.linkSync(x, y); } catch { fs.copyFileSync(x, y); } }
    }
  };
  link(from, to);
  fs.rmSync(path.join(to, 'manifest.json'));
  const m = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
  m.host_permissions = [...new Set([...(m.host_permissions || []), ...hosts])];
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(m, null, 2));
  return to;
}

module.exports = { lockPath, chromePath, chromeLaunch, staged };
