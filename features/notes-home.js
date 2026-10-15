// The notes app's Course notes button (Canvas). lib/background.js registers this file on Canvas sites' course pages only
// while Glaze and Notes (enhance.notes) are on, so the first content script carries nothing for it. On a course's home it
// loads features/notes.js, which places the button and keeps it in step with the switch; elsewhere it does nothing.
if (window.top === window && /^\/courses\/\d+\/?$/.test(location.pathname) && globalThis.GZ_CTX) {
  GZ_CTX.need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.sync(), () => {});
}
