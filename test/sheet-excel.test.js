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
    jxa: (s) => { scripts.push(s); return options.output || '{"name":"a.xlsx","caption":"a","date1904":false,"active":"Cases","names":["Cases"],"sheets":[]}'; },
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
      if (id === './sheet-fidelity-books.js') return { ...require('../scripts/sheet-fidelity-books.js'), books: async () => [{ name: 'a.xlsx', bytes: new Uint8Array(1), model: options.model || { sheets: [], active: 0, date1904: false } }] };
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
  const s = (await execute('sheet-excel-golden.js')).scripts[0];
  assert.match(s, /set oldAlerts to display alerts/);
  assert.match(s, /on error m number n[\s\S]*set display alerts to oldAlerts[\s\S]*error m number n/);
  assert.match(s, /set oldUpdating to screen updating/);
  assert.match(s, /on error m number n[\s\S]*set screen updating to oldUpdating/);
  // The fidelity script's JXA: the same flag back on its way out, after an error too.
  const j = (await execute('sheet-excel-fidelity.js')).scripts[0];
  assert.match(j, /const alerts = app\.displayAlerts\(\);/);
  assert.match(j, /\} catch \(e\) \{[\s\S]*wb\.close\(\{ saving: 'no' \}\)[\s\S]*app\.displayAlerts = alerts;[\s\S]*throw/);
});

test('Excel harness: locale-sensitive parsing checks en-US before making a workbook', async () => {
  const s = (await execute('sheet-excel-golden.js')).scripts[0];
  assert.match(s, /get international data type country_setting/);
  assert.match(s, /get international data type decimal separator/);
  assert.ok(s.indexOf('country_setting') < s.indexOf('make new workbook'));
});

const helper = ({ writeError = false } = {}) => {
  const killed = [], removed = [];
  let opened = false, probes = 0;
  const context = { module: { exports: {} }, process: {
    platform: 'darwin', env: {}, kill: (...args) => killed.push(args),
  }, require: (id) => {
    if (id === 'node:fs') return { existsSync: () => true, mkdtempSync: () => '/scratch/osa',
      writeFileSync: () => { if (writeError) throw Error('write refused'); }, rmSync: (dir) => removed.push(dir) };
    if (id === 'node:child_process') return { execFileSync: (cmd) => {
      if (cmd === 'open') { opened = true; return ''; }
      if (cmd === 'pgrep') { if (!opened || ++probes === 1) throw Error('not ready'); return '123\n'; }
      const err = Error('events refused'); err.stderr = '-1743'; throw err;
    } };
    return require(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts/sheet-excel.js'), 'utf8'), context);
  return { ...context.module.exports, killed, removed };
};

test('Excel helper: a delayed launch PID is captured before refused-event cleanup', () => {
  const h = helper();
  assert.throws(() => h.start(), /Automation/);
  assert.deepEqual(h.killed, [[123, 'SIGTERM']]);
});

test('Excel helper: a script write failure removes the temporary directory', () => {
  const h = helper({ writeError: true });
  assert.throws(() => h.osa('never sent'), /write refused/);
  assert.deepEqual(h.removed, ['/scratch/osa']);
});

test('fidelity: a missing error reading and an unexpected formula difference fail the run', async () => {
  const M = require('../lib/sheet-model.js');
  for (const cell of [{ t: 'e', v: '#VALUE!' }, { t: 'n', v: 5, f: '2+3' }]) {
    const model = M.workbook();
    model.sheets[0].rows.set(0, new Map([[0, cell]]));
    const r = await execute('sheet-excel-fidelity.js', { model, output: JSON.stringify({ name: 'a.xlsx', caption: 'a', date1904: false, active: 'Sheet1', names: ['Sheet1'],
      sheets: [{ formulas: [['=2+3']], cell: { A1: 2 }, cellF: { A1: cell.f ? '=2+3' : '#VALUE!' }, text: {}, fmt: {}, merges: {}, hidden: {} }] }) });
    assert.equal(r.exitCode, 1, JSON.stringify(cell));
  }
});

test('fidelity: expected models come from the source, before serialization', async () => {
  const M = require('../lib/sheet-model.js');
  let reads = 0;
  const context = { __dirname: path.join(root, 'scripts'), module: { exports: {} }, require: (id) => {
    if (id === 'node:fs') return { readdirSync: (p) => p.endsWith('/lib') ? [] : ['sample.xlsx'], readFileSync: () => new Uint8Array() };
    if (id === '../lib/sheet-xlsx.js') return { read: async () => { const wb = M.workbook(); wb.sheets[0].rows.set(0, new Map([[0, { t: 'n', v: ++reads }]])); return wb; }, write: async () => new Uint8Array() };
    return require(id);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts/sheet-fidelity-books.js'), 'utf8'), context);
  const list = await context.module.exports.books();
  assert.equal(M.cell(list[0].model.sheets[0], 0, 0).v, 1);
});

test('fidelity: only the workbook at the probe path can be read or closed', async () => {
  const s = (await execute('sheet-excel-fidelity.js')).scripts[0];
  assert.match(s, /fullName\(\)/);
  assert.ok(s.indexOf('fullName()') < s.indexOf('wb = opened'));
});

test('Numbers helper: refused events after launch clean up the owned process', () => {
  const killed = [];
  let opened = false;
  const context = { __dirname: path.join(root, 'scripts'), module: { exports: {} }, process: { platform: 'darwin', kill: (...args) => killed.push(args) }, require: (id) => {
    if (id === './sheet-fidelity-books.js') return require('../scripts/sheet-fidelity-books.js');
    if (id === 'node:fs') return { existsSync: () => true };
    if (id === 'node:child_process') return { execFileSync: (cmd) => {
      if (cmd === 'open') { opened = true; return ''; }
      if (cmd === 'pgrep') { if (!opened) throw Error('not running'); return '123\n'; }
      throw Error('events refused');
    } };
    return require(id);
  } };
  const source = fs.readFileSync(path.join(root, 'scripts/sheet-numbers-fidelity.js'), 'utf8');
  vm.runInNewContext(source.replace(/main\(\)\.catch\([\s\S]*$/, 'module.exports = { start };'), context);
  assert.throws(() => context.module.exports.start(), /events refused/);
  assert.deepEqual(killed, [[123, 'SIGTERM']]);
});
