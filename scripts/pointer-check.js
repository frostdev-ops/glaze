// The student's pointer (Look › Pointer, lib/editor-pointer.js), headless, in the real unpacked extension's options page:
// the custom pointer switch in the heading; a card for every choice, chosen with the arrow keys and the pointer and saved as
// the student's setting (sync extras), never into the Look; the preview wearing what is chosen; a picture of their own asked
// for from its card, worn and removed; the choice staying through a change of Look; the animation switch stopping the Look's
// pointer animation in the preview; the switch off giving the system's pointer and no animation, and on again the choice
// back; This Look's pointer editing the Look's parts; the section's Reset taking out both; labelled controls. Then a
// synthetic Ultra page with the real content script: the student's pointer worn over the Look's or with no Look parts at
// all, the system's with the switch off, none with Glaze off, text fields keeping the I-beam, the animation switch, and the
// command palette's switch. No network: every request outside the extension (and the synthetic page) is aborted.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/pointer-check.js [out-dir for screenshots]
// With an out dir it also saves the section in a light and a dark editor and at phone width, each with the switch on and off
// (pointer-setting-light.png, -dark.png, -phone.png, and -off after each name).
// Holds GLAZE_LOCK (check-env.js) and waits while another browser runs. The profile is temporary and removed.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

// A copy holding the school's host, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(path.join(__dirname, '..'), ['https://bb.school.test/*']);
const out = process.argv[2] && path.resolve(process.argv[2]);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const lock = require('./check-env.js').lockPath();
const G = require(path.join(ext, 'defaults.js'));
const PAGE = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-courses.html'), 'utf8');
const SITE = 'https://bb.school.test';
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probe = require('./pointer-probe.cjs');
const animation = (frame, enabled, isolated = null) => {
  let step = 0;
  return probe(async () => {
    const state = isolated && await isolated();
    const drawn = await frame.evaluate((x) => {
    const ctx = globalThis.GZ_CTX, extras = ctx?.settings().extras;
    dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: x, clientY: 200, bubbles: true }));
    const moving = /^(subtle|expressive)$/.test(document.documentElement.getAttribute('data-gz-motion') || '');
    return { ready: !!globalThis.GZ_MOTIONX && !!ctx?.parts()?.cursor, enabled: moving && extras?.pointerOn !== false && extras?.pointerAnim !== false, drawn: !!document.getElementById('gz-fx') };
    }, 200 + (++step % 12) * 15);
    return state ? { ...drawn, ...state } : drawn;
  }, enabled);
};
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80); } return null; };

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pointer-')));
  const errors = [];
  let context, held = false;
  try {
    fs.mkdirSync(lock); held = true;
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\npointer-check\n`);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1400, height: 1000 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin === SITE && u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: PAGE });
      if (u.origin === SITE && u.pathname.startsWith('/learn/api/')) return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return r.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const open = async () => {
      await page.goto(`chrome-extension://${id}/options.html#look/pointer`);
      await page.waitForFunction(() => document.getElementById('preview')?.contentDocument?.documentElement.dataset.previewReady === 'true');
      await page.waitForFunction(() => document.querySelectorAll('#pointer-tiles input[type="radio"]').length > 0);
    };
    await open();
    const preview = () => page.frames().find((f) => f.url().includes('preview.html') && !f.url().includes('backdrop'));
    const sync = () => page.evaluate(() => chrome.storage.sync.get('extras').then((r) => r.extras || {}));
    const localImg = () => page.evaluate(() => chrome.storage.local.get('cursorImg').then((r) => r.cursorImg || ''));
    const lookPointer = () => page.evaluate(async () => (await GZ_XPARTS.read(GZ_XPARTS.areas()))?.x?.pointer ?? null);
    const chosen = () => page.evaluate(() => document.querySelector('#pointer-tiles input:checked')?.value);
    // What the preview wears: a set's name, 'own' (a blob: picture) or 'system'.
    const worn = () => preview().evaluate(() => {
      const c = document.documentElement.style.getPropertyValue('--gz-cursor');
      if (!document.documentElement.hasAttribute('data-gz-cursor') || !c) return 'system';
      return /^url\("blob:/.test(c) ? 'own' : c.match(/cursors\/(\w+)\/default\./)?.[1] || c;
    });
    const wears = (want) => until(async () => (await worn()) === want && want);
    const wearLook = (name) => page.evaluate((name) => [...document.querySelectorAll('#looks .look')].find((b) => b.textContent === name).click(), name);
    // The section alone, with the editor's sticky header let go for the picture so it doesn't cover the section's top.
    const shot = async (name, el = '#look-pointer') => {
      if (!out) return;
      fs.mkdirSync(out, { recursive: true });
      const size = page.viewportSize();
      await page.setViewportSize({ width: size.width, height: 2000 });
      await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('.top').style.position = 'static'; });
      await page.locator(el).scrollIntoViewIfNeeded();
      await sleep(300);
      await page.locator(el).screenshot({ path: path.join(out, `${name}.png`) });
      await page.evaluate(() => { document.querySelector('.top').style.position = ''; });
      await page.setViewportSize(size);
    };

    // ---- the section and its cards -----------------------------------------------------------------------------------
    const links = await page.evaluate(() => [...document.querySelectorAll('[data-editor-jumps="look"] a')].map((a) => a.getAttribute('href')));
    check('Pointer is in the Look category\'s section links, after Motion', links.indexOf('#look/pointer') === links.indexOf('#look/motion') + 1, links.join(' '));
    const cards = await page.evaluate(() => [...document.querySelectorAll('#pointer-tiles [data-pointer]')].map((l) => l.dataset.pointer));
    check('a card for every choice the setting takes', JSON.stringify(cards) === JSON.stringify(G.GZ_SPEC.extras.pointer[1]), cards.join(' '));
    check('  The Look\'s pointer is chosen to begin with', await chosen() === 'look');
    check('the heading has the custom pointer switch, on, named', await page.evaluate(() => {
      const s = document.querySelector('#look-pointer .section-heading [role="switch"][data-key="extras.pointerOn"]');
      return s?.checked && s.getAttribute('aria-label') === 'Custom pointer';
    }));
    check('Motion no longer has the Look\'s pointer or cursor effect', await page.evaluate(() => !document.querySelector('#x-motion [data-focus="pointer"], #x-motion [data-focus="cursor"]')));
    check('  every picture on the cards loads', await until(() => page.evaluate(() => [...document.querySelectorAll('#pointer-tiles img')].every((i) => i.complete && i.naturalWidth > 0))));
    check('  no System pointer card: the switch is the way to it', await page.evaluate(() => !document.querySelector('[data-pointer="off"]')));
    check('  hovering a set\'s card wears its hand', await page.evaluate(() => /cursors\/lava\/pointer\.svg/.test(getComputedStyle(document.querySelector('[data-pointer="lava"]')).cursor)));
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('#look-pointer input, #look-pointer button, #look-pointer select')]
      .filter((c) => c.type !== 'file' && !(c.closest('label')?.textContent.trim() || c.textContent.trim() || c.getAttribute('aria-label')
        || (c.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent.trim()).filter(Boolean).length)).map((c) => c.outerHTML.slice(0, 80)));
    check('every control is labelled', !unnamed.length, unnamed.join(' '));
    check('the cards are one radio group, named by the section\'s heading', await page.evaluate(() => {
      const g = document.getElementById('pointer-tiles'), h = document.getElementById(g.getAttribute('aria-labelledby'));
      return g.getAttribute('role') === 'radiogroup' && h?.textContent === 'Pointer' && new Set([...g.querySelectorAll('input')].map((i) => i.name)).size === 1;
    }));

    const resetShown = (route) => page.evaluate((route) => !document.querySelector(`[data-reset-section="${route}"]`).hidden, route);
    await page.click('[data-pointer="lava"]');
    check('choosing a card reveals Reset section without a refresh', await until(async () => (await sync()).pointer === 'lava') && await resetShown('look/pointer'));
    await page.click('[data-pointer="look"]');
    await until(async () => (await sync()).pointer === 'look');

    // ---- a Look's pointer, then the student's over it ----------------------------------------------------------------------
    await wearLook('Library');
    check('wearing Library: the Look\'s card shows its quill, and so does the preview', await until(() => page.evaluate(() => /cursors\/quill\/default/.test(document.querySelector('[data-pointer="look"] img')?.src || ''))) && await wears('quill'), await worn());
    check('a Look alone reveals Pointer and Motion Reset', await resetShown('look/pointer') && await resetShown('look/motion'));
    await page.focus('#pointer-tiles input[value="look"]');
    await page.keyboard.press('ArrowRight');
    check('the arrow keys choose: Aqua, saved as the student\'s setting', await until(async () => (await sync()).pointer === 'aqua') && await chosen() === 'aqua');
    check('  and the preview wears it', await wears('aqua'), await worn());
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    check('  arrowing back past the first card wraps to the last set, never to the picture\'s card', await until(async () => (await sync()).pointer === 'frostdev') && await chosen() === 'frostdev');
    await page.click('[data-pointer="pumpkin"]');
    check('a click chooses Pumpkin; the preview wears it', await until(async () => (await sync()).pointer === 'pumpkin') && !!await wears('pumpkin'), await worn());
    check('  the Look keeps its own pointer: the choice is never written into it', await lookPointer() === 'quill', await lookPointer());

    // ---- their own picture: its card asks for one -----------------------------------------------------------------------------
    check('no picture yet: its card is a button that asks for one, and Replace and Remove aren\'t shown', await page.evaluate(() => {
      const c = document.querySelector('[data-pointer="own"]');
      return c.tagName === 'BUTTON' && !c.querySelector('input') && /Choose a picture…/.test(c.textContent) && document.getElementById('pointer-own').hidden;
    }));
    const png = Buffer.from(await page.evaluate(() => {
      const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d');
      g.fillStyle = '#f59e0b'; g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 13 : 30, a = (i * Math.PI) / 5 - Math.PI / 2; g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); }
      g.closePath(); g.fill(); g.lineWidth = 4; g.strokeStyle = '#7c2d12'; g.stroke();
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-pointer="own"]')]);
    check('  clicking it opens the file chooser', !!chooser);
    await chooser.setFiles({ name: 'star.png', mimeType: 'image/png', buffer: png });
    check('a picture chosen is kept on this computer, scaled to 32 pixels, and becomes the pointer', await until(async () => (await localImg()) && (await sync()).pointer === 'own')
      && await page.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r(i.width === 32 && i.height === 32); i.src = document.querySelector('[data-pointer="own"] img').src; })));
    check('  the preview wears it (as a blob: address)', await wears('own'), await worn());
    check('  its card is chosen, Replace and Remove are offered under the cards', await page.evaluate(() => document.querySelector('[data-pointer="own"] input').checked && document.getElementById('pointer-pick').textContent === 'Replace picture…' && !document.getElementById('pointer-own').hidden));
    check('  and the Look still has its own pointer', await lookPointer() === 'quill');
    await shot('pointer-setting-light');
    await page.click('[data-key="extras.pointerOn"]');
    check('the switch off: saved, the cards and the animation switch hidden, the picture kept, and the preview wears the system\'s',
      await until(async () => (await sync()).pointerOn === false) && (await sync()).pointer === 'own' && await page.evaluate(() => document.getElementById('pointer-body').hidden) && !!await wears('system'), await worn());
    await page.fill('#find', 'Pointer animation');
    check('search excludes Pointer animation while the custom pointer is off', await page.evaluate(() => {
      const row = document.querySelector('[data-key="extras.pointerAnim"]').closest('.has-info');
      return row.classList.contains('miss') && document.getElementById('pointer-body').classList.contains('miss');
    }));
    await page.fill('#find', '');
    await shot('pointer-setting-light-off');
    await page.click('[data-key="extras.pointerOn"]');
    check('  on again: the picture is worn again', await until(async () => (await sync()).pointerOn === true) && !!await wears('own') && await page.evaluate(() => !document.getElementById('pointer-body').hidden), await worn());

    await page.fill('#find', 'Pointer animation');
    check('search finds Pointer animation once the custom pointer is back on', await page.evaluate(() => !document.querySelector('[data-key="extras.pointerAnim"]').closest('.miss')));
    await page.fill('#find', '');

    // ---- another Look: the choice stays -------------------------------------------------------------------------------------
    await wearLook('Graveyard');
    check('wearing Graveyard: the student\'s picture stays the pointer; the Look\'s card shows the ghost', await until(() => page.evaluate(() => /cursors\/ghost\/default/.test(document.querySelector('[data-pointer="look"] img')?.src || '')))
      && (await sync()).pointer === 'own' && !!await wears('own'), await worn());
    await page.click('#pointer-remove');
    check('Remove picture: gone from this computer, and the Look\'s pointer is back', await until(async () => !(await localImg()) && (await sync()).pointer === 'look') && !!await wears('ghost'), await worn());
    check('  focus goes to the card that asks for another', await page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && document.activeElement.dataset.pointer === 'own'));

    await page.focus('#pointer-tiles input[value="look"]');
    await page.evaluate(() => chrome.storage.local.set({ cursorImg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }));
    await until(() => page.evaluate(() => !!document.querySelector('[data-pointer="own"] input')));
    check('a picture arriving in another tab keeps keyboard focus on the chosen card', await page.evaluate(() => document.activeElement === document.querySelector('#pointer-tiles input[value="look"]')));
    await page.evaluate(() => chrome.storage.local.remove('cursorImg'));
    await until(() => page.evaluate(() => document.querySelector('[data-pointer="own"]').tagName === 'BUTTON'));

    // ---- the animation switch ---------------------------------------------------------------------------------------------
    // Poll the live preview and send input from Node, without waiting for a previous canvas to fade in one call.
    const trail = (enabled = true) => animation(preview(), enabled);
    check('the Look\'s pointer animation plays in the preview', await trail());
    await page.click('[data-key="extras.pointerAnim"]');
    check('Pointer animation off: saved, and the preview draws nothing around the pointer', await until(async () => (await sync()).pointerAnim === false) && await trail(false));
    check('  this Look\'s animation is named beside the switch', await page.evaluate(() => /^This Look's: \S/.test(document.getElementById('pointer-anim-look').textContent)));
    await page.click('[data-pointer="pumpkin"]');
    await until(async () => (await sync()).pointer === 'pumpkin');
    await page.click('[data-key="extras.pointerAnim"]');
    check('Pointer animation on again: it plays around Pumpkin', await until(async () => (await sync()).pointerAnim === true) && !!await wears('pumpkin') && !!await trail());
    await shot('pointer-setting-dark');
    await page.setViewportSize({ width: 390, height: 900 });
    await shot('pointer-setting-phone');
    check('at phone width the cards fit, with no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('pointer-tiles').scrollWidth <= document.getElementById('pointer-tiles').clientWidth));
    await page.click('[data-key="extras.pointerOn"]');
    await until(async () => (await sync()).pointerOn === false);
    await shot('pointer-setting-phone-off');
    check('at phone width, off: the heading keeps its switch in view', await page.evaluate(() => { const r = document.querySelector('[data-key="extras.pointerOn"]').getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth; }));
    await page.setViewportSize({ width: 1400, height: 1000 });
    await shot('pointer-setting-dark-off');
    check('the switch off: the system\'s pointer and nothing drawn around it in the preview', await wears('system') && await trail(false), await worn());
    await page.click('[data-key="extras.pointerOn"]');
    check('  on again: Pumpkin and its animation are back', await until(async () => (await sync()).pointerOn === true) && !!await wears('pumpkin') && !!await trail(), await worn());

    // ---- This Look's pointer: the Look's parts ---------------------------------------------------------------------------------
    const lookCursor = () => page.evaluate(async () => (await GZ_XPARTS.read(GZ_XPARTS.areas()))?.x?.cursor?.kind ?? null);
    check('This Look\'s pointer is closed to begin with', await page.evaluate(() => !document.getElementById('x-pointer').closest('details').open));
    await page.click('#look-pointer details.more > summary');
    await page.selectOption('#x-pointer select[data-focus="pointer"]', 'lava');
    check('  the Look\'s set is saved into the Look, and its card follows; the student\'s choice stays', await until(async () => (await lookPointer()) === 'lava')
      && !!await until(() => page.evaluate(() => /cursors\/lava\/default/.test(document.querySelector('[data-pointer="look"] img')?.src || ''))) && (await sync()).pointer === 'pumpkin');
    await page.selectOption('#x-pointer select[data-focus="cursor"]', 'sparkle');
    check('  a cursor effect is saved into the Look', await until(async () => (await lookCursor()) === 'sparkle'));

    // ---- Reset section --------------------------------------------------------------------------------------------------------
    await page.click('[data-reset-section="look/pointer"]');
    check('Reset section gives back your pointer settings and takes the Look\'s pointer and cursor effect out', await until(async () => { const x = await sync(); return x.pointer === 'look' && x.pointerOn === true && x.pointerAnim === true; })
      && await chosen() === 'look' && !!await until(async () => (await lookPointer()) === null && (await lookCursor()) === null) && !!await wears('system'), `${await lookPointer()} ${await lookCursor()} ${await worn()}`);
    await open();
    check('after a reload the cards show what is saved', await chosen() === 'look' && await page.evaluate(() => document.querySelector('[data-key="extras.pointerAnim"]').checked && document.querySelector('[data-key="extras.pointerOn"]').checked));

    // ---- part 2: a course page ------------------------------------------------------------------------------------------------
    console.log('\n-- an Ultra page --');
    await page.evaluate((origin) => chrome.storage.local.set({ ultra: [origin] }), SITE);
    // Settings and the Look's parts as the editor saves them (lib/background.js glaze:look); extras alone as any switch does.
    const look = (parts, patch = {}) => page.evaluate(({ parts, patch }) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:look', parts, patch: { version: 2, ...patch } }, res)), { parts, patch });
    const extras = (x) => page.evaluate((x) => chrome.storage.sync.get('extras').then((r) => chrome.storage.sync.set({ extras: { ...r.extras, ...x } })), x);
    check('a Look without parts is saved', (await look(null, { motion: { ...G.GZ_DEFAULTS.motion, level: 'expressive', followSystem: false } }))?.ok);
    await extras({ pointer: 'lava', pointerAnim: true });
    const lms = await context.newPage();
    lms.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    await lms.goto(`${SITE}/ultra/course`);
    await lms.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
    await lms.evaluate(() => { const i = Object.assign(document.createElement('input'), { type: 'text', id: 'field' }); document.body.append(i); });
    const onPage = () => lms.evaluate(() => {
      const c = getComputedStyle(document.body).cursor;
      return c === 'auto' ? 'system' : /^url\("blob:/.test(c) ? 'own' : c.match(/cursors\/(\w+)\/default\./)?.[1] || c;
    });
    const shows = (want) => until(async () => (await onPage()) === want && want);
    check('the student\'s set with a Look that has no parts: the page wears it', await shows('lava'), await onPage());
    check('  its hand on a link, and the I-beam kept in a text field', await lms.evaluate(() => /cursors\/lava\/pointer\./.test(getComputedStyle(document.querySelector('a[href]')).cursor) && getComputedStyle(document.getElementById('field')).cursor === 'text'));
    check('a Look with its own pointer: the student\'s still wins', (await look({ x: { pointer: 'ghost', cursor: { kind: 'glow' } } }))?.ok && await sleep(500) === undefined && await shows('lava'), await onPage());
    await extras({ pointer: 'look' });
    check('The Look\'s pointer: the page wears the Look\'s ghost', await shows('ghost'), await onPage());
    await extras({ pointer: 'neon' });
    await shows('neon');
    await extras({ pointerOn: false });
    check('the custom pointer off: none of Glaze\'s on the page', await shows('system') && await lms.evaluate(() => !document.documentElement.hasAttribute('data-gz-cursor')), await onPage());
    await extras({ pointerOn: true });
    check('  on again: the set chosen before', await shows('neon'), await onPage());
    await page.evaluate(() => chrome.storage.sync.set({ enabled: false }));
    check('Glaze off: the page is left with the system\'s', await shows('system') && await lms.evaluate(() => !document.documentElement.style.getPropertyValue('--gz-cursor')), await onPage());
    await page.evaluate(() => chrome.storage.sync.set({ enabled: true }));
    check('  and on again, the student\'s is back', await shows('neon'), await onPage());
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const glow = (enabled = true) => animation(lms, enabled, () => sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const ctx = globalThis.GZ_CTX, extras = ctx?.settings().extras;
        const moving = /^(subtle|expressive)$/.test(document.documentElement.getAttribute('data-gz-motion') || '');
        return { ready: !!globalThis.GZ_MOTIONX && !!ctx?.parts()?.cursor, enabled: moving && extras?.pointerOn !== false && extras?.pointerAnim !== false };
      } });
      return r.result;
    }, lms.url()));
    check('the Look\'s pointer animation plays around the student\'s pointer', await glow());
    await extras({ pointerAnim: false });
    check('  Pointer animation off: nothing drawn around it', await glow(false));
    await extras({ pointerAnim: true });
    check('  on again: it plays', await glow());
    await extras({ pointerOn: false });
    check('the custom pointer off: nothing drawn around the pointer either', await shows('system') && await glow(false));
    await extras({ pointerOn: true });
    check('  on again: it plays', await glow());
    // The command palette (Ctrl+K): a Pointer: entry per choice; their own picture only once there is one.
    await lms.keyboard.press('Control+k');
    await lms.waitForSelector('#gz-cmd input');
    // What the palette lists for a search (it shows the best few, so each is searched for by name).
    const listed = async (q) => {
      await lms.fill('#gz-cmd input', q);
      await sleep(250);
      return lms.evaluate(() => [...document.querySelectorAll('#gz-cmd-list li')].map((li) => li.textContent).filter((x) => /^Pointer: /.test(x)));
    };
    const names = ["The Look's pointer", 'Terminal', 'Pumpkin'];
    const found = [];
    for (const n of names) if ((await listed(`Pointer: ${n}`)).some((x) => x.startsWith(`Pointer: ${n}`))) found.push(n);
    check('the palette has Pointer: entries, the Look\'s among them', found.length === names.length, found.join(', '));
    check('  but none for a picture there isn\'t, nor System pointer', !(await listed('Pointer: Your own picture')).some((x) => /Your own picture/.test(x)) && !(await listed('Pointer: System pointer')).some((x) => /System pointer/.test(x)));
    // Its switch: off from the palette, and the styles go from it until it is on again.
    const run = async (q, re) => {
      if (!await lms.$('#gz-cmd input')) { await lms.keyboard.press('Control+k'); await lms.waitForSelector('#gz-cmd input'); }
      await lms.fill('#gz-cmd input', q);
      const li = await until(() => lms.evaluate((re) => [...document.querySelectorAll('#gz-cmd-list li')].find((li) => new RegExp(re).test(li.textContent))?.id, re.source));
      if (li) await lms.click(`#${li}`);
      return !!li;
    };
    check('Turn off custom pointer: saved, and the page wears the system\'s', await run('custom pointer', /^Turn off custom pointer/) && await until(async () => (await sync()).pointerOn === false) && !!await shows('system'), await onPage());
    await lms.keyboard.press('Control+k');
    await lms.waitForSelector('#gz-cmd input');
    check('  while off, the palette lists no Pointer: entries', !(await listed('Pointer:')).length);
    check('  Turn on custom pointer: the set chosen before is back', await run('custom pointer', /^Turn on custom pointer/) && await until(async () => (await sync()).pointerOn === true) && !!await shows('neon'), await onPage());
    await lms.keyboard.press('Control+k');
    await lms.waitForSelector('#gz-cmd input');
    await lms.fill('#gz-cmd input', 'Pointer:');
    await lms.keyboard.type(' Rose');
    const rose = await until(() => lms.evaluate(() => [...document.querySelectorAll('#gz-cmd-list li')].find((li) => /^Pointer: Rose/.test(li.textContent))?.id));
    await lms.click(`#${rose}`);
    check('  choosing Pointer: Rose saves it, and the page wears it', await until(async () => (await sync()).pointer === 'rose') && !!await shows('rose'), await onPage());
    await page.evaluate(async () => {
      const { courses } = await chrome.storage.sync.get('courses');
      await chrome.storage.sync.set({ courses: { ...courses, looks: { _101_1: 'Library', _102_1: 'Graveyard' } } });
    });
    await lms.goto(`${SITE}/ultra/courses/_101_1/outline`);
    check('a course with its own Look still wears the personal override', await shows('rose'), await onPage());
    await extras({ pointer: 'look' });
    check('following the Look on that course wears Library\'s quill', await shows('quill'), await onPage());
    await lms.goto(`${SITE}/ultra/courses/_102_1/outline`);
    check('another course follows its own Look\'s ghost', await shows('ghost'), await onPage());
    await extras({ pointer: 'lava' });
    await shows('lava');
    await lms.evaluate(() => { history.pushState({}, '', location.origin + '/ultra/courses/_102_1/assessment/_2_1/attempt'); dispatchEvent(new PopStateEvent('popstate')); });
    check('entering a quiet page clears the override without reloading', await shows('system'), await onPage());
    await lms.evaluate(() => { history.pushState({}, '', location.origin + '/ultra/courses/_102_1/outline'); dispatchEvent(new PopStateEvent('popstate')); });
    check('leaving the quiet page restores the personal override', await shows('lava'), await onPage());
    check('no page errors', !errors.length, errors.join(' | '));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
