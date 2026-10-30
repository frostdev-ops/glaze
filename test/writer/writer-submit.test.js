// Glaze Writer's submit step, the pure parts (writer/writer-submit.js) over the probed attempt shape
// (test/fixtures/ultra-writer-attempt.html): the file name, Ultra's upload input and footer buttons, when the file shows as
// attached, the note and text as Quill ops, and the step order that keeps Ultra's Submit last. The sheet and the page's
// side in a browser: checks/writer/writer-submit-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const S = require('../../extension/writer/writer-submit.js');

const page = (f = 'ultra-writer-attempt.html') => { const doc = { activeElement: null }; doc.root = new El('html', doc); doc.body = parse(fs.readFileSync(path.join(__dirname, '../fixtures', f), 'utf8'), doc); return doc.body; };
const editorOf = (body) => body.querySelector('#bb-editorassignment-attempt-authoring-submission');

test('the file is Lastname_Title.docx, the title before its subtitle, letters and digits only', () => {
  assert.equal(S.fileName({ surname: 'Rivera', title: 'Essay 2: Memory in Beloved' }), 'Rivera_Essay2.docx');
  assert.equal(S.fileName({ surname: 'de la Cruz', title: 'research paper — final draft' }), 'DeLaCruz_ResearchPaperFinalDraft.docx');
  assert.equal(S.fileName({ surname: 'Müller', title: 'Aufsatz über Ökologie' }), 'Müller_AufsatzÜberÖkologie.docx');
  assert.equal(S.fileName({ title: 'Lab 3' }), 'Lab3.docx');
  assert.equal(S.fileName({ fallback: 'Paper' }), 'Paper.docx');
  assert.equal(S.fileName({ surname: '../..', title: '<script>' }), 'Script.docx');
  for (const n of ['Rivera_Essay2.docx', 'Müller_AufsatzÜberÖkologie.docx', S.fileName({ surname: 'x'.repeat(200), title: 'y'.repeat(200) })]) assert.ok(S.safeName(n), n);
  for (const n of ['../a.docx', 'a b.docx', 'a.doc', '.docx', 'a.docx.exe', null]) assert.equal(S.safeName(n), false, String(n));
  assert.equal(S.shortTitle('  Essay 2:  Memory '), 'Essay 2');
  assert.equal(S.shortTitle('Week 3 reading response'), 'Week 3 reading response');
  assert.equal(S.shortTitle(': only a subtitle'), ': only a subtitle');
  assert.equal(S.kb(38 * 1024 + 100), 38);
  assert.equal(S.kb(20), 1);
});

