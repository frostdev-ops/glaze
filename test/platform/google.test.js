// Google sign-in for Drive (background/google.js, background/google-config.js) and the Picker hand-off, with chrome.identity, permissions,
// storage and fetch stubbed: connect on each flow, silent renewal, a state that isn't ours refused, Disconnect on this device only, no
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
    const i = config.picker.indexOf(url);
    if (i >= 0) { await gate.picker; if (up[i]) return new Response('', { status: 200 }); throw new TypeError('Failed to fetch'); }
    throw new Error(`unexpected request: ${url}`);
  };
  const g = G.create({
    on, config, flow, firefox,
    identity: () => (granted ? identity : undefined),
    // Firefox lists identity only as a permission held from install (its identity schema extends PermissionNoPrompt), and its
    // permissions API takes only optional ones: asked about identity, it throws.
    permissions: firefox
      ? { contains: () => { throw new TypeError('Type error for parameter permissions (Error processing permissions.0: Value "identity" must either: be one of ...)'); }, remove: (p) => { log.permRemoved.push(p); throw new TypeError('Type error for parameter permissions'); } }
      : { contains: async ({ permissions }) => granted && permissions.join() === 'identity', remove: async (p) => { log.permRemoved.push(p); return true; } },
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
  assert.equal(C.native, true, 'Safari signs in through the Glaze app');
  assert.deepEqual(['chrome', 'web', 'native'].map((f) => G.ready(C, f)), [true, true, true]);
  assert.equal(G.pickable(C), true);
  for (const f of ['chrome', 'web', 'native']) assert.equal(G.ready(BLANK, f), false, f);
  assert.equal(G.ready(REAL, 'chrome'), true);
  assert.equal(G.ready(REAL, 'web'), true);
  assert.equal(G.ready({ ...REAL, native: false }, 'native'), false, 'native also needs config.native');
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
  const s = harness({ flow: 'native', config: { ...REAL, native: false } });
  assert.deepEqual(await s.g.status(), { ok: false, why: 'browser' }, 'Safari with its sign-in switched off');
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
  assert.deepEqual(await h.g.status(), { ok: true, flow: 'chrome', email: null, picker: true });
  assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' });
  assert.deepEqual(h.log.auth, [{ interactive: true, scopes: C.scopes }]);
  assert.equal(h.log.fetch[0].url, G.USERINFO);
  assert.equal(h.log.fetch[0].init.headers.authorization, 'Bearer chrome-tok-1');
  assert.deepEqual(h.local.google, { email: 'student@school.edu', sub: '1', flow: 'chrome', at: 1_000_000 });
  assert.equal(await h.g.account(), 'student@school.edu');
  assert.deepEqual(await h.g.status(), { ok: true, flow: 'chrome', email: 'student@school.edu', picker: true });
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
  assert.deepEqual(await dev.g.status(), { ok: true, flow: 'web', email: null, picker: true });
  assert.equal((await dev.g.connect()).ok, true);
  assert.deepEqual([dev.log.auth.length, dev.log.launch.length, dev.local.google.flow], [0, 1, 'web']);
  const edge = harness();
  edge.identity.fail = 'This API is not supported on Microsoft Edge.';
  assert.equal((await edge.g.connect()).ok, true);
  assert.deepEqual([edge.log.auth.length, edge.log.launch.length, edge.local.google.flow], [1, 1, 'web']);
  noToken(edge);
});

// Least privilege (owner, 2026-10-31): without include_granted_scopes a web-flow token carries Drive's scopes alone, so the
// one that reaches the Picker page can't reach Calendar or anything else Glaze's project was ever granted.
test('every sign-in asks for Drive\'s three scopes alone, never include_granted_scopes: Connect, silent renewal and the Picker\'s token', async () => {
  const u = new URL(G.authUrl(REAL, { redirect: REDIRECT, state: 's', prompt: 'none', hint: 'a@b.edu' }));
  assert.deepEqual([...u.searchParams.keys()].sort(), ['client_id', 'login_hint', 'prompt', 'redirect_uri', 'response_type', 'scope', 'state']);
  for (const firefox of [false, true]) {
    const h = harness({ flow: 'web', firefox });
    await h.g.connect();
    h.tick(3600 * 1000);
    await h.g.token();
    h.tick(3600 * 1000);
    assert.equal((await h.g.pick()).ok, true);
    const signins = h.log.launch.filter((d) => new URL(d.url).origin === 'https://accounts.google.com');
    assert.deepEqual(signins.map((d) => new URL(d.url).searchParams.get('prompt')), ['select_account', 'none', 'none'], `firefox ${firefox}`);
    for (const d of signins) {
      const q = new URL(d.url).searchParams;
      assert.equal(q.get('scope'), `${DRIVE} openid email`);
      assert.equal(q.has('include_granted_scopes'), false, `firefox ${firefox}: ${d.url}`);
    }
  }
  const c = harness();
  await c.g.connect();
  await c.g.token();
  assert.equal((await c.g.pick()).ok, true);
  assert.ok(c.log.auth.length >= 3);
  for (const d of c.log.auth) assert.deepEqual(d.scopes, C.scopes, 'Chrome: getAuthToken for the three scopes, each time');
});

// A Chromium with no Google account signed in to the browser (or browser sign-in turned off) can't answer getAuthToken.
test('Chrome without a Google account in the browser: Connect takes the web flow instead, and says why when it can\'t', async () => {
  for (const fail of ['The user is not signed in.', 'The user turned off browser signin']) {
    const h = harness();
    h.identity.fail = fail;
    assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' }, fail);
    assert.deepEqual([h.log.auth.length, h.log.launch.length, h.local.google.flow], [1, 1, 'web'], fail);
    assert.equal(new URL(h.log.launch[0].url).searchParams.get('prompt'), 'select_account');
    assert.equal(await h.g.token(), 'web-tok-1', 'later requests use the web flow');
    assert.equal(h.log.auth.length, 1);
    noToken(h);
  }
  // The student closing Chrome's own consent is a cancel, never a second sign-in behind it.
  const no = harness();
  no.identity.fail = 'The user did not approve access.';
  assert.deepEqual(await no.g.connect(), { ok: false, why: 'cancel' });
  assert.equal(no.log.launch.length, 0);
  // A build with no web client: a reason Settings can say, not silence.
  const only = harness({ config: { ...REAL, web: 'PLACEHOLDER-web.apps.googleusercontent.com' } });
  only.identity.fail = 'The user is not signed in.';
  assert.deepEqual(await only.g.connect(), { ok: false, why: 'signin' });
  assert.deepEqual(only.local, {});
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
    client_id: REAL.web, response_type: 'token', redirect_uri: REDIRECT, scope: `${DRIVE} openid email`, prompt: 'select_account',
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
  assert.deepEqual(await h.g.disconnect(), { ok: true });
  assert.deepEqual(h.log.permRemoved, [], 'identity is the package\'s own on Firefox: nothing to give back');
});

