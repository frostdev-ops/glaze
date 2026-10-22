// Trust and byte limits for Canvas's private extension download port; no page messages or stored bytes.
const GZ_DOWNLOAD = (() => {
  const MAX = 250 * 2 ** 20;
  const url = (value, devOrigin = '') => {
    try {
      const u = new URL(value);
      return !u.username && !u.password && (u.protocol === 'https:' || (devOrigin && u.origin === devOrigin)) && !/^\/login(?:\/|$)/.test(u.pathname) ? u.href : null;
    } catch { return null; }
  };
  // A course page's top frame, or a frame of it on the page's own site: Glaze's course tabs (features/coursetabs.js) run a
  // course's pages in frames, and Download all is drawn there. Either way the frame's own address passes the path check.
  const sender = (s, id) => {
    try {
      const u = new URL(s.url);
      if (s.id !== id || !Number.isInteger(s.tab?.id) || !/^\/courses\/\d+(?:\/modules)?\/?$/.test(u.pathname)) return false;
      return s.frameId === 0 || (Number.isInteger(s.frameId) && s.frameId > 0 && u.origin !== 'null'
        && (s.origin === undefined || s.origin === u.origin) && u.origin === new URL(s.tab.url).origin);
    } catch { return false; }
  };
  const bytes = (used, n) => {
    if (!Number.isSafeInteger(n) || n < 0 || used + n > MAX) throw new Error('limit');
    return used + n;
  };
  return { MAX, url, sender, bytes };
})();
if (typeof module !== 'undefined') module.exports = GZ_DOWNLOAD;
