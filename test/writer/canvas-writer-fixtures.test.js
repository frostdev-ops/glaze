// The Canvas pages Glaze Writer stands in on (test/fixtures/canvas-writer-*.html and canvas-writer-rce.json), captured from
// the local Canvas 1c9f0bb8 with each editor open: where each came from, and the shapes writer/writer-canvas.js keys on
// (the RCE's textarea with data-rich_text, its <id>_ifr frame inside .rce-wrapper, each surface's send button, the Inbox's
// plain textarea).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');

const raw = (f) => fs.readFileSync(path.join(__dirname, '../fixtures', f), 'utf8');
const page = (f) => { const doc = { activeElement: null }; doc.root = new El('html', doc); return parse(raw(f), doc); };
const PAGES = ['assignment', 'discussion', 'thread', 'announcement', 'inbox', 'quiz', 'a2'];
const rce = JSON.parse(raw('canvas-writer-rce.json'));

test('every Writer fixture names local Canvas 1c9f0bb8, the seed, and what was done to capture it', () => {
  for (const p of PAGES) {
    const head = raw(`canvas-writer-${p}.html`).split('\n')[0];
    assert.match(head, /^<!-- Glaze test fixture: \/\S+ on the local Canvas 1c9f0bb8 \(seed: ~\/Projects\/canvas-lms\/glaze\/seed\.rb\)/, p);
    assert.match(head, /nothing typed or sent/, p);
  }
  assert.match(raw('canvas-writer-quiz.html').split('\n')[0], /practice quiz 56 .*one attempt started/);
  assert.match(raw('canvas-writer-a2.html').split('\n')[0], /assignments_2_student turned on for HIST 2010 \(course 36\), then off again/);
  assert.match(rce.note, /^Glaze test fixture: .*local Canvas 1c9f0bb8 .*glaze\/seed\.rb/);
  assert.equal(rce.canvas, '1c9f0bb8');
});

test('each RCE surface: a textarea marked data-rich_text, its <id>_ifr frame and the TinyMCE box inside one .rce-wrapper', () => {
  const ids = { assignment: ['submission_body'], discussion: ['message-body-root'], thread: ['message-body-102'], announcement: ['message-body-root'], quiz: ['question_input_0', 'question_input_4'], a2: ['textentry_text'] };
  for (const [p, want] of Object.entries(ids)) {
    const body = page(`canvas-writer-${p}.html`);
    const areas = body.querySelectorAll('textarea[data-rich_text="true"]');
    assert.deepEqual(areas.map((t) => t.id), want, p);
    for (const t of areas) {
      const wrapper = t.closest('.rce-wrapper');
      assert.ok(wrapper, `${p}: ${t.id} under .rce-wrapper`);
      assert.ok(wrapper.querySelector('.tox-tinymce'), `${p}: ${t.id} has its TinyMCE box`);
      assert.ok(wrapper.querySelector(`#${t.id}_ifr`), `${p}: ${t.id}_ifr`);
      assert.equal(t.style.display, 'none', `${p}: TinyMCE hides the textarea`);
    }
    // The quiz fixture keeps questions 1 and 5 of the five live editors (its header says why).
    assert.deepEqual(rce.pages[p].editors.map((e) => e.id), p === 'quiz' ? [0, 1, 2, 3, 4].map((n) => `question_input_${n}`) : want, `${p}: the live editors`);
    assert.deepEqual(rce.pages[p].tinymce, { major: '5', minor: '10.9' }, p);
    for (const e of rce.pages[p].editors) {
      assert.deepEqual([e.target, e.richText, e.mode, e.inline, e.iframe, e.wrapper, e.initialized], ['TEXTAREA', 'true', 'design', false, true, true, true], `${p}: ${e.id}`);
      assert.equal(e.autosave, false, `${p}: Canvas's own autosave, not TinyMCE's plugin`);
      assert.deepEqual(e.toolCommands, ['instructure_image', 'instructure_record', 'instructure_documents', 'instructure_equation', 'instructure_links'], `${p}: ${e.id}`);
    }
  }
});

