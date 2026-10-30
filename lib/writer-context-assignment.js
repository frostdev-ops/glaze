// Glaze Writer's context for an assignment's paper, read on the content side and sent to the frame (`context`): the
// paper's key (school, student, course, assignment), the student's name (/users/me), the course's name (the student's
// memberships), the assignment's title and due date (the course's gradebook column), its instructions (the attempt page's
// read-only editor, else the content item's), its description (the content item's and its assessment's) and its rubric
// (lib/rubric.js, read as features/rubric.js reads it) and the files attached in its instructions and description
// (attached(): names only until Feedback asks, attachments()) for the AI. The instructor is left for the student to type:
// no read-only source for a course's instructors was seen on the owner's Ultra.
// Every Ultra read is a GET through the site's queue (lib/lmsq.js). build() and read() are pure over what they're handed
// (node tests).
// Classic script, loaded on demand (features/writer.js); module.exports for node.
var GZ_WRITER_CONTEXT_ASSIGNMENT = globalThis.GZ_WRITER_CONTEXT_ASSIGNMENT || (() => {
  const ID = /^_\d+_\d+$/;
  const str = (v, n = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const settle = (p) => Promise.resolve().then(p).catch(() => null);
  // Rich text Ultra keeps (a content item's description and instructions) as text.
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  const html = (v, n = 20000) => str(typeof v === 'string' ? v.replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(\w+|#39);/g, (m, e) => ENT[e] ?? m) : '', n);

  const MATERIAL = 200000;
  // Preserve complete assessment material within an explicit shared budget. When a source is longer, keep a useful
  // excerpt together with provenance that forbids a numeric grade; labels are not a reason to lose requirements.
  const collector = () => {
    let left = MATERIAL, incomplete = false;
    return { take(value, preserve = false) { const all = preserve ? String(value) : str(value, Infinity), kept = all.slice(0, left); left -= kept.length; if (kept.length < all.length) incomplete = true; return kept; },
      mark() { incomplete = true; }, get incomplete() { return incomplete; } };
  };
  // The rubric as the AI reads it: criteria with their complete levels, from lib/rubric.js's model.
  const rubricOf = (m) => {
    if (!m || !Array.isArray(m.criteria)) return null;
    const collect = collector();
    const percent = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
    const scalar = (value) => value && typeof value === 'object' && Object.keys(value).length === 1 && percent(value.n);
    const levels = Array.isArray(m.levels) ? m.levels : [], ids = new Set(levels.map((l) => l.id));
    // Ultra's normalized UI model intentionally keeps percentage ratings unweighted. Writer needs actual criterion
    // points, but only an explicit assignment total and a complete 100% scored rubric establish that scale. Never infer
    // a 100-point assignment, select a range endpoint, or change the source model used by the native rubric view.
    const weighted = m.kind === 'percent' && Number.isFinite(m.total) && m.total > 0 && !m.hidePoints && !m.hideTotal
      && levels.length > 0 && levels.length <= 12 && ids.size === levels.length && levels.every((l) => typeof l.id === 'string' && l.id)
      && m.criteria.length > 0 && m.criteria.length <= 50 && new Set(m.criteria.map((c) => c?.id)).size === m.criteria.length
      && m.criteria.every((c) => c && typeof c.id === 'string' && c.id && !c.unscored && c.points == null && percent(c.weight)
        && Array.isArray(c.cells) && c.cells.length === levels.length && new Set(c.cells.map((cell) => cell?.level)).size === levels.length
        && c.cells.every((cell) => cell && ids.has(cell.level) && scalar(cell.value)))
      && Math.abs(m.criteria.reduce((sum, c) => sum + c.weight, 0) - 100) < 1e-8;
    const percentage = m.kind === 'percent' || m.kind === 'percent-range';
    const out = {
      title: collect.take(m.title), ...(m.detail && { detail: collect.take(m.detail) }),
      total: !m.hidePoints && !m.hideTotal && Number.isFinite(m.total) && m.total >= 0 ? m.total : null,
      ...(typeof m.kind === 'string' && { kind: weighted ? 'points' : m.kind }),
      levels: levels.map((l) => ({ id: l.id, label: collect.take(l.label) })),
      criteria: m.criteria.map((c) => {
        const unscored = c.unscored === true || m.kind === 'none';
        const points = unscored || m.hidePoints || (percentage && !weighted) ? null : weighted ? m.total * (c.weight / 100) : c.points ?? null;
        return { id: c.id, label: collect.take(c.label), detail: collect.take(c.detail), points, weight: m.hidePoints ? null : c.weight ?? null, unscored,
          cells: (c.cells || []).map((cell) => {
            const out = { level: cell.level, detail: collect.take(String(cell.detail || '').replace(/<[^>]*>/g, ' ')),
              value: unscored || m.hidePoints || (percentage && !weighted) ? null : weighted ? points * (cell.value.n / 100) : cell.value?.n ?? null };
            // Unknown-total percentages remain available as explicitly typed facts, never as misleading point values.
            if (percentage && !weighted && !m.hidePoints) {
              if (m.kind === 'percent' && scalar(cell.value)) out.percentage = cell.value.n;
              const range = cell.value;
              if (m.kind === 'percent-range' && range && percent(range.lo) && percent(range.hi) && range.lo <= range.hi && typeof range.loExclusive === 'boolean') {
                out.percentageRange = { lo: range.lo, hi: range.hi, loExclusive: range.loExclusive };
              }
            }
            return out;
          }) };
      }),
    };
    if (collect.incomplete) out.incomplete = true;
    return out;
  };

  // The files an assignment attaches: Ultra's attachment links in its HTML, <a data-bbtype="attachment" data-bbfile="{…}"
  // href="…/bbcswebdav/…"> (seen live 2026-10-27: an image, render "inline", isDecorative true however it was meant, so
  // that flag gates nothing). The href on the site's own /bbcswebdav/ is the file; data-bbfile's resourceUrl is a session's.
  // Pictures Writer can send a model (PNG, JPEG, GIF, WebP), documents lib/doctext.js or the reader can read, and
  // spreadsheets (Open in Glaze's, never read for Feedback); others are left out. → [{ url, name, image }], each file once,
  // ATTACH.files at most.
  // Bytes: one document, one picture, the pictures (8 MB as base64, what the worker keeps and well within the broker's
  // message), everything read; a picture's shorter side; a document's characters.
  const ATTACH = { files: 6, file: 20 << 20, picture: 3 << 20, pictures: 6 << 20, total: 40 << 20, side: 32, text: MATERIAL };
  const ATT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'" };
  const PICTURE = /\.(png|jpe?g|gif|webp)$/i, DOCUMENT = /\.(docx|pptx|ppsx|pdf|txt|text|md|html?)$/i, SHEET = /\.(xlsx|csv|tsv)$/i;
  const attached = (htmls, origin) => {
    const out = [];
    let incomplete = false;
    for (const h of htmls) {
      for (const [tag] of String(typeof h === 'string' ? h : '').matchAll(/<a\s(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
        const attr = (n) => {
          for (const m of tag.matchAll(/\s+([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) if (m[1].toLowerCase() === n) return (m[2] ?? m[3] ?? m[4]).replace(/&(quot|amp|lt|gt|apos|#39);/g, (_, e) => ATT[e]);
          return '';
        };
        if (attr('data-bbtype') !== 'attachment') continue;
        try {
          const bf = JSON.parse(attr('data-bbfile')), url = new URL(attr('href'), origin);
          if (url.origin !== origin || !url.pathname.startsWith('/bbcswebdav/')) { incomplete = true; continue; }
          if (out.some((f) => f.url === url.href)) continue;
          const name = str(bf?.fileName || bf?.displayName || bf?.linkName || decodeURIComponent(url.pathname.split('/').pop()), 200);
          const mime = typeof bf?.mimeType === 'string' ? bf.mimeType.toLowerCase() : '';
          const image = PICTURE.test(name) || /^image\/(png|jpeg|gif|webp)$/.test(mime);
          if (name && (image || DOCUMENT.test(name) || SHEET.test(name))) out.push({ url: url.href, name, image });
          else incomplete = true;
        } catch { incomplete = true; /* An attachment that cannot be identified is still unavailable material. */ }
      }
    }
    const kept = out.slice(0, ATTACH.files);
    if (incomplete || out.length > kept.length) Object.defineProperty(kept, 'incomplete', { value: true, configurable: true });
    return kept;
  };
  // The attached files read, within ATTACH: a picture as itself (its type from its bytes, at least ATTACH.side pixels a
  // side: an icon or a spacer says nothing), anything else as its text. images: false leaves pictures unread. o: { get(url,
  // max) → bytes (null or a throw: left out), text({ name, bytes }) → its text, D (lib/doctext.js), images }.
  // → [{ name, text } | { name, image: { mime, data (base64) } }]
  const MIME = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46, 0x38]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];
  const b64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const read = async (files, { get, text, D, images = true }) => {
    const out = [];
    let left = ATTACH.total, album = ATTACH.pictures, characters = ATTACH.text;
    const tagged = (f, value) => ({ name: f.name, ...(typeof f.id === 'string' && { id: f.id }), ...value });
    const omitted = () => { Object.defineProperty(out, 'incomplete', { value: true, configurable: true }); };
    if (files.incomplete || files.length > ATTACH.files) omitted();
    for (const f of files.slice(0, ATTACH.files)) {
      if (f.image && (!images || album <= 0)) { omitted(); continue; }
      if (!f.image && SHEET.test(f.name)) { omitted(); continue; } // a spreadsheet opens in Glaze; Feedback has no text of it
      const max = Math.min(f.image ? Math.min(ATTACH.picture, album) : ATTACH.file, left);
      if (max <= 0) { omitted(); break; }
      const bytes = await settle(() => get(f.url, max));
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > max) { omitted(); continue; }
      left -= bytes.length;
      const kind = D.kind(f.name, '', bytes.subarray(0, 16));
      if (kind === 'image') {
        const mime = MIME.find(([, m]) => m.every((x, i) => bytes[i] === x))?.[0], size = D.imageSize(bytes);
        if (!images || !mime || bytes.length > ATTACH.picture || (mime === 'image/webp' && String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') || !size || Math.min(size.w, size.h) < ATTACH.side || (album -= bytes.length) < 0) { omitted(); continue; }
        out.push(tagged(f, { image: { mime, data: b64(bytes) } }));
      } else if (kind) {
        const extracted = await settle(() => text({ name: f.name, bytes }));
        const full = (typeof extracted === 'string' ? extracted : typeof extracted?.text === 'string' ? extracted.text : '').trim(), t = full.slice(0, characters);
        const uncertain = extracted?.incomplete === true || extracted?.truncated === true || extracted?.ocr?.blank > 0 || extracted?.ocr?.conf < 80 || (Array.isArray(extracted?.ocr?.unsure) && extracted.ocr.unsure.length > 0);
        characters -= t.length;
        if (full.length > t.length || uncertain) omitted();
        if (t) out.push(tagged(f, { text: t, ...((full.length > t.length || uncertain) && { incomplete: true }) }));
        else omitted();
      } else omitted();
    }
    return out;
  };

  // o: { school, path, uid() → id, me() → /users/me, courses() → memberships, rows() → gradebook rows (expand=column),
  // get(url) → JSON (the content item, the rubric), instructions() → text, R (lib/rubric.js), url, origin }. Each read that
  // fails leaves its part empty. → the context (assignment.files: attached()'s, with their addresses).
  const build = async (o) => {
    const at = /^\/ultra\/courses\/(_\d+_\d+)\/(?:.*\/)?assessment\/(_\d+_\d+)\/attempt(?:\/|$)/.exec(o.path || '');
    if (!at) return null;
    const [, course, content] = at;
    const uid = await settle(o.uid);
    const [me, courses, rows, item] = await Promise.all([settle(o.me), settle(o.courses), settle(o.rows), settle(() => o.get(`/learn/api/v1/courses/${course}/contents/${content}`))]);
    const asmt = item?.id === content ? item.contentDetail?.['resource/x-bb-asmt-test-link']?.test?.assessment : null;
    const given = str(me?.givenName ?? me?.name?.given), family = str(me?.familyName ?? me?.name?.family);
    const membership = (Array.isArray(courses) ? courses : []).find((m) => m?.courseId === course);
    const column = (Array.isArray(rows) ? rows : []).map((r) => r?.column).find((c) => c?.contentId === content) || null;
    let rubric = null;
    // The rows are the student's own; Ultra's row for an item not yet opened carries no userId (seen live 2026-10-27).
    // Another student's id still rules a row out.
    const mine = (Array.isArray(rows) ? rows : []).filter((r) => r?.column?.contentId === content && r.courseId === course && (r.userId == null || r.userId === uid));
    const row = mine.length === 1 ? mine[0] : null;
    if (row && ID.test(row.columnId || '') && o.get && o.R && ID.test(uid || '')) {
      const col = await settle(() => o.get(`/learn/api/v1/courses/${course}/gradebook/columns/${row.columnId}?expand=associatedRubrics`));
      const a = col && col.id === row.columnId && Array.isArray(col.rubricAssociations) && col.rubricAssociations.length === 1 ? col.rubricAssociations[0] : null;
      if (a) rubric = rubricOf(o.R.parse.ultra(a.rubricDefinition, a, null, { courseId: course, contentId: content, columnId: row.columnId, userId: uid, attemptId: null, state: 'before', pointsPossible: col.possible, columnBound: true }));
    }
    const collect = collector(), fromPage = await settle(o.instructions);
    const pageInstructions = str(typeof fromPage === 'string' ? fromPage : fromPage?.text, Infinity), apiInstructions = html(asmt?.instructions?.rawText, Infinity);
    // Prefer the API's complete version when the page reader supplied only its prefix.
    const fullInstructions = apiInstructions.startsWith(pageInstructions) ? apiInstructions : pageInstructions.startsWith(apiInstructions) ? pageInstructions
      : [pageInstructions, apiInstructions].filter(Boolean).join('\n');
    if (fromPage?.incomplete && fullInstructions !== apiInstructions) collect.mark();
    const instructions = collect.take(fullInstructions);
    const files = item?.id === content ? attached([asmt?.instructions?.rawText, asmt?.description?.rawText, item.description], o.origin || '') : [];
    const fullDescription = [...new Set([html(item?.id === content ? item.description : '', Infinity), html(asmt?.description?.rawText, Infinity)].filter((d) => d && !fullInstructions.includes(d)))].join('\n');
    const description = collect.take(fullDescription, true);
    // Rubric text is independently bounded and its marker survives the content/frame/worker boundary.
    const incomplete = collect.incomplete || rubric?.incomplete || files.incomplete || !item || item.id !== content;
    return {
      kind: 'assignment',
      course: { id: course, name: str(membership?.course?.name || membership?.course?.displayName) },
      user: { name: [given, family].filter(Boolean).join(' '), given, family },
      instructor: '',
      prompt: { text: instructions },
      assignment: { title: str(column?.columnName, 300), due: Number.isFinite(Date.parse(column?.dueDate)) ? column.dueDate : null, instructions, description, rubric, files, ...(incomplete && { incomplete: true }) },
      paper: ID.test(uid || '') ? { school: String(o.school || '').toLowerCase(), user: uid, course, content, url: o.url || '' } : null,
      style: null,
    };
  };

  // On the attempt page: reads through GZ_CTX and the site's queue, then hands the frame its context (and keeps it on the
  // box, so a reopened frame starts with it). alive(): whether the box is still this one.
  const send = async (X, box, alive = () => true) => {
    await X.need('lib/lmsq.js', () => globalThis.GZ_LMSQ);
    await X.need('lib/ultra.js', () => globalThis.GZ_ULTRA);
    await X.need('lib/rubric.js', () => globalThis.GZ_RUBRIC_LIB).catch(() => {});
    const live = () => alive() && X.on();
    const reader = GZ_ULTRA.read({ origin: location.origin, live, f: (...a) => GZ_LMSQ.fetch(...a, 0, live), maxPages: 2, maxRequests: 6 });
    const cid = /\/courses\/(_\d+_\d+)\//.exec(location.pathname)?.[1];
    // The gradebook comes in on its own schedule (content-ultra.js bookFor): asked for, then waited for a little.
    const rows = async () => {
      for (let i = 0; i < 40 && live(); i++) {
        const b = X.bookFor?.(cid, false);
        if (b?.results) return b.results;
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    };
    const page = box.editor.ownerDocument;
    const context = await build({
      school: location.host, path: location.pathname, url: location.origin + location.pathname, origin: location.origin,
      uid: () => X.account().then(String), me: () => reader.get('/learn/api/v1/users/me'), courses: () => X.myCourses(), rows,
      get: (u) => reader.get(u), R: globalThis.GZ_RUBRIC_LIB,
      instructions: () => {
        const whole = page.querySelector('#bb-editorassignment-attempt-authoring-instructions')?.textContent;
        if (whole) return whole;
        const text = globalThis.GZ_WRITER_ULTRA?.contextOf(box.editor, 'assignment')?.prompt || '';
        return { text, incomplete: text.length >= 20000 };
      },
    });
    if (!context || !alive()) return null;
    // The frame is told the files' names; their addresses stay here for attachments().
    box.files = context.assignment.files.map((f, i) => ({ ...f, id: `attachment-${i + 1}` }));
    context.assignment.files = box.files.map(({ name, image, id }) => ({ name, image, id }));
    box.reading = null;
    box.context = { ...box.context, ...context };
    box.port?.postMessage({ type: 'context', context: box.context });
    if (box.files.some((f) => !f.image)) X.need('lib/writer-submit.js', () => globalThis.GZ_WRITER_SUBMIT_LIB).then(() => { if (alive()) decorate(X, box); }, () => {});
    return context;
  };

  // A file's bytes, streamed and stopped past max (→ null, said.big set), with the session as the page would ask for it,
  // through the site's queue (lib/lmsq.js, loaded by the caller). Ultra answers a /bbcswebdav/ file with a redirect to its
  // file store (*.prod.files.blackboard.com), which lets the page read it (live, 2026-10-27).
  const fetchBounded = (url, max, live, said = {}) => GZ_LMSQ.run(async () => {
    if (!live()) throw new Error('stale');
    const r = await fetch(url, { credentials: 'same-origin' });
    // A followed response may leave the LMS only for the file store observed on Ultra. Never hand an unrelated
    // redirect's body to Feedback or the frame, even when it permits the page's CORS read.
    const from = new URL(url), to = new URL(r.url || url);
    if (to.origin !== from.origin && !(to.protocol === 'https:' && !to.port && !to.username && !to.password && /^[^.]+(?:\.[^.]+)*\.prod\.files\.blackboard\.com$/i.test(to.hostname))) { await r.body?.cancel(); throw new Error('file origin'); }
    if (!r.ok || !r.body) { await r.body?.cancel(); throw r.status; }
    if (+r.headers.get('content-length') > max) { await r.body.cancel(); said.big = true; return null; }
    const body = r.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await body.read();
        if (done) break;
        if ((size += value.byteLength) > max) { said.big = true; return null; }
        if (!live()) return null;
        chunks.push(value);
      }
    } finally { body.cancel().catch(() => {}); body.releaseLock(); }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out;
  }, 1);

  // ---- an attached PDF, deck or spreadsheet opened in Glaze. openable: the box's files of a kind whose Settings → Writer
  // switch is on (w: storage.sync writer; L: lib/writer-submit.js), never a picture or a Word file (Feedback reads those).
  const OPENS = ['pdf', 'slides', 'sheet'];
  const openable = (files, w, L) => (Array.isArray(files) ? files : []).filter((f) => !f.image && OPENS.includes(L.kindOf(f.name)) && L.switched(w).includes(L.kindOf(f.name)));
  // The file's bytes to the paper's frame as import:file { open } (writer-import.js opens it in Glaze, the paper kept as a
  // version first), or import:failed when it can't be read within what the submit sheet sends (L.MAX_FILE, the kinds' max:
  // lib/doc-kinds.js FILE), why: 'size' past it. → whether it went.
  const open = async (X, box, id, L, alive = () => true) => {
    if (box.kind === 'test' || box.context?.kind !== 'assignment') return false;
    const f = openable(box.files, X.settings()?.writer, L).find((x) => x.id === id);
    if (!f) return false;
    const port = box.port;
    const live = () => alive() && X.on() && box.port === port && openable(box.files, X.settings()?.writer, L).some((x) => x.id === f.id && x.url === f.url);
    await X.need('lib/lmsq.js', () => globalThis.GZ_LMSQ);
    let bytes = null;
    const said = {};
    try { bytes = await fetchBounded(f.url, L.MAX_FILE, live, said); } catch { bytes = null; }
    if (!live()) return false;
    try {
      if (!bytes?.length) { box.port?.postMessage({ type: 'import:failed', name: f.name, ...(said.big && { why: 'size' }) }); return false; }
      box.frame?.focus();
      box.port?.postMessage({ type: 'import:file', name: f.name, mime: L.mimeOf(f.name), bytes: bytes.buffer, open: true }, [bytes.buffer]);
      return true;
    } catch { return false; /* the frame went */ }
  };
  // Open in Glaze after each link on the page to an openable attachment (any link to its address: how Ultra draws an
  // attachment on the attempt page wasn't probed, only the API's <a data-bbtype="attachment">); the buttons go when the
  // switch does. Runs on features/writer.js's passes: it adds a button only where one is missing.
  const decorate = (X, box, L = globalThis.GZ_WRITER_SUBMIT_LIB, doc = document) => {
    const want = L && X.on() && box.context?.kind === 'assignment' ? openable(box.files, X.settings()?.writer, L) : [];
    box.openers ||= new Map();
    for (const [a, b] of box.openers) if (!a.isConnected || !want.some((f) => f.url === a.href && f.id === b.dataset.gzOpenGlaze) || !b.isConnected || b.previousElementSibling !== a) { b.remove(); box.openers.delete(a); }
    if (!want.length) return;
    for (const a of doc.querySelectorAll('a[href*="/bbcswebdav/"]')) {
      const f = want.find((x) => x.url === a.href);
      if (!f || box.openers.has(a)) continue;
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.gzOpenGlaze = f.id;
      b.textContent = X.t('Open in Glaze');
      for (const [k, v] of [['margin-inline-start', '8px'], ['padding', '2px 10px'], ['border', '1px solid var(--gz-line-strong, currentColor)'], ['border-radius', '999px'], ['background', 'var(--gz-surface, transparent)'], ['color', 'var(--gz-accent, inherit)'], ['font', 'inherit'], ['cursor', 'pointer']]) b.style.setProperty(k, v);
      b.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (b.disabled || !a.isConnected || a.href !== f.url) return;
        b.disabled = true;
        try { await open(X, box, f.id, L); } finally { b.disabled = false; }
      });
      a.after(b);
      box.openers.set(a, b);
    }
  };

  // The frame asks for the files when Feedback runs (writer-ai.js attachments { id, images }): read once for the box, as
  // features/syllabus.js reads a document's linked files (a document's text by features/import.js, a PDF in Glaze's
  // reader), each a GET through the site's queue, and answered on the box's port. A test's box is never read.
  const attachments = async (X, box, m, alive = () => true) => {
    const say = (files) => { try { box.port?.postMessage({ type: 'attachments', id: m.id, files, ...(files.incomplete && { incomplete: true }) }); } catch { /* the frame went */ } };
    if (box.kind === 'test' || box.context?.kind !== 'assignment' || !box.files?.length || !Number.isSafeInteger(m?.id)) return say([]);
    const images = m.images !== false;
    if (!box.reading || (images && !box.reading.images)) {
      const live = () => alive() && X.on();
      box.reading = { images, files: (async () => {
        await X.need('lib/lmsq.js', () => globalThis.GZ_LMSQ);
        await X.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT);
        await X.need('features/import.js', () => globalThis.GZ_IMPORT);
        const get = (url, max) => fetchBounded(url, max, live);
        const text = async ({ name, bytes }) => GZ_IMPORT.read(new File([bytes], name));
        return read(box.files, { get, text, D: GZ_DOCTEXT, images });
      })() };
    }
    const r = box.reading;
    const files = await r.files.catch(() => { if (box.reading === r) box.reading = null; return []; });
    if (alive()) {
      const selected = images ? files : files.filter((f) => !f.image);
      if (files.incomplete || selected.length < files.length) Object.defineProperty(selected, 'incomplete', { value: true, configurable: true });
      say(selected);
    }
  };

  return { build, send, rubricOf, attached, read, attachments, ATTACH, openable, open, decorate };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_CONTEXT_ASSIGNMENT;
GZ_WRITER_CONTEXT_ASSIGNMENT;
