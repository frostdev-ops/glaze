// Google sign-in for Drive (background/google.js, background/google-config.js) and the Picker hand-off, with chrome.identity, permissions,
// storage and fetch stubbed: connect on each flow, silent renewal, a state that isn't ours refused, Disconnect revoking, no
// token ever in storage, the picker's fragment and the picker page's fallback order. The packaging side
// (tools/build/oauth-manifest.js) is at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../../extension/background/google.js');
const C = require('../../extension/background/google-config.js');
const { oauth } = require('../../tools/build/oauth-manifest.js');

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';
// Every id unset, as before the owner made Glaze's clients.
const BLANK = { ...C, chrome: 'PLACEHOLDER-chrome.apps.googleusercontent.com', web: 'PLACEHOLDER-web.apps.googleusercontent.com', ios: 'PLACEHOLDER-ios.apps.googleusercontent.com', apiKey: 'PLACEHOLDER', appId: 'PLACEHOLDER' };
const REAL = { ...C, chrome: '111-chrome.apps.googleusercontent.com', web: '222-web.apps.googleusercontent.com', ios: '333-ios.apps.googleusercontent.com', apiKey: 'AIzaTestKey', appId: '123456789012' };

// A worker: flow, config, what Google answers (google(details) → the redirect URL; userinfo), which picker pages load.
const harness = ({ on = true, flow = 'chrome', config = REAL, granted = true, firefox = false, client = REAL.chrome, keep = false, up = [true, true], email = 'student@school.edu', native = async () => null } = {}) => {
  const local = {}, sync = {};
  const who = { sub: '1', email }; // the account Google's userinfo names for any token: changed to model another account
  const owners = {}, gate = { picker: null }; // gate.picker: what the picker page's HEAD waits on
  const log = { fetch: [], launch: [], auth: [], removed: [], cleared: 0, permRemoved: [], native: [] };
  let clock = 1_000_000;
  let n = 0;
  const identity = {
    getAuthToken: async (d) => {
      log.auth.push(d);
      if (identity.fail) throw new Error(identity.fail);
      return { token: identity.next?.shift() || `chrome-tok-${++n}`, grantedScopes: identity.scopes || d.scopes };
    },
    // Firefox's schema (toolkit/components/extensions/schemas/identity.json) takes { url, interactive } and refuses any other
    // key; it reads the redirect from the url's redirect_uri.
    launchWebAuthFlow: async (d) => {
      if (firefox) { const extra = Object.keys(d).filter((k) => k !== 'url' && k !== 'interactive'); if (extra.length) throw new Error(`Type error for parameter details (Unexpected property "${extra[0]}")`); }
      log.launch.push(d);
      return identity.answer(d);
    },
    getRedirectURL: () => (firefox ? 'https://0123456789abcdef0123456789abcdef01234567.extensions.allizom.org/' : REDIRECT),
    removeCachedAuthToken: async ({ token }) => { log.removed.push(token); },
    clearAllCachedAuthTokens: async () => { log.cleared++; },
    // Google's account screen, answering for our state (the default), with the scopes asked for.
    answer: (d) => {
      const u = new URL(d.url);
      if (u.origin === 'https://accounts.google.com') {
        const q = u.searchParams;
        return `${q.get('redirect_uri')}#${new URLSearchParams({ access_token: `web-tok-${++n}`, token_type: 'Bearer', expires_in: '3599', scope: `email openid ${DRIVE}`, state: q.get('state') })}`;
      }
      const f = new URLSearchParams(u.hash.slice(1));
      return `${f.get('redirect_uri')}#${new URLSearchParams({ state: f.get('state'), action: 'picked', files: JSON.stringify([{ id: '1AbC_d-EfGh', name: 'Essay draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]) })}`;
    },
  };
  const area = (s) => ({
    get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const fetch = async (url, init = {}) => {
    log.fetch.push({ url, init });
    if (url === G.USERINFO) {
      // owners: the account a particular token belongs to (Chrome's cache can hold another account's); else who.
      const token = init.headers?.authorization?.replace(/^Bearer /, '');
      return token ? new Response(JSON.stringify({ ...(owners[token] || who), email_verified: true }), { status: 200 }) : new Response('', { status: 401 });
    }
    if (url === G.REVOKE) return new Response('', { status: 200 });
    const i = config.picker.indexOf(url);
    if (i >= 0) { await gate.picker; if (up[i]) return new Response('', { status: 200 }); throw new TypeError('Failed to fetch'); }
    throw new Error(`unexpected request: ${url}`);
  };
  const g = G.create({
    on, config, flow, firefox,
    identity: () => (granted ? identity : undefined),
    permissions: { contains: async ({ permissions }) => granted && permissions.join() === 'identity', remove: async (p) => { log.permRemoved.push(p); return true; } },
    manifest: () => ({ oauth2: { client_id: client } }),
    storage: area(local),
    fetch,
    native: async (m) => { log.native.push(m); return native(m); },
    open: async () => {},
    keep: async () => keep,
    now: () => clock,
  });
  return { g, local, sync, log, identity, who, owners, gate, tick: (ms) => { clock += ms; } };
};
// Every token that ever existed, and storage: none may be in it.
const noToken = (h) => {
  const text = JSON.stringify(h.local) + JSON.stringify(h.sync);
  assert.ok(!/tok-\d/.test(text), `no token in storage: ${text}`);
  assert.deepEqual(Object.keys(h.local).filter((k) => k !== 'google'), [], 'storage.local holds only google');
  if (h.local.google) assert.deepEqual(Object.keys(h.local.google).sort(), ['at', 'email', 'flow', 'sub']);
};
const careful = (h) => {
  for (const { init } of h.log.fetch) assert.deepEqual([init.credentials, init.redirect, init.cache], ['omit', 'error', 'no-store']);
};

test('the config: Glaze\'s clients in project 1071735898350, three scopes, the two picker pages in order, no secret', () => {
  assert.deepEqual(C.scopes, [DRIVE, 'openid', 'email']);
  assert.deepEqual(C.picker, ['https://frostdev.io/glaze/drive-picker/', 'https://frostdev-ops.github.io/glaze-drive-picker/']);
  assert.equal(C.chrome, require('../../extension/manifest.json').oauth2.client_id, 'Chrome signs in with the store item\'s client, Calendar\'s');
  for (const k of ['chrome', 'web', 'ios']) assert.match(C[k], /^1071735898350-[a-z0-9]{32}\.apps\.googleusercontent\.com$/, k);
  assert.equal(new Set([C.chrome, C.web, C.ios]).size, 3);
  assert.equal(C.appId, '1071735898350');
  assert.match(C.apiKey, /^AIza[\w-]{35}$/);
  assert.doesNotMatch(JSON.stringify(C) + fs.readFileSync(path.join(__dirname, '../../extension/background/google-config.js'), 'utf8'), /GOCSPX|client_secret|secret/i, 'client ids and a browser key only, never a secret');
  assert.equal(C.native, false, 'Safari waits for the app');
  assert.deepEqual(['chrome', 'web', 'native'].map((f) => G.ready(C, f)), [true, true, false]);
  assert.equal(G.pickable(C), true);
  for (const f of ['chrome', 'web', 'native']) assert.equal(G.ready(BLANK, f), false, f);
  assert.equal(G.ready(REAL, 'chrome'), true);
  assert.equal(G.ready(REAL, 'web'), true);
  assert.equal(G.ready(REAL, 'native'), false, 'native also needs config.native');
  assert.equal(G.ready({ ...REAL, apiKey: '' }, 'web'), true, 'signing in needs no Picker key');
  assert.equal(G.ready({ ...REAL, web: '' }, 'web'), false);
  assert.equal(G.pickable(REAL), true);
  assert.equal(G.pickable({ ...REAL, apiKey: 'PLACEHOLDER' }), false, 'the Picker needs its key');
  assert.equal(G.pickable({ ...REAL, appId: '' }), false, 'and the project number');
});

test('placeholders: status says setup on every browser, and connect does nothing', async () => {
  for (const flow of ['chrome', 'web']) {
    const h = harness({ flow, config: BLANK });
    assert.deepEqual(await h.g.status(), { ok: false, why: 'setup' });
    assert.deepEqual(await h.g.connect(), { ok: false, why: 'setup' });
    assert.deepEqual([h.log.auth, h.log.launch, h.log.fetch], [[], [], []]);
  }
  const s = harness({ flow: 'native' });
  assert.deepEqual(await s.g.status(), { ok: false, why: 'browser' }, 'Safari: no native sign-in yet');
});

test('which flow: Google Chrome and Chromium use getAuthToken; Edge, Brave and Firefox the web flow; Safari the app', () => {
  const brands = (...b) => b.map((brand) => ({ brand, version: '130' }));
  assert.equal(G.flowOf({ protocol: 'chrome-extension:', brands: brands('Google Chrome', 'Chromium', 'Not_A Brand') }), 'chrome');
  assert.equal(G.flowOf({ protocol: 'chrome-extension:', brands: brands('Chromium', 'Not=A?Brand') }), 'chrome');
  assert.equal(G.flowOf({ protocol: 'chrome-extension:', brands: brands('Microsoft Edge', 'Chromium', 'Not_A Brand') }), 'web');
  assert.equal(G.flowOf({ protocol: 'chrome-extension:', brands: brands('Brave', 'Chromium', 'Not_A Brand') }), 'web');
  assert.equal(G.flowOf({ protocol: 'chrome-extension:', brands: undefined }), 'web');
  assert.equal(G.flowOf({ protocol: 'moz-extension:' }), 'web');
  assert.equal(G.flowOf({ protocol: 'safari-web-extension:' }), 'native');
});

test('Chrome: connect needs the identity permission, then signs in with getAuthToken for exactly the three scopes', async () => {
  const no = harness({ granted: false });
  assert.deepEqual(await no.g.connect(), { ok: false, why: 'permission' });
  assert.deepEqual(no.local, {});
  const h = harness();
  assert.deepEqual(await h.g.status(), { ok: true, flow: 'chrome', email: null });
  assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' });
  assert.deepEqual(h.log.auth, [{ interactive: true, scopes: C.scopes }]);
  assert.equal(h.log.fetch[0].url, G.USERINFO);
  assert.equal(h.log.fetch[0].init.headers.authorization, 'Bearer chrome-tok-1');
  assert.deepEqual(h.local.google, { email: 'student@school.edu', sub: '1', flow: 'chrome', at: 1_000_000 });
  assert.equal(await h.g.account(), 'student@school.edu');
  assert.deepEqual(await h.g.status(), { ok: true, flow: 'chrome', email: 'student@school.edu' });
  // Later, the worker's token never prompts.
  assert.equal(await h.g.token(), 'chrome-tok-2');
  assert.deepEqual(h.log.auth[1], { interactive: false, scopes: C.scopes });
  careful(h);
  noToken(h);
});

test('Chrome: Drive unticked on Google\'s screen is no connection, and Chrome forgets that token', async () => {
  const h = harness();
  h.identity.scopes = ['openid', 'email'];
  assert.deepEqual(await h.g.connect(), { ok: false, why: 'scope' });
  assert.deepEqual(h.log.removed, ['chrome-tok-1']);
  assert.deepEqual(h.local, {});
});

test('Chrome with another manifest client (a dev copy) uses the web flow; a browser without getAuthToken support falls back to it', async () => {
  const dev = harness({ client: '999-other.apps.googleusercontent.com' });
  dev.identity.answer = harness().identity.answer;
  assert.deepEqual(await dev.g.status(), { ok: true, flow: 'web', email: null });
  assert.equal((await dev.g.connect()).ok, true);
  assert.deepEqual([dev.log.auth.length, dev.log.launch.length, dev.local.google.flow], [0, 1, 'web']);
  const edge = harness();
  edge.identity.fail = 'This API is not supported on Microsoft Edge.';
  assert.equal((await edge.g.connect()).ok, true);
  assert.deepEqual([edge.log.auth.length, edge.log.launch.length, edge.local.google.flow], [1, 1, 'web']);
  noToken(edge);
});

test('web flow: the implicit flow with the Web client, its state checked, the token only in memory', async () => {
  const h = harness({ flow: 'web' });
  assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' });
  assert.equal(h.log.launch.length, 1);
  const d = h.log.launch[0];
  assert.equal(d.interactive, true);
  assert.equal(d.redirect_uri, undefined, 'Chromium: its own redirect');
  const u = new URL(d.url);
  assert.equal(`${u.origin}${u.pathname}`, G.AUTH);
  assert.deepEqual(Object.fromEntries([...u.searchParams].filter(([k]) => k !== 'state')), {
    client_id: REAL.web, response_type: 'token', redirect_uri: REDIRECT, scope: `${DRIVE} openid email`, include_granted_scopes: 'true', prompt: 'select_account',
  });
  assert.match(u.searchParams.get('state'), /^[\w-]{43}$/);
  assert.equal(await h.g.token(), 'web-tok-1', 'held in this worker until it expires');
  assert.equal(h.log.launch.length, 1);
  careful(h);
  noToken(h);
});

test('web flow: silent renewal with prompt=none and the account as login_hint, never interactive', async () => {
  const h = harness({ flow: 'web' });
  await h.g.connect();
  h.tick(3600 * 1000);
  assert.equal(await h.g.token(), 'web-tok-2');
  const d = h.log.launch[1];
  assert.deepEqual([d.interactive, d.abortOnLoadForNonInteractive, d.timeoutMsForNonInteractive], [false, false, 10000]);
  const q = new URL(d.url).searchParams;
  assert.deepEqual([q.get('prompt'), q.get('login_hint')], ['none', 'student@school.edu']);
  // Google says interaction is needed: a silent call fails, it doesn't prompt.
  h.tick(3600 * 1000);
  h.identity.answer = (x) => `${REDIRECT}#${new URLSearchParams({ error: 'interaction_required', state: new URL(x.url).searchParams.get('state') })}`;
  await assert.rejects(h.g.token(), (e) => e.why === 'auth');
  assert.equal(h.log.launch.at(-1).interactive, false);
  // A new worker (nothing in memory) renews silently too.
  noToken(h);
});

test('Firefox: the loopback redirect Google accepts, in the url only, and only the keys Firefox\'s schema takes', async () => {
  const h = harness({ flow: 'web', firefox: true });
  assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' });
  const d = h.log.launch[0];
  assert.deepEqual(Object.keys(d).sort(), ['interactive', 'url']);
  assert.equal(new URL(d.url).searchParams.get('redirect_uri'), 'http://127.0.0.1/mozoauth2/0123456789abcdef0123456789abcdef01234567');
  h.tick(3600 * 1000);
  assert.equal(await h.g.token(), 'web-tok-2');
  assert.deepEqual(Object.keys(h.log.launch[1]).sort(), ['interactive', 'url']);
  assert.equal(h.log.launch[1].interactive, false);
  assert.equal((await h.g.pick()).ok, true);
  assert.deepEqual(Object.keys(h.log.launch.at(-1)).sort(), ['interactive', 'url'], 'the picker too');
});

test('without the Picker key, signing in, the token and Disconnect work, and only Pick says setup', async () => {
  for (const flow of ['chrome', 'web']) {
    const h = harness({ flow, config: { ...REAL, apiKey: 'PLACEHOLDER' } });
    assert.deepEqual(await h.g.status(), { ok: true, flow, email: null }, `${flow}: Settings offers Connect`);
    assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' });
    assert.equal(typeof await h.g.token(), 'string');
    assert.equal(await h.g.account(), 'student@school.edu');
    const before = h.log.launch.length;
    assert.deepEqual(await h.g.pick(), { ok: false, why: 'setup' });
    assert.equal(h.log.launch.length, before, 'no picker opened');
    assert.ok(!h.log.fetch.some((f) => C.picker.includes(f.url)), 'nor probed');
    assert.deepEqual(await h.g.disconnect(), { ok: true, revoked: true, had: true });
  }
});

test('a reply that isn\'t for our state is refused, and nothing is kept', async () => {
  for (const bad of [
    (d) => `${REDIRECT}#access_token=evil&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(DRIVE)}&state=someone-else`,
    () => `${REDIRECT}#access_token=evil&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(DRIVE)}`,
    (d) => { const s = new URL(d.url).searchParams.get('state'); return `${REDIRECT}#access_token=evil&token_type=Bearer&scope=${encodeURIComponent(DRIVE)}&state=${s}&state=${s}`; },
    (d) => `${REDIRECT}?access_token=evil&token_type=Bearer&scope=${encodeURIComponent(DRIVE)}&state=${new URL(d.url).searchParams.get('state')}`,
  ]) {
    const h = harness({ flow: 'web' });
    h.identity.answer = bad;
    assert.deepEqual(await h.g.connect(), { ok: false, why: 'state' });
    assert.deepEqual(h.local, {});
    assert.ok(!h.log.fetch.some((f) => f.init.headers?.authorization?.includes('evil')), 'the stray token is never used');
  }
  const h = harness({ flow: 'web' });
  h.identity.answer = (d) => `${REDIRECT}#${new URLSearchParams({ access_token: 'x', token_type: 'Bearer', scope: 'openid email', state: new URL(d.url).searchParams.get('state') })}`;
  assert.deepEqual(await h.g.connect(), { ok: false, why: 'scope' }, 'Drive unticked');
  const c = harness({ flow: 'web' });
  c.identity.launchWebAuthFlow = async () => { throw new Error('The user did not approve access.'); };
  assert.deepEqual(await c.g.connect(), { ok: false, why: 'cancel' });
});

test('disconnect revokes the grant, clears the cached tokens, gives identity back and forgets the account', async () => {
  const h = harness();
  await h.g.connect();
  assert.deepEqual(await h.g.disconnect(), { ok: true, revoked: true, had: true });
  const r = h.log.fetch.find((f) => f.url === G.REVOKE);
  assert.deepEqual([r.init.method, r.init.headers['content-type'], r.init.body], ['POST', 'application/x-www-form-urlencoded', 'token=chrome-tok-2']);
  assert.deepEqual([h.log.removed, h.log.cleared, h.log.permRemoved], [['chrome-tok-2'], 1, [{ permissions: ['identity'] }]]);
  assert.deepEqual(h.local, {});
  assert.equal(await h.g.account(), null);
  careful(h);

  const w = harness({ flow: 'web' });
  await w.g.connect();
  assert.deepEqual(await w.g.disconnect(), { ok: true, revoked: true, had: true });
  assert.equal(w.log.fetch.find((f) => f.url === G.REVOKE).init.body, 'token=web-tok-1');
  await assert.rejects(w.g.token(), (e) => e.why === 'connect', 'the token is gone from memory');
  assert.deepEqual(w.log.permRemoved, [{ permissions: ['identity'] }]);

  // Calendar sync connected: the grant they share isn't revoked, and its permission and Chrome's cache stay.
  for (const flow of ['chrome', 'web']) {
    const k = harness({ flow, keep: true });
    await k.g.connect();
    assert.deepEqual(await k.g.disconnect(), { ok: true, revoked: false, had: false });
    assert.ok(!k.log.fetch.some((f) => f.url === G.REVOKE), `${flow}: nothing revoked while Calendar uses the grant`);
    assert.deepEqual([k.log.cleared, k.log.permRemoved], [0, []]);
    assert.deepEqual(k.local, {});
    await assert.rejects(k.g.token(), (e) => e.why === 'connect', `${flow}: Drive's own state is gone`);
  }
});

test('drop(token): a token Google answered 401 to is forgotten, and the next token() is a fresh one, silently', async () => {
  const w = harness({ flow: 'web' });
  await w.g.connect();
  assert.equal(await w.g.token(), 'web-tok-1');
  await w.g.drop('someone-else');
  assert.equal(await w.g.token(), 'web-tok-1', 'another token: the held one stays');
  await w.g.drop('web-tok-1');
  const checks = w.log.fetch.filter((f) => f.url === G.USERINFO).length;
  assert.equal(await w.g.token(), 'web-tok-2', 'web: not the dead token again');
  assert.equal(w.log.launch.at(-1).interactive, false, 'renewed silently');
  assert.equal(w.log.fetch.filter((f) => f.url === G.USERINFO).length, checks + 1, 'and the new one is checked for the account');

  const c = harness();
  await c.g.connect();
  const t = await c.g.token();
  await c.g.drop(t);
  assert.deepEqual(c.log.removed, [t], 'Chrome forgets it from its cache');
  const checks2 = c.log.fetch.filter((f) => f.url === G.USERINFO).length;
  assert.notEqual(await c.g.token(), t);
  assert.equal(c.log.fetch.filter((f) => f.url === G.USERINFO).length, checks2 + 1);
  assert.equal(c.log.auth.at(-1).interactive, false);
  await harness().g.drop('x'); // not connected: nothing to do, and no throw
});

test('a token for another Google account than the one connected is refused, dropped, never used or revoked', async () => {
  for (const flow of ['chrome', 'web']) {
    const h = harness({ flow });
    await h.g.connect();
    const asked = () => h.log.fetch.filter((f) => f.url === G.USERINFO).length;
    // The same account: each new token is checked once, then trusted while it lives.
    assert.equal(typeof await h.g.token(), 'string');
    const once = asked();
    if (flow === 'web') { await h.g.token(); assert.equal(asked(), once, `${flow}: a held token isn't checked again`); }
    // The browser's account changes (Chrome's default account, or Google's session for the web flow).
    h.who.sub = '2'; h.who.email = 'someone.else@gmail.com';
    h.tick(3600 * 1000);
    await assert.rejects(h.g.token(), (e) => e.why === 'account', `${flow}: another account's token is refused`);
    if (flow === 'chrome') assert.ok(h.log.removed.length > 0, 'Chrome forgets that token');
    assert.deepEqual(await h.g.pick(), { ok: false, why: 'account' });
    assert.ok(!h.log.fetch.some((f) => C.picker.includes(f.url)), `${flow}: no picker opened with it`);
    assert.deepEqual(h.local.google.email, 'student@school.edu', 'the connection is still the one made');
    // Disconnect can't revoke the connected account's grant with another's token: it revokes nothing and says Google may still hold it.
    assert.deepEqual(await h.g.disconnect(), { ok: true, revoked: false, had: true });
    assert.ok(!h.log.fetch.some((f) => f.url === G.REVOKE), `${flow}: nothing revoked`);
    assert.deepEqual(h.local, {});
  }
});

test('a token checked for one account is never taken for the next: Connect A, Disconnect, Connect B, then A\'s cached token', async () => {
  const h = harness({ keep: true }); // Calendar holds the grant, so Disconnect leaves Chrome's cache as it is
  const A = { sub: 'A', email: 'a@school.edu' }, B = { sub: 'B', email: 'b@gmail.com' };
  Object.assign(h.owners, { 'tok-A': A, 'tok-B': B });
  h.identity.next = ['tok-A'];
  assert.deepEqual(await h.g.connect(), { ok: true, email: A.email });
  await h.g.disconnect();
  h.identity.next = ['tok-B'];
  assert.deepEqual(await h.g.connect(), { ok: true, email: B.email });
  h.identity.next = ['tok-A']; // Chrome hands back A's token
  await assert.rejects(h.g.token(), (e) => e.why === 'account', 'A\'s token is refused while B is connected');
  h.identity.next = ['tok-B'];
  assert.equal(await h.g.token(), 'tok-B');
});

test('Disconnect stops a Pick under way: no picker opens with the token, and no files come back', async () => {
  for (const keep of [true, false]) {
    const h = harness({ keep });
    await h.g.connect();
    let open;
    h.gate.picker = new Promise((r) => { open = r; });
    const picking = h.g.pick();
    while (!h.log.fetch.some((f) => C.picker.includes(f.url))) await new Promise((r) => setTimeout(r, 1)); // the probe is out
    assert.equal((await h.g.disconnect()).ok, true);
    open();
    assert.deepEqual(await picking, { ok: false, why: 'connect' }, `keep ${keep}`);
    assert.ok(!h.log.launch.length, 'the picker page never opened');
  }
});

test('a delayed token cannot survive Disconnect or replace a reconnected account', async () => {
  for (const flow of ['chrome', 'web']) for (const reconnect of [false, true]) {
    const h = harness({ flow, keep: true });
    await h.g.connect();
    h.tick(3600 * 1000);
    let release, entered;
    const waiting = new Promise((r) => { entered = r; });
    const gate = new Promise((r) => { release = r; });
    const method = flow === 'web' ? 'answer' : 'getAuthToken';
    const original = h.identity[method];
    h.identity[method] = async (d) => {
      h.identity[method] = original;
      const answer = await original(d);
      entered();
      await gate;
      return answer;
    };
    const late = assert.rejects(h.g.token(), (e) => e.why === 'connect');
    await waiting;
    await h.g.disconnect();
    if (reconnect) {
      Object.assign(h.who, { sub: 'B', email: 'b@school.edu' });
      await h.g.connect();
    }
    release();
    await late;
    if (reconnect) assert.equal(typeof await h.g.token(), 'string', `${flow}: the new account still works`);
    else await assert.rejects(h.g.token(), (e) => e.why === 'connect');
  }
});

test('Disconnect stops a failed silent renewal from opening another sign-in', async () => {
  const h = harness({ flow: 'web', keep: true });
  await h.g.connect();
  h.tick(3600 * 1000);
  let release, entered;
  const waiting = new Promise((r) => { entered = r; });
  const original = h.identity.answer;
  h.identity.answer = async () => {
    h.identity.answer = original;
    entered();
    await new Promise((r) => { release = r; });
    throw new Error('silent renewal needs interaction');
  };
  const picking = h.g.pick();
  await waiting;
  await h.g.disconnect();
  release();
  assert.deepEqual(await picking, { ok: false, why: 'connect' });
  assert.equal(h.log.launch.length, 2, 'only Connect and the silent renewal; no prompt after Disconnect');
});

test('native Disconnect cancels a pending sign-in even before an account is saved', async () => {
  const h = harness({ flow: 'native', config: { ...REAL, native: true }, native: async (m) => {
    if (m.type === 'google.status') return { ok: true };
    if (m.type === 'google.connect') return { ok: true, open: 'io.frostdev.glaze-google://signin', opened: true };
    if (m.type === 'google.finish') return { ok: false, why: 'pending' };
    if (m.type === 'google.disconnect') return { ok: true, revoked: false, had: false };
    throw new Error(m.type);
  } });
  assert.deepEqual(await h.g.connect(), { ok: false, why: 'pending' });
  assert.deepEqual(await h.g.disconnect(), { ok: true, revoked: false, had: false });
  assert.equal(h.log.native.filter((m) => m.type === 'google.disconnect').length, 1);
  await h.g.connect();
  assert.equal(h.log.native.filter((m) => m.type === 'google.connect').length, 2, 'the old pending attempt is not resumed');
  assert.deepEqual(h.log.permRemoved, [], 'Safari has no identity permission');
});

test('a stale native revoked response cannot erase a newer connection', async () => {
  let release, entered, account = { sub: 'A', email: 'a@school.edu' };
  const waiting = new Promise((r) => { entered = r; });
  const h = harness({ flow: 'native', config: { ...REAL, native: true }, native: async (m) => {
    if (m.type === 'google.status') return { ok: true };
    if (m.type === 'google.connect') return { ok: true, open: 'io.frostdev.glaze-google://signin', opened: true };
    if (m.type === 'google.finish') return { ok: true, ...account };
    if (m.type === 'google.token') {
      entered();
      return new Promise((r) => { release = r; });
    }
    throw new Error(m.type);
  } });
  await h.g.connect();
  const late = assert.rejects(h.g.token(), (e) => e.why === 'connect');
  await waiting;
  account = { sub: 'B', email: 'b@school.edu' };
  assert.equal((await h.g.connect()).ok, true);
  release({ ok: false, why: 'revoked' });
  await late;
  assert.equal(await h.g.account(), 'b@school.edu');
});

test('native drop forwards the refused token so the handler can renew it', async () => {
  let token = 'native-old';
  const h = harness({ flow: 'native', config: { ...REAL, native: true }, native: async (m) => {
    if (m.type === 'google.status') return { ok: true };
    if (m.type === 'google.connect') return { ok: true, open: 'io.frostdev.glaze-google://signin', opened: true };
    if (m.type === 'google.finish') return { ok: true, sub: 'A', email: 'a@school.edu' };
    if (m.type === 'google.token') return { ok: true, token };
    if (m.type === 'google.drop') { if (m.token === token) token = 'native-new'; return { ok: true }; }
    throw new Error(m.type);
  } });
  await h.g.connect();
  await h.g.drop('someone-else');
  assert.equal(await h.g.token(), 'native-old');
  await h.g.drop('native-old');
  assert.equal(await h.g.token(), 'native-new');
});

test('Disconnect after a worker restart, when silent renewal fails, says Google may still hold the grant', async () => {
  const h = harness({ flow: 'web' });
  await h.g.connect();
  // A new worker over the same storage: nothing in memory, and Google wants the student to sign in again.
  const restarted = G.create({
    on: true, config: REAL, flow: 'web', firefox: false,
    identity: () => ({ ...h.identity, launchWebAuthFlow: async (d) => { h.log.launch.push(d); return `${REDIRECT}#${new URLSearchParams({ error: 'interaction_required', state: new URL(d.url).searchParams.get('state') })}`; } }),
    permissions: { contains: async () => true, remove: async (p) => { h.log.permRemoved.push(p); return true; } },
    manifest: () => ({ oauth2: { client_id: REAL.chrome } }),
    storage: { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in h.local).map((x) => [x, h.local[x]]))), set: async (v) => Object.assign(h.local, v), remove: async (k) => { for (const x of [].concat(k)) delete h.local[x]; } },
    fetch: async (url) => { h.log.fetch.push({ url, init: {} }); return new Response('', { status: 200 }); },
    keep: async () => false, now: () => 2_000_000,
  });
  assert.deepEqual(await restarted.disconnect(), { ok: true, revoked: false, had: true });
  assert.equal(h.log.launch.at(-1).interactive, false, 'never a prompt');
  assert.ok(!h.log.fetch.some((f) => f.url === G.REVOKE));
  assert.deepEqual([h.local, h.log.permRemoved], [{}, [{ permissions: ['identity'] }]]);
  // Nothing was connected: nothing to warn about.
  assert.deepEqual(await harness().g.disconnect(), { ok: true, revoked: false, had: false });
});

