// Runs only in the exact homework player's MAIN world. Values remain in this document and its local Glaze editor.
// The native editor owns parsing, undo and form notifications. Nothing checks, saves or submits an answer here.
var GZ_PEARSON_NATIVE = (request) => {
  if (request.op !== 'close' && request.deadline !== undefined && (!Number.isSafeInteger(request.deadline) || Date.now() >= request.deadline)) return { error: 'expired' };
  if (location.origin !== 'https://tdx.acs.pearson.com' || !/^\/Player\/Player\.aspx$/i.test(location.pathname)
    || (request.op !== 'close' && (!document.querySelector('#playerViewer.playmode-homework') || !document.documentElement.hasAttribute('data-gz-pearson-math')))) return { error: 'inactive' };
  const registry = globalThis.dijit;
  const widget = (id) => { try {
    const node = typeof id === 'string' && document.getElementById(id);
    if (!node || !node.closest('#playerViewer') || !node.classList.contains('inputField')) return null;
    const w = registry?.byNode?.(node), e = w?._editor;
    if (!e || !['getEqText', 'getLatex', 'replaceEqText', 'doChange'].every((k) => typeof e[k] === 'function')
      || node.classList.contains('disabled') || e.getDisabled?.() || e.getReadOnly?.()) return null;
    if (!e.domNode?.addEventListener || !e.domNode?.removeEventListener) return null;
    return { node, w, e, question: node.closest('.contentHolder') || node.closest('#playerViewer') };
  } catch { return null; } };
  const bounded = (s) => typeof s === 'string' && s.length <= 8192;
  // MyLab's native infinity token exports this internal alias, not a LaTeX subscript.
  // Normalize only its exact grouped export; real subscripts such as {\infty}_{k} remain intact.
  const nativeLatex = (s) => {
    if (!bounded(s)) return null;
    // Consume escaped braces and backslashes before matching an actual alias group.
    return s.replace(/\\[\\{}]|\{\\infty_\}/g, (token) => token === '{\\infty_}' ? '{\\infty}' : token);
  };
  // Copy only construction data. DOM, callbacks and nested mutable settings must never be shared with an answer.
  const dataCopy = (value) => {
    let size = 0;
    const copy = (v, depth = 0) => {
      if (++size > 1024 || depth > 8) throw new Error('settings');
      if (v === null || ['string','number','boolean'].includes(typeof v)) return v;
      if (Array.isArray(v)) return v.map(x => copy(x, depth + 1));
      if (!v || Object.prototype.toString.call(v) !== '[object Object]' || v.nodeType) return undefined;
      const out = {};
      for (const k of Object.keys(v)) if (!['domNode','node','container','__proto__','constructor','prototype'].includes(k)) {
        const data = copy(v[k], depth + 1); if (data !== undefined) out[k] = data;
      }
      return out;
    };
    const result = copy(value);
    if ((JSON.stringify(result)?.length || 0) > 65536) throw new Error('settings');
    return result;
  };
  const settings = (e) => dataCopy(e.initializationParameters || {});
  const filterSettings = (e) => typeof e.filterEqText === 'function' ? null : JSON.stringify(dataCopy(e.filterEqText));
  const state = globalThis.__gzPearsonMathSessions ||= new Map();
  const discard = (key) => { const r = state.get(key); if (r) { r.eventNode.removeEventListener('eqeditor_change', r.notice); state.delete(key); } };
  for (const [key, r] of state) if (!r.node.isConnected || Date.now() - r.at > 1800000) discard(key);
  if (request.op === 'scan') {
    const labels = [], inputs = [];
    const walker = document.createTreeWalker(document.querySelector('#playerViewer.playmode-homework'), 1);
    let labelVisits = 0, inputVisits = 0, size = 0;
    for (let visited = 0; visited < 2048; visited++) {
      const n = walker.nextNode(); if (!n) break;
      if (n.classList.contains('eqLabel') && ++labelVisits <= 256 && labels.length < 128 && n.id && !n.closest('.inputField')) {
        try {
          const latex = nativeLatex(registry?.byNode?.(n)?.getEqDoc?.().getLatex());
          if (bounded(latex) && size + latex.length <= 32768) { size += latex.length; labels.push({ id: n.id, latex }); }
        } catch { /* retain native rendering */ }
      }
      if (n.classList.contains('inputField') && ++inputVisits <= 128 && inputs.length < 32 && n.id && widget(n.id)) inputs.push({ id: n.id });
      if (labels.length >= 128 && inputs.length >= 32) break;
    }
    return { labels, inputs };
  }
  if (request.op === 'open') {
    const x = widget(request.id);
    if (!x || state.size >= 8) return { error: 'unavailable' };
    try {
      const latex = nativeLatex(x.e.getLatex()), before = x.e.getEqText();
      if (!bounded(latex) || !bounded(before)) return { error: 'unavailable' };
      const token = crypto.randomUUID();
      const r = { ...x, before, settings: JSON.stringify(settings(x.e)), validator: x.e.isValidCharCode, filter: x.e.filterEqText, filterSettings: filterSettings(x.e),
        eventNode: x.e.domNode, dirty: false, at: Date.now(), stages: new Map() };
      r.notice = () => { r.dirty = true; };
      r.eventNode.addEventListener('eqeditor_change', r.notice);
      state.set(token, r);
      return { token, latex };
    } catch { return { error: 'unavailable' }; }
  }
  const r = state.get(request.token);
  if (!r) return { error: 'expired' };
  if (request.op === 'close') { discard(request.token); return { ok: true }; }
  const current = widget(r.node.id);
  try {
    if (!current || current.node !== r.node || current.w !== r.w || current.e !== r.e || current.question !== r.question || r.dirty || r.e.domNode !== r.eventNode
      || r.e.getEqText() !== r.before || JSON.stringify(settings(r.e)) !== r.settings
      || r.e.isValidCharCode !== r.validator || r.e.filterEqText !== r.filter || filterSettings(r.e) !== r.filterSettings) return { error: 'changed' };
  } catch { return { error: 'changed' }; }
  if (request.op === 'prepare') {
    if (!bounded(request.latex)) return { error: 'unsupported' };
    let scratch;
    try {
      scratch = new r.e.constructor(settings(r.e));
      if (typeof r.e.isValidCharCode === 'function') scratch.isValidCharCode = r.e.isValidCharCode;
      scratch.filterEqText = typeof r.e.filterEqText === 'function' ? r.e.filterEqText : dataCopy(r.e.filterEqText);
      scratch.setLatex(request.latex);
      const parsed = scratch.getEqText();
      if (!bounded(parsed)) return { error: 'unsupported' };
      // setLatex uses the display entity &infin;, whereas native input and grading use &inf;.
      // Reparse the canonical native value in scratch before staging it; the live answer is untouched.
      const eq = parsed.replace(/&infin;/g, '&inf;');
      if (eq !== parsed) {
        scratch.setEqText(eq);
        if (scratch.getEqText() !== eq) return { error: 'unsupported' };
      }
      const latex = nativeLatex(scratch.getLatex());
      if (!bounded(eq) || !bounded(latex) || (request.latex && scratch.isEmpty())) return { error: 'unsupported' };
      const stage = crypto.randomUUID();
      r.stages.set(stage, eq);
      while (r.stages.size > 4) r.stages.delete(r.stages.keys().next().value);
      return { stage, latex };
    } catch { return { error: 'unsupported' }; }
    finally { try { scratch?.destroy?.(); } catch { /* detached scratch only */ } }
  }
  if (request.op === 'apply') {
    if (!r.stages.has(request.stage)) return { error: 'expired' };
    const next = r.stages.get(request.stage);
    discard(request.token); // Consume successful and failed imports alike; no ambiguous retry after a setter runs.
    let notified = false;
    const notice = () => { notified = true; };
    r.e.domNode.addEventListener('eqeditor_change', notice);
    try {
      r.e.replaceEqText(next);
      if (r.e.getEqText() !== next) throw new Error('native import');
      if (!notified) r.e.doChange();
      return { ok: true };
    } catch {
      try { r.e.setEqText(r.before); r.e.doChange(); } catch { /* the native page may have left */ }
      return { error: 'unavailable' };
    } finally { r.e.domNode.removeEventListener('eqeditor_change', notice); }
  }
  return { error: 'request' };
};
if (typeof module !== 'undefined') module.exports = GZ_PEARSON_NATIVE;
