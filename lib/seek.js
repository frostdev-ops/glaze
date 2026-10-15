// Content search for the command palette on Canvas (features/search.js): what each course is asked, in what order, and
// how the answers are ranked and kept. Canvas's REST lists take a search_term (titles, 2 characters or more), so a course
// is one GET per kind. Classic script; module.exports for node. Loaded on demand: a second injection keeps the first.
var GZ_SEEK = globalThis.GZ_SEEK || (() => {
  const PER = 4; // results per course and kind, the best titles of the first 10 Canvas sends
  const id = (v) => (/^\d{1,20}$/.test(String(v)) ? String(v) : null);
  // Each kind: its list and, for one thing in the answer, [key, title, path]. The key is the same for one thing met twice
  // (a graded discussion is an assignment too). Paths are built from ids, so a result only ever opens this Canvas.
  const KINDS = [
    { kind: 'Page', list: 'pages', item: (x, c) => typeof x.url === 'string' && [`page:${id(x.page_id) || x.url}`, x.title, `/courses/${c}/pages/${encodeURIComponent(x.url)}`] },
    { kind: 'Assignment', list: 'assignments', item: (x, c) => id(x.id) && [id(x.discussion_topic?.id) ? `topic:${x.discussion_topic.id}` : `assignment:${x.id}`, x.name, `/courses/${c}/assignments/${x.id}`] },
    { kind: 'Discussion', list: 'discussion_topics', item: (x, c) => id(x.id) && [`topic:${x.id}`, x.title, `/courses/${c}/discussion_topics/${x.id}`] },
    { kind: 'Announcement', list: 'discussion_topics', also: '&only_announcements=true', item: (x, c) => id(x.id) && [`topic:${x.id}`, x.title, `/courses/${c}/discussion_topics/${x.id}`] },
    { kind: 'Module', list: 'modules', item: (x, c) => id(x.id) && [`module:${x.id}`, x.name, `/courses/${c}/modules/${x.id}`] },
    { kind: 'File', list: 'files', item: (x, c) => id(x.id) && [`file:${x.id}`, x.display_name, `/courses/${c}/files/${x.id}`] },
  ];

  // What is searched for: the query trimmed, at most 100 characters, or '' while it's under Canvas's 2.
  const term = (q) => { const s = String(q).trim().replace(/\s+/g, ' ').slice(0, 100); return s.length >= 2 ? s : ''; };

  // The course you're in first, then this term's (its dates around now; a term without dates counts), then the rest.
  // Only the term the course list names: never the account's terms.
  const current = (c, now) => !(Date.parse(c.term?.start_at) > now) && !(Date.parse(c.term?.end_at) < now);
  const order = (courses, here, now) => courses.filter((c) => id(c?.id))
    .map((c) => [c, c.id === here ? 0 : current(c, now) ? 1 : 2]).sort((a, b) => a[1] - b[1])
    .map(([c]) => ({ id: c.id, name: c.course_code || c.name || '' }));

  // Best titles first: the whole term, then starting with it, at a word start, anywhere; Canvas's order breaks ties.
  const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const score = (title, q) => {
    const t = fold(title);
    return t === q ? 4 : t.startsWith(q) ? 3 : ` ${t.replace(/[^\p{L}\p{N}]+/gu, ' ')}`.includes(` ${q.replace(/[^\p{L}\p{N}]+/gu, ' ')}`) ? 2 : t.includes(q) ? 1 : 0;
  };
  const rank = (q, items) => {
    const f = fold(q);
    return items.map((x, i) => [x, score(x.title, f), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([x]) => x);
  };
  // One kind's answer from one course, as results.
  const read = (k, answer, course) => (Array.isArray(answer) ? answer : [])
    .map((x) => x && k.item(x, course.id)).filter((r) => r && typeof r[1] === 'string' && r[1].trim())
    .map(([key, title, url]) => ({ key: `${course.id}/${key}`, title: title.trim(), url, kind: k.kind, course: course.name }));

  // Answers kept in memory for `ttl` (5 minutes), at most `cap` of them, oldest out first. Nothing goes to storage.
  const cache = (ttl = 300000, cap = 300, clock = Date.now) => {
    const m = new Map();
    return {
      get: (k) => { const e = m.get(k); if (e && clock() - e.at < ttl) return e.v; m.delete(k); return undefined; },
      set: (k, v) => { m.delete(k); m.set(k, { at: clock(), v }); while (m.size > cap) m.delete(m.keys().next().value); },
      get size() { return m.size; },
    };
  };

  // Ask every course (in `order`'s order) for every kind, `conc` requests at a time, so one or two courses are in flight.
  // `get(path)` answers with JSON. Results are given through onBatch(results) in that order, not as they arrive: a kind's
  // answer waits for the ones before it, so a slow answer from the course you're in still comes first and a faster one
  // from a later course can't take its place. Each batch is best first, never a thing already given. Once `limit` results
  // are in or waiting, nothing more is asked, and nothing past `limit` is given. An aborted signal stops it too: nothing
  // more is asked or given. Failures (a course whose files are hidden) count as empty. Resolves to the count.
  const search = async ({ term: q, courses, get, cache: kept, signal, onBatch, limit = 24, conc = 6 }) => {
    const jobs = courses.flatMap((c) => KINDS.map((k) => [c, k]));
    const answers = []; // by job, once in
    const seen = new Set();
    let found = 0, waiting = 0, next = 0, given = 0;
    const give = () => {
      for (; given < next && answers[given]; given++) {
        waiting -= answers[given].length;
        const fresh = answers[given].filter((r) => !seen.has(r.key) && seen.add(r.key)).slice(0, limit - found);
        if (fresh.length) { found += fresh.length; onBatch(fresh); }
      }
    };
    const work = async () => {
      while (next < jobs.length && found + waiting < limit && !signal?.aborted) {
        const i = next++;
        const [c, k] = jobs[i];
        const key = `${c.id}|${k.kind}|${q.toLowerCase()}`; // Canvas ignores case, not accents
        let got = kept?.get(key);
        if (!got) {
          try {
            got = rank(q, read(k, await get(`/courses/${c.id}/${k.list}?search_term=${encodeURIComponent(q)}&per_page=10${k.also || ''}`), c)).slice(0, PER);
            kept?.set(key, got);
          } catch { got = []; }
        }
        if (signal?.aborted) return;
        answers[i] = got;
        waiting += got.length;
        give();
      }
    };
    await Promise.all(Array.from({ length: conc }, work));
    return found;
  };

  return { KINDS, PER, term, order, rank, read, cache, search };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value (lib/background.js).
if (typeof module !== 'undefined') module.exports = GZ_SEEK; else GZ_SEEK;
