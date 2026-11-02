// MyLab appearance and worksheet layout. Pearson retains its DOM, equation editor and events.
// No answer values, problem text, grades or course data are read, copied or sent.
(() => {
  if (globalThis.__gzPearson || document.contentType !== 'text/html') return;
  const shell = location.origin === 'https://mylab.pearson.com' && /^\/Student\/(PlayerHomework|OverviewHomework)\.aspx$/i.exec(location.pathname);
  const player = location.origin === 'https://tdx.acs.pearson.com' && /^\/(Player\/Player|assignment\/assignmentplayer)\.aspx$/i.test(location.pathname);
  if (!shell && !player) return;
  globalThis.__gzPearson = true;
  const html = document.documentElement, before = new Map(), attrs = new Map(), icons = new Map(), symbols = new Map();
  const keys = ['enabled', 'colors', 'look', 'auto', 'presets', 'bg', 'nav', 'motion', 'extras', 'lookX', 'enhance'];
  const darkMQ = matchMedia('(prefers-color-scheme: dark)'), calmMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const t = (key) => GZ_I18N.t(key, {}, GZ_I18N.ui());
  let settings = null, timer = 0, revision = 0, stopped = false, modeNode = null, backdrop = null, controls = null, iconFilter = null;
  let localViewer = null, navOpen = matchMedia('(min-width: 900px)').matches, pointer = '', pointerKey = '', lookPointer = '', ownPointer = '', navImage = '';
  let motionSheet = null, motionStyle = null, motionCss = '';
  const svgNS = 'http://www.w3.org/2000/svg';
  // Only the artwork changes. The original button, native shortcut, disabled state and handler stay Pearson's.
  const fraction = '<text x="16" y="11" font-size="11">a</text><path d="M7 16h18"/><text x="16" y="28" font-size="11">b</text>';
  const glyphs = {
    iconDiv: fraction, iconMnum: '<text x="5" y="22" font-size="18">2</text><g transform="translate(9 0) scale(.7 1)">' + fraction + '</g>',
    iconSup: '<text x="12" y="25" font-size="22">x</text><text x="23" y="12" font-size="13">n</text>',
    iconSub: '<text x="12" y="22" font-size="22">x</text><text x="23" y="28" font-size="12">n</text>',
    iconSqrt: '<path d="m3 18 4-2 4 10 5-21h13"/><text x="23" y="24" font-size="18">x</text>',
    iconNRoot: '<text x="5" y="11" font-size="10">n</text><path d="m3 18 4-2 4 10 5-21h13"/><text x="23" y="24" font-size="18">x</text>',
    iconMatrix: '<path d="M7 4H3v24h4m18-24h4v24h-4"/><text x="11" y="13" font-size="10">a</text><text x="21" y="13" font-size="10">b</text><text x="11" y="25" font-size="10">c</text><text x="21" y="25" font-size="10">d</text>',
    iconDeterminant: '<path d="M3 4v24M29 4v24"/><text x="11" y="13" font-size="10">a</text><text x="21" y="13" font-size="10">b</text><text x="11" y="25" font-size="10">c</text><text x="21" y="25" font-size="10">d</text>',
    iconDSum: '<text x="16" y="10" font-size="9">n</text><text x="16" y="24" font-size="18">∑</text><text x="16" y="31" font-size="8">i=1</text>',
    ...Object.fromEntries(Object.entries({iconCup:'∪',iconCap:'∩',iconInf:'∞',iconAbs:'|x|',iconOrderedPair:'(x,y)',iconPlus:'+',iconMinus:'−',iconCross:'×',iconDivideSymbol:'÷',iconDot:'·',iconLT:'<',iconLE:'≤',iconGT:'>',iconGE:'≥',iconEqual:'=',iconNE:'≠',iconPI:'π',iconI:'i',iconE:'e',iconSmScriptL:'ℓ',iconPipe:'|',iconEmpty:'∅',iconAngle:'cis',iconCDelta:'Δ',iconPrimeImg1:'′',iconIn:'∈',iconNotIn:'∉',iconSubset:'⊆',iconNotSubset:'⊈',iconPropSubset:'⊂',iconNotPropSubset:'⊄',iconAlpha:'α',iconBeta:'β',iconGamma:'γ',iconDelta:'δ',iconEpsi:'ε',iconTheta:'θ',iconMu:'μ',iconSigma:'σ',iconLambda:'λ',iconSum:'∑'}).map(([key,value])=>[key,`<text x="16" y="24" font-size="${value.length>3?15:24}">${value.replace('<','&lt;')}</text>`])),
  };
  const restoreSymbol = (node, value) => {
    node.querySelectorAll('.gz-pearson-symbol').forEach((e) => e.remove()); node.removeAttribute('data-gz-pearson-symbol');
    if (value.label === null) node.removeAttribute('aria-label'); else node.setAttribute('aria-label', value.label);
  };
  const syncSymbols = () => {
    for (const node of document.querySelectorAll('.toolButton, .xlInlineMathPalette .dijitDialogCloseIcon')) {
      const name = [...node.classList].find((key) => Object.hasOwn(glyphs,key)) || '';
      if (symbols.has(node) && symbols.get(node).name === name && (!name || node.querySelector('.gz-pearson-symbol'))) {
        if (node.classList.contains('dijitDialogCloseIcon') && symbols.get(node).label === null) node.setAttribute('aria-label',t('Close'));
        continue;
      }
      if (symbols.has(node)) restoreSymbol(node, symbols.get(node));
      const label = node.getAttribute('aria-label'); symbols.set(node, {label, name});
      if (!label && node.title.trim()) node.setAttribute('aria-label', node.title.trim().replace(/\s+/g,' '));
      if (!label && node.classList.contains('dijitDialogCloseIcon')) node.setAttribute('aria-label',t('Close'));
      node.querySelectorAll('.gz-pearson-symbol').forEach((e) => e.remove());
      if (!name) continue;
      const svg = document.createElementNS(svgNS,'svg'); svg.classList.add('gz-pearson-symbol');
      svg.setAttribute('viewBox','0 0 32 32'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('focusable','false');
      svg.innerHTML = glyphs[name]; node.setAttribute('data-gz-pearson-symbol',''); node.append(svg);
    }
    for (const [node,value] of symbols) if (!node.isConnected) { restoreSymbol(node,value); symbols.delete(node); }
  };
  const syncMotion = () => {
    if (!motionCss) { if (motionSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s=>s!==motionSheet); motionStyle?.remove(); motionStyle=null; motionSheet=null; return; }
    try { motionSheet ||= new CSSStyleSheet(); motionSheet.replaceSync(motionCss); if (!document.adoptedStyleSheets.includes(motionSheet)) document.adoptedStyleSheets=[...document.adoptedStyleSheets,motionSheet]; }
    catch { motionStyle ||= Object.assign(document.createElement('style'), {id:'gz-pearson-motion'}); motionStyle.textContent=motionCss; if (!motionStyle.isConnected) (document.head||html).append(motionStyle); }
  };
  const put = (key, value) => {
    if (!before.has(key)) before.set(key, [html.style.getPropertyValue(key), html.style.getPropertyPriority(key)]);
    if (value === '') html.style.removeProperty(key); else html.style.setProperty(key, value);
  };
  const attr = (key, value) => {
    if (!attrs.has(key)) attrs.set(key, html.getAttribute(key));
    if (value === false || value == null) html.removeAttribute(key); else html.setAttribute(key, value === true ? '' : value);
  };
  const kind = () => shell ? (shell[1].toLowerCase() === 'overviewhomework' ? 'overview' : 'shell')
    : modeNode?.classList.contains('playmode-homework') ? 'player' : null;
  const active = () => !stopped && !!chrome.runtime?.id && settings?.enabled && !!kind();
  const restoreIcon = (node, value) => {
    node.removeAttribute('data-gz-pearson-icon');
    if (value[0]) node.style.setProperty('--gz-pearson-icon', ...value); else node.style.removeProperty('--gz-pearson-icon');
  };
  const restoreIcons = () => {
    for (const [node,value] of symbols) restoreSymbol(node,value);
    symbols.clear();
    for (const [node, value] of icons) restoreIcon(node, value);
    icons.clear();
    iconFilter?.remove(); iconFilter = null;
  };
  const syncIcons = () => {
    if (!active()) return;
    syncSymbols();
    // The image is the glyph on these buttons. Recolor its own layer with SourceAlpha, retaining
    // Pearson's artwork. A CSS mask would refuse the CDN's images without CORS permission.
    if (iconFilter && !iconFilter.isConnected) iconFilter = null;
    if (!iconFilter && document.body) {
      const svg = (tag) => document.createElementNS('http://www.w3.org/2000/svg', tag);
      iconFilter = svg('svg'); iconFilter.id = 'gz-pearson-icon-filters'; iconFilter.setAttribute('aria-hidden', 'true');
      for (const name of ['ink', 'nav']) {
        const filter = svg('filter'), flood = svg('feFlood'), composite = svg('feComposite');
        filter.id = `gz-pearson-icon-${name}`; filter.setAttribute('color-interpolation-filters', 'sRGB');
        flood.style.setProperty('flood-color', name === 'nav' ? 'var(--gz-nav-ink)' : 'var(--gz-ink)');
        flood.setAttribute('result', 'paint'); composite.setAttribute('in', 'paint'); composite.setAttribute('in2', 'SourceAlpha'); composite.setAttribute('operator', 'in');
        filter.append(flood, composite); iconFilter.append(filter);
        put(`--gz-pearson-icon-${name}`, `url("#${filter.id}")`);
      }
      document.body.append(iconFilter);
    }
    // Set the resolved color on the SVG primitive too: CSS filter rasters do not consistently
    // invalidate when only an inherited custom property changes (notably a dark/light switch).
    for (const flood of iconFilter?.querySelectorAll('feFlood') || []) flood.style.setProperty('flood-color', flood.parentElement.id.endsWith('-nav') ? settings.nav.ink : html.style.getPropertyValue('--gz-ink'));
    for (const node of document.querySelectorAll('.toolButton, .btnOverview, .btnPrev, .btnNext, .xlPlayerOptionsIcon, .left-minimize-icon')) {
      if (icons.has(node)) continue;
      const copied = node.hasAttribute('data-gz-pearson-icon');
      const image = copied ? node.style.getPropertyValue('--gz-pearson-icon') : getComputedStyle(node).backgroundImage;
      if (!image.startsWith('url(')) continue;
      icons.set(node, copied ? ['', ''] : [node.style.getPropertyValue('--gz-pearson-icon'), node.style.getPropertyPriority('--gz-pearson-icon')]);
      node.style.setProperty('--gz-pearson-icon', image); node.setAttribute('data-gz-pearson-icon', '');
    }
    for (const [node, value] of icons) if (!node.isConnected) { restoreIcon(node, value); icons.delete(node); }
  };
  const clear = () => {
    clearTimeout(timer);
    backdrop?.remove(); backdrop = null; controls?.remove(); controls = null; restoreIcons();
    if (motionSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s=>s!==motionSheet);
    motionStyle?.remove(); motionStyle=null; motionSheet=null;
    if (pointer) URL.revokeObjectURL(pointer);
    pointer = ''; pointerKey = '';
    for (const [key, value] of attrs) { if (value === null) html.removeAttribute(key); else html.setAttribute(key, value); }
    attrs.clear();
    for (const [key, [value, priority]] of before) { if (value) html.style.setProperty(key, value, priority); else html.style.removeProperty(key); }
    before.clear();
  };
  const viewer = () => active() && modeNode?.id === 'playerViewer' && (localViewer ?? settings.enhance.pearsonViewer);
  const syncViewer = () => {
    const main = modeNode?.id === 'playerViewer' && modeNode.querySelector('.mainPanel');
    const content = main && main.querySelector('.contentPanel');
    const supported = !!content && getComputedStyle(content).display !== 'none';
    const on = viewer() && supported;
    attr('data-gz-pearson-viewer', on); attr('data-gz-pearson-questions', on && navOpen);
    if (!main || !active()) { controls?.remove(); controls = null; return; }
    if (!controls || !controls.isConnected) {
      main.querySelectorAll('.gz-pearson-controls').forEach((e) => e.remove());
      controls = Object.assign(document.createElement('div'), { className: 'gz-pearson-controls' });
      const questions = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Questions') });
      const layout = Object.assign(document.createElement('button'), { type: 'button' });
      questions.addEventListener('click', () => {
        GZ_MOTION.flip(() => [...main.querySelectorAll('.contentPanel > .dijitBorderContainer')], () => { navOpen = !navOpen; syncViewer(); }, {enter:false});
      });
      layout.addEventListener('click', () => { localViewer = !viewer(); syncViewer(); });
      controls.append(questions, layout); main.append(controls);
    }
    const [questions, layout] = controls.children;
    controls.hidden = !supported;
    questions.hidden = !on; questions.setAttribute('aria-expanded', String(navOpen));
    const nav = main.querySelector('.assignmentreviewnavpanel');
    if (nav?.id) questions.setAttribute('aria-controls', nav.id);
    questions.textContent = t('Questions');
    layout.textContent = on ? t('Pearson layout') : t('Problem viewer'); layout.setAttribute('aria-pressed', String(on));
  };
  const syncBackdrop = () => {
    if (backdrop && !backdrop.isConnected) backdrop = null;
    const here = kind() === 'overview' || modeNode?.id === 'playerViewer';
    if (!active() || !here || settings.bg.kind === 'solid' || !document.body) { backdrop?.remove(); backdrop = null; return; }
    if (!backdrop) {
      backdrop = Object.assign(document.createElement('iframe'), { id: 'gz-pearson-backdrop', tabIndex: -1, title: 'Glaze background', referrerPolicy: 'origin' });
      backdrop.setAttribute('aria-hidden', 'true'); backdrop.inert = true;
      backdrop.src = chrome.runtime.getURL('preview.html?site=canvas&backdrop&saved'); document.body.prepend(backdrop);
    }
  };
  const syncPointer = () => {
    const chosen = GZ_LX.pointerOf(settings.extras.pointer, lookPointer, settings.extras.pointerOn), key = chosen === 'own' ? ownPointer : chosen;
    if (key !== pointerKey) {
      if (pointer) URL.revokeObjectURL(pointer);
      pointer = ''; pointerKey = key;
      if (chosen === 'own' && GZ_LX.DATA.test(ownPointer) && ownPointer.length <= GZ_LX.IMG_MAX * 2) {
        try {
          const [head, b64] = ownPointer.split(',');
          pointer = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: head.slice(5, head.indexOf(';')) }));
        } catch { /* system pointer */ }
      }
    }
    const known = GZ_LX.CURSORS[chosen], url = (f) => chrome.runtime.getURL(f);
    attr('data-gz-cursor', !!known || !!pointer);
    put('--gz-cursor', pointer ? `url("${pointer}") 0 0, auto` : known ? `${GZ_LX.cursorCss(chosen, 'default', url, false)}, auto` : '');
    put('--gz-cursor-pointer', pointer ? `url("${pointer}") 0 0, pointer` : known ? `${GZ_LX.cursorCss(chosen, 'pointer', url, false)}, pointer` : '');
  };
  const paint = () => {
    clearTimeout(timer);
    if (!active()) { clear(); return; }
    const s = settings, colors = GZ_ACTIVE_COLORS(s, darkMQ.matches);
    for (const [key, value] of Object.entries(colors)) put(key, value);
    for (const [key, value] of Object.entries(GZ_SURFACE_VARS(s))) put(key, value);
    put('--gz-surface-opacity', `${GZ_UI.readable(s, colors)}%`);
    for (const [key, value] of Object.entries({ radius: `${s.look.radius}px`, glass: `${s.look.glass}px`, scale: s.look.scale, leading: s.look.leading,
      font: GZ_FONTS.stack(s.look.font), 'font-head': GZ_FONTS.stack(s.look.head === 'auto' ? s.look.font : s.look.head) })) put(`--gz-${key}`, value);
    const dark = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < .5;
    put('--gz-pearson-scheme', dark ? 'dark' : 'light'); attr('data-gz-pearson-dark', dark); attr('data-gz-pearson', kind());
    attr('data-gz-bg', s.bg.kind); attr('data-gz-depth', String(s.look.depth)); attr('data-gz-density', s.look.density);
    attr('data-gz-motion', s.motion.followSystem && calmMQ.matches ? 'off' : s.motion.level);
    attr('data-gz-no-enter', !s.motion.enter);
    attr('data-gz-no-hover', !s.motion.hover); attr('data-gz-no-trans', !s.motion.transitions);
    for (const font of [s.look.font, s.look.head]) GZ_FONTS.load(font);
    attr('data-gz-pearson-nav', s.nav.k === 'default' ? false : s.nav.k);
    for (const [key, value] of Object.entries({ ink: s.nav.ink, c: s.nav.c, d: s.nav.d, a: `${s.nav.a}deg`, o: s.nav.o / 100, img: navImage ? `url(${JSON.stringify(navImage)})` : 'none' })) put(`--gz-nav-${key}`, value);
    syncMotion(); syncPointer(); syncBackdrop(); syncViewer(); syncIcons();
    if (s.auto.on && s.auto.mode === 'schedule') {
      const at = GZ_SCHEDULE_NEXT(s.auto.from, s.auto.to, new Date()); if (at) timer = setTimeout(paint, Math.max(0, at - Date.now()) + 20);
    }
  };
  const read = () => {
    const turn = ++revision;
    try {
      chrome.storage.sync.get(keys, async (raw) => {
        if (stopped || turn !== revision) return;
        if (chrome.runtime.lastError || !chrome.runtime.id) { settings = null; clear(); return; }
        try {
          const next = GZ_SANITIZE(raw || {}), local = GZ_XPARTS.areas(chrome).local;
          const stored = await GZ_XPARTS.stored(raw?.lookX, local), parts = await GZ_XPARTS.parse(stored);
          const images = await local.get(['cursorImg', ...(next.nav.i ? [`cardImg:${next.nav.i}`] : [])]);
          if (stopped || turn !== revision) return;
          if (settings?.enhance.pearsonViewer !== next.enhance.pearsonViewer) localViewer = null;
          settings = next; lookPointer = parts?.x?.pointer || ''; ownPointer = typeof images.cursorImg === 'string' ? images.cursorImg : '';
          motionCss = GZ_MX.compile(parts?.x?.anim);
          navImage = images[`cardImg:${next.nav.i}`] || next.nav.u; paint();
        } catch { settings = null; clear(); }
      });
    } catch { settings = null; clear(); }
  };
  const modeWatch = new MutationObserver(paint);
  const find = () => {
    const next = document.querySelector('#playerViewer, #assignmentViewer');
    if (next === modeNode) return;
    modeWatch.disconnect(); modeNode = next;
    if (next) modeWatch.observe(next, { attributes: true, attributeFilter: ['class'] });
    paint();
  };
  const mountWatch = new MutationObserver((records) => {
    if (player && !modeNode?.isConnected) find();
    if (!active()) return;
    if (records.some((r) => r.addedNodes.length && !r.target.closest?.('.eqDocument, .gz-pearson-controls'))) { syncIcons(); syncViewer(); syncBackdrop(); }
  });
  mountWatch.observe(html, { childList: true, subtree: true }); if (player) find();
  // A blank extension frame can paint white before its Look is ready. Keep the palette underneath until its own renderer confirms a paint.
  addEventListener('message', (e) => {
    if (active() && backdrop && e.source === backdrop.contentWindow && e.origin === new URL(chrome.runtime.getURL('')).origin && e.data?.gzPearsonBackdropReady === true) backdrop.setAttribute('data-ready','');
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && keys.some((key) => changes[key])) || (area === 'local' && (changes.lookX || changes.cursorImg || Object.keys(changes).some((k) => k.startsWith('cardImg:'))))) read();
  });
  darkMQ.addEventListener('change', paint); calmMQ.addEventListener('change', paint);
  addEventListener('pagehide', (e) => { if (e.persisted) { clearTimeout(timer); backdrop?.remove(); backdrop = null; } else { stopped = true; revision++; clear(); mountWatch.disconnect(); modeWatch.disconnect(); } });
  addEventListener('pageshow', (e) => { if (e.persisted) read(); }); addEventListener('focus', read);
  const words = GZ_I18N.file(GZ_I18N.ui());
  if (words) {
    globalThis.__gzDoc = crypto.randomUUID();
    try { chrome.runtime.sendMessage({ type: 'glaze:load', files: [words], doc: globalThis.__gzDoc }, () => { if (!chrome.runtime.lastError && active()) { syncViewer(); syncIcons(); } }); } catch { /* English fallback */ }
  }
  read();
})();
