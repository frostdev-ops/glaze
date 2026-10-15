// Reading a file for the import dialogs (W14 class schedule, W15 syllabus, W16 transcript), loaded on demand by them,
// on the device: text, web pages, Word and PowerPoint here (lib/doctext.js); PDFs and pictures (PNG, JPEG, WebP, HEIC
// where the browser opens it) in Glaze's reader, an extension page in a hidden frame (reader.html), since pdf.js and
// the OCR engine need workers and WebAssembly that the LMS page's CSP won't give a content script. The file goes to
// the frame over a MessageChannel of its own and the text comes back on it; the frame is removed when the read ends,
// fails, goes quiet for a minute or is called off (signal), which stops its work and frees its memory.
var GZ_IMPORT = globalThis.GZ_IMPORT || (() => {
  const X = globalThis.GZ_CTX;
  const t = (k, v) => X.t(k, v);
  const D = () => globalThis.GZ_DOCTEXT;
  const MAX = 32 << 20; // a text, web page, Word or PowerPoint file
  // The OCR models for the page's language, beside English (lib/tesseract/).
  const MODEL = { de: 'deu', es: 'spa', fr: 'fra', nl: 'nld', pt: 'por' };
  // An error whose words are for the student.
  const oops = (msg) => Object.assign(new Error(msg), { mine: true });
  const why = (code) => {
    const R = D().READ;
    return {
      size: t('That file is too large.'),
      pages: t('That PDF has more than {n} pages. Save the pages you need as a new PDF and choose that.', { n: R.pages }),
      scans: t('That PDF has more than {n} scanned pages. Save the pages you need as a new PDF and choose that.', { n: R.scans }),
      pixels: t('That picture is too large. Crop it or take a screenshot of the part you need.'),
      locked: t("That PDF is protected by a password. Open it, then save or print it as a PDF without one, or copy its text and paste it here."),
      format: t("This browser can't open that picture. Save it as PNG or JPEG and choose that."),
      empty: t('Glaze found no text in that file.'),
    }[code] || t("Glaze couldn't read that file.");
  };

  // The reader in a hidden frame for one file. → { text, pages, ocr: { pages, conf, unsure } | null }
  const frame = (file, kind, signal, progress) => new Promise((resolve, reject) => {
    const src = chrome.runtime.getURL('reader.html');
    const f = Object.assign(document.createElement('iframe'), { tabIndex: -1, title: 'Glaze' });
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;inset:auto auto 0 0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    const ch = new MessageChannel();
    let quiet = 0;
    const end = (done, v) => { clearTimeout(quiet); signal?.removeEventListener('abort', stop); ch.port1.close(); f.remove(); done(v); };
    const stop = () => end(reject, Object.assign(new Error('cancelled'), { cancelled: true }));
    const wait = () => { clearTimeout(quiet); quiet = setTimeout(() => end(reject, oops(why('quiet'))), 60000); };
    ch.port1.onmessage = ({ data: m }) => {
      if (m?.type === 'progress') { wait(); progress(m); } else if (m?.type === 'done') end(resolve, m); else if (m?.type === 'error') end(reject, oops(why(m.code)));
    };
    signal?.addEventListener('abort', stop, { once: true });
    const lang = MODEL[GZ_I18N.locale(X.locale()).slice(0, 2)];
    // Only to Glaze's own origin (spelled out: URL.origin of an extension scheme is "null" in some engines), so a
    // frame the page navigated elsewhere gets nothing.
    const origin = src.slice(0, src.indexOf('/', src.indexOf('://') + 3));
    f.addEventListener('load', () => f.contentWindow.postMessage({ type: 'glaze:read', file, kind, langs: lang ? [lang] : [] }, origin, [ch.port2]), { once: true });
    f.src = src;
    wait();
    document.documentElement.append(f);
  });

  // A file's text, read on this device. opts.signal calls it off; opts.progress(words) hears how far a PDF or picture
  // has got. → { text, pages, ocr } (ocr: null unless some of it was read from a picture). Throws an error for the
  // student (mine), or one that says it was called off (cancelled).
  const read = async (file, { signal, progress = () => {} } = {}) => {
    await X.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT);
    const kind = D().kind(file.name, file.type, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    let last = '';
    if (kind === 'pdf' || kind === 'image') return frame(file, kind, signal, (m) => { const s = say(m); if (s !== last) progress(last = s); });
    if (!kind) throw oops(t('Glaze reads PDFs, pictures (PNG, JPEG, WebP), Word (.docx), PowerPoint (.pptx), web pages (.html) and text files.'));
    if (file.size > MAX) throw oops(why('size'));
    try {
      if (kind === 'text') return { text: await file.text(), ocr: null };
      if (kind === 'html') return { text: D().html(await file.text()), ocr: null };
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (kind === 'docx') return { text: await D().docx(bytes), ocr: null };
      return { text: (await D().pptx(bytes)).map((s) => [s.text, s.notes].filter(Boolean).join('\n')).join('\n\n'), ocr: null };
    } catch { throw oops(why()); }
  };
  // How far a read has got, in words, in steps of 10% so a screen reader isn't told every percent.
  const say = (m) => {
    const pct = Math.round((m.p || 0) * 10) * 10;
    return m.stage === 'text' ? t('Reading page {n} of {total}…', { n: m.page, total: m.pages })
      : m.pages > 1 ? t('Reading scanned page {n} of {total}: {pct}%', { n: m.page, total: m.pages, pct })
        : t('Reading the text in the picture: {pct}%', { pct });
  };
  // What to tell the student about text read from a picture, or '' when none was.
  const note = (ocr) => (!ocr ? '' : ocr.conf < 80 || ocr.unsure.length
    ? t("Glaze read this from a picture and wasn't sure of some of it. Check every field against your file before you save.")
    : t('Glaze read this from a picture. Check it against your file before you save.'));
  // Whether a line came from text the OCR engine wasn't sure of (ocr.unsure), for "Check this" on what it gave.
  const doubt = (ocr, line) => !!line && !!ocr?.unsure.some((u) => u.includes(line) || line.includes(u));
  return { read, note, doubt };
})();

GZ_IMPORT;
