// The Excel harness without Apple events: generated scripts and injected setup/read failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Excel = require('../scripts/sheet-excel.js');
const root = path.join(__dirname, '..');

const execute = async (name, options = {}) => {
  const logs = [], writes = new Map(), scripts = [], removed = [], quits = [];
  const list = options.cases || [{ id: 'math.sum.1', family: 'math', sheet: 'Cases', cell: 'A1', formula: '=1+1', inputs: {} }];
  const families = { math: { sheets: ['Cases', 'Data'] } };
  const excel = {
    str: Excel.str, num: Excel.num, start: () => ({ started: true, pid: 123 }),
    box: () => { if (options.boxError) throw Error('folder refused'); return '/scratch'; },
    quit: (self) => quits.push(self), osa: (s) => { scripts.push(s); return options.output || ''; },
  };
  const disk = {
    existsSync: () => name.includes('fidelity'), copyFileSync: () => {},
    readFileSync: () => Buffer.alloc(0), writeFileSync: (file, data) => writes.set(path.basename(file), data),
    rmSync: (dir) => removed.push(dir), statSync: () => ({ size: 100 }),
  };
  const file = path.join(root, 'scripts', name);
  const context = {
    __dirname: path.dirname(file), process: { argv: ['node', file, ...(options.args || [])] },
    console: { log: (s) => logs.push(s), error: (s) => logs.push(s) },
    require: (id) => {
      if (id === 'node:fs') return disk;
      if (id === './sheet-excel.js') return excel;
      if (id.includes('fixtures/sheets/cases')) return { cases: list, families };
      if (id.includes('xlsx-cache')) return { ...require('./helpers/xlsx-cache.cjs'), read: async () => ({ sheets: families.math.sheets.map((sheet) => ({
        name: sheet, cells: new Map(list.filter((c) => c.sheet === sheet).map((c) => [c.cell, { f: c.formula.slice(1), t: 'n', v: 2 }])),
      })) }) };
      return require(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8').replace('main().catch(', 'globalThis.done = main().catch('), context, { filename: file });
  await context.done;
  return { logs, writes, scripts, removed, quits, exitCode: context.process.exitCode };
};

test('Excel harness: a folder failure still quits the Excel instance it started', async () => {
  for (const file of ['sheet-excel-golden.js', 'sheet-excel-fidelity.js']) {
    const r = await execute(file, { boxError: true });
    assert.equal(r.exitCode, 2, file);
    assert.equal(r.quits.length, 1, `${file}: quit after setup failed`);
    assert.deepEqual(r.removed, []);
  }
});

test('Excel harness: a missing displayed text is a problem, never an invented empty string', async () => {
  const r = await execute('sheet-excel-golden.js', { output: 'S\x1fCases\x1fData' });
  assert.equal(r.exitCode, 1);
  assert.ok(r.logs.some((s) => /PROBLEM math.sum.1:.*display/.test(s)), r.logs.join('\n'));
  assert.deepEqual(JSON.parse(r.writes.get('golden.json')), {});
  assert.equal(r.quits.length, 1);
  assert.deepEqual(r.removed, ['/scratch']);
});

test('Excel harness: display records preserve sheet identity and separator characters', async () => {
  const cases = ['Cases', 'Data'].map((sheet, i) => ({ id: `math.sum.${i + 1}`, family: 'math', sheet, cell: 'A1', formula: '=1+1', inputs: {} }));
  const r = await execute('sheet-excel-golden.js', { cases,
    output: 'S\x1fCases\x1fData\x1eT\x1fmath.sum.1\x1fleft\x1dg\x1dr\x1du\x1eT\x1fmath.sum.2\x1fright' });
  const g = JSON.parse(r.writes.get('golden.json'));
  assert.equal(g['math.sum.1'].text, 'left\x1d\x1e\x1f');
  assert.equal(g['math.sum.2'].text, 'right');
  assert.equal(r.exitCode, undefined);
});

test('Excel harness: generated fills copy from the first cell in both directions', async () => {
  const cases = [{ id: 'math.sum.1', family: 'math', sheet: 'Cases', cell: 'D1', formula: '=Data!A1', inputs: {}, fill: 'D1:F3' }];
  const generated = (await execute('sheet-excel-golden.js', { cases })).scripts[0];
  assert.match(generated, /set formula2 of range "D1"/);
  assert.match(generated, /fill right range "D1:F1"/);
  assert.match(generated, /fill down range "D1:F3"/);
});

test('Excel harness: generated scripts restore application flags on errors', async () => {
  for (const file of ['sheet-excel-golden.js', 'sheet-excel-fidelity.js']) {
    const s = (await execute(file)).scripts[0];
    assert.match(s, /set oldAlerts to display alerts/);
    assert.match(s, /on error m number n[\s\S]*set display alerts to oldAlerts[\s\S]*error m number n/);
    if (file.includes('golden')) {
      assert.match(s, /set oldUpdating to screen updating/);
      assert.match(s, /on error m number n[\s\S]*set screen updating to oldUpdating/);
    }
  }
});

test('Excel harness: locale-sensitive parsing checks en-US before making a workbook', async () => {
  const s = (await execute('sheet-excel-golden.js')).scripts[0];
  assert.match(s, /get international data type country_setting/);
  assert.match(s, /get international data type decimal separator/);
  assert.ok(s.indexOf('country_setting') < s.indexOf('make new workbook'));
});
