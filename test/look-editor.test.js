// The Look tab of the editor (WP-L1): what "Use this theme" applies, what a palette swatch keeps, the contrast it checks, what a
// slider tick costs, and the two sections a Look's navigation and page tweaks have. options.js is one closure over the page, so
// its handlers run here in VMs, cut out by the lines that open and close them, with stand-in controls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const C = require('../lib/color.js');
const F = require('../lib/fonts.js');
const S = require('../lib/share.js');
const X = require('../lib/lookparts.js');
const K = require('../lib/cards.js');
const P = require('../lib/parts.js');
const H = require('../lib/history.js');
const LX = require('../lib/lookx.js');
const XE = require('../lib/editor-xparts.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const between = (source, from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `options.js still has ${from.trim()} … ${to.trim()}`);
  return source.slice(a, b);
};
const options = read('options.js');
const plain = (x) => JSON.parse(JSON.stringify(x)); // what a VM made, for deepEqual across realms
const say = (s, vars = {}) => s.replace(/\{(\w+)(?:\|\w+)?\}/g, (_, k) => vars[k]);
const tick = () => new Promise((r) => setTimeout(r, 0));

// ui.js as the popup and the editor load it, over stand-in storage.
const loadUi = (extra = {}) => {
  const context = vm.createContext({ ...D, GZ_COLOR: C, GZ_CARDS: K, GZ_XPARTS: X, GZ_LOOK_PARTS: require('../lib/lookset.js'), GZ_I18N: { t: say, ui: () => 'en' }, chrome: { storage: { sync: {}, local: {} } }, structuredClone, ...extra });
  vm.runInContext(`${read('ui.js')};globalThis.UI = GZ_UI;`, context);
  return context.UI;
};
const UI = loadUi();

// ---- LOOK-2: "Use this theme" ------------------------------------------------------------------------------------------
// The code, previewed by tryCode and then applied by the "Use this theme" handler, both as options.js has them.
const use = async (code, s = D.GZ_SANITIZE({}), answer = () => true) => {
  const tryCode = between(options, '  const tryCode =', "  $('#share-try').addEventListener");
  const start = options.indexOf("  $('#share-apply').addEventListener('click', () => {");
  const handler = options.slice(options.indexOf('{', start + 40) + 1, options.indexOf('  // ---- gallery, favorites and history')).replace(/\}\);\s*$/, '');
  const saved = [], sets = [], asked = [], hints = [];
  let active = false, history = 0;
  const controls = { '#share-code': { value: code }, '#share-offer': {}, '#share-what': { replaceChildren() {}, append() {} } };
  const context = vm.createContext({
    GZ_SHARE: S, GZ_XPARTS: X, GZ_PARTS: P, GZ_SANITIZE: D.GZ_SANITIZE, GZ_MATCH_PRESET: D.GZ_MATCH_PRESET, GZ_CARDS: K, GZ_FONTS: F, GZ_HISTORY: H,
    GZ_I18N: { ui: () => 'en', locale: () => 'en' }, s, offer: null, from: null, URL, Intl, pendingNav: new Set(),
    offerFile: '', offerGeneration: 0, letGo() {}, // WP-L2's pending offer file
    $: (id) => controls[id], document: { createElement: () => ({}) }, fontName: (f) => f.name, t: say,
    endOffer() {}, hint: (...a) => hints.push(a), leaving: () => history++, GZ_SITE: { reach: (urls) => { asked.push([[...urls], active]); return Promise.resolve(answer(urls)); } }, preview() {}, fill() {}, cardsOp: (op) => sets.push(op), GZ_UI: { paint() {} }, save: (keys) => saved.push(keys),
  });
  await vm.runInContext(`${tryCode}\ntryCode();`, context);
  const offer = context.offer;
  active = true;
  vm.runInContext(`(() => {${handler}})()`, context);
  active = false;
  await tick();
  return { s, offer, saved: saved.flat(), sets, asked, hints, context, history: () => history };
};
// A theme that sets something in every group a code can carry.
const author = () => D.GZ_SANITIZE({
  colors: D.GZ_PRESET('Forest'), look: { radius: 4, surfaceTint: 20, surfaceCustom: true, surfaceColor: '#223344' }, bg: { kind: 'aurora' },
  nav: { k: 'solid', c: '#224466', ink: '#fffff0' }, navbar: { place: 'top', badges: false, brand: 'school' }, sidebar: { surface: 'solid', radius: 'small' },
});
const cardsOf = { '*': [{ k: 'solid', c: '#336699' }] };
const everything = async () => S.encode({ ...author(), card: K.settings({ radius: 10 }) }, cardsOf, { x: { cursor: { kind: 'glow' } } });

