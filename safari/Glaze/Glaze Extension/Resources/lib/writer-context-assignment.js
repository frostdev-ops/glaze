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

  // The rubric as the AI reads it: criteria with their levels, from lib/rubric.js's model.
  const rubricOf = (m) => (m && Array.isArray(m.criteria) ? {
    title: str(m.title), total: m.total ?? null,
    levels: m.levels.map((l) => ({ id: l.id, label: str(l.label) })),
    criteria: m.criteria.map((c) => ({ id: c.id, label: str(c.label), detail: str(c.detail), points: c.points ?? null, weight: c.weight ?? null,
      cells: c.cells.map((cell) => ({ level: cell.level, detail: str(String(cell.detail || '').replace(/<[^>]*>/g, ' '), 2000), value: cell.value?.n ?? null })) })),
  } : null);

  // The files an assignment attaches: Ultra's attachment links in its HTML, <a data-bbtype="attachment" data-bbfile="{…}"
  // href="…/bbcswebdav/…"> (seen live 2026-10-27: an image, render "inline", isDecorative true however it was meant, so
  // that flag gates nothing). The href on the site's own /bbcswebdav/ is the file; data-bbfile's resourceUrl is a session's.
  // Pictures Writer can send a model (PNG, JPEG, GIF, WebP) and documents lib/doctext.js or the reader can read; others
  // are left out. → [{ url, name, image }], each file once, ATTACH.files at most.
  const ATTACH = { files: 6, file: 20 << 20, picture: 3 << 20, total: 40 << 20, side: 32, text: 20000 };
  const ATT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'" };
  const PICTURE = /\.(png|jpe?g|gif|webp)$/i, DOCUMENT = /\.(docx|pptx|pdf|txt|text|md|html?)$/i;
  const attached = (htmls, origin) => {
    const out = [];
    for (const h of htmls) {
      for (const [tag] of String(typeof h === 'string' ? h : '').matchAll(/<a\s(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
        const attr = (n) => {
          for (const m of tag.matchAll(/\s+([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) if (m[1].toLowerCase() === n) return (m[2] ?? m[3] ?? m[4]).replace(/&(quot|amp|lt|gt|apos|#39);/g, (_, e) => ATT[e]);
          return '';
        };
        if (attr('data-bbtype') !== 'attachment') continue;
        try {
          const bf = JSON.parse(attr('data-bbfile')), url = new URL(attr('href'), origin);
          if (url.origin !== origin || !url.pathname.startsWith('/bbcswebdav/') || out.some((f) => f.url === url.href)) continue;
          const name = str(bf?.fileName || bf?.displayName || bf?.linkName || decodeURIComponent(url.pathname.split('/').pop()), 200);
          const mime = typeof bf?.mimeType === 'string' ? bf.mimeType.toLowerCase() : '';
          const image = PICTURE.test(name) || /^image\/(png|jpeg|gif|webp)$/.test(mime);
          if (name && (image || DOCUMENT.test(name))) out.push({ url: url.href, name, image });
        } catch { /* not a file link */ }
      }
    }
    return out.slice(0, ATTACH.files);
  };
  // The attached files read, within ATTACH: a picture as itself (its type from its bytes, at least ATTACH.side pixels a
  // side: an icon or a spacer says nothing), anything else as its text. images: false leaves pictures unread. o: { get(url,
  // max) → bytes (null or a throw: left out), text({ name, bytes }) → its text, D (lib/doctext.js), images }.
  // → [{ name, text } | { name, image: { mime, data (base64) } }]
  const MIME = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46, 0x38]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];
  const b64 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const read = async (files, { get, text, D, images = true }) => {
    const out = [];
    let left = ATTACH.total;
    for (const f of files.slice(0, ATTACH.files)) {
      if (f.image && !images) continue;
      const max = Math.min(f.image ? ATTACH.picture : ATTACH.file, left);
      if (max <= 0) break;
      const bytes = await settle(() => get(f.url, max));
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > max) continue;
      left -= bytes.length;
      const kind = D.kind(f.name, '', bytes.subarray(0, 16));
      if (kind === 'image') {
        const mime = MIME.find(([, m]) => m.every((x, i) => bytes[i] === x))?.[0], size = D.imageSize(bytes);
        if (!images || !mime || (mime === 'image/webp' && String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') || !size || Math.min(size.w, size.h) < ATTACH.side) continue;
        out.push({ name: f.name, image: { mime, data: b64(bytes) } });
      } else if (kind) {
        const t = String(await settle(() => text({ name: f.name, bytes })) ?? '').trim().slice(0, ATTACH.text);
        if (t) out.push({ name: f.name, text: t });
      }
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
    const instructions = str(await settle(o.instructions), 20000) || html(asmt?.instructions?.rawText);
    const files = item?.id === content ? attached([asmt?.instructions?.rawText, asmt?.description?.rawText, item.description], o.origin || '') : [];
    const description = [...new Set([html(item?.id === content ? item.description : '', 6000), html(asmt?.description?.rawText, 6000)].filter((d) => d && d !== instructions))].join('\n');
    return {
      kind: 'assignment',
      course: { id: course, name: str(membership?.course?.name || membership?.course?.displayName) },
      user: { name: [given, family].filter(Boolean).join(' '), given, family },
      instructor: '',
      prompt: { text: instructions },
      assignment: { title: str(column?.columnName, 300), due: Number.isFinite(Date.parse(column?.dueDate)) ? column.dueDate : null, instructions, description, rubric, files },
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
      instructions: () => globalThis.GZ_WRITER_ULTRA?.contextOf(box.editor, 'assignment')?.prompt || page.querySelector('#bb-editorassignment-attempt-authoring-instructions')?.textContent || '',
    });
    if (!context || !alive()) return null;
    // The frame is told the files' names; their addresses stay here for attachments().
    box.files = context.assignment.files;
    context.assignment.files = box.files.map(({ name, image }) => ({ name, image }));
    box.reading = null;
    box.context = { ...box.context, ...context };
    box.port?.postMessage({ type: 'context', context: box.context });
    return context;
  };

  // The frame asks for the files when Feedback runs (writer-ai.js attachments { id, images }): read once for the box, as
  // features/syllabus.js reads a document's linked files (a document's text by features/import.js, a PDF in Glaze's
  // reader), each a GET through the site's queue, and answered on the box's port. A test's box is never read.
  const attachments = async (X, box, m, alive = () => true) => {
    const say = (files) => { try { box.port?.postMessage({ type: 'attachments', id: m.id, files }); } catch { /* the frame went */ } };
    if (box.kind === 'test' || box.context?.kind !== 'assignment' || !box.files?.length || !Number.isSafeInteger(m?.id)) return say([]);
    const images = m.images !== false;
    if (!box.reading || (images && !box.reading.images)) {
      const live = () => alive() && X.on();
      box.reading = { images, files: (async () => {
        await X.need('lib/lmsq.js', () => globalThis.GZ_LMSQ);
        await X.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT);
        await X.need('features/import.js', () => globalThis.GZ_IMPORT);
        // The file's bytes, streamed and stopped past max, with the session as the page would ask for it.
        const get = (url, max) => GZ_LMSQ.run(async () => {
          if (!live()) throw new Error('stale');
          const r = await fetch(url, { credentials: 'same-origin' });
          if (!r.ok || !r.body) { await r.body?.cancel(); throw r.status; }
          if (+r.headers.get('content-length') > max) { await r.body.cancel(); return null; }
          const body = r.body.getReader(), chunks = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await body.read();
              if (done) break;
              if ((size += value.byteLength) > max || !live()) return null;
              chunks.push(value);
            }
          } finally { body.cancel().catch(() => {}); body.releaseLock(); }
          const out = new Uint8Array(size);
          let at = 0;
          for (const c of chunks) { out.set(c, at); at += c.byteLength; }
          return out;
        }, 1);
        const text = async ({ name, bytes }) => (await GZ_IMPORT.read(new File([bytes], name))).text;
        return read(box.files, { get, text, D: GZ_DOCTEXT, images });
      })() };
    }
    const r = box.reading;
    const files = await r.files.catch(() => { if (box.reading === r) box.reading = null; return []; });
    if (alive()) say(images ? files : files.filter((f) => !f.image));
  };

  return { build, send, rubricOf, attached, read, attachments, ATTACH };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_CONTEXT_ASSIGNMENT;
GZ_WRITER_CONTEXT_ASSIGNMENT;
