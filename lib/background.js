importScripts('download.js', 'color.js', 'fonts.js', '../defaults.js', 'history.js', 'cards.js');

// The storage broker: writes that must not race between tabs, sites and the editor run here, one at a time, in one
// queue. Page-origin locks wouldn't do: two schools' Canvas sites and the editor page share this storage. Each kind
// of write ('glaze:<name>') names who may ask for it and what it does, given { sync, local }; each area's get gives
// what is stored, and set and remove say whether they worked.
const brokerArea = (area) => ({
  get: (keys) => chrome.storage[area].get(keys),
  set: (patch) => chrome.storage[area].set(patch).then(() => true, () => false),
  remove: (keys) => chrome.storage[area].remove(keys).then(() => true, () => false),
});
// Who asks: Glaze's own editor page, or a content script in a tab on a Canvas site Glaze runs on.
const fromEditor = (s) => s.id === chrome.runtime.id && typeof s.url === 'string' && s.url.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
const canvasSite = (u) => chrome.storage.local.get('canvas').then(({ canvas = [] }) => (u.hostname === 'localhost' && chrome.runtime.getManifest().host_permissions.includes('http://localhost/*'))
  || u.hostname === 'instructure.com' || u.hostname.endsWith('.instructure.com') || canvas.includes(`${u.protocol}//${u.hostname}/*`), () => false);
const fromCanvas = async (s) => {
  if (s.id !== chrome.runtime.id || !s.tab) return null;
  let u;
  try { u = new URL(s.url); } catch { return null; }
  return /^https?:$/.test(u.protocol) && await canvasSite(u) ? u.origin : null;
};
const BROKER = {
  // Course cards (lib/cards.js change). A Canvas page saves one course of its own site; the editor does the rest.
  cards: {
    allow: async (m, s) => fromEditor(s) || (!!m.key && !m.set && !m.replace && !m.reset && GZ_CARDS.KEY.test(m.key) && m.key.startsWith(`canvas:${await fromCanvas(s)}/`)),
    run: (m, area) => GZ_CARDS.change(m, area),
  },
};
let brokerTurn = null;
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  const name = typeof m?.type === 'string' && m.type.startsWith('glaze:') ? m.type.slice(6) : '';
  if (!Object.hasOwn(BROKER, name)) return;
  const h = BROKER[name];
  Promise.resolve(h.allow(m, sender)).then((ok) => (ok ? (brokerTurn ||= GZ_CARDS.queue())(() => h.run(m, { sync: brokerArea('sync'), local: brokerArea('local') })) : { ok: false, error: 'sender' }))
    .then(reply, () => reply({ ok: false, error: 'write' }));
  return true;
});

// The command palette's "Glaze settings": a content script can't open the editor itself.
// openOptionsPage reuses an open editor tab; when Chrome refuses it, a new tab (as the popup does).
const openEditor = () => {
  const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
};
chrome.runtime.onMessage.addListener((m) => { if (m === 'options') openEditor(); });

// "Use this Look in Glaze" on the gallery (lib/gallery.js): the code waits in storage.local for the editor,
// which previews it and asks. Only from the gallery's own pages, where the manifest runs that script.
// A pattern ending in /* takes that folder and below; any other is that one page.
const GALLERY = chrome.runtime.getManifest().content_scripts.find((c) => c.js.includes('lib/gallery.js'))?.matches || [];
const onGallery = (url) => {
  let here;
  try { const u = new URL(url); here = u.origin + u.pathname; } catch { return false; }
  return GALLERY.some((p) => (p.endsWith('/*') ? here.startsWith(p.slice(0, -1)) : here === p));
};
chrome.runtime.onMessage.addListener((m, { url, frameId }) => {
  const g = m?.gallery;
  if (!g || frameId !== 0 || !onGallery(url)) return;
  const text = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  // The editor checks the code itself (lib/share.js); this only keeps the sizes sane.
  const offer = { code: text(g.code, 4000), name: text(g.name, 40), author: text(g.author, 39) };
  if (offer.code) chrome.storage.local.set({ galleryOffer: offer }).then(openEditor, console.warn);
});