test('without the Picker key, signing in, the token and Disconnect work, and only Pick says setup', async () => {
  for (const flow of ['chrome', 'web']) {
    const h = harness({ flow, config: { ...REAL, apiKey: 'PLACEHOLDER' } });
    assert.deepEqual(await h.g.status(), { ok: true, flow, email: null, picker: false }, `${flow}: Settings offers Connect`);
    assert.deepEqual(await h.g.connect(), { ok: true, email: 'student@school.edu' });
    assert.equal(typeof await h.g.token(), 'string');
    assert.equal(await h.g.account(), 'student@school.edu');
    const before = h.log.launch.length;
    assert.deepEqual(await h.g.pick(), { ok: false, why: 'setup' });
    assert.equal(h.log.launch.length, before, 'no picker opened');
    assert.ok(!h.log.fetch.some((f) => C.picker.includes(f.url)), 'nor probed');
    assert.deepEqual(await h.g.disconnect(), { ok: true });
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

// Disconnect is this device only (owner, 2026-10-31): Google's grant stays, so Drive and Calendar on the student's other
// devices, and Calendar here, keep working. Removing Glaze everywhere is Google's own account page.
test('Disconnect forgets the account, its tokens and identity here, and never revokes Google\'s grant', async () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../extension/background/google.js'), 'utf8'), /oauth2\.googleapis\.com\/revoke|REVOKE/, 'no revoke path left');
  const h = harness();
  await h.g.connect();
  const asked = h.log.fetch.length, auth = h.log.auth.length;
  assert.deepEqual(await h.g.disconnect(), { ok: true });
  assert.equal(h.log.fetch.length, asked, 'nothing sent to Google');
  assert.equal(h.log.auth.length, auth, 'no token asked for');
  assert.deepEqual([h.log.cleared, h.log.permRemoved], [1, [{ permissions: ['identity'] }]]);
  assert.deepEqual(h.local, {});
  assert.equal(await h.g.account(), null);
  await assert.rejects(h.g.token(), (e) => e.why === 'connect');

  const w = harness({ flow: 'web' });
  await w.g.connect();
  const sent = w.log.fetch.length, launched = w.log.launch.length;
  assert.deepEqual(await w.g.disconnect(), { ok: true });
  assert.deepEqual([w.log.fetch.length, w.log.launch.length], [sent, launched]);
  await assert.rejects(w.g.token(), (e) => e.why === 'connect', 'the token is gone from memory');
  assert.deepEqual(w.log.permRemoved, [{ permissions: ['identity'] }]);

  // Calendar sync connected through Chrome's own client: its permission and Chrome's cache stay.
  for (const flow of ['chrome', 'web']) {
    const k = harness({ flow, keep: true });
    await k.g.connect();
    const before = k.log.fetch.length;
    assert.deepEqual(await k.g.disconnect(), { ok: true });
    assert.equal(k.log.fetch.length, before, `${flow}: nothing sent to Google`);
    assert.deepEqual([k.log.cleared, k.log.permRemoved], [0, []]);
    assert.deepEqual(k.local, {});
    await assert.rejects(k.g.token(), (e) => e.why === 'connect', `${flow}: Drive's own state is gone`);
  }
  // Nothing connected: the same answer.
  assert.deepEqual(await harness().g.disconnect(), { ok: true });
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

test('a token for another Google account than the one connected is refused, dropped and never used', async () => {
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
    assert.deepEqual(await h.g.disconnect(), { ok: true });
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

test('status says where the Picker works, so From Google Drive shows only there: not Safari\'s app flow, nor a build without its key', async () => {
  for (const flow of ['chrome', 'web']) {
    assert.equal((await harness({ flow }).g.status()).picker, true, flow);
    assert.equal((await harness({ flow, config: { ...REAL, apiKey: 'PLACEHOLDER' } }).g.status()).picker, false, `${flow}: no Picker key`);
  }
  const s = harness({ flow: 'native', config: { ...REAL, native: true }, native: async (m) => (m.type === 'google.status' ? { ok: true } : null) });
  s.local.google = { email: 'student@icloud.com', sub: '9', flow: 'native', at: 1 };
  assert.deepEqual(await s.g.status(), { ok: true, flow: 'native', email: 'student@icloud.com', picker: false, pending: false }, 'Safari: connected, Save to Drive and Sync work');
  assert.deepEqual(await s.g.pick(), { ok: false, why: 'browser' }, 'and Pick refuses there, which reconnecting can\'t change');
});

test('native Disconnect cancels a pending sign-in even before an account is saved', async () => {
  const h = harness({ flow: 'native', config: { ...REAL, native: true }, native: async (m) => {
    if (m.type === 'google.status') return { ok: true };
    if (m.type === 'google.connect') return { ok: true, open: 'io.frostdev.glaze-google://signin', opened: true };
    if (m.type === 'google.finish') return { ok: false, why: 'pending' };
    if (m.type === 'google.disconnect') return { ok: true, had: false };
    throw new Error(m.type);
  } });
  assert.deepEqual(await h.g.connect(), { ok: false, why: 'pending' });
  assert.deepEqual(await h.g.disconnect(), { ok: true });
  assert.equal(h.log.native.filter((m) => m.type === 'google.disconnect').length, 1);
  await h.g.connect();
  assert.equal(h.log.native.filter((m) => m.type === 'google.connect').length, 2, 'the old pending attempt is not resumed');
  assert.deepEqual(h.log.permRemoved, [], 'Safari has no identity permission');
});

// Safari's handler as a stand-in: it holds the sign-in under way and the refresh token (as GlazeGoogle.swift does, in the
// Keychain and the app group), outliving any worker. answer(): the app finishing the sign-in.
const handler = () => {
  const h = { pending: false, answered: false, refresh: null, minted: 0, exp: 0, sent: [], clock: 1_000_000 };
  h.native = async (m) => {
    h.sent.push(m);
    if (m.feature !== undefined) throw new Error(`Drive's messages name no feature: ${m.feature}`);
    if (m.type === 'google.status') return { ok: true, email: h.refresh?.email ?? null, sub: h.refresh?.sub ?? null, pending: h.pending };
    if (m.type === 'google.connect') { h.pending = true; h.answered = false; return { ok: true, pending: true, open: 'io.frostdev.glaze-google://signin?state=s', opened: true }; }
    if (m.type === 'google.finish') {
      if (!h.pending) return { ok: false, why: 'signin' };
      if (!h.answered) return { ok: false, why: 'pending' };
      h.pending = false; h.refresh = { sub: 'S1', email: 'student@icloud.com' };
      return { ok: true, ...h.refresh };
    }
    if (m.type === 'google.token') {
      if (!h.refresh) return { ok: false, why: 'signin' };
      h.minted++; h.exp = h.clock + 3599e3;
      return { ok: true, token: `native-${h.minted}`, expiresAt: h.exp };
    }
    if (m.type === 'google.drop') return { ok: true };
    if (m.type === 'google.disconnect') { const had = !!h.refresh; h.refresh = null; h.pending = false; return { ok: true, had }; }
    throw new Error(m.type);
  };
  return h;
};
// A worker over shared storage and the handler; a new one is a worker Safari loaded again, nothing in memory.
const nativeWorker = (h, local) => G.create({
  on: true, config: { ...REAL, native: true }, flow: 'native', storage: { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in local).map((x) => [x, local[x]]))), set: async (v) => Object.assign(local, structuredClone(v)), remove: async (k) => { for (const x of [].concat(k)) delete local[x]; } },
  fetch: async (url) => { throw new Error(`unexpected request: ${url}`); }, native: h.native, open: async () => { throw new Error('the Mac handler opens the app'); },
  manifest: () => ({}), identity: () => undefined, permissions: { contains: async () => false, remove: async () => true }, keep: async () => false, now: () => h.clock,
});

test('Safari: a sign-in Safari unloaded the worker during finishes from the next worker, never starting another', async () => {
  const h = handler(), local = {};
  const a = nativeWorker(h, local);
  assert.deepEqual(await a.connect(), { ok: false, why: 'pending' });
  assert.deepEqual(await a.status(), { ok: true, flow: 'native', email: null, picker: false, pending: true }, 'Settings sees the sign-in under way');
  h.answered = true; // the student finished in the app; Safari had unloaded the worker meanwhile
  const b = nativeWorker(h, local);
  assert.deepEqual(await b.finish(), { ok: true, email: 'student@icloud.com' });
  assert.equal(h.sent.filter((m) => m.type === 'google.connect').length, 1, 'one sign-in, never a second');
  assert.deepEqual(local.google, { email: 'student@icloud.com', sub: 'S1', flow: 'native', at: h.clock });
  assert.deepEqual(await b.finish(), { ok: false, why: 'signin' }, 'nothing left to finish: the next Connect starts again');
  assert.equal((await b.status()).pending, false);
  assert.equal(await nativeWorker(h, {}).finish().then((r) => r.why), 'signin');
  const web = harness({ flow: 'web' });
  assert.deepEqual(await web.g.finish(), { ok: false, why: 'request' }, 'only Safari finishes a sign-in');
});

test('Safari: a token is held until a minute before it expires, and after Safari unloads the worker the handler mints one with no sign-in', async () => {
  const h = handler(), local = {};
  const a = nativeWorker(h, local);
  await a.connect();
  h.answered = true;
  assert.equal((await a.finish()).ok, true);
  const tokens = () => h.sent.filter((m) => m.type === 'google.token');
  assert.equal(await a.token(), 'native-1');
  assert.equal(await a.token(), 'native-1');
  assert.equal(tokens().length, 1, 'a run\'s requests share the held token');
  assert.deepEqual(tokens()[0], { type: 'google.token', sub: 'S1' }, 'bound to the connected account');
  h.clock = h.exp - 60e3; // its last minute
  assert.equal(await a.token(), 'native-2');
  assert.equal(tokens().length, 2);
  const b = nativeWorker(h, local); // Safari unloaded the worker and loaded it again
  assert.equal(await b.token(), 'native-3');
  assert.equal(h.sent.filter((m) => m.type === 'google.connect').length, 1, 'no sign-in again');
  await b.drop('native-3');
  assert.equal(await b.token(), 'native-4', 'a refused token is never handed out again');
  assert.deepEqual(await b.disconnect(), { ok: true });
  await assert.rejects(b.token(), (e) => e.why === 'connect');
  assert.equal(tokens().length, 4, 'Disconnect forgets the held token: nothing asked once disconnected');
});

test('Safari: a late token mint cannot put a refused token back over its replacement', async () => {
  const h = handler(), local = { google: { email: 'student@icloud.com', sub: 'S1', flow: 'native', at: 1 } };
  let minted = 0, release, entered;
  const waiting = new Promise((ok) => { entered = ok; });
  const gate = new Promise((ok) => { release = ok; });
  const native = h.native;
  h.native = async (m) => {
    if (m.type !== 'google.token') return native(m);
    const n = ++minted;
    if (n === 2) { entered(); await gate; }
    return { ok: true, token: n <= 2 ? 'refused' : 'replacement', expiresAt: h.clock + 3600e3 };
  };
  const w = nativeWorker(h, local);
  const first = w.token(), late = w.token();
  try {
    assert.equal(await first, 'refused');
    await waiting;
    await w.drop('refused');
    assert.equal(await w.token(), 'replacement');
    release();
    await late;
    assert.equal(await w.token(), 'replacement', 'the late reply must not poison the token cache');
    assert.equal(minted, 3, 'the replacement stays cached');
  } finally { release(); await late; }
});

test('Safari: a grant committed before the worker lost its finish reply is recovered from the handler', async () => {
  for (const old of [null, { email: 'old@school.edu', sub: 'OLD', flow: 'native', at: 1 }]) {
    const h = handler(), local = old ? { google: old } : {};
    await nativeWorker(h, local).connect();
    h.answered = true;
    // The handler finished, but Safari ended the worker before nativeSave ran.
    await h.native({ type: 'google.finish' });
    const fresh = nativeWorker(h, local);
    assert.equal((await fresh.status()).email, 'student@icloud.com');
    assert.equal(local.google.sub, 'S1');
    assert.equal(await fresh.token(), 'native-1');
    assert.equal(h.sent.filter((m) => m.type === 'google.connect').length, 1);
  }
});

test('Safari: a lost native Disconnect reply keeps Drive connected and retryable until the handler confirms deletion', async () => {
  const h = handler(), local = {};
  const real = h.native;
  let fail = false;
  h.native = (m) => m.type === 'google.disconnect' && fail ? Promise.reject(new Error('native host unavailable')) : real(m);
  const w = nativeWorker(h, local);
  await w.connect(); h.answered = true; await w.finish();
  fail = true;
  assert.deepEqual(await w.disconnect(), { ok: false, why: 'network' });
  assert.equal(local.google.sub, 'S1');
  assert.ok(h.refresh);
  fail = false;
  assert.deepEqual(await w.disconnect(), { ok: true });
  assert.equal(local.google, undefined);
  assert.equal(h.refresh, null);
});

test('Safari: native tokens with an expired or unknown expiry are never cached beyond their lifetime', async () => {
  for (const expiresAt of [999999, undefined, NaN, Infinity]) {
    let calls = 0;
    const grant = G.nativeGrant({ now: () => 1000000, native: async () => ({ ok: true, token: `token-${++calls}`, expiresAt }) }, 'calendar');
    assert.equal((await grant.mint()).token, 'token-1');
    assert.equal((await grant.mint()).token, 'token-2', `expiry ${expiresAt} cannot be extended in the worker`);
  }
});

// Safari's Picker: the picker page in a tab of the worker's, coming back to documents/picked.html (background/background.js),
// the pick under way held outside the worker's memory (env.hold: storage.session), so a worker Safari loaded again ends it.
const BACK = 'safari-web-extension://6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B/documents/picked.html';
const pickWorker = (h, local, held, { tabs = [], fetch, ...extra } = {}) => G.create({
  on: true, config: { ...REAL, native: true }, flow: 'native', now: () => h.clock,
  storage: { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in local).map((x) => [x, local[x]]))), set: async (v) => Object.assign(local, structuredClone(v)), remove: async (k) => { for (const x of [].concat(k)) delete local[x]; } },
  fetch: fetch || (async (url, init) => { if (REAL.picker.includes(url) && init.method === 'HEAD') return new Response('', { status: 200 }); throw new Error(`unexpected request: ${url}`); }),
  native: h.native, open: async () => {}, manifest: () => ({}), identity: () => undefined, permissions: { contains: async () => false, remove: async () => true }, keep: async () => false,
  tab: async (url) => { tabs.push(url); return 40 + tabs.length; }, back: () => BACK,
  show: async (tab, url) => { tabs[tab - 41] = url; }, shut: async () => {},
  hold: { get: async () => structuredClone(held.v ?? null), set: async (v) => { held.v = v ? structuredClone(v) : null; } },
  ...extra,
});
const answer = (state, more) => `${BACK}#${new URLSearchParams({ state, ...more })}`;
const FILE = { id: '1AbC_d-EfGh', name: 'Essay draft.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

const picking = async (extra = {}) => {
  const h = handler(), local = {}, held = {}, tabs = [];
  const w = pickWorker(h, local, held, { tabs, ...extra });
  await w.connect(); h.answered = true; await w.finish();
  return { h, local, held, tabs, w };
};

test('Safari Picker rejects a wrong state without consuming or closing the real choice', async () => {
  const { w, held } = await picking();
  await w.pick();
  const { state, tab } = held.v;
  assert.deepEqual(await w.back(answer('wrong', { action: 'cancel' }), tab), { ok: false, why: 'state' });
  assert.equal(held.v.done, undefined);
  assert.deepEqual(await w.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }), tab), { ok: true });
  assert.deepEqual(await w.picked(state), { ok: true, files: [FILE] });
});

