// Settings search, result visibility and its keyboard shortcut. Controls and section ownership remain in the editor.
var GZ_SETTINGS_SEARCH = (() => {
  const mount = ({ t, finder, editor, searchPreview }) => {
    const $ = (q) => document.querySelector(q), $$ = (q) => [...document.querySelectorAll(q)];
    // A section's parts are its children, and the children of the boxes in it (groups, More options, the navigation's bodies), each
    // box's own heading aside. A match inside a closed More options opens it; leaving the search closes it again (settings/editor.js).
    const BOX = '.group, .nb-body, .nb-group, .nav-own, .stack, details.more';
    const filter = () => {
      const words = GZ_FIND.parse(finder.value);
      const on = words.length > 0;
      document.body.classList.toggle('finding', on);
      editor.finding(on); searchPreview(on);
      const marks = [];
      const mark = (root, heading = false) => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let t; (t = w.nextNode());) {
          for (const [a, b] of GZ_FIND.spans(t.data, words, heading)) {
            const r = new Range();
            r.setStart(t, a);
            r.setEnd(t, b);
            marks.push(r);
          }
        }
      };
      const named = (el) => [el, ...el.querySelectorAll('[aria-describedby], [aria-labelledby]')]
        .flatMap((e) => `${e.getAttribute('aria-describedby') || ''} ${e.getAttribute('aria-labelledby') || ''}`.split(' '))
        .map((id) => id && document.getElementById(id)).filter(Boolean);
      const said = (el) => [el, ...el.querySelectorAll('[title], [aria-label], [placeholder]')]
        .map((e) => `${e.title} ${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''}`).join(' ');
      let n = 0;
      for (const b of $$('button.info.found')) b.classList.remove('found');
      for (const sec of $$('[data-editor-section]')) {
        const h2 = sec.querySelector('h2'), boxes = [];
        const partsOf = (box) => [...box.children].flatMap((el) => {
          if (el.matches('.section-heading, .section-path, summary, [data-setting-demo]') || (box !== sec && el.tagName === 'H3')) return [];
          if (el.matches(BOX)) { boxes.push(el); return partsOf(el); }
          return [el];
        });
        const parts = partsOf(sec);
        const notes = new Map(parts.map((el) => [el, named(el)]));
        const isNote = new Set([...notes.values()].flat());
        for (const el of isNote) el.classList.toggle('miss', on);
        let any = false;
        for (const el of parts) {
          if (isNote.has(el)) continue;
          const heads = [];
          for (let box = el.parentElement; box && box !== sec; box = box.parentElement) if (box.matches(BOX)) heads.push(box.querySelector(':scope > h3')?.textContent || '');
          const text = [el.textContent, said(el), ...notes.get(el).map((x) => x.textContent)].join(' ');
          const tab = $(`[data-editor-tab="${sec.dataset.editorSection.split('/')[0]}"]`).textContent;
          const hit = !on || (!el.closest('[hidden]') && GZ_FIND.matches(`${tab} ${h2.textContent} ${heads.join(' ')}`, `${sec.dataset.sites} ${text}`, words));
          el.classList.toggle('miss', !hit);
          if (!hit || !on) continue;
          any = true;
          n++;
          for (const x of [el, ...notes.get(el)]) { x.classList.remove('miss'); mark(x); }
          // A match only in a "?"'s description rings the "?"; opening it shows the words marked.
          for (const pop of [el, ...notes.get(el)].flatMap((x) => (x.matches('.info-pop') ? [x] : [...x.querySelectorAll('.info-pop')]))) {
            if (GZ_FIND.spans(pop.textContent, words).length) document.querySelector(`[popovertarget="${pop.id}"]`)?.classList.add('found');
          }
        }
        // Innermost first, so a box holding only empty boxes is empty too.
        for (const g of boxes.reverse()) {
          const empty = on && !g.querySelector(':scope > :not(h3, summary, .miss)');
          g.classList.toggle('miss', empty);
          if (!on || empty) continue;
          for (const h3 of g.querySelectorAll(':scope > h3')) mark(h3, true);
          if (g.matches('details.more')) g.open = true;
        }
        sec.classList.toggle('miss', on && !any);
        if (on && any) mark(h2, true);
      }
      for (const panel of $$('[data-editor-panel]')) panel.classList.toggle('miss', on && !panel.querySelector('[data-editor-section]:not(.miss)'));
      if (window.Highlight) CSS.highlights.set('find', new Highlight(...marks));
      const msg = !on ? '' : n ? t('{n} settings', { n }) : t('No settings match');
      if ($('#find-status').textContent !== msg) $('#find-status').textContent = msg;
    };
    finder.addEventListener('input', filter);
    finder.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !finder.value) return;
      e.preventDefault();
      finder.value = '';
      filter();
    });
    addEventListener('keydown', (e) => {
      if (!GZ_CHOICES.shortcut(e)) return;
      e.preventDefault();
      finder.focus();
      finder.select();
    });

    return filter;
  };
  return { mount };
})();
