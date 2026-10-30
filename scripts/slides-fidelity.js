// Does the slides viewer draw a deck as PowerPoint does? Exports each slide of a .pptx to PNG with Microsoft PowerPoint on
// this Mac (AppleScript), draws the same slides headless with lib/slides-render.js at the PNG's size, and compares them pixel
// by pixel: a pixel differs when its channels differ by more than --tolerance in sum (default 96 of 765), a slide passes
// when under --max of its pixels differ (default 0.02: a different slide of mostly white differs by as little as 3%; set
// it from the first PowerPoint run). Writes ppt-<n>.png, glaze-<n>.png, diff-<n>.png (the differing
// pixels in red over a faint copy of PowerPoint's) and fidelity.json. The deck is closed
// unsaved; PowerPoint quits only if this script started it, and the script won't start while PowerPoint is running
// (--force overrides: it then opens the deck in the session in use).
// The terminal running it needs macOS's Automation permission for PowerPoint (System Settings → Privacy & Security →
// Automation); its prompt was unanswered at the first run (2026-10-30), so no export has run end to end yet. Without PowerPoint:
//   --render-only writes the Glaze PNGs alone; --reference <folder> compares with PNGs already made (Slide1.png, … or any
//   names numbered consecutively from 1, including hidden slides) instead of exporting. Incomplete references are refused.
// NODE_PATH=<playwright> node scripts/slides-fidelity.js <deck.pptx | unzipped deck folder> [out folder] [--reference <folder>]
//   [--render-only] [--tolerance 96] [--max 0.02] [--force]
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2), flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; }, has = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const reference = flag('--reference'), tolerance = Number(flag('--tolerance') ?? 96), max = Number(flag('--max') ?? 0.02), renderOnly = has('--render-only'), force = has('--force');
const [input, outArg] = args;
if (!input) { console.error('usage: node scripts/slides-fidelity.js <deck.pptx | deck folder> [out folder] [--reference <folder>] [--render-only] [--tolerance n] [--max f] [--force]'); process.exit(2); }
const out = path.resolve(outArg || path.join(os.tmpdir(), 'gz-slides-fidelity'));
const POWERPOINT = '/Applications/Microsoft PowerPoint.app';
const osa = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 300000 }).trim();
const running = () => { try { execFileSync('pgrep', ['-x', 'Microsoft PowerPoint']); return true; } catch { return false; } };

