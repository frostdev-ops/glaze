// The worker's agent link (lib/agent-link.js) in headless Firefox on the Mac, with the real glaze-mcp helper and agents, over
// WebDriver BiDi. Firefox runs the worker as an event page, with extensions.background.idle.timeout at 3 s here, and answers
// permissions.request itself (extensions.webextOptionalPermissionPrompts off). The check shows:
//   1. nativeMessaging granted from a trusted click in Settings reaches the event page that started without it, whose
//      runtime gains connectNative, and its link connects with no reload (Chrome's running worker has no
//      connectNative until it restarts, so its link shows restart: progress.md, spike Q2);
//   2. the open native port keeps the event page up through 60 s with no traffic at all (bug 1770696), and an agent's
//      round trip works after it, on the connection it opened before and on a new one; the helper killed reads as exited
//      and the link reconnects; with the port closed the page stops within seconds (the timeout is in force);
//   3. what Firefox says as the port closes with no host manifest and with one that doesn't list Glaze.
// Isolation: the staged package's host name is io.frostdev.glaze_mcp_check_<pid> (patched once), the only file written
// outside temp folders is that manifest in ~/Library/Application Support/Mozilla/NativeMessagingHosts (removed at the end,
// with any folder the check made for it), and the helper and agents run with a temp HOME, so the run folder is the check's.
// This file names connectNative only in comments: test/agent-link.test.js lets lib/agent-link.js alone call it, so the
// link's own state is the evidence (restart when it is missing).
//   FIREFOX=<Firefox.app> nice -n 10 lockf -k <heavy lock> node scripts/agent-link-firefox-check.mjs [<evidence folder>]
// The evidence folder gets results.json, check.log and firefox.log (the helper's stderr included).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') { console.error('agent-link-firefox-check runs on the Mac only'); process.exit(2); }
const app = process.env.FIREFOX || '/Applications/Firefox.app';
const bin = app.endsWith('.app') ? path.join(app, 'Contents/MacOS/firefox') : app;
if (!fs.existsSync(bin)) { console.error('usage: FIREFOX=<Firefox.app> node scripts/agent-link-firefox-check.mjs [<evidence folder>]'); process.exit(2); }
const ID = 'glaze@frostdev.io', UUID = '2b7c4e1a-9d3f-4a6b-8c5e-0f1a2b3c4d5e', EXT = `moz-extension://${UUID}/`;
const REAL = 'io.frostdev.glaze_mcp', NAME = `${REAL}_check_${process.pid}`;
if (!/^io\.frostdev\.glaze_mcp_check_\d+$/.test(NAME)) throw new Error(`not a check host name: ${NAME}`);
const HOSTS = path.join(os.homedir(), 'Library/Application Support/Mozilla/NativeMessagingHosts');
const MANIFEST = path.join(HOSTS, `${NAME}.json`);
const HELPER = path.join(root, 'mcp/bin/glaze-mcp.js');
const IDLE = 60e3, TIMEOUT = 3000;
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'glaze-agent-firefox-'));
const OUT = path.resolve(process.argv[2] || `${tmp}-out`);
const home = path.join(tmp, 'home'), launches = path.join(tmp, 'launches.log'), launcher = path.join(tmp, 'glaze-mcp-host');
const run = path.join(home, 'Library/Application Support/glaze-mcp/run');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { firefox: null, name: NAME, manifest: MANIFEST, idleTimeout: TIMEOUT, idleMs: IDLE };
const lines = [], failed = [];
let checks = 0;
let stopping = false;
const running = () => { if (stopping) throw new Error('the check is stopping'); };
const say = (s) => { lines.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const ok = (value, label) => { if (value) { checks++; say(`ok   ${label}`); } else { failed.push(label); say(`FAIL ${label}`); } return !!value; };
const until = async (fn, label, ms = 15000) => { const end = Date.now() + ms; for (;;) { running(); const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };

// ---- The package, the helper's launcher and its manifest ------------------------------------------------------------
const stage = () => {
  running();
  const dist = fs.mkdtempSync(path.join(tmp, 'dist-'));
  const { ZIP, ZIPOPT, ...env } = process.env; // zip reads both as its own options
  execFileSync('sh', ['scripts/package-firefox.sh', '--development'], { cwd: root, env: { ...env, DIST: dist }, stdio: 'pipe' });
  const dir = path.join(tmp, 'glaze');
  fs.mkdirSync(dir);
  execFileSync('unzip', ['-q', path.join(dist, fs.readdirSync(dist).find((f) => f.endsWith('-firefox.zip'))), '-d', dir]);
  fs.rmSync(dist, { recursive: true, force: true });
  // The host name, exactly once: the link's HOST, which its Firefox not-installed string is made from.
  const f = path.join(dir, 'lib/agent-link.js'), src = fs.readFileSync(f, 'utf8'), lit = `'${REAL}'`;
  const n = src.split(lit).length - 1;
  if (n !== 1) throw new Error(`the staged lib/agent-link.js names ${lit} ${n} times, not once`);
  const patched = src.replace(lit, `'${NAME}'`);
  if (patched.includes(lit) || patched.split(`'${NAME}'`).length !== 2) throw new Error('the host name patch did not take exactly once');
  fs.writeFileSync(f, patched);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  if (!m.optional_permissions?.includes('nativeMessaging') || m.permissions.includes('nativeMessaging')) throw new Error('the package must ask for nativeMessaging as optional');
  if (!m.background.scripts.includes('lib/agent-link.js')) throw new Error('the event page does not load lib/agent-link.js');
  return dir;
};
// Firefox starts the launcher with the manifest's path and Glaze's id; it logs each start and runs the helper under the
// temp HOME. The launcher's pid is the helper's (exec).
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const writeLauncher = () => {
  running();
  fs.mkdirSync(home, { mode: 0o700 });
  fs.writeFileSync(launcher, `#!/bin/sh\nprintf '%s %s\\n' "$$" "$*" >> ${q(launches)}\nHOME=${q(home)}\nexport HOME\nexec ${q(process.execPath)} ${q(HELPER)} host --browser=firefox "$@"\n`, { mode: 0o755 });
};
const started = () => (fs.existsSync(launches) ? fs.readFileSync(launches, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const [pid, ...args] = l.split(' '); return { pid: +pid, args: args.join(' ') }; }) : []);
let present = null;
const made = []; // folders the check made for the manifest, outermost first
const mkdir = (d) => {
  try { if (!fs.lstatSync(d).isDirectory()) throw new Error(`${d} is not a directory`); return; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  mkdir(path.dirname(d));
  try { fs.mkdirSync(d); made.push(d); }
  catch (e) { if (e.code !== 'EEXIST' || !fs.lstatSync(d).isDirectory()) throw e; }
};
const writeManifest = (allowed) => {
  running();
  if (path.basename(MANIFEST) === `${REAL}.json`) throw new Error('refusing the real host name');
  mkdir(HOSTS);
  const fd = fs.openSync(MANIFEST, 'wx', 0o600);
  try {
    present = fs.fstatSync(fd); // own even a partial write, but never a replacement file
    fs.writeFileSync(fd, `${JSON.stringify({ name: NAME, description: 'glaze-mcp (agent-link-firefox-check)', path: launcher, type: 'stdio', allowed_extensions: allowed }, null, 2)}\n`);
  } finally { fs.closeSync(fd); }
};
const removeManifest = () => {
  if (!present) return;
  try {
    const st = fs.lstatSync(MANIFEST);
    if (st.dev !== present.dev || st.ino !== present.ino) throw new Error(`${MANIFEST} was replaced; leaving it alone`);
    fs.unlinkSync(MANIFEST);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  present = null;
};
const runFiles = () => (fs.existsSync(run) ? fs.readdirSync(run).filter((f) => /^firefox\.[0-9a-f]{20}\.json$/.test(f)).map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(run, f), 'utf8')) })) : []);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const isHelper = (pid) => { try { return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim() === `${process.execPath} ${HELPER} host --browser=firefox ${MANIFEST} ${ID}`; } catch { return false; } };

