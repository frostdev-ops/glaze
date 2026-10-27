const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../features/writer-quote.js'), 'utf8');
const harness = ({ postInForm = false } = {}) => {
  const listeners = new Map(), frames = new Map(); let seq = 0, enabled = true;
  const add = (name, fn) => { const f = listeners.get(name) || new Set(); f.add(fn); listeners.set(name, f); };
  const remove = (name, fn) => listeners.get(name)?.delete(fn);
  const body = { closest: (s) => s.startsWith('[message-id]') ? { getAttribute: () => '_201_1' } : s === '.comment-and-reply' ? { contains: () => false } : postInForm && s.includes('form.text-editor-form') ? {} : null };
  const node = { nodeType: 1, closest: () => body };
  const sandbox = {
    GZ_CTX: { on: () => true, settings: () => ({ enabled: true, enhance: { writer: enabled } }) },
    location: { pathname: '/ultra/courses/_101_1/discussion/_9_1' },
    document: { addEventListener: add, removeEventListener: remove,
      createElement: () => { throw Error('Quote offered to a different reply'); } },
    addEventListener: add, removeEventListener: remove,
    requestAnimationFrame: (fn) => { frames.set(++seq, fn); return seq; }, cancelAnimationFrame: (id) => frames.delete(id),
    getSelection: () => ({ anchorNode: node, focusNode: node, rangeCount: 1, isCollapsed: false, toString: () => 'A classmate post', getRangeAt: () => ({}) }),
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return { api: sandbox.GZ_WRITER_QUOTE, disable: () => { enabled = false; },
    box: () => ({ kind: 'reply', ready: true, port: {}, frame: { isConnected: true }, context: { post: { id: '_999_1' } } }),
    count: () => [...listeners.values()].reduce((n, x) => n + x.size, 0), frames,
    select: () => { for (const fn of listeners.get('selectionchange') || []) fn(); for (const [id, fn] of frames) { frames.delete(id); fn(); } } };
};

test('a selection never quotes into an unrelated open reply', () => {
  const h = harness(); h.api.arm(h.box()); assert.doesNotThrow(h.select);
});

test('a read-only post inside Ultra\'s form can be quoted into its own reply', () => {
  const h = harness({ postInForm: true }), box = h.box();
  box.context.post.id = '_201_1';
  h.api.arm(box);
  assert.throws(h.select, /Quote offered to a different reply/, 'selection reaches the Quote UI construction');
});

test('the final reply disarms all quote listeners and queued selection work', () => {
  const h = harness(), box = h.box(); h.api.arm(box);
  assert.ok(h.count() > 0);
  h.api.disarm?.(box);
  assert.equal(h.count(), 0);
  assert.equal(h.frames.size, 0);
});

test('Writer disabled does not arm quote listeners', () => {
  const h = harness(); h.disable(); h.api.arm(h.box());
  assert.equal(h.count(), 0);
});
