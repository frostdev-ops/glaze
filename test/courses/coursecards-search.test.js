// The Course cards dialog's search (courses/page/coursecards.js syncPicker) folds case the way the Documents search does
// (documents/doc-home.js fold): in no locale's way, accents off. A Turkish or Azeri browser's own lower-casing turns I into a
// dotless ı, so "istanbul" missed "Istanbul" and "İstanbul"; node can't be set to one, so the page's String gets the locale a
// browser would give a call that names none.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DH = require('../../extension/documents/doc-home.js');

const src = fs.readFileSync(path.join(__dirname, '../../extension/courses/page/coursecards.js'), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert.ok(i >= 0 && j > i, from); return src.slice(i, j); };
const FOLD = src.includes('  const fold = ') ? cut('  const fold = ', '\n') : ''; // '' in a source without it
const SYNC = cut('  const syncPicker = () => {', '  const closePicker = ');

// The dialog over stand-ins, for a browser in `locale`: the courses with their names, the search typed; → the names it leaves shown.
const shown = (locale, courses, query) => {
  const items = new Map(courses.map((c, i) => [c.key, { c, li: { hidden: false, hasAttribute: () => false, toggleAttribute() {} }, box: { checked: false, disabled: false, title: '' }, card: {} }]));
  const pick = { dlg: { isConnected: true }, keys: '[]', query: { value: query }, items, terms: [], empty: {}, all: {}, none: {}, count: {},
    o: { room: () => 9, on: () => false, has: () => false, board: 'dash', count: () => 0 } };
  const ctx = vm.createContext({ pick, JSON, list: () => [], title: (key) => items.get(key).c.name, fillPicker() {}, put: (el, k, v) => { el[k] = v; }, W: { COURSE_MAX: 20 },
    ctx: { t: (s) => s }, tone() {}, shownItems: () => [...items.values()].filter((it) => !it.li.hidden) });
  vm.runInContext(`{ const was = String.prototype.toLocaleLowerCase; String.prototype.toLocaleLowerCase = function (l) { return was.call(this, l ?? ${JSON.stringify(locale)}); }; }`, ctx);
  vm.runInContext(`${FOLD}\n${SYNC}\nglobalThis.sync = syncPicker;`, ctx);
  ctx.sync();
  return courses.filter((c) => !items.get(c.key).li.hidden).map((c) => c.name);
};
const course = (name, code = '', term = '') => ({ key: `course:https://school.test/${name}`, id: name, name, code, term });

test('the stand-in browser lower-cases I the way a Turkish or Azeri one does', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`{ const was = String.prototype.toLocaleLowerCase; String.prototype.toLocaleLowerCase = function (l) { return was.call(this, l ?? 'tr'); }; }`, ctx);
  assert.equal(vm.runInContext("'I'.toLocaleLowerCase()", ctx), 'ı');
  assert.equal(vm.runInContext("'I'.toLocaleLowerCase('en')", ctx), 'i');
});

test('searching istanbul finds İstanbul, Istanbul and ISTANBUL with a plain i in a Turkish, Azeri or English browser', () => {
  for (const locale of ['tr', 'az', 'en']) {
    for (const name of ['İstanbul', 'Istanbul', 'istanbul', 'ISTANBUL']) {
      assert.deepEqual(shown(locale, [course(name), course('Ankara')], 'istanbul'), [name], `${locale}: ${name}`);
    }
    for (const query of ['İstanbul', 'Istanbul', 'ISTANBUL', '  istanbul ']) {
      assert.deepEqual(shown(locale, [course('İstanbul trip'), course('Ankara')], query), ['İstanbul trip'], `${locale}: query ${query}`);
    }
    assert.deepEqual(shown(locale, [course('ISPARTA 101')], 'isp'), ['ISPARTA 101'], `${locale}: ISPARTA`);
  }
});

test('the course code and term are searched too, and an empty search leaves every course', () => {
  for (const locale of ['tr', 'en']) {
    const courses = [course('Biology', 'BIO 1110', 'Fall İstanbul'), course('Art', 'ART 1000', 'Spring')];
    assert.deepEqual(shown(locale, courses, 'bio 1110'), ['Biology'], locale);
    assert.deepEqual(shown(locale, courses, 'istanbul'), ['Biology'], `${locale}: term`);
    assert.deepEqual(shown(locale, courses, ''), ['Biology', 'Art'], locale);
    assert.deepEqual(shown(locale, courses, 'zzz'), [], locale);
  }
});

test('the dialog folds exactly as the Documents search does', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${FOLD}\nglobalThis.fold = fold;`, ctx);
  for (const s of ['İstanbul', 'Istanbul', 'ISPARTA', 'Café  NOTES ', 'Ünïcödé', '', null, undefined, 'ﬁne', 'ǅ', 'ȧb']) assert.equal(ctx.fold(s), DH.fold(s), String(s));
});
