// lib/bb-preview.js: the worker's reading of Ultra's preview chain, over the probed shapes (scripts/ultra-mock.js PREVIEW).
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/bb-preview.js');
const { PREVIEW: P, SITE } = require('../scripts/ultra-mock.js');

const [slides, lab] = P.FILES;
const AT = Date.UTC(2026, 9, 30, 14, 20, 0);

test('viewerUrl: the site\'s own /bbcswebdav/ file, as a path or a full address, nothing else', () => {
  assert.equal(B.viewerUrl(P.viewerUrlOf(slides), SITE).href, `${SITE}${slides.at}?locale=en_US&isInlineRender=true&xythos-download=true&render=inline`);
  assert.equal(B.viewerUrl(P.viewerUrlOf(lab), SITE).pathname, lab.at);
  for (const bad of [`https://elsewhere.test${slides.at}`, `${SITE}/learn/api/v1/users/me`, 'javascript:alert(1)', `https://u:p@bb.school.test${slides.at}`, 42, `${SITE}/bbcswebdav/${'x'.repeat(9000)}`]) assert.equal(B.viewerUrl(bad, SITE), null, String(bad).slice(0, 60));
});

test('viewer: the redirect\'s hash, tenant, status and original, as probed', () => {
  const v = B.viewer(P.viewerAt(slides, AT));
  assert.deepEqual({ ...v, original: v.original.slice(0, 48) }, { origin: P.VIEWER, hash: slides.hash, tenant: P.TENANT, status: 'done', original: 'https://bb-school-test.prod.files.blackboard.com' });
  assert.equal(B.viewer(P.viewerAt(slides, AT, 'converting')).status, 'converting');
  assert.equal(B.api(v), `${P.VIEWER}/api/v1/tenants/${P.TENANT}/documents/${slides.hash}?url=${encodeURIComponent(v.original)}`);
  const u = new URL(P.viewerAt(slides, AT));
  const variant = (f) => { const x = new URL(u); f(x); return B.viewer(x.href); };
  assert.equal(variant((x) => { x.hostname = 'basic-doc-viewer.evil.test'; }), null, 'another host');
  assert.equal(variant((x) => { x.protocol = 'http:'; }), null, 'not https');
  assert.equal(variant((x) => { x.pathname = '/api/v1/x'; }), null, 'not the viewer page');
  assert.equal(variant((x) => x.searchParams.set('hash', 'abc')), null, 'a hash that is not 40 hex');
  assert.equal(variant((x) => x.searchParams.delete('tenantId')), null, 'no tenant');
  assert.equal(variant((x) => x.searchParams.set('originalUrl', 'http://x.test/a')), null, 'an original that is not https');
  assert.equal(B.viewer(`${SITE}/webapps/login/`), null, 'the sign-in page');
});

test('answer: done → the presigned PDF and when it ends; converting; failed; anything else a shape failure', () => {
  const done = B.answer(P.documentOf(slides, AT), slides.hash, AT);
  assert.equal(done.status, 'done');
  assert.ok(done.pdf.startsWith(`${P.BUCKET}/files/${P.TENANT}/${slides.hash}/converted.pdf?X-Amz-`));
  assert.equal(done.expires, Math.floor(AT / 1000) * 1000 + 3600e3, 'X-Amz-Date + X-Amz-Expires');
  assert.deepEqual(B.answer(P.documentOf(slides, AT, { status: 'converting' }), slides.hash, AT), { status: 'converting' });
  assert.deepEqual(B.answer({ hash: slides.hash, status: 'failed' }, slides.hash, AT), { error: 'refused' });
  assert.deepEqual(B.answer({ ...P.documentOf(slides, AT), hash: lab.hash }, slides.hash, AT), { error: 'shape' }, 'another document');
  assert.deepEqual(B.answer({ status: 'done', urls: { pdf: 'https://evil.test/converted.pdf' } }, slides.hash, AT), { error: 'shape' }, 'not S3');
  assert.deepEqual(B.answer({ status: 'done', urls: {} }, slides.hash, AT), { error: 'shape' });
  for (const j of [null, [], 'done', 7]) assert.deepEqual(B.answer(j, slides.hash, AT), { error: 'shape' });
  const bare = B.answer({ status: 'done', urls: { pdf: `${P.BUCKET}/files/x/converted.pdf` } }, slides.hash, AT);
  assert.equal(bare.expires, AT + 10 * 60e3, 'no X-Amz-Date: ten minutes');
});

