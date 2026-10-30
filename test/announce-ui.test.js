// The pop-up (features/popup.js) and announcements' page side (features/announce.js) in a VM with the stand-in DOM: the
// dialog's focus, labels and loading state, the motion each setting gets, one request per open and the read mark, falling
// back to the site's page, clicks with modifiers, and the hover preview's timing, cancelling, cache and Escape.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const { El } = require('./stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const O = 'https://school.instructure.com';
const TOPIC = { title: 'Lab moved', message: '<p>Room <b>2</b>.</p><script>alert(1)</script>', posted_at: '2026-10-20T14:00:00Z', read_state: 'unread', author: { display_name: 'Dr. Rivera' } };

// A page: { anim, motion, reduced, announce (settings), answer(url, init) → { status, body } or a promise }.
const page = ({ site = 'canvas', origin = O, anim = 'genie', motion = 'subtle', reduced = false, announce = {}, answer, hold = false } = {}) => {
  const doc = { activeElement: null, cookie: '_csrf_token=tok%3D' };
  const moves = [];
  doc.createElement = (t) => {
    const e = new El(t, doc);
    // Each element's animate(): recorded; `hold` keeps it running (finished never settles).
    e.animate = (frames, o) => { moves.push({ tag: t, frames, o }); return { finished: hold ? new Promise(() => {}) : Promise.resolve(), cancel() {} }; };
    return e;
  };
  doc.root = new El('#document', doc);
  doc.documentElement = new El('html', doc);
  doc.root.append(doc.documentElement);
  doc.body = new El('body', doc);
  doc.documentElement.append(doc.body);
  doc.documentElement.setAttribute('data-gz-motion', motion);
  doc.boxOf = (el) => (el.tagName === 'DIALOG' ? { left: 420, top: 200, width: 600, height: 400 } : null);
  const asked = [], assigned = [], keys = [];
  const settings = D.GZ_SANITIZE({ announce, popup: { anim } });
  settings.announce = { ...settings.announce, ...('delay' in announce && { delay: announce.delay }) };
  const ctx = vm.createContext({
    GZ_CTX: { site, t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', settings: () => settings, need: async () => {},
      moodleIn: async () => ({ session: () => ({ root: origin, sesskey: 'sk' }) }) },
    GZ_I18N: require('../lib/i18n.js'), GZ_SANITIZE: D.GZ_SANITIZE,
    GZ_POPUP_LIB: require('../lib/popup.js'), GZ_ANNOUNCE_LIB: require('../lib/announce.js'), GZ_NOTES: require('../lib/notes.js'), GZ_DOCTEXT: require('../lib/doctext.js'),
    GZ_ULTRA: require('../lib/ultra.js'),
    GZ_LMSQ: { fetch: (url, init = {}, prio = 0) => {
      asked.push({ url, method: init.method || 'GET', prio, init });
      return Promise.resolve(answer ? answer(url, init) : { status: 200, body: TOPIC }).then((a) => {
        if (init.signal?.aborted) throw init.signal.reason;
        return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.body ?? null), json: async () => a.body, blob: async () => a.blob };
      });
    } },
    document: doc, location: { origin, href: `${origin}/`, assign: (u) => assigned.push(u) },
    matchMedia: () => ({ matches: reduced }), innerWidth: 1440, innerHeight: 900,
    addEventListener: (type, f) => keys.push({ type, f }),
    URL, AbortController, Promise, JSON, Date, Intl, Map, Set, WeakMap, setTimeout, clearTimeout, console,
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('features/popup.js'), ctx);
  vm.runInContext(read('features/announce.js'), ctx);
  const host = (id) => doc.body.children.find((c) => c.id === id) || null;
  const dialog = () => host('gz-popup')?.shadowForTest.querySelector('dialog') || null;
  const tip = () => host('gz-ann-tip')?.shadowForTest.querySelector('.tip') || null;
  const link = (box = { left: 100, top: 40, width: 160, height: 20 }) => { const a = doc.createElement('a'); a.box = box; doc.body.append(a); return a; };
  const esc = () => { let stopped = false; for (const k of keys.filter((x) => x.type === 'keydown')) k.f({ key: 'Escape', stopPropagation() { stopped = true; }, preventDefault() {} }); return stopped; };
  return { ctx, doc, asked, assigned, moves, settings, host, dialog, tip, link, esc, emit: (type) => keys.filter((k) => k.type === type).forEach((k) => k.f({ type })), P: ctx.GZ_POPUP, A: ctx.GZ_ANNOUNCE };
};
const text = (el) => (el ? (el.children || []).map((c) => (c instanceof El ? text(c) : c.textContent)).join('') : '');
const ref = (x = {}) => ({ site: 'canvas', courseId: '25', id: '7', url: `${O}/courses/25/discussion_topics/7`, title: 'Lab moved', course: 'BIO', entry: 'glaze', ...x });

