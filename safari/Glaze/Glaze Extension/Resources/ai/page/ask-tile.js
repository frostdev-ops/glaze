// Ask Rime as a widget (core/page/widgets.js MORE 'ask', docs/ai-harness.md "Ask Rime"): the chat (ai/page/ask-chat.js
// GZ_ASK_CHAT) mounted in a tile's body, on any surface Glaze has tiles: Ultra's Dashboard and Courses boards, Canvas's
// Dashboard, floating over every page, and the sidebar's dock. The widget system offers and draws it only while AI and Ask
// Rime are on, and loads this file only while the tile is on. The chat comes in first, so the tile is drawn with it whole.
// Each tile keeps its own conversation while the page lives; nothing is kept after it goes. focus() is ⌘K's: the palette
// asks the widget system to reveal this tile (GZ_WIDGETS_UI.reveal('ask')) before it opens the dialog. Loaded on demand: a
// second injection keeps the first.
var GZ_ASK_TILE = globalThis.GZ_ASK_TILE || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return undefined;
  // fill(body, api) → { focus, stop }, as core/page/widgets.js register() takes it.
  const fill = (body) => {
    body.className = `${body.className || ''} gz-ask-tile`.trim();
    const chat = globalThis.GZ_ASK_CHAT.mount(body, { variant: 'tile' });
    return { focus: () => chat.focus(), stop: () => chat.stop() };
  };
  ctx.need('ai/page/ask-chat.js', () => globalThis.GZ_ASK_CHAT).then(() => globalThis.GZ_WIDGETS_UI?.register('ask', fill), () => {});
  return { fill };
})();
GZ_ASK_TILE;
