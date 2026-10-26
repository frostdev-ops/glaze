// Assignment rubric data only. Rich strings stay untrusted; the view owns rendering and safe content.
// Classic script, loaded on demand; a second injection keeps the first. No site requests here.
var GZ_RUBRIC_LIB = globalThis.GZ_RUBRIC_LIB || (() => {
  const BB = /^_\d+_\d+$/, CID = /^[1-9]\d{0,39}$/, KEY = /^[\w-]{1,40}$/;
  const bb = (x) => typeof x === 'string' && x.length <= 40 && BB.test(x);
  const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  const id = (x) => (typeof x === 'string' || typeof x === 'number' && Number.isSafeInteger(x)) && KEY.test(String(x)) && String(x) !== 'prototype' && !own(Object.prototype, String(x)) ? String(x) : '';
  const num = (x) => typeof x === 'number' && Number.isFinite(x) ? x : null;
  const rounded = (x) => num(x) === null ? null : Number(x.toFixed(5));
  const positive = (x) => num(x) !== null && x >= 0 ? x : null;
  const canvasTotal = (x) => positive(typeof x === 'string' && x.length <= 320 && /^\d+(?:\.\d+)?$/.test(x) ? Number(x) : x);
  const percent = (x) => positive(x) !== null && x <= 100 ? x : null;
  const list = (x, max, empty = false) => Array.isArray(x) && x.length <= max && (empty || x.length > 0);
  const text = () => {
    let left = 131072;
    const read = (x, limit = 300) => {
      const s = typeof x === 'string' ? x : '';
      if (s.length > limit || s.length > left) { read.complete = false; return ''; }
      left -= s.length; return s;
    };
    read.complete = true;
    return read;
  };
  const result = (format) => ({ score: null, possible: null, commentFormat: format, criteria: Object.create(null) });
  const finish = (m, str) => {
    if (!str.complete) return null;
    if (m.hidePoints) {
      m.hideTotal = true;
      for (const row of m.criteria) { row.weight = row.points = null; for (const c of row.cells) c.value = null; }
      if (m.result) for (const r of Object.values(m.result.criteria)) r.score = null;
    }
    if (m.hideTotal) { m.total = null; if (m.result) m.result.score = m.result.possible = null; }
    return m;
  };
  const range = (lo, hi, loExclusive) => lo !== null && hi !== null && lo <= hi ? { lo, hi, loExclusive } : null;

  const canvas = (a, s, context = {}) => {
    if (!obj(a) || !obj(context) || !CID.test(context.courseId) || !CID.test(context.assignmentId) || String(a.id) !== context.assignmentId || String(a.course_id) !== context.courseId || !list(a.rubric, 50)) return null;
    const settings = obj(a.rubric_settings) ? a.rubric_settings : {}, full = obj(s?.full_rubric_assessment) ? s.full_rubric_assessment : null;
    const flags = obj(full?.rubric_association) ? full.rubric_association : {};
    const str = text(), rows = new Map(), ratings = new Map(), free = settings.free_form_criterion_comments === true || a.free_form_criterion_comments === true;
    const m = { site: 'canvas', title: str(settings.title), detail: '', kind: 'points',
      hidePoints: settings.hide_points === true || flags.hide_points === true || a.restrict_quantitative_data === true || context.hidePoints === true,
      hideTotal: settings.hide_score_total === true || flags.hide_score_total === true,
      total: canvasTotal(settings.points_possible), levels: [], criteria: [], result: null };
    for (const raw of a.rubric) {
      const key = id(raw?.id), rs = raw?.ratings == null && free ? [] : raw?.ratings;
      if (!key || rows.has(key) || !list(rs, 12, free)) return null;
      const row = { id: key, label: str(raw.description), detail: str(raw.long_description, 20000), weight: null, points: positive(raw.points), unscored: raw.ignore_for_scoring === true, cells: [] };
      const scored = !m.hidePoints && !free && !row.unscored;
      if (scored && row.points === null) return null;
      const byId = new Map(); rows.set(key, row); ratings.set(key, byId);
      if (raw.criterion_use_range === true) m.kind = 'points-range';
      for (let i = 0; i < rs.length; i++) {
        const r = rs[i], rid = id(r?.id), n = positive(r?.points), next = positive(rs[i + 1]?.points);
        if (!rid || byId.has(rid) || scored && n === null) return null;
        const cell = { id: `${key}:${rid}`, level: `level-${i}`, label: str(r.description), detail: str(r.long_description, 20000), value: n === null ? null : { n } };
        if (raw.criterion_use_range === true && n !== null && n > 0 && (next === null && i === rs.length - 1 || next !== null && next < n)) cell.value = range(next ?? 0, n, true);
        row.cells.push(cell); byId.set(rid, { cell, n, ranged: raw.criterion_use_range === true });
      }
      m.criteria.push(row);
    }
    const count = Math.max(...m.criteria.map((r) => r.cells.length));
    for (let i = 0; i < count; i++) {
      const labels = m.criteria.map((r) => r.cells[i]?.label).filter((x) => x !== undefined);
      m.levels.push({ id: `level-${i}`, label: labels.every((x) => x === labels[0]) ? labels[0] : '' });
    }
    const assessment = s?.rubric_assessment;
    if (!obj(s) || String(s.assignment_id) !== context.assignmentId || context.userId != null && String(s.user_id) !== String(context.userId) || own(s, 'posted_at') && s.posted_at == null || !obj(assessment)) return finish(m, str);
    if (full && (full.rubric_id != null && String(full.rubric_id) !== String(settings.id) || full.artifact_attempt != null && String(full.artifact_attempt) !== String(s.attempt) || flags.association_id != null && String(flags.association_id) !== context.assignmentId || flags.association_type != null && flags.association_type !== 'Assignment' || flags.rubric_id != null && String(flags.rubric_id) !== String(settings.id))) return finish(m, str);
    const entries = Object.entries(assessment);
    if (!entries.length || entries.length > 50) return finish(m, str);
    const out = result('text'); out.score = num(full?.score); out.possible = m.total;
    for (const [key, raw] of entries) {
      if (!rows.has(key) || !obj(raw)) return finish(m, str);
      const hit = raw.rating_id == null || raw.rating_id === '' ? null : ratings.get(key).get(String(raw.rating_id));
      if (raw.rating_id != null && raw.rating_id !== '' && !hit) return finish(m, str);
      const score = num(raw.points);
      out.criteria[key] = { cell: hit && (hit.ranged || score === hit.n) ? hit.cell.id : null, score, comment: str(raw.comments, 20000) };
    }
    m.result = out;
    return finish(m, str);
  };

  const TYPES = { PERCENTAGE: 'percent', PERCENTAGE_RANGE: 'percent-range', NUMERIC: 'points', NUMERIC_RANGE: 'points-range', NONNUMERIC: 'none' };
  const ultra = (d, a, e, context = {}) => {
    if (!obj(d) || !obj(a) || !obj(context) || context.columnBound !== true || !bb(context.courseId) || !bb(context.columnId) || !bb(context.userId) || context.contentId != null && !bb(context.contentId) || !bb(d.id) || d.courseId !== context.courseId || !bb(a.id) || a.rubricId !== d.id || !own(TYPES, d.rubricType) || !list(d.columnHeaders, 12) || !list(d.rows, 50)) return null;
    const visible = { before: 'displayBefore', after: 'displayAfter', graded: 'displayGraded' };
    if (!own(visible, context.state) || a[visible[context.state]] !== true) return null;
    const kind = TYPES[d.rubricType], numeric = kind === 'points' || kind === 'points-range', none = kind === 'none';
    const possible = positive(context.pointsPossible), maximum = numeric ? d.rows.reduce((n, r) => positive(r?.rowPoints) === null ? NaN : n + r.rowPoints, 0) : 100;
    if (numeric && (possible === null || !Number.isFinite(maximum))) return null;
    const scale = (n) => n === null ? null : maximum === 0 ? 0 : num(possible * (n / maximum));
    const str = text(), levels = new Map(), rows = new Map(), cells = new Map(), positions = new Set();
    const m = { site: 'ultra', title: str(d.title), detail: str(d.description, 20000), kind, hidePoints: none, hideTotal: none,
      total: possible, levels: [], criteria: [], result: null };
    for (const c of d.columnHeaders) {
      if (!bb(c?.id) || levels.has(c.id) || !Number.isInteger(c.position) || c.position < 0 || positions.has(c.position)) return null;
      levels.set(c.id, c); positions.add(c.position);
    }
    for (const c of [...levels.values()].sort((x, y) => x.position - y.position)) m.levels.push({ id: c.id, label: str(c.header || c.localizedHeader?.rawValue) });
    positions.clear();
    for (const raw of d.rows) {
      if (!bb(raw?.id) || rows.has(raw.id) || !Number.isInteger(raw.position) || raw.position < 0 || positions.has(raw.position) || !list(raw.cells, 12)) return null;
      positions.add(raw.position);
      const row = { id: raw.id, label: str(raw.header || raw.localizedHeader?.rawValue), detail: '', weight: numeric || none ? null : percent(raw.percentage), points: numeric ? scale(positive(raw.rowPoints)) : null, unscored: none, cells: [] };
      if (numeric && row.points === null || !numeric && !none && row.weight === null) return null;
      const columns = new Set(); rows.set(raw.id, { row, raw });
      for (const c of raw.cells) {
        if (!bb(c?.id) || cells.has(c.id) || c.rubricRowId !== raw.id || !levels.has(c.rubricColumnId) || columns.has(c.rubricColumnId)) return null;
        columns.add(c.rubricColumnId);
        let value = null;
        if (kind === 'percent' && percent(c.percentage) !== null) value = { n: c.percentage };
        if (kind === 'points' && positive(c.numericPoints) !== null) { const n = rounded(scale(c.numericPoints)); if (n !== null) value = { n }; }
        if (kind === 'percent-range') value = range(percent(c.percentageMin), percent(c.percentageMax), false);
        if (kind === 'points-range') value = range(scale(positive(c.startPointRange)), scale(positive(c.endPointRange)), false);
        if (!none && !value) return null;
        const cell = { id: c.id, level: c.rubricColumnId, label: '', detail: str(c.description, 20000), value };
        row.cells.push(cell); cells.set(c.id, { cell, row: row.id, raw: c });
      }
      if (columns.size !== levels.size) return null;
      row.cells.sort((x, y) => levels.get(x.level).position - levels.get(y.level).position);
    }
    m.criteria = [...rows.values()].sort((x, y) => x.raw.position - y.raw.position).map((x) => x.row);
    // Ultra leaves a student's own evaluation unpublished and without a userId once graded: the state gates it, and a userId
    // can only be the student's.
    if (context.state !== 'graded' || !obj(e) || !bb(e.id) || e.rubricAssociationId !== a.id || !bb(context.attemptId) || e.attemptId !== context.attemptId || e.userId != null && e.userId !== context.userId || !list(e.cells, 50)) return finish(m, str);
    const out = result('html'); out.score = num(e.totalScore); out.possible = positive(e.maxScore);
    for (const c of e.cells) {
      const hit = cells.get(c?.rubricCellId), row = rows.get(c?.rubricRowId)?.row;
      if (!hit || !row || hit.row !== row.id || own(out.criteria, row.id)) return finish(m, str);
      let score = null;
      if (kind === 'percent' || kind === 'percent-range') score = percent(c.selectedPercent);
      if (kind === 'points') score = rounded(scale(positive(c.selectedPercent)));
      if (kind === 'points-range' && positive(c.selectedPercent) !== null && c.selectedPercent <= 1 && row.points !== null) score = rounded(row.points * c.selectedPercent);
      out.criteria[row.id] = { cell: hit.cell.id, score, comment: str(c.feedback?.rawText, 20000) };
    }
    m.result = out;
    return finish(m, str);
  };

  const mode = (settings) => {
    const s = settings?.rubric;
    return s?.show === 'site' ? 'site' : s?.show === 'popup' || s?.inline === false ? 'popup' : 'auto-inline';
  };
  const room = (width, model, fontSize = 16, previousInline = false) => {
    if (positive(width) === null || width === 0 || positive(fontSize) === null || fontSize === 0 || !list(model?.criteria, 50) || !list(model?.levels, 12, true)) return false;
    const scale = fontSize / 16, need = (176 + 128 * Math.max(1, model.levels.length) + 32) * scale;
    return width >= need - (previousInline === true ? 24 * scale : 0);
  };
  const route = (site, pathname) => {
    if (typeof pathname !== 'string' || pathname.length > 240) return null;
    const c = site === 'canvas' && /^\/courses\/([1-9]\d{0,39})\/assignments\/([1-9]\d{0,39})\/?$/.exec(pathname);
    if (c) return { courseId: c[1], assignmentId: c[2], view: 'assignment' };
    const u = site === 'ultra' && /^\/ultra\/courses\/(_\d+_\d+)\/assessment\/(_\d+_\d+)\/(overview|attempt(?:\/create)?)\/?$/.exec(pathname);
    return u && bb(u[1]) && bb(u[2]) ? { courseId: u[1], contentId: u[2], view: u[3] === 'overview' ? 'overview' : 'attempt' } : null;
  };
  return { parse: { canvas, ultra }, room, mode, route };
})();

if (typeof module !== 'undefined') module.exports = GZ_RUBRIC_LIB; else GZ_RUBRIC_LIB;
