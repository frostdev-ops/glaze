const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('glass frame check removes the base page before waiting for transparency', () => {
  const src = fs.readFileSync(path.join(process.env.EXT || path.join(__dirname, '..'), 'scripts/ctab-strip-glass-check.js'), 'utf8');
  const remove = src.indexOf("document.querySelector('#main-content')?.remove()");
  const wait = src.indexOf("await until(() => frame.evaluate(() => document.documentElement.hasAttribute('data-gz-through')");
  assert.ok(remove >= 0 && wait > remove, 'remove the base page before waiting for the course-only frame to become transparent');
});

const { page, record } = require('./sidebar-ultra-page.js');
test('Ultra sidebar clears full announcement and item panel headers', async () => {
  for (const kind of ['announcement', 'item']) {
    const p = page({ at: 'stream', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    const shell = p.el('div', kind === 'announcement' ? 'bb-offcanvas-panel full' : 'course-content-container');
    const panel = p.el('div', 'panel-wrap');
    const header = p.el('header', kind === 'announcement' ? 'panel-header simple-header' : 'panel-header');
    header.box = { left: 200, top: 52, width: 1400, height: 137 };
    panel.append(header); shell.append(panel); p.doc.body.append(shell);
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '189px', kind);
    header.box.height = 160;
    await p.resize(900);
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '212px', `${kind}: drawer follows wrapped title`);
  }
});
