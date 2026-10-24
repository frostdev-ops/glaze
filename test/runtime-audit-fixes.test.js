// Settings that did something other than what they say at runtime, as the settings audit found them: features/nav.js
// loaded while Glaze navigation stands in for the site's own (and does nothing), a shadowed nav.size moving Canvas's
// trays, Ultra's feature hub leaving out features that run there, look.density, look.leading and courses.harmonize
// doing nothing on Moodle, and Ultra's GPA staying in sight with Card grades only on hover.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i); assert.ok(j > i, b); return src.slice(i, j); };
const plain = (x) => JSON.parse(JSON.stringify(x));
const rules = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')).filter((r) => r.length === 2).map(([sel, body]) => ({ sel: sel.replace(/^[\s\S]*\{/, '').trim(), body: body.trim() }));
// A rule's selectors, split at its own commas, not those inside :is() or :not().
const selectors = (sel) => { const out = ['']; let depth = 0; for (const c of sel) { if (c === '(') depth++; if (c === ')') depth--; if (c === ',' && !depth) out.push(''); else out[out.length - 1] += c; } return out.map((x) => x.trim()); };

// ---- 1. features/nav.js only where the site's own navigation shows ----
const canvasSyncNav = ({ on, nav = {}, parts = null, ui = null }) => {
  const asked = [];
  const ctx = vm.createContext({ location: { pathname: '/courses/1' }, setAttr() {},
    I: { links: [1], settings: D.GZ_SANITIZE({ navbar: { on } }), worn: { nav: { ...D.GZ_DEFAULTS.nav, ...nav } } },
    need: (f) => { asked.push(f); return new Promise(() => {}); }, GZ_CTX: { parts: () => parts }, GZ_NAV_UI: ui || undefined });
  ctx.window = ctx; ctx.window.top = ctx;
  vm.runInContext(`${between(read('content-canvas.js'), '  const syncNav = () => {', '\n  return {')}\nthis.syncNav = syncNav;`, ctx);
  ctx.syncNav();
  return asked;
};

test('Canvas: features/nav.js is not loaded while Glaze navigation is on, and is while Canvas\'s own nav shows', () => {
  for (const nav of [{ collapsed: true }, { labels: 'icons' }, { i: 'pic1' }]) {
    assert.ok(!canvasSyncNav({ on: true, nav }).includes('features/nav.js'), `navbar on, ${JSON.stringify(nav)}`);
    assert.ok(canvasSyncNav({ on: false, nav }).includes('features/nav.js'), `navbar off, ${JSON.stringify(nav)}`);
  }
  assert.ok(!canvasSyncNav({ on: true, parts: { nav: {} } }).includes('features/nav.js'), 'a Look\'s nav layout with Glaze navigation on');
  assert.ok(canvasSyncNav({ on: false, parts: { nav: {} } }).includes('features/nav.js'), 'a Look\'s nav layout on Canvas\'s own nav');
  // Loaded before Glaze navigation was switched on: it is still told, so it puts Canvas's nav back as it was.
  let synced = 0;
  canvasSyncNav({ on: true, nav: { collapsed: true }, ui: { sync: () => synced++ } });
  assert.equal(synced, 1);
});

const ultraSyncNav = ({ on, nav = {}, parts = null, items = {}, ui = null }) => {
  const asked = [], reads = [];
  const ctx = vm.createContext({ isPreview: false, location: { pathname: '/ultra/course' }, meId: null,
    I: { links: [1], settings: D.GZ_SANITIZE({ navbar: { on } }), worn: { nav: { ...D.GZ_DEFAULTS.nav, ...nav } } },
    top: () => null, syncDashboard() {}, glazeItem() {},
    need: (f) => { asked.push(f); return new Promise(() => {}); }, GZ_CTX: { parts: () => parts }, GZ_NAV_UI: ui || undefined,
    chrome: { storage: { sync: { get: (k, cb) => { reads.push(k); cb({ navItems: items }); } } } } });
  ctx.window = ctx; ctx.window.top = ctx;
  vm.runInContext(`${between(read('content-ultra.js'), '  let navRead = false, navItems = null;', '\n  chrome.storage.onChanged')}\nthis.syncNav = syncNav;`, ctx);
  ctx.syncNav();
  return { asked, reads };
};

