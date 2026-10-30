// Glaze's pages a site can frame (manifest web_accessible_resources) never call tabs.* or windows.* themselves: WebKit takes
// those only from the extension's own process, and Safari kills the page whose extension frame calls one ("This webpage was
// reloaded because a problem occurred"). They ask the worker instead.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pages = () => JSON.parse(read('manifest.json')).web_accessible_resources
  .flatMap((w) => w.resources).filter((r) => r.endsWith('.html'));
// The scripts a page loads, as paths from the package root.
const scripts = (page) => [...read(page).matchAll(/<script[^>]*\bsrc="([^"]+)"/g)]
  .map((m) => (m[1].startsWith('/') ? m[1].slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(page), m[1]))));
const CALL = /\b(?:chrome|browser)\s*\.\s*(tabs|windows)\s*(?:\?\.|\.)\s*([a-zA-Z]+)/g;

test('no page a site can frame calls tabs or windows itself', () => {
  const list = pages();
  for (const p of ['options.html', 'writer.html', 'sharing/quick.html', 'papers.html']) assert.ok(list.includes(p), p);
  const found = [];
  for (const page of list) {
    const files = scripts(page);
    assert.ok(files.length, `${page} loads scripts`);
    for (const f of files) {
      assert.ok(fs.existsSync(path.join(root, f)), `${page}: ${f}`);
      read(f).split('\n').forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;
        for (const m of line.matchAll(CALL)) found.push(`${page} → ${f}:${i + 1} ${m[1]}.${m[2]}`);
      });
    }
  }
  assert.deepEqual(found, []);
});

test('the Notes share panel\'s Settings button asks the worker for Settings at its sessions', () => {
  const src = read('sharing/quick.js');
  const click = src.slice(src.indexOf("$('#settings').addEventListener('click'"), src.indexOf('const startTimer'));
  assert.match(click, /request\(\{ op: 'settings' \}\)/, 'with its port once started: the note\'s account comes along');
  assert.match(click, /type: 'glaze:settings-at', hash: '#sharing\/sessions'/, 'otherwise, and when the port fails');
});
