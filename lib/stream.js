// Only deadline events borrow their due date. An announcement about an assignment is still an announcement.
var GZ_STREAM = globalThis.GZ_STREAM || (() => {
  const P = typeof GZ_PAGE !== 'undefined' ? GZ_PAGE : require('./page.js');
  const json = (text) => { try { return JSON.parse(text); } catch { return null; } };
  const deadline = (type) => /(?:^|:)(?:DUE|OVERDUE)$/i.test(type || '');
  const encouragement = (meta) => meta?.streamType === 'bb_tel:stu_grade' && meta.notificationType === 'GradeIncreased';
  const date = (values, locale = 'en', relative = false, now = new Date()) => {
    if (typeof values?.datetime !== 'string' || !values.datetime.trim()) return null;
    const read = P.read(values.datetime, locale, now);
    if (!read || !Number.isFinite(read.at.getTime())) return null;
    let { at, timed } = read;
    // The shared US parser expects AM/PM; Blackboard can also render a 24-hour clock.
    // Reject invalid clock fields instead of allowing Date to roll the deadline into another day.
    const clock = /(?:^|[\s,])(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(values.datetime);
    if (clock && /^en(?:-US)?$/i.test(locale)) {
      const [, h, m, period] = clock;
      if (+m > 59 || +h > (period ? 12 : 23) || (period && +h < 1)) return null;
      if (!timed) { at.setHours(+h, +m, 0, 0); timed = true; }
    }
    const full = `${values.datetime}${values.timezone ? ` (${values.timezone})` : ''}`;
    // Ultra writes viewer-local wall time. If its zone differs from the browser's, keep the exact date;
    // guessing an offset from an ambiguous abbreviation could move a deadline to the wrong day.
    const zone = relative && values.timezone && new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    const relativeOK = !values.timezone || values.timezone === zone;
    const label = relative && relativeOK ? P.describe(at, timed, now, locale).rel
      : at.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() && { year: 'numeric' }) });
    return { label, full };
  };
  return { json, deadline, encouragement, date };
})();
if (typeof module !== 'undefined') module.exports = GZ_STREAM;
