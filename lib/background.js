// The command palette's "Glaze settings": a content script can't open the editor itself.
// openOptionsPage reuses an open editor tab; when Chrome refuses it, a new tab (as the popup does).
chrome.runtime.onMessage.addListener((m) => {
  if (m !== 'options') return;
  const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
});
