// Agent access's docs (docs/agents.md, PRIVACY.md, docs/privacy.md, mcp/README.md) against the code they describe: the
// storage they name, the numbers they give, the groups and Settings lines they quote, and the docs mirror listing them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const plain = (text) => text.replace(/\*\*/g, '').replace(/\s+/g, ' ');
const agents = () => plain(read('docs/agents.md'));
const policy = () => plain(read('PRIVACY.md'));
const section = () => plain(read('PRIVACY.md').split('\n## Agent access\n')[1]?.split('\n## ')[0] || '');

test('the docs mirror and the docs index list docs/agents.md', () => {
  assert.match(read('scripts/docs-mirror.js'), /'docs\/agents\.md': \['Agents', 'agents', '[^']+'\]/);
  assert.match(read('docs/README.md'), /\]\(agents\.md\)/);
  assert.match(read('docs/agents.md'), /^# Agents\n/);
});

test('the policy names every place agent access keeps something, as the code names it', () => {
  const G = require('../lib/mcp/grants.js'), A = require('../lib/mcp/tools-assign.js'), P = require('../lib/mcp/approve.js');
  const L = require('../lib/agent-link.js');
  const worker = read('lib/background.js');
  assert.ok(worker.includes("indexedDB.open('glaze-mcp-settings'"), 'the switch is kept in glaze-mcp-settings');
  assert.ok(worker.includes('`mcpConn:${c}`'), "Safari's connections are kept as mcpConn:<c>");
  assert.match(read('lib/mcp/writer.js'), /const SALT = 'mcpDocSalt'/);
  const text = section();
  for (const name of [G.DB, 'glaze-mcp-settings', G.KEY, G.CALLS, A.PREFIX, A.INDEX, L.KEY, L.INSTANCE, P.PREFIX, P.WINDOW, 'mcpConn:', 'mcpDocSalt']) {
    assert.ok(text.includes(`\`${name}`), `PRIVACY.md's Agent access names ${name}`);
  }
  assert.equal(G.LIMIT.calls, 200, 'the activity list keeps 200 rows: update PRIVACY.md, docs/agents.md and this test');
  assert.match(text, /last 200 calls/);
  assert.match(agents(), /last 200 calls/);
  assert.equal(A.LIMIT.keep, 100, 'the assignment cache keeps 100 reads: update PRIVACY.md and this test');
  assert.match(text, /the 100 used last/);
  assert.equal(P.TIMEOUT, 600e3, 'an approval waits 10 minutes: update docs/agents.md and this test');
  assert.match(agents(), /10 minutes/);
});

test('the policy states what agent access sends, what waits for the student and what Turn off and Forget all apps clear', () => {
  const text = section();
  for (const fact of [/off by default/i, /through a helper program on this computer/, /`glaze-mcp`/, /downloaded Glaze Mac app/,
    /per app and per group/, /Every built-in change waits for your OK/, /built-in agent tools never submit work/, /Agent access sends no data to FrostDev/,
    /that app's own (?:privacy )?policy/, /never what was asked or answered/,
    /Turn off[^.]*clears the kept assignment reads/, /Forget all apps[^.]*clears the kept assignment reads/,
    /Reset everything clears them all/, /`websiteContent`/]) assert.match(text, fact);
  for (const group of ['Courses, to-dos and schedule', 'Grades', 'Assignments and rubrics', 'Writer documents']) assert.ok(text.includes(group), group);
  assert.match(plain(read('docs/privacy.md')), /\]\(\.\.\/PRIVACY\.md#agent-access\)/);
});

test('the permission list matches the manifest: nativeMessaging is optional outside Safari', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.optional_permissions.includes('nativeMessaging'));
  assert.ok(!m.permissions.includes('nativeMessaging'));
  const line = policy().match(/- `nativeMessaging`[^]*?(?= - `)/)?.[0] || '';
  assert.doesNotMatch(line, /Safari only/);
  assert.match(line, /Chrome, Edge and Firefox, optional/);
  assert.match(line, /Settings → AI → Agents/);
  assert.match(line, /on-device AI/, 'Safari also routes AI native messages to the containing app');
});

test('docs/agents.md names the approval window\'s groups and buttons as Glaze shows them', () => {
  const page = read('lib/mcp/approve-page.js'), html = read('lib/mcp/approve.html'), text = agents();
  for (const [, words] of page.matchAll(/(?:courses|grades|writer|assignments): t\('([^']+)'\)/g)) assert.ok(text.includes(words), words);
  for (const button of [...html.matchAll(/<button id="(?:yes|no)"[^>]*>([^<]+)</g)].map((x) => x[1].replace('&#39;', "'"))) assert.ok(text.includes(button), button);
});

// Settings → AI → Agents (lib/editor-agents.js, branch mcp-options until it merges): every line its link state shows.
const editor = path.join(root, 'lib/editor-agents.js');
test('docs/agents.md covers each helper state and its command', { skip: !fs.existsSync(editor) && 'lib/editor-agents.js is not on this branch yet' }, () => {
  const E = require(editor), text = agents(), id = 'abcdefghijklmnopabcdefghijklmnop';
  const states = ['connected', 'connecting', 'restart', 'not-installed', 'forbidden', 'exited', 'old-helper', E.NO_NODE, 'needs-permission'];
  for (const browser of ['chrome', 'firefox', 'safari']) for (const state of states) {
    const l = E.line({ state }, { browser, id }, (s) => s);
    if (!l) continue;
    if (state !== 'not-installed') for (const part of l.text.split('{command}').map((s) => s.trim()).filter(Boolean)) assert.ok(text.includes(part), `${browser} ${state}: ${part}`);
    if (l.command) assert.ok(text.includes(`\`${l.command.replace(id, '<id>')}\``), l.command);
  }
});


