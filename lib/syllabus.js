// Syllabus import (W15): the facts a student wants from a syllabus, read out of its plain text on the device. The
// text comes from lib/doctext.js (DOCX, PPTX, HTML, Canvas's own Syllabus page) or is pasted; a PDF text layer or an
// on-device model can later feed extract() the same way, or fill in what it left empty: every field says how sure it
// is (conf 'sure' or 'check') and which line it came from (src), and features/syllabus.js shows all of it for review
// before anything is kept. Heuristics only: labelled layouts in English, German, Spanish,
// French, Dutch and Portuguese. Dates are worked out here, by code, in the course's term year.
// Classic script; the page gets it on demand (lib/background.js LOADABLE), the worker and node take it whole.
var GZ_SYLLABUS = globalThis.GZ_SYLLABUS || (() => {
  const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const DAY = 86400000;

  // One kind of dash, space and line break; a label alone on its line joined to its value ("Instructor:" / "Dr. Okafor"),
  // and a range wrapped at its dash ("10-" / "11am") mended.
  const norm = (s) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[ \f\v]+/g, ' ').replace(/^(\p{L}[\p{L} ]{2,30}):[ \t]*\n+(?![A-F][+-]?[ \t]*:?[ \t]*\n)/gmu, '$1: ')
    .replace(/(\d)[ \t]*-[ \t]*\n[ \t]*(?=\d)/g, '$1-');
  // An icon a PDF puts before a label (● ✉ ▦ ▶ ▪, or an icon font's private character) is a bullet.
  const clean = (s) => String(s).replace(/\t+/g, ' · ').replace(/\s+/g, ' ').replace(/(?: ·)+ /g, ' · ').replace(/^[\s,:;.\-·|•*–\p{So}\p{Co}]+|[\s,:;\-·|•*–]+$/gu, '');
  const at = (lines, i) => clean(lines[i] || '').slice(0, 300);
  const any = (words) => new RegExp(`(?<![\\p{L}])(?:${words})(?![\\p{L}])`, 'iu');

  // ---- days and times -----------------------------------------------------------------------------------------
  // Class and office-hour times come from W14's reader (lib/classes.js meetings, loaded before this file in a page).
  // Here only weekday names, to tidy a date's title ("Wednesday, October 14") and to tell a name from a day.
  const CL = () => globalThis.GZ_CLASSES || require('./classes.js');
  const DAY_WORDS = [
    'mondays?|mon|mo|montags?|lunes|lundi|lun|maandag|ma|segunda(?:-feira)?|seg',
    'tuesdays?|tues|tue|dienstags?|di|martes|mardi|mar|dinsdag|terça(?:-feira)?|terca|ter',
    'wednesdays?|wed|mittwochs?|mi|miércoles|miercoles|mié|mie|mercredi|mer|woensdag|wo|quarta(?:-feira)?|qua',
    'thursdays?|thurs|thur|thu|donnerstags?|do|jueves|jue|jeudi|jeu|donderdag|quinta(?:-feira)?|qui',
    'fridays?|fri|freitags?|fr|viernes|vie|vendredi|ven|vrijdag|vr|sexta(?:-feira)?|sex',
    'saturdays?|sat|samstags?|sa|sábado|sabado|sáb|sab|samedi|sam|zaterdag|za',
    'sundays?|sun|sonntags?|so|domingo|dom|dimanche|dim|zondag|zo',
  ];
  const ONE_DAY = DAY_WORDS.map((w) => new RegExp(`^(?:${w})\\.?$`, 'iu'));
  const W = `(?:${DAY_WORDS.join('|')})\\.?`;
  const ordered = (list) => DAYS.filter((d) => list.includes(d));
  const hhmm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  // A clock time or range in a date's line ("8:00-10:00 AM", "11:59 pm", "10 Uhr"), only to take it out of the title.
  const CLOCK = /(?<![\d:.])\d{1,2}(?:[:.h]\d\d)?\s*(?:[ap]\.?\s?m\.?|uhr|uur|h)?\s*(?:-|to|bis|à)\s*\d{1,2}(?:[:.h]\d\d)?\s*(?:[ap]\.?\s?m\.?|uhr|uur|h)?(?![\d%])|(?<![\d:])\d{1,2}(?::\d\d)?\s*(?:[ap]\.?\s?m\.?|uhr|uur|h)(?![\p{L}])/giu;

  // ---- dates ------------------------------------------------------------------------------------------------------
  const MONTHS = [
    'january|jan|januar|jänner|enero|ene|janvier|janv|januari|janeiro',
    'february|feb|februar|febrero|février|fevrier|févr|fevr|februari|fevereiro|fev',
    'march|mar|märz|maerz|mär|marzo|mars|maart|mrt|março|marco',
    'april|apr|abril|abr|avril|avr',
    'may|mai|mayo|mei|maio',
    'june|jun|juni|junio|juin|junho',
    'july|jul|juli|julio|juillet|juil|julho',
    'august|aug|agosto|août|aout|augustus',
    'september|sept|sep|septiembre|setiembre|septembre|setembro',
    'october|oct|oktober|okt|octubre|octobre|outubro',
    'november|nov|noviembre|novembre|novembro',
    'december|dec|dezember|dez|diciembre|dic|décembre|decembre|déc|dezembro',
  ];
  const MON = `(${MONTHS.join('|')})\\.?`;
  const monthOf = (w) => MONTHS.findIndex((m) => new RegExp(`^(?:${m})$`, 'iu').test(w.replace(/\.$/, '')));
  const DATE_RES = [
    // "Oct 12", "October 12th, 2026"
    [new RegExp(`(?<![\\p{L}])${MON}(?![\\p{L}])\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d|[:.]\\d)(?:,?\\s+(\\d{4}))?`, 'giu'), (m) => ({ mo: monthOf(m[1]), d: +m[2], y: m[3], named: true })],
    // "12 October", "12. Oktober", "12 de octubre de 2026", "le 12 oct."
    [new RegExp(`(?<![\\d.])(\\d{1,2})(?:\\.|º|°|er|st|nd|rd|th)?\\s*(?:de\\s+)?${MON}(?![\\p{L}])(?:\\s+(?:de\\s+)?(\\d{4}))?`, 'giu'), (m) => ({ mo: monthOf(m[2]), d: +m[1], y: m[3], named: true })],
    // "2026-10-12"
    [/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) => ({ y: m[1], mo: +m[2] - 1, d: +m[3], named: true })],
    // "12.10." or "12.10.2026" (day first), not a section's number that goes on ("3.3.1.", "4.1.10.")
    [/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?![\d.]))?(?!\d)/g, (m) => ({ d: +m[1], mo: +m[2] - 1, y: m[3] })],
    // "10/12" or "10/12/26": month first where the page's language writes it so (US English), else day first
    [/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/%])(?!\s*(?:of|der|des|de|van|do|da)\b)/g, (m, o) => ({ ...(o.md ? { mo: +m[1] - 1, d: +m[2] } : { d: +m[1], mo: +m[2] - 1 }), y: m[3], amb: +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2] })],
  ];
  // A day in the course's term: an explicit year as written, else the year that puts it no earlier than 45 days before
  // the term starts (a spring term's January after a December syllabus date, say). With no term start known (known
  // false), today stands in for it and the year is the one that puts the day nearest today, as lib/classes.js reads a
  // class date: in October a September date is this year's, and a January one next year's.
  const dayOf = ({ y, mo, d }, { start, known }) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    const key = (year) => { const t = new Date(Date.UTC(year, mo, d)); return t.getUTCMonth() === mo ? t.toISOString().slice(0, 10) : null; };
    if (y) return key(y.length === 2 ? 2000 + +y : +y);
    const here = new Date(start).getUTCFullYear();
    if (known) return key(here + (Date.UTC(here, mo, d) < start - 45 * DAY ? 1 : 0));
    return [here, here - 1, here + 1].map(key).filter(Boolean).sort((a, b) => Math.abs(Date.parse(a) - start) - Math.abs(Date.parse(b) - start))[0] || null;
  };
  // A year-less day more than 45 days before today, with no term start to place it by, may as well be a year on: not a
  // sure one.
  const stale = (day, { start, known }) => !known && Date.parse(day) < start - 45 * DAY;
  const datesIn = (line, o) => {
    const found = [];
    for (const [re, read] of DATE_RES) {
      for (const m of line.matchAll(re)) {
        if (found.some((f) => m.index < f.at + f.len && f.at < m.index + m[0].length)) continue;
        const r = read(m, o);
        let at = m.index, len = m[0].length, end = null;
        // A range of days in one month: "December 15-17, 2026" (month first) or "15–17 décembre" (day first).
        if (r.named && re === DATE_RES[0][0]) {
          const x = /^\s*-\s*(\d{1,2})(?![\d:]|\.\d)(?:,?\s+(\d{4}))?/.exec(line.slice(at + len));
          if (x && +x[1] > r.d) { end = +x[1]; r.y ||= x[2]; len += x[0].length; }
        } else if (r.named && re === DATE_RES[1][0]) {
          const x = /(\d{1,2})\.?\s*-\s*$/.exec(line.slice(0, at));
          if (x && +x[1] < r.d) { end = r.d; r.d = +x[1]; len += at - x.index; at = x.index; }
        }
        if (found.some((f) => at < f.at + f.len && f.at < at + len)) continue;
        const day = dayOf(r, o);
        // Sure only of a named month or a year, and never of a range, of a numeric date that reads either way round, or
        // of a past day whose year is only a guess.
        if (day) found.push({ day, end: end && dayOf({ ...r, d: end }, o), at, len, sure: !!(r.named || r.y) && !end && !r.amb && !(!r.y && stale(day, o)) });
      }
    }
    return found.sort((a, b) => a.at - b.at);
  };
  const EXAM = 'exams?|midterms?|mid-term|final exams?|finals|(?<=^\\s*)final(?=\\s*[:\\t-])|quiz(?:zes)?|tests?|practicals?|klausur(?:en)?|prüfung(?:en)?|examen|parcial(?:es)?|prueba|partiel|contrôle|controle|tentamen|toets|prova|exame|avaliação';
  const DUE = 'due|deadline|projects?|papers?|essays?|reports?|presentations?|assignments?|homework|portfolio|abgabe|fällig|referat|hausarbeit|projekt|präsentation|entrega|proyecto|ensayo|presentación|trabajo|rendu|remise|à rendre|projet|devoir|exposé|dossier|inleveren|verslag|opdracht|presentatie|projeto|apresentação|relatório|seminário';
  const EXAM_RE = any(EXAM), DUE_RE = any(DUE);
  // A line that is only a short label ("Homework 3", "Video" / "Assignments"): a table's or a chart's cell.
  const LBL = /^[ \t]*\p{L}[\p{L}\p{M}\d &/'’()-]{0,39}:?[ \t]*$/u;
  // A table of contents' line (dot leaders and a page number) is no date, nor is a numbered section's heading: "4.2." at a
  // line's start where "4." starts a line too, and so does "4.1." or "4.3.". German "Klausur am 4.2.", or a schedule's
  // row "11.11.\tAbgabe", is still the day it says.
  const TOC = /(?<![._…][ \t]?)(?:(?:\.[ \t]?){4,}|…{2,}|_{4,})[ \t]*\d{1,4}[ \t]*$/;
  const SECTION = /^\s*(\d{1,2})\.(?:(\d{1,2})(?:\.\d{1,2})*\.?)?[ \t]+\p{L}/u;
  // A row's title, the dates and weekdays already out of it: without its times ("8:00-10:00 AM", "at 11:59 pm"), else
  // the word that made it a row.
  const titled = (title, raw) => {
    title = title.replace(CLOCK, ' ')
      .replace(/(?<![\p{L}])(?:at|by|um|à|às|om)\s*(?=[,;]|$)/giu, ' ').replace(/\(\s*\)/g, ' ').replace(/\s*([,:;])(?:\s*[,:;])+/g, '$1');
    title = clean(title).slice(0, 200) || clean((EXAM_RE.exec(raw) || DUE_RE.exec(raw))[0]);
    return title[0].toUpperCase() + title.slice(1);
  };
  // skip: the lines weekRows placed. Each row keeps its line (i), for extract to put both kinds in the text's order.
  const dateRows = (lines, o, skip) => {
    const out = [], heads = new Set(), subs = new Set(), deep = new Set();
    for (const l of lines) {
      const m = SECTION.exec(l);
      if (m) (m[2] ? subs : heads).add(m[2] ? `${+m[1]}.${+m[2]}` : +m[1]);
      if (m?.[2] && /^\s*\d{1,2}\.\d{1,2}\.\d/.test(l)) deep.add(`${+m[1]}.${+m[2]}`); // "4.1.10." makes "4.1." a section
    }
    let dateTable = false;
    lines.forEach((raw, i) => {
      if (!raw.includes('\t')) dateTable = false;
      else if (/^\s*(?:date|datum|fecha|data)[ \t]*\t/iu.test(raw)) dateTable = true;
      const kind = EXAM_RE.test(raw) ? 'exam' : DUE_RE.test(raw) ? 'due' : '';
      if (!kind || TOC.test(raw) || skip.has(i)) return; // a schedule's every lecture topic is noise
      const sec = SECTION.exec(raw);
      const numbered = !dateTable && sec?.[2] && (deep.has(`${+sec[1]}.${+sec[2]}`) || (heads.has(+sec[1]) && (subs.has(`${+sec[1]}.${+sec[2] - 1}`) || subs.has(`${+sec[1]}.${+sec[2] + 1}`))));
      const found = datesIn(raw, o).filter((f) => !(numbered && f.at === raw.search(/\d/)));
      if (!found.length) return;
      // The title: the line without its dates and the weekday right before each.
      let title = raw;
      for (const f of [...found].reverse()) {
        const before = title.slice(0, f.at).replace(new RegExp(`(?<![\\p{L}])${W}\\s*,?\\s*$`, 'iu'), '').replace(/(?<![\p{L}])(?:on|the|le|am|el|op|em|no|na|du|vom|del)\s*$/iu, '');
        title = before + ' ' + title.slice(f.at + f.len);
      }
      title = titled(title, raw);
      for (const f of found) if (!out.some((x) => x.day === f.day && x.title === title)) out.push({ title, day: f.day, ...(f.end && { end: f.end }), kind, conf: f.sure ? 'sure' : 'check', src: at(lines, i), i });
    });
    return out;
  };

  // ---- deadlines by course week -----------------------------------------------------------------------------------
  // Deadlines given by course week, not by date: "7th day of week 3" (a table's date cell, its rows' items above it),
  // "Quiz 4 (end of week 4)", "Week 5 – Friday: Lab report due", "Due Sunday of week 2", or a schedule's "Week 3" with
  // "Essay 1 due Friday" under it. They are days from week 1's first day, the anchor: a start the text states ("Week 1
  // (Aug. 24–28)", "Our course runs from November 2", "Classes begin Monday, August 24"), else the course's own start
  // (opts.week1, from the LMS), else the term's (opts.start); with none of them, no such rows. Week 1 starts on the
  // anchor's own day, whatever weekday that is: a course that starts on a Wednesday has Wednesday-to-Tuesday weeks, and
  // "Monday of week 2" is the Monday after its second Wednesday (no turning weeks into Monday-to-Sunday ones). Each such
  // row keeps { week, wd } (wd: days after its week's first day), so the review can move them all when the student
  // corrects week 1 (weekDay). A week the schedule dates itself ("Week 3 (Sept 14–18)") places its own deadlines, a
  // plain dated row; so does a calendar week ("Freitag, KW 45": the year's, Monday first). All of them are to check.
  const FULL_DAYS = [
    'monday|montag|lunes|lundi|maandag|segunda-feira',
    'tuesday|dienstag|martes|mardi|dinsdag|terça-feira|terca-feira',
    'wednesday|mittwoch|miércoles|miercoles|mercredi|woensdag|quarta-feira',
    'thursday|donnerstag|jueves|jeudi|donderdag|quinta-feira',
    'friday|freitag|viernes|vendredi|vrijdag|sexta-feira',
    'saturday|samstag|sábado|sabado|samedi|zaterdag',
    'sunday|sonntag|domingo|dimanche|zondag',
  ];
  const FD = `(${FULL_DAYS.join('|')})`, FD_RE = new RegExp(`(?<![\\p{L}])${FD}(?![\\p{L}])`, 'iu');
  const dayIdx = (w) => FULL_DAYS.findIndex((d) => new RegExp(`^(?:${d})$`, 'iu').test(w));
  const WK = '(?:week|wk\\.?|woche|semana|semaine)\\s*#?\\s*(\\d{1,2})(?![\\d\\p{L}])', NB = '(?<![\\p{L}\\d])';
  const NO_EVENT = new RegExp(`${NB}(?:no(?:\\s+hay)?|kein(?:e[nmrs]?)?|pas\\s+de|geen|sem|não\\s+há|sin)\\s+(?:${EXAM}|${DUE})(?![\\p{L}])`, 'iu');
  const WEEK_REFS = [
    // "7th day of week 3", "day 7 of week 3": a table's date cell
    [new RegExp(`${NB}(?:([1-7])(?:st|nd|rd|th|\\.)?\\s+day|day\\s+([1-7]))\\s+(?:\\([^)\\n]{0,12}\\)\\s+)?of\\s+(?:the\\s+)?${WK}`, 'iu'), (m) => ({ week: +m[3], wd: +(m[1] || m[2]) - 1, cell: true })],
    [new RegExp(`${NB}(?:end of(?: the)?|ende der|fin de(?: la)?|eind van(?: de)?|final da|fim da)\\s+${WK}`, 'iu'), (m) => ({ week: +m[1], wd: 6, cell: true })],
    // "Friday of week 2", "Freitag der Woche 2", "viernes de la semana 2", "vrijdag van week 2", "sexta-feira da semana 2"
    [new RegExp(`${NB}${FD}\\s*,?\\s*(?:(?:of(?: the)?|in(?: der)?|der|de(?: la)?|van|da|do|na)\\s+)?${WK}`, 'iu'), (m) => ({ week: +m[2], day: dayIdx(m[1]) })],
    // "Week 3 Friday", "Week 5 – Friday:", "week 6, vrijdag"
    [new RegExp(`${NB}${WK}\\s*[,:-]?\\s*${FD}`, 'iu'), (m) => ({ week: +m[1], day: dayIdx(m[2]) })],
  ];
  const KW_RE = new RegExp(`${NB}(?:${FD}\\s*,?\\s*(?:(?:der|in der)\\s+)?)?(?:KW|Kalenderwoche)\\s*(\\d{1,2})(?!\\d)(?:\\s*[/,]?\\s*(\\d{4})(?!\\d))?(?:\\s*[,:-]?\\s*${FD})?`, 'iu');
  // A line a week starts: "Week 3", "Woche 3", "Semana 3 (14-18 sept.)", after a bullet or an icon.
  const HEADER = new RegExp(`^[\\s\\p{So}\\p{Co}•*·-]*${WK}`, 'iu');
  // A start the text states: a word for it, right after it (a weekday at most between) the date. A plain "starts" or
  // "runs" only after a word for the course on its line ("Our course runs from…"), not "the project starts…".
  const COURSE_RE = any('course|class(?:es)?|term|semester|session|lectures?|kurs(?:e|es)?|vorlesung(?:en)?|lehrveranstaltung|seminar|curso|clases|semestre|cours|colleges?|aulas');
  const START_RE = new RegExp(`${NB}(?:(vorlesungsbeginn|kursbeginn|semesterbeginn|start date|first day of (?:class(?:es)?|the course|the term|the semester)|début des cours|inicio de (?:las )?clases|início das aulas|start van de colleges)|runs|begins?|starts?|commences?|beginnt|startet|comienzan?|empiezan?|commencent|commence|débutent|débute|begint|beginnen|começam?|iniciam?)(?![\\p{L}])[\\s:,]*(?:(?:on|from|el|le|am|op|em|no|ab|vom|desde|the)\\s+)?(?:${FD}\\s*,?\\s*)?`, 'giu');
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const monday = (ms) => (new Date(ms).getUTCDay() + 6) % 7; // 0 Monday … 6 Sunday
  // The day of a week's wd-th day after week 1's first day (YYYY-MM-DD); '' for anything else. A row that names its
  // weekday (dow, 'MO'…'SU': "Friday of week 2") is that weekday's first day from its week's first day on, so it stays a
  // Friday when the student moves week 1 to another weekday; "7th day of week 3" has none and moves with week 1.
  const weekDay = (week1, week, wd, dow) => {
    if (!okDay(week1) || !Number.isInteger(week) || week < 1 || week > 60 || !Number.isInteger(wd) || wd < 0 || wd > 6) return '';
    const first = Date.parse(`${week1}T00:00:00Z`) + (week - 1) * 7 * DAY;
    if (dow === undefined) return iso(first + wd * DAY);
    const k = DAYS.indexOf(dow);
    return k < 0 ? '' : iso(first + ((k - monday(first) + 7) % 7) * DAY);
  };
  const weekRows = (lines, o, week1) => {
    // A course start supplies the year of a year-less text anchor too, including when no term was supplied.
    if (Number.isFinite(week1)) o = { ...o, start: week1, known: true };
    const kindOf = (l) => (EXAM_RE.test(l) ? 'exam' : DUE_RE.test(l) ? 'due' : '');
    const own = (raw, hm) => hm && datesIn(raw, o).find((f) => /^[\s(:,·\t-]*$/.test(raw.slice(hm[0].length, f.at)));
    let anchor = null;
    for (let i = 0; i < lines.length && !anchor; i++) {
      if (TOC.test(lines[i])) continue;
      const hm = HEADER.exec(lines[i]), f = hm && +hm[1] === 1 && own(lines[i], hm);
      if (f) anchor = { day: f.day, from: 'text', conf: f.sure ? 'sure' : 'check', src: at(lines, i) };
    }
    for (let i = 0; i < lines.length && !anchor; i++) {
      if (TOC.test(lines[i])) continue;
      for (const m of lines[i].matchAll(START_RE)) {
        if (!m[1] || /^start date$/i.test(m[1])) {
          const before = lines[i].slice(0, m.index), course = COURSE_RE.exec(before);
          if (!course || before.slice(course.index + course[0].length).trim()) continue;
        }
        const f = datesIn(lines[i], o).find((d) => d.at === m.index + m[0].length);
        if (f) { anchor = { day: f.day, from: 'text', conf: f.sure ? 'sure' : 'check', src: at(lines, i) }; break; }
      }
    }
    if (!anchor && Number.isFinite(week1)) anchor = { day: iso(week1), from: 'course', conf: 'sure', src: '' };
    if (!anchor && o.known) anchor = { day: iso(o.start), from: 'term', conf: 'check', src: '' };
    const rows = [], taken = new Set();
    let ctx = null, weekly = '';
    // → { day } from a week's own dates or a calendar week, { day, week, wd } from the anchor, or null.
    const place = (ref) => {
      if (ref.kw != null) {
        if ((!anchor && !ref.year) || ref.kw < 1 || ref.kw > 53) return null;
        const first = (year) => { const j4 = Date.UTC(year, 0, 4); return j4 - monday(j4) * DAY; };
        const kw = (year) => first(year) + ((ref.kw - 1) * 7 + ref.day) * DAY;
        let y = ref.year || +anchor.day.slice(0, 4);
        if (!ref.year) {
          const earliest = Date.parse(anchor.day) - 45 * DAY;
          // Early January can still belong to the preceding ISO year; late December can belong to the next one.
          if (kw(y - 1) >= earliest) y--;
          else if (kw(y) < earliest) y++;
        }
        const ms = kw(y);
        return ms < first(y + 1) ? { day: iso(ms) } : null; // week 53 exists in only some ISO years
      }
      if (ref.start) {
        const s0 = Date.parse(ref.start), day = iso(s0 + (ref.wd ?? (ref.day - monday(s0) + 7) % 7) * DAY);
        return ref.end && day > ref.end ? null : { day };
      }
      if (!anchor) return null;
      const wd = ref.wd ?? (ref.day - monday(Date.parse(anchor.day)) + 7) % 7, day = weekDay(anchor.day, ref.week, wd);
      return day ? { day, week: ref.week, wd, ...(ref.wd == null && { dow: DAYS[ref.day] }) } : null;
    };
    const put = (title, kind, p, src, i) => {
      if (!rows.some((x) => x.day === p.day && x.title === title)) rows.push({ title, day: p.day, kind, conf: 'check', src, ...(p.week && { week: p.week, wd: p.wd }), ...(p.dow && { dow: p.dow }), i });
      weekly ||= src;
      taken.add(i);
    };
    lines.forEach((raw, i) => {
      if (TOC.test(raw)) { ctx = null; return; }
      const hm = HEADER.exec(raw), hf = own(raw, hm);
      if (hm) ctx = { week: +hm[1], start: hf?.day, end: hf?.end, i };
      else if (ctx && (!raw.trim() || i - ctx.i > 12 || (!kindOf(raw) && /:\s*$/.test(raw)))) ctx = null;
      if (NO_EVENT.test(raw)) { taken.add(i); return; }
      // Several weekdays or week references cannot be assigned to individual items by this line reader.
      const days = [...raw.matchAll(new RegExp(FD_RE.source, 'giu'))];
      if (days.length > 1 || [...raw.matchAll(new RegExp(`${NB}${WK}`, 'giu'))].length > 1) {
        if (hm && hf) taken.add(i); // the dated week's start is not an alternative deadline
        return;
      }
      let ref = null, span = null;
      for (const [re, read] of WEEK_REFS) { const m = re.exec(raw); if (m) { ref = read(m); span = [m.index, m.index + m[0].length]; break; } }
      const kw = !ref && KW_RE.exec(raw);
      if (kw) {
        if (/^\s*[/,(]?\s*\d/.test(raw.slice(kw.index + kw[0].length))) return;
        if (kw[1] || kw[4]) { ref = { kw: +kw[2], year: +kw[3] || null, day: dayIdx(kw[1] || kw[4]) }; span = [kw.index, kw.index + kw[0].length]; }
      }
      if (!ref && ctx) {
        const from = hm ? (hf ? hf.at + hf.len : hm[0].length) : 0, m = FD_RE.exec(raw.slice(from));
        if (m) { ref = { week: ctx.week, day: dayIdx(m[1]) }; span = [from + m.index, from + m.index + m[0].length]; }
      }
      if (!ref || datesIn(raw, o).some((f) => f.at !== hf?.at)) return; // a date of its own: dateRows' row
      if (ctx?.start && ref.week === ctx.week) { ref.start = ctx.start; ref.end = ctx.end; }
      const p = place(ref);
      if (!p) { if (hm && hf) taken.add(i); return; }
      const kind = kindOf(raw);
      if (kind) {
        // The title: the line without the week's reference, its heading and own dates, and a "on" or "by" before them.
        let t = raw;
        const head = hm && [0, hf ? hf.at + hf.len : hm[0].length];
        for (const [a, z] of (head && head[1] > span[0] ? [[0, Math.max(head[1], span[1])]] : [span, head].filter(Boolean)).sort((x, y) => y[0] - x[0])) {
          t = t.slice(0, a).replace(/(?<![\p{L}])(?:on|by|the|until|before|le|am|el|op|em|no|na|du|vom|del|bis)\s*$/iu, '') + ' ' + t.slice(z);
        }
        if (hm && hf) t = t.replace(/^\s*\)\s*[:,-]?/, '');
        const cells = t.split('\t').filter(kindOf);
        put(titled(cells.length && t.includes('\t') ? cells.join(' · ') : t, raw), kind, p, at(lines, i), i);
      } else if (ref.cell && !/\p{L}{2}/u.test(raw.slice(0, span[0]) + raw.slice(span[1]))) {
        // A date cell alone: the items of its row, the lines above it back to a blank line or the row before.
        const items = [];
        for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
          if (!lines[j].trim() || HEADER.test(lines[j]) || WEEK_REFS.some(([re]) => re.test(lines[j]))) break;
          if (kindOf(lines[j]) && LBL.test(lines[j])) items.unshift(j);
        }
        for (const j of items) put(titled(lines[j], lines[j]), kindOf(lines[j]), p, `${at(lines, j)} · ${at(lines, i)}`, i);
      }
    });
    const week1Field = { ...field(weekly && anchor ? anchor.day : '', anchor?.conf, anchor?.src || weekly), from: weekly && anchor ? anchor.from : '' };
    return { rows, taken, week1: week1Field };
  };

  // ---- meetings (class times and office hours) --------------------------------------------------------------------
  // The shape W14's schedule parser shares: { label, days, start, end, location }, plus conf and src here.
  const CLASS_RE = any('lectures?|class(?:es)?|meets?|meetings?|meeting times?|sections?|labs?|laborator(?:y|ies)|discussion|recitation|seminars?|tutorials?|vorlesung(?:en)?|übung(?:en)?|praktikum|unterricht|clases?|horario|cours|td|tp|séances?|hoorcollege|werkcollege|college|practicum|aulas?|horário');
  const HOURS_RE = any('office hours?|student hours|drop-in hours|sprechstunden?|sprechzeiten?|horarios? de (?:atención|tutorías|oficina)|horas de (?:oficina|atención)|tutorías|heures? de (?:bureau|permanence|réception)|permanences?|spreekuur|spreekuren|horários? de atendimento|atendimento');
  // A line's meetings, from W14's reader (days Sunday-first there, Glaze's MO…SU here), with the line's label before the
  // first and each one's place after it.
  const meetingsIn = (line, prev, lang) => {
    const found = CL().meetings(line, { lang });
    const label = found.length ? clean(line.slice(0, found[0].at)) || (/:\s*$/.test(prev) ? clean(prev) : '') : '';
    return found.map((m, i) => {
      const tail = line.slice(m.to, found[i + 1]?.at ?? line.length).replace(/^\s*(?:uhr|uur|h)(?![\p{L}])/iu, '');
      // A title at the place's end lost its name to the next line ("via Teams - Prof." / "Moreno's room"): cut with it.
      const location = clean(clean(tail.split(/;|\.(?!\d)|\bor\b|\band\b|\boder\b|\bou\b|\bo\b|\bof\b/)[0]).replace(/^(?:in|at|im|en|à|au|em|no|na|op|via)\s+/i, '').replace(CUT_TITLE, ''));
      return { label: label.replace(/[:]\s*$/, '').slice(0, 80), days: ordered(m.days.map((d) => DAYS[(d + 6) % 7])), start: hhmm(m.start), end: hhmm(m.end), location: location.slice(0, 80), unsure: m.unsure.length > 0, at: m.at };
    });
  };
  const CUT_TITLE = /[\s,·-]*(?<![\p{L}])(?:prof(?:essor|essora|esseur)?|dr|dra|mr|mrs|ms|herr|frau|sr|sra|mme|dhr|mevr)\.?$/iu;
  // Lines with days and a time, skipping one-off events (a line with a date). Office hours: a line with their label, and
  // the lines right after it that start with a day and a time.
  const scan = (lines, lang) => {
    const out = [];
    let block = 0;
    lines.forEach((line, i) => {
      const hoursHere = HOURS_RE.test(line);
      const found = meetingsIn(line, lines[i - 1] || '', lang);
      block = hoursHere ? 4 : block && found[0]?.at <= 2 ? block - 1 : 0;
      const inBlock = hoursHere || block > 0;
      if (datesIn(line, { start: 0, known: true }).some((d) => d.sure)) return; // only whether a date is named: any year will do
      for (const { unsure, at: _, ...row } of found) {
        const sure = inBlock || CLASS_RE.test(line) || CLASS_RE.test(lines[i - 1] || '');
        out.push({ ...row, hours: inBlock, conf: sure && !unsure ? 'sure' : 'check', src: at(lines, i) });
      }
    });
    return out.slice(0, 40);
  };

  // ---- the professor ----------------------------------------------------------------------------------------------
  const PROF = 'instructors?|course instructor|professors?|professora|lecturers?|teachers?|faculty|taught by|dozent(?:in|en)?|lehrende[rnm]?|lehrkraft|lehrperson|profesor(?:a|es)?|docentes?|enseignant(?:e|es)?|professeure?s?|chargée? de cours|intervenante?|docent(?:e|en)?|hoogleraar|instructeur|leraar|professor(?:a|es)?';
  const HON = "(?:(?:prof(?:essor|essora|esseur|\\.)?|dr|dra|doctor|mr|mrs|ms|mx|miss|herr|frau|sr|sra|srta|m|mme|mlle|dhr|mevr|mw)\\.?\\s+)*";
  const NAME = "(\\p{Lu}[\\p{L}'’-]*\\.?(?:\\s+(?:(?:van|von|de|da|del|der|den|di|dos|das|du|la|le|ter|ten|zu)\\s+)*\\p{Lu}[\\p{L}'’-]*\\.?){0,4})";
  // Labels match in any case; a name starts with a capital, so it is matched apart.
  const PROF_LINE = new RegExp(`^[\\s•*-]*(?:${PROF})[^:\\t\\n]{0,24}?[:\\t]\\s*(.*)$`, 'iu');
  const HON_RE = new RegExp(`^${HON}`, 'iu');
  const NAME_RE = new RegExp(`^${NAME}`, 'u');
  const PROF_ANY = new RegExp(`(?<![\\p{L}])((?:Prof(?:essor|essora|esseur|\\.)|Dr\\.?|Dra\\.)\\s+)${NAME}`, 'u');
  // → { name, words } or null: a name has a word of two letters or more and isn't a weekday.
  const nameOf = (hon, name) => {
    const words = name.replace(/\.$/, '').split(/\s+/);
    if (!words.some((w) => w.replace(/\W/g, '').length >= 2) || words.every((w) => ONE_DAY.some((r) => r.test(w)))) return null;
    return { name: `${hon.replace(/\s+/g, ' ')}${words.join(' ')}`.trim().slice(0, 100), words: words.length };
  };
  const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  // Someone else on the course staff, whose contact details follow their own name.
  const OTHER_ROLE = any("TAs?|teaching assistants?|teaching fellows?|tutors?|graders?|course assistants?|lab instructors?|co-instructors?|tutor(?:in|en)?|hilfskr(?:a|ä)fte?|wissenschaftliche[rn]? mitarbeiter(?:in)?|ayudantes?|asistentes?|monitor(?:a|es)?|chargée? de td|assistante?s?|student-assistent(?:en)?|werkcollegedocent|assistente");
  const field = (value, conf, src) => ({ value: value || '', conf: value ? conf : '', src: value ? src : '' });
  const professor = (lines, lang) => {
    let name = field(), at0 = -1;
    for (let i = 0; i < lines.length && !name.value; i++) {
      const rest = !HOURS_RE.test(lines[i]) && PROF_LINE.exec(lines[i])?.[1];
      if (!rest) continue;
      const hon = HON_RE.exec(rest)[0];
      const m = NAME_RE.exec(rest.slice(hon.length));
      const v = m && nameOf(hon, m[1]);
      if (v) { name = field(v.name, v.words > 1 ? 'sure' : 'check', at(lines, i)); at0 = i; }
    }
    // Unlabelled: "Dr." or "Prof." before a name of two words or more, anywhere.
    for (let i = 0; i < lines.length && !name.value; i++) {
      const m = PROF_ANY.exec(lines[i]);
      const v = m && nameOf(m[1], m[2]);
      if (v && v.words > 1) { name = field(v.name, 'check', at(lines, i)); at0 = i; }
    }
    // The e-mail: one labelled as the professor's ("Instructor email:"), else on the professor's own line or the lines
    // right after it, up to where another person's part starts (a TA, a tutor); else any labelled one, else the first,
    // both only guesses.
    let email = field();
    const PROF_MAIL = new RegExp(`(?:${PROF})[^:\\n]{0,20}(?:e-?mail|correo|courriel|mail)`, 'iu');
    for (let i = 0; i < lines.length && !email.value; i++) if (PROF_MAIL.test(lines[i]) && EMAIL.test(lines[i])) email = field(EMAIL.exec(lines[i])[0], 'sure', at(lines, i));
    for (let i = Math.max(0, at0); at0 >= 0 && i < at0 + 5 && !email.value; i++) {
      if (i > at0 && (OTHER_ROLE.test(lines[i]) || PROF_LINE.test(lines[i]))) break;
      const m = EMAIL.exec(lines[i] || '');
      if (m) email = field(m[0], 'sure', at(lines, i));
    }
    for (let i = 0; i < lines.length && !email.value; i++) if (/^\s*(?:e-?mail|correo|courriel|mail)/i.test(lines[i]) && EMAIL.test(lines[i])) email = field(EMAIL.exec(lines[i])[0], 'check', at(lines, i));
    for (let i = 0; i < lines.length && !email.value; i++) if (EMAIL.test(lines[i])) email = field(EMAIL.exec(lines[i])[0], 'check', at(lines, i));
    let office = field();
    const OFFICE = /^[\s•*-]*(?:office(?:\s+(?:location|room))?|büro|raum|sprechzimmer|despacho|oficina|bureau|kantoor|kamer|gabinete)\s*[:\t]\s*(.+)$/iu;
    for (let i = 0; i < lines.length && !office.value; i++) {
      const m = OFFICE.exec(lines[i]);
      if (m && !HOURS_RE.test(lines[i])) office = field(clean(m[1].split(EMAIL)[0]).slice(0, 120), 'sure', at(lines, i));
    }
    // Office hours with no time to read ("By appointment"): kept as words, from a line their label starts, after a bullet
    // or an icon and a word or two ("▪ Virtual office hours:"), never from a heading that lists them ("Name, office hours,
    // and e-mail address:") or a sentence that mentions them ("attend office hours regularly and…").
    let note = field();
    for (let i = 0; i < lines.length && !note.value; i++) {
      const m = HOURS_RE.exec(lines[i]);
      if (!m) continue;
      const before = lines[i].slice(0, m.index).replace(/^[\s\p{So}\p{Co}•*·-]+/u, ''), after = lines[i].slice(m.index + m[0].length);
      if (before && !(/^(?:[\p{L}'’-]+\s+){1,2}$/u.test(before) && /^\s*(?:[:\t-]|$)/.test(after))) continue;
      if (!CL().meetings(lines[i], { lang }).length) note = field(clean(after.replace(/^\s*[:\t-]/, '')).slice(0, 200), 'check', at(lines, i));
    }
    return { name, email, office, note };
  };

  // ---- grading scale ----------------------------------------------------------------------------------------------
  const LETTER = '([A-E][+-]?|F)';
  const NUM = '(\\d{1,3}(?:[.,]\\d+)?)';
  const ABOVE = 'and above|or above|or higher|and up|or more|\\+|und mehr|und höher|und darüber|o más|y más|o superior|et plus|ou plus|ou mais|ou superior|e acima|en hoger|of hoger|en meer|of meer';
  const BELOW = 'or below|or less|and below|or lower|und weniger|o menos|ou moins|ou menos|of lager|en lager|of minder';
  const FROM = '≥|>=|=>|at least|min(?:imum)?\\.?|mindestens|ab|desde|à partir de|vanaf|a partir de|from|de';
  const UNDER = '<|below|under|less than|unter|weniger als|menos de|por debajo de|moins de|en dessous de|minder dan|onder|abaixo de|inferior a';
  const RANGE = `(?:${NUM}\\s*%?\\s*(?:-|to|bis|a|à|tot|até|hasta)\\s*${NUM}\\s*%?|${NUM}\\s*%?\\s*(?:${ABOVE})|(?:${FROM})\\s*${NUM}\\s*%?|(?:${UNDER})\\s*${NUM}\\s*%?|${NUM}\\s*%?\\s*(?:${BELOW})|${NUM}\\s*%|${NUM}(?!\\d|[.,]\\d|\\s*(?:-|to|%)))`;
  const n = (x) => (x == null ? null : +x.replace(',', '.'));
  // A range as { min, max } (max null when the text gives none), from groups k..k+7 of RANGE's alternatives; null when
  // it's no percentage range. "Below 60" ends just under 60.
  const range = (m, k) => {
    if (m[k] != null) { const a = n(m[k]), b = n(m[k + 1]); return Math.max(a, b) <= 100.5 ? { min: Math.min(a, b), max: Math.max(a, b) } : null; }
    if (m[k + 2] != null) return { min: n(m[k + 2]), max: null };
    if (m[k + 3] != null) return { min: n(m[k + 3]), max: null };
    if (m[k + 4] != null) return { min: 0, max: n(m[k + 4]) - 0.01 };
    if (m[k + 5] != null) return { min: 0, max: n(m[k + 5]) };
    if (m[k + 6] != null) return { min: n(m[k + 6]), max: null };
    // A bare number: a percentage from 10 up (or 0), never grade points (A 4.0, B 3.0).
    const v = n(m[k + 7]);
    return v === 0 || v >= 10 ? { min: v, max: null } : null;
  };
  const SCALE_LABEL = any('grading scale|grade scale|grading|letter grades?|grade distribution|notenskala|notenschlüssel|notenspiegel|bewertungsschema|escala de calificaci[oó]n(?:es)?|calificaciones|barème|bareme|échelle de notation|cijferschaal|beoordelingsschaal|escala de notas|conceitos');
  const scale = (s, lines, starts) => {
    const found = [];
    const pair = new RegExp(`(?:^|[\\s(;,|•])${LETTER}(?![\\p{L}\\d+])[ \\t]*(?:[:=]|\\(|-(?=\\s))?[ \\t]*\\(?[ \\t]*${RANGE}`, 'gmu');
    for (const m of s.matchAll(pair)) {
      const r = range(m, 2);
      if (r && r.min <= 100) found.push({ letter: m[1].toUpperCase(), ...r, at: m.index + m[0].indexOf(m[1]) });
    }
    if (found.length < 3) {
      const rev = new RegExp(`${RANGE}[ \\t]*(?:[:=]|→|->|\\t)?[ \\t]*${LETTER}(?=[\\s;,)]|$)`, 'gmu');
      for (const m of s.matchAll(rev)) {
        const r = range(m, 1);
        if (r && r.min <= 100) found.push({ letter: m[9].toUpperCase(), ...r, at: m.index });
      }
    }
    // A table read column by column: letter-only lines, then as many range-only lines.
    if (found.length < 3) {
      const isL = (l) => new RegExp(`^${LETTER}\\s*:?$`).exec(l.trim());
      const isR = (l) => new RegExp(`^${RANGE}$`, 'iu').exec(l.trim());
      for (let i = 0; i < lines.length;) {
        const ls = [], rs = [];
        while (i < lines.length && isL(lines[i])) ls.push([isL(lines[i++])[1], starts[i - 1]]);
        while (i < lines.length && rs.length < ls.length && isR(lines[i])) rs.push(range(isR(lines[i++]), 1) || { min: 0, max: null });
        if (ls.length && rs.length === ls.length) ls.forEach(([l, a], k) => found.push({ letter: l, ...rs[k], at: a }));
        if (!ls.length && !rs.length) i++;
      }
    }
    // The longest run, in text order (each within 160 characters of the one before), of different letters whose lowest
    // percentages fall. A letter inside the run that breaks the order is counted: the scale is out of order.
    found.sort((a, b) => a.at - b.at);
    let best = [], order = 0;
    for (let i = 0; i < found.length; i++) {
      const run = [found[i]];
      let skipped = 0, kept = 0;
      for (let j = i + 1; j < found.length && j < i + 40 && found[j].at - found[j - 1].at < 160; j++) {
        if (found[j].min < run.at(-1).min && !run.some((r) => r.letter === found[j].letter)) { run.push(found[j]); kept = skipped; } else skipped++;
      }
      if (run.length > best.length) [best, order] = [run, kept];
    }
    if (best.length < 3) return field();
    // What makes the scale a guess: ranges that overlap, leave a gap (more than a point), or letters out of order.
    const issues = order ? [{ kind: 'order' }] : [];
    const show = (e) => `${e.letter} ${e.min}${e.max != null ? `–${Math.round(e.max * 100) / 100}` : ''}`;
    for (let k = 1; k < best.length; k++) {
      const [hi, lo] = [best[k - 1], best[k]];
      if (lo.max == null) continue;
      if (lo.max >= hi.min) issues.push({ kind: 'overlap', a: show(hi), b: show(lo) });
      else if (hi.min - lo.max > 1 + 1e-9) issues.push({ kind: 'gap', a: show(hi), b: show(lo) });
    }
    const [a, b] = [lineAt(starts, best[0].at), lineAt(starts, best.at(-1).at)];
    const near = lines.slice(Math.max(0, a - 6), a + 1).some((l) => SCALE_LABEL.test(l));
    const f = field(best.map(({ letter, min }) => [letter, Math.round(min * 100) / 100]), near && !issues.length ? 'sure' : 'check', clean(lines.slice(a, b + 1).join(' · ')).slice(0, 300));
    return { ...f, ranges: best.map(({ letter, min, max }) => [letter, min, max]), issues };
  };
  const lineAt = (starts, i) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= i) lo = mid; else hi = mid - 1; } return lo; };

  // ---- weights by category ----------------------------------------------------------------------------------------
  // A block of "Homework 20%" (or "20% Homework") next to each other. One that adds up to 100 is the breakdown; one under a
  // grading heading that doesn't is shown whole, marked to check, with what it adds up to. One pass over the text.
  const WEIGHT_LABEL = any('grading|grades?|weights?|weighting|evaluation|assessment|course grade|bewertung|gewichtung|leistungsnachweis|evaluación|ponderación|calificación|évaluation|pondération|notation|beoordeling|weging|toetsing|avaliação|ponderação');
  const TOTAL = /^(?:total|totals|sum|summe|gesamt|insgesamt|suma|totale?|somme|totaal|soma)$/iu;
  // A distinct consecutive numbered series, three or more (Homework 1 … Homework 7), is one category.
  const fold = (b) => {
    const item = (p) => /^(.*?\p{L})(?:\s+#?|\s*#)([1-9]\d?)$/u.exec(p.name);
    const groups = new Map();
    for (const p of b) {
      const m = item(p);
      if (m) { const k = m[1].toLowerCase(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(+m[2]); }
    }
    const series = new Set([...groups].filter(([, ns]) => ns.length >= 3 && ns.every((n, i) => n === i + 1)).map(([k]) => k));
    const out = [];
    for (const p of b) {
      const k = item(p)?.[1], key = series.has(k?.toLowerCase()) ? k.toLowerCase() : null;
      const was = key && out.find((x) => x.key === key);
      if (was) was.weight = Math.round((was.weight + p.weight) * 100) / 100; else out.push({ name: key ? k : p.name, weight: p.weight, key });
    }
    return out.map(({ name, weight }) => ({ name, weight }));
  };
  const weights = (s, lines, starts) => {
    const t = s.replace(/\(\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)/g, ' $1%').replace(/\([^()\n%]{0,120}%[^()\n]{0,120}\)/g, (x) => ' '.repeat(x.length));
    const tidy = (x) => clean(x.replace(/\s*\([^)]*\)?/g, ' ')).replace(/^(?:and|und|y|e|et|en|the|die|der|das|le|la|les|el|los|las|o|os|a|as|de|het)\s+/i, '')
      .replace(/\s*(?:(?:is|are)\s+)?(?:worth|counts?(?:\s+for)?|accounts?\s+for|weighted\s+at|zählt|vale|cuenta|compte pour|telt voor|representa|=)\s*$/i, '')
      .replace(/\s*,\s*/g, ' / ').trim().slice(0, 60); // a row of several ("Homework, Tests 75%") as one name the review screen can save
    const pair = (m, name, w) => ({ name: tidy(name), weight: n(w), at: m.index, end: m.index + m[0].length });
    const ok = (p) => p.name && /\p{L}{2}/u.test(p.name) && p.weight > 0 && p.weight <= 100 && !TOTAL.test(p.name);
    const forward = [...t.matchAll(/(\p{L}[\p{L}\p{M}\d &/'’.,()-]{1,60}?)[ \t]*[:\t=–-]?[ \t]*(\d{1,3}(?:[.,]\d+)?)[ \t]*%/gu)].map((m) => pair(m, m[1], m[2])).filter(ok);
    const backward = [...t.matchAll(/(\d{1,3}(?:[.,]\d+)?)[ \t]*%[ \t]*[:\t–-]?[ \t]*(\p{Lu}[\p{L}\p{M}\d &/'’-]{2,40})/gu)].map((m) => pair(m, m[2], m[1])).filter(ok);
    // Next to each other: at most 40 characters and two line breaks between one and the next; 20 at most a block.
    const blocks = (pairs) => {
      const out = [];
      let cur = [];
      for (const p of pairs) {
        const prev = cur.at(-1);
        const gap = prev && t.slice(prev.end, p.at);
        // A line that starts a labelled section of its own ("Grading scale: A 90%") starts a new block.
        const section = prev && gap.includes('\n') && /^\s*\p{L}[\p{L} ]{2,30}:/u.test(lines[lineAt(starts, p.at)]);
        if (prev && (section || p.at - prev.end > 40 || (gap.match(/\n/g) || []).length > 2 || cur.length >= 20)) { out.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) out.push(cur);
      return out.filter((b) => b.length >= 2).map((b) => ({ b, sum: b.reduce((x, p) => x + p.weight, 0) }));
    };
    // A table or a chart read column by column puts each percent on a line of its own: labels first ("Homework" / "45%",
    // a chart's labels, one wrapped as "Oral audio" / "recordings"), percents first ("10%" / "Participation"), or a
    // table's rows cell by cell ("Homework 1" / "Quiz 1" / "8%" / "6%"). Read as runs of label lines and percent lines, a
    // stretch at a time: a run of k ≥ 2 percents goes with the last k labels before it, in order (any before those are
    // the row's heading, "MODULE 1"); else each percent goes with the labels before it or after it. A run of labels left
    // over at one end only says which; at both ends, the one that reads as a heading (a grading word, capitals, a colon:
    // "Course grade", a chart's title) is the one left over, and where neither or both do, the stretch could be read
    // either way and isn't. Stretches with two other lines at most between them (the row's other cells, "7th day of
    // week 1") are one block.
    const PCT = /^[ \t]*(\d{1,3}(?:[.,]\d+)?)[ \t]*%[ \t]*$/;
    const heading = (ls) => Math.max(...ls.map((k) => WEIGHT_LABEL.test(lines[k]) + (/\p{Lu}{2}/u.test(lines[k]) && lines[k] === lines[k].toUpperCase()) + /:\s*$/.test(lines[k])));
    const read = (runs) => {
      if (!runs.some((r) => r.k === 'P')) return [];
      const line = (k) => lines[k].trim().replace(/:$/, '');
      const mk = (ls, k) => ({ name: tidy(ls.map(line).join(' ')), weight: n(PCT.exec(lines[k])[1]), at: starts[ls[0]], end: starts[k] + lines[k].length });
      const out = [];
      if (runs.some((r) => r.k === 'P' && r.ls.length > 1)) {
        for (const [j, r] of runs.entries()) {
          const ls = r.k === 'P' && (runs[j - 1]?.ls || []);
          if (ls && ls.length < r.ls.length) return [];
          // Only discard identifiable headings, never another category or a wrapped part of one.
          if (ls && ls.slice(0, ls.length - r.ls.length).some((k) => !WEIGHT_LABEL.test(line(k)) &&
            !/^(?:unit|module|modul|einheit|unidad|unité|unidade|blok)\s+\d+$/iu.test(line(k)))) return [];
          if (ls) r.ls.forEach((k, x) => out.push(mk([ls[ls.length - r.ls.length + x]], k)));
        }
        return out;
      }
      const a = runs[0].k === 'L' && runs[0], z = runs.at(-1).k === 'L' && runs.at(-1);
      if ((!a && !z) || runs.some((r) => r.k === 'L' && r !== a && r !== z && r.ls.length > 3)) return [];
      const d = a && z ? heading(z.ls) - heading(a.ls) : a ? 1 : -1;
      if (!d) return [];
      // An end's label is the line next to its percent, and the one beyond when this one goes on in lower case.
      const lower = (k) => k != null && /^\p{Ll}/u.test(line(k));
      const tail = (ls) => ls.slice(lower(ls.at(-1)) && ls.length > 1 ? -2 : -1), head = (ls) => ls.slice(0, lower(ls[1]) ? 2 : 1);
      runs.forEach((r, j) => {
        if (r.k !== 'P') return;
        const L = runs[d > 0 ? j - 1 : j + 1];
        out.push(mk(L === a ? tail(L.ls) : L === z ? head(L.ls) : L.ls, r.ls[0]));
      });
      return out;
    };
    const columns = () => {
      const out = [];
      let cur = [], other = 0;
      const close = () => { if (cur.length >= 2) out.push(cur); cur = []; };
      for (let i = 0; i < lines.length;) {
        const runs = [];
        for (; i < lines.length && (PCT.test(lines[i]) || LBL.test(lines[i])); i++) {
          const k = PCT.test(lines[i]) ? 'P' : 'L';
          if (runs.at(-1)?.k === k) runs.at(-1).ls.push(i); else runs.push({ k, ls: [i] });
        }
        const ps = read(runs).filter(ok);
        if (ps.length) { cur.push(...ps); other = 0; continue; }
        if (!runs.length && !lines[i++].trim()) close();
        else if ((other += runs.reduce((x, r) => x + r.ls.length, 0) || 1) > 2) close();
      }
      close();
      return out.map((b) => ({ b, sum: b.reduce((x, p) => x + p.weight, 0) }));
    };
    const all = [...blocks(forward), ...columns(), ...blocks(backward)];
    const labelled = ({ b }) => { const a = lineAt(starts, b[0].at); return lines.slice(Math.max(0, a - 6), a + 1).some((l) => WEIGHT_LABEL.test(l)); };
    const whole = all.find((x) => Math.abs(x.sum - 100) < 0.6);
    const best = whole || all.find(labelled);
    if (!best) return field();
    const [a, b] = [lineAt(starts, best.b[0].at), lineAt(starts, best.b.at(-1).at)];
    const f = field(fold(best.b), whole && labelled(best) ? 'sure' : 'check', clean(lines.slice(a, b + 1).join(' · ')).slice(0, 300));
    return { ...f, issues: whole ? [] : [{ kind: 'sum', total: Math.round(best.sum * 100) / 100 }] };
  };

  // The same office hours given twice (a contact box, then the instructor's section) are one, with the label and place of
  // the one that gives more; two places at the same time stay two.
  const once = (rows) => {
    const out = [];
    const more = (m) => !!m.label + !!m.location;
    for (const m of rows) {
      const k = out.findIndex((x) => x.days.join() === m.days.join() && x.start === m.start && x.end === m.end && (!x.location || !m.location || x.location === m.location));
      if (k < 0) out.push(m); else if (more(m) > more(out[k])) out[k] = m;
    }
    return out;
  };

  // ---- everything -------------------------------------------------------------------------------------------------
  // text: the syllabus as plain text. opts.start: when the course's term starts (ms), for dates without a year; leave it out
  // when the course has no term dates, and today stands in for it, its dates read by the year nearest today (dayOf);
  // opts.md: numeric dates are month first (US English); opts.hint: the page's language, where the text's own
  // can't be told; opts.week1: the course's own start (ms, UTC midnight, from the LMS), for deadlines by course week.
  // → { prof, hours, meetings, dates, scale, weights, week1, truncated }; week1 { value, conf, src, from: 'text' |
  // 'course' | 'term' } is the day week-based dates count from, '' when there are none (weekRows).
  // At most MAX characters are read (truncated says when there were more), and each line's first 2,000: a syllabus is far
  // shorter, and every step stays one pass over what's read.
  const MAX = 200000;
  const extract = (text, opts = {}) => {
    const all0 = norm(text);
    const s = all0.slice(0, MAX);
    const full = s.split('\n');
    const starts = [];
    for (let i = 0, k = 0; k < full.length; k++) { starts.push(i); i += full[k].length + 1; }
    const lines = full.map((l) => l.slice(0, 2000));
    const known = Number.isFinite(opts.start);
    const o = { start: known ? opts.start : Date.now(), known, md: !!opts.md };
    // The text's language by its day names, else the page's (opts.hint), for W14's day tables.
    const lang = CL().detect(s, opts.hint || 'en');
    const all = scan(lines, lang);
    const wk = weekRows(lines, o, opts.week1);
    return {
      prof: professor(lines, lang),
      hours: once(all.filter((m) => m.hours).map(({ hours, ...m }) => m)),
      meetings: all.filter((m) => !m.hours).map(({ hours, ...m }) => m),
      dates: [...dateRows(lines, o, wk.taken), ...wk.rows].sort((a, b) => a.i - b.i).map(({ i, ...d }) => d).slice(0, 60),
      week1: wk.week1,
      scale: scale(s, lines, starts),
      weights: weights(s, lines, starts),
      truncated: all0.length > MAX,
    };
  };

  // ---- what the review screen writes, and what is kept ------------------------------------------------------------
  // "Homework 20%, Exams 50%" ⇄ [{ name, weight }]; null for text that isn't such a list.
  const parseWeights = (text) => {
    const out = [];
    for (const part of String(text || '').split(/[;\n]+|,(?!\d)/)) {
      if (!part.trim()) continue;
      const m = /^(.*?\p{L}.*?)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%?$/u.exec(part.trim());
      if (!m) return null;
      const w = n(m[2]);
      if (!(w > 0 && w <= 100)) return null;
      out.push({ name: m[1].trim().slice(0, 60), weight: w });
    }
    return out.length <= 20 ? out : null;
  };
  const weightsText = (list) => (list || []).map((w) => `${w.name} ${w.weight}%`).join(', ');

  // Kept per Canvas or Ultra site, user and course, in storage.local through the worker (lib/background.js 'glaze:syllabus').
  const key = (origin, uid, cid) => `syllabus:${origin}/${uid}/${cid}`;
  const KEY = /^syllabus:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d{1,20}|_\d{1,20}_\d{1,20})\/(?:\d{1,20}|_\d{1,20}_\d{1,20})$/i;
  const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  // A date row's id (see ids, below).
  const ROW = /^[a-z\d]{1,10}$/;
  const rowId = (id) => typeof id === 'string' && ROW.test(id);
  const okDay = (d) => {
    const t = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`);
    return !!t && Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d; // "2026-99-99" is dropped, not thrown on
  };
  const row = (m) => {
    const ds = Array.isArray(m?.days) ? ordered(m.days.filter((d) => DAYS.includes(d))) : [];
    if (!ds.length || !TIME.test(m.start) || !TIME.test(m.end) || m.end <= m.start) return null;
    return { label: str(m.label, 80), days: ds, start: m.start, end: m.end, location: str(m.location, 80) };
  };
  // A record from storage, a page or the review screen → what may be kept, or null when nothing is left.
  const tidy = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = raw.prof && typeof raw.prof === 'object' ? raw.prof : {};
    const email = str(p.email, 120);
    const rec = {
      prof: { name: str(p.name, 100), email: EMAIL.test(email) ? email : '', office: str(p.office, 120), note: str(p.note, 200) },
      hours: (Array.isArray(raw.hours) ? raw.hours : []).map(row).filter(Boolean).slice(0, 20),
      meetings: (Array.isArray(raw.meetings) ? raw.meetings : []).map(row).filter(Boolean).slice(0, 20),
      dates: (Array.isArray(raw.dates) ? raw.dates : []).filter((d) => okDay(d?.day) && str(d.title, 200))
        .map((d) => ({ title: str(d.title, 200), day: d.day, kind: ['exam', 'due'].includes(d.kind) ? d.kind : 'other', ...(rowId(d.id) && { id: d.id }) })).slice(0, 100)
        .map((d, i, all) => (d.id && all.findIndex((x) => x.id === d.id) < i ? { title: d.title, day: d.day, kind: d.kind } : d)), // one row's id, once
      scale: (Array.isArray(raw.scale) ? raw.scale : []).filter((x) => Array.isArray(x) && str(x[0], 12) && Number.isFinite(x[1]) && x[1] >= 0 && x[1] <= 100)
        .map(([l, v]) => [str(l, 12), v]).sort((a, b) => b[1] - a[1]).slice(0, 20),
      weights: (Array.isArray(raw.weights) ? raw.weights : []).filter((w) => str(w?.name, 60) && Number.isFinite(w.weight) && w.weight > 0 && w.weight <= 100)
        .map((w) => ({ name: str(w.name, 60), weight: w.weight })).slice(0, 20),
      at: Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0,
    };
    const empty = !Object.values(rec.prof).some(Boolean) && !rec.hours.length && !rec.meetings.length && !rec.dates.length && !rec.scale.length && !rec.weights.length;
    return empty ? null : rec;
  };
  // A save or delete from a page, m { rec (null deletes), at (when it was made) }, on what is stored now → what to store,
  // or null when it's older than that (a newer save, or a delete, which stays as its time: { deleted }). So a slow
  // write from another tab never replaces a newer record, and a save made before a delete can't bring it back.
  const change = (stored, m) => {
    if (!(Number.isFinite(m?.at) && m.at > 0)) return null;
    const was = stored && typeof stored === 'object' ? Math.max(Number(stored.at) || 0, Number(stored.deleted) || 0) : 0;
    if (m.at <= was) return null;
    if (m.rec === null) return { deleted: m.at };
    return tidy({ ...m.rec, at: m.at });
  };
  // ---- dates → To Do tasks -----------------------------------------------------------------------------------------
  // Each date row of a record has an id of its own (rec.dates[i].id), made when the row is first reviewed and kept, so
  // editing a row's day or title is the same row and the same To Do task (syl-<course>-<row id>), and a row taken out can
  // take its task with it. The task's id was a hash of the day and title, which an edit changed: the old task stayed
  // behind, overdue, and a second one was made.
  // The hash of a row's day and title: the id every row had that way before rows had ids, so a record from then lines up
  // with the tasks it made.
  const seed = (d) => {
    let h = 0x811c9dc5;
    for (const c of `${d.day}|${d.title}`) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
    return h.toString(36);
  };
  // dates → the same rows, each with an id: the one it has (if it is good and not another row's), else that of the row of
  // `was` (the record kept) with the same day and title, else its seed, numbered where two rows are alike. Another day or
  // title is another row.
  const ids = (dates, was) => {
    const taken = new Set();
    const rows = dates.map((d) => {
      const good = rowId(d.id) && !taken.has(d.id);
      if (good) taken.add(d.id);
      return { ...d, id: good ? d.id : '' };
    });
    const old = was?.length ? ids(was) : [];
    for (const r of rows) {
      const same = !r.id && old.find((o) => !taken.has(o.id) && o.day === r.day && o.title === r.title);
      if (same) { r.id = same.id; taken.add(same.id); }
    }
    for (const r of rows) {
      if (r.id) continue;
      let id = seed(r);
      for (let n = 1; taken.has(id); n++) id = `${seed(r)}${n}`;
      r.id = id;
      taken.add(id);
    }
    return rows;
  };
  // The id of a row added in the review: not one of taken.
  const newId = (taken) => {
    const used = new Set(taken);
    let id;
    do id = Math.random().toString(36).slice(2, 8) || 'x'; while (used.has(id) || !rowId(id));
    return id;
  };
  // A To Do task's id for a date from a syllabus: its row's. A row from before ids is the one the earlier version made.
  const taskId = (cid, d) => {
    const rid = rowId(d.id) ? d.id : seed(d);
    // Ultra ids can contain two 20-digit numbers; To Do limits the complete task id to 40 characters.
    const course = `syl-${cid}-${rid}`.length <= 40 ? cid : seed({ day: cid, title: '' }) + seed({ day: '', title: cid });
    return `syl-${course}-${rid}`;
  };
  // What saving the record does to To Do, as lib/todo.js edits: was and now are the record's dates before and as saved,
  // picked the ids of the rows ticked "Add to To Do", tasks what To Do holds ({ id, done }…), note the tasks' notes. A
  // ticked row is added, or brought up to date where its task is there already (whether it is done, its notes and its steps
  // stay the student's). A row whose day or title was edited moves its task with it, ticked or not, if it has one. A row that
  // is gone takes its task, unless the student has done it. A task the student moved, of a row left as it was, stays.
  const taskEdits = ({ cid, was, now, picked, tasks, note, at }) => {
    const there = new Map((tasks || []).map((x) => [x?.id, x]));
    const before = new Map(ids(was || []).map((d) => [d.id, d]));
    const rows = ids(now || []);
    const out = [];
    for (const d of rows) {
      const id = taskId(cid, d), prev = before.get(d.id);
      if (picked?.has(d.id) || (prev && (prev.day !== d.day || prev.title !== d.title) && there.has(id))) {
        out.push(['importTask', { id, title: d.title, cid, due: { day: d.day }, notes: note, done: 0, at }]);
      }
    }
    const kept = new Set(rows.map((d) => d.id));
    for (const [rid, d] of before) {
      const id = taskId(cid, d);
      if (!kept.has(rid) && there.has(id) && !there.get(id).done) out.push(['dropTask', id]);
    }
    return out;
  };

  return { DAYS, MAX, norm, extract, weekDay, parseWeights, weightsText, key, KEY, tidy, change, ids, newId, taskId, taskEdits };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_SYLLABUS; else GZ_SYLLABUS;
