// Ask's read-only editor channel. It does not use agent-app access. A private random token and editor revision bind the
// page's pre-focus pin to this live document; raw paper keys stay on the trusted worker channel.
(() => {
  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || !globalThis.chrome?.runtime?.connect) return;
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  let revision = 0, previous = null, port = null, ready = false;
  const paper = () => globalThis.GZ_WRITER_PAPER?.current?.();
  const sample = () => {
    const p = paper(), v = F.editor()?.view, context = F.context();
    if (F.kind() === 'test' || context?.kind === 'test' || F.mode() !== 'paper' || p?.kind?.() !== 'paper' || !p.key?.() || !v?.state?.doc) { previous = null; return null; }
    const { doc, selection } = v.state, key = p.key();
    if (!previous || previous.doc !== doc || previous.key !== key || previous.from !== selection.from || previous.to !== selection.to) {
      previous = { doc, key, from: selection.from, to: selection.to };
      revision++;
    }
    return { p, doc, key, selection, context };
  };
  const refresh = () => {
    if (!ready) return;
    if (!sample()) { F.say({ type: 'ask:binding', token: null }); return; }
    F.say({ type: 'ask:binding', token, revision, focused: document.hasFocus() });
  };
  const answer = (m) => {
    const s = sample();
    if (m?.op !== 'current' || !s || m.token !== token || m.revision !== revision) return { error: 'stale' };
    // Bound the reads themselves, including selections far into a large paper. ProseMirror positions count structure
    // too; cutting before the end conservatively reports truncation even when fewer text characters were extracted.
    const end = Math.min(s.doc.content.size, 3073), selectedEnd = Math.min(s.selection.to, s.selection.from + 3073);
    const selected = s.selection.from === s.selection.to ? '' : s.doc.textBetween(s.selection.from, selectedEnd, '\n');
    const all = `${selected ? `Selected text:\n${selected}\n\n` : ''}Draft:\n${s.doc.textBetween(0, end, '\n')}`;
    const title = s.p.paper?.()?.title;
    return { value: { token, revision, key: s.key, context: s.context, ...(typeof title === 'string' && { title: title.slice(0, 240) }), text: all.slice(0, 3072), truncated: end < s.doc.content.size || selectedEnd < s.selection.to || all.length > 3072 } };
  };
  const close = () => { const old = port; port = null; try { old?.disconnect(); } catch { /* gone */ } };
  const open = () => {
    if (!ready || port || F.mode() !== 'paper' || F.kind() === 'test' || F.context()?.kind === 'test') return;
    try {
      const p = chrome.runtime.connect({ name: 'glaze:ask-writer' });
      port = p;
      p.onMessage.addListener((m) => { if (port === p && Number.isSafeInteger(m?.id)) try { p.postMessage({ id: m.id, ...answer(m) }); } catch { /* gone */ } });
      p.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (port === p) port = null; });
    } catch { /* worker unavailable */ }
  };
  globalThis.GZ_WRITER_CURRENT = { refresh: () => { open(); refresh(); } };
  F.on('ready', () => { ready = true; open(); if (F.kind() !== 'test' && F.context()?.kind !== 'test') refresh(); });
  F.on('change', refresh);
  F.on('context', () => { open(); refresh(); });
  // ProseMirror updates also cover a document loaded from storage, imports and caret movement.
  if (globalThis.GZ_PM?.state?.Plugin) F.plugin(new GZ_PM.state.Plugin({ view: () => ({ update: refresh }) }));
  for (const event of ['focusin', 'selectionchange']) document.addEventListener(event, () => { open(); refresh(); });
  addEventListener('pagehide', close);
  addEventListener('pageshow', () => { open(); refresh(); });
  try { chrome.runtime.onMessage.addListener((m, sender) => { if (sender?.id === chrome.runtime.id && m?.type === 'glaze:ask-writer' && m.op === 'wake') { close(); open(); refresh(); } }); } catch { /* unavailable */ }
})();
