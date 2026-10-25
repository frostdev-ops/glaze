// Glaze's Firefox package in headless Firefox over WebDriver BiDi, with real grants: Firefox answers each permissions.request
// itself (extensions.webextOptionalPermissionPrompts off) and clicks are trusted input (input.performActions). It shows the
// button starts on the toolbar; the first-run tab opens on install; a site added there is granted, checked and taken by the
// worker; a grant finished in the worker (permissions.onAdded) with the page that asked already gone, and one nobody asked
// for; a built-in host taken back (Firefox obeys, as about:addons does) stops Glaze there without errors; Settings → Sites
// adds and removes (and hands the grant back); Download all's Allow frame counts only its own answer, and with no permissions
// API in the frame its click opens Glaze's Allow tab, whose click grants (or refuses) and closes it; embedded Settings sends a
// control that needs a grant to Settings' own tab; the gallery hands a Look to the editor; and an update from a <all_urls>
// package (v3.3.8) keeps every site. The schools are the check's own pages over https, through a local proxy with
// a throwaway certificate (Firefox can't route requests as Playwright does); every other request is refused. Any error in
// Glaze's own files (Firefox's console service and console API) fails the check.
//   FIREFOX=<Firefox.app> nice node scripts/firefox-check.mjs
// PACKAGE=<a Firefox package zip> tests that package instead of one built from this checkout; OLD_REF (default v3.3.8) is the
// <all_urls> version updated from.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import https from 'node:https';
import net from 'node:net'; import { spawn, execFileSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = require('../defaults.js');
const app = process.env.FIREFOX;
if (!app) { console.error('usage: FIREFOX=<Firefox.app> nice node scripts/firefox-check.mjs'); process.exit(2); }
const bin = app.endsWith('.app') ? path.join(app, 'Contents/MacOS/firefox') : app;
const ID = 'glaze@frostdev.io', UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', EXT = `moz-extension://${UUID}/`;
const WIDGET = 'glaze_frostdev_io-browser-action';
const BB = 'https://bb.school.edu', CANVAS = 'https://canvas.school.edu', MOODLE = 'https://moodle.school.edu', LMS2 = 'https://lms.school.edu';
const WWW = 'https://www.school.edu', INST = 'https://school.instructure.com', FILES = 'files.cdn-a.test', GALLERY = 'https://frostdev.io';
const HOSTS = [BB, CANVAS, MOODLE, LMS2, WWW, INST, GALLERY].map((o) => new URL(o).hostname).concat(FILES);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-firefox-check-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const failed = [];
let checks = 0;
const ok = (value, label) => { if (value) { checks++; console.log(`ok   ${label}`); } else { failed.push(label); console.log(`FAIL ${label}`); } };
const until = async (fn, label, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${label}`); await pause(150); } };
const fixture = (f) => fs.readFileSync(path.join(root, 'test/fixtures', f), 'utf8');

// ---- The packages ---------------------------------------------------------------------------------------------------
const unpack = (zip, name) => { const dir = path.join(tmp, name); fs.mkdirSync(dir); execFileSync('unzip', ['-q', zip, '-d', dir]); return dir; };
const pack = (cwd) => {
  const dist = fs.mkdtempSync(path.join(tmp, 'dist-'));
  const { ZIP, ZIPOPT, ...env } = process.env; // zip reads both as its own options
  execFileSync('sh', ['scripts/package-firefox.sh', '--development'], { cwd, env: { ...env, DIST: dist }, stdio: 'pipe' });
  return path.join(dist, fs.readdirSync(dist).find((f) => f.endsWith('-firefox.zip')));
};
const OLD_REF = process.env.OLD_REF || 'v3.3.8';
let fresh, old;
const packages = () => {
  fresh = unpack(process.env.PACKAGE ? path.resolve(process.env.PACKAGE) : pack(root), 'glaze');
  const oldSrc = path.join(tmp, 'old-src');
  fs.mkdirSync(oldSrc);
  execFileSync('sh', ['-c', `git -C "${root}" archive "${OLD_REF}" | tar -x -C "${oldSrc}"`]);
  old = unpack(pack(oldSrc), 'glaze-old');
  fs.rmSync(oldSrc, { recursive: true, force: true });
  // The old package as an older version, so the one under test is its update whatever its own version.
  const f = path.join(old, 'manifest.json'), m = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!m.host_permissions?.includes('<all_urls>')) throw new Error(`${OLD_REF} doesn't hold <all_urls>`);
  m.version = '3.3.7';
  fs.writeFileSync(f, JSON.stringify(m, null, 2));
};

// ---- The schools ----------------------------------------------------------------------------------------------------
const MODULES = fixture('canvas-modules.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
  .replace(/class="context_module_item (?!student-view attachment)/g, 'class="context_module_item attachment ');
const FILE = { id: 9, name: 'notes.pdf', url: `https://${FILES}/9/notes.pdf?sig=a`, body: 'notes-pdf-bytes' };
const canvasApi = (u) => {
  const m = /^\/api\/v1\/courses\/25\/modules\/(\d+)\/items$/.exec(u.pathname);
  if (m) return m[1] === '73' ? [{ id: 973, type: 'File', content_id: String(FILE.id), title: FILE.name }] : [];
  const f = /^\/api\/v1\/files\/(\d+)(\/public_url)?$/.exec(u.pathname);
  if (f && +f[1] === FILE.id) return f[2] ? { public_url: FILE.url } : { id: FILE.id, display_name: FILE.name, filename: FILE.name, size: FILE.body.length };
  if (u.pathname === '/api/v1/users/self' || u.pathname === '/api/v1/users/self/profile') return { id: '3', name: 'Sam' };
  return [];
};
// The gallery's Looks page: one Look's "Use this Look in Glaze" (lib/gallery.js), its code made as the editor makes one.
let galleryCode = '';
const galleryPage = () => `<!doctype html><title>Looks</title><a href="/glaze/" data-glaze-use data-code="${galleryCode}" data-name="Check Frost" data-author="glaze-check" style="display:inline-block;padding:12px">Use this Look in Glaze</a>`;
const asked = [];
const site = (q, r) => {
  const u = new URL(q.url, `https://${q.headers.host}`);
  asked.push(u.href);
  const send = (status, type, body) => { r.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); r.end(body); };
  const html = (body) => send(200, 'text/html; charset=utf-8', body), json = (o, status = 200) => send(status, 'application/json', JSON.stringify(o));
  const at = u.origin, p = u.pathname;
  if (at === BB && p === '/learn/api/public/v1/system/version') return json({ learn: { major: 4001, minor: 2, patch: 0 } });
  if (at === BB && p.endsWith('/users/me')) return json({ id: '_42_1' });
  if (at === BB && p.startsWith('/learn/api/')) return json({ results: [] });
  if (at === BB && p.startsWith('/ultra')) return html(fixture('ultra-course.html'));
  if ((at === CANVAS || at === LMS2) && p === '/api/v1/users/self') return json({ status: 'unauthenticated', errors: [{ message: 'user authorization required' }] }, 401);
  if ((at === CANVAS || at === LMS2) && p.startsWith('/courses')) return html(fixture('canvas-course-home.html'));
  if (at === MOODLE && p === '/webservice/rest/server.php') return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
  if (at === MOODLE && p.startsWith('/course/')) return html(fixture('moodle-course.html'));
  if (at === WWW && p === '/') return html(`<!doctype html><title>School</title><a href="${BB}/">Blackboard</a> <a href="https://apply.school.edu/">Apply</a>`);
  if (at === INST && p.startsWith('/api/v1/')) return json(canvasApi(u));
  if (at === INST && p === '/courses/25/modules') return html(MODULES);
  if (at === INST && p.startsWith('/courses')) return html(fixture('canvas-course-home.html'));
  if (u.hostname === FILES && p === new URL(FILE.url).pathname) return send(200, 'application/pdf', FILE.body);
  if (at === GALLERY && p === '/glaze/looks/') return html(galleryPage());
  return send(404, 'text/html', '<!doctype html><title>Not found</title>');
};
let schools, proxy;
const serve = async () => {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem'), '-days', '2',
    '-subj', '/CN=glaze-firefox-check', '-addext', `subjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(',')}`], { stdio: 'pipe' });
  schools = https.createServer({ key: fs.readFileSync(path.join(tmp, 'key.pem')), cert: fs.readFileSync(path.join(tmp, 'cert.pem')) }, site);
  proxy = http.createServer((q, r) => { r.writeHead(502); r.end(); });
  proxy.on('connect', (q, sock, head) => {
    const [host, port] = q.url.split(':');
    if (!HOSTS.includes(host) || port !== '443') { sock.end('HTTP/1.1 502 Refused\r\n\r\n'); return; }
    const up = net.connect(schools.address().port, '127.0.0.1', () => { sock.write('HTTP/1.1 200 Connection Established\r\n\r\n'); up.write(head); up.pipe(sock); sock.pipe(up); });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  });
  await new Promise((r) => schools.listen(0, '127.0.0.1', r));
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
};

