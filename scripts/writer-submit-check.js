// Glaze Writer's submit step in the real unpacked extension, on the synthetic assignment attempt (test/fixtures/
// ultra-writer-attempt.html, the probed shape) running the real Quill 1.3.7, with a stand-in for Ultra's React around it:
// its file area takes files at its root (input's change, or a drop), records them and lists each after a moment; its
// footer's Save and Close and Submit stay disabled (Mui-style) while there's no text and no file, and record clicks; a
// Submit click shows a stand-in confirmation. ?mode= changes it: empty (no text in Ultra's box), noinput (the file area
// without its input), gone (no file area), never (files never listed), stuck (Submit never enables).
// Checked: the sheet's look (screenshots beside the mockup), focus trap, Escape and Cancel changing nothing, Ultra's
// Submit (disabled or not) and Save and Close caught, the .docx landing in the input with its name, type and bytes (read
// back with lib/doctext.js), the note and text in Quill, Submit clicked exactly once and only after the file is listed,
// each failure stopping before Submit, a test untouched, the keyboard flow, and Settings → Writer's remembered paste switch. Bringing a file (writer-import.js): a .docx
// dropped on the paper asks, Open in Writer replaces the paper (a version first, Undo in the toast); one chosen in Ultra's
// own file area reaches the frame before Ultra and Submit as is attaches its very bytes (hashes compared) with the note; a PDF
// goes straight to the sheet; ⋯ → Import…; with Open uploads in Writer off, Ultra's area takes the file itself. The flows
// above run in the full view (writer.full on), as do a slow save (the worker's writes held 6 s) holding Save and Close,
// Saving… in the title bar, and the sheet's Submit until they land; a worker that never answers (the paper says so after
// its bound, nothing pressed); and Ultra's Submit or Save and Close pressed as Writer reopens the frame or as a reloaded
// attempt's frame goes in (held until it is up, Ultra hearing nothing). The compact box (Full writer off, the default): no pages, the frame as tall
// as its text, typing autosaved to the paper and written into Ultra's box, Ultra's own Submit sending that text with no
// .docx and no sheet, the "Full writer" switch to the pages and back (caret and its line on screen kept, a 'view' version
// first), the setting kept across a reload and followed live from Settings, a slow save (the worker's writes held 6 s)
// holding Ultra's Submit with Saving… in the bar until it lands, a paper past compose's input limit saying so in the bar and
// offering Full writer, a PDF on Ultra's file area left to Ultra and a .docx's card (Open in Writer opens the pages);
// screenshots compact-*.png at 1280 and 640. Clicks in the frame go through tap() (below); waits are for a condition, and
// what must not happen is watched for a moment (quiet). GETs only, synthetic.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-submit-check.js [evidence directory]
// SUBMIT_SHOTS: where the screenshots go (default ~/Projects/glaze-plans/writer/mockups/build-submit); IMPORT_SHOTS, the
// import's (default ~/Projects/glaze-plans/writer/mockups/settings-ai/build-import); COMPACT_SHOTS, the compact box's
// (default ~/Projects/glaze-plans/writer/mockups/build-documents).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const FX = require('../test/fixtures/writer-paper-fixtures.js');
const DT = require('../lib/doctext.js');
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create', TEST = '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SUBMIT = '[data-analytics-id="assignment.attempt.authoring.footer.submit"]', SAVE = '[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]';
const out = process.argv[2] || path.join(os.tmpdir(), 'gz-submit-check');
const shots = process.env.SUBMIT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-submit');
const checks = [], requests = [], errors = [];
let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// state: what the timeout says was there instead (an object, read at the deadline).
const until = async (fn, label, ms = 15000, state = null) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  const was = state ? await Promise.resolve().then(state).then((x) => JSON.stringify(x), (e) => `unreadable: ${e.message}`) : '';
  throw Error(`${label} timed out after ${ms} ms${last ? `: ${last.message}` : ''}${was ? `; at the deadline ${was}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
// What must not happen after an action: fn stays false for ms (a window to watch, not a wait for something to finish).
const quiet = async (fn, label, ms = 600) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) throw Error(`${label}: it happened`); await pause(80); } return true; };
// A document at rest: no finite animation or transition running in it (a caret's blink runs on), then two frames drawn.
const STILL = () => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity);
const drawn = (target, n = 2) => target.evaluate((n) => new Promise((r) => { const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : r()); step(n); }), n);
const still = async (target) => { await until(() => target.evaluate(STILL), 'at rest'); await drawn(target); };
// A page and every frame in it at rest, as a screenshot wants them.
const stillAll = async (p) => { for (const f of p.frames()) await until(() => f.evaluate(STILL).catch(() => true), 'frames at rest'); await drawn(p); };

// A student's click on something in Writer's frame, made as one: the element settled where it is (nothing animating on it or
// its ancestors, the same box two polls running), in sight in the page, and the top thing at its centre both in the frame
// (elementFromPoint there: no part of Writer covers it) and in the page (the frame itself there); then the mouse there, and
// the click heard by that element. Headless Chromium sometimes gives a press over the frame to the page's <iframe> element
// instead (most often just after a sheet opens, and under load): the frame hears nothing, so nothing happened, and the press
// is made again. taps counts the presses made again, for the summary.
const taps = { made: 0, again: [] };
const AIM = (el) => {
  const name = (x) => (x ? `${x.tagName.toLowerCase()}${x.className && typeof x.className === 'string' ? `.${x.className.trim().split(/\s+/).join('.')}` : ''}` : 'nothing');
  for (let e = el; e; e = e.parentElement) if (e.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity)) return { why: `${name(e)} animating` };
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (!r.width || !r.height) return { why: 'not shown' };
  if (el.disabled) return { why: 'disabled' };
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); return { why: 'outside the frame, scrolled' }; }
  const top = document.elementFromPoint(x, y);
  if (!top || (top !== el && !el.contains(top))) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return { why: `covered by ${name(top)}` }; }
  return { x, y, box: [r.left, r.top, r.width, r.height].map(Math.round).join() };
};
const PLACE = (f, a) => {
  const r = f.getBoundingClientRect(), x = r.left + f.clientLeft + a.x, y = r.top + f.clientTop + a.y;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    let s = f.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    (s || document.scrollingElement).scrollBy(0, y - innerHeight / 2);
    return { why: 'outside the page\'s window, scrolled' };
  }
  const top = document.elementFromPoint(x, y);
  if (top !== f) return { why: `the page has ${top?.tagName.toLowerCase() || 'nothing'} over the frame there` };
  return { x, y, box: `${[r.left, r.top, r.width, r.height].map(Math.round).join()}|${a.box}` };
};
const HEAR = (el) => {
  if (!window.__tapOn) {
    window.__tapOn = true;
    addEventListener('click', (e) => { const t = window.__tap; if (!t) return; if (t.el === e.target || t.el.contains(e.target)) t.heard++; else t.other.push(`${e.target?.className || e.target?.tagName}@${Math.round(e.clientX)},${Math.round(e.clientY)}`); }, true);
  }
  window.__tap = { el, heard: 0, other: [] };
};
const MISS = (f) => {
  if (!window.__tapOn) { window.__tapOn = true; addEventListener('click', (e) => { window.__tapMiss.push(e.target === window.__tapFrame ? 'iframe' : `${e.target?.tagName?.toLowerCase()}.${String(e.target?.className || '').slice(0, 40)}`); }, true); }
  window.__tapFrame = f; window.__tapMiss = [];
};
const tap = async (fr, sel, { count = 1 } = {}) => {
  const p = fr.page(), frame = await fr.frameElement();
  for (let attempt = 1; ; attempt++) {
    let why = 'not in the frame', was = '', same = 0, at = null, aim = null;
    for (const end = Date.now() + 20000; !at; await pause(80)) {
      if (Date.now() > end) throw Error(`${sel}: not clickable (${why})`);
      const h = await fr.$(sel).catch(() => null);
      const a = h && await h.evaluate(AIM).catch((e) => ({ why: e.message }));
      if (!a) { why = 'not in the frame'; continue; }
      if (a.why) { why = a.why; was = ''; continue; }
      const place = await frame.evaluate(PLACE, a);
      if (place.why) { why = place.why; was = ''; continue; }
      // The same box three polls running: a frame Writer resizes in steps (a view switch, then its box) has settled.
      if (place.box !== was) { why = 'moving'; was = place.box; same = 0; continue; }
      if (++same < 2) continue;
      await h.evaluate(HEAR);
      at = place; aim = a;
    }
    await frame.evaluate(MISS);
    taps.made++;
    await p.mouse.click(at.x, at.y, { clickCount: count });
    let heard = null;
    for (const end = Date.now() + 15000; !heard && Date.now() < end; await pause(40)) {
      const t = await fr.evaluate(() => window.__tap && { heard: window.__tap.heard, other: window.__tap.other.slice() }).catch(() => null);
      if (t?.heard) heard = 'heard';
      else if (t?.other.length) heard = `landed on ${t.other.join(', ')}`;
      else {
        const miss = await p.evaluate(() => window.__tapMiss);
        if (miss.includes('iframe')) heard = 'given to the page\'s <iframe>';
        else if (miss.length) heard = `landed in the page on ${miss.join(', ')}`;
      }
    }
    if (heard === 'heard') return;
    if (!heard) throw Error(`${sel}: the click reached nothing`);
    taps.again.push(`${sel}: ${heard} (aimed at ${Math.round(aim.x)},${Math.round(aim.y)} in the frame)`);
    if (attempt >= 5) throw Error(`${sel}: ${attempt} clicks, none heard (${taps.again.slice(-attempt).join('; ')})`);
    // What the browser routes by is stale until the page re-lays the frame out (a repaint inside it doesn't do): its width
    // a pixel less for two frames, then as it was.
    await frame.evaluate(async (f) => {
      const two = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), was = f.style.width;
      f.style.width = `${f.getBoundingClientRect().width - 1}px`; await two();
      f.style.width = was; await two();
    });
  }
};

