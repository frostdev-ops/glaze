// Screenshot pages of the local Canvas LMS (fake data, http://localhost:3000) with Glaze running, under
// chosen Glaze settings, to check a Canvas stylesheet by eye. Loads a throwaway copy of this checkout's
// extension (its manifest widened to http://localhost/*; the real one is untouched) into a fresh Chromium
// profile and logs in as the student from ~/Projects/canvas-lms/glaze/credentials.env. Only GETs pages
// (clicking a teacher's quiz Preview button makes Canvas save a preview attempt, not the student's).
// Animations hold still (reduced motion). Per page it prints the path, title, whether Glaze's stylesheets
// are linked, how many data-gz-* attributes <html> has, and any page or console errors ("ext" = from Glaze).
//   NODE_PATH=/path/to/node_modules node scripts/canvas-shots.js [options] [path ...]   (needs playwright)
//
//   --look <name>      a preset or look from defaults.js (Frost, Paper, Aurora Night ...); repeat for several.
//                      Default: Frost (dark) and Paper (light).
//   --settings <json>  Glaze settings merged over the look (or over the defaults, with no --look); a JS
//                      object works too: '{enabled:false}', '{bg:{kind:"scene",scene:"horizon"}}'
//   --out <dir>        where the PNGs go (default: a new temp dir, printed). Named <look>-<page>.png
//   --course-menu     open Glaze’s Dashboard Course menu and enable tint in the throwaway capture profile
//   --sync <json>      more sync items saved beside the settings, such as the course cards' (lib/cards.js):
//                     '{card:{pet:"cat"},cards:{"canvas:{origin}/{bio}":{k:"solid",c:"#e11d48"}}}'; {origin} is the
//                     local Canvas, {bio} and the others its course ids
//   --width, --height  viewport, 1440x900 by default;  --full  captures the whole page
//   --user <who>       student (default), teacher or admin
//   --html <dir>       also save each page's DOM as <dir>/canvas-<page>.html, a test fixture: script bodies
//                      emptied, tokens and verifiers redacted, repeated rows trimmed to stay under 150 KB
//   --audit            list visible elements whose fill or text is wrong for the palette (light patches in a
//                      dark one, dark in a light one, text under 4.5:1), biggest first; JSON in <out>/audit.json.
//                      It checks what the screenshot shows: add --full for the whole page
//   --perf <runs>      no screenshots: load each page <runs> times at 4x CPU throttling, from a dark blank tab (first page
//                      of a tab) and from another Canvas page (the next one), and report the frames painted light, when
//                      the page turned dark, first paint and main-thread script time. JSON in <out>/perf.json
//   --eval <js>        run this in each page once it has loaded, before the shot: sample content put in client side
//                      (never saved to Canvas), e.g. "document.querySelector('.user_content').insertAdjacentHTML(…)"
//   --wait <seconds>   hold each page that long before its shot: a timer firing, a scheduled boundary passing
//   path ...           pages to shoot instead of the default set (dashboard, calendar, inbox, grades and
//                      BIO 1100's course pages); {bio} {eng} {math} {hist} stand for course ids.
//                      name=/path names the output; /path@selector clicks that first (a modal, the editor);
//                      ?glaze_view=planner (or cards) shows the dashboard in that view without saving it;
//                      ?glaze_lang=de serves a page as <html lang="de">, the language Glaze writes its own words in
//   CHROME=/path/to/chrome runs that browser instead of Chrome for Testing.
//
//   node scripts/canvas-shots.js
//   node scripts/canvas-shots.js --look Paper --look Midnight /courses/{bio}/modules /grades
//   node scripts/canvas-shots.js --settings '{enabled:false}' --full /courses/{eng}
//   node scripts/canvas-shots.js --settings '{enabled:false}' --html test/fixtures planner=/?glaze_view=planner
const { chromium } = require('playwright');
const { parseArgs } = require('util');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../defaults.js');
const { redact, fixture } = require('./redact.js');
const { auditFrame } = require('./audit.js');

