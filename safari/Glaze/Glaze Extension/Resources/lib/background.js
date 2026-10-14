// The command palette's "Glaze settings": a content script can't open the editor itself.
// openOptionsPage reuses an open editor tab; when Chrome refuses it, a new tab (as the popup does).
chrome.runtime.onMessage.addListener((m) => {
  if (m !== 'options') return;
  const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
});

// Canvas on a school's own domain (canvas.school.edu) can't be matched by address. lib/detect.js sees Canvas's
// stylesheet in the page and asks here: Glaze goes into that page now, and onto its host for good, so the next
// pages are themed from the first paint as on *.instructure.com. The hosts are also kept in storage.local: not
// every browser honors persistAcrossSessions, and an update may clear them or change Glaze's file list.
const glaze = () => chrome.runtime.getManifest().content_scripts[0].js; // the one list, in the manifest
const script = (id) => ({ id, matches: [id], js: glaze(), runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
// Storage and registration change one at a time: two tabs can report the same host together.
let queue = Promise.resolve();
const serial = (f) => (queue = queue.then(f).catch(console.warn));
const ensure = async () => {
  const { canvas = [] } = await chrome.storage.local.get('canvas');
  const have = new Set((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const todo = canvas.filter((id) => !have.has(id));
  if (todo.length) await chrome.scripting.registerContentScripts(todo.map(script));
};
chrome.runtime.onInstalled.addListener(() => serial(async () => { await chrome.scripting.unregisterContentScripts(); await ensure(); }));
chrome.runtime.onStartup.addListener(() => serial(ensure));
chrome.runtime.onMessage.addListener((m, { tab, frameId, url }) => {
  if (m !== 'canvas' || frameId !== 0 || !tab) return;
  // The page lacks Glaze (the detector checked), so inject whatever the host's registration says.
  chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: glaze(), injectImmediately: true }).catch(console.warn);
  const { protocol, hostname } = new URL(url);
  const id = `${protocol}//${hostname}/*`;
  serial(async () => {
    const { canvas = [] } = await chrome.storage.local.get('canvas');
    if (!canvas.includes(id)) await chrome.storage.local.set({ canvas: [...canvas, id] });
    await ensure();
  });
});
