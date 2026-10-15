// Syllabus import (W15): the facts a student wants from a syllabus, read out of its plain text on the device. The
// text comes from lib/doctext.js (DOCX, PPTX, HTML, Canvas's own Syllabus page) or is pasted; a PDF text layer or an
// on-device model can later feed extract() the same way, or fill in what it left empty: every field says how sure it
// is (conf 'sure' or 'check') and which line it came from (src), and features/syllabus.js shows all of it for review
// before anything is kept. Heuristics only (parity/spikes/S4.md): labelled layouts in English, German, Spanish,
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
  const clean = (s) => String(s).replace(/\t+/g, ' · ').replace(/\s+/g, ' ').replace(/(?: ·)+ /g, ' · ').replace(/^[\s,:;.\-·|•*–]+|[\s,:;\-·|•*–]+$/g, '');
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
    // "12.10." or "12.10.2026" (day first)
    [/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?!\d))?/g, (m) => ({ d: +m[1], mo: +m[2] - 1, y: m[3] })],
    // "10/12" or "10/12/26": month first where the page's language writes it so (US English), else day first
    [/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/%])(?!\s*(?:of|der|des|de|van|do|da)\b)/g, (m, o) => ({ ...(o.md ? { mo: +m[1] - 1, d: +m[2] } : { d: +m[1], mo: +m[2] - 1 }), y: m[3], amb: +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2] })],
  ];
  // A day in the course's term: an explicit year as written, else the year that puts it no earlier than 45 days before
  // the term starts (a spring term's January after a December syllabus date, say).
  const dayOf = ({ y, mo, d }, start) => {
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    let year = y ? (y.length === 2 ? 2000 + +y : +y) : new Date(start).getUTCFullYear();
    if (!y && Date.UTC(year, mo, d) < start - 45 * DAY) year++;
    const t = new Date(Date.UTC(year, mo, d));
    return t.getUTCMonth() === mo ? t.toISOString().slice(0, 10) : null;
  };
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
        const day = dayOf(r, o.start);
        // Sure only of a named month or a year, and never of a range or of a numeric date that reads either way round.
        if (day) found.push({ day, end: end && dayOf({ ...r, d: end }, o.start), at, len, sure: !!(r.named || r.y) && !end && !r.amb });
      }
    }
    return found.sort((a, b) => a.at - b.at);
  };
  const EXAM = 'exams?|midterms?|mid-term|final exams?|finals|(?<=^\\s*)final(?=\\s*[:\\t-])|quiz(?:zes)?|tests?|practicals?|klausur(?:en)?|prüfung(?:en)?|examen|parcial(?:es)?|prueba|partiel|contrôle|controle|tentamen|toets|prova|exame|avaliação';
  const DUE = 'due|deadline|projects?|papers?|essays?|reports?|presentations?|assignments?|homework|portfolio|abgabe|fällig|referat|hausarbeit|projekt|präsentation|entrega|proyecto|ensayo|presentación|trabajo|rendu|remise|à rendre|projet|devoir|exposé|dossier|inleveren|verslag|opdracht|presentatie|projeto|apresentação|relatório|seminário';
  const EXAM_RE = any(EXAM), DUE_RE = any(DUE);
  const dateRows = (lines, o) => {
    const out = [];
    lines.forEach((raw, i) => {
      const kind = EXAM_RE.test(raw) ? 'exam' : DUE_RE.test(raw) ? 'due' : '';
      if (!kind) return; // a schedule's every lecture topic is noise
      const found = datesIn(raw, o);
      if (!found.length) return;
      // The title: the line without its dates and the weekday right before each.
      let title = raw;
      for (const f of [...found].reverse()) {
        const before = title.slice(0, f.at).replace(new RegExp(`(?<![\\p{L}])${W}\\s*,?\\s*$`, 'iu'), '').replace(/(?<![\p{L}])(?:on|the|le|am|el|op|em|no|na|du|vom|del)\s*$/iu, '');
        title = before + ' ' + title.slice(f.at + f.len);
      }
      // …and without its times ("8:00-10:00 AM", "at 11:59 pm").
      title = title.replace(CLOCK, ' ')
        .replace(/(?<![\p{L}])(?:at|by|um|à|às|om)\s*(?=[,;]|$)/giu, ' ').replace(/\(\s*\)/g, ' ').replace(/\s*([,:;])(?:\s*[,:;])+/g, '$1');
      title = clean(title).slice(0, 200) || clean((EXAM_RE.exec(raw) || DUE_RE.exec(raw))[0]);
      title = title[0].toUpperCase() + title.slice(1);
      for (const f of found) if (!out.some((x) => x.day === f.day && x.title === title)) out.push({ title, day: f.day, ...(f.end && { end: f.end }), kind, conf: f.sure ? 'sure' : 'check', src: at(lines, i) });
    });
    return out.slice(0, 60);
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
      const location = clean(clean(tail.split(/;|\.(?!\d)|\bor\b|\band\b|\boder\b|\bou\b|\bo\b|\bof\b/)[0]).replace(/^(?:in|at|im|en|à|au|em|no|na|op)\s+/i, ''));
      return { label: label.replace(/[:]\s*$/, '').slice(0, 80), days: ordered(m.days.map((d) => DAYS[(d + 6) % 7])), start: hhmm(m.start), end: hhmm(m.end), location: location.slice(0, 80), unsure: m.unsure.length > 0, at: m.at };
    });
  };
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
      if (datesIn(line, { start: 0 }).some((d) => d.sure)) return;
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
    // Office hours with no time to read ("By appointment"): kept as words.
    let note = field();
    for (let i = 0; i < lines.length && !note.value; i++) {
      const m = HOURS_RE.exec(lines[i]);
      if (m && !CL().meetings(lines[i], { lang }).length) note = field(clean(lines[i].slice(m.index + m[0].length).replace(/^\s*[:\t-]/, '')).slice(0, 200), 'check', at(lines, i));
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
  const weights = (s, lines, starts) => {
    const t = s.replace(/\(\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)/g, ' $1%').replace(/\([^)\n]*%[^)\n]*\)/g, (x) => ' '.repeat(x.length));
    const tidy = (x) => clean(x.replace(/\s*\([^)]*\)?/g, ' ')).replace(/^(?:and|und|y|e|et|en|the|die|der|das|le|la|les|el|los|las|o|os|a|as|de|het)\s+/i, '')
      .replace(/\s*(?:(?:is|are)\s+)?(?:worth|counts?(?:\s+for)?|accounts?\s+for|weighted\s+at|zählt|vale|cuenta|compte pour|telt voor|representa|=)\s*$/i, '').trim().slice(0, 60);
    const pair = (m, name, w) => ({ name: tidy(name), weight: n(w), at: m.index, end: m.index + m[0].length });
    const ok = (p) => p.name && /\p{L}{2}/u.test(p.name) && p.weight > 0 && p.weight <= 100;
    const forward = [...t.matchAll(/(\p{L}[\p{L}\p{M}\d &/'’.,()-]{1,60}?)[ \t]*[:\t=–-]?[ \t]*(\d{1,3}(?:[.,]\d+)?)[ \t]*%/gu)].map((m) => pair(m, m[1], m[2])).filter(ok);
    const backward = [...t.matchAll(/(\d{1,3}(?:[.,]\d+)?)[ \t]*%[ \t]*\n?[ \t]*[:\t–-]?[ \t]*(\p{Lu}[\p{L}\p{M}\d &/'’-]{2,40})/gu)].map((m) => pair(m, m[2], m[1])).filter(ok);
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
    const all = [...blocks(forward), ...blocks(backward)];
    const labelled = ({ b }) => { const a = lineAt(starts, b[0].at); return lines.slice(Math.max(0, a - 6), a + 1).some((l) => WEIGHT_LABEL.test(l)); };
    const whole = all.find((x) => Math.abs(x.sum - 100) < 0.6);
    const best = whole || all.find(labelled);
    if (!best) return field();
    const [a, b] = [lineAt(starts, best.b[0].at), lineAt(starts, best.b.at(-1).at)];
    const f = field(best.b.map(({ name, weight }) => ({ name, weight })), whole && labelled(best) ? 'sure' : 'check', clean(lines.slice(a, b + 1).join(' · ')).slice(0, 300));
    return { ...f, issues: whole ? [] : [{ kind: 'sum', total: Math.round(best.sum * 100) / 100 }] };
  };

  // ---- everything -------------------------------------------------------------------------------------------------
  // text: the syllabus as plain text. opts.start: when the course's term starts (ms; defaults to now), for dates without
  // a year; opts.md: numeric dates are month first (US English); opts.hint: the page's language, where the text's own
  // can't be told. → { prof, hours, meetings, dates, scale, weights, truncated }.
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
    const o = { start: Number.isFinite(opts.start) ? opts.start : Date.now(), md: !!opts.md };
    // The text's language by its day names, else the page's (opts.hint), for W14's day tables.
    const lang = CL().detect(s, opts.hint || 'en');
    const all = scan(lines, lang);
    return {
      prof: professor(lines, lang),
      hours: all.filter((m) => m.hours).map(({ hours, ...m }) => m),
      meetings: all.filter((m) => !m.hours).map(({ hours, ...m }) => m),
      dates: dateRows(lines, o),
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

  // Kept per Canvas site, user and course, in storage.local through the worker (lib/background.js 'glaze:syllabus').
  const key = (origin, uid, cid) => `syllabus:${origin}/${uid}/${cid}`;
  const KEY = /^syllabus:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d{1,20}\/\d{1,20}$/i;
  const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
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
        .map((d) => ({ title: str(d.title, 200), day: d.day, kind: ['exam', 'due'].includes(d.kind) ? d.kind : 'other' })).slice(0, 100),
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
  // A To Do task's id for a date from a syllabus: the same date and title make the same task, so saving again updates it.
  const taskId = (cid, d) => {
    let h = 0x811c9dc5;
    for (const c of `${d.day}|${d.title}`) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
    return `syl-${cid}-${h.toString(36)}`;
  };

  return { DAYS, MAX, norm, extract, parseWeights, weightsText, key, KEY, tidy, change, taskId };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_SYLLABUS; else GZ_SYLLABUS;
