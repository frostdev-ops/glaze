// Extension settings page only. DOM ownership drives resets and coverage; no LMS startup imports.
var GZ_EDITOR = (() => {
  const keys = (root) => [...new Set([...root.querySelectorAll('[data-key], input[type="radio"], [data-setting-owner]')].flatMap((el) =>
    el.dataset.settingOwner?.split(/\s+/) || (el.dataset.key ? [el.dataset.key] : !el.hasAttribute('data-local') && el.name.includes('.') ? [el.name] : [])))];
  const reset = (state, paths, defaults) => {
    const touched = new Set();
    const expand = (path, value) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).length ? Object.keys(value).flatMap((k) => expand(`${path}.${k}`, value[k])) : [path];
    for (const path of paths.flatMap((path) => expand(path, path.split('.').reduce((o, k) => o?.[k], defaults)))) {
      // A preference reset must not delete a palette library or orphan locally stored pictures.
      if (['presets', 'nav.i', 'nav.li'].includes(path) || path.startsWith('navItems.')) continue;
      const parts = path.split('.'), key = parts.pop(), group = parts[0] || key;
      const target = parts.reduce((o, k) => o?.[k], state), source = parts.reduce((o, k) => o?.[k], defaults);
      if (!target || !source || !Object.hasOwn(source, key)) continue;
      target[key] = structuredClone(source[key]); touched.add(group);
    }
    return [...touched];
  };
  const mount = ({ doc = document, onRoute = () => {} } = {}) => {
    const tabs = [...doc.querySelectorAll('[data-editor-tab]')], panels = [...doc.querySelectorAll('[data-editor-panel]')];
    const sections = [...doc.querySelectorAll('[data-editor-section]')], routes = new Map(sections.map((s) => [s.dataset.editorSection, s]));
    const first = (tab) => sections.find((s) => s.dataset.editorSection.startsWith(`${tab}/`))?.dataset.editorSection;
    const legacy = new Map([...doc.querySelectorAll('[data-editor-section], [data-editor-section] [id]')].filter((s) => s.id).map((s) => [s.id, s.closest('[data-editor-section]').dataset.editorSection]));
    let route = '', finding = false, searchScroll = null;
    const resolve = (hash) => {
      const value = hash.replace(/^#/, '');
      return routes.has(value) ? value : legacy.get(value) || first(value) || first('look');
    };
    const show = (next, { scroll = false, focus = false, remember = false } = {}) => {
      route = resolve(next); const tab = route.split('/')[0];
      for (const el of tabs) { const active = el.dataset.editorTab === tab; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; if (active && focus) el.focus(); }
      for (const el of panels) el.hidden = !finding && el.dataset.editorPanel !== tab;
      if (remember) chrome.storage.local.set({ editorTab: tab }).catch(() => {});
      if (scroll) routes.get(route).scrollIntoView({ block: 'start' });
      onRoute(route);
    };
    for (const el of tabs) {
      const activate = (tab) => { const next = first(tab); if (location.hash !== `#${next}`) location.hash = next; show(next, { focus: true, remember: true }); };
      el.addEventListener('click', () => activate(el.dataset.editorTab));
      el.addEventListener('keydown', (e) => {
        const at = tabs.indexOf(el), index = { ArrowRight: (at + 1) % tabs.length, ArrowLeft: (at + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
        if (index === undefined) return; e.preventDefault(); activate(tabs[index].dataset.editorTab);
      });
    }
    addEventListener('hashchange', () => show(location.hash, { scroll: true, remember: true }));
    show(location.hash);
    if (!location.hash) chrome.storage.local.get('editorTab').then((r) => { if (!location.hash) show(first(r.editorTab) || first('look')); }).catch(() => {});
    return { keys, reset, route: () => route, show, finding: (on) => {
      if (on && !finding) searchScroll = { route, y: scrollY };
      if (!on && finding && searchScroll?.route === route) requestAnimationFrame(() => scrollTo({ top: searchScroll.y }));
      finding = on;
      for (const panel of panels) { panel.setAttribute('role', on ? 'region' : 'tabpanel'); panel.hidden = !on && panel.dataset.editorPanel !== route.split('/')[0]; }
    } };
  };
  return { keys, reset, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR;