test('Safari Picker polls belong to one invocation, including after a worker restart', async () => {
  const { w, h, local, held } = await picking();
  const first = await w.pick();
  const second = await w.pick();
  assert.equal(typeof second.state, 'string');
  assert.notEqual(first.state, second.state);
  const b = pickWorker(h, local, held);
  await b.back(answer(second.state, { action: 'picked', files: JSON.stringify([FILE]) }), held.v.tab);
  for (const state of [undefined, first.state]) assert.deepEqual(await b.picked(state), { ok: false, why: 'state' });
  assert.deepEqual(await b.picked(second.state), { ok: true, files: [FILE] });
});

test('Safari Picker saves its tab and state before navigation can return or close', async () => {
  let w, returned;
  const s = await picking({
    tab: async (url) => {
      assert.equal(url, undefined, 'create a blank tab before handing out the token');
      return 41;
    },
    show: async (tab, url) => {
      const state = new URLSearchParams(new URL(url).hash.slice(1)).get('state');
      returned = w.back(answer(state, { action: 'cancel' }), tab);
    },
  });
  w = s.w;
  const r = await w.pick();
  assert.equal(r.why, 'pending');
  assert.deepEqual(await returned, { ok: true });
  assert.deepEqual(await w.picked(r.state), { ok: true, files: [] });
});

