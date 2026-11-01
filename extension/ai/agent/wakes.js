// Ask Rime's wakes and monitors (docs/ai-harness.md "Rime's own tools"): Rime comes back later, inside Glaze, never as a
// notification. A wake is a time and what to say then. A monitor watches the student's own data as Glaze already keeps it
// (the to-do list and Insights, read with Agents' tools) and fires when it changes: grade (Insights' grade for the course
// gains a graded piece of work or moves), announcement (a new one in Canvas's planner), due (an item's due date moves), submitted (an item shows as
// handed in). Glaze compares what it reads with what it read when the monitor was made; no model runs until one fires.
// Fired ones wait in storage.local until the student's next school page takes them (take), where Ask Rime shows them and
// runs their instruction (integration: ai/page/ask.js). With the switch off (Settings → AI → Ask Rime → Reminders and
// watches) nothing is made, checked or shown. Safari unloads Glaze's background about 30 s after its last event, so an
// alarm may come late there; take() checks everything due before it answers, so nothing is lost, only shown later.
// storage.local rimeWakes: { wakes: [{ id, at, say, made }], monitors: [{ id, watch, account, course?, item?: { type, id },
//   say, made, until, base }], fired: [{ id, what, watch?, say, at, fact? }] }, each list capped (LIMIT).
// env: { local (storage.local: get, set), alarms (chrome.alarms: create, clear), read(name, args, account) → an Agents
//   tool's answer (todo_list, course_grades), on() → whether the switch and Ask Rime are on, now() }.
//   tools(env) → wake_create, monitor_create, wakes_list, wake_cancel for ai/tools.js define; ctx { account, zone }.
//   tick(env) checks what is due and fires it; alarm(env, alarm) for the worker's alarms.onAlarm; take(env) → the fired
//   ones, then forgets them.
// Classic script for the worker; module.exports for node.
var GZ_AI_RIME_WAKES = globalThis.GZ_AI_RIME_WAKES || (() => {
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('../tasks/agent-tools.js'));
  const KEY = 'rimeWakes', ALARM = 'gz-rime:', TICK = 'gz-rime:tick', DAY = 864e5;
  // ahead: how far off a wake may be (agent.tools check holds the same); days: how long a monitor watches; period: minutes
  // between monitor checks; lead: the least time before a wake.
  const LIMIT = { wakes: 20, monitors: 20, fired: 20, say: 200, ahead: 60 * DAY, days: 30, period: 30, lead: 60e3, titles: 5 };
  const WATCHES = ['grade', 'announcement', 'due', 'submitted'];
  const UID = /^(\d{1,20}|_\d{1,20}_\d{1,20})$/, TYPE = /^[a-z_]{1,40}$/, ID = /^[wm]-[a-z0-9]{8}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = (error) => ({ ok: false, error });
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const when = (v) => (Number.isSafeInteger(v) && v > 0 && v <= 8640000000000000 ? v : 0);
  const clock = (env) => (typeof env.now === 'function' ? env.now() : Date.now());
  const accountOk = (v) => {
    if (typeof v !== 'string' || v.length > 320) return false;
    const at = v.lastIndexOf('/'), origin = v.slice(0, at);
    try { const u = new URL(origin); return /^https?:$/.test(u.protocol) && u.origin === origin && UID.test(v.slice(at + 1)); } catch { return false; }
  };
  const OFF = 'Reminders and watches are off in Glaze settings (AI, Ask Rime).';

  // ---- the store -------------------------------------------------------------------------------------------------------
  const baseOf = (m) => {
    const b = m.base;
    if (!isObj(b)) return null;
    const course = text(b.course, 120), title = text(b.title, 300);
    if (['due', 'submitted'].includes(m.watch)) {
      if (!isObj(m.item) || !TYPE.test(m.item.type) || !UID.test(m.item.id)) return null;
      return m.watch === 'due' ? (b.due === null || when(b.due) ? { due: b.due, title, course } : null)
        : typeof b.submitted === 'boolean' ? { submitted: b.submitted, title, course } : null;
    }
    if (m.item !== undefined) return null;
    if (m.watch === 'grade') return UID.test(m.course) && (b.percent === null || Number.isFinite(b.percent)) && Number.isSafeInteger(b.points) && b.points >= 0 ? { percent: b.percent, points: b.points, course } : null;
    if (!Array.isArray(b.ids) || !b.ids.every((id) => typeof id === 'string' && UID.test(id)) || !isObj(b.titles)) return null;
    const ids = [...new Set(b.ids)].slice(0, 500);
    return { ids, titles: Object.fromEntries(ids.map((id) => [id, text(b.titles[id], 300)])), course };
  };
  const factOf = (f) => {
    if (!isObj(f)) return undefined;
    return { ...Object.fromEntries(['title', 'course'].filter((k) => typeof f[k] === 'string').map((k) => [k, text(f[k], k === 'title' ? 300 : 120)])),
      ...Object.fromEntries(['from', 'due', 'was', 'percent'].filter((k) => f[k] === null || Number.isFinite(f[k])).map((k) => [k, f[k]])),
      ...(f.submitted === true && { submitted: true }), ...(Array.isArray(f.titles) && { titles: f.titles.slice(0, LIMIT.titles).map((v) => text(v, 300)) }) };
  };
  const clean = (raw) => {
    const r = isObj(raw) ? raw : {}, list = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
    const unique = (v) => { const ids = new Set(); return v.filter((x) => !ids.has(x.id) && ids.add(x.id)); };
    return {
      wakes: unique(list(r.wakes).filter((w) => ID.test(w.id) && w.id[0] === 'w' && when(w.at) && text(w.say, LIMIT.say)))
        .slice(0, LIMIT.wakes).map((w) => ({ id: w.id, at: w.at, say: text(w.say, LIMIT.say), made: when(w.made) })),
      monitors: unique(list(r.monitors).filter((m) => ID.test(m.id) && m.id[0] === 'm' && WATCHES.includes(m.watch) && accountOk(m.account) && when(m.until) && (m.course === undefined || UID.test(m.course)))
        .map((m) => ({ id: m.id, watch: m.watch, account: m.account, ...(m.course !== undefined && { course: m.course }),
          ...(isObj(m.item) && { item: { type: m.item.type, id: m.item.id } }), say: text(m.say, LIMIT.say), made: when(m.made), until: m.until, base: baseOf(m) })).filter((m) => m.base))
        .slice(0, LIMIT.monitors),
      fired: unique(list(r.fired).filter((f) => ID.test(f.id) && (f.what === 'wake' ? f.id[0] === 'w' : f.what === 'monitor' && f.id[0] === 'm') && when(f.at)))
        .slice(-LIMIT.fired).map((f) => ({ id: f.id, what: f.what, ...(WATCHES.includes(f.watch) && { watch: f.watch }), say: text(f.say, LIMIT.say), at: f.at, ...(factOf(f.fact) && { fact: factOf(f.fact) }) })),
    };
  };
  // One change at a time: every write reads the store fresh inside the queue.
  let queue = Promise.resolve();
  const turn = (f) => { const p = queue.then(f, f); queue = p.catch(() => {}); return p; };
  const read = async (env) => clean((await env.local.get(KEY))[KEY]);
  const write = (env, s) => env.local.set({ [KEY]: s });
  const newId = (kind) => { const b = new Uint8Array(8); crypto.getRandomValues(b); return `${kind}-${[...b].map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('')}`; };
  // The alarms the store needs: one per wake, and one every LIMIT.period minutes while a monitor waits.
  const arm = async (env, s, on = true) => {
    if (!env.alarms) return;
    try {
      const live = new Map((await env.alarms.getAll?.() || []).map((a) => [a.name, a]));
      const wanted = new Map(on ? s.wakes.map((w) => [`${ALARM}wake:${w.id}`, { when: w.at }]) : []);
      if (on && s.monitors.length) wanted.set(TICK, { periodInMinutes: LIMIT.period });
      for (const name of live.keys()) if (name.startsWith(ALARM) && !wanted.has(name)) await env.alarms.clear(name);
      if (!wanted.has(TICK)) await env.alarms.clear(TICK);
      for (const [name, options] of wanted) {
        const old = live.get(name);
        if (options.when !== undefined ? old?.scheduledTime !== options.when : old?.periodInMinutes !== options.periodInMinutes) await env.alarms.create(name, options);
      }
    } catch { /* take() still finds what is due */ }
  };

  // ---- monitors --------------------------------------------------------------------------------------------------------
  // What a watch reads, and what it keeps of the answer (null: what it watches isn't there).
  const items = (r) => (Array.isArray(r?.items) ? r.items.filter(isObj) : []);
  const WATCH = {
    due: { tool: 'todo_list', args: () => ({}), see: (r, m) => { const i = items(r).find((x) => x.type === m.item.type && x.id === m.item.id); return i ? { due: when(i.due) || null, title: text(i.title, 300), course: text(i.course, 120) } : null; } },
    submitted: { tool: 'todo_list', args: () => ({}), see: (r, m) => { const i = items(r).find((x) => x.type === m.item.type && x.id === m.item.id); return i ? { submitted: i.submitted === true, title: text(i.title, 300), course: text(i.course, 120) } : null; } },
    // Insights keeps the course's grade after each graded piece of work (trend), not each score: a new point or a new
    // percent is a grade posted.
    grade: { tool: 'course_grades', args: (m) => ({ course: m.course }), see: (r) => (isObj(r?.course) && r.course.lettersOnly !== true
      ? { percent: Number.isFinite(r.course.percent) ? r.course.percent : null, points: Array.isArray(r.trend) ? r.trend.length : 0, course: text(r.course.name, 120) } : null) },
    announcement: { tool: 'todo_list', args: (m) => (m.course ? { course: m.course } : {}), see: (r) => (Array.isArray(r?.items)
      ? { ids: items(r).filter((i) => i.type === 'announcement').map((i) => i.id), titles: Object.fromEntries(items(r).filter((i) => i.type === 'announcement').map((i) => [i.id, text(i.title, 300)])), course: items(r).find((i) => i.type === 'announcement')?.course || '' } : null) },
  };
  // What the monitor's account answers now: { seen } | { error }.
  const look = async (env, m) => {
    let r;
    try { r = await env.read(WATCH[m.watch].tool, WATCH[m.watch].args(m), m.account); } catch (e) { return { error: e instanceof Error ? e.message : 'Glaze could not read that.' }; }
    if (r?.ok === false) return { error: text(r.error, 300) || 'Glaze could not read that.' };
    if (typeof r?.missing === 'string') return { error: text(r.missing, 300) };
    const seen = WATCH[m.watch].see(r, m);
    return seen ? { seen } : { error: m.watch === 'grade' ? 'That course shows letter grades only, or Insights keeps no grade for it, so Glaze cannot see a grade post.' : 'That item is not on the to-do list as Glaze last read it; todo_list names them.' };
  };
  // What changed since the monitor was made, as the fired record's fact; null when nothing has.
  const changed = (m, now) => {
    const b = m.base;
    if (m.watch === 'due') return now.due !== b.due ? { title: now.title, course: now.course, from: b.due, due: now.due } : null;
    if (m.watch === 'submitted') return now.submitted && !b.submitted ? { title: now.title, course: now.course, submitted: true } : null;
    if (m.watch === 'grade') return now.points > b.points || now.percent !== b.percent ? { course: now.course, was: b.percent, percent: now.percent } : null;
    const fresh = now.ids.filter((id) => !b.ids.includes(id));
    return fresh.length ? { course: m.course ? now.course : '', titles: fresh.slice(0, LIMIT.titles).map((id) => now.titles[id] || '') } : null;
  };
  // A monitor's arguments as the tool and check() hold them → '' or what is wrong.
  const shape = (a) => (!WATCHES.includes(a.watch) ? 'watch is grade, announcement, due or submitted.'
    : ['due', 'submitted'].includes(a.watch) ? (TYPE.test(a.type || '') && UID.test(a.id || '') ? '' : `${a.watch} takes the item's type and id from todo_list.`)
      : a.type !== undefined || a.id !== undefined ? `${a.watch} takes no item.` : a.watch === 'grade' && !UID.test(a.course || '') ? 'grade takes the course id.' : '');

  // ---- firing ----------------------------------------------------------------------------------------------------------
  const fire = (s, f) => { s.fired.push(f); s.fired = s.fired.slice(-LIMIT.fired); };
  const settle = (s, now) => {
    const due = s.wakes.filter((w) => w.at <= now);
    for (const w of due) fire(s, { id: w.id, what: 'wake', say: w.say, at: now });
    s.wakes = s.wakes.filter((w) => w.at > now);
    s.monitors = s.monitors.filter((m) => m.until > now);
    return due.length;
  };
  // Everything due by now: wakes whose time has come, monitors whose data changed (each read once); expired monitors go.
  const tick = (env) => turn(async () => {
    if (!(await env.on())) { await arm(env, await read(env), false); return 0; }
    const s = await read(env), now = clock(env);
    let n = settle(s, now);
    const keep = [];
    for (const m of s.monitors) {
      if (!(await env.on())) return 0;
      if (m.until <= now) continue;
      const r = await look(env, m), fact = r.seen ? changed(m, r.seen) : null;
      if (fact) { fire(s, { id: m.id, what: 'monitor', watch: m.watch, say: m.say, at: now, fact }); n++; } else keep.push(m);
    }
    s.monitors = keep;
    if (!(await env.on())) return 0;
    await write(env, s);
    await arm(env, s);
    return n;
  });
  const alarm = (env, a) => (typeof a?.name === 'string' && a.name.startsWith(ALARM) ? tick(env) : Promise.resolve(0));
  // The student's school page asks: what fired, checked first, then forgotten.
  const take = async (env) => {
    if (!(await env.on())) return [];
    await tick(env);
    return turn(async () => { const s = await read(env); if (!(await env.on())) return []; const out = s.fired; s.fired = []; await write(env, s); return out; });
  };

  // ---- the tools -------------------------------------------------------------------------------------------------------
  const spec = (name) => AT().SPECS.find((t) => t.name === name);
  const def = (name, more) => ({ name, kind: spec(name).kind, description: spec(name).description, parameters: spec(name).parameters, ...more });
  const zoneOf = (ctx) => (typeof ctx?.zone === 'string' ? ctx.zone : Intl.DateTimeFormat().resolvedOptions().timeZone);
  const said = (ms, zone) => new Date(ms).toLocaleString('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  // A wake's time → ms, or why not.
  const timeOf = (args, ctx, env) => {
    const at = AT().moment(args.at, zoneOf(ctx)), now = clock(env);
    if (at === null) return { error: 'at is a time on the student\'s clock, as 2026-10-31 21:00.' };
    if (at < now + LIMIT.lead) return { error: 'That time has passed or is less than a minute away.' };
    if (at - now > LIMIT.ahead) return { error: 'A wake can be at most 60 days ahead.' };
    return { at };
  };
  const ACCOUNT = 'Glaze could not tell which school account this is for; accounts_list names them.';
  const monitorOf = async (args, ctx, env) => {
    const why = shape(args);
    if (why) return { error: why };
    const account = args.account === undefined ? ctx?.account : args.account;
    if (!accountOk(account)) return { error: ACCOUNT };
    if (args.watch === 'announcement' && /\/_\d+_\d+$/.test(account)) return { error: 'On Blackboard, Glaze reads no announcements it could watch; only Canvas\'s planner lists them.' };
    const m = { watch: args.watch, account, ...(args.course && { course: args.course }), ...(args.type && { item: { type: args.type, id: args.id } }) };
    const r = await look(env, m);
    return r.error ? { error: r.error } : { m: { ...m, base: r.seen } };
  };
  const about = (m) => (m.watch === 'grade' ? `a grade in ${m.base.course || 'that course'}` : m.watch === 'announcement' ? `a new announcement${m.base.course && m.course ? ` in ${m.base.course}` : ''}`
    : m.watch === 'due' ? `the due date of “${m.base.title}” to move` : `“${m.base.title}” to show as handed in`);

  const tools = (env) => [
    def('wake_create', {
      summarize: async (args, ctx) => { if (!(await env.on())) throw new Error(OFF); const t = timeOf(args, ctx, env); if (t.error) throw new Error(t.error); return `Come back ${said(t.at, zoneOf(ctx))}: “${text(args.say, LIMIT.say)}”`; },
      run: (args, ctx) => turn(async () => {
        if (!(await env.on())) return fail(OFF);
        const t = timeOf(args, ctx, env), say = text(args.say, LIMIT.say);
        if (t.error) return fail(t.error);
        if (!say) return fail('Say what to do then.');
        const s = await read(env);
        if (!(await env.on())) return fail(OFF);
        settle(s, clock(env));
        if (s.wakes.length >= LIMIT.wakes) return fail(`${LIMIT.wakes} wakes are waiting already; cancel one first (wakes_list).`);
        const w = { id: newId('w'), at: t.at, say, made: clock(env) };
        s.wakes.push(w);
        await write(env, s);
        await arm(env, s);
        return { id: w.id, what: 'wake', at: w.at, say };
      }),
    }),
    def('monitor_create', {
      summarize: async (args, ctx) => {
        if (!(await env.on())) throw new Error(OFF);
        const r = await monitorOf(args, ctx, env);
        if (r.error) throw new Error(r.error);
        return `Watch for ${about(r.m)} for ${LIMIT.days} days${args.say ? `, then: “${text(args.say, LIMIT.say)}”` : ''}.`;
      },
      run: async (args, ctx) => {
        if (!(await env.on())) return fail(OFF);
        const r = await monitorOf(args, ctx, env);
        if (r.error) return fail(r.error);
        return turn(async () => {
          const s = await read(env);
          if (!(await env.on())) return fail(OFF);
          settle(s, clock(env));
          if (s.monitors.length >= LIMIT.monitors) return fail(`${LIMIT.monitors} monitors are watching already; cancel one first (wakes_list).`);
          const m = { id: newId('m'), ...r.m, say: text(args.say, LIMIT.say), made: clock(env), until: clock(env) + LIMIT.days * DAY };
          s.monitors.push(m);
          await write(env, s);
          await arm(env, s);
          return { id: m.id, what: 'monitor', watch: m.watch, about: about(m), ...(m.say && { say: m.say }) };
        });
      },
    }),
    def('wakes_list', {
      run: async () => {
        const s = await read(env);
        return { items: [...s.wakes.map((w) => ({ id: w.id, what: 'wake', at: w.at, say: w.say })),
          ...s.monitors.map((m) => ({ id: m.id, what: 'monitor', watch: m.watch, about: about(m), ...(m.say && { say: m.say }) }))] };
      },
    }),
    def('wake_cancel', {
      summarize: async (args, ctx) => {
        const s = await read(env), w = s.wakes.find((x) => x.id === args.id), m = s.monitors.find((x) => x.id === args.id);
        if (!w && !m) throw new Error('No wake or monitor has that id; wakes_list names them.');
        return w ? `Cancel coming back ${said(w.at, zoneOf(ctx))}: “${w.say}”.` : `Stop watching for ${about(m)}.`;
      },
      run: (args) => turn(async () => {
        const s = await read(env), w = s.wakes.find((x) => x.id === args.id), m = s.monitors.find((x) => x.id === args.id);
        if (!w && !m) return fail('No wake or monitor has that id; wakes_list names them.');
        s.wakes = s.wakes.filter((x) => x.id !== args.id);
        s.monitors = s.monitors.filter((x) => x.id !== args.id);
        await write(env, s);
        if (w && env.alarms) try { await env.alarms.clear(`${ALARM}wake:${w.id}`); } catch { /* gone */ }
        await arm(env, s);
        return { cancelled: args.id, what: w ? 'wake' : 'monitor' };
      }),
    }),
  ];
  const register = (registry, env) => tools(env).map((t) => registry.add(t));
  return { KEY, ALARM, TICK, LIMIT, WATCHES, clean, shape, changed, tick, alarm, take, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_RIME_WAKES; else GZ_AI_RIME_WAKES;
