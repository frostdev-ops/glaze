// Settings over the page (features/settingspage.js): nothing of the page draws over it or takes the pointer, Glaze's own
// overlays included (the pet's world beside <body>, the sidebar's buttons, floating tiles), whenever they come; closing puts back
// exactly what it changed. In a browser: scripts/embedded-settings-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Settings stills and hides every overlay of the page, before and while it is open, and gives each back as it was', async () => {
  const doc = { activeElement: null };
  const html = new El('html', doc), head = new El('head', doc), body = new El('body', doc);
  doc.root = html; html.append(head, body);
  const bar = new El('div', doc); bar.id = 'gz-navbar'; bar.attachShadow({ mode: 'open' });
  const main = new El('main', doc), edge = new El('button', doc), world = new El('div', doc);
  edge.id = 'gz-sb-edge'; edge.style.setProperty('opacity', '0.5'); edge.attrs.style = 'opacity: 0.5';
  body.append(bar, main, edge);
  html.append(world); // the pet's world sits beside <body>
  Object.assign(doc, { documentElement: html, body, head, createElement: (tag) => new El(tag, doc), getElementById: (id) => (id === 'gz-navbar' ? bar : null) });
  const observers = [];
  class MutationObserver { constructor(f) { this.f = f; this.on = []; observers.push(this); } observe(t) { this.on.push(t); } disconnect() { this.on = []; } }
  const added = (parent, node) => { parent.append(node); for (const o of observers) if (o.on.includes(parent)) o.f([{ target: parent, addedNodes: [node] }]); };
  const on = {};
  const page = vm.runInContext(read('features/settingspage.js'), vm.createContext({ document: doc, matchMedia: () => ({ matches: true }), CSS: { escape: String }, MutationObserver,
    history: { state: null, pushState(s) { this.state = s; }, back() {} }, addEventListener: (type, f) => { on[type] = f; }, removeEventListener: (type) => { delete on[type]; },
    chrome: { runtime: { id: 'glaze', getURL: (f) => `chrome-extension://glaze/${f}`, sendMessage: (m, reply) => reply({ ok: true, ticket: 'a'.repeat(32) }) } } }));
  assert.equal(await page.open(), true);
  const settings = body.querySelector('#gz-settings-page');
  const under = (e) => e.inert === true && e.style.getPropertyValue('opacity') === '0';
  for (const e of [main, edge, world]) assert.ok(under(e), `${e.id || e.tagName}: out of reach and unseen`);
  assert.ok(!bar.inert && !settings.inert && !bar.style.getPropertyValue('opacity') && !settings.style.getPropertyValue('opacity'), "Settings and Glaze's bar stay");
  const pet = new El('div', doc), pill = new El('button', doc);
  added(html, pet); added(body, pill);
  assert.ok(under(pet) && under(pill), 'what comes while it is open goes under it too');
  page.close();
  for (const e of [main, world, pet, pill]) assert.ok(!e.inert && !e.style.getPropertyValue('opacity'), `${e.tagName}: back in reach and seen`);
  assert.equal(edge.style.getPropertyValue('opacity'), '0.5', 'its own opacity back');
  const late = new El('div', doc);
  added(body, late);
  assert.ok(!late.inert && !late.style.getPropertyValue('opacity'), 'nothing is watched once it is closed');
});
