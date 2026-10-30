// Popup: the quick controls, as tiles. Every change saves at once (the popup closes the moment focus
// leaves it, so a pending timer would die with it); the content script listens for the change.
const $ = (sel) => document.querySelector(sel);
// In the browser's language (lib/i18n.js).
GZ_I18N.page();
const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
const hint = (msg) => { $('#hint').textContent = msg || ''; $('#hint').hidden = !msg; $('#hint').classList.toggle('err', !!msg); };
const LEVELS = ['off', 'subtle', 'expressive'];
const level = (l) => t(l[0].toUpperCase() + l.slice(1));
// Auto light and dark, cycled from its tile; the schedule's times are set in the editor.
const AUTO = [['off', 'Off'], ['device', 'Follow the system'], ['schedule', 'On a schedule']];

GZ_UI.load().then((s) => {
  const save = (keys) => GZ_UI.save(s, keys, hint);
  // The Looks catalogue (lib/looks.js), live: a Look saved, installed or removed in Settings shows here at once.
  let catalog = GZ_CATALOG.list();

  const render = () => {
    GZ_UI.paint(s);
    $('#enabled').setAttribute('aria-pressed', String(s.enabled));
    $('#power-state').textContent = t(s.enabled ? 'On' : 'Off');
    document.body.classList.toggle('off', !s.enabled);
    // inert, not just dimmed: body.off alone leaves the controls reachable by keyboard.
    for (const el of document.querySelectorAll('.tiles > :not(.power, .editor)')) el.inert = !s.enabled;
    // Writer's Documents, while Writer is on; the theme's switch leaves it be.
    $('#documents').hidden = s.enhance.writer === false;
    // The Look being worn (built in, saved or from the gallery), drawn as the editor's Look cards are; none: the palette's own.
    const E = GZ_CATALOG.worn(s, catalog);
    const c = E ? E.colors : GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
    const bg = E?.L ? E.L.bg : s.bg;
    const tint = bg.kind === 'solid' ? [c['--gz-surface-2']] : GZ_BG_COLORS(bg.colors || [], c);
    Object.assign($('#look-thumb').style, { color: c['--gz-ink'], borderColor: c['--gz-line-strong'], background: `linear-gradient(120deg, ${c['--gz-surface']} 40%, ${tint.join(', ')})` });
    $('#look-name').textContent = E?.name || s.preset || t('Your theme');
    GZ_UI.swatches($('#presets'), s, (name, colors) => { save(GZ_UI.pickPreset(s, name, colors)); render(); });
    $('#motion').dataset.level = s.motion.level;
    $('#motion-name').textContent = level(s.motion.level);
    $('#motion').setAttribute('aria-label', t('Motion: {level}', { level: level(s.motion.level) }));
    const mode = s.auto.on ? s.auto.mode : 'off';
    const name = t(AUTO.find(([m]) => m === mode)[1]);
    $('#auto-name').textContent = mode === 'schedule' ? `${name} · ${s.auto.from}–${s.auto.to}` : name;
    $('#auto').setAttribute('aria-label', t('Auto light and dark: {mode}', { mode: $('#auto-name').textContent }));
    if (s.auto.on) hint(t('Auto light/dark is on. Picking a palette turns it off.'));
  };

  $('#enabled').addEventListener('click', () => { s.enabled = !s.enabled; save(['enabled']); render(); });
  $('#auto').addEventListener('click', () => {
    const next = AUTO[(AUTO.findIndex(([m]) => m === (s.auto.on ? s.auto.mode : 'off')) + 1) % AUTO.length][0];
    s.auto = { ...s.auto, on: next !== 'off', mode: next === 'off' ? s.auto.mode : next };
    if (!s.auto.on) hint();
    save(['auto']);
    render();
  });
  $('#motion').addEventListener('click', () => {
    s.motion.level = LEVELS[(LEVELS.indexOf(s.motion.level) + 1) % LEVELS.length];
    save(['motion']);
    render();
  });
  // Every Look on a sheet over the tiles; picking one closes it. A kept one is put on by the worker, from its code, as Settings'
  // "Use this theme" puts it on (lib/background.js looks), and the tiles follow once it is.
  const pick = (E) => {
    $('#sheet').close();
    if (E.L) { save(GZ_UI.pickLook(s, E.L)); render(); return; }
    chrome.runtime.sendMessage({ type: 'glaze:looks', op: 'wear', id: E.id }, (r) => {
      if (chrome.runtime.lastError || !r?.ok) return hint(t('Not saved. Try again in a moment.'));
      GZ_UI.load().then((next) => { Object.assign(s, next); render(); });
    });
  };
  const sheet = () => GZ_UI.looks($('#looks'), s, pick, catalog);
  chrome.storage.local.get(GZ_CATALOG.KEY, (r) => { catalog = GZ_CATALOG.list(r?.[GZ_CATALOG.KEY]); render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[GZ_CATALOG.KEY]) return;
    catalog = GZ_CATALOG.list(changes[GZ_CATALOG.KEY].newValue);
    render();
    if ($('#sheet').open) sheet();
  });
  $('#look').addEventListener('click', () => {
    sheet();
    // The theme worn before this one, from the history the background keeps (lib/history.js).
    chrome.storage.local.get('lookHistory', (r) => {
      const back = GZ_HISTORY.previous(GZ_HISTORY.entries(r?.lookHistory), s);
      const b = $('#previous');
      b.hidden = !back;
      if (!back) return;
      b.title = t('Back to {name}', { name: GZ_UI.themeName(GZ_HISTORY.theme(back.theme), catalog) });
      b.onclick = () => { Object.assign(s, GZ_HISTORY.wear(s, back)); save(GZ_HISTORY.KEYS); render(); $('#sheet').close(); };
    });
    $('#sheet').showModal();
  });
  $('#back').addEventListener('click', () => $('#sheet').close());
  $('#documents').addEventListener('click', (e) => { if (e.isTrusted) chrome.tabs.create({ url: chrome.runtime.getURL('papers.html') }); });
  // openOptionsPage reuses an editor tab that is already open, but Chrome sometimes refuses it
  // ("Could not create an options page"); a plain tab always opens. Promise.resolve: not every
  // browser returns a promise here.
  $('#editor').addEventListener('click', () => {
    const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
  });
  GZ_NEWS.check((notes) => {
    if (!notes.length) return;
    $('#editor').classList.add('new');
    $('#editor').title = t('New in {version}', { version: notes[0][0] });
    $('#editor').setAttribute('aria-label', t('Open the editor (new in {version})', { version: notes[0][0] }));
  });
  render();
});

