// The Looks catalogue in headless Chrome with the real unpacked extension, its worker, Settings and the popup (lib/looks.js):
// a saved Look and a gallery Look kept in storage show in Settings' Look picker, grouped, with their swatches; picking each
// wears it (the page's own colours) and the popup's tile names it; a gallery Look used from its offer joins the gallery's; a
// Look saved from Settings shows at once, pressed, here and in a second Settings tab without a reload; a course wears it;
// removing it takes it from every list and the course goes back to the student's theme. On a course page (a synthetic Ultra
// shell): a course wears its saved Look, one this device doesn't keep falls back to the theme, and Ctrl+K lists and wears the
// kept Looks. Screenshots at 1280 and 640 wide, in a light and a dark Look.
// NODE_PATH=<installed playwright> nice node scripts/looks-catalog-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');
const G = require('../defaults.js');
const S = require('../lib/share.js');
const C = require('../lib/looks.js');
const site = 'https://bb.school.test';
const ext = require('./check-env.js').staged(root, [`${site}/*`]);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Polled from Node: waitForFunction resolves at once on an async predicate.
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn().catch(() => false); if (v) return v; await pause(100); }
  return false;
};
const failures = [];
let checks = 0;
const check = (ok, name, detail = '') => {
  checks++; console.log(`${ok ? 'ok' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures.push(name);
};
const look = (name) => G.GZ_LOOKS.find((L) => L.name === name);
const wear = (name) => G.GZ_SANITIZE({ ...G.GZ_DEFAULTS, ...G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, look(name)) });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-looks-check-'));
  const out = process.argv[2];
  if (out) fs.mkdirSync(out, { recursive: true });
  let ctx;
  const errors = [];
  try {
    // A light Look the student saved, a dark animated one from the gallery, one more the gallery offers, one pasted to save.
    const seminar = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Rose'), look: { font: 'nunito', radius: 18 }, bg: { kind: 'gradient', style: 'mesh', colors: ['#f9a8d4', '#c4b5fd', '#fde68a'] } });
    const night = wear('Graveyard');
    const sunset = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Ember'), look: { radius: 12 }, bg: { kind: 'gradient', colors: ['#f97316', '#ef4444', '#facc15'] } });
    const field = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Forest'), look: { radius: 4 }, bg: { kind: 'solid' } });
    const codes = { seminar: await S.encode(seminar, {}), night: await S.encode(night, {}, { x: { pointer: 'ghost' } }), sunset: await S.encode(sunset, {}), field: await S.encode(field, {}),
      // A gallery Look whose background is a shader, with its own pointer.
      shader: await S.encode(G.GZ_SANITIZE({ colors: G.GZ_PRESET('Midnight'), bg: { kind: 'shader' } }), {}, { x: { bg: { shader: { src: fs.readFileSync(path.join(root, 'assets/shaders/aurora.glsl'), 'utf8') } }, pointer: 'lava' } }) };
    const kept = [C.make(codes.seminar, 'Seminar', '', 'saved'), C.make(codes.night, 'Night walk', 'frostdev-ops', 'gallery')];
    const ids = { seminar: kept[0].id, night: kept[1].id, sunset: C.idOf(codes.sunset), field: C.idOf(codes.field) };

    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    ctx.setDefaultTimeout(10000);
    require('./check-env.js').noFirstRun(ctx);
    // The school's pages are the synthetic Ultra shell; everything else (web fonts) is blocked: the check reads colours.
    const shell = fs.readFileSync(path.join(root, 'test/fixtures/ultra-course.html'), 'utf8');
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: shell });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ json: { id: '_42_1' } });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ json: { results: [] } });
      if (u.origin === 'https://cdn.school.test') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(sw.url()).host}`;
    const open = async (hash = 'look/palette') => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`${p.url()}: ${e}`));
      await p.goto(`${base}/options.html#${hash}`);
      await p.locator('#looks button').first().waitFor();
      return p;
    };
    const a = await open();
    await a.evaluate(async ({ kept }) => {
      await chrome.storage.local.set({ lookFavorites: kept, seenCourses: { _101_1: { name: 'Biology 101', slot: '2', org: false } } });
    }, { kept });
    const catalog = () => a.evaluate(async () => (await chrome.storage.local.get('lookCatalog')).lookCatalog);
    check(await until(async () => (await catalog())?.looks?.length === 2), 'the worker builds the catalogue from the kept Looks');
    const cat = await catalog();
    check(cat.looks.map((E) => `${E.name}:${E.kind}`).join() === 'Seminar:saved,Night walk:background', 'a saved Look, and the gallery\'s animated background as a Look', JSON.stringify(cat.looks.map((E) => [E.name, E.kind])));

    // ---- the picker: grouped, with swatches ----
    const picker = (p) => p.locator('#looks').evaluate((box) => [...box.children].map((el) => (el.tagName === 'H4' ? `# ${el.textContent}` : `${el.textContent}|${el.dataset.look}|${el.getAttribute('aria-pressed')}|${el.style.background}`)));
    const shown = await until(async () => { const l = await picker(a); return l.includes(`# Saved`) && l.some((x) => x.startsWith('Night walk|')) && l; });
    check(!!shown, 'the picker shows the kept Looks without a reload', JSON.stringify(await picker(a)));
    const heads = (shown || []).filter((x) => x.startsWith('# '));
    check(heads.join() === '# Built in,# Saved,# Gallery', 'three groups, each with a heading', heads.join());
    const at = (name) => (shown || []).findIndex((x) => x.startsWith(`${name}|`));
    check(at('Seminar') > (shown || []).indexOf('# Saved') && at('Night walk') > (shown || []).indexOf('# Gallery') && at('Frostdev') < (shown || []).indexOf('# Saved'), 'each under its own heading');
    const seminarCard = (shown || []).find((x) => x.startsWith('Seminar|')) || '';
    check(seminarCard.includes(ids.seminar) && /rgb\(249, 168, 212\)|#f9a8d4/i.test(seminarCard), 'a kept Look\'s card has its id and its swatch colours', seminarCard);

    // ---- picking each wears it; the popup's tile names it ----
    const ink = (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-ink').trim());
    const surface = (p) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gz-surface').trim());
    const popupName = async () => {
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(`popup: ${e}`));
      await p.goto(`${base}/popup.html`);
      const name = await until(async () => { const n = (await p.locator('#look-name').textContent()).trim(); return n && n !== 'Your theme' ? n : ''; }, 3000) || (await p.locator('#look-name').textContent()).trim();
      await p.close();
      return name;
    };
    const card = (p, id) => p.locator(`#looks .look[data-look="${id}"]`);
    for (const [name, id, s] of [['Seminar', ids.seminar, seminar], ['Night walk', ids.night, night]]) {
      await card(a, id).click();
      const worn = await until(async () => (await ink(a)) === s.colors['--gz-ink'] && (await surface(a)) === s.colors['--gz-surface']);
      check(worn, `picking ${name} wears it: the page's own colours are its palette`, `${await ink(a)} ${await surface(a)}`);
      check(await until(async () => (await card(a, id).getAttribute('aria-pressed')) === 'true'), `${name} is pressed`);
      check(await a.locator('#looks .look[aria-pressed="true"]').count() === 1, 'one Look pressed');
      // Key by key: Chrome hands a stored object back with its keys sorted.
      const stored = await a.evaluate(async () => (await chrome.storage.sync.get('colors')).colors);
      check(Object.keys(s.colors).every((k) => stored?.[k] === s.colors[k]), `${name}'s palette is saved`, JSON.stringify(stored));
      check(await popupName() === name, `the popup's Look tile names ${name}`);
    }
    check(await a.evaluate(async () => !!(await chrome.storage.sync.get('lookX')).lookX), 'Night walk\'s parts (its pointer) were worn with it');

    // ---- the popup's sheet lists them too, and wears a kept one through the worker ----
    const pop = await ctx.newPage();
    pop.on('pageerror', (e) => errors.push(`popup: ${e}`));
    await pop.setViewportSize({ width: 360, height: 600 }); // the popup's own size
    await pop.goto(`${base}/popup.html`);
    await pop.locator('#look').click();
    const sheet = await pop.locator('#sheet #looks').evaluate((box) => [...box.children].map((el) => (el.tagName === 'H4' ? `# ${el.textContent}` : el.textContent)));
    check(sheet.includes('# Gallery') && sheet.includes('Seminar') && sheet.includes('Night walk'), 'the popup\'s sheet has the kept Looks, grouped', sheet.join());
    await pop.locator('#sheet .looks-head').nth(1).scrollIntoViewIfNeeded();
    if (out) await pop.screenshot({ path: path.join(out, 'looks-popup-dark.png') });
    await pop.locator(`#sheet .look[data-look="${ids.seminar}"]`).click();
    check(await until(async () => (await pop.locator('#look-name').textContent()).trim() === 'Seminar'), 'picked in the popup: its tile names Seminar');
    check(await until(async () => (await ink(a)) === seminar.colors['--gz-ink']), 'and Settings, open, wears it too');
    check(await until(async () => (await card(a, ids.seminar).getAttribute('aria-pressed')) === 'true'), 'Settings presses it');

    // ---- screenshots: a light Look (Seminar) and a dark one (Night walk), at 1280 and 640 ----
    const shoot = async (tone) => {
      for (const width of [1280, 640]) {
        await a.setViewportSize({ width, height: 900 });
        await a.emulateMedia({ colorScheme: tone });
        await pause(400);
        await a.locator('#palette').scrollIntoViewIfNeeded();
        if (out) await a.locator('#palette').screenshot({ path: path.join(out, `looks-${width}-${tone}.png`) });
      }
      await a.setViewportSize({ width: 1280, height: 900 });
    };
    await shoot('light');
    await card(a, ids.night).click();
    await until(async () => (await ink(a)) === night.colors['--gz-ink']);
    await shoot('dark');

    // ---- a gallery Look used from its offer joins the gallery's ----
    const b = await open(); // a second Settings tab, open before anything below
    await a.bringToFront();
    await a.evaluate(async ({ code }) => { await chrome.storage.local.set({ galleryOffer: { code, name: 'Sunset', author: 'mira' } }); }, { code: codes.sunset });
    check(await until(() => a.locator('#share-offer').isVisible()), 'the gallery\'s offer shows in Settings');
    await a.locator('#share-apply').click();
    check(await until(async () => (await card(a, ids.sunset).getAttribute('aria-pressed')) === 'true'), 'used from the gallery, it is in the picker, pressed');
    const after = await picker(a);
    check(after.indexOf(after.find((x) => x.startsWith('Sunset|'))) > after.indexOf('# Gallery'), 'under Gallery');
    const fav = await a.evaluate(async () => (await chrome.storage.local.get('lookFavorites')).lookFavorites.find((f) => f.name === 'Sunset'));
    check(fav?.from === 'gallery' && fav.id === ids.sunset && fav.author === 'mira', 'kept as the gallery\'s, by its id', JSON.stringify(fav && { ...fav, code: undefined }));
    check(await until(async () => (await card(b, ids.sunset).count()) === 1), 'the second Settings tab has it without a reload');

    // ---- a Look saved from Settings: at once, pressed while it is the one shown, and in the other tab ----
    const more = () => a.locator('#palette details.more').evaluate((d) => { d.open = true; });
    await more();
    await a.locator('#share-code').fill(codes.field);
    await a.locator('#share-try').click();
    await a.locator('#share-offer').waitFor({ state: 'visible' });
    await a.locator('#share-fav').click();
    check(await until(async () => (await card(a, ids.field).count()) === 1), 'saved: it shows in the picker');
    check(await until(async () => (await card(a, ids.field).getAttribute('aria-pressed')) === 'true'), 'and is the one selected while it is shown');
    const field2 = await picker(a);
    check(field2.indexOf(field2.find((x) => x.startsWith('Forest|'))) > field2.indexOf('# Saved') && field2.indexOf(field2.find((x) => x.startsWith('Forest|'))) < field2.indexOf('# Gallery'), 'under Saved (a pasted code)');
    check(await until(async () => (await card(b, ids.field).count()) === 1), 'the second Settings tab sees the new Look without a reload');
    await a.locator('#share-apply').click();
    check(await until(async () => (await ink(a)) === field.colors['--gz-ink']), 'used, it is worn');

    // ---- a course wears it; removing it unmaps the course and takes it from every list ----
    await a.goto(`${base}/options.html#courses/list`);
    const select = a.locator('#course-list select').first();
    await select.waitFor();
    check(await until(async () => (await select.locator(`option[value="${ids.field}"]`).count()) === 1), 'the course\'s Look select has the kept Looks');
    const optgroups = await select.locator('optgroup').evaluateAll((g) => g.map((x) => x.label));
    check(optgroups.join() === 'Built in,Saved,Gallery', 'grouped there too', optgroups.join());
    await select.selectOption(ids.field);
    check(await until(async () => (await a.evaluate(async () => (await chrome.storage.sync.get('courses')).courses?.looks?._101_1)) === ids.field), 'the course wears it, by id');
    await a.goto(`${base}/options.html#look/palette`);
    await a.locator('#looks button').first().waitFor();
    await more();
    const row = a.locator('#favorites li').filter({ hasText: 'Forest' });
    await row.getByRole('button', { name: 'Remove Forest from favorites' }).click();
    check(await until(async () => (await card(a, ids.field).count()) === 0), 'removed: gone from the picker');
    check(await until(async () => (await card(b, ids.field).count()) === 0), 'and from the other tab\'s');
    check(await until(async () => !(await catalog()).looks.some((E) => E.id === ids.field)), 'and from the catalogue');
    check(await until(async () => (await a.evaluate(async () => (await chrome.storage.sync.get('courses')).courses?.looks?._101_1)) === undefined), 'the course that wore it is unmapped');
    await b.goto(`${base}/options.html#courses/list`);
    const sel2 = b.locator('#course-list select').first();
    await sel2.waitFor();
    check(await sel2.inputValue() === '' && (await sel2.locator(`option[value="${ids.field}"]`).count()) === 0, 'its course select shows the student\'s theme, without it');
    const pop2 = await ctx.newPage();
    await pop2.goto(`${base}/popup.html`);
    await pop2.locator('#look').click();
    const sheet2 = await pop2.locator('#sheet #looks').evaluate((box) => [...box.children].map((el) => el.textContent));
    check(!sheet2.includes('Forest') && sheet2.includes('Sunset'), 'and from the popup\'s sheet', sheet2.join());

    // ---- on a course page: its saved Look, the theme where this device doesn't keep it, and Ctrl+K ----
    await a.evaluate(async ({ site, id }) => {
      await chrome.storage.local.set({ ultra: [site] });
      const { courses } = await chrome.storage.sync.get('courses');
      await chrome.storage.sync.set({ courses: { ...courses, looks: { _101_1: id } } });
    }, { site, id: ids.seminar });
    await require('./check-env.js').ultraReady(a);
    const lms = await ctx.newPage();
    lms.on('pageerror', (e) => errors.push(`ultra: ${e}`));
    await lms.goto(`${site}/ultra/courses/_101_1/outline`);
    await lms.waitForFunction(() => document.documentElement.hasAttribute('data-gz-bg'));
    check(await until(async () => (await ink(lms)) === seminar.colors['--gz-ink']), 'the course wears its saved Look on its page', await ink(lms));
    await a.evaluate(async () => { const { courses } = await chrome.storage.sync.get('courses'); await chrome.storage.sync.set({ courses: { ...courses, looks: { _101_1: 'c:00000000000000' } } }); });
    check(await until(async () => (await ink(lms)) === field.colors['--gz-ink']), 'a Look this device doesn\'t keep: the student\'s theme', await ink(lms));
    await lms.keyboard.press('ControlOrMeta+k');
    await lms.locator('#gz-cmd input').fill('Look: Night');
    const cmd = lms.locator('#gz-cmd-list li').filter({ hasText: 'Look: Night walk' }).first();
    check(await until(async () => (await cmd.count()) === 1), 'Ctrl+K lists the kept Looks');
    await cmd.click();
    check(await until(async () => (await ink(a)) === night.colors['--gz-ink']), 'and wears one through the worker, as Settings would', await ink(a));

    // ---- a course wears a gallery Look whole: its shader background and its pointer; another course, the theme's again ----
    const shaderLook = C.make(codes.shader, 'Shader night', 'mira', 'gallery');
    await a.evaluate(async ({ f }) => { const { lookFavorites } = await chrome.storage.local.get('lookFavorites'); await chrome.storage.local.set({ lookFavorites: [f, ...lookFavorites] }); }, { f: shaderLook });
    check(await until(async () => (await catalog()).looks.some((E) => E.id === shaderLook.id && E.kind === 'background')), 'a gallery shader Look is in the catalogue');
    await a.evaluate(async ({ id }) => { const { courses } = await chrome.storage.sync.get('courses'); await chrome.storage.sync.set({ courses: { ...courses, looks: { _101_1: id } } }); }, { id: shaderLook.id });
    const painted = () => lms.evaluate(() => ({ bg: document.documentElement.getAttribute('data-gz-bg'), scene: !!document.getElementById('gz-scene'), pointer: (document.documentElement.style.getPropertyValue('--gz-cursor').match(/cursors\/(\w+)\//) || [])[1] || '' }));
    await lms.goto(`${site}/ultra/courses/_101_1/outline`);
    await lms.waitForFunction(() => document.documentElement.hasAttribute('data-gz-bg'));
    const course = await until(async () => { const p = await painted(); return p.bg === 'shader' && p.scene && p.pointer === 'lava' && p; });
    check(!!course, 'a course wearing a gallery shader Look shows the shader (not the gradient) and its pointer', JSON.stringify(await painted()));
    check(await until(async () => (await ink(lms)) === G.GZ_PRESET('Midnight')['--gz-ink']), '  and its palette');
    await lms.evaluate(() => { history.pushState({}, '', '/ultra/courses/_202_1/outline'); dispatchEvent(new PopStateEvent('popstate')); document.body.append(document.createElement('div')); });
    const theme = await until(async () => { const p = await painted(); return p.bg === 'scene' && p.scene && p.pointer === 'ghost' && p; });
    check(!!theme, 'switching to a course without its own Look: the theme\'s background and pointer again', JSON.stringify(await painted()));
    check(await until(async () => (await ink(lms)) === night.colors['--gz-ink']), '  and the theme\'s palette');
    check(!errors.length, 'no page errors', errors.join(' | '));
  } catch (e) {
    console.error(e);
    failures.push(`threw: ${e.message}`);
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log(`FAILED: ${failures.join('; ')}`); process.exitCode = 1; }
})();
