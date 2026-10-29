// Open from Documents' sheet, over the house stand-in DOM. The browser check covers frame/window geometry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const PA = require('../lib/writer-papers.js'), ST = require('../lib/writer-styles.js'), I = require('../lib/i18n.js');
const source = fs.readFileSync(process.env.WRITER_PAPER_SOURCE || path.join(__dirname, '../writer-paper.js'), 'utf8');
const block = source.slice(source.indexOf('    let docsSheet'), source.indexOf('    // ---- what the page says'));
const keys = [PA.newKey(), PA.newKey()];
const rows = () => keys.map((key, i) => ({ key, kind: 'paper', title: i ? 'Other' : '<img src=x onerror=alert(1)>', format: 'plain', words: 3, updated: 1000 - i }));
const sheet = ({ list = async () => rows(), busy = false } = {}) => {
  const doc = { activeElement: null };
  doc.root = doc.documentElement = new El('html', doc); doc.root.lang = 'en';
  doc.body = new El('body', doc); doc.root.append(doc.body);
  const root = new El('main', doc), versionsB = new El('button', doc), prior = new El('aside', doc);
  root.inert = false; prior.inert = true; root.append(versionsB); doc.body.append(root, prior);
  const h = (tag, props = {}, ...kids) => {
    const el = new El(tag, doc);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids.flat().filter(Boolean)); return el;
  };
  doc.fire = (el, type, more = {}) => { const e = { type, target: el, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...more }; el.dispatchEvent(e); return e; };
  const app = {}, notices = [], chosen = [];
  const ctx = vm.createContext({ document: doc, root, versionsB, current: app, api: app, importing: false, Intl,
    PA, ST, store: { list }, h, btn: (props, ...kids) => h('button', props, ...kids), icon: () => h('svg'), t: (k, v) => I.t(k, v, 'en'), nf: String,
    labelOf: () => 'Blank', fromDocs: (...args) => chosen.push(args), toast: (m) => notices.push(m), console: { error() {} },
    GZ_WRITER_SUBMIT_SHEET: { busy: () => busy, opened: () => busy } });
  vm.runInContext(`${block}\nglobalThis.testSheet = { open: fromDocsSheet, close: closeDocs };`, ctx);
  return { ...ctx.testSheet, doc, root, prior, versionsB, notices, chosen, ctx,
    layer: () => doc.body.querySelector('.gp-fromdocs-layer'), picks: () => doc.body.querySelectorAll('.gp-fromdocs-row'),
    key: (key, shiftKey = false) => doc.fire(doc.body.querySelector('.gp-fromdocs-layer'), 'keydown', { key, shiftKey }) };
};

test('the sheet labels rows with literal titles, format, words and date; only standalone paper keys are offered', async () => {
  const s = sheet({ list: async () => [...rows(), { ...rows()[0], key: 'bb.school.test|_1_1|_2_1|_3_1' }, { ...rows()[0], key: 'doc:bad' }, { ...rows()[0], kind: 'sheet' }] });
  await s.open();
  const dialog = s.doc.body.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'gp-fromdocs-h');
  assert.equal(s.picks().length, 2);
  assert.equal(s.picks()[0].querySelector('b').textContent, rows()[0].title);
  assert.equal(s.picks()[0].querySelector('img'), null);
  assert.equal(s.picks()[0].getAttribute('aria-label'), `${rows()[0].title} · Blank · 3 words · ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(1000)}`);
  assert.equal(s.root.inert, true);
});

test('row arrows wrap, Home and End navigate, Tab traps, and Escape returns focus and inert state', async () => {
  const s = sheet(); await s.open();
  const [first, last] = s.picks(), x = s.doc.body.querySelector('.gp-fromdocs-x');
  assert.equal(s.doc.activeElement, first);
  assert.equal(s.key('ArrowDown').defaultPrevented, true); assert.equal(s.doc.activeElement, last);
  s.key('ArrowDown'); assert.equal(s.doc.activeElement, first);
  s.key('ArrowUp'); assert.equal(s.doc.activeElement, last);
  s.key('Home'); assert.equal(s.doc.activeElement, first);
  s.key('End'); assert.equal(s.doc.activeElement, last);
  s.key('Tab'); assert.equal(s.doc.activeElement, x);
  s.key('Tab'); assert.equal(s.doc.activeElement, first);
  s.key('Tab', true); assert.equal(s.doc.activeElement, x);
  s.key('Escape'); assert.equal(s.layer(), null);
  assert.equal(s.doc.activeElement, s.versionsB);
  assert.equal(s.root.inert, false); assert.equal(s.prior.inert, true);
});

test('an empty list focuses Close, traps either Tab direction and closes with Escape', async () => {
  const s = sheet({ list: async () => [] }); await s.open();
  const x = s.doc.body.querySelector('.gp-fromdocs-x');
  assert.equal(s.doc.activeElement, x);
  s.key('Tab'); assert.equal(s.doc.activeElement, x);
  s.key('Tab', true); assert.equal(s.doc.activeElement, x);
  s.key('ArrowDown'); assert.equal(s.doc.activeElement, x);
  s.key('Escape'); assert.equal(s.doc.activeElement, s.versionsB);
});

test('a failed list reports failure and leaves focus and the paper available', async () => {
  const s = sheet({ list: async () => { throw new Error('storage unavailable'); } });
  await assert.doesNotReject(s.open());
  assert.equal(s.layer(), null); assert.equal(s.root.inert, false);
  assert.equal(s.doc.activeElement, s.versionsB);
  assert.deepEqual(s.notices, ['Not saved. Try again in a moment.']);
});

test('an active submit or a closed request cannot open a late sheet', async () => {
  const busy = sheet({ busy: true }); await busy.open(); assert.equal(busy.layer(), null);
  let finish;
  const s = sheet({ list: () => new Promise((r) => { finish = r; }) });
  const opening = s.open(); s.close(); finish(rows()); await opening;
  assert.equal(s.layer(), null); assert.equal(s.root.inert, false);
});
