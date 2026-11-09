// Choices shared by setup and Settings. Pure rules stay testable without a page; art takes the caller's DOM constructor.
var GZ_CHOICES = globalThis.GZ_CHOICES || (() => {
  const D = typeof GZ_DEFAULTS !== 'undefined' ? { GZ_DEFAULTS, GZ_LOOK_APPLY } : require('../content/defaults.js');
  const OWN = Object.freeze({ name: 'Frost', colors: D.GZ_DEFAULTS.colors, palette: D.GZ_DEFAULTS.preset, look: {}, bg: {} });
  const FORMATS = [['mla9', 'MLA 9', true], ['apa7', 'APA 7', true], ['chicago17', 'Chicago 17', true], ['plain', 'Blank']];
  const LEVELS = [['off', 'Off'], ['subtle', 'Subtle'], ['expressive', 'Expressive']];
  const NEEDS = Object.freeze({ 'enhance.search': 'enhance.palette', 'writer.format': 'enhance.writer' });
  const get = (s, key) => key.split('.').reduce((o, k) => o?.[k], s);
  const blocked = (s, key) => !!NEEDS[key] && get(s, NEEDS[key]) !== true;
  // Frost restores the whole default Look, keeping the student's automatic light/dark preference as setup always has.
  const theme = (s, L) => { const { auto, ...rest } = D.GZ_LOOK_APPLY(s, L); return L === OWN ? rest : { auto, ...rest }; };
  const themes = (list) => [{ id: OWN.name, name: OWN.name, kind: 'builtin', ...OWN, L: OWN }, ...list];
  const shortcut = (e) => e.key === '/' && !e.defaultPrevented && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey
    && !e.target?.closest?.('input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
  const themeArt = (make) => {
    const art = make('span', { className: 'mock' }, make('i', { className: 'sky' }), make('i', { className: 'side' }),
      make('i', { className: 'card' }, make('b'), make('b'), make('b')), make('i', { className: 'pill' }));
    art.setAttribute('aria-hidden', 'true');
    return art;
  };
  const motionArt = (make) => {
    const art = make('span', { className: 'demo' }, make('i'), make('i'), make('i'), make('em'));
    art.setAttribute('aria-hidden', 'true');
    return art;
  };
  return { OWN, FORMATS, LEVELS, NEEDS, get, blocked, theme, themes, shortcut, themeArt, motionArt };
})();
if (typeof module !== 'undefined') module.exports = GZ_CHOICES;
