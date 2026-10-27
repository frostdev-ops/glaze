// The submit page module over the probed DOM; uploads and native clicks are recorded independently.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const L = require('../../lib/writer-submit.js');
module.exports = ({ listed = true, enabled = true, worker } = {}) => {
  const doc = { activeElement: null }, sent = [], uploads = [], clicks = [], timers = new Map();
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = parse(fs.readFileSync(path.join(__dirname, '../fixtures/ultra-writer-attempt.html'), 'utf8'), doc);
  for (const n of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[n] = El.prototype[n].bind(doc.root);
  const editor = doc.querySelector('#bb-editorassignment-attempt-authoring-submission');
  const location = { origin: 'https://school.blackboard.com', pathname: '/ultra/courses/_101_1/assessment/_7_1/attempt/create' };
  let owned = true, clock = Date.now(), id = 0;
  const box = { id: 'gzw-test', editor, kind: 'assignment', mode: 'paper', path: location.pathname, context: { paper: { school: 'school.blackboard.com', user: '_900_1', course: '_101_1', content: '_7_1' } }, frame: { focus() {} }, port: { postMessage: (m) => sent.push(m) } };
  for (const e of doc.root.all()) e.getClientRects = () => [e.getBoundingClientRect()];
  const fire = (target, type, more = {}) => {
    const ev = { type, target, button: 0, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...more };
    doc.dispatchEvent(ev);
    if (!ev.stopped && type === 'click') clicks.push(target);
    return ev;
  };
  doc.fire = fire;
  const button = () => L.footer(editor).submit;
  const setEnabled = (on) => { const b = button(); b.disabled = !on; if (on) { b.removeAttribute('disabled'); b.className = ''; } else b.setAttribute('disabled', ''); };
  setEnabled(enabled);
  const addRow = (name) => { const row = new El('span', doc); row.textContent = name; row.getClientRects = () => [{}]; L.areaOf(editor).append(row); return row; };
  L.uploadInput(L.areaOf(editor)).addEventListener('change', (e) => { const file = e.target.files[0]; uploads.push(file); if (listed) addRow(file.name); });
  const ctx = vm.createContext({ document: doc, location, console, ArrayBuffer, Uint8Array, File, Event, CustomEvent, crypto,
    Date: class extends Date { static now() { return clock; } },
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: (n) => timers.delete(n),
    DataTransfer: class { constructor() { this.files = []; this.items = { add: (f) => this.files.push(f) }; } },
    GZ_WRITER_SUBMIT_LIB: L, GZ_WRITER_ULTRA: { kindOf: () => 'assignment' },
    chrome: { runtime: { sendMessage: worker || (async () => ({ ok: true })) } },
  });
  // Stand-in Event has no target setter. The real DOM supplies it during dispatch.
  const setText = (text) => { editor.replaceChildren(...text.replace(/\n$/, '').split('\n').map((line) => { const p = new El('p', doc); p.textContent = line; return p; })); };
  doc.addEventListener('gz-writer:set', (e) => { const m = JSON.parse(e.detail); setText(m.delta.map((o) => o.insert).join('')); doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: true }) })); });
  const input = L.uploadInput(L.areaOf(editor));
  input.dispatchEvent = (e) => { for (const l of input.listeners.filter((x) => x.type === e.type)) l.f({ type: e.type, target: input }); return true; };
  vm.runInContext(fs.readFileSync(process.env.WRITER_SUBMIT_SOURCE || path.join(__dirname, '../../features/writer-submit.js'), 'utf8'), ctx);
  const ok = () => owned;
  const hear = (m) => ctx.GZ_WRITER_SUBMIT.hear(box, m, {}, ok);
  hear({ type: 'submit:arm' });
  const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
  const tick = async (ms = 1000) => { clock += ms; for (const [n, t] of [...timers]) { timers.delete(n); t.fn(); } await flush(); };
  const go = async (extra = {}) => { hear({ type: 'submit:go', run: 1, name: 'Rivera_Essay2.docx', bytes: new Uint8Array([1, 2, 3]).buffer, note: '', text: null, until: clock + 80000, ...extra }); await flush(); };
  return { doc, ctx, box, sent, uploads, clicks, fire, hear, go, flush, tick, addRow, button, setEnabled, setText, input, timers, own: (v) => { owned = v; }, now: () => clock };
};
