// The agent's MCP session across lost connections to Glaze (agent.js does the I/O). Pure: lines in, lines out, no timers;
// `now` is the caller's clock. Each call returns { app: [lines for the app], glaze: [lines for Glaze] }, plus fatal (why)
// when the session can't go on. Lines are JSON-RPC text without their newline, passed on as they came.
//   fromApp(text, now), fromGlaze(text, now), down(now) (the connection closed), up(now, where) (connected again; where
//   names the browser for messages), tick(now) (held requests past their wait), delay(now) (ms until the next try),
//   held() (bytes waiting).
// After a drop the app's own initialize is replayed under a private id, its answer kept from the app, then its
// notifications/initialized, then one notifications/tools/list_changed to the app. Requests Glaze hadn't answered:
// initialize, tools/list, server/discover and subscriptions/listen are sent again (a ping is answered here); any other,
// tools/call above all, is answered -31002 and never sent again, as Glaze may have done it. While down, what the app
// sends waits in order, a request up to WAIT and HOLD bytes in all, then is answered -31003; a ping is answered at once.
// An initialize before any connection waits WAIT too, then is answered here as the worker would (extension/agents/wire.js)
// and replayed on the first connection.
'use strict';

const LEGACY = ['2025-11-25', '2025-06-18'];
const HOLD = 1024 * 1024, WAIT = 10e3;
const FAST = 250, FAST_FOR = 5e3, SLOW = 2e3, SETTLED = 30e3;
const CUT = -31002, AWAY = -31003;
const CUT_SAYS = 'Glaze\'s connection was interrupted; a change the student had allowed may have been made. Check before asking again.';
const AGAIN = new Set(['initialize', 'tools/list', 'server/discover', 'subscriptions/listen']);
const SUB = 'io.modelcontextprotocol/subscriptionId';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const isId = (x) => typeof x === 'string' || Number.isInteger(x);
const key = (id) => JSON.stringify(id);
const parse = (text) => { try { const m = JSON.parse(text); return isObj(m) ? m : null; } catch { return null; } };
const line = (m) => JSON.stringify({ jsonrpc: '2.0', ...m });
const short = (s) => typeof s === 'string' && s.length <= 256;

