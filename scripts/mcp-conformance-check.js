// MCP conformance (C17): the official TypeScript SDK client (@modelcontextprotocol/client, pinned exactly below; npm installs
// it into a scratch folder at check time and scripts/npm-integrity.js holds every package to its pinned integrity before it
// runs) talking to Glaze through the real path: glaze-mcp agent → glaze-mcp host → Chromium's worker, on Linux. As in
// agent-link-check, Glaze is staged with nativeMessaging required (headless can't answer its prompt) and glaze-mcp setup
// installs the helper under a scratch HOME whose Chromium folder is the profile; the caches are the production writers'
// (test/helpers/mcp-caches.cjs).
//   1 Eras: initialize at 2025-11-25 and 2025-06-18; 2026-07-28 negotiated (auto: server/discover) and pinned.
//   2 tools/list: by name, alike in every era, ttlMs and a private cacheScope; names; outputSchema.
//   3 A read through pairing (Allow in the approval window), then the other eras unasked; structuredContent as its text.
//   4 Errors: an unknown tool, invalid arguments, an unknown account, an unsupported version, malformed _meta.
//   5 Refused: resources/*, prompts/*, an unknown method.
//   6 Cancel while the approval window waits, in both eras.
//   7 Mods with tools turned on: subscriptions/listen (modern), notifications/tools/list_changed (legacy), nothing unasked;
//     pages past 50 tools, stale cursors; the longest name a mod tool can have, called once granted.
//   8 S3: calls waiting in the approval window with the SDK's defaults, with progress, and with resetTimeoutOnProgress; with
//     FULL=1, one more that waits out the 600 s limit (about ten minutes).
//   9 Off: the subscription ends gracefully, every agent is let go and the host goes.
// Evidence in the folder given: results.json (checks, s3, s4), log.txt, each client's wire-<label>.jsonl and stderr, setup,
// and the approval windows.
//   glaze-remote -o <evidence dir> -- node scripts/mcp-conformance-check.js /out        (with FULL=1: -e FULL=1 -t 2400)
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { isDeepStrictEqual: same } = require('node:util');
const C = require('../test/helpers/mcp-caches.cjs');
const ST = require('../lib/mcp/tools-study.js'), W = require('../lib/mcp/wire.js'), A = require('../lib/mcp/approve.js'), MT = require('../lib/modtools.js');
const IDS = require('../mcp/lib/ids.js'), BR = require('../mcp/lib/browsers.js'), RV = require('../mcp/lib/rendezvous.js');
const NPM = require('./npm-integrity.js'), G = require('../lib/mcp/grants.js');

