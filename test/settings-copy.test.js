// The settings page's words: no taglines or site lines, one short sentence in view per description (longer ones behind
// their "?", trimmed there too), disclosures of what goes where kept in view, and a site badge only where a section or
// setting does not work on all three sites, naming the sites the code serves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const html = read('options.html');
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const words = (h) => h.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

// Disclosures of what goes where: in view whatever their length. By element id, or by the setting whose label holds one.
const PRIVACY_IDS = ['font-note', 'report-note', 'tabs-memory-note', 'ics-note', 'backup-keys-note', 'gcal-note'];
const PRIVACY_KEYS = ['enhance.gradescope', 'todo.gsDaily', 'mods.blocklist'];
const CAP = 90, POP_CAP = 260;

test('the master switch has a visible label', () => {
  const label = html.match(/<label[^>]*>[^<]*<input[^>]*id="enabled"[^>]*>([\s\S]*?)<\/label>/)?.[1];
  assert.ok(label && words(label), 'the master switch needs text beside its track');
});

test('no taglines or site lines on the settings page', () => {
  for (const f of ['options.html', 'options.js', 'lib/editor-xparts.js']) {
    assert.doesNotMatch(read(f), /section-note|site-scope/, f);
  }
});

test('descriptions in view are one short sentence, except disclosures of what goes where', () => {
  // Popovers out first: what is left of a .desc is in view.
  const shown = main.replace(/<div class="info-pop"[^>]*>[\s\S]*?<\/div>/g, '').replace(/<p class="desc info-pop"[^>]*>[\s\S]*?<\/p>/g, '');
  let n = 0;
  for (const m of shown.matchAll(/<(p|span) class="desc[^"]*"([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, , attrs, body] = m, text = words(body);
    if (!text || /role="status"/.test(attrs)) continue;
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    // The setting this description sits in, when it is a label's.
    const before = shown.slice(0, m.index), label = before.lastIndexOf('<label'), closed = before.lastIndexOf('</label>');
    const key = label > closed ? before.slice(label).match(/data-key="([^"]+)"/)?.[1] : undefined;
    if (PRIVACY_IDS.includes(id) || PRIVACY_KEYS.includes(key)) continue;
    n++;
    assert.ok(text.length <= CAP, `${id || key || text.slice(0, 40)}: ${text.length} characters in view`);
    assert.doesNotMatch(text, /[.!?]\s+\S/, `${id || key || text.slice(0, 40)}: one sentence`);
  }
  assert.ok(n > 40, `${n} descriptions checked`);
  for (const id of PRIVACY_IDS) assert.match(main, new RegExp(`<p class="desc"[^>]*\\bid="${id}"`), `#${id} stays in view`);
  for (const key of PRIVACY_KEYS) assert.ok(new RegExp(`data-key="${key}"[^>]*>(?:(?!</label>)[\\s\\S])*<span class="desc">`).test(main), `${key} keeps its disclosure in view`);
});

test('a "?" opens a trimmed description', () => {
  const pops = [...main.matchAll(/<(div|p) class="(?:desc )?info-pop" id="([^"]+)"[^>]*\spopover>([\s\S]*?)<\/\1>/g)];
  assert.ok(pops.length >= 40, `${pops.length} popovers`);
  for (const [, , id, body] of pops) assert.ok(words(body).length <= POP_CAP, `#${id}: ${words(body).length} characters`);
});

