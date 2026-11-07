// The setup wizard's Navigation step (settings/welcome.html #nav), mounted by settings/setup.js (GZ_SETUP_PARTS).
// Classic script; module.exports for node.
var GZ_SETUP_NAV = globalThis.GZ_SETUP_NAV || (() => ({}))();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (globalThis.GZ_SETUP_PARTS ||= []).push({
  step: 'nav',
  mount: () => ({}),
});

if (typeof module !== 'undefined') module.exports = GZ_SETUP_NAV;
