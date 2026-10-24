// Editor ownership and safe-reset regressions; real generated DOM ownership is also checked by the browser gate.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..'), D = require(path.join(root, 'defaults.js'));
for (const file of ['todo', 'widgets', 'remind', 'nav', 'coursetabs']) require(path.join(root, `lib/${file}.js`));
const N = require(path.join(root, 'lib/nav-items.js')), E = require(path.join(root, 'lib/editor.js'));
const cards = require(path.join(root, 'lib/cards.js'));
const TABS = ['look', 'navigation', 'courses', 'study', 'pages', 'sharing', 'mods', 'backup', 'about'];
const GROUP = { stream: 'pages/dashboard', docreview: 'pages/documents', auto: 'look/palette', look: 'look/type', bg: 'look/background', motion: 'look/motion', extras: 'look/extras', nav: 'navigation/bar', navbar: 'navigation/bar', sidebar: 'navigation/sidebar', tabs: 'navigation/tabs', todo: 'study/todo', widgets: 'study/widgets', remind: 'study/reminders', declutter: 'pages/declutter', card: 'courses/cards', courses: 'courses/list', mods: 'backup/privacy' };
const ENHANCE = {
  'pages/content': ['urgency', 'clamp', 'scores', 'reading', 'previews', 'progress', 'newcontent', 'drafts', 'download', 'place'],
  'pages/shortcuts': ['palette', 'search', 'keys'],
  'pages/documents': ['docPages', 'toggles', 'docTheme', 'docInk', 'quizLight'],
  'courses/list': ['coursemenu'],
  'study/grades': ['inline', 'overall', 'newgrades', 'calc', 'gradeHover', 'gpa', 'gpaPlus', 'gpaWeighted', 'gpaAfter'],
  'study/todo': ['todo', 'cardTasks', 'gradescope'],
  'study/widgets': ['notes', 'widgets'],
  'navigation/sidebar': ['sidebar'],
  'study/pet': ['pet'],
  'study/reminders': ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak'],
  'study/imports': ['syllabus', 'insights'],
  'navigation/tabs': ['tabs'], 'pages/dashboard': ['dashboard'], 'pages/declutter': ['hideFolders'],
};
const OVERRIDE = {
  enabled: 'header', footer: 'pages/declutter', preset: 'look/palette', presets: 'look/palette',
  'widgets.land': 'pages/dashboard',
  // The student's pointer and its animation have a section of their own; the rest of extras is stickers and rotation.
  'extras.pointer': 'look/pointer', 'extras.pointerAnim': 'look/pointer',
  ...Object.fromEntries(['radius', 'glass', 'depth', ...Object.keys(D.GZ_SPEC.look).filter((k) => /^(surface|shadow)/.test(k))].map((k) => [`look.${k}`, 'look/surfaces'])),
  ...Object.fromEntries(Object.entries(ENHANCE).flatMap(([section, keys]) => keys.map((key) => [`enhance.${key}`, section]))),
  ...Object.fromEntries(['icsDue', 'icsTasks', 'icsPlan', 'icsGs', 'icsClasses', 'icsRange'].map((key) => [`todo.${key}`, 'study/schedule'])),
};
// These are real existing picker/group carriers, not invented inputs for internal bookkeeping or storage IDs.
const SPECIAL = {
  enabled: ['enabled'], preset: ['presets'], presets: ['mine'],
  'look.font': ['font-grid'], 'look.head': ['font-grid'], 'look.mono': ['font-grid'],
  'bg.image': ['bg-image'], 'bg.colors': ['bg-colors'],
  'nav.u': ['nav-url'], 'nav.i': ['nav-file'], 'nav.li': ['nav-logo-file'],
  'declutter.tabs': ['declutter-tabs'], 'sidebar.off': ['sidebar-off'], 'extras.pointer': ['pointer-tiles'],
  ...Object.fromEntries(D.GZ_COLORS.map(([key]) => [`colors.${key}`, ['colors']])),
  ...Object.fromEntries(['colors', 'tinted', 'looks', 'names'].map((key) => [`courses.${key}`, ['course-list', 'org-list']])),
};
const ACTIONS = {
  'look/palette': ['looks', 'save-preset', 'reset-colors', 'share-copy', 'share-code', 'share-try', 'share-offer', 'share-apply', 'share-fav', 'share-cancel', 'gallery-link', 'favorites', 'history', 'history-back', 'history-clear'],
  'look/type': ['font-custom', 'font-use'], 'look/background': ['bg-sets', 'x-shader', 'x-layers'], 'look/motion': ['x-motion'],
  'look/pointer': ['pointer-tiles', 'pointer-pick', 'pointer-remove', 'pointer-file', 'pointer-anim-look'], 'look/extras': ['rotate-looks'],
  'navigation/bar': ['nav-pick', 'nav-file', 'nav-url', 'nav-items', 'nav-widgets', 'nav-logo-pick', 'nav-logo-file', 'nav-link-name', 'nav-link-url', 'nav-link-icon', 'nav-link-tab', 'nav-link-save', 'nav-link-cancel', 'nav-reset'],
  'navigation/items': ['nbar-items', 'nbar-glaze', 'nbar-widgets', 'nbar-links', 'nbar-link-form', 'nbar-mods', 'nbar-reset'],
  'courses/cards': ['card-set', 'card-set-clear'], 'courses/list': ['course-list', 'org-list'], 'study/pet': ['pet-library'],
  'sharing/sessions': ['ss-status', 'ss-resume', 'ss-pause', 'ss-refresh', 'ss-sessions', 'ss-name', 'ss-title', 'ss-kind', 'ss-sources', 'ss-expire', 'ss-create', 'ss-invite', 'ss-join'],
  'sharing/calendar': ['gcal', 'gcal-connect', 'gcal-code', 'gcal-link', 'gcal-reconnect', 'gcal-share', 'gcal-disconnect', 'gcal-pair', 'gcal-id', 'gcal-copy'],
  'backup/privacy': ['export', 'import-btn', 'import', 'reset-all'], 'backup/notes': ['nb-account', 'nb-export', 'nb-import', 'nb-file', 'nb-status'], 'about/glaze': ['report-link', 'news', 'news-close'],
};
// Each section's everyday controls stay in view; the rest sit in its "More options" (details.more). Keys and action IDs listed
// here are inside it; every other key and action of the inventory is outside it.
const NAV_MORE = Object.keys(N.SPEC).filter((k) => k !== 'li');
const MORE = {
  keys: [
    ...D.GZ_COLORS.map(([key]) => `colors.${key}`), 'presets',
    'look.leading', 'look.tooltips', 'look.hints',
    ...['surfaceOpacity', 'surfaceTint', 'surfaceTintSource', 'shadowStrength', 'surfaceFrost', 'surfaceBorder', 'surfaceCustom', 'surfaceColor', 'shadowCustom', 'shadowColor'].map((k) => `look.${k}`),
    ...['style', 'angle', 'blend', 'spread', 'dim', 'blur', 'grain'].map((k) => `bg.${k}`),
    'motion.enter', 'motion.hover', 'motion.transitions', 'extras.pointerAnim',
    ...['rail', 'peek', 'course', 'cmenu', 'tabs', 'badges', 'brand'].map((k) => `navbar.${k}`), ...NAV_MORE.map((k) => `nav.${k}`),
    ...['cap', 'place', 'shape', 'size', 'width', 'label', 'mark', 'color'].map((k) => `tabs.${k}`),
    ...Object.keys(D.GZ_SPEC.sidebar).filter((k) => !['canvas', 'ultra'].includes(k)).map((k) => `sidebar.${k}`),
    ...['width', 'gap', 'radius', 'height', 'icons', 'create'].map((k) => `card.${k}`),
    ...['group', 'rel', 'urgent', 'teacher', 'progress', 'sync', 'cardN', 'cardStatus', 'cardCross', 'gsDaily'].map((k) => `todo.${k}`),
    ...['gradeHover', 'gpaPlus', 'gpaWeighted', 'gpaAfter', 'urgency', 'clamp', 'scores', 'reading', 'place'].map((k) => `enhance.${k}`),
    ...['work', 'rest', 'sound', 'quotes', 'quoteMode', 'quoteEvery', 'inhale', 'hold', 'exhale', 'cycles'].map((k) => `widgets.${k}`),
    ...Object.keys(D.GZ_SPEC.docreview).map((k) => `docreview.${k}`), ...Object.keys(D.GZ_SPEC.stream).map((k) => `stream.${k}`),
  ],
  ids: ['save-preset', 'reset-colors', 'share-copy', 'share-code', 'share-try', 'favorites', 'history', 'history-back', 'history-clear', 'x-motion',
    'pointer-pick', 'pointer-remove', 'pointer-file', 'pointer-anim-look', 'nav-items', 'nav-widgets', 'nav-link-name', 'nav-link-url', 'nav-link-icon',
    'nav-link-tab', 'nav-link-save', 'nav-link-cancel', 'nav-reset', 'nbar-items', 'nbar-links', 'nbar-link-form', 'nbar-mods', 'card-set', 'card-set-clear', 'pet-library'],
};
// Sections only for power users: shown with All settings, while searching, or when an address leads to them.
const POWER = ['look/nav-layout', 'look/rules', 'study/schedule', 'sharing/relay', 'mods/widget', 'mods/dev', 'backup/notes'];
// Every address the settings had before the regrouping, and the categories' old names a stored editorTab may hold.
const OLD_ROUTES = ['look/palette', 'look/type', 'look/surfaces', 'look/background', 'look/cards', 'look/courses', 'look/navigation', 'look/nav-layout', 'look/rules', 'look/motion', 'look/pointer', 'look/extras',
  'navigation/bar', 'navigation/items', 'navigation/sidebar', 'navigation/tabs', 'blackboard/nav', 'blackboard/dashboard', 'blackboard/stream', 'blackboard/folders', 'blackboard/declutter', 'blackboard/tabs',
  'canvas/documents', 'canvas/quizzes', 'canvas/shared', 'moodle/courses', 'study/todo', 'study/grades', 'study/reminders', 'study/widgets', 'study/pet', 'study/imports', 'study/schedule', 'study/tools',
  'sharing/sessions', 'sharing/relay', 'sharing/calendar', 'mods/installed', 'mods/add', 'mods/widget', 'mods/dev', 'backup/privacy', 'backup/notes', 'backup/sites', 'about/glaze'];
