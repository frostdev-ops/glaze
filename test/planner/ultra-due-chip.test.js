// An assessment overview's due-date row (div.due-date-container): its label ("Assessment due date:") and the date itself
// (bb-datetime). The chip and the urgency go on the date only, once. The real content-ultra.js in a VM, with content.js's
// own markDue and dueLabelled, over a stand-in page and gradebook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
// Ultra writes dates in the viewer's zone, so the page's text and the gradebook's date are built in the test's own:
// the same moment, three days off, in any TZ.
const ORIGIN = 'https://bb.test', NOW = new Date(2026, 9, 1, 8).getTime();

const page = (row, { locale = 'en', labelText = 'Assessment due date:', dateText = '10/4/26, 11:59 PM', view = 'assessment' } = {}) => {
  const doc = { activeElement: null, fire() {} };
  const make = (tag, cls = '', ...kids) => { const e = new El(tag, doc); e.className = cls; e.append(...kids); return e; };
  doc.root = make('html');
  const label = make('h3', 'grid-item-label', labelText);
  const date = make('bb-datetime', '', dateText);
  const body = make('body', '', make('div', 'assessment-overview-grid', make('div', 'overview-section overview-due-date-section main-section-container',
    make('h2', 'section-label', 'Details'), make('div', 'due-date-container', label, make('div', 'grid-item-value', date)))));
  if (view !== 'assessment') {
    const container = date.closest('.due-date-container');
    if (view === 'outline') {
      container.className = 'content-list-item';
      container.setAttribute('data-content-id', '_7_1');
      const detail = make('div', 'makeStylesgradeDetail-test'); detail.append(date); container.append(detail);
    } else container.className = 'due-date-list';
  }
  doc.root.append(body);
  // Text nodes in document order, each with its parent, through acceptNode as the browser's walker does.
  const createTreeWalker = (from, _, { acceptNode }) => {
    const texts = [];
    const walk = (e) => { for (const k of e.children) if (k instanceof El) walk(k); else texts.push({ data: k.textContent, parentElement: e }); };
    walk(from);
    const accepted = texts.filter((n) => acceptNode(n) === 1);
    return { nextNode: () => accepted.shift() || null };
  };
  const answer = (u) => (/users\/me$/.test(u.pathname) ? { id: '_9_1' } : /gradebook\/grades$/.test(u.pathname) ? { results: [row] } : { results: [] });
  const fetch = async (url) => new Response(JSON.stringify(answer(new URL(url))), { status: 200 });
  const location = { origin: ORIGIN, protocol: 'https:', hostname: 'bb.test', port: '', pathname: view === 'assessment' ? '/ultra/courses/_1_1/assessment/_7_1/overview' : `/ultra/courses/_1_1/${view}`, search: '' };
  const D = class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } };
  const ctx = vm.createContext({
    document: Object.assign(doc, { documentElement: doc.root, body, createTreeWalker, querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: () => null, addEventListener() {}, createElement: (t) => new El(t, doc) }),
    NodeFilter: { SHOW_TEXT: 4 }, location, console, Promise, Date: D, setTimeout: () => 1, clearTimeout() {}, queueMicrotask, JSON, Map, Set, Object, Array, String, Number, RegExp, Math, Intl,
    URL, URLSearchParams, Response, fetch, structuredClone,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: { runtime: { id: 'x' }, storage: { local: { get: (k, cb) => cb({}), set() {} }, onChanged: { addListener() {} } } },
    GZ_GRADES: require('../lib/grades.js'), GZ_PAGE: require('../lib/page.js'), GZ_I18N: require('../lib/i18n.js'), GZ_COURSES: require('../defaults.js').GZ_COURSES,
  });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.top = ctx;
  // content.js's own: where a due date is written, and how its chip is set.
  const core = read('content.js');
  vm.runInContext(`${core.match(/const DUE_AT = [^\n]+\n\s*const dueLabelled = [^\n]+\n/)[0]}\n${core.match(/const markDue = [\s\S]*?\n {2}\};/)[0]}\n({ dueLabelled, markDue })`, ctx);
  const { dueLabelled, markDue } = vm.runInContext('({ dueLabelled, markDue })', ctx);
  vm.runInContext(read('content-ultra.js'), ctx);
  const need = (file, ready) => { if (!ready()) vm.runInContext(read(file), ctx); return ready() ? Promise.resolve() : Promise.reject(new Error('not ready')); };
  const api = (p) => fetch(`${ORIGIN}/learn/api/v1${p}`).then((r) => r.json());
  const I = { C: {}, html: doc.root, isPreview: false, solo: true, tabFrame: '', need, t: (x) => x, locale: () => locale, api,
    courseId: () => location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1], markDue, drawProgress() {}, cardBadge() {},
    cardsInView: { observe() {}, unobserve() {} }, inView: new Set(), tagCards() {}, tagExtras() {}, courseSlots: {}, courseColors: () => ({}), varText: () => '', CARD: 'article', dueLabelled,
    links: [1], settings: { enabled: true, enhance: { inline: true, urgency: true, scores: false, progress: false, newgrades: false, newcontent: false }, nav: { brand: 'x' }, courses: { names: {}, tint: false, tinted: [] }, sidebar: {} },
    observer: {}, worn: { nav: {} }, courseList: {} };
  const X = ctx.GZ_SITE_ULTRA(I);
  const tag = async () => { X.tagExtras([body]); await settle(); X.tagExtras([body]); };
  const chipped = () => [label, date].filter((e) => e.hasAttribute('data-gz-countdown') || e.hasAttribute('data-gz-due')).map((e) => e.tagName.toLowerCase());
  return { tag, chipped, label, date };
};
const column = { id: '_300_1', contentId: '_7_1', dueDate: new Date(2026, 9, 4, 23, 59).toISOString() };

