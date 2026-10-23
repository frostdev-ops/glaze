// A school's site as a student names it (lib/site.js): the host Glaze asks for, whether it is a course site, and the course
// sites near one that isn't.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/site.js');

test('any address a student would paste or type becomes its host, asked for as https', () => {
  const bb = { host: 'bb.school.edu', origin: 'https://bb.school.edu', pattern: 'https://bb.school.edu/*', url: 'https://bb.school.edu/' };
  for (const s of ['bb.school.edu', '  bb.school.edu  ', 'BB.School.EDU', 'bb.school.edu.', 'bb.school.edu/', 'https://bb.school.edu/#top']) assert.deepEqual(S.address(s), { ...bb, path: '' }, s);
  for (const s of ['https://bb.school.edu/ultra/course?x=1#top', 'http://bb.school.edu/ultra', 'https://bb.school.edu:8443/ultra']) assert.deepEqual(S.address(s), { ...bb, path: 'ultra' }, s);
  assert.equal(S.address('school.edu/moodle/course/view.php?id=3').path, 'moodle', 'a Moodle in a folder keeps its folder for the check');
  assert.equal(S.address('school.instructure.com').pattern, 'https://school.instructure.com/*');
  assert.equal(S.address('münchen.example.de').host, 'xn--mnchen-3ya.example.de', 'an international name goes as the browser writes it');
  assert.equal(S.address('10.1.2.3').pattern, 'https://10.1.2.3/*');
});

test('this computer keeps plain http and its port, for a local Canvas or Moodle', () => {
  assert.deepEqual(S.address('localhost:3000'), { host: 'localhost', origin: 'http://localhost:3000', pattern: 'http://localhost/*', url: 'http://localhost:3000/', path: '' });
  assert.deepEqual(S.address('http://127.0.0.1:8081/my/'), { host: '127.0.0.1', origin: 'http://127.0.0.1:8081', pattern: 'http://127.0.0.1/*', url: 'http://127.0.0.1:8081/', path: 'my' });
});

test('what is not a web address is refused', () => {
  for (const s of ['', '   ', null, undefined, 'school', 'not a site', 'student@school.edu', 'ftp://school.edu', 'file:///etc/hosts', 'javascript:alert(1)',
    'chrome://extensions', 'https://', 'bb.school.e', 'bb..school.edu', '-bb.school.edu', 'bb.school.edu\\x', 'https://user:pw@school.edu']) assert.equal(S.address(s), null, String(s));
});


// A pretend network: url → { status, body, type } or 'down'; anything not listed answers 404 with a page of HTML.
const net = (map) => {
  const asked = [];
  const f = async (url, opts = {}) => {
    asked.push([url, opts]);
    const hit = Object.entries(map).find(([k]) => k !== '*' && (url === k || (k.endsWith('*') && url.startsWith(k.slice(0, -1)))))?.[1];
    if (hit === 'down' || (!hit && map['*'] === 'down')) throw new TypeError('Failed to fetch');
    const r = hit || { status: 404, body: '<!doctype html><title>Not found</title>', type: 'text/html' };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, type: r.opaque || 'basic', headers: { get: () => r.type || 'application/json' }, text: async () => r.body ?? '' };
  };
  f.asked = asked;
  return f;
};
// What each LMS really answered (bb.wpunj.edu, canvas.harvard.edu, moodle.org, 2026-10-23).
const BB = { status: 200, body: '{"learn":{"major":4001,"minor":2,"patch":0,"build":"rel.71+c2fa77a"}}' };
const CANVAS = { status: 401, body: '{"status":"unauthenticated","errors":[{"message":"user authorization required"}]}' };
const MOODLE = { status: 200, body: JSON.stringify({ exception: 'core\\exception\\moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' }) };

