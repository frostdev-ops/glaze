// A course's dot in Glaze's navigation (navbar.css .dot, the colour in --c) draws its initials in whichever of white and black
// reads on the dot, as CSS works it out from the dot's own lightness: white initials read on 1 of Ultra's ten course colours
// below 4.5:1 and on 3 of them below 2:1 (audit 2026-11-11 A7 #8: 8 of 10 by a miscount; it is 9).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { GZ_SLOT_COLORS } = require('../../extension/content/defaults.js');

const css = fs.readFileSync(path.join(__dirname, '../../extension/navigation/page/navbar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// CIE L* of an sRGB colour as CSS Color 4's lab() has it (D50), the `l` of lab(from <colour> l a b).
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const labL = (hex) => {
  const { r, g, b } = C.parse(hex), [R, G, B] = [r, g, b].map(lin);
  const X = 0.4123907992659595 * R + 0.357584339383878 * G + 0.1804807884018343 * B;
  const Y = 0.21263900587151036 * R + 0.715168678767756 * G + 0.07219231536073371 * B;
  const Z = 0.01933081871559185 * R + 0.11919477979462598 * G + 0.9505321522496606 * B;
  const y = 0.02962780877005599 * X + 0.9904344267538799 * Y - 0.017073799063418826 * Z;
  return 116 * (y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116) - 16;
};
// The grey lab(L 0 0) is.
const grey = (L) => {
  const Y = L > 8 ? ((L + 16) / 116) ** 3 : L / (24389 / 27);
  const v = 255 * (Y <= 0.0031308 ? 12.92 * Y : 1.055 * Y ** (1 / 2.4) - 0.055);
  return C.hex({ r: v, g: v, b: v });
};

const block = css.match(/@supports\s*\(color:\s*lab\(from red l a b\)\)\s*\{\s*\.dot\s*\{([^}]*)\}/)?.[1];
const initials = block?.match(/(?:^|[\s;])color:\s*lab\(from var\(--c, var\(--gz-accent, #17c8f4\)\) clamp\(0, \(([\d.]+) - l\) \* (\d+), 100\) 0 0\)/);
// What the browser draws the initials in for a dot of colour `c`: white until there is a rule.
const inkOn = (c) => (initials ? grey(Math.min(100, Math.max(0, (+initials[1] - labL(c)) * +initials[2]))) : '#ffffff');

test('the dot keeps white initials where lab(from ...) is not read', () => {
  assert.ok(/\.dot\s*\{[^}]*\bcolor:\s*#fff/.test(css));
});

test('under @supports the initials are black or white by the dot\'s lightness', () => {
  assert.ok(initials, '.dot sets color from lab(from var(--c, ...) ...) in an @supports block');
});

test('initials read at 4.5:1 on every one of Ultra\'s ten course colours', () => {
  const rows = Object.entries(GZ_SLOT_COLORS).map(([slot, c]) => [slot, c, C.contrast(inkOn(c), c)]);
  assert.deepEqual(rows.filter(([, , r]) => r < 4.5).map(([s, c, r]) => `${s} ${c} ${r.toFixed(2)}`), []);
});

test('and on the colours Glaze gives the courses past ten (hsl(h, 70%, 60%))', () => {
  const hsl = (h) => {
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.6 - 0.7 * 0.4 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  let worst = 99;
  for (let h = 0; h < 360; h++) worst = Math.min(worst, C.contrast(inkOn(hsl(h)), hsl(h)));
  assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}:1`);
});

test('a dark initial has no dark shadow under it', () => {
  assert.ok(block && /text-shadow:\s*0 1px 1px lab\(from var\(--c/.test(block), 'the shadow follows the initials');
});
