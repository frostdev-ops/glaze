// Glaze Writer's side of agent apps' document tools (lib/mcp/writer.js) in an open paper (writer.html after writer-ai.js,
// and papers.html's editor): what the worker asks over port 'glaze:mcp-writer' about the paper open here, answered from the
// editor. key: its key (GZ_WRITER_PAPER.current()); issues: GZ_WRITER_ISSUES's list; cite: what a citation of one of its
// sources (GZ_WRITER_CITE) would put at the caret; and, once the student allowed it in Glaze's approval window, insert (that
// citation put in, as Cite puts it) or fix (one of an issue's own suggestions, applied as its card applies it), each refused
// when what the student saw has changed. Opened after the frame's ready, for a paper only, never in a test's box, and only
// while agent access is on (storage.local mcp, Settings' mirror: the worker checks the real switch and admits the port as it
// does the AI's). A worker that stops takes the port with it; the next one's wake opens it again.
(() => {
  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || !globalThis.chrome?.runtime?.connect) return;
  const { TextSelection } = GZ_PM.state, { Fragment } = GZ_PM.model;
  const quiet = () => F.kind() === 'test' || F.context()?.kind === 'test' || F.mode() !== 'paper' || !F.editor();
  const paper = () => globalThis.GZ_WRITER_PAPER?.current?.() || null;
  const view = () => F.editor()?.view || null;
  const fail = (error) => ({ error });

  // ---- a citation at the caret, as writer-cite.js's insert writes it ---------------------------------------------------
  // The formatters' HTML (escaped text and <i> only) as runs, and as the text the student reads.
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const runs = (html) => String(html).split(/(<\/?i>)/).reduce((acc, part) => { if (part === '<i>') acc.i = true; else if (part === '</i>') acc.i = false; else if (part) acc.out.push({ text: unesc(part), i: acc.i }); return acc; }, { out: [], i: false }).out;
  const citation = (sourceId, page) => {
    const C = globalThis.GZ_WRITER_CITE, v = view();
    const src = v && typeof C?.format === 'function' ? C.sources().find((s) => s.id === sourceId) : null;
    if (!src) return null;
    const style = C.style(), f = C.format(src, style), at = v.state.selection.to, p = typeof page === 'string' ? page : '';
    // Chicago's first note for a source is its full one, a later note its short one; compose and the compact box have no
    // notes, so there it is the short note in parentheses.
    const note = style === 'chicago17' && F.mode() === 'paper' && document.documentElement.dataset.view !== 'compact';
    const earlier = note && C.cites(v.state.doc, C.sources(), style).some((c) => c.kind === 'note' && c.ids.includes(src.id) && c.at[0] < at);
    const html = note ? (earlier ? f.short(p) : f.note(p)) : style === 'chicago17' ? `(${f.short(p).replace(/\.$/, '')})` : f.inText(p);
    return { src, at, note, html, text: runs(html).map((r) => r.text).join('') };
  };
  const insert = (c) => {
    const ed = F.editor(), v = ed.view;
    if (c.note) {
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, c.at)));
      ed.run('footnote', c.html);
      return;
    }
    const schema = v.state.schema, italic = schema.marks.italic;
    const nodes = runs(c.html).map((r) => schema.text(r.text, r.i && italic ? [italic.create()] : []));
    const before = v.state.doc.textBetween(Math.max(0, c.at - 1), c.at, '\n', '\n');
    if (before && !/[\s(\[“"‘]/.test(before)) nodes.unshift(schema.text(' '));
    const frag = Fragment.from(nodes);
    const tr = v.state.tr.setSelection(TextSelection.create(v.state.doc, c.at)).insert(c.at, frag);
    v.dispatch(tr.setSelection(TextSelection.create(tr.doc, c.at + frag.size)).scrollIntoView());
  };

  // ---- what the worker asks ------------------------------------------------------------------------------------------
  const CHANGED = 'Nothing was done: the document changed since the student saw this.', NO_SOURCE = 'No such source in this document.';
  const OPS = {
    key: () => ({ value: { key: paper()?.key() || null, focus: document.hasFocus(), visible: document.visibilityState === 'visible' } }),
    issues: () => ({ value: (globalThis.GZ_WRITER_ISSUES?.list() || []).map((i) => ({ id: i.id, kind: i.kind, source: i.source, text: i.text, message: i.message, suggestions: i.suggestions.slice() })) }),
    cite: ({ sourceId, page }) => { const c = citation(sourceId, page); return c ? { value: { source: { id: c.src.id, title: c.src.title }, inText: c.text } } : fail(NO_SOURCE); },
    insert: ({ sourceId, page, inText }) => {
      const c = citation(sourceId, page);
      if (!c) return fail(NO_SOURCE);
      if (typeof inText === 'string' && c.text !== inText) return fail(CHANGED);
      if (!view().editable) return fail("The document can't be changed right now.");
      insert(c);
      return { value: { ok: true } };
    },
    fix: ({ issueId, suggestion, text }) => {
      const I = globalThis.GZ_WRITER_ISSUES, i = I?.list().find((x) => x.id === issueId);
      if (!i || !i.suggestions.includes(suggestion)) return fail("Not one of that issue's suggestions.");
      if (typeof text === 'string' && i.text !== text) return fail(CHANGED);
      if (!view().editable) return fail("The document can't be changed right now.");
      return I.apply(i, i.suggestions.indexOf(suggestion)) ? { value: { ok: true } } : fail(CHANGED);
    },
  };
  const answer = (m) => {
    if (!Object.hasOwn(OPS, m.op)) return fail('op');
    if (m.op !== 'key' && (quiet() || typeof m.key !== 'string' || paper()?.key() !== m.key)) return fail("This document isn't open in this Writer page any more.");
    try { return OPS[m.op](m.args && typeof m.args === 'object' ? m.args : {}); } catch (e) { console.error(e); return fail("Writer couldn't do that."); }
  };

  // ---- the port ------------------------------------------------------------------------------------------------------
  let ready = false, on = false, port = null, opened = 0;
  const close = () => { const p = port; port = null; try { p?.disconnect(); } catch { /* gone */ } };
  const open = () => {
    if (port) return;
    let p;
    try { p = chrome.runtime.connect({ name: 'glaze:mcp-writer' }); } catch { return; }
    port = p;
    opened = Date.now();
    p.onMessage.addListener((m) => { if (port === p && Number.isSafeInteger(m?.id)) { try { p.postMessage({ id: m.id, ...answer(m) }); } catch { /* gone */ } } });
    p.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === p) port = null; });
  };
  const sync = () => { if (ready && on && !quiet()) open(); else close(); };
  const read = () => Promise.resolve().then(() => chrome.storage.local.get('mcp')).then((r) => { on = r?.mcp?.on === true; sync(); }, () => {});
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.mcp) { on = ch.mcp.newValue?.on === true; sync(); } }); } catch { /* no storage */ }
  // A worker that just started: a port older than this moment went with the last one (Safari may not say so).
  try {
    chrome.runtime.onMessage.addListener((m, s) => {
      if (m?.type !== 'glaze:mcp-writer' || m.op !== 'wake' || s?.id !== chrome.runtime.id || (port && Date.now() - opened < 2000)) return;
      close();
      sync();
    });
  } catch { /* no runtime */ }
  F.on('ready', () => { ready = true; read(); });
  F.on('context', sync);
  addEventListener('pagehide', close);
  addEventListener('pageshow', sync);
})();
