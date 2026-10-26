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
          const from = Math.max(0, at - 12), x = /(\d{1,2})\.?\s*(?:-|al|au|bis|a|à|tot|até)\s*$/iu.exec(line.slice(from, at));
          if (x && +x[1] < r.d) { end = r.d; r.d = +x[1]; len += at - from - x.index; at = from + x.index; }
        }
        if (found.some((f) => at < f.at + f.len && f.at < at + len)) continue;
        const day = dayOf(r, o);
        // Sure only of a named month or a year, and never of a range, of a numeric date that reads either way round, or
        // of a past day whose year is only a guess.
        if (day) found.push({ day, end: end && dayOf({ ...r, d: end }, o), at, len, sure: !!(r.named || r.y) && !end && !r.amb && !(!r.y && stale(day, o)) });
      }
    }
    found.sort((a, b) => a.at - b.at);
    // Two days with a dash, "to" or "thru" between them, a weekday at most ("11/01 – 15/01", "Nov. 25–Nov. 27", "Monday,
    // November 2 – Sunday, December 20"), are a range, two months long at most.
    for (let k = found.length - 2; k >= 0; k--) {
      const [f, g] = [found[k], found[k + 1]];
      if (!f.end && !g.end && g.day > f.day && Date.parse(g.day) - Date.parse(f.day) <= 62 * DAY && RANGE_SEP.test(line.slice(f.at + f.len, g.at))) {
        found.splice(k, 2, { day: f.day, end: g.day, at: f.at, len: g.at + g.len - f.at, sure: false, from: f.sure });
      }
    }
    return found;
  };
  const RANGE_SEP = new RegExp(`^\\s*(?:-|to|thru|through|until|till|bis(?: zum)?|al|au|a|à|tot|t/m|até)\\s*(?:${W}\\s*,?\\s*)?$`, 'iu');
  // What makes a line a deadline. An exam word, or a word that says something is due (due, Abgabe, entrega, à remettre),
  // is sure of it; a thing students hand in (paper, Hausarbeit, tarea, "Discussion 2") is only where the line or the
  // table's column is about what is due: not after "no" ("no quiz this week", "no video or discussion assignment"), not
  // before a word that makes it a class or a time ("essay workshop", "exam review", "finals week"), not after an article
  // ("the paper state"). An exam word before a thing handed in is that thing ("Midterm paper" is due).
  const EXAM = 'exams?|midterms?|mid-term|final exams?|finals|(?<=^\\s*)final(?=\\s*[:\\t-])|quiz(?:zes)?|cuestionarios?|questionários?|tests?|practicals?|prelims?|klausur(?:en)?|nachklausur|prüfung(?:en)?|examen|parcial(?:es)?|prueba|partiel|contrôle|controle|tentamen|hertentamen|toets|prova|exame|avaliação';
  const DUE_VERB = 'due|deadline|submit(?:ted)?|turn(?:ed)? in|hand(?:ed)? in|abgabe|fällig|einreichen|einzureichen|entregan?|entregar|entregues?|rendu|remise|à rendre|à remettre|inleveren|prazo';
  const DUE_THING = 'projects?|papers?|essays?|reports?|presentations?|assignments?|homework|portfolio|problem sets?|psets?|worksheets?|referat|hausarbeit|projekt|präsentation|übungsblatt|übungsblätter|proyecto|ensayo|presentación|trabajo|tareas?|projet|devoir|exposé|dossier|verslag|opdracht|presentaties?|projeto|apresentação|relatório|seminário|trabalho|discussion\\s*(?:posts?|boards?|forums?|#?\\s*\\d{1,2})|(?:exercises?|exercices?|ejercicios?|exercícios?|oefening(?:en)?)\\s*#?\\s*\\d{1,2}';
  const DUE = `${DUE_VERB}|${DUE_THING}`;
  const EXAM_RE = any(EXAM), DUE_RE = any(DUE), DUE_VERB_RE = any(DUE_VERB);
  const NOT_AFTER = /^\s+(?:#?\d{1,2}\s+)?(?:workshops?|conferences?|reviews?|periods?|weeks?|schedules?|sessions?|polic(?:y|ies)|guidelines|instructions|rubrics?|formats?|tips|topics?|ideas?|strategies|zeitraum|phase|woche|períodos?|periodos?|semanas?|périodes?|semaines?|periode)(?![\p{L}])/iu;
  const NO_BEFORE = /(?<![\p{L}])(?:no(?:\s+hay)?|kein(?:e[nmrs]?)?|pas\s+de|geen|sem|não\s+há|sin)\s+(?:[\p{L}-]+\s+){0,3}$/iu;
  const ARTICLE = /(?<![\p{L}])(?:the|a|an|this|that)\s+$/iu;
  // An item that counts for nothing ("(no puntúa)", "ungraded", "optional") is no deadline.
  const UNGRADED = any('ungraded|not graded|no grade|optional|practice|no puntúa|sin nota|opcional|freiwillig|unbenotet|zählt nicht|facultatif|non noté|optioneel|telt niet mee|não vale nota|facultativo');
  // A numbered thing ("Blatt 1", "Case Analysis 1", "Discussion #1"), not a part of the course or a place ("Week 1",
  // "Lesson 5", "Ch. 3", "Room 2"): what makes a row's last cell, out of its place, the column of what is due.
  const NUMBERED = /(?<![\p{L}\d])(\p{Lu}[\p{L}]+(?:\s+\p{L}+){0,2}?)\.?\s*#?\s*\d{1,2}(?![\d.:/,]\d|[\p{L}])/gu;
  const PART = any('weeks?|wk|module?s?|modul|units?|lessons?|chapters?|chap|chs?|sections?|parts?|pages?|pp|rooms?|rm|sessions?|days?|class(?:es)?|lectures?|kapitel|woche|lektion|einheit|sitzung|semanas?|unidad(?:es)?|temas?|clases?|capítulos?|cap|aulas?|salas?|grupos?|groups?|semaines?|séances?|chapitres?|leçons?|cours|hoofdstuk|college|les|unidades?|módulos?|lição|bloco|building|hall|grades?|credits?|hours?|ects|points?|pts|figures?|tables?|level|version|ed|edition|vol|no|nr');
  const named = (s) => [...s.matchAll(NUMBERED)].some((m) => !PART.test(m[1].split(/\s+/)[0]));
  const MARKS = [[any(EXAM), 'exam', 2], [any(DUE_VERB), 'due', 2], [any(DUE_THING), 'due', 1]];
  // → [{ at, end, kind, strong }] in the line's order.
  const marksIn = (s) => {
    const out = [];
    for (const [re, kind, strong] of MARKS) {
      for (const m of s.matchAll(new RegExp(re.source, 'giu'))) {
        const end = m.index + m[0].length, before = s.slice(0, m.index);
        if (NOT_AFTER.test(s.slice(end, end + 40)) || NO_BEFORE.test(before.slice(-60)) || (strong < 2 && ARTICLE.test(before.slice(-8)))) continue;
        const own = kind === 'exam' && new RegExp(`^\\s+(?:${DUE_THING})(?![\\p{L}])`, 'iu').test(s.slice(end, end + 30)) ? 'due' : kind;
        out.push({ at: m.index, end, kind: own, strong: own === kind ? strong : 1 });
      }
    }
    return out.sort((a, b) => a.at - b.at || b.end - a.end).filter((x, k, a) => !a.slice(0, k).some((y) => x.at < y.end));
  };
  // A line that is only a short label ("Homework 3", "Video" / "Assignments"): a table's or a chart's cell.
  const LBL = /^[ \t]*\p{L}[\p{L}\p{M}\d &/'’()-]{0,39}:?[ \t]*$/u;
  // A table of contents' line (dot leaders and a page number) is no date, nor is a numbered section's heading: "4.2." at a
  // line's start where "4." starts a line too, and so does "4.1." or "4.3.", or "4.1.10." under it. German "Klausur am
  // 4.2.", or a schedule's row "11.11.\tAbgabe", is still the day it says.
  const TOC = /(?<![._…][ \t]?)(?:(?:\.[ \t]?){4,}|…{2,}|_{4,})[ \t]*\d{1,4}[ \t]*$/;
  const SECTION = /^\s*(\d{1,2})\.(?:(\d{1,2})(?:\.\d{1,2})*\.?)?[ \t]+\p{L}/u;
  // A row's title, the dates and weekdays already out of it: without its times ("8:00-10:00 AM", "at 11:59 pm"), else
  // the word that made it a row.
  const titled = (title, raw) => {
    title = title.replace(/(?<![\d:.])\d{1,2}\s?h\s?\d\d(?![\d:])/g, ' ').replace(CLOCK, ' ').replace(/(?<![\d:.])\d{1,2}:\d\d(?![\d:])/g, ' ').replace(/(?:(?<![\p{L}])(?:at|by|on|the|until|before|of|um|am|bis|vom|der|à|às|le|du|de|del|el|la|op|om|em|no|na)\s*|\s*\()+$/iu, '')
      .replace(/(?<![\p{L}])(?:at|by|um|à|às|om)\s*(?=[,;]|$)/giu, ' ').replace(/\(\s*(?:[,;:]\s*)*\)/g, ' ').replace(/\s*([,:;])(?:\s*[,:;])+/g, '$1');
    title = clean(title).replace(/\s+\.$/, '').slice(0, 200) || clean((EXAM_RE.exec(raw) || DUE_RE.exec(raw) || [raw])[0]).slice(0, 200);
    return title && title[0].toUpperCase() + title.slice(1);
  };

  // ---- lines a cell or a sentence wrapped -------------------------------------------------------------------------
  // A PDF's text breaks a table's cells and long sentences across lines: "Lab report (Titration) due" / "in lab Thu
  // 10/1", "EXAM 1 (Thu" / "10/1, 7:00 pm)", "viernes 2 de" / "octubre", one cell a line ("Fri" / "Sep 4" / "Units,
  // vectors\tProblem Set 1" / "due"). Deadlines are read with them mended: a line goes on into the next when it leaves a
  // parenthesis open, ends on a word that needs more ("due by", "de la", "Thu", "Jan.", a comma), or the next starts in
  // lower case and this one ends no sentence (when both have a time, only if it goes on with "by", "à remettre"…); a
  // week's line ("Week 7") only after "of", "de la", "der"; a table's header or a line that has its time never. A line that is only a date (a weekday, a row number before it) takes the next lines
  // of its row, up to one with a time of its own. Six lines at most. → [{ t, i }]: each mended line and the index of its first line.
  const GOES_ON = new RegExp(`(?:[,(]|(?<![\\p{L}])(?:on|by|of|the|due|until|before|at|in|and|or|from|for|der|am|bis|vom|zum|von|und|de|del|la|el|y|hasta|en|le|du|des|au|à|et|van|het|op|tot|da|do|até|em|${W}|${MON}))\\s*$`, 'iu');
  const SPLIT_END = new RegExp(`(?<![\\p{L}])(?:${W}|${MON})\\s*$`, 'iu');
  const THEN = /^\s*(?:by|until|before|due|à remettre|à rendre|bis|hasta|até|tot|jusqu)(?![\p{L}])/iu;
  const OF_END = /(?<![\p{L}])(?:of|of the|de la|de|der|van|da|do|du|na)\s*$/iu;
  const BARE_DAY = new RegExp(`^[\\s\\d.()|·-]*${W}[\\s.,]*$`, 'iu');
  const mend = (lines, o) => {
    const open = (s) => (s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length;
    const timed = (s) => datesIn(s, o).length || WEEK_REFS.some(([re]) => re.test(s)); // a line with its time ends there
    const bare = (s) => {
      const f = datesIn(s, o);
      for (const x of [...f].reverse()) s = s.slice(0, x.at) + ' ' + s.slice(x.at + x.len);
      return f.length && !/\p{L}{2}/u.test(s.replace(new RegExp(`(?<![\\p{L}])(?:${W}|${WK})(?![\\p{L}])`, 'giu'), ''));
    };
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      let t = lines[i], n = 1;
      const wrapped = (next) => next.trim() && !TOC.test(next) && !SECTION.test(next) && !/^\s*\d{1,3}\s*\t/.test(next) && (
        (HEADER.test(next) ? OF_END.test(t) : (open(t) && !(timed(t) && timed(next) && !THEN.test(next) && !SPLIT_END.test(t))) || (GOES_ON.test(t) && !/[\p{L}-]{6,}\.\s*$/u.test(t) && !timed(t) && !next.includes('\t')) || (/^\s*\p{Ll}/u.test(next) && !/(?<!(?:[ap]\.\s?m|(?<![\p{L}])\p{L}))[.!?;:]\s*$/u.test(t) && !(timed(t) && timed(next) && !THEN.test(next)))) || BARE_DAY.test(t));
      if (t.includes('\t') && tableOf(t.split('\t').map((c) => c.trim()))) { out.push({ t, i }); continue; } // a table's header
      // A date alone on its line takes its row's other cells after it.
      const row = (next) => next.trim() && !BARE_DAY.test(next) && !HEADER.test(next) && !TOC.test(next) && !SECTION.test(next) && !timed(next) && !/^\s*\d{1,3}\s*\t/.test(next);
      for (let rec = false; n < 6 && i + n < lines.length && t.length < 1500; n++) {
        const next = lines[i + n];
        rec ||= !TOC.test(t) && !HEADER.test(t) && bare(t);
        if (!wrapped(next) && !(rec && row(next))) break;
        t = `${t.replace(/\s+$/, '')} ${next.trim()}`;
      }
      out.push({ t, i });
      i += n - 1;
    }
    return out;
  };

  // ---- schedule tables ----------------------------------------------------------------------------------------------
  // A table whose header names a date or week column, and maybe the column of what is due ("Assignment Due", "Abgabe",
  // "Actividad evaluable", "Lectures et remises"; not "Reading Due"). In its rows a thing handed in counts only in that
  // column, so a topic ("Research essay workshop", "Apresentação da disciplina") is no deadline; an exam word or a "due"
  // counts anywhere. A due column's own date is the deadline ("Released\tDue"). A row is read by its cells' places when it
  // starts with its date or number; a row a PDF or a picture's text broke up, from its end: its last cell is what is due
  // when the header ends with that column. A blank line or a numbered section ends the table.
  const DATE_COL = any('dates?|datum|termine?|fechas?|datas?|jour|dag|dia|days?|tag|wk|weeks?|woche|semanas?|semaines?|released');
  const ACT_COL = any('due|deliverables?|assignments?|assessments?|work|activit(?:y|ies)|actividad(?:es)?|atividades?|evaluaci[oó]n(?:es)?|evaluations?|évaluations?|avaliaç(?:ão|ões)|remises?|abgabe|aufgaben?|leistungen?|opdracht(?:en)?|deadlines?|tasks?|tarefas?|tareas?|entregas?|homework|exams?|tests?|prüfung(?:en)?|übungsblatt');
  const READ_COL = any('readings?|lektüre|literatur|lecturas?|leituras?|literatuur');
  const DUE_COL = any('due|abgabe|deadlines?|entregas?|remises?|inleveren|fällig|prazo');
  const tableOf = (cells) => {
    if (cells.length < 2 || cells.some((c) => c.length > 40 || /\d/.test(c.replace(/^#$/, '')))) return null;
    const date = cells.map((c) => DATE_COL.test(c) || dayIdx(c.trim()) >= 0);
    if (!date.some(Boolean)) return null;
    const act = cells.map((c) => { const w = ACT_COL.exec(c) || DUE_RE.exec(c) || EXAM_RE.exec(c); return !!w && !(READ_COL.test(c) && /^due$/i.test(w[0])); });
    return { n: cells.length, act, due: cells.map((c, k) => act[k] && DUE_COL.test(c)), thing: cells.map((c) => DUE_RE.test(c) || EXAM_RE.test(c)) };
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
  const WEEK_REFS = [
    // "7th day of week 3", "day 7 of week 3": a table's date cell
    [new RegExp(`${NB}(?:([1-7])(?:st|nd|rd|th|\\.)?\\s+day|day\\s+([1-7]))\\s+(?:\\([^)\\n]{0,12}\\)\\s+)?of\\s+(?:the\\s+)?${WK}`, 'iu'), (m) => ({ week: +m[3], wd: +(m[1] || m[2]) - 1, cell: true })],
    [new RegExp(`${NB}(?:end of(?: the)?|ende der|fin de(?: la)?|eind van(?: de)?|final da|fim da)\\s+${WK}`, 'iu'), (m) => ({ week: +m[1], wd: 6, cell: true })],
    // "Friday of week 2", "Freitag der Woche 2", "viernes de la semana 2", "vrijdag van week 2", "sexta-feira da semana 2"
    [new RegExp(`${NB}${FD}\\s*,?\\s*(?:(?:of(?: the)?|in(?: der)?|der|de(?: la)?|van|da|do|na)\\s+)?${WK}`, 'iu'), (m) => ({ week: +m[2], day: dayIdx(m[1]) })],
    // "Week 3 Friday,", "Week 5 – Friday:", "week 6, vrijdag 17.00", not "Week 2: Monday quiz, Friday project"
    [new RegExp(`${NB}${WK}\\s*[,:-]?\\s*${FD}(?=\\s*(?:[:,;)]|\\d|$))`, 'iu'), (m) => ({ week: +m[1], day: dayIdx(m[2]) })],
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
  // ---- deadlines --------------------------------------------------------------------------------------------------
  // Each mended line's deadlines: its times (dates, a range of days, "week of Nov. 16", a course or calendar week, a
  // weekday) and what is due or examined. Each time goes with what comes before it ("Exam 1 – Oct 1", "Quiz 2; Essay 1
  // — due by the 7th day of Week 2", "initial post Thursday of Week 1, replies Sunday of Week 1"); a time "and" another
  // goes with the same ("Midterms: Oct 12 and Nov 16"), "or" another leaves the line empty. A row's own date (its date
  // cell, a date or a week at the line's start, a week heading's dates) is for what has no time of its own ("Sept. 17\tPeer
  // review\tEssay 1 rough draft", "Week 1 (Nov 2–8)\t…\tQuiz 1"). A range of days stands for its last day ("Nov. 2-8",
  // "Exam 2 available Oct 5 thru Oct 7", "opens Dec 16 and must be completed by Dec 19", "week of Nov. 16"), unless the
  // item names a weekday in it; a window keeps how it was written in the title ("Final exam · December 15-17"). Several
  // things on one line are a row each ("Homework 2; Quiz 2" are due, and a quiz). All but a sure date are to check.
  // A weekly rule: a due or closing word, then the weekday every week ("due Mondays", "close every Sunday", "jeweils
  // freitags", "todos los viernes", "chaque vendredi", "tous les vendredis", "elke vrijdag", "todas as sextas-feiras").
  const WEEKLY = new RegExp(`(?:${DUE_VERB}|closes?|closed|cierran|ferment|sluiten|fecham|schließen)[^.;\\n]{0,30}?(?:(?:every|each|jeden|jede|cada|todos los|chaque|tous les|elke|iedere|toda|todas as)\\s+${FD}s?|(?<![\\p{L}])((?:mon|tues|wednes|thurs|fri|satur|sun)days)|(?<![\\p{L}])(?:jeweils\\s+)?((?:mon|diens|mittwoch|donners|frei|sams|sonn)tags|mittwochs))(?![\\p{L}])`, 'iu');
  const WEEKLY_DE = ['mon', 'die', 'mit', 'don', 'fre', 'sam', 'son'];
  const END_RE = any('classes end|last day of classes|course ends|term ends|semester ends|vorlesungsende|vorlesungsschluss|fin del periodo lectivo|fin de (?:las )?clases|fin des cours|einde van de colleges|término das aulas|fim das aulas|course dates');
  const BREAK_RE = any('holidays?|break|recess|no class(?:es)?|no school|no lectures?|labou?r day|thanksgiving|memorial day|reading week|feiertage?|ferien|vorlesungsfrei|keine vorlesung|festivos?|vacaciones|sin clases|no hay clases|congés?|férié|relâche|semaine de lecture|vakantie|geen college|feriados?|recesso|não haverá aula|sem aulas?');
  const EXAMPLE = /(?<![\p{L}])(?:for example|for instance|e\.\s?g\.|example:|z\.\s?B\.|zum Beispiel|beispielsweise|por ejemplo|p\.\s?ej\.|par exemple|p\.\s?ex\.|bijvoorbeeld|bv\.|por exemplo)/iu;
  const OPEN = /(?<![\p{L}])(?:opens?|available|from|between|starting|ab|vom|desde|del|à partir du|du|vanaf|van|a partir de|disponible|beschikbaar|disponível)\s*(?:on\s+)?$/iu;
  const CLOSE = /(?<![\p{L}])(?:until|till|by|through|thru|to|closes?|due|bis|hasta|jusqu'au|au|tot|até)(?![\p{L}])/iu;
  const WEEK_OF = /(?<![\p{L}])(?:the\s+)?(?:week of|semana del?|semaine du|woche vom|week van)\s*$/iu;
  const DAY_BEFORE = new RegExp(`(?<![\\p{L}])${W}\\s*,?\\s*$`, 'iu');
  const DAY_SPAN_END = new RegExp(`(?:${W}|${FD})\\s*(?:-|to|through|thru|bis|a|à|au|al|tot|até)\\s*$`, 'iu');
  const SHORT_DAY = /(?<![\p{L}])(?:Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun|MON|TUES?|WED|THU|FRI|SAT|SUN)\.?(?![\p{L}])/gu; // English's
  const DAY_SPAN = new RegExp(`^\\s*(?:-|to|through|thru|bis|a|à|au|al|tot|t/m|até)\\s*(?:${W}|${FD})`, 'iu');
  const ALT = /^[\s,]*(?:or|oder|o|ou|of)\s*$/iu, AND = /^[\s,;&/+]*(?:(?:and|und|y|e|et|en|&)[\s,]*)?$/iu;
  const deadlines = (lines, o, week1) => {
    // A course start supplies the year of a year-less text anchor too, including when no term was supplied.
    if (Number.isFinite(week1)) o = { ...o, start: week1, known: true };
    const kindOf = (l) => (EXAM_RE.test(l) ? 'exam' : DUE_RE.test(l) ? 'due' : '');
    const own = (raw, hm) => hm && datesIn(raw, o).find((f) => /^[\s(:,·\t-]*$/.test(raw.slice(hm[0].length, f.at)));
    lines = mend(lines, o);
    const text = (k) => clean(lines[k]?.t || '').slice(0, 300);
    let anchor = null;
    for (let i = 0; i < lines.length && !anchor; i++) {
      const l = lines[i].t;
      if (TOC.test(l)) continue;
      const hm = HEADER.exec(l), f = hm && +hm[1] === 1 && own(l, hm);
      // The course's own start within the text's week 1 is week 1's first day.
      if (f) anchor = Number.isFinite(week1) && iso(week1) >= f.day && iso(week1) <= (f.end || f.day) ? { day: iso(week1), from: 'course', conf: 'sure', src: text(i) } : { day: f.day, from: 'text', conf: f.sure ? 'sure' : 'check', src: text(i) };
    }
    for (let i = 0; i < lines.length && !anchor; i++) {
      const l = lines[i].t;
      if (TOC.test(l)) continue;
      for (const m of l.matchAll(START_RE)) {
        if (!m[1] || /^start date$/i.test(m[1])) {
          const before = l.slice(0, m.index), course = COURSE_RE.exec(before);
          if (!course || before.slice(course.index + course[0].length).trim()) continue;
        }
        const f = datesIn(l, o).find((d) => d.at === m.index + m[0].length);
        if (f) { anchor = { day: f.day, from: 'text', conf: f.from ?? f.sure ? 'sure' : 'check', src: text(i) }; break; }
      }
    }
    if (!anchor && Number.isFinite(week1)) anchor = { day: iso(week1), from: 'course', conf: 'sure', src: '' };
    if (!anchor && o.known) anchor = { day: iso(o.start), from: 'term', conf: 'check', src: '' };
    // → { day } from a week's own dates or a calendar week, { day, week, wd, dow? } from the anchor, or null.
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
    // The line's times, in its order: { at, end, type: 'date' | 'range' | 'week' | 'day', … }.
    const timesIn = (raw, numbered) => {
      const out = [];
      const ds = datesIn(raw, o).filter((f) => !(numbered && f.at === raw.search(/\d/)));
      // What stands right before a position (a weekday, "opens", "week of"): the 40 characters before it, as its index.
      const before = (re, k) => { const a = Math.max(0, k - 40), m = re.exec(raw.slice(a, k)); return m && Object.assign(m, { index: m.index + a }); };
      for (let k = 0; k < ds.length; k++) {
        const f = ds[k], g = ds[k + 1];
        let at = f.at;
        const wd = before(DAY_BEFORE, at);
        if (wd) at = wd.index;
        const between = g && raw.slice(f.at + f.len, g.at);
        // "Oct 5 thru Oct 7", "11/01 – 15/01"; "opens Wednesday, December 16 and must be completed by Saturday, December 19".
        const window = g && !f.end && !g.end && g.day > f.day && Date.parse(g.day) - Date.parse(f.day) <= 62 * DAY &&
          (RANGE_SEP.test(between) || (before(OPEN, at) && between.length < 60 && CLOSE.test(between) && !marksIn(between).length));
        const open = before(OPEN, at);
        if (window) {
          out.push({ at: open?.index ?? at, end: g.at + g.len, type: 'range', start: f.day, last: g.day, label: open ? raw.slice(open.index, f.at + f.len).trim() : raw.slice(f.at, g.at + g.len) });
          k++;
          continue;
        }
        const of = before(WEEK_OF, at);
        if (of) out.push({ at: of.index, end: f.at + f.len, type: 'range', start: f.day, last: iso(Date.parse(f.day) + 6 * DAY), label: raw.slice(of.index, f.at + f.len).replace(/^the\s+/i, '') });
        else if (f.end) out.push({ at: open?.index ?? at, end: f.at + f.len, type: 'range', start: f.day, last: f.end, label: raw.slice(open?.index ?? f.at, f.at + f.len).trim() });
        else out.push({ at, end: f.at + f.len, type: 'date', day: f.day, sure: f.sure });
      }
      const free = (a, z) => !out.some((r) => a < r.end && r.at < z);
      for (const [re, read] of WEEK_REFS) {
        for (const m of raw.matchAll(new RegExp(re.source, 'giu'))) if (free(m.index, m.index + m[0].length)) out.push({ at: m.index, end: m.index + m[0].length, type: 'week', ref: read(m) });
      }
      for (const m of raw.matchAll(new RegExp(KW_RE.source, 'giu'))) {
        if (!free(m.index, m.index + m[0].length) || !(m[1] || m[4]) || /^\s*[/,(]?\s*\d/.test(raw.slice(m.index + m[0].length))) continue;
        out.push({ at: m.index, end: m.index + m[0].length, type: 'week', ref: { kw: +m[2], year: +m[3] || null, day: dayIdx(m[1] || m[4]) } });
      }
      // A weekday on its own, not one of a span of days ("Thu–Sat", "Monday through Friday").
      for (const m of [...raw.matchAll(new RegExp(FD_RE.source, 'giu')), ...(o.lang === 'en' ? raw.matchAll(SHORT_DAY) : [])]) {
        const end = m.index + m[0].length;
        if (!free(m.index, end) || DAY_SPAN.test(raw.slice(end, end + 16)) || before(DAY_SPAN_END, m.index)) continue;
        const day = Math.max(dayIdx(m[0]), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(m[0].slice(0, 3).toLowerCase()));
        if (day >= 0) out.push({ at: m.index, end, type: 'day', day });
      }
      return out.sort((a, b) => a.at - b.at);
    };
    // A time as { day, conf, week?, wd?, dow?, label? }, or null; def: the row's own date, for a weekday in its range.
    const when = (r, def, ctx) => {
      if (r.type === 'date') return { day: r.day, conf: r.sure ? 'sure' : 'check' };
      if (r.type === 'range') return { day: r.last, conf: 'check', label: r.label };
      if (r.type === 'week') {
        const ref = { ...r.ref };
        if (ctx?.start && ref.week === ctx.week) { ref.start = ctx.start; ref.end = ctx.end; }
        const p = place(ref);
        return p && { ...p, conf: 'check', weekly: true };
      }
      const span = def?.type === 'range' ? [def.start, def.last] : ctx?.start ? [ctx.start, ctx.end] : null;
      if (span) {
        const s0 = Date.parse(span[0]), day = iso(s0 + ((r.day - monday(s0) + 7) % 7) * DAY);
        return !span[1] || day <= span[1] ? { day, conf: 'check', weekly: def?.type !== 'range' } : null;
      }
      if (def?.type === 'week' && def.ref.week) { const p = place({ week: def.ref.week, day: r.day }); return p && { ...p, conf: 'check', weekly: true }; }
      if (!ctx) return null;
      const p = place({ week: ctx.week, day: r.day });
      return p && { ...p, conf: 'check', weekly: true };
    };
    // A stretch's things: split at ";" and "·" (sharing a time after them), and at a cell or a capitalised one after a
    // number or a parenthesis ("Quiz 1 (Chapters 1–2) Case Analysis 1 due"), where only the last takes the time.
    const parts = (raw, a, z, ms) => {
      const cuts = [{ at: a, alone: false }];
      for (let k = a, depth = 0; k < z; k++) {
        const c = raw[k];
        depth = Math.max(0, depth + (c === '(') - (c === ')'));
        if (depth) continue;
        if (c === ';' || c === '·' || c === '\t') cuts.push({ at: k + 1, alone: c === '\t' });
        else if (/[)\d]/.test(c)) {
          const m = /^\s+(?=\p{Lu})/u.exec(raw.slice(k + 1, z));
          if (m && !DUE_VERB_RE.test(raw.slice(k + 1 + m[0].length).split(/\s/)[0])) cuts.push({ at: k + 1 + m[0].length, alone: true });
        }
      }
      return cuts.map((c, k) => ({ ...c, end: cuts[k + 1]?.at ?? z })).map((p) => ({ ...p, ms: ms.filter((m) => m.at >= p.at && m.at < p.end) }))
        .filter((p) => p.ms.length).map((p) => ({ ...p, kind: p.ms.some((m) => m.kind === 'exam') ? 'exam' : 'due' }));
    };
    const rows = [], seen = new Set(), kinds = new Set();
    let ctx = null, weekly = '', table = null;
    const put = (title, kind, w, src, i) => {
      if (!w || !title || seen.has(`${w.day}|${title}`)) return;
      seen.add(`${w.day}|${title}`);
      kinds.add(`${w.day}|${kind}`);
      rows.push({ title: w.label ? `${title} · ${w.label}` : title, day: w.day, kind, conf: w.conf, src, ...(w.week && { week: w.week, wd: w.wd }), ...(w.dow && { dow: w.dow }), i });
      if (w.weekly) weekly ||= src;
    };
    const heads = new Set(), subs = new Set(), deep = new Set();
    for (const { t } of lines) {
      const m = SECTION.exec(t);
      if (m) (m[2] ? subs : heads).add(m[2] ? `${+m[1]}.${+m[2]}` : +m[1]);
      if (m?.[2] && /^\s*\d{1,2}\.\d{1,2}\.\d/.test(t)) deep.add(`${+m[1]}.${+m[2]}`); // "4.1.10." makes "4.1." a section
    }
    // A worked example ("For example, if a paper is due Friday, March 6…") is none of this course's deadlines.
    const elsewhere = (raw) => EXAMPLE.test(raw);
    lines.forEach(({ t: raw, i: line }, i) => {
      if (TOC.test(raw)) { ctx = null; return; }
      if (!raw.trim() || (SECTION.test(raw) && !raw.includes('\t'))) table = null;
      const cells = raw.includes('\t') && raw.split('\t');
      const head = cells && tableOf(cells.map((c) => c.trim()));
      if (head) { table = head; return; }
      const hm = HEADER.exec(raw), hf = own(raw, hm);
      if (hm) ctx = { week: +hm[1], start: hf?.day, end: hf?.end, i };
      else if (ctx && (!raw.trim() || i - ctx.i > 12 || (!kindOf(raw) && /:\s*$/.test(raw)))) ctx = null;
      const src = clean(raw).slice(0, 300);
      const sec = !table && SECTION.exec(raw);
      const numbered = sec?.[2] && (deep.has(`${+sec[1]}.${+sec[2]}`) || (heads.has(+sec[1]) && (subs.has(`${+sec[1]}.${+sec[2] - 1}`) || subs.has(`${+sec[1]}.${+sec[2] + 1}`))));
      const times = timesIn(raw, numbered);
      if (!times.length || elsewhere(raw)) return;
      // Where the things due are, and the row's own time: a table row's cells, else the line.
      let zone = [0, raw.length], ms, def = null, loose = () => false;
      if (table && cells) {
        const cs = [];
        for (let k = 0, p = 0; k < cells.length; p += cells[k++].length + 1) cs.push({ at: p, end: p + cells[k].length, k });
        const lead = /^\s*(?:#?\d{1,3}\.?(?:\s*\([^)]{0,12}\))?)?\s*$/u.test(cells[0]) || datesIn(cells[0], o).length || HEADER.test(cells[0]);
        let act = (lead || cs.length >= table.n ? cs.filter((c) => table.act[Math.min(c.k, table.n - 1)]) : []).map((c) => ({ ...c, due: table.due[Math.min(c.k, table.n - 1)] }));
        const last = cs.at(-1), strong = (c) => marksIn(raw.slice(c.at, c.end)).some((m) => m.strong > 1) || named(raw.slice(c.at, c.end));
        if (!act.length && cs.length > 1 && table.act[table.n - 1] && (!lead || strong(last))) act = [{ ...last, due: table.due[table.n - 1] }];
        const timeIn = (c) => times.some((r) => r.at >= c.at && r.at < c.end);
        if (act.length) zone = [act[0].at, act.at(-1).end];
        const inZone = (x) => x.at >= zone[0] && x.at < zone[1];
        ms = act.length ? marksIn(raw.slice(zone[0], zone[1])).map((m) => ({ ...m, at: m.at + zone[0], end: m.end + zone[0] })) : [];
        // A due column's own date, with nothing named before it: what the row hands in.
        const dueCell = act.find((c) => c.due && timeIn(c)), dueAt = dueCell && times.find((r) => r.at >= dueCell.at).at;
        if (dueCell && !ms.some((m) => m.at < dueAt)) {
          const name = clean(cs.filter((c) => c !== dueCell && !timeIn(c)).map((c) => cells[c.k]).join('\t'));
          if (name) { zone[0] = Math.min(zone[0], dueCell.at - 1); ms.push({ at: dueCell.at - 1, end: dueCell.at, kind: EXAM_RE.test(raw) ? 'exam' : 'due', strong: 2, name }); }
        }
        if (!ms.length) { zone = [0, raw.length]; ms = marksIn(raw).filter((m) => m.strong > 1); }
        // The row's own time: its date cell, or a weekday cell under a week's heading ("Mon\t…\tQuiz 2").
        def = times.find((r) => !inZone(r)) || null;
        // What an activities column names on a dated session ("Peer review", "Group project") may be only what is done
        // that day: a thing handed in there needs a word that it is due, unless the column is the one for when things are
        // due or is named for what is handed in ("Referat", "Quizzes").
        loose = (x) => act.some((c) => !c.due && !table.thing[Math.min(c.k, table.n - 1)] && x >= c.at && x < c.end);
      } else {
        ms = marksIn(raw);
        if (hm && hf) def = times.find((r) => r.at <= hf.at && hf.at < r.end) || null;
      }
      if (!ms.length) return;
      const owns = times.filter((r) => r !== def && r.at >= zone[0] && r.at < zone[1]);
      if (owns.filter((r) => r.type === 'day').length > 1) return; // several weekdays: which is whose can't be told
      const items = [];
      let pos = def && def.end > zone[0] && def.end <= zone[1] ? def.end : zone[0], prev = null, lone = null;
      const inside = (a, z) => ms.filter((m) => m.at >= a && m.at < z);
      for (const r of owns) {
        const seg = inside(pos, r.at), gap = raw.slice(pos, r.at);
        if (seg.length) {
          // Things before a capitalised one that has the time have the row's.
          const ps = parts(raw, pos, r.at, seg), cut = ps.findLastIndex((p) => p.alone);
          ps.forEach((p, k) => items.push({ ...p, r: k < cut ? null : r }));
          prev = items.at(-1);
        } else if (ALT.test(gap) && prev) return;
        else if (prev && (AND.test(gap) || /^[\s,;]*\p{Ll}/u.test(gap))) {
          const name = AND.test(gap) ? '' : clean(gap);
          items.push({ ...prev, r, title: name ? `${titled(raw.slice(prev.at, prev.end), raw).split(':')[0]}: ${name}` : prev.title });
        } else if (!lone) lone = r;
        pos = r.end;
      }
      const tail = inside(pos, zone[1]);
      // A lone time with what it is for after it ("On Oct 5 the midterm"), not in another clause ("Nov 26, but … due").
      const gap = lone && tail.length ? raw.slice(lone.end, tail[0].at) : '';
      const tailRef = def || (owns.length === 1 && lone && gap.length <= 40 && !/[.;!?]\s|(?<![\p{L}])(?:but|aber|pero|mais|maar|mas)(?![\p{L}])/iu.test(gap) && lone) || null;
      if (tail.length) for (const p of parts(raw, pos, zone[1], tail)) items.push({ ...p, r: tailRef === def ? null : tailRef });
      const due = items.map((it) => {
        const r = it.r || (!(def?.type === 'date' && loose(it.at) && it.ms.every((m) => m.strong < 2)) && def);
        const w = r && !UNGRADED.test(raw.slice(it.at, it.end + 40)) && when(r, def, ctx);
        if (w && r === def) delete w.label; // a week row's dates are no window
        return w && { it, r, w };
      }).filter(Boolean);
      // One thing on the line: its title is the line without its times, as a row always read; several: each its own.
      const cut = (a, z) => { let s = raw.slice(a, z); for (const x of [...times].reverse()) if (x.at >= a && x.end <= z) s = s.slice(0, x.at - a).replace(/(?:(?<![\p{L}])(?:on|by|the|until|before|le|am|el|op|em|no|na|du|vom|del|bis|até|hasta|a|à|au|tot)\s*)+$/iu, '') + ' ' + s.slice(x.end - a); return s; };
      for (const { it, r, w } of due) {
        // A week heading's label stays in the title of what takes its dates ("Week 7 · Exam 1"), not of a weekday's.
        let from = hm && it.r && r.type !== 'date' && r.type !== 'range' ? (hf ? hf.at + hf.len : hm[0].length) : 0;
        for (const x of times) if (from && x.at < from && x.end > from) from = x.end;
        const title = it.title || (due.length === 1 ? titled(cut(from, raw.length).replace(/^\s*\)\s*[:,-]?/, ''), raw) : it.ms.find((m) => m.name)?.name || titled(cut(it.at, it.end), raw));
        put(title, it.kind, w, src, line);
      }
    });
    // A date cell alone ("7th day of week 3"): the items of its row, the lines above it back to a blank line or the row
    // before (a column-major table's dump).
    lines.forEach(({ t: raw, i: line }, i) => {
      if (TOC.test(raw)) return;
      for (const [re, read] of WEEK_REFS) {
        const m = re.exec(raw), ref = m && read(m);
        if (!ref?.cell || /\p{L}{2}/u.test(raw.slice(0, m.index) + raw.slice(m.index + m[0].length))) continue;
        const p = place(ref);
        if (!p) return;
        for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
          const l = lines[j].t;
          if (!l.trim() || HEADER.test(l) || WEEK_REFS.some(([x]) => x.test(l))) break;
          if (kindOf(l) && LBL.test(l)) put(titled(l, l), kindOf(l), { ...p, conf: 'check', weekly: true }, `${clean(l).slice(0, 300)} · ${clean(raw).slice(0, 300)}`, lines[j].i);
        }
        return;
      }
    });
    // A weekly rule ("Weekly Canvas quizzes are due Mondays", "Online quizzes close Sundays", "Abgabe jeweils freitags",
    // "cada viernes", "chaque vendredi", "elke vrijdag", "toda sexta-feira") is a row on each of those days after week 1's
    // first day, up to the course's end the text states, else before its last dated deadline (the final); twenty at most.
    // Days the text names as a break or a holiday are left out, and so is a rule the schedule already dates (two such rows
    // of its kind on that weekday). Each is to check and keeps rule: 'weekly', for the review to show them as one.
    const dated = rows.filter((r) => !r.week);
    const end = (() => {
      for (const { t } of lines) {
        if (!END_RE.test(t) || TOC.test(t)) continue;
        const f = datesIn(t, o).at(-1);
        if (f) return iso(Date.parse(f.end || f.day) + DAY);
      }
      return dated.length ? dated.reduce((a, r) => (r.day > a ? r.day : a), '') : '';
    })();
    const off = [];
    for (const { t } of lines) if (BREAK_RE.test(t)) for (const f of datesIn(t, o)) off.push([f.day, f.end || f.day]);
    lines.forEach(({ t: raw, i: line }) => {
      const m = !anchor || !end || datesIn(raw, o).length || /every other|bi-?weekly|alternate/i.test(raw) ? null : WEEKLY.exec(raw);
      if (!m) return;
      const ms = marksIn(raw.slice(0, m.index + m[0].length));
      const wd = m[1] ? dayIdx(m[1]) : m[2] ? dayIdx(m[2].slice(0, -1)) : WEEKLY_DE.indexOf(m[3].toLowerCase().slice(0, 3));
      if (wd < 0) return;
      const kind = ms.some((x) => x.kind === 'exam') ? 'exam' : 'due';
      if (dated.filter((r) => r.kind === kind && monday(Date.parse(r.day)) === wd).length >= 2) return;
      // The title: what the rule is about, without its weekday ("Weekly Canvas quizzes", "Abgabe der Übungsblätter").
      const upto = m.index + m[0].search(/(?:every|each|jeden|jede|cada|todos|chaque|tous|elke|iedere|toda|jeweils|\p{L}+(?:days|tags|wochs))\s*\p{L}*$/iu);
      const name = raw.slice(0, upto).replace(/\s*(?:(?:are|is|sind|werden|son|se|sont|zijn|são)\s+)?(?:due|close[sd]?|entregan?|cierran|ferment|sluiten|fecham)?\s*(?:on|am|el|le|op|às|aux|les|los)?\s*$/iu, '');
      const title = titled(name.trim() ? name : raw.slice(0, upto), raw);
      const a0 = Date.parse(anchor.day);
      let k = 0;
      for (let d = a0 + ((wd - monday(a0) + 7) % 7 || 7) * DAY; iso(d) < end && k < 20; d += 7 * DAY) {
        const di = iso(d);
        if (off.some(([x, y]) => di >= x && di <= y) || kinds.has(`${di}|${kind}`)) continue;
        rows.push({ title, day: di, kind, conf: 'check', src: clean(raw).slice(0, 300), rule: 'weekly', i: line });
        weekly ||= clean(raw).slice(0, 300);
        k++;
      }
    });
    const week1Field = { ...field(weekly && anchor ? anchor.day : '', anchor?.conf, anchor?.src || weekly), from: weekly && anchor ? anchor.from : '' };
    return { rows: rows.sort((a, b) => a.i - b.i), week1: week1Field };
  };

  // ---- meetings (class times and office hours) --------------------------------------------------------------------
  // The shape W14's schedule parser shares: { label, days, start, end, location }, plus conf and src here.
  const CLASS_RE = any('lectures?|class(?:es)?|meets?|meetings?|meeting times?|sections?|labs?|laborator(?:y|ies)|discussion|recitation|seminars?|tutorials?|vorlesung(?:en)?|übung(?:en)?|praktikum|unterricht|clases?|horario|cours|td|tp|séances?|hoorcollege|werkcollege|college|practicum|clinicals?|aulas?|horário');
  const HOURS_RE = any('office hours?|student hours|drop-in hours|sprechstunden?|sprechzeit(?:en)?|horarios? de (?:atención|tutorías|oficina)|horas de (?:oficina|atención)|tutorías|heures? de (?:bureau|permanence|réception)|permanences?|spreekuur|spreekuren|horários? de atendimento|atendimento|disponibilit[ée]s?');
  // A line's meetings, from W14's reader (days Sunday-first there, Glaze's MO…SU here), with the line's label before the
  // first and each one's place after it.
  const meetingsIn = (line, prev, lang) => {
    const found = CL().meetings(line, { lang });
    const label = found.length ? clean(line.slice(0, found[0].at)) || (/:\s*$/.test(prev) ? clean(prev) : '') : '';
    return found.map((m, i) => {
      const tail = line.slice(m.to, found[i + 1]?.at ?? line.length).replace(/^\s*(?:uhr|uur|h)(?![\p{L}])/iu, '');
      // German "10–12 Uhr (c.t.)": a quarter past to a quarter to.
      const ct = /^\s*\(?\s*c\.\s?t\.\s*\)?/i.test(tail) ? 15 : 0;
      // A title at the place's end lost its name to the next line ("via Teams - Prof." / "Moreno's room"): cut with it.
      const location = clean(clean(tail.replace(/^\s*\(?\s*[cs]\.\s?t\.\s*\)?/i, '').split(/;|\.(?!\d)|\bor\b|\band\b|\boder\b|\bou\b|\bo\b|\bof\b/)[0]).replace(/^(?:in|at|im|en|à|au|em|no|na|op|via)\s+/i, '').replace(CUT_TITLE, ''));
      return { label: label.replace(/[:]\s*$/, '').slice(0, 80), days: ordered(m.days.map((d) => DAYS[(d + 6) % 7])), start: hhmm(m.start + ct), end: hhmm(m.end - ct), location: location.slice(0, 80), unsure: m.unsure.length > 0, at: m.at };
    });
  };
  const CUT_TITLE = /[\s,·-]*(?<![\p{L}])(?:prof(?:essor|essora|esseur)?|dr|dra|mr|mrs|ms|herr|frau|sr|sra|mme|dhr|mevr)\.?$/iu;
  // Lines with days and a time, skipping one-off events (a line with a date). Office hours: a line with their label, the
  // lines right after it that start with a day and a time, and a staff table's office-hours column. A TA's, a tutor's or
  // an Übungsleitung's are office hours too, labelled with the role as written (owner, 2026-10-26). A line that names no
  // class and no office hours keeps only times written as clock times, and no lone time with a guessed end: not "15–18
  // hours of work per week", "Monday 12:00 a.m. through Sunday", or a deadline's "vrijdag 17.00 uur".
  const CLOCKY = /\d\s?[:.h]\s?\d|[ap]\.?\s?m(?![\p{L}])|uhr|uur|\dh(?![\p{L}])|\d{4}\s*-\s*\d{4}/iu;
  const scan = (lines, lang) => {
    const out = [];
    let block = 0, role = '', col = -1;
    lines.forEach((line, i) => {
      const cells = line.split('\t');
      if (cells.filter((c) => /\p{L}{2}/u.test(c)).length > 1 && cells.every((c) => c.length <= 40 && !/\d/.test(c))) col = cells.findIndex((c) => HOURS_RE.test(c));
      else if (cells.length < 2) col = -1;
      const hoursHere = HOURS_RE.test(line) && col < 0;
      const found = meetingsIn(line, lines[i - 1] || '', lang);
      block = hoursHere ? 4 : block && found[0]?.at <= 2 ? block - 1 : 0;
      if (hoursHere) role = OTHER_ROLE.exec(line)?.[0] || '';
      const inBlock = hoursHere || block > 0;
      if (datesIn(line, { start: 0, known: true }).length || datesIn(line, { start: 0, known: true, md: true }).length) return; // any year, either way round
      const cell = col >= 0 && cells.length > col ? [cells.slice(0, col).join('\t').length + (col && 1), cells.slice(0, col + 1).join('\t').length] : null;
      const named = inBlock || cell || CLASS_RE.test(line) || CLASS_RE.test(lines[i - 1] || '');
      for (const { unsure, at: a, to, ...row } of found) {
        if (!named && (unsure || !CLOCKY.test(line.slice(a, to)))) continue;
        const staff = cell && a >= cell[0] && a < cell[1];
        const hours = inBlock || staff;
        const label = staff ? (OTHER_ROLE.exec(cells[0])?.[0] || '') : hours && role ? role : row.label;
        out.push({ ...row, label, hours, conf: named && !unsure ? 'sure' : 'check', src: at(lines, i) });
      }
    });
    return out.slice(0, 40);
  };

  // ---- the professor ----------------------------------------------------------------------------------------------
  const PROF = 'instructors?|course instructor|facilitators?|professors?|professora|lecturers?|teachers?|faculty|taught by|dozent(?:in|en)?|lehrende[rnm]?|lehrkraft|lehrperson|profesor(?:a|es)?|docentes?|enseignant(?:e|es)?|professeure?s?|chargée? de cours|intervenante?|docent(?:e|en)?|hoogleraar|instructeur|leraar|professor(?:a|es)?';
  const HON = "(?:(?:prof(?:essor|essora|esseur|\\.)?|dr|dra|doctor|mr|mrs|ms|mx|miss|herr|frau|sr|sra|srta|m|mme|mlle|dhr|mevr|mw)\\.?\\s+)*";
  const NAME = "(\\p{Lu}[\\p{L}'’-]*\\.?(?:[^\\S\\t\\n]+(?:(?:van|von|de|da|del|der|den|di|dos|das|du|la|le|ter|ten|zu)[^\\S\\t\\n]+)*\\p{Lu}[\\p{L}'’-]*\\.?){0,4})"; // within one cell
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
  const OTHER_ROLE = any("TAs?|teaching assistants?|teaching fellows?|tutors?|graders?|course assistants?|lab instructors?|co-instructors?|tutor(?:in|en)?|hilfskr(?:a|ä)fte?|wissenschaftliche[rn]? mitarbeiter(?:in)?|ayudantes?|asistentes?|monitor(?:a|es)?|chargée? de td|assistante?s?|student-assistent(?:en)?|werkcollegedocent|assistente|übungsleit(?:ung|er|erin)|auxiliaires? d’enseignement|auxiliaires? d'enseignement");
  const field = (value, conf, src) => ({ value: value || '', conf: value ? conf : '', src: value ? src : '' });
  const professor = (lines, lang, hours = []) => {
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
    // A room's own word stays before a number ("Cubículo: 14, Edificio D" is "Cubículo 14, Edificio D").
    const OFFICE = /(?:^|\s·\s)[\s•*-]*(?:office(?:\s+(?:location|room))?|büro|(raum|cubículo|cubiculo|kamer|sala|salle|local)|sprechzimmer|despacho|oficina|bureau|kantoor|gabinete)\s*[:\t]\s*(.+)$/iu;
    for (let i = 0; i < lines.length && !office.value; i++) {
      const m = OFFICE.exec(lines[i]);
      const v = m && clean(m[2].split(EMAIL)[0]);
      if (m && !HOURS_RE.test(lines[i])) office = field(`${m[1] && /^\d/.test(v) ? `${m[1]} ` : ''}${v}`.slice(0, 120), 'sure', at(lines, i));
    }
    // With no office named, the professor's own office hours' place, when it is a room ("Mon 2–3:30 PM, Gates Hall 412"),
    // not a call ("via Zoom"): to check.
    const own = !office.value && hours.find((h) => !h.label.match(OTHER_ROLE) && /\p{L}{2}.*\d|\d.*\p{L}{2}/u.test(h.location) && !/zoom|teams|online|virtual|meet|webex|skype|discord|appointment|link/i.test(h.location));
    if (own) office = field(own.location.slice(0, 120), 'check', own.src);
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
  const scale = (s, lines, starts, shown = lines) => {
    s = s.replace(/(?<![\p{L}])(?:Below|Under|Less than|Unter|Weniger als|Menos de|Moins de|En dessous de|Minder dan|Onder|Abaixo de|Inferior a)(?![\p{L}])/gu, (x) => x.toLowerCase()); // "Below 55\tF"
    const found = [];
    const pair = new RegExp(`(?<![^\\s(;,|•])${LETTER}(?![\\p{L}\\d+])[ \\t]*(?:[:=]|\\(|-(?=\\s))?[ \\t]*\\(?[ \\t]*${RANGE}`, 'gmu');
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
    // A table of two columns read across ("A 93–100\tC+ 77–79.99" / "A- 90–92.99\tC 70–76.99") is its letters ranked by
    // their percentages, where that is the letters' own order (A+, A, A-, B+ … F) and the ranges meet.
    found.sort((a, b) => a.at - b.at);
    const rank = (l) => 'ABCDEF'.indexOf(l[0]) * 3 + (l[1] === '+' ? 0 : l[1] === '-' ? 2 : 1);
    let best = [], order = 0;
    for (let i = 0; i < found.length; i++) {
      const run = [found[i]];
      let skipped = 0, kept = 0, j = i + 1;
      for (; j < found.length && j < i + 40 && found[j].at - found[j - 1].at < 160; j++) {
        if (found[j].min < run.at(-1).min && !run.some((r) => r.letter === found[j].letter)) { run.push(found[j]); kept = skipped; } else skipped++;
      }
      const across = found.slice(i, j).filter((e, k, a) => a.findIndex((x) => x.letter === e.letter) === k).sort((x, y) => y.min - x.min);
      const fits = across.every((e, k) => !k || (rank(e.letter) > rank(across[k - 1].letter) && e.min < across[k - 1].min && (e.max == null || (e.max < across[k - 1].min && across[k - 1].min - e.max <= 1 + 1e-9))));
      if (run.length > best.length) [best, order] = [run, kept];
      if (fits && across.length > best.length) [best, order] = [across, 0];
    }
    if (best.length < 3) return field();
    // A failing letter written after the run with what it is below ("60-69% D, below 60% F").
    const lastF = best.at(-1), tail = s.slice(lastF.at, lastF.at + 80);
    const failing = !/^[EF]/.test(lastF.letter) && new RegExp(`^[^\\n]*?(?:(?:${UNDER})\\s*${NUM}\\s*%?\\s*[:=]?\\s*\\(?([EF])(?![\\p{L}\\d+])|(?<![\\p{L}])([EF])\\s*[:=]?\\s*\\(?(?:${UNDER})\\s*${NUM})`, 'iu').exec(tail);
    if (failing && Math.abs(n(failing[1] || failing[4]) - lastF.min) < 0.51) best = [...best, { letter: (failing[2] || failing[3]).toUpperCase(), min: 0, max: n(failing[1] || failing[4]) - 0.01, at: lastF.at + failing.index }];
    // Letters on a 0–10 or a 0–20 scale (conceitos "A: 9,0 a 10,0") are read as percents.
    const top = Math.max(...best.map((e) => e.max ?? e.min)), k = top >= 9 && top <= 10 ? 10 : top >= 16 && top <= 20 ? 5 : 1;
    if (k > 1) best = best.map((e) => ({ ...e, min: e.min * k, max: e.max == null ? null : e.max * k }));
    // What makes the scale a guess: ranges that overlap, leave a gap (more than a point), or letters out of order.
    const issues = order ? [{ kind: 'order' }] : [];
    const show = (e) => `${e.letter} ${e.min}${e.max != null ? `–${Math.round(e.max * 100) / 100}` : ''}`;
    for (let k = 1; k < best.length; k++) {
      const [hi, lo] = [best[k - 1], best[k]];
      if (lo.max == null) continue;
      if (lo.max >= hi.min) issues.push({ kind: 'overlap', a: show(hi), b: show(lo) });
      else if (hi.min - lo.max > 1 + 1e-9) issues.push({ kind: 'gap', a: show(hi), b: show(lo) });
    }
    const [a, b] = [lineAt(starts, Math.min(...best.map((e) => e.at))), lineAt(starts, Math.max(...best.map((e) => e.at)))];
    const near = lines.slice(Math.max(0, a - 6), a + 1).some((l) => SCALE_LABEL.test(l));
    const f = field(best.map(({ letter, min }) => [letter, Math.round(min * 100) / 100]), near && !issues.length && k === 1 && shown === lines ? 'sure' : 'check', clean(shown.slice(a, b + 1).join(' · ')).slice(0, 300));
    return { ...f, ranges: best.map(({ letter, min, max }) => [letter, min, max]), issues };
  };
  // A scale in points ("A\t900–1000"), where the grading gives its total, as percents of that total.
  const pointScale = (s, lines, starts, pts) => {
    const f = scale(s, lines, starts);
    if (f.value || !(pts > 100)) return f;
    const pct = (l) => l.replace(/(?<![\d.,])\d{3,5}(?:[.,]\d+)?(?![\d%])/g, (x) => (n(x) <= pts ? String(Math.round((n(x) / pts) * 10000) / 100) : x));
    const ls = lines.map(pct), st = [];
    for (let i = 0, k = 0; k < ls.length; k++) { st.push(i); i += ls[k].length + 1; }
    return scale(ls.join('\n'), ls, st, lines);
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
    const forward = [...t.matchAll(/(\p{L}[\p{L}\p{M}\d &/'’.,()+-]{1,60}?)[ \t]*[:\t=–-]?[ \t]*(\d{1,3}(?:[.,]\d+)?)[ \t]*%/gu)].map((m) => pair(m, m[1], m[2])).filter(ok);
    const backward = [...t.matchAll(/(\d{1,3}(?:[.,]\d+)?)[ \t]*%[ \t]*[:\t–-]?[ \t]*(\p{Lu}[\p{L}\p{M}\d &/'’-]{2,40})/gu)].map((m) => pair(m, m[2], m[1])).filter(ok);
    // Where a position's line starts, looking back 200 characters at most.
    const home = (k) => { const a = Math.max(0, k - 200); return a + t.slice(a, k).lastIndexOf('\n') + 1; };
    // Next to each other: at most 40 characters and two line breaks between one and the next; 20 at most a block.
    const blocks = (pairs) => {
      const out = [];
      let cur = [];
      for (const p of pairs) {
        const prev = cur.at(-1);
        const gap = prev && t.slice(prev.end, p.at);
        // A line that starts a labelled section of its own ("Grading scale: A 90%") starts a new block, not one whose label
        // is the item's name ("Final exam: 25%").
        const ls = home(p.at), lab = /^\s*\p{L}[\p{L} ]{2,30}:/u.exec(t.slice(ls, p.at + 1));
        const section = prev && gap.includes('\n') && lab && ls + lab[0].length <= p.at;
        if (prev && (section || p.at - prev.end > 40 || (gap.match(/\n/g) || []).length > 2 || cur.length >= 20)) { out.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length) out.push(cur);
      return out.filter((b) => b.length >= 2).map((b) => ({ b, sum: b.reduce((x, p) => x + p.weight, 0) })).map(trim);
    };
    // A sentence's percent at a block's end ("To pass you need 70% overall:", "a late penalty of 10% per day") is no
    // category, when without it the block adds up to 100.
    const prose = (p) => { const ls = home(p.at), le = t.slice(p.end, p.end + 200).indexOf('\n') + p.end; return p.name.split(' ').length > 5 || /[.!?]\s/.test(p.name) || /\p{L}{2}.*\s\S/u.test(t.slice(ls, p.at)) || /(?:[ \p{P}]+\p{L}+){2}/u.test(t.slice(p.end, le < p.end ? p.end + 200 : le).split('\t')[0]); };
    const trim = (x) => {
      if (Math.abs(x.sum - 100) < 0.6) return x;
      let b = x.b;
      while (b.length > 2 && prose(b[0]) && Math.abs(x.sum - 100) >= 0.6) { x = { b: b.slice(1), sum: x.sum - b[0].weight }; b = x.b; }
      while (b.length > 2 && prose(b.at(-1)) && Math.abs(x.sum - 100) >= 0.6) { x = { b: b.slice(0, -1), sum: x.sum - b.at(-1).weight }; b = x.b; }
      return x;
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
    if (!best) return points(lines);
    const [a, b] = [lineAt(starts, best.b[0].at), lineAt(starts, best.b.at(-1).at)];
    const f = field(fold(best.b), whole && labelled(best) ? 'sure' : 'check', clean(lines.slice(a, b + 1).join(' · ')).slice(0, 300));
    return { ...f, issues: whole ? [] : [{ kind: 'sum', total: Math.round(best.sum * 100) / 100 }] };
  };

  // Grading in points only (owner, 2026-10-26): a table of categories and their points ("Essays (4 × 100)\t400" …
  // "Total\t1000") under a header that says points, as percents of the total; the total row, where there is one, must be
  // the sum. To check, with the lines it came from; points: the total, for a scale in points.
  const POINTS = any('points|pts|punkte|puntos|pontos|punten|puntaje|puntuación|pontuação');
  const PTS_ROW = /^[\s•*▪-]*(\p{L}[^\t\n]{0,60}?)\s*(?:\t|:|\s[-–]\s|\.{3,}|\()\s*(\d{1,5})\s*(?:pts?\.?|points?|punkte|puntos|pontos|punten)?\s*\)?\s*$/iu;
  const PTS_UNIT = /\d\s*(?:pts?\.?|points?|punkte|puntos|pontos|punten)\s*\)?\s*$/iu;
  const points = (lines) => {
    for (let i = 0; i < lines.length; i++) {
      // A header that says points ("Assignment\tPoints"), or rows that each do ("Homework – 150 points").
      const head = lines[i].split('\t'), titled = head.length > 1 && head.some((c) => POINTS.test(c)) && !head.some((c) => /\d/.test(c));
      if (!titled && !(PTS_ROW.test(lines[i]) && PTS_UNIT.test(lines[i]))) continue;
      const rows = [];
      let total = 0, j = titled ? i + 1 : i;
      for (; j < lines.length && j < i + 22; j++) {
        const m = PTS_ROW.exec(lines[j]);
        if (!m || (!titled && !PTS_UNIT.test(lines[j]))) break;
        const name = clean(m[1].replace(/\s*\([^)]*\)/g, ' ').replace(/^[^:]{2,30}:\s+(?=\p{L}{2})/u, '')).slice(0, 60); // a heading joined to it
        if (TOTAL.test(name.split(/\s/)[0])) { total = +m[2]; j++; break; }
        if (!/\p{L}{2}/u.test(name)) break;
        rows.push({ name, pts: +m[2] });
      }
      const sum = rows.reduce((x, r) => x + r.pts, 0);
      if (rows.length < 2 || !sum || (total && Math.abs(total - sum) > 0.005 * sum)) { i = Math.max(i, j - 1); continue; }
      const f = field(rows.map((r) => ({ name: r.name, weight: Math.round((r.pts / sum) * 10000) / 100 })), 'check', clean(lines.slice(i, j).join(' · ')).slice(0, 300));
      return { ...f, issues: [], points: sum };
    }
    return field();
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
  // → { prof, hours, meetings, dates, scale, weights, week1, truncated }; dates [{ title, day, kind, conf, src, week?, wd?,
  // dow?, rule? }] (a hundred at most); week1 { value, conf, src, from: 'text' | 'course' | 'term' } is the day week-based
  // dates count from, '' when there are none (deadlines).
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
    const wk = deadlines(lines, { ...o, lang }, opts.week1), w = weights(s, lines, starts);
    return {
      prof: professor(lines, lang, once(all.filter((m) => m.hours))),
      hours: once(all.filter((m) => m.hours).map(({ hours, ...m }) => m)),
      meetings: all.filter((m) => !m.hours).map(({ hours, ...m }) => m),
      dates: wk.rows.map(({ i, ...d }) => d).slice(0, 100),
      week1: wk.week1,
      scale: pointScale(s, lines, starts, w.points),
      weights: w.points ? (({ points, ...x }) => x)(w) : w,
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
