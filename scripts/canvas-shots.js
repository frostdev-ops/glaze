// Screenshot pages of the local Canvas LMS (fake data, http://localhost:3000) with Glaze running, under
// chosen Glaze settings, to check a Canvas stylesheet by eye. Loads a throwaway copy of this checkout's
// extension (its manifest widened to http://localhost/*; the real one is untouched) into a fresh Chromium
// profile and logs in as the student from ~/Projects/canvas-lms/glaze/credentials.env. Only GETs pages.
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
//   --width, --height  viewport, 1440x900 by default;  --full  captures the whole page
//   path ...           pages to shoot instead of the default set (dashboard, calendar, inbox, grades and
//                      BIO 1100's course pages); {bio} {eng} {math} {hist} stand for course ids
//   CHROME=/path/to/chrome runs that browser instead of Chrome for Testing.
//
//   node scripts/canvas-shots.js
//   node scripts/canvas-shots.js --look Paper --look Midnight /courses/{bio}/modules /grades
//   node scripts/canvas-shots.js --settings '{enabled:false}' --full /courses/{eng}
const { chromium } = require('playwright');
const { parseArgs } = require('util');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require('../defaults.js');

const root = path.join(__dirname, '..');
const BASE = 'http://localhost:3000';
const CREDS = path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const CHROME = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const COURSES = { bio: 'BIO 1100', eng: 'ENG 1100', math: 'MATH 1350', hist: 'HIST 2010' };
// Pages loaded at once.
const TABS = 4;
// Top-level entries that aren't the extension (or are too big to copy for every run).
const NOT_EXTENSION = new Set(['assets', 'safari', 'scripts', 'store', 'test', 'dist', 'release', 'node_modules']);
const DOCS = /\.(md|sh)$|^LICENSE$/;

const die = (msg) => { console.error(msg); process.exit(1); };
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const slug = (s) => s.replace(/[{}]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase();

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
      width: { type: 'string', default: '1440' }, height: { type: 'string', default: '900' }, full: { type: 'boolean' }, 'course-menu': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } });
  } catch (e) { die(`${e.message}\nSee --help.`); }
  const { values: opt, positionals } = parsed;
  if (opt.help) { console.log(fs.readFileSync(__filename, 'utf8').split(/\n(?!\/\/)/)[0].replace(/^\/\/ ?/gm, '')); process.exit(0); }
  const size = { width: +opt.width, height: +opt.height };
  if (!(size.width > 0 && size.height > 0)) die('--width and --height must be positive numbers.');
  if (positionals.some((p) => !p.startsWith('/'))) die('Pages are paths on Canvas, like /grades or /courses/{bio}/modules.');
  let user = {};
  // A JS object literal or JSON, so {enabled:false} works without quoting its keys.
  try { if (opt.settings) user = new Function(`return (${opt.settings})`)(); } catch (e) { die(`--settings: ${e.message}`); }
  if (!plain(user)) die('--settings must be an object.');
  const names = opt.look?.length ? opt.look : opt.settings ? [null] : ['Frost', 'Paper'];
  const looks = names.map((name) => ({ label: slug(name || 'custom'), settings: settingsFor(name, user) }));
  const out = opt.out ? path.resolve(opt.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-canvas-shots-'));
  return { size, positionals, full: !!opt.full, courseMenu: !!opt['course-menu'], out, looks };
};

// The extension as it is in the working copy, with localhost added to where it runs and what it exposes.
const devCopy = (dest) => {
  fs.mkdirSync(dest);
  for (const f of fs.readdirSync(root)) {
    if (f !== 'manifest.json' && !f.startsWith('.') && !NOT_EXTENSION.has(f) && !DOCS.test(f)) fs.cpSync(path.join(root, f), path.join(dest, f), { recursive: true });
  }
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const e of [...(m.content_scripts || []), ...(m.web_accessible_resources || [])]) e.matches.push('http://localhost/*');
  fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(m, null, 2));
};

// Chromium names an unpacked extension after its folder: the path's SHA-256, hex digits mapped to a-p.
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

