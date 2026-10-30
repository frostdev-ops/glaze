// Every network call in the code Glaze ships (package.sh's files: the worker, the area folders, the pages), by call site, and
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

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const roots = read('../tools/build/package.sh').match(/^zip -q -r -X "\$OUT" ([\s\S]*?)-x /m)[1].replace(/\\\n/g, ' ').trim().split(/\s+/);
const walk = (p) => {
  const f = path.join(root, p);
  if (!fs.existsSync(f)) return [];
  return fs.statSync(f).isDirectory() ? fs.readdirSync(f).flatMap((x) => walk(path.posix.join(p, x))) : [p];
};
// Vendored engines (pdf.js, Tesseract, three.js, Lottie, Harper) load only their own files, from the extension.
const VENDORED = /^vendor\/(pdfjs|tesseract|lottie)\/|^vendor\/harper\/(?!shared\.js$)|^vendor\/three\.min\.js$/;
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
  'background/background.js': [
    // Runs inside the claimed LMS document via executeScript; its origin is fixed by that document. The worker's
    // Writer admission gate and the browser's held school grant are required before injecting the account read.
    { at: 'fetch(`${location.origin}/learn/api/v1/users/me`', kind: 'asked', flow: 'the verified Blackboard assignment host, under its existing school grant, for the visual cache account binding', guard: /if \(await aiWriter\(s, \{ op: 'run', feature: 'writing' \}\) !== true\) return null/ },
    { at: 'return GZ_WRITER_LOOKUP.listener', kind: 'via', to: 'writer/writer-lookup.js' },
    { at: "{ fetch: (u, i) => fetch(u, i), allow", kind: 'via', to: 'looks/media.js' },
    { at: 'GZ_MEDIA.fromGallery(h, m.type, { fetch:', kind: 'via', to: 'looks/media.js' },
    { at: 'GZ_MODBUNDLE.offer(g, { fetch:', kind: 'via', to: 'mods/modbundle.js' },
    { at: "fetch: (u, i) => fetch(u, control ?", kind: 'via', to: 'mods/modbroker.js' },
    { at: 'fetch: (url, init) => fetch(url, init), now:', kind: 'via', to: 'mods/blocklist.js' },
    { at: 'reach: reachable, fetch: (u, i) => fetch(u, i), task:', kind: 'via', to: 'ai/broker.js' },
    { at: 'const channelEnv = () => ({', kind: 'asked', flow: 'a mod channel\'s relay: share.frostdev.io, or one the editor asked for (settings/editor-mods.js Read code)', guard: /reachable\(u\)/, near: 0 },
    { at: 'fetch: (url, init) => fetch(url, init),', kind: 'via', to: 'planner/gcal.js', exact: true },
    { at: 'fetch: (u, init) => fetch(u, init),', kind: 'via', to: 'background/google.js', exact: true },
    { at: 'drive: D.create({ fetch: (u, init) => fetch(u, init),', kind: 'via', to: 'documents/drive.js' },
    { at: 'drive: () => GZ_DRIVE.create({ fetch: (u, init) => fetch(u, init),', kind: 'via', to: 'documents/drive.js' },
    { at: 'fetch(chrome.runtime.getURL(`icons/icon', kind: 'extension' },
    { at: "credentials: 'include', redirect: 'error'", kind: 'asked', flow: 'Gradescope: the Settings switch asks for www.gradescope.com', guard: /reachable\(GZ_GRADESCOPE\.HOST\)/ },
    { at: "redirect: wide ? 'follow' : 'manual', cache: 'no-store', signal: ctl.signal", kind: 'asked', flow: 'Canvas Download all: the page\'s Allow frame (courses/allow.html) for the file server', guard: /if \(!await reachable\(url\)\)/ },
  ],
  'looks/media.js': [
    // The worker's mediaFetch, the one caller of these two, checks the host before it hands the address over.
    { at: 'AbortSignal.timeout(LIMIT.fetch)', kind: 'asked', flow: 'a Lottie link: the editor asked for its host (settings/editor-xbg.js), or a mod\'s install did', in: 'background/background.js', guard: /op\.op === 'lottie' && [^\n]*!await reachable\(op\.src\)\) return \{ ok: false, error: 'host' \}/ },
    { at: 'AbortSignal.timeout(WAIT[kind])', kind: 'asked', flow: 'a video or picture link: the editor asked for its host (settings/editor-xbg.js), or a mod\'s install did', in: 'background/background.js', guard: /if \(!await reachable\(op\.src\)\) return \{ ok: false, error: 'host' \}/ },
    { at: 'fetch(`${GALLERY}${h}`', kind: 'required', host: 'https://frostdev.io', literal: "'https://frostdev.io/glaze/looks/api/media/'" },
  ],
  'mods/modbundle.js': [{ at: 'fetch(`${GALLERY}${g.id}', kind: 'required', host: 'https://frostdev.io', literal: "'https://frostdev.io/glaze/mods/api/mods/'" }],
  'mods/modbroker.js': [{ at: 'env.fetch(u.href', kind: 'asked', flow: 'a mod\'s network:<host>: its install or its switch asked for the host (settings/editor-mods.js)', guard: /if \(!await env\.reach\(u\.href\)\)/ }],
  // AI: the connection's endpoint, whose host Settings asks for from a click. The broker refuses while the browser doesn't
  // hold it, and the provider and the catalog reach it only through the broker's fetch pinned to that host and generation.
  'ai/broker.js': [{ at: 'env.fetch(url, init)', kind: 'asked', flow: 'an AI connection\'s endpoint, asked for by Settings', in: 'ai/broker.js', guard: /if \(!await reaches\(env, use\)\) throw R\(\)\.error\('permission'\)/ }],
  'ai/providers/openai.js': [
    { at: 'res = await fetch(`${cfg.base}/chat/completions`', kind: 'asked', flow: 'the broker\'s fetch, pinned to the connection\'s held host', in: 'ai/broker.js', guard: /fetch: pinned\(env, use\)/ },
    { at: 'res = await fetch(`${cfg.base}/key`', kind: 'asked', flow: 'Settings\' check of an OpenRouter key (Connect, Test), through the broker\'s pinned fetch once the host is held', in: 'ai/broker.js', guard: /if \(!await reaches\(env, use\)\) return \{ ok: true, state: 'unavailable', reason: 'permission' \};[\s\S]*use\.p\.status\(use\.cfg, \{ fetch: pinned\(env, use\)/ },
  ],
  'ai/models.js': [{ at: 'fetch(shared ? OPENROUTER', kind: 'asked', flow: 'the connection\'s catalog, through the broker\'s pinned fetch (OpenRouter\'s public catalog is on the connection\'s own host)', in: 'ai/broker.js', guard: /use\.p\.catalog\(use\.cfg, \{ fetch: pinned\(env, use\)/ }],
  // Glaze Writer's citation lookups, on the student's click: a web page only once its https host is held (the Cite popover
  // asks for exactly it in the click); doi.org (and the agency it redirects to, api.crossref.org) and openlibrary.org answer
  // every origin with CORS, so a DOI or an ISBN asks for no host.
  'writer/writer-lookup.js': [{ at: 'res = await bounded(env.fetch(url, {', kind: 'asked', flow: 'a web page\'s host, asked for from the Cite popover\'s click (writer-cite.js); doi.org, api.crossref.org, data.crosscite.org and openlibrary.org answer every origin',
    guard: /if \(!r\.open && !await env\.reach\(r\.url\)\) return \{ ok: false, error: 'host' \}/ }],
  'mods/blocklist.js': [{ at: 'env.fetch(ENDPOINT', kind: 'required', host: 'https://frostdev.io', literal: "'https://frostdev.io/glaze/mods/api/blocklist'" }],
  'mods/modchannel.js': [{ at: 'const client = (st, fetch) =>', kind: 'via', to: 'background/background.js' }],
  'sharing/sessions.js': [
    { at: 'return (fetch || globalThis.fetch)(url', kind: 'asked', flow: 'share relays: share.frostdev.io, or one Settings or the Notes share panel asked for', guard: /await permission\(server\)/ },
    { at: "(server + '/health'", kind: 'asked', flow: 'a relay\'s health check, once held', guard: /check\(await permission\(server\), 'permission'\)/ },
  ],
  'sharing/sharing.js': [
    { at: 'fetch: f = (...a) => globalThis.fetch(...a)', kind: 'via', to: 'sharing/sessions.js' },
    { at: 'WebSocket: W = globalThis.WebSocket', kind: 'via', to: 'sharing/sessions.js' },
  ],
  'planner/gcal.js': [
    { at: 'env.fetch(`${env.api || API}', kind: 'open', host: 'https://www.googleapis.com', why: 'Google Calendar API, CORS for any origin; behind GZ_GCAL.ON (on; Chrome only)' },
    { at: 'env.fetch(env.revoke || REVOKE', kind: 'open', host: 'https://oauth2.googleapis.com', why: 'token revocation, CORS for any origin; behind GZ_GCAL.ON (on; Chrome only)' },
  ],
  // Drive's sign-in (behind background/google-config.js's placeholders until its clients are real): Google's userinfo and revoke,
  // and the HEAD that finds the picker page that loads.
  // Drive's files (behind background/google.js's ON): the Drive v3 API and its upload address, both on www.googleapis.com.
  'documents/drive.js': [{ at: 'const send = (url, init) => env.fetch(url', kind: 'open', host: 'https://www.googleapis.com', why: 'Drive v3 (files and uploads) answers every origin (CORS); behind GZ_GOOGLE.ON (off)' }],
  'background/google.js': [{ at: 'const send = (url, init = {}) => env.fetch(url', kind: 'open', why: 'openidconnect.googleapis.com and oauth2.googleapis.com answer every origin (CORS); of the picker pages, frostdev.io is a required host and its GitHub Pages copy answers every origin' }],
  'looks/fonts.js': [{ at: 'const get = (url, as) => fetch(url', kind: 'open', host: 'https://fonts.googleapis.com', hosts: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'], why: 'Google Fonts CSS, fonts.gstatic.com and the jsDelivr catalog files answer every origin' }],
  'settings/options.js': [{ at: 'fetch(GZ_FONTS.cssUrl(name, false)', kind: 'open', host: 'https://fonts.googleapis.com', why: 'whether a typed Google font exists' }],
  'core/site.js': [
    { at: 'const probe = async (site, f = fetch)', kind: 'asked', flow: 'a school\'s site: probed once its grant is held (core/site.js allow, the worker\'s glaze:allow and onAdded)', guard: /permissions\.request\(\{ origins: \[site\.pattern\] \}\)/, after: true },
    { at: 'const nearby = async (site, { f = fetch', kind: 'open', why: 'no-cors existence checks whose answer is never read; the homepage read only when held' },
  ],
  'settings/editor-xbg.js': [{ at: 'fetch(`assets/shaders/', kind: 'extension' }],
  // A deck's card picture carries the bundled faces its slide 1 uses (vendor/fonts), read from the extension itself.
  'documents/slides/slides-kind.js': [{ at: 'fetch(chrome.runtime.getURL(`vendor/fonts/', kind: 'extension' }],
  'planner/ocr.js': [{ at: 'fetch(here(', kind: 'extension' }],
  'courses/lmsq.js': [{ at: 'return fetch(url, init)', kind: 'page' }],
  'courses/ultra.js': [{ at: 'f = (...a) => fetch(...a)', kind: 'page' }],
  'content/content.js': [{ at: 'fetch(`${location.origin}${base}${path}`', kind: 'page' }],
  'content/content-ultra.js': [{ at: 'GZ_LMSQ.fetch(u, o, 0, live)', kind: 'page' }],
  'content/content-canvas.js': [{ at: 'fetch(`${location.origin}/courses/${cid}/grades`', kind: 'page' }],
  // An announcement from the page's own site, and Canvas's read mark, through the site's queue (courses/lmsq.js).
  'courses/page/announce.js': [{ at: 'const q = (url, init) => GZ_LMSQ.fetch(url', kind: 'page' }, { at: 'f: (u, i) => GZ_LMSQ.fetch(u, i, prio)', kind: 'page' }, { at: 'GZ_LMSQ.fetch(m.url,', kind: 'page' }],
  'courses/page/announce-read.js': [{ at: 'GZ_LMSQ.fetch(url,', kind: 'page' }],
  'courses/page/popup.js': [{ at: 'GZ_LMSQ.fetch(src,', kind: 'page' }],
  // Rubric definitions and the current student's evaluation, read-only through the page's own LMS queue.
  'courses/page/rubric.js': [{ at: 'const res = await GZ_LMSQ.fetch(url,', kind: 'page' }, { at: 'f: (...args) => GZ_LMSQ.fetch(...args, 0, live)', kind: 'page' }],
  // An assignment's context, and the files it attaches (/bbcswebdav/ on the page's site), read when Feedback asks.
  'writer/writer-context-assignment.js': [{ at: 'f: (...a) => GZ_LMSQ.fetch(...a, 0, live)', kind: 'page' }, { at: "await fetch(url, { credentials: 'same-origin' })", kind: 'page' }],
  'planner/page/calexport.js': [{ at: 'await fetch(url,', kind: 'page' }],
  // Glaze Writer's discussion context: the prompt, thread and replies, read-only behind visible work in the site's queue.
  'writer/writer-context-discussion.js': [{ at: 'GZ_LMSQ.fetch(u, o, 1, live)', kind: 'page' }],
  'courses/page/cardtasks.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'planner/page/classes.js': [{ at: 'await fetch(u.href,', kind: 'page' }],
  'navigation/page/coursemenu.js': [{ at: 'fetch(`${location.origin}/api/v1/users/self/', kind: 'page' }],
  'courses/page/docs.js': [{ at: 'await fetch(url,', kind: 'page' }],
  // A Blackboard preview (the worker's courses/bb-preview.js answers with the address): its converted PDF, read from the Ultra
  // page's own origin.
  'courses/page/bbpreview.js': [{ at: "await fetch(url, { mode: 'cors', credentials: 'omit'", kind: 'open', host: 'https://annotate-doc-viewer-prod-filesbucket.s3-fips.us-east-1.amazonaws.com',
    why: "a presigned S3 converted.pdf, without cookies: the bucket's CORS lets the Ultra page's origin read it (live probe, 2026-10-30)" }],
  // The worker: the preview's own address on the asking Ultra page's site, then basic-doc-viewer under *.blackboard.com.
  'courses/bb-preview.js': [{ at: '{ fetch: get = fetch, now = Date.now', kind: 'asked', flow: 'an Ultra site Glaze runs on (its built-in or granted host), from that site\'s page only; Blackboard\'s document viewer is a required host', in: 'background/background.js', guard: /const origin = ultraPage\(s\) \? await fromUltra\(s\) : null;/ }],
  'courses/page/download.js': [{ at: 'await fetch(f.url,', kind: 'page' }],
  'planner/page/grades.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'planner/page/gradescope.js': [{ at: "fetch('/account/edit'", kind: 'page' }, { at: 'fetch(`/courses/${gid}`', kind: 'page' }],
  'planner/page/insights.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'courses/page/moodle.js': [{ at: 'fetch(`${s.root}/lib/ajax/service.php', kind: 'page' }, { at: 'fetch(`${s.root}/grade/report/overview', kind: 'page' }],
  'navigation/page/navbar-canvas.js': [{ at: 'await fetch(next,', kind: 'page' }, { at: "fetch('/logout'", kind: 'page' }],
  'navigation/page/navbar-moodle.js': [{ at: 'fetch(`${s.root}/lib/ajax/service.php', kind: 'page' }],
  'planner/page/notes.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'planner/page/reminders.js': [{ at: 'await fetch(url,', kind: 'page' }],
  'navigation/page/search.js': [{ at: 'fetch(`${location.origin}/api/v1${path}`', kind: 'page' }],
  // A file an Ultra document links (/bbcswebdav/ on the page's site), read on the student's click for the syllabus import.
  'planner/page/syllabus.js': [{ at: 'await fetch(f.url,', kind: 'page' }],
  'planner/page/todo.js': [{ at: 'await fetch(url,', kind: 'page' }, { at: 'fetch(`${location.origin}/api/v1/planner/overrides', kind: 'page' }],
  // Agent apps' reads in the account's own LMS tab (agents/tabs.js injects it there): the page's own site only.
  'agents/tab.js': [{ at: 'await fetch(go.origin + path,', kind: 'page' }],
};
const KINDS = ['required', 'extension', 'asked', 'page', 'via', 'open'];

// The files that run in the worker or in Glaze's own pages: no 'page' call may be one of theirs.
const extensionSide = () => {
  const out = new Set(['background/background.js', 'settings/options.js', 'settings/popup.js', 'planner/reader.js', 'core/ui.js']);
  for (const m of read('background/background.js').matchAll(/importScripts\(([^)]*)\)/g)) for (const [, f] of m[1].matchAll(/'([^']+)'/g)) out.add(path.posix.normalize(`background/${f}`));
  for (const page of ['options.html', 'popup.html', 'preview.html', 'reader.html', 'settings/welcome.html', 'sharing/quick.html', 'courses/allow.html']) {
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
        // The check stands before the call in the same function (or in its one caller, `in`; or, for the probe, the request
        // that precedes it).
        const span = e.in ? read(e.in) : e.after ? src : src.slice(Math.max(0, at - 4000), at + e.at.length + 400);
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
  const src = read('background/background.js');
  assert.match(src, /const reachable = async \(url\) =>/);
  const body = src.slice(src.indexOf('const reachable = async (url) =>'), src.indexOf('\n};', src.indexOf('const reachable = async (url) =>')));
  assert.match(body, /<all_urls>/);
  assert.match(body, /granted\(/);
});

test('review: the font loader classification names every catalog file host', () => {
  const entry = SITES['looks/fonts.js'][0];
  const named = new Set(entry.hosts || [entry.host]);
  const files = require('../../extension/looks/fonts.js').LIST.flatMap((f) => Object.values(f.files || {}));
  for (const url of files) assert.ok(named.has(new URL(url).origin), `${url}: the font host is named`);
});

// The AI providers Settings → AI names (ai/settings.js PRESETS), each one's host: never one the manifest holds, so the
// browser is asked for it, from Connect's click (settings/editor-ai.js), before the broker reaches it.
const AI_HOSTS = { openai: 'api.openai.com', anthropic: 'api.anthropic.com', gemini: 'generativelanguage.googleapis.com', openrouter: 'openrouter.ai',
  xai: 'api.x.ai', mistral: 'api.mistral.ai', groq: 'api.groq.com', deepseek: 'api.deepseek.com' };
const PRIVACY_AI = Object.entries({ openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', openrouter: 'OpenRouter', xai: 'xAI', mistral: 'Mistral', groq: 'Groq', deepseek: 'DeepSeek' })
  .map(([id, name]) => `- \`https://${AI_HOSTS[id]}\` for ${name}`);
test('each AI provider is an https host asked for from Connect\'s click, none the manifest holds', () => {
  const { PRESETS } = require('../../extension/ai/settings.js');
  assert.deepEqual(Object.fromEntries(Object.entries(PRESETS).map(([id, p]) => [id, new URL(p.base).hostname])), AI_HOSTS, 'a new provider is listed here');
  for (const [id, host] of Object.entries(AI_HOSTS)) {
    assert.equal(new URL(PRESETS[id].base).protocol, 'https:', id);
    assert.ok(!covered(`https://${host}`), `${host} is asked for, not held`);
    assert.ok(manifest.optional_host_permissions.includes('https://*/*'), `${host} can be asked for`);
  }
  const edit = read('settings/editor-ai.js');
  const connect = edit.slice(edit.indexOf('const connect = (e, id, input, from) => {'), edit.indexOf('const check = async'));
  // The host first, from the click, before anything is awaited; the key after.
  assert.match(connect, /if \(!e\?\.isTrusted \|\| busy\) return;[\s\S]*const asked = Promise\.resolve\(GZ_SITE\.reach\(S\.PRESETS\[id\]\.base, from\)\)/);
  assert.ok(connect.indexOf('GZ_SITE.reach') < connect.indexOf('await'), 'asked before anything is awaited');
  assert.ok(PRIVACY_AI.every((line) => read('../PRIVACY.md').includes(line)), 'PRIVACY.md names each host');
});
