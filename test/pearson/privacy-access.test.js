const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');

test('the Pearson permission disclosures distinguish exact grants, shared access and the all-host manifest', () => {
  for (const file of ['PRIVACY.md', 'docs/privacy.md']) {
    const text = read(file), start = text.indexOf('`https://mylab.pearson.com/*`') >= 0 ? text.indexOf('`https://mylab.pearson.com/*`') : text.indexOf("Pearson's switches");
    const disclosure = text.slice(start, start + 1200);
    assert.match(disclosure, /Safari[^.]*already[^.]*host/i, file);
    assert.match(disclosure, /exact[^.]*grant/i, file);
    assert.match(disclosure, /All sites[^.]*stay/i, file);
  }
});

test('the store describes browser-menu school checks separately from Pearson grants', () => {
  const copy = read('store/listing.md').split('### Host access (1,000 character maximum)')[1].split('### activeTab')[0].trim();
  assert.match(copy, /Pearson grants skip LMS probes/);
  assert.ok(copy.length <= 1000, `${copy.length} characters`);
});
