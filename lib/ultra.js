// Blackboard Ultra's answers, in the shapes Glaze's features use. Pure apart from what callers pass in, so node can test
// it. Shapes and rules come from the B0 spike (parity/spikes/B0.md).
// Classic script, loaded on demand (content.js need()): a second injection keeps the first; module.exports for node.
var GZ_ULTRA = globalThis.GZ_ULTRA || (() => {
  const P = typeof GZ_PAGE !== 'undefined' ? GZ_PAGE : require('./page.js');
  const ID = /^_\d+_\d+$/;
  const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');

  // ---- course content: folder previews and Download all ------------------------------------------------------------
  // Ultra's private content API sends each item's contentDetail, and an LTI link with its own credentials carries the
  // tool's `secret` and `key` there. Every way of asking tried in B0 kept them (no query, @view=Summary, nested
  // fields), except a `fields` list that leaves contentDetail out. So Glaze asks with these lists only, and keeps
  // only what it uses.
  const PEEK_FIELDS = 'id,title,state,genericReadOnlyData';
  const peekItem = (c) => ({ id: str(c?.id, 40), title: str(c?.title), state: str(c?.state, 20), genericReadOnlyData: { dueDate: str(c?.genericReadOnlyData?.dueDate, 40) || undefined } });
  const FILES_FIELDS = 'id,title,contentHandler,state,body';
  const FILE = 'resource/x-bb-file';
  // A File item's file, with contentDetail left out, comes from the public API's attachments for it: download
  // addresses on origin (Blackboard redirects them to the bytes).
  const attachments = (origin, cid, id, results) => (ID.test(cid) && ID.test(id) && Array.isArray(results) ? results : [])
    .filter((a) => ID.test(a?.id)).map((a) => ({ url: `${origin}/learn/api/public/v1/courses/${cid}/contents/${id}/attachments/${a.id}/download`, name: str(a.fileName, 255) || 'file' }));
  // The files under a folder or learning module, subfolders as directories. An Ultra document is a folder to the API
  // (isBbPage, from the public API) whose blocks hold its files. An item not opened yet is left out and counted, so a
  // download never marks it viewed. list(id): its children, asked for with FILES_FIELDS; isPage(item); files(id): a
  // File item's attachments, or null when they can't be read. → { found: [{ url, name, size, dir }], skipped, failed }.
  // ponytail: first 200 children of each folder (the caller's limit).
  const files = async ({ root, list, isPage, attachments: att, origin, safeName }) => {
    const found = [], seen = new Set();
    let skipped = 0, failed = 0;
    const has = (k) => k.contentHandler === FILE || P.files(k, origin).length > 0;
    const walk = async (id, dir) => {
      for (const c of await list(id)) {
        const page = c.contentHandler !== FILE && await isPage(c);
        if (/folder|lesson/.test(c.contentHandler) && !page) { await walk(c.id, `${dir}${safeName(c.title)}/`); continue; }
        const kids = (page ? await list(c.id) : [c]).filter(has);
        if (!kids.length) continue;
        if (c.state !== 'Started' && c.state !== 'Completed') { skipped += 1; continue; }
        for (const k of kids) {
          const fs = k.contentHandler === FILE ? await att(k.id) : P.files(k, origin);
          if (!fs) { failed += 1; continue; }
          for (const f of fs) if (!seen.has(f.url)) { seen.add(f.url); found.push({ url: f.url, name: f.name, size: f.size, dir }); }
        }
      }
    };
    await walk(root, '');
    return { found, skipped, failed };
  };

  return { PEEK_FIELDS, peekItem, FILES_FIELDS, attachments, files };
})();

if (typeof module !== 'undefined') module.exports = GZ_ULTRA; else GZ_ULTRA;
