const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('options.html');
const plain = (text) => text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const tabs = new Map([...html.matchAll(/data-editor-tab="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]));
const sections = new Map([...html.matchAll(/href="#([^"]+)" data-editor-jump[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]));

test('documented settings directions use the current category and section labels', () => {
  const paths = {
    'docs/features.md': ['look/surfaces', 'study/pet', 'sharing/sessions', 'sharing/relay', 'backup/notes', 'backup/sites'],
    'docs/privacy.md': ['backup/sites'],
    'PRIVACY.md': ['backup/sites'],
    'server/README.md': ['sharing/relay'],
    'docs/development.md': ['pages/dashboard'],
    'docs/mods-api.md': ['navigation/items'],
  };
  for (const [file, routes] of Object.entries(paths)) {
    const text = plain(read(file));
    assert.doesNotMatch(text, /Sharing and sync|Backup and privacy|Study tools|Settings → Blackboard|Look → Surfaces/, file);
    for (const route of routes) {
      const direction = `Settings → ${tabs.get(route.split('/')[0])} → ${sections.get(route)}`;
      assert.ok(text.includes(direction), `${file}: ${direction}`);
    }
  }
  assert.ok(plain(read('docs/features.md')).includes([...tabs.values()].slice(0, -1).join(', ') + ', and ' + [...tabs.values()].at(-1)), 'the category inventory follows the editor');
});
