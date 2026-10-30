// Ultra opens an editor's toolbar menus (style, font, size, colour…) below their button, inside the page's scroller, which
// clips them: at the foot of a test the colour menu's last colours sat under the scroller's edge, out of reach. Once
// Ultra has drawn an opened menu, it is scrolled into view as far as it needs. A page feature (features/routes.js).
var GZ_EDITOR_MENU = globalThis.GZ_EDITOR_MENU || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  let listening = false, frame = 0;
  const opened = (e) => {
    const button = e.target?.closest?.('.bb-editor-toolbar-dropdown');
    if (button) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
      frame = 0;
      if (!listening || !ctx.on() || !button.isConnected) return;
      const menu = button.getAttribute('aria-expanded') === 'true' ? button.parentElement?.querySelector('.bb-editor-toolbar-submenu') : null;
      if (menu?.getClientRects().length) menu.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
  };
  const off = () => { cancelAnimationFrame(frame); frame = 0; if (listening) document.removeEventListener('click', opened, true); listening = false; };
  const sync = () => {
    if (!ctx.on()) return off();
    if (!listening) document.addEventListener('click', opened, true);
    listening = true;
  };
  return { sync, off };
})();

GZ_EDITOR_MENU;
