const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../defaults.js');
const E = require('../lib/editor.js');

const defaults = { show: 'auto', inline: true };

test('rubrics start automatic with inline enabled, including existing saved settings', () => {
  assert.deepEqual(D.GZ_DEFAULTS.rubric, defaults);
  assert.deepEqual(D.GZ_SANITIZE().rubric, defaults);
  assert.deepEqual(D.GZ_SANITIZE({ version: 2, enhance: { docPages: 'dark' } }).rubric, defaults);
});

test('rubric settings preserve the selected mode and inline switch, rejecting malformed sync values', () => {
  for (const show of ['auto', 'popup', 'site']) for (const inline of [true, false]) {
    assert.deepEqual(D.GZ_SANITIZE({ rubric: { show, inline } }).rubric, { show, inline });
  }
  for (const rubric of [null, [], 'popup', { show: 'inline', inline: 'false' }, { show: '<script>', inline: 0 }]) {
    assert.deepEqual(D.GZ_SANITIZE({ rubric }).rubric, defaults);
  }
  const raw = { rubric: { show: 'popup', inline: false, unknown: true } };
  assert.deepEqual(D.GZ_SANITIZE(raw).rubric, { show: 'popup', inline: false });
  assert.equal(raw.rubric.unknown, true, 'sanitizing does not mutate saved data');
});

test('resetting rubric preferences preserves the shared pop-up animation and other page settings', () => {
  const base = D.GZ_SANITIZE();
  const state = D.GZ_SANITIZE({ rubric: { show: 'site', inline: false }, popup: { anim: 'none' }, enhance: { docPages: 'dark' } });
  assert.equal(E.differs(state, ['rubric.show', 'rubric.inline'], base), true);
  assert.deepEqual(E.reset(state, ['rubric.show', 'rubric.inline'], base), ['rubric']);
  assert.deepEqual(state.rubric, defaults);
  assert.equal(state.popup.anim, 'none');
  assert.equal(state.enhance.docPages, 'dark');
  assert.equal(E.differs(state, ['rubric.show', 'rubric.inline'], base), false);
});

test('rubric settings and table vocabulary are translated with rating placeholders in every catalogue', () => {
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    require(`../i18n/${lang}.js`);
    const words = globalThis.GZ_LANGS[lang];
    for (const key of ['Rubrics', 'Automatic', 'Pop-up', "The site's own", "Show inline when there's room", 'Rubric', 'Feedback', 'Criterion', 'Rating {n}', 'Not scored', 'Weight', 'Score', 'Points', 'Selected', 'Total']) {
      assert.ok(typeof words[key] === 'string' && words[key].trim(), `${lang}: ${key}`);
    }
    assert.ok(words['Rating {n}'].includes('{n}'), `${lang}: the rating number survives translation`);
  }
});
