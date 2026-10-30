// The submit sheet's From Google Drive (writer/frame/writer-submit.js) in the real unpacked extension, Drive's switch on in a staged copy
// (as tools/dev/dev-drive.sh turns it on), on the synthetic Ultra attempt (test/fixtures/ultra-writer-attempt.html with
// checks/mocks/ultra-attempt-harness.js, as checks/writer/writer-submit-check.js runs it). Sign-in is Chrome's getAuthToken stood in
// for, the Picker the worker's pick stood in for with the files it would hand back, and Drive v3 a local HTTPS server the
// googleapis hosts resolve to (test/fixtures/drive/v3.js's shapes); every other host is refused.
//   Connected: From Google Drive on the sheet. Two Drive files (a PDF by alt=media, a Google Doc exported as .docx) listed
//   beside the paper, read through the worker, Submit never pressed for the student; the student's Submit sends the paper
//   and both, their bytes as Drive gave them. Any type as it is (a PNG) and a .docx over 15 MB, under Blackboard's 50 MB,
//   sent with their bytes. A file over 50 MB and a file Drive no longer has: each named, neither listed, nothing sent.
//   Cancel while Drive's answer stalls mid-file: the sheet closes and the worker drops the request at once.
//   node checks/writer/drive-submit-check.js [evidence directory]   (glaze-remote -o <dir> -- node checks/writer/drive-submit-check.js /out)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '../../extension'));
const FX = require('../../test/fixtures/writer-paper-fixtures.js');
const { MIME, FILES, ERRORS } = require('../../test/fixtures/drive/v3.js');
const HARNESS = require('../mocks/ultra-attempt-harness.js');
const { tap } = require('../mocks/frame-tap.js');
const CONFIG = require('../../extension/background/google-config.js');

const site = 'https://bb.school.test', ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const TOKEN = 'ya29.check-drive-submit-token';
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../../test/fixtures', f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-drive-submit-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [];
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks.push(label); console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(100); } };
const quiet = async (fn, label, ms = 800) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) throw new Error(`${label}: it happened`); await pause(80); } };
const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');

// Drive as the stand-in holds it: id → { meta, bytes, stall (its first 64 KB, then nothing) }.
const drive = new Map();
const log = { drive: [], dropped: [], other: [] };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, HEAD, POST, PATCH' };
const reply = (status, body) => ({ status, headers: { ...CORS, 'content-type': 'application/json; charset=UTF-8' }, body: Buffer.from(JSON.stringify(body)) });
const answer = (req, res, body) => {
  const u = new URL(`https://${req.headers.host.replace(/:\d+$/, '')}${req.url}`);
  const send = (a) => { res.writeHead(a.status, a.headers); res.end(a.body); };
  if (req.method === 'OPTIONS') return send({ status: 204, headers: CORS, body: Buffer.alloc(0) });
  if (u.href === 'https://openidconnect.googleapis.com/v1/userinfo') return send(reply(200, { sub: '42', email: 'student@school.edu', email_verified: true }));
  if (u.href === 'https://oauth2.googleapis.com/revoke') return send({ status: 200, headers: CORS, body: Buffer.alloc(0) });
  if (u.origin !== 'https://www.googleapis.com') { log.other.push(u.href); return req.socket.destroy(); }
  const entry = { method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization, cookie: req.headers.cookie || null };
  log.drive.push(entry);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(reply(401, ERRORS[401]));
  const m = /^\/drive\/v3\/files\/([\w-]+)(\/export)?$/.exec(u.pathname);
  if (!m || req.method !== 'GET') return send(reply(400, ERRORS[404]));
  const f = drive.get(m[1]);
  if (!f) return send(reply(404, ERRORS[404]));
  if (!m[2] && u.searchParams.get('alt') !== 'media') {
    const keep = ['id', 'name', 'mimeType', 'size', 'trashed', 'capabilities'];
    return send(reply(200, Object.fromEntries(keep.filter((k) => f.meta[k] !== undefined).map((k) => [k, f.meta[k]]))));
  }
  const type = m[2] ? u.searchParams.get('mimeType') : f.meta.mimeType;
  if (!f.stall) return send({ status: 200, headers: { ...CORS, 'content-type': type, 'content-length': String(f.bytes.length) }, body: f.bytes });
  // A stalled answer: the first 64 KB, then nothing until the other side goes; that request's close is recorded.
  res.writeHead(200, { ...CORS, 'content-type': type, 'content-length': String(f.bytes.length) });
  const at = 64 << 10;
  res.write(f.bytes.subarray(0, at));
  res.on('close', () => log.dropped.push({ id: m[1], at, when: Date.now() }));
};