const root = path.join(__dirname, '..');
const BASE = 'http://localhost:3000';
const CREDS = path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const CHROME = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const COURSES = { bio: 'BIO 1100', eng: 'ENG 1100', math: 'MATH 1350', hist: 'HIST 2010' };
// Pages loaded at once.
const TABS = 2;
// Top-level entries that aren't the extension (or are too big to copy for every run).
const NOT_EXTENSION = new Set(['assets', 'safari', 'scripts', 'store', 'test', 'parity', 'dist', 'release', 'node_modules']);
const DOCS = /\.(md|sh)$|^LICENSE$/;

const die = (msg) => { console.error(msg); process.exit(1); };
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const slug = (s) => s.replace(/[{}]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();
// [name=]/path[@selector to click]
const PAGE = /^(?:([\w-]+)=)?(\/[^@]*)(?:@(.+))?$/;

// One look's settings, normalized by the extension's own sanitizer: a preset or look, --settings over it
// (a group like bg merges key by key, so '{bg:{intensity:90}}' keeps the look's scene).
const settingsFor = (name, user) => {
  const pick = name ?? user.preset ?? G.GZ_DEFAULTS.preset;
  const preset = G.GZ_PRESETS.find(([n]) => n === pick);
  const look = !preset && G.GZ_LOOKS.find((l) => l.name === pick);
  if (!preset && !look) die(`No preset or look named "${pick}". Presets: ${G.GZ_PRESETS.map(([n]) => n).join(', ')}. Looks: ${G.GZ_LOOKS.map((l) => l.name).join(', ')}.`);
  const base = preset ? { preset: pick, colors: { ...preset[1] } } : G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, look);
  const merged = { ...base };
  for (const [k, v] of Object.entries(user)) merged[k] = plain(v) && plain(base[k]) ? { ...base[k], ...v } : v;
  return G.GZ_SANITIZE(merged);
};

// Parse and check the command line before anything is launched.
const parse = () => {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: {
      look: { type: 'string', multiple: true }, settings: { type: 'string' }, out: { type: 'string' },
      width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' }, full: { type: 'boolean' }, 'course-menu': { type: 'boolean' }, sync: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      user: { type: 'string', default: 'student' }, html: { type: 'string' }, audit: { type: 'boolean' }, perf: { type: 'string' },
      eval: { type: 'string' }, wait: { type: 'string', default: '0' },
    } });
  } catch (e) { die(`${e.message}\nSee --help.`); }
  const { values: opt, positionals } = parsed;
  if (opt.help) { console.log(fs.readFileSync(__filename, 'utf8').split(/\n(?!\/\/)/)[0].replace(/^\/\/ ?/gm, '')); process.exit(0); }
  const size = { width: +opt.width, height: +opt.height };
  if (!(size.width > 0 && size.height > 0)) die('--width and --height must be positive numbers.');
  if (positionals.some((p) => !PAGE.test(p))) die('Pages are paths on Canvas, like /grades, /courses/{bio}/modules or name=/path@selector.');
  if (!['student', 'teacher', 'admin'].includes(opt.user)) die('--user is student, teacher or admin.');
  let user = {};
  // A JS object literal or JSON, so {enabled:false} works without quoting its keys.
  try { if (opt.settings) user = new Function(`return (${opt.settings})`)(); } catch (e) { die(`--settings: ${e.message}`); }
  if (!plain(user)) die('--settings must be an object.');
  const names = opt.look?.length ? opt.look : opt.settings ? [null] : ['Frost', 'Paper'];
  const looks = names.map((name) => ({ label: slug(name || 'custom'), settings: settingsFor(name, user) }));
  const out = opt.out ? path.resolve(opt.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-canvas-shots-'));
  const html = opt.html && path.resolve(opt.html);
  const perf = opt.perf === undefined ? 0 : +opt.perf;
  if (!(perf >= 0 && Number.isInteger(perf))) die('--perf takes a number of runs.');
  let sync = {};
  try { if (opt.sync) sync = new Function(`return (${opt.sync})`)(); } catch (e) { die(`--sync: ${e.message}`); }
  if (!plain(sync)) die('--sync must be an object.');
  if (!(+opt.wait >= 0)) die('--wait takes seconds.');
  return { evalJs: opt.eval, wait: +opt.wait * 1000, size, positionals, full: !!opt.full, courseMenu: !!opt['course-menu'], out, looks, user: opt.user, html, audit: !!opt.audit, perf, sync };
};

