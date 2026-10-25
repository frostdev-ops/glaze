// The student's pointer in the editor (lib/editor-pointer.js, Look › Pointer): one card per choice the setting takes, what
// each shows, and that choosing, uploading and removing write only the student's settings (extras) and their picture on
// this device, never the Look's parts. In a VM with a small stand-in DOM and storage; how it looks is the headless check's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../defaults.js');
const L = require('../lib/lookx.js');
const P = require('../lib/editor-pointer.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const tick = () => new Promise((r) => setTimeout(r));

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, style: {}, dataset: {}, on: {}, hidden: false, disabled: false, checked: false }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { this.children.push(...kids.map((k) => (typeof k === 'string' ? { text: k } : k))); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  addEventListener(t, f) { (this.on[t] ||= []).push(f); }
  fire(t, e = {}) { for (const f of this.on[t] || []) f({ type: t, isTrusted: true, ...e }); }
  click() { this.fire('click'); }
  focus() { this.focused = true; }
  get textContent() { return this._text ?? this.children.map((c) => c.text ?? c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  all(test) { return [this, ...this.children.filter((c) => c instanceof El).flatMap((c) => c.all(test))].filter(test); }
}

// The editor page with the section's static parts, the settings `s` and storage.local holding `local`.
const editor = (s, local = {}) => {
  const ids = Object.fromEntries(['pointer-tiles', 'pointer-pick', 'pointer-remove', 'pointer-file', 'pointer-anim-look'].map((id) => [id, new El(id === 'pointer-tiles' ? 'div' : 'p')]));
  const saved = [], previews = [], hints = [], changed = [], reads = [];
  let picked = null;
  const context = vm.createContext({
    console, JSON, Object, Array, String, Promise, setTimeout,
    // What the libraries load in node when the page's globals are not there (defaults.js, lib/lookparts.js).
    require: (f) => require(path.resolve(__dirname, '../lib', f)),
    document: {
      createElement: (tag) => (tag === 'canvas' ? Object.assign(new El('canvas'), { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,cGljdHVyZQ==' }) : new El(tag)),
      createElementNS: (ns, tag) => Object.assign(new El(tag), { namespaceURI: ns }),
      getElementById: (id) => ids[id] || null,
    },
    createImageBitmap: async (f) => { if (f.bad) throw new Error('no'); return { width: 64, height: 48, close() {} }; },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get: (k, cb) => {
            const result = Object.fromEntries([].concat(k).filter((x) => x in local).map((x) => [x, local[x]]));
            const answer = () => cb(result);
            reads.push(answer);
            setTimeout(() => { if (!context.holdReads) answer(); });
          },
          set: (v, cb) => setTimeout(() => { for (const [k, x] of Object.entries(v)) { changed.push(k); local[k] = x; } cb?.(); }),
          remove: (k, cb) => setTimeout(() => { delete local[k]; changed.push(k); cb?.(); }),
        },
        onChanged: { addListener: (f) => { context.storageChanged = f; } },
      },
    },
  });
  context.globalThis = context;
  for (const f of ['lib/motionx.js', 'lib/lookparts.js', 'lib/lookx.js', 'lib/editor-x.js', 'lib/editor-xmotion.js', 'lib/editor-pointer.js']) vm.runInContext(read(f), context);
  ids['pointer-file'].click = () => { picked = 'asked'; };
  context.GZ_EDITOR_X.mount({ s, t: (k, v) => (v ? k.replace(/\{(\w+)\}/g, (_, n) => v[n]) : k), frame: { contentWindow: null },
    // Kept as plain JSON: what the VM's realm made compares by value here.
    save: (keys, soon, parts) => saved.push(JSON.parse(JSON.stringify([keys, parts ?? null]))), preview: () => previews.push(JSON.stringify(s.extras)), hint: (...a) => hints.push(JSON.parse(JSON.stringify(a))) });
  const cards = () => ids['pointer-tiles'].children;
  const card = (v) => cards().find((c) => c.attrs['data-pointer'] === v);
  const radio = (v) => card(v).children[0];
  const shows = (v) => card(v).children[1].children.map((c) => c.src || (c.tagName === 'SVG' ? 'system' : c.className === 'pt-none' ? 'none' : '?'));
  const said = (v) => (card(v).children[3].hidden ? '' : card(v).children[3].textContent);
  const choose = (v) => { const r = radio(v); r.checked = true; r.fire('change'); };
  return { ids, cards, card, radio, shows, said, choose, saved, previews, hints, changed, reads, local, context, picked: () => picked, render: () => context.GZ_EDITOR_X.render() };
};
const settings = (extras = {}, parts = { x: { pointer: 'pumpkin', cursor: { kind: 'flicker' } } }) => ({ ...G.GZ_SANITIZE({ extras }), parts: structuredClone(parts) });

test('a card for every choice the setting takes, in its order, each a radio in one group named for the setting', () => {
  assert.deepEqual(P.TILES(), G.GZ_SPEC.extras.pointer[1]);
  const e = editor(settings());
  assert.deepEqual(e.cards().map((c) => c.attrs['data-pointer']), G.GZ_SPEC.extras.pointer[1]);
  for (const c of e.cards()) {
    const [input, stage, name] = c.children;
    assert.deepEqual([c.tagName, input.tagName, input.type, input.name, input.value], ['LABEL', 'INPUT', 'radio', 'extras.pointer', c.attrs['data-pointer']]);
    assert.ok('data-local' in input.attrs, 'the module keeps it in line, not the page\'s generic radios');
    assert.equal(stage.attrs['aria-hidden'], 'true', 'the pictures are decoration: the name says it');
    assert.equal(name.tagName, 'B');
    assert.ok(name.textContent.length > 1);
  }
  // Names: the two that are not sets, the sets' own names, the picture.
  assert.deepEqual(['look', 'lava', 'neon', 'own'].map((v) => e.card(v).children[2].textContent), ["The Look's pointer", 'Lava', 'Neon', 'Your own picture']);
  assert.equal(e.card('off'), undefined, 'the system\'s is the switch, not a card');
});

test('each card shows its pointer: a set\'s arrow and hand, the system\'s drawn, the Look\'s what the Look wears', async () => {
  const e = editor(settings());
  await tick();
  for (const set of Object.keys(L.CURSORS)) {
    const ext = L.CURSORS[set].svg ? 'svg' : 'png';
    assert.deepEqual(e.shows(set), [`assets/art/cursors/${set}/default.${ext}`, `assets/art/cursors/${set}/pointer.${ext}`], set);
    for (const f of e.shows(set)) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
    assert.match(e.card(set).style.cursor, new RegExp(`^url\\("assets/art/cursors/${set}/pointer\\.${ext}"\\) \\d+ \\d+.*, pointer$`), `${set}: hovering wears its hand`);
  }
  assert.deepEqual(e.shows('look'), e.shows('pumpkin'), 'the Look\'s card: the Look\'s set');
  assert.equal(e.said('look'), 'Pumpkin');
  assert.deepEqual(e.shows('own'), ['none']);
  assert.equal(e.said('own'), 'No picture yet');
  assert.equal(e.radio('own').disabled, true, 'nothing to wear yet: the arrow keys pass it by');
  assert.equal(e.ids['pointer-remove'].hidden, true);
  assert.equal(e.ids['pointer-pick'].textContent, 'Choose a picture…');
  assert.equal(e.ids['pointer-anim-look'].textContent, "This Look's: Flicker");
  // A Look without a pointer, or any parts: the Look's card shows the system's.
  const bare = editor(settings({}, null));
  assert.deepEqual(bare.shows('look'), ['system', 'system']);
  assert.equal(bare.said('look'), 'System pointer');
  assert.equal(bare.ids['pointer-anim-look'].textContent, 'This Look has no pointer animation.');
});

test('choosing a card saves the student\'s setting alone and shows it in the preview; the Look stays as it was', async () => {
  const s = settings(), look = structuredClone(s.parts);
  const e = editor(s);
  await tick();
  assert.equal(e.radio('look').checked, true, 'the Look\'s, by default');
  e.choose('lava');
  assert.equal(s.extras.pointer, 'lava');
  assert.deepEqual(e.saved, [[['extras'], null]], 'the settings\' extras, never the Look\'s parts');
  assert.deepEqual(e.previews, [JSON.stringify(s.extras)], 'the preview has it before the save');
  assert.deepEqual(s.parts, look);
  assert.deepEqual(e.cards().filter((c) => c.children[0].checked).map((c) => c.attrs['data-pointer']), ['lava']);
  e.choose('rose');
  assert.equal(s.extras.pointer, 'rose');
  // Another Look is worn: the choice stays, and the Look's card follows the new Look.
  s.parts = { x: { pointer: 'ghost' } };
  e.render();
  assert.equal(s.extras.pointer, 'rose');
  assert.equal(e.radio('rose').checked, true);
  assert.deepEqual(e.shows('look'), e.shows('ghost'));
  assert.equal(e.said('look'), 'Ghost');
  // A reset or another tab changes the setting: the cards follow it.
  s.extras.pointer = 'look';
  e.render();
  assert.equal(e.radio('look').checked, true);
  assert.equal(e.saved.length, 2, 'following the state saves nothing');
});

test('their own picture: chosen, it is kept on this computer and becomes the pointer; removed, the Look\'s comes back', async () => {
  const s = settings(), look = structuredClone(s.parts);
  const e = editor(s);
  await tick();
  e.ids['pointer-pick'].click();
  assert.equal(e.picked(), 'asked', 'Choose a picture… opens the file chooser');
  const file = e.ids['pointer-file'];
  file.files = [{ type: 'image/png', size: 100 }];
  file.fire('change');
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(e.local.cursorImg, 'data:image/png;base64,cGljdHVyZQ==', 'scaled, as PNG, in storage.local');
  assert.equal(s.extras.pointer, 'own');
  assert.deepEqual(e.saved, [[['extras'], null]]);
  assert.deepEqual(s.parts, look, 'never a Look part');
  assert.deepEqual(e.shows('own'), [e.local.cursorImg, e.local.cursorImg]);
  assert.equal(e.radio('own').disabled, false);
  assert.equal(e.radio('own').checked, true);
  assert.equal(e.said('own'), '');
  assert.equal(e.card('own').style.cursor, `url("${e.local.cursorImg}") 0 0, pointer`);
  assert.equal(e.ids['pointer-pick'].textContent, 'Replace picture…');
  assert.equal(e.ids['pointer-remove'].hidden, false);
  // A file that isn't a picture: said, and nothing changes.
  file.files = [{ type: 'image/png', size: 100, bad: true }];
  file.fire('change');
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(e.hints, [["That file isn't a picture Glaze can read.", true]]);
  assert.equal(s.extras.pointer, 'own');
  // Removed: gone from storage; the pointer is the Look's again, and focus goes back to Choose.
  e.ids['pointer-remove'].click();
  for (let i = 0; i < 3; i++) await tick();
  assert.ok(!('cursorImg' in e.local));
  assert.equal(s.extras.pointer, 'look');
  assert.equal(e.radio('look').checked, true);
  assert.equal(e.radio('own').disabled, true);
  assert.equal(e.ids['pointer-pick'].focused, true);
  assert.deepEqual(s.parts, look);
});

test('pointer uploads refuse other types and files over 5 MiB before decoding', async () => {
  const s = settings(), e = editor(s);
  await tick();
  let decoded = 0;
  e.context.createImageBitmap = async () => { decoded++; return { width: 64, height: 48, close() {} }; };
  for (const f of [{ type: 'image/gif', size: 100 }, { type: 'image/svg+xml', size: 100 }, { type: '', size: 100 },
    { type: 'image/png', size: 5 * 1024 * 1024 + 1 }, { type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 }]) {
    e.ids['pointer-file'].files = [f];
    e.ids['pointer-file'].fire('change');
    for (let i = 0; i < 3; i++) await tick();
  }
  assert.equal(decoded, 0, 'accept= is only a file chooser hint; invalid files must never reach the decoder');
  assert.equal(e.hints.length, 5);
  assert.ok(e.hints.every((h) => h[1] === true));
  assert.deepEqual(e.changed, []);
  assert.equal(s.extras.pointer, 'look');
  for (const type of ['image/png', 'image/jpeg']) {
    e.ids['pointer-file'].files = [{ type, size: 5 * 1024 * 1024 }];
    e.ids['pointer-file'].fire('change');
    for (let i = 0; i < 3; i++) await tick();
  }
  assert.equal(decoded, 2, 'both promised formats at the size boundary are accepted');
  assert.equal(s.extras.pointer, 'own');
});

test('a pending upload cannot undo a later removal, pointer choice or upload', async () => {
  for (const action of ['remove', 'choose', 'upload']) {
    const s = settings({ pointer: 'own' }), e = editor(s, { cursorImg: 'data:image/png;base64,b25l' });
    await tick();
    const pending = [];
    let closed = 0;
    e.context.createImageBitmap = () => new Promise((resolve) => pending.push(() => resolve({ width: 64, height: 48, close() { closed++; } })));
    const upload = () => { e.ids['pointer-file'].files = [{ type: 'image/png', size: 100 }]; e.ids['pointer-file'].fire('change'); };
    upload();
    if (action === 'remove') e.ids['pointer-remove'].click();
    else if (action === 'choose') e.choose('lava');
    else upload();
    for (let i = 0; i < 3; i++) await tick();
    pending[0]();
    for (let i = 0; i < 3; i++) await tick();
    assert.deepEqual(e.changed, action === 'remove' ? ['cursorImg'] : [], `${action}: the superseded decode must not write`);
    assert.equal(s.extras.pointer, action === 'remove' ? 'look' : action === 'choose' ? 'lava' : 'own');
    assert.equal(closed, 1, 'even a superseded bitmap is released');
    if (action === 'upload') {
      pending[1]();
      for (let i = 0; i < 3; i++) await tick();
      assert.deepEqual(e.changed, ['cursorImg'], 'the newest upload can still finish');
      assert.equal(closed, 2);
    }
  }
});

test('a picture added or removed in another tab shows here; one that is no bitmap data URL is not shown', async () => {
  const s = settings({ pointer: 'aqua' });
  const e = editor(s, { cursorImg: 'data:image/png;base64,b25l' });
  await tick();
  assert.deepEqual(e.shows('own'), ['data:image/png;base64,b25l', 'data:image/png;base64,b25l'], 'read from storage when the page opens');
  e.context.storageChanged({ cursorImg: { newValue: 'data:image/png;base64,dHdv' } }, 'local');
  assert.deepEqual(e.shows('own'), ['data:image/png;base64,dHdv', 'data:image/png;base64,dHdv']);
  e.context.storageChanged({ cursorImg: { newValue: 'javascript:alert(1)' } }, 'local');
  assert.deepEqual(e.shows('own'), ['none']);
  e.context.storageChanged({ cursorImg: { newValue: 'data:image/png;base64,dHdv' } }, 'sync');
  assert.deepEqual(e.shows('own'), ['none'], 'only this device\'s storage');
  assert.equal(s.extras.pointer, 'aqua', 'a picture arriving does not choose it');
});

test('an initial picture read cannot overwrite a newer storage change in the editor', () => {
  for (const next of ['data:image/png;base64,dHdv', undefined]) {
    const e = editor(settings(), { cursorImg: 'data:image/png;base64,b25l' });
    e.context.holdReads = true;
    e.context.storageChanged({ cursorImg: { newValue: next } }, 'local');
    e.reads[0]();
    assert.deepEqual(e.shows('own'), next ? [next, next] : ['none']);
    assert.equal(e.ids['pointer-remove'].hidden, !next);
  }
});

test('the section: in the Look tab\'s links, a carrier for the cards, the picture\'s controls and the animation switch', () => {
  const html = read('options.html');
  const section = html.split('data-editor-section="look/pointer"')[1].split('</section>')[0];
  assert.match(section, /id="pointer-tiles" data-setting-owner="extras\.pointer"/);
  assert.match(section, /<input type="checkbox" data-key="extras\.pointerAnim"/);
  assert.match(section, /<button type="button" id="pointer-pick" aria-describedby="pointer-own-note">Choose a picture…<\/button>/);
  assert.match(section, /<input type="file" id="pointer-file" accept="image\/png,image\/jpeg" hidden>/);
  // The picture is asked for here only: the old routes to it are gone.
  assert.doesNotMatch(html, /id="cursor-(pick|file|img|own|note)"/);
  assert.doesNotMatch(read('options.js'), /cursorImg/);
  assert.doesNotMatch(read('lib/editor-xmotion.js'), /Pointers, stickers and rotation/);
  // The Look builder offers its own picture only to a Look that wears it already.
  assert.match(read('lib/editor-xmotion.js'), /MX\(\)\.POINTERS\.filter\(\(k\) => k !== 'own' \|\| v === 'own'\)/);
});
