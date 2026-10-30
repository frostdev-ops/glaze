// The editor's background builders: a Look's own shader (x.bg.shader), a stack of up to four
// layers (x.bg.layers) and a video, animated picture or Lottie animation (x.bg.media), shown when Background is Custom shader,
// Layers or Video or animation. Shared controls and the save path are in
// lib/editor-x.js. The shader is checked as it is typed (lib/glsl.js, the same checker a theme code goes through): problems
// are listed by line and nothing is saved until it passes, so the preview keeps the last one that did. What the preview's
// budget guard does on this device (lib/scene.js tells this page) is said in words. Extension settings page only; the
// tables have module.exports for node.
var GZ_EDITOR_XBG = globalThis.GZ_EDITOR_XBG || (() => {
  const X = typeof GZ_EDITOR_X !== 'undefined' ? GZ_EDITOR_X : require('./editor-x.js');
  // Example shaders to start from, in assets/shaders/.
  const EXAMPLES = [['aurora', 'Aurora ribbons'], ['starfield', 'Starfield'], ['liquid', 'Liquid gradient']];
  const KINDS = [['scene', 'Animated scene'], ['noise', 'Noise'], ['gradient', 'Gradient'], ['particles', 'Particles']];
  // Each kind's controls, in order (lib/lookparts.js LAYER has the same keys).
  const FIELDS = { scene: ['name', 'amount', 'speed', 'blend', 'c'], noise: ['scale', 'amount', 'speed', 'blend', 'c'], gradient: ['style', 'angle', 'amount', 'blend', 'c'], particles: ['count', 'shape', 'size', 'speed', 'drift', 'twinkle', 'amount', 'blend', 'c'] };
  // A new layer of kind k: what it needs to be a layer (a scene's name, a gradient's two colours); the rest is the defaults.
  const fresh = (k) => ({ k, ...(k === 'scene' && { name: 'mist' }), ...(k === 'gradient' && { c: ['accent', 'accent-hi'] }) });
  // Stacks to start from. Each one cleans unchanged (test/editor-x.test.js).
  const PRESETS = [
    ['Starry night', [{ k: 'gradient', style: 'linear', angle: 180, amount: 80, c: ['surface-2', 'accent-soft'] }, { k: 'particles', count: 140, shape: 'star', size: 5, speed: 20, drift: 90, twinkle: 80, amount: 80, c: ['ink', 'accent-hi'] }]],
    ['Snowfall', [{ k: 'scene', name: 'mist', amount: 50, speed: 60 }, { k: 'particles', count: 180, shape: 'snow', size: 7, speed: 50, drift: 200, twinkle: 0, amount: 85, c: ['ink'] }]],
    ['Fireflies', [{ k: 'noise', scale: 30, amount: 40, speed: 40, c: ['surface-2', 'accent-soft'] }, { k: 'particles', count: 60, shape: 'dot', size: 6, speed: 30, drift: 0, twinkle: 100, amount: 90, blend: 'add', c: ['warn', 'accent-hi'] }]],
    ['Neon haze', [{ k: 'gradient', style: 'conic', angle: 45, amount: 70, c: ['accent', 'accent-hi', 'ok'] }, { k: 'noise', scale: 60, amount: 60, speed: 80, blend: 'screen' }]],
    ['Autumn', [{ k: 'scene', name: 'contours', amount: 40, speed: 50 }, { k: 'particles', count: 50, shape: 'leaf', size: 14, speed: 70, drift: 160, amount: 90, c: ['warn', 'err'] }]],
  ];
  // The list with entry i moved by `by` places (−1 toward the bottom of the stack, +1 toward the top), or the same list.
  const move = (list, i, by) => {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };

  // ---- the page ---------------------------------------------------------------------------------------------------------
  let A = null, shown = '', checkTimer = 0;
  const { el, tr } = X;
  const bgOf = () => A.s.parts?.x?.bg || {};
  const sig = () => JSON.stringify(bgOf());
  const writeBg = (patch, soon = false) => { const ok = A.write('bg', X.prune({ ...bgOf(), ...patch }), soon); shown = sig(); return ok; };
  const pct = (v) => `${v}%`, deg = (v) => `${v}°`, px = (v) => `${v}px`;
  // A scene's name as the Scene picker above shows it (already in the page's language).
  const sceneName = (n) => document.querySelector(`input[name="bg.scene"][value="${CSS.escape(n)}"]`)?.parentElement.textContent.trim() || X.tokenName(n);

  // What the preview's scene said, for the status line under the builder showing. Steps come before a failure.
  const sceneSays = (d) => {
    if (d.gzSceneStep) {
      const { level, still, scale, ms } = d.gzSceneStep;
      if (!scale) return ''; // the gradient: the failure that follows says so
      const at = ms == null ? '' : ` ${tr('({ms} ms a frame)', { ms })}`;
      if (still) return tr('Too heavy to animate on this device: showing a still frame.') + at;
      return (level > 0 ? tr('Running at reduced resolution on this device.') : tr('Running at full resolution on this device.')) + at;
    }
    const f = d.gzSceneFailed;
    if (!f) return null;
    if (f.why === 'budget') return tr('Too heavy for this device: showing the gradient.');
    if (f.why === 'lost' || f.why === 'dropped') return tr('The graphics stopped while drawing this: showing the gradient.');
    if (f.why === 'empty') return '';
    return tr("This device couldn't draw the shader: showing the gradient.");
  };

  // ---- shader -------------------------------------------------------------------------------------------------------------
  let code, gutter, errorList, errorSay, sceneSay;
  const paintGutter = (bad = new Set()) => {
    const n = code.value.split('\n').length;
    gutter.replaceChildren(...Array.from({ length: n }, (_, i) => el('span', { class: bad.has(i + 1) ? 'bad' : null }, `${i + 1}${bad.has(i + 1) ? ' !' : ''}\n`)));
    gutter.scrollTop = code.scrollTop;
  };
  // errors: [{ line, message, vars? }]; from: 'check' (Glaze's checker) or 'device' (this device's compiler, through the preview).
  const showErrors = (errors, from = 'check') => {
    const lines = X.byLine(errors, tr);
    paintGutter(new Set([...lines.keys()].filter(Boolean)));
    errorList.replaceChildren(...[...lines].flatMap(([line, messages]) => messages.map((m) => el('li', {},
      line ? X.button(tr('Line {n}', { n: line }), () => { code.focus(); const at = X.lineStart(code.value, line); code.setSelectionRange(at, at); }) : null, ' ', m))));
    const n = [...lines.values()].flat().length;
    errorSay.textContent = !n ? '' : from === 'device' ? tr("Problems this device's graphics driver found: {n}.", { n }) : tr('Problems found: {n}. The preview keeps the last shader that worked.', { n });
  };
  // Glaze's checker, then this device's compiler on a throwaway WebGL2 context (compiling only, never drawing), so a typo
  // is shown at its line before anything is saved. Without WebGL2 the checker alone, and the preview reports the rest.
  let gl;
  const compile = (src) => {
    try { if (!gl || gl.isContextLost()) gl = document.createElement('canvas').getContext('webgl2'); } catch { gl = null; }
    return gl ? GZ_GLSL.compile(gl, src) : GZ_GLSL.check(src);
  };
  if (typeof addEventListener !== 'undefined') addEventListener('pagehide', () => {
    clearTimeout(checkTimer);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    gl = null;
  });
  const checkNow = () => {
    clearTimeout(checkTimer);
    const src = code.value.replace(/\r\n?/g, '\n');
    if (!src.trim()) { showErrors([]); writeBg({ shader: null }); return; }
    const r = compile(src);
    if (!r.ok) return showErrors(r.errors);
    if (bgOf().shader?.src === src) return showErrors([]);
    showErrors(writeBg({ shader: { src } }, true) ? [] : [{ line: 0, message: tr("This shader can't be saved: it must be plain ASCII text, at most 8 KiB.") }]);
    sceneSay.textContent = '';
  };
  const example = async (name) => {
    if (code.value.trim() && !confirm(tr('Replace your shader with this example?'))) return;
    try { code.value = await (await fetch(`assets/shaders/${name}.glsl`)).text(); } catch { return; }
    checkNow();
    code.focus();
  };
  const shaderUI = () => {
    code = el('textarea', { id: 'x-shader-code', spellcheck: false, wrap: 'off', rows: 18, autocomplete: 'off', translate: 'no', 'aria-label': tr('Shader code'), 'aria-describedby': 'x-shader-help x-shader-say' });
    gutter = el('pre', { class: 'x-gutter', 'aria-hidden': 'true' });
    errorList = el('ul', { class: 'x-errors', 'aria-label': tr('Problems in the shader') });
    errorSay = X.status({ id: 'x-shader-say' });
    sceneSay = X.status();
    code.addEventListener('input', () => { paintGutter(); clearTimeout(checkTimer); checkTimer = setTimeout(checkNow, 400); });
    code.addEventListener('change', checkNow);
    code.addEventListener('scroll', () => { gutter.scrollTop = code.scrollTop; });
    // Tab indents instead of leaving the box; Escape then Tab leaves it, so the keyboard is never trapped.
    let escaped = false;
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { escaped = true; return; }
      if (e.key === 'Tab' && !e.shiftKey && !escaped && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      escaped = false;
    });
    return [
      el('h3', {}, tr('Your shader')),
      el('p', { class: 'desc', id: 'x-shader-help' }, tr('GLSL ES 1.00. Write vec4 scene(vec2 uv): uv runs 0 to 1 with y up, and the result is a colour and how much of it covers the ground. Your Look gives uC1, uC2 and uC3 (the colours below), uGround, uTime and uAmount (Intensity), and the helpers hash, noise, fbm, amt, rot and px. In the box, Tab indents; press Escape first to move on.')),
      el('div', { class: 'row', role: 'group', 'aria-label': tr('Start from an example') }, el('span', {}, tr('Start from an example:')), EXAMPLES.map(([n, label]) => X.button(tr(label), () => example(n)))),
      el('div', { class: 'x-code' }, gutter, code),
      errorSay, errorList, sceneSay,
      el('p', { class: 'desc', 'data-x-storage': true, role: 'status', hidden: true }),
    ];
  };
  const renderShader = () => {
    code.value = bgOf().shader?.src || '';
    showErrors([]);
    sceneSay.textContent = code.value ? '' : tr('Pick an example or write a shader to see it in the preview.');
  };

  // ---- layers -------------------------------------------------------------------------------------------------------------
  let stack, layersSay, layersScene, presetPick;
  const setLayers = (layers, soon = false) => writeBg({ layers }, soon);
  const field = (l, i, key) => {
    const D = GZ_XPARTS.DEFAULTS.layer[l.k], v = l[key] ?? D[key];
    const set = (val, soon = false) => setLayers(bgOf().layers.map((x, j) => (j === i ? X.prune({ ...x, [key]: val }) : x)), soon);
    // A structural change (a colour added or taken out) redraws the stack.
    const setNow = (val, soon) => { set(val, soon); if (!soon) drawLayers(); };
    const range = (label, min, max, fmt = String, step = 1) => X.slider({ label, min, max, step, value: v, fmt, on: set });
    switch (key) {
      case 'name': return X.select({ label: tr('Scene'), value: v, options: GZ_SPEC.bg.scene[1].map((n) => [n, sceneName(n)]), on: (val) => set(val) });
      case 'style': return X.select({ label: tr('Style'), value: v, options: [['linear', tr('Linear')], ['radial', tr('Radial')], ['conic', tr('Conic')]], on: (val) => set(val) });
      case 'shape': return X.select({ label: tr('Shape'), value: v, options: GZ_MX.SHAPES.map((n) => [n, tr(X.tokenName(n))]), on: (val) => set(val) });
      case 'blend': return X.select({ label: tr('Blend'), value: v, options: GZ_XPARTS.BLENDS.map((n) => [n, tr(X.tokenName(n))]), on: (val) => set(val) });
      case 'scale': return range(tr('Size'), 1, 100);
      case 'angle': return range(tr('Angle'), 0, 360, deg, 5);
      case 'count': return range(tr('Count'), 1, 400);
      case 'size': return range(tr('Size'), 1, 64, px);
      case 'drift': return range(tr('Direction'), 0, 360, deg, 5);
      case 'twinkle': return range(tr('Twinkle'), 0, 100, pct);
      case 'amount': return range(tr('Amount'), 0, 100, pct);
      case 'speed': return range(tr('Speed'), 0, 200, pct, 5);
      case 'c': return X.colors({ label: tr('Colours'), list: l.c || [], min: l.k === 'gradient' ? 2 : 0, max: l.k === 'gradient' ? 4 : 3, none: tr("The background's colours"), on: setNow });
    }
    return null;
  };
  const drawLayers = (focus) => {
    const layers = bgOf().layers || [];
    stack.replaceChildren(...layers.map((l, i) => {
      const name = tr('Layer {n}', { n: i + 1 }), where = i === 0 ? tr('bottom') : i === layers.length - 1 ? tr('top') : '';
      // At either end a move does nothing; aria-disabled keeps the button focusable, so the keyboard stays in the list.
      const mover = (text, by, id) => X.button(text, () => {
        if (i + by < 0 || i + by >= layers.length) return;
        setLayers(move(bgOf().layers, i, by));
        layersSay.textContent = tr('{name} is now layer {n} of {total}.', { name, n: i + 1 + by, total: layers.length });
        drawLayers(`${id}-${i + by}`);
      }, { 'aria-label': `${text} · ${name}`, 'aria-disabled': String(i + by < 0 || i + by >= layers.length), 'data-focus': `${id}-${i}` });
      const kind = X.select({ label: tr('Kind'), value: l.k, options: KINDS.map(([k, label]) => [k, tr(label)]), on: (k) => { setLayers(bgOf().layers.map((x, j) => (j === i ? fresh(k) : x))); drawLayers(`kind-${i}`); } });
      kind.querySelector('select').dataset.focus = `kind-${i}`;
      return el('li', {},
        el('h4', {}, where ? `${name} · ${where}` : name),
        kind,
        FIELDS[l.k].map((key) => field(l, i, key)),
        el('div', { class: 'row' },
          mover(tr('Move down'), -1, 'down'), mover(tr('Move up'), 1, 'up'),
          X.button(tr('Remove'), () => { setLayers(bgOf().layers.filter((_, j) => j !== i)); layersSay.textContent = tr('{name} removed.', { name }); drawLayers('add'); }, { class: 'danger', 'aria-label': `${tr('Remove')} · ${name}` })));
    }));
    const add = document.getElementById('x-layer-add');
    add.disabled = layers.length >= 4;
    if (focus) (document.querySelector(`#x-layers [data-focus="${focus}"]`) || add).focus();
  };
  const layersUI = () => {
    stack = el('ol', { class: 'nav-editor-list x-stack', 'aria-label': tr('Layers, bottom first') });
    layersSay = X.status();
    layersScene = X.status();
    presetPick = el('select', { 'aria-label': tr('Start from a preset stack') }, new Option(tr('Choose a stack…'), ''), ...PRESETS.map(([n], i) => new Option(tr(n), String(i))));
    presetPick.addEventListener('change', () => {
      const p = PRESETS[+presetPick.value];
      presetPick.value = '';
      if (!p || ((bgOf().layers || []).length && !confirm(tr('Replace your layers with this stack?')))) return;
      setLayers(structuredClone(p[1]));
      layersSay.textContent = tr('{name}: {n} layers.', { name: tr(p[0]), n: p[1].length });
      drawLayers();
    });
    return [
      el('h3', {}, tr('Layers')),
      el('p', { class: 'desc' }, tr('Up to four of Glaze’s own layers, drawn bottom first. Blend sets how a layer mixes with the ones under it.')),
      el('label', { class: 'field wide' }, el('span', {}, tr('Start from')), presetPick),
      stack,
      el('div', { class: 'row' }, X.button(tr('Add a layer'), () => { const l = bgOf().layers || []; if (l.length >= 4) return; setLayers([...l, fresh(l.length ? 'particles' : 'gradient')]); layersSay.textContent = tr('Layer {n} added.', { n: l.length + 1 }); drawLayers(`kind-${l.length}`); }, { id: 'x-layer-add' }), el('span', { class: 'desc' }, tr('Up to four layers.'))),
      layersSay, layersScene,
      el('p', { class: 'desc', 'data-x-storage': true, role: 'status', hidden: true }),
    ];
  };


  // ---- media --------------------------------------------------------------------------------------------------------------
  // A video, an animated picture or a Lottie animation, from a link or from a file this computer keeps (lib/media.js, put
  // through the worker, which reads it again). The editor names the host a link loads from, and says what the preview did.
  const MEDIA_KINDS = [['video', 'Video (WebM or MP4)'], ['image', 'Animated picture (WebP or AVIF)'], ['lottie', 'Lottie animation (JSON)']];
  const MEDIA_FITS = [['cover', 'Fill the screen'], ['contain', 'Fit inside'], ['fill', 'Stretch']];
  const MEDIA_ACCEPT = { video: '.webm,.mp4', image: '.webp,.avif', lottie: '.json' };
  let mediaPick = 0, mediaKind = 'video', mediaSay, mediaControls, mediaTune, mediaKept, mediaFile, mediaFileSay;
  const mediaOf = () => bgOf().media || null;
  const hostOf = (src) => { try { return new URL(src).hostname; } catch { return ''; } };
  const mb = (n) => n < 1048576 ? tr('{n} KB', { n: Math.ceil(n / 1024) }) : tr('{n} MB', { n: (Math.round(n / 104857.6) / 10).toString() });
  const setMedia = (patch, soon = false) => { mediaPick++; return writeBg({ media: X.prune({ ...mediaOf(), ...patch }) }, soon); };
  const askWorker = (m) => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:media', ...m }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const b64Of = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  };
  const say = (box, text) => { box.textContent = text; };
  const linkNote = () => {
    const m = mediaOf();
    if (!m) return '';
    return m.src.startsWith('file:') ? tr('Using a file kept on this computer. A theme code can’t carry a file: share this Look in a share session to send it along.') : tr('Loads from {host}.', { host: hostOf(m.src) });
  };
  const takeLink = (input, note) => {
    const pick = ++mediaPick;
    const v = input.value.trim();
    if (!v) {
      // Emptying the box takes out a link. A file in use has no link (the box is empty while it plays), so it stays.
      if (mediaOf() && !mediaOf().src.startsWith('file:')) writeBg({ media: null });
      say(note, linkNote());
      drawTuning();
      drawKept();
      return;
    }
    const url = GZ_XPARTS.MEDIA.url(v);
    if (!url) return say(note, tr('That isn’t a link Glaze can use. It must start with https:// and name a website.'));
    input.value = url;
    // The worker fetches the file (lib/media.js remote) and refuses a host the browser doesn't hold: asked for here, in the
    // change that takes the link (a paste and Enter, or leaving the box), before anything is awaited (lib/site.js reach).
    const kind = mediaKind;
    GZ_SITE.reach([url], input, { kind: 'media', src: url, mediaKind: kind }).then((held) => {
      if (held === null) return; // sent to Settings' own tab
      if (pick !== mediaPick || input.value !== url) return; // a later choice owns the answer, even for the same URL
      if (!held) return say(note, tr('That link can’t be saved.'));
      if (!setMedia({ type: kind, src: url })) return say(note, tr('That link can’t be saved.'));
      say(note, linkNote());
      say(mediaSay, '');
      drawTuning();
      drawKept();
    });
  };
  const takeFile = async (input) => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const L = GZ_MEDIA.LIMIT.bg, cap = mediaKind === 'video' ? L.video : mediaKind === 'image' ? L.image.bytes : L.lottie;
    if (file.size > cap) return say(mediaFileSay, tr('That file is too big for this kind (the most is {max}).', { max: mb(cap) }));
    let b64;
    try { b64 = await b64Of(file); } catch { return say(mediaFileSay, tr('Couldn’t read that file.')); }
    say(mediaFileSay, tr('Checking the file…'));
    const r = await askWorker({ op: 'put', kind: mediaKind, b64 });
    if (!r?.ok) return say(mediaFileSay, r?.error === 'full' ? tr('There isn’t room to keep it. Remove a file below first.') : r?.error === 'type' ? tr('Glaze can’t play that file as this kind.')
      : r?.error === 'meta' ? tr('Glaze can’t take the location and device details out of that file, so it won’t keep it. Save a copy without them and try again.')
      : r?.error === 'big' ? tr('That file is too big for this kind (the most is {max}).', { max: mb(cap) }) : tr('Glaze couldn’t keep that file.'));
    say(mediaFileSay, '');
    if (!setMedia({ type: mediaKind, src: `file:${r.h}` })) return say(mediaFileSay, tr('That file can’t be saved.'));
    say(document.getElementById('x-media-note'), linkNote());
    drawTuning();
    drawKept();
  };
  // The files kept for backgrounds, whatever Background is set to: a Look in history or favorites, or an offer, may have kept
  // one. With none, the line saying so shows only with "Video or animation" (renderBg in options.js shows [data-kinds]).
  const drawKept = async () => {
    const r = await askWorker({ op: 'list' });
    if (!r?.ok) return;
    const used = r.files.reduce((n, f) => n + f.size, 0), now = mediaOf()?.src;
    const none = el('p', { class: 'desc', 'data-kinds': 'media' }, tr('No files are kept for backgrounds.'));
    none.hidden = A.s.bg.kind !== 'media';
    mediaKept.replaceChildren(...(r.files.length ? [
      el('p', { class: 'desc' }, tr('Files kept for backgrounds: {used} of {total}.', { used: mb(used), total: mb(GZ_MEDIA.LIMIT.total) })),
      el('ul', { class: 'nav-editor-list' }, r.files.map((f) => {
        const inUse = now === `file:${f.h}`, what = f.t.startsWith('video') ? tr('Video') : f.t === 'application/json' ? tr('Lottie animation') : tr('Animated picture'), name = `${what} · ${mb(f.size)}`;
        const note = inUse ? tr('In use') : f.saved ? tr('In a saved Look') : '';
        return el('li', {}, el('span', {}, name, note ? ` · ${note}` : ''),
          inUse ? null : X.button(tr('Remove'), async () => { await askWorker({ op: 'drop', h: f.h }); drawKept(); }, { 'aria-label': `${tr('Remove')} · ${name}` }));
      })),
    ] : [none]));
  };
  // Fit, dim and loop, once there is something to play.
  const drawTuning = () => {
    const m = mediaOf(), D = { ...GZ_XPARTS.DEFAULTS.media, ...m };
    mediaTune.replaceChildren(...(m ? [
      X.select({ label: tr('Fit'), value: D.fit, options: MEDIA_FITS.map(([k, label]) => [k, tr(label)]), on: (k) => setMedia({ fit: k }) }),
      X.slider({ label: tr('Dim'), min: 0, max: 90, step: 5, value: D.dim, fmt: pct, on: (v, soon) => setMedia({ dim: v }, soon) }),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: D.loop, onchange: (e) => setMedia({ loop: e.target.checked }) }), el('span', {}, tr('Play again when it ends'))),
    ] : []));
  };
  const drawMedia = () => {
    const m = mediaOf();
    if (m) mediaKind = m.type;
    const link = el('input', { type: 'url', id: 'x-media-link', value: m && !m.src.startsWith('file:') ? m.src : '', placeholder: 'https://…', translate: 'no', autocomplete: 'off', spellcheck: false });
    const note = X.status({ id: 'x-media-note' });
    link.setAttribute('aria-describedby', 'x-media-note');
    link.addEventListener('change', () => takeLink(link, note));
    mediaFile = el('input', { type: 'file', accept: MEDIA_ACCEPT[mediaKind], id: 'x-media-file' });
    mediaFile.addEventListener('change', (e) => { if (e.isTrusted) takeFile(mediaFile); });
    mediaFileSay = X.status();
    say(note, linkNote());
    mediaControls.replaceChildren(
      X.select({ label: tr('Kind'), value: mediaKind, options: MEDIA_KINDS.map(([k, label]) => [k, tr(label)]), on: (k) => { mediaKind = k; mediaFile.accept = MEDIA_ACCEPT[k]; } }), // what the next link or file is; the current one keeps its type
      el('label', { class: 'field wide' }, el('span', {}, tr('Link to the file')), link), note,
      el('label', { class: 'field wide' }, el('span', {}, tr('Or a file from this computer')), mediaFile), mediaFileSay,
      mediaTune,
    );
    drawTuning();
    drawKept();
  };
  const mediaUI = () => {
    mediaSay = X.status();
    mediaControls = el('div', { class: 'x-media-controls' });
    mediaTune = el('div', { class: 'x-media-tune' });
    mediaKept = el('div', { class: 'x-media-kept' });
    return [
      el('h3', {}, tr('Video or animation')),
      el('p', { class: 'desc' }, tr('A video, an animated picture or a Lottie animation, playing behind your pages. It is always muted, holds on its first frame when motion is off, and pauses while the tab is hidden. If it can’t load, the gradient shows instead.')),
      mediaControls, mediaSay,
      el('p', { class: 'desc', 'data-x-storage': true, role: 'status', hidden: true }),
    ];
  };
  // What the preview did with it, in words.
  const mediaSays = (d) => {
    const s = d.gzMediaState;
    if (!s) return null;
    if (s.state === 'ready') return tr('The preview is playing it.');
    if (s.why === 'file') return tr('That file isn’t on this computer, so the gradient shows instead.');
    if (s.why === 'empty') return '';
    if (s.why === 'limits') {
      const L = GZ_MEDIA.LIMIT.bg;
      return tr('Glaze won’t play that file: it is over the limits for a background ({video} for a video, {image} for a picture, {side} pixels a side) or isn’t a video or picture it can check. The gradient shows instead.', { video: mb(L.video), image: mb(L.image.bytes), side: L.image.side });
    }
    return tr('The preview couldn’t load it, so the gradient shows instead. Check the link, or whether this browser plays that format.');
  };

  const mount = (api) => {
    A = api;
    document.getElementById('x-shader')?.append(...shaderUI());
    document.getElementById('x-layers')?.append(...layersUI());
    document.getElementById('x-media')?.append(...mediaUI());
    document.getElementById('x-media')?.after(mediaKept); // not inside the media builder: reachable whatever Background is
    X.fromPreview((d) => {
      const seen = mediaSays(d);
      if (seen !== null) { mediaSay.textContent = seen; return; }
      const said = sceneSays(d);
      if (said === null) return;
      const box = A.s.bg.kind === 'layers' ? layersScene : sceneSay;
      box.textContent = said;
      if (d.gzSceneFailed?.errors?.length && A.s.bg.kind === 'shader' && ['compile', 'refused'].includes(d.gzSceneFailed.why)) showErrors(d.gzSceneFailed.errors, 'device');
    });
    render();
  };
  // Redrawn only when the parts changed from elsewhere (a Look picked, a code applied, another tab), so typing and
  // dragging keep their place.
  const render = (force = false) => {
    if (!A || (!force && sig() === shown)) return;
    clearTimeout(checkTimer);
    shown = sig();
    renderShader();
    layersScene.textContent = '';
    drawLayers();
    drawMedia();
  };

  // A link carried from embedded Settings: fill only. The student's next click owns the browser prompt and the save.
  const offer = (a) => {
    if (!A || a?.kind !== 'media' || !GZ_XPARTS.MEDIA.url(a.src) || !MEDIA_KINDS.some(([k]) => k === a.mediaKind)) return;
    mediaKind = a.mediaKind;
    drawMedia();
    mediaKind = a.mediaKind;
    const link = document.getElementById('x-media-link'), note = document.getElementById('x-media-note');
    link.value = a.src;
    const select = mediaControls.querySelector?.('select');
    if (select) select.value = mediaKind;
    const allow = X.button(tr('Allow {host}', { host: new URL(a.src).hostname }), (e) => { if (e.isTrusted) takeLink(link, note); });
    document.getElementById('x-media').hidden = false;
    allow.id = 'x-media-allow';
    mediaControls.append(allow); allow.focus();
  };

  if (typeof document !== 'undefined') X.add({ mount, render });
  // kept(): the kept files changed elsewhere (an offer, a clean-up, another tab); options.js hears storage and says so.
  return { EXAMPLES, KINDS, FIELDS, PRESETS, MEDIA_KINDS, MEDIA_FITS, fresh, move, offer, kept: () => { if (A) drawKept(); } };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR_XBG;
