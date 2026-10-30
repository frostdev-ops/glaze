// Sync to Google Drive (extension/documents/drive-sync.js, extension/background/drive-store.js) in the real extension, headless: a staged copy with Drive's switch on (as
// tools/dev/dev-drive.sh turns it on) and its real worker, against a stand-in Drive that keeps its state across requests
// (test/helpers/drive-standin.cjs, Drive v3's shapes from test/fixtures/drive/v3.js, not seen live), served through
// Playwright's route() and, for what route() can't see, a local HTTPS server www.googleapis.com resolves to; every other
// host is refused. Sign-in is Chrome's getAuthToken, stood in for.
//   Settings: no Sync to Google Drive row until Drive connects; connecting turns it on: a Glaze folder with each document's
//   file (the worker's own .docx and .xlsx, a PDF's bytes) and its JSON copy, a file a record for Settings and the rest in
//   Glaze/Data (another device's dictionary joined with this one's), a snapshot zip in Glaze/Backups; the line says when it
//   last synced. A Settings change goes up 5 s after.
//   Another device's change comes in when Documents opens; a document trashed in Glaze goes to Drive's trash 5 s after;
//   one edited on both sides keeps Drive's as a version; Off sends nothing more. No cookie, no token in storage, nothing
//   deleted, no other host.
//   NODE_PATH=<installed playwright> nice node checks/documents/drive-sync-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const { standin } = require('../../test/helpers/drive-standin.cjs');
const SD = require('../../extension/documents/sheets/sheet-data.js');
const M = require('../../extension/documents/sheets/sheet-model.js');
const { canon } = require('../../extension/background/drive-store.js');

