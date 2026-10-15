// Options page: the full editor. Every edit repaints this page and the preview frame at once.
// Sliders and colour drags save after the input rests (sync storage allows ~120 writes a minute);
// everything else saves on change.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
// In the browser's language (lib/i18n.js): this page's own text now, and every word written later.
GZ_I18N.page();
const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
// Ultra's own colour for each course slot: the picker starts there.
const DEPTH = ['Flat', 'Soft', 'Raised', 'Floating'];
const FORMAT = {
  pct: (v) => GZ_I18N.pct(Math.round(v * 100), GZ_I18N.ui()),
  pct100: (v) => GZ_I18N.pct(v, GZ_I18N.ui()),
  px: (v) => `${v}px`,
  depth: (v) => t(DEPTH[v]),
  deg: (v) => `${v}°`,
  presence: (v) => t(['Faint', 'Soft', 'Clear', 'Bold'][Math.min(3, Math.floor(v / 25))]),
  themepx: (v) => (v < 0 ? t('Theme') : `${v}px`),
};

let hintTimer = 0;
const hint = (msg, err = false) => {
  const h = $('#hint');
  h.textContent = msg;
  h.classList.toggle('err', err);
  clearTimeout(hintTimer);
  if (msg && !err) hintTimer = setTimeout(() => { h.textContent = ''; }, 2500);
};

// ---- search: each child of a section (or of a .group) is a setting. It matches on its own text,
// titles and labels, its section and group headings, and the notes it names by aria-describedby or
// aria-labelledby, which show and hide with it. Nothing here lists the settings. ----
const finder = $('#find');
const filter = () => {
  const words = GZ_FIND.parse(finder.value);
  const on = words.length > 0;
  document.body.classList.toggle('finding', on);
  const marks = [];
  const mark = (root, heading = false) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) {
      for (const [a, b] of GZ_FIND.spans(t.data, words, heading)) {
        const r = new Range();
        r.setStart(t, a);
        r.setEnd(t, b);
        marks.push(r);
      }
    }
  };
  const named = (el) => [el, ...el.querySelectorAll('[aria-describedby], [aria-labelledby]')]
    .flatMap((e) => `${e.getAttribute('aria-describedby') || ''} ${e.getAttribute('aria-labelledby') || ''}`.split(' '))
    .map((id) => id && document.getElementById(id)).filter(Boolean);
  const said = (el) => [el, ...el.querySelectorAll('[title], [aria-label], [placeholder]')]
    .map((e) => `${e.title} ${e.getAttribute('aria-label') || ''} ${e.placeholder || ''}`).join(' ');
  let n = 0;
  for (const sec of $$('.editor > section')) {
    const h2 = sec.querySelector('h2');
    const parts = [...sec.querySelectorAll(':scope > :not(h2, .group), :scope > .group > :not(h3)')];
    const notes = new Map(parts.map((el) => [el, named(el)]));
    const isNote = new Set([...notes.values()].flat());
    for (const el of isNote) el.classList.toggle('miss', on);
    let any = false;
    for (const el of parts) {
      if (isNote.has(el)) continue;
      const h3 = el.parentElement.querySelector(':scope > h3');
      const text = [el.textContent, said(el), ...notes.get(el).map((x) => x.textContent)].join(' ');
      const hit = !on || (!el.closest('[hidden]') && GZ_FIND.matches(`${h2.textContent} ${h3?.textContent || ''}`, text, words));
      el.classList.toggle('miss', !hit);
      if (!hit || !on) continue;
      any = true;
      n++;
      for (const x of [el, ...notes.get(el)]) { x.classList.remove('miss'); mark(x); }
    }
    for (const g of sec.querySelectorAll(':scope > .group')) {
      const empty = on && !g.querySelector(':scope > :not(h3, .miss)');
      g.classList.toggle('miss', empty);
      if (on && !empty) for (const h3 of g.querySelectorAll(':scope > h3')) mark(h3, true);
    }
    sec.classList.toggle('miss', on && !any);
    if (on && any) mark(h2, true);
  }
  for (const a of $$('.top nav a')) a.classList.toggle('miss', !!$(a.hash)?.classList.contains('miss'));
  if (window.Highlight) CSS.highlights.set('find', new Highlight(...marks));
  const msg = !on ? '' : n ? t('{n} settings', { n }) : t('No settings match');
  if ($('#find-status').textContent !== msg) $('#find-status').textContent = msg;
};
finder.addEventListener('input', filter);
finder.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !finder.value) return;
  e.preventDefault();
  finder.value = '';
  filter();
});
addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input:is([type="text"], [type="url"], [type="search"]), textarea, [contenteditable]')) return;
  e.preventDefault();
  finder.focus();
  finder.select();
});

// ---- what's new: once per version, after an update (lib/news.js) ----
GZ_NEWS.check((notes) => {
  GZ_NEWS.seen();
  if (!notes.length) return;
  $('#news-title').textContent = t('New in {version}', { version: notes.map(([v]) => v).join(', ') });
  $('#news-list').replaceChildren(...notes.flatMap(([, lines]) => lines).map((line) => Object.assign(document.createElement('li'), { textContent: t(line) })));
  $('#news').hidden = false;
});
$('#news-close').addEventListener('click', () => { $('#news').hidden = true; finder.focus(); });