test('the web flow without the identity permission (taken back in the browser\'s add-on settings) asks for it, never a TypeError', async () => {
  for (const firefox of [false, true]) {
    const h = harness({ flow: 'web', firefox, granted: false });
    h.local.google = { email: 'student@school.edu', sub: '1', flow: 'web', at: 1 };
    await assert.rejects(h.g.token(), (e) => e.why === 'permission', 'a sync run');
    await assert.rejects(h.g.token({ interactive: true }), (e) => e.why === 'permission', 'a Drive action');
    assert.deepEqual(await h.g.pick(), { ok: false, why: 'permission' });
    assert.deepEqual(h.log.launch, []);
  }
});

test('offline: a sign-in the browser couldn\'t reach Google for says network, not that Drive needs connecting again', async () => {
  // The worker's navigator.onLine: false only when the browser knows it is offline.
  const offline = async (f) => {
    const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
    try { await f(); } finally { if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; }
  };
  const w = harness({ flow: 'web' });
  await w.g.connect();
  w.tick(3600 * 1000);
  w.identity.launchWebAuthFlow = async () => { throw new Error('Authorization page could not be loaded.'); };
  await offline(() => assert.rejects(w.g.token(), (e) => e.why === 'network', 'web: the silent renewal'));
  await assert.rejects(w.g.token(), (e) => e.why === 'auth', 'online: Google wants a sign-in (signed out, for one)');
  const c = harness();
  await c.g.connect();
  c.identity.fail = 'OAuth2 request failed: Connection failed (-106).';
  await offline(() => assert.rejects(c.g.token(), (e) => e.why === 'network', 'chrome: getAuthToken'));
  await assert.rejects(c.g.token(), (e) => e.why === 'auth');
  noToken(w);
  noToken(c);
});