test('Safari Picker serializes a return and tab closure instead of overwriting the files with cancel', async () => {
  const { w, held } = await picking();
  const r = await w.pick(), { state, tab } = held.v;
  const [back] = await Promise.all([
    w.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }), tab), w.closed(tab),
  ]);
  assert.equal(back.ok, true);
  assert.deepEqual(await w.picked(r.state), { ok: true, files: [FILE] });
});

test('Safari Picker reconnecting the same account invalidates a choice across workers', async () => {
  const { w, h, local, held } = await picking();
  const r = await w.pick(), { state, tab } = held.v;
  const b = pickWorker(h, local, held);
  assert.equal((await b.connect()).why, 'pending');
  assert.deepEqual(await b.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }), tab), { ok: false, why: 'state' });
  assert.deepEqual(await b.picked(r.state), { ok: false, why: 'state' });
});

test('Safari Picker rejects an expired return even if no page has polled it', async () => {
  const { w, h, held } = await picking();
  await w.pick();
  const { state, tab } = held.v;
  h.clock += 10 * 60e3;
  assert.deepEqual(await w.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }), tab), { ok: false, why: 'state' });
});

test('Safari Picker cannot rely on worker memory when session storage is unavailable', async () => {
  const { w } = await picking({ hold: undefined });
  assert.equal((await w.status()).picker, false);
  assert.deepEqual(await w.pick(), { ok: false, why: 'browser' });
  const src = fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8');
  assert.doesNotMatch(src, /pickHeld/, 'no fallback lost on Safari worker unload');
});

test('Safari Picker refuses returns from an account replaced while its worker was unloaded', async () => {
  const { w, h, local, held } = await picking();
  await w.pick();
  const { state, tab } = held.v;
  local.google = { ...local.google, sub: 'OTHER' };
  assert.deepEqual(await pickWorker(h, local, held).back(answer(state, { action: 'cancel' }), tab), { ok: false, why: 'connect' });
});

test('Safari Picker a return racing Disconnect cannot resurrect a cleared choice', async () => {
  const { w, h, local, held } = await picking();
  const r = await w.pick(), { state, tab } = held.v;
  let entered, release, first = true;
  const reading = new Promise((r) => { entered = r; });
  const b = pickWorker(h, local, held, { hold: {
    get: async () => {
      const p = structuredClone(held.v);
      if (first) { first = false; entered(); await new Promise((r) => { release = r; }); }
      return p;
    },
    set: async (p) => { held.v = structuredClone(p); },
  } });
  const back = b.back(answer(state, { action: 'cancel' }), tab);
  await reading;
  const disconnect = b.disconnect();
  await new Promise(setImmediate);
  release();
  await Promise.all([back, disconnect]);
  assert.equal(held.v, null);
  assert.deepEqual(await b.picked(r.state), { ok: false, why: 'state' });
});

