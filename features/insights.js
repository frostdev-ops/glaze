// Insights (Canvas, enhance.insights, off by default): your term in numbers, worked out on this device. A button on the
// Dashboard's header and the command palette open it. It reads, read-only and with the student's own session, this
// term's courses' work and grades from their own Canvas (each course's assignment groups with their submissions, and its
// grading periods where it has them), plus Better To Do's plans and the streak's best (W11, when that is on) from this
// device. The arithmetic is lib/insights.js (grades by lib/gradecalc.js). What it works out is kept in storage.local
// as one small record for this term, written by the service worker's queue ('glaze:insights'), so the view opens at
// once next time; "Clear saved insights" drops it. Every chart is inline SVG beside a table of the same figures; the
// summary card saves as a PNG made on the device. Nothing is sent anywhere, and nothing is compared with anyone.
// Loaded on demand: a second injection keeps the first.
var GZ_INSIGHTS_UI = globalThis.GZ_INSIGHTS_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
  const FRESH = 6 * 36e5; // a saved summary younger than this opens as it is; Refresh asks again
  const alive = () => { const s = ctx.settings(); return ctx.on() && s.enabled !== false && !!s.enhance.insights; };
  const libs = () => ctx.need('lib/todo.js', () => globalThis.GZ_TODO)
    .then(() => Promise.all([ctx.need('lib/gradecalc.js', () => globalThis.GZ_GRADECALC), ctx.need('lib/insights.js', () => globalThis.GZ_INSIGHTS)]));
  const send = (m) => { try { return Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:insights', ...m })).catch(() => null); } catch { return Promise.resolve(null); } };
  // A storage read that worked (an empty one too), or null.
  const get = (keys) => new Promise((res) => {
    try { chrome.storage.local.get(keys, (r) => res(chrome.runtime?.lastError || !r || typeof r !== 'object' ? null : r)); } catch { res(null); }
  });
  // One GET to this Canvas site, as JSON: never followed elsewhere (a redirect fails it), and only while go() still
  // says yes (Insights on, its view's load current), checked right before the request. → { j, next } (the Link
  // header's next page, only when it's on this site).
  const ask = async (url, go) => {
    if (!go()) throw new Error('stopped');
    const r = await fetch(url, { credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json+canvas-string-ids, application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
    const link = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    let next = null;
    try { next = link && new URL(link, location.origin).origin === location.origin ? new URL(link, location.origin).href : null; } catch { /* not an address */ }
    return { j, next };
  };
  // Every page of a list Canvas pages with Link headers. ponytail: 20 pages (2,000 items); more says some were left.
  const getAll = async (path, go) => {
    const out = [];
    let url = `${location.origin}/api/v1${path}`;
    for (let i = 0; url && i < 20; i++) {
      const { j, next } = await ask(url, go);
      if (Array.isArray(j)) out.push(...j);
      url = next;
    }
    out.more = !!url;
    return out;
  };

  // ---- the Dashboard's button --------------------------------------------------------------------------------------
  let btn = null;
  const sync = () => {
    const on = alive();
    const bar = on && location.pathname === '/' && window.top === window && document.querySelector('#dashboard_header_container .ic-Dashboard-header__actions');
    if (!bar) btn?.remove();
    else {
      if (!btn) { btn = make('button', { type: 'button', className: 'Button gz-ins-open' }); btn.addEventListener('click', open); }
      if (btn.textContent !== t('Insights')) btn.textContent = t('Insights');
      if (btn.parentNode !== bar) bar.prepend(btn);
    }
    if (!on) box?.close();
  };

  // ---- the view ----------------------------------------------------------------------------------------------------
  // gen: the view's current load; anything that finishes for an older one (closed, refreshed, cleared) draws nothing.
  let box = null, opener = null, gen = 0;
  let me = null; // { key, uid, tz, base (the last clear this view knows of), rec (what it shows) }
  const stop = (my) => my !== gen || !box || !alive();
  const say = (s) => { const l = box?.querySelector('.gz-ins-say'); if (l) l.textContent = s; };

  const open = async () => {
    if (box) return box.querySelector('h2')?.focus();
    if (!alive()) return;
    const my = ++gen;
    try { await libs(); } catch { return; }
    if (my !== gen || box || !alive()) return;
    const close = make('button', { type: 'button', textContent: t('Close') });
    close.addEventListener('click', () => box?.close());
    const again = make('button', { type: 'button', textContent: t('Refresh') });
    again.addEventListener('click', (e) => { if (e.isTrusted && box) load(++gen, true); });
    box = make('dialog', { id: 'gz-ins' },
      make('header', { className: 'gz-ins-head' },
        make('div', {}, make('h2', { id: 'gz-ins-title', tabIndex: -1, textContent: t('Insights') }), make('p', { className: 'gz-ins-term' })),
        make('div', { className: 'gz-ins-row' }, again, close)),
      make('p', { className: 'gz-ins-say', role: 'status' }),
      make('div', { className: 'gz-ins-body' }));
    box.setAttribute('aria-labelledby', 'gz-ins-title');
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
    box.addEventListener('close', () => { gen++; box?.remove(); box = null; me = null; if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    opener = document.activeElement;
    document.body.append(box);
    box.showModal();
    box.querySelector('h2').focus();
    load(my, false);
  };

  // What's saved, at once if it's this term's; then, unless it's fresh, Canvas asked again and the answer kept.
  const load = async (my, force) => {
    const I = GZ_INSIGHTS, L = GZ_TODO;
    say(t('Working out your term…'));
    try {
      const [p, list] = await Promise.all([ctx.profile(), ctx.canvasCourses()]);
      if (stop(my)) return;
      if (!/^\d+$/.test(String(p?.id))) throw new Error('no profile');
      const uid = String(p.id), tz = L.zone(p.time_zone);
      const key = I.storeKey(location.origin, uid);
      const term = I.term(list, Date.now());
      const kept = await get(key);
      if (stop(my)) return;
      const rec = I.clean(kept?.[key]);
      me = { key, uid, tz, base: rec?.cl || 0, rec: null };
      if (rec?.courses.length && rec.term === term.key) {
        me.rec = rec;
        await draw(my);
        if (stop(my)) return;
        if (!force && Date.now() - rec.at < FRESH) return say(t('Updated {when}', { when: when(rec.at) }));
        say(t('Updating…'));
      }
      if (!term.courses.length) { me.rec = null; await draw(my); return say(''); }
      const at = Date.now();
      const failed = [];
      const go = () => !stop(my);
      const one = async (c) => {
        const [groups, periods] = await Promise.all([
          getAll(`/courses/${c.id}/assignment_groups?include[]=assignments&include[]=submission&exclude_response_fields[]=description&exclude_response_fields[]=rubric&per_page=100`, go),
          c.has_grading_periods ? ask(`${location.origin}/api/v1/courses/${c.id}/grading_periods`, go).then(({ j }) => j.grading_periods) : null,
        ]);
        const q = !!c.restrict_quantitative_data;
        const work = groups.flatMap((g) => g.assignments || []).filter((a) => a.published !== false && a.workflow_state !== 'unpublished');
        // Canvas's current score is the current grading period's, where the course has one (as features/grades.js reads it).
        const gp = c.enrollments?.find((e) => e?.type === 'student')?.current_grading_period_id;
        const trend = q ? [] : I.trend(groups, { weighted: c.apply_assignment_group_weights, periods, weightedPeriods: c.has_weighted_grading_periods }, tz, gp);
        return { id: String(c.id), name: c.name, q, more: groups.more, items: work.map((a) => I.item(a, at)), trend, gp: trend.some((x) => x[2]) ? String(gp) : '' };
      };
      // Three courses at a time.
      const out = [];
      let next = 0;
      await Promise.all([0, 1, 2].map(async () => {
        while (next < term.courses.length && !stop(my)) {
          const c = term.courses[next++];
          out.push(await one(c).catch(() => { failed.push(c.name); return null; }));
        }
      }));
      if (stop(my)) return;
      const order = new Map(term.courses.map((c, i) => [String(c.id), i]));
      const courses = out.filter(Boolean).sort((a, b) => order.get(a.id) - order.get(b.id));
      if (!courses.length) throw new Error('nothing read');
      const fresh = I.clean({ term: term.key, name: term.name, from: term.from, to: term.to, at, courses });
      const couldnt = failed.length && t("Couldn't read: {names}", { names: failed.join(', ') });
      // A course that couldn't be read (an error, a redirect) leaves the saved summary as it is, shown and kept.
      if (couldnt && me.rec) return say(couldnt);
      me.rec = fresh;
      await draw(my);
      if (stop(my)) return;
      say([t('Updated {when}', { when: when(at) }), couldnt].filter(Boolean).join(' '));
      if (!couldnt) send({ op: 'put', key, at, base: me.base, rec: fresh });
    } catch {
      if (!stop(my)) say(t("Couldn't read your courses. Try again in a moment."));
    }
  };

  const lang = () => GZ_I18N.locale(ctx.locale());
  const when = (ms) => new Date(ms).toLocaleString(lang(), { dateStyle: 'medium', timeStyle: 'short' });
  const pct = (share) => GZ_I18N.pct(Math.round(share * 100), ctx.locale());
  const num = (n) => GZ_I18N.num(n, ctx.locale());
  const score = (x) => GZ_I18N.pct(x, ctx.locale());
  const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${num(Math.abs(x))}`;
  const dayText = (day) => new Date(day * GZ_INSIGHTS.DAY).toLocaleDateString(lang(), { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const msText = (ms) => new Date(ms).toLocaleDateString(lang(), { timeZone: me?.tz, month: 'short', day: 'numeric' });
  const table = (caption, head, rows, foot) => make('table', { className: 'gz-ins-table' },
    make('caption', { textContent: caption }),
    make('thead', {}, make('tr', {}, ...head.map((h) => make('th', { scope: 'col', textContent: h })))),
    make('tbody', {}, ...rows.map(([h, ...cells]) => make('tr', {}, make('th', { scope: 'row', textContent: h }), ...cells.map((c) => make('td', {}, c))))),
    foot && make('tfoot', {}, make('tr', {}, make('th', { scope: 'row', textContent: foot[0] }), ...foot.slice(1).map((c) => make('td', {}, c)))));
  const section = (title, ...kids) => make('section', { className: 'gz-ins-sec' }, make('h3', { textContent: title }), ...kids);
  const note = (s) => make('p', { className: 'gz-ins-note', textContent: s });

  // The summary card's tiles, the same on the page and in the picture: { value, label, note? }.
  const tiles = (v) => {
    const c = v.card;
    return [
      c.share != null && { value: pct(c.share), label: t('On time') },
      { value: num(c.handed), label: t('Handed in') },
      c.best && { value: num(c.best), label: t('Best run of on-time weeks') },
      { value: num(c.courses), label: t('Courses') },
      c.rise && { value: signed(c.rise.change), label: t('Biggest rise'), note: c.rise.name },
      c.busiest && { value: num(c.busiest.n), label: t('Due in your busiest week'), note: t('Week of {date}', { date: dayText(c.busiest.w) }) },
      c.left != null && { value: num(c.left), label: t('Weeks left') },
      c.plans != null && { value: pct(c.plans), label: t('Plans kept') },
      c.streak && { value: num(c.streak), label: t('Best streak (days)') },
    ].filter(Boolean);
  };

  // A sparkline of one course's grade over the term (its table is beside it).
  // A grading period starts afresh, so each period is its own line.
  const spark = (tr) => {
    const W = 120, H = 28, ys = tr.map(([, y]) => y), lo = Math.min(...ys) - 1, hi = Math.max(...ys) + 1;
    const t0 = tr[0][0], span = tr.at(-1)[0] - t0 || 1;
    const pts = tr.map(([x, y, gp]) => [((x - t0) / span) * (W - 4) + 2, H - 2 - ((y - lo) / (hi - lo)) * (H - 4), gp]);
    const lines = [];
    for (const p of pts) { if (!lines.length || lines.at(-1).at(-1)[2] !== p[2]) lines.push([]); lines.at(-1).push(p); }
    const [ex, ey] = pts.at(-1);
    return svg('svg', { class: 'gz-ins-spark', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' },
      ...lines.map((l) => svg('polyline', { points: l.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') })), svg('circle', { cx: ex.toFixed(1), cy: ey.toFixed(1), r: 2.5 }));
  };
  // On time, late and missing as one bar (the table beside it has the counts).
  const bar = (c) => {
    const all = c.on + c.late + c.missing;
    let x = 0;
    return svg('svg', { class: 'gz-ins-bar', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
      ...(all ? [['on', c.on], ['late', c.late], ['missing', c.missing]] : []).filter(([, n]) => n).map(([k, n]) => {
        const w = (n / all) * 100;
        const r = svg('rect', { class: `gz-${k}`, x: x.toFixed(2), y: 0, width: w.toFixed(2), height: 8 });
        x += w;
        return r;
      }));
  };
  // Work due each week, as columns: past weeks faint, this week outlined, the busiest ahead in the accent.
  const columns = (weeks) => {
    const most = Math.max(1, ...weeks.map((w) => w.n)), W = 12, H = 56;
    return svg('svg', { class: 'gz-ins-weeks', viewBox: `0 0 ${weeks.length * W} ${H + 2}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
      ...weeks.map((w, i) => {
        const h = w.n ? Math.max(2, (w.n / most) * H) : 0;
        return svg('rect', { class: [w.heavy && 'gz-heavy', w.past && 'gz-past', w.now && 'gz-now'].filter(Boolean).join(' '), x: i * W + 2, y: H - h + 1, width: W - 4, height: h || 0.5 },
          svg('title', {}, `${t('Week of {date}', { date: dayText(w.w) })}: ${num(w.n)}`));
      }));
  };

  const draw = async (my) => {
    const body = box?.querySelector('.gz-ins-body');
    if (!body) return;
    const rec = me?.rec;
    box.querySelector('.gz-ins-term').textContent = rec?.name || t('This term');
    if (!rec) return body.replaceChildren(note(t('No current courses to look at.')));
    // Better To Do's plans and the streak, as stored on this device now.
    const s = ctx.settings();
    const tkey = GZ_TODO.storeKey(location.origin, me.uid), rkey = `remind:${location.origin}/${me.uid}`;
    const own = await get([tkey, rkey]);
    if (stop(my) || me?.rec !== rec) return;
    const best = s.enhance.streak && own?.[rkey]?.streak?.best;
    const v = GZ_INSIGHTS.view(rec, { now: Date.now(), tz: me.tz, data: GZ_TODO.clean(own?.[tkey]), streak: Number.isInteger(best) ? { best } : null });
    me.view = v;
    const cards = tiles(v);
    const save = make('button', { type: 'button', textContent: t('Save as picture') });
    save.addEventListener('click', picture);
    const summary = section(t('Your term in numbers'),
      make('ul', { className: 'gz-ins-tiles' }, ...cards.map((c) => make('li', {}, make('strong', { textContent: c.value }), make('span', { textContent: c.label }), c.note && make('small', { textContent: c.note })))),
      make('div', { className: 'gz-ins-row' }, save));

    const T = v.total;
    const counts = (c) => [num(c.on), num(c.late), num(c.missing), num(c.excused), c.share == null ? '–' : pct(c.share)];
    const onTime = section(t('On time'),
      note(t('Work handed in by its due date, as Canvas marks it. Excused work is left out.')),
      table(t('On time by course'), [t('Course'), t('On time'), t('Late'), t('Missing'), t('Excused'), t('Share on time'), ''],
        v.courses.map((c) => [c.name, ...counts(c.tally), bar(c.tally)]), [t('All courses'), ...counts(T), bar(T)]),
      make('dl', { className: 'gz-ins-facts' },
        make('dt', { textContent: t('Handed in a day or more early') }), make('dd', { textContent: num(T.early) }),
        make('dt', { textContent: t('Best run of on-time weeks') }), make('dd', { textContent: num(v.runs.best) }),
        make('dt', { textContent: t('On-time weeks in a row now') }), make('dd', { textContent: num(v.runs.now) })));

    const graded = v.courses.filter((c) => c.trend.length);
    const trend = section(t('Grades over the term'),
      note(t("Each course's current grade after each piece of graded work, by Canvas's rules, in date order.")),
      v.courses.some((c) => c.gp) && note(t("In a course with grading periods, each period starts afresh: First, Now and Change are this period's, as Canvas's current grade is.")),
      table(t('Grade trend by course'), [t('Course'), t('First'), t('Now'), t('Change'), t('Trend')], v.courses.map((c) => {
        if (c.q) return [c.name, t('Letter grades only'), '', '', ''];
        if (c.last == null) return [c.name, t('Not enough graded work yet'), '', '', c.trend.length > 1 ? spark(c.trend) : ''];
        return [c.name, score(c.first), score(c.last), c.change == null ? '' : signed(c.change), c.trend.length > 1 ? spark(c.trend) : ''];
      })),
      graded.length ? make('details', { className: 'gz-ins-more' }, make('summary', { textContent: t('Every point as a table') }),
        ...graded.map((c) => table(c.name, [t('Date'), t('Grade')], c.trend.map(([ms, x, gp], i) => [
          `${msText(ms)}${gp && i && c.trend[i - 1][2] !== gp ? ` (${t('a new grading period')})` : ''}`, score(x)])))) : null);

    const ahead = v.weeks.filter((w) => w.heavy).sort((a, b) => a.w - b.w);
    const load = section(t('Workload by week'),
      ...(v.weeks.length ? [columns(v.weeks), make('div', { className: 'gz-ins-axis', ariaHidden: 'true' },
        make('span', { textContent: dayText(v.weeks[0].w) }), make('span', { textContent: dayText(v.weeks.at(-1).w) }))] : [note(t('Nothing with a due date yet.'))]),
      ahead.length ? table(t('Busiest weeks ahead'), [t('Week of'), t('Due'), t('Points'), t("What's due")],
        ahead.map((w) => [dayText(w.w), num(w.n), num(w.p), `${w.names.join(', ')}${w.n > w.names.length ? ', …' : ''}`])) : null,
      v.weeks.length ? make('details', { className: 'gz-ins-more' }, make('summary', { textContent: t('Every week as a table') }),
        table(t('Work due each week'), [t('Week of'), t('Due'), t('Points')], v.weeks.map((w) => [`${dayText(w.w)}${w.now ? ` (${t('this week')})` : ''}`, num(w.n), num(w.p)]))) : null);

    const P = v.plans;
    const plans = P.on.all || P.focus.all ? section(t('Your plans'),
      note(t("A plan counts as kept when the work was handed in or ticked off by the end of its day; focus sessions, by the end of the last one's day.")),
      make('dl', { className: 'gz-ins-facts' },
        ...(P.on.all ? [make('dt', { textContent: t('Do-on days kept') }), make('dd', { textContent: t('{kept} of {all}', { kept: P.on.kept, all: P.on.all }) })] : []),
        ...(P.focus.all ? [make('dt', { textContent: t('Focus sessions kept') }), make('dd', { textContent: t('{kept} of {all}', { kept: P.focus.kept, all: P.focus.all }) })] : []))) : null;

    const clear = make('button', { type: 'button', textContent: t('Clear saved insights') });
    clear.addEventListener('click', forget);
    // Whatever couldn't be counted is said, never left out quietly.
    const left = [v.left.names.length && t("Some work couldn't be counted, so these figures leave it out: {names}.", { names: v.left.names.join(', ') }),
      v.left.courses && t('Courses not counted: {n}', { n: v.left.courses })].filter(Boolean).map(note);
    body.replaceChildren(...left, summary, onTime, trend, load, ...(plans ? [plans] : []),
      make('footer', { className: 'gz-ins-foot' }, note(t('Worked out on this device from your own Canvas. Only this summary is kept, on this device, until you clear it. Nothing is sent anywhere.')), clear));
  };

  // "Clear saved insights": the record goes, and its time stays so nothing still on its way brings it back.
  const forget = async (e) => {
    if (!e.isTrusted || !me) return;
    const my = ++gen, at = Date.now(), key = me.key;
    const r = await send({ op: 'clear', key, at });
    if (stop(my)) return;
    if (!r?.ok) return say(t("Couldn't clear. Try again in a moment."));
    me = { ...me, base: at, rec: null };
    box.querySelector('.gz-ins-body').replaceChildren(note(t('Cleared. Refresh works it out again.')));
    say('');
  };

  // ---- the summary card as a picture ------------------------------------------------------------------------------
  // Drawn on a canvas in the palette's colors (read once, from the dialog), saved through a blob link: only on the
  // student's own click, never a script's.
  const picture = (e) => {
    if (!e.isTrusted || !(navigator.userActivation?.isActive ?? true) || !box || !me?.view) return;
    const list = tiles(me.view);
    const cs = getComputedStyle(box);
    const col = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    const font = cs.fontFamily || 'system-ui, sans-serif';
    const W = 1080, P = 64, GAP = 24, TW = (W - 2 * P - GAP) / 2, TH = 210;
    const rows = Math.ceil(list.length / 2);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = P + 150 + rows * (TH + GAP) + 70;
    const g = c.getContext('2d');
    const fill = (name, fallback) => { g.fillStyle = fallback; g.fillStyle = col(name, fallback); };
    const fit = (s, size, weight, max) => { let n = size; do g.font = `${weight} ${n}px ${font}`; while (g.measureText(s).width > max && --n > 12); };
    fill('--gz-surface', '#ffffff');
    g.fillRect(0, 0, W, c.height);
    g.textBaseline = 'top';
    fill('--gz-ink', '#1f2937');
    fit(t('Your term in numbers'), 56, 700, W - 2 * P);
    g.fillText(t('Your term in numbers'), P, P);
    fill('--gz-ink-muted', '#6b7280');
    fit(me.rec.name || t('This term'), 30, 400, W - 2 * P);
    g.fillText(me.rec.name || t('This term'), P, P + 76);
    list.forEach((x, i) => {
      const left = P + (i % 2) * (TW + GAP), top = P + 150 + Math.floor(i / 2) * (TH + GAP);
      fill('--gz-surface-2', '#f3f4f6');
      g.beginPath();
      g.roundRect(left, top, TW, TH, 24);
      g.fill();
      fill('--gz-accent', '#4f46e5');
      fit(x.value, 76, 700, TW - 56);
      g.fillText(x.value, left + 28, top + 28);
      fill('--gz-ink', '#1f2937');
      fit(x.label, 30, 600, TW - 56);
      g.fillText(x.label, left + 28, top + 124);
      if (x.note) { fill('--gz-ink-muted', '#6b7280'); fit(x.note, 24, 400, TW - 56); g.fillText(x.note, left + 28, top + 164); }
    });
    fill('--gz-ink-muted', '#6b7280');
    g.font = `400 22px ${font}`;
    g.fillText(t('Glaze · worked out on this device'), P, c.height - 54);
    const mine = box;
    c.toBlob((blob) => {
      if (!blob || box !== mine || !alive()) return;
      const a = make('a', { href: URL.createObjectURL(blob), download: `glaze-term-${new Date().toISOString().slice(0, 10)}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }, 'image/png');
  };

  return { sync, open };
})();

GZ_INSIGHTS_UI;
