// Cross-world view-transition regressions: exercise the worker's real MAIN-world guard in a bare extension.
// Run on the browser runner: node scripts/transition-guard-check.js /out
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromeLaunch, lockPath } = require('./check-env.js');
const out = process.argv[2];
const source = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
const start = source.indexOf('const transitionGuard = ');
if (start < 0) throw Error('missing transitionGuard');
const guard = source.slice(start, source.indexOf('\n};', start) + 3);
const rows = [];
const check = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`); };

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-transition-guard-'));
  const lock = lockPath();
  let context, held = false;
  try {
    fs.mkdirSync(lock); held = true;
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ntransition-guard-check\n`);
    const ext = path.join(scratch, 'extension'); fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Transition guard check', version: '1',
      content_scripts: [
        { matches: ['https://vt.test/*'], js: ['main.js'], run_at: 'document_start', world: 'MAIN', all_frames: true },
        { matches: ['https://vt.test/*'], js: ['isolated.js'], run_at: 'document_start', all_frames: true },
      ] }));
    fs.writeFileSync(path.join(ext, 'main.js'), `
      // A school listener installed before the guard. The handoff must reach the guard first.
      addEventListener('glaze:transition', (e) => {
        if (location.search === '?nested' && !e.cancelable) {
          const vt = document.startViewTransition(() => {});
          vt.ready.catch(() => {});
        }
      });
      globalThis.guardListeners = 0;
      const add = window.addEventListener.bind(window);
      window.addEventListener = (...args) => { if (args[0] === 'glaze:transition') guardListeners++; return add(...args); };
      ${guard}
      transitionGuard(); transitionGuard();
    `);
    fs.writeFileSync(path.join(ext, 'isolated.js'), `
      addEventListener('vt-probe', (e) => {
        const mode = e.detail;
        const before = !dispatchEvent(new Event('glaze:transition', { cancelable: true }));
        document.documentElement.setAttribute('data-guard', String(before));
        if (!before) return;
        const vt = document.startViewTransition(mode === 'timeout' || mode === 'fallback' ? () => new Promise(() => {}) : () => {});
        for (const p of [vt.ready, vt.finished, vt.updateCallbackDone]) p.catch(() => {});
        dispatchEvent(new Event('glaze:transition'));
        if (mode === 'fallback') setTimeout(() => vt.skipTransition(), 100);
        else if (mode !== 'timeout' && mode !== 'nested') vt.skipTransition();
      });
    `);
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), { ...chromeLaunch(), headless: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking'] });
    await context.route('https://vt.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Transition guard</title><h1>Page</h1>' }));
    const page = context.pages()[0];
    let errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const open = async (mode) => { await page.goto(`https://vt.test/?${mode}`); errors = []; };
    for (const mode of ['skip', 'fallback', 'nested', 'timeout']) {
      await open(mode);
      check(`${mode}: one guard listener per document`, await page.evaluate(() => guardListeners === 1), await page.evaluate(() => guardListeners));
      await page.evaluate((mode) => dispatchEvent(new CustomEvent('vt-probe', { detail: mode })), mode);
      await page.waitForTimeout(mode === 'timeout' ? 5000 : 300);
      const acknowledged = await page.evaluate(() => document.documentElement.getAttribute('data-guard'));
      check(`${mode}: isolated transition handled in MAIN`, acknowledged === 'true' && !errors.length, { acknowledged, errors: [...errors] });
    }
    await open('school');
    await page.evaluate(() => {
      const vt = document.startViewTransition(() => {});
      dispatchEvent(new Event('glaze:transition', { cancelable: true }));
      vt.skipTransition(); // The school intentionally leaves its own ready unhandled.
    });
    await page.waitForTimeout(200);
    check('presence probe leaves the school rejection observable', errors.length === 1 && /skipTransition/.test(errors[0]), [...errors]);
    await open('tamper');
    await page.evaluate(() => {
      Object.defineProperty(document, 'activeViewTransition', { get() { throw Error('page replaced getter'); } });
      dispatchEvent(new Event('glaze:transition'));
    });
    await page.waitForTimeout(200);
    check('page instrumentation cannot make the guard throw', !errors.length, [...errors]);
    await open('frame');
    const loaded = page.waitForEvent('framenavigated', { predicate: (f) => f.parentFrame() !== null });
    await page.evaluate(() => { const f = document.createElement('iframe'); f.src = 'https://vt.test/?skip'; document.body.append(f); });
    const frame = await loaded;
    if (!frame) throw Error('frame did not load');
    await frame.waitForLoadState();
    await frame.evaluate(() => dispatchEvent(new CustomEvent('vt-probe', { detail: 'skip' })));
    await page.waitForTimeout(200);
    check('a course frame has its own functioning guard', await frame.evaluate(() => guardListeners === 1 && document.documentElement.getAttribute('data-guard') === 'true') && !errors.length, [...errors]);
  } finally {
    await context?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'transition-guard.json'), JSON.stringify(rows, null, 2)); }
  }
  if (rows.some((r) => !r.ok)) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
