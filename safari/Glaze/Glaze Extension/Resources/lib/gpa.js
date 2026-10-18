// Past terms, GPA trends and a GPA goal for the Dashboard's GPA (features/grades.js, features/gpaterms.js), all on the
// device. Past terms are typed in, or read from a transcript's text (pasted, or an HTML or Word file through
// lib/doctext.js) and always reviewed before they are kept. Grade points come from lib/gradecalc.js, the scale the
// current term's GPA uses. Classic script, loaded on demand and by the service worker (its write queue); module.exports
// for node.
//
// Stored per Canvas or Ultra site and user in storage.local (gpaTerms:<origin>:<user id>), changed only through the service
// worker's queue (lib/background.js 'glaze:gpaterms', change below):
// { t: [{ id, n: name, p: 0 for whole letters (plus/minus otherwise), c: [{ n: course, cr: credits, g: grade as written,
//   l: bonus (0.5 honors, 1 AP/IB), x: 1 to leave it out }], at: last changed }], g: { k: 'cum' | 'term', v: goal GPA },
//   d: { term id: removed at } (the last 200), cl: cleared at }.
var GZ_GPA = globalThis.GZ_GPA || (() => {
  // lib/gradecalc.js, asked for when used: a page loads it first, the worker imports it first, node requires it.
  const C = () => globalThis.GZ_GRADECALC || require('./gradecalc.js');
  const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
  const okNum = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

  // ---- grades ----------------------------------------------------------------------------------------------------
  // What a transcript's grade means for the GPA. A letter (A+ to F, or E) or grade points (0 to 5, as written) count;
  // a percentage (over 5) counts as Canvas's default scheme reads it. Pass/fail, withdrawn (WF too: schools differ, and
  // the grade can be changed to F), transfer, incomplete, audit and anything else are listed but left out.
  const up = (g) => String(g ?? '').trim().toUpperCase().replace(/[−–]/g, '-');
  const NUM = /^\d{1,3}(?:[.,]\d{1,3})?$/;
  const kind = (g) => {
    const G = up(g);
    if (C().points(G, true) != null) return 'gpa';
    if (NUM.test(G)) return parseFloat(G.replace(',', '.')) <= 100 ? 'gpa' : 'none';
    if (/^(P|PASS|S|SAT|CR|NP|NC|U|UNSAT)$/.test(G)) return 'pf';
    if (/^(W|WD|WP|WF|WX|WN)$/.test(G)) return 'w';
    if (/^(TR|T|TC|TRF)$/.test(G)) return 'tr';
    return 'none';
  };
  // A row's grade points, or null when it doesn't count. plus: the term's letters have plus/minus points (A- 3.7);
  // weighted: honors and AP add their bonus to a letter (points written as a number are taken as they are).
  const pointsOf = (row, plus = true, weighted = false) => {
    if (row.x === 1 || kind(row.g) !== 'gpa') return null;
    const G = up(row.g);
    const bonus = weighted ? row.l || 0 : 0;
    if (!NUM.test(G)) return C().points(G, plus, bonus);
    const n = parseFloat(G.replace(',', '.'));
    return n <= 5 ? n : C().points(C().letter(n), plus, bonus);
  };
  // Why a row is left out, or null when it counts: 'out' (you left it out), 'pf', 'w', 'tr', 'none' (no grade that
  // counts) or 'credits' (no credits).
  const why = (row) => (row.x === 1 ? 'out' : kind(row.g) !== 'gpa' ? kind(row.g) : row.cr > 0 ? null : 'credits');
  // A past term's rows as the GPA counts them: [{ credits, points }].
  const rowsOf = (term, weighted) => term.c.map((r) => ({ credits: r.cr, points: pointsOf(r, term.p !== 0, weighted) }));

  // ---- terms in time ---------------------------------------------------------------------------------------------
  // Where a term falls, from its name: the year, then its season or its number in the year ("Fall 2024", "Spring
  // Semester 2025", "2025 Term 1", "Wintersemester 2024/25", "Automne 2024"). null without a year.
  const SEASONS = [[/winter|hiver|invierno|inverno|\bws\b/i, 0], [/spring|printemps|primavera|voorjaar|lente|fr[üu]hling/i, 1],
    [/summer|sommer|[ée]t[ée]|verano|ver[ãa]o|zomer|\bss\b/i, 2], [/fall|autumn|automne|oto[ñn]o|outono|herbst|najaar|herfst/i, 3]];
  const when = (name) => {
    const s = String(name || '');
    const y = /\b((?:19|20)\d\d)(\s*[/-]\s*\d{2,4})?\b/.exec(s);
    if (!y) return null;
    const season = SEASONS.find(([re]) => re.test(s));
    // A winter term across two years (Wintersemester 2024/25) starts late in the first.
    const at = season ? (season[1] === 0 && y[2] ? 3.5 : season[1]) : Math.min(9, Number(/\b(?:term|semester|quarter|trimester|semestre|trimestre|[qst])\s*(\d)\b|\b(\d)(?:st|nd|rd|th)\b/i.exec(s)?.slice(1).find(Boolean) ?? 5));
    return Number(y[1]) * 10 + at;
  };
  // Oldest first. A term whose name has no year keeps its place after the one before it.
  const order = (terms) => {
    let last = -Infinity;
    return terms.map((t, i) => ({ t, i, k: (last = when(t.n) ?? last) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.t);
  };

  // Term by term, oldest first: { name, gpa, credits, cum } with the cumulative GPA up to and including it.
  // list: [{ name, rows: [{ credits, points }] }], already in order; a term with nothing that counts has gpa null.
  const series = (list) => {
    let P = 0, Cr = 0;
    return list.map(({ name, rows }) => {
      const g = C().gpa(rows);
      if (g.gpa != null) { P += g.gpa * g.credits; Cr += g.credits; }
      return { name, gpa: g.gpa, credits: g.credits, cum: Cr ? P / Cr : null };
    });
  };

  // ---- a goal ----------------------------------------------------------------------------------------------------
  // What this term needs. past: { points, credits } of what came before; credits: this term's credits that will count;
  // top: the most this term can average (straight A's, with any bonus). kind 'term' aims at this term's GPA, 'cum' at
  // the cumulative GPA after it. → { need } (a term GPA, rounded up to two places), { met: true } when even zero points
  // would do, { reachable: false, best } with the best it can come to, or null without credits this term.
  const goal = ({ past = { points: 0, credits: 0 }, credits, top }, kind, v) => {
    if (!(credits > 0)) return null;
    const need = kind === 'term' ? v : (v * (past.credits + credits) - past.points) / credits;
    if (need > top + 1e-9) return { reachable: false, best: kind === 'term' ? top : (past.points + top * credits) / (past.credits + credits) };
    if (need <= 1e-9) return { met: true };
    return { need: Math.min(top, Math.ceil(need * 100 - 1e-6) / 100) };
  };

  const LADDER = { true: ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A'], false: ['F', 'D', 'C', 'B', 'A'] };
  // The lowest percent for a letter on a scale ([[name, min %], …]): the least that earns at least its points.
  const floor = (scale, name, plus) => {
    const want = C().points(name, plus);
    const ok = scale.filter(([n]) => (C().points(n, plus) ?? -1) >= want).map(([, min]) => min);
    return ok.length ? Math.min(...ok) : null;
  };
  // The highest letter (its place on the ladder) a course can still end on: one its scale gives (any, when the scale
  // isn't known), and, once the best its work left can make is known (max, a percent), one that best reaches as Canvas
  // rounds it. A scale whose top is B never gives an A, nor does work left that tops out at 86%. -1 for none.
  const topOf = (c, plus) => LADDER[!!plus].findLastIndex((n) => {
    const min = c.scale ? floor(c.scale, n, plus) : 0;
    return min != null && (c.max == null || C().reaches(c.max, min));
  });
  // Whether the best a course can still earn on its scale has no grade points (a Pass/Fail scale, below what its work
  // left reaches once known): then it adds no GPA credits, and the goal leaves it out rather than count it as an F.
  // passOf: that best grade ([name, min %]), or null when it has grade points (or the scale isn't known).
  const passOf = (c) => {
    if (!c.scale) return null;
    const best = c.scale.filter(([, min]) => c.max == null || C().reaches(c.max, min)).sort((a, b) => b[1] - a[1])[0];
    return best && C().points(best[0], true) == null ? best : null;
  };
  const noGpa = (c) => !!passOf(c);
  // One way to a term average of `need`: every course starts at its letter now (one with no letter yet at the letter
  // the average needs), then the cheapest steps up are taken until the term gets there, never past the letter it can
  // still give (topOf). A step costs the percentage points it takes on the course's scale where its score and scale
  // are known, else 4 (about a letter's width), over the grade points it adds (credits count). courses: [{ credits,
  // letter, score, scale, bonus, max }] that count (pass/fail ones are left out by the caller), plus: plus/minus
  // letters. → [{ letter, min (its lowest percent, when the scale is known), up (steps above the letter now; null
  // with no letter now: whether it already gets there is unknown) }], or null if no route gets there.
  const route = (courses, need, plus) => {
    const L = LADDER[!!plus];
    const pts = (c, k) => C().points(L[k], plus, c.bonus || 0);
    const avg = L.findIndex((n) => C().points(n, plus) >= need - 1e-9);
    const st = courses.map((c) => {
      const name = up(c.letter) === 'E' ? 'F' : up(c.letter);
      const now = c.letter ? L.indexOf(plus ? name : name[0]) : -1;
      const top = Math.max(0, topOf(c, plus));
      return { c, k: Math.min(now >= 0 ? now : avg >= 0 ? avg : L.length - 1, top), top, from: now };
    });
    const effort = (s, k) => {
      const min = s.c.scale && s.c.score != null ? floor(s.c.scale, L[k], plus) : null;
      return min == null ? null : C().reaches(s.c.score, min) ? 0 : min - s.c.score;
    };
    const cost = (s) => {
      const a = effort(s, s.k), b = effort(s, s.k + 1);
      const gain = s.c.credits * (pts(s.c, s.k + 1) - pts(s.c, s.k));
      return gain > 0 ? (a == null || b == null ? 4 : b - a) / gain : Infinity;
    };
    const target = need * sum(courses, (c) => c.credits) - 1e-9;
    while (sum(st, (s) => s.c.credits * pts(s.c, s.k)) < target) {
      const next = st.filter((s) => s.k < s.top).reduce((a, s) => (!a || cost(s) < cost(a) ? s : a), null);
      if (!next) return null;
      next.k++;
    }
    return st.map((s) => ({ letter: L[s.k], min: s.c.scale ? floor(s.c.scale, L[s.k], plus) : null, up: s.from < 0 ? null : s.k - s.from }));
  };

  // ---- reading a transcript's text -------------------------------------------------------------------------------
  // Terms are short header lines with a year and a season or term number. A course is a line under one with a credit
  // count and a grade side by side (in either order), usually after a course code (BIO 101, MATH-2210A); its name is
  // what comes before them. A table read one cell per line is folded back into rows. The transcript's own term GPA and
  // the figures on its term summary lines (credits attempted, earned, totals) are kept to check against, and lines
  // with a course code that couldn't be read are listed (skipped). Nothing here is kept until the student has reviewed it.
  const CODE = /\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b/;
  const GRADE = /^(?:[A-DF][+-]?|E|P|NP|S|U|W[DPFXN]?|I|IP|INC|CR|NC|AU|TR|NR|NG)$/;
  const CREDIT = /^\d{1,2}(?:[.,]\d{1,3})?$/;
  // Words of summary lines, not courses; a row that starts with a course code is a course whatever its title says
  // ("CIS301 Software Quality Assurance").
  const NOT_A_COURSE = /\b(gpa|totals?|cumulative|attempted|earned|standing|dean'?s|probation|hours|quality|points)\b/i;
  const CODE_AT = new RegExp(`^${CODE.source}`);
  const SUMMARY = /\b(totals?|attempted|earned|credits?|hours|hrs|units)\b/i;
  const termOf = (line) => {
    if (line.length > 60 || CODE.test(line) || /gpa/i.test(line) || !/\b(?:19|20)\d\d\b/.test(line)) return null;
    if (!SEASONS.some(([re]) => re.test(line)) && !/\b(term|semester|quarter|trimester|semestre|trimestre)\b/i.test(line)) return null;
    return line.replace(/\t+/g, ' ').replace(/[\s:–-]+$/, '').trim();
  };
  const course = (line) => {
    const toks = line.split(/[\t ]+/).filter(Boolean).map((x) => x.replace(/[−–]/g, '-'));
    const credit = (k) => CREDIT.test(toks[k] || '') && parseFloat(toks[k].replace(',', '.')) <= 12;
    for (let gi = toks.length - 1; gi > 0; gi--) {
      if (!GRADE.test(toks[gi]) || !(credit(gi - 1) || credit(gi + 1))) continue;
      const ci = credit(gi - 1) ? gi - 1 : gi + 1;
      let s = Math.min(gi, ci);
      while (s > 0 && CREDIT.test(toks[s - 1])) s--;
      const name = toks.slice(0, s).join(' ');
      if (!/\p{L}{2}/u.test(name) || (!CODE_AT.test(name) && NOT_A_COURSE.test(name))) return null;
      return { n: name.slice(0, 100), cr: parseFloat(toks[ci].replace(',', '.')), g: toks[gi] };
    }
    return null;
  };
  const parse = (text) => {
    const lines = [];
    for (const raw of String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n')) {
      const line = raw.trim();
      const last = lines.at(-1);
      if (last?.open && line && !CODE.test(line) && !termOf(line) && !/gpa/i.test(line)) { last.text += `\t${line}`; continue; }
      lines.push({ text: line, open: new RegExp(`^${CODE.source}$`).test(line) });
    }
    const terms = [];
    let cur = null;
    for (const { text: line } of lines) {
      const name = termOf(line);
      if (name) {
        cur = terms.find((t) => t.n.toLowerCase() === name.toLowerCase()) || terms[terms.push({ n: name, c: [], gpa: null, printed: [], skipped: [] }) - 1];
        continue;
      }
      // The term's own figures: the cumulative ones on the same line are taken out first.
      const own = line.replace(/\b(?:cum\w*|overall|career|total|transfer)\.?\s+(?:gpa|credits?|hours|hrs|units|attempted|earned)\b\D{0,12}?\d{1,3}(?:[.,]\d{1,4})?/gi, '');
      const g = own.match(/\bgpa\b\D{0,12}?(\d[.,]\d{1,4})/i);
      const c = g ? null : course(line);
      if (c) {
        if (!cur) terms.push((cur = { n: '', c: [], gpa: null, printed: [], skipped: [] }));
        cur.c.push(c);
        continue;
      }
      if (!cur) continue;
      if (g && cur.gpa == null) cur.gpa = parseFloat(g[1].replace(',', '.'));
      if (g || SUMMARY.test(own)) cur.printed.push(...(own.replace(/\bgpa\b\D{0,12}?\d[.,]\d{1,4}/gi, '').match(/\b\d{1,3}(?:[.,]\d{1,3})?\b/g) || []).map((x) => parseFloat(x.replace(',', '.'))));
      else if (CODE_AT.test(line)) cur.skipped.push(line.replace(/\s+/g, ' ').slice(0, 100));
    }
    return terms.filter((t) => t.c.length).slice(0, MAX_TERMS).map(({ printed, skipped, ...t }) => ({ ...t, c: t.c.slice(0, MAX_ROWS),
      ...(printed.length ? { printed } : {}), ...(skipped.length || t.c.length > MAX_ROWS ? { skipped: [...skipped, ...t.c.slice(MAX_ROWS).map((r) => r.n)] } : {}) }));
  };
  // A term found in a transcript against what the transcript printed for it: gpa false when its term GPA isn't Glaze's,
  // credits false when none of the figures on its summary lines is the credits Glaze found (counted, or all listed);
  // null where it printed none. A matching GPA over different credits is no match.
  const check = (term, weighted) => {
    const g = C().gpa(rowsOf(term, weighted));
    const all = sum(term.c, (r) => r.cr || 0);
    const credits = term.printed?.length ? term.printed.some((n) => Math.abs(n - g.credits) < 0.01 || Math.abs(n - all) < 0.01) : null;
    return { gpa: term.gpa == null || g.gpa == null ? null : Math.abs(term.gpa - g.gpa) < 0.0051, mine: g.gpa, credits, all };
  };

  // ---- what is kept ----------------------------------------------------------------------------------------------
  const MAX_TERMS = 40, MAX_ROWS = 40;
  const ID = /^[a-z0-9]{1,24}$/;
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const cleanRow = (r) => {
    if (!r || typeof r !== 'object') return null;
    const o = { n: text(r.n, 100), cr: okNum(r.cr, 30) ? Math.round(r.cr * 100) / 100 : 0, g: text(r.g, 8) };
    if ([0.5, 1].includes(r.l)) o.l = r.l;
    if (r.x === 1) o.x = 1;
    return o;
  };
  const cleanTerm = (t) => {
    if (!t || typeof t !== 'object' || !ID.test(t.id)) return null;
    const o = { id: t.id, n: text(t.n, 60), c: (Array.isArray(t.c) ? t.c : []).map(cleanRow).filter(Boolean).slice(0, MAX_ROWS) };
    if (t.p === 0) o.p = 0;
    if (okNum(t.at, 1e15)) o.at = t.at;
    return o;
  };
  const cleanGoal = (g) => (g && ['cum', 'term'].includes(g.k) && okNum(g.v, 6) ? { k: g.k, v: Math.round(g.v * 100) / 100 } : null);
  const clean = (raw) => {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const seen = new Set();
    const t = (Array.isArray(r.t) ? r.t : []).map(cleanTerm).filter((x) => x && !seen.has(x.id) && seen.add(x.id)).slice(0, MAX_TERMS);
    const out = { t };
    const d = Object.entries(r.d && typeof r.d === 'object' && !Array.isArray(r.d) ? r.d : {}).filter(([id, at]) => ID.test(id) && okNum(at, 1e15)).sort((a, b) => a[1] - b[1]).slice(-200);
    if (d.length) out.d = Object.fromEntries(d);
    const g = cleanGoal(r.g);
    if (g) out.g = g;
    if (okNum(r.cl, 1e15)) out.cl = r.cl;
    return out;
  };
  // One change, on what is stored now. m: { op: 'term', term } (added, or replacing the one with its id) | { op:
  // 'drop', id } | { op: 'add', terms } (reviewed imports; each replaces a term of the same name) | { op: 'goal', goal }
  // (null clears it) | { op: 'clear' } (everything); each with `at`, when it was made, and `base`, the last clear the page
  // had seen. A change made before a clear, or on a view from before it (a read still on its way when it came), is
  // refused (null), so it can't bring a term back. Each term keeps when it last changed, and a removed term when it was
  // removed (d, also for a term an import replaced): an older change to it, arriving after a newer one or after its
  // removal, is dropped rather than undoing it, and an import doesn't replace a same-name term changed after it.
  const change = (raw, m) => {
    const rec = clean(raw);
    if (m.op === 'clear') return { t: [], cl: Math.max(rec.cl || 0, m.at) };
    if (!(m.at > (rec.cl || 0)) || !((m.base || 0) >= (rec.cl || 0))) return null;
    rec.d ||= {};
    const newer = (id) => !(rec.t.find((x) => x.id === id)?.at > m.at) && !(rec.d[id] >= m.at);
    const stamp = (t) => cleanTerm(t && { ...t, at: m.at });
    const remove = (id) => { rec.t = rec.t.filter((x) => x.id !== id); rec.d[id] = Math.max(rec.d[id] || 0, m.at); };
    if (m.op === 'term') {
      const t = stamp(m.term);
      const i = t ? rec.t.findIndex((x) => x.id === t.id) : -1;
      if (t && newer(t.id)) { if (i >= 0) rec.t[i] = t; else rec.t.push(t); }
    } else if (m.op === 'drop') { if (ID.test(m.id) && newer(m.id)) remove(m.id); }
    else if (m.op === 'add' && Array.isArray(m.terms)) {
      for (const t of m.terms.map(stamp).filter(Boolean)) {
        const same = rec.t.filter((x) => x.id !== t.id && t.n && x.n.toLowerCase() === t.n.toLowerCase());
        if (!newer(t.id) || same.some((x) => x.at > m.at)) continue;
        for (const x of same) remove(x.id);
        rec.t = rec.t.filter((x) => x.id !== t.id);
        rec.t.push(t);
      }
    } else if (m.op === 'goal') {
      const g = cleanGoal(m.goal);
      if (g) rec.g = g; else delete rec.g;
    }
    return clean(rec);
  };
  const KEY = /^gpaTerms:https?:\/\/[a-z\d.-]+(?::\d+)?:\w{1,40}$/i;

  return { kind, pointsOf, why, rowsOf, when, order, series, goal, topOf, noGpa, passOf, route, floor, parse, check, clean, cleanTerm, change, newId, KEY, LADDER };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_GPA; else GZ_GPA;
