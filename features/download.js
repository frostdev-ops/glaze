// Download all (enhance.download), loaded on demand: content.js loads this on a course page with a folder or learning
// module (Ultra) or a course's modules (Canvas) while the switch is on, and calls sync() from its passes.
// A button on each folder and learning module in course content saves the files inside, subfolders
// included, as one zip named after it. Listed with the content API, fetched from the site you are on
// (Blackboard redirects the bytes to its file CDN, which allows it), zipped here, saved through a blob
// link. Items with unmet view requirements are left out. Canvas authorizes signed URLs only on a click;
// credential-free background reads have no student file_access_user, protecting other module references
// to the same attachment too. Neither passive previews nor downloads mark those references viewed.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DOWNLOAD = globalThis.GZ_DOWNLOAD || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, locale, need, capi, canvasCourseId, courseId, courseItems, toggleOf, moduleItems } = ctx;
  const MAX_ZIP = 250 * 2 ** 20; // ponytail: the whole zip is built in memory; stream to disk if folders outgrow it
  const canvasBytes = (signal) => {
    const port = chrome.runtime.connect({ name: 'canvas-zip' });
    let pending = null, closed = false;
    const close = () => {
      if (closed) return;
      closed = true; clearInterval(ping); signal.removeEventListener('abort', close); port.disconnect();
      pending?.reject(signal.reason || new DOMException('Aborted', 'AbortError')); pending = null;
    };
    // Active messages, rather than an idle open port, keep an MV3 worker alive during slow streams.
    const ping = setInterval(() => { if (!closed) port.postMessage({ type: 'ping' }); }, 15000);
    signal.addEventListener('abort', close, { once: true });
    port.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (!closed) { pending?.resolve(null); pending = null; close(); } });
    port.onMessage.addListener((m) => {
      if (!pending) return;
      if (m.type === 'chunk') {
        const raw = atob(m.data), data = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        pending.chunks.push(data); pending.size += data.length;
        port.postMessage({ type: 'ack' });
      } else if (m.type === 'done') {
        const data = new Uint8Array(pending.size); let at = 0;
        for (const c of pending.chunks) { data.set(c, at); at += c.length; }
        pending.resolve(data); pending = null;
      } else if (m.type === 'error') {
        if (m.code === 'limit') pending.reject(Object.assign(new Error('limit'), { limit: true })); else pending.resolve(null);
        pending = null;
      }
    });
    return { close, read: (url) => new Promise((resolve, reject) => {
      if (closed || signal.aborted) return reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      pending = { resolve, reject, chunks: [], size: 0 }; port.postMessage({ type: 'file', url });
    }) };
  };
  const jobs = new Map(); // folder id -> { ctl, label, pct, done }
  const paintDl = (fid) => {
    const b = document.getElementById(`gz-dl-${fid}`);
    const j = jobs.get(fid);
    if (!b) return;
    // Idle it's just an arrow, named for screen readers; working, it says how far along.
    b.textContent = j?.label || '';
    b.setAttribute('aria-label', j?.label || t('Download all'));
    b.toggleAttribute('data-busy', !!j && !j.done);
    b.toggleAttribute('data-job', !!j);
    b.style.setProperty('--gz-pct', `${j?.done ? 0 : j?.pct || 0}%`);
  };
  const download = async (fid, title) => {
    const cid = ultra ? courseId() : canvasCourseId();
    const ctl = new AbortController();
    const job = { ctl, label: t('Finding files · Cancel'), pct: 0 };
    const bridge = ultra ? null : canvasBytes(ctl.signal);
    jobs.set(fid, job);
    const say = (label, pct = 0) => { Object.assign(job, { label, pct }); paintDl(fid); };
    say(job.label);
    // Only the fields used: never an item's contentDetail, where an LTI link keeps its tool's secret and key.
    const get = (path) => fetch(`${location.origin}/learn/api/${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
    const list = (id) => get(`v1/courses/${cid}/contents/${id}/children?limit=200&fields=${GZ_ULTRA.FILES_FIELDS}`).then((j) => j.results || []);
    const found = [];
    let skipped = 0;
    let unavailable = 0;
    // Whether an item is an Ultra document, from the course's public content list (its first 200 items), else asked.
    const pages = ultra ? courseItems(cid).p.then((l) => new Map(l.map((i) => [i.id, !!i.contentHandler?.isBbPage]))) : null;
    const isPage = async (c) => {
      const m = await pages;
      if (m.has(c.id)) return m.get(c.id);
      return /folder|document/.test(c.contentHandler) && !!(await get(`public/v1/courses/${cid}/contents/${c.id}?fields=id,contentHandler.isBbPage`)).contentHandler?.isBbPage;
    };
    const attachments = (id) => get(`public/v1/courses/${cid}/contents/${id}/attachments?fields=id,fileName`)
      .then((j) => GZ_ULTRA.attachments(location.origin, cid, id, j.results), (e) => { if (ctl.signal.aborted) throw e; return null; });
    const mb = (n) => new Intl.NumberFormat(GZ_I18N.locale(locale()), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(n / 2 ** 20);
    const tooBig = (label) => Object.assign(new Error(label), { said: true });
    try {
      await need('lib/zip.js', () => globalThis.GZ_ZIP);
      if (ultra) {
        await need('lib/ultra.js', () => globalThis.GZ_ULTRA);
        const r = await GZ_ULTRA.files({ root: fid, list, isPage, attachments, origin: location.origin, safeName: GZ_ZIP.safeName });
        found.push(...r.found);
        ({ skipped, failed: unavailable } = r);
      } else {
        const items = await moduleItems(cid, fid, true); // Refresh requirements at the click; a preview can be a minute old.
        skipped = GZ_ZIP.canvasUnopened(items).size;
        for (const id of GZ_ZIP.canvasFiles(items)) {
          ctl.signal.throwIfAborted();
          const f = await capi(`/files/${id}`).catch(() => null);
          ctl.signal.throwIfAborted();
          const signed = f && !f.locked_for_user && !f.hidden_for_user ? await capi(`/files/${id}/public_url`).catch(() => null) : null;
          ctl.signal.throwIfAborted();
          const url = GZ_ZIP.canvasURL({ ...f, url: signed?.public_url }, location.origin);
          if (!url) { unavailable++; continue; }
          found.push({ name: f.display_name || f.filename, size: f.size, url, dir: '' });
        }
      }
      const known = found.reduce((n, f) => n + (f.size || 0), 0);
      if (known > MAX_ZIP) throw tooBig(t('Too big: {size}, over {max}', { size: mb(known), max: mb(MAX_ZIP) }));
      const out = [];
      const taken = new Set();
      let bytes = 0;
      let failed = unavailable;
      for (const [i, f] of found.entries()) {
        say(t('{i} of {n} · Cancel', { i: i + 1, n: found.length }), (i / found.length) * 100);
        let data;
        if (ultra) {
          const r = await fetch(f.url, { credentials: 'same-origin', signal: ctl.signal }).catch((e) => { if (ctl.signal.aborted) throw e; return null; });
          if (!r?.ok) { failed += 1; continue; }
          data = new Uint8Array(await r.arrayBuffer());
        } else data = await bridge.read(f.url);
        if (!data) { failed += 1; continue; }
        bytes += data.length;
        if (bytes > MAX_ZIP) throw tooBig(t('Too big: over {max}', { max: mb(MAX_ZIP) }));
        out.push({ name: GZ_ZIP.unique(f.dir + GZ_ZIP.safeName(f.name), taken), data });
      }
      const left = skipped ? ` · ${t('{n} unopened left out', { n: skipped })}` : '';
      if (!out.length) return say((found.length || unavailable ? t('Download failed') : t(skipped ? 'No files you have opened' : 'No files')) + left);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(GZ_ZIP.zip(out), { type: 'application/zip' }));
      a.download = `${GZ_ZIP.safeName(title)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(t('Saved {n} files', { n: out.length }) + left + (failed ? ` · ${t('{n} failed', { n: failed })}` : ''));
    } catch (e) {
      say(ctl.signal.aborted ? t('Cancelled') : e.limit ? t('Too big: over {max}', { max: mb(MAX_ZIP) }) : e.said ? e.message : t('Download failed'));
    } finally {
      bridge?.close();
      job.done = true;
      paintDl(fid);
      setTimeout(() => { if (jobs.get(fid) === job) { jobs.delete(fid); paintDl(fid); } }, 6000);
    }
  };
  let canvasDlChecked = new WeakMap();
  const sync = () => {
    if (!ultra) {
      const cid = canvasCourseId();
      if (!ctx.settings().enhance.download || typeof chrome.runtime.connect !== 'function' || !cid || !/^\/courses\/\d+(?:\/modules)?\/?$/.test(location.pathname)) {
        for (const j of jobs.values()) j.ctl.abort();
        for (const b of document.querySelectorAll('.gz-dl')) b.remove();
        for (const item of document.querySelectorAll('.context_module')) canvasDlChecked.delete(item);
        return;
      }
      for (const item of document.querySelectorAll('.context_module[data-module-id]')) {
        const fid = item.dataset.moduleId;
        if (!/^\d+$/.test(fid)) continue;
        const header = item.querySelector('.ig-header');
        if (!header || Date.now() - (canvasDlChecked.get(item) || 0) < 60000) continue;
        canvasDlChecked.set(item, Date.now());
        // A collapsed or paginated module need not have its File rows in the DOM yet.
        moduleItems(cid, fid).then((list) => {
          if (!ctx.on() || !ctx.settings().enhance.download || !item.isConnected || canvasCourseId() !== cid) { canvasDlChecked.delete(item); return; }
          const old = document.getElementById(`gz-dl-${fid}`);
          if (!list.some((c) => c.type === 'File')) return old?.remove();
          if (old) return;
          const b = document.createElement('button');
          b.type = 'button'; b.id = `gz-dl-${fid}`; b.className = 'gz-dl'; b.title = t("Download all: save this folder's files as one zip. Items you haven't opened are left out, so this never marks them viewed.");
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!e.isTrusted) return;
            const j = jobs.get(fid);
            if (j && !j.done) j.ctl.abort(); else download(fid, item.querySelector('.name')?.textContent.trim());
          });
          header.append(b); paintDl(fid);
        }).catch(() => {});
      }
      return;
    }
    const on = ctx.settings().enhance.download && courseId();
    if (!on) { for (const b of document.querySelectorAll('.gz-dl')) b.remove(); return; }
    for (const item of document.querySelectorAll('.content-list-item[data-content-id]')) {
      const fid = item.dataset.contentId;
      // The item's own title comes first; an open folder's children follow it.
      if (!toggleOf(item) || document.getElementById(`gz-dl-${fid}`)) continue;
      const h3 = item.querySelector('h3');
      if (!h3) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `gz-dl-${fid}`; // gz- ids are skipped by the sweep
      b.className = 'gz-dl';
      b.title = t("Download all: save this folder's files as one zip. Items you haven't opened are left out, so this never marks them viewed.");
      // Inside Ultra's clickable row: keep the row from opening or folding.
      for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown', 'keyup']) b.addEventListener(ev, (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const j = jobs.get(fid);
        if (j && !j.done) j.ctl.abort();
        else download(fid, h3.textContent.trim());
      });
      h3.after(b);
      paintDl(fid);
    }
  };

  return {
    sync,
    // Glaze switched off: what is still being fetched stops.
    stop: () => { for (const j of jobs.values()) j.ctl.abort(); canvasDlChecked = new WeakMap(); },
  };
})();

GZ_DOWNLOAD;
