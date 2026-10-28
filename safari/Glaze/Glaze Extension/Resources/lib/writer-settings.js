// Glaze Writer's settings in the editor frame (writer.html) and the worker: storage.sync `writer` (defaults.js GZ_SPEC.writer),
// cleaned by GZ_SANITIZE. now() is the last read (the defaults until the first read lands); follow(fn) calls fn(writer, was)
// on the first read and on every change after it. Outside the extension, or before defaults.js, it stays at the defaults.
// The editor reads now() directly when its input rules run.
// Classic script; module.exports for node.
var GZ_WRITER_SETTINGS = globalThis.GZ_WRITER_SETTINGS || (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_SANITIZE } : typeof require === 'function' ? require('../defaults.js') : null;
  const clean = (raw) => (G ? G.GZ_SANITIZE({ writer: raw }).writer : null);
  let now = clean(undefined), read = null;
  const fns = [];
  const sync = () => { try { return globalThis.chrome?.storage?.sync || null; } catch { return null; } };
  const set = (next) => { const was = now; now = next; for (const fn of fns) try { fn(now, was); } catch (e) { console.error(e); } };
  const load = () => (read ||= (async () => {
    const area = sync();
    if (!area || !G) return now;
    try { set(clean((await area.get('writer'))?.writer)); } catch { /* storage refused: the defaults stay */ }
    try { chrome.storage.onChanged.addListener((c, where) => { if (where === 'sync' && c.writer) set(clean(c.writer.newValue)); }); } catch { /* outside the extension */ }
    return now;
  })());
  const follow = (fn) => { if (typeof fn !== 'function') return; fns.push(fn); if (read) read.then(() => fn(now, null)); else load(); };
  // A change to one part, read-modify-written so a part another page changed meanwhile stays.
  const patch = async (fn) => {
    const area = sync();
    if (!area || !G) return;
    const cur = clean((await area.get('writer'))?.writer);
    await area.set({ writer: clean(fn(cur)) });
  };

  return { now: () => now, load, follow, patch, clean };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_SETTINGS;