const src = fs.realpathSync(path.join(__dirname, '..'));
const BIN = path.join(src, 'mcp', 'bin', 'glaze-mcp.js');
const VERSION = require('../manifest.json').version;
const OUT = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-conformance-out-')));
const FULL = !!process.env.FULL;
const NODE = fs.realpathSync(process.execPath);
// The client and every package npm installs with it, as `npm view <name>@<version> dist.integrity` prints them. All are
// installed by exact version, so a newer release of a dependency can't slip in.
const SDK = '@modelcontextprotocol/client@2.4.0';
const PINS = `
@modelcontextprotocol/client@2.4.0 sha512-LgrD2OphHuG12vfKFKz6SOnq7bKHQmhGJIAYdD+MZBn2npHEyry6uD8zvktodtl5CQM85MO0anUyD9JwmUmxww==
@modelcontextprotocol/core@2.4.0 sha512-z8QBKqdfXLPzkLQuG4xp8hrVEMm1PZ1IgxMN2sMbJiFiAKOWXnAzogXn2W4aqIBlP1ea6U5yiqVquvUNM1Cj6Q==
cross-spawn@7.0.6 sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==
eventsource@3.0.7 sha512-CRT1WTyuQoD771GW56XEZFQ/ZoSfWid1alKGDYMmkt2yl8UXrVR4pspqWNEcqKvVIzg6PAltWjxcSSPrboA4iA==
eventsource-parser@3.1.1 sha512-EKN1vKAMcZ8MlYMpaNuxN6R9yakzH6uajHcHVTqWJzvu5pWw9DyhbP35HH8MVBQ+dZjAfDxk+A8NiR9KWaXiyQ==
isexe@2.0.0 sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==
jose@6.2.14 sha512-3JasLuki1NRLQvY4wCoC37KZk4qxoBx2k2aFqLxT84IezqW0bkJKnNtxnZj/Fu1xsQivoc/lytxaRHJoGLjJ1A==
path-key@3.1.1 sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==
pkce-challenge@5.0.1 sha512-wQ0b/W4Fr01qtpHlqSqspcj3EhBvimsdh0KlHhH8HRZnMsEa0ea2fTULOXOS9ccQr3om+GcGRk4e+isrZWV8qQ==
shebang-command@2.0.0 sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==
shebang-regex@3.0.0 sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==
which@2.0.2 sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==
zod@4.6.7 sha512-g8W2D2kU6a8untc053fX1uVBKzM7yqAxW/3zwk83+6RyF2+SKOuV+c0wBDhUwzV1PaGapmZH+rmcUzPf+3CGwg==
`;
const CLIENT = { name: 'Glaze C17 check', version: '1.0.0' };
const ACCOUNT = `${C.CANVAS}/5`;
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const NS = 'io.modelcontextprotocol/', PV = `${NS}protocolVersion`, CAPS = `${NS}clientCapabilities`, SUB = `${NS}subscriptionId`, SERVER = `${NS}serverInfo`;
// The result schema the SDK asks for with a method outside the spec (a Standard Schema that takes anything).
const ANY = { '~standard': { version: 1, vendor: 'glaze-c17', validate: (value) => ({ value }) } };
const ERAS = ['legacy', 'old', 'auto', 'pin'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let interrupted;
const until = async (fn, ms = 15000, step = 100) => { for (const end = Date.now() + ms; ; await sleep(step)) { if (interrupted) throw Error(interrupted); const v = await fn(); if (v) return v; if (Date.now() > end) return null; } };
const R = { node: process.version, sdk: SDK, glaze: VERSION, full: FULL, checks: [], phases: {}, s3: {}, s4: {} };
const lines = [];
const say = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(`${new Date().toISOString()} ${s}`); console.log(s.length > 600 ? `${s.slice(0, 600)}…` : s); };
const save = () => { fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(R, null, 2)}\n`); fs.writeFileSync(path.join(OUT, 'log.txt'), `${lines.join('\n')}\n`); };
const ok = (step, what, pass, evidence) => { R.checks.push({ step, what, pass: !!pass, ...(evidence !== undefined && { evidence }) }); say(pass ? 'ok' : 'FAIL', `[${step}]`, what, ...(pass || evidence === undefined ? [] : [evidence])); };
// What a promise settled to: { value } or { error } with the SDK's code and data.
const caught = async (f) => { try { return { value: await f() }; } catch (e) { return { error: { name: e?.constructor?.name, code: e?.code, message: String(e?.message || e), ...(e?.data !== undefined && { data: e.data }) } }; } };
const textOf = (r) => r?.content?.find((x) => x.type === 'text')?.text;

let scratch, HOME, EXT, CTX, OPT, sdk;
const contexts = new Set(), clients = new Set();
const envFor = (home) => {
  const e = { ...process.env, HOME: home };
  for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'CHROME_CONFIG_HOME', 'GLAZE_MCP_BROWSER']) delete e[k];
  return e;
};
const hosts = () => RV.list(RV.dir({ env: { HOME } })).filter((e) => e.alive);

// ---- the SDK ----------------------------------------------------------------------------------------------------------
function install(dir) {
  const ids = [...NPM.parsePins(PINS).keys()];
  execFileSync('npm', ['install', '--prefix', dir, '--silent', '--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', 'https://registry.npmjs.org/', ...ids], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  // Nothing installed runs before this passes.
  const verified = NPM.check(JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', '.package-lock.json'), 'utf8')), PINS, ['@modelcontextprotocol/client']);
  const need = createRequire(path.join(dir, 'package.json'));
  return { verified, ...need('@modelcontextprotocol/client'), ...need('@modelcontextprotocol/client/stdio') };
}

// Every message both ways, in OUT/wire-<label>.jsonl and in memory; the transport stays the SDK's own class, so auto
// negotiation still probes on a sibling process as it does for any stdio server.
function tap(t, label) {
  const file = path.join(OUT, `wire-${label}.jsonl`), got = [];
  const note = (dir, m) => { const e = { at: Date.now(), dir, m }; got.push(e); fs.appendFileSync(file, `${JSON.stringify(e)}\n`); };
  const send = t.send.bind(t);
  t.send = (m, o) => { note('out', m); return send(m, o); };
  let on;
  Object.defineProperty(t, 'onmessage', { configurable: true, get: () => on, set: (f) => { on = typeof f === 'function' ? (m, x) => { note('in', m); return f(m, x); } : f; } });
  return got;
}
// An app: the SDK's Client over its own glaze-mcp agent, under the scratch HOME. changes: listChanged for tools.
async function client(label, { name = CLIENT.name, mode, versions, changes } = {}) {
  const transport = new sdk.StdioClientTransport({ command: process.execPath, args: [BIN, 'agent'], env: envFor(HOME), stderr: 'pipe' });
  const wire = tap(transport, label), log = path.join(OUT, `agent-${label}.stderr.txt`);
  transport.stderr?.on('data', (d) => fs.appendFileSync(log, d));
  const heard = [];
  const c = new sdk.Client({ name, version: CLIENT.version }, {
    capabilities: {}, ...(mode && { versionNegotiation: { mode } }), ...(versions && { supportedProtocolVersions: versions }),
    ...(changes && { listChanged: { tools: { debounceMs: 0, onChanged: (e, tools) => heard.push({ at: Date.now(), error: e ? String(e.message || e) : null, names: tools ? tools.map((t) => t.name) : null }) } } }),
  });
  c.onerror = (e) => fs.appendFileSync(log, `[sdk onerror] ${e?.message || e}\n`);
  clients.add(c);
  const at = Date.now();
  await c.connect(transport);
  return { label, name, c, wire, heard, connectMs: Date.now() - at };
}
const sent = (x, method, after = 0) => x.wire.filter((e) => e.dir === 'out' && e.at >= after && e.m.method === method);
const heardOn = (x, method, after = 0) => x.wire.filter((e) => e.dir === 'in' && e.at >= after && e.m.method === method);
const answerTo = (x, id) => x.wire.find((e) => e.dir === 'in' && e.m.id === id && !e.m.method);

// ---- the browser --------------------------------------------------------------------------------------------------------
// The staged copy: the checkout's files as links (scripts/check-env.js staged), its manifest with nativeMessaging required.
function stage() {
  const dir = require('./check-env.js').staged(src, [], scratch), file = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.permissions = [...m.permissions, 'nativeMessaging'];
  m.optional_permissions = (m.optional_permissions || []).filter((p) => p !== 'nativeMessaging');
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  return { dir, id: IDS.devId(dir) };
}
function setup() {
  const row = BR.table(process.platform, envFor(HOME)).find((b) => b.id === 'chromium');
  fs.mkdirSync(row.data, { recursive: true });
  let out, code = 0;
  try { out = execFileSync(process.execPath, [BIN, 'setup', '--browser', 'chromium', '--dev', EXT.dir], { env: envFor(HOME), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = `${e.stdout}${e.stderr}`; code = e.status; }
  fs.writeFileSync(path.join(OUT, 'setup.txt'), out);
  const mf = path.join(row.dir, `${BR.HOST}.json`), manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  ok('0', 'glaze-mcp setup --browser chromium --dev <staged copy> installs the helper into the profile', code === 0 && !!manifest?.allowed_origins?.includes(IDS.origin(EXT.id)), { code, manifest });
  return row.data;
}
async function browse(prof) {
  await require('./wait-for-browser.js')();
  const context = await chromium.launchPersistentContext(prof, { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1000, height: 700 }, env: envFor(HOME),
    args: [`--disable-extensions-except=${EXT.dir}`, `--load-extension=${EXT.dir}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'] });
  contexts.add(context);
  context.setDefaultTimeout(15000);
  require('./check-env.js').noFirstRun(context);
  await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${EXT.id}/options.html`);
  return { context, opt };
}
const config = (m) => OPT.evaluate((m) => chrome.runtime.sendMessage({ type: 'glaze:mcp-config', ...m }), m);
const local = (patch) => OPT.evaluate((p) => chrome.storage.local.set(p), patch);
// The approval records (lib/mcp/approve.js) in storage.session.
const asks = () => OPT.evaluate(() => chrome.storage.session.get(null).then((all) => Object.entries(all).filter(([k]) => k.startsWith('mcpAsk:')).map(([, v]) => v)));
const askOf = async (name) => (await asks()).filter((a) => a.app?.name === name).sort((a, b) => a.at - b.at).at(-1) || null;
const APPROVE = () => `chrome-extension://${EXT.id}/lib/mcp/approve.html`;
const windowPage = () => CTX.pages().find((p) => p.url() === APPROVE());
const shown = (w) => w.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  return $('ask').hidden ? null : { title: $('title').textContent, group: $('group').hidden ? null : $('group').textContent, app: $('app').textContent, exe: $('exe').textContent };
}).catch(() => null);
const showing = async (app) => { const w = windowPage(), s = w && await shown(w); return s?.app === app ? { w, s } : null; };
// Once the window shows app's ask: the student's click on button. → what the window showed, or null.
async function decide(app, label, button = 'yes', ms = 30000) {
  const seen = await until(() => showing(app), ms);
  if (!seen) return null;
  await seen.w.bringToFront();
  await until(() => seen.w.evaluate(() => document.hasFocus() && document.getElementById('yes').getAttribute('aria-disabled') === 'false'), 10000);
  await seen.w.screenshot({ path: path.join(OUT, `approve-${label}.png`) }).catch(() => {});
  await seen.w.click(`#${button}`);
  return seen.s;
}

