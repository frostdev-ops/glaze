// Draft backup (enhance.drafts), loaded on demand: content.js loads this (after lib/drafts.js) once an editor it backs
// up is on the page or written in, hands it what was written meanwhile, then every keydown, input and paste (write) and
// its passes (watch). Ultra's editors (Quill), and Canvas's plain-text Inbox compose.
// What you write is copied to storage.local a second after you stop, keyed by the site, who you are and the editor (on
// Ultra, the page too). The copy goes once you send it (a button named Post, Reply, Submit or Send, or Ctrl+Enter) and, still
// on that page, the editor closes or empties with all of what you wrote showing on the page more often than as you sent it
// (the post went through), when you clear the editor,
// or after 14 days. When that editor turns up empty again (a reload, a crash, a timed-out session) a bar above it offers
// the copy back. Restoring types it in through the browser's own editing, so Quill and Ultra take it as your edit. Each page's copy is its own (lib/drafts.js change, in the worker's queue): what you type
// replaces only this page's, so one an earlier page or another tab kept stays beside it until you restore it, dismiss it,
// or it posts, and is offered again when the editor is empty.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DRAFT_UI = globalThis.GZ_DRAFT_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, locale, capi, profile, canvasCourses, local } = ctx;
  const EDITOR = ctx.draftEditor; // Ultra's Quill editors, or Canvas's Inbox compose body
  const writer = (ed) => !!ed?.closest?.('[data-gz-writer]'); // Glaze Writer's (features/writer.js) until it's given back
  let account = null; // who you are: { user }, and on Canvas your courses, which its Inbox key names
  let accountLoading = false;
  let accountRetry = 0;
  let inboxWrites = new WeakMap();
  const inboxPending = new Map();
  const inboxSending = new Set();
  const barKeys = new WeakMap();
  const draftText = (ed) => ultra ? ed.textContent : ed.value;
  // Where a copy goes, from what content.js read off the editor (ctx.draftAt): now, or as it was written if it's gone.
  // Canvas: the exact course, recipients and subject, with the account.
  const identityOf = (s) => {
    const courses = account?.courses?.filter((c) => c.name === s.name) || [];
    const to = s.to.map((id) => GZ_DRAFTS.canvasRecipient(id));
    if (courses.length !== 1 || !to.length || to.some((id) => !id)) return null;
    const m = { origin: location.origin, user: account.user, course: String(courses[0].id), to, subject: s.subject };
    return GZ_DRAFTS.canvasKey(m) ? m : null;
  };
  const inboxIdentity = (ed) => identityOf(ctx.draftAt(ed));
  // Ultra: the site, who you are, the page, the nearest Blackboard id above the editor (a reply's post, say), and the editor's
  // own id; null until the account is known. A snapshot's own values only, never its elements (Ultra may reuse them for another post).
  const keyOf = (s) => (ultra ? GZ_DRAFTS.ultraKey({ origin: location.origin, user: account?.user, path: s.path, near: s.near, id: s.id }) : GZ_DRAFTS.canvasKey(identityOf(s)));
  const draftKey = (ed) => keyOf(ctx.draftAt(ed));
  const typed = new Map(); // key -> { ed, text, id, gone }: written here, watched until it posts
  const sending = new Map(); // key -> { text, n, at, away }: sent from here, with how often the page showed the text then
  const own = new Map(); // key -> the id of this page's copy there, until it is cleared, posts or is let go
  const ownId = (key) => own.get(key) || own.set(key, (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 20)).get(key);
  const versions = new Map(); // monotonic within a page, even when two edits share a millisecond
  const saveTimers = new Map(); // editor -> timer
  const ultraPending = new Map(); // editor -> input snapshot, before Ultra can reuse it
  let offered = new WeakMap(); // editor -> the destination offered
  const bars = new Map(); // bar -> editor
  // What is stored for an editor besides this page's own copy: copies an earlier page kept (a crash, a timed-out session),
  // another tab's, or this page's own once it stopped watching the editor. Read afresh when one may be offered, and told by
  // the worker after each change; each stays until it is restored, dismissed or posted.
  const held = new Map(); // key -> [copy], newest first
  const reading = new Map(); // key -> [callback]: the read under way
  let epoch = 0; // clearing backup invalidates reads and answers that may still arrive
  const deferred = new Set(); // editors with a held copy that wasn't offered because there was text: offered when they are empty
  const done = new Set(); // copies restored, dismissed or posted here: not offered again
  const dropping = new Map(); // key -> copies restored here, which go with this page's next copy there
  const tag = (c) => `${c.id || c.text}:${c.at}`;
  // A Canvas copy is for the one destination its key names.
  const known = (key, copies) => held.set(key, copies.filter((c) => !(c.id && c.id === own.get(key)) && !done.has(tag(c)) && (ultra || GZ_DRAFTS.canvasKey(c.canvas) === key)));
  const area = (s) => ({
    get: (key) => new Promise((yes, no) => { try { s.get(key, (r) => chrome.runtime.lastError ? no(Error('read')) : yes(r)); } catch (e) { no(e); } }),
    ...(s.getKeys && { keys: () => s.getKeys() }),
  });
  // If an update invalidates *all* extension APIs, a same-tab session journal survives reload. Clear it as soon as the
  // extension's durable local storage accepts it. It is scoped to this origin, account and destination, never sync storage.
  const session = (fn) => { try { return fn(sessionStorage); } catch { return undefined; } };
  const journal = (m, generation, ed, name = GZ_DRAFTS.pendingKey(m)) => {
    session((s) => {
      s.setItem(name, JSON.stringify(m));
      const all = {};
      for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(GZ_DRAFTS.pendingPrefix(m.key))) { try { all[k] = JSON.parse(s.getItem(k)); } catch {} } }
      for (const k of GZ_DRAFTS.superseded(m, all)) s.removeItem(k);
    });
    local((s) => s.set({ [name]: m }, () => {
      if (chrome.runtime.lastError) return;
      session((s) => s.removeItem(name));
      GZ_DRAFTS.load(m.key, area(s)).then((all) => { const old = GZ_DRAFTS.superseded(m, all); if (old.length) s.remove(old, () => void chrome.runtime.lastError); }, () => {});
      if (generation !== epoch || !ctx.settings().enhance.drafts) { s.remove(name); return; }
      tell(m, generation, ed);
    }));
  };
  const tell = (m, generation, ed) => {
    try { chrome.runtime.sendMessage({ type: 'glaze:drafts', ...m }, (r) => {
      if (chrome.runtime.lastError || generation !== epoch || !r?.ok) return;
      known(m.key, r.copies);
      if (ed && held.get(m.key).length) deferred.add(ed);
    }); } catch { /* the durable journal is enough to recover */ }
  };
  const read = (key, fn) => {
    if (reading.has(key)) { reading.get(key).push(fn); return; }
    reading.set(key, [fn]);
    const generation = epoch, pending = {};
    session((s) => {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (!k?.startsWith('draft:pending:')) continue;
        let m; try { m = JSON.parse(s.getItem(k)); } catch { continue; }
        if (m?.key === key) pending[k] = m;
      }
    });
    local((s) => GZ_DRAFTS.load(key, area(s)).then((all) => {
      if (generation !== epoch) return;
      known(key, GZ_DRAFTS.unpack(GZ_DRAFTS.fold(key, { ...all, ...pending })));
      for (const [k, m] of Object.entries(pending)) journal(m, generation, null, k);
      // Entries the worker never had (it slept, or the page closed first) are handed to it now, to fold into the record.
      if (!Object.keys(pending).length && Object.keys(all).some((k) => k !== key)) tell({ key, at: Date.now() }, generation);
      const waiting = reading.get(key);
      reading.delete(key);
      for (const f of waiting || []) f();
    }, () => { reading.delete(key); }));
  };
  const store = (key, ed) => {
    if (!ctx.settings().enhance.drafts || !ctx.on()) return;
    const d = typed.get(key), drop = dropping.get(key) || [];
    dropping.delete(key);
    if (!d && own.has(key)) { drop.push({ id: own.get(key), at: versions.get(key) }); own.delete(key); }
    if (d) { d.at = Math.max(d.at, (versions.get(key) || 0) + 1); versions.set(key, d.at); }
    const m = { key, at: Date.now(), ...(d && { put: { html: d.html, text: d.text, at: d.at, id: d.id, ...(d.canvas && { canvas: d.canvas }) } }), drop };
    journal(m, epoch, ed);
  };
  // A held copy that is done with: restored (it is the editor's text now), dismissed or posted. write: it goes now; else
  // with this page's next copy there, so it is kept until that is.
  const resolve = (key, d, write = true) => {
    done.add(tag(d));
    held.set(key, (held.get(key) || []).filter((c) => tag(c) !== tag(d)));
    dropping.set(key, [...(dropping.get(key) || []), GZ_DRAFTS.mark(d)]);
    if (write) store(key);
  };
  // This page stops watching an editor it wrote in (it closed, or its post never showed): its copy stays, now like one an
  // earlier page kept, and what is typed there next is a new copy beside it.
  const release = (key) => { typed.delete(key); own.delete(key); sending.delete(key); };
  // The modal can unmount before the debounce runs; retain the input's validated destination and body.
  const captureInboxDraft = (ed) => {
    const canvas = inboxIdentity(ed);
    const key = GZ_DRAFTS.canvasKey(canvas);
    if (!key) { inboxPending.delete(ed); return; }
    const d = { html: ed.value, text: ed.value, at: Date.now(), canvas };
    inboxPending.set(ed, { key, d });
  };
  const saveDraft = (ed) => {
    if (!ultra) {
      clearTimeout(saveTimers.get(ed));
      saveTimers.delete(ed);
      const pending = inboxPending.get(ed);
      inboxPending.delete(ed);
      if (!pending || !ctx.settings().enhance.drafts || !ctx.on()) return;
      const { key, d } = pending;
      if (ed.isConnected && draftKey(ed) !== key) return;
      if (typed.get(key)?.at > d.at) return;
      // Sent now: during navigation a later callback may never run.
      if (GZ_DRAFTS.worth(d.text)) typed.set(key, { ed, ...d, id: ownId(key), gone: 0 }); else typed.delete(key);
      store(key, ed);
      return;
    }
    saveTimers.delete(ed);
    const pending = ultraPending.get(ed);
    ultraPending.delete(ed);
    if (pending && (!ed.isConnected || keyOf(pending) !== draftKey(ed))) { keep(pending); return; }
    if (!ed.isConnected || !ctx.settings().enhance.drafts || (!ultra && !ctx.on())) return;
    const key = ultra ? draftKey(ed) : inboxWrites.get(ed);
    if (!key || key !== draftKey(ed)) return;
    const text = draftText(ed);
    // Too short, or cleared: drop the copy, but only one written here. A copy still on offer stays, with
    // or without new text beside it.
    if (!GZ_DRAFTS.worth(text)) { if (typed.delete(key)) store(key, ed); return; }
    typed.set(key, { ed, html: ultra ? ed.innerHTML : text, text, at: Date.now(), ...(!ultra && { canvas: inboxIdentity(ed) }), id: ownId(key), gone: 0 });
    store(key, ed);
  };
  // Who you are (and on Canvas your courses), asked once an editor is on the page or written in; again a minute after a
  // failure. An editor written in meanwhile is taken up once it is in, as if just written in; one gone by then is kept
  // from what was read as it was written.
  const accountWaiting = new Map(); // editor (or a snapshot of one gone) -> ctx.draftAt
  const loadAccount = () => {
    if (account || accountLoading || Date.now() < accountRetry) return;
    accountLoading = true;
    (ultra ? ctx.account().then((user) => ({ user: String(user) })) : Promise.all([profile(), canvasCourses()]).then(([user, courses]) => ({ user: String(user.id), courses }))).then((found) => {
      if (!(ultra ? /^_\d+_\d+$/ : /^\d+$/).test(found.user)) throw new Error('no account');
      account = found;
      const eds = [...accountWaiting];
      accountWaiting.clear();
      for (const [, at] of eds) take(at);
      watch(); // the offers that were waiting for it
    }).catch(() => { accountRetry = Date.now() + 60000; }).finally(() => { accountLoading = false; });
  };
  // An editor gone (compose closed, the page changed) before its copy could be made: the copy is made from what was read
  // as it was written, under the same rules.
  const keep = (s) => {
    if (!ctx.settings().enhance.drafts || !ctx.on()) return;
    if (!account) { accountWaiting.set(ultra ? s : s.ed, s); loadAccount(); return; }
    if (ultra) {
      const key = keyOf(s);
      if (!key || !GZ_DRAFTS.worth(s.text) || (typed.get(key)?.at || 0) > s.at) return;
      typed.set(key, { ed: s.ed, html: s.html, text: s.text, at: s.at, id: ownId(key), gone: 0 });
      store(key, s.ed);
      return;
    }
    const canvas = identityOf(s), key = GZ_DRAFTS.canvasKey(canvas);
    if (!key) return;
    inboxPending.set(s.ed, { key, d: { html: s.text, text: s.text, at: s.at, canvas } });
    saveDraft(s.ed);
  };
  // What was written while this file or the account loaded: taken up as just written if its editor is still there for
  // the same post (Ultra may reuse an editor and its wrapper for another), else kept from what was read then.
  const take = (s) => {
    const now = s.ed.isConnected && ctx.draftAt(s.ed);
    if (now && now.id === s.id && now.near === s.near && now.path === s.path) write({ type: 'input', target: s.ed }); else keep(s);
  };
  // keydown and input cover typing, undo and dictation; paste lands through Quill's own clipboard.
  const write = (e) => {
    if (!ultra && e.type !== 'input') return;
    const ed = ctx.settings().enhance.drafts && ctx.on() && e.target instanceof Element && e.target.closest(EDITOR);
    if (writer(ed)) return;
    if (!ed) {
      // Controlled inputs can change value without a DOM mutation, so destination edits also run the pass.
      if (!ultra && ctx.settings().enhance.drafts && ctx.on() && e.target.closest?.('#compose-message-modal')) watchInboxDrafts();
      return;
    }
    // A copy's key needs the account (who you are, and on Canvas your courses): what is written before it is in waits for it.
    if (!account) { accountWaiting.set(ed, ctx.draftAt(ed)); loadAccount(); return; }
    if (ultra && e.type === 'keydown' && e.isTrusted && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { send(ed); return; }
    if (ultra) {
      const pending = ultraPending.get(ed);
      if (pending && keyOf(pending) !== draftKey(ed)) keep(pending);
      ultraPending.set(ed, ctx.draftAt(ed));
    }
    if (!ultra) {
      const key = draftKey(ed);
      inboxWrites.set(ed, key);
      captureInboxDraft(ed);
    }
    // A copy on offer steps aside while there is text, and is back when the editor is empty again.
    for (const [bar, editor] of bars) if (editor === ed) bar.hidden = !!draftText(ed).trim();
    clearTimeout(saveTimers.get(ed));
    saveTimers.set(ed, setTimeout(() => saveDraft(ed), 1000));
  };
  addEventListener('pagehide', () => { for (const [ed, t] of saveTimers) { clearTimeout(t); saveDraft(ed); } });
  // The page's text outside the editors being written in: where a post shows up once it's sent. Not the editors this page
  // wrote in either, even turned read-only while Ultra sends: what they show is what was typed, sent or not.
  // ponytail: walks the whole page once as a draft is sent, then each pass while its editor is closed or emptied (a minute at most).
  const pageText = () => {
    const skip = `${EDITOR}, .ql-clipboard, .gz-draft`, mine = new Set([...typed.values()].map((d) => d.ed));
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 3 ? 1 : n.matches(skip) || mine.has(n) ? 2 : 3) });
    let out = '';
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out += n.data;
    return out;
  };
  // Where a send was made: the page, and the course or discussion ids Ultra keeps in its query or hash.
  const where = () => `${location.pathname}${`${location.search || ''}${location.hash || ''}`.match(/_\d+_\d+/g)?.join() || ''}`;
  // The student sends what an Ultra editor holds: it is kept as it is now, with how often the page shows it, once a send.
  const send = (ed) => {
    if (saveTimers.has(ed)) { clearTimeout(saveTimers.get(ed)); saveDraft(ed); }
    const key = draftKey(ed), d = key && typed.get(key);
    if (d) sending.set(key, { text: d.text, n: GZ_DRAFTS.count(d.text, pageText()), at: Date.now(), where: where() });
  };
  // Blackboard's labels for sending (en, de, es, fr, nl, pt-BR), and words that never send.
  const SEND = new Set('post reply submit send respond veröffentlichen posten antworten senden absenden abgeben einreichen publicar responder enviar publier répondre envoyer soumettre plaatsen beantwoorden reageren verzenden versturen indienen postar'.split(' '));
  const NOT = new Set('cancel discard close delete remove edit draft abbrechen verwerfen schließen löschen entfernen bearbeiten entwurf cancelar descartar cerrar eliminar borrar editar borrador annuler ignorer fermer supprimer modifier brouillon annuleren negeren sluiten verwijderen bewerken concept fechar excluir remover rascunho'.split(' '));
  // A control's name: aria-label, else its text, else its title.
  const words = (b) => ([b.getAttribute('aria-label'), b.textContent, b.matches('input') && b.value, b.getAttribute('title')].map((s) => (s || '').trim()).find(Boolean) || '').toLowerCase().split(/[^\p{L}\p{N}]+/u);
  // An editor's Post (Reply, Submit, Send) button: one that names sending, outside the editor and its toolbar, a few levels
  // from it; or a submit button in the editor's own form that names no other action.
  const sentFrom = (target) => {
    const b = target.closest?.('button, [role="button"], input[type="submit"]');
    if (!b || b.closest(`${EDITOR}, .ql-toolbar, [role="toolbar"], .gz-draft`)) return [];
    const w = words(b);
    if (w.some((x) => NOT.has(x))) return [];
    const eds = [...typed.values()].map((d) => d.ed).filter((ed) => ed.isConnected && ed.textContent.trim());
    const form = b.matches('[type="submit"]') && b.closest('form'), mine = form ? eds.filter((ed) => ed.closest('form') === form) : [];
    if (mine.length) return mine;
    if (!w.some((x) => SEND.has(x))) return [];
    for (let p = b.parentElement, i = 0; p && i < 8; p = p.parentElement, i++) {
      const near = eds.filter((ed) => p.contains(ed));
      if (near.length) return near;
    }
    return [];
  };
  const restoreBar = (ed, key, d) => {
    const bar = document.createElement('div');
    bar.className = 'gz-draft';
    bar.setAttribute('role', 'status');
    const msg = document.createElement('span');
    msg.textContent = t('Glaze kept a copy of what you wrote here ({when}).', { when: GZ_PAGE.describe(new Date(d.at), true, new Date(), locale()).rel });
    // type=button: Ultra's editors sit in forms, where a plain button would submit.
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => {
        if (!ed.isConnected || draftKey(ed) !== key || !ctx.settings().enhance.drafts || !ctx.on()) return;
        bar.remove(); bars.delete(bar); fn();
      });
      return b;
    };
    bar.append(msg, button(t('Restore'), () => {
      if (draftText(ed).trim()) return;
      if (!ultra) {
        if (draftKey(ed) !== key || draftText(ed).trim() || !ctx.settings().enhance.drafts || !ctx.on()) return;
        // React's controlled textarea reads the native setter + input, rather than a visible-only DOM edit.
        read(key, () => {
          if (!(held.get(key) || []).some((c) => tag(c) === tag(d))) { resolve(key, d, false); inboxWrites.delete(ed); return; }
          if (!ed.isConnected || draftKey(ed) !== key || draftText(ed).trim() || !ctx.settings().enhance.drafts || !ctx.on()) return;
          resolve(key, d, false);
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ed, d.text);
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.focus();
        });
        return;
      }
      resolve(key, d, false);
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('insertHTML', false, GZ_DRAFTS.restoreHTML(d, document));
    }), button(t('Dismiss'), () => { resolve(key, d); offerDraft(ed); }));
    (ed.closest('react-editor-wrapper') || ed.closest('.bb-editor-root') || ed.closest('[data-cid="TextArea"]') || ed).before(bar);
    bars.set(bar, ed);
    barKeys.set(bar, key);
  };
  // Glaze turned off: the bars go. The switch turned off: so does what is being watched.
  const drop = (all) => {
    for (const bar of bars.keys()) bar.remove();
    bars.clear();
    if (!ultra) {
      inboxWrites = new WeakMap();
      for (const ed of inboxPending.keys()) { clearTimeout(saveTimers.get(ed)); saveTimers.delete(ed); }
      inboxPending.clear();
    }
    if (all) {
      epoch++;
      session((s) => { for (let i = s.length - 1; i >= 0; i--) { const k = s.key(i); if (k?.startsWith('draft:pending:')) s.removeItem(k); } });
      for (const timer of saveTimers.values()) clearTimeout(timer);
      saveTimers.clear(); ultraPending.clear(); accountWaiting.clear(); reading.clear();
      typed.clear(); sending.clear(); own.clear(); held.clear(); deferred.clear(); done.clear(); dropping.clear(); offered = new WeakMap();
    }
  };
  const inboxPosted = async (d) => {
    // Only after Send/close or a recovery offer, never sweep-poll the inbox. Detail GET must not mark mail read.
    try {
      const list = await capi('/conversations?scope=sent&per_page=20');
      const c = list.find((c) => c.subject === d.canvas.subject && c.context_code === `course_${d.canvas.course}` && Date.parse(c.last_authored_message_at) >= d.at - 1000);
      return !!c && GZ_DRAFTS.sent(d, await capi(`/conversations/${c.id}?auto_mark_as_read=false`));
    } catch { return false; } // Offline or no exact match: keep the copy.
  };
  // The newest copy kept for this editor that isn't its own text: offered when the editor is empty, and if you were already
  // typing, when it next is. Canvas copies sent are dropped and the next is looked at; on Ultra the page's text alone never
  // says whose a post is, so the copy is offered and you can dismiss it. One is shown at a time.
  const offerDraft = (ed) => {
    const key = draftKey(ed);
    if (!key) return;
    const here = () => ctx.settings().enhance.drafts && ctx.on() && ed.isConnected && !writer(ed) && draftKey(ed) === key;
    read(key, async () => {
      const d = held.get(key)?.[0];
      if (!d || !here()) return;
      if (draftText(ed).trim()) { deferred.add(ed); return; }
      const posted = !ultra && await inboxPosted(d);
      if (posted) { resolve(key, d); offerDraft(ed); return; }
      const top = held.get(key)?.[0];
      if (here() && !draftText(ed).trim() && top && tag(top) === tag(d) && ![...bars.values()].includes(ed)) restoreBar(ed, key, d);
    });
  };
  // Editors with a copy waiting that were typed in when it would have been offered: offered once they are empty.
  const redeem = () => {
    for (const ed of deferred) {
      if (!ed.isConnected) deferred.delete(ed);
      else if (!draftText(ed).trim()) { deferred.delete(ed); setTimeout(() => offerDraft(ed), 800); }
    }
  };
  const watch = () => {
    // Canvas owns RCE recovery and assignment/quiz drafts. Only its plain-text new Inbox compose lacks it.
    if (!ultra) { watchInboxDrafts(); return; }
    if (!ctx.settings().enhance.drafts) return;
    const now = Date.now();
    let page = null;
    const here = where();
    for (const [key, d] of typed) {
      let s = sending.get(key);
      // Ultra moved to another page, course or discussion since the send: what shows here says nothing of it.
      if (s && s.where !== here) { sending.delete(key); s = null; }
      // Still being written in; back with its text after a send, that send failed and proves nothing.
      if (d.ed.isConnected && d.ed.matches(EDITOR) && d.ed.textContent.trim()) { if (s?.away) sending.delete(key); d.gone = 0; continue; }
      if (s) s.away = true;
      d.gone ||= now;
      // Posted: sent from here in the last minute, as it still reads, and the editor closed or emptied (one turned
      // read-only is still sending) with the text showing more often than as it was sent. The new post's discussion and
      // author would settle it, but no capture of Ultra's post markup says where to read them, so they aren't checked.
      if (s && now - s.at < 60000 && GZ_DRAFTS.squash(s.text) === GZ_DRAFTS.squash(d.text) && (!d.ed.isConnected || d.ed.matches(EDITOR))
        && GZ_DRAFTS.posted(d.text, page ??= pageText(), s.n)) { typed.delete(key); sending.delete(key); store(key, d.ed); }
      else if (now - d.gone > 60000) release(key); // never posted: the copy stays
    }
    // A bar steps aside while its editor has text (Ultra's own saved draft, or you're writing), and goes with it.
    for (const [bar, ed] of bars) {
      if (!bar.isConnected || !ed.isConnected || writer(ed) || draftKey(ed) !== barKeys.get(bar)) { bar.remove(); bars.delete(bar); } else bar.hidden = !!ed.textContent.trim();
    }
    // An editor offers its copy once, after it has sat empty for a moment: Ultra may still be filling it. Its key needs who you are.
    if (!account) { if (document.querySelector(EDITOR)) loadAccount(); return; }
    for (const ed of document.querySelectorAll(EDITOR)) {
      const key = draftKey(ed);
      if (!key || offered.get(ed) === key || writer(ed)) continue;
      read(key, () => {
        offered.set(ed, key);
        if (!ed.textContent.trim()) setTimeout(() => offerDraft(ed), 800);
      });
    }
    redeem();
  };
  const watchInboxDrafts = () => {
    if (!ctx.settings().enhance.drafts || !/^\/conversations\/?$/.test(location.pathname)) return;
    const ed = document.querySelector(EDITOR);
    if (ed) loadAccount();
    for (const ed of inboxPending.keys()) if (!ed.isConnected) saveDraft(ed);
    for (const [key, d] of typed) if (!d.ed.isConnected) {
      release(key);
      if (inboxSending.delete(key)) setTimeout(() => { if (ctx.on() && ctx.settings().enhance.drafts) inboxPosted(d).then((sent) => { if (sent) resolve(key, d); }); }, 1000);
    }
    for (const [bar, editor] of bars) {
      if (!bar.isConnected || !editor.isConnected || draftKey(editor) !== barKeys.get(bar)) { bar.remove(); bars.delete(bar); }
      else bar.hidden = !!draftText(editor).trim();
    }
    // Identity changes are common in compose: offer only after the exact course, recipients and subject return.
    const key = ed && draftKey(ed);
    if (key && !ed.value.trim() && ![...bars.values()].includes(ed) && inboxWrites.get(ed) !== key) {
      inboxWrites.set(ed, key);
      setTimeout(() => { if (draftKey(ed) === key) offerDraft(ed); }, 800);
    }
    redeem();
  };
  document.addEventListener('click', (e) => {
    if (ultra && e.isTrusted && ctx.settings().enhance.drafts && ctx.on()) for (const ed of sentFrom(e.target)) send(ed);
    if (ultra || !ctx.settings().enhance.drafts || !ctx.on() || !e.target.closest?.('#send-message-button')) return;
    const ed = document.querySelector(EDITOR);
    const key = ed && draftKey(ed);
    if (key) { inboxWrites.set(ed, key); captureInboxDraft(ed); saveDraft(ed); inboxSending.add(key); }
  }, true);
  return { write, watch, drop, take };
})();

GZ_DRAFT_UI;
