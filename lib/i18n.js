// Glaze's own words in other languages. Classic script; module.exports for node.
//
// The English text is the key: t('Restore') is English as written, and each i18n/<lang>.js maps it
// to that language. A value is a string or, for a count, CLDR plural forms ({ one, other, … }) picked
// by Intl.PluralRules on vars.n. {name} fills from vars (numbers through Intl.NumberFormat);
// {name|lower} lowercases what fills it. Anything missing falls back to English.
const GZ_I18N = (() => {
  // English forms for keys that count. The key is the 'other' form.
  const EN = {
    '{n} items · {done} done': { one: '{n} item · {done} done', other: '{n} items · {done} done' },
    'Course progress: {done} of {n} items complete': { one: 'Course progress: {done} of {n} item complete', other: 'Course progress: {done} of {n} items complete' },
    '{n} new': { one: '{n} new', other: '{n} new' },
    '{n} new items': { one: '{n} new item', other: '{n} new items' },
    '{n} new grades: open the gradebook': { one: '{n} new grade: open the gradebook', other: '{n} new grades: open the gradebook' },
    '{n} new items: open the course': { one: '{n} new item: open the course', other: '{n} new items: open the course' },
    '{n} new items: show them': { one: '{n} new item: show it', other: '{n} new items: show them' },
    '{got} of {n} points': { one: '{got} of {n} point', other: '{got} of {n} points' },
    'With those scores: {pct} overall.': { one: 'With that score: {pct} overall.', other: 'With those scores: {pct} overall.' },
    'Out of reach: full marks on the {n} items left would make {pct}.': { one: 'Out of reach: full marks on the {n} item left would make {pct}.', other: 'Out of reach: full marks on the {n} items left would make {pct}.' },
    "You'd need about {pct} on each of the {n} items left.": { one: "You'd need about {pct} on the item left.", other: "You'd need about {pct} on each of the {n} items left." },
    'Saved {n} files': { one: 'Saved {n} file', other: 'Saved {n} files' },
    '{n} failed': { one: '{n} failed', other: '{n} failed' },
    '{n} unopened left out': { one: '{n} unopened left out', other: '{n} unopened left out' },
    '{n} fonts': { one: '{n} font', other: '{n} fonts' },
    '{n} settings': { one: '{n} setting', other: '{n} settings' },
    'Downloads {fonts} (web fonts).': { one: 'Downloads {fonts} (a web font).', other: 'Downloads {fonts} (web fonts).' },
    'Hides {n} parts of your school pages: {parts}.': { one: 'Hides {n} part of your school pages: {parts}.', other: 'Hides {n} parts of your school pages: {parts}.' },
    'Makes {n} parts of your school pages see-through: {parts}.': { one: 'Makes {n} part of your school pages see-through: {parts}.', other: 'Makes {n} parts of your school pages see-through: {parts}.' },
    'Changes how {n} parts of your school pages look: {parts}.': { one: 'Changes how {n} part of your school pages looks: {parts}.', other: 'Changes how {n} parts of your school pages look: {parts}.' },
    'Brings {n} course card styles for your Canvas Dashboard.': { one: 'Brings {n} course card style for your Canvas Dashboard.', other: 'Brings {n} course card styles for your Canvas Dashboard.' },
    '{n} card styles from a theme take turns on the cards that have no style of their own.': { one: '{n} card style from a theme takes turns on the cards that have no style of their own.', other: '{n} card styles from a theme take turns on the cards that have no style of their own.' },
    '{name}: {n} layers.': { one: '{name}: {n} layer.', other: '{name}: {n} layers.' },
    'Layers {n} animated backgrounds.': { one: 'Layers {n} animated background.', other: 'Layers {n} animated backgrounds.' },
    'Changes {n} animations.': { one: 'Changes {n} animation.', other: 'Changes {n} animations.' },
    'Plays effects for {n} events.': { one: 'Plays effects for {n} event.', other: 'Plays effects for {n} events.' },
    '{n} checks open': { one: '{n} check open', other: '{n} checks open' },
    '{n} pages': { one: '{n} page', other: '{n} pages' },
    '{n} words': { one: '{n} word', other: '{n} words' },
    '{n} papers': { one: '{n} paper', other: '{n} papers' },
    '{n} documents': { one: '{n} document', other: '{n} documents' },
    '{n} papers and documents': { one: '{n} paper or document', other: '{n} papers and documents' },
    "{n} paragraphs aren't double-spaced": { one: "{n} paragraph isn't double-spaced", other: "{n} paragraphs aren't double-spaced" },
    "{n} paragraphs have other line spacing": { one: "{n} paragraph has other line spacing", other: "{n} paragraphs have other line spacing" },
    'At least {n} words': { one: 'At least {n} word', other: 'At least {n} words' },
    'At most {n} words': { one: 'At most {n} word', other: 'At most {n} words' },
    'Reply to {n} classmates': { one: 'Reply to {n} classmate', other: 'Reply to {n} classmates' },
    'Cite {n} sources': { one: 'Cite {n} source', other: 'Cite {n} sources' },
    '{n} issues': { one: '{n} issue', other: '{n} issues' },
    'AI found {n} issues.': { one: 'AI found {n} issue.', other: 'AI found {n} issues.' },
    'Quotes of {n} words or more go in a block quote': { one: 'Quotes of {n} word or more go in a block quote', other: 'Quotes of {n} words or more go in a block quote' },
    '{n} tokens': { one: '{n} token', other: '{n} tokens' },
    '{n} models': { one: '{n} model', other: '{n} models' },
  };

  // The languages Glaze has besides English, one catalogue each in i18n/. The extension's own pages load them
  // all; a page on the LMS loads only its own, on demand (content.js), so one may not be in yet.
  const CODES = ['de', 'es', 'fr', 'nl', 'pt-BR'];
  const base = (l) => l.split('-')[0].toLowerCase();
  const canon = (tag) => { try { return Intl.getCanonicalLocales(tag || 'en')[0] || 'en'; } catch { return 'en'; } };
  // A language Glaze has, in any region: es-MX gets es; pt-PT gets pt-BR.
  const codeOf = (loc) => (CODES.includes(loc) ? loc : CODES.find((k) => base(k) === base(loc)));
  // The catalogue a page in `tag` needs: 'i18n/de.js', or null in English and in a language Glaze doesn't have.
  const file = (tag) => { const c = codeOf(canon(tag)); return c ? `i18n/${c}.js` : null; };

  // tag → [the locale Intl formats in, its catalogue]. Without one, English: words and numbers then stay one language.
  const picked = new Map();
  const pick = (tag) => {
    if (picked.has(tag)) return picked.get(tag);
    const loc = canon(tag);
    const code = codeOf(loc);
    const cat = code && globalThis.GZ_LANGS?.[code];
    const out = cat ? [loc, cat] : [base(loc) === 'en' ? loc : 'en', {}];
    // A catalogue that is still on its way isn't remembered as English.
    if (cat || !code) picked.set(tag, out);
    return out;
  };
  const locale = (tag) => pick(tag)[0];

  const memo = (make) => { const m = new Map(); return (k) => { if (!m.has(k)) m.set(k, make(k)); return m.get(k); }; };
  const plurals = memo((loc) => new Intl.PluralRules(loc));
  const nums = memo((loc) => new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }));
  const pcts = memo((loc) => new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 2 }));
  const num = (x, tag) => nums(locale(tag)).format(x);
  // 0-100 → "82.45%", "82,45 %".
  const pct = (x, tag) => pcts(locale(tag)).format(x / 100);

  const t = (key, vars = {}, tag) => {
    const [loc, cat] = pick(tag);
    let m = cat[key] ?? EN[key] ?? key;
    if (typeof m === 'object') m = m[plurals(key in cat ? loc : 'en').select(vars.n)] ?? m.other;
    return m.replace(/\{(\w+)(\|lower)?\}/g, (s, k, low) => {
      if (!(k in vars)) return s;
      const v = typeof vars[k] === 'number' ? num(vars[k], tag) : String(vars[k]);
      return low ? v.toLocaleLowerCase(loc) : v;
    });
  };

  // The browser's own language, for the editor and the popup.
  const ui = () => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language; } };

  // An extension page's own text, in `tag`: text nodes, titles, placeholders and aria-labels whose
  // English is a key. translate="no" keeps a subtree as it is.
  const page = (tag = ui()) => {
    const d = document;
    d.documentElement.lang = locale(tag);
    const say = (s) => {
      const k = s.trim().replace(/\s+/g, ' ');
      const v = k && t(k, {}, tag);
      return !k || v === k ? s : s.match(/^\s*/)[0] + v + s.match(/\s*$/)[0];
    };
    const kept = (el) => el.closest('[translate="no"], script, style');
    const walk = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!kept(n.parentElement)) n.data = say(n.data);
    for (const el of d.body.querySelectorAll('[title], [placeholder], [aria-label]')) {
      if (kept(el)) continue;
      for (const a of ['title', 'placeholder', 'aria-label']) if (el.hasAttribute(a)) el.setAttribute(a, say(el.getAttribute(a)));
    }
    d.title = say(d.title);
  };

  return { EN, CODES, file, t, locale, num, pct, ui, page };
})();

if (typeof module !== 'undefined') {
  const dir = require('path').join(__dirname, '../i18n');
  for (const f of require('fs').readdirSync(dir)) require(`${dir}/${f}`);
  module.exports = GZ_I18N;
}
