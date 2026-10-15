// Draft backup (enhance.drafts), loaded on demand: content.js loads this (after lib/drafts.js) once an editor it backs
// up is on the page or written in, hands it what was written meanwhile, then every keydown, input and paste (write) and
// its passes (watch). Ultra's editors (Quill), and Canvas's plain-text Inbox compose.
// What you write is copied to storage.local a second after you stop, keyed by the page and the editor. The copy goes
// once what you wrote shows on the page outside an editor (the post went through), when you clear the editor, or after
// 14 days. When that editor turns up empty again (a reload, a crash, a timed-out session) a bar above it offers the copy
// back. Restoring types it in through the browser's own editing, so Quill and Ultra take it as your edit.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_DRAFT_UI = globalThis.GZ_DRAFT_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { t, locale, capi, profile, canvasCourses, local } = ctx;
  const EDITOR = ctx.draftEditor; // Ultra's Quill editors, or Canvas's Inbox compose body
  const BBID = /_\d+_\d+/;
  let inboxAccount = null;
  let inboxLoading = false;
  let inboxRetry = 0;
  let inboxWrites = new WeakMap();
  const inboxPending = new Map();
  const inboxSending = new Set();
  const barKeys = new WeakMap();
  const draftText = (ed) => ultra ? ed.textContent : ed.value;
  const inboxIdentity = (ed) => {
    const modal = ed.closest('#compose-message-modal');
    const subject = modal?.querySelector('input[data-testid="subject-input"]')?.value;
    const name = modal?.querySelector('input[data-testid="course-select-modal"]')?.value;
    const courses = inboxAccount?.courses.filter((c) => c.name === name) || [];
    const tags = [...(modal?.querySelectorAll('[data-testid="address-book-tag"]') || [])];
    const to = tags.map((tag) => GZ_DRAFTS.canvasRecipient(tag.id));
    if (courses.length !== 1 || !tags.length || to.some((id) => !id)) return null;
    const m = { origin: location.origin, user: inboxAccount.user, course: String(courses[0].id), to, subject };
    return GZ_DRAFTS.canvasKey(m) ? m : null;
  };
  // The nearest Blackboard id above the editor (a reply's post, say), and the editor's own id.
  const draftKey = (ed) => {
    if (!ultra) return GZ_DRAFTS.canvasKey(inboxIdentity(ed));
    let near = '';
    for (let p = ed.parentElement, i = 0; p && !near && i < 15; p = p.parentElement, i++) {
      for (const a of p.attributes) if ((a.name === 'id' || a.name.startsWith('data-')) && BBID.test(a.value)) { near = a.value.match(BBID)[0]; break; }
    }
    return `draft:${location.pathname}#${near}/${ed.id}`;
  };
  const typed = new Map(); // key -> { ed, text, gone }: written here, watched until it posts
  const saveTimers = new Map(); // editor -> timer
  const offered = new WeakSet();
  const bars = new Map(); // bar -> editor
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
      // Issue the storage request now: an async read's callback can disappear during navigation.
      if (!GZ_DRAFTS.worth(d.text)) { typed.delete(key); local((s) => s.remove(key)); }
      else { typed.set(key, { ed, ...d, gone: 0 }); local((s) => s.set({ [key]: d })); }
      return;
    }
    saveTimers.delete(ed);
    if (!ed.isConnected || !ctx.settings().enhance.drafts || (!ultra && !ctx.on())) return;
    const key = ultra ? draftKey(ed) : inboxWrites.get(ed);
    if (!key || key !== draftKey(ed)) return;
    const text = draftText(ed);
    // Too short, or cleared: drop the copy, but only one written here. A copy still on offer stays
    // until something worth keeping replaces it.
    if (!GZ_DRAFTS.worth(text)) { if (typed.delete(key) || !ultra) local((s) => s.remove(key)); return; }
    const d = { html: ultra ? ed.innerHTML : text, text, at: Date.now(), ...(!ultra && { canvas: inboxIdentity(ed) }) };
    typed.set(key, { ed, ...d, gone: 0 });
    local((s) => s.set({ [key]: d }));
  };
  // Canvas: who you are and your courses, asked once the compose dialog is there or written in; again a minute after a
  // failure. An editor written in meanwhile is taken up once it is in, as if just written in.
  const accountWaiting = new Set();
  const loadAccount = () => {
    if (inboxAccount || inboxLoading || Date.now() < inboxRetry) return;
    inboxLoading = true;
    Promise.all([profile(), canvasCourses()]).then(([user, courses]) => {
      inboxAccount = { user: String(user.id), courses };
      const eds = [...accountWaiting];
      accountWaiting.clear();
      for (const ed of eds) if (ed.isConnected) write({ type: 'input', target: ed });
    }).catch(() => { inboxRetry = Date.now() + 60000; }).finally(() => { inboxLoading = false; });
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
    if (!ultra) {
      // A copy's key needs the account (who you are, your courses): what is written before it is in waits for it.
      if (!inboxAccount) { accountWaiting.add(ed); loadAccount(); return; }
      inboxWrites.set(ed, draftKey(ed));
      captureInboxDraft(ed);
      for (const [bar, editor] of bars) if (editor === ed) { bar.remove(); bars.delete(bar); }
    }
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
      b.addEventListener('click', () => { bar.remove(); fn(); });
      return b;
    };
    bar.append(msg, button(t('Restore'), () => {
      if (!ultra) {
        if (draftKey(ed) !== key || draftText(ed).trim() || !ctx.settings().enhance.drafts || !ctx.on()) return;
        // React's controlled textarea reads the native setter + input, rather than a visible-only DOM edit.
        local((s) => s.get(key, (r) => {
          if (r?.[key]?.at !== d.at || r[key].text !== d.text) { inboxWrites.delete(ed); return; }
          if (!ed.isConnected || draftKey(ed) !== key || draftText(ed).trim() || !ctx.settings().enhance.drafts || !ctx.on()) return;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ed, d.text);
          ed.dispatchEvent(new Event('input', { bubbles: true }));
          ed.focus();
        }));
        return;
      }
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('insertHTML', false, d.html);
    }), button(t('Dismiss'), () => ultra ? local((s) => s.remove(key)) : forgetInboxDraft(key, d)));
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
    if (all) typed.clear();
  };
  const forgetInboxDraft = (key, d) => local((s) => s.get(key, (r) => { if (r?.[key]?.at === d.at && r[key].text === d.text) s.remove(key); }));
  const inboxPosted = async (d) => {
    // Only after Send/close or a recovery offer, never sweep-poll the inbox. Detail GET must not mark mail read.
    try {
      const list = await capi('/conversations?scope=sent&per_page=20');
      const c = list.find((c) => c.subject === d.canvas.subject && c.context_code === `course_${d.canvas.course}` && Date.parse(c.last_authored_message_at) >= d.at - 1000);
      return !!c && GZ_DRAFTS.sent(d, await capi(`/conversations/${c.id}?auto_mark_as_read=false`));
    } catch { return false; } // Offline or no exact match: keep the copy.
  };
  const offerDraft = (ed) => {
    const key = draftKey(ed);
    if (!key) return;
    local((s) => s.get(key, async (r) => {
      const d = r?.[key];
      if (!ultra && (GZ_DRAFTS.canvasKey(d?.canvas) !== key || typeof d?.text !== 'string' || GZ_DRAFTS.stale({ [key]: d }, Date.now()).length)) return;
      if (!d?.html || !ctx.settings().enhance.drafts || !ctx.on() || !ed.isConnected || draftKey(ed) !== key || draftText(ed).trim()) return;
      const posted = ultra ? GZ_DRAFTS.posted(d.text, pageText()) : await inboxPosted(d);
      if (posted) { if (ultra) s.remove(key); else forgetInboxDraft(key, d); }
      else if (ctx.settings().enhance.drafts && ctx.on() && ed.isConnected && draftKey(ed) === key && !draftText(ed).trim()) {
        if (ultra) restoreBar(ed, key, d);
        else local((s) => s.get(key, (r) => {
          if (r?.[key]?.at === d.at && r[key].text === d.text && ctx.settings().enhance.drafts && ctx.on() && ed.isConnected
            && draftKey(ed) === key && !draftText(ed).trim() && ![...bars.values()].includes(ed)) restoreBar(ed, key, d);
        }));
      }
    }));
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
      if (GZ_DRAFTS.posted(d.text, page)) { typed.delete(key); local((s) => s.remove(key)); }
      else if (now - d.gone > 60000) typed.delete(key); // never posted: the copy stays
    }
    // A bar steps aside while its editor has text (Ultra's own saved draft, or you're writing), and goes with it.
    for (const [bar, ed] of bars) {
      if (!bar.isConnected || !ed.isConnected) { bar.remove(); bars.delete(bar); } else bar.hidden = !!ed.textContent.trim();
    }
    // An editor offers its copy once, after it has sat empty for a moment: Ultra may still be filling it.
    for (const ed of document.querySelectorAll(EDITOR)) {
      if (offered.has(ed)) continue;
      offered.add(ed);
      if (!ed.textContent.trim()) setTimeout(() => offerDraft(ed), 800);
    }
  };
  const watchInboxDrafts = () => {
    if (!ctx.settings().enhance.drafts || !/^\/conversations\/?$/.test(location.pathname)) return;
    const ed = document.querySelector(EDITOR);
    if (ed) loadAccount();
    for (const ed of inboxPending.keys()) if (!ed.isConnected) saveDraft(ed);
    for (const [key, d] of typed) if (!d.ed.isConnected) {
      typed.delete(key);
      if (inboxSending.delete(key)) setTimeout(() => { if (ctx.on() && ctx.settings().enhance.drafts) inboxPosted(d).then((sent) => { if (sent) forgetInboxDraft(key, d); }); }, 1000);
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
  };
  document.addEventListener('click', (e) => {
    if (ultra || !ctx.settings().enhance.drafts || !ctx.on() || !e.target.closest?.('#send-message-button')) return;
    const ed = document.querySelector(EDITOR);
    const key = ed && draftKey(ed);
    if (key) { inboxWrites.set(ed, key); captureInboxDraft(ed); saveDraft(ed); inboxSending.add(key); }
  }, true);
  return { write, watch, drop };
})();

GZ_DRAFT_UI;