// Use Glaze on {host}: where the browser asks for each site (no <all_urls>; Safari has it), opening the popup gives it
// the tab (activeTab). An http(s) tab Glaze can't run on yet (its host not held, or held but not on its LMS's list) has
// lib/detect.js's check run in it; an LMS gets one button. Its click tells the worker the site, the LMS and the tab, then
// asks the browser for the host in the same click (held already: the worker approves from the message). The worker
// finishes when the grant comes (permissions.onAdded), as the popup may close under the prompt; open still, the button
// goes once the site is on its list. Chrome 133+ also keeps an Allow entry for the tab in its extensions menu.
(async () => {
  if (chrome.runtime.getManifest().host_permissions?.includes('<all_urls>')) return;
  const LISTS = ['canvas', 'moodle', 'ultra'];
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const site = GZ_SITE.address(tab?.url || '');
  if (!site || !Number.isInteger(tab.id) || new URL(tab.url).origin !== site.origin) return;
  const u = new URL(site.origin);
  const listed = (r) => LISTS.some((k) => Array.isArray(r?.[k]) && r[k].includes(k === 'ultra' ? site.origin : `${site.origin}/*`));
  const held = await chrome.permissions.contains({ origins: [site.pattern] }).catch(() => false);
  if (held && (LISTS.some((k) => GZ_BUILT_IN(k, u)) || listed(await chrome.storage.local.get(LISTS)))) return;
  const kind = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: GZ_DETECT }).then((r) => r?.[0]?.result, () => null);
  if (!LISTS.includes(kind)) return;
  const b = $('#here');
  b.textContent = t('Use Glaze on {host}', { host: site.host });
  let on = (await chrome.storage.sync.get('enabled')).enabled !== false, done = false, busy = false, menu = false;
  // The extensions menu's Allow entry for a tab (Chrome 133+). The Firefox package leaves this line out: Firefox has none.
  const hostAccess = typeof chrome.permissions.addHostAccessRequest === 'function' ? (tabId) => chrome.permissions.addHostAccessRequest({ tabId }) : null;
  const show = () => {
    b.hidden = done || !on;
    if (b.hidden || held || menu || !hostAccess) return;
    menu = true;
    Promise.resolve().then(() => hostAccess(tab.id)).catch(() => {});
  };
  const ready = () => { busy = false; b.removeAttribute('aria-disabled'); };
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync' && c.enabled) { on = c.enabled.newValue !== false; show(); }
    if (area === 'local' && LISTS.some((k) => k in c)) chrome.storage.local.get(LISTS).then((r) => { if (listed(r)) { done = true; show(); } });
  });
  b.addEventListener('click', () => {
    if (busy || done) return;
    busy = true;
    b.setAttribute('aria-disabled', 'true');
    const told = GZ_SITE.tell({ op: 'ask', origin: site.origin, kind, tabId: tab.id });
    const requested = held ? Promise.resolve(true) : new Promise((res) => res(chrome.permissions.request({ origins: [site.pattern] })));
    requested.then(async (ok) => {
      if (!ok || !(await told)?.ok) { ready(); return; }
      // Regranting a listed site need not write storage, so there may be no change event to finish this popup.
      const r = await chrome.storage.local.get(LISTS);
      if (listed(r) && await chrome.permissions.contains({ origins: [site.pattern] })) { done = true; show(); }
    }).catch(ready);
  });
  show();
})().catch(() => {});

