// Glaze Writer's citations, written out by hand for MLA 9, APA 7 and Chicago 17 (notes and bibliography) from each
// guide's own rules and checked against its own published examples (test/writer-cite.test.js); citeproc-js and CSL style
// files are AGPL/CPAL, so neither is used. Sources are lib/writer-sources.js's CSL-JSON subset.
//   format(source, style) → { entry, inText(page), narrative(page), note(page), short(page) }, all HTML holding only <i>
//     (Chicago's inText is its note: the first note's full form or a later one's short form is the caller's to pick);
//   list(sources, style) → { title, entries: [{ id, html }] } in the style's order;
//   check(doc, sources, style, { t }) → issues (source 'cite', kind 'citation'), doc a ProseMirror node or a string;
//   cites(doc, sources, style) → the citations found, each { from, to, text, name, page, year, ids, … };
//   count(doc, sources, style) → { cited, total }.
// Classic script; module.exports for node.
var GZ_WRITER_CITE = globalThis.GZ_WRITER_CITE || (() => {
  const S = () => (typeof GZ_WRITER_SOURCES !== 'undefined' ? GZ_WRITER_SOURCES : require('./writer-sources.js'));
  const STYLES = ['mla9', 'apa7', 'chicago17'];
  const TITLES = { mla9: 'Works Cited', apa7: 'References', chicago17: 'Bibliography' };
  const style = (s) => (STYLES.includes(s) ? s : 'mla9');

  // ---- text ---------------------------------------------------------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // A stored title's <i> spans stay markup; everything else is text.
  const rich = (s) => esc(s).replace(/&lt;(\/?)i&gt;/g, '<$1i>');
  const plain = (s) => String(s ?? '').replace(/<\/?i>/g, '');
  const it = (html) => (html ? `<i>${html}</i>` : '');
  // Whether a piece already ends a sentence (looking past closing quotes and </i>).
  const ends = (html) => /[.?!]["”’']*(<\/i>)?["”’']*$/.test(html);
  const endsQ = (html) => /[?!]["”’']*(<\/i>)?$/.test(html);
  // "x" + '.', unless x already ends with one; a quoted title takes its comma or period inside the quotes.
  const dot = (html) => (!html ? '' : ends(html) ? html : `${html}.`);
  const quote = (title, after = '') => { const t = rich(title); return `“${t}${endsQ(t) || (after === '.' && ends(t)) ? '' : after}”`; };
  const cap = (s) => s.replace(/^(<i>)?([a-z])/, (_, i, c) => `${i || ''}${c.toUpperCase()}`);
  const join = (parts, sep = ', ') => parts.filter(Boolean).join(sep);
  const ordinal = (n) => { const v = +n; if (!Number.isInteger(v)) return n; const s = ['th', 'st', 'nd', 'rd'], k = v % 100; return v + (s[(k - 20) % 10] || s[k] || s[0]); };
  const edition = (e) => (e ? (/^\d+$/.test(e) ? `${ordinal(e)} ed.` : /ed\.?$/i.test(e) ? e : `${e} ed.`) : '');

  // ---- names --------------------------------------------------------------------------------------------------------
  const fam = (n) => n.literal || n.family || '';
  const fwd = (n) => (n.literal ? n.literal : n.given ? `${n.given} ${n.family}` : n.family);
  const inv = (n) => (n.literal ? n.literal : n.given ? `${n.family}, ${n.given}` : n.family);
  // APA's initials: Shao-Hsun → S.-H., R. M. → R. M., Peter F. → P. F.
  const initials = (given) => given.split(/\s+/).filter(Boolean).map((w) => w.split('-').map((p) => (/^[\p{L}]/u.test(p) ? `${p[0].toUpperCase()}.` : '')).filter(Boolean).join('-')).join(' ');
  const apaInv = (n) => (n.literal ? n.literal : n.given ? `${n.family}, ${initials(n.given)}` : n.family);
  const apaFwd = (n) => (n.literal ? n.literal : n.given ? `${initials(n.given)} ${n.family}` : n.family);
  const and = (list, word = 'and', serial = true) => (list.length < 2 ? list[0] || '' : list.length === 2 ? `${list[0]}${serial && list[0].includes(',') ? ',' : ''} ${word} ${list[1]}` : `${list.slice(0, -1).join(', ')}, ${word} ${list.at(-1)}`);
  const N = {
    // MLA: Family, Given / Family, Given, and Given Family / Family, Given, et al.
    mla: (ns) => (ns.length >= 3 ? `${inv(ns[0])}, et al.` : ns.length === 2 ? `${inv(ns[0])}, and ${fwd(ns[1])}` : inv(ns[0])),
    mlaFwd: (ns) => (ns.length >= 3 ? `${fwd(ns[0])} et al.` : ns.map(fwd).join(' and ')),
    // APA: up to 20, & before the last (with a comma, two included); 21 or more: 19, an ellipsis, the last.
    apa: (ns) => (ns.length === 1 ? apaInv(ns[0]) : ns.length > 20 ? `${ns.slice(0, 19).map(apaInv).join(', ')}, . . . ${apaInv(ns.at(-1))}` : `${ns.slice(0, -1).map(apaInv).join(', ')}, & ${apaInv(ns.at(-1))}`),
    apaFwd: (ns) => (ns.length === 1 ? apaFwd(ns[0]) : ns.length === 2 ? `${apaFwd(ns[0])} & ${apaFwd(ns[1])}` : `${ns.slice(0, -1).map(apaFwd).join(', ')}, & ${apaFwd(ns.at(-1))}`),
    // Chicago bibliography: all up to ten, the first inverted; more than ten: the first seven, et al.
    cmsBib: (ns) => (ns.length > 10 ? `${[inv(ns[0]), ...ns.slice(1, 7).map(fwd)].join(', ')}, et al.` : ns.length === 2 ? `${inv(ns[0])}, and ${fwd(ns[1])}` : and([inv(ns[0]), ...ns.slice(1).map(fwd)])),
    // Chicago notes: up to three; four or more: the first, et al.
    cmsNote: (ns) => (ns.length >= 4 ? `${fwd(ns[0])} et al.` : and(ns.map(fwd), 'and', false)),
    cmsShort: (ns) => (ns.length >= 4 ? `${fam(ns[0])} et al.` : and(ns.map(fam), 'and', false)),
    // In the text: MLA "Dorris and Erdrich", APA "Svendsen & Løber" (narrative "and"), "Grady et al." from three on.
    cite: (ns, word = 'and') => (ns.length >= 3 ? `${fam(ns[0])} et al.` : ns.map(fam).join(` ${word} `)),
  };

  // ---- dates --------------------------------------------------------------------------------------------------------
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MLA_MONTH = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  const dp = (d) => d?.['date-parts']?.[0] || [];
  const season = (d, upper) => (d?.season ? (upper ? d.season[0].toUpperCase() + d.season.slice(1) : d.season) : '');
  const D = {
    mla: (d) => { const [y, m, day] = dp(d); return !y ? '' : d.season ? `${season(d)} ${y}` : m ? `${day ? `${day} ` : ''}${MLA_MONTH[m - 1]} ${y}` : String(y); },
    long: (d) => { const [y, m, day] = dp(d); return !y ? '' : d.season ? `${season(d, true)} ${y}` : m ? `${MONTH[m - 1]}${day ? ` ${day},` : ''} ${y}` : String(y); },
    apa: (d, full) => { const [y, m, day] = dp(d); return !y ? 'n.d.' : !full ? String(y) : d.season ? `${y}, ${season(d, true)}` : m ? `${y}, ${MONTH[m - 1]}${day ? ` ${day}` : ''}` : String(y); },
  };
  const yearOf = (s) => dp(s.issued)[0] || null;

  // ---- pages --------------------------------------------------------------------------------------------------------
  const RANGE = /^(\d+)\s*[-–—]+\s*(\d+)$/;
  // MLA: the second number in full through 99, else its last two digits unless more are needed (103-04, 395-401).
  const mlaRange = (a, b) => {
    if (+a < 100 || +b < 100 || a.length !== b.length) return `${a}-${b}`;
    return b.slice(0, -2) === a.slice(0, -2) ? `${a}-${b.slice(-2)}` : `${a}-${b}`;
  };
  // Chicago 9.64: under 100 or a multiple of 100, in full; 101–109 and the like, the changed part (101–8, 808–33);
  // otherwise two digits or more as needed (321–28, 498–532, 1496–500).
  const cmsRange = (a, b) => {
    if (+a < 100 || +a % 100 === 0 || a.length !== b.length) return `${a}–${b}`;
    let k = 0;
    while (k < a.length && a[k] === b[k]) k++;
    return `${a}–${b.slice(+a % 100 < 10 ? k : Math.min(k, b.length - 2))}`;
  };
  const pages = (p, how) => { const m = RANGE.exec(String(p || '').trim()); return !p ? '' : !m ? esc(p) : how === 'mla' ? mlaRange(m[1], m[2]) : how === 'cms' ? cmsRange(m[1], m[2]) : `${m[1]}–${m[2]}`; };
  const isRange = (p) => RANGE.test(String(p || '').trim()) || /[,–-]/.test(String(p || ''));
  const mlaPages = (p) => (p ? `${isRange(p) ? 'pp.' : 'p.'} ${pages(p, 'mla')}` : '');
  const apaPages = (p) => (p ? `${isRange(p) ? 'pp.' : 'p.'} ${pages(p, 'apa')}` : '');

  // ---- links --------------------------------------------------------------------------------------------------------
  const doiUrl = (s) => (s.DOI ? `https://doi.org/${esc(s.DOI)}` : '');
  const link = (s) => doiUrl(s) || esc(s.URL || '');
  // MLA: a DOI as https://doi.org/…, any other address without its scheme.
  const mlaLink = (s) => doiUrl(s) || esc(String(s.URL || '').replace(/^https?:\/\//, ''));

  // ---- who leads ----------------------------------------------------------------------------------------------------
  // An edited book's editors lead; a translated work with no author leads with its title (MLA's Beowulf).
  const who = (s) => (s.author?.length ? { names: s.author, role: '' } : s.editor?.length && !s.translator?.length && ['book', 'report'].includes(s.type) ? { names: s.editor, role: 'editor' } : null);
  const groupPublisher = (s) => s.author?.length === 1 && s.author[0].literal && sameText(s.author[0].literal, s.publisher);
  const quoted = (s) => !['book', 'report'].includes(s.type);
  const sameText = (a, b) => !!a && !!b && S().fold(a) === S().fold(b);
  const groupIs = (s, v) => s.author?.length === 1 && !!s.author[0].literal && sameText(s.author[0].literal, v);
  // A short title: title-short, else the title before its colon without a leading article, cut to four words and no
  // trailing small word ("Expanding College Access in Taiwan, 1978–2014: …" → "Expanding College Access").
  const SMALL = /^(a|an|the|and|or|of|in|on|at|to|for|by|with|from|about|as|into|nor|but)$/i;
  const shortTitle = (s) => {
    if (s['title-short']) return s['title-short'];
    const main = String(s.title || '').split(/[:;?!]|\s[—–]\s/)[0].replace(/^(?:<i>)?(a|an|the)\s+/i, (m, w) => m.replace(new RegExp(`${w}\\s+`), '')).trim();
    const words = main.split(/\s+/);
    if (words.length <= 4) return main;
    let w = words.slice(0, 4);
    while (w.length > 1 && SMALL.test(plain(w.at(-1)).replace(/[,.]$/, ''))) w = w.slice(0, -1);
    return w.join(' ').replace(/[,;]$/, '');
  };

  // ==== MLA 9 =======================================================================================================
  const mla = (s) => {
    const lead = who(s);
    // An organization that wrote and published the work leads with its title and is named once, as publisher.
    const groupPub = groupPublisher(s);
    const author = lead && !groupPub ? dot(esc(`${N.mla(lead.names)}${lead.role ? `, ${lead.role}${lead.names.length > 1 ? 's' : ''}` : ''}`)) : '';
    const title = quoted(s) ? quote(s.title, '.') : dot(it(rich(s.title)));
    const contrib = [];
    if (s.translator?.length) contrib.push(`translated by ${esc(N.mlaFwd(s.translator))}`);
    if (s.editor?.length && lead?.role !== 'editor' && s.type !== 'chapter') contrib.push(`edited by ${esc(N.mlaFwd(s.editor))}`);
    const date = D.mla(s.issued);
    let first = [];
    const archive = s.archive ? `${it(rich(s.archive))}, ${mlaLink(s)}` : '';
    const loc = archive ? '' : mlaLink(s);
    if (s.type === 'chapter') {
      first = [it(rich(s['container-title'])), s.editor?.length ? `edited by ${esc(N.mlaFwd(s.editor))}` : '', ...contrib, edition(esc(s.edition)), esc(s.volume ? `vol. ${s.volume}` : ''), esc(s.publisher), date, mlaPages(s.page), loc];
    } else if (s.type === 'article-journal' || s.type === 'article-magazine' || s.type === 'article-newspaper') {
      first = [it(rich(s['container-title'])), ...contrib, s.volume ? `vol. ${esc(s.volume)}` : '', s.issue ? `no. ${esc(s.issue)}` : '', date, mlaPages(s.page), loc];
    } else if (s.type === 'webpage' || s.type === 'motion_picture') {
      const site = s['container-title'];
      const by = s.type === 'motion_picture' && s.publisher && !sameText(s.publisher, s.author?.[0] && fwd(s.author[0])) ? `uploaded by ${esc(s.publisher)}` : '';
      const pub = s.type === 'webpage' && s.publisher && !sameText(s.publisher, site) && !groupIs(s, s.publisher) ? esc(s.publisher) : '';
      first = [it(rich(site)), ...contrib, by, pub, date, loc];
    } else {
      first = [...contrib, edition(esc(s.edition)), esc(s.publisher), date, loc];
    }
    const head = join(first);
    const tail = archive ? ` ${dot(archive)}` : '';
    const accessed = !s.issued && s.accessed && (s.URL || s.DOI) && ['webpage', 'motion_picture', 'article-magazine', 'article-newspaper'].includes(s.type) ? ` Accessed ${D.mla(s.accessed)}.` : '';
    return join([author, title, head ? dot(quoted(s) ? head : cap(head)) : ''], ' ') + tail + accessed;
  };
  const mlaIn = (s, page, narrative) => {
    const lead = groupPublisher(s) ? null : who(s);
    const name = lead ? esc(N.cite(lead.names)) : quoted(s) ? `“${rich(shortTitle(s))}”` : it(rich(shortTitle(s)));
    const p = page ? esc(String(page).replace(/\s*[-–—]+\s*/g, '-')) : '';
    return narrative ? (p ? `(${p})` : '') : `(${join([name, p], ' ')})`;
  };

  // ==== APA 7 =======================================================================================================
  const apa = (s) => {
    const lead = who(s) || (s.type === 'motion_picture' && s.publisher ? { names: [{ literal: s.publisher }], role: '' } : null);
    const full = ['article-magazine', 'article-newspaper', 'webpage', 'motion_picture'].includes(s.type);
    const date = `(${D.apa(s.issued, full)}).`;
    const t = rich(s.title);
    const italicTitle = !['chapter', 'article-journal', 'article-magazine', 'article-newspaper'].includes(s.type);
    const pubOk = (p) => p && !groupIs(s, p) && !(lead && lead.names.length === 1 && lead.names[0].literal && sameText(lead.names[0].literal, p));
    let titleEl, rest = [];
    const link_ = s.retrieval && s.accessed && s.URL && !s.DOI ? `Retrieved ${D.long(s.accessed)}, from ${esc(s.URL)}` : link(s);
    if (s.type === 'book' || s.type === 'report') {
      // Translators, and the editors of an authored book, before the edition: "(H. Weaver, Trans.; 2nd ed.)".
      const eds = lead?.role !== 'editor' && s.editor?.length ? N.apaFwd(s.editor) : '', trans = s.translator?.length ? N.apaFwd(s.translator) : '';
      const people = eds && eds === trans ? [`${eds}, ${s.editor.length > 1 ? 'Eds.' : 'Ed.'} & Trans.`] : [eds && `${eds}, ${s.editor.length > 1 ? 'Eds.' : 'Ed.'}`, trans && `${trans}, Trans.`];
      const bits = join([...people.map(esc), join([edition(esc(s.edition)), s.volume ? `Vol. ${esc(s.volume)}` : '', s.type === 'report' && s.number ? `${esc(s.genre || 'Report')} No. ${esc(s.number)}` : ''])], '; ');
      titleEl = `${it(t)}${bits ? ` (${bits})` : ''}`;
      titleEl = bits ? `${titleEl}.` : endsQ(t) ? titleEl : `${titleEl}.`;
      rest = [pubOk(s.publisher) ? dot(esc(s.publisher)) : ''];
    } else if (s.type === 'chapter') {
      titleEl = dot(t);
      const eds = s.editor?.length ? `${esc(N.apaFwd(s.editor))} (${s.editor.length > 1 ? 'Eds.' : 'Ed.'}), ` : '';
      const bits = join([edition(esc(s.edition)), s.page ? apaPages(s.page) : '']);
      rest = [`In ${eds}${it(rich(s['container-title']))}${bits ? ` (${bits})` : ''}.`, pubOk(s.publisher) ? dot(esc(s.publisher)) : ''];
    } else if (s.type === 'article-journal' || s.type === 'article-magazine' || s.type === 'article-newspaper') {
      titleEl = dot(t);
      const vol = s.volume ? `${it(esc(s.volume))}${s.issue ? `(${esc(s.issue)})` : ''}` : s.issue ? `(${esc(s.issue)})` : '';
      const where = s.type === 'article-journal' && s.number && !s.page ? `Article ${esc(s.number)}` : s.page ? pages(s.page, 'apa') : '';
      rest = [`${join([it(rich(s['container-title'])), s.type === 'article-newspaper' ? '' : vol, where])}.`];
    } else {
      titleEl = `${it(t)}${s.type === 'motion_picture' ? ` [${esc(s.medium || 'Video')}]` : ''}`;
      titleEl = endsQ(t) && s.type !== 'motion_picture' ? titleEl : `${titleEl}.`;
      const site = s['container-title'] || s.publisher;
      rest = [pubOk(site) ? dot(rich(site)) : ''];
    }
    const author = lead ? dot(esc(`${N.apa(lead.names)}${lead.role ? ` (${lead.names.length > 1 ? 'Eds.' : 'Ed.'})` : ''}`)) : '';
    const parts = author ? [author, date, titleEl, ...rest] : [titleEl, date, ...rest];
    return join([...parts, link_], ' ');
  };
  // Anonymous works use title case in text; standalone works keep their entry's italics.
  const apaTitle = (s) => rich(shortTitle(s)).replace(/(<\/?i>)|([\p{L}][\p{L}'’]*)/gu, (m, tag, w, at) => tag || (at === 0 || w.length >= 4 || !SMALL.test(w) ? w[0].toUpperCase() + w.slice(1) : w));
  const apaName = (s, word) => {
    const lead = who(s) || (s.type === 'motion_picture' && s.publisher ? { names: [{ literal: s.publisher }] } : null);
    return lead ? esc(N.cite(lead.names, word)) : ['chapter', 'article-journal', 'article-magazine', 'article-newspaper'].includes(s.type) ? `“${apaTitle(s)}”` : it(apaTitle(s));
  };
  const apaPage = (page) => (page ? (/^(p{1,2}|para|chap|ch)\./i.test(String(page)) ? esc(page) : apaPages(String(page).replace(/\s*[-–—]+\s*/g, '–'))) : '');
  const apaIn = (s, page) => `(${join([apaName(s, '&'), D.apa(s.issued), apaPage(page)])})`;
  const apaNarr = (s, page) => `${apaName(s, 'and')} (${join([D.apa(s.issued), apaPage(page)])})`;

  // ==== Chicago 17, notes and bibliography ==========================================================================
  // A book's place, publisher and year; n.d. without one (14.145).
  const cmsPub = (s) => join([esc(s['publisher-place']) && s.publisher ? `${esc(s['publisher-place'])}: ${esc(s.publisher)}` : esc(s.publisher || s['publisher-place']), yearOf(s) ? String(yearOf(s)) : 'n.d.'], ', ');
  const cmsDate = (s) => D.long(s.issued);
  const cmsLink = (s) => link(s) || esc(s.archive || '');
  const cms = (s, mode, page) => {
    const note = mode === 'note';
    const lead = who(s);
    const ed = lead?.role === 'editor';
    const names = lead ? esc(note ? N.cmsNote(lead.names) : N.cmsBib(lead.names)) + (ed ? `, ${lead.names.length > 1 ? 'eds' : 'ed'}${note ? '.' : ''}` : '') : '';
    const p = page ? pages(page, 'cms') : '';
    const T = rich(s.title);
    if (s.type === 'book' || s.type === 'report') {
      const extra = [s.type === 'report' && s.number ? `${esc(s.genre || 'Report')} no. ${esc(s.number)}` : '', edition(esc(s.edition))];
      const trans = s.translator?.length ? esc(N.cmsNote(s.translator)) : '';
      const eds = s.editor?.length && !ed ? esc(N.cmsNote(s.editor)) : '';
      if (note) {
        const head = join([names, it(T), ...extra, trans && `trans. ${trans}`, eds && `ed. ${eds}`]);
        const pub = cmsPub(s);
        return `${head}${pub ? ` (${pub})` : ''}${p ? `, ${p}` : ''}${cmsLink(s) ? `, ${cmsLink(s)}` : ''}.`;
      }
      return join([names && dot(names), dot(it(T)), ...extra.map((x) => x && dot(cap(x))), trans && `Translated by ${trans}.`, eds && `Edited by ${eds}.`, cmsPub(s) && dot(cmsPub(s)), cmsLink(s) && dot(cmsLink(s))], ' ');
    }
    if (s.type === 'chapter') {
      const eds = s.editor?.length ? esc(N.cmsNote(s.editor)) : '';
      const book = it(rich(s['container-title']));
      if (note) {
        const pub = cmsPub(s);
        return `${names ? `${names}, ` : ''}${quote(s.title, ',')} in ${join([book, eds && `ed. ${eds}`])}${pub ? ` (${pub})` : ''}${p ? `, ${p}` : ''}${cmsLink(s) ? `, ${cmsLink(s)}` : ''}.`;
      }
      return join([names && dot(names), quote(s.title, '.'), `In ${join([book, eds && `edited by ${eds}`, s.page ? pages(s.page, 'cms') : ''])}.`, cmsPub(s) && dot(cmsPub(s)), cmsLink(s) && dot(cmsLink(s))], ' ');
    }
    if (s.type === 'article-journal') {
      const vol = join([it(rich(s['container-title'])), esc(s.volume || '')], ' ') + (s.issue ? `, no. ${esc(s.issue)}` : '');
      const when = cmsDate(s) ? ` (${cmsDate(s)})` : '';
      const at = note ? p : s.page ? pages(s.page, 'cms') : '';
      const body = `${vol}${when}${at ? `: ${at}` : ''}`;
      if (note) return `${names ? `${names}, ` : ''}${quote(s.title, ',')} ${body}${cmsLink(s) ? `, ${cmsLink(s)}` : ''}.`;
      return join([names && dot(names), quote(s.title, '.'), `${body}.`, cmsLink(s) && dot(cmsLink(s))], ' ');
    }
    if (s.type === 'article-magazine' || s.type === 'article-newspaper') {
      const mag = join([it(rich(s['container-title'])), cmsDate(s)]);
      if (note) return `${names ? `${names}, ` : ''}${quote(s.title, ',')} ${join([mag, p, cmsLink(s)])}.`;
      return join([names && dot(names), quote(s.title, '.'), `${mag}.`, cmsLink(s) && dot(cmsLink(s))], ' ');
    }
    // Website content and online video: an owner with no author leads the bibliography entry, not the note.
    const site = rich(s['container-title'] || ''), owner = esc(s.publisher || '');
    const when = s.issued ? `${s.type === 'webpage' ? 'last modified ' : ''}${cmsDate(s)}` : s.accessed ? `accessed ${D.long(s.accessed)}` : '';
    const media = s.type === 'motion_picture' ? join([esc(s.medium || 'video'), esc(s.dimensions || '')]) : '';
    if (note) return `${names ? `${names}, ` : ''}${quote(s.title, ',')} ${join([site, owner !== site || !site ? owner : '', when, media, p, cmsLink(s)])}.`;
    const leadBib = names || (s.type === 'webpage' ? owner : '');
    return join([leadBib && dot(leadBib), quote(s.title, '.'), site && dot(site), !names && leadBib ? '' : owner && owner !== site ? dot(owner) : '', when && dot(cap(when)), media && dot(cap(media)), cmsLink(s) && dot(cmsLink(s))], ' ');
  };
  const cmsShort = (s, page) => {
    const lead = who(s), p = page ? pages(page, 'cms') : '', st = rich(shortTitle(s));
    const title = quoted(s) ? `“${st}${endsQ(st) ? '' : p ? ',' : '.'}”` : `${it(st)}${p ? ',' : '.'}`;
    return `${lead ? `${esc(N.cmsShort(lead.names))}, ` : ''}${title}${p ? ` ${p}.` : ''}`;
  };

  // ==== the public part =============================================================================================
  const format = (raw, st) => {
    const s = S().normalize(raw);
    const k = style(st);
    if (!s) return { entry: '', inText: () => '', narrative: () => '', note: () => '', short: () => '' };
    const entry = k === 'apa7' ? apa(s) : k === 'chicago17' ? cms(s, 'bib') : mla(s);
    const note = (page) => cms(s, 'note', page);
    const short = (page) => cmsShort(s, page);
    return {
      entry,
      inText: (page) => (k === 'apa7' ? apaIn(s, page) : k === 'chicago17' ? note(page) : mlaIn(s, page)),
      narrative: (page) => (k === 'apa7' ? apaNarr(s, page) : k === 'chicago17' ? short(page) : mlaIn(s, page, true)),
      note, short,
    };
  };

  // Each style's order: by who leads (or the title, without A, An or The), then the year (n.d. first, as APA has it),
  // then the title; MLA and Chicago instead order one author's works by title.
  const fold = (v) => S().fold(v).replace(/\s+/g, '');
  const article = (t) => plain(t).replace(/^[“"‘']*(a|an|the)\s+/i, '');
  const sortKey = (s, k) => {
    const lead = k === 'mla9' && groupPublisher(s) ? null : who(s);
    const first = lead ? lead.names.map((n) => `${fold(fam(n))} ${fold(n.given || '')}`).join(' ') : k === 'chicago17' && s.type === 'webpage' && s.publisher ? fold(s.publisher) : fold(article(s.title));
    return k === 'apa7' ? [first, String(yearOf(s) || 0).padStart(4, '0'), fold(article(s.title))] : [first, fold(article(s.title))];
  };
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
  const list = (sources, st) => {
    const k = style(st);
    const all = S().dedupe(sources);
    return { title: TITLES[k], entries: all.map((s) => ({ s, key: sortKey(s, k) })).sort((a, b) => cmp(a.key, b.key)).map(({ s }) => ({ id: s.id, html: s.unparsed && s.original ? esc(s.original) : format(s, k).entry })) };
  };

  // ---- finding citations in the text --------------------------------------------------------------------------------
  // A citation names a source in parentheses ("(Morrison 42)", "(Grady et al., 2019, p. 4)", "(“Capybara” 2)"), or names
  // it in the sentence with only its page or year in parentheses ("Morrison argues … (42)", "Grady et al. (2019)"), or, in
  // Chicago papers, sits in a footnote ("Zadie Smith, Swing Time …", "Smith, Swing Time, 320.").
  const NAME = String.raw`[\p{Lu}][\p{L}'’.-]*(?:\s+(?:de|van|von|da|del|la|le|di)\s+[\p{Lu}][\p{L}'’-]*)?`;
  const PAGE = String.raw`(?:(?:pp?\.|para\.|ch\.)\s*)?(?:[\dxivlc]+(?:\s*[-–]\s*[\dxivlc]+)?(?:,\s*\d+(?:[-–]\d+)?)*)`;
  const YEAR = String.raw`(?:\d{4}[a-z]?|n\.d\.)`;
  const PART = {
    apa: new RegExp(String.raw`^(.+?),\s*(${YEAR})(?:,\s*(${PAGE}))?$`, 'iu'),
    named: new RegExp(String.raw`^(.+?)(,?)\s+(${PAGE})$`, 'u'),
    page: new RegExp(String.raw`^(${PAGE})$`, 'iu'),
    year: new RegExp(String.raw`^(${YEAR})(?:,\s*(${PAGE}))?$`, 'iu'),
  };
  const NARRATIVE_APA = new RegExp(String.raw`(${NAME}(?:\s+(?:and|&)\s+${NAME}|\s+et\s+al\.)?)(?:’s|'s)?\s+\((${YEAR})(?:,\s*(${PAGE}))?\)`, 'gu');
  // The forms a source answers to in the text: its lead's family names, its group name, its short title.
  const keysOf = (s) => {
    const lead = who(s), out = [];
    if (lead) out.push(S().fold(fam(lead.names[0])), S().fold(N.cite(lead.names)), S().fold(N.cite(lead.names, '&')));
    if (!lead && s.type === 'motion_picture' && s.publisher) out.push(S().fold(s.publisher));
    if (!lead || groupPublisher(s) || s.type === 'webpage') out.push(S().fold(shortTitle(s)), S().fold(s.title));
    return [...new Set(out.filter(Boolean))];
  };
  const matchIds = (nameText, sources) => {
    const n = S().fold(nameText.replace(/\bet al\.?/, '').replace(/[“”"‘’']/g, ''));
    if (!n) return [];
    return sources.filter((s) => keysOf(s).some((k) => n === k)).map((s) => s.id);
  };
  // Parentheses that point inside a text or give a date, not a source: "(Figure 2)", "(Act 3)", "(May 1945)". One list,
  // writer-compose.js's count reads it too.
  const INSIDE = /^(?:fig(?:ure)?s?|tables?|chapters?|ch|parts?|pages?|weeks?|sections?|appendix|appendices|steps?|units?|modules?|questions?|exhibits?|lessons?|days?|vol(?:ume)?s?|acts?|scenes?|lines?|notes?|book|verse|slides?|problems?|exercises?|items?|level|grade|room|period|session|episode|season|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|spring|summer|autumn|fall|winter)\.?$/i;
  const looksNamed = (t) => /^[“"‘]?[\p{Lu}]/u.test(t) && !/[\p{Sc}\p{Sm}@#%*\\/]/u.test(t) && !/^(see|e\.g|i\.e|cf|qtd|figure|fig|table|chapter|ch|vol|para|line|lines|version|in|on|during|since|before|after|born)\b/i.test(t);
  // → [{ from, to, text, name, sep, page, year, ids, kind: 'paren'|'narrative'|'note', fix? }] over a string's offsets.
  const findIn = (text, sources, k) => {
    const out = [];
    const PAREN = /\(([^()\n]{1,200})\)/g;
    let m;
    while ((m = PAREN.exec(text))) {
      const inner = m[1].trim(), from = m.index, to = m.index + m[0].length;
      const parts = inner.split(/\s*;\s*/);
      for (const raw of parts) {
        const part = raw.replace(/^(see also|see|e\.g\.,?|cf\.|qtd\. in)\s+/i, '');
        let a;
        if (k === 'chicago17' && part.split(',').length >= 3) { const name = noteName(part); if (looksNamed(name)) { out.push({ from, to, text: m[0], name, page: '', kind: 'note', ids: matchIds(name, sources) }); continue; } }
        if (k === 'apa7' && (a = PART.apa.exec(part)) && looksNamed(a[1])) { if (INSIDE.test(a[1]) && !matchIds(a[1], sources).length) continue; out.push({ from, to, text: m[0], name: a[1], year: a[2], page: a[3] || '', kind: 'paren', ids: matchIds(a[1], sources) }); continue; }
        if ((a = PART.year.exec(part))) { if (k !== 'apa7') continue; out.push({ from, to, text: m[0], name: '', year: a[1], page: a[2] || '', kind: 'narrative', ids: [] }); continue; }
        if ((a = PART.page.exec(part))) { out.push({ from, to, text: m[0], name: '', page: a[1], kind: 'narrative', ids: [] }); continue; }
        if ((a = PART.named.exec(part)) && looksNamed(a[1])) {
          const ids = matchIds(a[1], sources);
          // Naming no source, a label, a date or a name the sentence runs on through ("The mission (Apollo 11) landed") isn't one.
          if (!ids.length && (INSIDE.test(a[1]) || /^\s*[\p{L}\d]/u.test(text.slice(to)))) continue;
          out.push({ from, to, text: m[0], name: a[1], part, sep: a[2], page: a[3], kind: 'paren', ids });
          continue;
        }
        if (looksNamed(part) && part.length <= 80) { const ids = matchIds(part.replace(/,.*$/, ''), sources); if (ids.length) out.push({ from, to, text: m[0], name: part.replace(/,.*$/, ''), page: '', kind: 'paren', ids, bare: true }); }
      }
    }
    // A page or year alone: the source is named earlier in its sentence.
    for (const c of out) {
      if (c.kind !== 'narrative') continue;
      const start = Math.max(c.from - 400, ...['\n', '. ', '? ', '! '].map((p) => { const k = text.lastIndexOf(p, c.from - 1); return k < 0 ? 0 : k + p.length; }));
      const before = text.slice(start, c.from);
      if (k === 'apa7') {
        const n = [...before.matchAll(new RegExp(String.raw`(${NAME}(?:\s+(?:and|&)\s+${NAME}|\s+et\s+al\.)?)(?:’s|'s)?\s*$`, 'gu'))].at(-1);
        if (n && c.year) { c.name = n[1]; c.ids = matchIds(n[1], sources); c.from = start + n.index; continue; }
      }
      const words = [...before.matchAll(new RegExp(NAME, 'gu'))].reverse();
      for (const w of words) { const ids = matchIds(w[0].replace(/(’s|'s)$/, ''), sources); if (ids.length) { c.name = w[0].replace(/(’s|'s)$/, ''); c.ids = ids; break; } }
    }
    return out.filter((c) => c.kind === 'paren' || c.ids.length || (k === 'apa7' && c.name));
  };

  const textOf = (doc) => {
    if (typeof doc === 'string') return { text: doc, posAt: (i) => i, notes: [] };
    const W = typeof GZ_WRITER_SCHEMA !== 'undefined' ? GZ_WRITER_SCHEMA : require('./writer-schema.js');
    const t = W.text(doc), notes = [];
    doc.descendants((n, pos) => { if (n.type.name === 'footnote_ref') notes.push({ pos, text: plain(String(n.attrs.content || '').replace(/<[^>]*>/g, '')).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ') }); return true; });
    return { text: t.text, posAt: t.posAt, notes, end: doc.content.size };
  };
  // A footnote's first name: "Zadie Smith, Swing Time …" → Smith; "Smith, Swing Time, 320." → Smith; "“Yale Facts.”" → title;
  // "For a contrasting view, see Smith, …" → Smith. '' for a note that names no one (an explanatory note, "Translation mine.").
  const SEE = String.raw`(?:see also|see|cf\.|compare)(?:,?\s+(?:e\.g\.|for example),?)?\s+`;
  const named = (head) => { const ws = head.split(/\s+/); return ws.length <= 6 && ws.every((w) => /^(?:de|van|von|da|del|la|le|di|and|&)$/.test(w) || /^\p{Lu}[\p{L}\p{M}'’.-]*$/u.test(w)); };
  const noteName = (text) => {
    const lead = (t) => {
      t = t.trim().replace(/^\d+\.\s*/, '').replace(new RegExp(`^${SEE}`, 'i'), '');
      if (/^[“"]/.test(t)) return t.replace(/^[“"]([^”"]+)[”"].*$/, '$1').replace(/[,.]$/, '');
      const head = t.split(/,|\s\(/)[0].replace(/\s+et al\.?$/, '').trim();
      if (!named(head)) return '';
      const ws = head.split(/\s+(?:and|&)\s+/)[0].split(/\s+/);
      return ws.length > 1 && !/[a-z]/.test(ws.at(-1)[0]) ? ws.at(-1) : head;
    };
    const m = new RegExp(`(?:^|[\\s,;(])${SEE}`, 'i').exec(text);
    return lead(text) || (m ? lead(text.slice(m.index + m[0].length)) : '');
  };

  const cites = (doc, sources, st) => {
    const k = style(st), all = S().dedupe(sources), T = textOf(doc);
    const found = findIn(T.text, all, k).map((c) => ({ ...c, at: [T.posAt(c.from), T.posAt(c.to)] }));
    // Ibid. is the source of the note before it, when that one named a saved source.
    let prev = null;
    for (const n of T.notes) {
      if (/^\s*ibid\b/i.test(n.text)) { if (prev?.ids.length) found.push({ ...prev, at: [n.pos, n.pos + 1], text: n.text }); continue; }
      const name = noteName(n.text);
      prev = name && looksNamed(name) ? { from: -1, to: -1, at: [n.pos, n.pos + 1], text: n.text, name, kind: 'note', page: '', ids: matchIds(name, all) } : null;
      if (prev) found.push(prev);
    }
    // An APA narrative citation outside parentheses: "Grady et al. (2019) found …".
    if (k === 'apa7') for (const m of T.text.matchAll(NARRATIVE_APA)) {
      if (found.some((c) => c.from <= m.index + m[0].length && c.to >= m.index && c.ids.length)) continue;
      const at = m.index + m[0].indexOf('(');
      const c = found.find((x) => x.from === at && x.kind === 'narrative');
      const entry = { from: m.index, to: m.index + m[0].length, text: m[0], name: m[1], year: m[2], page: m[3] || '', kind: 'narrative', ids: matchIds(m[1], all) };
      entry.at = [T.posAt(entry.from), T.posAt(entry.to)];
      if (c) Object.assign(c, entry); else found.push(entry);
    }
    const typed = typedList(T), start = typed ? T.posAt(typed.entries[0]?.from ?? T.text.length) : Infinity;
    return found.filter((c) => c.at[0] < start).map((c) => ({ ...c, ids: k === 'apa7' && c.year ? c.ids.filter((id) => { const s = all.find((s) => s.id === id); return String(yearOf(s) || 'n.d.') === c.year.replace(/(\d)[a-z]$/, '$1'); }) : c.ids }));
  };

  // The reference list typed into the document: its title on a line of its own, its entries the lines after it.
  const typedList = (T) => {
    const lines = [];
    let at = 0;
    for (const line of T.text.split('\n')) { lines.push({ text: line, from: at, to: at + line.length }); at += line.length + 1; }
    const h = lines.findLastIndex((l) => /^\s*(works cited|references|bibliography|works consulted)\s*:?\s*$/i.test(l.text));
    return h < 0 ? null : { title: lines[h].text.trim().replace(/:$/, ''), entries: lines.slice(h + 1).filter((l) => l.text.trim()) };
  };

  const ISSUE = (from, to, message, extra) => ({ from, to, source: 'cite', kind: 'citation', message, suggestions: [], sure: false, id: `cite:${from}:${to}:${message}`, ...extra });
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m));
  const check = (doc, sources, st, opts = {}) => {
    const k = style(st), t = opts.t || ((s, v) => fill(s, v)), all = S().dedupe(sources), T = textOf(doc);
    const found = cites(doc, all, st), issues = [], used = new Set(), listName = t(TITLES[k]);
    const end = T.end ?? T.text.length;
    const typed = typedList(T);
    const inList = (c) => typed && T.posAt(typed.entries[0]?.from ?? Infinity) <= c.at[0];
    // Imported and hand-written papers need no saved CSL record to have a reference entry.
    const hasEntry = (c) => typed?.entries.some((e) => {
      if (c.year && !new RegExp(`\\b${c.year.replace(/(\d)[a-z]$/, '$1')}\\b`).test(e.text)) return false;
      // An unsigned article starts with its quoted title, not an author's surname followed by a comma. MLA may cite
      // that title in shortened form; compare whole words so an unrelated title with a shared prefix can't match.
      const title = e.text.match(/^\s*(?:“([^”]+)”|"([^"]+)"|‘([^’]+)’|'([^']+)')/u)?.slice(1).find(Boolean);
      if (title) {
        const name = S().fold(article(c.name)), full = S().fold(article(title));
        return !!name && (name === full || full.startsWith(name + ' '));
      }
      const name = S().fold(c.name.replace(/\s+(?:and|&|et al\.).*$/, ''));
      const lead = e.text.match(/^\s*([^,]+),/);
      return lead && name === S().fold(lead[1]);
    });
    for (const c of found) {
      if (inList(c)) continue;
      for (const id of c.ids) used.add(id);
      const [from, to] = c.at;
      if (!c.ids.length && c.name && (c.page || c.year || c.kind === 'note') && !hasEntry(c)) {
        issues.push(ISSUE(from, to, t('{name} is cited but has no entry', { name: c.name }), { title: listName, name: c.name, action: 'add-source' }));
        continue;
      }
      if (opts.shape !== false && k === 'mla9' && c.kind === 'paren' && c.sep === ',' && c.page && /^[\dxivlc]/i.test(c.page)) {
        const fixed = c.text.replace(`${c.name}, ${c.page}`, `${c.name} ${c.page}`);
        if (fixed !== c.text) issues.push({ ...ISSUE(from, to, t('MLA citation'), { title: t('MLA citation') }), suggestions: [fixed], sure: true });
      }
      if (k === 'apa7' && c.kind === 'paren' && !c.year && c.ids.length) {
        const s = c.ids.length === 1 ? all.find((x) => x.id === c.ids[0]) : null;
        const replacement = s ? join([c.name, D.apa(s.issued), c.page ? (/^p/i.test(c.page) ? c.page : apaPages(c.page)) : '']) : '';
        const fixed = replacement && c.part ? c.text.replace(c.part, replacement) : '';
        issues.push({ ...ISSUE(from, to, t('Add the year'), { title: t('APA citation') }), suggestions: fixed ? [fixed] : [] });
      }
    }
    // Typed entries that no citation names, and the typed list's order.
    if (typed?.entries.length) {
      const keys = typed.entries.map((e) => fold(article(e.text.replace(/^[“"‘']/, ''))));
      for (let i = 1; i < keys.length; i++) {
        if (keys[i] < keys[i - 1]) { issues.push(ISSUE(T.posAt(typed.entries[i].from), T.posAt(typed.entries[i].to), t('{list} is out of order', { list: typed.title }), { title: typed.title })); break; }
      }
    }
    for (const s of all) {
      if (used.has(s.id)) continue;
      const k2 = keysOf(s)[0];
      const line = typed?.entries.find((e) => k2 && S().fold(e.text).startsWith(k2));
      const label = who(s) ? N.cite(who(s).names) : plain(shortTitle(s));
      const at = line ? [T.posAt(line.from), T.posAt(line.to)] : [end, end];
      issues.push(ISSUE(at[0], at[1], t('{name} is never cited', { name: label }), { title: listName, sourceId: s.id, action: 'cite' }));
    }
    return issues;
  };
  const count = (doc, sources, st) => {
    const all = S().dedupe(sources), ids = new Set();
    for (const c of cites(doc, all, st)) for (const id of c.ids) ids.add(id);
    return { cited: ids.size, total: all.length };
  };

  return { STYLES, TITLES, INSIDE, format, list, check, cites, count, shortTitle, pages };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_CITE;
