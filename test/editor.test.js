// Editor ownership and safe-reset regressions; real generated DOM ownership is also checked by the browser gate.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), D = require(path.join(root, 'defaults.js'));
for (const file of ['todo', 'widgets', 'remind', 'nav', 'coursetabs']) require(path.join(root, `lib/${file}.js`));
const N = require(path.join(root, 'lib/nav-items.js')), E = require(path.join(root, 'lib/editor.js'));
const cards = require(path.join(root, 'lib/cards.js'));
const TABS = ['look', 'navigation', 'blackboard', 'canvas', 'moodle', 'study', 'sharing', 'mods', 'backup', 'about'];
const GROUP = { auto: 'look/palette', look: 'look/type', bg: 'look/background', motion: 'look/motion', extras: 'look/extras', nav: 'look/navigation', navbar: 'navigation/bar', sidebar: 'navigation/sidebar', tabs: 'navigation/tabs', todo: 'study/todo', widgets: 'study/widgets', remind: 'study/reminders', declutter: 'blackboard/declutter', card: 'look/cards', courses: 'look/courses', mods: 'backup/privacy' };
const ENHANCE = {
  'study/tools': ['urgency', 'clamp', 'scores', 'reading', 'previews', 'progress', 'keys', 'newcontent', 'palette', 'drafts', 'download', 'search', 'place', 'coursemenu', 'docPages', 'toggles'],
  'study/grades': ['inline', 'overall', 'newgrades', 'calc', 'gradeHover', 'gpa', 'gpaPlus', 'gpaWeighted', 'gpaAfter'],
  'study/todo': ['todo', 'cardTasks', 'gradescope'],
  'study/widgets': ['notes', 'widgets'],
  'navigation/sidebar': ['sidebar'],
  'study/pet': ['pet'],
  'study/reminders': ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak'],
  'study/imports': ['syllabus', 'insights'],
  'navigation/tabs': ['tabs'], 'blackboard/dashboard': ['dashboard'], 'blackboard/folders': ['hideFolders'],
  'canvas/documents': ['docTheme', 'docInk'], 'canvas/quizzes': ['quizLight'],
};
const OVERRIDE = {
  enabled: 'header', footer: 'blackboard/declutter', preset: 'look/palette', presets: 'look/palette',
  'widgets.land': 'blackboard/dashboard',
  ...Object.fromEntries(['glass', 'depth', ...Object.keys(D.GZ_SPEC.look).filter((k) => /^(surface|shadow)/.test(k))].map((k) => [`look.${k}`, 'look/surfaces'])),
  ...Object.fromEntries(Object.entries(ENHANCE).flatMap(([section, keys]) => keys.map((key) => [`enhance.${key}`, section]))),
  ...Object.fromEntries(Object.keys(N.SPEC).map((key) => [`nav.${key}`, 'blackboard/nav'])),
  ...Object.fromEntries(['icsDue', 'icsTasks', 'icsPlan', 'icsGs', 'icsClasses', 'icsRange'].map((key) => [`todo.${key}`, 'study/schedule'])),
};
// These are real existing picker/group carriers, not invented inputs for internal bookkeeping or storage IDs.
const SPECIAL = {
  enabled: ['enabled'], preset: ['presets'], presets: ['mine'],
  'look.font': ['font-grid'], 'look.head': ['font-grid'], 'look.mono': ['font-grid'],
  'bg.image': ['bg-image'], 'bg.colors': ['bg-colors'],
  'nav.u': ['nav-url'], 'nav.i': ['nav-file'], 'nav.li': ['nav-logo-file'],
  'declutter.tabs': ['declutter-tabs'], 'sidebar.off': ['sidebar-off'],
  ...Object.fromEntries(D.GZ_COLORS.map(([key]) => [`colors.${key}`, ['colors']])),
  ...Object.fromEntries(['colors', 'tinted', 'looks', 'names'].map((key) => [`courses.${key}`, ['course-list', 'org-list']])),
};
const ACTIONS = {
  'look/palette': ['looks', 'save-preset', 'reset-colors', 'share-copy', 'share-code', 'share-try', 'share-offer', 'share-apply', 'share-fav', 'share-cancel', 'gallery-link', 'favorites', 'history', 'history-back', 'history-clear'],
  'look/type': ['font-custom', 'font-use'], 'look/background': ['bg-sets', 'x-shader', 'x-layers'], 'look/motion': ['x-motion'],
  'look/extras': ['rotate-looks', 'cursor-pick', 'cursor-file'],
  'look/navigation': ['nav-pick', 'nav-file', 'nav-url'],
  'look/cards': ['card-set', 'card-set-clear'], 'look/courses': ['course-list', 'org-list'],
  'blackboard/nav': ['nav-items', 'nav-widgets', 'nav-logo-pick', 'nav-logo-file', 'nav-link-name', 'nav-link-url', 'nav-link-icon', 'nav-link-tab', 'nav-link-save', 'nav-link-cancel', 'nav-reset'],
  'sharing/sessions': ['ss-status', 'ss-resume', 'ss-pause', 'ss-refresh', 'ss-sessions', 'ss-name', 'ss-title', 'ss-kind', 'ss-sources', 'ss-expire', 'ss-create', 'ss-invite', 'ss-join'],
  'sharing/calendar': ['gcal', 'gcal-connect', 'gcal-code', 'gcal-link', 'gcal-reconnect', 'gcal-share', 'gcal-disconnect', 'gcal-pair', 'gcal-id', 'gcal-copy'],
  'backup/privacy': ['export', 'import-btn', 'import', 'reset-all'], 'backup/notes': ['nb-account', 'nb-export', 'nb-import', 'nb-file', 'nb-status'], 'about/glaze': ['report-link', 'news', 'news-close'],
};

