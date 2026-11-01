// Ask Rime's chat (docs/ai-harness.md "Ask Rime"), the one component both of its surfaces mount: the dialog over the page
// (ai/page/ask.js) and the widget tile (ai/page/ask-tile.js, core/page/widgets.js MORE 'ask'). mount(host, { variant,
// onClose, onOff, onShow }) → { root, focus, ask, stop, clear }: one chat in host, with its own conversation, port
// ('glaze:ask') and worker connection, kept while it is mounted and gone at stop(). The conversation (questions, answers drawn
// from their markdown as elements, never markup), each tool call as a card while it runs, a change waiting on Glaze's
// approval window as a card of its own (the answer is given only in that window: a page's own scripts can rewrite what the
// chat shows), a failure with Try again, the composer, and the head: Rime's mark and title (the dialog's), the context meter
// (a ring and its percentage of the model's window, from the worker's context event: neutral, warm from 70%, the Look's
// warning colour from 90%; New chat puts it back at the chat's own share), New chat, and Close (the dialog's). Turns the
// worker folded into a summary (its summary event) are one line in the log, expanded to read it, and later questions carry
// the summary with only the turns after it. It acts only for the student's own click or key (isTrusted; sending also needs
// the user activation a real click or key gives). The dialog keeps its ids (#gz-ask-q, #gz-ask-work, #gz-ask-title); a tile
// has none, so both can be on one page. Nothing moves with reduced motion or Glaze's Motion off.
// STEPS names a tool's card (any other shows its reason, else its name), and a card shows the worker's detail. The UI actions
// a run sends ({ id, type: 'action', action: { kind, … } }) wait until the answer shows: open goes to the place (this site
// only), highlight marks the words on the page and gives the answer a Show on the page button; on(kind, handler) adds a kind.
// request(m): one message on a port of its own, for ask.js's carried highlight and fired reminders. Loaded on demand: a second
// injection keeps the first.
var GZ_ASK_CHAT = globalThis.GZ_ASK_CHAT || (() => {
  const ctx = globalThis.GZ_CTX;
  // Run in a frame's next document before its bootstrap: keep nothing, so that document's content.js loads it again.
  if (!ctx) return undefined;
  const t = (k, v) => ctx.t(k, v);
  const kids = (list) => list.filter((k) => k != null && k !== false && k !== '');
  const make = (tag, props = {}, ...k) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids(k)); return e; };
  const LOCALES = ['en', 'pt-BR', 'es', 'fr', 'de', 'nl'];
  // turns: questions and answers a follow-up carries (ai/ask.js takes six at most), each cut to turn characters.
  // summary: the worker's summary of folded turns, carried back with a later question.
  const LIMIT = { question: 2000, attempt: 12000, turns: 3, turn: 2000, grow: 200, text: 20000, summary: 700 };
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
    run_js: 'Working it out', places_list: 'Finding the page', place_open: 'Opening the page', page_highlight: 'Marking it on the page',
    wake_create: 'Set a reminder', monitor_create: 'Watch for a change', wakes_list: 'Reading your reminders', wake_cancel: 'Cancel a reminder or watch',
    announcements_list: 'Reading announcements', announcement_read: 'Reading an announcement', content_list: 'Reading the course content', content_read: 'Reading a course page',
    syllabus_read: 'Reading the syllabus', discussions_list: 'Reading discussions', discussion_read: 'Reading a discussion',
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

  // ---- a port ------------------------------------------------------------------------------------------------------------
  // → { send, post, hangUp }: send(m, each) → the message that ends m (status, end or error), events before it to each. Safari
  // may retire an idle worker without a disconnect: with nothing pending, a fresh port. late(a): a message for a finished
  // ask (the worker's summary of folded turns comes after its end).
  const channel = (late) => {
    let port = null, seq = 0;
    const waits = new Map(); // message id → its answer's handler
    const hangUp = () => {
      const p = port;
      port = null;
      for (const w of waits.values()) w({ type: 'error', error: 'connection-lost' });
      waits.clear();
      try { p?.disconnect(); } catch { /* gone */ }
    };
    const send = (m, each) => {
      const id = ++seq;
      if (!waits.size) hangUp();
      return Object.assign(new Promise((resolve) => {
        waits.set(id, (a) => { if (['status', 'end', 'error'].includes(a?.type)) { waits.delete(id); resolve(a); } else each?.(a); });
        try {
          if (!port) {
            const p = port = chrome.runtime.connect({ name: 'glaze:ask' });
            p.onMessage.addListener((a) => { const w = waits.get(a?.id); if (w) w(a); else late?.(a); });
            p.onDisconnect.addListener(() => { if (port === p) hangUp(); });
          }
          port.postMessage({ id, ...m });
        } catch { waits.delete(id); resolve({ type: 'error', error: 'failed' }); }
      }), { id });
    };
    const post = (m) => { try { port?.postMessage(m); } catch { /* gone */ } };
    return { send, post, hangUp, last: () => seq };
  };
  const request = (m) => { const c = channel(); return c.send(m).finally(() => c.hangUp()); };

  // ---- UI actions a run sends (for tools that act on the page) ---------------------------------------------------------
  const handlers = new Map();
  const onAction = (kind, handler) => { if (typeof kind === 'string' && typeof handler === 'function') handlers.set(kind, handler); };
  const act = (a, rest) => {
    const f = a && typeof a === 'object' && typeof a.kind === 'string' ? handlers.get(a.kind) : null;
    if (f) try { return f(a, rest); } catch { /* the handler's own failure */ }
    return undefined;
  };
  // The page's words as the student sees them, the panel's and Glaze's cards left out: what page_highlight checks against.
  // A chat in a tile sits in the page itself: its own words come out of what each part of the page says.
  const OURS = '#gz-ask, #gz-ask-fired, .gz-ask-chat, script, style, noscript';
  const pageText = () => {
    const out = [];
    for (const el of document.body?.children || []) {
      if (['gz-ask', 'gz-ask-fired'].includes(el.id) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      let text = el.innerText || el.textContent || '';
      for (const chat of el.querySelectorAll?.('.gz-ask-chat') || []) { const own = chat.innerText || chat.textContent || ''; if (own) text = text.replace(own, ''); }
      out.push(text);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, LIMIT.text);
  };
  // Marks the words wherever the page shows them (at most 20 places), a note as each mark's title. → the first mark the
  // student can see (a collapsed menu's isn't), else the first, or null.
  const SPOTS = 20;
  const mark = (text, note) => {
    const needle = String(text || '').trim().toLowerCase();
    if (!needle || typeof document.createTreeWalker !== 'function') return null;
    const w = document.createTreeWalker(document.body, 4, { acceptNode: (n) => (n.nodeValue?.toLowerCase().includes(needle) && !n.parentElement?.closest(OURS) ? 1 : 3) });
    const nodes = [];
    for (let n = w.nextNode(); n && nodes.length < SPOTS; n = w.nextNode()) nodes.push(n);
    const marks = [];
    for (const n of nodes) {
      const at = n.nodeValue.toLowerCase().indexOf(needle);
      const hit = n.splitText(at);
      hit.splitText(needle.length);
      const m = make('mark', { className: 'gz-ask-spot', textContent: hit.nodeValue });
      if (note) { m.title = String(note).slice(0, 80); m.dataset.note = m.title; }
      hit.replaceWith(m);
      marks.push(m);
    }
    const first = marks.find((m) => m.getClientRects?.().length > 0) || marks[0] || null;
    for (let d = first?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    return first;
  };
  const sameSite = (url) => { try { const u = new URL(url, location.origin); return /^https?:$/.test(u.protocol) && u.origin === location.origin ? u : null; } catch { return null; } };
  // open: a place on this site (the course tabs open it when they run, as the palette does), else Glaze's Documents or
  // Settings. A highlight after it goes with it, kept a minute for that page.
  onAction('open', (a, rest) => {
    if (a.app === 'settings') { try { Promise.resolve(chrome.runtime.sendMessage('options')).catch(() => {}); } catch { /* reloaded */ } return; }
    if (a.app === 'documents') { try { Promise.resolve(chrome.runtime.sendMessage('papers')).catch(() => {}); } catch { /* reloaded */ } return; }
    const u = sameSite(a.url);
    if (!u) return;
    if (u.href === location.href) return 'here';
    globalThis.GZ_CTABS?.bar?.open(u.href, { native: true }) || location.assign(u.href);
    return 'gone';
  });
  onAction('highlight', (a) => mark(a.text, a.note));

  const seconds = (ms) => {
    const n = Math.max(0, Number(ms) || 0), sec = n >= 1000;
    try { return new Intl.NumberFormat(lang(), { style: 'unit', unit: sec ? 'second' : 'millisecond', unitDisplay: 'narrow', maximumFractionDigits: 1 }).format(sec ? n / 1000 : Math.round(n)); }
    catch { return sec ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`; }
  };
  const percent = (n) => { try { return new Intl.NumberFormat(lang(), { style: 'percent', maximumFractionDigits: 0 }).format(n / 100); } catch { return `${n}%`; } };
  const MARK = { run: 'dot', done: 'check', fail: 'warn', ask: 'dot', no: 'no' };
  // The meter's bands: warm from WARM%, the Look's warning colour from WARN%.
  const METER = { warm: 70, warn: 90 };
  const button = (cls, name, label, text) => {
    const b = make('button', { type: 'button', className: cls, title: label }, icon(name), text ? make('span', { textContent: text }) : null);
    b.setAttribute('aria-label', label);
    return b;
  };

  // ---- one chat ----------------------------------------------------------------------------------------------------------
  // variant: 'dialog' (Rime's mark and title, Close, the ids) or 'tile'. onClose(): Close's click; onOff(): Ask, AI or the
  // model's access gone (the dialog closes); onShow(): before Show on the page scrolls there (the dialog closes).
  const mount = (host, { variant = 'tile', onClose, onOff, onShow } = {}) => {
    const dialog = variant === 'dialog';
    const turns = []; // [{ question, answer, li }] of this chat, for follow-ups; gone when it stops or starts anew
    const afterReveal = new Map(), reveals = new Map(), copyTimers = new Map();
    let actionEpoch = 0, current = 0, pending = null, follow = true, frame = 0, written = -1, sizes = null, moved = 0, alive_ = true;
    // memo: the worker's summary of the turns it folded and how many of turns it covers; sentFrom: the first turn the last
    // question carried; base: the chat's own share of the window, read from a first question's context.
    const memo = { summary: '', folded: 0 };
    let sentFrom = 0, lastAsk = 0, base = null;
    const port = channel((a) => { if (a?.type === 'summary' && a.id === lastAsk) folded(a); });
    const root = make('div', { className: 'gz-ask-chat' });
    root.dataset.variant = variant;
    const $ = (sel) => root.querySelector(sel);
    const say = (s) => { const l = $('.gz-ask-say'); if (l && l.textContent !== s) l.textContent = s; };
    const log = () => $('.gz-ask-log');
    const releaseView = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      for (const id of reveals.values()) cancelAnimationFrame(id);
      reveals.clear();
      afterReveal.clear();
      for (const id of copyTimers.values()) clearTimeout(id);
      copyTimers.clear();
      sizes?.disconnect();
    };
    const drop = (li) => { if (li) { sizes?.unobserve(li); li.remove(); } };

    // The log follows its newest line while the student reads at the bottom; scrolled up, it stays, and Jump to latest shows.
    // Only the student leaves the bottom: a scroll within a second of their wheel, touch, key or pointer on the log (moved)
    // that ends away from it, never one the chat wrote (written) or the browser made fitting a change. A line or the log
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
        if (still()) { write(x, x.scrollHeight); return jumpShown(); }
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
    const grow = (q) => { if (!q?.style) return; q.style.height = 'auto'; if (q.scrollHeight) q.style.height = `${Math.min(q.scrollHeight, LIMIT.grow)}px`; };
    const empty = () => {
      const chips = STARTERS().map((s) => {
        const b = make('button', { type: 'button', className: 'gz-ask-starter', textContent: s });
        b.addEventListener('click', (e) => { if (!real(e)) return; q_.value = s; grow(q_); q_.focus(); });
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
    // A run's actions, once its answer shows: an open that leaves the page ends them (the rest go with it).
    const perform = (list, li) => {
      if (li?.dataset.streaming !== undefined) { afterReveal.set(li, { list, epoch: actionEpoch }); return; }
      let first = null;
      for (let i = 0; i < list.length; i++) {
        const r = act(list[i], list.slice(i + 1));
        if (r === 'gone') return;
        if (r === 'here') continue;
        if (list[i]?.kind === 'highlight' && r) first ||= r;
      }
      if (first && li?.isConnected) {
        const b = make('button', { type: 'button', className: 'gz-ask-show' }, icon('down'), make('span', { textContent: t('Show on the page') }));
        b.addEventListener('click', (e) => { if (!real(e)) return; onShow?.(); first.scrollIntoView?.({ block: 'center', behavior: still() ? 'auto' : 'smooth' }); });
        li.querySelector('.gz-ask-acts')?.prepend(b);
      }
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
        let left = still() ? total : step;
        while (left > 0 && at < nodes.length) {
          const [n, full, block] = nodes[at], take = Math.min(left, full.length - n.data.length);
          if (block && waiting.delete(block)) block.hidden = false;
          n.data = full.slice(0, n.data.length + take);
          left -= take;
          if (n.data.length >= full.length) at++;
        }
        pin(true);
        if (at < nodes.length) reveals.set(li, requestAnimationFrame(tick));
        else {
          for (const b of waiting) b.hidden = false;
          delete li.dataset.streaming;
          const actions = afterReveal.get(li);
          afterReveal.delete(li);
          // The completed answer gets a paint before navigation can leave it. releaseView cancels this frame too.
          if (actions) reveals.set(li, requestAnimationFrame(() => { reveals.delete(li); if (li.isConnected && alive_ && actions.epoch === actionEpoch) perform(actions.list, li); }));
        }
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

    // ---- the context meter, and the turns folded into a summary ----------------------------------------------------------
    // The share of the model's window the request about to go takes (the worker's { used, window }), as a ring and its
    // percentage; its band in data-band (warm, warn). shown(null) hides it until the chat knows one.
    // exact: the share unrounded, which its band is read from (89.9% is still warm).
    const shown = (pct, exact = pct) => {
      const m = $('.gz-ask-meter');
      if (!m) return;
      m.hidden = pct === null;
      if (pct === null) return;
      m.dataset.band = exact >= METER.warn ? 'warn' : exact >= METER.warm ? 'warm' : '';
      const v = m.querySelector('.gz-ask-meter-v');
      if (v?.style) v.style.strokeDasharray = `${pct} 100`;
      m.querySelector('.gz-ask-meter-n').textContent = percent(pct);
      m.setAttribute('aria-label', t('{n}% of the context window used', { n: pct }));
    };
    const context = (ev, first) => {
      const used = Number(ev.used), window_ = Number(ev.window);
      if (!(Number.isFinite(used) && Number.isFinite(window_) && used >= 0 && window_ > 0)) return;
      const exact = Math.max(0, Math.min(100, (used / window_) * 100)), pct = Math.round(exact);
      if (first && (base === null || exact < base)) base = exact;
      shown(pct, exact);
    };
    // The worker folded turns into a summary: one line where they were, its summary inside, and later questions carry it.
    const folded = (a) => {
      const n = Number.isSafeInteger(a.turns) && a.turns > 0 ? a.turns : 0;
      if (typeof a.text !== 'string' || !a.text.trim() || !n) return;
      memo.summary = a.text.slice(0, LIMIT.summary);
      memo.folded = Math.min(turns.length, Math.max(memo.folded, sentFrom + n));
      const after = turns[memo.folded - 1]?.li;
      drop($('.gz-ask-fold'));
      if (!after?.isConnected) return;
      const line = make('li', { className: 'gz-ask-fold' }, make('details', {}, make('summary', {}, make('span', { textContent: t('Earlier messages summarized') })),
        make('div', { className: 'gz-ask-text gz-ask-md', dir: 'auto' }, ...markdown(memo.summary))));
      line.dataset.arrive = '';
      after.after(line);
      sizes?.observe(line);
    };

    // ---- a question's run: the thinking line, its tool cards, its end ----------------------------------------------------
    const busy = (yes) => {
      const l = log();
      drop(l?.querySelector('.gz-ask-busy'));
      if (yes && l) {
        const li = make('li', { className: 'gz-ask-busy' }, make('span', { className: 'gz-ask-mark' }, icon('rime')), make('span', { className: 'gz-ask-busy-words', textContent: t('Thinking…') }));
        li.setAttribute('aria-hidden', 'true');
        put(li);
      }
    };
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
      c.querySelector('.gz-ask-step-detail')?.remove();
      if (['done', 'fail'].includes(s.state) && typeof s.detail === 'string' && s.detail) c.append(make('p', { className: 'gz-ask-step-detail', textContent: s.detail.slice(0, 120), dir: 'auto' }));
      if (s.state === 'ask') c.append(make('p', { className: 'gz-ask-step-note', textContent: t('Waiting for your answer in Glaze’s window') }));
      if ([...run.cards.values()].some((x) => ['run', 'ask'].includes(x.dataset.state))) run.line.dataset.running = ''; else delete run.line.dataset.running;
      // While Glaze's window waits, its card says so: no thinking line under it.
      $('.gz-ask-busy')?.toggleAttribute('hidden', s.state === 'ask');
      pin();
    };
    const running = (yes) => {
      const stop_ = $('.gz-ask-stop'), go = $('.gz-ask-send'), fresh = $('.gz-ask-new');
      if (stop_) stop_.hidden = !yes;
      if (go) go.hidden = yes;
      if (go) go.disabled = yes;
      if (fresh) fresh.disabled = yes;
    };
    // The conversation so far, for a follow-up: the turns after the folded ones, the last LIMIT.turns of them.
    const history = () => {
      const open = turns.slice(memo.folded);
      sentFrom = memo.folded + Math.max(0, open.length - LIMIT.turns);
      return open.slice(-LIMIT.turns).map((x) => ({ question: x.question.slice(0, LIMIT.turn), answer: x.answer.slice(0, LIMIT.turn) }));
    };

    // Ask: the reservation before the storage read (stopping invalidates it), then the question in the conversation (unless
    // it is a try again of one shown), the run, its end.
    const ask = async ({ question: q, attempt = '', shown: again = false, sent, fired }) => {
      if (current || pending || !alive_) return;
      const mine = pending = {};
      actionEpoch++; afterReveal.clear();
      const allowed = await alive();
      if (pending !== mine || !alive_) return;
      pending = null;
      if (!allowed) return onOff?.();
      if (!again) question(attempt ? `${q}\n\n${attempt}` : q);
      sent?.();
      say(t('Thinking…'));
      running(true);
      busy(true);
      const run = { line: null, cards: null }, past = history(), queued = [], first = !past.length && !memo.summary;
      const site = ['canvas', 'ultra', 'moodle'].includes(ctx.site) ? ctx.site : undefined, words = pageText();
      const go = port.send({ op: 'ask', question: q, ...(attempt && { attempt }), locale: lang(), ...(past.length && { history: past }), ...(past.length && memo.summary && { summary: memo.summary }),
        ...(site && { site }), ...(words && { text: words }), ...(typeof fired === 'string' && { fired }) }, (ev) => {
        if (current !== go.id) return;
        if (ev.type === 'step') {
          card(run, ev.step);
          if (ev.step?.state === 'run') say(t('Reading your courses…'));
        } else if (ev.type === 'approve') say(t('Waiting for your answer in Glaze’s window'));
        else if (ev.type === 'context') context(ev, first);
        else if (ev.type === 'action' && ev.action && typeof ev.action === 'object') queued.push(ev.action);
      });
      current = lastAsk = go.id;
      const end = await go;
      if (current !== go.id) return;
      current = 0;
      running(false);
      busy(false);
      if (run.line) {
        delete run.line.dataset.running;
        for (const c of run.cards.values()) if (['run', 'ask'].includes(c.dataset.state)) {
          c.dataset.state = end.error === 'cancelled' ? 'no' : 'fail';
          c.querySelector('.gz-ask-step-mark').replaceChildren(icon(MARK[c.dataset.state]));
          c.querySelector('.gz-ask-step-note')?.remove();
        }
      }
      if (end.type === 'end') {
        say('');
        if (end.declined) answer(t('Nothing was changed.'));
        else if (end.task === 'study.help') {
          const reply = String(end.output?.reply || ''), more = String(end.output?.followUp || '');
          const li = answer(reply, more);
          turns.push({ question: q, answer: more ? `${reply}\n\n${more}` : reply, li });
        } else {
          const li = answer(String(end.answer?.text || ''));
          turns.push({ question: q, answer: String(end.answer?.text || ''), li });
          perform(queued, li);
        }
      } else if (['off', 'feature'].includes(end.error)) onOff?.();
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
          ask({ question: q, attempt, shown: true, fired });
        });
      }
      if (alive_ && root.isConnected && (dialog || root.contains(focused()))) q_.focus();
    };

    const submit = async (e) => {
      e.preventDefault();
      if (!real(e) || !activated() || current || pending || !alive_) return;
      const text = q_.value.trim(), attempt = work.hidden ? '' : work.value.trim();
      if (!text) return q_.focus();
      const questionValue = q_.value, workValue = work.value;
      await ask({ question: text, attempt, sent: () => {
        if (q_.value === questionValue) { q_.value = ''; grow(q_); }
        if (work.value === workValue) work.value = '';
      } });
    };
    const cancelRun = () => {
      if (current) port.post({ id: current, op: 'cancel' });
      current = 0; pending = null;
    };
    const clear = (e) => {
      if (!real(e) || current || pending || !alive_) return;
      lastAsk = 0; sentFrom = 0;
      port.hangUp();
      turns.length = 0;
      memo.summary = ''; memo.folded = 0;
      releaseView();
      log()?.replaceChildren(empty());
      if (sizes && log()) sizes.observe(log());
      shown(base === null ? null : Math.round(base), base);
      say('');
      follow = true;
      jumpShown();
      q_.focus();
    };

    // ---- the chat's elements -----------------------------------------------------------------------------------------------
    const fresh = button('gz-ask-new', 'plus', t('New chat'), t('New chat'));
    fresh.addEventListener('click', clear);
    const ring = document.createElementNS(SVG, 'svg');
    ring.setAttribute('viewBox', '0 0 36 36');
    ring.setAttribute('aria-hidden', 'true');
    ring.setAttribute('class', 'gz-ask-meter-ring');
    for (const cls of ['gz-ask-meter-t', 'gz-ask-meter-v']) {
      const c = document.createElementNS(SVG, 'circle');
      for (const [k, v] of [['class', cls], ['cx', '18'], ['cy', '18'], ['r', '15'], ['pathLength', '100'], ['transform', 'rotate(-90 18 18)']]) c.setAttribute(k, v);
      ring.append(c);
    }
    const meter = make('span', { className: 'gz-ask-meter', hidden: true }, ring, make('span', { className: 'gz-ask-meter-n' }));
    meter.setAttribute('role', 'img');
    const q_ = make('textarea', { rows: 1, maxLength: LIMIT.question, placeholder: t('Your question') });
    q_.setAttribute('aria-label', t('Your question'));
    q_.addEventListener('input', () => grow(q_));
    const work = make('textarea', { rows: 3, maxLength: LIMIT.attempt, placeholder: t('Your work'), hidden: true });
    work.setAttribute('aria-label', t('Your work'));
    const more = make('button', { type: 'button', className: 'gz-ask-more', textContent: t('Your work') });
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', (e) => {
      if (!real(e)) return;
      work.hidden = !work.hidden;
      more.setAttribute('aria-expanded', String(!work.hidden));
      (work.hidden ? q_ : work).focus();
    });
    q_.className = 'gz-ask-input';
    work.className = 'gz-ask-input gz-ask-work';
    if (dialog) { q_.id = 'gz-ask-q'; work.id = 'gz-ask-work'; more.setAttribute('aria-controls', 'gz-ask-work'); }
    const halt = button('gz-ask-stop', 'stop', t('Stop'));
    halt.hidden = true;
    halt.addEventListener('click', (e) => { if (real(e) && current) port.post({ id: current, op: 'cancel' }); });
    const go = button('gz-ask-send', 'send', t('Ask'));
    go.type = 'submit';
    go.addEventListener('click', submit);
    const form = make('form', { className: 'gz-ask-form' }, make('div', { className: 'gz-ask-composer' }, q_, work, make('div', { className: 'gz-ask-row' }, more, make('span', { className: 'gz-ask-gap' }), halt, go)));
    // requestSubmit() also creates a trusted SubmitEvent. Only the student's click or key may ask.
    form.addEventListener('submit', (e) => e.preventDefault());
    // Enter sends; Shift+Enter is a new line.
    q_.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) submit(e); });
    const list = make('ol', { className: 'gz-ask-log' }, empty());
    list.setAttribute('role', 'log');
    if (dialog) list.setAttribute('aria-labelledby', 'gz-ask-title'); else list.setAttribute('aria-label', t('Ask Rime'));
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
    const jump = button('gz-ask-jump', 'down', t('Jump to latest'));
    jump.hidden = true;
    jump.addEventListener('click', (e) => { if (!real(e)) return; follow = true; pin(); });
    let close = null;
    if (dialog) {
      close = button('gz-ask-close', 'close', t('Close'));
      close.addEventListener('click', (e) => { if (real(e)) onClose?.(); });
    }
    const head = make('header', { className: 'gz-ask-head' }, ...(dialog ? [make('span', { className: 'gz-ask-mark' }, icon('rime')), make('h2', { id: 'gz-ask-title', tabIndex: -1, textContent: t('Ask Rime') })] : []),
      make('span', { className: 'gz-ask-gap' }), meter, fresh, close);
    const status = make('p', { className: 'gz-ask-say' });
    status.setAttribute('role', 'status');
    root.append(head, make('div', { className: 'gz-ask-stage' }, list, jump), status, form);
    host.append(root);
    const shownAgain = () => { if (alive_ && !document.hidden) pin(true); };
    try { document.addEventListener('visibilitychange', shownAgain); } catch { /* no document events */ }

    // Where a run would stand now: no model chosen, or one not ready, said at once.
    const ready = port.send({ op: 'status' });
    ready.then((st) => {
      if (!alive_ || port.last() !== ready.id) return;
      if (st.type === 'status' && st.allowed === false) return onOff?.();
      if (st.type === 'status' && st.ready === false) { say(said(st.why)); log()?.prepend(make('li', { className: 'gz-ask-note' }, icon('warn'), make('p', { textContent: said(st.why) }))); }
    });

    // Gone: the run in flight cancelled, every frame, timer and observer released, the conversation and the port with it.
    const stop = () => {
      if (!alive_) return;
      cancelRun();
      alive_ = false;
      releaseView();
      sizes = null; written = -1;
      turns.length = 0; memo.summary = ''; memo.folded = 0;
      try { document.removeEventListener('visibilitychange', shownAgain); } catch { /* none */ }
      port.hangUp();
      root.remove();
    };
    return { root, focus: () => q_.focus(), ask: (o) => ask(o), stop, cancel: cancelRun, busy: () => !!(current || pending) };
  };

  return { mount, request, on: onAction, mark, still, real, activated, alive, read, enabled: on, icon, make, t, focused, STEPS, LOCALES, lang, LIMIT };
})();
GZ_ASK_CHAT;
