// Shared by the extension-owned Relay form and worker; never loaded on an LMS page.
var GZ_RELAY = globalThis.GZ_RELAY || (() => {
  const normalize = (value) => {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
      const u = new URL(value.trim());
      if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return null;
      return u.origin;
    } catch { return null; }
  };
  const invite = (value) => {
    if (typeof value !== 'string' || value.length > 1024) return null;
    try {
      const u = new URL(value.trim());
      return !u.username && !u.password && !u.search && u.pathname === '/j' && /^#1\.(e\.[\w-]{64}|r\.[\w-]{107})$/.test(u.hash) ? normalize(u.origin) : null;
    } catch { return null; }
  };
  return { normalize, invite };
})();
if (typeof module !== 'undefined') module.exports = GZ_RELAY;
