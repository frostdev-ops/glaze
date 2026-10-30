// The real native host in Chromium (T9): Glaze's worker and the glaze-mcp helper as shipped, end to end, on Linux. Glaze is
// staged with nativeMessaging required (headless can't answer its prompt) and a probe imported at the end of its worker: a
// nonce per worker start, kept in storage.local t9Starts and given to a { t9: 'who' } message, and, once armed, a page that
// asks for it twice, IDLE apart, and reports through a one-shot native host. glaze-mcp setup installs the helper for real
// under a scratch HOME whose Chromium folder is the profile, so Chromium reads the manifest setup wrote (it reads
// <user-data-dir>/NativeMessagingHosts); the browser, the host's run folder and every agent follow that HOME.
//   2 Agent access on through glaze:mcp-config from the options page.
//   3 Two glaze-mcp agents: server/discover and tools/list in both eras, courses_list paired with Allow in the approval
//     window, todo_list, both against caches the production writers made (test/helpers/mcp-caches.cjs).
//   4 IDLE (70 s; SLOW=1: 6 min) in a browser started without a DevTools client (Playwright's keeps any worker alive), an
//     agent connected: the same worker and host before and after. A control profile without agent access loses its worker.
//   5 The host killed: the link shows exited, then connects to a new host.
//   6 Agent access off: the host goes and the run folder is emptied.
//   7 The shipped manifest (nativeMessaging optional), headed under Xvfb, the prompt answered with XTEST keys, the manifest
//     and launcher written by hand: the link waits in restart with no host, and connects once the worker restarts.
// Evidence in the folder given: results.json, log.txt, each agent's lines, the bare browsers' logs, the probe's reports,
// the approval window and the prompt.
//   glaze-remote -o <evidence dir> -- node scripts/agent-link-check.js /out
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net'), zlib = require('node:zlib');
const { isDeepStrictEqual: same } = require('node:util');
const { spawn, execFileSync } = require('node:child_process');
const C = require('../test/helpers/mcp-caches.cjs');
const ST = require('../lib/mcp/tools-study.js');
const IDS = require('../mcp/lib/ids.js'), BR = require('../mcp/lib/browsers.js'), L = require('../mcp/lib/launcher.js'), RV = require('../mcp/lib/rendezvous.js');

