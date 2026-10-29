// Glaze Writer's editor frame (writer.html): Glaze's editor where Ultra shows an editor box, which features/writer.js
// opens in the box's place. An extension page, so the editor has the workers and WebAssembly the LMS page's CSP keeps from
// a content script (proofing needs both), its own fonts and styles. It opens only with a one-use pass from the worker
// (lib/background.js 'glaze:writer'). After a public boot signal, it talks to the page over that job's MessageChannel:
//   page → frame: init { mode, kind, html, selection, placeholder, look { tokens, dark, glass, motion }, context, locale },
//                 look { look }, context { context }, focus, html { html } (Ultra changed its own editor: a post went, a
//                 draft came back); and for the frame's later parts (handle): quote (writer-compose.js), ai and
//                 attachments (writer-ai.js), focus-mode (writer-paper.js), import:file (writer-import.js), submit:*
//                 (writer-submit.js);
//   frame → page: ready, height { px }, change { html, text, words, delta } (compose's; a paper's compact box sends its
//                 own: writer-paper.js; delta: its Quill ops, what the page writes into Ultra's editor), send (Mod-Enter),
//                 native (back to Blackboard's editor; with a reason, the box holds what Writer can't keep and nothing was
//                 written); and the later parts' attachments, focus-mode, view { full, px, from, to }, room { on } and
//                 submit:*.
// Besides that pass it asks the extension only for the student's Writer settings (lib/writer-settings.js); its later
// parts keep the paper (lib/writer-papers.js) and ask for proofing and AI on their own channels.
(() => {
  const root = document.documentElement;
  const $ = (id) => document.getElementById(id);
  let port = null, ed = null, locale = 'en', quiet = false, words = 0, context = {}, refused = false;
  const t = (k, v) => GZ_I18N.t(k, v, locale);
  const say = (m) => port?.postMessage(m);

  // ---- the editor --------------------------------------------------------------------------------------------------
  // lib/writer-editor.js (GZ_WRITER_EDITOR) over lib/writer-schema.js: compose holds exactly what Ultra's Quill keeps.

  // ---- look, words and size ----------------------------------------------------------------------------------------
  const TOKEN = /^--gz-[a-z0-9-]{1,40}$/;
  const look = (l = {}) => {
    for (const [k, v] of Object.entries(l.tokens || {})) if (TOKEN.test(k) && typeof v === 'string' && v.length < 400 && !/url\(|[;{}<>]/i.test(v)) root.style.setProperty(k, v);
    root.toggleAttribute('data-dark', !!l.dark);
    root.toggleAttribute('data-glass', !!l.glass);
    root.dataset.motion = ['off', 'subtle', 'expressive'].includes(l.motion) ? l.motion : 'subtle';
  };
  const LABELS = { bold: 'Bold', italic: 'Italic', underline: 'Underline', link: 'Link', bulletList: 'List', quote: 'Quote' };
  const count = () => { if (hooks.count.length) { emit('count', words); return; } $('words').textContent = ed ? t('Word count: {n}', { n: words }) : ''; };
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
    let at = null;
    try { at = s.empty ? null : s.coords; } catch { /* not laid out */ }
    if (!at || !writing()) { hide(tb); return; }
    for (const b of tb.querySelectorAll('[data-run]')) b.classList.toggle('on', !!(b.dataset.run === 'bulletList' ? s.active.list === 'bullet' : s.active[b.dataset.run]));
    show(tb);
    const w = tb.offsetWidth, h = tb.offsetHeight, bar = document.querySelector('.gw-bar').getBoundingClientRect().top;
    // Above the selection where it fits, so the next line stays in view; below it on the first lines.
    let top = at.top - h - 10;
    if (top < 3) top = Math.min(at.bottom + 10, bar - h - 4);
    tb.style.left = `${Math.max(3, Math.min(at.left - 4, innerWidth - w - 3))}px`;
    tb.style.top = `${Math.max(3, top)}px`;
  };
  tb.addEventListener('mousedown', (e) => { if (e.target !== href) e.preventDefault(); });
  tb.addEventListener('click', (e) => {
    const b = e.target.closest('[data-run]');
    if (!b || !ed) return;
    if (b.dataset.run === 'quote') { const { from, to } = ed.view.state.selection; ed.run('quote', { text: ed.view.state.doc.textBetween(from, to, '\n') }); return; }
    if (b.dataset.run !== 'link') { ed.run(b.dataset.run); return; }
    if (ed.active().link) { ed.run('link', null); return; }
    tb.classList.add('linking');
    href.hidden = false;
    href.value = '';
    href.removeAttribute('aria-invalid');
    href.focus();
  });
  href.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault();
    // The link command takes what the schema's href() keeps; https:// goes only before an address with no scheme (a
    // colon before a port is none). Anything else leaves the field open, marked.
    const v = href.value.trim();
    if (e.key === 'Enter' && v && !ed.run('link', v) && !(!/^[a-z][a-z\d+.-]*:(?!\d)/i.test(v) && ed.run('link', `https://${v.replace(/^\/+/, '')}`))) { href.setAttribute('aria-invalid', 'true'); return; }
    unlink();
    ed.focus();
  });
  href.addEventListener('input', () => href.removeAttribute('aria-invalid'));
  href.addEventListener('blur', () => { unlink(); hide(tb); });
  const shut = (back) => { hide(menu); more.setAttribute('aria-expanded', 'false'); if (back) more.focus(); };
  const placeMenu = () => {
    const r = more.getBoundingClientRect();
    menu.style.right = `${Math.max(3, Math.min(innerWidth - r.right, innerWidth - menu.offsetWidth - 3))}px`;
    menu.style.bottom = `${innerHeight - r.top + 6}px`;
  };
  addEventListener('resize', () => { if (selected) onSelection(selected); if (!menu.hidden) placeMenu(); });
  more.addEventListener('click', () => {
    if (!menu.hidden) { shut(); return; }
    more.setAttribute('aria-expanded', 'true');
    show(menu);
    placeMenu();
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
    if (quiet || c.docChanged === false) return;
    // A paper stays in Writer's storage (writer-paper.js): the page hears compose's changes only.
    if (root.dataset.mode === 'compose') say({ type: 'change', html: c.html, text: c.text, words: c.words, delta: ed?.view ? GZ_WRITER_SCHEMA.delta(ed.view.state.doc) : null });
    emit('change', c);
  };
  const ON = {
    init: (m) => {
      if (ed || refused) return;
      look(m.look);
      root.dataset.mode = m.mode === 'paper' ? 'paper' : 'compose';
      root.dataset.kind = typeof m.kind === 'string' ? m.kind : '';
      context = m.context && typeof m.context === 'object' ? m.context : {};
      const html = typeof m.html === 'string' ? m.html : '';
      // A box holding what Writer can't keep (an attachment, a table, maths, right-to-left text, a checklist, too much
      // to load) stays Blackboard's: said before the editor exists, so nothing is ever written back.
      let lost;
      try { lost = GZ_WRITER_SCHEMA.loses(root.dataset.mode === 'paper' ? GZ_WRITER_SCHEMA.paper : GZ_WRITER_SCHEMA.compose, html); } catch { lost = ['error']; }
      if (lost.length) { refused = true; say({ type: 'native', reason: lost.join(' ') }); return; }
      ed = GZ_WRITER_EDITOR.create({ mount: $('body'), mode: root.dataset.mode, html, selection: m.selection, placeholder: typeof m.placeholder === 'string' ? m.placeholder : '', onChange, onSelection, plugins: plugins.splice(0),
        keys: { 'Mod-Enter': () => { say({ type: 'send' }); return true; } } });
      words = ed.words();
      lang(m.locale);
      emit('ready', ed, m);
      height(); // after the parts' ready: a paper's shows its compact box or its pages (writer-paper.js)
    },
    look: (m) => { look(m.look); emit('look', m.look); },
    context: (m) => { context = m.context && typeof m.context === 'object' ? m.context : {}; emit('context', context); },
    focus: () => ed?.focus(),
    html: (m) => {
      if (!ed || typeof m.html !== 'string') return;
      quiet = true;
      try { ed.setHTML(m.html); } finally { quiet = false; }
      words = ed.words();
      count();
    },
  };
  // What later parts of the frame (proofing, targets, AI) build on: each is its own script after this one in writer.html.
  // on(event, fn): 'count' (words; owns the target slot), 'ready' (editor, init), 'change' (onChange's report), 'context' (context), 'look' (look); handle(type, fn)
  // takes a page → frame message type this file doesn't; plugin(p) adds a ProseMirror plugin (before the editor exists, it
  // goes in at create); slot(name) is a bottom-bar or toolbar slot; item(label, fn) adds a ⋯ menu entry.
  const hooks = { ready: [], change: [], context: [], look: [], count: [] }, plugins = [];
  const emit = (ev, ...a) => { for (const fn of hooks[ev]) try { fn(...a); } catch (e) { console.error(e); } };
  globalThis.GZ_WRITER_FRAME = {
    editor: () => ed, context: () => context, say, t, mode: () => root.dataset.mode, kind: () => root.dataset.kind,
    on: (ev, fn) => { if (hooks[ev] && typeof fn === 'function') hooks[ev].push(fn); },
    handle: (type, fn) => { if (typeof type === 'string' && !Object.hasOwn(ON, type) && typeof fn === 'function') ON[type] = fn; },
    plugin: (p) => { if (ed) ed.addPlugins([p]); else plugins.push(p); },
    slot: (name) => document.querySelector(`.slot[data-slot="${CSS.escape(name)}"]`),
    item: (text, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = text;
      b.addEventListener('click', () => { shut(); fn(); });
      menu.append(b); // after Blackboard editor, the mockup's first entry
      return b;
    },
  };

  // One box per frame, and only with the one-use pass the page's Glaze got from the worker for this tab before it opened
  // the frame: a site that frames this page itself can't get one, since web pages can't message the worker.
  let taken = false;
  addEventListener('message', async (e) => {
    const p = e.ports?.[0], m = e.data;
    if (taken || !p || m?.type !== 'glaze:writer' || typeof m.pass !== 'string') return;
    const ok = await Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'claim', pass: m.pass })).then((r) => r?.ok === true, () => false);
    if (!ok || taken) { p.close(); return; }
    taken = true;
    // The page swaps in the editor as soon as it hears ready; typing must start with the student's saved preferences.
    await globalThis.GZ_WRITER_SETTINGS?.load?.();
    port = p;
    port.onmessage = ({ data }) => { if (data && typeof data.type === 'string' && Object.hasOwn(ON, data.type)) ON[data.type](data); };
    say({ type: 'ready' });
    px = 0;
    height();
  });
  // An iframe can first load an inherited about:blank/srcdoc document. The host waits for this signal from Writer's
  // exact extension origin before creating its one-use job. Announce after every script has registered its hooks.
  const announce = () => {
    try {
      const host = new URL(location.href).searchParams.get('host'), url = new URL(host);
      if (/^https?:$/.test(url.protocol) && url.origin === host && parent !== globalThis) parent.postMessage({ type: 'glaze:writer:hello' }, host);
    } catch { /* a standalone Writer or a missing parent origin has no host to announce to */ }
  };
  if (document.readyState === 'complete') announce();
  else addEventListener('load', () => setTimeout(announce, 0), { once: true });
})();
