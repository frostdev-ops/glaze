// Ultra-only first-paint schema; the worker, editor and preview use this same sanitizer.
var GZ_NAV = globalThis.GZ_NAV || (() => {
  const G = typeof GZ_SPEC === 'undefined' ? require('../defaults.js') : { GZ_SPEC, GZ_DEFAULTS };
  const SPEC = {
    width: [200, [160, 400]], icon: [24, [16, 36]], text: [14, [10, 20]], height: [44, [36, 72]], gap: [2, [0, 16]], padding: [8, [0, 24]],
    labelOverflow: ['ellipsis', ['ellipsis', 'wrap', 'shrink']], itemStyle: ['tile', ['tile', 'pill', 'flat']], itemBackground: [false, 'bool'], activeIndicator: ['bar', ['bar', 'outline', 'background', 'none']],
    logoSize: [48, [24, 96]], logoAlign: ['center', ['start', 'center', 'end']], footer: [true, 'bool'],
    expandOnHover: [true, 'bool'], detailed: [false, 'bool'], brand: ['glaze', ['glaze', 'school', 'custom']], li: ['', 'picture'],
  };
  Object.assign(G.GZ_SPEC.nav, SPEC);
  Object.assign(G.GZ_DEFAULTS.nav, Object.fromEntries(Object.entries(SPEC).map(([k, [d]]) => [k, d])));
  const dimensions = (n) => {
    const preset = { small: [176, 20, 12, 40], medium: [200, 24, 14, 44], large: [240, 30, 17, 48] }[n.size];
    return Object.fromEntries(['width', 'icon', 'text', 'height', 'gap', 'padding'].map((k, i) => [k, !n.detailed && i < 4 ? k === 'text' && n.labels === 'small' ? 11 : preset[i] : n[k]]));
  };
  const NATIVE = ['profile', 'institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools', 'logout'];
  const native = (href) => {
    if (href === '#') return 'logout';
    try { return NATIVE.find((id) => new URL(href, 'https://nav.invalid').pathname.replace(/\/$/, '') === `/ultra/${id}`) || ''; } catch { return ''; }
  };
  return { SPEC, dimensions, NATIVE, native };
})();
if (typeof module !== 'undefined') module.exports = GZ_NAV; else GZ_NAV;
