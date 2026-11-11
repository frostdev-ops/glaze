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
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };

// A drawer with Courses, Grades and Sign Out (none with drawer: false); `base`: the document's base address, as the browser
// resolves a.href; `account`: who Ultra says is signed in; `kept`: storage.local, shared by two students' pages.
const adapter = (base, { drawer = true, account = '_1_1', kept = {}, profile = null } = {}) => {
  const link = (href, label) => ({ label, getAttribute: (k) => (k === 'href' ? href : null), get href() { return new URL(href, base).href; },
    querySelector: () => null, matches: () => false });
  const links = drawer ? [link('/ultra/course', 'Courses'), link('/ultra/grades', 'Grades'), ...(profile ? [link('/ultra/profile', profile)] : []), link('#', 'Sign Out')] : [];
  const root = { querySelectorAll: () => links, closest: () => null };
  const document = { querySelector: () => (drawer ? root : null), createTreeWalker: (a) => { let n = 0; return { nextNode: () => (n++ ? null : { data: a.label, parentElement: { closest: () => null } }) }; } };
  const location = { origin: SITE, href: `${SITE}/ultra/course`, pathname: '/ultra/course' };
  const ctx = vm.createContext({ document, location, URL, NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    chrome: { storage: { local: { get: (k, cb) => cb(structuredClone(Object.fromEntries([k].flat().filter((x) => x in kept).map((x) => [x, kept[x]])))), set: (o) => Object.assign(kept, structuredClone(o)), remove: (k) => { for (const x of [k].flat()) delete kept[x]; } } } }, MutationObserver: class { observe() {} disconnect() {} },
    GZ_NAV: require('../../extension/navigation/nav.js') });
  const Ultra = vm.runInContext(`${src.slice(src.indexOf('function GZ_NAVBAR_ULTRA(X) {'), src.indexOf('if (typeof module'))}\nGZ_NAVBAR_ULTRA;`, ctx);
  return { site: Ultra({ t: (s) => s, settings: () => ({ enhance: {} }), account: async () => account }), kept };
};

for (const [name, base] of [['a <base> on another origin', CDN], ['no <base>', `${SITE}/ultra/course`]]) {
  test(`Ultra's drawer links take the site's addresses with ${name}`, async () => {
    const { site, kept } = adapter(base);
    await settle();
    const items = plain(site.read());
    assert.deepEqual(items.map((i) => [i.id, i.href, i.id === 'logout' || i.active]), [
      ['course', `${SITE}/ultra/course`, true],
      ['grades', `${SITE}/ultra/grades`, false],
      ['logout', `${SITE}/ultra/#`, true],
    ]);
    await settle();
    assert.deepEqual(plain(kept[`navbarSeen:${SITE}:_1_1`]), [{ id: 'course', label: 'Courses', path: '/ultra/course' }, { id: 'grades', label: 'Grades', path: '/ultra/grades' }],
      'kept for the pages without a drawer');
  });
}

// Audit 2026-11-11 N4: Ultra's drawer names the signed-in student (its profile item); what a page without the drawer draws
// from is kept per student, as Moodle's is, so another student on this browser never sees it.
test("Ultra's last-seen items are kept per student: another student's page without the drawer never shows them", async () => {
  const kept = {};
  const a = adapter(CDN, { kept, profile: 'Ada Lovelace' });
  await settle(); a.site.read(); await settle();
  assert.deepEqual(Object.keys(kept), [`navbarSeen:${SITE}:_1_1`]);
  assert.ok(kept[`navbarSeen:${SITE}:_1_1`].some((i) => i.label === 'Ada Lovelace'));
  // Another student, on a course page opened at its own address (no drawer): Ultra's usual items.
  const b = adapter(CDN, { kept, drawer: false, account: '_2_1' });
  await settle();
  assert.ok(!plain(b.site.read()).some((i) => i.label === 'Ada Lovelace'));
  // The same student again: their own.
  const again = adapter(CDN, { kept, drawer: false });
  await settle();
  assert.ok(plain(again.site.read()).some((i) => i.label === 'Ada Lovelace'));
  // Kept before, per site only: never read, and gone once this student's are kept.
  const old = { [`navbarSeen:${SITE}`]: [{ id: 'profile', label: 'Someone else', path: '/ultra/profile' }] };
  const c = adapter(CDN, { kept: old, drawer: false, account: '_3_1' });
  await settle();
  assert.ok(!plain(c.site.read()).some((i) => i.label === 'Someone else'));
  const d = adapter(CDN, { kept: old });
  await settle(); d.site.read(); await settle();
  assert.deepEqual(Object.keys(old), [`navbarSeen:${SITE}:_1_1`]);
});
