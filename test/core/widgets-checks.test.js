const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

for (const script of ['widgets-sizes-check.js', 'ultra-boards-check.js']) {
  test(`${script}: resetting fixtures keeps the approved school registered for the next navigation`, async () => {
    const source = fs.readFileSync(require.resolve(`../scripts/${script}`), 'utf8');
    const body = source.slice(source.indexOf('    const store =')).match(/opts\.evaluate\(async \(\[s, local\]\) => \{([\s\S]*?)\}, \[s, local\]\)/)?.[1];
    assert.ok(body, 'exercise the actual browser storage setup');
    let data = { ultra: ['https://bb.school.test'], canvas: ['https://school.instructure.com/*'], obsolete: true }, lost = false;
    const changed = () => { if (!data.ultra?.includes('https://bb.school.test')) lost = true; };
    const chrome = { storage: {
      sync: { clear: async () => {}, set: async () => {} },
      local: { get: async (keys) => keys === null ? structuredClone(data) : Object.fromEntries([keys].flat().filter(k => k in data).map(k => [k, data[k]])),
        clear: async () => { data = {}; changed(); },
        remove: async keys => { for (const k of [keys].flat()) delete data[k]; changed(); },
        set: async patch => { Object.assign(data, patch); changed(); } },
    } };
    await vm.runInNewContext(`(async ([s, local]) => {${body}})`, { chrome })([{}, { ultra: ['https://bb.school.test'], widgetLayout: { tiles: [] } }]);
    assert.equal(lost, false, 'a transient approval removal queues unregistration after the readiness check');
    assert.equal(data.obsolete, undefined, 'stale fixture data is removed');
    assert.deepEqual(data.canvas, ['https://school.instructure.com/*'], 'other approved LMS hosts stay in place');
    assert.ok(data.widgetLayout);
  });
}

for (const script of ['widgets-sizes-check.js', 'ultra-boards-check.js']) {
  test(`${script}: navigation waits for the worker’s queued installation and registration`, async () => {
    const source = fs.readFileSync(require.resolve(`../scripts/${script}`), 'utf8');
    const start = source.indexOf('    const store =');
    const end = source.indexOf(script === 'widgets-sizes-check.js' ? '\n    const page =' : '\n    const layout =', start);
    const calls = []; let release, releaseWrites;
    const queued = new Promise(r => { release = r; });
    const writes = new Promise(r => { releaseWrites = r; });
    const worker = { evaluate: (fn) => { const pending = String(fn).includes('brokerTurn'); calls.push(pending ? 'writes' : 'worker'); return pending ? writes : queued; } };
    const store = vm.runInNewContext(`${source.slice(start, end)}\nstore;`, {
      opts: { evaluate: async () => { calls.push('seed'); } },
      page: { goto: async (url) => { assert.equal(url, 'about:blank'); calls.push('unload'); } },
      ctx: { serviceWorkers: () => [worker] },
      require: () => ({ ultraReady: async () => { calls.push('ready'); } }),
    });
    const saving = store({}, {});
    await new Promise(setImmediate);
    const prefix = script === 'widgets-sizes-check.js' ? ['unload', 'writes'] : [];
    if (prefix.length) {
      assert.deepEqual(calls, prefix, 'unload the old document and finish its writes before replacing fixture storage');
      releaseWrites(); await new Promise(setImmediate);
    }
    assert.deepEqual(calls, [...prefix, 'seed', 'worker'], 'registration readiness is checked after queued worker tasks complete');
    release(); await saving;
    assert.deepEqual(calls, [...prefix, 'seed', 'worker', 'ready']);
  });
}