test('the picker\'s answer: our state, files with an id, a name and a type, or a cancel', () => {
  const s = 'S'.repeat(43);
  const file = { id: '1AbC_d-EfGh', name: 'Notes.pdf', mimeType: 'application/pdf' };
  const at = (p) => `${REDIRECT}#${new URLSearchParams(p)}`;
  assert.deepEqual(G.picked(at({ state: s, action: 'picked', files: JSON.stringify([file, { ...file, id: 'x2', mimeType: 'application/vnd.google-apps.document', extra: 'dropped' }]) }), s),
    [file, { ...file, id: 'x2', mimeType: 'application/vnd.google-apps.document' }]);
  assert.deepEqual(G.picked(at({ state: s, action: 'cancel' }), s), []);
  const why = (url, st = s) => { try { G.picked(url, st); } catch (e) { return e.why; } };
  assert.equal(why(at({ state: 'other', action: 'cancel' })), 'state');
  assert.equal(why(at({ action: 'cancel' })), 'state');
  assert.equal(why(`${at({ state: s, action: 'cancel' })}&state=${s}`), 'state');
  assert.equal(why(`${REDIRECT}?state=${s}&action=cancel`), 'state', 'the fragment only');
  assert.equal(why(at({ state: s, action: 'picked', files: '[' })), 'picker');
  assert.equal(why(at({ state: s, action: 'picked', files: '[]' })), 'picker');
  assert.equal(why(at({ state: s, action: 'picked', files: JSON.stringify([{ ...file, id: '../x' }]) })), 'picker');
  for (const id of [undefined, null, 123, true, ['abc'], { id: 'abc' }]) assert.equal(why(at({ state: s, action: 'picked', files: JSON.stringify([{ ...file, id }]) })), 'picker', `id ${JSON.stringify(id)}`);
  assert.equal(why(at({ state: s, action: 'picked', files: JSON.stringify([{ ...file, mimeType: 'pdf' }]) })), 'picker');
  assert.equal(why(at({ state: s, action: 'picked', files: JSON.stringify([{ ...file, name: '' }]) })), 'picker');
  assert.equal(why(at({ state: s, action: 'picked', files: JSON.stringify(Array(101).fill(file)) })), 'picker');
  assert.equal(why(at({ state: s, error: 'popup_closed' })), 'picker');
});