(async () => {
  let ctx, server, ext;
  try {
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (sha(quill) !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');
    ext = require('../../tools/dev/check-env.js').staged(root, [`${site}/*`]);
    {
      const file = path.join(ext, 'manifest.json'), mf = JSON.parse(fs.readFileSync(file, 'utf8'));
      mf.permissions = [...mf.permissions, 'identity'];
      mf.optional_permissions = mf.optional_permissions.filter((p) => p !== 'identity');
      mf.oauth2 = { client_id: CONFIG.chrome, scopes: CONFIG.scopes };
      fs.writeFileSync(file, JSON.stringify(mf, null, 2));
      // Drive's build-time switch on in this copy only (the staged file is a link: replaced, not edited).
      const g = path.join(ext, 'background/google.js'), src = fs.readFileSync(g, 'utf8');
      if (!src.includes('\n  const ON = false;\n')) throw new Error('background/google.js: no ON switch');
      fs.rmSync(g);
      fs.writeFileSync(g, src.replace('\n  const ON = false;\n', '\n  const ON = true;\n'));
    }
    const { execFileSync } = require('node:child_process');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem'), '-days', '1', '-subj', '/CN=glaze-drive-submit-check'], { stdio: 'ignore' });
    server = require('node:https').createServer({ key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) }, (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => answer(req, res, Buffer.concat(chunks)));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const HOSTS = ['www.googleapis.com', 'openidconnect.googleapis.com', 'oauth2.googleapis.com'];
    const rules = [...HOSTS.map((h) => `MAP ${h} 127.0.0.1:${server.address().port}`), 'MAP * ~NOTFOUND'].join(', ');
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=${rules}`, '--ignore-certificate-errors', '--disable-background-networking'] });
    env.noFirstRun(ctx); ctx.setDefaultTimeout(15000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json'));
    const members = JSON.parse(fixture('ultra-memberships.json'));
    members.results = members.results.map((x) => (x.courseId === '_101_1' ? { ...x, course: { ...x.course, name: FX.context.course, displayName: FX.context.course } } : x));
    await ctx.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:' || HOSTS.includes(u.hostname)) return r.continue();
      if (req.method() !== 'GET' || u.origin !== site) { log.other.push(u.href); return r.abort(); }
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && u.pathname === ATTEMPT) return r.fulfill({ contentType: 'text/html', body: fixture('ultra-writer-attempt.html').replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' };
      else if (/\/users\/_900_1\/memberships$/.test(u.pathname)) data = members;
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker'), id = new URL(sw.url()).host;
    const settings = await ctx.newPage();
    settings.on('pageerror', (e) => errors.push(`settings: ${e}`));
    await settings.goto(`chrome-extension://${id}/options.html`);
    await env.installed(settings);
    const G = require(path.join(root, 'content/defaults.js'));
    const prefs = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, writerUploads: true, drafts: true }, writer: { full: true } });
    await sw.evaluate(async ({ prefs, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(prefs); await chrome.storage.local.set({ ultra: [site] }); }, { prefs, site });
    const popup = await ctx.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(popup); await popup.close();
    await sw.evaluate((t) => {
      chrome.identity.getAuthToken = async (d) => ({ token: t, grantedScopes: d.scopes });
      chrome.identity.removeCachedAuthToken = async () => {};
      chrome.identity.clearAllCachedAuthTokens = async () => {};
    }, TOKEN);
    const connected = await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'connect' }));
    ok(connected?.ok && connected.email === 'student@school.edu', `Drive connects (the check's account) (${JSON.stringify(connected)})`);
    // The Picker's answer, as background/google.js pick hands it back.
    const picks = (files) => sw.evaluate((f) => { openGoogle().pick = async () => ({ ok: true, files: f }); }, files);

    // Drive's files: a PDF (its own bytes), a Google Doc (its export: a real .docx), a PNG, a 20 MB .docx, one over 50 MB, one
    // whose answer stalls.
    const pdf = fs.readFileSync(path.join(__dirname, '../../test/fixtures/import/syllabus.pdf'));
    const watch = (p, tag) => {
      p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
    };
    const openAttempt = async () => {
      await sw.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:') || k.startsWith('writerVersions:'))); });
      const p = await ctx.newPage();
      watch(p, 'attempt');
      await p.goto(`${site}${ATTEMPT}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown', 30000);
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && !document.querySelector('.gp-submit').disabled), 'paper loaded and Submit… on', 30000);
      await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0), 'pages drawn', 30000);
      await tap(fr, '.gp-submit');
      await until(() => fr.evaluate(() => !!document.querySelector('.gs-layer[data-open]')), 'sheet open');
      return { p, fr };
    };
    const rows = (fr) => fr.evaluate(() => [...document.querySelectorAll('.gs-att')].map((r) => ({ name: r.querySelector('.gs-name').textContent, size: r.querySelector('small').textContent })));
    const err = (fr) => fr.evaluate(() => document.querySelector('.gs-err').textContent);
    const uploads = (p) => p.evaluate(() => __uploads.map(({ name, type, size, bytes }) => ({ name, type, size, bytes })));
    const clicks = (p) => p.evaluate(() => __clicks.length);
    // Ultra's uploads hashed in the page: a 20 MB file's bytes stay there.
    const hashed = (p) => p.evaluate(() => Promise.all(__uploads.map(async ({ name, type, size, bytes }) => ({ name, type, size,
      sha: [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map((b) => b.toString(16).padStart(2, '0')).join('') }))));

    // ---- two Drive files beside the paper
    let { p, fr } = await openAttempt();
    ok(await until(() => fr.evaluate(() => document.querySelector('.gs-drive')?.textContent === 'From Google Drive' && !document.querySelector('.gs-drive').disabled)), 'connected: From Google Drive on the sheet');
    const docx = Buffer.from(await fr.evaluate(async () => {
      await GZ_WRITER_PAPER.need(['writer/writer-styles.js', 'core/zip.js', 'core/doctext.js', 'writer/writer-docx.js', 'writer/writer-objects-docx.js']);
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Exported from Google Docs.' }] }] };
      return Array.from(GZ_WRITER_DOCX.exportDocx(doc, { format: GZ_WRITER_STYLES.FORMATS.plain, surname: '', title: '' }).bytes);
    }));
    drive.set('1PdF_x', { meta: { ...FILES.pdf, name: 'Field trip.pdf', size: String(pdf.length) }, bytes: pdf });
    drive.set(FILES.doc.id, { meta: FILES.doc, bytes: docx });
    await picks([{ id: '1PdF_x', name: 'Field trip.pdf', mimeType: MIME.pdf }, { id: FILES.doc.id, name: FILES.doc.name, mimeType: MIME.doc }]);
    let n = log.drive.length;
    await tap(fr, '.gs-drive');
    const listed = await until(async () => { const r = await rows(fr); return r.length === 2 && r.every((x) => / KB$/.test(x.size)) && await fr.evaluate(() => !document.querySelector('.gs-primary').disabled) && r; }, 'two Drive files listed', 30000);
    const asked = log.drive.slice(n);
    ok(asked.length === 4 && asked[1].query.alt === 'media' && asked[3].path === `/drive/v3/files/${FILES.doc.id}/export` && asked[3].query.mimeType === MIME.docx,
      `read through the worker: the PDF by alt=media, the Google Doc exported as .docx (${JSON.stringify(asked.map((x) => [x.path, x.query.alt || x.query.mimeType || '']))})`);
    ok(asked.every((x) => x.auth === `Bearer ${TOKEN}` && !x.cookie), 'each with the token, no cookie');
    ok(/\.pdf$/.test(listed[0].name) && /\.docx$/.test(listed[1].name), `listed as Lastname_Title with their sizes (${listed.map((x) => `${x.name} ${x.size}`).join('; ')})`);
    await quiet(async () => await clicks(p) > 0 || (await uploads(p)).length > 0, 'Ultra heard before the student\'s Submit');
    ok(true, 'nothing sent to Ultra and Submit not pressed while the files came');
    await p.screenshot({ path: path.join(out, 'drive-submit-1-listed.png') });
    await fr.fill('#gs-note', 'Lab and trip notes.');
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'submitted', 60000 * 3);
    const up = await uploads(p);
    ok(up.length === 3 && /\.docx$/.test(up[0].name) && up[1].name === listed[0].name && up[2].name === listed[1].name && await clicks(p) === 1,
      `the student's Submit sends the paper, then both Drive files, Ultra's Submit once (${up.map((u) => `${u.name} ${u.type} ${u.size}`).join('; ')})`);
    ok(up[1].type === MIME.pdf && sha(up[1].bytes) === sha(pdf) && up[2].type === MIME.docx && sha(up[2].bytes) === sha(docx), 'each with its type and the very bytes Drive gave');
    ok(await p.evaluate((names) => __text().includes(`Attached: ${names.join(', ')}`), listed.map((x) => x.name)), 'the note names them');
    await p.close();

    // ---- any type as it is, and a .docx over 15 MB (Open from Drive's cap for a Word file) under Blackboard's 50 MB
    ({ p, fr } = await openAttempt());
    const png = fs.readFileSync(path.join(__dirname, '../../test/fixtures/import/syllabus.png')), long = crypto.randomBytes(20e6);
    drive.set('1PnG_x', { meta: { ...FILES.pdf, id: '1PnG_x', name: 'Timetable.png', mimeType: 'image/png', size: String(png.length) }, bytes: png });
    drive.set('1LoNg_d', { meta: { ...FILES.docx, id: '1LoNg_d', name: 'Long draft.docx', size: String(long.length) }, bytes: long });
    await picks([{ id: '1PnG_x', name: 'Timetable.png', mimeType: 'image/png' }, { id: '1LoNg_d', name: 'Long draft.docx', mimeType: MIME.docx }]);
    await tap(fr, '.gs-drive');
    const anyType = await until(async () => { const r = await rows(fr); return r.length === 2 && r.every((x) => / KB$/.test(x.size)) && await fr.evaluate(() => !document.querySelector('.gs-primary').disabled) && r; }, 'the PNG and the 20 MB .docx listed', 60000);
    ok(await err(fr) === '' && /\.png$/.test(anyType[0].name) && /\.docx$/.test(anyType[1].name), `any type and a 20 MB .docx listed, nothing refused (${anyType.map((x) => `${x.name} ${x.size}`).join('; ')})`);
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'submitted with the PNG and the 20 MB file', 60000 * 4);
    const big = await hashed(p);
    ok(big.length === 3 && big[1].type === 'image/png' && big[1].sha === sha(png) && big[2].type === MIME.docx && big[2].size === 20e6 && big[2].sha === sha(long) && await clicks(p) === 1,
      `the paper, the PNG and the 20 MB .docx reach Ultra's upload with their types and very bytes, Submit once (${big.map((u) => `${u.name} ${u.type} ${u.size}`).join('; ')})`);
    await p.close();

    // ---- over 50 MB, and gone from Drive
    ({ p, fr } = await openAttempt());
    drive.set('1BiG_pdf', { meta: { ...FILES.pdf, id: '1BiG_pdf', name: 'Scan.pdf', size: String(60e6) }, bytes: Buffer.alloc(1) });
    await picks([{ id: '1BiG_pdf', name: 'Scan.pdf', mimeType: MIME.pdf }, { id: '1GoNe_z', name: 'Old.docx', mimeType: MIME.docx }]);
    n = log.drive.length;
    await tap(fr, '.gs-drive');
    const said = await until(async () => { const e = await err(fr); return e.includes('Old.docx') && e; }, 'both refusals');
    ok(said === "Scan.pdf is larger than 50 MB. Old.docx: Glaze can't reach this file in Google Drive.", `each named with the sheet's words ("${said}")`);
    ok(log.drive.slice(n).every((x) => x.query.alt !== 'media'), 'the large file refused by its size, before its bytes');
    ok((await rows(fr)).length === 0 && await fr.evaluate(() => !document.querySelector('.gs-primary').disabled), 'neither listed');
    await quiet(async () => await clicks(p) > 0 || (await uploads(p)).length > 0, 'Ultra heard after a refusal');
    ok(true, 'nothing sent and Submit not pressed');
    await p.screenshot({ path: path.join(out, 'drive-submit-2-refused.png') });

    // ---- Cancel while Drive's answer stalls mid-file
    drive.set('1SlOw_pdf', { meta: { ...FILES.pdf, id: '1SlOw_pdf', name: 'Slow.pdf', size: String(6e6) }, bytes: crypto.randomBytes(6e6), stall: true });
    await picks([{ id: '1SlOw_pdf', name: 'Slow.pdf', mimeType: MIME.pdf }]);
    await tap(fr, '.gs-drive');
    await until(async () => (await rows(fr))[0]?.size === 'Reading…' && log.drive.some((x) => x.path === '/drive/v3/files/1SlOw_pdf' && x.query.alt === 'media'), 'stalled, Reading… in its row');
    ok(await fr.evaluate(() => document.querySelector('.gs-primary').disabled), 'Submit waits while it reads');
    await p.screenshot({ path: path.join(out, 'drive-submit-3-reading.png') });
    ok(!log.dropped.some((x) => x.id === '1SlOw_pdf'), 'the stalled request is still open before Cancel');
    const cancelled = Date.now();
    await tap(fr, '.gs-foot .gs-btn:not(.gs-primary)');
    ok(await fr.evaluate(() => !document.querySelector('.gs-layer')), 'Cancel closes the sheet');
    const dropped = await until(async () => log.dropped.find((x) => x.id === '1SlOw_pdf'), 'the worker dropped the stalled request', 10000);
    ok(dropped.when - cancelled < 5000, `the worker's stalled request to Drive ended ${dropped.when - cancelled} ms after Cancel, no more bytes needed`);
    await quiet(async () => await clicks(p) > 0 || (await uploads(p)).length > 0, 'Ultra heard after Cancel');
    ok(true, 'nothing sent after Cancel');
    await p.close();

    ok(log.other.length === 0, `no other address asked (${log.other.join(' ')})`);
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`${checks.length} checks passed; screenshots in ${out}`);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: true, checks, drive: log.drive, dropped: log.dropped }, null, 2) + '\n');
  } catch (e) {
    console.error(e.stack || String(e));
    fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n${JSON.stringify({ checks, errors, log }, null, 2)}\n`);
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    server?.closeAllConnections?.();
    await new Promise((r) => (server ? server.close(r) : r()));
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    fs.rmSync(out.startsWith(`${tmp}${path.sep}`) ? path.join(tmp, 'profile') : tmp, { recursive: true, force: true });
  }
})();
