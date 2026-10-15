// Ultra folders: DOM only, never a reader or a request. Unknown identity leaves the outline untouched.
var GZ_FOLDER_UI = globalThis.GZ_FOLDER_UI || (() => {
  const ctx = globalThis.GZ_CTX, { t, toggleOf } = ctx;
  const ROW = '.content-list-item[data-content-id]';
  let active = false, identity = null, revoked = null, user = '', key = '', data = null, epoch = 0, loading = false;
  const style = document.createElement('style');
  style.id = 'gz-folder-style';
  style.textContent = `[data-gz-folder-hidden="hide"]{display:none!important}[data-gz-folder-hidden="show"]{opacity:.55}.gz-folder-eye{opacity:0;flex:none;min-width:32px;min-height:32px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}.content-list-item:hover .gz-folder-eye,.gz-folder-eye:focus-visible,.content-list-item:focus-within .gz-folder-eye{opacity:1}.gz-folder-eye:focus-visible,#gz-folders-toggle:focus-visible{outline:2px solid var(--gz-accent,currentColor);outline-offset:2px}.gz-folder-eye:disabled{cursor:default}#gz-folders-toggle{margin:8px;padding:6px 10px;border:1px solid var(--gz-line,#888);border-radius:8px;color:inherit;background:var(--gz-surface,transparent);font:inherit}@media (hover: none), (any-pointer: coarse){.gz-folder-eye{opacity:1}}`;
  const clear = () => {
    for (const row of document.querySelectorAll('[data-gz-folder-hidden]')) row.removeAttribute('data-gz-folder-hidden');
    for (const b of document.querySelectorAll('.gz-folder-eye, #gz-folders-toggle')) b.remove();
    style.remove();
  };
  const current = () => active && ctx.on() && ctx.settings().enhance.hideFolders && /^\/ultra\/courses\/_\d+_\d+\/outline(?:\/|$)/.test(location.pathname);
  const expected = () => user && GZ_FOLDERS.key(location.origin, user, ctx.courseId());
  const valid = (k, e) => current() && epoch === e && key === k && expected() === k;
  const fail = () => { data = null; paint(); };
  const send = async (op) => {
    const k = key, e = epoch;
    if (!data || !valid(k, e)) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'glaze:folders', key: k, ...op });
      if (!valid(k, e)) return;
      if (!r?.ok) return fail();
      data = GZ_FOLDERS.clean(r.data); paint();
    } catch { if (valid(k, e)) fail(); }
  };
  const icon = (hidden) => `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${hidden ? '<path d="m3 3 18 18"/>' : ''}</svg>`;
  const button = () => {
    const b = document.createElement('button'); b.type = 'button';
    for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown', 'keyup']) b.addEventListener(ev, (e) => e.stopPropagation());
    return b;
  };
  const paint = () => {
    if (!current() || !data) return clear();
    if (!style.isConnected) document.head.append(style);
    const ids = new Set(data?.ids || []), rows = [...document.querySelectorAll(ROW)];
    for (const row of rows) {
      const toggle = toggleOf(row), id = row.dataset.contentId;
      if (!toggle || !GZ_FOLDERS.ID.test(id)) continue;
      const hidden = ids.has(id);
      const value = hidden ? data.show ? 'show' : 'hide' : null;
      if (row.getAttribute('data-gz-folder-hidden') !== value) { if (value) row.setAttribute('data-gz-folder-hidden', value); else row.removeAttribute('data-gz-folder-hidden'); }
      let b = row.querySelector(`#gz-folder-eye-${id}`);
      if (!b) {
        b = button(); b.className = 'gz-folder-eye'; b.id = `gz-folder-eye-${id}`;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (current() && row.isConnected) send({ id, hidden: !data?.ids.includes(id) }); });
        const heading = row.querySelector('h3');
        if (heading) heading.after(b); else row.append(b);
      }
      b.disabled = !data;
      const label = t(hidden ? 'Unhide folder: {title}' : 'Hide folder: {title}', { title: toggle.textContent.trim().slice(0, 300) });
      if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.title = label; }
      if (b.dataset.hidden !== String(hidden)) { b.dataset.hidden = String(hidden); b.innerHTML = icon(hidden); }
    }
    let control = document.getElementById('gz-folders-toggle');
    if (!ids.size) return control?.remove();
    if (!control) {
      control = button(); control.id = 'gz-folders-toggle';
      control.addEventListener('click', (e) => { e.stopPropagation(); send({ show: !data?.show }); });
    }
    const bar = document.getElementById('gz-progress');
    if (bar) { if (control.parentElement !== bar) bar.append(control); }
    else { const top = rows.find((r) => !r.parentElement.closest(ROW)); if (top && control.nextElementSibling !== top) top.before(control); }
    const label = t('Show hidden folders ({n})', { n: ids.size });
    if (control.textContent !== label) control.textContent = label;
    control.setAttribute('aria-pressed', String(data.show));
  };
  const read = async () => {
    const k = key, e = epoch;
    if (!k || loading) return;
    loading = true;
    try {
      const r = await chrome.storage.local.get(k);
      if (valid(k, e)) { data = GZ_FOLDERS.clean(r[k]); paint(); }
    } catch { if (valid(k, e)) fail(); }
    finally { if (epoch === e) loading = false; }
  };
  const sync = (on, cached) => {
    active = !!on;
    watch(current());
    if (!current()) {
      if (/\/ultra\/(?:profile|logout|login)(?:\/|$)/.test(location.pathname)) { revoked = identity; user = ''; }
      epoch++; key = ''; data = null; loading = false; clear(); return;
    }
    if (cached && cached !== identity && cached !== revoked) {
      identity = cached; user = ''; epoch++; key = ''; data = null; loading = false;
      Promise.resolve(cached).then((id) => {
        if (identity !== cached || revoked === cached || !current() || !GZ_FOLDERS.ID.test(id)) return;
        user = id; sync(active, cached);
      }, () => {});
    }
    const next = expected() || '';
    if (next !== key) { epoch++; key = next; data = null; loading = false; clear(); }
    if (!data) read();
    paint();
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && key && Object.hasOwn(changes, key)) { epoch++; loading = false; data = null; read(); } });
  // Mutation callbacks run before paint, including rows inserted when a folder is unfolded.
  // Ultra changes its page all the time: watched only while on a course's outline, and at most once a frame (a frame's
  // callback still runs before that frame paints, so a hidden folder never shows).
  let frame = 0;
  const observer = new MutationObserver(() => { if (active && !frame) frame = requestAnimationFrame(() => { frame = 0; if (active) sync(active, identity); }); });
  const watch = (on) => { if (on) observer.observe(document.body, { subtree: true, childList: true }); else observer.disconnect(); };
  return { sync };
})();
GZ_FOLDER_UI;