test('LOOK-2: "Use this theme" applies and saves the navigation bar a code carries, and leaves whether it is on to the student', async () => {
  const code = await S.encode(D.GZ_SANITIZE({ navbar: { place: 'top', badges: false, brand: 'school' } }), {}, null);
  const run = await use(code, D.GZ_SANITIZE({ navbar: { on: false } }));
  assert.deepEqual([run.s.navbar.place, run.s.navbar.badges, run.s.navbar.brand], ['top', false, 'school']);
  assert.equal(run.s.navbar.on, false);
  assert.ok(run.saved.includes('navbar'), `saved: ${run.saved}`);
});

test('LOOK-2: every group a theme code decodes is applied by "Use this theme", or is deliberately left out', async () => {
  const code = await everything();
  const got = await S.decode(code);
  const run = await use(code);
  const want = author();
  // One check per group decode returns. A group added to decode without a line here fails the test below.
  const APPLIED = {
    colors: () => assert.deepEqual(plain(run.s.colors), want.colors),
    look: () => assert.deepEqual([run.s.look.radius, run.s.look.surfaceTint, run.s.look.surfaceCustom, run.s.look.surfaceColor], [4, 20, true, '#223344']),
    bg: () => assert.equal(run.s.bg.kind, 'aurora'),
    nav: () => assert.deepEqual([run.s.nav.k, run.s.nav.c, run.s.nav.ink], ['solid', '#224466', '#fffff0']),
    navbar: () => assert.deepEqual([run.s.navbar.place, run.s.navbar.badges, run.s.navbar.brand], ['top', false, 'school']),
    sidebar: () => assert.deepEqual([run.s.sidebar.surface, run.s.sidebar.radius], ['solid', 'small']),
    card: () => assert.equal(run.s.card.radius, 10),
    cards: () => assert.deepEqual(plain(run.sets), [{ set: cardsOf['*'] }]),
    parts: () => assert.deepEqual(plain(run.s.parts), { x: { cursor: { kind: 'glow' } } }),
  };
  // Nothing is left out of the editor's "Use this theme": it has the preview to take its time over.
  const SKIPPED = {};
  assert.deepEqual(Object.keys(got).filter((k) => !(k in APPLIED) && !(k in SKIPPED)), [], 'every group decode returns is applied or skipped on purpose');
  for (const k of Object.keys(got)) if (k in APPLIED) APPLIED[k]();
  assert.ok(run.saved.includes('navbar') && run.saved.includes('nav') && run.saved.includes('parts'));
});

test('LOOK-2: a rotated theme code wears its navigation, navigation bar and sidebar too; card styles and parts go another way', async () => {
  const got = await S.decode(await everything());
  const s = D.GZ_SANITIZE({ navbar: { on: false, rail: 'icons' }, sidebar: { open: 'drawer', width: 400 }, nav: { li: 'abcdefghijkl', labels: 'small' } });
  const w = LX.wearCode(s, got);
  // Card styles are the cards queue's (the worker's rotation doesn't write them), and the parts are written beside the patch.
  const SKIPPED = { card: 'course cards are written through the cards queue', cards: 'so are the theme set of card styles', parts: 'the worker writes them in the same call as the patch' };
  assert.deepEqual(Object.keys(got).filter((k) => !(k in w) && !(k in SKIPPED)), []);
  assert.deepEqual([w.navbar.place, w.navbar.badges, w.navbar.brand], ['top', false, 'school']);
  assert.deepEqual([w.navbar.on, w.navbar.rail], [false, 'icons'], 'what is the student’s stays');
  assert.deepEqual([w.nav.k, w.nav.c, w.nav.i], ['solid', '#224466', ''], 'a code’s sidebar colours; no picture of anyone’s');
  assert.deepEqual([w.nav.li, w.nav.labels], ['abcdefghijkl', 'small'], 'the rest of the navigation is kept');
  assert.deepEqual([w.sidebar.surface, w.sidebar.radius, w.sidebar.open, w.sidebar.width], ['solid', 'small', 'drawer', 400]);
});

// ---- LOOK-3: a palette keeps the Look's extras --------------------------------------------------------------------------
const GLOW = { x: { cursor: { kind: 'glow' } } };
const shaded = () => ({ ...D.GZ_SANITIZE({ bg: { kind: 'shader' } }), parts: { x: { bg: { shader: { src: fs.readFileSync(path.join(root, 'assets/shaders/aurora.glsl'), 'utf8') } } } } });

