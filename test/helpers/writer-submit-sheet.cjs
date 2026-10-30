const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const I = require('../../lib/i18n.js'), L = require('../../lib/writer-submit.js');
module.exports = () => {
  const doc = { activeElement: null }, messages = [], handles = {}, hooks = {}, timers = new Map();
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = new El('body', doc); doc.root.append(doc.body); doc.body.append(new El('main', doc));
  for (const n of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[n] = El.prototype[n].bind(doc.root);
  doc.createElement = (tag) => new El(tag, doc);
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  doc.fire = (el, type, more = {}) => { const e = { type, target: el, isTrusted: true, preventDefault() {}, stopPropagation() {}, ...more }; el.dispatchEvent(e); };
  let seq = 0, value = { label: 'first' }, current, format = { id: 'mla9' };
  const builds = [], saved = [];
  const api = { context: () => ({ assignment: { title: 'Essay 2' } }), paper: () => ({}), key: () => 'school|student|course|paper',
    pages: () => 1, format: () => format, editor: { view: { state: { get doc() { return value; } } }, text: () => value.label },
    file: () => { const snapshot = value; return new Promise((resolve) => builds.push({ snapshot, resolve: () => resolve({ bytes: new Uint8Array([snapshot.label === 'first' ? 1 : 2]) }) })); },
    version: async () => { saved.push(value); return true; }, save: async () => true };
  current = api;
  const frame = { t: (k, v) => I.t(k, v, 'en'), mode: () => 'paper', kind: () => 'assignment', say: (m) => messages.push(m), handle: (k, f) => { handles[k] = f; }, on: (k, f) => { hooks[k] = f; } };
  const ctx = vm.createContext({ document: doc, console, Intl, ArrayBuffer, Uint8Array,
    GZ_WRITER_FRAME: frame, GZ_WRITER_SUBMIT_LIB: L, GZ_WRITER_PAPER: { current: () => current, need: async () => {} },
    setTimeout: (f) => { timers.set(++seq, f); return seq; }, clearTimeout: (n) => timers.delete(n),
  });
  vm.runInContext(fs.readFileSync(process.env.WRITER_SUBMIT_SHEET_SOURCE || path.join(__dirname, '../../writer-submit.js'), 'utf8'), ctx);
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
  return { doc, ctx, api, messages, handles, hooks, builds, saved, timers, flush,
    open: () => ctx.GZ_WRITER_SUBMIT_SHEET.open(),
    edit: () => { value = { label: 'second' }; },
    click: (sel) => { const e = doc.querySelector(sel); assertElement(e); doc.fire(e, 'click'); },
  };
};
function assertElement(e) { if (!e) throw Error('element missing'); }
