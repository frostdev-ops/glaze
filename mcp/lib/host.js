// glaze-mcp host: what the browser starts over native messaging (native.js), one per Glaze worker with agent access on.
// It says hello first, and once the worker answers with its instance it opens the socket and run file (rendezvous.js)
// and lets in each agent that proves the token (handshake.js) as a numbered connection (mux.js). The worker's bye, or
// stdin ending, closes everything once the worker's last lines have gone, removes the socket and run file, and exits
// within a second.
//
// The server is never closed: libuv unlinks the name it bound on close, which may by then be a newer host's socket for
// the same browser and instance (or, bound by a relative name, a file in another folder). Exiting leaves it to us.
'use strict';
const net = require('node:net');
const F = require('./agent-frames.js');
const N = require('./native.js');
const R = require('./rendezvous.js');
const HS = require('./handshake.js');
const M = require('./mux.js');

const VERSION = require('../package.json').version;
const FIREFOX = 'glaze@frostdev.io';

const refuse = (stderr, why) => {
  stderr.write(`glaze-mcp host ${why}. The browser starts it; to set it up: npx glaze-mcp setup\n`);
  return 2;
};

// args: the launcher's --browser=<id>, if any, then exactly what the browser passed (bin/glaze-mcp.js `caller`).
const main = async ({ args = [], browser = null, caller = null, io = {} } = {}) => {
  const stdin = io.stdin || process.stdin, stdout = io.stdout || process.stdout, stderr = io.stderr || process.stderr;
  const platform = io.platform || process.platform, env = io.env || process.env;
  const exit = io.exit || ((code) => process.exit(code));
  if (stdin.isTTY) return refuse(stderr, 'is started by the browser, not from a terminal');
  const flags = args.filter((a) => a.startsWith('--browser='));
  const passed = args.filter((a) => !a.startsWith('--browser='));
  const from = require('../bin/glaze-mcp.js').caller(passed, platform);
  if (!caller || from !== caller || flags.length > 1 || (flags.length && args[0] !== flags[0])) return refuse(stderr, 'got arguments no browser passes');
  const id = browser || (from === FIREFOX ? 'firefox' : 'chromium');
  if (!R.BROWSER.test(id)) return refuse(stderr, `got a browser id it can't use: ${id}`);

  const log = (s) => stderr.write(`glaze-mcp host: ${s}\n`);
  let own = null, starting = null, started = false, done = false;
  const send = (f) => N.write(stdout, f);
  const mux = M.create({ send, pending: () => stdout.writableLength || 0 });

  const quit = (code) => {
    if (done) return;
    done = true;
    const flushed = mux.end();
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      if (own) R.remove(own.dir, own);
      exit(code);
    };
    const finish = () => flushed.then(() => {
      if (!stdout.writableLength) return go();
      stdout.once('drain', go);
    });
    setTimeout(go, 500).unref();
    // listen binds before its promise settles. Let start record the inode before exiting on a pipelined bye/EOF.
    if (starting) starting.then(finish, finish); else finish();
  };
  const fatal = (why) => {
    log(why);
    try { send({ t: 'error', why: String(why).slice(0, F.STR) }); } catch { /* the browser has gone */ }
    quit(1);
  };

  const admit = (s) => {
    s.on('error', () => {});
    if (done) return s.destroy();
    HS.accept(s, own.token).then(({ peer, probe }) => {
      if (done) return s.destroy();
      if (probe) return s.end();
      mux.open(s, peer);
    }, (e) => log(`refused a connection (${e.code})`));
  };

  const start = async (instance) => {
    const dir = R.ready(R.dir({ platform, env }));
    R.sweep(dir);
    const token = R.token(), p = R.socketPath(dir, id, instance);
    R.claim(p, { dir, browser: id, instance });
    const server = net.createServer({ pauseOnConnect: true }, admit);
    const ino = await R.listen(server, p);
    own = { dir, browser: id, instance, token, ino };
    if (done) return R.remove(dir, own);
    R.write(dir, { v: 1, pid: process.pid, path: p, token, browser: id, instance, at: Date.now() }, ino);
    log(`ready for agents (${id}, instance ${instance})`);
  };

  const onFrame = (f) => {
    if (done) return;
    if (!F.valid.toHost(f)) {
      if (!started) return fatal('the worker\'s first frame is not a hello this host can take');
      return log(`ignored a frame that isn't the worker's (${typeof f?.t === 'string' ? f.t.slice(0, 20) : typeof f})`);
    }
    if (f.t === 'bye') return quit(0);
    if (!started) {
      if (f.t !== 'hello' || !R.INSTANCE.test(f.instance)) return fatal('the worker\'s first frame is not a hello this host can take');
      started = true;
      starting = start(f.instance).catch((e) => { if (!done) fatal(e.message); });
      return;
    }
    if (f.t === 'line' || f.t === 'close') mux.frame(f);
  };

  stdout.on('drain', () => mux.release());
  stdout.on('error', () => quit(0));
  const push = N.reader(onFrame);
  stdin.on('data', (chunk) => {
    try { push(chunk); } catch (e) { log(e.message); quit(1); }
  });
  stdin.on('end', () => quit(0));
  stdin.on('error', () => quit(0));
  if (io.signals !== false) for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(sig, () => quit(0));
  process.once('exit', () => { if (own && !done) R.remove(own.dir, own); });
  send({ t: 'hello', v: 1, host: VERSION, os: platform, browser: id, node: process.version });
};

module.exports = { main };
