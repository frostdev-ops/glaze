// Mirrors Glaze's docs into the GitHub wiki and frostdev.io's guides, so docs/ stays the one place to edit them.
//   node scripts/docs-mirror.js <glaze.wiki checkout> <frostdev.io checkout>
// Every page below becomes a wiki page that links to its frostdev.io guide, and a Markdown file in the site's
// src/content/glaze-docs/, which its src/pages/guides/glaze-[doc].astro renders at /guides/glaze-<doc>. Relative links
// are pointed at the same page in each copy, or at the file on GitHub. Commit and push both checkouts afterwards.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const REPO = 'https://github.com/frostdev-ops/glaze';
const SITE = 'https://frostdev.io';
// Source → wiki page, guide slug (null: the guides hub's Glaze list) and the guide's description.
const PAGES = {
  'docs/README.md': ['Home', null, ''],
  'docs/install.md': ['Install', 'install', 'Install Glaze in Chrome, Edge or Brave, Firefox, Safari on a Mac, or on iPhone and iPad.'],
  'docs/features.md': ['Features', 'features', 'Everything Glaze does on Blackboard Ultra, Canvas and Moodle, site by site.'],
  'docs/privacy.md': ['Privacy-summary', 'privacy', 'What Glaze keeps on your device, and the few requests it makes and where they go.'],
  'docs/agents.md': ['Agents', 'agents', 'Connect AI apps on your computer to Glaze.'],
  'docs/development.md': ['Development', 'development', 'How Glaze is put together, and how to build, test, package and publish it.'],
  'docs/mods-api.md': ['Mods-API', 'mods-api', 'Make a Glaze mod: the manifest, permissions, slots and the glaze object your code talks to.'],
  'docs/mods-widgets.md': ['Widgets-made-of-blocks', 'mods-widgets', 'Widgets with no code: the blocks format Glaze draws itself on every browser.'],
  'docs/firefox-android.md': ['Firefox-for-Android-testing', 'firefox-android', 'Test Glaze in Firefox for Android on a local emulator.'],
  'server/README.md': ['Run-your-own-relay', 'relay', 'Run your own relay for Glaze share sessions: Node or Docker, TLS, storage, limits and backups.'],
};
const guide = (slug) => (slug ? `/guides/glaze-${slug}` : '/guides#glaze-docs');

const [wiki, site] = process.argv.slice(2);
if (!wiki || !site) {
  console.error('Usage: node scripts/docs-mirror.js <glaze.wiki checkout> <frostdev.io checkout>');
  process.exit(1);
}

// A relative link, resolved against the page it's in, pointed at that page's copy here (wiki or site), else at GitHub.
function relink(text, from, to) {
  return text.replace(/\]\((?!https?:|mailto:|#)([^)\s#]+)(#[^)\s]*)?\)/g, (all, target, hash = '') => {
    const file = path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
    const page = PAGES[file];
    if (page) return `](${to === 'wiki' ? page[0] : guide(page[1])}${hash})`;
    if (file === 'PRIVACY.md' && to === 'site') return `](/glaze/privacy${hash})`;
    return `](${REPO}/blob/main/${file}${hash})`;
  });
}

const out = path.join(site, 'src/content/glaze-docs');
fs.mkdirSync(out, { recursive: true });
for (const [from, [name, slug, description]] of Object.entries(PAGES)) {
  const text = fs.readFileSync(path.join(ROOT, from), 'utf8');
  const title = text.match(/^# (.+)$/m)[1];
  // Both copies have their own title (the wiki page's name, the guide's heading), so the source's # line goes.
  const body = text.replace(/^# .+\n+/m, '');
  const there = slug ? `[${title} on frostdev.io](${SITE}${guide(slug)})` : `[Glaze guides on frostdev.io](${SITE}${guide(null)})`;
  fs.writeFileSync(path.join(wiki, `${name}.md`), `> Also a guide: ${there}\n\n${relink(body, from, 'wiki')}`);
  if (!slug) continue;
  const updated = execFileSync('git', ['log', '-1', '--format=%cs', '--', from], { cwd: ROOT, encoding: 'utf8' }).trim();
  const front = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\nupdated: ${JSON.stringify(updated)}\nwiki: ${JSON.stringify(`${REPO}/wiki/${name}`)}\n---\n`;
  fs.writeFileSync(path.join(out, `${slug}.md`), `${front}<!-- Mirrored from Glaze's ${from} by its scripts/docs-mirror.js: edit it there. -->\n\n${relink(body, from, 'site')}`);
}
console.log(`Wrote ${Object.keys(PAGES).length} wiki pages to ${wiki} and ${Object.keys(PAGES).length - 1} guides to ${out}.`);
