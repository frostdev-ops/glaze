// Rendered-text safety for Ask's per-turn capture, using invented LMS content only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const out = process.argv[2];
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route('https://school.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>Essay</title><div id="assignment_show"><div class="description">Visible directions<span hidden>ANSWER KEY SECRET</span><span style="display:none">HIDDEN SECRET</span></div></div><div hidden>Unrelated hidden data</div>' }));
    await page.goto('https://school.test/courses/7/assignments/21');
    await page.evaluate(() => { globalThis.GZ_CTX = { site: 'canvas', canvasCourseId: () => /^\/courses\/(\d+)/.exec(location.pathname)?.[1] }; });
    await page.addScriptTag({ path: path.join(__dirname, '../../extension/ai/page/current-view.js') });
    const capture = () => page.evaluate(() => GZ_ASK_CURRENT.capture());
    const first = await capture();
    assert.equal(first.current.material.text, 'Visible directions');
    await page.evaluate(() => { document.querySelector('.description').style.visibility = 'hidden'; });
    assert.equal((await capture()).current.material, undefined);
    await page.evaluate(() => { document.querySelector('.description').style.visibility = ''; document.querySelector('#assignment_show').hidden = true; });
    assert.equal((await capture()).current.material, undefined);
    await page.evaluate(() => { history.pushState({}, '', '/courses/8/quizzes/99'); document.querySelector('#assignment_show').hidden = false; });
    const quiz = await capture();
    assert.equal(quiz.current.course.id, '8'); assert.equal(quiz.current.assignment, undefined); assert.equal(quiz.current.material, undefined);
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'current-capture.json'), JSON.stringify({ passed: 4, first, quiz }, null, 2)); }
    console.log('current-capture: 4 passed');
  } finally { await browser?.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