test('Safari Picker return messages require the own top-level page and polls forward their state', async () => {
  const calls = [], removed = [], base = 'safari-web-extension://x/';
  const w = require('../helpers/worker-env.cjs')({ base, globals: {
    GZ_GOOGLE_CONFIG: {}, GZ_GOOGLE: { ON: true, flowOf: () => 'native', create: () => ({
      back: async (...a) => { calls.push(a); return { ok: true }; },
      picked: async (state) => ({ ok: true, state }),
    }) },
  } });
  w.context.chrome.tabs.remove = async (tab) => { removed.push(tab); };
  const sender = { id: 'glaze', url: `${base}documents/picked.html`, frameId: 0, tab: { id: 41 } };
  const message = { type: 'glaze:google', op: 'back', url: answer('s', { action: 'cancel' }) };
  for (const bad of [{ id: 'other' }, { url: `${base}writer.html` }, { url: 'https://frostdev.io/documents/picked.html' }, { frameId: 1 }, { frameId: undefined }, { tab: {} }]) {
    assert.deepEqual(await w.send(message, { ...sender, ...bad }), { ok: false, why: 'sender' });
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(removed, []);
  assert.deepEqual(await w.send(message, sender), { ok: true });
  assert.equal(calls[0][1], 41);
  assert.deepEqual(removed, [41]);
  assert.deepEqual(await w.send({ type: 'glaze:google', op: 'picked', state: 'own-choice' }, { ...sender, url: `${base}writer.html` }), { ok: true, state: 'own-choice' });
});

test('Safari\'s Picker: the picker page opens in a tab with the token and state in its fragment, and comes back to Glaze\'s return page, even after Safari unloads the worker', async () => {
  const h = handler(), local = {}, held = {}, tabs = [];
  const a = pickWorker(h, local, held, { tabs });
  await a.connect(); h.answered = true; await a.finish();
  assert.equal((await a.status()).picker, true, 'From Google Drive is offered in Safari');
  assert.deepEqual(await a.pick(), { ok: false, why: 'pending', state: held.v.state });
  const u = new URL(tabs[0]), f = new URLSearchParams(u.hash.slice(1));
  assert.equal(`${u.origin}${u.pathname}`, REAL.picker[0]);
  assert.deepEqual([...f.keys()].sort(), ['access_token', 'app_id', 'key', 'redirect_uri', 'state']);
  assert.deepEqual([f.get('access_token'), f.get('redirect_uri'), f.get('key'), f.get('app_id')], ['native-1', BACK, REAL.apiKey, REAL.appId]);
  assert.equal(u.search, '', 'nothing in the query: the token never reaches a server');
  const state = f.get('state');
  assert.match(state, /^[\w-]{43}$/);
  assert.deepEqual(Object.keys(held.v).sort(), ['at', 'state', 'sub', 'tab'], 'the hold keeps no token');
  assert.ok(!JSON.stringify(local).includes(state), 'nothing of the pick in storage.local');
  assert.deepEqual(await a.picked(state), { ok: false, why: 'pending' });
  // Safari unloads the worker while the student picks; the return page and the waiting page reach a new one.
  const b = pickWorker(h, local, held);
  assert.deepEqual(await b.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }), 42), { ok: false, why: 'state' }, 'only the tab the pick opened');
  assert.deepEqual(await b.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }).replace('picked.html', 'other.html'), 41), { ok: false, why: 'state' }, 'only Glaze\'s return page');
  assert.deepEqual(await b.back(answer(state, { action: 'picked', files: JSON.stringify([FILE]) }), 41), { ok: true });
  assert.deepEqual(await b.back(answer(state, { action: 'cancel' }), 41), { ok: false, why: 'state' }, 'answered once');
  assert.deepEqual(await b.picked(state), { ok: true, files: [FILE] });
  assert.equal(held.v, null);
  assert.deepEqual(await b.picked(state), { ok: false, why: 'state' }, 'nothing under way');
});

test('Safari\'s Picker: another state is refused, a closed tab is a cancel, an old pick ends, and Disconnect or another account ends one under way', async () => {
  const h = handler(), local = {}, held = {}, tabs = [];
  const w = pickWorker(h, local, held, { tabs });
  await w.connect(); h.answered = true; await w.finish();
  const start = async () => { await w.pick(); return new URLSearchParams(new URL(tabs.at(-1)).hash.slice(1)).get('state'); };
  await start();
  assert.deepEqual(await w.back(answer('x'.repeat(43), { action: 'picked', files: JSON.stringify([FILE]) }), held.v.tab), { ok: false, why: 'state' });
  assert.deepEqual(await w.picked(held.v?.state), { ok: false, why: 'pending' }, 'another state leaves the real choice pending');
  await start();
  await w.closed(99);
  assert.deepEqual(await w.picked(held.v?.state), { ok: false, why: 'pending' }, 'another tab closing changes nothing');
  await w.closed(held.v.tab);
  assert.deepEqual(await w.picked(held.v?.state), { ok: true, files: [] }, 'the picker tab closed: a cancel');
  const s3 = await start();
  assert.deepEqual(await w.back(answer(s3, { action: 'cancel' }), held.v.tab), { ok: true });
  assert.deepEqual(await w.picked(held.v?.state), { ok: true, files: [] });
  await start();
  h.clock += 10 * 60e3;
  assert.deepEqual(await w.picked(held.v?.state), { ok: false, why: 'cancel' }, 'ten minutes: over');
  await start();
  local.google = { ...local.google, sub: 'OTHER' };
  assert.deepEqual(await w.picked(held.v?.state), { ok: false, why: 'connect' }, 'another account connected meanwhile');
  local.google = { ...local.google, sub: 'S1' };
  await start();
  assert.deepEqual(await w.disconnect(), { ok: true });
  assert.equal(held.v, null, 'Disconnect ends a pick under way');
  const old = harness({ flow: 'native', config: { ...REAL, native: true }, native: async (m) => (m.type === 'google.status' ? { ok: true } : null) });
  old.local.google = { email: 'student@icloud.com', sub: '9', flow: 'native', at: 1 };
  assert.deepEqual(await old.g.pick(), { ok: false, why: 'browser' }, 'a worker with no tab of its own to open says so');
});

