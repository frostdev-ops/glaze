// One companion per document. A wandering pet outlives its habitat window, until disabled or the page unloads.
var GZ_PET_WORLD = globalThis.GZ_PET_WORLD || (() => {
  let current;
  const mount = (stage, options) => {
    if (current?.key !== options.key) { current?.destroy(); current = create(options); }
    current.attach(stage, options.data);
    return { stop: () => current?.detach(stage), play: (state) => current?.play(state) };
  };
  const create = ({ key, save, t }) => {
    const P = GZ_PET, F = GZ_PET_PHYSICS, B = GZ_PET_BRAIN;
    const make = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
    const world = make('div', 'gz-game-world');
    const actor = make('div', 'gz-game-actor'), avatar = make('div', 'gz-game-avatar'), cheer = make('span', 'gz-game-reaction');
    const home = make('button', 'gz-game-home'); home.type = 'button'; home.textContent = t('Return home');
    home.addEventListener('click', (e) => { if (e.isTrusted) changeMode(false); });
    actor.append(avatar, cheer); actor.tabIndex = 0; actor.setAttribute('role', 'group');
    actor.setAttribute('aria-label', t('Study buddy. Drag outside to wander, or press W. Press H to return home.'));
    cheer.setAttribute('role', 'status');
    const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    let stage = null, data = null, alive = true, player = null, timer = 0, reaction = 0, drag = null, movingItem = null;
    let b = { x: 30, y: 30, w: 80, h: 86, vx: 0, vy: 0 }, surfaces = [], lastScan = 0, nextAction = 0, last = 0, wandering = false;
    let props = [], offs = [], dirty = false, suppressClick = false, lastMotion = '', lastGaze = -1, path = location.pathname, awake = true, outing = null;
    const hosts = new Set(), floating = new Map();
    let decision = null, feedbackAt = -Infinity, feedbackEvent = '', focus = false, focusEnd = 0;
    let cursor = { x: -1000, y: -1000 }, cursorAt = 0, cursorSpeed = 0, pointerForm = false, typedAt = -Infinity, scrolledAt = -Infinity, movedAt = -Infinity, celebratedAt = -Infinity, playedAt = -Infinity;
    let energy = .8, idleUntil = 0, idlePose = 'idle', activity = null, toy = null, observedAt = -Infinity, observedAction = '', xpSeen = null, wasStill = false, facing = 1;
    let groundY = 0, offscreenAt = 0, recovery = null, geometryDirty = false, focusTimer = null, anchor = null;
    let viewDoc = document, viewFrame = null, viewBlocked = false, frameOffs = [];
    const recent = [];
    const facingPose = (delta) => { if (Math.abs(delta) > 8) facing = Math.sign(delta); return facing < 0 ? 'running-left' : 'running-right'; };
    const typing = () => performance.now() - typedAt < 3500 || !!(document.activeElement === viewFrame ? viewDoc.activeElement : document.activeElement)?.matches('input,textarea,select,[contenteditable="true"],[role="textbox"]');
    const features = (surface) => B.vector({
      focus, pointerNear: Math.hypot(cursor.x - (wandering ? -window.scrollX : stage?.getBoundingClientRect().left || 0) - b.x - b.w / 2, cursor.y - (wandering ? -window.scrollY : stage?.getBoundingClientRect().top || 0) - b.y - b.h / 2) < 180,
      needs: { ...data.needs, energy: energy * 100 }, hour: new Date().getHours(), kind: surface?.kind || surface?.id,
      wandering, water: !wandering && data.habitat === 'aquarium', idle: (performance.now() - Math.max(cursorAt, typedAt, scrolledAt, movedAt)) / 1000,
      cursorSpeed, typing: typing(), scrolling: performance.now() - scrolledAt < 1500, moved: performance.now() - movedAt < 10000,
      celebrating: performance.now() - celebratedAt < 12000, decor: !!surface?.id, returning: activity?.action === 'home',
    });
    const clearActivity = () => { recovery = null; offscreenAt = 0; activity = outing = null; toy?.remove(); toy = null; idleUntil = 0; avatar.style.clipPath = ''; actor.dataset.intent = actor.dataset.behavior = ''; lastMotion = ''; b.vx = b.vy = 0; };
    const activeDecision = () => decision && actor.dataset.intent === decision.action ? { action: decision.action, context: features(activity?.target || outing?.surface) } : null;
    const changeMode = (wander, voluntary = false, prior = activeDecision()) => commit({ op: 'wander', wander, ...(voluntary && { voluntary }), ...prior });
    const feedback = (event, prior = activeDecision()) => {
      if (!alive || !data || (feedbackEvent === event && performance.now() - feedbackAt < 800)) return;
      feedbackAt = performance.now(); feedbackEvent = event;
      commit({ op: 'interact', event, ...prior });
    };
    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); offs.push(() => el.removeEventListener(type, fn, opts)); };
    const still = () => reduced?.matches || document.documentElement.getAttribute('data-gz-motion') === 'off';
    const quiet = () => /\/quizzes\/|\/assessments?\/|\/(?:attempt|lti)(?:\/|$)|\/external_tools\//.test(viewDoc.location.pathname) || !!viewDoc.querySelector('iframe#tool_content');
    const pageSize = () => ({ width: Math.min(1e8, Math.max(window.innerWidth, document.documentElement.scrollWidth, document.body?.scrollWidth || 0)), height: Math.min(1e8, Math.max(window.innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight || 0)) });
    const scrollAnchor = (el) => {
      const nodes = [];
      const doc = el?.ownerDocument;
      if (doc && doc !== document && doc.scrollingElement) { const n = doc.scrollingElement; nodes.push({ el: n, x: n.scrollLeft, y: n.scrollTop }); }
      for (let n = el, i = 0; n && i < 30; n = n.parentElement, i++) {
        if (n === doc?.scrollingElement || n === doc?.documentElement || n.closest?.('.gz-game,.gz-game-dialog,.gz-game-world')) continue;
        const style = globalThis.getComputedStyle?.(n);
        if (style && (/auto|scroll/.test(style.overflowX) && n.scrollWidth > n.clientWidth || /auto|scroll/.test(style.overflowY) && n.scrollHeight > n.clientHeight)) nodes.push({ el: n, x: n.scrollLeft, y: n.scrollTop });
      }
      return { nodes, x: -nodes.reduce((n, p) => n + p.x, 0), y: -nodes.reduce((n, p) => n + p.y, 0) };
    };
    const frameOffset = () => { const r = viewFrame?.getBoundingClientRect(); return { x: r ? r.left + viewFrame.clientLeft : 0, y: r ? r.top + viewFrame.clientTop : 0 }; };
    const anchorAt = (x, y) => {
      const p = frameOffset(), cx = x - window.scrollX, cy = y - window.scrollY;
      const doc = viewFrame && cx >= p.x && cy >= p.y && cx < p.x + viewFrame.clientWidth && cy < p.y + viewFrame.clientHeight ? viewDoc : document;
      return scrollAnchor(doc.elementsFromPoint?.(cx - (doc === document ? 0 : p.x), cy - (doc === document ? 0 : p.y)).find((el) => !el.closest?.('.gz-game,.gz-game-dialog,.gz-game-world,.gz-game-home')));
    };
    const extent = (at) => {
      const box = pageSize();
      for (const p of at?.nodes || []) if (p.el.isConnected) { box.width += Math.max(0, p.el.scrollWidth - p.el.clientWidth); box.height += Math.max(0, p.el.scrollHeight - p.el.clientHeight); }
      return box;
    };
    const bounds = () => wandering ? extent(anchor) : { width: stage?.clientWidth || 320, height: (stage?.clientHeight || 240) * .95 };
    const step = (body, options, at) => {
      const x = at?.x || 0, y = at?.y || 0;
      const next = F.step({ ...body, x: body.x - x, y: body.y - y }, { ...options, height: options.height - y, platforms: options.platforms?.map((p) => ({ ...p, x: p.x - x, y: p.y - y })) });
      return { ...next, x: next.x + x, y: next.y + y };
    };
    const pageRect = (el) => { const r = el.getBoundingClientRect(), p = el.ownerDocument === viewDoc && viewFrame ? frameOffset() : { x: 0, y: 0 }; return { x: r.left + p.x + window.scrollX, y: r.top + p.y + window.scrollY, w: r.width, h: r.height }; };
    const perchable = (s) => s.y >= window.scrollY + b.h && s.y <= window.scrollY + window.innerHeight && Math.min(s.x + s.w, window.scrollX + window.innerWidth) - Math.max(s.x, window.scrollX) >= b.w;
    const perchX = (s) => Math.max(Math.max(s.x, window.scrollX), Math.min(Math.min(s.x + s.w, window.scrollX + window.innerWidth) - b.w, s.x + (s.w - b.w) / 2));
    const visible = (p, margin = 0) => p.x + p.w > window.scrollX - margin && p.x < window.scrollX + window.innerWidth + margin && p.y + p.h > window.scrollY - margin && p.y < window.scrollY + window.innerHeight + margin;
    // The overlay clips at the viewport so an offscreen toy cannot grow the page and toggle its scrollbar.
    // Its children still use document coordinates, including when the document itself scrolls.
    const scrollWorld = () => {
      for (const [axis, value] of [['x', window.scrollX], ['y', window.scrollY]]) {
        const key = `--gz-world-${axis}`, px = `${value}px`;
        if (world.style.getPropertyValue(key) !== px) world.style.setProperty(key, px);
      }
    };
    const worldHost = () => { if (!world.isConnected) document.documentElement.append(world); scrollWorld(); return world; };
    const homeVisible = () => { const r = stage?.getBoundingClientRect(); return r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; };
    const allowed = () => alive && !globalThis.GZ_CTABS?.revoked?.() && !!chrome.runtime?.id && !document.hidden && !viewBlocked && (wandering ? !quiet() : homeVisible());
    const art = (id) => { const img = make('img', ''); img.src = chrome.runtime.getURL(`assets/art/stickers/${P.DECOR[id].art}.webp`); img.alt = ''; img.draggable = false; return img; };
    const display = () => { actor.style.left = '0'; actor.style.top = '0'; actor.style.transform = `translate3d(${b.x}px,${b.y}px,0)`; };
    const play = (state, message = '') => {
      player?.play(state); lastMotion = ''; actor.dataset.reaction = state; cheer.textContent = message;
      clearTimeout(reaction); reaction = setTimeout(() => { actor.dataset.reaction = ''; cheer.textContent = ''; }, 2200);
    };
    const relocate = (wander, at) => {
      if (wander === wandering && actor.parentElement === (wander ? world : stage)) return;
      wandering = wander; actor.dataset.wander = String(wander); home.hidden = !wander;
      clearActivity(); nextAction = 0; lastMotion = '';
      (wander ? worldHost() : stage)?.append(actor);
      if (wander) document.body.append(home); else home.remove();
      const box = bounds(); groundY = wander ? Math.min(box.height, window.scrollY + window.innerHeight - 6) : box.height;
      b = { ...b, x: at?.x ?? Math.max(0, wander ? window.scrollX + (window.innerWidth - b.w) / 2 : (box.width - b.w) / 2), y: at?.y ?? Math.max(0, groundY - b.h), vx: 0, vy: 0 };
      anchor = wander ? anchorAt(b.x + b.w / 2, b.y + b.h / 2) : null;
      lastScan = 0; display();
    };
    const commit = async (patch) => {
      if (!alive || globalThis.GZ_CTABS?.revoked?.()) return;
      const reply = await save(patch);
      if (!alive) return;
      if (reply?.ok && reply.data) setData(reply.data);
      else { if (data) { relocate(data.wander); renderProps(); } play('failed', t('Couldn’t save your buddy. Try again.')); }
    };
    const positionOf = (id) => data.positions[id] || P.cellPosition(data.decor[id]);
    const renderProps = () => {
      for (const [id, p] of floating) if (!Object.hasOwn(data.decor, id)) { p.el.remove(); floating.delete(id); }
      for (const p of props) if (!Object.hasOwn(data.decor, p.id)) p.el.remove();
      props = props.filter((p) => Object.hasOwn(data.decor, p.id));
      if (!stage || drag || movingItem) { dirty = true; return; }
      dirty = false;
      const focused = props.find((p) => p.el === document.activeElement)?.id;
      for (const p of props) if (!floating.has(p.id)) p.el.remove();
      props = Object.keys(data.decor).map((id) => {
        if (floating.has(id)) return floating.get(id);
        const at = positionOf(id), el = make('button', 'gz-game-item'); el.type = 'button'; el.dataset.item = id; el.dataset.shelf = String(!!P.DECOR[id].shelf);
        el.setAttribute('aria-label', t(P.DECOR[id].toy ? '{name}. Drag outside to play; W takes it out, H returns it, Delete puts it away.' : '{name}. Drag to place; arrow keys move; Delete puts away.', { name: t(P.DECOR[id].name) }));
        el.title = t(P.DECOR[id].name); el.append(art(id)); stage.append(el);
        const w = P.DECOR[id].shelf ? (stage.clientWidth || 320) * .34 : 54, h = P.DECOR[id].shelf ? 38 : 54;
        const p = { id, el, x: at.x / 100 * (stage.clientWidth || 320) - w / 2, y: at.y / 100 * (stage.clientHeight || 240) - h, w, h, vx: 0, vy: 0 };
        el.style.width = `${w}px`; el.style.height = `${h}px`; putProp(p);
        el.addEventListener('pointerdown', (e) => begin(e, p));
        el.addEventListener('keydown', (e) => {
          if (!e.isTrusted) return;
          if (P.DECOR[id].toy && ['w', 'h'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            if (e.key.toLowerCase() === 'w') { const r = el.getBoundingClientRect(), prior = activeDecision(); takeOut(p, r.left + window.scrollX, r.top + window.scrollY); if (!wandering) relocate(true); changeMode(true, false, prior); startToyPlay(p); }
            else { if (activity?.toy?.id === id) activity.until = 0; floating.delete(id); el.remove(); renderProps(); props.find((p) => p.id === id)?.el.focus({ preventScroll: true }); }
            return;
          }
          if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); commit({ op: 'decor', item: id, cell: null }); }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault(); const step = e.shiftKey ? 10 : 3;
            if (floating.has(id)) { p.x = Math.max(0, Math.min(pageSize().width - p.w, p.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0))); p.y = Math.max(0, Math.min(pageSize().height - p.h, p.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0))); p.vx = p.vy = 0; putProp(p); return; }
            const x = at.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y = at.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
            commit({ op: 'place', item: id, position: { x: Math.max(5, Math.min(95, x)), y: Math.max(10, Math.min(96, y)) } });
          }
        });
        return p;
      });
      if (focused) props.find((p) => p.id === focused)?.el.focus({ preventScroll: true });
      scan(); wake();
    };
    const putProp = (p) => { p.el.style.left = '0'; p.el.style.top = '0'; p.el.style.transform = `translate3d(${p.x}px,${p.y}px,0)`; };
    const scan = () => {
      surfaces = [];
      if (!wandering) surfaces = props.filter((p) => P.DECOR[p.id].shelf).map((p) => ({ x: p.x, y: p.y + 10, w: p.w }));
      else {
        // Observe only geometry; never activate a page control or change student content.
        const active = outing?.surface.el || activity?.target?.el;
        const elements = new Set([...viewDoc.querySelectorAll('h1,h2,h3,article,section,[role="region"],.ic-DashboardCard,.element-card,.gz-w')].slice(0, 80));
        if (active?.isConnected && active.ownerDocument === viewDoc) elements.add(active);
        for (const el of elements) {
          if (el.closest('.gz-game,.gz-game-dialog,.gz-game-world,form,nav,header,aside,[role="navigation"],[contenteditable="true"]') || el.querySelector('input,textarea,select,[contenteditable="true"]')) continue;
          const r = pageRect(el);
          if (r.w >= 70 && r.h > 5 && (el === active || visible(r, 100))) surfaces.push({ el, ...r, kind: /^H[1-3]$/.test(el.tagName) ? 'heading' : el.matches('.gz-w') ? 'widget' : 'card' });
        }
      }
      if (outing) {
        const next = surfaces.find((surface) => surface.el === outing.surface.el);
        if (!next) { outing = null; avatar.style.clipPath = ''; actor.dataset.behavior = ''; }
        else {
          if (outing.phase !== 'approach') { b.x += next.x - outing.surface.x; b.y += next.y - outing.surface.y; }
          outing.surface = next;
        }
      }
      if (activity?.target && activity.phase !== 'approach' && !activity.toy) {
        const next = targets().find((s) => activity.target.id ? s.id === activity.target.id : s.el === activity.target.el);
        if (next) { b.x += next.x - activity.target.x; b.y += next.y - activity.target.y; activity.target = next; }
      }
    };
    const explore = (now, dt) => {
      if (outing && !outing.surface.el?.isConnected) { outing = null; avatar.style.clipPath = ''; }
      if (!outing && !activity && now >= nextAction) decide(now);
      if (activity) return act(now, dt);
      if (!outing) { actor.dataset.behavior = now < idleUntil ? decision?.action || '' : 'walk'; return now < idleUntil ? { controlled: false, pose: idlePose } : null; }
      const o = outing, s = o.surface, edge = o.left ? s.x - b.w * .65 : s.x + s.w - b.w * .35;
      const toward = (goal, speed = 85) => { const delta = goal - b.x, wanted = Math.sign(delta) * Math.min(speed, Math.abs(delta) * 4); b.vx += (wanted - b.vx) * (1 - Math.exp(-dt / .12)); return Math.abs(delta) < 3; };
      let pose = 'idle', controlled = false;
      if (o.phase === 'approach') {
        pose = facingPose(edge - b.x);
        if (toward(Math.max(0, Math.min(bounds().width - b.w, edge)))) { o.phase = 'climb'; b.vx = b.vy = 0; }
      }
      if (o.phase === 'climb') {
        const y = o.hide ? s.y + Math.min(35, (s.h - b.h) / 2) : s.y - b.h;
        const delta = y - b.y; controlled = true; pose = 'climbing';
        b.y += Math.sign(delta) * Math.min(Math.abs(delta), 105 * dt); b.vy = 0;
        if (Math.abs(delta) < 2) { o.phase = o.hide ? 'conceal' : 'settle'; b.y = y; }
      }
      if (o.phase === 'settle') {
        controlled = true; b.y = s.y - b.h; b.vy = 0; pose = facingPose(s.x - b.x);
        const x = Math.max(0, Math.min(bounds().width - b.w, perchX(s)));
        const done = toward(x, 65); b.x += b.vx * dt;
        if (done) { b.vx = 0; o.phase = 'perch'; o.until = now + 45000 + Math.random() * 75000; nextAction = o.until; }
      }
      if (o.phase === 'perch') {
        controlled = true; b.vx = b.vy = 0; b.y = s.y - b.h; pose = 'perching';
        if (now > o.until) { outing = null; nextAction = now; b.vx = b.vy = 0; }
      }
      if (['conceal', 'hidden', 'peek', 'peeking', 'exit'].includes(o.phase)) {
        controlled = true; b.vy = 0;
        const goal = o.phase === 'exit' ? (o.left ? s.x - b.w - 6 : s.x + s.w + 6)
          : ['peek', 'peeking'].includes(o.phase) ? (o.left ? s.x - b.w * .55 : s.x + s.w - b.w * .45)
          : o.left ? s.x + 5 : s.x + s.w - b.w - 5;
        const done = toward(goal, 55); b.x += b.vx * dt; pose = 'peeking';
        const l = Math.max(0, s.x - b.x), r = Math.min(b.w, s.x + s.w - b.x), top = Math.max(0, s.y - b.y), bottom = Math.min(b.h, s.y + s.h - b.y);
        avatar.style.clipPath = r > l && bottom > top ? `path(evenodd, "M0 0H${b.w}V${b.h}H0Z M${l} ${top}H${r}V${bottom}H${l}Z")` : '';
        if (done && o.phase === 'conceal') { o.phase = 'hidden'; o.until = now + 1000; }
        if (o.phase === 'hidden' && now > o.until) o.phase = 'peek';
        if (done && o.phase === 'peek') { o.phase = 'peeking'; o.until = now + 2400; }
        if (o.phase === 'peeking' && now > o.until) o.phase = 'exit';
        if (done && o.phase === 'exit') { outing = null; avatar.style.clipPath = ''; b.vx = o.left ? -65 : 65; nextAction = now + 4000; }
      }
      actor.dataset.behavior = outing?.phase || '';
      return { controlled, pose, direction: o.left ? 12 : 4 };
    };
    const targets = () => {
      const r = wandering && stage ? pageRect(stage) : null;
      const furniture = props.filter((p) => p.el.isConnected && (floating.has(p.id) || !wandering || stage?.isConnected && r?.w > 0)).map((p) => ({ ...p, kind: p.id, x: p.x + (floating.has(p.id) ? 0 : r?.x || 0), y: p.y + (floating.has(p.id) ? 0 : r?.y || 0) }));
      return [...surfaces.filter((s) => s.el), ...furniture].filter((s) => s.x + s.w > 0 && s.x < bounds().width && s.y + s.h > 0 && s.y < bounds().height);
    };
    const takeOut = (p, x, y) => {
      const focused = document.activeElement === p.el;
      floating.set(p.id, p); p.el.dataset.outside = 'true'; worldHost().append(p.el);
      if (focused) p.el.focus({ preventScroll: true });
      if (drag?.target === p.el) p.el.setPointerCapture(drag.pointer);
      const box = pageSize(); p.x = Math.max(0, Math.min(box.width - p.w, x)); p.y = Math.max(0, Math.min(box.height - p.h, y)); p.ground = Math.max(p.y + p.h, window.scrollY + window.innerHeight - 6); p.anchor = anchorAt(p.x + p.w / 2, p.y + p.h / 2); putProp(p);
    };
    const startToyPlay = (p) => {
      clearActivity(); const now = performance.now(); playedAt = now;
      anchor = p.anchor && { ...p.anchor, nodes: p.anchor.nodes.map((n) => ({ ...n })) };
      decision = { action: 'play', context: features({ ...p, kind: p.id }), at: now }; actor.dataset.intent = actor.dataset.behavior = 'play';
      activity = { action: 'play', target: p, toy: p, invited: true, phase: 'play', started: now, until: now + 15000, hop: 0 }; nextAction = activity.until;
      if (stage?.isConnected) stage.dispatchEvent(new CustomEvent('glaze:pet-intent', { detail: { action: 'play', reason: 'choice' } }));
      if (data.learning && now - observedAt >= 8000 && allowed() && !still()) { observedAt = now; observedAction = 'play'; commit({ op: 'observe', action: 'play', context: decision.context }); }
      feedback('play'); wake();
    };
    const decide = (now) => {
      const choices = targets().filter((s) => !wandering || visible(s)), busy = typing() || pointerForm || now - scrolledAt < 1200, invited = now - playedAt < 45000;
      const available = [...(recent[recent.length - 1] !== 'walk' ? ['walk'] : []), 'rest', 'greet', 'groom', 'stretch', ...(choices.length ? ['investigate', 'study'] : []), ...(!focus && !busy && invited ? ['play'] : []),
        ...(!focus && !busy && invited && now - cursorAt < 6000 ? ['follow'] : []), ...(wandering && !focus && stage?.isConnected && homeVisible() ? ['home'] : []),
        ...(wandering && data.physics && surfaces.some((s) => visible(s) && perchable(s)) ? ['perch'] : []), ...(wandering && data.physics && surfaces.some((s) => visible(s) && s.h > 100 && s.w > 150) ? ['hide'] : [])];
      const action = B.choose(data.learning ? data.brain : null, features(), available, Math.random, { recent });
      let candidates = ['hide', 'perch'].includes(action) ? surfaces.filter((s) => visible(s) && s.w >= b.w && (action === 'perch' ? perchable(s) : s.h > 100 && s.w > 150)) : choices;
      if (action === 'play') candidates = choices.filter((s) => P.DECOR[s.id]?.toy && (!wandering || floating.has(s.id)));
      if (action === 'rest') candidates = choices.filter((s) => ['bed', 'pillow'].includes(s.kind));
      if (action === 'study') { const reading = choices.filter((s) => ['books', 'lamp', 'heading'].includes(s.kind)); if (reading.length) candidates = reading; }
      const target = candidates.map((surface) => ({ surface, score: B.predict(data.learning ? data.brain : null, action, features(surface)) + Math.random() * .1 })).sort((a, c) => c.score - a.score)[0]?.surface;
      decision = { action, context: features(target), at: now }; recent.push(action); if (recent.length > 6) recent.shift();
      actor.dataset.intent = actor.dataset.behavior = action;
      if (stage?.isConnected) stage.dispatchEvent(new CustomEvent('glaze:pet-intent', { detail: { action, reason: focus ? 'focus' : typing() ? 'typing' : energy < .3 ? 'tired' : 'choice' } }));
      if (data.learning && action !== observedAction && now - observedAt >= 8000 && allowed() && !still()) {
        observedAt = now; observedAction = action; commit({ op: 'observe', action, context: decision.context });
      }
      nextAction = now + (action === 'play' ? 15000 : action === 'walk' ? 5000 + Math.random() * 4000 : ['rest', 'study', 'groom'].includes(action) ? 45000 + Math.random() * 75000 : 20000 + Math.random() * 20000);
      if (wandering && target?.el) anchor = target.id && floating.has(target.id) ? { ...floating.get(target.id).anchor, nodes: floating.get(target.id).anchor.nodes.map((p) => ({ ...p })) } : scrollAnchor(target.el);
      if (target && ['perch', 'hide'].includes(action)) outing = { surface: target, phase: 'approach', left: b.x + b.w / 2 < target.x + target.w / 2, hide: action === 'hide', until: 0 };
      else if (['investigate', 'study', 'rest', 'follow', 'play', 'groom', 'stretch', 'home'].includes(action)) {
        activity = { action, target: ['investigate', 'study', 'rest', 'play'].includes(action) ? target : null, toy: action === 'play' && target ? props.find((p) => p.id === target.id) : null, phase: target && ['investigate', 'study', 'rest'].includes(action) || action === 'home' ? 'approach' : action, started: now, until: nextAction, hop: 0 };
        b.vx = 0;
        if (action === 'play' && !activity.toy) { toy = make('span', 'gz-game-toy'); toy.setAttribute('aria-hidden', 'true'); (wandering ? worldHost() : stage)?.append(toy); }
      } else { idleUntil = action === 'greet' ? nextAction : 0; idlePose = 'idle'; b.vx = action === 'walk' ? (Math.random() > .5 ? 40 : -40) : 0; if (action === 'greet') play('waving'); }
    };
    const act = (now, dt) => {
      const a = activity, box = bounds(), ax = anchor?.x || 0, ay = anchor?.y || 0, clampX = (x) => Math.max(ax, Math.min(ax + box.width - b.w, x)), clampY = (y) => Math.max(ay, Math.min(ay + box.height - b.h, y));
      if (now >= a.until && a.action === 'play') {
        clearActivity(); decision = { action: 'rest', context: features(), at: now }; actor.dataset.intent = actor.dataset.behavior = 'rest'; idleUntil = nextAction = now + 45000; idlePose = 'idle';
        if (stage?.isConnected) stage.dispatchEvent(new CustomEvent('glaze:pet-intent', { detail: { action: 'rest', reason: 'choice' } }));
        if (data.learning && observedAction !== 'rest' && now - observedAt >= 8000 && allowed() && !still()) { observedAt = now; observedAction = 'rest'; commit({ op: 'observe', action: 'rest', context: decision.context }); }
        return { controlled: false, pose: 'idle' };
      }
      if (now >= a.until || (['follow', 'play'].includes(a.action) && ((focus || now - scrolledAt < 1200) && !a.invited || typing() || pointerForm)) || a.action === 'home' && (!stage?.isConnected || !homeVisible() || focus)) { clearActivity(); nextAction = now + 1000; return null; }
      if (a.target) {
        const next = targets().find((s) => a.target.id ? s.id === a.target.id : s.el === a.target.el);
        if (!next) { clearActivity(); nextAction = now + 1200; return null; }
        if (a.phase !== 'approach' && !a.toy) { b.x += next.x - a.target.x; b.y += next.y - a.target.y; }
        a.target = next;
        if (a.toy) a.toy = props.find((p) => p.id === next.id);
      }
      const toward = (x, y, speed = 65) => {
        x = clampX(x); y = clampY(y);
        const dx = x - b.x, dy = y - b.y, distance = Math.hypot(dx, dy);
        a.speed = (a.speed || 0) + (Math.min(speed, distance * 4) - (a.speed || 0)) * (1 - Math.exp(-dt / .12));
        const step = Math.min(1, a.speed * dt / (distance || 1));
        b.x += dx * step; b.y += dy * step; b.vx = b.vy = 0;
        return distance < 4;
      };
      let pose = 'idle', controlled = false;
      if (a.action === 'home') {
        const r = pageRect(stage); pose = facingPose(r.x + (r.w - b.w) / 2 - b.x); controlled = true;
        if (a.phase !== 'arrived' && toward(r.x + (r.w - b.w) / 2, r.y + r.h - b.h - 12, 110)) { a.phase = 'arrived'; a.until = now + 15000; changeMode(false, true); }
      } else if (a.phase === 'approach') {
        const s = a.target, left = a.left ??= b.x + b.w / 2 < s.x + s.w / 2;
        pose = left ? 'running-right' : 'running-left'; controlled = true;
        const x = a.action === 'rest' ? s.x + (s.w - b.w) / 2 : left ? s.x - b.w + 12 : s.x + s.w - 12;
        if (toward(x, a.action === 'rest' ? s.y + s.h - b.h : s.y + Math.min(s.h / 2, 90) - b.h / 2)) { a.phase = 'settle'; a.settled = now; a.until = Math.max(a.until, now + 3500); }
      } else if (a.action === 'follow') {
        if (now - cursorAt > 6000) { clearActivity(); nextAction = now + 1000; return null; }
        const r = !wandering ? stage?.getBoundingClientRect() : null, x = cursor.x - (wandering ? -window.scrollX : r?.left || 0), y = cursor.y - (wandering ? -window.scrollY : r?.top || 0);
        const dx = x - b.x - b.w / 2, dy = y - b.y - b.h / 2, distance = Math.hypot(dx, dy);
        controlled = true; pose = distance > 155 ? facingPose(dx) : 'look';
        if (distance > 155) toward(b.x + dx * (distance - 145) / distance, b.y + dy * (distance - 145) / distance, 70);
        else { b.vx = b.vy = 0; }
      } else if (a.action === 'play') {
        const elapsed = (now - a.started) / 1000, x = clampX(a.toy ? a.toy.x + (a.toy.w - b.w) / 2 : (wandering ? window.scrollX + window.innerWidth / 2 : box.width / 2) + Math.sin(elapsed * 1.3) * Math.min(100, (wandering ? window.innerWidth : box.width) / 3)), delta = x - b.x;
        b.vx += (Math.sign(delta) * Math.min(90, Math.abs(delta) * 4) - b.vx) * (1 - Math.exp(-dt / .15)); pose = Math.abs(delta) > 8 ? facingPose(delta) : 'look';
        if (a.toy && Math.abs(delta) < 24 && now - a.hop > 1500) { a.toy.vx = (Math.random() > .5 ? 1 : -1) * 45; a.toy.vy = -100; if (data.physics && b.grounded) { b.vy = -230; pose = 'jumping'; } a.hop = now; }
        if (!a.toy && data.physics && b.grounded && now - a.hop > 1500) { b.vy = -230; a.hop = now; pose = 'jumping'; }
        if (toy) { toy.dataset.wander = String(wandering); toy.style.transform = `translate3d(${x + b.w / 2}px,${(wandering ? groundY : box.height) - 14 - Math.abs(Math.sin(elapsed * 3)) * 20}px,0)`; }
      } else {
        b.vx = 0; controlled = !!a.target; if (controlled) b.vy = 0;
        pose = a.action === 'rest' ? 'sleeping' : a.action === 'study' ? 'review' : a.action === 'investigate' ? (Math.floor((now - a.settled) / 1300) % 2 ? 'peeking' : 'look') : a.action === 'groom' ? (now - a.started < 7000 && Math.floor((now - a.started) / 1100) % 2 ? 'look' : 'waiting') : now - a.started < 4000 ? 'jumping' : 'idle';
      }
      actor.dataset.behavior = `${a.action}-${a.phase}`;
      if (a.action === 'groom' || a.action === 'stretch') actor.dataset.behavior = a.action;
      return { controlled, pose };
    };
    const atHome = (now, dt) => {
      if (!activity && now >= nextAction) decide(now);
      if (activity) return act(now, dt);
      return now < idleUntil ? { controlled: false, pose: idlePose } : null;
    };
    const recover = (now, dt) => {
      if (!recovery) {
        clearActivity(); recovery = { at: now, scan: 0, speed: 0 };
        decision = { action: 'walk', context: features(), at: now }; actor.dataset.intent = 'walk';
        if (stage?.isConnected) stage.dispatchEvent(new CustomEvent('glaze:pet-intent', { detail: { action: 'walk', reason: 'choice' } }));
      }
      const r = recovery;
      if (!r.goal || now - r.scan > 500 || r.goal.el && !r.goal.el.isConnected) {
        const ledges = surfaces.filter((s) => s.el?.isConnected && visible(s) && perchable(s) && s.y > window.scrollY + b.h + 24 && s.y < window.scrollY + window.innerHeight - 40);
        const ledge = ledges.map((s) => ({ s, value: B.predict(data.learning ? data.brain : null, 'perch', features(s)) - Math.hypot(s.x - b.x, s.y - b.y) / 10000 })).sort((a, c) => c.value - a.value)[0]?.s;
        const box = pageSize(), floor = Math.min(box.height, window.scrollY + window.innerHeight - 6);
        r.goal = ledge ? { x: perchX(ledge), y: ledge.y - b.h, ground: ledge.y, el: ledge.el, surface: ledge } : { x: Math.max(window.scrollX + 24, Math.min(window.scrollX + window.innerWidth - b.w - 24, b.x)), y: floor - b.h, ground: floor };
        r.scan = now;
      }
      const dx = r.goal.x - b.x, dy = r.goal.y - b.y, distance = Math.hypot(dx, dy);
      r.speed += (Math.min(90, distance * 3) - r.speed) * (1 - Math.exp(-dt / .18));
      const step = Math.min(1, r.speed * dt / (distance || 1)); b.x += dx * step; b.y += dy * step; b.vx = b.vy = 0;
      actor.dataset.behavior = 'recover';
      if (distance < 4 && visible(b)) {
        const goal = r.goal; groundY = goal.ground; clearActivity();
        anchor = goal.el ? scrollAnchor(goal.el) : anchorAt(b.x + b.w / 2, b.y + b.h / 2);
        const action = goal.surface?.el.isConnected ? 'perch' : 'rest';
        decision = { action, context: features(goal.surface), at: now }; actor.dataset.intent = actor.dataset.behavior = action; idlePose = 'idle'; idleUntil = nextAction = now + 45000;
        if (action === 'perch') outing = { surface: goal.surface, phase: 'perch', left: b.x < goal.surface.x + goal.surface.w / 2, hide: false, until: nextAction };
        if (stage?.isConnected) stage.dispatchEvent(new CustomEvent('glaze:pet-intent', { detail: { action, reason: 'choice' } }));
        return { controlled: true, pose: 'idle' };
      }
      return { controlled: true, pose: Math.abs(dy) > Math.abs(dx) ? 'climbing' : facingPose(dx) };
    };
    const tick = () => {
      clearTimeout(timer); timer = 0;
      if (!alive) return;
      if (!chrome.runtime?.id || globalThis.GZ_CTABS?.revoked?.() || (!stage?.isConnected && !wandering)) { destroy(); return; }
      syncSurface();
      if (wandering && anchor?.nodes.some((p) => !p.el.isConnected)) anchor = anchorAt(b.x + b.w / 2, b.y + b.h / 2);
      actor.hidden = !allowed(); if (toy) toy.hidden = actor.hidden; for (const p of floating.values()) p.el.hidden = actor.hidden;
      if (actor.hidden) { if (awake) player?.sleep(); awake = false; return; }
      if (!awake) player?.wake(); awake = true;
      if (still()) { if (!wasStill) { clearActivity(); nextAction = 0; wasStill = true; } const box = bounds(); b.vx = b.vy = 0; const ax = anchor?.x || 0, ay = anchor?.y || 0; b.x = Math.max(ax, Math.min(ax + box.width - b.w, b.x)); b.y = Math.max(ay, Math.min(ay + box.height - b.h, b.y)); display(); return; }
      wasStill = false;
      if (focus && focusEnd <= Date.now()) updateFocus(focusTimer);
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000 || 1 / 30), box = bounds(); last = now;
      if (now - lastScan > 2000 || geometryDirty && now - lastScan >= 80) { scan(); lastScan = now; geometryDirty = false; }
      const outside = wandering && !visible(b), resting = !recovery && (activity?.action === 'rest' && activity.phase !== 'approach' || now < idleUntil && idlePose === 'sleeping');
      if (outside && resting && !drag) { b.vx = b.vy = 0; display(); return; }
      if (outside && !offscreenAt) offscreenAt = now;
      if (!outside && !recovery) offscreenAt = 0;
      const returning = !drag && wandering && (recovery || outside && now - offscreenAt >= 3000);
      const water = !wandering && data.habitat === 'aquarium';
      const action = !drag ? returning ? recover(now, dt) : wandering ? explore(now, dt) : atHome(now, dt) : null;
      energy = Math.max(0, Math.min(1, energy + dt * (decision?.action === 'rest' ? .035 : -.003)));
      if (!drag) {
        if (action?.controlled) { /* The pet grips the ledge while climbing, perching or peeking. */ }
        else if (data.physics) b = step(b, { ...box, height: wandering ? Math.max(b.y + b.h, groundY) : box.height, platforms: surfaces, water, dt }, anchor);
        else { const ax = anchor?.x || 0; b.x = Math.max(ax, Math.min(ax + box.width - b.w, b.x + b.vx * dt)); if (b.x <= ax || b.x >= ax + box.width - b.w) b.vx *= -1; b.y = (wandering ? groundY : box.height) - b.h; }
        display();
        let state = action?.pose || (Math.abs(b.vx) > 3 ? facingPose(b.vx) : 'idle'), direction = action?.direction || 0;
        const r = !wandering ? stage?.getBoundingClientRect() : null, dx = cursor.x - (wandering ? -window.scrollX : r?.left || 0) - b.x - b.w / 2, dy = cursor.y - (wandering ? -window.scrollY : r?.top || 0) - b.y - b.h / 2;
        const near = Math.hypot(dx, dy), watching = now - cursorAt < 2400 && near < 600 && (['idle', 'perching', 'waiting', 'look'].includes(state) || state === 'sleeping' && near < 120 && !focus && energy > .3);
        if (watching && globalThis.GZ_PET_SPRITES) { state = 'look'; direction = GZ_PET_SPRITES.direction(dx, dy); }
        if (!actor.dataset.reaction && (state !== lastMotion || state === 'look' && direction !== lastGaze)) { lastMotion = state; lastGaze = direction; player?.play(state, direction); }
      }
      for (const p of floating.values()) if (p !== movingItem) {
        if (p.anchor?.nodes.some((n) => !n.el.isConnected)) p.anchor = anchorAt(p.x + p.w / 2, p.y + p.h / 2);
        if (data.physics) Object.assign(p, step(p, { width: extent(p.anchor).width, height: p.ground, dt }, p.anchor));
        else { p.vx = p.vy = 0; }
        p.vx *= Math.exp(-1.2 * dt); putProp(p);
      }
      if (!wandering && data.physics) for (const p of props) {
        if (p === movingItem || floating.has(p.id) || P.DECOR[p.id].fixed) continue;
        Object.assign(p, F.step(p, { ...box, platforms: surfaces, water, dt })); putProp(p);
      }
      timer = setTimeout(tick, 1000 / 30);
    };
    const wake = () => { clearTimeout(timer); timer = 0; last = performance.now(); tick(); };
    const begin = (e, item = null) => {
      if (!e.isTrusted || e.button !== 0 || e.target.closest('.gz-game-home')) return;
      e.preventDefault(); e.stopPropagation();
      const target = item?.el || actor, r = target.getBoundingClientRect();
      drag = { target, pointer: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, at: performance.now(), moved: false, was: wandering, decision: activeDecision(), itemOutside: item && floating.has(item.id), itemX: item?.x, itemY: item?.y, vx: 0, vy: 0 };
      movingItem = item; target.dataset.dragging = 'true';
      clearActivity(); movedAt = performance.now();
      if (!item && !wandering) { relocate(true, { x: r.left + window.scrollX, y: r.top + window.scrollY }); }
      target.setPointerCapture(e.pointerId);
      target.focus({ preventScroll: true });
    };
    const move = (e) => {
      const offset = viewFrame && e.target?.ownerDocument === viewDoc ? frameOffset() : { x: 0, y: 0 };
      const clientX = e.clientX + offset.x, clientY = e.clientY + offset.y;
      if (e.isTrusted) {
        const now = performance.now(), elapsed = Math.max(16, now - cursorAt);
        cursorSpeed = cursorAt ? Math.min(3000, Math.hypot(clientX - cursor.x, clientY - cursor.y) / elapsed * 1000) : 0;
        cursor = { x: clientX, y: clientY }; cursorAt = now;
        pointerForm = !e.target.closest?.('.gz-game-actor,.gz-game-item,.gz-game-home') && !!e.target.closest?.('input,textarea,select,button,a,[role="button"],[contenteditable="true"],[role="textbox"]');
      }
      if (!drag || e.pointerId !== drag.pointer) return;
      e.preventDefault(); const now = performance.now(), dt = Math.max(16, now - drag.at);
      drag.vx = Math.max(-450, Math.min(450, (e.clientX - drag.x) / dt * 1000)); drag.vy = Math.max(-500, Math.min(500, (e.clientY - drag.y) / dt * 1000));
      drag.moved ||= Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 2;
      drag.x = e.clientX; drag.y = e.clientY; drag.at = now;
      if (movingItem && P.DECOR[movingItem.id].toy && !floating.has(movingItem.id)) {
        const r = stage.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) takeOut(movingItem, e.clientX + window.scrollX - drag.dx, e.clientY + window.scrollY - drag.dy);
      }
      const r = movingItem && !floating.has(movingItem.id) ? stage.getBoundingClientRect() : { left: -window.scrollX, top: -window.scrollY };
      const p = movingItem || b;
      p.x = e.clientX - r.left - drag.dx; p.y = e.clientY - r.top - drag.dy;
      if (movingItem) putProp(p); else display();
    };
    const end = (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag, item = movingItem; drag = movingItem = null; d.target.dataset.dragging = 'false';
      suppressClick = d.moved;
      if (e.type === 'pointercancel') { if (item) { if (!d.itemOutside) { floating.delete(item.id); item.el.remove(); } else { item.x = d.itemX; item.y = d.itemY; putProp(item); } } actor.remove(); relocate(data.wander); renderProps(); wake(); return; }
      if (item) {
        const r = stage?.getBoundingClientRect();
        if (P.DECOR[item.id].toy && floating.has(item.id)) {
          const inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (inside) { floating.delete(item.id); item.el.remove(); commit({ op: 'place', item: item.id, position: { x: Math.max(5, Math.min(95, (item.x - window.scrollX - r.left + item.w / 2) / r.width * 100)), y: Math.max(10, Math.min(96, (item.y - window.scrollY - r.top + item.h) / r.height * 100)) } }); renderProps(); }
          else { item.anchor = anchorAt(item.x + item.w / 2, item.y + item.h / 2); item.ground = Math.max(item.y + item.h, window.scrollY + window.innerHeight - 6); item.vx = Math.max(-90, Math.min(90, d.vx * .2)); item.vy = Math.max(-100, Math.min(100, d.vy * .15)); if (!wandering) { relocate(true); changeMode(true, false, d.decision); } startToyPlay(item); }
          if (dirty) renderProps(); wake(); return;
        }
        if (!r) { wake(); return; }
        if (e.clientX < r.left - 30 || e.clientX > r.right + 30 || e.clientY < r.top - 30 || e.clientY > r.bottom + 30) commit({ op: 'decor', item: item.id, cell: null });
        else commit({ op: 'place', item: item.id, position: { x: Math.max(5, Math.min(95, (item.x + item.w / 2) / r.width * 100)), y: Math.max(10, Math.min(96, (item.y + item.h) / r.height * 100)) } });
      } else {
        const r = stage?.getBoundingClientRect(), inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        const wander = d.moved ? !inside : d.was;
        relocate(wander); if (wander) groundY = Math.max(b.y + b.h, window.scrollY + window.innerHeight - 6); b.vx = d.vx; b.vy = d.vy; nextAction = performance.now() + 1800;
        if (wander) anchor = anchorAt(b.x + b.w / 2, b.y + b.h / 2);
        if (wander !== data.wander) changeMode(wander, false, d.decision);
        if (d.moved && wander === data.wander) feedback(d.was && wander ? 'away' : 'play', d.decision);
        if (!d.moved) { playedAt = performance.now(); feedback('pet', d.decision); play('playing', t('Happy to see you!')); }
      }
      if (dirty) renderProps(); wake();
    };
    const setData = (next, freshStage = false) => {
      if (!next || !alive) return;
      const before = data; data = next;
      if (freshStage) { clearActivity(); nextAction = 0; }
      if (!before || next.needs.at !== before.needs.at || next.needs.energy !== before.needs.energy) energy = next.needs.energy / 100;
      if (before && (before.physics !== next.physics || before.habitat !== next.habitat)) { clearActivity(); nextAction = 0; }
      if (!drag) {
        relocate(data.wander);
        if (freshStage || !before || JSON.stringify([before.decor, before.positions, before.habitat]) !== JSON.stringify([next.decor, next.positions, next.habitat])) renderProps();
      }
      const previousXp = xpSeen; xpSeen = next.xp;
      if (previousXp !== null && next.xp > previousXp) {
        const earned = next.xp - previousXp; celebratedAt = performance.now();
        play(next.level > before.level ? 'level-up' : 'xp', next.level > before.level ? t('Level {level}!', { level: next.level }) : `+${earned} XP`);
        // XP feedback is applied once by the serialized broker; every tab can show the reaction.
      }
      wake();
    };
    const updateFocus = (timerState, initial = false) => {
      focusTimer = timerState; focusEnd = timerState?.phase === 'work' ? Number(timerState.end) || 0 : 0; const next = focusEnd > Date.now();
      if (focus !== next) { focus = next; if (!initial && data) commit({ op: 'read', ...activeDecision() }); clearActivity(); nextAction = 0; }
    };
    const changed = (ch, area) => {
      if (area === 'sync' && (ch.enabled?.newValue === false || (ch.enhance && !ch.enhance.newValue?.pet))) { destroy(); return; }
      if (area !== 'local') return;
      if (ch.widgetTimer) { updateFocus(ch.widgetTimer.newValue); wake(); }
      if (ch[key]) { const v = P.view(ch[key].newValue); if (v) setData(v); }
      const suffix = key.slice(4);
      if (wandering && (ch[`todo:${suffix}`] || ch[`insights:${suffix}`] || ch[`remind:${suffix}`] || ch.todoCache)) commit({ op: 'read' });
    };
    const attach = (nextStage, next) => {
      const previousStage = stage;
      if (nextStage && !hosts.has(nextStage)) { hosts.add(nextStage); stage = nextStage; }
      else if (!stage?.isConnected && nextStage) stage = nextStage;
      if (stage) stage.dataset.habitat = next.habitat;
      if (!player) player = GZ_WIDGETS_UI.avatar(avatar, { interactive: false, resting: 'idle', attention: false });
      setData(next, previousStage !== stage);
    };
    const detach = (oldStage) => {
      hosts.delete(oldStage);
      if (oldStage !== stage) return;
      const previous = [...hosts].reverse().find((host) => host.isConnected);
      if (previous) { stage = null; attach(previous, data); return; }
      if (wandering) { for (const p of props) if (!floating.has(p.id)) p.el.remove(); props = props.filter((p) => floating.has(p.id)); stage = null; }
      else destroy();
    };
    const destroy = () => {
      if (!alive) return;
      alive = false; clearActivity(); clearTimeout(timer); clearTimeout(reaction); player?.stop();
      for (const off of offs) off(); offs = [];
      for (const off of frameOffs) off(); frameOffs = [];
      for (const p of props) p.el.remove(); for (const p of floating.values()) p.el.remove(); floating.clear(); actor.remove(); home.remove(); world.remove();
      chrome.storage.onChanged.removeListener(changed); reduced?.removeEventListener('change', wake); motion?.disconnect();
      if (current?.key === key) current = null;
    };
    on(actor, 'pointerdown', (e) => begin(e)); on(document, 'pointermove', move, { passive: false });
    on(document, 'pointerup', end); on(document, 'pointercancel', end);
    on(actor, 'click', (e) => { if (!e.isTrusted || e.target.closest('.gz-game-home')) return; if (suppressClick) { suppressClick = false; return; } playedAt = performance.now(); feedback('pet'); play('playing', t('Happy to see you!')); });
    on(actor, 'keydown', (e) => { if (!e.isTrusted || e.target !== actor) return; const k = e.key.toLowerCase(); if (['w', 'h', 'escape'].includes(k)) { e.preventDefault(); changeMode(k === 'w'); } else if (k === ' ' || k === 'enter') { e.preventDefault(); playedAt = performance.now(); feedback('play'); play('playing'); } });
    on(document, 'visibilitychange', wake); on(window, 'resize', () => { if (stage && data) renderProps(); wake(); });
    const typed = (e) => { if (e.isTrusted && (e.target.matches?.('input,textarea,select,[contenteditable="true"],[role="textbox"]') || e.target.closest?.('[contenteditable="true"]'))) typedAt = performance.now(); };
    on(document, 'keydown', typed, { passive: true });
    const scrolled = (e) => {
      if (world.isConnected) scrollWorld();
      const target = e.target.nodeType === 9 ? e.target.scrollingElement : e.target;
      const shift = (at) => {
        const p = at?.nodes.find((p) => p.el === target);
        if (!p) return null;
        const dx = p.x - p.el.scrollLeft, dy = p.y - p.el.scrollTop;
        p.x -= dx; p.y -= dy; at.x += dx; at.y += dy;
        return { dx, dy };
      };
      const moved = wandering && shift(anchor);
      if (moved && !drag) {
        b.x += moved.dx; b.y += moved.dy; groundY += moved.dy;
        if (outing?.surface.el && target.contains(outing.surface.el)) { outing.surface = { ...outing.surface, x: outing.surface.x + moved.dx, y: outing.surface.y + moved.dy }; }
        if (activity?.target?.el && !activity.toy && target.contains(activity.target.el)) { activity.target = { ...activity.target, x: activity.target.x + moved.dx, y: activity.target.y + moved.dy }; }
        if (recovery) recovery.goal = null;
        display();
      }
      for (const p of floating.values()) {
        const moved = shift(p.anchor);
        if (moved && p !== movingItem) { p.x += moved.dx; p.y += moved.dy; p.ground += moved.dy; putProp(p); }
      }
      scrolledAt = performance.now(); geometryDirty = true; if (!timer && allowed() && !still()) wake();
    };
    on(window, 'scroll', scrolled, { passive: true, capture: true });
    const syncSurface = () => {
      const next = globalThis.GZ_CTABS?.petSurface?.(key), doc = next?.doc || document, frame = next?.frame || null;
      const blocked = document.documentElement.hasAttribute('data-gz-ctab-framed') && !next;
      const changed = viewDoc !== doc || viewFrame !== frame || viewBlocked !== blocked;
      viewBlocked = blocked;
      if (viewDoc === doc && viewFrame === frame) return changed;
      for (const off of frameOffs) off(); frameOffs = [];
      viewDoc = doc; viewFrame = frame;
      clearActivity(); surfaces = []; lastScan = -Infinity; geometryDirty = true; nextAction = 0; cursorAt = 0; pointerForm = false;
      anchor = wandering ? anchorAt(b.x + b.w / 2, b.y + b.h / 2) : null;
      for (const p of floating.values()) p.anchor = anchorAt(p.x + p.w / 2, p.y + p.h / 2);
      if (frame) {
        const bind = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); frameOffs.push(() => el.removeEventListener(type, fn, opts)); };
        bind(doc, 'pointermove', move, { passive: true }); bind(doc, 'keydown', typed, { passive: true });
        bind(doc, 'scroll', scrolled, { passive: true, capture: true }); bind(frame, 'load', wake);
      }
      return changed;
    };
    on(window, 'pagehide', destroy, { once: true });
    const motion = typeof MutationObserver === 'function' ? new MutationObserver(wake) : null;
    motion?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-motion'] });
    chrome.storage.onChanged.addListener(changed); reduced?.addEventListener('change', wake);
    try { chrome.storage.local.get('widgetTimer', (r) => { if (alive) { updateFocus(r?.widgetTimer, true); if (data) wake(); } }); } catch { /* reloaded */ }
    return { key, attach, detach, play, destroy, refresh: () => { if (globalThis.GZ_CTABS?.revoked?.()) { destroy(); return; } const changed = syncSurface(), nextPath = viewDoc.location.pathname; geometryDirty = true; if (changed || path !== nextPath || (!timer && allowed() && !still())) { path = nextPath; wake(); } } };
  };
  return { mount, refresh: () => current?.refresh(), stop: () => current?.destroy() };
})();
GZ_PET_WORLD;
