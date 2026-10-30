// The small script a host manifest points at: browsers start it with no PATH worth trusting, so it names node by its
// absolute path and passes on what the browser gave it. sh on macOS and Linux (mode 0755), a .bat on Windows.
// It runs the first of node (the one setup ran with or chose) and also (the other nodes nodes.js found safe and new
// enough, in its order) that is still there, so a node upgraded or removed since doesn't break it. With none, or
// no node at all (node: null; Claude Desktop's bundle found none, nodes.js), it writes one native message,
// {t:'error',why:'no-node'}, which the worker shows as no-node (lib/agent-link.js), and exits 1. It still names the script
// it would run, so setup, uninstall and doctor know it as theirs.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const SH_SAFE = fs.readFileSync(path.join(__dirname, 'launcher-trust.sh'), 'utf8');

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

const makeSh = ({ node, also = [], script, browser }, guarded = false) => (node === null
  ? `#!/bin/sh\n: no node for ${q(abs(script))} host --browser=${id(browser)}\nprintf '${octal(wire())}'\nexit 1\n`
  : `${guarded ? SH_SAFE : '#!/bin/sh\n'}for n in ${[node, ...also].map((n) => q(abs(n))).join(' ')}; do\n  [ -f "$n" ] && [ -x "$n" ] && ${guarded ? 'safe_path "$n" 2>/dev/null && ' : ''}exec "$n" ${q(abs(script))} host --browser=${id(browser)} "$@"\ndone\nprintf '${octal(wire())}'\nexit 1\n`);
