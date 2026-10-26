// The LMSs' own announcement lists in Glaze's pop-up, for scripts/announce-check.js (same browser, same lock): synthetic
// Ultra (a course's Announcements in Ultra's own markup, the Activity Stream, a course tab's frame), Canvas (a course's
// Announcements as the local Canvas rendered it, Recent Activity, the widget dashboard) and Moodle (the news forum's list,
// the Latest announcements block) on invented hosts, every answer synthetic. For each: the preview, a plain click opening
// the pop-up with the page left where it was and its own handlers never hearing it, a modifier click passing through, and
// an unreadable announcement opening the site's page. Screenshots of each list with the pop-up open.
const fs = require('node:fs'), path = require('node:path');
const G = require('../defaults.js');
const UB = 'https://bb.school.test', MD = 'https://moodle.school.test';
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'test/fixtures', name), 'utf8');
const day = (n) => new Date(Date.now() + n * 864e5).toISOString();
const BODY = '<p>This week\'s lab is in <strong>room 2</strong> of the Science Building. Bring your lab coat and goggles.</p><ul><li>Read chapter 4 first.</li></ul>';
const SITE_PAGE = '<!doctype html><title>The site\'s page</title><h1>The site\'s page</h1>';
const off = Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false]));

module.exports = async ({ ctx, opts, O, ok, out }) => {
  const asked = [];
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn().catch(() => false); if (v) return v; await pause(80); } return false; };
  let ultraShell = 'list';
  await ctx.route(`${UB}/**`, (route) => {
    const r = route.request(), u = new URL(r.url());
    asked.push(`${r.method()} ${u.pathname}`);
    if (u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture(ultraShell === 'list' ? 'announce-ultra-lists.html' : 'ultra-course.html') });
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const m = u.pathname.match(/^\/learn\/api\/public\/v1\/courses\/(_\d+_1)\/announcements\/(_\d+_1)$/);
    if (m) return m[2] === '_7002_1' ? json({ status: 500 }, 500) : json({ id: m[2], title: 'Lab moved to room 2', body: BODY, created: day(-1) });
    if (u.pathname.endsWith('/users/me')) return json({ id: '_42_1' });
    if (u.pathname.startsWith('/learn/api/')) return json({ results: [] });
    return route.abort();
  });
  await ctx.route(`${MD}/**`, (route) => {
    const r = route.request(), u = new URL(r.url());
    asked.push(`${r.method()} ${u.pathname}${u.searchParams.get('info') ? ` ${u.searchParams.get('info')}` : ''}`);
    if (/^\/(course|mod\/forum)\/view\.php$/.test(u.pathname)) return route.fulfill({ contentType: 'text/html', body: fixture('announce-moodle-lists.html') });
    if (u.pathname === '/mod/forum/discuss.php') return route.fulfill({ contentType: 'text/html', body: SITE_PAGE });
    if (u.pathname === '/lib/ajax/service.php' && r.method() === 'POST') {
      const [call] = JSON.parse(r.postData() || '[]');
      const posts = call?.args?.discussionid === 12 ? [{ subject: 'Lab moved to room 2', message: BODY, hasparent: false, unread: true, author: { fullname: 'Ana Rivera' }, timecreated: Math.floor(Date.now() / 1000) - 86400 }] : null;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(posts ? [{ error: false, data: { posts } }] : [{ error: true, exception: { errorcode: 'invalidrecord' } }]) });
    }
    return route.abort();
  });
  // The paths of the main check's Canvas school that are this one's; everything else falls back to the main check's.
  await ctx.route(`${O}/**`, (route) => {
    const r = route.request(), u = new URL(r.url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/courses/25/announcements') { asked.push(`GET ${u.pathname}`); return route.fulfill({ contentType: 'text/html', body: fixture('canvas-announcements.html').replaceAll('http://localhost:3000', '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') }); }
    if (u.pathname === '/courses/26') { asked.push(`GET ${u.pathname}`); return route.fulfill({ contentType: 'text/html', body: fixture('announce-canvas-lists.html').replaceAll('/courses/25/', '/courses/26/') }); }
    const m = u.pathname.match(/^\/api\/v1\/courses\/(25|26)\/discussion_topics\/(55|56|7|10)$/);
    if (m) { asked.push(`GET ${u.pathname}`); return m[2] === '56' ? json({}, 500) : json({ id: m[2], title: m[2] === '10' ? 'Exam seating plan' : 'Lab moved to room 2 this week', message: BODY, posted_at: day(-1), read_state: 'read', author: { display_name: 'Dr. Ana Rivera' } }); }
    if (/^\/courses\/2[56]\/(discussion_topics|announcements)\/\d+$/.test(u.pathname)) { asked.push(`GET ${u.pathname}`); return route.fulfill({ contentType: 'text/html', body: SITE_PAGE }); }
    return route.fallback();
  });

  // The lists change without passing through empty, and the next page loads once the worker has registered what they name
  // and nothing they dropped: a storage write resolves before the worker's list-change handler has registered anything.
  const store = async (sync, local) => {
    await opts.evaluate(async ([s, l]) => {
      for (const [area, v] of [[chrome.storage.sync, s], [chrome.storage.local, l]]) { await area.remove(Object.keys(await area.get(null)).filter((k) => !(k in v))); await area.set(v); }
    }, [sync, local]);
    await opts.waitForFunction(async ([want]) => {
      const scripts = await chrome.scripting.getRegisteredContentScripts();
      return want.every(([pattern, on]) => scripts.some((s) => s.matches?.includes(pattern)) === on);
    }, [[[`${MD}/*`, !!local.moodle?.length], [`${UB}/ultra/*`, !!local.ultra?.length]]], { timeout: 10000 });
  };
  const settings = (extra = {}) => G.GZ_SANITIZE({ navbar: { on: false }, motion: { level: 'off' }, announce: { delay: 300 }, ...extra, enhance: { ...off, ...extra.enhance } });
  await store(settings(), { ultra: [UB], moodle: [`${MD}/*`], freshDefaults: { fresh: false } });

  // One list: hover, the pop-up for a plain click (screenshots), a modifier click, the site's page for one it can't read.
  // where: the page or the frame it is in; sel: its announcement link; fallback: { sel, url } of an unreadable one.
  const list = async ({ name, page, where = page, sel, fallback, modifier = true }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await where.waitForSelector(sel, { timeout: 15000 });
    await pause(400); // Glaze's first passes
    // What reaches the page's own handlers (a listener on the document, bubbling, as the site's are).
    await where.evaluate(() => { window.__reached = []; window.__doc = Math.random(); document.addEventListener('click', (e) => window.__reached.push({ prevented: e.defaultPrevented, modified: e.metaKey || e.ctrlKey })); });
    const before = await where.evaluate(() => ({ href: location.href, doc: window.__doc }));
    const link = where.locator(sel).first();
    await link.scrollIntoViewIfNeeded();
    // Hovered again until Glaze's module for the page is in (it loads on the page's first passes).
    const described = () => link.evaluate((el) => (el.getAttribute('aria-describedby') || '').includes('gz-ann-tip'));
    let shown = false;
    for (let i = 0; i < 8 && !shown; i++) {
      await page.mouse.move(0, 0);
      await link.hover(); // where Playwright finds the link under the pointer (an inline link around a block has gaps)
      shown = await until(described, 1500);
    }
    ok(shown, `${name}: the preview appears on hover`);
    await pause(150);
    await page.screenshot({ path: path.join(out, `${name}-preview.png`) });
    await link.click();
    ok(await until(() => where.evaluate(() => !!document.getElementById('gz-popup'))), `${name}: a plain click opens the pop-up`);
    await pause(700);
    const after = await where.evaluate(() => ({ href: location.href, doc: window.__doc, reached: window.__reached.length, panel: !!document.querySelector('.bb-offcanvas-panel'), opened: window.__opened || 0 }));
    ok(after.href === before.href && after.doc === before.doc && !after.panel && !after.opened, `${name}: the page stays where it was (${after.href})`);
    ok(after.reached === 0, `${name}: the site's own click handlers never hear it`);
    await page.screenshot({ path: path.join(out, `${name}-popup.png`) });
    await page.keyboard.press('Escape');
    ok(await until(() => where.evaluate(() => !document.getElementById('gz-popup'))), `${name}: Escape closes it`);
    await link.focus();
    await page.keyboard.press('Enter');
    ok(await until(() => where.evaluate(() => !!document.getElementById('gz-popup'))), `${name}: keyboard Enter opens the pop-up`);
    await page.keyboard.press('Escape');
    await until(() => where.evaluate(() => !document.getElementById('gz-popup')));
    await link.evaluate((el) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = 'Pin'; button.dataset.annCheck = 'control';
      button.addEventListener('click', (e) => { e.preventDefault(); window.__control = e.isTrusted; });
      el.append(button);
    });
    await link.locator('[data-ann-check="control"]').click();
    ok(await where.evaluate(() => window.__control && !document.getElementById('gz-popup')), `${name}: a nested button keeps its trusted click`);
    await link.evaluate((el) => el.querySelector('[data-ann-check="control"]').remove());
    // Keep a text range through mouseup, then let the browser send its trusted click.
    await link.evaluate((el) => {
      el.addEventListener('mouseup', () => {
        const range = document.createRange(); range.selectNodeContents(el);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      }, { once: true });
      el.addEventListener('click', (e) => { e.preventDefault(); window.__selected = e.isTrusted && !getSelection().isCollapsed; }, { once: true });
    });
    await link.click();
    ok(await where.evaluate(() => window.__selected && !document.getElementById('gz-popup')), `${name}: selected text keeps its trusted mouse click`);
    await where.evaluate(() => getSelection().removeAllRanges());
    if (modifier) {
      const tab = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
      await link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
      const opened = await tab;
      await pause(300);
      const m = await where.evaluate(() => ({ popup: !!document.getElementById('gz-popup'), reached: window.__reached.at(-1) }));
      ok(!m.popup && m.reached?.modified && !m.reached.prevented, `${name}: a modifier click passes through to the page and the browser${opened ? ' (a new tab)' : ''}`);
      await opened?.close();
    }
    if (fallback) {
      await where.locator(fallback.sel).first().click();
      ok(await until(() => where.evaluate((re) => new RegExp(re).test(location.href), fallback.url.source), 15000), `${name}: an unreadable announcement opens the site's page`);
    }
    ok(!errors.length, `${name}: no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  };

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  try {
    // ---- Blackboard Ultra ----
    ultraShell = 'list';
    await page.goto(`${UB}/ultra/courses/_101_1/announcements`);
    ok(await page.evaluate(() => window === window.top && document.querySelectorAll('announcement-list tr.announcement-item-row > td.announcement-header-column[role="gridcell"] > div.announcement-header > div.click-message-detail > div.announcement-title-detail > a.list-item-title[href="#"]').length === 2), 'ultra-course-announcements: observed top-level title structure and hash links');
    await list({ name: 'ultra-course-announcements', page, sel: '#list-item-title-_7001_1',
      fallback: { sel: '#list-item-title-_7002_1', url: /\/ultra\/stream\/announcement-detail\?courseId=_101_1&announcementId=_7002_1$/ } });
    ok(asked.filter((x) => x === 'GET /learn/api/public/v1/courses/_101_1/announcements/_7001_1').length === 1, 'ultra: one GET for the preview and the pop-up');
    await page.goto(`${UB}/ultra/stream`);
    await list({ name: 'ultra-stream', page, sel: '#stream-announcement .name a' });
    // Observed generic stream title classes cannot identify announcements; the other destinations stay native.
    for (const [kind, sel] of [
      ['discussion', '#stream-discussion a.js-title-link'], ['content', '#stream-content a.js-title-link'],
      ['grade', '#stream-grade a.js-title-link'], ['course', '#stream-announcement [analytics-id="stream.entry.course"]'],
    ]) {
      const native = page.locator(sel);
      await native.evaluate((el) => {
        window.__native = null;
        el.addEventListener('click', (e) => { window.__native = { trusted: e.isTrusted, prevented: e.defaultPrevented }; e.preventDefault(); }, { once: true });
      });
      await native.click();
      ok(await page.evaluate(() => window.__native?.trusted && !window.__native.prevented && !document.getElementById('gz-popup')), `ultra-stream: ${kind} link reaches its native handler`);
    }

    // A course tab's frame: the course's Announcements tool, as scripts/ctab-panel-close-check.js opens it.
    ultraShell = 'course';
    const key = `ctabs:${UB}:_42_1`;
    await store(settings({ enhance: { tabs: true, place: true }, tabs: G.GZ_SANITIZE({}).tabs }), { ultra: [UB], moodle: [`${MD}/*`], freshDefaults: { fresh: false },
      [key]: { tabs: [101, 102].map((n, i) => ({ cid: `_${n}_1`, name: `Synthetic course ${i + 1}`, path: `/ultra/courses/_${n}_1/outline`, top: 0, at: i, pin: false })) } });
    await page.goto(`${UB}/ultra/courses/_101_1/outline`);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    const f = await until(async () => page.frames().find((x) => x.name() === 'gz-ctab:_102_1'), 15000);
    await f.waitForSelector('.js-course-announcement-tool');
    await until(() => f.evaluate(() => !document.querySelector('.spinner, [data-gz-placing]') && !document.documentElement.hasAttribute('data-gz-ctab-framed')));
    await f.click('.js-course-announcement-tool');
    await list({ name: 'ultra-course-tab', page, where: f, sel: 'announcement-list a.list-item-title' });
    ok(await f.evaluate(() => location.pathname) === '/ultra/courses/_102_1/announcements' && page.url() === `${UB}/ultra/courses/_101_1/outline`, 'ultra-course-tab: the tab and the window stay on their pages');

    // ---- Canvas ----
    await store(settings(), { freshDefaults: { fresh: false } });
    await page.goto(`${O}/courses/25/announcements`);
    await list({ name: 'canvas-course-announcements', page, sel: '.ic-announcement-row a.ic-item-row__content-link[href$="/discussion_topics/55"]',
      fallback: { sel: '.ic-announcement-row a.ic-item-row__content-link[href$="/discussion_topics/56"]', url: /\/courses\/25\/discussion_topics\/56$/ } });
    await page.goto(`${O}/courses/26`);
    await list({ name: 'canvas-recent-activity', page, sel: '.stream-announcement a.content_summary[href="/courses/26/announcements/7"]' });
    await list({ name: 'canvas-dashboard-widget', page, sel: '[data-testid="announcement-item-10"] a' });
    // A group's announcement and a discussion stay Canvas's.
    await Promise.all([page.waitForURL(/\/courses\/26\/discussion_topics\/9$/, { timeout: 15000 }), page.locator('.stream-discussion_topic a.content_summary').click()]);
    ok(true, 'canvas-recent-activity: a discussion stays Canvas\'s');

    // ---- Moodle ----
    await store(settings(), { moodle: [`${MD}/*`], freshDefaults: { fresh: false } });
    await page.goto(`${MD}/mod/forum/view.php?id=40`);
    await list({ name: 'moodle-news-forum', page, sel: 'th.topic a[href$="d=12"]', fallback: { sel: 'th.topic a[href$="d=13"]', url: /\/mod\/forum\/discuss\.php\?d=13$/ } });
    const posts = asked.filter((x) => x === 'POST /lib/ajax/service.php mod_forum_get_discussion_posts').length;
    ok(posts === 2, `moodle: the preview asks nothing; the pop-up and the unreadable one ask once each (${posts})`);
    await page.goto(`${MD}/course/view.php?id=16`);
    await list({ name: 'moodle-latest-announcements', page, sel: '[data-block="news_items"] .info a[href$="d=12"]' });
  } finally {
    await page.close().catch(() => {});
    await ctx.unroute(`${UB}/**`); await ctx.unroute(`${MD}/**`); await ctx.unroute(`${O}/**`);
  }
};
