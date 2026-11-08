// The setup wizard's AI step (settings/welcome.html #ai), mounted by settings/setup.js (GZ_SETUP_PARTS): AI stays off unless
// the student picks Rime (Glaze's own model, its download started from the pick), the browser's model (where its status
// says it can be had) or a named provider with their own key, as Settings → AI's Simple mode does (settings/editor-ai.js,
// whose helpers this reuses), then which features may ask. storage.local `ai` is written as Settings writes it (read
// again, cleaned, under its Web Lock), and only from a choice; the connections and keys go through the worker
// ('glaze:ai-config', background.js welcomeAi), a key coming back only masked. A provider's host is asked for from the
// Connect click, before anything is awaited. Rime's download runs in the worker's engine host, so it goes on when this page
// closes or navigates: the step reads its state again on each show and follows its progress events.
// Classic script; module.exports for node.
var GZ_SETUP_AI = globalThis.GZ_SETUP_AI || (() => {
  const A = () => (typeof GZ_AI_SETTINGS !== 'undefined' ? GZ_AI_SETTINGS : require('../ai/settings.js'));
  const X = () => (typeof GZ_AIEDIT !== 'undefined' ? GZ_AIEDIT : require('./editor-ai.js'));
  const OWN = 'local', DEVICE = 'device', KEYED = 'key';
  // The radio's choices, in order: off, Rime, the browser's model, a named provider's key.
  const CHOICES = ['off', OWN, DEVICE, KEYED];
  // The feature switches, Ask Rime first; Settings' names (editor-ai.js featureName).
  const FEATURES = ['ask', 'writing', 'completion', 'syllabus'];
  const NONE = Object.freeze({ use: null, model: '' });
  const named = (id) => typeof id === 'string' && Object.hasOwn(A().PRESETS, id);
  // The choice cleaned settings show: off unless on; else the model on this computer it runs, else a provider's key.
  const choiceOf = (s) => (!s?.on ? 'off' : [OWN, DEVICE].includes(s.model?.use) ? s.model.use : KEYED);
  const providerOf = (s) => (named(s?.model?.use) ? s.model.use : null);
  // What a choice writes over the stored settings: Off keeps the rest, as Settings' switch does; Rime or the browser's model
  // is the overall model; a key keeps a named provider's model already chosen, else none until one connects.
  const choose = (cur, choice) => (choice === 'off' ? { on: false } : choice === KEYED ? { on: true, ...(!named(cur.model.use) && { model: { ...NONE } }) }
    : { on: true, model: { use: choice, model: '' } });
  // A provider connected (ids: the models it lists): its model as Settings suggests for a first key (ai/settings.js
  // suggest), over whatever was the overall one; one of its own already chosen stays.
  const keyed = (cur, id, ids) => (cur.model.use === id && cur.model.model ? { on: true }
    : { on: true, ...(A().suggest({ ...cur, model: { ...NONE } }, id, ids) || { model: { use: id, model: '' } }) });
  const feature = (cur, f, on) => ({ features: { ...cur.features, [f]: on } });
  const pct = (x) => `${Math.round(x * 100)}%`;
  // A card's word: Rime's size until it is here, its progress while it comes; the browser's model's state.
  // Rime chosen but not coming (its page closed before the worker started it): Download, which its card starts.
  const ownText = (st, t, chosen = false) => (!st ? '' : st.state === 'download' && !st.reason && st.size ? [...(chosen ? [t('Download')] : []), X().gb(st.size, t)].join(' · ')
    : X().localText(st, t, pct));
  const deviceText = (st, t) => (!st ? '' : st.reason === 'activation' ? t('Needs a download') : X().deviceText(st, t, pct));
  // The browser's model is offered only where its status says it can be had.
  const offered = (st) => !!st && st.state !== 'unavailable';
  const label = (choice, t) => (choice === 'off' ? t('Off') : choice === KEYED ? t('Your key') : X().providerName(choice, t));
  // The done step's row: [label, value, raw (a provider's own name)].
  const summary = (s, t) => {
    const c = choiceOf(s), p = providerOf(s);
    return [[t('AI'), c === KEYED && p ? X().CARDS[p][0] : label(c, t), c === KEYED && !!p]];
  };
  return { OWN, DEVICE, KEYED, CHOICES, FEATURES, choiceOf, providerOf, choose, keyed, feature, ownText, deviceText, offered, label, summary };
})();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (globalThis.GZ_SETUP_PARTS ||= []).push({
  step: 'ai',
  mount: (api) => {
    const G = GZ_SETUP_AI, S = GZ_AI_SETTINGS, X = GZ_AIEDIT, c = chrome, store = c.storage.local, KEY = S.KEY;
    const { t, make, tick } = api, { OWN, DEVICE, KEYED } = G;
    const TYPE = 'glaze:ai-config';
    const NS = 'http://www.w3.org/2000/svg';
    // Dispatched before anything yields, so a prepare still belongs to the click that picked.
    const send = (m) => {
      try { return Promise.resolve(c.runtime.sendMessage({ type: TYPE, ...m })).then((r) => (r && typeof r === 'object' ? r : { ok: false, error: 'failed' }), () => ({ ok: false, error: 'failed' })); }
      catch { return Promise.resolve({ ok: false, error: 'failed' }); }
    };
    // s: storage.local ai, cleaned, a choice shown at once; conns: the worker's connections, keys masked; ours, device: Rime's
    // and the browser's model's status; want: the provider picked for a key; note: what went wrong with it.
    let s = S.clean(), conns = {}, providers = [], ours = null, device = null, want = null, replacing = false, note = null;
    // intent: Rime picked before its state was known; its download starts once it is.
    let busy = false, fetching = false, preparing = false, loaded = null, listed = false, intent = false;
    const tested = {};

    // ---- storage.local ai, as Settings writes it -----------------------------------------------------------------------
    let writing = Promise.resolve();
    const write = (patch) => {
      const save = async () => {
        const cur = S.clean((await store.get(KEY))?.[KEY]);
        const saved = S.clean({ ...cur, ...patch(cur) });
        await store.set({ [KEY]: saved });
        s = saved;
        render();
        return true;
      };
      const next = writing.then(() => (globalThis.navigator?.locks?.request ? navigator.locks.request('glaze:ai-settings', save) : save()));
      writing = next.catch(() => { api.failed(); return store.get(KEY).then((r) => { s = S.clean(r?.[KEY]); render(); return false; }, () => false); });
      return writing;
    };
    // Shown at once, then written over what is stored.
    const apply = (patch) => { s = S.clean({ ...s, ...patch(s) }); render(); return write(patch); };

    // ---- drawing helpers -----------------------------------------------------------------------------------------------
    const ICONS = {
      off: ['M12 3.5v7.5', 'M7.05 6.6a7.5 7.5 0 1 0 9.9 0'],
      [OWN]: ['M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z', 'M18.5 15.5v5M16 18h5'],
      [DEVICE]: ['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5'],
      [KEYED]: ['M8 20.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8z', 'M10.9 13.6 19.5 5M16.5 8l2.5 2.5M14.5 10l2 2'],
      check: ['M5 12.5l4.4 4.4L19 7.3'],
    };
    const icon = (name, cls = 'ic') => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', cls);
      svg.setAttribute('aria-hidden', 'true');
      for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
      return svg;
    };
    // A download's ring around a card's mark.
    const ring = () => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 44 44');
      svg.setAttribute('class', 'ring');
      svg.setAttribute('aria-hidden', 'true');
      for (const cls of ['track', 'arc']) {
        const o = document.createElementNS(NS, 'circle');
        for (const [k, v] of [['cx', 22], ['cy', 22], ['r', 20], ['pathLength', 100], ['class', cls]]) o.setAttribute(k, String(v));
        svg.append(o);
      }
      return svg;
    };
    const part = (tag, cls, ...kids) => make(tag, { className: cls }, ...kids);

    // ---- the picture: a page with its gray text finishing a sentence, and Ask Rime answering beside it ----------------
    const orb = part('i', 'orb');
    const art = part('div', 'art ai-art', part('div', 'v v-ai', part('div', 'win',
      part('i', 'bar', make('b'), make('b'), make('b')),
      part('i', 'paper', make('b'), make('b'), make('b'), part('b', 'line', part('s', 'typed'), part('s', 'gray'), part('s', 'tab')), make('b'), make('b'), make('b')),
      part('i', 'chat', part('b', 'q'), part('b', 'dots', make('s'), make('s'), make('s')), part('b', 'a', make('s'), make('s'), make('s'))),
      orb)));
    art.setAttribute('aria-hidden', 'true');

    // ---- the choices -----------------------------------------------------------------------------------------------------
    const choiceBox = part('div', 'ai-choices');
    choiceBox.setAttribute('role', 'radiogroup');
    choiceBox.setAttribute('aria-labelledby', 'ai-title');
    const cards = G.CHOICES.map((id, i) => {
      const b = make('button', { type: 'button', className: 'ai-choice' });
      b.setAttribute('role', 'radio');
      b.dataset.choice = id;
      b.style.setProperty('--i', String(i));
      const mark = part('span', 'ai-ic', icon(id), ring());
      mark.setAttribute('aria-hidden', 'true');
      const name = make('span', { className: 'name', textContent: G.label(id, t) });
      if (id === OWN) name.setAttribute('translate', 'no');
      const st = part('span', 'st');
      b.append(mark, name, st, tick());
      b.addEventListener('click', (e) => pick(id, e.isTrusted ? 'now' : null));
      return b;
    });
    choiceBox.append(...cards);
    // An arrow key chooses as a radio does; a download starts once the student stays on its card.
    let keyed = false;
    choiceBox.addEventListener('keydown', (e) => { keyed = e.isTrusted; }, true);
    api.arrows(choiceBox, cards, (j) => pick(G.CHOICES[j], keyed ? 'soon' : null));

    // ---- a provider's key ------------------------------------------------------------------------------------------------
    const ids = Object.keys(X.CARDS);
    const provBox = part('div', 'ai-provs');
    provBox.setAttribute('role', 'radiogroup');
    provBox.setAttribute('aria-label', t('Providers'));
    const chips = ids.map((id) => {
      const mk = make('span', { className: 'mk', textContent: X.CARDS[id][1] });
      mk.setAttribute('aria-hidden', 'true');
      const b = make('button', { type: 'button', className: 'ai-prov' }, mk, make('span', { textContent: X.CARDS[id][0] }));
      b.setAttribute('role', 'radio');
      b.setAttribute('translate', 'no');
      b.dataset.p = id;
      b.addEventListener('click', () => { provider(id); if (!connected(id)) input.focus(); });
      return b;
    });
    provBox.append(...chips);
    api.arrows(provBox, chips, (j) => provider(ids[j]));
    const lead = part('span', 'lead', icon(KEYED, 'globe'), icon('check', 'check'));
    lead.setAttribute('aria-hidden', 'true');
    const input = make('input', { type: 'password', id: 'ai-key', autocomplete: 'off', spellcheck: false, maxLength: 512 });
    input.setAttribute('aria-label', t('Key'));
    input.setAttribute('dir', 'ltr');
    input.setAttribute('translate', 'no');
    input.addEventListener('input', () => { if (note) { note = null; render(); } });
    const masked = make('span', { className: 'masked' });
    masked.setAttribute('dir', 'ltr');
    masked.setAttribute('translate', 'no');
    const get = make('a', { className: 'get', textContent: t('Get a key'), target: '_blank', rel: 'noopener noreferrer' });
    const go = make('button', { type: 'submit', className: 'primary' }, make('span', { className: 'label', textContent: t('Connect') }), part('span', 'spin'));
    go.querySelector('.spin').setAttribute('aria-hidden', 'true');
    const replace = make('button', { type: 'button', className: 'ghost', textContent: t('Replace key') });
    replace.addEventListener('click', () => { replacing = true; note = null; render(); input.focus(); });
    const form = make('form', { className: 'bar ai-bar', noValidate: true, autocomplete: 'off' }, lead, input, masked, get, go, replace);
    form.addEventListener('submit', (e) => { e.preventDefault(); connect(e, e.submitter || go); });
    const said = part('p', 'ai-note');
    said.setAttribute('role', 'alert');
    const keyBox = part('div', 'ai-key', provBox, form, said);

    // ---- the features ----------------------------------------------------------------------------------------------------
    const featBox = part('div', 'switches ai-feats');
    featBox.setAttribute('role', 'group');
    featBox.setAttribute('aria-label', t('Features'));
    const toggles = G.FEATURES.map((f) => {
      const b = make('button', { type: 'button', className: 'switch' }, make('span', { className: 'label', textContent: X.featureName(f, t) }), part('span', 'knob'));
      b.setAttribute('role', 'switch');
      b.dataset.feature = f;
      b.addEventListener('click', () => { const on = s.features[f] !== true; apply((cur) => G.feature(cur, f, on)); });
      return b;
    });
    featBox.append(...toggles);

    const side = part('div', 'ai-side', choiceBox, keyBox, featBox);
    const root = part('div', 'ai-step', art, side);
    api.$('#ai-body').replaceChildren(root);

    // ---- picking -----------------------------------------------------------------------------------------------------------
    let soon = 0;
    // how: 'now' (a click: its download starts), 'soon' (an arrow key: once the student stays a moment), null (no download).
    const pick = (id, how) => {
      const card = cards[G.CHOICES.indexOf(id)];
      if (card.getAttribute('aria-disabled') === 'true') return;
      clearTimeout(soon);
      const start = id === OWN ? fetchModel : id === DEVICE ? download : null;
      if (id === OWN && how && !ours) intent = true;
      if (start && how === 'now') start();
      else if (start && how === 'soon') soon = setTimeout(() => { if (G.choiceOf(s) === id) start(); }, 800);
      if (G.choiceOf(s) === id) return;
      apply((cur) => G.choose(cur, id));
      if (id === OWN || id === DEVICE) keep(id);
      // A key again: the provider already connected comes back with it.
      if (id === KEYED) { want ||= G.providerOf(s) || ids.find((p) => connected(p) && !bad(p)) || null; if (want && connected(want)) use(want); }
      api.said.textContent = G.label(id, t);
      if (id !== 'off' && api.shown() !== 'off') api.bloom(card);
    };
    // The connection a model on this computer runs under, kept as Settings keeps it.
    const keep = async (id) => { await loaded; if (!conns[id]) send({ op: 'set', id, cfg: { provider: id } }).then((r) => { if (r.ok) conns[id] = { provider: id }; }); };
    const connected = (id) => !!conns[id]?.key;
    const bad = (id) => !!tested[id] && tested[id].state !== 'ready' && tested[id].reason === 'request-rejected';
    const provider = (id) => {
      want = id;
      replacing = false;
      note = null;
      if (connected(id) && !bad(id)) use(id);
      render();
    };
    // A connected provider becomes the model: its catalog read, Settings' suggestion for it written.
    const use = async (id) => {
      const r = await send({ op: 'models', id });
      const list = r.ok && Array.isArray(r.models) ? r.models.map((m) => m?.id).filter((x) => typeof x === 'string') : [];
      if (G.choiceOf(s) !== KEYED || want !== id) return;
      await write((cur) => (cur.on ? G.keyed(cur, id, list) : {}));
    };
    const say = (text) => { note = text; render(); };
    const refusal = (r) => (r.reason === 'request-rejected' && [401, 403].includes(r.status) ? t('Key refused') : X.reason(r.reason || r.error, t));
    // Connect: the key kept for the provider, its host asked for from the click, then checked, then its model chosen.
    const connect = (e, from) => {
      if (!e?.isTrusted || busy || !want) return;
      const id = want, key = input.value.trim();
      if (!key) { say(t('Enter a key.')); input.focus(); return; }
      const base = S.PRESETS[id].base;
      const asked = Promise.resolve(GZ_SITE.reach(base, from)).then((ok) => ok === true, () => false);
      input.value = '';
      busy = true;
      note = null;
      render();
      (async () => {
        const r = await send({ op: 'set', id, cfg: { provider: 'openai', key } });
        if (!r.ok) return say(t('Could not save. Try again.'));
        await connections();
        if (!await asked) { tested[id] = { state: 'unavailable', reason: 'permission' }; return say(t('Glaze isn’t allowed to reach {host}.', { host: `⁨${new URL(base).host}⁩` })); }
        const test = await send({ op: 'test', id });
        tested[id] = test.ok ? test : { state: 'unavailable', reason: test.error };
        if (tested[id].state !== 'ready') return say(refusal(tested[id]));
        replacing = false;
        await use(id);
        if (api.shown() !== 'off') api.bloom(form);
      })().catch(() => say(t('Could not save. Try again.'))).finally(() => {
        busy = false;
        render();
        if (want === id && !connected(id)) input.focus();
      });
    };

    // ---- the worker's state --------------------------------------------------------------------------------------------
    const connections = async () => {
      const r = await send({ op: 'get' });
      conns = r.ok && r.connections && typeof r.connections === 'object' ? r.connections : {};
      providers = r.ok && Array.isArray(r.providers) ? r.providers : [];
      render();
    };
    let reading = 0, poll = 0;
    const ownResult = (r) => {
      ours = r.ok ? { state: r.state, ...['reason', 'size', 'progress'].reduce((o, k) => (r[k] === undefined ? o : { ...o, [k]: r[k] }), {}), ...(!r.size && ours?.size && { size: ours.size }) }
        : { state: 'unavailable', reason: r.error };
      clearTimeout(poll);
      poll = ours.state === 'downloading' && !fetching ? setTimeout(ownStatus, 5000) : 0;
      // No signed list has named a Rime model yet: asked for once, as Settings' Rime card asks (its 'list' event reads again).
      if (intent && ours.state === 'download' && G.choiceOf(s) === OWN) { intent = false; fetchModel(); }
      if (ours.reason === 'pending' && !listed) { listed = true; send({ op: 'updates', provider: OWN }); }
      render();
    };
    const ownStatus = async () => {
      if (!providers.includes(OWN)) { ours = { state: 'unavailable', reason: 'browser' }; render(); return; }
      const n = ++reading;
      if (fetching && ours?.state === 'downloading') return;
      const r = await send({ op: 'test', provider: OWN });
      if (n === reading) ownResult(r);
    };
    const deviceResult = (r) => {
      device = r.ok ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }) } : { state: 'unavailable', reason: r.error };
      render();
    };
    const deviceStatus = async () => { if (providers.includes(DEVICE)) deviceResult(await send({ op: 'test', provider: DEVICE })); };
    // Rime's download, from the pick (Settings' Download): it runs in the worker's engine host and outlives this page.
    const fetchModel = () => {
      if (fetching || ours?.state !== 'download') return;
      reading++;
      fetching = true;
      ours = { state: 'downloading', ...(ours.size && { size: ours.size }) };
      render();
      send({ op: 'prepare', provider: OWN }).then((r) => {
        fetching = false;
        if (!r.ok) return ownStatus();
        ownResult(r);
        if (r.state === 'ready' && api.shown() !== 'off') api.bloom(cards[1]);
      }, () => { fetching = false; });
    };
    const download = () => {
      if (preparing || (device?.state !== 'download' && device?.reason !== 'activation')) return;
      preparing = true;
      device = { state: 'downloading' };
      render();
      send({ op: 'prepare', provider: DEVICE }).then((r) => (r.ok ? deviceResult(r) : deviceStatus())).finally(() => { preparing = false; });
    };
    c.runtime.onMessage.addListener((m, sender) => {
      if (sender?.id !== c.runtime.id || m?.type !== TYPE || m.event !== 'progress') return;
      if (m.provider === OWN && m.part === 'list') { ownStatus(); return; }
      if (m.part !== undefined) return;
      const n = X.progress(m);
      if (n === null) return;
      if (m.provider === OWN && providers.includes(OWN)) {
        ours = { ...ours, state: 'downloading', progress: n };
        delete ours.reason;
        render();
        if (n >= 1 && !fetching) ownStatus();
      } else if (m.provider === DEVICE && providers.includes(DEVICE)) {
        device = { state: 'downloading', progress: n };
        render();
        if (n >= 1 && !preparing) deviceStatus();
      }
    });
    // Read when the step first shows, and Rime's again on each show: a download started earlier may have gone on.
    const load = async () => { await connections(); await Promise.all([ownStatus(), deviceStatus()]); };
    c.storage.onChanged.addListener((changes, area) => { if (area === 'local' && KEY in changes) { s = S.clean(changes[KEY].newValue); render(); } });
    store.get(KEY).then((r) => { s = S.clean(r?.[KEY]); render(); }, () => {});

    // ---- drawing -----------------------------------------------------------------------------------------------------------
    let orbShows = null;
    const render = () => {
      const choice = G.choiceOf(s), here = G.offered(device) || choice === DEVICE;
      root.dataset.on = String(s.on);
      root.dataset.choice = choice;
      if (orbShows !== choice) { orbShows = choice; orb.replaceChildren(icon(choice)); }
      cards.forEach((b) => {
        const id = b.dataset.choice, yes = id === choice;
        b.setAttribute('aria-checked', String(yes));
        b.tabIndex = yes ? 0 : -1;
        const st = id === OWN ? ours : id === DEVICE ? device : null;
        const text = id === OWN ? G.ownText(ours, t, yes && !fetching) : id === DEVICE ? G.deviceText(device, t) : id === KEYED && choice === KEYED && G.providerOf(s) ? X.CARDS[G.providerOf(s)][0] : '';
        b.querySelector('.st').textContent = text;
        const loading = st?.state === 'downloading';
        b.toggleAttribute('data-loading', loading);
        b.querySelector('.arc').setAttribute('stroke-dashoffset', String(100 - Math.round((typeof st?.progress === 'number' ? st.progress : 0) * 100)));
        b.toggleAttribute('data-ready', st?.state === 'ready');
        b.toggleAttribute('data-act', id === OWN && yes && ours?.state === 'download' && !ours.reason);
        if (id === OWN) b.setAttribute('aria-disabled', String(ours?.state === 'unavailable'));
        if (id === DEVICE) b.hidden = !here;
      });
      // The key: its provider, the field or the key kept (masked), and what went wrong.
      keyBox.hidden = choice !== KEYED;
      chips.forEach((b, i) => {
        const id = ids[i], yes = id === want;
        b.setAttribute('aria-checked', String(yes));
        b.tabIndex = yes || (!want && i === 0) ? 0 : -1;
        b.toggleAttribute('data-connected', connected(id) && !bad(id));
      });
      const kept = !!want && connected(want) && !bad(want) && !replacing;
      form.hidden = !want;
      form.dataset.state = kept ? 'done' : note ? 'bad' : '';
      input.hidden = kept;
      masked.hidden = !kept;
      masked.textContent = kept ? conns[want].key : '';
      get.hidden = kept;
      go.hidden = kept;
      replace.hidden = !kept;
      if (want) {
        input.placeholder = X.CARDS[want][2] || t('Key');
        get.href = S.PRESETS[want].keys;
      }
      go.toggleAttribute('data-busy', busy);
      go.setAttribute('aria-disabled', String(busy));
      input.readOnly = busy;
      said.hidden = !note;
      said.textContent = note || '';
      featBox.hidden = !s.on;
      toggles.forEach((b) => b.setAttribute('aria-checked', String(s.features[b.dataset.feature] === true)));
    };
    render();

    return {
      render,
      show: () => { if (!loaded) loaded = load(); else ownStatus(); },
      summary: () => G.summary(s, t),
    };
  },
});

if (typeof module !== 'undefined') module.exports = GZ_SETUP_AI;
