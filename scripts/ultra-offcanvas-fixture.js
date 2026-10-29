// The native layer covers its backdrop and the underlying route. Its own sticky header contains the course strip.
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const D = require('../defaults.js');
module.exports = async ({ page, root, check, shot, navbarOnly = false }) => {
  const fixture = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-offcanvas.html'), 'utf8');
  await page.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/') ? r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }) : r.abort());
  await page.route('https://annotate-us.foundations.blackboard.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><label>Annotation <input id="annotation"></label><div style="height:1400px">Document</div>' }));
  const setup = async ({ width = 1800, rail = 'open', rtl = false, kind = 'submission', savedWidth = 352, editor = null } = {}) => {
    await page.setViewportSize({ width, height: 987 });
    await page.goto(`https://bb.school.test/ultra/courses/_101_1/${kind === 'submission' ? 'assessment/_7_1/overview/student-submission-view' : 'outline/edit/document/_9_1'}`);
    await page.setContent(fixture);
    await page.evaluate(({ rail, rtl, kind, editor }) => {
      document.documentElement.setAttribute('data-gz-navbar', `rail ${rail} float tabs`); document.documentElement.dir = rtl ? 'rtl' : 'ltr';
      if (kind !== 'submission') {
        document.querySelector('.student-view-submission-panel').classList.replace('student-view-submission-panel', kind);
        document.querySelector('main > aside').classList.add('outline-actions');
        document.querySelector('h1').textContent = kind;
      }
      window.nativeClicks = {};
      if (editor) { const el = document.createElement('div'); el.setAttribute(...editor); el.textContent = 'Rubric feedback'; document.querySelector('.rubric-inline-container').append(el); }
      for (const id of ['course-tab', 'layer-close', 'criterion-1', 'criterion-2']) document.getElementById(id).addEventListener('click', () => { nativeClicks[id] = (nativeClicks[id] || 0) + 1; });
      document.getElementById('rubric-detail').addEventListener('click', (e) => {
        e.preventDefault(); const back = document.createElement('div'); back.className = 'native-modal-backdrop'; back.id = 'native-modal-backdrop';
        const dialog = document.createElement('div'); dialog.className = 'native-modal'; dialog.id = 'native-modal'; dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = '<h2>Rubric detail</h2><button id="native-modal-close" type="button">Close detail</button>';
        dialog.querySelector('button').onclick = () => { back.remove(); dialog.remove(); };
        document.body.append(back, dialog); dialog.querySelector('button').focus();
      });
      window.originalViewer = document.querySelector('iframe'); window.originalParent = originalViewer.parentNode; window.originalSrc = originalViewer.getAttribute('src');
      window.viewerLoads = 0; originalViewer.addEventListener('load', () => viewerLoads++);
      window.nativeParents = [...document.querySelectorAll('#site-wrap *')].map((e) => [e, e.parentNode]);
    }, { rail, rtl, kind, editor });
    for (const file of ['theme.css', 'features/coursetabs.css', 'features/apps.css', 'features/sidebar.css', 'features/docreview.css']) {
      const sheet = await page.addStyleTag({ path: path.join(root, file) });
      if (file === 'theme.css') await sheet.evaluate((e) => e.id = 'fixture-theme');
    }
    await page.frameLocator('iframe').locator('#annotation').fill('Kept annotation');
    await page.evaluate(() => {
      window.viewerLoads = 0;
      window.nativeBytes = document.querySelector('#site-wrap').innerHTML;
      window.viewerWidth = document.querySelector('main > section').getBoundingClientRect().width;
      window.rubricBytes = document.querySelector('main > aside').outerHTML;
    });
    if (navbarOnly) return;
    for (const file of ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js', 'lib/widgets.js', 'lib/sidebar.js']) await page.addScriptTag({ path: path.join(root, file) });
    await page.evaluate(({ settings, savedWidth }) => {
      window.SET = settings;
      const key = GZ_SIDEBAR.key('ultra', location.origin, '_42_1');
      const store = { [key]: GZ_SIDEBAR.clean({ mig: 1, width: savedWidth, chose: { width: true }, dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) };
      const get = (keys, cb) => cb(Object.fromEntries([keys].flat().map((k) => [k, store[k]])));
      window.chrome = { storage: { local: { get, set: (v, cb) => { Object.assign(store, v); cb?.(); } }, sync: { get: (keys, cb) => cb({ widgets: SET.widgets }) }, onChanged: { addListener() {}, removeListener() {} } }, runtime: { id: 'fixture', getURL: () => 'data:text/css,', getManifest: () => ({ version: '0' }), sendMessage: (m, cb) => {
        if (m.type === 'glaze:sidebar') store[key] = GZ_SIDEBAR.apply(store[key], m.ops, { lms: 'ultra' });
        if (m.type === 'glaze:notes') store[m.key] = { text: m.text, at: m.at };
        cb({ ok: true, note: store[m.key] });
      } } };
      window.GZ_I18N = { locale: () => 'en' }; window.GZ_ULTRA = { page: { profile: async () => ({ id: '_42_1', time_zone: 'UTC' }) } };
      window.GZ_CTX = { site: 'ultra', t: (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? ''), locale: () => 'en', on: () => true, need: async (file, read) => read?.(), account: async () => '_42_1', courseId: () => '_101_1', settings: () => SET };
    }, { settings: D.GZ_SANITIZE({ enhance: { sidebar: true, notes: true, widgets: true, todo: false, pet: false, dashboard: false }, sidebar: { style: 'float' } }), savedWidth });
    await page.addScriptTag({ path: path.join(root, 'features/sidebar.js') });
    await page.evaluate(async () => { GZ_SIDEBAR_UI.sync(true); await GZ_SIDEBAR_UI.ready(); });
    await page.addScriptTag({ path: path.join(root, 'features/widgets.js') });
    await page.evaluate(() => GZ_WIDGETS_UI.sync(true));
    await page.waitForSelector('[data-tile="notes"]', { state: 'attached' });
    await page.waitForTimeout(150);
    await page.evaluate(() => GZ_SIDEBAR_UI.sync(true));
    await page.waitForTimeout(100);
  };
  const report = () => page.evaluate(() => {
    const layer = document.querySelector('.bb-offcanvas-panel'), wrap = layer.firstElementChild, rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gz-navbar-left')) || 0, rtl = document.documentElement.dir === 'rtl';
    const l = rect(layer), w = rect(wrap), viewer = rect(document.querySelector('main > section'));
    const points = [rail + 8, (innerWidth + rail) / 2, innerWidth - 8].flatMap((x) => [20, 110, 450, innerHeight - 40].map((y) => [rtl ? innerWidth - x : x, y]));
    const hits = points.map(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (layer.contains(e) || e.closest('#gz-sidebar, .gz-sb-launch, .gz-sb-edge, #gz-footer, #gz-navbar')); });
    const tab = document.querySelector('#course-tab'), close = document.querySelector('#layer-close'), tr = rect(tab), cr = rect(close);
    const hit = (e) => { const r = rect(e); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); };
    const host = document.querySelector('[data-gz-sidebar-host]'), rubric = document.querySelector('main > aside'), rr = rect(rubric), hr = host && rect(host);
    return { l, w, rail, viewer, wider: viewer.width + 1 >= viewerWidth, hits: hits.every(Boolean), tab: hit(tab), close: hit(close), separate: rtl ? tr.right <= cr.x : tr.x >= cr.right,
      mode: document.documentElement.dataset.gzSidebar, projected: !!document.getElementById('gz-sb-absorb'), hr, rr,
      inside: !!hr && rr.x >= hr.x && rr.right <= hr.right && rr.y >= hr.y && rr.bottom <= hr.bottom,
      native: rubric.outerHTML === rubricBytes, unchanged: nativeParents.every(([e, p]) => e.isConnected && e.parentNode === p) && document.querySelector('iframe') === originalViewer && originalViewer.parentNode === originalParent && originalViewer.getAttribute('src') === originalSrc && viewerLoads === 0 };
  });
  for (const width of [1800, 1280]) for (const rail of ['open', 'icons']) for (const rtl of [false, true]) {
    await setup({ width, rail, rtl });
    const r = await report(), tag = `${width} ${rail} ${rtl ? 'RTL' : 'LTR'}`;
    check(r.l.x === 0 && r.l.y === 0 && r.l.width === width, `${tag}: full-window layer keeps covering the page and native backdrop`);
    check(r.hits, `${tag}: hit-testing exposes no backdrop or underlying header`);
    check(rtl ? Math.abs(r.w.right - (width - r.rail)) < 1 : r.w.x === r.rail, `${tag}: content starts after the rail`);
    check(r.tab && r.close && r.separate, `${tag}: the strip and native close both receive clicks without overlap`);
    if (navbarOnly) continue;
    const expected = width === 1280 && rail === 'open' ? 'drawer' : 'expanded';
    check(r.mode === expected, `${tag}: ${expected} mode`);
    check(r.wider, `${tag}: viewer stays at least as wide as the native Rubric layout (${r.viewer.width})`);
    check(r.unchanged && r.native, `${tag}: native Rubric bytes, hierarchy and iframe identity/src are unchanged`);
    if (expected === 'expanded') {
      check(r.projected && r.inside, `${tag}: Rubric criterion cards render inside This page`);
      check(await page.locator('[data-gz-sidebar-host]').evaluate((host) => {
        const r = host.getBoundingClientRect(), rubric = document.querySelector('main > aside');
        return [8, r.width / 2, r.width - 8].every((x) => [16, r.height / 3, r.height * 2 / 3, r.height - 16].every((y) => {
          const e = document.elementFromPoint(r.left + x, r.top + y); return host.contains(e) || rubric.contains(e);
        }));
      }), `${tag}: sidebar chrome and native Rubric are topmost across the card`);
      check(await page.locator('#criterion-1').evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `${tag}: criterion controls are topmost at their visual positions`);
      check(await page.locator('main > aside').evaluate((e) => {
        const r = e.getBoundingClientRect(), host = document.querySelector('[data-gz-sidebar-host]'), y = r.top + r.height / 2;
        return [r.left + 0.5, r.right - 0.5].every((x) => e.contains(document.elementFromPoint(x, y))) && [r.left - 1.5, r.right + 1.5].every((x) => host.contains(document.elementFromPoint(x, y)));
      }), `${tag}: the card opens exactly on the native Rubric`);
      if (r.projected) {
        await page.locator('#criterion-1').click(); await page.locator('#criterion-1').focus(); await page.keyboard.press('Enter');
        check(await page.evaluate(() => nativeClicks['criterion-1'] === 2), `${tag}: native pointer and keyboard handlers still work`);
        await page.locator('.gz-w-note-view').click(); await page.locator('.gz-w-note').fill('A sidebar draft');
        check(await page.locator('.gz-w-note').inputValue() === 'A sidebar draft', `${tag}: My widgets remains interactive above the layer`);
      }
    } else check(!r.projected && r.native, `${tag}: drawer mode restores the native Rubric`);
  }
  for (const width of [1800, 800]) {
    await setup({ width });
    if (width === 800) {
      const r = await report();
      check(r.w.x === 0 && r.w.width === width && Math.abs(r.l.bottom - r.w.bottom - 96) < 1, 'mobile: only the content clears the bottom bar');
      check(r.hits, 'mobile: the full-window layer still covers the native backdrop');
    } else {
      await page.evaluate(() => document.documentElement.setAttribute('data-gz-navbar', 'top float tabs'));
      const r = await report();
      check(r.w.x === 0 && r.w.y === 80 && r.l.y === 0 && r.hits, 'top bar: only the content moves below the bar');
    }
    await page.evaluate(() => { document.documentElement.setAttribute('data-gz-review-immersive', ''); window.GZ_SIDEBAR_UI?.cover(); });
    await page.waitForTimeout(100);
    const immersive = await report();
    check(immersive.w.x === 0 && immersive.w.y === 0 && immersive.w.width === width && immersive.w.bottom === immersive.l.bottom, `${width}: immersive content clears no hidden bars`);
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-gz-review-focus', '');
      originalViewer.parentNode.setAttribute('data-gz-review-part', 'pane'); originalViewer.setAttribute('data-gz-review-part', 'frame');
    });
    check(await page.locator('iframe').evaluate((e) => { const r = e.getBoundingClientRect(); return r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight - 60; }), `${width}: focus pane still reaches both viewport edges`);
  }
  if (navbarOnly) return;
  for (const editor of [['contenteditable', ''], ['contenteditable', 'plaintext-only'], ['role', 'textbox'], ['role', 'combobox']]) {
    await setup({ editor });
    const r = await report();
    check(!r.projected && r.mode === 'drawer' && r.native, `${editor.join('=')}: editable Rubric stays native`);
  }
  await setup();
  await shot('rubric-integrated');
  for (const how of ['off', 'absorb', 'fold', 'focus', 'immersive', 'print', 'scroll', 'rerender', 'overflow', 'modal']) {
    await setup();
    check((await report()).projected, `${how}: starts integrated`);
    if (!(await report()).projected) continue;
    if (how === 'off') await page.evaluate(() => GZ_SIDEBAR_UI.sync(false));
    if (how === 'absorb') await page.evaluate(() => { SET.sidebar.absorb = false; GZ_SIDEBAR_UI.sync(true); });
    if (how === 'fold') await page.locator('#gz-sb-ph').click();
    if (how === 'focus' || how === 'immersive') await page.evaluate((how) => { document.documentElement.setAttribute(`data-gz-review-${how}`, ''); GZ_SIDEBAR_UI.cover(); }, how);
    if (how === 'print') { await page.evaluate(() => dispatchEvent(new Event('beforeprint'))); await page.emulateMedia({ media: 'print' }); }
    if (how === 'scroll') await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    if (how === 'rerender') await page.evaluate(() => document.querySelector('#criterion-2').setAttribute('aria-expanded', 'true'));
    if (how === 'overflow') await page.evaluate(() => { const e = document.createElement('p'); e.style.height = '2000px'; document.querySelector('.rubric-inline-container').append(e); });
    if (how === 'modal') await page.locator('#rubric-detail').click();
    await page.waitForTimeout(100);
    check(!(await report()).projected, `${how}: native Rubric restored immediately`);
    if (!['rerender', 'overflow'].includes(how)) check((await report()).native, `${how}: native attributes and inline styles restored byte for byte`);
    if (how === 'modal') {
      check(await page.locator('#native-modal-close').evaluate((e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; }), 'native rubric dialog stacks above sidebar and remains clickable');
      await page.locator('#native-modal-close').click();
    }
    if (how === 'print') await page.emulateMedia({ media: 'screen' });
  }
  for (const kind of ['course-document', 'attachment-preview', 'document-viewer']) {
    await setup({ kind });
    check((await report()).mode === 'drawer', `${kind}: native document column uses the existing drawer`);
    if ((await report()).mode === 'drawer') {
      await page.locator('.gz-sb-launch').click();
      check(await page.locator('#criterion-1').evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `${kind}: This page is usable in place`);
      await page.locator('.gz-w-note-view').click(); await page.locator('.gz-w-note').fill('Document draft');
      check(await page.locator('.gz-w-note').inputValue() === 'Document draft', `${kind}: My widgets accepts a draft`);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { GZ_WIDGETS_UI.sync(false); GZ_SIDEBAR_UI.sync(false); });
    check(await page.evaluate(() => document.querySelector('#site-wrap').innerHTML === nativeBytes), `${kind}: teardown restores every native byte`);
  }
  await setup();
  await page.addScriptTag({ path: path.join(root, 'features/docreview.js') });
  await page.evaluate(() => GZ_DOCREVIEW.sync(true));
  await page.waitForSelector('#gz-review-focus');
  check(await page.evaluate(() => document.documentElement.hasAttribute('data-gz-review-compact') && document.querySelector('#layer-close').dataset.gzReviewPart === 'close'), 'integrated review recognizes the native close beside the course strip');
  check(await page.evaluate(() => {
    const strip = document.querySelector('#gz-ctabs').getBoundingClientRect(), grade = document.querySelector('[data-gz-review-part="grade"]').getBoundingClientRect();
    return strip.bottom <= grade.top || strip.top >= grade.bottom;
  }), 'compact review keeps the course strip clear of the grade row');
  await page.locator('#gz-review-focus').click();
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-review-immersive'));
  check(await page.evaluate(() => !document.getElementById('gz-sb-absorb') && !document.querySelector('[data-gz-sidebar-host]')?.getClientRects().length), 'integrated focus releases Rubric absorption and suspends the sidebar');
  check(await page.locator('iframe').evaluate((e) => { const r = e.getBoundingClientRect(); return r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight - 60; }), 'integrated immersive viewer uses the full window above its focus toolbar');
  await page.locator('#gz-review-rubric').click();
  await page.locator('#criterion-1').click();
  check(await page.evaluate(() => nativeClicks['criterion-1'] === 1), 'native Rubric controls remain clickable in integrated focus');
  await page.locator('#gz-review-rubric').click();
  await page.locator('#gz-review-exit').click();
  await page.waitForFunction(() => !GZ_SIDEBAR_UI.asleep() && !document.documentElement.hasAttribute('data-gz-review-immersive'));
  check(await page.evaluate(() => ['[data-gz-sidebar-host]', '.gz-sb-launch', '.gz-sb-edge'].some((s) => document.querySelector(s)?.getClientRects().length)), 'leaving integrated focus restores navigation and the sidebar or its native fallback launcher');
  await page.evaluate(() => { GZ_DOCREVIEW.sync(false); GZ_WIDGETS_UI.sync(false); GZ_SIDEBAR_UI.sync(false); });
  check(await page.evaluate(() => document.querySelector('#site-wrap').innerHTML === nativeBytes), 'integrated teardown restores every native byte');
  const legacyTheme = execFileSync('git', ['show', '58e4a973:theme.css'], { cwd: root, encoding: 'utf8' });
  for (const width of [1800, 800]) for (const nav of ['rail open float tabs', 'top float tabs', null]) {
    await setup({ width });
    await page.evaluate((nav) => {
      GZ_WIDGETS_UI.sync(false); GZ_SIDEBAR_UI.sync(false);
      if (nav) document.documentElement.setAttribute('data-gz-navbar', nav); else document.documentElement.removeAttribute('data-gz-navbar');
    }, nav);
    const measure = () => page.evaluate(() => Object.fromEntries(['.bb-offcanvas-panel', '.bb-offcanvas-panel-wrap', 'main > section', 'main > aside', '#layer-close', '#course-tab'].map((s) => {
      const r = document.querySelector(s).getBoundingClientRect(); return [s, [r.x, r.y, r.width, r.height]];
    })));
    const current = await measure();
    const currentTheme = await page.locator('#fixture-theme').textContent();
    await page.locator('#fixture-theme').evaluate((e, text) => e.textContent = text, legacyTheme);
    const legacy = await measure();
    await page.locator('#fixture-theme').evaluate((e, text) => e.textContent = text, currentTheme);
    const expected = structuredClone(legacy), left = nav?.startsWith('rail') && width >= 900 ? 272 : 0;
    const top = nav?.startsWith('top') && width >= 900 ? 80 : 0, bottom = nav && width < 900 ? 96 : 0;
    if (nav) {
      for (const s of ['.bb-offcanvas-panel-wrap', 'main > section']) { expected[s][0] += left; expected[s][1] += top; expected[s][2] -= left; expected[s][3] -= top + bottom; }
      expected['main > aside'][1] += top; expected['main > aside'][3] -= top + bottom;
      expected['#layer-close'][0] += left; expected['#layer-close'][1] += top;
      expected['#course-tab'][0] += left + 48; expected['#course-tab'][1] += top;
    }
    const tag = `off equals legacy ${width} ${nav || 'navbar off'}`;
    check(Object.keys(expected).every((s) => expected[s].every((v, i) => Math.abs(v - current[s][i]) < 1)), `${tag}: ${nav ? 'only the named navbar-room exception' : 'exact main geometry'}`);
    check(await page.evaluate(() => ![...document.documentElement.attributes].some((a) => /^data-gz-(?:sidebar|sb-|review)/.test(a.name))
      && !getComputedStyle(document.documentElement).getPropertyValue('--gz-sb-room').trim()
      && !document.querySelector('#gz-sb-absorb, [data-gz-review-part], [data-gz-review-ui], [data-gz-sidebar-host]')
      && document.querySelector('#site-wrap').innerHTML === nativeBytes), `${tag}: no sidebar room, Rubric projection or document-review attributes`);
  }
};
