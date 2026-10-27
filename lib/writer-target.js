// Glaze Writer's targets: what a discussion prompt asks of a post, read on the device from its text. Words (a minimum, a
// maximum, a range, "a 300-word post"), sources ("cite two scholarly sources") and replies ("reply to two classmates"),
// each null unless the prompt says it plainly: a field it can't be sure of stays null, never a guess. A word or source
// count said of replies ("each reply at least 100 words") is kept apart, in `reply`. English first; a language is a RULES
// entry (its number words and phrase pieces), so another can follow without touching the matcher.
// Pure. Classic script, loaded on demand (lib/writer-context-discussion.js); module.exports for node.
var GZ_WRITER_TARGET = globalThis.GZ_WRITER_TARGET || (() => {
  const MAX_TEXT = 20000;
  const alt = (list) => list.join('|');

  // ---- English ---------------------------------------------------------------------------------------------------------
  // Every piece is a regex source over normalized text: lower case, plain hyphens, numbers as digits ("N").
  const EN = {
    units: { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 },
    tens: { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 },
    hundred: 'hundred', thousand: 'thousand', and: 'and',
    // "a" or "an" before a singular noun is one ("cite a source", "reply to a classmate").
    one: 'a|an|one',
    word: 'words?',
    min: alt(['at least', 'at minimum', 'a minimum of', 'minimum of', 'minimum', 'min\\.?', 'no fewer than', 'no less than', 'not fewer than', 'not less than', 'more than', 'over', 'upwards of', 'in excess of', 'a min\\.? of']),
    minAfter: alt(['or more', 'or longer', 'or greater', 'or above', 'minimum', 'min\\b\\.?', 'at (?:a )?minimum', 'at least', 'plus']),
    max: alt(['no more than', 'not more than', 'no longer than', 'not longer than', 'at most', 'at the most', 'a maximum of', 'maximum of', 'maximum', 'max\\.?', 'up to', 'fewer than', 'less than', 'under', 'within', 'not to exceed', 'not exceeding', 'exceeding', 'exceeds?', '(?:should|must|may|can|does|do|will|shall)(?: not|n\'t) exceed', 'never exceed', 'limited to', 'limit(?:ed)? of', 'a limit of', 'a max\\.? of']),
    maxAfter: alt(['or less', 'or fewer', 'or under', 'or shorter', 'maximum', 'max\\b\\.?', 'at (?:the )?most', 'limit', 'cap']),
    // Comparatives a penalty turns around: "posts under 250 words lose points" sets a minimum.
    flip: '^(?:fewer than|less than|under|more than|over|in excess of|exceeding)$',
    penalty: alt(['will not', 'won\'t', 'will lose', 'lose', 'loses', 'deduct', 'deduction', 'penali[sz]', 'no credit', 'partial credit', 'not (?:be )?(?:accepted|graded|counted|receive|earn)', 'not meet', 'insufficient', 'too (?:short|long)']),
    about: alt(['approximately', 'approx\\.?', 'about', 'around', 'roughly', '~', 'circa', 'close to', 'nearly']),
    // A bare "300 words" counts after these only ("respond in 300 words", "a post of 300 words").
    lead: alt(['write', 'writing', 'post', 'compose', 'submit', 'produce', 'in', 'of', 'be', 'contain', 'containing', 'using', 'totaling', 'totalling', 'length:?']),
    count: alt(['word count', 'word length', 'length']),
    limit: alt(['word limit', 'word maximum', 'word max', 'word cap', 'maximum word count', 'max\\.? word count', 'maximum length']),
    floor: alt(['minimum word count', 'min\\.? word count', 'word minimum', 'minimum length']),
    is: alt([' of', ' is', ':', ' should be', ' must be', ' =']),
    to: alt(['-', 'to']),
    between: alt(['between', 'from']),
    // Sources: what counts as one, and the verbs and adjectives that come with it.
    sourceNoun: alt(['sources?', 'references?', 'citations?', 'articles?', 'studies', 'study', 'works', 'texts?', 'readings?', 'resources?', 'journals?', 'books?', 'websites?', 'scholarly works?']),
    sourceStrong: alt(['sources?', 'references?', 'citations?', '(?:scholarly|peer-reviewed|academic) (?:articles?|journal articles?|works?|studies)']),
    sourceVerb: alt(['cite', 'cites', 'citing', 'reference', 'referencing', 'use', 'using', 'include', 'including', 'incorporate', 'incorporating', 'integrate', 'integrating', 'draw (?:on|from|upon)', 'support(?:ed)? (?:it |them |this |your (?:\\w+ ){0,2})?(?:with|by)', 'with', 'utilize', 'utilizing', 'refer to', 'consult', 'consulting', 'list']),
    sourceAdj: alt(['scholarly', 'academic', 'peer-reviewed', 'credible', 'reliable', 'reputable', 'outside', 'external', 'additional', 'different', 'separate', 'distinct', 'primary', 'secondary', 'research', 'library', 'online', 'print', 'published', 'relevant', 'course', 'textbook', 'other', 'appropriate', 'quality', 'high-quality', 'valid', 'authoritative', 'current', 'recent', 'apa', 'mla', 'apa-formatted', 'mla-formatted', 'properly', 'cited', 'formatted', 'in-text', 'journal', 'news', 'web', 'assigned', 'required', 'supporting']),
    sourceOf: '(?:of (?:the|our|your|these|this (?:week|module|unit)\'s) )',
    // Replies: the verbs, and who they go to.
    replyVerb: alt(['reply', 'replies', 'replying', 'respond', 'responds', 'responding', 'response', 'responses', 'comment', 'commenting', 'engage', 'engaging', 'interact', 'interacting', 'react', 'reacting']),
    replyTo: alt(['to', 'on', 'with']),
    replyOf: 'the (?:posts?|work|threads?|ideas) of',
    replyWho: alt(['classmates?', 'peers?', 'students?', 'learners?', 'colleagues?', 'people', 'persons?', 'individuals?', 'others', 'members', 'group ?mates?', 'team ?mates?', 'posts?', 'threads?', 'responses?', 'initial posts?']),
    replyWhoAdj: alt(['other', 'different', 'fellow', 'of your', 'of the', 'of their', 'of our', 'other student', 'classmates\'', 'peers\'', 'separate']),
    replyNoun: alt(['replies', 'responses', 'peer responses', 'peer replies', 'response posts', 'reply posts', 'follow-up posts', 'comments']),
    replyAdj: alt(['substantive', 'thoughtful', 'meaningful', 'substantial', 'separate', 'follow-up', 'additional', 'peer', 'quality', 'detailed', 'constructive', 'different']),
    // Who a count is said of: replies (cue) unless the clause names the student's own first post (own).
    cue: alt(['classmates?', 'classmates\'', 'peers?(?![-\\w])', 'peers\'', 'fellow students?', 'other students?', 'other students\'', 'replies', 'responses', 'each (?:reply|response|comment)', 'per (?:reply|response|comment)', '(?:repl(?:y|ying)|respond(?:ing)?|comment(?:ing)?) (?:to|on) (?:at least )?(?:\\d+|a|an|each|one|another|other)\\b(?! (?:prompt|question|topic|reading)s?\\b)']),
    each: alt(['each', 'apiece', 'per (?:person|classmate|peer)']),
    own: alt(['initial', 'original', 'main', 'first', 'primary', 'own']) + ' (?:post|response|thread|entry|submission|answer)',
    // A clause that opens a sentence ("When replying to classmates, …") and so scopes the rest of it.
    opener: alt(['when', 'while', 'in', 'for', 'after', 'as']),
    // Where a clause ends, for scoping a count to replies.
    clause: alt([',', ';', ' and ', ' but ', ' then ', ' while ', ' whereas ', '\\(', '\\)']),
  };
  const RULES = { en: EN };

  // ---- the matcher ---------------------------------------------------------------------------------------------------
  // Lower case, plain hyphens and quotes, numbers as digits ("two hundred and fifty" → 250, "1,000" → 1000).
  const digits = (L) => {
    const unit = Object.keys(L.units).join('|'), ten = Object.keys(L.tens).join('|');
    const small = `(?:(?:${ten})(?:[ -](?:${unit}))?|${unit})`;
    const sep = `[ -]+(?:${L.and}[ -]+)?`;
    const hundreds = `${small}[ -]+${L.hundred}(?:${sep}${small})?`;
    const full = new RegExp(`\\b(?:${small}[ -]+${L.thousand}(?:${sep}(?:${hundreds}|${small}))?|${hundreds}|${small})\\b`, 'g');
    const value = (s) => {
      let total = 0, cur = 0;
      for (const w of s.split(/[ -]+/)) {
        if (w === L.and) continue;
        if (w in L.units) cur += L.units[w];
        else if (w in L.tens) cur += L.tens[w];
        else if (w === L.hundred) cur = (cur || 1) * 100;
        else if (w === L.thousand) { total += (cur || 1) * 1000; cur = 0; }
      }
      return total + cur;
    };
    return (s) => s.replace(full, (m) => String(value(m)));
  };
  const normalizers = new Map();
  const normalize = (text, L) => {
    if (!normalizers.has(L)) normalizers.set(L, digits(L));
    return normalizers.get(L)(String(text).slice(0, MAX_TEXT).normalize('NFKC').toLowerCase()
      .replace(/[‐-―−]/g, '-').replace(/[‘’ʼ]/g, '\'').replace(/[“”]/g, '"')
      .replace(/\b(\d{1,3})(?:,(\d{3}))+\b/g, (m) => m.replace(/,/g, ''))
      .replace(/[ \t ]+/g, ' '));
  };

  // Examples and quoted text are evidence to discuss, not instructions. Ambiguous multi-part totals cannot be
  // represented by one target. Leave them empty rather than choosing one part (or inventing a sum).
  const instructions = (s) => {
    const blank = (m) => ' '.repeat(m.length);
    s = s.replace(/"[^"\n]*(?:"|$)|`[^`]*(?:`|$)|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])/gu, blank);
    if ((s.match(/\bpart\s+(?:\d+|[a-z])\s*:/g) || []).length > 1 || /\beach (?:of (?:the )?)?(?:\d+ )?parts?\b/.test(s)) return '';
    return s;
  };
  const uncertain = (s, x, counts = false) => {
    const sentence = s.slice(...sentenceOf(s, x.start));
    // These qualifiers change whether a count is required, what it measures, or whether it is per reply.
    if (/\b(?:examples?|for instance|optional|optionally|may|might|could|need not|(?:do|does|did|must|should|is|are) not (?!exceed)|don’t|don't|doesn't|isn't|aren't)\b/.test(sentence) || /\d\.\d/.test(sentence) || /\b(?:total|combined|altogether|across)\b.*\b(?:replies|responses)\b/.test(sentence)) return true;
    if (/\b(?:read|review|summarize|analyse|analyze)\b.*\b\d+[ -]words? (?:article|passage|excerpt|chapter|text|example)\b/.test(sentence)) return true;
    // sources/replies have only a minimum field; an upper bound must never masquerade as that minimum.
    return counts && /\b(?:no more than|at most|up to|maximum|max|fewer than|less than|under|or fewer|or less)\b/.test(sentence);
  };

  // Each rule: a regex with (?<a>N) and maybe (?<b>N), and what it says. Built once per language.
  const compiled = new Map();
  const compile = (L) => {
    if (compiled.has(L)) return compiled.get(L);
    const W = `\\s?-?\\s?(?:${L.word})\\b`;
    const n = (name) => `(?<${name}>\\d{1,5})`;
    const r = (src, type, rank) => ({ re: new RegExp(src, 'g'), type, rank });
    const words = [
      // A range, with both ends: the surest read.
      r(`\\b(?:(?:${L.between}) )?${n('a')}\\s?(?:${L.to})\\s?${n('b')}${W}`, 'range', 0),
      r(`\\bbetween ${n('a')}(?:${W})? and ${n('b')}${W}`, 'range', 0),
      r(`\\b${n('a')}${W} ?(?:${L.to}) ?${n('b')}${W}`, 'range', 0),
      r(`\\b(?:${L.min}) ${n('a')}(?:${W})?,? (?:and |but |to |, )?(?:${L.max}) ${n('b')}${W}`, 'range', 0),
      r(`\\b${n('a')}${W} (?:${L.minAfter}),? (?:and )?(?:a )?(?:${L.max}|maximum) (?:of )?${n('b')}(?:${W})?`, 'range', 0),
      r(`\\b${n('a')}${W} (?:minimum|min\\.?),? (?:and )?${n('b')} (?:maximum|max\\b\\.?)`, 'range', 0),
      r(`\\b(?:${L.count})(?:${L.is})? ?${n('a')}\\s?(?:${L.to})\\s?${n('b')}\\b`, 'range', 0),
      // One end.
      r(`(?<cue>\\b(?:${L.min})) ${n('a')}\\+?${W}`, 'min', 1),
      r(`\\b${n('a')}\\+?${W} (?:${L.minAfter})`, 'min', 1),
      r(`\\b${n('a')}\\+${W}`, 'min', 1),
      r(`\\b(?:${L.floor})(?:${L.is})? ?${n('a')}\\b`, 'min', 1),
      r(`\\b(?:${L.count})(?:${L.is})? ?(?:${L.min}) ${n('a')}\\b`, 'min', 1),
      r(`(?<cue>\\b(?:${L.max})) ${n('a')}${W}`, 'max', 1),
      r(`\\b${n('a')}${W} (?:${L.maxAfter})\\b`, 'max', 1),
      r(`\\b(?:${L.limit})(?:${L.is})? ?(?:${L.max} )?${n('a')}\\b`, 'max', 1),
      r(`\\b(?:${L.count})(?:${L.is})? ?(?:${L.max}) ${n('a')}\\b`, 'max', 1),
      // A size without a direction ("a 300-word post", "about 300 words"): a target, so a minimum.
      r(`\\b(?:${L.one}) ${n('a')}${W}`, 'target', 2),
      r(`(?:^|[\\s(])(?:${L.about}) ?${n('a')}${W}`, 'target', 2),
      r(`\\b(?:${L.lead}) ${n('a')}${W}`, 'target', 2),
      r(`\\b(?:${L.count})(?:${L.is}) ?${n('a')}\\b(?!\\s?(?:${L.to}))`, 'target', 2),
    ];
    const lo = `(?:(?:${L.min}) )?`, count = `(?<a>\\d{1,5}|${L.one})(?:\\s?(?:${L.to}|or)\\s?(?<b>\\d{1,5}))?(?: or more)?`;
    const sources = [
      r(`\\b(?:${L.sourceVerb}) ${lo}${count} ${L.sourceOf}?(?:(?:${L.sourceAdj}),? ){0,3}(?:${L.sourceNoun})\\b`, 'sources', 0),
      r(`\\b(?:${L.min}) (?<a>\\d{1,5})(?:\\s?(?:${L.to}|or)\\s?(?<b>\\d{1,5}))?(?: or more)? ${L.sourceOf}?(?:(?:${L.sourceAdj}),? ){0,3}(?:${L.sourceNoun})\\b`, 'sources', 0),
      r(`(?<!\\b(?:the|these|those|both|of the|all|read|review) )\\b(?<a>\\d{1,5})(?:\\s?(?:${L.to}|or)\\s?(?<b>\\d{1,5}))?\\+?(?: or more)? (?:(?:${L.sourceAdj}),? ){0,3}(?:${L.sourceStrong})\\b`, 'sources', 1),
    ];
    const replies = [
      r(`\\b(?:${L.replyVerb}) (?:${L.replyTo}) (?:${L.replyOf} )?${lo}${count} (?:(?:${L.replyWhoAdj}) ){0,2}(?:${L.replyWho})\\b`, 'replies', 0),
      r(`(?<!\\b(?:the|these|those|your|all) )\\b${lo}(?<a>\\d{1,5})(?:\\s?(?:${L.to}|or)\\s?(?<b>\\d{1,5}))?\\+?(?: or more)? (?:(?:${L.replyAdj}) ){0,2}(?:${L.replyNoun})\\b`, 'replies', 1),
    ];
    const out = {
      words, sources, replies,
      flip: new RegExp(L.flip), penalty: new RegExp(`\\b(?:${L.penalty})`),
      cue: new RegExp(`\\b(?:${L.cue})`), each: new RegExp(`\\b(?:${L.each})\\b`), own: new RegExp(`\\b(?:${L.own})\\b`), opener: new RegExp(`^\\s*(?:${L.opener})\\b`),
      clause: new RegExp(L.clause, 'g'), one: new RegExp(`^(?:${L.one})$`),
    };
    compiled.set(L, out);
    return out;
  };

  // Every match of a rule list, the surest first, none overlapping another.
  const scan = (s, rules) => {
    const all = [];
    for (const rule of rules) {
      rule.re.lastIndex = 0;
      for (const m of s.matchAll(rule.re)) all.push({ rule, m, start: m.index, end: m.index + m[0].length });
    }
    all.sort((x, y) => x.rule.rank - y.rule.rank || x.start - y.start || y.end - y.start - (x.end - x.start));
    const kept = [];
    for (const x of all) if (!kept.some((k) => x.start < k.end && k.start < x.end)) kept.push(x);
    return kept.sort((x, y) => x.start - y.start);
  };
  const sentenceOf = (s, at) => {
    let a = at, b = at;
    while (a > 0 && !/[.!?\n]/.test(s[a - 1]) || a > 1 && s[a - 1] === '.' && /\d/.test(s[a - 2]) && /\d/.test(s[a] || '')) a--;
    while (b < s.length && !/[.!?\n]/.test(s[b])) b++;
    return [a, b];
  };
  // The clause around a match: from the last boundary before it to the next after it, inside its sentence.
  const clauseOf = (s, x, C) => {
    const [a, b] = sentenceOf(s, x.start);
    let from = a, to = b;
    C.clause.lastIndex = 0;
    for (const m of s.slice(a, b).matchAll(C.clause)) {
      const i = a + m.index, j = i + m[0].length;
      if (j <= x.start) from = j;
      else if (i >= x.end) { to = i; break; }
    }
    return { clause: s.slice(from, to), sentence: s.slice(a, b), head: s.slice(a, from) };
  };
  // Whether a count is said of replies: its clause says so (and doesn't name the student's own post), or the sentence
  // opens with a clause that does ("When replying to classmates, write at least 100 words").
  const ofReplies = (s, x, C) => {
    const { clause, head } = clauseOf(s, x, C);
    if (C.own.test(clause)) return false;
    if (C.cue.test(clause)) return true;
    // "Respond to two classmates, each in 100 words or more."
    if (C.each.test(clause) && C.cue.test(s.slice(...sentenceOf(s, x.start)))) return true;
    const first = head.split(/[,;]/)[0];
    return !!head && C.opener.test(first) && C.cue.test(first) && !C.own.test(first);
  };

  const number = (v, C) => (v == null ? null : C.one.test(v) ? 1 : Number(v));
  // One value per field and scope, or null where the prompt says two different things.
  const settle = (list) => { const v = [...new Set(list)]; return v.length === 1 ? v[0] : null; };

  const words = (s, C) => {
    const got = { general: { min: [], max: [], target: [] }, reply: { min: [], max: [], target: [] } };
    for (const x of scan(s, C.words)) {
      if (uncertain(s, x)) continue;
      const g = x.m.groups, scope = ofReplies(s, x, C) ? got.reply : got.general;
      let type = x.rule.type;
      const a = Number(g.a), b = g.b == null ? null : Number(g.b);
      if (type === 'range') {
        // "2 to 300 words" is two numbers, not a range of lengths.
        if (!(a > 0 && b > a && a * 10 >= b)) continue;
        scope.min.push(a); scope.max.push(b);
        continue;
      }
      if (!(a > 0)) continue;
      if ((type === 'min' || type === 'max') && g.cue && C.flip.test(g.cue.trim()) && C.penalty.test(s.slice(x.end, sentenceOf(s, x.start)[1]))) type = type === 'min' ? 'max' : 'min';
      scope[type].push(a);
    }
    const side = (k) => {
      const min = settle(k.min) ?? (k.min.length ? null : settle(k.target)), max = settle(k.max);
      return min != null && max != null && min > max ? { min: null, max: null } : { min, max };
    };
    return { general: side(got.general), reply: side(got.reply) };
  };
  // The lowest of a range ("two or three sources": two).
  const counts = (s, C, rules, scoped) => {
    const got = { general: [], reply: [] };
    for (const x of scan(s, rules)) {
      if (uncertain(s, x, true)) continue;
      const v = number(x.m.groups.a, C);
      if (!(v > 0) || v > 50) continue;
      (scoped && ofReplies(s, x, C) ? got.reply : got.general).push(v);
    }
    return { general: settle(got.general), reply: settle(got.reply) };
  };

  // → { minWords, maxWords, sources, replies, reply: { minWords, maxWords, sources } }, each a number or null.
  const parse = (text, { lang = 'en' } = {}) => {
    const L = RULES[String(lang).toLowerCase().split(/[-_]/)[0]] || EN, C = compile(L);
    const s = instructions(normalize(typeof text === 'string' ? text : '', L));
    const w = words(s, C), src = counts(s, C, C.sources, true), rep = counts(s, C, C.replies, false);
    // A replies count read from a sentence about sources ("cite two responses") or the reverse can't be both.
    return {
      minWords: w.general.min, maxWords: w.general.max, sources: src.general, replies: rep.general,
      reply: { minWords: w.reply.min, maxWords: w.reply.max, sources: src.reply },
    };
  };
  // What one box answers to: a reply takes the replies' own counts where the prompt gives them, else the post's.
  const forKind = (req, kind) => {
    const r = req || {}, own = kind === 'reply' ? r.reply || {} : {};
    const pick = (k) => (own[k] != null ? own[k] : r[k] ?? null);
    const minWords = kind === 'reply' && (own.minWords != null || own.maxWords != null) ? own.minWords ?? null : pick('minWords');
    const maxWords = kind === 'reply' && (own.minWords != null || own.maxWords != null) ? own.maxWords ?? null : pick('maxWords');
    return { minWords, maxWords, sources: pick('sources'), replies: r.replies ?? null };
  };

  return { parse, forKind, normalize: (text, lang = 'en') => normalize(text, RULES[lang] || EN), RULES };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_TARGET;
GZ_WRITER_TARGET;
