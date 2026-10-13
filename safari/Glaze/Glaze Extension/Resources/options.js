// Options page: the full editor. Every edit repaints this page and the preview frame at once.
// Sliders and colour drags save after the input rests (sync storage allows ~120 writes a minute);
// everything else saves on change.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
// Ultra's own colour for each course slot: the picker starts there.
const SLOT_COLORS = { 1: '#c473d4', 2: '#2fd9fc', 3: '#ffe12b', 4: '#ff6417', 5: '#89f3db', 6: '#fe5b91', 7: '#85f472', 8: '#22c7cc', 9: '#ca22ad', 10: '#157afb' };
const DEPTH = ['Flat', 'Soft', 'Raised', 'Floating'];
const FORMAT = {
  pct: (v) => `${Math.round(v * 100)}%`,
  pct100: (v) => `${v}%`,
  px: (v) => `${v}px`,
  depth: (v) => DEPTH[v],
  deg: (v) => `${v}°`,
  presence: (v) => ['Faint', 'Soft', 'Clear', 'Bold'][Math.min(3, Math.floor(v / 25))],
};

let hintTimer = 0;
const hint = (msg, err = false) => {
  const h = $('#hint');
  h.textContent = msg;
  h.classList.toggle('err', err);
  clearTimeout(hintTimer);
  if (msg && !err) hintTimer = setTimeout(() => { h.textContent = ''; }, 2500);
};