const create = ({ version = '0.0.0', nonce = 'replay' } = {}) => {
  const REPLAY = `glaze-mcp:${nonce}`;
  let live = false, ever = false, since = 0, downAt = 0, step = null, where = 'your browser';
  let replaying = false, size = 0;
  // The app's initialize: its params, and the version it was answered with (by Glaze, or here) once it was.
  let init = null, ready = false;
  const flight = new Map(); // requests sent to Glaze and not answered: key → { id, method, text, tools }
  let held = []; // while down: { text, id?, method, at, n }
  const acks = new Map(); // subscriptions being restored, and whether the app already had their acknowledgement

  const out = () => ({ app: [], glaze: [] });
  const fail = (id, code, message) => line({ id, error: { code, message } });
  const away = (id) => fail(id, AWAY, `Glaze isn't reachable: open ${where} with Glaze and turn on Settings → AI → Agents, then ask again.`);
  const bytes = (text) => Buffer.byteLength(text) + 1;
  const hold = (r, h) => {
    if (size + h.n > HOLD) {
      if (h.id !== undefined) r.app.push(away(h.id));
      return;
    }
    held.push(h);
    size += h.n;
  };
  // A line on its way to a live Glaze, noting the requests.
  const send = (r, h) => {
    if (h.id !== undefined && h.method) {
      flight.set(key(h.id), { id: h.id, method: h.method, text: h.text, tools: h.tools, acked: h.acked, params: h.params });
      if (h.again && h.method === 'subscriptions/listen') acks.set(key(h.id), h);
    }
    r.glaze.push(h.text);
  };
  const flush = (r) => {
    const all = held;
    held = [];
    size = 0;
    for (const h of all) send(r, h);
  };
  // What the worker answers an initialize (wire.js), for an app that started before the browser.
  const answer = (id, p) => {
    const who = isObj(p) && isObj(p.clientInfo) && short(p.clientInfo.name) && short(p.clientInfo.version) && (p.clientInfo.title === undefined || short(p.clientInfo.title));
    if (!isObj(p) || typeof p.protocolVersion !== 'string' || !isObj(p.capabilities) || !who) {
      init = null;
      return fail(id, -32602, 'Invalid params: initialize needs protocolVersion, capabilities and clientInfo.');
    }
    const v = LEGACY.includes(p.protocolVersion) ? p.protocolVersion : LEGACY[0];
    init = { params: p, version: v };
    return line({ id, result: { protocolVersion: v, capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'glaze', title: 'Glaze', version } } });
  };
  const expire = (r, now) => {
    held = held.filter((h) => {
      if (h.id === undefined || now - h.at < WAIT) return true;
      size -= h.n;
      r.app.push(h.method === 'initialize' && !ever && !(init && init.version) ? answer(h.id, h.params) : away(h.id));
      return false;
    });
  };
  // Once Glaze is back and knows the app again: what the app had sent, then a nudge to list the tools afresh.
  const resume = (r) => {
    const known = !!(init && init.version && ready);
    if (known) r.glaze.push(line({ method: 'notifications/initialized' }));
    flush(r);
    if (known) r.app.push(line({ method: 'notifications/tools/list_changed' }));
  };

  const fromApp = (text, now) => {
    const r = out(), m = parse(text);
    const id = m && Object.hasOwn(m, 'id') && isId(m.id) ? m.id : undefined;
    const valid = m && m.jsonrpc === '2.0' && (!Object.hasOwn(m, 'id') || isId(m.id)) && (m.params === undefined || isObj(m.params));
    const method = valid && typeof m.method === 'string' ? m.method : null;
    const p = m && isObj(m.params) ? m.params : {};
    const h = { text, id: method ? id : undefined, method, at: now, n: bytes(text) };
    if (method === 'subscriptions/listen') h.tools = isObj(p.notifications) && p.notifications.toolsListChanged === true;
    if (method === 'initialize' && h.id !== undefined) {
      h.params = m.params;
    }
    if (method === 'notifications/cancelled' && h.id === undefined && isId(p.requestId)) {
      flight.delete(key(p.requestId));
      acks.delete(key(p.requestId));
      const i = held.findIndex((x) => x.id !== undefined && key(x.id) === key(p.requestId));
      if (i >= 0) { size -= held[i].n; held.splice(i, 1); return r; }
    }
    if (method === 'notifications/initialized' && h.id === undefined) {
      ready = true;
      // The replay sends it again whenever it runs; held, it would go twice.
      if (!live || replaying) { if (!init || !init.version) hold(r, h); return r; }
    }
    if (live && !replaying) { send(r, h); return r; }
    if (method === 'ping' && h.id !== undefined) { r.app.push(line({ id: h.id, result: {} })); return r; }
    hold(r, h);
    return r;
  };

  const fromGlaze = (text, now) => {
    const r = out(), m = parse(text);
    if (m && !Object.hasOwn(m, 'method') && Object.hasOwn(m, 'id') && (Object.hasOwn(m, 'result') || Object.hasOwn(m, 'error'))) {
      if (replaying && m.id === REPLAY) {
        expire(r, now);
        replaying = false;
        if (m.error) return { ...r, fatal: `Glaze refused this app's initialize again: ${isObj(m.error) && typeof m.error.message === 'string' ? m.error.message : 'an error'}` };
        const v = isObj(m.result) ? m.result.protocolVersion : undefined;
        if (v !== init.version) return { ...r, fatal: `Glaze answered this app's initialize again with protocol ${v}, not ${init.version}` };
        resume(r);
        return r;
      }
      const k = key(m.id), f = flight.get(k);
      flight.delete(k);
      acks.delete(k);
      if (f && f.method === 'initialize' && !init && isObj(m.result) && typeof m.result.protocolVersion === 'string') init = { params: f.params, version: m.result.protocolVersion };
    }
    if (m && m.method === 'notifications/subscriptions/acknowledged' && isObj(m.params) && isObj(m.params._meta)) {
      const k = key(m.params._meta[SUB]);
      const f = flight.get(k), restored = acks.get(k);
      if (f && f.method === 'subscriptions/listen') f.acked = true;
      if (restored) {
        acks.delete(k);
        if (!restored.acked) r.app.push(text);
        if (restored.tools) r.app.push(line({ method: 'notifications/tools/list_changed', params: { _meta: { [SUB]: restored.id } } }));
        return r;
      }
    }
    r.app.push(text);
    return r;
  };

  const down = (now) => {
    const r = out();
    if (!live) return r;
    // A connection that lasted starts the tries afresh; one that dropped soon after keeps their pace.
    if (now - since >= SETTLED) step = null;
    live = false;
    replaying = false;
    downAt = now;
    acks.clear();
    const again = [];
    for (const f of flight.values()) {
      if (f.method === 'ping') r.app.push(line({ id: f.id, result: {} }));
      else if (AGAIN.has(f.method)) again.push({ ...f, at: now, n: bytes(f.text), again: true });
      else r.app.push(fail(f.id, CUT, CUT_SAYS));
    }
    flight.clear();
    const waiting = held;
    held = [];
    size = 0;
    for (const h of again) hold(r, h);
    for (const h of waiting) hold(r, h);
    return r;
  };

  const up = (now, name) => {
    const r = out();
    if (typeof name === 'string' && name) where = name;
    expire(r, now);
    live = true;
    ever = true;
    since = now;
    if (init && init.version) {
      replaying = true;
      r.glaze.push(line({ id: REPLAY, method: 'initialize', params: init.params }));
      return r;
    }
    resume(r);
    return r;
  };

  const tick = (now) => {
    const r = out();
    if (live && !replaying) return r;
    expire(r, now);
    return r;
  };

  const delay = (now) => {
    if (step === null && now - downAt < FAST_FOR) return FAST;
    step = Math.min(SLOW, (step || FAST) * 2);
    return step;
  };

  return { fromApp, fromGlaze, down, up, tick, delay, held: () => size };
};

module.exports = { LEGACY, HOLD, WAIT, CUT, AWAY, create };