// ---- the caches and the mods -------------------------------------------------------------------------------------------
const PLAN = [
  C.planner({ id: 1, course: 25, name: 'BIO 1100', title: 'Lab 4: Enzymes', at: '2026-10-16T03:59:00Z' }),
  C.planner({ type: 'quiz', id: 2, course: 26, name: 'ENG 1100', title: 'Reading quiz', at: '2026-10-20T03:59:00Z', sub: { submitted: true } }),
  C.planner({ type: 'planner_note', id: 3, course: null, name: null, title: 'Bring goggles', details: 'Lab coat too', at: '2026-10-15T16:00:00Z' }),
];
const SEEN = [{ id: 25, name: 'BIO 1100', course_code: 'BIO1100-01', color: '#aabbcc' }, { id: 26, name: 'ENG 1100', course_code: 'ENG1100-02' }, { id: 27, name: 'MATH 1350', course_code: 'MATH1350' }];
let STORE;
const want = (name) => ST.tools().find((t) => t.name === name).run({}, C.ctx(STORE, ACCOUNT, { now: Date.now }));
// The worker's answer holds what the tool gives in node over the same caches, under Glaze's envelope, as its text too.
const answers = async (r, name) => {
  const got = r?.structuredContent, w = await want(name);
  return !!got && r.isError !== true && got.account === ACCOUNT && got.source === 'cache' && got.at === w.at && same(got.items, w.items) && mirrored(r);
};
const mirrored = (r) => { try { return !!r.structuredContent && typeof r.structuredContent === 'object' && !Array.isArray(r.structuredContent) && same(JSON.parse(textOf(r)), r.structuredContent); } catch { return false; } };
// Installed mods with declarative tools (lib/modtools.js), on and granted as the editor leaves them. The first tool has the
// longest name a mod tool can have: mod_<id16>_<24 characters>.
const LONGEST = 'due_within_the_next_week';
const mod = (n, count) => {
  const id = `conformancemoda${'abcdefgh'[n]}`;
  const tools = Array.from({ length: count }, (_, i) => ({ name: n === 0 && i === 0 ? LONGEST : `due_${i}`, title: `Due list ${i}`, description: `What is due, from mod ${n}.`, from: 'todo',
    ...(i % 2 && { select: ['title', 'due', 'course'], sort: { field: 'due', order: 'asc' }, limit: 20 }) }));
  const manifest = { glaze: 1, name: `C17 mod ${n}`, version: '1.0.0', permissions: [{ id: 'agents', why: 'Lists what is due for agent apps.' }, { id: 'todo', why: 'Reads your plan.' }], tools };
  MT.clean(tools, manifest);
  return { id, enabled: true, hash: `h-${id}`, key: 'c17-fixture-key', version: '1.0.0', dev: false, grants: { agents: true, todo: true }, manifest, files: {} };
};
let MODS = [];

// ---- the steps ------------------------------------------------------------------------------------------------------------
const E = {};

// 0: the helper, the browser, agent access on.
async function start() {
  EXT = stage();
  const prof = setup();
  ({ context: CTX, opt: OPT } = await browse(prof));
  await local(STORE);
  const set = await config({ op: 'set', on: true });
  const up = await until(async () => { const l = await OPT.evaluate(() => chrome.storage.session.get('mcpLink').then((r) => r.mcpLink || null)); return l?.state === 'connected' && l; }, 20000);
  R.phases.start = { set, link: up, host: hosts()[0]?.rec && { ...hosts()[0].rec, token: '…' } };
  ok('0', 'agent access is on and the worker is connected to the helper setup installed', set?.ok === true && up?.host && hosts().length === 1, R.phases.start);
}

