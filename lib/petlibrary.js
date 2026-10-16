// The only import/delete surface is Glaze's editor. No file, key or package is fetched from a link.
var GZ_PET_LIBRARY = (() => {
  const error = (message) => Object.assign(new Error(message), { pet: true });
  const mount = (root, t) => {
    if (!root) return;
    const make = (tag, text = '') => Object.assign(document.createElement(tag), { textContent: text });
    const send = (m) => chrome.runtime.sendMessage({ type: 'glaze:petSprites', ...m });
    const input = make('input'), status = make('p'), list = make('div');
    input.type = 'file'; input.multiple = true; input.accept = '.zip,.json,.png,.webp'; input.setAttribute('aria-label', t('Import a pet package'));
    status.setAttribute('role', 'status');
    let revision = 0, alive = true, started = false, players = [];
    const render = async () => {
      if (!alive) return;
      const turn = ++revision, reply = await send({ op: 'list' });
      if (turn !== revision || !reply?.ok) return;
      players.forEach((p) => p.stop()); players = []; list.replaceChildren();
      for (const pet of reply.pets) {
        const card = make('div'), heading = make('h3', pet.name), canvas = make('canvas'), select = make('select');
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', pet.name); canvas.style.width = '96px'; canvas.style.height = '104px';
        const names = ['Resting', 'Running right', 'Running left', 'Waving', 'Jumping', 'Disappointed', 'Waiting', 'Working', 'Reviewing'];
        for (const [index, name] of GZ_PET_SPRITES.STATES.entries()) { const o = make('option', t(names[index])); o.value = name; select.append(o); }
        select.setAttribute('aria-label', `${t('Animation')}: ${pet.name}`);
        card.append(heading, canvas, select); list.append(card);
        const got = await send({ op: 'get', id: pet.id });
        if (turn !== revision || !got?.pet) return;
        const player = GZ_PET_PLAYER.mount(canvas, got.pet); players.push(player);
        select.addEventListener('change', (e) => { if (e.isTrusted) player.set(select.value); });
        if (pet.id.startsWith('own:')) {
          const remove = make('button', t('Remove pet')); remove.type = 'button';
          remove.addEventListener('click', async (e) => {
            if (!e.isTrusted) return;
            try { const r = await send({ op: 'delete', id: pet.id }); if (!r?.ok) throw error(); await render(); }
            catch { status.textContent = t('Couldn’t update your pet library. Existing pets were kept.'); }
          }); card.append(remove);
        }
      }
    };
    input.addEventListener('change', async (event) => {
      if (!event.isTrusted || !input.files.length) return;
      input.disabled = true;
      try {
        const S = GZ_PET_SPRITES, files = [...input.files];
        if (files.length > 2 || files.some((f) => f.size > S.MAX_INPUT)) throw error('Pet files must be at most 20 MB.');
        let raw = {}, bytes;
        if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
          const zip = GZ_DOCTEXT.unzip(new Uint8Array(await files[0].arrayBuffer()), { limits: { input: S.MAX_INPUT, entry: S.MAX_INPUT, total: S.MAX_INPUT + 8192, entries: 8 } });
          const names = zip.names.filter((n) => !n.endsWith('/'));
          if (names.some((n) => n.includes('\\') || n.startsWith('/') || n.split('/').some((p) => p === '..' || p === '.'))) throw error('Invalid pet package.');
          const json = names.filter((n) => /(^|\/)pet\.json$/.test(n)), images = names.filter((n) => /(^|\/)(spritesheet|sprites)\.(png|webp)$/i.test(n));
          if (json.length > 1 || images.length !== 1 || names.length > 2) throw error('Choose pet.json and its sprite sheet, or a ZIP containing them.');
          if (json.length) { const meta = await zip.bytes(json[0]); if (meta.length > 8192) throw error('Invalid pet package.'); raw = JSON.parse(new TextDecoder().decode(meta)); }
          bytes = await zip.bytes(images[0]);
        } else {
          const images = files.filter((f) => /\.(png|webp)$/i.test(f.name)), json = files.filter((f) => f.name === 'pet.json');
          if (images.length !== 1 || images.length + json.length !== files.length || json.some((f) => f.size > 8192)) throw error('Choose pet.json and its sprite sheet, or a ZIP containing them.');
          if (json.length) raw = JSON.parse(await json[0].text());
          bytes = new Uint8Array(await images[0].arrayBuffer());
        }
        const pet = await S.normalize(bytes, raw);
        const reply = await send({ op: 'import', meta: pet, data: pet.data });
        if (!reply?.ok) throw error('Couldn’t update your pet library. Existing pets were kept.');
        status.textContent = t('Pet imported. Choose it in your habitat.'); await render();
      } catch (error) { status.textContent = t(error?.pet === true ? error.message : 'Invalid pet package.'); }
      finally { input.disabled = false; input.value = ''; }
    });
    root.append(input, status, list);
    const load = () => render().catch(() => { status.textContent = t('Couldn’t update your pet library. Existing pets were kept.'); });
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      if (!alive || started || !entries.some((e) => e.isIntersecting)) return;
      started = true; observer.disconnect(); load();
    }) : null;
    if (observer) observer.observe(root); else load();
    window.addEventListener('pagehide', () => { alive = false; revision++; observer?.disconnect(); players.forEach((p) => p.stop()); }, { once: true });
  };
  return { mount };
})();