test('Ultra: neither features/nav.js nor a navItems read while Glaze navigation is on; both on Ultra\'s own nav', () => {
  const items = { order: ['grades'], widgets: [{ id: 'clock', on: true }] };
  for (const nav of [{ collapsed: true }, { labels: 'icons' }, { li: 'logo1' }, { labelOverflow: 'shrink' }]) {
    const o = ultraSyncNav({ on: true, nav, items });
    assert.ok(!o.asked.includes('features/nav.js'), `navbar on, ${JSON.stringify(nav)}`);
    assert.deepEqual(o.reads, [], `navbar on reads no navItems, ${JSON.stringify(nav)}`);
    const off = ultraSyncNav({ on: false, nav });
    assert.deepEqual(off.reads, ['navItems']);
    assert.ok(off.asked.includes('features/nav.js'), `navbar off, ${JSON.stringify(nav)}`);
  }
  const off = ultraSyncNav({ on: false, items });
  assert.ok(off.asked.includes('features/nav.js'), 'old-editor items still drive Ultra\'s own rail');
  assert.ok(!ultraSyncNav({ on: true, parts: { nav: {} }, items }).asked.includes('features/nav.js'), 'a Look\'s nav layout with Glaze navigation on');
  let synced = 0;
  ultraSyncNav({ on: true, nav: { collapsed: true }, ui: { sync: () => synced++ } });
  assert.equal(synced, 1, 'a loaded features/nav.js is still told, so it puts Ultra\'s drawer back');
});

// ---- 2. Canvas: the shadowed nav.size leaves Canvas's trays alone while Glaze navigation is on ----
test('canvas.css: nav.size\'s width reaches .tray-with-space-for-global-nav only while Canvas\'s own nav shows', () => {
  const found = rules(read('canvas.css')).filter((r) => r.sel.includes('.tray-with-space-for-global-nav') && /margin/.test(r.body));
  assert.ok(found.length);
  for (const r of found) for (const s of selectors(r.sel).filter((s) => s.includes('.tray-with-space-for-global-nav'))) {
    assert.match(s, /^html\[data-gz-nav-size\]:not\(\[data-gz-navbar\]\)/, s);
  }
});