// 1: one app (one name, one program) in each era.
async function eras() {
  const ph = R.phases.eras = {};
  E.legacy = await client('legacy-2025-11-25', { changes: true });
  E.old = await client('legacy-2025-06-18', { versions: ['2025-06-18'] });
  E.auto = await client('modern-auto', { mode: 'auto', changes: true });
  E.pin = await client('modern-pin', { mode: { pin: W.MODERN } });
  for (const k of ERAS) ph[k] = { era: E[k].c.getProtocolEra(), version: E[k].c.getNegotiatedProtocolVersion(), server: E[k].c.getServerVersion(), caps: E[k].c.getServerCapabilities(), instructions: E[k].c.getInstructions?.(), ms: E[k].connectMs };
  const glaze = (s) => s?.name === 'glaze' && s.version === VERSION;
  const init = (k) => sent(E[k], 'initialize')[0]?.m, initAnswer = (k) => answerTo(E[k], init(k)?.id)?.m;
  ok('1', 'initialize at 2025-11-25, the SDK\'s legacy default, is answered in 2025-11-25 with tools.listChanged', ph.legacy.era === 'legacy' && ph.legacy.version === '2025-11-25' && glaze(ph.legacy.server)
    && ph.legacy.caps?.tools?.listChanged === true && init('legacy')?.params?.protocolVersion === '2025-11-25' && initAnswer('legacy')?.result?.protocolVersion === '2025-11-25' && sent(E.legacy, 'notifications/initialized').length === 1, { ...ph.legacy, wire: initAnswer('legacy') });
  ok('1', 'initialize at 2025-06-18 is answered in 2025-06-18', ph.old.era === 'legacy' && ph.old.version === '2025-06-18' && glaze(ph.old.server) && initAnswer('old')?.result?.protocolVersion === '2025-06-18', { ...ph.old, wire: initAnswer('old') });
  const d = ph.discover = E.auto.c.getDiscoverResult?.();
  ok('1', 'auto negotiation (server/discover on a sibling agent) picks 2026-07-28 and sends no initialize', ph.auto.era === 'modern' && ph.auto.version === W.MODERN && glaze(ph.auto.server) && !sent(E.auto, 'initialize').length, ph.auto);
  ok('1', 'server/discover: the three versions, tools with listChanged, Glaze in _meta, a private ttlMs', same(d?.supportedVersions, W.SUPPORTED) && d.capabilities?.tools?.listChanged === true
    && glaze(d._meta?.[SERVER]) && d.ttlMs > 0 && d.cacheScope === 'private', d);
  // Pinned, the SDK probes on a sibling too, then holds the server to the pin; its own first request follows.
  await caught(() => E.pin.c.listTools());
  const first = E.pin.wire.find((e) => e.dir === 'out')?.m, back = first && answerTo(E.pin, first.id)?.m;
  ok('1', 'pinned to 2026-07-28: the probe offers it, and every request names it; results are complete', ph.pin.era === 'modern' && ph.pin.version === W.MODERN && same(E.pin.c.getDiscoverResult?.()?.supportedVersions, W.SUPPORTED)
    && !sent(E.pin, 'initialize').length && first?.params?._meta?.[PV] === W.MODERN && back?.result?.resultType === 'complete', { ...ph.pin, first: first?.method });
}

// 2: the list, before any mod.
let BASE = [];
async function lists() {
  const ph = R.phases.lists = {};
  const all = {};
  for (const k of ERAS) all[k] = (await E[k].c.listTools()).tools;
  const names = all.auto.map((t) => t.name);
  BASE = names;
  ph.names = names;
  ok('2', 'tools/list is sorted by name and holds the courses group', names.length > 0 && names.every((n, i) => !i || names[i - 1] < n) && ['accounts_list', 'courses_list', 'todo_list'].every((n) => names.includes(n)), names);
  ok('2', 'the same tool descriptors in every era', ERAS.every((k) => same(all[k], all.auto)), Object.fromEntries(ERAS.map((k) => [k, all[k].length])));
  const again = (await E.auto.c.listTools(undefined, { cacheMode: 'bypass' })).tools;
  ok('2', 'and the same again, fetched afresh (deterministic)', same(again, all.auto));
  const page = await caught(() => E.auto.c.request({ method: 'tools/list', params: {} }));
  const raw = sent(E.auto, 'tools/list').at(-1), back = raw && answerTo(E.auto, raw.m.id)?.m;
  ph.page = { ttlMs: page.value?.ttlMs, cacheScope: page.value?.cacheScope, nextCursor: page.value?.nextCursor, wire: back && { resultType: back.result?.resultType, meta: back.result?._meta } };
  ok('2', `modern: one page, complete, cached ${W.TTL} ms privately, Glaze named in its _meta`, page.value?.tools?.length === names.length && page.value.nextCursor === undefined && page.value.ttlMs === W.TTL
    && page.value.cacheScope === 'private' && back?.result?.resultType === 'complete' && back.result._meta?.[SERVER]?.name === 'glaze', ph.page);
  const old = await caught(() => E.legacy.c.request({ method: 'tools/list', params: {} }));
  const lraw = sent(E.legacy, 'tools/list').at(-1), lback = lraw && answerTo(E.legacy, lraw.m.id)?.m;
  ok('2', 'legacy: the 2025 shape, without resultType, ttlMs or cacheScope', !!lback?.result?.tools && ['resultType', 'ttlMs', 'cacheScope'].every((k) => !(k in lback.result)), lback && Object.keys(lback.result));
  const bad = all.auto.filter((t) => !NAME.test(t.name) || t.name.length > 64);
  ok('2', 'every name matches ^[a-z][a-z0-9_]{0,63}$', !bad.length, bad.map((t) => t.name));
  ok('2', 'every tool has an object inputSchema and annotations; reads are readOnlyHint', all.auto.every((t) => t.inputSchema?.type === 'object' && typeof t.annotations?.readOnlyHint === 'boolean')
    && all.auto.filter((t) => t._meta?.['io.frostdev.glaze/approval'] === undefined).every((t) => t.annotations.readOnlyHint === true), all.auto.map((t) => [t.name, t.annotations]));
  ph.outputSchemas = all.auto.filter((t) => t.outputSchema !== undefined).map((t) => t.name);
  say('tools with an outputSchema:', ph.outputSchemas.length ? ph.outputSchemas : 'none');
}

