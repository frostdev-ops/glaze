// Every network call in the code Glaze ships (package.sh's files: the worker, lib/, features/, the pages), by call site, and
// where it may go. Without <all_urls> (Chrome, Edge, Firefox) the worker and Glaze's pages reach only the hosts the manifest
// holds or the student granted, so each site is one of:
//   required  — a host the manifest holds (named here, checked against host_permissions),
//   extension — Glaze's own files,
//   asked     — a host the same flow asked for first (the flow named, and the check it makes before the call, found before it),
//   page      — a content script's request to its page's own site (as the page itself would make it),
//   via       — the worker's fetch handed to a module whose own calls are classified here,
//   open      — a public host that answers every origin (CORS *), or a no-cors probe whose answer is never read.
// A new call site fails here until it is classified.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const roots = read('package.sh').match(/^zip -q -r -X "\$OUT" ([\s\S]*?)-x /m)[1].replace(/\\\n/g, ' ').trim().split(/\s+/);
const walk = (p) => {
  const f = path.join(root, p);
  if (!fs.existsSync(f)) return [];
  return fs.statSync(f).isDirectory() ? fs.readdirSync(f).flatMap((x) => walk(path.posix.join(p, x))) : [p];
};
// Vendored engines (pdf.js, Tesseract, three.js, Lottie) load only their own files, from the extension.
const VENDORED = /^lib\/(pdfjs|tesseract|lottie)\/|^lib\/three\.min\.js$/;
const FILES = roots.flatMap(walk).filter((f) => /\.m?js$/.test(f));
// Each line without its comment: a comment line, or what follows ` // ` (an address's `://` has no space before it).
const lines = (js) => js.split('\n').map((l) => (/^\s*(\/\/|\/?\*)/.test(l) ? '' : l.replace(/\s\/\/\s.*$/, '')));
// A call of fetch, of something's .fetch, fetch handed on as a default (`f = fetch`, `fetch || …`), and a socket's default.
const CALL = /(?<![\w$.])fetch\s*\(|\.fetch\s*\(|\bfetch\s*\|\||=\s*fetch\b(?!\s*[(:])|globalThis\.WebSocket\b/g;

const covered = (origin) => manifest.host_permissions.some((p) => {
  const [, scheme, host] = /^(\*|https?):\/\/([^/]+)\//.exec(p) || [];
  const u = new URL(origin);
  return (scheme === '*' || `${scheme}:` === u.protocol) && (host === u.hostname || (host?.startsWith('*.') && u.hostname.endsWith(host.slice(1))));
});

// file → [{ at: text on the call's line, kind, … }]. `n`: how many calls on lines with that text (1 when absent).
const SITES = {
  'lib/background.js': [
    { at: "{ fetch: (u, i) => fetch(u, i), allow", kind: 'via', to: 'lib/media.js' },
    { at: 'GZ_MEDIA.fromGallery(h, m.type, { fetch:', kind: 'via', to: 'lib/media.js' },
    { at: 'GZ_MODBUNDLE.offer(g, { fetch:', kind: 'via', to: 'lib/modbundle.js' },
    { at: "fetch: (u, i) => fetch(u, control ?", kind: 'via', to: 'lib/modbroker.js' },
    { at: 'fetch: (url, init) => fetch(url, init), now:', kind: 'via', to: 'lib/blocklist.js' },
    { at: 'const channelEnv = () => ({', kind: 'asked', flow: 'a mod channel\'s relay: share.frostdev.io, or one the editor asked for (lib/editor-mods.js Read code)', guard: /reachable\(u\)/, near: 0 },
    { at: 'fetch: (url, init) => fetch(url, init),', kind: 'via', to: 'lib/gcal.js', exact: true },
    { at: 'fetch(chrome.runtime.getURL(`icons/icon', kind: 'extension' },
    { at: "credentials: 'include', redirect: 'error'", kind: 'asked', flow: 'Gradescope: the Settings switch asks for www.gradescope.com', guard: /reachable\(GZ_GRADESCOPE\.HOST\)/ },
    { at: "redirect: 'follow', cache: 'no-store', signal: ctl.signal", kind: 'asked', flow: 'Canvas Download all: the page\'s Allow frame (features/allow.html) for the file server', guard: /if \(!await reachable\(url\)\)/ },
  ],
  'lib/media.js': [
    { at: 'AbortSignal.timeout(LIMIT.fetch)', kind: 'asked', flow: 'a Lottie link: the editor asked for its host (lib/editor-xbg.js), or a mod\'s install did', guard: /if \(!await env\.reach\(url\)\)/ },
    { at: 'AbortSignal.timeout(WAIT[kind])', kind: 'asked', flow: 'a video or picture link: the editor asked for its host (lib/editor-xbg.js), or a mod\'s install did', guard: /if \(!await env\.reach\(url\)\)/ },
    { at: 'fetch(`${GALLERY}${h}`', kind: 'required', host: 'https://frostdev.io', literal: "'https://frostdev.io/glaze/looks/api/media/'" },
  ],
  'lib/modbundle.js': [{ at: 'fetch(`${GALLERY}${g.id}', kind: 'required', host: 'https://frostdev.io', literal: "'https://frostdev.io/glaze/mods/api/mods/'" }],
  'lib/modbroker.js': [{ at: 'env.fetch(u.href', kind: 'asked', flow: 'a mod\'s network:<host>: its install or its switch asked for the host (lib/editor-mods.js)', guard: /if \(!await env\.reach\(u\.href\)\)/ }],
  'lib/blocklist.js': [{ at: 'env.fetch(ENDPOINT', kind: 'required', host: 'https://frostdev.io', literal: "'https://frostdev.io/glaze/mods/api/blocklist'" }],
  'lib/modchannel.js': [{ at: 'const client = (st, fetch) =>', kind: 'via', to: 'lib/background.js' }],
  'lib/sessions.js': [
    { at: 'return (fetch || globalThis.fetch)(url', kind: 'asked', flow: 'share relays: share.frostdev.io, or one Settings or the Notes share panel asked for', guard: /await permission\(server\)/ },
    { at: "(server + '/health'", kind: 'asked', flow: 'a relay\'s health check, once held', guard: /check\(await permission\(server\), 'permission'\)/ },
  ],
  'lib/sharing.js': [
    { at: 'fetch: f = (...a) => globalThis.fetch(...a)', kind: 'via', to: 'lib/sessions.js' },
    { at: 'WebSocket: W = globalThis.WebSocket', kind: 'via', to: 'lib/sessions.js' },
  ],
  'lib/gcal.js': [
    { at: 'env.fetch(`${env.api || API}', kind: 'open', host: 'https://www.googleapis.com', why: 'Google Calendar API, CORS for any origin; behind GZ_GCAL.ON (off)' },
    { at: 'env.fetch(env.revoke || REVOKE', kind: 'open', host: 'https://oauth2.googleapis.com', why: 'token revocation, CORS for any origin; behind GZ_GCAL.ON (off)' },
  ],
  'lib/fonts.js': [{ at: 'const get = (url, as) => fetch(url', kind: 'open', host: 'https://fonts.googleapis.com', why: 'Google Fonts CSS and its fonts.gstatic.com files answer every origin' }],
  'options.js': [{ at: 'fetch(GZ_FONTS.cssUrl(name, false)', kind: 'open', host: 'https://fonts.googleapis.com', why: 'whether a typed Google font exists' }],
  'lib/site.js': [
    { at: 'const probe = async (site, f = fetch)', kind: 'asked', flow: 'a school\'s site: probed once its grant is held (lib/site.js allow, the worker\'s glaze:allow and onAdded)', guard: /permissions\.request\(\{ origins: \[site\.pattern\] \}\)/, after: true },
    { at: 'const nearby = async (site, { f = fetch', kind: 'open', why: 'no-cors existence checks whose answer is never read; the homepage read only when held' },
  ],
  'lib/editor-xbg.js': [{ at: 'fetch(`assets/shaders/', kind: 'extension' }],
  'lib/ocr.js': [{ at: 'fetch(here(', kind: 'extension' }],
  'lib/lmsq.js': [{ at: 'return fetch(url, init)', kind: 'page' }],
  'lib/ultra.js': [{ at: 'f = (...a) => fetch(...a)', kind: 'page' }],
  'content.js': [{ at: 'fetch(`${location.origin}${base}${path}`', kind: 'page' }],
  'content-ultra.js': [{ at: 'GZ_LMSQ.fetch(u, o, 0, live)', kind: 'page' }],
  'content-canvas.js': [{ at: 'fetch(`${location.origin}/courses/${cid}/grades`', kind: 'page' }],
  'features/calexport.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/cardtasks.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/classes.js': [{ at: 'await fetch(u.href,', kind: 'page' }],
  'features/coursemenu.js': [{ at: 'fetch(`${location.origin}/api/v1/users/self/', kind: 'page' }],
  'features/docs.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/download.js': [{ at: 'await fetch(f.url,', kind: 'page' }],
  'features/grades.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/gradescope.js': [{ at: "fetch('/account/edit'", kind: 'page' }, { at: 'fetch(`/courses/${gid}`', kind: 'page' }],
  'features/insights.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/moodle.js': [{ at: 'fetch(`${s.root}/lib/ajax/service.php', kind: 'page' }, { at: 'fetch(`${s.root}/grade/report/overview', kind: 'page' }],
  'features/navbar-canvas.js': [{ at: 'await fetch(next,', kind: 'page' }, { at: "fetch('/logout'", kind: 'page' }],
  'features/navbar-moodle.js': [{ at: 'fetch(`${s.root}/lib/ajax/service.php', kind: 'page' }],
  'features/notes.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/reminders.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'features/search.js': [{ at: 'fetch(`${location.origin}/api/v1${path}`', kind: 'page' }],
  'features/todo.js': [{ at: 'await fetch(url,', kind: 'page' }, { at: 'fetch(`${location.origin}/api/v1/planner/overrides', kind: 'page' }],
};
const KINDS = ['required', 'extension', 'asked', 'page', 'via', 'open'];

// The files that run in the worker or in Glaze's own pages: no 'page' call may be one of theirs.
const extensionSide = () => {
  const out = new Set(['lib/background.js', 'options.js', 'popup.js', 'reader.js', 'ui.js']);
  for (const m of read('lib/background.js').matchAll(/importScripts\(([^)]*)\)/g)) for (const [, f] of m[1].matchAll(/'([^']+)'/g)) out.add(path.posix.normalize(`lib/${f}`));
  for (const page of ['options.html', 'popup.html', 'preview.html', 'reader.html', 'features/welcome.html', 'sharing/quick.html', 'features/allow.html']) {
    if (!fs.existsSync(path.join(root, page))) continue;
    for (const [, src] of read(page).matchAll(/<script[^>]+src="([^"]+)"/g)) out.add(path.posix.normalize(path.posix.join(path.posix.dirname(page), src)));
  }
  return out;
};

test('every network call in the shipped code is classified, and every classification names a call that exists', () => {
  const unclassified = [], stale = [];
  for (const f of FILES.filter((x) => !VENDORED.test(x))) {
    const entries = SITES[f] || [];
    const hits = new Map(entries.map((e) => [e, 0]));
    for (const line of lines(read(f))) for (const m of line.matchAll(CALL)) {
      const match = entries.filter((e) => (e.exact ? line.trim() === e.at : line.includes(e.at)));
      if (match.length !== 1) unclassified.push(`${f}: ${line.trim().slice(0, 160)}${match.length > 1 ? ' (more than one entry)' : ''}`);
      else hits.set(match[0], hits.get(match[0]) + 1);
    }
    for (const [e, n] of hits) if (n !== (e.n || 1)) stale.push(`${f}: "${e.at}" matched ${n}`);
  }
  for (const f of Object.keys(SITES)) if (!FILES.includes(f)) stale.push(`${f}: not shipped`);
  assert.deepEqual(unclassified, [], 'calls with no classification');
  assert.deepEqual(stale, [], 'classifications with no call, or more than one');
});

test('each classification holds: required hosts are the manifest\'s, asked-for calls check first, page calls are content-side', () => {
  const ext = extensionSide();
  for (const [f, entries] of Object.entries(SITES)) {
    const src = read(f);
    for (const e of entries) {
      const where = `${f}: ${e.at}`;
      assert.ok(KINDS.includes(e.kind), where);
      const at = src.indexOf(e.at);
      if (e.kind === 'required') {
        assert.ok(covered(e.host), `${where}: ${e.host} is not a required host`);
        assert.ok(src.includes(e.literal), `${where}: its address is ${e.literal}`);
        assert.ok(e.literal.includes(e.host), where);
      }
      if (e.kind === 'asked') {
        assert.ok(e.flow, `${where}: the flow that asks is named`);
        // The check stands before the call in the same function (or, for the probe, the request that precedes it).
        const span = e.after ? src : src.slice(Math.max(0, at - 4000), at + e.at.length + 400);
        assert.match(span, e.guard, `${where}: ${e.guard} before the call`);
      }
      if (e.kind === 'page') assert.ok(!ext.has(f), `${where}: ${f} runs in the worker or an extension page`);
      if (e.kind === 'via') assert.ok(SITES[e.to]?.length, `${where}: ${e.to}'s calls are classified`);
      if (e.kind === 'open') assert.ok(e.why && (!e.host || !covered(e.host)), `${where}: why it works without a grant`);
    }
  }
});

test('vendored engines are packaged as is, and the extension pages that load them are Glaze\'s own', () => {
  const vendored = FILES.filter((f) => VENDORED.test(f));
  assert.ok(vendored.length >= 4, vendored.join(', '));
  // They're never content scripts: a page's frame never runs them with its own origin.
  for (const c of manifest.content_scripts) for (const j of c.js) assert.ok(!VENDORED.test(j), j);
});

// The worker's check for a host: the manifest's every-site host (Safari), or the browser's grant for that host.
test('the worker asks the browser before reaching a feature host, and Safari\'s every-site manifest skips the question', () => {
  const src = read('lib/background.js');
  assert.match(src, /const reachable = async \(url\) =>/);
  const body = src.slice(src.indexOf('const reachable = async (url) =>'), src.indexOf('\n};', src.indexOf('const reachable = async (url) =>')));
  assert.match(body, /<all_urls>/);
  assert.match(body, /granted\(/);
});
