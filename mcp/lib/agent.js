// glaze-mcp agent: what an agent app starts, speaking MCP lines on stdio. It waits for a host's run file (rendezvous.js),
// holding up to 1 MiB of stdin meanwhile (refusing more), takes the host --browser, --instance or GLAZE_MCP_BROWSER names (else the
// newest), proves the token (handshake.js) and then passes lines both ways as they came: only the worker's reach stdout,
// and everything it says goes to stderr. When the connection closes (a worker or browser restart, agent access off) it
// stays and tries again, only that first browser and instance, and session.js carries the app's MCP session over the
// gap. It exits 0 when stdin ends, and 1 only for a host that can't prove the token or refuses ours, an unsafe run
// folder, or a session Glaze won't take back. doctor() is glaze-mcp doctor's live check.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const R = require('./rendezvous.js');
const HS = require('./handshake.js');
const P = require('./peer.js');
const L = require('./lines.js');
const S = require('./session.js');

const VERSION = require('../package.json').version;
const POLL = 250, TICK = 250, GOING = 3000;
const USAGE = 'Usage: glaze-mcp [agent] [--browser <id>] [--instance <id>]\n';
const SETTINGS = 'In Glaze, turn on Settings → AI → Agents; if it says the helper is missing, run: npx glaze-mcp setup';
// Chromium on macOS and Linux reads a user's host manifests from its user data folder, so one started with another
// (--user-data-dir) finds none where setup writes them.
const DATA_DIR = 'A browser started with --user-data-dir reads helpers from <that folder>/NativeMessagingHosts, not the folders above; copy the manifest there';
// rendezvous.js never takes a lock back by its pid (that would race a new owner), so one left by a killed helper stays.
const LOCK = '.rendezvous.lock';
const LEFT = 'One that stays was left by a helper stopped while using it: with no browser or app using Glaze\'s helper, it is safe to delete';

const usage = (message) => Object.assign(new Error(message), { code: 'USAGE' });
const options = (args, env) => {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const m = /^--(browser|instance)(?:=(.*))?$/s.exec(args[i]);
    if (!m) throw usage(`unknown option ${args[i]}`);
    const v = m[2] !== undefined ? m[2] : args[++i];
    if (!v) throw usage(`--${m[1]} needs a value`);
    if (o[m[1]] !== undefined) throw usage(`--${m[1]} given twice`);
    if (!(m[1] === 'browser' ? R.BROWSER : R.INSTANCE).test(v)) throw usage(`not ${m[1] === 'browser' ? 'a browser' : 'an instance'} id: ${v}`);
    o[m[1]] = v;
  }
  if (!o.browser && env.GLAZE_MCP_BROWSER) {
    if (!R.BROWSER.test(env.GLAZE_MCP_BROWSER)) throw usage(`GLAZE_MCP_BROWSER is not a browser id: ${env.GLAZE_MCP_BROWSER}`);
    o.browser = env.GLAZE_MCP_BROWSER;
  }
  return o;
};
const named = (e) => `${e.rec.browser} (instance ${e.rec.instance})`;