// 3: the first read pairs the app; then every era is answered unasked.
async function pairing() {
  const ph = R.phases.pairing = {};
  const pending = caught(() => E.auto.c.callTool({ name: 'courses_list', arguments: { account: ACCOUNT } }));
  const s = ph.window = await decide(CLIENT.name, 'pair');
  ok('3', 'courses_list asks to pair the app in the approval window, as the app reports itself', s?.title === `${CLIENT.name} wants to use Glaze` && s.group === 'Courses, to-dos and schedule' && s.exe === NODE, s);
  const r = ph.courses = await pending;
  ok('3', 'once allowed, courses_list (2026-07-28) answers from the caches', await answers(r.value, 'courses_list'), { got: r.value?.structuredContent ?? r.error, want: await want('courses_list') });
  for (const k of ['legacy', 'old', 'pin']) {
    const t = ph[k] = await caught(() => E[k].c.callTool({ name: 'todo_list', arguments: { account: ACCOUNT } }));
    ok('3', `todo_list (${E[k].label}) answers unasked: the same app`, await answers(t.value, 'todo_list') && !windowPage(), t.value?.structuredContent ?? t.error);
  }
  const outs = [r, ph.legacy, ph.old, ph.pin];
  ok('3', 'outputSchema: none is declared, so structuredContent has no schema to hold; each is an object, mirrored in its text', !R.phases.lists.outputSchemas.length && outs.every((x) => mirrored(x.value)), R.phases.lists.outputSchemas);
  const apps = ph.apps = await config({ op: 'apps' });
  ok('3', 'Settings holds one app, paired for courses', apps?.apps?.length === 1 && apps.apps[0].name === CLIENT.name && apps.apps[0].exe === NODE && apps.apps[0].grants?.courses === true, apps);
}

// 4 and 5.
async function errors() {
  const ph = R.phases.errors = {};
  for (const k of ERAS) {
    const x = ph[k] = {
      unknown: await caught(() => E[k].c.callTool({ name: 'no_such_tool', arguments: {} })),
      invalid: await caught(() => E[k].c.callTool({ name: 'todo_list', arguments: { account: 5 } })),
      nobody: await caught(() => E[k].c.callTool({ name: 'todo_list', arguments: { account: 'https://nowhere.example.edu/1' } })),
    };
    ok('4', `${E[k].label}: an unknown tool is the protocol error -32602`, x.unknown.error?.code === -32602 && /Unknown tool/.test(x.unknown.error.message), x.unknown);
    ok('4', `${E[k].label}: invalid arguments are a tool error (isError) the model can read`, x.invalid.value?.isError === true && /^Invalid arguments/.test(textOf(x.invalid.value)), x.invalid);
    ok('4', `${E[k].label}: an account Glaze doesn't hold is a tool error naming the ones it does`, x.nobody.value?.isError === true && textOf(x.nobody.value)?.includes(ACCOUNT), x.nobody);
  }
  const mark = Date.now();
  ph.version = await caught(() => E.pin.c.request({ method: 'tools/list', params: { _meta: { [PV]: '1900-01-01' } } }));
  const v = E.pin.wire.find((e) => e.dir === 'in' && e.at >= mark && e.m.error?.code === -32022)?.m;
  ok('4', 'an unsupported version is -32022, naming the supported ones and the one asked', same(v?.error?.data?.supported, W.SUPPORTED) && v.error.data.requested === '1900-01-01', { wire: v, sdk: ph.version });
  ph.caps = await caught(() => E.pin.c.request({ method: 'tools/list', params: { _meta: { [CAPS]: null } } }));
  ok('4', 'malformed _meta (no client capabilities) is -32602', ph.caps.error?.code === -32602, ph.caps);
  const REFUSED = [['resources/list', {}], ['resources/templates/list', {}], ['resources/read', { uri: 'file:///etc/hosts' }], ['prompts/list', {}], ['prompts/get', { name: 'x' }]];
  ph.refused = {};
  for (const k of ERAS) {
    const got = ph.refused[k] = {};
    for (const [method, params] of REFUSED) got[method] = await caught(() => E[k].c.request({ method, params }));
    got['glaze/unknown'] = await caught(() => E[k].c.request({ method: 'glaze/unknown', params: {} }, ANY));
    ok('5', `${E[k].label}: resources/*, prompts/* and an unknown method are -32601`, Object.values(got).every((x) => x.error?.code === -32601), got);
  }
  ph.ping = await caught(() => E.legacy.c.ping());
  ok('5', 'legacy ping is answered (2026-07-28 removed it; the SDK refuses to send it there)', same(ph.ping.value, {}), ph.ping);
}

// 6: the SDK's AbortSignal while the call waits for the student.
async function cancel() {
  const ph = R.phases.cancel = {};
  const mark = Date.now();
  for (const [k, o] of [['modern', { mode: 'auto' }], ['legacy', {}]]) {
    const name = `C17 cancel ${k}`, x = await client(`cancel-${k}`, { name, ...o }), ac = new AbortController();
    const p = caught(() => x.c.callTool({ name: 'todo_list', arguments: { account: ACCOUNT } }, { signal: ac.signal }));
    const waiting = await until(() => showing(name), 20000);
    ac.abort('The user stopped it');
    const r = await p;
    const call = sent(x, 'tools/call')[0]?.m, cancelled = sent(x, 'notifications/cancelled')[0]?.m;
    const state = await until(async () => { const a = await askOf(name); return a && a.state !== 'waiting' && a.state; }, 5000);
    const closed = await until(() => !windowPage(), 5000);
    await sleep(2000);
    const late = call && answerTo(x, call.id);
    ph[k] = { waiting: !!waiting, sdk: r, cancelled, state, closed: !!closed, late: late?.m ?? null };
    ok('6', `${k}: the abort sends notifications/cancelled for the waiting call`, !!waiting && !!r.error && cancelled?.params?.requestId === call?.id, ph[k]);
    ok('6', `${k}: Glaze ends the ask as cancelled, closes its window, and never answers the call`, state === 'cancelled' && !!closed && !late, ph[k]);
    await x.c.close();
    clients.delete(x.c);
  }
  const rows = ph.activity = (await config({ op: 'activity' })).rows?.filter((r) => r.at >= mark);
  ok('6', 'each is logged once, as cancelled', rows?.length === 2 && rows.every((r) => r.outcome === 'cancelled' && r.tool === 'todo_list'), rows);
}

