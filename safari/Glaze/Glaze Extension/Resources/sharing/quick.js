// The Notes share panel: an extension frame that features/notes.js puts inside its Notes view. Invite links and keys
// stay in this frame and the worker; the school page around it cannot read them, and nothing here is posted to it.
// Cross-origin frames get no confirm dialogs, so questions are asked inline. notes.js delivers a one-use ticket
// directly to this extension window, never through a URL. Only the authenticated runtime port can use its scope.
(() => {
  GZ_I18N.page();
  const t = (k, v) => GZ_I18N.t(k, v, GZ_I18N.ui());
  const $ = (s) => document.querySelector(s);
  // An embedded control needs verified IOv2 visibility, full intersection and a stable box for half a second.
  // Older observers silently ignore trackVisibility; geometric intersection alone cannot detect a hostile overlay.
  const shown = new WeakMap();
  const observedAt = new WeakMap();
  const box = (r) => [r.left, r.top, r.right, r.bottom].join(':');
  let watcher = null;
  try {
    watcher = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.time < observedAt.get(e.target)) continue; // an entry queued before a render/question reset
        const previous = shown.get(e.target), rect = box(e.boundingClientRect);
        shown.set(e.target, e.isVisible === true && e.isIntersecting && e.intersectionRatio === 1
          ? { since: previous?.rect === rect ? previous.since : performance.now(), rect } : null);
      }
    },
      { threshold: 1, trackVisibility: true, delay: 100 });
    if (watcher.trackVisibility !== true || !('isVisible' in IntersectionObserverEntry.prototype)) { watcher.disconnect(); watcher = null; }
  } catch { watcher?.disconnect(); watcher = null; }
  const watch = (el) => { shown.delete(el); observedAt.set(el, performance.now()); watcher?.unobserve(el); watcher?.observe(el); return el; };
  const human = (e) => {
    if (dead || !e.isTrusted) return false;
    const refuse = (message) => { say(message, undefined, true); return false; };
    if (!(navigator.userActivation?.isActive ?? false)) return refuse('Click this button directly to continue.');
    if (!watcher) return refuse('Sharing controls need visibility protection. Open Settings from Glaze to share.');
    const seen = shown.get(e.currentTarget);
    if (!seen) return refuse('This button must be fully visible and uncovered. Try again, or open All sharing settings.');
    if (seen.rect !== box(e.currentTarget.getBoundingClientRect())) {
      watch(e.currentTarget);
      return refuse('The sharing panel moved. Wait a moment, then click again.');
    }
    return performance.now() - seen.since >= 500 || refuse('Wait a moment with this button fully visible, then click again.');
  };
  const make = (tag, text, props = {}) => Object.assign(document.createElement(tag), { ...(text === undefined ? {} : { textContent: text }), ...props });
  let state, busy = false, dead = false, key = '', note = '';

  const LOOK_KEYS = ['look', 'colors', 'auto', 'presets'];
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  let lookRevision = 0, lookTimer = 0;
  const paintLook = async () => {
    const turn = ++lookRevision;
    clearTimeout(lookTimer);
    try {
      const settings = GZ_SANITIZE(await chrome.storage.sync.get(LOOK_KEYS));
      if (dead || turn !== lookRevision || !chrome.runtime?.id) return;
      const html = document.documentElement, colors = GZ_ACTIVE_COLORS(settings, darkMQ.matches);
      const vars = { ...colors, ...GZ_SURFACE_VARS({ ...settings, bg: { kind: 'solid' } }) };
      vars['--gz-radius'] = `${settings.look.radius}px`;
      vars['--gz-font'] = GZ_FONTS.stack(settings.look.font);
      vars['--gz-font-head'] = settings.look.head === 'auto' ? 'inherit' : GZ_FONTS.stack(settings.look.head);
      for (const [key, value] of Object.entries(vars)) { if (value) html.style.setProperty(key, value); else html.style.removeProperty(key); }
      html.setAttribute('data-gz-depth', String(settings.look.depth));
      html.style.colorScheme = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < 0.5 ? 'dark' : 'light';
      if (settings.auto.on && settings.auto.mode === 'schedule') {
        const at = GZ_SCHEDULE_NEXT(settings.auto.from, settings.auto.to, new Date());
        if (at) lookTimer = setTimeout(paintLook, Math.max(0, at - Date.now()) + 20);
      }
    } catch { /* A failed read leaves the existing appearance and local copies intact. */ }
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && LOOK_KEYS.some((key) => changes[key])) paintLook(); });
  darkMQ.addEventListener('change', paintLook);
  paintLook();

  const say = (k, vars, err = false) => { $('#status').textContent = k ? t(k, vars) : ''; $('#status').classList.toggle('error', err); };
  let port, serial = 0, started = false;
  const pending = new Map();
  const lock = () => { for (const b of document.querySelectorAll('button')) b.disabled = dead || (b.id !== 'settings' && (busy || !started || !watcher)); };
  const expire = () => {
    if (dead) return;
    dead = true; state = null; key = ''; note = ''; lookRevision++; clearTimeout(lookTimer); clearTimeout(startTimer);
    $('#invite').value = ''; answer?.(false);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('sender')); }
    pending.clear(); watcher?.disconnect();
    try { port?.disconnect(); } catch {}
    lock(); say('Close this panel and open Share again.', undefined, true);
  };
  const request = (m) => new Promise((resolve, reject) => {
    if (dead || !port) return reject(new Error('sender'));
    const id = ++serial, timer = setTimeout(expire, 15000);
    pending.set(id, { resolve, reject, timer });
    try { port.postMessage({ ...m, id }); } catch { expire(); }
  });
  const send = async (op, rest = {}) => {
    const r = await request({ op, ...rest });
    if (!r?.ok) throw new Error(r?.error || 'storage');
    return r;
  };
  const act = async (f) => {
    if (busy) return;
    busy = true;
    for (const b of document.querySelectorAll('button')) b.disabled = true;
    try { await f(); if (!dead) await load(); }
    catch (e) { if (!dead) say(e.message === 'confirmation' ? 'Resume sharing from Settings before using this panel.' : e.message === 'unsupported' ? 'This browser cannot open encrypted sessions.' : e.message === 'many' ? 'This device already holds 20 sessions. Leave one in Settings first.' : 'Could not finish. Your local copies are kept. Try again.', undefined, true); }
    finally { busy = false; lock(); }
  };
  const button = (label, f, cls = '') => {
    const b = make('button', t(label), { type: 'button', className: cls });
    b.addEventListener('click', (e) => { if (human(e)) f(e); }); return watch(b);
  };
  // A question answered with a real click in this frame; that click is also what a permission prompt needs.
  let answer = null;
  const ask = (text, yes = 'Connect') => new Promise((resolve) => {
    answer?.(false);
    answer = (v) => { answer = null; $('#ask').hidden = true; resolve(v); };
    $('#ask-text').textContent = text; $('#ask-yes').textContent = t(yes); $('#ask').hidden = false; $('#ask-yes').focus();
    watch($('#ask-yes')); // a new question must never inherit the previous question's visibility timer
  });
  $('#ask-yes').addEventListener('click', (e) => { if (human(e)) answer?.(true); });
  $('#ask-no').addEventListener('click', (e) => { if (e.isTrusted) answer?.(false); });
  const permission = async (servers) => {
    const origins = [];
    for (const server of new Set(servers)) {
      if (GZ_RELAY.normalize(server) !== server) return false;
      if (!await chrome.permissions.contains({ origins: [server + '/*'] })) origins.push(server + '/*');
    }
    return !origins.length || chrome.permissions.request({ origins });
  };
  const copy = async (sid, edit) => {
    const { link } = await send('link', { sid, edit });
    try { await navigator.clipboard.writeText(link); say(edit ? 'Edit invite copied. Anyone with it can change this note. Keep it private.' : 'View invite copied. Keep it private.'); }
    catch { say('Could not copy the invite. Try again.', undefined, true); }
  };
  const names = { pending: 'Changes saved locally, waiting to send', live: 'Up to date', offline: 'Offline — local copy kept', gone: 'Deleted on the relay — local copy kept', incomplete: 'More changes remain. Sync again.' };
  const status = (s) => t(state.on ? names[s.status] || names.offline : 'Paused — local copy kept');
  const links = (s) => [button('Copy view invite', () => act(() => copy(s.sid, false))), s.edit && button('Copy edit invite', () => act(() => copy(s.sid, true)))].filter(Boolean);
  const stop = (s) => button(s.creator ? 'Stop sharing' : 'Leave', async () => {
    const yes = await ask(t(s.creator ? 'Stop sharing “{title}”? It is deleted from the relay; everyone keeps their own copy.' : 'Leave “{title}”? Your copy in Notes stays; you stop getting changes.', { title: s.title }), s.creator ? 'Stop sharing' : 'Leave');
    if (yes) act(async () => { if (s.creator && s.status !== 'gone') await send('delete', { sid: s.sid }); await send('leave', { sid: s.sid }); say(s.creator ? 'Sharing stopped. Your note stays here.' : 'Left. Your copy stays in Notes.'); });
  });

  const render = () => {
    watcher?.disconnect(); // discard replaced buttons; observers otherwise retain detached nodes indefinitely
    const mine = state.sessions.filter((s) => s.account === key && s.kind === 'notes');
    const here = note && mine.find((s) => s.notes.includes(note));
    const source = note && state.sources.find((s) => s.key === key && s.ids?.[0] === note);
    $('#paused').hidden = state.on || !mine.length;
    $('#note').hidden = !source;
    if (source) {
      $('#note-title').textContent = source.title;
      $('#note-new').hidden = !!here; $('#note-shared').hidden = !here;
      $('#note-state').textContent = here ? `${t('Shared')} · ${status(here)}${here.members.length > 1 ? ' · ' + here.members.map((m) => m.name).join(', ') : ''}` : t('Not shared yet.');
      if (here) $('#note-shared').replaceChildren(...links(here), stop(here));
    }
    $('#who').hidden = false;
    if (!$('#name').value && document.activeElement !== $('#name')) $('#name').value = state.name || '';
    const others = mine.filter((s) => s !== here);
    $('#others').hidden = !others.length;
    $('#list').replaceChildren(...others.map((s) => {
      const row = make('div', undefined, { className: 'row' }), li = make('li');
      row.append(...links(s), stop(s));
      li.append(make('strong', s.title), make('small', `${t(s.edit ? 'Edit access' : 'View access')} · ${status(s)}`), row);
      return li;
    }));
    for (const b of document.querySelectorAll('button')) watch(b);
    lock();
  };
  const load = async () => { state = await send('list'); ({ key = '', note = '' } = state.scope || {}); if (!dead) render(); };
  for (const b of document.querySelectorAll('button')) watch(b);

  $('#resume').addEventListener('click', (e) => {
    if (!human(e) || busy || !state) return;
    const servers = [...new Set(state.sessions.filter((s) => s.status !== 'gone').map((s) => s.server))];
    if (servers.some((s) => s !== state.defaultRelay && !state.hosts.includes(s))) { say('Resume from Settings to confirm the other servers these sessions use.', undefined, true); return; }
    const p = permission(servers); act(async () => {
      if (!await p) return say('Host permission was not granted. No connection was made.', undefined, true);
      await send('resume', { confirmServers: [] });
    });
  });
  $('#share').addEventListener('click', (e) => {
    if (!human(e) || busy || !state || !key || !note) return;
    const source = state.sources.find((s) => s.key === key && s.ids?.[0] === note);
    if (!source) return;
    const server = state.relay, p = permission([server]);
    act(async () => {
      if (!await p) return say('Host permission was not granted. No connection was made.', undefined, true);
      const { sid } = await send('create', { kind: 'notes', title: source.title.slice(0, 80) || '…', server, key, ids: [note], name: $('#name').value });
      try { await navigator.clipboard.writeText((await send('link', { sid, edit: true })).link); say('Shared. Edit invite copied: anyone with it can change this note. Keep it private.'); }
      catch { say('Shared. Copy an invite to send it.'); }
    });
  });
  $('#join').addEventListener('click', async (e) => {
    if (!human(e) || busy || !state || !key) return;
    // The key exists only in this frame's input until the trusted click, then in the worker.
    const link = $('#invite').value.trim(); $('#invite').value = '';
    const server = GZ_RELAY.invite(link);
    if (!server) return say('Paste a valid Glaze invite link using HTTPS, or HTTP localhost or 127.0.0.1.', undefined, true);
    if (!(server === state.defaultRelay && server === state.relay) && !await ask(server === state.defaultRelay
      ? t('This share is hosted on {host}, not your selected relay ({selected}). Connect to this server?', { host: new URL(server).host, selected: new URL(state.relay).host })
      : t('This share is hosted on {host}, not frostdev.io. Connect to this server? Glaze cannot vouch for its operator.', { host: new URL(server).host }))) return;
    const p = permission([server]);
    act(async () => {
      if (!await p) return say('Host permission was not granted. No connection was made.', undefined, true);
      const joined = await send('join', { link, confirmServer: server, name: $('#name').value || state.name }), sid = joined.sid;
      if (joined?.kind === 'notes') { await send('attach', { sid, key }); say('Joined. The shared notes are in a folder named “{title}”.', { title: joined.title }); }
      else if (joined?.kind) say('Joined. That invite is not for notes; open All sharing settings to use it.');
      else say('Joined, but the relay could not be reached yet. Add it to Notes from All sharing settings once it connects.', undefined, true);
    });
  });
  // Navigation grants no session authority. Keep recovery available even when this embedded surface cannot be trusted.
  $('#settings').addEventListener('click', (e) => { if (!dead && e.isTrusted && navigator.userActivation?.isActive) chrome.tabs.create({ url: chrome.runtime.getURL('options.html#sharing/sessions') }).catch(() => {}); });

  const startTimer = setTimeout(expire, 10000);
  say('Open this from Notes.', undefined, true);
  lock();
  addEventListener('message', (e) => {
    if (started || dead || e.data?.type !== 'glaze:quick-start' || !/^[0-9a-f]{32}$/.test(e.data.ticket || '')) return;
    started = true;
    try {
      port = chrome.runtime.connect({ name: 'glaze:quick' });
      port.onDisconnect.addListener(expire);
      port.onMessage.addListener((r) => {
        if (dead) return;
        if (r?.changed) { if (!busy) load().catch(expire); return; }
        const p = pending.get(r?.id);
        if (p) { pending.delete(r.id); clearTimeout(p.timer); p.resolve(r); }
      });
      request({ ticket: e.data.ticket }).then((r) => {
        if (!r?.ok) throw new Error('sender');
        return load();
      }).then(() => {
        if (!key) return expire();
        clearTimeout(startTimer);
        say(watcher ? '' : 'Sharing controls need visibility protection. Open Settings from Glaze to share.', undefined, !watcher);
        lock();
      }, expire);
    } catch { expire(); }
  });
  addEventListener('pagehide', expire); // BFCache restoration never revives a consumed ticket
  addEventListener('online', () => { if (!dead && started) { try { port.postMessage({ online: true }); } catch { return expire(); } load().catch(expire); } });
})();
