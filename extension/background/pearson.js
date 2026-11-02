// A document-pinned, homework-only native math adapter. No arbitrary scripts, URLs, grading or submission operations.
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type !== 'glaze:pearson-math') return;
  const run = async () => {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || !Number.isInteger(sender.frameId) || sender.frameId < 0) return { error: 'sender' };
    let u;
    try { u = new URL(sender.url); } catch { return { error: 'sender' }; }
    if (u.origin !== 'https://tdx.acs.pearson.com' || !/^\/Player\/Player\.aspx$/i.test(u.pathname)) return { error: 'sender' };
    if (!['scan','open','prepare','apply','close'].includes(m.op) || typeof m.doc !== 'string' || m.doc.length > 64) return { error: 'request' };
    if (m.op !== 'close' && (!Number.isSafeInteger(m.deadline) || m.deadline > Date.now() + 10000 || m.deadline <= Date.now())) return { error: 'expired' };
    if (!globalThis.GZ_PEARSON_NATIVE) importScripts('../pearson/notation.js','../pearson/native.js');
    const raw = await chrome.storage.sync.get(['enabled','enhance']);
    if (m.op !== 'close' && (raw.enabled === false || raw.enhance?.pearsonMath === false)) return { error: 'inactive' };
    const request = { op: m.op, deadline: m.deadline };
    if (m.op === 'open') { if (typeof m.id !== 'string' || m.id.length > 200) return { error: 'request' }; request.id = m.id; }
    if (['prepare','apply','close'].includes(m.op)) { if (typeof m.token !== 'string' || m.token.length !== 36) return { error: 'request' }; request.token = m.token; }
    if (m.op === 'prepare') {
      const latex = GZ_PEARSON_NOTATION.prepare(m.latex);
      if (latex === null) return { error: 'unsupported' };
      request.latex = latex;
    }
    if (m.op === 'apply') { if (typeof m.stage !== 'string' || m.stage.length !== 36) return { error: 'request' }; request.stage = m.stage; }
    let target = sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId] };
    const probe = await chrome.scripting.executeScript({ target, func: (doc) => globalThis.__gzPearsonMathDoc === doc, args: [m.doc] });
    if (probe?.length !== 1 || probe[0].result !== true || probe[0].frameId !== sender.frameId
      || typeof probe[0].documentId !== 'string' || !probe[0].documentId
      || (sender.documentId && probe[0].documentId !== sender.documentId)) return { error: 'expired' };
    // A frame id alone can refer to the next document after navigation. Fail closed on engines without document pinning.
    target = { tabId: sender.tab.id, documentIds: [probe[0].documentId] };
    const result = await chrome.scripting.executeScript({ target, world: 'MAIN', func: GZ_PEARSON_NATIVE, args: [request] });
    return result?.[0]?.result || { error: 'unavailable' };
  };
  run().then(reply, () => reply({ error: 'unavailable' }));
  return true;
});