// The extension as it is in the working copy, with localhost added to where it runs and what it exposes.
const devCopy = (dest) => {
  fs.mkdirSync(dest);
  for (const f of fs.readdirSync(root)) {
    if (f !== 'manifest.json' && !f.startsWith('.') && !NOT_EXTENSION.has(f) && !DOCS.test(f)) fs.cpSync(path.join(root, f), path.join(dest, f), { recursive: true });
  }
  // The parts of assets/ the extension ships (package.sh): the card pets and the study buddy's critters.
  for (const d of ['assets/art/pets', 'assets/art/stickers/critters']) fs.cpSync(path.join(root, d), path.join(dest, d), { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const e of [...(m.content_scripts || []), ...(m.web_accessible_resources || [])]) e.matches.push('http://localhost/*');
  // And to inject there: Glaze's on-demand files (lib/background.js 'glaze:load') need host access.
  m.host_permissions = [...(m.host_permissions || []), 'http://localhost/*'];
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
};

// Chromium names an unpacked extension after its folder: the path's SHA-256, hex digits mapped to a-p.
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

const login = async (page, user) => {
  const cred = Object.fromEntries(fs.readFileSync(CREDS, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2'))));
  // No error text from here on: Playwright's call log can quote what was typed.
  try {
    await page.goto(`${BASE}/login/canvas`);
    const who = user.toUpperCase();
    await page.fill('input[name="pseudonym_session[unique_id]"]', cred[`${who}_EMAIL`]);
    await page.fill('input[name="pseudonym_session[password]"]', cred[`${who}_PASSWORD`] || cred.PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.press('input[name="pseudonym_session[password]"]', 'Enter')]);
  } catch { die(`Canvas login failed (is ${BASE} up, and the ${user} login right in ${CREDS}?)`); }
};

// Course ids by placeholder, and the pages that go with the default set (ids change when Canvas is reseeded).
const lookup = async (context) => {
  const api = async (p) => (await context.request.get(`${BASE}/api/v1${p}`)).json();
  const courses = await api('/courses?per_page=50');
  if (!Array.isArray(courses)) die('Canvas did not list the courses; the login did not take.');
  return { ids: Object.fromEntries(Object.entries(COURSES).map(([k, code]) => [k, courses.find((c) => c.course_code === code)?.id])), api };
};
const defaultPages = async ({ ids, api }) => {
  if (!ids.bio) die(`Canvas has no course ${COURSES.bio}; the default pages need it.`);
  const first = async (what, key) => (await api(`/courses/${ids.bio}/${what}?per_page=1`))[0]?.[key];
  const [assignment, topic, wiki] = await Promise.all([first('assignments', 'id'), first('discussion_topics', 'id'), first('pages', 'url')]);
  const c = '/courses/{bio}';
  return [['dashboard', '/'], ['calendar', '/calendar'], ['conversations', '/conversations'], ['grades', '/grades'],
    ['bio-home', c], ['bio-modules', `${c}/modules`], ['bio-assignments', `${c}/assignments`], ['bio-assignment', `${c}/assignments/${assignment}`],
    ['bio-grades', `${c}/grades`], ['bio-discussions', `${c}/discussion_topics`], ['bio-topic', `${c}/discussion_topics/${topic}`],
    ['bio-page', `${c}/pages/${wiki}`], ['bio-syllabus', `${c}/assignments/syllabus`], ['bio-quizzes', `${c}/quizzes`],
    ['bio-files', `${c}/files`], ['bio-people', `${c}/users`]];
};
const fill = (p, ids) => p.replace(/\{(\w+)\}/g, (_, k) => ids[k] ?? die(k in COURSES ? `Canvas has no course ${COURSES[k]} for {${k}}.` : `Unknown placeholder {${k}} in ${p}; use ${Object.keys(COURSES).map((c) => `{${c}}`).join(' ')}.`));

// Glaze links its stylesheets before it knows the page is one it styles, and drops them if not. Noting any
// that ever arrive lets "no links" say "never ran" or "ran, then switched itself off".
const watchLinks = () => new MutationObserver((rs) => {
  for (const r of rs) for (const n of r.addedNodes) if (n.tagName === 'LINK' && n.href.startsWith('chrome-extension://')) window.__gzLinked = true;
}).observe(document, { childList: true, subtree: true });
// What an author needs to see at a glance: did Glaze's stylesheets and attributes land on this page?
const probe = () => ({
  title: document.title,
  css: [...document.querySelectorAll('link')].some((l) => l.href.startsWith('chrome-extension://')) ? 'yes' : window.__gzLinked ? 'no (added, then removed)' : 'no (never added)',
  attrs: document.documentElement.getAttributeNames().filter((n) => n.startsWith('data-gz-')).length,
  surface: document.documentElement.style.getPropertyValue('--gz-surface') || '-',
});
// Page reveal: Glaze holds a page back (data-gz-loading) and lets it in (data-gz-reveal) once it is built.
const revealed = () => !document.querySelector('[data-gz-loading], [data-gz-reveal]');

// How tall the window must be to show the whole page. Canvas scrolls most course pages inside a container,
// not the document, so fullPage alone would stop at the window.
const fitHeight = () => Math.ceil(Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('*')]
  .filter((e) => e.clientHeight > 300 && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY))
  .map((e) => e.scrollHeight + e.getBoundingClientRect().top)));
