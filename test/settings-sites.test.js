// Settings → Backup and privacy → Sites (options.js): adding a school's site the first screen's way (lib/site.js allow), and
// Remove handing the browser's grant back (lib/site.js handBack). Options.js's Sites block runs here on stand-in elements
// with a stubbed chrome and lib/site.js whose checks answer as each test says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const I = require('../lib/i18n.js');
const NARROW = ['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*', 'https://frostdev.io/*', 'https://share.frostdev.io/*'];
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

const mk = (tag = 'div') => ({
  tagName: tag.toUpperCase(), children: [], textContent: '', value: '', hidden: false, readOnly: false, attrs: {}, on: {}, className: '',
  append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; },
  setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; },
  addEventListener(t, f) { this.on[t] = f; }, focus() { this.focused = true; },
});
const IDS = ['#site-list', '#site-empty', '#site-status', '#heading-backup-sites', '#site-add', '#site-address', '#site-allow', '#site-note', '#site-error', '#site-picks'];

const sites = ({ lists = {}, hosts = NARROW, held = [], granted = true, found = { kind: 'canvas', url: 'https://canvas.school.edu/' }, near = [], yes = { ok: true } } = {}) => {
  const nodes = Object.fromEntries(IDS.map((id) => [id, mk()])), calls = [], has = new Set(held), store = structuredClone(lists);
  let gesture = false;
  const chrome = {
    storage: { local: { get: (k, cb) => cb(structuredClone(store)) } },
    runtime: {
      getManifest: () => ({ host_permissions: hosts }),
      sendMessage: async (m) => {
        calls.push(['send', m.type, m.op, m]);
        if (m.type === 'glaze:allow' && m.op === 'yes') { if (yes.ok) store[m.kind] = [...store[m.kind] || [], m.kind === 'ultra' ? m.origin : `${m.origin}/*`]; return yes; }
        return { ok: true };
      },
    },
    permissions: {
      request: ({ origins }) => { calls.push(['request', [...origins], gesture]); if (granted) origins.forEach((o) => has.add(o)); return Promise.resolve(granted); },
      getAll: async () => ({ origins: [...has] }),
      remove: async ({ origins }) => { calls.push(['remove', [...origins]]); origins.forEach((o) => has.delete(o)); return true; },
    },
  };
  const ctx = vm.createContext({ URL, Object, Array, Set, Map, Promise, AbortSignal, document: { createElement: mk }, $: (s) => nodes[s], chrome,
    t: (k, v) => I.t(k, v, 'en'), GZ_BUILT_IN: require('../defaults.js').GZ_BUILT_IN });
  vm.runInContext(read('lib/site.js'), ctx);
  Object.assign(ctx.GZ_SITE, { probe: async () => found, nearby: async () => near });
  const src = read('options.js');
  const block = src.slice(src.indexOf('  // ---- Sites:'), src.indexOf('\n', src.indexOf('  const readSites')));
  vm.runInContext(`${block}; this.readSites = readSites;`, ctx);
  ctx.readSites();
  const gestured = (fn) => { gesture = true; try { fn(); } finally { gesture = false; } };
  return {
    nodes, calls, has, store, ctx,
    ops: () => calls.map(([k, , op]) => (k === 'send' ? op : k)),
    add: (value) => { nodes['#site-address'].value = value; gestured(() => nodes['#site-add'].on.submit({ isTrusted: true, preventDefault() {} })); },
    pick: (i) => gestured(() => nodes['#site-picks'].children[i].on.click({ isTrusted: true })),
    rows: () => nodes['#site-list'].children.map((li) => [li.children[0].children[0].textContent, li.children[0].children[1].textContent]),
    refresh: () => ctx.readSites(),
  };
};

test('Settings add: a course site is allowed, checked, handed to the worker and listed with its LMS', async () => {
  const s = sites();
  s.add('https://canvas.school.edu/courses/12?x=1');
  assert.deepEqual(s.ops(), ['ask', 'request'], 'the request is made in the submit itself, after the worker hears');
  assert.deepEqual(s.calls[1].slice(1), [['https://canvas.school.edu/*'], true]);
  assert.equal(s.nodes['#site-address'].readOnly, true, 'the field holds while the browser asks');
  await tick();
  assert.deepEqual(s.ops(), ['ask', 'request', 'yes']);
  s.refresh();
  assert.deepEqual(s.rows(), [['canvas.school.edu', 'Canvas']]);
  assert.equal(s.nodes['#site-status'].textContent, 'Allowed canvas.school.edu');
  assert.equal(s.nodes['#site-address'].value, '', 'the field is ready for another');
  assert.equal(s.nodes['#site-address'].readOnly, false);
  assert.equal(s.nodes['#site-note'].hidden, true);
});

