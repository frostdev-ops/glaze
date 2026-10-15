// Canvas's rail uses CSS at first paint.
// shortcut: cold local pictures start with their fill; revisit if their first paint must block.
var GZ_NAV_UI = globalThis.GZ_NAV_UI || (() => {
  const X = globalThis.GZ_CTX;
  let reading = '', loaded = null, toggle = null;
  const titled = new Map();
  const labels = new Set();
  const forget = () => { if (loaded) URL.revokeObjectURL(loaded.src); loaded = null; };
  const sync = () => {
    const n = X.nav();
    const on = X.on() && X.settings().enabled;
    for (const [a, text] of titled) if (a.isConnected === false) { if (a.getAttribute('title') === text) a.removeAttribute('title'); titled.delete(a); }
    const b = X.site === 'ultra' ? null : document.getElementById('primaryNavToggle');
    for (const el of labels) if (!on || (!n.collapsed && n.labels !== 'icons') || !el.isConnected) { el.classList.remove('gz-nav-label'); labels.delete(el); }
    if (X.site === 'ultra' && on && (n.collapsed || n.labels === 'icons')) {
      for (const a of document.querySelectorAll(':is(nav:has(> #base_tools), nav#base_tools) a.base-navigation-button-content')) {
        for (const el of a.querySelectorAll('.MuiListItemText-root, .MuiTypography-root, span:not(:has(svg))')) {
          if (!el.querySelector('svg') && !el.closest('.MuiBadge-root') && el.textContent.trim() && !labels.has(el)) { el.classList.add('gz-nav-label'); labels.add(el); }
        }
      }
    }
    if (on && (n.collapsed || n.labels === 'icons')) {
      for (const a of document.querySelectorAll(X.site === 'ultra' ? ':is(nav:has(> #base_tools), nav#base_tools) a.base-navigation-button-content' : '#header .ic-app-header__menu-list-link')) if (!titled.has(a) && !a.hasAttribute('title')) {
        const text = a.getAttribute('aria-label') || a.textContent.trim();
        if (text) { titled.set(a, text); a.title = text; }
      }
    } else {
      for (const [a, text] of titled) if (a.getAttribute('title') === text) a.removeAttribute('title');
      titled.clear();
    }
    if (on && n.collapsed && b) {
      if (toggle?.el !== b) toggle = { el: b, label: b.getAttribute('aria-label'), title: b.getAttribute('title') };
      const text = X.t('Expand global navigation');
      if (b.getAttribute('aria-label') !== text) { b.setAttribute('aria-label', text); b.title = text; }
    } else if (toggle) {
      for (const k of ['label', 'title']) {
        const a = k === 'label' ? 'aria-label' : k;
        if (toggle[k] === null) toggle.el.removeAttribute(a); else toggle.el.setAttribute(a, toggle[k]);
      }
      toggle = null;
    }
    if (!on || !n.i) {
      reading = ''; forget();
      return;
    }
    if (reading === n.i) { if (loaded?.id === n.i) X.repaintNav(loaded.src); return; }
    reading = n.i;
    forget();
    X.local((area) => area.get(`cardImg:${n.i}`, (r) => {
      if (!X.on() || X.nav().i !== n.i || reading !== n.i) return;
      const src = r?.[`cardImg:${n.i}`];
      if (typeof src !== 'string' || src.length > 400000 || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(src)) return;
      const [type, bytes] = src.split(',');
      let decoded;
      try { decoded = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)); } catch { return; }
      const blob = new Blob([decoded], { type: type.slice(5, type.indexOf(';')) });
      loaded = { id: n.i, src: URL.createObjectURL(blob) };
      X.repaintNav(loaded.src);
    }));
  };
  document.addEventListener('click', (e) => {
    if (!X.on() || !X.nav().collapsed || !e.target.closest?.('#primaryNavToggle')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    chrome.runtime.sendMessage({ type: 'glaze:nav', nav: { collapsed: false } }).then((r) => {
      if (r?.ok && X.on()) document.body.classList.add('primary-nav-expanded');
    }).catch(() => {});
  }, true);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && X.nav().i && c[`cardImg:${X.nav().i}`]) { reading = ''; sync(); }
  });
  return { sync };
})();
GZ_NAV_UI;
