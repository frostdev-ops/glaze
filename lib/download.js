// Trust and byte limits for Canvas's private extension download port; no page messages or stored bytes.
const GZ_DOWNLOAD = (() => {
  const MAX = 250 * 2 ** 20;
  const url = (value, devOrigin = '') => {
    try {
      const u = new URL(value);
      return !u.username && !u.password && (u.protocol === 'https:' || (devOrigin && u.origin === devOrigin)) && !/^\/login(?:\/|$)/.test(u.pathname) ? u.href : null;
    } catch { return null; }
  };
  const sender = (s, id) => {
    try { return s?.id === id && Number.isInteger(s.tab?.id) && s.frameId === 0 && /^\/courses\/\d+(?:\/modules)?\/?$/.test(new URL(s.url).pathname); } catch { return false; }
  };
  const bytes = (used, n) => {
    if (!Number.isSafeInteger(n) || n < 0 || used + n > MAX) throw new Error('limit');
    return used + n;
  };
  return { MAX, url, sender, bytes };
})();
if (typeof module !== 'undefined') module.exports = GZ_DOWNLOAD;
