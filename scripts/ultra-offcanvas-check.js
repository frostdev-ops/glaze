// Full-window Ultra layers, their native backdrop and Rubric. Run under the shared browser lock.
const { chromium } = require('playwright');
const path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const root = process.env.EXT || path.join(__dirname, '..'), out = process.argv[2];
let checks = 0, fails = 0;
const check = (ok, message) => { checks++; fails += !ok; console.log(`${ok ? 'ok' : 'FAIL'} ${message}`); };
(async () => {
  let browser;
  try {
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch(), args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error(e.message));
    const shot = async (name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`) }); } };
    await require('./ultra-offcanvas-fixture.js')({ page, root, check, shot, navbarOnly: process.env.NAVBAR_ONLY === '1' });
    console.log(JSON.stringify({ checks, fails })); process.exitCode = fails ? 1 : 0;
  } finally { await browser?.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
