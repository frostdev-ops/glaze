// Shared by the popup and the options page: storage, the page's own palette, preset swatches.
const GZ_UI = (() => {
  const store = chrome.storage.sync;

  // Settings, and the dashboard cards' (lib/cards.js keeps those apart, out of the content script's first load).
  const clean = (raw, fresh) => ({ ...GZ_SANITIZE(raw, fresh), card: GZ_CARDS.settings(raw?.card) });
  // The Look's parts (lib/lookparts.js) are part of a Look but live in their own key: s.parts is { x, m }, or null.
  const withParts = async (raw) => {
    const local = await Promise.resolve(chrome.storage.local?.get('freshDefaults')).catch(() => null);
    return { ...clean(raw, local?.freshDefaults?.fresh === true), parts: await GZ_XPARTS.fromStored(raw?.lookX, GZ_XPARTS.areas().local).catch(() => null) ?? null };
  };
  const load = () => new Promise((res) => {
    try { store.get(null, (raw) => res(withParts(chrome.runtime.lastError ? {} : raw))); } catch { res(withParts()); }
  });

  // Writes only the given top-level keys: sync storage counts every write against a per-minute
  // quota, and the content script re-reads everything anyway. `note` gets '' or the error. The key 'parts' is the
  // Look's parts, written in the same call as the rest (null clears them).
  const save = (s, keys, note = () => {}, navPatch, partKeys, navbarPatch) => {
    const patch = { version: 2 };
    for (const k of keys) patch[k] = s[k];
    const parts = 'parts' in patch, lookParts = patch.parts ?? null;
    delete patch.parts;
    const failed = (error) => GZ_I18N.t('Not saved: {error}', { error }, GZ_I18N.ui());
    if ('navbar' in patch && navbarPatch) patch.navbar = navbarPatch;
    if (parts) {
      if ('nav' in patch && navPatch) patch.nav = navPatch;
      try { chrome.runtime.sendMessage({ type: 'glaze:look', parts: lookParts, patch, ...(partKeys && { partKeys }) }, (r) => note(chrome.runtime.lastError || !r?.ok ? GZ_I18N.t('Not saved. Try again in a moment.', {}, GZ_I18N.ui()) : '')); }
      catch (e) { note(failed(e.message)); }
      return;
    }
    if ('navbar' in patch) {
      try { chrome.runtime.sendMessage({ type: 'glaze:navbar', patch: patch.navbar }, (r) => {
        if (chrome.runtime.lastError || !r?.ok) return note(GZ_I18N.t('Not saved. Try again in a moment.', {}, GZ_I18N.ui()));
        const rest = keys.filter((k) => k !== 'navbar');
        if (rest.length) save(s, rest, note, navPatch, partKeys); else note('');
      }); } catch (e) { note(failed(e.message)); }
      return;
    }
    const write = () => {
      try { store.set(patch, () => note(chrome.runtime.lastError ? failed(chrome.runtime.lastError.message) : '')); }
      catch (e) { note(failed(e.message)); }
    };
    if ('nav' in patch) {
      delete patch.nav;
      try {
        const nav = navPatch || s.nav; // Controls send only their changed fields; a Look or import replaces the group.
        chrome.runtime.sendMessage({ type: 'glaze:nav', nav }, (r) => {
          if (chrome.runtime.lastError || !r?.ok) return note(GZ_I18N.t('Not saved. Try again in a moment.', {}, GZ_I18N.ui()));
          if (Object.keys(patch).length > 1) write(); else note('');
        });
      } catch (e) { note(failed(e.message)); }
    } else write();

  };

  // How opaque a page's surfaces must be over the Look's background for their text to pass the page's own contrast checks
  // (GZ_CONTRAST on surface and ground) that the palette passes at full opacity: the Look's own opacity (a translucent
  // panel's 88% when it leaves it automatic), raised as far as needed. Under a surface: the background's colors (black and
  // white for a picture or film), seen through its dim layer of the ground.
  const readable = (s, colors) => {
    const C = GZ_COLOR, kind = s.bg.kind, own = s.look.surfaceOpacity;
    if (kind === 'solid' || !s.look.glass) return 100;
    const ground = C.parse(colors['--gz-surface-2']), paint = C.parse(s.look.surfaceCustom ? s.look.surfaceColor : colors['--gz-surface']);
    const scene = ['scene', 'shader', 'layers', 'media'].includes(kind), dim = scene ? 0.8 + GZ_SCENE_LOOK(s.bg.intensity).dim / 4 : s.bg.dim / 100;
    const over = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
    const art = [...GZ_BG_COLORS(s.bg.colors, colors), ...(['image', 'media'].includes(kind) ? ['#000000', '#ffffff'] : [])].map((c) => over(C.parse(c), ground, dim));
    const pairs = GZ_CONTRAST(colors).filter(({ fg, bg, min }) => ['--gz-surface', '--gz-surface-2'].includes(bg) && C.contrast(colors[fg], C.hex(paint)) >= min);
    const passes = (o) => art.every((under) => pairs.every(({ fg, min }) => C.contrast(colors[fg], C.hex(over(under, paint, o / 100))) >= min));
    let o = own >= 0 ? own : 88;
    while (o < 100 && !passes(o)) o = Math.min(100, o + 2);
    return o;
  };
  // The extension's own pages wear the palette being edited. The settings page (page: true) wears the whole Look: its
  // surfaces over the Look's background (options.html #backdrop), opaque enough to read, and its fonts and text size.
  const paint = (s, { page = false } = {}) => {
    const root = document.documentElement, colors = GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
    for (const [v] of GZ_COLORS) root.style.setProperty(v, colors[v]);
    root.style.setProperty('--gz-radius', `${s.look.radius}px`);
    root.style.setProperty('--gz-glass', `${s.look.glass}px`);
    root.setAttribute('data-gz-depth', String(s.look.depth));
    root.setAttribute('data-gz-motion', s.motion.level);
    for (const [key, value] of Object.entries(GZ_SURFACE_VARS(page ? s : { ...s, bg: { kind: 'solid' } }))) root.style.setProperty(key, value);
    root.style.colorScheme = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < 0.5 ? 'dark' : 'light';
    if (!page) return;
    root.setAttribute('data-gz-bg', s.bg.kind === 'image' && !s.bg.image ? 'gradient' : s.bg.kind);
    const opacity = readable(s, colors);
    if (opacity < 100 || s.bg.kind !== 'solid') root.style.setProperty('--gz-surface-opacity', `${opacity}%`);
    root.style.setProperty('--gz-font', GZ_FONTS.stack(s.look.font));
    root.style.setProperty('--gz-font-head', s.look.head === 'auto' ? 'var(--gz-font)' : GZ_FONTS.stack(s.look.head));
    root.style.setProperty('--gz-scale', String(s.look.scale));
    for (const font of [s.look.font, s.look.head]) GZ_FONTS.load(font);
  };

  // One round button per preset: surface disc, accent dot, pressed when it is the active palette.
  const swatches = (box, s, onPick) => {
    box.replaceChildren();
    for (const [name, colors] of GZ_ALL_PRESETS(s.presets)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.title = name;
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(!s.auto.on && s.preset === name));
      b.style.background = colors['--gz-surface'];
      b.style.borderColor = colors['--gz-line-strong'];
      b.style.setProperty('--dot', colors['--gz-accent']);
      b.addEventListener('click', () => onPick(name, colors));
      box.append(b);
    }
  };

  // Picking a preset is an explicit choice, so it also turns auto light/dark off. It changes the palette and nothing else: the
  // Look's extras (shader, layers, media, tweaks, navigation, animations) stay, as they do when a colour is typed. Only a whole
  // Look (pickLook) brings its own.
  const pickPreset = (s, name, colors) => {
    s.colors = { ...colors };
    s.preset = name;
    s.auto = { ...s.auto, on: false };
    return ['colors', 'preset', 'auto'];
  };

  // One card per look: its name in its own text color on its own surface, fading into its background's
  // colors, with its accent down the edge; pressed when it is what the page is wearing.
  const looks = (box, s, onPick) => {
    box.replaceChildren();
    for (const L of GZ_LOOKS) {
      const c = L.colors;
      // The strip: the background's own colors, else the palette's accents (a solid look stays plain).
      const tint = L.bg.colors?.length ? L.bg.colors : L.bg.kind === 'solid' ? [c['--gz-surface-2']] : [c['--gz-accent'], c['--gz-accent-hi']];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'look';
      b.textContent = L.name;
      b.setAttribute('translate', 'no');
      b.setAttribute('aria-pressed', String(GZ_LOOK_ON(s, L)));
      b.style.color = c['--gz-ink'];
      b.style.borderColor = c['--gz-line-strong'];
      b.style.background = `linear-gradient(90deg, ${c['--gz-accent']} 0 4px, transparent 4px), linear-gradient(120deg, ${c['--gz-surface']} 45%, ${tint.join(', ')})`;
      b.addEventListener('click', () => onPick(L));
      box.append(b);
    }
  };

  // A look is an explicit choice too: palette, fonts, shape and background at once, and its own extras (a Look's parts:
  // pointer, effects) in place of the one before's.
  const pickLook = (s, L) => {
    Object.assign(s, GZ_LOOK_APPLY(s, L));
    s.parts = GZ_LOOK_PARTS(L);
    // Course cards only as far as the look names them.
    if (L.card) s.card = GZ_CARDS.settings({ ...s.card, ...L.card });
    return ['colors', 'preset', 'auto', 'look', 'bg', 'parts', ...(L.card ? ['card'] : [])];
  };

  // A theme's name in the history and favorites: the Look it is, else its palette's name.
  const themeName = (th) => GZ_LOOKS.find((L) => GZ_LOOK_ON(th, L))?.name || th.preset || GZ_I18N.t('Custom theme', {}, GZ_I18N.ui());

  // ---- contrast, as the pages draw it ----
  // features/surfaces.css paints every surface and the ground as color-mix(in srgb, tint X%, surface color): a custom surface
  // color or a tint changes what text sits on while the palette's own tokens still read well. (A glass surface's opacity over a
  // picture isn't known here.)
  const blend = (from, to, t) => {
    const a = GZ_COLOR.parse(from), b = GZ_COLOR.parse(to);
    return GZ_COLOR.hex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  };
  const TWEAK_MIN = 4.5;
  // The checks (GZ_CONTRAST's rows) for the Look in settings `v`: the one on offer, or the one worn. The palette is the one in
  // force (an auto palette, by `dark`: the system's mode), under the Look's own surface color and tint. A course tint leans
  // toward each of `courses` (colors): the worst of them counts. Then a row for each page tweak (`rules`) whose text and
  // background colors can't be read together; a tweak that sets one side is judged against the surface, or the ink, the other
  // side would be.
  const contrast = (v, dark, courses = [], rules = []) => {
    const worn = GZ_ACTIVE_COLORS(v, dark), l = v.look, seen = new Set();
    const leans = courses.filter((c) => GZ_COLOR.parse(c));
    const tints = l.surfaceTint && l.surfaceTintSource === 'course' && leans.length ? leans : [worn['--gz-accent']];
    const painted = (tint) => (l.surfaceCustom || l.surfaceTint
      ? { ...worn, ...Object.fromEntries(['--gz-surface', '--gz-surface-2'].map((k) => [k, blend(l.surfaceCustom ? l.surfaceColor : worn[k], tint, l.surfaceTint / 100)])) } : worn);
    const runs = tints.map((tint) => GZ_CONTRAST(painted(tint)));
    const rows = runs[0].map((row, i) => runs.reduce((worst, run) => (run[i].ratio < worst.ratio ? run[i] : worst), row));
    const styles = new Map();
    for (const r of rules) if (r?.do === 'style') styles.set(r.p, { ...styles.get(r.p), ...r.st });
    for (const [part, st] of styles) {
      if (!(st.fg || st.bg)) continue;
      const color = (c) => (c[0] === '#' ? c : worn[`--gz-${c}`]);
      const fg = st.fg ? color(st.fg) : worn['--gz-ink'];
      if (!GZ_COLOR.parse(fg)) continue;
      const backgrounds = st.bg ? [color(st.bg)] : tints.map((tint) => painted(tint)['--gz-surface']);
      const bg = backgrounds.filter((c) => GZ_COLOR.parse(c)).sort((a, b) => GZ_COLOR.contrast(fg, a) - GZ_COLOR.contrast(fg, b))[0];
      if (!bg) continue;
      const ratio = GZ_COLOR.contrast(fg, bg), key = `${part} ${fg} ${bg}`;
      if (ratio >= TWEAK_MIN || seen.has(key)) continue;
      seen.add(key);
      rows.push({ fg, bg, min: TWEAK_MIN, label: 'Page tweak on {part}', part, ratio, pass: false });
    }
    return rows;
  };

  return { load, save, paint, readable, swatches, pickPreset, looks, pickLook, themeName, contrast };
})();
