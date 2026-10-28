// Glaze Writer's context for an assignment's paper, read on the content side and sent to the frame (`context`): the
// paper's key (school, student, course, assignment), the student's name (/users/me), the course's name (the student's
// memberships), the assignment's title and due date (the course's gradebook column), its instructions (the attempt page's
// read-only editor, else the content item's), its description (the content item's and its assessment's) and its rubric
// (lib/rubric.js, read as features/rubric.js reads it) for the AI. The instructor is left for the student to type: no
// read-only source for a course's instructors was seen on the owner's Ultra.
// Every Ultra read is a GET through the site's queue (lib/lmsq.js). build() is pure over what it's handed (node tests).
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

  // o: { school, path, uid() → id, me() → /users/me, courses() → memberships, rows() → gradebook rows (expand=column),
  // get(url) → JSON (the content item, the rubric), instructions() → text, R (lib/rubric.js), url }. Each read that fails
  // leaves its part empty. → the context.
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
    const description = [...new Set([html(item?.id === content ? item.description : '', 6000), html(asmt?.description?.rawText, 6000)].filter((d) => d && d !== instructions))].join('\n');
    return {
      kind: 'assignment',
      course: { id: course, name: str(membership?.course?.name || membership?.course?.displayName) },
      user: { name: [given, family].filter(Boolean).join(' '), given, family },
      instructor: '',
      prompt: { text: instructions },
      assignment: { title: str(column?.columnName, 300), due: Number.isFinite(Date.parse(column?.dueDate)) ? column.dueDate : null, instructions, description, rubric },
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
      school: location.host, path: location.pathname, url: location.origin + location.pathname,
      uid: () => X.account().then(String), me: () => reader.get('/learn/api/v1/users/me'), courses: () => X.myCourses(), rows,
      get: (u) => reader.get(u), R: globalThis.GZ_RUBRIC_LIB,
      instructions: () => globalThis.GZ_WRITER_ULTRA?.contextOf(box.editor, 'assignment')?.prompt || page.querySelector('#bb-editorassignment-attempt-authoring-instructions')?.textContent || '',
    });
    if (!context || !alive()) return null;
    box.context = { ...box.context, ...context };
    box.port?.postMessage({ type: 'context', context: box.context });
    return context;
  };

  return { build, send, rubricOf };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_CONTEXT_ASSIGNMENT;
GZ_WRITER_CONTEXT_ASSIGNMENT;
