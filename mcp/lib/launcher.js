// The small script a host manifest points at: browsers start it with no PATH worth trusting, so it names node by its
// absolute path and passes on what the browser gave it. sh on macOS and Linux (mode 0755), a .bat on Windows.
// With no node (node: null; Claude Desktop's bundle found none, nodes.js) it writes one native message,
// {t:'error',why:'no-node'}, which the worker shows as no-node (lib/agent-link.js), and exits 1. It still names the script
// it would run, so setup, uninstall and doctor know it as theirs.
'use strict';
const path = require('node:path');

const abs = (p) => {
  if (typeof p !== 'string' || !(path.posix.isAbsolute(p) || path.win32.isAbsolute(p))) throw new Error(`launcher paths must be absolute: ${p}`);
  return p;
};
const BROWSER = /^[a-z][a-z-]*$/;
const id = (b) => { if (!BROWSER.test(b)) throw new Error(`not a browser id: ${b}`); return b; };
const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

// The no-node message as it goes on the wire: its length (4 bytes, little-endian) and its JSON.
const NO_NODE = { t: 'error', why: 'no-node' };
const wire = () => {
  const body = Buffer.from(JSON.stringify(NO_NODE));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
};
const octal = (buf) => [...buf].map((b) => (b >= 0x20 && b < 0x7f && b !== 0x25 && b !== 0x5c && b !== 0x27 ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, '0')}`)).join('');

const sh = ({ node, script, browser }) => (node === null
  ? `#!/bin/sh\n: no node for ${q(abs(script))} host --browser=${id(browser)}\nprintf '${octal(wire())}'\nexit 1\n`
  : `#!/bin/sh\nexec ${q(abs(node))} ${q(abs(script))} host --browser=${id(browser)} "$@"\n`);
// cmd expands % even inside quotes, so it is doubled. cmd reads a .bat a line at a time from where it left off, so the
// command ends the file's reading itself (`& exit /b`): a launcher rewritten while its host runs is never read further.
const bat = ({ node, script, browser }) => {
  const w = (p) => {
    if (/["\x00-\x1f]/.test(abs(p))) throw new Error(`invalid character in launcher path: ${p}`);
    return `"${p.replace(/%/g, '%%')}"`;
  };
  if (node === null) {
    // PowerShell writes the bytes: cmd has no way to write a NUL. %SystemRoot% is the browser's own.
    const ps = '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -Command';
    const write = `"$o=[Console]::OpenStandardOutput();$b=[byte[]](${[...wire()].join(',')});$o.Write($b,0,$b.Length);$o.Flush()"`;
    return `@echo off\r\n@setlocal DisableDelayedExpansion\r\nrem no node for ${w(script)} host --browser=${id(browser)}\r\n${ps} ${write} & exit /b 1\r\n`;
  }
  return `@echo off\r\n@setlocal DisableDelayedExpansion\r\n${w(node)} ${w(script)} host --browser=${id(browser)} %* & exit /b\r\n`;
};
const text = (platform, o) => (platform === 'win32' ? bat(o) : sh(o));
const file = (platform, hosts, browser) => path.join(hosts, platform === 'win32' ? `${id(browser)}.bat` : id(browser));

// What a launcher of ours runs, or null for anything else.
const SH = /^#!\/bin\/sh\nexec '((?:[^']|'\\'')*)' '((?:[^']|'\\'')*)' host --browser=([a-z][a-z-]*) "\$@"\n$/;
const BAT = /^@echo off\r\n(?:@setlocal DisableDelayedExpansion\r\n)?"([^"\x00-\x1f]*)" "([^"\x00-\x1f]*)" host --browser=([a-z][a-z-]*) %\* & exit \/b\r\n$/;
// A launcher with no node is ours only as text() writes it.
const NONE = /^(?:#!\/bin\/sh\n: no node for '((?:[^']|'\\'')*)' host --browser=([a-z][a-z-]*)\n|@echo off\r\n@setlocal DisableDelayedExpansion\r\nrem no node for "([^"\x00-\x1f]*)" host --browser=([a-z][a-z-]*)\r\n)/;
const parse = (t) => {
  const none = typeof t === 'string' && NONE.exec(t);
  if (none) {
    const win = none[3] !== undefined;
    const o = { node: null, script: win ? none[3].replace(/%%/g, '%') : none[1].replace(/'\\''/g, "'"), browser: win ? none[4] : none[2] };
    try { return (win ? bat(o) : sh(o)) === t ? o : null; } catch { return null; }
  }
  let m = typeof t === 'string' && SH.exec(t);
  if (m) return { node: m[1].replace(/'\\''/g, "'"), script: m[2].replace(/'\\''/g, "'"), browser: m[3] };
  m = typeof t === 'string' && BAT.exec(t);
  if (m) return { node: m[1].replace(/%%/g, '%'), script: m[2].replace(/%%/g, '%'), browser: m[3] };
  return null;
};

module.exports = { NO_NODE, sh, bat, text, file, parse };
