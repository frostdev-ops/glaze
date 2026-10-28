// Glaze Writer's objects, the part that needs no page: pictures held in the paper (bounded, downscaled, sized in inches
// and percent of the text width, set in line or as a block with a caption), tables (a grid up to 10 × 10, rows and
// columns, header row, borders, cell alignment, Tab between cells), links (typed addresses linked on space, set or
// changed with their text), the horizontal line (--- on an empty line), special characters, and list styles (each
// level's numbering or bullet, restart and continue). Commands work on an EditorState alone (node tests); the frame
// (writer-objects.js) draws the UI over them. Paper schema except links, which compose has too.
// Classic script after lib/pm.js, lib/writer-schema.js and lib/writer-editor.js; module.exports for node.
var GZ_WRITER_OBJECTS_LIB = globalThis.GZ_WRITER_OBJECTS_LIB || (() => {
  const S = typeof GZ_WRITER_SCHEMA !== 'undefined' ? GZ_WRITER_SCHEMA : require('./writer-schema.js');
  const { TextSelection, NodeSelection, Plugin } = GZ_PM.state;
  const T = GZ_PM.tables;
  const { InputRule, inputRules } = GZ_PM.inputrules;

  // ---- links
  // The address or email that ends `text` (what is before the caret), without the punctuation after it, or null.
  // → { start, end, href } as offsets in text.
  const TOKEN = /(?:^|[\s(\[{"'“‘<])((?:https?:\/\/|www\.)[^\s<>"]+|[\w.+-]+@[^\s<>"@]+)$/i;
  const autolink = (text) => {
    const m = TOKEN.exec(String(text || ''));
    if (!m) return null;
    let token = m[1];
    const start = m.index + m[0].length - token.length;
    for (;;) {
      const last = token.at(-1);
      if ('.,;:!?\'"’”'.includes(last)) { token = token.slice(0, -1); continue; }
      if (last === ')' && (token.match(/\(/g) || []).length < (token.match(/\)/g) || []).length) { token = token.slice(0, -1); continue; }
      break;
    }
    let href = null;
    if (/^https?:\/\/[\w-]+(\.[\w-]+)*\.[a-z]{2,}(?::\d+)?([/?#]|$)/i.test(token) || /^www\.[\w-]+(\.[\w-]+)*\.[a-z]{2,}([/?#:]|$)/i.test(token)) href = S.href(token, true);
    else if (/^[\w.+-]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}$/i.test(token)) href = S.href(`mailto:${token}`);
    return href ? { start, end: start + token.length, href } : null;
  };
  // The link the selection is in: { from, to, text, href }, or null.
  const linkAt = (state) => {
    const m = state.schema.marks.link, { $from, $to } = state.selection;
    if (!$from.sameParent($to) || !$from.parent.inlineContent) return null;
    const parent = $from.parent, base = $from.start();
    const kids = [];
    parent.forEach((c, off) => kids.push({ c, from: base + off, to: base + off + c.nodeSize }));
    const at = $from.pos, hit = kids.find((k) => k.from < at && at <= k.to && m.isInSet(k.c.marks)) || kids.find((k) => k.from <= at && at < k.to && m.isInSet(k.c.marks));
    if (!hit) return null;
    const mark = m.isInSet(hit.c.marks), i = kids.indexOf(hit);
    let a = i, b = i;
    while (a > 0 && mark.isInSet(kids[a - 1].c.marks)) a--;
    while (b < kids.length - 1 && mark.isInSet(kids[b + 1].c.marks)) b++;
    const from = kids[a].from, to = kids[b].to;
    return { from, to, text: state.doc.textBetween(from, to, ''), href: mark.attrs.href };
  };

  // ---- pictures
  const IMAGE = { maxSide: 1600, maxBytes: 1e6, maxTotal: 5e6, minWidth: 24, types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] };
  const DATA = /^data:image\/(png|jpeg|gif);base64,[a-z0-9+/=]+$/i;
  // A picture's size in the paper: within 1600 pixels a side and 1 MB, as PNG, JPEG or GIF (Word takes no WebP).
  // → { width, height, reencode, smaller } or null for what isn't a picture.
  const fitImage = ({ width, height, bytes, type } = {}) => {
    if (!(width > 0 && height > 0) || !IMAGE.types.includes(type)) return null;
    const scale = Math.min(1, IMAGE.maxSide / Math.max(width, height));
    const smaller = scale < 1 || bytes > IMAGE.maxBytes;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), reencode: smaller || type === 'image/webp', smaller };
  };
  const clampWidth = (px, content) => Math.round(Math.min(content, Math.max(IMAGE.minWidth, +px || 0)));
  const size = (px, content) => ({ inches: Math.round((px / 96) * 100) / 100, percent: Math.round((px / content) * 100) });
  const fromInches = (inches, content) => clampWidth(inches * 96, content);
  const fromPercent = (percent, content) => clampWidth((percent / 100) * content, content);
  const bytesOf = (src) => { const i = String(src).indexOf(','); return i < 0 ? 0 : Math.floor(((src.length - i - 1) * 3) / 4); };
  const imageBytes = (doc) => { let n = 0; doc.descendants((x) => { if (x.type.name === 'image' && DATA.test(x.attrs.src)) n += bytesOf(x.attrs.src); }); return n; };

  // ---- special characters
  const G = (cat, list) => list.split('|').map((x) => { const [c, name] = x.split('='); return { c, name, cat }; });
  const CHARS = [
    ...G('punctuation', '—=Em dash|–=En dash|‑=Non-breaking hyphen|…=Ellipsis|‘=Left single quote|’=Right single quote apostrophe|“=Left double quote|”=Right double quote|«=Left guillemet|»=Right guillemet|‹=Single left guillemet|›=Single right guillemet|„=Low double quote|•=Bullet|·=Middle dot|¡=Inverted exclamation|¿=Inverted question|†=Dagger|‡=Double dagger|′=Prime|″=Double prime|‽=Interrobang'),
    ...G('symbols', '§=Section sign|¶=Pilcrow paragraph sign|©=Copyright|®=Registered|™=Trademark|°=Degree|€=Euro|£=Pound|¥=Yen|¢=Cent|‰=Per mille|№=Numero|℃=Degrees Celsius|℉=Degrees Fahrenheit|♪=Music note|★=Star|✓=Check mark|✗=Ballot x|♀=Female|♂=Male'),
    ...G('accents', 'á=a acute|à=a grave|â=a circumflex|ä=a diaeresis umlaut|ã=a tilde|å=a ring|æ=ae ligature|ç=c cedilla|é=e acute|è=e grave|ê=e circumflex|ë=e diaeresis umlaut|í=i acute|ì=i grave|î=i circumflex|ï=i diaeresis umlaut|ñ=n tilde|ó=o acute|ò=o grave|ô=o circumflex|ö=o diaeresis umlaut|õ=o tilde|ø=o stroke|œ=oe ligature|ú=u acute|ù=u grave|û=u circumflex|ü=u diaeresis umlaut|ý=y acute|ÿ=y diaeresis|ß=Sharp s eszett|Á=A acute|À=A grave|Ä=A diaeresis umlaut|Ç=C cedilla|É=E acute|È=E grave|Ñ=N tilde|Ó=O acute|Ö=O diaeresis umlaut|Ú=U acute|Ü=U diaeresis umlaut|ł=l stroke|š=s caron|č=c caron|ž=z caron|ő=o double acute'),
    ...G('greek', 'α=Alpha|β=Beta|γ=Gamma|δ=Delta|ε=Epsilon|ζ=Zeta|η=Eta|θ=Theta|ι=Iota|κ=Kappa|λ=Lambda|μ=Mu|ν=Nu|ξ=Xi|ο=Omicron|π=Pi|ρ=Rho|σ=Sigma|τ=Tau|υ=Upsilon|φ=Phi|χ=Chi|ψ=Psi|ω=Omega|Γ=Capital gamma|Δ=Capital delta|Θ=Capital theta|Λ=Capital lambda|Π=Capital pi|Σ=Capital sigma|Φ=Capital phi|Ψ=Capital psi|Ω=Capital omega'),
    ...G('arrows', '←=Left arrow|→=Right arrow|↑=Up arrow|↓=Down arrow|↔=Left right arrow|↕=Up down arrow|⇐=Left double arrow|⇒=Right double arrow implies|⇔=Left right double arrow iff|↗=North east arrow|↘=South east arrow|↩=Return arrow'),
    ...G('math', '±=Plus minus|×=Multiplication times|÷=Division|−=Minus|≈=Almost equal approximately|≠=Not equal|≤=Less than or equal|≥=Greater than or equal|√=Square root|∞=Infinity|∑=Summation|∏=Product|∫=Integral|∂=Partial derivative|∆=Increment|∈=Element of|∉=Not element of|∩=Intersection|∪=Union|⊂=Subset|∀=For all|∃=There exists|∅=Empty set|∝=Proportional|∴=Therefore|½=One half|⅓=One third|¼=One quarter|¾=Three quarters|²=Superscript two squared|³=Superscript three cubed|‰=Per mille'),
  ].filter((x, i, all) => all.findIndex((y) => y.c === x.c) === i);
  const code = (c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  // Characters whose name has every word of q (or whose code point is q), in group cat ('' for all).
  const searchChars = (q, cat = '') => {
    const s = String(q || '').trim().toLowerCase(), words = s.split(/\s+/).filter(Boolean);
    return CHARS.filter((x) => (!cat || x.cat === cat) && (!s || code(x.c).toLowerCase() === s || x.c === s || words.every((w) => x.name.toLowerCase().split(/\s+/).some((n) => n.startsWith(w)))));
  };

  // ---- lists
  const NUMBERS = ['decimal', 'lower-alpha', 'lower-roman', 'upper-alpha', 'upper-roman'], BULLETS = ['disc', 'circle', 'square', 'dash'];
  const DEFAULTS = { ordered_list: ['decimal', 'lower-alpha', 'lower-roman'], bullet_list: ['disc', 'circle', 'square'] };
  const MARKS = { disc: '•', circle: '◦', square: '▪', dash: '–' };
  const PRESETS = { ordered_list: { '1. a. i.': null, 'A. 1. a.': 'upper-alpha,decimal,lower-alpha', 'I. A. 1.': 'upper-roman,upper-alpha,decimal' }, bullet_list: { '• ◦ ▪': null, '– – –': Array(9).fill('dash').join(',') } };
  const roman = (n) => { let out = ''; for (const [v, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (n >= v) { out += s; n -= v; } return out; };
  const alpha = (n) => { let out = ''; while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); } return out; };
  // An item's marker text for a style: its number in that style, or the bullet.
  const marker = (style, n = 1) => {
    if (MARKS[style]) return MARKS[style];
    if (style === 'lower-roman') return roman(n);
    if (style === 'upper-roman') return roman(n).toUpperCase();
    if (style === 'lower-alpha') return alpha(n);
    if (style === 'upper-alpha') return alpha(n).toUpperCase();
    return String(n);
  };
  const levelStyles = (list) => {
    const own = list.attrs.styles ? list.attrs.styles.split(',') : [], d = DEFAULTS[list.type.name];
    return Array.from({ length: S.MAX_INDENT + 1 }, (_, i) => own[i] || d[i % d.length]);
  };
  // Nine levels back to the shortest styles string (defaults after the last own one are left out).
  const stylesString = (type, all) => {
    const d = DEFAULTS[type];
    let n = all.length;
    while (n > 0 && all[n - 1] === d[(n - 1) % d.length]) n--;
    return n ? all.slice(0, n).join(',') : null;
  };
  const itemAround = (state) => {
    const $ = state.selection.$from;
    for (let d = $.depth; d > 0; d--) if ($.node(d).type.name === 'list_item') return { item: $.node(d), itemPos: $.before(d), list: $.node(d - 1), listPos: $.before(d - 1) };
    return null;
  };
  // An item whose restart repeats the one before it at its level (an item split from it) loses it.
  const starts = () => new Plugin({
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged) || !state.schema.nodes.list_item.attrs.start) return null;
      const clear = [];
      state.doc.descendants((n, pos) => {
        if (n.type.name !== 'ordered_list' && n.type.name !== 'bullet_list') return !n.isTextblock;
        const last = new Map();
        n.forEach((li, off) => {
          const lv = li.attrs.indent || 0;
          if (li.attrs.start != null && last.get(lv) === li.attrs.start) clear.push(pos + 1 + off);
          last.set(lv, li.attrs.start);
          for (const k of [...last.keys()]) if (k > lv) last.delete(k);
        });
        return false;
      });
      if (!clear.length) return null;
      const tr = state.tr;
      for (const p of clear) tr.setNodeMarkup(p, null, { ...tr.doc.nodeAt(p).attrs, start: null });
      return tr.setMeta('addToHistory', false);
    },
  });

  // ---- where a block goes: after the caret's block, in the nearest container that takes blocks (the paper or a quote)
  const blockSpot = (state) => {
    const $ = state.selection.$from;
    for (let d = $.depth; d >= 0; d--) if (['table_cell', 'table_header'].includes($.node(d).type.name)) return null;
    for (let d = $.depth; d > 0; d--) if (['doc', 'blockquote'].includes($.node(d - 1).type.name)) return { depth: d, node: $.node(d), after: $.after(d), before: $.before(d) };
    return null;
  };
  const emptyPara = (node) => node.type.name === 'paragraph' && !node.content.size;

  // Every command by name: (args) → (state, dispatch) → bool. o.content(): the paper's text width in px (624: 6.5in).
  const commands = (schema, o = {}) => {
    const n = schema.nodes, m = schema.marks, content = () => (typeof o.content === 'function' ? o.content() : 624);
    const listCmd = (fn) => (state, dispatch) => {
      const at = itemAround(state);
      if (!at || !schema.nodes.list_item.attrs.start) return false;
      return fn(at, state, dispatch);
    };
    const setListStyles = (at, styles, state, dispatch) => { dispatch?.(state.tr.setNodeMarkup(at.listPos, null, { ...at.list.attrs, styles })); return true; };
    const link = ({ text, href } = {}) => (state, dispatch) => {
      const url = S.href(href, true), { $from, from, to, empty } = state.selection;
      if (!url || $from.parent.type.spec.code || !$from.parent.inlineContent) return false;
      if (!dispatch) return true;
      const r = linkAt(state) || (empty ? null : { from, to, text: state.doc.textBetween(from, to, '') });
      const mark = m.link.create({ href: url }), words = String(text ?? '').replace(/\s+/g, ' ').trim(), tr = state.tr;
      if (!r) { tr.insert(from, schema.text(words || url, mark.addToSet((state.storedMarks || $from.marks()).filter((x) => x.type !== m.link)))); dispatch(tr.scrollIntoView()); return true; }
      if (words && words !== r.text) {
        const marks = (state.doc.nodeAt(r.from)?.marks || []).filter((x) => x.type !== m.link);
        tr.replaceWith(r.from, r.to, schema.text(words, mark.addToSet(marks)));
      } else tr.removeMark(r.from, r.to, m.link).addMark(r.from, r.to, mark);
      dispatch(tr.scrollIntoView());
      return true;
    };
    const unlink = () => (state, dispatch) => {
      const r = linkAt(state) || (state.selection.empty ? null : state.selection);
      if (!r || !state.doc.rangeHasMark(r.from, r.to, m.link)) return false;
      dispatch?.(state.tr.removeMark(r.from, r.to, m.link));
      return true;
    };
    const cmds = { link, unlink, insertChar: (c) => (state, dispatch) => { if (!c) return false; dispatch?.(state.tr.insertText(String(c)).scrollIntoView()); return true; } };
    if (!n.page_break) return cmds;

    // A picture's paragraph holds only it once it is a block: the text around it splits off.
    const isolate = (tr, pos) => {
      const $ = tr.doc.resolve(pos), para = $.parent;
      if (para.type !== n.paragraph) return pos;
      const after = pos + 1 < $.end(), before = pos > $.start();
      if (after) tr.split(pos + 1);
      if (before) { tr.split(pos); return pos + 1; }
      return pos;
    };
    const imgAttrs = (a, old = {}) => {
      const out = { ...old, ...a };
      out.display = out.display === 'block' ? 'block' : 'inline';
      out.align = out.display === 'block' ? (['left', 'center', 'right'].includes(out.align) ? out.align : 'center') : (['left', 'center', 'right'].includes(out.align) ? out.align : null);
      if (out.width != null) out.width = clampWidth(out.width, content());
      out.alt = String(out.alt || '').slice(0, 1000);
      out.caption = String(out.caption || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      return out;
    };
    Object.assign(cmds, {
      // Pictures
      insertImage: (a = {}) => (state, dispatch) => {
        if (!DATA.test(a.src || '') || imageBytes(state.doc) + bytesOf(a.src) > IMAGE.maxTotal) return false;
        const attrs = imgAttrs({ display: 'block', align: 'center', ...a }), img = n.image.create(attrs);
        if (!dispatch) return true;
        const tr = state.tr.deleteSelection(), $ = tr.selection.$from;
        let at;
        if (attrs.display === 'block' && $.parent.type === n.paragraph) {
          const para = n.paragraph.create(null, img);
          if (!$.parent.content.size) { tr.replaceWith($.before(), $.after(), para); at = $.before() + 1; }
          else if ($.parentOffset === 0) { tr.insert($.before(), para); at = $.before() + 1; }
          else if ($.parentOffset === $.parent.content.size) { tr.insert($.after(), para); at = $.after() + 1; }
          else { tr.split($.pos); tr.insert($.pos + 1, para); at = $.pos + 2; }
        } else {
          tr.replaceSelectionWith(attrs.display === 'block' ? n.image.create({ ...attrs, display: 'inline', align: null }) : img, false);
          at = tr.selection.from - 1;
        }
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
        return true;
      },
      setImage: (pos, a = {}) => (state, dispatch) => {
        const node = state.doc.nodeAt(pos);
        if (node?.type !== n.image) return false;
        if (!dispatch) return true;
        const attrs = imgAttrs(a, node.attrs), tr = state.tr.setNodeMarkup(pos, null, attrs);
        const at = attrs.display === 'block' && node.attrs.display !== 'block' ? isolate(tr, pos) : pos;
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
        return true;
      },
      deleteImage: (pos) => (state, dispatch) => {
        const node = state.doc.nodeAt(pos);
        if (node?.type !== n.image) return false;
        if (dispatch) {
          const $ = state.doc.resolve(pos), alone = $.parent.type === n.paragraph && $.parent.childCount === 1 && state.doc.childCount > 1 && $.depth === 1;
          dispatch((alone ? state.tr.delete($.before(), $.after()) : state.tr.delete(pos, pos + 1)).scrollIntoView());
        }
        return true;
      },

      // The horizontal line, after the caret's block, with a line after it to type on.
      insertRule: () => (state, dispatch) => {
        const spot = n.horizontal_rule && blockSpot(state);
        if (!spot) return false;
        if (dispatch) {
          const tr = state.tr.insert(spot.after, [n.horizontal_rule.create(), n.paragraph.create()]);
          dispatch(tr.setSelection(TextSelection.create(tr.doc, spot.after + 2)).scrollIntoView());
        }
        return true;
      },

      // Tables
      insertTable: ({ rows, cols, header = false } = {}) => (state, dispatch) => {
        if (!(rows >= 1 && rows <= 10 && cols >= 1 && cols <= 10)) return false;
        const spot = blockSpot(state);
        if (!spot) return false;
        if (!dispatch) return true;
        const cell = (h) => (h ? n.table_header : n.table_cell).create(null, n.paragraph.create());
        const table = n.table.create(null, Array.from({ length: rows }, (_, r) => n.table_row.create(null, Array.from({ length: cols }, () => cell(header && r === 0)))));
        const tr = state.tr;
        let at = spot.after;
        if (emptyPara(spot.node)) { tr.delete(spot.before, spot.after); at = spot.before; }
        tr.insert(at, table);
        const end = at + table.nodeSize;
        if (tr.doc.resolve(end).nodeAfter?.type !== n.paragraph) tr.insert(end, n.paragraph.create());
        dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 4)).scrollIntoView());
        return true;
      },
      // prosemirror-tables' own commands by name; a column more only while each stays at least half an inch.
      table: (name, opt = {}) => (state, dispatch) => {
        const fn = { addRowBefore: T.addRowBefore, addRowAfter: T.addRowAfter, addColumnBefore: T.addColumnBefore, addColumnAfter: T.addColumnAfter, deleteRow: T.deleteRow, deleteColumn: T.deleteColumn, deleteTable: T.deleteTable, toggleHeaderRow: T.toggleHeaderRow }[name];
        if (!fn || !T.isInTable(state)) return false;
        if (/^addColumn/.test(name)) { const rect = T.selectedRect(state); if (rect.map.width >= maxColumns(opt.content || content())) return false; }
        return fn(state, dispatch);
      },
      tableAttr: (key, value) => (state, dispatch) => {
        const $ = state.selection.$from;
        for (let d = $.depth; d > 0; d--) {
          if ($.node(d).type !== n.table) continue;
          if (!(key in $.node(d).attrs)) return false;
          dispatch?.(state.tr.setNodeMarkup($.before(d), null, { ...$.node(d).attrs, [key]: value }));
          return true;
        }
        return false;
      },
      cellAttr: (key, value) => (state, dispatch) => (T.isInTable(state) ? T.setCellAttr(key, value)(state, dispatch) || true : false),
      // A cell's text alignment is its paragraphs' (as in Word).
      cellAlign: (align) => (state, dispatch) => {
        if (!T.isInTable(state)) return false;
        const cells = [];
        if (state.selection instanceof T.CellSelection) state.selection.forEachCell((c, pos) => cells.push({ c, pos }));
        else { const $c = T.cellAround(state.selection.$from); if ($c) cells.push({ c: $c.nodeAfter, pos: $c.pos }); }
        if (!dispatch) return !!cells.length;
        const tr = state.tr, value = align === 'left' || !align ? null : align;
        for (const { c, pos } of cells) c.descendants((x, p) => { if (x.isTextblock && 'align' in x.attrs) tr.setNodeMarkup(pos + 1 + p, null, { ...x.attrs, align: value }); return !x.isTextblock; });
        dispatch(tr);
        return true;
      },

      // Lists
      listStyle: (style) => listCmd((at, state, dispatch) => {
        const allowed = at.list.type === n.ordered_list ? NUMBERS : BULLETS;
        if (!allowed.includes(style)) return false;
        const all = levelStyles(at.list);
        all[at.item.attrs.indent || 0] = style;
        return setListStyles(at, stylesString(at.list.type.name, all), state, dispatch);
      }),
      listPreset: (name) => listCmd((at, state, dispatch) => {
        const presets = PRESETS[at.list.type.name];
        if (!Object.hasOwn(presets, name)) return false;
        return setListStyles(at, presets[name], state, dispatch);
      }),
      restart: () => listCmd((at, state, dispatch) => {
        if (at.list.type !== n.ordered_list) return false;
        dispatch?.(state.tr.setNodeMarkup(at.itemPos, null, { ...at.item.attrs, start: at.item.attrs.start == null ? 1 : null }));
        return true;
      }),
      continueList: () => listCmd((at, state, dispatch) => {
        if (at.list.type !== n.ordered_list) return false;
        dispatch?.(state.tr.setNodeMarkup(at.listPos, null, { ...at.list.attrs, continue: !at.list.attrs.continue }));
        return true;
      }),
    });
    return cmds;
  };
  const maxColumns = (content) => Math.max(1, Math.floor(content / 48));

  // ---- plugins: links typed on space, --- on an empty line, Tab between cells, ⌘K and ⌘⇧I, restarts kept single.
  // o: { onLink(), onImage() } (the frame's popovers); each returns false to leave the key alone.
  const plugins = (schema, o = {}) => {
    const n = schema.nodes, m = schema.marks;
    const rules = [
      new InputRule(/\S+ $/, (state, match, start, end) => {
        const r = autolink(match[0].slice(0, -1));
        if (!r) return null;
        const from = start + r.start, to = start + r.end;
        if (state.doc.resolve(from).parent.type.spec.code || state.doc.rangeHasMark(from, to, m.link)) return null;
        return state.tr.addMark(from, to, m.link.create({ href: r.href })).insertText(' ', end).removeStoredMark(m.link);
      }),
    ];
    if (n.horizontal_rule) rules.push(new InputRule(/^(?:---|—-)$/, (state, match, start) => {
      const $ = state.doc.resolve(start), para = $.parent;
      if (para.type !== n.paragraph || para.content.size !== match[0].length - 1 || !['doc', 'blockquote'].includes($.node($.depth - 1).type.name)) return null;
      const tr = state.tr.replaceWith($.before(), $.after(), [n.horizontal_rule.create(), n.paragraph.create()]);
      return tr.setSelection(TextSelection.create(tr.doc, $.before() + 2));
    }));
    const cell = (dir) => (state, dispatch) => {
      if (!n.table || !T.isInTable(state)) return false;
      if (T.goToNextCell(dir)(state, dispatch)) return true;
      if (dir < 0) return true;
      // Tab in the last cell: a row more, and the caret in its first cell, as one step.
      let tr = null, sel = null;
      T.addRowAfter(state, (t) => { tr = t; });
      if (!tr) return true;
      T.goToNextCell(1)(state.apply(tr), (t) => { sel = t.selection; });
      if (sel) tr.setSelection(TextSelection.create(tr.doc, sel.anchor, sel.head));
      dispatch?.(tr.scrollIntoView());
      return true;
    };
    const keys = new Plugin({
      gzObjectsKeys: true,
      props: { handleKeyDown: GZ_PM.keymap.keydownHandler({
        Tab: cell(1), 'Shift-Tab': cell(-1),
        'Mod-k': () => (o.onLink ? o.onLink() !== false : false),
        'Mod-Shift-i': () => (o.onImage ? o.onImage() !== false : false),
        'Mod-Shift-I': () => (o.onImage ? o.onImage() !== false : false),
      }) },
    });
    return [inputRules({ rules }), keys, ...(n.list_item.attrs.start ? [starts()] : [])];
  };

  return { autolink, linkAt, IMAGE, fitImage, clampWidth, size, fromInches, fromPercent, imageBytes, CHARS, searchChars, code,
    NUMBERS, BULLETS, PRESETS, marker, levelStyles, maxColumns, commands, plugins };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_OBJECTS_LIB; else GZ_WRITER_OBJECTS_LIB;
