// Extension-only UI: links are never rendered, put in a URL, or handed to an LMS content script.
(() => {
  GZ_I18N.page();
  const t = (k, v) => GZ_I18N.t(k, v, GZ_I18N.ui());
  const $ = (s) => document.querySelector(s);
  const human = (e) => e.isTrusted && (navigator.userActivation?.isActive ?? true);
  let state, busy = false, dead = false;
  const say = (k, err = false) => { $('#status').textContent = t(k); $('#status').classList.toggle('error', err); };
  const send = async (op, rest = {}) => {
    const r = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op, ...rest });
    if (!r?.ok) throw new Error(r?.error || 'storage');
    return r;
  };
  const make = (tag, text, props = {}) => Object.assign(document.createElement(tag), { ...(text === undefined ? {} : { textContent: text }), ...props });
  const act = async (f) => {
    if (busy) return;
    busy = true;
    try { await f(); if (!dead) await load(); }
    catch (e) { if (!dead) { say('Could not finish. Your local copies are kept. Try again.', true); if (e.ui) $('#status').textContent += ' ' + e.ui; } }
    finally { busy = false; }
  };
  const button = (key, f) => {
    const b = make('button', t(key), { type: 'button' });
    b.addEventListener('click', (e) => { if (human(e)) act(f); }); return b;
  };
  const permission = () => chrome.permissions.request({ origins: ['https://share.frostdev.io/*'] });
  const names = { pending: 'Changes saved locally, waiting to send', live: 'Up to date', offline: 'Offline — local copy kept', gone: 'Deleted on the relay — local copy kept', incomplete: 'More changes remain. Sync again.' };
  const sources = () => {
    const kind = $('#kind').value;
    const rows = state.sources.filter((s) => s.kind === kind);
    $('#sources').replaceChildren(...rows.map((s, i) => {
      const label = make('label', undefined, { className: 'source' });
      const input = make('input', undefined, { type: kind === 'notes' ? 'radio' : 'checkbox', name: 'source', value: String(i) });
      input.source = s;
      label.append(input, make('span', s.title), make('small', s.key.slice(s.key.indexOf(':') + 1)));
      return label;
    }));
    $('#sources').hidden = kind === 'look';
  };
  const render = () => {
    $('#connection').textContent = t(state.on ? 'Sharing is on while a shared surface is open.' : 'Sharing is paused. Create, join or resume to connect.');
    $('#resume').hidden = state.on;
    $('#pause').hidden = !state.on;
    $('#sessions').replaceChildren(...state.sessions.map((s) => {
      const el = make('article');
      el.append(make('h3', s.title), make('p', t(state.on ? names[s.status] || names.offline : 'Paused — local copy kept')), make('small', t(s.edit ? 'Edit access' : 'View access')));
      const items = make('ul'); for (const x of s.items) items.append(make('li', x.title)); el.append(items);
      el.append(make('p', t('Editing devices, last seen. Names are self-chosen; view-only devices cannot announce themselves.')));
      const members = make('ul'); for (const m of s.members) members.append(make('li', `${m.name} · ${new Date(m.at).toLocaleString()}`)); el.append(members);
      const row = make('div', undefined, { className: 'row' });
      row.append(button('Read local session', async () => {
        const r = await send('read', { sid: s.sid });
        const content = make('div');
        for (const x of Object.values(r.view)) if (x.html !== undefined) { content.append(make('h4', x.title || '…'), make('p', GZ_NOTES.text(x.html))); }
        el.append(content);
      }));
      row.append(button('Copy view invite', async () => { const r = await send('link', { sid: s.sid }); await navigator.clipboard.writeText(r.link); say('Invite copied. Keep it private.'); }));
      if (s.edit) row.append(button('Copy edit invite', async () => { const r = await send('link', { sid: s.sid, edit: true }); await navigator.clipboard.writeText(r.link); say('Invite copied. Keep it private.'); }));
      if (!s.bound && ['notes', 'todo'].includes(s.kind)) {
        const select = make('select', undefined, { ariaLabel: t('Local account for the copy') });
        const keys = state.accounts.filter((k) => k.startsWith(s.kind === 'notes' ? 'notesIdx:' : 'todo:'));
        for (const key of keys) select.append(make('option', key.slice(key.indexOf(':') + 1), { value: key }));
        row.append(select, button('Copy into Notes or To Do', () => send('attach', { sid: s.sid, key: select.value })));
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
        }));
      }
      row.append(button('Leave this device', async () => {
        if (confirm(t('Forget this session’s keys on this device? Your Notes and To Do copies remain. This does not delete it from the relay.'))) await send('leave', { sid: s.sid });
      }));
      el.append(row); return el;
    }));
    if (!state.sessions.length) $('#sessions').append(make('p', t('No sessions on this device.')));
  };
  const load = async () => { state = await send('list'); if (!dead) { render(); if (!$('#sources').children.length) sources(); } };
  $('#kind').addEventListener('change', (e) => { if (human(e)) sources(); });
  $('#pause').addEventListener('click', (e) => { if (human(e)) act(() => send('pause')); });
  $('#resume').addEventListener('click', (e) => { if (!human(e) || busy) return; const p = permission(); act(async () => { if (await p) await send('resume'); }); });
  $('#refresh').addEventListener('click', (e) => { if (human(e)) act(async () => { for (const s of state.sessions) await send('sync', { sid: s.sid }); }); });
  $('#create').addEventListener('click', (e) => {
    if (!human(e) || busy) return;
    const chosen = [...$('#sources').querySelectorAll('input:checked')].map((x) => x.source);
    const kind = $('#kind').value, title = $('#title').value.trim();
    if (!title || (kind !== 'look' && (!chosen.length || !chosen.every((x) => x.key === chosen[0].key)))) return say('Choose a name and items from one local account.', true);
    const p = permission();
    act(async () => {
      if (!await p) return;
      await send('create', { kind, title, key: chosen[0]?.key, folder: chosen[0]?.folder, ids: chosen.flatMap((x) => x.ids || []), name: $('#name').value, expire: $('#expire').checked });
      say('Session saved locally. Share an invite when it is up to date.');
    });
  });
  $('#join').addEventListener('click', (e) => {
    if (!human(e) || busy) return;
    // The key exists only in this extension-owned input until the trusted Join click, then in the worker.
    const link = $('#invite').value.trim(); $('#invite').value = '';
    if (!/^https:\/\/share\.frostdev\.io\/j#1\.[er]\.[\w-]+$/.test(link)) return say('Paste an invite for https://share.frostdev.io.', true);
    const p = permission(); act(async () => { if (await p) await send('join', { link, name: $('#name').value }); });
  });
  const query = new URLSearchParams(location.search), key = query.get('notes');
  if (key && GZ_NOTES.KEY.test(key)) {
    $('#backup').hidden = false;
    $('#import-notes').addEventListener('click', (e) => { if (human(e)) $('#import-file').click(); });
    $('#import-file').addEventListener('change', (e) => {
      if (!e.isTrusted) return;
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      act(async () => {
        const cap = GZ_NOTES.LIMIT.total + (64 << 20);
        if (file.size > cap) throw Object.assign(new Error('big'), { ui: t('That file is too big to import (up to {size}).', { size: Math.round(cap / 1048576) + ' MB' }) });
        $('#status').textContent = t('Reading {name}…', { name: file.name });
        let zip, json, data;
        try {
          zip = GZ_DOCTEXT.unzip(new Uint8Array(await file.arrayBuffer()), { limits: { input: cap, entry: 64 << 20, total: cap, entries: 20000 } });
          json = await zip.text('notes.json');
          data = GZ_NOTES.parseExport(json, { site: new URL(key.slice(9)).origin });
        } catch { throw Object.assign(new Error('bad'), { ui: t("That isn't a notes export from Glaze, or it's damaged.") }); }
        const shareKeys = await zip.text('share-keys.json');
        if (shareKeys !== null && shareKeys !== undefined) await send('importKeys', { keys: JSON.parse(shareKeys) });
        for (const [i, f] of data.files.entries()) {
          $('#status').textContent = t('Importing… {n} of {all}', { n: i + 1, all: data.files.length + data.notes.length });
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
        say('Notes and share keys imported locally. Resume to reconnect.');
        $('#status').textContent += ' ' + t('Notes imported: {n}', { n: done }) + (skipped ? ' · ' + t('Skipped, already here and not older: {n}', { n: skipped }) : '');
      });
    });
    $('#export-notes').addEventListener('click', (e) => {
      if (!human(e)) return;
      act(async () => {
        const r = await send('backupNotes', { key }).catch(() => { throw Object.assign(new Error('read'), { ui: t("Couldn't read your notes. Nothing was saved.") }); });
        const data = r.data, seen = new Set();
        for (const [i, n] of data.notes.entries()) {
          $('#status').textContent = t('Exporting… {n} of {all}', { n: i + 1, all: data.notes.length });
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
        say('Notes and share keys exported. Keep the backup private.');
        $('#status').textContent += ' ' + t('Notes exported: {n}', { n: data.notes.length });
      });
    });
  }
  let port;
  try { port = chrome.runtime.connect({ name: 'glaze:sessions' }); port.onMessage.addListener(() => { if (!busy) load().catch(() => say('Could not finish. Your local copies are kept. Try again.', true)); }); }
  catch { say('Could not finish. Your local copies are kept. Try again.', true); }
  addEventListener('pagehide', () => { dead = true; $('#invite').value = ''; port?.disconnect(); });
  addEventListener('online', () => { if (!dead) { port?.postMessage({ online: true }); load().catch(() => {}); } });
  load().catch(() => say('Could not finish. Your local copies are kept. Try again.', true));
})();