const oldSh = (o) => makeSh(o);
const sh = (o) => makeSh(o, true);
// cmd expands % even inside quotes, so it is doubled. cmd reads a .bat a line at a time from where it left off, so the
// command ends the file's reading itself (`& exit /b`): a launcher rewritten while its host runs is never read further.
// `call exit /b %%errorlevel%%` reads Node's status once Node has ended; plain `exit /b` returns 0 under cmd /c. A folder
// is told by what is inside it ("X\*"): cmd says "X\" exists for some plain files (nvm-windows' node.exe in %LOCALAPPDATA%).
// PowerShell writes the no-node bytes: cmd has no way to write a NUL. %SystemRoot% is the browser's own.
const PS = '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -Command';
const PS_WRITE = () => `"$o=[Console]::OpenStandardOutput();$b=[byte[]](${[...wire()].join(',')});$o.Write($b,0,$b.Length);$o.Flush()"`;
// form: 'now' as setup writes it; 'rc' and 'plain' as glaze-mcp 4.0.0's prereleases did, which still count as ours.
const makeBat = ({ node, also = [], script, browser }, form = 'now') => {
  const w = (p) => {
    if (/["\x00-\x1f]/.test(abs(p))) throw new Error(`invalid character in launcher path: ${p}`);
    return `"${p.replace(/%/g, '%%')}"`;
  };
  if (node === null) return `@echo off\r\n@setlocal DisableDelayedExpansion\r\nrem no node for ${w(script)} host --browser=${id(browser)}\r\n${PS} ${PS_WRITE()} & exit /b 1\r\n`;
  const guard = (n) => (form === 'now' ? `if not exist ${w(`${n}\\*`)} ` : form === 'rc' ? `if not exist ${w(`${n}\\`)} ` : '');
  const end = form === 'now' ? 'call exit /b %%errorlevel%%' : 'exit /b';
  const run = (n) => `if exist ${w(n)} ${guard(n)}(${w(n)} ${w(script)} host --browser=${id(browser)} %* & ${end})\r\n`;
  return `@echo off\r\n@setlocal DisableDelayedExpansion\r\n${[node, ...also].map(run).join('')}${PS} ${PS_WRITE()} & exit /b 1\r\n`;
};
const bat = (o) => makeBat(o);
const text = (platform, o) => (platform === 'win32' ? bat(o) : sh(o));
const file = (platform, hosts, browser) => path.join(hosts, platform === 'win32' ? `${id(browser)}.bat` : id(browser));

// What a launcher of ours runs ({ node, also, script, browser }; { node: null, script, browser } with none), or null
// for anything else. SH and BAT are the one-node launchers of glaze-mcp's prereleases, which still count as ours.
const SH = /^#!\/bin\/sh\nexec '((?:[^']|'\\'')*)' '((?:[^']|'\\'')*)' host --browser=([a-z][a-z-]*) "\$@"\n$/;
const BAT = /^@echo off\r\n(?:@setlocal DisableDelayedExpansion\r\n)?"([^"\x00-\x1f]*)" "([^"\x00-\x1f]*)" host --browser=([a-z][a-z-]*) %\* & exit \/b\r\n$/;
// A launcher with nodes is ours only as text() writes it.
const Q = String.raw`'((?:[^']|'\\'')*)'`, W = '"([^"\x00-\x1f]*)"';
const SH_FOR = new RegExp(`^#!/bin/sh\nfor n in ((?:${Q} ?)+); do\n  \\[ -f "\\$n" \\] && \\[ -x "\\$n" \\] && (?:safe_path "\\$n" 2>/dev/null && )?exec "\\$n" ${Q} host --browser=([a-z][a-z-]*) "\\$@"\n`);
const BAT_IF = /^@echo off\r\n@setlocal DisableDelayedExpansion\r\n((?:if exist [^\r\n]+\r\n)+)/;
const nodesOf = (list, re, un) => [...list.matchAll(re)].map((m) => un(m[1]));
// A launcher with no node is ours only as text() writes it.
const NONE = /^(?:#!\/bin\/sh\n: no node for '((?:[^']|'\\'')*)' host --browser=([a-z][a-z-]*)\n|@echo off\r\n@setlocal DisableDelayedExpansion\r\nrem no node for "([^"\x00-\x1f]*)" host --browser=([a-z][a-z-]*)\r\n)/;
const parse = (t) => {
  const none = typeof t === 'string' && NONE.exec(t);
  if (none) {
    const win = none[3] !== undefined;
    const o = { node: null, script: win ? none[3].replace(/%%/g, '%') : none[1].replace(/'\\''/g, "'"), browser: win ? none[4] : none[2] };
    try { return (win ? bat(o) : sh(o)) === t ? o : null; } catch { return null; }
  }
  const unSh = (s) => s.replace(/'\\''/g, "'"), unBat = (s) => s.replace(/%%/g, '%');
  const back = (o, make) => { try { return make(o) === t ? o : null; } catch { return null; } };
  const guarded = typeof t === 'string' && t.startsWith(SH_SAFE);
  const plain = guarded ? `#!/bin/sh\n${t.slice(SH_SAFE.length)}` : t;
  let f = typeof plain === 'string' && SH_FOR.exec(plain);
  if (f) {
    const [node, ...also] = nodesOf(f[1], new RegExp(Q, 'g'), unSh);
    return back({ node, also, script: unSh(f[f.length - 2]), browser: f[f.length - 1] }, guarded ? sh : oldSh);
  }
  f = typeof t === 'string' && BAT_IF.exec(t);
  if (f) {
    const line = new RegExp(`if exist ${W} (?:if not exist ${W} )?\\(${W} ${W} host --browser=([a-z][a-z-]*) %\\* & (?:call exit /b %%errorlevel%%|exit /b)\\)\r\n`, 'g');
    const lines = [...f[1].matchAll(line)];
    if (!lines.length) return null;
    const [node, ...also] = lines.map((m) => unBat(m[1]));
    const o = { node, also, script: unBat(lines[0][4]), browser: lines[0][5] };
    return back(o, bat) || back(o, (o) => makeBat(o, 'rc')) || back(o, (o) => makeBat(o, 'plain'));
  }
  let m = typeof t === 'string' && SH.exec(t);
  if (m) return { node: unSh(m[1]), also: [], script: unSh(m[2]), browser: m[3] };
  m = typeof t === 'string' && BAT.exec(t);
  if (m) return { node: unBat(m[1]), also: [], script: unBat(m[2]), browser: m[3] };
  return null;
};

module.exports = { NO_NODE, sh, bat, text, file, parse };
