const test = require('node:test');
const assert = require('node:assert/strict');
const { page, record, natives, unmoved, settle, read } = require('./sidebar-ultra-page.js');
const snapshot = (e) => JSON.stringify([e.className, e.attrs, e.dataset, Object.entries(e.style).filter(([, v]) => typeof v === 'string'), e.children.map((x) => x.tagName ? snapshot(x) : x.textContent)]);
const review = ({ width = 1800, savedWidth = 352 } = {}) => {
  const p = page({ at: 'stream', width, stored: record({ width: savedWidth, chose: { width: true }, dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  p.c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/overview/student-submission-view';
  const frame = p.el('iframe', ''); frame.setAttribute('src', 'https://annotate-us.foundations.blackboard.com/ui/pdf-viewer/1/index.html');
  const pane = p.el('div', '', frame); pane.id = 'files-viewer-tab-panel-:r1:'; pane.setAttribute('role', 'tabpanel');
  const viewer = p.el('section', 'viewer', pane), heading = p.el('h2', '', 'Rubric'); heading.id = 'rubric-heading';
  const controls = [p.el('button', '', 'Criterion one'), p.el('button', '', 'Criterion two'), p.el('a', '', 'Rubric detail')];
  controls[2].setAttribute('href', '#detail');
  const rubric = p.el('aside', '', heading, p.el('div', 'rubric-inline-container', ...controls.map((x) => p.el('div', 'criterion', x))));
  const main = p.el('main', '', viewer, rubric), header = p.el('div', 'makeStylesheaderRoot-review', 'Assessment Feedback');
  const wrap = p.el('div', 'bb-offcanvas-panel-wrap', p.el('div', 'review-shell', header, main));
  const layer = p.el('div', 'bb-offcanvas-panel screen student-view-submission-panel', wrap);
  p.$('#main-content-inner').append(layer);
  const oldBox = p.doc.boxOf;
  p.doc.boxOf = (e) => {
    const projected = !!p.$('#gz-sb-absorb'), x = p.c.innerWidth - 336;
    if (e === layer) return { left: 0, top: 0, width: p.c.innerWidth, height: 900 };
    if (e === header) return { left: 200, top: 0, width: p.c.innerWidth - 200, height: 60 };
    if (e === rubric) return { left: projected ? x : p.c.innerWidth - 430, top: 160, width: projected ? 320 : 430, height: 200 };
    if (e === viewer) return { left: 200, top: 100, width: p.c.innerWidth - 200 - (projected ? 380 : 430), height: 700 };
    if (controls.includes(e)) return { left: projected ? x + 10 : p.c.innerWidth - 420, top: 180 + controls.indexOf(e) * 40, width: 280, height: 30 };
    return oldBox(e);
  };
  const oldStyle = p.c.getComputedStyle;
  p.c.getComputedStyle = (e) => ({ ...oldStyle(e), ...(e === main ? { display: 'flex', flexDirection: 'row' } : {}), ...(e === viewer ? { flexGrow: '1' } : {}), ...(e === layer ? { position: 'absolute', zIndex: '1011' } : {}) });
  p.doc.elementFromPoint = (x, y) => controls.find((e) => { const r = e.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }) || rubric;
  p.side.drawn(1);
  return { ...p, frame, viewer, rubric, controls, layer, main, wrap };
};

test('the Rubric uses an owned stylesheet and its existing space, with no native mutation or listeners', async () => {
  const p = review(), was = snapshot(p.rubric), before = natives(p), parent = p.frame.parentNode, src = p.frame.getAttribute('src');
  let clicks = 0; p.controls[0].addEventListener('click', () => clicks++);
  await p.pass();
  assert.equal(p.mode(), 'expanded');
  assert.match(p.$('#gz-sb-absorb')?.textContent || '', /student-view-submission-panel/);
  assert.match(p.$('#gz-sb-absorb').textContent, /margin-inline-end:var\(--gz-sb-room\)/);
  assert.match(p.$('#gz-sb-absorb').textContent, /pointer-events:none!important/);
  assert.equal(snapshot(p.rubric), was);
  assert.equal(p.frame.parentNode, parent); assert.equal(p.frame.getAttribute('src'), src);
  p.fire(p.controls[0], 'click'); assert.equal(clicks, 1);
  unmoved(p, before, 'rubric projection');
  p.side.sync(false);
  assert.equal(p.$('#gz-sb-absorb'), null); assert.equal(snapshot(p.rubric), was);
});

test('the review sidebar clamps display width to the native Rubric column without overwriting the saved width', async () => {
  for (const [style, safe, width] of [['float', 0, 402], ['float', 20, 382], ['embed', 20, 414]]) {
    const p = review({ savedWidth: 480 }), css = p.c.getComputedStyle;
    p.c.sidebarSettings = { style };
    p.c.getComputedStyle = (e) => ({ ...css(e), getPropertyValue: (k) => k === '--gz-sb-safe' ? `${safe}px` : '' });
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sidebar-w'), `${width}px`);
    assert.equal(p.side.rec().width, 480);
    assert.ok(p.$('#gz-sb-absorb'));
  }
});

test('Rubric structure, viewer origin, stacking and painted controls are required', async () => {
  for (const change of [
    (p) => p.rubric.querySelector('h2').remove(),
    (p) => p.rubric.append(p.el('input', '')),
    (p) => p.frame.setAttribute('src', 'https://untrusted.test/viewer'),
    (p) => p.doc.elementFromPoint = () => p.doc.body,
    (p) => { const css = p.c.getComputedStyle; p.c.getComputedStyle = (e) => ({ ...css(e), ...(e === p.wrap ? { transform: 'matrix(1,0,0,1,0,0)' } : {}) }); },
  ]) {
    const p = review(); change(p); const was = snapshot(p.rubric); await p.pass();
    assert.equal(p.$('#gz-sb-absorb'), null); assert.equal(p.mode(), 'drawer'); assert.equal(snapshot(p.rubric), was);
  }
});

test('editable Rubric controls keep their native layout for every editing mode', async () => {
  for (const [attribute, value] of [['contenteditable', ''], ['contenteditable', 'plaintext-only'], ['role', 'textbox'], ['role', 'combobox']]) {
    const p = review(), control = p.el('div', '', 'Rubric feedback');
    control.setAttribute(attribute, value); p.rubric.querySelector('.rubric-inline-container').append(control);
    const was = snapshot(p.rubric); await p.pass();
    assert.equal(p.$('#gz-sb-absorb'), null, `${attribute}=${value}`);
    assert.equal(p.mode(), 'drawer'); assert.equal(snapshot(p.rubric), was);
  }
  const p = review(); p.rubric.setAttribute('contenteditable', 'plaintext-only');
  await p.pass(); assert.equal(p.$('#gz-sb-absorb'), null, 'an editable ancestor makes the Rubric editable too');
  const readonly = review(); readonly.rubric.setAttribute('contenteditable', 'false');
  await readonly.pass(); assert.ok(readonly.$('#gz-sb-absorb'), 'explicitly read-only content still qualifies');
});

test('scroll, native re-render, print, focus, drawer and absorption off restore the native Rubric', async () => {
  for (const how of ['scroll', 'rerender', 'print', 'focus', 'drawer', 'absorb', 'fold']) {
    const p = review(), was = snapshot(p.rubric); await p.pass(); assert.ok(p.$('#gz-sb-absorb'), how);
    if (how === 'scroll') p.event('scroll');
    if (how === 'rerender') p.mutate(p.main.parentElement);
    if (how === 'print') p.event('beforeprint');
    if (how === 'focus') { p.doc.root.setAttribute('data-gz-review-focus', ''); p.side.cover(); }
    if (how === 'drawer') await p.resize(900);
    if (how === 'absorb') { p.c.sidebarSettings = { absorb: false }; await p.pass(); }
    if (how === 'fold') { p.c.sidebarSettings = { page: 'folded' }; await p.pass(); }
    await settle();
    assert.equal(p.$('#gz-sb-absorb'), null, how); assert.equal(snapshot(p.rubric), was, how);
    await p.pass(); assert.equal(p.$('#gz-sb-absorb'), null, `${how}: no restore/reapply loop`);
  }
});

test('a failed viewer-width check or overflowing sidebar restores the native layout', async () => {
  for (const how of ['viewer', 'overflow']) {
    const p = review(); await p.pass(); assert.ok(p.$('#gz-sb-absorb'));
    const ro = p.sizes.find((o) => o.targets.includes(p.rubric));
    if (how === 'viewer') p.viewer.box = { left: 200, top: 100, width: 1, height: 700 };
    else p.rubric.box = { left: 1464, top: 160, width: 320, height: 1900 };
    ro.f(); await settle(); assert.equal(p.$('#gz-sb-absorb'), null, how); assert.equal(p.mode(), 'drawer', how);
  }
});

test('review styles never inset or narrow the full-window layer', () => {
  const css = read('features/sidebar.css');
  assert.doesNotMatch(css, /\.bb-offcanvas-panel[^{}]*\{[^}]*inset-inline-end: var\(--gz-sb-room\)/);
  assert.match(read('features/sidebar.js'), /const RUBRIC = .*main > aside:has\(\.rubric-inline-container\)/);
});

test('release documentation describes visual Rubric absorption and the native attempt fallback', () => {
  for (const file of ['docs/features.md', 'CHANGELOG.md']) {
    const text = read(file);
    assert.match(text, /attempt panels stay native/i, file);
    assert.match(text, /Rubric[^.]*visually/i, file);
    assert.match(text, /document review/i, file);
  }
  assert.match(read('CHANGELOG.md'), /## 3\.2\.1 \(unreleased\)/);
});