test('pick: frostdev.io first, its GitHub Pages copy when it doesn\'t load, the token and state in the fragment', async () => {
  const h = harness();
  await h.g.connect();
  const r = await h.g.pick();
  assert.deepEqual(r, { ok: true, files: [{ id: '1AbC_d-EfGh', name: 'Essay draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] });
  const probes = h.log.fetch.filter((f) => C.picker.includes(f.url));
  assert.deepEqual(probes.map((f) => [f.url, f.init.method]), [[C.picker[0], 'HEAD']]);
  const d = h.log.launch.at(-1);
  assert.equal(d.interactive, true);
  const u = new URL(d.url);
  assert.equal(`${u.origin}${u.pathname}`, C.picker[0]);
  assert.equal(u.search, '', 'nothing in the query');
  const f = new URLSearchParams(u.hash.slice(1));
  assert.deepEqual([f.get('access_token'), f.get('redirect_uri'), f.get('key'), f.get('app_id')], ['chrome-tok-2', REDIRECT, REAL.apiKey, REAL.appId]);
  assert.match(f.get('state'), /^[\w-]{43}$/);
  careful(h);
  noToken(h);

  const down = harness({ up: [false, true] });
  await down.g.connect();
  assert.equal((await down.g.pick()).ok, true);
  assert.deepEqual(down.log.fetch.filter((x) => C.picker.includes(x.url)).map((x) => x.url), C.picker);
  assert.equal(new URL(down.log.launch.at(-1).url).origin, 'https://frostdev-ops.github.io');

  const off = harness({ up: [false, false] });
  await off.g.connect();
  assert.deepEqual(await off.g.pick(), { ok: false, why: 'offline' });
  assert.equal(off.log.launch.length, 0);

  const stray = harness();
  await stray.g.connect();
  stray.identity.answer = () => `${REDIRECT}#state=nope&action=picked&files=${encodeURIComponent('[{"id":"a","name":"b","mimeType":"a/b"}]')}`;
  assert.deepEqual(await stray.g.pick(), { ok: false, why: 'state' });

  assert.deepEqual(await harness().g.pick(), { ok: false, why: 'connect' });
});

test('the worker gives background/google.js a way to open the sign-in tab the student taps (iOS), from the worker', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8');
  const env = src.slice(src.indexOf('google = GZ_GOOGLE.create({'), src.indexOf('});', src.indexOf('google = GZ_GOOGLE.create({')));
  assert.match(env, /open: \(url\) => chrome\.tabs\.create\(\{ url \}\)/);
});

test('the worker answers glaze:google from Settings only (pick from Glaze\'s own pages), loading background/google.js on first use', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8');
  assert.match(src, /globalThis\.addEventListener\?\.\('install', \(\) => importScripts\('oauth\.js', 'google-config\.js', 'google\.js'\)\)/);
  const at = src.indexOf("m?.type !== 'glaze:google'");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('return true;', at));
  assert.match(body, /m\.op === 'pick' \? googlePage\(s\) : fromEditor\(s\)/);
  // Nothing about Google in any site's first script.
  const m = require('../../extension/manifest.json');
  for (const c of m.content_scripts) for (const f of c.js) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8'), /GZ_GOOGLE|glaze:google|GZ_OAUTH|google-config/, f);
});

// ---- packaging: what each package's manifest carries for Google ----
const repo = require('../../extension/manifest.json');
test('packages: placeholders leave Drive out, so a build asks for no identity and carries no oauth2', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, drive: true, config: BLANK });
  assert.equal(chrome.oauth2, undefined);
  assert.ok(!(chrome.optional_permissions || []).includes('identity'));
  const firefox = oauth(repo, { target: 'firefox', calendar: false, drive: true, config: BLANK });
  assert.equal(firefox.oauth2, undefined);
  assert.ok(!(firefox.optional_permissions || []).includes('identity'));
  const { oauth2, optional_permissions: optional, ...rest } = repo;
  assert.deepEqual(chrome, { ...rest, optional_permissions: optional.filter((p) => p !== 'identity') }, 'nothing else changes');
});

