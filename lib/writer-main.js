// Glaze Writer's hand in the page's own world: the only place Ultra's Quill instance can be reached
// (`.ql-container.__quill`). lib/background.js puts it into an Ultra page that asked for a writer pass, with
// scripting.executeScript world MAIN (Chrome 95, Firefox 128, Safari 15.4; a manifest "world" entry needs Safari 18 and
// misses schools on their own hosts). features/writer.js asks it over document events, each detail a JSON string (an
// object doesn't cross between worlds in every browser):
//   gz-writer:set { id, delta } puts the Quill ops in as the student's edit (setContents, no clipboard heuristics in
//     between), so Ultra's Post, word count and draft follow it; the ops are checked first and only the compose formats
//     (lib/writer-schema.js delta) pass;
//   gz-writer:get { id };
//   each answered by gz-writer:done { id, ok, html, text }.
// The box is the .ql-container whose data-gz-writer-id is `id`. Nothing here moves focus, and the page hears only what its
// own editor holds. Runs once per document.
(() => {
  if (document.documentElement.hasAttribute('data-gz-writer-main')) return;
  document.documentElement.setAttribute('data-gz-writer-main', '');
  const quill = (id) => {
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return null;
    const c = document.querySelector(`.ql-container[data-gz-writer-id="${id}"]`), q = c?.__quill;
    return q && q.root?.isConnected && q.root === c.querySelector('.ql-editor') && typeof q.setContents === 'function' ? q : null;
  };
  // What compose writes, and nothing else: Quill ops whose inserts are text and whose formats Ultra's Quill keeps.
  const FORMATS = {
    bold: (v) => v === true, italic: (v) => v === true, underline: (v) => v === true, strike: (v) => v === true,
    script: (v) => v === 'super' || v === 'sub', link: (v) => typeof v === 'string' && v.length <= 2048 && /^(https?:|mailto:)/i.test(v),
    header: (v) => v === 3 || v === 4, list: (v) => v === 'bullet' || v === 'ordered', indent: (v) => Number.isInteger(v) && v >= 1 && v <= 8,
    align: (v) => v === 'center' || v === 'right' || v === 'justify', 'code-block': (v) => v === true,
  };
  const plain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const ops = (d) => {
    if (!Array.isArray(d) || !d.length || d.length > 200000) return false;
    let size = 0;
    for (const op of d) {
      if (!plain(op) || typeof op.insert !== 'string' || !op.insert || Object.keys(op).some((k) => k !== 'insert' && k !== 'attributes')) return false;
      if (op.attributes !== undefined && (!plain(op.attributes) || Object.entries(op.attributes).some(([k, v]) => !Object.hasOwn(FORMATS, k) || !FORMATS[k](v)))) return false;
      if ((size += op.insert.length) > 2000000) return false;
    }
    return d.at(-1).insert.endsWith('\n');
  };
  const done = (m) => document.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify(m) }));
  const on = (type, fn) => document.addEventListener(type, (e) => {
    let m;
    try { m = JSON.parse(e.detail); } catch { return; }
    try {
      const q = quill(m?.id);
      if (!q) { done({ id: m?.id, ok: false }); return; }
      const extra = fn(q, m); done({ id: m.id, ok: true, html: q.root.innerHTML, text: q.getText(), ...extra });
    } catch { done({ id: m?.id, ok: false }); }
  });
  on('gz-writer:set', (q, m) => {
    if (!ops(m.delta)) throw new Error('delta');
    q.setContents(m.delta, 'user');
  });
  on('gz-writer:get', (q) => {
    const s = q.getSelection?.();
    return s && Number.isSafeInteger(s.index) && s.index >= 0 && Number.isSafeInteger(s.length) && s.length >= 0 ? { selection: { index: s.index, length: s.length } } : {};
  });
})();
true;
