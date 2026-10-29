// The approval window's page (lib/mcp/approve.js opens it as one popup for every ask): the oldest waiting ask, as Glaze
// wrote it to storage.session, live through storage.onChanged. The app's name and program are the app's own claims and say
// so; every other word is Glaze's, and an action's is the sentence Glaze's summarize built. A mod's name comes from its
// installed record. Allow and Don't allow send glaze:mcp-ask with the shown ask's id, so a decision is only ever for what
// was on screen. Focus starts on Don't allow; a new ask or regained focus waits ARM ms, and held keys never answer.
(() => {
  const PREFIX = 'mcpAsk:', ARM = 800, MOD = /^mod:([a-z2-7]{16})$/;
  GZ_I18N.page();
  const tag = GZ_I18N.ui();
  const t = (k, v) => GZ_I18N.t(k, v, tag);
  const $ = (id) => document.getElementById(id);
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const str = (v) => (typeof v === 'string' ? v : '');

  // A group's name on a pairing, and the question a grant asks; mod: a mod group's installed name.
  const label = (group, mod) => (mod ? t('The mod {mod}', { mod }) : {
    courses: t('Courses, to-dos and schedule'), grades: t('Grades'), writer: t('Writer documents'), assignments: t('Assignments and rubrics'),
  }[group] ?? '');
  const question = (group, app, mod) => (mod ? t('{app} wants to use the mod {mod}', { app, mod }) : {
    courses: t('{app} wants to see your courses, to-dos and schedule', { app }),
    grades: t('{app} wants to see your grades', { app }),
    writer: t('{app} wants to see your Writer documents', { app }),
    assignments: t('{app} wants to see your assignments and rubrics', { app }),
  }[group] ?? t('{app} wants to use Glaze', { app }));
  const ENDED = { cancelled: () => t('Cancelled'), timeout: () => t('Timed out'), interrupted: () => t('Glaze restarted before you answered.') };
  const modName = async (group) => {
    const id = MOD.exec(str(group))?.[1];
    if (!id) return '';
    try { return str((await chrome.storage.local.get(`mod:${id}`))[`mod:${id}`]?.manifest?.name).replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim().slice(0, 60) || id; } catch { return id; }
  };

  let shown = null, armed = false, sent = false, turn = 0, timer = 0;
  const lock = () => { for (const b of [$('no'), $('yes')]) b.setAttribute('aria-disabled', String(!armed || sent)); };
  const active = () => document.hasFocus() && document.visibilityState === 'visible';
  const disarm = () => { armed = false; clearTimeout(timer); lock(); };
  const arm = () => {
    disarm();
    if (shown && !sent && active()) timer = setTimeout(() => { armed = active(); lock(); }, ARM);
  };
  window.addEventListener('blur', disarm);
  window.addEventListener('focus', () => { if (shown && !sent) { $('no').focus(); arm(); } });
  document.addEventListener('visibilitychange', arm);

  const fill = (rec, mod) => {
    const app = str(rec.app?.name) || t('Unnamed app'), exe = str(rec.app?.exe);
    $('title').textContent = rec.kind === 'action' ? str(rec.summary) : rec.kind === 'grant' ? question(rec.group, app, mod) : t('{app} wants to use Glaze', { app });
    $('group').hidden = rec.kind !== 'pair';
    $('group').textContent = rec.kind === 'pair' ? label(rec.group, mod) : '';
    $('app').textContent = app;
    $('exe').textContent = exe;
    $('exe').hidden = !exe;
    $('state').hidden = true;
    $('buttons').hidden = false;
    $('ask').hidden = false;
    if (shown?.id !== rec.id) { shown = rec; sent = false; arm(); $('no').focus(); }
  };
  // Nothing waits: the shown ask's end, if it ended without the student; Glaze closes the window.
  const end = (rec) => {
    if (!shown || !rec || !ENDED[rec.state]) return;
    $('state').textContent = ENDED[rec.state]();
    $('state').hidden = false;
    $('buttons').hidden = true;
  };
  const render = async () => {
    const mine = ++turn;
    let all;
    try { all = await chrome.storage.session.get(null); } catch { return; }
    const recs = Object.entries(isObj(all) ? all : {}).filter(([k, v]) => k.startsWith(PREFIX) && isObj(v)).map(([, v]) => v);
    const next = recs.filter((r) => r.state === 'waiting').sort((a, b) => a.at - b.at)[0];
    const mod = next ? await modName(next.group) : '';
    if (mine !== turn) return;
    if (next) fill(next, mod);
    else end(recs.find((r) => r.id === shown?.id));
  };

  const answer = (value) => {
    if (!shown || !armed || sent || !active()) return;
    sent = true;
    lock();
    const back = (r) => { if (r?.ok) return; sent = false; lock(); render(); };
    try { chrome.runtime.sendMessage({ type: 'glaze:mcp-ask', id: shown.id, answer: value }, (r) => { void chrome.runtime.lastError; back(r); }); } catch { back(null); }
  };
  $('yes').addEventListener('click', () => answer('yes'));
  $('no').addEventListener('click', () => answer('no'));
  document.addEventListener('keydown', (e) => {
    if (!['Enter', ' ', 'Escape'].includes(e.key)) return;
    if (e.repeat || e.isComposing || !armed || !active()) { e.preventDefault(); return; }
    if (e.key === 'Escape') { e.preventDefault(); answer('no'); }
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && Object.keys(changes).some((k) => k.startsWith(PREFIX))) render(); });

  // The student's palette, as the share panel wears it (sharing/quick.js): their colors or, with auto on, the light or dark one.
  const LOOK = ['look', 'colors', 'auto', 'presets'];
  const dark = matchMedia('(prefers-color-scheme: dark)');
  let looks = 0, flip = 0;
  const paint = async () => {
    const mine = ++looks;
    clearTimeout(flip);
    try {
      const s = GZ_SANITIZE(await chrome.storage.sync.get(LOOK));
      if (mine !== looks) return;
      const html = document.documentElement, colors = GZ_ACTIVE_COLORS(s, dark.matches);
      const vars = { ...colors, ...GZ_SURFACE_VARS({ ...s, bg: { kind: 'solid' } }), '--gz-radius': `${s.look.radius}px`, '--gz-font': GZ_FONTS.stack(s.look.font),
        '--gz-font-head': s.look.head === 'auto' ? 'inherit' : GZ_FONTS.stack(s.look.head) };
      for (const [k, v] of Object.entries(vars)) { if (v) html.style.setProperty(k, v); else html.style.removeProperty(k); }
      html.style.colorScheme = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < 0.5 ? 'dark' : 'light';
      if (s.auto.on && s.auto.mode === 'schedule') {
        const at = GZ_SCHEDULE_NEXT(s.auto.from, s.auto.to, new Date());
        if (at) flip = setTimeout(paint, Math.max(0, at - Date.now()) + 20);
      }
    } catch { /* The first-paint colors stay. */ }
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && LOOK.some((k) => changes[k])) paint(); });
  dark.addEventListener('change', paint);
  paint();
  render();
})();