// `then` runs while the window still shows what was captured.
const capture = async (page, file, { full, size }, then = async () => {}) => {
  if (!full) return page.screenshot({ path: file }).then(then);
  // ponytail: Chromium stops drawing around 16k px; a page taller than that is cut off there.
  await page.setViewportSize({ width: size.width, height: Math.min(16000, Math.max(size.height, await page.evaluate(fitHeight))) });
  await page.waitForTimeout(200);
  try { await page.screenshot({ path: file }); await then(); } finally { await page.setViewportSize(size); }
};

// The page's DOM as a fixture: what Canvas built, without its code or anything that unlocks a session.
// Runs of look-alike siblings (rows, cards, options) are cut to `keep` each, so a file stays small; `coarse`
// counts siblings alike by their first class alone (a locked module and an open one).
const snapshot = ([keep, coarse]) => {
  const doc = document.documentElement.cloneNode(true);
  // Inline rules (InstUI's generated ones, the editor's skin) are most of a page's bytes and none of its markup.
  for (const s of doc.querySelectorAll('script, style')) s.textContent = '';
  for (const m of doc.querySelectorAll('meta[name^="csrf"]')) m.remove();
  for (const i of doc.querySelectorAll('input[type="hidden"]')) if (/token|session|verifier|csrf/i.test(i.name)) i.setAttribute('value', '');
  // Rows only: the head's run of stylesheets is what tells a Canvas page apart (brandable_css), so it stays whole.
  const body = doc.querySelector('body');
  for (const p of body ? [body, ...body.querySelectorAll('*')] : []) {
    let sig = null, run = 0;
    for (const c of [...p.children]) {
      if (/^(STYLE|SCRIPT)$/.test(c.tagName)) continue;
      // Canvas puts ids in row classes (context_module_item_12), so digits don't count.
      const cls = c.getAttribute('class') || '';
      const s = `${c.tagName}.${coarse ? cls.split(' ')[0] : cls}`.replace(/\d+/g, '#');
      if (s !== sig) { sig = s; run = 0; } else if (++run >= keep) c.remove();
    }
  }
  return `<!doctype html>\n${doc.outerHTML}`;
};
const FIXTURE_MAX = 150 * 1024;
const saveHtml = async (page, file, url) => {
  let h;
  for (const level of [[12], [6], [3], [2], [3, 1], [2, 1], [1, 1]]) if ((h = redact(await page.evaluate(snapshot, level))).length <= FIXTURE_MAX) break;
  fs.writeFileSync(file, fixture(url, h));
  return h.length;
};

