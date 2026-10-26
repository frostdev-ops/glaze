// Syllabus import (W15) with AI: what a model read (lib/ai/tasks/syllabus-read.js, every value as the syllabus writes it,
// with its quote, already grounded) turned into lib/syllabus.js extract()'s shape by Glaze's own readers, and put beside what
// extract() found. The model never works out a date or a number: each value goes through extract() on a line made of it
// ("Due: Friday of week 3", "Office hours: Tue/Thu 2-3:30 PM", "Grading scale" and its rows), so dates fall in the term's
// year and course weeks count from week 1 exactly as they do for a line in the syllabus; a value Glaze can't read is left
// out. Every value from AI is to check ('check'), its quote as src and ai: true.
// The merge (merge): what extract() found stays: a field it filled keeps its value (marked 'check' when AI read it
// differently), AI fills only what it left empty; a time or a date AI adds must be on a day and at an hour extract() left
// free, so AI only ever adds. Loaded on demand by features/syllabus.js (lib/background.js LOADABLE); node takes it whole.
var GZ_SYLLABUS_AI = globalThis.GZ_SYLLABUS_AI || (() => {
  const L = () => globalThis.GZ_SYLLABUS || require('./syllabus.js');
  const DAY = 86400000;
  const fold = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
  const ai = (value, src, more = {}) => ({ value, conf: 'check', src: String(src).slice(0, 300), ai: true, ...more });
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ms = (day) => (day ? Date.parse(`${day}T00:00:00Z`) : undefined);
  // A quote's words (letters or digits, two or more), folded: what ties a title to the line it is on.
  const words = (s) => fold(s).match(/[\p{L}\p{N}][\p{L}\p{N}.]*[\p{L}\p{N}]/gu) || [];
  // Rows that aren't the student's work: enrolment deadlines, holidays, days without class.
  const ADMIN = /(?<![\p{L}])(?:last day|add\/drop|drop|withdraw\w*|holiday|no class(?:es)?|recess|break|reading week|feiertag|vorlesungsfrei|rückmeldung|festivo|feriado|vacaciones|sin clases|congé|relâche|vakantie|collegevrij|recesso|sem aula)(?![\p{L}])/iu;
  // A title that names a piece of work by its number ("Problem Set 4", "HW 1", "Práctica 2", "A3"), not a count of
  // something ("Bring 5 pages").
  const NUMBERED = /(?<![\p{L}\d])\p{L}[\p{L}\p{M}'’.-]*(?:\s+\p{L}[\p{L}\p{M}'’.-]*){0,2}\s?#?\d{1,2}(?:\.\d{1,2})?(?![\d\p{L}])(?!\s*(?:pages?|words?|minutes?|min|hours?|points?|pts|slides?|questions?|%|seiten|wörter|páginas|palabras|pages|mots|pagina's|woorden|palavras))/iu;
  // Numbers that place something rather than name it: a week, a unit, a chapter, a day.
  const PLACE = /(?<![\p{L}])(?:week|wk|woche|kw|semana|semaine|unit|module|modul|chapter|ch|kapitel|cap[ií]tulo|chapitre|hoofdstuk|day|tag|d[ií]a|jour|dag)\.?\s*#?\d+/giu;
  const OFFICE = /(?<![\p{L}])(?:(?:office(?:\s+(?:location|room))?|büro|sprechzimmer|despacho|oficina|bureau|kantoor|gabinete)(?:\s*[:\t-]\s*|\s+)|(?:raum|room|salle|sala|local|cubículo|kamer)\s*[:\t-]\s*)/giu;
  const VENUE = /(?<![\p{L}])(?:(?:office|student|drop-in)\s+hours?|heures? de bureau|hora(?:rio)?s? de oficina|sprechstunden?|spreekur?en?|horários? de atendimento|class(?:room|es)?|lecture|lab(?:oratory)?|seminar|vorlesung|unterricht|clases?|cours|aula)(?![\p{L}])/giu;
  const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- reading AI's values with Glaze's readers --------------------------------------------------------------------
  // out: the task's output; opts: what extract() was given ({ start, md, hint, week1 }); heur: extract()'s result; text:
  // what was read, whose own week 1 (a start the syllabus states) places AI's dates by course week too.
  const interpret = (out, opts = {}, heur = null, text = '') => {
    const S = L();
    const r = { prof: {}, hours: [], meetings: [], dates: [], scale: { value: '', conf: '', src: '' }, weights: { value: '', conf: '', src: '' }, week1: { value: '', conf: '', src: '', from: '' } };
    // Read as office hours, any times in a text, by day, start and end.
    const times = (text) => S.extract(`Office hours: ${text}`, opts).hours.flatMap((m) => m.days.map((d) => `${d} ${m.start} ${m.end}`));
    const classRooms = (heur?.meetings || []).map((m) => fold(m.location)).filter(Boolean);
    const office = (f) => {
      const norm = (s) => fold(s).replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '');
      const value = norm(f.text);
      // Clock times need not name a weekday; a phone number can carry a label or an extension with letters in it.
      if (!/\d/.test(value) || !/\p{L}/u.test(value) || /\d\s*:\s*\d|\d\s*(?:[ap]\.?\s*m\b|uhr\b|uur\b|h\b)/iu.test(value)
        || /(?:\d[\s().+-]*){7,}|\b(?:phone|tel|telephone|telefon|teléfono|téléphone|telefone|fax|ext)\b/iu.test(value)
        || times(f.text).length || classRooms.some((c) => c.includes(value) || value.includes(c))) return false;
      const email = fold(heur?.prof?.email?.value || r.prof.email?.value);
      // Evidence belongs to the candidate's own line. An explicit office label can follow a classroom/hours clause,
      // but a room label inside such a clause cannot turn its venue into the professor's office.
      const context = (source) => source.split(/[\r\n]+/).some((raw) => {
        const line = norm(raw), at = line.indexOf(value);
        if (at < 0) return false;
        const before = line.slice(0, at), boundary = [...before.matchAll(/[;·]|\.(?=\s)/g)].at(-1);
        const start = boundary ? boundary.index + 1 : 0;
        const labels = [...before.replace(VENUE, (m) => ' '.repeat(m.length)).slice(start).matchAll(OFFICE)];
        const label = labels.at(-1), venue = [...before.matchAll(VENUE)].at(-1);
        const explicit = label && /^(?:office|büro|sprechzimmer|despacho|oficina|bureau|kantoor|gabinete)\b/u.test(label[0]);
        if (venue && (!explicit || start + label.index < venue.index)) return false;
        const contact = email && (line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).includes(email);
        const clause = line.slice(start).split(/[;·]|\.(?=\s)/)[0];
        return !!label || !!contact || norm(S.extract(clause, opts).prof.office.value).includes(value);
      });
      // Grounding tolerates whitespace changes in quotes, so a model can collapse separate source lines. Recheck the
      // original syllabus as well before using a contact line as office evidence.
      return context(f.quote) && (!text || context(text));
    };
    // The professor's fields as extract() would take them: an office is a room (a number and a word in it) on a line that
    // labels an office (not office hours, which can be anywhere) or gives the professor's e-mail, never a time or a class's room; office hours in words are words (no
    // time Glaze can read) on a line their label starts.
    const fits = {
      name: () => true,
      email: (f) => EMAIL.test(f.text),
      office,
      note: (f) => !times(f.text).length && !!S.extract(f.quote, opts).prof.note.value,
    };
    for (const k of ['name', 'email', 'office', 'note']) {
      const f = out?.prof?.[k];
      r.prof[k] = f?.text && fits[k](f) ? ai(f.text.slice(0, k === 'note' ? 200 : 120), f.quote) : { value: '', conf: '', src: '' };
    }
    // Times: one line per row, under the label that makes it office hours or a class, each day and time range one its quote
    // gives too.
    for (const [group, head] of [['hours', 'Office hours'], ['meetings', 'Lecture']]) {
      for (const s of out?.[group] || []) {
        const quoted = times(s.quote);
        for (const m of S.extract(`${head}: ${s.when}`, opts)[group]) {
          if (!m.days.every((d) => quoted.includes(`${d} ${m.start} ${m.end}`))) continue;
          r[group].push(ai(undefined, s.quote, { label: (s.label || '').slice(0, 80), days: m.days, start: m.start, end: m.end, location: (s.where || '').slice(0, 80) }));
        }
      }
    }
    for (const g of ['hours', 'meetings']) r[g] = r[g].map(({ value: _, ...m }) => m);
    // The scale as a table under its heading; three letters at least, as extract() wants.
    // Each row's letter and numbers are in its quote.
    const numbers = (s) => (fold(s).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => Number(n.replace(',', '.')));
    const rows = (out?.scale || []).filter((x) => new RegExp(`(?<![\\p{L}])${re(x.letter)}(?![\\p{L}+-])`, 'iu').test(x.quote)
      && numbers(x.range).length && numbers(x.range).every((n) => numbers(x.quote).includes(n)));
    if (rows.length === out?.scale?.length && rows.length) {
      const sc = S.extract(`Grading scale\n${rows.map((x) => `${x.letter} ${x.range.toLowerCase()}`).join('\n')}`, opts).scale;
      if (sc.value) r.scale = { ...sc, ...ai(sc.value, out.scale.map((x) => x.quote).join(' · ')) };
    }
    // Weights: a name and a percent, the number in the quote; a share Glaze can't read as a percent is left out.
    const ws = [];
    for (const w of out?.weights || []) {
      const p = S.parseWeights(`${w.name} ${w.weight}`);
      const percents = [...fold(w.quote).matchAll(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:%|percent\b|prozent\b|por ciento\b|pour cent\b|procent\b|por cento\b)/g)].map((m) => Number(m[1].replace(',', '.')));
      if (p?.length === 1 && /%|\d$/.test(w.weight.trim()) && percents.includes(p[0].weight)) ws.push(p[0]);
    }
    if (ws.length >= 2) {
      const total = Math.round(ws.reduce((a, w) => a + w.weight, 0) * 100) / 100;
      r.weights = ai(ws, out.weights.map((x) => x.quote).join(' · '), { issues: Math.abs(total - 100) < 0.6 ? [] : [{ kind: 'sum', total }] });
    }
    // Week 1: the start the syllabus states, as extract() reads it (it says so only beside a date by course week of its own:
    // the text is read again with one), else AI's (read as a date), else the course's or the term's.
    const dayIn = (when, o = opts) => S.extract(`Exam: ${when}`, o).dates.find((d) => !d.week)?.day || '';
    const own = heur?.week1?.value ? heur.week1 : text ? S.extract(`${text}\n\nWeek 2 - Friday: Exam`, { ...opts, week1: undefined }).week1 : null;
    const stated = own?.value && own.from === 'text' ? own.value : '';
    const candidate = out?.week1?.text ? dayIn(out.week1.text) : '';
    const aiStart = candidate && candidate === dayIn(out.week1.quote) ? candidate : '';
    const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '');
    const anchor = stated || aiStart || iso(opts.week1) || iso(opts.start);
    const o = anchor ? { ...opts, week1: ms(anchor) } : opts;
    // Dates: exams and deadlines only, each read from its when, and only where its quote holds both a word of its title and
    // that day (or that course week); a row about enrolment or a holiday is out.
    const seen = new Set();
    for (const d of out?.dates || []) {
      if ((d.kind !== 'exam' && d.kind !== 'due') || ADMIN.test(d.title) || ADMIN.test(d.quote)) continue;
      const q = new Set(words(d.quote));
      if (!words(d.title).some((w) => q.has(w))) continue;
      // Named as a deadline is: an exam or deadline word Glaze knows (extract() takes it as a row), or work by its number.
      if (!NUMBERED.test(d.title.replace(PLACE, ' ')) && !S.extract(`${d.title}: ${d.when}`, o).dates.length) continue;
      const rows = S.extract(`${d.kind === 'exam' ? 'Exam' : 'Due'}: ${d.when}`, o).dates;
      const inQuote = S.extract(`Due: ${d.quote}`, o).dates;
      const days = inQuote.filter((x) => !x.week).flatMap((x) => [x.day, x.end].filter(Boolean));
      const weeks = inQuote.filter((x) => x.week).map((x) => `${x.week} ${x.wd}`);
      for (const x of rows) {
        if (x.week ? !weeks.includes(`${x.week} ${x.wd}`) : !days.includes(x.day)) continue;
        const title = d.title.slice(0, 200), k = `${x.day}|${d.kind}|${fold(title)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        r.dates.push(ai(undefined, d.quote, { title, day: x.day, ...(x.end && { end: x.end }), kind: d.kind, ...(x.week && { week: x.week, wd: x.wd }), ...(x.dow && { dow: x.dow }) }));
      }
    }
    r.dates = r.dates.map(({ value: _, ...d }) => d);
    if (r.dates.some((d) => d.week)) {
      r.week1 = stated ? { ...own } : aiStart ? ai(aiStart, out.week1.quote, { from: 'text' })
        : iso(opts.week1) ? { value: anchor, conf: 'sure', src: '', from: 'course' } : { value: anchor, conf: 'check', src: '', from: 'term' };
    }
    return r;
  };

  // ---- the merge ----------------------------------------------------------------------------------------------------
  const same = {
    name: (a, b) => { const x = fold(a).replace(/[^\p{L} ]/gu, ''), y = fold(b).replace(/[^\p{L} ]/gu, ''); return x.includes(y) || y.includes(x); },
    email: (a, b) => fold(a) === fold(b),
    office: (a, b) => fold(a).includes(fold(b)) || fold(b).includes(fold(a)),
    note: (a, b) => fold(a).includes(fold(b)) || fold(b).includes(fold(a)),
    scale: (a, b) => a.length === b.length && a.every(([l, v], i) => b[i][0] === l && Math.abs(b[i][1] - v) <= 0.5),
    weights: (a, b) => { const rows = (ws) => JSON.stringify(ws.map((w) => [fold(w.name), w.weight]).sort()); return rows(a) === rows(b); },
  };
  // One field: extract()'s when it has a value (to check when AI read another), else AI's.
  const pick = (h, a, eq) => {
    if (h?.value && (!Array.isArray(h.value) || h.value.length)) return a?.value && !eq(h.value, a.value) && h.conf === 'sure' ? { ...h, conf: 'check' } : h;
    return a?.value ? a : h;
  };
  // A time's days at its hours, taken: by either list (an office hour AI calls a class is still taken).
  const units = (list) => list.flatMap((m) => m.days.map((d) => `${d} ${m.start}`));
  const merge = (heur, add) => {
    if (!add) return heur;
    const taken = new Set([...units(heur.hours), ...units(heur.meetings)]);
    const times = (g) => [...heur[g], ...add[g].filter((m) => !units([m]).some((u) => taken.has(u)))];
    const days = new Set(heur.dates.map((d) => d.day));
    const dates = [...heur.dates, ...add.dates.filter((d) => !days.has(d.day))].slice(0, 100);
    const weekly = dates.some((d) => d.ai && d.week);
    return {
      ...heur,
      prof: Object.fromEntries(['name', 'email', 'office', 'note'].map((k) => [k, pick(heur.prof[k], add.prof[k], same[k])])),
      hours: times('hours'), meetings: times('meetings'), dates,
      scale: pick(heur.scale, add.scale, same.scale),
      weights: pick(heur.weights, add.weights, same.weights),
      week1: heur.week1?.value || !weekly ? heur.week1 : add.week1,
    };
  };
  return { interpret, merge, DAY };
})();
if (typeof module !== 'undefined') module.exports = GZ_SYLLABUS_AI; else GZ_SYLLABUS_AI;
