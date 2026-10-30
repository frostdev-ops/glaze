// Glaze's PDF documents on pdf.js: open a file and say what it allows; save what its editor changed, as an incremental
// update (annotations and fields stay editable, nothing is flattened); bake page changes (reorder, delete, duplicate,
// rotate, blank pages, another PDF's pages) into new bytes in one pass; read a page's picture and text.
// The caller passes pdf.js's module (lib/pdfjs/pdf.mjs, its worker set) to use(); this file imports nothing, so node runs it.
// Each result carries the SHA-256 of the bytes it replaces (base) beside its own (hash), so a record can step back once.
// Refusals are Errors named Pdf…Error. Every limit can be lowered per call with { limits }.
// Classic script; module.exports for node.
var GZ_PDF_DOC = globalThis.GZ_PDF_DOC || (() => {
  // bytes: a file opened, saved or merged in; merged: a baked file; text: characters of a page's text; thumbnail: PNG bytes.
  const LIMITS = Object.freeze({ bytes: 50e6, pages: 500, merged: 50e6, text: 20000, thumbnail: 24 << 10 });
  const limitsOf = (given) => Object.fromEntries(Object.entries(LIMITS).map(([k, v]) => [k, Math.min(v, given?.[k] ?? v)]));
  const fail = (name, message, extra) => Object.assign(new Error(message), { name }, extra);
  const mb = (n) => `${Math.round(n / 1e6)} MB`;
  const asBytes = (data) => {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new TypeError('a PDF is a Uint8Array or an ArrayBuffer');
  };
  const hash = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

  // The pages after ops, each { source, page, turn }: source 0 is the document, k the file of its k-th merge, 'blank' a new
  // empty page ({ size: [w, h] } when the op names one). turn is the clockwise turn added to the page's own, 0 to 270.
  // An op's positions count the pages as the ops before it left them:
  //   { op: 'reorder', order }  order[i] is the page that comes ith      { op: 'delete', pages }
  //   { op: 'duplicate', pages }  each copy right after its page          { op: 'rotate', pages, by }  by: ±90, 180, …
  //   { op: 'blank', at, size }  at: 0 to the page count (default: the end)  { op: 'merge', bytes, at }
  // mergedCounts[k] is the page count of the k-th merge's file.
  const layout = (count, ops, mergedCounts = []) => {
    let pages = Array.from({ length: count }, (_, page) => ({ source: 0, page, turn: 0 }));
    let merges = 0;
    const which = (list, op) => {
      if (!Array.isArray(list) || !list.every((i) => Number.isInteger(i) && i >= 0 && i < pages.length)) throw new RangeError(`${op}: no such page`);
      return new Set(list);
    };
    const place = (at, op) => {
      if (at === undefined) return pages.length;
      if (!Number.isInteger(at) || at < 0 || at > pages.length) throw new RangeError(`${op}: no such place`);
      return at;
    };
    for (const o of ops) {
      switch (o?.op) {
        case 'reorder': {
          const order = o.order;
          if (which(order, 'reorder').size !== pages.length || order.length !== pages.length) throw new RangeError('reorder: every page once');
          pages = order.map((i) => pages[i]);
          break;
        }
        case 'delete': { const gone = which(o.pages, 'delete'); pages = pages.filter((_, i) => !gone.has(i)); break; }
        case 'duplicate': { const twice = which(o.pages, 'duplicate'); pages = pages.flatMap((p, i) => (twice.has(i) ? [p, { ...p }] : [p])); break; }
        case 'rotate': {
          if (!Number.isInteger(o.by) || o.by % 90) throw new RangeError('rotate: by a multiple of 90');
          const turned = which(o.pages, 'rotate');
          pages = pages.map((p, i) => (turned.has(i) ? { ...p, turn: (((p.turn + o.by) % 360) + 360) % 360 } : p));
          break;
        }
        case 'blank': {
          const ok = o.size === undefined || (Array.isArray(o.size) && o.size.length === 2 && o.size.every((n) => Number.isFinite(n) && n >= 3 && n <= 14400));
          if (!ok) throw new RangeError('blank: size is [width, height] in points');
          pages.splice(place(o.at, 'blank'), 0, { source: 'blank', page: 0, turn: 0, ...(o.size && { size: o.size }) });
          break;
        }
        case 'merge': {
          const n = mergedCounts[merges++];
          if (!Number.isInteger(n) || n < 1) throw new RangeError('merge: the file has no pages');
          pages.splice(place(o.at, 'merge'), 0, ...Array.from({ length: n }, (_, page) => ({ source: merges, page, turn: 0 })));
          break;
        }
        default: throw new TypeError(`no page operation ${o?.op}`);
      }
    }
    if (!pages.length) throw new RangeError('a PDF keeps at least one page');
    return pages;
  };

  // A PDF of empty pages, one per [width, height] in points.
  const blankPdf = (sizes) => {
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${sizes.map((_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${sizes.length} >>`,
      ...sizes.map(([w, h]) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${+w.toFixed(2)} ${+h.toFixed(2)}] /Resources << >> >>`)];
    let out = '%PDF-1.7\n';
    const offsets = objects.map((body, i) => { const at = out.length; out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
    return new TextEncoder().encode(`${out}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  };

  // options go to every getDocument call (wasmUrl, standardFontDataUrl and the like).
  const use = (pdfjs, options = {}) => {
    const { PermissionFlag: P, PasswordResponses, AnnotationMode } = pdfjs;
    const bases = new WeakMap(); // an open document → the SHA-256 of the bytes it was opened from or last saved as

    // pdf.js hands what it is given to its worker; it gets a copy, so the caller's bytes stay usable.
    const load = async (bytes, password) => {
      const task = pdfjs.getDocument({ verbosity: 0, ...options, data: bytes.slice(), password, enableXfa: false });
      try {
        return await task.promise;
      } catch (e) {
        await task.destroy();
        if (e?.name !== 'PasswordException') throw fail('PdfInvalidError', 'This file is not a PDF Glaze can read.', { cause: e });
        const wrong = e.code === PasswordResponses.INCORRECT_PASSWORD;
        throw fail('PdfPasswordError', wrong ? 'That password does not open this PDF.' : 'This PDF needs its password.', { reason: wrong ? 'incorrect' : 'needed' });
      }
    };

    const inspect = async (doc, L) => {
      if (doc.numPages > L.pages) throw fail('PdfTooManyPagesError', `Choose a PDF with at most ${L.pages} pages.`);
      const [{ info }, permissions, signatures] = await Promise.all([doc.getMetadata(), doc.getPermissions(), doc.getSignatures()]);
      // Pure XFA: the form lives only in its XFA packets (no AcroForm fields), and the pages hold a placeholder.
      if (info.IsXFAPresent && !info.IsAcroFormPresent) throw fail('PdfXfaError', 'This PDF is an XFA form, which only Adobe Acrobat opens.');
      const list = permissions ? [...permissions].sort((a, b) => a - b) : null;
      const signed = !!signatures?.length, encrypted = !!info.EncryptFilterName;
      // Pages change when the owner allows assembling or changing the document (ISO 32000-1, table 22) and no signature
      // would break. pdf.js writes pages from more than one file unencrypted, so an encrypted file takes in no others.
      const pages = !signed && (!list || list.includes(P.ASSEMBLE) || list.includes(P.MODIFY_CONTENTS));
      return { pages: doc.numPages, permissions: list, hasForms: !!info.IsAcroFormPresent, signed, encrypted, allows: { pages, add: pages && !encrypted } };
    };

    // → { doc, pages, permissions (pdf.js's PermissionFlag values, or null when unrestricted), hasForms, signed, encrypted,
    // allows: { pages, add }, hash }. The caller destroys doc (doc.loadingTask.destroy()).
    const open = async (data, { password, limits } = {}) => {
      const bytes = asBytes(data), L = limitsOf(limits);
      if (bytes.length > L.bytes) throw fail('PdfTooLargeError', `Choose a PDF smaller than ${mb(L.bytes)}.`);
      const doc = await load(bytes, password);
      try {
        const facts = await inspect(doc, L);
        const digest = await hash(bytes);
        bases.set(doc, digest);
        return { doc, ...facts, hash: digest };
      } catch (e) {
        await doc.loadingTask.destroy();
        throw e;
      }
    };

    // → { bytes, hash, base, changed }: the file with the editor's changes appended. Refused past the size limit, so a
    // saved file always opens again.
    const save = async (doc, { limits } = {}) => {
      const L = limitsOf(limits);
      const bytes = doc.annotationStorage.size ? await doc.saveDocument() : await doc.getData();
      if (bytes.length > L.bytes) throw fail('PdfTooLargeError', `Saved, this PDF would be larger than ${mb(L.bytes)}.`);
      const base = bases.get(doc) ?? null, digest = await hash(bytes);
      bases.set(doc, digest);
      return { bytes, hash: digest, base, changed: digest !== base };
    };

    // → { bytes, hash, base, pages }: the file with ops applied, read back to check every page is there, turned as asked.
    // Form values come from the bytes: save edits first.
    const bake = async (data, ops, { password, limits } = {}) => {
      const bytes = asBytes(data), L = limitsOf(limits);
      if (!Array.isArray(ops)) throw new TypeError('ops is a list');
      if (bytes.length > L.bytes) throw fail('PdfTooLargeError', `Choose a PDF smaller than ${mb(L.bytes)}.`);
      const base = await hash(bytes);
      const docs = [];
      try {
        const doc = await load(bytes, password);
        docs.push(doc);
        const facts = await inspect(doc, L);
        if (!ops.length) return { bytes, hash: base, base, pages: facts.pages };
        if (facts.signed) throw fail('PdfSignedError', 'This PDF is digitally signed: changing its pages would break the signature.');
        if (!facts.allows.pages) throw fail('PdfLockedError', 'The owner of this PDF does not allow changing its pages.');
        const merging = ops.filter((o) => o?.op === 'merge');
        const protectedPdf = () => fail('PdfProtectedError', 'Pages cannot be added to a password-protected PDF, or taken from one.');
        if (facts.encrypted && (merging.length || ops.some((o) => o?.op === 'blank'))) throw protectedPdf();
        const others = [];
        for (const o of merging) {
          const other = asBytes(o.bytes);
          if (other.length > L.bytes) throw fail('PdfTooLargeError', `Choose a PDF smaller than ${mb(L.bytes)}.`);
          const otherDoc = await load(other).catch((e) => { throw e.name === 'PdfPasswordError' ? protectedPdf() : e; });
          docs.push(otherDoc);
          const f = await inspect(otherDoc, L);
          if (f.encrypted) throw protectedPdf();
          if (f.signed) throw fail('PdfSignedError', 'Pages of a digitally signed PDF would carry a broken signature.');
          others.push({ bytes: other, doc: otherDoc });
        }
        const pages = layout(doc.numPages, ops, others.map((o) => o.doc.numPages));
        if (pages.length > L.pages) throw fail('PdfTooManyPagesError', `A PDF can have at most ${L.pages} pages.`);

        const known = new Map();
        const facing = (p) => known.get(`${p.source}:${p.page}`) ?? (async () => {
          const page = await (p.source === 0 ? doc : others[p.source - 1].doc).getPage(p.page + 1);
          const f = { rotate: page.rotate, view: page.view };
          known.set(`${p.source}:${p.page}`, f);
          return f;
        })();
        // A blank page takes the size the page before it shows (the page after, when it comes first; Letter, when alone).
        const sizes = [];
        for (const [i, p] of pages.entries()) {
          if (p.source !== 'blank') continue;
          let size = p.size;
          const near = !size && (pages.slice(0, i).findLast((q) => q.source !== 'blank') ?? pages.slice(i + 1).find((q) => q.source !== 'blank'));
          if (near) {
            const { rotate, view: [x0, y0, x1, y1] } = await facing(near);
            size = (rotate + near.turn) % 180 ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
          }
          pages[i] = { ...p, page: sizes.length };
          sizes.push(size || [612, 792]);
        }
        // extractPages takes each source page once per entry, so a page used twice goes in a second entry of its source.
        const entries = [];
        pages.forEach((p, slot) => {
          let entry = entries.find((e) => e.source === p.source && !e.pages.has(p.page));
          if (!entry) entries.push(entry = { source: p.source, pages: new Map() });
          entry.pages.set(p.page, { slot, turn: p.turn });
        });
        const blank = sizes.length ? blankPdf(sizes) : null;
        const out = await doc.extractPages(entries.map(({ source, pages: kept }) => {
          const list = [...kept.keys()].sort((a, b) => a - b);
          return {
            document: source === 0 ? null : (source === 'blank' ? blank : others[source - 1].bytes).slice(),
            includePages: list, pageIndices: list.map((n) => kept.get(n).slot), rotations: Object.fromEntries(list.map((n) => [n, kept.get(n).turn])),
          };
        }));
        const unwritten = () => fail('PdfWriteError', 'Glaze could not write these pages.');
        if (!out) throw unwritten();
        if (out.length > L.merged) throw fail('PdfTooLargeError', `The PDF would be larger than ${mb(L.merged)}.`);
        const back = await load(out, password);
        docs.push(back);
        if (back.numPages !== pages.length) throw unwritten();
        for (const [i, p] of pages.entries()) {
          const own = p.source === 'blank' ? 0 : (await facing(p)).rotate;
          if ((await back.getPage(i + 1)).rotate !== (own + p.turn) % 360) throw unwritten();
        }
        if (facts.encrypted) {
          const kept = await back.getPermissions();
          if (!kept || [...kept].sort((a, b) => a - b).join() !== facts.permissions?.join()) throw unwritten();
        }
        return { bytes: out, hash: await hash(out), base, pages: pages.length };
      } finally {
        for (const d of docs) await d.loadingTask.destroy();
      }
    };

    // → { png, width, height }: the page drawn with its form values and annotations, its longer side maxPx at most,
    // drawn smaller until the PNG fits LIMITS.thumbnail (or 16 px is reached). { png: null, reason } where there is no canvas.
    const thumbnail = async (page, maxPx = 200) => {
      const make = typeof OffscreenCanvas === 'function' ? (w, h) => new OffscreenCanvas(w, h)
        : typeof document !== 'undefined' ? (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }) : null;
      if (!make) return { png: null, reason: 'no canvas to draw on' };
      const one = page.getViewport({ scale: 1 });
      let side = Math.max(16, Math.min(Math.floor(maxPx), 2048));
      for (;;) {
        const viewport = page.getViewport({ scale: side / Math.max(one.width, one.height) });
        const [width, height] = [Math.max(1, Math.round(viewport.width)), Math.max(1, Math.round(viewport.height))];
        const canvas = make(width, height);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        await page.render({ canvas, canvasContext: context, viewport, annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
        const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((done) => canvas.toBlob(done, 'image/png'));
        canvas.width = canvas.height = 0;
        if (blob.size <= LIMITS.thumbnail || side <= 16) return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
        side = Math.max(16, Math.floor(side * 0.75));
      }
    };

    // A page's text in the order pdf.js finds it, runs of spaces as one, at most max characters (LIMITS.text).
    const text = async (page, { max } = {}) => {
      const limit = Math.min(LIMITS.text, max ?? LIMITS.text);
      const { items } = await page.getTextContent();
      let out = '';
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        out += item.str + (item.hasEOL ? '\n' : '');
        if (out.length > limit) break;
      }
      return out.replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
    };

    return { open, save, bake, thumbnail, text, hash };
  };

  return { LIMITS, layout, use };
})();

if (typeof module !== 'undefined') module.exports = GZ_PDF_DOC; else GZ_PDF_DOC;
