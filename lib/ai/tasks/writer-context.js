// What Glaze Writer's tasks (lib/ai/tasks/writer-*.js) read about the box a student writes in: the page's context
// (interfaces: { kind, course, prompt, thread, replyTo, assignment, style }) cleaned and bounded, and written as the
// request's reusable context blocks (lib/ai/text.js request: fenced as data, the tag kept while they stay the same). The
// student turned the feature on in Settings → AI; any connected model gets the whole thread (owner, 2026-10-26). A test is
// never read: clean() refuses kind 'test', so a task's input() refuses it too. Classic script for the worker (lib/background.js
// aiFiles); module.exports for node.
var GZ_AI_WRITER = globalThis.GZ_AI_WRITER || (() => {
  // Characters: the prompt, one post, the whole thread, the instructions, the rubric as text; posts and criteria kept.
  const LIMIT = { prompt: 8000, post: 4000, thread: 24000, posts: 80, title: 300, name: 120, instructions: 12000, rubric: 12000, criteria: 50, levels: 12 };
  const STYLES = { mla9: 'MLA 9', apa7: 'APA 7', chicago17: 'Chicago 17 (notes and bibliography)' };
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const code = (n) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ');
  // Rich text (a rubric cell, instructions as Ultra keeps them) as plain text: tags out, blocks as lines.
  const plain = (s) => String(s ?? '').replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? code(Number(/^#x/i.test(e) ? `0${e.slice(1)}` : e.slice(1))) : ENT[e.toLowerCase()] ?? m))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  // At most n characters, cut at a space when there is one in the last fifth.
  const cut = (s, n) => { if (s.length <= n) return s; const head = s.slice(0, n - 1), sp = head.lastIndexOf(' '); return `${sp > n * 0.8 ? head.slice(0, sp) : head}…`; };
  const str = (v, n) => (typeof v === 'string' && v.trim() ? cut(plain(v), n) : '');
  const line = (v, n = LIMIT.name) => str(v, n).replace(/\s+/g, ' ');

  // A lib/rubric.js model (criteria: [{ id, label, detail, points, weight, cells: [{ level, detail }] }], levels: [{ id,
  // label }]) or plain text → { text, ids: [{ id, label }] }.
  const rubric = (r) => {
    if (typeof r === 'string') return { text: str(r, LIMIT.rubric), ids: [] };
    if (!obj(r) || !Array.isArray(r.criteria)) return { text: '', ids: [] };
    const levels = new Map((Array.isArray(r.levels) ? r.levels : []).slice(0, LIMIT.levels).filter(obj).map((l) => [l.id, line(l.label)]));
    const ids = [], rows = [];
    let used = line(r.title, LIMIT.title).length;
    for (const c of r.criteria.slice(0, LIMIT.criteria)) {
      if (!obj(c) || typeof c.id !== 'string' || !/^[\w-]{1,40}$/.test(c.id)) continue;
      const label = line(c.label) || c.id;
      const worth = Number.isFinite(c.points) ? ` (${c.points} points)` : Number.isFinite(c.weight) ? ` (${c.weight}%)` : '';
      const cells = (Array.isArray(c.cells) ? c.cells : []).slice(0, LIMIT.levels).filter(obj).map((x) => { const d = str(x.detail, 600); return d ? `  ${levels.get(x.level) || 'Level'}: ${d.replace(/\n/g, ' ')}` : ''; }).filter(Boolean);
      const row = [`[${c.id}] ${label}${worth}`, ...(str(c.detail, 600) ? [`  ${str(c.detail, 600).replace(/\n/g, ' ')}`] : []), ...cells].join('\n');
      if (used + row.length + 1 > LIMIT.rubric) break;
      used += row.length + 1;
      ids.push({ id: c.id, label });
      rows.push(row);
    }
    return { text: cut([line(r.title, LIMIT.title), ...rows].filter(Boolean).join('\n'), LIMIT.rubric), ids };
  };

  // → the context cleaned, or null for a test (or anything that isn't one).
  const clean = (raw) => {
    if (raw === undefined || raw === null) return { kind: '', course: '', prompt: '', replyTo: null, thread: [], assignment: null, style: '' };
    if (!obj(raw) || raw.kind === 'test') return null;
    const post = (p) => (obj(p) && str(p.text, LIMIT.post) ? { author: line(p.author) || 'A classmate', text: str(p.text, LIMIT.post), mine: p.mine === true } : null);
    let left = LIMIT.thread;
    const thread = [];
    for (const p of (Array.isArray(raw.thread) ? raw.thread : []).slice(0, LIMIT.posts)) {
      const c = post(p);
      if (!c) continue;
      if ((left -= c.text.length) < 0) break;
      thread.push(c);
    }
    const a = obj(raw.assignment) ? raw.assignment : null;
    const r = rubric(a?.rubric);
    const assignment = a && (str(a.title, LIMIT.title) || str(a.instructions, LIMIT.instructions) || r.text)
      ? { title: line(a.title, LIMIT.title), instructions: str(a.instructions, LIMIT.instructions), rubric: r.text, criteria: r.ids } : null;
    return {
      kind: typeof raw.kind === 'string' ? raw.kind.slice(0, 20) : '',
      course: line(raw.course?.name, 200),
      prompt: str(raw.prompt?.text, LIMIT.prompt),
      replyTo: post(raw.replyTo), thread, assignment,
      style: Object.hasOwn(STYLES, raw.style) ? raw.style : '',
    };
  };

  // The context blocks of a request, in an order that stays the same while the student writes. thread: false leaves the
  // discussion out (a review or a citation needs none of it).
  const blocks = (ctx, { thread = true } = {}) => {
    if (!ctx) return [];
    const out = [];
    const add = (label, text) => { if (text) out.push({ label, text }); };
    add('course', ctx.course);
    add('citation style', STYLES[ctx.style] || '');
    add('discussion prompt', ctx.prompt);
    if (ctx.assignment) {
      add('assignment title', ctx.assignment.title);
      add('assignment instructions', ctx.assignment.instructions);
      add('rubric', ctx.assignment.rubric);
    }
    if (thread && ctx.thread.length) add('discussion thread', ctx.thread.map((p) => `${p.author}${p.mine ? ' (the student writing now)' : ''}:\n${p.text}`).join('\n\n'));
    if (thread && ctx.replyTo) add('post being answered', `${ctx.replyTo.author}:\n${ctx.replyTo.text}`);
    return out;
  };

  return { LIMIT, STYLES, plain, cut, clean, blocks, rubric };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_WRITER; else GZ_AI_WRITER;
