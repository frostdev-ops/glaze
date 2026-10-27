// Glaze Writer's submit, the page's side (loaded on demand by features/writer.js for a paper's frame). While a paper owns
// an assignment attempt, Ultra's own Submit opens Writer's submit sheet instead (in the capture phase, before Ultra's
// React hears it; a disabled one too, since Ultra disables it while its own box is empty), and its Save and Close first
// saves the paper. Save and Close attaches nothing: a draft file would sit in Ultra's attempt and a later Submit would add
// a second copy; the paper is kept in Writer's storage, so Ultra's Save and Close goes on once that save is done.
// On the sheet's Submit (the student's click; the frame has already saved a 'submit' version and built the .docx):
//   1. attach: a File on the file area's own input (DataTransfer, then bubbling input and change, which React hears at
//      its root), or dropped on its drop zone when the input isn't drawn; never a click on a file input (the OS picker);
//   2. wait, bounded, until Ultra lists the file in the panel;
//   3. the note and/or the paper's text into Ultra's Quill through lib/writer-main.js (gz-writer:set), checked;
//   4. once Ultra's Submit is enabled, one click on it. Ultra's confirmation is Ultra's.
// Any failure stops before Submit and tells the sheet why; nothing is retried by itself. A test is never touched.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_WRITER_SUBMIT = globalThis.GZ_WRITER_SUBMIT || (() => {
  const L = () => globalThis.GZ_WRITER_SUBMIT_LIB;
  const armed = new Map(); // box → whether it's still features/writer.js's
  const submitted = new WeakSet();
  const runs = new WeakMap(), tokens = new WeakMap();
  const attached = new WeakMap(); // box → the file name this page already attached for it
  let passing = null, running = false, down = null;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, every = 100) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() >= end) return null; await pause(every); } };
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const say = (box, m) => { try { box.port?.postMessage(m); } catch { /* the frame went */ } };
  const assignment = (box) => box.kind === 'assignment' && box.mode === 'paper' && !document.querySelector('bb-attempt-canvas') &&
    globalThis.GZ_WRITER_ULTRA?.kindOf(box.editor, { path: location.pathname }) === 'assignment';
  const live = () => { for (const [box, ok] of armed) if (!ok() || !box.editor.isConnected) armed.delete(box); return armed; };
  const visible = (e) => e.getClientRects().length > 0;

  // ---- Ultra's footer buttons, caught before Ultra
  const ownerOf = (b) => { for (const box of live().keys()) { const f = L().footer(box.editor); if (b && (f.submit === b || f.save === b)) return box; } return null; };
  const act = (box, b, e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (L().actionOf(b) === 'submit') { if (!running) { box.frame?.focus(); say(box, { type: 'submit:open' }); } return; }
    // Save and Close: the paper first, then Ultra's own, if Ultra lets it run.
    const go = e.type === 'click';
    box.saving = (box.saving || 0) + 1;
    const n = box.saving;
    box.saved = (ok) => {
      if (box.saving !== n) return;
      box.saving = 0; box.saved = null;
      if (go && ok && b.isConnected && L().enabled(b) && armed.has(box)) pass(b);
    };
    say(box, { type: 'submit:save' });
    setTimeout(() => box.saved?.(false), 4000);
  };
  const pass = (b) => { passing = b; try { b.click(); } finally { passing = null; } };
  document.addEventListener('click', (e) => {
    if (!armed.size) return;
    const b = e.target?.closest?.('button');
    if (!b || b === passing) return;
    const box = ownerOf(b);
    if (box && L().actionOf(b)) act(box, b, e);
  }, true);
  // A disabled button hears no click (Mui's also lets the pointer through to its parent): the press is matched by place.
  const at = (e) => {
    for (const box of live().keys()) {
      const f = L().footer(box.editor);
      for (const b of [f.submit, f.save]) {
        if (!b || L().enabled(b)) continue;
        const r = b.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return [box, b];
      }
    }
    return null;
  };
  document.addEventListener('pointerdown', (e) => { down = armed.size && e.button === 0 ? at(e) : null; }, true);
  document.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) { down = null; return; }
    const hit = at(e), was = down;
    down = null;
    if (hit && hit[1] === was[1]) act(hit[0], hit[1], e);
  }, true);

  // ---- the sheet's Submit
  // lib/writer-main.js in the page's world; its answers arrive inside the dispatch.
  const main = (op, m) => {
    const got = [];
    const hear = (e) => { try { const d = JSON.parse(e.detail); if (d?.id === m.id) got.push(d); } catch { /* not ours */ } };
    document.addEventListener('gz-writer:done', hear);
    try { document.dispatchEvent(new CustomEvent(`gz-writer:${op}`, { detail: JSON.stringify(m) })); } finally { document.removeEventListener('gz-writer:done', hear); }
    return got;
  };
  const give = (input, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    if (input.files?.length !== 1 || input.files[0].name !== file.name) return false;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const drop = (zone, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    return true;
  };
  const attach = async (box, file) => {
    const area = L().areaOf(box.editor), panel = L().panelOf(box.editor);
    if (!area || !panel) return 'page';
    if (attached.get(box) === file.name && L().listed(panel, file.name, visible)) return null;
    const before = L().listed(panel, file.name, visible);
    const input = L().uploadInput(area) || await until(() => L().uploadInput(area), 1500);
    if (input) { if (!give(input, file)) return 'upload'; }
    else { const zone = L().dropZone(area); if (!zone) return 'upload'; drop(zone, file); }
    let named = false;
    const shown = await until(() => {
      const save = !named && L().propertiesSave(document);
      if (save && L().enabled(save)) { named = true; save.click(); }
      return L().listed(panel, file.name, visible) > before;
    }, 30000, 150);
    if (!shown) return 'attach';
    attached.set(box, file.name);
    return null;
  };
  const write = (box, d) => {
    if (!d) return null;
    const said = main('set', { id: box.id, delta: d });
    // Quill draws a paragraph per line (an empty one as <p><br></p>): the box must read back line for line.
    const want = d.map((o) => o.insert).join('').split('\n').slice(0, -1).map(squash).join('\n');
    const have = [...box.editor.children].map((p) => squash(p.textContent)).join('\n');
    return said.some((r) => r?.ok) && have === want ? null : 'text';
  };
  const go = async (box, m, ok) => {
    const fail = (error) => { say(box, { type: 'submit:done', run: m.run, ok: false, error }); return false; };
    if (running || submitted.has(box) || !Number.isSafeInteger(m.run) || m.run <= (runs.get(box) || 0)) return fail('busy');
    runs.set(box, m.run);
    const name = m.name, bytes = m.bytes;
    if (!L().safeName(name) || !(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > 50e6 || typeof m.note !== 'string' || m.note.length > 4000 ||
      (m.text != null && (typeof m.text !== 'string' || m.text.length > 1e6)) || !Number.isFinite(m.until)) return fail('page');
    running = true;
    const token = tokens.get(box) || crypto.randomUUID();
    tokens.set(box, token);
    const permit = async (op) => (await chrome.runtime.sendMessage({ type: 'glaze:writerSubmit', op, token, user: box.context?.paper?.user }))?.ok === true;
    try {
      const d = L().delta({ note: m.note, text: m.text || '' });
      let s = L().advance(L().advance(L().start({ text: !!d }), { step: 'save' }), { step: 'docx' });
      const here = () => ok() && armed.has(box) && assignment(box) && Date.now() < m.until;
      if (!here()) return fail('page');
      if (!await permit('claim')) return fail('claimed');
      if (!here()) return fail('page');
      say(box, { type: 'submit:step', run: m.run, step: 'attach' });
      const file = new File([bytes], name, { type: L().MIME, lastModified: Date.now() });
      const a = await attach(box, file);
      if (a) return fail(a);
      s = L().advance(s, { step: 'attach' });
      if (!here()) return fail('page');
      if (d) {
        say(box, { type: 'submit:step', run: m.run, step: 'text' });
        const w = write(box, d);
        if (w) return fail(w);
        s = L().advance(s, { step: 'text' });
      }
      say(box, { type: 'submit:step', run: m.run, step: 'submit' });
      const b = await until(() => { const x = L().footer(box.editor).submit; return x && L().enabled(x) && x; }, 15000);
      if (!b) return fail('submit');
      if (!here() || !L().may(s, 'submit') || L().listed(L().panelOf(box.editor), name, visible) <= 0) return fail('page');
      if (!await permit('commit') || !here() || !L().enabled(b) || b !== L().footer(box.editor).submit) return fail('page');
      submitted.add(box);
      pass(b);
      say(box, { type: 'submit:done', run: m.run, ok: true });
      return true;
    } catch (e) { console.error(e); return fail('page'); } finally { running = false; }
  };

  // features/writer.js hands over each submit:* message from a box's frame.
  const hear = (box, m, X, ok) => {
    if (!assignment(box)) return;
    if (m.type === 'submit:arm') armed.set(box, ok);
    else if (m.type === 'submit:saved') box.saved?.(m.ok === true);
    else if (m.type === 'submit:go' && armed.has(box)) go(box, m, ok);
  };
  return { hear };
})();

GZ_WRITER_SUBMIT;
