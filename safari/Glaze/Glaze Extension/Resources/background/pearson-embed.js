// The worker alone injects the native opener hook and opens tabs. The site receives no extension-page authority.
importScripts('../pearson/embed.js');
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (m?.type !== 'glaze:pearson-embed') return;
  const run = async () => {
    if (s.id !== chrome.runtime.id || !s.tab || !Number.isInteger(s.frameId)) return { ok: false };
    const raw = await chrome.storage.sync.get(['enabled','enhance']);
    // Existing embedded sessions can still pop out after the preference is turned off; never discard their work.
    if (m.op === 'open') {
      if (!GZ_PEARSON_EMBED_LIB.lti(addressOf(s)) || !await fromUltra(s)) return { ok: false };
      const url = GZ_PEARSON_EMBED_LIB.homework(m.url) || GZ_PEARSON_EMBED_LIB.launch(m.url, addressOf(s));
      if (!url) return { ok: false };
      await chrome.tabs.create({ url, ...beside(s.tab) }); return { ok: true };
    }
    if (m.op !== 'launch' || raw.enabled === false || raw.enhance?.pearsonEmbed === false || s.frameId === 0) return { ok: false };
    let u; try { u = new URL(s.url); } catch { return { ok: false }; }
    if (u.origin !== GZ_PEARSON_EMBED_LIB.socket || u.pathname !== '/uiservice/opener' || typeof m.doc !== 'string' || !GZ_PEARSON_EMBED_LIB.channel(m.doc)) return { ok: false };
    const tab = await chrome.tabs.get(s.tab.id);
    const host = await fromUltra({ ...s, frameId: 0, url: tab.url, tab });
    if (!host) return { ok: false };
    let target = s.documentId ? { tabId: s.tab.id, documentIds: [s.documentId] } : { tabId: s.tab.id, frameIds: [s.frameId] };
    const probe = await chrome.scripting.executeScript({ target, func: doc => globalThis.__gzPearsonLaunchDoc === doc, args: [m.doc] });
    if (probe?.[0]?.result !== true) return { ok: false };
    const documentId = probe[0].documentId || s.documentId;
    // A reusable frame id can name a different document after an await. Keep the native opener if pinning is unavailable.
    if (!documentId) return { ok: false };
    target = { tabId: s.tab.id, documentIds: [documentId] };
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: ['pearson/launch-main.js'], injectImmediately: true });
    return { ok: true, host };
  };
  run().then(reply, () => reply({ ok: false })); return true;
});
