// Google Drive's files for Documents and Writer, with drive.file only: Glaze reaches the files it made and the ones the
// student picks in Google's Picker (lib/google.js pick), nothing else. Open from Drive brings a picked file in as its
// kind's import does (a Google Doc, Sheet or Slides deck exported as .docx, .xlsx or .pptx); Save to Drive puts a
// document's exported file in My Drive, or a paper as a Google Doc, and remembers it on the record (drive: { id, as }) so a
// later save updates that file while it is still there, Glaze may edit it and it is still that type, else makes a new one.
// The Drive v3 client (create) runs in the worker, where the token is (lib/google.js token; drop forgets one Drive refused):
// requests carry no cookies, follow no redirect, skip the cache, and after a 401 ask once more with a fresh token. A file
// larger than its kind opens (lib/doc-kinds.js max) is refused before its bytes come, by the metadata's size where Drive gives
// the file's own (not a Google file's, whose export differs), else as they stream. Failures are fixed reasons (WHY).
// Pages reach the worker over a port each request (PORT: serve, client), the bytes in base64 chunks, each acknowledged, so
// neither side runs ahead; a page pings while it waits so the worker stays up through a long upload. No page here reaches
// the browser's tab or window APIs (test/frame-tabs.test.js): writer.html and Documents run framed in a school's page.
// The pages' part (page): From Google Drive beside Documents' Import and in the paper's ⋯ menu, Save to Google Drive in a
// Documents card's ⋯ menu, each only while Drive is connected.
// Classic script for the worker and the pages; module.exports for node.
var GZ_DRIVE = globalThis.GZ_DRIVE || (() => {
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const PORT = 'glaze:drive';
  const CHUNK = 384 << 10; // 512 KB as base64, as lib/doc-files.js sends (Safari's message size is the tightest)
  // What Glaze reads of a file (files.get's fields mask), and of one it saved.
  const META = 'id,name,mimeType,size,trashed,capabilities(canEdit,canDownload)';
  const SAVED = 'id,name,mimeType';
  const DOC = 'application/vnd.google-apps.document';
  // Google's own files, exported as the kind that opens them; the extension a kind's file takes.
  const GOOGLE = { [DOC]: 'paper', 'application/vnd.google-apps.spreadsheet': 'sheet', 'application/vnd.google-apps.presentation': 'slides' };
  const EXT = { paper: '.docx', sheet: '.xlsx', pdf: '.pdf', slides: '.pptx' };
  // Drive's 403 reasons that mean try later, and those that mean the Drive is full (its "Resolve errors" guide).
  const BUSY = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'dailyLimitExceeded', 'sharingRateLimitExceeded']);
  const FULL = new Set(['storageQuotaExceeded', 'activeItemCreationLimitExceeded']);
  // Every reason a request ends with: the sign-in's (lib/google.js), the Picker's, Drive's, the port's.
  const WHY = ['off', 'connect', 'setup', 'account', 'auth', 'permission', 'cancel', 'scope', 'browser', 'unsupported', 'state', 'picker', 'offline',
    'network', 'missing', 'denied', 'busy', 'quota', 'size', 'type', 'bad', 'sender'];
  const ID = /^[\w-]{1,256}$/, MIME = /^[\w.+-]{1,127}\/[\w.+-]{1,127}$/;
  class Fail extends Error { constructor(why) { super(why); this.why = why; } }
  const kinds = () => globalThis.GZ_DOC_KINDS || require('./doc-kinds.js');
  const q = (o) => new URLSearchParams(o).toString();

  const b64 = (bytes) => {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => {
    if (typeof s !== 'string' || s.length > 4 * Math.ceil(CHUNK / 3)) throw new Fail('bad');
    try {
      if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
      const bin = atob(s), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch { throw new Fail('bad'); }
  };
  const join = (parts, n) => { const out = new Uint8Array(n); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

  // A files.get reply for id, as Glaze asked for it.
  const valid = (m, id) => !!m && typeof m === 'object' && m.id === id && typeof m.name === 'string' && m.name.length > 0 && m.name.length <= 1000
    && typeof m.mimeType === 'string' && MIME.test(m.mimeType) && (m.size === undefined || (typeof m.size === 'string' && /^\d{1,15}$/.test(m.size)));
  // How a picked file comes in: its kind among those the page takes (takes), the name and type it arrives with, the export a
  // Google file needs (as), and the largest it may be. A file whose name has no extension opens by its type.
  const plan = (m, takes) => {
    const K = kinds(), KS = K.KINDS;
    let kind = GOOGLE[m.mimeType] || null, name = m.name, mime = m.mimeType, as = null;
    if (kind) { as = KS[kind].mime; mime = as; name += EXT[kind]; }
    else if (!(kind = K.forFile(m.name))) {
      kind = Object.keys(KS).find((k) => KS[k].mime === m.mimeType) || null;
      if (kind) name += EXT[kind];
    }
    if (!kind || !takes.includes(kind)) throw new Fail('type');
    const max = KS[kind].max, size = as || m.size === undefined ? null : Number(m.size);
    if (size !== null && size > max) throw new Fail('size');
    return { kind, name, mime, size, as, max };
  };

  // env: { fetch, token({ interactive }) (lib/google.js token), drop(token) (forget one Drive answered 401 to), account() (the
  // connected account, lib/google.js account: one client serves one request, which stops as 'connect' if Drive is
  // connected to another account or none before any of its calls), boundary() }
  const create = (env) => {
    const bound = env.account ? Promise.resolve().then(env.account).catch(() => null) : null;
    const send = (url, init) => env.fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const reason = async (r) => {
      const j = await r.json().catch(() => null);
      const why = Array.isArray(j?.error?.errors) ? j.error.errors.map((e) => e?.reason) : [];
      if (r.status === 401) return 'auth';
      if (r.status === 404) return 'missing';
      if (r.status === 429 || r.status >= 500) return 'busy';
      if (r.status === 403) return why.some((x) => BUSY.has(x)) ? 'busy' : why.some((x) => FULL.has(x)) ? 'quota' : 'denied';
      return 'bad';
    };
    // Every request is something the student pressed: the token may ask them to sign in.
    const call = async (url, init = {}) => {
      for (let i = 0; ; i++) {
        let t, r;
        if (bound) {
          const was = await bound, now = await Promise.resolve().then(env.account).catch(() => null);
          if (!was || now !== was) throw new Fail('connect');
        }
        try { t = await env.token({ interactive: true }); } catch (e) { throw new Fail(WHY.includes(e?.why) ? e.why : 'auth'); }
        try { r = await send(url, { ...init, headers: { authorization: `Bearer ${t}`, ...init.headers } }); } catch { throw new Fail('network'); }
        if (r.ok) return r;
        if (r.status === 401 && i === 0) {
          r.body?.cancel().catch(() => {});
          await Promise.resolve().then(() => env.drop?.(t)).catch(() => {});
          continue;
        }
        throw new Fail(await reason(r));
      }
    };
    const meta = async (id) => {
      if (typeof id !== 'string' || !ID.test(id)) throw new Fail('bad');
      const m = await (await call(`${API}/${id}?${q({ fields: META, supportsAllDrives: 'true' })}`)).json().catch(() => null);
      if (!valid(m, id)) throw new Fail('bad');
      return m;
    };
    // A picked file's bytes, told to on: head({ kind, name, mime, size }) once its plan stands, then bytes(piece, total) as
    // each piece comes (awaited: the caller sets the pace). → the bytes in all.
    const open = async (id, takes, on = {}) => {
      const p = plan(await meta(id), takes);
      await on.head?.({ kind: p.kind, name: p.name, mime: p.mime, size: p.size });
      const r = await call(p.as ? `${API}/${id}/export?${q({ mimeType: p.as })}` : `${API}/${id}?${q({ alt: 'media', supportsAllDrives: 'true' })}`);
      const reader = r.body?.getReader();
      if (!reader) throw new Fail('bad');
      let total = 0;
      try {
        if (Number(r.headers.get('content-length')) > p.max) throw new Fail('size');
        for (;;) {
          let x;
          try { x = await reader.read(); } catch { throw new Fail('network'); }
          if (x.done) break;
          total += x.value.length;
          if (total > p.max) throw new Fail('size');
          await on.bytes?.(x.value, total);
        }
      } catch (e) { reader.cancel().catch(() => {}); throw e; }
      return total;
    };
    const multipart = (meta, mime, bytes) => {
      const b = `glaze-${env.boundary ? env.boundary() : crypto.randomUUID()}`, enc = new TextEncoder();
      const head = enc.encode(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`);
      const tail = enc.encode(`\r\n--${b}--`);
      return { type: `multipart/related; boundary=${b}`, body: join([head, bytes, tail], head.length + bytes.length + tail.length) };
    };
    // A document's file into My Drive: as itself, or as a Google Doc (a paper's .docx, Drive converting it). id: the file
    // saved last time, updated only once it is confirmed there, not in Trash, editable and still that type; one Drive no
    // longer has or no longer lets Glaze change gives way to a new file (fresh). → { id, fresh }
    const save = async ({ name, mime, bytes, as = 'file', id = null }) => {
      const K = kinds();
      if (typeof name !== 'string' || !name || name.length > 255 || typeof mime !== 'string' || !MIME.test(mime) || !(bytes instanceof Uint8Array) || !bytes.length
        || bytes.length > K.FILE || !['file', 'doc'].includes(as) || (as === 'doc' && mime !== K.KINDS.paper.mime) || (id != null && (typeof id !== 'string' || !ID.test(id)))) throw new Fail('bad');
      const target = as === 'doc' ? DOC : mime;
      let to = null;
      if (id) {
        try {
          const m = await meta(id);
          if (m.trashed !== true && m.capabilities?.canEdit !== false && m.mimeType === target) to = id;
        } catch (e) { if (e.why !== 'missing' && e.why !== 'denied') throw e; }
      }
      const { type, body } = multipart(to ? {} : { name: as === 'doc' ? name.replace(/\.docx$/i, '') : name, mimeType: target }, mime, bytes);
      const r = await call(to ? `${UPLOAD}/${to}?${q({ uploadType: 'multipart', fields: SAVED, supportsAllDrives: 'true' })}` : `${UPLOAD}?${q({ uploadType: 'multipart', fields: SAVED })}`,
        { method: to ? 'PATCH' : 'POST', headers: { 'content-type': type }, body });
      const j = await r.json().catch(() => null);
      if (typeof j?.id !== 'string' || !ID.test(j.id) || (to && j.id !== to)) throw new Fail('bad');
      return { id: j.id, fresh: !!id && !to };
    };
    return { meta, open, save };
  };

  // ---- the port, worker side: one request a port. page → { op: 'open', id, takes } then { op: 'more' } after each chunk;
  // or { op: 'save', key, name, mime, size, as } then { op: 'chunk', data } after each more, and { op: 'end' }; { op: 'ping' }
  // any time. worker → open: { type: 'file', kind, name, mime, size }, { type: 'chunk', data }…, { type: 'end', size };
  // save: { type: 'more' }…, { type: 'saved', id, fresh }; either: { type: 'fail', why }.
  // o: { drive (create), allowed() (the sender, checked again before the request), record: { get(key) → { drive } or null
  // when there is no such document, set(key, drive) } }
  const serve = (port, { drive, allowed = async () => true, record = null }) => {
    let gone = false, waiting = null, begun = false;
    const post = (m) => { if (gone) return; try { port.postMessage(m); } catch { gone = true; } };
    const next = () => new Promise((ok, no) => { if (gone) no(new Fail('cancel')); else waiting = { ok, no }; });
    port.onDisconnect.addListener(() => { gone = true; const w = waiting; waiting = null; w?.no(new Fail('cancel')); });
    const open = async (m) => {
      const KS = kinds().KINDS;
      if (!Array.isArray(m.takes) || !m.takes.length || m.takes.length > 8 || !m.takes.every((k) => typeof k === 'string' && Object.hasOwn(KS, k))) throw new Fail('bad');
      let parts = [], held = 0;
      const flush = async () => {
        const c = join(parts, held);
        parts = []; held = 0;
        post({ type: 'chunk', data: b64(c) });
        if ((await next()).op !== 'more') throw new Fail('bad');
      };
      const size = await drive.open(m.id, m.takes, {
        head: (h) => post({ type: 'file', ...h }),
        bytes: async (b) => {
          for (let i = 0; i < b.length;) {
            const k = Math.min(CHUNK - held, b.length - i);
            parts.push(b.subarray(i, i + k)); held += k; i += k;
            if (held === CHUNK) await flush();
          }
          if (gone) throw new Fail('cancel');
        },
      });
      if (held) await flush();
      return { type: 'end', size };
    };
    const save = async (m) => {
      if (typeof m.key !== 'string' || !m.key || m.key.length > 400 || typeof m.name !== 'string' || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > kinds().FILE
        || !['file', 'doc'].includes(m.as)) throw new Fail('bad');
      const rec = record ? await record.get(m.key) : null;
      if (!rec) throw new Fail('missing');
      const parts = [];
      let got = 0;
      post({ type: 'more' });
      for (;;) {
        const a = await next();
        if (a.op === 'end') break;
        if (a.op !== 'chunk') throw new Fail('bad');
        const b = unb64(a.data);
        got += b.length;
        if (got > m.size) throw new Fail('bad');
        parts.push(b);
        post({ type: 'more' });
      }
      if (got !== m.size) throw new Fail('bad');
      const was = rec.drive?.as === m.as && typeof rec.drive.id === 'string' ? rec.drive.id : null;
      const r = await drive.save({ name: m.name, mime: m.mime, bytes: join(parts, got), as: m.as, id: was });
      // Saved even if the record can't take the id (deleted meanwhile): the next save makes a new file.
      await Promise.resolve().then(() => record.set(m.key, { id: r.id, as: m.as })).catch(() => {});
      return { type: 'saved', id: r.id, fresh: r.fresh };
    };
    port.onMessage.addListener((m) => {
      if (m?.op === 'ping') return;
      if (begun) { const w = waiting; waiting = null; w?.ok(m && typeof m === 'object' ? m : {}); return; }
      begun = true;
      (async () => {
        if (!await allowed()) throw new Fail('sender');
        if (m?.op === 'open') return open(m);
        if (m?.op === 'save') return save(m);
        throw new Fail('bad');
      })().then(post, (e) => post({ type: 'fail', why: e instanceof Fail ? e.why : 'network' }));
    });
  };

  // ---- the port, page side: open(id, takes, progress) → a File; save({ key, name, mime, bytes, as }, progress) →
  // { id, fresh }. progress({ done, total }) as bytes go.
  const client = (connect = () => chrome.runtime.connect({ name: PORT })) => {
    const session = (first, step) => new Promise((ok, no) => {
      let port, over = false, ping = null;
      const end = (f, v) => { if (over) return; over = true; clearInterval(ping); try { port.disconnect(); } catch { /* gone */ } f(v); };
      try { port = connect(); } catch { no(new Fail('network')); return; }
      port.onDisconnect.addListener(() => end(no, new Fail('network')));
      port.onMessage.addListener((m) => {
        if (over) return;
        if (m?.type === 'fail') { end(no, new Fail(WHY.includes(m.why) ? m.why : 'network')); return; }
        try { step(m || {}, (x) => port.postMessage(x), (v) => end(ok, v)); } catch (e) { end(no, e instanceof Fail ? e : new Fail('bad')); }
      });
      const beat = () => { try { port.postMessage({ op: 'ping' }); } catch { /* gone */ } };
      ping = setInterval(beat, 15000);
      try { port.postMessage(first); } catch { end(no, new Fail('network')); }
    });
    const open = (id, takes, progress = null) => {
      let head = null, got = 0;
      const parts = [];
      return session({ op: 'open', id, takes }, (m, send, done) => {
        if (m.type === 'file' && !head) { head = m; progress?.({ done: 0, total: m.size || 0 }); }
        else if (m.type === 'chunk' && head) {
          const b = unb64(m.data);
          parts.push(b); got += b.length;
          progress?.({ done: got, total: Math.max(head.size || 0, got) });
          send({ op: 'more' });
        } else if (m.type === 'end' && head) done(new File(parts, String(head.name), { type: typeof head.mime === 'string' ? head.mime : '' }));
      });
    };
    const save = ({ key, name, mime, bytes, as }, progress = null) => {
      let at = 0;
      return session({ op: 'save', key, name, mime, size: bytes.length, as }, (m, send, done) => {
        if (m.type === 'more') {
          if (at >= bytes.length) { send({ op: 'end' }); return; }
          const c = bytes.subarray(at, at + CHUNK);
          at += c.length;
          send({ op: 'chunk', data: b64(c) });
          progress?.({ done: at, total: bytes.length });
        } else if (m.type === 'saved') done({ type: 'saved', id: m.id, fresh: m.fresh === true });
      });
    };
    return { open, save };
  };

  // ---- the pages: the entries show while the worker says Drive is connected, asked as the page loads and again when the
  // connection changes (storage.local google, lib/google.js).
  const page = (() => {
    if (typeof document === 'undefined' || !globalThis.chrome?.runtime?.sendMessage) return null;
    // A framed Documents is answered once its document has claimed its pass: until then 'sender', asked again after 0.5,
    // 1, 2, 4 and 8 seconds.
    let connected = false, asking = null;
    const shown = new Set();
    const ask = (n = 0) => (asking ||= chrome.runtime.sendMessage({ type: 'glaze:drive', op: 'status' }).catch(() => null).then((r) => {
      asking = null;
      if (r?.why === 'sender' && n < 5) setTimeout(() => ask(n + 1), 500 * 2 ** n);
      const on = r?.connected === true;
      if (on !== connected) { connected = on; for (const f of shown) try { f(); } catch (e) { console.error(e); } }
    }));
    ask();
    chrome.storage?.onChanged?.addListener((c, where) => { if (where === 'local' && 'google' in c) ask(); });
    const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return 'en'; } })();
    const t = (k, v) => (globalThis.GZ_WRITER_FRAME?.t ? GZ_WRITER_FRAME.t(k, v) : GZ_I18N.t(k, v, locale));
    // What a page says of a reason, in English (the caller translates); nothing for a Picker the student closed.
    const SIGN_IN = new Set(['off', 'connect', 'setup', 'account', 'auth', 'permission', 'scope', 'browser', 'unsupported', 'state']);
    const SAYS = { missing: "Glaze can't reach this file in Google Drive.", denied: "Glaze can't reach this file in Google Drive.", busy: 'Google Drive is busy. Try again in a moment.',
      quota: 'Your Google Drive is full.', type: 'That file could not be read.', size: 'That file is too large.' };
    const says = (why) => (why === 'cancel' ? '' : SAYS[why] || (SIGN_IN.has(why) ? 'Connect Google Drive again in Settings.' : "Couldn't reach Google Drive. Try again in a moment."));
    const pick = async () => {
      const r = await chrome.runtime.sendMessage({ type: 'glaze:google', op: 'pick' }).catch(() => null);
      if (!r?.ok || !Array.isArray(r.files)) throw new Fail(WHY.includes(r?.why) ? r.why : 'network');
      return r.files;
    };
    const fail = (e) => (e instanceof Fail ? e.why : (console.error(e), 'network'));

    // Documents (papers.js): From Google Drive in the toolbar, before Import; Save to Google Drive in each card's ⋯ menu.
    // D: GZ_DOCUMENTS; bring(files): the page's import, as files dropped on it; say(text): its status line.
    const home = (D, { bring, say }) => {
      let items = null, busy = false;
      const fromDrive = async () => {
        if (busy) return;
        busy = true;
        try {
          const all = await pick(), files = all.slice(0, 20), got = [], K = GZ_DOC_KINDS;
          let why = '';
          for (const f of files) {
            const report = K.progress((p) => { const w = !p.end && !p.failed && K.said(p, 'paper'); if (w) say(t(...w)); }, ['read']);
            try { got.push(await client().open(f.id, K.taking(), (p) => report({ stage: 'read', ...p }))); report.end(); } catch (e) { report.fail(e); why ||= says(fail(e)); }
          }
          say('');
          if (got.length) await bring(got);
          const left = [why && t(why), all.length > files.length && t('Choose up to 20 files at a time.')].filter(Boolean).join(' ');
          if (left) say(left);
        } catch (e) { const w = says(fail(e)); if (w) say(t(w)); } finally { busy = false; }
      };
      // A paper goes as a Word file or a Google Doc, the one it went as last time offered first; another kind as its file.
      const choose = (first) => new Promise((ok) => {
        const dlg = document.createElement('dialog');
        dlg.className = 'pop gp-menu gd-menu gd-drive';
        dlg.setAttribute('data-open', '');
        dlg.setAttribute('aria-label', t('Save to Google Drive'));
        const pick1 = (as, text) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.as = as; b.textContent = t(text); b.addEventListener('click', () => dlg.close(as)); return b; };
        const buttons = [pick1('file', 'Word file'), pick1('doc', 'Google Doc')];
        dlg.append(...buttons);
        dlg.addEventListener('close', () => { dlg.remove(); ok(['file', 'doc'].includes(dlg.returnValue) ? dlg.returnValue : null); });
        dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
        document.body.append(dlg);
        dlg.showModal();
        buttons.find((b) => b.dataset.as === first).focus();
      });
      const toDrive = async (doc) => {
        if (busy) return;
        busy = true;
        try {
          const key = `${GZ_WRITER_PAPERS.KEYS.PAPER}${doc.key}`, rec = (await chrome.storage.local.get(key))[key];
          const as = doc.kind === 'paper' ? await choose(rec?.drive?.as === 'doc' ? 'doc' : 'file') : 'file';
          if (!as) return;
          say(t('Saving…'));
          const f = await D.export(doc.key).catch(() => null);
          if (!f) { say(t('That file could not be read.')); return; }
          await client().save({ key: doc.key, name: f.name, mime: f.mime, bytes: f.bytes, as });
          say(t('Saved to Google Drive.'));
        } catch (e) { say(t(says(fail(e)) || 'Not saved. Try again in a moment.')); } finally { busy = false; }
      };
      const show = () => {
        if (connected && !items) items = [D.item('toolbar', t('From Google Drive'), () => { fromDrive(); }), D.item('card', t('Save to Google Drive'), (doc) => { if (doc) toDrive(doc); })];
        else if (!connected && items) { for (const x of items) x?.remove(); items = null; }
      };
      shown.add(show);
      show();
    };

    // The paper's ⋯ menu (writer-paper.js), beside Import…: [{ label, run }] while connected. The picked file goes where a
    // file brought to the paper goes (bring: on an assignment writer-import.js's card, else a Word file's import); a paper
    // in Writer takes Word files and the kinds that open there (writer-kinds.js).
    const items = (api, bring) => (connected ? [{ label: t('From Google Drive'), run: async () => {
      try {
        const [f] = await pick();
        if (!f) return;
        const takes = location.pathname.endsWith('/writer.html') ? ['paper', ...(globalThis.GZ_WRITER_KINDS?.opens?.() || [])] : ['paper'];
        api?.notify?.('Reading…');
        bring(await client().open(f.id, takes));
      } catch (e) { const w = says(fail(e)); if (w) api?.notify?.(w); }
    } }] : []);
    return { home, items, connected: () => connected };
  })();

  return { API, UPLOAD, PORT, CHUNK, META, DOC, WHY, Fail, b64, unb64, plan, create, serve, client, page };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE;
