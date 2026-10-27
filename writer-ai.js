// Glaze Writer's AI in its frame (writer.html, after writer.js): the gray text that finishes the sentence being typed
// (writer.complete), the AI chip in the bar with "Check with AI" (writer.review → GZ_WRITER_ISSUES 'ai') and, for an
// assignment, Feedback (writer.feedback; feedbackView(container) is what the paper's Feedback tab mounts, compose shows it
// over the chip), and the autocorrect's ambiguous calls (GZ_WRITER_PROOF.decide → writer.decide). Glaze never drafts: the
// gray text only finishes the current word and sentence, feedback is comments only (docs/ai-harness.md, Writer).
// Nothing is asked, and no port opened, unless the student turned AI and that feature on in Settings → AI; nothing at all
// in a test's box. Every run goes through the worker's 'glaze:ai' port, which judges this frame by the page it sits in.
// The rules the gray text follows (fits, nextWord, consume, pause) are plain functions, for node tests.
var GZ_WRITER_AI = globalThis.GZ_WRITER_AI || (() => {
  // ---- the gray text's rules -----------------------------------------------------------------------------------------
  // The same place lib/ai/tasks/writer-complete.js fits() takes: the caret right after a word, in a sentence of at least
  // three words, with only white space after it in its line.
  const WORD = /[\p{L}\p{N}\p{M}]/u;
  const TAIL = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*['’-]?$/u;
  const sentence = (before) => {
    const s = before.split('\n').pop();
    let at = 0;
    for (const m of s.matchAll(/[.!?…。！？]+["'”’)\]]*\s*/gu)) at = m.index + m[0].length;
    return s.slice(at);
  };
  const inQuote = (s) => {
    const q = s.replace(/(?<=[\p{L}\p{N}])['’](?=[\p{L}\p{N}])/gu, '');
    return [/["“”]/g, /['‘’]/g, /[«»]/g].some((re) => (q.match(re) || []).length % 2 === 1);
  };
  const fits = (before, after = '') => typeof before === 'string' && !inQuote(before) && TAIL.test(before) && !/^[^\S\n]*[^\s]/.test(after)
    && sentence(before).split(/\s+/).filter((w) => WORD.test(w)).length >= 3;
  // The next word of the gray text, with the space before it: what ⌥→ takes.
  const nextWord = (ghost) => /^\s*\S+/.exec(ghost)?.[0] || '';
  // What is left of the gray text once `typed` is typed at its place, or null when it isn't its start (quotes as the
  // editor's smart quotes write them count as the same).
  const fold = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const consume = (ghost, typed) => (typed && fold(ghost).startsWith(fold(typed)) ? ghost.slice(typed.length) || null : null);
  // The pause before it asks: about 500 ms, shorter as the student takes the gray text, longer as they pass it by.
  const PAUSE = { min: 250, max: 1000 };
  const pause = (score) => Math.round(Math.min(PAUSE.max, Math.max(PAUSE.min, 900 - 800 * score)));
  const learn = (score, took) => score * 0.8 + (took ? 0.2 : 0);
  // The connection's name on the chip.
  const providerName = (st, t) => (st?.provider === 'device' ? 'Gemini Nano' : st?.provider === 'apple' ? t('Apple Intelligence') : st?.to || t('Endpoint'));
  const api = { fits, sentence, nextWord, consume, pause, learn, providerName };

  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;
  const t = (k, v) => F.t(k, v);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const KEYS = mac ? '⌘⇧K' : 'Ctrl+Shift+K';

  // ---- the port ------------------------------------------------------------------------------------------------------
  let port = null, asked = 0, generation = 0;
  const waits = new Map(); // message id → its answer's handler
  const hangUp = () => {
    const p = port;
    port = null;
    for (const w of [...waits.values()]) w({ type: 'error', error: 'connection-lost' });
    waits.clear();
    try { p?.disconnect(); } catch { /* gone */ }
  };
  // → the answer that ends message m: a status, an end or an error; .id is its id.
  const ask = (m) => {
    const id = ++asked;
    return Object.assign(new Promise((resolve) => {
      waits.set(id, (a) => { if (['status', 'end', 'error'].includes(a?.type)) { waits.delete(id); resolve(a); } });
      try {
        if (!port) {
          const p = port = chrome.runtime.connect({ name: 'glaze:ai' });
          p.onMessage.addListener((a) => waits.get(a?.id)?.(a));
          p.onDisconnect.addListener(() => { if (port === p) hangUp(); });
        }
        port.postMessage({ id, ...m });
      } catch { waits.delete(id); resolve({ type: 'error', error: 'failed' }); }
    }), { id });
  };
  const cancel = (id) => { const w = waits.get(id); if (!w) return; w({ type: 'error', error: 'cancelled' }); try { port?.postMessage({ id, op: 'cancel' }); } catch { /* gone */ } };
  const run = (feature, task, input) => {
    if (!ok(feature)) return Object.assign(Promise.resolve({ type: 'error', error: 'off' }), { id: 0 });
    const gen = generation, r = ask({ op: 'run', feature, task, input });
    return Object.assign(r.then((a) => gen === generation && ok(feature) ? a : { type: 'error', error: 'changed' }), { id: r.id });
  };

  // ---- what may run --------------------------------------------------------------------------------------------------
  // status per feature: the broker's answer, or null when Settings → AI says no (then nothing is asked).
  const status = { completion: null, writing: null };
  const ok = (f) => !quiet() && status[f]?.allowed === true && status[f]?.ready === true;
  const quiet = () => F.kind() === 'test' || F.context()?.kind === 'test' || !F.editor();
  // What Settings → AI said at the last check (null until it answers), whether a check is under way, since when the worker
  // has refused this attempt for its kind, and the model's download (0 to 1, from the worker's progress, or null).
  let checked = 0, said = null, checking = false, attemptSince = 0, loaded = null, attemptTimer = 0;
  // Why Feedback can't ask now: '' when it can; 'checking' | 'ai-off' | 'off' (the feature) | 'setup' | 'permission' |
  // 'download' | 'downloading' | 'device' (the chosen on-device model can't run here) | 'unverified' (the worker didn't
  // answer for this page) | 'attempt' (an attempt the worker hasn't been told is an assignment: it goes once the page says
  // so, else after 10 s) | 'unavailable'.
  const why = () => {
    if (ok('writing')) return '';
    if (F.kind() === 'test' || F.context()?.kind === 'test') return 'attempt';
    if (quiet() || checking || !said) return 'checking';
    if (said.on !== true) return 'ai-off';
    if (said.features?.writing !== true) return 'off';
    if (typeof said.use !== 'string' || !said.use) return 'setup';
    const st = status.writing;
    if (!st) return 'unverified';
    if (!st.allowed) return st.why === 'attempt' ? (Date.now() - attemptSince < 10000 ? 'checking' : 'attempt') : st.why ? 'unavailable' : 'off';
    if (st.why === 'unavailable' && ['device', 'apple'].includes(st.provider)) return 'device';
    return ['setup', 'permission', 'download', 'downloading'].includes(st.why) ? st.why : 'unavailable';
  };
  const invalidate = () => {
    generation++;
    status.completion = status.writing = null;
    stopFlight();
    hangUp();
    if (view()) clear(view());
    fb.done?.();
    Object.assign(fb, { state: 'idle', criteria: [], place: null, done: null });
    reviewing = false;
    render();
  };
  const refresh = async () => {
    checking = true;
    invalidate(); // close admission before either asynchronous read can yield
    const gen = generation;
    checked = Date.now();
    let s = null;
    try { s = (await chrome.storage.local.get('ai'))?.ai; } catch { /* no storage */ }
    if (gen !== generation || quiet()) return;
    const want = (f) => s?.on === true && typeof s.use === 'string' && !!s.use && s.features?.[f] === true;
    const next = { completion: null, writing: null };
    for (const f of ['completion', 'writing']) {
      const st = want(f) ? await ask({ op: 'status', feature: f }) : null;
      if (gen !== generation || quiet()) return;
      next[f] = st?.type === 'status' ? st : null;
    }
    Object.assign(status, next);
    said = s && typeof s === 'object' ? s : {};
    checking = false;
    clearTimeout(attemptTimer);
    if (next.writing?.why === 'attempt') {
      attemptSince ||= Date.now();
      attemptTimer = setTimeout(paint, Math.max(0, attemptSince + 10000 - Date.now()) + 50);
    } else attemptSince = 0;
    if (next.writing?.why !== 'downloading') loaded = null;
    render();
  };
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.ai) refresh(); }); } catch { /* no storage */ }

  // ---- the editor --------------------------------------------------------------------------------------------------
  const { Plugin, PluginKey, TextSelection } = GZ_PM.state;
  const { Decoration, DecorationSet } = GZ_PM.view;
  const { Mapping } = GZ_PM.transform;
  const S = GZ_WRITER_SCHEMA;
  const view = () => F.editor()?.view || null;
  const KEY = new PluginKey('gz-writer-ai');
  // Mappings since a run began, so its offsets land where the words are now (review issues, feedback passages).
  const trackers = new Set();
  const track = () => { const m = new Mapping(); trackers.add(m); return { m, done: () => trackers.delete(m) }; };
  let score = 0.5, timer = 0, flight = 0, shown = 0;
  const stopFlight = () => { clearTimeout(timer); timer = 0; if (flight) { cancel(flight); flight = 0; } };
  const set = (v, g) => v.dispatch(v.state.tr.setMeta(KEY, g).setMeta('addToHistory', false));
  const clear = (v) => { if (KEY.getState(v.state)) set(v, null); };
  const dismissCompletion = () => {
    const v = view();
    if (!v || !KEY.getState(v.state)) return false;
    score = learn(score, false); set(v, null);
    return true;
  };
  // The gray text: its words, then the Tab keycap, faded in when it first shows and never while typing into it.
  const ghostDom = (g) => () => {
    const s = document.createElement('span');
    s.className = g.fresh ? 'gz-ghost gz-in' : 'gz-ghost';
    s.setAttribute('aria-hidden', 'true');
    const k = document.createElement('kbd');
    k.className = 'gz-k';
    k.textContent = 'Tab';
    s.append(g.text, k);
    return s;
  };
  const take = (v, g, text) => {
    const rest = g.text.slice(text.length);
    const tr = v.state.tr.insertText(text, g.pos);
    tr.setSelection(TextSelection.create(tr.doc, g.pos + text.length)).setMeta(KEY, rest ? { ...g, pos: g.pos + text.length, text: rest, fresh: false } : null);
    if (!rest) score = learn(score, true);
    v.dispatch(tr.scrollIntoView());
  };
  const plugin = new Plugin({
    key: KEY,
    state: {
      init: () => null,
      apply(tr, g, old, now) {
        const meta = tr.getMeta(KEY);
        if (meta !== undefined) return meta;
        if (!g) return null;
        if (tr.docChanged) {
          // Typed at its place, the same characters: what's left of it stays, a step on.
          const start = tr.mapping.map(g.pos, -1), end = tr.mapping.map(g.pos, 1);
          if (start === g.pos && end > start && now.doc.content.size - old.doc.content.size === end - start && now.selection.empty && now.selection.head === end) {
            const rest = consume(g.text, now.doc.textBetween(start, end));
            if (rest) return { ...g, pos: end, text: rest, fresh: false };
            if (fold(g.text) === fold(now.doc.textBetween(start, end))) { score = learn(score, true); return null; }
          }
          score = learn(score, false);
          return null;
        }
        if (!now.selection.eq(old.selection)) { score = learn(score, false); return null; }
        return g;
      },
    },
    appendTransaction(trs) { for (const m of trackers) for (const tr of trs) m.appendMapping(tr.mapping); return null; },
    props: {
      decorations(state) {
        const g = KEY.getState(state);
        return g ? DecorationSet.create(state.doc, [Decoration.widget(g.pos, ghostDom(g), { side: 1, ignoreSelection: true, key: `gz-ghost${g.id}:${g.fresh ? 1 : 0}:${g.text}` })]) : null;
      },
      handleKeyDown(v, e) {
        if ((mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
          if (!ok('writing')) return false;
          review();
          return true;
        }
        const g = KEY.getState(v.state);
        if (!g) return false;
        const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
        if (e.key === 'Tab' && plain) { take(v, g, g.text); return true; }
        if (e.key === 'ArrowRight' && !e.shiftKey && (mac ? e.altKey && !e.ctrlKey && !e.metaKey : e.ctrlKey && !e.altKey && !e.metaKey)) { take(v, g, nextWord(g.text)); return true; }
        if (e.key === 'Escape') return dismissCompletion();
        if (['Shift', 'Alt', 'Control', 'Meta', 'CapsLock', 'Fn', 'AltGraph'].includes(e.key) || (e.key.length === 1 && !e.ctrlKey && !e.metaKey)) return false;
        score = learn(score, false);
        set(v, null);
        return false;
      },
      handleDOMEvents: {
        compositionstart: (v) => { stopFlight(); clear(v); return false; },
        blur: (v) => { stopFlight(); clear(v); return false; },
      },
    },
    // A change to the text starts the pause again; any change at all ends the run in flight.
    view: () => ({
      update(v, prev) {
        if (v.state.doc === prev.doc && v.state.selection.eq(prev.selection)) return;
        stopFlight();
        if (v.state.doc !== prev.doc && !KEY.getState(v.state) && ok('completion')) timer = setTimeout(complete, pause(score));
      },
      destroy: stopFlight,
    }),
  });

  // ---- the gray text -------------------------------------------------------------------------------------------------
  const live = document.createElement('div');
  live.className = 'gz-sr';
  live.setAttribute('aria-live', 'polite');
  const say = (s) => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = s; }); };
  const complete = async () => {
    timer = 0;
    const v = view();
    if (!v || !ok('completion') || v.composing || !v.hasFocus() || KEY.getState(v.state)) return;
    const st = v.state, { selection } = st;
    if (!selection.empty || selection.$head.parent.type.spec.code) return;
    const tx = S.text(st.doc), off = tx.offsetAt(selection.head);
    const before = tx.text.slice(Math.max(0, off - 8000), off), after = tx.text.slice(off, off + 2000);
    if (!fits(before, after)) return;
    const r = run('completion', 'writer.complete', { before, after, mode: F.mode() === 'paper' ? 'paper' : 'compose', kind: F.kind(), context: F.context() });
    flight = r.id;
    const end = await r;
    if (flight !== r.id) return;
    flight = 0;
    if (end.type !== 'end' || typeof end.output !== 'string') { if (['attempt', 'feature', 'off', 'setup', 'permission'].includes(end.error)) refresh(); return; }
    const now = v.state;
    if (now.doc !== st.doc || !now.selection.eq(selection) || v.composing || !v.hasFocus()) return;
    set(v, { pos: selection.head, text: end.output, fresh: true, id: ++shown });
    say(t('Suggestion: {text}', { text: end.output.trim() }));
  };

  // ---- Check with AI -----------------------------------------------------------------------------------------------
  const KINDS = { spelling: 'spelling', grammar: 'grammar', punctuation: 'grammar', style: 'style', clarity: 'style' };
  let reviewing = false;
  // Offsets of a run's text (S.text of the doc it read) → positions now, or null when those words have changed since.
  const placer = (doc, m) => {
    const tx = S.text(doc);
    return (start, end, quote) => {
      const from = m.map(tx.posAt(start), 1), to = m.map(tx.posAt(end), -1), v = view();
      return v && to > from && v.state.doc.textBetween(from, to, '\n') === quote ? { from, to } : null;
    };
  };
  const review = async () => {
    const v = view();
    if (!v || !ok('writing') || reviewing) return;
    const doc = v.state.doc, text = S.text(doc).text;
    if (!text.trim()) return;
    const tr = track(), gen = generation;
    reviewing = true;
    render();
    const end = await run('writing', 'writer.review', { text, mode: F.mode() === 'paper' ? 'paper' : 'compose', kind: F.kind(), context: F.context() });
    if (gen !== generation) { tr.done(); return; }
    reviewing = false;
    render();
    try {
      if (end.type !== 'end' || !Array.isArray(end.output?.issues)) { say(t("AI couldn't check it.")); return; }
      const place = placer(doc, tr.m);
      const issues = end.output.issues.map((i, n) => { const at = place(i.start, i.end, i.quote); return at && { ...at, source: 'ai', kind: KINDS[i.kind] || 'style', message: i.message, suggestions: i.suggestions, sure: false, id: `ai-${n}-${at.from}` }; }).filter(Boolean);
      globalThis.GZ_WRITER_ISSUES?.set('ai', issues);
      say(issues.length ? t('AI found {n} issues.', { n: issues.length }) : t('AI found no issues.'));
    } finally { tr.done(); }
  };

  // ---- Feedback ----------------------------------------------------------------------------------------------------
  // One result for the frame, shown by every mounted view.
  const fb = { state: 'idle', criteria: [], place: null, done: null };
  const views = new Set();
  const assignment = () => { const a = F.context()?.assignment; return !!a && !!(a.instructions || a.rubric); };
  const feedback = async () => {
    const v = view();
    if (!v || !ok('writing') || fb.state === 'running' || !assignment()) return;
    const doc = v.state.doc, text = S.text(doc).text;
    if (!text.trim()) return;
    fb.done?.();
    const tr = track(), gen = generation;
    Object.assign(fb, { state: 'running', criteria: [], place: null, done: tr.done });
    paint();
    const end = await run('writing', 'writer.feedback', { text, mode: F.mode() === 'paper' ? 'paper' : 'compose', kind: F.kind(), context: F.context() });
    if (gen !== generation) { tr.done(); return; }
    if (end.type !== 'end' || !Array.isArray(end.output?.criteria)) { tr.done(); Object.assign(fb, { state: 'error', done: null }); paint(); return; }
    Object.assign(fb, { state: 'done', criteria: end.output.criteria, place: placer(doc, tr.m) });
    paint();
  };
  const STATUS = { met: ['Met', 'var(--gz-ok)'], partly: ['Partly met', 'var(--gz-warn)'], missing: ['Missing', 'var(--gz-err)'] };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const show = (q) => {
    const at = fb.place?.(q.start, q.end, q.quote), v = view();
    if (!at || !v) return false;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at.from, at.to)).scrollIntoView());
    v.focus();
    return true;
  };
  // Settings → AI, in a tab of its own; where this frame has no tabs API (Firefox), Settings as the worker opens it.
  const settings = () => {
    try {
      if (chrome.tabs?.create) chrome.tabs.create({ url: chrome.runtime.getURL('options.html#ai/setup') }).catch(() => {});
      else Promise.resolve(chrome.runtime.sendMessage('options')).catch(() => {});
    } catch { /* gone */ }
  };
  const draw = (box) => {
    box.textContent = '';
    box.setAttribute('aria-busy', String(fb.state === 'running'));
    const no = why();
    if (no) {
      const host = status.writing?.to || '';
      const say = {
        checking: () => t('Checking whether AI can run here…'),
        'ai-off': () => t('AI is off. Turn it on in Settings → AI.'),
        off: () => t('Writing feedback is off. Turn it on in Settings → AI.'),
        setup: () => t('No AI model is chosen. Choose one in Settings → AI.'),
        permission: () => (host ? t('Glaze needs permission to reach {host}. Allow it in Settings → AI.', { host }) : t('AI isn’t available right now.')),
        download: () => t('The on-device model isn’t downloaded. Download it in Settings → AI.'),
        downloading: () => (loaded === null ? t('Downloading the model…') : t('Downloading the model: {pct}', { pct: `${Math.round(loaded * 100)}%` })),
        device: () => t('{provider} is unavailable. Choose another model in Settings → AI.', { provider: providerName(status.writing, t) }),
        unverified: () => t('Glaze couldn’t confirm this page may use AI. Reload the page to try again.'),
        attempt: () => t('AI is only available on confirmed assignments, never on tests.'),
      }[no];
      box.append(el('p', 'gz-fb-note', say ? say() : t('AI isn’t available right now.')));
      if (['ai-off', 'off', 'setup', 'permission', 'download', 'device'].includes(no)) {
        const go = el('button', 'gz-fb-run', t('Settings'));
        go.type = 'button';
        go.addEventListener('click', settings);
        box.append(go);
      }
      return;
    }
    if (!assignment()) { box.append(el('p', 'gz-fb-note', t('No instructions or rubric to check against.'))); return; }
    const go = el('button', 'gz-fb-run', fb.state === 'running' ? t('Reading your draft…') : fb.state === 'done' ? t('Check again') : t('Get feedback'));
    go.type = 'button';
    go.disabled = fb.state === 'running';
    go.addEventListener('click', feedback);
    box.append(go);
    if (fb.state === 'error') box.append(el('p', 'gz-fb-note', t("AI couldn't give feedback.")));
    if (fb.state === 'done' && !fb.criteria.length) box.append(el('p', 'gz-fb-note', t('No criteria to check.')));
    for (const c of fb.state === 'done' ? fb.criteria : []) {
      const card = el('div', 'gz-fb-item'), lbl = el('div', 'gz-fb-lbl'), dot = el('span', 'gz-dot');
      const [word, colour] = STATUS[c.status] || STATUS.partly;
      dot.style.background = colour;
      lbl.append(dot, el('b', '', c.label), el('span', 'gz-fb-status', t(word)));
      card.append(lbl);
      if (c.comment) card.append(el('p', 'gz-fb-comment', c.comment));
      for (const q of c.quotes) {
        const b = el('button', 'gz-fb-quote', q.quote);
        b.type = 'button';
        b.addEventListener('click', () => { if (!show(q)) b.classList.add('gz-gone'); });
        card.append(b);
      }
      box.append(card);
    }
  };
  const paint = () => { for (const box of views) { const focused = box.contains(document.activeElement); draw(box); if (focused) box.focus({ preventScroll: true }); } };
  // The Feedback panel, in any container (the paper's side panel tab; compose's popover over the chip). → { destroy }.
  const feedbackView = (container) => {
    const box = el('div', 'gz-fb');
    box.tabIndex = -1;
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', t('Feedback'));
    box.setAttribute('aria-live', 'polite');
    container.append(box);
    views.add(box);
    draw(box);
    return { el: box, destroy: () => { views.delete(box); box.remove(); } };
  };

  // ---- the chip, its menu and the ⋯ entry --------------------------------------------------------------------------
  const chip = el('button', 'gz-ai-chip');
  chip.type = 'button';
  chip.setAttribute('aria-haspopup', 'menu');
  chip.setAttribute('aria-expanded', 'false');
  const dot = el('span', 'gz-dot'), name = el('span', 'gz-ai-name');
  chip.append(dot, name);
  const menu = el('div', 'pop menu gz-ai-menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const item = (cls, fn) => { const b = el('button', cls); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.addEventListener('click', () => { shut(); chip.focus(); fn(); }); menu.append(b); return b; };
  const checkItem = item('gz-ai-check', review), fbItem = item('gz-ai-fb', () => openFeedback());
  const pop = el('div', 'pop gz-ai-pop');
  pop.hidden = true;
  pop.tabIndex = -1;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', t('Feedback'));
  let moreItem = null, fbView = null;
  const label = (b, text, keys) => { b.textContent = text; if (keys) b.append(el('span', 'gz-keys', keys)); };
  // Shown by a fade and scale (writer.css .pop), hidden at once.
  const open = (p) => { p.hidden = false; p.getBoundingClientRect(); p.setAttribute('data-open', ''); };
  const shut = () => {
    for (const p of [menu, pop]) { p.hidden = true; p.removeAttribute('data-open'); }
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-haspopup', 'menu');
    fbView?.destroy();
    fbView = null;
  };
  const place = (p) => {
    const r = chip.getBoundingClientRect();
    p.style.left = `${Math.max(3, Math.min(r.left, innerWidth - p.offsetWidth - 3))}px`;
    p.style.bottom = `${innerHeight - r.top + 6}px`;
    p.style.maxHeight = `${Math.max(80, r.top - 9)}px`; // the frame is as tall as the box: above the chip, within it
  };
  const render = () => {
    const slot = F.slot('ai');
    const st = status.writing?.allowed ? status.writing : status.completion;
    const on = !quiet() && !!st?.allowed && (st.ready === true || ['download', 'downloading'].includes(st.why));
    if (moreItem) { moreItem.hidden = !ok('writing'); label(moreItem, t('Check with AI'), KEYS); }
    paint();
    if (!on) { chip.remove(); shut(); return; }
    name.textContent = providerName(st, t);
    chip.toggleAttribute('data-ready', ok('completion') || ok('writing'));
    chip.toggleAttribute('data-busy', reviewing || fb.state === 'running');
    chip.title = reviewing ? t('Checking…') : name.textContent;
    label(checkItem, t('Check with AI'), KEYS);
    label(fbItem, t('Feedback'));
    checkItem.hidden = !ok('writing');
    fbItem.hidden = !ok('writing') || !assignment();
    if (slot && chip.parentNode !== slot) slot.append(chip);
  };
  const openFeedback = () => {
    if (!assignment() || !ok('writing')) return;
    shut();
    fbView = feedbackView(pop);
    chip.setAttribute('aria-expanded', 'true');
    chip.setAttribute('aria-haspopup', 'dialog');
    open(pop);
    place(pop);
    pop.focus({ preventScroll: true });
    if (fb.state === 'idle') feedback();
  };
  chip.addEventListener('click', () => {
    if (!menu.hidden || !pop.hidden) { shut(); return; }
    if (Date.now() - checked > 30000) refresh();
    if (checkItem.hidden && fbItem.hidden) return;
    chip.setAttribute('aria-expanded', 'true');
    open(menu);
    place(menu);
    menu.querySelector('[role="menuitem"]:not([hidden])')?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('[role="menuitem"]:not([hidden])')], i = items.indexOf(document.activeElement);
    if (e.key === 'Tab') { shut(); chip.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); shut(); chip.focus(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
  });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); shut(); chip.focus(); } });
  document.addEventListener('pointerdown', (e) => { if ((!menu.hidden || !pop.hidden) && !menu.contains(e.target) && !pop.contains(e.target) && !chip.contains(e.target)) shut(); }, true);
  document.addEventListener('focusin', (e) => { if ((!menu.hidden || !pop.hidden) && !menu.contains(e.target) && !pop.contains(e.target) && e.target !== chip) shut(); });
  addEventListener('resize', () => { if (!menu.hidden) place(menu); if (!pop.hidden) place(pop); });

  // ---- the autocorrect's calls -------------------------------------------------------------------------------------
  // → { verdict: 'apply'|'suggest'|'keep', choice: index }, or null without an answer, in at most 5 s.
  // The index names the caller's candidate, even when the task deduplicates candidates; keep has choice -1.
  const decide = async ({ text, from, to, suggestions, context } = {}) => {
    if (!ok('writing') || typeof text !== 'string' || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > text.length
      || !Array.isArray(suggestions) || !suggestions.length) return null;
    let a = 0, b = text.length;
    for (const m of text.slice(0, from).matchAll(/[.!?…]["'”’)\]]*\s+|\n/gu)) a = m.index + m[0].length;
    const tail = /[.!?…]["'”’)\]]*(?=\s|$)|\n/u.exec(text.slice(to));
    if (tail) b = to + tail.index + (tail[0] === '\n' ? 0 : tail[0].length);
    a = Math.max(a, to - 900); b = Math.min(b, Math.max(to, a + 1000));
    const candidates = suggestions.slice(0, 5).map(String);
    const r = run('writing', 'writer.decide', { sentence: text.slice(a, b), from: from - a, to: to - a, suggestions: candidates,
      context: context && typeof context === 'object' ? context : F.context() });
    const late = setTimeout(() => cancel(r.id), 5000);
    const end = await r;
    clearTimeout(late);
    if (end.type !== 'end' || !end.output) return null;
    const { verdict, choice } = end.output;
    if (verdict === 'keep') return { verdict, choice: -1 };
    const index = candidates.indexOf(choice);
    return ['apply', 'suggest'].includes(verdict) && index >= 0 ? { verdict, choice: index } : null;
  };
  const hook = () => { try { if (globalThis.GZ_WRITER_PROOF && GZ_WRITER_PROOF.decide !== decide) GZ_WRITER_PROOF.decide = decide; } catch { /* not settable */ } };

  // ---- for the other streams: requirements read from a prompt, a page's citation details ------------------------------
  // → the task's output, or null when AI may not or didn't answer.
  const ask1 = async (task, input) => { if (!ok('writing')) return null; const end = await run('writing', task, input); return end.type === 'end' ? end.output ?? null : null; };
  const requirements = (prompt) => ask1('writer.requirements', { prompt });
  const cite = ({ text, url } = {}) => ask1('writer.cite', { text, ...(url && { url }) });

  F.on('ready', () => {
    if (F.kind() === 'test') return;
    document.body.append(menu, pop, live);
    F.plugin(plugin);
    moreItem = F.item(t('Check with AI'), review);
    moreItem.hidden = true;
    hook();
    refresh();
  });
  F.on('context', refresh);
  // The page's word that the worker now knows this attempt's kind: a frame that asked before then asks again.
  F.handle?.('ai', refresh);
  // The model's download, as the worker tells Settings: its progress here too, and a new check once it's in.
  try {
    chrome.runtime.onMessage?.addListener((m) => {
      if (m?.type !== 'glaze:ai-config' || m.event !== 'progress' || typeof m.loaded !== 'number' || status.writing?.why !== 'downloading') return;
      loaded = Math.min(1, Math.max(0, m.loaded));
      if (loaded >= 1) refresh(); else paint();
    });
  } catch { /* no runtime */ }
  return Object.assign(api, { feedbackView, feedback, review, decide, requirements, cite, allowed: ok, refresh, dismissCompletion });
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_AI;
