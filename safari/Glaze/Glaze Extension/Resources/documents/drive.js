// Google Drive's files for Documents and Writer, with drive.file only: Glaze reaches the files it made and the ones the
// student picks in Google's Picker (background/google.js pick), nothing else. Open from Drive brings a picked file in as its
// kind's import does (a Google Doc, Sheet or Slides deck exported as .docx, .xlsx or .pptx); Save to Drive puts a
// document's exported file in My Drive, or a paper as a Google Doc, and remembers it on the record (drive: { id, as }) so a
// later save updates that file while it is still there, Glaze may edit it and it is still that type, else makes a new one.
// The Drive v3 client (create) runs in the worker, where the token is (background/google.js token; its drop forgets one Drive refused):
// requests carry no cookies, follow no redirect, skip the cache, and after a 401 ask once more with a fresh token. A file
// larger than its kind opens (documents/doc-kinds.js max) is refused before its bytes come, by the metadata's size where Drive gives
// the file's own (not a Google file's, whose export differs), else as they stream. Failures are fixed reasons (WHY).
// Pages reach the worker over a port each request (PORT: serve, client), the bytes in base64 chunks, each acknowledged, so
// neither side runs ahead; a page pings while it waits so the worker stays up through a long upload. No page here reaches
// the browser's tab or window APIs (test/frame-tabs.test.js): writer.html and Documents run framed in a school's page.
// The pages' part (page): From Google Drive beside Documents' Import and in the paper's ⋯ menu, Save to Google Drive in a
// Documents card's ⋯ menu, each only while Drive is connected, From Google Drive only where Google's Picker works (the
// worker's status picker: not Safari's app sign-in yet).
// Classic script for the worker and the pages; module.exports for node.
var GZ_DRIVE = globalThis.GZ_DRIVE || (() => {
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const CHANGES = 'https://www.googleapis.com/drive/v3/changes';
  const PORT = 'glaze:drive';
  const CHUNK = 384 << 10; // 512 KB as base64, as documents/doc-files.js sends (Safari's message size is the tightest)
  // What Glaze reads of a file (files.get's fields mask), and of one it saved.
  const META = 'id,name,mimeType,size,trashed,capabilities(canEdit,canDownload)';
  const SAVED = 'id,name,mimeType';
  // What Sync to Google Drive (documents/drive-sync.js) reads of a file: where it is, whether it is in Trash, Glaze's own properties on it,
  // and its revisions (version: every change; headRevisionId: every new content).
  const SYNC = 'id,name,mimeType,parents,trashed,explicitlyTrashed,appProperties,headRevisionId,version,size';
  // An upload larger than this goes resumable: Drive's guide gives multipart "5 MB or less".
  const SMALL = 5 << 20;
  // A resumable session's chunks (and Sync's ranged downloads, documents/drive-sync.js): multiples of 256 KiB, as Drive's
  // guide asks, max at most; halved after one slower than slow ms or cut short by the worker stopping, doubled after one
  // quicker than fast ms, so each request ends well inside the 30 s a worker may wait for an answer, even on a slow link.
  const STEP = { min: 256 << 10, max: 8 << 20, fast: 5000, slow: 15000 };
  const pace = (step, ms) => (ms > STEP.slow ? Math.max(STEP.min, Math.floor(step / 2 / STEP.min) * STEP.min) : ms < STEP.fast ? Math.min(STEP.max, step * 2) : step);
  const digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const DOC = 'application/vnd.google-apps.document';
  // Google's own files, exported as the kind that opens them; the extension a kind's file takes.
  const GOOGLE = { [DOC]: 'paper', 'application/vnd.google-apps.spreadsheet': 'sheet', 'application/vnd.google-apps.presentation': 'slides' };
  const EXT = { paper: '.docx', sheet: '.xlsx', pdf: '.pdf', slides: '.pptx' };
  // Drive's 403 reasons that mean try later, and those that mean the Drive is full (its "Resolve errors" guide).
  const BUSY = new Set(['userRateLimitExceeded', 'rateLimitExceeded', 'dailyLimitExceeded', 'sharingRateLimitExceeded']);
  const FULL = new Set(['storageQuotaExceeded', 'activeItemCreationLimitExceeded']);
  // Every reason a request ends with: the sign-in's (background/google.js), the Picker's, Drive's, the port's.
  // export: a Google file larger than Drive exports (its 10 MB).
  const WHY = ['off', 'connect', 'setup', 'account', 'auth', 'permission', 'cancel', 'scope', 'browser', 'unsupported', 'state', 'picker', 'offline',
    'network', 'missing', 'denied', 'busy', 'quota', 'size', 'export', 'type', 'bad', 'sender'];
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
  // A Drive name as one any file can have (writer/writer-submit.js asIsName, what Blackboard's upload takes): Drive's may hold
  // a slash (a date in a title), a backslash or a control character, each made _ as a browser's download does, and run past
  // 255 characters, cut before its extension.
  const fileName = (name) => {
    let n = String(name).replace(/[/\\\u0000-\u001f\u007f]/g, '_');
    if (/^\.*$/.test(n.trim())) n = `_${n}`;
    const all = [...n];
    if (all.length > 255) { const ext = /\.[^.]{1,16}$/.exec(n)?.[0] || ''; n = all.slice(0, 255 - [...ext].length).join('') + ext; }
    return n;
  };

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

  // env: { fetch, token({ interactive }) (background/google.js token), drop(token) (background/google.js drop: forget one Drive answered 401 to), account() (the
  // connected account, background/google.js account: one client serves one request, which stops as 'connect' if Drive is
  // connected to another account or none before any of its calls), allowed() (the current sender), boundary(),
  // interactive (default true: a request the student pressed may ask them to sign in; Sync's never does), now (the clock a
  // chunk is timed by) }
  const create = (env) => {
    const clock = env.now || Date.now;
    const bound = env.account ? Promise.resolve().then(env.account).catch(() => null) : null;
    const still = async () => {
      if (bound) {
        const was = await bound, now = await Promise.resolve().then(env.account).catch(() => null);
        if (!was || now !== was) throw new Fail('connect');
      }
      if (env.allowed && !await env.allowed()) throw new Fail('sender');
    };
    const send = (url, init) => env.fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    const reason = async (r) => {
      const j = await r.json().catch(() => null);
      const errs = Array.isArray(j?.error?.errors) ? j.error.errors : [], why = errs.map((e) => e?.reason);
      // An export past Drive's 10 MB: 400 badRequest at export.size now, 403 exportSizeLimitExceeded before (test/fixtures/drive/v3.js).
      if ((r.status === 400 || r.status === 403) && errs.some((e) => e?.location === 'export.size' || e?.reason === 'exportSizeLimitExceeded')) return 'export';
      if (r.status === 401) return 'auth';
      if (r.status === 404) return 'missing';
      if (r.status === 429 || r.status >= 500) return 'busy';
      if (r.status === 403) return why.some((x) => BUSY.has(x)) ? 'busy' : why.some((x) => FULL.has(x)) ? 'quota' : 'denied';
      return 'bad';
    };
    // Every request is something the student pressed: the token may ask them to sign in.
    // init.signal: the caller's cancel, which stops the request where it stands (raw, open). also: statuses handed back as
    // they are rather than as a reason (a resumable session's 308, and its 404 once expired).
    const call = async (url, init = {}, also = null) => {
      const halt = () => { if (init.signal?.aborted) throw new Fail('cancel'); };
      for (let i = 0; ; i++) {
        let t, r;
        halt();
        await still();
        try { t = await env.token({ interactive: env.interactive !== false }); } catch (e) { throw new Fail(WHY.includes(e?.why) ? e.why : 'auth'); }
        await still(); // a Disconnect while the token came: Calendar's grant may keep it valid
        halt();
        try { r = await send(url, { ...init, headers: { authorization: `Bearer ${t}`, ...init.headers } }); } catch { halt(); throw new Fail('network'); }
        if (r.ok || also?.includes(r.status)) return r;
        if (r.status === 401 && i === 0) {
          r.body?.cancel().catch(() => {});
          await Promise.resolve().then(() => env.drop?.(t)).catch(() => {});
          continue;
        }
        throw new Fail(await reason(r));
      }
    };
    const meta = async (id, signal = null) => {
      if (typeof id !== 'string' || !ID.test(id)) throw new Fail('bad');
      const m = await (await call(`${API}/${id}?${q({ fields: META, supportsAllDrives: 'true' })}`, { signal })).json().catch(() => null);
      if (!valid(m, id)) throw new Fail('bad');
      return m;
    };
    // A response's bytes to on.bytes(piece, total) as they come (awaited: the caller sets the pace), at most max of them.
    // signal: cancelling it cancels the body where it stands, a stalled read included.
    const pour = async (r, max, on, signal) => {
      const reader = r.body?.getReader();
      if (!reader) throw new Fail('bad');
      const stop = () => { reader.cancel().catch(() => {}); };
      signal?.addEventListener('abort', stop, { once: true });
      let total = 0;
      try {
        if (Number(r.headers.get('content-length')) > max) throw new Fail('size');
        for (;;) {
          if (signal?.aborted) throw new Fail('cancel');
          let x;
          try { x = await reader.read(); } catch { throw new Fail(signal?.aborted ? 'cancel' : 'network'); }
          if (signal?.aborted) throw new Fail('cancel');
          if (x.done) { await still(); break; }
          if (total + x.value.length > max) throw new Fail('size');
          // A network read can contain several port chunks. Recheck after each acknowledgement, so Disconnect
          // cannot release the rest of that read to the page merely because its fetch was already under way.
          for (let i = 0; i < x.value.length; i += CHUNK) {
            await still();
            if (signal?.aborted) throw new Fail('cancel');
            const b = x.value.subarray(i, i + CHUNK);
            total += b.length;
            await on.bytes?.(b, total);
          }
        }
      } catch (e) { reader.cancel().catch(() => {}); throw e; } finally { signal?.removeEventListener('abort', stop); }
      return total;
    };
    // A picked file's bytes, told to on: head({ kind, name, mime, size }) once its plan stands, then bytes(piece, total) as
    // each piece comes (awaited: the caller sets the pace); on.signal cancels it. → the bytes in all.
    const open = async (id, takes, on = {}) => {
      const p = plan(await meta(id, on.signal), takes);
      await on.head?.({ kind: p.kind, name: p.name, mime: p.mime, size: p.size });
      const r = await call(p.as ? `${API}/${id}/export?${q({ mimeType: p.as })}` : `${API}/${id}?${q({ alt: 'media', supportsAllDrives: 'true' })}`, { signal: on.signal });
      return pour(r, p.max, on, on.signal);
    };
    // Submit from Drive's download: any file as it is (an image, a zip, anything Blackboard takes), up to the 50 MB an
    // upload may be (documents/doc-kinds.js FILE), or a Google Doc, Sheet or deck exported as open() exports it. Other Google
    // types (forms, folders, shortcuts) and files Drive won't let be downloaded are refused. on: { head({ name, mime, size }),
    // bytes(piece, total), signal }. → the bytes in all.
    const raw = async (id, on = {}) => {
      const m = await meta(id, on.signal), kind = GOOGLE[m.mimeType] || null, max = kinds().FILE;
      if (!kind && m.mimeType.startsWith('application/vnd.google-apps.')) throw new Fail('type');
      if (m.capabilities?.canDownload === false) throw new Fail('denied');
      const as = kind ? kinds().KINDS[kind].mime : null, size = as || m.size === undefined ? null : Number(m.size);
      if (size !== null && size > max) throw new Fail('size');
      await on.head?.({ name: fileName(kind ? m.name + EXT[kind] : m.name), mime: as || m.mimeType, size });
      const r = await call(as ? `${API}/${id}/export?${q({ mimeType: as })}` : `${API}/${id}?${q({ alt: 'media', supportsAllDrives: 'true' })}`, { signal: on.signal });
      return pour(r, max, on, on.signal);
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
      // Sync's upload (put): multipart up to SMALL, else resumable.
      const j = await put({ id: to, meta: to ? {} : { name: as === 'doc' ? name.replace(/\.docx$/i, '') : name, mimeType: target }, mime, bytes, fields: SAVED, all: !!to });
      if (typeof j?.id !== 'string' || !ID.test(j.id) || (to && j.id !== to)) throw new Fail('bad');
      return { id: j.id, fresh: !!id && !to };
    };
    // ---- Sync to Google Drive's calls (documents/drive-sync.js): each → Drive's JSON answer, or bytes; Drive's errors as reasons (WHY).
    const json = async (r) => { const j = await r.json().catch(() => null); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Fail('bad'); return j; };
    const idOf = (id) => { if (typeof id !== 'string' || !ID.test(id)) throw new Fail('bad'); return id; };
    const JSON_TYPE = 'application/json; charset=UTF-8';
    // files.get: the fields sync reads.
    const file = async (id, fields = SYNC) => {
      const j = await json(await call(`${API}/${idOf(id)}?${q({ fields })}`));
      if (j.id !== id) throw new Fail('bad');
      return j;
    };
    // files.list in My Drive: q, a page of up to 1000. → { files, nextPageToken }
    const find = async (query, { fields = SYNC, pageToken = null, pageSize = 1000 } = {}) => {
      const j = await json(await call(`${API}?${q({ q: query, spaces: 'drive', pageSize: String(pageSize), fields: `nextPageToken,files(${fields})`, ...(pageToken && { pageToken }) })}`));
      if (!Array.isArray(j.files)) throw new Fail('bad');
      return j;
    };
    // changes.getStartPageToken → the token; changes.list from a token → { changes, nextPageToken | newStartPageToken }.
    const startToken = async () => {
      const j = await json(await call(`${CHANGES}/startPageToken`));
      if (typeof j.startPageToken !== 'string' || !j.startPageToken || j.startPageToken.length > 1000) throw new Fail('bad');
      return j.startPageToken;
    };
    const changes = async (pageToken, { fields = SYNC, pageSize = 100 } = {}) => {
      if (typeof pageToken !== 'string' || !pageToken || pageToken.length > 1000) throw new Fail('bad');
      const j = await json(await call(`${CHANGES}?${q({ pageToken, pageSize: String(pageSize), spaces: 'drive', includeRemoved: 'true',
        fields: `nextPageToken,newStartPageToken,changes(changeType,removed,fileId,time,file(${fields}))` })}`));
      if (!Array.isArray(j.changes) || (typeof j.nextPageToken !== 'string' && typeof j.newStartPageToken !== 'string')) throw new Fail('bad');
      return j;
    };
    // A file's bytes (alt=media), at most max of them. → Uint8Array
    const media = async (id, max) => drain(await call(`${API}/${idOf(id)}?${q({ alt: 'media' })}`), max);
    // Bytes from..to of a file (alt=media, Range), for a download that comes over several requests and workers (documents/
    // drive-sync.js). → { bytes, whole }: whole when Drive sent the file entire (200, Range not honoured), at most max.
    const part = async (id, from, to, max) => {
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || !Number.isSafeInteger(max)) throw new Fail('bad');
      const r = await call(`${API}/${idOf(id)}?${q({ alt: 'media' })}`, { headers: { range: `bytes=${from}-${to}` } });
      const whole = r.status !== 206, at = /^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(r.headers.get('content-range') || '');
      if (!whole && at && Number(at[1]) !== from) { r.body?.cancel().catch(() => {}); throw new Fail('bad'); }
      return { bytes: await drain(r, whole ? max : to - from + 1, whole ? 'size' : 'bad'), whole };
    };
    const drain = async (r, max, over = 'size') => {
      if (Number(r.headers.get('content-length')) > max) { r.body?.cancel().catch(() => {}); throw new Fail(over); }
      const reader = r.body?.getReader();
      if (!reader) throw new Fail('bad');
      const parts = [];
      let n = 0;
      try {
        for (;;) {
          let x;
          try { x = await reader.read(); } catch { throw new Fail('network'); }
          if (x.done) break;
          if ((n += x.value.length) > max) throw new Fail(over);
          parts.push(x.value);
          await still();
        }
      } catch (e) { reader.cancel().catch(() => {}); throw e; }
      return join(parts, n);
    };
    // A file's content and metadata: a new file (no id) or a new revision of id. Up to SMALL in one multipart request, else
    // a resumable session (its address only ever Drive's own upload address for that file or a new one), its bytes in
    // chunks (STEP). all: the file may be in a shared drive (Save to Drive's update of a file the student moved). keep:
    // { get, set, drop } where the session waits between workers (Sync's, documents/drive-sync.js): { uri, id, size, sum
    // (the bytes' SHA-256), at (what Drive confirmed), step, sending (a chunk under way) }. A session kept for these same
    // bytes and file goes on from what Drive says it has (Content-Range bytes */N); one expired (404) starts over.
    const put = async ({ id = null, meta = {}, mime, bytes, fields = SYNC, all = false, keep = null }) => {
      if ((id !== null && (typeof id !== 'string' || !ID.test(id))) || typeof mime !== 'string' || !MIME.test(mime) || !(bytes instanceof Uint8Array) || bytes.length > kinds().FILE * 4) throw new Fail('bad');
      const more = all ? { supportsAllDrives: 'true' } : {};
      if (bytes.length <= SMALL) {
        const { type, body } = multipart(meta, mime, bytes);
        return json(await call(id ? `${UPLOAD}/${id}?${q({ uploadType: 'multipart', fields, ...more })}` : `${UPLOAD}?${q({ uploadType: 'multipart', fields, ...more })}`,
          { method: id ? 'PATCH' : 'POST', headers: { 'content-type': type }, body }));
      }
      const home = id ? `${UPLOAD}/${id}` : UPLOAD, size = bytes.length, sum = keep ? await digest(bytes) : null;
      const ours = (uri) => { try { const at = new URL(uri); return `${at.origin}${at.pathname}` === home && !!at.searchParams.get('upload_id'); } catch { return false; } };
      let s = keep ? await keep.get() : null;
      if (s && !(s.sum === sum && s.size === size && (s.id ?? null) === id && ours(s.uri) && Number.isSafeInteger(s.at) && s.at >= 0 && s.at <= size
        && Number.isSafeInteger(s.step) && s.step >= STEP.min && s.step <= STEP.max)) { s = null; await keep.drop(); }
      // A session an earlier worker began: where it stands is Drive's to say (it may have kept part of a chunk).
      let ask = !!s, fresh = 0, idle = 0;
      const save = async (patch) => { s = { ...s, ...patch }; await keep?.set(s); };
      for (;;) {
        if (!s) {
          if (++fresh > 2) throw new Fail('busy');
          const r = await call(`${home}?${q({ uploadType: 'resumable', fields, ...more })}`, {
            method: id ? 'PATCH' : 'POST', headers: { 'content-type': JSON_TYPE, 'x-upload-content-type': mime, 'x-upload-content-length': String(size) }, body: JSON.stringify(meta),
          });
          r.body?.cancel().catch(() => {});
          const uri = r.headers.get('location');
          if (!ours(uri)) throw new Fail('bad');
          s = { uri, id, size, sum, at: 0, step: STEP.max, sending: false };
          await keep?.set(s);
          ask = false;
        }
        let r;
        if (ask || s.at >= size) {
          r = await call(s.uri, { method: 'PUT', headers: { 'content-range': `bytes */${size}` } }, [308, 404, 410]);
          // One cut short mid-chunk (a worker stopped, the link too slow): smaller chunks from here.
          if (s.sending) s.step = pace(s.step, Infinity);
          ask = false;
        } else {
          const end = Math.min(size, s.at + s.step), began = clock();
          await save({ sending: true });
          r = await call(s.uri, { method: 'PUT', headers: { 'content-range': `bytes ${s.at}-${end - 1}/${size}` }, body: bytes.subarray(s.at, end) }, [308, 404, 410]);
          s.step = pace(s.step, clock() - began);
        }
        if (r.status === 404 || r.status === 410) { r.body?.cancel().catch(() => {}); s = null; await keep?.drop(); continue; }
        if (r.status === 308) {
          r.body?.cancel().catch(() => {});
          const got = /^bytes=0-(\d+)$/.exec(r.headers.get('range') || ''), at = got ? Number(got[1]) + 1 : 0;
          if (at > size) throw new Fail('bad');
          // Drive answering without moving on, again and again: tried later rather than for ever.
          if (at <= s.at && ++idle > 3) throw new Fail('busy');
          if (at > s.at) idle = 0;
          await save({ at, sending: false });
          continue;
        }
        const j = await json(r);
        await keep?.drop();
        return j;
      }
    };
    // Metadata only: a name, Glaze's properties, in or out of Drive's trash (never deleted for good). move: { add, remove: [ids] },
    // from those folders into that one (Sync's folders converging, documents/drive-sync.js converge).
    const patch = async (id, meta, fields = SYNC, move = null) => json(await call(`${API}/${idOf(id)}?${q({ fields, ...(move && { addParents: idOf(move.add), removeParents: move.remove.map(idOf).join(',') }) })}`,
      { method: 'PATCH', headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(meta) }));
    // files.delete: for good, past Drive's trash. Sync's own daily snapshots past the newest five alone (background/drive-store.js
    // snapshot checks each first: a zip Glaze made and tagged, in Backups); everything else Glaze removes goes to the trash.
    const remove = async (id) => { const r = await call(`${API}/${idOf(id)}`, { method: 'DELETE' }); r.body?.cancel().catch(() => {}); };
    // A file with no content (a folder).
    const folder = async (meta, fields = SYNC) => {
      const j = await json(await call(`${API}?${q({ fields })}`, { method: 'POST', headers: { 'content-type': JSON_TYPE }, body: JSON.stringify(meta) }));
      if (typeof j.id !== 'string' || !ID.test(j.id)) throw new Fail('bad');
      return j;
    };
    return { meta, open, raw, save, file, find, startToken, changes, media, part, put, patch, remove, folder };
  };

  // ---- the port, worker side: one request a port. page → { op: 'open', id, takes } then { op: 'more' } after each chunk;
  // or { op: 'save', key, name, mime, size, as } then { op: 'chunk', data } after each more, and { op: 'end' }; { op: 'ping' }
  // any time. worker → open: { type: 'file', kind, name, mime, size }, { type: 'chunk', data }…, { type: 'end', size };
  // save: { type: 'more' }…, { type: 'saved', id, fresh }; either: { type: 'fail', why }.
  // o: { drive (create), allowed() (the sender, checked again before the request), record: { get(key) → { drive } or null
  // when there is no such document, set(key, drive) } }
  // Tabs share a document's remote target. Keep the target read, upload and pointer write in one turn, without holding
  // the paper broker's queue during a network request. Other documents can still transfer independently.
  const saving = new Map();
  const saveTurn = (key, run) => {
    const p = (saving.get(key) || Promise.resolve()).then(run);
    const tail = p.catch(() => {});
    saving.set(key, tail);
    tail.then(() => { if (saving.get(key) === tail) saving.delete(key); });
    return p;
  };
  const serve = (port, { drive, allowed = async () => true, record = null }) => {
    let gone = false, waiting = null, begun = false;
    // The page gone (its cancel, or closed): the download's fetch aborted where it stands.
    const quit = new AbortController();
    const post = (m) => { if (gone) return; try { port.postMessage(m); } catch { gone = true; quit.abort(); } };
    const next = () => new Promise((ok, no) => { if (gone) no(new Fail('cancel')); else waiting = { ok, no }; });
    const active = async () => {
      if (gone) throw new Fail('cancel');
      if (!await allowed()) throw new Fail('sender');
      if (gone) throw new Fail('cancel');
    };
    port.onDisconnect.addListener(() => { gone = true; quit.abort(); const w = waiting; waiting = null; w?.no(new Fail('cancel')); });
    // open: a picked file for Documents or Writer (its kinds, m.takes); raw: Submit from Drive's, any file as it is.
    const open = async (m) => {
      const KS = kinds().KINDS;
      if (m.op === 'open' && (!Array.isArray(m.takes) || !m.takes.length || m.takes.length > 8 || !m.takes.every((k) => typeof k === 'string' && Object.hasOwn(KS, k)))) throw new Fail('bad');
      let parts = [], held = 0;
      const flush = async () => {
        await active();
        const c = join(parts, held);
        parts = []; held = 0;
        post({ type: 'chunk', data: b64(c) });
        if ((await next()).op !== 'more') throw new Fail('bad');
        await active();
      };
      const on = {
        signal: quit.signal,
        head: async (h) => { await active(); post({ type: 'file', ...h }); },
        bytes: async (b) => {
          for (let i = 0; i < b.length;) {
            const k = Math.min(CHUNK - held, b.length - i);
            parts.push(b.subarray(i, i + k)); held += k; i += k;
            if (held === CHUNK) await flush();
          }
          if (gone) throw new Fail('cancel');
        },
      };
      const size = await (m.op === 'raw' ? drive.raw(m.id, on) : drive.open(m.id, m.takes, on));
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
      return saveTurn(m.key, async () => {
        const current = await record.get(m.key);
        if (!current) throw new Fail('missing');
        await active();
        const was = current.drive?.as === m.as && typeof current.drive.id === 'string' ? current.drive.id : null;
        const r = await drive.save({ name: m.name, mime: m.mime, bytes: join(parts, got), as: m.as, id: was });
        // Saved even if the record can't take the id (deleted meanwhile): the next save makes a new file.
        await Promise.resolve().then(() => record.set(m.key, { id: r.id, as: m.as })).catch(() => {});
        return { type: 'saved', id: r.id, fresh: r.fresh };
      });
    };
    port.onMessage.addListener((m) => {
      if (m?.op === 'ping') return;
      if (begun) { const w = waiting; waiting = null; w?.ok(m && typeof m === 'object' ? m : {}); return; }
      begun = true;
      (async () => {
        await active();
        if (m?.op === 'open' || m?.op === 'raw') return open(m);
        if (m?.op === 'save') return save(m);
        throw new Fail('bad');
      })().then(post, (e) => post({ type: 'fail', why: e instanceof Fail ? e.why : 'network' }));
    });
  };

  // ---- the port, page side: open(id, takes, progress, signal) → a File; raw(id, progress, signal) → a File (Submit from
  // Drive: any file as it is, up to 50 MB); save({ key, name, mime, bytes, as }, progress) → { id, fresh }. progress({ done,
  // total }) as bytes go; signal: cancelling it lets the port go, which aborts the worker's fetch at once ('cancel').
  const client = (connect = () => chrome.runtime.connect({ name: PORT })) => {
    const session = (first, step, signal = null) => new Promise((ok, no) => {
      let port, over = false, ping = null;
      const end = (f, v) => { if (over) return; over = true; clearInterval(ping); signal?.removeEventListener('abort', cancel); try { port.disconnect(); } catch { /* gone */ } f(v); };
      const cancel = () => end(no, new Fail('cancel'));
      if (signal?.aborted) { no(new Fail('cancel')); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      try { port = connect(); } catch { end(no, new Fail('network')); return; }
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
    const fetchFile = (first, progress, signal) => {
      let head = null, got = 0;
      const parts = [];
      return session(first, (m, send, done) => {
        if (m.type === 'file' && !head) { head = m; progress?.({ done: 0, total: m.size || 0 }); }
        else if (m.type === 'chunk' && head) {
          const b = unb64(m.data);
          parts.push(b); got += b.length;
          progress?.({ done: got, total: Math.max(head.size || 0, got) });
          send({ op: 'more' });
        } else if (m.type === 'end' && head) done(new File(parts, String(head.name), { type: typeof head.mime === 'string' ? head.mime : '' }));
      }, signal);
    };
    const open = (id, takes, progress = null, signal = null) => fetchFile({ op: 'open', id, takes }, progress, signal);
    const raw = (id, progress = null, signal = null) => fetchFile({ op: 'raw', id }, progress, signal);
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
    return { open, raw, save };
  };

  // ---- the pages: the entries show while the worker says Drive is connected, asked as the page loads and again when the
  // connection changes (storage.local google, background/google.js).
  const page = (() => {
    if (typeof document === 'undefined' || !globalThis.chrome?.runtime?.sendMessage) return null;
    // A framed Documents is answered once its document has claimed its pass: until then 'sender', asked again after 0.5,
    // 1, 2, 4 and 8 seconds.
    // A change while one is asked is asked again once it answers, its answer then set aside as stale.
    let connected = false, picker = false, asking = null, again = false;
    const shown = new Set();
    const ask = (n = 0) => {
      if (asking) { again = true; return asking; }
      asking = chrome.runtime.sendMessage({ type: 'glaze:drive', op: 'status' }).catch(() => null).then((r) => {
        asking = null;
        if (again) { again = false; ask(); return; }
        if (r?.why === 'sender' && n < 5) setTimeout(() => ask(n + 1), 500 * 2 ** n);
        const on = r?.connected === true, can = on && r?.picker === true; // picker: Google's Picker works here (not Safari yet)
        if (on !== connected || can !== picker) { connected = on; picker = can; for (const f of shown) try { f(); } catch (e) { console.error(e); } }
      });
      return asking;
    };
    ask();
    chrome.storage?.onChanged?.addListener((c, where) => { if (where === 'local' && 'google' in c) ask(); });
    const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return 'en'; } })();
    const t = (k, v) => (globalThis.GZ_WRITER_FRAME?.t ? GZ_WRITER_FRAME.t(k, v) : GZ_I18N.t(k, v, locale));
    // What a page says of a reason, in English (the caller translates); nothing for a Picker the student closed.
    const SIGN_IN = new Set(['off', 'connect', 'setup', 'account', 'auth', 'permission', 'scope', 'browser', 'unsupported', 'state']);
    const SAYS = { missing: "Glaze can't reach this file in Google Drive.", denied: "Glaze can't reach this file in Google Drive.", busy: 'Google Drive is busy. Try again in a moment.',
      quota: 'Your Google Drive is full.', type: 'That file could not be read.', size: 'That file is too large.', export: 'That file is too large.' };
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
        for (const x of items || []) x?.remove();
        items = connected ? [picker ? D.item('toolbar', t('From Google Drive'), () => { fromDrive(); }) : null, D.item('card', t('Save to Google Drive'), (doc) => { if (doc) toDrive(doc); })] : null;
      };
      shown.add(show);
      show();
    };

    // The paper's ⋯ menu (writer-paper.js), beside Import…: [{ label, run }] while connected. The picked file goes where a
    // file brought to the paper goes (bring: on an assignment writer-import.js's card, else a Word file's import); a paper
    // in Writer takes Word files and the kinds that open there (writer-kinds.js).
    const items = (api, bring) => (connected && picker ? [{ label: t('From Google Drive'), run: async () => {
      try {
        const [f] = await pick();
        if (!f) return;
        const takes = location.pathname.endsWith('/writer.html') ? ['paper', ...(globalThis.GZ_WRITER_KINDS?.opens?.() || [])] : ['paper'];
        api?.notify?.('Reading…');
        // On an assignment it goes on to Blackboard's upload (writer-import.js), which takes only a name a file can have.
        const got = await client().open(f.id, takes), name = fileName(got.name);
        bring(name === got.name ? got : new File([got], name, { type: got.type }));
      } catch (e) { const w = says(fail(e)); if (w) api?.notify?.(w); }
    } }] : []);
    return { home, items, connected: () => connected, picker: () => picker };
  })();

  return { API, UPLOAD, CHANGES, PORT, CHUNK, META, SYNC, SMALL, STEP, DOC, WHY, Fail, b64, unb64, fileName, plan, create, serve, client, page };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE;
