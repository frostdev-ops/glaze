// Gradescope in Better To Do (W10, enhance.gradescope, off by default). Gradescope has no API for students, so its
// course pages are read: on www.gradescope.com while the student is there (features/gradescope.js), and, with
// todo.gsDaily on, at most once a day from a Canvas page through the background worker. Either way with the student's
// own Gradescope session, as plain GETs, and nothing goes anywhere but this device (storage.local `gradescope`, written
// only through the worker's queue, lib/background.js 'glaze:gradescope').
//
// Gradescope's markup is read row by row and every row on its own: a row that can't be read is skipped and counted,
// never the course's whole sync. Ids come from addresses read with URL, never from split('/') positions.
// What's kept belongs to one Gradescope account (named by a hash of its email address, from its account page), and a
// Canvas account (site and user id) shows it only once the student there said yes, once (bind).
// Classic script; module.exports for node. Loaded on Gradescope by the registered script, on Canvas on demand.
var GZ_GRADESCOPE = globalThis.GZ_GRADESCOPE || (() => {
  const HOST = 'https://www.gradescope.com';
  const KEY = 'gradescope';
  const DAY = 864e5;
  const ID = /^\d{1,12}$/;
  // A Canvas course, as content.js names it in seenCourses (canvas:<origin>/<course id>), or a Blackboard Ultra one
  // (ultra:<origin>/<_N_N>).
  const TARGET = /^(?:canvas:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d+|ultra:https?:\/\/[a-z\d.-]+(?::\d+)?\/_\d+_\d+)$/i;
  const WHO = /^https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i; // a Canvas or Ultra account: <origin>/<user id>
  // Where an account's courses are placed: an Ultra user id is _N_N, a Canvas one digits.
  const lms = (origin, uid) => `${/^_\d+_\d+$/.test(uid) ? 'ultra' : 'canvas'}:${origin}/`;
  const ACCT = /^[\da-f]{24}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const ms = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : null);
  const num = (v) => (Number.isFinite(v) ? v : null);

  // ---- a course page --------------------------------------------------------------------------------------------
  // { gid, aid } from /courses/<gid>/assignments/<aid>[/…] on Gradescope, else null.
  const ids = (href) => {
    let u;
    try { u = new URL(String(href || ''), HOST); } catch { return null; }
    const m = u.origin === HOST && /^\/courses\/(\d{1,12})\/assignments\/(\d{1,12})(?:\/|$)/.exec(u.pathname);
    return m ? { gid: m[1], aid: m[2] } : null;
  };
  // A <time datetime>: "2026-10-20 23:59:00 -0700", ISO, or with no offset (then read in this browser's zone).
  const when = (s) => {
    const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$/i.exec(typeof s === 'string' ? s : '');
    if (!m) return null;
    const [, y, mo, d, h, mi, sec = '00', z] = m;
    // A real calendar date only: 2026-02-30 is no date (Date would roll it into March).
    if (+h > 23 || +mi > 59 || +sec > 59 || new Date(Date.UTC(+y, +mo - 1, +d)).toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null;
    const at = z ? Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}${/z/i.test(z) ? 'Z' : `${z.slice(0, 3)}:${z.slice(-2)}`}`)
      : new Date(+y, +mo - 1, +d, +h, +mi, +sec).getTime();
    return Number.isFinite(at) ? at : null;
  };
  // One row as plain data, read from the page with nothing that can throw on a missing cell.
  const read = (tr) => {
    const head = tr.querySelector('th') || tr.querySelector('td');
    const btn = head?.querySelector('[data-assignment-id]');
    const a = head?.querySelector('a[href]');
    // The status is its own cell; failing its class, the cell after the name.
    const st = tr.querySelector('.submissionStatus') || (tr.querySelector('th') ? tr.querySelector('td') : tr.querySelectorAll('td')[1]);
    return {
      title: (btn || a || head)?.textContent || '', href: a?.getAttribute('href') || '',
      aid: btn?.getAttribute('data-assignment-id') || '', post: btn?.getAttribute('data-post-url') || '',
      status: st?.textContent || '', cls: st?.getAttribute('class') || '',
      due: [...tr.querySelectorAll('.submissionTimeChart--dueDate')].map((e) => e.getAttribute('datetime') || ''),
    };
  };
  // What a row says, kept small: { id, title, due, late (the late due date), sub, graded, score, points, lateSub }.
  // null: unreadable (no title). A due date that isn't one is left out and the row kept. id '': a row with no
  // assignment to open or tick (an exam not yet graded, a placeholder); it isn't kept, and isn't counted either.
  // Gradescope's own words are English only: "No Submission", "Submitted", "Graded", a score "8.0 / 10.0", maybe "Late".
  const row = (x, gid) => {
    const title = text(x?.title, 300);
    // An empty row (a spacer, "no assignments yet" drawn elsewhere) is nothing; a row with parts but no title is unreadable.
    if (!title) return x && (x.href || x.aid || text(x.status, 9) || (Array.isArray(x.due) && x.due.some(Boolean))) ? null : { id: '' };
    const link = ids(x.href) || ids(x.post);
    const id = link ? (link.gid === gid ? link.aid : '') : ID.test(x.aid) ? x.aid : '';
    const [d0, d1] = Array.isArray(x.due) ? x.due : [];
    const due = d0 ? when(d0) : null, late = d1 ? when(d1) : null;
    const st = text(x.status, 200);
    const pts = /(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(st);
    // No word boundaries: a cell's parts run together in textContent ("SubmittedLate").
    const none = /no\s*submission|not\s*submitted/i.test(st);
    const graded = !!pts || (!none && /graded/i.test(st) && !/ungraded/i.test(st));
    const sub = graded || (!none && /submitted/i.test(st)) || /\bsubmissionStatus-complete\b/.test(x.cls || '');
    return { id, title, due, late, sub, graded, score: pts ? +pts[1] : null, points: pts ? +pts[2] : null, lateSub: sub && /late/i.test(st) };
  };
  // A course page's assignments: { rows, bad } (bad: rows skipped as unreadable), or null when the page has no student
  // assignments table at all (signed out, a course taught rather than taken): then what's kept stays.
  const parse = (doc, gid) => {
    const table = doc.querySelector('#assignments-student-table')
      || [...doc.querySelectorAll('table')].find((t) => t.querySelector('tbody a[href*="/assignments/"], tbody [data-assignment-id]'));
    if (!table) return null;
    const out = { rows: [], bad: 0 };
    const seen = new Set();
    for (const tr of table.querySelectorAll('tbody tr')) {
      try {
        const r = row(read(tr), gid);
        if (!r) out.bad++;
        else if (r.id && !seen.has(r.id) && out.rows.length < 300) { seen.add(r.id); out.rows.push(r); }
      } catch { out.bad++; }
    }
    return out;
  };
  // The courses a Gradescope page lists (the dashboard's course boxes) or is (a course's own page): [{ gid, short, name }].
  const courses = (doc, path = '') => {
    const out = new Map();
    for (const a of doc.querySelectorAll('a.courseBox[href], .courseBox a[href]')) {
      let u;
      try { u = new URL(a.getAttribute('href'), HOST); } catch { continue; }
      const m = u.origin === HOST && /^\/courses\/(\d{1,12})\/?$/.exec(u.pathname);
      if (!m || out.has(m[1])) continue;
      const box = a.closest('.courseBox') || a;
      out.set(m[1], { gid: m[1], short: text(box.querySelector('.courseBox--shortname')?.textContent, 120), name: text(box.querySelector('.courseBox--name')?.textContent, 200) });
    }
    const m = /^\/courses\/(\d{1,12})(?:\/|$)/.exec(path);
    if (m && !out.has(m[1])) out.set(m[1], { gid: m[1], short: text(doc.querySelector('.courseHeader--title')?.textContent, 120), name: '' });
    return [...out.values()];
  };

  // ---- whose -----------------------------------------------------------------------------------------------------------
  // The signed-in account, from Gradescope's account page (/account/edit, its profile form): { id, name } or null. The id
  // is the first 12 bytes of SHA-256 of the email address, so the address itself is never kept; the name is shown on
  // Canvas when asking whether to show this account's work there.
  const account = async (doc) => {
    const v = (n) => text(doc.querySelector(`input[name="user[${n}]"]`)?.getAttribute('value'), 200);
    const email = v('email').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null;
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
    return { id: [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join(''), name: v('name') || text(`${v('first_name')} ${v('last_name')}`, 200) };
  };

  // ---- which Canvas course ------------------------------------------------------------------------------------------
  // The likeliest Canvas course for a Gradescope one, by course code first ("CS 61A" ~ "cs61a"), then course number,
  // then shared words: its key, or '' when nothing fits well or two fit equally (no guess then).
  // g: { short, name }; list: [{ key, name, code }].
  // Lowercase, no accents, and no term ("Fall 2026", "SP26"): a term every course shares says nothing.
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/(?<![a-z])(?:fall|spring|summer|winter|autumn|fa|sp|su|wi)[\s'-]*(?:19|20)?\d\d(?!\d)/g, ' ');
  const codes = (s) => new Set([...norm(s).matchAll(/(?<![a-z])([a-z]{2,8})[\s_.-]*(\d{1,4}[a-z]?)(?![\da-z])/g)].map((m) => m[1] + m[2]));
  const numbers = (s) => new Set([...norm(s).matchAll(/(?<![\da-z])(\d{2,4}[a-z]?)(?![\da-z])/g)].map((m) => m[1]).filter((n) => !/^(19|20)\d\d$/.test(n)));
  const words = (s) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  const suggest = (g, list) => {
    const s = `${g?.short || ''} ${g?.name || ''}`;
    const gc = codes(s), gn = numbers(s), gw = words(s);
    let best = '', top = 0, tie = false;
    for (const c of list || []) {
      const cs = `${c.code || ''} ${c.name || ''}`;
      const cc = codes(cs), cn = numbers(cs), cw = words(cs);
      const shared = [...gw].filter((w) => cw.has(w)).length;
      const score = ([...gc].some((x) => cc.has(x)) ? 2 : 0) + ([...gn].some((x) => cn.has(x)) ? 1 : 0) + shared / Math.max(1, Math.min(gw.size, cw.size));
      if (score > top) { top = score; best = c.key; tie = false; } else if (score === top) tie = true;
    }
    return top >= 1 && !tie ? best : '';
  };

  // The courses Glaze has seen (storage.local seenCourses): Canvas's, kept by key, and Blackboard Ultra's, kept by id with
  // their site (content-ultra.js record). [{ key, name, code, label }], each labelled with its code and its site, and its
  // id when that still leaves two alike (one course name on two schools' Canvas, or two terms).
  const canvas = (seen) => {
    const all = Object.entries(isObj(seen) ? seen : {})
      .map(([k, c]) => (/^_\d+_\d+$/.test(k) ? [typeof c?.site === 'string' ? `ultra:${c.site}/${k}` : '', c] : [c?.canvas ? k : '', c]))
      .filter(([k, c]) => TARGET.test(k) && typeof c.name === 'string' && c.name)
      .map(([key, c]) => {
        const name = text(c.name, 200), code = text(c.code, 80);
        return { key, name, code, label: [name, code !== name && code, new URL(key.slice(key.indexOf(':') + 1)).host].filter(Boolean).join(' · ') };
      });
    const n = new Map();
    for (const c of all) n.set(c.label, (n.get(c.label) || 0) + 1);
    return all.map((c) => (n.get(c.label) > 1 ? { ...c, label: `${c.label} · #${c.key.split('/').pop()}` } : c)).sort((a, b) => a.label.localeCompare(b.label));
  };

  // ---- what's kept ----------------------------------------------------------------------------------------------------
  // storage.local gradescope: { acct: { id, name } (the Gradescope account all of it is from),
  //   map: { <gid>: { to: 'canvas:<origin>/<cid>' | '' (not this one), name } },
  //   courses: { <gid>: { at, bad, rows } } (only for courses with a Canvas course), hide: the bar dismissed for good,
  //   bind: { '<origin>/<user id>': { id, show } } (that Canvas account's answer, for Gradescope account id) }.
  // With no account known, nothing but the answers is kept.
  const cleanRow = (x) => (isObj(x) && ID.test(x.id) && text(x.title, 300) ? {
    id: x.id, title: text(x.title, 300), due: ms(x.due), late: ms(x.late), sub: !!x.sub, graded: !!x.graded,
    score: num(x.score), points: num(x.points), lateSub: !!x.lateSub,
  } : null);
  const clean = (raw) => {
    const r = isObj(raw) ? raw : {};
    const map = {}, kept = {};
    for (const [gid, m] of Object.entries(isObj(r.map) ? r.map : {}).slice(0, 100)) {
      if (ID.test(gid) && isObj(m) && (m.to === '' || TARGET.test(m.to))) map[gid] = { to: m.to, name: text(m.name, 200) };
    }
    for (const [gid, c] of Object.entries(isObj(r.courses) ? r.courses : {})) {
      if (!map[gid]?.to || !isObj(c) || !ms(c.at)) continue;
      kept[gid] = { at: c.at, bad: Number.isInteger(c.bad) && c.bad > 0 ? c.bad : 0, rows: (Array.isArray(c.rows) ? c.rows : []).slice(0, 300).map(cleanRow).filter(Boolean) };
    }
    const acct = isObj(r.acct) && ACCT.test(r.acct.id) ? { id: r.acct.id, name: text(r.acct.name, 200) } : null;
    const bind = Object.fromEntries(Object.entries(isObj(r.bind) ? r.bind : {}).filter(([k, b]) => WHO.test(k) && isObj(b) && ACCT.test(b.id))
      .slice(0, 50).map(([k, b]) => [k, { id: b.id, show: !!b.show }]));
    return acct ? { acct, map, courses: kept, hide: !!r.hide, bind } : { acct, map: {}, courses: {}, hide: false, bind };
  };
  // A write, in the worker's queue (lib/background.js decides who may ask). m.op:
  //   'acct', acct: { id, name }: who is signed in to Gradescope now. Another account than the one kept starts afresh
  //     (its placings, what was read, the bar's dismissal); Canvas accounts' answers stay, for the account they named.
  //   'map', acct, list: [{ gid, to, name }]: to a Canvas course, '' for "not this one", null to forget it (the bar asks
  //     again); a course whose Canvas course changes loses what was read for it.
  //   'rows', acct, gid, to, rows, bad: what a course page said, kept only while that course still goes to `to`.
  //   'hide', hide: the bar on Gradescope, dismissed or back.
  //   'bind', key ('<origin>/<user id>'), acct, show: that Canvas account's answer about Gradescope account acct, kept only
  //     while acct is the account kept (an answer to a question about an account since replaced changes nothing); key
  //     null forgets them all.
  // 'map' and 'rows' name the account they're for: one that isn't the kept account changes nothing.
  // → { ok, data } or { ok: false, error }.
  const change = async (m, { local }) => {
    let d = clean((await local.get([KEY]))[KEY]);
    const mine = !!d.acct && m?.acct === d.acct.id;
    if (m?.op === 'acct') {
      if (!isObj(m.acct) || !ACCT.test(m.acct.id)) return { ok: false, error: 'bad' };
      if (d.acct?.id !== m.acct.id) d = { map: {}, courses: {}, hide: false, bind: d.bind };
      d.acct = { id: m.acct.id, name: text(m.acct.name, 200) };
    } else if (m?.op === 'bind') {
      if (m.key === null) d.bind = {};
      else if (typeof m.key !== 'string' || !WHO.test(m.key)) return { ok: false, error: 'bad' };
      else if (!mine) return { ok: false, error: 'account' };
      else d.bind[m.key] = { id: d.acct.id, show: !!m.show };
    } else if ((m?.op === 'map' || m?.op === 'rows') && !mine) return { ok: false, error: 'account' };
    else if (m?.op === 'map' && Array.isArray(m.list)) {
      for (const x of m.list.slice(0, 50)) {
        if (!ID.test(x?.gid)) continue;
        if (x.to === null) { delete d.map[x.gid]; delete d.courses[x.gid]; continue; }
        if (x.to !== '' && !TARGET.test(x.to)) continue;
        if (d.map[x.gid]?.to !== x.to) delete d.courses[x.gid];
        d.map[x.gid] = { to: x.to, name: text(x.name, 200) || d.map[x.gid]?.name || '' };
      }
    } else if (m?.op === 'rows' && ID.test(m.gid) && Array.isArray(m.rows)) {
      if (!d.map[m.gid]?.to || d.map[m.gid].to !== m.to) return { ok: false, error: 'unmapped' };
      d.courses[m.gid] = { at: Date.now(), bad: m.bad, rows: m.rows };
    } else if (m?.op === 'hide') d.hide = !!m.hide;
    else return { ok: false, error: 'bad' };
    const next = clean(d);
    return (await local.set({ [KEY]: next })) ? { ok: true, data: next } : { ok: false, error: 'write' };
  };

  // ---- on Canvas ------------------------------------------------------------------------------------------------------
  // The kept rows for one Canvas site as Better To Do's items (lib/todo.js slim's shape, type 'gradescope'), in the
  // Canvas course each Gradescope course goes to. Missing: nothing handed in and the last due date (the late one, if
  // any) gone by. A row's link opens it on Gradescope. Only for a Canvas account (origin, uid) that said yes to this
  // Gradescope account; for any other, nothing.
  const shown = (d, origin, uid) => { const b = d.bind[`${origin}/${uid}`]; return !!d.acct && !!b?.show && b.id === d.acct.id; };
  const items = (rec, origin, uid, now) => {
    const d = clean(rec);
    const out = [];
    if (!shown(d, origin, uid)) return out;
    const site = lms(origin, uid);
    for (const [gid, m] of Object.entries(d.map)) {
      if (!m.to.startsWith(site)) continue;
      const cid = m.to.slice(site.length);
      for (const r of d.courses[gid]?.rows || []) {
        const end = r.late ?? r.due;
        out.push({
          type: 'gradescope', id: r.id, cid, course: '', title: r.title, at: r.due, url: `${HOST}/courses/${gid}/assignments/${r.id}`,
          sub: { submitted: r.sub, excused: false, graded: r.graded, late: r.lateSub, missing: !r.sub && end !== null && end < now, redo: false },
          ov: null, aid: '', read: false, note: '', ws: '', allDay: false, gs: { score: r.score, points: r.points },
        });
      }
    }
    return out;
  };
  // Whether to ask this Canvas account (once): the Gradescope account's name ('' if it has none) when it has work placed
  // with this site's courses and no answer from this Canvas account for it yet; else null.
  const ask = (rec, origin, uid) => {
    const d = clean(rec);
    if (!d.acct || d.bind[`${origin}/${uid}`]?.id === d.acct.id) return null;
    return Object.values(d.map).some((m) => m.to.startsWith(lms(origin, uid))) ? d.acct.name : null;
  };
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  // With todo.gsDaily on, for a Canvas account showing this Gradescope account's work: this site's courses not read for a
  // day are asked for through the worker (which fetches with the student's Gradescope session, with the account page,
  // and keeps to once a day itself), read here, and kept if the session is still that account's. Once a page.
  let daily = false;
  const html = (s) => new DOMParser().parseFromString(s, 'text/html');
  const refresh = async (d, uid) => {
    if (daily || !shown(d, location.origin, uid)) return;
    daily = true;
    const r = await new Promise((res) => { try { chrome.storage.sync.get(['enabled', 'todo'], res); } catch { res(); } });
    if (r?.enabled === false || r?.todo?.gsDaily !== true) return;
    for (const [gid, m] of Object.entries(d.map)) {
      if (!m.to.startsWith(lms(location.origin, uid)) || Date.now() - (d.courses[gid]?.at || 0) < DAY) continue;
      const r = await send({ type: 'glaze:gradescope-page', gid, key: `${location.origin}/${uid}` });
      if (!r?.ok || typeof r.html !== 'string' || typeof r.account !== 'string') continue;
      const who = await account(html(r.account));
      const p = parse(html(r.html), gid);
      if (p && who?.id === d.acct.id) await send({ type: 'glaze:gradescope', op: 'rows', acct: who.id, gid, to: r.to, ...p });
    }
  };
  // For a list on a Canvas page: a getter of this site's items for a Canvas user, (now, uid) => [...], kept current;
  // ask(uid) → { id, name } of the account to ask about, or null, and answer(uid, show, id) for the one-time question
  // (the answer names that account, so it can't count for another one signed in since); redraw() when anything changes.
  const source = (redraw) => {
    let d = null;
    try { chrome.storage.local.get([KEY], (r) => { if (!d) d = clean(r?.[KEY]); redraw(); }); } catch { /* reloaded */ }
    try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch[KEY]) { d = clean(ch[KEY].newValue); redraw(); } }); } catch { /* reloaded */ }
    const get = (now, uid) => { if (!d) return []; refresh(d, uid); return items(d, location.origin, uid, now); };
    get.ask = (uid) => { const name = d ? ask(d, location.origin, uid) : null; return name === null ? null : { id: d.acct.id, name }; };
    get.answer = (uid, show, acct) => send({ type: 'glaze:gradescope', op: 'bind', key: `${location.origin}/${uid}`, acct, show });
    return get;
  };

  return { HOST, KEY, DAY, ids, when, read, row, parse, courses, account, suggest, canvas, clean, change, items, ask, source };
})();

if (typeof module !== 'undefined') module.exports = GZ_GRADESCOPE; else GZ_GRADESCOPE;