test('agent docs distinguish local transport from school reads and mod network grants', () => {
  for (const file of ['PRIVACY.md', 'docs/privacy.md', 'docs/agents.md']) {
    const text = file === 'PRIVACY.md' ? section() : plain(read(file));
    assert.doesNotMatch(text, /Glaze talks only to a helper|Glaze sends nothing to FrostDev/);
    assert.match(text, /Agent access sends no data to FrostDev/);
    assert.match(text, /mod[^.]*approved (?:network )?hosts/i);
    assert.match(text, /app[^.]*arguments/i);
  }
  assert.doesNotMatch(section(), /Glaze never submits work, posts, sends messages or changes grades for an app/);
});

test('approval retention includes action text and cleanup is conditional on later activity', () => {
  const text = section(), P = require('../lib/mcp/approve.js');
  assert.equal(P.KEEP, 3600e3);
  assert.match(text, /action summary[^.]*document text or citation details/);
  assert.match(text, /eligible for cleanup an hour after creation/);
  assert.match(text, /Cleanup runs on later requests and agent-worker startup/);
  assert.doesNotMatch(text, /goes about an hour/);
});

test('agent retention describes usage eviction and the settings that survive reset', () => {
  const text = section();
  assert.match(text, /100 used last[^;]*no time-based expiry/);
  assert.match(text, /Site removal and Reset everything leave the agent switch, apps, grants and activity unchanged/);
  assert.match(text, /Revoke and Forget all apps leave the activity list/);
  assert.match(plain(read('docs/privacy.md')), /Reset everything[^.]*switch, apps, grants and activity/);
});

test('agent identity and helper uninstall claims do not promise verified identities or complete erasure', () => {
  for (const file of ['PRIVACY.md', 'docs/agents.md', 'mcp/README.md']) {
    const text = file === 'PRIVACY.md' ? section() : plain(read(file));
    assert.match(text, /self-reported and unverified/);
    assert.match(text, /Windows[^.]*no program path/);
    assert.doesNotMatch(text, /only your user account can open/);
    assert.match(text, /modified copies/);
    assert.match(text, /run folder/);
  }
});

test('all agent Settings paths include AI, including the helper and mod permission copy', () => {
  for (const file of ['docs/mods-api.md', 'docs/agents.md', 'PRIVACY.md', 'docs/privacy.md', 'mcp/README.md',
    'mcp/lib/agent.js', 'lib/editor-mods.js', 'lib/modtools.js']) {
    assert.doesNotMatch(read(file), /Settings → Agents/, file);
    assert.match(read(file), /Settings → AI → Agents/, file);
  }
});

test('features lists Agents and the AI harness describes the active Writer bridge', () => {
  assert.match(read('docs/features.md'), /\[Agents\]\(agents\.md\)/);
  const text = plain(read('docs/ai-harness.md'));
  assert.doesNotMatch(text, /for a later MCP integration|nothing offers them to a model yet/);
  assert.match(text, /lib\/mcp\/writer\.js/);
  assert.match(text, /Settings → AI → Agents/);
});

test('helper uninstall documents removal of otherwise empty Windows host keys', () => {
  assert.match(plain(read('mcp/README.md')), /otherwise empty host key/);
});
