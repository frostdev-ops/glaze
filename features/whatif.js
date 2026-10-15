// Ultra's what-if calculator (enhance.calc), loaded on demand: content.js loads this (after lib/gradecalc.js) on a
// course's gradebook once its grades are in, and calls render() from its passes and when the gradebook answers.
// Scores typed for work not graded yet give the overall grade they'd make, and a target gives the even share of the
// remaining points it needs. The recipe is the course's own overall grade (lib/gradecalc.js), and it must reproduce
// Blackboard's figure first; otherwise it says so. The scores are kept on this device (storage.local, whatIf) until
// cleared, or the item is graded or gone. Canvas's is features/grades.js.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_WHATIF = globalThis.GZ_WHATIF || (() => {
  const ctx = globalThis.GZ_CTX;
  const { t, locale, make, courseId, bookFor } = ctx;
  const whatIf = new Map(); // cid → { overrides: Map columnId → score, target }, or null while loading
  const keepCalc = (cid, overrides) => {
    try { chrome.storage.local.get('whatIf', (r) => chrome.storage.local.set({ whatIf: GZ_GRADECALC.storeScores(r?.whatIf, cid, overrides) })); } catch { /* extension reloaded under the tab */ }
  };
  // Cut, not rounded, to two places: how Ultra writes its own overall grade (82.456 is 82.45%).
  const asPct = (p) => (p == null ? '–' : GZ_I18N.pct(Math.floor(p * 100 + 1e-9) / 100, locale()));
  const render = () => {
    const old = document.getElementById('gz-calc');
    const cid = courseId();
    const host = ctx.settings().enhance.calc && ctx.on() && cid && /^\/ultra\/courses\/_\d+_\d+\/grades/.test(location.pathname) && document.querySelector('.grades-list > aside.student-grade-overview');
    if (!host) return old?.remove();
    const b = bookFor(cid);
    if (!b.results) return;
    const key = `${cid} ${b.key} ${locale()}`;
    if (old?.dataset.key === key && old.previousElementSibling === host) return;
    if (!whatIf.has(cid)) {
      whatIf.set(cid, null);
      const got = (r) => whatIf.set(cid, { overrides: new Map(Object.entries(r?.whatIf?.[cid] || {})), target: '' });
      try { chrome.storage.local.get('whatIf', (r) => { got(r); render(); }); } catch { got(); }
    }
    const st = whatIf.get(cid);
    if (!st) return;
    const m = GZ_GRADECALC.model(b.results);
    // Graded, exempted or gone since: its score goes.
    const kept = GZ_GRADECALC.keptScores(st.overrides, m.items);
    if (kept.size !== st.overrides.size) { st.overrides = kept; keepCalc(cid, kept); }
    const now = make('b', { textContent: m.kind === 'unsupported' ? '' : asPct(m.percent()) });
    const box = make('details', { id: 'gz-calc', open: !!old?.open },
      make('summary', {}, make('span', { textContent: t('What-if calculator') }), now));
    box.dataset.key = key;
    box.setAttribute('aria-label', t('What-if grade calculator'));
    if (m.note) box.append(make('p', { className: 'gz-calc-note', textContent: m.why ? t("Glaze can't work out this course's overall grade: {why}.", { why: t(m.why) }) : t(m.note) }));
    if (m.kind !== 'unsupported') {
      const left = m.items.filter((i) => i.score == null && i.possible > 0);
      const out = make('p', { className: 'gz-calc-out' });
      out.setAttribute('aria-live', 'polite');
      const need = make('p', { className: 'gz-calc-out' });
      need.setAttribute('aria-live', 'polite');
      const target = make('input', { type: 'number', min: 0, max: 100, step: 'any', value: st.target, placeholder: '90' });
      target.setAttribute('aria-label', t('Target overall grade, in percent'));
      const clear = make('button', { type: 'button', className: 'gz-calc-clear', textContent: t('Clear scores') });
      const update = () => {
        clear.hidden = !st.overrides.size;
        const p = m.percent(st.overrides);
        out.textContent = st.overrides.size ? t('With those scores: {pct} overall.', { n: st.overrides.size, pct: asPct(p) }) : t(left.length ? 'Type a score to see where it would leave you.' : 'Everything here is graded.');
        const goal = parseFloat(st.target);
        if (!Number.isFinite(goal)) { need.textContent = ''; return; }
        const r = m.need(goal, st.overrides);
        need.textContent = !r.left ? t('Nothing left to change: {pct}.', { pct: asPct(p) })
          : r.reachable === false ? t('Out of reach: full marks on the {n} items left would make {pct}.', { n: r.left, pct: asPct(r.best) })
            : r.share === 0 ? t("You'd stay at {pct} or above even with zeros on what's left.", { pct: asPct(goal) })
              : t("You'd need about {pct} on each of the {n} items left.", { n: r.left, pct: asPct(Math.ceil(r.share * 1000) / 10) });
      };
      const rows = left.map((i) => {
        const input = make('input', { type: 'number', min: 0, step: 'any', value: st.overrides.get(i.id) ?? '', placeholder: '–' });
        input.setAttribute('aria-label', t('Score for {name}, out of {n}', { name: i.name, n: i.possible }));
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v) && v >= 0) st.overrides.set(i.id, v); else st.overrides.delete(i.id);
          keepCalc(cid, st.overrides);
          update();
        });
        return make('li', {}, make('span', { className: 'gz-calc-name', textContent: i.name }), make('span', { className: 'gz-calc-score' }, input, ` / ${GZ_I18N.num(i.possible, locale())}`));
      });
      target.addEventListener('input', () => { st.target = target.value; update(); });
      clear.addEventListener('click', () => {
        st.overrides.clear();
        keepCalc(cid, st.overrides);
        for (const r of rows) r.querySelector('input').value = '';
        update();
        rows[0].querySelector('input').focus(); // the button hides, so focus can't stay on it
      });
      if (rows.length) box.append(make('h3', { textContent: t('Not graded yet') }), make('ul', {}, ...rows));
      // The box sits where {target} is in the sentence.
      const [before, after] = t('Aim for {target}% overall').split('{target}');
      box.append(out, clear, make('label', { className: 'gz-calc-target' }, before, target, after), need);
      update();
    }
    if (old) old.replaceWith(box); else host.after(box);
  };
  return { render };
})();

GZ_WHATIF;
