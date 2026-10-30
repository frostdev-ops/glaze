#!/usr/bin/env node
// glaze-mcp: lets AI apps on this computer reach Glaze in the browser.
//   glaze-mcp [agent]   what an agent app runs (lib/agent.js); with --from=mcpb, Claude Desktop's bundle, it first sets
//                       the browsers up (lib/mcpb.js)
//   glaze-mcp host      what the browser starts over native messaging (lib/host.js); also chosen from the browser's own
//                       argv alone, so a manifest may name this file directly. Never from a terminal.
//   glaze-mcp setup | uninstall | doctor | --version
// lib/host.js and lib/agent.js are loaded only when used and export main({ args, browser, caller, io }), resolving to an
// exit code or to nothing while they keep running.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ORIGIN = /^chrome-extension:\/\/[a-p]{32}\/$/;
const PARENT = /^--parent-window=\d+$/;
const FIREFOX = 'glaze@frostdev.io';
const MODES = ['agent', 'host', 'setup', 'uninstall', 'doctor'];
const USAGE = `Usage: glaze-mcp [agent]
       glaze-mcp setup [--browser <id>]... [--extension-id <id>]... [--dev <unpacked folder>]...
       glaze-mcp uninstall
       glaze-mcp doctor
       glaze-mcp --version
`;

// What a browser passes a native host: Chromium the caller's origin (on Windows also --parent-window=<handle>),
// Firefox the manifest's path and the add-on's id.
const caller = (args, platform) => {
  if (ORIGIN.test(args[0]) && (args.length === 1 || (args.length === 2 && platform === 'win32' && PARENT.test(args[1])))) return args[0];
  if (args.length === 2 && args[1] === FIREFOX && /\.json$/i.test(args[0])) return FIREFOX;
  return null;
};

const mode = (args, platform = process.platform) => {
  const from = caller(args, platform);
  if (from) return { mode: 'host', args, browser: null, caller: from };
  const [first] = args;
  if (first === undefined) return { mode: 'agent', args: [] };
  if (first === 'host') {
    const rest = args.slice(1);
    const flag = rest.find((a) => a.startsWith('--browser='));
    return { mode: 'host', args: rest, browser: flag ? flag.slice('--browser='.length) : null, caller: rest.find((a) => ORIGIN.test(a)) || (rest.includes(FIREFOX) ? FIREFOX : null) };
  }
  if (first === '--version') return { mode: 'version', args: [] };
  if (first === '--help' || first === '-h' || first === 'help') return { mode: 'help', args: [] };
  if (MODES.includes(first)) return { mode: first, args: args.slice(1) };
  if (first.startsWith('--')) return { mode: 'agent', args };
  return { mode: 'unknown', args };
};

const part = (name, stderr) => {
  const file = path.join(__dirname, '..', 'lib', `${name}.js`);
  if (fs.existsSync(file)) return require(file);
  stderr.write(`glaze-mcp: ${name} mode is not built yet\n`);
  return null;
};
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// io: stdin/stdout/stderr, plus what setup, uninstall and doctor run against (platform, env, node, run, src).
const main = async (args, io = {}) => {
  const { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = io;
  const platform = io.platform || process.platform;
  const ctx = { platform, env: io.env, node: io.node, run: io.run, src: io.src };
  const m = mode(args, platform);
  try {
    switch (m.mode) {
      case 'version':
        stdout.write(`${require('../package.json').version}\n`);
        return 0;
      case 'help':
        stdout.write(USAGE);
        return 0;
      case 'unknown':
        stderr.write(`glaze-mcp: unknown command ${args[0]}\n${USAGE}`);
        return 2;
      case 'host':
      case 'agent': {
        if (m.mode === 'host' && stdin.isTTY) {
          stderr.write('glaze-mcp host is started by the browser, not from a terminal. To set it up: npx glaze-mcp setup\n');
          return 2;
        }
        const mod = part(m.mode, stderr);
        if (!mod) return 2;
        let { args: rest } = m, env = io.env;
        if (m.mode === 'agent' && rest.includes('--from=mcpb')) {
          rest = rest.filter((a) => a !== '--from=mcpb');
          ({ env } = await require('../lib/mcpb.js').start({ platform, env: io.env, stderr, run: io.run }));
        }
        const code = await mod.main({ args: rest, browser: m.browser || null, caller: m.caller || null, io: { stdin, stdout, stderr, platform, env } });
        return typeof code === 'number' ? code : undefined;
      }
      case 'setup': {
        const IDS = require('../lib/ids.js');
        const { ids, rest } = IDS.fromArgs(m.args, { platform });
        const browsers = [];
        for (let i = 0; i < rest.length; i++) {
          const b = /^--browser(?:=(.*))?$/s.exec(rest[i]);
          if (!b) { stderr.write(`glaze-mcp: unknown option ${rest[i]}\n${USAGE}`); return 2; }
          const v = b[1] !== undefined ? b[1] : rest[++i];
          if (!v) { stderr.write('glaze-mcp: --browser needs a value\n'); return 2; }
          browsers.push(v);
        }
        const r = await require('../lib/install.js').setup({ ...ctx, ids, browsers });
        if (!r.browsers.length) {
          const I = require('../lib/install.js'), B = require('../lib/browsers.js');
          const c = I.context(ctx);
          stderr.write(`glaze-mcp: No supported browser found. Name one with --browser <id>: ${B.table(c.platform, c.env).map((b) => b.id).join(', ')}\n`);
          return 1;
        }
        stdout.write(`glaze-mcp ${r.version} is set up for ${list(r.names)}.\n`);
        if (r.ids.length > 1) stdout.write(`It also lets in ${r.ids.slice(1).join(', ')}.\n`);
        return 0;
      }
      case 'uninstall': {
        if (m.args.length) { stderr.write(`glaze-mcp: unknown option ${m.args[0]}\n${USAGE}`); return 2; }
        const r = await require('../lib/install.js').uninstall(ctx);
        stdout.write(r.removed.length ? `Removed ${r.removed.length} glaze-mcp files and keys.\n` : 'Nothing of glaze-mcp\'s to remove.\n');
        for (const k of r.kept) stdout.write(`Left alone (not glaze-mcp's own copy): ${k}\n`);
        return 0;
      }
      case 'doctor': {
        if (m.args.length) { stderr.write(`glaze-mcp: unknown option ${m.args[0]}\n${USAGE}`); return 2; }
        const D = require('../lib/doctor.js');
        const agent = fs.existsSync(path.join(__dirname, '..', 'lib', 'agent.js')) ? require('../lib/agent.js') : null;
        const report = await D.run({ ...ctx, live: agent && typeof agent.doctor === 'function' ? agent.doctor : undefined });
        stdout.write(D.text(report));
        return report.ok ? 0 : 1;
      }
    }
  } catch (e) {
    stderr.write(`glaze-mcp: ${e.message}\n`);
    return e.code === 'USAGE' ? 2 : 1;
  }
  return 2;
};

module.exports = { mode, main, caller };
if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { if (typeof code === 'number') process.exitCode = code; });
}