// ---- 3. Ultra's feature hub lists what runs on Ultra ----
test('Ultra\'s feature hub lists every Canvas hub feature that runs on Ultra, each with its name', () => {
  const src = read('features/widgets.js');
  const value = (name, end) => vm.runInNewContext(`(${between(src, `const ${name} = `, end).slice(`const ${name} = `.length)}${end[0]})`);
  const HUB = value('HUB', '];\n'), ULTRA = value('HUB_ULTRA', '];\n'), EXTRA = value('EXTRA', '};\n');
  const keys = (hub) => hub.flatMap(([, k]) => k);
  const ultra = keys(ULTRA);
  assert.equal(new Set(ultra).size, ultra.length, 'no feature twice');
  for (const k of ultra) assert.ok(EXTRA[k], `${k} has a name`);
  // Keep quizzes light is Canvas's (content.js reads it only off Ultra).
  for (const k of keys(HUB).filter((k) => k !== 'quizLight')) assert.ok(ultra.includes(k), `${k} runs on Ultra`);
  assert.ok(!ultra.includes('quizLight'));
  assert.deepEqual(plain(ULTRA.find(([g]) => g === 'Reminders and streak')[1]), ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak', 'pet']);
});

// ---- 4. Moodle: density, line height and toned course colors ----
test('moodle.css: compact and roomy space Moodle\'s rows, tables and cards; the default leaves Boost\'s spacing', () => {
  const found = rules(read('moodle.css')).filter((r) => r.body.includes('var(--gz-space'));
  const sels = found.map((r) => r.sel).join(',\n');
  for (const part of ['.activity-item', '.course-section-header', 'table.generaltable', '.table', '[data-region="card-deck"]']) assert.ok(sels.includes(part), part);
  for (const r of found) for (const s of selectors(r.sel)) assert.match(s, /^html:is\(\[data-gz-density="compact"\], \[data-gz-density="roomy"\]\) /, s);
  assert.match(read('moodle.css'), /html\[data-gz-density="compact"\] \{ --gz-space: 0\.6; \}/);
});

test('moodle.css: Line height sets the line height of Moodle\'s formatted text, as on Canvas and Ultra', () => {
  const found = rules(read('moodle.css')).filter((r) => /line-height: var\(--gz-leading\)/.test(r.body));
  assert.ok(found.some((r) => r.sel.includes('.no-overflow') && r.sel.includes('.text_to_html')));
});

const moodlePaint = ({ settings, list, cards }) => {
  const style = () => { const vars = {}; return { vars, getPropertyValue: (k) => vars[k] || '', setProperty: (k, v) => { vars[k] = v; }, removeProperty: (k) => { delete vars[k]; } }; };
  const els = cards.map((id) => ({ dataset: { courseId: id }, style: style(), querySelector: () => null }));
  const ORIGIN = 'http://localhost:8081';
  const ctx = vm.createContext({ solo: false, tabFrame: '', URL, Promise, JSON, Date, location: { origin: ORIGIN }, matchMedia: () => ({ matches: true }),
    document: { querySelector: () => null, querySelectorAll: (sel) => (sel.includes('course-content') ? els : []) },
    GZ_COURSE_COLOR: D.GZ_COURSE_COLOR, GZ_SURFACE_VARS: D.GZ_SURFACE_VARS, GZ_ACTIVE_COLORS: D.GZ_ACTIVE_COLORS, GZ_COURSE_LOOK: D.GZ_COURSE_LOOK, GZ_TINT: D.GZ_TINT, GZ_COLORS: D.GZ_COLORS, GZ_COLOR: require('../lib/color.js'),
    GZ_MOODLE: require('../lib/moodle.js'), GZ_PAGE: require('../lib/page.js'),
    GZ_CTX: { t: (k) => k, settings: () => settings, local: () => {}, canvasCourseKey: (id) => (id ? `moodle:${ORIGIN}/${id}` : null), courseList: () => list, on: () => true } });
  ctx.globalThis = ctx;
  const api = vm.runInContext(read('features/moodle.js'), ctx);
  return { api, cards: els, key: (id) => `moodle:${ORIGIN}/${id}` };
};

test('Moodle cards: Moodle\'s own course color is handed to moodle.css to tone, a picked one is used as is', () => {
  const k = (id) => `moodle:http://localhost:8081/${id}`;
  const settings = D.GZ_SANITIZE({ enabled: true, courses: { colors: { [k(17)]: '#abcdef' } } });
  const list = { [k(16)]: { color: '#445566' }, [k(17)]: { color: '#fdcb6e' } };
  const p = moodlePaint({ settings, list, cards: ['16', '17', '99'] });
  p.api.paint();
  assert.deepEqual(plain(p.cards.map((c) => c.style.vars)), [{ '--gz-course-raw': '#445566' }, { '--gz-course': '#abcdef' }, {}]);
  delete settings.courses.colors[k(17)]; p.api.paint();
  assert.deepEqual(plain(p.cards[1].style.vars), { '--gz-course-raw': '#fdcb6e' }, 'pick removed: Moodle\'s own, toned');
  settings.courses.colors[k(16)] = '#123456'; p.api.paint();
  assert.deepEqual(plain(p.cards[0].style.vars), { '--gz-course': '#123456' }, 'picked: the raw one goes');
  settings.enabled = false; p.api.paint();
  assert.deepEqual(plain(p.cards.map((c) => c.style.vars)), [{}, {}, {}], 'Glaze off clears both');
});

test('moodle.css tones a card\'s own course color as canvas.css and theme.css do, and data-gz-raw-courses keeps it', () => {
  const r = rules(read('moodle.css'));
  const toned = r.find((x) => /^html \[data-region="course-content"\]\[style\*="--gz-course-raw"\]$/.test(x.sel));
  assert.ok(toned);
  assert.equal(toned.body, '--gz-course: color-mix(in oklab, var(--gz-course-raw) 70%, oklab(from var(--gz-ink-muted) l 0 0));');
  assert.ok(read('canvas.css').includes(toned.body.replace(/;$/, '')), 'the same toning as Canvas');
  const raw = r.find((x) => x.sel === 'html[data-gz-raw-courses] [data-region="course-content"][style*="--gz-course-raw"]');
  assert.equal(raw?.body, '--gz-course: var(--gz-course-raw);');
});

// ---- 5. Card grades only on hover hides Ultra's GPA too, as its description says ----
test('extras.css: Card grades only on hover blurs Ultra\'s GPA figures as canvas.css does Canvas\'s', () => {
  const canvas = rules(read('canvas.css')).find((r) => r.sel.startsWith('html[data-gz-enhance-gradeHover] #gz-gpa'));
  assert.ok(canvas);
  assert.ok(rules(read('extras.css')).some((r) => r.sel === canvas.sel && r.body === canvas.body));
});