// The page's world: a real Quill on each writable box (as scripts/writer-paper-check.js), and on an assignment attempt
// the stand-in for Ultra's React file area and footer.
const HARNESS = `(() => {
  const mode = new URLSearchParams(location.search).get('mode') || '';
  const log = window.__log = []; window.__uploads = []; window.__clicks = []; window.__picker = 0;
  let q = null;
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id;
    c.innerHTML = '';
    q = new Quill(c, {});
    if (id) q.root.id = id;
    q.root.setAttribute('role', 'textbox');
    if (!mode.includes('empty') && /[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    window.__native = () => q.root.innerHTML;
    window.__text = () => q.getText();
  }
  for (const i of document.querySelectorAll('input[type=file]')) i.addEventListener('click', () => { window.__picker++; });
  document.addEventListener('click', (e) => { const b = e.target.closest('.footer button'); if (b) window.__clicks.push(b.getAttribute('analytics-id')); });
  const panel = document.querySelector('bb-assignment-attempt-authoring-panel');
  if (!panel) return;
  const style = document.createElement('style');
  style.textContent = '.Mui-disabled { pointer-events: none; }';
  document.head.append(style);
  const root = panel.firstElementChild, area = document.querySelector('[class*="makeStylessubmission-"]'), preview = area.querySelector('[class*="makeStylespreview-"]');
  if (mode.includes('gone')) preview.remove();
  if (mode.includes('noinput')) preview.querySelector('input').remove();
  const files = [];
  const footer = { save: document.querySelector('${SAVE}'), submit: document.querySelector('${SUBMIT}') };
  const state = () => {
    const on = !mode.includes('stuck') && (q.getText().trim().length > 0 || files.length > 0);
    for (const b of [footer.save, footer.submit]) { b.disabled = !on; b.classList.toggle('Mui-disabled', !on); b.tabIndex = on ? 0 : -1; }
  };
  q.on('text-change', state);
  state();
  const take = async (list, via) => {
    for (const f of list) { window.__uploads.push({ name: f.name, type: f.type, size: f.size, via, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }); log.push('upload'); }
    if (mode.includes('never')) return;
    setTimeout(() => {
      for (const f of list) {
        files.push(f);
        const row = document.createElement('div'), name = document.createElement('span');
        row.className = 'makeStylesfileRow-0-2-401'; name.className = 'makeStylesfileName-0-2-402'; name.textContent = f.name;
        row.append(name);
        (preview.isConnected ? preview : area).after(row);
      }
      log.push('row');
      state();
    }, 400);
  };
  root.addEventListener('change', (e) => { if (e.target.matches('input[type=file]')) take([...e.target.files], 'input'); });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => { if (e.target.closest('[class*="makeStylesinputContainer-"]')) { e.preventDefault(); take([...e.dataTransfer.files], 'drop'); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('footer button');
    if (!b) return;
    window.__clicks.push(b.getAttribute('data-analytics-id'));
    log.push('click:' + b.getAttribute('data-analytics-id'));
    if (b === footer.submit) { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.id = 'ultra-confirm'; d.textContent = 'Submit this attempt?'; document.body.append(d); }
  });
})();`;

