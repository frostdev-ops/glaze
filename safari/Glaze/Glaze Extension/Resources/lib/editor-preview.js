// Extension-only synthetic preview. Ultra uses its real runtime; Canvas/Moodle reuse their CSS, painters and motion.
(async () => {
  const html = document.documentElement, requested = new URLSearchParams(location.search).get('site');
  const site = ['canvas', 'moodle'].includes(requested) ? requested : 'ultra';
  const load = (src) => new Promise((resolve, reject) => { const script = Object.assign(document.createElement('script'), { src }); script.onload = resolve; script.onerror = reject; document.body.append(script); });
  const attr = (key, value) => { if (value === false || value === null || value === undefined) html.removeAttribute(key); else html.setAttribute(key, value === true ? '' : value); };
  const variable = (key, value) => html.style.setProperty(key, value);
  let context = { site, page: 'outline', viewport: 'desktop' }, settings = GZ_SANITIZE(), revision = 0, scene, sceneCanvas, sceneFile, sceneModule = {}, sceneBad = '', sceneShown = '';
  // A shader's source and the layers are the Look's parts (GZ_CTX.parts(), announced by glaze:parts), which arrive after the first paint.
  const partsOf = () => globalThis.GZ_CTX?.parts() ?? null;
  const samples = (s) => {
    for (const [kind, on] of [['widget', s.enhance.widgets], ['notes', s.enhance.notes], ['todo', s.enhance.todo]]) for (const tile of document.querySelectorAll(`[data-preview-${kind}]`)) tile.hidden = !on;
    for (const timer of document.querySelectorAll('[data-preview-timer]')) timer.textContent = GZ_WIDGETS.clock(s.widgets.work * 60000);
  };
  const applyContext = () => {
    html.dataset.previewSite = site; html.dataset.previewViewport = context.viewport;
    html.dataset.previewPage = context.page;
    for (const view of document.querySelectorAll('[data-preview-view]')) view.hidden = !view.dataset.previewView.split(' ').includes(context.page);
    const menu = document.querySelector('#preview-menu');
    if (menu && context.viewport === 'desktop') {
      html.removeAttribute('data-preview-nav-open'); menu.setAttribute('aria-expanded', 'false');
      const drawer = document.querySelector('.MuiDrawer-root'); drawer?.removeAttribute('role'); drawer?.removeAttribute('aria-modal');
    }
    document.dispatchEvent(new CustomEvent('glaze:parts'));
  };
  addEventListener('message', (e) => {
    if (e.origin === location.origin && e.source === parent && e.data?.gzPreview) samples(GZ_SANITIZE(e.data.gzPreview));
    if (e.origin !== location.origin || e.source !== parent || !e.data?.gzPreviewContext) return;
    const next = e.data.gzPreviewContext;
    if (next.site !== site) return;
    context = { site, page: ['courses', 'outline', 'dashboard', 'tabs', 'document', 'quiz'].includes(next.page) ? next.page : 'courses', viewport: next.viewport === 'phone' ? 'phone' : 'desktop' };
    applyContext();
    if (site === 'moodle') { document.body.className = ['outline', 'tabs'].includes(context.page) ? 'pagelayout-course course-5' : 'pagelayout-mydashboard'; globalThis.GZ_NAVBAR_UI?.sync(); }
    if (site === 'canvas') globalThis.GZ_CTABS?.sync(settings.enabled && settings.enhance.tabs && context.page === 'tabs');
  });
  // The editor's Play and Try it (lib/editor-x.js): 'enter' replays the entrances, an event name fires that moment as the
  // page would. Taking the knobs to none for one style pass and back restarts each animation; motion off or entrances off
  // keep them none, so nothing plays then, and features/motionx.js draws no effect while motion is off.
  addEventListener('message', (e) => {
    const m = e.origin === location.origin && e.source === parent ? e.data?.gzPreviewMoment : null;
    if (m === 'enter' && !html.hasAttribute('data-gz-no-enter')) { html.setAttribute('data-gz-no-enter', ''); void document.body.offsetWidth; html.removeAttribute('data-gz-no-enter'); }
    else if (globalThis.GZ_MX?.EVENTS.includes(m)) globalThis.GZ_CTX?.moment?.(m);
  });
  if (site === 'ultra') {
    for (const file of ['content-ultra.js', 'content.js', 'features/coursetabs.js', 'features/cards.js', 'features/nav.js', 'lib/navbar.js', 'features/navbar-widgets.js', 'features/navbar.js', 'lib/lookx.js', 'features/rules.js', 'lib/motionx.js', 'features/motionx.js']) await load(file);
    // The mock supplies the phone drawer shell; the actual rail code still owns labels, shrink and hover expansion.
    const menu = document.querySelector('#preview-menu'), drawer = document.querySelector('.MuiDrawer-root');
    const close = () => { html.removeAttribute('data-preview-nav-open'); drawer.removeAttribute('role'); drawer.removeAttribute('aria-modal'); menu.setAttribute('aria-expanded', 'false'); menu.focus(); };
    menu.addEventListener('click', () => {
      const open = !html.hasAttribute('data-preview-nav-open'); attr('data-preview-nav-open', open); menu.setAttribute('aria-expanded', String(open));
      if (open) { drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true'); drawer.querySelector('nav a')?.focus(); } else close();
    });
    document.querySelector('#preview-backdrop').addEventListener('click', close);
    addEventListener('keydown', (e) => {
      if (!html.hasAttribute('data-preview-nav-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
      if (e.key !== 'Tab') return;
      const controls = [...drawer.querySelectorAll('a,button,input,select')].filter((el) => el.tabIndex >= 0 && el.getClientRects().length), first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, true);
  } else {
    document.getElementById('preview-menu').remove();
    const template = document.getElementById(`mock-${site}`); document.querySelector('#site-wrap').replaceWith(template.content.cloneNode(true));
    if (site === 'moodle') { document.body.id = 'page-my-index'; document.body.className = 'pagelayout-mydashboard'; }
    const sheets = [`${site}.css`, 'motion.css', 'features/surfaces.css', ...(site === 'canvas' ? ['features/coursetabs.css', 'features/apps.css', 'features/sidebar.css'] : [])].map((href) => {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href }); document.head.append(link); return link;
    });
    // The sidebar as the settings dress it (features/sidebar.css): a still Glaze column at the right edge, with This page
    // and My widgets, the mock page kept clear of it. Nothing of an account's (where widgets sit) is shown here.
    const sidebar = (s) => {
      let aside = document.getElementById('gz-sidebar');
      const c = s.sidebar, on = s.enabled && s.enhance.sidebar && c.canvas;
      const marks = { 'data-gz-sidebar': on && (c.open === 'collapsed' ? 'collapsed' : 'expanded'), 'data-gz-sb-style': on && (c.style === 'auto' ? s.navbar.style : c.style), 'data-gz-sb-surface': on && c.surface,
        'data-gz-sb-radius': on && c.radius !== 'auto' && c.radius, 'data-gz-sb-density': on && c.density !== 'auto' && c.density, 'data-gz-sb-order': on && c.order === 'widgets' && 'widgets', 'data-gz-sb-notitle': on && !c.heading };
      for (const [key, value] of Object.entries(marks)) attr(key, value);
      if (!on) { aside?.remove(); return; }
      if (!aside) {
        const el = (tag, cls, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
        aside = Object.assign(document.createElement('aside'), { id: 'gz-sidebar', className: 'gz-sb-own' });
        aside.setAttribute('data-gz-sidebar-host', 'glaze');
        aside.setAttribute('aria-hidden', 'true');
        const head = el('div', 'gz-sb-head');
        head.append(Object.assign(el('h2', 'gz-sb-title'), { id: 'gz-sb-title' }), el('span', 'gz-sb-icon', '⇥'));
        const page = el('div', 'gz-sb-preview-page');
        page.append(el('h2', 'gz-sb-sec gz-sb-pagehead'), el('div', 'gz-sb-preview-block'));
        const dock = Object.assign(el('section', 'gz-sb-widgets'), { id: 'gz-sb-widgets' });
        dock.append(el('h2', 'gz-sb-sec'), el('div', 'gz-sb-preview-block'));
        aside.append(head, page, dock);
        document.body.append(aside);
      }
      aside.querySelector('.gz-sb-title').textContent = c.title || GZ_I18N.t('Sidebar', {}, settings.lang === 'auto' ? navigator.language : settings.lang);
      const [pageHead, dockHead] = aside.querySelectorAll('.gz-sb-sec');
      pageHead.textContent = GZ_I18N.t('This page', {}, settings.lang === 'auto' ? navigator.language : settings.lang);
      dockHead.textContent = GZ_I18N.t('My widgets', {}, settings.lang === 'auto' ? navigator.language : settings.lang);
      aside.querySelector('.gz-sb-preview-page').hidden = c.page === 'hidden';
      variable('--gz-sidebar-w', `${c.width}px`); variable('--gz-sb-top', '0px'); variable('--gz-sb-blur', `${c.blur}px`); variable('--gz-sb-alpha', `${c.opacity}%`);
    };
    const picture = async (id, url = '') => id ? (await chrome.storage.local.get(`cardImg:${id}`))[`cardImg:${id}`] || '' : url;
    const paint = async () => {
      globalThis.GZ_RULES?.sync();
      if (site === 'moodle') globalThis.GZ_NAVBAR_UI?.sync();
      if (site === 'canvas') { globalThis.GZ_CTABS?.sync(settings.enabled && settings.enhance.tabs && context.page === 'tabs'); globalThis.GZ_NAVBAR_UI?.sync(); }
      const mine = ++revision, s = settings, colors = GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
      for (const link of sheets) link.disabled = !s.enabled;
      for (const [key] of GZ_COLORS) variable(key, colors[key]);
      const dark = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < .5;
      variable('color-scheme', dark ? 'dark' : 'light'); attr('data-gz-dark-theme', dark);
      for (const [key, value] of Object.entries({ radius: `${s.look.radius}px`, scale: s.look.scale, leading: s.look.leading, glass: `${s.look.glass}px`, 'glass-mix': s.look.glass ? '78%' : '100%', font: GZ_FONTS.stack(s.look.font), 'font-head': s.look.head === 'auto' ? 'inherit' : GZ_FONTS.stack(s.look.head), 'font-mono': GZ_FONTS.stack(s.look.mono) })) variable(`--gz-${key}`, value);
      for (const [key, value] of Object.entries(GZ_SURFACE_VARS(s))) variable(key, value);
      for (const font of [s.look.font, s.look.head, s.look.mono]) GZ_FONTS.load(font);
      for (const [key, value] of Object.entries({ font: s.look.font, 'font-mono': s.look.mono !== 'auto', density: s.look.density, depth: String(s.look.depth), footer: s.footer, 'raw-courses': !s.courses.harmonize })) attr(`data-gz-${key}`, value);
      const kind = s.bg.kind === 'image' && !s.bg.image ? 'gradient' : s.bg.kind, look = ['scene', 'shader', 'layers', 'media'].includes(kind) && GZ_SCENE_LOOK(s.bg.intensity);
      const x = partsOf(), drawn = kind === 'scene' || (kind === 'shader' ? !!x?.bg?.shader?.src : kind === 'media' ? !!x?.bg?.media : kind === 'layers' && !!x?.bg?.layers?.length), sig = JSON.stringify([kind, s.bg.scene, x?.bg]);
      attr('data-gz-bg', kind); attr('data-gz-scene', kind === 'scene' && s.bg.scene); attr('data-gz-bg-grain', s.bg.grain);
      variable('--gz-bg-image', `url("${s.bg.image}")`); variable('--gz-bg-dim', `${look ? Math.round(look.dim * 100) : s.bg.dim}%`); variable('--gz-bg-blur', `${look ? 0 : s.bg.blur}px`);
      GZ_BG_COLORS(s.bg.colors, colors).forEach((c, i) => variable(`--gz-bg-${i + 1}`, c)); variable('--gz-bg-grad', GZ_GRADIENT(s.bg, 'oklab'));
      const motion = s.motion.followSystem && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : s.motion.level;
      attr('data-gz-motion', motion); for (const key of ['transitions', 'enter', 'hover']) attr(`data-gz-no-${key === 'transitions' ? 'trans' : key}`, !s.motion[key]);
      for (const [key, value] of Object.entries(s.enhance)) attr(`data-gz-enhance-${key}`, value);
      for (const key of ['help', 'banner', 'faculty']) attr(`data-gz-hide-${key}`, s.declutter[key]);
      for (const [key] of GZ_TABS) attr(`data-gz-hide-tab-${key}`, s.declutter.tabs.includes(key));
      const n = s.nav, src = await picture(n.i, n.u); if (mine !== revision) return;
      attr('data-gz-nav-size', n.size !== 'medium' || n.labels !== 'normal' || n.collapsed ? n.size : false);
      for (const key of ['labels', 'collapsed', 'f']) attr(`data-gz-nav-${key}`, n[key]); attr('data-gz-nav-no-logo', !n.logo);
      attr('data-gz-nav', n.k !== 'default' && (n.k === 'image' && !src ? 'solid' : n.k));
      for (const [key, value] of Object.entries({ ink: n.ink, c: n.c, d: n.d, a: `${n.a}deg`, o: n.o / 100, img: src ? `url("${src}")` : 'none' })) variable(`--gz-nav-${key}`, value);
      const cards = GZ_CARDS.page(GZ_CARDS.settings(s.card));
      for (const [key, value] of Object.entries(cards.vars)) variable(key, value);
      for (const [key, value] of Object.entries(cards.attrs)) attr(`data-gz-card-${key}`, value);
      if (site === 'canvas') sidebar(s);
      samples(s);
      globalThis.GZ_MOTIONX?.sync();
      if (s.enabled && drawn && sig !== sceneBad) {
        const file = kind === 'media' ? 'lib/scene-media.js' : 'lib/scene.js';
        if (scene && sceneFile !== file) { scene.stop(); scene = null; sceneCanvas?.remove(); }
        sceneModule[file] ||= import(chrome.runtime.getURL(file));
        try {
          const module = await sceneModule[file]; if (mine !== revision) return;
          if (!scene) {
            sceneFile = file;
            sceneCanvas = Object.assign(document.createElement(file === 'lib/scene.js' ? 'canvas' : 'div'), { id: 'gz-scene' }); sceneCanvas.setAttribute('aria-hidden', 'true'); document.body.append(sceneCanvas);
            // What the scene can't draw stays the gradient until the Look changes (lib/scene.js tells this frame's parent why).
            scene = module.start(sceneCanvas, () => !!chrome.runtime?.id, () => { sceneBad = sceneShown; scene = null; sceneCanvas.remove(); });
          }
          sceneShown = sig;
          scene.update({ kind, name: s.bg.scene, x, palette: colors, ground: colors['--gz-surface-2'], colors: GZ_BG_COLORS(s.bg.colors, colors), dim: look.dim, amount: look.amount, speed: look.pace * ({ off: 0, expressive: 1.6 }[motion] ?? 1) });
        } catch { scene?.stop(); scene = null; sceneCanvas?.remove(); }
      } else { scene?.stop(); scene = null; sceneCanvas?.remove(); }
    };
    addEventListener('message', (e) => { if (e.origin === location.origin && e.source === parent && e.data?.gzPreview) { settings = { ...GZ_SANITIZE(e.data.gzPreview), card: GZ_CARDS.settings(e.data.gzPreview.card) }; globalThis.GZ_XPARTS_PAGE?.preview(e.data.gzPreviewParts); paint(); } });
    // Look parts (lib/lookparts.js), handed over as the Ultra preview's content.js has them: GZ_CTX.parts() and `glaze:parts`.
    globalThis.GZ_CTX ||= Object.freeze({
      site, tabsPreview: () => context.page === 'tabs', settings: () => settings, t: (word, vars) => GZ_I18N.t(word, vars, settings.lang === 'auto' ? navigator.language : settings.lang),
      locale: () => settings.lang === 'auto' ? navigator.language : settings.lang, nickOf: () => '',
      courseList: () => Object.fromEntries(['#3b82f6', '#db2777', '#16a34a'].map((color, i) => [`canvas:${location.origin}/${i + 1}`, { color }])),
      setVar: (key, value) => variable(key, value),
      scene: () => {},
      ...(site === 'moodle' ? { setVar: (key, value) => variable(key, value), nav: () => settings.nav } : {}),
      on: () => settings.enabled,
      parts: () => (settings.enabled && context.page !== 'quiz' && globalThis.GZ_XPARTS_PAGE?.now()) || null,
      need: (file, ready) => ready() ? Promise.resolve() : load(file),
      moment: (name) => document.dispatchEvent(new CustomEvent('glaze:moment', { detail: { name } })),
    });
    // The Look's page tweaks and motion on the mock, through the page's own code (each reads GZ_CTX as it loads).
    for (const file of ['lib/lookx.js', 'features/rules.js', 'features/motionx.js']) await load(file);
    if (site === 'canvas') for (const file of ['features/coursetabs.js', 'lib/navbar.js', 'features/navbar-canvas.js', 'features/navbar-widgets.js', 'features/navbar.js']) await load(file);
    if (site === 'moodle') for (const file of ['lib/navbar.js', 'features/navbar-moodle.js', 'features/navbar-widgets.js', 'features/navbar.js']) await load(file);
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', paint);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
    document.addEventListener('glaze:parts', paint);
    await paint();
  }
  document.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });
  applyContext(); html.dataset.previewReady = 'true'; parent.postMessage({ gzPreviewReady: true }, location.origin);
})().catch(() => parent.postMessage({ gzPreviewFailed: true }, location.origin));
