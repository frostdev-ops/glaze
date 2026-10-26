// Settings → AI (docs/ai-harness.md): the switch, the connection (a model on this device, or an endpoint), which of Glaze's
// features may use it, and the record of recent calls. storage.local `ai` (lib/ai/settings.js) holds the switches; the
// connections and keys stay in the worker (lib/ai/broker.js 'glaze:ai-config': get, set, test, models, and the device
// provider's prepare), and a key comes back only masked. Save and Test ask the browser for exactly the address's host
// (lib/site.js reach) from their click, before anything is awaited. The record (storage.local aiCalls, lib/ai/failure.js) is
// metadata only and never leaves this device. Every word reaches the page as textContent.
// Extension options page only (mount); the pure helpers are for node tests.
var GZ_AIEDIT = globalThis.GZ_AIEDIT || (() => {
  const A = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('./ai/settings.js'));
  const E = () => (typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('./ai/endpoint.js'));
  const TYPE = 'glaze:ai-config', CALLS = 'aiCalls';
  // The two connections Settings keeps, by their id in the broker's store (and storage.local ai.use).
  const ENDPOINT = 'endpoint', DEVICE = 'device';
  // A model request's failure categories (lib/ai/failure.js CATEGORIES).
  const CATEGORIES = ['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  // An address, a host or a reference kept in its own direction inside a sentence (right-to-left pages).
  const iso = (s) => `⁨${s}⁩`;

  const featureName = (id, t) => ({ syllabus: t('Syllabus import') }[id] || id);
  const providerName = (id, t) => ({ openai: t('Endpoint'), device: t('On this device') }[id] || id);
  // A call's or a test's end, in a word or two: its state, else its failure category.
  const outcome = (code, t) => ({ completed: t('Done'), pending: t('Waiting for you'), running: t('Running'), cancelled: t('Cancelled'), timeout: t('Timed out'),
    'provider-unavailable': t('Unavailable'), 'request-rejected': t('Refused'), 'invalid-response': t('Unreadable answer'), 'connection-lost': t('Connection lost'),
    check: t('No usable answer'), refusal: t('No usable answer') }[code] || t('Not run'));
  // Why a Test didn't say ready (the broker's reason).
  const reason = (r, t) => (r === 'permission' ? t('Glaze isn’t allowed to reach this address.') : r === 'model' ? t('This endpoint doesn’t list that model.')
    : CATEGORIES.includes(r) ? outcome(r, t) : t('Not ready'));
  // The device provider's status: { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason?, progress? (0 to 1) }.
  const deviceText = (st, t, pct) => (st.state === 'ready' ? t('Ready') : st.state === 'download' ? t('Needs a download')
    : st.state === 'downloading' ? (typeof st.progress === 'number' ? t('Downloading {pct}', { pct: pct(st.progress) }) : t('Downloading…'))
      : st.reason === 'browser' ? t('Not available in this browser') : t('Not available on this device'));
  // A download's progress message: { progress } or { loaded, total? } (Chrome's downloadprogress gives a fraction) → 0 to 1, or null.
  const progress = (m) => {
    const n = typeof m?.progress === 'number' ? m.progress : typeof m?.loaded === 'number' ? (m.total > 0 ? m.loaded / m.total : m.loaded) : NaN;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
  };
  // The call record's rows, newest first, as far as they are what lib/ai/failure.js writes; nothing else of a row is kept.
  const rows = (calls) => (Array.isArray(calls) ? calls : []).filter((r) => isObj(r) && Number.isFinite(r.startedAt)).map((r) => ({
    at: r.startedAt, feature: typeof r.feature === 'string' ? r.feature : '', provider: typeof r.provider === 'string' ? r.provider : '',
    state: typeof r.state === 'string' ? r.state : '', ...(CATEGORIES.includes(r.category) && { category: r.category }),
    ...(Number.isInteger(r.status) && { status: r.status }), ...(typeof r.id === 'string' && { reference: r.id }),
    ...(isObj(r.usage) && { tokens: [r.usage.input, r.usage.output].filter(Number.isFinite).reduce((a, b) => a + b, 0) }),
  })).sort((a, b) => b.at - a.at);
  // The newest of the last run and the last Test, when it failed (cancelling isn't failing): { category, status?, reference? }.
  const lastFailure = (calls, tested) => {
    const run = rows(calls).find((r) => r.state !== 'running');
    const newest = [run && { ...run, failed: !!run.category && run.category !== 'cancelled' }, tested].filter(Boolean).sort((a, b) => b.at - a.at)[0];
    return newest?.failed ? newest : null;
  };
  const failureText = (f, t) => `${t('Last failure: {what}', { what: `${outcome(f.category, t)}${f.status ? ` (HTTP ${f.status})` : ''}` })}${f.reference ? ` · ${t('Reference {ref}', { ref: iso(f.reference) })}` : ''}`;
  const hostOf = (base) => { try { return new URL(base).host; } catch { return ''; } };

  // t: the editor's words; when(ms): a time; pct(0 to 1): a percentage.
  const mount = ({ t, when = (at) => new Date(at).toLocaleString(), pct = (x) => `${Math.round(x * 100)}%` }) => {
    const $ = (id) => document.getElementById(id);
    const c = globalThis.chrome, local = c.storage.local, S = A(), KEY = S.KEY;
    const send = (m) => Promise.resolve().then(() => c.runtime.sendMessage({ type: TYPE, ...m })).then((r) => (isObj(r) ? r : { ok: false, error: 'failed' }), () => ({ ok: false, error: 'failed' }));
    const offered = S.PROVIDERS.includes(DEVICE);
    let s = S.clean(), conns = {}, calls = [], tested = null, device = null, catalog = null, unverified = false, shownKey = '', busy = false;

    // ---- the switches (storage.local ai) -------------------------------------------------------------------------------
    // Read again before each write, so a change elsewhere (another Settings tab) isn't written over.
    const write = async (patch) => {
      const cur = S.clean((await local.get(KEY))?.[KEY]);
      s = S.clean({ ...cur, ...patch(cur) });
      render();
      await local.set({ [KEY]: s });
    };
    const boxes = new Map();
    $('ai-feature-list').replaceChildren(...S.FEATURES.map((id) => {
      const label = document.createElement('label'), box = document.createElement('input'), name = document.createElement('span');
      label.className = 'check';
      Object.assign(box, { type: 'checkbox' });
      box.setAttribute('data-local', '');
      name.textContent = featureName(id, t);
      box.addEventListener('change', () => write((cur) => ({ features: { ...cur.features, [id]: box.checked } })));
      boxes.set(id, box);
      label.append(box, name);
      return label;
    }));

    // ---- what shows ----------------------------------------------------------------------------------------------------
    const say = (text, err = false, focus = '') => {
      const p = $('ai-said');
      p.textContent = text;
      p.classList.toggle('err', err);
      if (focus) $(focus).focus();
    };
    const renderModel = () => {
      const m = $('ai-model').value.trim();
      $('ai-model-unverified').hidden = !(conns[ENDPOINT] && m && (catalog ? catalog.source !== 'live' || !catalog.ids.includes(m) : unverified));
    };
    const renderDevice = () => {
      $('ai-device-state').textContent = device ? deviceText(device, t, pct) : '';
      $('ai-device-download').hidden = device?.state !== 'download';
      const bar = $('ai-device-progress');
      bar.hidden = !(device?.state === 'downloading' && typeof device.progress === 'number');
      if (!bar.hidden) bar.value = device.progress;
    };
    const renderCalls = () => {
      const list = rows(calls);
      $('ai-calls').replaceChildren(...list.map((r) => {
        const li = document.createElement('li'), name = document.createElement('span'), what = document.createElement('span'), more = document.createElement('small');
        name.className = 'name';
        what.textContent = `${featureName(r.feature, t)} · ${providerName(r.provider, t)}`;
        more.textContent = [when(r.at), r.tokens ? t('{n} tokens', { n: r.tokens }) : '', outcome(r.category || r.state, t)].filter(Boolean).join(' · ');
        name.append(what, more);
        li.append(name);
        return li;
      }));
      $('ai-calls-empty').hidden = list.length > 0;
      $('ai-calls-clear').disabled = !list.length;
    };
    const render = () => {
      $('ai-on').checked = s.on;
      $('ai-connection').hidden = !s.on;
      const dev = $('ai-use-device'), end = $('ai-use-endpoint');
      dev.disabled = !offered;
      $('ai-device-off').hidden = offered;
      dev.checked = s.use === DEVICE;
      end.checked = s.use === ENDPOINT;
      $('ai-device').hidden = !(offered && s.use === DEVICE);
      $('ai-endpoint').hidden = s.use !== ENDPOINT;
      const host = s.use === ENDPOINT ? hostOf(conns[ENDPOINT]?.base) : '';
      $('ai-where').hidden = !host;
      $('ai-where').textContent = host ? t('Sent to {host}', { host: iso(host) }) : '';
      const f = lastFailure(calls, tested);
      $('ai-failure').hidden = !f;
      $('ai-failure').textContent = f ? failureText(f, t) : '';
      $('ai-features').hidden = !s.on;
      for (const [id, box] of boxes) box.checked = s.features[id] === true;
      $('ai-activity').hidden = !s.on && !rows(calls).length;
      renderModel();
      renderDevice();
      renderCalls();
    };

    // ---- the connections (the worker's) --------------------------------------------------------------------------------
    // The endpoint's fields as kept: the key only masked, in clear text since it is no secret; typing a key hides it again.
    const keyField = $('ai-key');
    const fill = () => {
      const kept = conns[ENDPOINT];
      shownKey = kept?.key || '';
      $('ai-base').value = kept?.base || '';
      $('ai-model').value = kept?.model || '';
      keyField.value = shownKey;
      keyField.type = shownKey ? 'text' : 'password';
    };
    keyField.addEventListener('focus', () => { if (shownKey && keyField.value === shownKey) keyField.select?.(); });
    keyField.addEventListener('input', () => { keyField.type = 'password'; });
    // The key to send: none (keep the kept one) while the field still shows it masked; '' removes it.
    const keyOut = () => (keyField.value === shownKey ? undefined : keyField.value.trim());
    const load = async () => {
      const r = await send({ op: 'get' });
      conns = r.ok && isObj(r.connections) ? r.connections : {};
      fill();
      render();
    };
    const models = async () => {
      const r = await send({ op: 'models', id: ENDPOINT });
      catalog = r.ok && Array.isArray(r.models) ? { source: r.source, ids: r.models.map((m) => m?.id).filter((id) => typeof id === 'string') } : { source: 'none', ids: [] };
      $('ai-models').replaceChildren(...catalog.ids.slice(0, 500).map((id) => Object.assign(document.createElement('option'), { value: id })));
      renderModel();
    };
    // Save, or Test (which saves first what was changed). `asked`: the browser's answer for the host, asked from the click.
    const go = async (base, model, asked, test) => {
      const kept = conns[ENDPOINT], key = keyOut();
      if (!test || !kept || kept.base !== base || kept.model !== model || key !== undefined) {
        const r = await send({ op: 'set', id: ENDPOINT, cfg: { provider: 'openai', base, model, ...(key !== undefined && { key }) } });
        if (!r.ok) return say(r.error === 'write' ? t('Could not save. Try again.') : t('Check the address, the model and the key.'), true);
        catalog = null; unverified = false;
        await load();
      }
      if (!await asked) return say(t('Glaze isn’t allowed to reach {host}.', { host: iso(hostOf(base)) }), true);
      if (!test) { say(t('Saved')); return models(); }
      say(t('Testing…'));
      const r = await send({ op: 'test', id: ENDPOINT });
      const ready = r.ok && r.state === 'ready';
      tested = { at: Date.now(), failed: !ready && CATEGORIES.includes(r.reason) && r.reason !== 'cancelled',
        category: r.reason, ...(Number.isInteger(r.status) && { status: r.status }), ...(typeof r.reference === 'string' && { reference: r.reference }) };
      unverified = !!r.unverified;
      say(ready ? t('Ready') : reason(r.ok ? r.reason : r.error, t), !ready);
      render();
      return models();
    };
    const endpointClick = (button, test) => button.addEventListener('click', (e) => {
      if (!e?.isTrusted || busy) return;
      const model = $('ai-model').value.trim();
      let base;
      try { base = E().parse($('ai-base').value); } catch { return say(t('Use an https address, or http on localhost or 127.0.0.1.'), true, 'ai-base'); }
      if (!model) return say(t('Enter a model.'), true, 'ai-model');
      // The browser's prompt, from this click, before anything is awaited: exactly this address's host.
      const asked = Promise.resolve(GZ_SITE.reach(base, button)).then((ok) => ok === true, () => false);
      busy = true;
      go(base, model, asked, test).catch(() => say(t('Could not save. Try again.'), true)).finally(() => { busy = false; });
    });
    endpointClick($('ai-save'), false);
    endpointClick($('ai-test'), true);
    $('ai-model').addEventListener('input', renderModel);
    $('ai-model').addEventListener('focus', () => { if (!catalog && conns[ENDPOINT]) models(); });

    // On this device: the provider's status, a download the student starts, and its progress as the worker reports it.
    const deviceStatus = async () => {
      let r = await send({ op: 'test', id: DEVICE });
      if (!r.ok && r.error === 'setup' && (await send({ op: 'set', id: DEVICE, cfg: { provider: DEVICE } })).ok) r = await send({ op: 'test', id: DEVICE });
      device = r.ok ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }) } : { state: 'unavailable', reason: r.error };
      renderDevice();
    };
    $('ai-device-download').addEventListener('click', (e) => {
      if (!e?.isTrusted || device?.state !== 'download') return;
      device = { state: 'downloading' };
      renderDevice();
      send({ op: 'prepare', provider: DEVICE }).then(deviceStatus);
    });
    c.runtime.onMessage?.addListener((m, sender) => {
      if (sender?.id !== c.runtime.id || m?.type !== TYPE || m.op !== 'progress' || m.provider !== DEVICE) return;
      const n = progress(m);
      if (n === null) return;
      device = { state: 'downloading', progress: n };
      renderDevice();
      if (n >= 1) deviceStatus();
    });

    // ---- the student's changes -----------------------------------------------------------------------------------------
    $('ai-on').addEventListener('change', () => write(() => ({ on: $('ai-on').checked })));
    for (const [id, use] of [['ai-use-device', DEVICE], ['ai-use-endpoint', ENDPOINT]]) {
      $(id).addEventListener('change', () => {
        if (!$(id).checked) return;
        write(() => ({ use }));
        if (use === DEVICE) deviceStatus();
      });
    }
    $('ai-calls-clear').addEventListener('click', (e) => {
      if (!e?.isTrusted) return;
      calls = [];
      render();
      local.remove(CALLS);
    });
    c.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (KEY in changes) s = S.clean(changes[KEY].newValue);
      if (CALLS in changes) calls = Array.isArray(changes[CALLS].newValue) ? changes[CALLS].newValue : [];
      if (KEY in changes || CALLS in changes) render();
    });

    render();
    local.get([KEY, CALLS]).then((got) => {
      s = S.clean(got?.[KEY]);
      calls = Array.isArray(got?.[CALLS]) ? got[CALLS] : [];
      render();
      if (s.on && s.use === DEVICE && offered) deviceStatus();
    });
    load();
  };

  return { ENDPOINT, DEVICE, CATEGORIES, featureName, providerName, outcome, reason, deviceText, progress, rows, lastFailure, failureText, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_AIEDIT;