// A static markup reader for this checked-in page, not a browser/HTML implementation. Scripts/styles/comments are
// excluded; dynamic pickers are checked as explicit carriers above and by the eventual real-page DOM gate.
const parse = (html) => {
  const nodes = [], stack = [], voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  html = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const m of html.matchAll(/<(\/?)([a-z][\w:-]*)\b([^>]*?)>/gi)) {
    const tag = m[2].toLowerCase();
    if (m[1]) { const at = stack.findLastIndex((n) => n.tag === tag); if (at !== -1) stack.length = at; continue; }
    const attrs = Object.fromEntries([...m[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((x) => [x[1], x[2] ?? x[3] ?? x[4] ?? '']));
    const node = { n: nodes.length, tag, attrs, parents: [...stack] }; nodes.push(node);
    if (!voids.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
  }
  return nodes;
};
const nodes = parse(fs.readFileSync(path.join(root, 'options.html'), 'utf8'));
const byId = (id) => nodes.filter((n) => n.attrs.id === id);
const owner = (node) => [node, ...node.parents.toReversed()].find((n) => n.attrs['data-editor-section'])?.attrs['data-editor-section'] || (node.parents.some((n) => n.tag === 'header') ? 'header' : undefined);
const preview = (node) => [node, ...node.parents].some((n) => n.attrs.id === 'preview' || (n.attrs.class || '').split(/\s+/).includes('preview'));
const schema = { ...D.GZ_SPEC, card: cards.SPEC };
const expected = [
  ...Object.entries(schema).flatMap(([group, keys]) => Object.keys(keys).map((key) => `${group}.${key}`)),
  ...Object.keys(D.GZ_DEFAULTS.courses).map((key) => `courses.${key}`), ...D.GZ_COLORS.map(([key]) => `colors.${key}`),
  'enabled', 'footer', 'preset', 'presets',
];
const section = (key) => OVERRIDE[key] || (key.startsWith('colors.') ? 'look/palette' : GROUP[key.split('.')[0]]);

test('E1 every schema setting has one explicit owning section, including modules loaded by the editor', () => {
  assert.equal(new Set(expected).size, expected.length);
  for (const key of expected) assert.ok(section(key), `No section for ${key}; update the inventory after a schema change`);
  assert.deepEqual(Object.keys(D.GZ_SPEC.enhance).sort(), Object.values(ENHANCE).flat().sort());
  for (const key of Object.keys(OVERRIDE)) assert.ok(expected.includes(key), `Stale owner: ${key}`);
});

test('E1 course-tab label control exposes each accepted mode once and includes the default', () => {
  const select = nodes.find((node) => node.tag === 'select' && node.attrs['data-key'] === 'tabs.label');
  const options = nodes.filter((node) => node.tag === 'option' && node.parents.includes(select)).map((node) => node.attrs.value);
  assert.deepEqual(options, D.GZ_SPEC.tabs.label[1]); assert.equal(D.GZ_SPEC.tabs.label[0], 'short');
  assert.equal(options.filter((value) => value === 'short').length, 1);
});

test('E1 each setting has exactly one real control/group; radios, dynamic carriers and preview choices stay distinct', () => {
  const controls = new Map();
  const add = (key, id, route) => { if (!controls.has(key)) controls.set(key, new Map()); controls.get(key).set(id, route); };
  for (const node of nodes) {
    if (preview(node) || Object.hasOwn(node.attrs, 'data-local') || !['input', 'select', 'textarea'].includes(node.tag)) continue;
    const radio = node.attrs.type === 'radio', key = node.attrs['data-key'] || (radio && node.attrs.name?.includes('.') ? node.attrs.name : '');
    if (!key) continue;
    const group = radio && node.parents.findLast((n) => n.attrs.role === 'radiogroup' || (n.attrs.class || '').split(/\s+/).includes('seg'));
    assert.ok(expected.includes(key), `Unknown editor control: ${key}`);
    add(key, radio ? `radio:${group?.n ?? node.n}:${key}` : `control:${node.n}`, owner(node));
  }
  for (const [key, ids] of Object.entries(SPECIAL)) {
    assert.ok(expected.includes(key), `Stale dynamic control: ${key}`);
    for (const id of ids) { assert.equal(byId(id).length, 1, `Missing/duplicate carrier #${id}`); assert.equal(owner(byId(id)[0]), section(key), `${key}: #${id} has the wrong section`); }
    add(key, `carrier:${ids.join(',')}`, section(key));
  }
  for (const key of expected) {
    assert.equal(controls.get(key)?.size, 1, `${key} needs exactly one control or logical picker group`);
    assert.equal([...controls.get(key).values()][0], section(key), `${key} is in the wrong section`);
  }
  for (const node of nodes.filter((n) => Object.hasOwn(n.attrs, 'data-editor-alias'))) assert.ok(node.tag === 'a' && /^#[a-z]+\/[a-z-]+$/.test(node.attrs.href || ''), 'Section aliases are links, never duplicate controls');
});

test('E1 nine labelled tabs own panels and existing action IDs survive in their mapped sections', () => {
  const tabs = nodes.filter((n) => n.attrs.role === 'tab' && !preview(n));
  assert.equal(tabs.length, TABS.length);
  for (const tab of TABS) {
    const choices = tabs.filter((n) => n.attrs['data-editor-tab'] === tab); assert.equal(choices.length, 1, tab);
    const item = choices[0], panels = byId(item.attrs['aria-controls']);
    assert.equal(panels.length, 1, `${tab}: aria-controls`); assert.equal(panels[0].attrs.role, 'tabpanel'); assert.equal(panels[0].attrs['aria-labelledby'], item.attrs.id);
  }
  assert.equal(tabs.filter((n) => n.attrs.tabindex === '0').length, 1, 'One tab has keyboard focus');
  for (const [route, ids] of Object.entries(ACTIONS)) for (const id of ids) {
    assert.equal(byId(id).length, 1, `Missing/duplicate action #${id}`); assert.equal(owner(byId(id)[0]), route, `#${id} moved to the wrong section`);
  }
  for (const id of ['gcal-bye', 'gcal-drop']) assert.equal(byId(id).length, 1, `Preserve external modal #${id}`);
  for (const [id, owned] of Object.entries({ 'nav-items': ['navItems.order', 'navItems.hidden'], 'nav-link-editor': ['navItems.links'], 'nav-widgets': ['navItems.widgets'] })) {
    assert.deepEqual(byId(id)[0].attrs['data-setting-owner'].split(' '), owned);
    assert.equal(owner(byId(id)[0]), 'blackboard/nav');
  }
});

test('E1 section and global preference resets preserve pictures, preset libraries and unrelated data', () => {
  const defaults = { ...D.GZ_SANITIZE(), card: cards.settings() };
  const state = structuredClone(defaults);
  state.look.scale = 1.2; state.motion.level = 'off'; state.nav.i = 'background-image'; state.nav.li = 'logo-image';
  state.presets = [{ name: 'My palette', colors: { ...defaults.colors } }];
  const device = { notes: 'kept', tasks: 'kept', shareKeys: 'kept', pictures: ['background-image', 'logo-image'] };
  state.device = device;
  assert.deepEqual(E.reset(state, ['look.scale'], defaults), ['look']);
  assert.equal(state.look.scale, defaults.look.scale); assert.equal(state.motion.level, 'off');
  E.reset(state, Object.keys(defaults), defaults);
  assert.equal(state.nav.i, 'background-image'); assert.equal(state.nav.li, 'logo-image');
  assert.equal(state.presets[0].name, 'My palette'); assert.equal(state.device, device);
  const js = fs.readFileSync(path.join(root, 'options.js'), 'utf8').split("$('#reset-all').addEventListener")[1];
  assert.doesNotMatch(js, /cardsOp\(\{[^}]*reset: true|glaze:stickers[^\n]*reset: true/);
  assert.ok(js.includes('GZ_EDITOR.reset'));
});

test('E1 Ultra preview carries the chosen course color and nickname without saving a pending Look', () => {
  const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
  const preview = source.slice(source.indexOf('  const preview = () => {') + '  const preview = '.length, source.indexOf('\n  const contextPreview =')).replace(/;\s*$/, '');
  const state = D.GZ_SANITIZE({ courses: { tint: true, tinted: ['_1_1'], names: { '_1_1': 'My course' }, colors: { '_1_1': '#c03050' } } });
  const offer = D.GZ_SANITIZE({ ...state, courses: { ...state.courses, colors: { '_1_1': '#20a080' } } });
  const name = {}, section = { style: {}, querySelector: () => name }, messages = [];
  const context = vm.createContext({ s: state, offer: null, courses: { '_1_1': { name: 'Original course', slot: '2' }, '_2_1': { name: 'Other course', slot: '2' } },
    frame: { contentDocument: { querySelector: () => section }, contentWindow: { postMessage: (m) => messages.push(m) } },
    $: (selector) => ({ value: selector === '#preview-size' ? 'desktop' : 'current' }), location: { origin: 'chrome-extension://fixture' },
    previewSite: 'ultra', previewPage: 'outline', previewCourse: '', renderNav() {}, sizePreview() {}, previewItems: () => ({}),
    GZ_COURSE_VARS: D.GZ_COURSE_VARS, GZ_COURSE_COLORS: D.GZ_COURSE_COLORS, GZ_COURSE_LOOK: D.GZ_COURSE_LOOK, GZ_COURSE_TINTED: D.GZ_COURSE_TINTED,
  });
  vm.runInContext(`(${preview})()`, context);
  assert.equal(section.className, 'course course-color-2'); assert.equal(name.textContent, 'My course');
  assert.ok(section.style.cssText.includes('#c03050'));
  state.courses.looks._1_1 = D.GZ_LOOKS[0].name;
  vm.runInContext(`(${preview})()`, context);
  assert.equal(messages.at(-2).gzPreview.colors['--gz-surface'], D.GZ_LOOKS[0].colors['--gz-surface']);
  context.previewCourse = '_2_1'; vm.runInContext(`(${preview})()`, context);
  assert.equal(messages.at(-2).gzPreview.courses.tinted.length, 0, 'A selected untinted course must not borrow another course’s tint');
  context.previewCourse = '_1_1';
  context.offer = offer; vm.runInContext(`(${preview})()`, context);
  assert.ok(section.style.cssText.includes('#20a080')); assert.ok(messages.at(-2).gzPreview);
  assert.equal(state.courses.colors._1_1, '#c03050'); assert.equal(context.offer, offer);
});

test('E1 preview site changes replace the frame history so editor Back and Forward remain intact', () => {
  const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
  const change = source.slice(source.indexOf('  const contextPreview = (site, page) => {') + '  const contextPreview = '.length, source.indexOf('\n  followSection =')).replace(/;\s*$/, '');
  const navigations = [], controls = new Map();
  const control = (selector) => { if (!controls.has(selector)) controls.set(selector, { options: [], selectedOptions: [{ textContent: selector }] }); return controls.get(selector); };
  const frame = { contentWindow: { location: { replace: (url) => navigations.push(url) } } };
  Object.defineProperty(frame, 'src', { set() { assert.fail('Iframe src would create an extra history entry'); } });
  const context = vm.createContext({ frame, $: control, supportedPages: { ultra: ['outline'], canvas: ['courses'] }, previewSite: 'ultra', previewPage: 'outline',
    chrome: { runtime: { getURL: (path) => `chrome-extension://fixture/${path}` } }, t: (s) => s, preview() {},
  });
  vm.runInContext(`(${change})('canvas', 'courses')`, context);
  vm.runInContext(`(${change})('ultra', 'outline')`, context);
  assert.deepEqual(navigations, ['chrome-extension://fixture/preview.html?site=canvas', 'chrome-extension://fixture/preview.html?site=ultra']);
});

test('E1 switching an open phone preview to desktop removes modal semantics', () => {
  const source = fs.readFileSync(path.join(root, 'lib/editor-preview.js'), 'utf8');
  const apply = source.slice(source.indexOf('  const applyContext = () => {') + '  const applyContext = '.length, source.indexOf("\n  addEventListener('message'")).replace(/;\s*$/, '');
  const drawer = { role: 'dialog', 'aria-modal': 'true', removeAttribute(key) { delete this[key]; } }, menu = { setAttribute() {} };
  const context = vm.createContext({ site: 'ultra', context: { viewport: 'desktop', page: 'outline' }, html: { dataset: {}, removeAttribute() {} },
    document: { querySelectorAll: () => [], querySelector: (selector) => selector === '#preview-menu' ? menu : drawer, dispatchEvent() {} },
    CustomEvent: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(`(${apply})()`, context);
  assert.equal(drawer.role, undefined); assert.equal(drawer['aria-modal'], undefined);
});

test('E1 routes, remembered tabs, legacy entry points and tab-only keyboard handling reveal the owning panel', async () => {
  const events = {}, kept = [], wrappers = new Map(); let focused;
  for (const n of nodes) wrappers.set(n, {
    id: n.attrs.id || '', dataset: Object.fromEntries(Object.entries(n.attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase()), v])),
    attrs: { ...n.attrs }, hidden: Object.hasOwn(n.attrs, 'hidden'), events: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, f) { this.events[k] = f; }, focus() { focused = this; }, scrollIntoView() {},
    closest() { return wrappers.get([n, ...n.parents.toReversed()].find((x) => x.attrs['data-editor-section'])); },
  });
  const all = [...wrappers.values()], doc = { querySelectorAll: (selector) => {
    if (selector === '[data-editor-tab]') return all.filter((x) => x.dataset.editorTab);
    if (selector === '[data-editor-panel]') return all.filter((x) => x.dataset.editorPanel);
    if (selector === '[data-editor-section]') return all.filter((x) => x.dataset.editorSection);
    return all.filter((x) => x.id && x.closest());
  } };
  const ctx = vm.createContext({ document: doc, structuredClone, location: { hash: '#tabs' }, scrollY: 50, scrollTo() {}, requestAnimationFrame: (f) => f(),
    addEventListener: (k, f) => { events[k] = f; }, chrome: { storage: { local: { get: async () => ({ editorTab: 'about' }), set: async (v) => { kept.push(v); } } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/editor.js'), 'utf8'), ctx);
  const ui = ctx.GZ_EDITOR.mount();
  for (const [hash, route] of Object.entries({ '#tabs': 'navigation/tabs', '#blackboard/tabs': 'navigation/tabs', '#sidebar': 'look/navigation', '#todo': 'study/todo', '#gcal': 'sharing/calendar', '#data': 'backup/privacy', '#background': 'look/background', '#blackboard/nav': 'blackboard/nav', '#unknown/section': 'look/palette' })) {
    ctx.location.hash = hash; events.hashchange(); assert.equal(ui.route(), route);
    assert.equal(all.find((x) => x.dataset.editorPanel === route.split('/')[0]).hidden, false);
    assert.equal(all.filter((x) => x.dataset.editorTab && x.tabIndex === 0).length, 1);
  }
  const first = all.find((x) => x.dataset.editorTab === 'look'); let prevented = false;
  first.events.keydown({ key: 'End', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(focused.dataset.editorTab, 'about'); assert.equal(ui.route(), 'about/glaze');
  assert.ok(!all.find((x) => x.attrs['data-key'] === 'look.scale').events.keydown, 'native range keys are never intercepted');
  ui.finding(true); assert.ok(all.filter((x) => x.dataset.editorPanel).every((x) => !x.hidden && x.attrs.role === 'region'));
  ui.finding(false); assert.equal(all.filter((x) => x.dataset.editorPanel && !x.hidden).length, 1);
  await Promise.resolve(); assert.ok(kept.length);
});
