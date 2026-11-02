// Ask memory events are worker receipts, independent of the model reply. Controls use the verified worker broker and
// optimistic revisions, never an account chosen by the page. No real school data or browser session is used here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const ID = `m-${'1'.repeat(32)}`, SOURCE = `s-${'2'.repeat(32)}`, REV = 'a'.repeat(32), NEXT = 'b'.repeat(32);
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const receipt = (operation = 'created', extra = {}) => ({ operation, id: ID, revision: REV, at: 1793577600000, text: 'Use short explanations.', persistence: 'device', ...extra });
const record = (extra = {}) => ({ id: ID, revision: REV, kind: 'memory', markdown: 'Use short explanations.', ...extra });
const page = () => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  doc.documentElement = doc.root;
  doc.createElement = (tag) => new El(tag, doc); doc.createElementNS = (_, tag) => new El(tag, doc);
  doc.fire = (target, type, { trusted = true, ...extra } = {}) => {
    const ev = { target, type, isTrusted: trusted, ...extra, preventDefault() {} };
    for (let p = target; p; p = p.parentNode) for (const l of p.listeners.filter((x) => x.type === type)) l.f(ev);
  };
  const P = { doc, sent: [], requests: [], ports: [], response: async () => ({ ok: true, record: record() }) };
  const context = vm.createContext({ document: doc, navigator: { userActivation: { isActive: true } }, setTimeout, clearTimeout, URL,
    GZ_CTX: { t: (k) => k, on: () => true, locale: () => 'en', settings: () => ({ enabled: true }) },
    chrome: { storage: { local: { get: (_, cb) => cb({ ai: { on: true, features: { ask: true } } }) } }, runtime: {
      sendMessage: (m) => { P.requests.push(m); return P.response(m); },
      connect: () => {
        const listeners = [], port = { onMessage: { addListener: (f) => listeners.push(f) }, onDisconnect: { addListener() {} }, disconnect() {},
          postMessage(m) { P.sent.push(m); if (m.op === 'status') setImmediate(() => this.emit({ id: m.id, type: 'status', ready: true })); },
          emit(a) { for (const f of listeners) f(a); } };
        P.ports.push(port); return port;
      },
    } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/ai/page/ask-chat.js'), 'utf8'), context);
  P.chat = context.GZ_ASK_CHAT.mount(doc.body);
  P.root = P.chat.root;
  P.find = (s) => P.root.querySelector(s);
  P.click = (s, extra) => { const el = typeof s === 'string' ? P.find(s) : s; assert.ok(el, String(s)); doc.fire(el, 'click', extra); };
  P.ask = async () => { P.chat.ask({ question: 'Help me study.' }); await settle(); };
  P.emit = (a) => P.ports.at(-1).emit({ id: P.sent.filter((m) => m.op === 'ask').at(-1)?.id, ...a });
  return P;
};

test('a committed device save stays visible after a later model failure, with text kept literal', async () => {
  const P = page(); await P.ask();
  P.emit({ type: 'memory', receipt: receipt('created', { text: '<img src=x onerror=alert(1)> **short**' }) });
  const line = P.find('.gz-ask-memory');
  assert.ok(line, 'committed receipt is drawn before the answer ends');
  assert.equal(line.querySelector('summary').textContent, 'Memory saved on this device');
  assert.equal(line.querySelector('pre').textContent, '<img src=x onerror=alert(1)> **short**');
  assert.equal(line.querySelectorAll('img').length, 0);
  assert.equal(line.querySelectorAll('button').map((b) => b.textContent).join('|'), 'Edit|Delete');
  P.emit({ type: 'error', error: 'invalid-response' }); await settle();
  assert.equal(P.find('.gz-ask-memory'), line);
  assert.ok(P.find('.gz-ask-err'));
  assert.doesNotMatch(line.textContent, /sync|Drive/);
});

test('recall disclosure lists only supplied bounded records, as literal text', async () => {
  const P = page(); await P.ask();
  assert.equal(P.find('.gz-ask-recall'), null);
  P.emit({ type: 'recall', records: [
    { id: ID, revision: REV, kind: 'memory', text: 'Use **short** explanations.', category: 'preference' },
    { id: SOURCE, revision: NEXT, kind: 'course', text: '<h1>Cells</h1>', source: { title: 'Biology notes', complete: false } },
  ], truncated: true });
  const row = P.find('.gz-ask-recall');
  assert.equal(row.querySelector('summary').textContent, 'Memory used');
  assert.equal(row.querySelectorAll('pre').map((x) => x.textContent).join('|'), 'Use **short** explanations.|<h1>Cells</h1>');
  assert.equal(row.querySelectorAll('h1').length, 0);
  assert.equal(row.querySelectorAll('.gz-ask-recall-record').length, 2);
  P.emit({ type: 'recall', records: [], truncated: false });
  assert.equal(P.root.querySelectorAll('.gz-ask-recall').length, 1, 'empty events do not invent a recall row');
});

test('Edit reads the current record, then saves only id, revision and plain Markdown', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  P.click('.gz-ask-memory-edit', { trusted: false }); await settle();
  assert.equal(P.requests.length, 0);
  P.click('.gz-ask-memory-edit'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(P.requests[0])), { type: 'glaze:memory', op: 'read', id: ID });
  const input = P.find('.gz-ask-memory-input');
  assert.equal(input.value, 'Use short explanations.');
  assert.equal(input.getAttribute('aria-label'), 'Saved memory');
  assert.equal(input.getAttribute('writingsuggestions'), 'false');
  input.value = 'Prefer a clear worked example.';
  P.response = async () => ({ ok: true, receipt: receipt('updated', { revision: NEXT, text: input.value }) });
  P.click('.gz-ask-memory-save'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(P.requests.at(-1))), { type: 'glaze:memory', op: 'update', id: ID, revision: REV, markdown: 'Prefer a clear worked example.' });
  assert.equal(P.find('.gz-ask-memory-input'), null);
  assert.equal(P.find('.gz-ask-memory pre').textContent, 'Prefer a clear worked example.');
  assert.equal(P.find('.gz-ask-memory summary').textContent, 'Memory updated on this device');
});

