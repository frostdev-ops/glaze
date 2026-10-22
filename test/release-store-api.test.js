// scripts/store-api.mjs: request building, error handling, tokens and the submit/resume logic of the three stores.
// Every call goes to a stub that replaces fetch (and, for Chrome's token, a stub gcloud that is the only program on PATH),
// so nothing here can reach a store.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../scripts/store-api.mjs');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-store-api-'));
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

// Replace fetch for one test. handler(call) returns a Response; an unrouted call fails the test instead of going anywhere.
let calls, restore;
const stubFetch = (handler) => {
  const original = globalThis.fetch;
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body, init };
    calls.push(call);
    const response = await handler(call);
    if (!response) throw new Error(`unrouted ${call.method} ${call.url}`);
    return response;
  };
  restore = () => { globalThis.fetch = original; };
};
test.afterEach(() => { restore?.(); restore = null; });
// Keys are "METHOD path": ":name" matches a Chrome method suffix, a trailing "*" is a prefix, anything else is exact.
// App Store Connect paths are written without its /v1 base.
const route = (table) => (call) => {
  const u = new URL(call.url), target = (u.hostname === 'api.appstoreconnect.apple.com' ? u.pathname.replace(/^\/v1/, '') : u.pathname) + u.search;
  for (const [key, answer] of Object.entries(table)) {
    const [method, want] = key.split(' ');
    const hit = want.startsWith(':') ? target.split('?')[0].endsWith(want) : want.endsWith('*') ? target.startsWith(want.slice(0, -1)) : target === want;
    if (call.method === method && hit) return typeof answer === 'function' ? answer(call) : reply(answer);
  }
  return null;
};
const bodyOf = (call) => (typeof call.body === 'string' ? JSON.parse(call.body) : call.body);

// A gcloud that prints a fixed token and records its arguments; the only executable on PATH while it is installed.
const withGcloud = async (fn, { token = 'cws-token', fail = false } = {}) => {
  const dir = scratch(), saved = process.env.PATH;
  fs.writeFileSync(path.join(dir, 'gcloud'), `#!/bin/sh\necho "$@" > "${dir}/args"\n${fail ? 'echo "ERROR: secret detail from gcloud" >&2\nexit 1' : `echo ${token}`}\n`, { mode: 0o755 });
  process.env.PATH = dir;
  try { return await fn(dir); } finally { process.env.PATH = saved; fs.rmSync(dir, { recursive: true, force: true }); }
};

const env = { CWS_PUBLISHER_ID: 'pub-1', CWS_EXTENSION_ID: 'ext-1', CWS_SERVICE_ACCOUNT: 'sa@example.iam.gserviceaccount.com', AMO_ADDON_ID: 'glaze@frostdev.io', AMO_JWT_ISSUER: 'user:1:2', AMO_JWT_SECRET: 'amo-secret', ASC_BUNDLE_ID: 'io.example.App', ASC_KEY_ID: 'KEY123', ASC_ISSUER_ID: 'issuer-uuid' };
const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());

// ---- request ----

test('request sends a JSON body with its content type, the bearer token and no redirects', async () => {
  const { request } = await load();
  stubFetch(() => reply({ ok: true }));
  const result = await request('https://store.example/v1/things', 'tok', 'POST', { a: 1 });
  assert.deepEqual(result, { ok: true });
  const [c] = calls;
  assert.equal(c.method, 'POST');
  assert.equal(c.headers.Authorization, 'Bearer tok');
  assert.equal(c.headers['Content-Type'], 'application/json');
  assert.equal(c.body, '{"a":1}');
  assert.equal(c.init.redirect, 'error', 'a redirect would carry the token to another host');
  assert.ok(c.init.signal instanceof AbortSignal, 'every call has a timeout');
});

test('request uses the given authorization scheme and leaves a GET without body or content type', async () => {
  const { request } = await load();
  stubFetch(() => reply({}));
  await request('https://addons.example/x', 'jwt-token', 'GET', undefined, {}, 'JWT');
  assert.equal(calls[0].headers.Authorization, 'JWT jwt-token');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.ok(!('Content-Type' in calls[0].headers));
});

