// The student's pointer (Look › Pointer, lib/editor-pointer.js), headless, in the real unpacked extension's options page:
// a card for every choice, chosen with the arrow keys and the pointer and saved as the student's setting (sync extras),
// never into the Look; the preview wearing what is chosen; a picture of their own uploaded, worn and removed; the choice
// staying through a change of Look; the animation switch stopping the Look's pointer animation in the preview; the
// section's Reset; labelled controls. Then a synthetic Ultra page with the real content script: the student's pointer worn
// over the Look's or with no Look parts at all, the system's, none with Glaze off, text fields keeping the I-beam, and the
// animation switch. No network: every request outside the extension (and the synthetic page) is aborted.
//   NODE_PATH=/path/to/node_modules nice -n 10 node scripts/pointer-check.js [out-dir for screenshots]
// With an out dir it also saves the section in a light and a dark editor (pointer-setting-light.png, -dark.png, -phone.png).
// One headless browser at a time across agents: it waits while another runs. The profile is temporary and removed.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

const ext = fs.realpathSync(path.join(__dirname, '..'));
const out = process.argv[2] && path.resolve(process.argv[2]);
const chromeLaunch = require('./check-env.js').chromeLaunch();
const G = require(path.join(ext, 'defaults.js'));
const PAGE = fs.readFileSync(path.join(ext, 'test/fixtures/ultra-courses.html'), 'utf8');
const SITE = 'https://bb.school.test';
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) fails++; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(80); } return null; };

