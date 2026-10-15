// Glaze's reader (W23): reads a PDF or a picture on the device for the import dialogs (features/import.js). An extension
// page that a dialog opens in a hidden frame: pdf.js and the OCR engine need workers and WebAssembly, which a content
// script can't host under the LMS page's CSP, and the service worker can start neither. It takes a file over the
// MessageChannel it is handed with it and answers on that channel only: progress, then the text or why not. It keeps
// nothing, calls no extension API and loads nothing but its own files (reader.html's policy). The dialog removes the
// frame once the read ends or is called off, which stops whatever is still running and frees its memory.
(() => {
  const D = globalThis.GZ_DOCTEXT, R = D.READ;
  const url = (p) => new URL(p, location.href).href;
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const LANGS = new Set(['eng', 'deu', 'spa', 'fra', 'nld', 'por']);

  // The OCR engine in its own worker (lib/ocr.js), started on the first picture and kept for a file's other pages.
  const engine = (langs, say) => {
    const w = new Worker(url('lib/ocr.js'));
    let turn = null;
    w.onmessage = ({ data: m }) => (m.type === 'progress' ? say(m.p) : turn?.(m));
    w.onerror = (e) => { e.preventDefault(); turn?.({ type: 'error' }); };
    const ask = (m, transfer) => new Promise((resolve, reject) => {
      turn = (r) => { turn = null; if (r.type === 'error') reject(Object.assign(new Error('ocr'), { code: 'ocr' })); else resolve(r); };
      w.postMessage(m, transfer);
    });
    const ready = ask({ type: 'start', langs });
    return {
      read: async (image) => { await ready; return JSON.parse((await ask({ type: 'read', image }, [image.buffer])).json); },
      stop: () => w.terminate(),
    };
  };
  // Pixels drawn on white, at most R.side on the longest side, as the engine wants them (lib/doctext.js pgm).
  const pixels = (src, w, h) => {
    const k = Math.min(1, R.side / Math.max(w, h));
    const c = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return D.pgm(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  };

  const image = async (file, langs, say) => {
    if (file.size > R.image) fail('size');
    const size = D.imageSize(new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer()));
    if (size && size.w * size.h > R.pixels) fail('pixels');
    let bmp;
    try { bmp = await createImageBitmap(file); } catch { fail('format'); }
    if (bmp.width * bmp.height > R.pixels) { bmp.close(); fail('pixels'); } // a header that didn't say
    const gray = pixels(bmp, bmp.width, bmp.height);
    bmp.close();
    const ocr = engine(langs, (p) => say({ stage: 'ocr', p }));
    try {
      const r = D.ocrText(await ocr.read(gray));
      return { text: r.text, pages: 1, ocr: { pages: 1, conf: r.conf, unsure: r.unsure } };
    } finally { ocr.stop(); }
  };

  const pdf = async (file, langs, say) => {
    if (file.size > R.pdf) fail('size');
    const pdfjs = await import(url('lib/pdfjs/pdf.min.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = url('lib/pdfjs/pdf.worker.min.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), wasmUrl: url('lib/pdfjs/'), enableXfa: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    let doc;
    try { doc = await task.promise; } catch (e) { fail(e?.name === 'PasswordException' ? 'locked' : 'broken'); }
    let ocr = null;
    try {
      if (doc.numPages > R.pages) fail('pages');
      // The text layer of every page first; a page with next to none is a scan, read by OCR afterwards.
      const texts = [], scans = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        texts.push(D.pdfText([{ items: (await page.getTextContent()).items, vt: page.getViewport({ scale: 1 }).transform }]));
        if (texts[i - 1].replace(/\s/g, '').length < 10) scans.push(i);
        page.cleanup();
        say({ stage: 'text', page: i, pages: doc.numPages });
      }
      if (scans.length > R.scans) fail('scans');
      let sum = 0;
      const unsure = [];
      for (const [n, i] of scans.entries()) {
        const page = await doc.getPage(i);
        // About 300 dpi, the resolution the engine is trained for, or less for a page that would be too many pixels.
        const at = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(300 / 72, Math.sqrt(16e6 / (at.width * at.height))) });
        const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
        await page.render({ canvas, viewport: vp, background: '#fff' }).promise;
        page.cleanup();
        ocr ||= engine(langs, (p) => say({ stage: 'ocr', page: n + 1, pages: scans.length, p }));
        const r = D.ocrText(await ocr.read(pixels(canvas, canvas.width, canvas.height)));
        canvas.width = canvas.height = 0;
        texts[i - 1] = r.text;
        sum += r.conf;
        unsure.push(...r.unsure);
      }
      const text = texts.filter((x) => x.trim()).join('\n\n');
      if (!text.trim()) fail('empty');
      return { text, pages: doc.numPages, ocr: scans.length ? { pages: scans.length, conf: Math.round(sum / scans.length), unsure } : null };
    } finally {
      ocr?.stop();
      await task.destroy().catch(() => {});
    }
  };

  // One file per message, from whoever opened this frame with a channel of their own; the answer goes back on it.
  addEventListener('message', (e) => {
    const port = e.ports?.[0], m = e.data;
    if (!port || m?.type !== 'glaze:read' || !(m.file instanceof Blob) || !['pdf', 'image'].includes(m.kind)) return;
    const langs = ['eng', ...(Array.isArray(m.langs) ? m.langs : []).filter((l) => LANGS.has(l) && l !== 'eng')].slice(0, 2);
    const say = (x) => port.postMessage({ type: 'progress', ...x });
    (m.kind === 'pdf' ? pdf : image)(m.file, langs, say)
      .then((r) => port.postMessage({ type: 'done', ...r }), (err) => port.postMessage({ type: 'error', code: err?.code || 'broken' }))
      .finally(() => port.close());
  });
})();
