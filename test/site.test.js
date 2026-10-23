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
  assert.deepEqual(await S.nearby(S.address('www.wpunj.edu'), { f, held: true }), ['bb.wpunj.edu', 'wpunj.instructure.com']);
  assert.deepEqual(await S.nearby(S.address('wpunj.edu'), { f }), ['bb.wpunj.edu'], 'without the grant, only the names that exist');
  assert.ok(f.asked.filter(([u]) => !u.startsWith('https://www.')).every(([, o]) => o.mode === 'no-cors' && o.credentials === 'omit'), 'a name is only knocked on');
  // A domain that answers for any name gets no guesses.
  const wild = net({ 'https://*': { status: 200 } });
  assert.deepEqual(await S.nearby(S.address('wild.edu'), { f: wild }), []);
  assert.equal(S.domainOf('bb.ox.ac.uk'), 'ox.ac.uk');
  assert.equal(S.domainOf('lms.unimelb.edu.au'), 'unimelb.edu.au');
  assert.equal(S.domainOf('bb.wpunj.edu'), 'wpunj.edu');
});
