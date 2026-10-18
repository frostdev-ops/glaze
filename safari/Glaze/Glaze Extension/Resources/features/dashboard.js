// The Glaze Dashboard on Blackboard Ultra (B7b), loaded on demand. Ultra's Institution page gets two tabs in its header:
// Dashboard (the default: Glaze's board of widgets, features/widgets.js, and the page's heading says Dashboard) and
// Institution page (Ultra's own page and heading, themed, with nothing over it). The last one chosen is kept on this
// device (storage.local dashTab). Until a tab is chosen the page shows the Dashboard and Ultra's own page waits hidden
// (content-ultra.js sets html[data-gz-dash], apps.css); a page without the header's anchors gets the tabs above the board.
// Opt-in (widgets.land, off by default): when Ultra opens on its start page right after sign-in (lib/widgets.js landing),
// go on to the Dashboard, once in this tab (the worker remembers the tab: 'glaze:landed'), through Ultra's own nav link
// when it's there, and only if the student hasn't done anything on the page meanwhile. It asks nothing of Blackboard.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DASH_UI = globalThis.GZ_DASH_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const html = document.documentElement;
  const PATH = '/ultra/institution-page';
  const local = () => { try { return chrome.storage.local; } catch { return null; } };
  let tab = 'dash', chosen = false, bar = null, board = null;
  try { local()?.get('dashTab', (r) => { if (!chosen && !chrome.runtime.lastError && r?.dashTab === 'ip') { tab = 'ip'; if (board) show(); } }); } catch { /* reloaded */ }

  // The page's heading says Dashboard on that tab; Ultra's own words come back on the other, and when the tabs go.
  const title = (dash) => {
    const h = document.querySelector('h1#main-heading');
    if (!h) return;
    if (dash) {
      if (h.dataset.gzDashReal === undefined) h.dataset.gzDashReal = h.textContent;
      if (h.textContent !== t('Dashboard')) h.textContent = t('Dashboard');
    } else if (h.dataset.gzDashReal !== undefined) {
      if (h.textContent === t('Dashboard')) h.textContent = h.dataset.gzDashReal;
      delete h.dataset.gzDashReal;
    }
  };
  const show = (focus) => {
    html.setAttribute('data-gz-dash', tab);
    if (board) board.hidden = tab !== 'dash';
    title(tab === 'dash');
    for (const b of bar?.children || []) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
  };
  const pick = (next, focus) => {
    chosen = true;
    tab = next;
    try { local()?.set({ dashTab: tab }); } catch { /* reloaded */ }
    if (board) show(focus);
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
    box.firstElementChild.setAttribute('aria-controls', 'gz-dash');
    box.addEventListener('keydown', (e) => {
      const i = ['dash', 'ip'].indexOf(tab);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      pick(['dash', 'ip'][(to + 2) % 2], true);
    });
    return box;
  };
  // tabs(el): put the tabs in the page's header (its tools slot, else right after its heading, else right above the
  // board) for the board el, the Dashboard's tab panel; tabs(null) takes them away and gives the heading back. Called
  // again on every pass: it moves nothing that's in place.
  const tabs = (el) => {
    board = el;
    if (!el) { bar?.remove(); title(false); return; }
    const slot = document.querySelector('div.base-header-tools-transclude');
    const h1 = document.querySelector('h1#main-heading');
    bar ||= make();
    if (slot) { if (bar.parentNode !== slot) slot.prepend(bar); } else if (h1) { if (h1.nextElementSibling !== bar) h1.after(bar); } else if (el.previousElementSibling !== bar) el.before(bar);
    el.setAttribute('role', 'tabpanel');
    el.setAttribute('aria-labelledby', 'gz-dash-tab-dash');
    show();
  };

  // The opt-in landing, from the first pass of a page Ultra loaded at `from`. Asked again right before it goes: the
  // student may have clicked, typed or scrolled while this file and the settings came (ctx.acted), or gone to another
  // page (a new history entry; Ultra's own move to its start page replaces the address).
  const ask = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  let len = 0;
  const still = (from) => {
    const s = ctx.settings();
    // The first content settings may predate this lazy schema; the worker checks the saved opt-in before granting it.
    return s.enabled && s.enhance.dashboard && s.widgets?.land !== false && !ctx.acted() && history.length === len && GZ_WIDGETS.landing({ from, now: location.pathname, referrer: document.referrer, origin: location.origin });
  };
  const land = async (from) => {
    len = history.length;
    const s = await new Promise((res) => { try { chrome.storage.sync.get('widgets', (r) => res(chrome.runtime.lastError ? {} : r)); } catch { res({}); } });
    if (s?.widgets?.land !== true || ctx.acted()) return;
    // A reload or Back to the start page isn't a new sign-in.
    if ((performance.getEntriesByType?.('navigation')[0]?.type || 'navigate') !== 'navigate') return;
    await ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS);
    if (!still(from)) return;
    // The worker marks this tab before it goes (in its session storage, which the page can't read): once in a tab. If it
    // can't, it doesn't go.
    if ((await ask({ type: 'glaze:landed' }))?.first !== true || !still(from)) return;
    pick('dash');
    const link = [...document.querySelectorAll('a[href]')].find((a) => { try { const u = new URL(a.getAttribute('href'), location.href); return u.origin === location.origin && u.pathname === PATH; } catch { return false; } });
    // Absolute: Ultra's <base href> is its CDN's.
    if (link) link.click(); else location.assign(`${location.origin}${PATH}`);
  };

  return { tabs, land, PATH };
})();

GZ_DASH_UI;
