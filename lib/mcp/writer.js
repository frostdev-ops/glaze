// The writer group's tools for agent apps (lib/mcp/*.js): the student's Writer documents (lib/writer-papers.js), named by
// opaque keys, and lib/writer-tools.js's tools on one of them. documents_list, document_read, document_sources and
// document_assignment answer from Writer's own storage; document_issues, citation_insert and fix_apply need the document
// open in a Writer page (writer-mcp.js), which the worker reaches over port glaze:mcp-writer (pages below).
// deps: { papers(f) → f(the worker's paper store, lib/background.js openPapers: its list() and get() only), run in the
//   broker's turn; bridge(key, op, args, { signal }) → the open page's answer for that paper ({ ok: false, error } when it
//   refused or never answered), or null when no Writer page has it open; bridge(null, 'open') → the keys open in one;
//   session (storage.session: the handles' salt, kept for the browser's session) }. run(args, ctx): ctx.document is the key
//   documents_list gave, ctx.local storage.local (the sources). A change runs in the broker's turn: its summary keeps that
//   same store for a fresh list()/get() there, without queuing another turn inside the one already running.
// Keys: 'document:' and an HMAC of the paper's own key (which holds the school's host and the student's id) under a salt
// of the session's, as the mod API hands mods theirs (lib/modapi.js docKeys); only a listed document has one. Records in
// Trash and kinds this file can't read are left out. Every answer fits calls.js's cap: lists go a part at a time (from).
// Classic script for the worker, after lib/ai/tools.js, lib/doc-home.js, lib/writer-sources.js and lib/writer-tools.js
// (openPapers brings lib/writer-papers.js); module.exports for node.
var GZ_MCP_WRITER = globalThis.GZ_MCP_WRITER || (() => {
  const W = () => (typeof GZ_WRITER_TOOLS !== 'undefined' ? GZ_WRITER_TOOLS : require('../writer-tools.js'));
  const P = () => (typeof GZ_WRITER_PAPERS !== 'undefined' ? GZ_WRITER_PAPERS : require('../writer-papers.js'));
  const SRC = () => (typeof GZ_WRITER_SOURCES !== 'undefined' ? GZ_WRITER_SOURCES : require('../writer-sources.js'));
  const DH = () => (typeof GZ_DOC_HOME !== 'undefined' ? GZ_DOC_HOME : require('../doc-home.js'));
  // answer: a tool's own JSON characters (calls.js adds its fields within its 12,000); outline: a heading's characters; wait:
  // how long a page has to answer, find: to say what it holds; from: the furthest part a list starts at.
  const LIMIT = { answer: 10000, outline: 120, wait: 5000, find: 1500, from: 10000, summary: 2000 };
  const KINDS = ['paper'];
  const SALT = 'mcpDocSalt';
  const HANDLE = /^document:[0-9a-f]{32}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = (error) => ({ ok: false, error });
  const NONE = 'Glaze has no document by that key on this device. documents_list gives the keys.';
  const CLOSED = "Open this document in Glaze Writer first (from Documents, or its assignment's page): Glaze reads its issues and changes it only in an open editor.";
  const LOST = 'Glaze lost track of this document. Call documents_list and try again.';
  const LATE = "The Writer page didn't answer in time; check the document before asking again.";

  // GZ_DOC_HOME.flat's text of a paper's JSON, with its headings: [{ level, text, offset }], offset into that text.
  const read = (doc) => {
    const out = [], outline = [];
    let line = null, at = 0;
    const push = (s) => { out.push(s); at += s.length + 1; };
    const walk = (n) => {
      if (!isObj(n)) return;
      if (typeof n.text === 'string') { line = (line ?? '') + n.text; return; }
      if (n.type === 'hard_break') { push(line ?? ''); line = ''; return; }
      if (!Array.isArray(n.content)) return;
      const block = n.content.some((c) => c && (typeof c.text === 'string' || c.type === 'hard_break' || c.type === 'image' || c.type === 'footnote_ref'));
      if (block) {
        const start = at, first = out.length;
        line = '';
        for (const c of n.content) walk(c);
        push(line);
        line = null;
        if (n.type === 'heading') {
          const text = out.slice(first).join(' ').replace(/\s+/g, ' ').trim();
          if (text) outline.push({ level: Number.isInteger(n.attrs?.level) ? n.attrs.level : 1, text: text.length > LIMIT.outline ? `${text.slice(0, LIMIT.outline - 1)}…` : text, offset: start });
        }
        return;
      }
      for (const c of n.content) walk(c);
    };
    walk(doc);
    if (line != null) push(line);
    return { text: out.join('\n'), outline };
  };

  // The longest start of items whose JSON fits in room characters, and where the next part starts. One oversized row
  // keeps its identity with an explicit omission, so it cannot hide every later row behind calls.js's whole-result cap.
  const fit = (items, from, room) => {
    const all = Array.isArray(items) ? items : [], start = Math.min(from, all.length), out = [];
    let used = 2;
    for (let i = start; i < all.length; i++) {
      let item = all[i], n = JSON.stringify(item).length + (out.length ? 1 : 0);
      if (used + n > room && out.length) break;
      if (used + n > room) {
        const brief = { omitted: true };
        for (const k of ['id', 'key', 'title']) {
          if (typeof item?.[k] !== 'string') continue;
          const v = { ...brief, [k]: item[k].slice(0, 120) };
          if (JSON.stringify(v).length + 2 <= room) Object.assign(brief, v);
        }
        item = brief;
        n = JSON.stringify(item).length;
      }
      out.push(item);
      used += n;
    }
    return { items: out, total: all.length, next: start + out.length < all.length ? start + out.length : null };
  };
  const room = (head) => LIMIT.answer - JSON.stringify(head).length - 64;
  const FROM = { type: 'integer', minimum: 0, maximum: LIMIT.from, description: 'Where this part of the list starts (an earlier answer\'s next); 0 when absent.' };
  // Text pages keep every character, including newlines and surrogate pairs, and budget the escaped JSON as well as
  // the visible text (a control character can take six JSON characters).
  const textPages = (text) => {
    const out = [], max = W().LIMIT.page;
    let part = '', size = 0;
    for (const c of text) {
      const n = JSON.stringify(c).length - 2;
      if (part && (part.length + c.length > max || size + n > 7000)) { out.push(part); part = ''; size = 0; }
      part += c;
      size += n;
    }
    out.push(part);
    return out;
  };

  // ---- keys -----------------------------------------------------------------------------------------------------------
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const handles = (session) => {
    let salt = null;
    const of = new Map(), back = new Map(); // paper key ↔ handle, under this salt
    const secret = () => (salt ||= (async () => {
      const got = session ? (await session.get(SALT))?.[SALT] : null;
      let s = typeof got === 'string' && /^[0-9a-f]{64}$/.test(got) ? got : null;
      if (!s) {
        s = hex(crypto.getRandomValues(new Uint8Array(32)));
        if (session) await session.set({ [SALT]: s });
      }
      return crypto.subtle.importKey('raw', new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })().catch((e) => { salt = null; throw e; }));
    const handle = async (key) => {
      if (of.has(key)) return of.get(key);
      const h = `document:${hex(await crypto.subtle.sign('HMAC', await secret(), new TextEncoder().encode(key))).slice(0, 32)}`;
      of.set(key, h);
      back.set(h, key);
      return h;
    };
    // The listed key a handle names, or null.
    const find = async (h, keys) => {
      if (typeof h !== 'string' || !HANDLE.test(h)) return null;
      if (back.has(h)) return keys.includes(back.get(h)) ? back.get(h) : null;
      const all = await Promise.all(keys.map(handle));
      return keys[all.indexOf(h)] ?? null;
    };
    return { handle, find, known: (h) => back.get(h) ?? null };
  };

  // ---- the stored documents -------------------------------------------------------------------------------------------
  const kindOf = (r) => (typeof r?.kind === 'string' && r.kind) || 'paper';
  const readable = (r) => !!r && typeof r.key === 'string' && P().valid(r.key) && !P().trashed(r) && KINDS.includes(kindOf(r));
  const rows = async (store) => (await store.list()).filter(readable).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const titleOf = (r) => DH().titleOf(r, '', 'Untitled document');
  const formatOf = (f) => (typeof f === 'string' ? f : isObj(f) && typeof f.label === 'string' ? f.label.slice(0, 40) : '');
  const when = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const due = (v) => (typeof v === 'string' ? when(Date.parse(v)) : when(v));
  const clock = (ctx) => (typeof ctx?.now === 'function' ? ctx.now() : Date.now());
  // The paper's sources, under the key its editor keeps them (papers.js edit's context): an assignment paper's own parts,
  // else this device's.
  const sourcesKey = (key, rec) => {
    const paper = !P().local(key) && rec && P().keyOf(rec) === key ? { school: rec.school.toLowerCase(), user: rec.user, course: rec.course, content: rec.content } : null;
    return SRC().keyOf({ school: 'local', user: { id: 'local' }, course: { id: 'papers' }, item: { id: key }, ...(paper && { paper }) });
  };

  const tools = (deps = {}) => {
    const { papers, bridge } = deps;
    if (typeof papers !== 'function' || typeof bridge !== 'function') throw new TypeError('mcp writer: papers and bridge');
    const keys = handles(deps.session === undefined ? globalThis.chrome?.storage?.session : deps.session);
    // The stored document a key names, read in the broker's turn: { key, row, rec } or { error }.
    const stored = (h) => papers(async (store) => {
      const list = await rows(store), key = await keys.find(h, list.map((r) => r.key));
      const rec = key && await store.get(key);
      return key && rec && readable({ ...rec, key }) ? { key, row: list.find((r) => r.key === key), rec, store } : { error: NONE };
    });
    // The open page's answer for a stored document: its value, or { error }.
    const page = async (key, op, args, signal) => {
      let a;
      try { a = await bridge(key, op, args, { signal }); } catch { a = undefined; }
      if (a === null) return { error: CLOSED };
      if (a === undefined || (isObj(a) && a.ok === false)) return { error: isObj(a) && typeof a.error === 'string' && a.error ? a.error : LATE };
      return { value: a };
    };
    // What a summary showed, for the run the student allowed (calls.js passes both the same ctx).
    const shown = new WeakMap();
    const eligible = async (was) => {
      const row = (await was.store.list()).find((r) => r.key === was.key), rec = await was.store.get(was.key);
      return readable(row) && readable(rec && { ...rec, key: was.key });
    };
    const summary = (s) => { if (s.length > LIMIT.summary) throw new Error('This change is too long to show in the approval window. Make it in Writer.'); return s; };
    const tool = (name, bridge) => W().tools(bridge).find((t) => t.name === name);
    const base = (name) => tool(name, {});
    const DOC = { group: 'writer', scope: 'document' };
    const PAGE = { ...DOC, needs: 'writer' };
    const opened = ' The document must be open in Glaze Writer.';

    return [
      {
        name: 'documents_list', kind: 'read', group: 'writer', title: 'Writer documents',
        description: "List the student's Writer documents on this device, the last edited first: key (what the other writer tools take as document), title, kind, format, words, updated (when last saved, ms since 1970), course, assignment (whether it was written for one), submitted (when Writer last submitted it, or null), and open (whether a Writer page has it open now). A long list comes a part at a time: pass next as from.",
        parameters: { type: 'object', properties: { from: FROM }, additionalProperties: false },
        run: async (args, ctx) => {
          const [list, open] = await Promise.all([papers(rows), Promise.resolve().then(() => bridge(null, 'open', {}, { signal: ctx?.signal })).catch(() => [])]);
          const here = new Set(Array.isArray(open) ? open : []);
          const items = await Promise.all(list.map(async (r) => ({ ...DH().summary(r, titleOf(r), kindOf(r)), key: await keys.handle(r.key), format: formatOf(r.format),
            assignment: r.key.includes('|'), submitted: when(r.submitted), open: here.has(r.key) })));
          const head = { at: list.length ? when(list[0].updated) : null, total: 0, next: null };
          return { ...head, ...fit(items, args?.from || 0, room(head)) };
        },
      },
      {
        ...base('document_read'), ...DOC, title: 'Read a document',
        description: `${base('document_read').description} As Glaze last saved it: at is when, and title its title.`,
        run: async (args, ctx) => {
          const d = await stored(ctx?.document);
          if (d.error) return fail(d.error);
          const { text, outline } = read(d.rec.doc);
          const all = textPages(text), page = Math.min(args?.page || 1, all.length);
          const head = { at: when(d.rec.updated), title: titleOf(d.row), page, pages: all.length, text: all[page - 1], outlineCut: false };
          const o = fit(outline, 0, room({ ...head, outline: [] }));
          return { ...head, outline: o.items, outlineCut: o.next !== null };
        },
      },
      {
        ...base('document_sources'), ...DOC, title: "A document's sources",
        description: `${base('document_sources').description} As Glaze keeps them with the document; a long list comes a part at a time: pass next as from. An oversized source has omitted:true and its id.`,
        parameters: { type: 'object', properties: { from: FROM }, additionalProperties: false },
        run: async (args, ctx) => {
          const d = await stored(ctx?.document);
          if (d.error) return fail(d.error);
          const k = sourcesKey(d.key, d.rec), got = k ? (await ctx.local.get(k))?.[k] : null;
          const list = await SRC().load(k, { get: async () => ({ [k]: got }) });
          const head = { at: when(got?.at) ?? when(d.rec.updated), total: 0, next: null };
          return { ...head, ...fit(list, args?.from || 0, room(head)) };
        },
      },
      {
        name: 'document_assignment', kind: 'read', ...DOC, title: "A document's assignment",
        description: "The assignment a document was written for, as Glaze keeps it with the document: title (empty once the student renamed the document), due (ms since 1970, or null), course, and submitted (when Writer last submitted it, or null); assignment is null for a document of the student's own. Its instructions and rubric are not kept with the document.",
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        run: async (args, ctx) => {
          const d = await stored(ctx?.document);
          if (d.error) return fail(d.error);
          const r = await tool('assignment_read', { assignment: () => (d.key.includes('|') ? {
            title: d.rec.named === true ? '' : String(d.rec.title || ''), due: due(d.rec.due),
            course: String(d.rec.courseName || '').trim(), submitted: when(d.rec.submitted),
          } : null) }).run({}, ctx);
          return { at: when(d.rec.updated), assignment: r };
        },
      },
      {
        ...base('document_issues'), ...PAGE, title: "A document's issues",
        description: `${base('document_issues').description} A long list comes a part at a time: pass next as from.${opened}`,
        parameters: { type: 'object', properties: { from: FROM }, additionalProperties: false },
        run: async (args, ctx) => {
          const d = await stored(ctx?.document);
          if (d.error) return fail(d.error);
          const got = await page(d.key, 'issues', {}, ctx?.signal);
          if (got.error) return fail(got.error);
          const r = (Array.isArray(got.value) ? got.value : []).flatMap((i) => tool('document_issues', { issues: () => [i] }).run({}, ctx));
          const head = { source: 'tab', at: clock(ctx), total: 0, next: null };
          return { ...head, ...fit(r, args?.from || 0, room(head)) };
        },
      },
      {
        ...base('citation_insert'), ...PAGE, title: 'Insert a citation',
        description: `${base('citation_insert').description}${opened}`,
        // What would go in, read from the page; a call that can't do anything fails here, before the student is asked.
        summarize: async (args, ctx) => {
          shown.delete(ctx);
          const d = await stored(ctx?.document);
          if (d.error) throw new Error(d.error);
          const got = await page(d.key, 'cite', { sourceId: args.sourceId, page: args.page ?? null }, ctx?.signal);
          if (got.error) throw new Error(got.error);
          const c = isObj(got.value) && isObj(got.value.source) && got.value.source.id === args.sourceId && typeof got.value.source.title === 'string' && typeof got.value.inText === 'string' && got.value.inText ? got.value : null;
          if (!c) throw new Error('No such source in this document.');
          const s = summary(`Insert the citation ${c.inText} for ${JSON.stringify(c.source.title)} at the caret.`);
          shown.set(ctx, { key: d.key, store: d.store, document: ctx.document, op: 'insert', sourceId: args.sourceId, page: args.page ?? null, inText: c.inText });
          return s;
        },
        run: async (args, ctx) => {
          const was = shown.get(ctx), key = was?.key;
          if (!key || was.op !== 'insert' || was.document !== ctx.document || was.sourceId !== args.sourceId || was.page !== (args.page ?? null)) return fail(LOST);
          if (!await eligible(was)) return fail(NONE);
          const got = await page(key, 'cite', { sourceId: args.sourceId, page: args.page ?? null }, ctx?.signal);
          if (got.error) return fail(got.error);
          const c = isObj(got.value) && isObj(got.value.source) ? got.value : null;
          const r = await tool('citation_insert', { sources: () => (c ? [c.source] : []),
            insertCitation: async (sourceId, p) => { const a = await page(key, 'insert', { sourceId, page: p, inText: was.inText }); return a.error ? fail(a.error) : a.value; } }).run(args, ctx);
          return isObj(r) && r.ok === true ? { source: 'tab', at: clock(ctx), ok: true } : r;
        },
      },
      {
        ...base('fix_apply'), ...PAGE, title: 'Apply a fix',
        description: `${base('fix_apply').description}${opened}`,
        summarize: async (args, ctx) => {
          shown.delete(ctx);
          const d = await stored(ctx?.document);
          if (d.error) throw new Error(d.error);
          const got = await page(d.key, 'issues', {}, ctx?.signal);
          if (got.error) throw new Error(got.error);
          const list = Array.isArray(got.value) ? got.value : [], i = list.find((x) => x?.id === args.issueId);
          if (!i || typeof i.text !== 'string' || !(i.suggestions || []).includes(args.suggestion)) throw new Error("Not one of that issue's suggestions.");
          const s = summary(`Change ${JSON.stringify(i.text)} to ${JSON.stringify(args.suggestion)}.`);
          shown.set(ctx, { key: d.key, store: d.store, document: ctx.document, op: 'fix', issueId: args.issueId, suggestion: args.suggestion, text: i.text });
          return s;
        },
        run: async (args, ctx) => {
          const was = shown.get(ctx), key = was?.key;
          if (!key || was.op !== 'fix' || was.document !== ctx.document || was.issueId !== args.issueId || was.suggestion !== args.suggestion) return fail(LOST);
          if (!await eligible(was)) return fail(NONE);
          const got = await page(key, 'issues', {}, ctx?.signal);
          if (got.error) return fail(got.error);
          const r = await tool('fix_apply', { issues: () => (Array.isArray(got.value) ? got.value : []),
            applyFix: async (issueId, suggestion) => { const a = await page(key, 'fix', { issueId, suggestion, text: was.text }); return a.error ? fail(a.error) : a.value; } }).run(args, ctx);
          return isObj(r) && r.ok === true ? { source: 'tab', at: clock(ctx), ok: true } : r;
        },
      },
    ];
  };
  // Adds them to a lib/ai/tools.js registry (its define checks each) → the tools as added.
  const register = (registry, deps) => tools(deps).map((t) => registry.add(t));

  // ---- the open Writer pages ------------------------------------------------------------------------------------------
  // Ports from writer-mcp.js, each admitted by allowed() (→ true: the AI port's sender rules, with agent access on) before
  // it hears hello, and again before each op it is asked. Worker → page { id, op, key?, args? }; page → worker { id, value }
  // or { id, error }. The page holding a paper is found by asking each its key (the focused, then a visible, then the newest
  // page first). wake() tells every Writer page this worker is listening, so a page whose port a stopped worker took opens
  // one again.
  const OPS = ['issues', 'cite', 'insert', 'fix'];
  const pages = ({ runtime = globalThis.chrome?.runtime, timers = globalThis, now = () => Date.now() } = {}) => {
    const seats = new Set();
    let seq = 0;
    const end = (seat) => { seats.delete(seat); seat.gone = true; for (const w of [...seat.waits.values()]) w(null); };
    const drop = (seat) => { end(seat); try { seat.port.disconnect(); } catch { /* gone */ } };
    const ask = (seat, m, ms, signal) => new Promise((resolve) => {
      if (signal?.aborted || seat.gone) { resolve(null); return; }
      const id = ++seq;
      const stop = () => done(null);
      const done = (a) => { timers.clearTimeout(timer); signal?.removeEventListener('abort', stop); seat.waits.delete(id); resolve(a); };
      const timer = timers.setTimeout(stop, ms);
      signal?.addEventListener('abort', stop, { once: true });
      seat.waits.set(id, done);
      try { seat.port.postMessage({ id, ...m }); } catch { drop(seat); }
    });
    const connect = (port, allowed) => {
      const seat = { port, allowed, waits: new Map(), at: now(), gone: false };
      port.onMessage.addListener((a) => { if (isObj(a) && Number.isSafeInteger(a.id)) seat.waits.get(a.id)?.(a); });
      port.onDisconnect.addListener(() => end(seat));
      Promise.resolve().then(allowed).then((ok) => {
        if (seat.gone) return;
        if (ok !== true) { drop(seat); return; }
        seats.add(seat);
        try { port.postMessage({ type: 'hello' }); } catch { drop(seat); }
      }, () => drop(seat));
    };
    const where = async (signal) => (await Promise.all([...seats].map(async (seat) => {
      if (await Promise.resolve().then(seat.allowed).catch(() => false) !== true) { drop(seat); return null; }
      const a = await ask(seat, { op: 'key' }, LIMIT.find, signal), v = a?.value;
      return isObj(v) && typeof v.key === 'string' && v.key ? { seat, key: v.key, rank: (v.focus === true ? 2 : 0) + (v.visible === true ? 1 : 0) } : null;
    }))).filter(Boolean);
    const call = async (key, op, args, { signal } = {}) => {
      if (key === null && op === 'open') return [...new Set((await where(signal)).map((x) => x.key))];
      if (typeof key !== 'string' || !OPS.includes(op)) return null;
      const here = (await where(signal)).filter((x) => x.key === key).sort((a, b) => b.rank - a.rank || b.seat.at - a.seat.at);
      for (const { seat } of here) {
        if (signal?.aborted) return null;
        if (await Promise.resolve().then(seat.allowed).catch(() => false) !== true) { drop(seat); continue; }
        const a = await ask(seat, { op, key, args: isObj(args) ? args : {} }, LIMIT.wait, signal);
        if (!a) return fail(LATE);
        return 'error' in a ? fail(typeof a.error === 'string' && a.error ? a.error.slice(0, 300) : LATE) : a.value ?? null;
      }
      return null;
    };
    const wake = () => { try { Promise.resolve(runtime?.sendMessage?.({ type: 'glaze:mcp-writer', op: 'wake' })).catch(() => {}); } catch { /* no page listens */ } };
    return { connect, call, wake, size: () => seats.size };
  };

  return { LIMIT, read, fit, handles, tools, register, pages };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_WRITER; else GZ_MCP_WRITER;
