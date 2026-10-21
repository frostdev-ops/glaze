// W24's local pet. No work requests: the broker reads only records Glaze already keeps on this device.
var GZ_PET_UI = globalThis.GZ_PET_UI || (() => {
  const ctx = globalThis.GZ_CTX, t = (k, v) => ctx.t(k, v);
  if (!ctx) return null; // a frame-only injection can outlive its document
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const button = (text, run) => { const b = make('button', { type: 'button', textContent: text }); b.addEventListener('click', run); return b; };
  const NAMES = { books: 'Books', plant: 'Mushroom', moon: 'Moon', stars: 'Stars', plain: 'Classic buddy', bandana: 'Mint bandana', happy: 'Happy buddy' };
  const ACTIVITIES = { walk: 'Exploring', perch: 'Perching', hide: 'Hide and seek', rest: 'Resting', greet: 'Saying hello', investigate: 'Investigating', follow: 'Following your pointer', play: 'Playing', study: 'Studying beside you', groom: 'Grooming', stretch: 'Stretching', home: 'Returning home' };
  const TIMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
  let ready;
  const start = () => (ready ||= Promise.all([ctx.need('lib/petbrain.js', () => globalThis.GZ_PET_BRAIN), ctx.need('lib/pet.js', () => globalThis.GZ_PET), ctx.need('lib/todo.js', () => globalThis.GZ_TODO), ctx.need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI), ctx.need('lib/petphysics.js', () => globalThis.GZ_PET_PHYSICS), ctx.need('features/petworld.js', () => globalThis.GZ_PET_WORLD)]).catch((e) => { ready = null; throw e; }));
  const send = (m) => new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: 'glaze:pet', ...m }, (r) => resolve(chrome.runtime.lastError ? null : r)); } catch { resolve(null); } });
  const mount = (body, api) => {
    let alive = true, key = '', tz, busy = false, pending = false, data = null, timer = 0, player = null, pets = [];
    const waiting = [];
    const tile = body.closest('.gz-w');
    if (tile) tile.hidden = true;
    const pet = make('div', { className: 'gz-game' });
    const stage = make('div', { className: 'gz-game-habitat' });
    const level = make('span', { className: 'gz-game-level' }), overview = make('div', { className: 'gz-game-overview' }), controls = make('div', { className: 'gz-game-controls' });
    pet.append(overview, stage, controls);
    stage.setAttribute('aria-label', t('Your buddy’s habitat'));
    const status = make('p', { className: 'gz-game-status', role: 'status' });
    const activity = make('p', { className: 'gz-game-hint' });
    stage.addEventListener('glaze:pet-intent', (e) => {
      if (alive && Object.hasOwn(ACTIVITIES, e.detail?.action)) activity.textContent = t('Activity: {activity}', { activity: t(ACTIVITIES[e.detail.action]) });
    });
    const art = (path, cls) => make('img', { src: chrome.runtime.getURL(`assets/art/stickers/${path}.webp`), alt: '', className: cls, width: 72, height: 72, decoding: 'async' });
    const paint = () => {
      if (!alive || !data || !chrome.runtime?.id) return;
      const P = GZ_PET, d = data, allowance = P.care(d.care, tz), cooling = Date.now() < allowance.nextAt;
      const active = pet.contains(document.activeElement) && document.activeElement.dataset.control;
      const wasOpen = new Set([...pet.querySelectorAll('details')].filter((e) => e.open).map((e) => e.dataset.section));
      const section = (id, title, ...children) => {
        const summary = make('summary', { textContent: t(title) }); summary.dataset.control = id;
        const el = make('details', { className: 'gz-game-section', open: wasOpen.has(id) }, summary, ...children); el.dataset.section = id; return el;
      };
      const field = (name, input) => make('label', {}, make('span', { textContent: t(name) }), input);
      const progress = make('progress', { max: d.next - d.floor, value: d.xp - d.floor });
      progress.setAttribute('aria-label', t('Pet experience'));
      level.textContent = t('Level {level}', { level: d.level });
      level.setAttribute('aria-label', t('Level {level} · {xp} XP', { level: d.level, xp: d.xp }));
      const identity = make('div', { className: 'gz-game-identity' }, make('strong', { textContent: pets.find((p) => p.id === d.sprite)?.name || t('Study buddy') }), activity);
      if (!activity.textContent) activity.textContent = t(d.wander ? 'Exploring the page' : 'At home');
      overview.replaceChildren(make('div', { className: 'gz-game-heading' }, identity, level), progress,
        make('div', { className: 'gz-game-xp' }, make('span', { textContent: t('{xp} total XP', { xp: d.xp }) }), make('span', { textContent: t('{xp} to next level', { xp: d.next - d.xp }) })));
      const pat = button(t('Pet your buddy'), (e) => { if (e.isTrusted && !busy) { pat.disabled = true; update({ op: 'interact', event: 'pet' }); } });
      pat.className = 'gz-game-primary'; pat.dataset.control = 'pet'; pat.disabled = !allowance.remaining || cooling;
      const wander = button(t(d.wander ? 'Return home' : 'Explore page'), (e) => { if (e.isTrusted) update({ op: 'wander', wander: !d.wander }); });
      wander.dataset.control = 'wander'; wander.setAttribute('aria-pressed', String(d.wander));
      const actions = make('div', { className: 'gz-game-actions' }, pat, wander);
      const care = make('p', { className: 'gz-game-care', textContent: !allowance.remaining ? t('All bonding moments enjoyed today. More tomorrow.') : cooling ? t('{n} of {max} bonding moments left today · Ready again in a minute', { n: allowance.remaining, max: P.CARE_LIMIT }) : t('{n} of {max} bonding moments left today', { n: allowance.remaining, max: P.CARE_LIMIT }) });
      const meterGroup = (ids, cls = '') => {
        const meters = make('div', { className: `gz-game-meters ${cls}` });
        for (const [id, name] of ids) {
          const value = Math.round(d.needs[id]), meter = make('meter', { min: 0, max: 100, low: 25, high: 75, optimum: 100, value });
          meter.setAttribute('aria-label', t(name));
          meters.append(make('label', {}, make('span', { textContent: t(name) }), meter, make('small', { textContent: cls ? String(value) : `${value}/100` })));
        }
        return meters;
      };
      const meters = meterGroup([['mood', 'Mood'], ['energy', 'Energy'], ['bond', 'Bond']], 'gz-game-vitals');
      const wellbeing = section('wellbeing', 'Wellbeing', meterGroup([['playful', 'Playfulness'], ['curiosity', 'Curiosity'], ['comfort', 'Comfort']]),
        make('p', { textContent: t('Petting and play share {n} bonding moments each day, one per minute. Extra clicks do not add rewards or reactions. Your buddy is always happy to keep you company.', { n: P.CARE_LIMIT }) }));
      const wear = make('select'); wear.dataset.control = 'wear'; wear.setAttribute('aria-label', t('Buddy’s look'));
      for (const [id, item] of Object.entries(P.WEAR)) wear.append(make('option', { value: id, selected: d.wear === id, disabled: d.level < item.level, textContent: `${t(NAMES[id])} · ${t('Level {level}', { level: item.level })}` }));
      wear.addEventListener('change', () => update({ op: 'wear', wear: wear.value }));
      const outfit = field('Buddy’s look', wear); outfit.hidden = !!d.sprite;
      const sprite = make('select'); sprite.dataset.control = 'sprite'; sprite.setAttribute('aria-label', t('Pet character'));
      sprite.append(make('option', { value: '', textContent: t('Classic buddy'), selected: !d.sprite }));
      for (const item of pets) sprite.append(make('option', { value: item.id, textContent: item.name, selected: d.sprite === item.id }));
      sprite.addEventListener('change', (e) => { if (e.isTrusted) update({ op: 'sprite', sprite: sprite.value }); });
      const habitat = make('select'); habitat.dataset.control = 'habitat'; habitat.setAttribute('aria-label', t('Habitat style'));
      for (const [id, name] of Object.entries(P.HABITATS)) habitat.append(make('option', { value: id, selected: d.habitat === id, textContent: t(name) }));
      habitat.addEventListener('change', (e) => { if (e.isTrusted) update({ op: 'habitat', habitat: habitat.value }); });
      const toys = make('div', { className: 'gz-game-tray' }), furniture = make('div', { className: 'gz-game-tray' }), locked = make('div', { className: 'gz-game-tray' });
      const placement = section('placement', 'Precise placement');
      const positions = ['Top left', 'Top middle', 'Top right', 'Middle left', 'Middle', 'Middle right', 'Bottom left', 'Bottom middle', 'Bottom right'];
      for (const [id, item] of Object.entries(P.DECOR)) {
        const name = t(item.name || NAMES[id]), placed = d.decor[id] !== undefined, unlocked = d.level >= item.level;
        const add = button('', (e) => { if (e.isTrusted) update(placed ? { op: 'decor', item: id, cell: null } : { op: 'place', item: id, position: { x: 50, y: item.shelf ? 52 : 25 } }); });
        add.dataset.control = `supply:${id}`; add.dataset.item = id; add.className = 'gz-game-supply'; add.disabled = !unlocked; add.draggable = unlocked;
        add.setAttribute('aria-pressed', String(placed));
        add.title = unlocked ? t(placed ? 'Put away {name}' : 'Add {name}', { name }) : `${name} · ${t('Level {level}', { level: item.level })}`;
        add.setAttribute('aria-label', add.title);
        add.append(art(item.art, ''), make('span', { textContent: name }), make('small', { textContent: unlocked ? t(placed ? 'Placed' : 'Add') : t('Level {level}', { level: item.level }) }));
        add.addEventListener('dragstart', (e) => { if (e.isTrusted && !add.disabled) { e.dataTransfer.setData('application/x-glaze-pet-item', id); e.dataTransfer.effectAllowed = 'copy'; } });
        (unlocked ? item.toy ? toys : furniture : locked).append(add);
        if (unlocked) {
          const select = make('select'); select.dataset.control = id; select.setAttribute('aria-label', t('Place {name}', { name }));
          select.append(make('option', { value: '', textContent: t('Put away'), selected: !placed }));
          positions.forEach((name, i) => select.append(make('option', { value: String(i), textContent: t(name), selected: d.decor[id] === i })));
          select.addEventListener('change', () => update({ op: 'decor', item: id, cell: select.value === '' ? null : Number(select.value) }));
          placement.append(make('label', {}, make('span', { textContent: name }), select));
        }
      }
      const decor = section('decor', 'Decorate habitat', field('Habitat style', habitat), make('p', { className: 'gz-game-hint', textContent: t('Click to add or put away. Drag items to arrange them; drag a toy onto the page to play.') }),
        make('h4', { textContent: t('Toys') }), toys, make('h4', { textContent: t('Furniture & decor') }), furniture, placement);
      if (locked.children.length) decor.append(section('unlocks', 'Upcoming unlocks', locked));
      const physics = make('input', { type: 'checkbox', checked: d.physics }); physics.dataset.control = 'physics';
      physics.addEventListener('change', (e) => { if (e.isTrusted) update({ op: 'physics', physics: physics.checked }); });
      const learning = make('input', { type: 'checkbox', checked: d.learning }); learning.dataset.control = 'learning';
      learning.addEventListener('change', (e) => { if (e.isTrusted) update({ op: 'learning', learning: learning.checked }); });
      const settings = section('settings', 'Settings', field('Pet character', sprite), outfit, field('Gravity & water', physics), field('Learn from how I play', learning),
        make('p', { className: 'gz-game-hint', textContent: t('Drag your buddy out to explore, and back in to come home. W: wander · H: home. Drag furniture, or use arrow keys; Delete puts it away.') }));
      const forget = button(t('Reset learned behavior'), (e) => { if (e.isTrusted) update({ op: 'forget' }); }); forget.dataset.control = 'forget';
      const profile = GZ_PET_BRAIN.describe(d.brain), interactions = d.brain.counts.reduce((n, value) => n + value, 0);
      const learned = section('learned', 'How your buddy learns', make('p', { textContent: t('Your buddy learns the activities you welcome and settles down while you type or focus. Learning stays on this device; no typed text is read or sent. Resetting learning does not reset the daily bonding limit.') }),
        make('p', { textContent: t('Learned interactions: {n}', { n: interactions }) }), make('p', { textContent: t('Familiarity: {n}/100', { n: profile.familiarity }) }));
      if (interactions && Object.hasOwn(ACTIVITIES, profile.favorite)) learned.append(make('p', { textContent: t('Favorite activity: {activity}', { activity: t(ACTIVITIES[profile.favorite]) }) }));
      if (Object.hasOwn(TIMES, profile.habit)) learned.append(make('p', { textContent: t('Preferred time: {time}', { time: t(TIMES[profile.habit]) }) }));
      learned.append(forget);
      const rules = section('rules', 'How XP works', make('p', { className: 'gz-game-breakdown', textContent: t('Work {work} · Plans {plans} · Streak {streak}', { work: d.work, plans: d.plans, streak: d.streakXp }) }),
        make('p', { textContent: t('Handed in: 20 XP on time, 10 XP late, 15 XP when timing is unknown. A kept do-on plan: 8 XP. Each verified streak day: 5 XP. Focus sessions give no XP.') }),
        make('p', { textContent: t('Your buddy keeps growing across semesters, with no final level. Progress stays with this school account on this device. Missing days never take progress away; unticking work removes its XP.') }),
        make('p', { textContent: t('Streak XP uses only days already checked by Streak, through yesterday. Restores add days once; switching it off keeps earned XP.') }));
      const about = section('about', 'Progress & learning', rules, learned);
      controls.replaceChildren(actions, care, meters, wellbeing, decor, settings, about);
      if (globalThis.GZ_PET_WORLD) player = GZ_PET_WORLD.mount(stage, { key, data: d, t, save: (patch) => send({ key, tz, ...patch }) });
      else if (!stage.children.length) stage.append(art(`critters/${P.WEAR[d.wear].art}`, 'gz-game-buddy'));
      if (active) [...pet.querySelectorAll('[data-control]')].find((e) => e.dataset.control === active)?.focus({ preventScroll: true });
    };
    const stop = () => { alive = false; player?.stop(); clearTimeout(timer); document.removeEventListener('visibilitychange', show); chrome.storage.onChanged.removeListener(changed); };
    stage.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('application/x-glaze-pet-item')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    stage.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('application/x-glaze-pet-item');
      if (!e.isTrusted || !Object.hasOwn(GZ_PET.DECOR, id)) return;
      e.preventDefault(); const r = stage.getBoundingClientRect();
      update({ op: 'place', item: id, position: { x: Math.max(5, Math.min(95, (e.clientX - r.left) / r.width * 100)), y: Math.max(10, Math.min(96, (e.clientY - r.top) / r.height * 100)) } });
    });
    const update = async (patch = { op: 'read' }) => {
      if (!alive || !key) return;
      if (!chrome.runtime?.id) { stop(); return; }
      if (busy) { if (patch.op === 'read') pending = true; else waiting.push(patch); return; }
      busy = true;
      const r = await send({ key, tz, ...patch });
      busy = false;
      if (!alive) return;
      if (!chrome.runtime?.id) { stop(); return; }
      status.textContent = r?.ok ? r.interaction?.accepted === false ? t(r.interaction.reason === 'daily' ? 'All bonding moments enjoyed today. More tomorrow.' : 'Your buddy is resting between pats. Try again in a minute.') : '' : r?.error === 'history' ? t('Pet history couldn’t be updated. Existing progress was kept.') : t('Couldn’t save your buddy. Try again.');
      if (r?.data) { data = r.data; paint(); }
      if (r?.interaction?.accepted) player?.play('playing');
      if (waiting.length) update(waiting.shift());
      else if (pending) { pending = false; update(); }
      else {
        clearTimeout(timer);
        if (document.visibilityState === 'visible') {
          const now = Date.now(), allowance = GZ_PET.care(data?.care, tz, now);
          timer = setTimeout(() => update(), Math.max(20, Math.min(60000, allowance.resetAt - now + 20, allowance.nextAt > now ? allowance.nextAt - now + 20 : 60000)));
        }
      }
    };
    const changed = (ch, area) => {
      if (!alive || !key) return;
      if (area === 'sync' && (ch.todo || ch.enhance)) { update(); return; }
      if (area !== 'local') return;
      if (ch.petSprites) library();
      if (ch.petCharacter) update();
      const suffix = key.slice(4);
      if (ch[`todo:${suffix}`] || ch[`insights:${suffix}`] || ch[`remind:${suffix}`] || ch.todoCache) update();
      if (ch[key]?.newValue) { data = GZ_PET.view(ch[key].newValue); paint(); }
    };
    const show = () => { clearTimeout(timer); if (document.visibilityState === 'visible') { player?.wake?.(); update(); } else player?.sleep?.(); };
    const library = () => send({ type: 'glaze:petSprites', key, op: 'list' }).then((r) => { if (alive && chrome.runtime?.id && r?.ok && Array.isArray(r.pets)) { pets = r.pets; paint(); } });
    document.addEventListener('visibilitychange', show);
    body.append(pet, status);
    start().then(() => { const who = api?.who || globalThis.GZ_WIDGETS_UI?.who; return who ? who().then((p) => ({ id: p.uid, time_zone: p.tz })) : ctx.profile(); }).then((p) => {
      if (!alive) return;
      if (!chrome.runtime?.id || !ctx.settings().enabled || !ctx.settings().enhance.pet) { stop(); return; }
      if (!/^(?:\d+|_\d+_\d+)$/.test(String(p?.id))) throw new Error('unknown account');
      if (tile) tile.hidden = false;
      key = GZ_PET.storeKey(location.origin, p.id); tz = GZ_TODO.zone(p.time_zone);
      chrome.storage.onChanged.addListener(changed);
      update(); library();
    }).catch(() => { if (alive) status.textContent = t('Your buddy is available when your account is known.'); });
    return { wake: () => { player?.wake?.(); update(); }, update: () => update(), stop };
  };
  let box, resuming, resumeOff, retryAt = 0;
  const resume = () => {
    globalThis.GZ_PET_WORLD?.refresh();
    if (!ctx.settings().enabled || !ctx.settings().enhance.pet) { resuming = null; resumeOff?.(); resumeOff = null; globalThis.GZ_PET_WORLD?.stop(); return; }
    if (Date.now() < retryAt) return;
    return resuming ||= start().then(() => GZ_WIDGETS_UI.who()).then(async (p) => {
      if (!ctx.settings().enabled || !ctx.settings().enhance.pet || !/^(?:\d+|_\d+_\d+)$/.test(String(p?.uid))) return;
      const key = GZ_PET.storeKey(location.origin, p.uid), tz = GZ_TODO.zone(p.tz), save = (patch) => send({ key, tz, ...patch });
      if (!resumeOff) {
        const changed = (ch, area) => {
          if (area !== 'local' || !ch[key]?.newValue?.wander || !ctx.settings().enabled || !ctx.settings().enhance.pet) return;
          const data = GZ_PET.view(ch[key].newValue);
          if (data) GZ_PET_WORLD.mount(null, { key, tz, data, save, t });
        };
        chrome.storage.onChanged.addListener(changed);
        resumeOff = () => chrome.storage.onChanged.removeListener(changed);
        window.addEventListener('pagehide', () => { resumeOff?.(); resumeOff = null; }, { once: true });
      }
      const r = await save({ op: 'read' });
      if (!r?.ok) { retryAt = Date.now() + 60000; resuming = null; return; }
      if (r?.ok && r.data?.wander && ctx.settings().enabled && ctx.settings().enhance.pet) GZ_PET_WORLD.mount(null, { key, tz, data: r.data, save, t });
    }).catch(() => { retryAt = Date.now() + 60000; resuming = null; });
  };
  const open = async () => {
    if (!ctx.settings().enabled || !ctx.settings().enhance.pet) return;
    await start();
    if (!ctx.settings().enabled || !ctx.settings().enhance.pet) return;
    box?.close();
    const opener = document.activeElement, body = make('div');
    const close = button(t('Close'), () => box.close());
    box = make('dialog', { className: 'gz-game-dialog' }, make('header', {}, make('h2', { id: 'gz-game-title', textContent: t('Pet habitat') }), close), body);
    box.setAttribute('aria-labelledby', 'gz-game-title');
    const tile = mount(body), current = box;
    const off = (ch, area) => { if (area === 'sync' && (ch.enabled?.newValue === false || (ch.enhance && !ch.enhance.newValue?.pet))) current.close(); };
    chrome.storage.onChanged.addListener(off);
    box.addEventListener('close', () => { chrome.storage.onChanged.removeListener(off); tile.stop(); current.remove(); if (box === current) box = null; opener?.focus({ preventScroll: true }); });
    box.addEventListener('click', (e) => { if (e.target === current) current.close(); });
    document.body.append(box); box.show(); close.focus();
  };
  return { mount, open, resume };
})();
globalThis.GZ_WIDGETS_UI?.register('pet', GZ_PET_UI.mount);
GZ_PET_UI;