// refresh() as options.js has it, with the controls and renders it calls stood in; the Look and palette pickers it hands out.
const refreshed = (s, extra = {}) => {
  const picks = {}, saved = [], hints = [], log = [];
  const element = () => ({ hidden: false, checked: false, value: '', textContent: '', classList: { toggle() {} } });
  const source = between(options, '  const refresh = () => {', '  // Puts every control back in line');
  const context = vm.createContext({
    s, offer: null, GZ_UI: { paint() {}, looks: (box, v, cb) => { picks.look = cb; }, swatches: (box, v, cb) => { picks.swatch = cb; }, pickLook: UI.pickLook, pickPreset: UI.pickPreset },
    $: element, $$: () => [], get: () => 0, finder: { value: '' }, preview() {}, renderContrast() {}, renderMine() {}, renderHistory() {}, renderExtras() {}, renderBg() {}, renderNav() {},
    navbarEditor: null, presetOptions() {}, outputs() {}, GZ_EDITOR_X: { render() {} }, GZ_XEDIT: { render() {} }, document: { body: { classList: { toggle() {} } } },
    save: (keys) => { saved.push(keys); log.push('save'); }, fill: () => log.push('fill'), hint: (...a) => { hints.push(a); log.push('hint'); }, t: say,
    leaving: () => { log.push('leaving'); return extra.undo ?? null; }, ...extra.context,
  });
  vm.runInContext(`${source}\nrefresh();`, context);
  return { picks, saved, hints, log };
};

test('LOOK-3: a palette swatch changes the palette and keeps the Look’s extras; so does Back to Frost', () => {
  const s = { ...D.GZ_SANITIZE({}), parts: GLOW };
  const keys = UI.pickPreset(s, 'Paper', D.GZ_PRESET('Paper'));
  assert.deepEqual(s.parts, GLOW);
  assert.deepEqual([...keys], ['colors', 'preset', 'auto']);
  assert.equal(s.preset, 'Paper');
  assert.equal(s.auto.on, false, 'a palette is still an explicit choice, so auto light/dark goes off');
  const run = refreshed({ ...D.GZ_SANITIZE({}), parts: GLOW });
  run.picks.swatch('Paper', D.GZ_PRESET('Paper'));
  assert.ok(run.saved.every((k) => !k.includes('parts')), `saved: ${run.saved.map((k) => k.join())}`);
  const frost = options.slice(options.indexOf("$('#reset-colors')"), options.indexOf('// ---- courses: recorded'));
  assert.match(frost, /save\(GZ_UI\.pickPreset\(s, 'Frost', GZ_PRESET\('Frost'\)\)\)/);
});

test('LOOK-3: a whole Look replaces the extras, with the Look left already in History and an Undo to wear it again', () => {
  const left = shaded();
  const s = structuredClone(left);
  let undone = 0;
  const run = refreshed(s, { undo: () => { undone++; } });
  const aurora = D.GZ_LOOKS[0];
  run.picks.look(aurora);
  assert.deepEqual(s.parts, require('../lib/lookset.js')(aurora), 'a Look is a whole choice: its own extras replace the ones before');
  assert.deepEqual(run.log.slice(0, 2), ['leaving', 'save'], 'the Look being left is kept before anything changes');
  assert.equal(run.hints.length, 1);
  assert.match(run.hints[0][0], new RegExp(`${aurora.name} replaced this Look’s extras`));
  run.hints[0][2]();
  assert.equal(undone, 1);
  // Nothing to lose, nothing to say.
  const plain = refreshed(D.GZ_SANITIZE({}));
  plain.picks.look(aurora);
  assert.equal(plain.hints.length, 0);
});

test('LOOK-3: the "Saved" that follows a change with an Undo leaves the Undo be; the next edit lets it go', () => {
  const callbacks = [], timers = [];
  const h = { textContent: '', children: [], classList: { toggle() {} }, append(...xs) { this.children.push(...xs); } };
  const button = () => ({ type: '', textContent: '', clicks: [], addEventListener(ev, f) { this.clicks.push(f); } });
  const context = vm.createContext({
    $: () => h, document: { createElement: button }, t: say, s: {}, GZ_UI: { save: (v, keys, cb) => callbacks.push(cb) }, syncSettings() {}, addEventListener() {},
    setTimeout: (f) => timers.push(f) && timers.length, clearTimeout() {},
  });
  vm.runInContext(`${between(options, 'let hintTimer = 0', '// ---- search')}\n${between(options, '  const pending = new Set()', "  addEventListener('pagehide', flush);")}\nglobalThis.api = { hint, save, flush };`, context);
  const { hint, save } = context.api;
  let undone = 0;
  save(['bg']);
  hint('Aurora replaced this Look’s extras.', false, () => { undone++; });
  assert.equal(h.children.length, 2, 'the message and its Undo button');
  callbacks[0]('');
  assert.equal(h.textContent, 'Aurora replaced this Look’s extras.', 'Saved does not wipe it');
  h.children[1].clicks[0]();
  assert.equal(undone, 1);
  assert.equal(h.textContent, '', 'Undo clears the message');
  // The next edit: its Saved shows.
  hint('Aurora replaced this Look’s extras.', false, () => {});
  save(['look']);
  callbacks[1]('');
  assert.equal(h.textContent, 'Saved');
  // A failed save always shows.
  hint('Aurora replaced this Look’s extras.', false, () => {});
  callbacks[1]('Not saved: quota');
  assert.equal(h.textContent, 'Not saved: quota');
});

