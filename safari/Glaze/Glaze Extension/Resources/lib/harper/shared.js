// Glaze Writer's one Harper for the whole browser: a module SharedWorker ('glaze-harper') every editor frame connects to
// (writer-proof.js), so ten boxes in ten tabs on two schools still hold one linter (~150 MB warm). Where SharedWorker is
// missing (Safari) a frame runs this same file as its own module Worker. Harper (lib/harper, Apache-2.0) loads on the first
// lint and the worker closes after IDLE with nothing asked, giving its memory back; the frames' next lint starts a new one
// (~300 ms) and the underlines already drawn stay. Lints are queued per frame and taken in turn, a newer lint of the same
// paragraph replacing a queued one. Each frame has its own words (its box's context) and ignored lints; the student's
// dictionary (chrome.storage.local 'writerWords', which the frames read and write) is shared.
// frame → worker: lint { id, key, text }, words { words } (this frame's), dict { words } (added to the shared dictionary),
//   ignore { kind, problem, message }, stats { id }, idle { ms }, bye.
// worker → frame: lint { id, lints: [{ start, end, kind, message, problem, suggestions: [{ k, t }] }], ms } (or stale: true,
//   or error), stats { id, worker, ports, loads, lints, loaded }, closing.
import { LocalLinter, Dialect } from './index.js';
import { slimBinary } from './slimBinary.js';

const WORKER = crypto.randomUUID(), MAX_TEXT = 200000, MAX_WORDS = 5000;
let IDLE = 5 * 60 * 1000;
const frames = new Map(); // port → { queue: [{ id, key, text }], words: Set, ignored: Set }
const order = []; // ports, the next one to be served first
const shared = new Set();
let linter = null, loading = null, loads = 0, lints = 0, busy = false, timer = 0, closing = false;

const load = () => (loading ||= (async () => {
  const l = new LocalLinter({ binary: slimBinary, dialect: Dialect.American });
  await l.setup();
  if (shared.size) await l.importWords([...shared]);
  loads++;
  linter = l;
  return l;
})().catch((e) => { loading = null; throw e; }));

const words = (list) => (Array.isArray(list) ? list.filter((w) => typeof w === 'string' && w.length > 0 && w.length <= 60).slice(0, MAX_WORDS) : []);
const lower = (w) => w.toLowerCase();
// A lint as plain data, Harper's handles freed.
const shape = (l) => {
  const span = l.span();
  const out = { start: span.start, end: span.end, kind: l.lint_kind(), message: l.message(), problem: l.get_problem_text(), suggestions: [] };
  span.free?.();
  for (const s of l.suggestions()) { out.suggestions.push({ k: s.kind(), t: s.get_replacement_text() }); s.free?.(); }
  return out;
};
const known = (f, w) => shared.has(lower(w)) || f.words.has(lower(w));
const keep = (f, l) => !((l.kind === 'Spelling' || l.kind === 'Typo') && known(f, l.problem)) && !f.ignored.has(`${l.kind}\u0000${l.problem}\u0000${l.message}`);

const idle = () => { clearTimeout(timer); timer = setTimeout(quit, IDLE); };
const quit = () => {
  if (busy || order.some((p) => frames.get(p)?.queue.length)) { idle(); return; }
  closing = true;
  for (const p of frames.keys()) p.postMessage({ op: 'closing' });
  linter?.dispose?.();
  close();
};

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
        const l = linter || await load();
        const t0 = performance.now();
        const raw = await l.lint(job.text, { language: 'plaintext' });
        const out = [];
        for (const x of raw) { const s = shape(x); x.free?.(); if (keep(f, s)) out.push(s); }
        lints++;
        port.postMessage({ op: 'lint', id: job.id, lints: out, ms: performance.now() - t0 });
      } catch (e) {
        port.postMessage({ op: 'lint', id: job.id, error: String(e?.message || e) });
      }
    }
  } finally {
    busy = false;
    idle();
  }
};

const ON = {
  lint: (port, f, m) => {
    if (typeof m.id !== 'number' || typeof m.text !== 'string') return;
    const key = typeof m.key === 'string' ? m.key : '';
    if (key) for (let i = f.queue.length - 1; i >= 0; i--) if (f.queue[i].key === key) port.postMessage({ op: 'lint', id: f.queue.splice(i, 1)[0].id, stale: true });
    f.queue.push({ id: m.id, key, text: m.text.slice(0, MAX_TEXT) });
    pump();
  },
  words: (_port, f, m) => { f.words = new Set(words(m.words).map(lower)); },
  dict: async (_port, _f, m) => {
    const fresh = words(m.words).map(lower).filter((w) => !shared.has(w));
    if (!fresh.length) return;
    for (const w of fresh) shared.add(w);
    if (linter) await linter.importWords(fresh);
  },
  ignore: (_port, f, m) => { if ([m.kind, m.problem, m.message].every((v) => typeof v === 'string')) f.ignored.add(`${m.kind}\u0000${m.problem}\u0000${m.message}`); },
  stats: (port, _f, m) => port.postMessage({ op: 'stats', id: m.id, worker: WORKER, ports: frames.size, loads, lints, loaded: !!linter }),
  idle: (_port, _f, m) => { if (Number.isFinite(m.ms) && m.ms >= 1000) { IDLE = m.ms; idle(); } },
  bye: (port) => { frames.delete(port); const k = order.indexOf(port); if (k >= 0) order.splice(k, 1); },
};

const attach = (port) => {
  if (closing) return;
  frames.set(port, { queue: [], words: new Set(), ignored: new Set() });
  order.push(port);
  port.onmessage = ({ data: m }) => {
    const f = frames.get(port);
    if (f && m && typeof m.op === 'string' && Object.hasOwn(ON, m.op)) ON[m.op](port, f, m);
  };
  idle();
};

if ('onconnect' in globalThis) globalThis.onconnect = (e) => attach(e.ports[0]);
else attach(globalThis);
