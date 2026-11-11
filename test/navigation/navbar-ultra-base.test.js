// Ultra's pages carry a <base href> on its CDN, so a drawer link's resolved address (a.href) is the CDN's, not the site's.
// The navigation bar's Ultra adapter (navigation/page/navbar.js GZ_NAVBAR_ULTRA) takes each link's own attribute and
// resolves it against the page's address: items open, read as current and are kept on the site (audit 2026-11-11 N3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../../extension/navigation/page/navbar.js'), 'utf8');
const SITE = 'https://school.blackboard.com', CDN = 'https://d1x2y3.cloudfront.net/ultra/';
const plain = (v) => JSON.parse(JSON.stringify(v));

// A drawer with Courses, Grades and Sign Out; `base`: the document's base address, as the browser resolves a.href.
const adapter = (base) => {
  const kept = {};
  const link = (href, label) => ({ label, getAttribute: (k) => (k === 'href' ? href : null), get href() { return new URL(href, base).href; },
    querySelector: () => null, matches: () => false });
  const links = [link('/ultra/course', 'Courses'), link('/ultra/grades', 'Grades'), link('#', 'Sign Out')];
  const root = { querySelectorAll: () => links, closest: () => null };
  const document = { querySelector: () => root, createTreeWalker: (a) => { let n = 0; return { nextNode: () => (n++ ? null : { data: a.label, parentElement: { closest: () => null } }) }; } };
  const location = { origin: SITE, href: `${SITE}/ultra/course`, pathname: '/ultra/course' };
  const ctx = vm.createContext({ document, location, URL, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    chrome: { storage: { local: { get() {}, set: (o) => Object.assign(kept, o) } } }, MutationObserver: class { observe() {} disconnect() {} },
    GZ_NAV: require('../../extension/navigation/nav.js') });
  const Ultra = vm.runInContext(`${src.slice(src.indexOf('function GZ_NAVBAR_ULTRA(X) {'), src.indexOf('if (typeof module'))}\nGZ_NAVBAR_ULTRA;`, ctx);
  return { site: Ultra({ t: (s) => s, settings: () => ({ enhance: {} }) }), kept };
};

for (const [name, base] of [['a <base> on another origin', CDN], ['no <base>', `${SITE}/ultra/course`]]) {
  test(`Ultra's drawer links take the site's addresses with ${name}`, () => {
    const { site, kept } = adapter(base);
    const items = plain(site.read());
    assert.deepEqual(items.map((i) => [i.id, i.href, i.active]), [
      ['course', `${SITE}/ultra/course`, true],
      ['grades', `${SITE}/ultra/grades`, false],
      ['logout', `${SITE}/ultra/#`, false],
    ]);
    assert.deepEqual(plain(kept[`navbarSeen:${SITE}`]), [{ id: 'course', label: 'Courses', path: '/ultra/course' }, { id: 'grades', label: 'Grades', path: '/ultra/grades' }],
      'kept for the pages without a drawer');
  });
}
