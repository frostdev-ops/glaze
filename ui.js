// Shared by the popup and the options page: storage, the page's own palette, preset swatches.
const GZ_UI = (() => {
  const store = chrome.storage.sync;

  const load = () => new Promise((res) => {
    try { store.get(null, (raw) => res(GZ_SANITIZE(chrome.runtime.lastError ? {} : raw))); } catch { res(GZ_SANITIZE()); }
  });

  // Writes only the given top-level keys: sync storage counts every write against a per-minute
  // quota, and the content script re-reads everything anyway. `note` gets '' or the error.
  const save = (s, keys, note = () => {}) => {
    const patch = { version: 2 };
    for (const k of keys) patch[k] = s[k];
    try {
      store.set(patch, () => note(chrome.runtime.lastError ? `Not saved: ${chrome.runtime.lastError.message}` : ''));
    } catch (e) { note(`Not saved: ${e.message}`); }
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

  return { load, save, paint, swatches, pickPreset };
})();
