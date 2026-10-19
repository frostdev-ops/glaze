const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const page = async () => {
  const nodes = new Map(), observers = [], messages = [], ports = [];
  class Element {
    constructor() {
      this.hidden = false; this.value = ''; this.children = []; this.events = {};
      const classes = new Set();
      this.classList = { contains: (k) => classes.has(k), toggle: (k, on) => on ? classes.add(k) : classes.delete(k) };
    }
    addEventListener(k, f) { this.events[k] = f; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelectorAll() { return []; }
  }
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  node('#panel-sharing').hidden = node('#panel-backup').hidden = true;
  const state = { ok: true, on: false, sessions: [], sources: [], accounts: [], relay: 'https://share.frostdev.io' };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/sessions-ui.js'), 'utf8'), {
    URL, URLSearchParams, location: { search: '' }, navigator: {}, addEventListener() {},
    GZ_I18N: { t: (k) => k, ui: () => 'en' }, GZ_NOTES: { KEY: /^notesIdx:/ },
    document: { querySelector: node, createElement: () => new Element() },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe(target, options) { observers.push({ target, options, fn: this.fn }); }
    },
    chrome: { runtime: {
      sendMessage: async (m) => { messages.push(m.op); return structuredClone(state); },
      connect: () => {
        const p = { closed: false, onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() { this.closed = true; } };
        ports.push(p); return p;
      },
    } },
  });
  await settle();
  const change = async (attribute) => {
    for (const o of observers) if (o.target === node('#panel-sharing') && o.options.attributeFilter.includes(attribute)) o.fn();
    await settle();
  };
  return { panel: node('#panel-sharing'), messages, ports, change };
};

test('Settings sessions connect only while the Sharing panel is visible, including search filtering', async () => {
  const p = await page();
  assert.equal(p.ports.length, 0, 'opening another Settings tab is local only');
  // lib/editor.js finding() unhides every panel; options.js filter() hides non-matches with .miss.
  p.panel.hidden = false; p.panel.classList.toggle('miss', true);
  await p.change('hidden');
  assert.equal(p.ports.length, 0, 'a non-matching search must not start sharing in a CSS-hidden panel');
  assert.deepEqual(p.messages, []);
  p.panel.classList.toggle('miss', false); await p.change('class');
  assert.equal(p.ports.length, 1, 'a matching search makes Sharing visible');
  assert.deepEqual(p.messages, ['list']);
  p.panel.classList.toggle('miss', true); await p.change('class');
  assert.equal(p.ports[0].closed, true, 'filtering Sharing out disconnects its port');
  p.panel.classList.toggle('miss', false); await p.change('class');
  assert.equal(p.ports.length, 2);
  p.panel.hidden = true; await p.change('hidden');
  assert.equal(p.ports[1].closed, true, 'leaving the Sharing tab disconnects its port');
});
