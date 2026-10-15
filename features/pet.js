// W24's local pet. No work requests: the broker reads only records Glaze already keeps on this device.
var GZ_PET_UI = globalThis.GZ_PET_UI || (() => {
  const ctx = globalThis.GZ_CTX, t = (k, v) => ctx.t(k, v);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const button = (text, run) => { const b = make('button', { type: 'button', textContent: text }); b.addEventListener('click', run); return b; };
  const NAMES = { books: 'Books', plant: 'Mushroom', moon: 'Moon', stars: 'Stars', plain: 'Classic buddy', bandana: 'Mint bandana', happy: 'Happy buddy' };
  let ready;
  const start = () => (ready ||= Promise.all([ctx.need('lib/pet.js', () => globalThis.GZ_PET), ctx.need('lib/todo.js', () => globalThis.GZ_TODO)]).catch((e) => { ready = null; throw e; }));
  const send = (m) => new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: 'glaze:pet', ...m }, (r) => resolve(chrome.runtime.lastError ? null : r)); } catch { resolve(null); } });
  const mount = (body, api) => {
    let alive = true, key = '', tz, busy = false, pending = false, data = null, timer = 0;
    const waiting = [];
    const tile = body.closest('.gz-w');
    if (tile) tile.hidden = true;
    const pet = make('div', { className: 'gz-game' });
    const status = make('p', { className: 'gz-game-status', role: 'status' });
    const art = (path, cls) => make('img', { src: chrome.runtime.getURL(`assets/art/stickers/${path}.webp`), alt: '', className: cls, width: 72, height: 72, decoding: 'async' });
    const paint = () => {
      if (!alive || !data) return;
      const P = GZ_PET, d = data;
      const active = pet.contains(document.activeElement) && document.activeElement.dataset.control;
      const wasOpen = [...pet.querySelectorAll('details')].map((e) => e.open);
      const stage = make('div', { className: 'gz-game-habitat' });
      stage.setAttribute('aria-label', t('Your buddy’s habitat'));
      for (let i = 0; i < 9; i++) {
        const cell = make('div', { className: 'gz-game-cell' });
        for (const [id, at] of Object.entries(d.decor)) if (at === i) cell.append(art(P.DECOR[id].art, 'gz-game-decor'));
        if (i === 4) cell.append(art(`critters/${P.WEAR[d.wear].art}`, 'gz-game-buddy'));
        stage.append(cell);
      }
      const progress = make('progress', { max: d.next ? d.next - d.floor : 1, value: d.next ? d.xp - d.floor : 1 });
      progress.setAttribute('aria-label', t('Pet experience'));
      const wear = make('select');
      wear.setAttribute('aria-label', t('Buddy’s look'));
      wear.dataset.control = 'wear';
      for (const [id, item] of Object.entries(P.WEAR)) wear.append(make('option', { value: id, selected: d.wear === id, disabled: d.level < item.level, textContent: `${t(NAMES[id])} · ${t('Level {level}', { level: item.level })}` }));
      wear.addEventListener('change', () => update({ op: 'wear', wear: wear.value }));
      const decor = make('details', {}, make('summary', { textContent: t('Decorate habitat') }));
      for (const [id, item] of Object.entries(P.DECOR)) {
        const select = make('select', { disabled: d.level < item.level });
        select.dataset.control = id;
        select.setAttribute('aria-label', t('Place {name}', { name: t(NAMES[id]) }));
        select.append(make('option', { value: '', textContent: t('Put away'), selected: d.decor[id] === undefined }));
        const positions = ['Top left', 'Top middle', 'Top right', 'Middle left', 'Middle', 'Middle right', 'Bottom left', 'Bottom middle', 'Bottom right'];
        positions.forEach((name, i) => select.append(make('option', { value: String(i), textContent: t(name), selected: d.decor[id] === i })));
        select.addEventListener('change', () => update({ op: 'decor', item: id, cell: select.value === '' ? null : Number(select.value) }));
        decor.append(make('label', {}, make('span', { textContent: `${t(NAMES[id])} · ${t('Level {level}', { level: item.level })}` }), select));
      }
      const rules = make('details', {}, make('summary', { textContent: t('How XP works') }), make('p', { textContent: t('Handed in: 20 XP on time, 10 XP late, 15 XP when timing is unknown. A kept do-on plan: 8 XP. Each verified streak day: 5 XP. Focus sessions give no XP.') }), make('p', { textContent: t('Only work already saved on this device counts. Missing days never take progress away. Unticking work removes its XP. New looks and decorations unlock as you level up.') }), make('p', { textContent: t('Streak XP uses only days already checked by Streak, through yesterday. Restores add days once; switching it off keeps earned XP.') }));
      decor.querySelector('summary').dataset.control = 'decor';
      rules.querySelector('summary').dataset.control = 'rules';
      decor.open = !!wasOpen[0]; rules.open = !!wasOpen[1];
      pet.replaceChildren(make('p', { className: 'gz-game-level', textContent: t('Level {level} · {xp} XP', { level: d.level, xp: d.xp }) }), stage, progress,
        make('p', { textContent: d.next ? t('{xp} XP to the next level', { xp: d.next - d.xp }) : t('All rewards unlocked') }),
        make('p', { className: 'gz-game-breakdown', textContent: t('Work {work} · Plans {plans} · Streak {streak}', { work: d.work, plans: d.plans, streak: d.streakXp }) }),
        make('label', {}, make('span', { textContent: t('Buddy’s look') }), wear), decor, rules);
      if (active) [...pet.querySelectorAll('[data-control]')].find((e) => e.dataset.control === active)?.focus({ preventScroll: true });
    };
    const update = async (patch = { op: 'read' }) => {
      if (!alive || !key) return;
      if (busy) { if (patch.op === 'read') pending = true; else waiting.push(patch); return; }
      busy = true;
      const r = await send({ key, tz, ...patch });
      busy = false;
      if (!alive) return;
      status.textContent = r?.ok ? '' : r?.error === 'history' ? t('Pet history couldn’t be updated. Existing progress was kept.') : t('Couldn’t save your buddy. Try again.');
      if (r?.data) { data = r.data; paint(); }
      if (waiting.length) update(waiting.shift());
      else if (pending) { pending = false; update(); }
      else {
        clearTimeout(timer);
        if (document.visibilityState === 'visible') timer = setTimeout(() => update(), GZ_TODO.midnight(GZ_TODO.dayOf(Date.now(), tz) + 1, tz) - Date.now() + 20);
      }
    };
    const changed = (ch, area) => {
      if (!alive || !key) return;
      if (area === 'sync' && (ch.todo || ch.enhance)) { update(); return; }
      if (area !== 'local') return;
      const suffix = key.slice(4);
      if (ch[`todo:${suffix}`] || ch[`insights:${suffix}`] || ch[`remind:${suffix}`] || ch.todoCache) update();
      if (ch[key]?.newValue) { data = GZ_PET.view(ch[key].newValue); paint(); }
    };
    const show = () => { clearTimeout(timer); if (document.visibilityState === 'visible') update(); };
    document.addEventListener('visibilitychange', show);
    body.append(pet, status);
    start().then(() => { const who = api?.who || globalThis.GZ_WIDGETS_UI?.who; return who ? who().then((p) => ({ id: p.uid, time_zone: p.tz })) : ctx.profile(); }).then((p) => {
      if (!alive || !ctx.settings().enabled || !ctx.settings().enhance.pet) return;
      if (!/^(?:\d+|_\d+_\d+)$/.test(String(p?.id))) throw new Error('unknown account');
      if (tile) tile.hidden = false;
      key = GZ_PET.storeKey(location.origin, p.id); tz = GZ_TODO.zone(p.time_zone);
      chrome.storage.onChanged.addListener(changed);
      update();
    }).catch(() => { if (alive) status.textContent = t('Your buddy is available when your account is known.'); });
    return { wake: () => update(), update: () => update(), stop: () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', show); chrome.storage.onChanged.removeListener(changed); } };
  };
  let box;
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
    document.body.append(box); box.showModal(); close.focus();
  };
  return { mount, open };
})();
globalThis.GZ_WIDGETS_UI?.register('pet', GZ_PET_UI.mount);
GZ_PET_UI;
