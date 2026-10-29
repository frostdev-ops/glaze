// Glaze Writer's paper mode: an assignment attempt's paper as a word processor, the whole chrome around the editor that
// writer.js makes (glaze-plans/writer/mockups C): the title bar and save state, the toolbar (format, block style, marks,
// alignment, lists, Cite, Footnote, Page break, undo and redo, zoom, Focus, Submit…), real pages of the paper's size with
// the running header and footnotes (lib/writer-paginate.js), the side panel (Checks, Sources, Feedback, Outline) and the status bar.
// The paper lives in Writer's storage (lib/writer-papers.js), autosaved with versions; it never goes into Ultra's editor:
// the submit step attaches it as a .docx (lib/writer-docx.js). The same chrome edits a paper in papers.html.
// Classic script after writer.js; the paper libraries load only when a paper opens.
var GZ_WRITER_PAPER = globalThis.GZ_WRITER_PAPER || (() => {
  const LIBS = ['lib/writer-styles.js', 'lib/writer-paginate.js', 'lib/writer-format.js', 'lib/writer-outline.js', 'lib/writer-papers.js', 'lib/writer-submit.js'];
  const DOCX = ['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js', 'lib/writer-objects-docx.js'];
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
    marker: 'm9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4', dots: 'M5 12h.01M12 12h.01M19 12h.01',
    pagenum: 'M6 3h9l4 4v14H6zM10 13h1v5M10 18h2', pages: 'M8 3h8l4 4v12H8zM4 7v14h12', left: 'M4 6h16M4 12h10M4 18h16', portrait: 'M7 3h10v18H7z', landscape: 'M3 7h18v10H3z',
    close: 'M6 6l12 12M18 6 6 18',
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
  const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
  const keyHint = (k) => (MAC ? k : k.replace('⌘', 'Ctrl+').replace('⌥', 'Alt+').replace('⇧', 'Shift+'));
  // Word's palettes: the theme colours with their tints and shades, the standard colours, and the highlighter.
  const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
  const STANDARD = ['C00000', 'FF0000', 'FFC000', 'FFFF00', '92D050', '00B050', '00B0F0', '0070C0', '002060', '7030A0'];
  const TINTS = [[-0.05, -0.15, -0.25, -0.35, -0.5], [0.5, 0.35, 0.25, 0.15, 0.05], [-0.1, -0.25, -0.5, -0.75, -0.9]];
  const shade = (hex, p) => hex.match(/../g).map((x) => { const c = parseInt(x, 16); return Math.round(p > 0 ? c + (255 - c) * p : c * (1 + p)).toString(16).padStart(2, '0'); }).join('').toUpperCase();
  const GRID = [THEME, ...[0, 1, 2, 3, 4].map((r) => THEME.map((c, i) => shade(c, (TINTS[i] || [0.8, 0.6, 0.4, -0.25, -0.5])[r])))];
  const HIGHLIGHTS = [['yellow', 'Yellow'], ['green', 'Bright green'], ['cyan', 'Turquoise'], ['magenta', 'Pink'], ['blue', 'Blue'], ['red', 'Red'], ['darkBlue', 'Dark blue'], ['darkCyan', 'Teal'],
    ['darkGreen', 'Green'], ['darkMagenta', 'Violet'], ['darkRed', 'Dark red'], ['darkYellow', 'Dark yellow'], ['darkGray', 'Gray 50%'], ['lightGray', 'Gray 25%'], ['black', 'Black']];
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

  // A paper's mount. host: { editor (GZ_WRITER_EDITOR in paper mode), t(key, vars), say(msg) (to the page), context() and
  // onContext(fn) (Ultra's names, the paper's key), standalone (papers.html: no Submit or Focus), key (papers.html's
  // paper) }. → the paper's API (also GZ_WRITER_PAPER.current()).
  let current = null;
  const mount = async (host) => {
    const editable = host.editor.view.props.editable;
    host.editor.view.setProps({ editable: () => false });
    await need(LIBS);
    // Settings → Writer (storage.sync writer): the format a new paper starts in and the zoom papers open at.
    // lib/writer-settings.js's reader where the page loads it (writer.html), else storage as it is (papers.html).
    const SET = globalThis.GZ_WRITER_SETTINGS;
    const prefs = await Promise.race([SET ? SET.load().then(() => SET.now() || {}) : Promise.resolve().then(() => chrome.storage.sync.get('writer')).then((r) => (r?.writer && typeof r.writer === 'object' ? r.writer : {})), new Promise((ok) => setTimeout(() => ok({}), 400))]).catch(() => ({}));
    // Settings → Writer → Light page: a dark Look's pages stay white (writer-paper.css).
    const lightPage = (on) => document.documentElement.toggleAttribute('data-light-page', !!on);
    lightPage(prefs.lightPage);
    SET?.follow((w) => lightPage(w?.lightPage));
    const ST = GZ_WRITER_STYLES, F = GZ_WRITER_FORMAT, PG = GZ_WRITER_PAGINATE, PA = GZ_WRITER_PAPERS, S = GZ_WRITER_SCHEMA, PM = GZ_PM;
    const ed = host.editor, view = ed.view, t = (k, v) => { const text = host.t(k, v); return k === 'Document outline' && text === k ? 'Outline' : text; }, store = PA.open();
    const ISSUES = () => globalThis.GZ_WRITER_ISSUES || null;
    // What the pages are laid out by: the format, with an imported file's own page, base font and header over it.
    const look = (doc = view.state.doc) => ST.look(format, doc.attrs.setup);
    let format = ST.FORMATS.mla9, key = null, paper = null, ctx = host.context?.() || {}, presets = [], zoom = [75, 100, 125, 150].includes(prefs.zoom) ? prefs.zoom / 100 : 'fit', scale = PX100, layout = null, page = 1, focus = false;
    let laidOut = () => {}, rows = [], feedbackPanel = null, sourcesPanel = null; // the checks, Outline and Feedback's pages after layout
    const nf = (n) => new Intl.NumberFormat(document.documentElement.lang || undefined).format(n);
    // A format's name: the three's and presets' as they are, Blank's in the page's language.
    const labelOf = (f) => (f === ST.FORMATS.plain ? t('Blank') : f.label);

    // ---- the chrome
    // A standalone document's title is the student's to type (until then its derived name shows); an assignment's is
    // Ultra's.
    const own = host.standalone === true && PA.local(host.key);
    const titleIn = own ? h('input', { class: 'gp-title-in', type: 'text', maxlength: '120', autocomplete: 'off', 'aria-label': t('Title'), placeholder: t('Untitled document'), readonly: true }) : null;
    const title = h('h1', {}, titleIn), due = h('span', { class: 'gp-due' }), state = h('span', { class: 'gp-state', role: 'status' });
    const pill = btn({ class: 'gp-pill', 'aria-haspopup': 'menu' }), block = btn({ class: 'gp-box', 'aria-haspopup': 'menu' });
    const mark = (run, label, kid) => btn({ 'data-run': run, title: t(label), 'aria-label': t(label), 'aria-pressed': 'false' }, kid);
    const marks = [mark('bold', 'Bold', 'B'), mark('italic', 'Italic', h('i', { text: 'I' })), mark('underline', 'Underline', h('u', { text: 'U' }))];
    // Font, size, more formatting, text colour and highlight (Word's), the Paragraph dialog and ⋯ (page setup, header and
    // footer, the ruler).
    const caretIco = () => icon('caret', 'gp-ico gp-caret');
    const fontB = btn({ class: 'gp-box gp-font', 'aria-haspopup': 'menu', title: t('Font'), 'aria-label': t('Font') });
    const sizeIn = h('input', { class: 'gp-size-in', type: 'text', inputmode: 'decimal', maxlength: '4', spellcheck: 'false', autocomplete: 'off', title: t('Font size'), 'aria-label': t('Font size') });
    const sizeB = btn({ class: 'gp-size-b', 'aria-haspopup': 'menu', title: t('Font size'), 'aria-label': t('Font size') }, caretIco());
    const sizeBox = h('span', { class: 'gp-box gp-sizebox' }, sizeIn, sizeB);
    const moreFmt = btn({ class: 'gp-wide', 'aria-haspopup': 'menu', title: t('More formatting'), 'aria-label': t('More formatting') }, h('span', { class: 'gp-aa', text: 'Aa' }), caretIco());
    const colorBar = h('i', { class: 'gp-bar' }), hlBar = h('i', { class: 'gp-bar' });
    const colorB = btn({ class: 'gp-wide', 'aria-haspopup': 'menu', title: t('Text colour'), 'aria-label': t('Text colour') }, h('span', { class: 'gp-swatch' }, h('span', { class: 'gp-a', text: 'A' }), colorBar), caretIco());
    const hlB = btn({ class: 'gp-wide', 'aria-haspopup': 'menu', title: t('Highlight'), 'aria-label': t('Highlight') }, h('span', { class: 'gp-swatch' }, icon('marker'), hlBar), caretIco());
    const paraB = btn({ class: 'gp-pilcrow', 'aria-haspopup': 'dialog', title: t('Paragraph…'), 'aria-label': t('Paragraph…') }, '¶');
    const moreB = btn({ class: 'gp-tbtn gp-more', 'aria-haspopup': 'menu', title: t('More'), 'aria-label': t('More') }, icon('dots'));
    const alignB = btn({ title: t('Alignment'), 'aria-label': t('Alignment'), 'aria-haspopup': 'menu' }, icon('align'));
    const bullets = btn({ 'data-run': 'bulletList', title: t('Bulleted list'), 'aria-label': t('Bulleted list'), 'aria-pressed': 'false' }, icon('bullets'));
    const numbers = btn({ 'data-run': 'orderedList', title: t('Numbered list'), 'aria-label': t('Numbered list'), 'aria-pressed': 'false' }, icon('numbers'));
    const cite = btn({ class: 'gp-tbtn', disabled: true }, icon('cite'), t('Cite'));
    // Labels the toolbar hides when it's narrow (writer-paper.css container query); their names stay for screen readers.
    const note = btn({ class: 'gp-tbtn', title: t('Footnote'), 'aria-label': t('Footnote') }, icon('note'), h('span', { class: 'gp-lbl', text: t('Footnote') }));
    const brk = btn({ class: 'gp-tbtn', title: t('Page break'), 'aria-label': t('Page break') }, icon('brk'), h('span', { class: 'gp-lbl', text: t('Page break') }));
    const undo = btn({ title: t('Undo'), 'aria-label': t('Undo') }, icon('undo')), redo = btn({ title: t('Redo'), 'aria-label': t('Redo') }, icon('redo'));
    const zoomB = btn({ class: 'gp-box', 'aria-haspopup': 'menu', title: t('Zoom') });
    const focusB = btn({ class: 'gp-tbtn', title: t('Focus'), 'aria-label': t('Focus'), 'aria-pressed': 'false' }, icon('focus'));
    // Submit… stays off until the submit step sets GZ_WRITER_PAPER.submit (TODO 3K: the submit sheet and Ultra's upload).
    const submit = btn({ class: 'gp-submit', disabled: true }, t('Submit…'));
    const sheets = h('div'), flow = h('div', { class: 'gp-flow' }), measureBox = h('div', { class: 'gp-notes gp-measure', 'aria-hidden': 'true' });
    const zoomEl = h('div', { class: 'gp-zoom' }, sheets, flow, measureBox), size = h('div', { class: 'gp-size' }, zoomEl);
    const canvas = h('div', { class: 'gp-canvas' }, size);
    const pageL = h('span'), wordsL = btn({}), fontL = h('span'), versionsB = btn({ 'aria-haspopup': 'menu' }, t('Versions'));
    const toolGrow = h('span', { class: 'grow' });
    // The status bar's word count opens the counts (writer-counts.js, where loaded).
    wordsL.addEventListener('click', () => globalThis.GZ_WRITER_COUNTS?.open(wordsL));
    const status = h('div', { class: 'gp-status' }, pageL, wordsL, h('span', { class: 'grow' }), fontL, versionsB);
    const tabs = {}, panes = {}, badges = {};
    for (const [id, label] of [['checks', 'Checks'], ['sources', 'Sources'], ['feedback', 'Feedback'], ['outline', 'Document outline']]) {
      badges[id] = h('span', { class: 'gp-badge' });
      tabs[id] = btn({ class: 'gp-tab', role: 'tab', 'aria-selected': String(id === 'checks'), tabindex: id === 'checks' ? '0' : '-1', 'aria-controls': `gp-${id}`, id: `gp-tab-${id}` }, t(label), badges[id]);
      panes[id] = h('div', { class: 'gp-pane', role: 'tabpanel', id: `gp-${id}`, 'aria-labelledby': `gp-tab-${id}`, hidden: id !== 'checks' });
    }
    const issuesEl = h('div', { class: 'gp-issues' }), checklist = h('div', { class: 'gp-list' }), outline = h('div', { class: 'gp-outline' });
    panes.checks.append(issuesEl, checklist);
    const outlineToggle = h('input', { type: 'checkbox', 'aria-label': t('AI outline') });
    const outlineBusy = h('span', { class: 'gp-ol-busy', text: t('Reading your draft…'), hidden: true, role: 'status' });
    const outlineRetry = btn({ class: 'gp-sbtn gp-ghost', hidden: true, title: t('AI isn’t available right now.') }, t('Try again'));
    const outlineError = h('p', { class: 'gz-fb-note', hidden: true, role: 'status' });
    const outlineOptions = h('div', { class: 'gp-ol-options', hidden: true }, h('label', {}, t('AI outline'), outlineToggle), outlineBusy, outlineRetry);
    panes.outline.append(outlineOptions, outlineError, outline);
    const side = h('aside', { class: 'gp-side' }, h('div', { class: 'gp-tabs', role: 'tablist' }, Object.values(tabs)), Object.values(panes));
    // On an assignment any file can be brought (writer-import.js routes it); papers.html opens Word files only.
    const file = h('input', { type: 'file', accept: host.standalone ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' : null, hidden: true });
    const root = h('div', { class: `gp${host.standalone ? ' gp-standalone' : ''}` },
      h('header', { class: 'gp-top' }, host.standalone ? h('a', { href: 'papers.html', text: t('Documents') }) : null, title, due, h('span', { class: 'grow' }), state),
      h('div', { class: 'gp-tool', role: 'toolbar', 'aria-label': t('Formatting') }, pill, block, fontB, sizeBox,
        h('div', { class: 'gp-tb' }, marks, moreFmt, colorB, hlB, h('span', { class: 'gp-sepv' }), alignB, paraB, bullets, numbers, h('span', { class: 'gp-sepv' })),
        cite, note, brk, toolGrow, h('div', { class: 'gp-tb' }, undo, redo), zoomB, moreB, host.standalone ? null : focusB, host.standalone ? null : submit),
      h('div', { class: 'gp-work' }, h('div', { class: 'gp-col' }, canvas, status), side), file);
    (host.root || document.body).append(root);
    flow.style.visibility = 'hidden';
    flow.append(view.dom);

    // The caret, drawn: Safari's runs from the text above to this line's (a whole line tall on double spacing), so the paper
    // hides it and draws one the text's height where ProseMirror puts the cursor. While an input method composes, the
    // browser's own is back (.gp-flow[data-composing]).
    const caret = h('div', { class: 'gp-cursor', 'aria-hidden': 'true', hidden: true });
    size.append(caret);
    let caretFrame = 0;
    const placeCaret = () => {
      caretFrame = 0;
      const sel = view.state.selection;
      let r = null;
      if (sel instanceof PM.state.TextSelection && sel.empty && view.hasFocus() && document.hasFocus() && !view.composing && !flow.hasAttribute('data-composing')) {
        try { r = view.coordsAtPos(sel.head, 1); } catch { r = null; }
      }
      if (!r || !(r.bottom > r.top)) { caret.hidden = true; return; }
      const box = size.getBoundingClientRect();
      caret.style.transform = `translate(${r.left - box.left}px, ${r.top - box.top}px)`;
      caret.style.height = `${r.bottom - r.top}px`;
      caret.hidden = false;
      for (const a of caret.getAnimations?.() || []) a.currentTime = 0; // solid while it moves, as the system's
    };
    const caretSoon = () => { caretFrame ||= requestAnimationFrame(placeCaret); };
    for (const [target, type] of [[view.dom, 'focus'], [view.dom, 'blur'], [window, 'focus'], [window, 'blur']]) target.addEventListener(type, caretSoon);
    view.dom.addEventListener('compositionstart', () => { flow.setAttribute('data-composing', ''); placeCaret(); });
    view.dom.addEventListener('compositionend', () => { flow.removeAttribute('data-composing'); caretSoon(); });
    document.fonts?.addEventListener?.('loadingdone', caretSoon);

    // The format's page CSS, in an adopted sheet (the frame's CSP allows no <style>).
    const sheet = typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype ? new CSSStyleSheet() : null;
    if (sheet) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const restyleCSS = () => {
      globalThis.GZ_WRITER_CITE?.use?.(format.cite);
      const css = ST.css(look());
      if (sheet) { sheet.replaceSync(css); return; }
      const own = [...document.styleSheets].find((s) => /writer-paper\.css$/.test(s.href || ''));
      if (!own) return;
      own.gzRules ||= [];
      for (const i of own.gzRules.reverse()) own.deleteRule(i);
      own.gzRules = css.split('\n').map((r) => own.insertRule(r, own.cssRules.length));
    };

    // ---- menus and popovers (writer.css .pop: they scale in and fade; they go at once)
    let open = null;
    const close = (back) => { if (!open) return; const o = open; open = null; o.onClose?.(); o.el.remove(); o.opener?.setAttribute('aria-expanded', 'false'); if (back) o.opener?.focus(); };
    const popup = (opener, el, { above = false, onClose = null } = {}) => {
      close();
      el.classList.add('pop');
      document.body.append(el);
      // A control folded into ⋯ (the toolbar is narrow) opens its popover from ⋯.
      const r = (opener.getClientRects().length ? opener : moreB).getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
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
      open = { el, opener, onClose };
      el.querySelector('button, input, select, textarea')?.focus();
    };
    const menu = (opener, items, o) => {
      const el = h('div', { class: 'gp-menu', role: 'menu' });
      for (const it of items) {
        if (it === '-') { el.append(h('div', { class: 'gp-hr', role: 'separator' })); continue; }
        el.append(btn({ role: it.checked == null ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked == null ? null : String(!!it.checked), onclick: () => { close(); it.run(); } }, it.label, it.hint ? h('small', { text: it.hint }) : null));
      }
      popup(opener, el, o);
    };
    document.addEventListener('pointerdown', (e) => { if (open && !open.el.contains(e.target) && !open.opener?.contains(e.target)) close(); }, true);
    let toastTimer = 0;
    // act: { label, run }, a button after the text (an import's Undo).
    // choices: { ask, items: [{ label, run }], gone() } instead of plain text: a question with its answers (the first the
    // default, which gone() keeps when the toast goes unanswered).
    const toast = (text, act = null, choices = null) => {
      document.querySelector('.gp-toast')?.remove();
      let answered = false;
      const answer = (run) => () => { answered = true; el.remove(); run(); };
      const el = h('div', { class: `pop gp-toast${choices ? ' gp-toast-ask' : ''}`, role: 'status' }, h('span', { text }), act ? btn({ class: 'gp-toast-do', onclick: () => { el.remove(); act.run(); } }, act.label) : null,
        choices ? h('div', { class: 'gp-toast-choices' }, choices.ask ? h('b', { text: choices.ask }) : null, ...choices.items.map((c, i) => btn({ class: `gp-toast-choice${i ? '' : ' gp-default'}`, onclick: answer(c.run) }, c.label))) : null);
      if (choices) setTimeout(() => { if (!answered) choices.gone?.(); }, 15000);
      document.body.append(el);
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.remove(), choices ? 15000 : act ? 10000 : 6000);
    };

    // ---- the editor's extra plugins: page styling and pagination, change watching, note clicks, fallback underlines
    const noteCache = new Map();
    const noteBody = (content, n) => {
      const d = S.parse(S.paper, `<div>${content}</div>`), p = h('p', {}, h('sup', { text: String(n) }), ' ');
      let first = true;
      d.descendants((x) => {
        if (!x.isTextblock) return true;
        const part = first ? p : h('span', { class: 'gp-note-paragraph' });
        if (!first) { part.style.display = 'block'; part.style.marginTop = `${format.notes.after}pt`; p.append(part); }
        part.append(PM.model.DOMSerializer.fromSchema(S.paper).serializeFragment(x.content));
        if (!x.content.size || x.lastChild?.type.name === 'hard_break') part.append(h('br'));
        first = false;
        return false;
      });
      return p;
    };
    const noteHeights = (contents) => contents.map((c, i) => {
      const k = `${format.id}|${i}|${c}`;
      if (!noteCache.has(k)) { measureBox.replaceChildren(noteBody(c, i + 1)); noteCache.set(k, measureBox.firstChild.offsetHeight); }
      return noteCache.get(k);
    });
    const issuesKey = new PM.state.PluginKey('gz-paper-issues');
    let formatIssues = [], ignored = new Set(), picked = null; // picked: the rule whose card is chosen
    const fallback = new PM.state.Plugin({
      key: issuesKey,
      state: { init: () => PM.view.DecorationSet.empty, apply: (tr, set) => (tr.getMeta(issuesKey) || set.map(tr.mapping, tr.doc)) },
      props: { decorations: (s) => issuesKey.getState(s) },
    });
    const watch = new PM.state.Plugin({
      view: () => ({ update: (v, prev) => {
        if (v.state.doc.attrs.setup !== prev.doc.attrs.setup) { restyleCSS(); noteCache.clear(); PG.relayout(v); }
        if (v.state.doc !== prev.doc) changed(); else if (!v.state.selection.eq(prev.selection)) selected();
        caretSoon();
      } }),
      props: {
        handleClickOn: (_v, _pos, node, nodePos) => { if (node.type.name === 'footnote_ref') { editNote(nodePos); return true; } return false; },
        handleKeyDown: (_v, e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return true; }
          // Word's ⌘⇧> and ⌘⇧< step the size from the paper's own; ⌘Enter is a page break here (writer.js's send is compose's).
          if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && ['>', '<', '.', ','].includes(e.key)) { ed.run('sizeStep', { dir: e.key === '>' || e.key === '.' ? 1 : -1, base: look().size }); return true; }
          if ((MAC ? e.metaKey : e.ctrlKey) && e.key === 'Enter' && !e.shiftKey && !e.altKey) { ed.run('pageBreak'); return true; }
          // Ahead of ProseMirror's own Escape (select the parent node).
          if (e.key === 'Escape' && focus) { if (!globalThis.GZ_WRITER_AI?.dismissCompletion?.()) setFocus(false); return true; }
          return false;
        },
      },
    });
    ed.addPlugins([PG.styler(look), PG.plugin({ format: look, notes: noteHeights, gap: GAP, onLayout: (l) => { layout = l; draw(); laidOut(); } }), watch, fallback]);

    // ---- pages
    const surname = () => F.surname(view.state.doc, format);
    // An imported header's or footer's paragraphs, their tab stops laid out as Word does (a left stop's text starts at it,
    // a centre one's centres on it, a right one's ends at it).
    const partEl = (parts, el, L) => {
      el.replaceChildren(...parts.map((x) => {
        const p = h('div', { class: 'gp-part' });
        p.style.cssText = `text-align:${x.align || 'left'};line-height:${ST.lineHeight(L, { line: x.line, exact: x.exact, least: x.least })}px;margin:${x.before || 0}pt 0 ${x.after || 0}pt;padding:0 ${x.right || 0}in 0 ${x.left || 0}in;text-indent:${x.first || 0}in`;
        let seg = h('span');
        const segs = [seg];
        for (const r of x.runs) {
          for (const [i, piece] of r.text.split('	').entries()) {
            if (i) { seg = h('span'); segs.push(seg); }
            if (!piece) continue;
            const run = h('span', { text: piece });
            run.style.cssText = [r.b ? 'font-weight:700' : '', r.i ? 'font-style:italic' : '', r.u || r.s ? `text-decoration:${[r.u ? 'underline' : '', r.s ? 'line-through' : ''].join(' ')}` : '', r.sup ? 'vertical-align:super;font-size:.66em' : r.sub ? 'vertical-align:sub;font-size:.66em' : '', r.font ? `font-family:${ST.stack(r.font)}` : '', r.size ? `font-size:${r.size}pt` : '', r.color ? `color:#${r.color};--c:#${r.color}` : ''].filter(Boolean).join(';');
            seg.append(run);
          }
        }
        p.append(...segs);
        p.gzTabs = segs.length > 1 ? (x.tabs || []) : null;
        return p;
      }));
      for (const p of el.children) {
        if (!p.gzTabs) continue;
        const width = p.clientWidth, tab = (L.tab || 0.5) * 96, segs = [...p.children];
        let x = segs[0].getBoundingClientRect().width / scale;
        p.style.position = 'relative';
        p.style.textAlign = 'left';
        for (const seg of segs.slice(1)) {
          const w = seg.getBoundingClientRect().width / scale, stop = p.gzTabs.map(([pos, kind, leader]) => [pos * 96, kind, leader]).find(([pos]) => pos > x + 0.5) || [Math.floor(x / tab + 1) * tab, 'l'];
          const left = Math.max(x, stop[1] === 'c' ? stop[0] - w / 2 : stop[1] === 'r' || stop[1] === 'd' ? stop[0] - w : stop[0]);
          const edge = Math.max(x, Math.min(left, width - w));
          if (stop[2] && edge > x) {
            const leader = h('span', { class: `gp-tabstop-${stop[2]}`, 'aria-hidden': 'true' });
            leader.style.cssText = `position:absolute;left:${x}px;width:${edge - x}px;height:1em`;
            p.append(leader);
          }
          seg.style.cssText = `position:absolute;left:${edge}px`;
          x = left + w;
        }
      }
    };
    const draw = () => {
      if (!layout) return;
      const L = look(), geo = ST.geometry(L), stride = geo.height + GAP, n = layout.pages.length;
      zoomEl.style.width = `${geo.width}px`;
      zoomEl.style.height = `${n * stride - GAP}px`;
      zoomEl.style.transform = `scale(${scale})`;
      size.style.width = `${geo.width * scale}px`;
      size.style.height = `${(n * stride - GAP) * scale}px`;
      while (sheets.children.length > n) sheets.lastChild.remove();
      while (sheets.children.length < n) sheets.append(h('div', { class: 'gp-sheet' }, h('div', { class: 'gp-hdr' }), h('div', { class: 'gp-ftr' }), h('div', { class: 'gp-notes' })));
      const name = surname(), sep = ST.lineHeight(L, { line: 1 });
      layout.pages.forEach((pg, i) => {
        const s = sheets.children[i], [hdr, ftr] = s.children;
        s.style.top = `${i * stride}px`;
        // The header: an imported file's or the student's own parts, else the format's running header; the footer: the
        // setup's parts, else none.
        const parts = ST.headerParts(L, i + 1, n), footer = L.setup ? ST.footerParts(L, i + 1, n) : [], k = JSON.stringify([parts, footer, L.font, L.size, scale]);
        if (!parts) { const text = ST.headerText(L, i + 1, name); if (s.gzHeader !== text) { hdr.replaceChildren(); hdr.textContent = text; s.gzHeader = text; } }
        else if (s.gzHeader != null) { s.gzHeader = null; s.gzParts = null; }
        if (s.gzParts !== k) { s.gzParts = k; if (parts) partEl(parts, hdr, L); partEl(footer, ftr, L); }
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
      caretSoon();
      for (const fn of drawn) try { fn(); } catch (e) { console.error(e); }
    };
    const drawn = [];
    const fit = () => {
      const w = canvas.clientWidth - 48;
      return Math.max(0.3, Math.min(PX100, w / ST.geometry(look()).width));
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
    // The page a position is on, from where it is drawn (0 before the pages are laid out).
    const pageAt = (pos) => {
      if (!layout) return 0;
      try {
        const top = view.dom.getBoundingClientRect().top, y = (view.coordsAtPos(pos).top - top) / scale;
        return Math.min(layout.pages.length, Math.max(1, Math.floor(y / (ST.geometry(look()).height + GAP)) + 1));
      } catch { return 0; }
    };
    const selected = () => {
      if (!layout) return;
      page = pageAt(view.state.selection.head) || page;
      outlineMark();
      pageL.textContent = t('Page {n} of {m}', { n: page, m: layout.pages.length });
      const a = ed.active();
      for (const b of marks) b.setAttribute('aria-pressed', String(!!a[b.dataset.run]));
      bullets.setAttribute('aria-pressed', String(a.list === 'bullet'));
      numbers.setAttribute('aria-pressed', String(a.list === 'ordered'));
      block.replaceChildren(blockName(a), icon('caret', 'gp-ico gp-caret'));
      const L = look(), fname = a.font || L.font, fsize = nf(a.size || L.size);
      if (fontB.textContent !== fname) { fontB.replaceChildren(h('span', { class: 'gp-font-name', text: fname }), caretIco()); fontB.style.fontFamily = `"${fname}"`; }
      if (document.activeElement !== sizeIn && sizeIn.value !== fsize) sizeIn.value = fsize;
      moreFmt.setAttribute('aria-pressed', String(!!(a.strike || a.sup || a.sub || a.smallCaps || a.allCaps)));
    };
    const blockName = (a) => (a.heading ? t('Heading {n}', { n: a.heading }) : a.quote ? t('Block quote') : a.align === 'center' ? t('Title') : t('Body'));
    const counts = () => {
      wordsL.textContent = t('{n} words', { n: nf(ed.words()) });
      fontL.textContent = `${look().font} ${look().size} · ${t(SPACING[format.line] || String(format.line))}`;
      pill.replaceChildren(labelOf(format), icon('caret', 'gp-ico gp-caret'));
    };
    // The title, authored or inferred sections, and references, each linked to its paragraph and rendered page.
    function outlineMark() {
      const at = view.state.selection.head;
      let cur = null;
      for (const r of rows) if (r.pos <= at) cur = r;
      for (const r of rows) { r.el.classList.toggle('cur', r === cur); if (r === cur) r.el.setAttribute('aria-current', 'true'); else r.el.removeAttribute('aria-current'); }
    }
    const outlineAI = GZ_WRITER_OUTLINE.create({
      generate: (blocks, opts) => globalThis.GZ_WRITER_AI?.outline?.({ blocks, cached: opts.cached, language: document.documentElement.lang || 'en' }, opts),
      persist: (value) => {
        if (key !== value.scope || outlineScope() !== value.scope) return;
        outlineSaved = value;
        dirty = true; emergency();
        return save();
      },
      changed: () => outlineDraw(),
    });
    let outlineHidden = false;
    const outlineDraw = () => {
      const ai = globalThis.GZ_WRITER_AI, info = ai?.outlineInfo?.() || {}, source = F.outlineSource(view.state.doc, format);
      const blocks = source.blocks.map(({ pos, ...block }) => block);
      const language = document.documentElement.lang || 'en';
      const snapshot = { key: JSON.stringify([info.generation, language, blocks]), blocks, language, scope: outlineScope(), identity: info.identity, saved: outlineSaved };
      const generated = outlineAI.update(snapshot, { enabled: info.enabled === true, active: !outlineHidden && !panes.outline.hidden });
      outlineOptions.hidden = !info.available;
      outlineToggle.checked = info.enabled === true;
      outlineBusy.hidden = !generated.running;
      outlineRetry.hidden = !generated.error;
      outlineError.hidden = !generated.error;
      outlineError.textContent = t(globalThis.GZ_AI_FAILURE?.explain(generated.detail) || 'AI could not read the outline. The local outline is shown.');
      outline.setAttribute('aria-busy', String(generated.running));
      let items = F.outline(view.state.doc, format, { paragraphs: true });
      if (generated.result || generated.cached?.length) {
        const byId = new Map(source.blocks.map((b) => [b.id, b]));
        const labels = new Map((generated.result || generated.cached).map((s) => [s.start, s]));
        const sections = GZ_WRITER_OUTLINE.plan(blocks).map((s, i) => {
          const first = s.blocks[0], block = byId.get(first.id), label = labels.get(first.id);
          if (!block) return null;
          const preview = block.text.replace(/\s+/gu, ' ').trim();
          return { kind: 'section', text: label?.heading || s.heading || 'Paragraph {n}', role: label?.role, authored: block.kind === 'heading',
            inferred: !label && !s.heading, number: i + 1, level: s.level, pos: block.pos,
            preview: preview.length > 160 ? preview.slice(0, 160).replace(/\s+\S*$/u, '') + '…' : preview };
        });
        if (sections.every(Boolean)) items = [...source.fixed, ...sections].sort((a, b) => a.pos - b.pos);
      }
      if (!items.length) { rows = []; outline.replaceChildren(h('div', { class: 'gp-empty' }, icon('bullets', 'gp-empty-ico'), t('No text yet.'))); return; }
      rows = items.map(({ kind, level, text, pos, preview, number, inferred, role, authored }) => {
        const category = role === 'introduction' ? t('Introduction') : role === 'body' ? t('Body') : role === 'conclusion' ? t('Conclusion') : role === 'custom' ? t('Custom') : '';
        const label = inferred ? t(text, { n: number == null ? '' : nf(number) }) : category && !authored ? `${category}: ${text}` : text;
        const copy = preview ? h('span', { class: 'gp-ol-copy' }, h('span', { class: 'gp-ol-label', text: label }), h('span', { class: 'gp-ol-preview', text: preview })) : h('span', {}, label);
        const n = pageAt(pos + 1), el = btn({ class: `gp-ol-row${level > 1 ? ' gp-ol-sub' : ''}${preview ? ' gp-ol-structure' : ''}`, onclick: () => go(pos + 1, pos + 1) }, copy, h('small', {}, n ? nf(n) : ''));
        el.dataset.kind = kind; if (role) el.dataset.role = role;
        if (inferred) el.dataset.inferred = 'true';
        if (level > 1) el.style.setProperty('--ol-level', String(level - 1));
        return { pos, kind, el };
      });
      outline.replaceChildren(...rows.flatMap((r) => (r.kind === 'list' && r !== rows[0] ? [h('div', { class: 'gp-ol-sep', role: 'separator' }), r.el] : [r.el])));
      outlineMark();
    };
    outlineToggle.addEventListener('change', async () => { const value = outlineToggle.checked; outlineToggle.disabled = true; await globalThis.GZ_WRITER_AI?.setOutline?.(value); outlineToggle.disabled = false; if (value) outlineAI.retry(); else outlineDraw(); });
    outlineRetry.addEventListener('click', () => outlineAI.retry());
    globalThis.GZ_WRITER_AI?.followOutline?.(outlineDraw);
    addEventListener('pagehide', () => { outlineHidden = true; outlineAI.stop(); });
    addEventListener('pageshow', () => { outlineHidden = false; outlineDraw(); });
    laidOut = () => { if (!panes.outline.hidden) outlineDraw(); feedbackPanel?.updatePages(); globalThis.GZ_WRITER_AI?.layoutChanged?.(); runChecksSoon(); };
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
        const lh = ST.lineHeight(look()) * scale * 1.6, tops = new Set();
        for (const x of r.getClientRects()) if (x.height && x.height < lh) tops.add(Math.round(x.top / 4));
        return tops.size || 1;
      } catch { return 1; }
    };
    const ROWS = new Map();
    const ignoreKey = (i) => `${i.rule}|${view.state.doc.textBetween(Math.max(0, i.from), Math.min(view.state.doc.content.size, i.to), ' ')}`;
    // A rule's findings are one card (a count, one Fix for all, one Ignore); its underlines show only while its card is
    // picked or under the pointer.
    let groups = [], hovered = null;
    const groupOf = (rule) => groups.find((g) => g.rule === rule) || null;
    const shown = () => groupOf(hovered) || groupOf(picked);
    // Drawn by the paper's own decorations: the shared issue store holds every finding (the submit sheet counts them) and
    // its format underlines are hidden (writer-paper.css), as setting it again would redraw the cards under the pointer.
    const underline = () => {
      const on = shown()?.issues || [];
      view.dispatch(view.state.tr.setMeta(issuesKey, PM.view.DecorationSet.create(view.state.doc, on.filter((i) => i.to > i.from).map((i) => PM.view.Decoration.inline(i.from, i.to, { class: 'gp-u-format gp-cur' })))).setMeta('addToHistory', false));
    };
    const runChecks = () => {
      const r = F.check(view.state.doc, format, { name: ctx.user?.name || '', course: ctx.course?.name || '' }, { lines, pageAt, keep });
      formatIssues = r.issues.filter((i) => !ignored.has(ignoreKey(i)));
      const lost = missingFont();
      if (lost) formatIssues.push({ id: 'format:font-missing:0:0', row: null, rule: 'font-missing', from: 0, to: 0, source: 'format', kind: 'format', key: 'Writer has no match for {font}; pages may differ from Word', message: `Writer has no match for ${lost}; pages may differ from Word`, vars: { font: lost }, suggestions: [], sure: false });
      groups = [];
      for (const i of formatIssues) { const g = groupOf(i.rule); if (g) g.issues.push(i); else groups.push({ rule: i.rule, issues: [i] }); }
      if (picked && !groupOf(picked)) picked = null;
      for (const row of r.rows) ROWS.set(row.id, row.label);
      const list = r.rows.map((row) => ({ ...row, count: formatIssues.filter((i) => i.row === row.id).length }));
      checklist.replaceChildren(list.length ? h('h4', { text: labelOf(format) }) : '', ...list.map((row) => h('div', {}, t(row.label), h('span', { class: row.count ? 'gp-no' : 'gp-ok', text: row.count ? nf(row.count) : '✓' }))));
      if (ISSUES()) ISSUES().set('format', formatIssues);
      underline();
      cards();
    };
    const KIND = { spelling: ['Spelling', 'var(--gz-err)'], grammar: ['Grammar', 'var(--gz-warn)'], style: ['Style', 'var(--gz-warn)'], format: ['Format', 'var(--fmt)'], citation: ['Citation', 'var(--fmt)'] };
    // What a group's card says: what is wrong, counted where the rule has words for it.
    const COUNTED = { spacing: () => (format.line === 2 ? '{n} paragraphs aren\'t double-spaced' : '{n} paragraphs have other line spacing') };
    // A finding still open: inside the document as it is now, and still in the shared store (which drops one whose text
    // changed, or that the underline's own card ignored); the store doesn't take a range across paragraphs, so those stay.
    const live = () => {
      const I = ISSUES(), doc = view.state.doc, ids = new Set(I ? I.list().map((i) => i.id) : []);
      return (i) => i.to <= doc.content.size && (!I || (() => { const st = I.clean?.(doc, 'format', i); return !st || ids.has(st.id); })());
    };
    const allIssues = () => {
      const theirs = ISSUES() ? ISSUES().list().filter((i) => i.source !== 'format') : [], open = live();
      const mine = groups.map((g) => ({ ...g, issues: g.issues.filter(open) })).filter((g) => g.issues.length);
      return [...theirs.map((i) => ({ one: i, at: i.from })), ...mine.map((g) => ({ group: g, at: g.issues[0].from }))].sort((a, b) => a.at - b.at);
    };
    const cards = () => {
      const list = allIssues();
      badges.checks.textContent = list.length ? nf(list.length) : '';
      issuesEl.replaceChildren(...list.slice(0, 200).map(({ one, group }) => {
        const i = one || group.issues[0], n = group ? group.issues.length : 1;
        const [kind, color] = KIND[i.kind] || KIND.format;
        const own = i.source === 'format', msg = own ? (COUNTED[i.rule] ? t(COUNTED[i.rule](), { n }) : t(i.key || i.message, localVars(i.vars))) : i.message;
        const label = own && n === 1 && i.suggestions.length ? msg : t(kind);
        const what = n === 1 && i.suggestions.length ? [h('s', { text: view.state.doc.textBetween(i.from, i.to, ' ') }), ' → ', h('b', { text: i.suggestions[0] })] : [h('b', { text: msg }), n > 1 && !COUNTED[i.rule] ? h('span', { class: 'gp-count', text: nf(n) }) : null];
        const can = group ? group.issues.every((x) => x.suggestions.length || x.fix) : i.suggestions.length || i.fix;
        const card = h('div', { class: `gp-issue${group && picked === group.rule ? ' gp-on' : ''}`, tabindex: '0', 'data-rule': own ? i.rule : null },
          h('div', { class: 'gp-lbl' }, h('span', { class: 'gp-dot' }), label),
          h('div', { class: 'gp-fix' }, what),
          h('div', { class: 'gp-row' }, can ? btn({ class: 'gp-sbtn', onclick: (e) => { e.stopPropagation(); if (group) fixGroup(group); else fixIssue(i); } }, n > 1 ? t('Fix all') : t('Fix')) : null,
            btn({ class: 'gp-sbtn gp-ghost', onclick: (e) => { e.stopPropagation(); if (group) ignoreGroup(group); else ignoreIssue(i); } }, t('Ignore'))));
        card.querySelector('.gp-dot').style.background = color;
        card.addEventListener('keydown', (e) => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); } });
        if (group) {
          card.addEventListener('pointerenter', () => { hovered = group.rule; underline(); });
          card.addEventListener('pointerleave', () => { if (hovered === group.rule) { hovered = null; underline(); } });
        }
        card.addEventListener('click', () => { if (group) { picked = group.rule; underline(); for (const c of issuesEl.children) c.classList.toggle('gp-on', c === card); } if (i.to > i.from || i.from > 0) go(Math.max(1, i.from), Math.max(1, i.to)); });
        return card;
      }));
    };
    const localVars = (v) => (v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' && /^[A-Z]/.test(x) && !/\d/.test(x) && !ST.FONTS.includes(x) ? t(x) : x])) : v);
    const ignoreIssue = (i) => {
      if (i.source !== 'format') { ISSUES()?.ignore(i); cards(); return; }
      ignored.add(ignoreKey(i));
      runChecks();
    };
    // An imported paper's well-known font (Aptos, say) that this computer doesn't have: its lines keep Word's spacing but
    // the bundled twin's widths, so one card says so, until it's dismissed for this paper.
    const fontHere = (name) => {
      try {
        const c = (fontHere.c ||= document.createElement('canvas').getContext('2d'));
        const w = (f) => { c.font = `40px ${f}`; return c.measureText('mmmmmmmmmmlli WQ@#').width; };
        return ['monospace', 'serif', 'sans-serif'].some((g) => w(`"${name}", ${g}`) !== w(g));
      } catch { return true; }
    };
    const fontNote = (name) => `gz-font-note:${key || 'paper'}:${name}`;
    const missingFont = () => {
      const doc = view.state.doc, own = ST.setup(doc.attrs.setup);
      let name = own?.font && ST.LOCAL[own.font] ? own.font : null;
      if (!name && own) doc.descendants((n) => { const st = !name && n.isText && n.marks.find((m) => m.type.name === 'text_style' && ST.LOCAL[m.attrs.font]); if (st) name = st.attrs.font; return !name; });
      if (!name || fontHere(name)) return null;
      try { if (localStorage.getItem(fontNote(name))) return null; } catch { /* no storage: shown */ }
      return name;
    };
    const ignoreGroup = (g) => {
      if (g.rule === 'font-missing') try { localStorage.setItem(fontNote(g.issues[0].vars.font), '1'); } catch { /* this session only */ } for (const i of g.issues) ignored.add(ignoreKey(i)); if (picked === g.rule) picked = null; if (hovered === g.rule) hovered = null; runChecks(); };
    // A group's fixes in one transaction (undone at once): from the last to the first, so each position still holds.
    // Rules whose fix rebuilds the paper (an opening, the format) have one finding, so their own fix runs.
    const SIMPLE = new Set(['attr', 'clear', 'mark', 'unmark']);
    const fixGroup = (g) => {
      if (g.issues.length === 1 || !g.issues.every((i) => (i.fix ? SIMPLE.has(i.fix.op) : i.suggestions.length))) { fixIssue(g.issues[0]); return; }
      const s = view.state, tr = s.tr;
      for (const i of [...g.issues].sort((a, b) => b.from - a.from)) {
        const x = i.fix;
        if (!x) tr.insertText(i.suggestions[0], i.from, i.to);
        else if (x.op === 'unmark') tr.removeMark(i.from, i.to, s.schema.marks[x.mark]);
        else if (x.op === 'mark') tr.addMark(i.from, i.to, s.schema.marks[x.mark].create());
        else for (const at of x.op === 'attr' ? [x.at] : x.at) { const node = tr.doc.nodeAt(at); if (node) tr.setNodeMarkup(at, null, { ...node.attrs, ...(x.op === 'attr' ? { [x.key]: x.value } : Object.fromEntries([x.key].flat().map((k) => [k, null]))) }); }
      }
      picked = hovered = null;
      if (tr.docChanged) view.dispatch(tr.scrollIntoView());
      view.focus();
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
      else if (x.op === 'clear') for (const at of x.at) { const node = s.doc.nodeAt(at); if (node) tr.setNodeMarkup(at, null, { ...node.attrs, ...Object.fromEntries([x.key].flat().map((k) => [k, null])) }); }
      else if (x.op === 'setup') { const own = ST.setup(s.doc.attrs.setup); if (own) tr.setDocAttribute('setup', x.key === 'font' ? { ...own, font: null, size: null } : { ...own, [x.key]: x.value }); }
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
    let outlineSaved = null;
    const outlineScope = () => { const verified = PA.keyOf(ctx.paper || paper || {}); return verified === key ? verified : ''; };
    const values = () => ({ name: ctx.user?.name || '', instructor: ctx.instructor || '', course: ctx.course?.name || '', date: ST.dateText(format), dueDate: Number.isFinite(Date.parse(ctx.assignment?.due || paper?.due)) ? ST.dateText(format, new Date(ctx.assignment?.due || paper.due)) : '', title: ctx.assignment?.title || '' });
    // failing: autosaves refused in a row (storage full or unavailable): each tries again later, longer each time.
    let saveTimer = 0, dirty = false, edits = 0, initializing = true, sessionSafe = false, failing = 0;
    const initialBody = view.state.doc.content.content.filter((n) => n.textContent.trim() || n.type.name !== 'paragraph').map((n) => n.toJSON());
    const recoveryScope = host.key || ctx.recovery || 'paper', keySlot = `gz-paper-key:${recoveryScope}`;
    // The tab's copy of a paper's unsaved edits, by the paper's key: the next frame on any page of it finds them.
    const slotOf = (k) => `gz-paper-pending:${k}`;
    // → the copy's record, with base: the revision it was typed on (its save keeps a newer one as a version).
    const pendingOf = (k) => { try { const p = JSON.parse(sessionStorage.getItem(slotOf(k))); return p?.key === k && p.record?.doc ? { ...p.record, base: p.base } : null; } catch { return null; } };
    let recoveryKey;
    try { recoveryKey = sessionStorage.getItem(keySlot); } catch { /* storage can be unavailable */ }
    recoveryKey ||= `recovery:${crypto.randomUUID()}`;
    try { sessionStorage.setItem(keySlot, recoveryKey); } catch { /* the durable copy is still in Papers */ }
    const setState = (k) => { state.textContent = k ? t(k) : ''; };
    // named: the paper has a title the student gave it (typed here or on the Documents home), typed; else a standalone
    // document is called by its first line (F.name) and an assignment's paper by the assignment.
    let named = false, typed = '';
    const naming = (p) => { named = p?.named === true; typed = named ? String(p.title || '') : ''; };
    const record = () => ({
      doc: view.state.doc.toJSON(), words: ed.words(), format: format.base ? ST.preset(format) : format.id, keep, kind: 'paper', named,
      title: named ? typed : own ? F.name(view.state.doc, format) : ctx.assignment?.title || paper?.title || '', due: ctx.assignment?.due || paper?.due || null, url: ctx.paper?.url || paper?.url || '',
      courseName: ctx.course?.name || paper?.courseName || '', ...(ctx.paper ? { school: ctx.paper.school, user: ctx.paper.user, course: ctx.paper.course, content: ctx.paper.content } : {}),
      ...(outlineSaved?.scope === outlineScope() ? { outline: outlineSaved } : {}),
    });
    // The tab's copy of every edit (sessionStorage, read back by the next frame in this tab) holds each picture already
    // saved as a reference (its SHA-256 digest), so a keystroke never copies picture data; the next frame
    // finds them in the saved paper or its versions, retaining unsaved text even when a picture was deleted.
    const SAVED = 'gz-saved:';
    let savedPictures = new Map(), pictureTurn = 0;
    const legacyRef = (src) => `${SAVED}${src.length}:${src.slice(-64)}`;
    const refOf = async (src) => `${SAVED}sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src)))].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    const pictures = (json, to) => {
      if (json?.type === 'image') { const src = json.attrs?.src, next = typeof src === 'string' ? to(src) : src; return next === src ? json : { ...json, attrs: { ...json.attrs, src: next } }; }
      if (!Array.isArray(json?.content)) return json;
      let changed = false;
      const content = json.content.map((c) => { const n = pictures(c, to); changed ||= n !== c; return n; });
      return changed ? { ...json, content } : json;
    };
    const pictureRefs = async (json) => {
      const sources = new Set(); pictures(json, (src) => { sources.add(src); return src; });
      return new Map(await Promise.all([...sources].map(async (src) => [src, savedPictures.get(src) || await refOf(src)])));
    };
    const keepPictures = async (json) => { const turn = ++pictureTurn, m = await pictureRefs(json); if (turn === pictureTurn) savedPictures = m; };
    // Complete the unsaved copy from the paper or its versions. A deleted picture becomes a named placeholder;
    // its absence must never discard the student's unsaved text.
    const complete = async (rec, k, from) => {
      const found = new Map(), add = async (doc) => {
        for (const [src, ref] of await pictureRefs(doc)) {
          if (!found.has(ref)) found.set(ref, src);
          const old = legacyRef(src);
          if (!found.has(old)) found.set(old, src);
          else if (found.get(old) !== src) found.set(old, null);
        }
      };
      const fill = () => {
        let missing = false;
        const doc = pictures(rec.doc, (src) => (src.startsWith(SAVED) ? found.get(src) ?? ((missing = true), src) : src));
        return missing ? null : { ...rec, doc };
      };
      await add(from?.doc);
      const done = fill();
      let legacy = false;
      pictures(rec.doc, (src) => { legacy ||= src.startsWith(SAVED) && !src.startsWith(`${SAVED}sha256:`); return src; });
      if ((done && !legacy) || !k) return done;
      for (const v of await store.versions(k)) await add((await store.version(k, v.id))?.doc);
      const whole = fill();
      if (whole) return whole;
      const recover = (n) => {
        if (n?.type === 'image' && n.attrs?.src?.startsWith(SAVED)) {
          const src = found.get(n.attrs.src);
          return src ? { ...n, attrs: { ...n.attrs, src } } : { type: 'text', text: `[${n.attrs.alt || t('Image')}]` };
        }
        return Array.isArray(n?.content) ? { ...n, content: n.content.map(recover) } : n;
      };
      toast(t('Some pictures, objects or equations were left out.'));
      return { ...rec, doc: recover(rec.doc) };
    };
    const emergency = () => {
      try { const r = record(); r.doc = pictures(r.doc, (src) => savedPictures.get(src) || src); sessionStorage.setItem(slotOf(key), JSON.stringify({ key, record: r, base: paper?.revision ?? 0 })); sessionSafe = true; }
      catch { sessionSafe = false; }
    };
    // writing: this editor's writes in flight (storage tells of each before or after it answers); missed: a change heard
    // meanwhile, looked at again (adopt, below) once they're done.
    let writing = 0, missed = false, adopt = async () => {};
    const ours = async (p) => { writing++; try { return await p; } finally { if (!--writing && missed) { missed = false; adopt().catch((e) => console.error(e)); } } };
    // base: the revision what's saved was typed on, when it isn't the one this editor last read (a recovered copy).
    let saves = Promise.resolve(), replacing = null;
    const save = (reason = 'auto', base) => {
      const next = saves.then(() => saveNow(reason, base));
      saves = next.catch(() => {});
      return next;
    };
    const saveNow = async (reason = 'auto', base) => {
      // Imports write the replacement before showing it: a visibility/pagehide autosave must read the new editor,
      // never queue the outgoing document behind that write. The import's own pre-save runs before this barrier.
      if (replacing) await replacing;
      clearTimeout(saveTimer);
      if (!key) { setState('Not saved'); return null; }
      const at = edits, k = key;
      emergency();
      setState('Saving…');
      try {
        const rec = record(), r = await ours(store.save(key, rec, { reason, base: Number.isSafeInteger(base) ? base : paper?.revision ?? 0 })); paper = r.paper;
        await keepPictures(rec.doc);
        failing = 0;
        if (at === edits) { dirty = false; setState('Saved'); try { sessionStorage.removeItem(slotOf(k)); } catch {} }
        return r;
      } catch (e) {
        dirty = true; console.error(e); setState('Not saved');
        failing++;
        if (reason === 'auto') saveTimer = setTimeout(save, Math.min(60e3, 1e3 * 2 ** failing));
        return null;
      }
    };
    const changed = () => {
      if (initializing) return;
      titled();
      outlineAI.stop(); sourcesPanel?.pause();
      edits++; dirty = true;
      emergency();
      setState(key ? 'Saving…' : 'Not saved');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 800);
      counts();
      clearTimeout(changed.sources); changed.sources = setTimeout(() => sourcesPanel?.refresh(), 400);
      runChecksSoon();
      clearTimeout(outlineDraw.t);
      outlineDraw.t = setTimeout(outlineDraw, 400);
    };
    // The tab's copy only outlives a reload: closing the tab after a refused save would lose the typing.
    addEventListener('beforeunload', (e) => { if (dirty && (!sessionSafe || failing)) { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('pagehide', () => { clearTimeout(changed.sources); sourcesPanel?.pause(); if (dirty) save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) save(); });

    // The document as a whole: on load a fresh state (no undo past it); otherwise one undoable step. The old document's
    // format issues go first: the Checks pane redraws during the dispatch, and their ranges can lie past the new end.
    const setDoc = (json, fresh = false) => {
      const doc = S.paper.nodeFromJSON(json);
      formatIssues = []; picked = null;
      if (fresh) view.updateState(PM.state.EditorState.create({ doc, plugins: view.state.plugins }));
      else {
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content);
        for (const [name, value] of Object.entries(doc.attrs)) tr.setDocAttribute(name, value);
        view.dispatch(PM.history.closeHistory(tr).scrollIntoView());
        view.dispatch(PM.history.closeHistory(view.state.tr));
      }
    };
    const setFormat = async (f, { save: keep = true, restyle = true } = {}) => {
      if (!f) return;
      if (keep && dirty && !await save()) return;
      const before = format;
      format = f;
      noteCache.clear();
      restyleCSS();
      const rebuilt = restyle && (before.opening !== f.opening || before.cite !== f.cite || before.list.title !== f.list.title);
      if (rebuilt) setDoc(F.restyle(view.state.doc, before, f, values()));
      PG.relayout(view);
      counts();
      runChecks();
      if (keep) await save(rebuilt ? 'format' : 'auto');
    };

    // ---- toolbar actions
    const presetMenu = () => [
      ...ST.IDS.map((id) => ({ label: labelOf(ST.FORMATS[id]), checked: format.id === id, run: () => setFormat(ST.FORMATS[id]) })),
      ...(presets.length ? ['-', ...presets.map((p) => ST.custom(p)).filter(Boolean).map((p) => ({ label: p.label, checked: format.id === p.id, run: () => setFormat(p) }))] : []),
      '-', { label: t('New preset…'), run: presetForm },
    ];
    const presetForm = () => {
      const opt = (v, label, sel) => h('option', { value: String(v), selected: sel || null }, label);
      const name = h('input', { type: 'text', maxlength: '40', value: t('My format') });
      const base = h('select', {}, ST.IDS.map((id) => opt(id, labelOf(ST.FORMATS[id]), (format.base || format.id) === id)));
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
      ...[1, 2, 3, 4, 5, 6].map((n) => [t('Heading {n}', { n }), () => { lift(); ed.run('heading', n); }]), ['Block quote', () => { ed.run('heading', 0); PM.commands.wrapIn(view.state.schema.nodes.blockquote)(view.state, view.dispatch); }]];
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

    // ---- font, size, colour, more formatting
    let lastColor = 'C00000', lastHl = 'yellow';
    const bars = () => { colorBar.style.background = `#${lastColor}`; hlBar.style.background = S.HIGHLIGHT[lastHl]; };
    bars();
    const fontMenu = () => {
      const a = ed.active(), L = look();
      menu(fontB, ST.FONTS.map((f) => ({ label: f, checked: (a.font || L.font) === f, run: () => { ed.run('font', f === L.font ? null : f); view.focus(); } })));
      for (const b of open?.el.querySelectorAll('[role^=menuitem]') || []) b.style.fontFamily = `"${b.firstChild.textContent}"`;
    };
    fontB.addEventListener('click', () => (open?.opener === fontB ? close() : fontMenu()));
    const applySize = (raw) => {
      const v = parseFloat(String(raw).replace(',', '.'));
      if (v >= 8 && v <= 72) ed.run('size', Math.round(v * 2) / 2 === look().size ? null : v);
      sizeIn.value = '';
      selected();
    };
    sizeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applySize(sizeIn.value); view.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); sizeIn.value = ''; selected(); view.focus(); }
    });
    sizeIn.addEventListener('focus', () => sizeIn.select());
    sizeIn.addEventListener('blur', () => { sizeIn.value = ''; selected(); });
    sizeB.addEventListener('click', () => {
      if (open?.opener === sizeB) { close(); return; }
      const cur = ed.active().size || look().size;
      menu(sizeB, SIZES.map((v) => ({ label: nf(v), checked: v === cur, run: () => { ed.run('size', v === look().size ? null : v); view.focus(); } })));
    });
    moreFmt.addEventListener('click', () => {
      if (open?.opener === moreFmt) { close(); return; }
      const a = ed.active(), go = (name) => () => { ed.run(name); view.focus(); };
      menu(moreFmt, [
        { label: t('Strikethrough'), hint: keyHint('⌘⇧X'), checked: a.strike, run: go('strike') },
        { label: t('Superscript'), hint: keyHint('⌘⇧='), checked: a.sup, run: go('sup') },
        { label: t('Subscript'), hint: keyHint('⌘='), checked: a.sub, run: go('sub') },
        { label: t('Small caps'), checked: a.smallCaps, run: go('smallCaps') },
        { label: t('All caps'), checked: a.allCaps, run: go('allCaps') },
        '-', { label: t('Clear formatting'), hint: keyHint('⌘\\'), run: go('clear') },
      ]);
    });
    // A palette: Automatic (or no highlight), then swatches; the chosen one goes on the selection and on the button.
    const palette = (opener, kind) => {
      if (open?.opener === opener) { close(); return; }
      const cur = ed.active()[kind];
      const pick = (v) => { close(); ed.run(kind, v); if (v) { if (kind === 'color') lastColor = v; else lastHl = v; } bars(); view.focus(); };
      const sw = (v, label, css) => { const b = btn({ class: 'gp-sw', role: 'menuitemradio', 'aria-checked': String(v === cur), title: label, 'aria-label': label, onclick: () => pick(v) }); b.style.background = css; return b; };
      const none = btn({ class: 'gp-sw-auto', role: 'menuitemradio', 'aria-checked': String(!cur), onclick: () => pick(null) }, h('i', { class: kind === 'color' ? 'gp-sw-ink' : 'gp-sw-none' }), kind === 'color' ? t('Automatic') : t('No highlight'));
      const el = h('div', { class: `gp-menu gp-palette gp-palette-${kind}`, role: 'menu', 'aria-label': opener.getAttribute('aria-label') }, none,
        kind === 'color'
          ? [h('div', { class: 'gp-sw-grid' }, GRID.flat().map((c) => sw(c, `#${c}`, `#${c}`))), h('div', { class: 'gp-hr', role: 'separator' }), h('div', { class: 'gp-sw-grid' }, STANDARD.map((c) => sw(c, `#${c}`, `#${c}`)))]
          : h('div', { class: 'gp-sw-grid gp-sw-hl' }, HIGHLIGHTS.map(([k, label]) => sw(k, t(label), S.HIGHLIGHT[k]))));
      popup(opener, el);
    };
    colorB.addEventListener('click', () => palette(colorB, 'color'));
    hlB.addEventListener('click', () => palette(hlB, 'highlight'));

    // ---- the Paragraph dialog: the caret's paragraph as the format and its own settings lay it out
    const num = (raw) => { const v = parseFloat(String(raw).replace(',', '.').replace(/[^\d.-]/g, '')); return Number.isFinite(v) ? v : NaN; };
    const field = (value, unit, label) => h('input', { class: 'gp-num', type: 'text', inputmode: 'decimal', value: `${nf(Math.round(value * 100) / 100)}${unit}`, 'aria-label': t(label), spellcheck: 'false', autocomplete: 'off' });
    const select = (label, options, value) => h('select', { 'aria-label': t(label) }, options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) || null }, l)));
    const check = (label, on) => { const box = h('input', { type: 'checkbox' }); box.checked = !!on; return [box, h('label', { class: 'gp-check' }, box, h('span', { text: t(label) }))]; };
    const whereAt = () => {
      const $ = view.state.selection.$from, list = ST.listAt(view.state.doc), node = $.parent;
      let quote = false;
      for (let d = $.depth; d > 0; d--) if ($.node(d).type.name === 'blockquote') quote = true;
      const i = $.depth ? $.index(0) : -1;
      return { quote, entry: !!list && $.depth === 1 && node.type.name === 'paragraph' && i >= list.from && i < list.to, heading: node.type.name === 'heading' ? node.attrs.level : 0, node };
    };
    const dialog = (opener, label, cls, rows, ok, extra = null) => {
      const okB = btn({ class: 'gp-sbtn' }, t('Apply')), cancel = btn({ class: 'gp-sbtn gp-ghost', onclick: () => close(true) }, t('Cancel'));
      const el = h('div', { class: `gp-menu gp-form gp-sheet-form ${cls}`, role: 'dialog', 'aria-label': t(label) }, rows, h('div', { class: 'gp-row gp-actions' }, extra, h('span', { class: 'grow' }), cancel, okB));
      const submit = () => { for (const x of el.querySelectorAll('[aria-invalid]')) x.removeAttribute('aria-invalid'); if (ok(el) !== false) { close(); view.focus(); } };
      okB.addEventListener('click', submit);
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } else if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); submit(); } });
      popup(opener, el);
      return el;
    };
    const bad = (input) => { input.setAttribute('aria-invalid', 'true'); input.focus(); return false; };
    const paraDialog = (opener = paraB) => {
      if (open?.opener === opener && opener === paraB) { close(); return; }
      const w = whereAt(), a = w.node.attrs, L = look(), b = ST.paraBase(L, w, a.align || undefined), item = w.node.type.name === 'list_item';
      const first = a.first ?? b.first, lineNow = a.exact != null ? 'exact' : a.least != null ? 'least' : [1, 1.15, 1.5, 2].includes(a.line ?? b.line) ? (a.line ?? b.line) : 'multiple';
      let align = a.align || b.align;
      const seg = h('div', { class: 'gp-seg', role: 'radiogroup', 'aria-label': t('Alignment') }, [['left', 'Left', 'align'], ['center', 'Center', 'center'], ['right', 'Right', 'right'], ['justify', 'Justify', 'justify']].map(([v, l, ico]) => {
        const x = btn({ role: 'radio', 'aria-checked': String(align === v), title: t(l), 'aria-label': t(l) }, icon(ico));
        x.addEventListener('click', () => { align = v; for (const y of seg.children) y.setAttribute('aria-checked', String(y === x)); });
        return x;
      }));
      const left = field(a.left ?? (item ? 0 : a.indent ? a.indent * 0.5 : b.left), '″', 'Left'), right = field(a.right ?? 0, '″', 'Right');
      const special = select('Special', [['none', t('None')], ['first', t('First line')], ['hanging', t('Hanging')]], first > 0.004 ? 'first' : first < -0.004 ? 'hanging' : 'none');
      const by = field(Math.abs(first) || 0.5, '″', 'By');
      const before = field(a.before ?? 0, ' pt', 'Before'), after = field(a.after ?? b.after, ' pt', 'After');
      const line = select('Line spacing', [[1, t('Single')], [1.15, '1.15'], [1.5, '1.5'], [2, t('Double')], ['least', t('At least')], ['exact', t('Exactly')], ['multiple', t('Multiple')]], lineNow);
      const at = field(a.exact ?? a.least ?? (lineNow === 'multiple' ? a.line ?? b.line : 12), lineNow === 'multiple' ? '' : ' pt', 'At');
      const sync = () => { by.disabled = special.value === 'none'; at.disabled = !['least', 'exact', 'multiple'].includes(line.value); };
      special.addEventListener('change', sync);
      line.addEventListener('change', () => { if (line.value === 'multiple') at.value = '3'; else if (line.value === 'least' || line.value === 'exact') at.value = `${nf(12)} pt`; sync(); });
      sync();
      const [keepNext, kn] = check('Keep with next', a.keepNext), [keepLines, kl] = check('Keep lines together', a.keepLines), [widow, wo] = check('Widow and orphan control', a.widow !== false), [brkBefore, bb] = check('Page break before', ed.active().breakBefore);
      if (item) left.disabled = true;
      const row = (label, ...kids) => h('div', { class: 'gp-frow' }, h('span', { class: 'gp-flabel', text: t(label) }), ...kids);
      dialog(opener, 'Paragraph…', 'gp-para', [
        row('Alignment', seg),
        h('h5', { text: t('Indentation') }),
        h('div', { class: 'gp-fgrid' }, h('label', {}, t('Left'), left), h('label', {}, t('Right'), right), h('label', {}, t('Special'), special), h('label', {}, t('By'), by)),
        h('h5', { text: t('Spacing') }),
        h('div', { class: 'gp-fgrid' }, h('label', {}, t('Before'), before), h('label', {}, t('After'), after), h('label', {}, t('Line spacing'), line), h('label', {}, t('At'), at)),
        h('div', { class: 'gp-checks' }, kn, kl, wo, bb),
      ], () => {
        const v = { align, keepNext: keepNext.checked, keepLines: keepLines.checked, widow: widow.checked };
        for (const [k, input, lo, hi] of [['left', left, -10, 10], ['right', right, -10, 10], ['before', before, 0, 1584], ['after', after, 0, 1584]]) { if (input.disabled) continue; const x = num(input.value); if (!(x >= lo && x <= hi)) return bad(input); v[k] = x; }
        const d = special.value === 'none' ? 0 : num(by.value);
        if (!(d >= 0 && d <= 10)) return bad(by);
        v.first = special.value === 'hanging' ? -d : d;
        if (at.disabled) v.line = +line.value;
        else { const x = num(at.value); if (!(line.value === 'multiple' ? x >= 0.5 && x <= 4 : x >= 0.5 && x <= 1584)) return bad(at); v.line = line.value; v.at = x; }
        const patch = ST.paraAttrs(L, w, v);
        if (item) delete patch.left;
        ed.run('paragraph', patch);
        ed.run('breakBefore', brkBefore.checked);
        return true;
      });
    };
    paraB.addEventListener('click', () => paraDialog(paraB));

    // ---- page setup: the paper's own page (doc attr setup, as an import stores it); a paper Writer made gets one only
    // when the student changes something, and Reset to format takes it away.
    const setSetup = (s, history = true) => { const tr = view.state.tr.setDocAttribute('setup', s); if (!history) tr.setMeta('addToHistory', false); view.dispatch(tr); };
    const pageDialog = () => {
      const cur = ST.setup(view.state.doc.attrs.setup), base = cur || ST.pageSetup(format);
      const tall = base.page[0] <= base.page[1], dims = tall ? base.page : [base.page[1], base.page[0]];
      const named = Object.entries(ST.PAGES).find(([, d]) => Math.abs(d[0] - dims[0]) < 0.02 && Math.abs(d[1] - dims[1]) < 0.02)?.[0] || 'custom';
      const size = select('Paper size', [['letter', t('Letter')], ['a4', 'A4'], ['legal', t('Legal')], ...(named === 'custom' ? [['custom', `${nf(dims[0])} × ${nf(dims[1])}″`]] : [])], named);
      let portrait = tall;
      const orient = h('div', { class: 'gp-seg', role: 'radiogroup', 'aria-label': t('Orientation') }, [[true, 'Portrait', 'portrait'], [false, 'Landscape', 'landscape']].map(([v, l, ico]) => {
        const x = btn({ role: 'radio', 'aria-checked': String(portrait === v) }, icon(ico), t(l));
        x.addEventListener('click', () => { portrait = v; for (const y of orient.children) y.setAttribute('aria-checked', String(y === x)); });
        return x;
      }));
      const [top, rgt, bottom, lft] = base.margins.map((m, i) => field(m, '″', ['Top', 'Right', 'Bottom', 'Left'][i]));
      const hdr = field(base.header, '″', 'Header'), ftr = field(base.footer, '″', 'Footer');
      const [title, ti] = check('Different first page', base.title);
      const reset = btn({ class: 'gp-sbtn gp-ghost', disabled: !cur || null, onclick: () => { close(); setSetup(null); view.focus(); } }, t('Reset to format'));
      const row = (label, ...kids) => h('div', { class: 'gp-frow' }, h('span', { class: 'gp-flabel', text: t(label) }), ...kids);
      dialog(moreB, 'Page setup…', 'gp-page', [
        row('Paper size', size), row('Orientation', orient),
        h('h5', { text: t('Margins') }),
        h('div', { class: 'gp-fgrid' }, h('label', {}, t('Top'), top), h('label', {}, t('Bottom'), bottom), h('label', {}, t('Left'), lft), h('label', {}, t('Right'), rgt)),
        h('h5', { text: t('From edge') }),
        h('div', { class: 'gp-fgrid' }, h('label', {}, t('Header'), hdr), h('label', {}, t('Footer'), ftr)),
        h('div', { class: 'gp-checks' }, ti),
      ], () => {
        const vals = [];
        for (const input of [top, rgt, bottom, lft, hdr, ftr]) { const x = num(input.value); if (!(x >= 0 && x <= 10)) return bad(input); vals.push(x); }
        const d = size.value === 'custom' ? dims : ST.PAGES[size.value], page = portrait ? [d[0], d[1]] : [d[1], d[0]];
        const next = ST.setup({ ...base, page, margins: vals.slice(0, 4), header: vals[4], footer: vals[5], title: title.checked });
        if (!next) return bad(top);
        setSetup(next);
        return true;
      }, reset);
    };

    // ---- the header and footer, edited on the page (double-click either, or ⋯ → Header and footer): their lines with
    // PAGE and NUMPAGES fields; the first page's own when the setup has a different first page. A paper's format header
    // ("Surname N") becomes the setup's own once edited.
    let editing = null;
    const PART_MARKS = ['b', 'i', 'u', 's', 'sup', 'sub', 'font', 'size', 'color'];
    const partDOM = (parts, n, total) => parts.map((x) => {
      const line = h('div', { class: 'gp-hf-line' });
      line.style.textAlign = x.align || 'left';
      for (const r of x.runs) {
        const marks = Object.fromEntries(PART_MARKS.filter((k) => r[k] != null).map((k) => [k, r[k]]));
        const el = r.field ? h('span', { class: 'gp-field', contenteditable: 'false', 'data-field': r.field, text: String(r.field === 'PAGE' ? n : total) }) : h('span', { text: r.text });
        el.dataset.marks = JSON.stringify(marks);
        el.style.cssText = [marks.b ? 'font-weight:700' : '', marks.i ? 'font-style:italic' : '', marks.u ? 'text-decoration:underline' : '', marks.font ? `font-family:${ST.stack(marks.font)}` : '', marks.size ? `font-size:${marks.size}pt` : '', marks.color ? `color:#${marks.color};--c:#${marks.color}` : ''].filter(Boolean).join(';');
        line.append(el);
      }
      if (!line.childNodes.length) line.append(h('br'));
      return line;
    });
    const partsOf = (box, orig) => {
      const lines = [];
      let cur = null;
      const start = () => { cur = { runs: [] }; lines.push(cur); };
      const walk = (node, marks) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 3) { if (!cur) start(); if (c.data) cur.runs.push({ text: c.data.replace(/ /g, ' '), ...marks }); continue; }
          if (c.nodeType !== 1) continue;
          if (c.dataset.field) { if (!cur) start(); cur.runs.push({ field: c.dataset.field, ...marks, ...JSON.parse(c.dataset.marks || '{}') }); continue; }
          if (c.nodeName === 'BR') { if (!cur) start(); cur = null; continue; }
          if (c.nodeName === 'DIV' || c.nodeName === 'P') { start(); cur.align = c.style.textAlign || null; walk(c, marks); cur = null; continue; }
          walk(c, c.dataset.marks ? { ...marks, ...JSON.parse(c.dataset.marks) } : marks);
        }
      };
      walk(box, {});
      return lines.map((l, i) => ({ ...(orig[i] || { line: 1, after: 0 }), align: l.align && l.align !== 'left' && l.align !== 'start' ? l.align : null, runs: l.runs.filter((r) => r.field || r.text) }))
        .filter((l, i, all) => l.runs.length || i < all.length - 1 || all.length === 1);
    };
    const finishPart = (keep = true) => {
      if (!editing) return;
      const ed2 = editing;
      editing = null;
      ed2.box.remove(); ed2.bar.remove(); ed2.sheet.classList.remove(`gp-editing-${ed2.kind}`); root.classList.remove('gp-hf-on');
      document.removeEventListener('pointerdown', ed2.away, true);
      if (!keep) { view.focus(); return; }
      const parts = partsOf(ed2.box, ed2.orig), cur = ST.setup(view.state.doc.attrs.setup), base = cur || ST.pageSetup(format), group = `${ed2.kind}s`;
      const next = { ...base, title: ed2.title(), [group]: { ...base[group], [ed2.variant]: parts } };
      if (ed2.kind === 'header' && base.own && base.headers.default == null && ed2.variant === 'first') next.headers = { ...next.headers, default: ST.formatHeader(format, surname()) };
      if (JSON.stringify(parts) !== JSON.stringify(ed2.orig) || next.title !== base.title) setSetup(ST.setup(next));
      view.focus();
    };
    const editPart = (kind = 'header', n = page) => {
      if (!layout || editing) return;
      close();
      n = Math.min(Math.max(1, n), layout.pages.length);
      const sheet = sheets.children[n - 1], L = look(), geo = ST.geometry(L), cur = ST.setup(view.state.doc.attrs.setup), base = cur || ST.pageSetup(format), total = layout.pages.length;
      if (!sheet) return;
      const variant = n === 1 && base.title ? 'first' : 'default', group = base[`${kind}s`];
      const orig = group[variant] ?? (kind === 'header' && variant === 'default' && (!cur || cur.own) ? ST.formatHeader(format, surname()) : [{ align: null, line: 1, after: 0, runs: [] }]);
      const box = h('div', { class: `gp-hf gp-hf-${kind}`, contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t(kind === 'header' ? 'Header' : 'Footer'), spellcheck: 'false' }, partDOM(orig, n, total));
      box.style.cssText = `left:${geo.left}px;right:${geo.right}px;${kind === 'header' ? `top:${geo.header}px` : `bottom:${geo.footer ?? geo.header}px`};font:${L.size}pt/${ST.lineHeight(L, { line: 1 })}px ${ST.stack(L.font)}`;
      sheet.append(box);
      sheet.classList.add(`gp-editing-${kind}`);
      root.classList.add('gp-hf-on');
      const insert = (field2) => {
        const sel = getSelection(), chip = h('span', { class: 'gp-field', contenteditable: 'false', 'data-field': field2, text: String(field2 === 'PAGE' ? n : total) });
        chip.dataset.marks = '{}';
        let r = sel.rangeCount && box.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
        if (!r) { r = document.createRange(); r.selectNodeContents(box.lastElementChild || box); r.collapse(false); }
        r.deleteContents(); r.insertNode(chip); r.setStartAfter(chip); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
        box.focus();
      };
      const alignTo = (v) => {
        const sel = getSelection(), at = sel.anchorNode && box.contains(sel.anchorNode) ? sel.anchorNode : box.firstChild;
        const line = (at?.nodeType === 1 ? at : at?.parentElement)?.closest?.('.gp-hf-line') || box.querySelector('.gp-hf-line');
        if (line) line.style.textAlign = v;
        box.focus();
      };
      const [titleBox, ti] = check('Different first page', base.title);
      const bar = h('div', { class: 'pop gp-hfbar', role: 'toolbar', 'aria-label': t(kind === 'header' ? 'Header' : 'Footer') },
        btn({ class: 'gp-tbtn', onclick: () => insert('PAGE') }, icon('pagenum'), t('Page number')),
        btn({ class: 'gp-tbtn', onclick: () => insert('NUMPAGES') }, icon('pages'), t('Page count')), h('span', { class: 'gp-sepv' }),
        ...[['left', 'Left', 'align'], ['center', 'Center', 'center'], ['right', 'Right', 'right']].map(([v, l, ico]) => btn({ class: 'gp-ibtn', title: t(l), 'aria-label': t(l), onclick: () => alignTo(v) }, icon(ico))),
        h('span', { class: 'gp-sepv' }), ti, h('span', { class: 'gp-sepv' }),
        btn({ class: 'gp-sbtn', onclick: () => finishPart(true) }, t('Done')));
      for (const b of bar.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.append(bar);
      const r = box.getBoundingClientRect();
      bar.style.left = `${Math.max(8, Math.min(r.left, innerWidth - bar.offsetWidth - 8))}px`;
      bar.style.top = `${kind === 'header' ? Math.min(r.bottom + 8, innerHeight - bar.offsetHeight - 8) : Math.max(8, r.top - bar.offsetHeight - 8)}px`;
      bar.getBoundingClientRect();
      bar.setAttribute('data-open', '');
      const away = (e) => { if (!box.contains(e.target) && !bar.contains(e.target)) finishPart(true); };
      document.addEventListener('pointerdown', away, true);
      const partKeys = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishPart(false); }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finishPart(true); }
        else if (e.key === 'Tab') {
          const all = [box, ...bar.querySelectorAll('button, input, select')].filter((x) => !x.disabled), at = all.indexOf(document.activeElement);
          e.preventDefault();
          all[(at + (e.shiftKey ? all.length - 1 : 1)) % all.length]?.focus();
        }
      };
      box.addEventListener('keydown', partKeys);
      bar.addEventListener('keydown', partKeys);
      editing = { kind, variant, sheet, box, bar, orig, away, title: () => titleBox.checked };
      box.focus();
      const sel = getSelection(), end = document.createRange();
      end.selectNodeContents(box.lastElementChild || box); end.collapse(false); sel.removeAllRanges(); sel.addRange(end);
    };
    // A double-click in a page's top or bottom margin edits that page's header or footer.
    canvas.addEventListener('dblclick', (e) => {
      if (!layout || editing || e.target.closest?.('.gp-hf')) return;
      const L = look(), geo = ST.geometry(L), box = zoomEl.getBoundingClientRect(), x = (e.clientX - box.left) / scale, y = (e.clientY - box.top) / scale, stride = geo.height + GAP;
      const i = Math.floor(y / stride), inY = y - i * stride;
      if (x < 0 || x > geo.width || i < 0 || i >= layout.pages.length || inY > geo.height) return;
      const kind = inY < geo.top ? 'header' : inY > geo.height - geo.bottom ? 'footer' : null;
      if (!kind) return;
      e.preventDefault(); e.stopPropagation();
      editPart(kind, i + 1);
    }, true);

    // ---- ⋯: page setup, the header and footer, the ruler (writer-ruler.js, where loaded)
    // A narrow toolbar folds its controls into ⋯, in this order, until the rest fits.
    const tool = root.querySelector('.gp-tool'), history2 = undo.parentElement;
    const FOLDS = [[history2, null], [zoomB, 'Zoom'], [hlB], [colorB], [moreFmt], [paraB], [alignB]];
    const fold = () => {
      for (const [el] of FOLDS) el.hidden = false;
      for (let i = 0; i < FOLDS.length && tool.scrollWidth > tool.clientWidth + 1; i++) FOLDS[i][0].hidden = true;
    };
    new ResizeObserver(fold).observe(tool);
    const folded = () => FOLDS.filter(([el]) => el.hidden).flatMap(([el, label]) => (el === history2
      ? [{ label: t('Undo'), hint: keyHint('⌘Z'), run: () => { ed.run('undo'); view.focus(); } }, { label: t('Redo'), hint: keyHint('⌘⇧Z'), run: () => { ed.run('redo'); view.focus(); } }]
      : [{ label: label ? `${t(label)} ${el.textContent}` : el.getAttribute('aria-label'), run: () => el.click() }]));
    moreB.addEventListener('click', () => {
      if (open?.opener === moreB) { close(); return; }
      const R = globalThis.GZ_WRITER_RULER, extra = folded();
      menu(moreB, [...extra, ...(extra.length ? ['-'] : []),{ label: t('Page setup…'), run: pageDialog }, { label: t('Header and footer'), run: () => editPart('header', page) },
        ...(R ? ['-', { label: t('Show ruler'), checked: R.shown(), run: () => R.toggle() }] : []),
        ...(document.documentElement.hasAttribute('data-dark') ? [...(R ? [] : ['-']), { label: t('Light page'), checked: document.documentElement.hasAttribute('data-light-page'), run: () => {
          const on = !document.documentElement.hasAttribute('data-light-page');
          lightPage(on);
          SET?.patch((w) => ({ ...w, lightPage: on })).catch(() => {});
        } }] : [])]);
    });

    // ---- the page's context menu: cut, copy, paste (the clipboard's, or plain), Paragraph…, Clear formatting. Shift and
    // a right-click give the browser's own.
    const pasteFrom = async (plain) => {
      view.focus();
      try {
        if (!plain && navigator.clipboard?.read) {
          for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) { view.pasteHTML(await (await item.getType('text/html')).text()); return; }
        }
        const text = await navigator.clipboard.readText();
        if (text) view.pasteText(text);
      } catch { toast(t('Press {key} to paste', { key: keyHint(plain ? '⌘⇧V' : '⌘V') })); }
    };
    view.dom.addEventListener('contextmenu', (e) => {
      if (e.shiftKey || !layout || editing) return;
      e.preventDefault();
      const anchor = h('span', { class: 'gp-anchor', 'aria-hidden': 'true' });
      anchor.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:0;height:0`;
      document.body.append(anchor);
      const exec = (cmd) => () => { view.focus(); document.execCommand(cmd); };
      const empty = view.state.selection.empty;
      menu(anchor, [
        ...(empty ? [] : [{ label: t('Cut'), hint: keyHint('⌘X'), run: exec('cut') }, { label: t('Copy'), hint: keyHint('⌘C'), run: exec('copy') }]),
        { label: t('Paste'), hint: keyHint('⌘V'), run: () => pasteFrom(false) }, { label: t('Paste without formatting'), hint: keyHint('⌘⇧V'), run: () => pasteFrom(true) },
        '-', { label: t('Paragraph…'), run: () => paraDialog(paraB) }, { label: t('Clear formatting'), hint: keyHint('⌘\\'), run: () => { ed.run('clear'); view.focus(); } },
      ], { onClose: () => anchor.remove() });
    });
    const setFocus = (on) => { focus = on; focusB.setAttribute('aria-pressed', String(on)); host.say?.({ type: 'focus-mode', on }); };
    focusB.addEventListener('click', () => setFocus(!focus));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && focus && !open && !e.defaultPrevented) setFocus(false); });
    const hooks = () => {
      globalThis.GZ_WRITER_OBJECTS?.toolbar?.({ editor: ed, paper: api, before: toolGrow, lists: numbers });
      const C = globalThis.GZ_WRITER_CITE;
      cite.disabled = typeof C?.open !== 'function';
      if (C?.sourcesView) { sourcesPanel?.destroy(); sourcesPanel = C.sourcesView(panes.sources, { editor: ed, paper: api, badge: (n) => { badges.sources.textContent = n ? nf(n) : ''; } }); }
      if (globalThis.GZ_WRITER_AI?.feedbackView) feedbackPanel = GZ_WRITER_AI.feedbackView(panes.feedback, { pageAt });
      submit.disabled = typeof GZ_WRITER_PAPER.submit !== 'function';
      fold();
    };
    cite.addEventListener('click', () => globalThis.GZ_WRITER_CITE?.open?.({ anchor: cite }));
    submit.addEventListener('click', () => { if (typeof GZ_WRITER_PAPER.submit === 'function') GZ_WRITER_PAPER.submit(api); });
    for (const [id, tab] of Object.entries(tabs)) tab.addEventListener('click', () => {
      for (const [k, x] of Object.entries(tabs)) { x.setAttribute('aria-selected', String(k === id)); x.tabIndex = k === id ? 0 : -1; panes[k].hidden = k !== id; }
      if (id === 'sources') sourcesPanel?.refresh(); else sourcesPanel?.pause();
      if (id === 'feedback') globalThis.GZ_WRITER_AI?.recover?.();
      if (id === 'outline') outlineDraw();
      else outlineAI.stop();
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

    // Print a clipped copy of the measured flow on each physical page, at full size, on paper of the paper's own size (an
    // @page rule added to writer-paper.css's sheet for the print: writer.html's CSP allows no <style> of its own).
    let printCopy = null, pageRule = null;
    const sheetCSS = () => [...document.styleSheets].find((x) => /\/writer-paper\.css$/.test(x.href || ''));
    const unpage = () => { const css = sheetCSS(), i = pageRule ? [...(css?.cssRules || [])].indexOf(pageRule) : -1; if (i >= 0) css.deleteRule(i); pageRule = null; };
    addEventListener('beforeprint', () => {
      printCopy?.remove();
      printCopy = h('div', { class: 'gp-print' });
      const geo = ST.geometry(look()), stride = geo.height + GAP, css = sheetCSS();
      unpage();
      if (css) { try { pageRule = css.cssRules[css.insertRule(`@page { size: ${geo.width / 96}in ${geo.height / 96}in; margin: 0; }`, css.cssRules.length)]; } catch { /* the format's Letter rule stays */ } }
      [...sheets.children].forEach((sheet, i) => {
        const page = sheet.cloneNode(true), clip = h('div', { class: 'gp-print-body' }), copy = flow.cloneNode(true);
        clip.style.cssText = `position:absolute;top:${geo.top}px;left:0;width:${geo.width}px;height:${geo.body}px;overflow:hidden`;
        copy.style.top = `${-i * stride}px`;
        copy.querySelector('.ProseMirror').removeAttribute('contenteditable');
        clip.append(copy); page.append(clip); printCopy.append(page);
      });
      document.body.append(printCopy);
    });
    addEventListener('afterprint', () => { printCopy?.remove(); printCopy = null; unpage(); });

    // A footnote's text, in a small editor by its mark. A new note left empty goes again.
    const editNote = (pos, fresh = false) => {
      const node = view.state.doc.nodeAt(pos);
      if (node?.type.name !== 'footnote_ref') return;
      const noteDoc = S.parse(S.paper, `<div>${node.attrs.content}</div>`);
      const plain = noteDoc.content.content.map((p) => p.textBetween(0, p.content.size, '', '\n')).join('\n\n');
      const area = h('textarea', { 'aria-label': t('Footnote'), maxlength: '4000' });
      area.value = plain;
      const el = h('div', { class: 'gp-menu gp-note', role: 'dialog', 'aria-label': t('Footnote') }, area);
      const done = (keep, returnFocus = true) => {
        if (!el.isConnected) return;
        if (open?.el === el) open.onClose = null;
        close();
        const now = view.state.doc.nodeAt(pos);
        if (now?.type.name !== 'footnote_ref') return;
        const text = area.value.replace(/\r\n?/g, '\n').trim();
        if (keep && text !== plain) view.dispatch(text ? view.state.tr.setNodeMarkup(pos, null, { content: S.inline(text.split(/\n\n/).map((p) => `<p>${p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\n/g, '<br>')}</p>`).join('')) }) : view.state.tr.delete(pos, pos + 1));
        else if (!keep && fresh && !plain) view.dispatch(view.state.tr.delete(pos, pos + 1));
        if (returnFocus) view.focus();
      };
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      area.addEventListener('blur', () => setTimeout(() => done(true), 0));
      const anchor = view.nodeDOM(pos) || view.dom;
      popup(anchor.nodeType === 1 ? anchor : view.dom, el, { onClose: () => done(true, false) });
    };

    // ---- versions, import and export
    const REASONS = { conflict: 'Another editor’s draft', submit: 'Submitted', import: 'Before import', restore: 'Before restore', format: 'Before format change', edit: 'Before a big edit', auto: 'Autosave', start: 'First draft' };
    versionsB.addEventListener('click', async () => {
      if (open?.opener === versionsB) { close(); return; }
      const list = key ? await store.versions(key) : [];
      const when = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const el = h('div', { class: 'gp-menu gp-versions', role: 'menu' },
        ...list.map((v) => h('div', { class: 'gp-mi' }, h('span', {}, when.format(v.at), ' ', h('small', { text: `${t(REASONS[v.reason] || 'Autosave')} · ${t('{n} words', { n: nf(v.words) })}` })),
          btn({ role: 'menuitem', onclick: () => { close(); restore(v.id); } }, t('Restore')))),
        list.length ? h('div', { class: 'gp-hr' }) : null,
        btn({ role: 'menuitem', onclick: () => { close(); exportFile(); } }, t('Export .docx')),
        ...(globalThis.GZ_WRITER_PRINT?.items() || []).map((it) => btn({ role: 'menuitem', onclick: () => { close(); it.run(); } }, it.label)),
        btn({ role: 'menuitem', onclick: () => { close(); file.click(); } }, host.standalone ? t('Import .docx…') : t('Import…')),
        own ? null : btn({ role: 'menuitem', onclick: () => { close(); fromDocsSheet(); } }, t('Open from Documents')),
        host.standalone ? null : btn({ role: 'menuitem', onclick: () => { close(); open2('papers.html'); } }, t('Documents')));
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
      popup(versionsB, el, { above: true });
    });
    const restore = async (id) => {
      if (!await save()) return;
      let r = null;
      try { r = await store.restore(key, id); } catch (e) { console.error(e); }
      if (!r) { toast(t('Not saved. Try again in a moment.')); return; }
      paper = r.paper; keep = paper.keep === true; outlineSaved = paper.outline || null;
      await setFormat(ST.get(paper.format), { save: false, restyle: false }); setDoc(paper.doc); toast(t('Version restored'));
    };
    const open2 = (page2) => { try { window.open(chrome.runtime.getURL(page2), '_blank', 'noopener'); } catch { /* no extension context */ } };
    const docx = async () => { await need(DOCX); return GZ_WRITER_DOCX.exportDocx(view.state.doc, { format, surname: surname(), title: ctx.assignment?.title || paper?.title || '' }); };
    const fileName = () => GZ_WRITER_SUBMIT_LIB.fileName({ surname: surname(), title: ctx.assignment?.title || paper?.title || '', fallback: t('Paper') });
    const exportFile = async () => {
      try {
        const out = await docx(), url = URL.createObjectURL(new Blob([out.bytes], { type: out.type }));
        const a = h('a', { href: url, download: fileName() });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (e) { console.error(e); toast(t('The .docx could not be made.')); }
    };
    // An imported file whose own formatting the format would flag: the paper keeps it (the default), so those checks go
    // quiet for this paper, unless the student applies the format, once, from the import's toast.
    let keep = false;
    const ownFormatting = (doc) => F.check(doc, format, {}, {}).issues.some((i) => F.KEPT.has(i.rule) && i.fix?.op !== 'format');
    const formatChoices = () => ({
      ask: t('Its formatting differs from {format}', { format: labelOf(format) }),
      items: [{ label: t('Keep the document’s formatting'), run: () => {} }, { label: t('Apply {format}', { format: labelOf(format) }), run: () => { keep = false; setDoc(F.apply(view.state.doc)); runChecks(); } }],
    });
    // The paper becomes the Word file's text, what it held kept as a version first; the toast's Undo brings that back.
    let importing = false;
    const importFile = async (f) => {
      if (!f || importing || globalThis.GZ_WRITER_SUBMIT_SHEET?.busy()) return;
      importing = true;
      const editable = view.props.editable, inert = root.inert;
      const snapshot = { key, doc: view.state.doc, format };
      const here = () => root.isConnected && current === api && key === snapshot.key && view.state.doc === snapshot.doc && format === snapshot.format;
      root.inert = true; view.setProps({ editable: () => false });
      let before = null, release;
      try {
        if (!Number.isSafeInteger(f.size) || f.size <= 0 || f.size > 15e6) throw new RangeError('Choose a Word file smaller than 15 MB.');
        await need(DOCX);
        if (!here()) return;
        const bytes = await f.arrayBuffer();
        if (!here()) return;
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== f.size) throw new Error('invalid file read');
        const r = await GZ_WRITER_DOCX.importDocx(new Uint8Array(bytes), { format });
        if (!here()) return;
        const doc = S.paper.nodeFromJSON(r.doc), own = ownFormatting(doc);
        if (key) {
          if (!await save()) throw new Error('paper could not be saved before import');
          if (!here()) return;
          replacing = new Promise((r) => { release = r; });
          const json = doc.toJSON();
          const saved = await store.save(key, { ...record(), doc: json, words: PA.measure(json).words, keep: own }, { reason: 'import' });
          if (!here()) return;
          paper = saved.paper;
          before = saved.version;
          await keepPictures(json);
          if (!here()) return;
        }
        keep = own;
        setDoc(doc.toJSON());
        toast(r.warnings.length ? r.warnings.map((w) => t(w)).join(' ') : f.name, before ? { label: t('Undo'), run: () => restore(before.id) } : null, own ? formatChoices() : null);
      } catch (e) {
        console.error(e);
        const message = e instanceof RangeError && ['Choose a Word file smaller than 15 MB.', 'The pictures in this file are larger than 10 MB.', 'The document is too large.', 'A table is too wide.'].includes(e.message) ? e.message : 'That file could not be read as a Word document.';
        toast(t(message));
      }
      finally { replacing = null; release?.(); importing = false; root.inert = inert; view.setProps({ editable }); if (root.isConnected && current === api) view.focus(); }
      return before;
    };
    file.addEventListener('change', () => { bring(file.files[0]); file.value = ''; });
    // A file brought to the paper: on an assignment writer-import.js asks what to do with it; papers.html opens a Word file.
    const routed = () => !host.standalone && !!globalThis.GZ_WRITER_IMPORT && typeof GZ_WRITER_PAPER.submit === 'function';
    const bring = (f) => { if (!f) return; if (routed()) GZ_WRITER_IMPORT.bring(api, f); else if (/\.docx$/i.test(f.name)) importFile(f); };
    canvas.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); canvas.classList.add('gp-drop'); } });
    canvas.addEventListener('dragleave', () => canvas.classList.remove('gp-drop'));
    canvas.addEventListener('drop', (e) => {
      const all = [...(e.dataTransfer?.files || [])], f = routed() ? all[0] : all.find((x) => /\.docx$/i.test(x.name));
      canvas.classList.remove('gp-drop');
      if (!f) return;
      e.preventDefault(); e.stopPropagation();
      if (globalThis.GZ_WRITER_OBJECTS?.drop?.(f, e)) return;
      bring(f);
    }, true);

    // ---- Open from Documents (an assignment's paper): the student's standalone documents, newest first, on a sheet drawn
    // as the import card is (writer-import.js). The one picked becomes the paper as a Word file does (importFile): what the
    // paper held kept as a version first, the toast's Undo bringing it back; the document stays on the Documents home.
    const fromDocs = async (k, name) => {
      if (!key || PA.local(key) || !PA.local(k) || importing || globalThis.GZ_WRITER_SUBMIT_SHEET?.busy()) return null;
      importing = true;
      const editable = view.props.editable, inert = root.inert;
      const snapshot = { key, doc: view.state.doc, format };
      const here = () => root.isConnected && current === api && key === snapshot.key && view.state.doc === snapshot.doc && format === snapshot.format;
      root.inert = true; view.setProps({ editable: () => false });
      let before = null, release;
      try {
        const fields = PA.fromDocument(key, await store.get(k));
        if (!here()) return null;
        if (!fields) throw new Error('no document');
        fields.doc = S.paper.nodeFromJSON(fields.doc).toJSON();
        if (!await save()) throw new Error('paper could not be saved before import');
        if (!here()) return null;
        replacing = new Promise((r) => { release = r; });
        const saved = await store.save(key, { ...record(), ...fields }, { reason: 'import' });
        if (!here()) return null;
        paper = saved.paper; before = saved.version;
        keep = paper.keep === true; outlineSaved = paper.outline || null;
        await keepPictures(paper.doc);
        if (!here()) return null;
        await setFormat(ST.get(paper.format), { save: false, restyle: false });
        setDoc(paper.doc);
        toast(name, before ? { label: t('Undo'), run: () => restore(before.id) } : null);
      } catch (e) { console.error(e); toast(t('Not saved. Try again in a moment.')); }
      finally { replacing = null; release?.(); importing = false; root.inert = inert; view.setProps({ editable }); if (root.isConnected && current === api) view.focus(); }
      return before;
    };
    let docsSheet = null, docsTurn = 0;
    const closeDocs = (back = true) => {
      docsTurn++;
      const s = docsSheet;
      if (!s) return;
      docsSheet = null;
      s.layer.remove();
      for (const [el, was] of s.inert) el.inert = was;
      if (back && versionsB.isConnected) versionsB.focus();
    };
    // Each row: its title (the one given, else its first line as record() keeps it), format, words and date.
    const fromDocsSheet = async () => {
      closeDocs(false);
      const turn = docsTurn;
      let docs;
      try { docs = (await store.list()).filter((r) => PA.local(r.key) && r.kind === 'paper').sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
      catch (e) { console.error(e); if (turn === docsTurn && root.isConnected && current === api) { toast(t('Not saved. Try again in a moment.')); versionsB.focus(); } return; }
      if (turn !== docsTurn || !root.isConnected || current !== api || importing || globalThis.GZ_WRITER_SUBMIT_SHEET?.opened()) return;
      const when = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'medium' });
      const x = btn({ class: 'gp-fromdocs-x', title: t('Close'), 'aria-label': t('Close'), onclick: () => closeDocs() }, icon('close'));
      const picks = docs.map((r) => {
        const name = r.title || t('Untitled document');
        const meta = [labelOf(ST.get(r.format)), t('{n} words', { n: nf(r.words || 0) }), Number.isFinite(r.updated) ? when.format(r.updated) : ''].filter(Boolean).join(' · ');
        return btn({ class: 'gp-fromdocs-row', 'aria-label': `${name} · ${meta}`, onclick: () => { closeDocs(false); fromDocs(r.key, name); } }, h('b', { text: name }), h('small', { text: meta }));
      });
      const layer = h('div', { class: 'gp-fromdocs-layer' }, h('div', { class: 'gp-fromdocs-dim', onclick: () => closeDocs() }),
        h('div', { class: 'gp-fromdocs', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'gp-fromdocs-h' },
          h('div', { class: 'gp-fromdocs-head' }, h('h2', { id: 'gp-fromdocs-h', text: t('Open from Documents') }), x), picks.length ? h('div', { class: 'gp-fromdocs-list' }, picks) : null));
      const inert = [...document.body.children].map((el) => [el, el.inert]);
      for (const [el] of inert) el.inert = true;
      document.body.append(layer);
      docsSheet = { layer, inert };
      layer.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDocs(); return; }
        if (picks.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          const i = picks.indexOf(document.activeElement);
          e.preventDefault(); e.stopPropagation();
          picks[e.key === 'Home' ? 0 : e.key === 'End' ? picks.length - 1 : (i + (e.key === 'ArrowUp' ? picks.length - 1 : 1)) % picks.length].focus();
          return;
        }
        if (e.key !== 'Tab') return;
        const all = [...picks, x], i = all.indexOf(document.activeElement);
        e.preventDefault();
        all[(i + (e.shiftKey ? all.length - 1 : 1)) % all.length].focus();
      });
      layer.getBoundingClientRect();
      layer.setAttribute('data-open', '');
      (picks[0] || x).focus();
      // A fixed sheet is centred in the frame; Ultra may show only part of that frame. Bring the whole dialog into
      // the outer window too, including a keyboard opening while the status bar is below it.
      layer.querySelector('.gp-fromdocs').scrollIntoView({ block: 'center', inline: 'nearest' });
    };

    // ---- what the page says: Ultra's names and the paper's key
    // The title field: what the student typed, else its derived name in its place, as wide as what it shows.
    const titled = () => {
      if (!own) return;
      if (!named) titleIn.placeholder = F.name(view.state.doc, format) || t('Untitled document');
      titleIn.size = Math.min(60, Math.max(12, (titleIn.value || titleIn.placeholder).length + 1));
    };
    // A title typed is saved as an edit is (named; emptied, the derived name again).
    titleIn?.addEventListener('input', () => {
      typed = titleIn.value.replace(/\s+/g, ' ').trim(); named = !!typed;
      titled();
      edits++; dirty = true;
      emergency();
      setState('Saving…');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 800);
    });
    titleIn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); view.focus(); } });
    const head = () => {
      const tt = ctx.assignment?.title || paper?.title || '';
      if (own) { titleIn.value = typed; titled(); } else title.textContent = tt || t('Paper');
      const d = ctx.assignment?.due || paper?.due;
      due.textContent = d && Number.isFinite(Date.parse(d)) ? t('Due {when}', { when: new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d)) }) : '';
    };
    // made: this frame made the paper from the format's opening and nothing is written in it yet.
    let loading = null, recovered = false, made = false;
    const load = () => (loading ||= (async () => {
      key = host.key || PA.keyOf(ctx.paper || {}) || recoveryKey;
      paper = await store.get(key);
      await keepPictures(paper?.doc);
      recovered = key === recoveryKey && !!paper?.doc;
      const copy = pendingOf(key), pending = copy && await complete(copy, key, paper);
      if (pending) { const { base: _, ...rec } = pending; paper = { ...paper, ...rec }; }
      outlineSaved = paper?.outline || null;
      keep = paper?.keep === true;
      naming(paper);
      if (paper?.doc) {
        format = ST.get(paper.format);
        setDoc(paper.doc, true);
      } else {
        // papers.html?format=<id>: the Documents home's New in that format.
        const asked = host.standalone ? new URLSearchParams(location.search).get('format') : null;
        format = ST.get(paper?.format || (ST.IDS.includes(asked) ? asked : ST.IDS.includes(prefs.format) ? prefs.format : 'mla9'));
        // A new paper: the format's opening and list page around what Ultra's box already held. Under a stand-in key, and
        // as a standalone document (an untouched one leaves nothing on the Documents home), it is saved once something is
        // written in it.
        setDoc(F.template(format, values(), initialBody), true);
        made = true;
        if (key !== recoveryKey && !PA.local(key)) await save('auto');
      }
      initializing = false;
      if (pending) { dirty = true; await save('auto', pending.base); }
      const scope = PA.scopeOf(ctx.paper || paper || {});
      presets = scope ? await store.presets(scope) : [];
      restyleCSS();
      head();
      counts();
      setZoom(zoom);
      PG.relayout(view);
      runChecks();
      outlineDraw();
      if (titleIn) titleIn.readOnly = false;
      if (!dirty) setState(PA.local(key) && !paper ? '' : 'Saved');
    })());
    // The paper's key came after the frame opened (the student's id wasn't known then), so far kept under a stand-in key.
    // Nothing written under it: the student's paper opens as it was saved, with this tab's unsaved copy of it. Written in:
    // that paper takes the key, the one saved there (with this tab's unsaved copy) kept as a version first.
    host.onContext?.((c) => {
      ctx = c && typeof c === 'object' ? c : {};
      head();
      const target = host.key || PA.keyOf(ctx.paper || {});
      // A paper made before the page named its student, course and assignment takes them into its opening.
      if (target && key === target) (async () => {
        await loading;
        if (!made || edits || key !== target) return;
        const next = F.template(format, values(), initialBody);
        if (S.paper.nodeFromJSON(next).eq(view.state.doc)) return;
        initializing = true;
        setDoc(next, true);
        initializing = false;
        counts(); runChecks(); outlineDraw();
        dirty = true;
        await save();
      })().catch((e) => { console.error(e); setState('Not saved'); });
      if (target && key === recoveryKey) (async () => {
        await loading;
        if (key !== recoveryKey) return;
        const at = edits, written = at > 0 || recovered;
        const existing = written ? null : await store.get(target);
        const copy = !written && pendingOf(target), pending = copy && await complete(copy, target, existing);
        if (key !== recoveryKey) return;
        if (!written && edits === at) {
          key = target;
          keepPictures(existing?.doc).catch((e) => console.error(e));
          if (pending) { const { base: _, ...rec } = pending; paper = { ...existing, ...rec }; } else paper = existing;
          naming(paper);
          outlineSaved = paper?.outline || null;
          keep = paper?.keep === true;
          format = ST.get(paper?.format || (ST.IDS.includes(prefs.format) ? prefs.format : 'mla9'));
          initializing = true;
          setDoc(paper?.doc || F.template(format, values(), initialBody), true);
          initializing = false;
          const scope = PA.scopeOf(ctx.paper || {});
          presets = scope ? await store.presets(scope) : [];
          restyleCSS(); counts(); PG.relayout(view); runChecks(); outlineDraw();
          if (pending || !existing?.doc) { dirty = true; if (!await save('auto', pending?.base)) return; }
          if (!dirty) setState('Saved');
          return;
        }
        if (!await save()) return;
        const kept = pendingOf(target), filled = kept && await complete(kept, target, await store.get(target));
        if (filled) { const { base, ...rec } = filled; await ours(store.save(target, rec, Number.isSafeInteger(base) ? { base } : {})); }
        key = target;
        if (await save('import')) { await store.remove(recoveryKey); try { sessionStorage.removeItem(slotOf(recoveryKey)); } catch {} }
      })().catch((e) => { console.error(e); setState('Not saved'); });
    });
    // Another editor (a second tab, the Papers page) saved this paper: while this one holds nothing unsaved, it shows that,
    // read through the store so its next save builds on it. Unsaved typing stays; its save keeps the other text as a
    // version. A rename (the Documents home's) reaches the title either way, and the next save carries it.
    const newer = (p) => p?.doc && !dirty && !initializing && !importing && (p.revision || 0) > (paper?.revision || 0);
    const elsewhere = async (changes, area) => {
      const next = area === 'local' && key ? changes[PA.KEYS.PAPER + key]?.newValue : null;
      if (!newer(next) && !PA.renamed(paper, next)) return;
      // While this editor's own write is in flight, its word may be that write: look again once it has answered.
      if (writing) { missed = true; return; }
      await adopt();
    };
    adopt = async () => {
      const k = key, fresh = await store.get(k);
      if (k !== key) return;
      // Only the name changed (the text is the one here), or this editor holds unsaved typing: the title alone, the
      // text, caret and undo as they are.
      const r = PA.renamed(paper, fresh);
      if (r && (r.revision || !newer(fresh))) {
        naming(r);
        if (paper) paper = { ...paper, title: fresh.title, named: r.named, ...(r.revision ? { revision: r.revision } : {}) };
        head();
        return;
      }
      if (!newer(fresh)) return;
      paper = fresh; outlineSaved = fresh.outline || null; keep = fresh.keep === true; format = ST.get(fresh.format);
      naming(fresh);
      keepPictures(fresh.doc).catch((e) => console.error(e));
      initializing = true;
      setDoc(fresh.doc, true);
      initializing = false;
      restyleCSS(); counts(); head(); PG.relayout(view); runChecks(); outlineDraw(); setState('Saved');
    };
    try { chrome.storage.onChanged.addListener((c, area) => { elsewhere(c, area).catch((e) => console.error(e)); }); } catch { /* outside the extension */ }
    restyleCSS();
    counts();
    head();
    setState('');
    const api = {
      editor: ed, key: () => key, format: () => format, look, paper: () => paper, context: () => ctx,
      docx, save, notify: (message) => toast(t(message)), version: (reason = 'submit') => save(reason), focus: setFocus, refresh: hooks, zoom: setZoom, importFile, importing: () => importing,
      // Nothing written past the format's opening yet (an import then needs no word about the paper it replaces).
      blank: () => view.state.doc.textContent.trim() === S.paper.nodeFromJSON(F.template(format, values())).textContent.trim(),
      // The page ended Focus (a click on its dim).
      focused: (on) => { focus = on; focusB.setAttribute('aria-pressed', String(on)); },
      pages: () => layout?.pages.length || 0,
      // A question in the paper's toast: items [{ label, run }], the first the default; gone() when it goes unanswered.
      ask: (text, items, gone) => toast(text, null, { ask: '', items, gone }),
      paragraph: (opener) => paraDialog(opener || paraB), pageSetup: pageDialog,
      // A change to the paper's page (its setup, made from the format if it has none), as one undoable step.
      setup: (change) => { const s2 = ST.setup({ ...(ST.setup(view.state.doc.attrs.setup) || ST.pageSetup(format)), ...change }); if (s2) setSetup(s2); return !!s2; }, editPart, editingPart: () => editing?.kind || null,
      // What writer-ruler.js draws from: the work column and canvas, the zoom, the page's geometry, redraws.
      view: { col: canvas.parentElement, canvas, size, scale: () => scale, geometry: () => ST.geometry(look()), page: () => page, onDraw: (fn) => drawn.push(fn) },
      // The last page plan's blocks and breaks (lib/writer-paginate.js), for checks.
      layout: () => layout && { breaks: layout.breaks, blocks: layout.blocks.map((b) => ({ kind: b.kind, pos: b.pos, lines: (b.lines || []).map((l) => Math.round(l.h * 100) / 100), slack: b.lines?.[0]?.slack || 0, before: b.before || 0, after: b.after || 0 })) },
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
