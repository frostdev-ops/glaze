// The Glaze Dashboard on Blackboard Ultra (B7b), loaded on demand. Ultra's Institution page gets two tabs in its header:
// Dashboard (the default: Glaze's board of widgets, features/widgets.js) and Institution page (Ultra's own page, themed,
// with nothing over it). The last one chosen is kept on this device (storage.local dashTab). Until a tab is chosen the
// page shows the Dashboard and Ultra's own page waits hidden (content-ultra.js sets html[data-gz-dash], apps.css).
// Opt-in (widgets.land, off by default): when Ultra opens on its start page right after sign-in (lib/widgets.js landing),
// go on to the Dashboard, once in this tab (sessionStorage gz-landed), through Ultra's own nav link when it's there.
// It asks nothing of Blackboard. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DASH_UI = globalThis.GZ_DASH_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const html = document.documentElement;
  const PATH = '/ultra/institution-page';
  const local = () => { try { return chrome.storage.local; } catch { return null; } };
  let tab = 'dash', bar = null, board = null;
  try { local()?.get('dashTab', (r) => { if (!chrome.runtime.lastError && r?.dashTab === 'ip') { tab = 'ip'; if (board) show(); } }); } catch { /* reloaded */ }

  const show = (focus) => {
    html.setAttribute('data-gz-dash', tab);
    if (board) board.hidden = tab !== 'dash';
    for (const b of bar?.children || []) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  };
  const pick = (next, focus) => {
    if (next !== tab) { tab = next; try { local()?.set({ dashTab: tab }); } catch { /* reloaded */ } }
    show(focus);
  };
  // A real tablist: the chosen tab is the one in the Tab order; the arrow keys, Home and End move between them and choose.
  const make = () => {
    const box = document.createElement('div');
    box.className = 'gz-dash-tabs';
    box.setAttribute('role', 'tablist');
    box.setAttribute('aria-label', 'Glaze');
    for (const [id, name] of [['dash', 'Dashboard'], ['ip', 'Institution page']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `gz-dash-tab-${id}`;
      b.dataset.tab = id;
      b.setAttribute('role', 'tab');
      b.textContent = t(name);
      b.addEventListener('click', () => pick(id));
      box.append(b);
    }
    box.firstChild.setAttribute('aria-controls', 'gz-dash');
    box.addEventListener('keydown', (e) => {
      const i = ['dash', 'ip'].indexOf(tab);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      pick(['dash', 'ip'][(to + 2) % 2], true);
    });
    return box;
  };
  // tabs(el): put the tabs in the page's header (its tools slot, else right after its heading) for the board el, the
  // Dashboard's tab panel; tabs(null) takes them away. Called again on every pass: it moves nothing that's in place.
  const tabs = (el) => {
    board = el;
    if (!el) { bar?.remove(); return; }
    const slot = document.querySelector('div.base-header-tools-transclude');
    const h1 = document.querySelector('h1#main-heading');
    bar ||= make();
    if (slot ? bar.parentNode !== slot : h1 && h1.nextElementSibling !== bar) { if (slot) slot.prepend(bar); else h1?.after(bar); }
    el.setAttribute('role', 'tabpanel');
    el.setAttribute('aria-labelledby', 'gz-dash-tab-dash');
    show();
  };

  // The opt-in landing, from the first pass of a page Ultra loaded at `from`.
  const land = async (from) => {
    const s = await new Promise((res) => { try { chrome.storage.sync.get('widgets', (r) => res(chrome.runtime.lastError ? {} : r)); } catch { res({}); } });
    if (s?.widgets?.land !== true) return;
    try { if (sessionStorage.getItem('gz-landed')) return; } catch { return; }
    // A reload or Back to the start page isn't a new sign-in.
    if ((performance.getEntriesByType?.('navigation')[0]?.type || 'navigate') !== 'navigate') return;
    await ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS);
    if (!GZ_WIDGETS.landing({ from, now: location.pathname, referrer: document.referrer, origin: location.origin })) return;
    // Marked before it goes, so it can't happen twice in this tab; if it can't be marked, it doesn't go.
    try { sessionStorage.setItem('gz-landed', '1'); } catch { return; }
    pick('dash');
    const link = [...document.querySelectorAll(`a[href$="${PATH}"]`)].find((a) => new URL(a.href, location.href).pathname === PATH);
    if (link) link.click(); else location.assign(PATH);
  };

  return { tabs, land, PATH };
})();

GZ_DASH_UI;
