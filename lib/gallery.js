// Glaze — the Looks and mods gallery on frostdev.io (the manifest runs this on its pages only). A student's click on a
// Look's "Use this Look in Glaze" hands its code to the background, which opens the editor to preview it; the
// editor applies nothing until the student says so there. A mod's "Use in Glaze" hands over only its id and bundle hash:
// the background fetches that exact signed bundle and the editor asks before installing it. Nothing else is sent, and
// nothing is added to the page. Without Glaze, or with one older than this, the same link goes to the gallery's
// instructions.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[data-glaze-use], a[data-glaze-mod]');
  // isTrusted: a real click, not one the page's own script made.
  if (!a || !e.isTrusted || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const { code, name, author, id, hash } = a.dataset;
  const m = a.hasAttribute('data-glaze-mod') ? { galleryMod: { id, hash } } : { gallery: { code, name, author } };
  chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError);
});
