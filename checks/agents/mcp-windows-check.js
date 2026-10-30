// The agent helper (mcp/) on a real native-messaging host in Playwright's Chromium, as the Windows CI job runs it
// (.github/workflows/test.yml, mcp-windows):
//   1. a test extension with a fixed key, so its id is known, whose worker calls connectNative, answers the host's hello
//      and echoes each line frame back;
//   2. `glaze-mcp setup --browser chromium --extension-id <its id>`, for real: on Windows reg.exe writes the key below, on
//      macOS and Linux the manifest goes in Chromium's folder; `glaze-mcp doctor` passes;
//   3. the worker connects and the host says hello; `glaze-mcp agent` sends two lines and gets them back in order, and
//      doctor sees the live host;
//   4. the browser closes, the host exits, and `glaze-mcp uninstall` leaves no key and none of setup's files.
// Playwright's Chromium (Chrome for Testing) is Chromium-branded, so on Windows it reads HKCU\Software\Chromium\
// NativeMessagingHosts first and Google\Chrome's only when that has no host (chrome/browser/extensions/api/messaging/
// launch_context_win.cc, since Chromium 89). The check proves the Chromium key: Google\Chrome's is absent throughout,
// and Windows reads no manifest from the profile. Chromium runs a .bat host as %COMSPEC% /d /s /c ""<bat>" <args>".
// Files go to a scratch LOCALAPPDATA (HOME elsewhere), given to every process and the browser; the registry is the real
// HKCU, which setup and uninstall change only for keys pointing into the scratch folder. Windows requires CI=true/1
// or --allow-registry, even with --dry (which stops before the browser).
//   NODE_PATH=<playwright> node scripts/mcp-windows-check.js [evidence folder] [--dry]
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const B = require('../mcp/lib/browsers.js');
const R = require('../mcp/lib/rendezvous.js');

const BIN = path.join(__dirname, '..', 'mcp', 'bin', 'glaze-mcp.js');
const VERSION = require('../mcp/package.json').version;
const HOST = 'io.frostdev.glaze_mcp';
const WIN = process.platform === 'win32';
// The test extension's public key (no private key exists anywhere), and the id Chromium derives from it.
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwg6V59kbwSugyMQtni6v0phfh3fhoQ4H2ObTO6z5I2unB5HrIq3tmLrRbd4aUTWinhwEm4EtaDqQUk1Zi7XiUy38CkdBzDEgHBhvP56zKeb5V8FI5JIVO63To3L1PG+pHxolewxCCL5sgrqqVG7D+gSzM9oKPMOkNkvwFKHxum0ct9rzTLtwxwWrKwk1fcmd9DN60IfndPMVjxsfzH7MSpuBOSiAfIvzxBnLTUkM6ZrzfFgdo8nRbmVmezsVWoWu9njJsKz7G5W6LIqKgdgKQEYtcE9h13HqBGEhvpNgTsT9rJQknaK32o3W8G1g/9rvE2t7G9ZfxRWc44acKvWyXwIDAQAB';
const ID = 'meaciahlgdfilnbfbfameicmlhodilnb';
const KEYS = { chromium: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST}`, chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}` };
const LINES = ['{"jsonrpc":"2.0","id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":2,"method":"echo","params":{"text":"é😀 second"}}'];

