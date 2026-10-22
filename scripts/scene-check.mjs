// Headless checks for lib/scene.js and lib/glsl.js in a real browser: built-in scenes unchanged, the three example shaders,
// a heavy shader stepping down, a refused shader never reaching GL, motion off, context loss, layers.
//   nice -n 10 node scripts/scene-check.mjs [--out=dir] [--angle=metal|swiftshader|default] [--base=<git ref>] [--run=a,b,c] [--vp=WxH]
// --base is the revision whose lib/scene.js and lib/three.min.js the built-in scenes are compared with (default: the
// revision this branch was cut from, read as merge-base with `mods`). One headless browser at a time across agents: it waits
// while another is running, and kills its own and deletes its profile whatever happens. Exit code 1 if any check fails.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync, execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const vp = String(opt.vp || '1440x900');
const out = opt.out ? path.resolve(opt.out) : null;
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

// A headless Chrome: CHROME, else puppeteer's headless shell, else Playwright's (the repo's other checks use that one).
const find = () => {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = [path.join(os.homedir(), '.cache/puppeteer/chrome-headless-shell'), path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const hit = execSync(`find "${r}" -type f -name 'chrome-headless-shell' -o -type f -name 'headless_shell' | sort -r | head -1`, { encoding: 'utf8' }).trim();
    if (hit) return hit;
  }
  throw new Error('No headless Chrome found: set CHROME.');
};
const BIN = find();

// The version to compare the built-in scenes with, served at /base/lib/.
const ref = opt.base || git('merge-base', 'HEAD', 'mods').trim();
const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-scene-base-'));
fs.mkdirSync(path.join(baseDir, 'lib'));
for (const f of ['scene.js', 'three.min.js']) fs.writeFileSync(path.join(baseDir, 'lib', f), git('show', `${ref}:lib/${f}`));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.glsl': 'text/plain' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const root = url.startsWith('/base/') ? baseDir : ROOT;
  const p = path.join(root, url.startsWith('/base/') ? url.slice(5) : url);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// One headless browser at a time across agents: wait (up to 25 minutes) while anyone else's is running.
const othersRunning = () => execSync('ps -axo pid=,command=', { encoding: 'utf8' }).split('\n')
  .filter((l) => /chrome-headless-shell|--headless|Chromium|Google Chrome for Testing/.test(l) && !/scene-check|pgrep|ps -ax|^\s*\d+\s+(\/bin\/)?(zsh|bash|sh)\s/.test(l)).length;
for (let i = 0; i < 300 && othersRunning(); i++) {
  if (i % 6 === 0) console.error(`[scene-check] another headless browser is running; waiting (${i * 5}s)`);
  await new Promise((r) => setTimeout(r, 5000));
}
if (othersRunning()) { console.error('[scene-check] gave up waiting'); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-scene-check-'));
const flags = ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', `--window-size=${vp.replace('x', ',')}`, '--hide-scrollbars', '--disable-extensions', '--disable-background-networking'];
if (opt.angle === 'swiftshader') flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
else if (opt.angle === 'metal') flags.push('--use-angle=metal', '--enable-gpu');
flags.push('about:blank');
const child = spawn('nice', ['-n', '10', BIN, ...flags], { stdio: ['ignore', 'ignore', 'pipe'] });
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  try { child.kill('SIGKILL'); } catch {}
  try { execFileSync('pkill', ['-9', '-f', profile], { stdio: 'ignore' }); } catch {}
  try { server.close(); } catch {}
  for (const d of [profile, baseDir]) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
};
for (const s of ['SIGINT', 'SIGTERM', 'exit']) process.on(s, () => { cleanup(); if (s !== 'exit') process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let result = null, logs = [], version = '', failed = 0;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  let target;
  for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} await sleep(100); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    else if (d.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    else if (d.method === 'Log.entryAdded') logs.push(`[log:${d.params.entry.level}] ${d.params.entry.text}`);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser;
  const [vw, vh] = vp.split('x').map(Number);
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
  const q = new URLSearchParams({ base: '1', ...Object.fromEntries(['run', 'only', 'wait'].filter((k) => opt[k]).map((k) => [k, opt[k]])) });
  await send('Page.navigate', { url: `${origin}/scripts/scene-check.html?${q}` });
  const t0 = Date.now();
  for (let stuck = 0; Date.now() - t0 < 300000;) {
    await sleep(500);
    // A page blocked on the GPU never answers: give up after three 10 s silences.
    const r = await Promise.race([send('Runtime.evaluate', { expression: 'window.__done ? JSON.stringify(window.__result) : null', returnByValue: true }), sleep(10000).then(() => null)]);
    if (!r) { if (++stuck >= 3) { logs.push('[driver] page unresponsive for 30 s, giving up'); break; } continue; }
    stuck = 0;
    if (r.result?.result?.value) { result = JSON.parse(r.result.result.value); break; }
  }
  if (!result) {
    const r = await Promise.race([send('Runtime.evaluate', { expression: 'JSON.stringify(window.__result || null)', returnByValue: true }), sleep(10000).then(() => null)]);
    const partial = r?.result?.result?.value ? JSON.parse(r.result.result.value) : null;
    result = { ...(partial || { checks: [], data: {}, shots: {} }), timeout: true };
  }
} catch (e) {
  logs.push(`[driver] ${e.stack || e}`);
} finally {
  cleanup();
  await sleep(300);
}

if (out) fs.mkdirSync(out, { recursive: true });
const shots = result?.shots || {};
if (out) for (const [n, url] of Object.entries(shots)) fs.writeFileSync(path.join(out, `${n}.png`), Buffer.from(url.split(',')[1], 'base64'));
const checks = result?.checks || [];
failed = checks.filter((c) => !c.ok).length;
// A context lost on purpose logs a warning; anything else at error level is a finding.
const errors = logs.filter((l) => /^\[(exception|driver)\]|^\[(error|log:error)\]/.test(l) && !/CONTEXT_LOST|Context Lost|context lost/i.test(l));
const summary = { chrome: version, renderer: result?.data?.renderer, base: ref, vp, passed: checks.length - failed, failed, timeout: !!result?.timeout, consoleErrors: errors, failures: checks.filter((c) => !c.ok) };
if (out) fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ...summary, checks, data: result?.data, console: logs.slice(0, 200), shots: Object.keys(shots) }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
process.exitCode = failed || errors.length || result?.timeout || !checks.length ? 1 : 0;