test('Settings add: no course site there hands the grant back and offers the ones nearby, each allowed the same way', async () => {
  const s = sites({ found: 'none', near: ['bb.school.edu'] });
  s.add('www.school.edu');
  await tick();
  assert.deepEqual(s.ops(), ['ask', 'request', 'cancel', 'remove']);
  assert.deepEqual(s.calls.at(-1)[1], ['https://www.school.edu/*']);
  assert.equal(s.nodes['#site-note'].hidden, false);
  assert.equal(s.nodes['#site-error'].textContent, 'No course site at www.school.edu');
  assert.deepEqual(s.nodes['#site-picks'].children.map((b) => b.textContent), ['bb.school.edu']);
  assert.equal(s.nodes['#site-picks'].children[0].attrs.translate, 'no');
  assert.ok(s.nodes['#site-picks'].children[0].focused, 'the first pick has focus');
  assert.deepEqual(s.rows(), []);
  s.calls.length = 0;
  s.ctx.GZ_SITE.probe = async () => ({ kind: 'ultra', url: 'https://bb.school.edu/' });
  s.pick(0);
  assert.deepEqual(s.calls.map(([k]) => k), ['send', 'request']);
  assert.deepEqual(s.calls[1].slice(1), [['https://bb.school.edu/*'], true], 'picking one asks for it, in the click');
  await tick();
  s.refresh();
  assert.deepEqual(s.rows(), [['bb.school.edu', 'Blackboard Ultra']]);
  assert.equal(s.nodes['#site-note'].hidden, true);
});

test('Settings add: a site that doesn\'t answer is turned down, its grant handed back', async () => {
  const s = sites({ found: 'unreachable' });
  s.add('bb.nowhere.edu');
  await tick();
  assert.deepEqual(s.ops(), ['ask', 'request', 'cancel', 'remove']);
  assert.equal(s.nodes['#site-error'].textContent, "Can't reach bb.nowhere.edu");
  assert.deepEqual(s.nodes['#site-picks'].children, []);
});

test('Settings add: refused, it is as it was, with nothing said', async () => {
  const s = sites({ granted: false });
  s.add('canvas.school.edu');
  await tick();
  assert.deepEqual(s.ops(), ['ask', 'request', 'cancel']);
  assert.equal(s.nodes['#site-note'].hidden, true);
  assert.equal(s.nodes['#site-status'].textContent, '');
  assert.equal(s.nodes['#site-address'].value, 'canvas.school.edu', 'what was typed stays');
  assert.equal(s.nodes['#site-address'].readOnly, false);
});

test('Settings add: the worker turning it down says so and keeps the field', async () => {
  const s = sites({ yes: { ok: false } });
  s.add('canvas.school.edu');
  await tick();
  assert.equal(s.nodes['#site-error'].textContent, "Can't reach canvas.school.edu");
  assert.equal(s.nodes['#site-address'].value, 'canvas.school.edu');
});

test('Settings add: what isn\'t an address asks nothing; a script\'s submit asks nothing; one add at a time', async () => {
  const s = sites();
  s.add('not a site');
  assert.deepEqual(s.calls, []);
  assert.equal(s.nodes['#site-error'].textContent, 'Not a web address');
  assert.equal(s.nodes['#site-note'].hidden, false);
  s.nodes['#site-address'].on.input?.();
  assert.equal(s.nodes['#site-note'].hidden, true, 'the error goes with the next key');
  s.nodes['#site-address'].value = 'canvas.school.edu';
  s.nodes['#site-add'].on.submit({ isTrusted: false, preventDefault() {} });
  assert.deepEqual(s.calls, [], 'a script\'s submit');
  s.add('canvas.school.edu');
  s.add('canvas.school.edu');
  assert.deepEqual(s.ops(), ['ask', 'request'], 'a second submit while asking does nothing');
});

