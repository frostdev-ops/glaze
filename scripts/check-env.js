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

// A storage write finishes before the worker's list-change handler has registered the script. Polled from Node:
// waitForFunction resolves at once on an async predicate (its promise is truthy), so pages loaded before Glaze ran.
const ultraRegistered = async () => {
  const first = chrome.runtime.getManifest().content_scripts.find((s) => s.js.includes('content-ultra.js'));
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const patterns = [...first.matches, ...scripts.filter((s) => s.js?.includes('content-ultra.js')).flatMap((s) => s.matches)];
  const sites = (await chrome.storage.local.get('ultra')).ultra;
  return Array.isArray(sites) && sites.length > 0 && sites.every((site) => {
    const u = new URL(site);
    return patterns.some((p) => {
      const m = /^(https?:)\/\/([^/]+)\/ultra\/\*$/.exec(p);
      return m && m[1] === u.protocol && (m[2] === '*' || m[2] === u.hostname || m[2].startsWith('*.') && (u.hostname === m[2].slice(2) || u.hostname.endsWith(m[2].slice(1))));
    });
  });
};
const ultraReady = async (page, timeout = 10000) => {
  for (const end = Date.now() + timeout; ; await new Promise((r) => setTimeout(r, 100))) {
    if (await page.evaluate(ultraRegistered)) return;
    if (Date.now() > end) throw new Error('ultraReady: content-ultra.js is not registered for the test site');
  }
};

// A new profile's install (lib/background.js onInstalled) writes storage.local after Glaze's pages can load, so a check that
// seeds or compares storage first waits for each install task's last write: the starter widgets (freshDefaults settles
// with widgetLayout and starterTouched), the tabs-auto migration and the channel-key move. Polled from Node, as ultraReady.
const installDone = async () => {
  const l = await chrome.storage.local.get(['freshDefaults', 'migrated', 'channelKeysMoved']);
  return l.freshDefaults?.pending === false && Array.isArray(l.migrated) && l.migrated.includes('tabs-auto') && l.channelKeysMoved === true;
};
const installed = async (page, timeout = 10000) => {
  for (const end = Date.now() + timeout; ; await new Promise((r) => setTimeout(r, 50))) {
    if (await page.evaluate(installDone)) return;
    if (Date.now() > end) throw new Error('installed: the new profile\'s install never finished writing storage.local');
  }
};

// Glaze opens its first screen (features/welcome.html) in a tab of its own when it is installed on Chrome. A check that
// counts on its own tabs alone closes it, now or when it opens. → a promise of the first one closed: the install's tab opens
// seconds into a run, as the active tab, and a check driving the active tab or a popup over it starts after it.
const noFirstRun = (ctx) => {
  let closed;
  const first = new Promise((r) => { closed = r; });
  const close = (p) => { if (/^chrome-extension:\/\/[a-p]{32}\/features\/welcome\.html/.test(p.url())) p.close().catch(() => {}).then(closed); };
  const watch = (p) => { close(p); p.waitForURL(/\/features\/welcome\.html/, { timeout: 10000 }).then(() => close(p), () => {}); };
  ctx.pages().forEach(watch);
  ctx.on('page', watch);
  return first;
};

module.exports = { lockPath, chromePath, chromeLaunch, staged, ultraReady, installed, noFirstRun };
