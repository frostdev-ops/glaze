// Glaze Writer's proofing without a page: Harper's lints as issues (lib/writer-issues.js's shape), the sure fixes autocorrect
// makes as you type and the plugin that makes them (each fix its own undo step), the text Harper reads (each textblock,
// code left out) and the words a box's context adds to its dictionary. writer-proof.js draws it in the frame;
// lib/harper/shared.js runs Harper, once for the whole browser.
// GZ_WRITER_PROOF.decide: async ({ text, from, to, suggestions, context }) → 'apply' | 'suggest' | null, or { verdict: 'apply'
// | 'suggest' | 'keep', choice } (choice: an index into suggestions), the AI stream's ruling on a fix that isn't sure (text:
// the paragraph, from/to: UTF-16 offsets into it). 'apply' puts the choice in as autocorrect, 'suggest' moves it to the
// front of the card, 'keep' and null leave the issue as it is. null by default: nobody rules.
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
  // Sure: one suggestion, of a kind with no judgement in it (the 0d spike: 33 identical lints in three browsers), that is
  // what the kind promises: only the case changed, a repeat dropped, a typo a letter or two off with no word split
  // (Harper offers "arives" → "a rives" as its one Typo suggestion).
  const SURE = new Set(['Typo', 'Capitalization', 'Repetition']);
  const spaces = (s) => (s.match(/\s+/g) || []).length;
  // Optimal string alignment distance (a swap of neighbours is one edit), stopping past max.
  const distance = (a, b, max = 2) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p1 = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(p1[j] + 1, row[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], p2[j - 2] + 1);
      }
      if (Math.min(...row) > max) return max + 1;
      p2 = p1; p1 = row;
    }
    return p1[b.length];
  };
  const plausible = (rule, was, now) => {
    const a = was.toLowerCase(), b = now.toLowerCase();
    if (rule === 'Capitalization') return a === b && was !== now;
    if (rule === 'Repetition') return !TWICE.has(b.trim()) && a === `${b} ${b}` && !/^\p{Lu}/u.test(was.split(' ')[1]);
    return rule === 'Typo' && was === a && Object.hasOwn(TYPOS, a) && TYPOS[a] === now;
  };
  // The autocorrect class each fix is (Settings → Writer → Typing, writer.autocorrect): this file's own rules and Harper's
  // sure kinds. A plugin's allow(class) false leaves that class as typed.
  const CLASS = Object.freeze({ typo: 'typos', Typo: 'typos', i: 'capitalI', Capitalization: 'capitalI', twice: 'doubles', space: 'doubles', Repetition: 'doubles' });
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
    return { start: l.start, end: l.end, source: 'harper', kind: kindOf(l.kind), rule: l.kind, message: String(l.message || '').slice(0, 300), suggestions: out, sure: SURE.has(l.kind) && out.length === 1 && plausible(l.kind, l.problem, out[0]) };
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
  // Proofing sees plain text, so it needs the boundaries of addresses and identifiers even without link marks. Look
  // only at the surrounding token; a misspelling beside an address must still be checked.
  const literalLike = (text, start, end) => {
    let a = start, b = end;
    while (a > 0 && !/\s/u.test(text[a - 1])) a--;
    while (b < text.length && !/\s/u.test(text[b])) b++;
    const token = text.slice(a, b), inside = (m) => start >= a + m.index && end <= a + m.index + m[0].length;
    // Start only at a host/token boundary. Retrying at every label in a long dotted non-address is quadratic.
    const addresses = /(?<![\p{L}\p{N}.-])(?:(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>"“”]+|(?:[\p{L}\p{N}._%+-]+@)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}]{2,}(?::\d+)?(?:[/?#][^\s<>"“”]*)?)/giu;
    if ([...token.matchAll(addresses)].some(inside)) return true;
    // Course numbers (ENG1100-008), article numbers (e0001091) and other mixed identifiers aren't dictionary words.
    return [...token.matchAll(/[\p{L}\p{M}\p{N}]+(?:[-_–—][\p{L}\p{M}\p{N}]+)*/gu)]
      .some((m) => inside(m) && /\p{L}/u.test(m[0]) && /\p{N}/u.test(m[0]));
  };
  // A token (the run between spaces) that is an address, a path, a handle, code or a number: www.teh.com, teh@x.edu, a_teh.
  const unsafe = (token) => /[@/\\_:#<>{}=|~^`$%&*+]|\d|\.\p{L}|^\p{L}+\.\p{L}/u.test(token) || /\p{Ll}\p{Lu}/u.test(token);
  // The textblock at pos is code, or the range carries a link.
  const guarded = (doc, from, to) => {
    const $from = doc.resolve(from);
    if ($from.parent.type.spec.code || $from.parent !== doc.resolve(to).parent) return true;
    if (literalLike(blockText($from.parent), $from.parentOffset, $from.parentOffset + to - from)) return true;
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
    cemetary: 'cemetery', collegue: 'colleague', comming: 'coming', commited: 'committed',
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
    doesnt: `doesn${R}t`, didnt: `didn${R}t`, isnt: `isn${R}t`, wasnt: `wasn${R}t`, arent: `aren${R}t`,
    werent: `weren${R}t`, havent: `haven${R}t`, hasnt: `hasn${R}t`, hadnt: `hadn${R}t`, couldnt: `couldn${R}t`,
    wouldnt: `wouldn${R}t`, shouldnt: `shouldn${R}t`, thats: `that${R}s`, whats: `what${R}s`, theyre: `they${R}re`,
    wouldve: `would${R}ve`, couldve: `could${R}ve`, shouldve: `should${R}ve`,
  });
  // Doubled on purpose ("had had", "that that", "ha ha", "long long ago") or a word that is the pair ("mahi mahi", "so so").
  const TWICE = new Set(['had', 'that', 'ha', 'no', 'so', 'very', 'really', 'bye', 'blah', 'tsk', 'now', 'there', 'is', 'do', 'well', 'yes', 'knock', 'chop', 'tut',
    'long', 'far', 'many', 'much', 'more', 'come', 'go', 'hear', 'please', 'night', 'mahi', 'ylang', 'beri', 'pom', 'tom', 'tuk', 'cha', 'choo', 'boo',
    'aye', 'hip', 'la', 'ta', 'na', 'dum', 'oh', 'ah', 'uh', 'mm', 'hmm', 'ooh', 'wow', 'yeah', 'yay', 'hey', 'ho', 'hush', 'shh', 'tick', 'bang', 'boom', 'woof']);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const WORD = /([\p{L}\p{M}'’]+)$/u;
  // A lone i before '.', ',' or ')' may be i.e., a roman-numeral marker or a variable ("Let i, j"), not the pronoun.
  const notI = (word, next) => word === 'i' && /^[.,)]/.test(next || '');
  // before: the paragraph's text up to the caret, next the boundary about to follow it. → { from, to, was, now, rule }
  // (offsets into before) or null. kept: lower-cased words (and '  ') the student took back; they stay as typed.
  const fix = (before, kept = new Set(), next = ' ') => {
    const m = WORD.exec(before);
    if (!m) return null;
    const word = m[1].replace(/^['’]+/, ''), to = before.length, from = to - word.length, ahead = before.slice(0, from);
    const token = (/(\S*)$/.exec(ahead)?.[1] || '') + word;
    if (!word || unsafe(token) || /[-'’“”]$/.test(ahead) || kept.has(word.toLowerCase())) return null;
    const lower = word.toLowerCase(), start = sentenceStart(ahead);
    // i, i'm, i'll, i'd, i've → I…
    if (/^i(['’](m|ll|d|ve))?$/.test(word)) return notI(word, next) ? null : { from, to, was: word, now: 'I' + word.slice(1), rule: 'i' };
    // A doubled word, the second dropped: "the the" → "the". A Capitalised pair is a name ("Bora Bora", "Walla Walla").
    const prev = /([\p{L}\p{M}'’]+) $/u.exec(ahead), pre = prev ? ahead.slice(0, -prev[0].length) : '';
    if (prev && prev[1].toLowerCase() === lower && !TWICE.has(lower) && !kept.has(`${lower} ${lower}`) && /\p{L}/u.test(lower) && (!pre || /\s$/.test(pre))
      && !/^\p{Lu}/u.test(word) && (!/^\p{Lu}/u.test(prev[1]) || sentenceStart(pre))) {
      return { from: from - prev[0].length, to, was: `${prev[1]} ${word}`, now: prev[1], rule: 'twice' };
    }
    if (!Object.hasOwn(TYPOS, lower)) return null;
    // As typed: lower case anywhere, Capitalised only where a sentence starts (elsewhere it may be a name).
    if (word === lower) return { from, to, was: word, now: TYPOS[lower], rule: 'typo' };
    return null;
  };

  // A word Harper doesn't know that reads as a name, so its spelling lint is noise (Word and Docs know far more names, and
  // Word skips words in capitals): Capitalised away from a sentence start, in capitals, or at a sentence start where the
  // same word is Capitalised mid-sentence elsewhere or its line is a name line (a heading block's "Nicole Greene",
  // "Prof. Harris", a title: at most eight words, each Capitalised but for short joining words, no sentence end).
  const JOIN = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'de', 'la', 'van', 'von', 'y', 'e']);
  const nameLike = (text, start, end) => {
    const word = text.slice(start, end);
    if (!/^\p{Lu}[\p{L}\p{M}'’-]*$/u.test(word) || word === 'I') return false;
    if (/^[\p{Lu}\p{M}'’-]{2,}$/u.test(word) || !sentenceStart(text.slice(0, start))) return true;
    if (new RegExp(`[^.!?\\n]\\s+${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}])`, 'u').test(text)) return true;
    const line = text.slice(text.lastIndexOf('\n', start - 1) + 1, text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end)).trim();
    const words = line.split(/\s+/);
    return words.length <= 8 && !/[!?]|\.\s|\.$/.test(line.replace(/\b\p{Lu}[\p{Ll}]{0,4}\./gu, '')) && words.every((w) => JOIN.has(w.toLowerCase()) || /^["“‘'(]?\p{Lu}/u.test(w) || /^\d/.test(w));
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
    for (const w of parts.join(' ').slice(0, 200000).split(/[^\p{L}\p{M}\p{N}'’-]+/u)) {
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
  // Only unchanged characters retain provenance. Inserts (including paste/undo) split a typed range; replacements
  // remove their old coverage. A later handleTextInput explicitly adds the characters actually typed.
  const mapRanges = (ranges, mapping) => {
    for (const map of mapping.maps) {
      const cuts = [];
      map.forEach((a, b) => cuts.push([a, b]));
      const out = [];
      for (const [a, b] of ranges) {
        let at = a;
        for (const [s, e] of cuts) {
          if (e < at || s > b) continue;
          if (s > at) out.push([map.map(at, 1), map.map(Math.min(s, b), -1)]);
          at = Math.max(at, e);
        }
        if (at < b) out.push([map.map(at, 1), map.map(b, -1)]);
      }
      ranges = out.filter(([a, b]) => b > a);
    }
    return ranges;
  };
  const addRange = (ranges, a, b) => {
    const out = [];
    for (const r of ranges) { if (r[1] < a || r[0] > b) out.push(r); else { a = Math.min(a, r[0]); b = Math.max(b, r[1]); } }
    out.push([a, b]);
    return out.length > 200 ? out.slice(-200) : out;
  };
  const within = (ranges, a, b) => ranges.some((r) => r[0] <= a && b <= r[1]);
  let seq = 0;
  const marks = new WeakMap();
  const plugin = (o = {}) => {
    let expect = null;
    const allowed = (rule) => !CLASS[rule] || o.allow?.(CLASS[rule]) !== false;
    const commit = (view, f) => { const made = commitFix(view, f); o.onFix?.(view, made); return true; };
    // The word before pos in its textblock, fixed if it is sure and was typed here.
    const tryFix = (view, pos) => {
      const st = key.getState(view.state), $pos = view.state.doc.resolve(pos);
      if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return false;
      const start = $pos.start(), before = blockText($pos.parent).slice(0, $pos.parentOffset);
      const f = fix(before, st.kept, '\n');
      if (!f || !allowed(f.rule) || st.words.has(f.was.toLowerCase())) return false;
      const from = start + f.from, to = start + f.to;
      if (!within(st.typed, from, to) || guarded(view.state.doc, from, to)) return false;
      return commit(view, { ...f, from, to });
    };
    return new Plugin({
      key,
      state: {
        // line: one per state made from scratch (a document replaced whole), whose versions count from 0 again.
        init: () => ({ ver: 0, line: {}, log: [], typed: [], fixes: [], kept: new Set(o.kept || []), words: new Set((o.words || []).map((w) => w.toLowerCase())) }),
        apply(tr, v, _old, next) {
          const meta = tr.getMeta(key);
          let { ver, log, typed, fixes, kept, words } = v;
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
            // The change a keystroke made (as typed, or as an input rule rewrote it); never a paste or a drop.
            if (expect !== null && !tr.getMeta('uiEvent')) {
              const b = next.selection.from, a = b - expect.text.length;
              const left = tr.mapping.map(expect.from, -1), right = tr.mapping.map(expect.to, 1);
              if (a >= left && b <= right && b > a && b <= next.doc.content.size && expect.text.length <= 64 && next.doc.textBetween(a, b, '\n', ' ') === expect.text && next.selection.from === b) typed = addRange(typed, a, b);
            }
            expect = null;
          }
          if (meta?.fix) fixes = [...fixes.slice(-50), meta.fix];
          if (meta?.typed) typed = addRange(typed, meta.typed[0], meta.typed[1]);
          if (meta?.kept) { kept = new Set(kept); kept.add(meta.kept); }
          if (meta?.words) words = new Set(meta.words.map((w) => w.toLowerCase()));
          return words === v.words && ver === v.ver && log === v.log && typed === v.typed && fixes === v.fixes && kept === v.kept ? v : { ver, line: v.line, log, typed, fixes, kept, words };
        },
      },
      props: {
        // Made again only when the fixes change (every document change maps them into a new list).
        decorations: (state) => {
          const { fixes } = key.getState(state);
          if (!fixes.length) return DecorationSet.empty;
          if (!marks.has(fixes)) marks.set(fixes, DecorationSet.create(state.doc, fixes.filter((f) => f.to > f.from).map((f) => Decoration.inline(f.from, f.to, { class: 'gz-ac', 'data-fix': f.id }, { fix: f.id }))));
          return marks.get(fixes);
        },
        handleTextInput(view, from, to, text) {
          if (view.composing) { expect = null; return false; }
          expect = { from, to, text };
          if (!BOUNDARY.test(text) || from !== to) return false;
          const st = key.getState(view.state), $from = view.state.doc.resolve(from);
          if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
          // Two spaces → one.
          if (text === ' ' && allowed('space') && !st.kept.has('  ') && $from.parentOffset > 1 && $from.parent.textBetween($from.parentOffset - 1, $from.parentOffset) === ' '
            && $from.parent.textBetween($from.parentOffset - 2, $from.parentOffset - 1) !== ' ' && within(st.typed, from - 1, from) && !guarded(view.state.doc, from - 1, from)) {
            expect = null;
            view.dispatch(view.state.tr.insertText(text, from, to).setMeta(key, { typed: [from, from + 1] }).scrollIntoView());
            return commit(view, { from: from - 1, to: from + 1, was: '  ', now: ' ', rule: 'space' });
          }
          const before = $from.parent.textBetween(0, $from.parentOffset, null, leaf), f = fix(before, st.kept, text);
          if (!f || !allowed(f.rule) || st.words.has(f.was.toLowerCase())) return false;
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
      view: (view) => { o.onView?.(view); return { update: (view, prev) => o.onUpdate?.(view, prev) }; },
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
  // The student has typed past from–to: the caret is elsewhere and what follows isn't more of the word.
  const finished = (state, from, to) => {
    const caret = state.selection.head, $to = state.doc.resolve(to);
    if (caret >= from && caret <= to) return false;
    return !/[\p{L}\p{M}'’]/u.test($to.parent.textBetween($to.parentOffset, Math.min($to.parentOffset + 1, $to.parent.content.size)) || 'x');
  };
  // A sure Harper fix the student has typed past: applied as its own undo step, like the ones above. → fix or null.
  const autofix = (view, issue, now = issue.suggestions[0]) => {
    const st = key.getState(view.state), { from, to } = issue, doc = view.state.doc;
    if (view.composing || typeof now !== 'string' || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > doc.content.size) return null;
    const was = doc.textBetween(from, to, '\n', ' '), $to = doc.resolve(to);
    if ((typeof issue.text === 'string' && issue.text !== was) || (st.kept.has(was.toLowerCase()) || st.words.has(was.toLowerCase())) || !within(st.typed, from, to) || guarded(doc, from, to)) return null;
    if (!finished(view.state, from, to)) return null;
    const $from = doc.resolve(from), before = $from.parent.textBetween(0, $from.parentOffset, null, leaf);
    const token = (/(\S*)$/.exec(before)?.[1] || '') + was + ($to.parent.textBetween($to.parentOffset, $to.parent.content.size, null, leaf).match(/^\S*/)?.[0] || '');
    if (unsafe(token.replace(/[.,;:!?"'”’)\]]+$/u, ''))) return null;
    // A capitalised word may be a name. Capitalisation is safe only at a sentence start or for English i.
    if (issue.rule !== 'Capitalization' && /^\p{Lu}/u.test(was) && !sentenceStart(before)) return null;
    if (issue.sure && issue.rule === 'Typo' && /^\p{Lu}/u.test(was)) return null;
    if (issue.sure && issue.rule === 'Capitalization' && !sentenceStart(before) && !/^i(['’](m|ll|d|ve))?$/.test(was)) return null;
    if (issue.rule === 'Capitalization' && notI(was, $to.parent.textBetween($to.parentOffset, Math.min($to.parentOffset + 1, $to.parent.content.size)))) return null;
    return commitFix(view, { from, to, was, now, rule: issue.rule || 'harper' });
  };
  // Which fix was the last change, per view: revert takes it back with the editor's own undo.
  const last = new WeakMap();
  const commitFix = (view, f) => {
    const id = `fix${++seq}`;
    view.dispatch(closeHistory(view.state.tr.insertText(f.now, f.from, f.to)).setMeta(key, { fix: { ...f, id, to: f.from + f.now.length } }));
    view.dispatch(closeHistory(view.state.tr));
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

  // decide's answer → { verdict: 'apply'|'suggest', choice } with a valid choice, or null (keep, or nothing usable).
  const verdict = (said, n) => {
    const v = typeof said === 'string' ? { verdict: said, choice: 0 } : said && typeof said === 'object' ? said : null;
    if (!v || (v.verdict !== 'apply' && v.verdict !== 'suggest')) return null;
    const choice = v.choice === undefined ? 0 : v.choice;
    return Number.isInteger(choice) && choice >= 0 && choice < n ? { verdict: v.verdict, choice } : null;
  };

  return {
    decide: null, verdict, key, KIND, SURE, ASK, CLASS, TYPOS, TWICE, toIssue, kindOf, plausible, distance, blockText, docText, unsafe, guarded, sentenceStart, fix,
    contextWords, nameLike, literalLike, plugin, since, mapPos, autofix, revert, within, finished,
  };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_PROOF; else GZ_WRITER_PROOF;
