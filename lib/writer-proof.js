// Glaze Writer's proofing without a page: Harper's lints as issues (lib/writer-issues.js's shape), the sure fixes autocorrect
// makes as you type and the plugin that makes them (each fix its own undo step), the text Harper reads (each textblock,
// code left out) and the words a box's context adds to its dictionary. writer-proof.js draws it in the frame;
// lib/harper/shared.js runs Harper, once for the whole browser.
// GZ_WRITER_PROOF.decide: async ({ text, from, to, suggestions, context }) → 'apply' | 'suggest' | null, the AI stream's
// ruling on a fix that isn't sure (text: the paragraph, from/to: UTF-16 offsets into it). null: nobody rules.
// Classic script after lib/pm.js; module.exports for node.
var GZ_WRITER_PROOF = globalThis.GZ_WRITER_PROOF || (() => {
  const PM = typeof GZ_PM !== 'undefined' ? GZ_PM : (require('./writer-schema.js'), GZ_PM);
  const { Plugin, PluginKey } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const { closeHistory, undo, undoDepth } = PM.history;

  // ---- Harper's lints → issues ------------------------------------------------------------------------------------
  // Harper's kinds by how they are drawn: spelling and typos red, the rest amber.
  const KIND = {
    Spelling: 'spelling', Typo: 'spelling',
    Style: 'style', Redundancy: 'style', Enhancement: 'style', Readability: 'style', Formatting: 'style', Regionalism: 'style',
  };
  const kindOf = (k) => KIND[k] || 'grammar';
  // Sure: one suggestion, of a kind with no judgement in it (the 0d spike: 33 identical lints in three browsers).
  const SURE = new Set(['Typo', 'Capitalization', 'Repetition']);
  // Kinds a decision model may rule on when the lint isn't sure (their/there, a typo with two readings).
  const ASK = new Set(['Typo', 'Capitalization', 'Repetition', 'WordChoice', 'Eggcorn', 'Malapropism', 'Agreement', 'Grammar']);
  // A lint as the worker sends it, { start, end, kind, message, problem, suggestions: [{ k, t }] } (k: 0 replace, 1 remove,
  // 2 insert after) → { start, end, source, kind, rule, message, suggestions, sure }, each suggestion the span's new text.
  const toIssue = (l) => {
    const seen = new Set(), out = [];
    for (const s of l.suggestions || []) {
      // Edge spaces the problem doesn't have are noise ("They're" and "They're " are one suggestion).
      let v = s.k === 1 ? '' : s.k === 2 ? l.problem + s.t : s.t;
      if (s.k === 0 && typeof v === 'string') { if (!/^\s/.test(l.problem)) v = v.trimStart(); if (!/\s$/.test(l.problem)) v = v.trimEnd(); }
      if (typeof v === 'string' && v !== l.problem && !seen.has(v) && out.length < 6) { seen.add(v); out.push(v); }
    }
    return { start: l.start, end: l.end, source: 'harper', kind: kindOf(l.kind), rule: l.kind, message: String(l.message || '').slice(0, 300), suggestions: out, sure: SURE.has(l.kind) && out.length === 1 };
  };

  // ---- the text Harper reads --------------------------------------------------------------------------------------
  // Inside a textblock every character is one position: a hard break reads '\n', any other inline leaf (an image, a note
  // mark) ' ', so offset i is position pos + 1 + i. Code blocks are left out.
  const leaf = (n) => (n.type.name === 'hard_break' ? '\n' : ' ');
  const blockText = (node) => node.textBetween(0, node.content.size, null, leaf);
  // The whole document: textblocks joined by blank lines (Harper's paragraph break). → { text, blocks: [{ pos, start, end }],
  // posAt(i) }: pos is the block's position, start/end its offsets in text.
  const docText = (doc) => {
    let text = '';
    const blocks = [];
    doc.descendants((n, pos) => {
      if (!n.isTextblock) return true;
      if (n.type.spec.code) return false;
      if (blocks.length) text += '\n\n';
      const t = blockText(n);
      blocks.push({ pos, start: text.length, end: text.length + t.length });
      text += t;
      return false;
    });
    const posAt = (i) => {
      let lo = 0, hi = blocks.length - 1, b = blocks[0];
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (blocks[mid].start <= i) { b = blocks[mid]; lo = mid + 1; } else hi = mid - 1; }
      return b ? b.pos + 1 + Math.min(Math.max(i - b.start, 0), b.end - b.start) : 0;
    };
    return { text, blocks, posAt };
  };

  // ---- where a fix never goes ---------------------------------------------------------------------------------------
  // A token (the run between spaces) that is an address, a path, a handle, code or a number: www.teh.com, teh@x.edu, a_teh.
  const unsafe = (token) => /[@/\\_:#<>{}=|~^`$%&*+]|\d|\.\p{L}|^\p{L}+\.\p{L}/u.test(token) || /\p{Ll}\p{Lu}/u.test(token);
  // The textblock at pos is code, or the range carries a link.
  const guarded = (doc, from, to) => {
    const $from = doc.resolve(from);
    if ($from.parent.type.spec.code || $from.parent !== doc.resolve(to).parent) return true;
    let link = false;
    doc.nodesBetween(Math.max(from - 1, $from.start()), Math.min(to + 1, $from.end()), (n) => { if (n.isText && n.marks.some((m) => m.type.name === 'link')) link = true; });
    return link;
  };
  const sentenceStart = (before) => /(^|[.!?]["'”’)\]]*\s+)\s*$/.test(before) || /^\s*$/.test(before);

  // ---- sure fixes as you type ---------------------------------------------------------------------------------------
  // Typos with one reading, written for Glaze (MIT): transpositions and misspellings that are no English word. Words that
  // are words (form/from, its/it's, your/you're, wont, cant, ill) are not here: those are Harper's and the AI's to rule on.
  const R = '’';
  const TYPOS = Object.freeze({
    teh: 'the', hte: 'the', thw: 'the', tehy: 'they', tehre: 'there', adn: 'and', anf: 'and', taht: 'that', thta: 'that',
    waht: 'what', whta: 'what', wiht: 'with', wtih: 'with', iwth: 'with', thier: 'their', theri: 'their', wich: 'which',
    whcih: 'which', wehn: 'when', becuase: 'because', becasue: 'because', beacuse: 'because', abotu: 'about', jsut: 'just',
    knwo: 'know', konw: 'know', liek: 'like', peopel: 'people', poeple: 'people', shoudl: 'should', woudl: 'would',
    coudl: 'could', thnik: 'think', thign: 'thing', yuo: 'you', yoru: 'your', msut: 'must', smae: 'same', sicne: 'since',
    soem: 'some', tiem: 'time', wnat: 'want', aslo: 'also', alos: 'also', recieve: 'receive', recieved: 'received',
    recieves: 'receives', reciept: 'receipt', beleive: 'believe', beleived: 'believed', belive: 'believe', beleif: 'belief',
    definately: 'definitely', definatly: 'definitely', defintely: 'definitely', seperate: 'separate', seperately: 'separately',
    seperated: 'separated', occured: 'occurred', occurence: 'occurrence', occuring: 'occurring', ocurred: 'occurred',
    untill: 'until', alot: 'a lot', atleast: 'at least', aswell: 'as well', noone: 'no one', accomodate: 'accommodate',
    acheive: 'achieve', acheived: 'achieved', adress: 'address', agian: 'again', aginst: 'against', allready: 'already',
    arguement: 'argument', arguements: 'arguments', basicly: 'basically', begining: 'beginning', buisness: 'business',
    calender: 'calendar', cemetary: 'cemetery', collegue: 'colleague', comming: 'coming', commited: 'committed',
    completly: 'completely', concious: 'conscious', curiousity: 'curiosity', decieve: 'deceive', dissapoint: 'disappoint',
    embarass: 'embarrass', enviroment: 'environment', existance: 'existence', experiance: 'experience', familar: 'familiar',
    finaly: 'finally', foriegn: 'foreign', freind: 'friend', freinds: 'friends', frist: 'first', futher: 'further',
    goverment: 'government', grammer: 'grammar', happend: 'happened', harrass: 'harass', immediatly: 'immediately',
    independant: 'independent', interupt: 'interrupt', knowlege: 'knowledge', liason: 'liaison', libary: 'library',
    maintainance: 'maintenance', millenium: 'millennium', mispell: 'misspell', neccessary: 'necessary', necesary: 'necessary',
    noticable: 'noticeable', occassion: 'occasion', peice: 'piece', persistant: 'persistent', posession: 'possession',
    potatos: 'potatoes', prefered: 'preferred', publically: 'publicly', realy: 'really', reccomend: 'recommend',
    recomend: 'recommend', refered: 'referred', relevent: 'relevant', religous: 'religious', remeber: 'remember',
    responsability: 'responsibility', rythm: 'rhythm', sentance: 'sentence', similiar: 'similar', sincerly: 'sincerely',
    speach: 'speech', strenght: 'strength', succesful: 'successful', sucessful: 'successful', suprise: 'surprise',
    tommorow: 'tomorrow', tommorrow: 'tomorrow', tounge: 'tongue', truely: 'truly', unfortunatly: 'unfortunately',
    wierd: 'weird', writting: 'writing', yeild: 'yield', probaly: 'probably', probobly: 'probably', beautifull: 'beautiful',
    dont: `don${R}t`, doesnt: `doesn${R}t`, didnt: `didn${R}t`, isnt: `isn${R}t`, wasnt: `wasn${R}t`, arent: `aren${R}t`,
    werent: `weren${R}t`, havent: `haven${R}t`, hasnt: `hasn${R}t`, hadnt: `hadn${R}t`, couldnt: `couldn${R}t`,
    wouldnt: `wouldn${R}t`, shouldnt: `shouldn${R}t`, thats: `that${R}s`, whats: `what${R}s`, theyre: `they${R}re`,
    wouldve: `would${R}ve`, couldve: `could${R}ve`, shouldve: `should${R}ve`,
  });
  // Doubled on purpose: "had had", "that that", "ha ha".
  const TWICE = new Set(['had', 'that', 'ha', 'no', 'so', 'very', 'really', 'bye', 'blah', 'tsk', 'now', 'there', 'is', 'do', 'well', 'yes', 'knock', 'chop', 'tut']);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const WORD = /([\p{L}\p{M}'’]+)$/u;
  // before: the paragraph's text up to the caret, a boundary about to follow it. → { from, to, was, now, rule } (offsets
  // into before) or null. kept: lower-cased words (and '  ') the student took back; they stay as typed.
  const fix = (before, kept = new Set()) => {
    const m = WORD.exec(before);
    if (!m) return null;
    const word = m[1].replace(/^['’]+/, ''), to = before.length, from = to - word.length, ahead = before.slice(0, from);
    const token = (/(\S*)$/.exec(ahead)?.[1] || '') + word;
    if (!word || unsafe(token) || kept.has(word.toLowerCase())) return null;
    const lower = word.toLowerCase(), start = sentenceStart(ahead);
    // i, i'm, i'll, i'd, i've → I…
    if (/^i(['’](m|ll|d|ve))?$/.test(word)) return { from, to, was: word, now: 'I' + word.slice(1), rule: 'i' };
    // A doubled word, the second dropped: "the the" → "the".
    const prev = /([\p{L}\p{M}'’]+) $/u.exec(ahead);
    if (prev && prev[1].toLowerCase() === lower && !TWICE.has(lower) && !kept.has(`${lower} ${lower}`) && /\p{L}/u.test(lower) && (ahead.length === prev[0].length || /\s$/.test(ahead.slice(0, -prev[0].length)))) {
      return { from: from - prev[0].length, to, was: `${prev[1]} ${word}`, now: prev[1], rule: 'twice' };
    }
    if (!Object.hasOwn(TYPOS, lower)) return null;
    // As typed: lower case anywhere, Capitalised only where a sentence starts (elsewhere it may be a name).
    if (word === lower) return { from, to, was: word, now: TYPOS[lower], rule: 'typo' };
    if (word === cap(lower) && start) return { from, to, was: word, now: cap(TYPOS[lower]), rule: 'typo' };
    return null;
  };

  // ---- the words a box's context knows ----------------------------------------------------------------------------
  // Course name, prompt and instructions, assignment title, the names in the thread and the box's own people: added to
  // this box's dictionary so names and terms aren't flagged.
  const contextWords = (c) => {
    if (!c || typeof c !== 'object') return [];
    const str = (v) => (typeof v === 'string' ? v : '');
    const name = (p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? [p.name, p.given, p.family].map(str).join(' ') : '');
    const parts = [str(c.course?.name), str(c.prompt?.text), str(c.assignment?.title), str(c.assignment?.instructions), name(c.user), name(c.instructor), str(c.replyTo?.author)];
    if (Array.isArray(c.thread)) for (const m of c.thread.slice(0, 500)) parts.push(str(m?.author));
    const out = new Set();
    for (const w of parts.join(' ').slice(0, 200000).split(/[^\p{L}\p{M}'’-]+/u)) {
      const v = w.replace(/['’]s$/u, '').replace(/^['’-]+|['’-]+$/gu, '');
      if (v.length >= 2 && v.length <= 40 && /\p{L}/u.test(v)) out.add(v);
      if (out.size >= 2000) break;
    }
    return [...out];
  };

  // ---- the plugin: what was typed, the fixes made and their marks ---------------------------------------------------
  // State { ver, log: [{ ver, maps }], typed: [[from, to]], fixes: [{ id, from, to, was, now, rule }], kept: Set }.
  // ver counts document changes and log keeps their step maps, so a lint asked at one version lands at the right place
  // later (since()). Only text typed in this box is ever fixed, never what was loaded or pasted.
  const key = new PluginKey('gzProof');
  const LOG = 400, BOUNDARY = /^[ .,;:!?]$/;
  const mapRanges = (ranges, mapping) => ranges.map(([a, b]) => [mapping.map(a, -1), mapping.map(b, 1)]).filter(([a, b]) => b > a);
  const addRange = (ranges, a, b) => {
    const out = [];
    for (const r of ranges) { if (r[1] < a || r[0] > b) out.push(r); else { a = Math.min(a, r[0]); b = Math.max(b, r[1]); } }
    out.push([a, b]);
    return out.length > 200 ? out.slice(-200) : out;
  };
  const within = (ranges, a, b) => ranges.some((r) => r[0] <= a && b <= r[1]);
  let seq = 0;
  const plugin = (o = {}) => {
    let expect = null;
    const commit = (view, f) => { const made = commitFix(view, f); o.onFix?.(view, made); return true; };
    // The word before pos in its textblock, fixed if it is sure and was typed here.
    const tryFix = (view, pos) => {
      const st = key.getState(view.state), $pos = view.state.doc.resolve(pos);
      if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
      const start = $pos.start(), before = blockText($pos.parent).slice(0, $pos.parentOffset);
      const f = fix(before, st.kept);
      if (!f) return false;
      const from = start + f.from, to = start + f.to;
      if (!within(st.typed, from, to) || guarded(view.state.doc, from, to)) return false;
      return commit(view, { ...f, from, to });
    };
    return new Plugin({
      key,
      state: {
        init: () => ({ ver: 0, log: [], typed: [], fixes: [], kept: new Set(o.kept || []) }),
        apply(tr, v, _old, next) {
          const meta = tr.getMeta(key);
          let { ver, log, typed, fixes, kept } = v;
          if (tr.docChanged) {
            ver++;
            log = [...(log.length >= LOG ? log.slice(1 - LOG) : log), { ver, maps: tr.mapping.maps }];
            typed = mapRanges(typed, tr.mapping);
            const left = [];
            for (const f of fixes) {
              const from = tr.mapping.map(f.from, 1), to = tr.mapping.map(f.to, -1), now = to > from ? next.doc.textBetween(from, to, '\n', ' ') : '';
              if (now === f.now) left.push({ ...f, from, to });
              else if (now === f.was || (f.rule === 'space' && now === '  ')) { kept = new Set(kept); kept.add(f.was.toLowerCase()); }
            }
            fixes = left;
            if (expect) {
              const a = tr.mapping.map(expect, -1), b = next.selection.from;
              if (b > a) typed = addRange(typed, a, b);
              expect = null;
            }
          }
          if (meta?.fix) fixes = [...fixes.slice(-50), meta.fix];
          if (meta?.typed) typed = addRange(typed, meta.typed[0], meta.typed[1]);
          if (meta?.kept) { kept = new Set(kept); kept.add(meta.kept); }
          return ver === v.ver && log === v.log && typed === v.typed && fixes === v.fixes && kept === v.kept ? v : { ver, log, typed, fixes, kept };
        },
      },
      props: {
        decorations: (state) => {
          const { fixes } = key.getState(state);
          return fixes.length ? DecorationSet.create(state.doc, fixes.filter((f) => f.to > f.from).map((f) => Decoration.inline(f.from, f.to, { class: 'gz-ac', 'data-fix': f.id }, { fix: f.id }))) : DecorationSet.empty;
        },
        handleTextInput(view, from, to, text) {
          if (view.composing) return false;
          expect = from;
          if (!BOUNDARY.test(text) || from !== to) return false;
          const st = key.getState(view.state), $from = view.state.doc.resolve(from);
          if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
          // Two spaces → one.
          if (text === ' ' && !st.kept.has('  ') && $from.parentOffset > 1 && $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) === ' '
            && $from.parent.textBetween($from.parentOffset - 2, $from.parentOffset - 1) !== ' ' && within(st.typed, from - 1, from) && !guarded(view.state.doc, from - 1, from)) {
            expect = null;
            view.dispatch(view.state.tr.insertText(text, from, to).setMeta(key, { typed: [from, from + 1] }).scrollIntoView());
            return commit(view, { from: from - 1, to: from + 1, was: '  ', now: ' ', rule: 'space' });
          }
          const before = $from.parent.textBetween(0, $from.parentOffset, null, leaf), f = fix(before, st.kept);
          if (!f) return false;
          const a = $from.start() + f.from, b = $from.start() + f.to;
          if (!within(st.typed, a, b) || guarded(view.state.doc, a, b)) return false;
          // The boundary goes in as typing (its own undo group with the word), the fix after it as its own step.
          expect = null;
          view.dispatch(view.state.tr.insertText(text, from, to).setMeta(key, { typed: [from, from + text.length] }).scrollIntoView());
          return commit(view, { ...f, from: a, to: b });
        },
        handleKeyDown(view, e) {
          // Enter ends a word too: fixed once the new line is in, as its own step.
          if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || view.composing || !view.state.selection.empty) return false;
          const at = view.state.selection.from, ver = key.getState(view.state).ver;
          queueMicrotask(() => {
            const st = key.getState(view.state), m = st.log.filter((l) => l.ver > ver);
            if (!m.length || st.log[0]?.ver > ver + 1) return;
            let pos = at;
            for (const l of m) for (const sm of l.maps) pos = sm.map(pos, -1);
            tryFix(view, pos);
          });
          return false;
        },
      },
      view: () => ({ update: (view, prev) => o.onUpdate?.(view, prev) }),
    });
  };
  // The maps of every change after version ver, or null when they've left the log.
  const since = (state, ver) => {
    const st = key.getState(state);
    if (ver === st.ver) return [];
    if (!st.log.length || st.log[0].ver > ver + 1) return null;
    return st.log.filter((l) => l.ver > ver).flatMap((l) => l.maps);
  };
  const mapPos = (maps, pos, assoc) => { for (const m of maps) pos = m.map(pos, assoc); return pos; };
  // A sure Harper fix the student has typed past: applied as its own undo step, like the ones above. → fix or null.
  const autofix = (view, issue, now = issue.suggestions[0]) => {
    const st = key.getState(view.state), { from, to } = issue, doc = view.state.doc, caret = view.state.selection.head;
    if (typeof now !== 'string' || to <= from || to > doc.content.size) return null;
    const was = doc.textBetween(from, to, '\n', ' '), $to = doc.resolve(to);
    if (st.kept.has(was.toLowerCase()) || !within(st.typed, from, to) || guarded(doc, from, to)) return null;
    if (caret >= from && caret <= to || /[\p{L}\p{M}'’]/u.test($to.parent.textBetween($to.parentOffset, Math.min($to.parentOffset + 1, $to.parent.content.size)) || 'x')) return null;
    const $from = doc.resolve(from), before = $from.parent.textBetween(0, $from.parentOffset, null, leaf);
    const token = (/(\S*)$/.exec(before)?.[1] || '') + was + ($to.parent.textBetween($to.parentOffset, $to.parent.content.size, null, leaf).match(/^\S*/)?.[0] || '');
    if (unsafe(token.replace(/[.,;:!?"'”’)\]]+$/u, ''))) return null;
    // A capitalised word mid-sentence may be a name: only a capitalisation fix may touch it.
    if (issue.rule !== 'Capitalization' && /^\p{Lu}/u.test(was) && !sentenceStart(before)) return null;
    return commitFix(view, { from, to, was, now, rule: issue.rule || 'harper' });
  };
  // Which fix was the last change, per view: revert takes it back with the editor's own undo.
  const last = new WeakMap();
  const commitFix = (view, f) => {
    const id = `fix${++seq}`;
    view.dispatch(closeHistory(view.state.tr.insertText(f.now, f.from, f.to)).setMeta(key, { fix: { ...f, id, to: f.from + f.now.length } }));
    const st = key.getState(view.state);
    last.set(view, { id, ver: st.ver });
    return st.fixes.find((x) => x.id === id) || null;
  };
  // Take a fix back: the editor's own undo when it is the last change (one step), else the old text in its place. Either
  // way the word stays as typed from then on.
  const revert = (view, id) => {
    const st = key.getState(view.state), f = st.fixes.find((x) => x.id === id), l = last.get(view);
    if (!f) return false;
    if (l?.id === id && l.ver === st.ver && undoDepth(view.state)) return undo(view.state, (tr) => view.dispatch(tr));
    view.dispatch(view.state.tr.insertText(f.was, f.from, f.to).setMeta(key, { kept: f.was.toLowerCase() }));
    return true;
  };

  return {
    decide: null, key, KIND, SURE, ASK, TYPOS, TWICE, toIssue, kindOf, blockText, docText, unsafe, guarded, sentenceStart, fix,
    contextWords, plugin, since, mapPos, autofix, revert, within,
  };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_PROOF; else GZ_WRITER_PROOF;
