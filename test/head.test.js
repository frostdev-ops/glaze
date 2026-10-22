const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
// Exercise the production head gate without a browser or the unrelated page enhancements.
const gate = source.slice(0, source.indexOf('  const C = GZ_COLOR;')) + 'window.started = site; })();';
const bodyGate = source.slice(0, source.indexOf('  // ---- long tail')) + 'window.started = site; })();';
const ultra = { matches: () => true };
const canvas = { matches: () => false };

const page = ({ protocol = 'https:', pathname = '/ultra', body = null, marker = null, frame = false, application = false } = {}, full = false) => {
  const listeners = new Map();
  const created = [];
  let hit = marker;
  let observer;
  const document = {
    contentType: 'text/html', body, readyState: 'loading',
    querySelector: () => application ? {} : null,
    head: { querySelector: () => hit },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    createElement: (tag) => { created.push(tag); throw new Error('the off page must never create a sheet'); },
  };
  const window = {};
  window.top = frame ? {} : window;
  // Blackboard's own host: Ultra there needs no yes first (WP-C2), so the head gate is all these pages decide.
  const location = { protocol, pathname, hostname: 'school.blackboard.com', origin: `${protocol}//school.blackboard.com` };
  const done = vm.runInNewContext(full === true ? source : full === 'body' ? bodyGate : gate, {
    window, document, location, GZ_COLOR: {}, GZ_DEFAULTS: {},
    chrome: { storage: { local: { get: (key, cb) => cb({ [key]: ['https://school.blackboard.com/*', 'https://school.blackboard.com'] }) } } },
    matchMedia: () => ({}), CSS: { supports: () => false },
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observer = this; }
      observe() { this.active = true; }
      disconnect() { this.active = false; }
    },
  });
  const mutate = (next) => { hit = next; if (observer?.active) observer.fn(); };
  return { window, location, document, done, mutate, listeners, created, observer: () => observer };
};

test('Ultra waits for its head marker, then stays Ultra across bare-entry pushState', async () => {
  const p = page();
  assert.equal(p.window.started, undefined);
  p.mutate(ultra);
  p.location.pathname = '/ultra/course';
  await p.done;
  assert.equal(p.window.started, 'ultra');
  assert.equal(p.observer().active, false);
  assert.equal(p.listeners.size, 0);
});

test('Canvas is Canvas on a host/path starting with /ultra', async () => {
  const p = page({ pathname: '/ultra/courses/25', marker: canvas });
  await p.done;
  assert.equal(p.window.started, 'canvas');
});

test('the first observed marker decides once', async () => {
  for (const [first, second, expected] of [[canvas, ultra, 'canvas'], [ultra, canvas, 'ultra']]) {
    const p = page();
    p.mutate(first);
    p.mutate(second);
    await p.done;
    assert.equal(p.window.started, expected);
  }
});

test('a non-LMS /ultra/x page creates no sheet, even transiently', async () => {
  const p = page({ pathname: '/ultra/x' }, true);
  p.document.body = {};
  p.mutate(null);
  await p.done;
  assert.equal(p.window.started, undefined);
  assert.equal(p.observer().active, false);
  assert.equal(p.listeners.size, 0);
});

test('a late injection with a body and no marker stops immediately', async () => {
  const p = page({ body: {} }, true);
  await p.done;
  assert.equal(p.observer().active, false);
});

test('the preview starts as Ultra synchronously without a marker', async () => {
  const p = page({ protocol: 'chrome-extension:' });
  assert.equal(p.window.started, 'ultra');
  assert.equal(p.observer(), undefined);
  await p.done;
});


test('the body-time Ultra guard keeps the preview and requires a head base on sites', () => {
  const guard = source.match(/  const isUltra = (.+);/)[1];
  for (const [isPreview, marker, expected] of [[true, null, true], [false, null, false], [false, ultra, true]]) {
    assert.equal(vm.runInNewContext(`(${guard})()`, {
      isPreview, ULTRA: 'base[href*="/ultra/"]',
      document: { head: { querySelector: (selector) => {
        assert.equal(selector, 'base[href*="/ultra/"]');
        return marker;
      } } },
    }), expected);
  }
});


test('Canvas tool frames wait for the body and create no sheet without the application wrapper', async () => {
  const p = page({ marker: canvas, frame: true }, true);
  await new Promise(setImmediate);
  assert.equal(p.window.started, undefined);
  p.document.body = {};
  p.listeners.get('DOMContentLoaded')();
  await p.done;
  assert.equal(p.window.started, undefined);
  assert.deepEqual(p.created, []);
});

test('Canvas application frames can start after body validation; the top page still starts in head', async () => {
  const framed = page({ marker: canvas, frame: true, application: true }, 'body');
  await new Promise(setImmediate);
  assert.equal(framed.window.started, undefined);
  framed.document.body = {};
  framed.listeners.get('DOMContentLoaded')();
  await framed.done;
  assert.equal(framed.window.started, 'canvas');
  const top = page({ marker: canvas }, 'body');
  await top.done;
  assert.equal(top.window.started, 'canvas');
  assert.equal(top.document.body, null);
});


test('the Ultra boot fixture navigates on its own origin despite the CDN base', () => {
  const fixture = fs.readFileSync(require.resolve('./fixtures/ultra-boot.html'), 'utf8');
  const script = fixture.match(/<script>([\s\S]*?)<\/script>/)[1];
  let moved;
  vm.runInNewContext(script, {
    location: { origin: 'https://bb.invalid' },
    history: { pushState: (_state, _title, url) => { moved = new URL(url, 'https://ultra-cdn.invalid/ultra/uiv4001.0.0-rel/'); } },
  });
  assert.equal(moved.href, 'https://bb.invalid/ultra/course');
});

test('Moodle is Moodle by the keywords meta its core writes in every head; its frames wait for Moodle\'s body', async () => {
  const moodle = { matches: (s) => s === 'meta[name="keywords"][content^="moodle,"]' };
  const p = page({ pathname: '/my/', marker: moodle });
  await p.done;
  assert.equal(p.window.started, 'moodle');
  const framed = page({ pathname: '/h5p/embed.php', marker: moodle, frame: true }, 'body');
  await new Promise(setImmediate);
  assert.equal(framed.window.started, undefined);
  framed.document.body = {};
  framed.listeners.get('DOMContentLoaded')();
  await framed.done;
  assert.equal(framed.window.started, undefined, 'no Moodle page in the frame');
});