// A fetch over the mock's chain (redirect followed, as the browser does), with what each step was asked.
const chain = (over = {}) => {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, credentials: init.credentials, redirect: init.redirect });
    const u = new URL(url);
    if (over[u.origin]) return over[u.origin](u, init);
    if (u.origin === SITE) return { ok: true, status: 200, url: P.viewerAt(P.FILES.find((f) => f.at === u.pathname), AT), body: null, headers: new Headers() };
    if (u.origin === P.VIEWER) return new Response(JSON.stringify(P.documentOf(P.FILES.find((f) => u.pathname.endsWith(f.hash)), AT)), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new TypeError('Failed to fetch');
  };
  return { fetch, asked };
};

test('ask: the whole chain with the session, the redirect followed and the API not', async () => {
  const c = chain();
  const r = await B.ask(P.viewerUrlOf(slides), SITE, { fetch: c.fetch, now: () => AT });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'done');
  assert.ok(r.pdf.includes('/converted.pdf?'));
  assert.deepEqual(c.asked.map((a) => [new URL(a.url).origin, a.credentials, a.redirect]), [[SITE, 'include', 'follow'], [P.VIEWER, 'include', 'error']]);
  assert.equal(c.asked[1].url, B.api(B.viewer(P.viewerAt(slides, AT))));
});

test('ask: named failures', async () => {
  const run = (over, url = P.viewerUrlOf(slides), timeout) => B.ask(url, SITE, { fetch: chain(over).fetch, now: () => AT, timeout });
  assert.deepEqual(await run({}, 'https://elsewhere.test/bbcswebdav/x'), { ok: false, error: 'address' });
  assert.deepEqual(await run({ [SITE]: () => ({ ok: false, status: 401, url: '', body: null, headers: new Headers() }) }), { ok: false, error: 'signed-out' });
  assert.deepEqual(await run({ [SITE]: () => ({ ok: true, status: 200, url: `${SITE}/webapps/login/?action=relogin`, body: null, headers: new Headers() }) }), { ok: false, error: 'signed-out' });
  assert.deepEqual(await run({ [SITE]: () => ({ ok: true, status: 200, url: 'https://sso.school.test/login', body: null, headers: new Headers() }) }), { ok: false, error: 'viewer' });
  assert.deepEqual(await run({ [P.VIEWER]: () => new Response('{}', { status: 500 }) }), { ok: false, error: 'api' });
  assert.deepEqual(await run({ [P.VIEWER]: () => new Response('{}', { status: 403 }) }), { ok: false, error: 'signed-out' });
  assert.deepEqual(await run({ [P.VIEWER]: () => new Response('<html>') }), { ok: false, error: 'shape' });
  assert.deepEqual(await run({ [P.VIEWER]: () => new Response('x'.repeat(B.LIMITS.json + 1)) }), { ok: false, error: 'too-big' });
  assert.deepEqual(await run({ [P.VIEWER]: () => new Response(JSON.stringify({ status: 'converting', hash: slides.hash })) }), { ok: true, status: 'converting' });
  assert.deepEqual(await run({ [SITE]: () => { throw new TypeError('Failed to fetch'); } }), { ok: false, error: 'network' });
  const hang = (u, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError'))));
  assert.deepEqual(await run({ [P.VIEWER]: hang }, undefined, 30), { ok: false, error: 'timeout' });
});