const main = async ({ args = [], io = {} } = {}) => {
  const stdin = io.stdin || process.stdin, stdout = io.stdout || process.stdout, stderr = io.stderr || process.stderr;
  const platform = io.platform || process.platform, env = io.env || process.env;
  const exit = io.exit || ((code) => process.exit(code));
  let want, dir;
  try { want = options(args, env); } catch (e) { stderr.write(`glaze-mcp: ${e.message}\n${USAGE}`); return 2; }
  const log = (s) => stderr.write(`glaze-mcp: ${s}\n`);
  try { dir = R.dir({ platform, env }); } catch (e) { log(e.message); return 1; }
  // Who the app is, said once: a reconnect can't claim another app's grants.
  const peer = P.self({ platform, env });
  const session = S.create({ version: VERSION, nonce: crypto.randomBytes(12).toString('hex') });
  const now = () => Date.now();

  return new Promise((resolve) => {
    let sock = null, pending = null, ended = false, finished = false, timer = null, waiting = false, busy = false;
    // The browser and instance of the first connection: the only one tried after it.
    let target = null;
    let parts = [], partial = 0;
    const going = new Map(); // a host's token → when its socket first closed on the handshake
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(ticker);
      if (pending) pending.destroy();
      if (sock) sock.destroy();
      parts = [];
      stdin.pause();
      let gone = false;
      const go = () => { if (!gone) { gone = true; resolve(code); exit(code); } };
      if (!stdout.writableLength) return go();
      stdout.once('drain', go);
      setTimeout(go, 500).unref();
    };
    const apply = (r) => {
      if (finished) return;
      for (const l of r.app) if (!stdout.write(`${l}\n`) && sock) sock.pause();
      if (sock) for (const l of r.glaze) if (!sock.write(`${l}\n`)) stdin.pause();
      if (r.fatal) { log(r.fatal); finish(1); }
    };
    const ticker = setInterval(() => apply(session.tick(now())), TICK);

    stdin.on('data', (chunk) => {
      if (finished) return;
      let at = 0;
      for (let i; (i = chunk.indexOf(10, at)) >= 0; at = i + 1) {
        if (partial + i - at > L.LINE) {
          log(`a line over ${L.LINE} bytes; refusing input`);
          return finish(1);
        }
        parts.push(chunk.subarray(at, i));
        const text = Buffer.concat(parts).toString('utf8');
        parts = [];
        partial = 0;
        apply(session.fromApp(text, now()));
        if (finished) return;
      }
      if (at === chunk.length) return;
      parts.push(chunk.subarray(at));
      partial += chunk.length - at;
      // Keep reading so EOF remains observable. Refuse overflow rather than dropping part of an MCP request.
      if (!sock && session.held() + partial > S.HOLD) {
        log('more than 1 MiB of stdin before a host connected; refusing input');
        finish(1);
      } else if (partial > L.LINE) {
        log(`a line over ${L.LINE} bytes; refusing input`);
        finish(1);
      }
    });
    const eof = () => {
      if (ended || finished) return;
      ended = true;
      if (!sock) return finish(0);
      // What the app sent last still goes before the exit.
      sock.end(() => finish(0));
      setTimeout(() => finish(0), 1000).unref();
    };
    stdin.on('end', eof);
    stdin.on('close', eof);
    stdin.on('error', () => finish(0));
    stdout.on('error', () => finish(0));
    stdout.on('drain', () => { if (sock) sock.resume(); });

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(look, target ? session.delay(now()) : io.poll || POLL);
    };
    const pipe = (s, rest, chosen, others) => {
      sock = s;
      going.clear();
      if (target) log(`connected to Glaze in ${named(chosen)} again`);
      else {
        target = { browser: chosen.rec.browser, instance: chosen.rec.instance };
        log(`connected to Glaze in ${named(chosen)}`);
        if (others.length) log(`also open: ${others.map(named).join(', ')}; choose one with --browser or --instance`);
      }
      const cut = L.cutter((text) => { if (sock === s) apply(session.fromGlaze(text, now())); });
      const take = (c) => {
        try { cut(c); } catch (e) { if (e.code !== 'too-long') throw e; log(`Glaze sent ${e.message}`); s.destroy(); }
      };
      apply(session.up(now(), chosen.rec.browser));
      if (rest.length) take(rest);
      s.on('data', take);
      s.on('drain', () => { if (!ended) stdin.resume(); });
      s.on('error', () => {});
      s.on('close', () => {
        if (sock !== s) return;
        sock = null;
        if (ended || finished) return finish(0);
        log(`Glaze closed the connection; waiting for it in ${target.browser} (instance ${target.instance}) to come back`);
        apply(session.down(now()));
        stdin.resume();
        schedule();
      });
      s.resume();
      stdin.resume();
    };

    // One try at a host: connected, not now (a socket no one listens on, a host replaced or going; try again), or refused (exit).
    const attempt = async (e) => {
      let s;
      try {
        s = R.connect(e.rec.path);
        pending = s;
        s.on('error', () => {});
        const { rest } = await HS.offer(s, e.rec.token, peer);
        return { s, rest };
      } catch (err) {
        if (finished) return {};
        if (err.code === 'refused') return { refused: `the socket for ${named(e)} didn't prove its token` };
        if (err.code !== 'closed') return {};
        // A host replaced since its run file was read, or one shutting down, which closes before it removes its run file.
        let still;
        try { still = R.read(e.file, { platform }); } catch { return {}; }
        if (!still || still.token !== e.rec.token) return {};
        const first = going.get(e.rec.token) ?? now();
        going.set(e.rec.token, first);
        return now() - first < GOING ? {} : { refused: `the host for ${named(e)} refused this agent; its run file doesn't match it` };
      } finally {
        if (pending === s) pending = null;
      }
    };

    const look = async () => {
      if (finished || sock) return;
      let live = [];
      try {
        if (R.check(dir)) {
          R.sweep(dir);
          live = R.list(dir, { platform }).filter((e) => e.alive);
        }
        busy = false;
      } catch (e) {
        if (e.code !== 'EBUSY') { log(e.message); return finish(1); }
        // Another helper is changing the run folder: next time.
        if (!busy) log(`the run folder is busy (${path.join(dir, LOCK)}); trying again. ${LEFT}`);
        busy = true;
        return schedule();
      }
      const pin = target || want;
      const fit = live.filter((e) => (!pin.browser || e.rec.browser === pin.browser) && (!pin.instance || e.rec.instance === pin.instance));
      for (const e of fit) {
        const r = await attempt(e);
        if (finished) return r.s && r.s.destroy();
        if (r.s) return pipe(r.s, r.rest, e, live.filter((x) => x !== e));
        if (r.refused) { log(r.refused); return finish(1); }
      }
      if (!waiting && !target) {
        waiting = true;
        const which = want.browser || want.instance ? ` in ${[want.browser, want.instance && `instance ${want.instance}`].filter(Boolean).join(', ')}` : '';
        log(`waiting for Glaze${which}. ${SETTINGS}${live.length ? `. Open now: ${live.map(named).join(', ')}` : ''}`);
      }
      schedule();
    };
    look();
  });
};

