// The agent approval window in a real Chromium (lib/mcp/approve.js, lib/mcp/approve.html), headless, in a staged copy of the
// extension whose worker hands the check its own approval window (lib/background.js mcpCore, which routes glaze:mcp-ask and
// windows.onRemoved to it; the copy's worker is a new file, the checkout's is untouched). Asks made in the worker open one
// popup that shows the oldest; its words are the record's: Glaze's sentence for a pairing and a grant, the summary for an
// action, the app's name "as the app reports itself" and its program. Allow and Don't allow resolve the ask, Escape is Don't
// allow, closing the window is Don't allow, a cancel moves the window on to the next ask, a click in the first moment and a
// decision from another tab change nothing. Every request outside the extension is aborted.
// Shots: pair-, grant- and action-light.png and -dark.png.
//   NODE_PATH=<playwright> nice -n 10 node scripts/mcp-approve-check.js [shots folder]   (EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const CLAUDE = { id: 'q2yhd4emtekyo2kc', name: 'Claude', exe: '/Applications/Claude.app/Contents/MacOS/Claude' };
const CODE = { id: 'ioiih44jk25fd3hj', name: 'Visual Studio Code', exe: '/usr/share/code/code' };
const SUMMARY = 'Mark “Essay 2: The river in Beloved” done in BIO 101.';
const VIEWS = {
  pair: { app: CLAUDE, tool: { name: 'todo_list', title: 'To-dos' }, group: 'courses' },
  grant: { app: CLAUDE, tool: { name: 'grades_list', title: 'Grades' }, group: 'grades' },
  action: { app: CLAUDE, tool: { name: 'todo_mark_done', title: 'Mark a to-do done' }, summary: SUMMARY },
};
// The worker's own approval window, for the check to ask through.
const SHIM = `
globalThis.approveCheck = mcpCore().approve;
`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// A popup behind another window may get no animation frames: poll on a timer.
const POLL = { polling: 50 };
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
let total = 0, failed = 0;
const check = async (name, test) => {
  total++;
  try { await test(); console.log(`ok ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
};

(async () => {
  const lock = require('./check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-approve-'));
  const shots = path.resolve(process.argv[2] || path.join(scratch, 'shots'));
  fs.mkdirSync(shots, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmcp-approve-check\n`);
    const ext = require('./check-env.js').staged(root, [], scratch);
    // The staged files are hard links to the checkout: replace the worker's, never write through it.
    const worker0 = fs.readFileSync(path.join(ext, 'lib/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'lib/background.js'));
    fs.writeFileSync(path.join(ext, 'lib/background.js'), worker0 + SHIM);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: null, reducedMotion: 'reduce', locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    require('./check-env.js').noFirstRun(context);
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/lib/background.js')) || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, PAGE = `${base}/lib/mcp/approve.html`;
    await until(() => worker.evaluate(() => typeof globalThis.approveCheck?.ask === 'function'), 'the worker loads approve.js');
    const errors = [];
    const contrastIssues = [];
    const watch = (p, name) => {
      p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    };
    // Light from the device's light mode, dark from its dark mode: the student's auto palette (Paper and Frost).
    await worker.evaluate(() => chrome.storage.sync.set({ auto: { on: true, mode: 'device', from: '20:00', to: '08:00', light: 'Paper', dark: 'Frost' } }));

    // In the worker: ask, and keep the outcome and the abort for the check to read.
    const ask = (key, kind, view) => worker.evaluate(([key, kind, view]) => {
      const box = (globalThis.checkAsks ||= {})[key] = { v: null, ac: new AbortController() };
      approveCheck.ask(kind, view, { signal: box.ac.signal }).then((v) => { box.v = v; }, (e) => { box.v = `threw ${e.message}`; });
    }, [key, kind, view]);
    const outcome = (key) => worker.evaluate((k) => globalThis.checkAsks?.[k]?.v ?? null, key);
    const waiting = () => worker.evaluate(() => chrome.storage.session.get(null).then((all) => Object.values(all).filter((r) => r?.state === 'waiting').length));
    const approvals = () => context.pages().filter((p) => p.url() === PAGE);
    const opened = async (key, kind, view) => {
      const before = new Set(approvals());
      await ask(key, kind, view);
      const p = await until(() => approvals().find((x) => !before.has(x)), `the ${kind} window`);
      watch(p, kind);
      await p.waitForFunction(() => document.getElementById('title').textContent.trim() && !document.getElementById('ask').hidden, null, POLL);
      return p;
    };
    const armed = async (p) => {
      await p.bringToFront();
      await p.waitForFunction(() => document.hasFocus() && document.getElementById('yes').getAttribute('aria-disabled') === 'false', null, POLL);
    };
    const read = (p) => p.evaluate(() => ({
      title: document.getElementById('title').textContent, group: document.getElementById('group').hidden ? null : document.getElementById('group').textContent,
      app: document.getElementById('app').textContent, note: document.querySelector('.who .hint').textContent, exe: document.getElementById('exe').hidden ? null : document.getElementById('exe').textContent,
      focus: document.activeElement?.id, buttons: [...document.querySelectorAll('#buttons button')].map((b) => b.textContent),
    }));
    const closes = (p) => until(() => p.isClosed(), 'the window closes');
    // The answer closes the window on keydown, so the key's release may find no page.
    const press = (p, key) => p.keyboard.press(key).catch((e) => { if (!/closed/i.test(e.message)) throw e; });
    const shoot = async (p, kind) => {
      for (const scheme of ['light', 'dark']) {
        await p.emulateMedia({ colorScheme: scheme });
        await p.waitForFunction((s) => document.documentElement.style.colorScheme === s, scheme, POLL);
        await p.screenshot({ path: path.join(shots, `${kind}-${scheme}.png`) });
        const contrast = await p.evaluate(() => {
          const bg = getComputedStyle(document.getElementById('ask')).backgroundColor;
          return [...document.querySelectorAll('.who .hint')].map((el) => ({ text: el.textContent, color: getComputedStyle(el).color,
            background: bg, ratio: GZ_COLOR.contrast(getComputedStyle(el).color, bg) }));
        });
        fs.writeFileSync(path.join(shots, `${kind}-${scheme}-contrast.json`), JSON.stringify(contrast, null, 2));
        for (const c of contrast) if (c.ratio < 4.5) contrastIssues.push({ kind, scheme, ...c });
      }
      await p.emulateMedia({ colorScheme: 'light' });
    };

    await check('a pairing shows Glaze\'s sentence, the group asked for, and the app as it reports itself; Allow resolves yes', async () => {
      const p = await opened('pair', 'pair', VIEWS.pair);
      assert.deepEqual(await read(p), { title: 'Claude wants to use Glaze', group: 'Courses, to-dos and schedule', app: 'Claude', note: 'as the app reports itself',
        exe: CLAUDE.exe, focus: 'no', buttons: ["Don't allow", 'Allow'] });
      assert.equal(approvals().length, 1, 'one window');
      // A click in the first moment, as a keystroke meant elsewhere would land, is ignored.
      assert.equal(await p.evaluate(() => { const b = document.getElementById('yes'), was = b.getAttribute('aria-disabled'); b.click(); return was; }), 'true');
      await pause(300);
      assert.equal(await outcome('pair'), null);
      await armed(p);
      await shoot(p, 'pair');
      await p.click('#yes');
      await until(() => outcome('pair'), 'the pairing\'s answer');
      assert.equal(await outcome('pair'), 'yes');
      await closes(p);
    });

    await check('a grant asks for its group in Glaze\'s words; Escape is Don\'t allow', async () => {
      const p = await opened('grant', 'grant', VIEWS.grant);
      const got = await read(p);
      assert.equal(got.title, 'Claude wants to see your grades');
      assert.equal(got.group, null);
      assert.equal(got.focus, 'no');
      await armed(p);
      await shoot(p, 'grant');
      await press(p, 'Escape');
      await until(() => outcome('grant'), 'the grant\'s answer');
      assert.equal(await outcome('grant'), 'no');
      await closes(p);
    });

    await check('an action shows exactly the summary; Don\'t allow resolves no and Allow yes', async () => {
      const p = await opened('action', 'action', VIEWS.action);
      const got = await read(p);
      assert.equal(got.title, SUMMARY);
      assert.equal(got.app, 'Claude');
      assert.equal(got.exe, CLAUDE.exe);
      await armed(p);
      await shoot(p, 'action');
      await p.click('#no');
      await until(() => outcome('action'), 'the action\'s answer');
      assert.equal(await outcome('action'), 'no');
      await closes(p);
      const q = await opened('action2', 'action', VIEWS.action);
      await armed(q);
      await q.keyboard.press('Tab');
      assert.equal(await q.evaluate(() => document.activeElement.id), 'yes');
      await press(q, 'Enter');
      await until(() => outcome('action2'), 'the second action\'s answer');
      assert.equal(await outcome('action2'), 'yes');
      const state = await worker.evaluate(() => chrome.storage.session.get(null).then((all) => Object.values(all).filter((r) => r?.kind === 'action').map((r) => r.state)));
      assert.deepEqual(state.sort(), ['no', 'yes']);
      await closes(q);
    });

    await check('closing the window is Don\'t allow', async () => {
      const p = await opened('closed', 'pair', { ...VIEWS.pair, app: CODE });
      assert.equal((await read(p)).title, 'Visual Studio Code wants to use Glaze');
      await p.close();
      await until(() => outcome('closed'), 'the closed window\'s answer');
      assert.equal(await outcome('closed'), 'no');
    });

    await check('one window holds the queue; a cancel moves it on; another tab can\'t decide', async () => {
      const p = await opened('first', 'action', VIEWS.action);
      await ask('second', 'grant', { ...VIEWS.grant, app: CODE });
      await until(async () => (await waiting()) === 2, 'two asks waiting');
      await pause(300);
      assert.equal(approvals().length, 1, 'the second ask waits in the same window');
      assert.equal((await read(p)).title, SUMMARY, 'the oldest first');
      // Another tab at the same page: it may show the ask, but its decision is refused.
      const other = await context.newPage();
      watch(other, 'other tab');
      await other.goto(PAGE);
      const id = await worker.evaluate(() => chrome.storage.session.get(null).then((all) => Object.values(all).find((r) => r?.state === 'waiting' && r.kind === 'action').id));
      assert.deepEqual(await other.evaluate((id) => chrome.runtime.sendMessage({ type: 'glaze:mcp-ask', id, answer: 'yes' }), id), { ok: false });
      await other.close();
      await p.bringToFront();
      assert.equal(await outcome('first'), null);
      // The app cancels the shown ask: the window shows the next one, with its buttons waiting again.
      await worker.evaluate(() => globalThis.checkAsks.first.ac.abort());
      await until(() => outcome('first'), 'the cancel');
      assert.equal(await outcome('first'), 'cancelled');
      // Read as the title changes (each 50 ms), well inside the buttons' wait.
      const disabled = await p.waitForFunction(() => document.getElementById('title').textContent === 'Visual Studio Code wants to see your grades'
        && document.getElementById('yes').getAttribute('aria-disabled'), null, POLL);
      assert.equal(await disabled.jsonValue(), 'true');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'no');
      await armed(p);
      await p.click('#yes');
      await until(() => outcome('second'), 'the second ask\'s answer');
      assert.equal(await outcome('second'), 'yes');
      await closes(p);
    });

    await check('blur/focus handlers reset the guard and held keys cannot approve', async () => {
      const p = await opened('focus', 'action', VIEWS.action);
      await armed(p);
      // Headless Chromium keeps popup targets focused. Exercise their event handlers explicitly; native OS focus is not proved here.
      await p.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await p.evaluate(() => document.getElementById('yes').getAttribute('aria-disabled')), 'true');
      await p.evaluate(() => document.getElementById('yes').click());
      assert.equal(await outcome('focus'), null, 'activation after blur is ignored');
      await p.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await p.evaluate(() => document.getElementById('yes').getAttribute('aria-disabled')), 'true');
      await armed(p);
      await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'yes');
      await p.keyboard.down('Enter');
      await until(() => outcome('focus'), 'intentional Enter');
      assert.equal(await outcome('focus'), 'yes');
      await closes(p);
      const q = await opened('repeat', 'action', VIEWS.action);
      // Hold Enter from before this window arms, then repeat it after Allow receives focus.
      await q.keyboard.down('Enter');
      await armed(q);
      await q.keyboard.press('Tab');
      await q.keyboard.down('Enter');
      await pause(100);
      assert.equal(await outcome('repeat'), null, 'a held key is ignored after the guard expires');
      await q.keyboard.up('Enter');
      await press(q, 'Escape');
      await until(() => outcome('repeat'), 'Escape after the held key');
      assert.equal(await outcome('repeat'), 'no');
      await closes(q);
    });

    await check('app claims stay text, RTL fits, and forced colours preserve keyboard focus', async () => {
      const name = '<img src=x onerror=alert(1)>', exe = '/tmp/<script>claim</script>';
      const p = await opened('text', 'pair', { ...VIEWS.pair, app: { name, exe } });
      await armed(p);
      assert.equal((await read(p)).app, name);
      assert.equal((await read(p)).exe, exe);
      assert.equal(await p.locator('#app *, #exe *').count(), 0);
      await p.evaluate(() => { document.documentElement.dir = 'rtl'; });
      await p.screenshot({ path: path.join(shots, 'pair-rtl.png') });
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await p.emulateMedia({ forcedColors: 'active' });
      await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(() => document.activeElement.id), 'yes');
      const focus = await p.locator('#yes').evaluate((b) => {
        const s = getComputedStyle(b); return { style: s.outlineStyle, width: s.outlineWidth, color: s.color, background: s.backgroundColor };
      });
      assert.notEqual(focus.style, 'none');
      assert.notEqual(focus.width, '0px');
      assert.notEqual(focus.color, focus.background);
      await p.screenshot({ path: path.join(shots, 'pair-forced-colors.png') });
      await press(p, 'Escape');
      await until(() => outcome('text'), 'the text-only ask');
      assert.equal(await outcome('text'), 'no');
      await closes(p);
    });

    await check('self-reported identity text has readable contrast in both palettes', async () => assert.deepEqual(contrastIssues, []));
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await context?.close().catch(() => {});
    if (!process.argv[2]) console.log(`shots: ${shots}`);
    fs.rmSync(path.join(scratch, 'profile'), { recursive: true, force: true });
    if (process.argv[2]) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} approval window browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
