const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../lib/ultra.js');

const origin = 'https://lms.example.edu';
const operations = {
  terms: (r) => r.terms(),
  memberships: (r) => r.memberships('_42_1'),
  grades: (r) => r.grades('_101_1', '_42_1'),
  schemas: (r) => r.schemas('_101_1'),
};

// Finite, valid same-list pagination. The third page is available but outside a two-page budget.
const paged = (pages) => {
  const asked = [];
  const f = async (url) => {
    const u = new URL(url), offset = +(u.searchParams.get('offset') || 0);
    asked.push(u.href);
    const next = new URL(u);
    next.searchParams.set('offset', offset + 1);
    return { ok: true, text: async () => JSON.stringify({
      results: [{ id: `_${100 + offset}_1` }],
      ...(offset + 1 < pages && { paging: { nextPage: next.pathname + next.search } }),
    }) };
  };
  return { asked, reader: U.read({ origin, f, maxPages: 2 }) };
};

for (const [name, run] of Object.entries(operations)) {
  test(`GZ-01: ${name} must expose incomplete data when a next page exceeds the budget`, async () => {
    const { reader, asked } = paged(3);
    let value, failure;
    try { value = await run(reader); } catch (e) { failure = e; }
    assert.equal(asked.length, 2, 'retain the request cap rather than reading an unbounded gradebook');
    if (failure) {
      assert.match(`${failure.code || ''} ${failure.message}`, /incomplete|truncat|pagination|limit|budget/i,
        'a stopped read must explain that its data is incomplete');
      return;
    }
    const rows = Array.isArray(value) ? value : value?.items;
    assert.deepEqual(rows?.map((x) => x.id), ['_100_1', '_101_1'], 'retain useful partial rows');
    assert.ok(value.complete === false || value.truncated === true,
      `${name} returned an ordinary successful result although a third page remains unread`);
  });

  test(`GZ-01 control: ${name} accepts a complete list ending exactly at the page budget`, async () => {
    const { reader, asked } = paged(2);
    const value = await run(reader);
    assert.equal(asked.length, 2);
    const rows = Array.isArray(value) ? value : value?.items;
    assert.deepEqual(rows?.map((x) => x.id), ['_100_1', '_101_1']);
    assert.notEqual(value.complete, false);
    assert.notEqual(value.truncated, true);
  });
}
