const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const D = require(path.join(root, 'defaults.js')), L = require(path.join(root, 'lib/coursetabs.js'));

test('auto short name is the default and explicit old name/code choices stay unchanged', () => {
  assert.equal(D.GZ_SANITIZE({}).tabs.label, 'short');
  for (const label of ['name', 'code', 'short']) assert.equal(D.GZ_SANITIZE({ tabs: { label } }).tabs.label, label);
});

test('generic term and section wrappers shorten invented course names without reducing them to numbers', () => {
  const cases = {
    '209940-ZZ3456-007': 'ZZ 3456', '209940-ZZZ3456-007': 'ZZZ 3456',
    'FA28-ZZ3456-001': 'ZZ 3456', 'ZZ3456.01 FA28': 'ZZ 3456',
    'Fall 2028 ZZ3456 Section 2': 'ZZ 3456', 'ZZ3456 (Spring 2028)': 'ZZ 3456',
    '2028FA ZZ3456 Sec 01': 'ZZ 3456', 'ZZ3456-001-2028FA': 'ZZ 3456',
    '2028 ZZ3456-007': 'ZZ 3456', 'ZZ3456-007 2028': 'ZZ 3456', 'Q1010': 'Q 1010',
    'CS1010': 'CS 1010', 'History of Imaginary Cities': 'History of Imaginary Cities',
    'Imaginary Cities Section 2': 'Imaginary Cities', 'ZZ-101': 'ZZ-101',
    '202640': '202640', 'Spring 2028': 'Spring 2028', '99999': '99999',
  };
  assert.equal(typeof L.shortName, 'function');
  for (const [name, expected] of Object.entries(cases)) assert.equal(L.shortName(name), expected, name);
});

test('very long doubtful course names keep the full value without applying term expressions', () => {
  const value = 'Title ' + '-'.repeat(50000) + 'X';
  assert.equal(L.shortName(value), value);
});

test('nickname wins, explicit full/code choices remain, and the closed-tab note shares the display label', () => {
  const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
  const a = source.indexOf('  const labelFor = '), b = source.indexOf('  const draw = ', a);
  assert.ok(a >= 0);
  let nick = '', label = 'short';
  const labelFor = vm.runInNewContext(source.slice(a, b) + '\nlabelFor;', { ctx: { nickOf: () => nick }, P: () => ({ label }), L });
  assert.equal(labelFor('_71_1', 'FA28-ZZ3456-001', 'unhelpful_code'), 'ZZ 3456');
  label = 'name'; assert.equal(labelFor('_71_1', 'FA28-ZZ3456-001', 'unhelpful_code'), 'FA28-ZZ3456-001');
  label = 'code'; assert.equal(labelFor('_71_1', 'FA28-ZZ3456-001', 'unhelpful_code'), 'unhelpful_code');
  nick = 'My reading'; assert.equal(labelFor('_71_1', 'FA28-ZZ3456-001', 'unhelpful_code'), nick);
  assert.match(source, /Closed \{name\}[^\n]+name: labelFor\(/);
  assert.match(source, /'aria-label', r\.pin \? t\('\{name\}, pinned', \{ name: r\.full \}\) : r\.full/);
});
