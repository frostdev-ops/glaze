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
    const indent = (d) => setAttr('indent', (v) => Math.max(0, Math.min(S.MAX_INDENT, v + d)));
    const FORMAT = ['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'text_style'].map((k) => m[k]).filter(Boolean);
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
    const cmds = {
      bold: () => toggleMark(m.bold), italic: () => toggleMark(m.italic), underline: () => toggleMark(m.underline), strike: () => toggleMark(m.strike),
      sup: () => toggleMark(m.sup), sub: () => toggleMark(m.sub), link,
      bulletList: () => toggleList('bullet_list'), orderedList: () => toggleList('ordered_list'),
      indent: () => indent(1), outdent: () => indent(-1), heading: (level) => heading(+level || 0),
      align: (dir) => (ALIGNS.includes(dir || 'left') ? setAttr('align', dir === 'left' || !dir ? null : dir) : () => false),
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
      Object.assign(out, { quote: quoted, lineSpacing: block.attrs.line ?? null, font: style?.attrs.font ?? null, size: style?.attrs.size ?? null });
    }
    return out;
  };

  // Enter, Backspace, Tab as Quill and Word do them in lists and indented lines.
  const bindings = (schema, extra = {}) => {
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
    const keys = {
      'Mod-b': toggleMark(m.bold), 'Mod-i': toggleMark(m.italic), 'Mod-u': toggleMark(m.underline),
      'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
      Enter: chainCommands(newlineInCode, emptyItem, createParagraphNear, liftEmptyBlock, split),
      'Shift-Enter': n.hard_break ? chainCommands(newlineInCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(n.hard_break.create()).scrollIntoView()); return true; }) : chainCommands(newlineInCode, split),
      Backspace: chainCommands(undoInputRule, backAtStart),
      Tab: inList(run.indent()), 'Shift-Tab': inList(run.outdent()),
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

  const plugins = (schema, o = {}) => [
    ...(o.plugins || []),
    keymap(bindings(schema, o.keys)),
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
    let quiet = false;
    const report = (s) => {
      let html, text;
      return { get html() { return (html ??= S.serialize(schema, s.doc)); }, get text() { return (text ??= S.text(s.doc).text); }, get words() { return words(this.text); }, docChanged: !quiet };
    };
    const view = new GZ_PM.view.EditorView({ mount: o.mount }, {
      state: state(o),
      editable: () => !o.readOnly,
      // Paste and drop take the same allowlisted path as parse().
      transformPastedHTML: (html) => {
        try { return S.serialize(schema, schema.topNodeType.create(null, S.slice(schema, html).content)); }
        catch (e) { if (e.code === 'WRITER_INPUT_LIMIT') return ''; throw e; }
      },
      handleDOMEvents: Object.fromEntries(['paste', 'drop'].map((name) => [name, (_view, event) => {
        const data = event.clipboardData || event.dataTransfer;
        if (!data || !['text/html', 'text/plain'].some((type) => data.getData(type).length > S.MAX_INPUT)) return false;
        event.preventDefault();
        return true;
      }])),
      clipboardParser: { parseSlice: (dom) => S.slice(schema, dom.innerHTML) },
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