const args = process.argv.slice(2), dry = args.includes('--dry');
if (WIN && !/^(true|1)$/i.test(process.env.CI || '') && !args.includes('--allow-registry')) {
  throw new Error('Refusing real HKCU changes: set CI=true on the runner or pass --allow-registry explicitly');
}
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-windows-out-')));
const log = [], results = { platform: process.platform, node: process.version, dry, id: ID, steps: [] };
const say = (s) => { log.push(`${new Date().toISOString()} ${s}`); console.log(s); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (label, fn, ms = 15000) => {
  for (const end = Date.now() + ms; ; await pause(100)) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${label}: timed out after ${ms} ms`);
  }
};
const must = (ok, message) => { if (!ok) throw new Error(message); };

// The test extension's worker, stringified into it: Node's constants don't reach it.
function echoWorker() {
  const S = globalThis.CHECK = { frames: [], sent: [], gone: null };
  S.connect = (instance) => {
    const port = chrome.runtime.connectNative('io.frostdev.glaze_mcp');
    const send = (f) => { S.sent.push(f); port.postMessage(f); };
    port.onMessage.addListener((f) => {
      S.frames.push(f);
      if (f.t === 'hello') send({ t: 'hello', v: 1, glaze: 'mcp-windows-check', instance });
      else if (f.t === 'line') send(f.m ? { t: 'line', c: f.c, d: f.d, m: 1 } : { t: 'line', c: f.c, d: f.d });
    });
    port.onDisconnect.addListener(() => { S.gone = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'disconnected'; });
    return true;
  };
}
const idOf = (key) => [...crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');

// reg.exe query, apart from the helper's own reg export: whether a key is there at all, and its default value.
const reg = (...a) => {
  try { return execFileSync(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { if (e.status === 1) return null; throw e; }
};
const exists = (key) => reg(key) !== null;
const value = (key) => { const m = /REG_SZ\s+(.*?)\r?$/m.exec(reg(key, '/ve') || ''); return m ? m[1] : null; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-check-')));
  // Every process gets the scratch profile folders, and no folder or browser choice from this shell.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(HOME|LOCALAPPDATA|APPDATA|XDG_[A-Z_]+|CHROME_CONFIG_HOME|GLAZE_MCP_BROWSER)$/i.test(k)));
  if (WIN) Object.assign(env, { LOCALAPPDATA: path.join(scratch, 'Local'), APPDATA: path.join(scratch, 'Roaming') });
  else env.HOME = path.join(scratch, 'home');
  const chromium = B.table(process.platform, env).find((b) => b.id === 'chromium');
  const { root, hosts } = B.folder(process.platform, env);
  const manifest = WIN ? path.join(hosts, 'chromium.json') : path.join(chromium.dir, `${HOST}.json`);
  const launcher = path.join(hosts, WIN ? 'chromium.bat' : 'chromium');
  const runDir = R.dir({ platform: process.platform, env });
  let context = null, agent = null, installed = false, held = null, failed = false;

  const cli = (...a) => {
    const r = spawnSync(process.execPath, [BIN, ...a], { env, encoding: 'utf8', windowsHide: true, timeout: 60e3 });
    say(`glaze-mcp ${a.join(' ')} → ${r.status}\n${r.stdout}${r.stderr}`.trimEnd());
    return r;
  };
  const step = async (name, fn) => {
    if (failed) return;
    try {
      const detail = await fn();
      results.steps.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
      say(`ok ${name}`);
    } catch (e) {
      failed = true;
      results.steps.push({ name, ok: false, error: e.message });
      say(`FAIL ${name}: ${e.stack}`);
    }
  };
  const gone = (f) => !fs.existsSync(f);

  try {
    await step('the extension\'s key gives the fixed id', () => must(idOf(KEY) === ID, `the key gives ${idOf(KEY)}, not ${ID}`));
    const ext = path.join(scratch, 'ext');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'glaze-mcp check', version: '1.0', key: KEY,
      permissions: ['nativeMessaging'], background: { service_worker: 'worker.js' } }, null, 2));
    fs.writeFileSync(path.join(ext, 'worker.js'), `(${echoWorker})();\n`);
    // Chromium's own folder: the browser's profile, and on Windows also what makes doctor count Chromium as installed.
    fs.mkdirSync(chromium.data, { recursive: true });

    if (WIN) await step('no Chromium or Google\\Chrome key before setup', () => must(!exists(KEYS.chromium) && !exists(KEYS.chrome), 'a glaze-mcp key is already there'));
    await step('glaze-mcp setup --browser chromium --extension-id <id>', () => {
      const r = cli('setup', '--browser', 'chromium', '--extension-id', ID);
      installed = true;
      must(r.status === 0, `setup exited ${r.status}`);
      must(/set up for Chromium/.test(r.stdout), 'setup didn\'t say Chromium');
    });
    await step(WIN ? 'reg.exe shows the Chromium key naming the manifest, and no Google\\Chrome key' : 'the manifest is in Chromium\'s NativeMessagingHosts folder', () => {
      if (WIN) {
        const v = value(KEYS.chromium);
        must(v && path.resolve(v).toLowerCase() === manifest.toLowerCase(), `${KEYS.chromium} is ${JSON.stringify(v)}, not ${manifest}`);
        must(!exists(KEYS.chrome), `${KEYS.chrome} exists`);
      }
      const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      must(m.name === HOST && m.type === 'stdio' && m.path === launcher, `manifest ${JSON.stringify(m)}`);
      must(m.allowed_origins.includes(`chrome-extension://${ID}/`), 'the manifest doesn\'t let the test extension in');
      must(fs.existsSync(launcher) && fs.existsSync(path.join(root, VERSION, 'bin', 'glaze-mcp.js')), 'no launcher or copy');
      return { manifest, launcher: fs.readFileSync(launcher, 'utf8') };
    });
    await step('glaze-mcp doctor passes and checks Chromium', () => {
      const r = cli('doctor');
      must(r.status === 0, `doctor exited ${r.status}`);
      must(/^ok {3}Chromium: /m.test(r.stdout), 'no ok row for Chromium');
    });

    if (!dry) {
      const { chromium: browser } = require('playwright');
      const { chromeLaunch, lockPath } = require('./check-env.js');
      held = lockPath();
      while (true) { try { fs.mkdirSync(held); break; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); } }
      fs.writeFileSync(path.join(held, 'owner'), `${process.pid}\nmcp-windows-check\n`);
      const instance = crypto.randomBytes(10).toString('hex');
      let worker = null, record = null;
      await step('Chromium loads the extension under its fixed id', async () => {
        await require('./wait-for-browser.js')();
        context = await browser.launchPersistentContext(chromium.data, { ...chromeLaunch(), headless: true, env,
          args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
        const mine = (w) => w.url().startsWith(`chrome-extension://${ID}/`);
        worker = context.serviceWorkers().find(mine) || await context.waitForEvent('serviceworker', { predicate: mine, timeout: 15000 });
        return { userAgent: await worker.evaluate(() => navigator.userAgent), executable: browser.executablePath() };
      });
      const state = () => worker.evaluate(() => ({ frames: CHECK.frames, sent: CHECK.sent, gone: CHECK.gone }));
      await step('the worker\'s native port starts the host, which says hello first', async () => {
        await worker.evaluate((i) => CHECK.connect(i), instance);
        const s = await until('the host\'s hello', async () => { const v = await state(); return (v.frames.length || v.gone) && v; });
        must(!s.gone, `the port closed: ${s.gone}`);
        const h = s.frames[0];
        must(h.t === 'hello' && h.v === 1 && h.host === VERSION && h.os === process.platform && h.browser === 'chromium', `first frame ${JSON.stringify(h)}`);
        record = await until('the host\'s run file', () => R.list(runDir).find((e) => e.alive && e.rec.instance === instance));
        return { hello: h, pid: record.rec.pid, pipe: record.rec.path };
      });
      await step('glaze-mcp agent sends two lines and gets each back, in order', async () => {
        agent = spawn(process.execPath, [BIN, 'agent', '--browser', 'chromium'], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        let out = '', err = '';
        agent.stdout.setEncoding('utf8').on('data', (c) => { out += c; });
        agent.stderr.setEncoding('utf8').on('data', (c) => { err += c; });
        agent.stdin.write(LINES.map((l) => `${l}\n`).join(''));
        await until('both lines back', () => out.split('\n').length > LINES.length);
        must(JSON.stringify(out.split('\n').slice(0, -1)) === JSON.stringify(LINES), `got ${JSON.stringify(out)}; stderr ${err}`);
        const s = await state();
        const open = s.frames.find((f) => f.t === 'open');
        must(open && open.c === 1, `no open frame: ${JSON.stringify(s.frames)}`);
        must(JSON.stringify(s.frames.filter((f) => f.t === 'line').map((f) => f.d)) === JSON.stringify(LINES), 'the worker got other lines');
        return { open, agentLog: err.trim() };
      });
      await step('glaze-mcp doctor sees the live host', () => {
        const r = cli('doctor');
        must(r.status === 0, `doctor exited ${r.status}`);
        must(new RegExp(`^ok {3}Live chromium \\(${instance}\\): host ${record.rec.pid} answered`, 'm').test(r.stdout), 'no ok row for the live host');
      });
      await step('the agent exits 0 when its app ends stdin, and the worker hears eof', async () => {
        const code = new Promise((r) => agent.once('exit', r));
        agent.stdin.end();
        must(await code === 0, 'the agent exited non-zero');
        agent = null;
        await until('the close frame', async () => (await state()).frames.some((f) => f.t === 'close' && f.c === 1 && f.why === 'eof'));
      });
      await step('closing the browser ends the host, which removes its run file', async () => {
        await context.close();
        context = null;
        await until('the host gone', () => !R.list(runDir).length && !R.alive(record.rec.pid), 10000);
        if (WIN) await pause(1000); // cmd.exe, which ran the launcher from the hosts folder, exits after the host
      });
    }

    await step('glaze-mcp uninstall leaves no key and none of setup\'s files', () => {
      const r = cli('uninstall');
      must(r.status === 0, `uninstall exited ${r.status}`);
      installed = false;
      if (WIN) must(!exists(KEYS.chromium) && !exists(KEYS.chrome), 'a glaze-mcp key is left, even an empty one');
      for (const f of [manifest, launcher, hosts, path.join(root, VERSION), path.join(root, '.glaze-mcp-ids.json')]) must(gone(f), `${f} is left`);
      // The run folder belongs to hosts, not setup; it may stay, and holds nothing once the host has gone.
      const left = fs.existsSync(root) ? fs.readdirSync(root) : [];
      must(left.every((n) => n === 'run') && (!fs.existsSync(runDir) || !fs.readdirSync(runDir).length), `left in ${root}: ${left.join(', ')}`);
    });
  } finally {
    if (agent) agent.kill();
    await context?.close().catch(() => {});
    if (installed) cli('uninstall');
    if (held) fs.rmSync(held, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
    fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    fs.writeFileSync(path.join(OUT, 'log.txt'), `${log.join('\n')}\n`);
  }
  const passed = results.steps.filter((s) => s.ok).length;
  console.log(`${passed}/${results.steps.length} agent helper checks passed${dry ? ' (dry: no browser)' : ''}; evidence in ${OUT}`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