test('packages: real ids give Chrome the Drive client and its three scopes, without Calendar\'s while Calendar is off', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, drive: true, config: REAL });
  assert.deepEqual(chrome.oauth2, { client_id: REAL.chrome, scopes: C.scopes });
  assert.deepEqual(chrome.optional_permissions, repo.optional_permissions, 'identity stays optional');
  assert.ok(!chrome.permissions.includes('identity'));
  const both = oauth(repo, { target: 'chrome', calendar: true, drive: true, config: REAL });
  assert.deepEqual(both.oauth2.scopes, ['https://www.googleapis.com/auth/calendar.app.created', ...C.scopes]);
  const cal = oauth(repo, { target: 'chrome', calendar: true, drive: true, config: BLANK });
  assert.deepEqual(cal.oauth2, repo.oauth2, 'Calendar alone: the manifest as it is');
  const web = oauth(repo, { target: 'chrome', calendar: false, drive: true, config: { ...REAL, chrome: BLANK.chrome } });
  assert.equal(web.oauth2, undefined, 'only the Web client: Edge and Brave sign in, Chrome waits');
  assert.ok(web.optional_permissions.includes('identity'));
  const firefox = oauth(repo, { target: 'firefox', calendar: false, drive: true, config: REAL });
  assert.equal(firefox.oauth2, undefined);
  assert.ok(firefox.optional_permissions.includes('identity'), 'Firefox signs in with the Web client');
});

