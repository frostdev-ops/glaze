#!/usr/bin/env node
// Writes test/fixtures/ai/local-format/window.json for test/ai/local-window.test.js: inputs from the Glaze fine-tune's
// training items (glaze-plans/lfm-tune data/items) with the prompts, answers and maxTokens its training examples
// (data/train, data/build) hold for them, made at FORMAT.md's 4,096-token window: a writer.review draft the training split
// in two (`draft part 1 of 2`, `draft part 2 of 2`), a syllabus.read syllabus in one, and the texts of three more syllabi
// (the test joins them into one long enough to split). A prompt is its segments up to and including the assistant header,
// specials by name and adjacent text runs joined; an answer, the trained JSON.
//   node tools/dev/local-window-fixture.js --data <glaze-plans/lfm-tune/data>
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const DATA = arg('data');
if (!DATA) { console.error('usage: node tools/dev/local-window-fixture.js --data <glaze-plans/lfm-tune/data>'); process.exit(2); }
const OUT = path.join(__dirname, '..', '..', 'test', 'fixtures', 'ai', 'local-format', 'window.json');
const read = (f) => fs.readFileSync(path.join(path.resolve(DATA), f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const join = (segs) => {
  const out = [];
  for (const s of segs) {
    if (s.s !== undefined) out.push({ s: s.s });
    else if (out.length && out.at(-1).t !== undefined) out.at(-1).t += s.t;
    else out.push({ t: s.t });
  }
  return out;
};
const example = (task, source) => {
  const item = read(`items/${task}.jsonl`).find((e) => e.id === source);
  const built = new Map(read(`build/${task}.jsonl`).filter((e) => e.source === source).map((e) => [e.id, e.maxTokens]));
  const trained = read(`train/${task}.jsonl`).filter((e) => e.source === source).sort((a, b) => a.id.localeCompare(b.id));
  if (!item || !trained.length) throw new Error(`${source}: no item or no training example`);
  return { source, input: item.input, parts: trained.map((e) => {
    const at = e.segments.findIndex((s) => s.loss);
    return { id: e.id, maxTokens: built.get(e.id), prompt: join(e.segments.slice(0, at)), answer: e.segments[at].t };
  }) };
};

const review = example('writer.review', 'writer.review-t00004');
const syllabus = example('syllabus.read', 'syllabus.read-t00000');
const syllabi = read('items/syllabus.read.jsonl').filter((e) => ['syllabus.read-t00001', 'syllabus.read-t00002', 'syllabus.read-t00003'].includes(e.id)).map((e) => e.input.text);
const commit = (() => { try { return execFileSync('git', ['-C', path.resolve(DATA), 'log', '-1', '--format=%h', '--', '.'], { encoding: 'utf8' }).trim() || null; } catch { return null; } })();
const made = { by: 'node tools/dev/local-window-fixture.js --data <glaze-plans/lfm-tune/data>', data: commit, window: 4096 };
fs.writeFileSync(OUT, `${JSON.stringify({ made, review, syllabus, syllabi }, null, 1)}\n`);
console.log(`review ${review.parts.length} parts, syllabus ${syllabus.parts.length}, ${syllabi.length} more syllabi`);