test('the pop-up is a modal dialog named by its title: focus goes in, Escape closes it and focus goes back', async () => {
  const p = page();
  const a = p.link();
  a.focus();
  const h = p.P.open({ title: 'Lab moved', meta: 'BIO', body: ['Hello'], source: a });
  const d = p.dialog();
  assert.equal(d.open, true, 'shown with showModal');
  assert.equal(d.getAttribute('aria-labelledby'), 'gz-popup-title');
  const title = d.querySelector('h2');
  assert.equal(title.id, 'gz-popup-title');
  assert.equal(p.doc.activeElement, title, 'focus is inside at once');
  assert.equal(d.querySelector('.x').getAttribute('aria-label'), 'Close');
  let prevented = false;
  d.dispatchEvent({ type: 'cancel', preventDefault() { prevented = true; } });
  assert.ok(prevented, 'Escape is the pop-up\'s to animate');
  assert.equal(p.doc.activeElement, a, 'focus returns to the link');
  await settle();
  assert.equal(p.host('gz-popup'), null, 'gone');
  assert.equal(h.isOpen(), false);
  // The Close button does the same, and a link that went in the meantime hands focus to what was focused before.
  const b = p.link();
  b.focus();
  const src = p.link();
  p.P.open({ title: 'Again', body: 'x', source: src });
  src.remove();
  p.dialog().querySelector('.x').dispatchEvent({ type: 'click' });
  assert.equal(p.doc.activeElement, b);
});

test('an async body shows Loading… (busy) until it comes; a rejected one is the caller\'s to handle', async () => {
  const p = page();
  let give;
  const h = p.P.open({ title: 'T', body: () => new Promise((r) => { give = r; }) });
  const body = p.dialog().querySelector('.body');
  assert.equal(body.getAttribute('aria-busy'), 'true');
  assert.equal(text(body), 'Loading…');
  assert.equal(body.querySelector('p').getAttribute('role'), 'status');
  const el = p.doc.createElement('p'); el.textContent = 'Here';
  await settle();
  give([el]);
  await h.loaded;
  assert.equal(body.getAttribute('aria-busy'), null);
  assert.equal(text(body), 'Here');
  const h2 = p.P.open({ title: 'T', body: async () => { throw new Error('no'); } });
  await assert.rejects(h2.loaded);
  assert.equal(h2.isOpen(), true);
});