// 7: list changes, paging, stale cursors and the longest name.
async function changes() {
  const ph = R.phases.changes = {};
  const sub = E.auto.c.autoOpenedSubscription;
  const listen = sent(E.auto, 'subscriptions/listen')[0]?.m;
  const ack = listen && heardOn(E.auto, 'notifications/subscriptions/acknowledged').find((e) => e.m.params?._meta?.[SUB] === listen.id)?.m;
  ok('7', 'modern: listChanged opens subscriptions/listen, acknowledged for toolsListChanged under its id', sub?.honoredFilter?.toolsListChanged === true && listen?.params?.notifications?.toolsListChanged === true && ack?.params?.notifications?.toolsListChanged === true, { listen, ack });
  const quiet = ph.quiet = await caught(() => E.pin.c.listen({ toolsListChanged: false }));
  ok('7', 'a listen without toolsListChanged is acknowledged without it', !!quiet.value && quiet.value.honoredFilter?.toolsListChanged !== true, quiet.value?.honoredFilter ?? quiet.error);
  const need = W.PAGE + 1 - BASE.length; // one tool past a page
  if (need < 1) return ok('7', 'Glaze lists under a page of its own tools, so mods can make a second', false, BASE.length);
  MODS = [];
  for (let n = 0, left = need; left > 0; n++, left -= MT.LIMIT.tools) MODS.push(mod(n, Math.min(MT.LIMIT.tools, left)));
  const modNames = MODS.flatMap((m) => m.manifest.tools.map((t) => `mod_${m.id}_${t.name}`)), total = BASE.length + modNames.length;
  // Each change, as the student turning mods on makes it: one storage write, then each connection hears whether the list moved.
  const change = async (label, patch, count) => {
    const mark = Date.now();
    await local(patch);
    const heard = await until(() => [E.auto, E.legacy].every((x) => x.heard.some((h) => h.at >= mark && h.names?.length === count)), 15000);
    await sleep(1500);
    const n = Object.fromEntries(ERAS.map((k) => [k, heardOn(E[k], 'notifications/tools/list_changed', mark).map((e) => e.m)]));
    ph[label] = { heard: !!heard, notes: n, sdk: { auto: E.auto.heard.filter((h) => h.at >= mark), legacy: E.legacy.heard.filter((h) => h.at >= mark) } };
    ok('7', `${label}: modern, one notifications/tools/list_changed tagged with the subscription's id; the SDK's list holds ${count}`, !!heard && n.auto.length === 1 && n.auto[0].params?._meta?.[SUB] === listen?.id, n.auto);
    ok('7', `${label}: legacy, one notifications/tools/list_changed to each initialized client`, n.legacy.length === 1 && n.old.length === 1, { legacy: n.legacy, old: n.old });
    ok('7', `${label}: none to the modern client that never asked for tool changes`, n.pin.length === 0, n.pin);
    return mark;
  };
  await change('on', Object.fromEntries([['mods', MODS.map((m) => m.id)], ...MODS.map((m) => [`mod:${m.id}`, m])]), total);
  const after = (await E.auto.c.listTools()).tools.map((t) => t.name);
  ok('7', `the list now holds every mod tool, sorted: ${total} tools`, after.length === total && modNames.every((n) => after.includes(n)) && after.every((n, i) => !i || after[i - 1] < n), after.length);
  // Pages, walked by hand in both eras.
  const walk = async (x) => {
    const first = await caught(() => x.c.request({ method: 'tools/list', params: {} }));
    const second = first.value?.nextCursor ? await caught(() => x.c.listTools({ cursor: first.value.nextCursor })) : null;
    return { first: first.value ?? first.error, second: second?.value ?? second?.error ?? null };
  };
  const pm = ph.pagesModern = await walk(E.auto), pl = ph.pagesLegacy = await walk(E.legacy);
  const joined = (p) => [...(p.first?.tools || []), ...(p.second?.tools || [])].map((t) => t.name);
  ok('7', `modern: ${W.PAGE} tools a page, the next cursor, then the rest; each page private for ${W.TTL} ms`, pm.first?.tools?.length === W.PAGE && typeof pm.first.nextCursor === 'string'
    && pm.second?.tools?.length === total - W.PAGE && pm.second.nextCursor === undefined && [pm.first, pm.second].every((p) => p.ttlMs === W.TTL && p.cacheScope === 'private') && same(joined(pm), after),
  { first: pm.first?.tools?.length, cursor: pm.first?.nextCursor, second: pm.second?.tools?.length, ttl: [pm.first?.ttlMs, pm.second?.ttlMs] });
  ok('7', 'legacy: the same pages and cursor', pl.first?.tools?.length === W.PAGE && pl.first.nextCursor === pm.first?.nextCursor && same(joined(pl), after), { first: pl.first?.tools?.length, cursor: pl.first?.nextCursor });
  const bogus = ph.bogus = await caught(() => E.auto.c.listTools({ cursor: 'nope' }));
  ok('7', 'a made-up cursor is -32602', bogus.error?.code === -32602, bogus);
  // A title changed: the same count, another list; the cursor from before names the old one.
  const last = MODS.at(-1), retitled = { ...last, hash: `${last.hash}-2`, manifest: { ...last.manifest, tools: last.manifest.tools.map((t) => ({ ...t, title: `${t.title} (renamed)` })) } };
  await change('retitled', { [`mod:${last.id}`]: retitled }, total);
  const stale = ph.stale = await caught(() => E.auto.c.listTools({ cursor: pm.first?.nextCursor }));
  ok('7', 'a cursor from the list before the change is -32602', stale.error?.code === -32602, stale);
  await change('off', { [`mod:${last.id}`]: { ...retitled, enabled: false } }, total - last.manifest.tools.length);

  // S4: the longest name a mod tool can have, through the SDK.
  const longest = `mod_${MODS[0].id}_${LONGEST}`;
  const pending = caught(() => E.auto.c.callTool({ name: longest, arguments: { account: ACCOUNT } }));
  const s = ph.grant = await decide(CLIENT.name, 'grant-mod');
  ok('7', 'calling a mod\'s tool asks for that mod in the approval window', s?.title === `${CLIENT.name} wants to use the mod ${MODS[0].manifest.name}`, s);
  const r = ph.longest = await pending;
  const items = MT.apply(MODS[0].manifest.tools[0], (await want('todo_list')).items, {}, Date.now());
  const listed = (await E.auto.c.listTools()).tools.map((t) => t.name);
  R.s4 = { longest, length: longest.length, rule: 'mod_<id16>_<local ≤ 24>', longestListed: Math.max(...listed.map((n) => n.length)), firstParty: Math.max(...BASE.map((n) => n.length)), names: listed };
  ok('7', `the longest mod tool name (${longest.length} characters) is listed and called once granted`, longest.length === 45 && listed.includes(longest) && r.value?.isError !== true && same(r.value?.structuredContent?.items, items) && mirrored(r.value), { got: r.value?.structuredContent ?? r.error, want: items });
}

