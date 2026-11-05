// run_js in Glaze's Firefox package (ai/agent/js.js on vendored QuickJS), headless Firefox over WebDriver BiDi: the package
// built from this checkout and installed, then run_js run in its event page as Ask Rime runs it: the engine's script loaded
// by the manifest, its WebAssembly fetched and compiled under the extension pages' CSP. A value, console lines and an error;
// the 2-second stop and the heap cap; nothing outside ECMAScript in reach; the tool's own answer. Firefox makes no request
// of its own here (no proxy: every network request would fail, and the check counts none from the run).
//   FIREFOX=<Firefox.app> nice -n 10 lockf -k <heavy lock> node checks/firefox/rime-js-firefox-check.mjs [<evidence folder>]
// The evidence folder gets results.json and firefox.log.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const app = process.env.FIREFOX || '/Applications/Firefox.app';
const bin = app.endsWith('.app') ? path.join(app, 'Contents/MacOS/firefox') : app;
const ID = 'glaze@frostdev.io', UUID = '7a2c3b4d-5e6f-4a70-8b9c-0d1e2f3a4b5c', EXT = `moz-extension://${UUID}/`;
const out = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'gz-rime-js-ff-')));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-rime-js-ff-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0, ff = null, log = '';
const check = async (name, fn) => {
  try { const evidence = await fn(); results.push({ name, ok: true, evidence }); console.log(`ok   ${name}`); }
  catch (e) { failed++; results.push({ name, ok: false, error: String(e.stack || e) }); console.log(`FAIL ${name}: ${e.message}`); }
};
const assert = (v, msg) => { if (!v) throw new Error(msg); };