const src = fs.realpathSync(path.join(__dirname, '..'));
const BIN = path.join(src, 'mcp', 'bin', 'glaze-mcp.js');
const VERSION = require('../mcp/package.json').version;
const OUT = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'agent-link-out-')));
const IDLE = process.env.SLOW ? 360e3 : 70e3;
const WAIT = IDLE + 15e3; // the probe page's wait: the idle, plus the agent's first call after the page opens
const PROBE = 'io.frostdev.glaze_t9_probe';
const NODE = fs.realpathSync(process.execPath);
const CLIENT = { name: 'Glaze T9 check', version: '1.0.0' };
const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': CLIENT };
const ACCOUNT = `${C.CANVAS}/5`;
const POLL = { polling: 50 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 100) => { for (const end = Date.now() + ms; ; await sleep(step)) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; } };
const R = { idleMs: IDLE, node: process.version, helper: VERSION, checks: [], phases: {} };
const lines = [];
const say = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(`${new Date().toISOString()} ${s}`); console.log(s.length > 600 ? `${s.slice(0, 600)}…` : s); };
const save = () => { fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(R, null, 2)}\n`); fs.writeFileSync(path.join(OUT, 'log.txt'), `${lines.join('\n')}\n`); };
const ok = (step, what, pass, evidence) => { R.checks.push({ step, what, pass: !!pass, ...(evidence !== undefined && { evidence }) }); say(pass ? 'ok' : 'FAIL', `[${step}]`, what, ...(pass || evidence === undefined ? [] : [evidence])); };
const owned = { contexts: new Set(), procs: new Set() };
let scratch;

// A scratch HOME: setup, the browser (and so the host it starts) and the agents all get it.
const envFor = (home) => {
  const e = { ...process.env, HOME: home };
  for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'CHROME_CONFIG_HOME', 'GLAZE_MCP_BROWSER']) delete e[k];
  return e;
};
const runDir = (home) => RV.dir({ env: { HOME: home } });
const runFolder = (home) => (fs.existsSync(runDir(home)) ? fs.readdirSync(runDir(home)).sort() : null);
const hosts = (home) => RV.list(runDir(home)).filter((e) => e.alive);
const alive = (pid) => RV.alive(pid);
const cmdline = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { return null; } };

// ---- the probe ------------------------------------------------------------------------------------------------------
// Imported at the end of the staged worker.
function t9Worker() {
  const me = globalThis.T9 = { nonce: crypto.randomUUID(), born: Date.now() };
  const kept = chrome.storage.local.get('t9Starts').then(({ t9Starts = [] }) => chrome.storage.local.set({ t9Starts: [...t9Starts, me] }));
  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (m?.t9 !== 'who') return false;
    kept.then(() => reply(me), () => reply(me));
    return true;
  });
  chrome.storage.local.get('t9Arm').then(({ t9Arm }) => {
    if (!t9Arm) return;
    chrome.storage.local.remove('t9Arm');
    chrome.tabs.create({ url: chrome.runtime.getURL(`t9/page.html?ms=${t9Arm.ms}`) });
  });
}
// The armed page: holds no port, and its one-shot reports don't keep the worker up.
function t9Page() {
  const ms = Number(new URLSearchParams(location.search).get('ms'));
  const report = (m) => chrome.runtime.sendNativeMessage('io.frostdev.glaze_t9_probe', m).catch(() => {});
  const who = async () => { const asked = Date.now(); return { asked, ...await chrome.runtime.sendMessage({ t9: 'who' }) }; };
  (async () => {
    const first = await who();
    await report({ t: 'first', first });
    await new Promise((r) => setTimeout(r, ms));
    const last = await who();
    const { t9Starts } = await chrome.storage.local.get('t9Starts');
    await report({ t: 'report', first, last, starts: t9Starts });
  })().catch((e) => report({ t: 'report', error: String(e?.stack || e) }));
}
// The probe's native host: logs each message to argv[2] and answers it.
function probeHost() {
  const fs = require('node:fs');
  const note = (ev, more) => fs.appendFileSync(process.argv[2], `${JSON.stringify({ at: Date.now(), pid: process.pid, ev, ...more })}\n`);
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (d) => {
    for (buf = Buffer.concat([buf, d]); buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0);) {
      const n = buf.readUInt32LE(0), m = JSON.parse(buf.subarray(4, 4 + n).toString('utf8'));
      buf = buf.subarray(4 + n);
      note('in', { m });
      const b = Buffer.from('{"ok":true}'), h = Buffer.alloc(4);
      h.writeUInt32LE(b.length);
      process.stdout.write(Buffer.concat([h, b]));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
const probeLog = (label) => { const f = path.join(scratch, `probe-${label}.jsonl`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };

// ---- staging ----------------------------------------------------------------------------------------------------------
// Every file a hard link to the checkout's (a copy across devices); the changed files are unlinked first, so nothing is
// ever written through a link into the checkout.
const SKIP = new Set(['node_modules', 'safari', 'test', 'release', 'dist', 'mcp']);
const link = (a, b) => {
  for (const e of fs.readdirSync(a, { withFileTypes: true })) {
    if (e.name.startsWith('.') || (a === src && SKIP.has(e.name))) continue;
    const x = path.join(a, e.name), y = path.join(b, e.name);
    if (e.isDirectory()) { fs.mkdirSync(y); link(x, y); } else if (e.isFile()) { try { fs.linkSync(x, y); } catch { fs.copyFileSync(x, y); } }
  }
};
const put = (file, text, mode) => { fs.rmSync(file, { force: true }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, mode ? { mode } : undefined); };
// required: nativeMessaging moved from optional_permissions to permissions; else the shipped manifest.
const STAGED = [];
function stage(label, required) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(scratch, `ext-${label}-`)));
  STAGED.push(IDS.origin(IDS.devId(dir)));
  link(src, dir);
  const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  if (required) {
    m.permissions = [...m.permissions, 'nativeMessaging'];
    m.optional_permissions = m.optional_permissions.filter((p) => p !== 'nativeMessaging');
    put(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  }
  put(path.join(dir, 'lib/background.js'), `${fs.readFileSync(path.join(src, 'lib/background.js'), 'utf8')}\nimportScripts('../t9/worker.js');\n`);
  put(path.join(dir, 't9/worker.js'), `(${t9Worker})();\n`);
  put(path.join(dir, 't9/page.html'), '<!doctype html><meta charset="utf-8"><title>T9 probe</title><script src="page.js"></script>\n');
  put(path.join(dir, 't9/page.js'), `(${t9Page})();\n`);
  return { dir, id: IDS.devId(dir), permissions: m.permissions, optional: m.optional_permissions };
}
const nmh = (prof, manifest) => put(path.join(prof, 'NativeMessagingHosts', `${manifest.name}.json`), JSON.stringify(manifest, null, 2));
const probeFor = (prof, label, ext) => {
  const sh = path.join(scratch, 'probe', `${label}.sh`);
  put(sh, `#!/bin/sh\nexec '${NODE}' '${path.join(scratch, 'probe', 'host.js')}' '${path.join(scratch, `probe-${label}.jsonl`)}' "$@"\n`, 0o755);
  nmh(prof, { name: PROBE, description: 'T9 probe', path: sh, type: 'stdio', allowed_origins: [IDS.origin(ext.id)] });
};

