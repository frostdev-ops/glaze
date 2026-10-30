// An assignment's file by kind (lib/writer-submit.js): a brought .pdf, .pptx or .ppsx asks Open in Glaze or Submit as is
// only while its kind opens in the frame (its Settings → Writer switch on, its viewer in this build); the file a kind
// submits is named Lastname_Title with that kind's extension and type; the steps build the file, whatever the kind.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/writer-submit.js');
const DK = require('../lib/doc-kinds.js');

test('route: a .docx always asks; a kind\'s file asks only while that kind opens here; anything else goes as is', () => {
  for (const n of ['Essay.docx', 'Rivera.pdf', 'Week 3.pptx', 'show.ppsx', 'notes.txt']) assert.equal(L.route(n), n.endsWith('.docx') ? 'choose' : 'submit', `no kinds: ${n}`);
  assert.equal(L.route('Rivera.pdf', { kinds: ['pdf'] }), 'choose');
  assert.equal(L.route('RIVERA.PDF', { kinds: ['pdf'] }), 'choose');
  assert.equal(L.route('Week 3.pptx', { kinds: ['pdf'] }), 'submit', 'slides off');
  assert.equal(L.route('Week 3.pptx', { kinds: ['slides'] }), 'choose');
  assert.equal(L.route('show.ppsx', { kinds: ['slides'] }), 'choose');
  assert.equal(L.route('Essay.docx', { kinds: [] }), 'choose', 'the paper takes Word files whatever else is on');
  for (const n of ['deck.ppt', 'scan.png', 'a.pdf.zip', '', null]) assert.equal(L.route(n, { kinds: ['pdf', 'slides', 'sheet'] }), 'submit', String(n));
  // A later kind (sheets/grid) joins by its id: its files ask once it opens here.
  assert.equal(L.route('Budget.xlsx', { kinds: [] }), 'submit');
  assert.equal(L.route('Budget.xlsx', { kinds: ['sheet'] }), 'choose');
  assert.equal(L.route('data.csv', { kinds: ['sheet'] }), 'choose');
  assert.equal(L.route('data.TSV', { kinds: ['sheet'] }), 'choose');
  assert.equal(L.mimeOf('data.tsv'), 'text/tab-separated-values');
  // The registry's forFile decides where it is given.
  assert.equal(L.route('Rivera.pdf', { kinds: ['pdf'], forFile: () => null }), 'submit');
  assert.equal(L.kindOf('Rivera.PDF'), 'pdf');
  assert.equal(L.kindOf('a.txt'), null);
});

test('the extensions a kind takes here are the registry\'s', () => {
  for (const [id, k] of Object.entries(DK.KINDS)) for (const ext of k.accept) assert.equal(L.kindOf(`x${ext}`), id, `${id} ${ext}`);
  for (const ext of Object.keys(L.EXT)) assert.ok(DK.forFile(`x${ext}`) === L.EXT[ext].kind || !DK.KINDS[L.EXT[ext].kind], `${ext} is ${L.EXT[ext].kind} in both`);
  assert.equal(L.EXT['.pdf'].mime, DK.KINDS.pdf.mime);
  assert.equal(L.EXT['.pptx'].mime, DK.KINDS.slides.mime);
  assert.equal(L.EXT['.docx'].mime, DK.KINDS.paper.mime);
});

test('fileName and safeName per kind: Lastname_Title with the kind\'s extension; the type by extension', () => {
  assert.equal(L.fileName({ surname: 'Rivera', title: 'Field trip: permission' }), 'Rivera_FieldTrip.docx', 'a paper as before');
  assert.equal(L.fileName({ surname: 'Rivera', title: 'Field trip: permission', ext: '.pdf' }), 'Rivera_FieldTrip.pdf');
  assert.equal(L.fileName({ surname: 'Rivera', title: 'Week 3', ext: '.pptx' }), 'Rivera_Week3.pptx');
  assert.equal(L.fileName({ title: 'Deck', ext: '.PPSX' }), 'Deck.ppsx');
  assert.equal(L.fileName({ fallback: 'Paper', ext: '.exe' }), 'Paper.docx', 'an extension no kind has falls back to Word\'s');
  assert.ok(L.safeName('Rivera_FieldTrip.pdf', 'pdf'));
  assert.ok(L.safeName('Rivera_Week3.pptx', 'slides') && L.safeName('Rivera_Week3.ppsx', 'slides'));
  assert.ok(L.safeName('Rivera_Essay2.docx') && L.safeName('Rivera_Essay2.docx', 'paper'), 'the paper\'s check is unchanged');
  for (const [n, k] of [['Rivera.pdf', 'paper'], ['Rivera.docx', 'pdf'], ['Rivera.pptx', 'pdf'], ['a b.pdf', 'pdf'], ['../a.pdf', 'pdf'], ['Rivera.pdf', 'nope'], ['Rivera.pdf', undefined]]) assert.equal(L.safeName(n, k), false, `${n} as ${k}`);
  assert.equal(L.mimeOf('Rivera.pdf'), 'application/pdf');
  assert.equal(L.mimeOf('Rivera.docx'), L.MIME);
  assert.equal(L.mimeOf('Week.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(L.mimeOf('Show.ppsx'), 'application/vnd.openxmlformats-officedocument.presentationml.slideshow');
  assert.equal(L.mimeOf('notes.txt'), null);
});

test('the steps build the file, whatever the kind: save, build, attach, text, submit', () => {
  assert.deepEqual(L.STEPS, ['save', 'build', 'attach', 'text', 'submit']);
  assert.deepEqual(L.start({ text: true }).plan, ['save', 'build', 'attach', 'text', 'submit']);
  assert.deepEqual(L.start({}).plan, ['save', 'build', 'attach', 'submit']);
  assert.deepEqual(L.start({ asis: true }).plan, ['attach', 'submit']);
  let s = L.start({});
  for (const step of ['save', 'build', 'attach', 'submit']) { assert.equal(L.step(s), step); s = L.advance(s, { step }); }
  assert.equal(s.done, true);
  assert.equal(L.advance(L.start({}), { step: 'build' }).error, 'order');
});