test('Safari\'s Picker in the worker: its tab opened by the worker, its return page heard only top-level in that tab, and Documents and Writer wait on picked', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8');
  assert.match(src, /const PICKED_PAGE = 'documents\/picked\.html';/);
  assert.match(src, /tab: async \(\) => \(await chrome\.tabs\.create\(\{ url: 'about:blank', active: true \}\)\)\?\.id,/);
  assert.match(src, /hold: chrome\.storage\.session\n/, 'held in storage.session, never storage.local');
  const at = src.indexOf("m?.type !== 'glaze:google' || m.op !== 'back'"), body = src.slice(at, src.indexOf('return true;', at));
  assert.match(body, /!SAFARI \|\| s\.id !== chrome\.runtime\.id \|\| s\.frameId !== 0 \|\| !Number\.isInteger\(tab\) \|\| typeof s\.url !== 'string' \|\| s\.url\.split\(\/\[\?#\]\/\)\[0\] !== chrome\.runtime\.getURL\(PICKED_PAGE\)/);
  assert.match(body, /chrome\.tabs\.remove\(tab\)/, 'the worker closes the tab');
  assert.match(src, /chrome\.tabs\?\.onRemoved\?\.addListener\(\(tab\) => \{\n\s+if \(!chrome\.storage\.session\) return;\n\s+chrome\.storage\.session\.get\('googlePick'\)\.then\(\(r\) => \{ if \(r\.googlePick\?\.tab === tab\) return openGoogle\(\)\.closed\(tab\); \}\)/,
    'a tab closing loads Drive\'s code only for the pick under way in it');
  const page = fs.readFileSync(path.join(__dirname, '../../extension/documents/picked.js'), 'utf8');
  assert.match(page, /history\.replaceState\(null, '', location\.pathname\);\n {2}chrome\.runtime\.sendMessage\(\{ type: 'glaze:google', op: 'back', url \}\)/, 'the fragment leaves the address bar first');
  for (const f of ['documents/drive.js', 'writer/frame/writer-submit.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8'), /r\?\.why === 'pending' && n < 600[^]*op: 'picked'/, f);
  }
  const safari = require('../../safari/Glaze/Glaze Extension/Resources/manifest.json');
  const war = safari.web_accessible_resources.find((w) => w.resources.includes('documents/picked.html'));
  assert.deepEqual(war, { resources: ['documents/picked.html'], matches: ['https://frostdev.io/*', 'https://frostdev-ops.github.io/*'] }, 'reachable from the picker pages only');
  assert.ok(!repo.web_accessible_resources.some((w) => w.resources.includes('documents/picked.html')), 'Chrome\'s and Firefox\'s packages don\'t expose it');
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

test('Disconnect after a worker restart asks Google for nothing: no silent renewal, no request', async () => {
  const h = harness({ flow: 'web' });
  await h.g.connect();
  const launched = h.log.launch.length;
  // A new worker over the same storage: nothing in memory.
  const restarted = G.create({
    on: true, config: REAL, flow: 'web', firefox: false,
    identity: () => ({ ...h.identity, launchWebAuthFlow: async (d) => { h.log.launch.push(d); throw new Error('no sign-in expected'); } }),
    permissions: { contains: async () => true, remove: async (p) => { h.log.permRemoved.push(p); return true; } },
    manifest: () => ({ oauth2: { client_id: REAL.chrome } }),
    storage: { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in h.local).map((x) => [x, h.local[x]]))), set: async (v) => Object.assign(h.local, v), remove: async (k) => { for (const x of [].concat(k)) delete h.local[x]; } },
    fetch: async (url) => { throw new Error(`unexpected request: ${url}`); },
    keep: async () => false, now: () => 2_000_000,
  });
  assert.deepEqual(await restarted.disconnect(), { ok: true });
  assert.equal(h.log.launch.length, launched, 'never a sign-in');
  assert.deepEqual([h.local, h.log.permRemoved], [{}, [{ permissions: ['identity'] }]]);
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

// ---- Settings' Google Drive rows (settings/options.js), run in a VM with the worker and storage stubbed ----
// safari: Settings in Safari (the worker's native flow); finish: the worker's answers to each finish in turn; pending: a
// sign-in under way in the app as Settings opens.
const settings = async ({ email = 'student@school.edu', sync = {}, connect = { ok: true, email }, firefox = false, large, safari = false, finish = [], pending = false } = {}) => {
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, '../../extension/settings/options.js'), 'utf8');
  const block = src.slice(src.indexOf('  // ---- Google Drive (background/google.js'), src.indexOf('  // Another surface changed something'));
  const els = {}, sent = [], heard = [], asked = [], hints = [], local = { driveSync: sync, ...(large && { driveSyncLarge: large }) };
  const el = (id, hidden = false) => {
    const e = { id, observers: [], listeners: {}, checked: false, _hidden: hidden, _text: '', focus() {},
      addEventListener(type, f) { (this.listeners[type] ||= []).push(f); },
      get hidden() { return this._hidden; }, set hidden(v) { if (v !== this._hidden) { this._hidden = v; for (const f of this.observers) f(); } },
      get textContent() { return this._text; }, set textContent(v) { if (String(v) !== this._text) { this._text = String(v); for (const f of this.observers) f(); } } };
    els[`#${id}`] = e;
  };
  for (const [id, hidden] of [['gdrive', true], ['gdrive-who'], ['gdrive-connect'], ['gdrive-disconnect', true], ['gdrive-sync', true], ['gdrive-sync-said'], ['gdrive-sync-on']]) el(id, hidden);
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: (m, reply) => {
        sent.push(structuredClone(m));
        const r = m.type === 'glaze:google' ? (m.op === 'status' ? { ok: true, flow: safari ? 'native' : firefox ? 'web' : 'chrome', email: local.google?.email || null, ...(safari && { picker: false, pending: !local.google && pending }) }
          : m.op === 'connect' ? connect : m.op === 'finish' ? finish.shift() || { ok: false, why: 'signin' } : { ok: true }) : { ok: true };
        if (m.type === 'glaze:google' && (m.op === 'connect' || m.op === 'finish') && r.ok) local.google = { email: r.email };
        if (m.type === 'glaze:google' && m.op === 'disconnect') delete local.google;
        setTimeout(() => reply(r), 0);
      },
    },
    // Firefox's permissions API takes only optional permissions, and identity isn't one there: asked for it, it throws.
    permissions: { request: async (p) => { asked.push(structuredClone(p)); if (firefox) throw new TypeError('Type error for parameter permissions'); return true; } },
    storage: { local: { get: async (k) => Object.fromEntries([].concat(k).map((x) => [x, structuredClone(local[x])])) }, onChanged: { addListener: (f) => heard.push(f) } },
  };
  chrome.runtime.getURL = (p = '') => `${safari ? 'safari-web-extension://6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B' : firefox ? 'moz-extension://6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' : 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}/${p}`;
  if (email) local.google = { email };
  vm.runInNewContext(block, {
    $: (s) => els[s], chrome, t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m)), hint: (text, bad = false) => hints.push([text, bad]), GZ_SITE: {}, GZ_I18N: { locale: () => 'en', ui: () => 'en' }, Intl, Date,
    MutationObserver: class { constructor(f) { this.f = f; } observe(e) { e.observers.push(this.f); } },
  });
  const settle = () => new Promise((r) => setTimeout(r, 20));
  await settle();
  return {
    els, sent, settle, asked, hints,
    click: async (id) => { for (const f of els[id].listeners.click) await f({ isTrusted: true, currentTarget: els[id] }); await settle(); },
    syncChange: async (next) => { local.driveSync = next; for (const f of heard) f({ driveSync: { newValue: next } }, 'local'); await settle(); },
  };
};