// ---- Agents ---------------------------------------------------------------------------------------------------------
const agents = new Set();
const agent = (label) => {
  running();
  const p = spawn(process.execPath, [HELPER, 'agent', '--browser', 'firefox'], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  agents.add(p);
  let buf = '', err = '';
  const got = [], waiting = new Map();
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    for (buf += d; buf.includes('\n');) {
      const line = buf.slice(0, buf.indexOf('\n'));
      buf = buf.slice(line.length + 1);
      let m;
      try { m = JSON.parse(line); } catch { m = { unparsed: line }; }
      got.push(m);
      waiting.get(m.id)?.(m);
    }
  });
  p.stderr.on('data', (d) => { err += d; });
  p.stdin.on('error', () => {});
  const exited = new Promise((r) => p.once('exit', (code, signal) => { agents.delete(p); r({ code, signal }); }));
  const tell = (m) => p.stdin.write(`${JSON.stringify(m)}\n`);
  const ask = (m, ms = 15000) => new Promise((resolve, reject) => {
    const at = Date.now();
    const timer = setTimeout(() => { waiting.delete(m.id); reject(new Error(`${label}: no answer to ${m.method} in ${ms} ms (stderr: ${err.trim()})`)); }, ms);
    waiting.set(m.id, (r) => { clearTimeout(timer); waiting.delete(m.id); resolve({ ...r, ms: Date.now() - at }); });
    tell(m);
  });
  return { p, ask, tell, exited, err: () => err, end: () => { p.stdin.end(); return exited; } };
};
const INIT = (id) => ({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent-link-firefox-check', version: '1' } } });
const LIST = (id) => ({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
const handshake = async (a) => {
  const init = await a.ask(INIT(1));
  a.tell({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return init;
};

// ---- Firefox --------------------------------------------------------------------------------------------------------
let ff = null, ws = null, sink = null, log = '';
const firefox = async () => {
  running();
  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(profile);
  sink = net.createServer((s) => s.destroy()); // the proxy for every request: nothing leaves the Mac
  await new Promise((r) => sink.listen(0, '127.0.0.1', r));
  const P = sink.address().port;
  const prefs = {
    'extensions.webextensions.uuids': JSON.stringify({ [ID]: UUID }), 'extensions.webextOptionalPermissionPrompts': false,
    'extensions.background.idle.timeout': TIMEOUT,
    'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': P, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': P,
    'network.proxy.no_proxies_on': '', 'network.proxy.allow_hijacking_localhost': true,
    'browser.shell.checkDefaultBrowser': false, 'app.update.disabledForTesting': true, 'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false, 'browser.startup.homepage_override.mstone': 'ignore', 'app.normandy.enabled': false,
    'messaging-system.rsexperimentloader.enabled': false, 'devtools.console.stdout.content': true, 'extensions.update.enabled': false,
    'browser.safebrowsing.malware.enabled': false, 'browser.safebrowsing.phishing.enabled': false,
  };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const port = 9400 + Math.floor(Math.random() * 400);
  running();
  ff = spawn(bin, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '-remote-allow-system-access', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ff.stdout.on('data', (d) => { log += d; }); ff.stderr.on('data', (d) => { log += d; });
  const at = await until(async () => /WebDriver BiDi listening on (ws:\/\/[\d.:]+)/.exec(log)?.[1], 'Firefox to listen', 30000);
  ws = new WebSocket(`${at}/session`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let n = 0;
  const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++n;
    wait.set(id, (d) => (d.type === 'error' ? rej(new Error(`${method}: ${d.error} ${d.message}`)) : res(d.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('session.new', { capabilities: { alwaysMatch: {} } });
  return browser(send);
};
const browser = (send) => {
  const chrome = async () => (await send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts.find((c) => c.url === 'chrome://browser/content/browser.xhtml').context;
  const value = async (expression, context) => {
    const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context }, awaitPromise: true, resultOwnership: 'none', userActivation: false });
    if (r.type === 'exception') throw new Error(`${r.exceptionDetails.text} in ${expression.slice(0, 120)}`);
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  const tree = async () => (await send('browsingContext.getTree', {})).contexts;
  const b = {
    value,
    find: async (prefix) => (await tree()).find((c) => c.url.startsWith(prefix))?.context,
    // A tab, opened as the browser's own UI would (BiDi may not navigate to moz-extension: addresses).
    open: async (url) => {
      const before = new Set((await tree()).map((c) => c.context));
      await value(`(gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }), 1)`, await chrome());
      const c = await until(async () => (await tree()).find((x) => !before.has(x.context))?.context, `a tab for ${url}`);
      await until(() => value('document.readyState === "complete" && location.href !== "about:blank"', c), `${url} to load`);
      await send('browsingContext.activate', { context: c }).catch(() => {});
      return c;
    },
    close: (context) => send('browsingContext.close', { context }),
    // A trusted click in the middle of the element.
    click: async (context, selector) => {
      await send('browsingContext.activate', { context }).catch(() => {});
      const [x, y, hit] = await value(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return [x, y, document.elementFromPoint(x, y) === e]; })()`, context);
      if (!hit) throw new Error(`${selector} is covered`);
      await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pause', duration: 50 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
      await send('input.releaseActions', { context }).catch(() => {});
    },
    // In the browser's own window: the event page's lifecycle, as Firefox's parent sees it, with no debugger attached.
    inChrome: async (expression) => value(expression, await chrome()),
    install: (dir) => send('webExtension.install', { extensionData: { type: 'path', path: dir } }),
  };
  return b;
};
const ext = `WebExtensionPolicy.getByID(${JSON.stringify(ID)}).extension`;
const WATCH = `(() => { const e = ${ext}, w = window.__gzAgent = { log: [] };
  for (const ev of ['background-script-started', 'background-script-suspend', 'background-script-suspend-canceled', 'background-script-suspend-ignored', 'background-script-aborted', 'shutdown-background-script', 'background-script-reset-idle'])
    e.on(ev, (_, d) => w.log.push({ ev, ...(d?.reason && { reason: d.reason }), at: Date.now() }));
  return 1; })()`;
const PAGE = `(() => { const e = ${ext}; return { state: e.backgroundState, child: e.backgroundContext?.childId ?? null, nativePorts: !!e.backgroundContext?.hasActiveNativeAppPorts,
  timeout: Services.prefs.getIntPref('extensions.background.idle.timeout', 30000), log: window.__gzAgent.log }; })()`;
const RESTARTS = /^(background-script-started|background-script-suspend|background-script-aborted|shutdown-background-script)$/;
const restarts = (log) => log.filter((e) => RESTARTS.test(e.ev));
// What Firefox's own code reported (Cu.reportError, and the helper's stderr) about the check's host.
const said = (b) => b.inChrome(`Services.console.getMessageArray().map((m) => (m instanceof Ci.nsIScriptError ? m.errorMessage : m.message)).filter((t) => typeof t === 'string' && t.includes(${JSON.stringify(NAME)}))`);
// A lifecycle log as counts: event (reason) → n.
const tally = (log) => log.reduce((o, e) => { const k = e.reason ? `${e.ev} (${e.reason})` : e.ev; return { ...o, [k]: (o[k] || 0) + 1 }; }, {});
// Script errors and console errors or warnings from Glaze's own files (devtools.console.stdout.content).
// Glaze's pages are the only ones open, so every console error or warning is Glaze's.
const glazeErrors = () => log.split('\n').filter((l) => /^console\.(error|warn): /.test(l) || l.startsWith(`JavaScript error: ${EXT}`)).map((l) => l.replaceAll(EXT, ''));

// In Settings (options.html, top frame): the link's state as storage.session mcpLink mirrors it, every change kept in order.
const WATCH_LINK = `(() => { const seen = window.__links = []; let last = '';
  const keep = (l) => { const s = JSON.stringify(l ?? null); if (s !== last) { last = s; seen.push(l ?? null); } };
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'session' && c.mcpLink) keep(c.mcpLink.newValue); });
  setInterval(() => chrome.storage.session.get('mcpLink').then((r) => keep(r.mcpLink)), 50);
  return chrome.storage.session.get('mcpLink').then((r) => { keep(r.mcpLink); return true; }); })()`;
const link = (b, c) => b.value(`chrome.storage.session.get('mcpLink').then((r) => r.mcpLink ?? null)`, c);
const links = (b, c) => b.value('window.__links', c);
const config = (b, c, m) => b.value(`chrome.runtime.sendMessage(${JSON.stringify({ type: 'glaze:mcp-config', ...m })})`, c);
const settings = async (b) => { const c = await b.open(`${EXT}options.html`); await b.value(WATCH_LINK, c); return c; };
// The link's first answer after `from` (states it has left behind).
const settled = (b, c, label, from = ['off'], ms = 15000) => until(async () => { const l = await link(b, c); return l && ![...from, 'connecting'].includes(l.state) && l; }, label, ms);
// The background page itself, from Settings, where Firefox has it: its runtime's names, and whether it is the page held before.
const BG = (hold) => `(async () => {
  const bg = typeof chrome.runtime.getBackgroundPage === 'function' ? await chrome.runtime.getBackgroundPage()
    : typeof chrome.extension?.getBackgroundPage === 'function' ? chrome.extension.getBackgroundPage() : undefined;
  if (bg === undefined) return { api: false };
  if (!bg) return { api: true, page: false };
  let same = null;
  try { same = window.__bg ? window.__bg === bg && !!window.__bg.chrome : null; } catch { same = false; }
  ${hold ? 'window.__bg = bg;' : 'delete window.__bg;'}
  const names = Object.keys(bg.chrome.runtime).sort();
  return { api: true, page: true, same, runtime: names, native: names.filter((k) => /Native/.test(k)).map((k) => [k, typeof bg.chrome.runtime[k]]), link: typeof bg.GZ_AGENT_LINK };
})()`;

const checkRun = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  R.firefox = execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
  const pkg = stage();
  writeLauncher();
  await require('./wait-for-browser.js')();
  const b = await firefox();
  const dir = await b.inChrome(`Services.dirsvc.get('XREUserNativeManifests', Ci.nsIFile).path`);
  if (path.join(dir, 'NativeMessagingHosts') !== HOSTS) throw new Error(`Firefox reads host manifests from ${dir}/NativeMessagingHosts, not ${HOSTS}`);
  ok(true, `Firefox reads user host manifests from ${HOSTS}`);
  await b.install(pkg);
  await b.inChrome(WATCH);
  const welcome = await until(() => b.find(`${EXT}features/welcome.html`), 'the first-run tab', 10000).catch(() => null);
  if (welcome) await b.close(welcome);
  let c = await settings(b);
  writeManifest([ID]);

  // 1. The grant reaches the running event page.
  ok(await b.value(`chrome.permissions.contains({ permissions: ['nativeMessaging'] })`, c) === false, 'nativeMessaging starts ungranted');
  const on = await config(b, c, { op: 'set', on: true });
  ok(on?.ok && on.link?.state === 'needs-permission', `agent access on, before the grant: ${on?.link?.state}`);
  const bg0 = await b.value(BG(true), c), page0 = await b.inChrome(PAGE);
  await b.value(`(() => { const e = document.createElement('button'); e.id = 'gz-check-grant'; e.textContent = 'Allow';
    e.style.cssText = 'position:fixed;top:8px;left:8px;width:160px;height:48px;z-index:2147483647';
    window.__grant = null;
    e.addEventListener('click', () => {
      const asked = chrome.permissions.request({ permissions: ['nativeMessaging'] });
      window.__grant = asked.then((granted) => chrome.runtime.sendMessage({ type: 'glaze:mcp-config', op: 'set', on: true }).then((set) => ({ granted, set })), (e) => ({ error: String(e) }));
    });
    document.body.append(e); return true; })()`, c);
  await b.click(c, '#gz-check-grant');
  const grant = await until(() => b.value('window.__grant', c), 'the grant');
  if (!ok(grant.granted === true, `Firefox granted nativeMessaging from the click, with no prompt (${JSON.stringify(grant)})`)) throw new Error('no grant');
  const after = await settled(b, c, 'the link after the grant', ['off', 'needs-permission'], 30000);
  const bg1 = await b.value(BG(false), c), page1 = await b.inChrome(PAGE);
  const seen = await links(b, c);
  const between = page1.log.slice(page0.log.length);
  R.grant = { grant, link: after, states: seen.map((l) => l?.state ?? 'none'),
    page: { before: { ...page0, log: undefined }, after: { ...page1, log: undefined }, between: tally(between), restarts: restarts(between) },
    background: { api: bg0.api, page: bg0.page, same: bg1.same, native: { before: bg0.native, after: bg1.native }, runtime: bg0.runtime, link: bg0.link }, launches: started(),
    chrome: 'Chromium (spike Q2): after the grant the running worker still lacks the native connect call, so the link shows restart until the worker restarts' };
  ok(after.state === 'connected' && after.host === require('../mcp/package.json').version && after.browser === 'firefox',
    `after the grant the link connected, with the helper's hello (${after.state}, host ${after.host}, ${after.error || 'no error'})`);
  ok(!R.grant.states.includes('restart'), `never restart, as Chrome's running worker would be (${R.grant.states.join(' → ')})`);
  ok(page0.child !== null && page1.child === page0.child && R.grant.page.restarts.length === 0,
    `in the same event page, with no reload: context ${page0.child} → ${page1.child}, ${R.grant.page.restarts.length} starts or stops between`);
  if (bg0.page) {
    const fns = (n) => n.map(([k, t]) => `${k} ${t}`).join(', ');
    ok(bg1.same === true && bg1.native.length === 2 && bg1.native.every(([, t]) => t === 'function'),
      `that page's runtime, the same window before and after: ${fns(bg1.native)} (before the grant: ${fns(bg0.native) || 'none'})`);
  } else say(`note the background window isn't reachable from Settings (${JSON.stringify(bg0)}); the event page's context id stands for it`);
  ok(started().length === 1, `Firefox started the helper once (${started().map((s) => `${s.pid}: ${s.args}`).join('; ')})`);

  // 2. 60 s with no traffic, then a round trip.
  const a = agent('a');
  const init = await handshake(a);
  ok(init.result?.serverInfo?.name === 'glaze' && init.result.protocolVersion === '2025-11-25', `agent a initialized (${init.ms} ms)`);
  const [host] = runFiles();
  ok(host && isHelper(host.pid) && host.pid === started()[0].pid, `the helper ${host?.pid} keeps its run file under the temp HOME`);
  await b.close(c); // no extension page open while idle: only the native port can keep the event page up
  const mark = (await b.inChrome(PAGE)).log.length, idleFrom = Date.now();
  say(`idle ${IDLE / 1000} s: no messages, no pages, no agent traffic`);
  await pause(IDLE);
  const page2 = await b.inChrome(PAGE), during = page2.log.slice(mark);
  const why = during.filter((e) => e.ev === 'background-script-reset-idle').reduce((o, e) => ({ ...o, [e.reason]: (o[e.reason] || 0) + 1 }), {});
  R.idle = { from: idleFrom, ms: Date.now() - idleFrom, state: page2.state, child: page2.child, nativePorts: page2.nativePorts, timeout: page2.timeout, events: tally(during), restarts: restarts(during),
    resets: during.filter((e) => e.ev === 'background-script-reset-idle').map((e) => [e.reason, e.at - idleFrom]) };
  ok(R.idle.ms >= IDLE && page2.timeout === TIMEOUT && page2.state === 'running' && page2.child === page0.child && restarts(during).length === 0,
    `after ${Math.round(R.idle.ms / 1000)} s at a ${page2.timeout} ms idle timeout the event page still runs, in context ${page2.child}, never stopped`);
  ok((why.nativeapp || 0) >= Math.floor(IDLE / TIMEOUT / 2) && page2.nativePorts, `the open native port held it: ${JSON.stringify(why)}`);
  const list = await a.ask(LIST(2));
  const names = list.result?.tools?.map((t) => t.name) || [];
  ok(names.includes('courses_list') && names.includes('todo_list'), `agent a's idle connection: tools/list answered in ${list.ms} ms (${names.length} tools)`);
  const b2 = agent('b');
  const init2 = await handshake(b2), list2 = await b2.ask(LIST(2));
  ok(init2.result?.serverInfo?.name === 'glaze' && list2.result?.tools?.length === names.length, `a new agent b: initialize ${init2.ms} ms, tools/list ${list2.ms} ms`);
  ok(runFiles()[0]?.pid === host.pid && alive(host.pid) && started().length === 1, `the same helper ${host.pid} served both`);
  R.idle.roundTrips = { a: { list: list.ms }, b: { initialize: init2.ms, list: list2.ms }, tools: names.length, host: host.pid };

  // The helper killed: Firefox's word for it, and the link's retry.
  c = await settings(b);
  if (!isHelper(host.pid)) throw new Error(`${host.pid} is no longer the helper`);
  process.kill(host.pid, 'SIGKILL');
  const exited = await until(async () => (await links(b, c)).find((l) => l?.state === 'exited'), 'the link to show exited', 10000);
  const back = await until(async () => { const l = await link(b, c); return l?.state === 'connected' && l.at > exited.at && l; }, 'the link to reconnect', 15000);
  const gone = await Promise.all([a.exited, b2.exited]);
  R.exited = { error: exited.error ?? null, then: back, launches: started().map((s) => s.pid), agents: gone.map((g, i) => ({ ...g, stderr: [a, b2][i].err() })) };
  ok(exited.state === 'exited' && exited.error == null, `the helper killed reads as exited with no port error (error ${JSON.stringify(exited.error ?? null)})`);
  ok(back.state === 'connected' && started().length === 2 && started()[1].pid !== host.pid, `and the link reconnects to a new helper ${started()[1]?.pid}`);
  ok(gone.every((g) => g.code === 1), `both agents exit 1 as the helper's socket closes (${JSON.stringify(gone)})`);

  // Control: with the port closed, the idle timeout stops the event page.
  const before = (await b.inChrome(PAGE)).log.length;
  const off = await config(b, c, { op: 'set', on: false });
  const second = started()[1].pid;
  await until(async () => !alive(second), 'the helper to leave on bye', 5000);
  ok(off?.link?.state === 'off' && runFiles().length === 0, 'agent access off: the helper leaves on bye and removes its run file');
  await b.close(c);
  const offAt = Date.now();
  const stopped = await until(async () => { const p = await b.inChrome(PAGE); return p.log.slice(before).some((e) => e.ev === 'shutdown-background-script') && p; }, 'the event page to stop with no port open', 30000);
  R.control = { ms: Date.now() - offAt, state: stopped.state, timeout: stopped.timeout, nativePorts: stopped.nativePorts, events: tally(stopped.log.slice(before)) };
  ok(stopped.state === 'stopped' && !stopped.nativePorts && stopped.timeout === TIMEOUT,
    `control: with no port open the event page stopped ${Math.round(R.control.ms / 100) / 10} s after its last page closed (${stopped.state}, timeout ${stopped.timeout} ms)`);

  // 3. What the port says as it closes, from agent access off each time, so each answer is a new state.
  R.errors = {};
  const attempt = async (key, label) => {
    c = await settings(b);
    const n = started().length, console0 = (await said(b)).length;
    await config(b, c, { op: 'set', on: true });
    const l = await settled(b, c, label, ['off']);
    await pause(300);
    R.errors[key] = { state: l.state, error: l.error ?? null, console: (await said(b)).slice(console0), launches: started().length - n };
    await config(b, c, { op: 'set', on: false });
    await b.close(c);
    return R.errors[key];
  };
  removeManifest();
  const none = await attempt('notInstalled', 'the link with no host manifest');
  ok(none.state === 'not-installed' && none.error === `No such native application ${NAME}` && none.launches === 0,
    `no host manifest: ${none.state}, "${none.error}", no helper started`);
  writeManifest(['someone-else@example.invalid']);
  const other = await attempt('forbidden', 'the link with a manifest for another extension');
  ok(other.state === 'not-installed' && other.error === `No such native application ${NAME}` && other.launches === 0,
    `a manifest that doesn't list Glaze: ${other.state}, "${other.error}", no helper started`);
  ok(other.console.some((t) => t === `This extension does not have permission to use native manifest ${MANIFEST}`),
    `Firefox tells the two apart only in its console: ${JSON.stringify(other.console)}`);
  R.console = await said(b);
  const errors = glazeErrors();
  R.glazeErrors = errors;
  ok(errors.length === 0, `no errors from Glaze's own files${errors.length ? ` (${errors.join(' | ')})` : ''}`);
};

// ---- Cleanup: everything the check started or wrote, also on a signal or a crash ------------------------------------
let cleaned = false, cleaning = null;
const owned = new Map();
const processes = () => new Map(execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8' }).split('\n').flatMap((l) => {
  const m = /^\s*(\d+)\s+(\d+)\s+((?:\S+\s+){4}\S+)\s+(.+)$/.exec(l);
  return m ? [[+m[1], { ppid: +m[2], start: m[3].replace(/\s+/g, ' '), command: m[4] }]] : [];
}));
// Capture descendants before their parent leaves; their start time survives reparenting and exec. Never select a
// browser by its name, or a helper by its script alone: other checks and the owner's Firefox may be running.
const remaining = () => {
  const table = processes();
  for (const p of [ff, ...agents]) if (p && p.exitCode === null && p.signalCode === null && table.has(p.pid) && !owned.has(p.pid)) owned.set(p.pid, table.get(p.pid).start);
  for (const { pid } of started()) if (table.has(pid) && isHelper(pid) && !owned.has(pid)) owned.set(pid, table.get(pid).start);
  let added;
  do {
    added = false;
    for (const [pid, p] of table) if (owned.get(pid) !== p.start && owned.has(p.ppid) && owned.get(p.ppid) === table.get(p.ppid)?.start) {
      owned.set(pid, p.start); added = true;
    }
  } while (added);
  return [...owned].filter(([pid, start]) => table.get(pid)?.start === start).map(([pid]) => pid);
};
const signalOwned = (signal) => {
  for (const pid of remaining()) try { process.kill(pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; }
};
const waitOwned = async (ms) => {
  const end = Date.now() + ms;
  while (remaining().length && Date.now() < end) await pause(100);
  return remaining();
};
const cleanupFiles = () => {
  // Attempt every removal even if one fails; rmdir preserves any unrelated contents added to a shared folder.
  const errors = [];
  try { removeManifest(); } catch (e) { errors.push(e.message); }
  for (const d of [...made].reverse()) try { fs.rmdirSync(d); } catch (e) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) errors.push(e.message); }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { errors.push(e.message); }
  if (errors.length) throw new Error(errors.join('; '));
};
const cleanup = () => cleaning ||= (async () => {
  stopping = true;
  try {
    remaining();
    try { ws?.close(); } catch { /* gone */ }
    for (const p of agents) p.stdin.end();
    if (ff && ff.exitCode === null && ff.signalCode === null) ff.kill('SIGTERM');
    if ((await waitOwned(5000)).length) {
      signalOwned('SIGTERM');
      if ((await waitOwned(3000)).length) signalOwned('SIGKILL');
    }
    const pids = await waitOwned(3000);
    if (sink?.listening) await new Promise((resolve, reject) => sink.close((e) => e ? reject(e) : resolve()));
    R.leftover = { pids, helpers: started().filter(({ pid }) => alive(pid) && isHelper(pid)).map(({ pid }) => pid) };
    if (pids.length) throw new Error(`check processes still alive: ${pids.join(', ')}`);
  } finally {
    cleanupFiles();
    cleaned = true;
    R.leftover ||= {};
    R.leftover.manifestRemoved = !fs.existsSync(MANIFEST);
    R.leftover.foldersPreserved = made.filter((d) => fs.existsSync(d));
  }
})();
const save = () => {
  R.ok = checks; R.failed = failed;
  fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(R, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'check.log'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(OUT, 'firefox.log'), log);
};
// Only a last resort for an explicit process.exit; signals, exceptions and the watchdog await normal cleanup.
process.on('exit', () => {
  if (cleaned) return;
  try { signalOwned('SIGKILL'); } catch (e) { console.error(e.message); }
  try { cleanupFiles(); } catch (e) { console.error(e.message); }
});
let ending = false;
const interrupt = async (code, why) => {
  if (ending) return;
  ending = true;
  clearTimeout(watchdog);
  failed.push(why);
  try { await cleanup(); } catch (e) { failed.push(`cleanup: ${e.message}`); }
  try { save(); } catch (e) { console.error(e.message); }
  process.exit(code);
};
process.on('SIGINT', () => { void interrupt(130, 'SIGINT'); });
process.on('SIGTERM', () => { void interrupt(143, 'SIGTERM'); });
process.on('uncaughtException', (e) => { void interrupt(1, e.stack || String(e)); });
process.on('unhandledRejection', (e) => { void interrupt(1, e?.stack || String(e)); });
const watchdog = setTimeout(() => { void interrupt(124, 'watchdog: the check ran over 8 minutes'); }, 8 * 60e3);
try {
  await checkRun();
} catch (e) {
  console.error(e.stack || String(e));
  failed.push(String(e.message || e));
} finally {
  clearTimeout(watchdog);
  try { await cleanup(); } catch (e) { failed.push(`cleanup: ${e.message}`); }
  ok(R.leftover?.manifestRemoved && made.every((d) => !fs.existsSync(d) || fs.readdirSync(d).length), `${path.basename(MANIFEST)} removed; ${R.leftover?.pids?.length ?? 'unknown'} processes left, ${R.leftover?.foldersPreserved?.length ?? 'unknown'} nonempty shared folders preserved`);
  say(`${checks} ok, ${failed.length} failed, ${R.firefox || 'Firefox'} headless over WebDriver BiDi; evidence in ${OUT}`);
  save();
}
if (failed.length) process.exitCode = 1;
