const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../lib/oauth.js');

test('PKCE S256 matches RFC 7636 Appendix B', async () => {
  assert.equal(await O.challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('verifiers and states are 43 unreserved characters and never repeat', () => {
  const seen = new Set(Array.from({ length: 200 }, O.random));
  assert.equal(seen.size, 200);
  for (const v of seen) assert.match(v, /^[A-Za-z0-9_-]{43}$/);
});

test('the redirect yields its code only for our state, from the query or the fragment', () => {
  const r = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
  assert.equal(O.code(`${r}?code=c0de&state=s1`, 's1'), 'c0de');
  assert.equal(O.code(`${r}#code=c0de&state=s1`, 's1'), 'c0de');
  const err = (url) => { try { O.code(url, 's1'); } catch (e) { return [e.error, e.message]; } };
  assert.deepEqual(err(`${r}?code=c0de&state=s2`), ['state', 'state']);
  assert.deepEqual(err(`${r}?code=c0de`), ['state', 'state']);
  assert.deepEqual(err(`${r}?state=s1`), ['code', 'code']);
  // A school that blocks user consent: the student is told to ask an admin, and Glaze offers .ics instead.
  assert.deepEqual(err(`${r}?error=consent_required&error_description=AADSTS65001&state=s1`), ['consent_required', 'AADSTS65001']);
  // An error from someone else's flow is not ours to report.
  assert.deepEqual(err(`${r}?error=access_denied&state=other`), ['state', 'state']);
});
