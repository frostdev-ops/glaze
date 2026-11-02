// A turn's positively recognized page/document, never authority for facts, consent or account identity.
// Capture and the worker establish freshness; this pure boundary keeps only bounded, typed reference data.
var GZ_AI_CURRENT = globalThis.GZ_AI_CURRENT || (() => {
  const T = () => (typeof GZ_AI_TASKS !== 'undefined' ? GZ_AI_TASKS : require('./task.js'));
  const X = () => (typeof GZ_AI_TEXT !== 'undefined' ? GZ_AI_TEXT : require('./text.js'));
  const SITES = ['canvas', 'ultra', 'moodle'];
  const VIEWS = ['page', 'course', 'assignment', 'content', 'discussion', 'document', 'dashboard'];
  const CONTENT = ['page', 'file', 'assignment', 'quiz', 'discussion', 'link', 'document', 'folder', 'module', 'test'];
  const DOCUMENT = ['paper', 'compose', 'discussion', 'journal', 'assignment', 'document'];
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const keys = (v, allowed) => obj(v) && Object.keys(v).every((k) => allowed.includes(k));
  const title = (v) => typeof v === 'string' ? X().plain(v).trim().slice(0, 240).trimEnd() : '';
  const id = (v, site) => typeof v === 'string' && (site === 'ultra' ? /^(?:\d{1,20}|_\d{1,18}_\d{1,18})$/ : /^\d{1,20}$/).test(v) && v.length <= 40;
  // A modest share of the trusted window, separate from identity. The normal complete-request count still reserves
  // answers and thinking, and rejects overflow; no page field can enlarge this allowance or shrink those reserves.
  const materialLimit = (caps) => Math.floor(768 * T().retention(caps).scale);
  const url = (v, site) => {
    if (typeof v !== 'string' || v.length > 1200 || /[\p{Cc}\p{Bidi_Control}]/u.test(v)) return '';
    try {
      const u = new URL(v);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return '';
      u.hash = '';
      const query = [...u.searchParams];
      u.search = '';
      for (const [k, value] of query) if (['id', 'courseid', 'course_id', 'content_id', 'assignment_id', 'discussion_id'].includes(k) && id(value, site)) u.searchParams.append(k, value);
      return u.href.length <= 1200 ? u.href : '';
    } catch { return ''; }
  };
  const clean = (raw, { caps } = {}) => {
    if (!keys(raw, ['site', 'view', 'url', 'title', 'course', 'assignment', 'content', 'document', 'material']) || !SITES.includes(raw.site) || !VIEWS.includes(raw.view)) return null;
    const out = { site: raw.site, view: raw.view };
    const u = url(raw.url, raw.site), t = title(raw.title);
    if (u) out.url = u;
    if (t) out.title = t;
    for (const [name, label] of [['course', 'name'], ['assignment', 'title'], ['content', 'title']]) {
      const v = raw[name];
      if (!keys(v, ['id', label, ...(name === 'content' ? ['kind'] : [])]) || !id(v.id, raw.site)) continue;
      out[name] = { id: v.id };
      const text = title(v[label]);
      if (text) out[name][label] = text;
      if (name === 'content' && CONTENT.includes(v.kind)) out[name].kind = v.kind;
    }
    const d = raw.document;
    if (keys(d, ['id', 'title', 'kind', 'revision', 'saved'])) {
      const doc = {};
      if (typeof d.id === 'string' && /^document:[0-9a-f]{32}$/.test(d.id)) doc.id = d.id;
      const text = title(d.title);
      if (text) doc.title = text;
      if (DOCUMENT.includes(d.kind)) doc.kind = d.kind;
      if (Number.isSafeInteger(d.revision) && d.revision >= 0) doc.revision = d.revision;
      if (typeof d.saved === 'boolean') doc.saved = d.saved;
      if (Object.keys(doc).length) out.document = doc;
    }
    const m = raw.material;
    if (keys(m, ['text', 'source', 'truncated']) && typeof m.text === 'string' && typeof m.truncated === 'boolean'
      && (m.source === 'writer' && out.document || m.source === 'instructions' && (out.assignment || out.content))) {
      const text = X().plain(m.text).trim(), limit = materialLimit(caps);
      // UTF-8 bytes, not UTF-16 units: multilingual material receives the same bounded request share.
      let bytes = 0, cut = '';
      const encoder = new TextEncoder();
      for (const c of text) { const n = encoder.encode(c).length; if (bytes + n > limit) break; bytes += n; cut += c; }
      // Cutting at whitespace must stay canonical when the native request reader cleans this excerpt again.
      cut = cut.trimEnd();
      if (cut) out.material = { text: cut, source: m.source, truncated: m.truncated || cut.length < text.length };
    }
    return out;
  };
  return { clean, materialLimit, SITES, VIEWS, CONTENT, DOCUMENT };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_CURRENT;