const OLD_TABS = ['look', 'navigation', 'blackboard', 'canvas', 'moodle', 'study', 'sharing', 'mods', 'backup', 'about'];

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

test('E1 the labelled category tabs own panels and existing action IDs survive in their mapped sections', () => {
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
    assert.equal(owner(byId(id)[0]), 'navigation/bar');
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

test('resets give back the defaults this device started with: a fresh install keeps Notes and the pet habitat on', () => {
  const source = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
  const helper = source.slice(source.indexOf('  let freshHere = false;'), source.indexOf('  // Two clicks, so a stray one'));
  for (const fresh of [true, false]) {
    const defaults = vm.runInNewContext(`${helper}\ndefaultsHere()`, { GZ_SANITIZE: D.GZ_SANITIZE, GZ_CARDS: { settings: () => ({}) }, showResets() {},
      chrome: { storage: { local: { get: (k, cb) => cb({ freshDefaults: { fresh } }) } } } });
    assert.deepEqual([defaults.enhance.notes, defaults.enhance.pet], [fresh, fresh], fresh ? 'a fresh install' : 'an update');
  }
  for (const site of ["GZ_EDITOR.reset(s, [path], defaultsHere())", "GZ_EDITOR.reset(s, paths, defaultsHere())", "const defaults = defaultsHere();"]) assert.ok(source.includes(site), site);
  // A Reset shows only against this device's own defaults, once they are known.
  const shows = source.slice(source.indexOf('  showResets = () => {'), source.indexOf('  // Look parts builders'));
  assert.match(shows, /const defaults = defaultsHere\(\);[\s\S]*GZ_EDITOR\.differs\(s, paths, defaults\)[\s\S]*GZ_EDITOR\.differs\(s, \[b\.dataset\.resetSetting\], defaults\)/);
  assert.match(source, /freshHere = r\?\.freshDefaults\?\.fresh === true; showResets\(\);/);
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
    previewSite: 'ultra', previewPage: 'outline', previewCourse: '', renderNav() {}, renderContrast() {}, sizePreview() {}, paintBackdrop() {}, previewItems: () => ({}),
    GZ_COURSE_VARS: D.GZ_COURSE_VARS, GZ_COURSE_COLORS: D.GZ_COURSE_COLORS, GZ_COURSE_LOOK: D.GZ_COURSE_LOOK, GZ_COURSE_TINTED: D.GZ_COURSE_TINTED, GZ_LOOK_PARTS: require('../lib/lookset.js'),
  });
  vm.runInContext(`(${preview})()`, context);
  assert.equal(section.className, 'course course-color-2'); assert.equal(name.textContent, 'My course');
  assert.ok(section.style.cssText.includes('#c03050'));
  state.courses.looks._1_1 = D.GZ_LOOKS[0].name;
  vm.runInContext(`(${preview})()`, context);
  assert.equal(messages.at(-2).gzPreview.colors['--gz-surface'], D.GZ_LOOKS[0].colors['--gz-surface']);
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-2).gzPreviewParts)), { x: { pointer: 'frostdev' } });
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
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, hasAttribute(k) { return Object.hasOwn(this.attrs, k); },
    toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }, addEventListener(k, f) { this.events[k] = f; }, focus() { focused = this; }, scrollIntoView() {},
    closest() { return wrappers.get([n, ...n.parents.toReversed()].find((x) => x.attrs['data-editor-section'])); },
  });
  const all = [...wrappers.values()], doc = { querySelectorAll: (selector) => {
    if (selector === '[data-editor-tab]') return all.filter((x) => x.dataset.editorTab);
    if (selector === '[data-editor-panel]') return all.filter((x) => x.dataset.editorPanel);
    if (selector === '[data-editor-section]') return all.filter((x) => x.dataset.editorSection);
    if (selector === '[data-editor-jump]') return all.filter((x) => Object.hasOwn(x.dataset, 'editorJump'));
    if (selector === '[data-editor-jumps]') return all.filter((x) => x.dataset.editorJumps);
    if (selector === 'details.more') return [];
    return all.filter((x) => x.id && x.closest());
  } };
  const ctx = vm.createContext({ document: doc, structuredClone, location: { hash: '#tabs' }, scrollY: 50, scrollTo() {}, requestAnimationFrame: (f) => f(),
    addEventListener: (k, f) => { events[k] = f; }, chrome: { storage: { local: { get: async () => ({ editorTab: 'about' }), set: async (v) => { kept.push(v); } } } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/editor.js'), 'utf8'), ctx);
  const ui = ctx.GZ_EDITOR.mount();
  for (const [hash, route] of Object.entries({ '#tabs': 'navigation/tabs', '#blackboard/tabs': 'navigation/tabs', '#sidebar': 'navigation/bar', '#todo': 'study/todo', '#gcal': 'sharing/calendar', '#data': 'backup/privacy', '#background': 'look/background', '#blackboard/nav': 'navigation/bar', '#look/cards': 'courses/cards', '#canvas/shared': 'pages/content', '#study/tools': 'pages/content', '#blackboard': 'pages/dashboard', '#unknown/section': 'look/palette' })) {
    ctx.location.hash = hash; events.hashchange(); assert.equal(ui.route(), route);
    assert.equal(all.find((x) => x.dataset.editorPanel === route.split('/')[0]).hidden, false);
    assert.equal(all.filter((x) => x.dataset.editorTab && x.tabIndex === 0).length, 1);
  }
  const first = all.find((x) => x.dataset.editorTab === 'look'); let prevented = false;
  first.events.keydown({ key: 'End', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(focused.dataset.editorTab, 'about'); assert.equal(ui.route(), 'about/glaze');
  all.find((x) => x.dataset.editorTab === 'about').events.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(focused.dataset.editorTab, 'look', 'the side list wraps with the down arrow');
  first.events.keydown({ key: 'ArrowUp', preventDefault() {} }); assert.equal(focused.dataset.editorTab, 'about');
  all.find((x) => x.dataset.editorTab === 'about').events.keydown({ key: 'ArrowRight', preventDefault() {} }); assert.equal(focused.dataset.editorTab, 'look', 'and with the right arrow in the narrow row');
  all.find((x) => x.dataset.editorTab === 'look').events.keydown({ key: 'Home', preventDefault() {} }); assert.equal(ui.route(), 'look/palette');
  assert.ok(!all.find((x) => x.attrs['data-key'] === 'look.scale').events.keydown, 'native range keys are never intercepted');
  const power = all.find((x) => x.dataset.editorSection === 'mods/dev'), widget = all.find((x) => x.dataset.editorSection === 'mods/widget');
  assert.ok(power.hasAttribute('data-folded') && widget.hasAttribute('data-folded'), 'power-user sections wait for All settings');
  assert.ok(all.find((x) => x.attrs.href === '#mods/dev').hidden, 'and so do their links');
  ctx.location.hash = '#mods/dev'; events.hashchange(); assert.equal(ui.route(), 'mods/dev');
  assert.ok(!power.hasAttribute('data-folded') && widget.hasAttribute('data-folded'), 'an address shows the section it leads to');
  assert.equal(all.find((x) => x.attrs.href === '#mods/dev').hidden, false);
  ui.finding(true); assert.ok(all.filter((x) => x.dataset.editorPanel).every((x) => !x.hidden && x.attrs.role === 'region'));
  assert.ok(!widget.hasAttribute('data-folded'), 'search covers power-user sections');
  ui.finding(false); assert.equal(all.filter((x) => x.dataset.editorPanel && !x.hidden).length, 1); assert.ok(widget.hasAttribute('data-folded'));
  await Promise.resolve(); assert.ok(kept.length);
});

const inMore = (node) => node.parents.some((n) => n.tag === 'details' && (n.attrs.class || '').split(/\s+/).includes('more'));
const controlsOf = (key) => nodes.filter((n) => !preview(n) && !Object.hasOwn(n.attrs, 'data-local') && ['input', 'select', 'textarea'].includes(n.tag)
  && (n.attrs['data-key'] === key || (n.attrs.type === 'radio' && n.attrs.name === key)));
const sections = nodes.filter((n) => n.attrs['data-editor-section']);
const routeList = sections.map((n) => n.attrs['data-editor-section']);

test('IA: categories are the design\'s, in order, each with its sections and a jump link per section in the side list', () => {
  assert.deepEqual([...new Set(routeList.map((r) => r.split('/')[0]))], TABS, 'sections grouped by category, in tab order');
  const tabs = nodes.filter((n) => n.attrs.role === 'tab' && !preview(n)).map((n) => n.attrs['data-editor-tab']);
  assert.deepEqual(tabs, TABS);
  const list = nodes.find((n) => n.attrs.role === 'tablist' && !preview(n));
  assert.ok(nodes.filter((n) => n.parents.includes(list) && ['a', 'button', 'input', 'select'].includes(n.tag)).every((n) => n.attrs.role === 'tab'), 'only tabs in the tablist');
  for (const tab of TABS) {
    const group = nodes.find((n) => n.attrs['data-editor-jumps'] === tab);
    assert.ok(group, `${tab}: jump links`);
    const links = nodes.filter((n) => n.tag === 'a' && n.parents.includes(group)).map((n) => n.attrs.href);
    assert.deepEqual(links, routeList.filter((r) => r.startsWith(`${tab}/`)).map((r) => `#${r}`), `${tab}: one link per section, in order`);
  }
  for (const gone of ['canvas/shared', 'moodle/courses', 'look/navigation', 'blackboard/nav']) assert.ok(!routeList.includes(gone), `${gone} is gone`);
  assert.equal(nodes.filter((n) => (n.attrs.class || '').split(/\s+/).includes('section-links')).length, 0, 'no in-panel section link rows');
});

test('IA: every old address and old category name opens an existing section', () => {
  for (const old of OLD_ROUTES) {
    const route = routeList.includes(old) ? old : E.MOVED[old];
    assert.ok(routeList.includes(route), `${old} -> ${route}`);
  }
  for (const tab of OLD_TABS) {
    const route = E.MOVED[tab] || routeList.find((r) => r.startsWith(`${tab}/`));
    assert.ok(routeList.includes(route), `${tab} -> ${route}`);
  }
  for (const [old, route] of Object.entries(E.MOVED)) assert.ok(!routeList.includes(old) && routeList.includes(route), `MOVED ${old}`);
  // Old sections now inside another's More options open it there.
  for (const [old, id] of Object.entries(E.INSIDE)) {
    const el = byId(id)[0];
    assert.ok(el && (inMore(el) || (el.tag === 'details' && el.attrs.class === 'more')), id);
    assert.equal(owner(el), E.MOVED[old], `${old} -> #${id}`);
  }
});

test('IA: everyday controls stay in view and the rest sit in each section\'s More options', () => {
  for (const key of MORE.keys) assert.ok(expected.includes(key), `Stale More key ${key}`);
  for (const key of expected) {
    const carriers = SPECIAL[key] ? SPECIAL[key].flatMap(byId) : controlsOf(key);
    assert.ok(carriers.length, key);
    for (const node of carriers) assert.equal(inMore(node), MORE.keys.includes(key), `${key} ${MORE.keys.includes(key) ? 'belongs in' : 'stays out of'} More options`);
  }
  for (const id of Object.values(ACTIONS).flat()) assert.equal(inMore(byId(id)[0]), MORE.ids.includes(id), `#${id}`);
  for (const more of nodes.filter((n) => n.tag === 'details' && (n.attrs.class || '').includes('more'))) {
    const summary = nodes.find((n) => n.parents.at(-1) === more);
    assert.equal(summary?.tag, 'summary', 'More options opens from its summary');
    assert.ok(more.parents.some((n) => n.attrs['data-editor-section']), 'inside a section');
  }
  const withMore = sections.filter((sec) => nodes.some((n) => n.tag === 'details' && (n.attrs.class || '').includes('more') && n.parents.includes(sec))).map((n) => n.attrs['data-editor-section']);
  assert.deepEqual(withMore, ['look/palette', 'look/type', 'look/surfaces', 'look/background', 'look/motion', 'look/pointer', 'navigation/bar', 'navigation/items', 'navigation/tabs', 'navigation/sidebar',
    'courses/cards', 'study/todo', 'study/grades', 'study/widgets', 'study/pet', 'pages/content', 'pages/documents', 'pages/dashboard']);
});

test('IA: power-user sections are marked, and All settings is a local switch in the header', () => {
  assert.deepEqual(sections.filter((n) => Object.hasOwn(n.attrs, 'data-editor-power')).map((n) => n.attrs['data-editor-section']), POWER);
  const all = byId('editor-all');
  assert.equal(all.length, 1); assert.equal(all[0].attrs.type, 'checkbox'); assert.ok(Object.hasOwn(all[0].attrs, 'data-local'));
  assert.ok(all[0].parents.some((n) => n.tag === 'header'));
  assert.deepEqual(nodes.filter((n) => Object.hasOwn(n.attrs, 'data-no-preview')).map((n) => n.attrs['data-editor-panel']), ['sharing', 'mods', 'backup', 'about']);
});

test('IA: one navigation section swaps its body on Glaze navigation, with one logo picker after both', () => {
  const bar = sections.find((n) => n.attrs['data-editor-section'] === 'navigation/bar');
  const on = nodes.find((n) => n.attrs['data-show'] === 'navbar' && n.parents.includes(bar)), off = nodes.find((n) => n.attrs['data-show'] === 'siteNav');
  assert.ok(on && off && off.parents.includes(bar));
  for (const key of ['navbar.place', 'navbar.style', 'navbar.brand', 'navbar.rail']) assert.ok(controlsOf(key).every((c) => c.parents.includes(on)), key);
  for (const key of ['nav.k', 'nav.labels', 'nav.width', 'nav.footer', 'nav.brand']) assert.ok(controlsOf(key).every((c) => c.parents.includes(off)), key);
  for (const id of ['nav-items', 'nav-link-editor', 'nav-widgets']) assert.ok(byId(id)[0].parents.includes(off), `${id}: only while Glaze navigation is off`);
  const files = nodes.filter((n) => n.tag === 'input' && n.attrs.type === 'file' && (n.attrs['data-setting-owner'] || '').split(' ').includes('nav.li'));
  assert.equal(files.length, 1, 'one nav.li file input');
  assert.ok(!files[0].parents.includes(on) && !files[0].parents.includes(off) && files[0].parents.includes(bar));
  assert.equal(files[0].parents.findLast((n) => n.attrs['data-show'])?.attrs['data-show'], 'logo');
  assert.ok(files[0].n > off.n && off.n > on.n, 'after both bodies');
  assert.equal(nodes.filter((n) => /logo-pick/.test(n.attrs.id || '')).length, 1, 'one picker button');
  assert.equal(sections.find((n) => n.attrs['data-editor-section'] === 'navigation/items').attrs['data-show'], 'navbar');
});

test('IA: a control shows only where it has an effect', () => {
  const S = (over = {}) => { const s = D.GZ_SANITIZE({}); for (const [k, v] of Object.entries(over)) { const [g, key] = k.split('.'); s[g][key] = v; } return s; };
  const SURF = require(path.join(root, 'lib/surfaces.js'));
  // Surface opacity: shown exactly where its value changes what lib/surfaces.js paints.
  for (const glass of [0, 12]) for (const kind of ['solid', 'gradient', 'image', 'scene']) {
    const s = S({ 'look.glass': glass, 'bg.kind': kind });
    const paint = (o) => JSON.stringify(SURF.vars({ look: { ...s.look, surfaceOpacity: o }, bg: s.bg }));
    assert.equal(E.SHOW.surfaceOpacity(s), paint(20) !== paint(80), `glass ${glass}, ${kind}`);
  }
  assert.equal(E.SHOW.tintSource(S({ 'look.surfaceTint': 0 })), false); assert.equal(E.SHOW.tintSource(S({ 'look.surfaceTint': 30 })), true);
  assert.equal(E.SHOW.tooltips(S({ 'look.tooltips': false })), false); assert.equal(E.SHOW.tooltips(S({ 'look.tooltips': true })), true);
  assert.equal(E.SHOW.auto(S({ 'auto.on': false })), false); assert.equal(E.SHOW.auto(S({ 'auto.on': true })), true);
  for (const k of ['remind', 'remindExam', 'remindPlan', 'remindClass']) { assert.equal(E.SHOW[k](S({ [`enhance.${k}`]: true })), true); assert.equal(E.SHOW[k](S({ [`enhance.${k}`]: false })), false); }
  assert.equal(E.SHOW.navbar(S({ 'navbar.on': true })), true); assert.equal(E.SHOW.siteNav(S({ 'navbar.on': true })), false);
  assert.equal(E.SHOW.logo(S({ 'navbar.on': true, 'navbar.brand': 'custom', 'nav.brand': 'glaze' })), true);
  assert.equal(E.SHOW.logo(S({ 'navbar.on': false, 'navbar.brand': 'custom', 'nav.brand': 'glaze' })), false);
  assert.equal(E.SHOW.logo(S({ 'navbar.on': false, 'navbar.brand': 'glaze', 'nav.brand': 'custom' })), true);
  const RULE = { 'look.surfaceOpacity': 'surfaceOpacity', 'look.surfaceTintSource': 'tintSource', 'look.hints': 'tooltips', 'auto.mode': 'auto', 'auto.light': 'auto', 'auto.dark': 'auto',
    'remind.m15': 'remind', 'remind.d2': 'remind', 'remind.exam': 'remindExam', 'remind.plan': 'remindPlan', 'remind.cls': 'remindClass' };
  for (const [key, rule] of Object.entries(RULE)) for (const c of controlsOf(key)) assert.equal(c.parents.findLast((n) => n.attrs['data-show'])?.attrs['data-show'], rule, key);
  for (const n of nodes.filter((x) => x.attrs['data-show'])) assert.equal(typeof E.SHOW[n.attrs['data-show']], 'function', n.attrs['data-show']);
});

test('IA: a Reset shows only while something in its scope differs from the default', () => {
  const defaults = { ...D.GZ_SANITIZE(), card: cards.settings() }, state = structuredClone(defaults);
  assert.equal(E.differs(state, ['look.scale', 'look.radius'], defaults), false);
  state.look.radius = 4; assert.equal(E.differs(state, ['look.scale', 'look.radius'], defaults), true); assert.equal(E.differs(state, ['look.scale'], defaults), false);
  assert.equal(E.differs(state, ['look'], defaults), true, 'a group path covers its keys');
  state.nav.li = 'logo'; state.presets = [{ name: 'Mine', colors: {} }];
  assert.equal(E.differs(state, ['nav.li', 'presets'], defaults), false, 'what a reset keeps never shows a Reset');
  state.courses.colors = { _1_1: '#ff0000' }; assert.equal(E.differs(state, ['courses.colors'], defaults), true);
});

test('IA: the side list marks the top-most section still showing below the header, and the last at the page\'s end', () => {
  const rects = [{ route: 'study/todo', top: -900, bottom: 40 }, { route: 'study/grades', top: 40, bottom: 700 }, { route: 'study/reminders', top: 700, bottom: 1300 }];
  assert.equal(E.spy(rects, 100, false), 'study/grades', 'one scrolled under the header no longer counts');
  assert.equal(E.spy(rects, 30, false), 'study/todo', 'a section still showing below the header wins');
  assert.equal(E.spy(rects, 100, true), 'study/reminders', 'at the end the last wins');
  assert.equal(E.spy([{ route: 'about/glaze', top: -50, bottom: -10 }], 100, false), 'about/glaze');
  assert.equal(E.spy([], 100, false), '');
  const js = fs.readFileSync(path.join(root, 'lib/editor.js'), 'utf8'), css = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
  assert.match(js, /className: 'jump-mark'/, 'one mark element');
  assert.match(css, /\.jump-mark \{[^}]*transition: transform [^}]*var\(--gz-ease\)/);
  assert.match(css, /html\[data-gz-motion="off"\] \.jump-mark \{ transition: none; \}/);
});

// A setting's description longer than a short line, or in several parts, sits behind a "?"; disclosures of what goes where
// stay in view.
const html = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
const words = (h) => h.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const PRIVACY = ['enhance.gradescope', 'todo.gsDaily', 'mods.blocklist'];
const PRIVACY_NOTES = ['gallery-note', 'font-note', 'report-note', 'relay-help', 'relay-url-help', 'gcal-code-note', 'gcal-pair-note'];
test('IA: long descriptions move behind a "?", short ones and privacy disclosures stay in view', () => {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  for (const m of main.matchAll(/<label class="check[^"]*"[^>]*>(<input [^>]*>)[\s\S]*?<\/label>/g)) {
    const descs = [...m[0].matchAll(/<span class="desc">([\s\S]*?)<\/span>/g)].map((d) => words(d[1]));
    const key = m[1].match(/data-key="([^"]+)"/)?.[1];
    if (!descs.length || !key) continue;
    assert.ok(PRIVACY.includes(key) || (descs.length === 1 && descs[0].length <= 90), `${key}: ${descs.join(' ').length} characters still in view`);
  }
  for (const key of PRIVACY) assert.ok(new RegExp(`data-key="${key}"[^>]*>(?:(?!</label>)[\\s\\S])*<span class="desc">`).test(main), `${key} keeps its disclosure in view`);
  // Notes a control is described by: long ones are popovers, except the disclosures.
  const described = new Set([...main.matchAll(/aria-describedby="([^"]+)"/g)].flatMap((m) => m[1].split(' ')));
  for (const m of main.matchAll(/<p class="desc([^"]*)" id="([^"]+)"([^>]*)>([\s\S]*?)<\/p>/g)) {
    const [, cls, id, attrs, body] = m;
    if (!described.has(id) || words(body).length <= 90) continue;
    assert.ok(PRIVACY_NOTES.includes(id) !== /\binfo-pop\b/.test(cls), `#${id}`);
    if (PRIVACY_NOTES.includes(id)) assert.ok(!/popover/.test(attrs), `#${id} stays in view`);
  }
  // Every popover has its "?": named "More about" + the setting's own name, described by the text it opens.
  const pops = [...main.matchAll(/<(div|p) class="(?:desc )?info-pop" id="([^"]+)"[^>]*\spopover>([\s\S]*?)<\/\1>/g)];
  assert.ok(pops.length >= 50, `${pops.length} popovers`);
  for (const [, , id, body] of pops) {
    const buttons = [...main.matchAll(new RegExp(`<button type="button" class="info" popovertarget="${id}" aria-labelledby="info-more ([\\w-]+)" aria-describedby="${id}"></button>`, 'g'))];
    assert.equal(buttons.length, 1, `#${id}: one "?"`);
    assert.ok(new RegExp(`id="${buttons[0][1]}"[^>]*>[^<]*\\p{L}`, 'u').test(main), `#${id}: named by its setting`);
    assert.ok(words(body).length > 90 || (body.match(/class="desc"/g) || []).length > 1, `#${id} is long`);
  }
  assert.match(html, /<span id="info-more" hidden>More about<\/span>/);
  // Search counts a popover's words for its setting: each one sits in its setting's row, or is a note the control names.
  for (const [, , id] of pops) assert.ok(main.includes(`aria-describedby="${id}"`) || new RegExp(`aria-describedby="[^"]*\\b${id}\\b`).test(main), `#${id}`);
  const filter = fs.readFileSync(path.join(root, 'options.js'), 'utf8');
  assert.match(filter, /querySelectorAll\('\.info-pop'\)[\s\S]*?GZ_FIND\.spans\(pop\.textContent, words\)[\s\S]*?classList\.add\('found'\)/);
});
