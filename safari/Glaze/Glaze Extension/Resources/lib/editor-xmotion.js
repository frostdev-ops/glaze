// The editor's motion builders: per moment, a ready animation or one
// built from 2–8 stops (x.anim); per event, an effect (x.fx); the pointer (x.pointer), its animation (x.cursor); and a
// typing effect (x.type). Names, limits and what an
// absent value means are lib/motionx.js's (GZ_MX), which draws them. Shared controls and the save path are in
// lib/editor-x.js; the preview plays them (lib/editor-preview.js) unless motion is off. Extension settings page only; the
// tables have module.exports for node.
var GZ_EDITOR_XMOTION = globalThis.GZ_EDITOR_XMOTION || (() => {
  const X = typeof GZ_EDITOR_X !== 'undefined' ? GZ_EDITOR_X : require('./editor-x.js');
  const MX = () => (typeof GZ_MX !== 'undefined' ? GZ_MX : require('./motionx.js'));
  const MOMENTS = { 'page.enter': 'Page enter', 'panel.enter': 'Panel enter', 'card.enter': 'Card enter', 'card.hover': 'Card hover', 'tile.enter': 'Tile enter', 'rail.open': 'Rail open', 'tooltip.in': 'Tooltip', 'button.press': 'Button press' };
  const HELD = ['card.hover', 'button.press']; // states that last while they do, not entrances that play once
  // The pointer sets' names (lib/motionx.js POINTERS), and the typing effects'.
  const POINTERS = { aqua: 'Aqua', lilac: 'Lilac', pearl: 'Pearl', aurora: 'Aurora', quill: 'Quill', terminal: 'Terminal', lava: 'Lava', neon: 'Neon', clear: 'Clear', lagoon: 'Lagoon', rose: 'Rose', ghost: 'Ghost', pumpkin: 'Pumpkin', own: 'Your own picture' };
  const TYPES = { embers: 'Embers', ink: 'Ink', sparks: 'Sparks', pixels: 'Pixels', petals: 'Petals', snow: 'Snow', bubbles: 'Bubbles', wisps: 'Wisps' };
  const EVENTS = { complete: 'You complete an item', submit: 'You hand in work', grade: 'A new grade arrives', streak: 'Your streak grows', 'timer.done': 'A focus timer ends', 'look.rotate': 'Your Look rotates' };
  // A stop's values: label, slider step, unit, and the value that changes nothing (what a newly added one starts at).
  const KEYS = {
    x: ['Move across', 1, 'px', 0], y: ['Move down', 1, 'px', 0], sc: ['Scale', 0.01, '×', 1], r: ['Turn', 1, '°', 0],
    kx: ['Skew across', 1, '°', 0], ky: ['Skew down', 1, '°', 0], o: ['Opacity', 0.01, '', 1], bl: ['Blur', 0.5, 'px', 0],
    br: ['Brightness', 0.01, '×', 1], sa: ['Saturation', 0.01, '×', 1], hu: ['Hue', 1, '°', 0],
  };
  const smooth = (s, ms = 500, ease = 'smooth') => ({ s, ms, ease });
  // Ready animations: entrances play once; a hover or a press is the state its last stop names.
  const ENTER = {
    fade: ['Fade in', smooth([{ at: 0, o: 0 }, { at: 1, o: 1 }], 400)],
    rise: ['Rise', smooth([{ at: 0, y: 16, o: 0 }, { at: 1, y: 0, o: 1 }])],
    drop: ['Drop in', smooth([{ at: 0, y: -16, o: 0 }, { at: 1, y: 0, o: 1 }])],
    slide: ['Slide in', smooth([{ at: 0, x: -24, o: 0 }, { at: 1, x: 0, o: 1 }], 450)],
    zoom: ['Zoom', smooth([{ at: 0, sc: 0.9, o: 0 }, { at: 1, sc: 1, o: 1 }], 450, 'spring')],
    pop: ['Pop', smooth([{ at: 0, sc: 0.6, o: 0 }, { at: 0.7, sc: 1.05, o: 1 }, { at: 1, sc: 1 }], 500, 'ease-out')],
    focus: ['Focus', smooth([{ at: 0, o: 0, bl: 8 }, { at: 1, o: 1, bl: 0 }])],
    spin: ['Spin in', smooth([{ at: 0, sc: 0.9, r: -12, o: 0 }, { at: 1, sc: 1, r: 0, o: 1 }], 600, 'spring')],
  };
  const PRESETS = {
    'card.hover': {
      lift: ['Lift', smooth([{ at: 0, y: 0 }, { at: 1, y: -4 }], 200, 'spring')],
      grow: ['Grow', smooth([{ at: 0, sc: 1 }, { at: 1, sc: 1.03 }], 200, 'spring')],
      tilt: ['Tilt', smooth([{ at: 0, y: 0, r: 0 }, { at: 1, y: -2, r: -1.5 }], 250)],
      glow: ['Glow', smooth([{ at: 0, br: 1, sa: 1 }, { at: 1, br: 1.12, sa: 1.15 }], 250)],
    },
    'button.press': {
      squish: ['Squish', smooth([{ at: 0, sc: 1 }, { at: 1, sc: 0.94 }], 120)],
      deep: ['Deep press', smooth([{ at: 0, sc: 1 }, { at: 1, sc: 0.88 }], 120)],
    },
  };
  const presetsFor = (moment) => PRESETS[moment] || ENTER;
  // The ready animation a moment's value is, or '' (built by hand).
  const presetOf = (moment, a) => Object.entries(presetsFor(moment)).find(([, [, p]]) => GZ_XPARTS_SAME(p, a))?.[0] || '';
  const GZ_XPARTS_SAME = (a, b) => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js')).same(a, b);
  // A stop added between two others: halfway, with the values it would have there unset (they blend through it).
  const between = (stops, i) => ({ at: Math.round(((stops[i].at + (stops[i + 1]?.at ?? 1)) / 2) * 1000) / 1000 });

  // ---- the page ---------------------------------------------------------------------------------------------------------
  let A = null, shown = '', box, note;
  const { el, tr } = X;
  const xOf = () => A.s.parts?.x || {};
  const sig = () => JSON.stringify([xOf().anim, xOf().fx, xOf().cursor, xOf().pointer, xOf().type, A.s.extras?.pointer]);
  const write = (key, value, soon = false) => { A.write(key, X.prune(value || {}), soon); shown = sig(); };
  const unit = (u) => (v) => `${v}${u}`;
  const fmtKey = (k) => (KEYS[k][2] === '' ? (v) => `${Math.round(v * 100)}%` : unit(KEYS[k][2]));
  // Redraws the builder, then puts focus back on the control that asked (data-focus), so the keyboard keeps its place.
  const redraw = (focus) => { draw(); if (focus) box.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus(); };

  // ---- animations -------------------------------------------------------------------------------------------------------
  // Setters read the stored value when they run, not the one drawn: two sliders moved one after the other both count.
  const setAnim = (moment, a, soon) => write('anim', { ...(xOf().anim || {}), [moment]: a }, soon);
  const patchAnim = (moment, patch, soon) => setAnim(moment, { ...xOf().anim[moment], ...patch }, soon);
  const curve = (moment, a) => {
    const c = Array.isArray(a.ease) ? a.ease : [0.2, 0, 0, 1];
    return el('div', { class: 'row', role: 'group', 'aria-label': tr('Custom curve') }, ['x1', 'y1', 'x2', 'y2'].map((name, i) => el('label', { class: 'row' }, name,
      el('input', { type: 'number', step: 0.05, min: i % 2 ? -3 : 0, max: i % 2 ? 3 : 1, value: c[i], style: 'width:5rem', onchange: (e) => {
        const v = +e.target.value;
        if (!Number.isFinite(v)) return;
        const now = xOf().anim[moment].ease;
        patchAnim(moment, { ease: (Array.isArray(now) ? now : c).map((n, j) => (j === i ? Math.min(i % 2 ? 3 : 1, Math.max(i % 2 ? -3 : 0, v)) : n)) });
      } }))));
  };
  const stopUI = (moment, a, i) => {
    const stops = a.s, s = stops[i], id = `${moment}-${i}`;
    const setStop = (patch, soon) => {
      const next = xOf().anim[moment].s.map((x, j) => (j === i ? patch(x) : x)), changed = next[i];
      next.sort((a, b) => a.at - b.at);
      patchAnim(moment, { s: next }, soon);
      return next.indexOf(changed);
    };
    const keys = Object.keys(KEYS).filter((k) => k in s);
    const addKey = el('select', { 'aria-label': tr('Add a value to stop {n}', { n: i + 1 }), 'data-focus': `${id}-add` }, new Option(tr('Add a value…'), ''), ...Object.keys(KEYS).filter((k) => !(k in s)).map((k) => new Option(tr(KEYS[k][0]), k)));
    addKey.addEventListener('change', () => { const k = addKey.value; if (!k) return; setStop((x) => ({ ...x, [k]: KEYS[k][3] })); redraw(`${id}-add`); });
    // Sort before the strict save check, then keep focus on the stop that moved.
    const at = X.slider({ label: tr('At'), min: 0, max: 100, step: 1, value: Math.round(s.at * 100), fmt: unit('%'), on: (v, soon) => { if (soon) return; const j = setStop((x) => ({ ...x, at: v / 100 })); redraw(`${moment}-${j}-at`); } });
    at.querySelector('input').dataset.focus = `${id}-at`;
    return el('li', {},
      el('h4', {}, tr('Stop {n}', { n: i + 1 })),
      at,
      keys.map((k) => {
        const [lo, hi] = MX().RANGE[k];
        const row = X.slider({ label: tr(KEYS[k][0]), min: lo, max: hi, step: KEYS[k][1], value: s[k], fmt: fmtKey(k), on: (v, soon) => setStop((x) => ({ ...x, [k]: v }), soon) });
        row.append(X.button(tr('Remove'), () => { setStop(({ [k]: _, ...rest }) => rest); redraw(`${id}-add`); }, { 'aria-label': `${tr('Remove')} · ${tr(KEYS[k][0])} · ${tr('Stop {n}', { n: i + 1 })}` }));
        return row;
      }),
      el('div', { class: 'row' }, addKey,
        stops.length < 8 && X.button(tr('Add a stop after'), () => { const now = xOf().anim[moment].s; patchAnim(moment, { s: [...now.slice(0, i + 1), between(now, i), ...now.slice(i + 1)] }); redraw(`${moment}-${i + 1}-add`); }),
        stops.length > 2 && X.button(tr('Remove stop'), () => { patchAnim(moment, { s: xOf().anim[moment].s.filter((_, j) => j !== i) }); redraw(`${moment}-pick`); }, { class: 'danger', 'aria-label': `${tr('Remove stop')} ${i + 1}` })));
  };
  const momentUI = (moment) => {
    const a = xOf().anim?.[moment], held = HELD.includes(moment), presets = presetsFor(moment), preset = a ? presetOf(moment, a) : 'own';
    const pick = X.select({ label: tr('Animation'), value: a ? preset || 'custom' : 'own', on: (v) => {
      if (v === 'own') write('anim', { ...(xOf().anim || {}), [moment]: null });
      else if (v === 'custom') setAnim(moment, xOf().anim?.[moment] || structuredClone(Object.values(presets)[0][1]));
      else setAnim(moment, structuredClone(presets[v][1]));
      redraw(`${moment}-pick`);
    }, options: [['own', tr("Glaze's own")], ...Object.entries(presets).map(([k, [label]]) => [k, tr(label)]), ['custom', tr('Built by hand')]] });
    pick.querySelector('select').dataset.focus = `${moment}-pick`;
    const summary = el('summary', {}, `${tr(MOMENTS[moment])} · ${a ? tr(preset ? presets[preset][0] : 'Built by hand') : tr("Glaze's own")}`);
    const body = [pick];
    if (a) {
      const ease = Array.isArray(a.ease) ? 'curve' : a.ease || 'smooth';
      body.push(
        X.slider({ label: tr('Duration'), min: 50, max: 2000, step: 10, value: a.ms ?? 300, fmt: unit(' ms'), on: (v, soon) => patchAnim(moment, { ms: v }, soon) }),
        X.select({ label: tr('Easing'), value: ease, options: [...Object.keys(MX().EASES).map((k) => [k, tr(X.tokenName(k))]), ['curve', tr('Custom curve')]], on: (v) => { patchAnim(moment, { ease: v === 'curve' ? [0.2, 0, 0, 1] : v }); redraw(`${moment}-pick`); } }),
        ease === 'curve' && curve(moment, a),
        !held && X.slider({ label: tr('Delay'), min: 0, max: 1000, step: 10, value: a.delay ?? 0, fmt: unit(' ms'), on: (v, soon) => patchAnim(moment, { delay: v }, soon) }),
        moment === 'card.enter' && X.slider({ label: tr('Stagger'), min: 0, max: 200, step: 5, value: a.stagger ?? 50, fmt: unit(' ms'), on: (v, soon) => patchAnim(moment, { stagger: v }, soon) }),
        el('ol', { class: 'nav-editor-list', 'aria-label': tr('Stops') }, a.s.map((_, i) => stopUI(moment, a, i))),
        held ? el('p', { class: 'desc' }, tr(moment === 'card.hover' ? 'Point at a card in the preview to see it. The last stop that sets a value is the hover state.' : 'Press a button in the preview to feel it. The last stop’s Scale is the press.'))
          : X.button(tr('Play in the preview'), () => X.play('enter'), { 'data-focus': `${moment}-play` }));
    }
    return el('details', { open: opened(moment, !!a), 'data-moment': moment }, summary, el('div', { class: 'x-body' }, body));
  };

  // ---- event effects and the cursor -------------------------------------------------------------------------------------
  const effectUI = (ev) => {
    const f = xOf().fx?.[ev], d = f && MX().fx(f); // d: what draws, the defaults filled in
    // The stored effect when it runs (see setAnim), with what is left empty taken out.
    const setFx = (next, soon) => write('fx', { ...(xOf().fx || {}), [ev]: next && X.prune(next) }, soon);
    const set = (k) => (v, soon) => setFx({ ...xOf().fx[ev], [k]: v }, soon);
    const kind = X.select({ label: tr('Effect'), value: f?.kind || '', options: [['', tr('None')], ...MX().KINDS.map((k) => [k, tr(X.tokenName(k))])], on: (v) => { setFx(v ? { kind: v } : null); redraw(`fx-${ev}`); } });
    kind.querySelector('select').dataset.focus = `fx-${ev}`;
    const body = [kind];
    if (f) {
      // None ticked is the default, a dot.
      const shapes = el('div', { class: 'row', role: 'group', 'aria-label': tr('Shapes, up to four') }, MX().DRAWN.map((sh) => {
        const on = d.shapes.includes(sh);
        return el('label', { class: 'row' }, el('input', { type: 'checkbox', checked: on, disabled: !on && d.shapes.length >= 4, 'data-focus': `fx-${ev}-${sh}`, onchange: (e) => {
          set('shapes')(d.shapes.filter((x) => x !== sh).concat(e.target.checked ? [sh] : []));
          redraw(`fx-${ev}-${sh}`);
        } }), tr(X.tokenName(sh)));
      }));
      body.push(
        f.kind !== 'ring' && el('div', { class: 'field wide' }, el('span', {}, tr('Shapes')), shapes),
        X.slider({ label: tr('Count'), min: 1, max: 60, value: d.count, on: set('count') }),
        X.colors({ label: tr('Colours'), list: f.c || [], max: 6, none: tr('Accent, OK and warning colours'), on: (c, soon) => { set('c')(c, soon); if (!soon) redraw(`fx-${ev}-try`); } }),
        X.slider({ label: tr('Spread'), min: 0, max: 360, step: 5, value: d.spread, fmt: unit('°'), on: set('spread') }),
        X.slider({ label: tr('Gravity'), min: -2, max: 2, step: 0.1, value: d.gravity, on: set('gravity') }),
        X.slider({ label: tr('Life'), min: 200, max: 2500, step: 50, value: d.life, fmt: unit(' ms'), on: set('life') }),
        X.slider({ label: tr('Size'), min: 2, max: 48, value: d.size, fmt: unit('px'), on: set('size') }),
        X.button(tr('Try it'), () => X.play(ev), { 'data-focus': `fx-${ev}-try` }));
    }
    return el('details', { open: opened(ev, !!f), 'data-event': ev }, el('summary', {}, `${tr(EVENTS[ev])} · ${f ? tr(X.tokenName(f.kind)) : tr('None')}`), el('div', { class: 'x-body' }, body));
  };
  const cursorUI = () => {
    const c = xOf().cursor, d = c && MX().cursor(c);
    const set = (k) => (v, soon) => write('cursor', { ...xOf().cursor, [k]: v }, soon);
    const kind = X.select({ label: tr('Cursor effect'), value: c?.kind || '', options: [['', tr('None')], ...MX().CURSORS.map((k) => [k, tr(X.tokenName(k))])], on: (v) => { write('cursor', v ? { ...xOf().cursor, kind: v } : null); redraw('cursor'); } });
    kind.querySelector('select').dataset.focus = 'cursor';
    return [kind, ...(c ? [
      X.colors({ label: tr('Colours'), list: c.c || [], max: 3, none: tr('The accent colour'), on: (v, soon) => { set('c')(v, soon); if (!soon) redraw('cursor'); } }),
      X.slider({ label: tr('Size'), min: 2, max: 48, value: d.size, fmt: unit('px'), on: set('size') }),
      ['orbit', 'drift', 'sparkle'].includes(c.kind) && X.select({ label: tr('Shape'), value: d.shape || '', options: [...(c.kind === 'sparkle' ? [['', tr('Sparks and stars')]] : []), ...MX().SHAPES.concat(MX().MARKS).map((k) => [k, tr(X.tokenName(k))])],
        on: (v) => { write('cursor', { ...xOf().cursor, shape: v || null }); redraw('cursor'); } }),
      !['glow', 'flicker', 'scan'].includes(c.kind) && X.slider({ label: tr(c.kind === 'orbit' ? 'How many' : 'Length'), min: c.kind === 'orbit' ? 1 : 2, max: c.kind === 'orbit' ? 6 : 24, value: c.kind === 'orbit' ? Math.min(6, d.len) : d.len, on: set('len') }),
      X.slider({ label: tr('Fade'), min: 100, max: 2000, step: 50, value: d.fade, fmt: unit(' ms'), on: set('fade') }),
      el('p', { class: 'desc' }, tr('Move the pointer over the preview to see it. Off on touch screens.')),
    ] : [])];
  };

  // The Look's pointer: one of the sets, or the system's. The student's own picture is offered only to a Look that wears it
  // already: a picture is the student's choice, under Look › Pointer (lib/editor-pointer.js), which also says whether they
  // see the Look's pointer at all.
  const pointerUI = () => {
    const v = xOf().pointer || '', mine = A.s.extras?.pointer || 'look';
    const pick = X.select({ label: tr('Pointer'), value: v, options: [['', tr('Standard')], ...MX().POINTERS.filter((k) => k !== 'own' || v === 'own').map((k) => [k, tr(POINTERS[k] || X.tokenName(k))])],
      on: (next) => { A.write('pointer', next || null); shown = sig(); redraw('pointer'); } });
    pick.querySelector('select').dataset.focus = 'pointer';
    return [pick, el('p', { class: 'desc' }, tr(v === 'own' ? 'Your own picture, kept on this computer: a theme code of this Look goes without it.'
      : 'Worn with this Look, and in a theme code of it. Drawn by your system so it never lags; text fields keep the usual text cursor.')),
    el('p', { class: 'desc' }, mine === 'look' ? tr('Which pointer you see is yours to choose:') : tr('You see {name} instead, your own choice:', { name: tr(POINTERS[mine] || (mine === 'off' ? 'System pointer' : mine)) }),
      ' ', el('a', { href: '#look/pointer', 'data-editor-alias': true }, tr('Pointer settings')))];
  };
  const typeUI = () => {
    const c = xOf().type, d = c && MX().typing(c);
    const set = (k) => (v, soon) => write('type', { ...xOf().type, [k]: v }, soon);
    const kind = X.select({ label: tr('Typing effect'), value: c?.kind || '', options: [['', tr('None')], ...MX().TYPES.map((k) => [k, tr(TYPES[k])])], on: (v) => { write('type', v ? { kind: v } : null); redraw('type'); } });
    kind.querySelector('select').dataset.focus = 'type';
    return [kind, ...(c ? [
      X.colors({ label: tr('Colours'), list: c.c || [], max: 3, none: tr('The effect’s own colours'), on: (v, soon) => { set('c')(v, soon); if (!soon) redraw('type'); } }),
      X.slider({ label: tr('Size'), min: 2, max: 24, value: d.size, fmt: unit('px'), on: set('size') }),
      X.slider({ label: tr('Per key'), min: 1, max: 8, value: d.count, on: set('count') }),
    ] : []), el('p', { class: 'desc' }, tr('Small particles at the caret as you type. Glaze never sees what you type, and never plays it in password or payment fields or on a quiz.'))];
  };

  // A redraw keeps open what the student opened; the first draw opens what the Look sets.
  let wasOpen = null;
  const opened = (key, set) => (wasOpen ? wasOpen.has(key) : set) || null;
  const draw = () => {
    if (box.childElementCount) wasOpen = new Set([...box.querySelectorAll('details[open]')].map((d) => d.dataset.moment || d.dataset.event));
    shown = sig();
    note.textContent = X.motionNote();
    box.replaceChildren(...[
      el('h3', {}, tr('Your Look’s animations')),
      el('p', { class: 'desc' }, tr('Each moment uses Glaze’s own animation unless your Look sets one: start from a ready one, then change its stops. A stop sets only the values you add to it; the others blend through it.')),
      Object.keys(MOMENTS).filter((m) => MX().MOMENTS.includes(m)).map(momentUI),
      el('h3', {}, tr('Event effects')),
      el('p', { class: 'desc' }, tr('What plays when something happens. Silent, and never on a quiz.')),
      MX().EVENTS.map(effectUI),
      el('h3', {}, tr('Pointer')),
      pointerUI(),
      el('h3', {}, tr('Cursor effect')),
      cursorUI(),
      el('h3', {}, tr('Typing effect')),
      typeUI()].flat().filter(Boolean));
  };
  const mount = (api) => {
    A = api;
    const host = document.getElementById('x-motion');
    if (!host) return;
    note = X.status();
    box = el('div', { class: 'x-motion' });
    host.append(note, box, el('p', { class: 'desc', 'data-x-storage': true, role: 'status', hidden: true }));
    draw();
    // Reset section takes the Look's own motion out too (one save after the section's own).
    host.closest('section')?.querySelector('[data-reset-section]')?.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      for (const k of ['anim', 'fx', 'cursor', 'pointer', 'type']) write(k, null, true);
      A.save(['parts']);
      draw();
    });
    // Where the preview can play them changes with its site.
    document.getElementById('preview-site')?.addEventListener('change', () => { note.textContent = X.motionNote(); });
  };
  const render = () => {
    if (!A || !box) return;
    const said = X.motionNote();
    if (note.textContent !== said) note.textContent = said;
    if (sig() !== shown) draw();
  };

  if (typeof document !== 'undefined') X.add({ mount, render });
  return { MOMENTS, HELD, EVENTS, POINTERS, TYPES, KEYS, ENTER, PRESETS, presetsFor, presetOf, between };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR_XMOTION;
