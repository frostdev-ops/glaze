// Draft backup (enhance.drafts), loaded on demand: content.js loads this (after lib/drafts.js) once an editor it backs
// up is on the page or written in, hands it what was written meanwhile, then every keydown, input and paste (write) and
// its passes (watch). Ultra's editors (Quill), and Canvas's plain-text Inbox compose.
// What you write is copied to storage.local a second after you stop, keyed by the site, who you are and the editor (on
// Ultra, the page too). The copy goes once what you wrote shows on the page outside an editor (the post went through),
// when you clear the editor, or after 14 days. When that editor turns up empty again (a reload, a crash, a timed-out
// session) a bar above it offers the copy back. Restoring types it in through the browser's own editing, so Quill and Ultra
// take it as your edit. A copy an earlier page kept is never written over by what you type now: it stays beside it
// (lib/drafts.js pack) until you restore it, dismiss it, or it posts, and is offered again when the editor is empty.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DRAFT_UI = globalThis.GZ_DRAFT_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, locale, capi, profile, canvasCourses, local } = ctx;
  const EDITOR = ctx.draftEditor; // Ultra's Quill editors, or Canvas's Inbox compose body
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
  const typed = new Map(); // key -> { ed, text, gone }: written here, watched until it posts
  const saveTimers = new Map(); // editor -> timer
  const ultraPending = new Map(); // editor -> input snapshot, before Ultra can reuse it
  let offered = new WeakMap(); // editor -> the destination offered
  const bars = new Map(); // bar -> editor
  // What is stored for an editor besides what this page wrote there: copies an earlier page kept (a crash, a timed-out
  // session), or this page's own once it stopped watching the editor. Read the first time the key is needed, and written back
  // beside every copy this page writes (store), so typing never replaces them: each stays until it is restored, dismissed or posted.
  const held = new Map(); // key -> [copy], newest first
  const reading = new Map(); // key -> [callback]: the read under way
  let epoch = 0; // clearing backup invalidates reads that may still arrive
  const deferred = new Set(); // editors with a held copy that wasn't offered because there was text: offered when they are empty
  const read = (key, fn) => {
    if (held.has(key)) { fn(); return; }
    if (reading.has(key)) { reading.get(key).push(fn); return; }
    reading.set(key, [fn]);
    const generation = epoch;
    // A Canvas copy is for the one destination its key names.
    local((s) => { try { s.get(key, (r) => {
      if (generation !== epoch) return;
      if (chrome.runtime?.lastError) { reading.delete(key); return; }
      held.set(key, GZ_DRAFTS.unpack(r?.[key]).filter((d) => ultra || GZ_DRAFTS.canvasKey(d.canvas) === key));
      const waiting = reading.get(key);
      reading.delete(key);
      for (const f of waiting) f();
    }); } catch { reading.delete(key); } });
  };
  // Writes what is kept for an editor: this page's own copy (typed) and the held ones beside it, or takes the key away when
  // there is nothing. Only once what is stored there has been read. ed: the editor, which offers the held ones when it is empty.
  const store = (key, ed) => read(key, () => {
    if (!ctx.settings().enhance.drafts || !ctx.on()) return;
    if (ed && held.get(key).length) deferred.add(ed);
    const rec = GZ_DRAFTS.pack(typed.get(key), held.get(key));
    local((s) => (rec ? s.set({ [key]: rec }) : s.remove(key)));
  });
  // A held copy that is done with: restored (it is the editor's text now), dismissed or posted. write: store what is left now.
  const resolve = (key, d, write = true) => read(key, () => {
    held.set(key, held.get(key).filter((c) => c.at !== d.at || c.text !== d.text));
    if (write) store(key);
  });
  // This page stops watching an editor it wrote in (it closed, or its post never showed): its copy stays, now like one an
  // earlier page kept.
  const release = (key) => {
    const d = typed.get(key);
    typed.delete(key);
    if (d) held.set(key, GZ_DRAFTS.unpack(GZ_DRAFTS.pack(d, held.get(key))));
  };
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
      // Stored now, as write() has read what is there already: an async read's callback can disappear during navigation.
      if (GZ_DRAFTS.worth(d.text)) typed.set(key, { ed, ...d, gone: 0 }); else typed.delete(key);
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
    typed.set(key, { ed, html: ultra ? ed.innerHTML : text, text, at: Date.now(), ...(!ultra && { canvas: inboxIdentity(ed) }), gone: 0 });
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
      if (!key || !GZ_DRAFTS.worth(s.text)) return;
      typed.set(key, { ed: s.ed, html: s.html, text: s.text, at: s.at, gone: 0 });
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
    if (!ed) {
      // Controlled inputs can change value without a DOM mutation, so destination edits also run the pass.
      if (!ultra && ctx.settings().enhance.drafts && ctx.on() && e.target.closest?.('#compose-message-modal')) watchInboxDrafts();
      return;
    }
    // A copy's key needs the account (who you are, and on Canvas your courses): what is written before it is in waits for it.
    if (!account) { accountWaiting.set(ed, ctx.draftAt(ed)); loadAccount(); return; }
    if (ultra) {
      const pending = ultraPending.get(ed);
      if (pending && keyOf(pending) !== draftKey(ed)) keep(pending);
      ultraPending.set(ed, ctx.draftAt(ed));
    }
    if (!ultra) {
      const key = draftKey(ed);
      inboxWrites.set(ed, key);
      captureInboxDraft(ed);
      if (key) read(key, () => {}); // so the copies kept there are known by the time this is saved
    }
    // A copy on offer steps aside while there is text, and is back when the editor is empty again.
    for (const [bar, editor] of bars) if (editor === ed) bar.hidden = !!draftText(ed).trim();
    clearTimeout(saveTimers.get(ed));
    saveTimers.set(ed, setTimeout(() => saveDraft(ed), 1000));
  };
  addEventListener('pagehide', () => { for (const [ed, t] of saveTimers) { clearTimeout(t); saveDraft(ed); } });
  // The page's text outside the editors being written in: where a post shows up once it's sent.
  // ponytail: walks the whole page, only while a draft's editor has just emptied or gone (a minute at most).
  const pageText = () => {
    const skip = `${EDITOR}, .ql-clipboard, .gz-draft`;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 3 ? 1 : n.matches(skip) ? 2 : 3) });
    let out = '';
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out += n.data;
    return out;
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
        local((s) => s.get(key, (r) => {
          if (chrome.runtime?.lastError) return;
          // Still kept (it may have been dismissed in another tab since).
          if (!GZ_DRAFTS.unpack(r?.[key]).some((c) => c.at === d.at && c.text === d.text)) { resolve(key, d, false); inboxWrites.delete(ed); return; }
          if (!ed.isConnected || draftKey(ed) !== key || draftText(ed).trim() || !ctx.settings().enhance.drafts || !ctx.on()) return;
          resolve(key, d, false); // it is the editor's text now, and kept as this page's own once typed in
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ed, d.text);
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.focus();
        }));
        return;
      }
      resolve(key, d, false);
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('insertHTML', false, d.html);
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
      for (const timer of saveTimers.values()) clearTimeout(timer);
      saveTimers.clear(); ultraPending.clear(); accountWaiting.clear(); reading.clear();
      typed.clear(); held.clear(); deferred.clear(); offered = new WeakMap();
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
  // typing, when it next is. Posted ones are dropped and the next is looked at; one is shown at a time.
  const offerDraft = (ed) => {
    const key = draftKey(ed);
    if (!key) return;
    const here = () => ctx.settings().enhance.drafts && ctx.on() && ed.isConnected && draftKey(ed) === key;
    read(key, async () => {
      const d = held.get(key)?.[0];
      if (!d || !here()) return;
      if (draftText(ed).trim()) { deferred.add(ed); return; }
      const posted = ultra ? GZ_DRAFTS.posted(d.text, pageText()) : await inboxPosted(d);
      if (posted) { resolve(key, d); offerDraft(ed); return; }
      if (here() && !draftText(ed).trim() && held.get(key)?.[0] === d && ![...bars.values()].includes(ed)) restoreBar(ed, key, d);
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
    for (const [key, d] of typed) {
      // Still being written in. An editor turned read-only shows the sent post, so it counts as gone.
      if (d.ed.isConnected && d.ed.matches(EDITOR) && d.ed.textContent.trim()) { d.gone = 0; continue; }
      d.gone ||= now;
      page ??= pageText();
      if (GZ_DRAFTS.posted(d.text, page)) { typed.delete(key); store(key, d.ed); }
      else if (now - d.gone > 60000) release(key); // never posted: the copy stays
    }
    // A bar steps aside while its editor has text (Ultra's own saved draft, or you're writing), and goes with it.
    for (const [bar, ed] of bars) {
      if (!bar.isConnected || !ed.isConnected || draftKey(ed) !== barKeys.get(bar)) { bar.remove(); bars.delete(bar); } else bar.hidden = !!ed.textContent.trim();
    }
    // An editor offers its copy once, after it has sat empty for a moment: Ultra may still be filling it. Its key needs who you are.
    if (!account) { if (document.querySelector(EDITOR)) loadAccount(); return; }
    for (const ed of document.querySelectorAll(EDITOR)) {
      const key = draftKey(ed);
      if (!key || offered.get(ed) === key) continue;
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
    if (ultra || !ctx.settings().enhance.drafts || !ctx.on() || !e.target.closest?.('#send-message-button')) return;
    const ed = document.querySelector(EDITOR);
    const key = ed && draftKey(ed);
    if (key) { inboxWrites.set(ed, key); captureInboxDraft(ed); saveDraft(ed); inboxSending.add(key); }
  }, true);
  return { write, watch, drop, take };
})();

GZ_DRAFT_UI;
