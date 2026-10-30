// Where each browser looks for a per-user native messaging host, and the folder whose presence says it is installed.
// macOS and Linux read <dir>/io.frostdev.glaze_mcp.json; Windows reads the manifest path from a key under HKCU\Software
// (Chrome's channels, Vivaldi and Brave all read Google\Chrome's; Brave its own first). Firefox's macOS folder is under
// Mozilla, which may not exist yet, while its data is under Firefox.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HOST = 'io.frostdev.glaze_mcp';
const NMH = 'NativeMessagingHosts';

// id, name, macOS (Application Support), Linux (~/.config), Windows (LOCALAPPDATA, then User Data), Windows keys.
const CHROMIUM = [
  ['chrome', 'Google Chrome', 'Google/Chrome', 'google-chrome', 'Google/Chrome', ['Google\\Chrome']],
  ['chrome-beta', 'Google Chrome Beta', 'Google/Chrome Beta', 'google-chrome-beta', 'Google/Chrome Beta', ['Google\\Chrome']],
  ['chrome-dev', 'Google Chrome Dev', 'Google/Chrome Dev', 'google-chrome-unstable', 'Google/Chrome Dev', ['Google\\Chrome']],
  ['chrome-canary', 'Google Chrome Canary', 'Google/Chrome Canary', 'google-chrome-canary', 'Google/Chrome SxS', ['Google\\Chrome']],
  ['chromium', 'Chromium', 'Chromium', 'chromium', 'Chromium', ['Chromium']],
  ['edge', 'Microsoft Edge', 'Microsoft Edge', 'microsoft-edge', 'Microsoft/Edge', ['Microsoft\\Edge']],
  ['edge-beta', 'Microsoft Edge Beta', 'Microsoft Edge Beta', 'microsoft-edge-beta', 'Microsoft/Edge Beta', ['Microsoft\\Edge']],
  ['edge-dev', 'Microsoft Edge Dev', 'Microsoft Edge Dev', 'microsoft-edge-dev', 'Microsoft/Edge Dev', ['Microsoft\\Edge']],
  ['edge-canary', 'Microsoft Edge Canary', 'Microsoft Edge Canary', null, 'Microsoft/Edge SxS', ['Microsoft\\Edge']],
  ['brave', 'Brave', 'BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser', ['BraveSoftware\\Brave-Browser', 'Google\\Chrome']],
  ['vivaldi', 'Vivaldi', 'Vivaldi', 'vivaldi', 'Vivaldi', ['Google\\Chrome']],
  // Arc's Windows build is a packaged app whose data folder and registry reads aren't known yet.
  ['arc', 'Arc', 'Arc/User Data', null, null, null],
];
const key = (p) => `HKCU\\Software\\${p}\\${NMH}\\${HOST}`;
const abs = (p) => (typeof p === 'string' && path.isAbsolute(p) ? p : null);
const need = (v, name) => { if (!v) throw new Error(`${name} is not set`); return v; };

// Every browser glaze-mcp knows on this OS: { id, name, family, data, dir } (macOS, Linux) or { …, keys } (Windows).
const table = (platform, env) => {
  if (platform === 'win32') {
    const local = need(abs(env.LOCALAPPDATA), 'LOCALAPPDATA');
    const roaming = abs(env.APPDATA) || path.join(local, '..', 'Roaming');
    return [
      ...CHROMIUM.filter((b) => b[4]).map(([id, name, , , w, keys]) => ({ id, name, family: 'chromium', data: path.join(local, w, 'User Data'), keys: keys.map(key) })),
      { id: 'firefox', name: 'Firefox', family: 'firefox', data: path.join(roaming, 'Mozilla', 'Firefox'), keys: [key('Mozilla')] },
    ];
  }
  const home = need(abs(env.HOME), 'HOME');
  if (platform === 'darwin') {
    const as = path.join(home, 'Library', 'Application Support');
    return [
      ...CHROMIUM.map(([id, name, m]) => ({ id, name, family: 'chromium', data: path.join(as, m), dir: path.join(as, m, NMH) })),
      { id: 'firefox', name: 'Firefox', family: 'firefox', data: path.join(as, 'Firefox'), dir: path.join(as, 'Mozilla', NMH) },
    ];
  }
  // Chromium's user data folder on Linux: $CHROME_CONFIG_HOME, else $XDG_CONFIG_HOME, else ~/.config.
  const config = abs(env.CHROME_CONFIG_HOME) || abs(env.XDG_CONFIG_HOME) || path.join(home, '.config');
  return [
    ...CHROMIUM.filter((b) => b[3]).map(([id, name, , l]) => ({ id, name, family: 'chromium', data: path.join(config, l), dir: path.join(config, l, NMH) })),
    { id: 'firefox', name: 'Firefox', family: 'firefox', data: path.join(home, '.mozilla', 'firefox'), dir: path.join(home, '.mozilla', 'native-messaging-hosts') },
  ];
};

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const present = (list) => list.filter((b) => isDir(b.data));

// glaze-mcp's own folder: the versioned copies, and `hosts` with the launchers (and, on Windows, the manifests).
const folder = (platform, env) => {
  const root = platform === 'win32' ? path.join(need(abs(env.LOCALAPPDATA), 'LOCALAPPDATA'), 'glaze-mcp')
    : platform === 'darwin' ? path.join(need(abs(env.HOME), 'HOME'), 'Library', 'Application Support', 'glaze-mcp')
      : path.join(abs(env.XDG_DATA_HOME) || path.join(need(abs(env.HOME), 'HOME'), '.local', 'share'), 'glaze-mcp');
  return { root, hosts: path.join(root, 'hosts') };
};

module.exports = { HOST, table, present, folder, isDir };
