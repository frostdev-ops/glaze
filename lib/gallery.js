// Glaze — the Looks gallery on frostdev.io (the manifest runs this on its pages only). A student's click on a
// Look's "Use this Look in Glaze" hands its code to the background, which opens the editor to preview it; the
// editor applies nothing until the student says so there. Nothing is sent anywhere and nothing is added to
// the page. Without Glaze, or with one older than this, the same link goes to the gallery's instructions.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-glaze-use]');
  // isTrusted: a real click, not one the page's own script made.
  if (!a || !e.isTrusted || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const { code, name, author } = a.dataset;
  chrome.runtime.sendMessage({ gallery: { code, name, author } }, () => void chrome.runtime.lastError);
});
