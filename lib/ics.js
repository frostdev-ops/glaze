// iCalendar (RFC 5545): read .ics files and feeds (schedule import) and write them (calendar export).
// Pure, so node can test it. Classic script for extension pages; module.exports for node.
//
// parse(text | bytes, { tz }) → { name, tz, events: [event] }
//   event: { uid, summary, description, location, url, status, categories, allDay, start, end, tz,
//            rrule, exdates, recurrenceId }
//   Timed events: start/end are epoch ms and tz names the zone they were written in ('UTC' for Z times).
//   All-day events: start/end are 'YYYY-MM-DD', end exclusive. A recurring event keeps its rule; expand()
//   lists its occurrences. rrule.unsupported marks a rule this reader can't follow; expand() then gives
//   only its first occurrence, so the caller can warn instead of inventing dates.
// expand(cal, from, to) → [{ event, start, end }] overlapping [from, to), soonest first.
// write({ name, events }, { now }) → the calendar as a string (CRLF, folded at 75 octets).
const GZ_ICS = (() => {
  const DAY = 864e5;
  const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (w) => new Date(w).toISOString().slice(0, 10);

  // Zones. An offset function maps an instant to its UTC offset in ms (local = instant + offset).
  const intlCache = new Map();
  const intl = (tz) => {
    if (!tz) return null;
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
  // Apple write; anything else counts only at its DTSTART and RDATEs.
  const vtimezone = (obs) => {
    if (!obs.length) return null;
    const first = obs.reduce((a, o) => (o.w < a.w ? o : a));
    return (ms) => {
      let best = -Infinity, to = first.from;
      const y = new Date(ms).getUTCFullYear();
      for (const o of obs) {
        const walls = [o.w, ...o.rdates];
        const r = o.rule, month = +r.BYMONTH, by = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(r.BYDAY || '');
        if (r.FREQ === 'YEARLY' && month >= 1 && month <= 12 && (by || r.BYMONTHDAY)) {
          for (const yy of [y - 1, y]) {
            const day = by ? nthDay(yy, month - 1, +(by[1] || 1), WD.indexOf(by[2])) : +r.BYMONTHDAY;
            walls.push(Date.UTC(yy, month - 1, day) + (o.w % DAY + DAY) % DAY);
          }
        }
        const until = r.UNTIL ? stamp(r.UNTIL) : null;
        for (const w of walls) {
          const t = w - o.from;
          if (w >= o.w && t <= ms && t > best && !(until && t > (until.utc ? until.w : until.w - o.from))) { best = t; to = o.to; }
        }
      }
      return to;
    };
  };

  // '20261015' | '20261015T0900[00][Z]' → { w: wall ms, date, utc }
  const stamp = (v) => {
    const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/i.exec(String(v).trim());
    if (!m) return null;
    return { w: Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)), date: !m[4], utc: !!m[7] };
  };
  const duration = (v) => {
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(v).trim());
    return m ? (m[1] === '-' ? -1 : 1) * ((((+(m[2] || 0) * 7 + +(m[3] || 0)) * 24 + +(m[4] || 0)) * 60 + +(m[5] || 0)) * 60 + +(m[6] || 0)) * 1000 : null;
  };
  const text = (v) => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
  const list = (v) => (v.match(/(?:\\.|[^,])+/g) || []).map(text);

  // One content line: NAME;PARAM=a,"b;c":value. Separators inside quoted parameter values don't count.
  const line = (s) => {
    const params = {};
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
  const lines = (input) => {
    if (typeof input !== 'string') {
      const b = input instanceof Uint8Array ? input : new Uint8Array(input);
      const out = new Uint8Array(b.length);
      let n = 0;
      for (let i = 0; i < b.length; i++) {
        if (b[i] === 13 && b[i + 1] === 10 && (b[i + 2] === 32 || b[i + 2] === 9)) i += 2;
        else if (b[i] === 10 && (b[i + 1] === 32 || b[i + 1] === 9)) i += 1;
        else out[n++] = b[i];
      }
      input = new TextDecoder().decode(out.subarray(0, n));
    }
    return input.replace(/^﻿/, '').replace(/\r?\n[ \t]/g, '').split(/\r?\n|\r/);
  };

  const rule = (v) => {
    const r = {};
    for (const kv of v.split(';')) {
      const eq = kv.indexOf('=');
      if (eq > 0) r[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
    }
    return r;
  };

  // event → { w, endW, off, zoneOff }: wall-clock start and end, its zone, the calendar's zone.
  // ponytail: a copied event (structuredClone, storage) loses this, and expand() then rebuilds it from tz,
  // which only works for IANA zones; expand right after parse, or store occurrences.
  const meta = new WeakMap();

  const parse = (input, opts = {}) => {
    const cal = { name: '', tz: '', events: [] };
    const zones = {}; // TZID → observances
    const raw = [];
    let ev = null, tzid = null, obs = null, depth = 0;
    for (const l of lines(input)) {
      const p = line(l);
      if (!p) continue;
      const v = p.value;
      if (p.name === 'BEGIN') {
        const what = v.toUpperCase();
        if (depth === 1 && what === 'VEVENT') ev = { props: [] };
        else if (depth === 1 && what === 'VTIMEZONE') tzid = '';
        else if (depth === 2 && tzid !== null && (what === 'STANDARD' || what === 'DAYLIGHT')) obs = { rdates: [], rule: {} };
        depth++;
      } else if (p.name === 'END') {
        depth--;
        const what = v.toUpperCase();
        if (what === 'VEVENT' && ev && depth === 1) { raw.push(ev); ev = null; }
        else if (what === 'VTIMEZONE' && depth === 1) tzid = null;
        else if (obs && depth === 2) { if (obs.w != null) (zones[tzid] = zones[tzid] || []).push(obs); obs = null; }
      } else if (obs) {
        if (p.name === 'DTSTART') obs.w = stamp(v)?.w;
        else if (p.name === 'TZOFFSETFROM') obs.from = offset(v);
        else if (p.name === 'TZOFFSETTO') obs.to = offset(v);
        else if (p.name === 'RRULE') obs.rule = rule(v);
        else if (p.name === 'RDATE') for (const d of v.split(',')) { const s = stamp(d); if (s) obs.rdates.push(s.w); }
      } else if (tzid !== null && depth === 2 && p.name === 'TZID') tzid = v;
      else if (ev && depth === 2) ev.props.push(p);
      else if (depth === 1 && p.name === 'X-WR-CALNAME') cal.name = text(v);
      else if (depth === 1 && p.name === 'X-WR-TIMEZONE') cal.tz = v.trim();
    }

    const fallback = intl(opts.tz) ? opts.tz : intl(cal.tz) ? cal.tz : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zoneCache = {};
    // TZID → [name, offset fn]: an IANA name, an IANA name at the end of a longer TZID
    // ("/mozilla.org/20050126_1/America/New_York"), the file's own VTIMEZONE (Outlook's "Eastern Standard
    // Time"), or else the fallback zone.
    const zone = (id) => {
      if (!id) return [fallback, intl(fallback)];
      if (zoneCache[id]) return zoneCache[id];
      const tail = /[A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/.exec(id)?.[0];
      const z = intl(id) ? [id, intl(id)] : intl(tail) ? [tail, intl(tail)] : vtimezone(zones[id] || []) ? [id, vtimezone(zones[id])] : [fallback, intl(fallback)];
      return (zoneCache[id] = z);
    };
    // A DATE or DATE-TIME property → 'YYYY-MM-DD' or { t: instant, w: wall in its zone, z: [name, off] }
    const when = (p) => {
      const s = stamp(p.value.split(',')[0]);
      if (!s) return null;
      if (s.date || p.params.VALUE === 'DATE') return iso(s.w);
      const z = s.utc ? ['UTC', UTC] : zone(p.params.TZID);
      return { t: toUtc(s.w, z[1]), w: s.w, z };
    };
    const instants = (p) => p.value.split(',').map((x) => when({ ...p, value: x })).filter(Boolean).map((x) => (typeof x === 'string' ? x : x.t));

    for (const { props } of raw) {
      const get = (n) => props.find((p) => p.name === n);
      const dtstart = get('DTSTART') && when(get('DTSTART'));
      if (!dtstart) continue;
      const allDay = typeof dtstart === 'string';
      const e = {
        uid: get('UID')?.value.trim() || '',
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
        exdates: props.filter((p) => p.name === 'EXDATE').flatMap(instants),
        recurrenceId: get('RECURRENCE-ID') ? instants(get('RECURRENCE-ID'))[0] ?? null : null,
      };
      const dtend = get('DTEND') && when(get('DTEND'));
      const dur = get('DURATION') && duration(get('DURATION').value);
      const w = allDay ? Date.parse(dtstart) : dtstart.w;
      let endW;
      if (allDay) endW = typeof dtend === 'string' && dtend > dtstart ? Date.parse(dtend) : w + Math.max(DAY, Math.ceil((dur || 0) / DAY) * DAY);
      else if (dtend && typeof dtend !== 'string' && dtend.t >= dtstart.t) endW = dtend.t + dtstart.z[1](dtend.t);
      else endW = w + (dur > 0 ? dur : 0);
      e.end = allDay ? iso(endW) : toUtc(endW, dtstart.z[1]);
      const rr = get('RRULE');
      if (rr) {
        const r = rule(rr.value);
        const byday = r.BYDAY ? r.BYDAY.split(',') : [];
        const extra = Object.keys(r).filter((k) => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'WKST', 'BYDAY'].includes(k));
        const until = r.UNTIL ? stamp(r.UNTIL) : null;
        e.rrule = {
          freq: r.FREQ || '',
          interval: Math.max(1, parseInt(r.INTERVAL, 10) || 1),
          count: r.COUNT ? Math.max(0, parseInt(r.COUNT, 10) || 0) : null,
          until: !until ? null : until.date ? iso(until.w) : until.utc ? until.w : toUtc(until.w, allDay ? UTC : dtstart.z[1]),
          byday,
          wkst: WD.includes(r.WKST) ? r.WKST : 'MO',
          unsupported: !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(r.FREQ) || extra.length > 0
            || byday.some((d) => !WD.includes(d)) || (byday.length > 0 && !['DAILY', 'WEEKLY'].includes(r.FREQ)),
        };
      }
      meta.set(e, { w, endW, off: allDay ? UTC : dtstart.z[1], zoneOff: intl(fallback) });
      cal.events.push(e);
    }
    cal.tz = cal.tz || fallback;
    return cal;
  };

  // Wall-clock starts of a recurring event, DTSTART first (RFC 5545 counts it as the first occurrence).
  // Stops at COUNT, UNTIL, or past `last` (wall ms).
  function* walls(r, w0, last, untilOk) {
    let n = 0;
    const emit = (w) => (r.count != null && n >= r.count) || !untilOk(w) ? false : (n++, true);
    if (!emit(w0)) return;
    yield w0;
    const tod = ((w0 % DAY) + DAY) % DAY, day0 = w0 - tod;
    const step = r.interval;
    if (r.freq === 'WEEKLY') {
      const wk = WD.indexOf(r.wkst);
      const days = [...new Set((r.byday.length ? r.byday : [WD[new Date(day0).getUTCDay()]]).map((d) => (WD.indexOf(d) - wk + 7) % 7))].sort((a, b) => a - b);
      for (let ws = day0 - ((new Date(day0).getUTCDay() - wk + 7) % 7) * DAY; ws <= last; ws += 7 * DAY * step) {
        for (const o of days) {
          const w = ws + o * DAY + tod;
          if (w <= w0) continue;
          if (w > last || !emit(w)) return;
          yield w;
        }
      }
    } else if (r.freq === 'DAILY') {
      const days = new Set(r.byday);
      for (let w = w0 + step * DAY; w <= last; w += step * DAY) {
        if (days.size && !days.has(WD[new Date(w).getUTCDay()])) continue;
        if (!emit(w)) return;
        yield w;
      }
    } else if (r.freq === 'MONTHLY' || r.freq === 'YEARLY') {
      const d0 = new Date(day0), months = r.freq === 'YEARLY' ? 12 * step : step;
      for (let k = 1; ; k++) {
        const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k * months, d0.getUTCDate()));
        const w = d.getTime() + tod;
        if (w > last) return;
        if (d.getUTCDate() !== d0.getUTCDate()) continue; // no Feb 30th: RFC 5545 skips it
        if (!emit(w)) return;
        yield w;
      }
    }
  }

  const expand = (cal, from, to) => {
    const out = [];
    const moved = new Set(cal.events.filter((e) => e.recurrenceId != null).map((e) => e.uid + '|' + e.recurrenceId));
    for (const e of cal.events) {
      const m = meta.get(e) || { w: e.allDay ? Date.parse(e.start) : e.start + (intl(e.tz) || UTC)(e.start), off: e.allDay ? UTC : intl(e.tz) || UTC };
      if (m.endW == null) m.endW = e.allDay ? Date.parse(e.end) : e.end + m.off(e.end);
      const local = m.zoneOff || intl(cal.tz) || UTC;
      // All-day dates are days in the calendar's zone.
      const instant = (w) => (e.allDay ? toUtc(w, local) : toUtc(w, m.off));
      const value = (w) => (e.allDay ? iso(w) : toUtc(w, m.off));
      const push = (w) => {
        const endW = w + (m.endW - m.w);
        const s = instant(w), en = Math.max(instant(endW), s);
        if ((en > from && s < to) || (s === en && s >= from && s < to)) out.push({ event: e, start: value(w), end: value(endW) });
      };
      if (e.status === 'CANCELLED') continue;
      if (!e.rrule || e.recurrenceId != null) { push(m.w); continue; }
      const r = e.rrule.unsupported ? { ...e.rrule, count: 1 } : e.rrule;
      const ex = new Set(e.exdates);
      const until = r.until;
      const untilOk = until == null ? () => true : typeof until === 'string' ? (w) => iso(w) <= until : (w) => instant(w) <= until;
      const last = to + 2 * DAY; // wall ms past the window, whatever the zone
      for (const w of walls(r, m.w, last, untilOk)) {
        const v = value(w);
        if (ex.has(v) || (!e.allDay && ex.has(iso(w))) || moved.has(e.uid + '|' + v)) continue;
        push(w);
      }
    }
    const key = (o) => (typeof o.start === 'string' ? Date.parse(o.start) : o.start);
    return out.sort((a, b) => key(a) - key(b));
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
  const utc = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
  const prop = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return [':', utc(v)];
    const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?$/.exec(String(v));
    if (!m) throw new RangeError(`not a date: ${v}`);
    return m[4] ? [':', `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] || '00'}`] : [';VALUE=DATE:', `${m[1]}${m[2]}${m[3]}`];
  };
  const rrule = (r, start) => {
    const parts = [`FREQ=${r.freq}`];
    if (r.interval > 1) parts.push(`INTERVAL=${r.interval | 0}`);
    // UNTIL takes DTSTART's form (RFC 5545 §3.3.10): a date, a floating time, or UTC.
    if (r.until != null) {
      const day = typeof r.until === 'number' ? null : prop(r.until)[1].slice(0, 8);
      parts.push(`UNTIL=${day == null ? utc(r.until) : typeof start === 'number' ? `${day}T235959Z` : String(start).length > 10 ? `${day}T235959` : day}`);
    }
    else if (r.count != null) parts.push(`COUNT=${r.count | 0}`);
    if (r.byday?.length) parts.push(`BYDAY=${r.byday.filter((d) => WD.includes(d)).join(',')}`);
    if (r.wkst && r.wkst !== 'MO' && WD.includes(r.wkst)) parts.push(`WKST=${r.wkst}`);
    if (!/^(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(r.freq)) throw new RangeError(`unsupported FREQ: ${r.freq}`);
    return parts.join(';');
  };

  const write = (cal, { now = Date.now() } = {}) => {
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//frostdev//Glaze//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    if (cal.name) out.push(`X-WR-CALNAME:${esc(cal.name)}`);
    for (const e of cal.events || []) {
      if (!e.uid) throw new RangeError('every event needs a stable uid');
      const [sp, sv] = prop(e.start);
      out.push('BEGIN:VEVENT', `UID:${clean(e.uid).replace(/\n/g, '')}`, `DTSTAMP:${utc(now)}`, `DTSTART${sp}${sv}`);
      if (e.end != null) { const [ep, ev] = prop(e.end); out.push(`DTEND${ep}${ev}`); }
      if (e.rrule) out.push(`RRULE:${rrule(e.rrule, e.start)}`);
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
  const uid = (...parts) => parts.map((p) => String(p).replace(/[^A-Za-z0-9._-]+/g, '_')).join('-') + '@glaze';

  return { parse, expand, write, uid };
})();

if (typeof module !== 'undefined') module.exports = GZ_ICS;
