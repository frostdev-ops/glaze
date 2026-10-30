// Glaze — "Use Glaze on example.edu?": the question lib/background.js puts on a page that looks like an LMS, on a site the
// student hasn't approved (Canvas or Moodle on a school's own address, found by lib/detect.js; Blackboard Ultra off
// blackboard.com). Nothing of Glaze runs on the site before Yes. Yes puts Glaze there for good (Settings' Sites takes it off
// again); Not now leaves the site alone for a week (the worker keeps when). Top frame only, never while Glaze is off.
// It is the reminders' toast (features/apps.css .gz-rm-toast) in the student's palette, in a closed shadow root the page
// can't reach into or restyle, and in the top layer where the browser has one. It never takes focus; it comes first in the
// page's tab order, as a landmark, and a screen reader hears it arrive (a polite live region). Escape puts it away for this
// page. Only the student's own click counts: a page can click a button itself, but that click isn't trusted, and where the
// browser can tell (IntersectionObserver v2), Yes must also have been in full view, uncovered and still, for half a second.
var GZ_CONSENT = globalThis.GZ_CONSENT || (() => {
  const lang = () => { try { return Intl.getCanonicalLocales(document.documentElement.lang.replace(/_/g, '-'))[0] || navigator.language; } catch { return navigator.language; } };
  const t = (key, vars) => GZ_I18N.t(key, vars, lang());
  const LMS = { canvas: 'Canvas', moodle: 'Moodle', ultra: 'Blackboard Ultra' };
  // The palette's roles the toast uses, and the editor's Frost where a role is missing.
  const ROLES = { '--gz-accent': '#17c8f4', '--gz-accent-ink': '#04121f', '--gz-surface': '#0d1b2e', '--gz-surface-2': '#060d18', '--gz-ink': '#e8f2fa', '--gz-ink-muted': '#8fa8c0', '--gz-line-strong': '#24405f' };
  const CSS = `:host { all: initial; }
.bar { ${Object.entries(ROLES).map(([k, v]) => `${k}: ${v};`).join(' ')}
  position: fixed; inset: auto; inset-inline-end: 16px; inset-block-end: 16px; z-index: 2147483647; box-sizing: border-box; width: min(360px, calc(100vw - 32px));
  margin: 0; padding: 0.6rem 0.75rem 0.7rem; overflow: visible; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; text-align: start; color: var(--gz-ink);
  background: var(--gz-surface); border: 1px solid var(--gz-line-strong); border-inline-start: 3px solid var(--gz-accent); border-radius: 12px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.3); }
.what { margin: 0; font-size: 12px; font-weight: 600; color: var(--gz-accent); }
.title { display: block; margin-top: 0.1rem; font-weight: 600; }
.sub, .note { margin: 0.15rem 0 0; font-size: 13px; color: var(--gz-ink-muted); }
.note:empty { display: none; }
.row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.55rem; }
button { margin: 0; padding: 0.3rem 0.8rem; font: inherit; font-size: 13px; color: var(--gz-ink); background: var(--gz-surface-2); border: 1px solid var(--gz-line-strong); border-radius: 999px; cursor: pointer; }
button:hover { border-color: var(--gz-accent); }
button.yes { font-weight: 600; color: var(--gz-accent-ink); background: var(--gz-accent); border-color: var(--gz-accent); }
button:focus-visible { outline: 2px solid var(--gz-accent); outline-offset: 2px; }`;
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  let host = null, kind = '', note = null, busy = false, done = false;

  // Yes's view of itself (quick.js does the same for sharing): fully visible since `since`, at `rect`, or nothing.
  const shown = new WeakMap(), box = (r) => [r.left, r.top, r.right, r.bottom].join(':');
  let io = null;
  try {
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const was = shown.get(e.target), rect = box(e.boundingClientRect);
        shown.set(e.target, e.isVisible === true && e.isIntersecting && e.intersectionRatio === 1 ? { since: was?.rect === rect ? was.since : performance.now(), rect } : null);
      }
    }, { threshold: 1, trackVisibility: true, delay: 100 });
    if (io.trackVisibility !== true) { io.disconnect(); io = null; }
  } catch { io = null; }
  const say = (text) => { if (note) note.textContent = text; return false; };
  const human = (e, look) => {
    if (!e.isTrusted || !(navigator.userActivation?.isActive ?? true)) return say(t('Click this button directly to continue.'));
    if (!look || !io) return true;
    const seen = shown.get(e.currentTarget), moved = seen && seen.rect !== box(e.currentTarget.getBoundingClientRect());
    if (seen && !moved && performance.now() - seen.since >= 500) return true;
    if (moved) { shown.delete(e.currentTarget); io.unobserve(e.currentTarget); io.observe(e.currentTarget); }
    return say(t('Wait a moment with this button fully visible, then click again.'));
  };
  const send = (op) => Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:consent', op, kind })).catch(() => null);
  const hide = () => {
    io?.disconnect();
    host?.remove();
    host = null;
    try { chrome.storage.onChanged.removeListener(heard); } catch { /* reloaded */ }
  };
  // Answered in another tab, or Glaze switched off: the question goes. A yes there puts Glaze in this page too (Ultra's
  // content.js starts by itself); none of this while this page's own Yes is on its way.
  const listed = (list) => Array.isArray(list) && list.includes(kind === 'ultra' ? location.origin : `${location.origin}/*`);
  const heard = (c, area) => {
    if (area === 'sync' && c.enabled?.newValue === false) { hide(); return; }
    if (!host || busy || done) return;
    if (area !== 'local') return;
    if (c.askLater?.newValue?.[location.origin] > Date.now()) hide();
    else if (listed(c[kind]?.newValue)) { done = true; hide(); if (kind !== 'ultra') send('join'); }
  };

  // kind: canvas, moodle or ultra. look: the student's palette for a dark and a light page ({ dark, light }).
  const show = (k, look) => {
    if (host || done || window.top !== window || !Object.hasOwn(LMS, k)) return;
    kind = k;
    host = document.createElement('glaze-consent');
    const root = host.attachShadow({ mode: 'closed' });
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; } catch { root.append(make('style', { textContent: CSS })); }
    const yes = make('button', { type: 'button', className: 'yes', textContent: t('Yes') });
    const later = make('button', { type: 'button', textContent: t('Not now') });
    note = make('p', { className: 'note' });
    const bar = make('section', { className: 'bar' },
      make('p', { className: 'what', translate: false, textContent: 'Glaze' }),
      make('strong', { className: 'title', id: 'gz-consent-q', textContent: t('Use Glaze on {host}?', { host: location.host || location.hostname }) }),
      make('p', { className: 'sub', textContent: t('This looks like {lms}. Glaze changes nothing here until you say yes.', { lms: t(LMS[k]) }) }),
      make('div', { className: 'row' }, yes, later), note);
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-labelledby', 'gz-consent-q');
    const colors = (matchMedia('(prefers-color-scheme: dark)').matches ? look?.dark : look?.light) || {};
    for (const role of Object.keys(ROLES)) if (/^#[\da-f]{3,8}$/i.test(colors[role] || '')) bar.style.setProperty(role, colors[role]);
    yes.addEventListener('click', async (e) => {
      if (busy || !human(e, true)) return;
      busy = true;
      say('');
      const r = await send('yes');
      busy = false;
      if (r?.ok) { done = true; hide(); } else say(t('Not saved. Try again in a moment.'));
    });
    later.addEventListener('click', (e) => { if (!busy && human(e)) { done = true; send('later'); hide(); } });
    bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
    // The live region is in the page empty, so what comes into it is announced.
    const live = make('div');
    live.setAttribute('aria-live', 'polite');
    root.append(live);
    if (document.body) document.body.prepend(host); else document.documentElement.append(host);
    setTimeout(() => {
      if (!host) return;
      if (typeof bar.showPopover === 'function') bar.popover = 'manual';
      live.append(bar);
      try { bar.showPopover?.(); } catch { /* not connected, or no top layer: the fixed bar stands */ }
      io?.observe(yes);
    }, 50);
    try { chrome.storage.onChanged.addListener(heard); } catch { /* reloaded */ }
  };
  // The catalogue the page's language needs, which the worker puts in before show (lib/i18n.js file).
  return { show, words: () => GZ_I18N.file(lang()) };
})();
GZ_CONSENT;
