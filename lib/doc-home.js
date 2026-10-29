// The Documents home's pure rules (papers.html, papers.js): a row's shown title, what a search matches, the orders and
// course choices, which dropped files become documents, a document's flat text, and where an arrow key moves focus in the
// grid or the list. No DOM, no storage.
// Classic script; module.exports for node.
var GZ_DOC_HOME = globalThis.GZ_DOC_HOME || (() => {
  // Text as a search compares it: lower case, accents off, runs of space as one.
  const fold = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const terms = (q) => fold(q).split(' ').filter(Boolean);

  // A row's title: the student's (named), else the stored one (an assignment's, or a document's first line), else what the
  // record's first line says (derived), else the untitled name.
  const titleOf = (row, derived, untitled) => (row?.named ? String(row.title || '') : '') || String(row?.title || '') || derived || untitled;

  // Whether a row matches every term: true or false, or null while its body text is not known yet and its title and course
  // alone don't match. title: as shown; body: the document's flat text (flat below), or null.
  const matches = (row, title, words, body) => {
    if (!words.length) return true;
    const head = fold(`${title} ${row?.course || ''}`);
    if (words.every((w) => head.includes(w))) return true;
    if (body == null) return null;
    const all = `${head} ${fold(body)}`;
    return words.every((w) => all.includes(w));
  };

  // Rows in an order: 'updated' (last edited first) or 'title' (A to Z in the student's language, numbers by value), ties
  // newest first. titles: key → shown title.
  const sort = (rows, by, titles, locale) => {
    const c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const newest = (a, b) => (b.updated || 0) - (a.updated || 0);
    return [...rows].sort(by === 'title' ? (a, b) => c.compare(titles.get(a.key) || '', titles.get(b.key) || '') || newest(a, b) : newest);
  };

  // The Course filter's choices: each course name once, A to Z, and whether any row has none.
  const courses = (rows, locale) => {
    const c = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const names = [...new Set(rows.map((r) => String(r.course || '').trim()).filter(Boolean))].sort(c.compare);
    return { names, none: rows.some((r) => !String(r.course || '').trim()) };
  };
  // course: '' (all), NONE (rows without one) or a course's name.
  const NONE = '\u0000none';
  const inCourse = (row, course) => !course || (course === NONE ? !String(row.course || '').trim() : String(row.course || '').trim() === course);

  // Dropped or chosen files: the first `limit` that a kind opens and that fit its size cap become documents; the rest are
  // refused with why: 'type' (no kind opens it), 'size' (over the kind's cap) or 'count' (past the limit).
  // forFile(name) → kind id or null; kinds: id → { max }.
  const route = (files, forFile, kinds, limit = 20) => {
    const take = [], refused = [];
    for (const file of files) {
      const kind = forFile(file?.name);
      if (!kind || !kinds[kind]) refused.push({ file, why: 'type' });
      else if (!(file.size > 0) || file.size > kinds[kind].max) refused.push({ file, why: 'size' });
      else if (take.length >= limit) refused.push({ file, why: 'count' });
      else take.push({ file, kind });
    }
    return { take, refused };
  };
  // A file's name without its extension, as a new document's title.
  const stem = (name) => String(name || '').replace(/\.[^./\\]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 120);

  // A paper's text from its JSON: each textblock's text on its own line, a hard break a line too (GZ_WRITER_SCHEMA.text's
  // text, without building the document).
  const flat = (doc) => {
    const out = [];
    let line = null;
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (typeof n.text === 'string') { line = (line ?? '') + n.text; return; }
      if (n.type === 'hard_break') { out.push(line ?? ''); line = ''; return; }
      if (!Array.isArray(n.content)) return;
      const block = n.content.some((c) => c && (typeof c.text === 'string' || c.type === 'hard_break' || c.type === 'image' || c.type === 'footnote_ref'));
      if (block) { line = ''; for (const c of n.content) walk(c); out.push(line); line = null; return; }
      for (const c of n.content) walk(c);
    };
    walk(doc);
    if (line != null) out.push(line);
    return out.join('\n');
  };

  // Where focus goes from index i on a key: the grid moves by its column count up and down, the list by one; Home and End
  // to either end. → the new index, or null when the key isn't a move.
  const move = (i, key, count, cols = 1) => {
    if (!count) return null;
    const last = count - 1, at = Math.min(Math.max(0, i), last);
    switch (key) {
      case 'ArrowRight': return Math.min(last, at + 1);
      case 'ArrowLeft': return Math.max(0, at - 1);
      case 'ArrowDown': return at + cols <= last ? at + cols : at;
      case 'ArrowUp': return at - cols >= 0 ? at - cols : at;
      case 'Home': return 0;
      case 'End': return last;
      default: return null;
    }
  };

  return { fold, terms, titleOf, matches, sort, courses, NONE, inCourse, route, stem, flat, move };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOC_HOME; else GZ_DOC_HOME;