// ---- Firefox --------------------------------------------------------------------------------------------------------
const downloads = path.join(tmp, 'downloads');
fs.mkdirSync(downloads);
let ff = null;
const firefox = async (label, body) => {
  const profile = path.join(tmp, `profile-${label}`);
  fs.mkdirSync(profile);
  const P = proxy.address().port;
  const prefs = {
    'extensions.webextensions.uuids': JSON.stringify({ [ID]: UUID }), 'extensions.webextOptionalPermissionPrompts': false,
    'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': P, 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': P,
    'network.proxy.no_proxies_on': '', 'network.proxy.allow_hijacking_localhost': true,
    'browser.download.dir': downloads, 'browser.download.folderList': 2, 'browser.download.useDownloadDir': true, 'browser.download.always_ask_before_handling_new_types': false,
    'browser.shell.checkDefaultBrowser': false, 'app.update.disabledForTesting': true, 'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false, 'browser.startup.homepage_override.mstone': 'ignore', 'app.normandy.enabled': false,
    'messaging-system.rsexperimentloader.enabled': false, 'devtools.console.stdout.content': true, 'extensions.update.enabled': false, 'browser.safebrowsing.malware.enabled': false, 'browser.safebrowsing.phishing.enabled': false,
  };
  fs.writeFileSync(path.join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  const port = 9400 + Math.floor(Math.random() * 400);
  ff = spawn(bin, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '-remote-allow-system-access', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  ff.stdout.on('data', (d) => { log += d; }); ff.stderr.on('data', (d) => { log += d; });
  try {
    await until(async () => /WebDriver BiDi listening/.test(log), 'Firefox to listen', 30000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let n = 0;
    const wait = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = ++n;
      wait.set(id, (d) => (d.type === 'error' ? rej(new Error(`${method}: ${d.error} ${d.message}`)) : res(d.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    const b = browser(send, () => log);
    await body(b);
    ws.close();
  } finally {
    ff.kill('SIGTERM');
    await new Promise((r) => { if (ff.exitCode !== null) r(); else { ff.once('exit', r); setTimeout(r, 8000); } });
    if (ff.exitCode === null && ff.signalCode === null) ff.kill('SIGKILL');
    ff = null;
    fs.rmSync(profile, { recursive: true, force: true });
  }
};

const browser = (send, log) => {
  let seen = 0;
  const chrome = async () => (await send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts.find((c) => c.url === 'chrome://browser/content/browser.xhtml').context;
  const value = async (expression, context, sandbox) => {
    const r = await send('script.evaluate', { expression: `(async () => JSON.stringify(await (${expression})))()`, target: { context, ...(sandbox ? { sandbox } : {}) }, awaitPromise: true, resultOwnership: 'none', userActivation: false });
    if (r.type === 'exception') throw new Error(`${r.exceptionDetails.text} in ${expression.slice(0, 120)}`);
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  const tree = async () => (await send('browsingContext.getTree', {})).contexts;
  const flat = (cs) => cs.flatMap((c) => [c, ...flat(c.children || [])]);
  const b = {
    send, value, tree, log,
    find: async (prefix) => (await tree()).find((c) => c.url.startsWith(prefix))?.context,
    // A frame in the tab `top` whose address starts with `prefix`.
    frame: async (top, prefix) => flat((await tree()).filter((c) => c.context === top).flatMap((c) => c.children || [])).find((c) => c.url.startsWith(prefix))?.context,
    count: async (prefix) => (await tree()).filter((c) => c.url.startsWith(prefix)).length,
    // A tab, opened as the browser's own UI would (BiDi may not navigate to moz-extension: addresses).
    open: async (url) => {
      const before = new Set((await tree()).map((c) => c.context));
      await value(`(gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }), 1)`, await chrome());
      const c = await until(async () => (await tree()).find((x) => !before.has(x.context))?.context, `a tab for ${url}`);
      await until(() => value('document.readyState === "complete" && location.href !== "about:blank"', c), `${url} to load`);
      await send('browsingContext.activate', { context: c }).catch(() => {});
      return c;
    },
    go: (context, url) => send('browsingContext.navigate', { context, url, wait: 'complete' }),
    reload: (context) => send('browsingContext.reload', { context, wait: 'complete' }),
    close: (context) => send('browsingContext.close', { context }),
    // A trusted click in the middle of the element, in the tab's top frame or in a frame of it (`within`: [the frame's
    // context, the frame element's selector in the top frame]).
    click: (context, selector, within) => b.clickOn(context, `document.querySelector(${JSON.stringify(selector)})`, within),
    // The same for the element an expression finds (one in an open shadow root, say).
    clickOn: async (context, element, [within, frameAt] = []) => {
      await send('browsingContext.activate', { context }).catch(() => {}); // not for Glaze's own pages
      let box = await value(`(() => { const e = ${element}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`, within || context);
      if (within) {
        const f = await value(`(() => { const r = document.querySelector(${JSON.stringify(frameAt)}).getBoundingClientRect(); return [r.x, r.y]; })()`, context);
        box = [box[0] + f[0], box[1] + f[1]];
      }
      await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(box[0]), y: Math.round(box[1]) }, { type: 'pause', duration: 50 }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
      await send('input.releaseActions', { context }).catch(() => {}); // a page the click closed
    },
    hover: async (context, selector) => {
      const box = await value(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`, context);
      await send('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(box[0]), y: Math.round(box[1]) }] }] });
    },
    keys: async (context, keys) => {
      await send('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: keys.flatMap((k) => [{ type: 'keyDown', value: k }, { type: 'keyUp', value: k }]) }] });
    },
    type: (context, selector, text) => value(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`, context),
    placement: async () => value(`CustomizableUI.getPlacementOfWidget(${JSON.stringify(WIDGET)})?.area ?? null`, await chrome()),
    // In the browser's own window (its prefs, its prompts).
    inChrome: async (expression) => value(expression, await chrome()),
    install: (dir) => send('webExtension.install', { extensionData: { type: 'path', path: dir } }),
    // What Firefox printed since the last look (devtools.console.stdout.content): every console.error/warn from a page or an
    // extension page (Glaze's worker catches with console.warn), and script errors in Glaze's own files.
    errors: async () => {
      const lines = b.log().slice(seen).split('\n');
      seen = b.log().length;
      return lines.filter((l) => /^console\.(error|warn): /.test(l) || l.startsWith(`JavaScript error: ${EXT}`)).map((l) => l.replaceAll(EXT, ''));
    },
  };
  // Glaze in a school's page: its stylesheets there.
  b.sheets = (context) => value(`[...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => h.startsWith(${JSON.stringify(EXT)})).map((h) => new URL(h).pathname.slice(1))`, context);
  b.card = (context) => value(`!!document.querySelector('glaze-consent')`, context);
  return b;
};

// In one of Glaze's pages: the browser's grants, Glaze's site lists and its registrations.
// Firefox lists each content script's matches among the origins too, as their hosts: once each here.
const grants = (b, c) => b.value(`browser.permissions.getAll().then((p) => [...new Set(p.origins)].sort())`, c);
const holds = (b, c, o) => b.value(`browser.permissions.contains({ origins: [${JSON.stringify(o)}] })`, c);
const lists = (b, c) => b.value(`browser.storage.local.get(['canvas', 'moodle', 'ultra'])`, c);
const registered = (b, c) => b.value(`browser.scripting.getRegisteredContentScripts().then((s) => s.map((x) => x.id).sort())`, c);
const noErrors = async (b, label) => { const e = await b.errors(); ok(e.length === 0, `${label}: no errors${e.length ? ` (${e.join(' | ')})` : ''}`); };

const run = async () => {
  packages();
  galleryCode = await require('../lib/share.js').encode(G.GZ_SANITIZE({ preset: 'Frost', colors: { ...G.GZ_PRESETS.find(([n]) => n === 'Frost')[1] } }), {}, null);
  await require('./wait-for-browser.js')();
  await serve();
  const manifest = JSON.parse(fs.readFileSync(path.join(fresh, 'manifest.json'), 'utf8'));

  // Each browser session on its own: one that stops early still leaves the other to run.
  const session = (label, body) => firefox(label, body).catch((e) => { console.error(e.stack || String(e)); failed.push(`${label}: ${e.message || e}`); });
  // 1. A new install.
  await session('install', async (b) => {
    await b.install(fresh);
    const welcome = await until(() => b.find(`${EXT}features/welcome.html`), 'the first-run tab');
    ok(welcome, 'the first-run tab opens on install');
    await pause(1500);
    ok(await b.count(`${EXT}features/welcome.html`) === 1, 'once');
    ok(await b.placement() === 'nav-bar', `the button starts on the toolbar (${await b.placement()})`);
    ok(await b.value(`typeof browser.declarativeContent === 'undefined' && typeof browser.permissions.addHostAccessRequest === 'undefined'`, welcome), 'Firefox has neither declarativeContent nor addHostAccessRequest');
    ok(!manifest.permissions.includes('declarativeContent') && manifest.action.default_area === 'navbar', 'the package asks for no declarativeContent');
    const first = await grants(b, welcome);
    ok(JSON.stringify(first) === JSON.stringify([...manifest.host_permissions].sort()), `on install Firefox grants the required hosts only (${first.join(', ')})`);
    await noErrors(b, 'startup');

    // The first-run tab: a school's Blackboard, allowed, checked by the page and the worker, registered.
    await b.type(welcome, '#address', 'bb.school.edu');
    await until(() => b.value(`document.querySelector('#go').dataset.act === 'allow'`, welcome), 'Allow');
    await b.click(welcome, '#go');
    await until(() => b.value(`document.querySelector('.bar').dataset.state === 'done'`, welcome), 'the first screen to settle on the site');
    ok(await holds(b, welcome, `${BB}/*`), 'Allow on the first-run tab: Firefox granted the host');
    ok(asked.includes(`${BB}/learn/api/public/v1/system/version`), 'the site check ran against it');
    ok((await lists(b, welcome)).ultra?.includes(BB), 'the worker approved it as Blackboard');
    ok((await registered(b, welcome)).includes(`ultra:${BB}`), 'and registered its /ultra pages');
    ok(await b.value(`browser.storage.session.get('allow ${BB}/*').then((r) => !Object.keys(r).length)`, welcome), 'nothing left waiting for it');
    ok(await b.value(`document.querySelector('#go .label').textContent`, welcome) === 'Open', 'the button turns to Open');
    await noErrors(b, 'the first-run tab');
    const ultra = await b.open(`${BB}/ultra/courses/_101_1/outline`);
    await until(async () => (await b.sheets(ultra)).includes('theme.css'), 'Glaze on its first page');
    ok(true, `its first page gets Glaze (${(await b.sheets(ultra)).join(', ')})`);
    await pause(1000);
    ok(!await b.card(ultra), 'with no card');

    // The popup's way: the page tells the worker the site, the LMS and the tab, asks, and closes under the prompt; the worker
    // finishes from onAdded and puts Glaze into the tab.
    const canvas = await b.open(`${CANVAS}/courses/25`);
    await pause(800);
    ok((await b.sheets(canvas)).length === 0, 'a Canvas site nobody approved has no Glaze');
    // Its tab, as the popup finds it: the active one (Firefox hides the address of a tab on a host Glaze doesn't hold).
    const tabId = await b.value(`browser.tabs.query({ active: true, lastFocusedWindow: true }).then((t) => t[0].id)`, welcome);
    const popup = await b.open(`${EXT}popup.html`);
    await b.value(`(() => { const x = document.createElement('button'); x.id = 'gz-check'; x.textContent = 'Use Glaze'; x.style.cssText = 'position:fixed;left:10px;top:10px;width:120px;height:40px;z-index:9'; document.body.append(x);
      x.addEventListener('click', () => { GZ_SITE.tell({ op: 'ask', origin: '${CANVAS}', kind: 'canvas', tabId: ${tabId} }); browser.permissions.request({ origins: ['${CANVAS}/*'] }); window.close(); }); return 1; })()`, popup);
    await b.click(popup, '#gz-check');
    await until(async () => !await b.find(`${EXT}popup.html`), 'the popup to close');
    ok(true, 'the popup closed under its request');
    await until(async () => (await lists(b, welcome)).canvas?.includes(`${CANVAS}/*`), 'the worker to approve the Canvas site');
    ok(await holds(b, welcome, `${CANVAS}/*`), 'Firefox granted it; the worker approved it from onAdded');
    // The worker stores the approval before it registers the site: wait for the registration itself.
    await until(async () => (await registered(b, welcome)).includes(`${CANVAS}/*`), 'the worker to register the Canvas site');
    ok(true, 'registered it');
    await until(async () => (await b.sheets(canvas)).includes('canvas.css'), 'Glaze in the open Canvas tab');
    ok(true, 'and put Glaze into the tab that asked, without a reload');
    await b.reload(canvas);
    await until(async () => (await b.sheets(canvas)).includes('canvas.css'), 'Glaze in the Canvas tab after a reload');
    ok((await registered(b, welcome)).includes(`${CANVAS}/*`), 'it stays registered, and a fresh page gets Glaze');

    // A grant nobody asked for (as about:addons gives): the worker checks the site itself, approves it and goes into its tab.
    const moodle = await b.open(`${MOODLE}/course/view.php?id=2`);
    await pause(800);
    ok((await b.sheets(moodle)).length === 0, 'a Moodle site nobody approved has no Glaze');
    const control = await b.open(`${EXT}features/allow.html`);
    const button = (c, js) => b.value(`(() => { document.getElementById('gz-check')?.remove(); const x = document.createElement('button'); x.id = 'gz-check'; x.style.cssText = 'position:fixed;left:10px;top:10px;width:120px;height:40px'; x.textContent = 'grant'; document.body.append(x); x.addEventListener('click', () => { window.__gz = 'pending'; ${js}.then((v) => { window.__gz = v; }, (e) => { window.__gz = 'rejected: ' + e.message; }); }); return 1; })()`, c);
    await button(control, `browser.permissions.request({ origins: ['${MOODLE}/*'] })`);
    await b.click(control, '#gz-check');
    ok(await until(() => b.value('window.__gz === true', control), 'the grant') === true, 'granted with nothing asked');
    await until(async () => (await lists(b, control)).moodle?.includes(`${MOODLE}/*`), 'the worker to approve the Moodle site');
    ok(true, 'onAdded with nothing asked: the worker checked the site and approved it as Moodle');
    await until(async () => (await b.sheets(moodle)).length > 0, 'Glaze in the open Moodle tab');
    ok(true, `and Glaze went into its open tab (${(await b.sheets(moodle)).join(', ')})`);
    await noErrors(b, 'adding sites');

    // A built-in host taken back, as about:addons does (Firefox obeys; Glaze itself never removes one).
    const inst = await b.open(`${INST}/courses/25`);
    await until(async () => (await b.sheets(inst)).includes('canvas.css'), 'Glaze on the built-in Canvas host');
    ok(true, 'Glaze runs on a built-in host');
    ok(await b.value(`browser.permissions.remove({ origins: ['https://*.instructure.com/*'] })`, control) === true, 'Firefox lets the built-in host be taken back');
    ok(!await holds(b, control, `${INST}/*`), 'and no longer holds it');
    await pause(800);
    await b.reload(inst);
    await pause(1500);
    ok((await b.sheets(inst)).length === 0 && !await b.card(inst), 'Glaze stops there');
    ok(!(await registered(b, control)).some((s) => s.includes('instructure')), 'nothing registered for it');
    await noErrors(b, 'a built-in host taken back');
    await button(control, `browser.permissions.request({ origins: ['https://*.instructure.com/*'] })`);
    await b.click(control, '#gz-check');
    await until(() => b.value('window.__gz === true', control), 'the grant back');
    await b.reload(inst);
    await until(async () => (await b.sheets(inst)).includes('canvas.css'), 'Glaze back on the built-in host');
    ok(true, 'granted again, Glaze is back there');

    // Settings → Sites.
    const settings = await b.open(`${EXT}options.html#backup/sites`);
    await until(() => b.value(`!document.querySelector('#site-add').hidden && document.querySelectorAll('#site-list li').length === 3`, settings), 'Sites with three sites');
    const rows = () => b.value(`[...document.querySelectorAll('#site-list li')].map((li) => li.querySelector('.name > span').textContent + ' ' + li.querySelector('.name small').textContent)`, settings);
    ok(JSON.stringify(await rows()) === JSON.stringify(['bb.school.edu Blackboard Ultra', 'canvas.school.edu Canvas', 'moodle.school.edu Moodle']), `Settings → Sites lists the three (${(await rows()).join(', ')})`);
    await b.type(settings, '#site-address', 'lms.school.edu');
    await b.click(settings, '#site-allow');
    await until(async () => (await rows()).includes('lms.school.edu Canvas'), 'lms.school.edu listed');
    ok(await holds(b, settings, `${LMS2}/*`) && (await lists(b, settings)).canvas?.includes(`${LMS2}/*`) && (await registered(b, settings)).includes(`${LMS2}/*`), 'Add: granted, checked, approved as Canvas and registered');
    await b.type(settings, '#site-address', 'www.school.edu');
    await b.click(settings, '#site-allow');
    await until(() => b.value(`!document.querySelector('#site-note').hidden`, settings), 'the school website turned down');
    ok(await b.value(`document.querySelector('#site-error').textContent`, settings) === 'No course site at www.school.edu', 'a school\'s main website is turned down');
    ok(!await holds(b, settings, `${WWW}/*`), 'and its grant handed back (Firefox obeys)');
    await b.type(settings, '#site-address', '');
    await b.click(settings, `#site-list li:nth-child(2) button`);
    await until(async () => !(await rows()).some((r) => r.startsWith('canvas.school.edu')), 'canvas.school.edu removed');
    await until(async () => !await holds(b, settings, `${CANVAS}/*`), 'the grant handed back');
    ok(!(await lists(b, settings)).canvas?.includes(`${CANVAS}/*`) && !(await registered(b, settings)).includes(`${CANVAS}/*`), 'Remove: forgotten, unregistered and its grant handed back');
    ok(await holds(b, settings, `${INST}/*`) && await holds(b, settings, `${BB}/*`), 'every other grant stays');
    await noErrors(b, 'Settings → Sites');

    // Download all: a file server Glaze doesn't hold gets the Allow frame; only that frame's answer counts.
    await b.value(`browser.storage.sync.set(${JSON.stringify(G.GZ_SANITIZE({ preset: 'Frost', colors: { ...G.GZ_PRESETS.find(([n]) => n === 'Frost')[1] }, navbar: { on: false },
      enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), download: true } }))}).then(() => 1)`, settings);
    ok(!await holds(b, settings, `https://${FILES}/*`), `Glaze doesn't hold ${FILES}`);
    const mods = await b.open(`${INST}/courses/25/modules`);
    await until(() => b.value(`document.querySelectorAll('.gz-dl').length >= 1 && !!document.getElementById('gz-dl-73')`, mods), 'Download all buttons');
    await b.hover(mods, '#context_module_73 .ig-header');
    await b.click(mods, '#gz-dl-73');
    const frame = await until(() => b.frame(mods, `${EXT}features/allow.html`), 'the Allow frame');
    ok(await b.value('location.hash', frame) === `#${FILES}`, `the module's header shows Glaze's Allow frame for ${FILES}`);
    await until(() => b.value(`document.getElementById('allow').textContent === 'Allow ${FILES}' && !document.getElementById('allow').hidden`, frame), 'its button');
    ok(!asked.some((u) => u.includes(FILES)), 'nothing fetched from the file server before the grant');
    // The page's own word, to the content script's window and to the frame: neither counts.
    await b.value(`(postMessage({ gzAllow: '${FILES}', ok: true }, '*'), document.querySelector('.gz-dl-allow').contentWindow.postMessage({ gzAllow: '${FILES}', ok: true }, '*'), 1)`, mods);
    await pause(1500);
    ok(!!await b.frame(mods, `${EXT}features/allow.html`) && !asked.some((u) => u.includes(FILES)), 'a message the page posts, saying yes, is ignored: the frame stays and nothing is fetched');
    // Firefox gives an extension page framed in a web page only some APIs, no permissions among them: its click has the worker
    // open Glaze's Allow tab, whose click asks.
    const apis = await b.value(`Object.keys(chrome).sort().join(', ')`, frame);
    ok(!apis.split(', ').includes('permissions'), `the framed Allow page has no permissions API (${apis})`);
    const ALLOW_TAB = `${EXT}features/allow.html#${FILES}`;
    await b.click(mods, '#allow', [frame, '.gz-dl-allow']);
    const own = await until(() => b.find(ALLOW_TAB), 'the Allow tab');
    await until(() => b.value(`document.getElementById('allow').textContent === 'Allow ${FILES}' && document.activeElement?.id === 'allow'`, own), 'its button');
    ok(true, `the frame's click opens Glaze's Allow tab, its one button "Allow ${FILES}" focused`);
    ok(!await holds(b, settings, `https://${FILES}/*`) && !asked.some((u) => u.includes(FILES)), 'nothing granted or fetched before its click');
    // Read only browser-side lifecycle metadata: no debugger attached to the extension, no extension API calls while idle.
    // The byte port's 15 s ping/reply is the only continuing worker traffic. Incoming onMessage events reset the idle timer.
    await b.inChrome(`(() => { const e = WebExtensionPolicy.getByID('${ID}').extension; window.__gzIdle = { resets: [], stopped: 0, child: e.backgroundContext?.childId }; e.on('background-script-reset-idle', (_, d) => window.__gzIdle.resets.push({ reason: d.reason, at: Date.now() })); e.on('shutdown-background-script', () => window.__gzIdle.stopped++); return 1; })()`);
    await pause(65000);
    const idle = await b.inChrome(`(() => { const e = WebExtensionPolicy.getByID('${ID}').extension; return { ...window.__gzIdle, state: e.backgroundState, childNow: e.backgroundContext?.childId, timeout: Services.prefs.getIntPref('extensions.background.idle.timeout', 30000) }; })()`);
    const beats = idle.resets.filter((r) => r.reason === 'event').reduce((a, r) => { if (!a.length || r.at - a.at(-1) > 1000) a.push(r.at); return a; }, []);
    ok(idle.state === 'running' && idle.stopped === 0 && idle.child === idle.childNow && beats.length >= 4 && beats.at(-1) - beats[0] >= 45000,
      `worker-unload: 65 s, idle timeout ${idle.timeout} ms, same context ${idle.child}, ${idle.stopped} unloads; resets ${JSON.stringify(idle.resets)}`);
    await b.click(own, '#allow');
    await until(async () => !await b.find(ALLOW_TAB), 'the Allow tab to close');
    ok(true, 'its click answered, and the tab closed itself');
    const said = await until(async () => { const t = await b.value(`document.getElementById('gz-dl-73').textContent`, mods); return /^Saved 1 file|Download failed/.test(t) && t; }, 'the download to end');
    ok(said.startsWith('Saved 1 file') && await holds(b, settings, `https://${FILES}/*`), `Firefox granted ${FILES} and the download went on ("${said}")`);
    ok(asked.includes(FILE.url), 'the worker fetched the file');
    const zip = await until(async () => fs.readdirSync(downloads).find((f) => f.endsWith('.zip')), 'the saved zip');
    const bytes = fs.readFileSync(path.join(downloads, zip));
    ok(bytes.includes(Buffer.from(FILE.name)) && bytes.includes(Buffer.from(FILE.body)), `and the zip saved with ${FILE.name} (${zip}, ${bytes.length} bytes)`);
    ok(!await b.frame(mods, `${EXT}features/allow.html`), 'the frame is gone');
    await noErrors(b, 'Download all');

    // Refused: the grant taken back, Download all again; Firefox's own prompt this time, answered Cancel.
    ok(await b.value(`browser.permissions.remove({ origins: ['https://${FILES}/*'] })`, settings) === true && !await holds(b, settings, `https://${FILES}/*`), `${FILES} taken back`);
    for (const f of fs.readdirSync(downloads)) fs.rmSync(path.join(downloads, f), { force: true });
    asked.length = 0;
    await b.inChrome(`(Services.prefs.setBoolPref('extensions.webextOptionalPermissionPrompts', true), 1)`);
    await b.hover(mods, '#context_module_73 .ig-header');
    await b.click(mods, '#gz-dl-73');
    const again = await until(() => b.frame(mods, `${EXT}features/allow.html`), 'the Allow frame again');
    await until(() => b.value(`document.getElementById('allow').textContent === 'Allow ${FILES}' && !document.getElementById('allow').hidden`, again), 'its button');
    await b.click(mods, '#allow', [again, '.gz-dl-allow']);
    const own2 = await until(() => b.find(ALLOW_TAB), 'the Allow tab again');
    await until(() => b.value(`document.getElementById('allow').textContent === 'Allow ${FILES}' && !document.getElementById('allow').hidden`, own2), 'its button');
    await b.click(own2, '#allow');
    const prompt = `PopupNotifications._currentNotifications.find((n) => n.id === 'addon-webext-permissions')`;
    await until(() => b.inChrome(`!!${prompt}`), 'Firefox\'s prompt');
    await b.inChrome(`(() => { const n = ${prompt}; n.secondaryActions[0].callback(); n.remove(); return 1; })()`);
    await until(async () => !await b.find(ALLOW_TAB), 'the Allow tab to close');
    ok(true, 'Cancel in Firefox\'s prompt: the Allow tab closed itself');
    const no = await until(async () => { const t = await b.value(`document.getElementById('gz-dl-73').textContent`, mods); return /^Saved|Download failed/.test(t) && t; }, 'the download to end');
    ok(no === 'Download failed' && !await holds(b, settings, `https://${FILES}/*`) && !asked.some((u) => u.includes(FILES)), `refused: the panel says "${no}", nothing granted or fetched`);
    ok(!await b.frame(mods, `${EXT}features/allow.html`) && !fs.readdirSync(downloads).length, 'the frame is gone and nothing saved');
    await b.inChrome(`(Services.prefs.setBoolPref('extensions.webextOptionalPermissionPrompts', false), 1)`);
    await noErrors(b, 'Download all refused');

    // Embedded Settings, opened from Glaze's navigation on a course page: a control that needs a grant goes to Settings' own
    // tab (the frame has neither permissions nor tabs), and there it asks.
    await b.value(`browser.storage.sync.get('navbar').then((r) => browser.storage.sync.set({ navbar: { ...r.navbar, on: true }, navbarItems: { glaze: ['settings'] } })).then(() => 1)`, settings);
    const course = await b.open(`${INST}/courses/25`);
    const navSettings = `document.getElementById('gz-navbar')?.shadowRoot?.querySelector('[data-id="glaze:settings"]')`;
    const embed = async (hash) => {
      await until(() => b.value(`!!${navSettings}?.getClientRects().length`, course), 'Glaze settings in the bar');
      await b.clickOn(course, navSettings);
      const f = await until(() => b.frame(course, `${EXT}options.html`), 'embedded Settings');
      await until(() => b.value(`document.documentElement.hasAttribute('data-embed-ok')`, f), 'Settings to claim its frame');
      await b.value(`(location.hash = ${JSON.stringify(hash)}, 1)`, f);
      await pause(400);
      return f;
    };
    const ownSettings = (hash) => until(() => b.find(`${EXT}options.html${hash}`), `Settings' own tab at ${hash}`);
    const closed = () => until(() => b.value(`!document.getElementById('gz-settings-page')`, course), 'embedded Settings to close');
    const gradescope = `document.querySelector('input[data-key="enhance.gradescope"]').closest('label')`;
    const gsOn = () => b.value(`browser.storage.sync.get('enhance').then((r) => !!r.enhance?.gradescope)`, settings);
    let f = await embed('#study/todo');
    ok(!(await b.value(`Object.keys(chrome).sort().join(', ')`, f)).split(', ').some((k) => k === 'permissions' || k === 'tabs'), 'embedded Settings has no permissions or tabs API');
    await b.clickOn(course, gradescope, [f, '#gz-settings-page']);
    const gsTab = await ownSettings('#study/todo');
    await closed();
    ok(!await holds(b, settings, 'https://www.gradescope.com/*') && !await gsOn(), 'embedded: the Gradescope switch opens Settings\' own tab at To Do and closes; nothing granted or switched on');
    await until(() => b.value(`!!document.querySelector('input[data-key="enhance.gradescope"]')?.getClientRects().length`, gsTab), 'the switch in its own tab');
    await b.clickOn(gsTab, gradescope);
    await until(async () => await holds(b, settings, 'https://www.gradescope.com/*') && await gsOn(), 'Gradescope on');
    ok(true, 'in its own tab the same switch asks: Firefox granted www.gradescope.com and it is on');
    await b.clickOn(gsTab, gradescope);
    await until(async () => !await gsOn(), 'Gradescope off');
    await b.close(gsTab);
    await noErrors(b, 'embedded Settings: Gradescope');
    const MEDIA = 'https://media.school.edu/loop.webm';
    const look = () => b.value(`browser.storage.sync.get('lookX').then((r) => JSON.stringify(r.lookX ?? null))`, settings);
    const lookBefore = await look();
    f = await embed('#look/background');
    await b.value(`(() => { const i = document.getElementById('x-media-link'); i.value = ${JSON.stringify(MEDIA)}; i.dispatchEvent(new Event('change')); return 1; })()`, f);
    const bgTab = await ownSettings('#look/background');
    await closed();
    ok(!await holds(b, settings, 'https://media.school.edu/*') && await look() === lookBefore && !asked.some((u) => u.includes('media.school.edu')), 'embedded: a pasted Look link opens Settings\' own tab at Background and closes; nothing asked, kept or fetched');
    await until(() => b.value(`document.getElementById('x-media-link').value === ${JSON.stringify(MEDIA)} && !!document.getElementById('x-media-allow')?.getClientRects().length`, bgTab), 'the carried link and Allow button');
    ok(true, 'the pasted media link carries into its own tab with one Allow button, without granting or saving');
    await b.close(bgTab);
    f = await embed('#mods/installed');
    await b.clickOn(course, `document.querySelector('[data-editor-panel="mods"] .embed-gate button')`, [f, '#gz-settings-page']);
    const modsTab = await ownSettings('#mods/installed');
    await closed();
    ok(true, 'embedded: Mods (a mod\'s network hosts) opens in Settings\' own tab');
    await b.close(modsTab);
    await b.close(course);
    await noErrors(b, 'embedded Settings');

    // A web-accessible Allow page opened directly cannot request a host planted in its hash.
    const planted = await b.open(`${EXT}features/allow.html#planted.example.net`);
    await pause(400);
    ok(await b.value(`document.getElementById('allow').hidden`, planted) && !await holds(b, settings, 'https://planted.example.net/*'), 'a public Allow URL has no prompt authority');
    await b.close(planted);

    // The gallery: "Use this Look in Glaze" hands the Look to the editor (Firefox names the gallery's content script by its
    // full address).
    const looks = await b.open(`${GALLERY}/glaze/looks/`);
    await b.click(looks, 'a[data-glaze-use]');
    const editorTook = async () => {
      for (const c of await b.tree()) if (c.url.startsWith(`${EXT}options.html`) && await b.value(`document.getElementById('share-code')?.value === ${JSON.stringify(galleryCode)}`, c.context)) return c.context;
      return null;
    };
    await until(editorTook, 'the editor to take the Look');
    ok(await b.value(`browser.storage.local.get('galleryOffer').then((r) => !r.galleryOffer)`, settings), 'the gallery hand-off: the editor took the Look to preview');
    await noErrors(b, 'the gallery hand-off');
  });

  // 2. An update from a package that holds every site (v3.3.8): the student's sites and their grant stay.
  asked.length = 0;
  await session('update', async (b) => {
    await b.install(old);
    await pause(2000);
    ok(await b.count(EXT) === 0, `${OLD_REF} opens no first-run tab`);
    const canvas = await b.open(`${CANVAS}/courses/25`);
    // The card's Yes: it goes once the worker took the answer.
    const yes = async (c) => {
      await until(() => b.card(c), 'the card');
      await pause(1200);
      await b.keys(c, ['\uE004']); // Tab: the card is the page's first stop
      await b.keys(c, ['\uE007']); // Enter on its Yes (the card's shadow root is closed)
      await until(async () => !await b.card(c), 'the card to take the answer');
    };
    await yes(canvas);
    ok(true, `${OLD_REF}: a Canvas site approved on its card`);
    const ultra = await b.open(`${BB}/ultra/courses/_101_1/outline`);
    await yes(ultra);
    ok(true, `${OLD_REF}: a Blackboard site approved on its card`);
    // What the old version itself logged is its own, not the update's.
    const was = await b.errors();
    if (was.length) console.log(`note ${OLD_REF} logged: ${was.join(' | ')}`);
    await b.install(fresh);
    await pause(3000);
    ok(await b.count(`${EXT}features/welcome.html`) === 0, 'the update opens no first-run tab');
    const control = await b.open(`${EXT}features/allow.html`);
    ok(await b.value('browser.runtime.getManifest().version', control) === manifest.version, `updated to ${manifest.version}`);
    const after = await grants(b, control);
    ok(after.includes('<all_urls>') && await holds(b, control, `${CANVAS}/*`) && await holds(b, control, 'https://*/*'), `the update keeps the all-site grant (${after.join(', ')})`);
    const l = await lists(b, control);
    ok(l.canvas?.includes(`${CANVAS}/*`) && l.ultra?.includes(BB), `and both sites on their lists (${JSON.stringify(l)})`);
    const ids = await until(async () => { const r = await registered(b, control); return r.includes(`${CANVAS}/*`) && r.includes(`ultra:${BB}`) && r.includes('gz-detect') && r; }, 'the sites registered');
    ok(true, `registered: ${ids.join(', ')}`);
    await b.reload(canvas);
    await until(async () => (await b.sheets(canvas)).includes('canvas.css'), 'Glaze on the Canvas site after the update');
    await b.reload(ultra);
    await until(async () => (await b.sheets(ultra)).includes('theme.css'), 'Glaze on the Blackboard site after the update');
    await pause(800);
    ok(!await b.card(canvas) && !await b.card(ultra), 'both keep Glaze, with no card');
    const moodle = await b.open(`${MOODLE}/course/view.php?id=2`);
    await yes(moodle);
    await until(async () => (await b.sheets(moodle)).length > 0, 'Glaze on the new school');
    ok((await lists(b, control)).moodle?.includes(`${MOODLE}/*`), 'with the all-site grant, a new school is added from its card');
    await noErrors(b, 'the update');
  });
};

const stop = () => { try { ff?.kill('SIGKILL'); } catch { /* gone */ } };
const quit = (code) => { stop(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(code); };
process.on('SIGINT', () => quit(130));
process.on('SIGTERM', () => quit(143));
try {
  await run();
} catch (e) {
  console.error(e.stack || String(e));
  failed.push(String(e.message || e));
} finally {
  stop();
  schools?.close(); proxy?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failed.length) process.exitCode = 1;
console.log(`${checks} ok, ${failed.length} failed, ${execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim()} headless over WebDriver BiDi`);
