// Slide decks on the Documents page (papers.html). Settings → Writer → Slides (writer.slides, its default in defaults.js) permits
// importing .pptx and .ppsx files; existing decks always remain available for viewing. Documents of the slides kind
// (lib/doc-kinds.js), each card showing slide 1, and open in a viewer: a rail of thumbnails, the slide (lib/slides-render.js
// on lib/pptx.js's model), zoom, find in the slides' and notes' text, the speaker notes, and Present (a dialog, full screen
// where the browser allows, Rimeward's keys, hidden slides skipped). Its chrome wears the Look; the slide stays as authored.
// Export gives back the bytes imported. A viewer, never an editor: the record only changes by the page's rename.
// Storage (STORE): the deck's bytes as base64 in the paper record, within the record's 4 MB. The worker-owned blob store
// (glaze-docs, built with sheets) replaces STORE.put and STORE.get with a reference; nothing else reads or writes the bytes.
(() => {
  const DK = globalThis.GZ_DOC_KINDS;
  const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return globalThis.navigator?.language || 'en'; } })();
  // lib/i18n.js's GZ_I18N is a page-wide const, not a property of the window.
  // An assignment's frame says its words in the page's language (writer.js t).
  let words = null;
  const t = (k, v) => (words ? words(k, v) : typeof GZ_I18N !== 'undefined' ? GZ_I18N.t(k, v, locale) : k);
  const LIBS = ['lib/doctext.js', 'lib/pptx.js', 'lib/pptx-geom.js', 'lib/slides-render.js'];
  const need = (files) => GZ_WRITER_PAPER.need(files);
  // What the page says when it refuses a deck (papers.js translates them).
  const SAYS = { size: 'Choose a PowerPoint file smaller than 3 MB.', read: 'That file could not be read as a PowerPoint presentation.' };
  const MIME = { '.pptx': DK.KINDS.slides.mime, '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow' };

  // ---- storage: the one place the deck's bytes go in and come out
  const b64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const STORE = {
    max: 3e6, // base64 of 3 MB is the record's 4 MB
    put: (bytes, ext) => {
      if (!(bytes?.length <= STORE.max)) throw new RangeError(SAYS.size);
      return { file: b64(bytes), size: bytes.length, ext: String(ext || '').toLowerCase() === '.ppsx' ? '.ppsx' : '.pptx' };
    },
    get: (rec) => {
      if (typeof rec?.file !== 'string' || !rec.file.length || rec.file.length > 4 * Math.ceil(STORE.max / 3)) return null;
      try { const bytes = unb64(rec.file); return bytes.length <= STORE.max ? bytes : null; } catch { return null; }
    },
  };
  let store = null;
  const papers = () => (store ||= GZ_WRITER_PAPERS.open());
  // What a copy keeps besides the copy's own title and dates: the deck and what was read from it.
  const OWN = ['file', 'size', 'ext', 'slides', 'text', 'thumb'];
  const copy = (rec) => Object.fromEntries(OWN.filter((k) => rec?.[k] !== undefined).map((k) => [k, rec[k]]));
  const text = (rec) => (typeof rec?.text === 'string' ? rec.text : '');
  const measure = (rec) => {
    const s = text(rec);
    return { slides: Number.isSafeInteger(rec?.slides) ? rec.slides : 0, chars: s.replace(/\s+/g, ' ').trim().length, words: s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length };
  };

  // ---- reading a deck
  const R = () => globalThis.GZ_SLIDES_RENDER;
  const LABELS = () => ({ chart: t('Chart'), smartart: t('Diagram'), ole: t('Object'), picture: t('Picture'), media: t('Video'), table: t('Table'), broken: '', other: '' });
  // The slides' and notes' text, for search (bounded as the home bounds a paper's).
  const textOf = (deck) => deck.slides.map((s) => [R().text(s), s.notes].filter(Boolean).join('\n')).filter(Boolean).join('\n').slice(0, 2e5);
  // The pictures a slide draws, by part.
  const mediaOf = (slide) => {
    const out = new Set();
    const walk = (s) => {
      if (s.media?.path) out.add(s.media.path);
      if (s.fill?.media?.path) out.add(s.fill.media.path);
      for (const p of s.text?.paragraphs || []) if (p.bullet?.picture?.path) out.add(p.bullet.picture.path);
      for (const c of s.shapes || []) walk(c);
    };
    for (const s of slide?.shapes || []) walk(s);
    if (slide?.background?.media?.path) out.add(slide.background.media.path);
    return out;
  };
  // Pictures as blob: URLs, kept until the page goes.
  const made = new Set();
  const blobs = async (bytes, deck, paths, inline = false) => {
    const out = new Map();
    for (const m of deck.media) {
      if (!paths.has(m.path)) continue;
      const b = await GZ_PPTX.media(bytes, m.path).catch(() => null);
      if (!b) continue;
      const url = inline ? `data:${m.mime};base64,${b64(b)}` : URL.createObjectURL(new Blob([b], { type: m.mime }));
      if (!inline) made.add(url);
      out.set(m.path, url);
    }
    return out;
  };
  globalThis.addEventListener?.('pagehide', (e) => { if (e.persisted) return; for (const u of made) URL.revokeObjectURL(u); made.clear(); });

  // ---- the card's picture: slide 1, drawn once as the deck is imported and kept in its record (the deck never changes
  // after); a record without one (a browser that won't draw a page's markup into a picture) draws slide 1 live.
  const THUMB = 208; // CSS px wide in the card
  const FILES = { carlito: 'carlito', arimo: 'arimo', tinos: 'tinos', cousine: 'cousine' };
  const FAMILY = { carlito: 'Calibri', arimo: 'Arial', tinos: 'Times New Roman', cousine: 'Courier New' };
  const fonts = new Map();
  const fontData = (file) => {
    if (!fonts.has(file)) fonts.set(file, fetch(chrome.runtime.getURL(`lib/fonts/${file}.woff2`)).then((r) => r.arrayBuffer()).then((b) => `data:font/woff2;base64,${b64(new Uint8Array(b))}`));
    return fonts.get(file);
  };
  // The bundled faces a slide's text uses, as @font-face rules a picture of it can carry.
  const faces = async (slide) => {
    const used = new Set();
    const walk = (s) => {
      const bodies = [s.text, ...(s.rows || []).flatMap((r) => r.cells.map((c) => c.text))].filter(Boolean);
      for (const b of bodies) for (const p of b.paragraphs) for (const f of [p.bullet?.font, ...p.runs.map((r) => r.font)]) if (f?.face && FILES[f.face]) used.add(f.face);
      for (const c of s.shapes || []) walk(c);
    };
    for (const s of slide.shapes) walk(s);
    const rules = [];
    for (const face of used) {
      for (const [w, st] of [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']]) {
        const url = await fontData(`${FILES[face]}-${w}-${st}`).catch(() => null);
        if (url) rules.push(`@font-face{font-family:"${FAMILY[face]}";src:url(${url}) format("woff2");font-weight:${w};font-style:${st}}`);
      }
    }
    return rules.join('');
  };
  // Slide 1 as a JPEG data URL twice the card's width, or null where the browser won't draw it.
  const picture = async (deck, bytes) => {
    const s = deck.slides[0], Rr = R();
    if (!s || typeof XMLSerializer !== 'function') return null;
    const w = Rr.px(deck.size.w), h = Rr.px(deck.size.h), W = 2 * THUMB, H = Math.round((h / w) * W);
    const media = new Map();
    for (const m of deck.media) {
      if (!mediaOf(s).has(m.path)) continue;
      const b = await GZ_PPTX.media(bytes, m.path).catch(() => null);
      if (b) media.set(m.path, `data:${m.mime};base64,${b64(b)}`);
    }
    const el = Rr.slide(s, deck, { document, media, labels: LABELS() });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${w} ${h}"><style>${await faces(s)}</style>`
      + `<foreignObject x="0" y="0" width="${w}" height="${h}">${new XMLSerializer().serializeToString(el)}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, W, H);
    x.drawImage(img, 0, 0, W, H);
    return c.toDataURL('image/jpeg', 0.85);
  };
  const thumb = (rec) => {
    const box = document.createElement('div');
    box.className = 'gs-thumb';
    if (typeof rec?.thumb === 'string' && /^data:image\/(?:jpeg|png);base64,/.test(rec.thumb)) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = rec.thumb;
      box.append(img);
      return box;
    }
    (async () => {
      await need(LIBS);
      const bytes = STORE.get(rec), deck = bytes && await GZ_PPTX.read(bytes).catch(() => null), s = deck?.slides[0];
      if (!s) return;
      // Cards can be discarded and redrawn while the page lives; their images own no blob URLs.
      const media = await blobs(bytes, deck, mediaOf(s), true);
      box.replaceChildren(R().stage(s, deck, { document, media, labels: LABELS(), scale: THUMB / R().px(deck.size.w) }));
    })().catch((e) => console.warn(e));
    return box;
  };

  // ---- import and export
  const stem = (name) => (globalThis.GZ_DOC_HOME ? GZ_DOC_HOME.stem(name) : String(name || '').replace(/\.[^./\\]+$/, '').trim().slice(0, 120));
  // A deck as a new standalone document, titled by its file's name. → its key.
  const importFile = async (file) => {
    if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > STORE.max) throw new RangeError(SAYS.size);
    await need(LIBS);
    const raw = await file.arrayBuffer();
    if (!(raw instanceof ArrayBuffer) || raw.byteLength !== file.size) throw new Error('invalid file read');
    const bytes = new Uint8Array(raw);
    const deck = await GZ_PPTX.read(bytes).catch(() => null);
    if (!deck?.slides.length) throw new RangeError(SAYS.read);
    const thumbUrl = await picture(deck, bytes).catch(() => null), words = textOf(deck), title = stem(file.name);
    const key = GZ_WRITER_PAPERS.newKey();
    await papers().save(key, { kind: 'slides', ...STORE.put(bytes, /\.ppsx$/i.test(file.name) ? '.ppsx' : '.pptx'), slides: deck.slides.length, text: words,
      words: measure({ text: words }).words, ...(thumbUrl && { thumb: thumbUrl }), named: !!title, title }, { reason: 'import' });
    return key;
  };
  // A deck as its file: the bytes imported, named by its title. → { name, mime, bytes } or null.
  const file = async (key) => {
    const rec = await papers().get(key), bytes = STORE.get(rec);
    if (!bytes) return null;
    const ext = rec.ext === '.ppsx' ? '.ppsx' : '.pptx', name = String(rec.title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || t('Slides');
    return { name: `${name}${ext}`, mime: MIME[ext], bytes };
  };
  let exported = null;
  const exportFile = async (key) => {
    const f = await file(key);
    if (!f) return;
    if (exported) { URL.revokeObjectURL(exported); made.delete(exported); }
    exported = URL.createObjectURL(new Blob([f.bytes], { type: f.mime }));
    made.add(exported);
    const a = document.createElement('a');
    a.href = exported;
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
  };

  // ---- the viewer
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
  const PATHS = { prev: 'm15 18-6-6 6-6', next: 'm9 18 6-6-6-6', minus: 'M5 12h14', plus: 'M12 5v14M5 12h14', up: 'm18 15-6-6-6 6', down: 'm6 9 6 6 6-6',
    present: 'M3 4h18v12H3zM12 16v4M8 20h8M10 8l4 2-4 2z', dots: 'M5 12h.01M12 12h.01M19 12h.01' };
  const icon = (name) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'gs-ico'); s.setAttribute('aria-hidden', 'true');
    p.setAttribute('d', PATHS[name]);
    s.append(p);
    return s;
  };
  const isField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  // Text with each match of the find term in a mark.
  const markInto = (el, s, term) => {
    el.replaceChildren();
    if (!term) { el.textContent = s; return; }
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    let at = 0;
    for (const m of s.matchAll(re)) {
      if (m.index > at) el.append(s.slice(at, m.index));
      el.append(h('mark', { class: 'gs-hit', text: m[0] }));
      at = m.index + m[0].length;
    }
    if (at < s.length) el.append(s.slice(at));
  };
  const ZOOMS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const NOTES = 'gz-slides-notes', PAD = 24, RAIL = 144;

  // host: an assignment's frame (writer-kinds.js view): { mount, t, title, tools }, the viewer in mount with the
  // assignment's title and the frame's tools (Submit…) before ⋯, no way back to Documents; → its surface.
  // o: papers.js's { fresh } (a kind that opens a new document empty), or view's { host }.
  const edit = async (key, { host = null } = {}) => {
    const root = document.documentElement;
    const life = new AbortController(), signal = life.signal;
    if (host) words = host.t || null; else root.dataset.mode = 'slides';
    await need(LIBS);
    const rec = await papers().get(key).catch(() => null), bytes = STORE.get(rec);
    const deck = bytes ? await GZ_PPTX.read(bytes).catch((e) => { console.warn(e); return null; }) : null;
    const Rr = R(), labels = LABELS(), title = host?.title?.() || rec?.title || t('Untitled document'), n = deck ? deck.slides.length : 0;
    const media = deck ? await blobs(bytes, deck, new Set(deck.media.map((m) => m.path))) : new Map();
    let cur = 0, zoom = 'fit', term = '', hits = [], hit = -1, menu = null, showing = null;
    let notesOpen = false;
    try { notesOpen = localStorage.getItem(NOTES) === 'on'; } catch { /* storage can be unavailable */ }

    // ---- the chrome: Documents and the title; the slide's place, zoom, find, notes, Present and ⋯
    const prevB = btn({ id: 'gs-prev', class: 'gs-btn', 'aria-label': t('Previous'), title: t('Previous') }, icon('prev'));
    const atEl = h('span', { id: 'gs-at', class: 'gs-at' });
    const nextB = btn({ id: 'gs-next', class: 'gs-btn', 'aria-label': t('Next'), title: t('Next') }, icon('next'));
    const outB = btn({ id: 'gs-zoom-out', class: 'gs-btn', 'aria-label': t('Zoom out'), title: t('Zoom out') }, icon('minus'));
    const zoomB = btn({ id: 'gs-zoom', class: 'gs-btn gs-zoom', title: t('Zoom') });
    const inB = btn({ id: 'gs-zoom-in', class: 'gs-btn', 'aria-label': t('Zoom in'), title: t('Zoom in') }, icon('plus'));
    const q = h('input', { id: 'gs-find-q', type: 'search', 'aria-label': t('Find'), placeholder: t('Find'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    const findN = h('span', { id: 'gs-find-n', class: 'gs-find-n', 'aria-live': 'polite' });
    const findPrev = btn({ id: 'gs-find-prev', class: 'gs-btn', 'aria-label': t('Previous'), title: t('Previous') }, icon('up'));
    const findNext = btn({ id: 'gs-find-next', class: 'gs-btn', 'aria-label': t('Next'), title: t('Next') }, icon('down'));
    const notesB = btn({ id: 'gs-notes', class: 'gs-btn gs-label', 'aria-pressed': String(notesOpen) }, t('Notes'));
    const presentB = btn({ id: 'gs-present', class: 'gs-btn gs-label gs-go' }, icon('present'), h('span', { text: t('Present') }));
    const moreB = btn({ class: 'gs-btn gs-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('More'), title: t('More') }, icon('dots'));
    const canvasEl = h('div', { id: 'gs-canvas', class: 'gs-canvas', role: 'tabpanel', tabindex: '0' });
    const notesEl = h('section', { id: 'gs-notes-pane', class: 'gs-notes', 'aria-label': t('Notes'), hidden: !notesOpen });
    const list = h('ol', { class: 'gs-rail-list', role: 'tablist', 'aria-label': t('Slides'), 'aria-orientation': 'vertical' });
    const railEl = h('nav', { id: 'gs-rail', class: 'gs-rail', 'aria-label': t('Slides') }, list);
    const rail = (deck?.slides || []).map((s, i) => {
      const name = t('Slide {n}', { n: i + 1 });
      const b = btn({ class: 'gs-rail-b', role: 'tab', id: `gs-tab-${i}`, tabindex: '-1', 'aria-controls': 'gs-canvas', 'data-slide': String(i), 'data-hidden': s.hidden, 'aria-label': s.hidden ? `${name} (${t('Hidden')})` : name, onclick: () => show(i) },
        h('span', { class: 'gs-rail-n', text: String(i + 1) }), h('span', { class: 'gs-rail-pic' }));
      list.append(h('li', { role: 'presentation' }, b));
      return b;
    });
    const view = h('div', { class: 'gp gp-standalone gs-view' },
      h('header', { class: 'gp-top' }, host ? null : h('a', { href: 'papers.html', text: t('Documents') }), h('h1', { text: title }), h('span', { class: 'grow' }), h('span', { class: 'gp-state', text: deck ? t('{n} slides', { n }) : '' })),
      h('div', { class: 'gs-tool' }, h('div', { class: 'gs-group' }, prevB, atEl, nextB), h('div', { class: 'gs-group' }, outB, zoomB, inB),
        h('div', { class: 'gs-find', role: 'search' }, q, findN, findPrev, findNext), h('span', { class: 'grow' }), notesB, presentB, ...(host?.tools || []), moreB),
      h('div', { class: 'gs-work' }, railEl, h('div', { class: 'gs-main' }, canvasEl, notesEl)));
    (host?.mount || document.body).append(view);
    if (!deck) {
      canvasEl.append(h('p', { class: 'gs-said', role: 'status', text: t(SAYS.read) }));
      for (const b of [prevB, nextB, outB, zoomB, inB, q, findPrev, findNext, notesB, presentB]) b.disabled = true;
    }

    // ---- the slide: drawn at the zoom, its find marks, its notes
    const fitScale = () => Rr.fit(deck.size, Math.max(1, canvasEl.clientWidth - 2 * PAD), Math.max(1, canvasEl.clientHeight - 2 * PAD));
    const scale = () => (zoom === 'fit' ? fitScale() : zoom);
    const rescale = () => {
      const k = scale(), st = showing;
      if (!st || !(k > 0)) return;
      st.style.setProperty('width', `${Rr.px(deck.size.w) * k}px`);
      st.style.setProperty('height', `${Rr.px(deck.size.h) * k}px`);
      st.firstChild.style.setProperty('transform', `scale(${Math.round(k * 1e4) / 1e4})`);
    };
    const draw = () => {
      if (!deck) return;
      const s = deck.slides[cur];
      showing = Rr.stage(s, deck, { document, media, labels, find: term, scale: scale() || 0.5 });
      showing.setAttribute('role', 'group');
      showing.setAttribute('aria-label', t('Slide {n}', { n: cur + 1 }));
      canvasEl.replaceChildren(showing);
      markInto(notesEl, s.notes || '', term);
      atEl.textContent = `${cur + 1} / ${n}`;
      prevB.disabled = cur === 0;
      nextB.disabled = cur === n - 1;
      zoomB.textContent = zoom === 'fit' ? t('Fit') : `${Math.round(zoom * 100)}%`;
      for (const [i, b] of rail.entries()) {
        b.setAttribute('aria-current', String(i === cur));
        b.setAttribute('aria-selected', String(i === cur));
        b.tabIndex = i === cur ? 0 : -1;
      }
      canvasEl.setAttribute('aria-labelledby', `gs-tab-${cur}`);
      rail[cur]?.scrollIntoView({ block: 'nearest' });
      findN.textContent = !term ? '' : hits.length ? t('{n} of {m}', { n: hit + 1, m: hits.length }) : t('No results');
      const x = hits[hit];
      if (x && x.slide === cur) {
        const groups = new Map();
        for (const m of canvasEl.querySelectorAll('mark.gs-hit')) {
          const id = m.getAttribute('data-gs-hit');
          if (!groups.has(id)) groups.set(id, []);
          groups.get(id).push(m);
        }
        const marks = [...groups.values(), ...[...notesEl.querySelectorAll('mark.gs-hit')].map((m) => [m])][x.nth];
        if (marks?.length) {
          for (const m of marks) m.classList.add('gs-hit-cur');
          if (notesEl.contains(marks[0]) && !notesOpen) setNotes(true);
          marks[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
    };
    const show = (i) => { if (!deck) return; const to = Math.max(0, Math.min(n - 1, i)); if (to === cur && showing) return; cur = to; draw(); };
    const sizing = new ResizeObserver(() => { if (zoom === 'fit') rescale(); });
    sizing.observe(canvasEl);

    // ---- the rail: each thumbnail drawn as it nears the view
    const drawn = new Set();
    const near = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number(e.target.dataset.slide);
        if (drawn.has(i)) continue;
        drawn.add(i);
        near.unobserve(e.target);
        e.target.querySelector('.gs-rail-pic').append(Rr.stage(deck.slides[i], deck, { document, media, labels, scale: RAIL / Rr.px(deck.size.w) }));
      }
    }, { root: railEl, rootMargin: '100% 0px' });
    for (const b of rail) near.observe(b);

    railEl.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const to = { ArrowDown: cur + 1, ArrowRight: cur + 1, ArrowUp: cur - 1, ArrowLeft: cur - 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault(); e.stopPropagation();
      show(to);
      rail[cur]?.focus({ preventScroll: true });
    });

    // ---- zoom: Fit, or the next step either way from what shows
    const step = (dir) => {
      const k = scale(), next = dir > 0 ? ZOOMS.find((z) => z > k + 1e-3) : [...ZOOMS].reverse().find((z) => z < k - 1e-3);
      zoom = next ?? (dir > 0 ? ZOOMS[ZOOMS.length - 1] : ZOOMS[0]);
      draw();
    };
    inB.addEventListener('click', () => step(1));
    outB.addEventListener('click', () => step(-1));
    zoomB.addEventListener('click', () => { zoom = 'fit'; draw(); });
    prevB.addEventListener('click', () => show(cur - 1));
    nextB.addEventListener('click', () => show(cur + 1));

    // ---- find: every match in the slides' text and then their notes, in order; Enter and Shift+Enter walk them
    const search = () => {
      term = q.value.trim();
      hits = [];
      if (term && deck) {
        deck.slides.forEach((s, i) => {
          const a = Rr.count(Rr.text(s), term), b = Rr.count(s.notes || '', term);
          for (let k = 0; k < a + b; k++) hits.push({ slide: i, nth: k });
        });
      }
      hit = hits.length ? 0 : -1;
      if (hit >= 0) cur = hits[0].slide;
      draw();
    };
    const walk = (by) => { if (!hits.length) return; hit = (hit + by + hits.length) % hits.length; cur = hits[hit].slide; draw(); };
    q.addEventListener('input', search);
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); walk(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); q.value = ''; search(); canvasEl.focus({ preventScroll: true }); }
    });
    findNext.addEventListener('click', () => walk(1));
    findPrev.addEventListener('click', () => walk(-1));

    // ---- notes: shown or not, remembered on this device
    // keep: the student's own choice, kept for the next deck (a find match in the notes opens them for this visit only).
    const setNotes = (on, keep) => {
      notesOpen = on;
      notesEl.hidden = !on;
      notesB.setAttribute('aria-pressed', String(on));
      if (keep) try { localStorage.setItem(NOTES, on ? 'on' : 'off'); } catch { /* the choice lasts this visit */ }
    };
    notesB.addEventListener('click', () => setNotes(!notesOpen, true));

    // ---- Present: the slides a show plays, one at a time over the whole screen. Its keys are Rimeward's notebook slides'
    // (MIT, the same author): → ↓ Page Down Space next, ← ↑ Page Up back, Home and End; Esc ends it, as does leaving full screen.
    let presenting = null;
    const present = () => {
      const seq = Rr.visible(deck);
      if (!seq.length || presenting) return;
      let i = Math.max(0, seq.findIndex((x) => x >= cur));
      // The slide holds the focus, so Space and the arrows turn slides; a button the student tabs to presses as a button.
      const frame = h('div', { class: 'gs-present-frame', tabindex: '-1' }), counter = h('span', { class: 'gs-present-n', 'aria-live': 'polite' });
      const dialog = h('dialog', { class: 'gs-present', 'aria-label': title });
      const paint = () => {
        const st = Rr.stage(deck.slides[seq[i]], deck, { document, media, labels, scale: Rr.fit(deck.size, innerWidth, innerHeight) });
        st.setAttribute('role', 'group');
        st.setAttribute('aria-label', t('Slide {n}', { n: seq[i] + 1 }));
        frame.replaceChildren(st);
        counter.textContent = `${i + 1} / ${seq.length}`;
      };
      const go = (by) => { const to = Math.max(0, Math.min(seq.length - 1, i + by)); if (to !== i) { i = to; paint(); } };
      const NEXT = ['ArrowRight', 'ArrowDown', 'PageDown', ' '], BACK = ['ArrowLeft', 'ArrowUp', 'PageUp'];
      let full = false;
      const left = () => { if (full && !document.fullscreenElement) dialog.close(); full = !!document.fullscreenElement; };
      dialog.append(frame, h('div', { class: 'gs-present-bar' }, btn({ class: 'gs-btn', 'aria-label': t('Previous'), title: t('Previous'), onclick: () => go(-1) }, icon('prev')), counter,
        btn({ class: 'gs-btn', 'aria-label': t('Next'), title: t('Next'), onclick: () => go(1) }, icon('next')), btn({ class: 'gs-btn gs-label', onclick: () => dialog.close() }, t('Exit presentation'))));
      frame.addEventListener('click', () => go(1));
      dialog.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') {
          const buttons = [...dialog.querySelectorAll('button')], at = buttons.indexOf(document.activeElement);
          if ((!e.shiftKey && at === buttons.length - 1) || (e.shiftKey && at <= 0)) {
            e.preventDefault(); buttons[e.shiftKey ? buttons.length - 1 : 0].focus();
          }
        }
        if (e.key === ' ' && e.target.closest?.('button')) return;
        if (NEXT.includes(e.key)) { e.preventDefault(); go(1); }
        if (BACK.includes(e.key)) { e.preventDefault(); go(-1); }
        if (e.key === 'Home') { e.preventDefault(); go(-seq.length); }
        if (e.key === 'End') { e.preventDefault(); go(seq.length); }
      });
      dialog.addEventListener('close', () => {
        presenting = null;
        removeEventListener('resize', paint);
        document.removeEventListener('fullscreenchange', left);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        dialog.remove();
        show(seq[i]);
        presentB.focus();
      });
      document.body.append(dialog);
      paint();
      dialog.showModal();
      frame.focus({ preventScroll: true });
      presenting = dialog;
      addEventListener('resize', paint);
      document.addEventListener('fullscreenchange', left);
      document.documentElement.requestFullscreen?.().then(() => { full = true; }, () => {});
    };
    presentB.addEventListener('click', present);

    // ---- ⋯: Export .pptx
    const closeMenu = (back) => { if (!menu) return; menu.remove(); menu = null; moreB.setAttribute('aria-expanded', 'false'); if (back) moreB.focus(); };
    const openMenu = () => {
      menu = h('div', { class: 'pop gp-menu gs-menu', role: 'menu', 'aria-label': t('More') },
        btn({ role: 'menuitem', tabindex: '-1', 'data-act': 'export', disabled: !bytes, onclick: () => { closeMenu(true); exportFile(key).catch((e) => console.warn(e)); } }, t('Export .pptx')));
      document.body.append(menu);
      const r = moreB.getBoundingClientRect();
      menu.style.setProperty('left', `${Math.max(4, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 4))}px`);
      menu.style.setProperty('top', `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 4)}px`);
      menu.style.setProperty('transform-origin', 'top right');
      menu.addEventListener('keydown', (e) => {
        const all = [...menu.querySelectorAll('[role="menuitem"]')], at = all.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length]?.focus(); }
      });
      menu.getBoundingClientRect();
      menu.setAttribute('data-open', '');
      moreB.setAttribute('aria-expanded', 'true');
      menu.querySelector('[role="menuitem"]').focus();
    };
    moreB.addEventListener('click', () => { if (menu) closeMenu(true); else openMenu(); });
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.contains(e.target) && !moreB.contains(e.target)) closeMenu(); }, { capture: true, signal });

    // ---- keys: the slides by arrows, Page Up and Down, Home and End; Ctrl+F finds
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || presenting || menu || !deck) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); q.focus(); q.select(); return; }
      if (isField(e.target) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const to = { ArrowRight: cur + 1, ArrowDown: cur + 1, PageDown: cur + 1, ArrowLeft: cur - 1, ArrowUp: cur - 1, PageUp: cur - 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      show(to);
    }, { signal });

    draw();
    globalThis.GZ_PAPERS_MOTION?.shown('paper');
    // What an assignment's submit sheet sends (writer-submit.js): the deck as it was brought.
    return { pages: () => null, say: () => {}, ready: () => !!deck, save: async () => true,
      dispose: () => {
        life.abort(); sizing.disconnect(); near.disconnect(); closeMenu(); presenting?.close();
        for (const u of media.values()) { URL.revokeObjectURL(u); made.delete(u); }
      },
      file: async () => { const f = await file(key); if (!f) throw new Error('no file'); return { bytes: f.bytes, mime: f.mime, ext: rec?.ext === '.ppsx' ? '.ppsx' : '.pptx' }; } };
  };
  // A deck brought to an assignment (Open in Glaze, writer-kinds.js): the attempt's record becomes it, the paper it held
  // kept as a version first (the 'import' save), its title the assignment's. → the record.
  const into = async (key, f) => {
    if (!Number.isSafeInteger(f?.size) || f.size <= 0 || f.size > STORE.max) throw new RangeError(SAYS.size);
    await need(LIBS);
    const raw = await f.arrayBuffer();
    if (!(raw instanceof ArrayBuffer) || raw.byteLength !== f.size) throw new Error('invalid file read');
    const bytes = new Uint8Array(raw);
    const deck = await GZ_PPTX.read(bytes).catch(() => null);
    if (!deck?.slides.length) throw new RangeError(SAYS.read);
    const thumbUrl = await picture(deck, bytes).catch(() => null), words2 = textOf(deck);
    return (await papers().save(key, { kind: 'slides', doc: null, ...STORE.put(bytes, /\.ppsx$/i.test(f.name) ? '.ppsx' : '.pptx'), slides: deck.slides.length, text: words2,
      words: measure({ text: words2 }).words, ...(thumbUrl && { thumb: thumbUrl }) }, { reason: 'import' })).paper;
  };

  // Viewing stays registered; only import follows the switch, read through defaults.js as every Writer setting is (a device
  // with no stored choice gets the default). writer.html has defaults.js already; loading it twice would redeclare its
  // consts. The page waits before it routes or draws.
  const sanitizer = () => (typeof GZ_SANITIZE === 'function' ? null : GZ_WRITER_PAPER.need(['defaults.js']));
  const on = Promise.resolve().then(sanitizer).then(() => chrome.storage.sync.get('writer')).then((r) => GZ_SANITIZE({ writer: r?.writer }).writer.slides === true).catch(() => false);
  DK.wait(on.then((yes) => DK.register('slides', { edit, view: (key, host) => edit(key, { host }), into, thumb, file, exportFile, text, ...(yes && { importFile }), measure, copy, says: SAYS, exportLabel: 'Export .pptx' })));
  globalThis.GZ_SLIDES_KIND = Object.freeze({ STORE });
})();
