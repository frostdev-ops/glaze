// The manifest's minimum Chrome is 113. A relative colour (oklch(from ...), Chrome 119) or light-dark() (Chrome 123)
// the engine can't parse is dropped when it stands alone in a declaration, but when it sits in a custom property or beside
// a var() it is only found invalid when the value is used, and the property then computes to `unset`: a transparent
// calendar swatch, a card hero with no colour, an approval page with no palette (audit 2026-11-11 A7 #12). Each one is
// inside @supports, with the plain colour outside it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '../../extension');
const files = execFileSync('git', ['ls-files', '*.css'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter((f) => !f.startsWith('vendor/'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Every declaration of a sheet with the at-rules and selector around it: [{ text, headers }].
const declarations = (css) => {
  const out = [], headers = [];
  let start = 0, depth = 0, quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (!depth && c === '{') { headers.push(css.slice(start, i).trim().replace(/\s+/g, ' ')); start = i + 1; }
    else if (!depth && (c === ';' || c === '}')) {
      const text = css.slice(start, i).trim();
      if (text) out.push({ text, headers: [...headers] });
      if (c === '}') headers.pop();
      start = i + 1;
    }
  }
  return out;
};
const NEWER = [
  ['relative colour', /\b(?:oklch|oklab|lch|lab|hsl|hwb|rgb)\(\s*from\b/, /^@supports\s*\([^)]*\b(?:oklch|oklab|lch|lab|hsl|hwb|rgb)\(\s*from\b/],
  ['light-dark()', /\blight-dark\(/, /^@supports\s*\([^)]*\blight-dark\(/],
];

test('no stylesheet leaves a relative colour or light-dark() to a browser that cannot read it, where it would compute to unset', () => {
  const bad = [];
  for (const f of files) {
    for (const { text, headers } of declarations(read(f))) {
      for (const [what, re, guard] of NEWER) {
        if (!re.test(text) || headers.some((h) => guard.test(h))) continue;
        if (text.startsWith('--') || text.includes('var(')) bad.push(`${f}: ${what} in ${headers.at(-1)?.slice(0, 70)} { ${text.slice(0, 60)}... }`);
      }
    }
  }
  assert.ok(!bad.length, `unguarded:\n${bad.join('\n')}`);
});

test('a course colour has a plain value outside the @supports that tones it', () => {
  for (const f of ['content/canvas.css', 'content/moodle.css', 'content/theme.css']) {
    const decls = declarations(read(f)).filter((d) => /^--gz-course\s*:/.test(d.text) && /oklab\(\s*from/.test(d.text));
    assert.ok(decls.length, `${f} tones --gz-course`);
    for (const d of decls) {
      const selector = d.headers.at(-1);
      // theme.css tones the ten slot classes by name (a [class*=] it keeps for the plain value is tried on every element).
      const covers = (h) => h === selector || (f === 'content/theme.css' && h.startsWith('[class*="course-color-"]') && selector.startsWith('.course-color-1,'));
      const plain = declarations(read(f)).filter((p) => covers(p.headers.at(-1)) && !p.headers.some((h) => h.startsWith('@')) && /^--gz-course\s*:/.test(p.text));
      assert.ok(plain.length && plain.every((p) => !/\bfrom\b|light-dark/.test(p.text)), `${f}: ${selector} sets --gz-course plain first`);
    }
  }
});

test('the approval page and the quick share page keep a palette where light-dark() is not read', () => {
  for (const f of ['agents/approve.css', 'sharing/quick.css']) {
    const all = declarations(read(f));
    const wanted = all.flatMap((d) => [...d.text.matchAll(/(--[\w-]+)\s*:\s*light-dark\(\s*(#[0-9a-f]{3,8})\s*,\s*(#[0-9a-f]{3,8})\s*\)/gi)]);
    assert.ok(wanted.length >= 7, `${f} has its light-dark() tokens`);
    const plain = all.filter((d) => !d.headers.some((h) => h.startsWith('@supports')));
    const dark = (d) => d.headers.some((h) => /^@media\s*\(prefers-color-scheme:\s*dark\)/.test(h));
    const has = (night, text) => plain.some((d) => dark(d) === night && d.text.replace(/\s/g, '') === text);
    for (const [, token, light, night] of wanted) {
      assert.ok(has(false, `${token}:${light}`), `${f}: ${token} is ${light} outside @supports`);
      assert.ok(has(true, `${token}:${night}`), `${f}: ${token} is ${night} by prefers-color-scheme outside @supports`);
    }
    if (f === 'sharing/quick.css') {
      assert.ok(has(false, 'color:var(--gz-err,#9c1721)'), '.error reads without light-dark()');
      assert.ok(has(true, 'color:var(--gz-err,#ffa4ab)'), '.error reads in the dark without light-dark()');
    }
  }
});

test('Canvas titles and status text do not keep dark-screen lightness on white print surfaces', () => {
  const lifted = declarations(read('content/canvas.css')).filter(({ text, headers }) =>
    /^color\s*:/.test(text) && /max\(l,\s*0\.72\)/.test(text) && headers.at(-1).includes('[data-gz-dark-theme]'));
  assert.equal(lifted.length, 3, 'both course titles and the status pill are covered');
  for (const { headers } of lifted) {
    assert.ok(headers.some((h) => /^@media\s+screen\b/.test(h)), `${headers.at(-1)} would stay light when the palette prints white`);
  }
});
