// Canvas's files in Glaze's viewers (enhance.bbPreviews, Settings → Documents → Previews in Glaze; each kind only while its
// Settings → Writer switch is on: writer.pdf, writer.slides, writer.sheets), loaded on demand: features/docs.js loads this on a
// Canvas page with a file preview or a file link and hands it each pass. A .pdf, .pptx, .ppsx, .xlsx or .csv file's preview (the file page's
// #doc_preview, Files' preview at ?preview=) gets Open in Glaze among the document buttons; a link to one (a module's File
// row, a file link in a page) gets it beside the link. Only the click reads the file: Canvas's API names it and signs its
// address, and the worker's byte port reads it (features/download.js canvasFile, Download all's path; a file server Glaze
// doesn't hold is asked for first, in Glaze's Allow frame). Glaze's viewer (writer.html in view mode, the kind's show) loads
// out of sight beside Canvas's preview, or below the link, on the one-use pass the worker gives a Canvas page
// ('glaze:canvas-view'), and once drawn takes the preview's place, or opens. Anything else keeps Canvas's preview and the
// button says so. The button again, the switch off, or the preview gone puts Canvas's back; Esc in the viewer returns to the
// button. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_CANVAS_OPEN = globalThis.GZ_CANVAS_OPEN || (() => {
  const X = globalThis.GZ_CTX;
  if (!X || X.site !== 'canvas') return null;
  const html = document.documentElement;
  const HEIGHT = 'max(640px, calc(100vh - 120px))'; // an assignment's paper, as Ultra's previews (features/bbpreview.js)
  const SHOW = 30000; // the viewer drawn within this, or Canvas's preview stays
  // The kinds a file opens as, by extension, with the Writer switch each needs and the largest file each reads
  // (lib/doc-kinds.js KINDS max).
  const KINDS = { pdf: { kind: 'pdf', on: 'pdf', max: 50e6 }, pptx: { kind: 'slides', on: 'slides', max: 50e6 }, ppsx: { kind: 'slides', on: 'slides', max: 50e6 },
    xlsx: { kind: 'sheet', on: 'sheets', max: 15e6 }, csv: { kind: 'sheet', on: 'sheets', max: 15e6 } };
  const MIMES = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.slideshow': 'ppsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv' };
  const typeOf = (name, mime = '') => KINDS[/\.([a-z0-9]{1,5})\s*$/i.exec(String(name || ''))?.[1].toLowerCase()] || KINDS[MIMES[mime]] || null;
  const on = (k) => { const s = X.settings(); return X.on() && s.enabled !== false && s.enhance?.bbPreviews !== false && (!k || s.writer?.[k.on] === true); };
  const fileId = (v) => (/^\d{1,20}$/.test(String(v ?? '')) ? String(v) : '');
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 200);

  // ---- what can open: the preview on screen, and the links to files
  // The file page (#doc_preview names its file) or Files' preview (?preview= and its frame); → { key, frame: what Glaze's
  // takes the place of (the file page's whole box: Glaze's frame goes after it, never inside, where content.js PREVIEWS
  // would take it for Canvas's), id, name, type }.
  const PREVIEW_FRAMES = '#doc_preview iframe, iframe.ef-file-preview-frame, #file-preview-iframe';
  const previewTarget = () => {
    const dp = document.querySelector('#doc_preview[data-attachment_id]');
    const frame = document.querySelector(PREVIEW_FRAMES);
    if (!frame) return null;
    let id = '', name = '', mime = '';
    if (dp?.contains(frame)) { id = fileId(dp.dataset.attachment_id); name = dp.dataset.attachment_name; mime = dp.dataset.mimetype || ''; }
    else {
      // Its name: the preview's header, else the frame's label, else the list's link that opened it.
      id = fileId(new URLSearchParams(location.search).get('preview'));
      name = [document.querySelector('.ef-file-preview-header-filename')?.textContent, frame.getAttribute('aria-label')?.replace(/^File preview for /, ''), frame.title,
        id && document.querySelector(`a[href*="preview=${id}"]`)?.textContent].find((x) => typeOf(x)) || '';
    }
    const type = id && typeOf(name, mime);
    return type ? { key: `p:${id}`, frame: dp?.contains(frame) ? dp : frame, id, name: clean(name), type } : null;
  };
  // A module's File row (its class names the file: Attachment_<id>) and a page's file links on this site.
  const linkTargets = () => {
    const out = [];
    for (const li of document.querySelectorAll('.context_module_item.attachment')) {
      const id = /\bAttachment_(\d{1,20})\b/.exec(li.className)?.[1], a = li.querySelector('a.item_link');
      const name = clean(a?.getAttribute('title') || a?.textContent), type = id && a && typeOf(name);
      if (type) out.push({ key: `l:${id}:${li.id}`, link: a, after: a, below: li.querySelector('.ig-row') || li, id, name, type });
    }
    for (const a of document.querySelectorAll('#content a.instructure_file_link[href], #content a[data-api-returntype="File"][href]')) {
      let u = null;
      try { u = new URL(a.href, location.href); } catch { continue; }
      const id = u.origin === location.origin && /^\/courses\/\d+\/files\/(\d{1,20})(?:\/|$)/.exec(u.pathname)?.[1];
      const name = clean(a.getAttribute('title') || a.textContent), type = id && typeOf(name);
      if (type) out.push({ key: `a:${id}:${out.length}`, link: a, after: a, below: a.closest('p, li') || a, id, name, type });
    }
    return out;
  };

  // ---- the Look as the frame wears it (features/bbpreview.js look)
  const TOKENS = [...GZ_COLORS.map(([k]) => k), '--gz-radius', '--gz-font', '--gz-ground', '--gz-surface-paint', '--gz-surface-paint-2', '--gz-surface-opacity', '--gz-glass-mix', '--gz-border-line', '--gz-border-strong'];
  const look = () => {
    const cs = getComputedStyle(html), bg = html.getAttribute('data-gz-bg'), glass = !!bg && bg !== 'solid';
    const value = (k) => (k === '--gz-glass-mix' && !glass ? '100%' : cs.getPropertyValue(k).trim() || (k === '--gz-surface-opacity' ? '100%' : ''));
    return { tokens: Object.fromEntries(TOKENS.map((k) => [k, value(k)]).filter(([, v]) => v)), dark: html.hasAttribute('data-gz-dark-theme'), glass, motion: html.getAttribute('data-gz-motion') || 'off' };
  };

  // ---- the buttons
  const ICON = 'M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5';
  let n = 0;
  const button = (round) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `gz-co-${++n}`; // gz- ids are skipped by the sweep
    b.className = round ? 'gz-co-round' : 'gz-co';
    if (round) {
      b.dataset.gz = 'open';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS(svg.namespaceURI, 'path');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); p.setAttribute('d', ICON);
      svg.append(p); b.append(svg);
    }
    return b;
  };
  // A button's words: Open in Glaze, or what went wrong (the round one says it as its name).
  const label = (v, text) => {
    if (v.round) { if (v.button.title !== text) v.button.title = text; }
    else if (v.button.textContent !== text) v.button.textContent = text;
  };
  const SAID = { locked: "This file isn't available to you right now.", big: (v) => ({ pdf: 'Choose a PDF smaller than 50 MB.', slides: 'Choose a PowerPoint file smaller than 50 MB.', sheet: 'Choose a spreadsheet smaller than 15 MB.' })[v.type.kind] };
  const views = new Map(); // key → the view

  // ---- one file's view: the bytes on the click, Glaze's frame beside Canvas's preview or below the link
  const mark = (v, state) => { if (state) v.button.setAttribute('data-gz-co', state); else v.button.removeAttribute('data-gz-co'); };
  const close = (v, why = '') => {
    clearTimeout(v.wait);
    v.ctl?.abort(); v.ctl = null;
    v.unhello?.(); v.unhello = null;
    v.port?.close(); v.port = null;
    v.gz?.remove(); v.gz = null;
    v.frame?.removeAttribute('data-gz-co-hidden');
    v.shown = false;
    v.button.setAttribute(v.round ? 'aria-pressed' : 'aria-expanded', 'false');
    v.button.removeAttribute('aria-busy');
    mark(v, why ? `failed:${why}` : '');
    label(v, why ? X.t(typeof SAID[why] === 'function' ? SAID[why](v) : SAID[why] || "Couldn't open this file in Glaze.") : X.t('Open in Glaze'));
  };
  const swap = (v) => {
    clearTimeout(v.wait);
    v.unhello?.(); v.unhello = null;
    v.shown = true;
    mark(v, 'shown');
    v.button.removeAttribute('aria-busy');
    v.button.setAttribute(v.round ? 'aria-pressed' : 'aria-expanded', 'true');
    v.frame?.setAttribute('data-gz-co-hidden', '');
    v.gz.style.cssText = `display:block;border:0;width:100%;height:${HEIGHT};background:transparent;color-scheme:${html.hasAttribute('data-gz-dark-theme') ? 'dark' : 'light'}`;
    v.gz.removeAttribute('tabindex');
  };
  const hear = (v, m, bytes) => {
    if (m.type === 'ready') {
      const href = new URL(`/courses/${location.pathname.split('/')[2]}/files/${v.id}`, location.origin).href;
      v.port.postMessage({ type: 'init', mode: 'view', kind: v.type.kind, view: { bytes: bytes.buffer, name: v.name, href }, look: look(), locale: X.locale() }, [bytes.buffer]);
    } else if (m.type === 'view:shown') swap(v);
    else if (m.type === 'view:failed') close(v, `viewer:${String(m.reason || '').replace(/[^\w-]/g, '').slice(0, 20)}`);
    else if (m.type === 'view:esc') v.button.focus();
  };
  // writer.html in view mode, out of sight where it will show, on the one-use pass; the bytes go to it once it is ready.
  const load = (v, bytes) => {
    const src = chrome.runtime.getURL('writer.html'), origin = src.slice(0, src.indexOf('/', src.indexOf('://') + 3)).toLowerCase();
    const f = Object.assign(document.createElement('iframe'), { className: 'gz-co-frame', title: v.name || X.t('Open in Glaze') });
    f.tabIndex = -1;
    // Fixed in the window's corner while it loads: a frame out of view isn't drawn (Chromium throttles it), and the link or
    // preview it opens for can be below the fold.
    const w = Math.round((v.frame || v.below).getBoundingClientRect().width) || 800;
    f.style.cssText = `display:block;border:0;width:${w}px;height:${HEIGHT};background:transparent;position:fixed;left:0;top:0;opacity:0;pointer-events:none`;
    const ch = new MessageChannel();
    v.gz = f;
    v.port = ch.port1;
    ch.port1.onmessage = ({ data }) => { if (v.gz === f && data && typeof data.type === 'string') hear(v, data, bytes); };
    v.wait = setTimeout(() => { if (v.gz === f && !v.shown) close(v, 'timeout'); }, SHOW);
    let offered = false, transferred = false;
    const hello = async (e) => {
      if (v.gz !== f || offered || e.source !== f.contentWindow || e.origin !== origin || e.data?.type !== 'glaze:writer:hello') return;
      offered = true;
      const pass = crypto.randomUUID();
      const ok = await Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:canvas-view', pass })).then((r) => r?.ok === true, () => false);
      if (v.gz !== f) return;
      if (!ok || !f.isConnected) { close(v, 'pass'); return; }
      try { f.contentWindow.postMessage({ type: 'glaze:writer', pass }, origin, [ch.port2]); transferred = true; } catch { close(v, 'pass'); }
    };
    v.unhello = () => { removeEventListener('message', hello); if (!transferred) ch.port2.close(); };
    addEventListener('message', hello);
    f.addEventListener('load', () => { if (v.gz === f && offered) close(v, 'navigated'); });
    f.src = `${src}?host=${encodeURIComponent(location.origin)}`;
    (v.frame || v.below).after(f);
  };
  const open = async (v) => {
    if (v.ctl || v.gz) { close(v); return; } // the button again: Canvas's own back
    const ctl = new AbortController();
    v.ctl = ctl;
    mark(v, 'reading');
    v.button.setAttribute('aria-busy', 'true');
    label(v, X.t('Open in Glaze'));
    try {
      await X.need('features/download.js', () => globalThis.GZ_DOWNLOAD);
      const f = await GZ_DOWNLOAD.canvasFile(v.id, { signal: ctl.signal, max: v.type.max, beside: v.button });
      if (v.ctl !== ctl || !live(v)) return;
      v.ctl = null;
      mark(v, 'loading');
      if (!v.name) v.name = clean(f.name);
      load(v, f.bytes);
    } catch (e) {
      if (v.ctl !== ctl) return;
      v.ctl = null;
      close(v, ctl.signal.aborted ? '' : ['locked', 'big', 'refused'].includes(e?.message) ? e.message : 'read');
    }
  };
  const live = (v) => views.get(v.key) === v && v.button.isConnected && on(v.type);
  const make = (t, round) => {
    const v = { ...t, round, button: button(round), shown: false, ctl: null, gz: null, port: null, wait: 0 };
    label(v, X.t('Open in Glaze'));
    v.button.setAttribute(round ? 'aria-pressed' : 'aria-expanded', 'false');
    // Inside Canvas's clickable rows: the click is the button's alone.
    v.button.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (e.isTrusted) open(v); });
    views.set(v.key, v);
    return v;
  };
  const drop = (v) => { close(v); v.button.remove(); views.delete(v.key); };

  // Each pass: the preview's view (docs.js places its button with the document buttons) and a button by each link.
  let pv = null;
  const sync = () => {
    const pt = on() ? previewTarget() : null, ok = !!pt && on(pt.type);
    if (pv && (!ok || pv.key !== pt.key || pv.frame !== pt.frame || !pv.frame.isConnected)) { drop(pv); pv = null; }
    if (ok && !pv) pv = make(pt, true);
    const seen = new Set();
    if (on()) for (const t of linkTargets()) {
      if (!on(t.type)) continue;
      seen.add(t.key);
      const v = views.get(t.key);
      if (v && v.link === t.link && v.button.isConnected) continue;
      if (v) drop(v);
      t.after.after(make(t, false).button);
    }
    for (const v of [...views.values()]) if (v !== pv && (!seen.has(v.key) || !v.link.isConnected)) drop(v);
    for (const v of views.values()) if (v.gz && !v.gz.isConnected) close(v);
  };
  // The round button for the preview on screen, for features/docs.js's group, or null.
  const previewButton = () => (pv && pv.frame.isConnected ? pv.button : null);
  // What a check reads: each view's state.
  const state = () => [...views.values()].map((v) => ({ key: v.key, name: v.name, kind: v.type.kind, round: v.round, shown: v.shown, state: v.button.getAttribute('data-gz-co') || '' }));
  return { sync, previewButton, state };
})();

GZ_CANVAS_OPEN;