// Looks history (lib/history.js), whatever changed the theme: the popup, the editor, Ctrl+K on a course page,
// another computer through sync. A burst of edits (a color being dragged) counts once, when it has rested for
// 4 seconds. The theme from before the burst goes in too, so "Previous Look" always has the one that was left.
// Clearing goes through here as well ('clear-history'): it cancels the burst still resting, and its write
// queues behind any recording already under way, so nothing cleared comes back. The next change starts afresh.
let before = null, rest = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !GZ_HISTORY.KEYS.some((k) => k in changes)) return;
  before ||= chrome.storage.sync.get(null).then((now) => ({ ...now, ...Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.oldValue])) }));
  clearTimeout(rest);
  rest = setTimeout(() => {
    // This burst's snapshot goes with its own write: a later burst may start before the queue gets here.
    const left = before;
    before = null;
    serial(async () => {
      const was = await left;
      const [now, { lookHistory }] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get('lookHistory')]);
      const at = Date.now();
      await chrome.storage.local.set({ lookHistory: GZ_HISTORY.add(GZ_HISTORY.add(GZ_HISTORY.entries(lookHistory), was, at), now, at) });
    });
  }, 4000);
});
chrome.runtime.onMessage.addListener((m, { url }) => {
  if (m !== 'clear-history' || !String(url).startsWith(chrome.runtime.getURL(''))) return;
  clearTimeout(rest);
  before = null;
  serial(() => chrome.storage.local.set({ lookHistory: [] }));
});

// Canvas on a school's own domain (canvas.school.edu) can't be matched by address. lib/detect.js sees Canvas's
// stylesheet in the page and asks here: Glaze goes into that page now, and onto its host for good, so the next
// pages are themed from the first paint as on *.instructure.com. The hosts are also kept in storage.local: not
// every browser honors persistAcrossSessions, and an update may clear them or change Glaze's file list.
const glaze = () => chrome.runtime.getManifest().content_scripts[0].js; // the one list, in the manifest
const script = (id) => ({ id, matches: [id], js: glaze(), runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
// Storage and registration change one at a time: two tabs can report the same host together.
let queue = Promise.resolve();
const serial = (f) => (queue = queue.then(f).catch(console.warn));
const ensure = async () => {
  const { canvas = [] } = await chrome.storage.local.get('canvas');
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const todo = canvas.filter((id) => !have.has(id));
  if (todo.length) await chrome.scripting.registerContentScripts(todo.map(script));
};
chrome.runtime.onInstalled.addListener(() => serial(async () => { await chrome.scripting.unregisterContentScripts(); await ensure(); }));
chrome.runtime.onStartup.addListener(() => serial(ensure));
chrome.runtime.onMessage.addListener((m, { tab, frameId, url }) => {
  if (m !== 'canvas' || frameId !== 0 || !tab) return;
  // The page lacks Glaze (the detector checked), so inject whatever the host's registration says.
  chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: glaze(), injectImmediately: true }).catch(console.warn);
  const { protocol, hostname } = new URL(url);
  const id = `${protocol}//${hostname}/*`;
  serial(async () => {
    const { canvas = [] } = await chrome.storage.local.get('canvas');
    if (!canvas.includes(id)) await chrome.storage.local.set({ canvas: [...canvas, id] });
    await ensure();
  });
});

// Code on demand (content.js need()): a file the first content script leaves out runs in the frame that asks, when
// it asks. Only these files, and only into a frame of a tab Glaze already runs in (Chrome reports which).
const SAFARI = new URL(chrome.runtime.getURL('')).protocol === 'safari-web-extension:';
const LOADABLE = new Set(['lib/zip.js', 'lib/drafts.js', 'lib/gradecalc.js', 'features/grades.js', 'features/schedule.js', 'i18n/de.js', 'i18n/es.js', 'i18n/fr.js', 'i18n/nl.js', 'i18n/pt-BR.js', 'lib/cards.js', 'features/cards.js']);
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type !== 'glaze:load') return;
  const files = Array.isArray(m.files) ? m.files : [];
  if (sender.id !== chrome.runtime.id || !sender.tab || !Number.isInteger(sender.frameId) || !files.length || !files.every((f) => LOADABLE.has(f))) {
    reply({ ok: false, error: 'not loadable' });
    return;
  }
  // The document that asked, where the browser names it (Chrome): one that has since navigated away gets nothing.
  // Without a documentId, the frame, after asking it whether it still holds the document that asked (content.js's
  // docId, in Glaze's own world there). A navigation between that answer and the injection is not caught.
  const target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId] };
  const same = sender.documentId ? Promise.resolve(true)
    : chrome.scripting.executeScript({ target, func: (doc) => globalThis.__gzDoc === doc, args: [String(m.doc)] }).then((r) => r?.[0]?.result !== false);
  same.then((yes) => {
    if (!yes) throw new Error('the frame holds another document now');
    return chrome.scripting.executeScript({ target, files, injectImmediately: true });
  }).then((results) => {
    // Every loadable file ends on a value (its module, its catalogue); a file that threw leaves none. Safari's results
    // for injected files aren't measured here, so there content.js's own check (is the module there?) decides.
    const r = results?.[0];
    if (r?.error) throw new Error(r.error.message || String(r.error));
    if (!SAFARI && r?.result == null) throw new Error('did not finish');
    reply({ ok: true });
  }).catch((e) => reply({ ok: false, error: String(e?.message || e) }));
  return true; // the reply comes once the files have run
});

