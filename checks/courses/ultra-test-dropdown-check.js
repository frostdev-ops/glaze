// A dropdown in an Ultra test question opens over the questions and the footer below it, where Ultra puts it, with Glaze's
// glass cards on (test/fixtures/ultra-test-attempt.html plus two questions with an open menu). The menus are modelled, not
// captured: one positioned inside the question (absolute, z-index 1000, as a menu that stays in its question's markup) and
// one MUI v4 Select whose Modal stays in the question (disablePortal: fixed at inset 0, z-index 1300, the list placed at the
// button's viewport position). A card with a backdrop filter is a stacking context and the containing block of both, so the
// first went under the next question and the second landed off its button.
// EXT=<checkout>/extension NODE_PATH=<playwright> nice node checks/courses/ultra-test-dropdown-check.js <out dir>
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '../../extension'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'content/defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2] || 'ultra-test-dropdown-evidence');
const fixture = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-test-attempt.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_8123_1/attempt/_8124_1?courseId=_101_1';
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };

// Two questions with a dropdown each, after the fixture's own; each menu opened as its kind opens.
const ADD = () => {
  const list = document.querySelector('.assessment-attempt-panel .attempt-question-list');
  const options = ['Mitosis', 'Meiosis', 'Osmosis', 'Diffusion', 'Respiration', 'Photosynthesis'];
  const q = (n, inner) => `<li><bb-assessment-question><div class="assessment-question js-question-type-matching"><form><span class="sr-only">Question ${n}</span>
    <div class="question-header has-question-title is-read-only"><h3 class="question-label">Question ${n}</h3><div class="point-value"><bdi>10</bdi> Points</div></div>
    <div class="question-content"><bb-question-attempt><p>Match the invented term to its process.</p>${inner}</bb-question-attempt></div></form></div></bb-assessment-question></li>`;
  const inline = `<div class="gz-test-inline" style="position: relative; display: inline-block">
    <button type="button" class="dropdown-toggle" aria-haspopup="listbox" aria-expanded="true" style="min-width: 12rem; height: 2.25rem">Select an answer</button>
    <ul role="listbox" class="dropdown-menu" style="position: absolute; top: 100%; left: 0; z-index: 1000; margin: 0; padding: 0; list-style: none; width: 14rem; background: #fff; color: #111; box-shadow: 0 4px 12px #0004">
      ${options.map((o) => `<li role="option" style="height: 36px; line-height: 36px; padding: 0 12px">${o}</li>`).join('')}</ul></div>`;
  const mui = `<div class="MuiFormControl-root"><div class="MuiInputBase-root MuiOutlinedInput-root MuiInputBase-formControl" style="min-width: 12rem">
    <div class="MuiSelect-root MuiSelect-select MuiSelect-outlined MuiInputBase-input" role="button" tabindex="0" aria-haspopup="listbox" aria-expanded="true" style="height: 2.25rem; line-height: 2.25rem; padding: 0 12px">Select an answer</div></div>
    <div role="presentation" class="MuiPopover-root" style="position: fixed; z-index: 1300; inset: 0px;"><div aria-hidden="true" style="position: fixed; inset: 0px; background-color: transparent;"></div>
      <div class="MuiPaper-root MuiMenu-paper MuiPopover-paper MuiPaper-elevation8 MuiPaper-rounded" tabindex="-1" style="position: absolute; width: 14rem; background: #fff; color: #111">
        <ul class="MuiList-root MuiMenu-list MuiList-padding" role="listbox" tabindex="-1" style="margin: 0; padding: 0; list-style: none">${options.map((o) => `<li class="MuiButtonBase-root MuiListItem-root MuiMenuItem-root" role="option" style="height: 36px; line-height: 36px; padding: 0 12px">${o}</li>`).join('')}</ul></div></div></div>`;
  list.insertAdjacentHTML('beforeend', q(3, inline) + q(4, mui));
};
// Where MUI puts its Paper: under the button, from the button's place in the viewport (Popover's getAnchorPosition).
const PLACE = () => {
  const button = document.querySelector('.MuiSelect-root'), paper = document.querySelector('.MuiPopover-paper'), r = button.getBoundingClientRect();
  paper.style.top = `${r.bottom}px`; paper.style.left = `${r.left}px`;
};
// Is the menu the topmost thing at each of its options, and where is it? Each option's centre is sampled.
const PROBE = (sel) => {
  const menu = document.querySelector(sel), button = menu.closest('.assessment-question').querySelector('[aria-haspopup]');
  const m = menu.getBoundingClientRect(), b = button.getBoundingClientRect(), card = menu.closest('.assessment-question').getBoundingClientRect();
  const covered = [...menu.querySelectorAll('[role="option"]')].map((o) => { const r = o.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (y >= innerHeight) return null;
    const t = document.elementFromPoint(x, y); return t && (o === t || o.contains(t)) ? null : { option: o.textContent, under: `${t?.tagName}.${String(t?.className).slice(0, 50)}` }; }).filter(Boolean);
  return { covered, outside: m.bottom > card.bottom + 1, at: { menu: [Math.round(m.left), Math.round(m.top)], button: [Math.round(b.left), Math.round(b.bottom)] } };
};

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-test-dropdown-'));
  fs.mkdirSync(out, { recursive: true });
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    for (const look of ['Frostdev', 'Library']) for (const bg of ['scene', 'solid']) {
      const base = G.GZ_DEFAULTS, L = G.GZ_LOOKS.find((l) => l.name === look);
      const settings = { ...base, ...G.GZ_LOOK_APPLY(base, L), bg: { ...base.bg, ...(L && G.GZ_LOOK_APPLY(base, L).bg), kind: bg, scene: 'topography' }, motion: { ...base.motion, level: 'off' } };
      await opts.evaluate(async ({ settings, site }) => {
        await chrome.storage.sync.clear(); await chrome.storage.local.clear();
        await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] });
      }, { settings, site });
      await env.ultraReady(opts);
      await page.goto(site + ATTEMPT);
      await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-accent').trim() && document.querySelector('.assessment-attempt-panel .attempt-question-list'), null, { timeout: 20000 });
      await page.evaluate(ADD);
      // The glass is on, as a student sees it: a card's backdrop filter (the rule this check is about) is there to begin with.
      const glass = await page.evaluate(() => getComputedStyle(document.querySelectorAll('.assessment-attempt-panel .assessment-question')[0]).backdropFilter);
      const tag = `${look}, ${bg}`;
      check(bg === 'solid' || glass !== 'none', `${tag}: a question card without a menu keeps its glass`, glass);
      for (const [kind, sel, trigger] of [['a menu inside its question', '.gz-test-inline .dropdown-menu', '.gz-test-inline .dropdown-toggle'], ['a MUI Select kept in its question', '.MuiPopover-paper', '.MuiSelect-root']]) {
        // One menu open at a time, as a student opens them: MUI's Modal covers the page while its list is open.
        await page.evaluate((mui) => {
          const inline = document.querySelector('.gz-test-inline'), select = document.querySelector('.MuiSelect-root').parentElement.parentElement;
          inline.querySelector('.dropdown-menu').hidden = mui; inline.querySelector('[aria-haspopup]').setAttribute('aria-expanded', String(!mui));
          select.querySelector('.MuiPopover-root').hidden = !mui; select.querySelector('[aria-haspopup]').setAttribute('aria-expanded', String(mui));
        }, kind.includes('MUI'));
        await page.evaluate((t) => document.querySelector(t).scrollIntoView({ block: 'center', behavior: 'instant' }), trigger);
        // MUI places its list once, as it opens: after the scroll's own reflows (Glaze's title band folding) have settled.
        await page.evaluate((t) => new Promise((done) => { let last = '', same = 0, n = 0; const tick = () => { const r = document.querySelector(t).getBoundingClientRect(), k = `${r.left} ${r.bottom}`;
          same = k === last ? same + 1 : 0; last = k; if (same >= 10 || ++n > 300) done(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }), trigger);
        await page.evaluate(PLACE);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const p = await page.evaluate(PROBE, sel);
        check(p.outside, `${tag}: ${kind} reaches past its question`, p.at);
        check(!p.covered.length, `${tag}: ${kind} is on top of what is below it`, p.covered);
        if (kind.includes('MUI')) check(Math.abs(p.at.menu[0] - p.at.button[0]) <= 2 && Math.abs(p.at.menu[1] - p.at.button[1]) <= 2, `${tag}: ${kind} opens at its button`, p.at);
        await page.screenshot({ path: path.join(out, `${look.toLowerCase()}-${bg}-${kind.includes('MUI') ? 'select' : 'inline'}.png`) });
      }
    }
    check(!errors.length, 'no page errors', errors);
  } catch (e) {
    console.error(e);
    results.push({ pass: false, label: String(e) });
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
