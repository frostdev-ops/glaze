// The built-in Looks' own parts (lib/lookparts.js, cleaned as any Look's are): each one's pointer set and the pointer's
// animation, a typing effect, and an effect for each event (lib/motionx.js draws them). Colours are palette tokens, so they
// follow the Look's palette and a student's own changes to it. Kept out of defaults.js, which every page loads first:
// this loads only where a built-in Look is put on (the worker, the editor and the popup). Classic script; module.exports
// for node.
var GZ_LOOK_PARTS = globalThis.GZ_LOOK_PARTS || (() => {
  const fx = (complete, submit, grade, streak, done, rotate) => ({ complete, submit, grade, streak, 'timer.done': done, 'look.rotate': rotate });
  const X = {
    'Aurora Night': { pointer: 'aurora', cursor: { kind: 'sparkle', c: ['accent', 'accent-hi', 'ok'], size: 8, len: 8, fade: 700, shape: 'star' }, type: { kind: 'sparks', c: ['accent-hi', 'ok'] },
      fx: fx({ kind: 'burst', shapes: ['star', 'spark'], c: ['accent', 'accent-hi', 'ok'] }, { kind: 'ring', c: ['accent-hi'] }, { kind: 'sprite', shapes: ['star'], c: ['accent-hi', 'ok'], count: 10 },
        { kind: 'confetti', shapes: ['star', 'spark'], c: ['accent', 'ok', 'accent-hi'] }, { kind: 'rain', shapes: ['star'], c: ['accent-hi', 'ok'], count: 24, size: 7 }, { kind: 'ring', c: ['ok', 'accent'] }) },
    Library: { pointer: 'quill', cursor: { kind: 'trail', c: ['ink-muted'], size: 4, len: 10, fade: 500 }, type: { kind: 'ink', c: ['ink'] },
      fx: fx({ kind: 'burst', shapes: ['leaf', 'dot'], c: ['accent', 'warn'] }, { kind: 'sprite', shapes: ['leaf'], c: ['accent', 'warn'] }, { kind: 'burst', shapes: ['star'], c: ['warn', 'accent'], count: 10 },
        { kind: 'confetti', shapes: ['leaf', 'star'], c: ['accent', 'warn', 'ok'] }, { kind: 'rain', shapes: ['leaf'], c: ['accent', 'warn'], count: 20, size: 10 }, { kind: 'ring', c: ['accent'] }) },
    Terminal: { pointer: 'terminal', cursor: { kind: 'scan', c: ['accent'], size: 10, fade: 500 }, type: { kind: 'pixels', c: ['accent', 'accent-hi'] },
      fx: fx({ kind: 'burst', shapes: ['pixel'], c: ['accent', 'accent-hi'], gravity: 1, size: 8, count: 24 }, { kind: 'rain', shapes: ['pixel'], c: ['accent'], count: 24, size: 5 }, { kind: 'sprite', shapes: ['pixel'], c: ['accent-hi'], size: 8 },
        { kind: 'confetti', shapes: ['pixel'], c: ['accent', 'accent-hi', 'warn'], size: 6 }, { kind: 'burst', shapes: ['pixel'], c: ['accent', 'warn'], count: 40, size: 5 }, { kind: 'ring', c: ['accent'] }) },
    'Lava Lounge': { pointer: 'lava', cursor: { kind: 'glow', c: ['accent'], size: 14, fade: 900 }, type: { kind: 'embers', c: ['accent', 'warn'] },
      fx: fx({ kind: 'sprite', shapes: ['dot'], c: ['accent', 'warn', 'err'], gravity: -0.6, count: 14, size: 10 }, { kind: 'ring', c: ['accent', 'warn'] }, { kind: 'burst', shapes: ['dot', 'spark'], c: ['warn', 'accent'] },
        { kind: 'confetti', shapes: ['dot', 'spark'], c: ['accent', 'warn', 'err'] }, { kind: 'sprite', shapes: ['dot'], c: ['accent', 'warn'], gravity: -0.8, count: 20, size: 12 }, { kind: 'ring', c: ['accent'] }) },
    Synthwave: { pointer: 'neon', cursor: { kind: 'trail', c: ['accent', 'accent-hi'], size: 8, len: 14, fade: 450 }, type: { kind: 'sparks', c: ['accent', 'accent-hi', 'warn'] },
      fx: fx({ kind: 'confetti', shapes: ['star', 'spark', 'dot'], c: ['accent', 'accent-hi', 'warn'] }, { kind: 'ring', c: ['accent', 'warn'] }, { kind: 'burst', shapes: ['spark', 'star'], c: ['accent-hi', 'warn'] },
        { kind: 'confetti', shapes: ['star', 'spark'], c: ['accent', 'ok', 'warn'], count: 40 }, { kind: 'rain', shapes: ['spark'], c: ['accent', 'accent-hi'], count: 26 }, { kind: 'ring', c: ['accent-hi'] }) },
    Clear: { pointer: 'clear', cursor: { kind: 'ripple', c: ['accent'], size: 6, fade: 500 }, type: { kind: 'sparks', c: ['accent'], size: 4, count: 1 },
      fx: fx({ kind: 'ring', c: ['ok'] }, { kind: 'ring', c: ['accent'] }, { kind: 'burst', shapes: ['dot'], c: ['accent', 'ok'], count: 10 },
        { kind: 'burst', shapes: ['star'], c: ['warn', 'accent'], count: 12 }, { kind: 'ring', c: ['accent', 'ok'] }, { kind: 'ring', c: ['accent'] }) },
    Lagoon: { pointer: 'lagoon', cursor: { kind: 'ripple', c: ['accent', 'accent-hi'], size: 8, fade: 700 }, type: { kind: 'bubbles', c: ['accent-hi', 'ok'] },
      fx: fx({ kind: 'sprite', shapes: ['bubble'], c: ['accent', 'accent-hi', 'ok'], gravity: -0.6, count: 12, size: 12 }, { kind: 'ring', c: ['accent', 'ok'] }, { kind: 'burst', shapes: ['bubble', 'dot'], c: ['accent-hi', 'ok'] },
        { kind: 'confetti', shapes: ['bubble', 'star'], c: ['accent', 'accent-hi', 'ok'] }, { kind: 'rain', shapes: ['drop'], c: ['accent', 'accent-hi'], count: 30, size: 7 }, { kind: 'ring', c: ['accent-hi'] }) },
    'Rose Garden': { pointer: 'rose', cursor: { kind: 'drift', c: ['accent', 'accent-hi'], size: 9, len: 10, fade: 1200, shape: 'petal' }, type: { kind: 'petals', c: ['accent', 'accent-hi'] },
      fx: fx({ kind: 'confetti', shapes: ['petal', 'heart'], c: ['accent', 'accent-hi', 'warn'] }, { kind: 'sprite', shapes: ['heart'], c: ['accent', 'accent-hi'] }, { kind: 'burst', shapes: ['petal', 'heart'], c: ['accent', 'accent-hi'] },
        { kind: 'confetti', shapes: ['petal', 'heart', 'leaf'], c: ['accent', 'accent-hi', 'ok'] }, { kind: 'rain', shapes: ['petal'], c: ['accent', 'accent-hi'], count: 26, size: 10 }, { kind: 'ring', c: ['accent'] }) },
    Graveyard: { pointer: 'ghost', cursor: { kind: 'orbit', c: ['accent', 'ink-muted'], size: 14, len: 3, fade: 900, shape: 'bat' }, type: { kind: 'wisps', c: ['accent', 'accent-hi'], size: 14 },
      fx: fx({ kind: 'sprite', shapes: ['ghost'], c: ['ink', 'accent-hi'], count: 6, size: 18 }, { kind: 'sprite', shapes: ['bat'], c: ['ink-muted', 'accent'], count: 8, size: 14 }, { kind: 'burst', shapes: ['bat', 'star'], c: ['accent', 'warn'] },
        { kind: 'confetti', shapes: ['bat', 'ghost'], c: ['ink', 'accent', 'accent-hi'] }, { kind: 'sprite', shapes: ['ghost'], c: ['ink', 'accent-hi'], count: 12, size: 16 }, { kind: 'burst', shapes: ['bat'], c: ['ink-muted', 'accent'], gravity: 0, count: 14 }) },
    'Pumpkin Patch': { pointer: 'pumpkin', cursor: { kind: 'flicker', c: ['accent', 'warn'], size: 14, fade: 900 }, type: { kind: 'embers', c: ['accent', 'warn'] },
      fx: fx({ kind: 'confetti', shapes: ['pumpkin', 'leaf', 'star'], c: ['accent', 'warn', 'ok'] }, { kind: 'sprite', shapes: ['pumpkin'], c: ['accent', 'warn'], size: 16 }, { kind: 'burst', shapes: ['star', 'leaf'], c: ['warn', 'accent'] },
        { kind: 'confetti', shapes: ['pumpkin', 'leaf'], c: ['accent', 'warn', 'err'] }, { kind: 'rain', shapes: ['leaf'], c: ['accent', 'err', 'warn'], count: 24, size: 11 }, { kind: 'burst', shapes: ['bat', 'leaf'], c: ['accent', 'ok'], gravity: 0 }) },
  };
  // A built-in Look's parts as { x } for lib/lookparts.js write (a copy: what is written is never the table itself), or null.
  return (L) => (L && Object.hasOwn(X, L.name) ? { x: JSON.parse(JSON.stringify(X[L.name])) } : null);
})();

if (typeof module !== 'undefined') module.exports = GZ_LOOK_PARTS; else ({ ready: true });
