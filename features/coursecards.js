// Ultra's board cards: Glaze DOM over already-loaded metadata, gradebooks and the stored planner. No reader is started.
var GZ_COURSE_CARDS = globalThis.GZ_COURSE_CARDS || (() => {
  const ctx = GZ_CTX, W = GZ_WIDGETS;
  const cards = new Map(), nativeCards = new Map(), mounted = new Set(), watched = new WeakSet();
  let identity = null, notify = () => {}, uid = '', data = {}, prefs = {}, cache = null, L = null, gs = null, gen = 0;
  const get = (area, keys) => new Promise((resolve) => { try { chrome.storage[area].get(keys, (r) => resolve(chrome.runtime.lastError ? null : r)); } catch { resolve(null); } });
  const live = () => { try { return !!chrome.runtime.id && ctx.on(); } catch { return false; } };
  const make = (tag, props = {}, ...children) => { const e = Object.assign(document.createElement(tag), props); e.append(...children.filter(Boolean)); return e; };
  const title = (key) => { const c = W.course(key); return c && (ctx.nickOf(c.id) || cards.get(c.id)?.name) || ctx.t('Course card'); };
  const list = () => {
    const order = [...new Set([...nativeCards.keys(), ...cards.keys()])];
    const groups = new Map();
    for (const id of order) { const c = cards.get(id); if (!c) continue; const rows = groups.get(c.term || '') || []; rows.push({ ...c, key: `course:${location.origin}/${id}` }); groups.set(c.term || '', rows); }
    return [...groups.values()].flat();
  };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const render = () => { if (live()) for (const x of mounted) x(); };
  const read = async () => {
    const n = ++gen, id = uid;
    const [local, sync] = await Promise.all([get('local', ['todoCache', `todo:${location.origin}/${id}`]), get('sync', 'todo')]);
    if (!live() || n !== gen || id !== uid) return;
    data = L.clean(local?.[`todo:${location.origin}/${id}`]);
    cache = local?.todoCache?.key === `todo:${location.origin}/${id}` ? local.todoCache : null;
    prefs = GZ_SANITIZE({ todo: sync?.todo }).todo;
    render();
  };
  const watch = (p, then) => {
    if (!p || typeof p.then !== 'function' || watched.has(p)) return;
    watched.add(p); p.then((v) => { if (live()) then(v); }, () => {});
  };
  const sync = (changed = notify) => {
    notify = changed;
    if (!live()) return;
    const before = JSON.stringify([...cards]);
    // Only this site's records; a second Blackboard on the same device has its own scoped keys.
    for (const [id, c] of Object.entries(ctx.courseList())) if (/^_\d+_\d+$/.test(id) && c.site === location.origin)
      cards.set(id, { ...cards.get(id), id, name: c.name, code: c.code || '', slot: c.slot });
    nativeCards.clear();
    for (const el of document.querySelectorAll('article.course-element-card[data-course-id]')) {
      const id = el.dataset.courseId;
      if (!/^_\d+_\d+$/.test(id)) continue;
      nativeCards.set(id, el);
      const group = el.closest('.term-group, .course-org-list');
      const heading = group?.previousElementSibling?.matches('.course-card-term-name') ? group.previousElementSibling : group?.querySelector('.course-card-term-name');
      cards.set(id, { ...cards.get(id), id, name: el.querySelector('.js-course-title-element, .course-title')?.textContent.trim() || cards.get(id)?.name || id,
        code: el.querySelector('.course-id')?.textContent.trim() || '', term: heading?.textContent.trim() || cards.get(id)?.term || '' });
    }
    const peek = ctx.canvasPeek();
    watch(peek.courses, (rows) => {
      for (const r of rows || []) if (/^_\d+_\d+$/.test(r.courseId)) {
        const c = r.course || {}, old = cards.get(r.courseId);
        cards.set(r.courseId, { id: r.courseId, name: c.name || old?.name || r.courseId, code: c.courseId || old?.code || '', term: c.term?.name || old?.term || '', slot: r.courseCardColorIndex });
      }
      notify(); render();
    });
    if (identity !== peek.me) { identity = peek.me; gen++; uid = ''; cache = null; data = {}; }
    const asked = identity;
    watch(asked, (id) => {
      if (asked !== identity) return;
      if (!/^_\d+_\d+$/.test(String(id))) return;
      uid = String(id);
      ctx.need('lib/todo.js', () => globalThis.GZ_TODO).then(() => { if (live()) { L = GZ_TODO; gs ||= L.gradescope(render); read(); } }, () => {});
    });
    for (const b of peek.books.values()) watch(b.pending, render);
    if (before !== JSON.stringify([...cards])) notify();
    render();
  };
  const fill = (body, api) => {
    const key = W.course(api.id), id = key.id;
    let alive = true;
    const banner = make('div', { className: 'course-banner', ariaHidden: 'true' });
    const link = make('a', { className: 'course-title', href: `${location.origin}/ultra/courses/${id}/outline` });
    link.addEventListener('click', (e) => {
      if (!e.isTrusted || !live() || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      history.pushState(null, '', link.href); dispatchEvent(new PopStateEvent('popstate'));
    });
    const term = make('p', { className: 'gz-course-term' }), code = make('p', { className: 'course-id' });
    const grade = make('p', { className: 'gz-course-grade' });
    const progress = make('progress', { className: 'gz-course-progress', hidden: true });
    progress.setAttribute('aria-label', ctx.t('Course progress'));
    const badges = make('div', { className: 'gz-course-badges' });
    const details = make('div', { className: 'element-details' }, term, link, code, grade, progress, badges);
    const menu = make('button', { type: 'button', className: 'gz-cm-btn', textContent: '⋯' });
    menu.id = `gz-w-cm-${id}`; menu.dataset.cid = id;
    const card = make('article', { className: 'gz-course-card' }, banner, details, menu);
    card.dataset.courseId = id;
    body.append(card);
    const update = () => {
      if (!alive || !live()) return;
      const c = cards.get(id), name = title(api.id);
      setText(link, name); const full = [c?.name, c?.code].filter(Boolean).join(' · '); if (link.title !== full) link.title = full;
      setText(term, c?.term || api.term() || ''); setText(code, c?.code || '');
      if (card.getAttribute('aria-label') !== name) card.setAttribute('aria-label', name);
      const label = ctx.t('Colour and look for {name}', { name });
      if (menu.title !== label) { menu.title = label; menu.setAttribute('aria-label', label); }
      const menuOff = !ctx.settings().enhance.coursemenu || !ctx.courseList()[id];
      if (menu.hidden !== menuOff) menu.hidden = menuOff;
      const native = nativeCards.get(id);
      const source = native?.querySelector('progress, [role="progressbar"]');
      const max = source?.max || +source?.getAttribute('aria-valuemax'), value = source?.value ?? +source?.getAttribute('aria-valuenow');
      const hasProgress = !!ctx.settings().enhance.progress && !!source && Number.isFinite(value) && max > 0;
      if (progress.hidden !== !hasProgress) progress.hidden = !hasProgress;
      if (hasProgress) { if (progress.max !== max) progress.max = max; if (progress.value !== value) progress.value = value; }
      const newBadges = [...(native?.querySelectorAll(':scope > .gz-new') || [])].filter((b) => ctx.settings().enhance[b.dataset.kind === 'grades' ? 'newgrades' : 'newcontent']);
      const badgeText = newBadges.map((b) => b.textContent).join(' · ');
      setText(badges, badgeText);
      const color = GZ_COURSE_VARS(ctx.courseColors()[id]);
      for (const [k, v] of Object.entries(color)) if (card.style.getPropertyValue(k) !== v) card.style.setProperty(k, v);
      const g = uid && ctx.settings().enhance.overall && ctx.canvasPeek().books.get(id)?.overall;
      setText(grade, g?.label || ''); if (grade.hidden !== !g) grade.hidden = !g;
      if (g && grade.dataset.tone !== g.tone) grade.dataset.tone = g.tone;
      if (uid && L && cache && ctx.settings().enhance.cardTasks) {
        ctx.need('features/cardtasks.js', () => globalThis.GZ_CARD_TASKS).then(() => {
          if (alive && live() && ctx.settings().enhance.cardTasks) GZ_CARD_TASKS.render(card, id, details, name, { L, o: prefs, data, cache, uid, extra: gs?.(Date.now(), uid) || [] });
        }, () => {});
      } else card.querySelector('.gz-ct')?.remove();
    };
    mounted.add(update); update();
    ctx.need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => { if (alive && live()) GZ_CARD_UI.paint(); }, () => {});
    return { update, wake: update, stop: () => { alive = false; mounted.delete(update); } };
  };
  chrome.storage.onChanged.addListener((ch, area) => {
    if (!live() || !mounted.size) return;
    if (area === 'local' && (ch.todoCache || ch[`todo:${location.origin}/${uid}`]) || area === 'sync' && ch.todo) { if (L && uid) read(); }
    else if (area === 'sync') render();
  });
  return { sync, list, title, fill };
})();
GZ_COURSE_CARDS;