try {
  // The Firefox package, as release builds it.
  const dist = path.join(tmp, 'dist'), pkg = path.join(tmp, 'glaze');
  fs.mkdirSync(dist); fs.mkdirSync(pkg);
  const { ZIP, ZIPOPT, ...env } = process.env;
  execFileSync('sh', ['../tools/build/package-firefox.sh', '--development'], { cwd: root, env: { ...env, DIST: dist }, stdio: 'pipe' });
  execFileSync('unzip', ['-q', path.join(dist, fs.readdirSync(dist).find((f) => f.endsWith('-firefox.zip'))), '-d', pkg]);
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'manifest.json'), 'utf8'));

  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(profile);
  const prefs = { 'extensions.webextensions.uuids': JSON.stringify({ [ID]: UUID }), 'browser.shell.checkDefaultBrowser': false, 'app.update.disabledForTesting': true,
    'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.reportingpolicy.firstRun': false, 'browser.startup.homepage_override.mstone': 'ignore',
    'app.normandy.enabled': false, 'extensions.update.enabled': false, 'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9 };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const port = 9400 + Math.floor(Math.random() * 400);
  ff = spawn(bin, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '-remote-allow-system-access', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  ff.stdout.on('data', (d) => { log += d; }); ff.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 300 && !/WebDriver BiDi listening/.test(log); i++) await pause(100);
  assert(/WebDriver BiDi listening/.test(log), 'Firefox did not start its BiDi server');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let n = 0;
  const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++n, timer = setTimeout(() => { wait.delete(id); rej(new Error(`timed out: ${method}`)); }, 60000);
    wait.set(id, (d) => { clearTimeout(timer); d.type === 'error' ? rej(new Error(`${method}: ${d.error} ${d.message}`)) : res(d.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('session.new', { capabilities: {} });
  await send('webExtension.install', { extensionData: { type: 'path', path: pkg } });
  const evaluate = async (expression, ctx) => {
    const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    if (r.type === 'exception') throw new Error(`${r.exceptionDetails.text} in ${expression.slice(0, 100)}`);
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  // BiDi may not navigate to moz-extension: addresses; the browser's own window opens the tab, as firefox-check.mjs does.
  const tree = async (scope) => (await send('browsingContext.getTree', scope ? { 'moz:scope': scope } : {})).contexts;
  const win = (await tree('chrome')).find((c) => c.url === 'chrome://browser/content/browser.xhtml').context;
  const before = new Set((await tree()).map((c) => c.context));
  await evaluate(`(gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(`${EXT}options.html`)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }), 1)`, win);
  let context;
  for (let i = 0; i < 150 && !context; i++) { context = (await tree()).find((c) => !before.has(c.context) && c.url.startsWith(EXT))?.context; if (!context) await pause(100); }
  assert(context, 'the extension tab');
  for (let i = 0; i < 150 && !(await evaluate('document.readyState === "complete"', context).catch(() => false)); i++) await pause(100);
  const value = (expression) => evaluate(expression, context);
  // run_js in the event page, as Ask Rime's worker calls it.
  const run = (codes) => value(`(async () => { const bg = await browser.runtime.getBackgroundPage(); const out = []; for (const c of ${JSON.stringify(codes)}) { const t = Date.now(); out.push({ ...(await bg.GZ_AI_RIME_JS.run(c)), took: Date.now() - t }); } return out; })()`);

  await check('the package: QuickJS by name in the event page, its WebAssembly packaged, no sandbox page, wasm-unsafe-eval in the CSP', async () => {
    assert(manifest.background.scripts.includes('background/../vendor/quickjs/quickjs.js') || manifest.background.scripts.includes('vendor/quickjs/quickjs.js'), JSON.stringify(manifest.background.scripts.filter((s) => /quickjs|agent/.test(s))));
    assert(fs.existsSync(path.join(pkg, 'vendor/quickjs/quickjs.wasm')), 'quickjs.wasm packaged');
    assert(!manifest.sandbox, 'no manifest sandbox in Firefox');
    assert(/'wasm-unsafe-eval'/.test(manifest.content_security_policy?.extension_pages || ''), manifest.content_security_policy?.extension_pages);
    return { scripts: manifest.background.scripts.filter((s) => /quickjs|agent\//.test(s)), csp: manifest.content_security_policy.extension_pages };
  });

  await check('run_js in Firefox\'s event page: a value, console lines and an error', async () => {
    const [a, b, c] = await run(['const g = [81, 92, 77]; console.log("n", g.length); (g.reduce((x, y) => x + y) / g.length).toFixed(2)', '[1, 2, 3].map((x) => x * x)', 'nope + 1']);
    assert(a.ok === true && a.value === '83.33' && JSON.stringify(a.logs) === '["n 3"]', JSON.stringify(a));
    assert(JSON.stringify(b.value) === '[1,4,9]', JSON.stringify(b));
    assert(c.ok === false && /^ReferenceError: .*nope.* is not defined$/.test(c.error), JSON.stringify(c));
    return { a, b, c, firstRunMs: a.took };
  });

  await check('run_js in Firefox\'s event page: stopped at 2 seconds, its heap capped, its output held, nothing outside ECMAScript', async () => {
    const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'setTimeout', 'indexedDB', 'navigator', 'postMessage', 'chrome', 'browser', 'window', 'document'];
    const [loop, greedy, loud, scope, after] = await run(['while (true) {}', 'const a = []; while (true) a.push("x".repeat(1e6));', 'for (let i = 0; i < 1e5; i++) console.log("x".repeat(400)); 1',
      `${JSON.stringify(names)}.map((k) => k + ':' + typeof globalThis[k]).join(' ')`, '6 * 7']);
    assert(loop.error === 'Stopped after 2 seconds.' && loop.took >= 1900 && loop.took < 3000, JSON.stringify(loop));
    assert(greedy.error === 'The code ran out of memory.' && greedy.took < 2000, JSON.stringify(greedy));
    assert(loud.logs.length <= 40 && loud.logs.join('').length <= 4000 && loud.cut === true, 'output held');
    assert(scope.value === names.map((k) => `${k}:undefined`).join(' '), scope.value);
    assert(after.value === 42, 'the engine works after');
    return { loop: loop.took, greedy: greedy.took };
  });

  await check('the tool answers as in Chrome and Safari', async () => {
    const r = await value(`(async () => (await browser.runtime.getBackgroundPage()).GZ_AI_RIME_JS.tools()[0].run({ code: '(72.5 * 0.4 + 88 * 0.6).toFixed(1)' }, {}))()`);
    assert(JSON.stringify(r) === '{"ok":true,"value":"81.8","logs":[]}', JSON.stringify(r));
    return r;
  });
  ws.close();
} catch (e) {
  failed++; results.push({ name: 'setup', ok: false, error: String(e.stack || e) }); console.log(`FAIL setup: ${e.message}`);
} finally {
  if (ff) {
    ff.kill('SIGTERM');
    await new Promise((r) => { if (ff.exitCode !== null) r(); else { ff.once('exit', r); setTimeout(r, 8000); } });
    if (ff.exitCode === null && ff.signalCode === null) ff.kill('SIGKILL');
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ total: results.length, failed, firefox: (log.match(/Mozilla Firefox [\d.]+/) || [''])[0], results }, null, 2));
  fs.writeFileSync(path.join(out, 'firefox.log'), log);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${results.length - failed}/${results.length} passed; evidence in ${out}`);
  process.exitCode = failed ? 1 : 0;
}
