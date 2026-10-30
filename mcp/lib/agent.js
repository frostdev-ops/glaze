// glaze-mcp agent: what an agent app starts, speaking MCP lines on stdio. It waits for a host's run file (rendezvous.js),
// holding up to 1 MiB of stdin meanwhile (refusing more), takes the host --browser, --instance or GLAZE_MCP_BROWSER names (else the
// newest), proves the token (handshake.js) and then passes bytes both ways untouched: only the worker's lines reach
// stdout, and everything it says goes to stderr. It exits 1 when the host's socket closes (the app starts it again)
// and 0 when stdin ends. doctor() is glaze-mcp doctor's live check.
'use strict';
const R = require('./rendezvous.js');
const HS = require('./handshake.js');
const P = require('./peer.js');

const HOLD = 1024 * 1024, POLL = 250;
const USAGE = 'Usage: glaze-mcp [agent] [--browser <id>] [--instance <id>]\n';
const SETTINGS = 'In Glaze, turn on Settings → AI → Agents; if it says the helper is missing, run: npx glaze-mcp setup';

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

  return new Promise((resolve) => {
    let held = [], size = 0, sock = null, pending = null, ended = false, finished = false, timer = null, waiting = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (pending) pending.destroy();
      if (sock) sock.destroy();
      held = [];
      size = 0;
      stdin.pause();
      let gone = false;
      const go = () => { if (!gone) { gone = true; resolve(code); exit(code); } };
      if (!stdout.writableLength) return go();
      stdout.once('drain', go);
      setTimeout(go, 500).unref();
    };

    stdin.on('data', (chunk) => {
      if (finished) return;
      if (sock) { if (!sock.write(chunk)) stdin.pause(); return; }
      // Keep reading so EOF remains observable. Refuse overflow rather than dropping part of an MCP request.
      if (size + chunk.length > HOLD) {
        log('more than 1 MiB of stdin before a host connected; refusing input');
        return finish(1);
      }
      held.push(chunk);
      size += chunk.length;
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

    const pipe = (s, rest, chosen, others) => {
      sock = s;
      log(`connected to Glaze in ${named(chosen)}`);
      if (others.length) log(`also open: ${others.map(named).join(', ')}; choose one with --browser or --instance`);
      if (rest.length) stdout.write(rest);
      for (const c of held) s.write(c);
      held = [];
      size = 0;
      s.on('data', (c) => { if (!stdout.write(c)) s.pause(); });
      stdout.on('drain', () => s.resume());
      s.on('drain', () => { if (!ended) stdin.resume(); });
      s.on('error', () => {});
      s.on('close', () => {
        if (!ended) log('Glaze closed the connection');
        finish(ended ? 0 : 1);
      });
      s.resume();
      stdin.resume();
    };

    // One try at a host: connected, gone (a socket no one listens on; try another or wait), or refused (exit).
    const attempt = async (e) => {
      let s;
      try {
        s = R.connect(e.rec.path);
        pending = s;
        s.on('error', () => {});
        const { rest } = await HS.offer(s, e.rec.token, P.self({ platform, env }));
        return { s, rest };
      } catch (err) {
        if (finished) return {};
        if (err.code === 'refused') return { refused: `the socket for ${named(e)} didn't prove its token` };
        // A host replaced, or going, since its run file was read.
        const now = R.read(e.file, { platform });
        if (err.code === 'closed' && now && now.token === e.rec.token) return { refused: `the host for ${named(e)} refused this agent; its run file doesn't match it` };
        if (err.code === 'timeout') return { refused: `the host for ${named(e)} didn't answer` };
        return {};
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
      } catch (e) { log(e.message); return finish(1); }
      const fit = live.filter((e) => (!want.browser || e.rec.browser === want.browser) && (!want.instance || e.rec.instance === want.instance));
      for (const e of fit) {
        const r = await attempt(e);
        if (finished) return r.s && r.s.destroy();
        if (r.s) return pipe(r.s, r.rest, e, live.filter((x) => x !== e));
        if (r.refused) { log(r.refused); return finish(1); }
      }
      if (!waiting) {
        waiting = true;
        const which = want.browser || want.instance ? ` in ${[want.browser, want.instance && `instance ${want.instance}`].filter(Boolean).join(', ')}` : '';
        log(`waiting for Glaze${which}. ${SETTINGS}${live.length ? `. Open now: ${live.map(named).join(', ')}` : ''}`);
      }
      timer = setTimeout(look, io.poll || POLL);
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
  let dir;
  try {
    dir = R.dir({ platform, env });
    if (!R.check(dir)) { add('warn', 'Live', `no browser has turned on agent access yet. ${SETTINGS}`); return rows; }
  } catch (e) { add('fail', 'Live', e.message); return rows; }
  const all = R.list(dir, { platform });
  if (!all.length) add('warn', 'Live', `no browser has agent access on now. ${SETTINGS}`);
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
