// Glaze's first screen (features/welcome.js): what a student types becomes the one site Glaze asks for.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../features/welcome.js');

test('any address a student would paste or type becomes its host, asked for as https', () => {
  const bb = { host: 'bb.school.edu', origin: 'https://bb.school.edu', pattern: 'https://bb.school.edu/*', url: 'https://bb.school.edu/' };
  for (const s of ['bb.school.edu', '  bb.school.edu  ', 'BB.School.EDU', 'bb.school.edu.', 'bb.school.edu/', 'https://bb.school.edu/ultra/course?x=1#top',
    'http://bb.school.edu/login', 'https://bb.school.edu:8443/ultra']) assert.deepEqual(W.address(s), bb, s);
  assert.equal(W.address('school.instructure.com').pattern, 'https://school.instructure.com/*');
  assert.equal(W.address('münchen.example.de').host, 'xn--mnchen-3ya.example.de', 'an international name goes as the browser writes it');
  assert.equal(W.address('10.1.2.3').pattern, 'https://10.1.2.3/*');
});

test('this computer keeps plain http and its port, for a local Canvas or Moodle', () => {
  assert.deepEqual(W.address('localhost:3000'), { host: 'localhost', origin: 'http://localhost:3000', pattern: 'http://localhost/*', url: 'http://localhost:3000/' });
  assert.deepEqual(W.address('http://127.0.0.1:8081/my/'), { host: '127.0.0.1', origin: 'http://127.0.0.1:8081', pattern: 'http://127.0.0.1/*', url: 'http://127.0.0.1:8081/' });
});

test('what is not a web address is refused', () => {
  for (const s of ['', '   ', null, undefined, 'school', 'not a site', 'student@school.edu', 'ftp://school.edu', 'file:///etc/hosts', 'javascript:alert(1)',
    'chrome://extensions', 'https://', 'bb.school.e', 'bb..school.edu', '-bb.school.edu', 'bb.school.edu\\x', 'https://user:pw@school.edu']) assert.equal(W.address(s), null, String(s));
});

test('the button says what it will do', () => {
  const s = W.address('bb.school.edu');
  assert.equal(W.act(null, false), 'none');
  assert.equal(W.act(null, true), 'none');
  assert.equal(W.act(s, false), 'allow');
  assert.equal(W.act(s, true), 'open');
});

test('the page wears the Frostdev Look from its definition, and asks only from a click', () => {
  const fs = require('node:fs'), path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '../features/welcome.js'), 'utf8');
  assert.match(js, /GZ_LOOKS\.find\(\(l\) => l\.name === 'Frostdev'\)/);
  assert.match(js, /GZ_LOOK_PARTS\(\{ name: 'Frostdev' \}\)/);
  // Every request sits in a click or submit handler, before any await.
  const requests = [...js.matchAll(/chrome\.permissions\.request\(/g)].length;
  assert.equal(requests, 2);
  assert.doesNotMatch(js, /await[^;\n]*\n?[^;\n]*chrome\.permissions\.request/);
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|WebSocket/, 'nothing on this page talks to the network');
});
