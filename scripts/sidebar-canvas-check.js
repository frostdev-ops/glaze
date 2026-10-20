// The sidebar on real Canvas at localhost:3000 (local test logins only): each kind of page at five widths, before (the
// sidebar off) and after, with Canvas's own controls still working, and a widget moved board → sidebar → floating → board
// with a reload after each move. Uses a temporary localhost-enabled extension and profile, removed on exit; never answers
// or submits a quiz, and only inspects an already started untimed attempt.
// Hold /private/tmp/claude-501/glaze-heavy.lock and run under nice (as for the full test suite).
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/sidebar-canvas-check.js [screenshots directory]
// SIDEBAR_LANG=de runs it in another language (the longest labels); SIDEBAR_REVIEW_ONLY=1 stops after the gestures,
// keyboard, footer and appearance checks.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const G = require('../defaults.js');
const I = require('../lib/i18n.js');
for (const lang of I.CODES) require(`../i18n/${lang}.js`);
const W = require('../lib/widgets.js');
const src = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-sidebar-canvas-evidence'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const local = 'http://localhost:3000';
const credentialsFile = process.env.CANVAS_CREDENTIALS || path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const LANG = process.env.SIDEBAR_LANG || 'en-US';
const settings = (sidebar, navbar = false, more = {}) => G.GZ_SANITIZE({ enabled: true, navbar: { on: navbar }, motion: { level: 'off' }, ...more,
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), sidebar, todo: true, widgets: true, notes: true } });
const WIDTHS = [1600, 1280, 1024, 768, 390];
let checks = 0, ctx, opts, page, tmp, ext;
const errors = [], failures = [];
const ok = (v, label) => { if (!v) throw Error(label); console.log(`ok   ${label}`); checks++; };
// A layout probe that fails is listed and the run goes on, so one bad width doesn't hide the others.
const probe = (v, label) => { if (v) ok(v, label); else { failures.push(label); console.error(`FAIL ${label}`); } };
const wait = async (read, accepts, label) => { let v; const end = Date.now() + 15000; do { v = await read(); if (accepts(v)) return v; await page.waitForTimeout(100); } while (Date.now() < end); throw Error(`${label} (last: ${JSON.stringify(v)})`); };
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const headerOk = async (root, label) => {
  const g = await root.evaluate(() => {
    const h = document.querySelector('.gz-sb-head'), r = h?.getBoundingClientRect();
    const controls = h ? [...h.querySelectorAll('button')].filter((e) => e.getClientRects().length) : [];
    return { shown: !!r?.height, top: r?.top, bottom: r?.bottom, viewport: innerHeight, controls: controls.length,
      covered: controls.map((e) => {
        const b = e.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return e.contains(hit) ? null : { control: e.className, top: b.top, hit: hit && `${hit.tagName}.${hit.className}` };
      }).filter(Boolean) };
  });
  const pass = g.shown && g.top >= 0 && g.bottom <= g.viewport && g.controls > 0 && !g.covered.length;
  probe(pass, `${label}: sidebar heading and controls stay visible and receive pointer input`);
  if (!pass) { console.error(JSON.stringify(g)); await shot(`header-failure-${label.replace(/[^a-z0-9]+/gi, '-')}`); }
};