test('motion: none with reduced motion, motion off or None; a fade; a scale on Subtle; the genie on Expressive', async () => {
  const opened = (o) => { const p = page(o); const a = p.link(); p.P.open({ title: 'T', body: 'x', source: a }); return p.moves.filter((m) => m.tag === 'dialog'); };
  for (const o of [{ reduced: true, motion: 'expressive' }, { reduced: true, motion: 'subtle', anim: 'fade' }, { motion: 'off' }, { motion: 'expressive', anim: 'none' }]) {
    assert.deepEqual(opened(o), [], JSON.stringify(o));
  }
  const fade = opened({ motion: 'expressive', anim: 'fade' });
  assert.deepEqual(fade[0].frames, [{ opacity: 0 }, { opacity: 1 }]);
  assert.ok(fade[0].o.duration <= 120);
  const scale = opened({ motion: 'subtle' });
  assert.equal(scale[0].frames[0].transform, 'scale(0.96)');
  const genie = opened({ motion: 'expressive' });
  assert.ok(genie[0].frames.every((f) => Object.keys(f).every((k) => ['offset', 'opacity', 'transform', 'clipPath'].includes(k))), 'only transform, opacity and clip-path');
  assert.match(genie[0].frames[0].clipPath, /^polygon\(/);
  assert.ok(genie[0].o.duration >= 350 && genie[0].o.duration <= 450);
  // A source as big as the page itself: no genie out of it, a scale instead.
  const p = page({ motion: 'expressive' });
  p.P.open({ title: 'T', body: 'x', source: p.link({ left: 0, top: 0, width: 1440, height: 900 }) });
  assert.equal(p.moves[0].frames[0].transform, 'scale(0.96)');
});

test('closing plays back into the link, but focus goes back first, without waiting for the motion', async () => {
  const p = page({ motion: 'expressive', hold: true });
  const a = p.link();
  a.focus();
  const h = p.P.open({ title: 'T', body: 'x', source: a });
  p.moves.length = 0;
  h.close();
  assert.equal(p.doc.activeElement, a, 'focus is back before the motion ends');
  const d = p.dialog();
  assert.equal(d.inert, true, 'the closing dialog can\'t take focus');
  const back = p.moves.find((m) => m.tag === 'dialog');
  assert.match(back.frames.at(-1).clipPath, /^polygon\(/, 'it funnels back into the link');
  assert.equal(back.frames.at(-1).opacity, 0);
  assert.ok(back.o.duration < 420, 'a little quicker out');
  // A link no longer on screen: it shrinks and fades instead.
  const q = page({ motion: 'expressive', hold: true });
  const b = q.link();
  const h2 = q.P.open({ title: 'T', body: 'x', source: b });
  b.box = { left: -400, top: -400, width: 100, height: 20 };
  q.moves.length = 0;
  h2.close();
  assert.equal(q.moves.find((m) => m.tag === 'dialog').frames.at(-1).transform, 'scale(0.92)');
});

test('an announcement: one request, its sanitized body, then Canvas\'s read mark; Open in Canvas is the site\'s page', async () => {
  const p = page();
  const reads = [];
  p.A.open(ref({ onRead: () => reads.push('read') }));
  await settle(10);
  assert.deepEqual(p.asked.map((x) => `${x.method} ${x.url.replace(O, '')}`), ['GET /api/v1/courses/25/discussion_topics/7', 'PUT /api/v1/courses/25/discussion_topics/7/read']);
  assert.equal(p.asked[1].init.headers['x-csrf-token'], 'tok=');
  assert.deepEqual(reads, ['read']);
  const d = p.dialog();
  assert.equal(text(d.querySelector('h2')), 'Lab moved');
  assert.match(text(d.querySelector('.meta')), /^BIO · Dr\. Rivera · /);
  assert.equal(text(d.querySelector('.body')), 'Room 2.');
  assert.equal(d.querySelectorAll('script').length, 0);
  const go = d.querySelector('a.go');
  assert.equal(go.getAttribute('href') ?? go.href, `${O}/courses/25/discussion_topics/7`);
  assert.equal(text(go), 'Open in Canvas');
  // Opened again on this page: from the page's copy, and already read.
  p.A.close(); await settle();
  p.A.open(ref());
  await settle(10);
  assert.equal(p.asked.length, 2, 'nothing more asked');
});

test('a read announcement isn\'t marked again; Ultra asks its public API and marks nothing', async () => {
  const p = page({ answer: () => ({ status: 200, body: { ...TOPIC, read_state: 'read' } }) });
  p.A.open(ref());
  await settle(10);
  assert.deepEqual(p.asked.map((x) => x.method), ['GET']);
  const U = 'https://lms.example.edu';
  const u = page({ site: 'ultra', origin: U, answer: () => ({ status: 200, body: { id: '_1_1', title: 'Lab 3', body: '<p>Up</p>', created: '2026-10-12T13:00:00Z' } }) });
  u.A.open({ site: 'ultra', courseId: '_101_1', id: '_1_1', url: `${U}/ultra/courses/_101_1/announcements`, course: 'BIO' });
  await settle(10);
  assert.deepEqual(u.asked.map((x) => `${x.method} ${x.url}`), [`GET ${U}/learn/api/public/v1/courses/_101_1/announcements/_1_1?fields=id,title,body,created,availability`]);
  assert.equal(u.asked[0].init.redirect, 'error');
  assert.equal(text(u.dialog().querySelector('.body')), 'Up');
  assert.equal(text(u.dialog().querySelector('a.go')), 'Open in Blackboard');
});

test('if it can\'t be read, the site\'s page opens instead of an error', async () => {
  const p = page({ answer: () => ({ status: 403, body: {} }) });
  p.A.open(ref());
  await settle(10);
  assert.equal(p.host('gz-popup'), null, 'no pop-up left behind');
  assert.deepEqual(p.assigned, [`${O}/courses/25/discussion_topics/7`]);
  const q = page({ answer: () => ({ status: 200, body: { ...TOPIC, message: '', locked_for_user: true } }) });
  q.A.open(ref());
  await settle(10);
  assert.deepEqual(q.assigned, [`${O}/courses/25/discussion_topics/7`], 'a locked one too');
  assert.deepEqual(q.asked.map((x) => x.method), ['GET'], 'and nothing marked');
});

test('clicks: a plain one opens the pop-up; Ctrl, Cmd, Shift, Alt, a middle click or the site\'s page keep the browser\'s', async () => {
  const click = (o = {}) => { const e = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...o }; return e; };
  const p = page();
  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    const e = click(mod);
    assert.equal(p.A.handle(e, ref()), false, JSON.stringify(mod));
    assert.equal(e.defaultPrevented, false);
  }
  assert.equal(p.host('gz-popup'), null);
  const e = click();
  assert.equal(p.A.handle(e, ref()), true);
  assert.equal(e.defaultPrevented, true);
  assert.ok(p.dialog());
  // The entry point's own setting: the site's page.
  const s = page({ announce: { glaze: 'site' } });
  const f = click();
  assert.equal(s.A.mode('glaze'), 'site');
  assert.equal(s.A.handle(f, ref()), false);
  assert.equal(f.defaultPrevented, false);
  s.A.go(ref());
  assert.deepEqual(s.assigned, [`${O}/courses/25/discussion_topics/7`], 'go() opens the site\'s page under that setting');
  assert.equal(s.A.mode('canvas'), 'popup', 'the others still follow the everyday choice');
});

