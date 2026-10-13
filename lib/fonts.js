// The font catalog and its loader, shared by the content script, the editor and the tests.
// Classic script; module.exports for node.
//
// A font setting is a catalog id ('lexend') or any family name the user typed ('Comic Neue'). Web
// fonts load only once chosen: Google Fonts by name, or files on jsDelivr. The files are fetched by
// the script itself and handed to the page as FontFace data, so a Blackboard site's Content Security
// Policy (font-src) can't block them, and no cookie or page address goes with the request.
const GZ_FONTS = (() => {
  const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const SERIF = 'ui-serif, "Iowan Old Style", Georgia, serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const FS = 'https://cdn.jsdelivr.net/npm/@fontsource/';
  const NF = 'https://cdn.jsdelivr.net/gh/ryanoasis/nerd-fonts@v3.4.0/patched-fonts/';
  const nerd = (id, name, path, file, preview) => ({ id, name, group: 'Nerd Fonts', fb: MONO, preview, size: '5 MB', files: { 400: `${NF}${path}/Regular/${file}-Regular.ttf`, 700: `${NF}${path}/Bold/${file}-Bold.ttf` } });
  const google = (group, fb) => (name, id = name.toLowerCase().replace(/ /g, '-')) => ({ id, name, group, fb, google: name });
  const readable = google('Readable', SANS);
  const sans = google('Sans', SANS);
  const serif = google('Serif', SERIF);
  const mono = google('Mono', MONO);
  // Built-ins carry their own stack: system faces, Ultra's own, and the two bundled in fonts/.
  const LIST = [
    { id: 'system', name: 'System', group: 'Built in', stack: SANS },
    { id: 'blackboard', name: "Blackboard's own", group: 'Built in', stack: `"Open Sans", ${SANS}` },
    { id: 'inter', name: 'Inter', group: 'Built in', stack: `"Glaze Inter", ${SANS}` },
    { id: 'atkinson', name: 'Atkinson Hyperlegible', group: 'Built in', stack: `"Glaze Atkinson", ${SANS}` },
    { id: 'serif', name: 'Serif', group: 'Built in', stack: SERIF },
    { id: 'mono', name: 'Monospace', group: 'Built in', stack: MONO },
    // Readable: all SIL OFL.
    readable('Lexend'),
    { id: 'opendyslexic', name: 'OpenDyslexic', group: 'Readable', fb: SANS, files: { 400: `${FS}opendyslexic@5.3.0/files/opendyslexic-latin-400-normal.woff2`, 700: `${FS}opendyslexic@5.3.0/files/opendyslexic-latin-700-normal.woff2` } },
    readable('Atkinson Hyperlegible Next', 'atkinson-next'),
    readable('Andika'),
    readable('Readex Pro'),
    readable('Comic Neue'),
    sans('Figtree'), sans('DM Sans'), sans('Outfit'), sans('Manrope'), sans('Plus Jakarta Sans'), sans('IBM Plex Sans'), sans('Nunito'), sans('Geist'),
    serif('Literata'), serif('Source Serif 4'), serif('Merriweather'), serif('Lora'), serif('Newsreader'), serif('Fraunces'),
    mono('JetBrains Mono'), mono('Fira Code'), mono('IBM Plex Mono'), mono('Geist Mono'), mono('Atkinson Hyperlegible Mono', 'atkinson-mono'), mono('Cascadia Code'), mono('Space Mono'), mono('Victor Mono'),
    // Nerd Fonts: the patched families as released (big files: every icon glyph comes along).
    nerd('jetbrains-nf', 'JetBrainsMono Nerd Font', 'JetBrainsMono/Ligatures', 'JetBrainsMonoNerdFont', 'JetBrains Mono'),
    nerd('firacode-nf', 'FiraCode Nerd Font', 'FiraCode', 'FiraCodeNerdFont', 'Fira Code'),
    nerd('hack-nf', 'Hack Nerd Font', 'Hack', 'HackNerdFont'),
    nerd('meslo-nf', 'MesloLGL Nerd Font', 'Meslo/L', 'MesloLGLNerdFont'),
  ];
  const BY_ID = new Map(LIST.map((f) => [f.id, f]));
  // A typed family name: letters, digits and spaces, so it is safe inside CSS quotes and a URL.
  const NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
  const custom = (v) => typeof v === 'string' && v !== 'auto' && !BY_ID.has(v) && NAME.test(v);
  // The font a setting names: a catalog entry, or a typed name tried on Google Fonts, then locally.
  const resolve = (v) => BY_ID.get(v) || (custom(v) ? { id: v, name: v, group: 'Yours', fb: SANS, google: v, local: true } : null);
  // What the loader registers it as: prefixed, so it can't collide with a face the page defines.
  const family = (f) => `Glaze ${f.name}`;
  const stack = (v) => {
    const f = resolve(v) || BY_ID.get('system');
    if (f.stack) return f.stack;
    return `"${family(f)}", ${f.local ? `"${f.name}", ` : ''}${f.fb}`;
  };

  // Google's CSS for a family: one @font-face per weight and script subset. Latin and Latin Extended
  // only: Blackboard's text is mostly Latin, and data fonts can't load subsets lazily the way url()
  // fonts do. ponytail: other scripts fall back to the system face; add their subsets if asked.
  const SUBSETS = ['latin', 'latin-ext'];
  const cssUrl = (name, weights = true) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}${weights ? ':wght@400;600;700' : ''}&display=swap`;
  const faces = (css) => {
    const all = [...String(css).matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)].map(([, subset, body]) => {
      const prop = (k) => body.match(new RegExp(`${k}:\\s*([^;]+);`))?.[1].trim();
      return { subset, weight: prop('font-weight') || '400', style: prop('font-style') || 'normal', url: body.match(/url\(([^)]+)\)/)?.[1].replace(/['"]/g, ''), range: prop('unicode-range') };
    }).filter((f) => f.url?.startsWith('https://') && f.style === 'normal');
    return all.some((f) => f.subset) ? all.filter((f) => SUBSETS.includes(f.subset)) : all;
  };

  // Loads a setting's web font into a document, once per family. Resolves either way; a font that
  // can't load leaves the fallback in the stack showing.
  const loading = new Map();
  const load = (v, doc = document) => {
    const f = resolve(v);
    if (!f || !(f.google || f.files)) return Promise.resolve(false);
    const key = family(f);
    if (loading.has(key)) return loading.get(key);
    const get = (url, as) => fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => (r.ok ? r[as]() : Promise.reject(r.status)));
    const list = f.files
      ? Promise.resolve(Object.entries(f.files).map(([weight, url]) => ({ weight, url })))
      // A family without one of the three weights is asked for again plainly.
      : get(cssUrl(f.google), 'text').catch(() => get(cssUrl(f.google, false), 'text')).then(faces);
    const bufs = new Map();
    const p = list.then((fs) => Promise.all(fs.map((x) => {
      if (!bufs.has(x.url)) bufs.set(x.url, get(x.url, 'arrayBuffer').catch(() => `url("${x.url}")`));
      return bufs.get(x.url).then((src) => {
        const face = new FontFace(key, src, { weight: x.weight, display: 'swap', ...(x.range && { unicodeRange: x.range }) });
        doc.fonts.add(face);
        return face.load();
      });
    }))).then(() => true, () => false);
    loading.set(key, p);
    return p;
  };

  return { LIST, SANS, SERIF, MONO, resolve, custom, family, stack, faces, cssUrl, load };
})();

if (typeof module !== 'undefined') module.exports = GZ_FONTS;
