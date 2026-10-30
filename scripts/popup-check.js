// The popup's "Use Glaze on {host}", headless, with the real unpacked extension, its real worker and the real popup: the
// worker opens it over a school's tab (chrome.action.openPopup), and the check drives it over CDP, as Playwright doesn't list
// the popup. The browser's prompt has no answer headless, so the popup's chrome.permissions.request is the check's (it
// records the call and says yes); everything else is the browser's own. First it finds out whether openPopup gives the
// popup the tab (activeTab) the way a click on Glaze's button does, on a school host the staged copy doesn't hold. The
// other schools stand in the staged copy's host_permissions (the student's grant, which headless can't give), and the
// popup is told one isn't held where the check needs the not-held path to reach the worker as it would after a grant.
// NODE_PATH=<installed playwright> nice node scripts/popup-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const BB = 'https://bb.school.edu', CANVAS = 'https://canvas.school.edu', MOODLE = 'https://moodle.school.edu', WWW = 'https://www.school.edu';
const env = require('./check-env.js');
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), [`${CANVAS}/*`, `${MOODLE}/*`, `${WWW}/*`]);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-popup-'));
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(100); }
  return false;
};
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
const POPUP = `chrome-extension://${id}/popup.html`;

// The browser's own DevTools endpoint (Playwright's connection doesn't carry the popup's target), flattened sessions.
const devtools = async (profile) => {
  const port = await until(async () => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n'), 10000);
  const ws = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let n = 0;
  const pending = new Map(), events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(`${m.error.message}`)); else p.res(m.result); }
    else events.push(m);
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++n; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  return { send, events, close: () => ws.close() };
};

// Runs in the popup before its own scripts: the request, recorded and answered yes; addHostAccessRequest and the worker
// messages recorded and passed on; executeScript recorded and passed on; contains passed on unless the check says a host
// isn't held.
const stub = (notHeld) => {
  globalThis.__gz = { calls: [] };
  const rec = (k, v) => __gz.calls.push([k, v, navigator.userActivation.isActive]);
  const P = chrome.permissions;
  const contains = P.contains.bind(P), send = chrome.runtime.sendMessage.bind(chrome.runtime), exec = chrome.scripting.executeScript.bind(chrome.scripting);
  const access = P.addHostAccessRequest?.bind(P);
  P.contains = (o) => (o.origins.some((x) => notHeld.includes(x)) ? Promise.resolve(false) : contains(o));
  P.request = (o) => new Promise((resolve) => {
    if (!navigator.userActivation.isActive) throw new Error('This function must be called during a user gesture');
    rec('request', o.origins);
    resolve(true);
  });
  if (access) P.addHostAccessRequest = (o) => { rec('hostAccess', o); return access(o); };
  chrome.runtime.sendMessage = (m, ...rest) => { rec('send', m); return send(m, ...rest); };
  chrome.scripting.executeScript = (o) => { rec('exec', { target: o.target, func: typeof o.func }); return exec(o).then((r) => { rec('found', r?.[0]?.result ?? null); return r; }, (e) => { rec('execError', String(e.message)); throw e; }); };
};