const hover = (el) => el.dispatchEvent({ type: 'pointerenter', pointerType: 'mouse' });
const out = (el) => el.dispatchEvent({ type: 'pointerleave', pointerType: 'mouse' });

test('preview: asked only after the delay, shown beside the link, described by it, and never marking it read', async () => {
  const p = page({ announce: { delay: 40 } });
  const a = p.link();
  p.A.preview(a, ref());
  hover(a);
  await wait(15);
  assert.equal(p.asked.length, 0, 'nothing asked before the delay');
  await wait(45); await settle();
  assert.deepEqual(p.asked.map((x) => [x.method, x.prio]), [['GET', 1]], 'one GET, behind what a pop-up asks');
  const t = p.tip();
  assert.equal(t.hidden, false);
  assert.equal(p.host('gz-ann-tip').getAttribute('role'), 'tooltip');
  assert.match(a.getAttribute('aria-describedby'), /gz-ann-tip/);
  assert.equal(text(t.querySelector('.t')), 'Lab moved');
  assert.equal(text(t.querySelector('.x')), 'Room 2.');
  assert.ok(+t.style.top >= 60 || parseFloat(t.style.top) >= 60, 'below the link, not over it');
  // Opening it after the preview: no second request, and now the read mark.
  p.A.open(ref());
  await settle(10);
  assert.deepEqual(p.asked.map((x) => x.method), ['GET', 'PUT']);
  assert.equal(t.hidden, true, 'the preview goes when the pop-up opens');
});

