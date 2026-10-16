// Ultra folders: DOM only, never a reader or a request. Unknown identity leaves the outline untouched.
var GZ_FOLDER_UI = globalThis.GZ_FOLDER_UI || (() => {
  const ctx = globalThis.GZ_CTX, { t, toggleOf } = ctx;
  const ROW = '.content-list-item[data-content-id]';
  let active = false, identity = null, revoked = null, user = '', key = '', data = null, epoch = 0, loading = false, reading = null;
  let generation = 0, action = 0, notice = null, timer = 0, pendingFocus = null, route = '';
  const marks = new Map(), status = document.createElement('div');
  status.id = 'gz-folder-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const style = document.createElement('style');
  style.id = 'gz-folder-style';
  style.textContent = `[data-gz-folder-hidden="hide"]{display:none!important}[data-gz-folder-hidden="show"]{opacity:.55}.gz-folder-eye{opacity:0;flex:none;min-width:32px;min-height:32px;border:0;border-radius:calc(var(--gz-radius, 12px) * 1 / 2);background:transparent;color:inherit;cursor:pointer}.content-list-item:hover .gz-folder-eye,.gz-folder-eye:focus-visible,.content-list-item:focus-within .gz-folder-eye,.gz-folder-eye[data-hidden="true"]{opacity:1}.gz-folder-eye:focus-visible,#gz-folders-toggle:focus-visible,#gz-folder-undo:focus-visible{outline:2px solid var(--gz-accent,currentColor);outline-offset:2px}.gz-folder-eye:disabled{cursor:default}#gz-folders-toggle{display:inline-flex;align-items:center;gap:6px;margin:8px;padding:6px 10px;border:1px solid var(--gz-line,#888);border-radius:calc(var(--gz-radius, 12px) * 2 / 3);color:inherit;background:var(--gz-surface-grain, none), var(--gz-surface-fill, var(--gz-surface,transparent));font:inherit}#gz-folders-toggle[aria-pressed="true"]{background:var(--gz-accent-soft,#ddd);border-color:var(--gz-accent,currentColor);box-shadow:inset 0 0 0 1px var(--gz-accent,currentColor)}.gz-folder-badge{display:inline-block;margin-inline-start:8px;padding:2px 6px;border:1px solid currentColor;border-radius:calc(var(--gz-radius, 12px) * 1 / 3);font-size:.7em;font-weight:600;vertical-align:middle}#gz-folder-status:not(:empty){display:flex;align-items:center;gap:8px;margin:8px;padding:8px;border:1px solid var(--gz-line,#888);border-radius:8px}#gz-folder-undo{font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:calc(var(--gz-radius, 12px) * 1 / 3);padding:4px 8px;cursor:pointer}@media (hover: none), (any-pointer: coarse){.gz-folder-eye{opacity:1}}`;
  const restoreName = (el, mark) => {
    if (!mark.attr) return;
    const value = el.getAttribute(mark.attr);
    if (value === mark.applied) { if (mark.before === null) el.removeAttribute(mark.attr); else el.setAttribute(mark.attr, mark.before); }
    else if (mark.attr === 'aria-labelledby' && value?.split(/\s+/).includes(mark.badge.id)) el.setAttribute(mark.attr, value.split(/\s+/).filter((id) => id !== mark.badge.id).join(' '));
  };
  const unmark = (el, mark) => { restoreName(el, mark); mark.badge.remove(); marks.delete(el); };
  const titleOf = (el) => [...el.childNodes].filter((n) => n.className !== 'gz-folder-badge').map((n) => n.textContent).join('').trim().slice(0, 300);
  const markHidden = (el, row, id) => {
    let mark = marks.get(el);
    if (!mark) {
      const badge = document.createElement('span'); badge.className = 'gz-folder-badge'; badge.id = `gz-folder-badge-${id}`;
      mark = { row, id, badge, attr: null }; marks.set(el, mark);
    }
    const badgeText = ` ${t('Hidden')}`;
    if (mark.badge.textContent !== badgeText) mark.badge.textContent = badgeText;
    if (mark.badge.parentElement !== el) el.append(mark.badge);
    const attr = el.getAttribute('aria-labelledby')?.trim() ? 'aria-labelledby' : el.getAttribute('aria-label')?.trim() ? 'aria-label' : null;
    if (mark.attr !== attr) { restoreName(el, mark); mark.attr = attr; mark.applied = undefined; }
    if (attr) {
      const value = el.getAttribute(attr);
      if (value !== mark.applied) mark.before = attr === 'aria-labelledby' && value.split(/\s+/).includes(mark.badge.id) ? value.split(/\s+/).filter((v) => v !== mark.badge.id).join(' ') : value;
      mark.applied = attr === 'aria-labelledby' ? `${mark.before} ${mark.badge.id}` : `${mark.before} · ${t('Hidden')}`;
      if (value !== mark.applied) el.setAttribute(attr, mark.applied);
    }
  };
  const dismiss = () => { clearTimeout(timer); timer = 0; notice = null; if (status.childNodes.length) status.replaceChildren(); };
  const expire = () => { clearTimeout(timer); timer = setTimeout(() => { timer = 0; if (status.contains(document.activeElement)) expire(); else dismiss(); }, 6000); };
  const clear = () => {
    dismiss(); pendingFocus = null;
    for (const [el, mark] of marks) unmark(el, mark);
    for (const row of document.querySelectorAll('[data-gz-folder-hidden]')) row.removeAttribute('data-gz-folder-hidden');
    for (const b of document.querySelectorAll('.gz-folder-eye, #gz-folders-toggle')) b.remove();
    status.remove(); style.remove();
  };
  const current = () => active && ctx.on() && ctx.settings().enhance.hideFolders && /^\/ultra\/courses\/_\d+_\d+\/outline(?:\/|$)/.test(location.pathname);
  const expected = () => user && GZ_FOLDERS.key(location.origin, user, ctx.courseId());
  const valid = (k, e) => current() && epoch === e && key === k && expected() === k;
  const path = () => `${location.pathname}${location.search || ''}${location.hash || ''}`;
  const sameAction = (k, g) => current() && generation === g && path() === route && key === k && expected() === k;
  const fail = () => { data = null; paint(); };
  const send = async (op, source, keyboard = false, restore = '') => {
    const k = key, e = epoch, g = generation;
    if (!data || !valid(k, e) || !sameAction(k, g)) return;
    const a = ++action;
    if (op.hidden && keyboard && document.activeElement === source) pendingFocus = { source, k, g, id: op.id };
    try {
      const r = await chrome.runtime.sendMessage({ type: 'glaze:folders', key: k, ...op });
      if (!sameAction(k, g)) return;
      if (!r?.ok) { if (a === action) fail(); return; }
      if (epoch === e && a === action) { data = GZ_FOLDERS.clean(r.data); paint(); } else await read();
      if (!sameAction(k, g) || a !== action || !data) return;
      const focusBack = restore && document.activeElement === source;
      dismiss();
      const message = document.createElement('span');
      const count = data.ids.length;
      let text = op.hidden ? 'Folder hidden.' : 'Folder shown.';
      if (op.show !== undefined) {
        text = op.show ? 'Showing {n} hidden folders.' : 'Hiding {n} folders.';
        if (count === 1) text = op.show ? 'Showing 1 hidden folder.' : 'Hiding 1 folder.';
      }
      message.textContent = t(text, { n: count });
      status.append(message);
      if (op.hidden) {
        const token = notice = { k, g, id: op.id, a }, undo = button(); undo.id = 'gz-folder-undo'; undo.textContent = t('Undo');
        undo.addEventListener('click', (event) => { event.stopPropagation(); if (event.isTrusted && notice === token && action === token.a && sameAction(token.k, token.g)) send({ id: token.id, hidden: false }, undo, event.detail === 0, token.id); });
        status.append(undo);
      }
      expire();
      if (focusBack) document.getElementById(`gz-folder-eye-${restore}`)?.focus({ preventScroll: true });
    } catch { if (sameAction(k, g)) fail(); }
    finally { if (a === action) pendingFocus = null; }
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
    for (const [el, mark] of marks) if (!el.isConnected || toggleOf(mark.row) !== el || mark.row.dataset.contentId !== mark.id || !ids.has(mark.id) || !data.show) unmark(el, mark);
    const focusToggle = pendingFocus && sameAction(pendingFocus.k, pendingFocus.g) && pendingFocus.source.isConnected && pendingFocus.source.closest(ROW)?.dataset.contentId === pendingFocus.id && document.activeElement === pendingFocus.source && ids.has(pendingFocus.id) && !data.show;
    for (const b of document.querySelectorAll('.gz-folder-eye')) {
      const row = b.closest(ROW);
      if (!row || !toggleOf(row) || b.id !== `gz-folder-eye-${row.dataset.contentId}`) b.remove();
    }
    for (const row of rows) {
      const toggle = toggleOf(row), id = row.dataset.contentId;
      if (!toggle || !GZ_FOLDERS.ID.test(id)) { row.removeAttribute('data-gz-folder-hidden'); continue; }
      const hidden = ids.has(id);
      const value = hidden ? data.show ? 'show' : 'hide' : null;
      if (row.getAttribute('data-gz-folder-hidden') !== value) { if (value) row.setAttribute('data-gz-folder-hidden', value); else row.removeAttribute('data-gz-folder-hidden'); }
      let b = row.querySelector(`#gz-folder-eye-${id}`);
      if (!b) {
        b = button(); b.className = 'gz-folder-eye'; b.id = `gz-folder-eye-${id}`;
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (e.isTrusted && b.isConnected && current() && row.isConnected && row.dataset.contentId === id && toggleOf(row)) send({ id, hidden: !data?.ids.includes(id) }, b, e.detail === 0); });
      }
      // Beside the folder's title: after its heading, or a nested folder's title itself (it has no heading of its own;
      // the row's end is below the folder and what it holds).
      const at = toggle.closest('h1, h2, h3, h4, h5, h6') || toggle;
      if (row.contains(at) && b.previousElementSibling !== at) at.after(b);
      b.disabled = !data;
      if (hidden && data.show) markHidden(toggle, row, id);
      const label = t(hidden ? 'Unhide folder: {title}' : 'Hide folder: {title}', { title: titleOf(toggle) });
      if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.title = label; }
      if (b.dataset.hidden !== String(hidden)) { b.dataset.hidden = String(hidden); b.innerHTML = icon(hidden); }
    }
    const bar = document.getElementById('gz-progress'), top = rows.find((r) => !r.parentElement.closest(ROW));
    if (bar) { if (status.previousElementSibling !== bar) bar.after(status); }
    else if (top && status.nextElementSibling !== top) top.before(status);
    let control = document.getElementById('gz-folders-toggle');
    if (!ids.size) return control?.remove();
    if (!control) {
      control = button(); control.id = 'gz-folders-toggle';
      control.addEventListener('click', (e) => { e.stopPropagation(); if (e.isTrusted) send({ show: !data?.show }); });
      for (const name of ['icon', 'label']) { const span = document.createElement('span'); span.className = `gz-folders-toggle-${name}`; control.append(span); }
    }
    if (bar) { if (control.parentElement !== bar) bar.append(control); }
    else if (status.isConnected && control.nextElementSibling !== status) status.before(control);
    const label = t(data.show ? 'Hide them again ({n})' : 'Show hidden folders ({n})', { n: ids.size }), text = control.querySelector('.gz-folders-toggle-label');
    if (text.textContent !== label) text.textContent = label;
    if (control.dataset.show !== String(data.show)) { control.dataset.show = String(data.show); control.querySelector('.gz-folders-toggle-icon').innerHTML = icon(data.show); }
    if (control.getAttribute('aria-pressed') !== String(data.show)) control.setAttribute('aria-pressed', String(data.show));
    if (focusToggle) { control.focus({ preventScroll: true }); pendingFocus = null; }
  };
  const read = () => {
    const k = key, e = epoch;
    if (!k) return Promise.resolve();
    if (loading) return reading;
    loading = true;
    reading = Promise.resolve().then(() => chrome.storage.local.get(k)).then((r) => {
      if (valid(k, e)) { data = GZ_FOLDERS.clean(r[k]); paint(); }
    }).catch(() => { if (valid(k, e)) fail(); }).finally(() => { if (epoch === e) loading = false; });
    return reading;
  };
  const sync = (on, cached) => {
    active = !!on;
    if (path() !== route) { route = path(); generation++; dismiss(); pendingFocus = null; }
    watch(current());
    if (!current()) {
      if (/\/ultra\/(?:profile|logout|login)(?:\/|$)/.test(location.pathname)) { revoked = identity; user = ''; }
      generation++; epoch++; key = ''; data = null; loading = false; clear(); return;
    }
    if (cached && cached !== identity && cached !== revoked) {
      identity = cached; user = ''; generation++; epoch++; key = ''; data = null; loading = false; clear();
      Promise.resolve(cached).then((id) => {
        if (identity !== cached || revoked === cached || !current() || typeof id !== 'string' || !GZ_FOLDERS.ID.test(id)) return;
        user = id; sync(active, cached);
      }, () => {});
    }
    const next = expected() || '';
    if (next !== key) { generation++; epoch++; key = next; data = null; loading = false; clear(); }
    if (!data) read();
    paint();
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && key && Object.hasOwn(changes, key)) { epoch++; loading = false; data = null; read(); } });
  // Mutation callbacks run before paint, including rows inserted when a folder is unfolded.
  // Ultra changes its page all the time: watched only while on a course's outline, and at most once a frame (a frame's
  // callback still runs before that frame paints, so a hidden folder never shows).
  let frame = 0;
  const observer = new MutationObserver(() => { if (active && !frame) frame = requestAnimationFrame(() => { frame = 0; if (active) sync(active, identity); }); });
  const watch = (on) => { if (on) observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-content-id', 'id', 'aria-label', 'aria-labelledby'] }); else observer.disconnect(); };
  return { sync };
})();
GZ_FOLDER_UI;
