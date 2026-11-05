// Firefox runs the background as an event page from the scripts background/background.js imports at its top level
// (tools/build/package-firefox.sh); importScripts is a no-op there. A script those scripts import in turn is never loaded
// on Firefox, so every one has to be imported by background.js itself. pearson/embed.js was imported only from
// background/pearson-embed.js, and the worker's registration pass threw on Firefox once it read GZ_PEARSON_EMBED_LIB.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '../../extension');
// importScripts resolves against the worker's own script (background/background.js), from whichever file calls it.
const imports = (file) => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/importScripts\(([^)]*)\)/g)]
  .flatMap(([, args]) => [...args.matchAll(/'([^']+)'/g)].map(([, f]) => path.posix.join('background', f)));

test('every script a background import imports is imported by background.js too, as Firefox loads only those', () => {
  const top = new Set(imports('background/background.js'));
  assert.ok(top.size > 20, `${top.size} top-level imports`);
  for (const file of top) for (const nested of imports(file)) assert.ok(top.has(nested), `${file} imports ${nested}, which background.js does not`);
});
