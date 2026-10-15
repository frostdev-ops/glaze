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

  const render = () => {
    GZ_UI.paint(s);
    $('#enabled').setAttribute('aria-pressed', String(s.enabled));
    $('#power-state').textContent = t(s.enabled ? 'On' : 'Off');
    document.body.classList.toggle('off', !s.enabled);
    // inert, not just dimmed: body.off alone leaves the controls reachable by keyboard.
    for (const el of document.querySelectorAll('.tiles > :not(.power, .editor)')) el.inert = !s.enabled;
    // The look being worn, drawn as the editor's look cards are; none of the eight: the palette's own.
    const L = GZ_LOOKS.find((x) => GZ_LOOK_ON(s, x));
    const c = L ? L.colors : GZ_ACTIVE_COLORS(s, matchMedia('(prefers-color-scheme: dark)').matches);
    const bg = L ? L.bg : s.bg;
    const tint = bg.kind === 'solid' ? [c['--gz-surface-2']] : GZ_BG_COLORS(bg.colors || [], c);
    Object.assign($('#look-thumb').style, { color: c['--gz-ink'], borderColor: c['--gz-line-strong'], background: `linear-gradient(120deg, ${c['--gz-surface']} 40%, ${tint.join(', ')})` });
    $('#look-name').textContent = L?.name || s.preset || t('Your theme');
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
  // All eight looks on a sheet over the tiles; picking one closes it.
  $('#look').addEventListener('click', () => {
    GZ_UI.looks($('#looks'), s, (L) => { save(GZ_UI.pickLook(s, L)); render(); $('#sheet').close(); });
    // The theme worn before this one, from the history the background keeps (lib/history.js).
    chrome.storage.local.get('lookHistory', (r) => {
      const back = GZ_HISTORY.previous(GZ_HISTORY.entries(r?.lookHistory), s);
      const b = $('#previous');
      b.hidden = !back;
      if (!back) return;
      b.title = t('Back to {name}', { name: GZ_UI.themeName(GZ_HISTORY.theme(back.theme)) });
      b.onclick = () => { Object.assign(s, GZ_HISTORY.wear(s, back)); save(GZ_HISTORY.KEYS); render(); $('#sheet').close(); };
    });
    $('#sheet').showModal();
  });
  $('#back').addEventListener('click', () => $('#sheet').close());
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

// Due this week, as Blackboard or Canvas last told the content script (the popup can't ask them): the count and
// the next three, to read. A list over a day old is left out; it would miss what was added since.
chrome.storage.local.get(['dueWeek', 'dueWeekAt', 'seenCourses'], (r) => GZ_UI.load().then((s) => {
  const now = new Date();
  const fresh = now - (r?.dueWeekAt || 0) < 864e5;
  const due = fresh ? (r.dueWeek || []).filter((d) => d.due >= now) : [];
  $('#due-n').textContent = fresh ? due.length : '–';
  const note = (text) => Object.assign(document.createElement('li'), { className: 'note', textContent: text });
  $('#due-list').replaceChildren(...(!fresh ? [note(t("Open Blackboard or Canvas to see what's due."))] : !due.length ? [note(t('Nothing due in the next seven days.'))]
    : due.slice(0, 3).map((d) => {
      const { rel, sub } = GZ_PAGE.describe(new Date(d.due), true, now, GZ_I18N.ui());
      const li = document.createElement('li');
      // A course goes by its nickname, if it has one (the course menu).
      li.title = [d.title, (s.enhance.coursemenu && s.courses.names[d.cid]) || d.course || r.seenCourses?.[d.cid]?.name, sub].filter(Boolean).join(' · ');
      li.append(Object.assign(document.createElement('b'), { textContent: d.title }), Object.assign(document.createElement('small'), { textContent: rel }));
      return li;
    })));
}));
