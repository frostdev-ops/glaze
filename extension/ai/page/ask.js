// Ask Rime's panel (docs/ai-harness.md "Ask Rime"), loaded on demand on Canvas and Blackboard Ultra: the command palette's
// "Ask Rime" opens it (open({ event })) while AI and Ask are on (storage.local ai, ai/settings.js). A chat in a dialog over
// the page, its look Glaze's (core/page/apps.css #gz-ask): the conversation (questions, answers drawn from their markdown as
// elements, never markup), each tool call as a card while it runs, a change waiting on Glaze's approval window as a card of
// its own, a failure with Try again, and the composer. The worker (ai/ask.js, port 'glaze:ask') answers with study help or
// from the student's own records, and Glaze's approval window asks before any change: the panel only shows that it waits,
// since a page's own scripts can rewrite what the panel shows. It opens and asks only for the student's own click or key
// (isTrusted; sending also needs the user activation a real click or key gives). What it shows is part of the page while
// it is open, as anything on screen is; nothing is kept after it closes. Ask or AI turned off closes it. Nothing moves with
// reduced motion or Glaze's Motion off. Loaded on demand: a second injection keeps the first.
// For later parts: STEPS names a tool's card (any other shows its reason, else its name); on(kind, handler) takes the UI
// actions a run sends ({ id, type: 'action', action: { kind, … } }) while its question runs; run({ event, question }) asks
// a question the student didn't type (a wake's or a monitor's), for their own click only.
var GZ_ASK_UI = globalThis.GZ_ASK_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  // Run in a frame's next document before its bootstrap: keep nothing, so that document's content.js loads it again.
  if (!ctx) return undefined;
  const t = (k, v) => ctx.t(k, v);
  const kids = (list) => list.filter((k) => k != null && k !== false && k !== '');
  const make = (tag, props = {}, ...k) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids(k)); return e; };
  const LOCALES = ['en', 'pt-BR', 'es', 'fr', 'de', 'nl'];
  // turns: questions and answers a follow-up carries (ai/ask.js takes six at most), each cut to turn characters.
  const LIMIT = { question: 2000, attempt: 12000, turns: 3, turn: 2000, grow: 200 };
  // The page's language, as the tasks take it (ai/tasks/study-help.js LOCALES): pt-PT reads Brazilian Portuguese, others English.
  const lang = () => { const tag = String(ctx.locale() || 'en'); return LOCALES.find((c) => c === tag) || LOCALES.find((c) => c.split('-')[0] === tag.split('-')[0]) || 'en'; };
  const on = (ai) => !!ai && ai.on === true && ai.features?.ask === true;
  const read = () => new Promise((res) => { try { chrome.storage.local.get('ai', (r) => res(chrome.runtime.lastError ? null : r?.ai)); } catch { res(null); } });
  const alive = async () => ctx.on() && ctx.settings().enabled !== false && on(await read());
  const real = (e) => !!e?.isTrusted;
  const activated = () => navigator.userActivation?.isActive ?? true;
  const focused = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
  // Reduced motion or Glaze's Motion off: nothing moves (the sheet's motion block is gated the same way).
  const still = () => document.documentElement?.dataset?.gzMotion === 'off' || typeof globalThis.matchMedia !== 'function'
    || globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof globalThis.requestAnimationFrame !== 'function';
  // What each code the worker gives says (off and feature close the panel instead), each through t() as written.
  const said = (code) => {
    if (code === 'setup') return t('Choose a model for Ask Rime in Settings → AI.');
    if (code === 'permission') return t('Glaze can’t reach your AI provider. Check Settings → AI.');
    if (['busy', 'often'].includes(code)) return t('One question at a time. Try again in a moment.');
    if (['download', 'downloading', 'unavailable', 'provider-unavailable'].includes(code)) return t('The AI model isn’t ready. Check Settings → AI.');
    if (['check', 'refusal', 'steps', 'invalid-response'].includes(code)) return t('Rime couldn’t answer that. Try asking another way.');
    if (code === 'size') return t('That question is too long.');
    return t('Something went wrong. Try again.');
  };
  // A tool call's card, by the tool's name; another tool's card shows the reason it gives, else its name.
  const STEPS = {
    accounts_list: 'Checking your school accounts', courses_list: 'Reading your courses', assignments_list: 'Reading your assignments',
    assignment_read: 'Reading an assignment', todo_list: 'Reading your to-do list', schedule_list: 'Reading your schedule', grades_list: 'Reading your grades',
    course_grades: 'Reading a course’s grades', documents_list: 'Reading your documents', document_read: 'Reading a document',
    document_assignment: 'Finding a document’s assignment', todo_mark_done: 'Mark a to-do done',
  };
  const stepLabel = (s) => (Object.hasOwn(STEPS, s.name) ? t(STEPS[s.name]) : typeof s.reason === 'string' && s.reason.trim() ? s.reason.trim().slice(0, 200)
    : String(s.name || '').replace(/_/g, ' ').replace(/^\p{L}/u, (c) => c.toUpperCase()));
  const STARTERS = () => [t('What’s due this week?'), t('How are my grades?'), t('Which assignments are coming up?'), t('Help me study for my next test')];

  // ---- icons: Glaze's own lines, drawn here (nothing fetched) --------------------------------------------------------------
  const SVG = 'http://www.w3.org/2000/svg';
  const PATHS = {
    rime: ['m8 19 4-8', 'm14 24 7-16', 'm23 22 3-7'], send: ['M12 19V5', 'm5 12 7-7 7 7'], close: ['M6 6l12 12', 'M18 6 6 18'], plus: ['M12 5v14', 'M5 12h14'],
    check: ['m5 12.5 4.5 4.5L19 7'], warn: ['M12 4 2.5 20h19z', 'M12 10v4', 'M12 17v.01'], no: ['M7 7l10 10', 'M17 7 7 17'], down: ['M12 5v14', 'm5 12 7 7 7-7'],
    copy: ['M9 9h11v11H9z', 'M5 15V4h11'], stop: ['M7 7h10v10H7z'], retry: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4h4'], dot: ['M12 12h.01'],
  };
  const icon = (name) => {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('viewBox', name === 'rime' ? '0 0 32 32' : '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', `gz-ask-icon gz-ask-i-${name}`);
    for (const d of PATHS[name]) { const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); }
    return s;
  };

  // ---- markdown: the subset a chat writes, as elements (ported from the agent chat's renderer) ------------------------------
  // Inline: code, bold, italic, strike and links: code first, so its content is literal. Words stay words: markup in them
  // is text. A link only to https, opened apart from the page; any other is its label.
  const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/;
  const inline = (text, into) => {
    let rest = text;
    for (let m; (m = INLINE.exec(rest));) {
      if (m.index > 0) into.append(rest.slice(0, m.index));
      const tok = m[0];
      if (tok[0] === '`') into.append(make('code', { textContent: tok.slice(1, -1) }));
      else if (tok.startsWith('**') || tok.startsWith('__')) { const n = make('strong'); inline(tok.slice(2, -2), n); into.append(n); }
      else if (tok.startsWith('~~')) { const n = make('s'); inline(tok.slice(2, -2), n); into.append(n); }
      else if (tok[0] === '[') {
        const cut = tok.indexOf(']('), label = tok.slice(1, cut), href = tok.slice(cut + 2, -1);
        let safe = false;
        try { safe = /^https:\/\//i.test(href) && new URL(href).protocol === 'https:'; } catch { /* not a link */ }
        const n = safe ? make('a', { href, target: '_blank', rel: 'noopener noreferrer' }) : make('span');
        inline(label, n);
        into.append(n);
      } else { const n = make('em'); inline(tok.slice(1, -1), n); into.append(n); }
      rest = rest.slice(m.index + tok.length);
    }
    if (rest) into.append(rest);
  };
  // Blocks: fenced code, headings, rules, tables, lists, quotes, paragraphs. → [element].
  const markdown = (src) => {
    const out = [], lines = String(src || '').replace(/\r/g, '').split('\n'), para = [];
    const flush = () => { if (!para.length) return; const p = make('p', { dir: 'auto' }); inline(para.join('\n'), p); out.push(p); para.length = 0; };
    const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    for (let i = 0; i < lines.length;) {
      const line = lines[i];
      if (/^```/.test(line)) {
        flush();
        const buf = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
        i++;
        out.push(make('pre', { dir: 'ltr' }, make('code', { textContent: buf.join('\n') })));
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) { flush(); const n = make(`h${Math.min(h[1].length + 2, 6)}`, { dir: 'auto' }); inline(h[2], n); out.push(n); i++; continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flush(); out.push(make('hr')); i++; continue; }
      if (/^\s*\|/.test(line) && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
        flush();
        const row = (l, tag) => make('tr', {}, ...cells(l).map((c) => { const x = make(tag); inline(c, x); return x; }));
        const body = make('tbody');
        for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) body.append(row(lines[i], 'td'));
        out.push(make('div', { className: 'gz-ask-table' }, make('table', {}, make('thead', {}, row(line, 'th')), body)));
        continue;
      }
      const item = (l, ordered) => (ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/).exec(l);
      const ordered = !!item(line, true);
      if (ordered || item(line, false)) {
        flush();
        const list = make(ordered ? 'ol' : 'ul', { dir: 'auto' });
        for (let m; i < lines.length && (m = item(lines[i], ordered)); i++) { const li = make('li'); inline(m[1], li); list.append(li); }
        out.push(list);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flush();
        const buf = [];
        for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) buf.push(lines[i].replace(/^\s*>\s?/, ''));
        const q = make('blockquote', { dir: 'auto' });
        inline(buf.join('\n'), q);
        out.push(q);
        continue;
      }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line);
      i++;
    }
    flush();
    return out;
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

  // ---- UI actions a run sends (for tools that act on the page) ---------------------------------------------------------
  const handlers = new Map();
  const onAction = (kind, handler) => { if (typeof kind === 'string' && typeof handler === 'function') handlers.set(kind, handler); };
  const act = (a) => {
    const f = a && typeof a === 'object' && typeof a.kind === 'string' ? handlers.get(a.kind) : null;
    if (f) try { f(a); } catch { /* the handler's own failure */ }
  };

  // ---- the view ---------------------------------------------------------------------------------------------------------
  const turns = []; // [{ question, answer }] of this panel, for follow-ups; gone when it closes
  const reveals = new Map(), copyTimers = new Map();
  let box = null, opener = null, current = 0, pending = null, follow = true, frame = 0, written = -1, sizes = null, moved = 0;
  const $ = (sel) => box?.querySelector(sel);
  const say = (s) => { const l = $('.gz-ask-say'); if (l && l.textContent !== s) l.textContent = s; };
  const log = () => $('.gz-ask-log');
  const releaseView = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    for (const id of reveals.values()) cancelAnimationFrame(id);
    reveals.clear();
    for (const id of copyTimers.values()) clearTimeout(id);
    copyTimers.clear();
    sizes?.disconnect();
  };
  const drop = (li) => { if (li) { sizes?.unobserve(li); li.remove(); } };

  // The log follows its newest line while the student reads at the bottom; scrolled up, it stays, and Jump to latest shows.
  // Only the student leaves the bottom: a scroll within a second of their wheel, touch, key or pointer on the log (moved)
  // that ends away from it, never one the panel wrote (written) or the browser made fitting a change. A line or the log
  // changing size (a reveal, a Look, the window), or the page coming back into view, brings the bottom back while following.
  const near = (l) => l.scrollHeight - l.scrollTop - l.clientHeight < 64;
  const write = (l, v) => { l.scrollTop = v; written = l.scrollTop; };
  const jumpShown = () => { const j = $('.gz-ask-jump'), l = log(); if (j && l) j.hidden = follow || l.scrollHeight - l.clientHeight < 48; };
  const pin = (instant) => {
    const l = log();
    if (!l || !follow) return jumpShown();
    if (instant || still()) { write(l, l.scrollHeight); return jumpShown(); }
    if (frame) return;
    const tick = () => {
      frame = 0;
      const x = log();
      if (!x || !follow) return;
      const target = Math.max(0, x.scrollHeight - x.clientHeight), d = target - x.scrollTop;
      write(x, x.scrollTop + (Math.abs(d) < 1 ? d : d * 0.3));
      if (Math.abs(target - x.scrollTop) > 1) frame = requestAnimationFrame(tick);
      jumpShown();
    };
    frame = requestAnimationFrame(tick);
  };
  // A line the conversation gains, arriving (the sheet's motion block moves [data-arrive]); the empty view gives way.
  const put = (li) => {
    const l = log();
    if (!l) return li;
    l.querySelector('.gz-ask-empty')?.remove();
    li.dataset.arrive = '';
    sizes?.observe(li);
    const busy = l.querySelector('.gz-ask-busy');
    if (busy && li !== busy) busy.before(li); else l.append(li);
    pin();
    return li;
  };
  const empty = () => {
    const chips = STARTERS().map((s) => {
      const b = make('button', { type: 'button', className: 'gz-ask-starter', textContent: s });
      b.addEventListener('click', (e) => { if (!real(e)) return; const q = $('#gz-ask-q'); if (!q) return; q.value = s; grow(q); q.focus(); });
      return b;
    });
    return make('li', { className: 'gz-ask-empty' }, make('span', { className: 'gz-ask-mark' }, icon('rime')), make('div', { className: 'gz-ask-starters' }, ...chips));
  };
  const question = (text) => put(make('li', { className: 'gz-ask-q' }, make('div', { className: 'gz-ask-body' }, make('p', { className: 'gz-ask-text', textContent: text, dir: 'auto' }))));
  // The copy of an answer the student takes: its words as Rime wrote them.
  const copier = (text) => {
    const b = make('button', { type: 'button', className: 'gz-ask-copy', title: t('Copy') }, icon('copy'), make('span', { textContent: t('Copy') }));
    b.setAttribute('aria-label', t('Copy'));
    b.addEventListener('click', async (e) => {
      if (!real(e)) return;
      try { await navigator.clipboard.writeText(text); } catch { return; }
      if (!b.isConnected) return;
      clearTimeout(copyTimers.get(b));
      b.lastChild.textContent = t('Copied');
      copyTimers.set(b, setTimeout(() => { copyTimers.delete(b); if (b.lastChild) b.lastChild.textContent = t('Copy'); }, 1600));
    });
    return b;
  };
  // Words appearing as Rime's answer arrives: each text node grows a few characters a frame (about a second whole), and a
  // paragraph, list item or block shows once its first words do.
  const BLOCKS = 'li, p, pre, h3, h4, h5, h6, blockquote, tr, hr';
  const reveal = (li, parts) => {
    if (still()) return;
    const nodes = [], waiting = new Set();
    for (const part of parts) {
      const w = document.createTreeWalker?.(part, 4 /* NodeFilter.SHOW_TEXT */);
      for (let n = w?.nextNode(); n; n = w.nextNode()) {
        const block = n.parentElement?.closest(BLOCKS);
        nodes.push([n, n.data, block]);
        n.data = '';
        if (block && block !== nodes[0][2]) { block.hidden = true; waiting.add(block); }
      }
    }
    const total = nodes.reduce((s, [, d]) => s + d.length, 0);
    if (!total) return;
    const step = Math.max(3, Math.ceil(total / 54));
    li.dataset.streaming = '';
    let at = 0;
    const tick = () => {
      reveals.delete(li);
      if (!li.isConnected) return;
      let left = step;
      while (left > 0 && at < nodes.length) {
        const [n, full, block] = nodes[at], take = Math.min(left, full.length - n.data.length);
        if (block && waiting.delete(block)) block.hidden = false;
        n.data = full.slice(0, n.data.length + take);
        left -= take;
        if (n.data.length >= full.length) at++;
      }
      pin(true);
      if (at < nodes.length) reveals.set(li, requestAnimationFrame(tick));
      else { for (const b of waiting) b.hidden = false; delete li.dataset.streaming; }
    };
    reveals.set(li, requestAnimationFrame(tick));
  };
  const answer = (text, follow_ = '') => {
    const body = make('div', { className: 'gz-ask-body' });
    const md = make('div', { className: 'gz-ask-text gz-ask-md', dir: 'auto' }, ...markdown(text));
    const parts = [md];
    body.append(md);
    if (follow_) { const f = make('p', { className: 'gz-ask-text gz-ask-follow', textContent: follow_, dir: 'auto' }); body.append(f); parts.push(f); }
    const li = put(make('li', { className: 'gz-ask-a' }, body, make('div', { className: 'gz-ask-acts' }, copier(follow_ ? `${text}\n\n${follow_}` : text))));
    reveal(li, parts);
    return li;
  };
  const note = (text, cls = 'gz-ask-note') => put(make('li', { className: cls }, icon('warn'), make('p', { textContent: text })));

  // ---- a question's run: the thinking line, its tool cards, its end ------------------------------------------------------
  const busy = (yes) => {
    const l = log();
    drop(l?.querySelector('.gz-ask-busy'));
    if (yes && l) {
      const li = make('li', { className: 'gz-ask-busy' }, make('span', { className: 'gz-ask-mark' }, icon('rime')), make('span', { className: 'gz-ask-busy-words', textContent: t('Thinking…') }));
      li.setAttribute('aria-hidden', 'true');
      put(li);
    }
  };
  const seconds = (ms) => {
    const n = Math.max(0, Number(ms) || 0), sec = n >= 1000;
    try { return new Intl.NumberFormat(lang(), { style: 'unit', unit: sec ? 'second' : 'millisecond', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(sec ? n / 1000 : Math.round(n)); }
    catch { return sec ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`; }
  };
  const MARK = { run: 'dot', done: 'check', fail: 'warn', ask: 'dot', no: 'no' };
  // One card a step, in the run's timeline, made or brought up to date from the worker's step event.
  const card = (run, s) => {
    if (!s || typeof s !== 'object' || !Number.isSafeInteger(s.n) || !Object.hasOwn(MARK, s.state)) return;
    if (!run.line?.isConnected) { run.line = put(make('li', { className: 'gz-ask-steps' })); run.cards = new Map(); }
    let c = run.cards.get(s.n);
    if (!c) {
      c = make('div', { className: 'gz-ask-step' }, make('span', { className: 'gz-ask-step-mark' }), make('span', { className: 'gz-ask-step-label', dir: 'auto' }), make('span', { className: 'gz-ask-step-time' }));
      run.cards.set(s.n, c);
      c.dataset.arrive = '';
      run.line.append(c);
    }
    c.dataset.kind = s.kind === 'write' ? 'write' : 'read';
    c.dataset.state = s.state;
    c.querySelector('.gz-ask-step-mark').replaceChildren(icon(MARK[s.state]));
    c.querySelector('.gz-ask-step-label').textContent = stepLabel(s);
    c.querySelector('.gz-ask-step-time').textContent = Number.isFinite(s.ms) && !['run', 'ask'].includes(s.state) ? seconds(s.ms) : '';
    c.querySelector('.gz-ask-step-note')?.remove();
    if (s.state === 'ask') c.append(make('p', { className: 'gz-ask-step-note', textContent: t('Waiting for your answer in Glaze’s window') }));
    if ([...run.cards.values()].some((x) => ['run', 'ask'].includes(x.dataset.state))) run.line.dataset.running = ''; else delete run.line.dataset.running;
    // While Glaze's window waits, its card says so: no thinking line under it.
    $('.gz-ask-busy')?.toggleAttribute('hidden', s.state === 'ask');
    pin();
  };
  const running = (yes) => {
    const stop = $('.gz-ask-stop'), go = $('.gz-ask-send'), fresh = $('.gz-ask-new');
    if (stop) stop.hidden = !yes;
    if (go) go.hidden = yes;
    if (go) go.disabled = yes;
    if (fresh) fresh.disabled = yes;
  };
  // The conversation so far, for a follow-up: the last LIMIT.turns questions and answers.
  const history = () => turns.slice(-LIMIT.turns).map((x) => ({ question: x.question.slice(0, LIMIT.turn), answer: x.answer.slice(0, LIMIT.turn) }));

  // Ask: the reservation before the storage read (closing invalidates it, including when a new panel has opened), then the
  // question in the conversation (unless it is a try again of one shown), the run, its end.
  const ask = async ({ question: q, attempt = '', shown = false, sent }) => {
    if (current || pending || !box) return;
    const mine = pending = { box };
    const allowed = await alive();
    if (pending !== mine || box !== mine.box || !box.open) return;
    pending = null;
    if (!allowed) return box.close();
    if (!shown) question(attempt ? `${q}\n\n${attempt}` : q);
    sent?.();
    say(t('Thinking…'));
    running(true);
    busy(true);
    const run = { line: null, cards: null }, past = history();
    const go = send({ op: 'ask', question: q, ...(attempt && { attempt }), locale: lang(), ...(past.length && { history: past }) }, (ev) => {
      if (current !== go.id) return;
      if (ev.type === 'step') {
        card(run, ev.step);
        if (ev.step?.state === 'run') say(t('Reading your courses…'));
      } else if (ev.type === 'approve') say(t('Waiting for your answer in Glaze’s window'));
      else if (ev.type === 'action') act(ev.action);
    });
    current = go.id;
    const end = await go;
    if (current !== go.id) return;
    current = 0;
    running(false);
    busy(false);
    if (run.line) delete run.line.dataset.running;
    if (end.type === 'end') {
      say('');
      if (end.declined) answer(t('Nothing was changed.'));
      else if (end.task === 'study.help') {
        const reply = String(end.output?.reply || ''), more = String(end.output?.followUp || '');
        answer(reply, more);
        turns.push({ question: q, answer: more ? `${reply}\n\n${more}` : reply });
      } else {
        answer(String(end.answer?.text || ''));
        turns.push({ question: q, answer: String(end.answer?.text || '') });
      }
    } else if (['off', 'feature'].includes(end.error)) box?.close();
    else if (end.error === 'cancelled') say('');
    else {
      const text = said(end.error);
      say(text);
      const retry = make('button', { type: 'button', className: 'gz-ask-retry' }, icon('retry'), make('span', { textContent: t('Try again') }));
      const li = note(text, 'gz-ask-err');
      li.append(retry);
      retry.addEventListener('click', (e) => {
        if (!real(e) || !activated() || current || pending) return;
        drop(li);
        ask({ question: q, attempt, shown: true });
      });
    }
    $('#gz-ask-q')?.focus();
  };

  // The question box grows with what is typed, up to LIMIT.grow pixels, then scrolls.
  const grow = (q) => { if (!q?.style) return; q.style.height = 'auto'; if (q.scrollHeight) q.style.height = `${Math.min(q.scrollHeight, LIMIT.grow)}px`; };
  const submit = async (e) => {
    e.preventDefault();
    if (!real(e) || !activated() || current || pending || !box) return;
    const q = $('#gz-ask-q'), work = $('#gz-ask-work'), text = q.value.trim(), attempt = work.hidden ? '' : work.value.trim();
    if (!text) return q.focus();
    const questionValue = q.value, workValue = work.value;
    await ask({ question: text, attempt, sent: () => {
      if (q.value === questionValue) { q.value = ''; grow(q); }
      if (work.value === workValue) work.value = '';
    } });
  };
  const stop = (e) => {
    if (!real(e) || !current) return;
    try { port?.postMessage({ id: current, op: 'cancel' }); } catch { /* gone */ }
  };
  // Closing: the panel fades out (none with reduced motion or Motion off), then goes, and everything with it.
  let shutting = false;
  const shut = () => {
    const d = box;
    if (!d || shutting) return;
    if (still() || typeof d.animate !== 'function') return d.close();
    shutting = true;
    const done = () => { shutting = false; if (box === d) d.close(); };
    try {
      d.animate([{ opacity: 1 }, { opacity: 0, translate: '0 8px', scale: '0.98' }], { duration: 140, easing: 'ease-in', fill: 'forwards' }).finished.then(done, done);
      try { d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards', pseudoElement: '::backdrop' }); } catch { /* no backdrop animation here */ }
    } catch { done(); }
  };
  const clear = (e) => {
    if (!real(e) || current || pending) return;
    turns.length = 0;
    releaseView();
    log()?.replaceChildren(empty());
    if (sizes && log()) sizes.observe(log());
    say('');
    follow = true;
    jumpShown();
    $('#gz-ask-q')?.focus();
  };

  const open = async ({ event } = {}) => {
    if (box) return $('#gz-ask-q')?.focus();
    if (!real(event) || !await alive() || box) return;
    const btn = (cls, name, label, text) => {
      const b = make('button', { type: 'button', className: cls, title: label }, icon(name), text ? make('span', { textContent: text }) : null);
      b.setAttribute('aria-label', label);
      return b;
    };
    const close = btn('gz-ask-close', 'close', t('Close'));
    close.addEventListener('click', (e) => { if (real(e)) shut(); });
    const fresh = btn('gz-ask-new', 'plus', t('New chat'), t('New chat'));
    fresh.addEventListener('click', clear);
    const q = make('textarea', { id: 'gz-ask-q', rows: 1, maxLength: LIMIT.question, placeholder: t('Your question') });
    q.setAttribute('aria-label', t('Your question'));
    q.addEventListener('input', () => grow(q));
    const work = make('textarea', { id: 'gz-ask-work', rows: 3, maxLength: LIMIT.attempt, placeholder: t('Your work'), hidden: true });
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
    const halt = btn('gz-ask-stop', 'stop', t('Stop'));
    halt.hidden = true;
    halt.addEventListener('click', stop);
    const go = btn('gz-ask-send', 'send', t('Ask'));
    go.type = 'submit';
    go.addEventListener('click', submit);
    const form = make('form', { className: 'gz-ask-form' }, make('div', { className: 'gz-ask-composer' }, q, work, make('div', { className: 'gz-ask-row' }, more, make('span', { className: 'gz-ask-gap' }), halt, go)));
    // requestSubmit() also creates a trusted SubmitEvent. Only the student's click or key may ask.
    form.addEventListener('submit', (e) => e.preventDefault());
    // Enter sends; Shift+Enter is a new line.
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e); });
    const list = make('ol', { className: 'gz-ask-log' }, empty());
    list.setAttribute('role', 'log');
    list.setAttribute('aria-labelledby', 'gz-ask-title');
    const mine = () => { moved = Date.now(); };
    for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown']) list.addEventListener(type, mine, { passive: true });
    list.addEventListener('scroll', () => {
      if (Math.abs(list.scrollTop - written) > 1) {
        written = list.scrollTop;
        if (near(list)) follow = true;
        else if (Date.now() - moved < 1000) { follow = false; if (frame) { cancelAnimationFrame(frame); frame = 0; } }
      }
      jumpShown();
    }, { passive: true });
    if (typeof ResizeObserver === 'function') { sizes = new ResizeObserver(() => pin(true)); sizes.observe(list); }
    const jump = btn('gz-ask-jump', 'down', t('Jump to latest'));
    jump.hidden = true;
    jump.addEventListener('click', (e) => { if (!real(e)) return; follow = true; pin(); });
    box = make('dialog', { id: 'gz-ask' },
      make('header', { className: 'gz-ask-head' }, make('span', { className: 'gz-ask-mark' }, icon('rime')), make('h2', { id: 'gz-ask-title', tabIndex: -1, textContent: t('Ask Rime') }),
        make('span', { className: 'gz-ask-gap' }), fresh, close),
      make('div', { className: 'gz-ask-stage' }, list, jump), make('p', { className: 'gz-ask-say' }), form);
    box.querySelector('.gz-ask-say').setAttribute('role', 'status');
    box.setAttribute('aria-labelledby', 'gz-ask-title');
    box.addEventListener('click', (e) => { if (e.target === box && real(e)) shut(); });
    box.addEventListener('cancel', (e) => { if (!still() && real(e)) { e.preventDefault(); shut(); } });
    box.addEventListener('close', () => {
      if (current) try { port?.postMessage({ id: current, op: 'cancel' }); } catch { /* gone */ }
      current = 0; pending = null; shutting = false; follow = true;
      releaseView();
      turns.length = 0;
      sizes = null; written = -1;
      hangUp();
      box?.remove(); box = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    opener = focused();
    document.body.append(box);
    box.showModal();
    q.focus();
    // Where a run would stand now: no model chosen, or one not ready, said at once.
    const dialog = box, status = send({ op: 'status' });
    const st = await status;
    if (box !== dialog || seq !== status.id) return;
    if (st.type === 'status' && st.allowed === false) return box.close();
    if (st.type === 'status' && st.ready === false) { say(said(st.why)); log()?.prepend(make('li', { className: 'gz-ask-note' }, icon('warn'), make('p', { textContent: said(st.why) }))); }
  };

  // A question the student didn't type (a wake's or a monitor's), asked for their own click: the panel opens and asks it.
  const run = async ({ event, question: q } = {}) => {
    if (!real(event) || typeof q !== 'string' || !q.trim() || q.length > LIMIT.question) return;
    await open({ event });
    if (!box || !activated()) return;
    void ask({ question: q.trim() });
  };

  try { document.addEventListener('visibilitychange', () => { if (box && !document.hidden) pin(true); }); } catch { /* no document events */ }

  // Ask, AI or Glaze turned off: the panel goes.
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (!box) return;
      if ((area === 'local' && c.ai && !on(c.ai.newValue)) || (area === 'sync' && c.enabled?.newValue === false)) box.close();
    });
  } catch { /* extension reloaded under the tab */ }

  return { open, run, on: onAction, STEPS, LOCALES, lang };
})();
GZ_ASK_UI;
