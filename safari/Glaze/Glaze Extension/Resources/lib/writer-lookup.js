// Glaze Writer's citation lookups, only on the student's click in the Cite popover (writer-cite.js): a DOI through doi.org's
// content negotiation (CSL-JSON), an ISBN through Open Library's books API, a web page's own citation_*, Dublin Core, og:
// and JSON-LD (schema.org) metadata and its <title>. doi.org and openlibrary.org answer every origin (CORS); a page's host
// is asked for from the click (chrome.permissions.request, the editor frame's own), exactly that https host.
// The writer frame may not connect anywhere (writer.html's CSP), so the worker fetches ('glaze:writer-lookup' { kind,
// value } from writer.html only → { ok, text, url, type } | { ok: false, error }): no credentials or referrer, no
// cache, one 10 s deadline, checked manual redirects, at most 2 MB read (a page's head is in its first bytes; JSON over that is refused), https all the way. The
// frame parses what comes back as untrusted text: JSON.parse, and DOMParser for HTML (no script runs, nothing loads), and
// keeps only text fields that lib/writer-sources.js normalize cleans.
// serve(m, sender, env) and listener(env) are the worker's half (it imports lib/writer-sources.js first); the parsers are
// pure (node tests feed them saved responses); facts(doc) reads a parsed Document. Classic script; module.exports for node.
var GZ_WRITER_LOOKUP = globalThis.GZ_WRITER_LOOKUP || (() => {
  const S = () => (typeof GZ_WRITER_SOURCES !== 'undefined' ? GZ_WRITER_SOURCES : require('./writer-sources.js'));
  const LIMIT = { bytes: 2 << 20, time: 10000, redirects: 5, text: 8000 };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : Array.isArray(v) ? str(v[0]) : '');

  // ---- what the student pasted ----------------------------------------------------------------------------------------
  // A public https host: a name with a dot, no address, no local or internal name.
  const PUBLIC = /^(?=.{4,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]{1,59})$/;
  const pageUrl = (v) => {
    let s = String(v || '').trim();
    if (!s || /\s/.test(s)) return '';
    if (!/^[a-z][a-z\d+.-]*:/i.test(s)) s = `https://${s}`;
    let u;
    try { u = new URL(s); } catch { return ''; }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port) return '';
    u.protocol = 'https:';
    u.hash = '';
    return PUBLIC.test(u.hostname) && !/\.(local|localdomain|home\.arpa|internal|localhost|test|example|invalid|lan|home|corp)$/.test(u.hostname) ? u.href : '';
  };
  // → { kind: 'doi'|'isbn'|'url', value } or null.
  const classify = (input) => {
    const s = String(input || '').trim().slice(0, 2000);
    if (!s) return null;
    const d = S().doi(s.replace(/^doi:\s*/i, ''));
    if (d && (/^(doi:\s*)?10\./i.test(s) || /^(https?:\/\/)?(dx\.)?doi\.org\//i.test(s))) return { kind: 'doi', value: d };
    const i = S().isbn(s);
    if (i) return { kind: 'isbn', value: i };
    const u = pageUrl(s);
    if (u) return { kind: 'url', value: u };
    return d ? { kind: 'doi', value: d } : null;
  };
  // → { url, accept, json, open } for the worker's fetch, or null for anything else.
  const request = (kind, value) => {
    if (kind === 'doi') {
      const d = S().doi(value);
      return d && d === value ? { url: `https://doi.org/${d.split('/').map(encodeURIComponent).join('/')}`, accept: 'application/vnd.citationstyles.csl+json', json: true, open: true } : null;
    }
    if (kind === 'isbn') {
      const i = S().isbn(value);
      return i && i === value ? { url: `https://openlibrary.org/api/books?bibkeys=ISBN:${i}&format=json&jscmd=data`, accept: 'application/json', json: true, open: true } : null;
    }
    if (kind === 'url') { const u = pageUrl(value); return u && u === value ? { url: u, accept: 'text/html,application/xhtml+xml', json: false, open: false } : null; }
    return null;
  };

  // ---- the worker's half ----------------------------------------------------------------------------------------------
  // env: { fetch, reach(url) → whether the browser holds its host, id: the extension's id, page: writer.html's address }.
  const bounded = (promise, signal) => new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  const discard = (res) => { try { Promise.resolve(res?.body?.cancel?.()).catch(() => {}); } catch { /* already read */ } };
  const read = async (res, max, signal) => {
    const type = res.headers.get('content-type') || '';
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] || 'utf-8';
    let dec;
    try { dec = new TextDecoder(charset); } catch { dec = new TextDecoder('utf-8'); }
    if (!res.body?.getReader) {
      const len = res.headers.get('content-length');
      if (len == null || +len > max) return { text: '', over: true };
      const t = await bounded(res.text(), signal);
      return { text: t.slice(0, max), over: new TextEncoder().encode(t).length > max };
    }
    const reader = res.body.getReader();
    let text = '', bytes = 0, over = false, done = false;
    try {
      for (;;) {
        const chunk = await bounded(reader.read(), signal);
        if (chunk.done) { done = true; break; }
        const value = chunk.value, remaining = max - bytes;
        bytes += value.byteLength;
        text += dec.decode(value.subarray(0, remaining), { stream: true });
        if (bytes > max) { over = true; break; }
      }
      return { text: text + dec.decode(), over };
    } finally {
      if (!done) try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* closed */ }
      try { reader.releaseLock?.(); } catch { /* pending read cancelled by the fetch signal */ }
    }
  };
  const agencies = (doi) => [`https://api.crossref.org/v1/works/${encodeURIComponent(doi)}/transform`, `https://data.crosscite.org/${doi.split('/').map(encodeURIComponent).join('/')}`];
  const serve = async (m, s, env) => {
    if (!s || s.id !== env.id || typeof s.url !== 'string' || s.url.split(/[?#]/)[0] !== env.page) return { ok: false, error: 'sender' };
    const r = request(m?.kind, m?.value);
    if (!r) return { ok: false, error: 'input' };
    if (!r.open && !await env.reach(r.url)) return { ok: false, error: 'host' };
    const ctl = new AbortController(), signal = ctl.signal;
    const timer = setTimeout(() => ctl.abort(new DOMException('Lookup timed out', 'TimeoutError')), LIMIT.time);
    const fixed = m.kind === 'doi' ? agencies(m.value) : [], fallbacks = fixed.slice();
    const open = (url) => r.open && (url === r.url || fixed.includes(url));
    let res, url = r.url;
    try {
      for (let hop = 0; hop <= LIMIT.redirects; hop++) {
        if (pageUrl(url) !== url) return { ok: false, error: 'failed' };
        if (hop && !open(url) && !await env.reach(url)) return { ok: false, error: 'host' };
        res = await bounded(env.fetch(url, { method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: r.accept }, signal }), signal);
        if (res.type === 'opaqueredirect') {
          discard(res);
          // Fetch hides Location in browsers. DOI agencies expose fixed, public CSL routes; never guess a page's target.
          const next = fallbacks.shift();
          if (!next) return { ok: false, error: 'redirect' };
          url = next;
          continue;
        }
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          discard(res);
          if (!location) return { ok: false, error: 'redirect' };
          const next = new URL(location, url);
          next.hash = '';
          if (next.protocol !== 'https:' || pageUrl(next.href) !== next.href) return { ok: false, error: 'redirect' };
          url = next.href;
          continue;
        }
        if (!res.ok && url !== r.url && fallbacks.length && (res.status === 404 || res.status === 406)) { discard(res); url = fallbacks.shift(); continue; }
        if (res.url && res.url !== url && (pageUrl(res.url) !== res.url || (!open(res.url) && !await env.reach(res.url)))) return { ok: false, error: 'failed' };
        if (!res.ok) return res.status === 404 ? { ok: false, error: 'missing' } : { ok: false, error: 'status', status: res.status };
        const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (r.json ? !/json/.test(type) : !/^(text\/html|application\/xhtml\+xml)$/.test(type)) return { ok: false, error: 'type' };
        const { text, over } = await read(res, LIMIT.bytes, signal);
        if (over && r.json) return { ok: false, error: 'size' };
        return { ok: true, text, type, url: res.url || url };
      }
      return { ok: false, error: 'redirect' };
    } catch (e) {
      return { ok: false, error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'failed' };
    } finally { clearTimeout(timer); ctl.abort(); discard(res); }
  };

  // The worker's onMessage listener; env() is read per message (fetch, reach, id, page as serve takes them).
  const listener = (env) => (m, s, reply) => {
    if (m?.type !== 'glaze:writer-lookup') return undefined;
    serve(m, s, env()).then(reply, () => reply({ ok: false, error: 'failed' }));
    return true;
  };

  // ---- doi.org: CSL-JSON (Crossref, DataCite and the other agencies answer in it) ----------------------------------
  const csl = (o, extra = {}) => S().normalize({ ...o, ...extra });
  const fromCSL = (text) => {
    let j;
    try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
    if (!isObj(j)) return null;
    const title = str(j.title), sub = str(j.subtitle);
    const issued = ['issued', 'published-print', 'published-online', 'published', 'created'].map((k) => j[k]).find((d) => Array.isArray(d?.['date-parts']?.[0]) && d['date-parts'][0][0]);
    const out = {
      type: j.type, title: sub && !title.includes(':') ? `${title}: ${sub[0].toUpperCase()}${sub.slice(1)}` : title,
      'container-title': str(j['container-title']), publisher: str(j.publisher), 'publisher-place': str(j['publisher-place']),
      volume: str(j.volume), issue: str(j.issue), page: str(j.page), edition: str(j.edition), number: str(j.number),
      author: j.author, editor: j.editor, translator: j.translator, issued, DOI: str(j.DOI), ISBN: str(j.ISBN),
      URL: /doi\.org\//i.test(str(j.URL)) ? '' : str(j.URL),
    };
    // A chapter's book: Crossref names it as the container.
    if (/chapter/.test(String(j.type)) && !out['container-title']) out['container-title'] = str(j['container-title-short']);
    return csl(out);
  };

  // ---- Open Library's books API (jscmd=data) --------------------------------------------------------------------------
  const fromOpenLibrary = (text, isbn) => {
    let j;
    try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; }
    const b = isObj(j) ? j[`ISBN:${isbn}`] || Object.values(j).find(isObj) : null;
    if (!isObj(b)) return null;
    const title = str(b.title), sub = str(b.subtitle);
    return csl({
      type: 'book', title: sub ? `${title}: ${sub[0].toUpperCase()}${sub.slice(1)}` : title,
      author: (Array.isArray(b.authors) ? b.authors : []).map((a) => str(a?.name)).filter(Boolean).map((n) => S().name(n)),
      publisher: str(b.publishers?.[0]?.name), 'publisher-place': str(b.publish_places?.[0]?.name), issued: S().date(str(b.publish_date)) || S().date((/\b(1[5-9]|20)\d\d\b/.exec(str(b.publish_date)) || [])[0]),
      ISBN: isbn,
    });
  };

  // ---- a web page -----------------------------------------------------------------------------------------------------
  // A parsed Document (DOMParser, in the frame) → plain facts: its meta pairs, JSON-LD blocks, title, canonical link, text.
  const facts = (doc) => {
    const metas = [];
    for (const m of doc.querySelectorAll('meta[name], meta[property], meta[itemprop]')) {
      const k = (m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('itemprop') || '').trim().toLowerCase();
      const v = m.getAttribute('content');
      if (k && typeof v === 'string' && metas.length < 400) metas.push([k, v.slice(0, 2000)]);
    }
    const jsonld = [...doc.querySelectorAll('script[type="application/ld+json" i]')].slice(0, 20).map((s) => s.textContent.slice(0, 200000));
    const canonical = doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href') || '';
    const body = doc.body ? doc.body.cloneNode(true) : null;
    if (body) for (const n of body.querySelectorAll('script, style, noscript, template, svg, nav, footer, header, form, iframe')) n.remove();
    const text = (body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, LIMIT.text);
    return { metas, jsonld, title: (doc.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600), canonical, text };
  };
  const TYPES_LD = { article: 'webpage', newsarticle: 'article-newspaper', reportagenewsarticle: 'article-newspaper', analysisnewsarticle: 'article-newspaper', opinionnewsarticle: 'article-newspaper',
    scholarlyarticle: 'article-journal', blogposting: 'webpage', socialmediaposting: 'webpage', webpage: 'webpage', book: 'book', chapter: 'chapter', videoobject: 'motion_picture', report: 'report', techarticle: 'webpage' };
  const ldNodes = (blocks) => {
    const out = [];
    const walk = (v, depth) => {
      if (depth > 4 || out.length > 50) return;
      if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
      if (!isObj(v)) return;
      if (v['@graph']) walk(v['@graph'], depth + 1);
      const types = [].concat(v['@type'] || []).map((t) => String(t).toLowerCase());
      if (types.some((t) => TYPES_LD[t])) out.push({ v, type: TYPES_LD[types.find((t) => TYPES_LD[t])] });
    };
    for (const b of blocks) { try { walk(JSON.parse(b), 0); } catch { /* not JSON */ } }
    // The most specific first: an article or book over the page that holds it.
    return out.sort((a, b) => (a.type === 'webpage') - (b.type === 'webpage'));
  };
  const ldName = (v) => (typeof v === 'string' ? v : isObj(v) ? str(v.name) || [str(v.givenName), str(v.familyName)].filter(Boolean).join(' ') : '');
  const ldPeople = (v) => [].concat(v || []).map((a) => (isObj(a) && /organization/i.test(String(a['@type'])) ? { literal: ldName(a) } : ldName(a))).filter((a) => a && (typeof a === 'string' ? !/^https?:/.test(a) : a.literal));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  // facts + the address it came from (+ when it was read) → a source, or null.
  const fromFacts = (f, from, now = new Date()) => {
    if (!isObj(f)) return null;
    const all = (k) => (f.metas || []).filter(([n]) => n === k).map(([, v]) => v.trim()).filter(Boolean);
    const one = (...ks) => { for (const k of ks) { const v = all(k)[0]; if (v) return v; } return ''; };
    const ld = ldNodes(f.jsonld || [])[0];
    const L = ld?.v || {};
    const site = one('og:site_name', 'application-name') || ldName(L.publisher) || ldName(L.isPartOf);
    let type = one('citation_journal_title') ? 'article-journal' : one('citation_inbook_title', 'citation_book_title') ? 'chapter'
      : one('citation_technical_report_institution', 'citation_technical_report_number') ? 'report' : one('citation_isbn') ? 'book' : ld?.type || '';
    const og = one('og:type').toLowerCase();
    if (!type) type = /^video/.test(og) || /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(hostOf(from)) ? 'motion_picture' : og === 'book' ? 'book' : 'webpage';
    const authors = all('citation_author').length ? all('citation_author') : all('dc.creator').length ? all('dc.creator') : ldPeople(L.author).length ? ldPeople(L.author) : all('author').filter((a) => !/^https?:/.test(a)).slice(0, 10);
    // A video's channel is who uploaded it.
    const video = type === 'motion_picture';
    const titleTag = (f.title || '').replace(site ? new RegExp(`\\s*[|·•–—-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') : /$^/, '');
    const first = one('citation_firstpage'), last = one('citation_lastpage');
    let url = from;
    const canon = one('og:url') || f.canonical || str(L.url);
    if (canon) try { const c = new URL(canon, from); if (c.protocol === 'https:' && hostOf(c.href) === hostOf(from)) url = c.href; } catch { /* keep where it came from */ }
    const date = one('citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date', 'article:published_time', 'date', 'pubdate', 'parsely-pub-date', 'datepublished', 'uploaddate')
      || str(L.datePublished) || str(L.uploadDate) || str(L.dateCreated) || one('article:modified_time') || str(L.dateModified);
    return S().normalize({
      type,
      title: one('citation_title', 'dc.title') || str(L.headline) || str(L.name) || one('og:title', 'twitter:title') || titleTag,
      author: video ? [] : authors,
      'container-title': one('citation_journal_title', 'citation_inbook_title', 'citation_book_title', 'citation_conference_title') || (type === 'chapter' ? '' : video ? site || hostOf(from) : site),
      publisher: video ? ldName(L.author) || one('author') || '' : one('citation_publisher', 'citation_technical_report_institution', 'citation_dissertation_institution', 'dc.publisher'),
      volume: one('citation_volume'), issue: one('citation_issue'), page: first ? (last && last !== first ? `${first}-${last}` : first) : '', number: one('citation_technical_report_number'),
      issued: S().date(date), DOI: one('citation_doi', 'dc.identifier', 'prism.doi').replace(/^doi:/i, ''), ISBN: one('citation_isbn', 'book:isbn') || str(L.isbn),
      URL: url, accessed: type === 'webpage' || video || type.startsWith('article-') ? S().today(now) : null,
    });
  };
  // Whether a page's metadata left the student little to go on: no title, or no one and no date.
  const thin = (s) => !s || !s.title || (!s.author && !s.issued);
  // Fields the student or the model didn't have filled in from another source of the same work.
  const merge = (base, more) => { const b = S().normalize(base), m = S().normalize(more); if (!b) return m; if (!m) return b; return S().normalize({ ...m, ...b, id: b.id }); };

  return { LIMIT, classify, request, serve, listener, fromCSL, fromOpenLibrary, facts, fromFacts, thin, merge, pageUrl };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_LOOKUP;
