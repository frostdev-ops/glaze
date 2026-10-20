// The sidebar on real Canvas at localhost:3000 (local test logins only): each kind of page at five widths, before (the
// sidebar off) and after, with Canvas's own controls still working, and a widget moved board → sidebar → floating → board
// with a reload after each move. Uses a temporary localhost-enabled extension and profile, removed on exit; never answers
// or submits a quiz (a quiz without a time limit is opened, only looked at).
// Hold /private/tmp/claude-501/glaze-heavy.lock and run under nice (as for the full test suite).
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/sidebar-canvas-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const G = require('../defaults.js');
const W = require('../lib/widgets.js');
const src = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-sidebar-canvas-evidence'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const local = 'http://localhost:3000';
const credentialsFile = process.env.CANVAS_CREDENTIALS || path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const settings = (sidebar, navbar = false) => G.GZ_SANITIZE({ enabled: true, navbar: { on: navbar }, motion: { level: 'off' },
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), sidebar, todo: true, widgets: true, notes: true } });
const WIDTHS = [1600, 1280, 1024, 768, 390];
let checks = 0, ctx, opts, page, tmp, ext;
const errors = [], failures = [];
const ok = (v, label) => { if (!v) throw Error(label); console.log(`ok   ${label}`); checks++; };
// A layout probe that fails is listed and the run goes on, so one bad width doesn't hide the others.
const probe = (v, label) => { if (v) ok(v, label); else { failures.push(label); console.error(`FAIL ${label}`); } };
const wait = async (read, accepts, label) => { let v; const end = Date.now() + 15000; do { v = await read(); if (accepts(v)) return v; await page.waitForTimeout(100); } while (Date.now() < end); throw Error(`${label} (last: ${JSON.stringify(v)})`); };
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

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
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { executablePath: CHROME, headless: true, viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
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
    // To take: one without a time limit not yet finished (opening it starts an attempt that can't time out); done: one finished.
    const take = quizzes.find((q, i) => !q.time_limit && !subs[i].some((s) => s.workflow_state === 'complete'));
    const done = quizzes.find((q, i) => subs[i].some((s) => s.workflow_state === 'complete'));
    const PAGES = [
      ['dashboard', '/'], ['course-home', `/courses/${calc.id}`], ['assignment', `/courses/${calc.id}/assignments/${asg.id}`],
      ['grades', `/courses/${calc.id}/grades`], ['calendar', '/calendar'], ['syllabus', `/courses/${calc.id}/assignments/syllabus`],
      ['modules', `/courses/${calc.id}/modules`], ...(done ? [['quiz-results', `/courses/${hist.id}/quizzes/${done.id}`]] : []),
    ];
    const lay = { ...W.layout({ tiles: W.TILES.map((id) => ({ id, on: id === 'notes', size: 'l' })) }), filled: ['cdash'] };
    lay.boards.cdash = lay.boards.cdash.map((x) => ({ ...x, on: x.id === 'notes' || x.id === 'todo' }));

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
      // Open the quiz (no time limit), look, leave. No answer is typed, nothing is submitted.
      await page.goto(`${local}/courses/${hist.id}/quizzes/${take.id}/take`); await page.waitForTimeout(2000);
      const q = await layoutOk('quiz-take', 1600);
      if (q.mode === 'drawer') await page.click('#gz-sb-launch');
      probe(await page.locator('#right-side #question_list a').count() > 0, 'quiz: question links in the column');
      probe(await page.locator('#right-side :is(#quiz-time-elapsed, .time_running, .timer_container, #quiz_timer)').count() > 0, 'quiz: the timer in the column');
      const link = page.locator('#right-side #question_list a').first();
      if (await link.count() && await link.isVisible()) { await link.click(); probe(new URL(page.url()).pathname.endsWith('/take'), 'quiz: a question link stays on the quiz'); }
      await shot('after-quiz-take-1600');
    } else console.log('note quiz: no quiz without a time limit left to open');

    // A widget moved board → sidebar → floating → board, with a reload after each move.
    await store(settings(true), { widgetLayout: lay });
    await page.goto(local + '/'); await page.waitForSelector('#gz-dash section[data-tile="notes"]');
    const where = () => page.evaluate(() => {
      const e = [...document.querySelectorAll('section.gz-w[data-tile="notes"]')];
      return e.length !== 1 ? `${e.length} copies` : e[0].closest('#gz-dash') ? 'board' : e[0].closest('.gz-sb-dock') ? 'dock' : e[0].closest('#gz-float') ? 'float' : 'elsewhere';
    });
    const move = async (label) => {
      await page.locator('section.gz-w[data-tile="notes"] .gz-w-dest').click();
      await page.locator('#gz-sb-menu .gz-sb-item', { hasText: label }).click();
      await page.waitForTimeout(500);
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