test('preview: leaving before the delay asks nothing; leaving while it is asked cancels the request', async () => {
  const p = page({ announce: { delay: 30 } });
  const a = p.link();
  p.A.preview(a, ref());
  hover(a); out(a);
  await wait(60);
  assert.equal(p.asked.length, 0);
  let release;
  const q = page({ announce: { delay: 30 }, answer: () => new Promise((r) => { release = r; }) });
  const b = q.link();
  q.A.preview(b, ref());
  hover(b);
  await wait(45);
  assert.equal(q.asked.length, 1);
  out(b);
  await wait(200);
  assert.equal(q.asked[0].init.signal.aborted, true, 'cancelled once the pointer left');
  assert.equal(q.tip().hidden, true);
  release({ status: 200, body: TOPIC });
  await settle();
  // The pointer may move onto the preview without it going.
  const r = page({ announce: { delay: 20 } });
  const c = r.link();
  r.A.preview(c, ref());
  hover(c);
  await wait(40); await settle();
  out(c);
  r.tip().dispatchEvent({ type: 'pointerenter' });
  await wait(200);
  assert.equal(r.tip().hidden, false, 'hoverable');
});

test('preview: Escape puts it away (the key goes no further); keyboard focus shows it; off in settings, none', async () => {
  const p = page({ announce: { delay: 20 } });
  const a = p.link();
  p.A.preview(a, ref());
  a.dispatchEvent({ type: 'focus' });
  await wait(40); await settle();
  assert.equal(p.tip().hidden, false, 'focus shows it');
  assert.equal(p.esc(), true, 'Escape is taken');
  assert.equal(p.tip().hidden, true);
  assert.equal(a.getAttribute('aria-describedby'), null, 'its description goes with it');
  assert.equal(p.esc(), false, 'with nothing shown, Escape is the page\'s');
  const q = page({ announce: { delay: 20, preview: false } });
  const b = q.link();
  q.A.preview(b, ref());
  hover(b);
  await wait(50);
  assert.equal(q.host('gz-ann-tip'), null);
  assert.equal(q.asked.length, 0);
});

test('preview on Moodle asks nothing (its answer would mark the posts read): what the page gave', async () => {
  const posts = [{ error: false, data: { posts: [{ subject: 'Exam room', hasparent: false, message: '<p>Pencils.</p>', author: { fullname: 'Dr. Rivera' }, timecreated: 1760000000, unread: true }] } }];
  const p = page({ site: 'moodle', announce: { delay: 20 }, answer: () => ({ status: 200, body: posts }) });
  const a = p.link();
  p.A.preview(a, { site: 'moodle', id: '12', url: `${O}/mod/forum/discuss.php?d=12`, title: 'Exam room', course: 'HIST', text: 'Bring a pencil.' });
  hover(a);
  await wait(50); await settle();
  assert.equal(p.asked.length, 0);
  assert.equal(text(p.tip().querySelector('.t')), 'Exam room');
  assert.equal(text(p.tip().querySelector('.x')), 'Bring a pencil.');
  // Opening it asks once; that request is Moodle's own read mark.
  const reads = [];
  p.A.open({ site: 'moodle', id: '12', url: `${O}/mod/forum/discuss.php?d=12`, onRead: () => reads.push(1) });
  await settle(10);
  assert.equal(p.asked.length, 1);
  assert.equal(p.asked[0].method, 'POST');
  assert.match(p.asked[0].url, /service\.php\?sesskey=sk&info=mod_forum_get_discussion_posts$/);
  assert.deepEqual(reads, [1], 'and the list hears it was read');
  assert.equal(text(p.dialog().querySelector('.body')), 'Pencils.');
});