// 8 (S3): pairing asks nobody answers in time, in the SDK's ways of waiting.
async function timeouts() {
  const ph = R.s3 = { sdkDefaultMs: sdk.DEFAULT_REQUEST_TIMEOUT_MSEC, tickMs: A.TICK, limitMs: A.TIMEOUT, says: A.SAYS, legs: {} };
  const legs = [
    ['defaults', { mode: 'auto' }, {}],
    ['progress', { mode: 'auto' }, { progress: true }],
    ['reset', { mode: 'auto' }, { progress: true, resetTimeoutOnProgress: true }, 75e3],
    ...(FULL ? [['limit', {}, { progress: true, resetTimeoutOnProgress: true }]] : []),
  ];
  const runs = [];
  for (const [leg, o, opts, allowAt] of legs) {
    const name = `C17 wait ${leg}`, x = await client(`s3-${leg}`, { name, ...o });
    const g = ph.legs[leg] = { era: x.c.getProtocolEra(), options: opts, progress: [] };
    const at = Date.now();
    const p = caught(() => x.c.callTool({ name: 'todo_list', arguments: { account: ACCOUNT } }, {
      ...(opts.progress && { onprogress: (n) => g.progress.push({ ms: Date.now() - at, progress: n.progress, message: n.message }) }),
      ...(opts.resetTimeoutOnProgress && { resetTimeoutOnProgress: true }),
    })).then((r) => { g.ms = Date.now() - at; g.outcome = r.value ? { isError: r.value.isError === true, text: textOf(r.value) } : { error: r.error }; return r; });
    runs.push({ leg, name, x, at, allowAt, p });
    await until(() => askOf(name), 10000);
    await sleep(300); // the queue's order is the order asked
  }
  save();
  const reset = runs.find((r) => r.leg === 'reset');
  await until(() => Date.now() - reset.at >= reset.allowAt, reset.allowAt + 5000, 500);
  ph.legs.reset.window = await decide(reset.name, 's3-reset', 'yes', 30000);
  ph.legs.reset.allowedMs = Date.now() - reset.at;
  const open = new Map();
  await Promise.all(runs.map((r) => r.p.then(async () => { await sleep(500); open.set(r.leg, !!windowPage()); })));
  const rows = (await config({ op: 'activity' })).rows || [];
  for (const r of runs) {
    const g = ph.legs[r.leg], app = await G.appId({ exe: NODE }, r.name);
    g.ask = await askOf(r.name);
    g.activity = rows.filter((x) => x.app === app && x.at >= r.at);
    g.windowOpenAfter = open.get(r.leg);
    g.cancelled = sent(r.x, 'notifications/cancelled')[0]?.m?.params ?? null;
    g.progressMs = g.progress.map((x) => x.ms);
  }
  const L = ph.legs, near = (ms, t, slack = 3000) => ms >= t && ms < t + slack;
  // calls.js counts its progress 1, 2, 3…, rising; the window's waiting ticks every TICK (a refresh after Allow says its own).
  const ticks = (g) => { const w = g.progress.filter((x) => x.message === A.SAYS); return w.length > 0 && g.progress.every((x, i) => x.progress === i + 1) && w.every((x, i) => Math.abs(x.ms - (i + 1) * A.TICK) < 2000); };
  ok('8', `the SDK's defaults: no progress asked, the call times out at ${ph.sdkDefaultMs / 1000} s and cancels it; the window's ask ends cancelled`, near(L.defaults.ms, ph.sdkDefaultMs) && L.defaults.outcome.error?.code === 'REQUEST_TIMEOUT'
    && !L.defaults.progress.length && !!L.defaults.cancelled && L.defaults.ask?.state === 'cancelled' && same(L.defaults.activity.map((x) => x.outcome), ['cancelled']), L.defaults);
  ok('8', `onprogress alone: Glaze's ${A.TICK / 1000} s progress arrives, the call still times out at ${ph.sdkDefaultMs / 1000} s`, near(L.progress.ms, ph.sdkDefaultMs) && L.progress.outcome.error?.code === 'REQUEST_TIMEOUT'
    && L.progress.progress.length >= Math.floor((ph.sdkDefaultMs - 1) / A.TICK) && ticks(L.progress) && L.progress.ask?.state === 'cancelled' && same(L.progress.activity.map((x) => x.outcome), ['cancelled']), L.progress);
  ok('8', 'resetTimeoutOnProgress: the progress keeps the call alive past the default, and Allow at 75 s answers it', L.reset.ms > ph.sdkDefaultMs && L.reset.outcome.isError === false && ticks(L.reset)
    && L.reset.ask?.state === 'yes' && !L.reset.cancelled && same(L.reset.activity.map((x) => x.outcome), ['ok']), L.reset);
  if (L.limit) {
    ok('8', `the ${A.TIMEOUT / 1000} s limit (legacy era, progress resetting): Glaze answers that the student didn't answer in time, and nothing ran`, near(L.limit.ms, A.TIMEOUT, 5000) && L.limit.outcome.isError === true
      && /didn't answer in Glaze in time/.test(L.limit.outcome.text) && ticks(L.limit) && L.limit.progress.length >= A.TIMEOUT / A.TICK - 1 && L.limit.ask?.state === 'timeout' && !L.limit.cancelled
      && same(L.limit.activity.map((x) => x.outcome), ['timeout']) && L.limit.windowOpenAfter === false, { ...L.limit, progress: L.limit.progress.length });
  }
  for (const r of runs) { await r.x.c.close(); clients.delete(r.x.c); }
}