test('failed and conflicting edits preserve the draft; Reload explicitly reads the current revision', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  P.click('.gz-ask-memory-edit'); await settle();
  const input = P.find('.gz-ask-memory-input'); input.value = 'Keep this unsaved draft.';
  P.response = async () => ({ ok: false, error: 'write' });
  P.click('.gz-ask-memory-save'); await settle();
  assert.equal(P.find('.gz-ask-memory-input'), input);
  assert.equal(input.value, 'Keep this unsaved draft.');
  assert.equal(P.find('.gz-ask-memory-status').textContent, 'Could not save. Try again.');
  P.response = async () => ({ ok: false, error: 'conflict', record: record({ revision: NEXT, markdown: 'External change.' }) });
  P.click('.gz-ask-memory-save'); await settle();
  assert.equal(input.value, 'Keep this unsaved draft.');
  assert.equal(P.find('.gz-ask-memory-status').textContent, 'This memory changed. Reload it before saving.');
  const n = P.requests.length;
  P.click('.gz-ask-memory-save'); await settle();
  assert.equal(P.requests.length, n, 'a known conflict cannot silently overwrite the new revision');
  P.response = async () => ({ ok: true, record: record({ revision: NEXT, markdown: 'External change.' }) });
  P.click('.gz-ask-memory-reload'); await settle();
  assert.equal(P.find('.gz-ask-memory-input').value, 'External change.');
});

test('Delete uses its shown revision, clears content only after success and removes stale controls', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  P.response = async () => ({ ok: false, error: 'write' });
  P.click('.gz-ask-memory-delete'); await settle();
  assert.equal(P.find('.gz-ask-memory pre').textContent, 'Use short explanations.');
  P.response = async () => ({ ok: true, receipt: receipt('forgotten', { revision: NEXT, text: undefined }) });
  P.click('.gz-ask-memory-delete'); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(P.requests.at(-1))), { type: 'glaze:memory', op: 'forget', id: ID, revision: REV });
  assert.equal(P.find('.gz-ask-memory summary').textContent, 'Memory deleted');
  assert.equal(P.find('.gz-ask-memory pre'), null);
  assert.equal(P.find('.gz-ask-memory-delete'), null);
  assert.equal(P.find('.gz-ask-memory-edit'), null);
});

test('a stale editor read cannot reopen a deleted memory', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  let release;
  P.response = () => new Promise((r) => { release = r; });
  P.click('.gz-ask-memory-edit'); await settle();
  P.emit({ type: 'memory', receipt: receipt('forgotten', { revision: NEXT, text: undefined }) });
  release({ ok: true, record: record() }); await settle();
  assert.equal(P.find('.gz-ask-memory-input'), null);
  assert.equal(P.find('.gz-ask-memory summary').textContent, 'Memory deleted');
});

