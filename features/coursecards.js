// The boards' course cards: Glaze DOM over already-loaded metadata, gradebooks and the stored planner. No reader is started.
// Ultra's on its Courses page and Dashboard; Canvas's on its Dashboard, where a card is drawn as Canvas's own
// (.ic-DashboardCard), so everything Glaze does to Canvas's cards (grades, new items, tasks, bookmarks, styles, the course
// menu) is done to it too, from the course list Canvas's page has already asked for.
var GZ_COURSE_CARDS = globalThis.GZ_COURSE_CARDS || (() => {
  const ctx = GZ_CTX, W = GZ_WIDGETS;
  const ultra = ctx.site === 'ultra';
  const ID = ultra ? /^_\d+_\d+$/ : /^\d{1,20}$/;
  const cards = new Map(), nativeCards = new Map(), canvasEdits = new Map(), mounted = new Set(), watched = new WeakSet();
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
  const render = () => { if (live()) { for (const x of mounted) x(); if (pick) syncPicker(); } };
  // The color a card wears from its course (Ultra's slot, or a pick): its class and variables, on the board and in the
  // Course cards dialog. Only what differs is written.
  const tone = (card, id) => {
    const c = cards.get(id), color = ultra ? GZ_COURSE_VARS(ctx.courseColors()[id]) : GZ_COURSE_VARS(c?.color && { color: c.color });
    const classes = `gz-course-card${/^(10|[1-9])$/.test(c?.slot) ? ` course-color-${c.slot}` : ''}`;
    if (card.className !== classes) card.className = classes;
    for (const k of ['--gz-pick', '--gz-course-raw']) {
      const v = color[k] || '';
      if (card.style.getPropertyValue(k) !== v) { if (v) card.style.setProperty(k, v); else card.style.removeProperty(k); }
    }
  };
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
    watched.add(p); p.then((v) => { if (live()) then(v); else watched.delete(p); }, () => watched.delete(p));
  };
  // Canvas: each course from what its page shows (its cards: the nickname, code, term, color and picture Canvas drew),
  // else the course list the page asked for (content-canvas.js canvasCourses), else what Glaze last saw (seenCourses).
  let canvasRows = null;
  const COLOR = /^(rgba?\([\d.,\s%]+\)|#[0-9a-f]{3,8})$/i;
  const picture = (v) => {
    const u = /^url\("([^"]+)"\)$/.exec(v || '')?.[1];
    try { const p = u && new URL(u, location.origin); return p && /^https?:$/.test(p.protocol) ? p.href : ''; } catch { return ''; }
  };
  const canvasCards = () => {
    const mine = `canvas:${location.origin}/`, list = {}, api = {}, shown = {};
    for (const [k, c] of Object.entries(ctx.courseList())) if (k.startsWith(mine) && ID.test(k.slice(mine.length)) && c?.name) list[k.slice(mine.length)] = c;
    for (const r of canvasRows || []) if (ID.test(String(r?.id)) && typeof r.name === 'string') api[r.id] = r;
    nativeCards.clear();
    for (const el of document.querySelectorAll('.ic-DashboardCard:not([data-gz-tile-card])')) {
      const id = el.querySelector('a[href*="/courses/"]')?.getAttribute('href')?.match(/\/courses\/(\d+)/)?.[1];
      if (!id || !ID.test(id) || nativeCards.has(id)) continue;
      nativeCards.set(id, el);
      const text = (sel) => { const e = el.querySelector(sel); return (e?.getAttribute('title') || e?.textContent || '').trim(); };
      const hero = el.querySelector('.ic-DashboardCard__header_hero');
      shown[id] = { name: text('.ic-DashboardCard__header-title'), code: text('.ic-DashboardCard__header-subtitle'), term: text('.ic-DashboardCard__header-term'),
        color: COLOR.test(hero?.style.backgroundColor || '') ? hero.style.backgroundColor : '', image: picture(el.querySelector('.ic-DashboardCard__header_image')?.style.backgroundImage) };
    }
    for (const id of new Set([...Object.keys(shown), ...Object.keys(api), ...Object.keys(list)])) {
      const n = shown[id] || {}, a = api[id] || {}, l = list[id] || {}, edited = canvasEdits.get(id) || {};
      cards.set(id, { id, name: n.name || edited.name || a.name || l.name || id, code: n.code || a.course_code || l.code || '', term: n.term || a.term?.name || '',
        color: n.color || edited.color || (COLOR.test(l.color || '') ? l.color : ''), image: shown[id] ? n.image : cards.get(id)?.image || '' }); // retain the picture across native card replacement
    }
    if (!canvasRows) watch(ctx.canvasCourses(), (rows) => { canvasRows = Array.isArray(rows) ? rows : []; sync(); });
  };
  // Menu edits must also reach board cards when Canvas is in list view, where no native card can supply them.
  const canvasEdit = (id, patch) => {
    if (ultra || !ID.test(id)) return;
    const next = { ...canvasEdits.get(id), ...patch };
    canvasEdits.set(id, next);
    if (cards.has(id)) cards.set(id, { ...cards.get(id), ...next });
    render();
  };
  const sync = (changed = notify) => {
    notify = changed;
    if (!live()) return;
    const before = JSON.stringify([...cards]);
    if (!ultra) {
      canvasCards();
      if (before !== JSON.stringify([...cards])) notify();
      render();
      return;
    }
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
        cards.set(r.courseId, { id: r.courseId, name: c.name || old?.name || r.courseId, code: c.courseId || old?.code || '', term: c.term?.name || old?.term || '', slot: Number.isInteger(r.courseCardColorIndex) && r.courseCardColorIndex >= 0 ? String(r.courseCardColorIndex % 10 + 1) : old?.slot });
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
    if (before !== JSON.stringify([...cards])) notify();
    render();
  };
  // A Canvas card as Canvas draws one, marked as a board's (data-gz-tile-card): a link to the course, its picture under
  // its color, its name, code and term. Glaze's own additions to Canvas's cards come to it from their usual passes.
  // Keep only the action row's static markup. Work on the root too: a cloned subtree retains inline handlers,
  // and a blocked element must be removed even when it also has an id. Resolve links before checking their course.
  const copyActions = (row, id) => {
    if (!row) return null;
    const copy = row.cloneNode(true);
    const tags = new Set(['NAV', 'DIV', 'A', 'SPAN', 'I', 'B', 'STRONG', 'SMALL', 'SVG', 'G', 'PATH', 'RECT', 'CIRCLE', 'ELLIPSE', 'LINE', 'POLYLINE', 'POLYGON', 'TITLE']);
    const attrs = new Set(['class', 'title', 'role', 'aria-label', 'aria-hidden', 'viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'width', 'height', 'focusable', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2']);
    const nodes = [copy];
    for (let i = 0; i < nodes.length; i++) {
      const e = nodes[i];
      if (!tags.has(e.tagName.toUpperCase())) { if (e === copy) return null; e.remove(); continue; }
      let href = '';
      if (e.tagName.toUpperCase() === 'A') {
        try {
          const u = new URL(e.getAttribute('href') || '', location.origin);
          if (u.origin === location.origin && (u.pathname === `/courses/${id}` || u.pathname.startsWith(`/courses/${id}/`))) href = u.href;
        } catch { /* not a course link */ }
        if (!href) { if (e === copy) return null; e.remove(); continue; }
      }
      for (const a of [...e.attributes]) if (!attrs.has(a.name.toLowerCase()) || (/^(fill|stroke)$/i.test(a.name) && /url\s*\(/i.test(a.value))) e.removeAttribute(a.name);
      if (href) e.setAttribute('href', href);
      nodes.push(...e.children);
    }
    return copy;
  };
  const fillCanvas = (body, id) => {
    let alive = true;
    const hero = make('div', { className: 'ic-DashboardCard__header_hero' });
    hero.setAttribute('aria-hidden', 'true');
    const image = make('div', { className: 'ic-DashboardCard__header_image' }, hero);
    const name = make('span'), heading = make('h2', { className: 'ic-DashboardCard__header-title ellipsis' }, name);
    const code = make('div', { className: 'ic-DashboardCard__header-subtitle ellipsis' }), term = make('div', { className: 'ic-DashboardCard__header-term ellipsis' });
    const link = make('a', { className: 'ic-DashboardCard__link', href: `/courses/${id}` }, make('div', { className: 'ic-DashboardCard__header_content' }, heading, code, term));
    const card = make('div', { className: 'ic-DashboardCard' }, make('div', { className: 'ic-DashboardCard__header' }, image, link));
    card.setAttribute('data-gz-tile-card', '');
    card.dataset.courseId = id;
    body.append(card);
    const set = (el, k, v) => { if ((el.getAttribute(k) || '') !== v) { if (v) el.setAttribute(k, v); else el.removeAttribute(k); } };
    const update = () => {
      if (!alive || !live()) return;
      const c = cards.get(id) || {}, shown = c.name || ctx.t('Course card');
      setText(name, shown); set(heading, 'title', shown); set(card, 'aria-label', shown);
      setText(code, c.code || ''); set(code, 'title', c.code || '');
      setText(term, c.term || ''); set(term, 'title', c.term || '');
      // Canvas's row of links under it (announcements, assignments, discussions, files, with their unread counts): a copy
      // of its own card's while that is on the page, links and pictures only.
      const row = nativeCards.get(id)?.querySelector('.ic-DashboardCard__action-container');
      const was = row?.innerHTML || '';
      if (was !== rowFrom) {
        rowFrom = was;
        const copy = copyActions(row, id);
        if (copy) actions?.replaceWith(copy); else actions?.remove();
        if (copy && !actions) card.append(copy);
        actions = copy || null;
      }
      // Written only when what it comes from changed (a style read back is normalized, so it isn't compared).
      const look = JSON.stringify([c.image, c.color]);
      if (look !== painted) {
        painted = look;
        image.style.backgroundImage = c.image ? `url("${c.image}")` : '';
        hero.style.backgroundColor = c.color || '';
        hero.style.opacity = c.image ? '0.6' : '';
      }
    };
    let painted = '', rowFrom = '', actions = null;
    mounted.add(update); update();
    ctx.need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => { if (alive && live()) GZ_CARD_UI.paint(); }, () => {});
    return { update, wake: update, stop: () => { alive = false; mounted.delete(update); } };
  };
  const fill = (body, api) => {
    const key = W.course(api.id), id = key.id;
    if (!ultra) return fillCanvas(body, id);
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
    menu.setAttribute('aria-haspopup', 'dialog'); menu.setAttribute('aria-expanded', 'false');
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
      if (!menuOff && menu.parentNode !== card) card.append(menu);
      const native = nativeCards.get(id);
      const source = native?.querySelector('progress, [role="progressbar"]');
      const max = source?.max || +source?.getAttribute('aria-valuemax'), value = source?.value ?? +source?.getAttribute('aria-valuenow');
      const hasProgress = !!ctx.settings().enhance.progress && !!source && Number.isFinite(value) && max > 0;
      if (progress.hidden !== !hasProgress) progress.hidden = !hasProgress;
      if (hasProgress) { if (progress.max !== max) progress.max = max; if (progress.value !== value) progress.value = value; }
      const newBadges = [...(native?.querySelectorAll(':scope > .gz-new') || [])].filter((b) => ctx.settings().enhance[b.dataset.kind === 'grades' ? 'newgrades' : 'newcontent']);
      const badgeText = newBadges.map((b) => b.textContent).join(' · ');
      setText(badges, badgeText);
      tone(card, id);
      const g = uid && ctx.settings().enhance.overall && ctx.canvasPeek().books.get(id)?.overall;
      setText(grade, g?.label || ''); if (grade.hidden !== !g) grade.hidden = !g;
      if (g && grade.dataset.tone !== g.tone) grade.dataset.tone = g.tone;
      if (uid && L && cache && ctx.settings().enhance.cardTasks) {
        ctx.need('features/cardtasks.js', () => globalThis.GZ_CARD_TASKS).then(() => {
          if (alive && live() && ctx.settings().enhance.cardTasks) GZ_CARD_TASKS.render(card, id, details, name, { L, o: prefs, data, cache, uid, extra: gs?.(Date.now(), uid) || [] });
        }, () => {});
      } else card.querySelector('.gz-ct')?.remove();
    };
    if (!mounted.size && uid && L) read();
    mounted.add(update); update();
    ctx.need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => { if (alive && live()) GZ_CARD_UI.paint(); }, () => {});
    return { update, wake: update, stop: () => { alive = false; mounted.delete(update); } };
  };
  chrome.storage.onChanged.addListener((ch, area) => {
    // A style saved elsewhere (the card editor, another tab): the open looks follow, once the card painter has let go
    // of what it read before (its own listener, which may run after this one).
    if (pick && live() && area === 'sync' && ch.ucards) setTimeout(() => { if (pick) for (const it of pick.items.values()) it.look?.show(); });
    if (!live() || !mounted.size) return;
    if (area === 'local' && (ch.todoCache || ch[`todo:${location.origin}/${uid}`]) || area === 'sync' && ch.todo) { if (L && uid) read(); }
    else if (area === 'sync') render();
  });
  // ---- the Course cards dialog: features/widgets.js opens it from a board's Add row, while its layout is edited ----
  // Every course this page knows, by term, each a small copy of its card (painted by features/cards.js as the board's
  // cards are, but marked data-gz-card-preview), ticked while it is on this board. A tick, Select all or Select none is one
  // change of the layout (o.set, all its courses at once). A course's Style shows its quick looks below it: its course
  // color, a color, a gradient or a picture (from this computer or a link), saved as features/cards.js's editor saves
  // them, and that editor ("Card style and bookmarks", over this dialog) for everything else.
  // o: { board, on(key) (on this board now), has(key) (a saved record), count(), room() (how many more fit), set(keys, on), back() (the button it came from) }.
  let pick = null; // { dlg, o, list, items: Map(key -> { li, box, card, c, look }), terms: [{ sec, its }], count, empty, all, none, query, keys }
  const cardKey = (c) => `${ultra ? 'ultra' : 'canvas'}:${location.origin}/${c.id}`;
  const UI = () => globalThis.GZ_CARD_UI;
  const b = (text, run, props = {}, label = '') => {
    const e = make('button', { type: 'button', className: 'gz-w-btn gz-w-small', textContent: text, ...props });
    if (label) { e.setAttribute('aria-label', label); e.title = label; }
    e.addEventListener('click', run);
    return e;
  };
  // Only what differs is written: the page's own observer sees nothing of an unchanged pass.
  const put = (el, k, v) => { if (el[k] !== v) el[k] = v; };
  const shownItems = () => [...pick.items.values()].filter((it) => !it.li.hidden);
  // Up to the room left, in the order shown; a course already on the board is left as it is.
  const turn = (list, on) => {
    let room = pick.o.room();
    const keys = list.filter((it) => {
      if (pick.o.on(it.c.key) === on) return false;
      if (!on || pick.o.has(it.c.key)) return true;
      if (!room) return false;
      room--; return true;
    }).map((it) => it.c.key);
    if (keys.length) pick.o.set(keys, on);
    syncPicker();
  };
  // A course's quick looks, made the first time its Style is pressed.
  const looks = (it, styleBtn) => {
    const { c } = it, key = cardKey(c), name = title(c.key), uid = c.id.replace(/\W/g, '');
    const panel = make('div', { className: 'gz-ccm-look', id: `gz-ccm-look-${uid}` });
    const kinds = make('div', { className: 'gz-ccm-kinds' });
    kinds.setAttribute('role', 'radiogroup');
    kinds.setAttribute('aria-label', ctx.t('Card for {name}', { name }));
    const radios = [['', 'Course color'], ['solid', 'Color'], ['gradient', 'Gradient'], ['image', 'Picture']].map(([v, label]) => {
      const r = make('input', { type: 'radio', name: `gz-ccm-kind-${uid}`, value: v });
      kinds.append(make('label', {}, r, ctx.t(label)));
      return r;
    });
    const color = make('input', { type: 'color' });
    const colorRow = make('label', { className: 'gz-ccm-field' }, make('span', { textContent: ctx.t('Color') }), color);
    const file = make('input', { type: 'file', accept: 'image/*', hidden: true });
    const choose = b(ctx.t('Choose a picture from this computer'), () => file.click());
    const url = make('input', { type: 'url', placeholder: 'https://…', spellcheck: false });
    url.setAttribute('translate', 'no');
    const pictureRow = make('div', { className: 'gz-ccm-picture' }, choose, file, make('label', { className: 'gz-ccm-field' }, make('span', { textContent: ctx.t('Picture address') }), url));
    const more = b(ctx.t('Card style and bookmarks'), () => UI()?.open(key, styleBtn));
    const note = make('p', { className: 'gz-ccm-note', hidden: true });
    note.setAttribute('role', 'alert');
    panel.append(kinds, colorRow, pictureRow, note, more);
    // The controls follow the style as kept; a picture chosen as the kind waits for its picture (as in the editor).
    let kind = '', asking = 0;
    const show = async (s) => {
      const n = ++asking;
      if (s === undefined) s = await UI()?.styleOf(key);
      if (n !== asking || !pick) return;
      kind = s?.k || '';
      for (const r of radios) r.checked = r.value === kind;
      colorRow.hidden = kind !== 'solid' && kind !== 'gradient';
      pictureRow.hidden = kind !== 'image';
      if (s?.c && color.value !== s.c) color.value = s.c;
      url.value = s?.u || '';
    };
    // One save (features/cards.js), then what it says: the reason when it isn't kept.
    const run = async (save) => {
      const ui = UI();
      if (!ui) return;
      note.hidden = true;
      const r = await save(ui);
      if (r.stale) return;
      note.textContent = ui.say(r);
      note.hidden = r.ok;
      if (r.ok) show(r.style);
    };
    for (const r of radios) r.addEventListener('change', () => {
      if (r.value !== 'image') { run((ui) => ui.setKind(key, r.value)); return; }
      kind = 'image'; colorRow.hidden = true; pictureRow.hidden = false; choose.focus();
    });
    for (const event of ['input', 'change']) color.addEventListener(event, () => run((ui) => ui.setKind(key, kind === 'gradient' ? 'gradient' : 'solid', color.value, event === 'input')));
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) run((ui) => ui.setPicture(key, f)); });
    url.addEventListener('change', () => { const v = url.value.trim(); if (v) run((ui) => ui.setLink(key, v)); });
    it.li.append(panel);
    return { panel, show, first: () => radios.find((r) => r.checked) || radios[0] };
  };
  const item = (c) => {
    const name = title(c.key);
    const box = make('input', { type: 'checkbox' });
    const card = make('article', {}, make('div', { className: 'course-banner', ariaHidden: 'true' }),
      make('div', { className: 'element-details' }, make('span', { className: 'course-title', textContent: name }), make('span', { className: 'course-id', textContent: c.code })));
    card.dataset.courseId = c.id;
    card.setAttribute('data-gz-card-preview', '');
    tone(card, c.id);
    const cell = make('div', { className: 'gz-ccm-card' }, make('label', { className: 'gz-ccm-pick' }, box, card));
    const li = make('li', { className: 'gz-ccm-item' }, cell);
    const it = { li, box, card, c, look: null };
    const styleBtn = b(ctx.t('Style'), () => {
      it.look ||= looks(it, styleBtn);
      const open = styleBtn.getAttribute('aria-expanded') !== 'true';
      it.look.panel.hidden = !open;
      li.toggleAttribute('data-open', open);
      styleBtn.setAttribute('aria-expanded', String(open));
      if (open) it.look.show().then(() => it.look?.first().focus());
    }, { className: 'gz-w-btn gz-w-small gz-ccm-style', disabled: !UI() });
    styleBtn.setAttribute('aria-expanded', 'false');
    styleBtn.setAttribute('aria-controls', `gz-ccm-look-${c.id.replace(/\W/g, '')}`);
    styleBtn.setAttribute('aria-label', ctx.t('Style of {name}', { name }));
    cell.append(styleBtn);
    box.addEventListener('change', () => turn([it], box.checked));
    return it;
  };
  const fillPicker = () => {
    const rows = list(), groups = new Map(), previous = pick.items, focus = document.activeElement;
    for (const c of rows) { const g = groups.get(c.term) || []; g.push(c); groups.set(c.term, g); }
    pick.items = new Map();
    pick.terms = [];
    pick.list.replaceChildren(...[...groups].map(([term, cs], n) => {
      const its = cs.map((c) => {
        const it = previous.get(c.key) || item(c);
        it.c = c;
        setText(it.card.querySelector('.course-title'), title(c.key));
        setText(it.card.querySelector('.course-id'), c.code || '');
        it.li.querySelector('.gz-ccm-style').setAttribute('aria-label', ctx.t('Style of {name}', { name: title(c.key) }));
        it.look?.panel.querySelector('[role="radiogroup"]').setAttribute('aria-label', ctx.t('Card for {name}', { name: title(c.key) }));
        return it;
      });
      for (const it of its) pick.items.set(it.c.key, it);
      const name = term || ctx.t('Other courses');
      const head = make('h3', { id: `gz-ccm-t${n}`, textContent: name });
      const sec = make('section', { className: 'gz-ccm-term' }, make('div', { className: 'gz-ccm-termhead' }, head,
        b(ctx.t('Select all'), () => turn(its.filter((it) => !it.li.hidden), true), {}, ctx.t('Select all in {term}', { term: name })),
        b(ctx.t('Select none'), () => turn(its.filter((it) => !it.li.hidden), false), {}, ctx.t('Select none in {term}', { term: name }))),
      make('ul', { className: 'gz-ccm-grid' }, ...its.map((it) => it.li)));
      sec.setAttribute('role', 'group');
      sec.setAttribute('aria-labelledby', head.id);
      pick.terms.push({ sec, its });
      return sec;
    }));
    pick.keys = JSON.stringify(rows.map((c) => [c, title(c.key)]));
    if (focus?.isConnected && focus !== document.activeElement) focus.focus({ preventScroll: true });
    UI()?.paint();
  };
  // What the dialog shows follows the board and the courses: ticks, what still fits, the search.
  const syncPicker = () => {
    if (!pick?.dlg.isConnected) return;
    if (JSON.stringify(list().map((c) => [c, title(c.key)])) !== pick.keys) fillPicker();
    const room = pick.o.room(), q = pick.query.value.trim().toLocaleLowerCase();
    let on = 0;
    for (const it of pick.items.values()) {
      const there = pick.o.on(it.c.key);
      on += there;
      put(it.box, 'checked', there);
      const full = !there && !room && !pick.o.has(it.c.key);
      put(it.box, 'disabled', full);
      if (it.li.hasAttribute('data-on') !== there) it.li.toggleAttribute('data-on', there);
      put(it.box, 'title', full ? ctx.t('Up to {n} course cards per board.', { n: W.COURSE_MAX }) : '');
      put(it.li, 'hidden', !!q && ![title(it.c.key), it.c.name, it.c.code, it.c.term].some((x) => String(x || '').toLocaleLowerCase().includes(q)));
      tone(it.card, it.c.id);
    }
    for (const { sec, its } of pick.terms) put(sec, 'hidden', its.every((it) => it.li.hidden));
    const shown = shownItems();
    put(pick.empty, 'hidden', !!shown.length);
    put(pick.empty, 'textContent', ctx.t(pick.items.size ? 'No courses match.' : ultra ? 'No courses yet. They show here once Blackboard has listed them.' : 'No courses yet. They show here once Canvas has listed them.'));
    put(pick.all, 'disabled', shown.every((it) => it.box.checked || it.box.disabled));
    put(pick.none, 'disabled', !shown.some((it) => it.box.checked));
    // The first time on the Courses page, every course is one click away.
    put(pick.all, 'className', `gz-w-btn gz-w-small${pick.o.board !== 'dash' && !on ? ' gz-w-main' : ''}`);
    put(pick.count, 'textContent', ctx.t('On this board: {on}. Room for {n} more.', { on: pick.o.count?.() ?? on, n: room }));
  };
  const closePicker = (refocus = true) => {
    const p = pick;
    if (!p) return;
    const pending = UI()?.flush() || [];
    if (pending.length && refocus) { Promise.all(pending).then((rs) => { if (pick === p && rs.every((r) => r.ok)) closePicker(refocus); }); return; }
    for (const it of p.items.values()) UI()?.cancel(cardKey(it.c));
    pick = null;
    UI()?.closeFor(p.dlg);
    if (p.dlg.open) p.dlg.close();
    p.dlg.remove();
    if (refocus) p.o.back()?.focus({ preventScroll: true });
  };
  const openPicker = (o) => {
    closePicker(false);
    const dlg = make('dialog', { id: 'gz-ccm', className: 'gz-w-dialog' });
    dlg.setAttribute('aria-labelledby', 'gz-ccm-h');
    dlg.setAttribute('aria-describedby', 'gz-ccm-d');
    const query = make('input', { type: 'search', placeholder: ctx.t('Find a course'), autocomplete: 'off', spellcheck: false });
    query.setAttribute('aria-label', ctx.t('Find a course'));
    const count = make('p', { className: 'gz-ccm-count' });
    count.setAttribute('role', 'status');
    const empty = make('p', { className: 'gz-w-faint gz-ccm-empty', hidden: true });
    const listEl = make('div', { className: 'gz-ccm-list' });
    pick = { dlg, o, list: listEl, items: new Map(), terms: [], count, empty, query, keys: null };
    pick.all = b(ctx.t('Select all'), () => turn(shownItems(), true));
    pick.none = b(ctx.t('Select none'), () => turn(shownItems(), false));
    query.addEventListener('input', syncPicker);
    const x = b('×', () => closePicker(), { className: 'gz-w-btn gz-w-icon' }, ctx.t('Close'));
    dlg.append(make('header', { className: 'gz-w-row' }, make('h2', { id: 'gz-ccm-h', textContent: ctx.t('Course cards') }), x),
      make('p', { className: 'gz-w-faint', id: 'gz-ccm-d', textContent: ctx.t('Tick the courses to show as cards on this board. Style changes how a card looks, wherever it shows.') }),
      make('div', { className: 'gz-ccm-tools' }, query, pick.all, pick.none), count, listEl, empty,
      make('footer', { className: 'gz-w-row' }, make('span', { className: 'gz-w-faint', textContent: ctx.t('Up to {n} course cards per board.', { n: W.COURSE_MAX }) }),
        b(ctx.t('Done'), () => closePicker(), { className: 'gz-w-btn gz-w-main' })));
    // Esc closes it (the dialog's own cancel), as do a press on the backdrop, × and Done; the focus goes back.
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closePicker(); });
    dlg.addEventListener('close', () => { if (pick?.dlg === dlg) closePicker(); });
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closePicker();
    });
    document.body.append(dlg);
    fillPicker();
    syncPicker();
    dlg.showModal();
    query.focus();
    // The previews wear their styles once the card painter is in (it is on any page with board cards).
    ctx.need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => {
      if (pick?.dlg !== dlg) return;
      for (const it of pick.items.values()) it.li.querySelector('.gz-ccm-style').disabled = false;
      UI().paint();
    }, () => {});
  };

  // Canvas: the courses its card view shows now, in its order (an empty list in its list view).
  const shown = () => [...nativeCards.keys()].map((id) => list().find((c) => c.id === id)).filter(Boolean);
  return { sync, list, shown, title, fill, canvasEdit, picker: { open: openPicker, sync: syncPicker, close: closePicker } };
})();
GZ_COURSE_CARDS;
