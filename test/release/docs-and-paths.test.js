// Small facts the docs and comments state about the repository, checked against the repository.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
  const file = `${dir}/${entry.name}`;
  return entry.isDirectory() ? (entry.name === 'node_modules' ? [] : walk(file)) : [file];
});

test('the features page counts the sticker packs the picker offers', () => {
  const { PACKS } = require('../../extension/looks/lookx.js');
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  const said = read('docs/features.md').match(/put stickers from (\w+) packs/);
  assert.ok(said, 'docs/features.md says how many packs the stickers come from');
  assert.equal(words.indexOf(said[1]), Object.keys(PACKS).length, `${Object.keys(PACKS).join(', ')}`);
});

test('the development guide\'s license list names every library vendored under extension/vendor', () => {
  const guide = read('docs/development.md');
  const folders = fs.readdirSync(path.join(root, 'extension/vendor'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  assert.ok(folders.includes('quickjs'));
  for (const folder of folders) assert.ok(guide.includes(`vendor/${folder}/`), `docs/development.md does not name vendor/${folder}/`);
  for (const name of ['three', 'pm']) assert.ok(guide.includes(`vendor/${name}.`), `docs/development.md does not name vendor/${name}.*`);
  assert.match(guide, /QuickJS[^.]*\(MIT, `vendor\/quickjs\/`\)/);
});

test('the development guide builds with the packager where it lives', () => {
  const guide = read('docs/development.md');
  assert.doesNotMatch(guide, /^\.\/package\.sh$/m, 'package.sh is not at the repository root');
  assert.ok(fs.existsSync(path.join(root, 'tools/build/package.sh')));
  assert.match(guide, /^tools\/build\/package\.sh$/m);
  assert.match(guide, /--allow-dirty/, 'says how to package a working tree on purpose');
});

// scripts/ no longer exists at the top level: its files moved to tools/ and checks/. A comment still pointing there sends the
// next reader to a path that is gone. What stays names another place's scripts/ on purpose.
test('no tool, check or workflow comment points at the old top-level scripts/ folder', () => {
  const allowed = {
    'tools/release/public-release.mjs': 'the website repository\'s own scripts/',
    'tools/release/store-release.mjs': 'mcp/scripts/',
    'checks/firefox/firefox-check.mjs': 'an old release\'s checkout still has its packager in scripts/',
  };
  const stale = [];
  for (const file of [...walk('tools'), ...walk('checks'), ...walk('.github')]) {
    if (file.startsWith('tools/vendor/')) continue; // their strings are written into extension/vendor/, whose pinned hashes cover them
    if (!/\.(?:sh|js|mjs|cjs|py|cpp|ya?ml|md|json)$/.test(file) || allowed[file]) continue;
    read(file).split('\n').forEach((line, i) => { if (/(?<![\w/.-])scripts\/[\w.-]+/.test(line)) stale.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(stale, []);
});