(async () => {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pointer-')));
  const errors = [];
  let context;
  try {
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
    const preview = () => page.frames().find((f) => f.url().includes('preview.html'));
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
    const links = await page.evaluate(() => [...document.querySelectorAll('#panel-look > nav.section-links a')].map((a) => a.getAttribute('href')));
    check('Pointer is in the Look tab\'s section links, after Motion', links.indexOf('#look/pointer') === links.indexOf('#look/motion') + 1, links.join(' '));
    const cards = await page.evaluate(() => [...document.querySelectorAll('#pointer-tiles label')].map((l) => l.dataset.pointer));
    check('a card for every choice the setting takes', JSON.stringify(cards) === JSON.stringify(G.GZ_SPEC.extras.pointer[1]), cards.join(' '));
    check('  The Look\'s pointer is chosen to begin with', await chosen() === 'look');
    check('  every picture on the cards loads', await until(() => page.evaluate(() => [...document.querySelectorAll('#pointer-tiles img')].every((i) => i.complete && i.naturalWidth > 0))));
    check('  the system\'s card draws its own arrow and hand', await page.evaluate(() => document.querySelectorAll('[data-pointer="off"] .pt-stage svg').length === 2));
    check('  hovering a set\'s card wears its hand', await page.evaluate(() => /cursors\/lava\/pointer\.svg/.test(getComputedStyle(document.querySelector('[data-pointer="lava"]')).cursor)));
    const unnamed = await page.evaluate(() => [...document.querySelectorAll('#look-pointer input, #look-pointer button')]
      .filter((c) => c.type !== 'file' && !(c.closest('label')?.textContent.trim() || c.textContent.trim() || c.getAttribute('aria-label'))).map((c) => c.outerHTML.slice(0, 80)));
    check('every control is labelled', !unnamed.length, unnamed.join(' '));
    check('the cards are one radio group, named by the section\'s heading', await page.evaluate(() => {
      const g = document.getElementById('pointer-tiles'), h = document.getElementById(g.getAttribute('aria-labelledby'));
      return g.getAttribute('role') === 'radiogroup' && h?.textContent === 'Pointer' && new Set([...g.querySelectorAll('input')].map((i) => i.name)).size === 1;
    }));

    // ---- a Look's pointer, then the student's over it ----------------------------------------------------------------------
    await wearLook('Library');
    check('wearing Library: the Look\'s card shows its quill, and so does the preview', await until(() => page.evaluate(() => /cursors\/quill\/default/.test(document.querySelector('[data-pointer="look"] img')?.src || ''))) && await wears('quill'), await worn());
    await page.focus('#pointer-tiles input[value="look"]');
    await page.keyboard.press('ArrowRight');
    check('the arrow keys choose: System pointer, saved as the student\'s setting', await until(async () => (await sync()).pointer === 'off') && await chosen() === 'off');
    check('  and the preview wears the system\'s', await wears('system'), await worn());
    await page.keyboard.press('ArrowRight');
    check('  the next card is Aqua', await until(async () => (await sync()).pointer === 'aqua') && !!await wears('aqua'), await worn());
    await page.click('[data-pointer="pumpkin"]');
    check('a click chooses Pumpkin; the preview wears it', await until(async () => (await sync()).pointer === 'pumpkin') && !!await wears('pumpkin'), await worn());
    check('  the Look keeps its own pointer: the choice is never written into it', await lookPointer() === 'quill', await lookPointer());

    // ---- their own picture -------------------------------------------------------------------------------------------------
    check('no picture yet: its card can\'t be chosen and says so', await page.evaluate(() => document.querySelector('[data-pointer="own"] input').disabled && /No picture yet/.test(document.querySelector('[data-pointer="own"]').textContent)));
    const png = Buffer.from(await page.evaluate(() => {
      const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), g = c.getContext('2d');
      g.fillStyle = '#f59e0b'; g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 13 : 30, a = (i * Math.PI) / 5 - Math.PI / 2; g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); }
      g.closePath(); g.fill(); g.lineWidth = 4; g.strokeStyle = '#7c2d12'; g.stroke();
      return c.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await page.setInputFiles('#pointer-file', { name: 'star.png', mimeType: 'image/png', buffer: png });
    check('a picture chosen is kept on this computer, scaled to 32 pixels, and becomes the pointer', await until(async () => (await localImg()) && (await sync()).pointer === 'own')
      && await page.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r(i.width === 32 && i.height === 32); i.src = document.querySelector('[data-pointer="own"] img').src; })));
    check('  the preview wears it (as a blob: address)', await wears('own'), await worn());
    check('  its card is chosen, Replace and Remove are offered', await page.evaluate(() => document.querySelector('[data-pointer="own"] input').checked && document.getElementById('pointer-pick').textContent === 'Replace picture…' && !document.getElementById('pointer-remove').hidden));
    check('  and the Look still has its own pointer', await lookPointer() === 'quill');
    await shot('pointer-setting-light');

    // ---- another Look: the choice stays -------------------------------------------------------------------------------------
    await wearLook('Graveyard');
    check('wearing Graveyard: the student\'s picture stays the pointer; the Look\'s card shows the ghost', await until(() => page.evaluate(() => /cursors\/ghost\/default/.test(document.querySelector('[data-pointer="look"] img')?.src || '')))
      && (await sync()).pointer === 'own' && !!await wears('own'), await worn());
    await page.click('#pointer-remove');
    check('Remove picture: gone from this computer, and the Look\'s pointer is back', await until(async () => !(await localImg()) && (await sync()).pointer === 'look') && !!await wears('ghost'), await worn());
    check('  focus goes back to Choose a picture', await page.evaluate(() => document.activeElement?.id === 'pointer-pick'));

    // ---- the animation switch ---------------------------------------------------------------------------------------------
    // Moves the pointer once what was drawn before has faded (its canvas goes with it), and says whether anything is drawn.
    const trail = () => preview().evaluate(async () => {
      for (let i = 0; i < 100 && document.getElementById('gz-fx'); i++) await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 12; i++) { dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 200 + i * 15, clientY: 200, bubbles: true })); await new Promise(requestAnimationFrame); }
      return !!document.getElementById('gz-fx');
    });
    check('the Look\'s pointer animation plays in the preview', await until(trail, 4000));
    await page.click('[data-key="extras.pointerAnim"]');
    check('Pointer animation off: saved, and the preview draws nothing around the pointer', await until(async () => (await sync()).pointerAnim === false) && !(await sleep(300), await trail()));
    check('  this Look\'s animation is named beside the switch', await page.evaluate(() => /^This Look's: \S/.test(document.getElementById('pointer-anim-look').textContent)));
    await page.click('[data-pointer="pumpkin"]');
    await until(async () => (await sync()).pointer === 'pumpkin');
    await shot('pointer-setting-dark');
    await page.setViewportSize({ width: 390, height: 900 });
    await shot('pointer-setting-phone');
    check('at phone width the cards fit, with no sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.getElementById('pointer-tiles').scrollWidth <= document.getElementById('pointer-tiles').clientWidth));
    await page.setViewportSize({ width: 1400, height: 1000 });

    // ---- Reset section --------------------------------------------------------------------------------------------------------
    await page.click('[data-reset-section="look/pointer"]');
    check('Reset section gives back the Look\'s pointer and its animation', await until(async () => { const x = await sync(); return x.pointer === 'look' && x.pointerAnim === true; }) && await chosen() === 'look' && !!await wears('ghost'));
    await open();
    check('after a reload the cards show what is saved', await chosen() === 'look' && await page.evaluate(() => document.querySelector('[data-key="extras.pointerAnim"]').checked));

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
    await extras({ pointer: 'off' });
    check('System pointer: none of Glaze\'s on the page', await shows('system') && await lms.evaluate(() => !document.documentElement.hasAttribute('data-gz-cursor')), await onPage());
    await extras({ pointer: 'neon' });
    await shows('neon');
    await page.evaluate(() => chrome.storage.sync.set({ enabled: false }));
    check('Glaze off: the page is left with the system\'s', await shows('system') && await lms.evaluate(() => !document.documentElement.style.getPropertyValue('--gz-cursor')), await onPage());
    await page.evaluate(() => chrome.storage.sync.set({ enabled: true }));
    check('  and on again, the student\'s is back', await shows('neon'), await onPage());
    const glow = () => lms.evaluate(async () => {
      for (let i = 0; i < 100 && document.getElementById('gz-fx'); i++) await new Promise((r) => setTimeout(r, 50));
      for (let i = 0; i < 12; i++) { dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 300 + i * 10, clientY: 300, bubbles: true })); await new Promise(requestAnimationFrame); }
      return !!document.getElementById('gz-fx');
    });
    check('the Look\'s pointer animation plays around the student\'s pointer', await until(glow, 4000));
    await extras({ pointerAnim: false });
    check('  Pointer animation off: nothing drawn around it', !(await sleep(600), await glow()));
    await extras({ pointerAnim: true });
    check('  on again: it plays', await until(glow, 4000));
    check('no page errors', !errors.length, errors.join(' | '));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
