// Glaze Writer's issues: what proofing (Harper), the AI review, the format checks and citations flag, in one place, drawn
// as underlines (spelling red wavy, grammar and style amber wavy, format and citations blue dashed). Issues live in a
// ProseMirror plugin's state, so their positions are mapped through every transaction; one whose text changes is dropped.
//   issue = { from, to, source: 'harper'|'ai'|'format'|'cite', kind: 'spelling'|'grammar'|'style'|'format'|'citation',
//             message, suggestions: [string], sure, id } (from/to: document positions)
// GZ_WRITER_ISSUES (the frame's, on GZ_WRITER_FRAME's editor): set(source, issues[, { from, to }]) replaces that source's
// issues (only those inside from–to when given), clear(source), list(), on(fn) → off (fn(list) after each change),
// apply(issue, i) puts suggestion i in, ignore(issue) hides it and its like (same source, kind, text and message) for this box.
// bind(view) gives the same over any view-like { state, dispatch }; plugin(onChange) is the plugin. writer-proof.js draws
// the hover card.
// Classic script after lib/pm.js; module.exports for node.
var GZ_WRITER_ISSUES = globalThis.GZ_WRITER_ISSUES || (() => {
  const PM = typeof GZ_PM !== 'undefined' ? GZ_PM : (require('./writer-schema.js'), GZ_PM);
  const { Plugin, PluginKey } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const KINDS = new Set(['spelling', 'grammar', 'style', 'format', 'citation']), SOURCES = new Set(['harper', 'ai', 'format', 'cite']);
  const MAX = 2000;
  const key = new PluginKey('gzIssues');
  const look = (kind) => (kind === 'spelling' ? 'sp' : kind === 'format' || kind === 'citation' ? 'fm' : 'gr');
  const deco = (i) => Decoration.inline(i.from, i.to, { class: `gz-iss gz-iss-${look(i.kind)}`, 'data-issue': i.id }, { id: i.id });
  const textOf = (doc, from, to) => doc.textBetween(from, to, '\n', ' ');
  const likeKey = (i) => `${i.source}\u0000${i.kind}\u0000${i.text}\u0000${i.message}`;
  const wordy = (c) => /[\p{L}\p{M}\p{N}'’]/u.test(c);
  let seq = 0;

  // One issue from outside, checked: positions inside the document and inside one textblock's text, the text it covers
  // kept so a change to it drops the issue.
  const clean = (doc, source, i) => {
    if (!i || typeof i !== 'object') return null;
    const from = i.from, to = i.to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > doc.content.size) return null;
    const $from = doc.resolve(from);
    if (!$from.parent.inlineContent || $from.parent !== doc.resolve(to).parent) return null;
    const text = textOf(doc, from, to);
    if (!text.trim()) return null;
    return {
      from, to, source, kind: KINDS.has(i.kind) ? i.kind : 'grammar', text,
      message: typeof i.message === 'string' ? i.message.slice(0, 500) : '',
      suggestions: Array.isArray(i.suggestions) ? i.suggestions.filter((s) => typeof s === 'string' && s.length <= 400).slice(0, 8) : [],
      sure: i.sure === true, id: typeof i.id === 'string' && i.id.length <= 120 ? `${source}:${i.id}` : `${source}:${++seq}`,
      ...(typeof i.rule === 'string' ? { rule: i.rule } : {}),
    };
  };

  // Ranges a transaction changed, in the new document's positions.
  const touched = (tr) => {
    const out = [], maps = tr.mapping.maps;
    maps.forEach((m, k) => m.forEach((_a, _b, s, e) => { for (let j = k + 1; j < maps.length; j++) { s = maps[j].map(s, -1); e = maps[j].map(e, 1); } out.push([s, e]); }));
    return out;
  };

  const plugin = (onChange) => new Plugin({
    key,
    state: {
      init: () => ({ issues: [], deco: DecorationSet.empty, ignored: new Set() }),
      apply(tr, v, _old, state) {
        let { issues, deco: set, ignored } = v;
        if (tr.docChanged) {
          const hit = touched(tr), gone = new Set(), kept = [];
          for (const i of issues) {
            const from = tr.mapping.map(i.from, 1), to = tr.mapping.map(i.to, -1);
            const near = hit.some(([s, e]) => s <= to + 1 && e >= from - 1);
            let ok = to > from;
            if (ok && near) {
              ok = textOf(state.doc, from, to) === i.text;
              // A word that grew (typing on at its end) is a new word.
              if (ok && i.kind === 'spelling') ok = !wordy(textOf(state.doc, Math.max(0, from - 1), from)) && !wordy(textOf(state.doc, to, Math.min(state.doc.content.size, to + 1)));
            }
            if (ok) kept.push(from === i.from && to === i.to ? i : { ...i, from, to });
            else gone.add(i.id);
          }
          set = set.map(tr.mapping, state.doc);
          if (gone.size) set = set.remove(set.find(undefined, undefined, (s) => gone.has(s.id)));
          issues = gone.size || kept.some((i, k) => i !== issues[k]) ? kept : issues;
        }
        const m = tr.getMeta(key);
        if (m?.ignore) {
          ignored = new Set(ignored).add(likeKey(m.ignore));
          const gone = new Set(issues.filter((i) => likeKey(i) === likeKey(m.ignore)).map((i) => i.id));
          if (gone.size) { issues = issues.filter((i) => !gone.has(i.id)); set = set.remove(set.find(undefined, undefined, (s) => gone.has(s.id))); }
        }
        if (m?.set) {
          const { source, list, from = -1, to = Infinity } = m.set;
          const out = (i) => i.source === source && i.from >= from && i.to <= to;
          const gone = new Set(issues.filter(out).map((i) => i.id));
          const ids = new Set(issues.filter((i) => !out(i)).map((i) => i.id));
          const fresh = [];
          for (const raw of list) {
            const i = clean(state.doc, source, raw);
            if (!i || ignored.has(likeKey(i)) || i.from < from || i.to > to) continue;
            while (ids.has(i.id)) i.id += "'";
            ids.add(i.id);
            fresh.push(i);
          }
          if (gone.size) set = set.remove(set.find(undefined, undefined, (s) => gone.has(s.id)));
          if (fresh.length) set = set.add(state.doc, fresh.map(deco));
          issues = [...issues.filter((i) => !gone.has(i.id)), ...fresh].sort((a, b) => a.from - b.from || a.to - b.to).slice(0, MAX);
        }
        return issues === v.issues && set === v.deco && ignored === v.ignored ? v : { issues, deco: set, ignored };
      },
    },
    props: { decorations: (state) => key.getState(state).deco },
    view: () => ({ update: (view, prev) => { if (key.getState(view.state).issues !== key.getState(prev).issues) onChange?.(key.getState(view.state).issues); } }),
  });

  // The API over a view, or a function that returns one (the frame's editor appears later).
  const bind = (target) => {
    const view = () => (typeof target === 'function' ? target() : target);
    const fns = new Set();
    const ready = () => { const v = view(); return v && key.getState(v.state) ? v : null; };
    const list = () => { const v = ready(); return v ? key.getState(v.state).issues.slice() : []; };
    const notify = () => { const l = list(); for (const fn of fns) try { fn(l); } catch (e) { console.error(e); } };
    const send = (meta) => { const v = ready(); if (!v) return false; const before = key.getState(v.state).issues; v.dispatch(v.state.tr.setMeta(key, meta).setMeta('addToHistory', false)); if (!v.dom && key.getState(v.state).issues !== before) notify(); return true; };
    const find = (issue) => { const v = ready(); return v && issue ? key.getState(v.state).issues.find((i) => i.id === issue.id) || null : null; };
    return {
      set: (source, issues, range) => (SOURCES.has(source) && Array.isArray(issues) ? send({ set: { source, list: issues.slice(0, MAX), ...(range && Number.isInteger(range.from) && Number.isInteger(range.to) ? { from: range.from, to: range.to } : {}) } }) : false),
      clear: (source) => (SOURCES.has(source) ? send({ set: { source, list: [] } }) : false),
      list,
      on: (fn) => { if (typeof fn !== 'function') return () => {}; fns.add(fn); return () => fns.delete(fn); },
      apply: (issue, n = 0) => {
        const v = ready(), i = find(issue), s = i?.suggestions[n];
        if (!v || typeof s !== 'string' || textOf(v.state.doc, i.from, i.to) !== i.text) return false;
        v.dispatch(s ? v.state.tr.insertText(s, i.from, i.to) : v.state.tr.delete(i.from, i.to));
        if (!v.dom) notify();
        return true;
      },
      ignore: (issue) => { const i = find(issue); return i ? send({ ignore: i }) : false; },
      notify,
    };
  };

  // The frame's own: on GZ_WRITER_FRAME's editor, its plugin in before the editor is made.
  const frame = globalThis.GZ_WRITER_FRAME;
  const api = bind(() => frame?.editor()?.view);
  if (frame) frame.plugin(plugin(() => api.notify()));
  return { ...api, bind, plugin, key, clean, look };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_ISSUES; else GZ_WRITER_ISSUES;
