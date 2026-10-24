// Settings → Sharing and sync → Share sessions, and Backup and privacy → Notes backup (options.html). Extension-only
// UI: links are never rendered, put in a URL, or handed to an LMS content script. The sessions port (and with it any
// relay traffic) is open only while the Sharing tab is showing.
(() => {
  const t = (k, v) => GZ_I18N.t(k, v, GZ_I18N.ui());
  const $ = (s) => document.querySelector(s);
  const human = (e) => e.isTrusted && (navigator.userActivation?.isActive ?? true);
  let state, busy = false, dead = false, port = null;
  const say = (k, err = false) => { $('#ss-status').textContent = t(k); $('#ss-status').classList.toggle('error', err); };
  const send = async (op, rest = {}) => {
    const r = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op, ...rest });
    if (!r?.ok) throw new Error(r?.error || 'storage');
    return r;
  };
  const make = (tag, text, props = {}) => Object.assign(document.createElement(tag), { ...(text === undefined ? {} : { textContent: text }), ...props });
  // A Notes account key (notesIdx:https://school.example/123) as a person reads it.
  const account = (key) => { try { const u = new URL(key.slice(key.indexOf(':') + 1)); return `${u.host} · ${u.pathname.slice(1)}`; } catch { return key; } };
  const act = async (f, { reload = true, interrupt = false } = {}) => {
    if (busy && !interrupt) return;
    busy = true;
    try { await f(); if (reload && !dead) await load(); }
    catch (e) { if (!dead) { say('Could not finish. Your local copies are kept. Try again.', true); if (e.ui) $('#ss-status').textContent += ' ' + e.ui; } }
    finally { busy = false; }
  };
  const button = (key, f, options) => {
    const b = make('button', t(key), { type: 'button' });
    b.addEventListener('click', (e) => { if (human(e)) act(f, options); }); return b;
  };
  const permission = (servers) => {
    const unique = [...new Set(servers)];
    if (unique.some((server) => GZ_RELAY.normalize(server) !== server)) return Promise.resolve(false);
    // Ask synchronously in the input handler. Already-held hosts return yes without a prompt.
    return !unique.length ? Promise.resolve(true) : chrome.permissions.request({ origins: unique.map((server) => server + '/*') });
  };
  const confirmHost = (server) => (server === state.defaultRelay && server === state.relay) || confirm(server === state.defaultRelay
    ? t('This share is hosted on {host}, not your selected relay ({selected}). Connect to this server?', { host: new URL(server).host, selected: new URL(state.relay).host })
    : t('This share is hosted on {host}, not frostdev.io. Connect to this server? Glaze cannot vouch for its operator.', { host: new URL(server).host }));
  const names = { pending: 'Changes saved locally, waiting to send', live: 'Up to date', offline: 'Offline — local copy kept', big: 'Too big to sync — local copy kept', gone: 'Deleted on the relay — local copy kept', incomplete: 'More changes remain. Sync again.' };
  const copy = async (link) => {
    try { await navigator.clipboard.writeText(link); say('Invite copied. Keep it private.'); }
    catch { say('Could not copy the invite. Try again.', true); }
  };
  const sourceId = (s) => JSON.stringify([s.key, s.folder || '', s.ids || []]);
  let sourceStamp = '';
  const sources = () => {
    const kind = $('#ss-kind').value;
    const rows = state.sources.filter((s) => s.kind === kind);
    const stamp = JSON.stringify([kind, rows, !!state.partial]);
    if (stamp === sourceStamp) return; // live updates must not replace the checkbox under a user's pointer
    const selected = new Set([...$('#ss-sources').querySelectorAll('input:checked')].map((x) => sourceId(x.source)));
    sourceStamp = stamp;
    $('#ss-sources').replaceChildren(...rows.map((s) => {
      const label = make('label', undefined, { className: 'check' });
      const input = make('input', undefined, { type: 'checkbox', name: 'ss-source', checked: selected.has(sourceId(s)) });
      input.source = s;
      label.append(input, make('span', s.ids ? s.title : t('Folder: {name}', { name: s.title })), make('span', account(s.key), { className: 'desc' }));
      return label;
    }));
    if (!rows.length && kind !== 'look') $('#ss-sources').append(make('p', t(kind === 'notes' ? 'No notes on this device yet. Write one in Notes on Canvas or Blackboard first.' : 'No custom tasks on this device yet.'), { className: 'desc' }));
    if (state.partial) $('#ss-sources').append(make('p', t('Only the first {n} items are listed.', { n: 3000 }), { className: 'desc' }));
    $('#ss-sources').hidden = kind === 'look';
  };
  const render = () => {
    $('#ss-connection').textContent = t(state.on ? 'Sharing is on while a shared surface is open.' : 'Sharing is paused. Create, join or resume to connect.');
    $('#ss-resume').hidden = state.on && state.sessions.every((s) => s.server === state.defaultRelay || state.hosts.includes(s.server));
    $('#ss-pause').hidden = !state.on;
    $('#ss-refresh').hidden = !state.sessions.length;
    $('#ss-create-relay').textContent = t('New sessions will use {server}.', { server: state.relay });
    if (!$('#ss-name').value && document.activeElement !== $('#ss-name')) $('#ss-name').value = state.name || '';
    $('#ss-sessions').replaceChildren(...state.sessions.map((s) => {
      const el = make('article', undefined, { className: 'ss-session' });
      el.append(make('h4', s.title), make('p', t(state.on ? names[s.status] || names.offline : 'Paused — local copy kept'), { className: 'desc' }),
        make('p', `${t(s.edit ? 'Edit access' : 'View access')} · ${t('Hosted on {server}', { server: s.server })}`, { className: 'desc' }));
      const items = make('ul'); for (const x of s.items) items.append(make('li', x.title)); el.append(items);
      if (s.members.length) {
        el.append(make('p', t('Editing devices, last seen. Names are self-chosen; view-only devices cannot announce themselves.'), { className: 'desc' }));
        const members = make('ul'); for (const m of s.members) members.append(make('li', `${m.name} · ${new Date(m.at).toLocaleString()}`)); el.append(members);
      }
      const row = make('div', undefined, { className: 'row' });
      row.append(button('Copy view invite', async () => copy((await send('link', { sid: s.sid })).link), { reload: false }));
      if (s.edit) row.append(button('Copy edit invite', async () => copy((await send('link', { sid: s.sid, edit: true })).link), { reload: false }));
      row.append(button('Read local session', async () => {
        const r = await send('read', { sid: s.sid });
        const content = make('div', undefined, { className: 'ss-read' });
        for (const x of Object.values(r.view)) if (x.html !== undefined) content.append(make('h5', x.title || '…'), make('p', GZ_NOTES.text(x.html)));
        el.querySelector('.ss-read')?.remove(); el.append(content);
      }, { reload: false }));
      if (!s.bound && ['notes', 'todo'].includes(s.kind)) {
        const keys = state.accounts.filter((k) => k.startsWith(s.kind === 'notes' ? 'notesIdx:' : 'todo:'));
        if (keys.length) {
          const select = make('select', undefined, { ariaLabel: t('Local account for the copy') });
          for (const key of keys) select.append(make('option', account(key), { value: key }));
          row.append(select, button(s.kind === 'notes' ? 'Copy into Notes' : 'Copy into To Do', () => send('attach', { sid: s.sid, key: select.value })));
        } else el.append(make('p', t(s.kind === 'notes' ? 'Open Notes on Canvas or Blackboard once to copy this session into it.' : 'Open To Do on Canvas or Blackboard once to copy this session into it.'), { className: 'desc' }));
      }
      if (s.kind === 'look') row.append(button('Use this Look', () => send('useLook', { sid: s.sid })));
      if (s.edit) row.append(button('Re-upload retained files', () => send('reupload', { sid: s.sid })));
      if (s.creator) {
        const label = make('label', undefined, { className: 'check' });
        const cb = make('input', undefined, { type: 'checkbox', checked: s.expire });
        cb.addEventListener('change', (e) => { if (!human(e)) { cb.checked = s.expire; return; } act(() => send('expiry', { sid: s.sid, on: cb.checked })); });
        label.append(cb, make('span', t('Delete after a year unused'))); el.append(label);
        row.append(button('Delete session from relay', async () => {
          if (confirm(t('Delete the encrypted session and its files from the relay? Device copies and older backups remain.'))) await send('delete', { sid: s.sid });
        }, { interrupt: true }));
      }
      row.append(button('Leave this device', async () => {
        if (confirm(t('Forget this session’s keys on this device? Your Notes and To Do copies remain. This does not delete it from the relay.'))) await send('leave', { sid: s.sid });
      }, { interrupt: true }));
      el.append(row); return el;
    }));
    if (!state.sessions.length) $('#ss-sessions').append(make('p', t('No sessions on this device.'), { className: 'desc' }));
  };
  let pendingNote = null;
  const takeNote = () => {
    if (!pendingNote || !state || dead) return;
    const a = pendingNote; pendingNote = null;
    $('#ss-kind').value = 'notes'; sources();
    for (const input of $('#ss-sources').querySelectorAll('input')) input.checked = input.source.key === a.key && input.source.ids?.includes(a.note);
    const picked = [...$('#ss-sources').querySelectorAll('input:checked')][0]?.source;
    if (picked) $('#ss-title').value = picked.title;
    $('#ss-create').focus();
  };
  globalThis.GZ_SESSION_OFFER = (a) => { if (a?.kind === 'notes') { pendingNote = a; takeNote(); } };
  const load = async () => { state = await send('list'); if (!dead) { render(); sources(); takeNote(); } };
  const fail = () => say('Could not finish. Your local copies are kept. Try again.', true);

  $('#ss-kind').addEventListener('change', (e) => { if (human(e)) sources(); });
  $('#ss-pause').addEventListener('click', (e) => { if (human(e)) act(() => send('pause'), { interrupt: true }); });
  $('#ss-resume').addEventListener('click', (e) => {
    if (!human(e) || busy || !state) return;
    const servers = [...new Set(state.sessions.filter((s) => s.status !== 'gone').map((s) => s.server))];
    const unconfirmed = servers.filter((s) => s !== state.defaultRelay && !state.hosts.includes(s));
    if (!unconfirmed.every(confirmHost)) return;
    const p = permission(servers); act(async () => {
      if (!await p) return say('Host permission was not granted. No connection was made.', true);
      await send('resume', { confirmServers: unconfirmed });
    });
  });
  $('#ss-refresh').addEventListener('click', (e) => { if (human(e)) act(async () => { for (const s of state.sessions) await send('sync', { sid: s.sid }); }); });
  $('#ss-create').addEventListener('click', (e) => {
    if (!human(e) || busy || !state) return;
    const chosen = [...$('#ss-sources').querySelectorAll('input:checked')].map((x) => x.source);
    const kind = $('#ss-kind').value, title = $('#ss-title').value.trim() || (chosen.length === 1 ? chosen[0].title : '');
    const folder = chosen.find((x) => x.folder);
    if (!title || (kind !== 'look' && (!chosen.length || !chosen.every((x) => x.key === chosen[0].key) || (folder && chosen.length > 1)))) {
      return say(folder ? 'Share a folder on its own, or choose notes instead.' : 'Choose a name and items from one local account.', true);
    }
    const server = state.relay, p = permission([server]);
    act(async () => {
      if (!await p) return say('Host permission was not granted. No connection was made.', true);
      await send('create', { kind, title, server, key: chosen[0]?.key, folder: folder?.folder, ids: chosen.flatMap((x) => x.ids || []), name: $('#ss-name').value, expire: $('#ss-expire').checked });
      $('#ss-title').value = ''; for (const x of $('#ss-sources').querySelectorAll('input:checked')) x.checked = false;
      say('Session created. Copy an invite below to share it.');
    });
  });
  $('#ss-join').addEventListener('click', (e) => {
    if (!human(e) || busy || !state) return;
    // The key exists only in this extension-owned input until the trusted Join click, then in the worker.
    const link = $('#ss-invite').value.trim(); $('#ss-invite').value = '';
    const server = GZ_RELAY.invite(link);
    if (!server) return say('Paste a valid Glaze invite link using HTTPS, or HTTP localhost or 127.0.0.1.', true);
    if (!confirmHost(server)) return;
    const p = permission([server]);
    act(async () => {
      if (!await p) return say('Host permission was not granted. No connection was made.', true);
      await send('join', { link, confirmServer: server, name: $('#ss-name').value });
      say('Joined. Copy it into Notes or To Do below to keep working on it there.');
    });
  });

  // The port keeps sessions live while the tab shows; leaving the tab (or Settings) disconnects it.
  const panel = $('#panel-sharing');
  const visible = () => {
    if (dead) return;
    // Settings search unhides all panels, then uses .miss to hide those without a match.
    const showing = !panel.hidden && !panel.classList.contains('miss');
    if (showing && !port) {
      try { port = chrome.runtime.connect({ name: 'glaze:sessions' }); port.onMessage.addListener(() => { if (!busy) load().catch(fail); }); port.onDisconnect.addListener(() => { port = null; }); }
      catch { fail(); }
      load().catch(fail);
    } else if (!showing && port) { port.disconnect(); port = null; }
  };
  new MutationObserver(visible).observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'] });
  visible();
  addEventListener('pagehide', () => { dead = true; $('#ss-invite').value = ''; port?.disconnect(); port = null; });
  addEventListener('online', () => { if (!dead && port) { port.postMessage({ online: true }); load().catch(() => {}); } });

  // ---- Notes backup: one Notes account's notes, files and every share key, as a zip ----------------------------------
  const nb = (text, err = false) => { $('#nb-status').textContent = text; $('#nb-status').classList.toggle('error', err); };
  const nbFail = (e) => { if (!dead) nb([t('Could not finish. Your local copies are kept. Try again.'), e?.ui].filter(Boolean).join(' '), true); };
  let nbBusy = false;
  const nbAct = async (f) => { if (nbBusy) return; nbBusy = true; try { await f(); } catch (e) { nbFail(e); } finally { nbBusy = false; } };
  const wanted = new URLSearchParams(location.search).get('notes');
  const accounts = async () => {
    const keys = (await send('list')).accounts.filter((k) => GZ_NOTES.KEY.test(k));
    const select = $('#nb-account'), was = select.value || (GZ_NOTES.KEY.test(wanted || '') ? wanted : '');
    select.replaceChildren(...keys.map((k) => make('option', account(k), { value: k, selected: k === was })));
    $('#nb-export').disabled = $('#nb-import').disabled = !keys.length;
    if (!keys.length) nb(t('No notes on this device yet. Write one in Notes on Canvas or Blackboard first.'));
  };
  const backupPanel = $('#panel-backup');
  const backupShown = () => { if (!backupPanel.hidden && !dead) accounts().catch(nbFail); };
  new MutationObserver(backupShown).observe(backupPanel, { attributes: true, attributeFilter: ['hidden'] });
  backupShown();
  $('#nb-import').addEventListener('click', (e) => { if (human(e)) $('#nb-file').click(); });
  $('#nb-file').addEventListener('change', (e) => {
    if (!e.isTrusted) return;
    const file = e.target.files[0], key = $('#nb-account').value; e.target.value = '';
    if (!file || !GZ_NOTES.KEY.test(key)) return;
    nbAct(async () => {
      const cap = GZ_NOTES.LIMIT.total + (64 << 20);
      if (file.size > cap) throw Object.assign(new Error('big'), { ui: t('That file is too big to import (up to {size}).', { size: Math.round(cap / 1048576) + ' MB' }) });
      nb(t('Reading {name}…', { name: file.name }));
      let zip, json, data;
      try {
        zip = GZ_DOCTEXT.unzip(new Uint8Array(await file.arrayBuffer()), { limits: { input: cap, entry: 64 << 20, total: cap, entries: 20000 } });
        json = await zip.text('notes.json');
        data = GZ_NOTES.parseExport(json, { site: new URL(key.slice(9)).origin });
      } catch { throw Object.assign(new Error('bad'), { ui: t("That isn't a notes export from Glaze, or it's damaged.") }); }
      const shareKeys = await zip.text('share-keys.json');
      if (shareKeys !== null && shareKeys !== undefined) await send('importKeys', { keys: JSON.parse(shareKeys) });
      for (const [i, f] of data.files.entries()) {
        nb(t('Importing… {n} of {all}', { n: i + 1, all: data.files.length + data.notes.length }));
        const bytes = await zip.bytes(f.path);
        if (!bytes || bytes.length !== f.size) throw Object.assign(new Error('missing'), { ui: t('Left out: {names}', { names: f.name }) });
        const owner = data.notes.find((n) => GZ_NOTES.refs(n.html).has(f.id));
        if (owner) await send('notesFile', { key, file: { id: f.id, note: owner.id, kind: f.kind, name: f.name, data: GZ_NOTES.b64(bytes) } });
      }
      const raw = JSON.parse(json);
      let done = 0, skipped = 0;
      for (let i = 0; i < data.notes.length || i === 0; i += 5) {
        const r = await send('notesImport', { key, json: JSON.stringify({ format: raw.format, version: raw.version, site: raw.site, folders: data.folders, files: data.files, notes: data.notes.slice(i, i + 5) }) });
        done += r.done; skipped += r.skipped;
      }
      nb([t('Notes and share keys imported locally. Resume to reconnect.'), t('Notes imported: {n}', { n: done }), skipped && t('Skipped (already up to date or too large): {n}', { n: skipped })].filter(Boolean).join(' · '));
    });
  });
  $('#nb-export').addEventListener('click', (e) => {
    if (!human(e)) return;
    const key = $('#nb-account').value;
    if (!GZ_NOTES.KEY.test(key)) return;
    nbAct(async () => {
      const r = await send('backupNotes', { key }).catch(() => { throw Object.assign(new Error('read'), { ui: t("Couldn't read your notes. Nothing was saved.") }); });
      const data = r.data, seen = new Set();
      for (const [i, n] of data.notes.entries()) {
        nb(t('Exporting… {n} of {all}', { n: i + 1, all: data.notes.length }));
        const body = await send('notesRead', { key, id: n.id }).catch(() => { throw Object.assign(new Error('read'), { ui: t("Couldn't export “{title}”. Nothing was saved.", { title: n.title }) }); });
        if (body.rev !== n.rev) throw new Error('changed'); // A mixed-revision archive is not a backup.
        n.html = body.html;
        for (const id of GZ_NOTES.refs(n.html)) if (!seen.has(id)) {
          seen.add(id); const f = await send('notesGetFile', { key, id });
          data.files.push({ id, ...f, bytes: GZ_NOTES.unb64(f.data) });
        }
      }
      const entries = GZ_NOTES.exportZip(data);
      entries.push({ name: 'share-keys.json', data: new TextEncoder().encode(JSON.stringify(data.keys, null, 2)), date: new Date() });
      const url = URL.createObjectURL(new Blob(GZ_ZIP.zip(entries), { type: 'application/zip' }));
      const a = make('a', undefined, { href: url, download: 'glaze-notes.zip' }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      nb([t('Notes and share keys exported. Keep the backup private.'), t('Notes exported: {n}', { n: data.notes.length })].join(' · '));
    });
  });
})();
