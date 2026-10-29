// The editor's Mods tab: the installed mods (lib/modbundle.js records, read and changed only through the worker's
// 'glaze:mods' broker), adding one from a .glazemod file, a glazemod1: code or the gallery's offer, the install prompt, and
// dev mode for authors. Every name, label and reason shown comes from a bundle's sanitized `prompt` view and reaches the
// page as textContent. The editor's own records, in storage.local: modOrder ([id]: the order the student sets, in which
// mods win a shared slot and run their transforms), modSettings:<id> ({ setting id: value }, cleaned against the mod's
// schema), modDev (dev mode) and modAuthor (the author key, lib/modbundle.js).
// Extension options page only (mount); the pure helpers are for node tests.
var GZ_MODSEDIT = globalThis.GZ_MODSEDIT || (() => {
  const B = () => (typeof GZ_MODBUNDLE !== 'undefined' ? GZ_MODBUNDLE : require('./modbundle.js'));
  const API = () => (typeof GZ_MODAPI !== 'undefined' ? GZ_MODAPI : require('./modapi.js'));
  const XP = () => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js'));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const DATA = ['courses', 'todo', 'grades', 'nav.read'];

  // ---- what a mod is and asks for, in Glaze's words ----------------------------------------------------------------
  // Each permission's plain description; the author's reason follows it, quoted. A widget with no code (plain) is drawn by
  // Glaze, which shows the data on this device only, so it says that instead.
  const permText = (id, t, plain = false) => (plain && id === 'courses' ? t('Courses — shows the names of your courses, on this device only.')
    : plain && id === 'todo' ? t('To Do — shows your to-dos and due dates, on this device only.')
      : plain && id === 'grades' ? t('Grades — shows your grades and GPA, on this device only.')
        : id === 'courses' ? t('Courses — reads the names and details of your courses.')
          : id === 'todo' ? t('To Do — reads your to-dos, due dates and schedule.')
            : id === 'grades' ? t('Grades — reads your grades and GPA in every course.')
              : id === 'nav.read' ? t('Navigation — reads Glaze’s navigation bar: its items, course names and unread counts, and when you use it.')
              : id === 'nav.items' ? t('Navigation items — adds up to eight items of its own to Glaze’s navigation bar, linking only to pages of your school’s site.')
              : id === 'nav.layout' ? t('Navigation layout — can arrange Glaze’s navigation bar while it runs. You can always use your own.')
              : id === 'agents' ? t('Agent apps you connect in Settings → Agents can use this mod’s tools.')
              : id.startsWith('media:') ? t('Its background loads from {host}: that site can see your address and when you use it.', { host: id.slice(6) })
                : id === 'bgfile' ? t('Its background is a video or animation file that comes with it, checked by Glaze.')
                : id === 'code' ? t('Runs its author’s code — Glaze doesn’t draw it itself.')
                : id === 'frame' ? t('A page of its own — shows its own HTML, which can contact other sites.')
                : t('Network — sends and receives data from {host}.', { host: id.slice(8) }));
  // A tool for agent apps (tool:<name>@<from|code>, lib/modtools.js caps): where its answers come from.
  const toolText = (id, view, t) => {
    const [name, from] = id.slice(5).split('@'), title = (view.tools || []).find((x) => x?.name === name)?.title || name;
    return from === 'todo' ? t('Tool “{title}” — gives agent apps your to-dos, as Glaze last read them.', { title })
      : from === 'schedule' ? t('Tool “{title}” — gives agent apps your to-dos with due dates, as Glaze last read them.', { title })
        : from === 'courses' ? t('Tool “{title}” — gives agent apps your courses, as Glaze last read them.', { title })
          : from === 'grades' ? t('Tool “{title}” — gives agent apps your grades, as Glaze last read them.', { title })
            : t('Tool “{title}” — its author’s code answers, with what this mod may use.', { title });
  };
  // view: a bundle's `prompt` manifest. → [{ id, text, why, fresh }]; fresh marks what an update newly asks for.
  const lines = (view, t, fresh = null) => B().caps(view).map((id) => ({
    id, text: id.startsWith('tool:') ? toolText(id, view, t) : permText(id, t, plain(view)), why: (view.permissions || []).find((p) => p.id === id)?.why || '', fresh: !!fresh?.includes(id),
  }));
  // A line with a switch on the mod's card: a declared permission. Code, a page of its own, a background's source and tools are told.
  const grantable = (id) => !['code', 'frame', 'bgfile'].includes(id) && !id.startsWith('media:') && !id.startsWith('tool:');
  // Code runs only in Chrome's sandbox.
  const hasCode = (m) => B().hasCode(m);
  // A widget made of blocks (lib/modwidget.js): no code and no page of its own, so Glaze draws it and nothing of the mod runs.
  // With tools, agent apps get its data too, so it isn't worded as staying on this device.
  const plain = (m) => !hasCode(m) && !m?.tools?.length && [...(m?.ui?.tiles || []), ...(m?.ui?.rail || [])].some((s) => Array.isArray(s?.blocks));
  // Glaze's own warnings, beyond each permission. ctx: { t, and (list → text), signed, source, runs }.
  const warnings = (view, { t, and = (a) => a.join(', '), signed, source, runs }) => {
    const ids = (view.permissions || []).map((p) => p.id), out = [];
    const data = DATA.filter((d) => ids.includes(d)), hosts = ids.filter((p) => p.startsWith('network:')).map((p) => p.slice(8));
    const word = { grades: t('grades'), courses: t('courses'), todo: t('to-dos'), 'nav.read': t('navigation') };
    if (data.length && hosts.length) out.push({ kind: 'data', text: t('This mod could send your {data} to {hosts}.', { data: and(data.map((d) => word[d])), hosts: and(hosts) }) });
    if (hosts.length && (view.tools || []).some((x) => x?.code === true)) out.push({ kind: 'tools', text: t('Its tools run its own code and can send what an app asks for to {hosts}.', { hosts: and(hosts) }) });
    if (B().caps(view).includes('frame')) out.push({ kind: 'frame', text: t('It has a page of its own, so it can contact other sites: they can see your address and when you use it.') });
    if (hasCode(view)) out.push({ kind: 'chrome', text: runs ? t('Its code runs only in Chrome.') : t('Needs Chrome: its code won’t run in this browser. Its Look parts and settings still work.') });
    if (!signed) out.push({ kind: 'dev', text: t('Unsigned (Dev): nobody can confirm who made this copy.') });
    if (source !== 'gallery') out.push({ kind: 'review', text: t('Not reviewed: Glaze’s gallery hasn’t checked this mod.') });
    return out;
  };
  const sourceText = (source, t) => ({ file: t('From a file'), code: t('From a mod code'), link: t('From a share link'), gallery: t('From Glaze’s gallery'), dev: t('From a folder'), builder: t('Made in the widget builder') }[source] || '');
  // An author key's fingerprint: its first 16 characters in fours. Display only; the key itself is what Glaze pins.
  const fingerprint = (key) => (typeof key === 'string' ? key.slice(0, 16).match(/.{1,4}/g)?.join(' ') || '' : '');
  // What a mod adds, one line each.
  const adds = (view, t) => {
    const out = [];
    for (const s of view.ui?.tiles || []) out.push(t('A tile: {name}', { name: s.name }));
    for (const s of view.ui?.rail || []) out.push(t('A rail widget: {name}', { name: s.name }));
    if (view.ui?.nav) out.push(t('A navigation of its own'));
    if (view.ui?.background) out.push(t('A background of its own'));
    if (view.hooks) out.push(t('Code that runs while you use your school pages'));
    if (isObj(view.parts)) for (const d of XP().describe({ x: view.parts })) out.push(t(d.why, d.vars));
    for (const r of view.replaces || []) {
      out.push(r === 'bg' ? t('Can replace the background') : r === 'nav' ? t('Can replace the navigation')
        : r.startsWith('effect:') ? t('Can replace the {name} effect', { name: r.slice(7) }) : t('Can replace the {name} tile', { name: r.slice(5) }));
    }
    if (view.packs?.stickers?.length) out.push(t('Stickers: {n}', { n: view.packs.stickers.length }));
    if (view.packs?.pets?.length) out.push(t('Pets to add to your library: {n}', { n: view.packs.pets.length }));
    if (view.settings?.length) out.push(t('{n} settings', { n: view.settings.length }));
    return out;
  };

  // ---- the student's records ---------------------------------------------------------------------------------------
  // A setting's value, cleaned against its schema entry (lib/modbundle.js checked the schema); anything else is the default.
  const value = (s, v) => {
    if (s.type === 'toggle') return typeof v === 'boolean' ? v : s.default ?? false;
    if (s.type === 'choice') return s.options.includes(v) ? v : s.default ?? s.options[0];
    if (s.type === 'color') return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : s.default ?? '#000000';
    if (s.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) v = s.default ?? s.min;
      let x = Math.min(s.max, Math.max(s.min, v));
      if (s.step) {
        const snapped = +(s.min + Math.round((x - s.min) / s.step) * s.step).toFixed(10);
        x = Math.max(s.min, Math.min(s.max, snapped > s.max ? +(snapped - s.step).toFixed(10) : snapped));
      }
      return x;
    }
    if (typeof v !== 'string') v = s.default ?? '';
    return [...v.replace(/[\p{Cc}\p{Cf}\p{Bidi_Control}]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, s.max ?? 500).join('').trim();
  };
  const settings = (specs, saved) => Object.fromEntries((Array.isArray(specs) ? specs : []).map((s) => [s.id, value(s, isObj(saved) && Object.hasOwn(saved, s.id) ? saved[s.id] : undefined)]));
  // The student's order over what is installed: the saved order first, then the rest as installed.
  const order = (ids, saved) => {
    const kept = [...new Set(Array.isArray(saved) ? saved : [])].filter((id) => ids.includes(id));
    return [...kept, ...ids.filter((id) => !kept.includes(id))];
  };
  // A replacement key (manifest `replaces`) as a switch label.
  const replaceLabel = (key, t) => (key === 'bg' ? t('Replace the background') : key === 'nav' ? t('Replace the nav bar')
    : key.startsWith('effect:') ? t('Replace the {name} effect', { name: key.slice(7) }) : t('Replace the {name} tile', { name: key.slice(5) }));
  // The mod that wins `key`: the first in the student's order (ids) that has it on. claims: { id: [keys on] }, for mods that are on.
  const winner = (key, ids, claims) => ids.find((id) => claims[id]?.includes(key)) || null;
  const move = (list, id, by) => {
    const at = list.indexOf(id), to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return list;
    const out = [...list];
    out.splice(to, 0, ...out.splice(at, 1));
    return out;
  };
  // An update keeps what the student granted before and adds what the prompt showed as new; an install grants all it asks.
  const grantsFor = (view, before, fresh) => (view.permissions || []).map((p) => p.id).filter((p) => !before || fresh.includes(p) || before.grants?.[p]);
  // The hosts the worker fetches for a mod with these grants, which the browser must hold too: its network:<host> grants and
  // an https background its parts name. As addresses, for lib/site.js reach.
  const hostsFor = (view, grants) => [
    ...grants.filter((g) => typeof g === 'string' && g.startsWith('network:')).map((g) => `https://${g.slice(8)}/`),
    ...[view.parts?.bg?.media?.src].filter((src) => typeof src === 'string' && src.startsWith('https://')),
  ];
  // The broker's refusals ({ error, reason, why, vars, blocked }) in words.
  const refusal = (r, t) => {
    if (r?.error === 'bundle') return t(r.why || "That mod file is damaged, or isn't a Glaze mod.", r.vars || {});
    if (r?.error === 'refused') {
      return {
        blocked: () => t('Glaze has blocked this mod: {reason}', { reason: r.blocked || '' }),
        'dev-off': () => t('Turn on dev mode (Mod development, below) to use unsigned mods.'),
        key: () => t('This mod is signed by a different author than the one you installed it from, so Glaze won’t take it.'),
        signed: () => t('An unsigned copy can’t replace a signed mod.'),
        dev: () => t('Remove the Dev copy of this mod first, then install the signed one.'),
        same: () => t('This exact mod is already installed.'),
        version: () => t('This isn’t newer than the version Glaze already has.'),
        id: () => t('That isn’t the same mod.'),
      }[r.reason]?.() || t('Glaze couldn’t do that.');
    }
    if (r?.error === 'hash') return t('The mod changed after it was shown. Try again.');
    if (r?.error === 'write') return t('Glaze couldn’t save that. Try again.');
    return t('Glaze couldn’t do that.');
  };
  const stopText = (why, t) => (why === 'hung' ? t('It stopped answering, so Glaze stopped it on that page.') : why === 'error' ? t('It failed, so Glaze stopped it on that page.')
    : why === 'navigated' ? t('Its frame was sent elsewhere, so Glaze stopped it on that page.') : '');

  // ---- the page ----------------------------------------------------------------------------------------------------
  const std = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  const unstd = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // a: { t, and, when (ms → date text), show (route) }.
  const mount = (a) => {
    const { t, and, when } = a;
    const local = chrome.storage.local;
    const send = (m) => chrome.runtime.sendMessage({ type: 'glaze:mods', ...m }).catch(() => ({ ok: false, error: 'failed' }));
    const channel = (m) => chrome.runtime.sendMessage({ type: 'glaze:modchannel', ...m }).catch(() => ({ ok: false, error: 'network' }));
    const $ = (id) => document.getElementById(id);
    const h = (tag, props = {}, ...kids) => {
      const e = document.createElement(tag);
      e.append(...kids.flat().filter((k) => k != null && k !== false));
      for (const [k, v] of Object.entries(props)) if (v == null || v === false) continue; else if (k in e && !k.includes('-')) e[k] = v; else e.setAttribute(k, v === true ? '' : v);
      return e;
    };
    const say = (el, text, err = false) => { el.classList.toggle('err', err); el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); };
    const why = (e) => t(e?.why || "That mod file is damaged, or isn't a Glaze mod.", e?.vars || {});
    const download = (bytes, name, type = 'application/octet-stream') => {
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      h('a', { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const fileName = (name) => `${B().slug(name) || 'mod'}.glazemod`;
    const runs = async () => !!chrome.runtime.getManifest().sandbox && (await local.get('modRuntime')).modRuntime?.ok !== false;

    // ---- the install prompt ----
    const dialog = $('mod-prompt');
    let pending = null, confirmed = null, offering = false; // { got, bytes, source, before, fresh }
    const finish = async (installing) => {
      const p = pending;
      pending = null;
      if (!p) return;
      // The hosts it reaches, asked for in Install's click (held): refused, it isn't installed.
      const refused = installing && !await p.held;
      if (refused) say($('mods-said'), refusal({ error: 'host' }, t), true);
      if (!installing || refused) { if (p.channel) await channel({ op: 'dismiss', id: p.got.id }); if (p.source === 'gallery') await send({ op: 'dismissOffer', zip: std(p.bytes) }); await takeOffer(); return; }
      const r = await send({ op: 'install', zip: std(p.bytes), hash: p.got.hash, grants: grantsFor(p.got.manifest, p.before, p.fresh), source: p.source, ...(p.channel && { channel: p.channel }) });
      if (p.channel) await channel({ op: 'dismiss', id: p.got.id });
      say($('mods-said'), r.ok ? t(r.action === 'update' ? 'Updated {name}.' : 'Installed {name}.', { name: p.got.prompt.name }) : refusal(r, t), !r.ok);
      if (p.source === 'dev' && r.ok) say($('mod-folder-said'), t('Loaded {name} (Dev).', { name: p.got.prompt.name }));
      if (!r.ok && p.source === 'gallery') await send({ op: 'dismissOffer', zip: std(p.bytes) });
      a.show('mods/installed');
      await takeOffer();
    };
    $('mod-prompt-install').addEventListener('click', (e) => {
      if (!e.isTrusted || !pending || !dialog.open) { e.preventDefault(); return; }
      confirmed = pending;
      // In the click itself: the browser's prompt for the hosts it reaches needs it.
      pending.held = GZ_SITE.reach(hostsFor(pending.got.manifest, grantsFor(pending.got.manifest, pending.before, pending.fresh)));
    });
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      const installing = !!pending && confirmed === pending;
      confirmed = null;
      finish(installing);
    });
    const prompt = async (got, bytes, source, before, fresh, link) => {
      const v = got.prompt, update = !!before;
      pending = { got, bytes, source, before, fresh, channel: link };
      $('mod-prompt-title').textContent = t(update ? 'Update {name}?' : 'Install {name}?', { name: v.name });
      $('mod-prompt-meta').textContent = [t('Version {version}', { version: v.version }), t('by {name}', { name: v.author.name }), t('author key {key}', { key: fingerprint(got.key) })].join(' · ');
      $('mod-prompt-source').replaceChildren(sourceText(source, t), ...(source === 'gallery' ? [' ', h('span', { className: 'mod-badge ok', textContent: t('Reviewed') })] : []),
        ...(link ? [' ', channelNotice(link, t)] : []),
        ...(got.signed ? [] : [' ', h('span', { className: 'mod-badge', textContent: t('Dev') })]));
      const ls = lines(v, t, update ? fresh : null);
      $('mod-prompt-perms-note').textContent = !ls.length ? t('It asks for nothing: no data, no network and no page of its own.') : update ? t('It now also asks for what is marked New.')
        : plain(v) ? t('It has no code. Glaze draws it itself, so what it shows stays on this device:') : t('It asks for:');
      $('mod-prompt-perms').replaceChildren(...ls.map((l) => h('li', { className: l.fresh ? 'mod-new' : '' },
        l.fresh ? h('strong', { className: 'mod-badge new', textContent: t('New') }) : null, h('span', { textContent: l.text }),
        l.why ? h('span', { className: 'mod-why' }, h('span', { className: 'mod-why-label', textContent: t('The author says:') }), ' ', h('q', { textContent: l.why })) : null)));
      const ws = warnings(v, { t, and, signed: got.signed, source, runs: await runs() });
      $('mod-prompt-warn').replaceChildren(...ws.map((w) => h('li', { className: `mod-warn-${w.kind}`, textContent: w.text })));
      $('mod-prompt-install').textContent = t(update ? 'Update' : 'Install');
      dialog.returnValue = '';
      if (!dialog.open) dialog.showModal();
      $('mod-prompt-cancel').focus();
    };
    // A bundle's bytes from anywhere → the prompt, a quiet update, or why not. `said`: where to say it.
    const offerBytes = async (bytes, source, said, link) => {
      if (pending || offering) return false;
      offering = true;
      try {
        let got;
        try { got = await B().read(bytes); } catch (e) { say(said, why(e), true); return false; }
        const list = await send({ op: 'list' });
        const before = (list.mods || []).find((r) => r.id === got.id) || null;
        const k = `modTrust:${got.id}`, r = await local.get(['modDev', k]);
        const plan = B().plan(before, got, { dev: r.modDev === true, trust: r[k] || null });
        if (plan.action === 'refuse') { say(said, refusal({ error: 'refused', reason: plan.reason }, t), true); return false; }
        if (!plan.prompt) {
          const done = await send({ op: 'install', zip: std(bytes), hash: got.hash, grants: [], source, ...(link && { channel: link }) });
          say(said, done.ok ? t('Updated {name}.', { name: got.prompt.name }) : refusal(done, t), !done.ok);
          return done.ok;
        }
        await prompt(got, bytes, source, before, plan.newPermissions, link);
        return true;
      } finally { offering = false; }
    };

    // ---- adding a mod: file, drop, code, gallery ----
    const addSaid = $('mod-add-said');
    const fromFile = async (file) => {
      if (!file) return;
      if (file.size > B().CAP.archive) return say(addSaid, t('That mod is too big: a mod holds at most 2 MiB in 256 files, 256 KiB of it code.'), true);
      offerBytes(new Uint8Array(await file.arrayBuffer()), 'file', addSaid);
    };
    $('mod-file-btn').addEventListener('click', () => $('mod-file').click());
    $('mod-file').addEventListener('change', (e) => { fromFile(e.target.files[0]); e.target.value = ''; });
    const drop = $('mod-drop');
    drop.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.dataset.drop = ''; } });
    drop.addEventListener('dragleave', () => { delete drop.dataset.drop; });
    drop.addEventListener('drop', (e) => { e.preventDefault(); delete drop.dataset.drop; fromFile(e.dataTransfer.files[0]); });
    $('mod-code-read').addEventListener('click', async () => {
      const text = $('mod-code').value.trim();
      // A mod channel's link: its newest bundle, through the same prompt; installing it follows the channel. Its relay is
      // asked for first, in this click (Glaze's own is held already: no prompt).
      if (/\/j#1\.[er]\./.test(text)) {
        if (!await GZ_SITE.reach([text])) return say(addSaid, channelText('network', t), true);
        const r = await channel({ op: 'follow', link: text });
        if (!r.ok) return say(addSaid, channelText(r.error, t), true);
        if (await offerBytes(unstd(r.zip), 'link', addSaid, r.link)) $('mod-code').value = '';
        return;
      }
      let bytes;
      try { bytes = await B().decode($('mod-code').value); } catch (e) { return say(addSaid, why(e), true); }
      if (await offerBytes(bytes, 'code', addSaid)) $('mod-code').value = '';
    });
    // The gallery's offer (lib/background.js): the bundle the worker fetched and checked, or why it couldn't.
    const takeOffer = async () => {
      const { modOffer: o } = await local.get('modOffer');
      if (!isObj(o) || pending || offering) return;
      a.show('mods/add');
      if (typeof o.zip !== 'string') { await send({ op: 'dismissOffer', zip: null, at: o.at }); return say(addSaid, t(typeof o.error === 'string' ? o.error : 'Glaze couldn’t do that.', isObj(o.vars) ? o.vars : {}), true); }
      let bytes;
      try { bytes = unstd(o.zip); } catch { bytes = new Uint8Array(); }
      if (!await offerBytes(bytes, 'gallery', addSaid)) await send({ op: 'dismissOffer', zip: o.zip });
    };

    // ---- installed mods ----
    const list = $('mods-list');
    let drawing = null, dirty = false;
    const draw = async () => {
      const r = await send({ op: 'list' }), mods = r.mods || [];
      const all = await local.get(['modStops', 'modRuntime', 'modOrder', 'modDev', 'modAuthor', ...mods.flatMap((m) => [`modSettings:${m.id}`, `modChannel:${m.id}`, `modReplace:${m.id}`, `modPrivate:${m.id}`])]);
      const canRun = !!chrome.runtime.getManifest().sandbox && all.modRuntime?.ok !== false;
      $('mods-runtime').hidden = canRun;
      $('mods-empty').hidden = mods.length > 0;
      const stops = isObj(all.modStops) ? all.modStops : {};
      const focus = list.contains(document.activeElement) || $('mods-order').contains(document.activeElement) ? document.activeElement.dataset.f : '';
      const ids = order(mods.map((m) => m.id), all.modOrder);
      // What each mod that is on has turned on, among the keys it declares, and who wins each (the order decides).
      const claims = Object.fromEntries(mods.filter((m) => canRun && m.enabled === true && !m.blocked && (!m.dev || all.modDev === true) && hasCode(m.manifest)
        && (m.manifest.hooks || all[`modPrivate:${m.id}`] !== true))
        .map((m) => [m.id, API().claims(all[`modReplace:${m.id}`], m.manifest)]));
      list.replaceChildren(...mods.map((rec) => card(rec, { canRun, stop: stops[rec.id], saved: all[`modSettings:${rec.id}`], dev: all.modDev === true, mine: rec.key === all.modAuthor?.x,
        ch: isObj(all[`modChannel:${rec.id}`]) ? all[`modChannel:${rec.id}`] : null, replaced: all[`modReplace:${rec.id}`], claims, ids, names: Object.fromEntries(mods.map((m) => [m.id, m.prompt.name])) })));
      $('mods-order-group').hidden = ids.length < 2;
      $('mods-order').replaceChildren(...ids.map((id, i) => {
        const name = mods.find((m) => m.id === id).prompt.name, step = (by) => local.set({ modOrder: move(ids, id, by) });
        return h('li', {}, h('span', { textContent: name }),
          h('button', { type: 'button', textContent: t('Move up'), 'data-f': `order:${id}:up`, 'aria-label': `${t('Move up')} · ${name}`, 'aria-disabled': String(i === 0), onclick: () => i > 0 && step(-1) }),
          h('button', { type: 'button', textContent: t('Move down'), 'data-f': `order:${id}:down`, 'aria-label': `${t('Move down')} · ${name}`, 'aria-disabled': String(i === ids.length - 1), onclick: () => i < ids.length - 1 && step(1) }));
      }));
      if (focus) document.querySelector(`[data-f="${CSS.escape(focus)}"]`)?.focus();
    };
    const redraw = () => {
      dirty = true;
      drawing ||= Promise.resolve().then(() => { dirty = false; return draw(); }).finally(() => {
        drawing = null;
        if (dirty) redraw();
      });
    };
    const act = async (m, name) => { const r = await send(m); if (!r.ok) say($('mods-said'), refusal(r, t), true); else if (name) say($('mods-said'), name); return r; };
    const card = (rec, { canRun, stop, saved, dev, mine, ch, replaced, claims, ids, names }) => {
      const v = rec.prompt, id = rec.id, f = (k) => `${id}:${k}`;
      const blocked = typeof rec.blocked === 'string' && rec.blocked;
      const on = h('input', { type: 'checkbox', checked: rec.enabled !== false && !blocked, disabled: !!blocked, 'data-f': f('on'), 'aria-label': t('{name} is on', { name: v.name }),
        onchange: (e) => act({ op: e.target.checked ? 'enable' : 'disable', id }, t(e.target.checked ? 'Turned on {name}.' : 'Turned off {name}.', { name: v.name })).then(redraw) });
      const meta = [t('Version {version}', { version: v.version }), t('by {name}', { name: v.author.name }), t('author key {key}', { key: fingerprint(rec.key) }), sourceText(rec.source, t)];
      const status = [
        blocked && h('p', { className: 'mod-status err', textContent: t('Glaze has blocked this mod: {reason}', { reason: blocked }) }),
        !blocked && stop && stopText(stop.why, t) && h('p', { className: 'mod-status err', textContent: `${stopText(stop.why, t)} ${t('Turn it off and on again to try it again.')}` }),
        hasCode(v) && h('p', { className: 'mod-status', textContent: canRun ? t('Its code runs only in Chrome.') : t('Needs Chrome: its code won’t run in this browser. Its Look parts and settings still work.') }),
        rec.dev && !dev && h('p', { className: 'mod-status', textContent: t('Dev mode is off, so this Dev copy stays off.') }),
        rec.updatedAt && h('p', { className: 'desc', textContent: t('Updated {date}', { date: when(rec.updatedAt) }) }),
        rec.channel && h('p', { className: 'desc', textContent: [t('Follows its author’s channel.'), channelNotice(rec.channel, t), ch?.tried ? t('Last checked {date}', { date: when(ch.tried) }) : t('Not checked yet.')].join(' ') }),
        rec.channel && ch?.error && h('p', { className: 'mod-status err', textContent: channelText(ch.error, t) }),
        rec.channel && ch?.pending && ch.pending.hash !== rec.hash && h('p', { className: 'mod-status' }, t('Version {version} asks for more.', { version: ch.pending.version }), ' ',
          h('button', { type: 'button', textContent: t('Review update'), 'data-f': f('review'), onclick: () => offerBytes(unstd(ch.pending.zip), 'link', $('mods-said'), rec.channel) })),
      ];
      const perms = lines(v, t).map((l) => {
        if (!grantable(l.id)) return h('li', {}, h('span', { textContent: l.text }));
        const granted = !!rec.grants?.[l.id];
        return h('li', {}, h('label', { className: 'check' },
          h('input', { type: 'checkbox', checked: granted, 'data-f': f(`perm:${l.id}`), onchange: (e) => {
            const on = e.target.checked;
            // A network host switched on is asked for in this click, as at install; refused, it stays off.
            (on ? GZ_SITE.reach(hostsFor({}, [l.id])) : Promise.resolve(true)).then((held) => {
              if (held) return act({ op: on ? 'grant' : 'revoke', id, perm: l.id }).then(redraw);
              e.target.checked = false;
              say($('mods-said'), refusal({ error: 'host' }, t), true);
            });
          } }),
          h('span', { textContent: l.text }),
          l.why ? h('span', { className: 'desc mod-why' }, h('span', { className: 'mod-why-label', textContent: t('The author says:') }), ' ', h('q', { textContent: l.why })) : null));
      });
      const specs = rec.manifest.settings || [], vals = settings(specs, saved);
      const put = (sid, x) => local.set({ [`modSettings:${id}`]: Object.assign(vals, settings(specs, { ...vals, [sid]: x })) });
      const fields = specs.map((s, i) => {
        const display = v.settings[i], label = display.label || t('Setting {n}', { n: i + 1 }), k = f(`set:${s.id}`);
        if (s.type === 'toggle') return h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: vals[s.id], 'data-f': k, onchange: (e) => put(s.id, e.target.checked) }), h('span', { textContent: label }));
        const control = s.type === 'choice'
          ? h('select', { 'data-f': k, onchange: (e) => put(s.id, s.options[+e.target.value]) }, s.options.map((o, j) => h('option', { value: String(j), textContent: display.options[j] || t('Option {n}', { n: j + 1 }), selected: o === vals[s.id] })))
          : h('input', { type: { number: 'number', color: 'color', text: 'text' }[s.type], value: String(B().prompt(vals[s.id])), 'data-f': k, min: display.min, max: display.max, step: display.step, maxLength: s.type === 'text' ? display.max ?? 500 : null,
            onchange: (e) => put(s.id, s.type === 'number' ? +e.target.value : e.target.value) });
        return h('label', { className: 'field wide' }, h('span', { textContent: label }), control);
      });
      const keys = rec.manifest.replaces || [];
      const swaps = keys.map((k) => {
        const on = replaced?.[k] === true, rivals = ids.filter((o) => claims[o]?.includes(k));
        const win = on && claims[id]?.includes(k) && rivals.length > 1 ? winner(k, ids, claims) : null;
        return h('li', {}, h('label', { className: 'check' },
          h('input', { type: 'checkbox', checked: on, 'data-f': f(`replace:${k}`),
            onchange: (e) => act({ op: 'replace', id, set: { [k]: e.target.checked } }).then(redraw) }),
          h('span', { textContent: replaceLabel(k, t) }),
          win ? h('span', { className: 'desc', 'data-f': f(`wins:${k}`), textContent: t('{name} wins this place, because it is higher in your order.', { name: names[win] }) }) : null));
      });
      const what = adds(v, t), wipe = h('input', { type: 'checkbox', checked: true, 'data-f': f('wipe') });
      return h('li', { className: 'mod-card', 'data-mod': id },
        h('div', { className: 'mod-head' }, h('h3', { textContent: v.name }),
          rec.source === 'gallery' ? h('span', { className: 'mod-badge ok', textContent: t('Reviewed') }) : null,
          rec.dev ? h('span', { className: 'mod-badge', textContent: t('Dev') }) : null, on),
        h('p', { className: 'desc', textContent: meta.filter(Boolean).join(' · ') }), status,
        what.length ? [h('h4', { textContent: t('What it adds') }), h('ul', { className: 'mod-adds' }, what.map((x) => h('li', { textContent: x })))] : null,
        swaps.length ? [h('h4', { textContent: t('What it may replace') }), h('ul', { className: 'mod-perms' }, swaps)] : null,
        perms.length ? [h('h4', { textContent: t('What it may use') }), h('ul', { className: 'mod-perms' }, perms)] : null,
        fields.length ? [h('h4', { textContent: t('Its settings') }), h('div', { className: 'mod-settings' }, fields)] : null,
        // On by default: what a mod stored (perhaps copies of grades) shouldn't outlive it unless the student wants it kept.
        h('label', { className: 'check' }, wipe, h('span', { textContent: t('Remove its stored data too') })),
        h('div', { className: 'row' },
          // A widget the student made in the builder opens there again (lib/editor-widget.js).
          mine && a.canEdit?.(rec.manifest) && a.edit ? h('button', { type: 'button', textContent: t('Edit in the widget builder'), 'data-f': f('edit'), 'aria-label': `${t('Edit in the widget builder')} · ${v.name}`, onclick: () => a.edit(rec) }) : null,
          h('button', { type: 'button', textContent: t('Export'), 'data-f': f('export'), 'aria-label': `${t('Export')} · ${v.name}`, onclick: async () => {
            const r = await act({ op: 'export', id });
            if (r.ok) download(unstd(r.zip), fileName(r.name));
          } }),
          rec.channel && h('button', { type: 'button', textContent: t('Check now'), 'data-f': f('check'), 'aria-label': `${t('Check now')} · ${v.name}`, onclick: async () => {
            await channel({ op: 'check', id });
            redraw();
          } }),
          rec.channel && h('button', { type: 'button', textContent: t('Stop following'), 'data-f': f('unfollow'), 'aria-label': `${t('Stop following')} · ${v.name}`,
            onclick: () => channel({ op: 'unfollow', id }).then((r) => { say($('mods-said'), r.ok ? t('{name} no longer follows its channel.', { name: v.name }) : channelText(r.error, t), !r.ok); redraw(); }) }),
          h('button', { type: 'button', className: 'danger', textContent: t('Remove'), 'data-f': f('remove'), 'aria-label': `${t('Remove')} · ${v.name}`, onclick: async () => {
            if (!confirm(t(wipe.checked ? 'Remove {name}? Its settings and the data it stored on this device go too.' : 'Remove {name}? Its settings on this device go too, but the data it stored stays.', { name: v.name }))) return;
            const r = await act({ op: 'remove', id, data: wipe.checked }, t('Removed {name}.', { name: v.name }));
            if (r.ok) { await local.remove(`modSettings:${id}`); $('heading-mods-installed').focus(); }
          } })));
    };

    // ---- dev mode: load a folder, export signed, the author key ----
    const devBox = $('mod-dev'), folderSaid = $('mod-folder-said'), keySaid = $('mod-key-said');
    devBox.addEventListener('change', () => local.set({ modDev: devBox.checked }));
    const picker = typeof showDirectoryPicker === 'function';
    $('mod-folder').disabled = !picker;
    $('mod-folder-chrome').hidden = picker;
    let folder = null, loaded = null; // the folder handle, and { files, manifest } read from it
    const walk = async (dir, at = '', out = [], size = { n: 0, entries: 0 }) => {
      for await (const [name, e] of dir.entries()) {
        if (++size.entries > B().CAP.files * B().CAP.depth) throw Object.assign(new Error('big'), { why: 'That mod is too big: a mod holds at most 2 MiB in 256 files, 256 KiB of it code.' });
        if (name.startsWith('.') || (!at && name === 'mod.sig')) continue;
        const p = at + name;
        if (p.length > B().CAP.path || p.split('/').length > B().CAP.depth) throw Object.assign(new Error('path'), { why: "That mod has a file Glaze won't open: {path}.", vars: { path: p.slice(0, 80) } });
        if (e.kind === 'directory') { await walk(e, `${p}/`, out, size); continue; }
        const file = await e.getFile();
        size.n += file.size;
        if (out.length >= B().CAP.files || size.n > B().CAP.total) throw Object.assign(new Error('big'), { why: 'That mod is too big: a mod holds at most 2 MiB in 256 files, 256 KiB of it code.' });
        out.push([p, new Uint8Array(await file.arrayBuffer())]);
      }
      return out;
    };
    const loadFolder = async () => {
      if (!folder) return;
      loaded = null;
      $('mod-reload').disabled = false;
      $('mod-export-signed').disabled = true;
      $('mod-publish').disabled = true;
      try {
        const list = await walk(folder);
        const at = list.findIndex(([p]) => p === 'mod.json');
        let manifest = null;
        try { manifest = at >= 0 ? JSON.parse(new TextDecoder().decode(list[at][1])) : null; } catch { /* the bundle check says so */ }
        // A folder's mod.json may leave the author key out: the editor's own key fills it in, as Export signed does.
        const { modAuthor } = await local.get('modAuthor');
        if (isObj(manifest) && isObj(manifest.author) && !Object.hasOwn(manifest.author, 'key') && isObj(modAuthor)) {
          list[at] = ['mod.json', new TextEncoder().encode(`${JSON.stringify({ ...manifest, author: { ...manifest.author, key: modAuthor.x } }, null, 2)}\n`)];
        }
        const got = await B().bundle(list);
        loaded = { files: Object.fromEntries(list.filter(([p]) => p !== 'mod.json')), manifest };
        $('mod-reload').disabled = false;
        $('mod-export-signed').disabled = false;
        $('mod-publish').disabled = false;
        await offerBytes(B().archive(got.files), 'dev', folderSaid);
      } catch (e) { say(folderSaid, why(e), true); }
    };
    $('mod-folder').addEventListener('click', async () => {
      try { folder = await showDirectoryPicker({ mode: 'read' }); } catch { return; }
      loadFolder();
    });
    $('mod-reload').addEventListener('click', loadFolder);
    const author = async () => {
      const { modAuthor } = await local.get('modAuthor');
      return modAuthor && await B().keyPair(modAuthor) ? modAuthor : null;
    };
    const makeKey = async () => {
      const r = await send({ op: 'author' });
      if (!r.ok) throw Object.assign(new Error('author'), { why: refusal(r, t) });
      if (r.created) say(keySaid, t('Made your author key. Back it up now: without it you can’t update your mods.'));
      return r.key;
    };
    $('mod-export-signed').addEventListener('click', async () => {
      if (!loaded) return;
      try {
        const key = await author() || await makeKey();
        const out = await B().pack(loaded.files, loaded.manifest, key);
        download(out.bytes, fileName(out.manifest.name));
        say(folderSaid, t('Exported {name}, signed with your author key.', { name: out.prompt.name }));
      } catch (e) { say(folderSaid, why(e), true); }
    });
    const publishSaid = $('mod-publish-said');
    const copy = async (link) => { try { await navigator.clipboard.writeText(link); return true; } catch { return false; } };
    $('mod-publish').addEventListener('click', async () => {
      if (!loaded) return;
      let out;
      try { out = await B().pack(loaded.files, loaded.manifest, await author() || await makeKey()); } catch (e) { return say(publishSaid, why(e), true); }
      say(publishSaid, t('Publishing {name}…', { name: out.prompt.name }));
      const r = await channel({ op: 'publish', zip: std(out.bytes) });
      if (!r.ok) return say(publishSaid, r.error === 'version' ? t('Raise the version first: the channel already has {version}.', { version: r.version }) : channelText(r.error, t), true);
      say(publishSaid, t(await copy(r.link) ? 'Published version {version}. The channel link is copied.' : 'Published version {version}.', { version: r.version }));
    });
    $('mod-channel-copy').addEventListener('click', async () => {
      const key = await author();
      if (!loaded || !key || typeof loaded.manifest?.name !== 'string') return say(publishSaid, t('This mod has no channel yet.'), true);
      let id;
      try { id = (await B().pack(loaded.files, loaded.manifest, key)).id; } catch (e) { return say(publishSaid, why(e), true); }
      const r = await channel({ op: 'ownLink', id });
      say(publishSaid, r.ok && await copy(r.link) ? t('Copied the channel link.') : t('This mod has no channel yet.'), !r.ok);
    });
    $('mod-key-make').addEventListener('click', () => makeKey().catch((e) => say(keySaid, why(e), true)));
    $('mod-key-save').addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      const key = await author();
      if (!key) return say(keySaid, t('There is no author key on this device yet.'), true);
      const pass = $('mod-key-pass').value;
      if (!pass) {
        say(keySaid, t('Enter a passphrase to back up your author key.'), true);
        $('mod-key-pass').focus();
        return;
      }
      download(new TextEncoder().encode(await B().backup(key, pass)), 'glaze-author-key.json', 'application/json');
      say(keySaid, t('Saved your author key, locked with your passphrase.'));
    });
    $('mod-key-restore-btn').addEventListener('click', () => $('mod-key-file').click());
    $('mod-key-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const key = await B().restore(file.size <= 4096 ? await file.text() : '', $('mod-key-pass').value);
        const now = await author();
        if (now && now.x !== key.x && !confirm(t('Replace your author key? Mods signed with the current one can then only be updated with it.'))) return;
        await local.set({ modAuthor: key });
        say(keySaid, t('Restored your author key.'));
      } catch (err) { say(keySaid, why(err), true); }
    });
    const drawDev = async () => {
      const { modDev } = await local.get('modDev');
      devBox.checked = modDev === true;
      $('mod-dev-tools').hidden = modDev !== true;
      const key = await author();
      $('mod-key-now').textContent = key ? t('Your author key: {key}', { key: fingerprint(key.x) }) : t('No author key yet. Glaze makes one the first time you export a signed mod.');
      $('mod-key-make').disabled = !!key;
      $('mod-key-save').disabled = !key;
    };

    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local') return;
      const keys = Object.keys(c);
      if (keys.some((k) => ['mods', 'modStops', 'modRuntime', 'modOrder', 'modDev', 'modsBlocklist'].includes(k) || /^mod(Settings|Channel|Replace|Private)?:/.test(k))) redraw();
      if (c.modDev || c.modAuthor) drawDev();
      if (c.modOffer?.newValue) takeOffer();
    });
    redraw();
    drawDev();
    takeOffer();
    channel({ op: 'check' }); // the editor opening checks followed channels; their state redraws the cards
  };

  // A mod channel's failure (lib/modchannel.js codes), in Glaze's words. Said once in the Mods tab, never as a notice.
  const channelText = (code, t) => (code === 'write' ? t('Glaze couldn’t save that. Try again.')
    : code === 'link' ? t('That isn’t a mod channel link.')
    : code === 'gone' ? t('That channel no longer exists.')
      : code === 'empty' || code === 'kind' ? t('That link isn’t a mod channel, or nothing is published there yet.')
        : code === 'bundle' ? t('The channel’s mod file is damaged.')
          : code === 'unsigned' ? t('Only signed mods can be published to a channel.')
            : code === 'blocked' ? t('Glaze has blocked the channel’s newest version.')
              : code === 'refused' ? t('The channel’s newest version isn’t a valid update of this mod, so Glaze kept the one you have.')
                : t('Couldn’t reach the channel. Glaze tries again later.'));

  const channelNotice = (link, t) => {
    try { return t('Updates are checked at {host} about once a day', { host: new URL(link).host }); } catch { return ''; }
  };

  return { DATA, permText, channelNotice, channelText, lines, grantable, hasCode, plain, warnings, sourceText, fingerprint, adds, value, settings, order, replaceLabel, winner, move, grantsFor, hostsFor, refusal, stopText, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODSEDIT;