(async () => {
  let context, held = false, tmp, ext;
  const lock = require('./check-env.js').lockPath();
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-submit-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-submit-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-submit-'));
    fs.mkdirSync(out, { recursive: true });
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    if (crypto.createHash('sha256').update(quill).digest('hex') !== QUILL.sha256) throw Error('Quill 1.3.7 hash mismatch');

    ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(15000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json'));
    const members = JSON.parse(fixture('ultra-memberships.json'));
    members.results = members.results.map((m) => (m.courseId === '_101_1' ? { ...m, course: { ...m.course, name: FX.context.course, displayName: FX.context.course } } : m));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      const page = { [ATTEMPT]: 'ultra-writer-attempt.html', [TEST]: 'ultra-writer-test.html' }[u.pathname];
      if (req.isNavigationRequest() && page) return r.fulfill({ contentType: 'text/html', body: fixture(page).replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' };
      else if (/\/users\/_900_1\/memberships$/.test(u.pathname)) data = members;
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, writerUploads: true, drafts: true }, writer: { full: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();
    const watch = (p, tag) => {
      p.on('pageerror', (e) => errors.push(`${tag}: ${e.message} @ ${String(e.stack || '').split('\n').slice(1, 5).map((l) => l.trim()).join(' | ')}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
    };
    const settle = (fr) => still(fr);
    const openAttempt = async (mode = '', keepPermit = false) => {
      if (!keepPermit) await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); });
      const p = await context.newPage();
      watch(p, `page${mode ? `?${mode}` : ''}`);
      await p.goto(`${site}${ATTEMPT}${mode ? `?mode=${mode}` : ''}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity && f.offsetHeight > 500) && x; }, 'paper frame shown', 30000);
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key() && !document.querySelector('.gp-submit').disabled), 'paper loaded and Submit… on', 30000);
      await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0 && document.querySelector('.gp-flow').style.visibility === ''), 'pages drawn', 30000);
      return { p, el, fr };
    };
    const sheetOpen = (fr) => until(() => fr.evaluate(() => !!document.querySelector('.gs-layer[data-open]')), 'sheet open');
    const sheetText = (fr) => fr.evaluate(() => {
      const L = document.querySelector('.gs-layer'), q = (s) => L?.querySelector(s);
      return L && { title: q('h2').textContent, label: q('.gs-field label').textContent, name: q('.gs-name').textContent, size: q('.gs-file small').textContent, toggle: q('.gs-toggle span').textContent, sw: q('.gs-sw').getAttribute('aria-checked'),
        open: q('.gs-open')?.textContent || '', err: q('.gs-err').textContent, buttons: [...L.querySelectorAll('.gs-foot button')].map((b) => b.textContent), thumbs: L.querySelectorAll('.gs-thumb').length,
        thumbText: [...L.querySelectorAll('.gs-thumb')].map((x) => squash(x.querySelector('.ProseMirror')?.textContent).length), offsets: [...L.querySelectorAll('.gs-thumb .gp-flow')].map((x) => parseFloat(x.style.top)), headers: [...L.querySelectorAll('.gs-thumb .gp-hdr')].map((x) => x.textContent) };
      function squash(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    });
    const versions = () => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerVersions:')); return (all[k] || []).map((v) => v.reason); });
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await stillAll(target); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};
    const center = async (p, sel) => { const b = await p.$eval(sel, (x) => { x.scrollIntoView({ block: 'center' }); const r = x.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); return b; };

    // ---- the sheet's look, over the 6-page MLA fixture
    let { p, el, fr } = await openAttempt();
    await fr.evaluate(async (json) => {
      const v = GZ_WRITER_PAPER.current().editor.view;
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(json).content));
    }, FX.papers.mla9());
    await settle(fr);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('(Morrison 35)')) at = pos + n.text.indexOf('(Morrison 35)'); }); v.dispatch(v.state.tr.insertText('(Morrison, 42)', at, at + '(Morrison 35)'.length)); });
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved' && (globalThis.GZ_WRITER_ISSUES?.list().length || 0) > 0), 'saved, with a check open');
    await settle(fr);
    const before = { versions: (await versions()).length, native: await p.evaluate(() => __text()) };
    await tap(fr, '.gp-tbtn[aria-label="Focus"]');
    await until(() => el.evaluate((f) => getComputedStyle(f).position === 'fixed'), 'focus fills the window');
    await settle(fr);
    // The sheet's first drawn frame, while it still rises: is each control the top thing at its centre's final place?
    await fr.evaluate(() => {
      window.__first = null;
      const o = new MutationObserver(() => {
        const L = document.querySelector('.gs-layer');
        if (!L) return;
        o.disconnect();
        requestAnimationFrame(() => {
          const s = L.querySelector('.gs-sheet'), m = getComputedStyle(s).transform, ty = m === 'none' ? 0 : new DOMMatrixReadOnly(m).m42;
          window.__first = { ty: Math.round(ty * 10) / 10, hits: ['.gs-primary', '.gs-foot .gs-btn:not(.gs-primary)', '.gs-review', '#gs-note'].map((q) => {
            const e = L.querySelector(q), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 - ty);
            return !!t && (t === e || e.contains(t));
          }) };
        });
      });
      o.observe(document.body, { childList: true });
    });
    await tap(fr, '.gp-submit');
    await sheetOpen(fr);
    const first = await until(() => fr.evaluate(() => window.__first), 'the sheet\'s first frame');
    check(first.hits.every(Boolean), `from its first frame (${first.ty}px still to rise) Submit, Cancel, Review and the note each take a click at their place`);
    await until(() => fr.evaluate(() => / KB$/.test(document.querySelector('.gs-file small').textContent)), 'file size shown');
    const look = await sheetText(fr);
    console.log(JSON.stringify(look));
    const pages = await fr.evaluate(() => GZ_WRITER_PAPER.current().pages());
    check(look.title === 'Submit Essay 2' && look.label === 'Note to Professor Okafor' && look.toggle === 'Also paste the text in the text box' && look.sw === 'false', 'sheet: "Submit Essay 2", the note to the instructor the heading names, the paste switch off');
    check(look.name === 'Rivera_Essay2.docx' && new RegExp(`^${pages} pages · \\d+ KB$`).test(look.size), `file chip: Rivera_Essay2.docx · ${look.size}`);
    check(look.thumbs === 2 && look.headers.join('|') === 'Rivera 1|Rivera 2' && look.thumbText.every((n) => n > 1000) && look.offsets[0] === 0 && look.offsets[1] < -1000, 'the first two pages drawn from the paged view (each its own header, the text flow shifted to its page), not placeholders');
    check(/^\d+ checks? open/.test(look.open) && /Review$/.test(look.open), `open checks banner: "${look.open}"`);
    check(look.buttons.join('|') === 'Cancel|Submit' && look.err === '', 'Cancel and Submit, no error');
    check(await fr.evaluate(() => { const s = getComputedStyle(document.querySelector('.gs-sheet')); return s.transitionDuration.split(',').every((d) => d.trim() === '0.16s') && /opacity/.test(s.transitionProperty) && /transform/.test(s.transitionProperty); }), 'the sheet rises and fades in over 160 ms (transform and opacity only)');
    saved.sheet = await shot(p, 'submit.png');
    // Focus stays in the sheet: Tab and Shift+Tab wrap.
    const inside = async () => fr.evaluate(() => !!document.activeElement?.closest('.gs-layer'));
    check(await fr.evaluate(() => document.activeElement?.id === 'gs-note'), 'the note has focus when the sheet opens');
    let trapped = true;
    for (let i = 0; i < 9; i++) { await p.keyboard.press('Tab'); trapped &&= await inside(); }
    for (let i = 0; i < 9; i++) { await p.keyboard.press('Shift+Tab'); trapped &&= await inside(); }
    check(trapped, 'Tab and Shift+Tab stay in the sheet');
    check(await fr.evaluate(() => document.querySelector('.gp').inert), 'the paper behind is inert while the sheet is open');
    // Review jumps to Checks.
    await tap(fr, '.gs-review');
    check(await fr.evaluate(() => !document.querySelector('.gs-layer') && document.getElementById('gp-tab-checks').getAttribute('aria-selected') === 'true' && !!document.activeElement?.closest('#gp-checks, #gp-tab-checks')), 'Review closes the sheet and goes to the Checks tab');
    // Cancel and Escape change nothing.
    await fr.evaluate(() => { window.__was = document.activeElement; });
    await tap(fr, '.gp-submit');
    await sheetOpen(fr);
    await p.keyboard.type('A note never sent.', { delay: 2 });
    await tap(fr, '.gs-sw');
    check(await fr.evaluate(() => document.querySelector('.gs-sw').getAttribute('aria-checked') === 'true'), 'the switch turns on');
    await tap(fr, '.gs-foot .gs-btn:not(.gs-primary)');
    check(await fr.evaluate(() => !document.querySelector('.gs-layer') && document.activeElement === window.__was && window.__was !== document.body), 'Cancel closes it, focus back where it was');
    await tap(fr, '.gp-submit');
    await sheetOpen(fr);
    check(await fr.evaluate(() => document.querySelector('#gs-note').value === '' && document.querySelector('.gs-sw').getAttribute('aria-checked') === 'false'), 'a new sheet starts blank');
    await p.keyboard.press('Escape');
    check(await fr.evaluate(() => !document.querySelector('.gs-layer') && document.querySelector('.gp-tbtn[aria-label="Focus"]').getAttribute('aria-pressed') === 'true'), 'Escape closes the sheet only (Focus stays)');
    await quiet(() => p.evaluate(() => __uploads.length > 0 || __clicks.length > 0 || __picker > 0), 'Ultra heard from a cancelled sheet');
    check(await p.evaluate(() => __uploads.length === 0 && __clicks.length === 0 && __picker === 0) && (await versions()).length === before.versions && await p.evaluate(() => __text()) === before.native, 'Cancel and Escape change nothing: no file, no click, no text in Ultra\'s box, no version');
    await tap(fr, '.gp-tbtn[aria-label="Focus"]');
    await until(() => el.evaluate((f) => getComputedStyle(f).position !== 'fixed'), 'focus off');
    await settle(fr);
    await tap(fr, '.gp-submit');
    await sheetOpen(fr);
    saved.panel = await shot(p, 'submit-panel.png');
    await p.keyboard.press('Escape');
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await tap(fr, '.gp-submit');
    await sheetOpen(fr);
    check(await fr.evaluate(() => getComputedStyle(document.querySelector('.gs-sheet')).transitionDuration.split(',').every((d) => d.trim() === '0s')), 'with reduced motion the sheet appears without motion');
    await p.keyboard.press('Escape');
    await p.emulateMedia({ reducedMotion: null });

    // ---- Ultra's own buttons, enabled (its box holds the fixture's text): caught before Ultra
    await p.click(SUBMIT);
    await sheetOpen(fr);
    check(await p.evaluate(() => !__clicks.length), 'Ultra\'s Submit (enabled) opens the sheet and Ultra never hears the click');
    await p.keyboard.press('Escape');
    const savedAt = await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerPaper:')); return all[k]?.updated || 0; });
    await p.click(SAVE);
    await until(() => p.evaluate(() => __clicks.includes('course.content.assessment.footer.buttons.saveAndClose')), 'Save and Close goes on');
    const savedAfter = await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); const k = Object.keys(all).find((x) => x.startsWith('writerPaper:')); return all[k]?.updated || 0; });
    check(savedAfter > savedAt && await p.evaluate(() => __clicks.join() === 'course.content.assessment.footer.buttons.saveAndClose' && !__uploads.length), 'Save and Close saves the paper first, then Ultra\'s own goes on, once, attaching nothing');
    await p.close();

    // ---- the whole flow, by keyboard, from Ultra's disabled Submit (its box empty)
    ({ p, el, fr } = await openAttempt('empty'));
    check(await p.evaluate((s) => document.querySelector(s).disabled, SUBMIT), 'Ultra\'s Submit is disabled while its box is empty');
    const at = await center(p, SUBMIT);
    await p.mouse.click(at.x, at.y);
    await sheetOpen(fr);
    check(true, 'a press on Ultra\'s disabled Submit opens the sheet');
    const docText = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.text());
    await p.keyboard.type('Thank you for the extension.', { delay: 2 });
    await p.keyboard.press('Tab');
    check(await fr.evaluate(() => document.activeElement?.id === 'gs-paste'), 'Tab moves to the switch');
    await p.keyboard.press('Space');
    check(await fr.evaluate(() => document.querySelector('.gs-sw').getAttribute('aria-checked') === 'true'), 'Space turns it on');
    for (let i = 0; i < 4 && !await fr.evaluate(() => document.activeElement?.classList.contains('gs-primary')); i++) await p.keyboard.press('Tab');
    check(await fr.evaluate(() => document.activeElement?.classList.contains('gs-primary')), 'Tab reaches Submit');
    const versionsBefore = (await versions()).length;
    await p.keyboard.press('Enter');
    await until(() => p.evaluate(() => __clicks.length > 0), 'Ultra\'s Submit clicked', 30000);
    await until(async () => await p.evaluate(() => !!document.getElementById('ultra-confirm')) && await fr.evaluate(() => !document.querySelector('.gs-layer')) && (await versions())[0] === 'submit', 'Ultra\'s confirmation, the sheet closed, the version marked Submitted');
    const run = await p.evaluate(() => ({ uploads: __uploads, log: __log, clicks: __clicks, picker: __picker, text: __text(), confirm: !!document.getElementById('ultra-confirm') }));
    check(run.uploads.length === 1 && run.uploads[0].name === 'Rivera_Essay2.docx' && run.uploads[0].type === MIME && run.uploads[0].via === 'input' && run.picker === 0, 'the .docx lands in the file area\'s input (Rivera_Essay2.docx, the Word type), no file picker opened');
    const bytes = Buffer.from(run.uploads[0].bytes);
    fs.writeFileSync(path.join(out, 'Rivera_Essay2.docx'), bytes);
    const read = squash(await DT.docx(new Uint8Array(bytes)));
    const paras = docText.split('\n').map(squash).filter((x) => x.length > 20);
    const missing = paras.filter((x) => !read.includes(x));
    if (missing.length) console.log('missing from the .docx:', JSON.stringify(missing));
    check(paras.length >= 15 && !missing.length && bytes.length === run.uploads[0].size, `its bytes read back (lib/doctext.js) as the paper: all ${paras.length} paragraphs`);
    check(run.text.startsWith('Thank you for the extension.\n\nAlex Rivera\n') && squash(run.text).includes(paras.at(-1)), 'the note, then the paper\'s text, land in Ultra\'s Quill');
    check(run.clicks.join() === 'assignment.attempt.authoring.footer.submit', 'Ultra\'s Submit clicked exactly once');
    check(run.log.indexOf('row') > run.log.indexOf('upload') && run.log.indexOf('click:assignment.attempt.authoring.footer.submit') > run.log.indexOf('row'), `and only after Ultra listed the file (${run.log.join(' → ')})`);
    const reasons = await versions();
    check(reasons.length === versionsBefore + 1 && reasons[0] === 'submit', 'a version was saved as Submitted');
    check(run.confirm && await fr.evaluate(() => !document.querySelector('.gs-layer')), 'the sheet closes; Ultra\'s confirmation is Ultra\'s');
    await p.close();

    // ---- Settings → Writer → Submitting: the paste switch remembered, set before the frame loads and switched live
    const W0 = G.GZ_SANITIZE({ writer: { full: true } }).writer, setW = (w) => worker.evaluate((w) => chrome.storage.sync.set({ writer: w }), G.GZ_SANITIZE({ writer: w }).writer);
    const keptW = async () => (await worker.evaluate(() => chrome.storage.sync.get('writer'))).writer?.submit;
    const followed = (fr, w) => until(() => fr.evaluate((w) => { const n = GZ_WRITER_SETTINGS.now()?.submit; return n?.rememberText === w.rememberText && n?.text === w.text; }, w), 'the frame follows Settings');
    check((await keptW())?.text === true, 'remembered by default: the switch turned on above is kept (writer.submit.text)');
    const cancelSheet = async (fr) => { await tap(fr, '.gs-foot button:has-text("Cancel")'); await until(() => fr.evaluate(() => !document.querySelector('.gs-layer')), 'sheet closed'); };
    await setW({ ...W0, submit: { rememberText: true, text: true } });
    ({ p, el, fr } = await openAttempt('gone'));
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'true', 'remember on, left on, before the frame loads: the sheet opens with the switch on');
    await tap(fr, '#gs-paste'); await cancelSheet(fr);
    check(await quiet(async () => (await keptW()).text !== true, 'the switch kept on Cancel'), 'turned off and cancelled: nothing kept');
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'true', 'so the next sheet starts on again');
    // A Submit that fails (no file area on this page) still keeps the choice it was pressed with.
    await tap(fr, '#gs-paste');
    await tap(fr, '.gs-primary');
    await until(async () => (await keptW()).text === false, 'kept off at Submit');
    await until(() => fr.evaluate(() => document.querySelector('.gs-err')?.textContent !== ''), 'the failure said');
    check(true, 'Submit keeps the switch as pressed (off)');
    await cancelSheet(fr);
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'false', 'and the next sheet starts off');
    await cancelSheet(fr);
    await setW({ ...W0, submit: { rememberText: false, text: false } });
    await followed(fr, { rememberText: false, text: false });
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    await tap(fr, '#gs-paste');
    await tap(fr, '.gs-primary');
    await until(() => fr.evaluate(() => document.querySelector('.gs-err')?.textContent !== ''), 'the failure said');
    check(await quiet(async () => (await keptW()).text !== false, 'the switch kept with remember off'), 'remember switched off live: a Submit with the switch on keeps nothing');
    await cancelSheet(fr);
    await setW({ ...W0, submit: { rememberText: true, text: true } });
    await followed(fr, { rememberText: true, text: true });
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    check((await sheetText(fr)).sw === 'true', 'remember switched on live: the switch starts where it was left');
    await cancelSheet(fr);
    await p.close();
    await setW(W0);

    // ---- a drop when the input isn't drawn, and a double click submits once
    ({ p, el, fr } = await openAttempt('empty,noinput'));
    await tap(fr, '.gp-submit');
    await sheetOpen(fr);
    await tap(fr, '.gs-primary', { count: 2 });
    await until(() => p.evaluate(() => __clicks.length > 0), 'submitted after a drop', 30000);
    await until(() => fr.evaluate(() => !document.querySelector('.gs-layer')), 'the sheet closed after its Submit');
    await quiet(() => p.evaluate(() => __clicks.length > 1 || __uploads.length > 1), 'a second Submit');
    const drop = await p.evaluate(() => ({ uploads: __uploads.map((u) => [u.name, u.via]), clicks: __clicks, text: __text(), picker: __picker }));
    check(drop.uploads.length === 1 && drop.uploads[0].join() === 'Rivera_Essay2.docx,drop' && drop.picker === 0, 'without its input, the file is dropped on Ultra\'s drop zone (no picker)');
    check(drop.clicks.length === 1 && drop.text === '\n', 'a double click submits once; nothing chosen, nothing written into Ultra\'s box');
    await p.close();

    // ---- a second tab shares the attempt fence, even after the first native footer is remounted
    ({ p, el, fr } = await openAttempt('empty'));
    const second = await openAttempt('empty', true);
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    await tap(second.fr, '.gp-submit'); await sheetOpen(second.fr);
    await Promise.all([tap(fr, '.gs-primary'), tap(second.fr, '.gs-primary')]);
    await until(async () => (await p.evaluate(() => __clicks.length)) + (await second.p.evaluate(() => __clicks.length)) === 1, 'one tab submits');
    await until(async () => (await fr.evaluate(() => !!document.querySelector('.gs-err')?.textContent)) || (await second.fr.evaluate(() => !!document.querySelector('.gs-err')?.textContent)), 'other tab refused');
    check((await p.evaluate(() => __uploads.length)) + (await second.p.evaluate(() => __uploads.length)) === 1, 'two tabs: exactly one upload and one native Submit for the attempt');
    await p.close(); await second.p.close();

    // ---- Cancel remains usable during upload and revokes all later submission work
    ({ p, el, fr } = await openAttempt('empty'));
    await tap(fr, '.gp-submit'); await sheetOpen(fr); await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => __uploads.length === 1), 'upload started');
    check(await fr.evaluate(() => !document.querySelector('.gs-foot .gs-btn').disabled && document.activeElement?.closest('.gs-layer')), 'busy: focus stays in the sheet and Cancel remains available');
    await tap(fr, '.gs-foot .gs-btn:not(.gs-primary)');
    await until(() => p.evaluate(() => __log.includes('row')), 'Ultra listed the upload');
    await quiet(() => p.evaluate(() => __clicks.length > 0), 'Ultra\'s Submit after Cancel', 1000);
    check(await p.evaluate(() => !__clicks.length && __uploads.length === 1) && await fr.evaluate(() => /review or remove/.test(document.querySelector('.gs-err').textContent) && !document.querySelector('.gs-native').hidden), 'Cancel during upload never submits and offers Blackboard review of the retained upload');
    await p.close();

    // ---- a same-named file needs native review; hand-back immediately releases capture interception
    ({ p, el, fr } = await openAttempt());
    await p.evaluate(() => { const n = document.createElement('span'); n.textContent = 'Rivera_Essay2.docx'; document.querySelector('[class*="makeStylessubmission-"]').append(n); });
    await tap(fr, '.gp-submit'); await sheetOpen(fr); await tap(fr, '.gs-primary');
    await until(() => fr.evaluate(() => !!document.querySelector('.gs-err').textContent), 'existing attachment refused');
    check(await p.evaluate(() => !__uploads.length && !__clicks.length), 'a pre-existing same-named file never triggers another upload or Submit');
    await tap(fr, '.gs-native');
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer')), 'Blackboard editor restored');
    await p.click(SUBMIT);
    check(await p.evaluate(() => __clicks.join() === 'assignment.attempt.authoring.footer.submit'), 'Blackboard editor hand-back releases native Submit interception');
    await p.close();

    // ---- failures stop before Submit
    const fail = async (mode, re, ms, label) => {
      const o = await openAttempt(mode);
      await tap(o.fr, '.gp-submit');
      await sheetOpen(o.fr);
      await tap(o.fr, '.gs-primary');
      await until(() => o.fr.evaluate(() => document.querySelector('.gs-err').textContent), `${mode} error`, ms);
      const s = await sheetText(o.fr);
      const r = await o.p.evaluate(() => ({ clicks: __clicks.filter((c) => /submit/.test(c)), uploads: __uploads.length, picker: __picker }));
      check(re.test(s.err) && r.clicks.length === 0 && r.picker === 0 && await o.fr.evaluate(() => !document.querySelector('.gs-primary').disabled), `${label}: "${s.err}"; Submit never clicked`);
      return { ...o, r };
    };
    ({ p } = await fail('empty,gone', /file upload isn’t on this page/, 8000, 'no file area'));
    await p.close();
    let f = await fail('empty,never', /didn’t list the file/, 45000, 'the file never listed');
    saved.error = await shot(f.p, 'submit-error.png');
    await f.p.close();
    f = await fail('stuck', /Submit didn’t turn on/, 30000, 'Ultra\'s Submit never enabled');
    check(f.r.uploads === 1, 'after attaching once');
    await tap(f.fr, '.gs-primary');
    await until(() => f.fr.evaluate(() => !document.querySelector('.gs-primary').disabled && document.querySelector('.gs-err').textContent), 'second try ends', 30000);
    check(await f.p.evaluate(() => __uploads.length === 1 && !__clicks.some((c) => /submit/.test(c))), 'a second, explicit try doesn\'t attach a second copy, and still never submits');
    await f.p.close();

    // ---- a slow worker, one that never answers, and a press before the frame is up (the full view)
    // storage: the worker's chrome.storage.local writes held ms each, held until let go ('never'), or as they were ('free').
    const storage = (mode) => worker.evaluate((mode) => {
      const a = chrome.storage.local, own = globalThis.__gzSet ||= a.set;
      globalThis.__gzOpen?.(); globalThis.__gzOpen = null;
      if (mode === 'free') a.set = own;
      else if (mode === 'never') { const gate = new Promise((r) => { globalThis.__gzOpen = r; }); a.set = function (...args) { return gate.then(() => own.apply(a, args)); }; }
      else a.set = function (...args) { return new Promise((r) => setTimeout(r, mode)).then(() => own.apply(a, args)); };
      return true;
    }, mode);
    const stateOf = (fr) => fr.evaluate(() => document.querySelector('.gp-state').textContent);
    const busyOf = (p, sel) => p.evaluate((s) => document.querySelector(s)?.getAttribute('aria-busy') || '', sel);
    const SAVED_CLOSE = 'course.content.assessment.footer.buttons.saveAndClose';
    ({ p, el, fr } = await openAttempt());
    await storage(6000);
    let t0 = Date.now();
    await p.click(SAVE);
    check(await p.evaluate(() => !__clicks.length) && await busyOf(p, SAVE) === 'true', 'a slow save (the worker\'s writes held 6 s): Ultra\'s Save and Close held, marked busy');
    await until(async () => (await stateOf(fr)) === 'Saving…', 'the title bar saying Saving…');
    await until(() => p.evaluate((id) => __clicks.includes(id), SAVED_CLOSE), 'Save and Close after the slow save', 40000);
    let spent = Date.now() - t0;
    await quiet(() => p.evaluate(() => __clicks.length > 1), 'a second Save and Close', 800);
    check(spent >= 5500 && await p.evaluate((id) => __clicks.join() === id, SAVED_CLOSE) && !await busyOf(p, SAVE), `then it goes once the save lands (${spent} ms, past the old 4 s bound), the title bar having said Saving…`);
    await storage('free');
    await p.close();
    ({ p, el, fr } = await openAttempt('empty'));
    await storage(6000);
    await tap(fr, '.gp-submit'); await sheetOpen(fr);
    t0 = Date.now();
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'Ultra\'s confirmation after the slow saves', 60000);
    spent = Date.now() - t0;
    await storage('free');
    await quiet(() => p.evaluate(() => __clicks.length > 1 || __uploads.length > 1), 'a second Submit');
    await until(async () => (await versions())[0] === 'submit', 'the version marked Submitted');
    check(spent >= 5500 && await p.evaluate(() => __clicks.join() === 'assignment.attempt.authoring.footer.submit' && __uploads.length === 1) && await fr.evaluate(() => !document.querySelector('.gs-layer')), `Submit… with every save held 6 s completes after them (${spent} ms): the .docx attached once, Ultra's Submit once, the version marked Submitted`);
    await p.close();
    // The worker never answering: the frame gives up on the save after its bound and says so; Ultra's button is let go,
    // and isn't pressed when the save lands at last (the student presses again).
    ({ p, el, fr } = await openAttempt());
    await storage('never');
    t0 = Date.now();
    await p.click(SAVE);
    const toastOf = () => fr.evaluate(() => document.querySelector('.gp-toast span')?.textContent || '');
    await until(async () => (await toastOf()) === 'Not saved. Try again in a moment.', 'the frame giving up on the save, saying so', 45000);
    spent = Date.now() - t0;
    await until(async () => !await busyOf(p, SAVE), 'Ultra\'s button let go');
    check(spent >= 25000 && spent < 40000 && await p.evaluate(() => !__clicks.length), `a worker that never answers: after ${spent} ms the paper says "Not saved. Try again in a moment.", Ultra's Save and Close not pressed and no longer busy`);
    await storage('free');
    await until(async () => (await stateOf(fr)) === 'Saved', 'the held save landing once the worker answers', 30000);
    await quiet(() => p.evaluate(() => __clicks.length > 0), 'Save and Close after the late save', 1000);
    await p.click(SAVE);
    await until(() => p.evaluate((id) => __clicks.join() === id, SAVED_CLOSE), 'Save and Close pressed again');
    check(true, 'the held save landing at last presses nothing; pressed again, Save and Close goes');
    await p.close();
    // A press as Writer reopens the frame (it reloaded) or as the reloaded page's frame goes in: held until the frame is up
    // (Ultra hears nothing of it), then the sheet opens, or the paper is saved and Ultra's Save and Close goes once.
    const watchPress = (p) => p.evaluate(() => { window.__press = []; addEventListener('click', (e) => { const b = e.target.closest?.('footer button'), f = document.querySelector('iframe.gz-writer'); if (b && e.isTrusted) window.__press.push({ id: b.getAttribute('data-analytics-id'), up: !!f && !f.style.opacity }); }, true); });
    const pressReopening = async (sel) => {
      const o = await openAttempt();
      await watchPress(o.p);
      const old = o.el;
      await o.fr.evaluate(() => setTimeout(() => location.reload(), 0));
      await until(() => old.evaluate((f) => !f.isConnected), 'the frame reopening');
      const t = Date.now(), b = await center(o.p, sel);
      await o.p.mouse.click(b.x, b.y);
      const after = Date.now() - t;
      o.el = await until(() => o.p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'), 'the new frame');
      o.fr = await until(() => o.el.contentFrame(), 'its document');
      return { ...o, after };
    };
    let r = await pressReopening(SUBMIT);
    await sheetOpen(r.fr);
    let press = await r.p.evaluate(() => window.__press);
    check(r.after < 200 && press.length === 1 && press[0].up === false && await r.p.evaluate(() => !__clicks.length), `Ultra's Submit pressed ${r.after} ms into the frame reopening, before it was up: the sheet opens once it is, Ultra never hearing the press (${JSON.stringify({ press, clicks: await r.p.evaluate(() => __clicks) })})`);
    await r.p.close();
    r = await pressReopening(SAVE);
    await until(() => r.p.evaluate((id) => __clicks.includes(id), SAVED_CLOSE), 'Save and Close once the new frame saved', 30000);
    await quiet(() => r.p.evaluate(() => __clicks.length > 1), 'a second Save and Close', 800);
    press = await r.p.evaluate(() => window.__press);
    check(r.after < 200 && press[0]?.up === false && await r.p.evaluate((id) => __clicks.join() === id, SAVED_CLOSE), `Save and Close pressed ${r.after} ms into the frame reopening: once the new frame has saved the paper, Ultra's own goes, once (${JSON.stringify({ press, clicks: await r.p.evaluate(() => __clicks) })})`);
    await r.p.close();
    ({ p, el, fr } = await openAttempt());
    await p.reload();
    await watchPress(p);
    await p.waitForSelector('iframe.gz-writer[data-gz-writer-frame="assignment"]', { state: 'attached', timeout: 30000 });
    t0 = Date.now();
    const sub = await center(p, SUBMIT);
    await p.mouse.click(sub.x, sub.y);
    spent = Date.now() - t0;
    el = await until(() => p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'), 'the reloaded page\'s frame');
    fr = await until(() => el.contentFrame(), 'its document');
    await sheetOpen(fr);
    press = await p.evaluate(() => window.__press);
    check(spent < 200 && press.length === 1 && press[0].up === false && await p.evaluate(() => !__clicks.length && !document.getElementById('ultra-confirm')), `the attempt reloaded, Ultra's Submit (on, its box holding text) pressed ${spent} ms after the paper's frame went in, before it was up: held, then the sheet; Ultra submitted nothing (${JSON.stringify({ press, clicks: await p.evaluate(() => __clicks) })})`);
    await p.keyboard.press('Escape');
    await p.close();

    // ---- bringing a file: on the paper, in Ultra's own file area, a PDF, ⋯ → Import…, and the switch off
    const ishots = process.env.IMPORT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/settings-ai/build-import');
    const ishot = async (target, name) => { fs.mkdirSync(ishots, { recursive: true }); await stillAll(target); const f = path.join(ishots, name); await target.screenshot({ path: f }); return f; };
    const sha = (b) => crypto.createHash('sha256').update(Buffer.from(b)).digest('hex');
    // No paper in Writer's storage, and none coming back: a page just closed may still be saving its paper (its frame's
    // pagehide save, queued in the worker), which would land after the removal and open in the next page.
    const papersKept = () => worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter((k) => /^writer(Paper|Versions):/.test(k)));
    const blankPaper = async () => {
      for (let i = 0; i < 10; i++) {
        await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => /^writer(Paper|Versions):/.test(k))); });
        let back = [];
        for (const end = Date.now() + 1500; !back.length && Date.now() < end; await pause(100)) back = await papersKept();
        if (!back.length) return;
      }
      throw Error(`Writer's papers kept coming back: ${(await papersKept()).join(', ')}`);
    };
    const paperText = (fr) => fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.textContent);
    const cardOf = (fr) => fr.evaluate(() => {
      const c = document.querySelector('.gi-layer[data-open] .gi-card');
      return c && { name: c.querySelector('.gi-file b').textContent, meta: c.querySelector('.gi-file small').textContent, tiles: [...c.querySelectorAll('.gi-choice > span:first-of-type')].map((x) => x.textContent),
        kept: c.querySelector('.gi-kept')?.textContent || '', focus: !!document.activeElement?.classList.contains('gi-default') };
    });
    const asisOf = (fr) => fr.evaluate(() => {
      const L = document.querySelector('.gs-layer[data-open]'), q = (x) => L?.querySelector(x);
      return L && { asis: !!q('.gs-asis'), big: q('.gs-big .gs-doc')?.textContent || '', name: q('.gs-name').textContent, size: q('.gs-file small').textContent, toggle: !!q('.gs-toggle'), open: !!q('.gs-open'), thumbs: L.querySelectorAll('.gs-thumb').length, title: q('h2').textContent };
    });
    // In the frame, a .docx of the APA fixture as Writer writes one: what a student brings.
    ({ p, el, fr } = await openAttempt('empty'));
    const essay = Buffer.from(await fr.evaluate(async (json) => {
      await GZ_WRITER_PAPER.need(['lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js']);
      return Array.from((await GZ_WRITER_DOCX.exportDocx(GZ_WRITER_SCHEMA.paper.nodeFromJSON(json), { format: GZ_WRITER_STYLES.get('apa7'), surname: 'Rivera', title: 'Essay 2' })).bytes);
    }, FX.papers.apa7()));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n%synthetic\n'), crypto.randomBytes(4096), Buffer.from('\n%%EOF\n')]);
    const files = path.join(out, 'import');
    fs.mkdirSync(files, { recursive: true });
    fs.writeFileSync(path.join(files, 'Rivera_Essay2.docx'), essay);
    fs.writeFileSync(path.join(files, 'Rivera_Essay2.pdf'), pdf);
    const marker = (() => { let x = ''; JSON.stringify(FX.papers.apa7(), (k, v) => { if (k === 'text' && !x && v.length > 60) x = v; return v; }); return x.slice(0, 50); })();
    await p.close();
    await blankPaper();
    ({ p, el, fr } = await openAttempt('empty'));
    const give = (target, sel, name, type, bytes, drop = true) => target.evaluate(({ sel, name, type, bytes, drop }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type }));
      const at = document.querySelector(sel);
      for (const t of ['dragenter', 'dragover', ...(drop ? ['drop'] : [])]) at.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { sel, name, type, bytes: Array.from(bytes), drop });
    // A .docx over the paper, then dropped on it: the card, over an empty paper with no word about saving it.
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay, false);
    check(await fr.evaluate(() => document.querySelector('.gp-canvas').classList.contains('gp-drop')), 'a file over the paper marks it as a drop target');
    saved.dragPaper = await ishot(p, 'import-drag-paper-dark.png');
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card');
    let card = await cardOf(fr);
    console.log(JSON.stringify(card));
    check(card.name === 'Rivera_Essay2.docx' && /^\d+ KB$/.test(card.meta) && card.tiles.join('|') === 'Open in Writer|Submit as is' && !card.kept && card.focus, `a .docx dropped on the paper: the card (${card.meta}), Open in Writer focused for Enter, no "Saves current paper" over an empty paper`);
    check(await fr.evaluate(() => document.querySelector('.gp').inert), 'the paper behind is inert while the card is open');
    check(await fr.evaluate(() => { const c = getComputedStyle(document.querySelector('.gi-card')); return c.transitionDuration.split(',').every((d) => d.trim() === '0.16s') && /transform/.test(c.transitionProperty); }), 'the card rises and fades in over 160 ms');
    saved.choiceDocx = await ishot(p, 'import-choice-docx-dark.png');
    let cardTrapped = true;
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) { await p.keyboard.press(key); cardTrapped &&= await fr.evaluate(() => !!document.activeElement?.closest('.gi-card')); }
    check(cardTrapped, 'the import card traps Tab and Shift+Tab');
    const plain = await paperText(fr), countBefore = (await versions()).length;
    await p.keyboard.press('Escape');
    check(await fr.evaluate(() => !document.querySelector('.gi-layer') && !document.querySelector('.gp').inert) && await paperText(fr) === plain && (await versions()).length === countBefore, 'Escape closes the card and changes nothing');
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card again');
    await tap(fr, '.gi-x');
    check(await fr.evaluate(() => !document.querySelector('.gi-layer')) && await paperText(fr) === plain && (await versions()).length === countBefore && await p.evaluate(() => !__uploads.length), 'its close button changes nothing either');
    // A paper with text (in its last empty paragraph, the body's, not a heading line): Open in Writer says it saves it, Enter opens the file, Undo brings the paper back.
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = null; v.state.doc.forEach((n, off) => { if (n.type.name === 'paragraph' && !n.content.size) at = off + 1; }); v.dispatch(v.state.tr.insertText('A draft that the import replaces.', at ?? v.state.doc.content.size - 1)); });
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'draft saved');
    const checksPane = () => fr.evaluate(() => [...document.querySelectorAll('#gp-checks .gp-issue, #gp-checks .gp-list > div')].map((x) => x.textContent).join('|'));
    const draft = await paperText(fr), issuesBefore = await checksPane();
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card over the draft');
    card = await cardOf(fr);
    check(card.kept === 'Saves current paper', 'over a paper with text, Open in Writer carries "Saves current paper"');
    saved.choiceReplace = await ishot(p, 'import-choice-replace-dark.png');
    const beforeCount = (await versions()).length;
    await p.keyboard.press('Enter');
    await until(async () => (await paperText(fr)).includes(marker), 'the file opened in Writer');
    await settle(fr);
    const kept = await versions();
    check(kept.length === beforeCount + 1 && kept[0] === 'import' && !(await paperText(fr)).includes('A draft that the import replaces.'), 'Enter (Open in Writer): the paper is the file\'s text, the draft kept as a version first');
    const toast = await fr.evaluate(() => ({ text: document.querySelector('.gp-toast span')?.textContent, undo: document.querySelector('.gp-toast .gp-toast-do')?.textContent }));
    check(toast.text === 'Rivera_Essay2.docx' && toast.undo === 'Undo', 'a toast with the file\'s name and Undo');
    await until(async () => (await checksPane()) !== issuesBefore, 'Checks redrawn for the file');
    check(true, `Checks refresh for the opened file (${await fr.evaluate(() => document.querySelectorAll('#gp-checks .gp-issue').length)} open)`);
    saved.opened = await ishot(p, 'import-opened-dark.png');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText('Import review later edits', v.state.doc.content.size - 1)); });
    await tap(fr, '.gp-toast-do');
    await until(async () => (await paperText(fr)) === draft, 'undone');
    check((await versions())[0] === 'restore' && await p.evaluate(() => !__uploads.length && !__clicks.length), 'Undo restores the paper as it was; nothing went to Ultra');
    check(await worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).some(([k, v]) => k.startsWith('writerVersions:') && JSON.stringify(v).includes('Import review later edits'))), 'Undo after further edits keeps those edits in a restorable version');
    // ⋯ → Import…: the same card for a .docx chosen there.
    await tap(fr, '.gp-status button:last-child');
    await until(() => fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role=menuitem]')].some((b) => b.textContent === 'Import…')), 'Import… in the menu');
    saved.menu = await ishot(p, 'import-menu-dark.png');
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), fr.evaluate(() => [...document.querySelectorAll('.gp-menu [role=menuitem]')].find((b) => b.textContent === 'Import…').click())]);
    await chooser.setFiles(path.join(files, 'Rivera_Essay2.docx'));
    await until(() => cardOf(fr), 'the card from Import…');
    check(true, '⋯ → Import… brings a chosen .docx to the same card');
    await p.keyboard.press('Escape');
    // Ultra's own input: the card in the frame, and Ultra hears nothing until Submit as is attaches the file's very bytes.
    const paperBefore = await paperText(fr), countAsis = (await versions()).length;
    await p.setInputFiles('[class*="makeStylessubmission-"] input[type=file]', path.join(files, 'Rivera_Essay2.docx'));
    await until(() => cardOf(fr), 'the card from Ultra\'s input');
    check(await p.evaluate(() => !__uploads.length && !__log.length), 'a .docx chosen through Ultra\'s "Upload files" reaches the card before Ultra hears it');
    await tap(fr, '.gi-choice:not(.gi-default)');
    await sheetOpen(fr);
    let asis = await asisOf(fr);
    console.log(JSON.stringify(asis));
    check(asis.asis && asis.big === 'DOCX' && asis.name === 'Rivera_Essay2.docx' && / KB$/.test(asis.size) && !asis.toggle && !asis.open && !asis.thumbs && asis.title === 'Submit Essay 2', 'Submit as is: the sheet shows the file large, the note, no paste switch, no checks');
    await p.keyboard.type('My file is attached as is.', { delay: 2 });
    saved.submitAsis = await ishot(p, 'import-submit-asis-dark.png');
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => __clicks.length > 0), 'submitted as is', 30000);
    await until(async () => await p.evaluate(() => !!document.getElementById('ultra-confirm')) && await fr.evaluate(() => !document.querySelector('.gs-layer')), 'Ultra\'s confirmation, the sheet closed');
    await quiet(() => p.evaluate(() => __clicks.length > 1), 'a second Submit');
    let got = await p.evaluate(() => ({ uploads: __uploads, clicks: __clicks, text: __text(), log: __log }));
    check(got.uploads.length === 1 && got.uploads[0].name === 'Rivera_Essay2.docx' && got.uploads[0].type === MIME && got.uploads[0].via === 'input' && sha(got.uploads[0].bytes) === sha(essay), `Ultra got the original file, byte for byte (sha256 ${sha(essay).slice(0, 12)}…)`);
    check(got.text === 'My file is attached as is.\n' && got.clicks.join() === 'assignment.attempt.authoring.footer.submit' && got.log.indexOf('click:assignment.attempt.authoring.footer.submit') > got.log.indexOf('row'), 'the note in Ultra\'s box, Ultra\'s Submit clicked once after the file was listed');
    check((await versions()).length === countAsis && await paperText(fr) === paperBefore, 'the paper untouched: no version saved, its text as it was');
    await p.close();
    // A PDF on Ultra's drop zone: straight to the sheet as is.
    ({ p, el, fr } = await openAttempt('empty'));
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.pdf', 'application/pdf', pdf);
    await sheetOpen(fr);
    asis = await asisOf(fr);
    check(asis.asis && asis.big === 'PDF' && asis.name === 'Rivera_Essay2.pdf' && await fr.evaluate(() => !document.querySelector('.gi-layer') && getComputedStyle(document.querySelector('.gs-big .gs-doc')).backgroundColor === 'rgb(220, 38, 38)') && await p.evaluate(() => !__uploads.length), 'a PDF dropped on Ultra\'s area: no card, straight to the sheet as is, Ultra none the wiser');
    saved.submitPdf = await ishot(p, 'import-submit-pdf-dark.png');
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => __clicks.length > 0), 'PDF submitted', 30000);
    got = await p.evaluate(() => ({ uploads: __uploads, clicks: __clicks, text: __text() }));
    check(got.uploads.length === 1 && got.uploads[0].name === 'Rivera_Essay2.pdf' && got.uploads[0].type === 'application/pdf' && sha(got.uploads[0].bytes) === sha(pdf) && got.clicks.length === 1 && got.text === '\n', 'the PDF submitted unchanged (hashes match), once, with no note');
    await p.close();
    // Open uploads in Writer off: Ultra's area takes files itself, the frame never sees them.
    const sync = await worker.evaluate(() => chrome.storage.sync.get(null));
    await worker.evaluate((s) => chrome.storage.sync.set({ enhance: { ...s.enhance, writerUploads: false } }), sync);
    ({ p, el, fr } = await openAttempt('empty'));
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => p.evaluate(() => __uploads.length === 1), 'Ultra took the drop');
    await p.setInputFiles('[class*="makeStylessubmission-"] input[type=file]', path.join(files, 'Rivera_Essay2.pdf'));
    await until(() => p.evaluate(() => __uploads.length === 2), 'Ultra took the choice');
    await quiet(() => fr.evaluate(() => !!document.querySelector('.gi-layer, .gs-layer')), 'Writer showed a card or sheet');
    check(await p.evaluate(() => __uploads.map((u) => u.via).join() === 'drop,input') && await fr.evaluate(() => !document.querySelector('.gi-layer') && !document.querySelector('.gs-layer')), 'Open uploads in Writer off: Ultra\'s area takes the drop and the choice itself, Writer shows nothing');
    await p.close();
    // The light Look (Paper), for the mockup's light shots.
    await worker.evaluate((s) => chrome.storage.sync.set({ ...s, preset: 'Paper', colors: s.paper }), { ...sync, paper: G.GZ_PRESETS.find(([n]) => n === 'Paper')[1] });
    await blankPaper();
    ({ p, el, fr } = await openAttempt('empty'));
    await until(() => fr.evaluate(() => !document.documentElement.hasAttribute('data-dark')), 'light Look');
    await give(fr, '.gp-canvas', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the light card');
    saved.choiceLight = await ishot(p, 'import-choice-docx-light.png');
    await tap(fr, '.gi-choice:not(.gi-default)');
    await sheetOpen(fr);
    saved.submitLight = await ishot(p, 'import-submit-asis-light.png');
    await p.keyboard.press('Escape');
    await p.close();
    await worker.evaluate((s) => chrome.storage.sync.set(s), sync);

    // ---- the compact box: Settings → Writer → Full writer off (the default)
    const cshots = process.env.COMPACT_SHOTS || path.join(os.homedir(), 'Projects/glaze-plans/writer/mockups/build-documents');
    const cshot = async (target, name) => { fs.mkdirSync(cshots, { recursive: true }); await stillAll(target); const f = path.join(cshots, name); await target.screenshot({ path: f }); return f; };
    const fullSet = async () => (await worker.evaluate(() => chrome.storage.sync.get('writer'))).writer?.full;
    const setFull = (on) => worker.evaluate(async (on) => { const w = (await chrome.storage.sync.get('writer')).writer || {}; await chrome.storage.sync.set({ writer: { ...w, full: on } }); }, on);
    const viewOf = (fr) => fr.evaluate(() => {
      const shown = (x) => !!x && x.getClientRects().length > 0, q = (x) => document.querySelector(x);
      return { view: document.documentElement.dataset.view, pages: shown(q('.gp-sheet')), side: shown(q('.gp-side')), ruler: shown(q('.gr-ruler')), zoom: shown(q('.gp-tool')), box: shown(q('#gw')),
        inBox: !!q('#gw > .ProseMirror'), bar: shown(q('.gw-bar .gp-full')), top: shown(q('.gp-top .gp-full')), on: [...document.querySelectorAll('.gp-full')].map((b) => b.getAttribute('aria-checked')),
        label: q('.gw-bar .gp-full')?.textContent, role: q('.gw-bar .gp-full')?.getAttribute('role'), gw: Math.ceil(q('#gw').getBoundingClientRect().height) };
    });
    // The caret's top on the page (the frame's top plus its place in the frame) and the selection.
    const caretAt = async (el, fr) => { const box = await el.boundingBox(); const c = await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view, s = v.state.selection; return { top: v.coordsAtPos(s.head).top, from: s.from, to: s.to, focus: v.hasFocus() }; }); return { ...c, y: box.y + c.top }; };
    const openCompact = async (mode = '') => {
      const p = await context.newPage();
      watch(p, `compact${mode ? `?${mode}` : ''}`);
      await p.goto(`${site}${ATTEMPT}${mode ? `?mode=${mode}` : ''}`);
      const el = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'); return x && await x.evaluate((f) => !f.style.opacity) && x; }, 'compact frame shown', 30000);
      const fr = await until(() => el.contentFrame(), 'frame document');
      await until(() => fr.evaluate(() => !!globalThis.GZ_WRITER_PAPER?.current()?.key()), 'paper loaded', 30000);
      return { p, el, fr };
    };
    const frameH = (el) => el.evaluate((f) => f.getBoundingClientRect().height);
    // Typing into the compact box: once the frame's document has the focus and the box's editor is its active element
    // (polled from Node: on a loaded runner the focus can follow the tap by a moment); the text then waited for in Ultra's
    // box as long as a loaded runner takes, a miss saying what Ultra's box, the paper and the bar's line held.
    const SYNC_MS = 60000;
    const focusOf = (fr) => fr.evaluate(() => ({ focused: document.hasFocus(), active: document.activeElement?.matches?.('#gw .ProseMirror') || `${document.activeElement?.tagName?.toLowerCase()}.${String(document.activeElement?.className || '').slice(0, 40)}` }));
    const boxFocused = (fr) => until(async () => { const f = await focusOf(fr); return f.focused && f.active === true; }, 'the compact box focused', 15000, () => focusOf(fr));
    const boxState = (p, fr) => async () => ({
      ultra: await p.evaluate(() => __text()).then((x) => x.slice(0, 200), (e) => `unreadable: ${e.message}`),
      paper: await fr.evaluate(() => GZ_WRITER_PAPER.current()?.editor.view.state.doc.textContent.slice(0, 200)).catch((e) => `unreadable: ${e.message}`),
      bar: await fr.evaluate(() => document.querySelector('.gw-bar .gp-said')?.textContent ?? null).catch(() => null),
      ...await focusOf(fr).catch(() => ({})),
    });
    const inUltra = (p, fr, ok, label) => until(async () => ok(await p.evaluate(() => __text())), label, SYNC_MS, boxState(p, fr));
    await setFull(false);
    await blankPaper();
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); });
    ({ p, el, fr } = await openCompact('empty'));
    let v = await viewOf(fr);
    console.log(JSON.stringify(v));
    check(v.view === 'compact' && !v.pages && !v.side && !v.ruler && !v.zoom && v.box && v.inBox, 'an assignment opens compact: the compose box, no pages, side panel, ruler or zoom');
    check(v.bar && v.role === 'switch' && v.label === 'Full writer' && v.on.every((x) => x === 'false'), 'the compact bar ends in a "Full writer" switch, off');
    let h0 = await frameH(el);
    check(Math.abs(h0 - (v.gw + 6)) <= 2 && h0 < 400, `the frame is as tall as the box (${h0}px)`);
    await tap(fr, '#gw .ProseMirror');
    await boxFocused(fr);
    await p.keyboard.type('Memory in Beloved is a debt the town keeps.', { delay: 2 });
    await inUltra(p, fr, (x) => x === 'Memory in Beloved is a debt the town keeps.\n', 'the text in Ultra\'s box');
    check(true, 'what is typed goes into Ultra\'s text box, as it is');
    check(await p.evaluate(() => !document.querySelector(`${'[data-analytics-id="assignment.attempt.authoring.footer.submit"]'}`).disabled), 'Ultra\'s Submit turns on with the text');
    const paperKey = await fr.evaluate(() => GZ_WRITER_PAPER.current().key());
    await until(async () => JSON.stringify((await worker.evaluate((k) => chrome.storage.local.get(`writerPaper:${k}`), paperKey))[`writerPaper:${paperKey}`]?.doc || '').includes('a debt the town keeps'), 'autosaved');
    check(true, 'and is autosaved to the assignment\'s paper in Writer\'s storage');
    for (let i = 0; i < 8; i++) { await p.keyboard.press('Enter'); await p.keyboard.type(`Line ${i + 2} of the draft.`, { delay: 1 }); }
    await until(async () => (await frameH(el)) > h0 + 60, 'the frame grows');
    check(true, `the frame grows with the text (${h0}px → ${await frameH(el)}px)`);
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, 1, 7))); });
    await until(() => fr.evaluate(() => !document.getElementById('tb').hidden), 'selection toolbar');
    check(await fr.evaluate(() => !!document.querySelector('#tb [data-run="bold"]') && !!document.querySelector('#tb .gzc-cite')), 'a selection shows compose\'s toolbar, Cite in it');
    for (const [w, hgt] of [[1280, 800], [640, 900]]) { await p.setViewportSize({ width: w, height: hgt }); await el.evaluate((f) => f.scrollIntoView({ block: 'center' })); saved[`compact${w}`] = await cshot(p, `compact-${w}.png`); }
    await p.setViewportSize({ width: 1440, height: 900 });
    // A long paper, the caret in its middle: Full writer and back keep the document, the caret, and its line on the page.
    await fr.evaluate((json) => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.paper.nodeFromJSON(json).content)); }, { ...FX.papers.mla9(), content: [...FX.papers.mla9().content, { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHtQAAAAASUVORK5CYII=', alt: 'Saved picture', width: 20, height: 20 } }] }] });
    await until(async () => /Works Cited/.test(await p.evaluate(() => __text())), 'the long paper in Ultra\'s box');
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; let at = 0; v.state.doc.descendants((n, pos) => { if (!at && n.isText && n.text.includes('(Morrison 35)')) at = pos + n.text.indexOf('(Morrison 35)'); }); v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)).scrollIntoView()); });
    await settle(fr);
    const ultraBefore = await p.evaluate(() => __text()), docBefore = await paperText(fr);
    const jsonBefore = await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON());
    const c0 = await caretAt(el, fr);
    await tap(fr, '.gw-bar .gp-full');
    await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 1 && document.querySelector('.gp-flow').style.visibility === ''), 'pages drawn');
    await until(async () => (await frameH(el)) > 500, 'the paper\'s height');
    await settle(fr);
    v = await viewOf(fr);
    const c1 = await caretAt(el, fr), vh = await p.evaluate(() => innerHeight);
    console.log(JSON.stringify({ v, c0, c1 }));
    check(v.view === 'full' && v.pages && v.side && !v.box && v.top && v.on.every((x) => x === 'true'), 'Full writer on: the pages and side panel, the switch on in the title bar');
    check(c1.from === c0.from && c1.to === c0.to && c1.focus && await paperText(fr) === docBefore, 'the same document, the caret where it was, still typing');
    check(c1.y > 0 && c1.y < vh, `the caret's line in sight (${Math.round(c0.y)} → ${Math.round(c1.y)} of ${vh})`);
    await until(async () => (await fullSet()) === true, 'writer.full saved');
    check(true, 'the switch saves writer.full');
    await tap(fr, '.gp-top .gp-full');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'round-trip compact');
    check(JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) === JSON.stringify(jsonBefore), 'compact → full → compact preserves the complete document, notes, page breaks and pictures');
    await p.evaluate(() => { const q = document.querySelector('.ql-container[data-gz-writer-id]').__quill; q.root.innerHTML = '<p><span>' + q.root.textContent + '</span></p>'; });
    await quiet(async () => JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) !== JSON.stringify(jsonBefore), 'Ultra\'s echo replaced the paper');
    check(JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) === JSON.stringify(jsonBefore), 'Ultra reformats the projection without replacing the paper');
    await p.evaluate((delta) => document.querySelector('.ql-container[data-gz-writer-id]').__quill.setContents(delta, 'user'), await fr.evaluate(() => GZ_WRITER_PAPER.project(GZ_WRITER_PAPER.current().editor.view.state.doc).delta));
    await tap(fr, '.gw-bar .gp-full');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full'), 'full again');
    await settle(fr);
    await fr.focus('.gp-flow .ProseMirror');
    await p.keyboard.type('Pages only. ', { delay: 2 });
    await until(async () => (await paperText(fr)).includes('Pages only.'), 'typed in the pages');
    await quiet(async () => (await p.evaluate(() => __text())) !== ultraBefore, 'Ultra\'s box changed');
    check((await p.evaluate(() => __text())) === ultraBefore, 'typed in the pages, nothing goes into Ultra\'s box');
    for (const [w, hgt] of [[1280, 800], [640, 900]]) { await p.setViewportSize({ width: w, height: hgt }); await el.evaluate((f) => f.scrollIntoView({ block: 'start' })); saved[`compactFull${w}`] = await cshot(p, `compact-full-${w}.png`); }
    await p.setViewportSize({ width: 1440, height: 900 });
    await el.evaluate((f) => f.scrollIntoView({ block: 'start' }));
    await settle(fr);
    const c2 = await caretAt(el, fr), viewsBefore = (await versions()).filter((r) => r === 'view').length;
    await tap(fr, '.gp-top .gp-full');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact again');
    await until(async () => (await p.evaluate(() => __text())).includes('Pages only.'), 'the box written again');
    await settle(fr);
    const c3 = await caretAt(el, fr);
    console.log(JSON.stringify({ c2, c3 }));
    check(c3.from === c2.from && c3.focus && Math.abs(c3.y - c2.y) <= 4, `Full writer off: the caret and its line where they were (${Math.round(c2.y)} → ${Math.round(c3.y)})`);
    check((await versions()).filter((r) => r === 'view').length === viewsBefore + 1, 'the paper kept as a version first');
    check((await p.evaluate(() => __text())).includes('Pages only.') && !/Morrison 35\./.test(await p.evaluate(() => __text())), 'then its text goes into Ultra\'s box again, footnotes left in the paper');
    await until(async () => (await fullSet()) === false, 'writer.full saved off');
    for (const width of [480, 479]) {
      await el.evaluate((f, width) => { f.style.width = `${width}px`; }, width);
      await until(() => fr.evaluate((width) => { const b = document.querySelector('.gw-bar .gp-full'), label = b.querySelector('.gp-full-name'); return !!label.getClientRects().length === (width >= 480) && b.getAttribute('aria-label') === 'Full writer'; }, width), `switch at ${width}px`);
      check(true, `Full writer at ${width}px keeps its accessible name and ${width >= 480 ? 'shows' : 'hides'} the visible label`);
    }
    await el.evaluate((f) => { f.style.width = 'calc(100% + 6px)'; });
    // A frame crash during failed native sync recovers its complete paper rather than its projection.
    await p.evaluate(() => { const c = document.querySelector('.ql-container[data-gz-writer-id]'); window.__savedPaperQuill = c.__quill; delete c.__quill; });
    const recoveryJSON = await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.insertText('Recovered last edit. ', v.state.selection.from)); return v.state.doc.toJSON(); });
    const oldCompact = el;
    await fr.evaluate(() => setTimeout(() => location.reload(), 0));
    await until(() => oldCompact.evaluate((f) => !f.isConnected), 'crashed compact frame retired');
    el = await until(() => p.$('iframe.gz-writer[data-gz-writer-frame="assignment"]'), 'replacement paper frame');
    fr = await until(() => el.contentFrame(), 'replacement paper document');
    await until(() => fr.evaluate(() => !!GZ_WRITER_PAPER.current()?.key()), 'recovered paper loaded');
    check(JSON.stringify(await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.state.doc.toJSON())) === JSON.stringify(recoveryJSON), 'a crash mid-sync recovers the last edit, notes, page breaks and pictures');
    await p.evaluate(() => { document.querySelector('.ql-container[data-gz-writer-id]').__quill = __savedPaperQuill; });
    for (const name of ['Feedback', 'Checks']) {
      await tap(fr, '#more');
      await tap(fr, `#menu [role="menuitem"]:text-is("${name}")`);
      await until(() => fr.evaluate((id) => document.documentElement.dataset.view === 'full' && document.getElementById(`gp-tab-${id}`).getAttribute('aria-selected') === 'true', name.toLowerCase()), `${name} from compact`);
      check(true, `compact ⋯ → ${name} opens the full view at its panel`);
      await tap(fr, '.gp-top .gp-full');
      await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact after panel');
    }
    for (const key of ['Space', 'Enter']) {
      await fr.focus('.gw-bar .gp-full'); await p.keyboard.press(key);
      await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelector('.gp-top .gp-full').getAttribute('aria-checked') === 'true'), `${key} turns Full writer on`);
      await fr.focus('.gp-top .gp-full'); await p.keyboard.press(key);
      await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact' && document.querySelector('.gw-bar .gp-full').getAttribute('aria-checked') === 'false'), `${key} turns Full writer off`);
      check(true, `${key} operates the Full writer switch in both views`);
    }
    await fr.evaluate(() => { const v = GZ_WRITER_PAPER.current().editor.view; v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, GZ_WRITER_SCHEMA.parse(GZ_WRITER_SCHEMA.paper, '<p>Morrison is less interested in nostalgea than in what the town chooses to forget.</p>').content)); v.focus(); });
    await until(() => fr.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'harper') && !!document.querySelector('#gw .gz-iss')), 'Harper in compact', 30000);
    check(true, 'Harper draws proofing underlines in the compact paper');
    // Kept across a reload; and Settings → Writer → Full writer switches an open assignment live, both ways.
    await setFull(true);
    await p.close();
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.querySelectorAll('.gp-sheet').length > 0), 'pages after reload');
    check((await viewOf(fr)).view === 'full' && (await frameH(el)) > 500, 'Full writer on stays on across a reload');
    const prefsPage = await context.newPage();
    await prefsPage.goto(`chrome-extension://${id}/options.html#writer/papers`);
    const row = prefsPage.locator('#panel-writer [data-key="writer.full"]');
    await row.waitFor({ state: 'visible' });
    check(await row.isChecked() && await prefsPage.locator('#writer-full-name').textContent() === 'Full writer', 'Settings → Writer → Papers: "Full writer", on');
    await row.click();
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'Settings turned it off');
    await until(async () => Math.abs((await frameH(el)) - ((await viewOf(fr)).gw + 6)) <= 2, 'the frame back to its box');
    check(true, 'Settings off: the open assignment turns compact');
    await row.click();
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelectorAll('.gp-sheet').length > 0), 'Settings turned it on');
    check(true, 'Settings on: the open assignment shows its pages again');
    await row.click();
    await until(async () => (await fullSet()) === false, 'off again');
    await prefsPage.close();
    await p.close();
    // Ultra's own Submit sends the box's text: no sheet, no file.
    await blankPaper();
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await tap(fr, '#gw .ProseMirror');
    await boxFocused(fr);
    await p.keyboard.type('Submitted as text.', { delay: 2 });
    await inUltra(p, fr, (x) => x === 'Submitted as text.\n', 'in Ultra\'s box');
    await p.click(SUBMIT);
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'Ultra\'s confirmation');
    got = await p.evaluate(() => ({ uploads: __uploads.length, clicks: __clicks, text: __text(), confirm: !!document.getElementById('ultra-confirm') }));
    check(got.clicks.join() === 'assignment.attempt.authoring.footer.submit' && got.confirm && got.uploads === 0 && got.text === 'Submitted as text.\n' && await fr.evaluate(() => !document.querySelector('.gs-layer')), 'Ultra\'s Submit sends the text as it is: no sheet, no .docx');
    await p.close();
    // A slow save (the worker's storage writes held 6 s): Ultra's Submit waits on it however long, the compact bar saying
    // Saving…, then goes once with the last words; never a press that does nothing.
    const bar = (fr) => fr.evaluate(() => { const s = document.querySelector('.gw-bar .gp-said'); return s ? { text: s.textContent, lines: s.getClientRects().length, nowrap: getComputedStyle(s).whiteSpace === 'nowrap', offer: !!document.querySelector('.gw-bar .gp-full[data-offer]') } : null; });
    const slowStore = (ms) => worker.evaluate((ms) => {
      const a = chrome.storage.local, own = globalThis.__gzSet ||= a.set;
      a.set = ms ? function (...args) { return new Promise((r) => setTimeout(r, ms)).then(() => own.apply(a, args)); } : own;
      return a.set !== own === !!ms;
    }, ms);
    await blankPaper();
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await tap(fr, '#gw .ProseMirror');
    await boxFocused(fr);
    await p.keyboard.type('Sent after a slow save.', { delay: 2 });
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'saved before the slow part');
    await fr.evaluate(() => { window.__said = []; const s = document.querySelector('.gw-bar .gp-said'); if (s) new MutationObserver(() => window.__said.push(s.textContent)).observe(s, { childList: true, characterData: true, subtree: true }); });
    check(await slowStore(6000), 'the worker\'s storage writes held 6 s');
    await boxFocused(fr);
    await p.keyboard.type(' Last words.', { delay: 2 });
    await inUltra(p, fr, (x) => x.includes('Last words.'), 'the last words in Ultra\'s box');
    const pressed = Date.now();
    await p.click(SUBMIT);
    const heldAtOnce = await p.evaluate(() => !__clicks.length);
    await until(() => p.evaluate(() => __clicks.length > 0), 'Ultra\'s Submit after the slow save', 40000);
    const waited = Date.now() - pressed;
    await slowStore(0);
    const said = await fr.evaluate(() => window.__said);
    check(heldAtOnce && said[0] === 'Saving…' && waited >= 5500, `a slow save holds Ultra's Submit, the compact bar saying "${said[0]}", past the old 4 s bound (${waited} ms)`);
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'Ultra\'s confirmation after the slow save');
    const slowKey = await fr.evaluate(() => GZ_WRITER_PAPER.current().key());
    got = await p.evaluate(() => ({ clicks: __clicks, text: __text() }));
    const slowDoc = JSON.stringify((await worker.evaluate((k) => chrome.storage.local.get(`writerPaper:${k}`), slowKey))[`writerPaper:${slowKey}`]?.doc || '');
    check(got.clicks.join() === 'assignment.attempt.authoring.footer.submit' && got.text === 'Sent after a slow save. Last words.\n' && slowDoc.includes('Last words.') && (await bar(fr)).text === '' && await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.editable), 'then it goes once, with the last words saved and in Ultra\'s box; the bar clears and the box takes typing again');
    await p.close();
    // A paper past what Ultra's text box takes (compose's 50k-tag input limit: 260 paragraphs of 100 bold digits, 52,520 tags,
    // some 20 pages, so Full writer can lay it out in a moment):
    // the bar says so on one line and offers Full writer; Ultra's Submit sends nothing, says why and focuses the switch,
    // whose .docx has no such limit.
    await blankPaper();
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await tap(fr, '#gw .ProseMirror');
    await boxFocused(fr);
    await p.keyboard.type('Short start.', { delay: 2 });
    await inUltra(p, fr, (x) => x === 'Short start.\n', 'the short start in Ultra\'s box');
    const over = await fr.evaluate(() => {
      const v = GZ_WRITER_PAPER.current().editor.view, S = GZ_WRITER_SCHEMA.paper, bold = S.marks.bold.create();
      const paras = Array.from({ length: 260 }, (_, i) => S.node('paragraph', null, Array.from({ length: 200 }, (_, j) => (j % 2 ? S.text(' ') : S.text(String((j / 2 + 1) % 10), [bold])))));
      v.dispatch(v.state.tr.replaceWith(0, v.state.doc.content.size, paras));
      return GZ_WRITER_PAPER.project(v.state.doc) === null;
    });
    check(over, 'a paper of 260 paragraphs of 100 bold digits (52,520 tags) is past what compose takes');
    await until(async () => (await bar(fr))?.text === 'Too long for Ultra’s text box. Use Full writer.', 'the reason in the compact bar');
    const b1 = await bar(fr);
    check(b1.lines === 1 && b1.nowrap && b1.offer && (await p.evaluate(() => __text())) === 'Short start.\n', 'the compact bar says "Too long for Ultra’s text box. Use Full writer." on one line, the Full writer switch marked; Ultra\'s box keeps what last fit');
    await until(() => fr.evaluate(() => document.querySelector('.gp-state').textContent === 'Saved'), 'the long paper saved');
    await p.click(SUBMIT);
    await until(() => fr.evaluate(() => document.hasFocus() && !!document.activeElement?.matches('.gw-bar .gp-full')), 'Full writer focused');
    await quiet(() => p.evaluate(() => __clicks.length > 0), 'Ultra\'s Submit sent a partial text');
    check((await bar(fr)).text === 'Too long for Ultra’s text box. Use Full writer.' && await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.editable && document.hasFocus() && !!document.activeElement?.matches('.gw-bar .gp-full')) && (await p.evaluate(() => __text())) === 'Short start.\n', 'Ultra\'s Submit on it sends nothing, the bar still says why, Full writer keeps the focus, the box is the student\'s again');
    await p.keyboard.press('Space');
    await until(async () => (await fullSet()) === true && await fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelectorAll('.gp-sheet').length > 1), 'Full writer from the switch', 60000);
    check(true, 'Space on it turns Full writer on (writer.full saved): the paper in its pages, for a .docx');
    await p.close();
    await setFull(false);
    await blankPaper();
    // Submit as is from compact: the sheet owns the native text and its one final click.
    ({ p, el, fr } = await openCompact('empty'));
    await tap(fr, '#gw .ProseMirror'); await boxFocused(fr); await p.keyboard.type('Keep this compact draft.');
    await inUltra(p, fr, (x) => x.includes('Keep this compact draft.'), 'compact draft synced');
    await give(p, '[class*="makeStylesinputContainer-"]', 'Compact_original.docx', MIME, essay);
    await until(() => cardOf(fr), 'compact as-is card');
    await tap(fr, '.gi-choice:not(.gi-default)'); await sheetOpen(fr);
    await fr.fill('#gs-note', 'Original file attached.');
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => __clicks.length === 1), 'compact as-is submitted');
    check(await p.evaluate(() => __text() === 'Original file attached.\n' && __uploads.length === 1) && sha(await p.evaluate(() => __uploads[0].bytes)) === sha(essay), 'compact Submit as is attaches the original bytes once and preserves the sheet’s note without the compact draft');
    check((await paperText(fr)).includes('Keep this compact draft.'), 'Submit as is leaves the stored paper intact');
    await p.close();
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('writerSubmit:'))); });
    // Ultra's file area: a PDF is Ultra's; a .docx asks, over a frame as tall as a paper, and Open in Writer opens the pages.
    ({ p, el, fr } = await openCompact('empty'));
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'compact'), 'compact');
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.pdf', 'application/pdf', pdf);
    await until(() => p.evaluate(() => __uploads.length === 1), 'Ultra took the PDF');
    check(await p.evaluate(() => __uploads[0].via === 'drop') && await fr.evaluate(() => !document.querySelector('.gi-layer, .gs-layer')), 'a PDF on Ultra\'s file area is Ultra\'s, to send with the text');
    h0 = await frameH(el);
    await give(p, '[class*="makeStylesinputContainer-"]', 'Rivera_Essay2.docx', MIME, essay);
    await until(() => cardOf(fr), 'the card in the compact box');
    await until(async () => (await frameH(el)) > 500, 'room for the card');
    card = await cardOf(fr);
    check(card.tiles.join('|') === 'Open in Writer|Submit as is' && await p.evaluate(() => __uploads.length === 1), `a .docx asks Open in Writer or Submit as is, the frame a paper's height (${h0}px → ${await frameH(el)}px)`);
    saved.compactCard = await cshot(p, 'compact-card-1440.png');
    const compactRemnant = await p.evaluate(() => __text());
    await tap(fr, '.gi-default');
    await until(async () => (await paperText(fr)).includes(marker), 'opened');
    await until(() => fr.evaluate(() => document.documentElement.dataset.view === 'full' && document.querySelectorAll('.gp-sheet').length > 0), 'the pages');
    check(await fullSet() === true, 'Open in Writer opens the file in the pages, Full writer on');
    check(await p.evaluate(() => __text()) === compactRemnant, 'opening the file leaves Ultra’s compact remnant available for explicit review');
    await p.click(SUBMIT); await until(() => fr.evaluate(() => !!document.querySelector('.gs-layer')), 'submit imported paper');
    check(await fr.getAttribute('#gs-keep', 'aria-checked') === 'false' && await fr.getAttribute('#gs-paste', 'aria-checked') === 'false', 'the submit sheet defaults to excluding the compact remnant and paper text');
    await tap(fr, '.gs-primary');
    await until(() => p.evaluate(() => !!document.getElementById('ultra-confirm')), 'imported file submitted');
    check(await p.evaluate(() => __text().trim() === '' && __uploads.length === 2 && __uploads[1].name.endsWith('.docx') && __clicks.length === 1), 'the imported .docx submits once with no duplicate compact text');
    await p.close();
    await setFull(true);

    // ---- a test: no sheet, nothing caught
    p = await context.newPage();
    watch(p, 'test');
    await p.goto(`${site}${TEST}`);
    const tel = await until(async () => { const x = await p.$('iframe.gz-writer[data-gz-writer-frame="test"]'); return x && await x.evaluate((ff) => !ff.style.opacity) && x; }, 'test box mounted');
    const tfr = await until(() => tel.contentFrame(), 'test frame');
    await until(() => tfr.evaluate(() => !!globalThis.GZ_WRITER_FRAME?.editor()), 'test editor');
    check(await tfr.evaluate(() => document.documentElement.dataset.mode === 'compose' && GZ_WRITER_PAPER.submit === null && !document.querySelector('.gp-submit')), 'a test\'s box is compose: no Submit…, no sheet hook');
    await p.click('.footer:not([hidden]) button[analytics-id="course.content.assessment.footer.buttons.submit"]');
    await until(() => p.evaluate(() => __clicks.length > 0), 'the test\'s Submit heard');
    check(await p.evaluate(() => __clicks.join() === 'course.content.assessment.footer.buttons.submit') && await tfr.evaluate(() => !document.querySelector('.gs-layer')), 'a test\'s own Submit goes straight to Ultra, untouched');
    await p.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, taps: { made: taps.made, again: taps.again }, shots: saved }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, taps, requests, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), `${e.stack}\n`); process.exitCode = 1; });
