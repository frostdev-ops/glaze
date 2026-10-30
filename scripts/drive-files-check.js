// Google Drive's files (lib/drive.js) on the Documents home, headless, in the real extension (a staged copy, Drive's switch on
// as scripts/dev-drive.sh turns it on) with its real worker. A stand-in answers for Drive v3 (www.googleapis.com, its shapes
// test/fixtures/drive/v3.js's) and Google's userinfo and revoke, through Playwright's route() and, for what route() can't
// see, a local HTTPS server those hosts resolve to; every other host is refused. Sign-in is Chrome's getAuthToken (the check's
// stand-in for Chrome's account) and the Picker the worker's pick, stood in for with the files it would hand back
// (scripts/google-check.js covers both for real).
//   Before Drive is connected: no From Google Drive. Connected: it shows beside Import, without a reload.
//   Open: a Word file (alt=media) and a Google Doc (exported as .docx) become documents; a file Drive no longer has says so.
//   Save: a new Word file in My Drive, the same file updated next time, a Google Doc, and a new Doc once the remembered one
//   is gone; each request's address, method, token and body checked; no cookie and no token in storage at any point.
//   The paper's ⋯ menu offers From Google Drive; Disconnect takes the entries away.
//   NODE_PATH=<installed playwright> nice node scripts/drive-files-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('./check-env.js');
const { MIME, FILES, SAVED, ERRORS } = require('../test/fixtures/drive/v3.js');

const CONFIG = require('../lib/google-config.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '..'), []);
{
  const file = path.join(ext, 'manifest.json'), m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.permissions = [...m.permissions, 'identity'];
  m.optional_permissions = m.optional_permissions.filter((p) => p !== 'identity');
  m.oauth2 = { client_id: CONFIG.chrome, scopes: CONFIG.scopes };
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  // Drive's build-time switch on in this copy only (the staged file is a link: replaced, not edited).
  const g = path.join(ext, 'lib/google.js'), src = fs.readFileSync(g, 'utf8');
  if (!src.includes('\n  const ON = false;\n')) throw new Error('lib/google.js: no ON switch');
  fs.rmSync(g);
  fs.writeFileSync(g, src.replace('\n  const ON = false;\n', '\n  const ON = true;\n'));
}
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const TOKEN = 'ya29.check-drive-token';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-drive-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks++; console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };

// Drive as the stand-in holds it: id → { meta, bytes }; the files saved get new ids.
const drive = new Map();
let made = 0;
const log = { drive: [], userinfo: [], revoke: [], other: [] };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, HEAD, POST, PATCH' };
const reply = (status, body, headers = {}) => ({ status, headers: { ...CORS, 'content-type': 'application/json; charset=UTF-8', ...headers }, body: Buffer.from(JSON.stringify(body)) });
// A multipart/related body: its metadata and its media.
const parts = (type, body) => {
  const b = /boundary=([^;]+)/.exec(type || '')?.[1];
  if (!b) return null;
  const s = body.toString('latin1'), head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, mid = s.indexOf(`\r\n--${b}\r\n`), tail = `\r\n--${b}--`;
  if (!s.startsWith(head) || mid < 0 || !s.endsWith(tail)) return null;
  const media = s.slice(mid + `\r\n--${b}\r\n`.length, -tail.length), cut = media.indexOf('\r\n\r\n');
  return { meta: JSON.parse(Buffer.from(s.slice(head.length, mid), 'latin1').toString('utf8')), type: media.slice('Content-Type: '.length, cut), media: Buffer.from(media.slice(cut + 4), 'latin1') };
};
const answer = ({ method, url, headers, body }, via) => {
  const u = new URL(url);
  if (method === 'OPTIONS') return { status: 204, headers: CORS, body: Buffer.alloc(0) };
  if (u.href === 'https://openidconnect.googleapis.com/v1/userinfo') {
    log.userinfo.push(headers.authorization);
    return reply(200, { sub: '42', email: 'student@school.edu', email_verified: true });
  }
  if (u.href === 'https://oauth2.googleapis.com/revoke') { log.revoke.push(body.toString()); return { status: 200, headers: CORS, body: Buffer.alloc(0) }; }
  if (u.origin === 'https://www.googleapis.com') {
    const entry = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: headers.authorization, cookie: headers.cookie || null, via };
    log.drive.push(entry);
    if (headers.authorization !== `Bearer ${TOKEN}`) return reply(401, ERRORS[401]);
    let m = /^\/drive\/v3\/files\/([\w-]+)(\/export)?$/.exec(u.pathname);
    if (m && method === 'GET') {
      const f = drive.get(m[1]);
      if (!f) return reply(404, ERRORS[404]);
      if (m[2]) return { status: 200, headers: { ...CORS, 'content-type': u.searchParams.get('mimeType') }, body: f.bytes };
      if (u.searchParams.get('alt') === 'media') return { status: 200, headers: { ...CORS, 'content-type': f.meta.mimeType }, body: f.bytes };
      const keep = ['id', 'name', 'mimeType', 'size', 'trashed', 'capabilities'];
      return reply(200, Object.fromEntries(keep.filter((k) => f.meta[k] !== undefined).map((k) => [k, f.meta[k]])));
    }
    m = /^\/upload\/drive\/v3\/files(?:\/([\w-]+))?$/.exec(u.pathname);
    if (m && (method === 'POST' || method === 'PATCH') && u.searchParams.get('uploadType') === 'multipart') {
      const p = parts(headers['content-type'], body);
      entry.upload = p && { meta: p.meta, type: p.type, size: p.media.length, zip: p.media.subarray(0, 2).toString('latin1') === 'PK' };
      if (!p) return reply(400, ERRORS[404]);
      if (method === 'PATCH') {
        const f = drive.get(m[1]);
        if (!f) return reply(404, ERRORS[404]);
        f.bytes = p.media;
        return reply(200, { id: f.meta.id, name: f.meta.name, mimeType: f.meta.mimeType });
      }
      const fresh = { id: `1NeW_${++made}`, name: p.meta.name, mimeType: p.meta.mimeType, size: String(p.media.length), trashed: false, capabilities: { canEdit: true, canDownload: true } };
      drive.set(fresh.id, { meta: fresh, bytes: p.media });
      return reply(200, { id: fresh.id, name: fresh.name, mimeType: fresh.mimeType });
    }
    return reply(400, { error: { errors: [{ domain: 'global', reason: 'badRequest', message: 'Bad Request' }], code: 400, message: 'Bad Request' } });
  }
  log.other.push(`${via} ${u.href}`);
  return null;
};
const HOSTS = ['www.googleapis.com', 'openidconnect.googleapis.com', 'oauth2.googleapis.com'];

