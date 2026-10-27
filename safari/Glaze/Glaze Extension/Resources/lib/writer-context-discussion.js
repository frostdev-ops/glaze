// Glaze Writer's context for a discussion post or reply, and a message (the frame's `context`: what the target ring and the
// AI know of the box). For a post or reply: the prompt (the public discussions API's topic.body, as lib/ultra.js reads
// it), the thread (Ultra's messages and replies API, newest first, within a post count and a character budget, the
// student's own posts marked), the post a reply answers, and the requirements lib/writer-target.js reads from the prompt.
// A message gets its course and the student only. The discussion's forum id isn't the content id in Ultra's route (probe,
// 2026-10-26/27): it is found in the course's discussions list, by the gradebook column the route's content id has, else
// by the page's title when exactly one discussion has it. Every read is a GET through the site's queue (lib/lmsq.js),
// behind visible work, once a page; whatever fails leaves its field empty. The frame gets the context when it's ready and
// again when it changes (a new post on the page reads the thread again, at most every 20 s).
// Pure builders, then watch(box, ctx) for features/writer.js. Classic script, loaded on demand; module.exports for node.
var GZ_WRITER_CONTEXT_DISCUSSION = globalThis.GZ_WRITER_CONTEXT_DISCUSSION || (() => {
  const ID = /^_\d+_\d+$/;
  const LIMIT = { posts: 30, chars: 24000, post: 4000, prompt: 20000, name: 120, requests: 16, pages: 3, replies: 8 };
  const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  const arr = (v) => (Array.isArray(v) ? v : []);
  const squash = (s) => String(s || '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  const fold = (s) => squash(s).toLowerCase();

  // ---- pure ------------------------------------------------------------------------------------------------------------
  // A discussion route's course and content ids, a message composer's course, or null.
  const route = (path = '', search = '') => {
    const d = /^\/ultra\/courses\/(_\d+_\d+)\/(?:.*\/)?discussion\/(_\d+_\d+)\/?$/.exec(path);
    if (d) return { course: d[1], content: d[2] };
    if (/^\/ultra\/messages\/create\/?$/.test(path)) { const c = new URLSearchParams(search).get('courseId'); return ID.test(c || '') ? { course: c } : null; }
    return null;
  };
  // The discussion (from the public list) behind a route's content id: the one whose gradebook column the gradebook rows
  // give that content id, else the only one titled as the page is. null when neither is sure.
  const discussionOf = (discussions, { content, rows = [], titles = [] } = {}) => {
    const list = arr(discussions).filter((d) => ID.test(d?.id || ''));
    const columns = new Set(arr(rows).filter((r) => r?.column?.contentId === content).map((r) => r.column.id || r.columnId).filter(Boolean));
    const graded = list.filter((d) => columns.has(d.gradebookColumnId));
    if (graded.length === 1) return graded[0];
    const named = new Set(arr(titles).map(fold).filter(Boolean));
    const titled = list.filter((d) => named.has(fold(d.title)));
    return titled.length === 1 ? titled[0] : null;
  };
  const promptOf = (discussion, text) => {
    const t = squash(text(str(discussion?.topic?.body, 200000))).slice(0, LIMIT.prompt);
    return t ? { text: t } : null;
  };
  // Who wrote a message, as Ultra shows it: nobody, for an anonymous post that isn't the student's.
  const authorOf = (m, mine) => (m?.postAsAnonymous && !mine ? '' : squash(str(m?.postedName) || [str(m?.givenName), str(m?.familyName)].filter(Boolean).join(' ')).slice(0, LIMIT.name));
  const DRAFT = /draft|delet/i;
  const at = (m) => Date.parse(m?.postDate || m?.createdDate || '') || 0;
  // Messages (top-level and replies, in any order, repeats allowed) → the thread: the newest LIMIT.posts that fit in
  // LIMIT.chars, the posts named in keep first (the one a reply answers), shown as Ultra nests them: each post, then its
  // replies, oldest first. → [{ id, parentId, author, text, mine, at }].
  const threadOf = (messages, { me = '', keep = [], text, posts = LIMIT.posts, chars = LIMIT.chars } = {}) => {
    const byId = new Map();
    for (const m of arr(messages)) {
      if (!ID.test(m?.id || '') || DRAFT.test(str(m.lifecycle)) || byId.has(m.id)) continue;
      const mine = !!me && m.userId === me;
      const t = squash(text(str(m.body?.rawText, 200000) || str(m.body?.displayText, 200000))).slice(0, LIMIT.post);
      if (!t) continue;
      byId.set(m.id, { id: m.id, parentId: ID.test(m.parentId || '') ? m.parentId : null, author: authorOf(m, mine), text: t, mine, at: at(m) });
    }
    const order = [...byId.values()].sort((a, b) => b.at - a.at);
    const want = new Set();
    for (let id of keep) for (let n = 0; id && byId.has(id) && n < 20; n++, id = byId.get(id).parentId) want.add(id);
    const kept = new Set();
    let used = 0;
    for (const x of [...[...want].map((id) => byId.get(id)), ...order]) {
      if (kept.has(x.id) || kept.size >= posts || (used + x.text.length > chars && !want.has(x.id))) continue;
      kept.add(x.id);
      used += x.text.length;
    }
    const items = [...kept].map((id) => byId.get(id));
    const children = new Map();
    for (const x of items) if (x.parentId && kept.has(x.parentId)) children.set(x.parentId, [...(children.get(x.parentId) || []), x]);
    const out = [];
    const walk = (x, depth) => { out.push(x); if (depth < 20) for (const c of (children.get(x.id) || []).sort((a, b) => a.at - b.at)) walk(c, depth + 1); };
    for (const x of items.filter((x) => !x.parentId || !kept.has(x.parentId)).sort((a, b) => a.at - b.at)) walk(x, 0);
    return out;
  };
  // The post a reply answers: from the thread; its text from the page when the thread didn't have it, its author never
  // from the page (Ultra names them only in its English button labels).
  const replyToOf = (thread, id, page = {}) => {
    if (!ID.test(id || '')) return null;
    const x = arr(thread).find((p) => p.id === id);
    const text = x?.text || squash(page.text).slice(0, LIMIT.post);
    return x || text ? { id, author: x?.author || '', text } : null;
  };
  // The student, as users/me names them (when it does), else as their own posts do.
  const userOf = (me, messages = []) => {
    const own = arr(messages).find((m) => me?.id && m?.userId === me.id && !m.postAsAnonymous);
    const given = squash(str(me?.givenName) || str(me?.name?.given) || str(own?.givenName)).slice(0, LIMIT.name);
    const family = squash(str(me?.familyName) || str(me?.name?.family) || str(own?.familyName)).slice(0, LIMIT.name);
    return { name: [given, family].filter(Boolean).join(' '), given, family };
  };
  // The frame's context for one box. A message: its course and the student. A post or reply: the rest, with the
  // requirements its kind answers to (GZ_WRITER_TARGET.forKind).
  const contextOf = ({ kind, course = null, user = null, prompt = null, requirements = null, thread = [], replyTo = null } = {}) => {
    const c = { kind, course: course && { id: course.id, name: course.name || '' }, user };
    if (kind === 'message') return c;
    return { ...c, prompt, requirements, thread, ...(kind === 'reply' && { replyTo }) };
  };

  // ---- the reads -------------------------------------------------------------------------------------------------------
  // r: lib/ultra.js read()'s { get, all, list }. Each returns raw answers; failures are the caller's.
  const FIELDS = 'id,title,available,topic.body,topic.status,gradebookColumnId';
  const discussions = async (r, cid) => (await r.list(`/learn/api/public/v1/courses/${cid}/discussions`, FIELDS)).items.filter((d) => d?.available !== false);
  const forumPath = (cid, forum) => `/learn/api/v1/courses/${cid}/discussionboards/default/forums/${forum}/messages`;
  // The forum's top-level messages, then the replies of the post a reply answers and of the newest posts that have any,
  // while the request budget lasts and the text read stays within twice the thread's budget.
  const messages = async (r, cid, forum, { first = '' } = {}) => {
    const base = forumPath(cid, forum);
    const top = arr(await r.all(base));
    const out = [...top];
    const kids = (m) => Number(m?.messageStatus?.numberOfChildrenNodraft ?? m?.messageStatus?.numberOfChildren) || 0;
    const ask = [...new Set([first, ...[...top].sort((a, b) => at(b) - at(a)).filter((m) => kids(m) > 0).map((m) => m.id)])].filter((id) => ID.test(id || ''));
    let read = top.reduce((n, m) => n + (Number(m?.bodyLength) || 0), 0);
    for (const id of ask.slice(0, LIMIT.replies)) {
      if (read > LIMIT.chars * 2) break;
      try {
        const got = arr(await r.all(`${base}/${id}/replies?limit=10&offset=0&sort=draft(desc),postDate(desc)`));
        out.push(...got);
        read += got.reduce((n, m) => n + (Number(m?.bodyLength) || 0), 0);
      } catch (e) { if (/budget|stale|HTTP (?:401|403|429|5\d\d)\b/i.test(e?.message)) break; }
    }
    return out;
  };

  // ---- on the page: features/writer.js's boxes -----------------------------------------------------------------------
  const KINDS = new Set(['post', 'reply', 'message']);
  const boxes = new Set();
  const sent = new WeakMap(); // box → { port, json } last sent
  let page = null; // { key, path, base: Promise, thread: Promise|null, data, threadAt, sig, timer }
  let X = null, observer = null;
  const alive = (box) => box.frame === null || !!box.frame?.isConnected;
  // A read-only Quill body's text as lib/writer-ultra.js reads one, from HTML parsed inert (a template: no scripts, no loads).
  const htmlText = (h) => {
    const t = document.createElement('template');
    t.innerHTML = String(h || '');
    const blocks = [...t.content.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, pre')];
    return blocks.length ? blocks.map((b) => squash(b.textContent)).filter(Boolean).join('\n') : squash(t.content.textContent);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reader = (live, signal) => X.need('lib/lmsq.js', () => globalThis.GZ_LMSQ).then(() => X.need('lib/ultra.js', () => globalThis.GZ_ULTRA))
    .then(() => GZ_ULTRA.read({ origin: location.origin, live, signal, f: (u, o) => GZ_LMSQ.fetch(u, o, 1, live), maxPages: LIMIT.pages, maxRequests: LIMIT.requests }));
  // The course's gradebook rows as content-ultra.js has them (bookFor asks once a minute at most), waited for a little.
  const rowsOf = async (cid, live) => {
    for (let i = 0; i < 16 && live(); i++) {
      const b = X.bookFor?.(cid);
      if (!b || Array.isArray(b.results) || (!b.pending && b.fail)) return arr(b?.results);
      await sleep(500);
    }
    return [];
  };
  const titles = () => [...document.querySelectorAll('h1')].map((h) => h.textContent).slice(0, 8);
  const courseOf = async (cid) => {
    const mem = await Promise.resolve(X.myCourses?.()).catch(() => []);
    const m = arr(mem).find((x) => x?.courseId === cid || x?.course?.id === cid);
    return { id: cid, name: squash(str(m?.course?.displayName) || str(m?.course?.name)).slice(0, LIMIT.name) };
  };
  // What a page's boxes share: the student, the course, the discussion and its prompt. Each part alone may fail.
  const loadBase = async (where, live, signal) => {
    if (!live()) throw Error('stale');
    // The student's id as content-ultra.js already asked it (users/me, once a page).
    const meP = Promise.resolve().then(() => X.me()).then((id) => (ID.test(id || '') ? { id } : null), () => null);
    const courseP = courseOf(where.course);
    if (!where.content) return { me: await meP, course: await courseP, discussion: null, prompt: null };
    const r = await reader(live, signal);
    const discussion = await Promise.all([discussions(r, where.course), rowsOf(where.course, live)])
      .then(([list, rows]) => discussionOf(list, { content: where.content, rows, titles: titles() })).catch(() => null);
    const prompt = discussion ? promptOf(discussion, htmlText) : null;
    const raw = prompt && globalThis.GZ_WRITER_TARGET ? GZ_WRITER_TARGET.parse(prompt.text, { lang: X.locale?.() }) : null;
    return { me: await meP, course: await courseP, discussion, prompt, raw };
  };
  // Each thread read has its own request budget.
  const loadThread = (p, first) => reader(p.live, p.abort.signal).then((r) => messages(r, p.where.course, p.data.base.discussion.id, { first })).catch(() => []);
  const replyId = (box) => globalThis.GZ_WRITER_ULTRA?.replyTo?.(box.editor) || box.context?.post?.id || '';

  // One box's context from what the page has read so far, sent when it differs from what that frame last got.
  const send = (box) => {
    if (!page?.live() || !box.port || !box.ready || !alive(box)) return;
    const d = page.data || {};
    const me = d.base?.me, raw = d.messages || [];
    const thread = d.base?.discussion ? threadOf(raw, { me: me?.id, keep: [...boxes].filter((b) => b.kind === 'reply').map(replyId), text: htmlText }) : [];
    const c = contextOf({
      kind: box.kind, course: d.base?.course || null, user: (me || raw.length) ? userOf(me, raw) : null, prompt: d.base?.prompt || null,
      requirements: d.base?.raw && globalThis.GZ_WRITER_TARGET ? GZ_WRITER_TARGET.forKind(d.base.raw, box.kind) : null,
      thread, replyTo: box.kind === 'reply' ? replyToOf(thread, replyId(box), box.context?.post) : null,
    });
    const json = JSON.stringify(c), last = sent.get(box);
    if (last?.port === box.port && last.json === json) return;
    sent.set(box, { port: box.port, json });
    box.port.postMessage({ type: 'context', context: c });
  };
  const sendAll = () => { for (const box of [...boxes]) { if (!alive(box)) boxes.delete(box); else send(box); } };
  const signature = () => [...document.querySelectorAll('[message-id]')].map((e) => e.getAttribute('message-id')).filter(Boolean).join(' ');
  // A new post (or one gone) on the page reads the thread again, at most every 20 s.
  const readThread = () => {
    if (!page?.live() || !page.data?.base?.discussion || page.thread) return;
    const p = page, first = [...boxes].filter((b) => b.kind === 'reply').map(replyId).find(Boolean) || '';
    p.threadAt = Date.now();
    p.sig = signature();
    p.thread = loadThread(p, first).then((m) => {
      if (!p.live()) return;
      p.data.messages = m;
      p.authors = new Map(m.filter((x) => ID.test(x?.id || '')).map((x) => [x.id, authorOf(x, !!p.data.base.me?.id && x.userId === p.data.base.me.id)]));
      sendAll();
    }).finally(() => { p.thread = null; });
  };
  const check = () => {
    page && (page.timer = 0);
    for (const box of [...boxes]) if (!alive(box)) boxes.delete(box);
    if (!boxes.size || !on()) { clear(); return; }
    if (!page?.live() || !page.data?.base?.discussion || signature() === page.sig) return;
    const wait = page.threadAt + 20000 - Date.now();
    if (wait > 0) page.timer = setTimeout(check, wait);
    else readThread();
  };
  const observe = () => {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => { if (page && !page.timer) page.timer = setTimeout(check, 2000); });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  const on = () => X?.on() && X.settings().enabled !== false && !!X.settings().enhance?.writer;
  const clear = () => {
    clearTimeout(page?.timer);
    page?.abort.abort();
    page = null;
    boxes.clear();
    observer?.disconnect();
    observer = null;
  };
  const unwatch = (box) => {
    boxes.delete(box);
    sent.delete(box);
    if (!boxes.size) clear();
  };
  // features/writer.js, as a box's frame comes up (and again when it reopens): context for post, reply and message boxes.
  const watch = (box, ctx) => {
    if (!box || !KINDS.has(box.kind) || !ctx) return;
    X = ctx;
    if (!on()) return;
    const where = route(location.pathname, location.search);
    if (!where) return;
    const key = `${location.pathname}?${where.content ? '' : where.course}`;
    if (page?.key !== key) {
      clear();
      const path = location.pathname, search = location.search, p = { key, where, data: null, threadAt: 0, sig: '', timer: 0, authors: new Map(), thread: null, abort: new AbortController() };
      p.live = () => page === p && on() && location.pathname === path && location.search === search && [...boxes].some(alive);
      page = p;
      X.need('lib/writer-target.js', () => globalThis.GZ_WRITER_TARGET).catch(() => {})
        .then(() => loadBase(where, p.live, p.abort.signal))
        .then((base) => { if (!p.live()) return; p.data = { base, messages: [] }; sendAll(); readThread(); }, () => {});
    }
    boxes.add(box);
    send(box);
    observe();
  };
  // Who wrote a message in this page's thread ('' when unknown): the Quote pop's author (features/writer-quote.js).
  const author = (id) => page?.authors?.get(id) || '';

  return { route, discussionOf, promptOf, authorOf, threadOf, replyToOf, userOf, contextOf, discussions, messages, forumPath, watch, unwatch, author, LIMIT };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_CONTEXT_DISCUSSION;
GZ_WRITER_CONTEXT_DISCUSSION;
