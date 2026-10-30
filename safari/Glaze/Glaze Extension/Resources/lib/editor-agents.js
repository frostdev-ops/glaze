// Settings → Agents: agent access's switch, the glaze-mcp helper's link, the apps the student paired with the groups each may
// use, and the activity list. The worker keeps all of it (lib/background.js 'glaze:mcp-config': state once as the page
// opens, set, apps, grant, revoke, forget; from this top frame only), and the student's consent in its own database. The link
// is storage.session mcpLink (lib/agent-link.js status), read here and followed through storage.onChanged. The worker hears
// from this page as it opens (state is a trigger there, so a helper installed since connects) and, on Chrome, once more
// after WAIT of Starting…; otherwise never, so a page left open doesn't wake it into another try at a helper. Turning on
// asks the browser for nativeMessaging first, in the click, as Firefox loses the gesture across an await (Safari holds it
// from the start). On Chrome only a worker started after the grant connects (the owner's restart decision), so until then
// the link says restart; Firefox connects at once. Turning off lets the worker end the link before the permission goes.
// Firefox says not-installed for a helper that doesn't list Glaze too, and nothing about why one exited, so no line rests on
// forbidden or the error. The activity list is storage.local mcpCalls (lib/mcp/grants.js record), metadata only. Every word
// reaches the page as textContent.
// Extension options page only (mount); the pure helpers are for node tests.
var GZ_AGENTSEDIT = globalThis.GZ_AGENTSEDIT || (() => {
  const TYPE = 'glaze:mcp-config', LINK = 'mcpLink', CALLS = 'mcpCalls', SETTING = 'mcp';
  const NATIVE = { permissions: ['nativeMessaging'] };
  // Firefox's listing declares no data collection, and website content as optional: agent apps get course data outside the
  // browser, so the same click asks for that consent, and turning off gives it back.
  const FIREFOX = { ...NATIVE, data_collection: ['websiteContent'] };
  const SETUP = 'npx glaze-mcp setup', DOCTOR = 'npx glaze-mcp doctor', UPDATE = 'npx glaze-mcp@latest setup';
  // lib/agent-link.js's no-node: the browser-started helper found no Node.js of the system's own (Claude's runtime can't be
  // one). Tried again on triggers only.
  const NO_NODE = 'no-node';
  // Chrome stops an idle worker about 30-40 s after its last event and starts one only for the next, which this page doesn't
  // send while it shows Starting…: after WAIT it asks once. A worker started for that ask has connectNative and connects at
  // its start; one that still answers restart is kept up by something else, and the line offers Glaze's reload instead.
  const WAIT = 60e3;
  // Glaze's groups (lib/ai/tools.js GROUPS), named as the approval window names them; a mod's group is mod:<id>.
  const GROUPS = ['courses', 'grades', 'writer', 'assignments'];
  // What lib/mcp/grants.js records of a call's end.
  const OUTCOMES = ['ok', 'error', 'declined', 'timeout', 'interrupted', 'refused', 'busy', 'cancelled'];
  const ID = /^[a-z2-7]{16}$/, MOD = /^mod:([a-z2-7]{16})$/, TOOL = /^[a-z][a-z0-9_]{0,63}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const str = (v) => (typeof v === 'string' ? v : '');

  const browserOf = (url) => (/^safari-web-extension:/i.test(url) ? 'safari' : /^moz-extension:/i.test(url) ? 'firefox' : 'chrome');
  // What Settings says of the link (status: lib/agent-link.js status()) → { tone: 'ok' | 'wait' | 'bad', text, command?,
  // act? }, or null while it is off. The command goes where text says {command}; act: 'allow' (ask for nativeMessaging),
  // 'reload' (Glaze's reload, once WAIT's ask still found restart: stuck) or 'site' (the page's link to frostdev.io/glaze, for
  // the DMG build of the Glaze app, the one with the agent bridge). On Safari the helper is that app, which starts by itself:
  // nothing to run there.
  const line = (status, { browser = 'chrome', id = '', stuck = false } = {}, t) => {
    const s = isObj(status) ? status.state : 'off';
    if (s === 'connected') return { tone: 'ok', text: t('Ready') };
    if (s === 'restart' && stuck && browser === 'chrome') return { tone: 'bad', text: t('Restart Glaze to start the helper'), act: 'reload' };
    if (s === 'connecting' || s === 'restart') return { tone: 'wait', text: t('Starting…') };
    if (browser === 'safari') {
      return s === 'not-installed' ? { tone: 'bad', text: t('Agent access in Safari needs the Glaze app from frostdev.io'), act: 'site' }
        : s === 'old-helper' ? { tone: 'bad', text: t('Update the Glaze app from frostdev.io'), act: 'site' }
          : s === 'exited' ? { tone: 'bad', text: t('The Glaze app stopped; Glaze is retrying.') } : null;
    }
    return s === 'not-installed' ? { tone: 'bad', text: t('In Claude Desktop, add the Glaze extension. For other apps, run {command}'), command: SETUP }
      : s === 'forbidden' ? { tone: 'bad', text: '{command}', command: `${SETUP} --extension-id ${id}` }
        : s === 'exited' ? { tone: 'bad', text: t('The helper stopped; Glaze is retrying. {command} says why.'), command: DOCTOR }
          : s === 'old-helper' ? { tone: 'bad', text: t('Update the helper: {command}'), command: UPDATE }
            : s === NO_NODE ? { tone: 'bad', text: t('Install Node.js 18+ for browsers to start the helper') }
              : s === 'needs-permission' ? { tone: 'bad', text: t('Allow Glaze to start the helper'), act: 'allow' } : null;
  };
  const groupName = (g, t) => ({ courses: t('Courses, to-dos and schedule'), grades: t('Grades'), writer: t('Writer documents'), assignments: t('Assignments and rubrics') }[g] || g);
  const outcome = (o, t) => ({ ok: t('Done'), error: t('Failed'), declined: t('Declined'), timeout: t('Timed out'), interrupted: t('Interrupted'), refused: t('Refused'),
    busy: t('Busy'), cancelled: t('Cancelled') }[o] || o);
  const failed = (o) => ['error', 'timeout', 'interrupted'].includes(o);
  // The activity rows, newest first, as far as they are what lib/mcp/grants.js records; nothing else of a row is kept.
  const rows = (calls) => (Array.isArray(calls) ? calls : []).filter((r) => isObj(r) && Number.isFinite(r.at) && OUTCOMES.includes(r.outcome) && TOOL.test(str(r.tool)))
    .map((r) => ({ at: r.at, app: ID.test(str(r.app)) ? r.app : '', tool: r.tool, outcome: r.outcome })).sort((a, b) => b.at - a.at);
  // The apps as the worker lists them (lib/mcp/grants.js records): only what the cards show.
  const appsOf = (list) => (Array.isArray(list) ? list : []).filter((a) => isObj(a) && ID.test(str(a.id))).map((a) => ({
    id: a.id, name: str(a.name), exe: str(a.exe), at: Number.isFinite(a.at) ? a.at : null, used: Number.isFinite(a.used) ? a.used : null,
    grants: Object.keys(isObj(a.grants) ? a.grants : {}).filter((g) => a.grants[g] === true && (GROUPS.includes(g) || MOD.test(g))), declined: isObj(a.declined) && a.declined.pair !== undefined,
  }));
  // An app's switches: Glaze's groups, each installed mod with agent tools (mods: [{ id, name }]), then any other mod group it
  // still holds, by its id, so that it can be turned off.
  const switches = (app, mods, t) => {
    const held = app.grants.filter((g) => MOD.test(g) && !mods.some((m) => `mod:${m.id}` === g)).map((g) => ({ id: MOD.exec(g)[1], name: MOD.exec(g)[1] }));
    return [...GROUPS.map((g) => [g, groupName(g, t)]), ...[...mods, ...held].map((m) => [`mod:${m.id}`, t('The mod {mod}', { mod: m.name })])];
  };

  // t: the editor's words; when(ms): a time; day(ms): a date; hint(text): the header's message.
  const mount = ({ t, when = (at) => new Date(at).toLocaleString(), day = (at) => new Date(at).toLocaleDateString(), hint = () => {} }) => {
    if (window.top !== window) return;
    const $ = (id) => document.getElementById(id);
    const c = globalThis.chrome, local = c.storage.local, session = c.storage.session;
    const browser = browserOf(c.runtime.getURL(''));
    const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const button = (text, on) => { const b = el('button', '', text); b.type = 'button'; b.addEventListener('click', on); return b; };
    const send = (m) => {
      try { return Promise.resolve(c.runtime.sendMessage({ type: TYPE, ...m })).then((r) => (isObj(r) ? r : { ok: false }), () => ({ ok: false })); }
      catch { return Promise.resolve({ ok: false }); }
    };
    // Called first in a click, before anything is awaited.
    const perms = browser === 'firefox' ? FIREFOX : NATIVE;
    const ask = () => { try { return Promise.resolve(c.permissions.request(perms)).catch(() => false); } catch { return Promise.resolve(false); } };
    // on: the worker's consent; link: its last status; busy: the switch on its way; unsaved: the last change failed; command:
    // the one the line shows.
    let on = false, link = null, apps = [], mods = [], calls = [], busy = false, unsaved = false, command = '';
    let stateRead = 0, linkVersion = 0, callsVersion = 0;
    // Starting… on Chrome: the state it began with (waiting), its one timer, and whether WAIT's ask still found restart.
    let waiting = '', wait = 0, stuck = false;
    // A part is drawn again only when what it shows changed, so the link's line isn't announced again and a card keeps its
    // focus when something else moves.
    const drawn = {};
    const once = (part, state, draw) => { const sig = JSON.stringify(state); if (drawn[part] !== sig) { drawn[part] = sig; draw(); } };

    // ---- the switch and the link ---------------------------------------------------------------------------------------
    const renderLine = () => {
      const l = on ? line(link, { browser, id: c.runtime.id, stuck }, t) : null, box = $('agents-state'), p = $('agents-line');
      box.hidden = !l;
      command = l?.command || '';
      $('agents-copy').hidden = !command;
      $('agents-allow').hidden = l?.act !== 'allow';
      $('agents-restart').hidden = l?.act !== 'reload';
      $('agents-app').hidden = l?.act !== 'site';
      if (!l) return void p.replaceChildren();
      box.dataset.tone = l.tone;
      const [a, b = ''] = l.text.split('{command}'), parts = [a];
      if (command) {
        const code = el('code', '', command);
        code.setAttribute('translate', 'no');
        code.setAttribute('dir', 'ltr');
        parts.push(code, b);
      }
      p.replaceChildren(...parts.filter((x) => x !== ''));
    };
    // Reads caused by a click or a storage event cannot apply an older answer over a newer one.
    const loadState = async () => {
      const turn = ++stateRead, r = await send({ op: 'state' });
      if (r.ok && turn === stateRead) { on = r.on === true; render(); }
      return r;
    };
    // WAIT's one ask (see WAIT), whose answer stands unless the worker has written since.
    const recheck = async () => {
      wait = 0;
      const version = linkVersion, r = await loadState();
      if (r.ok && version === linkVersion && isObj(r.link)) { link = r.link; ++linkVersion; }
      stuck = link?.state === 'restart';
      render();
    };
    // Each Starting… on Chrome gets one wait; any other state, or off, ends it.
    const bound = () => {
      const s = on && browser === 'chrome' && ['restart', 'connecting'].includes(link?.state) ? link.state : '';
      if (s === waiting) return;
      clearTimeout(wait);
      waiting = s; stuck = false;
      wait = s ? setTimeout(recheck, WAIT) : 0;
    };
    const toggle = async (want, asked) => {
      busy = true;
      render();
      try {
        if (want && asked && !await asked) return;
        ++stateRead;
        const version = linkVersion, r = await send({ op: 'set', on: want });
        unsaved = !r.ok;
        if (r.ok) {
          on = want;
          if (version === linkVersion && isObj(r.link)) { link = r.link; ++linkVersion; }
        }
        // set can save consent and then fail while starting the link. Read what it saved either way.
        const saved = await loadState();
        if (!want && !on && (r.ok || saved.ok) && browser !== 'safari') await Promise.resolve(c.permissions.remove(perms)).catch(() => {});
      } finally { busy = false; render(); }
    };
    $('agents-on').addEventListener('click', (e) => {
      const want = $('agents-on').checked, asked = want && !busy && browser !== 'safari' ? ask() : null; // first, in the click
      if (busy) return void e.preventDefault(); // one change at a time: the click undone
      toggle(want, asked);
    });
    $('agents-allow').addEventListener('click', () => { ask(); });
    $('agents-restart').addEventListener('click', () => { try { c.runtime.reload(); } catch { /* nothing to restart */ } });
    $('agents-copy').addEventListener('click', async () => {
      const text = command;
      try { await navigator.clipboard.writeText(text); hint(t('Copied.')); }
      catch { const code = $('agents-line').querySelector?.('code'); if (code) getSelection?.()?.selectAllChildren(code); }
    });

    // ---- the apps --------------------------------------------------------------------------------------------------------
    const card = (app) => {
      const li = el('li', 'ag-app'), who = el('div', 'ag-who'), name = el('b', '', app.name || t('Unnamed app'));
      name.setAttribute('translate', 'no');
      who.append(name, el('span', '', t('as the app reports itself')));
      if (app.exe) { const exe = el('span', 'ag-exe', app.exe); exe.setAttribute('translate', 'no'); exe.setAttribute('dir', 'ltr'); who.append(exe); }
      const drop = button(app.declined ? t('Forget') : t('Revoke'), () => change({ op: 'revoke', app: app.id }));
      drop.dataset.f = `revoke:${app.id}`;
      li.append(who, drop);
      if (app.declined) { li.append(el('small', '', t('Declined'))); return li; }
      li.append(el('small', '', [app.at !== null && t('Paired {date}', { date: day(app.at) }), app.used !== null && t('Last used {date}', { date: when(app.used) })].filter(Boolean).join(' · ')));
      const list = el('div', 'ag-grants');
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', app.name || t('Unnamed app'));
      for (const [group, words] of switches(app, mods, t)) {
        const row = el('label', 'ag-grant'), box = el('input');
        Object.assign(box, { type: 'checkbox', checked: app.grants.includes(group) });
        box.setAttribute('role', 'switch');
        box.setAttribute('data-local', '');
        box.dataset.f = `grant:${app.id}:${group}`;
        box.addEventListener('click', () => change({ op: 'grant', app: app.id, group, on: box.checked }));
        row.append(el('span', '', words), box);
        list.append(row);
      }
      li.append(list);
      return li;
    };
    // Drawn again, a card gives the focus back to the control that had it; one that went gives it to Forget all apps, or to
    // the switch once no app is left.
    const walk = (e) => [e, ...(e.children ? [...e.children].flatMap(walk) : [])];
    const renderApps = () => {
      const active = document.activeElement, had = walk($('agents-apps-box')).includes(active) ? active.dataset?.f || active.id : '';
      $('agents-apps').replaceChildren(...apps.map(card));
      $('agents-apps-box').hidden = !apps.length;
      if (had) (walk($('agents-apps')).find((x) => x.dataset?.f === had) || (apps.length ? $('agents-forget') : $('agents-on')))?.focus?.();
    };
    // One read at a time; a change while one runs reads again after it.
    let reading = null, again = false;
    const loadApps = () => {
      if (reading) { again = true; return reading; }
      reading = (async () => {
        do {
          again = false;
          const r = await send({ op: 'apps' });
          if (r.ok) apps = appsOf(r.apps);
        } while (again);
        reading = null;
        render();
      })();
      return reading;
    };
    const loadMods = async () => {
      let r = null;
      try { r = await c.runtime.sendMessage({ type: 'glaze:mods', op: 'list' }); } catch { /* no worker: no mods shown */ }
      mods = (Array.isArray(r?.mods) ? r.mods : []).filter((m) => isObj(m) && ID.test(str(m.id)) && Array.isArray(m.manifest?.tools) && m.manifest.tools.length)
        .map((m) => ({ id: m.id, name: str(m.prompt?.name) || str(m.manifest.name) || m.id }));
      render();
    };
    // Drawn again from the worker's answer either way, so a refused switch goes back.
    const change = async (m) => {
      const r = await send(m);
      unsaved = !r.ok;
      delete drawn.apps;
      await loadApps();
    };
    $('agents-forget').addEventListener('click', () => change({ op: 'forget' }));

    // ---- the activity list -------------------------------------------------------------------------------------------
    const renderCalls = () => {
      const list = rows(calls), names = Object.fromEntries(apps.map((a) => [a.id, a.name || t('Unnamed app')]));
      $('agents-calls').replaceChildren(...list.map((r) => {
        const li = el('li'), what = el('span', '', [r.tool, names[r.app]].filter(Boolean).join(' · '));
        what.setAttribute('translate', 'no');
        li.append(what, el('small', failed(r.outcome) ? 'bad' : '', `${when(r.at)} · ${outcome(r.outcome, t)}`));
        return li;
      }));
      $('agents-activity').hidden = !list.length;
    };

    const render = () => {
      if (!busy) $('agents-on').checked = on; // a switch on its way keeps showing where the student put it
      $('agents-said').hidden = !unsaved;
      $('agents-said').textContent = unsaved ? t('Could not save. Try again.') : '';
      bound();
      once('line', [on, link?.state, stuck], renderLine);
      once('apps', [apps, mods], renderApps);
      once('calls', [calls, apps.map((a) => [a.id, a.name])], renderCalls);
    };
    c.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && LINK in changes) { ++linkVersion; link = isObj(changes[LINK].newValue) ? changes[LINK].newValue : null; render(); }
      if (area !== 'local') return;
      if (CALLS in changes) { ++callsVersion; calls = Array.isArray(changes[CALLS].newValue) ? changes[CALLS].newValue : []; render(); loadApps(); }
      // The mirror moved (another Settings tab): what the worker holds.
      if (SETTING in changes) loadState();
      if (Object.keys(changes).some((k) => k === 'mods' || k.startsWith('mod:'))) loadMods();
    });

    // No helper runs on a phone or tablet.
    new Promise((res) => res(c.runtime.getPlatformInfo?.())).catch(() => null).then(async (info) => {
      if (['ios', 'android'].includes(info?.os) || (!info && /iPhone|iPad|iPod|Android/.test(navigator.userAgent))) { $('agents').hidden = true; return; }
      render();
      const lv = linkVersion, cv = callsVersion;
      const [held, mine, r] = await Promise.all([session.get(LINK).catch(() => ({})), local.get(CALLS).catch(() => ({})), loadState()]);
      if (lv === linkVersion) link = isObj(held?.[LINK]) ? held[LINK] : isObj(r.link) ? r.link : null;
      if (cv === callsVersion) calls = Array.isArray(mine?.[CALLS]) ? mine[CALLS] : [];
      render();
      loadApps();
      loadMods();
    });
  };

  return { NATIVE, FIREFOX, SETUP, DOCTOR, UPDATE, NO_NODE, WAIT, GROUPS, OUTCOMES, browserOf, line, groupName, outcome, rows, appsOf, switches, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_AGENTSEDIT;
