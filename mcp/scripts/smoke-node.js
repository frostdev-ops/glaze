// The helper on the Node running this, as a browser starts it: --version, then the host's hello both ways, its run file,
// and a bye that ends it with 0. CI runs it on Node 18.0.0, the oldest the package's engines allow.
//   node mcp/scripts/smoke-node.js
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const N = require('../lib/native.js');
const R = require('../lib/rendezvous.js');

const BIN = path.join(__dirname, '..', 'bin', 'glaze-mcp.js');
const ORIGIN = 'chrome-extension://jmmaeoajomodnbnlmdikjooalmcilooh/';
const fail = (why) => { console.error(`smoke on Node ${process.version}: ${why}`); process.exitCode = 1; };

const version = execFileSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' }).trim();
if (version !== require('../package.json').version) fail(`--version said ${version}`);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-smoke-'));
const env = { ...process.env, HOME: home, LOCALAPPDATA: home, XDG_RUNTIME_DIR: home };
const p = spawn(process.execPath, [BIN, 'host', '--browser=chrome', ORIGIN], { env, stdio: ['pipe', 'pipe', 'pipe'] });
let err = '', hello = null;
const timer = setTimeout(() => { fail(`no clean exit in 20 s; stderr: ${err}`); p.kill(); }, 20000);
p.stderr.on('data', (d) => {
  err += d;
  if (/ready for agents/.test(err) && !p.stdin.writableEnded) {
    const hosts = R.list(R.dir({ env })).filter((e) => e.alive && e.rec.browser === 'chrome' && e.rec.instance === 'smoke' && e.rec.pid === p.pid);
    if (hosts.length !== 1) fail('the host did not publish its run record');
    p.stdin.end(N.encode({ t: 'bye' }));
  }
});
p.stdout.on('data', N.reader((m) => {
  if (hello) return;
  hello = m;
  if (m.t !== 'hello' || m.node !== process.version) fail(`the host's first message: ${JSON.stringify(m)}`);
  // The worker's hello is the first message the host reads.
  p.stdin.write(N.encode({ t: 'hello', v: 1, glaze: version, instance: 'smoke' }));
}));
p.on('exit', (code) => {
  clearTimeout(timer);
  fs.rmSync(home, { recursive: true, force: true });
  if (code !== 0) fail(`host exited ${code}; stderr: ${err}`);
  else if (!hello) fail('the host never sent its native hello');
  else if (!/ready for agents/.test(err)) fail(`the host never opened its socket; stderr: ${err}`);
  else if (!process.exitCode) console.log(`glaze-mcp ${version} on Node ${process.version}: --version, hello both ways and bye`);
});