test('the classic assignment: Text Entry form, submission[body], and its Submit', () => {
  const body = page('canvas-writer-assignment.html');
  const form = body.querySelector('form#submit_online_text_entry_form');
  const ta = form.querySelector('textarea#submission_body');
  assert.equal(ta.getAttribute('name'), 'submission[body]');
  assert.ok(form.querySelector('#body_errors'), 'Canvas\'s empty-text error');
  const submit = form.querySelectorAll('button[type="submit"]');
  assert.equal(submit.length, 1, 'one Submit button in the form');
  assert.ok(rce.pages.assignment.submitForm);
});

test('discussion, thread and announcement replies: one DiscussionEdit with its Reply and Cancel, the textarea testid shared with the Inbox', () => {
  for (const p of ['discussion', 'thread', 'announcement']) {
    const body = page(`canvas-writer-${p}.html`);
    const box = body.querySelector('[data-testid="DiscussionEdit-container"]');
    assert.ok(box, p);
    const ta = box.querySelector('textarea[data-rich_text="true"]');
    assert.equal(ta.getAttribute('data-testid'), 'message-body', `${p}: same testid as the Inbox's textarea`);
    assert.equal(box.querySelector('[data-testid="DiscussionEdit-submit"]').tagName, 'BUTTON', `${p}: Reply, the testid on the button itself`);
    assert.ok(box.querySelector('[data-testid="DiscussionEdit-cancel"]'), `${p}: Cancel`);
    assert.ok(!ta.closest('#compose-message-modal'), p);
    assert.deepEqual(rce.pages[p].testids['DiscussionEdit-submit'], ['BUTTON'], p);
  }
  assert.match(raw('canvas-writer-thread.html').split('\n')[0], /entry 102/);
});

test('the Inbox: a plain textarea in the compose modal, no RCE, and its Send', () => {
  const body = page('canvas-writer-inbox.html');
  const modal = body.querySelector('#compose-message-modal');
  const ta = modal.querySelector('textarea[data-testid="message-body"]');
  assert.ok(ta && !ta.hasAttribute('data-rich_text'));
  assert.equal(modal.querySelectorAll('.rce-wrapper').length, 0);
  assert.equal(modal.querySelector('[data-testid="send-button"]').tagName, 'BUTTON');
  assert.deepEqual(rce.pages.inbox.editors, []);
});

test('the quiz take page: an RCE per essay up to maxInitRenderedRCEs, the sixth not drawn yet, Canvas\'s Submit Quiz', () => {
  const body = page('canvas-writer-quiz.html');
  assert.ok(body.querySelector('form#submit_quiz_form'));
  assert.deepEqual(body.querySelectorAll('textarea.question_input').map((t) => [t.id, t.getAttribute('name')]), [['question_input_0', 'question_442'], ['question_input_4', 'question_446']]);
  const sixth = body.querySelector('#tinymce-parent-of-question_input_5');
  assert.ok(sixth && !sixth.querySelector('textarea') && !sixth.querySelector('.rce-wrapper'), 'past the fifth: no editor until it scrolls into view');
  assert.ok(body.querySelector('button#submit_quiz_button'));
  assert.equal(rce.pages.quiz.editors.length, 5, 'live: five editors of six questions');
  assert.equal(rce.pages.quiz.questionInputs, 5);
});

test('Assignments 2: the textentry_text RCE and its submit-button', () => {
  const body = page('canvas-writer-a2.html');
  const ta = body.querySelector('[data-testid="text-editor"] textarea#textentry_text');
  assert.ok(ta && ta.getAttribute('data-rich_text') === 'true');
  assert.equal(body.querySelector('[data-testid="submit-button"]').tagName, 'BUTTON');
});