test('a graded assessment\'s due-date row draws its chip once, on the date', async () => {
  const p = page({ columnId: '_300_1', status: 'GRADED', displayGrade: { score: 5 }, pointsPossible: 5, submissionStatus: { status: 'GRADED' }, column });
  await p.tag();
  assert.deepEqual(p.chipped(), ['bb-datetime']);
  assert.match(p.date.getAttribute('data-gz-countdown'), /^Graded · 5\/5$/);
});

test('an open assessment\'s due-date row draws its countdown and urgency once, on the date', async () => {
  const p = page({ columnId: '_300_1', submissionStatus: { status: 'NOT_SUBMITTED' }, column });
  await p.tag();
  assert.deepEqual(p.chipped(), ['bb-datetime']);
  assert.ok(p.date.getAttribute('data-gz-countdown'));
  assert.equal(p.date.getAttribute('data-gz-due'), 'soon');
});


test('assessment date chips use the gradebook date in other locales without tagging their labels', async () => {
  for (const [locale, labelText, dateText] of [
    ['en-GB', 'Assessment due date:', '04/10/2026, 23:59'],
    ['es', 'Fecha de entrega:', '4/10/26, 23:59'],
    ['fr', 'Date limite :', '04/10/2026 23:59'],
    ['de', 'Fälligkeitsdatum:', '04.10.26, 23:59'],
    ['pt-BR', 'Data de entrega:', '04/10/2026 23:59'],
    ['nl', 'Inleverdatum:', '04-10-2026 23:59'],
  ]) {
    const p = page({ columnId: '_300_1', submissionStatus: { status: 'NOT_SUBMITTED' }, column }, { locale, labelText, dateText });
    await p.tag();
    assert.deepEqual(p.chipped(), ['bb-datetime'], locale);
    assert.equal(p.date.getAttribute('data-gz-due'), 'soon', locale);
    assert.equal(p.date.getAttribute('data-gz-countdown'), require('../lib/page.js').status(new Date(column.dueDate), null, { column }, new Date(NOW), false, locale).label, locale);
  }
});

test('course outline dates retain grade status and unrelated date lists retain their countdown', async () => {
  const row = { columnId: '_300_1', status: 'GRADED', displayGrade: { score: 5 }, pointsPossible: 5, submissionStatus: { status: 'GRADED' }, column };
  const outline = page(row, { view: 'outline' }); await outline.tag();
  assert.match(outline.date.getAttribute('data-gz-countdown'), /^Graded · 5\/5$/);
  assert.equal(outline.date.hasAttribute('data-gz-due'), false);
  const list = page(row, { view: 'calendar', dateText: 'Due: 10/4/26, 11:59 PM' }); await list.tag();
  assert.ok(list.date.getAttribute('data-gz-countdown'));
  assert.doesNotMatch(list.date.getAttribute('data-gz-countdown'), /Graded/);
  assert.equal(list.date.getAttribute('data-gz-due'), 'soon');
});
