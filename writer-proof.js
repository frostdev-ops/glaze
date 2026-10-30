// Glaze Writer's proofing in the editor frame (writer.html), on GZ_WRITER_FRAME: Harper through the one shared worker
// (lib/harper/shared.js), started on the box's first focus; each changed paragraph linted as you type (~2 ms), the whole
// document on a pause; the issues in GZ_WRITER_ISSUES, drawn by its plugin; the hover card (mockup B "Suggestion"), the
// autocorrect pop with its Undo, and the issue count in the bar's issues slot. Alt+Enter opens the card at the caret.
// The student's dictionary is chrome.storage.local 'writerWords' (a list of words, the newest last), shared by every box;
// each box adds its context's words (course, prompt, names in the thread) to its own.
// Settings → Writer (lib/writer-settings.js): proofing on or off, the dialect Harper reads and the autocorrect classes
// (writer.autocorrect), each followed at once. Smart quotes and dashes and compose's Markdown shortcuts are
// lib/writer-editor.js's input rules, which read their settings themselves (ruleOff).
(() => {
  const F = globalThis.GZ_WRITER_FRAME, P = GZ_WRITER_PROOF, I = GZ_WRITER_ISSUES;
  if (!F) return;
  const { TextSelection } = GZ_PM.state;
  const DICT = 'writerWords', MAX_DICT = 5000, BLOCK_MS = 150, DOC_MS = 1500, FIX_MS = 4000;
  const t = (k, v) => F.t(k, v);
  const W = globalThis.GZ_WRITER_SETTINGS, pref = () => W?.now() || null;
  const proofOn = () => pref()?.proofing !== false;
  const allow = (cls) => pref()?.autocorrect?.[cls] !== false;
  const allowRule = (rule) => !P.CLASS?.[rule] || allow(P.CLASS[rule]);
  let view = null, port = null, started = false, ids = 0, seen = 0, dirty = [], blockTimer = 0, docTimer = 0;
  let context = [], dict = new Set();
  const pending = new Map(), asked = new Set(), stats = new Map();

  // ---- the shared worker ------------------------------------------------------------------------------------------
  // A worker that can't load (it errs before it answers) is given up for this box: no retry loop, the text stays.
  let broken = false, sharedFailed = false, worker = null, reconnectTimer = 0, stopped = false;
  const release = () => { if (port) { port.onmessage = null; port.close?.(); } worker?.terminate?.(); port = worker = null; };
  const replay = () => { if (connect()) for (const p of pending.values()) port.postMessage(p.msg); };
  const post = (m) => { if (connect()) port.postMessage(m); };
  const connect = () => {
    if (port || broken || stopped) return port;
    const fail = (e) => {
      const fallback = P.mode === 'shared' && !sharedFailed;
      release();
      if (fallback) { sharedFailed = true; replay(); return; }
      console.error('Glaze Writer: proofing is off here', e?.message || e);
      broken = true; pending.clear();
      for (const resolve of stats.values()) resolve(null);
      stats.clear();
    };
    try {
      if (!sharedFailed && typeof SharedWorker === 'function') {
        try {
          worker = new SharedWorker('lib/harper/shared.js', { type: 'module', name: 'glaze-harper' });
          worker.addEventListener('error', fail);
          port = worker.port;
          port.start();
          P.mode = 'shared';
        } catch { sharedFailed = true; }
      }
      if (!port) {
        worker = port = new Worker('lib/harper/shared.js', { type: 'module', name: 'glaze-harper' });
        port.addEventListener('error', fail);
        P.mode = 'worker';
      }
    } catch (e) { fail(e); return null; }
    port.onmessage = ({ data }) => onWorker(data);
    port.postMessage({ op: 'words', words: context });
    port.postMessage({ op: 'dialect', dialect: pref()?.dialect || 'en-US' });
    if (dict.size) port.postMessage({ op: 'dict', words: [...dict] });
    return port;
  };
  addEventListener('pagehide', () => {
    stopped = true; clearTimeout(reconnectTimer); clearTimeout(blockTimer); clearTimeout(docTimer);
    clearTimeout(hoverTimer); clearTimeout(leaveTimer); clearTimeout(fixTimer);
    port?.postMessage({ op: 'bye' }); release(); pending.clear();
    for (const resolve of stats.values()) resolve(null);
    stats.clear();
  });
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    stopped = false;
    if (started && proofOn()) { connect(); lintDoc(); } else { starting = false; if (view?.hasFocus()) start(); }
  });
  const onWorker = (m) => {
    if (!m) return;
    if (m.op === 'closing') {
      release();
      if (pending.size) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(replay, 25); }
      return;
    }
    if (m.op === 'stats') { stats.get(m.id)?.(m); stats.delete(m.id); return; }
    if (m.op !== 'lint') return;
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (!p || m.stale || m.error || !view || !Array.isArray(m.lints)) return;
    P.lastMs = m.ms;
    land(p, m.lints);
  };
  // The worker's id, its frames and loads (the browser check's proof that it is one).
  P.stats = () => new Promise((resolve) => { const id = ++ids; stats.set(id, resolve); post({ op: 'stats', id }); });

  // ---- asking ------------------------------------------------------------------------------------------------------
  const ask = (p, text) => {
    const id = ++ids;
    p.msg = { op: 'lint', id, key: p.key, text };
    pending.set(id, p);
    post(p.msg);
  };
  const ver = () => P.key.getState(view.state).ver;
  const lintBlocks = () => {
    blockTimer = 0;
    if (!view || stopped || !proofOn()) return;
    const doc = view.state.doc, done = new Set(), v = ver();
    for (const [a, b] of dirty) {
      doc.nodesBetween(Math.max(0, a - 1), Math.min(doc.content.size, b + 1), (n, pos) => {
        if (!n.isTextblock) return true;
        if (done.has(pos) || n.type.spec.code) return false;
        done.add(pos);
        const text = P.blockText(n);
        if (!text.trim()) I.set('harper', [], { from: pos, to: pos + n.nodeSize });
        else ask({ kind: 'block', key: `b${pos}`, ver: v, pos, size: n.nodeSize, text }, text);
        return false;
      });
    }
    dirty = [];
  };
  const lintDoc = () => {
    docTimer = 0;
    if (!view || stopped || !proofOn()) return;
    const d = P.docText(view.state.doc);
    if (!d.text.trim()) { I.clear('harper'); return; }
    ask({ kind: 'doc', key: 'doc', ver: ver(), d }, d.text);
  };
  const changed = (maps) => {
    const out = [];
    maps.forEach((m, k) => m.forEach((_a, _b, s, e) => { for (let j = k + 1; j < maps.length; j++) { s = maps[j].map(s, -1); e = maps[j].map(e, 1); } out.push([s, e]); }));
    return out;
  };
  // Every change: its ranges marked, a paragraph lint soon and a full one on a pause. Nothing else while typing.
  const onUpdate = (v, prev) => {
    if (v.state.doc === prev.doc) return;
    const maps = P.since(v.state, seen);
    seen = ver();
    if (!started || !proofOn()) return;
    if (!maps) dirty = [[0, v.state.doc.content.size]];
    else dirty = [...dirty.map(([a, b]) => [P.mapPos(maps, a, -1), P.mapPos(maps, b, 1)]), ...changed(maps)];
    if (!blockTimer) blockTimer = setTimeout(lintBlocks, BLOCK_MS);
    clearTimeout(docTimer);
    docTimer = setTimeout(lintDoc, DOC_MS);
    if (card.issue && !I.list().some((i) => i.id === card.issue.id)) closeCard();
    if (fixPop.fix && !P.key.getState(v.state).fixes.some((f) => f.id === fixPop.fix.id)) closeFix();
  };

  // ---- landing: lints → issues, then the sure fixes ---------------------------------------------------------------
  const land = (p, lints) => {
    const maps = P.since(view.state, p.ver);
    if (!maps) return;
    const doc = view.state.doc;
    // A spelling lint on a word that reads as a name (lib/writer-proof.js nameLike) is left out: the heading block's names
    // and a paper's people aren't misspellings (owner, 2026-10-27: "we are flagging names all over the place").
    const place = (l, base, text) => {
      const i = P.toIssue(l), from = P.mapPos(maps, base(l.start), 1), to = P.mapPos(maps, base(l.end), -1);
      if (to <= from || to > doc.content.size || doc.textBetween(from, to, '\n', ' ') !== l.problem) return null;
      const $from = doc.resolve(from);
      if ($from.parent === doc.resolve(to).parent && P.literalLike(P.blockText($from.parent), $from.parentOffset, $from.parentOffset + to - from)) return null;
      if (i.kind === 'spelling' && P.nameLike(text, l.start, l.end)) return null;
      return { ...i, from, to };
    };
    if (p.kind === 'block') {
      const from = P.mapPos(maps, p.pos, 1), to = P.mapPos(maps, p.pos + p.size, -1);
      const node = doc.nodeAt(from);
      if (to <= from || !node?.isTextblock || P.blockText(node) !== p.text) return;
      I.set('harper', lints.map((l) => place(l, (o) => p.pos + 1 + o, p.text)).filter(Boolean), { from, to });
      fixes(from, to);
      return;
    }
    const all = lints.map((l) => place(l, p.d.posAt, p.d.text)).filter(Boolean);
    if (!maps.length) I.set('harper', all);
    else {
      // Paragraphs changed since the ask keep what their own, newer lints found.
      const hit = changed(maps);
      for (const b of p.d.blocks) {
        const node = view.state.doc.nodeAt(P.mapPos(maps, b.pos, 1));
        const from = P.mapPos(maps, b.pos, 1), to = from + (node?.nodeSize || 0);
        if (!node || hit.some(([s, e]) => s <= to && e >= from)) continue;
        I.set('harper', all.filter((i) => i.from >= from && i.to <= to), { from, to });
      }
    }
    fixes(0, view.state.doc.content.size);
  };
  // Sure fixes the student typed past go in, each with its pop; unsure ones of a kind the AI may rule on are put to it
  // once (never on a test).
  const fixes = (from, to) => {
    const tried = new Set();
    for (let n = 0; n < 50; n++) {
      const i = I.list().find((x) => x.source === 'harper' && x.sure && !tried.has(x.id) && x.from >= from && x.to <= to + 64);
      if (!i) break;
      tried.add(i.id);
      if (!allowRule(i.rule)) continue;
      const made = P.autofix(view, i);
      if (made) showFix(made);
    }
    if (typeof P.decide !== 'function' || F.kind() === 'test') return;
    for (const i of I.list()) {
      const k = `${i.rule}\u0000${i.text}\u0000${i.from}`;
      if (i.source !== 'harper' || i.sure || !P.ASK.has(i.rule) || !i.suggestions.length || asked.has(k) || i.from < from || i.to > to + 64) continue;
      if (!P.within(P.key.getState(view.state).typed, i.from, i.to) || !P.finished(view.state, i.from, i.to)) continue;
      if (view.composing) continue;
      if (asked.size >= 500) asked.delete(asked.values().next().value);
      asked.add(k);
      rule(i);
    }
  };
  // The same bounded context the AI reads: source identity arriving is harmless; a changed prompt or thread isn't.
  const rulingContext = (c) => JSON.stringify(GZ_AI_WRITER.clean(c));
  const rule = async (i) => {
    const version = ver(), contextAtAsk = structuredClone(F.context()), contextKey = rulingContext(contextAtAsk);
    const $from = view.state.doc.resolve(i.from), start = $from.start();
    let said = null;
    try { said = await P.decide({ text: P.blockText($from.parent), from: i.from - start, to: i.to - start, suggestions: i.suggestions.slice(), context: contextAtAsk }); } catch (e) { console.error(e); }
    const v = P.verdict(said, i.suggestions.length), now = view && I.list().find((x) => x.id === i.id);
    if (stopped || view.composing || ver() !== version || rulingContext(F.context()) !== contextKey || !v || !now || now.suggestions[v.choice] !== i.suggestions[v.choice]) return;
    if (v.verdict === 'apply' && allowRule(now.rule)) { const made = P.autofix(view, now, now.suggestions[v.choice]); if (made) showFix(made); return; }
    // 'suggest': the choice first on the card.
    const list = now.suggestions.slice(), [pick] = list.splice(v.choice, 1), bare = (x) => ({ ...x, id: x.id.replace(/^harper:/, '') });
    const others = I.list().filter((x) => x.source === 'harper' && x.id !== now.id && x.from >= now.from && x.to <= now.to);
    I.set('harper', [...others.map(bare), { ...bare(now), suggestions: [pick, ...list] }], { from: now.from, to: now.to });
  };

  // ---- start, context and the dictionary --------------------------------------------------------------------------
  // The dictionary is read before anything is asked, so the worker has it first; what is typed meanwhile is in the
  // full lint that starts it.
  let starting = false;
  const start = async () => {
    if (starting || stopped || !proofOn()) return;
    starting = true;
    const saved = await words();
    if (stopped || !proofOn()) { starting = false; return; }
    dict = new Set([...dict, ...saved]);
    drop([...dict]);
    started = true;
    connect();
    lintDoc();
  };
  const store = () => { try { return chrome.storage.local; } catch { return null; } };
  const words = async () => {
    try { const v = (await store()?.get(DICT))?.[DICT]; return Array.isArray(v) ? v.filter((w) => typeof w === 'string').slice(-MAX_DICT) : []; } catch { return []; }
  };
  const addWord = async (w) => {
    w = w.trim();
    if (!w || w.length > 60) return;
    dict.add(w);
    post({ op: 'dict', words: [w] });
    drop([w]);
    const save = async () => {
      const list = (await words()).filter((x) => x.toLowerCase() !== w.toLowerCase());
      list.push(w);
      await store()?.set({ [DICT]: list.slice(-MAX_DICT) });
    };
    try {
      const locks = globalThis.navigator?.locks;
      if (locks) await locks.request('glaze-writer-words', save); else await save();
    } catch (e) { console.error(e); }
  };
  const drop = (list) => {
    if (view) view.dispatch(view.state.tr.setMeta(P.key, { words: [...context, ...dict] }).setMeta('addToHistory', false));
    const low = new Set(list.map((w) => w.toLowerCase()));
    for (const i of I.list()) if (i.source === 'harper' && i.kind === 'spelling' && low.has(i.text.toLowerCase())) I.ignore(i);
  };
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !c[DICT] || !Array.isArray(c[DICT].newValue)) return;
      // Words removed in Settings → Writer → Personal dictionary are unknown again, here and in the worker.
      const kept = new Set(c[DICT].newValue), gone = (Array.isArray(c[DICT].oldValue) ? c[DICT].oldValue : []).filter((w) => typeof w === 'string' && !kept.has(w) && dict.has(w));
      if (gone.length) {
        for (const w of gone) dict.delete(w);
        if (port) port.postMessage({ op: 'undict', words: gone });
        if (view) view.dispatch(view.state.tr.setMeta(P.key, { words: [...context, ...dict] }).setMeta('addToHistory', false));
        if (started && proofOn()) { clearTimeout(docTimer); docTimer = setTimeout(lintDoc, 50); }
      }
      const fresh = c[DICT].newValue.filter((w) => typeof w === 'string' && !dict.has(w));
      if (!fresh.length) return;
      for (const w of fresh) dict.add(w);
      if (port) port.postMessage({ op: 'dict', words: fresh });
      drop(fresh);
    });
  } catch { /* outside the extension */ }
  const seed = (c) => {
    context = P.contextWords(c);
    if (port) port.postMessage({ op: 'words', words: context });
    drop(context);
    if (started && proofOn()) { clearTimeout(docTimer); docTimer = setTimeout(lintDoc, 50); }
  };

  // ---- the card -------------------------------------------------------------------------------------------------------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const LABEL = { spelling: 'Spelling', grammar: 'Grammar', style: 'Style', format: 'Format', citation: 'Citation' };
  const card = Object.assign(el('div', 'pop gp-card'), { hidden: true });
  card.setAttribute('role', 'dialog');
  const fixPop = Object.assign(el('div', 'pop gp-fix'), { hidden: true });
  fixPop.setAttribute('role', 'status');
  const show = (pop, instant) => { if (!pop.hidden) return; pop.classList.toggle('gp-now', !!instant); pop.hidden = false; pop.getBoundingClientRect(); pop.setAttribute('data-open', ''); };
  const hide = (pop) => { pop.hidden = true; pop.removeAttribute('data-open'); };
  // Under the range where it fits, else over it, inside the frame.
  const place = (pop, from, to) => {
    let a, b;
    try { a = view.coordsAtPos(from); b = view.coordsAtPos(to, -1); } catch { return; }
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let top = Math.max(a.bottom, b.bottom) + 6;
    if (top + h > innerHeight - 3) top = Math.min(a.top, b.top) - h - 6;
    pop.style.left = `${Math.max(3, Math.min(a.left - 12, innerWidth - w - 3))}px`;
    pop.style.top = `${Math.max(3, top)}px`;
  };
  let hoverTimer = 0, leaveTimer = 0;
  const closeCard = (back) => { hide(card); card.issue = null; if (back) view?.focus(); };
  const openCard = (issue, keyboard) => {
    clearTimeout(leaveTimer);
    card.issue = issue;
    card.keyboard = !!keyboard;
    const label = t(LABEL[issue.kind] || 'Grammar');
    card.setAttribute('aria-label', label);
    const lbl = el('div', 'lbl');
    lbl.append(el('span', `dot gp-${I.look(issue.kind)}`), label);
    const parts = [lbl];
    if (issue.kind !== 'spelling' && issue.message) parts.push(el('div', 'why', issue.message));
    if (issue.suggestions.length) {
      const chips = el('div', 'chips');
      issue.suggestions.slice(0, 4).forEach((s, n) => {
        const b = el('button', n ? 'chip alt' : 'chip', s || t('Remove'));
        b.type = 'button';
        b.addEventListener('click', () => { const i = card.issue; closeCard(true); if (i) I.apply(i, n); });
        chips.append(b);
      });
      parts.push(chips);
    }
    const acts = el('div', 'acts');
    const act = (text, fn) => { const b = el('button', '', text); b.type = 'button'; b.addEventListener('click', () => { const i = card.issue; closeCard(true); if (i) fn(i); }); acts.append(b); };
    act(t('Ignore'), (i) => { if (i.source === 'harper') post({ op: 'ignore', kind: i.rule || '', problem: i.text, message: i.message }); I.ignore(i); });
    if (issue.kind === 'spelling' && issue.source === 'harper' && /^[\p{L}\p{M}'’-]+$/u.test(issue.text)) act(t('Add to dictionary'), (i) => addWord(i.text));
    parts.push(acts);
    card.replaceChildren(...parts);
    show(card);
    place(card, issue.from, issue.to);
    if (keyboard) card.querySelector('button')?.focus();
  };
  card.addEventListener('mousedown', (e) => e.preventDefault());
  card.addEventListener('mouseenter', () => clearTimeout(leaveTimer));
  card.addEventListener('mouseleave', () => { if (!card.keyboard) leaveTimer = setTimeout(() => closeCard(), 250); });
  card.addEventListener('keydown', (e) => {
    const bs = [...card.querySelectorAll('button')], k = bs.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeCard(true); } else if (/^Arrow(Right|Down|Left|Up)$/.test(e.key)) {
      e.preventDefault();
      bs[(k + (/Right|Down/.test(e.key) ? 1 : bs.length - 1)) % bs.length]?.focus();
    }
  });
  card.addEventListener('focusout', (e) => { if (!card.contains(e.relatedTarget)) closeCard(); });
  // Alt+Enter: the card for the issue at the caret, else the next one (from the top after the last).
  const openNext = () => {
    if (!view) return false;
    const at = view.state.selection.head, fix = fixPop.fix;
    if (!fixPop.hidden && fix && fix.from <= at && at <= fix.to + 1) { clearTimeout(fixTimer); fixPop.querySelector('button')?.focus(); return true; }
    const list = I.list();
    const i = list.find((x) => x.from <= at && at <= x.to) || list.find((x) => x.from > at) || list[0];
    if (!i) return false;
    if (!(i.from <= at && at <= i.to)) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, i.from)).scrollIntoView());
    openCard(i, true);
    return true;
  };

  // ---- the autocorrect pop --------------------------------------------------------------------------------------------
  let fixTimer = 0;
  const shown = (s) => s.replace(/ /g, '␣');
  const closeFix = () => { clearTimeout(fixTimer); hide(fixPop); fixPop.fix = null; };
  const showFix = (f, hover) => {
    if (!f || !view) return;
    clearTimeout(fixTimer);
    fixPop.fix = f;
    const undo = el('button', 'gp-undo', t('Undo'));
    undo.type = 'button';
    undo.addEventListener('click', () => { const x = fixPop.fix; closeFix(); if (x) P.revert(view, x.id); view.focus(); });
    const now = el('span', 'gp-now-text');
    now.append('→ ', f.rule === 'space' ? shown(f.now) : f.now);
    fixPop.replaceChildren(el('s', '', shown(f.was)), now, el('span', 'grow'), undo);
    hide(fixPop);
    show(fixPop, !hover);
    place(fixPop, f.from, f.to);
    fixTimer = setTimeout(closeFix, FIX_MS);
  };
  fixPop.addEventListener('mousedown', (e) => e.preventDefault());
  fixPop.addEventListener('focusin', () => clearTimeout(fixTimer));
  fixPop.addEventListener('focusout', (e) => { if (!fixPop.contains(e.relatedTarget)) fixTimer = setTimeout(closeFix, FIX_MS); });
  fixPop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeFix(); view?.focus(); } });
  fixPop.addEventListener('mouseenter', () => clearTimeout(fixTimer));
  fixPop.addEventListener('mouseleave', () => { if (!fixPop.contains(document.activeElement)) fixTimer = setTimeout(closeFix, 600); });

  // ---- the count in the bar -------------------------------------------------------------------------------------------
  const count = (list) => {
    const slot = F.slot('issues');
    if (!slot) return;
    const n = { sp: 0, gr: 0, fm: 0 };
    for (const i of list) n[I.look(i.kind)]++;
    if (!list.length) { slot.replaceChildren(); return; }
    const b = el('button', 'gp-count');
    b.type = 'button';
    b.title = t('{n} issues', { n: list.length });
    b.setAttribute('aria-label', b.title);
    for (const k of ['sp', 'gr', 'fm']) if (n[k]) { const s = el('span', 'gp-n'); s.append(el('span', `dot gp-${k}`), String(n[k])); b.append(s); }
    b.addEventListener('click', () => openNext());
    slot.replaceChildren(b);
  };
  I.on(count);

  // ---- wiring ---------------------------------------------------------------------------------------------------------
  F.plugin(P.plugin({ onFix: (_v, f) => showFix(f), onUpdate, allow }));

  // Proofing switched off: nothing more is asked and what was found goes; on again, the whole document is read.
  W?.follow((w, was) => {
    was ||= W.clean(undefined);
    if (w.proofing !== was.proofing) {
      if (!w.proofing) { clearTimeout(blockTimer); clearTimeout(docTimer); blockTimer = docTimer = 0; dirty = []; pending.clear(); I.clear('harper'); closeCard(); }
      else if (started) { connect(); lintDoc(); } else if (view?.hasFocus()) start();
    }
    if (w.dialect !== was.dialect) {
      pending.clear(); asked.clear(); I.clear('harper'); closeCard();
      port?.postMessage({ op: 'dialect', dialect: w.dialect });
      if (started && w.proofing) lintDoc();
    }
  });
  F.plugin(GZ_PM.keymap.keymap({ 'Alt-Enter': () => openNext() }));
  F.on('ready', (editor) => {
    view = editor.view;
    seen = ver();
    document.body.append(card, fixPop);
    seed(F.context());
    view.dom.addEventListener('focusin', start);
    if (view.hasFocus()) start();
    view.dom.addEventListener('mouseover', (e) => {
      const s = e.target.closest?.('.gz-iss, .gz-ac');
      clearTimeout(hoverTimer);
      if (!s) return;
      clearTimeout(leaveTimer);
      hoverTimer = setTimeout(() => {
        if (s.dataset.fix) { const f = P.key.getState(view.state).fixes.find((x) => x.id === s.dataset.fix); if (f && fixPop.fix?.id !== f.id) showFix(f, true); return; }
        const i = I.list().find((x) => x.id === s.dataset.issue);
        if (i && card.issue?.id !== i.id) openCard(i, false);
      }, 200);
    });
    view.dom.addEventListener('mouseout', (e) => {
      if (!e.target.closest?.('.gz-iss')) return;
      clearTimeout(hoverTimer);
      if (!card.hidden && !card.keyboard) leaveTimer = setTimeout(() => closeCard(), 250);
    });
    view.dom.addEventListener('keydown', (e) => { if (!card.hidden && !card.keyboard && e.key !== 'Alt') closeCard(); });
  });
  F.on('context', seed);
})();
