// Shared surface settings, including the document viewer's untrusted message boundary.
var GZ_SURFACES = globalThis.GZ_SURFACES || (() => {
  const SPEC = {
    radius: [12, [0, 24]], glass: [12, [0, 24]], depth: [1, [0, 3]],
    surfaceOpacity: [-1, [-1, 100]], surfaceCustom: [false, 'bool'], surfaceColor: ['#0d1b2e', 'hex'],
    surfaceTint: [0, [0, 100]], surfaceTintSource: ['accent', ['accent', 'course']],
    shadowStrength: [35, [0, 100]], shadowCustom: [false, 'bool'], shadowColor: ['#000000', 'hex'],
    surfaceFrost: [0, [0, 100]], surfaceBorder: [100, [0, 100]],
  };
  const clean = (raw) => Object.fromEntries(Object.entries(SPEC).map(([key, [fallback, rule]]) => {
    const value = raw?.[key];
    const valid = rule === 'bool' ? typeof value === 'boolean' : rule === 'hex' ? typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
      : typeof rule[0] === 'number' ? typeof value === 'number' && Number.isFinite(value) && value >= rule[0] && value <= rule[1] : rule.includes(value);
    return [key, valid ? value : fallback];
  }));
// Empty values remove an override: old Looks keep each surface's existing opacity and palette.
  const vars = ({ look: l, bg }) => ({
  '--gz-surface-color': l.surfaceCustom ? l.surfaceColor : '',
  '--gz-surface-course-weight': l.surfaceTintSource === 'course' ? '100%' : '0%',
  '--gz-surface-tint-strength': `${l.surfaceTint}%`,
  '--gz-surface-opacity': l.surfaceOpacity < 0 ? '' : `${!l.glass || bg.kind === 'solid' ? 100 : l.surfaceOpacity}%`,
  '--gz-glass-mix': `${!l.glass || (l.surfaceOpacity >= 0 && bg.kind === 'solid') ? 100 : l.surfaceOpacity < 0 ? 78 : l.surfaceOpacity}%`,
  '--gz-shadow-color': l.shadowCustom ? l.shadowColor : '', '--gz-shadow-strength': `${l.shadowStrength}%`,
  '--gz-surface-border': `${l.surfaceBorder}%`,
  '--gz-surface-grain': l.surfaceFrost ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' opacity='${l.surfaceFrost / 500}' filter='url(%23n)'/%3E%3C/svg%3E")` : 'none',
});

  return { SPEC, clean, vars };
})();
if (typeof module !== 'undefined') module.exports = GZ_SURFACES; else GZ_SURFACES;
