// Moodle's data, read: what its own dashboard asks of /lib/ajax/service.php, and its server-rendered grades overview.
// Pure, so node can test it. Classic script for the content script; module.exports for node.
// Loaded on demand (content.js moodleIn), before features/moodle.js: a second injection into the same frame keeps the first.
var GZ_MOODLE = globalThis.GZ_MOODLE || (() => {
  // A request to service.php, as Moodle's own pages send it, and its answer: [{ error, data, exception }].
  const call = (methodname, args) => [{ index: 0, methodname, args }];
  const answer = (j) => {
    const r = Array.isArray(j) ? j[0] : null;
    if (!r || r.error || !r.data) throw new Error(r?.exception?.errorcode || 'no answer');
    return r.data;
  };

  // An address Moodle gave, as a path on this site (origin), or null: nothing leaves the site it was found on.
  const here = (url, origin) => {
    try { const u = new URL(url); return u.origin === origin ? u.pathname + u.search + u.hash : null; } catch { return null; }
  };

  // What is left to do from `now` to a week on, soonest first, from the Timeline's events
  // (core_calendar_get_action_events_by_timesort: { events: [{ name, activityname, timesort (s), url, course: { id,
  // shortname, viewurl } }] }), in the shape of Canvas's list (defaults.js GZ_CANVAS_DUE_WEEK):
  // [{ title, cid, due (ms), course (name), url (a path) }]. Moodle leaves out what is handed in or done already.
  const due = (data, now, origin) => (Array.isArray(data?.events) ? data.events : [])
    .map((e) => ({
      title: String(e?.activityname || e?.name || '').slice(0, 200),
      cid: String(e?.course?.id ?? ''),
      due: Number(e?.timesort) * 1000,
      course: String(e?.course?.shortname || e?.course?.fullname || '').slice(0, 80),
      url: here(e?.url, origin) || here(e?.course?.viewurl, origin),
    }))
    .filter((i) => i.title && /^\d+$/.test(i.cid) && i.url && i.due >= now && i.due < now + 7 * 864e5)
    .sort((a, b) => a.due - b.due);

  // The student's courses (core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id, fullname,
  // shortname, viewurl }] }): [{ id, name, code, url (a path) }].
  const courses = (data, origin) => (Array.isArray(data?.courses) ? data.courses : [])
    .map((c) => ({ id: String(c?.id ?? ''), name: String(c?.fullname || c?.shortname || ''), code: String(c?.shortname || ''), url: here(c?.viewurl, origin) }))
    .filter((c) => /^\d+$/.test(c.id) && c.name && c.url);

  // Moodle's own color for a course, the one its card draws: the background of the pattern it makes for a course with no
  // picture of its own (an SVG data: address, its rect filled with the site's course color for that id), else Moodle's
  // default for that id (Appearance > Course card colours; a site that changed them shows its picture's anyway).
  const PALETTE = ['#81ecec', '#74b9ff', '#a29bfe', '#dfe6e9', '#00b894', '#0984e3', '#b2bec3', '#fdcb6e', '#fd79a8', '#6c5ce7'];
  const color = (c) => {
    let svg = '';
    try { svg = atob(String(c?.courseimage).match(/^data:image\/svg\+xml;base64,([\w+/=]+)$/)?.[1] || ''); } catch { /* not base64 */ }
    const rgb = svg.match(/<rect\b[^>]*\bfill="rgb\((\d{1,3}), ?(\d{1,3}), ?(\d{1,3})\)"/);
    return rgb ? `#${rgb.slice(1).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')}` : PALETTE[c.id % 10];
  };
  // The courses as Glaze keeps them (storage.local seenCourses: the editor's list, the course menu, the tint), from the
  // same answer as courses(): { key: { name, code, moodle: true, color } }, key(id) naming each (content.js's course key).
  const seen = (data, key) => Object.fromEntries((Array.isArray(data?.courses) ? data.courses : [])
    .filter((c) => /^\d+$/.test(String(c?.id)) && key(c.id) && text(c.fullname || c.shortname))
    .map((c) => [key(c.id), { name: text(c.fullname || c.shortname).slice(0, 80), code: text(c.shortname).slice(0, 80), moodle: true, color: color(c) }]));

  // Text out of a bit of server HTML: tags gone, entities decoded, spaces squeezed.
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const code = (n) => (n <= 0x10ffff ? String.fromCodePoint(n) : '');
  const text = (h) => String(h || '').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]{1,6}|#\d{1,7}|\w+);/gi, (m, e) => (e[0] === '#' ? code(/x/i.test(e[1]) ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').trim();

  // Each course's total as Moodle's grades overview (/grade/report/overview/index.php) shows it to the student: { courseId:
  // text }. A row names its course by the link to that course's grades (/course/user.php?mode=grade&id=…, or
  // /grade/report/user/index.php?id=…), then the total, formatted as the course has it: points ("176.00"), a percentage
  // ("85.00 %"), a letter ("B+") or two of those ("85.00 % (B+)"), in the student's language. "-" is no grade yet; a
  // course whose grades the student can't open has no link, and is left out. Read row by row, so a row Moodle draws
  // differently costs only itself.
  const overview = (html) => {
    const out = {};
    for (const [row] of String(html || '').matchAll(/<tr\b[\s\S]*?<\/tr>/gi)) {
      const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      const id = cells[0]?.match(/href="[^"]*\/(?:course\/user\.php|grade\/report\/user\/index\.php)\?[^"]*?\bid=(\d+)/)?.[1];
      const total = text(cells[1]);
      if (id && total && total !== '-' && total.length <= 40) out[id] = total;
    }
    return out;
  };

  // A total's chip: { label, pct } where it says a percentage (85.00 % or 85,00 %), its share for the chips' bands.
  const grade = (total) => {
    const m = String(total).match(/(\d+(?:[.,]\d+)?)\s*%/);
    return { label: String(total), pct: m ? Math.min(100, Math.max(0, parseFloat(m[1].replace(',', '.')))) : null };
  };

  return { call, answer, here, due, courses, seen, text, overview, grade };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_MOODLE; else GZ_MOODLE;
