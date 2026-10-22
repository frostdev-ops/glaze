// One queue per LMS site for the requests Glaze sends it in bulk (each course's gradebook and content on Ultra's Courses,
// Grades and course pages, Canvas's module lists on Modules), so a page of courses never becomes a burst the school's
// throttle punishes: three at a time, what's on screen first (prio 0 before 1, in order of asking). A 429 or a 5xx pauses
// the site's queue for its Retry-After, else for 2 s, doubling with each one until something else answers (ten minutes
// at most); a 401 (signed out) refuses the site's requests here, without asking, until the page's address changes.
// Nothing is retried on its own: callers decide when to ask again. fetch(url, init, prio) stands in for fetch
// (lib/ultra.js read()'s f); run(task, prio) queues anything else that asks the site (a task rejecting with an HTTP
// status, as content.js's capi does).
// Classic script, loaded on demand (content.js need()): a second injection keeps the first; module.exports for node.
var GZ_LMSQ = globalThis.GZ_LMSQ || (() => {
  const MAX = 3, CAP = 600000;
  const sites = new Map(); // origin → { busy, wait: [{ prio, go, refuse }], until, fails, out, timer }
  const of = (origin) => {
    if (!sites.has(origin)) sites.set(origin, { busy: 0, wait: [], until: 0, fails: 0, out: null, timer: 0 });
    return sites.get(origin);
  };
  const here = () => `${globalThis.location?.pathname || ''}${globalThis.location?.search || ''}`;
  // How long a 429 or 5xx holds the site: Retry-After's seconds or date, else doubling.
  const hold = (s, retry) => {
    const now = Date.now(), v = String(retry ?? '').trim();
    const said = /^\d+$/.test(v) ? v * 1000 : Date.parse(v) - now;
    s.until = Math.max(s.until, now + Math.min(CAP, said > 0 ? said : 2000 * 2 ** s.fails));
    s.fails += 1;
  };
  const answered = (s, status, retry, at = here()) => {
    if (status === 401) s.out = at;
    else if (status === 429 || status >= 500) hold(s, retry);
    else if (status) s.fails = 0;
  };
  const pump = (s) => {
    if (s.out !== null && s.out !== here()) s.out = null;
    if (s.out !== null) { for (const job of s.wait.splice(0)) job.refuse(); return; }
    const wait = s.until - Date.now();
    if (wait > 0) {
      if (!s.timer && s.wait.length) s.timer = setTimeout(() => { s.timer = 0; pump(s); }, wait);
      return;
    }
    while (s.busy < MAX && s.wait.length) {
      let i = 0;
      // Visible work jumps ahead briefly; an older hidden read must still get a turn.
      const priority = (job) => Date.now() - job.at >= 30000 ? -1 : job.prio;
      for (let j = 1; j < s.wait.length; j++) if (priority(s.wait[j]) < priority(s.wait[i])) i = j;
      const [job] = s.wait.splice(i, 1);
      s.busy += 1;
      job.go().finally(() => { s.busy -= 1; pump(s); });
    }
  };
  const queue = (origin, prio, go, refuse, signal) => new Promise((resolve, reject) => {
    const s = of(origin);
    if (signal?.aborted) return reject(signal.reason);
    const end = () => signal?.removeEventListener('abort', abort);
    const job = { at: Date.now(), prio: prio || 0, go: () => Promise.resolve().then(go).then(resolve, reject).finally(end), refuse: () => Promise.resolve().then(refuse).then(resolve, reject).finally(end) };
    const abort = () => {
      const i = s.wait.indexOf(job);
      if (i !== -1) { s.wait.splice(i, 1); end(); reject(signal.reason); }
    };
    signal?.addEventListener('abort', abort, { once: true });
    s.wait.push(job);
    pump(s);
  });
  // A refused request answers as the site did last: 401.
  const fetchQ = (url, init = {}, prio = 0, live = () => true) => {
    const origin = new URL(url).origin, s = of(origin);
    return queue(origin, prio, () => {
      if (!live()) throw new Error('stale');
      const at = here();
      return fetch(url, init).then(async (r) => {
        answered(s, r.status, r.headers?.get('Retry-After'), at);
        // fetch settles at headers; hold the slot until the JSON body is in, or streaming responses still fan out.
        if (!r.ok) { await r.body?.cancel(); return r; }
        const body = r.body ? await r.arrayBuffer() : null;
        const copy = new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
        for (const k of ['url', 'type', 'redirected']) Object.defineProperty(copy, k, { value: r[k] });
        return copy;
      });
    },
      () => Promise.resolve(new Response(null, { status: 401 })), init.signal);
  };
  const run = (task, prio = 0, origin = location.origin) => {
    const s = of(origin);
    return queue(origin, prio, () => {
      const at = here();
      return Promise.resolve().then(task).then((v) => { answered(s, 200); return v; }, (e) => {
        answered(s, typeof e === 'number' ? e : +/\bHTTP (\d{3})\b/.exec(e?.message)?.[1] || 0, undefined, at);
        throw e;
      });
    }, () => Promise.reject(401));
  };
  return { fetch: fetchQ, run, MAX };
})();

if (typeof module !== 'undefined') module.exports = GZ_LMSQ; else GZ_LMSQ;