// Where each works, from the code: content.js loads the site parts (content-canvas.js, content-ultra.js; Moodle has none of
// their X.* hooks), moodle.css styles Moodle, features/moodle.js and features/navbar-moodle.js serve it.
const SHORT = { Canvas: 'Canvas', 'Blackboard Ultra': 'Blackboard', Moodle: 'Moodle' };
const ALL = ['Canvas', 'Blackboard Ultra', 'Moodle'];
const LMS_SECTIONS = {
  'look/palette': ALL, 'look/type': ALL, 'look/surfaces': ALL, 'look/background': ALL, 'look/motion': ALL, 'look/pointer': ALL,
  // Rotation runs in the worker; stickers through the command palette, which loads features/lookx.js on Moodle too.
  'look/extras': ALL, 'look/nav-layout': ALL, 'look/rules': ALL,
  'navigation/bar': ALL, 'navigation/items': ALL,
  // No course tabs or sidebar on Moodle: content.js's Moodle sheets hold neither.
  'navigation/tabs': ['Canvas', 'Blackboard Ultra'], 'navigation/sidebar': ['Canvas', 'Blackboard Ultra'],
  // Course colors, tint, toning (moodle.css data-gz-raw-courses) and the course menu (moodle.css) on all three.
  'courses/list': ALL, 'courses/cards': ['Canvas', 'Blackboard Ultra'],
  'study/todo': ['Canvas', 'Blackboard Ultra'], 'study/grades': ['Canvas', 'Blackboard Ultra'], 'study/reminders': ['Canvas', 'Blackboard Ultra'],
  'study/widgets': ['Canvas', 'Blackboard Ultra'], 'study/pet': ['Canvas', 'Blackboard Ultra'], 'study/imports': ['Canvas', 'Blackboard Ultra'],
  'study/schedule': ['Canvas', 'Blackboard Ultra'],
  // Glaze Writer replaces Blackboard Ultra's editors only.
  ...Object.fromEntries(['setup', 'papers', 'typing', 'proofing', 'discussions', 'submitting'].map((s) => [`writer/${s}`, ['Blackboard Ultra']])),
  'pages/content': ['Canvas', 'Blackboard Ultra'], 'pages/documents': ['Canvas', 'Blackboard Ultra'], 'pages/dashboard': ['Blackboard Ultra'],
  'pages/declutter': ['Canvas', 'Blackboard Ultra'], 'pages/shortcuts': ALL,
  // Announcements open in Glaze's pop-up on all three; the pop-up is every site's.
  'pages/announcements': ALL, 'pages/popups': ALL,
};
// Settings that work on other sites than their section: the badge beside each.
const SETTING_BADGES = {
  'navbar.cmenu': 'Canvas · Moodle', // GZ_NAVBAR_ULTRA has no course menu
  'navbar.tabs': 'Canvas · Blackboard',
  'sidebar.absorb': 'Blackboard',
  'card.create': 'Canvas', // features/cards.js: if (!ultra)
  'todo.teacher': 'Canvas', 'todo.progress': 'Canvas', 'todo.sync': 'Canvas', // Ultra never loads grading; ticks stay local there
  'enhance.overall': 'Canvas · Blackboard · Moodle', // features/moodle.js, moodle.css
  'enhance.docTheme': 'Canvas', 'enhance.docInk': 'Canvas', 'enhance.quizLight': 'Canvas',
  'declutter.faculty': 'Blackboard',
  footer: 'Canvas · Blackboard · Moodle', // content.js syncFooter, moodle.css #gz-footer
  'enhance.search': 'Canvas · Blackboard', // features/palette.js: !moodle
};
const badge = (sites) => sites.map((s) => SHORT[s]).join(' · ');