test('packages: switched on, the shipped config gives Chrome Calendar\'s client with Drive\'s three scopes, and Firefox identity', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, drive: true, config: C });
  assert.deepEqual(chrome.oauth2, { client_id: repo.oauth2.client_id, scopes: C.scopes });
  assert.deepEqual(chrome.optional_permissions, repo.optional_permissions);
  const firefox = oauth(repo, { target: 'firefox', calendar: false, drive: true, config: C });
  assert.equal(firefox.oauth2, undefined);
  assert.deepEqual(firefox.optional_permissions, repo.optional_permissions);
});

// ---- the build-time switch (background/google.js ON): off on this branch, as Calendar's is, until the release that ships Drive ----
test('Drive is switched off: the worker refuses, Settings has no row, and the packages carry neither oauth2 nor identity', async () => {
  assert.equal(G.ON, false);
  const h = harness({ on: G.ON }); // the shipped switch
  assert.deepEqual(await h.g.status(), { ok: false, why: 'off' });
  assert.deepEqual(await h.g.connect(), { ok: false, why: 'off' });
  assert.deepEqual(await h.g.pick(), { ok: false, why: 'off' });
  await assert.rejects(h.g.token(), (e) => e.why === 'off');
  assert.deepEqual([h.log.auth, h.log.launch, h.log.fetch, h.local], [[], [], [], {}]);
  for (const target of ['chrome', 'firefox']) {
    const m = oauth(repo, { target, calendar: false, drive: G.ON, config: C });
    assert.equal(m.oauth2, undefined, target);
    assert.ok(!(m.optional_permissions || []).includes('identity'), target);
  }
  const src = fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8');
  const at = src.indexOf("m?.type !== 'glaze:google'");
  assert.match(src.slice(at, src.indexOf('return true;', at)), /if \(!GZ_GOOGLE\.ON\) \{ reply\(\{ ok: false, why: 'off' \}\); return; \}/, 'the worker refuses every operation');
});