// Due this week, as Blackboard, Canvas or Moodle last told the content script (the popup can't ask them): the count and
// the next three, to read. Each site keeps its own list (content.js dueWeek, `dueWeek:<origin>`): the one of the site in this
// tab, or else every site's, each item with its site's name. A list over a day old is left out; it would miss what was
// added since.
const local = chrome.storage.local;
Promise.all([
  Promise.resolve().then(() => chrome.tabs.query({ active: true, currentWindow: true })).then(([tab]) => new URL(tab.url).origin).catch(() => ''),
  Promise.resolve().then(() => (local.getKeys ? local.getKeys() : local.get(null).then(Object.keys))).then((keys) => keys.filter((k) => k.startsWith('dueWeek:'))).catch(() => []),
  GZ_UI.load(),
]).then(async ([here, keys, s]) => {
  const r = await local.get([...keys, 'seenCourses']);
  const now = new Date();
  const lists = keys.map((k) => [k.slice(8), r[k]]).filter(([, v]) => Array.isArray(v?.list) && now - (v.at || 0) < 864e5);
  const mine = lists.filter(([site]) => site === here);
  const fresh = lists.length > 0;
  const due = (mine.length ? mine : lists).flatMap(([site, v]) => v.list.filter((d) => d.due >= now).map((d) => ({ ...d, site }))).sort((a, b) => a.due - b.due);
  $('#due-n').textContent = fresh ? due.length : '–';
  const note = (text) => Object.assign(document.createElement('li'), { className: 'note', textContent: text });
  $('#due-list').replaceChildren(...(!fresh ? [note(t("Open Blackboard, Canvas or Moodle to see what's due."))] : !due.length ? [note(t('Nothing due in the next seven days.'))]
    : due.slice(0, 3).map((d) => {
      const { rel, sub } = GZ_PAGE.describe(new Date(d.due), true, now, GZ_I18N.ui());
      const where = mine.length ? '' : new URL(d.site).host;
      const course = r.seenCourses?.[d.cid];
      const li = document.createElement('li');
      // A course goes by its nickname, if it has one (the course menu).
      li.title = [d.title, (s.enhance.coursemenu && s.courses.names[d.cid]) || d.course || (course && (!course.site || course.site === d.site) ? course.name : ''), sub, where].filter(Boolean).join(' · ');
      li.append(Object.assign(document.createElement('b'), { textContent: d.title }), Object.assign(document.createElement('small'), { textContent: where ? `${rel} · ${where}` : rel }));
      return li;
    })));
});