// ---- browsers ---------------------------------------------------------------------------------------------------------
const extArgs = (ext) => [`--disable-extensions-except=${ext.dir}`, `--load-extension=${ext.dir}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'];
async function open(prof, ext, home, display) {
  const env = { ...envFor(home), ...(display && { DISPLAY: `:${display}` }) };
  await require('./wait-for-browser.js')();
  const context = await chromium.launchPersistentContext(prof, { ...require('./check-env.js').chromeLaunch(), headless: !display, viewport: { width: 1000, height: 700 }, env, args: extArgs(ext) });
  owned.contexts.add(context);
  context.setDefaultTimeout(15000);
  require('./check-env.js').noFirstRun(context);
  await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
  // Everything goes through the options page, whose messages start the worker: Playwright's serviceworker event was
  // once missed in a headed launch.
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${ext.id}/options.html`);
  return { context, opt };
}
const store = (opt, patch) => opt.evaluate((p) => chrome.storage.local.set(p), patch);
const who = (opt) => opt.evaluate(() => chrome.runtime.sendMessage({ t9: 'who' }));
const close = async (context) => { await context.close().catch(() => {}); owned.contexts.delete(context); };
const config = (opt, m) => opt.evaluate((m) => chrome.runtime.sendMessage({ type: 'glaze:mcp-config', ...m }), m);
const linkOf = (opt) => opt.evaluate(() => chrome.storage.session.get('mcpLink').then((r) => r.mcpLink || null));
const connected = (opt) => until(async () => { const l = await linkOf(opt); return l?.state === 'connected' && l; }, 20000);
// Every mcpLink the options page hears, as Settings will read it.
const watch = (opt) => opt.evaluate(() => { window.t9Link = []; chrome.storage.onChanged.addListener((c, area) => { if (area === 'session' && c.mcpLink) window.t9Link.push({ ...c.mcpLink.newValue, heard: Date.now() }); }); });
// Started with no remote debugging: nothing but the page and the agents reaches its worker.
const bareArgs = (prof, ext) => ['--headless', '--no-sandbox', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-component-update', '--password-store=basic', '--use-mock-keychain', ...extArgs(ext), 'about:blank'];
function bare(label, prof, ext, home) {
  const log = path.join(OUT, `chrome-bare-${label}.log`), out = fs.openSync(log, 'w');
  const proc = spawn(require('./check-env.js').chromePath() || chromium.executablePath(), bareArgs(prof, ext), { stdio: ['ignore', out, out], env: envFor(home) });
  owned.procs.add(proc);
  return { proc, log, at: Date.now() };
}
async function stop(proc) {
  if (proc.exitCode === null && !proc.signalCode) {
    proc.kill('SIGTERM');
    for (let i = 0; i < 50 && proc.exitCode === null && !proc.signalCode; i++) await sleep(100);
    if (proc.exitCode === null && !proc.signalCode) proc.kill('SIGKILL');
  }
  owned.procs.delete(proc);
}

// ---- agents -----------------------------------------------------------------------------------------------------------
// A glaze-mcp agent as an app runs it, speaking MCP lines; every line both ways and its stderr in agent-<label>.jsonl.
function agent(label, home) {
  const p = spawn(process.execPath, [BIN, 'agent'], { env: envFor(home), stdio: ['pipe', 'pipe', 'pipe'] });
  owned.procs.add(p);
  const a = { label, err: '', exit: null, got: [] }, waits = new Map(), file = path.join(OUT, `agent-${label}.jsonl`);
  const note = (dir, m) => fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), dir, m })}\n`);
  let next = 1, buf = '';
  p.stdin.on('error', () => {});
  p.stderr.on('data', (d) => { a.err += d; note('stderr', String(d)); });
  p.stdout.on('data', (d) => {
    for (buf += d; buf.includes('\n');) {
      const text = buf.slice(0, buf.indexOf('\n'));
      buf = buf.slice(text.length + 1);
      let m;
      try { m = JSON.parse(text); } catch { m = { unparsed: text }; }
      note('in', m);
      a.got.push(m);
      a.heard = Date.now();
      const w = waits.get(m.id);
      if (w) { waits.delete(m.id); w(m); }
    }
  });
  a.exited = new Promise((r) => p.on('exit', (code, signal) => {
    a.exit = { code, signal, at: Date.now() };
    owned.procs.delete(p);
    for (const w of waits.values()) w({ exited: a.exit });
    waits.clear();
    r(a.exit);
  }));
  const write = (m) => { note('out', m); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`); };
  a.ask = (method, params = {}, ms = 15000) => new Promise((r) => {
    if (a.exit) return r({ exited: a.exit });
    const id = next++, t = setTimeout(() => { waits.delete(id); r({ timeout: ms }); }, ms);
    waits.set(id, (m) => { clearTimeout(t); r(m); });
    write({ id, method, params });
  });
  a.modern = (method, params = {}, ms) => a.ask(method, { ...params, _meta: META }, ms);
  a.tell = (method, params = {}) => write({ method, params });
  a.end = () => { p.stdin.end(); return Promise.race([a.exited, sleep(3000).then(() => null)]); };
  a.gone = (ms = 5000) => Promise.race([a.exited, sleep(ms).then(() => null)]);
  return a;
}
const names = (r) => (Array.isArray(r?.result?.tools) ? r.result.tools.map((t) => t.name) : null);
const sc = (r) => r?.result?.structuredContent;
const call = (a, name, era = 'modern', ms) => (era === 'modern' ? a.modern('tools/call', { name, arguments: { account: ACCOUNT } }, ms) : a.ask('tools/call', { name, arguments: { account: ACCOUNT } }, ms));

// ---- the caches -------------------------------------------------------------------------------------------------------
// One Canvas account's planner and the school's courses, through features/todo.js and content-canvas.js's own writers.
const PLAN = [
  C.planner({ id: 1, course: 25, name: 'BIO 1100', title: 'Lab 4: Enzymes', at: '2026-10-16T03:59:00Z' }),
  C.planner({ type: 'quiz', id: 2, course: 26, name: 'ENG 1100', title: 'Reading quiz', at: '2026-10-20T03:59:00Z', sub: { submitted: true } }),
  C.planner({ type: 'planner_note', id: 3, course: null, name: null, title: 'Bring goggles', details: 'Lab coat too', at: '2026-10-15T16:00:00Z' }),
];
const SEEN = [{ id: 25, name: 'BIO 1100', course_code: 'BIO1100-01', color: '#aabbcc' }, { id: 26, name: 'ENG 1100', course_code: 'ENG1100-02' }, { id: 27, name: 'MATH 1350', course_code: 'MATH1350' }];
let STORE;
// What the tool answers in node over the same caches: the worker's answer must hold the same.
const want = (name) => ST.tools().find((t) => t.name === name).run({}, C.ctx(STORE, ACCOUNT, { now: Date.now }));
const answers = async (r, name) => {
  const got = sc(r), w = await want(name);
  return !!got && got.account === ACCOUNT && got.source === 'cache' && got.at === w.at && same(got.items, w.items) && (w.covers === undefined || same(got.covers, w.covers))
    && r.result.isError !== true && JSON.parse(r.result.content[0].text).items.length === w.items.length;
};

