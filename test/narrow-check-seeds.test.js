const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real options-page seed callback without starting a browser. These fixtures need the student's approval as well
// as a staged host grant; resetting local storage must not silently remove that approval before the next navigation.
const seed = (name, chrome) => {
  const source = fs.readFileSync(path.join(__dirname, `../scripts/${name}-check.js`), 'utf8');
  const call = name === 'share' ? 'settings.evaluate(' : 'opts.evaluate(';
  const start = source.indexOf(call) + call.length;
  const context = vm.createContext({ chrome, origin: 'https://ultra.fixture.test', O: 'https://bb.school.test' });
  for (let end = source.indexOf('=>', start) + 2; end < source.length; end++) {
    if (!/[})]/.test(source[end])) continue;
    try { return vm.runInContext(`(${source.slice(start, end + 1)})`, context); } catch (e) { if (e.name !== 'SyntaxError') throw e; }
  }
  throw Error(`no options seed in ${name}`);
};

const cases = [
  ...['ultra-perf', 'ultra-folders', 'ultra-cards', 'ultra-boards', 'share'].map((name) => [name, 'ultra', [name === 'ultra-perf' ? 'https://ultra.fixture.test' : 'https://bb.school.test']]),
  ['mods-combined', 'ultra', ['https://ultra.school.test']],
  ['mods-combined', 'moodle', ['https://strict.moodle.test/*', 'https://open.moodle.test/*']],
  ...['rules', 'nav-layout'].map((name) => [name, 'moodle', ['https://moodle.school.test/*']]),
];
for (const [name, kind, hosts] of cases) test(`${name} keeps its school-host ${kind} fixture approved after each reset`, async () => {
  const local = {};
  const area = (store) => ({ clear: async () => { for (const key of Object.keys(store)) delete store[key]; }, set: async (patch) => Object.assign(store, patch) });
  const chrome = { storage: { local: area(local), sync: area({}) } };
  const run = seed(name, chrome);
  for (let rep = 0; rep < 2; rep++) {
    await run(name === 'ultra-boards' ? [{}, rep ? undefined : { widgetLayout: {} }] : name === 'share' ? { patch: { enhance: {} }, relayURL: 'http://127.0.0.1:1234' } : {});
    assert.deepEqual(Array.from(local[kind] || []), hosts, 'the fixture is on its LMS list before its page opens');
  }
});
