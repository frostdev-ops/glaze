// Reading meaning out of Ultra's text, for the extras. Pure, so node can test it.
// Classic script for the content script; module.exports for node.
const GZ_PAGE = (() => {
  // Ultra's US-locale due dates: "Due date: 10/18/26, 11:59 PM (EDT)", "Due: 10/4/26 11:59 PM".
  // Other locales don't match and are left alone. The time zone label is ignored: Ultra writes
  // dates in the viewer's own zone.
  const DUE = /\bdue(?: date)?:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
  const DAY = 864e5;
  const due = (text, now = new Date()) => {
    const m = DUE.exec(text);
    if (!m) return null;
    let [, mo, d, y, h, mi, ap] = m;
    y = +y < 100 ? 2000 + +y : +y;
    h = (+h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0);
    const at = new Date(y, mo - 1, +d, h, +mi);
    if (Number.isNaN(at.getTime())) return null;
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

  // How far off a moment is, in words: { rel: 'in 2 days', sub: 'Tuesday, October 13 at 11:59 PM' }.
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const describe = (at, timed, now = new Date()) => {
    const startOf = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const days = Math.round((startOf(at) - startOf(now)) / DAY);
    let rel;
    if (days === 0 && timed) {
      const hours = Math.round((at - now) / 36e5);
      rel = hours === 0 ? rtf.format(Math.round((at - now) / 6e4), 'minute') : rtf.format(hours, 'hour');
    } else if (Math.abs(days) < 7) rel = rtf.format(days, 'day');
    else if (Math.abs(days) < 60) rel = rtf.format(Math.round(days / 7), 'week');
    else rel = rtf.format((at.getFullYear() - now.getFullYear()) * 12 + at.getMonth() - now.getMonth(), 'month');
    const sub = at.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() && { year: 'numeric' }), ...(timed && { hour: 'numeric', minute: '2-digit' }) }).replace(/, (?=\d+:)/, ' at ');
    return { rel, sub };
  };

  // A hover hint for any M/D/YY date, with or without a time: { title, sub, rel } or null.
  // "Due date: 10/13/26, 11:59 PM" → { title: 'Due in 2 days', sub: 'Tuesday, October 13 at 11:59 PM', rel: 'in 2 days' }
  const DATE = /(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/i;
  const when = (text, now = new Date()) => {
    const m = DATE.exec(text || '');
    if (!m) return null;
    let [, mo, d, y, h, mi, ap] = m;
    y = +y < 100 ? 2000 + +y : +y;
    const timed = h !== undefined;
    const at = timed ? new Date(y, mo - 1, +d, (+h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0), +mi) : new Date(y, mo - 1, +d);
    if (at.getMonth() !== mo - 1) return null; // 2/30 and friends roll over; not a real date
    const { rel, sub } = describe(at, timed, now);
    const due = /\bdue\b/i.test(text);
    const title = due ? `${at > now ? 'Due' : 'Was due'} ${rel}` : rel[0].toUpperCase() + rel.slice(1);
    return { title, sub, rel };
  };

  // The gradebook's record for each content item, from Ultra's gradebook/grades?expand=column. Columns
  // with no content item (external tools, totals) are left out.
  const gradesByContent = (results) => new Map((results || []).filter((g) => g.column?.contentId).map((g) => [g.column.contentId, g]));

  // Done: graded, submitted (needs grading), exempt, or Ultra's progress circle full.
  const isDone = (circle, grade) => circle === 'true' || !!grade?.isExempt || grade?.status === 'GRADED' || grade?.status === 'NEEDS_GRADING';

  // The chip beside a due date in course content: where the work stands, then when it's due.
  // circle: Ultra's progress circle ('false' empty, 'mixed' half, 'true' full), or null where the course
  // doesn't track progress. grade: the gradebook's record, null if the item has no column, undefined while
  // unknown. Returns { label, tone }, or null when there's nothing reassuring or useful to say: a past
  // date whose status is unknown is left alone rather than shown as "2 weeks ago".
  const status = (text, circle, grade, now = new Date()) => {
    const w = when(text, now);
    if (!w) return null;
    const past = w.title.startsWith('Was due'); // the caller's text always says "due"
    if (grade?.isExempt) return { label: 'Exempt', tone: 'muted' };
    if (grade?.status === 'GRADED') {
      const d = grade.displayGrade || {};
      const n = (x) => +(+x).toFixed(2);
      const sc = d.score != null && score(d.score, grade.pointsPossible);
      const mark = d.text || (sc ? `${n(d.score)}/${n(grade.pointsPossible)}` : '');
      return { label: mark ? `Graded · ${mark}` : 'Graded', tone: sc ? `graded-${sc.band}` : 'done' };
    }
    if (isDone(circle, grade)) {
      const label = grade?.status === 'NEEDS_GRADING' ? 'Submitted' : 'Done';
      return { label: past ? label : `${label} · due ${w.rel}`, tone: 'done' };
    }
    const where = circle === 'mixed' ? 'Opened' : circle === 'false' ? 'Unopened' : grade ? 'Not submitted' : '';
    if (past) return where ? { label: `Past due · ${where}`, tone: 'overdue' } : null;
    // Upcoming: "Not submitted" says nothing yet, so only the circle's word joins the countdown.
    return { label: circle ? `${w.rel} · ${where}` : w.rel, tone: due(text, now) || 'later' };
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

  return { due, score, when, describe, gradesByContent, isDone, status, files };
})();

if (typeof module !== 'undefined') module.exports = GZ_PAGE;