test('each LMS is known by an address it answers on every site, signed in or not', async () => {
  assert.deepEqual(await S.probe(S.address('bb.school.edu'), net({ 'https://bb.school.edu/learn/api/public/v1/system/version': BB })), { kind: 'ultra', url: 'https://bb.school.edu/' });
  assert.deepEqual(await S.probe(S.address('canvas.school.edu'), net({ 'https://canvas.school.edu/api/v1/users/self': CANVAS })), { kind: 'canvas', url: 'https://canvas.school.edu/' });
  assert.deepEqual(await S.probe(S.address('canvas.school.edu'), net({ 'https://canvas.school.edu/api/v1/users/self': { status: 200, body: '{"id":7,"name":"Sam"}' } })), { kind: 'canvas', url: 'https://canvas.school.edu/' }, 'signed in');
  assert.deepEqual(await S.probe(S.address('moodle.school.edu'), net({ 'https://moodle.school.edu/webservice/*': MOODLE })), { kind: 'moodle', url: 'https://moodle.school.edu/' });
  assert.deepEqual(await S.probe(S.address('school.edu/moodle/my/'), net({ 'https://school.edu/moodle/webservice/*': MOODLE })), { kind: 'moodle', url: 'https://school.edu/moodle/' }, 'a Moodle in a folder');
  assert.deepEqual(await S.probe(S.address('localhost:8081'), net({ 'http://localhost:8081/webservice/*': MOODLE })), { kind: 'moodle', url: 'http://localhost:8081/' });
});

test('a school\'s main website, a sign-in redirect or a look-alike is not a course site', async () => {
  // What www.wpunj.edu answered: 404 pages, and its own 401 in plain text.
  const main = net({ 'https://www.wpunj.edu/api/v1/users/self': { status: 401, body: 'Invalid User', type: 'text/plain' } });
  assert.equal(await S.probe(S.address('www.wpunj.edu'), main), 'none');
  assert.equal(await S.probe(S.address('wpunj.edu'), net({ '*': 'down', 'https://wpunj.edu/*': { status: 0, opaque: 'opaqueredirect' } })), 'none');
  assert.equal(await S.probe(S.address('x.school.edu'), net({ 'https://x.school.edu/learn/*': { status: 200, body: '{"learn":"no"}' } })), 'none');
  assert.equal(await S.probe(S.address('x.school.edu'), net({ 'https://x.school.edu/webservice/*': { status: 200, body: '{"exception":1}' } })), 'none');
  const f = net({});
  await S.probe(S.address('x.school.edu'), f);
  assert.ok(f.asked.every(([, o]) => o.credentials === 'omit' && o.redirect === 'manual'), 'no session goes along, and no redirect is followed');
});

test('nothing answering is unreachable', async () => {
  assert.equal(await S.probe(S.address('bb.wpunj.ed'), net({ '*': 'down' })), 'unreachable');
});

test('course sites near one that isn\'t: its homepage\'s links first, then the names that exist on its domain', async () => {
  const home = '<a href="http://bb.wpunj.edu/">Blackboard</a> <a href="https://apply.wpunj.edu/x">Apply</a> <a href="https://evil.example/bb">x</a> <a href="https://wpunj.instructure.com/">Canvas</a>';
  assert.deepEqual(S.linked(home, 'www.wpunj.edu'), ['bb.wpunj.edu', 'wpunj.instructure.com']);
  const f = net({ '*': 'down', 'https://www.wpunj.edu/': { status: 200, body: home, type: 'text/html' }, 'https://bb.wpunj.edu/': { status: 200 }, 'https://online.wpunj.edu/': { status: 200 } });
  assert.deepEqual(await S.nearby(S.address('www.wpunj.edu'), { f, held: true }), ['bb.wpunj.edu'], 'built-in hosts already run Glaze');
  assert.deepEqual(await S.nearby(S.address('wpunj.edu'), { f }), ['bb.wpunj.edu'], 'without the grant, only the names that exist');
  assert.ok(f.asked.filter(([u]) => !u.startsWith('https://www.')).every(([, o]) => o.mode === 'no-cors' && o.credentials === 'omit'), 'a name is only knocked on');
  // A domain that answers for any name gets no guesses.
  const wild = net({ 'https://*': { status: 200 } });
  assert.deepEqual(await S.nearby(S.address('wild.edu'), { f: wild }), []);
  assert.equal(S.domainOf('bb.ox.ac.uk'), 'ox.ac.uk');
  assert.equal(S.domainOf('lms.unimelb.edu.au'), 'unimelb.edu.au');
  assert.equal(S.domainOf('bb.wpunj.edu'), 'wpunj.edu');
});