GZ_UI.load().then((s) => {
  const frame = $('#preview');
  // A pasted theme code shows in the preview until it is used or cancelled.
  let offer = null;
  let courses = {}; // course id -> { name, slot, org }, from the content script
  const preview = () => {
    const sec = frame.contentDocument?.querySelector('section.course');
    // The mock is a course: it shows as the first course picked for tinting, in that course's color.
    const first = courses[s.courses.tinted[0]];
    if (sec && first) {
      sec.className = `course course-color-${first.slot}`;
      sec.style.cssText = Object.entries(GZ_COURSE_VARS(GZ_COURSE_COLORS(courses, s.courses.colors)[s.courses.tinted[0]])).map(([k, v]) => `${k}:${v}`).join(';');
      sec.querySelector('.pv-course').textContent = first.name;
    }
    frame.contentWindow?.postMessage({ gzPreview: offer || s }, location.origin);
    renderNav();
  };
  frame.addEventListener('load', preview);

  // ---- saving: keys touched while an input moves go out together once it rests ----
  const pending = new Set(), pendingNav = new Set();
  let timer = 0;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending.size) return;
    const navPatch = pendingNav.size ? Object.fromEntries([...pendingNav].map((k) => [k, s.nav[k]])) : undefined;
    GZ_UI.save(s, [...pending], (err) => hint(err || t('Saved'), !!err), navPatch);
    pending.clear(); pendingNav.clear();
  };
  const save = (keys, soon = false) => {
    for (const k of keys) pending.add(k);
    clearTimeout(timer);
    if (soon) timer = setTimeout(flush, 500);
    else flush();
  };
  addEventListener('pagehide', flush);

  const get = (path) => path.split('.').reduce((o, k) => o[k], s);
  const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], s)[last] = v; if (ks[0] === 'nav') pendingNav.add(last); };
  const group = (path) => path.split('.')[0];

  // ---- palette ----
  const colorInputs = {};
  for (const [v, label] of GZ_COLORS) {
    const row = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'color', title: v });
    input.addEventListener('input', () => {
      s.colors[v] = input.value;
      s.preset = GZ_MATCH_PRESET(s.colors, s.presets);
      s.auto.on = false;
      refresh();
      save(['colors', 'preset', 'auto'], true);
    });
    input.addEventListener('change', () => save(['colors', 'preset', 'auto']));
    colorInputs[v] = input;
    row.append(input, t(label));
    $('#colors').append(row);
  }

  const presetOptions = () => {
    for (const sel of [$('#auto-light'), $('#auto-dark')]) {
      sel.replaceChildren(...GZ_ALL_PRESETS(s.presets).map(([n]) => new Option(n, n)));
      sel.value = get(sel.dataset.key);
    }
  };

  const renderMine = () => {
    $('#mine').replaceChildren(...s.presets.map((p) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'swatch';
      dot.style.cssText = `background:${p.colors['--gz-surface']};border-color:${p.colors['--gz-line-strong']};--dot:${p.colors['--gz-accent']};cursor:default`;
      const name = Object.assign(document.createElement('input'), { type: 'text', value: p.name, maxLength: 40 });
      name.setAttribute('aria-label', t('Rename {name}', { name: p.name }));
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (next === p.name) return;
        if (!next || GZ_PRESET(next, s.presets)) { name.value = p.name; return hint(next ? t("There's already a palette called {name}.", { name: next }) : t('A palette needs a name.'), true); }
        for (const k of ['light', 'dark']) if (s.auto[k] === p.name) s.auto[k] = next;
        if (s.preset === p.name) s.preset = next;
        p.name = next;
        refresh();
        save(['presets', 'preset', 'auto']);
      });
      const del = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Delete'), className: 'danger' });
      del.addEventListener('click', () => {
        s.presets = s.presets.filter((q) => q !== p);
        if (s.preset === p.name) s.preset = null;
        if (s.auto.light === p.name) s.auto.light = 'Paper';
        if (s.auto.dark === p.name) s.auto.dark = 'Frost';
        refresh();
        save(['presets', 'preset', 'auto']);
      });
      li.append(dot, name, del);
      return li;
    }));
  };

  const renderContrast = () => {
    $('#contrast').replaceChildren(...GZ_CONTRAST(s.colors).map((r) => {
      const li = document.createElement('li');
      li.className = r.pass ? 'pass' : 'fail';
      li.title = t('Needs {min}:1', { min: r.min });
      const b = document.createElement('b');
      b.textContent = `${GZ_I18N.num(+r.ratio.toFixed(1), GZ_I18N.ui())}:1`;
      li.append(t(r.label), b);
      return li;
    }));
  };

  // ---- everything that follows the state, cheap enough to redo on every edit ----
  const outputs = () => {
    for (const o of $$('output[data-for]')) o.textContent = (FORMAT[o.dataset.format] || ((v) => GZ_I18N.num(v, GZ_I18N.ui())))(get(o.dataset.for));
  };
  const refresh = () => {
    GZ_UI.paint(s);
    preview();
    GZ_UI.looks($('#looks'), s, (L) => { save(GZ_UI.pickLook(s, L)); fill(); });
    GZ_UI.swatches($('#presets'), s, (name, colors) => { save(GZ_UI.pickPreset(s, name, colors)); fill(); });
    renderContrast();
    renderMine();
    renderHistory();
    renderExtras();
    renderBg();
    renderNav();
    presetOptions();
    outputs();
    $('[data-key="auto.on"]').checked = s.auto.on;
    $('#auto-times').hidden = s.auto.mode !== 'schedule';
    for (const el of $$('[data-tint]')) el.hidden = !s.courses.tint;
    document.body.classList.toggle('off', !s.enabled);
    // Redrawn lists and shown/hidden controls: match again.
    if (finder.value) filter();
  };
  // Puts every control back in line with the state (load, import, reset, preset pick).
  const fill = () => {
    $('#enabled').checked = s.enabled;
    for (const [v] of GZ_COLORS) colorInputs[v].value = s.colors[v];
    presetOptions();
    for (const el of $$('[data-key]')) {
      const v = get(el.dataset.key);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
    for (const r of $$('.seg input[type="radio"]:not([data-local])')) r.checked = String(get(r.name)) === r.value;
    $('#bg-image').value = s.bg.image;
    for (const [slug, box] of tabBoxes) box.checked = s.declutter.tabs.includes(slug);
    renderFonts();
    renderCourses();
    refresh();
  };

  // ---- fonts: one list for three slots (text, headings, code), each card drawn in its own face ----
  let slot = 'font';
  const AUTO = { head: 'Same as text', mono: 'As the site has it' };
  // A few built-in names are words ("Serif", "System"); the rest are the fonts' own names.
  const fontName = (f) => t(f.name);
  const fontLabel = (sl) => (s.look[sl] === 'auto' ? t(AUTO[sl]) : (GZ_FONTS.resolve(s.look[sl]) && fontName(GZ_FONTS.resolve(s.look[sl]))) || s.look[sl]);
  const META = { system: 'This computer', blackboard: 'Open Sans', inter: 'Bundled', atkinson: 'Bundled', serif: 'This computer', mono: 'This computer' };
  const meta = (f) => (META[f.id] ? t(META[f.id]) : f.files ? `jsDelivr${f.size ? ` · ${f.size}` : ''}` : f.local ? t('Google Fonts or this computer') : 'Google Fonts');
  // The card's own face: a preview family where there is one (Google's text= subset, loaded when the
  // list opens), else the stack content.js would use.
  const face = (f) => (f.google || f.preview ? `"${f.preview || f.google}", ${f.fb}` : GZ_FONTS.stack(f.id));
  const card = (value, name, sub, family) => {
    const label = Object.assign(document.createElement('label'), { className: 'font-card' });
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'font-pick', value, checked: s.look[slot] === value });
    // Arrow keys walk the list: only the font it rests on is applied (and downloaded), and the list
    // isn't redrawn under the focus.
    input.addEventListener('change', () => {
      s.look[slot] = value;
      fontLabels();
      clearTimeout(pickTimer);
      pickTimer = setTimeout(() => { refresh(); save(['look']); }, 350);
    });
    const n = Object.assign(document.createElement('span'), { className: 'face', textContent: name });
    n.style.fontFamily = family;
    label.append(input, n, Object.assign(document.createElement('span'), { className: 'meta', textContent: sub }));
    return label;
  };
  let pickTimer = 0;
  const fontLabels = () => { for (const sl of ['font', 'head', 'mono']) $(`#font-now-${sl}`).textContent = fontLabel(sl); };
  const renderFonts = () => {
    fontLabels();
    const groups = new Map();
    if (slot !== 'font') groups.set('', [card('auto', t(AUTO[slot]), t(slot === 'head' ? 'Follows the text font' : "The site's monospace"), 'inherit')]);
    const own = GZ_FONTS.custom(s.look[slot]) ? [GZ_FONTS.resolve(s.look[slot])] : [];
    for (const f of [...GZ_FONTS.LIST, ...own]) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(card(f.id, fontName(f), meta(f), face(f)));
    }
    $('#font-grid').replaceChildren(...[...groups].flatMap(([g, cards]) => {
      const box = Object.assign(document.createElement('div'), { className: 'cards', role: 'radiogroup' });
      box.setAttribute('aria-label', t(g || 'Automatic'));
      box.append(...cards);
      return g ? [Object.assign(document.createElement('h3'), { textContent: t(g) }), box] : [box];
    }));
    findFont();
  };
  // Typing a name searches the list (no request); Use takes a name the list doesn't have.
  const findFont = () => {
    const q = $('#font-custom').value.trim().toLowerCase();
    let n = 0;
    for (const box of $$('#font-grid .cards')) {
      let any = false;
      for (const c of box.children) {
        const hit = !q || c.querySelector('.face').textContent.toLowerCase().includes(q);
        c.classList.toggle('miss', !hit);
        if (hit) { any = true; n++; }
      }
      box.classList.toggle('miss', !any);
      if (box.previousElementSibling?.tagName === 'H3') box.previousElementSibling.classList.toggle('miss', !any);
    }
    $('#font-found').textContent = !q ? '' : n ? t('{n} fonts', { n }) : t('None in the list. Use tries Google Fonts, then this computer.');
  };
  $('#font-custom').addEventListener('input', findFont);
  // Previews: every Google family's name, and only those letters, in one small request.
  const previewLink = (names) => {
    const text = [...new Set([...GZ_FONTS.LIST.map((f) => f.name).join(''), ...names.join(''), ...'Aa'])].join('');
    const fams = names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}`).join('&');
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${fams}&text=${encodeURIComponent(text)}&display=swap` }));
  };
  $('#font-browse').addEventListener('toggle', (e) => {
    if (!e.target.open || e.target.dataset.loaded) return;
    e.target.dataset.loaded = '1';
    previewLink(GZ_FONTS.LIST.filter((f) => f.google || f.preview).map((f) => f.preview || f.google));
    // The small file-only faces load whole; the Nerd Fonts preview through their base family.
    for (const f of GZ_FONTS.LIST) if (f.files && !f.size) GZ_FONTS.load(f.id);
  });
  for (const r of $$('input[name="font-slot"]')) r.addEventListener('change', () => { slot = r.value; renderFonts(); });
  $('#font-use').addEventListener('click', async () => {
    const name = $('#font-custom').value.trim().replace(/\s+/g, ' ');
    if (!GZ_FONTS.custom(name) && !GZ_FONTS.resolve(name)) return hint(t('Font names are letters, digits and spaces.'), true);
    const known = GZ_FONTS.LIST.find((f) => f.name.toLowerCase() === name.toLowerCase());
    const value = known ? known.id : name;
    s.look[slot] = value;
    $('#font-custom').value = '';
    renderFonts();
    refresh();
    save(['look']);
    if (known) return;
    const found = await fetch(GZ_FONTS.cssUrl(name, false), { credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => r.ok, () => false);
    if (found) previewLink([name]);
    else hint(t("{name} isn't on Google Fonts. It shows if it's installed on this computer.", { name }));
  });
  $('#font-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#font-use').click(); });

  // ---- background colors: a ready-made set or three pickers. None stored means the palette's, so
  // they follow palette changes until one is picked. ----
  const activeColors = (v = s) => GZ_ACTIVE_COLORS(v, matchMedia('(prefers-color-scheme: dark)').matches);
  const bgPickers = [1, 2, 3].map((n) => {
    const input = Object.assign(document.createElement('input'), { type: 'color' });
    input.setAttribute('aria-label', t('Background color {n}', { n }));
    input.addEventListener('input', () => {
      if (!s.bg.colors.length) s.bg.colors = [...GZ_BG_COLORS([], activeColors())];
      s.bg.colors[n - 1] = input.value;
      refresh();
      save(['bg'], true);
    });
    input.addEventListener('change', () => save(['bg']));
    $('#bg-colors').append(input);
    return input;
  });
  const renderBg = () => {
    const shows = (el) => el.dataset.kinds.split(' ').includes(s.bg.kind) && (!el.dataset.styles || el.dataset.styles.split(' ').includes(s.bg.style));
    for (const el of $$('#background [data-kinds]')) el.hidden = !shows(el);
    $('#bg-sets').replaceChildren(...[['Palette', []], ...GZ_BG_SETS].map(([name, set]) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'swatch bg-set', title: name === 'Palette' ? t(name) : name });
      b.setAttribute('aria-label', name === 'Palette' ? t('Palette colors') : name);
      b.setAttribute('aria-pressed', String(set.join() === s.bg.colors.join()));
      b.style.background = `linear-gradient(135deg, ${GZ_BG_COLORS(set, activeColors()).join(', ')})`;
      b.addEventListener('click', () => { s.bg.colors = [...set]; refresh(); save(['bg']); });
      return b;
    }));
    GZ_BG_COLORS(s.bg.colors, activeColors()).forEach((c, i) => { bgPickers[i].value = c; });
  };

  let navPick = 0, navReview = 0, navRendered = '', navImage = null;
  const navAverages = new Map();
  const renderNav = () => {
    const n = { ...(offer || s).nav };
    const signature = JSON.stringify([n, n.k === 'default' ? activeColors(offer || s) : null]);
    if (signature === navRendered) return;
    navRendered = signature;
    const rev = ++navReview;
    const pv = $('#nav-preview');
    const paint = (src = '') => {
      if (rev !== navReview) return;
      const p = GZ_CARDS.paint(n, src, 'nav');
      pv.dataset.kind = p?.kind || 'default';
      pv.style.cssText = Object.entries({ ...p?.vars, '--gz-nav-c': n.k === 'default' ? activeColors(offer || s)['--gz-surface-2'] : n.c, '--gz-nav-ink': n.k === 'default' ? activeColors(offer || s)['--gz-ink'] : n.ink }).map(([k, v]) => `${k}:${v}`).join(';');
    };
    paint(n.u);
    for (const el of $$('#sidebar [data-nav-kinds]')) el.hidden = !el.dataset.navKinds.split(' ').includes(n.k);
    $('#nav-url').value = n.u;
    $('#nav-picture-note').textContent = n.i ? t('Picture kept on this device') : '';
    const note = $('#nav-contrast');
    note.classList.remove('err');
    if (n.k === 'default') { if (note.textContent) note.textContent = ''; return; }
    const show = (avg) => {
      if (rev !== navReview) return;
      const ratio = GZ_CARDS.contrast(n, { avg, ink: n.ink });
      note.classList.toggle('err', ratio !== null && ratio < 4.5);
      let text = ratio === null ? t('Image contrast cannot be measured. Check that every label is readable.')
        : t(ratio < 4.5 ? 'Low sidebar contrast: {ratio}:1. Choose different text or background colors.' : 'Sidebar contrast: {ratio}:1. Text should reach 4.5:1; icons 3:1.', { ratio: GZ_I18N.num(+ratio.toFixed(2), GZ_I18N.ui()) });
      if (n.k === 'image' && ratio !== null) text += ' ' + t('Image contrast uses an average; check the whole picture.');
      if (note.textContent !== text) note.textContent = text;
    };
    if (n.k !== 'image') return show(null);
    show(null);
    const key = `${n.i || n.u}|${n.f}`;
    if (n.i && navImage?.id !== n.i) navImage = { id: n.i, src: new Promise((res) => chrome.storage.local.get(`cardImg:${n.i}`, (r) => res(r?.[`cardImg:${n.i}`]))) };
    const src = n.i ? navImage.src : Promise.resolve(n.u);
    src.then((u) => { if (u) paint(u); });
    if (!navAverages.has(key)) {
      if (navAverages.size >= 8) navAverages.delete(navAverages.keys().next().value);
      navAverages.set(key, src.then((u) => u ? GZ_CARDS.average(u, n.f) : null));
    }
    navAverages.get(key).then(show, () => show(null));
  };
  $('#nav-pick').addEventListener('click', () => $('#nav-file').click());
  $('#nav-file').addEventListener('change', async (e) => {
    const file = e.target.files[0], rev = ++navPick;
    e.target.value = '';
    if (!file) return;
    let image;
    try { image = await GZ_CARDS.picture(file); }
    catch (err) { if (rev === navPick) hint(t(err.message === 'cap' ? "That picture is too big to keep. Try a smaller one, or remove another card's picture." : "That file isn't a picture Glaze can read."), true); return; }
    if (rev !== navPick) return;
    const r = await new Promise((res) => {
      try { chrome.runtime.sendMessage({ type: 'glaze:nav', nav: { k: 'image', u: '', i: '' }, image }, (x) => res(chrome.runtime.lastError ? null : x)); }
      catch { res(null); }
    });
    if (rev !== navPick) return;
    if (!r?.ok) return hint(t(r?.error === 'cap' ? "That picture is too big to keep. Try a smaller one, or remove another card's picture." : 'Not saved. Try again in a moment.'), true);
    Object.assign(s.nav, { k: 'image', u: '', i: r.id });
    fill();
    hint(t('Saved'));
  });
  $('#nav-url').addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    let u;
    try { u = raw && new URL(raw); } catch { /* invalid */ }
    if (raw && u?.protocol !== 'https:') return hint(t('Use an https:// link to an image.'), true);
    navPick++;
    Object.assign(s.nav, { u: u ? u.href : '', i: '', k: 'image' });
    for (const k of ['u', 'i', 'k']) pendingNav.add(k);
    fill(); save(['nav']);
  });

  // ---- declutter tabs: a list of slugs, so one checkbox each ----
  const tabBoxes = GZ_TABS.map(([slug, label]) => {
    const row = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
    box.addEventListener('change', () => {
      s.declutter.tabs = box.checked ? [...s.declutter.tabs, slug] : s.declutter.tabs.filter((t) => t !== slug);
      refresh();
      save(['declutter']);
    });
    row.append(box, t(label));
    $('#declutter-tabs').append(row);
    return [slug, box];
  });

  // ---- generic controls: data-key is the settings path; radios use it as their name ----
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    if (key === 'nav.k') el.addEventListener('change', () => { navPick++; });
    if (el.type === 'checkbox') el.addEventListener('change', () => { set(key, el.checked); if (key === 'enhance.coursemenu') renderCourses(); refresh(); save([group(key)]); });
    else if (el.type === 'range') {
      el.addEventListener('input', () => { set(key, +el.value); refresh(); save([group(key)], true); });
      el.addEventListener('change', () => save([group(key)]));
    } else el.addEventListener('change', () => {
      // A cleared time keeps the last one: the schedule never holds an empty end.
      if (el.type === 'time' && !el.value) { el.value = get(key); return; }
      set(key, el.value); refresh(); save([group(key)]);
    });
  }
  for (const r of $$('.seg input[type="radio"]:not([data-local])')) {
    r.addEventListener('change', () => { set(r.name, r.value); refresh(); save([group(r.name)]); });
  }
  $('#enabled').addEventListener('change', (e) => { s.enabled = e.target.checked; refresh(); save(['enabled']); });

  $('#bg-image').addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    if (raw) {
      let url = null;
      try { url = new URL(raw); } catch { /* not a URL */ }
      if (url?.protocol !== 'https:') return hint(t('Use an https:// link to an image.'), true);
      s.bg.image = url.href;
      s.bg.kind = 'image';
    } else s.bg.image = '';
    fill();
    save(['bg']);
  });

  $('#save-preset').addEventListener('click', () => {
    const name = $('#preset-name').value.trim();
    if (!name) return hint(t('Give the palette a name first.'), true);
    if (GZ_PRESET(name, s.presets)) return hint(t("There's already a palette called {name}.", { name }), true);
    if (s.presets.length >= GZ_MAX_PRESETS) return hint(t('You can keep {n} palettes. Delete one first.', { n: GZ_MAX_PRESETS }), true);
    s.presets.push({ name, colors: { ...s.colors } });
    s.preset = name;
    $('#preset-name').value = '';
    refresh();
    save(['presets', 'preset']);
  });
  $('#reset-colors').addEventListener('click', () => { save(GZ_UI.pickPreset(s, 'Frost', GZ_PRESET('Frost'))); fill(); });

  // ---- courses: recorded by the content script, on this device only ----
  // A row per course, organizations apart, each in its own color (GZ_COURSE_COLORS) with its own tint.
  const renderCourses = (next = courses) => {
    courses = next || {};
    const all = Object.entries(courses).filter(([, c]) => c?.slot || c?.canvas || c?.moodle)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    // Picks and ticks from before each course had its own were by slot: a pick becomes the slot's own
    // course's, a tick every course in the slot.
    const own = GZ_COURSE_COLORS(courses, {});
    const cc = s.courses;
    const oldTicks = cc.tinted.filter((n) => /^\d+$/.test(n));
    const oldPicks = Object.keys(cc.colors).filter((n) => /^\d+$/.test(n) && all.some(([id, c]) => c.slot === n && own[id].own));
    if (all.length && (oldTicks.length || oldPicks.length)) {
      cc.tinted = [...new Set([...cc.tinted.filter((n) => !oldTicks.includes(n)), ...all.filter(([, c]) => oldTicks.includes(c.slot)).map(([id]) => id)])];
      for (const n of oldPicks) {
        const [id] = all.find(([i, c]) => c.slot === n && own[i].own);
        cc.colors[id] ||= cc.colors[n];
        delete cc.colors[n];
      }
      save(['courses']);
    }
    const colors = GZ_COURSE_COLORS(courses, cc.colors);
    const row = ([id, c]) => {
      const li = document.createElement('li');
      // A nickname (set from the course's card on Blackboard) heads the row, with Blackboard's name under it.
      // Canvas and Moodle courses wear their site's own color (Moodle's has no nickname either).
      const own = c.canvas ? t('Change the colour and nickname in Canvas’s own card menu.') : c.moodle ? t('The colour is Moodle’s own for this course.') : '';
      const nick = (!own && s.enhance.coursemenu && cc.names[id]) || '';
      c = { ...c, real: c.name, name: nick || c.name };
      const input = Object.assign(document.createElement('input'), { type: 'color', value: own ? c.color || '#808080' : colors[id].color });
      input.setAttribute('aria-label', t('Colour for {name}', { name: c.name }));
      if (own) { input.disabled = true; input.title = own; }
      const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Reset'), hidden: !cc.colors[id] });
      input.addEventListener('input', () => { cc.colors[id] = input.value; reset.hidden = false; refresh(); save(['courses'], true); });
      input.addEventListener('change', () => save(['courses']));
      reset.addEventListener('click', () => { delete cc.colors[id]; renderCourses(); refresh(); save(['courses']); });
      const name = Object.assign(document.createElement('span'), { className: 'name', textContent: c.name, title: nick ? c.real : c.name });
      if (own) name.append(Object.assign(document.createElement('small'), { textContent: own }));
      if (nick) name.append(Object.assign(document.createElement('small'), { textContent: c.real }));
      const tint = Object.assign(document.createElement('label'), { className: 'check', hidden: !cc.tint });
      tint.dataset.tint = '';
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cc.tinted.includes(id) });
      box.setAttribute('aria-label', t('Tint inside {name}', { name: c.name }));
      box.addEventListener('change', () => {
        cc.tinted = box.checked ? [...cc.tinted, id] : cc.tinted.filter((n) => n !== id);
        refresh();
        save(['courses']);
      });
      tint.append(box, t('Tint'));
      // Its own look on its pages, or the student's theme. Look names are names: not translated.
      const look = Object.assign(document.createElement('select'), { title: t('Look for {name}', { name: c.name }) });
      look.setAttribute('aria-label', look.title);
      look.append(new Option(t('Your theme'), ''), ...GZ_LOOKS.map((L) => Object.assign(new Option(L.name, L.name), { translate: false })));
      look.value = cc.looks[id] || '';
      look.addEventListener('change', () => {
        if (look.value) cc.looks[id] = look.value; else delete cc.looks[id];
        save(['courses']);
      });
      li.append(input, name, look, tint);
      if (!own) li.append(reset);
      return li;
    };
    const orgs = all.filter(([, c]) => c.org);
    $('#course-list').replaceChildren(...all.filter(([, c]) => !c.org).map(row));
    $('#org-list').replaceChildren(...orgs.map(row));
    $('#course-head').hidden = $('#org-head').hidden = !orgs.length;
    $('#course-empty').hidden = all.length > 0;
  };
  chrome.storage.local.get('seenCourses', (r) => renderCourses(r?.seenCourses));

  // ---- course cards: a theme's set of card styles (lib/cards.js), worn by cards without their own ----
  const renderCardSet = (raw) => {
    const n = GZ_CARDS.styles(raw)['*']?.length || 0;
    $('#card-set').hidden = !n;
    $('#card-set-note').textContent = n ? t('{n} card styles from a theme take turns on the cards that have no style of their own.', { n }) : '';
  };
  chrome.storage.sync.get('cards', (r) => renderCardSet(r?.cards));
  // Card writes go through the background worker, one at a time with every Canvas tab's (lib/cards.js change).
  const cardsOp = (op) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:cards', ...op }, (r) => res(!chrome.runtime.lastError && r?.ok)));
  $('#card-set-clear').addEventListener('click', async () => { const ok = await cardsOp({ set: [] }); hint(ok ? t('Saved') : t('Not saved. Try again in a moment.'), !ok); });

  // ---- Gradescope (lib/gradescope.js): which Canvas course each Gradescope course goes with, changed here too ----
  // Writes go through the worker's queue ('glaze:gradescope'), as the bar's on Gradescope do.
  let gsSeen = {};
  const gsOp = (op) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:gradescope', ...op }, (r) => res(!chrome.runtime.lastError && r?.ok)))
    .then((ok) => hint(ok ? t('Saved') : t('Not saved. Try again in a moment.'), !ok));
  const renderGradescope = (raw) => {
    const d = GZ_GRADESCOPE.clean(raw);
    const canvas = GZ_GRADESCOPE.canvas(gsSeen); // labelled with code and site, so alike names differ
    const ids = Object.keys(d.map);
    $('#gs-map').hidden = !ids.length && !d.hide && !Object.keys(d.bind).length;
    $('#gs-ask').hidden = !d.hide;
    $('#gs-acct').textContent = d.acct ? t('Gradescope account: {name}', { name: d.acct.name || '—' }) : '';
    $('#gs-forget').hidden = !Object.keys(d.bind).length;
    $('#gs-map ul').replaceChildren(...ids.map((gid) => {
      const m = d.map[gid];
      const c = d.courses[gid];
      const sel = document.createElement('select');
      sel.append(...[['', t('Not a Canvas course')], ...canvas.map((x) => [x.key, x.label]), ['?', t('Forget it (ask again on Gradescope)')]]
        .map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label, selected: value === m.to })));
      sel.setAttribute('aria-label', t('Canvas course for {course}', { course: m.name || gid }));
      sel.addEventListener('change', () => gsOp({ op: 'map', acct: d.acct?.id, list: [{ gid, to: sel.value === '?' ? null : sel.value }] }));
      const li = document.createElement('li');
      const read = c ? [t('Read {when}', { when: when(c.at) }), c.bad ? t('Unreadable rows: {n}', { n: c.bad }) : ''].filter(Boolean).join(' · ') : '';
      li.append(Object.assign(document.createElement('span'), { textContent: m.name || gid }), sel, Object.assign(document.createElement('span'), { className: 'desc', textContent: read }));
      return li;
    }));
  };
  const gsLoad = () => chrome.storage.local.get(['gradescope', 'seenCourses'], (r) => { gsSeen = r?.seenCourses || {}; renderGradescope(r?.gradescope); });
  gsLoad();
  $('#gs-ask').addEventListener('click', () => gsOp({ op: 'hide', hide: false }));
  $('#gs-forget').addEventListener('click', () => gsOp({ op: 'bind', key: null }));

  // Another surface (the popup, another options tab) changed something: take it, unless it is
  // only our own save coming back.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.seenCourses) renderCourses(changes.seenCourses.newValue);
    if (area === 'local' && (changes.gradescope || changes.seenCourses)) gsLoad();
    if (area === 'sync' && changes.cards) renderCardSet(changes.cards.newValue);
    if (area !== 'sync' || pending.size) return;
    GZ_UI.load().then((next) => {
      if (JSON.stringify(next) === JSON.stringify(s)) return;
      Object.assign(s, next);
      fill();
    });
  });

  // ---- share: a theme code is the palette, look and background, checked by lib/share.js ----
  $('#share-copy').addEventListener('click', async () => {
    const { cards } = await new Promise((res) => chrome.storage.sync.get('cards', (r) => res(r || {})));
    let code;
    try { code = await GZ_SHARE.encode(s, cards); } catch (e) { return hint(t(e.why || e.message, e.vars), true); }
    try { await navigator.clipboard.writeText(code); hint(t('Theme code copied.')); } catch { $('#share-code').value = code; $('#share-code').select(); hint(t('Copy the code from the box.')); }
  });
  // from: the gallery Look the code came with ({ name, author }), or null for a pasted code.
  let from = null;
  const endOffer = () => { offer = null; from = null; $('#share-offer').hidden = true; GZ_UI.paint(s); preview(); };
  const tryCode = async (gallery = null) => {
    const code = $('#share-code').value.trim();
    if (!code) return endOffer();
    let got;
    try { got = await GZ_SHARE.decode(code); } catch (e) { endOffer(); return hint(t(e.why || e.message, e.vars), true); }
    from = gallery;
    offer = GZ_SANITIZE({ ...s, colors: got.colors, look: { ...s.look, ...got.look }, bg: { ...s.bg, ...got.bg }, nav: GZ_SHARE.nav(s.nav, got.nav) });
    offer.preset = GZ_MATCH_PRESET(offer.colors, s.presets);
    offer.auto = { ...s.auto, on: false };
    offer.card = GZ_CARDS.settings({ ...s.card, ...got.card });
    offer.cardSet = got.cards;
    offer.code = code;
    const palette = offer.preset ? t('The {name} palette', { name: offer.preset }) : t('A custom palette');
    const what = $('#share-what');
    what.replaceChildren();
    if (from) what.append(Object.assign(document.createElement('b'), { textContent: from.author ? t('{name} by @{author}.', from) : `${from.name}.`, translate: false }), ' ');
    if (!Object.keys(got.look).length && !Object.keys(got.bg).length && !Object.keys(got.nav).length && !got.cards.length) {
      // A palette alone (the gallery has those) leaves the rest as it is.
      what.append(t("{palette}. Your fonts and background stay as they are. It's showing in the preview.", { palette }));
    } else {
      // What it is, and anything it would fetch from elsewhere.
      const fonts = [...new Set(['font', 'head', 'mono'].map((k) => offer.look[k]).filter((v) => v !== 'auto'))].map((v) => GZ_FONTS.resolve(v));
      const web = fonts.filter((f) => f.google || f.files).map((f) => f.name);
      // Style and scene values are the editor's own labels, lowercased: 'radial' is 'Radial'.
      const word = (v) => t(v[0].toUpperCase() + v.slice(1));
      const kind = { solid: t('a solid background'), gradient: t('a {style|lower} gradient background', { style: word(offer.bg.style) }), aurora: t('an aurora background'), scene: t('the {scene|lower} animated background', { scene: word(offer.bg.scene) }), image: t('an image background') }[offer.bg.kind];
      const and = (names) => new Intl.ListFormat(GZ_I18N.locale(GZ_I18N.ui())).format(names);
      what.append(t("{palette}, {fonts}, and {background}. It's showing in the preview.", { palette, fonts: and(fonts.map(fontName)), background: kind }));
      const notes = [];
      if (web.length) notes.push(t('Downloads {fonts} (web fonts).', { n: web.length, fonts: and(web) }));
      if (offer.bg.kind === 'image' && offer.bg.image) notes.push(t('Loads its background image from {host}.', { host: new URL(offer.bg.image).hostname }));
      const cardHosts = [...new Set(got.cards.filter((c) => c.u).map((c) => new URL(c.u).hostname))];
      if (got.cards.length) notes.push(t('Brings {n} course card styles for your Canvas Dashboard.', { n: got.cards.length }));
      if (cardHosts.length) notes.push(t('Its card pictures load from {hosts}.', { hosts: and(cardHosts) }));
      if (offer.nav.k === 'image' && offer.nav.u) notes.push(t('Its sidebar picture loads from {host}.', { host: new URL(offer.nav.u).hostname }));
      if (notes.length) what.append(Object.assign(document.createElement('span'), { className: 'desc', textContent: notes.join(' ') }));
    }
    $('#share-offer').hidden = false;
    GZ_UI.paint(offer);
    preview();
  };
  $('#share-try').addEventListener('click', () => tryCode());
  $('#share-code').addEventListener('paste', () => setTimeout(tryCode));
  $('#share-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryCode(); });
  $('#share-cancel').addEventListener('click', () => { $('#share-code').value = ''; endOffer(); });
  $('#share-apply').addEventListener('click', () => {
    for (const k of GZ_HISTORY.KEYS) s[k] = offer[k];
    s.card = offer.card;
    s.nav = offer.nav;
    pendingNav.clear();
    // A theme's card styles take turns on the cards without their own (lib/cards.js).
    const set = offer.cardSet;
    if (set.length) cardsOp({ set });
    $('#share-code').value = '';
    endOffer();
    fill();
    save([...GZ_HISTORY.KEYS, 'card', 'nav']);
    hint(t('Theme applied.'));
  });

  // ---- gallery, favorites and history: kept on this device (storage.local), lib/history.js ----
  const local = chrome.storage.local;
  const chips = (colors) => {
    const box = Object.assign(document.createElement('span'), { className: 'chips' });
    box.setAttribute('aria-hidden', 'true');
    for (const v of ['--gz-surface-2', '--gz-surface', '--gz-accent', '--gz-accent-hi', '--gz-ink']) {
      const i = document.createElement('i');
      i.style.background = colors[v];
      box.append(i);
    }
    return box;
  };
  const when = (at) => new Intl.DateTimeFormat(GZ_I18N.locale(GZ_I18N.ui()), { dateStyle: 'medium', timeStyle: 'short' }).format(at);
  const button = (text, label, onClick, cls = '') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, className: cls });
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };
  // Look and gallery names are names: not translated.
  const row = (colors, name, sub, ...buttons) => {
    const li = document.createElement('li');
    const n = Object.assign(document.createElement('span'), { className: 'name', textContent: name, title: name, translate: false });
    if (sub) n.append(Object.assign(document.createElement('small'), { textContent: sub }));
    li.append(chips(colors), n, ...buttons);
    return li;
  };
  let favorites = [];
  let history = [];
  const renderFavorites = async () => {
    // Each code is checked again: storage is only as good as what put it there.
    const rows = await Promise.all(favorites.map(async (f) => {
      let got;
      try { got = await GZ_SHARE.decode(f.code); } catch { return null; }
      return row(got.colors, f.name, f.author ? `@${f.author}` : '',
        button(t('Preview'), t('Preview {name}', { name: f.name }), async () => {
          $('#share-code').value = f.code;
          await tryCode(f);
          $('#share-offer').scrollIntoView({ block: 'nearest' });
        }),
        button(t('Remove'), t('Remove {name} from favorites', { name: f.name }), () => local.set({ lookFavorites: favorites.filter((x) => x !== f) }), 'danger'));
    }));
    $('#favorites').replaceChildren(...rows.filter(Boolean));
  };
  const wearEntry = (e) => {
    endOffer();
    Object.assign(s, GZ_HISTORY.wear(s, e));
    fill();
    save(GZ_HISTORY.KEYS);
    hint(t('Theme applied.'));
  };
  const renderHistory = () => {
    const back = GZ_HISTORY.previous(history, s);
    $('#history-back').disabled = !back;
    $('#history-back').title = back ? t('Back to {name}', { name: GZ_UI.themeName(GZ_HISTORY.theme(back.theme)) }) : '';
    $('#history-clear').hidden = !history.length;
    $('#history').replaceChildren(...history.map((e) => {
      const th = GZ_HISTORY.theme(e.theme);
      const name = GZ_UI.themeName(th);
      if (GZ_HISTORY.wearing(s, e)) return row(th.colors, name, t('Wearing now'));
      return row(th.colors, name, typeof e.at === 'number' ? when(e.at) : '', button(t('Wear'), t('Wear {name}', { name }), () => wearEntry(e)));
    }));
  };
  $('#history-back').addEventListener('click', () => { const e = GZ_HISTORY.previous(history, s); if (e) wearEntry(e); });
  // Through the background, which also drops a recording still waiting to be written.
  $('#history-clear').addEventListener('click', () => chrome.runtime.sendMessage('clear-history', () => void chrome.runtime.lastError));
  $('#share-fav').addEventListener('click', () => {
    const f = { code: offer.code, name: from?.name || offer.preset || t('Custom theme'), author: from?.author || '', at: Date.now() };
    local.set({ lookFavorites: GZ_HISTORY.favor(favorites, f) }, () => {
      const err = chrome.runtime.lastError;
      hint(err ? t('Not saved: {error}', { error: err.message }) : t('Saved to your favorites.'), !!err);
    });
  });
  // A Look picked on the gallery (lib/gallery.js, then the background): previewed here; the student decides.
  const takeOffer = async () => {
    const { galleryOffer: g } = await local.get('galleryOffer');
    if (!g?.code) return;
    await local.remove('galleryOffer');
    $('#share-code').value = g.code;
    await tryCode({ name: g.name || t('Custom theme'), author: g.author || '' });
    $('#data').scrollIntoView();
    if (offer) $('#share-apply').focus({ preventScroll: true });
  };
  local.get(['lookFavorites', 'lookHistory'], (r) => {
    favorites = GZ_HISTORY.favorites(r?.lookFavorites);
    history = GZ_HISTORY.entries(r?.lookHistory);
    renderFavorites();
    renderHistory();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.lookFavorites) { favorites = GZ_HISTORY.favorites(changes.lookFavorites.newValue); renderFavorites(); }
    if (changes.lookHistory) { history = GZ_HISTORY.entries(changes.lookHistory.newValue); renderHistory(); }
    if (changes.galleryOffer?.newValue) takeOffer();
  });
  takeOffer();

  // ---- Look rotation's list and your own pointer: kept on this computer (storage.local), lib/lookx.js ----
  let rotateLooks = [];
  const renderExtras = () => {
    $('#rotate-at').hidden = s.extras.rotate !== 'daily';
    $('#rotate-looks').hidden = s.extras.rotate === 'off';
    $('#cursor-own').hidden = s.extras.cursor !== 'own';
  };
  const renderRotate = async () => {
    const tick = (id, colors, name) => {
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: rotateLooks.includes(id) });
      c.setAttribute('aria-label', t('Rotate through {name}', { name }));
      c.addEventListener('change', () => local.set({ rotateLooks: c.checked ? [...rotateLooks, id] : rotateLooks.filter((x) => x !== id) }));
      return row(colors, name, '', c);
    };
    const favs = await Promise.all(favorites.map((f) => GZ_SHARE.decode(f.code).then((got) => tick(f.code, got.colors, f.name), () => null)));
    $('#rotate-looks').replaceChildren(...GZ_LOOKS.map((L) => tick(L.name, L.colors, L.name)), ...favs.filter(Boolean));
  };
  const showCursor = () => local.get('cursorImg', (r) => { const i = $('#cursor-img'); i.hidden = !r?.cursorImg; if (r?.cursorImg) i.src = r.cursorImg; });
  $('#cursor-pick').addEventListener('click', () => $('#cursor-file').click());
  // Read and scaled here, kept as PNG: SVG and anything else the browser can't draw as a bitmap is refused.
  $('#cursor-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { return hint(t("That file isn't a picture Glaze can read."), true); }
    const [w, h] = GZ_LX.fit(bmp.width, bmp.height, 32);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    local.set({ cursorImg: c.toDataURL('image/png') }, () => {
      const err = chrome.runtime.lastError;
      if (err) return hint(t('Not saved: {error}', { error: err.message }), true);
      s.extras.cursor = 'own';
      fill();
      save(['extras']);
      showCursor();
    });
  });
  local.get('rotateLooks', (r) => { rotateLooks = Array.isArray(r?.rotateLooks) ? r.rotateLooks : []; renderRotate(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.rotateLooks) rotateLooks = Array.isArray(changes.rotateLooks.newValue) ? changes.rotateLooks.newValue : [];
    if (changes.rotateLooks || changes.lookFavorites) renderRotate();
  });
  showCursor();

  // ---- backup ----
  // Better To Do's own tasks and plans (storage.local, per Canvas site and user) go in the same file as `tasks`;
  // card styles and bookmarks go too; a picture kept on this computer stays here.
  $('#export').addEventListener('click', () => chrome.storage.sync.get(['cards', 'links'], (r) => chrome.storage.local.get(null, (all) => {
    const tasks = Object.fromEntries(Object.entries(all || {}).filter(([k]) => GZ_TODO.STORE_KEY.test(k)));
    const nav = { ...s.nav, i: '', ...(s.nav.i && { k: 'default', u: '' }) };
    const blob = new Blob([JSON.stringify({ ...s, nav, cards: GZ_CARDS.styles(r?.cards), links: GZ_CARDS.links(r?.links), tasks }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'glaze-settings.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  })));
  $('#import-btn').addEventListener('click', () => $('#import').click());
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let raw;
    try { raw = JSON.parse(await file.text()); } catch { return hint(t("{file} isn't a JSON file.", { file: file.name }), true); }
    if (!raw || typeof raw !== 'object' || !['colors', 'look', 'bg', 'motion', 'presets'].some((k) => k in raw)) {
      return hint(t('No Glaze settings found in {file}.', { file: file.name }), true);
    }
    // All of it is cleaned before any of it is applied, then stored whole by the background worker's write queue
    // (GZ_TODO.restore, 'glaze:todo'): a file that can't be taken whole changes nothing, imports and every tab's
    // To Do edits take turns, and success is said only once both stores have it.
    const next = { ...GZ_SANITIZE(raw), card: GZ_CARDS.settings(raw.card) };
    next.nav.i = ''; // A backup never names a picture on another device.
    const tasks = raw.tasks && typeof raw.tasks === 'object'
      ? Object.fromEntries(Object.entries(raw.tasks).filter(([k]) => GZ_TODO.STORE_KEY.test(k)).map(([k, v]) => [k, GZ_TODO.clean(v)])) : {};
    flush(); // an edit still waiting goes out first, so it can't land on top of the import
    const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:todo', restore: { tasks, settings: { version: 2, ...next } } }, (x) => res(chrome.runtime.lastError ? { ok: false } : x || { ok: false })));
    if (!r.ok) {
      // The settings didn't take, and putting the tasks back didn't either: say so, and show the settings as stored.
      if (r.undone === false) {
        GZ_UI.load().then((now) => { Object.assign(s, now); fill(); });
        return hint(t("Couldn't import {file}, and undoing it failed too: your Better To Do tasks may be the imported ones. Your settings are as they were.", { file: file.name }), true);
      }
      return hint(t("Couldn't import {file}, so nothing changed.", { file: file.name }), true);
    }
    Object.assign(s, next);
    const styled = await cardsOp({ nav: next.nav, ...(raw.cards || raw.links ? { replace: { cards: raw.cards, links: raw.links } } : {}) });
    fill();
    if (!styled) return hint(t('Some settings could not be imported. Try again in a moment.'), true);
    hint(t('Imported {file}.', { file: file.name }));
  });
  // Two clicks, so a stray one can't wipe everything. Custom presets survive.
  let armed = 0;
  $('#reset-all').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!armed) {
      b.textContent = t('Click again to reset');
      armed = setTimeout(() => { armed = 0; b.textContent = t('Reset everything'); }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.textContent = t('Reset everything');
    Object.assign(s, GZ_SANITIZE({ presets: s.presets }), { card: GZ_CARDS.settings() });
    pendingNav.clear();
    save(Object.keys(s));
    // Card styles and bookmarks too, and the pictures kept for them on this computer.
    cardsOp({ reset: true, nav: GZ_DEFAULTS.nav }).then((ok) => { if (!ok) hint(t('Not saved. Try again in a moment.'), true); });
    // Stickers, your sticker pictures and pointer, and Look rotation's list (lib/lookx.js): this computer's, gone too,
    // through the worker's queue, so a tab's sticker change still on its way can't bring one back.
    chrome.runtime.sendMessage({ type: 'glaze:stickers', reset: true }, (r) => { if (chrome.runtime.lastError || !r?.ok) hint(t('Not saved. Try again in a moment.'), true); });
    fill();
    hint(t('Everything is back to the defaults. Your presets are kept.'));

  });

  // Report a problem: a GitHub issue filled in here with the version, browser and system (lib/widgets.js feedback).
  $('#report-link').href = GZ_WIDGETS.feedback({ version: chrome.runtime.getManifest().version, ua: navigator.userAgent, lang: navigator.language });

  fill();
});
