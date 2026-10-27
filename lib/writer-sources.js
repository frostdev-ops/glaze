// Glaze Writer's sources: what a student cites, as a CSL-JSON subset (docs/ai-harness.md's writer.cite fills the same
// shape), checked and cleaned here before anything formats or stores it, told apart from each other (dedupe), and kept
// in storage.local per box: `writer:sources:<school>|<user>|<course>|<item>`, each part URI-encoded. A box whose context
// lacks a part keeps its sources for the frame's life only. No DOM; classic script; module.exports for node.
//   source = { id, type, title, title-short, author|editor|translator: [{ family, given } | { literal }],
//              issued|accessed: { date-parts: [[y, m?, d?]], season? }, container-title, publisher, publisher-place,
//              volume, issue, page, edition, number, genre, archive, medium, dimensions, DOI, ISBN, URL }
// Titles may hold <i>…</i> (a ship's name in an article title); every other character is text.
var GZ_WRITER_SOURCES = globalThis.GZ_WRITER_SOURCES || (() => {
  // An edited book is a book with editors and no author; an online video is CSL's motion_picture.
  const TYPES = ['book', 'chapter', 'article-journal', 'article-magazine', 'article-newspaper', 'webpage', 'motion_picture', 'report'];
  // Crossref's and others' names for the same things (doi.org's CSL-JSON says journal-article, book-chapter, …).
  const ALIAS = { 'journal-article': 'article-journal', article: 'article-journal', 'book-chapter': 'chapter', 'edited-book': 'book', monograph: 'book',
    'reference-book': 'book', 'post-weblog': 'webpage', post: 'webpage', 'article-news': 'article-newspaper', video: 'motion_picture', broadcast: 'motion_picture',
    'report-component': 'report', standard: 'report', thesis: 'report', dataset: 'report', 'posted-content': 'report' };
  const TEXT = ['title', 'title-short', 'container-title', 'publisher', 'publisher-place', 'volume', 'issue', 'page', 'edition', 'number', 'genre', 'archive', 'medium', 'dimensions'];
  const NAMES = ['author', 'editor', 'translator'];
  const MAX = { text: 600, names: 60, sources: 300 };
  const SEASONS = ['spring', 'summer', 'fall', 'winter'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const clean = (v, max = MAX.text) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '')
    .replace(/[\u0000-\u001f\u007f\u200b\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  // <i> and </i> stay, balanced; any other tag goes (a fetched title may carry <sub>, <b>, <span …>).
  const rich = (v) => {
    // A title's footnote mark (Crossref's JATS <sup>1</sup>) is no part of it.
    let s = clean(v).replace(/<sup\b[^>]*>[^<]{0,8}<\/sup>/gi, '').replace(/<(\/?)(?:i|em)(?:\s[^>]*)?>/gi, '\u0001$1\u0002').replace(/<\/?[a-z][^>]*>/gi, '');
    let open = false;
    s = s.replace(/\u0001(\/?)\u0002/g, (_, c) => { if (!c && !open) { open = true; return '<i>'; } if (c && open) { open = false; return '</i>'; } return ''; });
    return open ? `${s}</i>` : s;
  };

  // ---- names --------------------------------------------------------------------------------------------------------
  // A group's name (a school, an agency, a company, a channel) is one literal, never split into family and given.
  const GROUP = /\b(university|universit[éy]|college|school|institute|institution|organi[sz]ation|association|society|bureau|department|ministry|office|agency|administration|center|centre|council|committee|commission|board|foundation|trust|press|company|corporation|inc|llc|ltd|group|network|news|journal|museum|library|government|nations|project|centers|services|federation|union|academy|hospital|clinic|team|staff|editors)\b|&/i;
  const group = (v) => GROUP.test(v) || /\b[A-Z]{2,}\b/.test(v);
  const name = (n) => {
    if (typeof n === 'string') return parseName(n);
    if (!isObj(n)) return null;
    const literal = clean(n.literal || n.name, 200);
    const family = clean(n.family, 120), given = clean(n.given, 120);
    if (family) return given ? { family, given } : { family };
    return literal ? { literal } : given ? { family: given } : null;
  };
  // What a student types: "Morrison, Toni", "Toni Morrison", "World Health Organization", "Beyoncé".
  const parseName = (s) => {
    const v = clean(s, 200);
    if (!v) return null;
    if (v.includes(',')) {
      const [family, ...rest] = v.split(',');
      const given = clean(rest.join(','));
      return family.trim() ? (given ? { family: family.trim(), given } : { family: family.trim() }) : null;
    }
    const words = v.split(' ');
    if (words.length === 1) return { family: v };
    if (group(v) || words.length > 4) return { literal: v };
    // Particles stay with the family name: "Ludwig van Beethoven", "Rodrigo de la Fuente".
    let i = words.length - 1;
    while (i > 1 && /^(van|von|der|den|de|del|della|di|da|du|la|le|ter|ten|bin|ibn|al|el)$/i.test(words[i - 1])) i--;
    return { family: words.slice(i).join(' '), given: words.slice(0, i).join(' ') };
  };
  const names = (list) => (Array.isArray(list) ? list : typeof list === 'string' ? list.split(/\n|;/) : []).map(name).filter(Boolean).slice(0, MAX.names);
  const showName = (n) => (n.literal ? n.literal : n.given ? `${n.family}, ${n.given}` : n.family);

  // ---- dates --------------------------------------------------------------------------------------------------------
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const month = (w) => { const k = String(w).toLowerCase().replace(/\.$/, ''); return k.length >= 3 ? MONTHS.findIndex((m) => m.startsWith(k === 'sept' ? 'sep' : k)) + 1 : 0; };
  const valid = (y, m, d) => Number.isInteger(y) && y > 0 && y < 3000 && (!m || (m >= 1 && m <= 12)) && (!d || (d >= 1 && d <= 31));
  const parts = (y, m, d) => (valid(y, m, d) ? [y, ...(m ? [m, ...(d ? [d] : [])] : [])] : null);
  // CSL's { date-parts, season, raw, literal }, or what a student types: 1987, 1987-03-08, March 8, 2017, 8 Mar. 2017,
  // Spring 2017, 2019/07 → { date-parts: [[y, m?, d?]], season? } or null.
  const date = (v) => {
    if (v == null || v === '') return null;
    if (isObj(v)) {
      const dp = Array.isArray(v['date-parts']?.[0]) ? v['date-parts'][0].map((x) => (x === '' || x == null ? 0 : +x)) : null;
      const p = dp && parts(dp[0], dp[1] || 0, dp[2] || 0);
      const season = typeof v.season === 'string' && SEASONS.includes(v.season.toLowerCase()) ? v.season.toLowerCase() : [1, 2, 3, 4].includes(+v.season) ? SEASONS[+v.season - 1] : null;
      if (p) return season && p.length === 1 ? { 'date-parts': [p], season } : { 'date-parts': [p] };
      return v.raw || v.literal ? date(String(v.raw || v.literal)) : null;
    }
    const s = clean(String(v), 80).replace(/,/g, ' ').replace(/\s+/g, ' ');
    let m;
    if ((m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:[T ].*)?$/.exec(s))) { const p = parts(+m[1], +m[2] || 0, +m[3] || 0); return p && { 'date-parts': [p] }; }
    if ((m = /^(spring|summer|fall|autumn|winter) (\d{4})$/i.exec(s))) return { 'date-parts': [[+m[2]]], season: m[1].toLowerCase() === 'autumn' ? 'fall' : m[1].toLowerCase() };
    if ((m = /^([a-z]+\.?) (\d{1,2}) (\d{4})$/i.exec(s)) && month(m[1])) { const p = parts(+m[3], month(m[1]), +m[2]); return p && { 'date-parts': [p] }; }
    if ((m = /^(\d{1,2}) ([a-z]+\.?) (\d{4})$/i.exec(s)) && month(m[2])) { const p = parts(+m[3], month(m[2]), +m[1]); return p && { 'date-parts': [p] }; }
    if ((m = /^([a-z]+\.?) (\d{4})$/i.exec(s)) && month(m[1])) return { 'date-parts': [[+m[2], month(m[1])]] };
    return null;
  };
  const showDate = (d) => {
    const [y, m, dd] = d?.['date-parts']?.[0] || [];
    if (!y) return '';
    if (d.season) return `${d.season[0].toUpperCase()}${d.season.slice(1)} ${y}`;
    return m ? `${y}-${String(m).padStart(2, '0')}${dd ? `-${String(dd).padStart(2, '0')}` : ''}` : String(y);
  };
  const today = (now = new Date()) => ({ 'date-parts': [[now.getFullYear(), now.getMonth() + 1, now.getDate()]] });

  // ---- identifiers --------------------------------------------------------------------------------------------------
  const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/;
  const doi = (v) => { const m = DOI.exec(clean(v, 300)); return m ? m[1].replace(/[.,;)\]]+$/, '') : ''; };
  // ISBN-10 or -13 with its check digit → the ISBN-13, or ''.
  const isbn = (v) => {
    const s = clean(v, 40).replace(/^isbn(?:-1[03])?:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{9}[\dX]$/.test(s)) {
      const sum = [...s].reduce((a, c, i) => a + (c === 'X' ? 10 : +c) * (10 - i), 0);
      if (sum % 11) return '';
      const core = `978${s.slice(0, 9)}`;
      return core + ((10 - ([...core].reduce((a, c, i) => a + +c * (i % 2 ? 3 : 1), 0) % 10)) % 10);
    }
    if (/^97[89]\d{10}$/.test(s)) return [...s].reduce((a, c, i) => a + +c * (i % 2 ? 3 : 1), 0) % 10 ? '' : s;
    return '';
  };
  const url = (v) => {
    const s = clean(v, 2000);
    try { const u = new URL(s); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
  };

  // ---- a source -----------------------------------------------------------------------------------------------------
  const ID = /^[a-z0-9-]{4,40}$/;
  const newId = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Anything → a clean source, or null when it has no title and no one to name.
  const normalize = (raw) => {
    if (!isObj(raw)) return null;
    const type = TYPES.includes(raw.type) ? raw.type : ALIAS[raw.type] || (raw['container-title'] && raw.page ? 'article-journal' : raw.URL && !raw.ISBN ? 'webpage' : 'book');
    const s = { id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : newId(), type };
    for (const k of TEXT) { const v = k === 'title' || k === 'container-title' || k === 'title-short' ? rich(raw[k]) : clean(raw[k]); if (v) s[k] = v; }
    for (const k of NAMES) { const v = names(raw[k]); if (v.length) s[k] = v; }
    for (const k of ['issued', 'accessed']) { const v = date(raw[k]); if (v) s[k] = v; }
    const d = doi(raw.DOI), i = isbn(Array.isArray(raw.ISBN) ? raw.ISBN[0] : raw.ISBN), u = url(raw.URL);
    if (d) s.DOI = d;
    if (i) s.ISBN = i;
    if (u) s.URL = u;
    if (s.page) s.page = s.page.replace(/\s*[-–—]+\s*/g, '–');
    if (s.edition) s.edition = s.edition.replace(/\s*(?:st|nd|rd|th)?\.?\s*(?:ed(?:ition)?\.?)?$/i, '') || s.edition;
    return s.title || s.author || s.editor ? s : null;
  };

  // The same work twice: one DOI, ISBN or address, or one title, first name and year.
  const fold = (v) => String(v || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/<\/?i>/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const where = (u) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${x.search}`; } catch { return ''; } };
  const lead = (s) => { const n = (s.author || s.editor || [])[0]; return fold(n ? n.family || n.literal : ''); };
  const year = (s) => s.issued?.['date-parts']?.[0]?.[0] || '';
  const same = (a, b) => {
    if (a.DOI && b.DOI) return a.DOI.toLowerCase() === b.DOI.toLowerCase();
    if (a.ISBN && b.ISBN) return a.ISBN === b.ISBN;
    if (a.URL && b.URL && where(a.URL) === where(b.URL)) return true;
    return !!a.title && fold(a.title) === fold(b.title) && lead(a) === lead(b) && year(a) === year(b);
  };
  // → { sources, id }: the list with this one in it (a duplicate fills the kept one's gaps and keeps its id).
  const add = (list, raw) => {
    const s = normalize(raw), out = Array.isArray(list) ? list.slice() : [];
    if (!s) return { sources: out, id: null };
    const k = out.findIndex((x) => x.id === s.id || same(x, s));
    if (k < 0) { if (out.length < MAX.sources) out.push(s); else return { sources: out, id: null }; return { sources: out, id: s.id }; }
    out[k] = normalize({ ...s, ...out[k], id: out[k].id }) || out[k];
    return { sources: out, id: out[k].id };
  };
  const replace = (list, raw) => { const s = normalize(raw); return s ? list.map((x) => (x.id === s.id ? s : x)) : list; };
  const remove = (list, id) => list.filter((x) => x.id !== id);
  const dedupe = (list) => (Array.isArray(list) ? list : []).reduce((acc, s) => add(acc, s).sources, []);

  // ---- storage ------------------------------------------------------------------------------------------------------
  const PREFIX = 'writer:sources:';
  const part = (v) => (typeof v === 'string' || typeof v === 'number') && String(v).length && String(v).length <= 300 ? encodeURIComponent(String(v)) : null;
  // { school, user, course, item } → the storage key, or null when one is missing (keep them in memory only).
  const key = (p) => { const k = isObj(p) ? [p.school, p.user, p.course, p.item].map(part) : []; return k.length === 4 && k.every(Boolean) ? PREFIX + k.join('|') : null; };
  // The frame's context (features/writer.js) → its key parts: the LMS site's origin, the account, the course, the item.
  const keyOf = (c) => key(isObj(c) ? { school: c.school, user: c.user?.id, course: c.course?.id, item: c.item?.id ?? c.item } : null);
  const area = () => globalThis.chrome?.storage?.local;
  const load = async (k, a = area()) => {
    if (typeof k !== 'string' || !k.startsWith(PREFIX) || !a) return [];
    const got = await Promise.resolve(a.get(k)).catch(() => null);
    return dedupe(got?.[k]?.sources);
  };
  const save = async (k, list, a = area()) => {
    if (typeof k !== 'string' || !k.startsWith(PREFIX) || !a) return false;
    const sources = dedupe(list);
    return Promise.resolve(sources.length ? a.set({ [k]: { sources, at: Date.now() } }) : a.remove(k)).then(() => true, () => false);
  };

  return { TYPES, MAX, normalize, add, replace, remove, dedupe, same, name: parseName, names, showName, date, showDate, today, doi, isbn, url, key, keyOf, load, save, PREFIX, fold, rich };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_SOURCES;
