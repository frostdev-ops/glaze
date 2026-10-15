// Folder previews (enhance.previews), loaded on demand: content.js loads this the first time the pointer rests on (or, on
// Canvas, focus reaches) a folder or module row, and hands it that event (on). Hovering a collapsed folder lists what is
// inside, with each item's state and due date, from the same content API Ultra's own outline uses (same origin, the
// user's own session; nothing leaves Blackboard), or on Canvas from its modules and folders API. Answers are kept for a
// minute so moving back and forth costs nothing. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_PEEK = globalThis.GZ_PEEK || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, locale, canvasCourseId, courseId, toggleOf, canvasPeek, moduleItems } = ctx;
  const peeks = new Map();
  const children = (cid, fid) => {
    const key = `${cid}/${fid}`;
    const hit = peeks.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    // Absolute URL: Ultra's <base href> points at its CDN, so a relative one would go there.
    const p = fetch(`${location.origin}/learn/api/v1/courses/${cid}/contents/${fid}/children`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j?.results || null).catch(() => null);
    peeks.set(key, { at: Date.now(), p });
    return p;
  };
  const canvasPeekFor = async (item) => {
    const cid = canvasCourseId();
    const mid = item.closest('.context_module[data-module-id]')?.dataset.moduleId;
    if (mid) return (await moduleItems(cid, mid)).map((c) => ({ title: c.title,
      state: c.content_details?.locked_for_user ? 'Locked' : c.completion_requirement?.completed ? 'Completed' : c.completion_requirement ? 'Todo' : 'None',
      genericReadOnlyData: { dueDate: c.content_details?.due_at } }));
    const url = new URL(item.href, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith(`/courses/${cid}/files/folder/`)) return null;
    let path;
    try { path = decodeURIComponent(url.pathname.split('/files/folder/')[1]).replace(/&#37;/g, '%').replace(/\/$/, ''); } catch { return null; }
    const folders = await canvasPeek(`/courses/${cid}/folders`);
    const folder = folders.find((f) => f.full_name.replace(/^[^/]+\/?/, '') === path);
    if (!folder || folder.locked_for_user || folder.hidden_for_user) return null;
    const [dirs, files] = await Promise.all([canvasPeek(`/folders/${folder.id}/folders`), canvasPeek(`/folders/${folder.id}/files`)]);
    return [...dirs, ...files].filter((f) => !f.hidden_for_user).map((f) => ({ title: f.display_name || f.name, state: f.locked_for_user ? 'Locked' : 'None' }));
  };
  let peek = null;
  let peekFor = null;
  let peekTimer = 0;
  const hidePeek = () => {
    clearTimeout(peekTimer);
    if (!ultra && peekFor) {
      const ids = (peekFor.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== 'gz-peek');
      if (ids.length) peekFor.setAttribute('aria-describedby', ids.join(' ')); else peekFor.removeAttribute('aria-describedby');
    }
    peek?.remove(); peek = null; peekFor = null;
  };
  const STATE = { Completed: 'done', Started: 'started', None: 'none', Locked: 'locked' };
  const showPeek = (item, list) => {
    if (!list?.length || peekFor !== item || !item.isConnected || !ctx.settings().enhance.previews || !ctx.on()) return;
    const r = item.getBoundingClientRect();
    if (!ultra && (r.bottom < 0 || r.top > innerHeight)) return;
    peek?.remove();
    peek = document.createElement('div');
    peek.id = 'gz-peek';
    peek.setAttribute('role', 'tooltip');
    const done = list.filter((c) => c.state === 'Completed').length;
    const head = document.createElement('div');
    head.className = 'gz-peek-head';
    head.textContent = t(!ultra && list.every((c) => c.state === 'None' || c.state === 'Locked') ? '{n} items' : '{n} items · {done} done', { n: list.length, done });
    const ul = document.createElement('ul');
    const now = new Date();
    for (const c of list.slice(0, 8)) {
      const li = document.createElement('li');
      li.dataset.state = STATE[c.state] || 'todo';
      const title = document.createElement('span');
      title.className = 'gz-peek-title';
      title.textContent = c.title;
      li.append(title);
      const due = c.genericReadOnlyData?.dueDate;
      if (due) {
        const d = document.createElement('span');
        d.className = 'gz-peek-due';
        d.textContent = GZ_PAGE.describe(new Date(due), true, now, locale()).rel;
        li.append(d);
      }
      if (!ultra && c.state !== 'None') li.setAttribute('aria-label', `${c.title} · ${t(c.state === 'Completed' ? 'Done' : c.state === 'Locked' ? 'Locked' : 'Not complete')}${due ? ` · ${li.querySelector('.gz-peek-due').textContent}` : ''}`);
      ul.append(li);
    }
    peek.append(head, ul);
    if (list.length > 8) {
      const more = document.createElement('div');
      more.className = 'gz-peek-more';
      more.textContent = t('and {n} more', { n: list.length - 8 });
      peek.append(more);
    }
    document.body.append(peek);
    if (!ultra) item.setAttribute('aria-describedby', `${item.getAttribute('aria-describedby') || ''} gz-peek`.trim());
    const w = peek.getBoundingClientRect();
    const right = r.right + 12 + w.width < innerWidth;
    peek.style.left = `${right ? r.right + 12 : Math.max(8, r.right - w.width)}px`;
    peek.style.top = `${Math.min(Math.max(8, right ? r.top : r.bottom + 8), innerHeight - w.height - 8)}px`;
  };
  const onPeek = (e) => {
    if (!ctx.settings().enhance.previews || !ctx.on() || !(e.target instanceof Element)) return;
    if (!ultra) {
      const item = e.target.closest('.context_module .expand_module_link, a[href*="/files/folder/"]');
      if (item === peekFor) return;
      hidePeek();
      if (!canvasCourseId() || !item || !item.getClientRects().length || (item.matches('.expand_module_link') && !item.closest('.context_module').classList.contains('collapsed_module'))) return;
      peekFor = item;
      peekTimer = setTimeout(() => canvasPeekFor(item).then((list) => showPeek(item, list)).catch(() => {}), e.type === 'focusin' ? 150 : 550);
      return;
    }
    const item = e.target.closest('.content-list-item[data-content-id]');
    if (item === peekFor) return;
    hidePeek();
    // Collapsed folders only: an open one already shows its contents.
    const cid = courseId();
    if (!cid || toggleOf(item)?.getAttribute('aria-expanded') !== 'false') return;
    peekFor = item;
    const fid = item.getAttribute('data-content-id');
    peekTimer = setTimeout(() => children(cid, fid).then((list) => showPeek(item, list)), 550);
  };
  document.addEventListener('pointerover', onPeek, { capture: true, passive: true });
  document.addEventListener('focusin', (e) => { if (!ultra) onPeek(e); }, true);
  document.addEventListener('pointerout', (e) => { if (!ultra && peekFor && !peekFor.contains(e.relatedTarget)) hidePeek(); }, true);
  document.addEventListener('focusout', (e) => { if (!ultra && e.target === peekFor) hidePeek(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePeek(); }, true);
  for (const ev of ['pointerdown', 'wheel']) document.addEventListener(ev, hidePeek, { capture: true, passive: true });
  document.addEventListener('scroll', () => {
    // Tabbing to a header can scroll it into view after focusin; let its preview settle there.
    const target = !ultra && peekFor === document.activeElement && peekFor;
    hidePeek();
    if (target) onPeek({ target, type: 'focusin' });
  }, { capture: true, passive: true });

  return {
    on: onPeek,
    hide: hidePeek,
    // Each pass: switched off, or its row gone.
    sync: () => { if (!ctx.settings().enhance.previews || (peekFor && !peekFor.isConnected)) hidePeek(); },
  };
})();

GZ_PEEK;
