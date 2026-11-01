// Ask Glaze's panel (docs/ai-harness.md "Ask Glaze"), loaded on demand on Canvas and Blackboard Ultra: the command palette's
// "Ask Glaze" opens it (open({ event })) while AI and Ask are on (storage.local ai, ai/settings.js). A dialog over the page,
// as Notes and Insights are (core/page/apps.css #gz-ask). The worker (ai/ask.js, port 'glaze:ask') answers with study help
// or from the student's own records, and Glaze's approval window asks before any change. It opens and asks only for the
// student's own click or key (isTrusted; sending also needs the user activation a real click or key gives). What it shows
// is part of the page while it is open, as anything on screen is; nothing is kept, and the conversation goes with the page.
// Ask or AI turned off closes it. Loaded on demand: a second injection keeps the first.
var GZ_ASK_UI = globalThis.GZ_ASK_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  // Run in a frame's next document before its bootstrap: keep nothing, so that document's content.js loads it again.
  if (!ctx) return undefined;
  const t = (k, v) => ctx.t(k, v);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false && k !== '')); return e; };
  const LOCALES = ['en', 'pt-BR', 'es', 'fr', 'de', 'nl'];
  const LIMIT = { question: 2000, attempt: 12000 };
  // The page's language, as the tasks take it (ai/tasks/study-help.js LOCALES): pt-PT reads Brazilian Portuguese, others English.
  const lang = () => { const tag = String(ctx.locale() || 'en'); return LOCALES.find((c) => c === tag) || LOCALES.find((c) => c.split('-')[0] === tag.split('-')[0]) || 'en'; };
  const on = (ai) => !!ai && ai.on === true && ai.features?.ask === true;
  const read = () => new Promise((res) => { try { chrome.storage.local.get('ai', (r) => res(chrome.runtime.lastError ? null : r?.ai)); } catch { res(null); } });
  const alive = async () => ctx.on() && ctx.settings().enabled !== false && on(await read());
  const real = (e) => !!e?.isTrusted;
  const activated = () => navigator.userActivation?.isActive ?? true;
  const focused = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
  // What each code the worker gives says (off and feature close the panel instead), each through t() as written.
  const said = (code) => {
    if (code === 'setup') return t('Choose a model for Ask Glaze in Settings → AI.');
    if (code === 'permission') return t('Glaze can’t reach your AI provider. Check Settings → AI.');
    if (['busy', 'often'].includes(code)) return t('One question at a time. Try again in a moment.');
    if (['download', 'downloading', 'unavailable', 'provider-unavailable'].includes(code)) return t('The AI model isn’t ready. Check Settings → AI.');
    if (['check', 'refusal', 'steps', 'invalid-response'].includes(code)) return t('Glaze couldn’t answer that. Try asking another way.');
    if (code === 'size') return t('That question is too long.');
    return t('Something went wrong. Try again.');
  };

  // ---- the port ---------------------------------------------------------------------------------------------------------
  let port = null, seq = 0;
  const waits = new Map(); // message id → its answer's handler
  const hangUp = () => {
    const p = port;
    port = null;
    for (const w of waits.values()) w({ type: 'error', error: 'connection-lost' });
    waits.clear();
    try { p?.disconnect(); } catch { /* gone */ }
  };
  // → the message that ends m (status, end or error); events before it go to each. Safari may retire an idle worker without
  // a disconnect: with nothing pending, a fresh port.
  const send = (m, each) => {
    const id = ++seq;
    if (!waits.size) hangUp();
    return Object.assign(new Promise((resolve) => {
      waits.set(id, (a) => { if (['status', 'end', 'error'].includes(a?.type)) { waits.delete(id); resolve(a); } else each?.(a); });
      try {
        if (!port) {
          const p = port = chrome.runtime.connect({ name: 'glaze:ask' });
          p.onMessage.addListener((a) => waits.get(a?.id)?.(a));
          p.onDisconnect.addListener(() => { if (port === p) hangUp(); });
        }
        port.postMessage({ id, ...m });
      } catch { waits.delete(id); resolve({ type: 'error', error: 'failed' }); }
    }), { id });
  };

  // ---- the view ---------------------------------------------------------------------------------------------------------
  const turns = []; // [{ who: 'you' | 'glaze', text, follow? }], this page's only
  let box = null, opener = null, current = 0;
  const $ = (sel) => box?.querySelector(sel);
  const say = (s) => { const l = $('.gz-ask-say'); if (l && l.textContent !== s) l.textContent = s; };
  const item = (turn) => {
    const li = make('li', { className: turn.who === 'you' ? 'gz-ask-q' : 'gz-ask-a' }, make('p', { textContent: turn.text, dir: 'auto' }));
    if (turn.follow) li.append(make('p', { className: 'gz-ask-follow', textContent: turn.follow, dir: 'auto' }));
    return li;
  };
  const add = (turn) => {
    turns.push(turn);
    const log = $('.gz-ask-log');
    if (!log) return;
    log.append(item(turn));
    log.hidden = false;
    log.scrollTop = log.scrollHeight;
  };
  const running = (yes) => {
    const stop = $('.gz-ask-stop'), go = $('.gz-ask-send');
    if (stop) stop.hidden = !yes;
    if (go) go.disabled = yes;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!real(e) || !activated() || current || !box) return;
    const q = $('#gz-ask-q'), work = $('#gz-ask-work'), question = q.value.trim(), attempt = work.hidden ? '' : work.value.trim();
    if (!question) return q.focus();
    if (!await alive()) return box?.close();
    add({ who: 'you', text: attempt ? `${question}\n\n${attempt}` : question });
    q.value = ''; work.value = '';
    say(t('Thinking…'));
    running(true);
    const run = send({ op: 'ask', question, ...(attempt && { attempt }), locale: lang() }, (ev) => {
      if (ev.type === 'look') say(t('Reading your courses…'));
      else if (ev.type === 'approve') say(t('Waiting for your answer in Glaze’s window'));
    });
    current = run.id;
    const end = await run;
    if (current !== run.id) return;
    current = 0;
    running(false);
    if (end.type === 'end') {
      say('');
      if (end.declined) add({ who: 'glaze', text: t('Nothing was changed.') });
      else if (end.task === 'study.help') add({ who: 'glaze', text: end.output.reply, follow: end.output.followUp || '' });
      else add({ who: 'glaze', text: end.answer.text });
    } else if (['off', 'feature'].includes(end.error)) box?.close();
    else say(end.error === 'cancelled' ? '' : said(end.error));
    $('#gz-ask-q')?.focus();
  };
  const stop = (e) => {
    if (!real(e) || !current) return;
    try { port?.postMessage({ id: current, op: 'cancel' }); } catch { /* gone */ }
  };

  const open = async ({ event } = {}) => {
    if (box) return $('#gz-ask-q')?.focus();
    if (!real(event) || !await alive() || box) return;
    const close = make('button', { type: 'button', className: 'gz-ask-close', textContent: t('Close') });
    close.addEventListener('click', (e) => { if (real(e)) box?.close(); });
    const q = make('textarea', { id: 'gz-ask-q', rows: 2, maxLength: LIMIT.question, placeholder: t('Your question') });
    q.setAttribute('aria-label', t('Your question'));
    const work = make('textarea', { id: 'gz-ask-work', rows: 4, maxLength: LIMIT.attempt, placeholder: t('Your work'), hidden: true });
    work.setAttribute('aria-label', t('Your work'));
    const more = make('button', { type: 'button', className: 'gz-ask-more', textContent: t('Your work') });
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'gz-ask-work');
    more.addEventListener('click', (e) => {
      if (!real(e)) return;
      work.hidden = !work.hidden;
      more.setAttribute('aria-expanded', String(!work.hidden));
      (work.hidden ? q : work).focus();
    });
    const halt = make('button', { type: 'button', className: 'gz-ask-stop', textContent: t('Stop'), hidden: true });
    halt.addEventListener('click', stop);
    const go = make('button', { type: 'submit', className: 'gz-ask-send', textContent: t('Ask') });
    const form = make('form', { className: 'gz-ask-form' }, q, work, make('div', { className: 'gz-ask-row' }, more, make('span', { className: 'gz-ask-gap' }), halt, go));
    form.addEventListener('submit', submit);
    // Enter sends; Shift+Enter is a new line.
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (real(e)) form.requestSubmit(); } });
    const log = make('ol', { className: 'gz-ask-log', hidden: !turns.length }, ...turns.map(item));
    log.setAttribute('role', 'log');
    log.setAttribute('aria-labelledby', 'gz-ask-title');
    box = make('dialog', { id: 'gz-ask' },
      make('header', { className: 'gz-ask-head' }, make('h2', { id: 'gz-ask-title', tabIndex: -1, textContent: t('Ask Glaze') }), close),
      log, make('p', { className: 'gz-ask-say' }), form);
    box.querySelector('.gz-ask-say').setAttribute('role', 'status');
    box.setAttribute('aria-labelledby', 'gz-ask-title');
    box.addEventListener('click', (e) => { if (e.target === box && real(e)) box.close(); });
    box.addEventListener('close', () => {
      if (current) try { port?.postMessage({ id: current, op: 'cancel' }); } catch { /* gone */ }
      current = 0;
      hangUp();
      box?.remove(); box = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    opener = focused();
    document.body.append(box);
    box.showModal();
    log.scrollTop = log.scrollHeight;
    q.focus();
    // Where a run would stand now: no model chosen, or one not ready, said at once.
    const st = await send({ op: 'status' });
    if (!box) return;
    if (st.type === 'status' && st.allowed === false) return box.close();
    if (st.type === 'status' && st.ready === false) say(said(st.why));
  };

  // Ask, AI or Glaze turned off: the panel goes.
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (!box) return;
      if ((area === 'local' && c.ai && !on(c.ai.newValue)) || (area === 'sync' && c.enabled?.newValue === false)) box.close();
    });
  } catch { /* extension reloaded under the tab */ }

  return { open, LOCALES, lang };
})();
GZ_ASK_UI;
