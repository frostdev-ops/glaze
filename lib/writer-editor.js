// Glaze Writer's editor: a ProseMirror view over GZ_WRITER_SCHEMA in compose or paper mode, with history, the keymap,
// Markdown and typography input rules, and the commands a toolbar runs by name. The frame draws the UI around it;
// proofing and ghost text come in as plugins, ahead of these so their keys win. Commands, keys and input rules work on an
// EditorState alone (node tests); only create() needs a page.
// Classic script after lib/pm.js and lib/writer-schema.js; module.exports for node.
var GZ_WRITER_EDITOR = globalThis.GZ_WRITER_EDITOR || (() => {
  const S = typeof GZ_WRITER_SCHEMA !== 'undefined' ? GZ_WRITER_SCHEMA : require('./writer-schema.js');
  const { EditorState, TextSelection, Plugin } = GZ_PM.state;
  const { ReplaceAroundStep } = GZ_PM.transform;
  const { Slice, Fragment } = GZ_PM.model;
  const { toggleMark, baseKeymap, chainCommands, splitBlockAs, newlineInCode, createParagraphNear, liftEmptyBlock } = GZ_PM.commands;
  const { history, undo, redo, closeHistory } = GZ_PM.history;
  const { keymap } = GZ_PM.keymap;
  const { inputRules, InputRule, smartQuotes, emDash, undoInputRule } = GZ_PM.inputrules;

  const ALIGNS = ['left', 'center', 'right', 'justify'];
  // Word's font size steps (⌘⇧> and ⌘⇧<).
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  const LISTS = { bullet_list: 'bullet', ordered_list: 'ordered' };
  const isPaper = (schema) => schema === S.paper;
  const pick = (type, attrs) => { const out = {}; for (const k of Object.keys(type.attrs)) if (attrs && k in attrs) out[k] = attrs[k]; return out; };

  // Words as Word and Ultra's status bar count them: runs between spaces with a letter or digit in them.
  const words = (text) => String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  // The textblocks the selection touches, in document order.
  const lines = (state) => {
    const out = [], { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => { if (!node.isTextblock) return true; out.push({ node, pos, parent: state.doc.resolve(pos).parent }); return false; });
    return out;
  };
  // One textblock to another kind ({ list } or { type }, with attrs), as steps that keep positions mapping (so selection,
  // proofing underlines and ghost text follow). An item leaves its list by splitting the list around it first.
  const retype = (tr, pos, want) => {
    const s = tr.doc.type.schema, node = tr.doc.nodeAt(pos), $pos = tr.doc.resolve(pos), parent = $pos.parent;
    if (LISTS[parent.type.name]) {
      if (want.list === parent.type.name) { tr.setNodeMarkup(pos, null, want.attrs); return; }
      const index = $pos.index();
      let at = $pos.before();
      if (index < parent.childCount - 1) tr.split(pos + node.nodeSize);
      if (index > 0) { tr.split(pos); at = pos + 1; }
      if (want.list) { tr.setNodeMarkup(at, s.nodes[want.list]); tr.setNodeMarkup(at + 1, null, want.attrs); return; }
      tr.step(new ReplaceAroundStep(at, at + node.nodeSize + 2, at + 2, at + node.nodeSize, new Slice(Fragment.from(want.type.create(want.attrs)), 0, 0), 1, true));
      return;
    }
    if (want.list) {
      const wrapper = s.nodes[want.list].create(null, s.nodes.list_item.create(want.attrs));
      tr.step(new ReplaceAroundStep(pos, pos + node.nodeSize, pos + 1, pos + node.nodeSize - 1, new Slice(Fragment.from(wrapper), 0, 0), 2, true));
      return;
    }
    tr.setNodeMarkup(pos, want.type, want.attrs);
  };
  // want(line) → { list | type, attrs } or null to leave it; last line first, so earlier positions stay put.
  const setLines = (want) => (state, dispatch) => {
    const todo = lines(state).filter((l) => !l.node.type.spec.code).map((l) => ({ ...l, want: want(l) })).filter((l) => l.want);
    if (!todo.length) return false;
    if (dispatch) { const tr = state.tr; for (const l of todo.reverse()) retype(tr, l.pos, l.want); dispatch(tr.scrollIntoView()); }
    return true;
  };
  const setAttr = (key, value) => (state, dispatch) => {
    const todo = lines(state).filter((l) => key in l.node.attrs && l.node.attrs[key] !== (typeof value === 'function' ? value(l.node.attrs[key]) : value));
    if (!todo.length) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const l of todo) tr.setNodeMarkup(l.pos, null, { ...l.node.attrs, [key]: typeof value === 'function' ? value(l.node.attrs[key]) : value });
      dispatch(tr);
    }
    return true;
  };
  // The extent of the link at the caret (or the selection).
  const linkRange = (state) => {
    const { $from, from, to, empty } = state.selection, type = state.schema.marks.link;
    if (!empty) return { from, to };
    let hit = null, open = null;
    $from.parent.forEach((c, off) => {
      const a = $from.start() + off, b = a + c.nodeSize, mark = type.isInSet(c.marks);
      open = mark && open && open.mark.eq(mark) ? { ...open, to: b } : mark ? { mark, from: a, to: b } : null;
      if (open && open.from <= $from.pos && $from.pos <= open.to) hit = open;
    });
    return hit;
  };
  const allHave = (state, from, to, type) => {
    let any = false, all = true;
    state.doc.nodesBetween(from, to, (n) => { if (n.isText) { any = true; if (!type.isInSet(n.marks)) all = false; } });
    return any && all;
  };

  // Every command by the name run() takes: name → (arg) → (state, dispatch) → bool.
  const commands = (schema) => {
    const n = schema.nodes, m = schema.marks, paper = isPaper(schema), levels = n.heading.spec.levels;
    const listName = (l) => (LISTS[l.parent.type.name] ? l.parent.type.name : null);
    const toggleList = (name) => (state, dispatch) => {
      const all = lines(state).filter((l) => !l.node.type.spec.code).every((l) => listName(l) === name);
      return setLines((l) => (all ? { type: n.paragraph, attrs: pick(n.paragraph, l.node.attrs) } : listName(l) === name ? null : { list: name, attrs: pick(n.list_item, l.node.attrs) }))(state, dispatch);
    };
    const heading = (level) => (state, dispatch) => {
      if (level && !levels.includes(level)) return false;
      return setLines((l) => (level
        ? (l.node.type === n.heading && l.node.attrs.level === level ? null : { type: n.heading, attrs: { ...pick(n.heading, l.node.attrs), level } })
        : (l.node.type === n.heading ? { type: n.paragraph, attrs: pick(n.paragraph, l.node.attrs) } : null)))(state, dispatch);
    };
    // A paper paragraph with an exact left indent of its own (an imported file's) moves it by the same half inch.
    const indent = (d) => (state, dispatch) => {
      const own = paper && lines(state).filter((l) => l.node.attrs.left != null);
      if (!own?.length) return setAttr('indent', (v) => Math.max(0, Math.min(S.MAX_INDENT, v + d)))(state, dispatch);
      if (dispatch) { const tr = state.tr; for (const l of own) tr.setNodeMarkup(l.pos, null, { ...l.node.attrs, left: Math.max(0, Math.min(S.MAX_INDENT / 2, Math.round((l.node.attrs.left + d / 2) * 100) / 100)) }); dispatch(tr); }
      return true;
    };
    const FORMAT = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'text_style', 'color', 'highlight', 'small_caps', 'all_caps'].map((k) => m[k]).filter(Boolean);
    const clear = (state, dispatch) => {
      const { from, to, empty, $from } = state.selection;
      if (empty) {
        const marks = state.storedMarks || $from.marks();
        if (!marks.some((k) => FORMAT.includes(k.type))) return false;
        dispatch?.(state.tr.setStoredMarks(marks.filter((k) => !FORMAT.includes(k.type))));
        return true;
      }
      if (!FORMAT.some((t) => state.doc.rangeHasMark(from, to, t))) return false;
      if (dispatch) { const tr = state.tr; for (const t of FORMAT) tr.removeMark(from, to, t); dispatch(tr); }
      return true;
    };
    const link = (url) => (state, dispatch) => {
      const r = linkRange(state);
      if (url == null || url === '') {
        if (!r || !state.doc.rangeHasMark(r.from, r.to, m.link)) return false;
        dispatch?.(state.tr.removeMark(r.from, r.to, m.link));
        return true;
      }
      const href = S.href(url, true), { $from } = state.selection;
      if (!href || $from.parent.type.spec.code) return false;
      if (dispatch) {
        const mark = m.link.create({ href }), tr = state.tr;
        if (r) tr.removeMark(r.from, r.to, m.link).addMark(r.from, r.to, mark);
        else tr.insert($from.pos, schema.text(href, mark.addToSet(state.storedMarks || $from.marks())));
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
    // Compose has no blockquote (Ultra's Quill keeps none): a quote is indented italic lines, then "— Name".
    const quote = (o) => (state, dispatch) => {
      const said = String(o?.text ?? '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!said.length) return false;
      if (!dispatch) return true;
      const who = String(o?.author ?? '').replace(/\s+/g, ' ').trim();
      const quoted = paper
        ? [n.blockquote.create(null, [...said.map((l) => n.paragraph.create(null, schema.text(l))), ...(who ? [n.paragraph.create(null, schema.text(`— ${who}`))] : [])])]
        : [...said.map((l) => n.paragraph.create({ indent: 1 }, schema.text(l, [m.italic.create()]))), ...(who ? [n.paragraph.create({ indent: 1 }, schema.text(`— ${who}`))] : [])];
      const { $from } = state.selection, top = $from.depth ? $from.node(1) : null;
      const empty = top && top.type === n.paragraph && !top.content.size;
      const at = !top ? state.selection.from : empty ? $from.before(1) : $from.after(1), end = empty ? $from.after(1) : at;
      const tr = state.tr.replaceWith(at, end, [...quoted, n.paragraph.create()]);
      const caret = at + quoted.reduce((size, b) => size + b.nodeSize, 0) + 1;
      dispatch(tr.setSelection(TextSelection.create(tr.doc, caret)).scrollIntoView());
      return true;
    };
    // Plain text at the selection, in its marks; each newline starts a new block like the one it's in.
    const insertText = (text) => (state, dispatch) => {
      const parts = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
      if (!parts.join('') && parts.length < 2) return false;
      if (dispatch) {
        const tr = state.tr, marks = state.storedMarks || state.selection.$from.marks();
        if (state.selection.$from.parent.type.spec.code) tr.insertText(parts.join('\n'));
        else {
          tr.deleteSelection();
          parts.forEach((p, i) => { if (i) tr.split(tr.selection.from); if (p) tr.replaceSelectionWith(schema.text(p, marks), false); });
        }
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
    // ---- paper run formatting and paragraph settings
    const runStyle = (state) => {
      const { from, to, empty, $from } = state.selection;
      if (empty) return m.text_style?.isInSet(state.storedMarks || $from.marks()) || null;
      let hit;
      state.doc.nodesBetween(from, to, (x) => { if (hit === undefined && x.isText) hit = m.text_style.isInSet(x.marks) || null; return hit === undefined; });
      return hit || null;
    };
    // text_style's font or size over the selection, each run keeping its other part; with no selection, what typing carries.
    const style = (key, value) => (state, dispatch) => {
      const t = m.text_style, { from, to, empty, $from } = state.selection;
      if ($from.parent.type.spec.code) return false;
      const next = (old) => { const a = { font: old?.attrs.font ?? null, size: old?.attrs.size ?? null, [key]: value }; return a.font || a.size ? t.create(a) : null; };
      if (empty) {
        const marks = state.storedMarks || $from.marks(), made = next(t.isInSet(marks)), rest = marks.filter((x) => x.type !== t);
        dispatch?.(state.tr.setStoredMarks(made ? made.addToSet(rest) : rest));
        return true;
      }
      if (dispatch) {
        const tr = state.tr, runs = [];
        state.doc.nodesBetween(from, to, (x, pos) => { if (x.isText) runs.push([Math.max(from, pos), Math.min(to, pos + x.nodeSize), next(t.isInSet(x.marks))]); return true; });
        for (const [a, b, made] of runs) { tr.removeMark(a, b, t); if (made) tr.addMark(a, b, made); }
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
    // A mark with attributes in place of whatever of its type is there (null: none).
    const swap = (type, attrs) => (state, dispatch) => {
      const { from, to, empty, $from } = state.selection;
      if ($from.parent.type.spec.code) return false;
      if (empty) {
        const rest = (state.storedMarks || $from.marks()).filter((x) => x.type !== type);
        dispatch?.(state.tr.setStoredMarks(attrs ? type.create(attrs).addToSet(rest) : rest));
        return true;
      }
      if (!attrs && !state.doc.rangeHasMark(from, to, type)) return false;
      if (dispatch) { const tr = state.tr.removeMark(from, to, type); if (attrs) tr.addMark(from, to, type.create(attrs)); dispatch(tr.scrollIntoView()); }
      return true;
    };
    const clampN = (v, lo, hi) => (v == null || v === '' ? null : Number.isFinite(+v) ? Math.round(Math.min(hi, Math.max(lo, +v)) * 100) / 100 : undefined);
    const RANGE = { before: [0, 1584], after: [0, 1584], exact: [0.5, 1584], least: [0.5, 1584], line: [0.5, 4], left: [-22, 22], right: [-22, 22], first: [-22, 22] };
    const paraPatch = (p) => {
      if (!p || typeof p !== 'object') return null;
      const out = {};
      for (const [k, [lo, hi]] of Object.entries(RANGE)) if (k in p) { const v = clampN(p[k], lo, hi); if (v === undefined) return null; out[k] = v; }
      if ('align' in p) { if (p.align != null && !ALIGNS.includes(p.align)) return null; out.align = p.align ?? null; }
      if ('keepNext' in p) out.keepNext = p.keepNext ? true : null;
      if ('keepLines' in p) out.keepLines = p.keepLines ? true : null;
      if ('widow' in p) out.widow = p.widow === false ? false : null;
      return Object.keys(out).length ? out : null;
    };
    const paraAttrs = (node, want) => {
      const a = { ...node.attrs }, own = Object.fromEntries(Object.entries(want).filter(([k]) => k in a));
      Object.assign(a, own);
      if (a.align === 'left' && node.type !== n.heading) a.align = null;
      for (const k of ['line', 'exact', 'least']) if (want[k] != null) for (const other of ['line', 'exact', 'least']) if (other !== k) a[other] = null;
      if ('left' in want && node.type !== n.list_item) {
        const v = want.left, step = v != null && v > 0 && v <= S.MAX_INDENT / 2 && Math.abs(v / 0.5 - Math.round(v / 0.5)) < 1e-6;
        a.indent = step ? Math.round(v / 0.5) : 0;
        a.left = step || !v ? null : v;
      }
      return a;
    };
    const cmds = {
      bold: () => toggleMark(m.bold), italic: () => toggleMark(m.italic), underline: () => toggleMark(m.underline), strike: () => toggleMark(m.strike),
      sup: () => toggleMark(m.sup), sub: () => toggleMark(m.sub), link,
      bulletList: () => toggleList('bullet_list'), orderedList: () => toggleList('ordered_list'),
      indent: () => indent(1), outdent: () => indent(-1), heading: (level) => heading(+level || 0),
      align: (dir) => (ALIGNS.includes(dir || 'left') ? setLines((l) => ({ type: l.node.type, attrs: { ...l.node.attrs, align: dir === 'left' || !dir ? (paper && l.node.type === n.heading ? 'left' : null) : dir } })) : () => false),
      clear: () => clear, undo: () => undo, redo: () => redo, quote, insertText,
    };
    if (paper) {
      Object.assign(cmds, {
        // A page break at the caret: the paragraph splits around it, and typing goes on after it.
        pageBreak: () => (state, dispatch) => {
          if (!dispatch) return true;
          const { $from } = state.selection, tr = state.tr;
          let at;
          if ($from.depth === 1 && $from.parent.isTextblock) {
            if ($from.parentOffset === 0) at = $from.before(1);
            else if ($from.parentOffset === $from.parent.content.size) at = $from.after(1);
            else { tr.split($from.pos); at = $from.pos + 1; }
          } else at = $from.depth ? $from.after(1) : state.selection.from;
          tr.insert(at, n.page_break.create());
          if (!tr.doc.resolve(at + 1).nodeAfter) tr.insert(at + 1, n.paragraph.create());
          dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(at + 2))).scrollIntoView());
          return true;
        },
        footnote: (content) => (state, dispatch) => {
          if (state.selection.$to.parent.type.spec.code) return false;
          if (dispatch) { const tr = state.tr, at = state.selection.to; tr.insert(at, n.footnote_ref.create({ content: S.inline(content || '') })); dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView()); }
          return true;
        },
        lineSpacing: (v) => (v == null || v === '' ? setAttr('line', null) : +v >= 0.5 && +v <= 4 ? setAttr('line', Math.round(+v * 100) / 100) : () => false),
        // A run's font family and size (text_style; null takes that part away, the format's own is never marked), sizes
        // stepped as Word steps them, text colour (hex), Word's highlighter, small caps and all caps.
        font: (name) => (name == null || S.FONTS.includes(name) ? style('font', name ?? null) : () => false),
        size: (v) => (v == null ? style('size', null) : Number.isFinite(+v) && +v >= 8 && +v <= 72 ? style('size', Math.round(+v * 2) / 2) : () => false),
        sizeStep: (o = {}) => (state, dispatch) => {
          const base = Number.isFinite(+o.base) ? +o.base : 12, cur = runStyle(state)?.attrs.size ?? base;
          const next = o.dir < 0 ? [...SIZES].reverse().find((x) => x < cur) : SIZES.find((x) => x > cur);
          return next != null && style('size', next === base ? null : next)(state, dispatch);
        },
        color: (hex) => (hex == null ? swap(m.color, null) : /^[0-9a-f]{6}$/i.test(String(hex)) ? swap(m.color, { color: String(hex).toUpperCase() }) : () => false),
        highlight: (name) => (name == null ? swap(m.highlight, null) : Object.hasOwn(S.HIGHLIGHT, name) ? swap(m.highlight, { color: name }) : () => false),
        smallCaps: () => toggleMark(m.small_caps), allCaps: () => toggleMark(m.all_caps),
        // The Paragraph dialog's and the ruler's settings on every selected textblock: what the patch names, a null
        // taking it back to the format's. A half-inch left indent is the indent step; one line rule replaces the others.
        paragraph: (patch) => (state, dispatch) => {
          const want = paraPatch(patch);
          if (!want) return false;
          const todo = lines(state).filter((l) => !l.node.type.spec.code).map((l) => ({ ...l, attrs: paraAttrs(l.node, want) })).filter((l) => Object.keys(l.attrs).some((k) => JSON.stringify(l.attrs[k]) !== JSON.stringify(l.node.attrs[k])));
          if (!todo.length) return false;
          if (dispatch) { const tr = state.tr; for (const l of todo) tr.setNodeMarkup(l.pos, null, l.attrs); dispatch(tr); }
          return true;
        },
        // Page break before the caret's paragraph (a page break node ahead of it, as an imported pageBreakBefore is).
        breakBefore: (on) => (state, dispatch) => {
          const { $from } = state.selection;
          if (!$from.depth) return false;
          const at = $from.before(1), prev = state.doc.resolve(at).nodeBefore, has = prev?.type === n.page_break;
          if (!!on === has) return false;
          if (dispatch) dispatch((on ? state.tr.insert(at, n.page_break.create()) : state.tr.delete(at - prev.nodeSize, at)).scrollIntoView());
          return true;
        },
        // The selected paragraphs' own tab stops: [[inches, 'l' | 'c' | 'r' | 'd', leader?]], sorted; [] clears them.
        tabs: (list) => {
          if (!Array.isArray(list)) return () => false;
          const stops = list.slice(0, 64).filter((t) => Array.isArray(t) && Number.isFinite(+t[0]) && +t[0] >= 0 && +t[0] <= 22 && 'lcrd'.includes(t[1]) && t[1])
            .map((t) => (t[2] ? [Math.round(+t[0] * 100) / 100, t[1], t[2]] : [Math.round(+t[0] * 100) / 100, t[1]])).sort((a, b) => a[0] - b[0]);
          return setAttr('tabs', stops.length ? stops : null);
        },
      });
    }
    return cmds;
  };

  // What the toolbar shows for the selection.
  const active = (state) => {
    const schema = state.schema, m = schema.marks, { $from, from, to, empty } = state.selection;
    const has = (t) => !!t && (empty ? !!t.isInSet(state.storedMarks || $from.marks()) : allHave(state, from, to, t));
    const block = $from.parent, parent = $from.depth ? $from.node($from.depth - 1) : null;
    let linked = null;
    if (empty) { const r = linkRange(state); linked = r && m.link.isInSet(state.doc.nodeAt(r.from)?.marks || []); }
    else if (allHave(state, from, to, m.link)) state.doc.nodesBetween(from, to, (t) => { if (t.isText) linked ||= m.link.isInSet(t.marks); });
    const out = {
      bold: has(m.bold), italic: has(m.italic), underline: has(m.underline), strike: has(m.strike), sup: has(m.sup), sub: has(m.sub),
      link: linked ? linked.attrs.href : null,
      heading: block.type === schema.nodes.heading ? block.attrs.level : 0,
      list: (parent && LISTS[parent.type.name]) || null,
      align: block.attrs.align || 'left', indent: block.attrs.indent || 0, code: !!block.type.spec.code,
    };
    if (isPaper(schema)) {
      let quoted = false;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === schema.nodes.blockquote) quoted = true;
      const style = m.text_style.isInSet(empty ? state.storedMarks || $from.marks() : state.doc.nodeAt(from)?.marks || []);
      const on = (t) => (empty ? state.storedMarks || $from.marks() : state.doc.nodeAt(from)?.marks || []).find((x) => x.type === t) || null;
      const top = $from.depth ? state.doc.resolve($from.before(1)).nodeBefore : null;
      Object.assign(out, { quote: quoted, lineSpacing: block.attrs.line ?? null, font: style?.attrs.font ?? null, size: style?.attrs.size ?? null,
        color: on(m.color)?.attrs.color ?? null, highlight: on(m.highlight)?.attrs.color ?? null, smallCaps: has(m.small_caps), allCaps: has(m.all_caps), breakBefore: top?.type.name === 'page_break' });
    }
    return out;
  };

  // Enter, Backspace, Tab as Quill and Word do them in lists and indented lines; elsewhere Tab writes a tab, as both do.
  // Escape, then Tab or Shift-Tab, leaves the editor (away.now, from leave()), as in code editors.
  const bindings = (schema, extra = {}, away = { now: false }) => {
    const n = schema.nodes, m = schema.marks, run = commands(schema);
    const toParagraph = (node) => setLines(() => ({ type: n.paragraph, attrs: pick(n.paragraph, node.attrs) }));
    const split = splitBlockAs((node, atEnd) => (node.type === n.heading && atEnd ? { type: n.paragraph, attrs: pick(n.paragraph, node.attrs) } : { type: node.type, attrs: node.attrs }));
    const emptyItem = (state, dispatch) => {
      const { $cursor } = state.selection, node = $cursor?.parent;
      if (!node || node.type !== n.list_item || node.content.size) return false;
      return node.attrs.indent ? run.outdent()(state, dispatch) : toParagraph(node)(state, dispatch);
    };
    const backAtStart = (state, dispatch) => {
      const { $cursor } = state.selection, node = $cursor?.parent;
      if (!node || $cursor.parentOffset || node.type.spec.code) return false;
      if (node.attrs.indent) return run.outdent()(state, dispatch);
      return node.type === n.list_item ? toParagraph(node)(state, dispatch) : false;
    };
    const inList = (cmd) => (state, dispatch) => {
      const ls = lines(state);
      if (!ls.length || !ls.every((l) => LISTS[l.parent.type.name])) return false;
      cmd(state, dispatch);
      return true;
    };
    // Word's and Docs' shortcuts: strike, subscript and superscript (Word's ⌘= / ⌘⇧=, Docs' ⌘, / ⌘.), lists, clear
    // formatting; in a paper also alignment, indents, body and headings, and a page break.
    const word = {
      'Shift-Mod-x': toggleMark(m.strike), 'Mod-=': toggleMark(m.sub), 'Shift-Mod-=': toggleMark(m.sup), 'Mod-,': toggleMark(m.sub), 'Mod-.': toggleMark(m.sup),
      'Shift-Mod-7': run.orderedList(), 'Shift-Mod-8': run.bulletList(), 'Mod-\\': run.clear(),
      ...(isPaper(schema) ? {
        'Shift-Mod-l': run.align('left'), 'Shift-Mod-e': run.align('center'), 'Shift-Mod-r': run.align('right'), 'Shift-Mod-j': run.align('justify'),
        'Mod-]': run.indent(), 'Mod-[': run.outdent(), 'Alt-Mod-0': run.heading(0), 'Mod-Enter': run.pageBreak(),
        ...Object.fromEntries(n.heading.spec.levels.map((l) => [`Alt-Mod-${l}`, run.heading(l)])),
      } : {}),
    };
    const keys = {
      ...word,
      'Mod-b': toggleMark(m.bold), 'Mod-i': toggleMark(m.italic), 'Mod-u': toggleMark(m.underline),
      'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
      Enter: chainCommands(newlineInCode, emptyItem, createParagraphNear, liftEmptyBlock, split),
      'Shift-Enter': n.hard_break ? chainCommands(newlineInCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView()); return true; }) : chainCommands(newlineInCode, split),
      Backspace: chainCommands(undoInputRule, backAtStart),
      Tab: (state, dispatch) => !away.now && (inList(run.indent())(state, dispatch) || (dispatch?.(state.tr.insertText('\t').scrollIntoView()), true)),
      'Shift-Tab': (state, dispatch) => !away.now && (inList(run.outdent())(state, dispatch) || true),
    };
    for (const [key, fn] of Object.entries(extra || {})) if (typeof fn === 'function') keys[key] = () => fn() !== false;
    return keys;
  };

  // Markdown shortcuts the schema can hold, then smart quotes and dashes. ProseMirror runs none of them in code.
  const rules = (schema) => {
    const n = schema.nodes, m = schema.marks, paper = isPaper(schema), levels = n.heading.spec.levels;
    const atStart = (state, start) => state.doc.resolve(start).parentOffset === 0;
    const block = (re, want) => new InputRule(re, (state, match, start, end) => {
      if (!atStart(state, start)) return null;
      const $start = state.doc.resolve(start), node = $start.parent, w = want(node, match, $start.node($start.depth - 1));
      if (!w || node.type.spec.code) return null;
      const tr = state.tr.delete(start, end);
      if (w.wrap) {
        const range = tr.doc.resolve(start).blockRange(), wrapping = range && GZ_PM.transform.findWrapping(range, w.wrap);
        if (!wrapping) return null;
        return tr.wrap(range, wrapping);
      }
      if (w.indent) {
        tr.setNodeMarkup($start.before(), null, { ...node.attrs, indent: Math.min(S.MAX_INDENT, node.attrs.indent + 1) });
        return tr.addStoredMark(m.italic.create());
      }
      retype(tr, $start.before(), w);
      return tr;
    });
    const mark = (re, type) => new InputRule(re, (state, match, start, end) => {
      const whole = match[1], inner = match[2], from = start + match[0].length - whole.length, open = whole.indexOf(inner);
      const tr = state.tr.delete(from + open + inner.length, end).delete(from, from + open);
      return tr.addMark(from, from + inner.length, type.create()).removeStoredMark(type);
    });
    return [
      block(/^\s*([-*])\s$/, (node, _, up) => (up.type === n.bullet_list ? null : { list: 'bullet_list', attrs: pick(n.list_item, node.attrs) })),
      block(/^1[.)]\s$/, (node, _, up) => (up.type === n.ordered_list ? null : { list: 'ordered_list', attrs: pick(n.list_item, node.attrs) })),
      block(/^>\s$/, (node) => (node.type !== n.paragraph ? null : paper ? { wrap: n.blockquote } : { indent: true })),
      block(/^(#{1,6})\s$/, (node, match) => { const level = levels[match[1].length - 1]; return level ? { type: n.heading, attrs: { ...pick(n.heading, node.attrs), level } } : null; }),
      mark(/(?:^|[^*])(\*\*([^*\s](?:[^*]*[^*\s])?)\*\*)$/, m.bold),
      mark(/(?:^|[^*\p{L}\p{N}\p{M}_])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/u, m.italic),
      new InputRule(/\[([^\]\n]+)\]\(([^)\s]+)\)$/, (state, match, start, end) => {
        const href = S.href(match[2], true);
        if (!href) return null;
        const size = match[1].length;
        return state.tr.delete(start + size + 1, end).delete(start, start + 1).addMark(start, start + size, m.link.create({ href })).removeStoredMark(m.link);
      }),
      ...smartQuotes, emDash,
    ].map((rule) => new InputRule(rule.match, (state, match, start, end) => {
      if (m.link.isInSet(state.storedMarks || state.selection.$from.marks()) || state.doc.rangeHasMark(start, end, m.link)) return null;
      return rule.handler(state, match, start, end);
    }, rule));
  };

  // Adjacent lists of one kind are one list, as Quill merges them (so numbering matches what posts).
  const joinLists = () => new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged)) return null;
      const joins = [];
      const scan = (node, base) => { let prev = null; node.forEach((c, off) => { if (prev && LISTS[c.type.name] && c.type === prev.type) joins.push(base + off); prev = c; }); };
      scan(state.doc, 0);
      state.doc.descendants((node, pos) => { if (node.isTextblock || LISTS[node.type.name]) return false; scan(node, pos + 1); return true; });
      if (!joins.length) return null;
      const tr = state.tr;
      for (const at of joins.reverse()) tr.join(at);
      return tr;
    },
  });
  const isBlank = (doc) => doc.childCount === 1 && doc.firstChild.type.name === 'paragraph' && !doc.firstChild.content.size && !doc.firstChild.attrs.indent && !doc.firstChild.attrs.align;
  const look = (placeholder) => new Plugin({
    props: { attributes: (state) => ({ class: isBlank(state.doc) ? 'gz-writer gz-blank' : 'gz-writer', role: 'textbox', 'aria-multiline': 'true', ...(placeholder ? { 'data-placeholder': placeholder } : {}) }) },
  });

  // Whether this Tab follows an Escape, read on the editor's capture phase so a handler that takes Escape first doesn't hide
  // it; modifier keys in between keep it.
  const MODS = ['Shift', 'Alt', 'Control', 'Meta'];
  const leave = (away) => new Plugin({
    view(v) {
      const off = () => { away.armed = away.now = false; };
      const key = (e) => {
        if (v.composing || e.isComposing || e.keyCode === 229) { off(); return; }
        away.now = away.armed && e.key === 'Tab';
        away.armed = e.key === 'Escape' || (away.armed && MODS.includes(e.key));
      };
      v.dom.addEventListener('keydown', key, true);
      v.dom.addEventListener('blur', off);
      v.dom.addEventListener('compositionstart', off);
      return { destroy: () => { v.dom.removeEventListener('keydown', key, true); v.dom.removeEventListener('blur', off); v.dom.removeEventListener('compositionstart', off); } };
    },
  });
  const plugins = (schema, o = {}, away = { now: false, armed: false }) => [
    ...(o.plugins || []),
    leave(away),
    keymap(bindings(schema, o.keys, away)),
    keymap(baseKeymap),
    inputRules({ rules: rules(schema) }),
    history(),
    joinLists(),
    look(o.placeholder),
    GZ_PM.dropcursor.dropCursor(),
    ...(isPaper(schema) ? [GZ_PM.gapcursor.gapCursor(), GZ_PM.tables.tableEditing()] : []),
  ];
  // An EditorState for opts (create's, minus the page): what create() mounts, and what the node tests drive.
  const state = (o = {}) => {
    const schema = o.mode === 'paper' ? S.paper : S.compose;
    const doc = S.parse(schema, o.html || ''), s = o.selection;
    let selection;
    if (s && Number.isSafeInteger(s.index) && s.index >= 0 && Number.isSafeInteger(s.length) && s.length >= 0) {
      const map = S.text(doc), from = Math.min(s.index, map.text.length), to = Math.min(from + s.length, map.text.length);
      selection = TextSelection.create(doc, map.posAt(from), map.posAt(to));
    }
    return EditorState.create({ doc, selection, plugins: plugins(schema, o) });
  };

  const create = (o = {}) => {
    const schema = o.mode === 'paper' ? S.paper : S.compose, cmds = commands(schema);
    let quiet = false, pasted = null;
    const report = (s) => {
      let html, text;
      return { get html() { return (html ??= S.serialize(schema, s.doc)); }, get text() { return (text ??= S.text(s.doc).text); }, get words() { return words(this.text); }, docChanged: !quiet };
    };
    const view = new GZ_PM.view.EditorView({ mount: o.mount }, {
      state: state(o),
      editable: () => !o.readOnly,
      // Paste and drop take the same allowlisted path as parse().
      // writer-paste.js (where loaded) first puts Word's, Docs' and web pages' formatting in Writer's own terms. ProseMirror
      // then parses what this returns into a document of the frame's, whose CSP refuses inline style attributes (and says
      // so in the console): it gets the HTML without them, and clipboardParser reads the kept copy.
      transformPastedHTML: (html) => {
        try {
          const rich = globalThis.GZ_WRITER_PASTE?.before;
          if (typeof rich === 'function') html = rich(html, schema);
          pasted = S.serialize(schema, schema.topNodeType.create(null, S.slice(schema, html).content));
          return pasted.replace(/\sstyle="[^"]*"/g, '');
        }
        catch (e) { pasted = null; if (e.code === 'WRITER_INPUT_LIMIT') return ''; throw e; }
      },
      handleDOMEvents: Object.fromEntries(['paste', 'drop'].map((name) => [name, (_view, event) => {
        const data = event.clipboardData || event.dataTransfer;
        if (!data || !['text/html', 'text/plain'].some((type) => data.getData(type).length > S.MAX_INPUT)) return false;
        event.preventDefault();
        return true;
      }])),
      clipboardParser: { parseSlice: (dom) => { const html = pasted ?? dom.innerHTML; pasted = null; return S.slice(schema, html); } },
      clipboardTextParser: (text, $context) => {
        if (text.length > S.MAX_INPUT) return Slice.empty;
        const parts = text.replace(/\r\n?/g, '\n').split('\n'), marks = $context.marks();
        if (parts.length > 10000) return Slice.empty;
        return Slice.maxOpen(Fragment.from(parts.map((part) => schema.nodes.paragraph.create(null, part ? schema.text(part, marks) : null))));
      },
      dispatchTransaction(tr) {
        const before = view.state, next = before.apply(tr);
        view.updateState(next);
        if (next.doc !== before.doc) o.onChange?.(report(next));
        if (o.onSelection && (next.doc !== before.doc || !next.selection.eq(before.selection) || next.storedMarks !== before.storedMarks)) {
          const { empty, from, to } = next.selection;
          let coords, act;
          o.onSelection({
            empty, from, to,
            get coords() { if (!coords) { const a = view.coordsAtPos(from), b = empty ? a : view.coordsAtPos(to, -1); coords = { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }; } return coords; },
            get active() { return (act ??= active(next)); },
          });
        }
      },
    });
    return {
      view, schema,
      html: () => S.serialize(schema, view.state.doc),
      // The whole document in one undoable step; onChange reports it with docChanged false.
      setHTML: (html) => {
        const doc = S.parse(schema, html);
        quiet = true;
        try {
          view.dispatch(closeHistory(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)));
          view.dispatch(closeHistory(view.state.tr));
        } finally { quiet = false; }
      },
      text: () => S.text(view.state.doc).text,
      words: () => words(S.text(view.state.doc).text),
      focus: () => view.focus(),
      run: (name, arg) => (Object.hasOwn(cmds, name) ? cmds[name](arg)(view.state, view.dispatch, view) : false),
      active: () => active(view.state),
      addPlugins: (ps) => view.updateState(view.state.reconfigure({ plugins: [...(ps || []), ...view.state.plugins] })),
      destroy: () => view.destroy(),
    };
  };

  return { create, state, commands, bindings, rules, active, words };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_EDITOR; else GZ_WRITER_EDITOR;
