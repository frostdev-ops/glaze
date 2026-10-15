// Canvas's rail uses CSS at first paint. Only local pictures and the collapsed native toggle need more code.
var GZ_NAV_UI = globalThis.GZ_NAV_UI || (() => {
  const X = globalThis.GZ_CTX;
  let reading = '', loaded = null, toggle = null;
  const titled = new Map();
  const sync = () => {
    const n = X.nav();
    const on = X.on() && X.settings().enabled;
    const b = document.getElementById('primaryNavToggle');
    if (on && (n.collapsed || n.labels === 'icons')) {
      for (const a of document.querySelectorAll('#header .ic-app-header__menu-list-link')) if (!titled.has(a) && !a.hasAttribute('title')) {
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
      reading = ''; loaded = null;
      try { sessionStorage.removeItem('gz-nav-picture'); } catch { /* blocked */ }
      return;
    }
    if (reading === n.i) { if (loaded?.id === n.i) X.repaintNav(loaded.src); return; }
    reading = n.i;
    X.local((area) => area.get(`cardImg:${n.i}`, (r) => {
      if (!X.on() || X.nav().i !== n.i || reading !== n.i) return;
      const src = r?.[`cardImg:${n.i}`];
      if (typeof src !== 'string' || src.length > 400000 || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(src)) return;
      loaded = { id: n.i, src };
      try { sessionStorage.setItem('gz-nav-picture', JSON.stringify({ id: n.i, src })); } catch { /* full */ }
      X.repaintNav(src);
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
