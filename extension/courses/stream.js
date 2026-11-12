// Only deadline events borrow their due date. An announcement about an assignment is still an announcement.
var GZ_STREAM = globalThis.GZ_STREAM || (() => {
  const P = typeof GZ_PAGE !== 'undefined' ? GZ_PAGE : require('../core/page.js');
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
  // The assignment an Activity card names, among the planner's Ultra items (courses/ultra.js due(): id the gradebook column,
  // content its content item, cid its course). Content and column ids have separate namespaces. An explicit destination
  // must agree with every item link; only a card with no item destination can fall back to its title in its course.
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const find = (items, { links = [], title = '', course = '', cid: known = '' } = {}) => {
    const cids = new Set(known ? [known] : []), targets = [];
    for (const href of links) {
      let u;
      try { u = new URL(href, 'https://x.invalid/'); } catch { continue; }
      const m = /^\/ultra\/courses\/(_\d+_\d+)(?=\/|$)/.exec(u.pathname);
      const cid = m?.[1] || (u.pathname.startsWith('/ultra/') && u.searchParams.get('courseId'));
      if (!/^_\d+_\d+$/.test(cid)) continue;
      cids.add(cid);
      const path = m ? u.pathname.slice(m[0].length) : '';
      const column = /^\/grades\/assessment\/(_\d+_\d+)(?:\/|$)/.exec(path);
      // The first item id belongs to the destination; later ids may name attempts or other nested records.
      const content = path.match(/(?:^|\/)(_\d+_\d+)(?:\/|$)/)?.[1] || (u.pathname === '/ultra/redirect' && u.searchParams.get('contentId'));
      if (column || content) targets.push({ cid, field: column ? 'id' : 'content', id: column?.[1] || content });
      else if ([...u.searchParams].some(([k, v]) => k !== 'courseId' && /Id$/.test(k) && /^_\d+_\d+$/.test(v))) return null;
    }
    if (cids.size > 1) return null;
    if (targets.length) {
      const same = items.filter((i) => targets.every((x) => i.cid === x.cid && i[x.field] === x.id));
      return same.length === 1 ? same[0] : null;
    }
    const c = norm(course), mine = items.filter((i) => cids.size ? cids.has(i.cid) : !!c && norm(i.course) === c);
    for (const t of [norm(title), norm(title).replace(/^\p{L}+(?: \p{L}+){0,2}:\s+/u, '')]) {
      const same = t ? mine.filter((i) => norm(i.title) === t) : [];
      if (same.length) return same.length === 1 ? same[0] : null;
    }
    return null;
  };
  return { json, deadline, encouragement, date, find };
})();
if (typeof module !== 'undefined') module.exports = GZ_STREAM; else GZ_STREAM;
