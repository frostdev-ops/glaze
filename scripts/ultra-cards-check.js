// Ultra's course cards, headless (B7a): the real extension on a synthetic Courses page (test/fixtures/ultra-courses.html,
// built from parity/spikes/B7.md), served under a made-up school's address. Nothing leaves the machine: every other
// request is aborted and DNS is mapped to nowhere. Each card gets a due list as features/cardtasks.js draws it (four
// rows and "and 2 more"; Ultra's planner isn't here to ask), then, for each card mode (Ultra's own, a banner height,
// a short banner, a width and gap, condensed with a pet), it checks that every list ends inside its card, that every
// term heading starts below the cards and lists above it, and that no card has an empty band.
// At 375px, a term's three cards are exactly one window (900px) high before their lists come, as can happen on a real
// page: content.js tags them data-gz-vh, and they must still grow.
//   NODE_PATH=/path/to/node_modules node scripts/ultra-cards-check.js [out dir for screenshots]   (needs playwright)
//   EXT=/other/extension/dir checks that copy instead (say, the code before a change).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const G = require('../defaults.js');

const ext = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-cards-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'test/fixtures/ultra-courses.html'), 'utf8');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const MODES = {
  ultra: {},
  height: { height: 200 },
  short: { height: 64 },
  width: { width: 360, gap: 40 },
  condensed: { condensed: true, pet: 'cat' },
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b7a-'));
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  try {
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.host === 'bb.school.test' && u.pathname === '/ultra/course') return route.fulfill({ contentType: 'text/html', body: PAGE });
      if (u.host === 'bb.school.test' && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const page = await ctx.newPage();
    const run = async (name, card, preset, width) => {
      await opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); },
        { ...G.GZ_DEFAULTS, colors: G.GZ_PRESETS.find(([n]) => n === preset)[1], preset, card });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('https://bb.school.test/ultra/course');
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
      await page.waitForTimeout(600);
      // The list, as features/cardtasks.js draws it (its markup and classes).
      await page.evaluate(() => {
        for (const art of document.querySelectorAll('article[id^="course-list-course-"]')) {
          if (art.querySelector(':scope > .gz-ct')) continue;
          const ul = document.createElement('ul');
          ul.className = 'gz-ct';
          for (let i = 1; i <= 4; i++) ul.insertAdjacentHTML('beforeend', `<li><a class="gz-ct-row" href="#"><span class="gz-ct-t">Module ${i}: Assignment with a long enough title to wrap</span><span class="gz-ct-when">Due in ${i} days</span></a></li>`);
          ul.insertAdjacentHTML('beforeend', '<li class="gz-ct-part">and 2 more</li>');
          art.querySelector(':scope > .element-details').after(ul);
        }
      });
      await page.waitForTimeout(300);
      const g = await page.evaluate(() => {
        const r = (e) => e.getBoundingClientRect();
        const cards = [...document.querySelectorAll('article[id^="course-list-course-"]')].map((a) => {
          // Empty: the details' height beyond what's in them (its padding, its in-flow children).
          const d = a.querySelector(':scope > .element-details');
          const s = getComputedStyle(d);
          const used = [...d.children].filter((k) => getComputedStyle(k).position !== 'absolute').reduce((n, k) => { const m = getComputedStyle(k); return n + r(k).height + parseFloat(m.marginTop) + parseFloat(m.marginBottom); }, parseFloat(s.paddingTop) + parseFloat(s.paddingBottom));
          return { card: r(a), list: r(a.querySelector('.gz-ct')), empty: r(d).height - used };
        });
        const heads = [...document.querySelectorAll('.course-card-term-name')].map((h) => r(h).top);
        return { cards, heads, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      const tag = `${name} ${preset} ${width}px`;
      ok(g.cards.every((c) => c.list.bottom <= c.card.bottom + 1), `${tag}: every list ends inside its card`);
      ok(g.cards.every((c) => c.list.right <= c.card.right + 1 && c.list.left >= c.card.left - 1), `${tag}: every list stays within its card's width (Ultra's card is a wrapping row)`);
      const over = g.heads.slice(1).map((top) => Math.max(0, ...g.cards.filter((c) => c.card.top < top).map((c) => Math.max(c.card.bottom, c.list.bottom) - top)));
      ok(over.every((o) => o <= 0), `${tag}: every term heading starts below the cards and lists above it (overlap ${over.map(Math.round)}px)`);
      ok(g.cards.every((c) => c.empty < 24), `${tag}: no empty band in a card (most ${Math.round(Math.max(...g.cards.map((c) => c.empty)))}px)`);
      ok(g.overflow <= 0, `${tag}: no sideways scroll`);
      await page.screenshot({ path: path.join(out, `${name}-${preset.toLowerCase()}-${width}.png`), fullPage: true });
    };
    for (const [name, card] of Object.entries(MODES)) await run(name, card, 'Frost', 1280);
    for (const preset of ['Frost', 'Paper']) for (const width of [1280, 375]) await run('ultra', {}, preset, width);
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${fails ? 'FAILED' : 'passed'}; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})();
