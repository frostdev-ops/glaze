const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../extension/core/color.js');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');
const { resolve } = require('../helpers/palettes.cjs');

for (const dark of [false, true]) {
  test(`quick share fields keep a readable border before the ${dark ? 'dark' : 'light'} palette loads`, () => {
    const active = (header) => {
      if (header.startsWith('@supports')) return false; // The minimum engine uses the plain first-paint palette.
      if (header.includes('prefers-color-scheme')) return dark;
      return !header.includes('print');
    };
    const rules = [...cssRules('core/ui.css', active), ...cssRules('sharing/quick.css', active), ...cssRules('looks/page/surfaces.css', active)];
    const colors = {};
    for (const [selector, body] of rules) if (parts(selector).includes(':root')) {
      for (const [, key, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) colors[key] = value.trim();
    }
    // The colour helper accepts literal mix percentages; substitute the sheet's percentage fallbacks first.
    for (const key of Object.keys(colors)) colors[key] = colors[key].replace(/var\((--[\w-]+),\s*([\d.]+%)\)/g,
      (_, token, fallback) => colors[token] ?? fallback);
    const body = rules.findLast(([selector]) => selector === 'input')[1];
    const border = body.match(/(?:^|;)\s*border\s*:\s*1px solid ([^;]+)/)?.[1];
    assert.ok(border, 'the field has its authored one-pixel border');
    let edge;
    assert.doesNotThrow(() => { edge = resolve(border, colors); }, 'the border must resolve without a palette from storage');
    assert.ok(C.contrast(edge, resolve('var(--gz-surface-2)', colors)) >= 3, `${edge} reads on the default field surface`);
  });
}
