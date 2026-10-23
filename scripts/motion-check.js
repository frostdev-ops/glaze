// Real unpacked extension, synthetic previews, Expressive motion: which animations Chrome runs on the compositor.
// EXT=/path/to/checkout NODE_PATH=/path/to/playwright node scripts/motion-check.js [/path/to/receipt.json]
// A trace (blink.animations) says, for every animation that starts, why it could not composite. Glaze's entrances, its
// card hover lift and its loading pulse must composite; paint-only effects (sprite steps, particles, shine, the 2px
// loading sweeps) and the site's own colour transitions are listed in the receipt but allowed. A dialog must stay on
// screen while it closes, and be gone after.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.resolve(__dirname, '..')), G = require(path.join(ext, 'defaults.js'));
const output = process.argv[2];
const chromeLaunch = require('./check-env.js').chromeLaunch();
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const until = async (fn, check) => { const end = Date.now() + 10000; while (Date.now() < end) { const value = await fn(); if (check(value)) return value; await new Promise((r) => setTimeout(r, 30)); } throw Error('Preview did not settle.'); };
// Paint-only by design: they move a background or a sprite frame, on one hovered card or a 2px line.
const PAINTED = /^gz-(card-(shine|fall|rise|twinkle|confetti)|pet-(idle|act|glow)|ctab-load)$/;
// What a property transition may be: these move, so they must composite.
const MOVES = /^(transform|translate|scale|rotate|opacity)$/;
const CARDS = '.element-card, article.course-element-card, .ic-DashboardCard, [data-region="course-content"].card';