// The deck's bytes: the file, or a package folder zipped as test/pptx.test.js zips the fixture.
const deckBytes = () => {
  const p = path.resolve(input);
  if (fs.statSync(p).isFile()) return fs.readFileSync(p);
  const Z = require(path.join(root, 'lib/zip.js'));
  const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.DS_Store')
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${base}${e.name}/`) : [[`${base}${e.name}`, fs.readFileSync(path.join(d, e.name))]]));
  return Buffer.concat(Z.zip(walk(p).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, data]) => ({ name, data: new Uint8Array(data), date: new Date(2026, 9, 30, 12) }))));
};
// PNGs in slide order: the number in each name.
const numbered = (dir) => {
  const all = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.png$/i.test(e.name)) all.push(f); } };
  walk(dir);
  const slides = all.map((f) => ({ f, n: Number(/(\d+)(?=\D*\.png$)/i.exec(path.basename(f))?.[1] ?? NaN) })).filter((x) => Number.isFinite(x.n)).sort((a, b) => a.n - b.n);
  if (!slides.length) throw Error(`No numbered PNG reference under ${dir}`);
  if (slides.some((s, i) => s.n !== i + 1)) throw Error('PNG references must number every slide from 1, including hidden slides, with no gaps or duplicate slide numbers');
  return slides.map((x) => x.f);
};

// PowerPoint's own pictures of the slides, made in a folder inside its container so the sandboxed app may write there.
const exportWithPowerPoint = (bytes) => {
  if (!fs.existsSync(POWERPOINT)) throw Error('Microsoft PowerPoint is not installed');
  if (running() && !force) throw Error('PowerPoint is open: run this when PowerPoint is free (or pass --force)');
  const box = path.join(os.homedir(), 'Library/Containers/com.microsoft.Powerpoint/Data/tmp');
  fs.mkdirSync(box, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(box, 'glaze-fidelity-')), deck = path.join(tmp, 'deck.pptx'), pngs = path.join(tmp, 'png');
  fs.writeFileSync(deck, bytes);
  const started = !running();
  try {
    osa(`tell application "Microsoft PowerPoint"
  open POSIX file "${deck}"
  set p to active presentation
  save p in POSIX file "${pngs}" as save as PNG file
  close p saving no
end tell`);
    const files = numbered(fs.existsSync(pngs) ? pngs : tmp);
    if (!files.length) throw Error(`PowerPoint wrote no PNG under ${tmp}`);
    return files.map((f) => fs.readFileSync(f));
  } finally {
    if (started) { try { osa('tell application "Microsoft PowerPoint" to quit saving no'); } catch { /* already gone */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

// A page of the renderer's files alone (no extension), with the vendored fonts under the names writer-paper.css gives them.
const stagePage = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-slides-fidelity-'));
  fs.mkdirSync(path.join(dir, 'lib/fonts'), { recursive: true });
  for (const f of ['lib/doctext.js', 'lib/pptx.js', 'lib/pptx-geom.js', 'lib/slides-render.js', 'writer-paper.css']) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  for (const f of fs.readdirSync(path.join(root, 'lib/fonts'))) fs.copyFileSync(path.join(root, 'lib/fonts', f), path.join(dir, 'lib/fonts', f));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="writer-paper.css">'
    + '<body style="margin:0;background:#fff"><script src="lib/doctext.js"></script><script src="lib/pptx-geom.js"></script><script src="lib/pptx.js"></script><script src="lib/slides-render.js"></script>');
  return dir;
};

(async () => {
  let browser, page = null, dir = null;
  const results = [];
  try {
    const bytes = deckBytes();
    fs.mkdirSync(out, { recursive: true });
    const ppt = renderOnly ? [] : reference ? numbered(path.resolve(reference)).map((f) => fs.readFileSync(f)) : exportWithPowerPoint(bytes);
    const { chromium } = require('playwright');
    browser = await chromium.launch({ ...require('./check-env.js').chromeLaunch(), headless: true });
    page = await browser.newPage({ deviceScaleFactor: 1 });
    dir = stagePage();
    await page.goto(`file://${dir}/index.html`);
    const info = await page.evaluate(async (b64) => {
      const bin = atob(b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      globalThis.deck = await GZ_PPTX.read(u);
      globalThis.media = new Map();
      for (const m of deck.media) { const b = await GZ_PPTX.media(u, m.path); if (b) media.set(m.path, URL.createObjectURL(new Blob([b], { type: m.mime }))); }
      return { n: deck.slides.length, w: GZ_SLIDES_RENDER.px(deck.size.w), h: GZ_SLIDES_RENDER.px(deck.size.h), cut: deck.cut };
    }, bytes.toString('base64'));
    if (!info.n) throw Error('The deck has no readable slides');
    if (!renderOnly && ppt.length !== info.n) throw Error(`PowerPoint reference has ${ppt.length} PNGs for ${info.n} slides; export every slide, including hidden slides`);
    const count = info.n;
    for (let i = 0; i < count; i++) {
      // Glaze's picture at PowerPoint's size (else the slide's own: 96 px to the inch).
      const want = ppt[i] ? await page.evaluate(async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return { w: img.naturalWidth, h: img.naturalHeight }; }, ppt[i].toString('base64')) : { w: Math.round(info.w), h: Math.round(info.h) };
      await page.setViewportSize({ width: want.w, height: want.h });
      await page.evaluate(({ i, w }) => {
        document.body.replaceChildren(GZ_SLIDES_RENDER.stage(deck.slides[i], deck, { document, media, scale: w / GZ_SLIDES_RENDER.px(deck.size.w), labels: { chart: 'Chart', smartart: 'Diagram', ole: 'Object', picture: 'Picture', media: 'Video', table: 'Table' } }));
        return document.fonts.ready;
      }, { i, w: want.w });
      const glaze = await page.screenshot({ clip: { x: 0, y: 0, width: want.w, height: want.h } });
      fs.writeFileSync(path.join(out, `glaze-${i + 1}.png`), glaze);
      if (!ppt[i]) continue;
      fs.writeFileSync(path.join(out, `ppt-${i + 1}.png`), ppt[i]);
      // The two pictures' pixels side by side in a canvas: the share that differ, and a picture of where.
      const d = await page.evaluate(async ({ a, b, tolerance }) => {
        const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return img; };
        const [x, y] = await Promise.all([load(a), load(b)]), w = x.naturalWidth, h = x.naturalHeight;
        const pixels = (img) => { const c = new OffscreenCanvas(w, h), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
        const p = pixels(x), q = pixels(y), c = new OffscreenCanvas(w, h), g = c.getContext('2d'), diff = g.createImageData(w, h);
        let bad = 0;
        for (let k = 0; k < p.length; k += 4) {
          const off = Math.abs(p[k] - q[k]) + Math.abs(p[k + 1] - q[k + 1]) + Math.abs(p[k + 2] - q[k + 2]) > tolerance;
          if (off) bad++;
          const l = 255 - (255 - (p[k] + p[k + 1] + p[k + 2]) / 3) * 0.25;
          diff.data.set(off ? [230, 0, 0, 255] : [l, l, l, 255], k);
        }
        g.putImageData(diff, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' }), buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
        return { share: bad / (w * h), png: btoa(s) };
      }, { a: ppt[i].toString('base64'), b: glaze.toString('base64'), tolerance });
      fs.writeFileSync(path.join(out, `diff-${i + 1}.png`), Buffer.from(d.png, 'base64'));
      results.push({ slide: i + 1, differ: Math.round(d.share * 1e4) / 1e4, pass: d.share < max });
      console.log(`${d.share < max ? 'ok' : 'FAIL'} slide ${i + 1}: ${(d.share * 100).toFixed(2)}% of pixels differ`);
    }
    fs.writeFileSync(path.join(out, 'fidelity.json'), JSON.stringify({ deck: path.resolve(input), size: [info.w, info.h], cut: info.cut, tolerance, max, renderOnly, reference: reference && path.resolve(reference), results }, null, 2) + '\n');
    if (results.some((r) => !r.pass)) process.exitCode = 1;
    console.log(renderOnly ? `rendered ${count} slides into ${out}` : `${results.filter((r) => r.pass).length} of ${results.length} slides within ${max * 100}% (${out})`);
  } catch (e) {
    console.error(e.message || e);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
})();
