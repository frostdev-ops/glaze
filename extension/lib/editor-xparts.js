// The editor's no-code builders for two Look parts: the Look's own nav layout (x.nav, lib/navlayout.js)
// and its page tweaks (x.rules, named parts from lib/parts.js). Both edit s.parts ({ x, m } or null) and save it the way
// the rest of a Look is saved (save(['parts'])), so a theme code carries them (glaze2:) and the worker cleans them again.
// Every edit goes through the part's own cleaner before it is kept, so what is stored is already what a code decodes to.
// The student's own Ultra items (navItems, edited under Navigation while Glaze navigation is off) are a different thing: theirs on every
// Look. A Look's layout replaces them only while that Look is worn, and the copy here says so.
// Extension options page only (mount); the pure helpers are for node tests. English through t(); catalogues come later.
var GZ_XEDIT = globalThis.GZ_XEDIT || (() => {
  const L = typeof GZ_NAV_LAYOUT !== 'undefined' ? GZ_NAV_LAYOUT : require('./navlayout.js');
  const N = typeof GZ_NAV_ITEMS !== 'undefined' ? GZ_NAV_ITEMS : require('./nav-items.js');
  const P = typeof GZ_PARTS !== 'undefined' ? GZ_PARTS : require('./parts.js');
  const D = typeof GZ_COLORS !== 'undefined' ? { GZ_COLORS } : require('../defaults.js');
  const F = typeof GZ_FONTS !== 'undefined' ? GZ_FONTS : require('./fonts.js');

  // s.parts with one part replaced (null takes it out); null once nothing is left.
  const put = (parts, key, value) => {
    const x = { ...parts?.x };
    if (value == null) delete x[key]; else x[key] = value;
    const out = { ...(Object.keys(x).length && { x }), ...(parts?.m && { m: parts.m }) };
    return Object.keys(out).length ? out : null;
  };
  const shift = (list, from, to) => { const out = [...list]; out.splice(to, 0, ...out.splice(from, 1)); return out; };

  // ---- nav layout ---------------------------------------------------------------------------------
  const NAMES = { profile: 'Profile', 'institution-page': 'Institution page', stream: 'Activity', course: 'Courses', organization: 'Organizations', calendar: 'Calendar', messages: 'Messages', grades: 'Grades', tools: 'Tools', logout: 'Sign out', glaze: 'Glaze settings', dashboard: 'Dashboard', home: 'Site home', history: 'History', help: 'Help', groups: 'Groups', admin: 'Admin', notifications: 'Notifications' };
  const WIDGETS = { clock: 'Clock and date', next: 'Next due', timer: 'Focus timer', pet: 'Pet habitat' };
  const ICONS = { link: 'Link', book: 'Book', video: 'Video', chat: 'Chat', doc: 'Document', calendar: 'Calendar', folder: 'Folder', code: 'Code', star: 'Star', globe: 'Globe' };
  const PLACES = { left: 'Left side', top: 'Top bar', bottom: 'Bottom bar', dock: 'Floating dock' };
  const SITES = { ultra: 'Blackboard', canvas: 'Canvas', moodle: 'Moodle' };
  // What each site's navigation usually holds, in its own order: the "how it lands" list resolves the layout against it.
  const TYPICAL = { ultra: N.NATIVE, canvas: ['profile', 'admin', 'dashboard', 'course', 'groups', 'calendar', 'messages', 'history', 'help'], moodle: ['home', 'dashboard', 'course', 'admin'] };
  const GROUPS_MAX = 6, LINKS_MAX = 8;
  const FRESH = { place: 'left', groups: [{ items: [] }] };
  // The student's own Ultra items as a Look's layout: their order in one group, their links and hidden items, and the
  // widgets they have on (top ones first, bottom ones last). "Open in a new tab" isn't part of a layout.
  const fromMine = (mine) => {
    const c = N.clean(mine), on = (at) => c.widgets.filter((w) => w.on && w.at === at).map((w) => `w:${w.id}`);
    const shown = N.sequence(N.NATIVE, c).filter((id) => id === 'glaze' || !c.hidden.includes(id)).map((id) => (c.links.some((l) => l.id === id) ? `link:${id}` : id));
    return L.clean({ place: 'left', groups: [{ items: [...on('top'), ...shown, ...on('bottom')] }], hidden: c.hidden, links: c.links.map(({ id, n, u, i }) => ({ id, n, u, i })) });
  };
  const without = (n, id) => ({ ...n, groups: (n.groups || []).map((g) => ({ ...g, items: g.items.filter((x) => x !== id) })) });
  // Each takes a cleaned layout and returns a cleaned one (or null when the change can't be made).
  const nav = {
    place: (n, place) => L.clean({ ...n, place }),
    // id into group g at `at` (the end when left out); g < 0 takes it out of every group.
    item: (n, id, g, at) => {
      const o = without(n, id);
      if (g >= 0) { const items = [...o.groups[g].items]; items.splice(at ?? items.length, 0, id); o.groups[g] = { ...o.groups[g], items }; }
      return L.clean(o);
    },
    // Glaze's settings item can't be hidden: it is how the student gets back to Glaze.
    hide: (n, id) => (id === 'glaze' || !L.NATIVE.includes(id) ? null : L.clean({ ...without(n, id), hidden: [...(n.hidden || []), id] })),
    show: (n, id) => L.clean({ ...n, hidden: (n.hidden || []).filter((x) => x !== id) }),
    icon: (n, id, icon) => {
      const link = /^link:(.+)$/.exec(id)?.[1];
      if (link) return nav.link(n, { ...n.links.find((l) => l.id === link), i: icon });
      const icons = { ...n.icons };
      if (icon) icons[id] = icon; else delete icons[id];
      return L.clean({ ...n, icons });
    },
    group: (n) => ((n.groups || []).length >= GROUPS_MAX ? null : L.clean({ ...n, groups: [...(n.groups || []), { items: [] }] })),
    ungroup: (n, g) => L.clean({ ...n, groups: n.groups.filter((_, i) => i !== g) }),
    label: (n, g, label) => L.clean({ ...n, groups: n.groups.map((x, i) => (i === g ? { ...(label.trim() && { label }), items: x.items } : x)) }),
    moveGroup: (n, g, to) => L.clean({ ...n, groups: shift(n.groups, g, to) }),
    link: (n, raw) => {
      const l = N.link(raw), links = n.links || [];
      if (!l) return null;
      const had = links.some((x) => x.id === l.id), next = { id: l.id, n: l.n, u: l.u, i: l.i };
      if (!had && links.length >= LINKS_MAX) return null;
      const icons = { ...n.icons };
      delete icons[`link:${l.id}`];
      return L.clean({ ...n, ...(n.icons && { icons }), links: had ? links.map((x) => (x.id === l.id ? next : x)) : [...links, next] });
    },
    unlink: (n, id) => L.clean({ ...without(n, `link:${id}`), links: (n.links || []).filter((l) => l.id !== id) }),
  };
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (v) => 'abcdefghijklmnopqrstuvwxyz0123456789'[v % 36]).join('');

  // ---- page tweaks (rules) ------------------------------------------------------------------------
  const GROUPS = [['Cards', /card|tile/], ['Navigation', /nav|tabs|breadcrumbs|course-index/], ['Headers', /header|banner|term/], ['Sidebar and blocks', /sidebar|block/], ['Other parts', /./]];
  const groupOf = (name) => GROUPS.find(([, re]) => re.test(name.slice(name.indexOf('.') + 1)))[0];
  // One site's parts for the picker, grouped, with labels in the editor's language.
  const parts = (site, t) => GROUPS.map(([g]) => [g, P.list(site, t).filter((p) => groupOf(p.name) === g)]).filter(([, l]) => l.length);
  const ACTS = { hide: 'Hide', show: 'Show', move: 'Move', style: 'Restyle', label: 'Rename' };
  // Which actions a part takes, by lib/parts.js's own flags.
  const can = (name) => { const p = P.get(name); return { hide: p.hide, show: p.hide, move: !!p.in, style: p.st.length > 0, label: p.text }; };
  // The parts `name` may be moved beside: same LMS, same container.
  const beside = (name, t) => { const p = P.get(name); return P.list(p.site, t).filter((o) => o.name !== name && P.get(o.name).in === p.in && p.in); };
  const STYLE = { bg: 'Background', fg: 'Text colour', bc: 'Border colour', bw: 'Border width', r: 'Corner radius', p: 'Padding', g: 'Spacing', sh: 'Shadow', o: 'Opacity', f: 'Font' };
  const SHADOWS = ['None', 'Soft', 'Medium', 'Strong'];
  const TOKENS = D.GZ_COLORS.map(([v, label]) => [v.slice(5), label]);
  // A style key's choices as [value, words]: what the restyle menus offer, in the allowlist's own steps.
  const choices = (k, t) => ({
    bw: [0, 1, 2, 3, 4].map((v) => [v, `${v} px`]),
    r: [0, 4, 8, 12, 16, 24, 32].map((v) => [v, `${v} px`]),
    p: P.STEPS.map((px, v) => [v, `${px} px`]), g: P.STEPS.map((px, v) => [v, `${px} px`]),
    sh: SHADOWS.map((w, v) => [v, t(w)]),
    o: [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map((v) => [v, `${v}%`]),
    f: F.LIST.map((f) => [f.id, t(f.name)]),
  }[k] || TOKENS.map(([v, label]) => [v, t(label)]));
  const styleWord = (k, v, t) => (['bg', 'fg', 'bc'].includes(k) && v[0] === '#' ? v : choices(k, t).find(([x]) => x === v)?.[1] ?? String(v));
  const partName = (name, t) => `${SITES[name.split('.')[0]]} · ${t(P.get(name).label)}`;
  // A rule in plain words: "Hide: Blackboard · Term heading".
  const describe = (r, t) => {
    const part = partName(r.p, t);
    if (r.do === 'move') return t(r.at === 'before' ? 'Move: {part}, before {other}' : 'Move: {part}, after {other}', { part, other: t(P.get(r.to).label) });
    if (r.do === 'label') return t('Rename: {part} to “{text}”', { part, text: r.t });
    if (r.do === 'style') return t('Restyle: {part} ({changes})', { part, changes: Object.entries(r.st).map(([k, v]) => `${t(STYLE[k])} ${styleWord(k, v, t)}`).join(', ') });
    return t(r.do === 'hide' ? 'Hide: {part}' : 'Show: {part}', { part });
  };
  const rules = {
    // The list with a cleaned rule added, or null when it can't be (not a rule this part takes, or the list is full).
    add: (list, raw) => { const r = P.clean(raw); return r && (list || []).length < P.MAX ? [...(list || []), r] : null; },
    remove: (list, at) => list.filter((_, i) => i !== at),
    move: (list, at, to) => shift(list, at, to),
  };

  // ---- the page ----------------------------------------------------------------------------------
  let api = null, renders = [];
  const render = () => { for (const f of renders) f(); };
  const mount = (a) => {
    api = a;
    const { s, t } = a;
    // Elements: props after children, so a select's value finds its options; on* props are listeners.
    const h = (tag, props = {}, ...kids) => {
      const e = document.createElement(tag);
      e.append(...kids.flat().filter((k) => k != null && k !== false));
      for (const [k, v] of Object.entries(props)) if (v == null) continue; else if (k in e && !k.includes('-')) e[k] = v; else if (v !== false) e.setAttribute(k, v === true ? '' : v);
      return e;
    };
    const button = (text, f, onclick, props = {}) => h('button', { type: 'button', textContent: text, 'data-f': f, onclick, ...props });
    const options = (list, value) => list.map(([v, text, more]) => (v === 'group' ? h('optgroup', { label: text }, options(more, value)) : h('option', { value: String(v), textContent: text, selected: String(v) === String(value), disabled: !!more })));
    const select = (label, f, list, value, onchange, props = {}) => h('select', { 'aria-label': label, 'data-f': f, onchange, ...props }, options(list, value));
    const field = (label, control) => h('label', { className: 'field wide' }, h('span', { textContent: label }), control);
    // Redraws one builder, keeping focus on the control that had it (each carries data-f).
    let focusTo = '';
    const focusRow = (from, to) => { const f = document.activeElement?.dataset.f; if (f?.startsWith(`${from}:`)) focusTo = to + f.slice(from.length); };
    const redraw = (box, kids) => {
      const f = document.activeElement?.closest?.('[data-f]') && box.contains(document.activeElement) ? focusTo || document.activeElement.dataset.f : '';
      focusTo = '';
      box.replaceChildren(...kids.filter((k) => k != null && k !== false));
      if (f) (box.querySelector(`[data-f="${CSS.escape(f)}"]`) || box.querySelector(`[data-f="${CSS.escape(f.replace(/:(hide|show)$/, (_, act) => act === 'hide' ? ':show' : ':hide'))}"]`) || box.querySelector('[data-f]'))?.focus();
    };
    // A live region made once, so screen readers hear each add, remove and move.
    const status = (id) => h('p', { id, className: 'desc', role: 'status', 'aria-live': 'polite' });
    const say = (el, text) => { el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); };
    const commit = (key, value) => { s.parts = put(s.parts, key, value); a.refresh(); a.save(['parts'], false, [key]); };
    const heading = (id, text) => { document.getElementById(id).textContent = t(text); };
    // A reorder handle as the student's own nav list has: drag it, or focus it and use the arrow keys.
    let drag = null;
    const handle = (name, f, kind, id, step) => h('button', {
      type: 'button', textContent: '↕', draggable: true, 'data-f': f, 'aria-label': t('Reorder {name}', { name }), 'aria-describedby': `${kind}-reorder-note`,
      onkeydown: (e) => { const by = { ArrowUp: -1, ArrowDown: 1 }[e.key]; if (by) { e.preventDefault(); step(by); } },
      ondragstart: (e) => { drag = { kind, id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(id)); },
      ondragend: () => { drag = null; for (const r of document.querySelectorAll('[data-drop]')) delete r.dataset.drop; },
    });
    const dropZone = (row, kind, onDrop) => {
      row.addEventListener('dragover', (e) => { if (drag?.kind === kind) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; row.dataset.drop = ''; } });
      row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) delete row.dataset.drop; });
      row.addEventListener('drop', (e) => { if (drag?.kind !== kind) return; e.preventDefault(); e.stopPropagation(); delete row.dataset.drop; const d = drag; drag = null; onDrop(d.id); });
      return row;
    };
    const updown = (name, f, at, count, step) => {
      const up = button(t('Move up'), `${f}:up`, () => { if (at > 0) step(-1); }, { 'aria-label': `${t('Move up')} · ${name}`, 'aria-disabled': String(at === 0) });
      const down = button(t('Move down'), `${f}:down`, () => { if (at < count - 1) step(1); }, { 'aria-label': `${t('Move down')} · ${name}`, 'aria-disabled': String(at === count - 1) });
      return [up, down];
    };

    // ---- nav layout ----
    const navBox = document.getElementById('xnav'), navBody = h('div', { className: 'xparts-body' }), navSaid = status('xnav-status');
    heading('heading-look-nav-layout', "This Look's navigation");
    navBox.replaceChildren(
      h('p', { className: 'desc', textContent: t('A layout here travels with this Look; your own stays under Navigation.') }),
      navBody, navSaid);
    let navSite = 'ultra', editing = '', navSig = '';
    const layout = () => s.parts?.x?.nav || null;
    const setNav = (next, said) => { if (!next) return; commit('nav', next); if (said) say(navSaid, said); };
    const itemName = (id, n = layout()) => {
      const link = /^link:(.+)$/.exec(id)?.[1];
      if (link) return n?.links?.find((l) => l.id === link)?.n || id;
      return id.startsWith('w:') ? t(WIDGETS[id.slice(2)]) : t(NAMES[id] || id);
    };
    const groupName = (n, g) => n.groups[g].label || t('Group {n}', { n: g + 1 });
    const renderNav = () => {
      const n = layout(), sig = JSON.stringify([n, navSite, editing]);
      if (sig === navSig && !(focusTo && navBody.contains(document.activeElement))) return;
      navSig = sig;
      if (!n) {
        return redraw(navBody, [
          h('p', { textContent: t('This Look has no navigation layout. Your own navigation is used on Blackboard, and Canvas and Moodle keep theirs.') }),
          h('div', { className: 'row' },
            button(t('Start from my navigation'), 'nav:mine', () => setNav(fromMine(a.navItems()), t('Started from your navigation. Changes here are this Look’s only.'))),
            button(t('Start empty'), 'nav:fresh', () => setNav(L.clean(FRESH), t('Started an empty layout.')))),
        ]);
      }
      const groups = n.groups || [], inGroup = new Set(groups.flatMap((g) => g.items)), hidden = n.hidden || [], links = n.links || [];
      const loose = [...L.NATIVE.filter((id) => !inGroup.has(id) && !hidden.includes(id)), ...links.map((l) => `link:${l.id}`).filter((id) => !inGroup.has(id))];
      const step = (id, g, at, to) => {
        if (to < 0 || to >= groups[g].items.length) return;
        setNav(nav.item(n, id, g, to), t('{name}: position {at} of {count} in {group}.', { name: itemName(id), at: to + 1, count: groups[g].items.length, group: groupName(n, g) }));
      };
      const moveTo = (id, g, at) => {
        const next = nav.item(n, id, g, at);
        setNav(next, g < 0 ? t('{name} is no longer in a group.', { name: itemName(id) }) : t('Added {name} to {group}.', { name: itemName(id), group: groupName(next, g) }));
      };
      const iconPick = (id) => {
        const link = /^link:(.+)$/.exec(id)?.[1];
        const list = [...(link ? [] : [['', t('Its own icon')]]), ...Object.entries(ICONS).map(([v, w]) => [v, t(w)])];
        return select(t('Icon for {name}', { name: itemName(id) }), `${id}:icon`, list, n.icons?.[id] || (link ? links.find((l) => l.id === link)?.i : ''), (e) => setNav(nav.icon(n, id, e.target.value)));
      };
      const hideButton = (id) => (id === 'glaze' ? h('span', { className: 'desc', textContent: t('Always shown') })
        : L.NATIVE.includes(id) ? button(t('Hide'), `${id}:hide`, () => setNav(nav.hide(n, id), t('Hid {name}.', { name: itemName(id) })), { 'aria-label': `${t('Hide')} · ${itemName(id)}` }) : null);
      const groupRow = (id, g, at) => {
        const name = itemName(id), widget = id.startsWith('w:');
        const where = select(t('Group for {name}', { name }), `${id}:group`, [...groups.map((_, i) => [i, groupName(n, i)]), [-1, widget ? t('Not shown') : t('No group')]], g, (e) => moveTo(id, +e.target.value));
        return dropZone(h('li', {}, handle(name, `${id}:drag`, 'xnav', id, (by) => step(id, g, at, at + by)), h('span', { textContent: widget ? `${name} · ${t('widget')}` : name }),
          ...updown(name, id, at, groups[g].items.length, (by) => step(id, g, at, at + by)), where, widget ? null : iconPick(id), hideButton(id)), 'xnav', (from) => moveTo(from, g, at));
      };
      const addable = (g) => {
        const natives = L.NATIVE.filter((id) => !inGroup.has(id) && !hidden.includes(id)), own = links.map((l) => `link:${l.id}`).filter((id) => !inGroup.has(id));
        const widgets = N.WIDGETS.map((w) => `w:${w}`).filter((id) => !inGroup.has(id));
        const list = [['', t('Choose…')], ...[[t('Items'), natives], [t('Links'), own], [t('Widgets'), widgets]].filter(([, l]) => l.length).map(([label, l]) => ['group', label, l.map((id) => [id, itemName(id)])])];
        return select(t('Add to {group}', { group: groupName(n, g) }), `group${g}:add`, list, '', (e) => { if (e.target.value) moveTo(e.target.value, g); });
      };
      const sites = Object.entries(SITES).map(([site, word]) => h('label', {}, h('input', { type: 'radio', name: 'xnav-site', value: site, checked: site === navSite, 'data-local': true, 'data-f': `site:${site}`, onchange: () => { navSite = site; a.preview(site); renderNav(); } }), word));
      const lands = L.resolve(n, TYPICAL[navSite]).map((e) => (e.kind === 'label' ? h('li', {}, h('strong', { textContent: e.label })) : h('li', { textContent: e.kind === 'link' ? itemName(`link:${e.id}`) : e.kind === 'widget' ? `${t(WIDGETS[e.id])} · ${t('widget')}` : t(NAMES[e.id]) })));
      const editLink = links.find((l) => l.id === editing);
      const linkName = h('input', { type: 'text', maxLength: 40, value: editLink?.n || '', 'data-f': 'link:name' }), linkUrl = h('input', { type: 'url', maxLength: 512, value: editLink?.u || '', placeholder: 'https://…', spellcheck: false, translate: false, 'data-f': 'link:url' });
      const linkIcon = select(t('Icon'), 'link:icon', Object.entries(ICONS).map(([v, w]) => [v, t(w)]), n.icons?.[`link:${editing}`] || editLink?.i || 'link', null);
      const linkError = h('p', { className: 'desc', role: 'alert' });
      const saveLink = () => {
        const next = nav.link(n, { id: editing || newId(), n: linkName.value, u: linkUrl.value.trim(), i: linkIcon.value });
        if (!next) { linkError.textContent = !editing && links.length >= LINKS_MAX ? t('A layout can have up to 8 links.') : t('Use an http:// or https:// link and a name.'); return; }
        const was = editing; editing = '';
        setNav(next, t(was ? 'Saved the link {name}.' : 'Added the link {name}. It shows after the site’s own items until you put it in a group.', { name: linkName.value.trim() }));
      };
      redraw(navBody, [
        field(t('Placement'), select(t('Placement'), 'nav:place', Object.entries(PLACES).map(([v, w]) => [v, t(w)]), n.place || 'left', (e) => setNav(nav.place(n, e.target.value), t('Placement: {place}.', { place: t(PLACES[e.target.value]) })), { 'aria-describedby': 'xnav-place-note' })),
        h('p', { className: 'desc', id: 'xnav-place-note', textContent: t('Bars and the dock show in windows 900 px wide and wider; narrower windows keep each site’s own menu. On Moodle, Left and Top leave its top bar as it is.') }),
        h('h3', { textContent: t('Groups') }),
        h('p', { className: 'desc', id: 'xnav-reorder-note', textContent: t('Drag a handle to reorder, or focus it and use the arrow keys. Items in no group follow the groups in each site’s own order; widgets show only inside a group.') }),
        ...groups.map((grp, g) => h('div', { className: 'group' },
          h('div', { className: 'row' },
            h('input', { type: 'text', maxLength: 24, value: grp.label || '', placeholder: t('No label'), 'aria-label': t('Name of {group}', { group: groupName(n, g) }), 'data-f': `group${g}:label`, onchange: (e) => setNav(nav.label(n, g, e.target.value), t('Renamed the group.')) }),
            ...updown(groupName(n, g), `group${g}`, g, groups.length, (by) => { focusRow(`group${g}`, `group${g + by}`); setNav(nav.moveGroup(n, g, g + by), t('{group}: position {at} of {count}.', { group: groupName(n, g), at: g + by + 1, count: groups.length })); }),
            button(t('Remove group'), `group${g}:remove`, () => { focusTo = groups.length > 1 ? `group${Math.min(g, groups.length - 2)}:remove` : 'nav:group'; setNav(nav.ungroup(n, g), t('Removed {group}. Its items follow in each site’s own order.', { group: groupName(n, g) })); }, { 'aria-label': `${t('Remove group')} · ${groupName(n, g)}` })),
          dropZone(h('ol', { className: 'nav-editor-list', 'aria-label': groupName(n, g), 'aria-describedby': 'xnav-reorder-note' }, grp.items.map((id, at) => groupRow(id, g, at))), 'xnav', (from) => moveTo(from, g)),
          h('div', { className: 'row' }, addable(g)))),
        button(t('Add a group'), 'nav:group', () => setNav(nav.group(n), t('Added {group}.', { group: t('Group {n}', { n: groups.length + 1 }) })), { 'aria-disabled': String(groups.length >= GROUPS_MAX), 'aria-describedby': 'xnav-groups-max' }),
        h('p', { className: 'desc', id: 'xnav-groups-max', textContent: t('{n} of 6 groups.', { n: groups.length }) }),
        h('h3', { textContent: t('Not in a group') }),
        h('ul', { className: 'nav-editor-list', 'aria-label': t('Not in a group') }, loose.map((id) => h('li', {}, h('span', { textContent: itemName(id) }), ...(/^link:/.test(id) ? [iconPick(id)] : [iconPick(id), hideButton(id)])))),
        h('h3', { textContent: t('Hidden') }),
        h('p', { className: 'desc', textContent: t('Hidden items stay hidden on every site. Glaze settings can’t be hidden, so you can always get back here.') }),
        hidden.length ? h('ul', { className: 'nav-editor-list', 'aria-label': t('Hidden') }, hidden.map((id) => h('li', {}, h('span', { textContent: itemName(id) }), button(t('Show'), `${id}:show`, () => setNav(nav.show(n, id), t('{name} is shown again.', { name: itemName(id) })), { 'aria-label': `${t('Show')} · ${itemName(id)}` }))))
          : h('p', { className: 'desc', textContent: t('Nothing hidden.') }),
        h('h3', { textContent: t('Links') }),
        h('p', { className: 'desc', textContent: t('{n} of 8 links.', { n: links.length }) }),
        links.length ? h('ul', { className: 'nav-editor-list', 'aria-label': t('Links') }, links.map((l) => h('li', {}, h('span', { textContent: l.n, title: l.u, translate: false }),
          button(t('Edit'), `${l.id}:edit`, () => { editing = l.id; navSig = ''; renderNav(); navBody.querySelector('[data-f="link:name"]').focus(); }, { 'aria-label': `${t('Edit')} · ${l.n}` }),
          button(t('Remove link'), `${l.id}:remove`, () => { if (editing === l.id) editing = ''; setNav(nav.unlink(n, l.id), t('Removed the link {name}.', { name: l.n })); }, { 'aria-label': `${t('Remove link')} · ${l.n}` })))) : null,
        h('div', { className: 'group', onkeydown: (e) => { if (e.key === 'Escape' && editing) { e.preventDefault(); editing = ''; renderNav(); } } },
          field(t('Name'), linkName), field(t('URL'), linkUrl), field(t('Icon'), linkIcon), linkError,
          h('div', { className: 'row' }, button(editing ? t('Save link') : t('Add link'), 'link:save', saveLink, { 'aria-disabled': String(!editing && links.length >= LINKS_MAX) }),
            editing ? button(t('Cancel'), 'link:cancel', () => { editing = ''; renderNav(); }) : null)),
        h('h3', { textContent: t('How it lands') }),
        h('div', { className: 'seg', role: 'radiogroup', 'aria-label': t('Site') }, sites),
        h('p', { className: 'desc', textContent: navSite === 'ultra' ? t('The preview shows Blackboard’s rail with this layout. The list is the order it shows in.')
          : t('The preview can’t draw this layout on {site} yet. On a typical {site} navigation it shows in this order:', { site: SITES[navSite] }) }),
        h('ol', { 'aria-label': t('How it lands') }, lands),
        h('div', { className: 'row' }, button(t('Remove this Look’s layout'), 'nav:remove', () => { commit('nav', null); say(navSaid, t('Removed this Look’s layout. Your own navigation is back.')); }, { className: 'danger' })),
      ]);
    };

    // ---- page tweaks ----
    const ruleBox = document.getElementById('xrules'), ruleBody = h('div', { className: 'xparts-body' }), ruleSaid = status('xrules-status');
    heading('heading-look-rules', 'Page tweaks');
    ruleBox.replaceChildren(
      h('p', { className: 'desc', textContent: t('Tweaks travel with this Look and never apply on quizzes or course tools.') }),
      ruleBody, ruleSaid);
    const form = { site: 'ultra', part: '', act: '', at: 'after', to: '', st: {}, text: '' };
    let ruleSig = '', previewTick = 0;
    const list = () => s.parts?.x?.rules || [];
    const setRules = (next, said) => { if (!next) return; commit('rules', next.length ? next : null); say(ruleSaid, said); };
    // Whether the preview page shows the part now: the frame is the editor's own page.
    const inPreview = (name) => { try { return [...a.frame.contentDocument.querySelectorAll(P.get(name).s)].some((el) => !el.closest('[hidden], template')); } catch { return false; } };
    addEventListener('message', (e) => { if (e.source === a.frame.contentWindow && e.data?.gzPreviewReady) { previewTick++; renderRules(); } });
    const renderRules = () => {
      const all = list(), sig = JSON.stringify([all, form, previewTick]);
      if (sig === ruleSig && !(focusTo && ruleBody.contains(document.activeElement))) return;
      ruleSig = sig;
      const groups = parts(form.site, t);
      if (!P.get(form.part) || P.get(form.part).site !== form.site) Object.assign(form, { part: groups[0][1][0].name, act: '', to: '', st: {} });
      const allowed = can(form.part);
      if (!allowed[form.act]) form.act = Object.keys(ACTS).find((k) => allowed[k]);
      const others = beside(form.part, t);
      if (form.act === 'move' && !others.some((o) => o.name === form.to)) form.to = others[0]?.name || '';
      const redo = () => renderRules();
      const fields = [];
      if (form.act === 'move') {
        fields.push(field(t('Where'), select(t('Where'), 'rule:at', [['before', t('Before')], ['after', t('After')]], form.at, (e) => { form.at = e.target.value; redo(); })),
          field(t('Beside'), select(t('Beside'), 'rule:to', others.map((o) => [o.name, o.label]), form.to, (e) => { form.to = e.target.value; redo(); })));
      } else if (form.act === 'label') {
        fields.push(field(t('New text'), h('input', { type: 'text', maxLength: P.LABEL_MAX, value: form.text, 'data-f': 'rule:text', oninput: (e) => { form.text = e.target.value; } })));
      } else if (form.act === 'style') {
        for (const k of P.get(form.part).st) {
          const v = form.st[k], colour = ['bg', 'fg', 'bc'].includes(k), custom = colour && typeof v === 'string' && v[0] === '#';
          const pick = select(t(STYLE[k]), `rule:st:${k}`, [['', t('Unchanged')], ...choices(k, t), ...(colour ? [['custom', t('Custom colour…')]] : [])], custom ? 'custom' : v ?? '', (e) => {
            const x = e.target.value;
            if (x === '') delete form.st[k]; else form.st[k] = x === 'custom' ? '#808080' : ['f', 'bg', 'fg', 'bc'].includes(k) ? x : +x;
            redo();
          });
          fields.push(field(t(STYLE[k]), custom ? h('span', { className: 'row' }, pick, h('input', { type: 'color', value: v, 'aria-label': t('{name}: custom colour', { name: t(STYLE[k]) }), 'data-f': `rule:st:${k}:hex`, onchange: (e) => { form.st[k] = e.target.value; redo(); } })) : pick));
        }
      }
      const full = all.length >= P.MAX, why = [];
      if (!allowed.hide) why.push(t('This part can’t be hidden: it holds Glaze settings or the page’s own navigation.'));
      const add = () => {
        const raw = { p: form.part, do: form.act, ...(form.act === 'move' && { to: form.to, at: form.at }), ...(form.act === 'style' && { st: form.st }), ...(form.act === 'label' && { t: form.text }) };
        const next = full ? null : rules.add(all, raw);
        if (!next) return say(ruleSaid, full ? t('64 tweaks is the most a Look can have. Remove one first.') : form.act === 'style' ? t('Choose at least one change.') : form.act === 'label' ? t('Write the new text first.') : t('That tweak can’t be used here.'));
        Object.assign(form, { st: {}, text: '' });
        setRules(next, t('Added: {rule}. {n} of 64 tweaks.', { rule: describe(next.at(-1), t), n: next.length }));
      };
      const shown = inPreview(form.part);
      redraw(ruleBody, [
        h('div', { className: 'seg', role: 'radiogroup', 'aria-label': t('Site') }, Object.entries(SITES).map(([site, word]) => h('label', {}, h('input', { type: 'radio', name: 'xrules-site', value: site, checked: site === form.site, 'data-local': true, 'data-f': `rsite:${site}`, onchange: () => { form.site = site; a.preview(site); redo(); } }), word))),
        field(t('Part'), select(t('Part'), 'rule:part', groups.map(([g, l]) => ['group', t(g), l.map((p) => [p.name, p.label])]), form.part, (e) => { Object.assign(form, { part: e.target.value, st: {}, text: '' }); redo(); }, { 'aria-describedby': 'xrules-shown' })),
        h('p', { className: 'desc', id: 'xrules-shown', textContent: shown ? t('Shown in the preview.') : t('Not on the preview page, so the preview can’t show this one. It still applies on {site}.', { site: SITES[form.site] }) }),
        field(t('Change'), select(t('Change'), 'rule:act', Object.entries(ACTS).map(([k, w]) => [k, t(w), !allowed[k]]), form.act, (e) => { form.act = e.target.value; redo(); }, { 'aria-describedby': why.length ? 'xrules-why' : null })),
        why.length ? h('p', { className: 'desc', id: 'xrules-why', textContent: why.join(' ') }) : null,
        ...fields,
        h('div', { className: 'row' }, button(t('Add tweak'), 'rule:add', add, { 'aria-disabled': String(full) }), h('span', { className: 'desc', textContent: t('{n} of 64 tweaks.', { n: all.length }) })),
        h('h3', { textContent: t('Tweaks') }),
        h('p', { className: 'desc', id: 'xrules-reorder-note', textContent: t('When two tweaks change the same part, the later one wins. Drag a handle to reorder, or focus it and use the arrow keys.') }),
        all.length ? h('ol', { className: 'nav-editor-list', 'aria-label': t('Tweaks'), 'aria-describedby': 'xrules-reorder-note' }, all.map((r, at) => {
          const words = describe(r, t), step = (by) => { const to = at + by; if (to >= 0 && to < all.length) { focusRow(`r${at}`, `r${to}`); setRules(rules.move(all, at, to), t('{rule}: position {at} of {count}.', { rule: words, at: to + 1, count: all.length })); } };
          // Rows are keyed by place: a rule has no id, and the same rule may be there twice.
          return dropZone(h('li', {}, handle(words, `r${at}:drag`, 'xrules', at, step), h('span', { textContent: words }), ...updown(words, `r${at}`, at, all.length, step),
            button(t('Remove'), `r${at}:remove`, () => { focusTo = all.length > 1 ? `r${Math.min(at, all.length - 2)}:remove` : 'rule:add'; setRules(rules.remove(all, at), t('Removed: {rule}. {n} of 64 tweaks.', { rule: words, n: all.length - 1 })); }, { 'aria-label': `${t('Remove')} · ${words}` })),
          'xrules', (from) => { if (from !== at) { focusRow(`r${from}`, `r${at}`); setRules(rules.move(all, from, at), t('{rule}: position {at} of {count}.', { rule: describe(all[from], t), at: at + 1, count: all.length })); } });
        })) : h('p', { className: 'desc', textContent: t('No tweaks yet.') }),
      ]);
    };
    renders = [renderNav, renderRules];
    render();
  };

  return { put, fromMine, nav, rules, describe, parts, groupOf, can, beside, choices, NAMES, TYPICAL, FRESH, GROUPS_MAX, LINKS_MAX, mount, render };
})();
if (typeof module !== 'undefined') module.exports = GZ_XEDIT;
