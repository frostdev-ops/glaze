// Pearson isn't a host Glaze holds from the start: Chrome disables an extension whose update adds a host warning, so the
// Pearson switches ask for its three hosts and the worker registers Pearson's scripts only while one is on and they're held.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const m = require('../../extension/manifest.json');
const HOSTS = ['https://mylab.pearson.com', 'https://tdx.acs.pearson.com', 'https://socket.pearsoned.com'];
const pearsonHost = (p) => HOSTS.some((h) => p.startsWith(`${h}/`));
// The registrations, as the manifest's Pearson entries had them.
const HOMEWORK = {
  id: 'gz-pearson',
  matches: ['https://mylab.pearson.com/Student/PlayerHomework.aspx*', 'https://mylab.pearson.com/Student/OverviewHomework.aspx*',
    'https://tdx.acs.pearson.com/assignment/assignmentplayer.aspx*', 'https://tdx.acs.pearson.com/Player/Player.aspx*'],
  css: ['content/motion.css', 'looks/page/surfaces.css', 'looks/page/lookx.css', 'vendor/mathlive/mathlive-static.css', 'content/pearson.css', 'pearson/embed.css'],
  js: ['core/color.js', 'core/i18n.js', 'core/motion.js', 'looks/fonts.js', 'looks/surfaces.js', 'content/defaults.js', 'core/ui.js', 'looks/lookx.js',
    'looks/lookparts.js', 'looks/motionx.js', 'pearson/adapter.js', 'content/pearson.js', 'pearson/embed.js', 'pearson/embedded.js'],
  runAt: 'document_start', allFrames: true, persistAcrossSessions: true,
};
const LAUNCH = { id: 'gz-pearson-launch', matches: ['https://socket.pearsoned.com/uiservice/opener*'], css: ['pearson/embed.css'],
  js: ['pearson/embed.js', 'pearson/launch.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true };

test('the manifest asks for no Pearson host and runs nothing on Pearson until a switch asks', () => {
  assert.deepEqual((m.host_permissions || []).filter(pearsonHost), []);
  assert.deepEqual(m.content_scripts.filter((c) => c.matches.some(pearsonHost)), []);
  assert.ok(m.optional_host_permissions.includes('https://*/*'), 'Pearson is asked for under the optional grant');
});

test('the Pearson switches start off, and the Pearson library names the hosts they ask for', () => {
  const e = require('../../extension/content/defaults.js').GZ_SANITIZE({}).enhance;
  assert.deepEqual([e.pearsonViewer, e.pearsonEmbed, e.pearsonMath], [false, false, false]);
  const l = vm.createContext({ URL });
  vm.runInContext(read('pearson/embed.js'), l);
  assert.deepEqual([...l.GZ_PEARSON_EMBED_LIB.hosts], HOSTS);
});

test('the worker registers Pearson\'s scripts only while a switch is on and all three hosts are held, and hands them back when all go off', async () => {
  const store = { sync: { enabled: true, enhance: { pearsonViewer: false, pearsonEmbed: false, pearsonMath: false } }, local: {} };
  const area = (s) => ({
    get: async (k) => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const changed = [], removed = [], revoked = [];
  let registered = new Map(), held = new Set();
  const context = vm.createContext({
    URL, console, TextEncoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    fetch: async () => { throw new TypeError('offline'); },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`background/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener: (f) => changed.push(f) } },
      permissions: {
        onRemoved: { addListener: (f) => revoked.push(f) },
        contains: async ({ origins }) => origins.every((o) => held.has(o) || m.host_permissions.includes(o)),
        getAll: async () => ({ origins: [...m.host_permissions, ...held] }),
        remove: async ({ origins }) => { for (const o of origins) { removed.push(o); held.delete(o); } return true; },
      },
      scripting: {
        getRegisteredContentScripts: async () => [...registered.values()].map((s) => structuredClone(s)),
        registerContentScripts: async (l) => { for (const s of l) registered.set(s.id, structuredClone(s)); },
        updateContentScripts: async (l) => { for (const s of l) registered.set(s.id, { ...registered.get(s.id), ...structuredClone(s) }); },
        unregisterContentScripts: async ({ ids }) => { for (const id of ids) registered.delete(id); },
      },
    },
  });
  vm.runInContext(read('background/background.js'), context);
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const set = async (next) => {
    const was = { enabled: store.sync.enabled, enhance: store.sync.enhance };
    Object.assign(store.sync, structuredClone(next));
    const changes = {};
    for (const k of Object.keys(next)) changes[k] = { oldValue: was[k], newValue: store.sync[k] };
    for (const f of changed) f(changes, 'sync');
    await settle();
  };
  const pearson = () => [...registered.values()].filter((s) => s.id.startsWith('gz-pearson')).sort((a, b) => a.id.localeCompare(b.id));
  const off = { pearsonViewer: false, pearsonEmbed: false, pearsonMath: false };

  await set({ enhance: { ...off, pearsonEmbed: true } });
  assert.deepEqual(pearson(), [], 'on without the grant: nothing on a host Glaze does not hold');
  assert.notEqual(store.local.pearsonAccess, true, 'open documents are told that this device has no access');
  held = new Set(HOSTS.slice(0, 2).map((h) => `${h}/*`));
  await set({ enhance: { ...off, pearsonEmbed: true } });
  assert.deepEqual(pearson(), [], 'two of the three hosts are not enough');
  held = new Set(HOSTS.map((h) => `${h}/*`));
  await set({ enhance: { ...off, pearsonEmbed: true } });
  assert.deepEqual(pearson(), [HOMEWORK, LAUNCH], 'held and on: the manifest\'s Pearson entries, registered');
  assert.equal(store.local.pearsonAccess, true);
  held.delete(`${HOSTS[1]}/*`);
  for (const f of revoked) f({ origins: [`${HOSTS[1]}/*`] });
  await settle();
  assert.deepEqual(pearson(), [], 'revoking any host unregisters both scripts');
  assert.equal(store.local.pearsonAccess, false, 'already injected documents must also lose access');
  held.add(`${HOSTS[1]}/*`);
  await set({ enhance: { ...off, pearsonEmbed: true } });
  await set({ enabled: false });
  assert.deepEqual(pearson(), [], 'Glaze off: unregistered');
  assert.deepEqual(removed, [], 'Glaze off keeps the grant for when it is on again');
  await set({ enabled: true });
  assert.deepEqual(pearson(), [HOMEWORK, LAUNCH], 'back when Glaze is on again');
  await set({ enhance: { ...off, pearsonMath: true } });
  assert.deepEqual(pearson(), [HOMEWORK, LAUNCH], 'any one switch keeps them');
  assert.deepEqual(removed, []);
  await set({ enhance: off });
  assert.deepEqual(pearson(), [], 'all three off: unregistered');
  assert.deepEqual(removed.sort(), HOSTS.map((h) => `${h}/*`).sort(), 'and the three hosts handed back');
});
