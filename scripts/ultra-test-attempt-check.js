// Ultra's legacy test attempt and the item and tool pages around it, with Glaze loaded (test/fixtures/ultra-test-attempt.html):
// every part on a painted, rounded surface, pills for the section headings, answer rows that are whole controls, the
// sticky progress bar never crossed by the questions, the editor card, swatches in their own colours, the footer's dock,
// and close buttons clear of titles. Four window sizes; a scene and a solid background; a dark and a light Look.
// EXT=<checkout> NODE_PATH=<playwright> nice node scripts/ultra-test-attempt-check.js <out dir> [--looks=a,b]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2] || 'ultra-test-attempt-evidence');
const lookArg = process.argv.find((a) => a.startsWith('--looks='));
const LOOKS = lookArg ? lookArg.slice(8).split(',') : ['Frostdev', 'Library'];
const SIZES = [[1800, 987], [1280, 800], [1024, 768], [768, 900]];
const fixture = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-test-attempt.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_8123_1/attempt/_8124_1?courseId=_101_1';
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label, actual }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// In the page: colour parsing, painted/rounded tests, contrast, rect overlap.
const HELPERS = `
  window.__gz = {
    rgba(c) { const m = c.match(/rgba?\\(([^)]+)\\)/) || c.match(/color\\(srgb ([^)]+)\\)/); if (!m) return null;
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); const srgb = c.startsWith('color(');
      return { r: srgb ? p[0] * 255 : p[0], g: srgb ? p[1] * 255 : p[1], b: srgb ? p[2] * 255 : p[2], a: p[3] ?? 1 }; },
    painted(e, pseudo) { const c = this.rgba(getComputedStyle(e, pseudo).backgroundColor); return !!c && c.a > 0.05; },
    radius(e, pseudo) { return parseFloat(getComputedStyle(e, pseudo).borderTopLeftRadius) || 0; },
    lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); },
    contrast(a, b) { const x = this.lum(a), y = this.lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); },
    rect(e) { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; },
    meets(a, b) { return a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5; },
    hit(e) { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && (e === t || e.contains(t)); },
  };`;

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-test-attempt-'));
  fs.mkdirSync(out, { recursive: true });
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true,
      viewport: { width: 1800, height: 987 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const setup = async (look, bg) => {
      const base = G.GZ_DEFAULTS;
      const L = G.GZ_LOOKS.find((l) => l.name === look);
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, L), navbar: { ...base.navbar, on: true, place: 'top', style: 'float' },
        bg: { ...base.bg, ...(L && G.GZ_LOOK_APPLY(base, L).bg), kind: bg, scene: 'topography' }, motion: { ...base.motion, level: 'off' } };
      await opts.evaluate(async ({ settings, site, uid }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.session.clear();
        await chrome.storage.sync.set(settings);
        await chrome.storage.local.set({ ultra: [site], [`ctabs:${site}:${uid}`]: { tabs: [1, 2].map((i) => ({ cid: `_10${i}_1`, name: `Course ${i}`, path: `/ultra/courses/_10${i}_1/outline`, at: i, top: 0 })) } });
      }, { settings, site, uid });
      await require('./check-env.js').ultraReady(opts);
    };
    const go = async (p) => {
      await page.goto(site + p);
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() && document.querySelector('#site-wrap'), null, { timeout: 20000 });
      await page.addScriptTag({ content: HELPERS });
      await pause(700);
    };
    const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') });
    const ev = (fn, arg) => page.evaluate(fn, arg);

    for (const look of LOOKS) for (const bg of ['scene', 'solid']) {
      await setup(look, bg);
      for (const [w, h] of SIZES) {
        const tag = `${look} ${bg} ${w}x${h}`;
        await page.setViewportSize({ width: w, height: h });
        await go(ATTEMPT);
        const top = await ev(() => {
          const g = window.__gz, $ = (s) => document.querySelector(s);
          const band = $('.assessment-attempt-panel bb-panel-header > .panel-header');
          const pills = ['.attempt-header > h2', '.question-header > .question-label', '.additional-content-label'].map((s) => $('.assessment-attempt-panel ' + s));
          const cards = [...document.querySelectorAll('.assessment-attempt-panel .assessment-question')];
          // A painted descendant at a card's corner draws a square over its rounded one.
          const corner = cards.flatMap((c) => { const cr = g.rect(c); return [...c.querySelectorAll('*')].filter((d) => g.painted(d) && g.radius(d) < 2 && d.getClientRects().length)
            .map((d) => g.rect(d)).filter((r) => (Math.abs(r.x - cr.x) < 3 && Math.abs(r.y - cr.y) < 3) || (Math.abs(r.r - cr.r) < 3 && Math.abs(r.b - cr.b) < 3)); });
          const rows = [...document.querySelectorAll('.assessment-attempt-panel label.MuiFormControlLabel-root')];
          const row = rows[0], box = row.querySelector('[aria-hidden="true"]');
          const rowBg = g.rgba(getComputedStyle(row).backgroundColor), edge = g.rgba(getComputedStyle(box).borderTopColor);
          return {
            band: band && { painted: g.painted(band), radius: g.radius(band) },
            pills: pills.map((p) => p && { painted: g.painted(p), radius: g.radius(p) }),
            cards: cards.map((c) => ({ painted: g.painted(c), radius: g.radius(c) })), corner: corner.length,
            rows: rows.map((r) => ({ painted: g.painted(r), radius: g.radius(r) })), rowAlpha: rowBg?.a, edge: rowBg && edge && +g.contrast(edge, rowBg).toFixed(2),
            progress: { painted: g.painted($('.assessment-progress-header')), radius: g.radius($('.assessment-progress-header')) },
            dock: { painted: g.painted($('footer.panel-footer-fixed'), '::before'), radius: g.radius($('footer.panel-footer-fixed'), '::before') },
          };
        });
        check(top.band?.painted && top.band.radius > 4, `${tag}: title band painted and rounded`, top.band);
        check(top.pills.every((p) => p?.painted && p.radius > 100), `${tag}: section headings are pills`, top.pills);
        check(top.cards.length === 3 && top.cards.every((c) => c.painted && c.radius > 4), `${tag}: each question is a rounded card`, top.cards);
        check(top.corner === 0, `${tag}: nothing square paints over a card's corner`, top.corner);
        check(top.rows.length === 7 && top.rows.every((r) => r.painted && r.radius > 2), `${tag}: every answer row painted and rounded`, top.rows);
        check(top.rowAlpha >= 0.85 && top.edge >= 3, `${tag}: a box's edge is >= 3:1 on its row`, [top.rowAlpha, top.edge]);
        check(top.progress.painted && top.progress.radius > 4, `${tag}: progress bar has a rounded surface`, top.progress);
        check(top.dock.painted && top.dock.radius > 4, `${tag}: footer dock painted and rounded`, top.dock);
        if (w >= 1024 || bg === 'scene') await shot(`${slug(tag)}-top`);

        // Every part of an answer row hits its row; keyboard focus and a chosen answer show on the row.
        const rowHits = await ev(() => { const g = window.__gz; return [...document.querySelectorAll('.assessment-attempt-panel label.MuiFormControlLabel-root')].map((l) => {
          l.scrollIntoView({ block: 'center' }); const r = l.getBoundingClientRect(); const pts = [[r.x + 6, r.y + r.height / 2], [r.x + r.width / 2, r.y + r.height / 2], [r.right - 6, r.y + r.height / 2]];
          return pts.every(([x, y]) => l.contains(document.elementFromPoint(x, y))); }); });
        check(rowHits.every(Boolean), `${tag}: the control, letter and text of each row hit the row`, rowHits);
        await page.keyboard.press('Shift');
        const focus = await ev(() => { const i = document.querySelector('.js-multiple-answer-answer-0 input'); i.focus(); return getComputedStyle(i.closest('label')).outlineStyle; });
        check(focus === 'solid', `${tag}: keyboard focus outlines the row`, focus);
        const disabled = await ev(() => { const i = document.querySelector('.js-multiple-answer-answer-0 input'), l = i.closest('label');
          i.disabled = true; l.click();
          const s = getComputedStyle(l), result = { checked: i.checked, cursor: s.cursor, opacity: +s.opacity };
          i.disabled = false; return result; });
        check(!disabled.checked && disabled.cursor === 'not-allowed' && disabled.opacity < 1, `${tag}: disabled answers stay unchanged and visibly disabled`, disabled);
        if (w === 1800) {
          await page.locator('.js-multiple-answer-answer-1').click();
          const chosen = await ev(() => { const l = document.querySelector('.js-multiple-answer-answer-1'), o = document.querySelector('.js-multiple-answer-answer-2');
            return { checked: l.querySelector('input').checked, edge: getComputedStyle(l).borderTopColor, other: getComputedStyle(o).borderTopColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() }; });
          check(chosen.checked && chosen.edge !== chosen.other, `${tag}: a chosen answer's row is marked`, chosen);
        }

        // The questions scroll under the progress bar, never across its words.
        const under = await ev(() => { const p = document.querySelector('.assessment-attempt-panel'); p.scrollTop = 600;
          return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(window.__gz.hit(document.querySelector('#assessment-question-counts-description')))))); });
        check(under, `${tag}: progress count stays readable over scrolled questions`);
        if (w >= 1024 || bg === 'scene') await shot(`${slug(tag)}-scrolled`);

        // The editor card and its colour menu.
        const ed = await ev(() => { const g = window.__gz, p = document.querySelector('.assessment-attempt-panel'); p.scrollTop = p.scrollHeight;
          const root = document.querySelector('.freeform-response .bb-editor-root');
          document.querySelector('[aria-label="Color picker"]').click();
          return new Promise((res) => setTimeout(() => res({ root: { painted: g.painted(root), radius: g.radius(root) },
            inner: ['.ql-editor', '.bb-editor-container', '.status-bar'].map((s) => g.painted(root.querySelector(s))),
            placeholder: getComputedStyle(root.querySelector('.ql-editor'), '::before').fontStyle,
            swatches: Object.fromEntries(['black', 'grey', 'purple', 'blue', 'green', 'red'].map((c) => [c, getComputedStyle(document.querySelector(`.picker-color.color-${c}`)).backgroundColor])) }), 400)); });
        check(ed.root.painted && ed.root.radius > 4 && !ed.inner.some(Boolean), `${tag}: the editor is one rounded card`, ed);
        check(ed.placeholder === 'normal', `${tag}: placeholder in plain type`, ed.placeholder);
        check(ed.swatches.black === 'rgb(0, 0, 0)' && ed.swatches.grey === 'rgb(102, 102, 102)' && ed.swatches.purple === 'rgb(162, 52, 181)', `${tag}: swatches keep their colours`, ed.swatches);
        if (w >= 1024 || bg === 'scene') await shot(`${slug(tag)}-menu`);
        const submenu = await ev(() => { const e = document.querySelector('.bb-editor-toolbar-submenu'), s = getComputedStyle(e);
          return { painted: window.__gz.painted(e), border: parseFloat(s.borderTopWidth), radius: window.__gz.radius(e) }; });
        check(submenu.painted && submenu.border >= 1 && submenu.radius > 2, `${tag}: toolbar submenu keeps its own surface and edge`, submenu);
        await ev(() => document.querySelector('[aria-label="Color picker"]').click());

        const rtl = await ev(() => { const g = window.__gz, p = document.querySelector('.assessment-attempt-panel');
          document.documentElement.dir = 'rtl'; p.scrollTop = 0;
          const exit = document.querySelector('[aria-label="Exit"]'), title = document.querySelector('.black-header-contents > h1');
          const range = document.createRange(); range.selectNodeContents(title); const tr = range.getBoundingClientRect();
          const headerClear = !exit.getClientRects().length || !g.meets(g.rect(exit), { x: tr.x, y: tr.y, r: tr.right, b: tr.bottom });
          const editor = document.createElement('div'); editor.className = 'bb-editor-wrapper';
          editor.innerHTML = '<div class="bb-editor-root"><div class="bb-editor-toolbar">Tools</div><div class="bb-editor-container"><div class="ql-editor" contenteditable="true">Editable response</div></div></div>';
          document.querySelector('.assessment-question').append(editor);
          const border = parseFloat(getComputedStyle(editor.firstElementChild).borderTopWidth); editor.remove();
          document.documentElement.removeAttribute('dir');
          return { headerClear, border }; });
        check(rtl.headerClear && rtl.border >= 1, `${tag}: RTL header stays clear and editable question controls retain a border`, rtl);

        if (w < 1024) {
          const narrow = await ev(() => { const g = window.__gz, p = document.querySelector('.assessment-attempt-panel'); p.scrollTop = 0;
            const exit = document.querySelector('[aria-label="Exit"]'), bar = document.querySelector('.black-panel-header'), band = document.querySelector('.assessment-attempt-panel bb-panel-header > .panel-header');
            const title = document.querySelector('h1.panel-title.secondary-title');
            return { exit: g.rect(exit), title: g.rect(title), bar: g.rect(bar), band: g.rect(band), strip: !!document.querySelector('.assessment-attempt-panel > #gz-ctabs') }; });
          check(!(await ev(({ a, b }) => window.__gz.meets(a, b), { a: narrow.exit, b: narrow.title })) && narrow.band.y >= narrow.bar.b - 1, `${tag}: Exit and the title band clear of each other`, narrow);
          // Where the live page has the course strip at this width: the panel's first child (probe 12-test-768-overlap).
          const strip = await ev(() => { const g = window.__gz, s = document.querySelector('#gz-ctabs'), p = document.querySelector('.assessment-attempt-panel');
            if (!s) return null; const home = s.parentNode, next = s.nextSibling; p.prepend(s);
            const r = { strip: g.rect(s), bar: g.rect(document.querySelector('.black-panel-header')), band: g.rect(document.querySelector('.assessment-attempt-panel bb-panel-header > .panel-header')) };
            home.insertBefore(s, next); return r; });
          check(strip && strip.bar.y >= strip.strip.b - 1 && strip.band.y >= strip.bar.b - 1, `${tag}: with the strip in the panel, bar and title band stack below it`, strip);
          await shot(`${slug(tag)}-narrow-top`);
        }
      }

      // The pages around it, at the owner's desktop size.
      await page.setViewportSize({ width: 1800, height: 987 });
      const tag = `${look} ${bg}`;
      const pages = {
        journal: ['/ultra/courses/_101_1/journal/_8125_1', () => { const g = window.__gz, b = document.querySelector('bb-panel-header > .panel-header'); return { band: g.painted(b) && g.radius(b) > 4 }; }],
        file: ['/ultra/courses/_101_1/file/_8126_1', () => { const g = window.__gz, b = document.querySelector('bb-panel-header > .panel-header'); return { band: g.painted(b) && g.radius(b) > 4, frame: g.painted(document.querySelector('.file-viewer iframe')) }; }],
        roster: ['/ultra/courses/_101_1/outline/roster', () => { const g = window.__gz; return { clear: !g.meets(g.rect(document.querySelector('.bb-close')), g.rect(document.querySelector('.simple-header h1.panel-title'))) }; }],
        rubric: ['/ultra/courses/_101_1/assessment/_8127_1/overview', () => { const g = window.__gz, h = document.querySelector('.rubric-details-panel > .panel-section-header');
          return { header: g.painted(h) && g.radius(h) > 4, title: !g.painted(h.querySelector('h2')) }; }],
        grades: ['/ultra/courses/_101_1/grades', () => { const g = window.__gz, t = document.querySelector('bb-ui-student-tabs .MuiTabs-root'); return { tabs: g.painted(t) && g.radius(t) > 10 }; }],
        announcements: ['/ultra/courses/_101_1/announcements', () => { const g = window.__gz, e = document.querySelector('.no-result-message'); return { empty: g.painted(e) && g.radius(e) > 4 }; }],
        discussion: ['/ultra/courses/_101_1/discussion/_8128_1', () => { const g = window.__gz, e = document.querySelector('.is-empty-wrapper'); return { empty: g.painted(e) && g.radius(e) > 4 }; }],
      };
      for (const [name, [p, fn]] of Object.entries(pages)) {
        await go(p);
        const r = await ev(fn);
        check(Object.values(r).every(Boolean), `${tag} ${name}`, r);
        await shot(`${slug(tag)}-${name}`);
      }
    }
    check(!errors.length, 'no page errors', errors.slice(0, 3));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.pass);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed; evidence in ${out}`);
  process.exitCode = failed.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
