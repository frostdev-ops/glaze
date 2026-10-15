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

  // ---- days -------------------------------------------------------------------------------------------------------
  // Weekday names and abbreviations in the six languages, as written in schedules.
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
  const JOIN = '\\s*(?:,|/|&|\\+|-|(?<![\\p{L}])(?:and|und|y|e|et|en|to|bis|a|à|through|thru|until|tot|t/m|até)(?![\\p{L}]))\\s*';
  const DAY_RE = new RegExp(`(?<![\\p{L}])${W}(?:${JOIN}${W})*(?![\\p{L}])`, 'iu');
  const RANGE_JOIN = /^\s*(?:-|to|bis|a|à|through|thru|until|tot|t\/m|até)\s*$/i;
  // Letters: MWF, TR, TTh, M/W/F, T R; Spanish L M X J V (one with an L, X, J or V reads as Spanish).
  const COMPACT_RE = /(?<![\p{L}\d])((?:Th|Tu|Sa|Su|[MTWRFSULXJV])(?:[/ ,-]?(?:Th|Tu|Sa|Su|[MTWRFSULXJV]))*)(?![\p{L}])/u;
  const EN = { M: 'MO', T: 'TU', Tu: 'TU', W: 'WE', R: 'TH', Th: 'TH', F: 'FR', S: 'SA', Sa: 'SA', U: 'SU', Su: 'SU' };
  const ES = { L: 'MO', M: 'TU', X: 'WE', J: 'TH', V: 'FR', S: 'SA' };
  const ordered = (list) => DAYS.filter((d) => list.includes(d));
  // → { days: ['MO', …], at, len, range (a range read from a dash) } or null.
  const days = (s) => {
    const m = DAY_RE.exec(s);
    if (m) {
      const parts = m[0].split(new RegExp(`(${JOIN})`, 'iu'));
      const out = [];
      let range = false;
      for (let i = 0; i < parts.length; i += 2) {
        const d = ONE_DAY.findIndex((r) => r.test(parts[i].trim()));
        if (d < 0) continue;
        const prev = out.length ? DAYS.indexOf(out.at(-1)) : -1;
        if (i > 1 && prev >= 0 && RANGE_JOIN.test(parts[i - 1]) && d > prev) {
          for (let k = prev + 1; k <= d; k++) out.push(DAYS[k]);
          range ||= parts[i - 1].trim() === '-';
        } else out.push(DAYS[d]);
      }
      if (out.length) return { days: ordered(out), at: m.index, len: m[0].length, range };
    }
    const c = COMPACT_RE.exec(s);
    if (!c) return null;
    const toks = c[1].replace(/[/ ,-]/g, '').match(/Th|Tu|Sa|Su|[MTWRFSULXJV]/g);
    const map = toks.some((x) => 'LXJV'.includes(x)) ? ES : EN;
    const out = toks.map((x) => map[x] || map[x[0]]).filter(Boolean);
    return out.length ? { days: ordered(out), at: c.index, len: c[1].length, range: false } : null;
  };

  // ---- times ------------------------------------------------------------------------------------------------------
  // "9:00-9:50 AM", "11:00am-12:15pm", "1-3pm", "14:00-15:30", "14h00-15h30", "14.00-15.30 Uhr", "9 a 11 h" → '09:00'.
  const END = '\\s*(?:([ap])\\.?\\s?m\\.?(?![\\p{L}])|(h|uhr|uur)(?![\\p{L}]))?';
  const TIME_RE = new RegExp(`(?<![\\d:.,])(\\d{1,2})(?:([:.h])(\\d\\d))?${END}\\s*(?:-|to|until|till|bis|a|à|às|hasta|tot|até)\\s*(\\d{1,2})(?:([:.h])(\\d\\d))?${END}(?![\\d:%])`, 'iu');
  const hhmm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
  const times = (s) => {
    const m = TIME_RE.exec(s);
    if (!m) return null;
    const [, h1s, s1, m1s, a1r, u1, h2s, s2, m2s, a2r, u2] = m;
    if (!m1s && !m2s && !a1r && !a2r && !u1 && !u2) return null; // "10-11" alone is not a time
    const h1 = +h1s, h2 = +h2s, m1 = +(m1s || 0), m2 = +(m2s || 0);
    if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
    let a1 = a1r?.toLowerCase(), a2 = a2r?.toLowerCase();
    const min = (h, mm, a) => ((a === 'p' && h < 12 ? h + 12 : a === 'a' && h === 12 ? 0 : h) * 60) + mm;
    // A 24-hour clock: an "h" or "Uhr", a dotted time, an hour past 12 or a leading zero.
    const h24 = !a1 && !a2 && (u1 || u2 || s1 === 'h' || s2 === 'h' || s1 === '.' || s2 === '.' || h1 > 12 || h2 > 12 || /^0/.test(h1s) || /^0/.test(h2s));
    let start, end;
    if (h24) [start, end] = [h1 * 60 + m1, h2 * 60 + m2];
    else {
      const flip = (a) => (a === 'a' ? 'p' : 'a');
      if (!a1 && !a2) a2 = h2 >= 7 && h2 <= 11 ? 'a' : 'p'; // no meridiem: classes run from 7am to 10pm
      if (!a1) a1 = min(h1, m1, a2) > min(h2, m2, a2) ? flip(a2) : a2; // "11:00-12:15pm" starts in the morning
      if (!a2) a2 = min(h2, m2, a1) < min(h1, m1, a1) ? flip(a1) : a1; // "11am-1" ends in the afternoon
      [start, end] = [min(h1, m1, a1), min(h2, m2, a2)];
      if (!a1r && start < 420) return null; // a morning start Glaze guessed, before 7am: not a class time
    }
    if (end <= start) return null;
    return { start: hhmm(start), end: hhmm(end), at: m.index, len: m[0].length };
  };

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
    [/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/%])(?!\s*(?:of|der|des|de|van|do|da)\b)/g, (m, o) => (o.md ? { mo: +m[1] - 1, d: +m[2], y: m[3] } : { d: +m[1], mo: +m[2] - 1, y: m[3] })],
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
        const day = dayOf(r, o.start);
        if (day) found.push({ day, at: m.index, len: m[0].length, sure: !!(r.named || r.y) });
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
      title = title.replace(new RegExp(TIME_RE.source, 'giu'), ' ').replace(/(?<![\d:])\d{1,2}(?::\d\d)?\s*(?:[ap]\.?\s?m\.?|uhr|uur|h)(?![\p{L}])/giu, ' ')
        .replace(/(?<![\p{L}])(?:at|by|um|à|às|om)\s*(?=[,;]|$)/giu, ' ').replace(/\(\s*\)/g, ' ').replace(/\s*([,:;])(?:\s*[,:;])+/g, '$1');
      title = clean(title).slice(0, 200) || clean((EXAM_RE.exec(raw) || DUE_RE.exec(raw))[0]);
      title = title[0].toUpperCase() + title.slice(1);
      for (const f of found) if (!out.some((x) => x.day === f.day && x.title === title)) out.push({ title, day: f.day, kind, conf: f.sure ? 'sure' : 'check', src: at(lines, i) });
    });
    return out.slice(0, 60);
  };

  // ---- meetings (class times and office hours) --------------------------------------------------------------------
  // The shape W14's schedule parser shares: { label, days, start, end, location }, plus conf and src here.
  const CLASS_RE = any('lectures?|class(?:es)?|meets?|meetings?|meeting times?|sections?|labs?|laborator(?:y|ies)|discussion|recitation|seminars?|tutorials?|vorlesung(?:en)?|übung(?:en)?|praktikum|unterricht|clases?|horario|cours|td|tp|séances?|hoorcollege|werkcollege|college|practicum|aulas?|horário');
  const HOURS_RE = any('office hours?|student hours|drop-in hours|sprechstunden?|sprechzeiten?|horarios? de (?:atención|tutorías|oficina)|horas de (?:oficina|atención)|tutorías|heures? de (?:bureau|permanence|réception)|permanences?|spreekuur|spreekuren|horários? de atendimento|atendimento');
  const meetingsIn = (line, prev) => {
    const found = [];
    for (let base = 0, t; (t = times(line.slice(base))); base += t.at + t.len) found.push({ ...t, at: t.at + base });
    const out = [];
    let label = null;
    found.forEach((t, i) => {
      const lo = i ? found[i - 1].at + found[i - 1].len : 0, hi = i + 1 < found.length ? found[i + 1].at : line.length;
      const before = days(line.slice(lo, t.at)), after = !before && days(line.slice(t.at + t.len, hi));
      const d = before ? { ...before, at: before.at + lo } : after ? { ...after, at: after.at + t.at + t.len } : null;
      if (!d) return;
      if (label === null) label = clean(line.slice(0, Math.min(d.at, t.at))) || (/:\s*$/.test(prev) ? clean(prev) : '');
      const tail = line.slice(Math.max(d.at + d.len, t.at + t.len), hi);
      const location = clean(clean(tail.split(/;|\.(?!\d)|\bor\b|\band\b|\boder\b|\bou\b|\bo\b|\bof\b/)[0]).replace(/^(?:in|at|im|en|à|au|em|no|na|op)\s+/i, ''));
      out.push({ label: label.replace(/[:]\s*$/, '').slice(0, 80), days: d.days, start: t.start, end: t.end, location: location.slice(0, 80), range: d.range });
    });
    return out;
  };
  // Every class time in a text (W14 may replace this with its own parser of the same shape).
  const meetings = (text) => scan(norm(text).split('\n')).filter((m) => !m.hours).map(({ hours, ...m }) => m);
  // Lines with days and a time range, skipping one-off events (a line with a date). Office hours: a line with their
  // label, and the lines right after it that start with a day.
  const scan = (lines) => {
    const out = [];
    let block = 0;
    lines.forEach((line, i) => {
      const hoursHere = HOURS_RE.test(line);
      block = hoursHere ? 4 : block && days(line.trim())?.at === 0 ? block - 1 : 0;
      const inBlock = hoursHere || block > 0;
      if (datesIn(line, { start: 0 }).some((d) => d.sure)) return;
      for (const m of meetingsIn(line.replace(/\t/g, ' \t '), lines[i - 1] || '')) {
        const sure = inBlock || CLASS_RE.test(line) || CLASS_RE.test(lines[i - 1] || '');
        const { range, ...row } = m;
        out.push({ ...row, hours: inBlock, conf: sure && !range ? 'sure' : 'check', src: at(lines, i) });
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
  const field = (value, conf, src) => ({ value: value || '', conf: value ? conf : '', src: value ? src : '' });
  const professor = (lines) => {
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
    // The e-mail: on the professor's line or the next few, else one with its own label, else the first.
    let email = field();
    for (let i = Math.max(0, at0); at0 >= 0 && i < at0 + 5 && !email.value; i++) { const m = EMAIL.exec(lines[i] || ''); if (m) email = field(m[0], 'sure', at(lines, i)); }
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
      if (m && !times(lines[i])) note = field(clean(lines[i].slice(m.index + m[0].length).replace(/^\s*[:\t-]/, '')).slice(0, 200), 'check', at(lines, i));
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
  // A range's lowest percentage: groups k..k+7 of RANGE's alternatives.
  const low = (m, k) => {
    if (m[k] != null) { const a = n(m[k]), b = n(m[k + 1]); return Math.max(a, b) <= 100.5 ? Math.min(a, b) : null; }
    if (m[k + 2] != null) return n(m[k + 2]);
    if (m[k + 3] != null) return n(m[k + 3]);
    if (m[k + 4] != null || m[k + 5] != null) return 0;
    if (m[k + 6] != null) return n(m[k + 6]);
    // A bare number: a percentage from 10 up (or 0), never grade points (A 4.0, B 3.0).
    const v = n(m[k + 7]);
    return v === 0 || v >= 10 ? v : null;
  };
  const SCALE_LABEL = any('grading scale|grade scale|grading|letter grades?|grade distribution|notenskala|notenschlüssel|notenspiegel|bewertungsschema|escala de calificaci[oó]n(?:es)?|calificaciones|barème|bareme|échelle de notation|cijferschaal|beoordelingsschaal|escala de notas|conceitos');
  const scale = (s, lines, starts) => {
    const found = [];
    const pair = new RegExp(`(?:^|[\\s(;,|•])${LETTER}(?![\\p{L}\\d+])[ \\t]*(?:[:=]|\\(|-(?=\\s))?[ \\t]*\\(?[ \\t]*${RANGE}`, 'gmu');
    for (const m of s.matchAll(pair)) {
      const min = low(m, 2);
      if (min != null && min <= 100) found.push({ letter: m[1].toUpperCase(), min, at: m.index + m[0].indexOf(m[1]) });
    }
    if (found.length < 3) {
      const rev = new RegExp(`${RANGE}[ \\t]*(?:[:=]|→|->|\\t)?[ \\t]*${LETTER}(?=[\\s;,)]|$)`, 'gmu');
      for (const m of s.matchAll(rev)) {
        const min = low(m, 1);
        if (min != null && min <= 100) found.push({ letter: m[9].toUpperCase(), min, at: m.index });
      }
    }
    // A table read column by column: letter-only lines, then as many range-only lines.
    if (found.length < 3) {
      const isL = (l) => new RegExp(`^${LETTER}\\s*:?$`).exec(l.trim());
      const isR = (l) => new RegExp(`^${RANGE}$`, 'iu').exec(l.trim());
      for (let i = 0; i < lines.length;) {
        const ls = [], rs = [];
        while (i < lines.length && isL(lines[i])) ls.push([isL(lines[i++])[1], starts[i - 1]]);
        while (i < lines.length && rs.length < ls.length && isR(lines[i])) rs.push(low(isR(lines[i++]), 1));
        if (ls.length && rs.length === ls.length) ls.forEach(([l, a], k) => found.push({ letter: l, min: rs[k] ?? 0, at: a }));
        if (!ls.length && !rs.length) i++;
      }
    }
    // The longest run, in text order, of different letters whose lowest percentages fall.
    found.sort((a, b) => a.at - b.at);
    let best = [];
    for (let i = 0; i < found.length; i++) {
      const run = [found[i]];
      for (let j = i + 1; j < found.length && found[j].min < run.at(-1).min && found[j].at - run.at(-1).at < 160; j++) if (!run.some((r) => r.letter === found[j].letter)) run.push(found[j]);
      if (run.length > best.length) best = run;
    }
    if (best.length < 3) return field();
    const [a, b] = [lineAt(starts, best[0].at), lineAt(starts, best.at(-1).at)];
    const near = lines.slice(Math.max(0, a - 6), a + 1).some((l) => SCALE_LABEL.test(l));
    return field(best.map(({ letter, min }) => [letter, Math.round(min * 100) / 100]), near ? 'sure' : 'check', clean(lines.slice(a, b + 1).join(' · ')).slice(0, 300));
  };
  const lineAt = (starts, i) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= i) k++; return k; };

  // ---- weights by category ----------------------------------------------------------------------------------------
  // Consecutive "Homework 20%" (or "20% Homework") that add up to 100.
  const WEIGHT_LABEL = any('grading|grades?|weights?|weighting|evaluation|assessment|course grade|bewertung|gewichtung|leistungsnachweis|evaluación|ponderación|calificación|évaluation|pondération|notation|beoordeling|weging|toetsing|avaliação|ponderação');
  const weights = (s, lines, starts) => {
    const fit = (pairs) => {
      for (let i = 0; i < pairs.length; i++) {
        let sum = 0;
        for (let j = i; j < pairs.length && sum < 100.5; j++) {
          sum += pairs[j].weight;
          if (Math.abs(sum - 100) < 0.6 && j > i) return pairs.slice(i, j + 1);
        }
      }
      return [];
    };
    const t = s.replace(/\(\s*(\d{1,3}(?:[.,]\d+)?)\s*%\s*\)/g, ' $1%').replace(/\([^)\n]*%[^)\n]*\)/g, (x) => ' '.repeat(x.length));
    const tidy = (x) => clean(x.replace(/\s*\([^)]*\)?/g, ' ')).replace(/^(?:and|und|y|e|et|en|the|die|der|das|le|la|les|el|los|las|o|os|a|as|de|het)\s+/i, '')
      .replace(/\s*(?:(?:is|are)\s+)?(?:worth|counts?(?:\s+for)?|accounts?\s+for|weighted\s+at|zählt|vale|cuenta|compte pour|telt voor|representa|=)\s*$/i, '').trim().slice(0, 60);
    const forward = [...t.matchAll(/(\p{L}[\p{L}\p{M}\d &/'’.,()-]{1,60}?)[ \t]*[:\t=–-]?[ \t]*(\d{1,3}(?:[.,]\d+)?)[ \t]*%/gu)]
      .map((m) => ({ name: tidy(m[1]), weight: n(m[2]), at: m.index })).filter((p) => p.name && /\p{L}{2}/u.test(p.name));
    const backward = [...t.matchAll(/(\d{1,3}(?:[.,]\d+)?)[ \t]*%[ \t]*\n?[ \t]*[:\t–-]?[ \t]*(\p{Lu}[\p{L}\p{M}\d &/'’-]{2,40})/gu)]
      .map((m) => ({ name: tidy(m[2]), weight: n(m[1]), at: m.index })).filter((p) => p.name);
    let best = fit(forward);
    if (!best.length) best = fit(backward);
    if (!best.length) return field();
    const [a, b] = [lineAt(starts, best[0].at), lineAt(starts, best.at(-1).at)];
    const near = lines.slice(Math.max(0, a - 6), a + 1).some((l) => WEIGHT_LABEL.test(l));
    return field(best.map(({ name, weight }) => ({ name, weight })), near ? 'sure' : 'check', clean(lines.slice(a, b + 1).join(' · ')).slice(0, 300));
  };

  // ---- everything -------------------------------------------------------------------------------------------------
  // text: the syllabus as plain text. opts.start: when the course's term starts (ms; defaults to now), for dates without
  // a year; opts.md: numeric dates are month first (US English). → { prof, hours, meetings, dates, scale, weights }.
  const extract = (text, opts = {}) => {
    const s = norm(text).slice(0, 400000);
    const lines = s.split('\n');
    const starts = [];
    for (let i = 0, k = 0; k < lines.length; k++) { starts.push(i); i += lines[k].length + 1; }
    const o = { start: Number.isFinite(opts.start) ? opts.start : Date.now(), md: !!opts.md };
    const all = scan(lines);
    return {
      prof: professor(lines),
      hours: all.filter((m) => m.hours).map(({ hours, ...m }) => m),
      meetings: all.filter((m) => !m.hours).map(({ hours, ...m }) => m),
      dates: dateRows(lines, o),
      scale: scale(s, lines, starts),
      weights: weights(s, lines, starts),
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
  const okDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
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
  // A To Do task's id for a date from a syllabus: the same date and title make the same task, so saving again updates it.
  const taskId = (cid, d) => {
    let h = 0x811c9dc5;
    for (const c of `${d.day}|${d.title}`) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
    return `syl-${cid}-${h.toString(36)}`;
  };

  return { DAYS, norm, days, times, meetings, extract, parseWeights, weightsText, key, KEY, tidy, taskId };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_SYLLABUS; else GZ_SYLLABUS;
