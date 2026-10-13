// Backing up what you type in Ultra's editors: the parts that don't touch the page, so node can test them.
// Classic script for the content script; module.exports for node.
const GZ_DRAFTS = (() => {
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
  return { squash, worth, posted, stale };
})();

if (typeof module !== 'undefined') module.exports = GZ_DRAFTS;
