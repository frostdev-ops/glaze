// The editor's Navigation items (the Navigation tab): every item of Glaze's own bar with its name, icon, group and order,
// whether it shows, the four on a phone's bar, Glaze's own items (opt-in), its widgets and the student's links. It edits sync
// navbarItems, cleaned by lib/navbar.js exactly as the bar cleans it, and shows the bar's own grouping (GZ_NAVBAR.build),
// so what is listed here is what the bar draws. Extension options page only (mount); `rows` is for node tests.
var GZ_NAVBAREDIT = globalThis.GZ_NAVBAREDIT || (() => {
  const M = () => (typeof GZ_NAVBAR !== 'undefined' ? GZ_NAVBAR : require('./navbar.js'));
  const NI = () => (typeof GZ_NAV_ITEMS !== 'undefined' ? GZ_NAV_ITEMS : require('./nav-items.js'));
  // Blackboard Ultra's items the bar shows (the account and signing out sit at its foot), by their English names.
  const ULTRA = ['institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools'];
  const NAMES = { 'institution-page': 'Institution page', stream: 'Activity', course: 'Courses', organization: 'Organizations', calendar: 'Calendar', messages: 'Messages', grades: 'Grades', tools: 'Tools', dashboard: 'Dashboard', home: 'Site home', groups: 'Groups', history: 'History', help: 'Help', admin: 'Admin', notifications: 'Notifications' };
  const GLAZE = { notes: 'Notes', todo: 'To Do', search: 'Search', settings: 'Glaze settings' };
  // Glaze's widgets in the bar (features/navbar-widgets.js), by their English names and icons.
  const WIDGETS = { clock: ['Clock and date', 'history'], next: ['Next due', 'calendar'], timer: ['Focus timer', 'timer'], pet: ['Pet habitat', 'star'] };
  const MAX_BYTES = 8000;

  // The groups as the bar has them, every item in its place, hidden ones too: [{ label, items: [{ id, name, icon, hidden, tab, link }] }].
  const rows = (prefs, { legacy = null, names = (id) => NAMES[id] || id } = {}) => {
    const p = M().clean(prefs);
    const native = ULTRA.map((id) => ({ id, label: names(id) }));
    // Built with everything shown, to know where each item goes; the student's own hiding is read from p.
    const shownAll = { ...p, items: Object.fromEntries(Object.entries(p.items).map(([id, v]) => { const { hidden, ...rest } = v; return [id, rest]; })) };
    const m = M().build({ native, prefs: shownAll, legacy: legacy ? { ...legacy, hidden: [] } : null, names: { notes: names('glaze:notes'), todo: names('glaze:todo'), search: names('glaze:search'), settings: names('glaze:settings') } });
    const real = M().build({ native, prefs: p, legacy, names: {} });
    const tabs = new Set(real.tabs.map((i) => i.id));
    const hidden = new Set(real.items.filter((i) => i.hidden).map((i) => i.id));
    const groups = p.groups.length ? p.groups.map((g) => ({ label: g.label || '', items: [] })) : m.groups.map(() => ({ label: '', items: [] }));
    const byGroup = new Map(m.groups.map((g, at) => [g.id, at]));
    for (const g of m.groups) {
      const at = p.groups.length ? Number(g.id.slice(1)) : byGroup.get(g.id);
      for (const i of g.items) (groups[at] || groups.at(-1)).items.push({ id: i.id, name: i.label, icon: i.icon, hidden: hidden.has(i.id), tab: tabs.has(i.id), link: i.id.startsWith('link:') ? i.id.slice(5) : '', own: !!p.links.find((l) => `link:${l.id}` === i.id) });
    }
    if (groups.length < 2) groups.push({ label: '', items: [] });
    return groups;
  };

  const mount = ({ t, settings, hint = () => {} }) => {
    const $ = (q) => document.querySelector(q);
    const node = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
    const svg = (name) => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
      const p = document.createElementNS(s.namespaceURI, 'path'); p.setAttribute('d', M().ICONS[name] || M().ICONS.link); s.append(p); return s;
    };
    const box = $('#nbar-items');
    if (!box) return null;
    let prefs = M().clean(), legacy = null, written = '', picking = '', drag = null, armed = 0;
    let saved = prefs, revision = 0, writing = 0, writes = Promise.resolve();
    const names = (id) => (id.startsWith('glaze:') ? t(GLAZE[id.slice(6)]) : t(id === 'institution-page' && settings().enhance.dashboard ? 'Dashboard' : NAMES[id] || id));
    const say = (text, bad = false) => { $('#nbar-status').textContent = text; if (bad) hint(text, true); };
    const write = async (next) => {
      const clean = M().clean(next);
      if (new TextEncoder().encode(JSON.stringify({ navbarItems: clean })).length > MAX_BYTES) { say(t('Too much to keep in sync. Remove a link or some names first.'), true); render(); return false; }
      const at = ++revision;
      writing++;
      prefs = clean; written = JSON.stringify(clean);
      render();
      const ok = await (writes = writes.then(async () => {
        try { await chrome.storage.sync.set({ navbarItems: clean }); saved = clean; return true; } catch { return false; }
      }));
      writing--;
      if (at === revision) {
        if (!ok) { prefs = saved; written = JSON.stringify(prefs); render(); }
        say(t(ok ? 'Saved' : 'Not saved. Try again in a moment.'), !ok);
      }
      if (!writing) load();
      return ok;
    };
    // The order of every group as shown, written whole once the student changes it.
    const groupsOf = (gs) => gs.map((g) => ({ ...(g.label && { label: g.label }), items: g.items.map((i) => i.id) }));
    const moveTo = (gs, id, group, at) => {
      const out = gs.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== id) }));
      const item = gs.flatMap((g) => g.items).find((i) => i.id === id);
      out[group].items.splice(Math.max(0, Math.min(at, out[group].items.length)), 0, item);
      return out;
    };
    const render = () => {
      const focus = document.activeElement?.closest?.('#nbar-items li') ? [document.activeElement.closest('li').dataset.id, document.activeElement.dataset.nb] : null;
      const gs = rows(prefs, { legacy, names });
      const tabCount = gs.flatMap((g) => g.items).filter((i) => i.tab).length;
      const lists = gs.map((g, gi) => {
        const name = node('input', { type: 'text', value: g.label, maxLength: 24, placeholder: t('Group {n}', { n: gi + 1 }) });
        name.setAttribute('aria-label', t('Name of group {n}', { n: gi + 1 }));
        name.addEventListener('change', () => { const next = gs.map((x, i) => (i === gi ? { ...x, label: name.value.trim() } : x)); write({ ...prefs, groups: groupsOf(next) }); });
        const drop = !g.items.length && gs.length > 2 ? node('button', { type: 'button', textContent: t('Remove group') }) : null;
        drop?.addEventListener('click', () => write({ ...prefs, groups: groupsOf(gs.filter((_, i) => i !== gi)) }));
        const ul = node('ul', { className: 'nb-list' });
        ul.dataset.group = gi;
        g.items.forEach((item, at) => {
          const li = node('li');
          li.dataset.id = item.id;
          if (item.hidden) li.dataset.hidden = '';
          const grip = node('button', { type: 'button', className: 'nb-grip', textContent: '↕', draggable: true });
          grip.dataset.nb = 'grip';
          grip.setAttribute('aria-label', t('Reorder {name}', { name: item.name }));
          grip.setAttribute('aria-describedby', 'nbar-reorder-note');
          grip.addEventListener('keydown', (e) => {
            const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
            if (!by) return;
            e.preventDefault();
            // Past the end of a group, into the next one (or the one before).
            if (at + by < 0 && gi > 0) write({ ...prefs, groups: groupsOf(moveTo(gs, item.id, gi - 1, gs[gi - 1].items.length)) });
            else if (at + by >= g.items.length && gi < gs.length - 1) write({ ...prefs, groups: groupsOf(moveTo(gs, item.id, gi + 1, 0)) });
            else if (at + by >= 0 && at + by < g.items.length) write({ ...prefs, groups: groupsOf(moveTo(gs, item.id, gi, at + by)) });
          });
          grip.addEventListener('dragstart', (e) => { drag = item.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id); });
          grip.addEventListener('dragend', () => { drag = null; for (const r of box.querySelectorAll('[data-drop]')) delete r.dataset.drop; });
          li.addEventListener('dragover', (e) => { if (drag && drag !== item.id) { e.preventDefault(); li.dataset.drop = ''; } });
          li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) delete li.dataset.drop; });
          li.addEventListener('drop', (e) => { if (!drag) return; e.preventDefault(); const id = drag; drag = null; write({ ...prefs, groups: groupsOf(moveTo(gs, id, gi, at)) }); });
          const ic = node('button', { type: 'button', className: 'nb-icon' }, svg(item.icon));
          ic.dataset.nb = 'icon';
          ic.setAttribute('aria-label', t('Icon for {name}', { name: item.name }));
          ic.setAttribute('aria-expanded', String(picking === item.id));
          ic.addEventListener('click', () => { picking = picking === item.id ? '' : item.id; render(); });
          const label = node('input', { type: 'text', className: 'nb-name', value: prefs.items[item.id]?.label || '', placeholder: item.own || item.link ? item.name : names(item.id), maxLength: 40 });
          label.dataset.nb = 'name';
          label.setAttribute('aria-label', t('Name for {name}', { name: item.name }));
          label.addEventListener('change', () => { const v = label.value.trim(); const { label: _l, ...rest } = prefs.items[item.id] || {}; write({ ...prefs, items: { ...prefs.items, [item.id]: v ? { ...rest, label: v } : rest } }); });
          const check = (text, on, run, disabled = false, nb) => { const c = node('input', { type: 'checkbox', checked: on, disabled }); c.dataset.nb = nb; c.addEventListener('change', () => run(c.checked)); return node('label', {}, c, t(text)); };
          const tools = node('span', { className: 'nb-tools' },
            check('Shown', !item.hidden, (v) => write({ ...prefs, items: { ...prefs.items, [item.id]: { ...prefs.items[item.id], hidden: !v } } }), false, 'shown'),
            check('Phone tab', item.tab, (v) => {
              const now = gs.flatMap((x) => x.items).filter((i) => i.tab).map((i) => i.id);
              write({ ...prefs, tabs: v ? [...now, item.id] : now.filter((id) => id !== item.id) });
            }, !item.tab && tabCount >= 4, 'tab'),
            item.own ? (() => { const b = node('button', { type: 'button', className: 'danger', textContent: t('Remove') }); b.setAttribute('aria-label', `${t('Remove')} · ${item.name}`); b.addEventListener('click', () => write({ ...prefs, links: prefs.links.filter((l) => l.id !== item.link), groups: prefs.groups.length ? groupsOf(gs).map((x) => ({ ...x, items: x.items.filter((id) => id !== item.id) })) : [], tabs: prefs.tabs.filter((id) => id !== item.id) })); return b; })() : null);
          li.append(grip, ic, label, tools);
          if (picking === item.id) {
            const picker = node('div', { className: 'nb-picker', role: 'group' });
            picker.setAttribute('aria-label', t('Icon for {name}', { name: item.name }));
            for (const name of M().PICKS) {
              const b = node('button', { type: 'button', title: name }, svg(name));
              b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', String(item.icon === name));
              b.addEventListener('click', () => { picking = ''; write({ ...prefs, items: { ...prefs.items, [item.id]: { ...prefs.items[item.id], icon: name } } }); });
              picker.append(b);
            }
            li.append(picker);
          }
          ul.append(li);
        });
        return node('div', {}, node('h4', {}, name, drop), ul);
      });
      const add = gs.length < 8 ? node('button', { type: 'button', textContent: t('Add a group') }) : null;
      add?.addEventListener('click', () => write({ ...prefs, groups: [...groupsOf(gs), { items: [] }] }));
      box.replaceChildren(node('p', { className: 'desc', id: 'nbar-reorder-note', textContent: t('Drag a handle to reorder, or focus it and use the arrow keys; past the end of a group, an item moves into the next one.') }),
        node('div', { className: 'nb-groups' }, ...lists), node('div', { className: 'row' }, add));
      // Glaze's own items.
      $('#nbar-glaze').replaceChildren(...Object.keys(GLAZE).map((g) => {
        const c = node('input', { type: 'checkbox', checked: prefs.glaze.includes(g) });
        c.addEventListener('change', () => write({ ...prefs, glaze: c.checked ? [...prefs.glaze, g] : prefs.glaze.filter((x) => x !== g) }));
        return node('label', {}, c, svg(g === 'settings' ? 'glaze' : g), t(GLAZE[g]));
      }));
      // Glaze's widgets: the student's once they choose, else what the bar shows now (the older rail's).
      const shown = M().build({ prefs, legacy }).widgets;
      $('#nbar-widgets').replaceChildren(...Object.keys(WIDGETS).map((id) => {
        const on = shown.find((w) => w.id === id), name = t(WIDGETS[id][0]);
        const pick = (next) => write({ ...prefs, widgets: Object.keys(WIDGETS).map((w) => (w === id ? next : shown.find((x) => x.id === w))).filter(Boolean) });
        const c = node('input', { type: 'checkbox', checked: !!on });
        const at = node('select', {}, node('option', { value: 'top', textContent: t('Top') }), node('option', { value: 'bottom', textContent: t('Bottom') }));
        at.value = on?.at || 'bottom'; at.disabled = !on; at.setAttribute('aria-label', name);
        c.addEventListener('change', () => pick(c.checked ? { id, at: at.value } : null));
        at.addEventListener('change', () => pick({ id, at: at.value }));
        return node('li', {}, node('label', {}, c, svg(WIDGETS[id][1]), name), at);
      }));
      $('#nbar-links').replaceChildren(...prefs.links.map((l) => node('li', {}, svg(l.i), node('span', { className: 'nb-name', textContent: l.n }), node('span', { className: 'desc', textContent: new URL(l.u).hostname, translate: false }))));
      if (focus) box.querySelector(`li[data-id="${CSS.escape(focus[0])}"] [data-nb="${focus[1]}"]`)?.focus();
    };
    $('#nbar-link-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (prefs.links.length >= 8) return say(t('Up to eight links.'), true);
      const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      const link = NI().link({ id, n: $('#nbar-link-name').value, u: $('#nbar-link-url').value.trim(), i: 'link', tab: $('#nbar-link-tab').checked });
      if (!link) return say(t('Use an http or https link and a name.'), true);
      const gs = rows(prefs, { legacy, names });
      write({ ...prefs, links: [...prefs.links, link], ...(prefs.groups.length && { groups: [...groupsOf(gs).slice(0, -1), { ...groupsOf(gs).at(-1), items: [...groupsOf(gs).at(-1).items, `link:${id}`] }] }) })
        .then((ok) => { if (ok) e.target.reset(); });
    });
    $('#nbar-reset').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (!armed) { b.textContent = t('Click again to reset'); armed = setTimeout(() => { armed = 0; b.textContent = t('Reset items'); }, 4000); return; }
      clearTimeout(armed); armed = 0; b.textContent = t('Reset items');
      write(M().clean());
    });
    const load = () => {
      const at = revision;
      return chrome.storage.sync.get(['navbarItems', 'navItems']).then((r) => {
        if (writing || at !== revision) return;
        prefs = saved = M().clean(r.navbarItems); written = JSON.stringify(prefs); legacy = r.navItems ? NI().clean(r.navItems) : null; render();
      }, () => {});
    };
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'sync') return;
      if (c.navItems) legacy = c.navItems.newValue ? NI().clean(c.navItems.newValue) : null;
      if (c.navbarItems && !writing && JSON.stringify(M().clean(c.navbarItems.newValue)) !== written) { load(); return; }
      if (c.navItems || c.navbarItems) render();
    });
    load();
    return { render, load };
  };
  return { mount, rows, ULTRA, NAMES };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAVBAREDIT; else GZ_NAVBAREDIT;
