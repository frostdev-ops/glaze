// pdf.js's words in Glaze's (pdf-kind.js's viewer): the l10n object pdf.js's PDFViewer, annotation layer and editors take
// (getLanguage, getDirection, get, translate, translateOnce, pause, resume, destroy), reading Glaze's catalogue (lib/i18n.js)
// instead of pdf.js's Fluent files. pdf.js marks an element with data-l10n-id (and data-l10n-args); translate(root) fills
// every such element under root now and as they are added or change, until pause() or destroy(). Each id is in IDS (its
// text, or its attributes, as Glaze keys; a date in the page's language) or QUIET (nothing shown: helper text, a tooltip
// repeating its label, an alt-text prompt, or a part of pdf.js's own app the viewer doesn't draw). test/pdf-l10n.test.js
// holds both lists to every id pdf_viewer.mjs and pdf.mjs carry, so a pdf.js upgrade's new id is a decision, not a gap.
// Classic script; module.exports for node.
var GZ_PDF_L10N = globalThis.GZ_PDF_L10N || (() => {
  // A date as pdf.js's DATETIME(dateObj, dateStyle: short, timeStyle: medium) writes it, in the page's language.
  const date = (args, lang) => { const d = new Date(args?.dateObj); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'medium' }).format(d); };
  const IDS = {
    // The viewer: each page a landmark, its number its name.
    'pdfjs-page-landmark': { 'aria-label': 'Page {page}' },
    // The annotation layer: a note's date (its popup).
    'pdfjs-annotation-date-time-string': date,
    // The editors (A3's tools): their names, their delete button, their colours.
    'pdfjs-editor-highlight-editor': { 'aria-label': 'Highlight' },
    'pdfjs-editor-ink-editor': { 'aria-label': 'Pen' },
    'pdfjs-editor-stamp-editor': { 'aria-label': 'Image' },
    'pdfjs-free-text2': { 'aria-label': 'Text' },
    'pdfjs-highlight-floating-button1': { 'aria-label': 'Highlight' },
    'pdfjs-highlight-floating-button-label': 'Highlight',
    'pdfjs-editor-remove-freetext-button': { title: 'Delete' },
    'pdfjs-editor-remove-ink-button': { title: 'Delete' },
    'pdfjs-editor-remove-stamp-button': { title: 'Delete' },
    'pdfjs-editor-remove-highlight-button': { title: 'Delete' },
    'pdfjs-editor-remove-signature-button': { title: 'Delete' },
    'pdfjs-editor-colorpicker-button': { title: 'Color' },
    'pdfjs-editor-color-picker-ink-input': { title: 'Color' },
    'pdfjs-editor-color-picker-free-text-input': { title: 'Text colour' },
    'pdfjs-editor-colorpicker-yellow': { title: 'Yellow' },
    'pdfjs-editor-colorpicker-green': { title: 'Green' },
    'pdfjs-editor-colorpicker-blue': { title: 'Blue' },
    'pdfjs-editor-colorpicker-pink': { title: 'Pink' },
    'pdfjs-editor-colorpicker-red': { title: 'Red' },
  };
  const QUIET = new Set(`
    previous-button previous-button-label next-button next-button-label page-input of-pages page-of-pages
    zoom-out-button zoom-out-button-label zoom-in-button zoom-in-button-label zoom-select presentation-mode-button
    presentation-mode-button-label open-file-button open-file-button-label print-button print-button-label
    save-button save-button-label download-button download-button-label bookmark-button bookmark-button-label
    tools-button tools-button-label first-page-button first-page-button-label last-page-button
    last-page-button-label page-rotate-cw-button page-rotate-cw-button-label page-rotate-ccw-button
    page-rotate-ccw-button-label cursor-text-select-tool-button cursor-text-select-tool-button-label
    cursor-hand-tool-button cursor-hand-tool-button-label scroll-page-button scroll-page-button-label
    scroll-vertical-button scroll-vertical-button-label scroll-horizontal-button scroll-horizontal-button-label
    scroll-wrapped-button scroll-wrapped-button-label spread-none-button spread-none-button-label spread-odd-button
    spread-odd-button-label spread-even-button spread-even-button-label document-properties-button
    document-properties-button-label document-properties-file-name document-properties-file-size
    document-properties-size-kb document-properties-size-mb document-properties-title document-properties-author
    document-properties-subject document-properties-keywords document-properties-creation-date
    document-properties-modification-date document-properties-date-time-string document-properties-creator
    document-properties-producer document-properties-version document-properties-page-count
    document-properties-page-size document-properties-page-size-unit-inches
    document-properties-page-size-unit-millimeters document-properties-page-size-orientation-portrait
    document-properties-page-size-orientation-landscape document-properties-page-size-name-a-three
    document-properties-page-size-name-a-four document-properties-page-size-name-letter
    document-properties-page-size-name-legal document-properties-page-size-dimension-string
    document-properties-page-size-dimension-name-string document-properties-linearized
    document-properties-linearized-yes document-properties-linearized-no document-properties-close-button
    print-progress-message print-progress-percent print-progress-close-button printing-not-supported
    printing-not-ready current-outline-item-button current-outline-item-button-label findbar-button
    findbar-button-label additional-layers thumb-page-title1 thumb-page-canvas thumb-page-checkbox1 find-input
    find-previous-button find-previous-button-label find-next-button find-next-button-label find-highlight-checkbox
    find-match-case-checkbox-label find-match-diacritics-checkbox-label find-entire-word-checkbox-label
    find-reached-top find-reached-bottom find-match-count find-match-count-limit find-not-found page-scale-width
    page-scale-fit page-scale-auto page-scale-actual page-scale-percent loading-error invalid-file-error
    missing-file-error unexpected-response-error rendering-error text-annotation-type password-label
    password-invalid password-ok-button password-cancel-button web-fonts-disabled editor-free-text-button
    editor-free-text-button-label editor-ink-button editor-ink-button-label editor-stamp-button
    editor-stamp-button-label editor-highlight-button editor-highlight-button-label comment-floating-button
    comment-floating-button-label editor-comment-button editor-comment-button-label editor-signature-button
    editor-signature-button-label editor-signature-editor1 editor-free-text-color-input editor-free-text-size-input
    editor-ink-color-input editor-ink-thickness-input editor-ink-opacity-input editor-stamp-add-image-button
    editor-stamp-add-image-button-label editor-free-highlight-thickness-input editor-free-highlight-thickness-title
    editor-add-signature-container editor-signature-add-signature-button editor-signature-add-signature-button-label
    editor-add-saved-signature-button editor-comments-sidebar-title editor-comments-sidebar-close-button
    editor-comments-sidebar-close-button-label editor-comments-sidebar-no-comments1
    editor-comments-sidebar-no-comments-link editor-alt-text-button editor-alt-text-button-label
    editor-alt-text-edit-button editor-alt-text-dialog-label editor-alt-text-dialog-description
    editor-alt-text-add-description-label editor-alt-text-add-description-description
    editor-alt-text-mark-decorative-label editor-alt-text-mark-decorative-description editor-alt-text-cancel-button
    editor-alt-text-save-button editor-alt-text-decorative-tooltip editor-alt-text-textarea editor-resizer-top-left
    editor-resizer-top-middle editor-resizer-top-right editor-resizer-middle-right editor-resizer-bottom-right
    editor-resizer-bottom-middle editor-resizer-bottom-left editor-resizer-middle-left
    editor-highlight-colorpicker-label editor-colorpicker-dropdown editor-highlight-show-all-button-label
    editor-highlight-show-all-button editor-new-alt-text-dialog-edit-label editor-new-alt-text-dialog-add-label
    editor-new-alt-text-textarea editor-new-alt-text-description editor-new-alt-text-disclaimer1
    editor-new-alt-text-disclaimer-learn-more-url editor-new-alt-text-create-automatically-button-label
    editor-new-alt-text-not-now-button editor-new-alt-text-error-title editor-new-alt-text-error-description
    editor-new-alt-text-error-close-button editor-new-alt-text-ai-model-downloading-progress
    editor-new-alt-text-added-button editor-new-alt-text-added-button-label editor-new-alt-text-missing-button
    editor-new-alt-text-missing-button-label editor-new-alt-text-to-review-button
    editor-new-alt-text-to-review-button-label editor-new-alt-text-generated-alt-text-with-disclaimer
    image-alt-text-settings-button image-alt-text-settings-button-label editor-alt-text-settings-dialog-label
    editor-alt-text-settings-automatic-title editor-alt-text-settings-create-model-button-label
    editor-alt-text-settings-create-model-description editor-alt-text-settings-editor-title
    editor-alt-text-settings-show-dialog-button-label editor-alt-text-settings-show-dialog-description
    editor-alt-text-settings-close-button editor-highlight-added-alert editor-freetext-added-alert
    editor-ink-added-alert editor-stamp-added-alert editor-signature-added-alert editor-undo-bar-message-highlight
    editor-undo-bar-message-freetext editor-undo-bar-message-ink editor-undo-bar-message-stamp
    editor-undo-bar-message-signature editor-undo-bar-message-comment editor-undo-bar-message-multiple
    editor-undo-bar-undo-button editor-undo-bar-undo-button-label editor-undo-bar-close-button
    editor-undo-bar-close-button-label editor-add-signature-dialog-label editor-add-signature-dialog-title
    editor-add-signature-type-button editor-add-signature-draw-button editor-add-signature-image-button
    editor-add-signature-type-input editor-add-signature-draw-placeholder
    editor-add-signature-draw-thickness-range-label editor-add-signature-draw-thickness-range
    editor-add-signature-image-placeholder editor-add-signature-image-browse-link
    editor-add-signature-description-label editor-add-signature-description-input
    editor-add-signature-description-default-when-drawing editor-add-signature-clear-button-label
    editor-add-signature-clear-button editor-add-signature-save-checkbox editor-add-signature-save-warning-message
    editor-add-signature-image-upload-error-title editor-add-signature-image-upload-error-description
    editor-add-signature-image-no-data-error-title editor-add-signature-image-no-data-error-description
    editor-add-signature-error-close-button editor-add-signature-cancel-button editor-add-signature-add-button
    editor-delete-signature-button1 editor-delete-signature-button-label1 editor-add-signature-edit-button-label
    editor-edit-signature-dialog-title editor-edit-signature-update-button show-comment-button
    editor-edit-comment-popup-button-label editor-edit-comment-popup-button editor-delete-comment-popup-button-label
    editor-delete-comment-popup-button editor-edit-comment-dialog-title-when-editing
    editor-edit-comment-dialog-save-button-when-editing editor-edit-comment-dialog-title-when-adding
    editor-edit-comment-dialog-save-button-when-adding editor-edit-comment-dialog-text-input
    editor-edit-comment-dialog-cancel-button editor-add-comment-button toggle-views-manager-button1
    toggle-views-manager-notification-button toggle-views-manager-button1-label views-manager-sidebar
    views-manager-sidebar-resizer views-manager-view-selector-button views-manager-view-selector-button-label
    views-manager-pages-title views-manager-outlines-title1 views-manager-attachments-title
    views-manager-layers-title1 views-manager-pages-option-label views-manager-outlines-option-label
    views-manager-attachments-option-label views-manager-layers-option-label views-manager-add-file-button
    views-manager-add-file-button-label views-manager-pages-status-action-label
    views-manager-pages-status-none-action-label views-manager-pages-status-action-button-label
    views-manager-pages-status-copy-button-label views-manager-pages-status-cut-button-label
    views-manager-pages-status-delete-button-label views-manager-pages-status-export-selected-button-label
    views-manager-status-undo-cut-label views-manager-pages-status-undo-copy-label
    views-manager-pages-status-undo-delete-label views-manager-status-undo-button-label
    views-manager-status-done-button-label views-manager-status-close-button views-manager-status-close-button-label
    views-manager-paste-button-label views-manager-paste-button-before views-manager-paste-button-after
    new-badge-content views-manager-waiting-for-file digital-signature-properties-button
    digital-signature-properties-button-label digital-signature-properties-banner-verified
    digital-signature-properties-banner-unknown digital-signature-properties-banner-untrusted
    digital-signature-properties-banner-expired digital-signature-properties-banner-invalid
    digital-signature-properties-banner-revoked digital-signature-properties-status-verified
    digital-signature-properties-status-invalid digital-signature-properties-status-unknown
    digital-signature-properties-certificate-trusted digital-signature-properties-certificate-unknown
    digital-signature-properties-certificate-untrusted
    digital-signature-properties-certificate-untrusted-unknown-issuer
    digital-signature-properties-certificate-untrusted-self-signed
    digital-signature-properties-certificate-untrusted-untrusted-issuer
    digital-signature-properties-certificate-expired digital-signature-properties-certificate-expired-with-date
    digital-signature-properties-certificate-revoked digital-signature-properties-view-certificate
    digital-signature-properties-reason digital-signature-properties-timestamp
    digital-signature-properties-sub-signatures
  `.trim().split(/\s+/).map((id) => `pdfjs-${id}`));
  const RTL = new Set(['ar', 'he', 'fa', 'ps', 'ur']);

  // t: the page's GZ_I18N.t in its language. → (id, args) → { value, attributes }: the text to set (or null) and the
  // attributes to set (or null). A count reaches a Glaze plural as n.
  const message = (t, lang) => (id, args = {}) => {
    const m = Object.hasOwn(IDS, id) ? IDS[id] : null, vars = { n: args?.count ?? args?.total, ...args };
    if (typeof m === 'function') return { value: m(args, lang), attributes: null };
    if (typeof m === 'string') return { value: t(m, vars), attributes: null };
    if (m) return { value: null, attributes: Object.fromEntries(Object.entries(m).map(([a, k]) => [a, t(k, vars)])) };
    return { value: null, attributes: null };
  };

  const make = ({ t, lang = 'en' }) => {
    const msg = message(t, lang), roots = new Set();
    const apply = (el) => {
      const id = el.getAttribute('data-l10n-id');
      if (!id) return;
      let args = {};
      try { args = JSON.parse(el.getAttribute('data-l10n-args') || '{}') || {}; } catch { /* pdf.js writes JSON; anything else has no args */ }
      const { value, attributes } = msg(id, args);
      if (value != null && el.textContent !== value) el.textContent = value;
      if (attributes) for (const [a, v] of Object.entries(attributes)) if (el.getAttribute(a) !== v) el.setAttribute(a, v);
    };
    const sweep = (root) => {
      if (root?.nodeType !== 1) return;
      apply(root);
      for (const el of root.querySelectorAll('[data-l10n-id]')) apply(el);
    };
    const take = (records) => { for (const r of records) { if (r.type === 'attributes') apply(r.target); else for (const n of r.addedNodes) sweep(n); } };
    let seen = null; // made on the first translate: only a page has the DOM
    const watch = (root) => (seen ||= new MutationObserver(take)).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-l10n-id', 'data-l10n-args'] });
    let paused = false;
    return {
      getLanguage: () => lang,
      getDirection: () => (RTL.has(String(lang).split('-')[0]) ? 'rtl' : 'ltr'),
      get: async (ids, args = null) => (Array.isArray(ids) ? ids.map((id) => msg(id).value ?? '') : msg(ids, args || {}).value ?? ''),
      translate: async (root) => { sweep(root); if (!roots.has(root)) { roots.add(root); if (!paused) watch(root); } },
      translateOnce: async (el) => sweep(el),
      // As pdf.js's own: what changed before a pause is filled; what is added during one (a text layer) is not looked at.
      pause: () => { if (paused) return; if (seen) { take(seen.takeRecords()); seen.disconnect(); } paused = true; },
      resume: () => { if (!paused) return; paused = false; for (const r of roots) watch(r); },
      destroy: async () => { seen?.disconnect(); roots.clear(); paused = true; },
    };
  };

  return { IDS, QUIET, message, make };
})();

if (typeof module !== 'undefined') module.exports = GZ_PDF_L10N; else GZ_PDF_L10N;