// One record per animation's begin..end (Chrome reuses ids); its 'n' step carries compositeFailed.
const animations = (events) => {
  const open = new Map(), all = [];
  for (const e of events.filter((e) => e.name === 'Animation').sort((a, b) => a.ts - b.ts)) {
    const key = e.id2?.local || e.id, d = e.args?.data || {};
    if (e.ph === 'b') { const a = { name: d.displayName || d.name || '', node: String(d.nodeName || '').slice(0, 80), failed: 0, props: [] }; open.set(key, a); all.push(a); }
    else if (e.ph === 'n' && open.has(key) && d.compositeFailed !== undefined) {
      const a = open.get(key);
      a.failed |= d.compositeFailed;
      a.props = [...new Set([...a.props, ...(d.unsupportedProperties || [])])];
    }
    else if (e.ph === 'e') open.delete(key);
  }
  return all;
};

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-motion-'));
  let context; const receipt = {}, problems = [], errors = [];
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(scratch, { ...chromeLaunch, headless: true, viewport: { width: 1280, height: 850 }, locale: 'en-US', reducedMotion: 'no-preference',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await context.route('**/*', (route) => (route.request().url().startsWith('chrome-extension:') ? route.continue() : route.abort()));
    const settings = G.GZ_SANITIZE({ ...G.GZ_DEFAULTS, motion: { level: 'expressive', followSystem: false, enter: true, hover: true, transitions: true }, enhance: { widgets: true } });
    for (const site of ['ultra', 'canvas', 'moodle']) {
      const page = await context.newPage(); page.on('pageerror', (e) => errors.push(`${site}: ${e}`));
      await page.goto(`chrome-extension://${id}/preview.html?site=${site}`);
      await until(() => page.evaluate(() => document.documentElement.dataset.previewSite), (x) => x === site);
      const view = (v) => page.evaluate(({ settings, site, v }) => {
        window.postMessage({ gzPreview: settings }, location.origin);
        window.postMessage({ gzPreviewContext: { site, page: v, viewport: 'desktop' } }, location.origin);
      }, { settings, site, v });
      await view('courses');
      await until(() => page.evaluate(() => document.documentElement.getAttribute('data-gz-motion')), (m) => m === 'expressive');
      await page.waitForTimeout(1200);
      // Every ambient extra on, so each runs once under the trace.
      await page.evaluate(() => { const h = document.documentElement; h.setAttribute('data-gz-card-hover', 'shine'); h.setAttribute('data-gz-card-particles', 'snow'); });
      const cdp = await context.newCDPSession(page), events = [];
      cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
      const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
      await cdp.send('Tracing.start', { categories: 'blink.animations,devtools.timeline', transferMode: 'ReportEvents' });
      // Entrances (a page change and back), then a hover on each card on screen, at rest between them.
      await view('outline'); await page.waitForTimeout(900); await view('courses'); await page.waitForTimeout(1300);
      const cards = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 40 && r.top > 0 && r.top < innerHeight - 40)
        .slice(0, 4).map((r) => [r.left + r.width / 2, r.top + Math.min(r.height / 2, 60)]), CARDS);
      for (const [x, y] of cards) { await page.mouse.move(x, y, { steps: 4 }); await page.waitForTimeout(500); }
      await page.mouse.move(2, 840, { steps: 4 }); await page.waitForTimeout(700);
      // The previews do not naturally open a panel/tooltip or leave a loading placeholder on screen. Exercise their
      // actual selectors explicitly; absence from a trace is not evidence that an animation composites.
      const placement = await page.evaluate(async (look) => {
        const style = document.createElement('style'); style.textContent = look; document.head.append(style);
        const add = (cls, x, y) => {
          const e = document.createElement('div'); e.className = cls; e.textContent = 'Motion probe';
          Object.assign(e.style, { position: 'fixed', left: '0', top: '0', width: '100px', height: '40px', zIndex: '2147483000', background: '#123456', transform: `translate(${x}px, ${y}px)` });
          document.body.append(e); return e;
        };
        const panel = add('ms-Panel-main', 200, 200), tip = add('tooltip', 400, 200);
        const pulse = add('bg-pulse-grey', 600, 200); pulse.style.animationDuration = '1s'; pulse.style.animationIterationCount = 'infinite';
        const card = add('element-card', 200, 300); card.style.animation = 'var(--gz-x-enter)';
        const animations = [panel, tip, card].map((e) => e.getAnimations()[0]);
        if (animations.some((a) => !a)) throw Error('A placement probe has no entrance');
        // Pause deterministically at the end; the positioning transform must survive every entrance.
        for (const a of animations) { a.pause(); a.currentTime = a.effect.getTiming().duration - 1; }
        const nearEnd = [panel, tip, card].map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y, transform: getComputedStyle(e).transform }));
        for (const a of animations) a.play();
        await new Promise((r) => setTimeout(r, 500));
        const final = [panel, tip, card].map((e) => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y }));
        for (const e of [panel, tip, pulse, card, style]) e.remove();
        return { nearEnd, final };
      }, require(path.join(ext, 'lib/motionx.js')).compile({ 'card.enter': { ms: 250, ease: 'linear', s: [{ at: 0, x: -20, r: -25, sc: 0.8 }, { at: 1, x: 0, r: 0, sc: 1 }] } }));
      if (site !== 'ultra') await page.evaluate(async () => {
        if (!document.startViewTransition) throw Error('View transitions are unavailable');
        await document.startViewTransition(() => { document.body.dataset.motionProbe = 'settled'; }).finished;
      });
      await cdp.send('Tracing.end'); await done;
      const all = animations(events);
      for (const name of ['gz-focus', 'gz-tip', ...(site === 'moodle' ? ['gz-pulse'] : []), ...(site !== 'ultra' ? ['gz-vt-settle'] : [])]) if (!all.some((a) => a.name === name)) problems.push(`${site}: ${name} was not traced`);
      if (!all.some((a) => a.name.startsWith('gz-x-'))) problems.push(`${site}: a Look entrance was not traced`);
      for (const [i, [x, y]] of [[200, 200], [400, 200], [200, 300]].entries()) {
        if (Math.abs(placement.final[i].x - x) > 0.1 || Math.abs(placement.final[i].y - y) > 0.1) problems.push(`${site}: entrance moved the final positioned element ${i}`);
        if (Math.abs(placement.nearEnd[i].x - x) > 1 || Math.abs(placement.nearEnd[i].y - y) > 1) problems.push(`${site}: entrance replaced its positioning transform ${i}`);
      }
      const cardMoves = all.filter((a) => /^(ARTICLE|DIV)\b/.test(a.node) && /card/i.test(a.node) && MOVES.test(a.name));
      if (!cards.length) problems.push(`${site}: no cards on screen to hover`);
      else if (!cardMoves.some((a) => /transform/.test(a.name))) problems.push(`${site}: hovering a card started no transform transition`);
      for (const a of all) {
        if (!a.failed) continue;
        const keyframes = a.name.startsWith('gz-') || a.name.startsWith('gz-x-');
        if (keyframes ? !PAINTED.test(a.name) : MOVES.test(a.name)) problems.push(`${site}: ${a.name} on ${a.node} ran on the main thread (compositeFailed ${a.failed}${a.props.length ? `: ${a.props}` : ''})`);
      }
      // A closing dialog stays up while it fades, then goes: probed a frame in and well after Expressive's --gz-t.
      const dialog = await page.evaluate(async () => {
        const d = document.createElement('dialog'); d.id = 'gz-rm'; d.textContent = 'Reminders'; document.body.append(d);
        const shown = (el) => getComputedStyle(el).display !== 'none';
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        d.showModal(); await frame();
        const enter = Number(getComputedStyle(d).opacity);
        await new Promise((r) => setTimeout(r, 400));
        d.close(); await frame();
        const closing = { shown: shown(d), opacity: Number(getComputedStyle(d).opacity) };
        await new Promise((r) => setTimeout(r, 600));
        const after = shown(d); d.remove();
        return { supports: CSS.supports('overlay', 'auto'), enter, closing, after };
      });
      if (dialog.supports && !(dialog.closing.shown && dialog.closing.opacity > 0 && dialog.closing.opacity < 1)) problems.push(`${site}: a closing dialog did not fade out (${JSON.stringify(dialog.closing)})`);
      if (dialog.after) problems.push(`${site}: a closed dialog stayed on screen`);
      const instant = await page.evaluate(async () => {
        const h = document.documentElement, results = [];
        for (const mode of ['off', 'no-trans']) {
          h.dataset.gzMotion = mode === 'off' ? 'off' : 'expressive'; h.toggleAttribute('data-gz-no-trans', mode === 'no-trans');
          for (const id of ['gz-ce', 'gz-nt']) {
            const d = document.createElement('dialog'); d.id = id; d.textContent = 'Motion probe'; document.body.append(d); d.showModal();
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const enter = Number(getComputedStyle(d).opacity); d.close();
            const display = getComputedStyle(d).display; results.push({ mode, id, enter, display }); d.remove();
          }
        }
        h.dataset.gzMotion = 'expressive'; h.removeAttribute('data-gz-no-trans'); return results;
      });
      for (const r of instant) if (r.enter !== 1 || r.display !== 'none') problems.push(`${site}: dialog must be instant with ${r.mode} (${JSON.stringify(r)})`);

      // WP-V2: Glaze's own UI moving (lib/motion.js). The course tabs for real where the preview draws them (Ultra's and
      // Canvas's tabs page): a keyboard move glides them, a close leaves a fading copy that goes. The dock, the board and To
      // Do don't draw in the previews: the same flip, exit and swap run on probe elements. Everything must composite, and
      // nothing may move at Off.
      const ui = { site };
      const cdp2 = await context.newCDPSession(page), events2 = [];
      cdp2.on('Tracing.dataCollected', (e) => events2.push(...e.value));
      const done2 = new Promise((r) => cdp2.once('Tracing.tracingComplete', r));
      await cdp2.send('Tracing.start', { categories: 'blink.animations,devtools.timeline', transferMode: 'ReportEvents' });
      if (site !== 'moodle') {
        await view('tabs');
        await until(() => page.evaluate(() => document.querySelectorAll('#gz-ctabs .gz-ctab').length), (n) => n >= 3);
        await page.waitForTimeout(300);
        ui.tabs = await page.evaluate(async (closing) => {
          const tabs = () => [...document.querySelectorAll('#gz-ctabs .gz-ctabs-list > .gz-ctab')];
          // Two neighbours in the same group: a pinned tab moves only among the pinned.
          const all = tabs(), ids = all.map((e) => e.dataset.courseId);
          const i = all.findIndex((e, j) => all[j + 1] && e.hasAttribute('data-pin') === all[j + 1].hasAttribute('data-pin'));
          if (i < 0) return { ids, pins: all.map((e) => e.hasAttribute('data-pin')) };
          const first = all[i];
          first.focus();
          first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
          const moved = tabs().map((e) => e.dataset.courseId);
          const gliding = tabs().filter((e) => e.getAnimations().some((a) => a.effect?.getKeyframes().some((k) => k.translate))).length;
          await new Promise((r) => setTimeout(r, 700));
          // Closing a tab: Ultra's preview only (Canvas's preview context has no ctx.acted, which a close reaches).
          if (!closing) return { i, ids, moved, gliding };
          const last = tabs().filter((e) => !e.hasAttribute('data-pin')).at(-1);
          last.focus();
          last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
          const ghosts = document.querySelectorAll('#gz-ctabs [data-gz-ghost]').length;
          const ghostFocusable = [...document.querySelectorAll('#gz-ctabs [data-gz-ghost], #gz-ctabs [data-gz-ghost] *')].some((e) => e.matches('[data-course-id], [id]') || !e.closest('[inert]'));
          await new Promise((r) => setTimeout(r, 700));
          return { i, ids, moved, gliding, ghosts, ghostFocusable, ghostsAfter: document.querySelectorAll('[data-gz-ghost]').length, left: tabs().length };
        }, site === 'ultra');
        if (!ui.tabs.moved || ui.tabs.moved[ui.tabs.i + 1] !== ui.tabs.ids[ui.tabs.i]) problems.push(`${site}: Shift+Arrow did not move a tab (${JSON.stringify(ui.tabs)})`);
        if (ui.tabs.gliding < 2) problems.push(`${site}: a moved tab and its neighbour should glide (${ui.tabs.gliding} did)`);
        if (site === 'ultra' && (ui.tabs.ghosts !== 1 || ui.tabs.ghostFocusable)) problems.push(`${site}: a closed tab should leave one inert copy with no ids (${JSON.stringify(ui.tabs)})`);
        if (ui.tabs.ghostsAfter) problems.push(`${site}: a closed tab's copy stayed`);
        await view('courses');
      }
      ui.lib = await page.evaluate(async () => {
        const M = globalThis.GZ_MOTION, h = document.documentElement, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        if (!M) return { missing: true };
        const box = document.createElement('div');
        box.className = 'gz-probe';
        Object.assign(box.style, { position: 'fixed', left: '300px', top: '120px', width: '220px', zIndex: '2147483000', display: 'grid', gap: '6px' });
        const rows = ['a', 'b', 'c', 'd'].map((n) => Object.assign(document.createElement('div'), { className: `gz-probe-${n}`, textContent: n, style: 'height:30px;background:#345' }));
        box.append(...rows); document.body.append(box);
        const kids = () => [...box.children].filter((e) => !e.hasAttribute('data-gz-ghost'));
        // A reorder (the dock's buttons), a removal with a copy (a closed tab, a ticked task), an exit (the toast).
        M.flip(kids, () => box.prepend(rows[3]), {});
        const moving = kids().filter((e) => e.getAnimations().length).length;
        await wait(450); // a move done before its row goes: a target removed mid-move just stops, which the trace calls a failure
        M.flip(kids, () => rows[1].remove(), { ghosts: true, container: box });
        const ghost = box.querySelectorAll('[data-gz-ghost]').length;
        const going = M.exit(rows[2]); // still gliding up from the removal: it must fade without leaving the compositor
        const inertWhileGoing = rows[2].inert;
        await going; await wait(500);
        const result = { moving, ghost, inertWhileGoing, exited: !rows[2].isConnected, ghostsLeft: box.querySelectorAll('[data-gz-ghost]').length };
        // Off: the same calls change the page and start nothing.
        h.dataset.gzMotion = 'off';
        M.flip(kids, () => box.append(rows[3]), { ghosts: true, container: box });
        const off = kids().some((e) => e.getAnimations().length);
        const t0 = performance.now(); await M.exit(rows[0]);
        result.off = { animated: off, exitMs: Math.round(performance.now() - t0), removed: !rows[0].isConnected };
        h.dataset.gzMotion = 'expressive';
        box.remove();
        // swap: a real crossfade where view transitions exist, its marker gone after.
        let during = false;
        if (document.startViewTransition) { await M.swap(() => { during = h.hasAttribute('data-gz-swap'); }); await wait(700); }
        result.swap = { vt: !!document.startViewTransition, during, after: h.hasAttribute('data-gz-swap') };
        // An abandoned crossfade (skipped here; a resize does the same): the change lands once, the marker clears, and
        // nothing reaches the page as an error (the page's pageerror listener above fails the run).
        if (document.startViewTransition) {
          const real = document.startViewTransition.bind(document);
          let t = null, ran = 0;
          document.startViewTransition = (u) => (t = real(u));
          const going = M.swap(() => { ran++; });
          document.startViewTransition = real;
          t?.skipTransition();
          await going; await wait(300);
          result.abort = { started: !!t, ran, marker: h.hasAttribute('data-gz-swap') };
        }
        return result;
      });
      // A resize in the middle of a crossfade (the browser may abort it): no page errors either.
      await page.evaluate(() => { globalThis.GZ_MOTION?.swap(() => document.documentElement.style.setProperty('--gz-probe', '1')); });
      await page.waitForTimeout(50); await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(500);
      await page.setViewportSize({ width: 1280, height: 850 }); await page.waitForTimeout(300);
      await cdp2.send('Tracing.end'); await done2;
      const l = ui.lib;
      if (l.missing) problems.push(`${site}: lib/motion.js is not on the preview`);
      else {
        if (l.moving < 4) problems.push(`${site}: a reorder should glide every row (${l.moving})`);
        if (l.ghost !== 1 || l.ghostsLeft) problems.push(`${site}: a removal should leave one copy that goes (${l.ghost}, ${l.ghostsLeft} left)`);
        if (!l.inertWhileGoing || !l.exited) problems.push(`${site}: an exit should be inert while it goes, then removed`);
        if (l.off.animated || l.off.exitMs > 50 || !l.off.removed) problems.push(`${site}: at Off nothing may move (${JSON.stringify(l.off)})`);
        if (l.swap.vt && (!l.swap.during || l.swap.after)) problems.push(`${site}: swap should crossfade and clear its marker (${JSON.stringify(l.swap)})`);
        if (l.abort && (!l.abort.started || l.abort.ran !== 1 || l.abort.marker)) problems.push(`${site}: an abandoned crossfade should still land once and clear its marker (${JSON.stringify(l.abort)})`);
      }
      ui.animations = {};
      for (const a of animations(events2)) {
        const k = `${a.failed ? 'main' : 'compositor'} ${a.name || '(script)'} @ ${a.node.slice(0, 40)}`;
        ui.animations[k] = (ui.animations[k] || 0) + 1;
        if (a.failed && /gz-ctab|probe|view-transition/i.test(a.node) && !PAINTED.test(a.name) && !a.name.startsWith('-ua-')) problems.push(`${site}: ${a.name || 'a script animation'} on ${a.node} ran on the main thread (compositeFailed ${a.failed}${a.props.length ? `: ${a.props}` : ''})`);
      }
      const summary = {};
      for (const a of all) { const k = `${a.failed ? 'main' : 'compositor'} ${a.name}${a.props.length ? ` [${a.props}]` : ''}`; summary[k] = (summary[k] || 0) + 1; }
      receipt[site] = { ui, cardsHovered: cards.length, cardMoves: cardMoves.map((a) => `${a.name}:${a.failed ? 'main' : 'compositor'}`), placement, dialog, instant, animations: summary };
      await page.close();
    }
    if (output) fs.writeFileSync(output, JSON.stringify({ source: ext, receipt, problems, errors }, null, 2));
    if (errors.length) problems.push(...errors);
    if (problems.length) throw Error(problems.join('\n'));
    console.log(`Motion on 3 sites: entrances, hover lifts, dialogs, tab moves and Glaze's own flips, exits and swaps composite or fade as they should.${output ? ` Receipt: ${output}` : ''}`);
  } finally { await context?.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
