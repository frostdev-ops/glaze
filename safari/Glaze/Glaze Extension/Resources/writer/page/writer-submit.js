// Glaze Writer's submit, the page's side (loaded on demand by writer/page/writer.js for a paper's frame). While a paper owns
// an assignment attempt, Ultra's own Submit opens Writer's submit sheet instead (in the capture phase, before Ultra's
// React hears it; a disabled one too, since Ultra disables it while its own box is empty), and its Save and Close first
// saves the paper. Save and Close attaches nothing: a draft file would sit in Ultra's attempt and a later Submit would add
// a second copy; the paper is kept in Writer's storage, so Ultra's Save and Close goes on once that save is done.
// On the sheet's Submit (the student's click; the frame has already saved a 'sending' version and built the .docx):
//   1. attach: a File on the file area's own input (DataTransfer, then bubbling input and change, which React hears at
//      its root), or dropped on its drop zone when the input isn't drawn; never a click on a file input (the OS picker);
//   2. wait, bounded, until Ultra lists the file in the panel;
//   3. Ultra's Quill through writer/writer-main.js (gz-writer:set), checked: what it held if the student kept it (the sheet
//      showed it: submit:held), then the note and the paper's text; else just those, or emptied;
//   4. once Ultra's Submit is enabled, one click on it. Ultra's confirmation is Ultra's.
// Any failure stops before Submit and tells the sheet why; nothing is retried by itself. A test is never touched.
// The worker's permit for the assignment (background/background.js) is claimed before 1, released by a run that attached nothing,
// and the dispatch recorded in the click's own turn, with the paper's version marked Submitted; the sheet's Blackboard
// editor clears an uncertain upload's (review).
// A file the student submits as is (writer-import.js) takes the same steps from 1, its own name, type and bytes unchanged.
// The documents attached from Documents (the sheet's Attach from Documents) go in 1 too, each through handIn after the
// attempt's own file, Submit waiting until Ultra lists every one; the compact box's sheet sends them alone, Ultra's text
// box kept as the paper left it and the note added after it.
// Ultra's own file area (enhance.writerUploads, on by default): one file dropped on it or chosen through its input goes to
// the paper's frame instead, before Ultra hears it (in the capture phase), which asks what to do with it; Ultra
// never starts that upload, so nothing of it needs undoing. More than one file, a file over 50 MB, Glaze's own attach and
// the setting off leave the area to Ultra. A paper in its compact box (writer/page/writer.js box.full false) sends text: its
// Submit and Save and Close stay Ultra's, and its file area gives Writer a Word file (Open in Writer or Submit as is), and a
// PDF or deck while its Settings → Writer switch is on (Open in Glaze or Submit as is).
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_WRITER_SUBMIT = globalThis.GZ_WRITER_SUBMIT || (() => {
  const L = () => globalThis.GZ_WRITER_SUBMIT_LIB;
  const armed = new Map(); // box → whether it's still writer/page/writer.js's
  const submitted = new WeakSet();
  const runs = new WeakMap(), cancelled = new WeakMap(), tokens = new WeakMap();
  const attached = new WeakMap(); // box → each file's name → its byte digest and the row its upload produced
  const appended = new WeakMap(); // the exact note and complete native text after an append, for a safe retry
  const written = new WeakSet(); // boxes a run has written into
  const imports = new WeakMap();
  let passing = null, running = false, active = null, down = null, giving = false, X = null;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, every = 100, valid = () => true) => { const end = Date.now() + ms; for (;;) { if (!valid()) return null; const v = fn(); if (v) return v; if (Date.now() >= end) return null; await pause(every); } };
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const say = (box, m) => { try { box.port?.postMessage(m); } catch { /* the frame went */ } };
  const assignment = (box) => box.kind === 'assignment' && box.mode === 'paper' && !document.querySelector('bb-attempt-canvas') &&
    globalThis.GZ_WRITER_ULTRA?.kindOf(box.editor, { path: location.pathname }) === 'assignment';
  // A box stays armed while its frame reopens (writer/page/writer.js reopen: Ultra's Submit then waits; the new frame, once
  // up, hears submit:open on its port), and goes when the frame does for good. Ultra's file area goes to a ready frame only.
  const live = () => { for (const [box, ok] of armed) if (!ok() || !box.editor.isConnected || !(box.reopening || (box.frame?.isConnected && box.port)) || !assignment(box)) armed.delete(box); return armed; };
  const mounted = () => [...live().keys()].filter((box) => box.ready && box.frame?.isConnected && box.port);
  const visible = (e) => e.getClientRects().length > 0;

  // ---- Ultra's footer buttons, caught before Ultra
  const ownerOf = (b) => { for (const box of live().keys()) { if (!box.full) continue; const f = L().footer(box.editor); if (b && (f.submit === b || f.save === b)) return box; } return null; };
  // Ultra's Submit opens the sheet, and its Save and Close saves the paper first, as soon as there is a frame up to ask
  // (it reopens: writer/page/writer.js box.ready), Ultra's button marked busy until then. The save takes as long as it takes,
  // the paper's title bar saying Saving… (the frame gives up with a word after a while, writer-submit.js); a frame that
  // reopened before answering is asked again; once saved, Ultra's own Save and Close, found again (Ultra may have drawn
  // its footer anew), goes on once. A box no longer Writer's lets go: Ultra's editor is there to press again.
  const busy = (b, on) => { if (!b) return; if (on) { b.setAttribute('aria-busy', 'true'); b.style.setProperty('cursor', 'progress'); } else { b.removeAttribute('aria-busy'); b.style.removeProperty('cursor'); } };
  const act = (box, b, e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (box.saved && Date.now() - box.saved.at >= SAVE_LOST) box.saved(false);
    if (running || box.opening || box.saved) return;
    let marked = b;
    const mark = () => {
      const x = L().footer(box.editor)[L().actionOf(b)];
      if (marked !== x) { busy(marked, false); marked = x; }
      busy(marked, true);
    };
    if (L().actionOf(b) === 'submit') {
      const opening = box.opening = {};
      const at = Date.now();
      const open = () => {
        if (box.opening !== opening) return;
        if (!live().has(box) || Date.now() - at >= SAVE_LOST) { box.opening = null; busy(marked, false); return; }
        mark();
        if (!box.ready || !box.port) { setTimeout(open, 100); return; }
        box.opening = null; busy(marked, false);
        box.frame?.focus(); say(box, { type: 'submit:open' });
      };
      busy(b, true);
      open();
      return;
    }
    // Save and Close: one matching save acknowledgement, never a late reply. After Writer's Submit (Ultra's confirmation
    // cancelled) it goes on the same way. One that waited past what the frame waits for its save has been lost (its frame
    // went quiet): a press asks anew.
    const go = e.type === 'click', request = crypto.randomUUID();
    let asked = null;
    box.saveRequest = request;
    const saved = (ok) => {
      if (box.saved !== saved) return;
      box.saved = null; box.saveRequest = null;
      busy(marked, false);
      const x = L().footer(box.editor).save;
      if (go && ok && Date.now() - saved.at < SAVE_LOST && live().has(box) && x?.isConnected && L().enabled(x)) pass(x);
    };
    saved.at = Date.now();
    box.saved = saved;
    const ask = () => {
      if (box.saved !== saved) return;
      if (!live().has(box) || Date.now() - saved.at >= SAVE_LOST) { saved(false); return; }
      mark();
      if (box.ready && box.port && box.port !== asked) { asked = box.port; saved.at = Date.now(); say(box, { type: 'submit:save', request }); }
      if (box.saved === saved) setTimeout(ask, 100);
    };
    busy(b, true);
    ask();
  };
  const SAVE_LOST = 50000; // the frame waits 15 s at most for its paper, then 30 s for the save
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
      if (!box.full) continue;
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
  // writer/writer-main.js in the page's world; its answers arrive inside the dispatch.
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
    if (!here()) return 'page';
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((n) => n.toString(16).padStart(2, '0')).join('');
    if (!here()) return 'page';
    const old = attached.get(box)?.get(file.name);
    if (old) {
      if (old.name !== file.name || old.size !== data.byteLength || old.hash !== hash || old.mime !== file.type) return 'review';
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
    if (!attached.has(box)) attached.set(box, new Map());
    const entry = { name: file.name, size: data.byteLength, mime: file.type, hash, before };
    attached.get(box).set(file.name, entry); // before dispatch: an exception can still leave an upload running
    try {
      if (input) { if (!give(input, file)) return 'review'; }
      else drop(zone, file);
    } catch { return 'review'; }
    const shown = await until(() => {
      // The probed dialog belongs to the editor's own upload, not this React area. Never save an unrelated modal.
      if (document.querySelector('[role="dialog"][aria-labelledby="file-properties-dialog-title"]')) return 'dialog';
      const rows = L().listings(area, file.name, visible);
      return rows.length === 1 && !before.has(rows[0]) && 'listed';
    }, 30000, 150, here);
    if (shown === 'listed') entry.row = L().listings(area, file.name, visible)[0];
    return !here() ? 'page' : shown === 'listed' ? null : shown === 'dialog' ? 'review' : 'attach';
  };
  // One file from any source; byte views use only their byteOffset/byteLength. Never reject the promise for bad input.
  // → null, large, file, page (here revoked), upload, attach, or review (an upload may already be in Ultra).
  const handIn = async (box, f, here = () => true) => {
    let data, file;
    try {
      const why = L().handInError(f);
      if (why) return why;
      if (typeof here !== 'function' || !here()) return 'page';
      data = f.bytes instanceof ArrayBuffer ? new Uint8Array(f.bytes) : new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength);
      file = new File([data], f.name, { type: f.mime, lastModified: Date.now() });
    } catch { return 'file'; }
    try { return await attach(box, file, data, here); } catch { return 'page'; }
  };
  const sameText = (box, d) => {
    const want = d.map((o) => o.insert).join('').split('\n').slice(0, -1).map(squash).join('\n');
    const have = [...box.editor.children].map((p) => squash(p.textContent)).join('\n');
    return have === want;
  };
  // What Ultra's own text box holds, line by line (a list's items each on its own), as the sheet shows it.
  const heldOf = (box) => L().lines([...box.editor.children].flatMap((c) => (/^(OL|UL)$/.test(c.tagName) ? [...c.children] : [c]).map((x) => x.textContent)).join('\n')).join('\n');
  const flat = (t) => L().lines(t).map(squash).join('\n');
  // The compact box's sheet: the note after what Ultra's box holds, the box otherwise as the paper left it.
  const add = (box, note) => {
    const old = appended.get(box);
    if (old) return old.note === note && old.after != null && flat(heldOf(box)) === flat(old.after) ? null : 'review';
    const entry = { note, after: null }, held = heldOf(box);
    appended.set(box, entry);
    const said = main('append', { id: box.id, text: L().lines(note).join('\n') });
    const after = heldOf(box), want = L().lines([held, note].filter(Boolean).join('\n\n')).join('\n');
    if (!said.some((r) => r?.ok) || flat(after) !== flat(want)) return 'text';
    entry.after = after;
    return null;
  };
  const write = (box, d) => {
    const said = main('set', { id: box.id, delta: d });
    return said.some((r) => r?.ok) && sameText(box, d) ? null : 'text';
  };
  const go = async (box, m, ok) => {
    let file = null;
    const fail = (error) => { say(box, { type: 'submit:done', run: m.run, ok: false, error, file, retained: [...(attached.get(box)?.keys() || [])] }); return false; };
    if (running || box.saved || submitted.has(box) || !Number.isSafeInteger(m.run) || m.run <= Math.max(runs.get(box) || 0, cancelled.get(box) || 0)) return fail('busy');
    runs.set(box, m.run);
    // kind: what the frame built (a paper's .docx, a PDF as saved, a deck as brought: writer-kinds.js), named for it.
    const name = m.name, key = m.key, asis = m.asis === true, kind = typeof m.kind === 'string' ? m.kind : 'paper';
    // files: a manifest ({ name, mime, size }, stream) requested one at a time, or legacy byte payloads; names unique.
    // alone (no name, no bytes) only
    // from the compact box's sheet, which adds the note after Ultra's text (append).
    let bytes = m.bytes;
    const files = Array.isArray(m.files) ? m.files : [], stream = m.stream === true, alone = name == null && bytes == null, append = alone && m.append === true;
    const fileError = (f) => stream ? (!f || !L().asIsName(f.name) || typeof f.mime !== 'string' || f.mime.length > 200 || !Number.isSafeInteger(f.size) || f.size <= 0 ? 'file' : f.size > L().MAX_FILE ? 'large' : null) : L().handInError(f) || (!(f.bytes instanceof ArrayBuffer) ? 'file' : null);
    const names = [...(alone ? [] : [name]), ...files.map((f) => f?.name)].map((n) => String(n).toLowerCase());
    if (files.length > L().MAX_ATTACH || files.some(fileError) || new Set(names).size !== names.length || (alone && (!files.length || !append))) return fail(files.some((f) => fileError(f) === 'large') ? 'large' : 'page');
    if (!key || key !== L().paperKey(box.context?.paper) || !(alone || ((asis ? L().asIsName(name) && typeof m.mime === 'string' && m.mime.length <= 200 : L().safeName(name, kind)) && bytes instanceof ArrayBuffer && bytes.byteLength && bytes.byteLength <= 50e6)) || typeof m.note !== 'string' || m.note.length > L().MAX_NOTE ||
      (m.text != null && (typeof m.text !== 'string' || m.text.length > 1e6)) || (m.held != null && (typeof m.held !== 'string' || m.held.length > 1e6)) || !Number.isFinite(m.until)) return fail('page');
    running = true;
    // Each attached file has a minute more for its upload to be listed.
    const user = box.context.paper.user, end = Math.min(m.until, Date.now() + 80e3 + 60e3 * files.length);
    const transaction = active = { box, run: m.run, cancelled: false, frame: box.frame, port: box.port };
    const token = tokens.get(box) || crypto.randomUUID();
    tokens.set(box, token);
    const version = typeof m.version === 'string' && /^[a-z0-9-]{3,40}$/.test(m.version) ? m.version : null;
    const permit = async (op) => (await chrome.runtime.sendMessage({ type: 'glaze:writerSubmit', op, token, user, ...(op === 'commit' && version && { version }) }))?.ok === true;
    let claimed = false;
    try {
      // Ultra's text box goes as the sheet says: kept as it showed it (Keep), the note and text after it; else replaced by
      // them, or emptied. A run's own earlier write the sheet didn't show needs review.
      const held = heldOf(box), shown = flat(m.held ?? '') === flat(held), keep = m.keep === true && !!held, extra = L().delta({ note: m.note, text: m.text || '' });
      if (!append && keep && !shown) return fail('page');
      if (!append && !extra && !keep && written.has(box) && !shown) return fail('review');
      const d = append ? null : keep && !extra ? null : L().delta({ kept: keep ? held : '', note: m.note, text: m.text || '' }) || (held ? [{ insert: '\n' }] : null);
      const note = append && L().lines(m.note).length ? m.note : '';
      let s = L().start({ text: !!d || !!note, asis });
      if (!asis) s = L().advance(L().advance(s, { step: 'save' }), { step: 'build' });
      const here = () => L().paperKey(box.context?.paper) === key && !transaction.cancelled && box.ready && box.frame === transaction.frame && box.frame?.isConnected && box.port === transaction.port && ok() && armed.has(box) && assignment(box) && Date.now() < end;
      if (!here()) return fail('page');
      if (!await permit('claim')) return fail('claimed');
      claimed = true;
      if (!here()) return fail('page');
      // A file an earlier run left in Ultra that this one doesn't send is the student's to review.
      if ([...(attached.get(box)?.keys() || [])].some((n) => !names.includes(n.toLowerCase()))) return fail('review');
      say(box, { type: 'submit:step', run: m.run, step: 'attach' });
      const request = async (index) => {
        const pending = transaction.pending = { index, reply: null };
        say(box, { type: 'submit:file', run: m.run, index });
        const reply = await until(() => pending.reply, 30000, 100, here);
        transaction.pending = null;
        return reply || { ok: false, error: 'page' };
      };
      if (!alone) {
        file = name;
        const a = await handIn(box, { name, mime: asis ? m.mime : L().mimeOf(name), bytes }, here);
        bytes = null; m.bytes = null;
        if (a) return fail(a);
      }
      for (let i = 0; i < files.length; i++) {
        const f = files[i]; file = f.name;
        let reply = stream ? await request(i) : { ok: true, bytes: f.bytes };
        if (!reply.ok) return fail(reply.error === 'changed' ? 'changed' : 'file');
        if (stream && (!(reply.bytes instanceof ArrayBuffer) || reply.bytes.byteLength !== f.size)) return fail('file');
        const a = await handIn(box, { name: f.name, mime: f.mime, bytes: reply.bytes }, here);
        reply = null;
        if (!stream) f.bytes = null;
        if (a) return fail(a);
      }
      file = null;
      s = L().advance(s, { step: 'attach' });
      if (!here()) return fail('page');
      if (d || note) {
        say(box, { type: 'submit:step', run: m.run, step: 'text' });
        written.add(box);
        const w = note ? add(box, note) : write(box, d);
        if (w) return fail(w);
        s = L().advance(s, { step: 'text' });
      }
      say(box, { type: 'submit:step', run: m.run, step: 'submit' });
      const b = await until(() => { const x = L().footer(box.editor).submit; return x && L().enabled(x) && x; }, 15000, 100, here);
      if (!b) return fail('submit');
      if (stream) {
        const r = await request(files.length);
        if (!r.ok) { file = r.file || null; return fail(r.error === 'changed' ? 'changed' : 'page'); }
      }
      const area = L().areaOf(box.editor);
      file = [...(alone ? [] : [name]), ...files.map((f) => f.name)].find((n) => { const rows = L().listings(area, n, visible); return rows.length !== 1 || rows[0] !== attached.get(box)?.get(n)?.row; }) || null;
      if (file) return fail('review');
      if (!here() || !L().may(s, 'submit') || !L().enabled(b) || b !== L().footer(box.editor).submit || !b.isConnected) return fail('page');
      if (note ? flat(heldOf(box)) !== flat(appended.get(box)?.after) : d ? !sameText(box, d) : flat(heldOf(box)) !== flat(held)) return fail('text');
      // The worker records the dispatch in the click's own turn: nothing can fail between them, and a page Ultra's
      // navigation tears down after the click has already sent it.
      claimed = false;
      permit('commit').catch(() => {});
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
    for (const box of mounted()) {
      const area = L().areaOf(box.editor);
      const zone = L().dropZone(area);
      const hit = zone?.contains(t) && (drop || t === L().uploadInput(area));
      if (!hit) continue;
      const files = drop ? e.dataTransfer?.files : t.files;
      if (files?.length !== 1 || L().fileError(files[0]) || (!box.full && L().route(files[0].name, { kinds: L().switched(X.settings().writer) }) !== 'choose')) return;
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
        if (!L().fileBytes(f, bytes) || imports.get(box) !== request || !mounted().includes(box) || box.frame !== request.frame || box.port !== request.port || !X?.settings?.().enhance?.writerUploads) return;
        box.frame.focus(); say(box, { type: 'import:file', name: f.name, mime: f.type, bytes });
      }, () => {});
      return;
    }
  };
  for (const type of ['drop', 'input', 'change']) document.addEventListener(type, catcher, true);

  // writer/page/writer.js hands over each submit:* message from a box's frame.
  const hear = (box, m, ctx, ok) => {
    X = ctx;
    if (m.type === 'submit:cancel' && Number.isSafeInteger(m.run) && m.run > 0) {
      cancelled.set(box, Math.max(cancelled.get(box) || 0, m.run));
      if (active?.box === box && active.run <= m.run) active.cancelled = true;
      return;
    }
    if (m.type === 'submit:file') {
      const p = active?.box === box && active.run === m.run && active.pending;
      if (p && p.index === m.index && !p.reply) p.reply = m;
      return;
    }
    if (!assignment(box)) return;
    if (m.type === 'submit:arm') armed.set(box, ok);
    else if (m.type === 'submit:saved') m.request === box.saveRequest && box.saved?.(m.ok === true);
    else if (m.type === 'submit:go' && armed.has(box)) go(box, m, ok);
    else if (m.type === 'submit:held' && armed.has(box)) say(box, { type: 'submit:held', text: heldOf(box).slice(0, 1e6) });
    else if (m.type === 'submit:review' && armed.has(box)) review(box);
  };
  // armed(box): this step has the box's Ultra buttons (writer/page/writer.js holds a press until it does).
  const press = (box, b, type = 'click') => { if (live().has(box) && box.full && ownerOf(b) === box) act(box, b, { type, preventDefault() {}, stopImmediatePropagation() {} }); };
  return { hear, press, handIn, passing: (button) => button === passing, armed: (box) => live().has(box) };
})();

GZ_WRITER_SUBMIT;