// leaving(): the Look to be left goes into History now, and Undo wears it again.
const leaving = (s, { read = true, history = [] } = {}) => {
  const writes = [], log = [], saved = [];
  const source = between(options, '  const leaving = ', '  const wearEntry');
  const context = vm.createContext({
    s, history, historyRead: read, GZ_HISTORY: H, structuredClone, Date,
    local: { set: (v, cb) => { writes.push(structuredClone(v)); log.push('write'); cb?.(); } },
    chrome: { runtime: { sendMessage: (m, cb) => { writes.push(structuredClone(m)); cb?.(); } } }, renderHistory() {}, fill: () => log.push('fill'), save: (keys) => saved.push(keys),
  });
  const undo = vm.runInContext(`${source}\nleaving();`, context);
  return { undo, writes, log, saved, context };
};

test('LOOK-3: leaving a Look with extras records it in History at once, and its Undo brings back all of it', () => {
  const s = shaded();
  const was = structuredClone(s);
  const run = leaving(s);
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].type, 'glaze:history-checkpoint');
  assert.deepEqual(run.writes[0].theme.parts, was.parts, 'the shader typed a moment ago goes to the history queue');
  // The Look picked next.
  UI.pickLook(s, D.GZ_LOOKS[0]);
  assert.deepEqual(s.parts, require('../lib/lookset.js')(D.GZ_LOOKS[0]));
  run.undo();
  assert.deepEqual(s.parts, was.parts);
  assert.deepEqual(s.colors, was.colors);
  assert.ok(run.saved[0].includes('parts') && run.saved[0].includes('colors') && run.saved[0].includes('card'));
});

test('LOOK-3: with no extras there is nothing to keep; an early checkpoint lets the worker merge unread History', () => {
  assert.equal(leaving(D.GZ_SANITIZE({})).undo, null);
  assert.equal(leaving(D.GZ_SANITIZE({})).writes.length, 0);
  const early = leaving(shaded(), { read: false });
  assert.equal(early.writes[0].type, 'glaze:history-checkpoint', 'the worker merges with its fresh list');
  assert.equal(typeof early.undo, 'function', 'Undo works all the same');
});

test('LOOK-3: the editor’s other changes of Look keep the Look left, too', () => {
  const entry = between(options, '  const wearEntry = ', '  const renderHistory');
  assert.match(entry, /leaving\(\)/, 'wearing an entry from History');
  const reset = options.slice(options.indexOf("$('#reset-all').addEventListener"), options.indexOf('for (const button of $$(\'[data-reset-setting]\'))'));
  assert.match(reset, /leaving\(\)/, 'Reset everything');
  const apply = between(options, "  $('#share-apply').addEventListener('click', () => {", '  // ---- gallery, favorites and history');
  assert.ok(apply.indexOf('leaving()') < apply.indexOf('s[k] = offer[k]') && apply.includes('const apply ='), 'permission must precede history and application');
});

// ---- LOOK-4: contrast, as the pages draw it ------------------------------------------------------------------------------
const li = () => ({ children: [], className: '', title: '', textContent: '', append(...xs) { this.children.push(...xs); } });
// renderContrast() as options.js has it. `offer` is the Look on offer; `rules` stay with the Look's parts.
const contrast = (v, { offer = null, dark = false, courses = {} } = {}) => {
  const list = { rows: [], draws: 0, replaceChildren(...rows) { this.rows = rows; this.draws++; } }, warn = { hidden: true, textContent: '' };
  const source = between(options, '  const renderContrast = ', '  // ---- everything that follows the state');
  const context = vm.createContext({
    ...D, GZ_COLOR: C, s: v, offer, GZ_UI: loadUi({ matchMedia: () => ({ matches: dark }) }), GZ_PARTS: P, GZ_I18N: { num: (n) => String(n), ui: () => 'en', locale: () => 'en' }, Intl, t: say,
    GZ_COURSE_COLORS: D.GZ_COURSE_COLORS, courses, matchMedia: () => ({ matches: dark }),
    document: { createElement: li }, $: (id) => (id === '#contrast' ? list : warn),
  });
  vm.runInContext(`${source}\nrenderContrast();\nrenderContrast();`, context);
  return { rows: list.rows.map((r) => ({ label: r.children[0], fail: r.className === 'fail', title: r.title, ratio: parseFloat(r.children[1].textContent) })), warn, draws: list.draws };
};
const row = (rows, label) => rows.find((r) => r.label === label);