// ---- Allowing a site from one of Glaze's pages (the first screen, Settings → Sites) ------------------------------------
// The browser's side, stubbed: what is held (a set of match patterns), each request answered as the test says, the worker's
// replies, and every call in order. `click` runs a function as a click's handler does, with the gesture live only while it runs.
const browser = ({ held = [], required = ['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*'], granted = true, rejects = false, yes = { ok: true } } = {}) => {
  const has = new Set(held), calls = [];
  let gesture = false;
  globalThis.chrome = {
    runtime: { getManifest: () => ({ host_permissions: required }), sendMessage: (m) => { calls.push(['send', m.op, m]); return Promise.resolve(m.op === 'yes' ? yes : { ok: true }); } },
    permissions: {
      request: ({ origins }) => {
        calls.push(['request', origins, gesture]);
        if (rejects) return Promise.reject(new Error('Prompt closed'));
        // Already covered (every site held): the browser says yes and adds nothing.
        if (granted) for (const o of origins) if (!(has.has('https://*/*') && o.startsWith('https://'))) has.add(o);
        return Promise.resolve(granted);
      },
      getAll: async () => ({ origins: [...has] }),
      remove: async ({ origins }) => { calls.push(['remove', origins]); origins.forEach((o) => has.delete(o)); return true; },
    },
  };
  return { calls, has, ops: () => calls.map(([k, op]) => (k === 'send' ? op : k)), click: (fn) => { gesture = true; try { return fn(); } finally { gesture = false; } } };
};
const WWW_HOME = { status: 200, body: '<a href="https://bb.school.edu/">Blackboard</a>', type: 'text/html' };

test('allow: the worker hears first, the prompt opens inside the click, and a course site is checked then handed to the worker', async () => {
  const b = browser(), f = net({ 'https://bb.school.edu/learn/api/public/v1/system/version': BB });
  let checking = 0;
  const r = await b.click(() => S.allow(S.address('bb.school.edu'), { f, checking: () => checking++ }));
  assert.deepEqual(r, { state: 'done', kind: 'ultra', url: 'https://bb.school.edu/' });
  assert.deepEqual(b.ops(), ['ask', 'request', 'yes']);
  assert.deepEqual(b.calls[0][2], { type: 'glaze:allow', op: 'ask', origin: 'https://bb.school.edu' });
  assert.deepEqual(b.calls[1].slice(1), [['https://bb.school.edu/*'], true], 'exactly that host, in the click');
  assert.deepEqual(b.calls[2][2], { type: 'glaze:allow', op: 'yes', origin: 'https://bb.school.edu', kind: 'ultra', url: 'https://bb.school.edu/' });
  assert.equal(checking, 1);
  assert.ok(b.has.has('https://bb.school.edu/*'), 'the grant stays');
});

test('allow: a site that is no course site hands its grant back and offers the course sites nearby', async () => {
  const b = browser(), f = net({ '*': 'down', 'https://www.school.edu/': WWW_HOME, 'https://www.school.edu/*': { status: 404, body: 'Not found', type: 'text/html' } });
  const r = await b.click(() => S.allow(S.address('www.school.edu'), { f }));
  assert.deepEqual(r, { state: 'none', hosts: ['bb.school.edu'] });
  assert.deepEqual(b.ops(), ['ask', 'request', 'cancel', 'remove']);
  assert.deepEqual(b.calls.at(-1)[1], ['https://www.school.edu/*']);
  assert.ok(!b.has.has('https://www.school.edu/*'));
});

test('allow: a site that doesn\'t answer hands its grant back, without reading its homepage', async () => {
  const b = browser(), f = net({ '*': 'down' });
  const r = await b.click(() => S.allow(S.address('bb.nowhere.edu'), { f }));
  assert.deepEqual(r, { state: 'unreachable', hosts: [] });
  assert.deepEqual(b.ops(), ['ask', 'request', 'cancel', 'remove']);
  assert.ok(f.asked.every(([u, o]) => u !== 'https://bb.nowhere.edu/' || o.mode === 'no-cors'), 'only knocked on, never read');
});

test('allow: refused or dismissed, nothing is checked and the worker stops waiting', async () => {
  for (const o of [{ granted: false }, { rejects: true }]) {
    const b = browser(o), f = net({});
    const r = await b.click(() => S.allow(S.address('bb.school.edu'), { f }));
    assert.deepEqual(r, { state: 'refused' }, JSON.stringify(o));
    assert.deepEqual(b.ops(), ['ask', 'request', 'cancel']);
    assert.deepEqual(f.asked, [], 'no check without the grant');
  }
});

