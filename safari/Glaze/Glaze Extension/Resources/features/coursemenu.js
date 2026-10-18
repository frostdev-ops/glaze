// The course menu's popover (enhance.coursemenu), loaded on demand: content.js puts the button on each course card
// (syncCourseMenu) and loads this when one is first pointed at, focused or pressed; a press then opens it (toggle).
// The popover holds the course's nickname, color, tint and look: the editor's course row (options.js renderCourses)
// written to the same settings.courses keys, so the card and the editor always agree, and every card and page repaints
// from settings as it does after an edit made there. It lives in <body>, not in the card: a press in it can't reach the
// card (a link) behind it. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_COURSE_MENU = globalThis.GZ_COURSE_MENU || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  // Moodle: tint and look only (the color is Moodle's own, and the card styles are Canvas's).
  const moodle = ctx.site === 'moodle';
  const { t, make, nickOf, cardUI, courseColor, courseColors, varText } = ctx;
  const C = GZ_COLOR;
  // Ultra's course-color-1…10 in order, by hue, for the swatches' names.
  const TONES = ['Purple', 'Cyan', 'Yellow', 'Orange', 'Mint', 'Pink', 'Green', 'Teal', 'Magenta', 'Blue'];
  let menu = null; // { box, btn, cid, nick, edited, note, custom, reset, tint, grid, sw, looks } while the popover is open

  // -- edits: painted here at once, saved a moment later --
  // Each edit is kept by what it changes and applied again to the settings at save time, so one that an echo of an
  // earlier save (or another tab) overwrote in between still goes out, and a color dragged for a second is one write
  // (sync storage allows ~120 a minute).
  const edits = new Map();
  let editTimer = 0;
  // Roll back only our still-current batch; a newer value from another tab wins.
  let editStored = null;
  let editCourses = null;
  const refuseEdits = () => {
    edits.clear();
    const restore = ctx.settings().courses === editCourses;
    editCourses = null;
    if (restore) ctx.setCourses(editStored);
    menuNote(t('Too much to sync. Shorten a nickname or clear one.'));
    if (menu) paintMenu();
    return false;
  };
  const saveEdits = () => {
    clearTimeout(editTimer);
    editTimer = 0;
    if (!edits.size) return true;
    const c = structuredClone(ctx.settings().courses);
    for (const fn of edits.values()) fn(c);
    if (GZ_SYNC_BYTES('courses', c) > GZ_SYNC_ITEM_MAX) return refuseEdits();
    edits.clear();
    editCourses = null;
    try {
      chrome.storage.sync.set({ version: 2, courses: c }, () => { if (chrome.runtime.lastError) menuNote(t('Not saved. Try again in a moment.')); });
    } catch { /* extension reloaded under the tab */ }
    return true;
  };
  // An edit that would take the courses item past what sync storage keeps (8 KB) is refused, said in the menu,
  // and leaves the page as it was: false.
  const editCourse = (key, fn, soon = false) => {
    const c = structuredClone(ctx.settings().courses);
    for (const edit of edits.values()) edit(c);
    fn(c);
    if (GZ_SYNC_BYTES('courses', c) > GZ_SYNC_ITEM_MAX) return refuseEdits();
    menuNote('');
    if (ctx.settings().courses !== editCourses) editStored = ctx.settings().courses;
    editCourses = c;
    ctx.setCourses(c);
    edits.set(key, fn);
    clearTimeout(editTimer);
    if (soon) { editTimer = setTimeout(saveEdits, 500); return true; }
    return saveEdits();
  };
  // A short line in the open menu, read out when it changes; '' clears it.
  const menuNote = (text) => { if (menu) { menu.note.textContent = text; menu.note.hidden = !text; } };
  addEventListener('pagehide', saveEdits);

  // -- the popover --
  const swatches = () => [
    ...TONES.map((name, i) => [name, courseColor(String(i + 1), '--gz-pick:initial') || GZ_SLOT_COLORS[i + 1]]),
    ['Accent', GZ_ACTIVE_COLORS(ctx.settings(), matchMedia('(prefers-color-scheme: dark)').matches)['--gz-accent']],
  ];
  // Everything that follows the settings: what is picked, ticked and worn.
  const paintMenu = (m = menu) => {
    const { cid } = m;
    const c = ctx.settings().courses;
    m.tint.checked = GZ_COURSE_TINTED(c, cid, ctx.courseList());
    for (const b of m.looks) b.setAttribute('aria-pressed', String((c.looks[cid] || '') === b.dataset.look));
    if (!ultra) return;
    const cur = courseColors()[cid];
    if (!cur) return;
    // The color the cards show for it now (a pick as is, else Ultra's toned): the custom picker starts there.
    const now = courseColor(ctx.courseList()[cid].slot, varText(GZ_COURSE_VARS(cur))) || cur.color;
    for (const b of m.sw) b.setAttribute('aria-pressed', String(cur.picked && C.same(C.parse(b.dataset.hex), C.parse(cur.color))));
    m.custom.toggleAttribute('data-on', cur.picked && !m.sw.some((b) => b.getAttribute('aria-pressed') === 'true'));
    if (m.custom.value !== now) m.custom.value = now; // not while it is being dragged to the same
    // The nickname as kept, unless the student is changing it: another tab's save shows here, and isn't undone.
    if (!m.edited && m.nick.value !== (c.names[cid] || '')) m.nick.value = c.names[cid] || '';
    m.reset.hidden = !cur.picked;
  };
  const placeMenu = () => {
    if (!menu) return;
    const { box, btn } = menu;
    const r = btn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return closeMenu(false, true);
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = r.top - h - 6; // above, when there is no room below
    box.style.left = `${Math.min(Math.max(8, r.right - w), innerWidth - w - 8)}px`;
    box.style.top = `${Math.min(Math.max(8, top), Math.max(8, innerHeight - h - 8))}px`;
    box.style.setProperty('--gz-cm-origin', top < r.top ? 'bottom right' : 'top right');
  };
  // One tab stop per group; arrow keys walk it.
  const rove = (group, active) => { for (const b of group.querySelectorAll('button, input')) b.tabIndex = b === active ? 0 : -1; };
  // Only what the student typed: an untouched field may be behind a nickname saved elsewhere since. One that doesn't
  // fit stays in the field, still theirs to shorten, with the menu's note saying why.
  const commitNick = (m = menu) => {
    if (!m?.edited) return true;
    const v = m.nick.value;
    const was = ctx.settings().courses.names[m.cid] || '';
    const c = structuredClone(ctx.settings().courses);
    GZ_COURSE_EDIT.name(c, m.cid, v);
    if ((c.names[m.cid] || '') !== was && !editCourse(`name ${m.cid}`, (x) => GZ_COURSE_EDIT.name(x, m.cid, v))) return false;
    m.edited = false;
    m.nick.value = ctx.settings().courses.names[m.cid] || ''; // as kept: one trimmed line
    return true;
  };
  const closeMenu = (refocus = true, teardown = false) => {
    const m = menu;
    if (!m) return true;
    if (teardown) menu = null; // no dialog to keep when its card or the extra has gone
    if ((!commitNick(m) || !saveEdits()) && !teardown) return false;
    menu = null;
    m.box.remove();
    m.btn.setAttribute('aria-expanded', 'false');
    if (refocus && m.btn.isConnected) m.btn.focus({ preventScroll: true });
    return true;
  };
  const openMenu = (btn) => {
    const cid = btn.dataset.cid;
    const real = ctx.courseList()[cid]?.name;
    if (!real) return;
    if (!closeMenu(false)) return;
    const name = nickOf(cid) || real;
    const box = make('div', { id: 'gz-cm' });
    for (const [k, v] of [['role', 'dialog'], ['aria-modal', 'true'], ['aria-label', t(ultra ? 'Colour and look for {name}' : 'Tint and look for {name}', { name })]]) box.setAttribute(k, v);
    const cap = (text, id) => make('div', { className: 'gz-cm-cap', id, textContent: text });
    const group = (labelledby, ...kids) => {
      const g = make('div', {}, ...kids);
      g.setAttribute('role', 'group');
      g.setAttribute('aria-labelledby', labelledby);
      g.dataset.roving = '';
      return g;
    };

    // The nickname: what the field shows empty is the real name. Saved on Enter, on leaving it, and on closing.
    const nick = make('input', { type: 'text', id: 'gz-cm-nick', className: 'gz-cm-nick', maxLength: GZ_NICK_MAX, placeholder: real, title: real, value: ctx.settings().courses.names[cid] || '', autocomplete: 'off', spellcheck: false });
    nick.addEventListener('input', () => { if (menu?.nick === nick) menu.edited = true; });
    nick.addEventListener('change', () => commitNick());
    const note = make('p', { className: 'gz-cm-note', hidden: true });
    note.setAttribute('role', 'status');

    // Colors: Ultra's ten as Glaze tones them (the very colors its cards show: a pick is used as is, so a swatch picked
    // is what its card then shows), and the theme's accent. Ultra's ten cover the hues except red and grey, which the
    // custom picker is for. Then Reset, back to Blackboard's own.
    const sw = (ultra ? swatches() : []).map(([label, hex]) => {
      const b = make('button', { type: 'button', className: 'gz-cm-sw', title: t(label) });
      b.setAttribute('aria-label', t(label));
      b.dataset.hex = hex;
      b.style.backgroundColor = hex;
      b.addEventListener('click', () => editCourse(`color ${cid}`, (c) => GZ_COURSE_EDIT.color(c, cid, hex, ctx.courseList())));
      return b;
    });
    const custom = make('input', { type: 'color', className: 'gz-cm-custom' });
    custom.setAttribute('aria-label', t('Colour for {name}', { name }));
    custom.addEventListener('input', () => { const hex = custom.value; editCourse(`color ${cid}`, (c) => GZ_COURSE_EDIT.color(c, cid, hex, ctx.courseList()), true); });
    custom.addEventListener('change', saveEdits);
    const grid = group('gz-cm-colors', ...sw, custom);
    grid.className = 'gz-cm-grid';
    const reset = make('button', { type: 'button', className: 'gz-cm-reset', textContent: t('Reset') });
    reset.addEventListener('click', () => {
      editCourse(`color ${cid}`, (c) => GZ_COURSE_EDIT.color(c, cid, null, ctx.courseList()));
      grid.querySelector('[tabindex="0"]').focus(); // the button hides, so focus can't stay on it
    });

    // Tint. A tick does nothing while the master switch (courses.tint) is off, so ticking turns it on too
    // (GZ_COURSE_EDIT.tint); unticking leaves the master alone.
    const tint = make('input', { type: 'checkbox' });
    tint.addEventListener('change', () => { const on = tint.checked; editCourse(`tint ${cid}`, (c) => GZ_COURSE_EDIT.tint(c, cid, on, ctx.courseList())); });

    // Look: the student's own theme, or one of the eight, drawn as the popup's look cards are. Look names are names.
    const looks = [['', null], ...GZ_LOOKS.map((L) => [L.name, L])].map(([look, L]) => {
      const b = make('button', { type: 'button', className: 'gz-cm-look', textContent: L ? L.name : t('Your theme') });
      b.dataset.look = look;
      if (L) {
        const c = L.colors;
        const tone = L.bg.colors?.length ? L.bg.colors : L.bg.kind === 'solid' ? [c['--gz-surface-2']] : [c['--gz-accent'], c['--gz-accent-hi']];
        b.setAttribute('translate', 'no');
        b.style.color = c['--gz-ink'];
        b.style.borderColor = c['--gz-line-strong'];
        b.style.background = `linear-gradient(90deg, ${c['--gz-accent']} 0 3px, transparent 3px), linear-gradient(120deg, ${c['--gz-surface']} 45%, ${tone.join(', ')})`;
      }
      b.addEventListener('click', () => editCourse(`look ${cid}`, (c) => GZ_COURSE_EDIT.look(c, cid, look)));
      return b;
    });
    const lookGrid = group('gz-cm-look', ...looks);
    lookGrid.className = 'gz-cm-looks';

    if (ultra) box.append(make('label', { className: 'gz-cm-cap', htmlFor: 'gz-cm-nick', textContent: t('Nickname') }), nick, note,
      make('div', { className: 'gz-cm-colorhead' }, cap(t('Colors'), 'gz-cm-colors'), reset), grid,
      make('label', { className: 'gz-cm-tint' }, tint, t('Tint pages inside this course')),
      cap(t('Look'), 'gz-cm-look'), lookGrid);
    else if (moodle) box.append(note, make('label', { className: 'gz-cm-tint' }, tint, t('Tint pages inside this course')), cap(t('Look'), 'gz-cm-look'), lookGrid);
    else box.append(note, make('p', { className: 'gz-cm-note', textContent: t('Change the colour and nickname in Canvas’s own card menu.') }),
      make('label', { className: 'gz-cm-tint' }, tint, t('Tint pages inside this course')), cap(t('Look'), 'gz-cm-look'), lookGrid,
      make('button', { type: 'button', className: 'gz-cm-more', textContent: t('Card style and bookmarks'), onclick: () => closeMenu(false) && cardUI((m) => m.open(cid)) }));
    if (ultra) box.append(make('button', { type: 'button', className: 'gz-cm-more', textContent: t('Card style and bookmarks'), onclick: () => closeMenu(false) && cardUI((m) => m.open(cid)) }));
    document.body.append(box);
    menu = { box, btn, cid, nick, edited: false, note, custom, reset, tint, grid, sw, looks };
    btn.setAttribute('aria-expanded', 'true');
    paintMenu();
    rove(grid, sw.find((b) => b.getAttribute('aria-pressed') === 'true') || sw[0]);
    rove(lookGrid, looks.find((b) => b.getAttribute('aria-pressed') === 'true') || looks[0]);
    placeMenu();
    (ultra ? grid.querySelector('[tabindex="0"]') : tint).focus({ preventScroll: true });
  };

  // Esc closes; Tab stays inside; arrows walk a group; Enter in the nickname field saves it.
  const ARROWS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -2, End: 2 };
  document.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (!(e.target instanceof Element) || !menu.box.contains(e.target)) return;
    if (e.key === 'Enter' && e.target === menu.nick) { e.preventDefault(); if (commitNick()) saveEdits(); return; }
    if (e.key === 'Tab') {
      const tabs = [...menu.box.querySelectorAll('button, input')].filter((x) => x.tabIndex >= 0 && x.getClientRects().length);
      const to = tabs[tabs.indexOf(e.target) + (e.shiftKey ? -1 : 1)] || tabs[e.shiftKey ? tabs.length - 1 : 0];
      e.preventDefault();
      to.focus();
      return;
    }
    const g = e.target.closest('[data-roving]');
    const step = ARROWS[e.key];
    if (!g || !step || e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...g.querySelectorAll('button, input')];
    // Up and down move a row: as many along as the first row holds.
    const per = items.filter((b) => b.offsetTop === items[0].offsetTop).length;
    const at = items.indexOf(e.target);
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const next = Math.abs(step) === 2 ? (step < 0 ? 0 : items.length - 1) : Math.min(Math.max(at + step * (vertical ? per : 1), 0), items.length - 1);
    e.preventDefault();
    rove(g, items[next]);
    items[next].focus();
  }, true);
  // An outside press closes it; its own button toggles it (above). Focus stays where the press put it.
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('.gz-cm-btn')) return;
    if (menu && e.target instanceof Node && !menu.box.contains(e.target) && !menu.btn.contains(e.target) && !closeMenu(false)) e.preventDefault();
  }, true);
  let placing = 0;
  const follow = () => { if (menu && !placing) placing = requestAnimationFrame(() => { placing = 0; placeMenu(); }); };
  addEventListener('scroll', follow, { capture: true, passive: true });
  addEventListener('resize', follow);

  return {
    toggle: (b) => { if (menu?.btn === b) closeMenu(); else openMenu(b); },
    cid: () => menu?.cid,
    close: closeMenu,
    // The popover goes with its card: gone, hidden, or the extra switched off.
    sync: (on) => {
      if (menu && !menu.btn.isConnected) {
        const again = document.getElementById(`gz-cm-${menu.cid}`); // a card Ultra drew again
        if (again) menu.btn = again; else closeMenu(false, true);
      }
      if (menu && (!on || !menu.btn.getClientRects().length)) closeMenu(false, true);
      if (menu) paintMenu();
    },
  };
})();

GZ_COURSE_MENU;