test('Settings: while Sync asks to connect Google Drive again, Connect is there beside Disconnect, and connecting the same account again restarts Sync', async () => {
  const A = 'student@school.edu';
  for (const problem of ['auth', 'connect', 'account', 'scope', 'permission']) {
    const s = await settings({ sync: { on: true, account: A, problem } });
    assert.equal(s.els['#gdrive-who'].textContent, A);
    assert.equal(s.els['#gdrive-sync-said'].textContent, 'Connect Google Drive again to keep syncing.', problem);
    assert.deepEqual([s.els['#gdrive-connect'].hidden, s.els['#gdrive-disconnect'].hidden], [false, false], `${problem}: Connect offered, as the line says`);
  }
  for (const sync of [{ on: true, account: A, problem: 'network' }, { on: true, account: A, last: 1 }, { on: false, off: true, problem: 'account' }]) {
    const s = await settings({ sync });
    assert.deepEqual([s.els['#gdrive-connect'].hidden, s.els['#gdrive-disconnect'].hidden], [true, false], JSON.stringify(sync));
  }
  // The same account again: Sync turned on afresh (its problem cleared, a run now rather than after its wait).
  const s = await settings({ sync: { on: true, account: A, problem: 'auth', wait: Date.now() + 3600e3 } });
  await s.click('#gdrive-connect');
  assert.deepEqual(s.sent.filter((m) => m.type === 'glaze:driveSync'), [{ type: 'glaze:driveSync', op: 'set', on: true }]);
  await s.syncChange({ on: true, account: A, problem: null, busy: Date.now() });
  assert.equal(s.els['#gdrive-connect'].hidden, true, 'and once it runs, only Disconnect');
  // Another account: Sync's own binding check stops it there (background/background.js), Settings never rebinds it.
  const b = await settings({ sync: { on: true, account: A, problem: 'account' }, connect: { ok: true, email: 'other@school.edu' } });
  await b.click('#gdrive-connect');
  assert.deepEqual(b.sent.filter((m) => m.type === 'glaze:driveSync'), []);
  // Not connected: Connect alone, and nothing of Sync's.
  const n = await settings({ email: null, sync: { on: true, account: A, problem: 'connect' } });
  assert.deepEqual([n.els['#gdrive'].hidden, n.els['#gdrive-connect'].hidden, n.els['#gdrive-disconnect'].hidden, n.els['#gdrive-sync'].hidden], [false, false, true, true]);
  await n.click('#gdrive-connect');
  assert.deepEqual(n.sent.filter((m) => m.type === 'glaze:driveSync'), [], 'a first Connect: the worker turns Sync on itself');
});

test('Settings: Disconnect says only that it disconnected, for Drive and Calendar alike, and never sends the student to Google', async () => {
  const s = await settings();
  await s.click('#gdrive-disconnect');
  assert.deepEqual(s.hints, [['Disconnected.', false]]);
  assert.deepEqual([s.els['#gdrive-connect'].hidden, s.els['#gdrive-disconnect'].hidden], [false, true]);
  const src = fs.readFileSync(path.join(__dirname, '../../extension/settings/options.js'), 'utf8');
  assert.doesNotMatch(src, /myaccount\.google\.com|revoked/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../extension/options.html'), 'utf8'), /asks Google to remove/);
});

test('Settings in Safari: Connect asks nothing of the browser and waits on the app through finish; a sign-in still under way as Settings opens finishes without a click', async () => {
  const A = 'student@icloud.com';
  const s = await settings({ safari: true, email: null, connect: { ok: false, why: 'pending' }, finish: [{ ok: false, why: 'pending' }, { ok: true, email: A }] });
  await s.click('#gdrive-connect');
  assert.deepEqual(s.asked, [], 'no identity permission in Safari');
  assert.deepEqual(s.sent.filter((m) => m.type === 'glaze:google').map((m) => m.op), ['status', 'connect', 'finish', 'finish', 'status'], 'one sign-in, then its answer');
  assert.equal(s.els['#gdrive-who'].textContent, A);
  assert.deepEqual(s.hints, [['Connected.', false]]);
  const back = await settings({ safari: true, email: null, pending: true, finish: [{ ok: false, why: 'pending' }, { ok: true, email: A }] });
  assert.deepEqual(back.sent.filter((m) => m.type === 'glaze:google').map((m) => m.op), ['status', 'finish', 'finish', 'status'], 'finished from the app\'s answer, no Connect');
  assert.equal(back.els['#gdrive-who'].textContent, A);
  const gone = await settings({ safari: true, email: null, pending: true, finish: [{ ok: false, why: 'signin' }] });
  assert.deepEqual([gone.hints, gone.els['#gdrive-who'].textContent], [[], ''], 'an expired sign-in says nothing');
  const late = await settings({ safari: true, email: null, connect: { ok: false, why: 'pending' }, finish: [{ ok: false, why: 'signin' }] });
  await late.click('#gdrive-connect');
  assert.deepEqual(late.hints, [["Google Drive didn't connect. Try again in a moment.", true]], 'never "sign in to the browser" in Safari');
  const none = await settings({ safari: true, email: null });
  assert.deepEqual(none.sent.map((m) => m.op), ['status'], 'nothing under way: nothing asked');
});

test('Settings: a Connect Chrome could not sign in for says to sign in to the browser; a cancel says nothing', async () => {
  const s = await settings({ email: null, connect: { ok: false, why: 'signin' } });
  await s.click('#gdrive-connect');
  assert.deepEqual(s.hints, [['Sign in to the browser with your Google account, then connect again.', true]]);
  const c = await settings({ email: null, connect: { ok: false, why: 'cancel' } });
  await c.click('#gdrive-connect');
  assert.deepEqual(c.hints, [['', false]]);
});

test('Settings on Firefox: Connect goes straight to Google, never asking Firefox for identity (the package holds it; Firefox has no optional identity)', async () => {
  const s = await settings({ email: null, firefox: true, connect: { ok: true, email: 'student@school.edu' } });
  await s.click('#gdrive-connect');
  assert.deepEqual(s.asked, [], 'no permissions.request');
  assert.deepEqual(s.sent.filter((m) => m.type === 'glaze:google').map((m) => m.op), ['status', 'connect', 'status']);
  assert.equal(s.els['#gdrive-who'].textContent, 'student@school.edu');
  const c = await settings({ email: null });
  await c.click('#gdrive-connect');
  assert.deepEqual(c.asked, [{ permissions: ['identity'] }], 'Chrome, Edge and Brave still ask, inside the click');
});

test('Settings: a day whose backup Drive had no room for says so beside when Sync last ran', async () => {
  const A = 'student@school.edu', now = Date.now();
  const s = await settings({ sync: { on: true, account: A, last: now, snap: now - 3600e3, snapSkip: 'quota', problem: null } });
  const said = s.els['#gdrive-sync-said'].textContent;
  assert.match(said, /^Last synced .+\. Today's backup was skipped: your Google Drive is full\.$/);
  const older = await settings({ sync: { on: true, account: A, last: now, snap: now - 2 * 864e5, snapSkip: 'quota' } });
  assert.doesNotMatch(older.els['#gdrive-sync-said'].textContent, /backup/, 'only for the day it covers');
  const made = await settings({ sync: { on: true, account: A, last: now, snap: now, snapSkip: null } });
  assert.doesNotMatch(made.els['#gdrive-sync-said'].textContent, /backup/);
});

// Sync to Google Drive (documents/drive-sync.js driveSyncLarge; background/drive-store.js snapSkip 'large' with transfers off):
// what stays on this device as too large to sync is counted beside when Sync last ran, only when there is any; a day's zip
// past the limit says so for that day.
test('Settings: what is too large to sync is counted beside when Sync last ran, only if any; a day\'s zip too large says so', async () => {
  const A = 'student@school.edu', now = Date.now();
  const s = await settings({ sync: { on: true, account: A, last: now, snap: now, problem: null }, large: { docs: { 'doc:00000000-0000-4000-8000-000000000001': true }, recs: { 'local:writerWords': true } } });
  assert.match(s.els['#gdrive-sync-said'].textContent, /^Last synced .+\. Too large to sync: 2\.$/);
  const none = await settings({ sync: { on: true, account: A, last: now, problem: null }, large: { docs: {}, recs: {} } });
  assert.match(none.els['#gdrive-sync-said'].textContent, /^Last synced [^.]+\.$/, 'nothing said when none is');
  const zip = await settings({ sync: { on: true, account: A, last: now, snap: now - 3600e3, snapSkip: 'large', problem: null } });
  assert.match(zip.els['#gdrive-sync-said'].textContent, /^Last synced .+\. Today's backup was too large\.$/);
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
  assert.match(body, /m\.op === 'pick' || m\.op === 'picked' \? googlePage\(s\) : fromEditor\(s\)/);
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
  assert.ok(![...(firefox.optional_permissions || []), ...firefox.permissions].includes('identity'));
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
  assert.ok(firefox.permissions.includes('identity'), 'Firefox signs in with the Web client, holding identity from install (it has no optional identity, and asks nothing for it)');
  assert.ok(!(firefox.optional_permissions || []).includes('identity'));
});

test('package-firefox.sh takes the permissions oauth-manifest.js gives Firefox, identity among them once Drive is on', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../tools/build/package-firefox.sh'), 'utf8');
  assert.match(src, /for \(const k of \['oauth2', 'optional_permissions', 'permissions'\]\) if \(k in google\) m\[k\] = google\[k\]; else delete m\[k\];/);
});

test('packages: switched on, the shipped config gives Chrome Calendar\'s client with Drive\'s three scopes, and Firefox identity', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, drive: true, config: C });
  assert.deepEqual(chrome.oauth2, { client_id: repo.oauth2.client_id, scopes: C.scopes });
  assert.deepEqual(chrome.optional_permissions, repo.optional_permissions);
  const firefox = oauth(repo, { target: 'firefox', calendar: false, drive: true, config: C });
  assert.equal(firefox.oauth2, undefined);
  assert.deepEqual(firefox.permissions, [...repo.permissions, 'identity']);
  assert.deepEqual(firefox.optional_permissions, repo.optional_permissions.filter((p) => p !== 'identity'));
});