// What the page looks like now: the mode, the column, overflow, To Do lists shown, widgets outside the column.
const state = () => page.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const host = document.querySelector('[data-gz-sidebar-host]'), r = host?.getBoundingClientRect();
  const todos = [...document.querySelectorAll('#gz-todo, #right-side .Sidebar__TodoListContainer, #right-side ul.to-do-list')].filter(vis);
  const tiles = [...document.querySelectorAll('.gz-sb-dock > .gz-w')];
  const page = document.getElementById('right-side');
  return {
    mode: document.documentElement.dataset.gzSidebar || null, open: document.documentElement.hasAttribute('data-gz-sidebar-open'),
    host: host ? { id: host.id, kind: host.dataset.gzSidebarHost, w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), shown: vis(host) } : null,
    overflow: document.documentElement.scrollWidth - innerWidth, vw: innerWidth,
    todos: todos.length,
    // A reserved column shows something: the page's own content or a docked widget.
    filled: !!host && ((vis(page) && page.innerText.trim().length > 0) || tiles.some(vis)),
    stranded: tiles.filter(vis).some((t) => { const b = t.getBoundingClientRect(); return b.left < r.left - 1 || b.right > r.right + 1; }),
    content: (() => { const c = document.getElementById('content')?.getBoundingClientRect(); return c ? Math.round(c.width) : null; })(),
  };
});
const layoutOk = async (name, width) => {
  const s = await state();
  probe(s.overflow <= 1, `${name} ${width}: no horizontal overflow (${s.overflow}px)`);
  probe(['expanded', 'collapsed', 'drawer', 'none'].includes(s.mode), `${name} ${width}: a mode (${s.mode})`);
  if (s.mode === 'expanded') {
    probe(s.host?.shown && s.filled, `${name} ${width}: the reserved column is not blank`);
    probe(Math.abs(s.host.right - s.vw) <= 20, `${name} ${width}: the column at the window's right edge (${s.host.right}/${s.vw})`);
    probe(!s.stranded, `${name} ${width}: no widget outside the column`);
  }
  if (s.mode === 'expanded' || s.mode === 'collapsed') await headerOk(page, `${name} ${width}`);
  if (s.mode === 'drawer') probe(!s.host?.shown, `${name} ${width}: the drawer starts closed`);
  probe(s.todos <= 1, `${name} ${width}: one To Do list at most (${s.todos})`);
  return s;
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-canvas-run-'))); ext = path.join(tmp, 'extension'); fs.mkdirSync(ext);
  try {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) if (/\.(js|css|html)$/.test(e.name) || ['lib', 'features', 'i18n', '_locales', 'assets', 'fonts', 'icons', 'mods', 'sharing'].includes(e.name)) fs.cpSync(path.join(src, e.name), path.join(ext, e.name), { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json')));
    m.host_permissions.push('http://localhost/*');
    m.content_scripts.find((s) => s.matches.includes('https://*.instructure.com/*')).matches.push('http://localhost/*');
    for (const w of m.web_accessible_resources) w.matches.push('http://localhost/*');
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { executablePath: CHROME, headless: true, viewport: { width: 1600, height: 1000 }, locale: LANG, reducedMotion: 'reduce', args: [`--lang=${LANG}`, `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    opts = await ctx.newPage(); await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); page.setDefaultNavigationTimeout(30000);
    const store = async (s, l) => { await opts.evaluate(async ([s, l]) => { await chrome.storage.sync.set(s); if (l) { await chrome.storage.local.clear(); await chrome.storage.local.set(l); } }, [s, l]); await page.waitForTimeout(250); };
    const localGet = (k) => opts.evaluate((k) => chrome.storage.local.get(k), k);
    const credentials = Object.fromEntries(fs.readFileSync(credentialsFile, 'utf8').split(/\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
    console.log('local login: student');
    await page.goto(local + '/login/canvas');
    await page.locator('#pseudonym_session_unique_id').fill(credentials.STUDENT_EMAIL);
    await page.locator('#pseudonym_session_password').fill(credentials.STUDENT_PASSWORD || credentials.PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
    const api = (p) => page.evaluate((p) => fetch(p, { headers: { accept: 'application/json' } }).then((r) => r.text()).then((t) => JSON.parse(t.replace(/^while\(1\);/, ''))), p);
    const me = await api('/api/v1/users/self/profile');
    const courses = await api('/api/v1/courses');
    const calc = courses.find((c) => /Calculus/.test(c.name)) || courses[0];
    const hist = courses.find((c) => /History/.test(c.name)) || courses.at(-1);
    const asg = (await api(`/api/v1/courses/${calc.id}/assignments`))[0];
    const quizzes = await api(`/api/v1/courses/${hist.id}/quizzes`);
    const subs = await Promise.all(quizzes.map((q) => api(`/api/v1/courses/${hist.id}/quizzes/${q.id}/submissions`).then((r) => r.quiz_submissions || []).catch(() => [])));
    // Inspect only an existing untimed attempt; never start, answer or submit a quiz.
    const take = quizzes.find((q, i) => q.id === 49 && !q.time_limit && subs[i].some((s) => s.workflow_state === 'untaken'));
    const done = quizzes.find((q, i) => subs[i].some((s) => s.workflow_state === 'complete'));
    let topic = null;
    for (const c of courses) { const list = await api(`/api/v1/courses/${c.id}/discussion_topics`).catch(() => []); const d = Array.isArray(list) && list.find((x) => !x.is_announcement); if (d) { topic = { ...d, course: c.id }; break; } }
    const PAGES = [
      ['dashboard', '/'], ['course-home', `/courses/${calc.id}`], ['assignment', `/courses/${calc.id}/assignments/${asg.id}`],
      ['submission', `/courses/${calc.id}/assignments/${asg.id}/submissions/${me.id}`], ...(topic ? [['discussion', `/courses/${topic.course}/discussion_topics/${topic.id}`]] : []),
      ['grades', `/courses/${calc.id}/grades`], ['calendar', '/calendar'], ['syllabus', `/courses/${calc.id}/assignments/syllabus`],
      ['modules', `/courses/${calc.id}/modules`], ...(done ? [['quiz-results', `/courses/${hist.id}/quizzes/${done.id}`]] : []),
    ];
    const lay = { ...W.layout({ tiles: W.TILES.map((id) => ({ id, on: id === 'notes', size: 'l' })) }), filled: ['cdash'] };
    lay.boards.cdash = lay.boards.cdash.map((x) => ({ ...x, on: x.id === 'notes' || x.id === 'todo' }));

    // Discussions and assignments, each with its family; then both styles (Floating, Embedded) under a dark and a light
    // Look on the Dashboard, a course's home, a discussion and an assignment: the column a card off the edges or flush
    // with a hairline, Canvas's own blocks inner panels (never its square ground box), the content clear of it.
    // SIDEBAR_FIXTURES=<dir> also saves the discussion and submission pages (sidebar off, scripts out) as test fixtures.
    const FAMILY = { submission: 'assignment', discussion: 'discussion', assignment: 'assignment' };
    for (const [name, where] of process.env.SIDEBAR_SCROLL_ONLY ? [] : PAGES.filter(([n]) => FAMILY[n])) {
      if (process.env.SIDEBAR_FIXTURES && name !== 'assignment') {
        await store(settings(false), { widgetLayout: lay });
        await page.goto(local + where); await page.waitForLoadState('networkidle').catch(() => {});
        const body = await page.evaluate(() => { const b = document.body.cloneNode(true); for (const e of b.querySelectorAll('script, style, link, noscript, svg')) e.remove(); return `<!doctype html><html><body class="${document.body.className}">${b.innerHTML}</body></html>`; });
        fs.writeFileSync(path.join(process.env.SIDEBAR_FIXTURES, `canvas-${name === 'discussion' ? 'discussion-topic' : name}.html`), body);
      }
      await store(settings(true), { widgetLayout: lay });
      await page.goto(local + where); await page.waitForSelector('[data-gz-sidebar-host]');
      const fam = await page.evaluate(() => document.documentElement.dataset.gzSbFamily);
      ok(fam === FAMILY[name], `${name}: the ${FAMILY[name]} family (${fam})`);
      await layoutOk(name, 1600);
    }
    const STYLE_PAGES = [['dashboard', '/'], ['course-home', `/courses/${calc.id}`], ...PAGES.filter(([n]) => n === 'discussion' || n === 'assignment')];
    for (const style of process.env.SIDEBAR_SCROLL_ONLY ? [] : ['float', 'embed']) for (const [preset, dark] of [['Frost', true], ['Paper', false]]) for (const surface of ['glass', 'solid']) {
      await store(settings(true, false, { preset, colors: G.GZ_PRESETS.find(([n]) => n === preset)[1], sidebar: { style, surface } }), { widgetLayout: lay });
      for (const [name, where] of STYLE_PAGES) {
        await page.goto(local + where); await page.waitForSelector('[data-gz-sidebar-host]');
        await page.waitForTimeout(400);
        const g = await page.evaluate(() => {
          const h = document.querySelector('[data-gz-sidebar-host]'), cs = getComputedStyle(h), r = h.getBoundingClientRect();
          const rs = h.querySelector(':scope > #right-side'), rcs = rs && getComputedStyle(rs);
          const blocks = rs ? [...rs.children].filter((e) => e.getClientRects().length && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius)) : [];
          const c = document.getElementById('content')?.getBoundingClientRect();
          return { mode: document.documentElement.dataset.gzSidebar, style: document.documentElement.dataset.gzSbStyle, radius: parseFloat(cs.borderTopLeftRadius), right: innerWidth - r.right, bg: cs.backgroundImage + cs.backgroundColor,
            filter: cs.backdropFilter, border: parseFloat(cs.borderInlineStartWidth), shadow: cs.boxShadow, rsBg: rcs?.backgroundColor, rsRadius: rcs && parseFloat(rcs.borderTopLeftRadius), blocks, clear: !c || c.right <= r.left - 15 };
        });
        const tag = `${name} ${style} ${surface} ${dark ? 'dark' : 'light'}`;
        probe(g.style === style, `${tag}: data-gz-sb-style`);
        if (g.mode === 'expanded') {
          probe(style === 'float' ? g.radius > 0 && g.right >= 10 : g.radius === 0 && g.right <= 1, `${tag}: ${style === 'float' ? 'a card off the edge' : 'flush with the edge'} (radius ${g.radius}, right ${g.right})`);
          probe(!/rgba\(0, 0, 0, 0\)$/.test(g.bg) || /gradient|color-mix|rgb/.test(g.bg), `${tag}: the column has a surface`);
          probe(surface === 'solid' ? g.filter === 'none' : g.filter.includes('blur'), `${tag}: the chosen surface filter`);
          probe(g.border > 0 && (style === 'float' ? g.shadow !== 'none' : g.shadow === 'none'), `${tag}: border and shadow match the style`);
          if (g.rsBg !== undefined) probe(g.rsBg === 'rgba(0, 0, 0, 0)', `${tag}: Canvas's #right-side is see-through, not its ground box (${g.rsBg})`);
          probe(g.blocks.every((x) => x > 0), `${tag}: Canvas's blocks are rounded inner panels (${g.blocks.join(',')})`);
          probe(g.clear, `${tag}: the content keeps clear of the column`);
        }
        await shot(`p6-canvas-${name}-${style}-${surface}-${dark ? 'dark' : 'light'}`);
      }
    }
    if (process.env.SIDEBAR_STYLES_ONLY) { console.log(JSON.stringify({ checks, failures: failures.length, errors })); process.exitCode = failures.length ? 1 : 0; return; }
    // Wheel the real LMS scroller (Canvas course pages use DrawerLayout, not scrollY) and the dock independently.
    // Short pages get a temporary tail in their existing content flow; the LMS's layout and overflow rules stay intact.
    const wheelScroll = async (root, label) => {
      const behind = root === page ? null : await page.evaluate(() => [scrollY, document.getElementById('drawer-layout-content')?.scrollTop || 0]);
      await root.waitForSelector('[data-gz-sidebar-host]', { state: 'attached' });
      // Canvas can mount its app drawer after the sidebar is ready, changing which element owns the page scroll.
      await root.waitForLoadState('networkidle');
      await root.waitForFunction(() => document.documentElement.dataset.gzSidebar && !document.documentElement.hasAttribute('data-gz-ctab-framed') && !document.documentElement.hasAttribute('data-gz-placing'));
      if (/\/discussion_topics\/\d+/.test(new URL(root.url()).pathname)) await root.waitForSelector('#discussion-drawer-layout [data-testid="discussion-topic-container"]');
      await root.evaluate(() => {
        const content = document.getElementById('content');
        const discussion = document.getElementById('discussion-drawer-layout');
        let main = discussion || content;
        while (main && main !== document.body && !/^(auto|scroll|overlay)$/.test(getComputedStyle(main).overflowY)) main = main.parentElement;
        if (!main || main === document.body) main = document.scrollingElement;
        const host = document.querySelector('[data-gz-sidebar-host]');
        const tail = document.createElement('div'); tail.id = 'sidebar-check-tail';
        if (main.scrollHeight < main.clientHeight + 200) { tail.style.height = `${innerHeight * 2}px`; (discussion?.querySelector('#module_sequence_footer_container') || content).append(tail); }
        globalThis.__gzSbScrollCheck = { main, host, tail, content, discussion };
        main.scrollTop = 0; host.scrollTop = 0;
      });
      try {
        await root.waitForFunction(() => { const { main } = __gzSbScrollCheck; return main.scrollHeight > main.clientHeight + 200 && main.scrollTop === 0; });
        const offset = root === page ? { x: 0, y: 0 } : await (await root.frameElement()).boundingBox();
        const wheel = async (side, delta, down) => {
          const point = await root.evaluate((side) => {
            const { main, host, content, discussion } = __gzSbScrollCheck, r = (side ? host : discussion || content).getBoundingClientRect();
            // The discussion's gutter stays outside its RCE iframe and reply controls.
            const x = side ? r.right - 20 : discussion ? r.left + 12 : Math.max(20, Math.min(r.left + r.width / 2, innerWidth - 20));
            const y = side ? r.top + r.height / 2 : Math.min(innerHeight - 120, Math.max(140, r.top + 60));
            const sc = side ? host : main;
            return { x, y, before: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, hit: (side ? host : content).contains(document.elementFromPoint(x, y)) };
          }, side);
          ok(point.hit, `${label}: ${side ? 'sidebar' : 'main'} receives pointer input`);
          await page.mouse.move(offset.x + point.x, offset.y + point.y); await page.mouse.wheel(0, delta);
          const target = Math.max(0, Math.min(point.max, point.before + delta));
          await root.waitForFunction(({ side, before, delta }) => {
            const sc = __gzSbScrollCheck[side ? 'host' : 'main'];
            // Native sidebar blocks can finish loading during the gesture and extend its scroll range.
            return Math.abs(sc.scrollTop - Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, before + delta))) <= 1;
          }, { side, before: point.before, delta }, { timeout: 10000 });
          if (target === point.before) await page.waitForTimeout(100);
          ok(true, `${label}: ${side ? 'sidebar' : 'main'} wheels ${down ? 'down' : 'up'}`);
        };
        await wheel(false, 400, true); await wheel(false, -400, false);
        ok(await root.evaluate(() => __gzSbScrollCheck.host.scrollTop === 0), `${label}: main wheels leave the sidebar in place`);
        const drawer = await root.locator('html').getAttribute('data-gz-sidebar') === 'drawer';
        if (drawer) await root.locator('#gz-sb-launch').click();
        await root.waitForFunction(() => { const { host } = __gzSbScrollCheck; return host.getClientRects().length && host.scrollHeight > host.clientHeight + 200; });
        await headerOk(root, `${label}, before scrolling`);
        await wheel(true, 400, true); await wheel(true, -400, false);
        ok(await root.evaluate(() => __gzSbScrollCheck.main.scrollTop <= 1), `${label}: sidebar wheels leave the main content in place`);
        // Exhaust both scrollers, then wheel again: a middle-of-page gesture cannot expose scroll chaining.
        await wheel(true, 100000, true); await wheel(true, 400, true); await wheel(true, -100000, false);
        await headerOk(root, `${label}, after scrolling`);
        if (drawer) { await page.keyboard.press('Escape'); await root.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-sidebar-open')); }
        const discussion = await root.evaluate(() => !!__gzSbScrollCheck.discussion);
        const outside = discussion && await root.evaluate(() => [scrollY, document.getElementById('drawer-layout-content').scrollTop]);
        await wheel(false, 100000, true); await wheel(false, 400, true); await wheel(false, -100000, false);
        if (discussion) {
          ok(JSON.stringify(outside) === JSON.stringify(await root.evaluate(() => [scrollY, document.getElementById('drawer-layout-content').scrollTop])), `${label}: discussion boundaries leave the outer document and drawer in place`);
          // Open the existing reply form and inspect/focus its empty RCE. Never type, post, or submit.
          await root.locator('[data-testid="discussion-topic-reply"]').click();
          await root.waitForFunction(() => document.querySelector('iframe.tox-edit-area__iframe')?.contentDocument?.body?.isContentEditable);
          ok(await root.locator('iframe.tox-edit-area__iframe').evaluate((e) => {
            __gzSbScrollCheck.editor = e; e.contentDocument.body.focus({ preventScroll: true });
            return document.activeElement === e && e.contentDocument.activeElement === e.contentDocument.body;
          }), `${label}: the native reply editor accepts focus`);
          await wheel(false, 400, true); await wheel(false, -400, false);
          ok(await root.evaluate(() => { const e = __gzSbScrollCheck.editor; return e.isConnected && e === document.querySelector('iframe.tox-edit-area__iframe') && e.contentDocument.body.isContentEditable; }), `${label}: discussion scrolling preserves the native RCE iframe`);
        }
        if (behind) ok(JSON.stringify(behind) === JSON.stringify(await page.evaluate(() => [scrollY, document.getElementById('drawer-layout-content')?.scrollTop || 0])), `${label}: wheels never chain to the covered document`);
      } finally {
        await root.evaluate(() => { __gzSbScrollCheck.tail.remove(); delete globalThis.__gzSbScrollCheck; });
      }
    };
    const scrollPages = [...PAGES, ...(take ? [['quiz-take', `/courses/${hist.id}/quizzes/${take.id}/take`]] : [])];
    const wheelStart = checks;
    const recordKey = `sidebar:canvas:${local}/${me.id}`;
    for (const tabs of [false, true]) {
      const s = settings(true, true); s.enhance.tabs = tabs; s.navbar.tabs = false;
      await store(s, { widgetLayout: lay, [recordKey]: { v: 1, rev: 1, mig: 1, open: true, width: 352,
        dock: [{ id: 'todo' }, { id: 'notes', h: 1800 }], dest: { todo: 'dock', notes: 'dock' } } });
      for (const [name, at] of scrollPages.filter(([n]) => !process.env.SIDEBAR_SCROLL_PAGES || process.env.SIDEBAR_SCROLL_PAGES.split(',').includes(n))) for (const width of [1440, 1024, 768, 390].filter((w) => !process.env.SIDEBAR_SCROLL_WIDTHS || process.env.SIDEBAR_SCROLL_WIDTHS.split(',').includes(String(w)))) {
        console.log(`wheel ${name} ${width} ${tabs ? 'course tabs' : 'direct'}`);
        // Each viewport starts without a prior page's scroll gesture or same-URL history restoration.
        await page.close(); page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); page.setDefaultNavigationTimeout(30000);
        await page.setViewportSize({ width, height: 900 });
        let root = page;
        if (tabs) {
          // A real owned frame, reached through the same link interception as native LMS navigation.
          const other = courses.find((c) => String(c.id) !== at.match(/^\/courses\/(\d+)/)?.[1]);
          await page.goto(`${local}/courses/${other.id}`);
          await page.waitForSelector('#gz-ctabs', { state: 'attached' });
          await page.waitForFunction(() => document.querySelector('#gz-ctabs .gz-ctab'));
          // Canvas can mount its app after the in-flow footer. Reproduce that ordering without a timing race.
          const earlyFooter = name === 'course-home' && width === 1440;
          if (earlyFooter) { await page.waitForSelector('#gz-footer'); await page.locator('#gz-footer').evaluate((e) => document.body.prepend(e)); }
          await page.locator('#content').evaluate((e, at) => { const a = document.createElement('a'); a.id = 'sidebar-check-link'; a.href = at; a.textContent = 'Open'; e.prepend(a); }, at);
          await page.locator('#sidebar-check-link').click();
          const cid = at.match(/^\/courses\/(\d+)/)?.[1] || 'page';
          await page.waitForSelector(`#gz-ctabs-frames[data-on] > iframe[name="gz-ctab:${cid}"]:not([inert])`);
          root = page.frame({ name: `gz-ctab:${cid}` });
          if (earlyFooter) {
            ok(await page.locator('#gz-ctabs-frames').evaluate((e) => Math.abs(e.clientHeight - (innerHeight - document.getElementById('gz-footer').getBoundingClientRect().height)) <= 1), 'a footer before the Canvas app cannot collapse the course frame');
            await page.locator('#gz-footer').evaluate((e) => document.body.append(e));
          }
        } else await page.goto(local + at);
        await wheelScroll(root, `${name} ${width} ${tabs ? 'course tabs' : 'direct'}`);
        if (tabs && name === 'discussion' && width === 1440) {
          const cid = new URL(page.url()).pathname.match(/^\/courses\/(\d+)/)[1];
          await root.locator(`#gz-ctabs .gz-ctab[data-course-id="${cid}"] .gz-ctab-name`).click();
          await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-ctab-framed'));
          ok(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY !== 'hidden' && getComputedStyle(document.getElementById('drawer-layout-content')).overflowY === 'auto'), 'returning to the top course restores its native scrolling');
        }
        if (tabs && name === 'course-home' && width === 1440) await shot('scroll-course-home-fixed');
      }
    }
    console.log(`completed; ${checks - wheelStart} wheel checks`);
    if (process.env.SIDEBAR_SCROLL_ONLY) {
      console.log(JSON.stringify({ checks, failures: failures.length, errors }));
      if (failures.length || errors.length) process.exitCode = 1;
      return;
    }

    // Real pointer gestures, modal keyboard behavior, and appearance under alternate browser settings.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await store(settings(true), { widgetLayout: lay });
    await page.goto(local + '/'); await page.waitForSelector('.gz-sb-dock #gz-todo');
    const record = async () => (await localGet(recordKey))[recordKey];
    const dockRecord = { ...await record(), dock: [{ id: 'notes' }, { id: 'timer' }, { id: 'todo' }], dest: { notes: 'dock', timer: 'dock', todo: 'dock' } };
    await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, dockRecord]);
    await page.waitForSelector('.gz-sb-dock [data-tile="notes"]');
    const drag = async (sel, dx, dy) => {
      const el = page.locator(sel); await el.scrollIntoViewIfNeeded();
      const r = await el.boundingBox(), x = r.x + Math.min(4, r.width / 2), y = r.y + Math.min(20, r.height / 2);
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
    };
    const width0 = (await record()).width;
    await drag('.gz-sb-resize', -40, 0);
    await wait(record, (r) => r.width !== width0, 'pointer width saved');
    ok((await record()).width === width0 + 40, 'pointer width resize saves once released');
    await page.waitForFunction((w) => Math.round(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().width) === w, width0 + 40);
    const h0 = await page.locator('[data-tile="notes"] .gz-w-body').evaluate((e) => e.offsetHeight);
    await drag('[data-tile="notes"] .gz-w-vsize', 0, 48);
    await wait(record, (r) => r.dock.find((x) => x.id === 'notes').h != null, 'pointer height saved');
    ok((await record()).dock.find((x) => x.id === 'notes').h === h0 + 48, 'pointer dock height resize is kept');
    await page.locator('[data-tile="notes"] .gz-w-fold').click();
    await page.locator('[data-tile="timer"] .gz-w-fold').click();
    const handle = page.locator('[data-tile="notes"] .gz-w-handle');
    await handle.scrollIntoViewIfNeeded();
    const a = await handle.boundingBox(), b = await page.locator('.gz-sb-dock [data-tile="timer"]').boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, b.y + b.height - 2, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(400);
    probe((await record()).dock[0].id === 'timer', 'pointer dock reorder commits the new order');
    await page.reload(); await page.waitForSelector('.gz-sb-dock [data-tile="notes"]');
    probe((await record()).dock[0].id === 'timer' && (await record()).width === width0 + 40, 'pointer order, width and height survive reload');
    await page.locator('.gz-sb-toggle').click();
    await wait(state, (s) => s.mode === 'collapsed', 'collapsed mode');
    probe((await state()).host.w === 48 && !await page.locator('.gz-sb-dock').isVisible(), 'collapsed mode reserves only the header strip');
    await headerOk(page, 'collapsed desktop');
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.waitForSelector('#gz-sb-launch'); await page.click('#gz-sb-launch');
    probe(await page.locator('.gz-sb-toggle').evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'backdrop stays behind the drawer controls');
    // Discover the endpoints in the page so hidden/disabled native controls do not become trap endpoints.
    await page.locator('[data-gz-sidebar-host]').evaluate((e) => {
      const all = [...e.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((x) => x.tabIndex >= 0 && !x.disabled && !x.closest('[inert]') && x.getClientRects().length);
      all[0].dataset.sbFirst = ''; all.at(-1).dataset.sbLast = ''; all.at(-1).focus();
    });
    await page.keyboard.press('Tab');
    probe(await page.locator('[data-sb-first]').evaluate((e) => document.activeElement === e), 'Tab wraps from the last to the first drawer control');
    await page.keyboard.press('Shift+Tab');
    probe(await page.locator('[data-sb-last]').evaluate((e) => document.activeElement === e), 'Shift+Tab wraps back to the last drawer control');
    // Canvas reuses portal roots that already existed before opening the drawer.
    await page.evaluate(() => {
      const root = document.getElementById('nav-tray-portal') || document.getElementById('content-wrapper');
      const dialog = document.createElement('div'); dialog.id = 'sidebar-check-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      const btn = document.createElement('button'); btn.textContent = 'Close'; dialog.append(btn); root.append(dialog);
    });
    await page.waitForTimeout(150);
    probe(await page.locator('#sidebar-check-dialog button').evaluate((e) => { e.focus(); return !e.closest('[inert]') && document.activeElement === e; }), 'an LMS dialog in an existing portal remains reachable');
    await page.locator('#sidebar-check-dialog').evaluate((e) => e.remove()); await page.waitForTimeout(150);
    await page.locator('.gz-sb-toggle').focus(); await page.keyboard.press('Escape');
    probe(!(await state()).open && (await record()).open === false, 'closing a drawer preserves the collapsed desktop preference');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await wait(state, (s) => s.mode === 'collapsed', 'desktop preference restored');
    await page.locator('.gz-sb-toggle').click();
    await page.goto(`${local}/courses/${calc.id}/modules`); await page.waitForSelector('#gz-sidebar');
    probe(await page.locator('#gz-sidebar').evaluate((e) => Math.abs(e.getBoundingClientRect().bottom - (innerHeight - (document.getElementById('gz-footer')?.getBoundingClientRect().height || 0) - (document.documentElement.dataset.gzSbStyle === 'float' ? 12 : 0))) <= 1), 'the owned column fills the viewport below navigation, keeping footer room (less a floating card\'s inset)');
    probe(await page.locator('.gz-sb-more').evaluate((e) => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'), 'sidebar icon buttons inherit the Look surface');
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    probe(await page.locator('#gz-sidebar').evaluate((e) => getComputedStyle(e).borderInlineStartStyle !== 'none'), 'high contrast keeps a visible sidebar border');
    await page.setViewportSize({ width: 768, height: 1000 }); await page.waitForSelector('#gz-sb-launch'); await page.click('#gz-sb-launch');
    probe(await page.locator('#gz-sidebar').evaluate((e) => getComputedStyle(e).animationName === 'none'), 'reduced motion removes the drawer entrance animation');
    await page.keyboard.press('Escape'); await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ forcedColors: 'none' });
    await page.locator('html').evaluate((e) => { e.dir = 'rtl'; }); await page.reload();
    // Set direction after navigation too: local Canvas itself is English.
    await page.locator('html').evaluate((e) => { e.dir = 'rtl'; }); await page.waitForTimeout(250);
    probe((await state()).overflow <= 1 && await page.locator('#gz-sidebar').evaluate((e) => Math.abs(e.getBoundingClientRect().left - (document.documentElement.dataset.gzSbStyle === 'float' ? 12 : 0)) <= 1), 'RTL places the dock at the logical end without overflow');
    await page.locator('html').evaluate((e) => { e.dir = 'ltr'; });
    await page.emulateMedia({ media: 'print' });
    probe(!await page.locator('#gz-sidebar').isVisible(), 'printing omits the owned dock');
    await page.emulateMedia({ media: 'screen' });
    await page.goto(`${local}/courses/${calc.id}`); await page.waitForSelector('.gz-todo-scope');
    probe(await page.locator('.gz-todo-scope').evaluate((e) => { const [a, b] = e.children; return a.getAttribute('aria-pressed') === 'true' && getComputedStyle(a).backgroundColor !== getComputedStyle(b).backgroundColor; }), 'To Do scope has a visible and accessible selection');
    await page.emulateMedia({ media: 'print' });
    probe(await page.locator('#right-side .Sidebar__TodoListContainer, #right-side ul.to-do-list').first().evaluate((e) => getComputedStyle(e).display !== 'none'), 'printing removes Glaze\'s native To Do hiding rule');
    await page.emulateMedia({ media: 'screen' });
    await page.locator('#right-side').evaluate((e) => { for (const child of e.children) child.hidden = true; });
    const empty = await record(); empty.dest = { notes: 'off', timer: 'off', todo: 'off' };
    await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, empty]);
    await wait(state, (s) => s.mode === 'none', 'empty sidebar');
    probe(!await page.locator('[data-gz-sidebar-host]').isVisible() && await page.locator('#gz-sb-edge').isVisible(), 'an empty native column reserves no room and keeps Add widgets');
    await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, dockRecord]);
    await page.reload(); await page.waitForSelector('[data-gz-sidebar-host="native"]');
    await page.locator('[data-gz-sidebar-host="native"]').evaluate((e) => { window.sidebarCheckOldHost = e; e.remove(); });
    await wait(state, (s) => s.host?.kind === 'glaze' && s.mode === 'drawer', 'lost native host recovery');
    probe(!(await state()).open && await page.evaluate(() => !window.sidebarCheckOldHost.hasAttribute('data-gz-sidebar-host') && !window.sidebarCheckOldHost.hasAttribute('aria-modal')), 'host loss restores the native attributes and leaves a closed standalone drawer');
    // The keyboard's way for each gesture, each announced: a docked widget's order and height, the column's width.
    await store(settings(true), { widgetLayout: lay });
    await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, { ...dockRecord, width: 352, open: true }]);
    await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto(`${local}/courses/${calc.id}/modules`);
    await page.waitForSelector('.gz-sb-dock [data-tile="timer"] .gz-w-handle');
    const said = () => page.evaluate(() => [...document.querySelectorAll('[role="status"], [aria-live]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | '));
    const order0 = (await record()).dock.map((x) => x.id);
    await page.locator('.gz-sb-dock [data-tile="notes"] .gz-w-handle').focus(); await page.keyboard.press('ArrowDown');
    await wait(record, (r) => r.dock.map((x) => x.id).join() !== order0.join(), 'keyboard reorder saved');
    probe(/3/.test(await said()), `keyboard reorder announced (${await said()})`);
    probe(await page.evaluate(() => document.activeElement?.closest?.('[data-tile]')?.dataset.tile === 'notes'), 'keyboard reorder keeps the focus on the moved widget');
    await page.locator('.gz-sb-dock [data-tile="timer"] .gz-w-vsize').focus(); await page.keyboard.press('ArrowDown');
    await wait(record, (r) => r.dock.find((x) => x.id === 'timer').h != null, 'keyboard height saved');
    probe(/px/.test(await said()), `keyboard height announced (${await said()})`);
    await page.locator('.gz-sb-resize').focus(); await page.keyboard.press('ArrowLeft');
    await wait(record, (r) => r.width === 368, 'keyboard width saved');
    probe(/368/.test(await said()), `keyboard width announced (${await said()})`);
    // Reset sidebar for this account: the column as new, the widgets where they were.
    const docked0 = (await record()).dock.map((x) => x.id);
    await page.click('.gz-sb-more');
    probe(await page.locator('#gz-sb-menu').evaluate((m) => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && [...m.children].every((b) => b.scrollWidth <= b.clientWidth + 1); }), 'the customization menu fits its labels and the window');
    await page.locator('#gz-sb-menu .gz-sb-item').last().click();
    await wait(record, (r) => r.width === 352 && r.dock.every((x) => x.h == null), 'reset saved');
    probe((await record()).dock.map((x) => x.id).join() === docked0.join() && (await record()).open === true, 'reset keeps the docked widgets and their order');
    await shot(`polish-reset-${LANG}-1600`);
    // Long labels: the header and the dock's controls stay inside the narrowest column.
    await page.locator('.gz-sb-resize').focus(); await page.keyboard.press('Home');
    await wait(record, (r) => r.width === 288, 'narrowest width');
    const spill = () => page.evaluate(() => {
      const host = document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect();
      return [...document.querySelectorAll('.gz-sb-head > *, .gz-sb-sec-btn, .gz-sb-add, .gz-sb-dock .gz-w-head, .gz-sb-dock .gz-w-tools > *')]
        .filter((e) => e.getClientRects().length && !e.classList.contains('gz-sr'))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.left < host.left - 1 || r.right > host.right + 1 || e.scrollWidth > e.clientWidth + 2; })
        .map((e) => e.className || e.tagName);
    });
    probe(!(await spill()).length, `long labels stay inside the column at 288px (${(await spill()).join(', ')})`);
    await page.click('.gz-sb-more'); await page.locator('#gz-sb-menu .gz-sb-item').first().click();
    await page.waitForSelector('#gz-sb-adding:not([hidden])');
    probe(!(await spill()).length && await page.locator('#gz-sb-adding').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'Add widgets fits the narrowest column');
    await shot(`polish-long-labels-${LANG}-288`);
    await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, { ...dockRecord, width: 352, open: true }]);

    // Glaze's footer, on and off: the column, the drawer and the edge buttons end above it and the bottom bar.
    for (const footer of [true, false]) for (const [w, navbar] of [[1600, false], [1600, true], [1024, true], [390, true], [390, false]]) {
      await store(settings(true, navbar, { footer }), { widgetLayout: lay });
      await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, { ...dockRecord, width: 352, open: true }]);
      await page.setViewportSize({ width: w, height: 900 }); await page.goto(`${local}/courses/${calc.id}`);
      await wait(() => page.evaluate(() => document.documentElement.dataset.gzSidebar || null), Boolean, `footer ${footer} ${w}: sidebar ready`);
      await page.waitForFunction((on) => !!document.getElementById('gz-footer') === on, footer);
      const bottom0 = await page.locator('[data-gz-sidebar-host]').evaluate((e) => e.getBoundingClientRect().bottom);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => {
        const f = document.getElementById('gz-footer')?.getBoundingClientRect(), h = document.querySelector('[data-gz-sidebar-host]');
        return !f || !h?.getClientRects().length || h.getBoundingClientRect().bottom <= f.top + 1;
      });
      if (footer && w === 1600) probe(await page.locator('[data-gz-sidebar-host]').evaluate((e, before) => Math.abs(e.getBoundingClientRect().bottom - before) <= 1, bottom0), `footer ${w}${navbar ? ' navbar' : ''}: scrolling never shrinks the fixed column`);
      const s = await layoutOk(`footer-${footer ? 'on' : 'off'}${navbar ? '-navbar' : ''}`, w);
      // Covered by Glaze's column or buttons (an open drawer's backdrop covers the whole page, as a dialog's does).
      const free = await page.evaluate(() => {
        const f = document.getElementById('gz-footer'), link = f?.querySelector('a')?.getBoundingClientRect();
        if (!link || !link.width || link.top >= innerHeight) return true;
        const at = document.elementFromPoint(link.x + link.width / 2, link.y + link.height / 2);
        return !at?.closest('[data-gz-sidebar-host], .gz-sb-own, .gz-sb-edge, .gz-sb-launch');
      });
      if (s.mode === 'drawer') await page.click('#gz-sb-launch');
      await headerOk(page, `footer ${footer} ${w}${navbar ? ' navbar' : ''}`);
      const g = await page.evaluate(() => {
        const f = document.getElementById('gz-footer'), host = document.querySelector('[data-gz-sidebar-host]');
        const fr = f?.getClientRects().length ? f.getBoundingClientRect() : null, hr = host.getBoundingClientRect();
        const bar = innerWidth < 900 && document.documentElement.matches('[data-gz-navbar]:not([data-gz-navbar~="none"])') ? 96 : 0;
        const link = f?.querySelector('a')?.getBoundingClientRect();
        return { footer: !!fr, hostBottom: Math.round(hr.bottom), limit: Math.round(Math.min(fr && fr.top < innerHeight ? fr.top : innerHeight, innerHeight - bar - (bar && fr ? fr.height : 0))),
          linkFree: !link || !link.width || !!f.contains(document.elementFromPoint(link.x + link.width / 2, link.y + link.height / 2)) || link.top >= innerHeight };
      });
      probe(g.footer === footer, `footer ${footer} ${w}${navbar ? ' navbar' : ''}: the footer ${footer ? 'shows' : 'is off'}`);
      probe(g.hostBottom <= g.limit + 1, `footer ${footer} ${w}${navbar ? ' navbar' : ''}: the column ends above the footer and bottom bar (${g.hostBottom} <= ${g.limit})`);
      probe(free, `footer ${footer} ${w}${navbar ? ' navbar' : ''}: the footer is not covered`);
      await shot(`polish-footer-${footer ? 'on' : 'off'}${navbar ? '-navbar' : ''}-${w}`);
      if (s.mode === 'drawer') await page.keyboard.press('Escape');
    }

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${local}/courses/${calc.id}`); await page.waitForSelector('[data-gz-sidebar-host]');
    await page.locator('html').evaluate((e) => e.setAttribute('data-gz-focus', ''));
    probe(await page.locator('#not_right_side').evaluate((e) => parseFloat(getComputedStyle(e).paddingInlineEnd) === 0), 'focus-document mode returns the sidebar room immediately');
    await page.locator('html').evaluate((e) => e.removeAttribute('data-gz-focus'));

    // The Look's: a light and two dark presets, the column's surface and text from each; 640px (1280 at 200% zoom).
    const bgs = {};
    for (const name of ['Paper', 'Midnight', 'Ember']) {
      await store(settings(true, false, { preset: name, colors: G.GZ_PRESETS.find(([n]) => n === name)[1] }), { widgetLayout: lay });
      await opts.evaluate(([k, v]) => chrome.storage.local.set({ [k]: v }), [recordKey, { ...dockRecord, width: 352, open: true }]);
      for (const w of [1600, 640]) {
        await page.setViewportSize({ width: w, height: 900 }); await page.goto(local + '/');
        await wait(() => page.evaluate(() => document.documentElement.dataset.gzSidebar || null), Boolean, `${name} ${w}: sidebar ready`);
        await page.waitForTimeout(600);
        const s = await layoutOk(`look-${name}`, w);
        if (s.mode === 'drawer') await page.click('#gz-sb-launch');
        const c = await page.evaluate(() => { const h = document.querySelector('[data-gz-sidebar-host]'), cs = getComputedStyle(h); return { bg: cs.backgroundColor, ink: getComputedStyle(h.querySelector('.gz-sb-title')).color }; });
        if (w === 1600) bgs[name] = c;
        await shot(`polish-look-${name}-${w}${s.mode === 'drawer' ? '-drawer' : ''}`);
        if (s.mode === 'drawer') await page.keyboard.press('Escape');
      }
    }
    probe(bgs.Paper.bg !== bgs.Midnight.bg && bgs.Paper.ink !== bgs.Midnight.ink && bgs.Midnight.bg !== bgs.Ember.bg, `the column follows the Look (${JSON.stringify(bgs)})`);
    await store(settings(true), { widgetLayout: lay });

    if (process.env.SIDEBAR_REVIEW_ONLY) {
      console.log(`${failures.length ? 'FAILED' : 'passed'}; ${checks} checks, ${failures.length} layout failures`);
      if (failures.length) process.exitCode = 1;
      return;
    }

    // Before: the sidebar off, Canvas's own column as Canvas (and Glaze's theme) has it.
    await store(settings(false), { widgetLayout: lay });
    for (const [name, at] of PAGES) for (const w of [1600, 390]) {
      await page.setViewportSize({ width: w, height: 1000 }); await page.goto(local + at); await page.waitForTimeout(1200);
      await shot(`before-${name}-${w}`);
    }

    // After: the sidebar on, the same layout.
    await store(settings(true), { widgetLayout: lay });
    for (const [name, at] of PAGES) {
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 1000 }); await page.goto(local + at);
        await wait(() => page.evaluate(() => document.documentElement.dataset.gzSidebar || null), Boolean, `${name} ${w}: sidebar ready`);
        await page.waitForTimeout(700);
        const s = await layoutOk(name, w);
        if (s.mode === 'drawer') {
          await page.click('#gz-sb-launch');
          const d = await state();
          probe(d.open && d.host?.shown && d.host.w <= w, `${name} ${w}: the drawer opens within the window`);
          await shot(`after-${name}-${w}-drawer`);
          await page.keyboard.press('Escape');
          probe(!(await state()).open && await page.evaluate(() => document.activeElement?.id === 'gz-sb-launch'), `${name} ${w}: Escape closes it, focus back on its button`);
        }
        await shot(`after-${name}-${w}`);
      }
    }
    const rec = async () => (await localGet(`sidebar:canvas:${local}/${me.id}`))[`sidebar:canvas:${local}/${me.id}`];
    ok((await rec())?.mig === 1 && (await rec()).dest.todo === 'dock', 'To Do migrated into the dock once');

    // Canvas's own controls, in its column, at a wide window.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`${local}/courses/${calc.id}/grades`); await page.waitForTimeout(1500);
    const g = await state();
    probe(g.mode === 'expanded' || g.mode === 'drawer', `grades: ${g.mode} (900px for the table)`);
    if (g.mode === 'drawer') await page.click('#gz-sb-launch');
    const graded = page.locator('#only_consider_graded_assignments');
    if (await graded.count()) {
      // Canvas's styled checkbox: its label takes the click, as it does for the student.
      const was = await graded.isChecked(), box = page.locator('label[for="only_consider_graded_assignments"]');
      await box.click();
      probe(await graded.isChecked() !== was, 'grades: Calculate based only on graded assignments still toggles');
      await box.click();
    }
    const cell = page.locator('#grades_summary tr.student_assignment.editable .assignment_score .grade').first();
    if (await cell.count()) {
      if (g.mode === 'drawer') await page.keyboard.press('Escape');
      // The score opens What-If from the keyboard too (Canvas's own status cell sits over it for a pointer here).
      await cell.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      probe(await page.locator('#grades_summary input#grade_entry:visible, #grades_summary .grade input:visible').count() > 0, 'grades: What-If opens its score entry');
      await page.keyboard.press('Escape');
    } else console.log('note grades: no editable score cell to try What-If on');
    await page.goto(`${local}/calendar`); await page.waitForTimeout(1500);
    const title = () => page.locator('.navigation_title, .fc-toolbar h2, h2.navigation_title').first().textContent().catch(() => '');
    const t0 = await title();
    await page.locator('button.navigate_next, .navigate_next').first().click();
    await page.waitForTimeout(600);
    probe((await title()) !== t0, `calendar: navigation still moves (${t0} → ${await title()})`);
    probe(await page.locator('#right-side #minical').count() === 1, 'calendar: the mini calendar in the column');
    if (take) {
      // Resume the existing untimed attempt for read-only control checks. No answer is typed or submitted.
      await page.goto(`${local}/courses/${hist.id}/quizzes/${take.id}/take`); await page.waitForTimeout(2000);
      const q = await layoutOk('quiz-take', 1600);
      if (q.mode === 'drawer') await page.click('#gz-sb-launch');
      probe(await page.locator('#right-side #question_list a').count() > 0, 'quiz: question links in the column');
      probe(await page.locator('#right-side :is(#quiz-time-elapsed, .time_running, .timer_container, #quiz_timer)').count() > 0, 'quiz: the timer in the column');
      const link = page.locator('#right-side #question_list a').first();
      if (await link.count() && await link.isVisible()) { await link.click(); probe(new URL(page.url()).pathname.endsWith('/take'), 'quiz: a question link stays on the quiz'); }
      await shot('after-quiz-take-1600');
    } else console.log('note quiz: no existing untimed attempt to inspect');

    // A widget moved board → sidebar → floating → board, with a reload after each move.
    await store(settings(true), { widgetLayout: lay });
    await page.goto(local + '/'); await page.waitForSelector('#gz-dash section[data-tile="notes"]');
    const where = () => page.evaluate(() => {
      const e = [...document.querySelectorAll('section.gz-w[data-tile="notes"]')];
      return e.length !== 1 ? `${e.length} copies` : e[0].closest('#gz-dash') ? 'board' : e[0].closest('.gz-sb-dock') ? 'dock' : e[0].closest('#gz-float') ? 'float' : 'elsewhere';
    });
    const move = async (label) => {
      await page.locator('section.gz-w[data-tile="notes"] .gz-w-dest').click();
      await page.getByRole('menuitem', { name: I.t(label, {}, await page.locator('html').getAttribute('lang')), exact: true }).click();
      await wait(where, (v) => v === ({ 'Move to sidebar': 'dock', Float: 'float', 'Move to Dashboard': 'board' })[label], `notes: ${label} committed`);
    };
    await page.click('#gz-dash .gz-dash-edit');
    const spot = W.layout((await localGet('widgetLayout')).widgetLayout).boards.cdash.find((x) => x.id === 'notes');
    await move('Move to sidebar'); ok(await where() === 'dock', 'notes: in the sidebar');
    await page.reload(); await page.waitForTimeout(1500); ok(await where() === 'dock', 'notes: still in the sidebar after a reload');
    await layoutOk('dashboard docked', 1600);
    await move('Float'); ok(await where() === 'float', 'notes: floating');
    await page.reload(); await page.waitForTimeout(1500); ok(await where() === 'float', 'notes: still floating after a reload');
    const fr = await page.evaluate(() => { const t = document.querySelector('#gz-float [data-tile="notes"]').getBoundingClientRect(), h = document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect(); return document.documentElement.dataset.gzSidebar !== 'expanded' || t.right <= h.left + 1; });
    probe(fr, 'notes: the float keeps clear of the expanded sidebar');
    await move('Move to Dashboard'); ok(await where() === 'board', 'notes: back on the Dashboard');
    await page.reload(); await page.waitForTimeout(1500); ok(await where() === 'board', 'notes: still on the Dashboard after a reload');
    const back = W.layout((await localGet('widgetLayout')).widgetLayout).boards.cdash.find((x) => x.id === 'notes');
    ok(JSON.stringify([back.x, back.y, back.w, back.h]) === JSON.stringify([spot.x, spot.y, spot.w, spot.h]), 'notes: its board spot and size kept through the moves');
    await shot('after-dashboard-placement-1600');

    // Glaze's navigation bar too: the column clears it.
    await store(settings(true, true));
    for (const w of [1600, 1024, 390]) {
      await page.setViewportSize({ width: w, height: 1000 }); await page.goto(`${local}/courses/${calc.id}`); await page.waitForTimeout(1500);
      await layoutOk('course-home navbar', w); await shot(`after-course-home-navbar-${w}`);
    }
    // Off again: Canvas's column as it was.
    await store(settings(false));
    await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto(`${local}/courses/${calc.id}`); await page.waitForTimeout(1200);
    ok(await page.evaluate(() => !document.querySelector('[data-gz-sidebar-host], #gz-sidebar, .gz-sb-head') && !document.documentElement.dataset.gzSidebar), 'off: nothing of the sidebar left');
    ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    console.log(`${failures.length ? 'FAILED' : 'passed'}; ${checks} checks, ${failures.length} layout failures; screenshots in ${out}`);
    if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  } finally {
    try { await ctx?.close(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
