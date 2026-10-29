// The small script a host manifest points at: browsers start it with no PATH worth trusting, so it names node by its
// absolute path and passes on what the browser gave it. sh on macOS and Linux (mode 0755), a .bat on Windows.
'use strict';
const path = require('node:path');

const abs = (p) => {
  if (typeof p !== 'string' || !(path.posix.isAbsolute(p) || path.win32.isAbsolute(p))) throw new Error(`launcher paths must be absolute: ${p}`);
  return p;
};
const BROWSER = /^[a-z][a-z-]*$/;
const id = (b) => { if (!BROWSER.test(b)) throw new Error(`not a browser id: ${b}`); return b; };
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

const sh = ({ node, script, browser }) => `#!/bin/sh\nexec ${q(abs(node))} ${q(abs(script))} host --browser=${id(browser)} "$@"\n`;
// cmd expands % even inside quotes, so it is doubled. cmd reads a .bat a line at a time from where it left off, so the
// command ends the file's reading itself (`& exit /b`): a launcher rewritten while its host runs is never read further.
const bat = ({ node, script, browser }) => {
  const w = (p) => `"${abs(p).replace(/%/g, '%%')}"`;
  return `@echo off\r\n${w(node)} ${w(script)} host --browser=${id(browser)} %* & exit /b\r\n`;
};
const text = (platform, o) => (platform === 'win32' ? bat(o) : sh(o));
const file = (platform, hosts, browser) => path.join(hosts, platform === 'win32' ? `${id(browser)}.bat` : id(browser));

// What a launcher of ours runs, or null for anything else.
const SH = /^#!\/bin\/sh\nexec '((?:[^']|'\\'')*)' '((?:[^']|'\\'')*)' host --browser=([a-z][a-z-]*) "\$@"\n$/;
const BAT = /^@echo off\r\n"([^"]*)" "([^"]*)" host --browser=([a-z][a-z-]*) %\* & exit \/b\r\n$/;
const parse = (t) => {
  let m = typeof t === 'string' && SH.exec(t);
  if (m) return { node: m[1].replace(/'\\''/g, "'"), script: m[2].replace(/'\\''/g, "'"), browser: m[3] };
  m = typeof t === 'string' && BAT.exec(t);
  if (m) return { node: m[1].replace(/%%/g, '%'), script: m[2].replace(/%%/g, '%'), browser: m[3] };
  return null;
};

module.exports = { sh, bat, text, file, parse };
