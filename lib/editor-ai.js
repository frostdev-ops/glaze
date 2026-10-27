// Settings → AI (docs/ai-harness.md): the switch, the connection (a model on this device, Apple Intelligence on Safari, or
// an endpoint), which of Glaze's
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
  // The connections Settings keeps, by their id in the broker's store (and storage.local ai.use); each is also its provider's
  // id but the endpoint's (openai).
  const ENDPOINT = 'endpoint', DEVICE = 'device', APPLE = 'apple';
  const PROVIDER = { [ENDPOINT]: 'openai', [DEVICE]: DEVICE, [APPLE]: APPLE };
  // A model request's failure categories (lib/ai/failure.js CATEGORIES).
  const CATEGORIES = ['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  // An address, a host or a reference kept in its own direction inside a sentence (right-to-left pages).
  const iso = (s) => `⁨${s}⁩`;

  const featureName = (id, t) => ({ syllabus: t('Syllabus import'), completion: t('Sentence completion'), writing: t('Writing feedback') }[id] || id);
  const providerName = (id, t) => ({ openai: t('Endpoint'), device: t('On this device'), apple: t('Apple Intelligence') }[id] || id);
  // A call's or a test's end, in a word or two: its state, else its failure category.
  const outcome = (code, t) => ({ completed: t('Done'), pending: t('Waiting for you'), running: t('Running'), cancelled: t('Cancelled'), timeout: t('Timed out'),
    'provider-unavailable': t('Unavailable'), 'request-rejected': t('Refused'), 'invalid-response': t('Unreadable answer'), 'connection-lost': t('Connection lost'),
    check: t('No usable answer'), refusal: t('No usable answer') }[code] || t('Not run'));
  // Why a Test didn't say ready (the broker's reason).
  const reason = (r, t) => (r === 'permission' ? t('Glaze isn’t allowed to reach this address.') : r === 'model' ? t('This endpoint doesn’t list that model.')
    : CATEGORIES.includes(r) ? outcome(r, t) : t('Not ready'));
  // The device provider's status: { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason?, progress? (0 to 1) }.
  const deviceText = (st, t, pct) => (st.state === 'ready' ? t('Ready') : st.reason === 'activation' ? t('Click Download to continue') : st.state === 'download' ? t('Needs a download')
    : st.state === 'downloading' ? (typeof st.progress === 'number' ? t('Downloading {pct}', { pct: pct(st.progress) }) : t('Downloading…'))
      : st.reason === 'browser' ? t('Not available in this browser') : st.reason === 'device' ? t('Not available on this device')
        : t('Not available: {reason}', { reason: reason(st.reason, t) }));
  // The Apple provider's status (lib/ai/providers/apple.js): { state, reason? }.
  const appleText = (st, t) => (st.state === 'ready' ? t('Ready') : st.reason === 'off' ? t('Apple Intelligence is off')
    : ['os', 'device'].includes(st.reason) ? t('Not available on this device') : st.state === 'downloading' ? t('Downloading…')
      : t('Not available: {reason}', { reason: reason(st.reason, t) }));
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
    ...(Number.isSafeInteger(r.count) && r.count > 0 && { count: r.count }),
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
    if (window.top !== window) return;
    const $ = (id) => document.getElementById(id);
    const c = globalThis.chrome, local = c.storage.local, S = A(), KEY = S.KEY;
    // Dispatch before yielding, so prepare still belongs to the Download click.
    const send = (m) => {
      try { return Promise.resolve(c.runtime.sendMessage({ type: TYPE, ...m })).then((r) => (isObj(r) ? r : { ok: false, error: 'failed' }), () => ({ ok: false, error: 'failed' })); }
      catch { return Promise.resolve({ ok: false, error: 'failed' }); }
    };
    let providers = [], preparing = false;
    let s = S.clean(), conns = {}, calls = [], tested = null, device = null, apple = null, catalog = null, unverified = false, shownKey = '', busy = false;

    // ---- the switches (storage.local ai) -------------------------------------------------------------------------------
    // Read again before each write, so a change elsewhere (another Settings tab) isn't written over; one at a time, so a
    // quick second change isn't written over by the first still saving. A Web Lock shares that turn across Settings tabs.
    // Each change takes its control's state when made.
    let writing = Promise.resolve();
    const write = (patch) => {
      const save = async () => {
        const cur = S.clean((await local.get(KEY))?.[KEY]);
        const saved = S.clean({ ...cur, ...patch(cur) });
        await local.set({ [KEY]: saved });
        s = saved;
        render();
        return true;
      };
      const next = writing.then(() => globalThis.navigator?.locks?.request ? navigator.locks.request('glaze:ai-settings', save) : save());
      writing = next.catch(() => { render(); say(t('Could not save. Try again.'), true); return false; });
      return writing;
    };
    const boxes = new Map();
    $('ai-feature-list').replaceChildren(...S.FEATURES.map((id) => {
      const label = document.createElement('label'), box = document.createElement('input'), name = document.createElement('span');
      label.className = 'check';
      Object.assign(box, { type: 'checkbox' });
      box.setAttribute('data-local', '');
      name.textContent = featureName(id, t);
      box.addEventListener('change', () => { const on = box.checked; return write((cur) => ({ features: { ...cur.features, [id]: on } })); });
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
      $('ai-device-download').hidden = device?.state !== 'download' && device?.reason !== 'activation';
      const bar = $('ai-device-progress');
      bar.hidden = !(device?.state === 'downloading' && typeof device.progress === 'number');
      if (!bar.hidden) bar.value = device.progress;
    };
    const renderApple = () => { $('ai-apple-state').textContent = apple ? appleText(apple, t) : ''; };
    const renderCalls = () => {
      const list = rows(calls);
      $('ai-calls').replaceChildren(...list.map((r) => {
        const li = document.createElement('li'), name = document.createElement('span'), what = document.createElement('span'), more = document.createElement('small');
        name.className = 'name';
        what.textContent = `${featureName(r.feature, t)} · ${providerName(r.provider, t)}`;
        more.textContent = [when(r.at), r.count > 1 ? `×${r.count}` : '', r.tokens ? t('{n} tokens', { n: r.tokens }) : '', outcome(r.category || r.state, t)].filter(Boolean).join(' · ');
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
      const dev = $('ai-use-device'), end = $('ai-use-endpoint'), app = $('ai-use-apple');
      const offered = providers.includes(DEVICE), endpoint = providers.includes('openai'), onMac = providers.includes(APPLE);
      dev.disabled = !offered;
      end.disabled = !endpoint;
      app.disabled = !onMac;
      $('ai-choice-device').hidden = !offered;
      $('ai-choice-endpoint').hidden = !endpoint;
      $('ai-choice-apple').hidden = !onMac;
      $('ai-device-off').hidden = true;
      dev.checked = s.use === DEVICE;
      end.checked = s.use === ENDPOINT;
      app.checked = s.use === APPLE;
      $('ai-device').hidden = !(offered && s.use === DEVICE);
      $('ai-apple').hidden = !(onMac && s.use === APPLE);
      $('ai-endpoint').hidden = !endpoint || s.use !== ENDPOINT;
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
      renderApple();
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
      providers = r.ok && Array.isArray(r.providers) ? r.providers.filter((id) => S.PROVIDERS.includes(id)) : [];
      fill();
      render();
      if (s.on && s.use === DEVICE && providers.includes(DEVICE)) await deviceStatus();
      if (s.on && s.use === APPLE && providers.includes(APPLE)) await appleStatus();
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
      // Once submitted, the credential belongs only to this request, including when the vault refuses the write.
      if (key !== undefined) { keyField.value = shownKey; keyField.type = shownKey ? 'text' : 'password'; }
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
    const deviceResult = (r) => {
      device = r.ok ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }) } : { state: 'unavailable', reason: r.error };
      renderDevice();
    };
    const deviceStatus = async () => {
      if (!providers.includes(DEVICE)) return;
      if (!conns[DEVICE]) {
        const r = await send({ op: 'set', id: DEVICE, cfg: { provider: DEVICE } });
        if (!r.ok) return deviceResult(r);
        conns[DEVICE] = { provider: DEVICE };
      }
      deviceResult(await send({ op: 'test', provider: DEVICE }));
    };
    // Apple Intelligence: its connection, kept the first time it is chosen, and its state (nothing to download from here).
    const appleStatus = async () => {
      if (!providers.includes(APPLE)) return;
      if (!conns[APPLE]) {
        const r = await send({ op: 'set', id: APPLE, cfg: { provider: APPLE, model: 'on-device' } });
        if (!r.ok) { apple = { state: 'unavailable', reason: r.error }; return renderApple(); }
        conns[APPLE] = { provider: APPLE, model: 'on-device' };
      }
      const r = await send({ op: 'test', id: APPLE });
      apple = r.ok ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }) } : { state: 'unavailable', reason: r.error };
      renderApple();
    };
    $('ai-device-download').addEventListener('click', (e) => {
      if (!e?.isTrusted || preparing || !providers.includes(DEVICE) || (device?.state !== 'download' && device?.reason !== 'activation')) return;
      preparing = true;
      device = { state: 'downloading' };
      renderDevice();
      send({ op: 'prepare', provider: DEVICE }).then(async (r) => {
        if (r.ok) deviceResult(r); else await deviceStatus();
      }).finally(() => { preparing = false; });
    });
    c.runtime.onMessage?.addListener((m, sender) => {
      if (sender?.id !== c.runtime.id || m?.type !== TYPE || m.event !== 'progress' || m.provider !== DEVICE || !providers.includes(DEVICE)) return;
      const n = progress(m);
      if (n === null) return;
      device = { state: 'downloading', progress: n };
      renderDevice();
      if (n >= 1 && !preparing) deviceStatus();
    });

    // ---- the student's changes -----------------------------------------------------------------------------------------
    $('ai-on').addEventListener('change', () => { const on = $('ai-on').checked; return write(() => ({ on })).then((saved) => {
      if (!saved) return;
      if (s.on && s.use === DEVICE) return deviceStatus();
      if (s.on && s.use === APPLE) return appleStatus();
    }); });
    for (const [id, use] of [['ai-use-device', DEVICE], ['ai-use-apple', APPLE], ['ai-use-endpoint', ENDPOINT]]) {
      $(id).addEventListener('change', () => {
        if (!$(id).checked || !providers.includes(PROVIDER[use])) return;
        write(() => ({ use }));
        if (use === DEVICE) deviceStatus();
        if (use === APPLE) appleStatus();
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
    });
    load();
  };

  return { ENDPOINT, DEVICE, APPLE, CATEGORIES, featureName, providerName, outcome, reason, deviceText, appleText, progress, rows, lastFailure, failureText, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_AIEDIT;