// features/routes.js: what content.js's one hook runs on each pass, so a routed feature (rubrics, the LMS's own
// announcement lists) adds nothing to the first content script.
test('routes: a matching page loads its feature and syncs it each pass; leaving calls off() once', async () => {
  const loaded = [], calls = [];
  const location = { pathname: '/ultra/courses/_1_1/outline' };
  const ctx = vm.createContext({ GZ_CTX: { site: 'ultra', need: async (f, ready) => { loaded.push(f); ctx.GZ_RUBRIC ||= { sync: () => calls.push('sync'), off: () => calls.push('off') }; ctx.GZ_STICKY_FOLD ||= { sync() {} }; assert.ok(ready()); } }, location, Set, Promise });
  ctx.globalThis = ctx;
  vm.runInContext(read('features/routes.js'), ctx);
  const R = ctx.GZ_ROUTES;
  R.add((l, site) => site === 'ultra' && /\/assessment\//.test(l.pathname), 'features/rubric.js', 'GZ_RUBRIC');
  R.add(() => { throw new Error('broken'); }, 'features/x.js', 'GZ_X');
  R.sync(); await settle();
  // A course page: only the course bar's fold, which every one of them loads.
  assert.deepEqual(loaded, ['features/sticky-fold.js'], 'not this page');
  location.pathname = '/ultra/courses/_1_1/outline/assessment/_5_1/overview';
  R.sync(); await settle(); R.sync(); await settle();
  assert.deepEqual(calls, ['sync', 'sync']);
  location.pathname = '/ultra/courses/_1_1/outline';
  R.sync(); R.sync(); await settle();
  assert.deepEqual(calls, ['sync', 'sync', 'off']);
  // Before its bootstrap (no GZ_CTX), it keeps nothing, so the next document's content.js loads it again.
  const bare = vm.createContext({});
  bare.globalThis = bare;
  vm.runInContext(read('features/routes.js'), bare);
  assert.equal(bare.GZ_ROUTES, null);
});

test('content.js asks the router on its passes, and the router is loadable', () => {
  const src = read('content.js');
  assert.match(src, /const routes = \(\) => need\('features\/routes\.js', \(\) => globalThis\.GZ_ROUTES\)\.then\(\(\) => GZ_ROUTES\.sync\(\), no\);/);
  assert.equal(src.match(/\n {4}routes\(\);\n/g).length, 2, 'the first sweep and every pass');
  for (const f of ['features/routes.js', 'features/popup.js', 'lib/popup.js', 'features/announce.js', 'lib/announce.js']) assert.ok(read('lib/background.js').includes(`'${f}'`), f);
});

test('opening during a preview keeps its pending request, including the link click before the async open', async () => {
  for (const click of [false, true]) {
    let release;
    const p = page({ announce: { delay: 10 }, answer: (url, init) => init.method === 'PUT' ? { status: 204 } : new Promise((r) => { release = r; }) });
    const a = p.link();
    p.A.preview(a, ref()); hover(a);
    await wait(25);
    if (click) a.dispatchEvent({ type: 'click', button: 0 });
    const h = p.A.open(ref());
    const aborted = p.asked[0].init.signal.aborted;
    release({ status: 200, body: TOPIC });
    await h.loaded.catch(() => {}); await settle();
    assert.equal(aborted, false, 'opening must adopt the preview request');
    assert.equal(p.assigned.length, 0, 'no accidental navigation');
    assert.deepEqual(p.asked.map((r) => r.method), ['GET', 'PUT']);
    h.close(true);
  }
});

test('closing while loading never marks an unseen body read', async () => {
  let release;
  const p = page({ answer: () => new Promise((r) => { release = r; }) });
  const h = p.A.open(ref()); await settle();
  h.close(true);
  release({ status: 200, body: TOPIC }); await h.loaded; await settle();
  assert.deepEqual(p.asked.map((r) => r.method), ['GET']);
});

test('reopening while the Canvas read mark is pending shares that write', async () => {
  let release;
  const p = page({ answer: (url, init) => init.method === 'PUT' ? new Promise((r) => { release = r; }) : { status: 200, body: TOPIC } });
  const h = p.A.open(ref()); await h.loaded; await settle(); h.close(true);
  const next = p.A.open(ref()); await next.loaded; await settle();
  const methods = p.asked.map((r) => r.method);
  release({ status: 204 }); await settle(); next.close(true);
  assert.deepEqual(methods, ['GET', 'PUT']);
});

test('a preview persists while either keyboard focus or hover remains', async () => {
  const p = page({ announce: { delay: 10 } });
  const a = p.link(); p.A.preview(a, ref());
  a.focus(); a.dispatchEvent({ type: 'focus' }); hover(a);
  await wait(25); await settle(); out(a); await wait(180);
  assert.equal(p.tip().hidden, false, 'leaving with the pointer keeps the focused preview');
  hover(a); a.dispatchEvent({ type: 'blur' }); await wait(180);
  assert.equal(p.tip().hidden, false, 'blur keeps the hovered preview');
  out(a); await wait(180);
  assert.equal(p.tip().hidden, true, 'both have left');
});

test('Escape cancels a preview before its delay and stays dismissed until focus and hover leave', async () => {
  const p = page({ announce: { delay: 30 } });
  const a = p.link(); p.A.preview(a, ref());
  a.focus(); a.dispatchEvent({ type: 'focus' });
  p.esc(); hover(a); await wait(60);
  assert.equal(p.asked.length, 0, 'Escape also dismisses a pending preview');
  out(a); a.dispatchEvent({ type: 'blur' }); hover(a); await wait(50); await settle();
  assert.equal(p.tip().hidden, false, 'a fresh hover can preview again');
  p.esc();
});

test('sweeping a list before the hover delay sends no requests', async () => {
  const p = page({ announce: { delay: 20 } });
  for (let i = 0; i < 100; i++) { const a = p.link(); p.A.preview(a, ref({ id: String(i) })); hover(a); out(a); }
  await wait(40);
  assert.equal(p.asked.length, 0);
});

test('a genie uses the source text bounds while restoring focus to the source element', () => {
  const p = page({ motion: 'expressive', hold: true });
  const a = p.link({ left: 200, top: 40, width: 1100, height: 30 });
  const textBox = { left: 210, top: 45, right: 370, bottom: 65, width: 160, height: 20 };
  p.doc.createRange = () => ({ selectNodeContents(el) { assert.equal(el, a); }, getBoundingClientRect: () => textBox });
  const h = p.P.open({ title: 'T', body: 'x', source: a });
  assert.deepEqual(p.moves[0].frames, p.ctx.GZ_POPUP_LIB.genie(textBox, p.dialog().getBoundingClientRect()).frames);
  h.close(true); assert.equal(p.doc.activeElement, a);
});

test('each entry can turn its preview off independently of opening on the site or in a popup', async () => {
  for (const mode of ['site', 'popup']) {
    const p = page({ announce: { open: mode, glazePreview: false, delay: 10 } });
    const a = p.link(); p.A.preview(a, ref()); hover(a); await wait(25);
    assert.equal(p.asked.length, 0, 'the Glaze preview is off');
    const b = p.link(); p.A.preview(b, ref({ entry: 'canvas' })); hover(b); await wait(25); await settle();
    assert.equal(p.asked.length, 1, 'Canvas still previews');
    assert.equal(p.A.mode('glaze'), mode);
    p.esc();
  }
});

test('the page cache retains early announcements after more than one hundred others', async () => {
  const p = page({ motion: 'off', answer: () => ({ status: 200, body: { ...TOPIC, read_state: 'read' } }) });
  for (let i = 0; i < 102; i++) {
    const h = p.A.open(ref({ id: String(i) })); await h.loaded; h.close(true);
  }
  const h = p.A.open(ref({ id: '0' })); await h.loaded; h.close(true);
  assert.equal(p.asked.length, 102, 'each announcement is fetched only once on this page');
});

test('an invalid reference cannot navigate to an executable or other-origin fallback', () => {
  const p = page();
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'https://other.example/x']) {
    p.A.open(ref({ url })); p.A.go(ref({ url }));
  }
  assert.deepEqual(p.assigned, []);
  assert.equal(p.asked.length, 0);
});

