// Glaze's first screen (features/welcome.js): what a student types becomes the one site Glaze asks for.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../features/welcome.js');

test('the button says what it will do', () => {
  const s = require('../lib/site.js').address('bb.school.edu');
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
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|WebSocket/, 'the page itself fetches nothing: only lib/site.js, at the sites the student names');
  // A site that isn't a course site gives its grant back.
  assert.match(js, /chrome\.permissions\.remove\(\{ origins: \[s\.pattern\] \}\)/);
});
