const test = require('node:test');
const assert = require('node:assert/strict');
const { page, record, natives, unmoved } = require('./sidebar-ultra-page.js');

// The current Ultra overview has a table of contents and an inline-size query container.
// Its Grades / Attempts column should own the sidebar rather than project across two scrollers.
const overview = (toc = 'enabled') => {
  const p = page({ at: 'assessment', width: 1800, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  p.$('.table-of-contents-disabled').className = `table-of-contents-${toc}`;
  const grid = p.$('.assessment-overview-grid'), css = p.c.getComputedStyle;
  p.c.getComputedStyle = (e) => ({ ...css(e), containerType: e === grid ? 'inline-size' : 'normal' });
  return p;
};

// Structure observed on the live attempt/create page: the editable authoring column and the read-only details
// column are siblings; Save/Submit live in a separate footer outside their scroll container.
const attempt = (width = 1800) => {
  const p = page({ at: 'stream', width, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  p.c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  const editor = p.el('div', '', 'A draft answer');
  editor.id = 'bb-editorassignment-attempt-authoring-submission';
  editor.setAttribute('role', 'textbox'); editor.setAttribute('contenteditable', 'true');
  const rubric = p.el('a', '', 'View rubric'); rubric.setAttribute('href', '/rubric-view');
  const details = p.el('div', 'makeStylesdetails-0-2-1037', p.el('div', 'makeStylessidePanelContentMarginFix-0-2-1049', p.el('h2', '', 'Detalles e información'), rubric), p.el('div', '', 'Maximum points 5'));
  const container = p.el('div', 'makeStylescontainer-0-2-1034', p.el('div', 'makeStylesauthoring-0-2-1036', editor), details);
  const body = p.el('div', 'makeStylesbody-0-2-1120', container);
  const content = p.el('div', 'makeStylescontentRoot-0-2-1064', body);
  const save = p.el('button', 'save', 'Save and Close'), submit = p.el('button', 'submit', 'Submit');
  save.setAttribute('type', 'button'); submit.setAttribute('type', 'button');
  const footer = p.el('div', 'makeStylesfooterWrapper-0-2-1068', p.el('footer', 'makeStylesfooterRoot-0-2-1140', save, submit));
  const base = p.el('div', 'makeStylesbaseBody-0-2-1059', p.el('div', 'makeStylesheaderRoot-0-2-1062', p.el('h1', '', 'Assignment')), content, footer);
  const panel = p.el('bb-assignment-attempt-authoring-panel', 'react-container', p.el('div', '', p.el('div', 'makeStylespanelRoot-0-2-1056', base)));
  p.$('#main-content-inner').append(p.el('section', 'routed-page route-view-container bb-offcanvas-container', p.el('div', 'routed-page-body', panel)));
  return { p, editor, details, container, rubric, footer, save, submit };
};

test('current Ultra Grades / Attempts is the native sidebar host even with a tall widget dock', async () => {
  for (const toc of ['enabled', 'disabled']) {
    const p = overview(toc), section = p.$('.overview-attempts-section'), before = natives(p);
    const link = section.querySelector('a.button-attempt');
    let clicks = 0;
    link.addEventListener('click', () => clicks++);
    Object.defineProperty(section, 'scrollHeight', { configurable: true, get: () => 1800 });
    await p.pass();
    assert.ok(p.host() === section, `${toc}: the existing native column owns This page and the widgets`);
    assert.equal(p.host().getAttribute('data-gz-sidebar-host'), 'native');
    assert.equal(p.$('#gz-sb-absorb'), null, 'no viewport projection or separate scrolling aperture');
    assert.equal(p.$('.gz-sb-pagehead').hidden, false);
    assert.ok(section.contains(p.$('#gz-sb-widgets')));
    p.fire(link, 'click');
    assert.equal(clicks, 1, 'the original native action still receives the click');
    await p.pass();
    assert.ok(p.host() === section, 'Glaze controls do not make the next pass reject the native section');
    unmoved(p, before, toc);
    p.side.sync(false);
    assert.equal(section.hasAttribute('data-gz-sidebar-host'), false);
    assert.equal(section.querySelector('.gz-sb-head'), null);
    unmoved(p, before, 'off');
  }
});

for (const description of [true, false]) for (const details of [true, false]) for (const submitted of [true, false]) {
  test(`current assessment overview supports description=${description}, details=${details}, submitted=${submitted}`, async () => {
    const p = overview('disabled'), section = p.$('.overview-attempts-section');
    if (!description) p.$('.overview-description-section').remove();
    if (!details) p.$('.assessment-details-section').remove();
    const action = section.querySelector('a.button-attempt');
    if (submitted) {
      action.className = 'button button-attempt';
      action.textContent = 'View submission';
      const submission = p.el('a', 'has-link js-attempt-submitted', 'Submitted work');
      const grade = p.el('a', 'grade-rubric-detail disable-click', '--');
      submission.setAttribute('href', 'javascript:void(0);'); grade.setAttribute('href', 'javascript:void(0);');
      section.append(submission, grade);
    }
    const before = natives(p);
    let clicks = 0; action.addEventListener('click', () => clicks++);
    await p.pass();
    assert.ok(p.host() === section, 'the native Grades / Attempts column owns the sidebar');
    assert.ok(section.contains(p.$('#gz-sb-widgets')));
    p.fire(action, 'click'); assert.equal(clicks, 1);
    await p.pass();
    assert.ok(p.host() === section, 'the host stays recognized on the next pass');
    unmoved(p, before, 'overview variant');
    p.side.sync(false);
    assert.equal(section.hasAttribute('data-gz-sidebar-host'), false);
    unmoved(p, before, 'overview variant off');
  });
}

test('current assessment host supports folding and disabling absorption without moving its native controls', async () => {
  const p = overview(), section = p.$('.overview-attempts-section'), before = natives(p);
  await p.pass();
  p.side.op([{ op: 'section', family: 'assessment', part: 'page', v: true }]);
  assert.equal(section.hasAttribute('data-gz-sb-fold-page'), true);
  p.c.sidebarSettings = { absorb: false };
  await p.pass();
  assert.ok(p.host() !== section, 'absorption off restores the native column beside the assignment');
  assert.equal(section.hasAttribute('data-gz-sidebar-host'), false);
  assert.equal(section.hasAttribute('data-gz-sb-fold-page'), false);
  unmoved(p, before, 'absorption disabled');
});

test('current assessment detection rejects stale routes and unknown native overview structures', async () => {
  for (const change of [
    (p) => { p.c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt'; },
    (p) => { p.$('#grades-attempts-header').id = 'unrecognized'; },
    (p) => { p.$('.assessment-overview-grid').append(p.el('div', 'new-native-block', 'Unknown')); },
    (p) => { p.$('.overview-attempts-section').append(p.el('button', 'native-submit', 'Submit')); },
  ]) {
    const p = overview(), section = p.$('.overview-attempts-section');
    change(p);
    await p.pass();
    assert.ok(p.host() !== section);
    assert.equal(section.hasAttribute('data-gz-sidebar-host'), false);
  }
});

test('verified attempt Details & Information becomes the sidebar without moving the editor or submission footer', async () => {
  const { p, details, editor, rubric, footer, save, submit } = attempt(), before = natives(p);
  let rubricClicks = 0, submissions = 0;
  rubric.addEventListener('click', () => rubricClicks++);
  submit.addEventListener('click', () => submissions++);
  await p.pass();
  assert.ok(p.host() === details, 'the verified read-only details column owns the sidebar');
  assert.equal(p.$('.gz-sb-pagehead').hidden, false);
  assert.ok(!details.contains(editor) && !details.contains(footer));
  assert.ok(footer.contains(save) && footer.contains(submit));
  assert.equal(editor.textContent, 'A draft answer');
  assert.equal(submissions, 0, 'rendering never activates submission');
  p.fire(rubric, 'click');
  assert.equal(rubricClicks, 1, 'the original rubric action still works');
  await p.pass();
  assert.ok(p.host() === details, 'the Glaze dock does not invalidate the native details column');
  unmoved(p, before, 'attempt sidebar');
  p.side.sync(false);
  assert.equal(details.hasAttribute('data-gz-sidebar-host'), false);
  assert.equal(details.querySelector('.gz-sb-head'), null);
  assert.equal(editor.textContent, 'A draft answer');
  unmoved(p, before, 'attempt sidebar off');
});

test('attempt sidebar recognition requires the complete verified editor/details/footer structure', async () => {
  for (const change of [
    ({ p }) => { p.c.location.pathname = '/ultra/courses/_101_1/document/_7_1'; },
    ({ editor }) => { editor.id = 'unrecognized-editor'; },
    ({ footer }) => { footer.remove(); },
    ({ container, p }) => { container.append(p.el('div', 'unknown', 'Unknown native column')); },
    ({ details, p }) => { details.append(p.el('textarea', '', 'Editable details')); },
    ({ details }) => { details.hidden = true; },
    ({ p }) => { p.c.sidebarSettings = { absorb: false }; },
  ]) {
    const fixture = attempt();
    change(fixture);
    await fixture.p.pass();
    assert.ok(fixture.p.host() !== fixture.details);
    assert.equal(fixture.details.hasAttribute('data-gz-sidebar-host'), false);
  }
});

test('assessment sidebar hosts reject every native editable form while allowing read-only markup and widget editors', async () => {
  for (const kind of ['overview', 'attempt']) for (const [attr, value] of [['contenteditable', ''], ['contenteditable', 'plaintext-only'], ['contenteditable', 'true'], ['role', 'textbox'], ['role', 'combobox']]) {
    const fixture = kind === 'attempt' ? attempt() : { p: overview() };
    const p = fixture.p, details = fixture.details || p.$('.overview-attempts-section');
    const editor = p.el('div', '', 'Native editable content'); editor.setAttribute(attr, value); details.append(editor);
    await p.pass();
    assert.ok(p.host() !== details, `${kind}: native ${attr}=${JSON.stringify(value)} stays outside the sidebar`);
  }
  for (const kind of ['overview', 'attempt']) {
    const fixture = kind === 'attempt' ? attempt() : { p: overview() };
    const p = fixture.p, details = fixture.details || p.$('.overview-attempts-section');
    const text = p.el('div', '', 'Read-only markup'); text.setAttribute('contenteditable', 'false'); details.append(text);
    await p.pass();
    assert.ok(p.host() === details, `${kind}: explicitly read-only content is supported`);
    const widgetEditor = p.el('textarea', '', 'Widget notes'); p.$('#gz-sb-widgets').append(widgetEditor);
    await p.pass();
    assert.ok(p.host() === details, `${kind}: Glaze widget editors do not invalidate native metadata`);
    details.parentElement.setAttribute('contenteditable', 'plaintext-only');
    await p.pass();
    assert.ok(p.host() !== details, `${kind}: inherited native editing stays outside the sidebar`);
  }
});

test("the attempt's Save / Submit footer lifts the drawer's opener, though it is a row of Ultra's flex column, not fixed", async () => {
  const { p, footer } = attempt(1024);
  const boxOf = p.doc.boxOf;
  p.doc.boxOf = (e) => e.id === 'gz-sb-launch' ? { left: 932, top: 818, width: 80, height: 34 } : boxOf?.(e);
  footer.box = { left: 0, top: 797, width: 1024, height: 71 };
  await p.pass();
  assert.equal(p.mode(), 'drawer');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-bar'), `${p.c.innerHeight - 797}px`, 'the footer\'s top, from the window\'s bottom');
});