const login = async (page) => {
  const cred = Object.fromEntries(fs.readFileSync(CREDS, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => l.split(/=(.*)/s).slice(0, 2).map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2'))));
  // No error text from here on: Playwright's call log can quote what was typed.
  try {
    await page.goto(`${BASE}/login/canvas`);
    await page.fill('input[name="pseudonym_session[unique_id]"]', cred.STUDENT_EMAIL);
    await page.fill('input[name="pseudonym_session[password]"]', cred.PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }), page.press('input[name="pseudonym_session[password]"]', 'Enter')]);
  } catch { die(`Canvas login failed (is ${BASE} up, and STUDENT_EMAIL / PASSWORD right in ${CREDS}?)`); }
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
});
// Page reveal: Glaze holds a page back (data-gz-loading) and lets it in (data-gz-reveal) once it is built.
const revealed = () => !document.querySelector('[data-gz-loading], [data-gz-reveal]');

// How tall the window must be to show the whole page. Canvas scrolls most course pages inside a container,
// not the document, so fullPage alone would stop at the window.
const fitHeight = () => Math.ceil(Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('*')]
  .filter((e) => e.clientHeight > 300 && e.scrollHeight > e.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(e).overflowY))
  .map((e) => e.scrollHeight + e.getBoundingClientRect().top)));
const capture = async (page, file, { full, size }) => {
  if (!full) return page.screenshot({ path: file });
  // ponytail: Chromium stops drawing around 16k px; a page taller than that is cut off there.
  await page.setViewportSize({ width: size.width, height: Math.min(16000, Math.max(size.height, await page.evaluate(fitHeight))) });
  await page.waitForTimeout(200);
  try { await page.screenshot({ path: file }); } finally { await page.setViewportSize(size); }
};

// A tab, and the page errors and console errors it has seen since they were last cleared.
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.location().url.startsWith('chrome-extension://') ? 'ext: ' : ''}${m.text().split('\n')[0]}`));
  return { page, errors };
};

// Load a page, let it settle, save the screenshot; gives its diagnostics line.
const shoot = async ({ page, errors }, { label, settings, out, courseMenu, ...view }, [name, url]) => {
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
    if (courseMenu && here.pathname === '/') {
      await page.locator('.gz-cm-btn').nth(1).click();
      await page.locator('.gz-cm-tint input').check();
      await page.waitForTimeout(300);
      // Store capture only: replace a QA label in the fake seed without writing to Canvas.
      for (const label of await page.getByText('zz T22 unread and what-if proof', { exact: true }).all()) {
        await label.evaluate((e) => { e.textContent = 'Lab report 1: Cells and membranes'; });
      }
    }
    const p = await page.evaluate(probe);
    await capture(page, path.join(out, `${label}-${name}.png`), view);
    const errs = [...new Set(errors)];
    return { ok: true, line: `  ${url}  "${p.title}"  glaze-css=${p.css}  data-gz=${p.attrs}  errors=${errs.length ? `${errs.length}: ${errs.slice(0, 2).map((e) => e.slice(0, 100)).join(' | ')}` : 0}${note}` };
  } catch (e) { return { ok: false, line: `  ${url}  FAILED: ${e.message.split('\n')[0]}` }; }
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
  const { size, positionals, full, courseMenu, out, looks } = parse();
  fs.mkdirSync(out, { recursive: true });
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
  try {
    await context.addInitScript(watchLinks);
    const first = context.pages()[0] || await context.newPage();
    await login(first);
    const tabs = [watch(first)];
    while (tabs.length < TABS) tabs.push(watch(await context.newPage()));
    const found = await lookup(context);
    const pages = (positionals.length ? positionals.map((p) => [slug(p) || 'dashboard', p]) : await defaultPages(found))
      .map(([name, p]) => [name, fill(p, found.ids)]);
    const base = `chrome-extension://${extensionId(ext)}`;

    for (const { label, settings } of looks) {
      // Saved settings are the real extension storage; the content script reads them as the page starts.
      await first.goto(`${base}/options.html`).catch((e) => die(`Glaze did not load from ${ext}: ${e.message}`));
      await first.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); }, settings);
      console.log(`\n${label}: ${settings.enabled ? `preset ${settings.preset ?? 'custom'}, bg ${settings.bg.kind}` : 'Glaze off'}`);
      const results = await eachTab(tabs, pages, (tab, p) => shoot(tab, { label, settings, out, size, full, courseMenu }, p));
      for (const r of results) console.log(r.line);
      failed += results.filter((r) => !r.ok).length;
    }
    console.log(`\n${looks.length * pages.length - failed} screenshots${failed ? `, ${failed} failed` : ''}`);
  } finally {
    await context.close();
  }
  if (failed) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