test('LOOK-4: a custom surface colour is checked: Paper’s ink on the default navy is 1:1, and the list says so', () => {
  const paper = D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper'), look: { surfaceCustom: true } });
  const { rows } = contrast(paper);
  assert.equal(row(rows, 'Text on surface').fail, true);
  assert.ok(row(rows, 'Text on surface').ratio < 1.1);
  // Off, the palette alone is judged, as before.
  const plain = contrast(D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper') }));
  assert.deepEqual(plain.rows.filter((r) => r.fail), []);
});

test('LOOK-4: the list is drawn again only when a check changed, so a search’s marks on it stay', () => {
  assert.equal(contrast(D.GZ_SANITIZE({})).draws, 1, 'asked twice, drawn once');
});

test('LOOK-4: a surface tint is checked: Frost’s ink on a surface tinted fully with its accent is 1.75:1', () => {
  const { rows } = contrast(D.GZ_SANITIZE({ look: { surfaceTint: 100 } }));
  assert.equal(row(rows, 'Text on surface').fail, true);
  assert.ok(Math.abs(row(rows, 'Text on surface').ratio - 1.8) < 0.15, String(row(rows, 'Text on surface').ratio));
  assert.equal(row(rows, 'Text on ground').fail, true, 'the ground is tinted too');
});

test('LOOK-4: the palette worn is the one checked: the Look on offer, and the auto light/dark palette in force', () => {
  const bad = { ...D.GZ_PRESET('Frost'), '--gz-ink': '#0e1c30' };
  const mine = D.GZ_SANITIZE({});
  const offered = D.GZ_SANITIZE({ colors: bad });
  const { rows } = contrast(mine, { offer: offered });
  assert.equal(row(rows, 'Text on surface').fail, true, 'a code’s palette, while it is previewed');
  assert.deepEqual(contrast(mine).rows.filter((r) => r.fail), [], 'and mine, once it is not');
  // Auto: the colours in the pickers fail, the palette worn does not (and the other way round at night).
  const auto = D.GZ_SANITIZE({ colors: bad, auto: { on: true, light: 'Paper', dark: 'Frost' } });
  assert.deepEqual(contrast(auto, { dark: true }).rows.filter((r) => r.fail), []);
  assert.deepEqual(contrast(auto, { dark: false }).rows.filter((r) => r.fail), []);
  const autoBad = D.GZ_SANITIZE({ colors: D.GZ_PRESET('Frost'), presets: [{ name: 'Murk', colors: bad }], auto: { on: true, light: 'Murk', dark: 'Frost' } });
  assert.equal(row(contrast(autoBad, { dark: false }).rows, 'Text on surface').fail, true, 'the light palette is the one worn by day');
  assert.equal(row(contrast(autoBad, { dark: true }).rows, 'Text on surface').fail, false);
});

test('LOOK-4: a course tint is checked against the worst course colour', () => {
  const s = D.GZ_SANITIZE({ look: { surfaceTint: 100, surfaceTintSource: 'course' } });
  const courses = { _1_1: { name: 'A', slot: '1' } };
  const { rows } = contrast(s, { courses });
  assert.equal(row(rows, 'Text on surface').fail, true);
});

test('LOOK-4: page tweaks that set text and background colours are checked, and only the ones that fail are listed', () => {
  const parts = (st) => ({ x: { rules: [{ p: 'canvas.footer', do: 'style', st }] } });
  const { rows } = contrast({ ...D.GZ_SANITIZE({}), parts: parts({ fg: 'surface', bg: 'surface' }) });
  const bad = rows.filter((r) => r.fail && r.label.startsWith('Page tweak'));
  assert.equal(bad.length, 1);
  assert.match(bad[0].label, /Canvas · /);
  assert.ok(bad[0].ratio <= 1.01);
  assert.deepEqual(contrast({ ...D.GZ_SANITIZE({}), parts: parts({ fg: 'ink', bg: 'surface' }) }).rows.filter((r) => r.fail), []);
  assert.deepEqual(contrast({ ...D.GZ_SANITIZE({}), parts: parts({ bc: 'accent', r: 8 }) }).rows.filter((r) => r.fail), []);
});

test('rule contrast uses the final merged colours for each part', () => {
  const s = D.GZ_SANITIZE({});
  const rules = [{ p: 'canvas.footer', do: 'style', st: { fg: '#999999' } }, { p: 'canvas.footer', do: 'style', st: { bg: '#555555' } }];
  assert.ok(UI.contrast(s, false, [], rules).some((r) => r.part === 'canvas.footer' && !r.pass), 'separately readable changes combine to unreadable text');
  const restored = [...rules, { p: 'canvas.footer', do: 'style', st: { fg: 'ink', bg: 'surface' } }];
  assert.ok(!UI.contrast(s, false, [], restored).some((r) => r.part === 'canvas.footer'), 'later colours replace earlier ones');
});

test('rule contrast checks every course surface when the rule leaves its background unchanged', () => {
  const s = D.GZ_SANITIZE({ look: { surfaceTint: 100, surfaceTintSource: 'course' } });
  const rules = [{ p: 'canvas.footer', do: 'style', st: { fg: '#ffffff' } }];
  assert.ok(UI.contrast(s, false, ['#000000', '#ffffff'], rules).some((r) => r.part === 'canvas.footer' && r.ratio === 1));
});

test('LOOK-4: the share offer says so when a code’s Look fails a check, and says nothing when it passes', () => {
  const mine = D.GZ_SANITIZE({});
  const fails = contrast(mine, { offer: D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper'), look: { surfaceCustom: true } }) });
  assert.equal(fails.warn.hidden, false);
  assert.match(fails.warn.textContent, /^Text in this Look may be hard to read: .*Text on surface/);
  const fine = contrast(mine, { offer: D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper') }) });
  assert.deepEqual([fine.warn.hidden, fine.warn.textContent], [true, '']);
  assert.deepEqual([contrast(mine).warn.hidden], [true], 'and nothing, with no offer');
});

test('LOOK-4: ticking "Use a custom surface color" starts from the surface being worn, not Frost’s navy', () => {
  const handlers = {}, saved = [];
  const checkbox = { dataset: { key: 'look.surfaceCustom' }, type: 'checkbox', checked: true, addEventListener: (ev, f) => { handlers[ev] = f; } };
  const colour = { dataset: { key: 'look.surfaceColor' }, type: 'color', value: '', addEventListener() {} };
  const source = between(options, '  // ---- generic controls', "  $('#enabled').addEventListener");
  const run = (s) => {
    const refreshed = [];
    const context = vm.createContext({
      s, GZ_SPEC: D.GZ_SPEC, N: { dimensions: () => ({}) }, pendingNav: new Set(), pendingNavbar: new Set(), navPick: 0, matchMedia: () => ({ matches: false }), GZ_ACTIVE_COLORS: D.GZ_ACTIVE_COLORS,
      $$: (q) => (q === '[data-key]' ? [checkbox, colour] : q.includes('look.surfaceColor') ? [colour] : []), set: (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], s)[last] = v; }, group: (p) => p.split('.')[0],
      refresh: () => refreshed.push(true), save: (keys) => saved.push(keys), renderCourses() {}, renderNavItems() {}, get: (p) => p.split('.').reduce((o, k) => o[k], s), activeColors: (v = s) => D.GZ_ACTIVE_COLORS(v, false), fill() {},
    });
    vm.runInContext(source, context);
    handlers.change();
    return { colour: colour.value, s };
  };
  const paper = run(D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper') }));
  assert.equal(paper.s.look.surfaceCustom, true);
  assert.equal(paper.s.look.surfaceColor, D.GZ_PRESET('Paper')['--gz-surface']);
  assert.equal(paper.colour, D.GZ_PRESET('Paper')['--gz-surface'], 'the colour box shows it');
  const mine = run(D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper'), look: { surfaceColor: '#336699' } }));
  assert.equal(mine.s.look.surfaceColor, '#336699', 'a colour the student chose stays');
});

// ---- LOOK-10: a slider tick ---------------------------------------------------------------------------------------------
// lib/history.js over a sanitizer and a parts check that count their calls.
const counted = () => {
  const calls = { sanitize: 0, bundle: 0 };
  const context = vm.createContext({
    GZ_SANITIZE: (raw) => { calls.sanitize++; return D.GZ_SANITIZE(raw); }, GZ_XPARTS: { bundle: (p) => { calls.bundle++; return X.bundle(p); } }, structuredClone, JSON, module: undefined,
  });
  return { calls, H: vm.runInContext(`${read('lib/history.js').replace(/\nif \(typeof module[\s\S]*$/, '')}\nGZ_HISTORY;`, context) };
};
const stored = (n) => Array.from({ length: n }, (_, i) => ({ theme: H.theme({ ...shaded(), parts: { x: { bg: { shader: { src: `${shaded().parts.x.bg.shader.src}\n// v${i}` } } } } }), at: i }));

test('LOOK-10: redrawing History for the same entries and the same Look cleans each theme once, not once per question', () => {
  const { calls, H: h } = counted();
  const list = stored(20), s = shaded();
  const redraw = () => { h.previous(list, s); for (const e of list) { h.theme(e.theme); h.wearing(s, e); } };
  redraw();
  const first = { ...calls };
  assert.ok(first.sanitize <= 21 + 1, `the first draw cleans the 20 entries and the Look: ${first.sanitize}`);
  for (let i = 0; i < 10; i++) redraw();
  assert.deepEqual(calls, first, 'ten more redraws clean nothing');
  // A Look that changed is cleaned (once) and compared; an entry that is wearing is told.
  const next = { ...s, look: { ...s.look, radius: s.look.radius + 1 } };
  assert.equal(h.wearing(next, list[0]), false);
  assert.equal(h.wearing({ ...s, parts: list[3].theme.parts }, list[3]), true);
  assert.ok(calls.sanitize <= first.sanitize + 3);
});

test('LOOK-10: a theme that was cleaned once is not changed by what the editor does with the settings it came from', () => {
  const s = shaded();
  const th = H.theme(s);
  s.colors['--gz-accent'] = '#010203';
  s.parts.x.bg.shader.src += ' // typed';
  assert.notEqual(th.colors['--gz-accent'], '#010203');
  assert.ok(!th.parts.x.bg.shader.src.endsWith('// typed'));
  // Wearing an entry hands the editor its own copy: edits to it can't reach History’s.
  const entry = { theme: H.theme(shaded()), at: 1 };
  const worn = H.wear(shaded(), entry);
  worn.colors['--gz-accent'] = '#0a0b0c';
  worn.parts.x.bg.shader.src = 'x';
  assert.notEqual(H.theme(entry.theme).colors['--gz-accent'], '#0a0b0c');
  assert.notEqual(H.theme(entry.theme).parts.x.bg.shader.src, 'x');
  // And a settings object that keeps changing is never answered from a stale memory.
  const live = shaded();
  const a = H.theme(live);
  live.look.radius += 3;
  assert.equal(H.theme(live).look.radius, a.look.radius + 3);
});

test('cached cleaned history themes cannot be mutated into stale comparisons', () => {
  const s = shaded(), th = H.theme(s), original = th.look.radius;
  th.look.radius = original + 1;
  assert.equal(H.theme(th).look.radius, original, 'cached value stays immutable');
  assert.ok(H.wearing(s, { theme: th }), 'comparison and displayed data agree');
});

// renderHistory() as options.js has it, over counting stand-ins.
const history = (s, entries) => {
  const calls = { theme: 0, shown: 0 }, rows = { children: [], replaceChildren(...xs) { this.children = xs; calls.shown++; } };
  const counting = { ...H, theme: (raw) => { calls.theme++; return H.theme(raw); } };
  const elements = { '#history-back': { disabled: false, title: '' }, '#history-clear': { hidden: false }, '#history': rows };
  const source = between(options, '  const renderHistory = ', "  $('#history-back').addEventListener");
  const context = vm.createContext({
    s, history: entries, GZ_HISTORY: counting, GZ_UI: { themeName: (th) => th.preset || 'Custom theme' }, t: say, $: (id) => elements[id],
    row: (colors, name, sub) => ({ name, sub }), button: () => ({}), when: String, wearEntry() {}, WeakMap, JSON,
  });
  vm.runInContext(`${source}\nglobalThis.renderHistory = renderHistory;`, context);
  return { render: context.renderHistory, calls, context, rows };
};

test('LOOK-10: a slider tick that changes nothing History shows does not redraw it, and a Look slider cleans one theme', () => {
  const s = shaded(), run = history(s, stored(20));
  run.render();
  const first = { ...run.calls };
  assert.ok(first.shown === 1 && first.theme <= 21, JSON.stringify(first));
  // A control that is not part of a Look: no redraw, no cleaning.
  s.motion.level = 'off'; s.nav.size = 'large'; s.courses.tint = true;
  for (let i = 0; i < 20; i++) run.render();
  assert.deepEqual(run.calls, first);
  // A Look slider changes the theme worn, which is cleaned (once a tick); no entry is worn or Previous Look any differently.
  for (let i = 0; i < 10; i++) { s.look.radius += 1; run.render(); }
  assert.deepEqual(run.calls, { theme: first.theme + 10, shown: 1 });
  // Wearing the theme of one entry marks it.
  s.look.radius = D.GZ_DEFAULTS.look.radius;
  s.parts = JSON.parse(JSON.stringify(run.context.history[3].theme.parts));
  run.render();
  assert.equal(run.calls.shown, 2);
  assert.equal(run.rows.children.filter((r) => r.sub === 'Wearing now').length, 1);
  // History itself changing redraws it.
  run.context.history = stored(3);
  run.render();
  assert.equal(run.calls.shown, 3);
  assert.equal(run.rows.children.length, 3);
});

// ---- LOOK-13: this Look's navigation and Page tweaks ---------------------------------------------------------------------
const html = read('options.html');
const sectionOf = (route) => html.match(new RegExp(`<section[^>]*data-editor-section="${route}"[^>]*>([\\s\\S]*?)</section>`))[1];

test('LOOK-13: the Look tab’s section links reach "This Look’s navigation" and "Page tweaks", which have a path and a Reset like the rest', () => {
  const nav = html.match(/<div id="panel-look"[^>]*><nav class="section-links"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const links = [...nav.matchAll(/<a href="#([^"]+)" data-editor-alias>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.ok(links.some(([h, w]) => h === 'look/nav-layout' && w === "This Look's navigation"), JSON.stringify(links));
  assert.ok(links.some(([h, w]) => h === 'look/rules' && w === 'Page tweaks'));
  // In the order the sections are in.
  const sections = [...html.matchAll(/data-editor-section="(look\/[a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links.map(([h]) => h), sections.filter((r) => links.some(([h]) => h === r)));
  for (const [route, word] of [['look/nav-layout', "This Look's navigation"], ['look/rules', 'Page tweaks']]) {
    const body = sectionOf(route);
    assert.match(body, new RegExp(`<p class="section-path" data-editor-breadcrumb><a href="#${route}" data-editor-alias>${word}</a></p>`), `${route}: a breadcrumb`);
    assert.match(body, new RegExp(`<button type="button" class="section-reset" data-reset-section="${route}">Reset section</button>`), `${route}: Reset section`);
  }
  // Every section of the Look tab is in the links.
  for (const route of sections) assert.ok(links.some(([h]) => h === route), `${route} has a link`);
});

test('LOOK-13: Reset section takes the Look’s navigation layout, or its page tweaks, out of the Look and can be undone', () => {
  const source = between(options, '  const LOOK_PART', '  // Look parts builders');
  const run = (route, parts) => {
    const handlers = [], saved = [], hints = [], log = [];
    const button = { dataset: { resetSection: route }, closest: () => ({}), addEventListener: (ev, f) => handlers.push(f) };
    const s = { ...D.GZ_SANITIZE({}), parts };
    const context = vm.createContext({
      s, $$: () => [button], GZ_XEDIT: XE, GZ_EDITOR: { keys: () => [], reset: () => [] }, defaultsHere: () => ({}), pendingNav: new Set(), structuredClone,
      resetRelay() {}, fill: () => log.push('fill'), refresh: () => log.push('refresh'), save: (keys, soon, partKeys) => saved.push([keys, partKeys]), hint: (...a) => hints.push(a), t: say,
      leaving: () => { log.push('leaving'); return () => log.push('undo'); },
    });
    vm.runInContext(source, context);
    handlers[0]({ isTrusted: true });
    return { s, saved, hints, log };
  };
  const full = { x: { nav: { place: 'top', groups: [{ items: ['grades'] }] }, rules: [{ p: 'canvas.footer', do: 'hide' }], cursor: { kind: 'glow' } }, m: { a: 1 } };
  const nav = run('look/nav-layout', structuredClone(full));
  assert.equal(nav.s.parts.x.nav, undefined);
  assert.deepEqual(nav.s.parts.x.rules, full.x.rules, 'the page tweaks stay');
  assert.deepEqual(nav.s.parts.x.cursor, full.x.cursor);
  assert.deepEqual(plain(nav.saved), [[['parts'], ['nav']]], 'only the navigation layout is written');
  assert.equal(nav.log[0], 'leaving', 'the Look is kept in History first');
  assert.equal(nav.hints.length, 1);
  const rules = run('look/rules', structuredClone(full));
  assert.equal(rules.s.parts.x.rules, undefined);
  assert.ok(rules.s.parts.x.nav);
  assert.deepEqual(plain(rules.saved), [[['parts'], ['rules']]]);
  // Nothing to reset: the section stays as it is.
  const none = run('look/rules', null);
  assert.equal(none.s.parts, null);
  // The last of the Look’s extras: no parts at all.
  const last = run('look/rules', { x: { rules: full.x.rules } });
  assert.equal(last.s.parts, null);
});


test('review: applying a pasted Look asks for remote media in the click, and refusal changes neither Look nor history', async () => {
  const src = 'https://media.example/rain.webm';
  const code = await S.encode(D.GZ_SANITIZE({ bg: { kind: 'media' } }), {}, { x: { bg: { media: { type: 'video', src } } } });
  for (const yes of [true, false]) {
    const before = D.GZ_SANITIZE({ bg: { kind: 'solid' } });
    const r = await use(code, before, () => yes);
    assert.deepEqual(r.asked, [[[src], true]], 'host request starts in Apply click');
    assert.equal(r.s.bg.kind, yes ? 'media' : 'solid');
    assert.equal(r.history(), yes ? 1 : 0, 'refusal keeps history untouched');
    assert.equal(r.saved.length > 0, yes);
    if (!yes) assert.equal(r.hints.at(-1)[0], 'That link can’t be saved.');
  }
});

test('review: a cancelled Look offer stays cancelled when its host permission answer arrives late', async () => {
  let grant;
  const code = await S.encode(D.GZ_SANITIZE({ bg: { kind: 'media' } }), {}, { x: { bg: { media: { type: 'video', src: 'https://media.example/rain.webm' } } } });
  const r = await use(code, D.GZ_SANITIZE({ bg: { kind: 'solid' } }), () => new Promise((resolve) => { grant = resolve; }));
  assert.equal(typeof grant, 'function');
  r.context.offer = null;
  r.context.offerGeneration++;
  grant(true);
  await tick();
  assert.equal(r.s.bg.kind, 'solid');
  assert.equal(r.saved.length, 0);
  assert.equal(r.history(), 0);
});