test('clearing or closing the chat invalidates pending memory work and late run events', async () => {
  for (const close of [false, true]) {
    const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
    let release;
    P.response = () => new Promise((r) => { release = r; });
    P.click('.gz-ask-memory-edit'); await settle();
    P.emit({ type: 'end', task: 'agent.tools', answer: { text: 'Ready.' } }); await settle();
    if (close) P.chat.stop(); else P.click('.gz-ask-new');
    release({ ok: true, record: record() }); await settle();
    P.emit({ type: 'memory', receipt: receipt('updated', { revision: NEXT }) });
    assert.equal(P.find('.gz-ask-memory-input'), null);
    assert.equal(P.find('.gz-ask-memory'), null);
  }
});

test('Stop retains committed receipts and usable record controls', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  P.click('.gz-ask-stop');
  P.emit({ type: 'error', error: 'cancelled' }); await settle();
  assert.equal(P.find('.gz-ask-memory summary').textContent, 'Memory saved on this device');
  P.click('.gz-ask-memory-edit'); await settle();
  assert.equal(P.find('.gz-ask-memory-input').value, 'Use short explanations.');
});

test('invalid receipts and recall records do not manufacture saved or supplied context', async () => {
  const P = page(); await P.ask();
  for (const change of [{ persistence: 'drive' }, { id: SOURCE }, { revision: 'bad' }, { operation: 'synced' }, { at: NaN }, { at: 1.5 }, { text: undefined }, { text: '' }, { text: ' '.repeat(4) }, { text: 'x'.repeat(601) }]) P.emit({ type: 'memory', receipt: receipt('created', change) });
  P.emit({ type: 'memory', receipt: receipt('forgotten') });
  assert.equal(P.find('.gz-ask-memory'), null);
  P.emit({ type: 'recall', records: [{ id: ID, revision: 'bad', kind: 'memory', text: 'Bad revision' }, { id: SOURCE, revision: REV, kind: 'memory', text: 'Mismatched kind' }], truncated: false });
  assert.equal(P.find('.gz-ask-recall'), null);
});

test('a late read or save keeps focus that moved back to the composer', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  let release;
  P.response = () => new Promise((r) => { release = r; });
  P.click('.gz-ask-memory-edit'); await settle();
  const composer = P.find('.gz-ask-input'); composer.focus();
  release({ ok: true, record: record() }); await settle();
  assert.equal(P.doc.activeElement, composer);
  const input = P.find('.gz-ask-memory-input'); input.value = 'Use one example.'; input.focus();
  P.click('.gz-ask-memory-save'); await settle(); composer.focus();
  release({ ok: true, receipt: receipt('updated', { revision: NEXT, text: input.value }) }); await settle();
  assert.equal(P.doc.activeElement, composer);
  assert.equal(P.find('.gz-ask-memory summary').textContent, 'Memory updated on this device');
});

test('an edit stays intact when a broker response is malformed or exceeds the memory limit', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  P.click('.gz-ask-memory-edit'); await settle();
  const input = P.find('.gz-ask-memory-input'); input.value = 'x'.repeat(601);
  const count = P.requests.length;
  P.click('.gz-ask-memory-save'); await settle();
  assert.equal(P.requests.length, count);
  assert.equal(input.value.length, 601, 'oversized text is never silently truncated');
  input.value = 'My draft.';
  P.response = async () => ({ ok: true, receipt: receipt('updated', { id: `m-${'3'.repeat(32)}` }) });
  P.click('.gz-ask-memory-save'); await settle();
  assert.equal(P.find('.gz-ask-memory-input'), input);
  assert.equal(input.value, 'My draft.');
  assert.equal(P.find('.gz-ask-memory-status').textContent, 'Could not save. Try again.');
});

test('an answer finishing while memory is being edited keeps the editor focus and draft', async () => {
  const P = page(); await P.ask(); P.emit({ type: 'memory', receipt: receipt() });
  P.click('.gz-ask-memory-edit'); await settle();
  const input = P.find('.gz-ask-memory-input'); input.value = 'Still editing.'; input.focus();
  P.emit({ type: 'end', task: 'agent.tools', answer: { text: 'Ready.' } }); await settle();
  assert.equal(P.doc.activeElement, input);
  assert.equal(input.value, 'Still editing.');
});

test('Memory off is its own status and leaves the Ask composer available', async () => {
  const P = page(); await P.ask();
  P.emit({ type: 'error', error: 'off', feature: 'memory' }); await settle();
  assert.equal(P.find('.gz-ask-say').textContent, 'Memory is off');
  assert.ok(P.root.isConnected);
  assert.equal(P.find('.gz-ask-send').disabled, false);
});
