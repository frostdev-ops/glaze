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

  // The extension's own pages wear the palette being edited.
  const paint = (s) => {
    const colors = GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
    for (const [v] of GZ_COLORS) document.documentElement.style.setProperty(v, colors[v]);
    document.documentElement.style.setProperty('--gz-radius', `${s.look.radius}px`);
    document.documentElement.style.setProperty('--gz-glass', `${s.look.glass}px`);
    document.documentElement.setAttribute('data-gz-depth', String(s.look.depth));
    document.documentElement.setAttribute('data-gz-motion', s.motion.level);
    for (const [key, value] of Object.entries(GZ_SURFACE_VARS({ ...s, bg: { kind: 'solid' } }))) document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < 0.5 ? 'dark' : 'light';
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

  // Picking a preset is an explicit choice, so it also turns auto light/dark off.
  const pickPreset = (s, name, colors) => {
    s.colors = { ...colors };
    s.preset = name;
    s.auto = { ...s.auto, on: false };
    s.parts = null;
    return ['colors', 'preset', 'auto', 'parts'];
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

  // A look is an explicit choice too: palette, fonts, shape and background at once, and no extras (a Look's parts) of
  // the one before.
  const pickLook = (s, L) => {
    Object.assign(s, GZ_LOOK_APPLY(s, L));
    s.parts = null;
    // Course cards only as far as the look names them.
    if (L.card) s.card = GZ_CARDS.settings({ ...s.card, ...L.card });
    return ['colors', 'preset', 'auto', 'look', 'bg', 'parts', ...(L.card ? ['card'] : [])];
  };

  // A theme's name in the history and favorites: the Look it is, else its palette's name.
  const themeName = (th) => GZ_LOOKS.find((L) => GZ_LOOK_ON(th, L))?.name || th.preset || GZ_I18N.t('Custom theme', {}, GZ_I18N.ui());

  return { load, save, paint, swatches, pickPreset, looks, pickLook, themeName };
})();
