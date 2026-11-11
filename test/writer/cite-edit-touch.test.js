// Writer's citation "edit" button is drawn on a touch screen, where nothing hovers and a tap gives no :focus-visible
// (audit 2026-11-11 A7 #11).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../../extension/writer/frame/writer-cite.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('.gzc-edit is hidden at rest and shown on hover and focus', () => {
  assert.ok(/\.gzc-edit\s*\{[^}]*opacity:\s*0/.test(css));
  assert.ok(/\.gzc-item:hover \.gzc-edit,\s*\.gzc-edit:focus-visible\s*\{[^}]*opacity:\s*1/.test(css));
});

test('under (hover: none) .gzc-edit is shown', () => {
  const block = css.match(/@media\s*\(hover:\s*none\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)?.find((b) => b.includes('.gzc-edit'));
  assert.ok(block, 'a (hover: none) block names .gzc-edit');
  assert.ok(/\.gzc-edit\s*\{[^}]*opacity:\s*1/.test(block), 'and shows it');
});
