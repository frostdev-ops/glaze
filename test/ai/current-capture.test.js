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
const visible = (text) => ({ innerText: text, getClientRects: () => [1], closest: () => null });
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
