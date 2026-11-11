// looks/gallery.js on frostdev.io: the click on "Use this Look in Glaze" goes to Glaze only when Glaze can take it. After an
// update under an open tab the content script is orphaned and sendMessage throws; the click must then be left alone, so the
// site's own listener (copy the exact code, frostdev.io looks.astro) still runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../extension/looks/gallery.js'), 'utf8');
const LOOK = { glazeUse: '', code: 'glaze1:abc', name: 'Aurora Night', author: 'kai' };
const MOD = { glazeMod: '', id: 'abcdefghijklmnop', hash: 'A'.repeat(43) };

// The script in a context of its own: a document that keeps its click listener, and a chrome.runtime that does what `runtime` says.
const load = (runtime) => {
  const events = [];
  let listener = null;
  const document = { addEventListener: (type, fn) => { if (type === 'click') listener = fn; } };
  const chrome = runtime === undefined ? undefined : { runtime: { lastError: undefined, ...runtime(events) } };
  vm.runInNewContext(source, { document, chrome });
  const click = (dataset, over = {}) => {
    const a = dataset && { dataset, hasAttribute: (k) => k === 'data-glaze-mod' ? 'glazeMod' in dataset : 'glazeUse' in dataset };
    const e = { target: { closest: () => a }, isTrusted: true, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => events.push('prevent'), ...over };
    listener(e);
    return JSON.parse(JSON.stringify(events)); // the script's objects come from another realm
  };
  return { click, events };
};
const works = (events) => ({ sendMessage: (m, cb) => { events.push(['send', m]); cb?.(); } });
const orphaned = () => ({ sendMessage: () => { throw new Error('Extension context invalidated.'); } });

test('a click on a Look is sent, then taken: nothing else goes with it', () => {
  const { click } = load(works);
  assert.deepEqual(click(LOOK), [['send', { gallery: { code: 'glaze1:abc', name: 'Aurora Night', author: 'kai' } }], 'prevent']);
});

test('a click on a mod sends only its id and hash, then takes the click', () => {
  const { click } = load(works);
  assert.deepEqual(click(MOD), [['send', { galleryMod: { id: MOD.id, hash: MOD.hash } }], 'prevent']);
});

test('after Glaze updates under the open tab, the click is left to the site, for a Look and for a mod', () => {
  for (const dataset of [LOOK, MOD]) {
    const { click } = load(orphaned);
    let events;
    assert.doesNotThrow(() => { events = click(dataset); });
    assert.deepEqual(events, [], 'the page\'s own fallback runs only on a click that was not taken');
  }
});

test('with no runtime at all, or none that can send, the click is left to the site too', () => {
  for (const runtime of [undefined, () => ({}), () => ({ sendMessage: 5 })]) {
    const { click } = load(runtime);
    let events;
    assert.doesNotThrow(() => { events = click(LOOK); });
    assert.deepEqual(events, []);
  }
});

test('only a real, plain left click on a Glaze link is handled', () => {
  for (const over of [{ isTrusted: false }, { button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) assert.deepEqual(load(works).click(LOOK, over), [], JSON.stringify(over));
  assert.deepEqual(load(works).click(null), [], 'a click on anything else');
});