// doctor's live check: each run file, and a probe handshake with each host that runs (the worker never sees it). It
// reads and connects, and makes and removes nothing.
const doctor = async (ctx = {}) => {
  const platform = ctx.platform || process.platform, env = ctx.env || process.env;
  const rows = [];
  const add = (level, what, detail) => rows.push({ level, what, detail });
  const hint = () => { if (platform !== 'win32') add('info', 'Hint', DATA_DIR); return rows; };
  let dir;
  try {
    dir = R.dir({ platform, env });
    if (!R.check(dir)) { add('warn', 'Live', `no browser has turned on agent access yet. ${SETTINGS}`); return hint(); }
  } catch (e) { add('fail', 'Live', e.message); return rows; }
  if (fs.existsSync(path.join(dir, LOCK))) add('warn', 'Lock', `${path.join(dir, LOCK)} is the run folder's lock, which a helper holds only for a moment. ${LEFT}.`);
  const all = R.list(dir, { platform });
  if (!all.length) { add('warn', 'Live', `no browser has agent access on now. ${SETTINGS}`); return hint(); }
  for (const e of all) {
    const what = `Live ${e.rec.browser} (${e.rec.instance})`;
    if (!e.alive) { add('warn', what, `its host (pid ${e.rec.pid}) has gone; the next host or agent clears it`); continue; }
    const s = R.connect(e.rec.path);
    s.on('error', () => {});
    try {
      await HS.offer(s, e.rec.token, P.self({ platform, env }), { probe: true, timeout: 2000 });
      s.destroy();
      add('ok', what, `host ${e.rec.pid} answered`);
    } catch (err) {
      add('fail', what, `host ${e.rec.pid} didn't answer (${err.code || err.message})`);
    }
  }
  return rows;
};

module.exports = { main, doctor };
