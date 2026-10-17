// The editor's builders for a Look's nav layout and page tweaks (lib/editor-xparts.js), headless, in the real unpacked
// extension: options.html with the real options.js and its preview frame. Nothing reaches the network.
//   - "Start from my navigation" makes the Look's layout and saves it as the Look's parts; Glaze settings has no Hide.
//   - Hide, keyboard reordering (focus stays on the handle, the move is announced), placement and a link are saved and
//     reach Blackboard's real rail in the preview; a bad link is refused; Canvas shows the order it lands in.
//   - Page tweaks: a Canvas restyle and hide reach the Canvas preview through features/rules.js, an Ultra hide reaches the
//     Ultra preview, a part that holds Glaze settings can't be hidden, and removing a tweak takes it off.
//   - Every control the builders draw has a name; removing the layout and the tweaks leaves no parts.
// EXT=/path/to/checkout NODE_PATH=/path/to/playwright/node_modules nice node scripts/xparts-editor-check.js
// One browser at a time (wait while another agent's run is up); it deletes its own profile when it is done.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const ext = process.env.EXT || path.resolve(__dirname, '..');
const X = require(path.join(ext, 'lib/lookparts.js'));
const chromePath = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const until = async (fn, ok = (v) => v, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (ok(v)) return v; } catch { /* the frame is reloading */ } await new Promise((r) => setTimeout(r, 50)); } throw new Error('Timed out waiting for editor or preview state'); };

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-xparts-editor-'));
  let fails = 0, context;
  const errors = [], external = [];
  const check = (name, pass, detail = '') => { if (!pass) fails++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : ` ${detail}`}`); };
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(scratch, { executablePath: chromePath, headless: true, viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-webgl', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await context.route('**/*', (route) => { const url = route.request().url(); if (url.startsWith('chrome-extension:') || url.startsWith('data:')) return route.continue(); external.push(url); return route.abort(); });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    // The Look's parts as stored: the packed sync item, unpacked here.
    const parts = async () => { const { lookX } = await sw.evaluate(() => chrome.storage.sync.get('lookX')); return typeof lookX === 'string' && lookX ? X.unpack(lookX) : null; };
    const ed = await context.newPage();
    ed.on('pageerror', (e) => errors.push(`editor: ${e}`));
    await ed.goto(`chrome-extension://${id}/options.html#look/nav-layout`);
    const frame = () => ed.frames().find((f) => f.url().includes('preview.html'));
    const inFrame = (f, arg) => until(() => frame().evaluate(f, arg));
    await until(() => ed.evaluate(() => !!document.querySelector('[data-f="nav:mine"]')));
    check('the section has a heading and says how it differs from the student’s own navigation', await ed.evaluate(() => document.querySelector('#heading-look-nav-layout').textContent === "This Look's navigation" && /stays yours on every Look/.test(document.querySelector('#xnav').textContent)));

    // ---- nav layout ------------------------------------------------------------------------------------------------
    await ed.click('[data-f="nav:mine"]');
    let P = await until(parts, (v) => v?.x?.nav);
    check('Start from my navigation saves the Look’s layout', P?.x?.nav?.place === 'left' && P.x.nav.groups[0].items.includes('glaze'), JSON.stringify(P));
    check('Glaze settings has no Hide and says it is always shown', await ed.evaluate(() => !document.querySelector('[data-f="glaze:hide"]') && [...document.querySelectorAll('#xnav li')].some((li) => /Glaze settings/.test(li.textContent) && /Always shown/.test(li.textContent))));
    await ed.click('[data-f="calendar:hide"]');
    P = await until(parts, (v) => v?.x?.nav?.hidden?.includes('calendar'));
    check('Hide saves the item as hidden', !!P);
    check('the preview’s real Blackboard rail hides it', await inFrame(() => document.querySelector('[data-gz-nav-id="calendar"]')?.hidden === true, null) === true);
    const before = P.x.nav.groups[0].items, at = before.indexOf('grades');
    await ed.focus('[data-f="grades:drag"]');
    await ed.keyboard.press('ArrowUp');
    P = await until(parts, (v) => v?.x?.nav?.groups[0].items.indexOf('grades') === at - 1);
    check('ArrowUp on a handle moves the item up and saves it', !!P, JSON.stringify(P?.x?.nav?.groups));
    check('focus stays on the handle after the redraw', await ed.evaluate(() => document.activeElement?.dataset.f) === 'grades:drag');
    check('the move is announced', /Grades: position \d+ of \d+ in Group 1\./.test(await until(() => ed.textContent('#xnav-status'), (v) => /position/.test(v))));
    await ed.selectOption('[data-f="nav:place"]', 'dock');
    await until(parts, (v) => v?.x?.nav?.place === 'dock');
    check('placement reaches the preview', await inFrame(() => document.documentElement.getAttribute('data-gz-nav-place'), null) === 'dock');
    await ed.fill('[data-f="link:name"]', 'Library');
    await ed.fill('[data-f="link:url"]', 'javascript:alert(1)');
    await ed.click('[data-f="link:save"]');
    check('a link the cleaner refuses is not saved, and says why', /http/.test(await ed.textContent('#xnav [role="alert"]')) && !(await parts()).x.nav.links?.length);
    await ed.fill('[data-f="link:url"]', 'https://library.example.edu/');
    await ed.click('[data-f="link:save"]');
    P = await until(parts, (v) => v?.x?.nav?.links?.length === 1);
    check('a good link is saved', P?.x?.nav?.links?.[0]?.u === 'https://library.example.edu/');
    const linkId = P.x.nav.links[0].id;
    P.x.nav.icons = { ...P.x.nav.icons, [`link:${linkId}`]: 'star' };
    const imported = await X.pack(P);
    await sw.evaluate((lookX) => chrome.storage.sync.set({ lookX }), imported);
    await until(() => ed.inputValue(`[data-f="link:${linkId}:icon"]`), (v) => v === 'star');
    check('an imported link icon override is shown in its picker', true);
    await ed.selectOption(`[data-f="link:${linkId}:icon"]`, 'video');
    P = await until(parts, (v) => (v?.x?.nav?.icons?.[`link:${linkId}`] || v?.x?.nav?.links?.[0]?.i) === 'video');
    check('editing an imported link icon changes the effective icon', true);
    await ed.click('[data-f="nav:group"]'); await ed.click('[data-f="nav:group"]');
    await ed.focus('[data-f="group0:down"]'); await ed.keyboard.press('Enter');
    check('group focus follows the first move', await ed.evaluate(() => document.activeElement?.dataset.f) === 'group1:down');
    await ed.keyboard.press('Enter');
    P = await until(parts, (v) => v?.x?.nav?.groups?.[2]?.items.includes('grades'));
    check('a repeated group move follows the same group', await ed.evaluate(() => document.activeElement?.dataset.f) === 'group2:down');
    await ed.click('[data-f="group2:up"]'); await ed.keyboard.press('Enter');
    await ed.click('label:has(> input[name="xnav-site"][value="canvas"])');
    check('the Canvas switch moves the preview and lists the order it lands in', !!await until(() => frame().url().includes('site=canvas')) && await ed.evaluate(() => /can’t draw this layout on Canvas/.test(document.querySelector('#xnav').textContent) && document.querySelectorAll('#xnav ol:not(.nav-editor-list) li').length > 3));

    // ---- page tweaks --------------------------------------------------------------------------------------------------
    await ed.goto(`chrome-extension://${id}/options.html#look/rules`);
    await until(() => ed.evaluate(() => !!document.querySelector('[data-f="rule:part"]')));
    await ed.click('label:has(> input[name="xrules-site"][value="canvas"])');
    await until(() => frame().url().includes('site=canvas'));
    await ed.selectOption('[data-f="rule:part"]', 'canvas.dashboard-card.title');
    await ed.selectOption('[data-f="rule:act"]', 'style');
    await ed.selectOption('[data-f="rule:st:fg"]', 'accent');
    await ed.click('[data-f="rule:add"]');
    P = await until(parts, (v) => v?.x?.rules?.length === 1);
    check('a Canvas restyle is saved, cleaned', JSON.stringify(P?.x?.rules) === '[{"p":"canvas.dashboard-card.title","do":"style","st":{"fg":"accent"}}]', JSON.stringify(P?.x?.rules));
    check('the Canvas preview wears it through features/rules.js', await inFrame(() => document.querySelector('.ic-DashboardCard__header-title')?.getAttribute('data-gz-r-st'), null) === 'fg');
    await ed.selectOption('[data-f="rule:part"]', 'canvas.dashboard-card.subtitle');
    await ed.selectOption('[data-f="rule:act"]', 'hide');
    await ed.click('[data-f="rule:add"]');
    await until(parts, (v) => v?.x?.rules?.length === 2);
    check('the rule reads in plain words, with a counter, and the add is announced', await until(() => ed.evaluate(() => [...document.querySelectorAll('#xrules li')].some((li) => /Hide: Canvas · Course card code/.test(li.textContent)) && /2 of 64 tweaks/.test(document.querySelector('#xrules').textContent) && /Added: Hide: Canvas/.test(document.querySelector('#xrules-status').textContent))));
    check('the hide reaches the preview', await inFrame(() => document.querySelector('.ic-DashboardCard__header-subtitle')?.hasAttribute('data-gz-r-hide'), null) === true);
    await ed.click('label:has(> input[name="xrules-site"][value="ultra"])');
    await until(() => frame().url().includes('site=ultra'));
    await ed.selectOption('[data-f="rule:part"]', 'ultra.nav');
    check('the part that holds Glaze settings can’t be hidden, and the editor says so', await ed.evaluate(() => document.querySelector('[data-f="rule:act"] option[value="hide"]').disabled && /can’t be hidden/.test(document.querySelector('#xrules').textContent)));
    await ed.selectOption('[data-f="rule:part"]', 'ultra.course-card.status');
    await ed.selectOption('[data-f="rule:act"]', 'hide');
    await ed.click('[data-f="rule:add"]');
    await until(parts, (v) => v?.x?.rules?.length === 3);
    check('an Ultra hide reaches the Ultra preview’s real runtime', await inFrame(() => [...document.querySelectorAll('article.course-element-card .course-status')].every((e) => e.hasAttribute('data-gz-r-hide')) && !!document.querySelector('.course-status'), null) === true);
    await ed.focus('[data-f="r2:drag"]'); await ed.keyboard.press('ArrowUp');
    check('rule focus follows the first move', await ed.evaluate(() => document.activeElement?.dataset.f) === 'r1:drag');
    await ed.keyboard.press('ArrowUp');
    P = await until(parts, (v) => v?.x?.rules?.[0]?.p === 'ultra.course-card.status');
    check('a repeated rule move follows the same tweak', await ed.evaluate(() => document.activeElement?.dataset.f) === 'r0:drag');
    await ed.keyboard.press('ArrowDown'); await ed.keyboard.press('ArrowDown');
    await ed.click('[data-f="r0:remove"]');
    P = await until(parts, (v) => v?.x?.rules?.length === 2);
    check('focus stays in the tweak list after removal', await ed.evaluate(() => document.activeElement?.dataset.f) === 'r0:remove');
    check('Remove takes a tweak off and is announced', P?.x?.rules?.[0]?.do === 'hide' && /Removed: Restyle/.test(await until(() => ed.textContent('#xrules-status'), (v) => /Removed/.test(v))));

    // ---- names, and removing everything ---------------------------------------------------------------------------------
    await ed.goto(`chrome-extension://${id}/options.html#look/nav-layout`);
    await until(() => ed.evaluate(() => !!document.querySelector('[data-f="nav:remove"]')));
    const unnamed = await ed.evaluate(() => [...document.querySelectorAll('#xnav :is(select, input, button), #xrules :is(select, input, button)')].filter((e) => !(e.labels?.length || e.getAttribute('aria-label') || e.textContent.trim() || e.closest('label'))).map((e) => e.outerHTML.slice(0, 80)));
    check('every control the builders draw has a name', !unnamed.length, JSON.stringify(unnamed));
    await ed.click('[data-f="nav:remove"]');
    await until(parts, (v) => !v?.x?.nav);
    for (let i = 0; i < 2; i++) { await ed.click('#xrules [data-f="r0:remove"]'); await until(parts, (v) => (v?.x?.rules?.length || 0) === 1 - i); }
    const left = await sw.evaluate(() => chrome.storage.sync.get('lookX'));
    check('with the layout and the tweaks removed the Look has no parts', left.lookX === '', JSON.stringify(left));
    check('no page errors', !errors.length, errors.join(' | '));
    check('nothing reached the network', !external.length, external.join(' '));
  } catch (e) { fails++; console.log(`FAIL run: ${e.stack || e}`); }
  finally { await context?.close().catch(() => {}); fs.rmSync(scratch, { recursive: true, force: true }); }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})();