(async () => {
  let ctx, cdp;
  const profile = path.join(tmp, 'profile');
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(profile, {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1', '--remote-debugging-port=0'],
    });
    const welcomed = Promise.race([env.noFirstRun(ctx), new Promise((_, no) => setTimeout(() => no(new Error('the install never opened its first screen')), 20000).unref())]);
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === BB && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture('ultra-boot.html') });
      if (u.origin === CANVAS && u.pathname === '/api/v1/users/self') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"status":"unauthenticated","errors":[{"message":"user authorization required"}]}' });
      if (u.origin === CANVAS && u.pathname.startsWith('/courses')) return route.fulfill({ contentType: 'text/html', body: fixture('canvas-course-home.html') });
      if (u.origin === MOODLE && u.pathname.startsWith('/webservice/')) return route.fulfill({ contentType: 'application/json', body: '{"exception":"core\\\\exception\\\\moodle_exception","errorcode":"invalidtoken","message":"Invalid token"}' });
      if (u.origin === MOODLE && u.pathname.startsWith('/my')) return route.fulfill({ contentType: 'text/html', body: fixture('moodle-dashboard.html') });
      if (u.origin === WWW && u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>School</title><h1>Welcome</h1>' });
      if (u.hostname.endsWith('school.edu')) return route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' });
      return route.abort();
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    cdp = await devtools(profile);
    // The install's work first: its storage writes, and its first screen, which opens as the active tab whenever it comes.
    await env.installed(sw);
    await welcomed;
    const sheets = (p) => p.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter((h) => h.startsWith('chrome-extension://')).map((h) => new URL(h).pathname.slice(1)));

    // The tab, in front; the popup over it, opened by the worker; its target attached, the stub in, and reloaded so the
    // stub runs before popup.js. The tab's activeTab grant, if any, belongs to the tab, not the popup's document.
    const over = async (url, { notHeld = [] } = {}) => {
      const tab = await ctx.newPage();
      tab.on('pageerror', (e) => errors.push(`${url}: ${e}`));
      await tab.goto(url);
      await tab.waitForLoadState('load');
      await tab.bringToFront();
      // openPopup opens over the focused window's active tab: this one, the newest (every tab reads visible headless).
      const front = () => sw.evaluate(async () => {
        const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return active?.id === Math.max(...(await chrome.tabs.query({})).map((t) => t.id));
      });
      if (!await until(front)) throw new Error(`${url} never became the active tab`);
      const opened = await sw.evaluate(() => chrome.action.openPopup().then(() => 'ok', (e) => `rejected: ${e.message}`));
      const target = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.url.startsWith(POPUP)));
      if (!target) throw new Error(`no popup target (openPopup: ${opened})`);
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const run = async (expression) => {
        const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      // What the popup itself sees of the tab before anything of the check's runs in it.
      const before = await run(`(async () => {
        const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
        const ran = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => location.host }).then((r) => 'ran: ' + r[0].result, (e) => 'refused: ' + e.message);
        return { id: t.id, url: t.url || null, ran };
      })()`);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${stub})(${JSON.stringify(notHeld)})` }, sessionId);
      await cdp.send('Page.reload', {}, sessionId);
      await until(() => run(`document.readyState === 'complete' && !!globalThis.__gz`));
      if (!await until(() => run(`document.querySelector('#here').hasAttribute('data-settled')`))) throw new Error(`the popup over ${url} never settled its site row`);
      const state = () => run(`({ shown: !document.querySelector('#here').hidden, text: document.querySelector('#here').textContent, busy: document.querySelector('#here').getAttribute('aria-disabled'), calls: __gz.calls })`);
      const click = async () => {
        const r = await run(`(() => { const b = document.querySelector('#here').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
        for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 }, sessionId);
      };
      const shot = async (name) => fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'));
      const close = async () => { await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {}); await tab.close(); };
      return { tab, opened, before, run, state, click, shot, close, tabId: before.id };
    };
    const local = () => sw.evaluate(() => chrome.storage.local.get(['canvas', 'moodle', 'ultra']));
    const kinds = (calls, k) => calls.filter(([x]) => x === k);

    // 1. A school's Ultra on a host the staged copy doesn't hold: does openPopup give the popup the tab?
    let p = await over(`${BB}/ultra/stream`);
    check(p.opened === 'ok', `the worker's openPopup opens the popup headless (${p.opened})`);
    console.log(`activeTab through openPopup: tab url ${p.before.url === null ? 'hidden' : `seen (${p.before.url})`}, executeScript ${p.before.ran}`);
    const activeTab = p.before.url !== null && p.before.ran.startsWith('ran:');
    let s = await p.state();
    if (activeTab) {
      check(s.shown && s.text === 'Use Glaze on bb.school.edu', `with activeTab from openPopup, an Ultra host Glaze doesn't hold gets the row (${JSON.stringify(s)})`);
      check(JSON.stringify(kinds(s.calls, 'found').map(([, v]) => v)) === '["ultra"]', 'the detector found Ultra in the tab');
      check(kinds(s.calls, 'hostAccess').length === 1 && kinds(s.calls, 'hostAccess')[0][1].tabId === p.tabId, 'and Chrome keeps an Allow entry for the tab');
      await p.shot('popup-1-row-bb');
      const n = s.calls.length;
      await p.click();
      await until(async () => (await p.state()).calls.slice(n).some(([k]) => k === 'request'));
      s = await p.state();
      const after = s.calls.slice(n).filter(([k]) => k === 'send' || k === 'request');
      check(JSON.stringify(after.map(([k]) => k)) === '["send","request"]', `the click tells the worker, then asks the browser (${JSON.stringify(after)})`);
      check(JSON.stringify(after[0][1]) === JSON.stringify({ type: 'glaze:allow', op: 'ask', origin: BB, kind: 'ultra', tabId: p.tabId }), 'the worker hears the site, the LMS and the tab');
      check(JSON.stringify(after[1][1]) === `["${BB}/*"]` && after[1][2] === true, 'the request is for that host, inside the click');
      const intent = await until(() => sw.evaluate((k) => chrome.storage.session.get(k).then((r) => r[k]), `allow ${BB}/*`));
      check(intent?.kind === 'ultra' && intent?.tabId === p.tabId, `the worker keeps the intent until the grant comes (${JSON.stringify(intent)})`);
      await p.shot('popup-2-row-bb-asked');
    } else {
      check(!s.shown, `without activeTab from openPopup, nothing shows on a host Glaze doesn't hold (${JSON.stringify(p.before)})`);
      console.log('openPopup does not grant activeTab: the rest stages each school\'s host, standing in for the grant activeTab gives');
    }
    await p.close();

    // 2. A Canvas site, as not held: the row, the worker first, the request in the click; the worker approves, the row goes,
    // and Glaze is in the tab.
    p = await over(`${CANVAS}/courses/25`, { notHeld: [`${CANVAS}/*`] });
    s = await p.state();
    check(s.shown && s.text === 'Use Glaze on canvas.school.edu', `a Canvas site not held gets the row (${JSON.stringify(s.calls.filter(([k]) => k !== 'send'))})`);
    check(kinds(s.calls, 'exec').length === 1 && kinds(s.calls, 'exec')[0][1].func === 'function', 'the detector ran in the tab');
    check(kinds(s.calls, 'hostAccess').length === 1, 'Chrome keeps an Allow entry for the tab');
    await p.shot('popup-3-row-canvas');
    let n = s.calls.length;
    await p.click();
    check(await until(async () => !(await p.state()).shown), 'once the worker has the site, the row goes');
    s = await p.state();
    const order = s.calls.slice(n).filter(([k]) => k === 'send' || k === 'request');
    check(JSON.stringify(order.map(([k]) => k)) === '["send","request"]' && order[1][2] === true, `ask, then the request in the click (${JSON.stringify(order)})`);
    check((await local()).canvas?.includes(`${CANVAS}/*`), 'approved');
    check(await until(async () => (await sheets(p.tab)).includes('canvas.css')), 'and Glaze is in the tab');
    await p.shot('popup-4-after-canvas');
    await p.close();

    // 3. A Moodle site held but not on Moodle's list: the row asks the worker only.
    p = await over(`${MOODLE}/my/`);
    s = await p.state();
    check(s.shown && s.text === 'Use Glaze on moodle.school.edu', 'a held Moodle site not on its list gets the row');
    check(kinds(s.calls, 'hostAccess').length === 0, 'and no menu entry, the host being held');
    n = s.calls.length;
    await p.click();
    check(await until(async () => !(await p.state()).shown), 'the worker approves from the message and the row goes');
    s = await p.state();
    check(!s.calls.slice(n).some(([k]) => k === 'request'), 'with no browser prompt');
    check((await local()).moodle?.includes(`${MOODLE}/*`), 'approved');
    check(await until(async () => (await sheets(p.tab)).includes('moodle.css')), 'and Glaze is in the tab');
    await p.close();

    // 4. A school's main website: no LMS, nothing added. 5. The Canvas site again: Glaze runs there, no detector.
    p = await over(`${WWW}/`);
    s = await p.state();
    check(!s.shown && JSON.stringify(kinds(s.calls, 'found').map(([, v]) => v)) === '[null]', 'a plain page gets no row');
    check(kinds(s.calls, 'hostAccess').length === 0, 'and no menu entry');
    await p.shot('popup-5-plain');
    await p.close();
    p = await over(`${CANVAS}/courses/25`);
    s = await p.state();
    check(!s.shown && kinds(s.calls, 'exec').length === 0, 'where Glaze already runs, the popup is as it was, without running the detector');
    await p.close();

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(`${results.length} ok, activeTab through openPopup: ${activeTab ? 'yes' : 'no'}, screenshots in ${out}`);
  } catch (e) {
    console.error(e);
    if (errors.length) console.error('page errors:', errors.join('\n'));
    process.exitCode = 1;
  } finally {
    cdp?.close();
    await ctx?.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
