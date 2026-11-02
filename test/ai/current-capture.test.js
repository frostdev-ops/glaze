const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = () => fs.readFileSync(require('node:path').join(__dirname, '../../extension/ai/page/current-view.js'), 'utf8');
const page = (url, site, elements = {}, extra = {}) => {
  const location = new URL(url);
  const context = vm.createContext({ URL, location, document: { title: 'School', querySelector: (s) => elements[s] || null },
    GZ_CTX: { site, canvasCourseId: () => /^\/courses\/(\d+)/.exec(location.pathname)?.[1], courseId: () => /^\/ultra\/courses\/(_\d+_\d+)/.exec(location.pathname)?.[1] },
    getComputedStyle: (e) => e.style || { display: 'block', visibility: 'visible' }, ...extra });
  vm.runInContext(source(), context);
  return { get: () => JSON.parse(JSON.stringify(context.GZ_ASK_CURRENT.capture())), location, context };
};
const visible = (text, children = []) => {
  const nodes = [{ nodeType: 3, nodeValue: text }, ...children];
  const el = { nodeType: 1, tagName: 'DIV', innerText: text + children.map((c) => c.innerText).join(''), childNodes: nodes, getClientRects: () => [1], closest: () => null, getAttribute: () => null };
  for (let i = 0; i < nodes.length; i++) { nodes[i].parentElement = el; nodes[i].nextSibling = nodes[i + 1] || null; }
  el.firstChild = nodes[0];
  return el;
};
test('capture uses live Canvas identity and visible explicit instruction roots, never page fallback', () => {
  const p = page('https://school.test/courses/7/assignments/21?token=secret', 'canvas', { '#assignment_show .description': visible('Visible instructions') });
  assert.deepEqual(p.get(), { currentPage: 'https://school.test/courses/7/assignments/21?token=secret', current: { site: 'canvas', view: 'assignment', url: 'https://school.test/courses/7/assignments/21', title: 'School', course: { id: '7' }, assignment: { id: '21' }, material: { text: 'Visible instructions', source: 'instructions', truncated: false } } });
  p.location.pathname = '/courses/8/assignments/22';
  assert.equal(p.get().current.course.id, '8');
  assert.equal(p.get().current.assignment.id, '22');
});
test('hidden instructions and assessment routes cannot supply material or assignment identity', () => {
  const hidden = { textContent: 'answer key', innerText: '', getClientRects: () => [], closest: () => null };
  assert.equal(page('https://school.test/courses/7/assignments/21', 'canvas', { '#assignment_show .description': hidden }).get().current.material, undefined);
  const testView = page('https://school.test/courses/7/quizzes/21', 'canvas', { '#assignment_show .description': visible('test') }).get().current;
  assert.equal(testView.material, undefined); assert.equal(testView.assignment, undefined);
  const unknown = page('https://school.test/ultra/courses/_7_1/assessment/_21_1/attempt', 'ultra', {}, { GZ_WRITER_ULTRA: { pageKind: () => '' } }).get().current;
  assert.equal(unknown.view, 'page'); assert.equal(unknown.assignment, undefined);
});
test('Ultra requires positive guarded assignment evidence; material truncation is explicit', () => {
  const p = page('https://school.test/ultra/courses/_7_1/assessment/_21_1/attempt', 'ultra', { '#bb-editorassignment-attempt-authoring-instructions': visible('a'.repeat(4000)) }, { GZ_WRITER_ULTRA: { pageKind: () => 'assignment' } });
  assert.equal(p.get().current.assignment.id, '_21_1');
  assert.equal(p.get().current.material.truncated, true);
  assert.equal(p.get().current.material.text.length, 3072);
});
test('private Writer binding is separate from model context and absent when ambiguous', () => {
  const p = page('https://school.test/courses/7', 'canvas', {}, { GZ_WRITER: { current: () => ({ token: 'a'.repeat(32), revision: 3 }) } });
  assert.deepEqual(p.get().writer, { token: 'a'.repeat(32), revision: 3 });
  assert.equal(p.get().current.document, undefined);
  p.context.GZ_WRITER.current = () => null;
  assert.equal(p.get().writer, undefined);
});

test('transparent ancestors and excluded descendants never contribute instruction material', () => {
  const ghost = visible('INVISIBLE ANSWERS'); ghost.style = { opacity: '0', display: 'block' };
  const privateText = visible('ARIA ANSWERS'); privateText.getAttribute = (name) => name === 'aria-hidden' ? 'true' : null;
  const inert = visible('INERT ANSWERS'); inert.getAttribute = (name) => name === 'inert' ? '' : null;
  const root = visible('Visible directions', [ghost, privateText, inert]);
  const p = page('https://school.test/courses/7/assignments/21', 'canvas', { '#assignment_show .description': root });
  assert.equal(p.get().current.material.text, 'Visible directions');
  root.parentElement = { style: { opacity: '0', display: 'block' }, getAttribute: () => null };
  assert.equal(p.get().current.material, undefined);
});

test('collapsed and unrendered descendants stay excluded when reading visible instruction text', () => {
  const unrendered = visible('UNRENDERED ANSWERS'); unrendered.getClientRects = () => [];
  const collapsed = visible('COLLAPSED ANSWERS'); collapsed.tagName = 'DETAILS';
  const root = visible('Visible directions', [unrendered, collapsed]);
  root.innerText = 'Visible directions';
  const p = page('https://school.test/courses/7/assignments/21', 'canvas', { '#assignment_show .description': root });
  assert.equal(p.get().current.material.text, 'Visible directions');
});

test('instruction traversal is bounded even for many small elements', () => {
  let reads = 0;
  const root = visible('Directions', Array.from({ length: 2000 }, () => visible('x')));
  const p = page('https://school.test/courses/7/assignments/21', 'canvas', { '#assignment_show .description': root }, {
    getComputedStyle: () => { reads++; return { display: 'inline', visibility: 'visible' }; },
  });
  const material = p.get().current.material;
  assert.ok(reads <= 256);
  assert.equal(material.truncated, true);
  assert.ok(material.text.length <= 3072);
});

test('live test evidence excludes a pinned Writer as well as instruction material', () => {
  const writer = { current: () => ({ token: 'a'.repeat(32), revision: 1 }) };
  const canvas = page('https://school.test/courses/7/assignments/21', 'canvas', {
    '#assignment_show .description': visible('Directions'), '#quiz_show, #questions.assessment_questions, .quiz-taking': {},
  }, { GZ_WRITER: writer }).get();
  assert.equal(canvas.current.assignment, undefined); assert.equal(canvas.current.material, undefined); assert.equal(canvas.writer, undefined);
  const ultra = page('https://school.test/ultra/courses/_7_1/assessment/_21_1/attempt', 'ultra', {
    '#bb-editorassignment-attempt-authoring-instructions': visible('Directions'), 'bb-attempt-canvas': {},
  }, { GZ_WRITER: writer }).get();
  assert.equal(ultra.current.assignment, undefined); assert.equal(ultra.current.material, undefined); assert.equal(ultra.writer, undefined);
});
