// Canvas's dashboard cards, loaded on demand (content.js syncCards, and its course menu's "Card style and
// bookmarks"): the card settings (sync `card`), each card's own style and bookmarks (`cards`, `links`), the pet,
// the create button and the editor. What is kept and what it paints is lib/cards.js; how it looks is canvas.css.
// Classic script in content.js's isolated world, through GZ_CTX; a second injection keeps the first.
var GZ_CARD_UI = globalThis.GZ_CARD_UI || (() => {
  const { need, t, capi } = globalThis.GZ_CTX;
  const html = document.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const C = GZ_COLOR;
  let K = null;

  // ---- what storage holds: read once, and again when it changes ----
  const get = (area, keys) => new Promise((res) => {
    try { chrome.storage[area].get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); }
  });
  const set = (area, patch) => new Promise((res) => {
    try { chrome.storage[area].set(patch, () => res(!chrome.runtime.lastError)); } catch { res(false); }
  });
  let data = null; // { card, cards, links, imgs }
  let reading = null;
  const read = () => (reading ||= need('lib/cards.js', () => globalThis.GZ_CARDS).then(async () => {
    K = globalThis.GZ_CARDS;
    const r = await get('sync', ['card', 'cards', 'links']);
    const cards = K.styles(r.cards);
    const ids = Object.values(cards).flat().map((s) => s?.i).filter(Boolean);
    const imgs = ids.length ? await get('local', ids.map((i) => `cardImg:${i}`)) : {};
    return (data = { card: K.settings(r.card), cards, links: K.links(r.links), imgs });
  }).catch((e) => { reading = null; throw e; }));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'sync' ? !(ch.card || ch.cards || ch.links) : !Object.keys(ch).some((k) => k.startsWith('cardImg:'))) return;
    reading = null;
    paint();
  });
  // Glaze turned on or off (content.js sets and clears its attributes on <html>): cards follow.
  new MutationObserver(() => paint()).observe(html, { attributes: true, attributeFilter: ['data-gz-motion'] });

  // ---- painting: only what differs is written, so a pass over unchanged cards changes nothing ----
  const prop = (el, k, v) => { if (el.style.getPropertyValue(k) !== v) { if (v) el.style.setProperty(k, v); else el.style.removeProperty(k); } };
  const attr = (el, k, v) => {
    if (v === false || v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  };
  const VARS = ['--gz-card-c', '--gz-card-grad', '--gz-card-img', '--gz-card-pos', '--gz-card-zoom', '--gz-card-filter', '--gz-card-ov', '--gz-card-ov-a'];
  const dress = (el, p) => {
    attr(el, 'data-gz-card', p?.kind);
    for (const v of VARS) prop(el, v, p?.vars[v] || '');
  };
  const keyOf = (el) => {
    const id = el.querySelector('a[href*="/courses/"]')?.getAttribute('href')?.match(/\/courses\/(\d+)/)?.[1];
    return id ? `canvas:${location.origin}/${id}` : null;
  };
  const nameOf = (el) => el?.getAttribute('aria-label') || el?.querySelector('.ic-DashboardCard__header-title')?.title || '';
  const cardOf = (key) => [...document.querySelectorAll('.ic-DashboardCard')].find((c) => keyOf(c) === key);
  const src = (d, s) => s.u || (K.DATA.test(d.imgs[`cardImg:${s.i}`] || '') ? d.imgs[`cardImg:${s.i}`] : '');
  const svg = (d) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };

  let editing = null; // the course in the editor: { key, style, links }, shown while it saves
  const paint = async () => {
    if (window.top !== window) return;
    let d;
    try { d = await read(); } catch { return; }
    const on = html.hasAttribute('data-gz-motion');
    const p = on ? K.page(d.card) : { vars: {}, attrs: {} };
    for (const v of ['--gz-card-w', '--gz-card-gap', '--gz-card-r', '--gz-card-h']) prop(html, v, p.vars[v] || '');
    for (const a of ['hover', 'particles', 'pet', 'condensed', 'icons', 'plain']) attr(html, `data-gz-card-${a}`, p.attrs[a]);
    // A theme's set goes round the courses in the order they first show.
    const order = new Map();
    for (const el of document.querySelectorAll('.ic-DashboardCard, .planner-grouping')) {
      const key = on && keyOf(el);
      if (key && !order.has(key)) order.set(key, order.size);
      const own = editing?.key === key ? editing : null;
      const style = key ? K.pick(own ? { ...d.cards, [key]: own.style } : d.cards, key, order.get(key)) : null;
      dress(el, style && K.paint(style, src(d, style)));
      if (!el.classList.contains('ic-DashboardCard')) continue;
      bookmarks(el, key && d.card.icons ? (own ? own.links.map(K.link).filter(Boolean) : d.links[key]) : null);
      pet(el, key && order.get(key) === 0 && d.card.pet !== 'none' && d.card.pet);
      create(el, key && d.card.create && key);
    }
  };

  // ---- bookmarks on a card: an icon link each, hidden ones left out ----
  const drawn = new WeakMap();
  const bookmarks = (card, list) => {
    const shown = (list || []).filter((l) => !l.h);
    let box = card.querySelector(':scope > .gz-bm');
    if (!shown.length) { box?.remove(); return; }
    const sig = JSON.stringify(shown);
    if (box && drawn.get(box) === sig) return;
    if (!box) card.append(box = Object.assign(document.createElement('div'), { className: 'gz-bm' }));
    drawn.set(box, sig);
    box.replaceChildren(...shown.map((l) => {
      const url = new URL(l.u, location.origin);
      const a = Object.assign(document.createElement('a'), { href: url.href });
      // Another site opens beside Canvas, and learns nothing of the page it came from.
      if (url.origin !== location.origin) Object.assign(a, { target: '_blank', rel: 'noopener noreferrer' });
      const label = l.n || (url.origin === location.origin ? url.pathname : url.hostname);
      a.title = label;
      a.setAttribute('aria-label', label);
      a.append(svg(K.ICONS[l.i] || K.ICONS.link));
      return a;
    }));
  };

  // ---- the pet: on the first card only, drawn by canvas.css from its sheet ----
  const pet = (card, kind) => {
    let p = card.querySelector(':scope > .gz-pet');
    if (!kind) { p?.remove(); return; }
    if (!p) {
      p = Object.assign(document.createElement('i'), { className: 'gz-pet' });
      p.setAttribute('aria-hidden', 'true');
      card.append(p);
    }
    prop(p, '--gz-pet-sheet', `url("${chrome.runtime.getURL(`assets/art/pets/${kind}/sprites.webp`)}")`);
  };

  // ---- create: what a student can start for this course, in Canvas ----
  const PLUS = 'M12 5v14M5 12h14';
  const create = (card, key) => {
    let b = card.querySelector(':scope > .gz-mk');
    if (!key) { if (b) { if (mk?.btn === b) closeMk(); b.remove(); } return; }
    const label = t('Create for {name}', { name: nameOf(card) });
    if (!b) {
      b = Object.assign(document.createElement('button'), { type: 'button', className: 'gz-mk' });
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.append(svg(PLUS));
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (mk?.btn === b) closeMk(); else openMk(b, key); });
      card.append(b);
    }
    if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.title = label; }
  };
  let mk = null; // { box, btn }
  const closeMk = (refocus = false) => {
    if (!mk) return;
    mk.box.remove();
    mk.btn.setAttribute('aria-expanded', 'false');
    if (refocus) mk.btn.focus();
    mk = null;
  };
  // A discussion only where the course lets students start one (asked once a course).
  const canStart = new Map();
  const openMk = async (btn, key) => {
    closeMk();
    const id = key.split('/').pop();
    if (!canStart.has(id)) canStart.set(id, capi(`/courses/${id}/permissions?permissions[]=create_discussion_topic`).then((p) => !!p?.create_discussion_topic, () => false));
    const items = [[t('Message the class'), `/conversations?context_id=course_${id}&compose=true`]];
    if (await canStart.get(id)) items.push([t('Start a discussion'), `/courses/${id}/discussion_topics/new`]);
    if (!btn.isConnected) return;
    const box = Object.assign(document.createElement('div'), { id: 'gz-mk' });
    box.setAttribute('role', 'menu');
    box.setAttribute('aria-label', btn.getAttribute('aria-label'));
    box.append(...items.map(([label, href]) => {
      const a = Object.assign(document.createElement('a'), { href, textContent: label });
      a.setAttribute('role', 'menuitem');
      return a;
    }));
    document.body.append(box);
    const r = btn.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(r.right - box.offsetWidth, innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${r.bottom + 6 + box.offsetHeight > innerHeight ? r.top - box.offsetHeight - 6 : r.bottom + 6}px`;
    mk = { box, btn };
    btn.setAttribute('aria-expanded', 'true');
    box.querySelector('a').focus();
  };
  document.addEventListener('keydown', (e) => {
    if (!mk) return;
    const items = [...mk.box.querySelectorAll('a')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMk(true); } else if (e.key === 'Tab') closeMk();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  }, true);
  document.addEventListener('pointerdown', (e) => { if (mk && !mk.box.contains(e.target) && !mk.btn.contains(e.target)) closeMk(); }, true);

  // ---- the editor: a dialog for one course's style and bookmarks ----
  // Every change shows on the card at once (editing, above) and is saved half a second after the last one.
  let ed = null; // { key, dlg, style, links, note, … }
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const field = (label, input, ...more) => make('label', { className: 'gz-ce-field' }, make('span', { textContent: label }), input, ...more);
  const say = (text) => { if (ed) { ed.note.textContent = text; ed.note.hidden = !text; } };

  let saveTimer = 0;
  const save = (soon = true) => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, soon ? 500 : 0);
  };
  // Over what is stored now (another tab may have saved since), refused if the item would not fit in sync storage.
  // False, with the reason in the dialog, when it isn't saved.
  const commit = async (e = ed) => {
    clearTimeout(saveTimer);
    if (!e) return true;
    const { key, style } = e;
    const links = e.links.map(K.link).filter(Boolean);
    const r = await get('sync', ['cards', 'links']);
    const cards = { ...K.styles(r.cards) };
    const all = { ...K.links(r.links) };
    if (style) cards[key] = style; else delete cards[key];
    if (links.length) all[key] = links; else delete all[key];
    if (K.bytes('cards', cards) > K.ITEM_MAX || K.bytes('links', all) > K.ITEM_MAX) { say(t('Too much to sync. Remove a style or a bookmark from another course.')); return false; }
    const patch = {};
    if (JSON.stringify(cards) !== JSON.stringify(K.styles(r.cards))) patch.cards = cards;
    if (JSON.stringify(all) !== JSON.stringify(K.links(r.links))) patch.links = all;
    if (Object.keys(patch).length && !await set('sync', patch)) { say(t('Not saved. Try again in a moment.')); return false; }
    if (patch.cards) await tidy(cards);
    return true;
  };
  // A picture kept on this device goes with the last style that used it (a replaced one, once the new one is saved).
  // Found by storage's own keys, so none is missed; the open editor's picture, not saved yet, stays.
  const tidy = async (cards) => {
    const gone = K.orphans(cards, K.kept(await get('local', null))).filter((id) => id !== ed?.style?.i);
    if (gone.length) await new Promise((res) => { try { chrome.storage.local.remove(gone.map((id) => `cardImg:${id}`), res); } catch { res(); } });
  };

  const KINDS = [['', 'Canvas color'], ['solid', 'Color'], ['gradient', 'Gradient'], ['image', 'Picture']];
  const FILTER_NAMES = { none: 'None', vivid: 'Vivid', mono: 'Mono', noir: 'Noir', warm: 'Warm', cool: 'Cool', faded: 'Faded', dreamy: 'Dreamy' };
  const ICON_NAMES = { link: 'Link', book: 'Book', video: 'Video', chat: 'Chat', doc: 'Document', calendar: 'Calendar', folder: 'Folder', code: 'Code', star: 'Star', globe: 'Globe' };

  // True once the editor is gone. A save that fails keeps it open, with the draft and the reason; closing again then
  // leaves without saving.
  const close = async () => {
    if (!ed) return true;
    const e = ed;
    const { dlg, key } = e;
    if (!await commit(e) && !e.leave) {
      e.leave = true;
      e.note.textContent += ` ${t('Your changes are still here. Close again to leave without them.')}`;
      return false;
    }
    if (ed !== e) return true;
    ed = null;
    editing = null;
    if (dlg.open) dlg.close();
    dlg.remove();
    paint();
    document.getElementById(`gz-cm-${key}`)?.focus({ preventScroll: true });
    return true;
  };

  const open = async (key) => {
    if (!await close()) return;
    let d;
    try { d = await read(); } catch { return; }
    const card = cardOf(key);
    const name = nameOf(card);
    const courseColor = () => C.hex(C.parse(cardOf(key)?.style.getPropertyValue('--gz-course-raw') || '') || { r: 128, g: 128, b: 128 });
    const dlg = make('dialog', { id: 'gz-ce' });
    dlg.setAttribute('aria-labelledby', 'gz-ce-title');
    const note = make('p', { className: 'gz-ce-note', hidden: true });
    note.setAttribute('role', 'alert');
    ed = { key, dlg, note, style: d.cards[key] ? { ...d.cards[key] } : null, links: (d.links[key] || []).map((l) => ({ ...l })) };
    editing = ed;

    // -- style --
    const kind = make('div', { className: 'gz-ce-kinds' });
    kind.setAttribute('role', 'radiogroup');
    kind.setAttribute('aria-label', t('Card'));
    const radios = KINDS.map(([v, label]) => {
      const r = make('input', { type: 'radio', name: 'gz-ce-kind', value: v });
      kind.append(make('label', {}, r, t(label)));
      return r;
    });
    const color = (label) => { const i = make('input', { type: 'color' }); return [i, field(label, i)]; };
    const range = (label, min, max, step, fmt) => {
      const i = make('input', { type: 'range', min, max, step });
      const o = make('output');
      i.addEventListener('input', () => { o.textContent = fmt(+i.value); });
      return [i, field(label, i, o), () => { o.textContent = fmt(+i.value); }];
    };
    const pct = (v) => `${v}%`;
    const [solid, solidRow] = color(t('Color'));
    const [from, fromRow] = color(t('From'));
    const [to, toRow] = color(t('To'));
    const [angle, angleRow, angleOut] = range(t('Angle'), 0, 360, 15, (v) => `${v}°`);
    const url = make('input', { type: 'url', placeholder: 'https://…', spellcheck: false });
    url.setAttribute('translate', 'no');
    const file = make('input', { type: 'file', accept: 'image/*', hidden: true });
    const pick = make('button', { type: 'button', textContent: t('Choose a picture from this computer') });
    const fileNote = make('p', { className: 'gz-ce-desc', textContent: t('A picture from this computer is kept on it, scaled down, and is not synced. A link works on every computer.') });
    const filter = make('select');
    filter.append(...Object.entries(FILTER_NAMES).map(([v, label]) => new Option(t(label), v)));
    const [fx, fxRow, fxOut] = range(t('Focus across'), 0, 100, 1, pct);
    const [fy, fyRow, fyOut] = range(t('Focus up and down'), 0, 100, 1, pct);
    const [zoom, zoomRow, zoomOut] = range(t('Zoom'), 100, 300, 5, pct);
    const [ov, ovRow] = color(t('Overlay color'));
    const ovReset = make('button', { type: 'button', textContent: t('Course color') });
    const [ova, ovaRow, ovaOut] = range(t('Overlay'), 0, 100, 5, pct);
    const contrast = make('p', { className: 'gz-ce-contrast' });
    contrast.setAttribute('role', 'status');
    const groups = {
      solid: [solidRow],
      gradient: [fromRow, toRow, angleRow],
      image: [field(t('Picture address'), url), make('div', { className: 'gz-ce-row' }, pick, file), fileNote, field(t('Filter'), filter), fxRow, fyRow, zoomRow, make('div', { className: 'gz-ce-row' }, ovRow, ovReset), ovaRow],
    };
    const styleTab = make('div', { className: 'gz-ce-panel', id: 'gz-ce-style' }, kind, ...Object.values(groups).flat(), contrast);

    // White text on the picture area (condensed cards put the name there): measured, never changed.
    let avgFor = '', avg = null;
    const measure = async () => {
      const s = ed?.style;
      const shown = ed && d.card.condensed && s;
      contrast.hidden = !shown;
      if (!shown) return;
      let o = { course: courseColor(), overlay: d.card.overlay };
      if (s.k === 'image') {
        const at = src(data || d, s);
        const sig = `${at}|${s.f || ''}`;
        if (avgFor !== sig) { avgFor = sig; avg = at ? await average(at, s.f) : null; }
        o = { ...o, avg };
      }
      const r = K.contrast(s, o);
      const ratio = r && GZ_I18N.num(+r.toFixed(1), GZ_CTX.locale());
      contrast.classList.toggle('gz-ce-warn', r !== null && r < 4.5);
      contrast.textContent = r === null ? t("Glaze can't measure this picture's contrast: its site doesn't allow it.")
        : r < 4.5 ? t('White text on this card: {ratio}:1, below the 4.5:1 text needs. Try a darker color or a stronger overlay.', { ratio })
          : t('White text on this card: {ratio}:1. Easy to read.', { ratio });
    };

    // The controls follow the style; a change of a control changes the style.
    const fill = () => {
      const s = ed.style;
      const k = s?.k || '';
      for (const r of radios) r.checked = r.value === k;
      for (const [g, rows] of Object.entries(groups)) for (const row of rows) row.hidden = g !== k;
      const base = courseColor();
      solid.value = s?.c || base;
      from.value = s?.c || base;
      to.value = s?.d || C.mix(base, '#000000', 0.5);
      angle.value = s?.a ?? 135;
      url.value = s?.u || '';
      filter.value = s?.f || 'none';
      fx.value = s?.x ?? 50;
      fy.value = s?.y ?? 50;
      zoom.value = s?.z ?? 100;
      ov.value = s?.c || base;
      ovReset.disabled = !s?.c;
      ova.value = s?.o ?? 60;
      for (const f of [angleOut, fxOut, fyOut, zoomOut, ovaOut]) f();
      if (k === 'image' && s.i && !src(data || d, s)) say(t('This picture is kept on another computer. Choose it again here, or use a link.'));
      measure();
    };
    const change = (next, soon = true) => {
      ed.leave = false;
      ed.style = next && K.style(next);
      say('');
      paint();
      measure();
      save(soon);
    };
    for (const r of radios) {
      r.addEventListener('change', () => {
        const base = courseColor();
        const was = ed.style;
        const v = r.value;
        // A picture: the card keeps what it wears until the picture has an address or a file.
        if (v === 'image') { for (const [g, rows] of Object.entries(groups)) for (const row of rows) row.hidden = g !== 'image'; url.focus(); return; }
        change(v === 'solid' ? { k: 'solid', c: was?.c || base } : v === 'gradient' ? { k: 'gradient', c: was?.c || base, d: was?.d || C.mix(base, '#000000', 0.5), a: was?.a ?? 135 } : null, false);
        fill();
      });
    }
    const img = () => ({ ...(ed.style?.k === 'image' ? ed.style : { k: 'image' }) });
    solid.addEventListener('input', () => change({ k: 'solid', c: solid.value }));
    for (const i of [from, to, angle]) i.addEventListener('input', () => change({ k: 'gradient', c: from.value, d: to.value, a: +angle.value }));
    url.addEventListener('change', () => {
      const v = url.value.trim();
      if (!v) return;
      const s = K.style({ ...img(), k: 'image', u: v, i: undefined });
      if (!s?.u) { say(t('Use an https:// link to an image.')); return; }
      change(s, false);
      fill();
    });
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0];
      const mine = ed;
      file.value = '';
      if (f) await addPicture(f, img(), mine);
      if (ed === mine) fill();
    });
    filter.addEventListener('change', () => ed.style?.k === 'image' && change({ ...img(), f: filter.value }));
    for (const [i, k] of [[fx, 'x'], [fy, 'y'], [zoom, 'z'], [ova, 'o']]) i.addEventListener('input', () => ed.style?.k === 'image' && change({ ...img(), [k]: +i.value }));
    ov.addEventListener('input', () => { if (ed.style?.k === 'image') { change({ ...img(), c: ov.value }); ovReset.disabled = false; } });
    ovReset.addEventListener('click', () => { const s = img(); delete s.c; change(s); fill(); ov.focus(); });

    // -- bookmarks --
    const list = make('ol', { className: 'gz-ce-links' });
    const add = make('button', { type: 'button', textContent: t('Add a bookmark') });
    const iconsOn = make('input', { type: 'checkbox', checked: d.card.icons });
    iconsOn.addEventListener('change', async () => {
      const r = await get('sync', 'card');
      set('sync', { card: K.settings({ ...K.settings(r.card), icons: iconsOn.checked }) });
    });
    const linksTab = make('div', { className: 'gz-ce-panel', id: 'gz-ce-links', hidden: true }, list, add,
      make('label', { className: 'gz-ce-check' }, iconsOn, t('Show bookmark icons on cards')),
      make('p', { className: 'gz-ce-desc', textContent: t('An https:// address, or a path on this Canvas site like /courses/12/files. Icons are Glaze’s own: nothing is asked of the linked site.') }));
    // Rows are drafts until they have an address: only the good ones are shown and kept.
    const saveLinks = () => { ed.leave = false; paint(); save(); };
    const renderLinks = (focus) => {
      list.replaceChildren(...ed.links.map((l, n) => {
        const label = l.n || l.u;
        const icon = make('select', { title: t('Icon') });
        icon.setAttribute('aria-label', t('Icon for {name}', { name: label }));
        icon.append(...Object.entries(ICON_NAMES).map(([v, w]) => new Option(t(w), v)));
        icon.value = l.i;
        const shape = make('span', { className: 'gz-ce-icon' }, svg(K.ICONS[l.i]));
        icon.addEventListener('change', () => { l.i = icon.value; shape.replaceChildren(svg(K.ICONS[l.i])); saveLinks(); });
        const nameIn = make('input', { type: 'text', value: l.n, maxLength: 40, placeholder: t('Name') });
        nameIn.setAttribute('aria-label', t('Name'));
        nameIn.addEventListener('change', () => { l.n = nameIn.value; saveLinks(); });
        const at = make('input', { type: 'text', value: l.u, placeholder: 'https://…', spellcheck: false });
        at.setAttribute('aria-label', t('Address'));
        at.setAttribute('translate', 'no');
        at.addEventListener('change', () => {
          const next = K.link({ ...l, u: at.value.trim() });
          if (!next) { say(t('Use an https:// address, or a path on this site like /courses/12/files.')); at.focus(); return; }
          say('');
          Object.assign(l, next);
          at.value = l.u;
          saveLinks();
        });
        const show = make('input', { type: 'checkbox', checked: !l.h });
        show.addEventListener('change', () => { if (show.checked) delete l.h; else l.h = true; saveLinks(); });
        const btn = (text, aria, fn, cls = '') => {
          const b = make('button', { type: 'button', textContent: text, className: cls, title: aria });
          b.setAttribute('aria-label', aria);
          b.addEventListener('click', fn);
          return b;
        };
        const move = (by, what) => () => {
          const [x] = ed.links.splice(n, 1);
          ed.links.splice(n + by, 0, x);
          saveLinks();
          renderLinks(`${what}${n + by}`);
        };
        const up = btn('↑', t('Move {name} up', { name: label }), move(-1, 'up'));
        const down = btn('↓', t('Move {name} down', { name: label }), move(1, 'down'));
        up.disabled = n === 0;
        down.disabled = n === ed.links.length - 1;
        up.dataset.at = `up${n}`;
        down.dataset.at = `down${n}`;
        const del = btn('×', t('Remove {name}', { name: label }), () => { ed.links.splice(n, 1); saveLinks(); renderLinks(); add.focus(); }, 'gz-ce-del');
        return make('li', {}, shape, icon, nameIn, at, make('label', { className: 'gz-ce-check' }, show, t('Show on the card')), up, down, del);
      }));
      add.disabled = ed.links.length >= K.LINKS_MAX;
      add.title = add.disabled ? t('Up to {n} bookmarks a course.', { n: K.LINKS_MAX }) : '';
      if (focus) {
        const b = list.querySelector(`[data-at="${focus}"]`);
        (b && !b.disabled ? b : list.querySelector(`[data-at^="${focus.replace(/\d+$/, '')}"]:not(:disabled)`) || add).focus();
      }
    };
    // A new row isn't kept until it has an address.
    add.addEventListener('click', () => {
      ed.links.push({ n: '', u: '', i: 'link' });
      renderLinks();
      list.lastElementChild?.querySelector('input[translate="no"]')?.focus();
    });

    // -- tabs, head and foot --
    const tab = (label, panel) => {
      const b = make('button', { type: 'button', textContent: label, id: `${panel.id}-tab` });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', b.id);
      return b;
    };
    const tabs = [tab(t('Style'), styleTab), tab(t('Bookmarks'), linksTab)];
    const panels = [styleTab, linksTab];
    const show = (n) => tabs.forEach((b, i) => { b.setAttribute('aria-selected', String(i === n)); b.tabIndex = i === n ? 0 : -1; panels[i].hidden = i !== n; });
    tabs.forEach((b, i) => b.addEventListener('click', () => show(i)));
    const tabList = make('div', { className: 'gz-ce-tabs' }, ...tabs);
    tabList.setAttribute('role', 'tablist');
    tabList.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const n = (tabs.indexOf(e.target) + 1) % 2;
      show(n);
      tabs[n].focus();
    });
    const x = make('button', { type: 'button', className: 'gz-ce-x', textContent: '×', title: t('Close') });
    x.setAttribute('aria-label', t('Close'));
    x.addEventListener('click', close);
    const reset = make('button', { type: 'button', textContent: t('Back to Canvas’s color') });
    reset.addEventListener('click', () => { change(null, false); fill(); radios[0].focus(); });
    const done = make('button', { type: 'button', className: 'gz-ce-done', textContent: t('Done') });
    done.addEventListener('click', close);
    dlg.append(make('div', { className: 'gz-ce-in' }, make('div', { className: 'gz-ce-head' }, make('h2', { id: 'gz-ce-title', textContent: t('Card for {name}', { name }) }), x),
      tabList, note, styleTab, linksTab, make('div', { className: 'gz-ce-foot' }, reset, done)));
    // Esc, and a press on the backdrop (the dialog itself, outside its inner box), close it as Done does.
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    document.body.append(dlg);
    show(0);
    fill();
    renderLinks();
    dlg.showModal();
    (radios.find((r) => r.checked) || radios[0]).focus();
  };

  // A picture from this computer: scaled down (lib/cards.js fit), kept as WebP (JPEG where the browser can't write
  // WebP), within the per-picture and total caps (every picture on this device counts, the one it replaces too), in
  // storage.local. It belongs to the editor it was chosen in (`mine`): if that has closed or moved to another course
  // by the time the picture is ready, it is dropped. The replaced picture goes once the new style is saved (tidy).
  const addPicture = async (f, base, mine) => {
    const here = () => ed === mine;
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { if (here()) say(t("That file isn't a picture Glaze can read.")); return; }
    if (!here()) { bmp.close?.(); return; }
    const { w, h } = K.fit(bmp.width, bmp.height);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    let url = c.toDataURL('image/webp', 0.82);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.85);
    const others = K.kept(await get('local', null));
    if (!here()) return;
    if (!K.room(url.length, others)) { say(t("That picture is too big to keep. Try a smaller one, or remove another card's picture.")); return; }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    if (!await set('local', { [`cardImg:${id}`]: url })) { if (here()) say(t('Not saved. Try again in a moment.')); return; }
    // Moved on while it was written: nothing uses it.
    if (!here()) { try { chrome.storage.local.remove(`cardImg:${id}`); } catch { /* reloaded */ } return; }
    if (data) data.imgs[`cardImg:${id}`] = url;
    const s = { ...base, k: 'image', i: id };
    delete s.u;
    mine.leave = false;
    mine.style = K.style(s);
    paint();
    await commit(mine);
  };

  // A picture's average color, through its filter, for the contrast line; null when its site doesn't allow reading it.
  const average = (url, f) => new Promise((res) => {
    const im = new Image();
    if (!url.startsWith('data:')) im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const c = Object.assign(document.createElement('canvas'), { width: 8, height: 8 });
        const x = c.getContext('2d', { willReadFrequently: true });
        x.filter = K.FILTERS[f] || 'none';
        x.drawImage(im, 0, 0, 8, 8);
        const p = x.getImageData(0, 0, 8, 8).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += p[i + j];
        res(C.hex({ r: sum[0] / 64, g: sum[1] / 64, b: sum[2] / 64 }));
      } catch { res(null); }
    };
    im.onerror = () => res(null);
    im.src = url;
  });

  return { paint, open };
})();
// The module as the script's last value: how lib/background.js knows it ran to the end.
GZ_CARD_UI;