// ---- the build-time switch (background/google.js ON): on since 4.0.1, everywhere but Safari (background/google-config.js native) ----
test('Drive is switched on: the shipped worker offers Chrome, Edge, Brave, Firefox and Safari their sign-in', async () => {
  assert.equal(G.ON, true);
  assert.equal(C.native, true, 'Safari signs in through the Glaze app');
  for (const [flow, firefox] of [['chrome', false], ['web', false], ['web', true]]) {
    const h = harness({ on: G.ON, config: C, flow, firefox, client: C.chrome });
    assert.deepEqual(await h.g.status(), { ok: true, flow, email: null, picker: true }, `${flow}${firefox ? ' (Firefox)' : ''}`);
  }
  const safari = harness({ on: G.ON, config: C, flow: 'native', native: async (m) => (m.type === 'google.status' ? { ok: true, email: null, sub: null, pending: false } : null) });
  assert.deepEqual(await safari.g.status(), { ok: true, flow: 'native', email: null, picker: false, pending: false });
  const bare = harness({ on: G.ON, config: C, flow: 'native' });
  assert.deepEqual(await bare.g.status(), { ok: false, why: 'setup' }, 'no Settings row while the handler can\'t reach its app group');
  assert.deepEqual([bare.log.fetch, bare.local], [[], {}]);
  const src = fs.readFileSync(path.join(__dirname, '../../extension/background/background.js'), 'utf8');
  const at = src.indexOf("m?.type !== 'glaze:google'");
  assert.match(src.slice(at, src.indexOf('return true;', at)), /if \(!GZ_GOOGLE\.ON\) \{ reply\(\{ ok: false, why: 'off' \}\); return; \}/, 'a build with the switch off still refuses every operation');
});

const CAL = 'https://www.googleapis.com/auth/calendar.app.created';
test('packages: Chrome\'s (Edge and Brave install its store item) has Calendar\'s and Drive\'s scopes and optional identity; Firefox\'s holds identity and no oauth2', () => {
  assert.equal(require('../../extension/planner/gcal.js').ON, true);
  const chrome = oauth(repo, { target: 'chrome', calendar: true, drive: G.ON, config: C });
  assert.deepEqual(chrome.oauth2, { client_id: C.chrome, scopes: [CAL, DRIVE, 'openid', 'email'] });
  assert.deepEqual(chrome.permissions, repo.permissions);
  assert.deepEqual(chrome.optional_permissions, ['identity', 'nativeMessaging']);
  const firefox = oauth(repo, { target: 'firefox', calendar: false, drive: G.ON, config: C });
  assert.equal(firefox.oauth2, undefined);
  assert.deepEqual(firefox.permissions, [...repo.permissions, 'identity']);
  assert.deepEqual(firefox.optional_permissions, ['nativeMessaging']);
});

test('tools/dev/dev-drive.sh: the store package as shipped (Drive on, no key), Safari\'s staging without oauth2 or identity, and the key in the dev copy only', () => {
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
    const scopes = [CAL, DRIVE, 'openid', 'email'];
    assert.deepEqual(packed.oauth2, { client_id: C.chrome, scopes });
    assert.deepEqual(packed.permissions, repo.permissions);
    assert.deepEqual(packed.optional_permissions, ['identity', 'nativeMessaging']);
    assert.ok(!('key' in packed), 'the store package has no key');
    assert.match(execFileSync('unzip', ['-p', zip, 'background/google.js']).toString(), /\n {2}const ON = true;\n/);
    // Safari's staging starts from the store package (tools/build/sync-safari-resources.sh) and drops Google's keys.
    const safari = path.join(dir, 'safari-manifest.json');
    fs.writeFileSync(safari, JSON.stringify(packed));
    execFileSync('sh', [path.join(__dirname, '../../tools/build/safari-manifest.sh'), safari]);
    const s = JSON.parse(fs.readFileSync(safari, 'utf8'));
    assert.equal(s.oauth2, undefined);
    assert.ok(![...s.permissions, ...(s.optional_permissions || [])].includes('identity'));
    assert.ok(!('key' in s));
    const dev = JSON.parse(fs.readFileSync(path.join(dir, 'dev/manifest.json')));
    assert.deepEqual(dev.oauth2, { client_id: C.chrome, scopes });
    assert.deepEqual(dev.optional_permissions, repo.optional_permissions);
    assert.equal(dev.key, fs.readFileSync(keyFile, 'utf8'));
    assert.match(fs.readFileSync(path.join(dir, 'dev/background/google.js'), 'utf8'), /\n {2}const ON = true;\n/);
    assert.ok(!('key' in repo));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