test('Settings add: Safari\'s manifest holds every site, so there is nothing to add', () => {
  assert.equal(sites({ hosts: ['<all_urls>'] }).nodes['#site-add'].hidden, true);
  assert.equal(sites().nodes['#site-add'].hidden, false);
});

test('Settings remove: the worker forgets the site, then its grant goes back to the browser', async () => {
  const s = sites({ lists: { canvas: ['https://canvas.school.edu/*'] }, held: ['https://canvas.school.edu/*'] });
  await s.nodes['#site-list'].children[0].children[1].on.click({ isTrusted: true });
  assert.deepEqual(s.calls.map(([k]) => k), ['send', 'remove']);
  assert.deepEqual(s.calls[0].slice(1, 3), ['glaze:sites', 'remove']);
  assert.deepEqual(s.calls[1][1], ['https://canvas.school.edu/*']);
  assert.equal(s.nodes['#site-status'].textContent, 'Removed canvas.school.edu. Glaze no longer runs there.');
});

test('Settings remove: a required host, every site, or a site on another port keeps its grant', async () => {
  for (const [why, o] of [
    ['a host the manifest lists', { lists: { canvas: ['https://canvas.school.edu/*'] }, held: ['https://canvas.school.edu/*'], hosts: [...NARROW, 'https://canvas.school.edu/*'] }],
    ['every site held, and nothing else', { lists: { canvas: ['https://canvas.school.edu/*'] }, held: ['https://*/*'] }],
    ['another port of a host', { lists: { canvas: ['https://canvas.school.edu:8443/*'] }, held: ['https://canvas.school.edu/*'] }],
  ]) {
    const s = sites(o);
    await s.nodes['#site-list'].children[0].children[1].on.click({ isTrusted: true });
    assert.deepEqual(s.calls.map(([k]) => k), ['send'], why);
    assert.match(s.nodes['#site-status'].textContent, /^Removed /, why);
  }
});

test('Settings remove: the worker failing keeps the grant', async () => {
  const s = sites({ lists: { canvas: ['https://canvas.school.edu/*'] }, held: ['https://canvas.school.edu/*'] });
  s.ctx.chrome.runtime.sendMessage = async (m) => { s.calls.push(['send', m.type, m.op]); return { ok: false }; };
  await s.nodes['#site-list'].children[0].children[1].on.click({ isTrusted: true });
  assert.deepEqual(s.calls.map(([k]) => k), ['send']);
  assert.ok(s.has.has('https://canvas.school.edu/*'));
});

test('Settings: the add form sits in Sites, above the list, in the Backup panel that embedded Settings sends to its own tab', () => {
  const html = read('options.html');
  const panel = html.slice(html.indexOf('data-editor-panel="backup"'), html.indexOf('data-editor-panel="about"'));
  assert.match(panel, /<section id="sites"[\s\S]*?<form class="row site-add" id="site-add" novalidate autocomplete="off">[\s\S]*?<input id="site-address"[^>]*translate="no"[\s\S]*?<button type="submit" class="primary" id="site-allow">Allow<\/button>[\s\S]*?<\/form>[\s\S]*?id="site-note" role="alert" hidden[\s\S]*?id="site-picks"[\s\S]*?id="site-list"/);
  assert.match(panel, /<span>School address<\/span>/, 'the field is labelled');
  assert.ok(read('options.js').includes("['backup', 'Backup and privacy']"), 'embedded Settings gates the Backup panel to its own tab');
  assert.ok(html.indexOf('<script src="lib/site.js"></script>') > 0 && html.indexOf('<script src="lib/site.js"></script>') < html.indexOf('<script src="options.js"></script>'));
});


test('Settings add: retrying a listed site during an outage preserves its existing grant and list', async () => {
  const s = sites({ lists: { canvas: ['https://canvas.school.edu/*'] }, held: ['https://canvas.school.edu/*'], found: 'unreachable' });
  s.add('canvas.school.edu');
  await tick();
  assert.equal(s.nodes['#site-error'].textContent, "Can't reach canvas.school.edu");
  assert.ok(s.has.has('https://canvas.school.edu/*'));
  assert.ok(!s.ops().includes('remove'));
  s.refresh();
  assert.deepEqual(s.rows(), [['canvas.school.edu', 'Canvas']]);
});
