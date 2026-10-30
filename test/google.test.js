// Google sign-in for Drive (lib/google.js, lib/google-config.js) and the Picker hand-off, with chrome.identity, permissions,
// storage and fetch stubbed: connect on each flow, silent renewal, a state that isn't ours refused, Disconnect revoking, no
// token ever in storage, the picker's fragment and the picker page's fallback order. The packaging side
// (scripts/oauth-manifest.js) is at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../lib/google.js');
const C = require('../lib/google-config.js');
const { oauth } = require('../scripts/oauth-manifest.js');

const REDIRECT = 'https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';
// Every id unset, as before the owner made Glaze's clients.
const BLANK = { ...C, chrome: 'PLACEHOLDER-chrome.apps.googleusercontent.com', web: 'PLACEHOLDER-web.apps.googleusercontent.com', ios: 'PLACEHOLDER-ios.apps.googleusercontent.com', apiKey: 'PLACEHOLDER', appId: 'PLACEHOLDER' };
const REAL = { ...C, chrome: '111-chrome.apps.googleusercontent.com', web: '222-web.apps.googleusercontent.com', ios: '333-ios.apps.googleusercontent.com', apiKey: 'AIzaTestKey', appId: '123456789012' };

// A worker: flow, config, what Google answers (google(details) → the redirect URL; userinfo), which picker pages load.
const harness = ({ flow = 'chrome', config = REAL, granted = true, firefox = false, client = REAL.chrome, keep = false, up = [true, true], email = 'student@school.edu' } = {}) => {
  const local = {}, sync = {};
  const log = { fetch: [], launch: [], auth: [], removed: [], cleared: 0, permRemoved: [], native: [] };
  let clock = 1_000_000;
  let n = 0;
  const identity = {
    getAuthToken: async (d) => {
      log.auth.push(d);
      if (identity.fail) throw new Error(identity.fail);
      return { token: `chrome-tok-${++n}`, grantedScopes: identity.scopes || d.scopes };
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
      return init.headers?.authorization?.startsWith('Bearer ') ? new Response(JSON.stringify({ sub: '1', email, email_verified: true }), { status: 200 }) : new Response('', { status: 401 });
    }
    if (url === G.REVOKE) return new Response('', { status: 200 });
    const i = config.picker.indexOf(url);
    if (i >= 0) { if (up[i]) return new Response('', { status: 200 }); throw new TypeError('Failed to fetch'); }
    throw new Error(`unexpected request: ${url}`);
  };
  const g = G.create({
    config, flow, firefox,
    identity: () => (granted ? identity : undefined),
    permissions: { contains: async ({ permissions }) => granted && permissions.join() === 'identity', remove: async (p) => { log.permRemoved.push(p); return true; } },
    manifest: () => ({ oauth2: { client_id: client } }),
    storage: area(local),
    fetch,
    native: async (m) => { log.native.push(m); return null; },
    keep: async () => keep,
    now: () => clock,
  });
  return { g, local, sync, log, identity, tick: (ms) => { clock += ms; } };
};
// Every token that ever existed, and storage: none may be in it.
const noToken = (h) => {
  const text = JSON.stringify(h.local) + JSON.stringify(h.sync);
  assert.ok(!/tok-\d/.test(text), `no token in storage: ${text}`);
  assert.deepEqual(Object.keys(h.local).filter((k) => k !== 'google'), [], 'storage.local holds only google');
  if (h.local.google) assert.deepEqual(Object.keys(h.local.google).sort(), ['at', 'email', 'flow']);
};
const careful = (h) => {
  for (const { init } of h.log.fetch) assert.deepEqual([init.credentials, init.redirect, init.cache], ['omit', 'error', 'no-store']);
};

