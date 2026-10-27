// Glaze Writer's hand in the page's own world: the only place Ultra's Quill instance can be reached
// (`.ql-container.__quill`). lib/background.js puts it into an Ultra page that asked for a writer pass, with
// scripting.executeScript world MAIN (Chrome 95, Firefox 128, Safari 15.4; a manifest "world" entry needs Safari 18 and
// misses schools on their own hosts). features/writer.js asks it over document events, each detail a JSON string (an
// object doesn't cross between worlds in every browser):
//   gz-writer:set { id, html } puts the HTML in as the student's edit, so Ultra's Post, word count and draft follow it;
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
    return q && q.root?.isConnected && q.root === c.querySelector('.ql-editor') && typeof q.setContents === 'function' && q.clipboard ? q : null;
  };
  const done = (m) => document.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify(m) }));
  const on = (type, fn) => document.addEventListener(type, (e) => {
    let m;
    try { m = JSON.parse(e.detail); } catch { return; }
    try {
      const q = quill(m?.id);
      if (!q) { done({ id: m?.id, ok: false }); return; }
      fn(q, m); done({ id: m.id, ok: true, html: q.root.innerHTML, text: q.getText() });
    } catch { done({ id: m?.id, ok: false }); }
  });
  // Quill 1.x converts an HTML string; 2.x takes { html }.
  on('gz-writer:set', (q, m) => {
    if (typeof m.html !== 'string') throw new Error('html');
    q.setContents(/^2\./.test(q.constructor?.version || '') ? q.clipboard.convert({ html: m.html }) : q.clipboard.convert(m.html), 'user');
  });
  on('gz-writer:get', () => {});
})();
true;
