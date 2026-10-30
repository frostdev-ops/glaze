// What Claude Desktop's bundle (mcp/mcpb/manifest.json) does before agent mode, as `glaze-mcp --from=mcpb`: it sets the
// browsers up in process (install.ensure, writing only what differs, leaving a newer npx setup alone), so adding the
// bundle is the whole install. Claude's settings arrive as GLAZE_MCP_BROWSER (an id or a browser's name) and
// GLAZE_MCP_INSTALL_HOSTS ("false" turns this off); a setting Claude leaves unset arrives as its own ${user_config.…}.
// Claude may run this on its own runtime, which a browser can't start, so launchers name a system node or say there is
// none (nodes.js). Nothing here stops the agent: what fails goes to stderr, which Claude keeps in its logs.
'use strict';
const B = require('./browsers.js');
const I = require('./install.js');
const N = require('./nodes.js');
const R = require('./rendezvous.js');

const unset = (v) => typeof v !== 'string' || !v.trim() || /^\$\{user_config\.[^}]*\}$/.test(v.trim());
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// The browser id a setting names, by id or name in any case; safari is the Glaze app's (the DMG build). null for none.
const browser = (v, table) => {
  if (unset(v)) return null;
  const s = v.trim().toLowerCase();
  const b = table.find((x) => x.id === s || x.name.toLowerCase() === s);
  if (b) return b.id;
  return R.BROWSER.test(s) ? s : null;
};

// → { env: what agent mode gets, node: the launchers' node (null for none), setup: install.ensure's answer or null }
const start = async (o = {}) => {
  const platform = o.platform || process.platform, stderr = o.stderr || process.stderr;
  const env = { ...(o.env || process.env) };
  const log = (s) => stderr.write(`glaze-mcp: ${s}\n`);
  const named = env.GLAZE_MCP_BROWSER, hosts = env.GLAZE_MCP_INSTALL_HOSTS;
  delete env.GLAZE_MCP_BROWSER;
  delete env.GLAZE_MCP_INSTALL_HOSTS;
  let table = [];
  try { table = B.table(platform, env); } catch (e) { log(e.message); }
  const id = browser(named, table);
  if (id) env.GLAZE_MCP_BROWSER = id;
  else if (!unset(named)) log(`GLAZE_MCP_BROWSER is not a browser: ${named}; using the one Glaze last opened in`);
  if (!unset(hosts) && hosts.trim().toLowerCase() === 'false') return { env, node: null, setup: null };

  let node = null;
  try {
    const run = o.run || I.runFile;
    node = await N.choose({ platform, env, run, execPath: o.execPath, versions: o.versions, list: o.list });
    const present = B.present(table).map((b) => b.id);
    const browsers = [...new Set([...present, ...(table.some((b) => b.id === id) ? [id] : [])])];
    if (!browsers.length) {
      if (!node) log(N.MISSING);
      log('no supported browser found to set up');
      return { env, node, setup: null };
    }
    // The launchers fall back on the other nodes found here, so an upgrade or removal of this one doesn't break them.
    const also = node === null ? [] : await N.all({ platform, env, run, list: o.list, skip: [node] });
    const setup = await I.ensure({ platform, env, run, node, also, browsers, ifNeeded: true, keepNewer: true });
    if (setup.node !== undefined) node = setup.node;
    if (setup.newer) log(`leaving glaze-mcp ${setup.newer}, set up already, in place`);
    else {
      if (!node) log(N.MISSING);
      if (setup.changed) log(`set up ${list(setup.names)}`);
    }
    return { env, node, setup };
  } catch (e) {
    log(`couldn't set up browsers: ${e.message}`);
    return { env, node, setup: null };
  }
};

module.exports = { start, browser };