test('the config: Glaze\'s clients in project 1071735898350, three scopes, the two picker pages in order, no secret', () => {
  assert.deepEqual(C.scopes, [DRIVE, 'openid', 'email']);
  assert.deepEqual(C.picker, ['https://frostdev.io/glaze/drive-picker/', 'https://frostdev-ops.github.io/glaze-drive-picker/']);
  assert.equal(C.chrome, require('../manifest.json').oauth2.client_id, 'Chrome signs in with the store item\'s client, Calendar\'s');
  for (const k of ['chrome', 'web', 'ios']) assert.match(C[k], /^1071735898350-[a-z0-9]{32}\.apps\.googleusercontent\.com$/, k);
  assert.equal(new Set([C.chrome, C.web, C.ios]).size, 3);
  assert.equal(C.appId, '1071735898350');
  assert.match(C.apiKey, /^AIza[\w-]{35}$/);
  assert.doesNotMatch(JSON.stringify(C) + fs.readFileSync(path.join(__dirname, '../lib/google-config.js'), 'utf8'), /GOCSPX|client_secret|secret/i, 'client ids and a browser key only, never a secret');
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
  assert.deepEqual(h.local.google, { email: 'student@school.edu', flow: 'chrome', at: 1_000_000 });
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

test('the worker answers glaze:google from Settings only (pick from Glaze\'s own pages), loading lib/google.js on first use', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
  assert.match(src, /globalThis\.addEventListener\?\.\('install', \(\) => importScripts\('oauth\.js', 'google-config\.js', 'google\.js'\)\)/);
  const at = src.indexOf("m?.type !== 'glaze:google'");
  assert.ok(at > 0);
  const body = src.slice(at, src.indexOf('return true;', at));
  assert.match(body, /m\.op === 'pick' \? googlePage\(s\) : fromEditor\(s\)/);
  // Nothing about Google in any site's first script.
  const m = require('../manifest.json');
  for (const c of m.content_scripts) for (const f of c.js) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /GZ_GOOGLE|glaze:google|GZ_OAUTH|google-config/, f);
});

// ---- packaging: what each package's manifest carries for Google ----
const repo = require('../manifest.json');
test('packages: placeholders leave Drive out, so a build asks for no identity and carries no oauth2', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, config: BLANK });
  assert.equal(chrome.oauth2, undefined);
  assert.ok(!(chrome.optional_permissions || []).includes('identity'));
  const firefox = oauth(repo, { target: 'firefox', calendar: false, config: BLANK });
  assert.equal(firefox.oauth2, undefined);
  assert.ok(!(firefox.optional_permissions || []).includes('identity'));
  const { oauth2, optional_permissions: optional, ...rest } = repo;
  assert.deepEqual(chrome, { ...rest, optional_permissions: optional.filter((p) => p !== 'identity') }, 'nothing else changes');
});

test('packages: real ids give Chrome the Drive client and its three scopes, without Calendar\'s while Calendar is off', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, config: REAL });
  assert.deepEqual(chrome.oauth2, { client_id: REAL.chrome, scopes: C.scopes });
  assert.deepEqual(chrome.optional_permissions, repo.optional_permissions, 'identity stays optional');
  assert.ok(!chrome.permissions.includes('identity'));
  const both = oauth(repo, { target: 'chrome', calendar: true, config: REAL });
  assert.deepEqual(both.oauth2.scopes, ['https://www.googleapis.com/auth/calendar.app.created', ...C.scopes]);
  const cal = oauth(repo, { target: 'chrome', calendar: true, config: BLANK });
  assert.deepEqual(cal.oauth2, repo.oauth2, 'Calendar alone: the manifest as it is');
  const web = oauth(repo, { target: 'chrome', calendar: false, config: { ...REAL, chrome: BLANK.chrome } });
  assert.equal(web.oauth2, undefined, 'only the Web client: Edge and Brave sign in, Chrome waits');
  assert.ok(web.optional_permissions.includes('identity'));
  const firefox = oauth(repo, { target: 'firefox', calendar: false, config: REAL });
  assert.equal(firefox.oauth2, undefined);
  assert.ok(firefox.optional_permissions.includes('identity'), 'Firefox signs in with the Web client');
});

test('packages: the shipped config gives Chrome Calendar\'s client with Drive\'s three scopes, and Firefox identity', () => {
  const chrome = oauth(repo, { target: 'chrome', calendar: false, config: C });
  assert.deepEqual(chrome.oauth2, { client_id: repo.oauth2.client_id, scopes: C.scopes });
  assert.deepEqual(chrome.optional_permissions, repo.optional_permissions);
  const firefox = oauth(repo, { target: 'firefox', calendar: false, config: C });
  assert.equal(firefox.oauth2, undefined);
  assert.deepEqual(firefox.optional_permissions, repo.optional_permissions);
});