// A tab, and the page errors and console errors it has seen since they were last cleared.
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.location().url.startsWith('chrome-extension://') ? 'ext: ' : ''}${m.text().split('\n')[0]}`));
  return { page, errors };
};

// Load a page, let it settle, save the screenshot; gives its diagnostics line.
const shoot = async ({ page, errors }, { label, settings, out, courseMenu, html, audit, evalJs, wait, ...view }, [name, url, click]) => {
  errors.length = 0;
  let note = '';
  try {
    const res = await page.goto(BASE + url);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { note += ' (network never idle)'; });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(revealed, null, { timeout: 3000 }).catch(() => { note += ' (reveal unfinished)'; });
    // Long enough for three.js to load and draw when a scene is on.
    await page.waitForTimeout(settings.enabled && settings.bg.kind === 'scene' ? 1500 : 400);
    const here = new URL(page.url());
    if (res.status() >= 400 || here.pathname.startsWith('/login')) throw new Error(`HTTP ${res.status()}, ended at ${here.pathname}`);
    if (here.pathname + here.search !== url) note += ` (now ${here.pathname})`;
    await page.evaluate(() => window.scrollTo(0, 0));
    if (click) {
      await page.locator(click).first().click({ timeout: 5000 });
      // Off whatever was clicked, so no hover or tooltip is left in this or the tab's next shot.
      await page.mouse.move(view.size.width - 1, view.size.height - 1);
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    if (courseMenu && here.pathname === '/') {
      await page.locator('.gz-cm-btn').nth(1).click();
      await page.locator('.gz-cm-tint input').check();
      await page.waitForTimeout(300);
      // Store capture only: replace a QA label in the fake seed without writing to Canvas.
      for (const label of await page.getByText('zz T22 unread and what-if proof', { exact: true }).all()) {
        await label.evaluate((e) => { e.textContent = 'Lab report 1: Cells and membranes'; });
      }
    }
    if (evalJs) await page.evaluate(evalJs);
    if (evalJs || wait) await page.waitForTimeout(wait || 400);
    const p = await page.evaluate(probe);
    let found;
    await capture(page, path.join(out, `${label}-${name}.png`), view, async () => {
      if (!audit) return;
      found = [];
      // Canvas's frames, and the editor's (about:blank, same origin), not other sites'.
      for (const f of page.frames()) if (f.url().startsWith(BASE) || (f.url() === 'about:blank' && f.parentFrame())) found.push(...(await f.evaluate(auditFrame).catch(() => ({ issues: [] }))).issues.map((i) => ({ ...i, frame: f === page.mainFrame() ? undefined : new URL(f.url()).pathname })));
      found.sort((x, y) => y.area - x.area);
      note += `\n${found.slice(0, 8).map((i) => `      ${String(i.area).padStart(7)}  ${i.kind.padEnd(10)} ${i.fg ? `${i.fg} on ${i.bg} ${i.contrast}:1` : i.bg}  ${i.frame ? `[${i.frame}] ` : ''}${i.el}`).join('\n')}`;
    });
    if (html) note += ` html=${Math.round(await saveHtml(page, path.join(html, `canvas-${name}.html`), url) / 1024)}KB`;
    const errs = [...new Set(errors)];
    return { ok: true, audit: found && { look: label, page: name, url, issues: found }, line: `  ${url}  "${p.title}"  glaze-css=${p.css}  data-gz=${p.attrs}  surface=${p.surface}  errors=${errs.length ? `${errs.length}: ${errs.slice(0, 2).map((e) => e.slice(0, 100)).join(' | ')}` : 0}${note}` };
  } catch (e) { return { ok: false, line: `  ${url}  FAILED: ${e.message.split('\n')[0]}` }; }
};

// --perf. In the page from its first script: the first frame whose ground (the body's fill, else the root's) is dark.
const watchDark = () => {
  if (window !== top) return;
  const dark = (c) => { const m = c.match(/[\d.]+/g); return m && +(m[3] ?? 1) > 0.5 && (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255 < 0.25; };
  const opaque = (c) => { const m = c.match(/[\d.]+/g); return m && +(m[3] ?? 1) > 0.5; };
  const tick = () => {
    if (window.__gzDarkAt) return;
    const fills = [document.body, document.documentElement].filter(Boolean).map((e) => getComputedStyle(e).backgroundColor);
    const ground = fills.find(opaque);
    if (ground && dark(ground)) window.__gzDarkAt = performance.now();
    else if (performance.now() < 15000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Glaze's own words as they appear: text in its elements and its data-gz-* labels, with when.
  const words = window.__gzWords = [];
  const note = (s) => { if (s && /\p{L}{3}/u.test(s) && words.length < 400) words.push({ at: Math.round(performance.now()), s: s.trim().slice(0, 120) }); };
  const mine = (e) => e?.nodeType === 1 && !!e.closest('[id^="gz-"], [class^="gz-"], [class*=" gz-"]');
  new MutationObserver((rs) => {
    for (const r of rs) {
      if (r.type === 'attributes') { if (r.attributeName.startsWith('data-gz-') || mine(r.target)) note(r.target.getAttribute(r.attributeName)); continue; }
      if (r.type === 'characterData') { if (mine(r.target.parentElement)) note(r.target.data); continue; }
      for (const n of r.addedNodes) if (n.nodeType === 3 ? mine(n.parentElement) : mine(n)) note(n.textContent);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-gz-due', 'data-gz-chip', 'data-gz-pct', 'data-gz-countdown', 'aria-label', 'title'] });
};
// Share of a JPEG frame's pixels that are light, measured in a page of its own.
const lightShare = async (page, jpegs) => page.evaluate(async (list) => {
  const c = new OffscreenCanvas(1, 1), ctx = c.getContext('2d', { willReadFrequently: true });
  const out = [];
  for (const b64 of list) {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' }));
    c.width = bmp.width; c.height = bmp.height; ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let light = 0;
    for (let i = 0; i < d.length; i += 4) if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 190) light++;
    out.push(light / (d.length / 4));
  }
  return out;
}, jpegs);
// Glaze's words seen in English on a page served in another language (?glaze_lang=): text containing a stretch of
// English from a key that language translates differently. Its catalogue arriving late would show here.
const english = (url, words) => {
  const lang = new URL(url, BASE).searchParams.get('glaze_lang');
  if (!lang) return null;
  const I = require('../lib/i18n.js');
  const cat = globalThis.GZ_LANGS[I.CODES.find((c) => c === lang || c.split('-')[0] === lang.split('-')[0])] || {};
  const bits = [];
  for (const [k, v] of Object.entries(cat)) {
    const longest = k.split(/\{[^}]*\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0];
    if (longest.length >= 8 && !Object.values(typeof v === 'object' ? v : { v }).some((x) => x.includes(longest))) bits.push(longest);
  }
  return words.filter((w) => bits.some((b) => w.s.includes(b)));
};
// One load of url in a fresh tab at 4x CPU throttling: from a dark blank page, or (next) from another Canvas page first.
const perfLoad = async (context, scratch, url, next) => {
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    await page.goto(next ? `${BASE}/grades` : 'data:text/html,<body style="background:%23000">');
    if (next) await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Performance.enable');
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const frames = [];
    cdp.on('Page.screencastFrame', (f) => { frames.push(f.data); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 50, maxWidth: 480, maxHeight: 300 });
    await page.waitForTimeout(300);
    const before = frames.length;
    const m0 = await metric();
    await page.goto(BASE + url, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const m1 = await metric();
    await cdp.send('Page.stopScreencast');
    const marks = await page.evaluate(() => ({ darkAt: window.__gzDarkAt ?? null, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null, words: window.__gzWords || [] }));
    const shares = await lightShare(scratch, frames.slice(before));
    // ponytail: ScriptDuration is the renderer's main-thread JS: Canvas's and Glaze's together; compare against Glaze off.
    return { url, next, script: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), task: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000),
      darkAt: marks.darkAt && Math.round(marks.darkAt), fcp: marks.fcp && Math.round(marks.fcp), frames: shares.length, light: shares.filter((x) => x > 0.3).length,
      lightest: +Math.max(0, ...shares).toFixed(2), words: marks.words, english: english(url, marks.words) };
  } finally { await page.close(); }
};

// fn over items, each tab taking the next one when it is free: Canvas serves tabs in parallel, and most of
// a page's time is waiting. Results come back in item order.
const eachTab = async (tabs, items, fn) => {
  const results = [];
  let next = 0;
  await Promise.all(tabs.map(async (tab) => { while (next < items.length) { const i = next++; results[i] = await fn(tab, items[i]); } }));
  return results;
};

(async () => {
  const { evalJs, wait, size, positionals, full, courseMenu, out, looks, user, html, audit, perf, sync } = parse();
  fs.mkdirSync(out, { recursive: true });
  if (html) fs.mkdirSync(html, { recursive: true });
  console.log(`Screenshots go to ${out}`);
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-canvas-')));
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  process.on('SIGINT', () => process.exit(130));
  const ext = path.join(tmp, 'ext');
  devCopy(ext);

  const exe = process.env.CHROME || (fs.existsSync(CHROME) ? CHROME : null);
  const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    ...(exe ? { executablePath: exe } : { channel: 'chromium' }), headless: true, viewport: size, deviceScaleFactor: 1,
    colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
    // SwiftShader: WebGL for the animated backgrounds in headless mode.
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  let failed = 0;
  const audits = [], runs = [];
  try {
    await context.addInitScript(watchLinks);
    if (perf) await context.addInitScript(watchDark);
    const first = context.pages()[0] || await context.newPage();
    // ?glaze_view=: the dashboard draws the view named in its ENV, so the page is served with that one in
    // place of the saved preference. ?glaze_lang=: the page is served as <html lang> that language, which is what
    // Glaze reads (Canvas's own words stay as they are). Nothing is written to Canvas.
    await context.route((u) => u.searchParams.has('glaze_view') || u.searchParams.has('glaze_lang'), async (route) => {
      const u = new URL(route.request().url());
      const view = u.searchParams.get('glaze_view'), lang = u.searchParams.get('glaze_lang');
      u.searchParams.delete('glaze_view');
      u.searchParams.delete('glaze_lang');
      const res = await route.fetch({ url: u.href });
      let body = await res.text();
      if (view) body = body.replace(/"dashboard_view":"\w+"/, `"dashboard_view":"${view}"`);
      if (lang) body = body.replace(/(<html[^>]*\slang=")[^"]*"/, `$1${lang.replace(/[^\w-]/g, '')}"`);
      route.fulfill({ response: res, body });
    });
    await login(first, user);
    const tabs = [watch(first)];
    while (tabs.length < TABS) tabs.push(watch(await context.newPage()));
    const found = await lookup(context);
    const pages = (positionals.length ? positionals.map((p) => { const [, name, url, click] = p.match(PAGE); return [name || slug(url) || 'dashboard', url, click]; }) : await defaultPages(found))
      .map(([name, p, click]) => [name, fill(p, found.ids), click]);
    const base = `chrome-extension://${extensionId(ext)}`;

    for (const { label, settings } of looks) {
      // Saved settings are the real extension storage; the content script reads them as the page starts.
      await first.goto(`${base}/options.html`).catch((e) => die(`Glaze did not load from ${ext}: ${e.message}`));
      const more = JSON.parse(fill(JSON.stringify(sync).replace(/\{origin\}/g, BASE), found.ids));
      await first.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); }, { ...settings, ...more });
      console.log(`\n${label}: ${settings.enabled ? `preset ${settings.preset ?? 'custom'}, bg ${settings.bg.kind}` : 'Glaze off'}`);
      if (perf) {
        for (const [name, url] of pages) for (const next of [false, true]) for (let i = 0; i < perf; i++) {
          const r = { look: label, page: name, ...(await perfLoad(context, first, url, next)) };
          runs.push(r);
          const said = r.english && `  words ${r.words.length} (first at ${r.words[0]?.at ?? '-'} ms), in English ${r.english.length}${r.english.length ? `: ${r.english.slice(0, 3).map((w) => `"${w.s}" at ${w.at}`).join(', ')}` : ''}`;
          console.log(`  ${url} ${next ? 'next ' : 'first'}  dark at ${r.darkAt ?? '-'} ms  fcp ${r.fcp} ms  script ${r.script} ms  task ${r.task} ms  light frames ${r.light}/${r.frames} (lightest ${r.lightest})${said || ''}`);
        }
        continue;
      }
      const results = await eachTab(tabs, pages, (tab, p) => shoot(tab, { label, settings, out, size, full, courseMenu, html, audit, evalJs, wait }, p));
      for (const r of results) console.log(r.line);
      audits.push(...results.map((r) => r.audit).filter(Boolean));
      failed += results.filter((r) => !r.ok).length;
    }
    if (perf) {
      fs.writeFileSync(path.join(out, 'perf.json'), JSON.stringify(runs, null, 1));
      return;
    }
    console.log(`\n${looks.length * pages.length - failed} screenshots${failed ? `, ${failed} failed` : ''}`);
    if (audit) fs.writeFileSync(path.join(out, 'audit.json'), JSON.stringify(audits, null, 1));
  } finally {
    await context.close();
  }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