// Safari wakes its containing app for a silent update check; Chrome never enters this gate.
if (new URL(chrome.runtime.getURL('')).protocol === 'safari-web-extension:') {
  (async () => {
    const now = Date.now();
    const { safariUpdateCheckAt = 0 } = await chrome.storage.local.get('safariUpdateCheckAt');
    if (now - safariUpdateCheckAt < 24 * 60 * 60 * 1000) return;
    // Record the attempt first, so native or network failures cannot cause repeated wakeups.
    await chrome.storage.local.set({ safariUpdateCheckAt: now });
    await chrome.runtime.sendNativeMessage('io.frostdev.Glaze', { type: 'check-updates' });
  })().catch(() => {});
}

// Signed URLs come only from the active content script's Canvas API; bytes never pass through the page.
// Acknowledgements bound Chrome's JSON message queue; disconnect aborts both fetch and reader.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'canvas-zip') return;
  let origin;
  try {
    if (!GZ_DOWNLOAD.sender(port.sender, chrome.runtime.id)) return port.disconnect();
    origin = new URL(port.sender.url);
  } catch { return port.disconnect(); }
  // Production has HTTPS hosts only. The explicit localhost permission exists only in scratch builds.
  const dev = origin.hostname === 'localhost' && chrome.runtime.getManifest().host_permissions.includes('http://localhost/*') ? origin.origin : '';
  if (!GZ_DOWNLOAD.url(origin.href, dev)) return port.disconnect();
  const ready = chrome.storage.local.get('canvas').then(({ canvas = [] }) => {
    return !!dev || origin.hostname === 'instructure.com' || origin.hostname.endsWith('.instructure.com') || canvas.includes(`${origin.protocol}//${origin.hostname}/*`);
  }).catch(() => false);
  const ctl = new AbortController();
  let used = 0, busy = false, ack = null, stall = 0;
  // An idle connection is not a download: fail a stalled fetch/stream after 45 seconds.
  const fresh = () => { clearTimeout(stall); stall = setTimeout(() => { ctl.abort(); ack?.(); port.disconnect(); }, 45000); };
  const send = (m) => { if (!ctl.signal.aborted) port.postMessage(m); };
  port.onDisconnect.addListener(() => { clearTimeout(stall); ctl.abort(); ack?.(); });
  port.onMessage.addListener((m) => {
    if (m?.type === 'ping') { send({ type: 'ping' }); return; }
    if (m?.type === 'ack') { ack?.(); ack = null; return; }
    if (m?.type !== 'file' || busy) return;
    busy = true;
    (async () => {
      if (!await ready) throw new Error('sender');
      fresh();
      const url = GZ_DOWNLOAD.url(m.url, dev);
      if (!url) throw new Error('url');
      const r = await fetch(url, { credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: ctl.signal });
      if (!r.ok || !GZ_DOWNLOAD.url(r.url, dev)) throw new Error('response');
      GZ_DOWNLOAD.bytes(used, Number(r.headers.get('content-length') || 0));
      const reader = r.body?.getReader();
      if (reader) try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          fresh();
          used = GZ_DOWNLOAD.bytes(used, value.length);
          for (let at = 0; at < value.length; at += 65536) {
            const frame = value.subarray(at, at + 65536);
            let raw = '';
            for (let i = 0; i < frame.length; i += 16384) raw += String.fromCharCode(...frame.subarray(i, i + 16384));
            await new Promise((resolve) => { ack = resolve; send({ type: 'chunk', data: btoa(raw) }); });
            ctl.signal.throwIfAborted();
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
      send({ type: 'done' });
    })().catch((e) => {
      send({ type: 'error', code: ['limit', 'url', 'sender', 'response'].includes(e.message) ? e.message : 'network' });
    }).finally(() => { clearTimeout(stall); busy = false; });
  });
});
