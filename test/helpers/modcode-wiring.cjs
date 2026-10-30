// C14's wiring in lib/background.js (mods' code tools for agent apps): the mcpCode stub replaced by lib/mcp/modroute.js, the
// router in the agent files, and the broker's hand-off of a code tool's answer to it (the glaze:mod env's tool). Applied to
// the worker's source while it still holds a stub; once it is wired, it must hold these lines as they are.
// For test/mcp-mods.test.js and scripts/mods-tools-check.js.
const WIRING = [
  ['const mcpCode = async (mod, name, args, ctx) => ({ ok: false, error: "This mod\'s agent tools are not available yet." });',
    'let mcpRoute = null;\nconst mcpCode = (mod, name, args, ctx) => (mcpRoute ||= GZ_MCP_MODROUTE.create({ tabs: chrome.tabs, browser: MCP_BROWSER, quiet: modQuiet })).code(mod, name, args, ctx);'],
  ["'mcp/approve.js', 'mcp/calls.js');", "'mcp/approve.js', 'mcp/calls.js', 'mcp/modroute.js');"],
  ["blocklist: () => modRead('modsBlocklist') };", "blocklist: () => modRead('modsBlocklist'), tool: (call, out, uid) => !!mcpRoute && mcpRoute.settle(s, m.mod, call, out, uid) };"],
];
const wired = (src) => WIRING.reduce((s, [stub, line]) => {
  if (s.includes(line)) return s;
  if (s.split(stub).length !== 2) throw new Error(`lib/background.js holds neither C14's wiring nor its stub: ${stub}`);
  return s.replace(stub, line);
}, src);
module.exports = { WIRING, wired };
