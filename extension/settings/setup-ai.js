// The setup wizard's AI step (settings/welcome.html #ai), mounted by settings/setup.js (GZ_SETUP_PARTS).
// Classic script; module.exports for node.
var GZ_SETUP_AI = globalThis.GZ_SETUP_AI || (() => ({}))();

if (typeof document !== 'undefined' && globalThis.chrome?.runtime?.id) (globalThis.GZ_SETUP_PARTS ||= []).push({
  step: 'ai',
  mount: () => ({}),
});

if (typeof module !== 'undefined') module.exports = GZ_SETUP_AI;
