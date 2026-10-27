// Glaze Writer's paper mode: an assignment attempt's paper as a word processor, the whole chrome around the editor that
// writer.js makes (glaze-plans/writer/mockups C): the title bar and save state, the toolbar (format, block style, marks,
// alignment, lists, Cite, Footnote, Page break, undo and redo, zoom, Focus, Submit…), real Letter pages with the running
// header and footnotes (lib/writer-paginate.js), the side panel (Checks, Sources, Feedback, Outline) and the status bar.
// The paper lives in Writer's storage (lib/writer-papers.js), autosaved with versions; it never goes into Ultra's editor:
// the submit step attaches it as a .docx (lib/writer-docx.js). The same chrome edits a paper in papers.html.
// Classic script after writer.js; the paper libraries load only when a paper opens.
var GZ_WRITER_PAPER = globalThis.GZ_WRITER_PAPER || (() => {
  const LIBS = ['lib/writer-styles.js', 'lib/writer-paginate.js', 'lib/writer-format.js', 'lib/writer-papers.js'];
  const DOCX = ['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js'];
  const GAP = 26.4; // between pages, in page px (22px at 100%)
  const PX100 = 80 / 96; // 100% shows an inch as 80px, as the mockup does
  const loaded = new Map();
  const script = (src) => {
    if (!loaded.has(src)) loaded.set(src, new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { loaded.delete(src); no(new Error(`${src} did not load`)); }; document.head.append(s); }));
    return loaded.get(src);
  };
  const need = (files) => files.reduce((p, f) => p.then(() => script(f)), Promise.resolve());

  // ---- small DOM helpers
  const SVG = 'http://www.w3.org/2000/svg';
  const PATHS = {
    caret: 'm6 9 6 6 6-6', align: 'M4 6h16M4 12h10M4 18h16', center: 'M4 6h16M7 12h10M4 18h16', right: 'M4 6h16M10 12h10M4 18h16', justify: 'M4 6h16M4 12h16M4 18h16',
    bullets: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', numbers: 'M10 6h10M10 12h10M10 18h10M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
    cite: 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6', note: 'M4 18h10M4 14h16M4 10h16M4 6h16M18 18v-4', brk: 'M3 12h4M10 12h4M17 12h4M6 4v5h12V4M6 20v-5h12v5',
    undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3', focus: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', back: 'M15 18l-6-6 6-6',
  };
  const icon = (name, cls = 'gp-ico') => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', PATHS[name]); s.append(p); return s; };
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };
  const btn = (props, ...kids) => h('button', { type: 'button', ...props }, ...kids);

  // A paper's mount. host: { editor (GZ_WRITER_EDITOR in paper mode), t(key, vars), say(msg) (to the page), context() and
  // onContext(fn) (Ultra's names, the paper's key), standalone (papers.html: no Submit or Focus), key (papers.html's
  // paper) }. → the paper's API (also GZ_WRITER_PAPER.current()).
  let current = null;
  const mount = async (host) => {
    const editable = host.editor.view.props.editable;
    host.editor.view.setProps({ editable: () => false });
    await need(LIBS);
    const ST = GZ_WRITER_STYLES, F = GZ_WRITER_FORMAT, PG = GZ_WRITER_PAGINATE, PA = GZ_WRITER_PAPERS, S = GZ_WRITER_SCHEMA, PM = GZ_PM;
    const ed = host.editor, view = ed.view, t = (k, v) => host.t(k, v), store = PA.open();
    const ISSUES = () => globalThis.GZ_WRITER_ISSUES || null;
    let format = ST.FORMATS.mla9, key = null, paper = null, ctx = host.context?.() || {}, presets = [], zoom = 'fit', scale = PX100, layout = null, page = 1, focus = false;
    const nf = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);

    // ---- the chrome
    const title = h('h1'), due = h('span', { class: 'gp-due' }), state = h('span', { class: 'gp-state', role: 'status' });
    const pill = btn({ class: 'gp-pill', 'aria-haspopup': 'menu' }), block = btn({ class: 'gp-box', 'aria-haspopup': 'menu' });
    const mark = (run, label, kid) => btn({ 'data-run': run, title: t(label), 'aria-label': t(label), 'aria-pressed': 'false' }, kid);
    const marks = [mark('bold', 'Bold', 'B'), mark('italic', 'Italic', h('i', { text: 'I' })), mark('underline', 'Underline', h('u', { text: 'U' }))];
    const alignB = btn({ title: t('Alignment'), 'aria-label': t('Alignment'), 'aria-haspopup': 'menu' }, icon('align'));
    const bullets = btn({ 'data-run': 'bulletList', title: t('Bulleted list'), 'aria-label': t('Bulleted list'), 'aria-pressed': 'false' }, icon('bullets'));
    const numbers = btn({ 'data-run': 'orderedList', title: t('Numbered list'), 'aria-label': t('Numbered list'), 'aria-pressed': 'false' }, icon('numbers'));
    const cite = btn({ class: 'gp-tbtn', disabled: true }, icon('cite'), t('Cite'));
    const note = btn({ class: 'gp-tbtn' }, icon('note'), t('Footnote'));
    const brk = btn({ class: 'gp-tbtn' }, icon('brk'), t('Page break'));
    const undo = btn({ title: t('Undo'), 'aria-label': t('Undo') }, icon('undo')), redo = btn({ title: t('Redo'), 'aria-label': t('Redo') }, icon('redo'));
    const zoomB = btn({ class: 'gp-box', 'aria-haspopup': 'menu', title: t('Zoom') });
    const focusB = btn({ class: 'gp-tbtn', title: t('Focus'), 'aria-label': t('Focus'), 'aria-pressed': 'false' }, icon('focus'));
    // Submit… stays off until the submit step sets GZ_WRITER_PAPER.submit (TODO 3K: the submit sheet and Ultra's upload).
    const submit = btn({ class: 'gp-submit', disabled: true }, t('Submit…'));
    const sheets = h('div'), flow = h('div', { class: 'gp-flow' }), measureBox = h('div', { class: 'gp-notes gp-measure', 'aria-hidden': 'true' });
    const zoomEl = h('div', { class: 'gp-zoom' }, sheets, flow, measureBox), size = h('div', { class: 'gp-size' }, zoomEl);
    const canvas = h('div', { class: 'gp-canvas' }, size);
    const pageL = h('span'), wordsL = h('span'), fontL = h('span'), versionsB = btn({ 'aria-haspopup': 'menu' }, t('Versions'));
    const status = h('div', { class: 'gp-status' }, pageL, wordsL, h('span', { class: 'grow' }), fontL, versionsB);
    const tabs = {}, panes = {}, badges = {};
    for (const [id, label] of [['checks', 'Checks'], ['sources', 'Sources'], ['feedback', 'Feedback'], ['outline', 'Outline']]) {
      badges[id] = h('span', { class: 'gp-badge' });
      tabs[id] = btn({ class: 'gp-tab', role: 'tab', 'aria-selected': String(id === 'checks'), tabindex: id === 'checks' ? '0' : '-1', 'aria-controls': `gp-${id}`, id: `gp-tab-${id}` }, t(label), badges[id]);
      panes[id] = h('div', { class: 'gp-pane', role: 'tabpanel', id: `gp-${id}`, 'aria-labelledby': `gp-tab-${id}`, hidden: id !== 'checks' });
    }
    const issuesEl = h('div', { class: 'gp-issues' }), checklist = h('div', { class: 'gp-list' }), outline = h('div', { class: 'gp-outline' });
    panes.checks.append(issuesEl, checklist);
    panes.outline.append(outline);
    const side = h('aside', { class: 'gp-side' }, h('div', { class: 'gp-tabs', role: 'tablist' }, Object.values(tabs)), Object.values(panes));
    const file = h('input', { type: 'file', accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', hidden: true });
    const root = h('div', { class: `gp${host.standalone ? ' gp-standalone' : ''}` },
      h('header', { class: 'gp-top' }, host.standalone ? h('a', { href: 'papers.html', text: t('Papers') }) : null, title, due, h('span', { class: 'grow' }), state),
      h('div', { class: 'gp-tool', role: 'toolbar', 'aria-label': t('Formatting') }, pill, block,
        h('div', { class: 'gp-tb' }, marks, h('span', { class: 'gp-sepv' }), alignB, bullets, numbers, h('span', { class: 'gp-sepv' })),
        cite, note, brk, h('span', { class: 'grow' }), h('div', { class: 'gp-tb' }, undo, redo), zoomB, host.standalone ? null : focusB, host.standalone ? null : submit),
      h('div', { class: 'gp-work' }, h('div', { class: 'gp-col' }, canvas, status), side), file);
    (host.root || document.body).append(root);
    flow.style.visibility = 'hidden';
    flow.append(view.dom);

    // The format's page CSS, in an adopted sheet (the frame's CSP allows no <style>).
    const sheet = typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype ? new CSSStyleSheet() : null;
    if (sheet) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const restyleCSS = () => {
      const css = ST.css(format);
      if (sheet) { sheet.replaceSync(css); return; }
      const own = [...document.styleSheets].find((s) => /writer-paper\.css$/.test(s.href || ''));
      if (!own) return;
      own.gzRules ||= [];
      for (const i of own.gzRules.reverse()) own.deleteRule(i);
      own.gzRules = css.split('\n').map((r) => own.insertRule(r, own.cssRules.length));
    };

    // ---- menus and popovers (writer.css .pop: they scale in and fade; they go at once)
    let open = null;
    const close = (back) => { if (!open) return; const o = open; open = null; o.el.remove(); o.opener?.setAttribute('aria-expanded', 'false'); if (back) o.opener?.focus(); };
    const popup = (opener, el, { above = false } = {}) => {
      close();
      el.classList.add('pop');
      document.body.append(el);
      const r = opener.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`;
      el.style.top = `${above ? Math.max(4, r.top - hh - 6) : Math.min(r.bottom + 6, innerHeight - hh - 4)}px`;
      el.style.transformOrigin = above ? 'bottom left' : 'top left';
      el.addEventListener('keydown', (e) => {
        const all = [...el.querySelectorAll('[role^=menuitem]')], i = all.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (all.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length]?.focus(); }
      });
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      opener.setAttribute('aria-expanded', 'true');
      open = { el, opener };
      el.querySelector('button, input, select, textarea')?.focus();
    };
    const menu = (opener, items, o) => {
      const el = h('div', { class: 'gp-menu', role: 'menu' });
      for (const it of items) {
        if (it === '-') { el.append(h('div', { class: 'gp-hr', role: 'separator' })); continue; }
        el.append(btn({ role: it.checked == null ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked == null ? null : String(!!it.checked), onclick: () => { close(); it.run(); } }, it.label, it.hint ? h('small', { text: it.hint }) : null));
      }
      el.addEventListener('keydown', (e) => {
        const all = [...el.querySelectorAll('[role^="menuitem"]')], i = all.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); close(true); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus(); }
      });
      popup(opener, el, o);
    };
    document.addEventListener('pointerdown', (e) => { if (open && !open.el.contains(e.target) && !open.opener?.contains(e.target)) close(); }, true);
    let toastTimer = 0;
    const toast = (text) => {
      document.querySelector('.gp-toast')?.remove();
      const el = h('div', { class: 'pop gp-toast', role: 'status', text });
      document.body.append(el);
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.remove(), 6000);
    };

    // ---- the editor's extra plugins: page styling and pagination, change watching, note clicks, fallback underlines
    const noteCache = new Map();
    const noteBody = (content, n) => {
      const d = S.parse(S.paper, `<p>${content}</p>`), p = h('p', {}, h('sup', { text: String(n) }), ' ');
      d.descendants((x) => { if (x.isTextblock) { p.append(PM.model.DOMSerializer.fromSchema(S.paper).serializeFragment(x.content)); return false; } return true; });
      return p;
    };
    const noteHeights = (contents) => contents.map((c, i) => {
      const k = `${format.id}|${i}|${c}`;
      if (!noteCache.has(k)) { measureBox.replaceChildren(noteBody(c, i + 1)); noteCache.set(k, measureBox.firstChild.offsetHeight); }
      return noteCache.get(k);
    });
    const issuesKey = new PM.state.PluginKey('gz-paper-issues');
    let formatIssues = [], ignored = new Set(), picked = null;
    const fallback = new PM.state.Plugin({
      key: issuesKey,
      state: { init: () => PM.view.DecorationSet.empty, apply: (tr, set) => (tr.getMeta(issuesKey) || set.map(tr.mapping, tr.doc)) },
      props: { decorations: (s) => issuesKey.getState(s) },
    });
    const watch = new PM.state.Plugin({
      view: () => ({ update: (v, prev) => { if (v.state.doc !== prev.doc) changed(); else if (!v.state.selection.eq(prev.selection)) selected(); } }),
      props: {
        handleClickOn: (_v, pos, node) => { if (node.type.name === 'footnote_ref') { editNote(pos); return true; } return false; },
        handleKeyDown: (_v, e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return true; }
          // Ahead of ProseMirror's own Escape (select the parent node).
          if (e.key === 'Escape' && focus) { setFocus(false); return true; }
          return false;
        },
      },
    });
    ed.addPlugins([PG.styler(() => format), PG.plugin({ format: () => format, notes: noteHeights, gap: GAP, onLayout: (l) => { layout = l; draw(); } }), watch, fallback]);

    // ---- pages
    const surname = () => F.surname(view.state.doc, format);
    const draw = () => {
      if (!layout) return;
      const geo = ST.geometry(format), stride = geo.height + GAP, n = layout.pages.length;
      zoomEl.style.width = `${geo.width}px`;
      zoomEl.style.height = `${n * stride - GAP}px`;
      zoomEl.style.transform = `scale(${scale})`;
      size.style.width = `${geo.width * scale}px`;
      size.style.height = `${(n * stride - GAP) * scale}px`;
      while (sheets.children.length > n) sheets.lastChild.remove();
      while (sheets.children.length < n) sheets.append(h('div', { class: 'gp-sheet' }, h('div', { class: 'gp-hdr' }), h('div', { class: 'gp-notes' })));
      const name = surname(), sep = ST.lineHeight(format, { line: 1 });
      layout.pages.forEach((pg, i) => {
        const s = sheets.children[i];
        s.style.top = `${i * stride}px`;
        s.firstChild.textContent = ST.headerText(format, i + 1, name);
        const notesEl = s.lastChild;
        notesEl.style.bottom = `${geo.bottom}px`;
        const rule = h('div', { class: 'gp-sep' }, h('div', { class: 'gp-rule' }));
        rule.style.height = `${sep}px`;
        notesEl.replaceChildren(...(pg.notes.length ? [rule, ...pg.fragments.map((part) => {
          const body = noteBody(layout.notes[part.id] || '', part.id + 1);
          if (!part.from && part.height === part.total) return body;
          const clip = h('div'); clip.style.cssText = `height:${part.height}px;overflow:hidden`;
          body.style.transform = `translateY(-${part.from}px)`; clip.append(body); return clip;
        })] : []));
      });
      flow.style.visibility = '';
      selected();
    };
    const fit = () => {
      const w = canvas.clientWidth - 48;
      return Math.max(0.3, Math.min(PX100, w / ST.geometry(format).width));
    };
    const setZoom = (z) => {
      zoom = z;
      scale = z === 'fit' ? fit() : z * PX100;
      zoomB.replaceChildren(`${Math.round((scale / PX100) * 100)}%`);
      draw();
    };
    new ResizeObserver(() => { if (zoom === 'fit') setZoom('fit'); }).observe(canvas);

    // ---- status, toolbar state, outline
    const SPACING = { 1: 'Single', 1.15: '1.15', 1.5: '1.5', 2: 'Double' };
    const selected = () => {
      if (!layout) return;
      try {
        const top = view.dom.getBoundingClientRect().top, y = (view.coordsAtPos(view.state.selection.head).top - top) / scale;
        page = Math.min(layout.pages.length, Math.max(1, Math.floor(y / (ST.geometry(format).height + GAP)) + 1));
      } catch { /* not laid out */ }
      pageL.textContent = t('Page {n} of {m}', { n: page, m: layout.pages.length });
      const a = ed.active();
      for (const b of marks) b.setAttribute('aria-pressed', String(!!a[b.dataset.run]));
      bullets.setAttribute('aria-pressed', String(a.list === 'bullet'));
      numbers.setAttribute('aria-pressed', String(a.list === 'ordered'));
      block.replaceChildren(blockName(a), icon('caret', 'gp-ico gp-caret'));
    };
    const blockName = (a) => (a.heading ? t('Heading {n}', { n: a.heading }) : a.quote ? t('Block quote') : a.align === 'center' ? t('Title') : t('Body'));
    const counts = () => {
      wordsL.textContent = t('{n} words', { n: nf(ed.words()) });
      fontL.textContent = `${format.font} ${format.size} · ${t(SPACING[format.line] || String(format.line))}`;
      pill.replaceChildren(format.label, icon('caret', 'gp-ico gp-caret'));
    };
    const outlineDraw = () => {
      const items = [];
      view.state.doc.descendants((n, pos) => { if (n.type.name === 'heading' && n.textContent.trim()) items.push({ n, pos }); return !n.isTextblock; });
      outline.replaceChildren(...items.map(({ n, pos }) => btn({ onclick: () => go(pos + 1, pos + 1) }, n.textContent)));
      items.forEach(({ n }, i) => { outline.children[i].style.paddingLeft = `${8 + (n.attrs.level - 1) * 14}px`; });
    };
    const go = (from, to) => {
      const tr = view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, from, to)).scrollIntoView();
      view.dispatch(tr);
      view.focus();
    };

    // ---- checks
    const lines = (from, to) => {
      try {
        const a = view.domAtPos(from), b = view.domAtPos(to), r = document.createRange();
        r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
        const lh = ST.lineHeight(format) * scale * 1.6, tops = new Set();
        for (const x of r.getClientRects()) if (x.height && x.height < lh) tops.add(Math.round(x.top / 4));
        return tops.size || 1;
      } catch { return 1; }
    };
    const ROWS = new Map();
    const ignoreKey = (i) => `${i.rule}|${view.state.doc.textBetween(Math.max(0, i.from), Math.min(view.state.doc.content.size, i.to), ' ')}`;
    const runChecks = () => {
      const r = F.check(view.state.doc, format, { name: ctx.user?.name || '', course: ctx.course?.name || '' }, { lines });
      formatIssues = r.issues.filter((i) => !ignored.has(ignoreKey(i)));
      for (const row of r.rows) ROWS.set(row.id, row.label);
      const list = r.rows.map((row) => ({ ...row, count: formatIssues.filter((i) => i.row === row.id).length }));
      checklist.replaceChildren(h('h4', { text: format.label }), ...list.map((row) => h('div', {}, t(row.label), h('span', { class: row.count ? 'gp-no' : 'gp-ok', text: row.count ? nf(row.count) : '✓' }))));
      if (ISSUES()) ISSUES().set('format', formatIssues);
      else view.dispatch(view.state.tr.setMeta(issuesKey, PM.view.DecorationSet.create(view.state.doc, formatIssues.filter((i) => i.to > i.from).map((i) => PM.view.Decoration.inline(i.from, i.to, { class: i === picked ? 'gp-u-format gp-cur' : 'gp-u-format' })))).setMeta('addToHistory', false));
      cards();
    };
    const KIND = { spelling: ['Spelling', 'var(--gz-err)'], grammar: ['Grammar', 'var(--gz-warn)'], style: ['Style', 'var(--gz-warn)'], format: ['Format', 'var(--fmt)'], citation: ['Citation', 'var(--fmt)'] };
    const allIssues = () => {
      const theirs = ISSUES() ? ISSUES().list() : [];
      const mine = ISSUES() ? [] : formatIssues;
      return [...theirs.map((i) => (i.source === 'format' ? formatIssues.find((x) => x.id === i.id) || i : i)), ...mine].sort((a, b) => a.from - b.from);
    };
    const cards = () => {
      const list = allIssues();
      badges.checks.textContent = list.length ? nf(list.length) : '';
      issuesEl.replaceChildren(...list.slice(0, 200).map((i) => {
        const [kind, color] = KIND[i.kind] || KIND.format;
        const own = i.source === 'format', msg = own ? t(i.key || i.message, localVars(i.vars)) : i.message;
        const label = own ? (i.suggestions.length ? msg : t(ROWS.get(i.row) || kind)) : t(kind);
        const what = i.suggestions.length ? [h('s', { text: view.state.doc.textBetween(i.from, i.to, ' ') }), ' → ', h('b', { text: i.suggestions[0] })] : [h('b', { text: own ? msg : i.message })];
        const card = h('div', { class: `gp-issue${picked?.id === i.id ? ' gp-on' : ''}`, tabindex: '0', 'data-rule': own ? i.rule : null },
          h('div', { class: 'gp-lbl' }, h('span', { class: 'gp-dot' }), label),
          h('div', { class: 'gp-fix' }, what),
          h('div', { class: 'gp-row' }, i.suggestions.length || i.fix ? btn({ class: 'gp-sbtn', onclick: (e) => { e.stopPropagation(); fixIssue(i); } }, t('Fix')) : null, btn({ class: 'gp-sbtn gp-ghost', onclick: (e) => { e.stopPropagation(); ignoreIssue(i); } }, t('Ignore'))));
        card.querySelector('.gp-dot').style.background = color;
        card.addEventListener('keydown', (e) => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); } });
        card.addEventListener('click', () => { picked = i; if (i.to > i.from || i.from > 0) go(Math.max(1, i.from), Math.max(1, i.to)); runChecksSoon(); });
        return card;
      }));
    };
    const localVars = (v) => (v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && /^[A-Z]/.test(x) && !/\d/.test(x) && !ST.FONTS.includes(x) ? t(x) : x])) : v);
    const ignoreIssue = (i) => {
      if (i.source !== 'format') { ISSUES()?.ignore(i); cards(); return; }
      ignored.add(ignoreKey(i));
      ISSUES()?.ignore(i);
      runChecks();
    };
    // The format fixes: each one transaction, undoable at once.
    const fixIssue = (i) => {
      if (i.source !== 'format' || (!i.fix && i.suggestions.length)) {
        if (ISSUES() && i.source !== 'format') { ISSUES().apply(i, 0); return; }
        view.dispatch(view.state.tr.insertText(i.suggestions[0], i.from, i.to));
        return;
      }
      const s = view.state, n = s.schema.nodes, m = s.schema.marks, tr = s.tr, x = i.fix, para = (text, attrs, bold) => n.paragraph.create(attrs, text ? s.schema.text(text, bold ? [m.bold.create()] : []) : null);
      const tops = [];
      s.doc.forEach((node, pos) => tops.push({ node, pos }));
      if (x.op === 'opening') tr.insert(0, F.opening(format, values()).map((j) => s.schema.nodeFromJSON(j)));
      else if (x.op === 'heading-order') {
        const order = ['name', 'instructor', 'course', 'date'], seen = tops.slice(0, 4), placed = order.map((want) => seen[x.roles.indexOf(want)] || null);
        const rest = seen.filter((t2) => !placed.includes(t2));
        const nodes = placed.map((p) => p || rest.shift()).map((p) => p.node);
        tr.replaceWith(0, seen[3].pos + seen[3].node.nodeSize, nodes);
      } else if (x.op === 'unmark') tr.removeMark(i.from, i.to, m[x.mark]);
      else if (x.op === 'mark') tr.addMark(i.from, i.to, m[x.mark].create());
      else if (x.op === 'attr') { const node = s.doc.nodeAt(x.at); if (node) tr.setNodeMarkup(x.at, null, { ...node.attrs, [x.key]: x.value }); }
      else if (x.op === 'format') { setFormat(ST.FORMATS[x.id]); return; }
      else if (x.op === 'list-add') tr.insert(s.doc.content.size, F.closing(format).map((j) => s.schema.nodeFromJSON(j)));
      else if (x.op === 'page-break') tr.insert(x.at, n.page_break.create());
      else if (x.op === 'hanging') for (const at of x.at) { const node = s.doc.nodeAt(at); if (node) tr.setNodeMarkup(at, null, { ...node.attrs, first: null, indent: 0 }); }
      else if (x.op === 'sort') {
        const part = tops.slice(x.from, x.to), sorted = [...part].sort((a, b) => a.node.textContent.trim().replace(/^[^\p{L}\p{N}]+/u, '').localeCompare(b.node.textContent.trim().replace(/^[^\p{L}\p{N}]+/u, ''), 'en', { sensitivity: 'base' }));
        tr.replaceWith(part[0].pos, part.at(-1).pos + part.at(-1).node.nodeSize, sorted.map((p) => p.node));
      } else if (x.op === 'title-repeat') tr.insert(x.at, para(x.title, { align: 'center' }, format.title.bold));
      else if (x.op === 'to-note') {
        const before = s.doc.textBetween(x.from - 1, x.from) === ' ' ? x.from - 1 : x.from;
        tr.replaceWith(before, x.to, n.footnote_ref.create({ content: S.inline(x.note.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])) }));
      } else if (x.op === 'block-quote') {
        const $f = s.doc.resolve(x.from), start = $f.start(), end = $f.end(), text = s.doc.textBetween(x.from + 1, x.to - 1, ' ');
        const parts = [s.doc.slice(start, x.from).content, s.doc.slice(x.to, end).content];
        const out = [];
        if (parts[0].size && s.doc.textBetween(start, x.from).trim()) out.push(n.paragraph.create($f.parent.attrs, parts[0]));
        out.push(n.blockquote.create(null, n.paragraph.create(null, s.schema.text(text))));
        if (parts[1].size && s.doc.textBetween(x.to, end).trim()) out.push(n.paragraph.create({ ...$f.parent.attrs, first: 0 }, parts[1]));
        tr.replaceWith($f.before(), $f.after(), out);
      }
      if (tr.docChanged) view.dispatch(tr.scrollIntoView());
      view.focus();
    };
    let checkTimer = 0;
    const runChecksSoon = () => { clearTimeout(checkTimer); checkTimer = setTimeout(runChecks, 250); };
    ISSUES()?.on?.(() => cards());

    // ---- saving
    const values = () => ({ name: ctx.user?.name || '', instructor: ctx.instructor || '', course: ctx.course?.name || '', date: ST.dateText(format), dueDate: Number.isFinite(Date.parse(ctx.assignment?.due || paper?.due)) ? ST.dateText(format, new Date(ctx.assignment?.due || paper.due)) : '', title: ctx.assignment?.title || '' });
    let saveTimer = 0, dirty = false, edits = 0, initializing = true, sessionSafe = false;
    const initialBody = view.state.doc.content.content.filter((n) => n.textContent.trim() || n.type.name !== 'paragraph').map((n) => n.toJSON());
    const recoveryScope = host.key || ctx.recovery || 'paper';
    const recoverySlot = `gz-paper-pending:${recoveryScope}`, keySlot = `gz-paper-key:${recoveryScope}`;
    let recoveryKey;
    try { recoveryKey = sessionStorage.getItem(keySlot); } catch { /* storage can be unavailable */ }
    recoveryKey ||= `recovery:${crypto.randomUUID()}`;
    try { sessionStorage.setItem(keySlot, recoveryKey); } catch { /* the durable copy is still in Papers */ }
    const setState = (k) => { state.textContent = k ? t(k) : ''; };
    const record = () => ({
      doc: view.state.doc.toJSON(), words: ed.words(), format: format.base ? ST.preset(format) : format.id,
      title: ctx.assignment?.title || paper?.title || '', due: ctx.assignment?.due || paper?.due || null, url: ctx.paper?.url || paper?.url || '',
      courseName: ctx.course?.name || paper?.courseName || '', ...(ctx.paper ? { school: ctx.paper.school, user: ctx.paper.user, course: ctx.paper.course, content: ctx.paper.content } : {}),
    });
    const emergency = () => {
      try { sessionStorage.setItem(recoverySlot, JSON.stringify({ key, record: record() })); sessionSafe = true; }
      catch { sessionSafe = false; }
    };
    const save = async (reason = 'auto') => {
      clearTimeout(saveTimer);
      if (!key) { setState('Not saved'); return null; }
      const at = edits;
      emergency();
      setState('Saving…');
      try {
        const r = await store.save(key, record(), { reason }); paper = r.paper;
        if (at === edits) { dirty = false; setState('Saved'); try { sessionStorage.removeItem(recoverySlot); } catch {} }
        return r;
      } catch (e) { dirty = true; console.error(e); setState('Not saved'); return null; }
    };
    const changed = () => {
      if (initializing) return;
      edits++; dirty = true;
      emergency();
      setState(key ? 'Saving…' : 'Not saved');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 800);
      counts();
      runChecksSoon();
      clearTimeout(outlineDraw.t);
      outlineDraw.t = setTimeout(outlineDraw, 400);
    };
    addEventListener('beforeunload', (e) => { if (dirty && !sessionSafe) { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('pagehide', () => { if (dirty) save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) save(); });

    // The document as a whole: on load a fresh state (no undo past it); otherwise one undoable step.
    const setDoc = (json, fresh = false) => {
      const doc = S.paper.nodeFromJSON(json);
      if (fresh) view.updateState(PM.state.EditorState.create({ doc, plugins: view.state.plugins }));
      else view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).scrollIntoView());
    };
    const setFormat = async (f, { save: keep = true } = {}) => {
      if (!f) return;
      if (keep && dirty && !await save()) return;
      const before = format;
      format = f;
      noteCache.clear();
      restyleCSS();
      const rebuilt = before.opening !== f.opening || before.cite !== f.cite || before.list.title !== f.list.title;
      if (rebuilt) setDoc(F.restyle(view.state.doc, before, f, values()));
      PG.relayout(view);
      counts();
      runChecks();
      if (keep) await save(rebuilt ? 'format' : 'auto');
    };

    // ---- toolbar actions
    const presetMenu = () => [
      ...ST.IDS.map((id) => ({ label: ST.FORMATS[id].label, checked: format.id === id, run: () => setFormat(ST.FORMATS[id]) })),
      ...(presets.length ? ['-', ...presets.map((p) => ST.custom(p)).filter(Boolean).map((p) => ({ label: p.label, checked: format.id === p.id, run: () => setFormat(p) }))] : []),
      '-', { label: t('New preset…'), run: presetForm },
    ];
    const presetForm = () => {
      const opt = (v, label, sel) => h('option', { value: String(v), selected: sel || null }, label);
      const name = h('input', { type: 'text', maxlength: '40', value: t('My format') });
      const base = h('select', {}, ST.IDS.map((id) => opt(id, ST.FORMATS[id].label, (format.base || format.id) === id)));
      const font = h('select', {}, ST.FONTS.map((x) => opt(x, x, format.font === x)));
      const fsize = h('select', {}, [10, 10.5, 11, 11.5, 12, 13, 14].map((x) => opt(x, String(x), format.size === x)));
      const line = h('select', {}, [1, 1.15, 1.5, 2].map((x) => opt(x, t(SPACING[x]), format.line === x)));
      const margin = h('select', {}, [0.75, 1, 1.25, 1.5].map((x) => opt(x, `${x}″`, format.margins[0] === x)));
      const first = h('select', {}, [0, 0.25, 0.5].map((x) => opt(x, `${x}″`, format.first === x)));
      const header = h('select', {}, [['name-page', t('Name and page')], ['page', t('Page number')], ['none', t('None')]].map(([v, l]) => opt(v, l, format.header.text === v)));
      const row = (label, el) => h('label', {}, t(label), el);
      const el = h('div', { class: 'gp-menu gp-form', role: 'dialog', 'aria-label': t('New preset…') },
        row('Name', name), row('Based on', base), row('Font', font), row('Size', fsize), row('Spacing', line), row('Margins', margin), row('First-line indent', first), row('Header', header),
        h('div', { class: 'gp-row' }, btn({ class: 'gp-sbtn', onclick: async () => {
          const p = { id: `custom:${Date.now().toString(36)}`, label: name.value, base: base.value, font: font.value, size: +fsize.value, line: +line.value, margin: +margin.value, first: +first.value, header: header.value };
          const f = ST.custom(p);
          if (!f) return;
          close();
          const scope = PA.scopeOf(ctx.paper || paper || {});
          if (scope) { await store.savePreset(scope, p); presets = await store.presets(scope); }
          else presets = [...presets, p];
          setFormat(f);
        } }, t('Save')), btn({ class: 'gp-sbtn gp-ghost', onclick: () => close(true) }, t('Cancel'))));
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
      popup(pill, el);
    };
    pill.addEventListener('click', () => (open?.opener === pill ? close() : menu(pill, presetMenu())));
    const STYLES = [['Body', () => { lift(); ed.run('heading', 0); ed.run('align', 'left'); }], ['Title', () => { lift(); ed.run('heading', 0); ed.run('align', 'center'); }],
      ...[1, 2, 3, 4].map((n) => [t('Heading {n}', { n }), () => { lift(); ed.run('heading', n); }]), ['Block quote', () => { ed.run('heading', 0); PM.commands.wrapIn(view.state.schema.nodes.blockquote)(view.state, view.dispatch); }]];
    const lift = () => { while (ed.active().quote && PM.commands.lift(view.state, view.dispatch)); };
    block.addEventListener('click', () => (open?.opener === block ? close() : menu(block, STYLES.map(([label, run]) => ({ label: t(label), checked: blockName(ed.active()) === t(label), run: () => { run(); view.focus(); } })))));
    for (const b of [...marks, bullets, numbers]) b.addEventListener('click', () => { ed.run(b.dataset.run); view.focus(); });
    for (const b of root.querySelectorAll('.gp-tool button')) b.addEventListener('mousedown', (e) => e.preventDefault());
    alignB.addEventListener('click', () => (open?.opener === alignB ? close() : menu(alignB, [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify']].map(([d, l]) => ({ label: t(l), checked: ed.active().align === d, run: () => { ed.run('align', d); view.focus(); } })))));
    undo.addEventListener('click', () => { ed.run('undo'); view.focus(); });
    redo.addEventListener('click', () => { ed.run('redo'); view.focus(); });
    brk.addEventListener('click', () => { ed.run('pageBreak'); view.focus(); });
    note.addEventListener('click', () => { const at = view.state.selection.to; if (ed.run('footnote', '')) editNote(at, true); });
    zoomB.addEventListener('click', () => (open?.opener === zoomB ? close() : menu(zoomB, [{ label: t('Fit'), checked: zoom === 'fit', run: () => setZoom('fit') }, '-', ...[0.75, 1, 1.25, 1.5].map((z) => ({ label: `${z * 100}%`, checked: zoom === z, run: () => setZoom(z) }))])));
    const setFocus = (on) => { focus = on; focusB.setAttribute('aria-pressed', String(on)); host.say?.({ type: 'focus-mode', on }); };
    focusB.addEventListener('click', () => setFocus(!focus));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && focus && !open && !e.defaultPrevented) setFocus(false); });
    const hooks = () => {
      const C = globalThis.GZ_WRITER_CITE;
      if (C?.button) { const b = C.button({ editor: ed, paper: api }); if (b) { b.classList.add('gp-tbtn'); cite.replaceWith(b); } }
      else if (C) cite.disabled = false;
      if (C?.sourcesView) C.sourcesView(panes.sources, { editor: ed, paper: api, badge: (n) => { badges.sources.textContent = n ? nf(n) : ''; } });
      if (globalThis.GZ_WRITER_AI?.feedbackView) GZ_WRITER_AI.feedbackView(panes.feedback, { editor: ed, paper: api });
      submit.disabled = typeof GZ_WRITER_PAPER.submit !== 'function';
    };
    submit.addEventListener('click', () => { if (typeof GZ_WRITER_PAPER.submit === 'function') GZ_WRITER_PAPER.submit(api); });
    for (const [id, tab] of Object.entries(tabs)) tab.addEventListener('click', () => {
      for (const [k, x] of Object.entries(tabs)) { x.setAttribute('aria-selected', String(k === id)); x.tabIndex = k === id ? 0 : -1; panes[k].hidden = k !== id; }
      if (id === 'outline') outlineDraw();
    });

    side.querySelector('[role=tablist]').addEventListener('keydown', (e) => {
      const all = Object.values(tabs), i = all.indexOf(document.activeElement);
      if (i < 0 || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const tab = all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowLeft' ? all.length - 1 : 1)) % all.length];
      tab.click(); tab.focus();
    });
    root.querySelector('[role=toolbar]').addEventListener('keydown', (e) => {
      const all = [...root.querySelectorAll('.gp-tool button:not(:disabled)')], i = all.indexOf(document.activeElement);
      if (i < 0 || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowLeft' ? all.length - 1 : 1)) % all.length].focus();
    });

    // Print a clipped copy of the measured flow on each physical Letter page, at full size.
    let printCopy = null;
    addEventListener('beforeprint', () => {
      printCopy?.remove();
      printCopy = h('div', { class: 'gp-print' });
      const geo = ST.geometry(format), stride = geo.height + GAP;
      [...sheets.children].forEach((sheet, i) => {
        const page = sheet.cloneNode(true), clip = h('div', { class: 'gp-print-body' }), copy = flow.cloneNode(true);
        clip.style.cssText = `position:absolute;top:${geo.top}px;left:0;width:${geo.width}px;height:${geo.body}px;overflow:hidden`;
        copy.style.top = `${-i * stride}px`;
        copy.querySelector('.ProseMirror').removeAttribute('contenteditable');
        clip.append(copy); page.append(clip); printCopy.append(page);
      });
      document.body.append(printCopy);
    });
    addEventListener('afterprint', () => { printCopy?.remove(); printCopy = null; });

    // A footnote's text, in a small editor by its mark. A new note left empty goes again.
    const editNote = (pos, fresh = false) => {
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== 'footnote_ref') return;
      const plain = S.parse(S.paper, `<p>${node.attrs.content}</p>`).textContent;
      const area = h('textarea', { 'aria-label': t('Footnote'), maxlength: '4000' });
      area.value = plain;
      const el = h('div', { class: 'gp-menu gp-note', role: 'dialog', 'aria-label': t('Footnote') }, area);
      const done = (keep) => {
        if (!el.isConnected) return;
        close();
        const now = view.state.doc.nodeAt(pos);
        if (now?.type.name !== 'footnote_ref') return;
        const text = area.value.replace(/\s+/g, ' ').trim();
        if (keep && text !== plain) view.dispatch(text ? view.state.tr.setNodeMarkup(pos, null, { content: S.inline(text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])) }) : view.state.tr.delete(pos, pos + 1));
        else if (!keep && fresh && !plain) view.dispatch(view.state.tr.delete(pos, pos + 1));
        view.focus();
      };
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      area.addEventListener('blur', () => setTimeout(() => done(true), 0));
      const anchor = view.nodeDOM(pos) || view.dom;
      popup(anchor.nodeType === 1 ? anchor : view.dom, el);
    };

    // ---- versions, import and export
    const REASONS = { conflict: 'Another editor’s draft', submit: 'Submitted', import: 'Before import', restore: 'Before restore', format: 'Before format change', edit: 'Before a big edit', auto: 'Autosave', start: 'First draft' };
    versionsB.addEventListener('click', async () => {
      if (open?.opener === versionsB) { close(); return; }
      const list = key ? await store.versions(key) : [];
      const when = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const el = h('div', { class: 'gp-menu gp-versions', role: 'menu' },
        ...list.slice(0, 40).map((v) => h('div', { class: 'gp-mi' }, h('span', {}, when.format(v.at), ' ', h('small', { text: `${t(REASONS[v.reason] || 'Autosave')} · ${t('{n} words', { n: nf(v.words) })}` })),
          btn({ role: 'menuitem', onclick: async () => { close(); if (!await save()) return; const r = await store.restore(key, v.id); if (r) { paper = r.paper; await setFormat(ST.get(paper.format), { save: false }); setDoc(paper.doc); toast(t('Version restored')); } } }, t('Restore')))),
        list.length ? h('div', { class: 'gp-hr' }) : null,
        btn({ role: 'menuitem', onclick: () => { close(); exportFile(); } }, t('Export .docx')),
        btn({ role: 'menuitem', onclick: () => { close(); file.click(); } }, t('Import .docx…')),
        host.standalone ? null : btn({ role: 'menuitem', onclick: () => { close(); open2('papers.html'); } }, t('All papers')));
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
      popup(versionsB, el, { above: true });
    });
    const open2 = (page2) => { try { window.open(chrome.runtime.getURL(page2), '_blank', 'noopener'); } catch { /* no extension context */ } };
    const docx = async () => { await need(DOCX); return GZ_WRITER_DOCX.exportDocx(view.state.doc, { format, surname: surname(), title: ctx.assignment?.title || paper?.title || '' }); };
    const fileName = () => {
      const base = [surname(), (ctx.assignment?.title || paper?.title || t('Paper'))].filter(Boolean).join(' ').replace(/\s+/g, '_');
      return (globalThis.GZ_ZIP?.safeName || ((x) => x))(`${base}.docx`);
    };
    const exportFile = async () => {
      try {
        const out = await docx(), url = URL.createObjectURL(new Blob([out.bytes], { type: out.type }));
        const a = h('a', { href: url, download: fileName() });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (e) { console.error(e); toast(t('The .docx could not be made.')); }
    };
    const importFile = async (f) => {
      if (!f) return;
      try {
        await need(DOCX);
        const r = await GZ_WRITER_DOCX.importDocx(new Uint8Array(await f.arrayBuffer()), { format });
        const doc = S.parse(S.paper, r.html);
        if (key) {
          if (!await save()) throw new Error('paper could not be saved before import');
          const saved = await store.save(key, { ...record(), doc: doc.toJSON() }, { reason: 'import' });
          paper = saved.paper;
        }
        setDoc(doc.toJSON());
        toast(r.warnings.length ? r.warnings.map((w) => t(w)).join(' ') : t('Imported. The last version is in Versions.'));
      } catch (e) { console.error(e); toast(e instanceof RangeError && e.message ? t(e.message) : t('That file could not be read as a Word document.')); }
    };
    file.addEventListener('change', () => { importFile(file.files[0]); file.value = ''; });
    canvas.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); canvas.classList.add('gp-drop'); } });
    canvas.addEventListener('dragleave', () => canvas.classList.remove('gp-drop'));
    canvas.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => /\.docx$/i.test(x.name));
      canvas.classList.remove('gp-drop');
      if (!f) return;
      e.preventDefault(); e.stopPropagation();
      importFile(f);
    }, true);

    // ---- what the page says: Ultra's names and the paper's key
    const head = () => {
      const tt = ctx.assignment?.title || paper?.title || '';
      title.textContent = tt || t('Paper');
      const d = ctx.assignment?.due || paper?.due;
      due.textContent = d && Number.isFinite(Date.parse(d)) ? t('Due {when}', { when: new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d)) }) : '';
    };
    let loading = null, recovered = false;
    const load = () => (loading ||= (async () => {
      key = host.key || PA.keyOf(ctx.paper || {}) || recoveryKey;
      paper = await store.get(key);
      recovered = key === recoveryKey && !!paper?.doc;
      let pending = null;
      try { const p = JSON.parse(sessionStorage.getItem(recoverySlot)); if (p?.key === key && p.record?.doc) pending = p.record; } catch {}
      if (pending) paper = { ...paper, ...pending };
      if (paper?.doc) {
        format = ST.get(paper.format);
        setDoc(paper.doc, true);
      } else {
        format = ST.get(paper?.format || 'mla9');
        // A new paper: the format's opening and list page around what Ultra's box already held.
        setDoc(F.template(format, values(), initialBody), true);
        if (key) await save('auto');
      }
      initializing = false;
      if (pending) { dirty = true; await save(); }
      const scope = PA.scopeOf(ctx.paper || paper || {});
      presets = scope ? await store.presets(scope) : [];
      restyleCSS();
      head();
      counts();
      setZoom(zoom);
      PG.relayout(view);
      runChecks();
      outlineDraw();
      if (!dirty) setState('Saved');
    })());
    host.onContext?.((c) => {
      ctx = c && typeof c === 'object' ? c : {};
      head();
      const target = host.key || PA.keyOf(ctx.paper || {});
      if (target && key === recoveryKey) (async () => {
        await loading;
        if (key !== recoveryKey || !await save()) return;
        const existing = await store.get(target);
        key = target;
        if (!edits && !recovered) {
          paper = existing;
          format = ST.get(paper?.format || 'mla9');
          initializing = true;
          setDoc(paper?.doc || F.template(format, values(), initialBody), true);
          initializing = false;
          restyleCSS(); counts(); PG.relayout(view); runChecks();
        }
        if (await save('import')) await store.remove(recoveryKey);
      })().catch((e) => { console.error(e); setState('Not saved'); });
    });
    restyleCSS();
    counts();
    head();
    setState('');
    const api = {
      editor: ed, key: () => key, format: () => format, paper: () => paper, context: () => ctx,
      docx, save, version: (reason = 'submit') => save(reason), focus: setFocus, refresh: hooks, zoom: setZoom,
      // The page ended Focus (a click on its dim).
      focused: (on) => { focus = on; focusB.setAttribute('aria-pressed', String(on)); },
      pages: () => layout?.pages.length || 0,
    };
    await load();
    view.setProps({ editable: editable || (() => true) });

    current = api;
    hooks();
    return api;
  };

  const self = { mount, need, current: () => current, submit: null };
  // In writer.html: an assignment's frame opens a paper when its editor is ready.
  const frame = globalThis.GZ_WRITER_FRAME;
  if (frame) {
    const listeners = [];
    frame.on('context', (c) => { for (const fn of listeners) fn(c); });
    frame.handle('focus-mode', (m) => current?.focused(m.on === true));
    frame.on('ready', (editor) => {
      if (frame.mode() !== 'paper') return;
      mount({ editor, t: frame.t, say: frame.say, context: frame.context, onContext: (fn) => listeners.push(fn) }).catch((e) => console.error(e));
    });
  }
  return self;
})();