// ---- X11, for the prompt: XTEST keys and a screenshot of the root window ----------------------------------------------
async function xclient(display) {
  const sock = net.connect(`/tmp/.X11-unix/X${display}`);
  await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
  let buf = Buffer.alloc(0), seq = 0;
  const reads = [];
  const drain = () => { while (reads.length && buf.length >= reads[0].n) { const w = reads.shift(); w.res(buf.subarray(0, w.n)); buf = buf.subarray(w.n); } };
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); drain(); });
  const read = (n) => new Promise((res) => { reads.push({ n, res }); drain(); });
  const hello = Buffer.alloc(12);
  hello.write('l', 0, 'latin1');
  hello.writeUInt16LE(11, 2);
  sock.write(hello);
  const head = await read(8), body = await read(head.readUInt16LE(6) * 4);
  if (head[0] !== 1) throw Error(`X refused: ${body.toString('latin1')}`);
  const vlen = body.readUInt16LE(16), scr = 32 + vlen + ((4 - (vlen % 4)) % 4) + 8 * body[21], minKey = body[26], maxKey = body[27];
  const root = body.readUInt32LE(scr), width = body.readUInt16LE(scr + 20), height = body.readUInt16LE(scr + 22);
  const msg = (op, data, words) => { const b = Buffer.alloc(words * 4); b[0] = op; b[1] = data; b.writeUInt16LE(words, 2); return b; };
  const req = async (b, reply) => {
    sock.write(b);
    const mine = ++seq & 0xffff;
    if (!reply) return null;
    for (;;) {
      const r = await read(32);
      if (r[0] === 1) { const extra = r.readUInt32LE(4) * 4; return extra ? Buffer.concat([r, await read(extra)]) : r; }
      if (r[0] === 0 && r.readUInt16LE(2) === mine) throw Error(`X error ${r[1]} on request ${r[10]}`);
    }
  };
  const qe = msg(98, 0, 4);
  qe.writeUInt16LE(5, 4);
  qe.write('XTEST', 8, 'latin1');
  const xr = await req(qe, true);
  if (!xr[8]) throw Error('the X server has no XTEST');
  const km = msg(101, 0, 2);
  km[4] = minKey;
  km[5] = maxKey - minKey + 1;
  const kr = await req(km, true);
  const keycode = (sym) => { for (let i = 0; 32 + i * 4 < kr.length; i++) if (kr.readUInt32LE(32 + i * 4) === sym) return minKey + Math.floor(i / kr[1]); throw Error(`no keycode for ${sym}`); };
  const fake = (type, detail) => { const b = msg(xr[9], 2, 9); b[4] = type; b[5] = detail; return req(b, false); };
  return {
    key: async (sym) => { const k = keycode(sym); await fake(2, k); await fake(3, k); await req(msg(43, 0, 1), true); },
    shot: async (file) => {
      const g = msg(73, 2, 5);
      g.writeUInt32LE(root, 4);
      g.writeUInt16LE(width, 12);
      g.writeUInt16LE(height, 14);
      g.writeUInt32LE(0xffffffff, 16);
      const px = (await req(g, true)).subarray(32), row = width * 3 + 1, raw = Buffer.alloc(row * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const s = (y * width + x) * 4, d = y * row + 1 + x * 3; raw[d] = px[s + 2]; raw[d + 1] = px[s + 1]; raw[d + 2] = px[s]; }
      const chunk = (type, data) => { const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'latin1'), data]); len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(width, 0);
      ihdr.writeUInt32BE(height, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
    },
    close: () => sock.destroy(),
  };
}
async function startX() {
  for (let n = 91; n < 140; n++) {
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)) continue;
    const proc = spawn('Xvfb', [`:${n}`, '-screen', '0', '1280x900x24', '-nolisten', 'tcp', '-ac'], { stdio: 'ignore' });
    owned.procs.add(proc);
    for (let i = 0; i < 50 && !fs.existsSync(`/tmp/.X11-unix/X${n}`) && proc.exitCode === null; i++) await sleep(100);
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) return { n, proc };
    await stop(proc);
  }
  throw Error('no free Xvfb display');
}
const RETURN = 0xff0d, TAB = 0xff09;

// ---- the steps --------------------------------------------------------------------------------------------------------
let E1, P1, P2;

