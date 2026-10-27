// Glaze Writer's editor frame (writer.html): Glaze's editor where Ultra shows an editor box, which features/writer.js
// opens in the box's place. An extension page, so the editor has the workers and WebAssembly the LMS page's CSP keeps from
// a content script (proofing needs both), its own fonts and styles. It opens only with a one-use pass from the worker
// (lib/background.js 'glaze:writer') and then talks to the page over that job's MessageChannel only:
//   page → frame: init { mode, kind, html, placeholder, look { tokens, dark, motion }, context, locale }, look { look },
//                 context { context }, focus, html { html } (Ultra changed its own editor: a post went, a draft came back);
//   frame → page: ready, height { px }, change { html, text, words }, send (Mod-Enter), native (back to Blackboard's editor).
// It keeps nothing and asks the extension for nothing but that pass.
(() => {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  let port = null, ed = null, locale = 'en', quiet = false, words = 0, context = {};
  const t = (k, v) => GZ_I18N.t(k, v, locale);
  const say = (m) => port?.postMessage(m);

  // ---- the editor --------------------------------------------------------------------------------------------------
  // lib/writer-editor.js's (GZ_WRITER_EDITOR) once writer.html loads it; until then the stand-in below, with the same
  // create() surface over plain ProseMirror and a basic compose schema.
  const create = (opts) => (globalThis.GZ_WRITER_EDITOR || { create: standIn }).create(opts);
  const SAFE = /^(https?:|mailto:)/i;
  const standIn = ({ mount, html = '', placeholder = '', onChange = () => {}, onSelection = () => {}, keys = {}, plugins = [] }) => {
    const { model: M, state: S, view: V, commands: C, keymap: K, history: H, schemaList: L } = GZ_PM;
    const mark = (tags) => ({ parseDOM: tags.map((tag) => ({ tag })), toDOM: () => [tags[0], 0] });
    const schema = new M.Schema({
      nodes: {
        doc: { content: 'block+' },
        paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
        heading: { group: 'block', content: 'inline*', defining: true, attrs: { level: { default: 3 } }, parseDOM: [1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}`, attrs: { level: n < 4 ? 3 : 4 } })), toDOM: (n) => [`h${n.attrs.level}`, 0] },
        code_block: { group: 'block', content: 'text*', marks: '', code: true, defining: true, parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', { class: 'ql-syntax', spellcheck: 'false' }, 0] },
        bullet_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
        ordered_list: { group: 'block', content: 'list_item+', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] },
        list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
        text: { group: 'inline' },
        hard_break: { inline: true, group: 'inline', selectable: false, leafText: () => '\n', parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
      },
      marks: {
        link: { attrs: { href: {} }, inclusive: false, parseDOM: [{ tag: 'a[href]', getAttrs: (d) => (SAFE.test(d.getAttribute('href')) ? { href: d.getAttribute('href') } : false) }], toDOM: (m) => ['a', { href: m.attrs.href, rel: 'noopener noreferrer', target: '_blank' }, 0] },
        bold: mark(['strong', 'b']), italic: mark(['em', 'i']), underline: mark(['u']), strike: mark(['s', 'strike', 'del']),
        sup: { ...mark(['sup']), excludes: 'sub' }, sub: { ...mark(['sub']), excludes: 'sup' },
      },
    });
    const N = schema.nodes, T = schema.marks;
    // Quill's empty line is <p><br></p>; it reads back as an empty paragraph, and one goes out as that again.
    const parse = (h) => {
      const body = new DOMParser().parseFromString(`<!doctype html><body>${h}`, 'text/html').body;
      for (const p of body.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')) if (p.childNodes.length === 1 && p.firstChild.nodeName === 'BR') p.firstChild.remove();
      return M.DOMParser.fromSchema(schema).parse(body);
    };
    const out = M.DOMSerializer.fromSchema(schema);
    const toHTML = (doc) => {
      const d = document.createElement('div');
      d.append(out.serializeFragment(doc.content));
      for (const li of d.querySelectorAll('li')) if (li.children.length === 1 && li.firstElementChild.tagName === 'P') li.firstElementChild.replaceWith(...li.firstElementChild.childNodes);
      for (const e of d.querySelectorAll('p:empty, li:empty, h3:empty, h4:empty')) e.append(document.createElement('br'));
      return d.innerHTML;
    };
    const textOf = (doc) => doc.textBetween(0, doc.content.size, '\n', '\n');
    const empty = (doc) => doc.childCount === 1 && doc.firstChild.type === N.paragraph && !doc.firstChild.content.size;
    const shell = new S.Plugin({ props: { attributes: (st) => ({ role: 'textbox', 'aria-multiline': 'true', 'aria-label': placeholder, 'data-placeholder': placeholder, ...(empty(st.doc) && { 'data-empty': '' }) }) } });
    const listOf = (st) => { for (let d = st.selection.$from.depth; d > 0; d--) { const n = st.selection.$from.node(d); if (n.type === N.bullet_list || n.type === N.ordered_list) return { node: n, pos: st.selection.$from.before(d) }; } return null; };
    const list = (type) => (st, dispatch) => {
      const at = listOf(st);
      if (!at) return L.wrapInList(type)(st, dispatch);
      if (at.node.type === type) return L.liftListItem(N.list_item)(st, dispatch);
      dispatch?.(st.tr.setNodeMarkup(at.pos, type));
      return true;
    };
    const link = (href) => (st, dispatch) => {
      const { from, to, empty: none, $from } = st.selection;
      let a = from, b = to;
      if (none) {
        const { node, offset } = $from.parent.childAfter($from.parentOffset);
        if (!node || !T.link.isInSet(node.marks)) return false;
        a = $from.start() + offset; b = a + node.nodeSize;
      }
      if (!href) { dispatch?.(st.tr.removeMark(a, b, T.link)); return true; }
      if (none || !SAFE.test(href)) return false;
      dispatch?.(st.tr.removeMark(a, b, T.link).addMark(a, b, T.link.create({ href })));
      return true;
    };
    // Compose has no blockquote (Ultra's Quill keeps none): a quote is an italic paragraph, then one holding "— Name".
    const quote = (q = {}) => (st, dispatch) => {
      const text = String(q.text ?? st.doc.textBetween(st.selection.from, st.selection.to, ' ')).trim();
      if (!text) return false;
      const nodes = [N.paragraph.create(null, schema.text(text, [T.italic.create()])), ...(q.author ? [N.paragraph.create(null, schema.text(`— ${q.author}`))] : [])];
      dispatch?.(st.tr.replaceSelection(new M.Slice(M.Fragment.fromArray(nodes), 0, 0)).scrollIntoView());
      return true;
    };
    const COMMANDS = {
      bold: () => C.toggleMark(T.bold), italic: () => C.toggleMark(T.italic), underline: () => C.toggleMark(T.underline), strike: () => C.toggleMark(T.strike),
      sup: () => C.toggleMark(T.sup), sub: () => C.toggleMark(T.sub), link, bulletList: () => list(N.bullet_list), orderedList: () => list(N.ordered_list),
      indent: () => L.sinkListItem(N.list_item), outdent: () => L.liftListItem(N.list_item),
      heading: (n) => (n ? C.setBlockType(N.heading, { level: n === 4 ? 4 : 3 }) : C.setBlockType(N.paragraph)),
      clear: () => (st, dispatch) => { dispatch?.(Object.values(T).reduce((tr, m) => tr.removeMark(st.selection.from, st.selection.to, m), st.tr)); return true; },
      undo: () => H.undo, redo: () => H.redo, quote,
      insertText: (text) => (st, dispatch) => { dispatch?.(st.tr.insertText(String(text ?? ''))); return true; },
    };
    const own = {
      'Mod-b': C.toggleMark(T.bold), 'Mod-i': C.toggleMark(T.italic), 'Mod-u': C.toggleMark(T.underline),
      'Mod-z': H.undo, 'Shift-Mod-z': H.redo, 'Mod-y': H.redo,
      Enter: L.splitListItem(N.list_item), Tab: L.sinkListItem(N.list_item), 'Shift-Tab': L.liftListItem(N.list_item),
      'Shift-Enter': (st, dispatch) => { dispatch?.(st.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView()); return true; },
    };
    const extra = Object.fromEntries(Object.entries(keys).map(([k, fn]) => [k, (st, dispatch, view) => fn(st, dispatch, view) !== false]));
    const has = (st, type) => { const { from, to, empty: none, $from } = st.selection; return none ? !!type.isInSet(st.storedMarks || $from.marks()) : st.doc.rangeHasMark(from, to, type); };
    const active = (st = view.state) => {
      const l = listOf(st)?.node.type;
      return { ...Object.fromEntries(Object.keys(T).map((k) => [k, has(st, T[k])])), heading: st.selection.$from.parent.type === N.heading ? st.selection.$from.parent.attrs.level : 0, list: l === N.bullet_list ? 'bullet' : l === N.ordered_list ? 'ordered' : null, align: null };
    };
    const selection = (st) => {
      const { from, to, empty: none } = st.selection;
      let coords = null;
      try { const a = view.coordsAtPos(from), b = view.coordsAtPos(to); coords = { left: a.left, top: a.top, right: b.right, bottom: b.bottom }; } catch { /* not laid out */ }
      return { empty: none, from, to, coords, active: active(st) };
    };
    const api = {
      schema, html: () => toHTML(view.state.doc), text: () => textOf(view.state.doc), words: () => (textOf(view.state.doc).match(/\S+/g) || []).length,
      setHTML: (h) => view.updateState(S.EditorState.create({ doc: parse(String(h ?? '')), plugins: view.state.plugins })),
      focus: () => view.focus(), active: () => active(),
      run: (name, arg) => { const c = Object.hasOwn(COMMANDS, name) && COMMANDS[name](arg); return !!c && c(view.state, view.dispatch, view); },
      addPlugins: (more) => view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, ...more] })),
      destroy: () => view.destroy(),
    };
    const view = new V.EditorView(mount, {
      state: S.EditorState.create({ doc: parse(html), plugins: [H.history(), K.keymap(extra), K.keymap(own), K.keymap(C.baseKeymap), shell, ...plugins] }),
      dispatchTransaction(tr) {
        const st = view.state.apply(tr);
        view.updateState(st);
        if (tr.docChanged) onChange({ html: api.html(), text: api.text(), words: api.words(), docChanged: true });
        if (tr.docChanged || tr.selectionSet) onSelection(selection(st));
      },
    });
    api.view = view;
    return api;
  };

  // ---- look, words and size ----------------------------------------------------------------------------------------
  const TOKEN = /^--gz-[a-z0-9-]{1,40}$/;
  const look = (l = {}) => {
    for (const [k, v] of Object.entries(l.tokens || {})) if (TOKEN.test(k) && typeof v === 'string' && v.length < 400 && !/url\(|[;{}<>]/i.test(v)) root.style.setProperty(k, v);
    root.toggleAttribute('data-dark', !!l.dark);
    root.dataset.motion = ['off', 'subtle', 'expressive'].includes(l.motion) ? l.motion : 'subtle';
  };
  const LABELS = { bold: 'Bold', italic: 'Italic', underline: 'Underline', link: 'Link', bulletList: 'List', quote: 'Quote' };
  const count = () => { $('words').textContent = ed ? t('Word count: {n}', { n: words }) : ''; };
  const label = () => {
    for (const b of $('tb').querySelectorAll('[data-run]')) { b.title = t(LABELS[b.dataset.run]); b.setAttribute('aria-label', b.title); }
    $('tb').setAttribute('aria-label', t('Formatting'));
    $('more').title = t('More');
    $('more').setAttribute('aria-label', $('more').title);
    $('menu').querySelector('[data-do="native"]').textContent = t('Blackboard editor');
    count();
  };
  // The page's language: its catalogue loads beside the frame (i18n/<lang>.js); English until then.
  const lang = (tag) => {
    locale = typeof tag === 'string' && tag ? tag : 'en';
    const file = GZ_I18N.file(locale);
    label();
    if (!file || globalThis.GZ_LANGS?.[file.slice(5, -3)]) return;
    const s = document.createElement('script');
    s.src = file;
    s.onload = label;
    document.head.append(s);
  };
  let px = 0;
  const height = () => {
    const h = Math.ceil($('gw').getBoundingClientRect().height) + 6; // body's 3px each side holds the focus ring
    if (h !== px) { px = h; say({ type: 'height', px }); }
  };
  new ResizeObserver(height).observe($('gw'));

  // ---- popovers: the selection toolbar and ⋯ --------------------------------------------------------------------
  // Shown by a fade and scale (writer.css .pop), hidden at once, so nothing moves as you type.
  const show = (pop) => { if (!pop.hidden) return; pop.hidden = false; pop.getBoundingClientRect(); pop.setAttribute('data-open', ''); };
  const hide = (pop) => { pop.hidden = true; pop.removeAttribute('data-open'); };
  const tb = $('tb'), href = $('href'), menu = $('menu'), more = $('more');
  const writing = () => !!document.activeElement?.closest?.('.ProseMirror');
  const unlink = () => { tb.classList.remove('linking'); href.hidden = true; };
  let selected = null;
  const onSelection = (s) => {
    selected = s;
    if (tb.classList.contains('linking')) return;
    if (s.empty || !s.coords || !writing()) { hide(tb); return; }
    for (const b of tb.querySelectorAll('[data-run]')) b.classList.toggle('on', !!(b.dataset.run === 'bulletList' ? s.active.list === 'bullet' : s.active[b.dataset.run]));
    show(tb);
    const w = tb.offsetWidth, h = tb.offsetHeight, bar = document.querySelector('.gw-bar').getBoundingClientRect().top;
    // Above the selection where it fits, so the next line stays in view; below it on the first lines.
    let top = s.coords.top - h - 10;
    if (top < 3) top = Math.min(s.coords.bottom + 10, bar - h - 4);
    tb.style.left = `${Math.max(3, Math.min(s.coords.left - 4, innerWidth - w - 3))}px`;
    tb.style.top = `${Math.max(3, top)}px`;
  };
  tb.addEventListener('mousedown', (e) => { if (e.target !== href) e.preventDefault(); });
  tb.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run]');
    if (!b || !ed) return;
    if (b.dataset.run !== 'link') { ed.run(b.dataset.run); return; }
    if (ed.active().link) { ed.run('link', null); return; }
    tb.classList.add('linking');
    href.hidden = false;
    href.value = '';
    href.focus();
  });
  href.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    const v = href.value.trim();
    if (e.key === 'Enter' && v) ed.run('link', SAFE.test(v) ? v : `https://${v.replace(/^\/+/, '')}`);
    unlink();
    ed.focus();
  });
  href.addEventListener('blur', () => { unlink(); hide(tb); });
  const shut = (back) => { hide(menu); more.setAttribute('aria-expanded', 'false'); if (back) more.focus(); };
  const placeMenu = () => {
    const r = more.getBoundingClientRect();
    menu.style.right = `${Math.max(3, innerWidth - r.right)}px`;
    menu.style.bottom = `${innerHeight - r.top + 6}px`;
  };
  addEventListener('resize', () => { if (selected) onSelection(selected); if (!menu.hidden) placeMenu(); });
  more.addEventListener('click', () => {
    if (!menu.hidden) { shut(); return; }
    placeMenu();
    more.setAttribute('aria-expanded', 'true');
    show(menu);
    menu.querySelector('[role="menuitem"]').focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('[role="menuitem"]')], i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); shut(true); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('[data-do="native"]')) { shut(); say({ type: 'native' }); } });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !more.contains(e.target)) shut(); }, true);
  document.addEventListener('focusin', (e) => { if (!tb.contains(e.target) && !e.target.closest?.('.ProseMirror')) hide(tb); if (!menu.hidden && !menu.contains(e.target) && e.target !== more) shut(); });

  // ---- the page ----------------------------------------------------------------------------------------------------
  const onChange = (c) => {
    words = c.words;
    count();
    if (!quiet && c.docChanged !== false) say({ type: 'change', html: c.html, text: c.text, words: c.words });
  };
  const ON = {
    init: (m) => {
      if (ed) return;
      look(m.look);
      root.dataset.mode = m.mode === 'paper' ? 'paper' : 'compose';
      root.dataset.kind = typeof m.kind === 'string' ? m.kind : '';
      context = m.context && typeof m.context === 'object' ? m.context : {};
      ed = create({ mount: $('body'), mode: root.dataset.mode, html: typeof m.html === 'string' ? m.html : '', placeholder: typeof m.placeholder === 'string' ? m.placeholder : '', onChange, onSelection,
        keys: { 'Mod-Enter': () => { say({ type: 'send' }); return true; } } });
      words = ed.words();
      lang(m.locale);
      height();
    },
    look: (m) => look(m.look),
    context: (m) => { context = m.context && typeof m.context === 'object' ? m.context : {}; },
    focus: () => ed?.focus(),
    html: (m) => {
      if (!ed || typeof m.html !== 'string') return;
      quiet = true;
      try { ed.setHTML(m.html); } finally { quiet = false; }
      words = ed.words();
      count();
    },
  };
  // What later parts of the frame (proofing, targets, AI) build on.
  globalThis.GZ_WRITER_FRAME = { editor: () => ed, context: () => context, say };

  // One box per frame, and only with the one-use pass the page's Glaze got from the worker for this tab before it opened
  // the frame: a site that frames this page itself can't get one, since web pages can't message the worker.
  let taken = false;
  addEventListener('message', async (e) => {
    const p = e.ports?.[0], m = e.data;
    if (taken || !p || m?.type !== 'glaze:writer' || typeof m.pass !== 'string') return;
    const ok = await Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'claim', pass: m.pass })).then((r) => r?.ok === true, () => false);
    if (!ok || taken) { p.close(); return; }
    taken = true;
    port = p;
    port.onmessage = ({ data }) => { if (data && typeof data.type === 'string' && Object.hasOwn(ON, data.type)) ON[data.type](data); };
    say({ type: 'ready' });
    px = 0;
    height();
  });
})();
