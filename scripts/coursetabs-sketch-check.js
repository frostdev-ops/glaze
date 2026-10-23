// Sketch cost on Ultra's real layout, scaled from 40 to 5,000 course items. Headless, under nice, one browser at a time.
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/coursetabs-sketch-check.js [metrics.json]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(process.env.GZ_SKETCH_SOURCE || path.join(root, 'lib/coursetabs.js'), 'utf8');
const fixture = fs.readFileSync(path.join(root, 'test/fixtures/ultra-course.html'), 'utf8');
(async () => {
  let ctx, tmp;
  const results = [];
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sketch-cost-'));
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(tmp, { ...require('./check-env.js').chromeLaunch(), headless: true,
      viewport: { width: 1280, height: 860 }, args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await ctx.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/ultra/')
      ? r.fulfill({ contentType: 'text/html', body: fixture }) : r.abort());
    const page = await ctx.newPage();
    await page.goto('https://bb.school.test/ultra/courses/_101_1/outline');
    await page.waitForSelector('.content-list-item');
    for (const file of ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js']) await page.addScriptTag({ path: path.join(root, file) });
    await page.addScriptTag({ content: source });
    assert.equal(await page.evaluate(() => typeof GZ_CTABS_LIB?.sketch), 'function', 'the normal library bootstrap is loaded');
    for (const count of [40, 5000]) {
      await page.evaluate((count) => {
        const list = document.querySelector('.makeStylescontentList-0-2-14'), item = list.lastElementChild.cloneNode(true);
        while (list.children.length < count) list.append(item.cloneNode(true));
      }, count);
      for (const position of ['top', 'middle', 'bottom']) {
        await page.evaluate((position) => { const scroller = document.querySelector('.course-content-container > .panel-wrap');
          scroller.scrollTop = position === 'top' ? 0 : position === 'middle' ? scroller.scrollHeight / 2 : scroller.scrollHeight; }, position);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const measured = await page.evaluate(() => {
          const rect = Element.prototype.getBoundingClientRect, computed = window.getComputedStyle;
          const points = document.elementsFromPoint.bind(document), hit = document.elementFromPoint.bind(document);
          const colourCache = new Map(), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const paint = canvas.getContext('2d', { willReadFrequently: true });
          const colour = (css) => {
            if (!colourCache.has(css)) { paint.clearRect(0, 0, 1, 1); paint.fillStyle = '#0000'; paint.fillStyle = css; paint.fillRect(0, 0, 1, 1);
              const rgba = [...paint.getImageData(0, 0, 1, 1).data]; colourCache.set(css, rgba[3] < 8 ? null : '#' + rgba.map((v) => v.toString(16).padStart(2, '0')).join('')); }
            return colourCache.get(css);
          };
          let counts, boxes;
          Element.prototype.getBoundingClientRect = function() { counts.walked++; return rect.call(this); };
          window.getComputedStyle = (...a) => { counts.styles++; return computed(...a); };
          document.elementsFromPoint = (...a) => { counts.points++; return points(...a); };
          document.elementFromPoint = (...a) => { counts.hits++; return hit(...a); };
          const samples = [];
          try {
            for (let i = 0; i < 12; i++) {
              counts = { walked: 0, styles: 0, points: 0, hits: 0 };
              const start = performance.now();
              boxes = GZ_CTABS_LIB.sketch(document, { w: innerWidth, h: innerHeight, name: 'Computer Science I', colour });
              samples.push({ ms: performance.now() - start, ...counts });
            }
          } finally {
            Element.prototype.getBoundingClientRect = rect; window.getComputedStyle = computed;
            document.elementsFromPoint = points; document.elementFromPoint = hit;
          }
          return { elements: document.querySelectorAll('*').length, boxes: boxes.length,
            content: boxes.filter(([x, y, , , k]) => x > 220 && y > 200 && 'th'.includes(k)).length,
            valid: !!GZ_CTABS_LIB.clip({ size: [innerWidth, innerHeight], top: 0, name: 'Computer Science I', strip: null, boxes }), samples };
        });
        const row = { items: count, position, ...measured };
        results.push(row);
        assert.ok(row.valid && row.boxes > 0 && row.boxes <= 60, JSON.stringify(row));
        for (const s of row.samples) {
          assert.ok(s.walked <= count + 550, `off-screen row subtrees must be pruned: ${JSON.stringify(row)}`);
          assert.ok(s.styles <= 550, `computed styles must stay tied to visible content: ${JSON.stringify(row)}`);
          assert.equal(s.points, 108);
          assert.ok(s.hits <= 200, `occlusion probes must stay tied to candidates: ${JSON.stringify(row)}`);
        }
        const times = row.samples.map((s) => s.ms).sort((a, b) => a - b);
        console.log(`${count} items / ${row.elements} elements / ${position}: median=${((times[5] + times[6]) / 2).toFixed(2)}ms p95=${times[11].toFixed(2)}ms; walked=${Math.max(...row.samples.map((s) => s.walked))} styles=${Math.max(...row.samples.map((s) => s.styles))} points=108 hits=${Math.max(...row.samples.map((s) => s.hits))} boxes=${row.boxes}`);
      }
    }
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
    assert.ok(results.find((r) => r.items === 5000 && r.position === 'bottom').content >= 4, 'the last visible course rows survive thousands of preceding off-screen rows');
    console.log('passed; sketch cost and viewport work bounds on 40 and 5000 Ultra course items');
  } finally {
    await ctx?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
