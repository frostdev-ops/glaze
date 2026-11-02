// Navigation-only Pearson frame protocol. No launch tokens, problem text or answer values cross this bridge.
var GZ_PEARSON_EMBED_LIB = globalThis.GZ_PEARSON_EMBED_LIB || (() => {
  const socket = 'https://socket.pearsoned.com', mylab = 'https://mylab.pearson.com', tdx = 'https://tdx.acs.pearson.com';
  const channel = x => typeof x === 'string' && /^[\w-]{36}$/.test(x);
  const tokens = ('accent accent-hi accent-soft accent-ink surface surface-2 ink ink-muted ink-faint line line-strong ok warn err radius glass scale leading font font-head surface-color surface-course surface-course-weight surface-tint-strength surface-opacity glass-mix shadow-color shadow-strength surface-border surface-tint surface-paint surface-paint-2 surface-fill surface-fill-2 border-line border-strong shadow-ink shadow rest-shadow nav-ink nav-c nav-d nav-a nav-o t t-slow t-move t-page t-hover ease spring enter enter-page enter-panel press hover-filter').split(' ').map(k => '--gz-' + k).concat('--gz-pearson-scheme');
  const theme = raw => Object.fromEntries(tokens.flatMap(k => {
    const v = raw?.[k]; return typeof v === 'string' && v.length > 0 && v.length <= 2000 && !/[\x00-\x1f\\;{}<>@]|(?:url|(?:-webkit-)?image-set|image|src)\s*\(/i.test(v) ? [[k,v]] : [];
  }));
  const url = value => { try { const u = new URL(value); return !u.username && !u.password ? u : null; } catch { return null; } };
  const homework = value => {
    const u = url(value);
    if (u?.origin !== mylab || !/^\/Student\/(?:OverviewHomework|PlayerHomework)\.aspx$/i.test(u.pathname)) return null;
    const id = u.searchParams.get('homeworkId');
    if (!/^\d{1,20}$/.test(id || '')) return null;
    const clean = new URL(u.pathname, mylab); clean.searchParams.set('homeworkId', id);
    for (const k of ['questionId', 'cId', 'homeworkResultId']) {
      const v = u.searchParams.get(k); if (/^\d{1,20}$/.test(v || '')) clean.searchParams.set(k, v);
    }
    for (const [k, values] of [['flushed', ['true','false']], ['review', ['yes','no']]]) {
      const v = u.searchParams.get(k); if (values.includes(v)) clean.searchParams.set(k, v);
    }
    return clean.href;
  };
  const lti = value => { const u = url(value); return u?.protocol === 'https:' && /^\/ultra\/courses\/(_\d+_\d+)\/lti\/launchFrame\/?$/.exec(u.pathname); };
  // Open a fresh native launch as a top-level page when authentication has not reached a homework URL yet.
  const launch = (value, host) => {
    const h = url(host), match = lti(host), u = url(value);
    if (!h || !match || u?.origin !== h.origin || u.pathname !== '/webapps/blackboard/execute/ultraFramePassThrough') return null;
    const target = url(u.searchParams.get('redirectTo'));
    if (target?.origin !== h.origin || target.pathname !== '/webapps/blackboard/execute/blti/launchLink' || target.searchParams.get('course_id') !== match[1]) return null;
    const content = target.searchParams.get('content_id'); if (!/^_\d+_\d+$/.test(content || '')) return null;
    const to = new URL(target.pathname, h.origin);
    to.searchParams.set('course_id', match[1]); to.searchParams.set('content_id', content); to.searchParams.set('from_ultra', 'true');
    const out = new URL(u.pathname, h.origin); out.searchParams.set('redirectTo', to.href); return out.href;
  };
  const child = value => {
    const u = url(value);
    return u && (homework(value) || u.origin === tdx && /^\/(?:assignment\/assignmentplayer|Player\/Player)\.aspx$/i.test(u.pathname)) ? u.origin : null;
  };
  // A native question iframe retains its MyLab launch URL after navigating to tdx.
  // This maps only the known frame route; child() still admits only final homework documents.
  const frameOrigin = value => {
    const u = url(value);
    return u?.origin === mylab && /^\/Service\/PlayerLaunch\.ashx$/i.test(u.pathname) ? tdx : child(value);
  };
  return { socket, mylab, tdx, channel, homework, lti, launch, child, frameOrigin, tokens, theme };
})();
if (typeof module !== 'undefined') module.exports = GZ_PEARSON_EMBED_LIB;
