const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const authSource = fs.readFileSync(process.env.GCAL_AUTH_SOURCE || require.resolve('../../extension/planner/gcal-auth.js'), 'utf8');
const optionsSource = fs.readFileSync(process.env.GCAL_OPTIONS_SOURCE || require.resolve('../../extension/settings/options.js'), 'utf8');

test('Calendar distinguishes an unregistered OAuth client from a cancelled sign-in', async () => {
  for (const message of ['OAuth2 request failed: Service responded with error: bad client id', 'invalid_client', 'redirect_uri_mismatch', 'The user did not approve access.']) {
    const calls = [], scope = 'https://www.googleapis.com/auth/calendar.app.created';
    const chrome = { permissions: { request: async () => true }, identity: { getAuthToken: async (options) => { calls.push(options); throw Error(message); } } };
    const ctx = vm.createContext({ chrome, GZ_GCAL: { SCOPE: scope }, t: (s) => s, gcalSafari: false });
    vm.runInContext(authSource, ctx);
    const from = optionsSource.indexOf('    const gcalSignIn = async (fresh) => {');
    const to = optionsSource.indexOf('    // Only a person\'s click or key, while the page has their activation', from);
    assert.ok(from > 0 && to > from);
    const result = await vm.runInContext(`${optionsSource.slice(from, to)} gcalSignIn()`, ctx);
    assert.equal(result, message === 'The user did not approve access.' ? "Google didn't connect. Export calendar (.ics) works without signing in." : 'Google sign-in is not configured for this copy of Glaze.');
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ interactive: true, scopes: [scope] }]);
  }
});
