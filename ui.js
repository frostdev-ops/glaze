// Shared by the popup and the options page: storage, the page's own palette, preset swatches.
const GZ_UI = (() => {
  const store = chrome.storage.sync;

  // Settings, and the dashboard cards' (lib/cards.js keeps those apart, out of the content script's first load).
  const clean = (raw) => ({ ...GZ_SANITIZE(raw), card: GZ_CARDS.settings(raw?.card) });
  const load = () => new Promise((res) => {
    try { store.get(null, (raw) => res(clean(chrome.runtime.lastError ? {} : raw))); } catch { res(clean()); }
  });

  // Writes only the given top-level keys: sync storage counts every write against a per-minute
  // quota, and the content script re-reads everything anyway. `note` gets '' or the error.
  const save = (s, keys, note = () => {}) => {
    const patch = { version: 2 };
    for (const k of keys) patch[k] = s[k];
    const failed = (error) => GZ_I18N.t('Not saved: {error}', { error }, GZ_I18N.ui());
    try {
      store.set(patch, () => note(chrome.runtime.lastError ? failed(chrome.runtime.lastError.message) : ''));
    } catch (e) { note(failed(e.message)); }

  };

  // The extension's own pages wear the palette being edited.
  const paint = (s) => {
    const colors = GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
    for (const [v] of GZ_COLORS) document.documentElement.style.setProperty(v, colors[v]);
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

  // A look is an explicit choice too: palette, fonts, shape and background at once.
  const pickLook = (s, L) => {
    Object.assign(s, GZ_LOOK_APPLY(s, L));
    // Course cards only as far as the look names them.
    if (L.card) s.card = GZ_CARDS.settings({ ...s.card, ...L.card });
    return ['colors', 'preset', 'auto', 'look', 'bg', ...(L.card ? ['card'] : [])];
  };

  // A theme's name in the history and favorites: the Look it is, else its palette's name.
  const themeName = (th) => GZ_LOOKS.find((L) => GZ_LOOK_ON(th, L))?.name || th.preset || GZ_I18N.t('Custom theme', {}, GZ_I18N.ui());

  return { load, save, paint, swatches, pickPreset, looks, pickLook, themeName };
})();