test('request passes bytes and forms through untouched and merges the caller\'s headers', async () => {
  const { request } = await load();
  stubFetch(() => reply({ uploadState: 'SUCCEEDED' }));
  const zip = new Uint8Array([80, 75, 3, 4]);
  await request('https://up.example/u', 't', 'POST', zip, { 'Content-Type': 'application/zip' });
  assert.equal(calls[0].body, zip);
  assert.equal(calls[0].headers['Content-Type'], 'application/zip');
  const form = new FormData(); form.set('channel', 'listed');
  await request('https://up.example/u', 't', 'POST', form);
  assert.equal(calls[1].body, form);
  assert.ok(!('Content-Type' in calls[1].headers), 'fetch must set the multipart boundary itself');
});

test('request treats an empty body as an empty result', async () => {
  const { request } = await load();
  stubFetch(() => reply('', 200));
  assert.deepEqual(await request('https://store.example/empty', 't'), {});
});

test('request names the host, status and a bounded body in an HTTP error, and keeps the status for callers', async () => {
  const { request } = await load();
  stubFetch(() => reply({ error: 'x'.repeat(5000) }, 409));
  await assert.rejects(request('https://store.example/v1/secret-path?token=abc', 'super-secret-token'), (error) => {
    assert.equal(error.status, 409);
    assert.match(error.message, /^store\.example: HTTP 409: \{"error":"x+/);
    assert.ok(error.message.length < 3100, error.message.length);
    assert.ok(!error.message.includes('super-secret-token') && !error.message.includes('abc'), 'neither the token nor the query leaks');
    return true;
  });
});

test('request reports a non-JSON reply without echoing it', async () => {
  const { request } = await load();
  stubFetch(() => reply('<html>login: private details</html>', 502));
  await assert.rejects(request('https://store.example/v1', 't'), (error) => {
    assert.equal(error.message, 'store.example: non-JSON response (HTTP 502)');
    return true;
  });
});

test('request lets a refused redirect or a dropped connection through as the failure it is', async () => {
  const { request } = await load();
  stubFetch(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(request('https://store.example/v1', 't'), /fetch failed/);
});

// ---- tokens and paths ----

test('the AMO token is a short-lived HS256 JWT for the configured issuer, different each time', async () => {
  const { amoToken } = await load();
  const token = amoToken(env), [h, p, s] = token.split('.');
  assert.deepEqual(b64json(h), { alg: 'HS256', typ: 'JWT' });
  const claims = b64json(p);
  assert.equal(claims.iss, env.AMO_JWT_ISSUER);
  assert.ok(claims.exp - claims.iat <= 180, 'AMO rejects tokens valid for more than five minutes');
  assert.equal(s, crypto.createHmac('sha256', env.AMO_JWT_SECRET).update(`${h}.${p}`).digest('base64url'));
  assert.notEqual(b64json(amoToken(env).split('.')[1]).jti, claims.jti);
});

test('the App Store Connect token is an ES256 JWT signed with the .p8 key and valid for under twenty minutes', async () => {
  const { appleToken } = await load();
  const dir = scratch();
  try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const keyPath = path.join(dir, 'AuthKey.p8');
    fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    const token = appleToken({ ...env, ASC_KEY_PATH: keyPath }), [h, p, s] = token.split('.');
    assert.deepEqual(b64json(h), { alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' });
    const claims = b64json(p);
    assert.equal(claims.iss, env.ASC_ISSUER_ID);
    assert.equal(claims.aud, 'appstoreconnect-v1');
    assert.ok(claims.exp - claims.iat <= 1200 && claims.exp > Date.now() / 1000);
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Chrome token comes from gcloud impersonating the service account, and a failure does not leak gcloud\'s output', async () => {
  const { chromeToken } = await load();
  await withGcloud(async (dir) => {
    assert.equal(chromeToken(env), 'cws-token');
    const args = fs.readFileSync(path.join(dir, 'args'), 'utf8');
    assert.match(args, /auth print-access-token/);
    assert.match(args, new RegExp(`--impersonate-service-account=${env.CWS_SERVICE_ACCOUNT}`));
    assert.match(args, /--scopes=https:\/\/www\.googleapis\.com\/auth\/chromewebstore/);
  });
  await withGcloud(async () => {
    assert.throws(() => chromeToken(env), (error) => /^Google token unavailable\. Run gcloud auth login/.test(error.message) && !/secret detail/.test(error.message));
  }, { fail: true });
});

test('store paths are built from the configured IDs and escape the add-on ID', async () => {
  const { chromePath, amoPath } = await load();
  assert.equal(chromePath(env), 'publishers/pub-1/items/ext-1');
  assert.equal(amoPath(env), 'https://addons.mozilla.org/api/v5/addons/addon/glaze%40frostdev.io');
});

test('the store helpers call the right host, path and scheme', async () => {
  const { chromeStatus, amo, apple } = await load();
  const dir = scratch();
  try {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    fs.writeFileSync(path.join(dir, 'k.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
    stubFetch(() => reply({}));
    await withGcloud(() => chromeStatus(env));
    await amo(env, '/versions/1.2.3/', 'PATCH', { release_notes: {} });
    await apple({ ...env, ASC_KEY_PATH: path.join(dir, 'k.p8') }, '/apps?limit=1');
    assert.equal(calls[0].url, 'https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/ext-1:fetchStatus');
    assert.equal(calls[0].headers.Authorization, 'Bearer cws-token');
    assert.equal(calls[1].url, 'https://addons.mozilla.org/api/v5/addons/addon/glaze%40frostdev.io/versions/1.2.3/');
    assert.equal(calls[1].method, 'PATCH');
    assert.match(calls[1].headers.Authorization, /^JWT /);
    assert.equal(calls[2].url, 'https://api.appstoreconnect.apple.com/v1/apps?limit=1');
    assert.match(calls[2].headers.Authorization, /^Bearer /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Apple lookups ----

const appleEnv = () => {
  const dir = scratch(), { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(path.join(dir, 'k.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { dir, env: { ...env, ASC_KEY_PATH: path.join(dir, 'k.p8') } };
};

test('appleApp needs exactly one app for the bundle ID', async () => {
  const { appleApp } = await load(), { dir, env: e } = appleEnv();
  try {
    stubFetch(route({ 'GET /apps?filter[bundleId]=io.example.App': { data: [{ id: 'app-1' }] } }));
    assert.equal(await appleApp(e), 'app-1');
    assert.match(decodeURIComponent(calls[0].url), /filter\[bundleId\]=io\.example\.App/);
    for (const data of [[], [{ id: 'a' }, { id: 'b' }]]) {
      stubFetch(() => reply({ data }));
      await assert.rejects(appleApp(e), /Expected one existing Apple app for io\.example\.App; create its record in App Store Connect first\./);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('appleBuild asks for this build number, version and platform and returns the exact build only', async () => {
  const { appleBuild } = await load(), { dir, env: e } = appleEnv();
  try {
    const manifest = { buildNumber: '20261022120000', version: '3.3.4' };
    stubFetch(() => reply({ data: [{ id: 'other', attributes: { version: '20260101000000' } }, { id: 'mine', attributes: { version: manifest.buildNumber } }] }));
    assert.equal((await appleBuild(e, manifest, 'MAC_OS', 'app-1')).id, 'mine');
    const url = decodeURIComponent(calls[0].url);
    for (const part of ['filter[app]=app-1', 'filter[version]=20261022120000', 'filter[preReleaseVersion.version]=3.3.4', 'filter[preReleaseVersion.platform]=MAC_OS']) assert.ok(url.includes(part), part);
    stubFetch(() => reply({ data: [{ id: 'other', attributes: { version: '1' } }] }));
    assert.equal(await appleBuild(e, manifest, 'IOS', 'app-1'), undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Chrome Web Store ----

const chromeManifest = (dir, { version = '3.3.4', sha = 'a'.repeat(64) } = {}) => {
  const zip = path.join(dir, `glaze-v${version}.zip`);
  fs.writeFileSync(zip, 'PK-package-bytes');
  return { version, files: { chrome: { path: zip, sha256: sha } } };
};
const saver = () => { const saved = []; const save = () => saved.push(1); save.count = () => saved.length; return save; };
const chromeApi = (over = {}) => route({
  'GET :fetchStatus': {},
  'POST :upload': { uploadState: 'SUCCEEDED', crxVersion: '3.3.4' },
  'POST :publish': { state: 'PENDING_REVIEW' },
  ...over,
});

test('submitChrome uploads the package bytes, then submits for staged publication and records the receipt', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir), receipt = {}, save = saver();
    stubFetch(chromeApi());
    await withGcloud(() => submitChrome(env, manifest, receipt, save));
    const upload = calls.find((c) => c.url.endsWith(':upload')), publish = calls.find((c) => c.url.endsWith(':publish'));
    assert.equal(upload.url, 'https://chromewebstore.googleapis.com/upload/v2/publishers/pub-1/items/ext-1:upload');
    assert.equal(upload.headers['Content-Type'], 'application/zip');
    assert.equal(Buffer.from(upload.body).toString(), 'PK-package-bytes');
    assert.deepEqual(bodyOf(publish), { publishType: 'STAGED_PUBLISH', blockOnWarnings: true });
    assert.deepEqual(receipt, { uploadState: 'SUCCEEDED', uploaded: true, packageSHA256: manifest.files.chrome.sha256, state: 'PENDING_REVIEW', submitted: true });
    assert.ok(save.count() >= 2, 'progress is saved between upload and submission');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitChrome resumed after its upload does not upload again', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir), receipt = { uploaded: true, packageSHA256: manifest.files.chrome.sha256 };
    stubFetch(chromeApi());
    await withGcloud(() => submitChrome(env, manifest, receipt, saver()));
    assert.ok(!calls.some((c) => c.url.endsWith(':upload')));
    assert.equal(receipt.submitted, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitChrome records a version the store already holds without repeating anything, if the receipt matches these bytes', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir), status = { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '3.3.4' }] } };
    stubFetch(chromeApi({ 'GET :fetchStatus': status }));
    const receipt = { packageSHA256: manifest.files.chrome.sha256 };
    await withGcloud(() => submitChrome(env, manifest, receipt, saver()));
    assert.equal(receipt.submitted, true);
    assert.equal(receipt.state, 'PENDING_REVIEW');
    assert.ok(calls.every((c) => c.url.endsWith(':fetchStatus')), 'only the status was read');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitChrome will not adopt a same-version upload it cannot tie to these package bytes', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir), status = { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '3.3.4' }] } };
    stubFetch(chromeApi({ 'GET :fetchStatus': status }));
    await assert.rejects(withGcloud(() => submitChrome(env, manifest, { packageSHA256: 'b'.repeat(64) }, saver())), /Chrome 3\.3\.4 already exists and cannot be matched to these package bytes/);
    await assert.rejects(withGcloud(() => submitChrome(env, manifest, {}, saver())), /cannot be matched/);
    assert.ok(!calls.some((c) => c.method === 'POST'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitChrome stops at a same-version revision in a state that needs the dashboard', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir), status = { submittedItemRevisionStatus: { state: 'REJECTED', distributionChannels: [{ crxVersion: '3.3.4' }] } };
    stubFetch(chromeApi({ 'GET :fetchStatus': status }));
    await assert.rejects(withGcloud(() => submitChrome(env, manifest, { packageSHA256: manifest.files.chrome.sha256 }, saver())), /Chrome 3\.3\.4: REJECTED\. Resolve it in the dashboard\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitChrome refuses to replace another pending submission, but a cancelled or rejected one does not hold the slot', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir);
    stubFetch(chromeApi({ 'GET :fetchStatus': { submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '3.3.3' }] } } }));
    await assert.rejects(withGcloud(() => submitChrome(env, manifest, {}, saver())), /Chrome has another submission/);
    assert.ok(!calls.some((c) => c.method === 'POST'), 'nothing was uploaded over it');
    for (const state of ['CANCELLED', 'REJECTED']) {
      stubFetch(chromeApi({ 'GET :fetchStatus': { submittedItemRevisionStatus: { state, distributionChannels: [{ crxVersion: '3.3.3' }] } } }));
      const receipt = {};
      await withGcloud(() => submitChrome(env, manifest, receipt, saver()));
      assert.equal(receipt.submitted, true, state);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitChrome fails when the upload is not accepted, and when the store does not confirm the submission', async () => {
  const { submitChrome } = await load(), dir = scratch();
  try {
    const manifest = chromeManifest(dir);
    stubFetch(chromeApi({ 'POST :upload': { uploadState: 'FAILURE' } }));
    const failed = {};
    await assert.rejects(withGcloud(() => submitChrome(env, manifest, failed, saver())), /Chrome upload failed: FAILURE/);
    assert.ok(!failed.uploaded && !failed.submitted, 'a failed upload is not recorded as done');
    stubFetch(chromeApi({ 'POST :publish': { state: 'DRAFT' } }));
    const unconfirmed = {};
    await assert.rejects(withGcloud(() => submitChrome(env, manifest, unconfirmed, saver())), /Chrome returned DRAFT; submission not confirmed\./);
    assert.ok(unconfirmed.uploaded && !unconfirmed.submitted, 'the upload is kept so a rerun only submits');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- Firefox Add-ons ----

const firefoxManifest = (dir, sha = 'c'.repeat(64)) => {
  const upload = path.join(dir, 'glaze-v3.3.4-firefox.zip'), source = path.join(dir, 'glaze-v3.3.4-source.zip');
  fs.writeFileSync(upload, 'firefox-package'); fs.writeFileSync(source, 'firefox-source');
  return { version: '3.3.4', notes: 'What changed', files: { firefox: { path: upload, sha256: sha }, firefoxSource: { path: source, sha256: 'd'.repeat(64) } } };
};
const AMO = '/api/v5/addons/';
const amoApi = (over = {}) => route({
  [`GET ${AMO}addon/glaze%40frostdev.io/versions/3.3.4/`]: () => reply({ detail: 'not found' }, 404),
  [`POST ${AMO}upload/`]: { uuid: 'upload-1' },
  [`GET ${AMO}upload/upload-1/`]: { processed: true, valid: true, validation: {} },
  [`POST ${AMO}addon/glaze%40frostdev.io/versions/`]: { id: 77, file: { status: 'unreviewed' } },
  [`PATCH ${AMO}addon/glaze%40frostdev.io/versions/77/`]: {},
  ...over,
});

test('submitFirefox uploads the package as a listed upload, waits for validation, then adds the version with its source and notes', async () => {
  const { submitFirefox } = await load(), dir = scratch();
  try {
    const manifest = firefoxManifest(dir), receipt = {}, save = saver();
    stubFetch(amoApi());
    await submitFirefox(env, manifest, receipt, save);
    const upload = calls.find((c) => c.method === 'POST' && c.url.endsWith('/addons/upload/'));
    assert.equal(upload.body.get('channel'), 'listed');
    assert.equal(upload.body.get('upload').name, 'glaze-v3.3.4-firefox.zip');
    assert.match(upload.headers.Authorization, /^JWT /);
    const version = calls.find((c) => c.method === 'POST' && c.url.endsWith('/versions/'));
    assert.equal(version.body.get('upload'), 'upload-1');
    assert.equal(version.body.get('source').name, 'glaze-v3.3.4-source.zip');
    const notes = bodyOf(calls.find((c) => c.method === 'PATCH'));
    assert.equal(notes.release_notes['en-US'], 'What changed');
    assert.match(notes.approval_notes, /reviewer\/rebuild\.py verify/);
    assert.deepEqual(receipt, { uploadId: 'upload-1', versionId: 77, packageSHA256: manifest.files.firefox.sha256, state: 'unreviewed', submitted: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitFirefox reports an invalid package and creates no version', async () => {
  const { submitFirefox } = await load(), dir = scratch();
  try {
    stubFetch(amoApi({ [`GET ${AMO}upload/upload-1/`]: { processed: true, valid: false, validation: { errors: 1, messages: [{ message: 'bad manifest' }] } } }));
    const receipt = {};
    await assert.rejects(submitFirefox(env, firefoxManifest(dir), receipt, saver()), /AMO validation failed: .*bad manifest/);
    assert.ok(!calls.some((c) => c.url.endsWith('/versions/') && c.method === 'POST'));
    assert.equal(receipt.uploadId, 'upload-1', 'the upload ID is kept for a rerun');
    assert.ok(!receipt.submitted);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitFirefox does not upload a second time when its upload was already made', async () => {
  const { submitFirefox } = await load(), dir = scratch();
  try {
    stubFetch(amoApi());
    await submitFirefox(env, firefoxManifest(dir), { uploadId: 'upload-1' }, saver());
    assert.ok(!calls.some((c) => c.method === 'POST' && c.url.endsWith('/addons/upload/')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const existingVersion = (extra = {}) => ({ id: 77, source: 'https://src.example/x.zip', file: { status: 'public', hash: `sha256:${'c'.repeat(64)}` }, ...extra });

test('submitFirefox adopts an existing version only when the file hash or the receipt matches, and never replaces it', async () => {
  const { submitFirefox } = await load(), dir = scratch();
  try {
    const manifest = firefoxManifest(dir), versionURL = `GET ${AMO}addon/glaze%40frostdev.io/versions/3.3.4/`;
    stubFetch(amoApi({ [versionURL]: existingVersion(), [`PATCH ${AMO}addon/glaze%40frostdev.io/versions/77/`]: {} }));
    const receipt = {};
    await submitFirefox(env, manifest, receipt, saver());
    assert.equal(receipt.versionId, 77);
    assert.equal(receipt.state, 'public');
    assert.ok(!calls.some((c) => c.method === 'POST'), 'nothing uploaded over an existing version');
    // A signed XPI no longer has the uploaded hash: the receipt from the original run vouches for it.
    stubFetch(amoApi({ [versionURL]: existingVersion({ file: { status: 'public', hash: 'sha256:signed' } }) }));
    await submitFirefox(env, manifest, { versionId: 77, packageSHA256: manifest.files.firefox.sha256 }, saver());
    stubFetch(amoApi({ [versionURL]: existingVersion({ file: { status: 'public', hash: 'sha256:someone-elses' } }) }));
    await assert.rejects(submitFirefox(env, manifest, {}, saver()), /AMO already has this version and its package cannot be matched to this release/);
    await assert.rejects(submitFirefox(env, manifest, { versionId: 78, packageSHA256: manifest.files.firefox.sha256 }, saver()), /cannot be matched/);
    assert.ok(!calls.some((c) => c.method === 'POST' || c.method === 'PATCH'), 'a mismatch changes nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitFirefox refuses a disabled version and fills in a missing source on an existing one', async () => {
  const { submitFirefox } = await load(), dir = scratch();
  try {
    const manifest = firefoxManifest(dir), versionURL = `GET ${AMO}addon/glaze%40frostdev.io/versions/3.3.4/`;
    stubFetch(amoApi({ [versionURL]: existingVersion({ is_disabled: true }) }));
    await assert.rejects(submitFirefox(env, manifest, {}, saver()), /This Firefox version is disabled/);
    stubFetch(amoApi({ [versionURL]: existingVersion({ source: null }) }));
    await submitFirefox(env, manifest, {}, saver());
    const patches = calls.filter((c) => c.method === 'PATCH');
    assert.equal(patches.length, 2, 'the source, then the notes');
    assert.ok(patches[0].body instanceof FormData && patches[0].body.get('source').name === 'glaze-v3.3.4-source.zip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitFirefox lets an unexpected AMO error through instead of treating it as "no such version"', async () => {
  const { submitFirefox } = await load(), dir = scratch();
  try {
    stubFetch(amoApi({ [`GET ${AMO}addon/glaze%40frostdev.io/versions/3.3.4/`]: () => reply({ detail: 'down' }, 500) }));
    await assert.rejects(submitFirefox(env, firefoxManifest(dir), {}, saver()), (error) => error.status === 500 && /HTTP 500/.test(error.message));
    assert.ok(!calls.some((c) => c.method === 'POST'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- App Store Connect ----

const BUILD = { id: 'build-1', attributes: { version: '20261022120000', processingState: 'VALID', expired: false } };
const appleManifest = { version: '3.3.4', buildNumber: '20261022120000', notes: 'Notes for Apple', applePlatforms: ['MAC_OS'] };
const appleApi = (over = {}) => route({
  'GET /apps?filter[bundleId]=io.example.App': { data: [{ id: 'app-1' }] },
  'GET /builds*': { data: [BUILD] },
  ...over,
});
const queryOf = (call) => decodeURIComponent(new URL(call.url).search);

test('submitApple submits a new version for manual release with the English notes only, then confirms the review state', async () => {
  const { submitApple } = await load(), { dir, env: e } = appleEnv();
  try {
    const posts = [];
    stubFetch(appleApi({
      'GET /apps/app-1/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=3.3.4': { data: [] },
      'POST /appStoreVersions': (call) => { posts.push(bodyOf(call)); return reply({ data: { id: 'ver-1', attributes: { releaseType: 'MANUAL' } } }); },
      'PATCH /appStoreVersions/ver-1': {},
      'PATCH /appStoreVersions/ver-1/relationships/build': {},
      'GET /appStoreVersions/ver-1/appStoreVersionLocalizations?limit=200': { data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }, { id: 'loc-de', attributes: { locale: 'de-DE' } }] },
      'PATCH /appStoreVersionLocalizations/loc-en': {},
      'GET /apps/app-1/reviewSubmissions?filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,CANCELING,COMPLETING&limit=200': { data: [] },
      'POST /reviewSubmissions': { data: { id: 'sub-1', attributes: { state: 'READY_FOR_REVIEW' } } },
      'POST /reviewSubmissionItems': {},
      'PATCH /reviewSubmissions/sub-1': {},
      'GET /reviewSubmissions/sub-1': { data: { id: 'sub-1', attributes: { state: 'WAITING_FOR_REVIEW' } } },
    }));
    const receipt = {};
    await submitApple(e, appleManifest, receipt, saver());
    assert.deepEqual(posts[0].data.attributes, { platform: 'MAC_OS', versionString: '3.3.4', releaseType: 'MANUAL' });
    const patched = calls.filter((c) => c.method === 'PATCH' && c.url.includes('/appStoreVersionLocalizations/'));
    assert.deepEqual(patched.map((c) => c.url.split('/').pop()), ['loc-en'], 'only English notes change');
    assert.equal(bodyOf(patched[0]).data.attributes.whatsNew, 'Notes for Apple');
    const submitted = calls.filter((c) => c.method === 'PATCH' && c.url.endsWith('/reviewSubmissions/sub-1'));
    assert.deepEqual(bodyOf(submitted[0]).data.attributes, { submitted: true });
    assert.deepEqual(receipt.MAC_OS, { versionId: 'ver-1', submissionId: 'sub-1', state: 'WAITING_FOR_REVIEW', submitted: true });
    assert.equal(receipt.submitted, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitApple records a version already in review when it is tied to this build, and refuses one tied to another build', async () => {
  const { submitApple } = await load(), { dir, env: e } = appleEnv();
  try {
    const versions = { 'GET /apps/app-1/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=3.3.4': { data: [{ id: 'ver-1', attributes: { appVersionState: 'WAITING_FOR_REVIEW' } }] } };
    stubFetch(appleApi({ ...versions, 'GET /appStoreVersions/ver-1/build': { data: { id: 'build-1' } } }));
    const receipt = {};
    await submitApple(e, appleManifest, receipt, saver());
    assert.equal(receipt.MAC_OS.submitted, true);
    assert.equal(receipt.MAC_OS.state, 'WAITING_FOR_REVIEW');
    assert.ok(!calls.some((c) => c.method !== 'GET'), 'nothing was changed');
    stubFetch(appleApi({ ...versions, 'GET /appStoreVersions/ver-1/build': { data: { id: 'build-OTHER' } } }));
    await assert.rejects(submitApple(e, appleManifest, {}, saver()), /Apple MAC_OS: this version is tied to a different build\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitApple stops on a build that is invalid or expired, and on a review draft with other items', async () => {
  const { submitApple } = await load(), { dir, env: e } = appleEnv();
  try {
    stubFetch(appleApi({ 'GET /builds*': { data: [{ ...BUILD, attributes: { ...BUILD.attributes, processingState: 'INVALID' } }] } }));
    await assert.rejects(submitApple(e, appleManifest, {}, saver()), /Apple MAC_OS: build 20261022120000 is INVALID or expired\./);
    stubFetch(appleApi({ 'GET /builds*': { data: [{ ...BUILD, attributes: { ...BUILD.attributes, expired: true } }] } }));
    await assert.rejects(submitApple(e, appleManifest, {}, saver()), /is VALID or expired/);
    stubFetch(appleApi({
      'GET /apps/app-1/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=3.3.4': { data: [{ id: 'ver-1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', releaseType: 'MANUAL' } }] },
      'PATCH /appStoreVersions/ver-1': {},
      'PATCH /appStoreVersions/ver-1/relationships/build': {},
      'GET /appStoreVersions/ver-1/build': { data: { id: 'build-1' } },
      'GET /apps/app-1/reviewSubmissions?filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,CANCELING,COMPLETING&limit=200': { data: [{ id: 'draft', attributes: { state: 'READY_FOR_REVIEW' } }] },
      'GET /reviewSubmissions/draft/items?include=appStoreVersion&limit=200': { data: [
        { relationships: { appStoreVersion: { data: { id: 'ver-1' } } } },
        { relationships: { appStoreVersion: { data: { id: 'someone-elses-version' } } } },
      ] },
    }));
    await assert.rejects(submitApple(e, appleManifest, {}, saver()), /The Apple draft contains other review items/);
    assert.ok(!calls.some((c) => c.method === 'POST'), 'nothing was submitted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitApple tells a first platform release (no What\'s New field) from any other metadata error', async () => {
  const { submitApple } = await load(), { dir, env: e } = appleEnv();
  try {
    const refusal = () => reply({ errors: [{ detail: "Attribute 'whatsNew' cannot be edited at this time" }] }, 409);
    const table = (history) => ({
      'GET /apps/app-1/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=3.3.4': { data: [{ id: 'ver-1', attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', releaseType: 'MANUAL' } }] },
      'PATCH /appStoreVersions/ver-1': {},
      'PATCH /appStoreVersions/ver-1/relationships/build': {},
      'GET /appStoreVersions/ver-1/appStoreVersionLocalizations?limit=200': { data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }] },
      'PATCH /appStoreVersionLocalizations/loc-en': refusal,
      'GET /apps/app-1/appStoreVersions?filter[platform]=MAC_OS&limit=2': history,
      'GET /apps/app-1/reviewSubmissions?filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,CANCELING,COMPLETING&limit=200': { data: [] },
      'POST /reviewSubmissions': { data: { id: 'sub-1', attributes: { state: 'READY_FOR_REVIEW' } } },
      'POST /reviewSubmissionItems': {},
      'PATCH /reviewSubmissions/sub-1': {},
      'GET /reviewSubmissions/sub-1': { data: { id: 'sub-1', attributes: { state: 'IN_REVIEW' } } },
    });
    stubFetch(appleApi(table({ data: [{ id: 'ver-1' }] })));
    const receipt = {};
    await submitApple(e, appleManifest, receipt, saver());
    assert.equal(receipt.MAC_OS.state, 'IN_REVIEW', 'the first release carries on without What\'s New');
    stubFetch(appleApi(table({ data: [{ id: 'ver-0' }, { id: 'ver-1' }] })));
    await assert.rejects(submitApple(e, appleManifest, {}, saver()), (error) => error.status === 409 && /whatsNew/.test(error.message));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('submitApple starts a new review for a rejected version instead of adopting its completed historical one', async () => {
  const { submitApple } = await load(), { dir, env: e } = appleEnv();
  try {
    const old = 'GET /reviewSubmissions/old/items*';
    stubFetch(appleApi({
      'GET /apps/app-1/appStoreVersions?filter[platform]=MAC_OS&filter[versionString]=3.3.4': { data: [{ id: 'ver-1', attributes: { appVersionState: 'REJECTED', releaseType: 'MANUAL' } }] },
      'PATCH /appStoreVersions/ver-1': {},
      'PATCH /appStoreVersions/ver-1/relationships/build': {},
      'GET /appStoreVersions/ver-1/appStoreVersionLocalizations?limit=200': { data: [{ id: 'loc-en', attributes: { locale: 'en-US' } }] },
      'PATCH /appStoreVersionLocalizations/loc-en': {},
      'GET /apps/app-1/reviewSubmissions*': { data: [{ id: 'old', attributes: { state: 'COMPLETE' } }] },
      [old]: { data: [{ relationships: { appStoreVersion: { data: { id: 'ver-1' } } } }] },
      'POST /reviewSubmissions': { data: { id: 'sub-2', attributes: { state: 'READY_FOR_REVIEW' } } },
      'POST /reviewSubmissionItems': {},
      'PATCH /reviewSubmissions/sub-2': {},
      'GET /reviewSubmissions/sub-2': { data: { id: 'sub-2', attributes: { state: 'WAITING_FOR_REVIEW' } } },
    }));
    const receipt = {};
    await submitApple(e, appleManifest, receipt, saver());
    assert.ok(!calls.some((c) => c.url.includes('/reviewSubmissions/old/')), 'the finished review is not read, let alone reused');
    assert.equal(receipt.MAC_OS.submissionId, 'sub-2');
    assert.equal(receipt.MAC_OS.submitted, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
