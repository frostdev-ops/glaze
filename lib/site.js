// A school's site, as a student names it: what they type or paste becomes the one host Glaze asks the browser for
// (address), and once that host is held, whether it really is Blackboard, Canvas or Moodle (probe). A host that isn't one
// gets suggestions for the one that is (nearby): course-site links on its own homepage, and the course-site names schools
// use that exist on its domain. Allowing one from a click (allow) and handing its grant back (handBack) are here too, for
// Glaze's first screen (features/welcome.js) and Settings' Sites; the popup and the worker use the rest. No DOM; classic
// script; module.exports for node.
var GZ_SITE = globalThis.GZ_SITE || (() => {
  const LOCAL = new Set(['localhost', '127.0.0.1']);
  const HOST = /^([a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+(?:[a-z]{2,63}|xn--[a-z\d-]{1,59})$/;
  // What a student types or pastes, as the site Glaze would ask for: { host, origin, pattern, url, path } or null. Any
  // page's address will do (its query and case go); a bare host gets https. Plain http only for this computer (local
  // Canvas or Moodle); a school's own host is always asked for as https, and a match pattern can't name a port. `path` is
  // the address's first folder, where a Moodle may live (school.edu/moodle).
  const address = (text) => {
    let s = String(text ?? '').trim();
    if (!s || /[\s@\\]/.test(s)) return null;
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(s)) s = `https://${s}`;
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/\.$/, '');
    const local = LOCAL.has(host);
    if (!local && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !HOST.test(host)) return null;
    const scheme = local ? 'http:' : 'https:';
    const port = local && u.port ? `:${u.port}` : '';
    const path = /^\/([\w.~-]+)(?:\/|$)/.exec(u.pathname)?.[1] || '';
    return { host, origin: `${scheme}//${host}${port}`, pattern: `${scheme}//${host}/*`, url: `${scheme}//${host}${port}/`, path };
  };

  // Each LMS by an address it answers on every site, signed in or not, without sending anyone to the school's sign-in:
  // Blackboard Learn's public version, Canvas's API (its own JSON whether or not a session comes along), Moodle's web
  // services (its own JSON error with no token). Checked against bb.wpunj.edu, canvas.harvard.edu, moodle.org and a
  // school's main website (2026-10-23).
  const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const SIGNS = [
    ['ultra', '/learn/api/public/v1/system/version', (r, j) => r.ok && isObj(j) && isObj(j.learn)],
    ['canvas', '/api/v1/users/self', (r, j) => isObj(j) && ((r.status === 401 && j.status === 'unauthenticated' && Array.isArray(j.errors)) || (r.ok && j.id != null && 'name' in j))],
    ['moodle', '/webservice/rest/server.php?moodlewsrestformat=json', (r, j) => isObj(j) && typeof j.exception === 'string' && typeof j.errorcode === 'string'],
  ];
  const TIMEOUT = 6000;
  const get = (f, url, opts = {}) => f(url, { credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT), ...opts });
  // Which LMS answers at a site Glaze holds: { kind, url } (url: where it lives, a Moodle's folder included), 'none' (the
  // site answered, as something else) or 'unreachable' (nothing answered at all). A Moodle may live in the address's folder.
  const probe = async (site, f = fetch) => {
    const bases = [''];
    if (site.path) bases.push(`/${site.path}`);
    const tries = SIGNS.flatMap(([kind, at, sign]) => (kind === 'moodle' ? bases : ['']).map((b) => ({ kind, b, at, sign })));
    let answered = false;
    const hits = await Promise.all(tries.map(async ({ kind, b, at, sign }) => {
      try {
        const r = await get(f, `${site.origin}${b}${at}`);
        answered = true;
        if (r.type === 'opaqueredirect' || r.status >= 300 && r.status < 400) return null;
        return sign(r, json((await r.text()).slice(0, 65536))) ? { kind, url: `${site.origin}${b}/` } : null;
      } catch { return null; }
    }));
    return hits.find(Boolean) || (answered ? 'none' : 'unreachable');
  };

  // The domain a host belongs to, near enough: its last two labels, or three under a country's academic or company second
  // level (ox.ac.uk, unimelb.edu.au).
  const domainOf = (host) => {
    const l = host.split('.');
    return l.slice(l.length >= 3 && /^[a-z]{2}$/.test(l.at(-1)) && /^(ac|edu|co|com|org|net|gov|sch)$/.test(l.at(-2)) ? -3 : -2).join('.');
  };
  // The names schools give their course site, and the hosts the three LMSs run schools on.
  const WORDS = ['bb', 'blackboard', 'canvas', 'moodle', 'learn', 'lms', 'elearning', 'courses', 'mycourses'];
  const LMSY = new RegExp(`(^|[.-])(${WORDS.join('|')}|e-learning|instructure|moodlecloud)([.-]|$)`);
  const HOSTED = /(^|\.)(instructure\.com|blackboard\.com|moodlecloud\.com)$/;
  // Hosts a homepage links to that look like a course site: on the school's own domain or the LMSs' hosts.
  const linked = (html, from) => {
    const d = domainOf(from), out = new Set();
    for (const [, href] of String(html).matchAll(/href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) {
      const s = address(href);
      if (s && s.host !== from && (s.host.endsWith(`.${d}`) || HOSTED.test(s.host)) && LMSY.test(s.host)) out.add(s.host);
    }
    return [...out];
  };
  // Course sites near one that isn't one, best first, at most `max`: those its own homepage links to (when Glaze holds
  // it and it answers there itself), then the course-site names that exist on its domain. Whether a name exists needs no
  // grant (the browser shows nothing of the answer, only that there was one); a domain that answers for any name at all
  // gets no guesses.
  const nearby = async (site, { f = fetch, held = false, max = 2 } = {}) => {
    const d = domainOf(site.host);
    const exists = (host) => f(`https://${host}/`, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(4000) }).then(() => true, () => false);
    const home = held ? get(f, site.url).then(async (r) => (r.ok && /html/.test(r.headers.get('content-type') || '') ? linked(await r.text(), site.host) : []), () => []) : Promise.resolve([]);
    const names = WORDS.map((w) => `${w}.${d}`).filter((h) => h !== site.host);
    const [links, wild, found] = await Promise.all([home, exists(`gz-${Math.random().toString(36).slice(2, 10)}.${d}`), Promise.all(names.map(exists))]);
    const guesses = wild ? [] : names.filter((_, i) => found[i]);
    const lists = await Promise.resolve().then(() => globalThis.chrome?.storage?.local?.get(['canvas', 'moodle', 'ultra'])).catch(() => null);
    const listed = new Set(['canvas', 'moodle', 'ultra'].flatMap((k) => Array.isArray(lists?.[k]) ? lists[k].map((x) => address(x)?.host) : []));
    return [...new Set([...links, ...guesses])].filter((h) => !HOSTED.test(h) && !listed.has(h)).slice(0, max);
  };

  // Whether the manifest's own hosts (`patterns`, its host_permissions) cover the site: a grant Glaze never hands back
  // (Chrome refuses to; Firefox would obey and take a built-in host away).
  const required = (site, patterns) => {
    const u = new URL(site.origin);
    return patterns.some((p) => {
      if (p === '<all_urls>') return true;
      const [, scheme, host] = /^(\*|https?):\/\/([^/:]+)(?::\d+)?\//.exec(p) || [];
      return (scheme === '*' || `${scheme}:` === u.protocol) && (host === '*' || host === u.hostname || host?.startsWith('*.') && (u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))));
    });
  };
  // The site's own grant back to the browser: only one the student gave for exactly that host, never a required host, nor
  // the every-site grant the site shares. → whether it went.
  const handBack = async (site) => {
    const c = globalThis.chrome;
    if (!site || required(site, c.runtime.getManifest().host_permissions || [])) return false;
    const held = await Promise.resolve().then(() => c.permissions.getAll()).then((p) => p?.origins || [], () => []);
    return held.includes(site.pattern) && await Promise.resolve().then(() => c.permissions.remove({ origins: [site.pattern] })).then((ok) => ok !== false, () => false);
  };
  // A word to the worker ('glaze:allow'), sent now, whatever comes back.
  const tell = (m) => { try { return Promise.resolve(globalThis.chrome.runtime.sendMessage({ type: 'glaze:allow', ...m })).catch(() => null); } catch { return Promise.resolve(null); } };
  // Allow, from a click in one of Glaze's pages (the first screen, Settings → Sites): the worker hears the site is coming,
  // then the browser's prompt opens, both before anything is awaited, so the click that called this still counts. Granted,
  // the site is checked (`checking` says when): a course site goes to the worker, which checks it again and registers it;
  // anything else has its grant handed back at once, with up to two course sites nearby. → { state: 'done', kind, url },
  // { state: 'none' | 'unreachable', hosts }, { state: 'refused' } (the student said no, or closed the prompt) or
  // { state: 'failed' } (the worker turned it down; the grant stays). `f`: fetch, for tests.
  const allow = (site, { checking = () => {}, f } = {}) => {
    const cancel = () => tell({ op: 'cancel', origin: site.origin });
    // Start the snapshot before request, without awaiting it or losing the click. Unknown prior access stays untouched.
    const before = new Promise((res) => res(globalThis.chrome.permissions.getAll())).then((p) => p?.origins, () => null);
    tell({ op: 'ask', origin: site.origin });
    return new Promise((res) => res(globalThis.chrome.permissions.request({ origins: [site.pattern] }))).then(async (ok) => {
      if (!ok) { cancel(); return { state: 'refused' }; }
      checking();
      const found = await api.probe(site, f);
      if (typeof found === 'object') {
        if ((await tell({ op: 'yes', origin: site.origin, kind: found.kind, url: found.url }))?.ok) return { state: 'done', ...found };
        cancel();
        return { state: 'failed' };
      }
      const hosts = await api.nearby(site, { held: found === 'none', ...(f ? { f } : {}) });
      cancel();
      const prior = await before;
      if (Array.isArray(prior) && !required(site, prior)) await handBack(site);
      return { state: found, hosts };
    }, () => { cancel(); return { state: 'refused' }; }).catch(() => ({ state: 'failed' }));
  };

  const api = { address, probe, nearby, linked, domainOf, required, handBack, tell, allow, SIGNS, WORDS };
  return api;
})();

if (typeof module !== 'undefined') module.exports = GZ_SITE;
