// lib/background.js with Writer's document tools wired in (step C13): the lines the orchestrator puts in at merge, applied to
// the worker's source for test/mcp-writer.test.js and scripts/mcp-writer-check.js. A worker that already has them is
// returned as it is; one that has neither them nor the stubs they replace fails loudly.
const STUB = `// C13: Writer's document tools that need an open Writer page (port glaze:mcp-writer) → the page's answer, or null with none.
const mcpWriter = async (key, op, args, { signal } = {}) => null;
`;
const BRIDGE = `// C13: Writer's document tools that need an open Writer page (writer-mcp.js) reach it over port glaze:mcp-writer, admitted
// with the AI port's sender rules while agent access is on (lib/mcp/writer.js pages) → the page's answer, or null with none.
let mcpWriterHub = null;
const mcpWriterPages = () => { if (typeof GZ_MCP_WRITER === 'undefined') importScripts('mcp/writer.js'); return (mcpWriterHub ||= GZ_MCP_WRITER.pages({ runtime: chrome.runtime })); };
const mcpWriter = (key, op, args, o) => mcpWriterPages().call(key, op, args, o);
chrome.runtime.onConnect.addListener((p) => {
  if (p.name === 'glaze:mcp-writer') mcpWriterPages().connect(p, async () => await mcpOn() && await glazeOn() && await aiSender(p.sender || {}, { op: 'run', feature: 'writing' }) === true);
});
`;
const FILES = ["'mcp/tools-grades.js', ", "'mcp/tools-grades.js', 'doc-home.js', 'writer-sources.js', 'writer-tools.js', 'mcp/writer.js', "];
const REGISTER = [
  "  if (!GZ_AI_TOOLS.get('accounts_list')) { GZ_MCP_STUDY.register(GZ_AI_TOOLS); GZ_MCP_GRADES.register(GZ_AI_TOOLS); }\n",
  "  if (!GZ_AI_TOOLS.get('documents_list')) GZ_MCP_WRITER.register(GZ_AI_TOOLS, { papers: (f) => (brokerTurn ||= GZ_CARDS.queue())(() => f(openPapers())), bridge: mcpWriter });\n  mcpWriterPages().wake();\n",
];
const once = (src, a, b) => {
  const n = src.split(a).length - 1;
  if (n !== 1) throw new Error(`mcp-writer wiring: expected one ${JSON.stringify(a.slice(0, 60))} in lib/background.js, found ${n}`);
  return src.replace(a, () => b);
};
const wired = (src) => {
  if (src.includes('GZ_MCP_WRITER.register(')) return src;
  let out = once(src, STUB, BRIDGE);
  out = once(out, FILES[0], FILES[1]);
  return once(out, REGISTER[0], REGISTER[0] + REGISTER[1]);
};
module.exports = { wired, STUB, BRIDGE, FILES, REGISTER };
