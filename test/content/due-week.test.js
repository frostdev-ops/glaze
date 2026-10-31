const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../extension/content/content.js'), 'utf8');
const due = source.slice(source.indexOf('  let dueSoon ='), source.indexOf('  // Where Ultra writes a due date'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const page = (site) => {
  let now = Date.UTC(2026, 9, 30), items = [], offline = false, calls = 0;
  const local = {};
  const fetch = async () => { calls++; if (offline) throw Error('offline'); return items; };
  const c = vm.createContext({
    ultra: false, moodle: site === 'moodle', location: { origin: 'https://school.test' },
    Date: class extends Date { static now() { return now; } },
    stored: (key, cb) => cb(structuredClone(local)),
    chrome: { storage: { local: { set: (values) => Object.assign(local, structuredClone(values)) } } },
    capi: fetch, GZ_CANVAS_DUE_WEEK: (list) => list, moodleIn: async () => ({ due: fetch }),
  });
  const dueWeek = vm.runInContext(`${due}\ndueWeek;`, c);
  return { dueWeek, advance: (ms) => { now += ms; }, items: (list) => { items = list; },
    offline: (value) => { offline = value; }, calls: () => calls };
};

for (const site of ['canvas', 'moodle']) {
  test(`${site}: an open page refreshes changed deadlines after the due-list cache expires`, async () => {
    const p = page(site), first = [{ title: 'Essay', due: Date.UTC(2026, 10, 1) }];
    const updated = [{ title: 'Essay', due: Date.UTC(2026, 10, 2) }, { title: 'Quiz', due: Date.UTC(2026, 10, 3) }];
    p.items(first);
    assert.deepEqual(plain(await p.dueWeek()), first);
    p.items(updated);
    p.advance(60000);
    assert.deepEqual(plain(await p.dueWeek()), first, 'nearby consumers reuse the same read');
    assert.equal(p.calls(), 1);
    p.advance(600001);
    assert.deepEqual(plain(await p.dueWeek()), updated, 'later consumers receive current deadlines');
    assert.equal(p.calls(), 2);
  });

  test(`${site}: a failed due-list read retries after the cache expires`, async () => {
    const p = page(site), items = [{ title: 'Quiz', due: Date.UTC(2026, 10, 1) }];
    p.offline(true);
    assert.deepEqual(plain(await p.dueWeek()), []);
    p.offline(false);
    p.items(items);
    p.advance(600001);
    assert.deepEqual(plain(await p.dueWeek()), items, 'a transient failure does not hide work until reload');
    assert.equal(p.calls(), 2);
  });
}