const CONFIG = require('../../extension/background/google-config.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '../../extension'), []);
{
  const file = path.join(ext, 'manifest.json'), m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.permissions = [...m.permissions, 'identity'];
  m.optional_permissions = m.optional_permissions.filter((p) => p !== 'identity');
  m.oauth2 = { client_id: CONFIG.chrome, scopes: CONFIG.scopes };
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  const g = path.join(ext, 'background/google.js'), src = fs.readFileSync(g, 'utf8');
  if (!src.includes('\n  const ON = false;\n')) throw new Error('background/google.js: no ON switch');
  fs.rmSync(g);
  fs.writeFileSync(g, src.replace('\n  const ON = false;\n', '\n  const ON = true;\n'));
}
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const TOKEN = 'ya29.check-drive-token';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-drive-sync-'));
const out = path.resolve(process.argv[2] || path.join(tmp, 'shots'));
fs.mkdirSync(out, { recursive: true });
let checks = 0;
const ok = (value, label) => { if (!value) throw new Error(`FAIL ${label}`); checks++; console.log(`ok   ${label}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 30000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(150); } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const drive = standin();
const other = [];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, x-upload-content-type, x-upload-content-length', 'access-control-allow-methods': 'GET, HEAD, POST, PATCH, PUT', 'access-control-expose-headers': 'location' };
const answer = ({ method, url, headers, body }, via) => {
  const u = new URL(url);
  if (method === 'OPTIONS') return { status: 204, headers: CORS, body: Buffer.alloc(0) };
  if (u.href === 'https://openidconnect.googleapis.com/v1/userinfo') return { status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ sub: '42', email: 'student@school.edu', email_verified: true })) };
  if (u.origin === 'https://www.googleapis.com') {
    const a = drive.handle({ method, url, headers, body });
    drive.log[drive.log.length - 1].via = via;
    return a && { ...a, headers: { ...CORS, ...a.headers } };
  }
  other.push(`${via} ${method} ${u.href}`);
  return null;
};
const HOSTS = ['www.googleapis.com', 'openidconnect.googleapis.com', 'oauth2.googleapis.com'];
const tag = (key) => sha(key).slice(0, 32);
const fileOf = (key, role) => [...drive.files.values()].find((f) => f.meta.appProperties.glaze === role && f.meta.appProperties.key === tag(key));

(async () => {
  let ctx, server;
  const errors = [];
  try {
    const { execFileSync } = require('node:child_process');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem'), '-days', '1', '-subj', '/CN=glaze-drive-sync-check'], { stdio: 'ignore' });
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
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', reducedMotion: 'reduce',
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
    await settings.goto(`chrome-extension://${id}/options.html#writer/papers`);
    await env.installed(settings);
    await sw.evaluate((t) => {
      chrome.identity.getAuthToken = async (d) => ({ token: t, grantedScopes: d.scopes });
      chrome.identity.removeCachedAuthToken = async () => {};
      chrome.identity.clearAllCachedAuthTokens = async () => {};
    }, TOKEN);
    const local = (k) => settings.evaluate(async (key) => (await chrome.storage.local.get(key))[key], k);
    const row = settings.locator('#gdrive-sync'), box = settings.locator('#gdrive-sync-on'), said = settings.locator('#gdrive-sync-said');
    await pause(500);
    ok(!(await row.isVisible()), 'not connected: no Sync to Google Drive');

    // Documents on this device: a paper, a spreadsheet, a PDF, each written as their pages write them.
    const paper = 'doc:00000000-0000-4000-8000-00000000c001', sheet = 'doc:00000000-0000-4000-8000-00000000c002', pdf = 'doc:00000000-0000-4000-8000-00000000c003';
    const wb = M.workbook();
    wb.sheets[0].rows.set(0, new Map([[0, { v: 'Rent' }], [1, { t: 'n', v: 400 }]]));
    const split = SD.split(wb), parts = Object.fromEntries([...split.parts].map(([n, rows]) => [n, { rows }]));
    const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
    await sw.evaluate(async ({ paper, sheet, pdf, book, parts, PDF }) => {
      const P = openPapers();
      await P.save(paper, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The river keeps what the town forgets.' }] }] }, title: 'River essay', named: true });
      await P.save(sheet, { kind: 'sheet', book, title: 'Budget', named: true, cells: 2, sheets: 1 }, { parts });
      const ref = await openDocFiles().put(new TextEncoder().encode(PDF), 'application/pdf');
      await P.save(pdf, { kind: 'pdf', file: ref, size: ref.size, pages: 1, title: 'Reading', named: true });
    }, { paper, sheet, pdf, book: split.book, parts, PDF });

    // Another device's: the Glaze folder, its Data folder and one record there, the personal dictionary.
    const glaze = drive.seed({ name: 'Glaze', mimeType: drive.FOLDER, appProperties: { glaze: 'root' } });
    const data = drive.seed({ name: 'Data', mimeType: drive.FOLDER, parents: [glaze.meta.id], appProperties: { glaze: 'data' } });
    const words = { area: 'local', key: 'writerWords', value: ['Zephyr'] };
    drive.seed({ name: 'writerWords-x.json', mimeType: 'application/json', parents: [data.meta.id], appProperties: { glaze: 'rec', cat: 'writerWords', key: sha('local\nwriterWords').slice(0, 32), sum: sha(canon(words)), at: '1000' } },
      JSON.stringify({ glaze: 'record', v: 1, cat: 'writerWords', at: 1000, ...words }));
    const seeded = drive.log.length;
    await sw.evaluate(() => chrome.storage.local.set({ writerWords: ['Local'], 'todo:https://school.instructure.com/42': { tasks: [], items: {} } }));
    ok(await settings.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:google', op: 'connect' })).then((r) => r.ok), 'Drive connects');
    await until(() => row.isVisible(), 'Sync to Google Drive shows once Drive is connected');
    ok(drive.log.length >= seeded, 'connected');

    // ---- connecting turns it on: the first upload, and the other device's restored
    await until(async () => (await box.isChecked()) && /^Last synced /.test(await said.textContent()), 'on, and Last synced said', 60000);
    const folder = glaze;
    ok([...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'root').length === 1, 'the Glaze folder another device made, found and used');
    const rec = (area, key) => [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'rec' && f.meta.appProperties.key === sha(`${area}\n${key}`).slice(0, 32));
    ok(JSON.stringify(((await local('writerWords')) || []).slice().sort()) === '["Local","Zephyr"]', 'the other device\'s dictionary joined with this one\'s');
    ok(JSON.stringify(JSON.parse(rec('local', 'writerWords').bytes.toString('utf8')).value.slice().sort()) === '["Local","Zephyr"]', 'and the joined one goes up');
    ok(rec('local', 'todo:https://school.instructure.com/42')?.meta.parents[0] === data.meta.id, 'tasks: a record in Glaze/Data');
    const syncKeys = await settings.evaluate(async () => Object.keys(await chrome.storage.sync.get(null)));
    ok(syncKeys.length > 0 && syncKeys.every((k) => rec('sync', k)), `Settings, key by key (${syncKeys.filter((k) => !rec('sync', k)).join(', ') || syncKeys.length})`);
    ok(!rec('local', 'google') && !rec('local', 'driveSync'), 'Drive\'s own sign-in record and sync state stay here');
    const snap = [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'snapshot');
    const backups = [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'backups');
    ok(snap && backups?.meta.parents[0] === glaze.meta.id && snap.meta.parents[0] === backups.meta.id && snap.bytes.subarray(0, 2).toString('latin1') === 'PK' && /^glaze-backup-\d{4}-\d\d-\d\d\.zip$/.test(snap.meta.name),
      `a snapshot zip in Glaze/Backups (${snap?.meta.name})`);
    for (const [key, name, zip] of [[paper, 'RiverEssay.docx', true], [sheet, 'Budget.xlsx', true], [pdf, 'Reading.pdf', false]]) {
      const f = fileOf(key, 'file'), j = fileOf(key, 'doc');
      ok(f && f.meta.parents[0] === folder.meta.id && f.meta.name === name, `${name}: its file in the folder (${f?.meta.name})`);
      ok(zip ? f.bytes.subarray(0, 2).toString('latin1') === 'PK' : f.bytes.toString('latin1') === PDF, `${name}: ${zip ? 'a real Office file the worker built' : 'the PDF\'s own bytes'}`);
      const body = JSON.parse(j.bytes.toString('utf8'));
      ok(j.meta.parents[0] === folder.meta.id && body.glaze === 'document' && body.key === key && body.file === f.meta.id, `${name}: its JSON copy`);
    }
    await row.screenshot({ path: path.join(out, 'sync-2-on.png') });
    await settings.screenshot({ path: path.join(out, 'sync-2-settings.png') });

    // ---- another device's change, heard when Documents opens
    const side = fileOf(paper, 'doc'), copy = JSON.parse(side.bytes.toString('utf8'));
    const edited = { ...copy, record: { ...copy.record, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Written on the other laptop.' }] }] } } };
    drive.edit(side.meta.id, Buffer.from(JSON.stringify(edited)));
    side.meta.appProperties.sum = 'c'.repeat(64);
    const home = await ctx.newPage();
    home.on('pageerror', (e) => errors.push(`home: ${e}`));
    await home.goto(`chrome-extension://${id}/papers.html`);
    await until(async () => JSON.stringify((await local(`writerPaper:${paper}`))?.doc).includes('other laptop'), 'the other device\'s edit taken');

    // ---- both sides: this device's stays, Drive's a version (the push 5 s after the save finds Drive's moved on)
    const side2 = fileOf(paper, 'doc'), c2 = JSON.parse(side2.bytes.toString('utf8'));
    drive.edit(side2.meta.id, Buffer.from(JSON.stringify({ ...c2, record: { ...c2.record, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Drive side.' }] }] } } })));
    side2.meta.appProperties.sum = 'd'.repeat(64);
    await sw.evaluate(async (k) => { await openPapers().save(k, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This side.' }] }] } }); }, paper);
    await until(async () => (await local(`writerVersions:${paper}`) || []).some((v) => v.reason === 'conflict' && JSON.stringify(v.doc).includes('Drive side.')), 'Drive\'s side kept as a version', 30000);
    ok(JSON.stringify((await local(`writerPaper:${paper}`)).doc).includes('This side.'), 'this device\'s stays current');
    await until(async () => fileOf(paper, 'doc').bytes.toString('utf8').includes('This side.'), 'and goes up');

    // ---- a Settings change goes up once saving pauses
    await sw.evaluate(() => chrome.storage.sync.set({ popup: { anim: 'fade' } }));
    await until(async () => JSON.parse(rec('sync', 'popup')?.bytes.toString('utf8') || '{}').value?.anim === 'fade', 'the Settings change in Drive', 20000);

    // ---- Trash in Glaze: Drive's trash, 5 s after
    await sw.evaluate((k) => openPapers().trash(k), sheet);
    await until(async () => fileOf(sheet, 'doc').meta.explicitlyTrashed && fileOf(sheet, 'file').meta.explicitlyTrashed, 'both files in Drive\'s trash', 20000);
    ok(drive.log.every((x) => x.method !== 'DELETE'), 'nothing deleted for good');

    // ---- Off: nothing more
    await box.click();
    await until(async () => (await local('driveSync'))?.on === false && (await local('driveSync'))?.off === true, 'off, and kept off');
    const n = drive.log.length;
    await sw.evaluate(async (k) => { await openPapers().save(k, { title: 'Reading, renamed' }); }, pdf);
    await pause(7000);
    ok(drive.log.length === n, 'off: a save sends nothing');

    const all = await settings.evaluate(async () => JSON.stringify(await Promise.all(['local', 'sync', 'session'].map((a) => chrome.storage[a].get(null)))));
    ok(!all.includes(TOKEN), 'no token in storage.local, sync or session');
    ok(drive.log.every((x) => !x.cookie && x.auth === `Bearer ${TOKEN}`), 'every Drive request: the token, no cookie');
    ok(other.length === 0, `no other address asked (${other.join(' ')})`);
    ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    console.log(`served by: ${[...new Set(drive.log.map((x) => x.via))].join('+')}; ${drive.log.length} Drive requests`);
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
