// iCalendar (RFC 5545): read .ics files and feeds (schedule import) and write them (calendar export).
// Pure, so node can test it. Classic script for extension pages and on demand (a second injection keeps the first);
// module.exports for node.
//
// parse(text | bytes, { tz, limits }) → { name, tz, events: [event], problems: [{ uid, reason }], truncated }
//   event: { uid, summary, description, location, url, status, categories, allDay, start, end, tz,
//            rrule, rdates, exdates, recurrenceId, unsupported }
//   Timed events: start/end are epoch ms and tz names the zone they were written in ('UTC' for Z times).
//   All-day events: start/end are 'YYYY-MM-DD', end exclusive. A recurring event keeps its rule; expand()
//   lists its occurrences. `unsupported` lists what this reader can't follow ('RRULE BYMONTH',
//   'RANGE=THISANDFUTURE', …); if it touches the rule, expand() gives only the first occurrence (plus
//   RDATEs), so the caller can warn instead of inventing dates. Events with an impossible DTSTART are
//   left out and listed in `problems`.
// expand(cal, from, to, { limits }) → [{ event, start, end }] overlapping [from, to), soonest first;
//   the array has `truncated: true` if a limit cut it short.
// write({ name, events }, { now }) → the calendar as a string (CRLF, folded at 75 octets).
var GZ_ICS = globalThis.GZ_ICS || (() => {
  const DAY = 864e5;
  const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  // Work bounds, so a hostile or broken file can't hang the page: input size, events kept, occurrences
  // returned, work steps per parse() and per expand() (zone onsets read, dates listed, rule steps), the
  // largest INTERVAL/COUNT followed, and observances per time zone (real ones have a few dozen).
  const LIMITS = { bytes: 16 << 20, events: 50000, occurrences: 50000, steps: 1e6, interval: 10000, count: 100000, observances: 1000 };
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const iso = (w) => new Date(w).toISOString().slice(0, 10);
  // Wall-clock ms for a date and time, or NaN when any part is out of range (Feb 30, 25:00).
  // setUTCFullYear, unlike Date.UTC, keeps years 0–99 as written.
  const wall = (y, mo, d, h = 0, mi = 0, s = 0) => {
    if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return NaN;
    const t = new Date(0);
    t.setUTCFullYear(y, mo - 1, d);
    t.setUTCHours(h, mi, Math.min(s, 59)); // a leap second reads as :59
    return t.getUTCDate() === d && t.getUTCMonth() === mo - 1 ? t.getTime() : NaN;
  };

  // Zones. An offset function maps an instant to its UTC offset in ms (local = instant + offset).
  const intlCache = new Map();
  const intl = (tz) => {
    if (!tz || typeof tz !== 'string') return null;
    if (intlCache.has(tz)) return intlCache.get(tz);
    let off = null;
    try {
      const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
      off = (ms) => {
        const p = {};
        for (const x of f.formatToParts(ms)) p[x.type] = x.value;
        return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
      };
    } catch { /* not an IANA zone */ }
    intlCache.set(tz, off);
    return off;
  };
  const UTC = () => 0;

  // Local wall time (ms as if UTC) → instant. RFC 5545 §3.3.5: a repeated local time means its first
  // occurrence; a skipped one is read with the offset from before the gap.
  const toUtc = (w, off) => {
    const a = off(w - DAY), b = off(w + DAY);
    if (a === b) return w - a;
    const fits = [w - a, w - b].filter((t, i) => off(t) === (i ? b : a));
    return fits.length ? Math.min(...fits) : w - a;
  };
  // Whether a local wall time exists (it doesn't inside a spring-forward gap).
  const exists = (w, off) => { const t = toUtc(w, off); return t + off(t) === w; };

  // 'n'th weekday of a month as a day number; n < 0 counts from the end.
  const nthDay = (y, m, n, wd) => {
    if (n > 0) return 1 + ((wd - new Date(Date.UTC(y, m, 1)).getUTCDay() + 7) % 7) + (n - 1) * 7;
    const last = new Date(Date.UTC(y, m + 1, 0));
    return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7) + (n + 1) * 7;
  };
  const offset = (v) => {
    const m = /^([+-])(\d\d)(\d\d)(\d\d)?$/.exec(v || '');
    return m ? (m[1] === '-' ? -1 : 1) * ((+m[2] * 60 + +m[3]) * 60 + +(m[4] || 0)) * 1000 : 0;
  };
  // A VTIMEZONE's offset at an instant: that of the latest observance onset at or before it. Observances
  // repeat yearly by BYMONTH plus BYDAY ("2SU", "-1SU") or BYMONTHDAY, which is all Outlook, Google and
  // Apple write; anything else counts only at its DTSTART and RDATEs. Onsets are listed and sorted once (the
  // yearly ones once per year asked) and found by binary search; each listed onset is charged to the running
  // parse() or expand(). Of onsets at the same instant, the first written wins.
  let charge = () => {};
  const vtimezone = (obs) => {
    if (!obs || !obs.length) return null;
    const first = obs.reduce((a, o) => (o.w < a.w ? o : a));
    const fixed = [], yearly = [];
    const onset = (list, o, i, w, cut) => {
      const t = w - o.from;
      if (w >= o.w && t === t && !(cut != null && t > cut)) list.push({ t, to: o.to, i });
    };
    obs.forEach((o, i) => {
      const r = o.rule, month = +r.BYMONTH, by = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(r.BYDAY || '');
      const until = r.UNTIL ? stamp(r.UNTIL) : null;
      const cut = until ? (until.utc ? until.w : until.w - o.from) : null;
      charge(1 + o.rdates.length);
      for (const w of [o.w, ...o.rdates]) onset(fixed, o, i, w, cut);
      if (r.FREQ === 'YEARLY' && month >= 1 && month <= 12 && (by || r.BYMONTHDAY)) {
        yearly.push((list, yy) => {
          const day = by ? nthDay(yy, month - 1, +(by[1] || 1), WD.indexOf(by[2])) : +r.BYMONTHDAY;
          onset(list, o, i + 0.5, Date.UTC(yy, month - 1, day) + (o.w % DAY + DAY) % DAY, cut);
        });
      }
    });
    fixed.sort((a, b) => a.t - b.t);
    const years = new Map();
    const ofYear = (y) => {
      if (years.has(y)) return years.get(y);
      charge(2 * yearly.length);
      const list = [];
      for (const yy of [y - 1, y]) for (const f of yearly) f(list, yy);
      list.sort((a, b) => a.t - b.t || a.i - b.i);
      // Expansion windows can span centuries, and a calendar can be expanded repeatedly.
      if (years.size >= 8) years.delete(years.keys().next().value);
      years.set(y, list);
      return list;
    };
    // The first of the latest onsets at or before ms.
    const latest = (list, ms) => {
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].t <= ms) lo = mid + 1; else hi = mid; }
      if (!lo) return null;
      const t = list[lo - 1].t;
      hi = lo - 1; lo = 0;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].t < t) lo = mid + 1; else hi = mid; }
      return list[lo];
    };
    return (ms) => {
      const a = latest(fixed, ms), b = yearly.length ? latest(ofYear(new Date(ms).getUTCFullYear()), ms) : null;
      const best = !a ? b : !b ? a : a.t !== b.t ? (a.t > b.t ? a : b) : a.i < b.i ? a : b;
      return best ? best.to : first.from;
    };
  };

  // '20261015' | '20261015T0900[00][Z]' → { w: wall ms, date, utc }, or null if malformed or impossible.
  const stamp = (v) => {
    const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/i.exec(String(v).trim());
    if (!m) return null;
    const w = wall(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return Number.isNaN(w) ? null : { w, date: !m[4], utc: !!m[7] };
  };
  // DURATION → { days, ms }: weeks and days are nominal (calendar days), hours to seconds are exact.
  const duration = (v) => {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v).trim());
    if (!m || m[1] === '-') return null;
    return { days: +(m[2] || 0) * 7 + +(m[3] || 0), ms: ((+(m[4] || 0) * 60 + +(m[5] || 0)) * 60 + +(m[6] || 0)) * 1000 };
  };
  const text = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
  const list = (v) => (v.match(/(?:\\.|[^,])+/g) || []).map(text);

  // One content line: NAME;PARAM=a,"b;c":value. Separators inside quoted parameter values don't count.
  const line = (s) => {
    const params = Object.create(null);
    let name = null, start = 0, q = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') q = !q;
      else if (!q && (c === ';' || c === ':')) {
        const part = s.slice(start, i);
        if (name === null) name = part.toUpperCase();
        else {
          const eq = part.indexOf('=');
          if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/"/g, '');
        }
        start = i + 1;
        if (c === ':') return { name, params, value: s.slice(start) };
      }
    }
    return null;
  };

  // Folds are removed before decoding when given bytes, so a fold inside a UTF-8 sequence still decodes.
  const lines = (input, limit) => {
    if (typeof input !== 'string') {
      const b = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (b.length > limit) throw new RangeError('calendar file too large');
      const out = new Uint8Array(b.length);
      let n = 0;
      for (let i = 0; i < b.length; i++) {
        if (b[i] === 13 && b[i + 1] === 10 && (b[i + 2] === 32 || b[i + 2] === 9)) i += 2;
        else if (b[i] === 10 && (b[i + 1] === 32 || b[i + 1] === 9)) i += 1;
        else out[n++] = b[i];
      }
      input = new TextDecoder().decode(out.subarray(0, n));
    } else if (input.length > limit) throw new RangeError('calendar file too large');
    return input.replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n|\r/);
  };

  const rule = (v) => {
    const r = Object.create(null);
    for (const kv of v.split(';')) {
      const eq = kv.indexOf('=');
      if (eq > 0) r[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
    }
    return r;
  };
  const RULE_KEYS = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY']);

  // event → { w, off, dur, zoneOff }: wall-clock start, its zone, its length, the calendar's zone.
  // ponytail: a copied event (structuredClone, storage) loses this, and expand() then rebuilds it from tz,
  // which only works for IANA zones; expand right after parse, or store occurrences.
  const meta = new WeakMap();

  const parse = (input, opts = {}) => {
    const L = { ...LIMITS, ...opts.limits };
    const cal = { name: '', tz: '', events: [], problems: [], truncated: false };
    const zones = new Map(); // TZID → observances
    const raw = [];
    let work = L.steps;
    const spend = charge = (n) => { if ((work -= n) < 0) throw new RangeError('calendar too complex'); };
    let ev = null, tzid = null, obs = null, depth = 0;
    for (const l of lines(input, L.bytes)) {
      const p = line(l);
      if (!p) continue;
      const v = p.value;
      if (p.name === 'BEGIN') {
        const what = v.toUpperCase();
        if (depth === 1 && what === 'VEVENT') ev = { props: [] };
        else if (depth === 1 && what === 'VTIMEZONE') tzid = '';
        else if (depth === 2 && tzid !== null && (what === 'STANDARD' || what === 'DAYLIGHT')) {
          spend(1);
          obs = { rdates: [], rule: Object.create(null) };
        }
        depth++;
      } else if (p.name === 'END') {
        depth--;
        const what = v.toUpperCase();
        if (what === 'VEVENT' && ev && depth === 1) {
          if (raw.length < L.events) raw.push(ev); else cal.truncated = true;
          ev = null;
        } else if (what === 'VTIMEZONE' && depth === 1) tzid = null;
        else if (obs && depth === 2) {
          if (obs.w != null) {
            if (!zones.has(tzid)) zones.set(tzid, []);
            if (zones.get(tzid).push(obs) > L.observances) throw new RangeError('calendar time zone too large');
          }
          obs = null;
        }
      } else if (obs) {
        if (p.name === 'DTSTART') obs.w = stamp(v)?.w;
        else if (p.name === 'TZOFFSETFROM') obs.from = offset(v);
        else if (p.name === 'TZOFFSETTO') obs.to = offset(v);
        else if (p.name === 'RRULE') obs.rule = rule(v);
        else if (p.name === 'RDATE') for (const d of v.split(',')) { spend(1); const s = stamp(d); if (s) obs.rdates.push(s.w); }
      } else if (tzid !== null && depth === 2 && p.name === 'TZID') tzid = v;
      else if (ev && depth === 2) ev.props.push(p);
      else if (depth === 1 && p.name === 'X-WR-CALNAME') cal.name = text(v);
      else if (depth === 1 && p.name === 'X-WR-TIMEZONE') cal.tz = v.trim();
    }

    const fallback = intl(opts.tz) ? opts.tz : intl(cal.tz) ? cal.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zoneCache = new Map();
    // TZID → [name, offset fn]: an IANA name, an IANA name at the end of a longer TZID
    // ("/mozilla.org/20050126_1/America/New_York"), the file's own VTIMEZONE (Outlook's "Eastern Standard
    // Time"), or else the fallback zone.
    const zone = (id) => {
      if (!id) return [fallback, intl(fallback)];
      if (zoneCache.has(id)) return zoneCache.get(id);
      const tail = /[A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/.exec(id)?.[0];
      const own = vtimezone(zones.get(id));
      const z = intl(id) ? [id, intl(id)] : intl(tail) ? [tail, intl(tail)] : own ? [id, own] : [fallback, intl(fallback)];
      zoneCache.set(id, z);
      return z;
    };
    // A DATE or DATE-TIME property → 'YYYY-MM-DD' or { t: instant, w: wall in its zone, z: [name, off] }
    const when = (p, value = p.value) => {
      const s = stamp(value.split(',')[0]);
      if (!s) return null;
      if (s.date || p.params.VALUE === 'DATE') return iso(s.w);
      const z = s.utc ? ['UTC', UTC] : zone(p.params.TZID);
      return { t: toUtc(s.w, z[1]), w: s.w, z };
    };
    const instants = (p) => p.value.split(',').map((x) => (spend(1), when(p, x))).filter(Boolean).map((x) => (typeof x === 'string' ? x : x.t));

    for (const { props } of raw) {
      const get = (n) => props.find((p) => p.name === n);
      const uid = get('UID') ? text(get('UID').value).trim() : '';
      const dtstart = get('DTSTART') && when(get('DTSTART'));
      if (!dtstart) { cal.problems.push({ uid, reason: get('DTSTART') ? 'impossible DTSTART' : 'no DTSTART' }); continue; }
      const allDay = typeof dtstart === 'string';
      const unsupported = [];
      const rid = get('RECURRENCE-ID');
      if (rid?.params.RANGE) unsupported.push(`RANGE=${rid.params.RANGE.toUpperCase()}`);
      if (get('EXRULE')) unsupported.push('EXRULE');
      const rdates = [];
      for (const p of props.filter((x) => x.name === 'RDATE')) {
        if (p.params.VALUE === 'PERIOD' || /\//.test(p.value)) unsupported.push('RDATE PERIOD');
        else rdates.push(...instants(p));
      }
      const e = {
        uid,
        summary: get('SUMMARY') ? text(get('SUMMARY').value) : '',
        description: get('DESCRIPTION') ? text(get('DESCRIPTION').value) : '',
        location: get('LOCATION') ? text(get('LOCATION').value) : '',
        url: get('URL')?.value.trim() || '',
        status: get('STATUS')?.value.trim().toUpperCase() || '',
        categories: props.filter((p) => p.name === 'CATEGORIES').flatMap((p) => list(p.value)),
        allDay,
        start: allDay ? dtstart : dtstart.t,
        end: null,
        tz: allDay ? '' : dtstart.z[0],
        rrule: null,
        rdates,
        exdates: props.filter((p) => p.name === 'EXDATE').flatMap(instants),
        recurrenceId: rid ? instants(rid)[0] ?? null : null,
        unsupported,
      };
      // Length (RFC 5545 §3.8.5.3): a DTEND gives every occurrence the same exact length; a DURATION
      // is nominal days plus exact hours; an all-day event lasts whole days.
      const dtend = get('DTEND') && when(get('DTEND'));
      if (get('DTEND') && !dtend) cal.problems.push({ uid, reason: 'impossible DTEND' });
      const dur = get('DURATION') && duration(get('DURATION').value);
      const w = allDay ? Date.parse(dtstart) : dtstart.w;
      let d;
      if (allDay) d = { days: typeof dtend === 'string' && dtend > dtstart ? (Date.parse(dtend) - w) / DAY : Math.max(1, dur?.days || 0), ms: 0 };
      else if (dtend && typeof dtend !== 'string' && dtend.t >= dtstart.t) d = { days: 0, ms: dtend.t - dtstart.t };
      else d = dur || { days: 0, ms: 0 };
      const rr = get('RRULE');
      if (rr) {
        const r = rule(rr.value);
        const byday = r.BYDAY ? r.BYDAY.split(',') : [];
        const int = (x) => (/^\d+$/.test(x || '') ? +x : NaN);
        const until = r.UNTIL ? stamp(r.UNTIL) : null;
        e.rrule = {
          freq: r.FREQ || '',
          interval: r.INTERVAL == null ? 1 : int(r.INTERVAL),
          count: r.COUNT == null ? null : int(r.COUNT),
          until: !until ? null : until.date ? iso(until.w) : until.utc ? until.w : toUtc(until.w, allDay ? UTC : dtstart.z[1]),
          byday,
          wkst: WD.includes(r.WKST) ? r.WKST : 'MO',
        };
        const R = e.rrule;
        if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(R.freq)) unsupported.push(`RRULE FREQ=${R.freq}`);
        for (const k of Object.keys(r)) if (!RULE_KEYS.has(k)) unsupported.push(`RRULE ${k}`);
        if (!(R.interval >= 1 && R.interval <= L.interval)) unsupported.push('RRULE INTERVAL');
        if (R.count != null && !(R.count >= 1 && R.count <= L.count)) unsupported.push('RRULE COUNT');
        if (r.UNTIL && !until) unsupported.push('RRULE UNTIL');
        if (byday.some((x) => !WD.includes(x)) || (byday.length && !['DAILY', 'WEEKLY'].includes(R.freq))) unsupported.push('RRULE BYDAY');
      }
      const m = { w, off: allDay ? UTC : dtstart.z[1], dur: d, zoneOff: intl(fallback) };
      meta.set(e, m);
      e.end = endOf(e, m, w);
      cal.events.push(e);
    }
    cal.tz = cal.tz || fallback;
    return cal;
  };

  // Start and end of one occurrence from its wall-clock start `w`, or from an explicit instant `t` (a timed
  // RDATE), which is kept as given: in a fall-back hour its wall time names two instants.
  const startOf = (e, m, w, t) => (e.allDay ? iso(w) : t ?? toUtc(w, m.off));
  const endOf = (e, m, w, t) => {
    if (e.allDay) return iso(w + m.dur.days * DAY);
    return (m.dur.days ? toUtc(w + m.dur.days * DAY, m.off) : startOf(e, m, w, t)) + m.dur.ms;
  };

  // Wall-clock starts of a recurring event, DTSTART first (RFC 5545 counts it as the first occurrence).
  // Generated times that don't exist locally (inside a DST gap) are skipped and not counted (§3.3.10).
  // Stops at COUNT, UNTIL, past `last` (wall ms), or when the shared step budget runs out.
  function* walls(r, w0, last, untilOk, real, budget) {
    let n = 0;
    const emit = (w) => (r.count != null && n >= r.count) || !untilOk(w) ? false : (n++, true);
    const step = () => --budget.steps >= 0 || ((budget.truncated = true), false);
    if (!emit(w0)) return;
    yield w0;
    const tod = ((w0 % DAY) + DAY) % DAY, day0 = w0 - tod;
    const k = r.interval;
    if (r.freq === 'WEEKLY') {
      const wk = WD.indexOf(r.wkst);
      const days = [...new Set((r.byday.length ? r.byday : [WD[new Date(day0).getUTCDay()]]).map((d) => (WD.indexOf(d) - wk + 7) % 7))].sort((a, b) => a - b);
      for (let ws = day0 - ((new Date(day0).getUTCDay() - wk + 7) % 7) * DAY; ws <= last; ws += 7 * DAY * k) {
        for (const o of days) {
          if (!step()) return;
          const w = ws + o * DAY + tod;
          if (w <= w0 || !real(w)) continue;
          if (w > last || !emit(w)) return;
          yield w;
        }
      }
    } else if (r.freq === 'DAILY') {
      const days = new Set(r.byday);
      for (let w = w0 + k * DAY; w <= last; w += k * DAY) {
        if (!step()) return;
        if ((days.size && !days.has(WD[new Date(w).getUTCDay()])) || !real(w)) continue;
        if (!emit(w)) return;
        yield w;
      }
    } else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
      const d0 = new Date(day0), months = r.freq === 'YEARLY' ? 12 * k : k;
      for (let i = 1; ; i++) {
        if (!step()) return;
        const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i * months, d0.getUTCDate()));
        const w = d.getTime() + tod;
        if (!(w <= last)) return; // also stops on NaN, past the end of representable dates
        if (d.getUTCDate() !== d0.getUTCDate() || !real(w)) continue; // no Feb 30th: RFC 5545 skips it
        if (!emit(w)) return;
        yield w;
      }
    }
  }

  const expand = (cal, from, to, opts = {}) => {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new RangeError('expand needs a finite window, from <= to');
    const L = { ...LIMITS, ...opts.limits };
    const out = [];
    const budget = { steps: L.steps, truncated: false };
    const exhausted = {};
    charge = (n) => { if ((budget.steps -= n) < 0) throw exhausted; };
    const moved = new Set(cal.events.filter((e) => e.recurrenceId != null).map((e) => e.uid + '|' + e.recurrenceId));
    try {
      for (const e of cal.events) {
        if (budget.truncated) break;
        let m = meta.get(e);
        if (!m) {
          const off = e.allDay ? UTC : intl(e.tz) || UTC;
          const w = e.allDay ? Date.parse(e.start) : e.start + off(e.start);
          m = { w, off, dur: e.allDay ? { days: (Date.parse(e.end) - w) / DAY, ms: 0 } : { days: 0, ms: e.end - e.start }, zoneOff: intl(cal.tz) };
        }
        const local = m.zoneOff || UTC;
        // All-day dates are days in the calendar's zone.
        const instant = (v) => (typeof v === 'string' ? toUtc(Date.parse(v), local) : v);
        const push = (w, t) => {
          if (out.length >= L.occurrences) { budget.truncated = true; return; }
          const start = startOf(e, m, w, t), end = endOf(e, m, w, t);
          const s = instant(start), en = Math.max(instant(end), s);
          if ((en > from && s < to) || (s === en && s >= from && s < to)) out.push({ event: e, start, end });
        };
        if (e.status === 'CANCELLED') continue;
        if (e.recurrenceId != null || (!e.rrule && !e.rdates.length)) { push(m.w); continue; }
        const ruleOk = !e.unsupported.some((x) => x.startsWith('RRULE'));
        const r = e.rrule && ruleOk ? e.rrule : { freq: '', interval: 1, count: 1, until: null, byday: [], wkst: 'MO' };
        const ex = new Set(e.exdates);
        const until = r.until;
        const untilOk = until == null ? () => true : typeof until === 'string' ? (w) => iso(w) <= until : (w) => instant(startOf(e, m, w)) <= until;
        const real = e.allDay ? () => true : (w) => exists(w, m.off);
        const last = to + 2 * DAY; // wall ms past the window, whatever the zone
        const seen = new Set();
        const add = (w, t) => {
          const v = startOf(e, m, w, t);
          if (seen.has(v)) return;
          seen.add(v);
          if (ex.has(v) || (!e.allDay && ex.has(iso(w))) || moved.has(e.uid + '|' + v)) return;
          push(w, t);
        };
        for (const w of walls(r, m.w, last, untilOk, real, budget)) add(w);
        // RDATEs add occurrences outside the rule; COUNT doesn't apply to them.
        for (const rd of e.rdates) {
          if (--budget.steps < 0) { budget.truncated = true; break; }
          if (typeof rd === 'string') add(Date.parse(rd));
          else if (e.allDay) add(Date.parse(iso(rd))); // a timed RDATE on an all-day event names its day
          else add(rd + m.off(rd), rd);
        }
      }
    } catch (err) {
      if (err !== exhausted) throw err;
      budget.truncated = true;
    }
    const key = (o) => (typeof o.start === 'string' ? Date.parse(o.start) : o.start);
    out.sort((a, b) => key(a) - key(b));
    if (budget.truncated) out.truncated = true;
    return out;
  };

  // Writing. Text is escaped, control characters dropped, lines folded at 75 octets without splitting a
  // character. Timed values are written in UTC; 'YYYY-MM-DD' is an all-day date; 'YYYY-MM-DDTHH:MM' is a
  // floating local time (a class at 9:00 stays at 9:00 in whatever zone the calendar is in).
  // ponytail: floating times instead of TZID + generated VTIMEZONE; add those if exports must pin a zone.
  const clean = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  const esc = (s) => clean(s).replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
  const enc = new TextEncoder();
  const fold = (l) => {
    if (enc.encode(l).length <= 75) return l;
    let out = '', n = 0;
    for (const ch of l) {
      const b = enc.encode(ch).length;
      if (n + b > 75) { out += '\r\n '; n = 1; }
      out += ch;
      n += b;
    }
    return out;
  };
  const utc = (ms) => { const d = new Date(ms); return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
  // A writer value → { kind: 'utc' | 'date' | 'floating', text, key (sortable) }, or a RangeError.
  const value = (v) => {
    if (typeof v === 'number') {
      const y = new Date(v).getUTCFullYear();
      if (!(y >= 1 && y <= 9999)) throw new RangeError(`not a date: ${v}`);
      return { kind: 'utc', text: utc(v), key: v };
    }
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?$/.exec(String(v));
    if (!m || Number.isNaN(wall(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)))) throw new RangeError(`not a date: ${v}`);
    const day = `${m[1]}${m[2]}${m[3]}`;
    return m[4] ? { kind: 'floating', text: `${day}T${m[4]}${m[5]}${m[6] || '00'}`, key: `${day}T${m[4]}${m[5]}${m[6] || '00'}` } : { kind: 'date', text: day, key: day };
  };
  const prop = (name, x) => `${name}${x.kind === 'date' ? ';VALUE=DATE:' : ':'}${x.text}`;
  const rrule = (r, start) => {
    if (!/^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(r.freq)) throw new RangeError(`unsupported FREQ: ${r.freq}`);
    const n = (x, what) => { if (!Number.isSafeInteger(x) || x < 1) throw new RangeError(`bad ${what}: ${x}`); return x; };
    const parts = [`FREQ=${r.freq}`];
    if (r.interval != null && n(r.interval, 'INTERVAL') > 1) parts.push(`INTERVAL=${r.interval}`);
    // UNTIL takes DTSTART's form (RFC 5545 §3.3.10) and keeps its full value. The one convenience: a
    // day ('YYYY-MM-DD') as the cutoff of a floating-time rule means the end of that day.
    if (r.until != null) {
      const u = value(r.until);
      if (u.kind === start.kind) parts.push(`UNTIL=${u.text}`);
      else if (start.kind === 'floating' && u.kind === 'date') parts.push(`UNTIL=${u.text}T235959`);
      else throw new RangeError(`UNTIL ${r.until} doesn't match DTSTART's form`);
    } else if (r.count != null) parts.push(`COUNT=${n(r.count, 'COUNT')}`);
    if (r.byday?.length) {
      if (r.byday.some((d) => !WD.includes(d))) throw new RangeError(`bad BYDAY: ${r.byday}`);
      parts.push(`BYDAY=${r.byday.join(',')}`);
    }
    if (r.wkst && r.wkst !== 'MO' && WD.includes(r.wkst)) parts.push(`WKST=${r.wkst}`);
    return parts.join(';');
  };

  const write = (cal, { now = Date.now() } = {}) => {
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//frostdev//Glaze//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (cal.name) out.push(`X-WR-CALNAME:${esc(cal.name)}`);
    const stampNow = value(now);
    for (const e of cal.events || []) {
      if (!e.uid) throw new RangeError('every event needs a stable uid');
      const s = value(e.start);
      out.push('BEGIN:VEVENT', `UID:${esc(e.uid)}`, `DTSTAMP:${stampNow.text}`, prop('DTSTART', s));
      // DTEND has DTSTART's form and comes later; an instant (a deadline) has none.
      if (e.end != null) {
        const en = value(e.end);
        if (en.kind !== s.kind) throw new RangeError(`DTEND ${e.end} doesn't match DTSTART's form`);
        if (en.key < s.key || (en.key === s.key && s.kind === 'date')) throw new RangeError(`DTEND ${e.end} is before DTSTART`);
        if (en.key !== s.key) out.push(prop('DTEND', en));
      }
      if (e.rrule) out.push(`RRULE:${rrule(e.rrule, s)}`);
      if (e.summary) out.push(`SUMMARY:${esc(e.summary)}`);
      if (e.description) out.push(`DESCRIPTION:${esc(e.description)}`);
      if (e.location) out.push(`LOCATION:${esc(e.location)}`);
      if (/^https?:\/\//i.test(e.url || '')) out.push(`URL:${clean(e.url).replace(/\s/g, '')}`);
      if (e.categories?.length) out.push(`CATEGORIES:${e.categories.map(esc).join(',')}`);
      out.push('END:VEVENT');
    }
    out.push('END:VCALENDAR');
    return out.map(fold).join('\r\n') + '\r\n';
  };

  // A UID that stays the same each time the same item is exported, so re-importing updates it in place.
  // Each part is percent-encoded and the parts are joined by "/", which encoding never leaves inside a
  // part, so different parts never give the same UID.
  const uid = (...parts) => parts.map((p) => encodeURIComponent(String(p))).join('/') + '@glaze';

  return { parse, expand, write, uid, LIMITS };
})();

if (typeof module !== 'undefined') module.exports = GZ_ICS; else GZ_ICS;
