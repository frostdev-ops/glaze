// Glaze Writer's one Harper for the whole browser: a module SharedWorker ('glaze-harper') every editor frame connects to
// (writer-proof.js), so ten boxes in ten tabs on two schools still hold one linter (~150 MB warm). Where SharedWorker is
// missing (Safari) a frame runs this same file as its own module Worker. Harper (lib/harper, Apache-2.0) loads on the first
// lint and the worker closes after IDLE with nothing asked, giving its memory back; the frames' next lint starts a new one
// (~300 ms) and the underlines already drawn stay. Lints are queued per frame and taken in turn, a newer lint of the same
// paragraph replacing a queued one. Each frame has its own words (its box's context) and ignored lints; the student's
// dictionary (chrome.storage.local 'writerWords', which the frames read and write) is shared.
// frame → worker: lint { id, key, text }, words { words } (this frame's), dict { words } (added to the shared dictionary),
//   undict { words } (out of the shared dictionary: Harper is built again for the next lint), ignore { kind, problem,
//   message }, dialect { dialect } (Settings → Writer: 'en-US', 'en-GB', 'en-CA' or 'en-AU', one for the whole browser as
//   the setting is), stats { id }, idle { ms }, bye.
// worker → frame: lint { id, lints: [{ start, end, kind, message, problem, suggestions: [{ k, t }] }], ms } (or stale: true,
//   or error), stats { id, worker, ports, loads, lints, loaded, dialect }, closing.
import { LocalLinter, Dialect } from './index.js';
import { slimBinary } from './slimBinary.js';

const WORKER = crypto.randomUUID(), MAX_TEXT = 200000, MAX_WORDS = 5000, MAX_QUEUE = 64, MAX_IGNORED = 2000;
let IDLE = 5 * 60 * 1000;
const frames = new Map(); // port → { queue: [{ id, key, text }], words: Set, ignored: Set }
const order = []; // ports, the next one to be served first
const shared = new Set();
let linter = null, loading = null, loads = 0, lints = 0, busy = false, timer = 0, closing = false;
const DIALECTS = { 'en-US': Dialect.American, 'en-GB': Dialect.British, 'en-CA': Dialect.Canadian, 'en-AU': Dialect.Australian };
let dialect = DIALECTS['en-US'], rebuild = false;

const load = () => (loading ||= (async () => {
  const l = new LocalLinter({ binary: slimBinary, dialect });
  try {
    await l.setup();
    if (shared.size) await l.importWords([...shared]);
  } catch (e) { await l.dispose().catch(() => {}); throw e; }
  loads++;
  linter = l;
  return l;
})().catch((e) => { loading = null; throw e; }));

const words = (list) => (Array.isArray(list) ? list.filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 60).slice(0, MAX_WORDS) : []);
const lower = (w) => w.toLowerCase();
// A lint as plain data, Harper's handles freed.
const shape = (l) => {
  const span = l.span();
  let out;
  try { out = { start: span.start, end: span.end, kind: l.lint_kind(), message: l.message(), problem: l.get_problem_text(), suggestions: [] }; }
  finally { span.free?.(); }
  const suggestions = l.suggestions();
  try { for (const s of suggestions) out.suggestions.push({ k: s.kind(), t: s.get_replacement_text() }); }
  finally { for (const s of suggestions) s.free?.(); }
  return out;
};
const known = (f, w) => shared.has(lower(w)) || f.words.has(lower(w));
const keep = (f, l) => !((l.kind === 'Spelling' || l.kind === 'Typo') && known(f, l.problem)) && !f.ignored.has(`${l.kind}\u0000${l.problem}\u0000${l.message}`);

const idle = () => { clearTimeout(timer); timer = setTimeout(quit, IDLE); };
const quit = async () => {
  if (closing) return;
  if (busy || order.some((p) => frames.get(p)?.queue.length)) { idle(); return; }
  closing = true;
  clearTimeout(timer);
  try { await linter?.dispose(); } catch { /* closing releases the whole worker */ }
  for (const p of frames.keys()) { p.postMessage({ op: 'closing' }); p.close?.(); }
  frames.clear();
  order.length = 0;
  close();
};
const detach = (port) => {
  frames.delete(port);
  const k = order.indexOf(port);
  if (k >= 0) order.splice(k, 1);
  port.onmessage = port.onmessageerror = null;
  port.close?.();
  if (!frames.size && !busy) quit();
};
const send = (port, m) => { if (frames.has(port)) try { port.postMessage(m); } catch { detach(port); } };

