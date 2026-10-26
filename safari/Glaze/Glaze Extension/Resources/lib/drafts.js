// Backing up Ultra editors and Canvas new Inbox messages: the parts that don't touch the page, so node can test them.
// Classic script for the content script; module.exports for node.
// Loaded on demand (content.js need()): a second injection into the same frame keeps the first.
var GZ_DRAFTS = globalThis.GZ_DRAFTS || (() => {
  const KEEP = 14 * 864e5;
  // Shorter than this isn't worth keeping, and could turn up elsewhere on the page by chance.
  const MIN = 20;
  // An editor and the post it becomes lay out whitespace differently (paragraphs, nbsp, zero-width
  // spaces), so text is compared without any.
  const squash = (t) => (t || '').replace(/[\s\p{Cf}]+/gu, '');
  const worth = (t) => squash(t).length >= MIN;
  // How often all of what was written shows on the page outside the editors. Posted: more often than `before`, the count
  // as it was sent. A post that starts the same way (a quotation, a shared introduction), shows only its start (Read
  // more), or was there already (someone else wrote the same) proves nothing: the copy stays until it is dismissed, three
  // newer ones take its place, or it is 14 days old.
  const count = (text, page) => (worth(text) ? squash(page).split(squash(text)).length - 1 : 0);
  const posted = (text, page, before = 0) => count(text, page) > before;
  // The storage.local keys to delete: copies 14 days old or malformed, or all of them with the feature off. And any Ultra
  // copy kept before keys had a site and an account (draft:/ultra/…, a path alone): nothing says whose it is, and keeping it
  // for whoever signs in first is how another account was offered it, so it goes whatever its age.
  const stale = (all, now, on = true) => Object.keys(all || {}).filter((k) => k.startsWith('draft:') && (!on || k.startsWith('draft:/') || ![all[k], ...(Array.isArray(all[k]?.prev) ? all[k].prev : [])].some((c) => Number.isFinite(c?.at) && now - c.at < KEEP)));
  // Ultra: per site, signed-in user, page and editor (m: origin, user, path, near, id; near and id are the page's own ids
  // for the post and the editor, as content.js draftAt reads them). null where there is no user to keep it for.
  const ultraKey = (m) => (m && /^https?:\/\/[^/]+$/.test(m.origin) && typeof m.user === 'string' && /^[\w.-]{1,64}$/.test(m.user) && typeof m.path === 'string' && m.path.startsWith('/')
    ? `draft:ultra:${m.origin}/${m.user}${m.path}#${m.near ?? ''}/${m.id ?? ''}` : null);
  // What is stored for one editor: the newest copy, and in `prev` older ones, at most COPIES. Each is a page's own (`id`, one
  // a page, which only that page's next copy replaces) and stays until it is restored, dismissed, posted or 14 days old.
  const COPIES = 3;
  const isId = (id) => typeof id === 'string' && /^[a-z0-9]{8,32}$/.test(id);
  const usable = (c, now) => !!c && typeof c === 'object' && typeof c.text === 'string' && typeof c.html === 'string' && Number.isFinite(c.at) && now - c.at < KEEP;
  const strip = ({ html, text, at, id, canvas }) => ({ html, text, at, ...(isId(id) && { id }), ...(canvas && { canvas }) });
  // → the copies in a stored record, newest first; a record from before there were `prev`s is one copy.
  const unpack = (rec, now = Date.now()) => [rec, ...(Array.isArray(rec?.prev) ? rec.prev : [])].filter((c) => usable(c, now)).map(strip);
  // live: the page's own copy (or null), held: the others, newest first → the record to store, or null for nothing to keep.
  const pack = (live, held, now = Date.now()) => {
    const [top, ...prev] = [live, ...(held || [])].filter((c) => usable(c, now)).slice(0, COPIES).map(strip);
    return top ? (prev.length ? { ...top, prev } : top) : null;
  };
  const canvasRecipient = (id) => {
    const raw = id?.match(/^address-book-label-(.+)-user$/)?.[1];
    if (/^\d+$/.test(raw)) return raw;
    try { return btoa(atob(raw)) === raw ? atob(raw).match(/^MessageableUser-(\d+)$/)?.[1] || null : null; } catch { return null; }
  };
  // New Canvas messages have no thread yet: require the full destination and subject before keeping one.
  const canvasKey = (m) => {
    if (!m || !/^https?:\/\/[^/]+$/.test(m.origin) || !/^\d+$/.test(m.user) || !/^\d+$/.test(m.course)
      || typeof m.subject !== 'string' || !m.subject.trim() || m.subject.length > 255 || !Array.isArray(m.to) || !m.to.length || m.to.some((id) => !/^\d+$/.test(id))) return null;
    return `draft:canvas:${JSON.stringify([m.origin, m.user, m.course, [...new Set(m.to)].sort(), m.subject])}`;
  };
  const sent = (d, c) => {
    const m = d?.canvas;
    return !!canvasKey(m) && c?.subject === m.subject && c.context_code === `course_${m.course}`
      && JSON.stringify((c.participants || []).map((p) => String(p.id)).filter((id) => id !== m.user).sort()) === JSON.stringify([...new Set(m.to)].sort())
      && (c.messages || []).some((msg) => String(msg.author_id) === m.user && msg.body === d.text && Date.parse(msg.created_at) >= d.at - 1000);
  };
  // Stored HTML is untrusted, including older copies. Rebuild a small editor vocabulary in inert DOM, rather than
  // inserting parsed nodes or keeping attributes whose browser interpretation may differ from a string check.
  const restoreHTML = (copy, doc) => {
    const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const plain = () => escape(copy.text || '').replace(/\n/g, '<br>');
    try {
      const Parser = doc.defaultView?.DOMParser || globalThis.DOMParser, out = doc.createElement('div');
      if (!Parser) return plain();
      // An inert document: nothing in it runs or loads, and nothing is assigned as markup to the page.
      const parsed = new Parser().parseFromString(copy.html, 'text/html');
      const tags = new Set('P DIV SPAN BR STRONG B EM I U S STRIKE SUB SUP BLOCKQUOTE PRE CODE H1 H2 H3 H4 H5 H6 UL OL LI A IMG TABLE THEAD TBODY TFOOT TR TH TD HR AUDIO VIDEO SOURCE'.split(' '));
      const skip = new Set('SCRIPT STYLE IFRAME OBJECT EMBED TEMPLATE NOSCRIPT LINK META BASE HEAD TITLE FORM INPUT BUTTON TEXTAREA SELECT'.split(' '));
      const url = (raw, image = false) => {
        if (!raw) return null;
        if (image && /^data:image\/(?:png|gif|jpeg|webp);base64,(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(raw)) return raw;
        try {
          const u = new URL(raw, doc.baseURI);
          return /^(https?:|mailto:|tel:)$/.test(u.protocol) && (!image || /^https?:$/.test(u.protocol)) ? u.href : null;
        } catch { return null; }
      };
      const walk = (node, parent) => {
        if (node.nodeType === 3) { parent.append(doc.createTextNode(node.data)); return; }
        if (node.nodeType !== 1 || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || skip.has(node.tagName)) return;
        let el = parent;
        if (tags.has(node.tagName)) {
          el = doc.createElement(node.tagName.toLowerCase());
          const link = node.tagName === 'A', media = ['IMG', 'AUDIO', 'VIDEO', 'SOURCE'].includes(node.tagName);
          const href = (link || media) && url(node.getAttribute(link ? 'href' : 'src'), media);
          if (href) el.setAttribute(link ? 'href' : 'src', href);
          for (const attr of ['title', ...(node.tagName === 'IMG' ? ['alt'] : [])]) if (node.hasAttribute(attr)) el.setAttribute(attr, node.getAttribute(attr));
          for (const attr of ['width', 'height', 'colspan', 'rowspan']) if (/^[1-9]\d{0,3}$/.test(node.getAttribute(attr) || '')) el.setAttribute(attr, node.getAttribute(attr));
          const classes = (node.getAttribute('class') || '').split(/\s+/).filter((c) => /^ql-(?:align-(?:center|right|justify)|direction-rtl|indent-[1-8]|size-(?:small|large|huge)|font-(?:serif|monospace))$/.test(c));
          if (classes.length) el.className = classes.join(' ');
          if (['AUDIO', 'VIDEO'].includes(node.tagName)) el.setAttribute('controls', '');
          parent.append(el);
        }
        for (const child of node.childNodes) walk(child, el);
      };
      for (const child of parsed.body.childNodes) walk(child, out);
      return out.innerHTML || plain();
    } catch { return plain(); }
  };
  // Parse canonical destinations, including a journal entry's encoded destination. A prefix alone is not an account.
  const owner = (key) => {
    try {
      if (key.startsWith('draft:pending:')) key = decodeURIComponent(key.split(':')[2]);
      if (key.startsWith('draft:canvas:')) {
        const [origin, user, course, to, subject] = JSON.parse(key.slice(13));
        return canvasKey({ origin, user, course, to, subject }) === key ? { site: 'canvas', origin, user } : null;
      }
      const m = key.match(/^draft:ultra:(https?:\/\/[^/]+)\/(_\d+_\d+)(\/ultra(?:\/[^#]*)?)#([^/]*)\/(.*)$/);
      if (m && new URL(m[1]).origin === m[1]) return { site: 'ultra', origin: m[1], user: m[2] };
    } catch { /* not a canonical draft destination */ }
    return null;
  };
  // Immutable write-ahead entries do not replace another tab's record. They remain recoverable even if the worker
  // never wakes; the worker folds them into the three-copy record before removing just the entries it read.
  const pendingPrefix = (key) => `draft:pending:${encodeURIComponent(key)}:`;
  const pendingKey = (m) => `${pendingPrefix(m.key)}${m.put?.id || 'drop'}:${m.at}:${Math.random().toString(36).slice(2)}`;
  // A copy without a page id is marked gone by a hash of its text, so what was dismissed isn't kept as its marker.
  const sum = (t) => {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
  };
  const mark = (c) => (c.id ? { id: c.id, at: c.at } : { at: c.at, sum: c.sum ?? sum(c.text) });
  const same = (c, x) => (x.id ? c.id === x.id : !c.id && (c.sum ?? sum(c.text)) === x.sum) && c.at === x.at;
  const marker = (x) => x && Number.isFinite(x.at) && (isId(x.id) || (!x.id && typeof x.sum === 'string'));
  const apply = (rec, m, now = Date.now()) => {
    const canvas = m.key.startsWith('draft:canvas:');
    const put = m.put && strip(m.put);
    if (put && !(usable(put, now) && put.id && worth(put.text) && (!canvas || canvasKey(put.canvas) === m.key))) return null;
    const drop = (Array.isArray(m.drop) ? m.drop : []).filter(marker);
    const gone = [...(Array.isArray(rec?.gone) ? rec.gone : []), ...drop].filter((x) => marker(x) && now - x.at < KEEP)
      .filter((x, i, a) => a.findIndex((v) => same(v, x)) === i);
    const blocked = (c) => gone.some((x) => x.id ? x.id === c.id && x.at >= c.at : same(c, x));
    const was = unpack(rec, now).filter((c) => (!canvas || canvasKey(c.canvas) === m.key) && !blocked(c));
    const newer = put && !blocked(put) && !was.some((c) => c.id === put.id && c.at >= put.at);
    const all = [...(newer ? [put] : []), ...was.filter((c) => !(newer && c.id === put.id))].sort((a, b) => b.at - a.at);
    // Remember evictions and clears for the lifetime of an in-flight version, even when there is no text left.
    for (const c of all.slice(COPIES)) if (!gone.some((x) => same(c, x))) gone.push(mark(c));
    const copies = all.slice(0, COPIES);
    return { ...(pack(copies[0], copies.slice(1), now) || { at: now }), ...(gone.length && { gone }) };
  };
  const load = async (key, local) => {
    const keys = local.keys && await local.keys();
    const all = await local.get(keys ? keys.filter((k) => k === key || k.startsWith(pendingPrefix(key))) : null);
    return Object.fromEntries(Object.entries(all || {}).filter(([k]) => k === key || k.startsWith(pendingPrefix(key))));
  };
  const fold = (key, all, now = Date.now()) => {
    let rec = all[key];
    for (const [k, m] of Object.entries(all).filter(([k, m]) => k.startsWith(pendingPrefix(key)) && m?.key === key && now - m.at < KEEP).sort((a, b) => a[1].at - b[1].at)) {
      rec = apply(rec, m, now) || rec;
    }
    return rec;
  };
  // The journal entries a page may remove itself (all: the record and entries it read): those holding only a copy that
  // folding leaves out, as a newer version, a dismissal or three newer copies took its place, or this page's older versions.
  // What is left is at most the copies a record holds, and the dismissals the worker hasn't had yet.
  const superseded = (m, all, now = Date.now()) => {
    const kept = unpack(fold(m.key, all, now), now);
    return Object.keys(all).filter((k) => k.startsWith(pendingPrefix(m.key)) && all[k]?.put && !all[k].drop?.length
      && ((m.put?.id && all[k].put.id === m.put.id && all[k].put.at < m.put.at) || !kept.some((c) => c.id === all[k].put.id && c.at === all[k].put.at)));
  };
  const change = async (m, local, now = Date.now()) => {
    if (!apply(null, m, now)) return { ok: false, error: 'bad' };
    const all = await load(m.key, local), rec = apply(fold(m.key, all, now), m, now);
    const copies = unpack(rec, now), pending = Object.keys(all).filter((k) => k !== m.key);
    if (!m.put && !m.drop?.length && !pending.length) return { ok: true, copies };
    const ok = await local.set({ [m.key]: rec });
    if (ok && pending.length) await local.remove(pending);
    return { ok, copies };
  };
  // The sweep a page starts (content.js tidyDrafts, s: its storage.local, all: what it read there). With backup off every copy
  // goes; with it on, the worker's queue takes those still stale when its turn comes (sweep), as another tab may have just
  // kept a copy there.
  const tidy = (s, all, on) => {
    const old = stale(all, Date.now(), on);
    if (old.length && !on) s.remove(old);
    else if (old.length) chrome.runtime.sendMessage({ type: 'glaze:drafts', sweep: old }, () => void chrome.runtime.lastError);
  };
  const sweep = async (keys, local, now = Date.now()) => {
    const old = stale(await local.get(keys), now);
    return { ok: !old.length || await local.remove(old) };
  };
  return { squash, worth, count, posted, stale, ultraKey, pack, unpack, canvasKey, canvasRecipient, sent, change, tidy, sweep, load, fold, pendingKey, pendingPrefix, owner, superseded, mark, restoreHTML };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_DRAFTS; else GZ_DRAFTS;
