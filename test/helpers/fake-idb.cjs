// A small in-memory IndexedDB for running the worker's own source in node: open (with an upgrade the first time), one object
// store per name, out-of-line keys, get / put / delete / getAllKeys / getAll, and a transaction that completes once its
// requests have. Values are stored as structured clones, as the real one does. Enough for lib/background.js's stores.
const later = (f) => setImmediate(f);

exports.fakeIDB = () => {
  const dbs = new Map();
  const request = (run) => {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
    r.run = () => { try { r.result = run(); r.onsuccess?.({ target: r }); } catch (e) { r.error = e; r.onerror?.({ target: r }); } };
    return r;
  };
  const inRange = (range, k) => !range || (k >= range.lower && k <= range.upper);
  const store = (data, tx) => {
    const ask = (run) => { const r = request(run); tx.pending.push(r); tx.kick(); return r; };
    return {
      get: (k) => ask(() => structuredClone(data.get(k))),
      put: (v, k) => ask(() => { if (tx.mode !== 'readwrite') throw new Error('ReadOnlyError'); data.set(k, structuredClone(v)); return k; }),
      delete: (k) => ask(() => { if (tx.mode !== 'readwrite') throw new Error('ReadOnlyError'); data.delete(k); }),
      getAllKeys: (range) => ask(() => [...data.keys()].filter((k) => inRange(range, k)).sort()),
      getAll: (range) => ask(() => [...data.keys()].filter((k) => inRange(range, k)).sort().map((k) => structuredClone(data.get(k)))),
    };
  };
  const database = (stores) => ({
    onversionchange: null,
    close() {},
    createObjectStore: (name) => { stores.set(name, new Map()); },
    transaction: (name, mode = 'readonly') => {
      if (!stores.has(name)) throw new Error(`NotFoundError: ${name}`);
      const tx = { mode, pending: [], oncomplete: null, onerror: null, onabort: null, error: null, scheduled: false };
      tx.kick = () => {
        if (tx.scheduled) return;
        tx.scheduled = true;
        later(() => {
          tx.scheduled = false;
          const now = tx.pending.splice(0);
          for (const r of now) r.run();
          if (tx.pending.length) return tx.kick();
          const failed = now.find((r) => r.error);
          if (failed) { tx.error = failed.error; tx.onerror?.({ target: tx }); } else tx.oncomplete?.({ target: tx });
        });
      };
      tx.objectStore = () => store(stores.get(name), tx);
      tx.kick(); // a transaction with no requests still completes
      return tx;
    },
  });
  const indexedDB = {
    dbs,
    open: (name) => {
      const r = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      later(() => {
        let stores = dbs.get(name);
        const fresh = !stores;
        if (fresh) { stores = new Map(); dbs.set(name, stores); }
        r.result = database(stores);
        if (fresh) r.onupgradeneeded?.({ target: r });
        r.onsuccess?.({ target: r });
      });
      return r;
    },
  };
  const IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  return { indexedDB, IDBKeyRange };
};
