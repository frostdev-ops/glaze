// Settings → AI → Memory. All record reads and writes go through the checked worker broker. Settings may manage stored
// accounts after logout; model tools have a separate live-account scope. Never consume record content from storage events.
// Memory off pauses Ask Rime recall, automatic saves and course ingestion; it does not hide these controls.
var GZ_MEMORYEDIT = globalThis.GZ_MEMORYEDIT || (() => {
  const TYPE = 'glaze:memory', MAX = 600;
  const ID = /^(?:m|s)-[a-f0-9]{32}$/, REV = /^[a-f0-9]{32}$/;
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const rows = (records, kind) => (Array.isArray(records) ? records : []).filter((r) => isObj(r) && r.kind === kind && r.deleted !== true
    && ID.test(r.id) && r.id.startsWith(kind === 'memory' ? 'm-' : 's-') && REV.test(r.revision) && typeof r.account === 'string'
    && typeof r.markdown === 'string' && r.markdown.length <= (kind === 'memory' ? MAX : 20000))
    .sort((a, b) => a.account.localeCompare(b.account) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const accountName = (account) => { try { const u = new URL(account); return `${u.host} · ${u.pathname.slice(1)}`; } catch { return account; } };
  const snapshot = (records) => records.map(({ id, revision }) => ({ id, revision }));
  const errorText = (error, t) => error === 'conflict' ? t('This memory changed. Reload it before saving.')
    : error === 'not-found' ? t('This memory was deleted.') : error === 'limit' ? t('Use 600 characters or fewer.') : t('Could not save. Try again.');
  const mount = ({ t, when = (at) => new Date(at).toLocaleString() }) => {
    if (window.top !== window) return;
    const c = globalThis.chrome, $ = (id) => document.getElementById(id), section = $('ai-memory');
    if (!section) return;
    const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); e.className = cls; e.textContent = text; return e; };
    const button = (text, on, cls = '', id = '') => { const b = el('button', cls, text); b.type = 'button'; b.id = id; b.disabled = busy; b.addEventListener('click', on); return b; };
    const send = async (message) => { try { const r = await c.runtime.sendMessage({ type: TYPE, ...message }); return isObj(r) ? r : { ok: false, error: 'write' }; } catch { return { ok: false, error: 'write' }; } };
    let enabled = true, initialized = false, busy = false, editor = null, pending = null, stateVersion = 0;
    const opened = new Set();
    const records = { memory: [], course: [] }, loaded = { memory: false, course: false }, versions = { memory: 0, course: 0 };
    const say = (text = '') => { $('memory-said').textContent = text; $('memory-said').hidden = !text; };
    const refocus = (id, fallback = 'memory-refresh', start, end) => {
      const target = [$(id), $(fallback), $('memory-refresh')].find((e) => e && !e.disabled);
      target?.focus(); if (Number.isInteger(start)) target?.setSelectionRange?.(start, end);
    };
    const loadState = async () => {
      const version = ++stateVersion, r = await send({ op: 'state' });
      if (version !== stateVersion) return;
      if (r.ok && typeof r.enabled === 'boolean') { enabled = r.enabled; initialized = true; }
      else say(t('Could not load memory. Try again.'));
      render();
    };
    const load = async (kind) => {
      const version = ++versions[kind], r = await send({ op: 'list', kind });
      if (version !== versions[kind]) return;
      if (r.ok && Array.isArray(r.records)) { records[kind] = rows(r.records, kind); loaded[kind] = true; }
      else say(t('Could not load memory. Try again.'));
      render();
    };
    const perform = async (message, done) => {
      if (busy) return;
      const active = document.activeElement, had = active?.id, start = active?.selectionStart, end = active?.selectionEnd;
      busy = true; say(); render();
      try {
        const r = await send(message);
        if (r.ok) { done?.(r); if (r.conflicts) say(t('Some records changed. Review them and try again.')); }
        else { if (editor && message.op === 'update' && ['conflict', 'not-found'].includes(r.error)) editor.conflict = true; say(errorText(r.error, t)); }
        if (message.op !== 'settings' && message.op !== 'export') await load(message.id?.startsWith('s-') || message.kind === 'course' ? 'course' : 'memory');
        return r;
      } finally {
        busy = false; render();
        // Disabled/replaced controls lose focus. Restore it only if the user has not moved elsewhere while awaiting the worker.
        if (had?.startsWith('memory-') && document.activeElement === document.body) refocus(had, message.op === 'update' ? `memory-edit-${message.id}` : 'memory-refresh', start, end);
      }
    };
    const startEdit = (record) => { editor = { record, draft: record.markdown, conflict: false }; say(); render(); $('memory-edit-text')?.focus(); };
    const save = () => {
      if (!editor || busy) return;
      if (!editor.draft.trim() || editor.draft.length > MAX) { say(t('Use 600 characters or fewer.')); return; }
      const { record, draft } = editor;
      return perform({ op: 'update', id: record.id, revision: record.revision, markdown: draft }, () => { editor = null; });
    };
    const remove = (record) => perform({ op: 'forget', id: record.id, revision: record.revision });
    const drawMemory = (record) => {
      const li = el('li', 'memory-record'); li.dataset.memoryId = record.id;
      if (editor?.record.id === record.id) {
        const input = el('textarea', 'memory-edit'); input.id = 'memory-edit-text'; input.value = editor.draft; input.maxLength = MAX; input.rows = 5;
        input.disabled = busy; input.setAttribute('aria-label', t('Saved memory')); input.setAttribute('data-local', ''); input.setAttribute('writingsuggestions', 'false');
        input.addEventListener('input', () => { if (editor?.record.id === record.id) editor.draft = input.value; });
        const actions = el('div', 'row');
        actions.append(button(t('Save'), save, 'primary', `memory-save-${record.id}`), button(t('Cancel'), () => {
          editor = null; say(); render(); refocus(`memory-edit-${record.id}`);
        }, '', `memory-cancel-${record.id}`));
        if (editor.conflict) actions.append(button(t('Reload'), () => {
          const latest = records.memory.find((r) => r.id === record.id);
          if (latest) startEdit(latest); else { editor = null; say(t('This memory was deleted.')); render(); }
        }, '', `memory-reload-${record.id}`));
        li.append(input, actions);
      } else {
        const actions = el('div', 'row');
        const edit = button(t('Edit'), () => startEdit(record), '', `memory-edit-${record.id}`); edit.disabled ||= !!editor;
        actions.append(edit, button(t('Delete'), () => remove(record), 'wr-danger', `memory-forget-${record.id}`));
        li.append(el('pre', 'memory-markdown', record.markdown), actions);
      }
      return li;
    };
    const drawCourse = (record) => {
      const li = el('li', 'memory-record'), details = el('details'), summary = el('summary'), source = record.source || {};
      summary.id = `memory-source-${record.id}`;
      li.dataset.memoryId = record.id; details.open = opened.has(record.id);
      details.addEventListener('toggle', () => { if (details.open) opened.add(record.id); else opened.delete(record.id); });
      summary.append(el('span', '', typeof source.title === 'string' && source.title ? source.title : typeof source.tool === 'string' ? source.tool : t('Course material')));
      const time = Number.isFinite(source.observedAt) ? source.observedAt : record.updatedAt;
      const meta = [Number.isFinite(time) ? when(time) : '', source.complete === false ? t('Partial') : ''].filter(Boolean).join(' · ');
      if (meta) summary.append(el('small', '', meta));
      details.append(summary, el('pre', 'memory-markdown', record.markdown));
      li.append(details, button(t('Delete'), () => remove(record), 'wr-danger', `memory-forget-${record.id}`));
      return li;
    };
    const drawList = (kind) => {
      const list = $(`memory-${kind}-list`), all = [...records[kind]];
      if (kind === 'memory' && editor && !all.some((r) => r.id === editor.record.id)) all.push(editor.record);
      const groups = new Map();
      for (const record of all) { if (!groups.has(record.account)) groups.set(record.account, []); groups.get(record.account).push(record); }
      const items = [];
      for (const [account, group] of groups) {
        const li = el('li', 'memory-account'), inner = el('ul', 'memory-records');
        const heading = el('h4', '', accountName(account)); heading.dir = 'auto';
        inner.append(...group.map(kind === 'memory' ? drawMemory : drawCourse)); li.append(heading, inner); items.push(li);
      }
      list.replaceChildren(...items);
      $(`memory-${kind}-empty`).hidden = !loaded[kind] || all.length > 0;
      $(`memory-${kind}-clear`).disabled = busy || !loaded[kind] || !records[kind].length;
    };
    const render = () => {
      const active = document.activeElement, had = active?.id, start = active?.selectionStart, end = active?.selectionEnd;
      $('memory-on').checked = enabled; $('memory-on').disabled = busy || !initialized;
      $('memory-refresh').disabled = busy;
      $('memory-export').disabled = busy || !loaded.memory || !records.memory.length;
      drawList('memory'); drawList('course');
      if (had?.startsWith('memory-') && document.activeElement !== $(had)) refocus(had, 'memory-refresh', start, end);
    };
    const askClear = (kind, trigger) => {
      if (busy || !records[kind].length) return;
      pending = { kind, records: snapshot(records[kind]), trigger };
      $('memory-clear-title').textContent = kind === 'memory' ? t('Clear saved memories?') : t('Clear course cache?');
      const dialog = $('memory-clear-ask'); dialog.returnValue = ''; dialog.showModal(); $('memory-clear-cancel').focus();
    };
    $('memory-clear-ask').addEventListener('close', () => {
      const asked = pending; pending = null;
      if (!asked) return;
      asked.trigger.focus();
      if ($('memory-clear-ask').returnValue === 'ok') perform({ op: 'clear', kind: asked.kind, records: asked.records });
    });
    for (const kind of ['memory', 'course']) $(`memory-${kind}-clear`).addEventListener('click', (event) => askClear(kind, event.currentTarget));
    $('memory-on').addEventListener('change', async () => {
      const wanted = $('memory-on').checked; ++stateVersion;
      await perform({ op: 'settings', enabled: wanted }, (r) => { enabled = typeof r.enabled === 'boolean' ? r.enabled : wanted; });
      await loadState();
    });
    $('memory-refresh').addEventListener('click', () => { say(); return Promise.all([loadState(), load('memory'), load('course')]); });
    $('memory-export').addEventListener('click', () => perform({ op: 'export' }, (r) => {
      if (typeof r.markdown !== 'string') { say(t('Could not save. Try again.')); return; }
      const url = URL.createObjectURL(new Blob([r.markdown], { type: 'text/markdown;charset=utf-8' })), link = el('a');
      try { link.href = url; link.download = 'glaze-memories.md'; document.body.append(link); link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }));
    c.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (Object.hasOwn(changes, 'ai')) loadState();
      if (Object.keys(changes).some((key) => key.startsWith('rimeMemory:'))) load('memory');
      if (Object.keys(changes).some((key) => key.startsWith('rimeMaterial:'))) load('course');
    });
    // Redraw only in response to a broker read or action. Record updates preserve the draft, selection and focus.
    render(); loadState(); load('memory'); load('course');
  };
  return { TYPE, MAX, rows, accountName, snapshot, errorText, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_MEMORYEDIT; else GZ_MEMORYEDIT;
