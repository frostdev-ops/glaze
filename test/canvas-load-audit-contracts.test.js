// Static first-paint contracts complement the VM's controlled document lifecycle. These do not
// measure browser style-recalculation time or certify a real first paint.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../manifest.json');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// The DocViewer's own entry matches instructure.com too (regional canvadocs hosts): this is Glaze's first script.
const canvas = manifest.content_scripts.filter((s) => s.js.includes('content-canvas.js'));
const css = read('canvas.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('Canvas has one all-frame document_start entry, ordered dependencies, site adapter, shared startup', () => {
  assert.equal(canvas.length, 1); assert.equal(canvas[0].run_at, 'document_start'); assert.equal(canvas[0].all_frames, true);
  assert.deepEqual(canvas[0].js, ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'content-canvas.js', 'content.js']);
  assert.ok(canvas[0].exclude_matches.includes('https://canvadocs.instructure.com/*'));
});

test('Canvas sheets avoid blocking CSS imports and keep bundled font loading at swap', () => {
  assert.doesNotMatch(css, /@import\b/i);
  const fonts = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)]; assert.equal(fonts.length, 3);
  for (const [, body] of fonts) assert.match(body, /font-display:\s*swap\s*;/);
  assert.ok(manifest.web_accessible_resources.some((r) => r.resources.includes('canvas.css') && r.resources.includes('motion.css')));
});

test('Canvas CSS keeps native palette mapping and cached course-tab space available at first paint', () => {
  assert.match(css, /--ic-brand-font-color-dark:\s*var\(--gz-ink\)/);
  assert.match(css, /--ic-brand-global-nav-bgd:\s*var\(--gz-surface/);
  assert.match(css, /html\[data-gz-ctabs\]/);
  assert.match(css, /height:\s*var\(--gz-ctabs-h,\s*40px\)/);
  assert.match(css, /html\[data-gz-navbar-frame\]/);
});
