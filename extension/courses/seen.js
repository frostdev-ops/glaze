// What the sites' pages have seen, in storage.local keys the tabs of every site share: the course list (seenCourses), Ultra's
// color slots (courseSlots), and Ultra's seen grades and content (seenGrades, seenContent). A page sends its patch
// ('glaze:seen', background/background.js) and the worker merges one at a time over what is stored: two sites' tabs, whose
// Web Locks never meet, keep each other's entries. Pure, so node can test it.
var GZ_SEEN = globalThis.GZ_SEEN || (() => {
  const KEYS = ['seenCourses', 'courseSlots', 'seenGrades', 'seenContent'];
  const ULTRA_ID = /^_\d+_\d+$/;
  const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  // For a page of `site` ({ kind: canvas, moodle or ultra, origin }): the entries it may set (own), the stored ones drop takes
  // away first (old), and its list's ten-minute gate (at). Moodle's keys start with its root ('moodle:<root>/', m.root), which
  // is the page's origin or a folder of it; Canvas's with its origin; Ultra's are course ids naming their site.
  const scope = (m, { kind, origin }) => {
    if (m.key !== 'seenCourses') return kind === 'ultra' && KEYS.includes(m.key) ? { own: (k, v) => ULTRA_ID.test(k) && (m.key !== 'courseSlots' || /^(10|[1-9])$/.test(v)), old: () => false } : null;
    if (kind === 'ultra') return { own: (k, v) => ULTRA_ID.test(k) && v?.site === origin, old: (k, v) => !k.includes(':') && (!v?.site || v.site === origin), at: `seenCoursesAt ${origin}` };
    const pre = kind === 'canvas' ? `canvas:${origin}/` : kind === 'moodle' && typeof m.root === 'string' && m.root.endsWith('/') && m.root.startsWith(`moodle:${origin}/`) ? m.root : '';
    if (!pre) return null;
    const mine = (k) => k.startsWith(pre) && /^\d{1,20}$/.test(k.slice(pre.length));
    return { own: mine, old: mine, at: kind === 'moodle' ? `seenCoursesAt ${pre}` : '' };
  };
  // m: { key, set: { entry: value }, drop (this site's stored entries go first), stamp (the gate is set now), root }. → the
  // storage patch, or null when the page asked for what isn't its own. An empty set drops nothing.
  const merge = (stored, m, site, now = Date.now()) => {
    const s = plain(m) && plain(m.set) && scope(m, site);
    if (!s || JSON.stringify(m.set).length > 1e6) return null;
    const set = Object.entries(m.set);
    if (set.some(([k, v]) => v == null || (m.key === 'courseSlots' ? typeof v !== 'string' : typeof v !== 'object') || !s.own(k, v))) return null;
    const kept = Object.entries(plain(stored) ? stored : {}).filter(([k, v]) => !(m.drop === true && set.length && s.old(k, v)));
    return { [m.key]: { ...Object.fromEntries(kept), ...m.set }, ...(m.stamp === true && s.at && { [s.at]: now }) };
  };
  return { KEYS, merge };
})();
if (typeof module !== 'undefined') module.exports = GZ_SEEN;
