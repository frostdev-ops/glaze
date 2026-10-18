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
    const actor = make('div', 'gz-game-actor'), avatar = make('div', 'gz-game-avatar'), cheer = make('span', 'gz-game-reaction');
    const home = make('button', 'gz-game-home'); home.type = 'button'; home.textContent = t('Return home');
    home.addEventListener('click', (e) => { if (e.isTrusted) { feedback('home'); commit({ op: 'wander', wander: false }); } });
    actor.append(avatar, cheer); actor.tabIndex = 0; actor.setAttribute('role', 'group');
    actor.setAttribute('aria-label', t('Study buddy. Drag outside to wander, or press W. Press H to return home.'));
    cheer.setAttribute('role', 'status');
    const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    let stage = null, data = null, alive = true, player = null, timer = 0, reaction = 0, drag = null, movingItem = null;
    let b = { x: 30, y: 30, w: 80, h: 86, vx: 0, vy: 0 }, surfaces = [], lastScan = 0, nextAction = 0, last = 0, wandering = false;
    let props = [], offs = [], dirty = false, suppressClick = false, lastMotion = '', path = location.pathname, awake = true, outing = null;
    const hosts = new Set();
    let decision = null, feedbackAt = -Infinity, feedbackEvent = '', focus = false, cursor = { x: -1000, y: -1000 }, energy = .8, idleUntil = 0, idlePose = 'idle';
    const features = (surface) => {
      const hour = new Date().getHours() / 24 * Math.PI * 2;
      return [1, focus ? 1 : 0, Math.hypot(cursor.x - b.x - b.w / 2, cursor.y - b.y - b.h / 2) < 180 ? 1 : 0, data.needs.mood / 50 - 1, data.needs.playful / 50 - 1, energy * 2 - 1, Math.sin(hour), Math.cos(hour), surface?.kind === 'heading' ? 1 : 0, surface?.kind === 'card' ? 1 : 0, wandering ? 1 : 0, data.habitat === 'aquarium' ? 1 : 0];
    };
    const feedback = (event) => {
      if (!alive || !data || (feedbackEvent === event && performance.now() - feedbackAt < 800)) return;
      feedbackAt = performance.now(); feedbackEvent = event;
      commit({ op: 'interact', event, ...(decision && performance.now() - decision.at < 60000 && { action: decision.action, context: decision.context }) });
    };
    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); offs.push(() => el.removeEventListener(type, fn, opts)); };
    const still = () => reduced?.matches || document.documentElement.getAttribute('data-gz-motion') === 'off';
    const quiet = () => /\/quizzes\/|\/assessment\/|\/(?:attempt|lti)(?:\/|$)|\/external_tools\//.test(location.pathname) || !!document.querySelector('iframe#tool_content');
    const bounds = () => wandering ? { width: window.innerWidth, height: window.innerHeight - 6 } : { width: stage?.clientWidth || 320, height: (stage?.clientHeight || 240) * .95 };
    const homeVisible = () => { const r = stage?.getBoundingClientRect(); return r && r.width > 0 && r.bottom > 0 && r.top < window.innerHeight; };
    const allowed = () => alive && !!chrome.runtime?.id && !document.hidden && (wandering ? !quiet() : homeVisible());
    const art = (id) => { const img = make('img', ''); img.src = chrome.runtime.getURL(`assets/art/stickers/${P.DECOR[id].art}.webp`); img.alt = ''; img.draggable = false; return img; };
    const display = () => { actor.style.left = '0'; actor.style.top = '0'; actor.style.transform = `translate3d(${b.x}px,${b.y}px,0)`; };
    const play = (state, message = '') => {
      player?.play(state); lastMotion = ''; actor.dataset.reaction = state; cheer.textContent = message;
      clearTimeout(reaction); reaction = setTimeout(() => { actor.dataset.reaction = ''; cheer.textContent = ''; }, 2200);
    };
    const relocate = (wander, at) => {
      if (wander === wandering && actor.parentElement === (wander ? document.body : stage)) return;
      wandering = wander; actor.dataset.wander = String(wander); home.hidden = !wander;
      outing = null; idleUntil = 0; lastMotion = ''; avatar.style.clipPath = ''; actor.dataset.behavior = '';
      (wander ? document.body : stage)?.append(actor);
      if (wander) document.body.append(home); else home.remove();
      const box = bounds(); b = { ...b, x: at?.x ?? Math.max(0, (box.width - b.w) / 2), y: at?.y ?? Math.max(0, box.height - b.h), vx: 0, vy: 0 };
      lastScan = 0; display();
    };
    const commit = async (patch) => {
      const reply = await save(patch);
      if (!alive) return;
      if (reply?.ok && reply.data) setData(reply.data);
      else { if (data) { relocate(data.wander); renderProps(); } play('failed', t('Couldn’t save your buddy. Try again.')); }
    };
    const positionOf = (id) => data.positions[id] || P.cellPosition(data.decor[id]);
    const renderProps = () => {
      if (!stage || drag || movingItem) { dirty = true; return; }
      dirty = false;
      for (const p of props) p.el.remove();
      props = Object.keys(data.decor).map((id) => {
        const at = positionOf(id), el = make('button', 'gz-game-item'); el.type = 'button'; el.dataset.item = id; el.dataset.shelf = String(!!P.DECOR[id].shelf);
        el.setAttribute('aria-label', t('{name}. Drag to place; arrow keys move; Delete puts away.', { name: t(P.DECOR[id].name) }));
        el.title = t(P.DECOR[id].name); el.append(art(id)); stage.append(el);
        const w = P.DECOR[id].shelf ? (stage.clientWidth || 320) * .34 : 54, h = P.DECOR[id].shelf ? 38 : 54;
        const p = { id, el, x: at.x / 100 * (stage.clientWidth || 320) - w / 2, y: at.y / 100 * (stage.clientHeight || 240) - h, w, h, vx: 0, vy: 0 };
        el.style.width = `${w}px`; el.style.height = `${h}px`; putProp(p);
        el.addEventListener('pointerdown', (e) => begin(e, p));
        el.addEventListener('keydown', (e) => {
          if (!e.isTrusted) return;
          if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); commit({ op: 'decor', item: id, cell: null }); }
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault(); const step = e.shiftKey ? 10 : 3;
            const x = at.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0), y = at.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
            commit({ op: 'place', item: id, position: { x: Math.max(5, Math.min(95, x)), y: Math.max(10, Math.min(96, y)) } });
          }
        });
        return p;
      });
      scan(); wake();
    };
    const putProp = (p) => { p.el.style.left = '0'; p.el.style.top = '0'; p.el.style.transform = `translate3d(${p.x}px,${p.y}px,0)`; };
    const scan = () => {
      surfaces = [];
      if (!wandering) surfaces = props.filter((p) => P.DECOR[p.id].shelf).map((p) => ({ x: p.x, y: p.y + 10, w: p.w }));
      else {
        // Observe only geometry; never activate a page control or change student content.
        for (const el of [...document.querySelectorAll('h1,h2,h3,article,section,[role="region"],.ic-DashboardCard,.element-card,.gz-w')].slice(0, 80)) {
          if (el.closest('.gz-game,.gz-game-dialog,form,nav,header,aside,[role="navigation"],[contenteditable="true"]') || el.querySelector('input,textarea,select,[contenteditable="true"]')) continue;
          const r = el.getBoundingClientRect();
          if (r.width >= 70 && r.top > 90 && r.top < window.innerHeight - 110 && r.right > 0 && r.left < window.innerWidth && r.height > 5) surfaces.push({ el, x: Math.max(0, r.left), y: r.top, w: Math.min(r.right, window.innerWidth) - Math.max(0, r.left), h: r.height, kind: /^H[1-3]$/.test(el.tagName) ? 'heading' : el.matches('.gz-w') ? 'widget' : 'card' });
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
    };
    const explore = (now, dt) => {
      if (outing && !outing.surface.el.isConnected) { outing = null; avatar.style.clipPath = ''; }
      if (!outing && now >= nextAction) {
        const choices = surfaces.filter((s) => s.w >= b.w && s.y + s.h < window.innerHeight + 100);
        const x = features(), available = ['walk', 'rest', 'greet', ...(data.physics && choices.length ? ['perch'] : []), ...(data.physics && choices.some((s) => s.h > 100 && s.w > 150) ? ['hide'] : [])];
        const action = B.choose(data.learning ? data.brain : null, x, available);
        decision = { action, context: x, at: now }; actor.dataset.intent = action;
        const candidates = action === 'hide' ? choices.filter((s) => s.h > 100 && s.w > 150) : choices;
        const s = candidates.map((surface) => ({ surface, score: B.predict(data.learning ? data.brain : null, action, features(surface)) + Math.random() * .12 })).sort((a, c) => c.score - a.score)[0]?.surface;
        if (s && ['perch', 'hide'].includes(action)) decision.context = features(s);
        if (s && ['perch', 'hide'].includes(action)) {
          const left = b.x + b.w / 2 < s.x + s.w / 2;
          outing = { surface: s, phase: 'approach', left, hide: action === 'hide', until: 0 };
        }
        nextAction = now + (action === 'rest' ? 7500 : 4000) + Math.random() * 2500;
        idleUntil = ['rest', 'greet'].includes(action) ? nextAction : 0;
        idlePose = action === 'rest' ? 'sleeping' : 'idle';
        b.vx = action === 'walk' ? (Math.random() > .5 ? 60 : -60) : 0;
        if (action === 'greet') play('waving');
      }
      if (!outing) { actor.dataset.behavior = now < idleUntil ? decision?.action || '' : 'walk'; return now < idleUntil ? { controlled: false, pose: idlePose } : null; }
      const o = outing, s = o.surface, edge = o.left ? s.x - b.w * .65 : s.x + s.w - b.w * .35;
      const toward = (goal, speed = 85) => { const delta = goal - b.x; b.vx = Math.sign(delta) * Math.min(speed, Math.abs(delta) / dt); return Math.abs(delta) < 3; };
      let pose = 'idle', controlled = false;
      if (o.phase === 'approach') {
        pose = b.x < edge ? 'running-right' : 'running-left';
        if (toward(Math.max(0, Math.min(window.innerWidth - b.w, edge)))) { o.phase = 'climb'; b.vx = b.vy = 0; }
      }
      if (o.phase === 'climb') {
        const y = o.hide ? s.y + Math.min(35, (s.h - b.h) / 2) : s.y - b.h;
        const delta = y - b.y; controlled = true; pose = 'climbing';
        b.y += Math.sign(delta) * Math.min(Math.abs(delta), 105 * dt); b.vy = 0;
        if (Math.abs(delta) < 2) { o.phase = o.hide ? 'conceal' : 'settle'; b.y = y; }
      }
      if (o.phase === 'settle') {
        controlled = true; b.y = s.y - b.h; b.vy = 0; pose = b.x < s.x ? 'running-right' : 'running-left';
        const x = Math.max(0, Math.min(window.innerWidth - b.w, s.x + (s.w - b.w) / 2));
        const done = toward(x, 65); b.x += b.vx * dt;
        if (done) { b.vx = 0; o.phase = 'perch'; o.until = now + 3500 + Math.random() * 4000; }
      }
      if (o.phase === 'perch') {
        controlled = true; b.vx = b.vy = 0; b.y = s.y - b.h; pose = 'perching';
        if (now > o.until) { outing = null; nextAction = now + 3500; b.vx = o.left ? -80 : 80; b.vy = -130; }
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
    const atHome = (now) => {
      if (now >= nextAction) {
        const x = features(), action = B.choose(data.learning ? data.brain : null, x, ['walk', 'rest', 'greet']);
        decision = { action, context: x, at: now }; actor.dataset.intent = action; actor.dataset.behavior = action;
        if (action === 'walk') { idleUntil = 0; return null; }
        b.vx = 0; idlePose = action === 'rest' ? 'sleeping' : 'idle';
        idleUntil = nextAction = now + (action === 'rest' ? 7000 : 2600);
        if (action === 'greet') play('waving');
      }
      return now < idleUntil ? { controlled: false, pose: idlePose } : null;
    };
    const tick = () => {
      clearTimeout(timer); timer = 0;
      if (!alive) return;
      if (!chrome.runtime?.id || (!stage?.isConnected && !wandering)) { destroy(); return; }
      actor.hidden = !allowed();
      if (actor.hidden) { if (awake) player?.sleep(); awake = false; return; }
      if (!awake) player?.wake(); awake = true;
      if (still()) { const box = bounds(); b.vx = b.vy = 0; b.x = Math.max(0, Math.min(box.width - b.w, b.x)); b.y = Math.max(0, Math.min(box.height - b.h, b.y)); display(); return; }
      const now = performance.now(), dt = Math.min(.05, (now - last) / 1000 || 1 / 30), box = bounds(); last = now;
      if (now - lastScan > 2000) { scan(); lastScan = now; }
      const water = !wandering && data.habitat === 'aquarium';
      const action = !drag ? wandering ? explore(now, dt) : atHome(now) : null;
      energy = Math.max(0, Math.min(1, energy + dt * (actor.dataset.behavior === 'rest' ? .035 : -.003)));
      if (!drag && !action && now >= nextAction) {
        nextAction = now + 2400 + Math.random() * 3600;
        b.vx = (Math.random() > .5 ? 1 : -1) * (water ? 55 : 34);
        if (water) b.vy = -65;
        else if (data.physics && (b.grounded || !data.physics)) {
          const perch = surfaces.filter((p) => p.y < b.y + b.h && p.y > b.y + b.h - 170).sort((a, c) => Math.abs(a.x - b.x) - Math.abs(c.x - b.x))[0];
          if (perch) { b.vx = ((perch.x + perch.w / 2) - (b.x + b.w / 2)) * 1.6; b.vy = -540; }
          else if (Math.random() > .65) { play('waving'); b.vx = 0; }
        }
      }
      if (!drag) {
        if (action?.controlled) { /* The pet grips the ledge while climbing, perching or peeking. */ }
        else if (data.physics) b = F.step(b, { ...box, platforms: surfaces, water, dt });
        else { b.x = Math.max(0, Math.min(box.width - b.w, b.x + b.vx * dt)); if (b.x <= 0 || b.x >= box.width - b.w) b.vx *= -1; b.y = box.height - b.h; }
        display();
        const state = action?.pose || (Math.abs(b.vx) > 3 ? b.vx < 0 ? 'running-left' : 'running-right' : 'idle');
        if (!actor.dataset.reaction && state !== lastMotion) { lastMotion = state; player?.play(state, action?.direction || 0); }
      }
      if (!wandering && data.physics) for (const p of props) {
        if (p === movingItem || P.DECOR[p.id].fixed) continue;
        Object.assign(p, F.step(p, { ...box, platforms: surfaces, water, dt })); putProp(p);
      }
      timer = setTimeout(tick, 1000 / 30);
    };
    const wake = () => { clearTimeout(timer); timer = 0; last = performance.now(); tick(); };
    const begin = (e, item = null) => {
      if (!e.isTrusted || e.button !== 0 || e.target.closest('.gz-game-home')) return;
      e.preventDefault(); e.stopPropagation();
      const target = item?.el || actor, r = target.getBoundingClientRect();
      drag = { target, pointer: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, at: performance.now(), moved: false, was: wandering, vx: 0, vy: 0 };
      movingItem = item; target.dataset.dragging = 'true';
      outing = null; avatar.style.clipPath = ''; actor.dataset.behavior = '';
      if (!item && !wandering) { relocate(true, { x: r.left, y: r.top }); }
      target.setPointerCapture(e.pointerId);
      target.focus({ preventScroll: true });
    };
    const move = (e) => {
      if (e.isTrusted) cursor = { x: e.clientX, y: e.clientY };
      if (!drag || e.pointerId !== drag.pointer) return;
      e.preventDefault(); const now = performance.now(), dt = Math.max(16, now - drag.at);
      drag.vx = Math.max(-450, Math.min(450, (e.clientX - drag.x) / dt * 1000)); drag.vy = Math.max(-500, Math.min(500, (e.clientY - drag.y) / dt * 1000));
      drag.moved ||= Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 2;
      drag.x = e.clientX; drag.y = e.clientY; drag.at = now;
      const r = movingItem ? stage.getBoundingClientRect() : { left: 0, top: 0 };
      const p = movingItem || b;
      p.x = e.clientX - r.left - drag.dx; p.y = e.clientY - r.top - drag.dy;
      if (movingItem) putProp(p); else display();
    };
    const end = (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const d = drag, item = movingItem; drag = movingItem = null; d.target.dataset.dragging = 'false';
      suppressClick = d.moved;
      if (e.type === 'pointercancel') { actor.remove(); relocate(data.wander); renderProps(); wake(); return; }
      if (item) {
        const r = stage.getBoundingClientRect();
        if (e.clientX < r.left - 30 || e.clientX > r.right + 30 || e.clientY < r.top - 30 || e.clientY > r.bottom + 30) commit({ op: 'decor', item: item.id, cell: null });
        else commit({ op: 'place', item: item.id, position: { x: Math.max(5, Math.min(95, (item.x + item.w / 2) / r.width * 100)), y: Math.max(10, Math.min(96, (item.y + item.h) / r.height * 100)) } });
      } else {
        const r = stage?.getBoundingClientRect(), inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        const wander = d.moved ? !inside : d.was;
        relocate(wander); b.vx = d.vx; b.vy = d.vy; nextAction = performance.now() + 1800;
        if (wander !== data.wander) commit({ op: 'wander', wander });
        if (d.moved) feedback(d.was ? wander ? 'away' : 'home' : wander ? 'out' : 'play');
        if (!d.moved) { feedback('pet'); play('playing', t('Happy to see you!')); }
      }
      if (dirty) renderProps(); wake();
    };
    const setData = (next) => {
      if (!next || !alive) return;
      const before = data; data = next;
      if (!before || next.needs.at !== before.needs.at || next.needs.energy !== before.needs.energy) energy = next.needs.energy / 100;
      if (before && before.physics && !next.physics) { outing = null; avatar.style.clipPath = ''; actor.dataset.behavior = ''; }
      if (!drag) { relocate(data.wander); renderProps(); }
      if (before && next.xp > before.xp) play(next.level > before.level ? 'level-up' : 'xp', next.level > before.level ? t('Level {level}!', { level: next.level }) : `+${next.xp - before.xp} XP`);
      wake();
    };
    const changed = (ch, area) => {
      if (area === 'sync' && (ch.enabled?.newValue === false || (ch.enhance && !ch.enhance.newValue?.pet))) { destroy(); return; }
      if (area !== 'local') return;
      if (ch.widgetTimer) focus = Number(ch.widgetTimer.newValue?.end) > Date.now();
      if (ch[key]) { const v = P.view(ch[key].newValue); if (v) setData(v); }
      const suffix = key.slice(4);
      if (wandering && (ch[`todo:${suffix}`] || ch[`insights:${suffix}`] || ch[`remind:${suffix}`] || ch.todoCache)) commit({ op: 'read' });
    };
    const attach = (nextStage, next) => {
      if (nextStage && !hosts.has(nextStage)) { hosts.add(nextStage); stage = nextStage; }
      else if (!stage?.isConnected && nextStage) stage = nextStage;
      if (stage) stage.dataset.habitat = next.habitat;
      setData(next);
      if (!player) player = GZ_WIDGETS_UI.avatar(avatar, { interactive: false });
    };
    const detach = (oldStage) => {
      hosts.delete(oldStage);
      if (oldStage !== stage) return;
      const previous = [...hosts].reverse().find((host) => host.isConnected);
      if (previous) { stage = previous; attach(previous, data); return; }
      if (wandering) { for (const p of props) p.el.remove(); props = []; stage = null; }
      else destroy();
    };
    const destroy = () => {
      if (!alive) return;
      alive = false; clearTimeout(timer); clearTimeout(reaction); player?.stop();
      for (const off of offs) off(); offs = [];
      for (const p of props) p.el.remove(); actor.remove(); home.remove();
      chrome.storage.onChanged.removeListener(changed); reduced?.removeEventListener('change', wake); motion?.disconnect();
      if (current?.key === key) current = null;
    };
    on(actor, 'pointerdown', (e) => begin(e)); on(document, 'pointermove', move, { passive: false });
    on(document, 'pointerup', end); on(document, 'pointercancel', end);
    on(actor, 'click', (e) => { if (!e.isTrusted || e.target.closest('.gz-game-home')) return; if (suppressClick) { suppressClick = false; return; } feedback('pet'); play('playing', t('Happy to see you!')); });
    on(actor, 'keydown', (e) => { if (!e.isTrusted || e.target !== actor) return; const k = e.key.toLowerCase(); if (['w', 'h', 'escape'].includes(k)) { e.preventDefault(); feedback(k === 'w' ? 'out' : 'home'); commit({ op: 'wander', wander: k === 'w' }); } else if (k === ' ' || k === 'enter') { e.preventDefault(); feedback('play'); play('playing'); } });
    on(document, 'visibilitychange', wake); on(window, 'resize', () => { if (stage && data) renderProps(); wake(); });
    on(window, 'scroll', () => { lastScan = 0; if (!timer) wake(); }, { passive: true });
    on(window, 'pagehide', destroy, { once: true });
    const motion = typeof MutationObserver === 'function' ? new MutationObserver(wake) : null;
    motion?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-motion'] });
    chrome.storage.onChanged.addListener(changed); reduced?.addEventListener('change', wake);
    try { chrome.storage.local.get('widgetTimer', (r) => { if (alive) focus = Number(r?.widgetTimer?.end) > Date.now(); }); } catch { /* reloaded */ }
    return { key, attach, detach, play, destroy, refresh: () => { if (path !== location.pathname || (!timer && allowed() && !still())) { path = location.pathname; wake(); } } };
  };
  return { mount, refresh: () => current?.refresh(), stop: () => current?.destroy() };
})();
GZ_PET_WORLD;
