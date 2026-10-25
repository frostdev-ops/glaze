// Class schedule import (Canvas, W14): the parts that don't touch the page, so node can test them. A schedule is read on
// the device, from an .ics calendar (lib/ics.js), a registrar's page or document (lib/doctext.js gives its text) or
// pasted text, then shown for review; only what the student saves is kept (storage.local classes:<site>/<user>, through
// the worker's queue, lib/background.js 'glaze:classes'). Times are wall-clock times in the student's Canvas time zone.
// meetings(line) is the meeting-time reader on its own (W15's syllabus import uses it too).
// Classic script; module.exports for node. Loaded on demand (features/classes.js, the agenda, reminders) and by the
// background worker for the writes: a second injection keeps the first.
var GZ_CLASSES = globalThis.GZ_CLASSES || (() => {
  const DAY = 864e5;
  const T = () => globalThis.GZ_TODO || require('./todo.js');

  // ---- days of the week, in Glaze's six languages ------------------------------------------------------------
  // Sunday first (0), as Date counts them. Names and abbreviations match in any case; the compact letters ("MWF", "TR",
  // Spanish "LMXJV") only as capitals. A language's table is used where the text is in it (lang), with English's after.
  const NAMES = {
    en: ['sunday sun su', 'monday mon mo', 'tuesday tues tue tu', 'wednesday wed we', 'thursday thurs thur thu th', 'friday fri fr', 'saturday sat sa'],
    de: ['sonntag so', 'montag mo', 'dienstag di', 'mittwoch mi', 'donnerstag do', 'freitag fr', 'samstag sonnabend sa'],
    es: ['domingo dom do', 'lunes lun lu', 'martes mar ma', 'miércoles miercoles mié mie mi', 'jueves jue ju', 'viernes vie vi', 'sábado sabado sáb sab sá sa'],
    fr: ['dimanche dim', 'lundi lun', 'mardi mar', 'mercredi mer', 'jeudi jeu', 'vendredi ven', 'samedi sam'],
    nl: ['zondag zo', 'maandag ma', 'dinsdag di', 'woensdag wo', 'donderdag do', 'vrijdag vr', 'zaterdag za'],
    pt: ['domingo dom', 'segunda-feira segunda seg', 'terça-feira terca-feira terça terca ter', 'quarta-feira quarta qua', 'quinta-feira quinta qui', 'sexta-feira sexta sex', 'sábado sabado sáb sab'],
  };
  const LETTERS = { en: { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 }, es: { D: 0, L: 1, M: 2, X: 3, J: 4, V: 5, S: 6 } };
  const LANGS = Object.keys(NAMES);
  const tables = new Map();
  const table = (lang) => {
    if (!tables.has(lang)) {
      const names = new Map();
      for (const l of [lang, 'en']) NAMES[l].forEach((s, d) => { for (const n of s.split(' ')) if (!names.has(n)) names.set(n, d); });
      tables.set(lang, { names, letters: LETTERS[lang] || LETTERS.en });
    }
    return tables.get(lang);
  };
  // Months, from Intl in each language (long and short, without dots or accents), plus a few spellings it doesn't give.
  const bare = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\.$/, '');
  let months = null;
  const month = (w) => {
    if (!months) {
      months = new Map([['sept', 8], ['mrz', 2]]);
      for (const l of ['en', 'de', 'es', 'fr', 'nl', 'pt']) for (const style of ['long', 'short']) {
        const f = new Intl.DateTimeFormat(l, { month: style, timeZone: 'UTC' });
        for (let m = 0; m < 12; m++) { const n = bare(f.format(Date.UTC(2026, m, 15))); if (n.length > 2 && !months.has(n)) months.set(n, m); }
      }
    }
    return months.get(bare(w));
  };
  // The text's language, by the day names it uses: whole words of four letters or more, or any abbreviation right before
  // a number ("Di 10:00"); else the hint (the page's language).
  const detect = (text, hint = 'en') => {
    const score = Object.fromEntries(LANGS.map((l) => [l, 0]));
    const s = String(text).toLowerCase();
    const seen = [...(s.match(/[\p{L}-]{4,}/gu) || []), ...[...s.matchAll(/(?<![\p{L}])([\p{L}]{2,3})\.?\s+\d/gu)].map((m) => m[1])];
    // A month's abbreviation ("Mar 9") says nothing; an English plural ("Tuesdays") does.
    for (const w of seen) for (const l of LANGS) if (NAMES[l].some((x) => x.split(' ').includes(l === 'en' ? w.replace(/(?<=day)s$/, '') : w)) && (w.length > 3 || month(w) === undefined)) score[l]++;
    const h = String(hint).slice(0, 2).toLowerCase();
    const best = LANGS.reduce((a, b) => (score[b] > score[a] || (score[b] === score[a] && b === h) ? b : a), LANGS.includes(h) ? h : 'en');
    return score[best] > 0 || LANGS.includes(h) ? best : 'en';
  };

  // ---- dates ---------------------------------------------------------------------------------------------------
  // 'YYYY-MM-DD' strings throughout. A date without a year takes the one that puts it nearest `now`.
  const pad = (n) => String(n).padStart(2, '0');
  const key = (y, m, d) => {
    const ms = Date.UTC(y, m, d);
    const dt = new Date(ms);
    return y > 1900 && y < 2200 && dt.getUTCMonth() === m && dt.getUTCDate() === d ? `${y}-${pad(m + 1)}-${pad(d)}` : null;
  };
  const near = (m, d, now) => {
    const y = new Date(now).getUTCFullYear();
    return [y, y - 1, y + 1].map((yy) => key(yy, m, d)).filter(Boolean).sort((a, b) => Math.abs(Date.parse(a) - now) - Math.abs(Date.parse(b) - now))[0] || null;
  };
  const year = (s) => (s.length === 2 ? 2000 + +s : +s);
  const MON = String.raw`(\p{L}{3,}\.?)`;
  // [regex, match → [year or null, month (0–11), day]]: ISO; numeric (month first in English with "/", else day first,
  // unless a part can't be a month; without a year only with "/" or as "24.08."); "Aug 24, 2026"; "24 Aug 2026",
  // "24. August", "24 de agosto de 2026".
  const DATES = [
    [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (m) => [+m[1], +m[2] - 1, +m[3]]],
    [/(?<![\d.\/-])(\d{1,2})([.\/-])(\d{1,2})(?:\2(\d{4}|\d{2})|(\.))?(?![\d\/:-]|\.\d)/g, (m, c) => {
      if (!m[4] && m[2] !== '/' && !m[5]) return null; // "9.50" is a time, "9-10" a range
      const [a, b] = [+m[1], +m[3]];
      const [mo, d] = a > 12 ? [b, a] : b > 12 ? [a, b] : c.lang === 'en' && m[2] === '/' ? [a, b] : [b, a];
      return [m[4] ? year(m[4]) : null, mo - 1, d];
    }],
    [new RegExp(String.raw`(?<![\p{L}\d])${MON}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?![\d:])`, 'gu'), (m) => (month(m[1]) === undefined ? null : [m[3] ? +m[3] : null, month(m[1]), +m[2]])],
    [new RegExp(String.raw`(?<![\d:])(\d{1,2})(?:er|º|\.)?\s+(?:de\s+)?${MON}(?:\s+(?:de\s+)?(\d{4}))?(?![\p{L}\d])`, 'gu'), (m) => (month(m[2]) === undefined ? null : [m[3] ? +m[3] : null, month(m[2]), +m[1]])],
  ];
  // Every date in a line: [{ at, end, y, m, d }], earliest position first, none overlapping (an earlier pattern's match
  // wins). Which characters are taken is kept per character, so this stays linear however many dates there are.
  const dates = (line, c) => {
    const out = [];
    const taken = new Uint8Array(line.length);
    for (const [re, read] of DATES) for (const m of line.matchAll(re)) {
      const r = read(m, c), end = m.index + m[0].length;
      if (!r || !(r[1] >= 0 && r[1] < 12 && r[2] >= 1 && r[2] <= 31) || taken.subarray(m.index, end).includes(1)) continue;
      taken.fill(1, m.index, end);
      out.push({ at: m.index, end, y: r[0], m: r[1], d: r[2] });
    }
    return out.sort((a, b) => a.at - b.at);
  };
  const RANGE_SEP = /^\s*(?:-|–|—|~|to|till|until|through|thru|bis|a|al|à|au|tot|t\/m|até)\s*$/iu;
  const DAYS_OF_MONTH = new RegExp(String.raw`(?<![\p{L}\d])${MON}\s+(\d{1,2})\s*[-–]\s*(\d{1,2})(?:,?\s+(\d{4}))?(?![\d:])`, 'gu');
  // A line with each span ({ at, end }, in order, not overlapping) turned to spaces, in one pass: positions stay put.
  const blanks = (s, spans) => {
    let out = '', i = 0;
    for (const x of [...spans].sort((a, b) => a.at - b.at)) { if (x.at < i) continue; out += s.slice(i, x.at) + ' '.repeat(x.end - x.at); i = x.end; }
    return out + s.slice(i);
  };
  // Date ranges in a line and lone dates: [{ at, end, from, to, one }]. A date without a year takes one from its range's
  // other end ("Aug 24 – Dec 11, 2026"; "Jan 12 – May 1" in October: next year's), else the year nearest now.
  const dateSpans = (line, c) => {
    const spans = [];
    const lone = (x) => (x.y ? key(x.y, x.m, x.d) : near(x.m, x.d, c.now));
    // "Mar 9-13", "Nov 25–27, 2026": one month, two days.
    for (const m of line.matchAll(DAYS_OF_MONTH)) {
      const mo = month(m[1]);
      const from = mo === undefined ? null : m[4] ? key(+m[4], mo, +m[2]) : near(mo, +m[2], c.now);
      const to = from && key(+from.slice(0, 4), mo, +m[3]);
      if (to && to >= from) spans.push({ at: m.index, end: m.index + m[0].length, from, to });
    }
    if (spans.length) line = blanks(line, spans);
    const ds = dates(line, c);
    for (let i = 0; i < ds.length; i++) {
      const a = ds[i], b = ds[i + 1];
      if (b && RANGE_SEP.test(line.slice(a.end, b.at))) {
        let from = a.y ? key(a.y, a.m, a.d) : b.y ? key(b.y, a.m, a.d) : lone(a);
        let to = b.y ? key(b.y, b.m, b.d) : key(+(from || '0').slice(0, 4), b.m, b.d);
        if (from && to && to < from && !b.y) to = key(+from.slice(0, 4) + 1, b.m, b.d);
        if (from && to && to < from && !a.y) from = key(+to.slice(0, 4) - 1, a.m, a.d);
        if (from && to && to >= from) { spans.push({ at: a.at, end: b.end, from, to }); i++; continue; }
      }
      const one = lone(a);
      if (one) spans.push({ at: a.at, end: a.end, from: one, to: one, one: true });
    }
    return spans.sort((a, b) => a.at - b.at);
  };
  const dayNum = (k) => Date.parse(k) / DAY;
  const keyOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const weekday = (n) => (((n + 4) % 7) + 7) % 7;

  // ---- times ---------------------------------------------------------------------------------------------------
  const TIME = /(?<![\p{L}\d.:,\/])(\d{1,2})(?:\s?([:.hH])\s?(\d{2}))?(?:\s*(a\.?\s?m\.?|p\.?\s?m\.?|uhr|h)(?![\p{L}]))?(?![\d:])|(?<![\p{L}])(noon|midday|mittag|mediod[ií]a|midi|middag|meio-dia)(?![\p{L}])/giu;
  const TIME_SEP = /^\s*(?:-|–|—|~|to|till|until|bis|a|al|à|às|as|tot|até)\s*$/iu;
  const times = (line) => [...line.matchAll(TIME)].map((m) => {
    if (m[5]) return { at: m.index, end: m.index + m[0].length, h: 12, min: 0, mer: 'p', clear: true };
    const h = +m[1], min = m[3] ? +m[3] : 0, sep = m[2] || '', suf = (m[4] || '').toLowerCase().replace(/[.\s]/g, '');
    if (h > 24 || min > 59 || (sep === '.' && !m[3])) return null;
    const mer = suf === 'am' ? 'a' : suf === 'pm' ? 'p' : '';
    // A 24-hour clock: no am/pm, and an hour past 12, a leading zero, "14h30" or "Uhr".
    const h24 = !mer && (h > 12 || h === 0 || /^0\d/.test(m[1]) || /h/i.test(sep) || suf === 'h' || suf === 'uhr');
    if (mer && (h > 12 || h === 0)) return null;
    return { at: m.index, end: m.index + m[0].length, h, min, mer, h24, bare: !sep && !suf, clear: !!(sep || suf) };
  }).filter(Boolean);
  // Minutes since midnight for a start and an end, the meridiem worked out where only one side (or neither) says it.
  // → { start, end, unsure } or null.
  const span = (a, b) => {
    const at = (t, pm) => (t.h % 12) * 60 + t.min + (pm ? 720 : 0);
    const ok = (s, e) => e > s && e - s >= 10 && e - s <= 480;
    if (a.h24 || b.h24) {
      const s = a.h * 60 + a.min, e = (b.h === 24 ? 1440 : b.h * 60 + b.min);
      return ok(s, e) && !a.mer && !b.mer ? { start: s, end: e, unsure: false } : null;
    }
    if (a.mer || b.mer) {
      const pick = (sides) => sides.map(([pa, pb]) => [at(a, pa), at(b, pb)]).find(([s, e]) => ok(s, e));
      const pa = a.mer ? [a.mer === 'p'] : null, pb = b.mer ? [b.mer === 'p'] : null;
      const tries = [];
      // The side that says it, and the other the same; then the other way (11:00–12:15pm starts in the morning).
      for (const x of pa || [pb[0], !pb[0]]) for (const y of pb || [x, !x]) tries.push([x, y]);
      const r = pick(tries);
      return r ? { start: r[0], end: r[1], unsure: false } : null;
    }
    // Neither says: 8–11 in the morning, 12 and 1–5 in the afternoon; 6 and 7 could be either (a guess, marked).
    const s = at(a, a.h === 12 || a.h <= 6);
    const e = [at(b, false), at(b, true)].find((x) => ok(s, x));
    return e === undefined ? null : { start: s, end: e, unsure: a.h === 6 || a.h === 7 };
  };

  // ---- day groups ----------------------------------------------------------------------------------------------
  // A word as days: a name ("Wednesday", "mié", "Mondays") or a run of abbreviations and capitals ("MoWeFr", "TTh",
  // "MWF"). → [day…] or null.
  const asDays = (w, tb) => {
    const lw = w.toLowerCase();
    if (tb.names.has(lw)) return [tb.names.get(lw)];
    if (/s$/.test(lw) && tb.names.has(lw.slice(0, -1)) && lw.length > 5) return [tb.names.get(lw.slice(0, -1))];
    // Runs: capitals, or capital + lower abbreviations of two or three letters, all of the word.
    const out = [];
    for (let i = 0; i < w.length;) {
      let hit = null;
      for (const n of [3, 2]) {
        const part = w.slice(i, i + n);
        if (part.length === n && /^\p{Lu}\p{Ll}+$/u.test(part) && tb.names.has(part.toLowerCase())) { hit = [n, tb.names.get(part.toLowerCase())]; break; }
      }
      if (!hit && tb.letters[w[i]] !== undefined) hit = [1, tb.letters[w[i]]];
      if (!hit) return null;
      out.push(hit[1]);
      i += hit[0];
    }
    return out.length > 1 || w.length === 1 ? out : null;
  };
  const JOIN = /^[\s,\/&+·.]*(?:(?:and|und|y|e|et|en|-|–)[\s,\/&+·.]*)?$/iu;
  const THROUGH = /^\s*(?:-|–|—|to|through|thru|bis|a|à|au|al|tot|t\/m|até)\s*$/iu;
  const DASH = /^\s*[-–]\s*$/;
  const LINK = /^(?:and|und|y|e|et|en|to|through|thru|bis|a|à|au|al|tot|até)$/i;
  const WORD = /[\p{L}]+(?:-feira)?/gu;
  // Groups of days in a line: [{ at, end, days, strong }]. Strong: a name of three letters or more, a run like "MWF", or
  // several words; a lone "M" or "Mo" is weak and counts only beside a time or as a table cell of its own.
  const dayGroups = (line, tb) => {
    line = line.replace(/(?<![\p{L}])t\/m(?![\p{L}])/giu, ' - '); // Dutch "ma t/m vr"
    // Joining words ("and", "y", "bis"…) stay in the gaps between days, where JOIN and THROUGH read them.
    const words = [...line.matchAll(WORD)].filter((m) => !LINK.test(m[0])).map((m) => ({ at: m.index, end: m.index + m[0].length, w: m[0], days: asDays(m[0], tb) }));
    const out = [];
    for (let i = 0; i < words.length; i++) {
      if (!words[i].days) continue;
      const g = { at: words[i].at, end: words[i].end, days: [...words[i].days], strong: words[i].days.length > 1 || words[i].w.length > 2 };
      let last = words[i];
      while (words[i + 1]?.days) {
        const next = words[i + 1], gap = line.slice(last.end, next.at);
        // A dash between two names, or "M-F" / "L-V", is a range; "M-W-F" a list.
        const list = DASH.test(gap) && (last.w.length === 1 ? !/^(?:M-F|L-V)$/.test(`${last.w}-${next.w}`) : words[i + 2]?.days && DASH.test(line.slice(next.end, words[i + 2].at)));
        if (THROUGH.test(gap) && !list && g.days.length === 1 && next.days.length === 1 && g.at === last.at) {
          // "Mon–Fri", "Mo bis Fr", "lunes a viernes", "M-F": every day from one to the other.
          for (let d = (g.days[0] + 1) % 7; d !== words[i + 1].days[0]; d = (d + 1) % 7) g.days.push(d);
          g.days.push(words[i + 1].days[0]);
        } else if (JOIN.test(gap)) g.days.push(...words[i + 1].days);
        else break;
        i++;
        last = words[i];
        g.end = last.end;
        g.strong = true;
      }
      g.days = [...new Set(g.days)].sort((a, b) => a - b);
      out.push(g);
    }
    return out;
  };

  // ---- meetings in one line ------------------------------------------------------------------------------------
  // "MWF 9:00–9:50 AM", "TR 1:30-2:45pm", "Mo 10:15–11:45", "lundi 14h–15h30", "Mondays 1–3pm and Wednesdays 10–11am",
  // "9:00 am - 9:50 am\tMWF" (a table row). opts.lang: the text's language ('en', 'de', 'es', 'fr', 'nl', 'pt'; detected
  // when left out). → [{ days: [0–6], start, end (minutes since midnight), at, to (the span of text it came from),
  // unsure: ['time' | 'end'] }]. A time without days, or days without a time, is no meeting.
  const meetings = (line, opts = {}) => {
    line = String(line);
    const tb = table(opts.lang || detect(line, opts.hint));
    const ts = times(line), gs = dayGroups(line, tb);
    // A group that is a whole table cell by itself: the cells' trimmed spans, looked up by position.
    const cells = new Set([...line.matchAll(/[^\t|]+/g)].map((c) => { const lead = c[0].length - c[0].trimStart().length; return `${c.index + lead}:${c.index + c[0].trimEnd().length}`; }));
    const cell = (g) => cells.has(`${g.at}:${g.end}`);
    // Right beside it: nothing but a few spaces, a colon or a comma between.
    const near = (g, t) => { const [a, b] = t.at > g.end ? [g.end, t.at] : [t.to, g.at]; return b - a <= 8 && /^[\s:,]*$/.test(line.slice(a, b)); };
    // Ranges first: two times with "-", "to", "bis", "à"… between; a bare hour only beside a clock that says am/pm or Uhr.
    const ranges = [];
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i], b = ts[i + 1];
      if (b && TIME_SEP.test(line.slice(a.end, b.at)) && !(a.bare && b.bare && !b.mer && !b.h24)) {
        const s = span(a, b);
        if (s) { ranges.push({ ...s, at: a.at, to: b.end }); i++; continue; }
      }
      if (a.clear && !a.bare) ranges.push({ at: a.at, to: a.end, single: a });
    }
    // Each time takes the days between it and its neighbours: those before it ("MWF 9:00"), or after it ("9:00 MWF") once
    // the line has shown it writes them that way; days shared by two times ("TR 9:30–10:45 and 11:00–12:15") are reused.
    const out = [];
    let dir = '', last = null;
    // The groups between two positions: gs is in line order, and each time looks only between its neighbours, so every
    // group is looked at about twice in all.
    const first = (pos) => { let a = 0, b = gs.length; while (a < b) { const m = (a + b) >> 1; if (gs[m].at < pos) a = m + 1; else b = m; } return a; };
    ranges.forEach((r, i) => {
      const lo = ranges[i - 1]?.to ?? 0, hi = ranges[i + 1]?.at ?? line.length;
      const ok = (g) => g.strong || near(g, r) || cell(g);
      let before = null, after = null;
      for (let k = first(lo); k < gs.length && gs[k].at < r.at; k++) if (gs[k].end <= r.at && ok(gs[k])) before = gs[k];
      for (let k = first(r.to); k < gs.length && gs[k].at < hi; k++) if (gs[k].end <= hi && ok(gs[k])) { after = gs[k]; break; }
      // A lone time ("TR 2pm") needs its days right before it.
      const g = r.single ? (before && near(before, r) ? before : null) : (dir === 'after' ? after || before : before || after) || last;
      if (!g) return;
      if (!dir && g !== last) dir = g === after ? 'after' : 'before';
      last = g;
      let { start, end } = r, unsure = r.unsure ? ['time'] : [];
      if (r.single) {
        const t = r.single;
        start = t.h24 ? t.h * 60 + t.min : (t.h % 12) * 60 + t.min + (t.mer === 'p' || (!t.mer && (t.h < 7 || t.h === 12)) ? 720 : 0);
        // Without an end: 50 minutes on three days or more, 75 on fewer (the usual US lengths), marked to check.
        end = start + (g.days.length >= 3 ? 50 : 75);
        unsure = ['end'];
        if (end > 1440) return;
      }
      out.push({ days: g.days, start, end, at: Math.min(g.at, r.at), to: Math.max(g.end, r.to), unsure });
    });
    return out;
  };

  // ---- whole documents -----------------------------------------------------------------------------------------
  const words = (list) => new RegExp(String.raw`(?<![\p{L}])(?:${list})(?![\p{L}])`, 'iu');
  const HOLIDAY_DE = /(?:ferien|feiertage?|vakantie|vorlesungsfrei)(?![\p{L}])/iu; // also inside compounds: Weihnachtsferien
  const HOLIDAY = words('no class(?:es)?|holidays?|break|recess|vacation|reading (?:week|days?)|thanksgiving|kein(?:e)? (?:unterricht|vorlesung(?:en)?)|festivos?|feriados?|vacaciones|no hay clases?|sin clases?|f[ée]ri[ée]s?|vacances|pas de cours|cong[ée]s?|geen (?:les|college)|feestdag|recesso|sem aulas?|f[ée]rias');
  const OFFICE = words('office hours?|sprechstunden?|horario de (?:atenci[oó]n|tutor[ií]as?)|tutor[ií]as|permanences?|spreekuur|atendimento');
  const BEGIN = words('classes begin|first day|term begins|semester begins|start(?:s)?|beginn|vorlesungsbeginn|inicio|comienzo|d[ée]but|rentr[ée]e|begin|eerste lesdag|in[ií]cio');
  const END = words('classes end|last day(?: of classes)?|term ends|semester ends|ends?|ende|vorlesungsende|fin(?:al)? de clases|fin des cours|einde|laatste lesdag|fim|t[ée]rmino');
  const TERM = words('term|semester|session|quarter|trimester|semestre|cuatrimestre|periodo|período|semestre|blok|kwartaal|dates?|date range');
  // A place by its word ("Science Bldg 210", "Hörsaal H1", "salle B204", "Aula Magna", "Online"): the word, up to three
  // capitalized words before it, and a room number or up to two capitalized words after it. → { at, end, text } or null.
  const ROOM = words(String.raw`room|rm\.?|hall|bldg\.?|building|auditorium|theatre|theater|online|zoom|remote|tba|raum|h[öo]rsaal|saal|geb[äa]ude|aula|sala|salle|amphi(?:th[ée][âa]tre)?|b[âa]timent|zaal|lokaal|gebouw|pr[ée]dio|bloco`);
  const NUM = String.raw`[\p{L}\d.\-\/]*\d[\p{L}\d.\-\/]*`;
  const place = (s) => {
    const m = ROOM.exec(s);
    if (!m) return null;
    const pre = /(?:[\p{Lu}][\p{L}'’.-]* ){1,3}$/u.exec(s.slice(0, m.index));
    const post = new RegExp(String.raw`^(?:[\s:]*${NUM}|(?:\s+[\p{Lu}][\p{L}]*){1,2}(?:\s+${NUM})?)?`, 'u').exec(s.slice(m.index + m[0].length));
    const at = pre ? pre.index : m.index, end = m.index + m[0].length + post[0].length;
    return { at, end, text: s.slice(at, end) };
  };
  // A course code: subject capitals and a number ("MATH 1210", "CS101", "BIO-110L", "PHYS-UA 91"), not a room, nor a term
  // heading: a season or term word and a year ("FALL 2026", "FALL TERM 2026"), or WS with a year range ("WS 2026/27"; WS
  // 2000 can be Women's Studies).
  const CODE = /(?<![\p{L}\d])((?!(?:RM|ROOM|BLDG|HALL|STE|NO|SEC|TBA|LAB|AM|PM)\b)(?!(?:FALL|TERM|HIVER|LENTE|ZOMER)[ \-_]?(?:19|20)\d\d(?![\p{L}\d])|WS[ \-_]?(?:19|20)\d\d\s*\/)[A-Z]{2,5}(?:-[A-Z]{2})?)[ \-_]?(\d{2,4}[A-Z]{0,2})(?:[ .\-](\d{1,3}|[A-Z]\d{1,2}))?(?![\p{L}\d])/u;
  // A table's header row, in any of the six languages: which cell holds what. "Days & Times" is one column; a "Class Nbr"
  // isn't the course.
  const HEAD = {
    when: words('days (?:&|and) times?|meeting(?: times?| pattern)?|meets|termine?'),
    course: words('course(?: title)?|class(?: title)?|subject|title|kurs|veranstaltung|lehrveranstaltung|fach|modul|curso|asignatura|materia|cours|mati[èe]re|enseignement|vak|cursus|disciplina|unidade curricular'),
    days: words('days?|tag|tage|wochentag|d[ií]as?|jours?|dag|dagen|dias?'),
    time: words('times?|hours|zeit|uhrzeit|horas?|horarios?|hor[áa]rio|heures?|horaires?|tijd|tijden'),
    loc: words('location|where|room|building|place|ort|raum|lugar|aula|sala|salle|lieu|lokaal|locatie|zaal|local'),
    dates: words('date range|dates|start/end date|zeitraum|fechas|p[ée]riode|periode|per[ií]odo'),
  };
  const cellsOf = (line) => line.split(/\t| \| |\s{3,}/).map((c) => c.trim());
  const header = (cells) => {
    const map = {};
    cells.forEach((c, i) => {
      if (!c || c.length > 40 || /\d/.test(c)) return;
      for (const [k, re] of Object.entries(HEAD)) if (map[k] === undefined && re.test(c) && !(k === 'course' && /nbr|number|#|\bid\b|\bno\b/i.test(c))) { map[k] = i; break; }
    });
    return Object.keys(map).length >= 2 && (map.time !== undefined || map.when !== undefined) ? map : null;
  };
  // What's left of a label once days, times, dates, places and joining words are out.
  const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s\-–—:,;|•·@()]+|[\s\-–—:,;|•·@(]+$/g, '').replace(/^(?:(?:from|de|das|von|van|du|at|in|em|en|on|le|am|um|op)\s+)+/i, '').replace(/\(\s*\)/g, '').trim();
  const codeName = (label) => {
    const m = CODE.exec(label);
    const code = m ? `${m[1]} ${m[2]}`.trim() : '';
    // Without the code, and a section number left after it ("Calculus I - MATH 1210 - 002").
    const name = tidy((m ? label.slice(0, m.index) + ' ' + label.slice(m.index + m[0].length) : label).replace(/\s[-–—]\s*\d{1,3}\s*$/, ' ')).replace(/^[-–—:,\s]+|[-–—:,\s]+$/g, '');
    return { code, name: name || code };
  };
  // A line as a heading for the rows under it: short, with letters, not "Key: value", not a table header.
  const heading = (line) => line.length <= 90 && /\p{L}{3}/u.test(line) && !/^[^:]{1,30}:\s*\S/.test(line) && !line.includes('\t');

  // Text (pasted, or from an HTML page or Word file) → { entries, term, skip, lang, ignored }.
  // entries: [{ label, code, name, periods: [{ days, start, end, loc, from, to, skip, unsure }] }], one per course label,
  // in the order they came. term/skip: dates found for the whole document; each period has them unless its own row said
  // otherwise. ignored: lines with a time and days that look like one-off events (an exam on a date) or office hours.
  // Work is bounded for a huge or hostile paste (LIMITS): what's past the first megabyte is left out (truncated says so),
  // a long line is read in pieces, and each line, course and the days off have caps far above any timetable's.
  const LIMITS = { text: 1 << 20, line: 2000, meetings: 20, courses: 100, periods: 20, skip: 400 };
  const fromText = (text, opts = {}) => {
    const now = opts.now ?? Date.now();
    const all = String(text);
    const raw = all.slice(0, LIMITS.text).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    const lang = detect(raw, opts.lang);
    const c = { lang, now };
    const lines = raw.split('\n').flatMap((l) => (l.length > LIMITS.line ? l.match(new RegExp(`[^]{1,${LIMITS.line}}`, 'g')) : [l])).map((l) => l.replace(/[ \f\v]+$/g, ''));
    const term = { from: '', to: '' };
    const skip = new Set();
    const byLabel = new Map();
    let cols = null, head = '', last = '', ignored = 0, error = '';
    const add = (label, p) => {
      const k = tidy(label).toLowerCase() || '?';
      if (!byLabel.has(k) && byLabel.size >= LIMITS.courses) { error = 'courses'; return; }
      if (!byLabel.has(k)) byLabel.set(k, { label: tidy(label), ...codeName(tidy(label)), periods: [] });
      const e = byLabel.get(k);
      if (e.periods.some((x) => x.days.join() === p.days.join() && x.start === p.start && x.end === p.end && x.loc === p.loc)) return;
      if (e.periods.length >= LIMITS.periods) error = 'periods'; else e.periods.push(p);
    };
    for (const line of lines) {
      if (!line.trim()) { cols = null; continue; }
      const spans = dateSpans(line, c);
      const holiday = HOLIDAY.test(line) || HOLIDAY_DE.test(line);
      // Dates out of the way first, so "24.08.2026" isn't read as a time.
      const rest = blanks(line, spans);
      const allMeetings = holiday ? [] : meetings(rest, { lang });
      const found = allMeetings.slice(0, LIMITS.meetings);
      if (holiday) {
        for (const d of spans) for (let n = dayNum(d.from); n <= Math.min(dayNum(d.to), dayNum(d.from) + 60) && skip.size < LIMITS.skip; n++) skip.add(keyOf(n));
        continue;
      }
      if (!found.length) {
        const h = header(cellsOf(line));
        if (h) { cols = h; continue; }
        const range = spans.find((d) => !d.one);
        if (range && (TERM.test(line) || !term.from)) { term.from = range.from; term.to = range.to; continue; }
        if (spans.length === 1 && BEGIN.test(line)) { term.from = spans[0].from; continue; }
        if (spans.length === 1 && END.test(line)) { term.to = spans[0].to; continue; }
        if (heading(line.trim()) && !spans.length) {
          if (CODE.test(line) || !CODE.test(head)) head = line.trim();
          last = line.trim();
        }
        continue;
      }
      if (OFFICE.test(line) || (spans.length && spans.every((d) => d.one))) { ignored += found.length; continue; }
      if (allMeetings.length > LIMITS.meetings) error = 'periods';
      const own = spans.find((d) => !d.one);
      const cells = cellsOf(line);
      // The rest of the line without its meetings, and a place in it by its words: the same for each meeting on it.
      let s = blanks(rest, found.map((o) => ({ at: o.at, end: o.to })));
      const pl = place(s);
      if (pl) s = blanks(s, [pl]);
      for (const m of found) {
        let label = '', loc = '', unsure = [...m.unsure];
        if (cols) {
          const at = (k) => (cols[k] === undefined ? '' : cells[cols[k]] || '');
          label = at('course') || head;
          loc = at('loc');
          if (!at('course')) unsure.push('label');
        } else {
          // The label before or after the meeting.
          if (pl) loc = tidy(pl.text);
          const split = (x) => x.split(/\t| \| | [·•] |\s{3,}|,\s/).map(tidy).filter((y) => /\p{L}{2}/u.test(y));
          const pre = split(s.slice(0, m.at)), post = split(s.slice(m.to));
          // With the label before the meeting, what follows it is likely the room, where no word said so.
          if (!loc && pre.length && post.length && !CODE.test(post[0])) { loc = post.shift(); unsure.push('loc'); }
          const parts = [...pre, ...post];
          // Under a heading with a course code (a list naming the course, then its times below), a line with no code
          // of its own is that course's.
          label = parts.find((x) => CODE.test(x)) || (CODE.test(head) ? '' : parts[0]) || '';
          if (!label) { label = head || last; unsure.push('label'); }
        }
        add(label || '?', { days: m.days, start: m.start, end: m.end, loc: tidy(loc), from: own?.from || '', to: own?.to || '', skip: [], unsure: [...new Set(unsure)] });
      }
    }
    const entries = [...byLabel.values()];
    for (const e of entries) for (const p of e.periods) {
      p.from ||= term.from;
      p.to ||= term.to;
      p.skip = [...skip].filter((k) => (!p.from || k >= p.from) && (!p.to || k <= p.to) && p.days.includes(weekday(dayNum(k)))).sort();
    }
    return { entries, term, skip: [...skip].sort(), lang, ignored, truncated: all.length > LIMITS.text, ...(error && { error }) };
  };

  // An .ics calendar → the same shape. Each event's times in the window are read in the student's zone; events are grouped
  // by their title into courses and, within one, by start, end and place into weekly periods. A title that happens once
  // (an exam, a deadline) is left out and counted. Weeks a weekly class doesn't meet (EXDATE, a moved class) become
  // skipped dates. Every period ends on the last meeting seen in the window (now − 200 to now + 300 days): its days off are
  // only known inside it, so a rule without an end (or one read in another zone, which splits at the clock changes) never
  // runs on past it as a weekly class the calendar doesn't have; that end is marked for the student to check.
  // ponytail: a class every other week shows as weekly with every second week skipped.
  const fromIcs = (input, opts = {}) => {
    const I = globalThis.GZ_ICS || require('./ics.js');
    const now = opts.now ?? Date.now(), tz = opts.tz;
    const cal = I.parse(input, { tz });
    const occ = I.expand(cal, now - 200 * DAY, now + 300 * DAY);
    const L = T();
    const groups = new Map();
    let ignored = 0;
    for (const o of occ) {
      const e = o.event;
      if (e.allDay || !(o.end > o.start) || o.end - o.start > 8 * 36e5) continue;
      const a = L.inputs(o.start, tz), b = L.inputs(o.end, tz);
      if (a.date !== b.date) continue;
      const title = e.summary.trim() || '?';
      if (!groups.has(title)) groups.set(title, { events: new Set(), slots: new Map() });
      const g = groups.get(title);
      g.events.add(e);
      const mins = (x) => +x.time.slice(0, 2) * 60 + +x.time.slice(3);
      const k = `${mins(a)}|${mins(b)}|${e.location.trim()}`;
      if (!g.slots.has(k)) g.slots.set(k, { start: mins(a), end: mins(b), loc: e.location.trim(), dates: new Set(), open: false });
      const s = g.slots.get(k);
      s.dates.add(a.date);
      if (e.rrule && e.rrule.until == null && e.rrule.count == null) s.open = true;
    }
    const entries = [];
    for (const [title, g] of groups) {
      const total = [...g.slots.values()].reduce((n, s) => n + s.dates.size, 0);
      if (total < 2) { ignored++; continue; }
      const periods = [];
      for (const s of g.slots.values()) {
        const ds = [...s.dates].sort();
        const days = [...new Set(ds.map((d) => weekday(dayNum(d))))].sort((x, y) => x - y);
        const from = ds[0], to = ds.at(-1);
        const missing = [];
        for (let n = dayNum(from); n <= dayNum(to); n++) if (days.includes(weekday(n)) && !s.dates.has(keyOf(n))) missing.push(keyOf(n));
        periods.push({ days, start: s.start, end: s.end, loc: s.loc, from, to, skip: missing, unsure: [...(missing.length > ds.length / 2 ? ['days'] : []), ...(s.open ? ['to'] : [])] });
      }
      entries.push({ label: title, ...codeName(title), periods });
    }
    return { entries, term: { from: '', to: '' }, skip: [], lang: 'en', ignored, problems: cal.problems.length };
  };

  // ---- matching a label to a Canvas or Ultra course -------------------------------------------------------------
  // courses: Canvas's list ({ id, name, course_code, friendly_name }), or Ultra's in that shape (lib/ultra.js list). By code first ("MATH 1210" in "MATH-1210-002"),
  // then by name (most shared words of three letters or more). → the course id, or '' when nothing is close.
  const norm = (s) => bare(String(s || '')).replace(/[^a-z0-9]/g, '');
  const wordsOf = (s) => new Set(bare(String(s || '')).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^\d+$/.test(w)));
  const match = (entry, courses) => {
    const code = norm(entry.code);
    if (code) {
      // The whole code, however its parts are separated: "CS 101" isn't in "ECONOMICS101", nor "MATH 121" in "MATH 1210".
      const re = new RegExp(`(?<![a-z])${[...code].join('[^a-z0-9]*')}(?!\\d)`);
      const hit = courses.filter((c) => [c.course_code, c.name, c.friendly_name].some((x) => re.test(bare(String(x || '')))));
      if (hit.length === 1) return String(hit[0].id);
    }
    const mine = wordsOf(entry.name || entry.label);
    if (!mine.size) return '';
    const scored = courses.map((c) => {
      const theirs = wordsOf(`${c.name} ${c.friendly_name || ''}`);
      const both = [...mine].filter((w) => theirs.has(w)).length;
      return [both / Math.max(1, Math.min(mine.size, theirs.size)), String(c.id)];
    }).sort((a, b) => b[0] - a[0]);
    return scored[0] && scored[0][0] >= 0.6 && (!scored[1] || scored[1][0] < scored[0][0]) ? scored[0][1] : '';
  };

  // ---- what's kept: storage.local classes:<site>/<user id> ------------------------------------------------------
  // { courses: [{ id: a Canvas or Ultra course id or 'o-…' (not one of the student's courses there), code, name, at (when it was last saved), periods:
  // [{ days, start, end, loc, from, to, skip, tz (the zone its times are wall-clock times in: the Canvas profile's when it
  // was saved) }] }], cleared (when Delete all was last pressed), gone (course id → when it was deleted), tz (the zone of a
  // period saved before periods kept their own; '' before that too: the student's zone now) }. Everything is checked on the
  // way in and out; a write over MAX is refused whole. importedSkip keeps the calendar's exceptions before manual edits;
  // old records without it keep their days off on reimport, since their origin can't be recovered.
  const MAX = { periods: 20, courses: 60, skip: 200 };
  const IMPORT_SKIP = 500; // the calendar reader's whole window, including dates removed during review
  const storeKey = (origin, uid) => `classes:${origin}/${uid}`;
  const STORE_KEY = /^classes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i;
  const ID = /^(?:\d{1,20}|_\d{1,20}_\d{1,20}|o-[a-z0-9-]{1,40})$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
  const date = (v) => (typeof v === 'string' && DATE.test(v) && dayNum(v) === Math.floor(dayNum(v)) && keyOf(dayNum(v)) === v ? v : '');
  const ms = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const skipDates = (v, cap) => Array.isArray(v) ? [...new Set(v.map(date).filter(Boolean))].sort().slice(0, cap) : [];
  const period = (p, cap = MAX.skip) => {
    const days = Array.isArray(p?.days) ? [...new Set(p.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];
    const start = Number.isInteger(p?.start) ? p.start : -1, end = Number.isInteger(p?.end) ? p.end : -1;
    if (!days.length || !(start >= 0 && end > start && end <= 1440)) return null;
    let from = date(p.from), to = date(p.to);
    if (from && to && to < from) [from, to] = [to, from];
    const skip = skipDates(p.skip, cap);
    const tz = zone(p.tz);
    return { days, start, end, loc: str(p.loc, 120), from, to, skip, ...(tz && { tz }),
      ...(Array.isArray(p.importedSkip) && { importedSkip: skipDates(p.importedSkip, cap === Infinity ? Infinity : IMPORT_SKIP) }) };
  };
  const course = (c, cap = MAX.periods) => {
    if (!c || !ID.test(String(c.id))) return null;
    const periods = (Array.isArray(c.periods) ? c.periods : []).map((p) => period(p, cap === Infinity ? Infinity : MAX.skip)).filter(Boolean).slice(0, cap);
    return periods.length ? { id: String(c.id), code: str(c.code, 40), name: str(c.name, 200) || str(c.code, 40) || '?', at: ms(c.at), periods } : null;
  };
  const clean = (raw) => {
    const seen = new Set();
    const cleared = ms(raw?.cleared);
    const gone = Object.fromEntries(Object.entries(raw?.gone && typeof raw.gone === 'object' ? raw.gone : {}).filter(([k, v]) => ID.test(k) && ms(v) > cleared).slice(-200));
    return { courses: (Array.isArray(raw?.courses) ? raw.courses : []).map((c) => course(c)).filter((c) => c && !seen.has(c.id) && seen.add(c.id)).slice(0, MAX.courses), cleared, gone, tz: zone(raw?.tz) };
  };
  // An IANA zone name Intl knows, or ''.
  const zone = (v) => (typeof v === 'string' && v.length < 64 && T().zone(v)) || '';
  const same = (a, b) => a.days.join() === b.days.join() && a.start === b.start && a.end === b.end && a.loc === b.loc && a.from === b.from && a.to === b.to;
  // For a course that isn't on Canvas: an id from its name.
  const otherId = (name) => `o-${bare(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38) || 'class'}`;

  // ---- writes: one at a time, in the background worker (lib/background.js 'glaze:classes') ----------------------
  // m: { key, op, at (when the student pressed Save or Delete), tz, … } from a Canvas page. add: courses from a review, their
  // periods joined to any already kept for the same course (once, with updated holidays and manual exceptions kept); put:
  // courses edited, each replacing what's kept for it,
  // and only while it is kept; drop: one course (id); clear: all of them. A period without its own zone takes m.tz, the
  // page's: no save changes the zone of a period already kept. Writes can arrive late and from other tabs, so each is
  // weighed by when it was made: nothing older than a Delete all (cleared), the course's deletion (gone) or its last save
  // comes back or overwrites. → { ok, data, stale (some of it was older and left out) }, or nothing written and error
  // 'periods', 'courses' or 'skip' when the result would be over MAX.
  const change = async (m, area) => {
    if (typeof m?.key !== 'string' || !STORE_KEY.test(m.key) || !ms(m.at)) return { ok: false, error: 'bad' };
    const d = clean((await area.local.get([m.key]))[m.key]);
    const at = m.at, mz = zone(m.tz);
    const list = Array.isArray(m.courses) ? m.courses.map((c) => course(c, Infinity)).filter(Boolean) : [];
    const late = (id, cur) => at <= d.cleared || (d.gone[id] || 0) >= at || (cur?.at || 0) > at;
    const zoned = (p, old = []) => ({ ...p, tz: p.tz || mz || old.find((q) => same(p, q))?.tz || new Intl.DateTimeFormat().resolvedOptions().timeZone });
    const own = (p) => p.tz || d.tz || mz || undefined;
    const instants = new Map();
    // A bounded period can be read on another clock, even another weekday. Compare every meeting, not one DST offset.
    const moments = (p) => {
      if (instants.has(p)) return instants.get(p);
      if (!p.from || !p.to || dayNum(p.to) - dayNum(p.from) > 732) return null;
      const out = [];
      for (let n = dayNum(p.from); n <= dayNum(p.to); n++) if (p.days.includes(weekday(n))) {
        out.push([T().typed(keyOf(n), hhmm(p.start), own(p)), T().typed(keyOf(n), hhmm(Math.min(p.end, 1439)), own(p))]);
      }
      const value = out.length ? JSON.stringify(out) : null;
      instants.set(p, value);
      return value;
    };
    const twin = (p) => (q) => (same(p, q) && (!own(p) || !own(q) || own(p) === own(q)))
      || (p.loc === q.loc && own(p) !== own(q) && moments(p) !== null && moments(p) === moments(q));
    // Different DST rules can split one imported period into several. Equal source meetings still identify the same
    // calendar; compare connected groups so an unrelated time in the same room doesn't prevent the match.
    const equalGroups = (old, now) => {
      const series = (p) => {
        const raw = moments(p), skip = p.importedSkip || p.skip;
        return raw && new Set(JSON.parse(raw).filter(([at]) => !skip.includes(T().inputs(at, own(p)).date)).map((x) => JSON.stringify(x)));
      };
      const left = old.filter((q) => !now.some(twin(q))).map((p) => ({ p, times: series(p) }));
      const right = now.filter((p) => !old.some(twin(p))).map((p) => ({ p, times: series(p) }));
      const matched = new Set(), edited = new Map(), visited = new Set();
      const overlap = (a, b) => a.p.loc === b.p.loc && a.times && b.times && [...a.times].some((x) => b.times.has(x));
      for (const seed of right) {
        if (visited.has(seed)) continue;
        const ls = new Set(), rs = new Set([seed]);
        let size;
        do {
          size = ls.size + rs.size;
          for (const a of left) if ([...rs].some((b) => overlap(a, b))) ls.add(a);
          for (const b of right) if ([...ls].some((a) => overlap(a, b))) rs.add(b);
        } while (size !== ls.size + rs.size);
        for (const b of rs) visited.add(b);
        const a = new Set([...ls].flatMap((x) => [...x.times])), b = new Set([...rs].flatMap((x) => [...(x.times || [])]));
        if (a.size && a.size === b.size && [...a].every((x) => b.has(x))) {
          for (const x of rs) matched.add(x.p);
          for (const { p: q } of ls) {
            const nominal = new Set(JSON.parse(moments(q)).map((x) => JSON.stringify(x))), skip = new Set(q.skip);
            for (const { p } of rs) {
              const changeDates = (ds, add) => {
                for (const k of ds) {
                  const at = T().typed(k, hhmm(p.start), own(p)), end = T().typed(k, hhmm(Math.min(p.end, 1439)), own(p));
                  if (nominal.has(JSON.stringify([at, end]))) {
                    const day = T().inputs(at, own(q)).date;
                    if (add) skip.add(day); else skip.delete(day);
                  }
                }
              };
              changeDates(p.skip.filter((k) => !p.importedSkip.includes(k)), true);
              changeDates(p.importedSkip.filter((k) => !p.skip.includes(k)), false);
            }
            edited.set(q, { ...q, skip: [...skip].sort() });
          }
        }
      }
      return { matched, edited };
    };
    const imported = (p) => ({ ...p, importedSkip: p.importedSkip || p.skip });
    const reconcile = (q, p) => {
      if (!p) return q;
      const convert = (ds) => ds.map((k) => T().inputs(T().typed(k, hhmm(p.start), own(p)), own(q)).date);
      const prior = q.importedSkip || [];
      const removed = prior.filter((k) => !q.skip.includes(k));
      const added = q.skip.filter((k) => !prior.includes(k));
      return { ...q, skip: [...new Set([...convert(p.skip), ...added])].filter((k) => !removed.includes(k)).sort(),
        importedSkip: [...new Set([...convert(p.importedSkip || p.skip), ...removed])].sort() };
    };
    let stale = false;
    if (m.op === 'add' || m.op === 'put') {
      for (const c of list) {
        let i = d.courses.findIndex((x) => x.id === c.id);
        if (late(c.id, d.courses[i]) || (m.op === 'put' && i < 0)) { stale = true; continue; }
        delete d.gone[c.id];
        const now = c.periods.map((p) => zoned(p, d.courses[i]?.periods)).map((p) => m.op === 'add' ? imported(p) : p);
        if (now.some((p) => p.skip.length > MAX.skip || p.importedSkip?.length > IMPORT_SKIP)) return { ok: false, error: 'skip' };
        if (i < 0) i = d.courses.push({ ...c, at, periods: now }) - 1;
        else if (m.op === 'put') d.courses[i] = { ...c, at, periods: now };
        else {
          const old = d.courses[i].periods, groups = equalGroups(old, now);
          d.courses[i] = { ...d.courses[i], at, periods: [...old.map((q) => groups.edited.get(q) || reconcile(q, now.find(twin(q)))), ...now.filter((p) => !groups.matched.has(p) && !old.some(twin(p)))] };
        }
        if (d.courses[i].periods.some((p) => p.skip.length > MAX.skip || p.importedSkip?.length > IMPORT_SKIP)) return { ok: false, error: 'skip' };
        if (d.courses[i].periods.length > MAX.periods) return { ok: false, error: 'periods' };
      }
      if (d.courses.length > MAX.courses) return { ok: false, error: 'courses' };
    } else if (m.op === 'drop' && typeof m.id === 'string' && ID.test(m.id)) {
      const cur = d.courses.find((c) => c.id === m.id);
      if (late(m.id, cur)) stale = true;
      else { d.courses = d.courses.filter((c) => c !== cur); d.gone[m.id] = at; }
    } else if (m.op === 'clear') {
      if (at > d.cleared) { d.cleared = at; d.courses = d.courses.filter((c) => c.at > at); }
    } else return { ok: false, error: 'bad' };
    const next = clean(d);
    return (await area.local.set({ [m.key]: next })) ? { ok: true, data: next, ...(stale && { stale }) } : { ok: false, error: 'write' };
  };

  // ---- using it -------------------------------------------------------------------------------------------------
  // The classes on day n (a day number, as lib/todo.js counts them): [{ id, code, name, start, end, loc, p (its period's
  // place in the course) }], earliest first; only the periods `only` picks, when given.
  const onDay = (store, n, only) => {
    const k = keyOf(n), wd = weekday(n);
    const out = [];
    for (const c of clean(store).courses) c.periods.forEach((p, i) => {
      if ((!only || only(p)) && p.days.includes(wd) && (!p.from || k >= p.from) && (!p.to || k <= p.to) && !p.skip.includes(k)) out.push({ id: c.id, code: c.code, name: c.name, start: p.start, end: p.end, loc: p.loc, p: i });
    });
    return out.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  };
  const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  // A period's times are wall-clock times in its own zone; else the schedule's (kept before periods kept theirs); else tz,
  // the student's Canvas zone now, for a schedule saved before either was kept.
  const zoneOf = (store, tz) => zone(store?.tz) || tz;
  // Every class meeting that starts in [from, to) (instants), earliest first: { ...onDay's fields, day (its date in its
  // period's zone), at, until (its start and end instants) }. Chosen by instant, not by matching day numbers, so a class
  // at 23:00 in Phoenix falls on the next day for a student whose Canvas is in New York. A time the clocks skip is read past
  // the gap, as Better To Do reads typed times (lib/todo.js typed).
  const between = (store, from, to, tz) => {
    const L = T(), s = clean(store), base = zoneOf(s, tz);
    const out = [];
    for (const z of new Set(s.courses.flatMap((c) => c.periods.map((p) => p.tz || base)))) {
      for (let n = L.dayOf(from, z) - 1; n <= L.dayOf(to, z) + 1 && out.length < 5000; n++) for (const x of onDay(s, n, (p) => (p.tz || base) === z)) {
        const at = L.typed(keyOf(n), hhmm(x.start), z), until = L.typed(keyOf(n), hhmm(Math.min(x.end, 1439)), z);
        if (at !== null && until > at && at >= from && at < to) out.push({ ...x, day: keyOf(n), at, until });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  };
  // Class-start reminders (lib/remind.js events()'s extra shape) from a day back to a week ahead: `lead` minutes before
  // each class, until ten minutes into it.
  const events = (store, { now = Date.now(), tz, lead = 10 } = {}) => between(store, now - DAY - 10 * 6e4, now + 8 * DAY, tz).map((x) => ({
    key: `class:${x.id}.${x.p}`, cat: 'class', at: x.at - lead * 6e4, until: x.at + 10 * 6e4, end: x.at, title: x.name, course: x.loc, url: /^\d+$/.test(x.id) ? `/courses/${x.id}` : /^_\d+_\d+$/.test(x.id) ? `/ultra/courses/${x.id}/outline` : '',
  }));
  // For a calendar export (W13's .ics): every class meeting from the start of day `from` to the end of day `to` (day keys
  // of the student's Canvas zone, tz, as the export's range; a period with no end of term stops there), as lib/ics.js
  // write() takes events: exact instants, written in UTC, worked out in the schedule's zone, so a 9:00 class in Phoenix
  // is 16:00Z whatever zone the calendar it's imported into is in.
  const icsEvents = (store, { site = '', from, to, tz }) => {
    const L = T(), s = clean(store);
    return between(s, L.midnight(dayNum(from), tz), L.midnight(dayNum(to) + 1, tz), tz).map((x) => {
      const id = [site, 'class', x.id, x.day, x.start].map((p) => encodeURIComponent(String(p))).join('/');
      const prior = s.courses.find((c) => c.id === x.id).periods.slice(0, x.p).some((p) => p.start === x.start);
      return { uid: prior ? `${id}/${x.at}/${x.p}@glaze` : `${id}@glaze`,
        start: x.at, end: x.until, summary: x.code && !x.name.includes(x.code) ? `${x.code} ${x.name}` : x.name, location: x.loc,
      };
    });
  };

  return { meetings, detect, fromText, fromIcs, match, storeKey, STORE_KEY, MAX, clean, change, otherId, onDay, between, events, icsEvents, weekday, keyOf, dayNum, hhmm, date };
})();

if (typeof module !== 'undefined') module.exports = GZ_CLASSES; else GZ_CLASSES;
