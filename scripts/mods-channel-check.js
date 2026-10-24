// The Mods tab against a disposable local relay: publish, follow, Check now, permission growth and Stop following.
// The folder picker has a stand-in handle, as in mods-section-check.js. One isolated profile holds author and follower.
// NODE_PATH=/path/to/node_modules nice -n 10 node scripts/mods-channel-check.js
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const ext = require('./check-env.js').staged(path.join(__dirname, '..'), ['http://127.0.0.1/*']);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok) => { assert.ok(ok, name); console.log(`ok  ${name}`); };
const until = async (name, fn) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80); }
  throw Error(`timed out: ${name}`);
};

(async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mods-channel-')));
  let context, relay, watchdog, cleaning;
  const cleanup = () => (cleaning ||= (async () => {
    clearTimeout(watchdog);
    await context?.close().catch(() => {});
    if (relay?.pid && relay.exitCode === null && relay.signalCode === null) {
      const closed = once(relay, 'exit');
      relay.kill('SIGTERM');
      const kill = setTimeout(() => relay.kill('SIGKILL'), 5000);
      try { await closed; } finally { clearTimeout(kill); }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  })());
  try {
    // The CLI relay uses only these explicit local paths; no inherited bucket credentials or live relay settings.
    const reserve = net.createServer();
    await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const server = `http://127.0.0.1:${port}`;
    relay = spawn(process.execPath, [path.join(ext, 'server/relay.js')], { cwd: tmp,
      env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port), DB: path.join(tmp, 'share.db'), BLOBS: path.join(tmp, 'blobs') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false, relayError = '';
    relay.stdout.on('data', (b) => { if (String(b).includes(`127.0.0.1:${port}`)) ready = true; });
    relay.stderr.on('data', (b) => { relayError += String(b); });
    relay.on('error', (e) => { relayError = e.message; });
    await until('local relay startup', async () => {
      if (relay.exitCode !== null || relay.signalCode !== null) throw Error(`local relay stopped: ${relayError.slice(0, 300)}`);
      return ready;
    });
    watchdog = setTimeout(() => { console.error('FAIL timed out after 180 s'); cleanup().finally(() => process.exit(1)); }, 180000);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...chromeLaunch, headless: true, locale: 'en-US', viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--disable-component-update', '--no-proxy-server',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--renderer-process-limit=2'] });
    context.setDefaultTimeout(10000);
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extension = new URL(sw.url()).host;
    await sw.evaluate(async (server) => {
      await chrome.storage.sync.set({ shareRelay: server, mods: { blocklist: false } });
      const original = globalThis.fetch;
      globalThis.channelRequests = [];
      globalThis.fetch = (url, init) => {
        if (new URL(url).origin !== server) return Promise.reject(Error('only the local relay is allowed'));
        channelRequests.push({ method: init?.method || 'GET', credentials: init?.credentials, referrerPolicy: init?.referrerPolicy, redirect: init?.redirect });
        return original(url, init);
      };
    }, server);
    const editor = await context.newPage(), errors = [];
    editor.on('pageerror', (e) => errors.push(e.message));
    editor.on('dialog', (d) => d.accept());
    await editor.goto(`chrome-extension://${extension}/options.html#mods/dev`);
    const local = (keys) => editor.evaluate((k) => chrome.storage.local.get(k), keys);
    const record = async (id) => (await local(`mod:${id}`))[`mod:${id}`];
    const open = () => editor.evaluate(() => document.getElementById('mod-prompt').open);
    const route = (section) => editor.evaluate((s) => { location.hash = `mods/${s}`; }, section);
    await editor.check('#mod-dev');
    await editor.click('#mod-key-make');
    await until('author key', async () => !!(await local('modAuthor')).modAuthor);
    const load = async (version, permissions = []) => {
      await route('dev');
      await editor.evaluate(({ version, permissions }) => {
        const texts = { 'mod.json': JSON.stringify({ glaze: 1, name: 'Channel Timer', version, author: { name: 'Local Author' }, hooks: 'hooks.js', permissions }), 'hooks.js': 'glaze.ready;\n' };
        window.showDirectoryPicker = async () => ({ kind: 'directory', entries: async function* () {
          for (const [name, text] of Object.entries(texts)) yield [name, { kind: 'file', getFile: async () => new File([text], name) }];
        } });
        document.getElementById('mod-folder').disabled = false;
      }, { version, permissions });
      await editor.click('#mod-folder');
      await until('folder loaded', async () => !await editor.isDisabled('#mod-publish'));
      // The Dev install is unrelated to publishing; keep the signed follower record as the installed copy.
      await until('folder offered', async () => await open() || !!await editor.innerText('#mod-folder-said'));
      if (await open()) await editor.click('#mod-prompt-cancel');
    };
    const publish = async (version) => {
      await editor.click('#mod-publish');
      return until('publication saved', async () => {
        const all = await local(null), own = Object.entries(all).find(([k, v]) => k.startsWith('modChannelOwn:') && v.version === version);
        return own && { id: own[0].slice('modChannelOwn:'.length), ...own[1] };
      });
    };
    await load('1.0.0');
    const first = await publish('1.0.0'), id = first.id;
    check('publishing from the Mods tab returns a read link on the local relay', first.link.startsWith(`${server}/j#1.r.`));
    check('publishing alone does not install a mod', !await record(id));
    await route('add');
    await editor.fill('#mod-code', first.link);
    await editor.click('#mod-code-read');
    await until('channel install prompt', open);
    check('the install prompt names the update relay', (await editor.innerText('#mod-prompt')).includes(`Updates are checked at 127.0.0.1:${port} about once a day`));
    check('following waits for Install', !await record(id));
    await editor.click('#mod-prompt-install');
    await until('followed install', async () => (await record(id))?.version === '1.0.0');
    check('the follower record keeps only the read link', (await record(id)).channel === first.link);
    check('the followed card names the update relay', (await editor.innerText('#mods-list')).includes(`Updates are checked at 127.0.0.1:${port} about once a day`));
    await load('1.1.0');
    const second = await publish('1.1.0');
    check('a newer publication keeps the same channel', second.link === first.link);
    await until('old file cleanup', async () => (await fetch(`${server}/s/${first.st.sid}/b/${first.ref.id}`)).status === 404);
    check('publishing a newer bundle removes the old file', true);
    await route('installed');
    await editor.click(`[data-f="${id}:check"]`);
    await until('quiet channel update', async () => (await record(id))?.version === '1.1.0');
    check('Check now installs the signed update without prompting', !await open());
    await load('1.2.0', [{ id: 'todo', why: 'Counts what is due.' }]);
    await publish('1.2.0');
    await route('installed');
    await editor.click(`[data-f="${id}:check"]`);
    await until('permission growth pending', async () => (await local(`modChannel:${id}`))[`modChannel:${id}`]?.pending?.version === '1.2.0');
    check('permission growth leaves the installed version and grants unchanged', (await record(id)).version === '1.1.0' && !(await record(id)).grants.todo && !await open());
    await editor.click(`[data-f="${id}:review"]`);
    await until('permission update prompt', open);
    check('Review update marks the new permission', /New/.test(await editor.innerText('#mod-prompt-perms')) && /To Do/.test(await editor.innerText('#mod-prompt-perms')));
    await editor.click('#mod-prompt-install');
    await until('approved update', async () => (await record(id))?.version === '1.2.0');
    check('only the approved update gains its permission', (await record(id)).grants.todo === true);
    await editor.click(`[data-f="${id}:unfollow"]`);
    await until('stopped following', async () => !(await record(id)).channel);
    check('Stop following clears the check state', !(await local(`modChannel:${id}`))[`modChannel:${id}`]);
    const requests = await sw.evaluate(() => channelRequests);
    check('relay traffic sends no cookies or referrer and refuses redirects', requests.length > 0 && requests.every((r) => r.credentials === 'omit' && r.referrerPolicy === 'no-referrer' && r.redirect === 'error'));
    check('the editor has no page errors', errors.length === 0);
    console.log('all passed');
  } catch (e) { console.error(`FAIL ${e.stack || e}`); process.exitCode = 1; }
  finally { await cleanup(); }
})();
