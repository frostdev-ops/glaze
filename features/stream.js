// Activity Stream display and a Glaze section beside Blackboard's own Stream notification controls.
var GZ_STREAM_UI = globalThis.GZ_STREAM_UI || (() => {
  if (!globalThis.GZ_CTX) return;
  const C = globalThis.GZ_CTX, html = document.documentElement, preview = /-extension:$/.test(location.protocol);
  const marks = new Map(), hidden = new Set(), empty = new Set();
  let wanted = false, loading, clock, host, root, status, saving = false, watched = null, queued = false, saved = null;
  const current = () => wanted && C.on() && (preview ? html.dataset.previewPage === 'stream' : /^\/ultra\/stream(?:\/|$)/.test(location.pathname));
  const t = (s, vars) => C.t(s, vars);
  const prefs = () => {
    const live = C.settings().stream || GZ_DEFAULTS.stream;
    if (saved && saved.from !== live) saved = null;
    return saved?.value || live;
  };
  // Blackboard can update metadata and text in place without a mutation the core observes.
  const observer = new MutationObserver((records) => {
    const changed = records.some((r) => !r.target.parentElement?.closest('.gz-stream-date') && !r.target.closest?.('.gz-stream-date')
      && !(r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 1 && n.matches('.gz-stream-date'))));
    if (!changed || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; paint(); });
  });
  const watch = () => {
    const stream = document.getElementById('activity-stream');
    if (stream === watched) return;
    observer.disconnect(); watched = stream;
    if (stream) observer.observe(stream, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['analytics-context', 'translate-values'] });
  };
  const attr = (e, k, v) => { if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
  const unmark = (row, mark) => { mark.badge.remove(); mark.stamp.removeAttribute('data-gz-stream-date'); marks.delete(row); };
  const clear = () => {
    clearTimeout(clock); clock = null;
    observer.disconnect(); watched = null; saved = null;
    for (const [row, mark] of marks) unmark(row, mark);
    for (const row of hidden) row.removeAttribute('data-gz-stream-hidden'); hidden.clear();
    for (const group of empty) group.removeAttribute('data-gz-stream-empty'); empty.clear();
    html.removeAttribute('data-gz-stream-compact');
    host?.remove(); host = root = status = null;
    document.removeEventListener('visibilitychange', visibility);
  };
  const controls = () => {
    if (!root) return;
    const s = prefs();
    for (const el of root.querySelectorAll('[data-key]')) {
      if (!saving) { if (el.type === 'checkbox') el.checked = s[el.dataset.key]; else el.value = s[el.dataset.key]; }
      el.disabled = saving || (el.dataset.key === 'relative' && s.dates === 'posted');
    }
    root.querySelector('button').disabled = saving;
  };
  const section = () => {
    const panel = document.querySelector('#notification-settings #panel-stream');
    if (!panel) { host?.remove(); host = root = status = null; return; }
    if (host?.parentElement === panel) { controls(); return; }
    host?.remove();
    host = document.createElement('section'); host.id = 'gz-stream-settings';
    // The closed root keeps Blackboard's form/event handlers from treating these as notification settings.
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `:host{display:block;margin-block:0 28px;color:var(--gz-ink);font:inherit}*{box-sizing:border-box}fieldset{margin:0;padding:20px;border:1px solid var(--gz-line);border-radius:var(--gz-radius,12px);min-width:0;background:var(--gz-surface-fill,var(--gz-surface))}legend{padding-inline:8px;font-size:1.15em;font-weight:650}label{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding-block:6px}.choice{display:grid;grid-template-columns:minmax(0,1fr);justify-content:stretch;gap:8px;margin-bottom:8px}.choice select{max-width:100%;width:100%}select{font:inherit;color:inherit;background:var(--gz-surface-2);border:1px solid var(--gz-line-strong);border-radius:8px;padding:8px;max-width:65%;min-width:0}input{width:18px;height:18px;flex:none;accent-color:var(--gz-accent)}:focus-visible{outline:2px solid var(--gz-accent);outline-offset:3px}button{font:inherit;color:var(--gz-accent);background:none;border:1px solid var(--gz-line-strong);border-radius:8px;padding:7px 12px;cursor:pointer}footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}output{font-size:.875em;color:var(--gz-ink-muted)}@media(max-width:420px){fieldset{padding:12px}label{gap:8px}select{max-width:60%}}@media(forced-colors:active){fieldset,select,button{border-color:ButtonText}}`;
    const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Glaze'; box.append(legend);
    for (const [key, label, options] of [
      ['dates', 'Timeline dates', [['smart', 'Due dates when available'], ['posted', 'Posted dates'], ['both', 'Due and posted dates']]],
      ['relative', 'Relative due dates'], ['compact', 'Compact cards'], ['encouragement', 'Show encouragement'],
    ]) {
      const row = document.createElement('label'), text = document.createElement('span'); row.className = options ? 'choice' : ''; text.textContent = t(label);
      const el = document.createElement(options ? 'select' : 'input'); el.dataset.key = key;
      if (options) for (const [value, text] of options) { const option = document.createElement('option'); option.value = value; option.textContent = t(text); el.append(option); }
      else el.type = 'checkbox';
      el.addEventListener('change', (e) => { e.stopPropagation(); save({ [key]: options ? el.value : el.checked }); });
      row.append(text, el); box.append(row);
    }
    const footer = document.createElement('footer'), reset = document.createElement('button'); reset.type = 'button'; reset.textContent = t('Reset');
    reset.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (e.isTrusted) save({ ...GZ_DEFAULTS.stream }); });
    status = document.createElement('output'); status.setAttribute('role', 'status');
    footer.append(reset, status); box.append(footer); root.append(style, box); panel.prepend(host); controls();
  };
  const save = (patch) => {
    if (!current() || saving) return;
    saving = true; controls(); status.textContent = t('Saving…');
    const source = host, from = C.settings().stream || GZ_DEFAULTS.stream;
    const finish = (error, value) => {
      saving = false;
      if (!error) saved = { from, value };
      paint();
      if (host === source && status) status.textContent = t(error ? 'Could not save. Try again.' : 'Saved');
    };
    // Re-read only this settings group, so another editor's changes and every other preference survive.
    try { chrome.storage.sync.get('stream', (raw) => {
      if (chrome.runtime.lastError || !current()) return finish(true);
      const stream = GZ_SANITIZE({ stream: { ...prefs(), ...raw?.stream, ...patch } }).stream;
      try { chrome.storage.sync.set({ stream }, () => finish(!!chrome.runtime.lastError, stream)); } catch { finish(true); }
    }); } catch { finish(true); }
  };
  const paint = () => {
    if (!current()) return clear();
    watch();
    const s = prefs(), P = GZ_STREAM, now = new Date(), locale = C.locale();
    if (s.compact) attr(html, 'data-gz-stream-compact', ''); else html.removeAttribute('data-gz-stream-compact');
    const rows = new Set(document.querySelectorAll('#activity-stream .stream-item-container'));
    for (const [row, mark] of marks) if (!rows.has(row) || !row.contains(mark.stamp)) unmark(row, mark);
    for (const row of hidden) if (!rows.has(row)) { row.removeAttribute('data-gz-stream-hidden'); hidden.delete(row); }
    for (const row of rows) {
      const meta = P.json(row.querySelector('[analytics-context]')?.getAttribute('analytics-context'));
      const hide = !s.encouragement && P.encouragement(meta);
      if (hide) { attr(row, 'data-gz-stream-hidden', ''); hidden.add(row); }
      else { row.removeAttribute('data-gz-stream-hidden'); hidden.delete(row); }
      const stamp = row.querySelector('.timestamp');
      const values = P.json(row.querySelector('.due-date [translate-values]')?.getAttribute('translate-values'));
      const due = s.dates !== 'posted' && P.deadline(meta?.streamType) && P.date(values, locale, s.relative, now);
      if (!due || !stamp) { if (marks.has(row)) unmark(row, marks.get(row)); continue; }
      let mark = marks.get(row);
      if (!mark || !stamp.contains(mark.badge)) {
        if (mark) unmark(row, mark);
        const badge = document.createElement('span'); badge.className = 'gz-stream-date';
        const date = document.createElement('span'); date.className = 'date';
        const posted = document.createElement('span'); posted.className = 'date gz-stream-posted';
        date.setAttribute('aria-hidden', 'true'); posted.setAttribute('aria-hidden', 'true');
        const accessible = document.createElement('span'); accessible.className = 'gz-stream-sr';
        badge.append(date, posted, accessible); stamp.append(badge); mark = { stamp, badge, date, posted, accessible }; marks.set(row, mark);
      }
      const original = [...stamp.childNodes].filter((n) => n !== mark.badge);
      const fullPosted = original.map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
      const shortPosted = stamp.querySelector(':scope > :not(.gz-stream-date) .date')?.textContent.trim() || fullPosted;
      const dueText = t('Due {when}', { when: due.label });
      const postedText = t('Posted {when}', { when: shortPosted });
      if (mark.date.textContent !== dueText) mark.date.textContent = dueText;
      if (mark.posted.textContent !== postedText) mark.posted.textContent = postedText;
      mark.posted.hidden = s.dates !== 'both' || !shortPosted;
      const full = `${t('Due {when}', { when: due.full })}${fullPosted ? ` · ${t('Posted {when}', { when: fullPosted })}` : ''}`;
      if (mark.accessible.textContent !== full) mark.accessible.textContent = full;
      attr(mark.badge, 'title', full); attr(stamp, 'data-gz-stream-date', s.dates);
    }
    for (const group of empty) if (!group.isConnected) { group.removeAttribute('data-gz-stream-empty'); empty.delete(group); }
    for (const group of document.querySelectorAll('#activity-stream .activity-group')) {
      const items = [...group.querySelectorAll('.stream-item-container')];
      if (items.length && items.every((row) => hidden.has(row))) { attr(group, 'data-gz-stream-empty', ''); empty.add(group); }
      else { group.removeAttribute('data-gz-stream-empty'); empty.delete(group); }
    }
    section();
    clearTimeout(clock); clock = null;
    if (s.relative && marks.size && !document.hidden) clock = setTimeout(paint, 60000);
  };
  const visibility = () => { clearTimeout(clock); clock = null; if (!document.hidden) paint(); };
  const sync = (on) => {
    wanted = !!on;
    if (!current()) return clear();
    document.addEventListener('visibilitychange', visibility);
    if (globalThis.GZ_STREAM) return paint();
    loading ||= C.need('lib/stream.js', () => globalThis.GZ_STREAM).then(() => { loading = null; if (current()) paint(); }, () => { loading = null; });
  };
  return { sync };
})();
GZ_STREAM_UI;