test('allow: the worker turning the site down keeps the grant and says so', async () => {
  const b = browser({ yes: { ok: false } }), f = net({ 'https://bb.school.edu/learn/api/public/v1/system/version': BB });
  const r = await b.click(() => S.allow(S.address('bb.school.edu'), { f }));
  assert.deepEqual(r, { state: 'failed' });
  assert.deepEqual(b.ops(), ['ask', 'request', 'yes', 'cancel']);
});

test('allow: a required host, or one held only through every site, is never handed back', async () => {
  const f = net({ '*': 'down' });
  for (const [why, o, host] of [
    ['a built-in host (Firefox lets a student revoke and re-grant it)', {}, 'school.instructure.com'],
    ['a host the manifest lists', { required: ['https://www.school.edu/*'] }, 'www.school.edu'],
    ['Safari\'s every site', { required: ['<all_urls>'] }, 'www.school.edu'],
    ['every https site granted', { held: ['https://*/*'] }, 'www.school.edu'],
  ]) {
    const b = browser(o);
    const r = await b.click(() => S.allow(S.address(host), { f }));
    assert.equal(r.state, 'unreachable', why);
    assert.ok(!b.ops().includes('remove'), why);
  }
});

test('handBack: an optional grant goes; a required host, or a grant the site only shares, stays', async () => {
  let b = browser({ held: ['https://bb.school.edu/*'] });
  assert.equal(await S.handBack(S.address('bb.school.edu')), true);
  assert.deepEqual(b.calls, [['remove', ['https://bb.school.edu/*']]]);
  b = browser({ held: ['https://school.instructure.com/*'] });
  assert.equal(await S.handBack(S.address('school.instructure.com')), false, 'never a built-in host');
  b = browser({ held: ['https://*/*'] });
  assert.equal(await S.handBack(S.address('bb.school.edu')), false, 'every site stays the student\'s');
  b = browser();
  assert.equal(await S.handBack(S.address('bb.school.edu')), false, 'nothing held');
  assert.equal(await S.handBack(null), false);
  assert.deepEqual(b.calls, []);
});

test('required: the manifest\'s hosts, by scheme and host, wildcards included', () => {
  const R = ['https://*.instructure.com/*', 'https://frostdev.io/*', 'http://localhost/*'];
  assert.equal(S.required(S.address('school.instructure.com'), R), true);
  assert.equal(S.required(S.address('instructure.com'), R), true);
  assert.equal(S.required(S.address('frostdev.io'), R), true);
  assert.equal(S.required(S.address('localhost:3000'), R), true);
  assert.equal(S.required(S.address('evilinstructure.com'), R), false);
  assert.equal(S.required(S.address('bb.school.edu'), R), false);
  assert.equal(S.required(S.address('bb.school.edu'), ['<all_urls>']), true);
  assert.equal(S.required(S.address('bb.school.edu'), ['*://*/*']), true);
});


test('nearby: listed sites and built-in hosts never displace unlisted suggestions', async () => {
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: { get: async () => ({
    canvas: ['https://canvas.school.edu/*'], moodle: ['https://moodle.school.edu/*'],
    ultra: ['https://bb.school.edu', 'not a URL'],
  }) } } };
  try {
    const home = { status: 200, type: 'text/html', body: '<a href="https://canvas.school.edu/">Canvas</a> <a href="https://school.instructure.com/">Hosted</a> <a href="https://courses.school.edu/">Courses</a>' };
    const f = net({ '*': 'down', 'https://www.school.edu/': home,
      ...Object.fromEntries(['bb', 'canvas', 'moodle', 'learn', 'courses'].map((h) => [`https://${h}.school.edu/`, { status: 200 }])),
    });
    assert.deepEqual(await S.nearby(S.address('www.school.edu'), { f, held: true }), ['courses.school.edu', 'learn.school.edu']);
    assert.deepEqual(await S.nearby(S.address('www.school.edu'), { f }), ['learn.school.edu', 'courses.school.edu']);
  } finally { globalThis.chrome = previous; }
});
