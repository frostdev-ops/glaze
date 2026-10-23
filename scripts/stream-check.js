// Native stream markup, redraws, settings and teardown. No LMS requests.
// NODE_PATH=<playwright node_modules> node scripts/stream-check.js [evidence-directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), out = process.argv[2], lock = require('./check-env.js').lockPath();
const row = (id, type, due = true) => `<li id="${id}" class="stream-item-container"><div class="stream-item"><div class="element-card"><div class="element-details" analytics-context='${JSON.stringify({ streamType: type, ...(type === 'bb_tel:stu_grade' && { notificationType: 'GradeIncreased' }) })}'>
<div class="timestamp"><div><div class="js-split-datetime"><span class="date">Sep 16, 2026</span><span class="time">9:30 AM</span></div></div></div>
<div class="name"><a href="#assignment">${id}</a></div>${due ? '<div class="content"><span class="due-date"><bb-translate translate-values=\'{"datetime":"10/25/26, 11:59 PM","timezone":"EDT"}\'>Due Date: <bdi>10/25/26, 11:59 PM</bdi> (<bdi>EDT</bdi>)</bb-translate></span></div>' : ''}</div></div></div></li>`;
let checks = 0;
const check = (ok, message) => { if (!ok) throw Error(message); checks++; console.log(`ok ${message}`); };
(async () => {
  let browser, held = false;
  try {
    fs.mkdirSync(lock); held = true;
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, ...require('./check-env.js').chromeLaunch(), args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
    await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('https://bb.school.test/ultra/stream');
    await page.setContent(`<div id="site-wrap"><h1>Activity Stream</h1><div id="activity-stream"><div class="activity-group"><h2>Upcoming</h2><ul class="activity-feed">${row('deadline', 'GB:DUE')}${row('invalid', 'DF:DUE')}${row('content', 'CO:CO_AVAIL')}${row('grade', 'bb_mygrades', false)}</ul></div><div class="activity-group" id="today"><h2>Today</h2><ul>${row('kudos', 'bb_tel:stu_grade', false)}</ul></div></div></div><div id="notification-settings"><form><div id="panel-stream"><h2>Stream Notifications</h2><label><input id="native" type="checkbox" checked>New grades</label></div></form></div>`);
    await page.addStyleTag({ path: path.join(root, 'theme.css') });
    await page.addStyleTag({ content: ':root{--gz-ink:#e8f2fa;--gz-surface:#0d1b2e;--gz-surface-2:#060d18;--gz-line:#24405f;--gz-line-strong:#57748c;--gz-accent:#17c8f4;--gz-radius:12px}body{background:#060d18;color:#e8f2fa;font:16px system-ui;padding:24px}#notification-settings{max-width:500px}li{list-style:none}' });
    for (const file of ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'lib/i18n.js', 'defaults.js', 'lib/page.js', 'lib/stream.js']) await page.addScriptTag({ path: path.join(root, file) });
    await page.evaluate(() => {
      document.querySelector('#invalid [translate-values]').setAttribute('translate-values', '{bad');
      window.state = GZ_SANITIZE({}); window.saved = []; window.nativeEvents = 0; window.failSave = false;
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function (opts) { const r = attach.call(this, opts); if (this.id === 'gz-stream-settings') window.settingsRoot = r; return r; };
      window.chrome = { runtime: { id: 'fixture' }, storage: { sync: {
        get: (key, cb) => cb({ stream: state.stream }),
        set: (values, cb) => {
          if (failSave) { chrome.runtime.lastError = { message: 'quota' }; cb(); delete chrome.runtime.lastError; return; }
          saved.push(values); state = GZ_SANITIZE({ ...state, ...values }); GZ_STREAM_UI.sync(true); cb();
        },
      } } };
      window.GZ_CTX = { on: () => state.enabled, settings: () => state, locale: () => 'en-US', t: (s, v) => s.replace('{when}', v?.when || '') };
      document.querySelector('form').addEventListener('change', () => nativeEvents++);
      document.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); nativeEvents++; });
    });
    await page.addScriptTag({ path: path.join(root, 'features/stream.js') });
    await page.evaluate(() => GZ_STREAM_UI.sync(true));
    check(await page.locator('#deadline .gz-stream-date .date').first().textContent() === 'Due Oct 25', 'deadline notifications display the due date');
    check(await page.locator('#deadline .timestamp > div').isHidden(), 'the posted timestamp is visually replaced');
    check((await page.locator('#deadline .gz-stream-date').getAttribute('aria-label')).includes('11:59 PM (EDT)'), 'the full deadline and zone remain accessible');
    check(await page.locator('#invalid .gz-stream-date,#content .gz-stream-date,#grade .gz-stream-date').count() === 0, 'invalid deadlines, content and grades retain posted dates');
    check(await page.evaluate(() => !document.querySelector('#gz-stream-settings').shadowRoot && !!settingsRoot.querySelector('select')), 'settings mount in a closed root in the native Stream tab');
    const control = async (selector) => (await page.evaluateHandle((sel) => settingsRoot.querySelector(sel), selector)).asElement();
    await (await control('select')).selectOption('both');
    check(await page.locator('#deadline .gz-stream-posted').isVisible(), 'both mode shows the posted date too');
    await (await control('[data-key=compact]')).check();
    await (await control('[data-key=encouragement]')).uncheck();
    check(await page.locator('#kudos').isHidden() && await page.locator('#today').isHidden(), 'hidden encouragement leaves no empty group');
    check(await page.locator('#grade').isVisible() && await page.locator('#content').isVisible(), 'grades and content stay visible');
    check(await page.evaluate(() => nativeEvents === 0 && document.querySelector('#native').checked && saved.every((x) => Object.keys(x).join() === 'stream')), 'only Glaze preferences change, without native form events');
    await (await control('select')).selectOption('posted');
    check(await page.locator('#deadline .gz-stream-date').count() === 0 && await page.locator('#deadline .timestamp > div').isVisible(), 'posted mode restores the original timestamp');
    check(await (await control('[data-key=relative]')).isDisabled(), 'relative dates disable in posted mode');
    await page.evaluate(() => { failSave = true; });
    await (await control('[data-key=compact]')).click();
    check(await page.evaluate(() => settingsRoot.querySelector('output').textContent.includes('Could not save') && settingsRoot.querySelector('[data-key=compact]').checked), 'failed saves restore saved controls and report failure');
    await page.evaluate(() => { failSave = false; });
    await (await control('button')).click();
    check(await page.locator('#kudos').isVisible() && await page.locator('html').getAttribute('data-gz-stream-compact') === null, 'reset restores visibility and layout');
    await page.evaluate(() => {
      document.querySelector('#deadline .timestamp > div').innerHTML = '<span class="date">Oct 22, 2026</span>';
      document.querySelector('#deadline [translate-values]').setAttribute('translate-values', JSON.stringify({ datetime: '10/28/26, 11:59 PM', timezone: 'EDT' }));
      GZ_STREAM_UI.sync(true);
    });
    check(await page.locator('#deadline .gz-stream-date .date').first().textContent() === 'Due Oct 28' && await page.locator('#deadline .gz-stream-date').count() === 1, 'redraws update the existing badge without duplication');
    await page.evaluate(() => GZ_STREAM_UI.sync(false));
    check(await page.locator('#gz-stream-settings,.gz-stream-date,[data-gz-stream-date],[data-gz-stream-hidden],[data-gz-stream-empty]').count() === 0, 'turning Glaze off removes all stream UI and markers');
    await page.evaluate(() => { GZ_STREAM_UI.sync(true); history.pushState({}, '', '/ultra/course'); GZ_STREAM_UI.sync(true); });
    check(await page.locator('#gz-stream-settings,.gz-stream-date').count() === 0, 'SPA navigation cleans up the stream');
    await page.evaluate(() => { history.pushState({}, '', '/ultra/stream'); GZ_STREAM_UI.sync(true); });
    for (const width of [1300, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      check(await page.evaluate(() => { const r = settingsRoot.querySelector('fieldset').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }), `settings fit at ${width}px`);
      if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `stream-${width}.png`) }); }
    }
    await page.evaluate(() => GZ_STREAM_UI.sync(false));
    console.log(`${checks} stream checks passed`);
  } finally { if (browser) await browser.close(); if (held) fs.rmdirSync(lock); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