// 1: setup under P1's HOME, into the profile Chromium will use.
function setup() {
  const home = path.join(scratch, 'home1');
  const row = BR.table(process.platform, envFor(home)).find((b) => b.id === 'chromium');
  fs.mkdirSync(row.data, { recursive: true });
  let out, code = 0;
  try { out = execFileSync(process.execPath, [BIN, 'setup', '--browser', 'chromium', '--dev', E1.dir], { env: envFor(home), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = `${e.stdout}${e.stderr}`; code = e.status; }
  fs.writeFileSync(path.join(OUT, 'setup.txt'), out);
  const mf = path.join(row.dir, `${BR.HOST}.json`), manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  const launcher = manifest && fs.existsSync(manifest.path) ? fs.readFileSync(manifest.path, 'utf8') : null;
  R.phases.setup = { out, code, profile: row.data, manifestFile: mf, manifest, launcher };
  ok('1', 'glaze-mcp setup --browser chromium --dev <staged copy> installs into the profile\'s NativeMessagingHosts', code === 0 && manifest?.allowed_origins?.includes(IDS.origin(E1.id))
    && L.parse(launcher)?.browser === 'chromium' && L.parse(launcher)?.script === path.join(BR.folder(process.platform, envFor(home)).root, VERSION, 'bin', 'glaze-mcp.js'), R.phases.setup);
  P1 = { home, prof: row.data };
  probeFor(P1.prof, 'port', E1);
}

// 2 and 3, then the arming for 4.
async function onAndAgents() {
  const ph = R.phases.agents = {};
  const { context, opt } = await open(P1.prof, E1, P1.home);
  const id = await opt.evaluate(() => chrome.runtime.id), first = await who(opt);
  ok('1', 'Chromium gives the staged copy the id setup --dev let in, and its worker runs', id === E1.id && !!first?.nonce, { id, want: E1.id, worker: first });
  await store(opt, STORE);
  const before = ph.before = await config(opt, { op: 'state' });
  ok('2', 'agent access starts off, and no host runs', before?.ok === true && before.on === false && before.link?.state === 'off' && !runFolder(P1.home)?.length, { before, run: runFolder(P1.home) });
  const set = ph.set = await config(opt, { op: 'set', on: true });
  ok('2', 'glaze:mcp-config set on, from the options page, is taken', set?.ok === true && ['connecting', 'connected'].includes(set.link?.state), set);
  const up = ph.link = await connected(opt);
  const host = hosts(P1.home)[0], argv = host && cmdline(host.rec.pid);
  ph.host = { rec: host && { ...host.rec, token: '…' }, argv, run: runFolder(P1.home) };
  ok('2', 'the link is connected to the helper setup installed, which Chromium started', up?.host === VERSION && up.browser === 'chromium' && hosts(P1.home).length === 1
    && !!argv && same(argv.slice(1), [L.parse(R.phases.setup.launcher)?.script, 'host', '--browser=chromium', IDS.origin(E1.id)]), { up, ...ph.host });
  const instance = ph.instance = (await opt.evaluate(() => chrome.storage.local.get('mcpInstance'))).mcpInstance;
  ok('2', 'the run file is named for the worker\'s instance', host?.rec.instance === instance && runFolder(P1.home)?.join() === `chromium.${instance}.json,chromium.${instance}.sock`, { instance, run: runFolder(P1.home) });

  const doctor = (() => { try { return execFileSync(process.execPath, [BIN, 'doctor'], { env: envFor(P1.home), encoding: 'utf8' }); } catch (e) { return `${e.stdout}${e.stderr}`; } })();
  fs.writeFileSync(path.join(OUT, 'doctor.txt'), doctor);
  ok('2', 'glaze-mcp doctor\'s live check reaches the host', host && doctor.includes(`host ${host.rec.pid} answered`), doctor);

  const a = agent('modern', P1.home), b = agent('legacy', P1.home);
  const discover = ph.discover = await a.modern('server/discover');
  ok('3', 'server/discover (2026-07-28) names both eras', discover.result?.resultType === 'complete' && ['2026-07-28', '2025-11-25'].every((v) => discover.result.supportedVersions?.includes(v))
    && discover.result._meta?.['io.modelcontextprotocol/serverInfo']?.name === 'glaze', discover);
  const list1 = await a.modern('tools/list');
  const discover2 = await b.modern('server/discover');
  const init = ph.initialize = await b.ask('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT });
  b.tell('notifications/initialized');
  const list2 = await b.ask('tools/list');
  ph.tools = { modern: names(list1), legacy: names(list2) };
  ok('3', 'a legacy client discovers, then initializes in 2025-11-25', discover2.result?.supportedVersions?.includes('2025-11-25') && init.result?.protocolVersion === '2025-11-25' && init.result.serverInfo?.name === 'glaze', { discover2, init });
  ok('3', 'tools/list gives the same tools in both eras, the courses group among them', !!ph.tools.modern && same(ph.tools.modern, ph.tools.legacy) && list1.result?.cacheScope === 'private'
    && ['accounts_list', 'courses_list', 'schedule_list', 'todo_list'].every((n) => ph.tools.modern.includes(n)), ph.tools);
  ok('3', 'both agents are connected at once to the one host', [a, b].every((x) => x.err.includes(`connected to Glaze in chromium (instance ${instance})`)) && hosts(P1.home).length === 1, { a: a.err, b: b.err });

  // The pairing, in the approval window.
  const APPROVE = `chrome-extension://${E1.id}/lib/mcp/approve.html`;
  const pending = call(a, 'courses_list', 'modern', 60000);
  const win = await until(() => context.pages().find((p) => p.url() === APPROVE));
  let shown = null;
  if (win) {
    await win.waitForFunction(() => document.getElementById('title').textContent.trim() && !document.getElementById('ask').hidden, null, POLL);
    shown = ph.window = await win.evaluate(() => ({ title: document.getElementById('title').textContent, group: document.getElementById('group').textContent, app: document.getElementById('app').textContent, exe: document.getElementById('exe').textContent }));
    await win.bringToFront();
    await win.waitForFunction(() => document.hasFocus() && document.getElementById('yes').getAttribute('aria-disabled') === 'false', null, POLL);
    await win.screenshot({ path: path.join(OUT, 'approve-pair.png') });
    await win.click('#yes');
  }
  ok('3', 'courses_list asks to pair the app in the approval window, as the app reports itself', shown?.title === `${CLIENT.name} wants to use Glaze` && shown.group === 'Courses, to-dos and schedule' && shown.app === CLIENT.name && shown.exe === NODE, shown);
  const courses = ph.courses = await pending;
  ok('3', 'once allowed, courses_list answers from the seeded caches', await answers(courses, 'courses_list'), { got: sc(courses), want: await want('courses_list') });
  const todo = ph.todoModern = await call(a, 'todo_list');
  ok('3', 'todo_list (2026-07-28) answers from the seeded planner, unasked', await answers(todo, 'todo_list'), { got: sc(todo), want: await want('todo_list') });
  const todo2 = ph.todoLegacy = await call(b, 'todo_list', 'legacy');
  ok('3', 'todo_list (2025-11-25) from the other agent, the same app: unasked', await answers(todo2, 'todo_list') && !context.pages().some((p) => p.url() === APPROVE), sc(todo2));
  const apps = ph.apps = await config(opt, { op: 'apps' });
  const rows = ph.activity = await until(async () => { const r = (await config(opt, { op: 'activity' })).rows; return r?.length >= 3 && r; }, 5000);
  ok('3', 'Settings lists the app paired for courses, and three calls in its activity', apps?.apps?.length === 1 && apps.apps[0].name === CLIENT.name && apps.apps[0].exe === NODE && apps.apps[0].grants?.courses === true
    && same(rows?.map((r) => [r.tool, r.outcome]), [['courses_list', 'ok'], ['todo_list', 'ok'], ['todo_list', 'ok']]), { apps, rows });
  const ends = ph.ends = [await a.end(), await b.end()];
  ok('3', 'each agent exits 0 when its app closes stdin', ends.every((e) => e?.code === 0), ends);

  await store(opt, { t9Arm: { ms: WAIT } });
  const pid = host?.rec.pid;
  await close(context);
  const gone = await until(() => pid && !alive(pid) && !runFolder(P1.home)?.length, 5000);
  ok('2', 'closing the browser ends the host, which empties the run folder', !!gone, { pid, run: runFolder(P1.home) });
}

// P2: a control without agent access, armed the same way.
async function control() {
  const home = path.join(scratch, 'home2'), prof = path.join(scratch, 'profile-control');
  fs.mkdirSync(prof, { recursive: true });
  probeFor(prof, 'control', E1);
  const { context, opt } = await open(prof, E1, home);
  await who(opt);
  await store(opt, { t9Arm: { ms: WAIT } });
  await close(context);
  P2 = { home, prof };
}

// 4: the idle, in browsers started without a DevTools client.
async function idle() {
  const ph = R.phases.idle = {};
  const port = bare('port', P1.prof, E1, P1.home), ctl = bare('control', P2.prof, E1, P2.home);
  try {
    const first = await until(() => hosts(P1.home)[0], 30000);
    const a = agent('idle', P1.home);
    const discover = await a.modern('server/discover'), before = await call(a, 'todo_list', 'modern', 20000);
    const quiet = Date.now();
    ph.before = { host: first && { pid: first.rec.pid, at: first.rec.at }, discover: !!discover.result, todo: sc(before) };
    ok('4', 'the bare browser\'s worker connects at start, and the paired agent\'s call answers', !!first && await answers(before, 'todo_list'), ph.before);
    const breaks = [];
    const report = (label) => probeLog(label).find((e) => e.m?.t === 'report');
    await until(() => {
      if (first && !alive(first.rec.pid)) breaks.push({ at: Date.now(), host: 'gone' });
      if (a.exit) breaks.push({ at: Date.now(), agent: a.exit });
      return (report('port') && report('control')) || breaks.length || port.proc.exitCode !== null || ctl.proc.exitCode !== null;
    }, WAIT + 60e3, 1000);
    const after = await call(a, 'todo_list', 'modern', 20000), later = hosts(P1.home);
    for (const [label, b] of [['port', port], ['control', ctl]]) {
      const r = report(label)?.m, firstSeen = probeLog(label).find((e) => e.m?.t === 'first');
      const session = (r?.starts || []).filter((s) => s.born >= b.at);
      ph[label] = { report: r, firstAt: firstSeen?.at, session, quietMs: r?.last ? r.last.asked - (label === 'port' ? Math.max(quiet, r.first.asked) : r.first.asked) : null };
    }
    ph.breaks = breaks;
    ph.after = { todo: sc(after), hosts: later.map((e) => e.rec.pid), agentExit: a.exit };
    const p = ph.port;
    ok('4', `with agent access on, the worker is the same after ${IDLE / 1000} s with no DevTools: its nonce, one start`, !!p.report?.last && p.report.first.nonce === p.report.last.nonce
      && p.session.length === 1 && p.session[0].nonce === p.report.first.nonce && p.quietMs >= IDLE, p);
    ok('4', 'and so is the host, and the agent\'s connection: its next call answers', !breaks.length && later.length === 1 && later[0].rec.pid === first?.rec.pid && !a.exit && await answers(after, 'todo_list'), { breaks, ...ph.after });
    const c = ph.control;
    ok('4', 'the control, without agent access, loses its worker meanwhile', !!c.report?.last && c.report.first.nonce !== c.report.last.nonce && c.session.length === 2 && c.quietMs >= IDLE, c);
    const log = fs.readFileSync(port.log, 'utf8'), ready = log.split('\n').filter((l) => l.startsWith('glaze-mcp host: ready for agents'));
    ph.hostLines = ready;
    ok('4', 'one host for the whole bare session (its stderr, in the browser\'s log)', ready.length === 1, ready);
    await a.end();
  } finally {
    await Promise.all([stop(port.proc), stop(ctl.proc)]);
    for (const l of ['port', 'control']) { const f = path.join(scratch, `probe-${l}.jsonl`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, `probe-${l}.jsonl`)); }
  }
}

// 5 and 6.
async function killAndOff() {
  const ph = R.phases.killOff = {};
  const { context, opt } = await open(P1.prof, E1, P1.home);
  const up = await connected(opt), first = hosts(P1.home)[0];
  const a = agent('killed', P1.home);
  const discover = await a.modern('server/discover');
  ok('5', 'after a restart of the browser the link is connected again', !!up && !!first && !!discover.result, { up, host: first?.rec.pid });
  await watch(opt);
  const killed = Date.now();
  if (first) process.kill(first.rec.pid, 'SIGKILL');
  const heard = ph.heard = await until(async () => { const s = await opt.evaluate(() => window.t9Link); return s.some((x) => x.state === 'exited') && s.at(-1).state === 'connected' && s; }, 20000);
  const exited = heard?.find((x) => x.state === 'exited'), back = heard?.at(-1), second = hosts(P1.home)[0];
  ph.hosts = { first: first?.rec.pid, second: second?.rec.pid, run: runFolder(P1.home) };
  ok('5', 'the host killed: the link shows exited, in Chromium\'s words', exited?.error === 'Native host has exited.' && exited.at >= killed, heard);
  ok('5', 'then connects to a new host on its own, which takes over the run file', back?.state === 'connected' && !!second && second.rec.pid !== first?.rec.pid && second.rec.token !== first?.rec.token
    && hosts(P1.home).length === 1 && runFolder(P1.home)?.length === 2, { back, ...ph.hosts, retryMs: back && exited ? back.at - exited.at : null });
  const lost = ph.lost = await a.gone();
  ok('5', 'the agent on the killed host exits 1, saying Glaze closed it', lost?.code === 1 && a.err.includes('Glaze closed the connection'), { lost, err: a.err });
  const b = agent('after-kill', P1.home), todo = await call(b, 'todo_list');
  ok('5', 'a new agent reaches the new host', await answers(todo, 'todo_list'), sc(todo));

  const off = ph.off = await config(opt, { op: 'set', on: false }), at = Date.now();
  const went = await until(() => second && !alive(second.rec.pid) && Date.now(), 5000, 20);
  ph.offMs = went ? went - at : null;
  ok('6', 'off: the worker lets go of the port and the host exits', off?.ok === true && off.link?.state === 'off' && !!went, { off, ms: ph.offMs });
  ok('6', 'the run folder is emptied', same(runFolder(P1.home), []), runFolder(P1.home));
  const dropped = ph.dropped = await b.gone();
  const state = ph.state = await config(opt, { op: 'state' }), mirror = await linkOf(opt);
  ok('6', 'the connected agent is let go, and Settings reads off', dropped?.code === 1 && state?.on === false && state.link?.state === 'off' && mirror?.state === 'off', { dropped, state, mirror });
  const c = agent('after-off', P1.home);
  await sleep(2000);
  ok('6', 'a new agent finds no host and waits', !c.exit && /waiting for Glaze/.test(c.err) && !c.err.includes('connected to Glaze'), c.err);
  await c.end();
  await close(context);
}

// 7: the shipped manifest, headed.
async function restart() {
  const ph = R.phases.restart = {};
  if (require('node:child_process').spawnSync('sh', ['-c', 'command -v Xvfb']).status !== 0) return ok('7', 'Xvfb is here for the headed run', false, 'no Xvfb');
  const X = await startX(), x = await xclient(X.n);
  try {
    const ext = stage('shipped', false), home = path.join(scratch, 'home3'), prof = path.join(scratch, 'profile-restart');
    const launcher = path.join(scratch, 'hosts3', 'chromium');
    put(launcher, L.sh({ node: process.execPath, script: BIN, browser: 'chromium' }), 0o755);
    nmh(prof, { name: BR.HOST, description: 'glaze-mcp (T9)', path: launcher, type: 'stdio', allowed_origins: [IDS.origin(ext.id)] });
    ph.manifest = { permissions: ext.permissions, optional: ext.optional };
    const { context, opt } = await open(prof, ext, home, X.n);
    await opt.bringToFront();
    const born = await who(opt);
    // The switch as Settings will have it: the grant's request is the click's first statement, then set on.
    await opt.evaluate(() => {
      const b = document.createElement('button');
      b.id = 't9-on';
      b.textContent = 'Agent access';
      b.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;padding:12px';
      document.body.append(b);
      b.addEventListener('click', () => {
        const asked = chrome.permissions.request({ permissions: ['nativeMessaging'] });
        window.t9 = { state: 'asking' };
        asked.then(async (granted) => {
          window.t9 = { state: 'answered', granted };
          if (granted) window.t9 = { ...window.t9, set: await chrome.runtime.sendMessage({ type: 'glaze:mcp-config', op: 'set', on: true }) };
        }, (e) => { window.t9 = { state: 'error', error: String(e?.message || e) }; });
      });
    });
    // The prompt's focus starts on its Deny button (spike Q2): Tab, then Return; Return alone in case it doesn't.
    ph.attempts = [];
    for (const [how, keys] of [['tab-return', [TAB, RETURN]], ['return', [RETURN]]]) {
      await opt.click('#t9-on');
      await sleep(1500);
      const shot = `restart-prompt-${ph.attempts.length + 1}.png`;
      await x.shot(path.join(OUT, shot));
      for (const k of keys) await x.key(k);
      const t9 = await until(() => opt.evaluate(() => (window.t9?.state !== 'asking' && (window.t9?.set || window.t9?.granted === false || window.t9?.error)) && window.t9), 5000);
      ph.attempts.push({ how, shot, t9 });
      if (t9?.set || t9?.state !== 'answered') break;
    }
    const t9 = ph.attempts.at(-1)?.t9;
    ok('7', 'Chromium\'s prompt, answered Allow, grants nativeMessaging', t9?.granted === true && await opt.evaluate(() => chrome.permissions.contains({ permissions: ['nativeMessaging'] })), ph.attempts);
    ok('7', 'set on in the same worker leaves the link in restart', t9?.set?.ok === true && t9.set.link?.state === 'restart', t9?.set);
    await sleep(3000);
    const waiting = ph.waiting = { link: await linkOf(opt), worker: await who(opt), run: runFolder(home) };
    ok('7', 'and it waits there: the same worker, no host started', waiting.link?.state === 'restart' && waiting.worker.nonce === born.nonce && !waiting.run?.length, waiting);
    await x.shot(path.join(OUT, 'restart-after.png'));
    // The next worker: as an idle stop would, DevTools stops it; the options page's message starts a new one.
    const cdp = await context.newCDPSession(opt);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await sleep(1000);
    const next = ph.next = await who(opt);
    const up = ph.link = await connected(opt), host = hosts(home)[0];
    ok('7', 'the next worker connects at its start', next.nonce !== born.nonce && up?.host === VERSION && !!host && cmdline(host.rec.pid)?.includes(IDS.origin(ext.id)), { next, up, host: host?.rec.pid });
    const a = agent('restart', home), d = await a.modern('server/discover'), t = await a.modern('tools/list');
    ok('7', 'and an agent reaches it', !!d.result && names(t)?.includes('todo_list'), names(t));
    await a.end();
    await close(context);
  } catch (e) {
    await x.shot(path.join(OUT, 'restart-error.png')).catch(() => {});
    throw e;
  } finally {
    x.close();
    await stop(X.proc);
  }
}

const guard = (name, fn) => fn().catch((e) => { say(`ERROR in ${name}:`, e.stack || String(e)); R.errors = { ...R.errors, [name]: String(e.stack || e) }; });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const lock = require('./check-env.js').lockPath();
  let held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await sleep(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nagent-link-check\n`);
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-t9-')));
    put(path.join(scratch, 'probe', 'host.js'), `(${probeHost})();\n`);
    try { R.chrome = execFileSync(require('./check-env.js').chromePath() || chromium.executablePath(), ['--version'], { encoding: 'utf8' }).trim(); } catch (e) { R.chrome = String(e); }
    R.platform = `${os.platform()} ${os.release()}`;
    say('chrome', R.chrome, 'idle', IDLE);
    STORE = { todoCache: await C.canvasPlan('5', PLAN), seenCourses: await C.canvasSeen(SEEN) };
    E1 = stage('required', true);
    try { setup(); } catch (e) { ok('1', 'glaze-mcp setup', false, String(e.stack || e)); }
    await guard('agents', onAndAgents); save();
    await guard('control', control);
    await guard('idle', idle); save();
    await guard('killOff', killAndOff); save();
    await guard('restart', restart); save();
  } finally {
    for (const c of owned.contexts) await c.close().catch(() => {});
    for (const p of owned.procs) await stop(p);
    // No host outlives its browser: ours by the scratch folder (setup's copy, the probe) or a staged copy's origin.
    if (scratch && fs.existsSync('/proc')) {
      await sleep(1500);
      const left = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d) && +d !== process.pid).map((d) => [+d, cmdline(d) || []])
        .filter(([, argv]) => argv.some((s) => s.includes(scratch) || STAGED.includes(s)));
      for (const [pid] of left) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      ok('cleanup', 'no host outlives its browser', !left.length, left);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    const failed = R.checks.filter((c) => !c.pass);
    R.summary = { checks: R.checks.length, failed: failed.length, errors: Object.keys(R.errors || {}) };
    save();
    say(failed.length || R.errors ? `FAILED ${failed.length} of ${R.checks.length}${R.errors ? `, errors in ${Object.keys(R.errors).join(', ')}` : ''}` : `all ${R.checks.length} checks pass`, 'evidence in', OUT);
    process.exitCode = failed.length || R.errors || !R.checks.length ? 1 : 0;
  }
})().catch((e) => { console.error(e); process.exit(1); });
