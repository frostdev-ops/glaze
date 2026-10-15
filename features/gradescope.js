// Gradescope in Better To Do (W10), on www.gradescope.com: lib/background.js registers this only while Glaze (enabled)
// and enhance.gradescope are on (and it checks both again here). Two things, top frame only:
// - Whenever the student visits Gradescope, every Gradescope course they've put with a Canvas course is read again: the
//   page itself when it's that course's page, else its course page fetched from this same site with their own session
//   (plain GETs, one at a time, none read in the last ten minutes, both switches asked again before each). The rows go to
//   the worker's queue ('glaze:gradescope'), for the account signed in: read from Gradescope's account page first, only
//   when there's something to do. Another account than the one kept starts afresh (lib/gradescope.js change 'acct').
// - A bar at the top of the page, while courses this page lists aren't placed yet and the student hasn't said "Don't ask
//   again": a Canvas course for each, with a guess by course code or name (lib/gradescope.js suggest). The choice can be
//   changed later in Glaze's settings. Canvas courses come from what Glaze saw on Canvas (storage.local seenCourses).
// Its own styles in a shadow root, so neither page's CSS reaches the other. Words in the browser's language.
(() => {
  if (window.top !== window || globalThis.__gzGradescope) return;
  globalThis.__gzGradescope = true;
  const G = globalThis.GZ_GRADESCOPE;
  const FRESH = 6e5;
  const lang = (() => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language; } })();
  const t = (k, v) => GZ_I18N.t(k, v, lang);
  const get = (area, keys) => new Promise((res) => { try { chrome.storage[area].get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const human = (e) => e.isTrusted && (navigator.userActivation?.isActive ?? true);
  globalThis.__gzDoc = crypto.randomUUID(); // names this document to the worker's loader (lib/background.js 'glaze:load')
  const on = async () => { const { enabled, enhance } = await get('sync', ['enabled', 'enhance']); return enabled !== false && enhance?.gradescope === true; };
  const own = (gid) => location.pathname.replace(/\/$/, '') === `/courses/${gid}`;
  // Who's signed in, from Gradescope's account page (a redirect, signed out, is refused), told to the worker. → what's kept
  // for that account, or null (signed out, or the page not read: then nothing is done).
  const whoami = async () => {
    try {
      const r = await fetch('/account/edit', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      const acct = r.ok ? await G.account(new DOMParser().parseFromString(await r.text(), 'text/html')) : null;
      const k = acct && await send({ type: 'glaze:gradescope', op: 'acct', acct });
      return k?.ok ? G.clean(k.data) : null;
    } catch { return null; }
  };
  const words = () => {
    const f = GZ_I18N.file(lang);
    return !f || globalThis.GZ_LANGS?.[f.slice(5, -3)] ? Promise.resolve() : send({ type: 'glaze:load', files: [f], doc: globalThis.__gzDoc });
  };

  // ---- reading ----------------------------------------------------------------------------------------------------
  // only: the courses to read whatever their age (just placed); else every placed course not read lately.
  // → { rows, bad, failed } over the courses read.
  const sync = async (d, only = null) => {
    const out = { rows: 0, bad: 0, failed: 0 };
    for (const [gid, m] of Object.entries(d.map)) {
      if (!m.to || (only && !only.has(gid))) continue;
      if (!only && !own(gid) && Date.now() - (d.courses[gid]?.at || 0) < FRESH) continue;
      // Turned off (Glaze, or its Gradescope switch) since this started: not one more request.
      if (!await on()) break;
      let p = null;
      try {
        if (own(gid)) p = G.parse(document, gid);
        else {
          // Signed out, Gradescope redirects to its sign-in page: refused before it's followed, and what's kept stays.
          const r = await fetch(`/courses/${gid}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
          if (r.ok && new URL(r.url).pathname.replace(/\/$/, '') === `/courses/${gid}`) p = G.parse(new DOMParser().parseFromString(await r.text(), 'text/html'), gid);
        }
      } catch { /* the network: kept as it was */ }
      const kept = p && await send({ type: 'glaze:gradescope', op: 'rows', acct: d.acct.id, gid, to: m.to, ...p });
      if (!kept?.ok) { out.failed++; continue; }
      out.rows += p.rows.length;
      out.bad += p.bad;
    }
    return out;
  };

  // ---- the bar -------------------------------------------------------------------------------------------------------
  const CSS = `
    :host { all: initial; display: block; margin: 12px 16px; }
    section { --ink: #1f2328; --muted: #57606a; --bg: #f6f8fa; --line: #d0d7de; --accent: #0b6e4f; --on-accent: #fff;
      color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px;
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 760px; }
    @media (prefers-color-scheme: dark) { section { --ink: #e6edf3; --muted: #9da7b3; --bg: #161b22; --line: #30363d; --accent: #3fb68b; --on-accent: #0d1117; } }
    h2 { margin: 0 0 4px; font-size: 15px; } p { margin: 0 0 8px; color: var(--muted); }
    ul { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 6px; }
    label { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
    label span { min-width: 12em; font-weight: 600; }
    select, button { font: inherit; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
    select { max-width: 100%; background: var(--bg); }
    button { cursor: pointer; } button.main { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    [role="status"]:empty { display: none; } [role="status"] { margin: 8px 0 0; color: var(--ink); }`;
  // The bar while it's on the page: it goes as soon as Glaze or its Gradescope switch is turned off.
  let shown = null;
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'sync' && (ch.enabled || ch.enhance) && shown) on().then((yes) => { if (!yes) { shown?.remove(); shown = null; } });
    });
  } catch { /* reloaded */ }
  const bar = (d, open, list) => {
    const host = make('div');
    shown = host;
    host.id = 'gz-gradescope';
    const root = host.attachShadow({ mode: 'closed' });
    const say = make('p', { role: 'status' });
    const close = () => { host.remove(); if (shown === host) shown = null; };
    const pick = (c) => {
      const want = G.suggest(c, list);
      const sel = make('select', { name: c.gid },
        make('option', { value: '?', textContent: t('Choose a course') }),
        ...list.map((x) => make('option', { value: x.key, textContent: x.label, selected: x.key === want })),
        make('option', { value: '', textContent: t('None of these courses') }));
      return make('li', {}, make('label', {}, make('span', { textContent: c.short || c.name || c.gid }), sel));
    };
    const save = make('button', { type: 'submit', className: 'main', textContent: t('Save') });
    const never = make('button', { type: 'button', textContent: t("Don't ask again") });
    const form = make('form', {}, list.length ? make('ul', {}, ...open.map(pick)) : make('p', { textContent: t("Glaze doesn't know your courses yet. Open your Canvas Dashboard or Blackboard's Courses page once with Glaze on, then come back here.") }),
      make('div', { className: 'row' }, list.length > 0 && save, never));
    const box = make('section', {}, make('h2', { id: 'h', textContent: t('Gradescope in your To Do') }),
      make('p', { textContent: t("Pick the Canvas or Blackboard course each Gradescope course belongs to. Its assignments then show in Glaze's To Do, on your course cards and in reminders. Glaze reads them when you visit Gradescope, and they stay on this device.") }),
      form, say);
    box.setAttribute('aria-labelledby', 'h');
    root.append(make('style', { textContent: CSS }), box);
    never.addEventListener('click', async (e) => {
      if (!human(e)) return;
      const r = await send({ type: 'glaze:gradescope', op: 'hide', hide: true });
      if (r?.ok) close(); else say.textContent = t("Couldn't save that on this device, so nothing changed.");
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!human(e)) return;
      const names = new Map(open.map((c) => [c.gid, c.short || c.name]));
      const chosen = [...form.querySelectorAll('select')].filter((s) => s.value !== '?').map((s) => ({ gid: s.name, to: s.value, name: names.get(s.name) || '' }));
      if (!chosen.length) { say.textContent = t('Choose a course first.'); return; }
      save.disabled = true;
      const r = await send({ type: 'glaze:gradescope', op: 'map', acct: d.acct.id, list: chosen });
      if (!r?.ok) { save.disabled = false; say.textContent = t("Couldn't save that on this device, so nothing changed."); return; }
      const got = await sync(G.clean(r.data), new Set(chosen.filter((x) => x.to).map((x) => x.gid)));
      const done = make('button', { type: 'button', textContent: t('Close') });
      done.addEventListener('click', close);
      form.replaceWith(make('div', { className: 'row' }, done));
      say.textContent = [t("Saved. You can change this in Glaze's settings."),
        got.failed ? t("Gradescope didn't answer for every course. Glaze tries again on your next visit.") : '',
        got.bad ? t('Unreadable rows: {n}', { n: got.bad }) : ''].filter(Boolean).join(' ');
      done.focus();
    });
    // Escape: away for this page only.
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    (document.querySelector('main') || document.body).prepend(host);
  };

  (async () => {
    const [{ enabled, enhance }, { [G.KEY]: raw, seenCourses }] = await Promise.all([get('sync', ['enabled', 'enhance']), get('local', [G.KEY, 'seenCourses'])]);
    // Glaze off as a whole counts as off here too, whatever the Gradescope switch says (a stale registration).
    if (enabled === false || enhance?.gradescope !== true) return;
    const listed = G.courses(document, location.pathname);
    const unplaced = (x) => (x.hide ? [] : listed.filter((c) => !(c.gid in x.map)));
    const due = (x) => Object.entries(x.map).some(([gid, m]) => m.to && (own(gid) || Date.now() - (x.courses[gid]?.at || 0) >= FRESH));
    const kept = G.clean(raw);
    if (kept.acct && !unplaced(kept).length && !due(kept)) return; // nothing to do: not even the account page is asked for
    const d = await on() ? await whoami() : null;
    // Both switches again after every wait: turned off meanwhile, nothing is drawn or read.
    if (!d || !await on()) return;
    const open = unplaced(d);
    if (open.length) {
      await words().catch(() => {});
      if (!await on()) return;
      bar(d, open, G.canvas(seenCourses));
    }
    await sync(d);
  })();
})();