test('a workbook kept with its macros goes as .xlsm, Excel\'s macro-enabled type; every other one as .xlsx', () => {
  assert.equal(S.fileName({ surname: 'Rivera', title: 'Budget', ext: '.xlsm' }), 'Rivera_Budget.xlsm');
  assert.equal(S.fileName({ surname: 'Rivera', title: 'Budget', ext: '.xlsx' }), 'Rivera_Budget.xlsx');
  assert.equal(S.mimeOf('Rivera_Budget.xlsm'), 'application/vnd.ms-excel.sheet.macroEnabled.12');
  assert.equal(S.mimeOf('Rivera_Budget.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(S.kindOf('Budget.XLSM'), 'sheet');
  assert.ok(S.safeName('Rivera_Budget.xlsm', 'sheet'));
  assert.equal(S.route('Budget.xlsm', { kinds: ['sheet'] }), 'choose', 'brought to an assignment, it opens in Glaze or submits as is');
});

test('the probed attempt: the file area\'s own input, the drop zone, and the footer\'s Submit and Save and Close', () => {
  const body = page(), ed = editorOf(body), area = S.areaOf(ed);
  assert.match(area.className, /makeStylessubmission-/);
  const input = S.uploadInput(area);
  assert.equal(input.getAttribute('type'), 'file');
  assert.equal(input.id, '_1_');
  assert.ok(input.hasAttribute('multiple') && input.getAttribute('aria-hidden') === 'true');
  assert.match(S.dropZone(area).className, /makeStylesinputContainer-/);
  const { submit, save } = S.footer(ed);
  assert.equal(submit.textContent, 'Submit');
  assert.equal(save.textContent, 'Save and Close');
  assert.equal(S.actionOf(submit), 'submit');
  assert.equal(S.actionOf(save), 'save');
  assert.equal(S.actionOf(body.querySelector('[data-analytics-id="editor.toolbar.bold.button"]')), null);
  assert.equal(S.panelOf(ed).tagName, 'BB-ASSIGNMENT-ATTEMPT-AUTHORING-PANEL');
});

test('never the editor\'s own chooser, and nothing outside an attempt panel', () => {
  const body = page(), ed = editorOf(body), area = S.areaOf(ed);
  area.querySelector('[class*="makeStylespreview-"]').remove();
  assert.equal(S.uploadInput(area), null, 'no file area drawn: no input');
  const chooser = new El('input', body.doc); chooser.setAttribute('type', 'file'); chooser.id = 'browseForFiles';
  area.append(chooser);
  const inQuill = new El('input', body.doc); inQuill.setAttribute('type', 'file');
  ed.closest('.ql-container').append(inQuill);
  assert.equal(S.uploadInput(area), null);
  const other = new El('input', body.doc); other.setAttribute('type', 'file');
  area.append(other);
  assert.equal(S.uploadInput(area), other, 'a file input of the submission\'s own, outside Quill');
  const test = page('ultra-writer-test.html'), box = test.querySelector('.ql-editor[contenteditable="true"]');
  assert.equal(S.panelOf(box), null);
  assert.deepEqual(S.footer(box), { submit: null, save: null }, 'a test attempt has no assignment footer to act on');
  assert.equal(S.uploadInput(null), null);
});

test('Ultra\'s disabled states: the attribute, aria-disabled and Mui-disabled', () => {
  const b = new El('button', {});
  assert.equal(S.enabled(b), true);
  b.setAttribute('disabled', ''); assert.equal(S.enabled(b), false);
  const c = new El('button', {}); c.setAttribute('aria-disabled', 'true'); assert.equal(S.enabled(c), false);
  const d = new El('button', {}); d.className = 'MuiButton-root Mui-disabled'; assert.equal(S.enabled(d), false);
  assert.equal(S.enabled(null), false);
});

test('the file counts as attached only where it shows: not in the editors, inputs or live regions', () => {
  const body = page(), ed = editorOf(body), panel = S.panelOf(ed), name = 'Rivera_Essay2.docx';
  assert.equal(S.listed(panel, name), 0);
  ed.append(Object.assign(new El('p', body.doc), {}), 'Rivera_Essay2.docx typed in the box');
  const live = panel.querySelector('[role="status"]');
  const said = new El('span', body.doc); said.textContent = 'Rivera_Essay2.docx uploading'; live.append(said);
  assert.equal(S.listed(panel, name), 0, 'the box\'s text and Ultra\'s announcement don\'t count');
  const row = new El('div', body.doc), label = new El('span', body.doc);
  label.textContent = 'Rivera_Essay2';
  row.append(label);
  S.areaOf(ed).append(row);
  assert.equal(S.listed(panel, name), 1, 'a row naming the file (Ultra may drop the extension)');
  assert.equal(S.listed(panel, name, () => false), 0, 'and only when the page sees it');
  assert.equal(S.listed(panel, ''), 0);
});

test('the note, then the paper\'s text, as one plain insert Quill keeps', () => {
  assert.equal(S.delta({}), null);
  assert.equal(S.delta({ note: '  \n ', text: '' }), null);
  assert.deepEqual(S.delta({ note: 'Thanks for the extension.' }), [{ insert: 'Thanks for the extension.\n' }]);
  assert.deepEqual(S.delta({ note: 'Hi,\r\n\r\n\r\nsee attached.  ', text: 'Title\n\nFirst paragraph.\nSecond\tparagraph.\n\n' }),
    [{ insert: 'Hi,\n\nsee attached.\n\nTitle\n\nFirst paragraph.\nSecond\tparagraph.\n' }]);
  assert.deepEqual(S.delta({ text: 'Only\u0000the text' }), [{ insert: 'Only the text\n' }]);
  for (const d of [S.delta({ note: 'a' }), S.delta({ text: 'b\nc' })]) assert.ok(d.length === 1 && Object.keys(d[0]).join() === 'insert' && d[0].insert.endsWith('\n'), 'writer/writer-main.js takes it: plain inserts ending in a newline');
});

test('the steps: Ultra\'s Submit is reachable only after every step before it, in turn; any failure ends the run', () => {
  let s = S.start({ text: true });
  assert.deepEqual(s.plan, ['save', 'build', 'attach', 'text', 'submit']);
  assert.deepEqual(S.start({}).plan, ['save', 'build', 'attach', 'submit'], 'no note or text: nothing written into Ultra\'s box');
  assert.equal(S.may(s, 'submit'), false);
  for (const step of ['save', 'build', 'attach', 'text']) { assert.equal(S.step(s), step); s = S.advance(s, { step }); }
  assert.equal(S.may(s, 'submit'), true);
  s = S.advance(s, { step: 'submit' });
  assert.equal(s.done, true);
  assert.equal(S.may(s, 'submit'), false, 'once: a finished run never offers Submit again');
  for (const failAt of ['save', 'build', 'attach', 'text']) {
    let r = S.start({ text: true });
    while (S.step(r) !== failAt) r = S.advance(r, { step: S.step(r) });
    r = S.advance(r, { error: 'x' });
    assert.equal(r.error, 'x');
    r = S.advance(r, { step: failAt });
    assert.equal(S.may(r, 'submit'), false, `a failure at ${failAt} never reaches Submit`);
  }
  const skip = S.advance(S.advance(S.start({}), { step: 'save' }), { step: 'attach' });
  assert.equal(skip.error, 'order', 'a step out of order (the .docx not built) ends the run');
  assert.equal(S.may(skip, 'submit'), false);
});

test('review: listing requires an exact name, including a full title on visually truncated names', () => {
  const body = page(), area = S.areaOf(editorOf(body));
  const row = new El('span', body.doc); area.append(row);
  row.textContent = 'Rivera_Essay2_old.docx';
  assert.equal(S.listed(area, 'Rivera_Essay2.docx'), 0, 'a prefix is not the requested file');
  row.textContent = 'Rivera_Ess…'; row.setAttribute('title', 'Rivera_Essay2.docx');
  assert.equal(S.listed(area, 'Rivera_Essay2.docx'), 1, 'the full title proves a truncated listing');
});

// The hand-in (writer/page/writer-submit.js handIn): a file from any source, { name, mime, bytes }, bounded by Blackboard's
// 50 MB per file; Documents' attachments named Lastname_Title as the attempt's own file is, never twice.
test('the hand-in takes { name, mime, bytes } up to 50 MB, from an ArrayBuffer or its view', () => {
  const ok = { name: 'Rivera_Notes.docx', mime: S.MIME, bytes: new ArrayBuffer(10) };
  assert.equal(S.MAX_FILE, 50e6);
  assert.equal(S.handInError(ok), null);
  assert.equal(S.handInError({ ...ok, bytes: new Uint8Array(3) }), null);
  assert.equal(S.handInError({ ...ok, bytes: { byteLength: 50e6 } }), 'file', 'not bytes at all');
  const big = { byteLength: 50e6 + 1 };
  Object.setPrototypeOf(big, ArrayBuffer.prototype);
  assert.equal(S.handInError({ ...ok, bytes: big }), 'large', 'past 50 MB');
  for (const bad of [{ ...ok, bytes: new ArrayBuffer(0) }, { ...ok, name: '../x.docx' }, { ...ok, name: '' }, { ...ok, mime: null }, { ...ok, mime: 'x'.repeat(201) }, null, {}]) assert.equal(S.handInError(bad), 'file', JSON.stringify(bad));
  assert.equal(S.MAX_ATTACH, 10);
});

test('an attached document is Lastname_Title with its kind\'s extension, de-duplicated against the names taken', () => {
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Lab notes', name: 'Lab notes.docx' }), 'Rivera_LabNotes.docx');
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Grades: term 1', name: 'Grades term 1.xlsx' }), 'Rivera_Grades.xlsx', 'the title before its subtitle');
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Budget', name: 'Budget.xlsm' }), 'Rivera_Budget.xlsm');
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Field trip', name: 'Field trip.pdf' }), 'Rivera_FieldTrip.pdf');
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Week 3', name: 'Week 3.pptx' }), 'Rivera_Week3.pptx');
  assert.equal(S.attachName({ title: '', name: 'x.docx', fallback: 'Document' }), 'Document.docx');
  const taken = ['Rivera_Essay2.docx'];
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Essay 2', name: 'a.docx', taken }), 'Rivera_Essay2_2.docx', 'beside the attempt\'s own file');
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Essay 2', name: 'a.docx', taken: ['rivera_essay2.DOCX', 'Rivera_Essay2_2.docx'] }), 'Rivera_Essay2_3.docx', 'any case');
  assert.equal(S.attachName({ surname: 'Rivera', title: 'Essay 2', name: 'a.pdf', taken }), 'Rivera_Essay2.pdf', 'another extension is another name');
  const long = S.attachName({ surname: 'x'.repeat(200), title: 'y'.repeat(200), name: 'a.docx', taken: [S.attachName({ surname: 'x'.repeat(200), title: 'y'.repeat(200), name: 'a.docx' })] });
  assert.ok(long.endsWith('_2.docx') && S.safeName(long, 'paper'), `still a built file's name (${long.length})`);
  assert.equal(S.attachName({ name: 'Photo of lab.png', taken: ['photo of lab.png'] }), 'Photo of lab_2.png', 'a type no kind has keeps its own name');
});

test('the note names the attached files on a line after it', () => {
  assert.equal(S.noteWith('Here is my essay.', ['Rivera_Notes.docx', 'Rivera_Data.xlsx']), 'Here is my essay.\n\nAttached: Rivera_Notes.docx, Rivera_Data.xlsx');
  assert.equal(S.noteWith('', ['a.pdf'], 'Angehängt: {names}'), 'Angehängt: a.pdf');
  assert.equal(S.noteWith('Hi  \n', []), 'Hi');
  assert.ok(S.MAX_NOTE >= 4000 + 10 * 255);
});

test('Unicode and long attachment names remain valid filenames, including collision suffixes', () => {
  for (const title of ['e\u0301tude', '!!!', '𐐀'.repeat(61), '漢'.repeat(200)]) {
    const first = S.attachName({ surname: '漢'.repeat(40), title, name: 'a.docx' });
    const next = S.attachName({ surname: '漢'.repeat(40), title, name: 'a.docx', taken: [first.toUpperCase()] });
    for (const n of [first, next]) {
      assert.ok(S.safeName(n), n);
      assert.ok(Buffer.byteLength(n, 'utf8') <= 255, 'fits a filesystem component');
      assert.equal(n, n.normalize('NFC'));
    }
    assert.notEqual(first, next);
  }
  assert.equal(S.fileName({ title: 'e\u0301tude' }), 'Étude.docx');
  const raw = `${'a'.repeat(250)}.bin`;
  assert.ok(S.asIsName(S.attachName({ name: raw, taken: [raw] })), 'a collision suffix also fits an arbitrary file name');
});

test('an explicit extension disambiguates listings with the same workbook stem', () => {
  const body = page(), area = S.areaOf(editorOf(body)), row = new El('span', body.doc);
  row.textContent = 'Budget'; row.setAttribute('title', 'Budget.xlsx'); area.append(row);
  assert.equal(S.listed(area, 'Budget.xlsm'), 0);
  assert.equal(S.listed(area, 'Budget.xlsx'), 1);
});

test('attachment notes keep template and replacement characters in filenames literally', () => {
  const names = ['$&.bin', '{names}.bin', "quote$`$'.bin"];
  assert.equal(S.noteWith('Hi', names), `Hi\n\nAttached: ${names.join(', ')}`);
});
