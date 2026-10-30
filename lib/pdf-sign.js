// The PDF tools' Signature (lib/pdf-tools.js): drawn, typed or taken from a picture, put on the page through pdf.js's
// own signature editor (its signatureManager: getSignature opens Glaze's dialog, the editor makes the mark). A signature
// is a mark on the page, not a digital signature: nothing certifies who made it. Up to KEEP of them stay in
// storage.local (KEY), newest first, each as its outlines only: the strokes or contours pdf.js traced, quantized and
// deflated (encode, decode); never a picture.
// Classic script; module.exports for node (the codec and keep are pure).
var GZ_PDF_SIGN = globalThis.GZ_PDF_SIGN || (() => {
  const KEY = 'pdfSignatures', KEEP = 5, MAX = 64 << 10; // a stored signature's encoded outlines at most
  const Q = 8; // points kept to an eighth of the drawing's own unit

  // ---- the codec: { outlines: [[x, y, x, y, …], …], areContours, thickness, width, height } ↔ a base64 string.
  // Version 1: varints (zigzag deltas of each outline's points, times Q), deflated raw.
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const encode = async ({ outlines, areContours = false, thickness = 0, width, height }) => {
    if (!Array.isArray(outlines) || !outlines.length || !(width > 0) || !(height > 0)) throw new RangeError('a signature has outlines and a size');
    const out = [];
    const uint = (n) => { n = Math.round(n); if (!(n >= 0) || n > 2 ** 32) throw new RangeError('out of range'); do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); };
    const int = (n) => uint(n < 0 ? -2 * n - 1 : 2 * n);
    out.push(1, areContours ? 1 : 0);
    uint(thickness * Q); uint(width); uint(height); uint(outlines.length);
    for (const pts of outlines) {
      if (!(pts?.length >= 2) || pts.length % 2) throw new RangeError('an outline is pairs of numbers');
      uint(pts.length / 2);
      let x = 0, y = 0;
      for (let i = 0; i < pts.length; i += 2) {
        const nx = Math.round(pts[i] * Q), ny = Math.round(pts[i + 1] * Q);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new RangeError('an outline is pairs of numbers');
        int(nx - x); int(ny - y); x = nx; y = ny;
      }
    }
    return b64(await pipe(Uint8Array.from(out), new CompressionStream('deflate-raw')));
  };
  // → the outlines (Float32Arrays), or null for anything that isn't one.
  const decode = async (s) => {
    try {
      if (typeof s !== 'string' || !s || s.length > MAX) return null;
      const bytes = await pipe(unb64(s), new DecompressionStream('deflate-raw'));
      let at = 0;
      const uint = () => { let n = 0, m = 1, b; do { if (at >= bytes.length || m > 2 ** 35) throw new Error('short'); b = bytes[at++]; n += (b & 127) * m; m *= 128; } while (b & 128); return n; };
      const int = () => { const z = uint(); return z % 2 ? -(z + 1) / 2 : z / 2; };
      if (bytes[at++] !== 1) return null;
      const areContours = bytes[at++] === 1, thickness = uint() / Q, width = uint(), height = uint(), n = uint();
      if (!(width > 0 && height > 0) || n < 1 || n > bytes.length) return null;
      const outlines = [];
      for (let k = 0; k < n; k++) {
        const len = uint();
        if (len < 1 || len > bytes.length) return null;
        const pts = new Float32Array(2 * len);
        let x = 0, y = 0;
        for (let i = 0; i < len; i++) { x += int(); y += int(); pts[2 * i] = x / Q; pts[2 * i + 1] = y / Q; }
        outlines.push(pts);
      }
      return at === bytes.length ? { outlines, areContours, thickness, width, height } : null;
    } catch { return null; }
  };
  // The stored list with one more: newest first, at most KEEP, each only { id, at, name, kind, data }.
  const keep = (list, item) => [item, ...(Array.isArray(list) ? list : []).filter((x) => x && x.id !== item.id)].slice(0, KEEP)
    .map(({ id, at, name, kind, data }) => ({ id, at, name: String(name || '').slice(0, 80), kind, data }));

  // ---- storage.local
  const store = () => globalThis.chrome?.storage?.local;
  const list = async () => { try { const v = (await store().get(KEY))[KEY]; return Array.isArray(v) ? v.filter((x) => x && typeof x.data === 'string' && x.data.length <= MAX).slice(0, KEEP) : []; } catch { return []; } };
  const add = async (item) => { const next = keep(await list(), item); await store().set({ [KEY]: next }); return next; };
  const remove = async (id) => { const next = (await list()).filter((x) => x.id !== id); await store().set({ [KEY]: next }); return next; };

  // ---- the dialog and pdf.js's signatureManager. o: { P (pdf.mjs), t, h, btn, done() (the dialog closed) }. While it is
  // open, pdf.js holds an empty signature editor that can't be saved: busy() says so, and the viewer saves once done.
  const SVG = 'http://www.w3.org/2000/svg';
  // An outline drawn small: strokes as lines, contours (a typed name, a picture's) filled.
  const preview = (d, size = [160, 56]) => {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', `0 0 ${d.width} ${d.height}`); s.setAttribute('width', size[0]); s.setAttribute('height', size[1]);
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'gq-sign-pic');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d.outlines.map((pts) => { let x = `M${pts[0]} ${pts[1]}`; for (let i = 2; i < pts.length; i += 2) x += `L${pts[i]} ${pts[i + 1]}`; return d.areContours ? `${x}Z` : x; }).join(''));
    if (d.areContours) { p.setAttribute('fill', 'currentColor'); p.setAttribute('fill-rule', 'evenodd'); } else { p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', String(Math.max(1, d.thickness))); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); }
    s.append(p);
    return s;
  };
  const HEIGHT = 40; // a signature's height on the page, in points, as pdf.js's own viewer puts it
  const manager = (o) => {
    const { P, t, h, btn } = o;
    let open = null, cancel = null;
    // The outline pdf.js's editor draws from stored outlines (pdf.js's own SignatureExtractor).
    const outlineFor = (editor, d) => {
      const { rawDims: { pageWidth, pageHeight }, rotation } = editor.parent.viewport;
      return P.SignatureExtractor.processDrawnLines({ lines: { curves: [...d.outlines].map((points) => ({ points })), thickness: d.thickness, width: d.width, height: d.height },
        pageWidth, pageHeight, rotation, innerMargin: editor.constructor._INNER_MARGIN ?? 0, mustSmooth: false, areContours: d.areContours });
    };
    const insert = (editor, d, name, id) => { editor.addSignature(outlineFor(editor, d), HEIGHT, name || '', id); };
    const getSignature = ({ editor }) => {
      cancel?.();
      const dialog = h('dialog', { class: 'gq-sign pop', 'aria-label': t('Signature') });
      let done = false, closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true; releasePicture(); dialog.remove(); open = null; cancel = null;
        if (!done) editor.remove();
        o.done?.();
      };
      // close events are queued by the browser. A leave/submit flush needs the empty editor gone synchronously.
      const finish = (ok) => { done = ok; dialog.close(); cleanup(); };
      dialog.addEventListener('close', cleanup);
      // Saved ones, newest first: one to put in, or to delete.
      const saved = h('div', { class: 'gq-sign-saved', role: 'list' });
      const drawSaved = async () => {
        const items = [];
        for (const s of await list()) {
          const d = await decode(s.data);
          if (!d) continue;
          items.push(h('div', { class: 'gq-sign-item', role: 'listitem' },
            btn({ class: 'gq-sign-use', 'data-act': 'use', 'aria-label': s.name || t('Signature'), onclick: () => { insert(editor, d, s.name, s.id); finish(true); } }, preview(d)),
            btn({ class: 'gq-ib', 'data-act': 'forget', title: t('Delete'), 'aria-label': t('Delete'), onclick: async () => { await remove(s.id).catch(() => {}); drawSaved(); } }, '×')));
        }
        saved.replaceChildren(...items);
        saved.hidden = !saved.childElementCount;
      };
      // Draw: strokes on a pad, kept as pdf.js's drawn curves.
      const W = 400, H = 150;
      const pad = document.createElementNS(SVG, 'svg');
      pad.setAttribute('viewBox', `0 0 ${W} ${H}`); pad.setAttribute('class', 'gq-sign-pad'); pad.setAttribute('role', 'img'); pad.setAttribute('aria-label', t('Draw'));
      const curves = [];
      let line = null;
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault(); pad.setPointerCapture?.(e.pointerId);
        const r = pad.getBoundingClientRect(), at = (ev) => [((ev.clientX - r.left) * W) / r.width, ((ev.clientY - r.top) * H) / r.height];
        const pts = [...at(e)], path = document.createElementNS(SVG, 'path');
        path.setAttribute('d', `M${pts[0]} ${pts[1]}`); pad.append(path);
        line = { pts, path, at };
        curves.push({ points: pts });
        ready();
      });
      pad.addEventListener('pointermove', (e) => { if (!line) return; const [x, y] = line.at(e); line.pts.push(x, y); line.path.setAttribute('d', `${line.path.getAttribute('d')}L${x} ${y}`); });
      for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, () => { line = null; });
      const again = btn({ class: 'gp-tbtn', 'data-act': 'again', onclick: () => { curves.length = 0; pad.replaceChildren(); ready(); } }, t('Start over'));
      // Name: typed, traced by pdf.js from the font's outlines.
      const name = h('input', { type: 'text', class: 'gq-sign-name', maxlength: '80', autocomplete: 'name', spellcheck: 'false', 'aria-label': t('Name'), placeholder: t('Name') });
      name.addEventListener('input', () => ready());
      // Image: a picture of a signature, traced; the picture itself isn't kept.
      let bitmap = null, imageRead = 0;
      const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'gq-sign-file', 'aria-label': t('Image') });
      const said = h('p', { class: 'gq-sign-said', role: 'status' });
      const releasePicture = () => { imageRead++; bitmap?.close?.(); bitmap = null; file.value = ''; };
      file.addEventListener('change', async () => {
        const f = file.files[0], reading = ++imageRead;
        bitmap?.close?.(); bitmap = null; said.textContent = ''; ready();
        const next = f ? await createImageBitmap(f).catch(() => null) : null;
        if (closed || reading !== imageRead) { next?.close?.(); return; }
        bitmap = next;
        if (f && !next) said.textContent = t('That picture could not be read.');
        ready();
      });
      const panes = { draw: h('div', { class: 'gq-sign-pane' }, pad, again), name: h('div', { class: 'gq-sign-pane', hidden: true }, name), image: h('div', { class: 'gq-sign-pane', hidden: true }, file, said) };
      let tab = 'draw';
      const tabs = h('div', { class: 'gq-sign-tabs', role: 'tablist' }, ...[['draw', 'Draw'], ['name', 'Name'], ['image', 'Image']].map(([id, label]) => btn({ role: 'tab', class: 'gp-tbtn', 'data-tab': id, 'aria-selected': String(id === tab), onclick: () => show(id) }, t(label))));
      const show = (id) => {
        tab = id;
        for (const [k, el] of Object.entries(panes)) el.hidden = k !== id;
        for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === id));
        (id === 'name' ? name : id === 'image' ? file : pad).focus?.();
        ready();
      };
      tabs.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const ids = Object.keys(panes), i = ids.indexOf(tab), next = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
        e.preventDefault(); show(next); tabs.querySelector(`[data-tab="${next}"]`).focus();
      });
      const insertB = btn({ class: 'gp-submit', 'data-act': 'insert', disabled: true }, t('Insert'));
      const ready = () => { insertB.disabled = !(tab === 'draw' ? curves.some((c) => c.points.length >= 2) : tab === 'name' ? !!name.value.trim() : !!bitmap); };
      insertB.addEventListener('click', async () => {
        if (insertB.disabled) return;
        let data = null, label = '';
        try {
          if (tab === 'draw') data = editor.getDrawnSignature({ curves: curves.filter((c) => c.points.length >= 2).map((c) => ({ points: c.points })), thickness: 3, width: W, height: H });
          else if (tab === 'name') { label = name.value.trim(); data = editor.getFromText(label, { fontFamily: 'cursive', fontStyle: 'normal', fontWeight: '400' }); }
          else { try { data = editor.getFromImage(bitmap); } finally { releasePicture(); ready(); } }
        } catch (e) { console.error(e); }
        if (!data) { said.textContent = t('That picture could not be read.'); return; }
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        try { editor.addSignature(data, HEIGHT, label, id); } catch (e) { console.error(e); said.textContent = t('That picture could not be read.'); return; }
        finish(true);
        // Kept for next time as its outlines (pdf.js's newCurves): a refused write leaves the mark on the page.
        encode({ outlines: data.newCurves, areContours: data.areContours, thickness: data.thickness, width: data.width, height: data.height })
          .then((enc) => (enc.length <= MAX ? add({ id, at: Date.now(), name: label, kind: tab, data: enc }) : null)).catch((e) => console.error(e));
      });
      dialog.append(saved, tabs, ...Object.values(panes), h('div', { class: 'gq-sign-end' }, btn({ class: 'gp-tbtn', 'data-act': 'cancel', onclick: () => finish(false) }, t('Cancel')), insertB));
      document.body.append(dialog);
      open = dialog; cancel = () => finish(false);
      dialog.showModal();
      dialog.setAttribute('data-open', '');
      drawSaved();
      pad.focus?.();
    };
    return { getSignature, busy: () => !!open, cancel: () => { cancel?.(); }, loadSignatures: async () => {}, renderEditButton: async () => null, destroy: () => { cancel?.(); } };
  };

  return { KEY, KEEP, MAX, encode, decode, keep, list, add, remove, manager };
})();

if (typeof module !== 'undefined') module.exports = GZ_PDF_SIGN; else GZ_PDF_SIGN;