(async () => {
  let ctx, server;
  const errors = [];
  try {
    const { execFileSync } = require('node:child_process');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem'), '-days', '1', '-subj', '/CN=glaze-drive-check'], { stdio: 'ignore' });
    server = require('node:https').createServer({ key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) }, (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const a = answer({ method: req.method, url: `https://${req.headers.host.replace(/:\d+$/, '')}${req.url}`, headers: req.headers, body: Buffer.concat(chunks) }, 'server');
        if (!a) return req.socket.destroy();
        res.writeHead(a.status, a.headers);
        res.end(a.body);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const rules = [...HOSTS.map((h) => `MAP ${h} 127.0.0.1:${server.address().port}`), 'MAP * ~NOTFOUND'].join(', ');
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=${rules}`, '--ignore-certificate-errors', '--disable-background-networking', '--renderer-process-limit=1'] });
    env.noFirstRun(ctx);
    await ctx.route('**/*', async (route) => {
      const r = route.request();
      if (new URL(r.url()).protocol === 'chrome-extension:') return route.continue();
      const a = answer({ method: r.method(), url: r.url(), headers: await r.allHeaders(), body: r.postDataBuffer() || Buffer.alloc(0) }, 'route');
      return a ? route.fulfill({ status: a.status, headers: a.headers, body: a.body }) : route.abort('connectionrefused');
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    const settings = await ctx.newPage();
    settings.on('pageerror', (e) => errors.push(`settings: ${e}`));
    await settings.goto(`chrome-extension://${id}/options.html`);
    await env.installed(settings);
    await sw.evaluate((t) => {
      globalThis.__gzAuth = [];
      chrome.identity.getAuthToken = async (d) => { __gzAuth.push(d); return { token: t, grantedScopes: d.scopes }; };
      chrome.identity.removeCachedAuthToken = async () => {};
      chrome.identity.clearAllCachedAuthTokens = async () => {};
    }, TOKEN);
    const noToken = async (label) => {
      const all = await settings.evaluate(async () => JSON.stringify(await Promise.all(['local', 'sync', 'session'].map((a) => chrome.storage[a].get(null)))));
      ok(!all.includes(TOKEN), `${label}: no token in storage.local, sync or session`);
    };

    const home = await ctx.newPage();
    home.on('pageerror', (e) => errors.push(`home: ${e}`));
    await home.goto(`chrome-extension://${id}/papers.html`);
    await until(() => home.evaluate(() => !document.getElementById('list')?.hidden && !!globalThis.GZ_DOCUMENTS), 'the Documents home');
    const fromB = home.locator('.gd-extra button', { hasText: 'From Google Drive' });
    await pause(500);
    ok(await fromB.count() === 0, 'not connected: no From Google Drive');

    // A Word file and a Google Doc in the stand-in's Drive, their bytes a real .docx the page itself writes.
    const docx = Buffer.from(await home.evaluate(async () => {
      await GZ_WRITER_PAPER.need(['lib/writer-styles.js', 'lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js', 'lib/writer-objects-docx.js']);
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Brought from Drive: the river keeps what the town forgets.' }] }] };
      return Array.from(GZ_WRITER_DOCX.exportDocx(doc, { format: GZ_WRITER_STYLES.FORMATS.plain, surname: '', title: '' }).bytes);
    }));
    drive.set('1DocX_bin', { meta: { ...FILES.docx, id: '1DocX_bin', name: 'River notes.docx', size: String(docx.length) }, bytes: docx });
    drive.set(FILES.doc.id, { meta: FILES.doc, bytes: docx });

    ok(await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'connect' })).then((r) => r.ok && r.email === 'student@school.edu'), 'Drive connects (Chrome\'s sign-in, the check\'s account)');
    await until(() => fromB.isVisible(), 'From Google Drive after connecting');
    ok(await home.evaluate(() => { const b = [...document.querySelectorAll('.gd-extra button')].find((x) => x.textContent === 'From Google Drive'); return b?.closest('.gd-tools')?.querySelector('#gd-import') === b.closest('.gd-extra').nextElementSibling; }), 'connected: From Google Drive shows beside Import, without a reload');
    await home.screenshot({ path: path.join(out, 'drive-1-connected.png') });

    // The Picker's answer, as lib/google.js pick hands it back.
    const picks = (files) => sw.evaluate((f) => { openGoogle().pick = async () => ({ ok: true, files: f }); }, files);
    const titles = () => home.evaluate(() => [...document.querySelectorAll('.gd-card')].map((c) => c.querySelector('.gd-title').textContent));
    const keyOf = (title) => home.evaluate((t) => [...document.querySelectorAll('.gd-card')].find((c) => c.querySelector('.gd-title').textContent === t)?.dataset.key, title);
    const said = () => home.locator('#gd-said').textContent();

    // ---- open: a Word file, by alt=media
    await picks([{ id: '1DocX_bin', name: 'River notes.docx', mimeType: MIME.docx }]);
    let n = log.drive.length;
    await fromB.click();
    await until(async () => (await titles()).includes('River notes'), 'River notes listed');
    let asked = log.drive.slice(n);
    ok(asked.length === 2 && asked[0].method === 'GET' && asked[0].path === '/drive/v3/files/1DocX_bin' && asked[0].query.fields === 'id,name,mimeType,size,trashed,capabilities(canEdit,canDownload)' && asked[0].query.supportsAllDrives === 'true',
      `open: files.get for its metadata (${JSON.stringify(asked[0]?.query)})`);
    ok(asked[1].path === '/drive/v3/files/1DocX_bin' && asked[1].query.alt === 'media', 'then its bytes with alt=media');
    ok(asked.every((x) => x.auth === `Bearer ${TOKEN}` && !x.cookie), 'each with the token and no cookie');
    const river = await keyOf('River notes');
    ok(await home.evaluate(async (k) => JSON.stringify((await chrome.storage.local.get(`writerPaper:${k}`))[`writerPaper:${k}`]?.doc).includes('the river keeps what the town forgets'), river), 'the Word file is a document now, its text kept');

    // ---- open: a Google Doc, exported as .docx
    await picks([{ id: FILES.doc.id, name: FILES.doc.name, mimeType: MIME.doc }]);
    n = log.drive.length;
    await fromB.click();
    await until(async () => (await titles()).includes('Lab notes'), 'Lab notes listed');
    asked = log.drive.slice(n);
    ok(asked.length === 2 && asked[1].path === `/drive/v3/files/${FILES.doc.id}/export` && asked[1].query.mimeType === MIME.docx && Object.keys(asked[1].query).length === 1, `open: a Google Doc exports as .docx (${JSON.stringify(asked[1]?.query)})`);
    await home.screenshot({ path: path.join(out, 'drive-2-opened.png') });

    // ---- open: a file Drive no longer has
    await picks([{ id: '1Gone_x', name: 'Old.docx', mimeType: MIME.docx }]);
    const count = (await titles()).length;
    await fromB.click();
    await until(async () => (await said()) === "Glaze can't reach this file in Google Drive.", 'unreachable said');
    ok((await titles()).length === count, 'a file Drive no longer has: said in the status line, no document made');

    // ---- save: the ⋯ menu's Save to Google Drive
    const save = async (key, as) => {
      await home.click(`.gd-card[data-key="${key}"] .gd-more`);
      await home.locator('.gd-menu [role="menuitem"]', { hasText: 'Save to Google Drive' }).click();
      const dlg = home.locator('dialog.gd-drive');
      await until(() => dlg.isVisible(), 'the choice');
      if (as === 'doc') await home.screenshot({ path: path.join(out, 'drive-3-choice.png') });
      const first = await home.evaluate(() => document.activeElement?.dataset.as);
      const m = log.drive.length;
      await home.evaluate(() => { document.getElementById('gd-said').textContent = ''; });
      await dlg.locator(`button[data-as="${as}"]`).click();
      await until(async () => (await said()) === 'Saved to Google Drive.', `saved as ${as}`);
      const rec = await home.evaluate(async (k) => (await chrome.storage.local.get(`writerPaper:${k}`))[`writerPaper:${k}`], key);
      return { first, asked: log.drive.slice(m), drive: rec.drive, rec };
    };
    const edited = await home.evaluate(async (k) => (await chrome.storage.local.get(`writerPaper:${k}`))[`writerPaper:${k}`].updated, river);
    let r = await save(river, 'file');
    ok(r.first === 'file', 'a paper offers a Word file first');
    ok(r.asked.length === 1 && r.asked[0].method === 'POST' && r.asked[0].path === '/upload/drive/v3/files' && r.asked[0].query.uploadType === 'multipart' && r.asked[0].query.fields === 'id,name,mimeType',
      `save new: one multipart create (${JSON.stringify(r.asked.map((x) => [x.method, x.path]))})`);
    ok(r.asked[0].upload?.meta.mimeType === MIME.docx && /\.docx$/.test(r.asked[0].upload.meta.name) && !('parents' in r.asked[0].upload.meta) && r.asked[0].upload.type === MIME.docx && r.asked[0].upload.zip,
      `as the .docx, in My Drive (${JSON.stringify(r.asked[0].upload?.meta)})`);
    ok(r.asked[0].auth === `Bearer ${TOKEN}` && !r.asked[0].cookie, 'with the token and no cookie');
    const first = r.drive?.id;
    ok(r.drive?.as === 'file' && /^1NeW_/.test(first), `the record remembers the Drive file (${JSON.stringify(r.drive)})`);
    ok(r.rec.updated === edited, 'and its Last edited stays as it was');
    await home.screenshot({ path: path.join(out, 'drive-3-saved-file.png') });

    r = await save(river, 'file');
    ok(r.asked.length === 2 && r.asked[0].method === 'GET' && r.asked[0].path === `/drive/v3/files/${first}` && r.asked[1].method === 'PATCH' && r.asked[1].path === `/upload/drive/v3/files/${first}`,
      `save again: confirmed there, then updated in place (${JSON.stringify(r.asked.map((x) => [x.method, x.path]))})`);
    ok(JSON.stringify(r.asked[1].upload?.meta) === '{}' && r.drive.id === first && drive.size === 3, 'the content only, no copy made');

    r = await save(river, 'doc');
    ok(r.asked.length === 1 && r.asked[0].method === 'POST' && r.asked[0].upload?.meta.mimeType === MIME.doc && r.asked[0].upload.type === MIME.docx && !/\.docx$/.test(r.asked[0].upload.meta.name),
      `as a Google Doc: created with Docs' type from the .docx (${JSON.stringify(r.asked[0]?.upload?.meta)})`);
    const doc = r.drive.id;
    ok(r.drive.as === 'doc' && doc !== first, 'and remembered in its place');

    // ---- save: the remembered file is gone from Drive
    drive.delete(doc);
    r = await save(river, 'doc');
    ok(r.first === 'doc', 'the choice made last time is offered first');
    ok(r.asked.length === 2 && r.asked[0].method === 'GET' && r.asked[1].method === 'POST' && r.drive.id !== doc && r.drive.as === 'doc', `an unreachable file: a new one, remembered (${JSON.stringify(r.asked.map((x) => [x.method, x.path]))})`);
    ok(!r.rec.trashed && r.rec.doc, 'the document itself is as it was');
    await noToken('after saving');

    // ---- the paper's ⋯ menu (writer-paper.js): From Google Drive beside Import
    const paper = await ctx.newPage();
    paper.on('pageerror', (e) => errors.push(`paper: ${e}`));
    await paper.goto(`chrome-extension://${id}/papers.html?paper=${encodeURIComponent(river)}`);
    const versions = paper.locator('button', { hasText: /^Versions$/ });
    await until(() => versions.isVisible(), 'the paper');
    await until(async () => { await versions.click(); const items = await paper.locator('[role="menuitem"]').allTextContents(); if (!items.includes('From Google Drive')) await paper.keyboard.press('Escape'); return items.includes('From Google Drive') && items; }, 'the paper\'s menu offers it')
      .then((items) => ok(items.indexOf('From Google Drive') === items.indexOf('Import .docx…') + 1, `the paper's menu: From Google Drive after Import (${items.join('|')})`));
    await paper.screenshot({ path: path.join(out, 'drive-4-paper-menu.png') });
    await paper.close();

    // ---- Disconnect: the entries go
    ok(await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'disconnect' })).then((x) => x.ok), 'Disconnect');
    await until(async () => await fromB.count() === 0, 'From Google Drive gone');
    await home.click(`.gd-card[data-key="${river}"] .gd-more`);
    ok(!(await home.locator('.gd-menu [role="menuitem"]').allTextContents()).includes('Save to Google Drive'), 'disconnected: neither entry shows');
    await home.keyboard.press('Escape');

    ok(log.drive.every((x) => !x.cookie), 'no Drive request carried a cookie');
    ok(log.other.length === 0, `no other address asked (${log.other.join(' ')})`);
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`served by: ${[...new Set(log.drive.map((x) => x.via))].join('+')}`);
    console.log(`${checks} checks passed; screenshots in ${out}`);
  } catch (e) {
    console.error(e.stack || String(e));
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    await new Promise((r) => (server ? server.close(r) : r()));
    fs.rmSync(out.startsWith(`${tmp}${path.sep}`) ? path.join(tmp, 'profile') : tmp, { recursive: true, force: true });
  }
})();
