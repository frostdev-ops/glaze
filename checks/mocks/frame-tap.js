// tap(frame, selector): a student's click in Writer's frame, for the Writer checks (writer-submit-check.js, writer-kinds-check.js).
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// A student's click on something in Writer's frame, made as one: the element settled where it is (nothing animating on it or
// its ancestors, the same box three polls running), in sight in the page, and the top thing at its centre both in the frame
// (elementFromPoint there: no part of Writer covers it) and in the page (the frame itself there); then the mouse there, and
// the click heard by that element. Headless Chromium sometimes gives a press over the frame to the page's <iframe> element
// instead (most often just after a sheet opens, and under load): the frame hears nothing, so nothing happened, and the press
// is made again. taps counts the presses made again, for the summary.
const taps = { made: 0, again: [] };
const AIM = (el) => {
  const name = (x) => (x ? `${x.tagName.toLowerCase()}${x.className && typeof x.className === 'string' ? `.${x.className.trim().split(/\s+/).join('.')}` : ''}` : 'nothing');
  for (let e = el; e; e = e.parentElement) if (e.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming?.().iterations !== Infinity)) return { why: `${name(e)} animating` };
  const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (!r.width || !r.height) return { why: 'not shown' };
  if (el.disabled) return { why: 'disabled' };
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); return { why: 'outside the frame, scrolled' }; }
  const top = document.elementFromPoint(x, y);
  if (!top || (top !== el && !el.contains(top))) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return { why: `covered by ${name(top)}` }; }
  return { x, y, box: [r.left, r.top, r.width, r.height].map(Math.round).join() };
};
const PLACE = (f, a) => {
  const r = f.getBoundingClientRect(), x = r.left + f.clientLeft + a.x, y = r.top + f.clientTop + a.y;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    let s = f.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    (s || document.scrollingElement).scrollBy(0, y - innerHeight / 2);
    return { why: 'outside the page\'s window, scrolled' };
  }
  const top = document.elementFromPoint(x, y);
  if (top !== f) return { why: `the page has ${top?.tagName.toLowerCase() || 'nothing'} over the frame there` };
  return { x, y, box: `${[r.left, r.top, r.width, r.height].map(Math.round).join()}|${a.box}` };
};
const HEAR = (el) => {
  if (!window.__tapOn) {
    window.__tapOn = true;
    addEventListener('click', (e) => { const t = window.__tap; if (!t) return; if (t.el === e.target || t.el.contains(e.target)) t.heard++; else t.other.push(`${e.target?.className || e.target?.tagName}@${Math.round(e.clientX)},${Math.round(e.clientY)}`); }, true);
  }
  window.__tap = { el, heard: 0, other: [] };
};
const MISS = (f) => {
  if (!window.__tapOn) { window.__tapOn = true; addEventListener('click', (e) => { window.__tapMiss.push(e.target === window.__tapFrame ? 'iframe' : `${e.target?.tagName?.toLowerCase()}.${String(e.target?.className || '').slice(0, 40)}`); }, true); }
  window.__tapFrame = f; window.__tapMiss = [];
};
const tap = async (fr, sel, { count = 1 } = {}) => {
  const p = fr.page(), frame = await fr.frameElement();
  for (let attempt = 1; ; attempt++) {
    let why = 'not in the frame', was = '', same = 0, at = null, aim = null;
    for (const end = Date.now() + 20000; !at; await pause(80)) {
      if (Date.now() > end) throw Error(`${sel}: not clickable (${why})`);
      const h = await fr.$(sel).catch(() => null);
      const a = h && await h.evaluate(AIM).catch((e) => ({ why: e.message }));
      if (!a) { why = 'not in the frame'; continue; }
      if (a.why) { why = a.why; was = ''; continue; }
      const place = await frame.evaluate(PLACE, a);
      if (place.why) { why = place.why; was = ''; continue; }
      // The same box three polls running: a frame Writer resizes in steps (a view switch, then its box) has settled.
      if (place.box !== was) { why = 'moving'; was = place.box; same = 0; continue; }
      if (++same < 2) continue;
      await h.evaluate(HEAR);
      at = place; aim = a;
    }
    await frame.evaluate(MISS);
    taps.made++;
    await p.mouse.click(at.x, at.y, { clickCount: count });
    let heard = null;
    for (const end = Date.now() + 15000; !heard && Date.now() < end; await pause(40)) {
      const t = await fr.evaluate(() => window.__tap && { heard: window.__tap.heard, other: window.__tap.other.slice() }).catch(() => null);
      if (t?.heard) heard = 'heard';
      else if (t?.other.length) heard = `landed on ${t.other.join(', ')}`;
      else {
        const miss = await p.evaluate(() => window.__tapMiss);
        if (miss.includes('iframe')) heard = 'given to the page\'s <iframe>';
        else if (miss.length) heard = `landed in the page on ${miss.join(', ')}`;
      }
    }
    if (heard === 'heard') return;
    if (!heard) throw Error(`${sel}: the click reached nothing`);
    if (heard !== 'given to the page\'s <iframe>') throw Error(`${sel}: ${heard} (aimed at ${Math.round(aim.x)},${Math.round(aim.y)} in the frame; ${Math.round(at.x)},${Math.round(at.y)} in the page)`);
    taps.again.push(`${sel}: ${heard} (aimed at ${Math.round(aim.x)},${Math.round(aim.y)} in the frame)`);
    console.log(`tap retry: ${taps.again.at(-1)}`);
    if (attempt >= 5) throw Error(`${sel}: ${attempt} clicks, none heard (${taps.again.slice(-attempt).join('; ')})`);
    // What the browser routes by is stale until the page re-lays the frame out (a repaint inside it doesn't do): its width
    // a pixel less for two frames, then as it was.
    await frame.evaluate(async (f) => {
      const two = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), was = f.style.width;
      f.style.width = `${f.getBoundingClientRect().width - 1}px`; await two();
      f.style.width = was; await two();
    });
  }
};

module.exports = { tap, taps };
