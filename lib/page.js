// Reading meaning out of Ultra's text, for the extras. Pure, so node can test it.
// Classic script for the content script; module.exports for node.
const GZ_PAGE = (() => {
  const I = typeof GZ_I18N !== 'undefined' ? GZ_I18N : require('./i18n.js');
  // Ultra's US-locale due dates: "Due date: 10/18/26, 11:59 PM (EDT)", "Due: 10/4/26 11:59 PM".
  // The time zone label is ignored: Ultra writes dates in the viewer's own zone. Other locales are
  // read by read() below, and need a time. x is that text, or a Date from Ultra's data.
  const DUE = /\bdue(?: date)?:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
  const DAY = 864e5;
  const us = (locale) => !locale || /^en(-us)?$/i.test(locale);
  const due = (x, now = new Date(), locale) => {
    let at = x instanceof Date ? x : null;
    if (!at && us(locale)) {
      const m = DUE.exec(x);
      if (!m) return null;
      let [, mo, d, y, h, mi, ap] = m;
      y = +y < 100 ? 2000 + +y : +y;
      h = (+h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0);
      at = new Date(y, mo - 1, +d, h, +mi);
    } else if (!at) {
      const r = read(x, locale, now);
      at = r?.timed ? r.at : null;
    }
    if (!at || Number.isNaN(at.getTime())) return null;
    if (at < now) return 'overdue';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (at < new Date(today.getTime() + DAY)) return 'today';
    if (at < new Date(today.getTime() + 4 * DAY)) return 'soon';
    return null;
  };

  // A grade pill's "got / possible" as a 0-1 share and a band for the bar colour.
  const score = (got, max) => {
    got = parseFloat(got);
    max = parseFloat(max);
    if (!(max > 0) || Number.isNaN(got)) return null;
    const ratio = Math.min(1, Math.max(0, got / max));
    return { ratio, band: ratio >= 0.9 ? 'hi' : ratio >= 0.7 ? 'mid' : 'lo' };
  };

  // How far off a moment is, in words: { rel: 'in 2 days', sub: 'Tuesday, October 13 at 11:59 PM' }, in
  // lang where Glaze speaks it (lib/i18n.js), else English.
  const rtfs = new Map();
  const describe = (at, timed, now = new Date(), tag = 'en') => {
    const lang = I.locale(tag);
    if (!rtfs.has(lang)) rtfs.set(lang, new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }));
    const rtf = rtfs.get(lang);
    const startOf = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const days = Math.round((startOf(at) - startOf(now)) / DAY);
    let rel;
    if (days === 0 && timed) {
      const hours = Math.round((at - now) / 36e5);
      rel = hours === 0 ? rtf.format(Math.round((at - now) / 6e4), 'minute') : rtf.format(hours, 'hour');
    } else if (Math.abs(days) < 7) rel = rtf.format(days, 'day');
    else if (Math.abs(days) < 60) rel = rtf.format(Math.round(days / 7), 'week');
    else rel = rtf.format((at.getFullYear() - now.getFullYear()) * 12 + at.getMonth() - now.getMonth(), 'month');
    const sub = at.toLocaleString(lang, { weekday: 'long', month: 'long', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() && { year: 'numeric' }), ...(timed && { hour: 'numeric', minute: '2-digit' }) }).replace(/, (?=\d+:)/, /^en\b/.test(lang) ? ' at ' : ', ');
    return { rel, sub };
  };

  // A date in Ultra's text, with or without a time: { at, timed } or null. en-US reads M/D/YY and a
  // 12-hour time, as Glaze always has. Elsewhere Ultra writes CLDR's short date and time, as Intl does,
  // but its CLDR and the browser's differ here and there (2- or 4-digit years, 12- or 24-hour clocks),
  // so only the order of day, month and year comes from Intl and the rest is read loosely: the
  // locale's digits, . / - 年 月 between numbers (年 always after the year), month names, a time
  // after the date (before it where the locale puts it first), and the locale's AM/PM on either side
  // of the time. Gregorian dates only.
  const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i;
  const NUM = /(?<!\d)(\d{1,4})\s*[./\-年月년월]\s*(\d{1,2})\s*[./\-年月년월]\s*(\d{1,4})(?!\d)/g;
  const TIME = /^(\D{0,15}?)(\d{1,2})\s*[:.h]\s*(\d{2})(?!\d|[./-]\d)/;
  const TIME_FIRST = /(?<![\d./-])()(\d{1,2})\s*[:.h]\s*(\d{2})(?=\D{0,15}$)/;
  const MARKS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const squeeze = (t) => t.toLowerCase().replace(/[\s.]/g, '');
  const formats = new Map();
  const formatOf = (locale) => {
    if (formats.has(locale)) return formats.get(locale);
    const parts = (o, at) => new Intl.DateTimeFormat(locale, o).formatToParts(at);
    const order = (o) => parts(o, new Date(2006, 10, 22)).map((p) => p.type).filter((t) => t === 'day' || t === 'month' || t === 'year');
    // Every word the locale has for a time of day ("PM", "下午", "晚上"), as morning or afternoon.
    const am = new Set(['am']);
    const pm = new Set(['pm']);
    for (let h = 0; h < 24; h++) {
      for (const o of [{ hour: 'numeric', hour12: true }, { timeStyle: 'short', hour12: true }]) {
        const p = parts(o, new Date(2006, 0, 1, h, 30)).find((x) => x.type === 'dayPeriod');
        if (p) (h < 12 ? am : pm).add(squeeze(p.value));
      }
    }
    const months = new Map();
    for (let i = 0; i < 12; i++) {
      for (const month of ['long', 'short']) {
        const name = parts({ month, day: 'numeric' }, new Date(2006, i, 15)).find((p) => p.type === 'month').value.replace(/\.$/, '').toLowerCase();
        if (!/\d/.test(name)) months.set(name, i);
      }
    }
    const names = [...months.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
    const text = order({ day: 'numeric', month: 'long', year: 'numeric' });
    const dayFirst = text.indexOf('day') < text.indexOf('month');
    // The locale's own digits, and Arabic's either way: Ultra writes ar-SA's even where Intl doesn't.
    const digits = new Map();
    for (const numberingSystem of [undefined, 'arab', 'arabext']) {
      const nf = new Intl.NumberFormat(locale, { numberingSystem, useGrouping: false });
      for (let d = 0; d < 10; d++) digits.set(nf.format(d), String(d));
    }
    const f = {
      num: order({ dateStyle: 'short' }),
      timeFirst: parts({ dateStyle: 'short', timeStyle: 'short' }, new Date(2006, 10, 22)).findIndex((p) => p.type === 'hour') === 0,
      digits,
      months,
      dayFirst,
      // "18. Oktober 2026", "18 de out. de 2026", "18 באוק׳ 2026", "Oct 18, 2026": a short word may
      // sit between the parts.
      named: names && new RegExp(dayFirst
        ? `(?<!\\d)(\\d{1,2})\\.?\\s*(?:\\p{L}{1,3}\\s*?)?(${names})(?!\\p{L})\\.?(?:[\\s,]*(?:\\p{L}{1,3}\\s+)?(\\d{4}))?`
        : `(?<!\\p{L})(${names})(?!\\p{L})\\.?\\s*(\\d{1,2})(?!\\d)(?:,?\\s*(\\d{4}))?`, 'iu'),
      am: [...am].filter((p) => !pm.has(p)),
      pm: [...pm].filter((p) => !am.has(p)),
    };
    formats.set(locale, f);
    return f;
  };
  const read = (text, locale, now = new Date()) => {
    if (us(locale)) {
      const m = DATE.exec(text || '');
      if (!m) return null;
      let [, mo, d, y, h, mi, ap] = m;
      y = +y < 100 ? 2000 + +y : +y;
      const timed = h !== undefined;
      const at = timed ? new Date(y, mo - 1, +d, (+h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0), +mi) : new Date(y, mo - 1, +d);
      if (at.getMonth() !== mo - 1) return null; // 2/30 and friends roll over; not a real date
      return { at, timed };
    }
    let f;
    try { f = formatOf(locale); } catch { return null; } // a locale Intl doesn't know
    const t = (text || '').replace(MARKS, '').replace(/\S/gu, (c) => f.digits.get(c) || c);
    let y;
    let mo;
    let d;
    let start;
    let end;
    for (const m of t.matchAll(NUM)) {
      const v = Object.fromEntries((/[年년]/.test(m[0]) ? ['year', 'month', 'day'] : f.num).map((k, i) => [k, m[i + 1]]));
      if (!/^(\d{2}|\d{4})$/.test(v.year) || v.day.length > 2 || v.month.length > 2) continue;
      [y, mo, d, start, end] = [+v.year, v.month - 1, +v.day, m.index, m.index + m[0].length];
      break;
    }
    const n = end === undefined && f.named && f.named.exec(t);
    if (n) [d, mo, y, start, end] = [+n[f.dayFirst ? 1 : 2], f.months.get(n[f.dayFirst ? 2 : 1].toLowerCase()), n[3] ? +n[3] : now.getFullYear(), n.index, n.index + n[0].length];
    if (end === undefined) return null;
    if (y < 100) y += 2000;
    let h = 0;
    let mi = 0;
    const base = f.timeFirst ? 0 : end;
    const tm = f.timeFirst ? TIME_FIRST.exec(t.slice(0, start)) : TIME.exec(t.slice(end));
    if (tm) {
      [h, mi] = [+tm[2], +tm[3]];
      const i = base + tm.index + tm[1].length; // where the time starts and ends
      const k = base + tm.index + tm[0].length;
      const before = squeeze(t.slice(Math.max(0, i - 12), i));
      const after = squeeze(t.slice(k, k + 12));
      const is = (ps) => ps.some((p) => before.endsWith(p) || after.startsWith(p));
      if (h < 12 && is(f.pm)) h += 12;
      else if (h === 12 && is(f.am)) h = 0;
    }
    const at = new Date(y, mo, d, h, mi);
    if (at.getMonth() !== mo || at.getDate() !== d || h > 23 || mi > 59) return null;
    return { at, timed: !!tm };
  };

  // A hover hint for a date: { title, sub, rel, past } or null, in Ultra's language. x is Ultra's text in
  // its locale, or a Date from its data. isDue: whether it's a due date; English text says so itself.
  // "Due date: 10/13/26, 11:59 PM" → { title: 'Due in 2 days', sub: 'Tuesday, October 13 at 11:59 PM', rel: 'in 2 days', past: false }
  const when = (x, now = new Date(), locale, isDue = typeof x === 'string' && /\bdue\b/i.test(x)) => {
    const m = x instanceof Date ? !Number.isNaN(x.getTime()) && { at: x, timed: true } : read(x, locale, now);
    if (!m) return null;
    const { rel, sub } = describe(m.at, m.timed, now, locale);
    const past = !(m.at > now);
    const title = isDue ? I.t(past ? 'Was due {when}' : 'Due {when}', { when: rel }, locale) : rel[0].toLocaleUpperCase(I.locale(locale)) + rel.slice(1);
    return { title, sub, rel, past };
  };

  // The gradebook's record for each content item, from Ultra's gradebook/grades?expand=column. Columns
  // with no content item (external tools, totals) are left out.
  const gradesByContent = (results) => new Map((results || []).filter((g) => g.column?.contentId).map((g) => [g.column.contentId, g]));

  // The course's overall grade, from the same answer: the column marked as the course's external grade,
  // unless it's hidden from students. As Ultra's Grades page writes it, a percentage cut (not rounded) to
  // two places (in Ultra's language), or a letter where the gradebook gives one. { label, tone } in the
  // chips' bands, or null.
  const overall = (results, locale) => {
    const g = (results || []).find((r) => r.column?.externalGrade);
    if (!g || g.column.visible === false || g.column.visibleInBook === false || !score(g.effectiveScore, g.pointsPossible)) return null;
    const pct = Math.floor((g.effectiveScore / g.pointsPossible) * 1e4 + 1e-6) / 100;
    return { label: g.displayGrade?.text || I.pct(pct, locale), tone: `graded-${score(pct, 100).band}` };
  };

  // The same on Canvas, from its course list with ?include[]=total_scores, current_grading_period_scores and
  // restrict_quantitative_data (/api/v1/courses): each course's current score as the student's enrollment gives it
  // (ungraded work left out, as on Canvas's Grades page), a percentage or the letter where the course grades in
  // letters, in the same chips' bands: { courseId: { label, tone } }. Picked as Canvas's own grades display picks
  // them (transformApiToInternalGrade and GradesDisplay in its ui/shared/planner): a course with grading periods
  // shows the current period's; a course that restricts quantitative data shows only the letter Canvas gives it,
  // never a number. Courses that hide final grades or have no score yet (or no letter, restricted) are left out.
  const canvasOverall = (courses, locale) => Object.fromEntries((Array.isArray(courses) ? courses : []).flatMap((c) => {
    const e = c?.enrollments?.find((x) => x.type === 'student');
    if (!e || c.hide_final_grades) return [];
    const [pct, grade] = c.has_grading_periods ? [e.current_period_computed_current_score, e.current_period_computed_current_grade] : [e.computed_current_score, e.computed_current_grade];
    const sc = typeof pct === 'number' && score(pct, 100);
    const label = c.restrict_quantitative_data ? e.computed_current_letter_grade : grade || I.pct(pct, locale);
    return sc && label ? [[String(c.id), { label, tone: `graded-${sc.band}` }]] : [];
  }));

  // Done: graded, submitted (needs grading), exempt, or Ultra's progress circle full.
  const isDone = (circle, grade) => circle === 'true' || !!grade?.isExempt || grade?.status === 'GRADED' || grade?.status === 'NEEDS_GRADING';

  // The chip beside a due date in course content: where the work stands, then when it's due.
  // circle: Ultra's progress circle ('false' empty, 'mixed' half, 'true' full), or null where the course
  // doesn't track progress. grade: the gradebook's record, null if the item has no column, undefined while
  // unknown. late: handed in after the due date (lib/grades.js). Returns { label, tone }, or null when
  // there's nothing reassuring or useful to say: a past date whose status is unknown is left alone
  // rather than shown as "2 weeks ago". date: the due date, as Ultra's text or a Date. Words in Ultra's
  // language.
  const status = (date, circle, grade, now = new Date(), late = false, locale) => {
    const w = when(date, now, locale, true);
    if (!w) return null;
    const t = (k, v) => I.t(k, v, locale);
    const { past } = w;
    if (grade?.isExempt) return { label: t('Exempt'), tone: 'muted' };
    if (grade?.status === 'GRADED') {
      const d = grade.displayGrade || {};
      const n = (x) => I.num(+(+x).toFixed(2), locale);
      const sc = d.score != null && score(d.score, grade.pointsPossible);
      const mark = d.text || (sc ? `${n(d.score)}/${n(grade.pointsPossible)}` : '');
      return { label: mark ? t('Graded · {mark}', { mark }) : t('Graded'), tone: sc ? `graded-${sc.band}` : 'done' };
    }
    if (grade?.status === 'NEEDS_GRADING' && late) return { label: t('Submitted late'), tone: 'late' };
    if (isDone(circle, grade)) {
      const label = t(grade?.status === 'NEEDS_GRADING' ? 'Submitted' : 'Done');
      return { label: past ? label : t('{status} · due {when}', { status: label, when: w.rel }), tone: 'done' };
    }
    const where = circle === 'mixed' ? t('Opened') : circle === 'false' ? t('Unopened') : grade ? t('Not submitted') : '';
    if (past) return where ? { label: t('Past due · {status}', { status: where }), tone: 'overdue' } : null;
    // Upcoming: "Not submitted" says nothing yet, so only the circle's word joins the countdown.
    return { label: circle ? `${w.rel} · ${where}` : w.rel, tone: due(date, now, locale) || 'later' };
  };

  // Focus mode: minutes to read a document's text at 230 words a minute (0 under half a minute), and how
  // far down its scroller the reader is, 0-1.
  const readMinutes = (text) => {
    const words = (text || '').split(/\s+/).filter(Boolean).length;
    return Math.round(words / 230);
  };
  const readShare = (top, height, client) => (height > client ? Math.min(1, Math.max(0, top / (height - client))) : 1);

  // A folder's or module's completion line, in any of Ultra's languages ("3 of 7 completed", "7 件中 3 件が
  // 完了済み", "تم إكمال ٣ من أصل ٧"): { done, total } or null. Each writes two numbers, the total the larger.
  // someDone: Ultra marks some done (its check, or the chart's completed part); its "N of M started" means none.
  const completion = (text, someDone) => {
    const n = (text || '').replace(/[٠-٩۰-۹]/g, (c) => c.charCodeAt(0) & 15).match(/\d+/g)?.map(Number);
    return n?.length === 2 ? { done: someDone ? Math.min(...n) : 0, total: Math.max(...n) } : null;
  };

  // The files a content item from Ultra's content API carries: a File item's own, and those a document
  // block links in its text (anchors with data-bbfile on a /bbcswebdav/ address of `origin`; videos and
  // tool links have neither). [{ url, name, size }], size when Ultra knows it.
  const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'" };
  const unescape = (s) => s.replace(/&(quot|amp|lt|gt|apos|#39);/g, (_, e) => ENT[e]);
  const files = (item, origin) => {
    const out = [];
    const own = item?.contentDetail?.['resource/x-bb-file']?.file;
    if (own?.permanentUrl) out.push({ url: origin + own.permanentUrl, name: own.fileName, size: own.fileSize });
    for (const [tag] of (item?.body?.rawText || '').matchAll(/<a\s[^>]*>/gi)) {
      const attr = (n) => { const m = tag.match(new RegExp(`\\s${n}="([^"]*)"`, 'i')); return m ? unescape(m[1]) : ''; };
      try {
        const bf = JSON.parse(attr('data-bbfile'));
        const url = new URL(attr('href'), origin);
        if (url.origin !== origin || !url.pathname.startsWith('/bbcswebdav/')) continue;
        out.push({ url: url.href, name: bf.fileName || bf.linkName || bf.displayName || decodeURIComponent(url.pathname.split('/').pop()), size: bf.fileSize });
      } catch { /* not a file link */ }
    }
    return out;
  };

  // How well a typed query matches a label, for the command palette: higher is better, -1 is no
  // match. Every typed letter must appear in order; runs, word starts and an early start score more.
  // Spaces separate words that can match anywhere after the last.
  const fuzzy = (query, text) => {
    const q = query.toLowerCase().trim();
    const t = text.toLowerCase();
    if (!q) return 0;
    // The query whole: at the start, at a word start, anywhere.
    let score = t.startsWith(q) ? 20 : ` ${t.replace(/[^a-z0-9]+/g, ' ')}`.includes(` ${q}`) ? 15 : t.includes(q) ? 10 : 0;
    let at = 0;
    let run = 0;
    for (const ch of q) {
      if (ch === ' ') { run = 0; continue; }
      const i = t.indexOf(ch, at);
      if (i < 0) return -1;
      run = i === at && at > 0 ? run + 1 : 0;
      score += 1 + run * 2 + (i === 0 || /[^a-z0-9]/.test(t[i - 1]) ? 3 : 0) - Math.min(i - at, 6) * 0.25;
      at = i + 1;
    }
    return score - t.length * 0.01;
  };

  // Canvas's "Complete One Item" alternatives together count as one requirement.
  const canvasProgress = (mods) => {
    if (mods.length >= 100 || mods.some((m) => !Array.isArray(m.items))) return null;
    let done = 0, total = 0;
    for (const m of mods) {
      const cr = m.items.map((i) => i.completion_requirement).filter(Boolean);
      const n = cr.filter((c) => c.completed).length;
      const one = m.requirement_type === 'one';
      total += one ? Math.min(1, cr.length) : cr.length;
      done += one ? Math.min(1, n) : n;
    }
    return { done, total };
  };

  // Where you were in each course's content (storage.local coursePlace): { cid: { open: [folder ids],
  // top, item?, at } }. `all` with course `cid` set to { open, top, item } at `now`: the 30 courses most
  // recently left kept, each with its last 100 open folders. `item` is Canvas's: the module item last opened.
  const place = (all, cid, { open, top, item }, now) => {
    const out = { [cid]: { open: [...new Set(open)].filter((id) => /^_\d+_\d+$/.test(id)).slice(-100), top: Math.max(0, Math.round(top) || 0), ...(/^\d+$/.test(item) && { item }), at: now } };
    const rest = Object.entries(all || {}).filter(([k, v]) => k !== cid && v?.at > 0).sort((a, b) => b[1].at - a[1].at).slice(0, 29);
    return Object.assign(out, Object.fromEntries(rest));
  };

  // Only audited reading/global pages: discussions own g/c; Files, quizzes and gradebooks have their own keys.
  const canvasKeys = (path) => /^(?:\/(?:courses|calendar|conversations|grades)?\/?|\/courses\/\d+(?:\/?|\/(?:pages\/[^/]+|assignments\/\d+)\/?))$/.test(path) && !/\/pages\/(?:new|edit)$/.test(path);

  return { due, score, read, when, describe, gradesByContent, overall, canvasOverall, canvasProgress, isDone, status, fuzzy, files, readMinutes, readShare, completion, place, canvasKeys };
})();

if (typeof module !== 'undefined') module.exports = GZ_PAGE;