test('Moodle manual read tracking does not report a read mark that the forum did not make', async () => {
  const reads = [];
  const posts = [{ data: { posts: [{ subject: 'Exam', message: '<p>Bring a pencil.</p>', hasparent: false, unread: true, capabilities: { controlreadstatus: true } }] } }];
  const p = page({ site: 'moodle', answer: () => ({ status: 200, body: posts }) });
  const h = p.A.open({ site: 'moodle', id: '12', url: `${O}/mod/forum/discuss.php?d=12`, onRead: () => reads.push(1) });
  await h.loaded; await settle(); h.close(true);
  assert.deepEqual(reads, [], 'manual read tracking remains unread');
  assert.equal(p.asked.length, 1, 'no extra write');
});

test('safe pictures use the LMS queue and release their bytes when replaced or closed', async () => {
  const p = page({ answer: () => ({ status: 200, blob: new Blob(['picture'], { type: 'image/png' }) }) });
  const h = p.P.open({ title: 'T', body: p.P.safe('<img src="/picture">') }); await settle();
  const src = h.dialog.querySelector('img').src;
  assert.match(src, /^blob:/);
  assert.equal(p.asked[0].init.redirect, 'error');
  assert.equal(p.asked[0].init.credentials, 'same-origin');
  assert.equal(await (await fetch(src)).text(), 'picture');
  h.set('Next'); await assert.rejects(fetch(src));
  h.set(p.P.safe('<img src="/picture">')); await settle();
  const next = h.dialog.querySelector('img').src;
  h.close(true); await assert.rejects(fetch(next));
  let release;
  const q = page({ answer: () => new Promise((r) => { release = r; }) });
  const closed = q.P.open({ title: 'T', body: q.P.safe('<img src="/picture">') });
  const img = closed.dialog.querySelector('img'); closed.close(true);
  release({ status: 200, blob: new Blob(['late'], { type: 'image/png' }) }); await settle();
  assert.equal(q.asked[0].init.signal.aborted, true);
  assert.equal(img.src, undefined, 'a late response creates no image address');
});

