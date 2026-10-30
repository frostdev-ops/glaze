// The approval window (the worker's side): an agent app's pairing, a data group it wants, or one action waits for the
// student in a Glaze window, never in the app. lib/mcp/calls.js asks; lib/background.js routes glaze:mcp-ask to decide and
// windows.onRemoved to closed, and calls sweep at worker start.
//
// create({ windows, tabs, storage: { session }, runtime, now, timers, url }) → { ask, decide, sweep, closed }
//   ask(kind, view, { signal, progress }) → 'yes' | 'no' | 'timeout' | 'cancelled' | 'interrupted' | 'busy'
//     kind 'pair' or 'grant': view { app: { id?, name, exe }, tool: { name, title }, group }; 'action': { app, tool,
//     summary } (Glaze's summarize, from trusted data). 'interrupted': no window could show it; 'busy': LIMIT.app asks of
//     this app (by app.id, else its name and program) or LIMIT.all in all already wait. progress(n, undefined, SAYS) every
//     TICK, n the seconds that callback has waited across its asks, so a call that asks twice keeps rising.
//   decide(msg, sender) → { ok }: msg { id, answer: 'yes' | 'no' }, only from the window's own tab, top frame and page; each
//     ask once. closed(windowId): the student closed the window, which is Don't allow for every ask it holds.
//   sweep(): the last worker's asks; ask waits for it.
// One popup (SIZE, focused) holds every waiting ask and shows the oldest; Glaze closes it when none waits. Each ask is
// storage.session mcpAsk:<id> = { id, kind, app: { name, exe }, tool: { name, title }, group?, summary?, at, until, state },
// which the page (lib/mcp/approve.html) renders from. state: waiting until `until` (TIMEOUT), then yes | no | timeout |
// cancelled | interrupted; consent records do not assert execution. sweep: waiting → interrupted, running →
// interrupted with mayHaveRun, records made over KEEP ago that no longer wait are dropped. mcpAskWindow: { id, tab }.
// Classic script for the worker; module.exports for node.
var GZ_MCP_APPROVE = globalThis.GZ_MCP_APPROVE || (() => {
  const PREFIX = 'mcpAsk:', WINDOW = 'mcpAskWindow';
  const KINDS = ['pair', 'grant', 'action'];
  const TIMEOUT = 600e3, TICK = 15e3, KEEP = 3600e3;
  const GROUPS = ['courses', 'grades', 'writer', 'assignments'], MOD = /^mod:[a-z2-7]{16}$/;
  // app, all: waiting asks; the rest: characters kept of what the window shows.
  const LIMIT = { app: 5, all: 20, name: 100, exe: 1024, tool: 64, title: 120, group: 64, summary: 2000 };
  const SIZE = { width: 440, height: 340 };
  const SAYS = 'Waiting for the student in Glaze';
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const cut = (s, n) => { const t = s.slice(0, n); return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t; };
  // Control, format (bidi, zero-width) and line-break characters out and spaces squeezed, so a name can't stage text.
  const text = (v, n) => cut(typeof v === 'string' ? v.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim() : '', n);
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const page = (u) => (typeof u === 'string' ? u.split(/[?#]/)[0] : '');

  const create = ({ windows, tabs, storage, runtime, now = Date.now, timers = globalThis, url }) => {
    const session = storage.session;
    const asks = new Map(); // the waiting asks: id → { rec, app, done(state) }
    const settled = []; // [at, id] of this worker's records that no longer wait, oldest first
    const counted = new WeakMap(); // progress callback → seconds it has been told
    const closedOpening = new Set();
    let win = null, opening = null, swept = null, last = 0;
    let writes = Promise.resolve();
    // Writes in the order made → whether this one went.
    const put = (patch) => (writes = writes.then(() => session.set(patch).then(() => true, () => false)));
    const drop = (keys) => (writes = writes.then(() => session.remove(keys).then(() => true, () => false)));
    const save = (rec) => put({ [PREFIX + rec.id]: rec });

    const prune = () => {
      const old = [];
      while (settled.length && settled[0][0] + KEEP <= now()) old.push(PREFIX + settled.shift()[1]);
      if (old.length) drop(old);
    };
    // Glaze closes the window itself once nothing waits; forgetting it first means its close declines nothing.
    const hide = () => {
      const w = win;
      win = null;
      if (!w) return;
      drop(WINDOW);
      Promise.resolve().then(() => windows.remove(w.id)).catch(() => {});
    };
    const show = () => (win || opening ? opening : (opening = (async () => {
      let w;
      try {
        w = await windows.create({ type: 'popup', url, width: SIZE.width, height: SIZE.height, focused: true });
        // Safari opens it at its main window's size: bring it back to the approval size where the browser lets it.
        if (Number.isInteger(w?.id) && (w.width > SIZE.width * 1.5 || w.height > SIZE.height * 1.5) && typeof windows.update === 'function') {
          await Promise.resolve().then(() => windows.update(w.id, { width: SIZE.width, height: SIZE.height })).catch(() => {});
        }
        let tab = w?.tabs?.[0]?.id;
        if (!Number.isInteger(tab) && Number.isInteger(w?.id)) tab = (await tabs.query({ windowId: w.id }))?.[0]?.id;
        if (closedOpening.has(w?.id)) {
          for (const a of [...asks.values()]) a.done('no');
          return;
        }
        if (!Number.isInteger(w?.id) || !Number.isInteger(tab)) throw new Error('mcp approve: no window');
        win = { id: w.id, tab };
        put({ [WINDOW]: win });
        if (!asks.size) hide();
      } catch {
        const state = closedOpening.has(w?.id) ? 'no' : 'interrupted';
        if (Number.isInteger(w?.id) && state === 'interrupted') await Promise.resolve().then(() => windows.remove(w.id)).catch(() => {});
        for (const a of [...asks.values()]) a.done(state);
      } finally { closedOpening.clear(); opening = null; }
    })()));

    const ask = async (kind, view, { signal, progress } = {}) => {
      if (!KINDS.includes(kind) || !isObj(view)) throw new TypeError('mcp approve: kind is pair, grant or action, with a view');
      const group = text(view.group, LIMIT.group);
      if (kind !== 'action' && !GROUPS.includes(group) && !MOD.test(group)) throw new TypeError(`mcp approve: a ${kind} names a known group`);
      const summary = text(view.summary, LIMIT.summary);
      if (kind === 'action' && (!summary || view.summary.length > LIMIT.summary)) throw new TypeError('mcp approve: an action needs a complete trusted summary');
      await swept;
      if (signal?.aborted) return 'cancelled';
      const app = { name: text(view.app?.name, LIMIT.name), exe: text(view.app?.exe, LIMIT.exe) };
      const key = typeof view.app?.id === 'string' && view.app.id ? view.app.id : JSON.stringify([app.exe, app.name]);
      const waiting = [...asks.values()];
      if (waiting.length >= LIMIT.all || waiting.filter((a) => a.app === key).length >= LIMIT.app) return 'busy';
      prune();
      const tool = { name: text(view.tool?.name, LIMIT.tool), title: text(view.tool?.title, LIMIT.title) };
      // Strictly rising, so the queue's order is the order asked.
      const at = last = Math.max(now(), last + 1);
      const rec = { id: hex(globalThis.crypto.getRandomValues(new Uint8Array(12))), kind, app, tool,
        ...(kind === 'action' ? { summary } : { group }),
        at, until: at + TIMEOUT, state: 'waiting' };
      return new Promise((resolve) => {
        let timeout = 0, tick = 0;
        const done = (state) => {
          if (asks.get(rec.id) !== a) return false;
          asks.delete(rec.id);
          timers.clearTimeout(timeout);
          timers.clearTimeout(tick);
          signal?.removeEventListener?.('abort', abort);
          save({ ...rec, state });
          settled.push([rec.at, rec.id]);
          resolve(state);
          if (!asks.size) hide();
          return true;
        };
        const a = { rec, app: key, done };
        const abort = () => done('cancelled');
        asks.set(rec.id, a);
        signal?.addEventListener?.('abort', abort, { once: true });
        timeout = timers.setTimeout(() => done('timeout'), TIMEOUT);
        if (typeof progress === 'function') {
          const beat = () => {
            tick = timers.setTimeout(() => {
              if (asks.get(rec.id) !== a) return;
              const n = (counted.get(progress) || 0) + TICK / 1000;
              counted.set(progress, n);
              try { progress(n, undefined, SAYS); } catch { /* The client's progress never ends an ask. */ }
              beat();
            }, TICK);
          };
          beat();
        }
        // The page reads the record when it opens, so it is written first; a record that can't be written can't be shown.
        save(rec).then((ok) => { if (!ok) done('interrupted'); else if (asks.get(rec.id) === a) show(); });
      });
    };

    const from = (s) => !!win && isObj(s) && typeof s.id === 'string' && s.id === runtime?.id && s.tab?.id === win.tab && s.tab?.windowId === win.id && (s.frameId ?? 0) === 0 && !!page(url) && page(s.url) === page(url);
    const decide = (msg, sender) => {
      const a = isObj(msg) && typeof msg.id === 'string' ? asks.get(msg.id) : undefined;
      if (!a || (msg.answer !== 'yes' && msg.answer !== 'no') || !from(sender)) return { ok: false };
      return { ok: a.done(msg.answer) };
    };
    const closed = (windowId) => {
      if (opening) closedOpening.add(windowId);
      if (!win || windowId !== win.id) return;
      win = null;
      drop(WINDOW);
      for (const a of [...asks.values()]) a.done('no');
    };

    const sweep = () => (swept ||= (async () => {
      let all;
      try { all = await session.get(null); } catch { return; }
      const t = now(), patch = {}, old = [];
      for (const [k, rec] of Object.entries(isObj(all) ? all : {})) {
        if (!k.startsWith(PREFIX) || !isObj(rec) || asks.has(rec.id)) continue;
        if (rec.state === 'waiting') patch[k] = { ...rec, state: 'interrupted' };
        else if (rec.state === 'running') patch[k] = { ...rec, state: 'interrupted', mayHaveRun: true };
        else if (!(rec.at + KEEP > t)) old.push(k);
      }
      if (Object.keys(patch).length) put(patch);
      if (old.length) drop(old);
      const stale = all?.[WINDOW];
      if (isObj(stale) && Number.isInteger(stale.id) && stale.id !== win?.id) {
        drop(WINDOW);
        await Promise.resolve().then(() => windows.remove(stale.id)).catch(() => {});
      }
      await writes;
    })());

    return { ask, decide, sweep, closed };
  };

  return { PREFIX, WINDOW, KINDS, TIMEOUT, TICK, KEEP, LIMIT, SIZE, SAYS, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_APPROVE; else GZ_MCP_APPROVE;
