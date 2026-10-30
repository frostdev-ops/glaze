// Real MV3 worker/storage migration in disposable profiles; unit tests cover install/update dispatch.
// No LMS, account, server or external network.
// NODE_PATH=/path/to/node_modules nice -n 10 node scripts/motion-default-check.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js');
const lock = require('./check-env.js').lockPath();
let context, ext, tmp, held = false, checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; console.log(`ok ${label}`); };
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw Error('worker migration did not settle'); };

(async () => {
  try {
    for (let i = 0; !held; i++) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST' || i > 180) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmotion-default-check\n${new Date().toISOString()}\n`);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-motion-default-'));
    ext = env.staged(path.resolve(__dirname, '..'), []);
    for (const [name, motion, expected] of [
      ['subtle', { level: 'subtle', followSystem: true, enter: false, hover: true, transitions: false }, 'expressive'],
      ['off', { level: 'off', followSystem: false, enter: true, hover: true, transitions: true }, 'off'],
      ['legacy-off', { enter: false, hover: false, transitions: false, followSystem: true }, 'off'],
    ]) {
      await require('./wait-for-browser.js')();
      context = await chromium.launchPersistentContext(path.join(tmp, name), { ...require('./check-env.js').chromeLaunch(), headless: true,
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
      env.noFirstRun(context);
      await context.route('**/*', (r) => r.request().url().startsWith('chrome-extension:') ? r.continue() : r.abort());
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await until(() => worker.evaluate(async () => (await chrome.storage.sync.get('motionExpressiveMigrated')).motionExpressiveMigrated === true));
      ok(await worker.evaluate(() => GZ_DEFAULTS.motion.level === 'expressive' && GZ_DEFAULTS.motion.followSystem === true), `${name}: fresh defaults are Expressive with reduced motion respected`);
      await worker.evaluate(async (motion) => { await chrome.storage.sync.set({ motion }); await chrome.storage.sync.remove('motionExpressiveMigrated'); }, motion);
      await worker.evaluate(() => motionExpressive());
      const state = await worker.evaluate(() => chrome.storage.sync.get(['motion', 'motionExpressiveMigrated']));
      ok(state.motionExpressiveMigrated === true, `${name}: the real worker commits its migration marker`);
      assert.deepEqual(state.motion, { ...motion, level: expected });
      ok(true, `${name}: migration preserves switches and sets ${expected}`);
      if (name === 'subtle') {
        await worker.evaluate(async () => { const { motion } = await chrome.storage.sync.get('motion'); await chrome.storage.sync.set({ motion: { ...motion, level: 'subtle' } }); await motionExpressive(); });
        ok(await worker.evaluate(async () => (await chrome.storage.sync.get('motion')).motion.level === 'subtle'), 'a later Subtle choice survives another migration pass');
      }
      await context.close(); context = null;
    }
    console.log(`${checks} unpacked-worker migration checks passed`);
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