// 9: agent access off.
async function off() {
  const ph = R.phases.off = {};
  const sub = E.auto.c.autoOpenedSubscription, listen = sent(E.auto, 'subscriptions/listen')[0]?.m;
  const closes = ERAS.map((k) => new Promise((r) => { const was = E[k].c.onclose; E[k].c.onclose = () => { was?.(); r(Date.now()); }; }));
  const pid = hosts()[0]?.rec.pid, at = Date.now();
  ph.set = await config({ op: 'set', on: false });
  ph.subscription = await Promise.race([sub?.closed, sleep(5000).then(() => 'no end')]);
  const end = listen && answerTo(E.auto, listen.id)?.m;
  ok('9', 'off: the subscription is answered complete under its id; the SDK reads a graceful end', ph.subscription === 'graceful' && end?.result?.resultType === 'complete' && end.result._meta?.[SUB] === listen.id, { how: ph.subscription, end });
  const told = listen && await until(() => heardOn(E.auto, 'notifications/cancelled').find((e) => e.m.params?.requestId === listen.id)?.m, 2000);
  ok('9', 'then notifications/cancelled names it, as the spec requires of a server ending a subscription', !!told, told);
  ph.closed = await Promise.race([Promise.all(closes), sleep(8000).then(() => null)]);
  ok('9', 'every agent is let go', !!ph.closed, ph.closed && ph.closed.map((t) => t - at));
  ok('9', 'and the host exits', !!await until(() => pid && !RV.alive(pid) && !hosts().length, 5000), { pid });
}

const guard = async (name, fn) => { if (interrupted) return; await fn().catch((e) => { say(`ERROR in ${name}:`, e.stack || String(e)); R.errors = { ...R.errors, [name]: String(e.stack || e) }; }); save(); };

const lock = require('./check-env.js').lockPath();
let held = false, cleaning;
const cleanup = () => cleaning ||= (async () => {
  try {
    for (const c of clients) await c.close().catch(() => {});
    clients.clear();
    for (const c of contexts) await c.close().catch((e) => { R.errors = { ...R.errors, close: String(e) }; });
    contexts.clear();
    if (HOME) {
      const left = await until(() => !hosts().length, 5000) ? [] : hosts().map((e) => e.rec.pid);
      for (const pid of left) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
      ok('cleanup', 'no helper outlives the browser', !left.length, left);
    }
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  } finally {
    if (held) { fs.rmSync(lock, { recursive: true, force: true }); held = false; }
  }
})();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = signal; R.errors = { ...R.errors, interrupted: signal }; cleanup().finally(() => { save(); process.exit(signal === 'SIGINT' ? 130 : 143); }); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    while (!held) {
      if (interrupted) throw Error(interrupted);
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await sleep(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmcp-conformance-check\n`);
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-c17-')));
    HOME = path.join(scratch, 'home');
    fs.mkdirSync(HOME);
    try { sdk = install(path.join(scratch, 'sdk')); } catch (e) { ok('0', `${SDK} installs and every package matches its pinned integrity`, false, String(e.stderr || e.message || e)); throw e; }
    ok('0', `${SDK} installs and every package matches its pinned integrity`, sdk.verified.length === NPM.parsePins(PINS).size, sdk.verified);
    try { R.chrome = execFileSync(require('./check-env.js').chromePath() || chromium.executablePath(), ['--version'], { encoding: 'utf8' }).trim(); } catch (e) { R.chrome = String(e); }
    R.platform = `${os.platform()} ${os.release()}`;
    say('chrome', R.chrome, 'sdk', SDK, FULL ? 'FULL: with the 600 s wait' : '');
    STORE = { todoCache: await C.canvasPlan('5', PLAN), seenCourses: await C.canvasSeen(SEEN) };
    await guard('start', start);
    if (!R.errors?.start) {
      await guard('eras', eras);
      if (!R.errors?.eras) {
        await guard('lists', lists);
        await guard('pairing', pairing);
        await guard('errors', errors);
        await guard('cancel', cancel);
        await guard('changes', changes);
        await guard('timeouts', timeouts);
        await guard('off', off);
      }
    }
  } finally {
    await cleanup();
    const failed = R.checks.filter((c) => !c.pass);
    R.summary = { checks: R.checks.length, failed: failed.length, errors: Object.keys(R.errors || {}) };
    say(failed.length || R.errors ? `FAILED ${failed.length} of ${R.checks.length}${R.errors ? `, errors in ${Object.keys(R.errors).join(', ')}` : ''}` : `all ${R.checks.length} checks pass`, 'evidence in', OUT);
    save();
    process.exitCode = interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : failed.length || R.errors || !R.checks.length ? 1 : 0;
  }
})().catch((e) => { R.errors = { ...R.errors, main: String(e.stack || e) }; save(); console.error(e); process.exit(interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : 1); });
