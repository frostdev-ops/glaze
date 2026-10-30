// Declarative widgets: a mod without code whose tiles and rail widgets are lists of blocks in its mod.json. Glaze draws them
// itself, from the blocks and the student's own data on this device; nothing a mod supplies ever runs, and a block can name
// only what the allowlists below hold: data paths, Glaze's own button actions and the mod's own pictures. blocks() is a
// strict cleaner like the others (lib/modapi.js): an unknown key, a wrong type or a value over a limit refuses the whole
// list (null) and nothing is trimmed, so what was signed is what gets drawn. resolve() turns cleaned blocks and the data a
// widget was granted into a component tree, which the worker cleans once more and features/modui.js draws.
//
// Text takes {path} holes and {{ }} for a brace; nothing else in it is special and it is only ever set as text. The data
// paths, each needing the permission shown (the mod declares it, with a reason, and the student grants it):
//   next.title, next.course, next.due    the soonest open to-do that is due from now on            todo
//   todo.count, todo.overdue, todo.today open to-dos; past due; due today (this device's day)       todo
//   todo.done, todo.total                to-dos done or handed in; all that Glaze has for you         todo
//   todo.items, schedule.today           open to-dos, soonest first; today's, by time                 todo
//   grades.gpa, grades.average           grade points (4.0, courses weighted equally); percent        grades
//   grades.courses                       "Course: 91%" for each course Insights has graded            grades
//   courses.count, courses.names         the courses Glaze has seen on this site                      courses
// Buttons run one of Glaze's own actions: next (the next to-do's page), course (its course), dashboard, courses, grades or
// calendar, never an address the mod chose. Classic script for the worker, the editor and node.
var GZ_MODWIDGET = globalThis.GZ_MODWIDGET || (() => {
  const A = () => (typeof GZ_MODAPI !== 'undefined' ? GZ_MODAPI : require('./modapi.js'));
  const C = () => (typeof GZ_GRADECALC !== 'undefined' ? GZ_GRADECALC : require('./gradecalc.js'));
  const own = (o, k) => Object.hasOwn(o, k);
  const LIMIT = { blocks: 12, template: 200, holes: 8, items: 10, line: 120, shown: 80 };

  // path → [kind, permission]. kind: text, number, time (ms since 1970) or list (lines of text).
  const PATHS = {
    'next.title': ['text', 'todo'], 'next.course': ['text', 'todo'], 'next.due': ['time', 'todo'],
    'todo.count': ['number', 'todo'], 'todo.overdue': ['number', 'todo'], 'todo.today': ['number', 'todo'], 'todo.done': ['number', 'todo'], 'todo.total': ['number', 'todo'],
    'todo.items': ['list', 'todo'], 'schedule.today': ['list', 'todo'],
    'grades.gpa': ['number', 'grades'], 'grades.average': ['number', 'grades'], 'grades.courses': ['list', 'grades'],
    'courses.count': ['number', 'courses'], 'courses.names': ['list', 'courses'],
  };
  const ACTIONS = ['next', 'course', 'dashboard', 'courses', 'grades', 'calendar'];
  const kind = (p) => (typeof p === 'string' && own(PATHS, p) ? PATHS[p][0] : null);

  // ---- the cleaner -----------------------------------------------------------------------------------------------
  const path = (want) => (v) => (kind(v) === want ? v : null);
  // A number block's value: a number written in, or a number path. A time: milliseconds written in, or a time path.
  const number = (lo, hi) => (v) => (typeof v === 'number' ? A().num(lo, hi)(v) : path('number')(v));
  const when = (v) => (typeof v === 'number' ? A().num(0, 1e13, true)(v) : path('time')(v));
  // The mod's own picture: the component tree's rule for an image source.
  const picture = (v) => A().tree({ type: 'image', src: v, alt: 'x' })?.src ?? null;
  // {path}, {{ and }} are the only special things; any other brace refuses.
  const HOLE = /\{\{|\}\}|\{([a-z]+\.[a-z]+)\}|[{}]/g;
  const holes = (s) => {
    const out = [];
    for (const m of s.matchAll(HOLE)) { if (m[1]) out.push(m[1]); else if (m[0].length === 1) return null; }
    return out;
  };
  const template = (v) => {
    const s = A().str(LIMIT.template, { lines: true, empty: false })(v);
    const h = s && holes(s);
    return h && h.length <= LIMIT.holes && h.every((p) => ['text', 'number', 'time'].includes(kind(p))) ? s : null;
  };
  let spec = null;
  const specs = () => (spec ||= (() => {
    const { str, num, bool, oneOf, color } = A();
    const size = oneOf(['xs', 's', 'm', 'l', 'xl']);
    return {
      text: [{ text: template, size, weight: oneOf(['normal', 'bold']), color, muted: bool }, ['text']],
      number: [{ value: number(-1e15, 1e15), label: str(80), unit: str(12), digits: num(0, 4, true), size, color }, ['value']],
      ring: [{ value: number(-1e15, 1e15), max: number(1e-9, 1e15), label: str(80), color }, ['value']],
      list: [{ items: path('list'), max: num(1, LIMIT.items, true), ordered: bool, label: str(80), empty: str(80) }, ['items']],
      countdown: [{ to: when, label: str(80), done: str(80) }, ['to']],
      image: [{ src: picture, alt: str(200), w: num(1, 2000, true), h: num(1, 2000, true), fit: oneOf(['contain', 'cover']) }, ['src', 'alt']],
      button: [{ label: str(60, { empty: false }), action: oneOf(ACTIONS), tone: oneOf(['primary', 'plain']) }, ['label', 'action']],
    };
  })());
  const block = (v) => {
    if (!A().isObj(v) || typeof v.type !== 'string' || !own(specs(), v.type)) return null;
    const [fields, req] = specs()[v.type];
    return A().shape({ type: A().oneOf([v.type]), ...fields }, ['type', ...req])(v);
  };
  // → the cleaned blocks (1 to 12), or null.
  const blocks = (raw) => { const l = A().list(block, LIMIT.blocks)(raw); return l && l.length ? l : null; };

  // The paths a block names, the permissions they need, the pictures it draws.
  const used = (b) => [...(b.type === 'text' ? holes(b.text) || [] : []), ...[b.value, b.max, b.items, b.to].filter((x) => typeof x === 'string')];
  const needs = (list) => [...new Set(list.flatMap((b) => [...used(b).map((p) => PATHS[p][1]), ...(b.type === 'button' && ['next', 'course'].includes(b.action) ? ['todo'] : [])]))].sort();
  const images = (list) => list.filter((b) => b.type === 'image').map((b) => b.src);
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon)}]` : A().isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)}}` : JSON.stringify(v));
  // Two values with the same data, whatever the order of their keys.
  const same = (a, b) => canon(a) === canon(b);
  // A manifest's declarative slots: [{ key: tile:<id> | rail:<id>, name, size }].
  const slots = (m) => ['tiles', 'rail'].flatMap((k) => (Array.isArray(m?.ui?.[k]) ? m.ui[k] : []).filter((e) => A().isObj(e) && Array.isArray(e.blocks) && typeof e.id === 'string')
    .map((e) => ({ key: `${k === 'tiles' ? 'tile' : 'rail'}:${e.id}`, name: String(e.name ?? '').slice(0, 40), size: k === 'tiles' && ['s', 'm', 'l'].includes(e.sizes?.[0]) ? e.sizes[0] : 's' })));

  // ---- the data --------------------------------------------------------------------------------------------------
  // The data a widget was granted, for resolve: read(perm) answers with the planner's items, the grades or the courses (the
  // broker's own calls, which keep to this site and their slim shapes); a permission not in `perms` is left out entirely.
  const collect = async (perms, read) => {
    const out = {};
    await Promise.all(perms.map(async (p) => { out[p] = await read(p).then((v) => (Array.isArray(v) ? v : []), () => []); }));
    return out;
  };
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dayEnd = (t) => { const d = new Date(t); d.setHours(24, 0, 0, 0); return d.getTime(); };
  const clip = (s, n) => { const c = [...String(s)]; return c.length > n ? `${c.slice(0, n - 1).join('')}…` : c.join(''); };
  const formats = (lang) => {
    const make = (l) => ({ n: new Intl.NumberFormat(l, { maximumFractionDigits: 2 }), d: new Intl.DateTimeFormat(l, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), h: new Intl.DateTimeFormat(l, { hour: 'numeric', minute: '2-digit' }) });
    try { return make(lang); } catch { return make(undefined); }
  };
  // path → value, from the data that came: undefined for no value (not granted, or nothing to say).
  const values = (data, now, lang) => {
    const F = formats(lang), isObj = A().isObj;
    const items = Array.isArray(data.todo) ? data.todo.filter(isObj) : [];
    // A time the tree can carry (a countdown's `to` is whole milliseconds from 1970 to 1e13); anything else is no time.
    const due = (i) => (Number.isFinite(i.due) && i.due >= 0 && i.due <= 1e13 ? Math.round(i.due) : null);
    const open = items.filter((i) => !i.done && !i.submitted);
    const byDue = (a, b) => (due(a) ?? Infinity) - (due(b) ?? Infinity);
    const next = open.filter((i) => due(i) !== null && due(i) >= now).sort(byDue);
    const lo = dayStart(now), hi = dayEnd(now);
    const here = (i) => due(i) !== null && due(i) >= lo && due(i) < hi;
    const marks = (Array.isArray(data.grades) ? data.grades : []).filter((g) => isObj(g) && Number.isFinite(g.percent) && Math.abs(g.percent) <= 1000);
    const mean = (l) => l.reduce((n, x) => n + x, 0) / l.length;
    const course = (Array.isArray(data.courses) ? data.courses : []).filter((c) => isObj(c) && typeof c.name === 'string');
    const todo = (f) => (Array.isArray(data.todo) ? f() : undefined);
    const grades = (f) => (Array.isArray(data.grades) ? f() : undefined);
    const points = marks.map((g) => C().points(C().letter(g.percent), true)).filter(Number.isFinite);
    const line = (parts) => clip(parts.filter(Boolean).join(' · '), LIMIT.line);
    const V = {
      'next.title': () => todo(() => next[0]?.title || undefined),
      'next.course': () => todo(() => next[0]?.course || undefined),
      'next.due': () => todo(() => (next[0] ? due(next[0]) : undefined)),
      'todo.count': () => todo(() => open.length),
      'todo.overdue': () => todo(() => open.filter((i) => due(i) !== null && due(i) < now).length),
      'todo.today': () => todo(() => open.filter(here).length),
      'todo.done': () => todo(() => items.length - open.length),
      'todo.total': () => todo(() => items.length),
      'todo.items': () => todo(() => [...open].sort(byDue).map((i) => line([i.title, i.course, due(i) !== null && F.d.format(due(i))]))),
      'schedule.today': () => todo(() => items.filter(here).sort(byDue).map((i) => line([`${i.done || i.submitted ? '✓ ' : ''}${F.h.format(due(i))}`, i.title]))),
      'grades.gpa': () => grades(() => (points.length ? mean(points) : undefined)),
      'grades.average': () => grades(() => (marks.length ? mean(marks.map((g) => g.percent)) : undefined)),
      'grades.courses': () => grades(() => marks.map((g) => line([`${g.name || ''}: ${F.n.format(g.percent)}%`]))),
      'courses.count': () => (Array.isArray(data.courses) ? course.length : undefined),
      'courses.names': () => (Array.isArray(data.courses) ? course.map((c) => clip(c.name, LIMIT.line)) : undefined),
    };
    return { F, V, next, hi };
  };

  // Example data for a preview before the student's own exists.
  const sample = (now = Date.now()) => ({
    todo: [{ title: 'Lab report', course: 'Biology', due: now + 3 * 36e5 }, { title: 'Read chapter 4', course: 'History', due: now + 30 * 36e5 },
      { title: 'Problem set 5', course: 'Calculus', due: now - 36e5 }, { title: 'Quiz 2', course: 'Chemistry', due: now + 80 * 36e5, done: true }],
    grades: [{ name: 'Biology', percent: 91.5 }, { name: 'History', percent: 84 }, { name: 'Calculus', percent: 77.2 }],
    courses: [{ name: 'Biology' }, { name: 'History' }, { name: 'Calculus' }],
  });

  // ---- drawing ---------------------------------------------------------------------------------------------------
  // blocks: cleaned. data: { todo, grades, courses }, a key only for a permission granted. paths: the mod's own files, for
  // pictures (null: any). → { tree (cleaned, or null), acts { button id: action }, links { next, cid }, why ('' | 'denied' |
  // 'empty'), until (ms: when the answer next changes by itself) }. A block whose data has no value is left out.
  const resolve = (list, data = {}, { now = Date.now(), lang, paths = null } = {}) => {
    const { F, V, next, hi } = values(data, now, lang);
    let denied = false;
    const get = (p) => {
      const v = V[p]();
      if (v === undefined && !Array.isArray(data[PATHS[p][1]])) denied = true;
      return v;
    };
    const shown = (p) => {
      const v = get(p), k = kind(p);
      return v === undefined ? '–' : k === 'time' ? F.d.format(v) : k === 'number' ? F.n.format(v) : clip(v, LIMIT.shown);
    };
    const has = (src) => (typeof src === 'number' ? src : get(src));
    const link = Array.isArray(data.todo) ? next[0] : null;
    const links = { next: typeof link?.url === 'string' ? link.url : '', cid: typeof link?.courseId === 'string' ? link.courseId : '' };
    const take = (b, keys) => Object.fromEntries(keys.filter((k) => own(b, k)).map((k) => [k, b[k]]));
    const nodes = [], acts = {};
    list.forEach((b, i) => {
      let n = null;
      if (b.type === 'text') n = { type: 'text', text: clip(b.text.replace(HOLE, (m, p) => (m === '{{' ? '{' : m === '}}' ? '}' : shown(p))), A().LIMIT.text), ...take(b, ['size', 'weight', 'color', 'muted']) };
      else if (b.type === 'number') { const v = has(b.value); if (v !== undefined) n = { type: 'number', value: v, ...take(b, ['label', 'unit', 'digits', 'size', 'color']) }; }
      else if (b.type === 'ring') {
        const v = has(b.value), max = b.max === undefined ? 100 : has(b.max);
        if (v !== undefined && max !== undefined && max > 0) n = { type: 'ring', value: v, max, ...take(b, ['label', 'color']) };
      } else if (b.type === 'list') {
        const lines = get(b.items);
        if (lines !== undefined) {
          const rows = lines.slice(0, b.max ?? 5);
          if (rows.length) n = { type: 'list', children: rows.map((text) => ({ type: 'text', text, size: 's' })), ...take(b, ['ordered', 'label']) };
          else if (b.empty) n = { type: 'text', text: b.empty, size: 's', muted: true };
        }
      } else if (b.type === 'countdown') { const v = has(b.to); if (v !== undefined) n = { type: 'countdown', to: v, ...take(b, ['label', 'done']) }; }
      else if (b.type === 'image') { if (!paths || paths.includes(b.src)) n = { type: 'image', ...take(b, ['src', 'alt', 'w', 'h', 'fit']) }; }
      else if (b.type === 'button') {
        const id = `b${i}`;
        acts[id] = b.action;
        n = { type: 'button', id, label: b.label, ...take(b, ['tone']), ...(((b.action === 'next' && !links.next) || (b.action === 'course' && !links.cid)) && { disabled: true }) };
      }
      if (n) nodes.push(n);
    });
    const tree = nodes.length ? A().tree({ type: 'stack', gap: 2, children: nodes }) : null;
    return { tree, acts: tree ? acts : {}, links, why: tree ? '' : denied ? 'denied' : 'empty', until: Math.min(hi, next[0] ? next[0].due : Infinity) };
  };

  return { PATHS, ACTIONS, LIMIT, kind, blocks, needs, images, same, slots, collect, resolve, sample };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODWIDGET; else GZ_MODWIDGET;