test('closing keeps decoded pictures available to the visual sheet and releases them when the effect ends', async () => {
  const p = page({ hold: true, motion: 'expressive', answer: () => ({ status: 200, blob: new Blob(['picture'], { type: 'image/png' }) }) });
  let closed = 0;
  const h = p.P.open({ title: 'T', source: p.link(), body: p.P.safe('<img src="/picture">'), onClose: () => closed++ });
  await settle();
  const src = h.dialog.querySelector('img').src;
  h.close();
  assert.equal(await (await fetch(src)).text(), 'picture', 'closing copies can still decode their image');
  h.close(true);
  await h.closed;
  await assert.rejects(fetch(src));
  assert.equal(closed, 1);
  assert.equal(p.host('gz-popup'), null);
});

test('a focused preview follows its link on scroll and resize and disappears when the link leaves', async () => {
  const p = page({ announce: { delay: 10 } });
  const a = p.link(); p.A.preview(a, ref()); a.focus(); a.dispatchEvent({ type: 'focus' });
  await wait(25); await settle();
  a.box = { left: 100, top: 70, width: 160, height: 20 }; p.emit('scroll');
  assert.ok(parseFloat(p.tip().style.top) >= 90, 'scrolling never moves the link under its preview');
  a.box = { left: 100, top: 120, width: 160, height: 20 }; p.emit('resize');
  assert.ok(parseFloat(p.tip().style.top) >= 140, 'resizing repositions the preview');
  a.remove(); p.emit('scroll');
  assert.equal(p.tip().hidden, true, 'a removed trigger leaves no orphaned preview');
  assert.equal(p.asked.length, 1, 'position changes do not fetch again');
});