test('scripts/dev-drive.sh: a dev copy with Drive on, Glaze\'s client and scopes, identity and the store key; the package and repo stay off', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-drive-pkg-'));
  try {
    const keyFile = path.join(dir, 'key.txt');
    fs.writeFileSync(keyFile, require('node:crypto').randomBytes(294).toString('base64'));
    const out = execFileSync(path.join(__dirname, '../../tools/dev/dev-drive.sh'), [keyFile, path.join(dir, 'dev')], { env: { ...process.env, DIST: path.join(dir, 'dist') }, encoding: 'utf8', stdio: 'pipe' });
    assert.match(out, /extension ID [a-p]{32}/);
    const zip = path.join(dir, 'dist', `glaze-v${repo.version}.zip`);
    const packed = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json']));
    // The store package: Calendar's scope alone (planner/gcal.js ON), nothing of Drive's.
    const CAL = 'https://www.googleapis.com/auth/calendar.app.created', calendar = require('../../extension/planner/gcal.js').ON === true;
    assert.deepEqual(packed.oauth2?.scopes, calendar ? [CAL] : undefined, 'the store package: no Drive scope');
    assert.equal((packed.optional_permissions || []).includes('identity'), calendar);
    assert.match(execFileSync('unzip', ['-p', zip, 'background/google.js']).toString(), /\n {2}const ON = false;\n/);
    const dev = JSON.parse(fs.readFileSync(path.join(dir, 'dev/manifest.json')));
    assert.deepEqual(dev.oauth2, { client_id: C.chrome, scopes: [...(calendar ? [CAL] : []), ...C.scopes] }, 'the dev copy: Calendar\'s scope while it is on, and Drive\'s');
    assert.deepEqual(dev.optional_permissions, repo.optional_permissions);
    assert.equal(dev.key, fs.readFileSync(keyFile, 'utf8'));
    assert.match(fs.readFileSync(path.join(dir, 'dev/background/google.js'), 'utf8'), /\n {2}const ON = true;\n/);
    assert.equal(G.ON, false, "the repo's switch is untouched");
    assert.ok(!('key' in repo));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
