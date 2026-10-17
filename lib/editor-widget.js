// The editor's widget builder (the Mods tab): a widget with no code, made from blocks (lib/modwidget.js) bound to the data
// Glaze already has, with a live preview from the student's own data on this device (or example data until there is any).
// Saving signs it with the student's author key (lib/modbundle.js, the same key export uses) and installs it as a local mod
// of source 'builder'; exporting or copying a code is the same signed bundle. The widget is checked by the same cleaner the
// worker and the page use, so nothing the form holds can reach a page unchecked. Extension options page only (mount); the
// pure helpers (norm, blank, need, manifestOf, bump) are for node tests.
var GZ_WIDGETEDIT = globalThis.GZ_WIDGETEDIT || (() => {
  const B = () => (typeof GZ_MODBUNDLE !== 'undefined' ? GZ_MODBUNDLE : require('./modbundle.js'));
  const W = () => (typeof GZ_MODWIDGET !== 'undefined' ? GZ_MODWIDGET : require('./modwidget.js'));
  const E = () => (typeof GZ_MODSEDIT !== 'undefined' ? GZ_MODSEDIT : require('./editor-mods.js'));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const TYPES = ['text', 'number', 'list', 'ring', 'countdown', 'image', 'button'];
  const PICTURE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
  const MAX_PICTURE = 256 << 10;

  // ---- the form's data → what the cleaner takes ---------------------------------------------------------------------------------
  // A block as the form holds it, less what it left empty or off, so a field never typed in is a field the block does not have.
  const norm = (b) => Object.fromEntries(Object.entries(b).filter(([k, v]) => (v !== '' || k === 'alt') && v !== undefined && v !== null && v !== false && !(typeof v === 'number' && Number.isNaN(v))));
  const blank = (type, t) => ({
    text: { type, text: `${t('Next:')} {next.title}` }, number: { type, value: 'todo.count', label: t('To-dos left') }, list: { type, items: 'todo.items', max: 5, empty: t('Nothing due') },
    ring: { type, value: 'todo.done', max: 'todo.total', label: t('Done') }, countdown: { type, to: 'next.due', label: t('Next due') }, image: { type, src: '', alt: '' },
    button: { type, label: t('Open next to-do'), action: 'next' },
  }[type]);
  // The permissions the blocks need, each with its reason (the form's, else a default in the student's language).
  const need = (blocks) => (blocks ? W().needs(blocks) : []);
  const reasons = (t) => ({ todo: t('Shows your to-dos and due dates in this widget.'), grades: t('Shows your grades in this widget.'), courses: t('Shows your course names in this widget.') });
  const one = (v) => String(v ?? '').replace(/[\p{Cc}\p{Bidi_Control}]/gu, ' ').replace(/\s+/g, ' ').trim();
  // The next version up of the highest one seen (installed, or pinned after a removal): 1.0.0 → 1.0.1.
  const bump = (...seen) => {
    const known = seen.filter((v) => typeof v === 'string');
    if (!known.length) return '1.0.0';
    const top = known.reduce((a, b) => (B().compare(a, b) >= 0 ? a : b));
    return top.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (m, x, y, z) => `${x}.${y}.${+z + 1}`);
  };
  // st: { name, author, tile, size, rail, blocks (the form's), why { permission: reason }, version } → { manifest } or { problem }:
  // 'name', 'author', 'place', 'blocks' (with the index of the first block the cleaner refuses, or -1), 'reason' (the permission).
  const manifestOf = (st, t) => {
    const name = one(st.name), author = one(st.author);
    if (!name || [...name].length > 40) return { problem: 'name' };
    if (!author || [...author].length > 40) return { problem: 'author' };
    if (!st.tile && !st.rail) return { problem: 'place' };
    const raw = st.blocks.map(norm), blocks = W().blocks(raw);
    if (!blocks) return { problem: 'blocks', at: raw.findIndex((b) => !W().blocks([b])) };
    const ask = need(blocks), fallback = reasons(t), permissions = [];
    for (const id of ask) {
      const why = one(st.why?.[id] ?? fallback[id]);
      if (!why || [...why].length > 280) return { problem: 'reason', id };
      permissions.push({ id, why });
    }
    const ui = {
      ...(st.tile && { tiles: [{ id: 'main', name, sizes: [['s', 'm', 'l'].includes(st.size) ? st.size : 'm'], blocks }] }),
      ...(st.rail && { rail: [{ id: 'side', name, blocks }] }),
    };
    return { manifest: { glaze: 1, name, version: st.version || '1.0.0', author: { name: author }, ...(permissions.length && { permissions }), ui } };
  };

  // The form edits one tile and one matching rail slot; don't offer it for manifests it would discard.
  const editable = (m) => {
    if (!E().plain(m) || Object.keys(m).some((k) => !['glaze', 'name', 'version', 'author', 'permissions', 'ui'].includes(k))
      || Object.keys(m.ui).some((k) => !['tiles', 'rail'].includes(k))) return false;
    const tile = m.ui.tiles?.[0], rail = m.ui.rail?.[0], blocks = (tile || rail)?.blocks;
    return ['tiles', 'rail'].every((k) => !m.ui[k] || (m.ui[k].length === 1 && m.ui[k][0].id === (k === 'tiles' ? 'main' : 'side')
      && m.ui[k][0].name === m.name && W().same(m.ui[k][0].blocks, blocks))) && (!tile || tile.sizes.length === 1);
  };

  // ---- the page ----------------------------------------------------------------------------------------------------------------
  // a: { t, show (route), and }. → { edit(record) } for the Mods tab's Edit button.
  const mount = (a) => {
    const { t } = a;
    const local = chrome.storage.local;
    const $ = (id) => document.getElementById(id);
    const send = (m) => chrome.runtime.sendMessage({ type: 'glaze:mods', ...m }).catch(() => ({ ok: false, error: 'failed' }));
    const h = (tag, props = {}, ...kids) => {
      const e = document.createElement(tag);
      e.append(...kids.flat().filter((k) => k != null && k !== false));
      for (const [k, v] of Object.entries(props)) if (v == null || v === false) continue; else if (k in e && !k.includes('-')) e[k] = v; else e.setAttribute(k, v === true ? '' : v);
      return e;
    };
    const say = (text, err = false) => { const el = $('wb-said'); el.classList.toggle('err', err); el.textContent = ''; requestAnimationFrame(() => { el.textContent = text; }); };
    const std = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
    const unstd = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const download = (bytes, name) => { const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); h('a', { href: url, download: name }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

    // What the picker offers, in the student's words.
    const PATHS = {
      'next.title': t('Next to-do: title'), 'next.course': t('Next to-do: course'), 'next.due': t('Next to-do: due time'),
      'todo.count': t('To-dos still open'), 'todo.overdue': t('To-dos past due'), 'todo.today': t('To-dos due today'), 'todo.done': t('To-dos done'), 'todo.total': t('All to-dos'),
      'todo.items': t('Open to-dos, soonest first'), 'schedule.today': t('Today’s to-dos by time'),
      'grades.gpa': t('GPA (4.0 scale)'), 'grades.average': t('Average grade (%)'), 'grades.courses': t('Each course’s grade'),
      'courses.count': t('Number of courses'), 'courses.names': t('Course names'),
    };
    const ofKind = (...kinds) => Object.keys(PATHS).filter((p) => kinds.includes(W().kind(p))).map((p) => [p, PATHS[p]]);
    const SIZE = [['', t('Normal')], ['s', t('Small')], ['l', t('Large')], ['xl', t('Very large')]];
    const COLOR = [['', t('Default')], ['accent', t('Accent')], ['ok', t('Good')], ['warn', t('Warning')], ['err', t('Alert')], ['ink-muted', t('Subtle')]];
    const ACTION = [['next', t('Open the next to-do')], ['course', t('Open the next to-do’s course')], ['dashboard', t('Go to the Dashboard')], ['courses', t('Go to Courses')], ['grades', t('Go to Grades')], ['calendar', t('Go to the Calendar')]];
    // type → [key, control, label, option]
    const FIELDS = {
      text: [['text', 'area', t('Text'), 200], ['size', 'choice', t('Size'), SIZE], ['weight', 'bold', t('Bold')], ['muted', 'check', t('Subtle')], ['color', 'choice', t('Color'), COLOR]],
      number: [['value', 'num', t('Value')], ['label', 'line', t('Label'), 80], ['unit', 'line', t('Unit'), 12], ['digits', 'int', t('Decimals'), [0, 4]], ['size', 'choice', t('Size'), SIZE], ['color', 'choice', t('Color'), COLOR]],
      list: [['items', 'choice', t('Items'), ofKind('list')], ['max', 'int', t('How many'), [1, 10]], ['ordered', 'check', t('Numbered')], ['label', 'line', t('Label'), 80], ['empty', 'line', t('When there are none, say'), 80]],
      ring: [['value', 'num', t('Value')], ['max', 'num', t('Out of')], ['label', 'line', t('Label'), 80], ['color', 'choice', t('Color'), COLOR]],
      countdown: [['to', 'time', t('Counts down to')], ['label', 'line', t('Label'), 80], ['done', 'line', t('When it ends, say'), 80]],
      image: [['src', 'pic', t('Picture')], ['alt', 'line', t('Describe it'), 200], ['w', 'int', t('Width in pixels'), [1, 2000]], ['fit', 'choice', t('Fit'), [['', t('Fit inside')], ['cover', t('Fill')]]]],
      button: [['label', 'line', t('Button text'), 60], ['action', 'choice', t('Does'), ACTION], ['tone', 'choice', t('Style'), [['', t('Plain')], ['primary', t('Highlighted')]]]],
    };
    const TYPE_NAME = { text: t('Text'), number: t('Number'), list: t('List'), ring: t('Ring'), countdown: t('Countdown'), image: t('Image'), button: t('Button') };

    let st, pictures, saving = false, uid = 0;
    const reset = () => {
      st = { name: '', author: '', tile: true, size: 'm', rail: false, why: {}, version: '1.0.0', blocks: [blank('text', t), blank('countdown', t)] };
      pictures = {};
    };
    reset();

    // ---- the preview, from the student's own data ----
    const preview = $('wb-preview');
    const root = preview.attachShadow({ mode: 'closed' });
    // The site whose data was read last, found from what Glaze keeps (the planner, Insights, the courses it has seen).
    const keys = async () => (local.getKeys ? local.getKeys() : Object.keys(await local.get(null)));
    let found;
    const site = () => (found ||= (async () => {
      const o = await local.get(['todoCache', 'seenCourses']);
      const origin = (k, pre) => new RegExp(`^${pre}(https?://[^/]+)/`).exec(k)?.[1];
      return origin(o.todoCache?.key || '', 'todo:') || (await keys()).map((k) => origin(k, 'insights:')).find(Boolean) || Object.values(isObj(o.seenCourses) ? o.seenCourses : {}).find((c) => typeof c?.site === 'string')?.site || null;
    })());
    const dataFor = async (blocks) => {
      const perms = need(blocks), origin = perms.length ? await site() : null;
      const example = W().sample();
      if (!origin) return { data: Object.fromEntries(perms.map((p) => [p, example[p]])), real: [], origin };
      const env = { site: origin, local, keys };
      const read = await W().collect(perms, (p) => GZ_MODBROKER.CALLS[p].run([], env));
      const real = perms.filter((p) => read[p].length);
      return { data: Object.fromEntries(perms.map((p) => [p, real.includes(p) ? read[p] : example[p]])), real, origin };
    };
    let drawn = 0;
    const redraw = async () => {
      const n = ++drawn, blocks = W().blocks(st.blocks.map(norm));
      if (!blocks) { root.replaceChildren(); $('wb-data').textContent = ''; return; }
      const { data, real, origin } = await dataFor(blocks), asked = need(blocks);
      if (n !== drawn) return;
      const r = W().resolve(blocks, data, { lang: document.documentElement.lang || navigator.language, paths: Object.keys(pictures) });
      GZ_MODUI.render(root, r.tree, { send: () => {}, canvas: null, asset: (p) => createImageBitmap(new Blob([pictures[p]], { type: PICTURE[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] })) });
      $('wb-data').textContent = !asked.length ? '' : real.length === asked.length ? t('Your own data from {site}, shown on this device only.', { site: new URL(origin).host })
        : real.length ? t('Your data where Glaze has it, and example data for the rest.') : t('Example data. Open your school’s pages once and your own data appears here.');
    };
    let later = 0;
    const touch = () => { clearTimeout(later); later = setTimeout(() => { redraw(); problems(); }, 120); };

    // ---- the blocks ----
    const set = (b, key, v) => { if ((v === '' && key !== 'alt') || v === undefined || Number.isNaN(v)) delete b[key]; else b[key] = v; touch(); };
    const control = (b, [key, kind, label, opt]) => {
      const id = `wb-${++uid}`;
      const field = (el, ...more) => h('div', { className: 'field wide' }, h('label', { htmlFor: id, textContent: label }), h('div', { className: 'row' }, el, ...more));
      if (kind === 'line') return field(h('input', { id, value: b[key] ?? '', maxLength: opt, oninput: (e) => set(b, key, one(e.target.value)) }));
      if (kind === 'area') {
        const text = h('textarea', { id, rows: 2, value: b[key] ?? '', maxLength: opt, oninput: (e) => set(b, key, e.target.value) });
        // A data hole goes in where the cursor is: {path}, the only markup the text has.
        const holes = h('select', { 'aria-label': t('Insert data into the text'), onchange: (e) => {
          if (!e.target.value) return;
          const at = text.selectionEnd ?? text.value.length;
          text.value = `${text.value.slice(0, at)}{${e.target.value}}${text.value.slice(at)}`;
          e.target.value = '';
          set(b, key, text.value);
        } }, h('option', { value: '', textContent: t('Insert data…') }), ofKind('text', 'number', 'time').map(([p, l]) => h('option', { value: p, textContent: l })));
        return field(text, holes);
      }
      if (kind === 'check' || kind === 'bold') return h('label', { className: 'check' }, h('input', { type: 'checkbox', checked: kind === 'bold' ? b.weight === 'bold' : !!b[key], onchange: (e) => (kind === 'bold' ? set(b, 'weight', e.target.checked ? 'bold' : '') : set(b, key, e.target.checked)) }), h('span', { textContent: label }));
      if (kind === 'choice') return field(h('select', { id, onchange: (e) => set(b, key, e.target.value) }, opt.map(([v, l]) => h('option', { value: v, textContent: l, selected: (b[key] ?? '') === v }))));
      if (kind === 'int') return field(h('input', { id, type: 'number', min: opt[0], max: opt[1], step: 1, value: b[key] ?? '', oninput: (e) => set(b, key, e.target.value === '' ? '' : Math.round(+e.target.value)) }));
      if (kind === 'num' || kind === 'time') {
        // A path from the picker, or a value typed in (a number; or a date and time).
        const typed = typeof b[key] === 'number' || b[key] === undefined;
        const input = h('input', kind === 'num' ? { type: 'number', 'aria-label': label, step: 'any', value: typeof b[key] === 'number' ? b[key] : '', hidden: !typed, oninput: (e) => set(b, key, e.target.value === '' ? '' : +e.target.value) }
          : { type: 'datetime-local', 'aria-label': label, value: typeof b[key] === 'number' ? new Date(b[key] - new Date(b[key]).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '', hidden: !typed, oninput: (e) => set(b, key, e.target.value ? Date.parse(e.target.value) : '') });
        const pick = h('select', { id, onchange: (e) => { input.hidden = !!e.target.value; if (e.target.value) set(b, key, e.target.value); else input.dispatchEvent(new Event('input')); } },
          h('option', { value: '', textContent: kind === 'num' ? (key === 'max' ? t('100, or a number I type') : t('A number I type')) : t('A date I choose'), selected: typed }),
          ofKind(kind === 'num' ? 'number' : 'time').map(([p, l]) => h('option', { value: p, textContent: l, selected: b[key] === p })));
        return field(pick, input);
      }
      if (kind === 'pic') {
        const file = h('input', { id, type: 'file', accept: Object.values(PICTURE).filter((v, i, l) => l.indexOf(v) === i).join(','), onchange: async (e) => {
          const f = e.target.files[0];
          e.target.value = '';
          const ext = f?.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
          if (!f || !Object.hasOwn(PICTURE, ext)) return f && say(t('Choose a PNG, JPEG, GIF, WebP or AVIF picture.'), true);
          if (f.size > MAX_PICTURE) return say(t('That picture is over 256 KiB. Use a smaller one.'), true);
          let bytes, size;
          try { bytes = new Uint8Array(await f.arrayBuffer()); size = GZ_DOCTEXT.imageSize(bytes); } catch { /* an unreadable picture */ }
          if (!size) return say(t('Choose a PNG, JPEG, GIF, WebP or AVIF picture.'), true);
          if (size.w > GZ_MODBROKER.LIMIT.picture || size.h > GZ_MODBROKER.LIMIT.picture) return say(t('That picture is too large. Crop it or take a screenshot of the part you need.'), true);
          if (b.src && !st.blocks.some((x) => x !== b && x.src === b.src)) delete pictures[b.src];
          do { b.src = `img/picture-${++uid}.${ext}`; } while (Object.hasOwn(pictures, b.src));
          pictures[b.src] = bytes;
          name.textContent = f.name;
          touch();
        } });
        const name = h('span', { className: 'desc', textContent: b.src ? b.src.slice(b.src.lastIndexOf('/') + 1) : t('No picture yet') });
        return field(file, name);
      }
      return null;
    };
    const list = $('wb-blocks');
    let invalid = new Set();
    const drawBlocks = (focus) => {
      list.replaceChildren(...st.blocks.map((b, i) => {
        const name = `${TYPE_NAME[b.type]} ${i + 1}`;
        const move = (by) => { st.blocks.splice(i + by, 0, ...st.blocks.splice(i, 1)); drawBlocks(`${by < 0 ? 'up' : 'down'}:${i + by}`); touch(); };
        const row = h('li', { className: 'mod-card wb-block', 'data-block': String(i) },
          h('div', { className: 'row' }, h('h4', { textContent: name }),
            h('button', { type: 'button', textContent: t('Move up'), 'data-f': `up:${i}`, 'aria-label': `${t('Move up')} · ${name}`, 'aria-disabled': String(i === 0), onclick: () => i > 0 && move(-1) }),
            h('button', { type: 'button', textContent: t('Move down'), 'data-f': `down:${i}`, 'aria-label': `${t('Move down')} · ${name}`, 'aria-disabled': String(i === st.blocks.length - 1), onclick: () => i < st.blocks.length - 1 && move(1) }),
            h('button', { type: 'button', className: 'danger', textContent: t('Remove'), 'aria-label': `${t('Remove')} · ${name}`, onclick: () => { const gone = st.blocks.splice(i, 1)[0]; if (gone.src && !st.blocks.some((x) => x.src === gone.src)) delete pictures[gone.src]; drawBlocks(i ? `up:${i - 1}` : 'add'); touch(); } })),
          h('div', { className: 'wb-fields' }, FIELDS[b.type].map((f) => control(b, f))),
          h('p', { className: 'desc mod-warn', hidden: !invalid.has(i), role: 'alert', textContent: t('This block is missing something.') }));
        return row;
      }));
      $('wb-empty').hidden = st.blocks.length > 0;
      if (focus === 'add') $('wb-add-type').focus();
      else if (focus) list.querySelector(`[data-f="${focus}"]`)?.focus();
      else list.querySelector('input,select,textarea')?.focus();
    };

    // ---- what it needs, and what is wrong ----
    const reasonBox = $('wb-reasons');
    const PERM = { todo: t('To Do'), grades: t('Grades'), courses: t('Courses') };
    const problems = () => {
      const raw = st.blocks.map(norm), blocks = W().blocks(raw);
      invalid = new Set(blocks ? [] : raw.map((b, i) => (W().blocks([b]) ? -1 : i)).filter((i) => i >= 0));
      list.querySelectorAll('.wb-block').forEach((li) => { li.querySelector('.mod-warn').hidden = !invalid.has(+li.dataset.block); });
      const ask = need(blocks), fallback = reasons(t);
      if (ask.join() !== reasonBox.dataset.shown) {
        reasonBox.dataset.shown = ask.join();
        reasonBox.replaceChildren(...(ask.length ? [h('h3', { textContent: t('What it needs') }), h('p', { className: 'desc', textContent: t('Glaze shows these when someone installs the widget, with your reason. The data stays on their device.') })] : []),
          ...ask.map((id) => h('div', { className: 'field wide' }, h('label', { htmlFor: `wb-why-${id}`, textContent: `${PERM[id]} — ${t('why does it need this?')}` }),
            h('input', { id: `wb-why-${id}`, maxLength: 280, value: st.why[id] ?? fallback[id], onchange: (e) => { st.why[id] = e.target.value; } }))));
      }
    };

    // ---- saving ----
    const author = async () => {
      const { modAuthor } = await local.get('modAuthor');
      return modAuthor && await B().keyPair(modAuthor) ? modAuthor : null;
    };
    const PROBLEM = {
      name: () => t('Give the widget a name (up to 40 characters).'), author: () => t('Enter your name (up to 40 characters).'), place: () => t('Choose where it shows: a tile, the navigation, or both.'),
      blocks: () => t('Some blocks are missing something.'), reason: (p) => t('Say why it needs {permission}.', { permission: PERM[p.id] }),
    };
    // Pack, sign, and install: the student's own widget needs no prompt (they just made it), but it goes through the worker's
    // checks as any bundle does. → the bundle read back, or null (and what went wrong said).
    const save = async (trusted) => {
      if (!trusted || saving) return null;
      saving = true;
      const draft = st;
      try {
        const first = manifestOf(draft, t);
        if (first.problem) {
          say(PROBLEM[first.problem](first), true);
          problems();
          ($({ name: 'wb-name', author: 'wb-author', place: 'wb-tile', reason: `wb-why-${first.id}` }[first.problem]) || list.querySelector(`[data-block="${first.at}"] input,[data-block="${first.at}"] select,[data-block="${first.at}"] textarea`))?.focus();
          return null;
        }
        // Only the pictures a block uses go into the bundle.
        const used = new Set(W().images(first.manifest.ui.tiles?.[0]?.blocks || first.manifest.ui.rail[0].blocks));
        const files = Object.fromEntries(Object.entries(pictures).filter(([p]) => used.has(p)));
        let key = await author(), made = false;
        if (!key) { key = await B().makeKey(); await local.set({ modAuthor: key }); made = true; }
        await local.set({ modAuthorName: first.manifest.author.name });
        // The same widget keeps its id, so its version goes up from the highest the editor has seen of it.
        let got = await B().pack(files, first.manifest, key);
        const [{ mods = [] }, trust] = [await send({ op: 'list' }), (await local.get(`modTrust:${got.id}`))[`modTrust:${got.id}`]];
        const before = mods.find((m) => m.id === got.id) || null;
        if (before || trust) { draft.version = bump(before?.version, trust?.version); got = await B().pack(files, { ...first.manifest, version: draft.version }, key); }
        const plan = B().plan(before, got, { trust: trust || null });
        if (plan.action === 'refuse') { say(E().refusal({ error: 'refused', reason: plan.reason }, t), true); return null; }
        const r = await send({ op: 'install', zip: std(got.bytes), hash: got.hash, grants: E().grantsFor(got.manifest, before, plan.newPermissions), source: 'builder' });
        if (!r.ok) { say(E().refusal(r, t), true); return null; }
        say(`${t(r.action === 'update' ? 'Updated {name}.' : 'Installed {name}.', { name: got.prompt.name })}${made ? ` ${t('Made your author key. Back it up below: without it you can’t update your widgets.')}` : ''}`);
        draft.version = got.version;
        return got;
      } catch (e) { say(t(e?.why || 'Glaze couldn’t do that.', e?.vars || {}), true); return null; } finally { saving = false; }
    };
    $('wb-save').addEventListener('click', (e) => save(e.isTrusted));
    $('wb-export').addEventListener('click', async (e) => {
      const got = await save(e.isTrusted);
      if (got) download(got.bytes, `${B().slug(got.manifest.name) || 'widget'}.glazemod`);
    });
    $('wb-copy').addEventListener('click', async (e) => {
      const got = await save(e.isTrusted);
      if (!got) return;
      try { await navigator.clipboard.writeText(await B().encode(got.bytes)); say(t('Saved, and copied its mod code. Anyone can paste it into Add a mod.')); } catch (err) { say(t(err?.why || 'Glaze couldn’t do that.', err?.vars || {}), true); }
    });
    $('wb-key-save').addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      const key = await author();
      if (!key) return say(t('There is no author key on this device yet.'), true);
      const pass = $('wb-pass').value;
      if (!pass) { say(t('Enter a passphrase to back up your author key.'), true); $('wb-pass').focus(); return; }
      download(new TextEncoder().encode(await B().backup(key, pass)), 'glaze-author-key.json');
      say(t('Saved your author key, locked with your passphrase.'));
    });

    // ---- the form ----
    const fill = () => {
      $('wb-name').value = st.name; $('wb-author').value = st.author; $('wb-tile').checked = st.tile; $('wb-size').value = st.size; $('wb-rail').checked = st.rail;
      $('wb-size').disabled = !st.tile;
      reasonBox.dataset.shown = 'x';
      drawBlocks('none');
      problems();
      redraw();
    };
    $('wb-name').addEventListener('input', (e) => { st.name = e.target.value; });
    $('wb-author').addEventListener('input', (e) => { st.author = e.target.value; });
    $('wb-tile').addEventListener('change', (e) => { st.tile = e.target.checked; $('wb-size').disabled = !st.tile; });
    $('wb-size').addEventListener('change', (e) => { st.size = e.target.value; });
    $('wb-rail').addEventListener('change', (e) => { st.rail = e.target.checked; });
    $('wb-add-type').replaceChildren(...TYPES.map((v) => h('option', { value: v, textContent: TYPE_NAME[v] })));
    $('wb-add').addEventListener('click', () => {
      if (st.blocks.length >= W().LIMIT.blocks) return say(t('A widget has at most 12 blocks.'), true);
      st.blocks.push(blank($('wb-add-type').value, t));
      drawBlocks('none');
      touch();
      list.lastElementChild.querySelector('input,select,textarea')?.focus();
    });
    $('wb-new').addEventListener('click', () => { reset(); local.get('modAuthorName').then((r) => { st.author = r.modAuthorName || t('Me'); fill(); say(''); }); });
    const edit = async (rec) => {
      const out = await send({ op: 'export', id: rec.id });
      let got;
      try { got = out.ok && await B().read(unstd(out.zip)); } catch { got = null; }
      if (!got) return say(t('Glaze couldn’t do that.'), true);
      if (!editable(got.manifest)) return say(t('Glaze couldn’t do that.'), true);
      const m = got.manifest, tile = m.ui?.tiles?.[0], rail = m.ui?.rail?.[0], from = tile || rail;
      pictures = Object.fromEntries(Object.entries(got.files).filter(([p]) => Object.hasOwn(PICTURE, p.slice(p.lastIndexOf('.') + 1).toLowerCase())));
      st = { name: m.name, author: m.author.name, tile: !!tile, size: tile?.sizes?.[0] || 'm', rail: !!rail, version: m.version, blocks: structuredClone(from.blocks), why: Object.fromEntries((m.permissions || []).map((p) => [p.id, p.why])) };
      fill();
      a.show('mods/widget');
      $('wb-name').focus();
    };
    local.get('modAuthorName').then((r) => { st.author = r.modAuthorName || t('Me'); fill(); });
    return { edit, canEdit: editable };
  };

  return { TYPES, norm, blank, need, reasons, bump, manifestOf, editable, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_WIDGETEDIT;
