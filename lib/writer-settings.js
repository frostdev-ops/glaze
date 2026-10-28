// Glaze Writer's settings in the editor frame (writer.html) and the worker: storage.sync `writer` (defaults.js GZ_SPEC.writer),
// cleaned by GZ_SANITIZE. now() is the last read (the defaults until the first read lands); follow(fn) calls fn(writer, was)
// on the first read and on every change after it. Outside the extension, or before defaults.js, it stays at the defaults.
// gate(off) is a ProseMirror plugin, put ahead of the editor's, that keeps the editor's own input rules (lib/writer-editor.js
// rules: Markdown shortcuts, then smart quotes and dashes) from running for a class off(cls) names ('smart' or 'markdown'):
// the character goes in as typed. Another plugin's rules (a list style, a line, a link) still get the key first.
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

  // ---- the gate on the editor's input rules ----------------------------------------------------------------------
  const MAX_MATCH = 500;
  const gate = (off, ctx = globalThis) => {
    const PM = ctx.GZ_PM, E = ctx.GZ_WRITER_EDITOR;
    if (!PM || !E?.rules) return null;
    const smart = new Set([...PM.inputrules.smartQuotes, PM.inputrules.emDash].map((r) => r.match));
    const kinds = new WeakMap();
    // The editor's rules for this schema, each with its class, in the order the editor runs them.
    const rulesOf = (schema) => {
      if (!kinds.has(schema)) kinds.set(schema, E.rules(schema).map((r) => ({ r, cls: smart.has(r.match) ? 'smart' : 'markdown' })));
      return kinds.get(schema);
    };
    // The editor's own input-rules plugin sits just before its history (lib/writer-editor.js plugins()).
    const ownRules = (state) => {
      const list = state.plugins, h = list.findIndex((p) => p.key === 'history$');
      return h > 0 && list[h - 1].spec.isInputRules ? list[h - 1] : null;
    };
    // The class of the editor's rule that would take this input, as the input-rules plugin picks it: the first that
    // matches and makes a change. null when none would.
    const taker = (view, from, to, text) => {
      const state = view.state, $from = state.doc.resolve(from);
      if ($from.parent.type.spec.code) return null;
      const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - MAX_MATCH), $from.parentOffset, null, '￼') + text;
      for (const { r, cls } of rulesOf(state.schema)) {
        if (r.inCode === 'only') continue;
        const m = r.match.exec(before);
        if (!m || m[0].length < text.length) continue;
        if (r.handler(state, m, from - (m[0].length - text.length), to)) return cls;
      }
      return null;
    };
    return new PM.state.Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (view.composing || !off('smart') && !off('markdown')) return false;
          const cls = taker(view, from, to, text);
          if (!cls || !off(cls)) return false;
          const own = ownRules(view.state);
          if (!own) return false;
          // Other input rules (lib/writer-objects.js's) run first, as they would have.
          for (const p of view.state.plugins) {
            if (p === own || !p.spec.isInputRules || typeof p.props.handleTextInput !== 'function') continue;
            if (p.props.handleTextInput.call(p, view, from, to, text)) return true;
          }
          view.dispatch(view.state.tr.insertText(text, from, to));
          return true;
        },
      },
    });
  };

  return { now: () => now, load, follow, patch, clean, gate };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_SETTINGS;
