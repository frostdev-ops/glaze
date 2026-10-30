// What a mod shows: the component tree a data mod's Worker sends with glaze.ui.render(slot, tree), or the one Glaze makes
// from a declarative widget's blocks (features/modwidgets.js, on every browser), drawn by Glaze in a
// closed shadow root of the slot. The tree arrives cleaned (lib/modapi.js, in the worker's broker); it is drawn with
// createElement, textContent, fixed attribute names and style.setProperty only, never from markup, and themed by the
// palette Glaze wears (--gz-* on <html> reach into the shadow root). Buttons and inputs say what happened through
// send(kind, id, value) (features/mods.js routes it to that mod as a 'ui' event). The tree's canvas is the one element
// kept from one drawing to the next, since its control has gone to the mod's Worker (features/mods.js). Pictures are the
// mod's own files, decoded here and drawn on a canvas, so no address of the mod's choosing ever loads. Classic script,
// loaded on demand by features/mods.js and features/modwidgets.js; a second injection keeps the first.
var GZ_MODUI = globalThis.GZ_MODUI || (() => {
  const SVG = 'http://www.w3.org/2000/svg';
  const CSS = `:host{display:block;color:var(--gz-ink,inherit);font:inherit;min-width:0}
*{box-sizing:border-box}
.stack,.row{display:flex;gap:calc(var(--g,2) * 4px);min-width:0}.stack{flex-direction:column}.row{flex-direction:row;align-items:center}.row.wrap{flex-wrap:wrap}
[data-align=start]{align-items:flex-start}[data-align=center]{align-items:center}[data-align=end]{align-items:flex-end}[data-align=stretch]{align-items:stretch}
p{margin:0;white-space:pre-line;overflow-wrap:anywhere}.xs{font-size:.75em}.s{font-size:.875em}.l{font-size:1.25em}.xl{font-size:1.6em;line-height:1.2}.bold{font-weight:700}
.muted{color:var(--gz-ink-muted)}.tint{color:var(--c)}
.num{display:flex;flex-direction:column}.num b{font-size:1.6em;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--c,inherit)}.num span{color:var(--gz-ink-muted);font-size:.8em}
ul,ol{margin:0;padding-inline-start:1.2em;display:flex;flex-direction:column;gap:4px}
.ring{display:inline-flex;align-items:center;gap:8px}.ring svg{width:56px;height:56px;transform:rotate(-90deg)}
.ring circle{fill:none;stroke-width:6}.ring .track{stroke:var(--gz-line)}.ring .fill{stroke:var(--c,var(--gz-accent));stroke-linecap:round}
.bar{display:flex;flex-direction:column;gap:4px}.bar i{display:block;height:8px;border-radius:4px;background:var(--gz-line);overflow:hidden}
.bar i::after{content:"";display:block;height:100%;width:var(--p);background:var(--c,var(--gz-accent));border-radius:4px}
.time{font-variant-numeric:tabular-nums}
button,input,select{font:inherit;color:var(--gz-ink);background:var(--gz-surface);border:1px solid var(--gz-line-strong);border-radius:8px;padding:6px 10px;min-height:32px}
button{cursor:pointer}button.primary{background:var(--gz-accent);color:var(--gz-accent-ink);border-color:transparent}button:disabled,input:disabled,select:disabled{opacity:.5;cursor:default}
:is(button,input,select,canvas):focus-visible{outline:2px solid var(--gz-accent);outline-offset:2px}
label{display:flex;flex-direction:column;gap:4px;font-size:.875em}label.check{flex-direction:row;align-items:center;gap:8px}
input[type=checkbox]{min-height:0;width:18px;height:18px;accent-color:var(--gz-accent)}
canvas{display:block;max-width:100%}canvas.draw{width:100%}
:host-context(html[data-gz-motion=off]) *{transition:none!important;animation:none!important}`;
  let sheet = null;
  const style = (root) => {
    try { sheet ||= Object.assign(new CSSStyleSheet(), {}); if (!sheet.cssRules.length) sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch { const s = document.createElement('style'); s.textContent = CSS; root.prepend(s); } // a browser without adoptable sheets
  };
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const tint = (e, c) => { if (c) { e.style.setProperty('--c', c[0] === '#' ? c : `var(--gz-${c})`); e.classList.add('tint'); } };
  const fmt = (v, digits) => new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: digits ?? 2, minimumFractionDigits: digits ?? 0 }).format(v);
  const share = (v, max = 100) => Math.max(0, Math.min(1, v / max));

  // ---- countdowns: one timer for all, to the next change, only while the page is shown ------------------------------------
  const clocks = new Set();
  let tick = 0;
  const left = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const turn = () => {
    clearTimeout(tick);
    tick = 0;
    const now = Date.now();
    let next = Infinity;
    for (const c of clocks) {
      if (!c.el.isConnected) { clocks.delete(c); continue; }
      const ms = c.to - now;
      const text = ms > 0 ? left(ms) : c.done || left(0);
      if (c.el.textContent !== text) c.el.textContent = text;
      if (ms > 0) next = Math.min(next, ms >= 3600000 ? ms % 60000 || 60000 : ms % 1000 || 1000);
    }
    if (clocks.size && next < Infinity && !document.hidden) tick = setTimeout(turn, next + 5);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) turn(); });

  // ---- one tree ------------------------------------------------------------------------------------------------------------
  // root: the slot's shadow root. o: { slot, send(kind, id, value), asset(path) → Promise<ImageBitmap>, canvas: the slot's
  // kept canvas element or null }. → { canvas: the tree's canvas element (the kept one when there was one) or null }.
  const render = (root, tree, o) => {
    const was = root.activeElement?.dataset.id;
    const caret = root.activeElement?.selectionStart;
    let canvas = null;
    const node = (n) => {
      const kids = () => n.children.map(node);
      switch (n.type) {
        case 'stack': case 'row': {
          const e = make('div', `${n.type}${n.wrap ? ' wrap' : ''}`);
          if (n.gap !== undefined) e.style.setProperty('--g', String(n.gap));
          if (n.align) e.dataset.align = n.align;
          if (n.label) { e.setAttribute('role', 'group'); e.setAttribute('aria-label', n.label); }
          e.append(...kids());
          return e;
        }
        case 'list': {
          const e = make(n.ordered ? 'ol' : 'ul');
          if (n.label) e.setAttribute('aria-label', n.label);
          e.append(...n.children.map((c) => { const li = make('li'); li.append(node(c)); return li; }));
          return e;
        }
        case 'text': {
          const e = make('p', [n.size, n.weight === 'bold' && 'bold', n.muted && 'muted'].filter(Boolean).join(' '), n.text);
          tint(e, n.color);
          return e;
        }
        case 'number': {
          const e = make('div', `num ${n.size || ''}`.trim());
          const v = make('b', '', `${fmt(n.value, n.digits)}${n.unit ? ` ${n.unit}` : ''}`);
          if (n.color) e.style.setProperty('--c', n.color[0] === '#' ? n.color : `var(--gz-${n.color})`);
          e.append(v);
          if (n.label) e.append(make('span', '', n.label));
          return e;
        }
        case 'ring': case 'progress': {
          const max = n.max ?? 100, p = share(n.value, max);
          const e = make('div', n.type === 'ring' ? 'ring' : 'bar');
          e.setAttribute('role', 'progressbar');
          e.setAttribute('aria-valuemin', '0');
          e.setAttribute('aria-valuemax', String(max));
          e.setAttribute('aria-valuenow', String(Math.max(0, Math.min(max, n.value))));
          e.setAttribute('aria-label', n.label || 'Progress');
          if (n.color) e.style.setProperty('--c', n.color[0] === '#' ? n.color : `var(--gz-${n.color})`);
          if (n.type === 'ring') {
            const svg = document.createElementNS(SVG, 'svg');
            svg.setAttribute('viewBox', '0 0 56 56');
            svg.setAttribute('aria-hidden', 'true');
            for (const k of ['track', 'fill']) {
              const c = document.createElementNS(SVG, 'circle');
              c.setAttribute('cx', '28'); c.setAttribute('cy', '28'); c.setAttribute('r', '24'); c.setAttribute('class', k);
              if (k === 'fill') { c.setAttribute('stroke-dasharray', String(2 * Math.PI * 24)); c.setAttribute('stroke-dashoffset', String(2 * Math.PI * 24 * (1 - p))); }
              svg.append(c);
            }
            e.append(svg);
            if (n.label) e.append(make('span', 's', n.label));
          } else {
            if (n.label) e.append(make('span', 's', n.label));
            const i = make('i');
            i.setAttribute('aria-hidden', 'true');
            i.style.setProperty('--p', `${Math.round(p * 1000) / 10}%`);
            e.append(i);
          }
          return e;
        }
        case 'countdown': {
          const e = make('div', 'stack');
          const t = make('span', 'time l');
          t.setAttribute('role', 'timer');
          if (n.label) { t.setAttribute('aria-label', n.label); e.append(make('span', 's muted', n.label)); }
          e.prepend(t);
          clocks.add({ el: t, to: n.to, done: n.done });
          return e;
        }
        case 'image': {
          const e = make('canvas');
          if (n.alt) { e.setAttribute('role', 'img'); e.setAttribute('aria-label', n.alt); } else e.setAttribute('aria-hidden', 'true');
          if (n.w) e.style.setProperty('width', `${n.w}px`);
          if (n.h) e.style.setProperty('height', `${n.h}px`);
          o.asset(n.src).then((bm) => {
            const w = n.w || bm.width, h = n.h || Math.round((bm.height * w) / bm.width) || bm.height;
            const k = Math.min(devicePixelRatio || 1, 2);
            e.width = Math.min(4096, Math.round(w * k)); e.height = Math.min(4096, Math.round(h * k));
            if (!n.h) e.style.setProperty('aspect-ratio', `${w} / ${h}`);
            const g = e.getContext('2d');
            const s = n.fit === 'cover' ? Math.max(e.width / bm.width, e.height / bm.height) : Math.min(e.width / bm.width, e.height / bm.height);
            g.drawImage(bm, (e.width - bm.width * s) / 2, (e.height - bm.height * s) / 2, bm.width * s, bm.height * s);
          }, () => { e.setAttribute('aria-hidden', 'true'); });
          return e;
        }
        case 'button': {
          const e = make('button', n.tone === 'primary' ? 'primary' : '', n.label);
          e.type = 'button';
          e.dataset.id = n.id;
          e.disabled = !!n.disabled;
          e.addEventListener('click', (ev) => { if (ev.isTrusted) o.send('click', n.id); });
          return e;
        }
        case 'input': {
          let e;
          const wrap = make('label', n.kind === 'toggle' ? 'check' : '');
          if (n.kind === 'select') {
            e = make('select');
            for (const opt of n.options) { const x = make('option', '', opt); x.value = opt; e.append(x); }
            e.value = n.value ?? n.options[0];
          } else {
            e = make('input');
            e.type = { text: 'text', number: 'number', toggle: 'checkbox' }[n.kind];
            if (n.kind === 'toggle') { e.setAttribute('role', 'switch'); e.checked = !!n.value; }
            else if (n.value !== undefined) e.value = String(n.value);
            if (n.kind === 'text') { e.maxLength = n.maxLength ?? 500; if (n.placeholder) e.placeholder = n.placeholder; }
            if (n.kind === 'number') for (const k of ['min', 'max', 'step']) if (n[k] !== undefined) e[k] = String(n[k]);
          }
          e.dataset.id = n.id;
          e.disabled = !!n.disabled;
          e.addEventListener('change', (ev) => {
            if (!ev.isTrusted) return;
            const v = n.kind === 'toggle' ? e.checked : n.kind === 'number' ? (e.value === '' ? null : Number(e.value)) : e.value;
            if (n.kind !== 'number' || v === null || Number.isFinite(v)) o.send('change', n.id, v);
          });
          const name = make('span', '', n.label);
          if (n.kind === 'toggle') wrap.append(e, name); else wrap.append(name, e);
          return wrap;
        }
        case 'canvas': {
          canvas = o.canvas || make('canvas', 'draw');
          canvas.style.setProperty('height', `${n.h ?? 160}px`);
          if (n.label) { canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', n.label); canvas.removeAttribute('aria-hidden'); }
          else { canvas.removeAttribute('role'); canvas.removeAttribute('aria-label'); canvas.setAttribute('aria-hidden', 'true'); }
          return canvas;
        }
        default: return make('span');
      }
    };
    const top = tree ? node(tree) : null;
    root.replaceChildren(...(top ? [top] : []));
    style(root);
    // Drawing again keeps the student's place: the control they were in, and where in its text.
    const back = was && [...root.querySelectorAll('[data-id]')].find((e) => e.dataset.id === was);
    if (back) { back.focus({ preventScroll: true }); if (Number.isInteger(caret)) try { back.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    turn();
    return { canvas };
  };
  // A small closed root for one card's decoration: { badge, accent, note } (cleaned), on a host element `el`.
  const DECO = `:host{display:inline-flex;gap:6px;align-items:center;margin:4px 8px;font-size:12px;max-width:100%}
b{background:var(--c,var(--gz-accent));color:var(--gz-accent-ink);border-radius:999px;padding:1px 8px;font-weight:700;white-space:nowrap}
span{color:var(--gz-ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
  let decoSheet = null;
  const decorate = (root, d) => {
    const kids = [];
    if (d.badge) { const b = make('b', '', d.badge); if (d.accent) b.style.setProperty('--c', d.accent[0] === '#' ? d.accent : `var(--gz-${d.accent})`); kids.push(b); }
    if (d.note) kids.push(make('span', '', d.note));
    root.replaceChildren(...kids);
    try { decoSheet ||= new CSSStyleSheet(); if (!decoSheet.cssRules.length) decoSheet.replaceSync(DECO); root.adoptedStyleSheets = [decoSheet]; }
    catch { const s = document.createElement('style'); s.textContent = DECO; root.prepend(s); }
  };
  return { render, decorate, left };
})();
GZ_MODUI;
