// The signature under a Canvas submission comment (author and date) was #888, 3.25:1 on Paper's ground (audit 2026-11-11 A7, the
// Canvas line of D2). The captured page holds both its forms: the comment Canvas renders (.comment_author_and_date) and the
// template it copies for a comment just posted (#comment_blank, with color: #888 inline).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { PALETTES, LIGHT } = require('../helpers/palettes.cjs');
const { cssRules, chain, winner } = require('../helpers/css-cascade.cjs');

const fixture = fs.readFileSync(path.join(__dirname, '../fixtures/canvas-submission.html'), 'utf8');
const rules = cssRules('content/canvas.css');
const el = (spec, attrs) => Object.assign(chain(...spec), { attrs });
const page = ['div#application.ic-app', 'div.submission-details-comments', 'div.comment_list', 'div#submission_comment_62.comment'];

test('the fixture holds the two forms of the signature', () => {
  assert.ok(/<div class="comment_author_and_date" style="text-align: right; font-size: 0\.8em;">/.test(fixture), 'the rendered comment');
  assert.ok(/<div class="comment" id="comment_blank"[^>]*>[\s\S]*?<div style="text-align: right; font-size: 0\.8em; color: #888;">/.test(fixture), 'the template');
});

test('the rendered signature takes the muted ink', () => {
  assert.equal(winner(rules, el([...page, 'div.comment_author_and_date']), 'color')?.[0], 'var(--gz-ink-muted)');
});

test('so does the one just posted, where #888 is inline', () => {
  const posted = el(['div#application.ic-app', 'div.submission-details-comments', 'div.comment_list', 'div.comment', 'div'], { style: 'text-align: right; font-size: 0.8em; color: #888;' });
  assert.equal(winner(rules, posted, 'color')?.[0], 'var(--gz-ink-muted)');
  const [, selector] = winner(rules, posted, 'color');
  assert.ok(/color:\s*var\(--gz-ink-muted\)\s*!important/.test(rules.find(([sel]) => sel === selector)[1]), 'over an inline colour it needs !important');
});

test('the comment text itself is not repainted', () => {
  assert.equal(winner(rules, el([...page, 'div.comment', 'span.comment_content'], { style: 'white-space: pre-wrap;' }), 'color'), null);
});

test('muted ink reads at 4.5:1 on the surface and the ground of every palette, where #888 read 3.25:1 on Paper\'s ground', () => {
  for (const [name, c] of Object.entries(PALETTES)) for (const bg of ['--gz-surface', '--gz-surface-2']) {
    const ratio = C.contrast(c['--gz-ink-muted'], c[bg]);
    assert.ok(ratio >= 4.5, `${name} muted on ${bg}: ${ratio.toFixed(2)}:1`);
  }
  assert.ok(C.contrast('#888888', PALETTES.Paper['--gz-surface-2']) < 3.3 && LIGHT.includes('Paper'));
});
