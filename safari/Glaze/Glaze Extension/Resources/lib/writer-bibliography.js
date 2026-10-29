// Recover typed/imported bibliography entries locally. Uncertain entries retain their original text for review.
var GZ_WRITER_BIBLIOGRAPHY = globalThis.GZ_WRITER_BIBLIOGRAPHY || (() => {
  const S = typeof GZ_WRITER_SOURCES !== 'undefined' ? GZ_WRITER_SOURCES : require('./writer-sources.js');
  const HEADING = /^(?:works cited|works consulted|references|bibliography|bibliographie|références|referencias|referências|literaturverzeichnis)\s*:?$/i;
  const LIMIT = { entries: 300, entry: 6000 };
  const plain = (n) => typeof n === 'string' ? n : n?.type?.name === 'hard_break' || n?.type === 'hard_break' ? '\n' : typeof n?.text === 'string' ? n.text
    : n?.content?.content ? n.content.content.map(plain).join('') : Array.isArray(n?.content) ? n.content.map(plain).join('') : n?.textContent || '';
  const hash = (s) => { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.codePointAt(0), 16777619); return (n >>> 0).toString(36); };
  const trim = (s) => s.replace(/\s+/g, ' ').trim();
  const strip = (s) => trim(s).replace(/^[\s.,;:]+|[\s.,;:]+$/g, '');
  const sentence = (s) => {
    for (const m of s.matchAll(/\.\s+(?=\S)/g)) {
      const token = s.slice(0, m.index).split(/\s/).at(-1);
      if (/^(?:(?:\p{L}\.)*\p{L}|Dr|Prof|Jr|Sr|St|No|Vol|vs|etc)$/iu.test(token)) continue;
      return [s.slice(0, m.index), s.slice(m.index + m[0].length)];
    }
    return [s, ''];
  };
  const starts = (s) => /^(?:\[?\d{1,3}[\].)]\s+|[“"]|[^,.\d]{2,90},\s*(?:\p{Lu}|[“"])|.{2,100}?\s*\((?:\d{4}|n\.d\.)[^)]*\)\.)/u.test(s);
  const authorOnly = (s) => /(?:^[^,.]{2,90},\s*\p{Lu}|^(?:\p{Lu}\.\s*)+\p{L}{2})/u.test(s) && /\.$/.test(s) && !/[“"\d]/.test(s) && !sentence(s)[1];
  const entries = (doc) => {
    const blocks = [];
    if (typeof doc === 'string') blocks.push(...doc.split(/\n/).map((text) => ({ text })));
    else if (typeof doc?.forEach === 'function') doc.forEach((n) => blocks.push({ text: plain(n), heading: n.type?.name === 'heading' }));
    else for (const n of doc?.content || []) blocks.push({ text: plain(n), heading: n.type === 'heading' });
    let found = false, out = [], wrapped = false;
    for (const block of blocks) {
      const lines = String(block.text).split('\n').map(trim).filter(Boolean), at = lines.findIndex((s) => HEADING.test(s));
      if (at >= 0) { found = true; out = []; lines.splice(0, at + 1); }
      else if (found && (block.heading || /^(?:appendix(?:\s+[\p{L}\d]+)?|appendices|acknowledg(?:e)?ments)\s*:?$/iu.test(lines[0] || ''))) break;
      if (!found || !lines.length) continue;
      let entry = '';
      for (const line of lines) {
        if (starts(line) && entry && !(/^[“"]/.test(line) && authorOnly(entry))) { out.push(entry); entry = ''; }
        entry += (entry ? ' ' : '') + line;
      }
      if (entry) {
        // Word imports can represent a hanging-indent continuation as another paragraph. Only join a likely
        // citation's continuation; unknown entries remain verbatim and independently reviewable.
        if (out.length && (/^[“"]/.test(entry) && authorOnly(out.at(-1)) || !starts(entry) && (wrapped || /^(?:https?:|www\.|doi\s*:|doi\.org\/|vol\.?\s|no\.?\s|pp?\.?\s|\d+\s*\()/i.test(entry)))) out[out.length - 1] += ' ' + entry;
        else out.push(entry);
        wrapped = starts(entry) && !/\b(?:1[5-9]\d{2}|20\d{2})\b/.test(entry.replace(/^.+?\(\d{4}[^)]*\)\.?\s*/, '')) && !address(entry);
      }
    }
    return [...new Set(out.map(trim).filter(Boolean))].slice(0, LIMIT.entries).map((text) => ({ id: `s-bib-${hash(text)}`, text: text.slice(0, LIMIT.entry) }));
  };
  const people = (text, apa) => {
    const s = strip(text).replace(/,?\s+et\s+al\.?$/i, '');
    if (!s) return [];
    const chunks = apa ? s.split(/,\s*(?:&\s*|(?=[^,]+,\s*(?:[\p{Lu}]\.[ -]*)+))/u) : s.split(/,?\s+and\s+|;\s*/i);
    return chunks.map((part) => S.name(strip(part))).filter(Boolean);
  };
  const address = (text) => {
    const m = /(?:https?:\/\/|www\.)[^\s<>]+|(?:[\w-]+\.)+(?:org|com|edu|gov|net|io)\/[\S]+/i.exec(text);
    if (!m) return '';
    let s = m[0].replace(/[.,;]+$/, '');
    while (s.endsWith(')') && s.split(')').length > s.split('(').length) s = s.slice(0, -1);
    return S.url(/^https?:/i.test(s) ? s : `https://${s}`);
  };
  const incompleteAuthors = (value) => {
    const text = trim(typeof value === 'string' ? value : value?.text || '').replace(/^\[?\d{1,3}[\].)]\s+/, '');
    const apa = /^(.+?)\s*\((?:\d{4}|n\.d\.)[^)]*\)/u.exec(text), quote = text.search(/[“"]/);
    const author = apa?.[1] || (quote >= 0 ? text.slice(0, quote) : sentence(text)[0]);
    return /\bet\s+al\b/i.test(author);
  };
  const parse = (entry) => {
    const text = trim(typeof entry === 'string' ? entry : entry?.text || ''), id = entry?.id || `s-bib-${hash(text)}`;
    if (!text) return null;
    const raw = { id, origin: 'bibliography', original: text, type: 'report' };
    const body = text.replace(/^\[?\d{1,3}[\].)]\s+/, ''), URL = address(body), DOI = S.doi(/\b10\.\d{4,9}\/[^\s"<>]+/.exec(body)?.[0]);
    if (URL) raw.URL = URL; if (DOI) raw.DOI = DOI;
    // A printed "et al." does not identify the omitted authors or how many there are. Preserve it verbatim rather
    // than reformatting a partial name list as one author (or inventing a style-specific author count).
    if (incompleteAuthors(body)) return S.normalize({ ...raw, title: text, unparsed: true });
    const apa = /^(.+?)\s*\((\d{4}|n\.d\.)[a-z]?(?:[^)]*)\)\.?\s+(.+)$/u.exec(body), quote = /[“"]([^“”"]{3,})[”"]/.exec(body);
    let rest = '', author = '';
    if (apa) {
      author = apa[1]; raw.issued = S.date(apa[2]);
      const [title, after] = sentence(apa[3]);
      raw.title = strip(title); rest = after;
    } else if (quote) {
      author = body.slice(0, quote.index); raw.title = strip(quote[1]); rest = body.slice(quote.index + quote[0].length);
    } else {
      // A period in an initial is not the end of the author field.
      for (const m of body.matchAll(/\.\s+(?!\p{Lu}\.(?:\s|,|$))/gu)) {
        const before = body.slice(0, m.index), after = body.slice(m.index + m[0].length);
        if (!/\p{L}{2}/u.test(before) || /^(?:and|&)\s/i.test(after)) continue;
        const [title, publication] = sentence(after);
        if (publication && /\b(?:1[5-9]\d{2}|20\d{2})\b/.test(publication)) { author = before; raw.title = strip(title); rest = publication; raw.type = 'book'; break; }
      }
    }
    if (!raw.title || raw.title.length < 3) return S.normalize({ ...raw, title: text, unparsed: true });
    const names = people(author, !!apa); if (names.length) raw.author = names;
    const metadata = rest.split(/https?:\/\/|\b(?:doi\.org|www\.)/i)[0];
    if (!raw.issued) {
      const date = /\b(?:(\d{1,2})\s+)?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})\b/i.exec(metadata);
      const year = /\b(?:1[5-9]\d{2}|20\d{2})\b/.exec(metadata);
      raw.issued = date ? S.date(`${date[1] || date[3] ? (date[1] || date[3]) + ' ' : ''}${date[2]} ${date[4]}`) : year ? S.date(year[0]) : null;
    }
    const volume = /\bvol\.?\s*(\d+[\w-]*)/i.exec(metadata), issue = /\bno\.?\s*(\d+[\w-]*)/i.exec(metadata), pages = /\bpp?\.?\s*([\d]+(?:\s*[-–—]\s*[\d]+)?)/i.exec(metadata);
    if (volume) raw.volume = volume[1]; if (issue) raw.issue = issue[1]; if (pages) raw.page = pages[1];
    if (apa) {
      const journal = /^(.+?),\s*(\d+)\s*(?:\(([^)]+)\))?\s*,\s*([\d–—-]+)/.exec(metadata);
      if (journal) { raw['container-title'] = strip(journal[1]); raw.volume = journal[2]; if (journal[3]) raw.issue = journal[3]; raw.page = journal[4]; }
    }
    if (quote) raw['container-title'] = strip(metadata.split(/,\s*(?:vol\.?|no\.?|pp?\.?|\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/i)[0]);
    if (raw.volume || raw['container-title'] && (!URL || DOI || raw.page)) raw.type = 'article-journal';
    else if (URL && !DOI) raw.type = 'webpage';
    else if (raw.type === 'book' || apa && !raw['container-title'] && !DOI && metadata.trim()) {
      raw.type = 'book';
      const publisher = strip(metadata.replace(/,?\s*\b(?:1[5-9]\d{2}|20\d{2})\b.*$/, ''));
      const place = /^([^:]+):\s*(.+)$/.exec(publisher);
      if (place) { raw['publisher-place'] = strip(place[1]); raw.publisher = strip(place[2]); } else raw.publisher = publisher;
    }
    return S.normalize(raw);
  };
  return { entries, parse, address, incompleteAuthors, LIMIT };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_BIBLIOGRAPHY;
