// Backing up Ultra editors and Canvas new Inbox messages: the parts that don't touch the page, so node can test them.
// Classic script for the content script; module.exports for node.
// Loaded on demand (content.js need()): a second injection into the same frame keeps the first.
var GZ_DRAFTS = globalThis.GZ_DRAFTS || (() => {
  const KEEP = 14 * 864e5;
  // Shorter than this isn't worth keeping, and could turn up elsewhere on the page by chance.
  const MIN = 20;
  // An editor and the post it becomes lay out whitespace differently (paragraphs, nbsp, zero-width
  // spaces), so text is compared without any.
  const squash = (t) => (t || '').replace(/[\s\p{Cf}]+/gu, '');
  const worth = (t) => squash(t).length >= MIN;
  // Posted: the start of what was written shows on the page outside the editor.
  const posted = (text, page) => worth(text) && squash(page).includes(squash(text).slice(0, 500));
  // The storage.local keys to delete: copies 14 days old or malformed, or all of them with the feature off.
  const stale = (all, now, on = true) => Object.keys(all || {}).filter((k) => k.startsWith('draft:') && (!on || !(now - all[k]?.at < KEEP)));
  const canvasRecipient = (id) => {
    const raw = id?.match(/^address-book-label-(.+)-user$/)?.[1];
    if (/^\d+$/.test(raw)) return raw;
    try { return btoa(atob(raw)) === raw ? atob(raw).match(/^MessageableUser-(\d+)$/)?.[1] || null : null; } catch { return null; }
  };
  // New Canvas messages have no thread yet: require the full destination and subject before keeping one.
  const canvasKey = (m) => {
    if (!m || !/^https?:\/\/[^/]+$/.test(m.origin) || !/^\d+$/.test(m.user) || !/^\d+$/.test(m.course)
      || typeof m.subject !== 'string' || !m.subject.trim() || m.subject.length > 255 || !Array.isArray(m.to) || !m.to.length || m.to.some((id) => !/^\d+$/.test(id))) return null;
    return `draft:canvas:${JSON.stringify([m.origin, m.user, m.course, [...new Set(m.to)].sort(), m.subject])}`;
  };
  const sent = (d, c) => {
    const m = d?.canvas;
    return !!canvasKey(m) && c?.subject === m.subject && c.context_code === `course_${m.course}`
      && JSON.stringify((c.participants || []).map((p) => String(p.id)).filter((id) => id !== m.user).sort()) === JSON.stringify([...new Set(m.to)].sort())
      && (c.messages || []).some((msg) => String(msg.author_id) === m.user && msg.body === d.text && Date.parse(msg.created_at) >= d.at - 1000);
  };
  return { squash, worth, posted, stale, canvasKey, canvasRecipient, sent };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_DRAFTS; else GZ_DRAFTS;