// One lint at a time, frames in turn.
const pump = async () => {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const k = order.findIndex((p) => frames.get(p)?.queue.length);
      if (k < 0) break;
      const port = order.splice(k, 1)[0];
      order.push(port);
      const f = frames.get(port), job = f.queue.shift();
      try {
        if (rebuild && linter) { rebuild = false; const old = linter; linter = null; loading = null; await old.dispose().catch(() => {}); }
        const l = linter || await load();
        if (!frames.has(port)) continue;
        const t0 = performance.now();
        const raw = await l.lint(job.text, { language: 'plaintext' });
        const out = [];
        try { for (const x of raw) { const s = shape(x); if (out.length < 2000 && keep(f, s)) out.push(s); } }
        finally { for (const x of raw) x.free?.(); }
        lints++;
        send(port, { op: 'lint', id: job.id, lints: out, ms: performance.now() - t0 });
      } catch (e) {
        send(port, { op: 'lint', id: job.id, error: String(e?.message || e) });
      } finally { f.ids.delete(job.id); }
    }
  } finally {
    busy = false;
    if (!frames.size) quit(); else idle();
  }
};

const ON = {
  lint: (port, f, m) => {
    if (!Number.isSafeInteger(m.id) || m.id < 0 || typeof m.text !== 'string') return;
    if (m.text.length > MAX_TEXT || (m.key !== undefined && (typeof m.key !== 'string' || m.key.length > 160))) {
      send(port, { op: 'lint', id: m.id, error: 'Invalid lint request' }); return;
    }
    if (f.ids.has(m.id)) return;
    const key = m.key || '';
    if (key) for (let i = f.queue.length - 1; i >= 0; i--) if (f.queue[i].key === key) {
      const old = f.queue.splice(i, 1)[0];
      f.ids.delete(old.id);
      send(port, { op: 'lint', id: old.id, stale: true });
    }
    if (f.queue.length >= MAX_QUEUE) { send(port, { op: 'lint', id: m.id, error: 'Lint queue is full' }); return; }
    f.ids.add(m.id);
    f.queue.push({ id: m.id, key, text: m.text });
    pump();
  },
  words: (_port, f, m) => { f.words = new Set(words(m.words).map(lower)); },
  dict: async (_port, _f, m) => {
    const fresh = [...new Set(words(m.words).map(lower))].filter((w) => !shared.has(w)).slice(0, MAX_WORDS - shared.size);
    if (!fresh.length) return;
    for (const w of fresh) shared.add(w);
    if (linter) await linter.importWords(fresh);
  },
  ignore: (_port, f, m) => { if (f.ignored.size < MAX_IGNORED && [m.kind, m.problem, m.message].every((v) => typeof v === 'string' && v.length <= 500)) f.ignored.add(`${m.kind}\u0000${m.problem}\u0000${m.message}`); },
  undict: (_port, _f, m) => {
    let any = false;
    for (const w of words(m.words).map(lower)) any = shared.delete(w) || any;
    if (any && linter) rebuild = true;
  },
  dialect: async (_port, _f, m) => {
    if (!Object.hasOwn(DIALECTS, m.dialect) || DIALECTS[m.dialect] === dialect) return;
    dialect = DIALECTS[m.dialect];
    if (linter) await linter.setDialect(dialect);
  },
  stats: (port, _f, m) => port.postMessage({ op: 'stats', id: m.id, worker: WORKER, ports: frames.size, loads, lints, loaded: !!linter, dialect: Object.keys(DIALECTS).find((k) => DIALECTS[k] === dialect) }),
  idle: (_port, _f, m) => { if (Number.isFinite(m.ms) && m.ms >= 1000) { IDLE = m.ms; idle(); } },
  bye: detach,
};

const attach = (port) => {
  if (closing) { port.postMessage({ op: 'closing' }); port.close?.(); return; }
  frames.set(port, { queue: [], ids: new Set(), words: new Set(), ignored: new Set() });
  order.push(port);
  port.onmessage = ({ data: m }) => {
    const f = frames.get(port);
    if (f && m && typeof m.op === 'string' && Object.hasOwn(ON, m.op)) Promise.resolve(ON[m.op](port, f, m)).catch(() => {});
  };
  port.onmessageerror = () => detach(port);
  idle();
};

if ('onconnect' in globalThis) globalThis.onconnect = (e) => attach(e.ports[0]);
else attach(globalThis);
