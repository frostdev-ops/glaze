// Ask Rime's dialog (docs/ai-harness.md "Ask Rime"), loaded on demand on Canvas and Blackboard Ultra: the command palette's
// "Ask Rime" opens it (open({ event })) while AI and Ask are on (storage.local ai, ai/settings.js) and no Ask Rime widget is
// shown on the page (core/page/widgets.js reveal). A dialog over the page (core/page/apps.css #gz-ask) holding Rime's chat
// (ai/page/ask-chat.js GZ_ASK_CHAT, the component the widget tile mounts too). It opens only for the student's own click or
// key (isTrusted). What it shows is part of the page while it is open, as anything on screen is; nothing is kept after it
// closes. Ask or AI turned off closes it. It fades in and out, and nothing moves with reduced motion or Glaze's Motion off.
// arrive() is the school page's look on load (content/content.js): a carried highlight, and the reminders and watches that
// fired, each a card on the page whose Ask Rime asks its words (run({ event, question, fired })), for the student's own click
// only. on(kind, handler) adds a kind of UI action a run sends (GZ_ASK_CHAT.on). Loaded on demand: a second injection keeps
// the first.
var GZ_ASK_UI = globalThis.GZ_ASK_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  // Run in a frame's next document before its bootstrap: keep nothing, so that document's content.js loads it again.
  if (!ctx) return undefined;
  // The chat, in first: loaded on demand beside this file.
  const ready = () => (globalThis.GZ_ASK_CHAT ? Promise.resolve(globalThis.GZ_ASK_CHAT) : ctx.need('ai/page/ask-chat.js', () => globalThis.GZ_ASK_CHAT).then(() => globalThis.GZ_ASK_CHAT));
  const C = () => globalThis.GZ_ASK_CHAT;
  const real = (e) => !!e?.isTrusted;

  // ---- the dialog --------------------------------------------------------------------------------------------------------
  const exits = new Set();
  let box = null, chat = null, opener = null, shutting = false, exitFrame = 0;
  const release = () => {
    if (exitFrame) { cancelAnimationFrame(exitFrame); exitFrame = 0; }
    for (const effect of exits) try { effect.cancel(); } catch { /* already gone */ }
    exits.clear();
  };
  // Closing: the run in flight cancelled at once, then the dialog fades out (none with reduced motion or Motion off) and goes.
  const shut = () => {
    const d = box;
    if (!d || shutting) return;
    chat?.cancel();
    if (C().still() || typeof d.animate !== 'function') return d.close();
    shutting = true;
    const done = () => { if (box === d) { shutting = false; d.close(); } };
    try {
      const effect = d.animate([{ opacity: 1 }, { opacity: 0, translate: '0 8px', scale: '0.98' }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
      exits.add(effect);
      effect.finished.then(done, done);
      try {
        const backdrop = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards', pseudoElement: '::backdrop' });
        exits.add(backdrop);
        backdrop.finished.catch(() => {});
      } catch { /* no backdrop animation here */ }
      const watch = () => {
        exitFrame = 0;
        if (box !== d) return;
        if (C().still()) return done();
        exitFrame = requestAnimationFrame(watch);
      };
      exitFrame = requestAnimationFrame(watch);
    } catch { done(); }
  };

  const open = async ({ event } = {}) => {
    if (box) return chat?.focus();
    if (!real(event)) return;
    const K = await ready().catch(() => null);
    if (!K || !await K.alive() || box) return;
    box = K.make('dialog', { id: 'gz-ask' });
    box.setAttribute('aria-labelledby', 'gz-ask-title');
    const d = box;
    chat = K.mount(box, { variant: 'dialog', onClose: shut, onShow: shut, onOff: () => d.close() });
    box.addEventListener('click', (e) => { if (e.target === box && real(e)) shut(); });
    box.addEventListener('cancel', (e) => { if (!C().still() && real(e)) { e.preventDefault(); shut(); } });
    box.addEventListener('close', () => {
      chat?.stop(); chat = null;
      shutting = false;
      release();
      box?.remove(); box = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    opener = K.focused();
    document.body.append(box);
    box.showModal();
    chat.focus();
  };

  // A question the student didn't type (a wake's or a monitor's), asked for their own click: the dialog opens and asks it.
  const run = async ({ event, question: q, fired } = {}) => {
    if (!real(event) || typeof q !== 'string' || !q.trim()) return;
    const K = await ready().catch(() => null);
    if (!K || q.length > K.LIMIT.question) return;
    await open({ event });
    if (!box || !chat || !K.activated()) return;
    void chat.ask({ question: q.trim(), ...(typeof fired === 'string' && { fired }) });
  };

  // ---- on a school page's load: a carried highlight, and what fired ------------------------------------------------------
  // The highlight an open carried here (a minute at most, this tab and exact address only), then each reminder or watch that
  // fired as a card on the page: what it was, the student's words, Ask Rime (their click asks it) and Dismiss. Nothing nags:
  // the cards sit in a corner of the page until the student acts or leaves it, and nothing is shown outside the browser.
  let tray = null;
  const firedCard = (K, f) => {
    const { t, make, icon } = K;
    const label = f.what === 'wake' ? t('Reminder') : t('Something you asked Rime to watch changed');
    const words = f.say.trim() || label;
    const go = make('button', { type: 'button', className: 'gz-ask-fired-go' }, make('span', { className: 'gz-ask-mark' }, icon('rime')), make('span', { textContent: t('Ask Rime') }));
    const no = make('button', { type: 'button', className: 'gz-ask-fired-no', title: t('Dismiss') }, icon('close'));
    no.setAttribute('aria-label', t('Dismiss'));
    const li = make('li', { className: 'gz-ask-fired-card' }, make('p', { className: 'gz-ask-fired-what', textContent: label }), f.say.trim() ? make('p', { className: 'gz-ask-fired-say', textContent: f.say, dir: 'auto' }) : null,
      make('div', { className: 'gz-ask-fired-acts' }, go, no));
    const gone = () => { li.remove(); if (tray && !tray.querySelector('li')) { tray.remove(); tray = null; } };
    go.addEventListener('click', (e) => { if (!real(e)) return; gone(); void run({ event: e, question: words, fired: f.id }); });
    no.addEventListener('click', (e) => { if (real(e)) gone(); });
    return li;
  };
  const arrive = async ({ fired = 0, carried = false } = {}) => {
    const K = await ready().catch(() => null);
    if (!K || !(await K.alive())) return;
    if (carried) {
      const c = await K.request({ op: 'carry' });
      if (!(await K.alive())) return;
      let first = null;
      for (const m of Array.isArray(c.marks) ? c.marks.slice(0, 5) : []) {
        const hit = K.mark(m.text, m.note);
        first ||= hit;
      }
      first?.scrollIntoView?.({ block: 'center', behavior: K.still() ? 'auto' : 'smooth' });
    }
    if (!(fired > 0) || !(await K.alive()) || (await K.read())?.wakes === false) return;
    const r = await K.request({ op: 'fired' });
    if (!(await K.alive()) || (await K.read())?.wakes === false) return;
    const list = r.type === 'end' && Array.isArray(r.fired) ? r.fired.filter((f) => f && typeof f.id === 'string' && typeof f.say === 'string') : [];
    if (!list.length) return;
    if (!tray?.isConnected) {
      tray = K.make('aside', { id: 'gz-ask-fired' }, K.make('ul', {}));
      tray.setAttribute('aria-label', K.t('Ask Rime'));
      document.body.append(tray);
    }
    tray.querySelector('ul').append(...list.slice(0, 20).map((f) => firedCard(K, f)));
  };

  // Ask, AI or Glaze turned off: the dialog and the fired cards go.
  const on = (ai) => !!ai && ai.on === true && ai.features?.ask === true;
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      const off = (area === 'local' && c.ai && !on(c.ai.newValue)) || (area === 'sync' && c.enabled?.newValue === false);
      if (off || (area === 'local' && c.ai?.newValue?.wakes === false)) { tray?.remove(); tray = null; }
      if (off) box?.close();
    });
  } catch { /* extension reloaded under the tab */ }

  return { open, run, arrive, on: (kind, handler) => ready().then((K) => K.on(kind, handler)), get STEPS() { return C()?.STEPS; }, get LOCALES() { return C()?.LOCALES; }, lang: () => C()?.lang() || 'en' };
})();
GZ_ASK_UI;
