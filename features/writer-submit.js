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
// A file the student submits as is (writer-import.js) takes the same steps from 1, its own name, type and bytes unchanged.
// Ultra's own file area (enhance.writerUploads, on by default): one file dropped on it or chosen through its input goes to
// the paper's frame instead, before Ultra hears it (in the capture phase), which asks what to do with it; Ultra
// never starts that upload, so nothing of it needs undoing. More than one file, a file over 50 MB, Glaze's own attach and
// the setting off leave the area to Ultra.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_WRITER_SUBMIT = globalThis.GZ_WRITER_SUBMIT || (() => {
  const L = () => globalThis.GZ_WRITER_SUBMIT_LIB;
  const armed = new Map(); // box → whether it's still features/writer.js's
  const submitted = new WeakSet();
  const runs = new WeakMap(), cancelled = new WeakMap(), tokens = new WeakMap();
  const attached = new WeakMap(); // box → exact bytes and the row produced by this upload
  const written = new WeakSet();
  const imports = new WeakMap();
  let passing = null, running = false, active = null, down = null, giving = false, X = null;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, every = 100, valid = () => true) => { const end = Date.now() + ms; for (;;) { if (!valid()) return null; const v = fn(); if (v) return v; if (Date.now() >= end) return null; await pause(every); } };
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const say = (box, m) => { try { box.port?.postMessage(m); } catch { /* the frame went */ } };
  const assignment = (box) => box.kind === 'assignment' && box.mode === 'paper' && !document.querySelector('bb-attempt-canvas') &&
    globalThis.GZ_WRITER_ULTRA?.kindOf(box.editor, { path: location.pathname }) === 'assignment';
  const live = () => { for (const [box, ok] of armed) if (!ok() || !box.editor.isConnected || !box.ready || !box.frame?.isConnected || !box.port || !assignment(box)) armed.delete(box); return armed; };
  const visible = (e) => e.getClientRects().length > 0;

  // ---- Ultra's footer buttons, caught before Ultra
  const ownerOf = (b) => { for (const box of live().keys()) { const f = L().footer(box.editor); if (b && (f.submit === b || f.save === b)) return box; } return null; };
  const act = (box, b, e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (L().actionOf(b) === 'submit') { if (!running) { box.frame?.focus(); say(box, { type: 'submit:open' }); } return; }
    // Save and Close: one matching save acknowledgement, never a late reply or an earlier timer. After Writer's Submit
    // (Ultra's confirmation cancelled) it goes on the same way.
    if (running || box.saved) return;
    const go = e.type === 'click', request = crypto.randomUUID();
    box.saveRequest = request;
    const saved = (ok) => {
      if (box.saved !== saved) return;
      clearTimeout(timer);
      box.saved = null; box.saveRequest = null;
      const b = L().footer(box.editor).save;
      if (go && ok && live().has(box) && b?.isConnected && L().enabled(b)) pass(b);
    };
    box.saved = saved;
    const timer = setTimeout(() => saved(false), 4000);
    say(box, { type: 'submit:save', request });
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
    giving = true;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); } finally { giving = false; }
    return true;
  };
  const drop = (zone, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    giving = true;
    try { for (const type of ['dragenter', 'dragover', 'drop']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); } finally { giving = false; }
    return true;
  };
  const attach = async (box, file, bytes, here) => {
    const area = L().areaOf(box.editor), panel = L().panelOf(box.editor);
    if (!area || !panel) return 'page';
    const old = attached.get(box), data = new Uint8Array(bytes);
    if (old) {
      if (old.name !== file.name || old.bytes.length !== data.length || !old.bytes.every((b, i) => b === data[i])) return 'review';
      // Reuse only the same bytes and the very row the completed upload produced.
      const rows = L().listings(area, file.name, visible);
      return rows.length === 1 && rows[0] === old.row ? null : 'review';
    }
    if (L().listed(area, file.name, visible) || document.querySelector('[role="dialog"][aria-labelledby="file-properties-dialog-title"]')) return 'review';
    const input = L().uploadInput(area) || await until(() => L().uploadInput(area), 1500, 100, here);
    if (!here()) return 'page';
    const zone = !input && L().dropZone(area);
    if (!input && !zone) return 'upload';
    const before = new Set(L().listings(area, file.name, visible));
    attached.set(box, { name: file.name, bytes: data.slice(), before }); // before dispatch: an exception can still leave an upload running
    if (input) { if (!give(input, file)) return 'review'; }
    else drop(zone, file);
    const shown = await until(() => {
      // The probed dialog belongs to the editor's own upload, not this React area. Never save an unrelated modal.
      if (document.querySelector('[role="dialog"][aria-labelledby="file-properties-dialog-title"]')) return 'dialog';
      const rows = L().listings(area, file.name, visible);
      return rows.length === 1 && !before.has(rows[0]) && 'listed';
    }, 30000, 150, here);
    if (shown === 'listed') attached.get(box).row = L().listings(area, file.name, visible)[0];
    return !here() ? 'page' : shown === 'listed' ? null : shown === 'dialog' ? 'review' : 'attach';
  };
  const sameText = (box, d) => {
    const want = d.map((o) => o.insert).join('').split('\n').slice(0, -1).map(squash).join('\n');
    const have = [...box.editor.children].map((p) => squash(p.textContent)).join('\n');
    return have === want;
  };
  const write = (box, d) => {
    const said = main('set', { id: box.id, delta: d });
    return said.some((r) => r?.ok) && sameText(box, d) ? null : 'text';
  };
  const go = async (box, m, ok) => {
    const fail = (error) => { say(box, { type: 'submit:done', run: m.run, ok: false, error }); return false; };
    if (running || box.saved || submitted.has(box) || !Number.isSafeInteger(m.run) || m.run <= Math.max(runs.get(box) || 0, cancelled.get(box) || 0)) return fail('busy');
    runs.set(box, m.run);
    const name = m.name, bytes = m.bytes, key = m.key, asis = m.asis === true;
    if (!key || key !== L().paperKey(box.context?.paper) || !(asis ? L().asIsName(name) && typeof m.mime === 'string' && m.mime.length <= 200 : L().safeName(name)) || !(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength > 50e6 || typeof m.note !== 'string' || m.note.length > 4000 ||
      (m.text != null && (typeof m.text !== 'string' || m.text.length > 1e6)) || !Number.isFinite(m.until)) return fail('page');
    running = true;
    const user = box.context.paper.user, end = Math.min(m.until, Date.now() + 80e3);
    const transaction = active = { box, run: m.run, cancelled: false, frame: box.frame, port: box.port };
    const token = tokens.get(box) || crypto.randomUUID();
    tokens.set(box, token);
    const permit = async (op) => (await chrome.runtime.sendMessage({ type: 'glaze:writerSubmit', op, token, user }))?.ok === true;
    let claimed = false;
    try {
      const d = L().delta({ note: m.note, text: m.text || '' });
      if (!d && written.has(box)) return fail('review');
      let s = L().start({ text: !!d, asis });
      if (!asis) s = L().advance(L().advance(s, { step: 'save' }), { step: 'docx' });
      const here = () => L().paperKey(box.context?.paper) === key && !transaction.cancelled && box.ready && box.frame === transaction.frame && box.frame?.isConnected && box.port === transaction.port && ok() && armed.has(box) && assignment(box) && Date.now() < end;
      if (!here()) return fail('page');
      if (!await permit('claim')) return fail('claimed');
      claimed = true;
      if (!here()) return fail('page');
      say(box, { type: 'submit:step', run: m.run, step: 'attach' });
      const file = new File([bytes], name, { type: asis ? m.mime : L().MIME, lastModified: Date.now() });
      const a = await attach(box, file, bytes, here);
      if (a) return fail(a);
      s = L().advance(s, { step: 'attach' });
      if (!here()) return fail('page');
      if (d) {
        say(box, { type: 'submit:step', run: m.run, step: 'text' });
        written.add(box);
        const w = write(box, d);
        if (w) return fail(w);
        s = L().advance(s, { step: 'text' });
      }
      say(box, { type: 'submit:step', run: m.run, step: 'submit' });
      const b = await until(() => { const x = L().footer(box.editor).submit; return x && L().enabled(x) && x; }, 15000, 100, here);
      if (!b) return fail('submit');
      if (!here() || !L().may(s, 'submit') || L().listed(L().areaOf(box.editor), name, visible) !== 1) return fail('page');
      if (d && !sameText(box, d)) return fail('text');
      if (!await permit('commit') || !here() || !L().enabled(b) || b !== L().footer(box.editor).submit || !b.isConnected || L().listed(L().areaOf(box.editor), name, visible) !== 1 || (d && !sameText(box, d))) return fail('page');
      claimed = false;
      submitted.add(box);
      pass(b);
      say(box, { type: 'submit:done', run: m.run, ok: true });
      return true;
    } catch (e) { console.error(e); return fail('page'); } finally {
      running = false; if (active === transaction) active = null;
      // Nothing of this box ever reached Ultra's file area: a reload or a re-render may submit.
      if (claimed && !attached.has(box)) permit('release').catch(() => {});
    }
  };
  // The student has Blackboard's editor before them (the sheet's button): what a run left in the attempt is theirs to see.
  const review = (box) => {
    if (running) return;
    const token = tokens.get(box) || crypto.randomUUID();
    tokens.set(box, token);
    Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:writerSubmit', op: 'review', token, user: box.context?.paper?.user })).catch(() => {});
  };

  // ---- Ultra's own file area, caught before Ultra
  const catcher = (e) => {
    if (giving || !armed.size || !X?.settings?.().enhance?.writerUploads) return;
    const drop = e.type === 'drop', t = e.target;
    for (const box of live().keys()) {
      const area = L().areaOf(box.editor);
      const zone = L().dropZone(area);
      const hit = zone?.contains(t) && (drop || t === L().uploadInput(area));
      if (!hit) continue;
      const files = drop ? e.dataTransfer?.files : t.files;
      if (files?.length !== 1 || L().fileError(files[0])) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'input') return;
      const f = files[0];
      // Ultra's zone, which never hears the drop, lets go of its highlight.
      if (drop) { giving = true; try { t.dispatchEvent(new DragEvent('dragleave', { bubbles: true })); } finally { giving = false; } }
      else t.value = '';
      const request = { frame: box.frame, port: box.port };
      imports.set(box, request);
      f.arrayBuffer().then((bytes) => {
        if (!L().fileBytes(f, bytes) || imports.get(box) !== request || !live().has(box) || box.frame !== request.frame || box.port !== request.port || !X?.settings?.().enhance?.writerUploads) return;
        box.frame.focus(); say(box, { type: 'import:file', name: f.name, mime: f.type, bytes });
      }, () => {});
      return;
    }
  };
  for (const type of ['drop', 'input', 'change']) document.addEventListener(type, catcher, true);

  // features/writer.js hands over each submit:* message from a box's frame.
  const hear = (box, m, ctx, ok) => {
    X = ctx;
    if (m.type === 'submit:cancel' && Number.isSafeInteger(m.run) && m.run > 0) {
      cancelled.set(box, Math.max(cancelled.get(box) || 0, m.run));
      if (active?.box === box && active.run <= m.run) active.cancelled = true;
      return;
    }
    if (!assignment(box)) return;
    if (m.type === 'submit:arm') armed.set(box, ok);
    else if (m.type === 'submit:saved') m.request === box.saveRequest && box.saved?.(m.ok === true);
    else if (m.type === 'submit:go' && armed.has(box)) go(box, m, ok);
    else if (m.type === 'submit:review' && armed.has(box)) review(box);
  };
  return { hear };
})();

GZ_WRITER_SUBMIT;
