// Settings → Writer: the choices its selects offer (a new paper's format, zoom, versions kept, the dialect), the papers saved
// on this device by course with Clear… for a course and Clear all papers (every paper, a course's or not) behind one
// question (lib/writer-papers.js: the list from storage.local, each removal through the worker, which keeps every paper
// write in one queue), and the personal dictionary (storage.local writerWords, the frames' and Harper's) with a remove for
// each word and Clear. The switches and selects themselves save through options.js's data-key binding (storage.sync
// `writer`, defaults.js GZ_SPEC.writer).
// Opened as a page of a school's site, what deletes asks for Settings' own tab. Every word reaches the page as textContent.
// Extension options page only (mount); the pure helpers are for node tests.
var GZ_WRITEREDIT = globalThis.GZ_WRITEREDIT || (() => {
  const DICT = 'writerWords';
  // lib/writer-styles.js FORMATS' labels: names, the same in every language but Blank's.
  const FORMATS = [['mla9', 'MLA 9'], ['apa7', 'APA 7'], ['chicago17', 'Chicago 17'], ['plain', 'Blank']];
  const dialects = (t) => [['en-US', t('American English')], ['en-GB', t('British English')], ['en-CA', t('Canadian English')], ['en-AU', t('Australian English')]];
  // Assignment papers by course, the most first; standalone and recovery papers in Documents.
  const groups = (rows) => {
    const out = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r?.kind && r.kind !== 'paper') continue;
      const parts = typeof r?.key === 'string' ? r.key.split('|') : [];
      if (parts.length === 1 && /^(doc:|recovery:)/.test(r.key)) {
        if (!out.has('documents')) out.set('documents', { id: 'documents', name: 'Documents', keys: [] });
        out.get('documents').keys.push(r.key);
        continue;
      }
      if (parts.length !== 4) continue;
      const id = `${parts[0]}|${parts[2]}`;
      if (!out.has(id)) out.set(id, { id, name: '', keys: [] });
      const c = out.get(id);
      c.keys.push(r.key);
      if (!c.name && typeof r.course === 'string') c.name = r.course.trim().slice(0, 120);
    }
    return [...out.values()].map((c) => ({ ...c, name: c.name || c.id.split('|')[1] })).sort((a, b) => b.keys.length - a.keys.length || a.name.localeCompare(b.name));
  };
  // The list and its counts leave out what is in the Documents page's Trash (lib/writer-papers.js trashed).
  const byCourse = (rows) => groups((Array.isArray(rows) ? rows : []).filter((r) => !Number.isFinite(r?.trashed)));
  // Every paper's key, a course's or not, and those in Trash (Clear all leaves nothing behind): a paper whose key never
  // came is kept under a stand-in (writer-paper.js).
  const allKeys = (rows) => groups(rows).flatMap((c) => c.keys);
  // The dictionary as kept: strings only, the newest last.
  const words = (v) => (Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w.trim()) : []);

  // o: { t, hint, elsewhere(hash) (set when Settings is a frame of a school's page: opens its own tab there) }.
  const mount = (o) => {
    const { t } = o, $ = (id) => document.getElementById(id);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const nf = (n) => new Intl.NumberFormat(GZ_I18N.locale(GZ_I18N.ui())).format(n);
    const opts = (sel, list) => sel?.replaceChildren(...list.map(([v, label]) => new Option(label, String(v))));
    opts(document.querySelector('[data-key="writer.format"]'), FORMATS.map(([id, label]) => [id, id === 'plain' ? t(label) : label]));
    opts(document.querySelector('[data-key="writer.zoom"]'), [['fit', t('Fit')], ...[75, 100, 125, 150].map((z) => [z, GZ_I18N.pct(z, GZ_I18N.ui())])]);
    opts(document.querySelector('[data-key="writer.versions"]'), [10, 25, 40, 50, 100].map((n) => [n, nf(n)]));
    opts(document.querySelector('[data-key="writer.dialect"]'), dialects(t));
    // What deletes is a click a page around the frame could borrow: it opens in Settings' own tab instead.
    const away = (hash) => { if (!o.elsewhere) return false; o.elsewhere(hash); return true; };

    // ---- papers ---------------------------------------------------------------------------------------------------
    let store = null, courses = [], everything = [];
    const papers = () => (store ||= GZ_WRITER_PAPERS.open());
    const drawPapers = async () => {
      let rows = [];
      try { rows = await papers().list(); } catch (e) { console.error(e); }
      courses = byCourse(rows).map((c) => c.id === 'documents' ? { ...c, name: t('Documents') } : c);
      everything = [{ id: '', name: '', keys: allKeys(rows) }];
      const n = courses.reduce((k, c) => k + c.keys.length, 0);
      $('writer-papers-count').textContent = n ? t('{n} papers', { n }) : '';
      $('writer-papers-empty').hidden = n > 0;
      $('writer-clear-all').disabled = !everything[0].keys.length;
      $('writer-paper-list').replaceChildren(...courses.map((c) => {
        const li = el('li'), clear = el('button', '', t('Clear…'));
        clear.type = 'button';
        clear.setAttribute('aria-label', c.id === 'documents' ? t('Clear documents…') : t('Clear {course}’s papers', { course: c.name }));
        clear.addEventListener('click', () => ask([c]));
        li.append(el('b', '', c.name), el('small', '', t(c.id === 'documents' ? '{n} documents' : '{n} papers', { n: c.keys.length })), clear);
        return li;
      }));
    };
    const dialog = $('writer-clear');
    let asked = null;
    const ask = (list) => {
      if (away('#writer/papers')) return;
      asked = list;
      const n = list.reduce((k, c) => k + c.keys.length, 0);
      const documents = list !== everything && list[0].id === 'documents';
      $('writer-clear-title').textContent = list === everything ? t('Clear all papers?') : documents ? t('Clear documents?') : t('Clear {course}’s papers?', { course: list[0].name });
      $('writer-clear-note').textContent = `${t(documents ? '{n} documents' : '{n} papers', { n })}. ${t('They and their versions are deleted from this device. What you submitted stays in Blackboard.')}`;
      dialog.returnValue = '';
      dialog.showModal();
      $('writer-clear-cancel').focus(); // not autofocus: Settings can be a frame of a school page, where browsers refuse it
    };
    dialog.addEventListener('close', async () => {
      const list = asked;
      asked = null;
      if (dialog.returnValue !== 'ok' || !list) return;
      let failed = 0;
      for (const k of list.flatMap((c) => c.keys)) { try { await papers().remove(k); } catch (e) { failed++; console.error(e); } }
      o.hint(failed ? t('Some papers could not be cleared. Try again.') : t('Papers cleared.'), !!failed);
      drawPapers();
    });
    $('writer-clear-all').addEventListener('click', () => ask(everything));

    // ---- the personal dictionary ------------------------------------------------------------------------------------
    const local = chrome.storage.local;
    // As the frames write it (writer-proof.js addWord), one writer at a time.
    const edit = async (fn) => {
      const save = async () => { await local.set({ [DICT]: fn(words((await local.get(DICT))[DICT])) }); };
      const locks = navigator.locks;
      if (locks) await locks.request('glaze-writer-words', save); else await save();
    };
    const drawWords = (list) => {
      list = words(list);
      $('writer-words-count').textContent = list.length ? t('{n} words', { n: list.length }) : '';
      $('writer-words-empty').hidden = list.length > 0;
      $('writer-words-clear').disabled = !list.length;
      $('writer-words').replaceChildren(...[...list].sort((a, b) => a.localeCompare(b)).map((w) => {
        const li = el('li', '', w), x = el('button', '', '✕');
        x.type = 'button';
        x.setAttribute('aria-label', t('Remove {word}', { word: w }));
        x.addEventListener('click', () => { if (!away('#writer/proofing')) edit((cur) => cur.filter((v) => v !== w)).catch((e) => console.error(e)); });
        li.append(x);
        return li;
      }));
    };
    $('writer-words-clear').addEventListener('click', () => { if (!away('#writer/proofing')) edit(() => []).then(() => o.hint(t('Dictionary cleared.')), (e) => console.error(e)); });
    local.get(DICT).then((r) => drawWords(r[DICT]), () => drawWords([]));
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local') return;
      if (c[DICT]) drawWords(c[DICT].newValue);
      if (Object.keys(c).some((k) => k === GZ_WRITER_PAPERS.KEYS.INDEX)) drawPapers();
    });
    drawPapers();
  };

  return { FORMATS, dialects, byCourse, allKeys, words, mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITEREDIT;
