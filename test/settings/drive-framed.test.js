// Settings → Writer's Google Drive row (settings/options.js), in Settings framed in a school's page: the worker takes Connect,
// Disconnect and Sync from Settings' own tab only (platform/drive-frame.test.js), so a frame opens that tab at the Drive row
// through the worker (ownTabAt) and sends no Drive message. In the top frame the buttons are unchanged. The Drive block run on
// its own, with the page and the worker stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../extension/settings/options.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../../extension/options.html'), 'utf8');
const block = src.slice(src.indexOf('  // ---- Google Drive (background/google.js'), src.indexOf('  // Another surface changed something'));

const harness = ({ framed }) => {
  const sent = [], tabs = [], hints = [], els = {};
  const $ = (q) => (els[q] ||= { hidden: false, checked: false, textContent: '', handlers: {}, focus() {}, addEventListener(type, fn) { this.handlers[type] = fn; } });
  const click = (q) => els[q].handlers.click({ isTrusted: true, currentTarget: els[q] });
  const chrome = {
    runtime: {
      getURL: () => 'chrome-extension://x/',
      sendMessage: (m, cb) => {
        sent.push(m);
        const r = m.op === 'status' ? { ok: true, email: 'student@school.test', flow: 'chrome' } : { ok: true, email: 'student@school.test' };
        cb?.(r);
      },
    },
    permissions: { request: async () => true },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } },
  };
  class MutationObserver { observe() {} }
  const ctx = vm.createContext({ $, chrome, MutationObserver, t: (k) => k, hint: (m, bad) => hints.push([m, !!bad]), GZ_SITE: {},
    GZ_I18N: { locale: () => 'en', ui: () => 'en' }, ownTabAt: framed ? (hash) => tabs.push(hash) : null });
  vm.runInContext(block, ctx);
  return { sent, tabs, hints, els, click,
    // The messages that change Drive: everything but the account's read.
    changes: () => sent.filter((m) => !(m.type === 'glaze:google' && m.op === 'status')),
    ready: () => new Promise((r) => setImmediate(r)) };
};

const DRIVE_BUTTONS = ['#gdrive-connect', '#gdrive-disconnect'];

test('framed, Connect and Disconnect open Settings\' own tab at the Drive row and send no Drive message', async () => {
  for (const q of DRIVE_BUTTONS) {
    const h = harness({ framed: true });
    await h.ready();
    await h.click(q);
    assert.deepEqual(h.changes(), [], `${q}: nothing sent to the worker`);
    assert.deepEqual(h.tabs, ['#writer/papers'], `${q}: its own tab opens at the Drive row`);
    assert.deepEqual(h.hints, [], `${q}: no "didn't connect" hint`);
  }
});

test('framed, the Sync switch opens the own tab, goes back to how it was, and sends nothing', async () => {
  const h = harness({ framed: true });
  await h.ready();
  const box = h.els['#gdrive-sync-on'];
  box.checked = true; // the click has already turned it on
  await box.handlers.change({ currentTarget: box });
  assert.deepEqual(h.changes(), []);
  assert.deepEqual(h.tabs, ['#writer/papers']);
  assert.equal(box.checked, false, 'a refused switch is not left on');
  box.checked = false;
  await box.handlers.change({ currentTarget: box });
  assert.deepEqual(h.changes(), []);
  assert.deepEqual(h.tabs, ['#writer/papers', '#writer/papers']);
  assert.equal(box.checked, true, 'nor off, when it was on');
});

test('in the top frame Connect, Disconnect and Sync send their messages as before and open no tab', async () => {
  const h = harness({ framed: false });
  await h.ready();
  await h.click('#gdrive-connect');
  await h.click('#gdrive-disconnect');
  const box = h.els['#gdrive-sync-on'];
  box.checked = true;
  await box.handlers.change({ currentTarget: box });
  assert.deepEqual(h.changes().map((m) => `${m.type}:${m.op}${'on' in m ? `:${m.on}` : ''}`),
    ['glaze:google:connect', 'glaze:google:disconnect', 'glaze:driveSync:set:true']);
  assert.deepEqual(h.tabs, []);
});

test('the own-tab hash is one the worker takes and is the section that holds the Drive row', () => {
  assert.match('#writer/papers', /^#[a-z][a-z-]*(\/[a-z-]+)?$/);
  const section = html.match(/<section id="writer-papers" data-editor-section="writer\/papers"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(section.includes('id="gdrive"') && section.includes('id="gdrive-sync-on"'));
});