GZ_UI.load().then((s) => {
  const frame = $('#preview');
  // A pasted theme code shows in the preview until it is used or cancelled.
  let offer = null;
  const preview = () => frame.contentWindow?.postMessage({ gzPreview: offer || s }, location.origin);
  frame.addEventListener('load', preview);

  // ---- saving: keys touched while an input moves go out together once it rests ----
  const pending = new Set();
  let timer = 0;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending.size) return;
    GZ_UI.save(s, [...pending], (err) => hint(err || 'Saved', !!err));
    pending.clear();
  };
  const save = (keys, soon = false) => {
    for (const k of keys) pending.add(k);
    clearTimeout(timer);
    if (soon) timer = setTimeout(flush, 500);
    else flush();
  };
  addEventListener('pagehide', flush);

  const get = (path) => path.split('.').reduce((o, k) => o[k], s);
  const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], s)[last] = v; };
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
    row.append(input, label);
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
      name.setAttribute('aria-label', `Rename ${p.name}`);
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (next === p.name) return;
        if (!next || GZ_PRESET(next, s.presets)) { name.value = p.name; return hint(next ? `There's already a palette called ${next}.` : 'A palette needs a name.', true); }
        for (const k of ['light', 'dark']) if (s.auto[k] === p.name) s.auto[k] = next;
        if (s.preset === p.name) s.preset = next;
        p.name = next;
        refresh();
        save(['presets', 'preset', 'auto']);
      });
      const del = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Delete', className: 'danger' });
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
      li.title = `Needs ${r.min}:1`;
      const b = document.createElement('b');
      b.textContent = `${r.ratio.toFixed(1)}:1`;
      li.append(r.label, b);
      return li;
    }));
  };

  // ---- everything that follows the state, cheap enough to redo on every edit ----
  const outputs = () => {
    for (const o of $$('output[data-for]')) o.textContent = (FORMAT[o.dataset.format] || String)(get(o.dataset.for));
  };
  const refresh = () => {
    GZ_UI.paint(s);
    preview();
    GZ_UI.swatches($('#presets'), s, (name, colors) => { save(GZ_UI.pickPreset(s, name, colors)); fill(); });
    renderContrast();
    renderMine();
    renderBg();
    presetOptions();
    outputs();
    $('[data-key="auto.on"]').checked = s.auto.on;
    document.body.classList.toggle('off', !s.enabled);
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
    refresh();
  };

  // ---- fonts: one list for three slots (text, headings, code), each card drawn in its own face ----
  let slot = 'font';
  const AUTO = { head: 'Same as text', mono: 'As Blackboard has it' };
  const fontLabel = (sl) => (s.look[sl] === 'auto' ? AUTO[sl] : GZ_FONTS.resolve(s.look[sl])?.name || s.look[sl]);
  const META = { system: 'This computer', blackboard: 'Open Sans', inter: 'Bundled', atkinson: 'Bundled', serif: 'This computer', mono: 'This computer' };
  const meta = (f) => META[f.id] || (f.files ? `jsDelivr${f.size ? ` · ${f.size}` : ''}` : f.local ? 'Google Fonts or this computer' : 'Google Fonts');
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
    if (slot !== 'font') groups.set('', [card('auto', AUTO[slot], slot === 'head' ? 'Follows the text font' : "Ultra's monospace", 'inherit')]);
    const own = GZ_FONTS.custom(s.look[slot]) ? [GZ_FONTS.resolve(s.look[slot])] : [];
    for (const f of [...GZ_FONTS.LIST, ...own]) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(card(f.id, f.name, meta(f), face(f)));
    }
    $('#font-grid').replaceChildren(...[...groups].flatMap(([g, cards]) => {
      const box = Object.assign(document.createElement('div'), { className: 'cards', role: 'radiogroup' });
      box.setAttribute('aria-label', g || 'Automatic');
      box.append(...cards);
      return g ? [Object.assign(document.createElement('h3'), { textContent: g }), box] : [box];
    }));
  };
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
    if (!GZ_FONTS.custom(name) && !GZ_FONTS.resolve(name)) return hint('Font names are letters, digits and spaces.', true);
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
    else hint(`${name} isn't on Google Fonts. It shows if it's installed on this computer.`);
  });
  $('#font-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#font-use').click(); });

  // ---- background colors: a ready-made set or three pickers. None stored means the palette's, so
  // they follow palette changes until one is picked. ----
  const activeColors = () => GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
  const bgPickers = [1, 2, 3].map((n) => {
    const input = Object.assign(document.createElement('input'), { type: 'color' });
    input.setAttribute('aria-label', `Background color ${n}`);
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
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'swatch bg-set', title: name });
      b.setAttribute('aria-label', name === 'Palette' ? 'Palette colors' : name);
      b.setAttribute('aria-pressed', String(set.join() === s.bg.colors.join()));
      b.style.background = `linear-gradient(135deg, ${GZ_BG_COLORS(set, activeColors()).join(', ')})`;
      b.addEventListener('click', () => { s.bg.colors = [...set]; refresh(); save(['bg']); });
      return b;
    }));
    GZ_BG_COLORS(s.bg.colors, activeColors()).forEach((c, i) => { bgPickers[i].value = c; });
  };

  // ---- declutter tabs: a list of slugs, so one checkbox each ----
  const tabBoxes = GZ_TABS.map(([slug, label]) => {
    const row = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
    box.addEventListener('change', () => {
      s.declutter.tabs = box.checked ? [...s.declutter.tabs, slug] : s.declutter.tabs.filter((t) => t !== slug);
      refresh();
      save(['declutter']);
    });
    row.append(box, label);
    $('#declutter-tabs').append(row);
    return [slug, box];
  });

  // ---- generic controls: data-key is the settings path; radios use it as their name ----
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    if (el.type === 'checkbox') el.addEventListener('change', () => { set(key, el.checked); refresh(); save([group(key)]); });
    else if (el.type === 'range') {
      el.addEventListener('input', () => { set(key, +el.value); refresh(); save([group(key)], true); });
      el.addEventListener('change', () => save([group(key)]));
    } else el.addEventListener('change', () => { set(key, el.value); refresh(); save([group(key)]); });
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
      if (url?.protocol !== 'https:') return hint('Use an https:// link to an image.', true);
      s.bg.image = url.href;
      s.bg.kind = 'image';
    } else s.bg.image = '';
    fill();
    save(['bg']);
  });

  $('#save-preset').addEventListener('click', () => {
    const name = $('#preset-name').value.trim();
    if (!name) return hint('Give the palette a name first.', true);
    if (GZ_PRESET(name, s.presets)) return hint(`There's already a palette called ${name}.`, true);
    if (s.presets.length >= GZ_MAX_PRESETS) return hint(`You can keep ${GZ_MAX_PRESETS} palettes. Delete one first.`, true);
    s.presets.push({ name, colors: { ...s.colors } });
    s.preset = name;
    $('#preset-name').value = '';
    refresh();
    save(['presets', 'preset']);
  });
  $('#reset-colors').addEventListener('click', () => { save(GZ_UI.pickPreset(s, 'Frost', GZ_PRESET('Frost'))); fill(); });

  // ---- courses: names come from the content script, recorded on this device only ----
  const renderCourses = (seen = {}) => {
    const slots = Object.keys(seen).sort((a, b) => a - b);
    $('#course-empty').hidden = slots.length > 0;
    $('#course-list').replaceChildren(...slots.map((slot) => {
      const li = document.createElement('li');
      const input = Object.assign(document.createElement('input'), { type: 'color', value: s.courses.colors[slot] || SLOT_COLORS[slot] });
      input.setAttribute('aria-label', `Colour for ${seen[slot]}`);
      input.addEventListener('input', () => { s.courses.colors[slot] = input.value; refresh(); save(['courses'], true); reset.hidden = false; });
      input.addEventListener('change', () => save(['courses']));
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = seen[slot];
      const tag = document.createElement('span');
      tag.className = 'slot';
      tag.textContent = `colour ${slot}`;
      name.append(tag);
      const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset', hidden: !s.courses.colors[slot] });
      reset.addEventListener('click', () => { delete s.courses.colors[slot]; input.value = SLOT_COLORS[slot]; reset.hidden = true; refresh(); save(['courses']); });
      li.append(input, name, reset);
      return li;
    }));
  };
  chrome.storage.local.get('seenCourses', (r) => renderCourses(r?.seenCourses));

  // Another surface (the popup, another options tab) changed something: take it, unless it is
  // only our own save coming back.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.seenCourses) renderCourses(changes.seenCourses.newValue);
    if (area !== 'sync' || pending.size) return;
    GZ_UI.load().then((next) => {
      if (JSON.stringify(next) === JSON.stringify(s)) return;
      Object.assign(s, next);
      fill();
    });
  });

  // ---- share: a theme code is the palette, look and background, checked by lib/share.js ----
  $('#share-copy').addEventListener('click', async () => {
    const code = await GZ_SHARE.encode(s);
    try { await navigator.clipboard.writeText(code); hint('Theme code copied.'); } catch { $('#share-code').value = code; $('#share-code').select(); hint('Copy the code from the box.'); }
  });
  const endOffer = () => { offer = null; $('#share-offer').hidden = true; GZ_UI.paint(s); preview(); };
  const tryCode = async () => {
    const code = $('#share-code').value.trim();
    if (!code) return endOffer();
    let got;
    try { got = await GZ_SHARE.decode(code); } catch (e) { endOffer(); return hint(e.message, true); }
    offer = GZ_SANITIZE({ ...s, colors: got.colors, look: { ...s.look, ...got.look }, bg: { ...s.bg, ...got.bg } });
    offer.preset = GZ_MATCH_PRESET(offer.colors, s.presets);
    offer.auto = { ...s.auto, on: false };
    // What it is, and anything it would fetch from elsewhere.
    const fonts = [...new Set(['font', 'head', 'mono'].map((k) => offer.look[k]).filter((v) => v !== 'auto'))].map((v) => GZ_FONTS.resolve(v));
    const web = fonts.filter((f) => f.google || f.files).map((f) => f.name);
    const kind = { solid: 'a solid', gradient: `a ${offer.bg.style} gradient`, aurora: 'an aurora', scene: `the ${offer.bg.scene} animated`, image: 'an image' }[offer.bg.kind];
    const what = $('#share-what');
    what.textContent = `${offer.preset ? `The ${offer.preset} palette` : 'A custom palette'}, ${fonts.map((f) => f.name).join(' and ')}, and ${kind} background. It's showing in the preview.`;
    const notes = [];
    if (web.length) notes.push(`Downloads ${web.join(' and ')} (${web.length > 1 ? 'web fonts' : 'a web font'}).`);
    if (offer.bg.kind === 'image' && offer.bg.image) notes.push(`Loads its background image from ${new URL(offer.bg.image).hostname}.`);
    if (notes.length) what.append(Object.assign(document.createElement('span'), { className: 'desc', textContent: notes.join(' ') }));
    $('#share-offer').hidden = false;
    GZ_UI.paint(offer);
    preview();
  };
  $('#share-try').addEventListener('click', tryCode);
  $('#share-code').addEventListener('paste', () => setTimeout(tryCode));
  $('#share-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryCode(); });
  $('#share-cancel').addEventListener('click', () => { $('#share-code').value = ''; endOffer(); });
  $('#share-apply').addEventListener('click', () => {
    for (const k of ['colors', 'look', 'bg', 'preset', 'auto']) s[k] = offer[k];
    $('#share-code').value = '';
    endOffer();
    fill();
    save(['colors', 'look', 'bg', 'preset', 'auto']);
    hint('Theme applied.');
  });

  // ---- backup ----
  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'glaze-settings.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import-btn').addEventListener('click', () => $('#import').click());
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let raw;
    try { raw = JSON.parse(await file.text()); } catch { return hint(`${file.name} isn't a JSON file.`, true); }
    if (!raw || typeof raw !== 'object' || !['colors', 'look', 'bg', 'motion', 'presets'].some((k) => k in raw)) {
      return hint(`No Glaze settings found in ${file.name}.`, true);
    }
    Object.assign(s, GZ_SANITIZE(raw));
    save(Object.keys(s));
    fill();
    hint(`Imported ${file.name}.`);
  });
  // Two clicks, so a stray one can't wipe everything. Custom presets survive.
  let armed = 0;
  $('#reset-all').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!armed) {
      b.textContent = 'Click again to reset';
      armed = setTimeout(() => { armed = 0; b.textContent = 'Reset everything'; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.textContent = 'Reset everything';
    Object.assign(s, GZ_SANITIZE({ presets: s.presets }));
    save(Object.keys(s));
    fill();
    hint('Everything is back to the defaults. Your presets are kept.');
  });

  fill();
});