test('site badges: only where something does not work on all three sites, and true', () => {
  const sections = [...main.matchAll(/<section [^>]*data-editor-section="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)];
  assert.ok(sections.length >= 30, `${sections.length} sections`);
  for (const [open, route, body] of sections) {
    const sites = open.match(/data-sites="([^"]*)"/)?.[1];
    assert.ok(sites, `${route} names its sites`);
    const heading = body.match(/<div class="section-heading">([\s\S]*?)<\/div>/)[1];
    const got = heading.match(/<span class="site-badge" translate="no">([^<]*)<\/span>/)?.[1];
    if (!(route in LMS_SECTIONS)) { assert.equal(got, undefined, `${route}: no badge`); continue; }
    assert.equal(sites, LMS_SECTIONS[route].join(' · '), `${route}: data-sites`);
    assert.equal(got, LMS_SECTIONS[route].length === 3 ? undefined : badge(LMS_SECTIONS[route]), `${route}: badge`);
    // A setting's badge differs from its section's.
    for (const b of body.replace(heading, '').matchAll(/<span class="site-badge" translate="no">([^<]*)<\/span>/g)) {
      assert.notEqual(b[1], got || badge(ALL), `${route}: a setting's badge repeats its section's`);
    }
  }
  for (const [key, want] of Object.entries(SETTING_BADGES)) {
    const at = main.indexOf(`data-key="${key}"`);
    assert.ok(at > 0, key);
    const row = main.slice(Math.max(main.lastIndexOf('<div class="has-info', at), main.lastIndexOf('<div class="has-badge', at)), main.indexOf('</div>', at));
    assert.match(row, new RegExp(`<span class="site-badge" translate="no">${want}</span>`), `${key}: ${want}`);
  }
  // The site's own navigation (Glaze navigation off): nav.* reach Canvas and Ultra only; its More options Ultra's rail only.
  assert.match(main, /<div class="nav-own" id="sidebar" data-show="siteNav"><span class="site-badge" translate="no">Canvas · Blackboard<\/span>/);
  assert.match(main, /<div class="group" id="ultra-nav-editor"><span class="site-badge" translate="no">Blackboard<\/span>/);
  // Every badge is one of these.
  const kinds = new Set([...html.matchAll(/<span class="site-badge"[^>]*>([^<]*)</g)].map((m) => m[1]));
  for (const k of kinds) assert.ok(['Canvas', 'Blackboard', 'Moodle', 'Canvas · Blackboard', 'Canvas · Moodle', 'Canvas · Blackboard · Moodle'].includes(k), k);
});

test('course tabs offer every place lib/coursetabs.js knows, Automatic first', () => {
  require('../defaults.js');
  const CT = require('../lib/coursetabs.js');
  const values = [...main.matchAll(/<input type="radio" name="tabs\.at" value="([^"]+)">([^<]+)<\/label>/g)];
  assert.deepEqual(values.map((m) => m[1]).sort(), [...CT.SPEC.at[1]].sort());
  assert.deepEqual([values[0][1], values[0][2]], ['auto', 'Automatic']);
  assert.equal(CT.SPEC.at[0], 'auto', 'the default is the one listed first');
  // The note about Only in the navigation shows only for it.
  assert.match(read('options.js'), /\$\('#tabs \[data-tabs-nav-note\]'\)\.hidden = s\.tabs\.at !== 'nav' \|\| \(s\.navbar\.on && s\.navbar\.tabs\);/);
});

test('labels say what the code does', () => {
  const text = words(main);
  const help = main.match(/data-key="declutter.help"[^>]*><span>([^<]+)<\/span>/)?.[1];
  assert.equal(help, 'Hide help buttons and links', 'Canvas hides its navigation Help link too');
  assert.doesNotMatch(text, /in place of Blackboard's|get Blackboard's back/, 'Glaze navigation is on all three sites');
  assert.doesNotMatch(text, /Off by default|On by default/, 'fresh installs turn some of these on');
  assert.doesNotMatch(text, /switches between dimmed and off/, 'the moon button cycles three states');
  assert.match(text, /cycles Off, Dimmed and Inverted/);
  assert.match(words(main.slice(main.indexOf('id="info-enhance-coursemenu"'), main.indexOf('</div>', main.indexOf('id="info-enhance-coursemenu"')))), /nickname/i);
  assert.match(text, /Mark due dates in course content/);
  assert.match(text, /Highlight urgent work in To Do/);
  assert.match(main.slice(main.indexOf('data-key="declutter.banner"'), main.indexOf('</label>', main.indexOf('data-key="declutter.banner"'))), /Canvas: the pictures on Dashboard cards/);
  assert.doesNotMatch(main.slice(main.indexOf('<div class="nav-own"'), main.indexOf('<div class="stack" data-show="logo">')), />[^<]*Sidebar[^<]*</, 'the site navigation is not the sidebar');
  assert.doesNotMatch(read('options.js'), /sidebar contrast|Sidebar contrast/);
  assert.equal((main.match(/>Better To Do</g) || []).length, 1, 'one Better To Do');
  assert.doesNotMatch(read('lib/editor-xparts.js'), /Blackboard › Blackboard navigation/);
  const preview = html.slice(html.indexOf('<aside class="preview"'), html.indexOf('</aside>', html.indexOf('<aside class="preview"')));
  assert.doesNotMatch(preview, /Sidebar colors|Synthetic local pages|CSS px/);
});
