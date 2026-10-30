// Glaze's pages a site can frame (manifest web_accessible_resources) never reach tabs or windows through chrome or browser:
// WebKit takes those calls only from the extension's own process, and Safari kills the page whose extension frame makes one
// ("This webpage was reloaded because a problem occurred"). They ask the worker instead. Static: each page's script tags
// and the package scripts and modules their code names (libraries loaded later), any such reference at all, comments
// included, so nothing in a string can hide one; an alias of chrome itself would get past it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).isFile();
const pages = () => JSON.parse(read('manifest.json')).web_accessible_resources
  .flatMap((w) => w.resources).filter((r) => r.endsWith('.html'));
const from = (dir, src) => (src.startsWith('/') ? src.slice(1) : path.posix.normalize(path.posix.join(dir, src)));
const tags = (page) => [...read(page).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g)].map((m) => from(path.posix.dirname(page), m[1]));
// Package scripts and modules a file names in a string, any query or hash aside: './x.js' from its own folder, 'lib/x.mjs'
// or 'media.js' from the root or its folder.
const named = (file, src) => [...src.matchAll(/['"`]([\w./-]+\.m?js)(?:[?#][^'"`]*)?['"`]/g)]
  .flatMap((m) => (/^\.\.?\//.test(m[1]) ? [] : [m[1]]).concat(from(path.posix.dirname(file), m[1]))).filter(exists);
// Between tokens: spaces, line breaks and comments.
const _ = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*\n)*`;
const REACH = new RegExp(String.raw`\b(?:chrome|browser)${_}(?:\?\.|\.)${_}(tabs|windows)\b|\b(?:chrome|browser)${_}(?:\?\.)?${_}\[${_}['"\`](tabs|windows)['"\`]${_}\]`, 'g');

const reached = (page) => {
  const seen = new Set(), found = [];
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    assert.ok(exists(f), `${page}: ${f}`);
    const src = read(f);
    for (const m of src.matchAll(REACH)) found.push(`${page} → ${f}:${src.slice(0, m.index).split('\n').length} ${m[0].replace(/\s+/g, '')}`);
    for (const n of named(f, src)) walk(n);
  };
  for (const f of tags(page)) walk(f);
  return { files: seen, found };
};

test('no page a site can frame reaches tabs or windows itself', () => {
  const list = pages();
  for (const p of ['options.html', 'writer.html', 'sharing/quick.html', 'papers.html']) assert.ok(list.includes(p), p);
  const found = [];
  for (const page of list) {
    const r = reached(page);
    assert.ok(r.files.size, `${page} loads scripts`);
    found.push(...r.found);
  }
  assert.ok(reached('writer.html').files.has('lib/writer-docx.js'), 'libraries Writer loads later are scanned too');
  assert.ok(reached('reader.html').files.has('lib/pdfjs/pdf.mjs'), 'and modules');
  assert.deepEqual(found, []);
});

test('the scan sees each way of writing the call, and each way of naming a script', () => {
  for (const code of ['chrome.tabs.create({})', 'chrome?.tabs.create({})', 'chrome.tabs?.create', 'browser.windows.getAll()', "chrome['tabs'].query({})",
    'chrome\n  .tabs\n  .create({})', 'const marker = "//"; chrome.tabs.create({});', '`${x}` /* */ chrome.tabs.create({})',
    'chrome/* comment */.tabs.create({});', "chrome['tabs' /* comment */].create({});", 'chrome // c\n  .tabs.create({})']) {
    assert.equal([...code.matchAll(REACH)].length, 1, code);
  }
  assert.deepEqual(named('lib/writer-papers.js', "['./writer-docx.js?v=1', 'lib/pdfjs/pdf.mjs#x', 'nowhere.js']"), ['lib/writer-docx.js', 'lib/pdfjs/pdf.mjs']);
});

test('the Notes share panel\'s Settings button asks the worker for Settings at its sessions', () => {
  const src = read('sharing/quick.js');
  const click = src.slice(src.indexOf("$('#settings').addEventListener('click'"), src.indexOf('const startTimer'));
  assert.match(click, /request\(\{ op: 'settings' \}\)/, 'with its port once started: the note\'s account comes along');
  assert.match(click, /type: 'glaze:settings-at', hash: '#sharing\/sessions'/, 'otherwise, or after a definite no');
});
