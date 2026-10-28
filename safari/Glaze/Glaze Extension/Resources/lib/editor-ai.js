// Settings → AI (docs/ai-harness.md): the switch, Simple or Advanced, the providers (a model on this device: Apple
// Intelligence where the Mac has it, else the browser's; the providers Glaze knows by name, each with only a key; in
// Advanced, endpoints the student adds), the overall model and each feature's own (provider, model and the effort a model
// takes), Advanced's tuning, and the record of recent calls. storage.local `ai` (lib/ai/settings.js) holds the switches and
// the models; the connections and keys stay in the worker (lib/ai/broker.js 'glaze:ai-config': get, set, remove, test,
// models, and the device provider's prepare), and a key comes back only masked. Connect, Save and Test ask the browser for
// exactly the address's host (lib/site.js reach) from their click, before anything is awaited. The record (storage.local
// aiCalls, lib/ai/failure.js) is metadata only and never leaves this device. Every word reaches the page as textContent.
// Extension options page only (mount); the pure helpers are for node tests.
var GZ_AIEDIT = globalThis.GZ_AIEDIT || (() => {
  const A = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('./ai/settings.js'));
  const E = () => (typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('./ai/endpoint.js'));
  const TYPE = 'glaze:ai-config', CALLS = 'aiCalls';
  // On this device (DEVICE) is the worker's to resolve: Apple Intelligence or the browser's model (lib/ai/broker.js onDevice).
  const DEVICE = 'device', APPLE = 'apple';
  // A model request's failure categories (lib/ai/failure.js CATEGORIES).
  const CATEGORIES = ['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'];
  // The providers' cards, in this order: the name, the mark, what a key starts with.
  const CARDS = { openai: ['OpenAI', 'O', 'sk-proj-…'], anthropic: ['Anthropic', 'A', 'sk-ant-…'], gemini: ['Google Gemini', 'G', 'AIza…'], openrouter: ['OpenRouter', 'OR', 'sk-or-…'],
    xai: ['xAI', 'x', 'xai-…'], mistral: ['Mistral', 'M', ''], groq: ['Groq', 'Gq', 'gsk_…'], deepseek: ['DeepSeek', 'DS', 'sk-…'] };
  // Advanced's quick fill for a server on this computer.
  const LOCAL = [['Ollama', 'http://localhost:11434/v1'], ['LM Studio', 'http://localhost:1234/v1']];
  // Tuning's stops (lib/ai/settings.js TUNE): a slider moves through these.
  const STOPS = { temperature: Array.from({ length: 21 }, (_, i) => i / 10), maxTokens: [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768],
    context: [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 1000000], timeoutMs: [2000, 4000, 8000, 15000, 30000, 60000, 120000, 300000], pause: Array.from({ length: 39 }, (_, i) => 100 + i * 50) };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  // An address, a host or a reference kept in its own direction inside a sentence (right-to-left pages).
  const iso = (s) => `⁨${s}⁩`;

  const featureName = (id, t) => ({ syllabus: t('Syllabus import'), completion: t('Tab completion'), writing: t('Feedback') }[id] || id);
  // A connection's name: a provider's, an endpoint's own (names: the kept connections), the model on this device's.
  const providerName = (id, t, names = {}) => (CARDS[id] ? CARDS[id][0] : id === DEVICE ? 'Gemini Nano' : id === APPLE ? t('Apple Intelligence')
    : typeof names[id]?.name === 'string' ? names[id].name : t('Endpoint'));
  const effortName = (e, t) => ({ none: t('Off'), minimal: t('Minimal'), low: t('Low'), medium: t('Medium'), high: t('High') }[e] || e);
  // A call's or a test's end, in a word or two: its state, else its failure category.
  const outcome = (code, t) => ({ completed: t('Done'), pending: t('Waiting for you'), running: t('Running'), cancelled: t('Cancelled'), timeout: t('Timed out'),
    'provider-unavailable': t('Unavailable'), 'request-rejected': t('Refused'), 'invalid-response': t('Unreadable answer'), 'connection-lost': t('Connection lost'),
    check: t('No usable answer'), refusal: t('No usable answer') }[code] || t('Not run'));
  // Why a Test didn't say ready (the broker's reason).
  const reason = (r, t) => (r === 'permission' ? t('Glaze isn’t allowed to reach this address.') : CATEGORIES.includes(r) ? outcome(r, t) : t('Not ready'));
  // The device provider's status: { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason?, progress? (0 to 1) }.
  const deviceText = (st, t, pct) => (st.state === 'ready' ? t('Ready') : st.reason === 'activation' ? t('Click Download to continue') : st.state === 'download' ? t('Needs a download')
    : st.state === 'downloading' ? (typeof st.progress === 'number' ? pct(st.progress) : t('Downloading…'))
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
    ...(typeof r.model === 'string' && r.model && { model: r.model.slice(0, 200) }),
    state: typeof r.state === 'string' ? r.state : '', ...(CATEGORIES.includes(r.category) && { category: r.category }),
    ...(Number.isInteger(r.status) && { status: r.status }), ...(typeof r.id === 'string' && { reference: r.id }),
    ...(isObj(r.usage) && { tokens: [r.usage.input, r.usage.output].filter(Number.isFinite).reduce((a, b) => a + b, 0) }),
    ...(Number.isSafeInteger(r.count) && r.count > 0 && { count: r.count }),
  })).sort((a, b) => b.at - a.at);
  const failed = (r) => !!r.category && r.category !== 'cancelled';
  // A connection whose newest run had its key refused (401, 403): its card and its features show it.
  const refused = (calls, id) => { const r = rows(calls).find((x) => x.provider === id && x.state !== 'running'); return !!r && r.category === 'request-rejected' && [401, 403].includes(r.status); };
  const hostOf = (base) => { try { return new URL(base).host; } catch { return ''; } };
  // A tuning value as its slider says it.
  const tuneText = (k, v, t) => (k === 'temperature' ? v.toFixed(1) : k === 'maxTokens' ? v.toLocaleString() : k === 'context' ? (v >= 1e6 ? `${v / 1e6}M` : `${Math.round(v / 1000)}K`)
    : k === 'timeoutMs' ? t('{n} s', { n: v / 1000 }) : t('{n} ms', { n: v }));

  // t: the editor's words; when(ms): a time; pct(0 to 1): a percentage.
  const mount = ({ t, when = (at) => new Date(at).toLocaleString(), pct = (x) => `${Math.round(x * 100)}%` }) => {
    if (window.top !== window) return;
    const $ = (id) => document.getElementById(id);
    const c = globalThis.chrome, local = c.storage.local, S = A(), KEY = S.KEY;
    const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const button = (cls, text, on) => { const b = el('button', cls, text); b.type = 'button'; if (on) b.addEventListener('click', on); return b; };
    // Dispatch before yielding, so prepare still belongs to the Download click.
    const send = (m) => {
      try { return Promise.resolve(c.runtime.sendMessage({ type: TYPE, ...m })).then((r) => (isObj(r) ? r : { ok: false, error: 'failed' }), () => ({ ok: false, error: 'failed' })); }
      catch { return Promise.resolve({ ok: false, error: 'failed' }); }
    };
    let providers = [], preparing = false, busy = false;
    // open: the card whose drawer shows ('new': an endpoint not yet saved); picking: the row whose picker shows ('model' or
    // a feature), on: the connection it lists, query: its search; catalogs: each connection's models from the worker;
    // tested: the last Connect or Test of each this session; said: the drawer's last word; unsaved: the last write failed;
    // drafts: an endpoint's fields as typed, kept across a redraw (never a key once submitted).
    let s = S.clean(), conns = {}, calls = [], device = null, open = null, picking = null, on = null, query = '', said = null, unsaved = false;
    const catalogs = {}, tested = {}, drafts = {};
    const offered = () => providers.includes(DEVICE) || providers.includes(APPLE);
    const deviceName = () => providerName(device?.provider === APPLE || (!device && providers.includes(APPLE)) ? APPLE : DEVICE, t);
    const kind = (id) => (id === DEVICE ? DEVICE : CARDS[id] ? 'preset' : 'custom');
    const connected = (id) => (id === DEVICE ? offered() : !!conns[id] && (kind(id) === 'custom' || !!conns[id].key));
    const bad = (id) => connected(id) && (tested[id] ? tested[id].state !== 'ready' && tested[id].reason === 'request-rejected' : refused(calls, id));
    const label = (id) => (id === DEVICE ? deviceName() : providerName(id, t, conns));

    // ---- the switches (storage.local ai) -------------------------------------------------------------------------------
    // Read again before each write, so a change elsewhere (another Settings tab) isn't written over; one at a time, so a
    // quick second change isn't written over by the first still saving. A Web Lock shares that turn across Settings tabs
    // and the worker's write-back of an older store (lib/ai/broker.js upgrade). Each change takes its control's state when made.
    let writing = Promise.resolve();
    const write = (patch) => {
      const save = async () => {
        const cur = S.clean((await local.get(KEY))?.[KEY]);
        const saved = S.clean({ ...cur, ...patch(cur) });
        await local.set({ [KEY]: saved });
        s = saved;
        unsaved = false;
        render();
        return true;
      };
      const next = writing.then(() => globalThis.navigator?.locks?.request ? navigator.locks.request('glaze:ai-settings', save) : save());
      writing = next.catch(() => { unsaved = true; render(); return false; });
      return writing;
    };
    // A row's model: 'model' (the overall one) or a feature's; sel null puts a feature back on the overall one.
    const choose = (row, sel) => write((cur) => (row === 'model' ? { model: sel } : { models: Object.fromEntries(Object.entries({ ...cur.models, [row]: sel }).filter(([, v]) => v)) }));
    const selOf = (row) => (row === 'model' ? s.model : s.models[row] || null);

    // ---- the providers -------------------------------------------------------------------------------------------------
    const mark = (id, cls = 'ai-mk') => {
      const m = el('span', cls);
      m.setAttribute('aria-hidden', 'true');
      m.setAttribute('data-p', kind(id) === 'custom' ? 'custom' : id);
      if (CARDS[id]) m.textContent = CARDS[id][1];
      return m;
    };
    const cards = $('ai-providers');
    const renderProviders = () => {
      const ids = [...(offered() ? [DEVICE] : []), ...Object.keys(CARDS), ...(s.mode === 'advanced' ? Object.keys(conns).filter((id) => kind(id) === 'custom') : [])];
      const list = ids.map((id) => {
        const b = button(`ai-prov${open === id ? ' sel' : ''}`, '', () => toggle(id));
        b.id = `ai-prov-${id}`;
        b.setAttribute('aria-expanded', String(open === id));
        b.setAttribute('aria-controls', 'ai-drawer');
        const name = el('b', '', label(id)), tail = el('span', 'st');
        b.append(mark(id), name, tail);
        const loading = id === DEVICE && device?.state === 'downloading' && typeof device.progress === 'number';
        if (loading) {
          tail.className = 'pct'; tail.textContent = pct(device.progress);
          const bar = el('span', 'bar'), fill = el('i');
          fill.style?.setProperty?.('inline-size', pct(device.progress));
          bar.append(fill); b.append(bar);
        } else if (bad(id)) { tail.className = 'st bad'; tail.textContent = t('Key refused'); }
        else if (id === DEVICE ? device?.state === 'ready' : connected(id) && (!tested[id] || tested[id].state === 'ready')) { tail.className = 'st ok'; tail.textContent = t('Connected'); }
        return b;
      });
      if (s.mode === 'advanced') {
        const add = button(`ai-prov add${open === 'new' ? ' sel' : ''}`, '', () => toggle('new'));
        add.id = 'ai-prov-new';
        add.setAttribute('aria-expanded', String(open === 'new'));
        add.setAttribute('aria-controls', 'ai-drawer');
        add.append(mark('new', 'ai-mk plus'), el('b', '', t('Endpoint')));
        list.push(add);
      }
      cards.replaceChildren(...list);
    };
    const toggle = (id) => {
      open = open === id ? null : id;
      said = null;
      if (open === DEVICE) deviceStatus();
      render();
      if (open) $('ai-drawer').querySelector?.('input, button.primary')?.focus();
    };
    const say = (text, err = false) => {
      said = { text, err };
      render();
      if (!document.activeElement || document.activeElement === document.body) $('ai-drawer').querySelector?.('input, button.primary')?.focus?.();
    };
    const keyLine = (id) => {
      const line = el('div', 'line'), input = el('input', `mono${bad(id) && said?.err !== false ? ' bad' : ''}`);
      Object.assign(input, { type: 'password', placeholder: CARDS[id][2], autocomplete: 'off', spellcheck: false, maxLength: 512, id: 'ai-key' });
      input.setAttribute('aria-label', t('Key'));
      input.setAttribute('dir', 'ltr');
      const get = el('a', '', t('Get a key'));
      Object.assign(get, { href: S.PRESETS[id].keys, target: '_blank', rel: 'noopener noreferrer' });
      get.append(el('span', 'arrow', ' ↗'));
      const go = button('primary', t('Connect'), (e) => connect(e, id, input, go));
      // Enter connects from its own key press: a click() the page makes is no student's.
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault?.(); connect(e, id, input, go); } });
      line.append(mark(id), input, get, go);
      return line;
    };
    const renderDrawer = () => {
      const box = $('ai-drawer'), id = open;
      $('ai-fold').classList.toggle('open', !!id);
      $('ai-fold').hidden = !id;
      if (!id) { box.replaceChildren(); return; }
      box.setAttribute('aria-label', id === 'new' ? t('Endpoint') : label(id));
      const parts = [];
      if (id === DEVICE) {
        const line = el('div', 'line'), state = el('span', 'note', device ? (device.provider === APPLE ? appleText(device, t) : deviceText(device, t, pct)) : '');
        state.setAttribute('role', 'status');
        line.append(mark(DEVICE), el('b', '', deviceName()), state);
        if (device?.provider !== APPLE && (device?.state === 'download' || device?.reason === 'activation')) line.append(button('primary', t('Download'), download));
        parts.push(line);
        if (device?.state === 'downloading' && typeof device.progress === 'number') {
          const bar = el('progress');
          Object.assign(bar, { max: 1, value: device.progress });
          bar.setAttribute('aria-label', deviceName());
          parts.push(bar);
        }
      } else if (kind(id) === 'preset') {
        if (connected(id) && !bad(id) && !said?.replace) {
          const line = el('div', 'line'), who = el('div', 'key');
          const masked = el('span', 'mono', conns[id].key);
          masked.setAttribute('dir', 'ltr');
          who.append(el('b', '', label(id)), masked);
          line.append(mark(id), who, button('', t('Replace key'), () => { said = { replace: true }; render(); $('ai-key').focus?.(); }), button('', t('Remove'), () => remove(id)));
          parts.push(line);
        } else parts.push(keyLine(id));
      } else parts.push(...endpoint(id));
      if (said?.text) { const p = el('p', said.err ? 'err-t' : 'ok-t', said.text); p.setAttribute('role', said.err ? 'alert' : 'status'); parts.push(p); }
      box.replaceChildren(...parts);
    };
    // An endpoint of the student's own (Advanced): its name, address and key, Ollama's and LM Studio's addresses a click away.
    const endpoint = (id) => {
      const kept = conns[id] || {}, grid = el('div', 'ep'), d = drafts[id] || {};
      const field = (name, input) => { const l = el('label', 'ep-f'); l.append(el('span', '', name), input); return l; };
      const name = el('input');
      Object.assign(name, { type: 'text', id: 'ai-ep-name', value: d.name ?? kept.name ?? '', maxLength: 40, autocomplete: 'off' });
      const base = el('input', 'mono');
      Object.assign(base, { type: 'url', id: 'ai-ep-base', value: d.base ?? kept.base ?? '', placeholder: 'https://api.example.com/v1', maxLength: 500, autocomplete: 'off', spellcheck: false });
      base.setAttribute('dir', 'ltr');
      const key = el('input', 'mono');
      Object.assign(key, { type: 'password', id: 'ai-ep-key', value: d.key ?? kept.key ?? '', maxLength: 512, autocomplete: 'off', spellcheck: false });
      key.setAttribute('dir', 'ltr');
      key.addEventListener('focus', () => { if (kept.key && key.value === kept.key) key.select?.(); });
      const quick = el('span', 'quick');
      const keep = () => { drafts[id] = { name: name.value, base: base.value, ...(key.value !== (kept.key || '') && { key: key.value }) }; };
      for (const input of [name, base, key]) input.addEventListener('input', keep);
      for (const [n, url] of LOCAL) quick.append(button('', n, () => { base.value = url; if (!name.value) name.value = n; keep(); }));
      const at = el('div', 'ep-base');
      at.append(base, quick);
      grid.append(field(t('Name'), name), field(t('Address'), at), field(t('Key'), key));
      const foot = el('div', 'foot'), count = catalogs[id]?.models?.length;
      if (count && id !== 'new') foot.append(el('span', 'ok-t', t('{n} models', { n: count })));
      foot.append(el('span', 'grow'));
      if (id !== 'new') foot.append(button('', t('Remove'), () => remove(id)));
      const run = (test) => (e) => saveEndpoint(e, id, { name, base, key }, test, e?.currentTarget);
      foot.append(button('', t('Test'), run(true)), button('primary', t('Save'), run(false)));
      // The label wraps the address and its quick fill: the address keeps its own name.
      base.setAttribute('aria-label', t('Address'));
      return [grid, foot];
    };
    const refusedText = (r) => (r.reason === 'request-rejected' && [401, 403].includes(r.status) ? `${t('Key refused')} · HTTP ${r.status}` : reason(r.reason || r.error, t));
    // Connect: the key kept for the provider, its host asked for from the click, then checked (Test).
    const connect = (e, id, input, from) => {
      if (!e?.isTrusted || busy) return;
      const key = input.value.trim();
      if (!key) { say(t('Enter a key.'), true); return $('ai-key').focus?.(); }
      const asked = Promise.resolve(GZ_SITE.reach(S.PRESETS[id].base, from)).then((ok) => ok === true, () => false);
      input.value = '';
      busy = true;
      (async () => {
        const r = await send({ op: 'set', id, cfg: { provider: 'openai', key } });
        if (!r.ok) return say(t('Could not save. Try again.'), true);
        await load();
        if (!await asked) { tested[id] = { state: 'unavailable', reason: 'permission' }; return say(t('Glaze isn’t allowed to reach {host}.', { host: iso(hostOf(S.PRESETS[id].base)) }), true); }
        await check(id);
      })().catch(() => say(t('Could not save. Try again.'), true)).finally(() => { busy = false; });
    };
    const check = async (id) => {
      const r = await send({ op: 'test', id });
      tested[id] = r.ok ? r : { state: 'unavailable', reason: r.error };
      delete catalogs[id];
      if (tested[id].state === 'ready') { said = null; await models(id); render(); return; }
      say(refusedText(tested[id]), true);
      render();
    };
    const saveEndpoint = (e, id, f, test, from) => {
      if (!e?.isTrusted || busy) return;
      let base;
      try { base = E().parse(f.base.value); } catch { say(t('Use an https address, or http on localhost or 127.0.0.1.'), true); return $('ai-ep-base').focus?.(); }
      const target = id === 'new' ? Array.from({ length: 99 }, (_, n) => `custom-${n + 1}`).find((x) => !conns[x]) : id;
      const kept = conns[id] || {}, key = f.key.value === kept.key ? undefined : f.key.value.trim();
      const name = f.name.value.trim() || hostOf(base);
      const asked = Promise.resolve(GZ_SITE.reach(base, from)).then((ok) => ok === true, () => false);
      // Once submitted, the credential belongs only to this request, including when the vault refuses the write.
      f.key.value = kept.key || '';
      if (drafts[id]) delete drafts[id].key;
      busy = true;
      (async () => {
        const r = await send({ op: 'set', id: target, cfg: { provider: 'openai', name: name.slice(0, 40), base, ...(key !== undefined && { key }) } });
        if (!r.ok) return say(r.error === 'write' ? t('Could not save. Try again.') : t('Use an https address, or http on localhost or 127.0.0.1.'), true);
        delete drafts[id];
        delete catalogs[target]; delete tested[target];
        open = target;
        await load();
        if (!await asked) { tested[target] = { state: 'unavailable', reason: 'permission' }; return say(t('Glaze isn’t allowed to reach {host}.', { host: iso(hostOf(base)) }), true); }
        if (test) return check(target);
        said = null;
        await models(target);
        render();
      })().catch(() => say(t('Could not save. Try again.'), true)).finally(() => { busy = false; });
    };
    // Remove: the connection goes, and so does every model chosen on it.
    const remove = async (id) => {
      const r = await send({ op: 'remove', id });
      if (!r.ok) return say(t('Could not save. Try again.'), true);
      delete catalogs[id]; delete tested[id];
      open = null;
      await write((cur) => ({ model: cur.model.use === id ? null : cur.model, models: Object.fromEntries(Object.entries(cur.models).filter(([, v]) => v.use !== id)) }));
      await load();
    };

    // ---- the models ----------------------------------------------------------------------------------------------------
    const models = async (id) => {
      if (id === DEVICE) { catalogs[id] = { models: [{ id: '', name: deviceName(), efforts: [] }] }; return catalogs[id]; }
      if (catalogs[id]?.models || catalogs[id]?.loading) return catalogs[id]?.loading || catalogs[id];
      const loading = send({ op: 'models', id }).then((r) => {
        // Save or Remove may have replaced this connection while its old catalog was still arriving.
        if (catalogs[id]?.loading !== loading) return catalogs[id];
        catalogs[id] = r.ok && Array.isArray(r.models) ? { models: r.models.filter((m) => typeof m?.id === 'string').map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : m.id, efforts: Array.isArray(m.efforts) ? m.efforts.filter((x) => S.EFFORTS.includes(x)) : [],
          ...(S.EFFORTS.includes(m.defaultEffort) && { defaultEffort: m.defaultEffort }) })) } : { models: [], error: r.error };
        render();
        return catalogs[id];
      });
      catalogs[id] = { loading };
      return loading;
    };
    const entry = (sel) => catalogs[sel.use]?.models?.find((m) => m.id === sel.model);
    // The efforts a chosen model takes, once its catalog is known: [] hides the slider.
    const efforts = (sel) => (sel?.use === DEVICE ? [] : entry(sel)?.efforts || []);
    const pickText = (sel) => (sel.use === DEVICE ? deviceName() : entry(sel)?.name || sel.model);
    const chev = () => { const v = el('span', 'chev'); v.setAttribute('aria-hidden', 'true'); return v; };
    // The mockup's order: the gray text, Feedback, then the rest.
    const ROWS = () => ['model', ...['completion', 'writing'].filter((f) => S.FEATURES.includes(f)), ...S.FEATURES.filter((f) => !['completion', 'writing'].includes(f))];
    const picker = (row) => {
      const pop = el('div', 'ai-picker'), side = el('div', 'side'), main = el('div', 'main');
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', row === 'model' ? t('Default') : featureName(row, t));
      const ids = [...(offered() ? [DEVICE] : []), ...Object.keys(CARDS).filter(connected), ...Object.keys(conns).filter((id) => kind(id) === 'custom')];
      if (!on || !ids.includes(on)) on = ids.includes(selOf(row)?.use) ? selOf(row).use : ids[0] || null;
      if (row !== 'model') {
        const same = button(`same${!selOf(row) ? ' on' : ''}`, t('Same as default'), () => { close(true); choose(row, null); });
        side.append(same);
      }
      for (const id of ids) {
        const b = button(id === on ? 'on' : '', '', () => { on = id; query = ''; render(); focusSearch(); });
        b.setAttribute('aria-pressed', String(id === on));
        b.append(mark(id), el('span', '', label(id)));
        side.append(b);
      }
      const search = el('input');
      Object.assign(search, { type: 'search', id: 'ai-pick-search', value: query, placeholder: t('Search models'), autocomplete: 'off', spellcheck: false });
      search.setAttribute('aria-label', t('Search models'));
      search.setAttribute('aria-controls', 'ai-pick-list');
      const list = el('ul');
      list.id = 'ai-pick-list';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', on ? label(on) : t('Model'));
      if (on && on !== DEVICE && !catalogs[on]) models(on);
      const cat = on === DEVICE ? { models: [{ id: '', name: deviceName(), efforts: [] }] } : on && catalogs[on]?.models ? catalogs[on] : null;
      const q = query.trim().toLowerCase(), cur = selOf(row);
      const shownModels = (cat?.models || []).filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 300);
      for (const m of shownModels) {
        const chosen = cur?.use === on && (on === DEVICE || cur.model === m.id);
        const li = el('li', chosen ? 'on' : '', '');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(chosen));
        li.id = `ai-opt-${shownModels.indexOf(m)}`;
        const name = el('span', 'grow', m.name);
        li.append(name);
        if (m.name !== m.id && on !== DEVICE) { const id = el('small', 'mono', m.id); id.setAttribute('dir', 'ltr'); li.append(id); }
        li.addEventListener('click', () => take(row, on, m));
        list.append(li);
      }
      if (cat && !shownModels.length) list.append(el('li', 'none', t('No models')));
      search.addEventListener('input', () => { query = search.value; render(); focusSearch(); });
      search.addEventListener('keydown', (e) => {
        const opts = shownModels;
        const at = Math.max(-1, opts.findIndex((m) => m.id === active));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = opts[Math.min(opts.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]?.id ?? null; render(); focusSearch(); }
        else if (e.key === 'Enter') { const m = opts[Math.max(0, at)]; if (m) { e.preventDefault(); take(row, on, m); } }
      });
      const ai = shownModels.findIndex((m) => m.id === active);
      if (ai >= 0) { search.setAttribute('aria-activedescendant', `ai-opt-${ai}`); list.children[ai]?.classList.toggle('active', true); }
      main.append(search, list);
      pop.append(side, main);
      pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
      return pop;
    };
    let active = null;
    const focusSearch = () => $('ai-pick-search')?.focus?.();
    const take = (row, id, m) => {
      const was = selOf(row), sel = { use: id, model: id === DEVICE ? '' : m.id, ...(was?.use === id && was.model === m.id && was.effort && { effort: was.effort }) };
      if (id === DEVICE) deviceStatus();
      close(true);
      choose(row, sel);
    };
    const close = (back) => { const row = picking; picking = null; active = null; query = ''; render(); if (back && row) $(`ai-pick-${row}`)?.focus?.(); };
    // Draw the value in effect without saving it: completion's task asks none, otherwise the catalog's default.
    // Where no catalog states a default, give Default its own stop rather than guessing a level.
    // Clicking an explicit choice again returns to that default.
    const slider = (row, sel, supported) => {
      const def = row === 'completion' ? (supported.includes('none') ? 'none' : undefined) : entry(sel)?.defaultEffort;
      const known = supported.includes(def), levels = known ? supported : ['default', ...supported];
      const value = supported.includes(sel.effort) ? sel.effort : known ? def : 'default';
      const box = el('div', 'ai-effort'), track = el('div', 'track'), fill = el('span', 'fill'), stops = el('div', 'stops');
      box.setAttribute('role', 'radiogroup');
      box.setAttribute('aria-label', `${t('Effort')}: ${row === 'model' ? t('Default') : featureName(row, t)}`);
      const i = levels.indexOf(value), n = levels.length;
      box.style?.setProperty?.('--n', String(n));
      box.style?.setProperty?.('--steps', String(Math.max(1, n - 1)));
      box.style?.setProperty?.('--i', String(i));
      track.append(fill, ...levels.map((_, k) => { const tick = el('span', 'tick'); tick.style?.setProperty?.('--k', String(k)); return tick; }), el('span', 'thumb'));
      track.setAttribute('aria-hidden', 'true');
      const set = (effort) => write((cur) => {
        const now = row === 'model' ? cur.model : cur.models[row];
        if (!now || now.use !== sel.use || now.model !== sel.model) return {};
        const { effort: _, ...rest } = now, next = effort ? { ...rest, effort } : rest;
        return row === 'model' ? { model: next } : { models: { ...cur.models, [row]: next } };
      }).then(() => $(`ai-effort-${row}-${effort || (known ? def : 'default')}`)?.focus?.());
      levels.forEach((lv, k) => {
        const b = button(k === i ? 'on' : '', lv === 'default' ? t('Default') : effortName(lv, t), () => set(lv === 'default' || lv === sel.effort ? null : lv));
        b.id = `ai-effort-${row}-${lv}`;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(k === i));
        b.tabIndex = k === Math.max(0, i) ? 0 : -1;
        b.style?.setProperty?.('--k', String(k));
        b.addEventListener('keydown', (e) => {
          const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const next = levels[Math.min(n - 1, Math.max(0, i + step))];
          set(next === 'default' ? null : next);
        });
        stops.append(b);
      });
      box.append(track, stops);
      return box;
    };
    // Advanced's tuning of a feature: each a slider through its stops, at the task's own until moved; Reset gives them back.
    const tuning = (row) => {
      const box = el('div', 'ai-tune'), grid = el('div', 'g'), mine = s.tune[row] || {};
      for (const k of Object.keys(STOPS).filter((x) => x !== 'pause' || row === 'completion')) {
        const stops = STOPS[k], f = el('label', 'field'), range = el('input'), out = el('output', '', '');
        const name = { temperature: t('Temperature'), maxTokens: t('Max output'), context: t('Context'), timeoutMs: t('Timeout'), pause: t('Pause') }[k];
        const at = mine[k] === undefined ? -1 : stops.reduce((b, v, j) => (Math.abs(v - mine[k]) < Math.abs(stops[b] - mine[k]) ? j : b), 0);
        Object.assign(range, { type: 'range', min: 0, max: stops.length - 1, step: 1, value: Math.max(0, at), id: `ai-tune-${row}-${k}` });
        range.classList.toggle('unset', at < 0);
        out.textContent = at < 0 ? t('Default') : tuneText(k, stops[at], t);
        range.setAttribute('aria-valuetext', out.textContent);
        range.addEventListener('input', () => { range.classList.toggle('unset', false); out.textContent = tuneText(k, stops[range.value], t); range.setAttribute('aria-valuetext', out.textContent); });
        range.addEventListener('change', () => { const v = stops[Number(range.value)]; write((cur) => ({ tune: { ...cur.tune, [row]: { ...cur.tune[row], [k]: v } } })); });
        f.append(el('span', '', name), range, out);
        grid.append(f);
      }
      const reset = button('', t('Reset'), () => write((cur) => { const { [row]: _, ...rest } = cur.tune; return { tune: rest }; }));
      reset.disabled = !Object.keys(mine).length;
      grid.append(reset);
      box.append(grid);
      return box;
    };
    const renderFeatures = () => {
      const any = offered() || Object.keys(conns).some(connected);
      $('ai-feature-list').replaceChildren(...ROWS().map((row) => {
        const sel = selOf(row), wrap = el('div', `ai-feat${row !== 'model' && s.features[row] !== true ? ' off' : ''}`), line = el('div', 'row');
        const name = el('label', 'name');
        if (row === 'model') name.append(el('span', '', t('Default')));
        else {
          const box = el('input');
          Object.assign(box, { type: 'checkbox', id: `ai-feature-${row}`, checked: s.features[row] === true });
          box.setAttribute('data-local', '');
          box.addEventListener('change', () => { const v = box.checked; write((cur) => ({ features: { ...cur.features, [row]: v } })); });
          name.append(box, el('span', '', featureName(row, t)));
        }
        const wrapPick = el('div', 'popwrap'), pick = button('ai-pick', '', () => { picking = picking === row ? null : row; on = null; query = ''; active = null; render(); if (picking) focusSearch(); });
        pick.id = `ai-pick-${row}`;
        pick.setAttribute('aria-haspopup', 'dialog');
        pick.setAttribute('aria-expanded', String(picking === row));
        pick.disabled = !any;
        if (!sel && row !== 'model') { pick.classList.toggle('same', true); pick.append(el('span', 'm', t('Same as default'))); }
        else if (!sel?.use || (!sel.model && sel.use !== DEVICE)) { pick.classList.toggle('none', true); pick.append(el('span', 'm', t('Choose a model'))); }
        else {
          const m = el('span', 'm', pickText(sel));
          if (sel.use !== DEVICE) m.append(el('span', 'p', ` · ${label(sel.use)}`));
          pick.append(mark(sel.use, 'ai-mk sm'), m);
          if (bad(sel.use)) { const dot = el('span', 'dot'); dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', t('Key refused')); pick.append(dot); }
        }
        pick.classList.toggle('open', picking === row);
        pick.append(chev());
        wrapPick.append(pick);
        if (picking === row) wrapPick.append(picker(row));
        const levels = sel?.use ? efforts(sel) : [];
        if (sel?.use && sel.use !== DEVICE && !catalogs[sel.use]) models(sel.use);
        line.append(name, wrapPick, levels.length ? slider(row, sel, levels) : el('span', 'ai-effort-none'));
        wrap.append(line);
        if (s.mode === 'advanced' && row !== 'model') wrap.append(tuning(row));
        return wrap;
      }));
    };
    const renderCalls = () => {
      const list = rows(calls);
      $('ai-calls').replaceChildren(...list.map((r) => {
        const li = el('li'), what = el('span', '', [featureName(r.feature, t), providerName(r.provider === 'openai' && !r.model ? '' : r.provider, t, conns), r.model].filter(Boolean).join(' · '));
        const more = el('small', failed(r) ? 'bad' : '', [when(r.at), r.count > 1 ? `×${r.count}` : '', r.tokens ? t('{n} tokens', { n: r.tokens }) : '',
          `${outcome(r.category || r.state, t)}${r.status ? ` (HTTP ${r.status})` : ''}`].filter(Boolean).join(' · '));
        li.append(what, more);
        return li;
      }));
      $('ai-calls-empty').hidden = list.length > 0;
      $('ai-calls-clear').disabled = !list.length;
    };
    const render = () => {
      $('ai-on').checked = s.on;
      $('ai-said').hidden = !unsaved;
      $('ai-said').textContent = unsaved ? t('Could not save. Try again.') : '';
      $('ai-mode').hidden = !s.on;
      $('ai-mode-simple').checked = s.mode !== 'advanced';
      $('ai-mode-advanced').checked = s.mode === 'advanced';
      $('ai-connection').hidden = !s.on;
      $('ai-features').hidden = !s.on;
      $('ai-activity').hidden = !s.on && !rows(calls).length;
      if (open && open !== DEVICE && open !== 'new' && kind(open) === 'custom' && s.mode !== 'advanced') open = null;
      if (open === 'new' && s.mode !== 'advanced') open = null;
      const marks = [DEVICE, ...Object.keys(CARDS), ...Object.keys(conns)].map((id) => [id, connected(id), bad(id), tested[id]?.state]);
      const lists = Object.fromEntries(Object.entries(catalogs).map(([id, x]) => [id, x.models ? x.models.length : 'loading']));
      once('providers', [s.mode, open, providers, conns, device, marks], renderProviders);
      once('drawer', [s.mode, open, said, conns[open], open === DEVICE ? device : null, lists[open], marks.find(([id]) => id === open)], renderDrawer);
      once('features', [s, conns, providers, device, picking, on, query, active, marks, lists], renderFeatures);
      renderCalls();
    };
    // A part is drawn again only when what it shows changed: a key being typed, or a search, keeps its words and the focus
    // when an unrelated change comes in (a call recorded in another tab). One drawn again gives the focus back to the control
    // that had it.
    const drawn = {};
    const once = (part, state, draw) => {
      const sig = JSON.stringify(state);
      if (drawn[part] === sig) return;
      drawn[part] = sig;
      const had = document.activeElement?.id;
      draw();
      if (had && document.activeElement !== $(had)) $(had)?.focus?.();
    };

    // ---- the worker's connections ----------------------------------------------------------------------------------------
    const load = async () => {
      const r = await send({ op: 'get' });
      conns = r.ok && isObj(r.connections) ? r.connections : {};
      providers = r.ok && Array.isArray(r.providers) ? r.providers.filter((id) => S.PROVIDERS.includes(id)) : [];
      render();
      if (s.on && [s.model, ...Object.values(s.models)].some((x) => x?.use === DEVICE) && offered()) await deviceStatus();
    };
    // On this device: its status and the model the worker resolved it to, a download the student starts (the browser's
    // model only; Apple Intelligence downloads in System Settings), and its progress as the worker reports it.
    const deviceResult = (r) => {
      device = r.ok ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }), provider: r.provider === APPLE ? APPLE : DEVICE }
        : { state: 'unavailable', reason: r.error, provider: device?.provider || DEVICE };
      render();
    };
    const deviceStatus = async () => {
      if (!offered()) return;
      if (!conns[DEVICE] && providers.includes(DEVICE)) {
        const r = await send({ op: 'set', id: DEVICE, cfg: { provider: DEVICE } });
        if (!r.ok) return deviceResult(r);
        conns[DEVICE] = { provider: DEVICE };
      }
      deviceResult(await send({ op: 'test', id: DEVICE }));
    };
    const download = (e) => {
      if (!e?.isTrusted || preparing || !providers.includes(DEVICE) || device?.provider === APPLE || (device?.state !== 'download' && device?.reason !== 'activation')) return;
      preparing = true;
      device = { state: 'downloading', provider: DEVICE };
      render();
      send({ op: 'prepare', provider: DEVICE }).then(async (r) => {
        if (r.ok) deviceResult(r); else await deviceStatus();
      }).finally(() => { preparing = false; });
    };
    c.runtime.onMessage?.addListener((m, sender) => {
      if (sender?.id !== c.runtime.id || m?.type !== TYPE || m.event !== 'progress' || m.provider !== DEVICE || !providers.includes(DEVICE)) return;
      const n = progress(m);
      if (n === null) return;
      device = { state: 'downloading', progress: n, provider: DEVICE };
      render();
      if (n >= 1 && !preparing) deviceStatus();
    });

    // ---- the student's changes -----------------------------------------------------------------------------------------
    $('ai-on').addEventListener('change', () => { const v = $('ai-on').checked; return write(() => ({ on: v })).then((saved) => {
      if (saved && s.on && [s.model, ...Object.values(s.models)].some((x) => x?.use === DEVICE)) return deviceStatus();
    }); });
    for (const mode of ['simple', 'advanced']) $(`ai-mode-${mode}`).addEventListener('change', () => { if ($(`ai-mode-${mode}`).checked) write(() => ({ mode })); });
    $('ai-calls-clear').addEventListener('click', (e) => {
      if (!e?.isTrusted) return;
      calls = [];
      render();
      local.remove(CALLS);
    });
    // A picker closes on a click outside it.
    document.addEventListener?.('pointerdown', (e) => { if (picking && !e.target?.closest?.('.popwrap')) close(false); });
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

  return { DEVICE, APPLE, CATEGORIES, CARDS, LOCAL, STOPS, featureName, providerName, effortName, outcome, reason, deviceText, appleText, progress, rows, refused, tuneText, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_AIEDIT;
