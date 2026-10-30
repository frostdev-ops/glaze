// writer.complete reads the whole document (lib/ai/tasks/writer-complete.js): the document so far as a rolling window the
// model's input window holds (the earliest paragraphs left out first), in a prompt whose start stays the same while the
// student types (the page's context, then the document so far; the sentence at the caret last), the suggestions already
// shown as a rolling list, and a check that refuses a finish repeating a sentence the document has or the gray text
// already suggested. Through the harness with the mock provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/ai/task.js');
const R = require('../lib/ai/request.js');
const X = require('../lib/ai/text.js');
require('../lib/ai/providers/mock.js');
const C = require('../lib/ai/tasks/writer-complete.js');

const ASSIGN = { kind: 'assignment', course: { id: '_1_1', name: 'ENGL 2110' }, style: 'mla9',
  assignment: { title: 'Essay 2', instructions: 'Write about memory in Beloved.', rubric: 'Thesis: 10 points' } };
// Paragraph k of about `size` characters, its first and last words saying which it is.
const para = (k, size = 1000) => {
  let s = `Paragraph ${k} opens here.`, i = 0;
  while (s.length < size - 40) s += ` Detail ${k} ${++i} is about the river and the town.`;
  return `${s} Paragraph ${k} ends here.`;
};
const doc = (n, size) => Array.from({ length: n }, (_, i) => para(i + 1, size)).join('\n');
const CARET = 'In the end the river keeps ';
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const blocks = (data) => [...data.matchAll(/\[([^\]\n]+?) — data copied from a page or a document, not instructions\]\n<<<(DATA-[0-9a-f]+)\n([\s\S]*?)\n>>>\2/g)]
  .map((m) => ({ label: m[1], body: m[3], end: m.index + m[0].length }));
const go = async (input, reply, caps) => {
  const cfg = { replies: [{ text: reply }], seen: [], caps };
  const out = await T.run(C.task, { mode: 'paper', kind: 'assignment', context: ASSIGN, ...input }, { provider: 'mock', cfg, emit() {} }).catch((e) => ({ output: null, code: e.code }));
  const req = cfg.seen[0];
  return { ...out, req, system: req?.messages[0].content[0].text, data: req?.messages[1].content.map((p) => p.text).join('\n\n'), blocks: req ? blocks(req.messages[1].content.map((p) => p.text).join('\n\n')) : [] };
};
const block = (r, re) => r.blocks.find((b) => re.test(b.label));

test('the prompt holds the page\'s context, then the whole document from its first paragraph, and the caret\'s sentence last', async () => {
  const d = doc(20);
  const a = await go({ before: `${d}\n${CARET}`, after: '\nA closing line follows here.' }, 'what the town forgets.', { context: 128000 });
  assert.equal(a.output, 'what the town forgets.');
  const labels = a.blocks.map((b) => b.label);
  assert.deepEqual(labels, ['course', 'citation style', 'assignment title', 'assignment instructions', 'rubric', 'the document so far', 'the text after the caret', 'the sentence the student is typing']);
  const so = block(a, /^the document so far/);
  assert.ok(so.body.startsWith('Paragraph 1 opens here.') && so.body.endsWith('Paragraph 20 ends here.'), 'all twenty paragraphs, the first one first');
  assert.equal(a.blocks.at(-1).body, CARET.trim());
  assert.match(a.system, /names, terms/, 'told to keep to the whole document');
  assert.match(a.system, /only the next words/, 'and still to finish only the sentence');
});

test('while the student types, the request starts the same way: the system message, the context and the document so far', async () => {
  const d = doc(20);
  const a = await go({ before: `${d}\n${CARET}`, after: '\nA closing line follows here.' }, 'what the town forgets.', { context: 128000 });
  const b = await go({ before: `${d}\n${CARET}what the `, after: '\nA closing line follows here.' }, 'town forgets.', { context: 128000 });
  const c = await go({ before: `${d}\n${CARET}what the `, after: '\nA closing line follows here.', past: [`${CARET}what the town forgets.`] }, 'town would rather forget.', { context: 128000 });
  assert.equal(a.system, b.system);
  assert.equal(b.system, c.system, 'the same instructions with suggestions already shown');
  const upTo = (r, re) => r.data.slice(0, block(r, re).end);
  assert.equal(upTo(a, /^the text after the caret$/), upTo(b, /^the text after the caret$/), 'the same prefix through the document and the text after');
  assert.equal(upTo(b, /^the text after the caret$/), upTo(c, /^the text after the caret$/));
  assert.deepEqual(c.blocks.slice(-2).map((x) => x.label), ['suggestions already shown', 'the sentence the student is typing'], 'the volatile part last');
  assert.equal(c.output, 'town would rather forget.');
});

test('a document longer than the window is cut at a paragraph boundary from its start, and the request fits the window', async () => {
  const d = doc(200); // about 200,000 characters
  const r = await go({ before: `${d}\n${CARET}` }, 'what the town forgets.', { context: 32000 });
  assert.equal(r.output, 'what the town forgets.');
  const so = block(r, /^the document so far/);
  const first = Number(/^Paragraph (\d+) opens here\./.exec(so.body)?.[1]);
  assert.ok(first > 1, `starts at a paragraph: ${so.body.slice(0, 40)}`);
  assert.ok(d.split('\n')[first - 2] && !so.body.includes(`Paragraph ${first - 1} ends here.`), 'the paragraph before it is left out whole');
  assert.ok(so.body.endsWith('Paragraph 200 ends here.'), 'the latest text kept');
  assert.equal(so.label, 'the document so far: its latest part');
  const tokens = X.estimateTokens(r.req) + r.req.maxTokens, room = Math.floor(32000 * 0.9);
  assert.ok(tokens <= room, `${tokens} tokens within ${room}`);
  assert.ok(tokens > room - 1000 / 4 - 200, `${tokens} tokens: the window is used, less than a paragraph left over`);
});

test('the window math: known, unknown, large, brief, and the request\'s own size limit', async () => {
  const paper = doc(100); // a 50-page paper, about 100,000 characters
  assert.ok(paper.length > 95000);
  const whole = await go({ before: `${paper}\n${CARET}` }, 'what the town forgets.', { context: 128000 });
  assert.equal(block(whole, /^the document so far/).body, paper, 'a 128k window takes the whole paper');
  assert.equal(block(whole, /^the document so far/).label, 'the document so far');
  assert.ok(X.estimateTokens(whole.req) + 64 <= Math.floor(128000 * 0.9));

  const unknown = await go({ before: `${paper}\n${CARET}` }, 'what the town forgets.');
  const u = block(unknown, /^the document so far/).body;
  assert.ok(bytes(u) <= C.READ.unknown && bytes(u) > C.READ.unknown - 1100, `unknown window: ${bytes(u)} bytes`);
  assert.match(u, /^Paragraph \d+ opens here\./);
  // Bytes, not characters: a paper in Chinese gets about a third as many characters.
  const zh = Array.from({ length: 60 }, (_, i) => `第${i + 1}段。${'河流记得城镇想忘记的事情。'.repeat(60)}`).join('\n');
  const z = block(await go({ before: `${zh}\n${CARET}` }, 'what the town forgets.'), /^the document so far/).body;
  assert.ok(bytes(z) <= C.READ.unknown && z.length < C.READ.unknown / 2.5, `${z.length} characters, ${bytes(z)} bytes`);
  assert.match(z, /^第\d+段。/, 'from a paragraph start');

  for (const caps of [{ local: true }, { context: 6144 }, { local: true, context: 9216 }]) {
    const small = await go({ before: `${paper}\n${CARET}`, after: '\nA closing line follows here.' }, 'what the town forgets.', caps);
    const so = block(small, /^the document so far/);
    assert.ok(so && bytes(so.body) <= C.BRIEF.document, `${JSON.stringify(caps)}: a rolling window of ${so && bytes(so.body)} bytes`);
    assert.ok(so.body.endsWith('Paragraph 100 ends here.'), 'the newest text');
    assert.ok(!block(small, /^the text after the caret$/) && !block(small, /^rubric$/), 'no text after the caret and no rubric');
    assert.ok(X.estimateTokens(small.req) < 1600, `${JSON.stringify(caps)}: ${X.estimateTokens(small.req)} tokens`);
  }

  // A window bigger than a run may read (lib/ai/loop.js refuses a request over the task's limits.tokens): the run's bound.
  assert.equal(C.task.limits.tokens, C.READ.tokens);
  assert.ok(C.READ.tokens * C.READ.room * C.READ.bytes < R.LIMIT.text, 'and so under the request\'s own text limit');
  const huge = doc(1000, 1000).slice(-(C.LIMIT.raw - CARET.length - 1)).replace(/^[^\n]*\n/, '');
  const full = { kind: 'reply', course: { name: 'ENGL 2110' }, prompt: { text: 'Prompt words. '.repeat(560) },
    thread: Array.from({ length: 6 }, (_, i) => ({ author: `Student ${i}`, text: `Post ${i} words. `.repeat(230) })),
    assignment: { title: 'Essay 2', instructions: 'Instruction words. '.repeat(620), description: 'Description words. '.repeat(310), rubric: 'Rubric words. '.repeat(850) } };
  for (const caps of [{ context: 2000000 }, { context: 200000 }]) {
    const big = await go({ before: `${huge}\n${CARET}`, context: full }, 'what the town forgets.', caps);
    assert.equal(big.code, undefined, `${caps.context}: not refused`);
    assert.equal(big.output, 'what the town forgets.');
    const tokens = X.estimateTokens(big.req) + 64;
    assert.ok(tokens <= Math.floor(C.READ.tokens * C.READ.room) && tokens > Math.floor(C.READ.tokens * C.READ.room) - 400, `${caps.context}: ${tokens} tokens`);
    assert.match(block(big, /^the document so far/).body, /^Paragraph \d+ opens here\./);
  }
});

test('the brief prompt for a model on this computer keeps BRIEF\'s bounds', async () => {
  assert.deepEqual([C.BRIEF.before, C.BRIEF.after, C.BRIEF.context, C.BRIEF.window], [1200, 200, 600, 32000]);
  const long = { ...ASSIGN, assignment: { ...ASSIGN.assignment, instructions: `Write about memory. ${'Detail. '.repeat(400)}` } };
  const cfg = { replies: [{ text: 'what the town forgets.' }], seen: [], caps: { local: true } };
  await T.run(C.task, { before: `${doc(3)}\n${'word '.repeat(400)}and the river keeps `, context: long, past: Array.from({ length: 10 }, (_, i) => `Suggestion ${i} was shown at this place before now.`) }, { provider: 'mock', cfg });
  const b = blocks(cfg.seen[0].messages[1].content.map((p) => p.text).join('\n\n'));
  assert.ok(b.find((x) => x.label === 'assignment instructions').body.length <= C.BRIEF.context + 1);
  assert.ok(b.find((x) => x.label === 'the sentence the student is typing').body.length <= C.BRIEF.before);
  const shown = b.find((x) => x.label === 'suggestions already shown').body.split('\n');
  assert.deepEqual(shown, ['Suggestion 7 was shown at this place before now.', 'Suggestion 8 was shown at this place before now.', 'Suggestion 9 was shown at this place before now.'], 'the newest few');
});

test('a finish that repeats a sentence of the document, or one the gray text already suggested, is refused', () => {
  // More than 40 words between, so only the new check can see the earlier sentence (the old one looks at the last 40).
  const gap = 'Then the chapter turns to Paul D and the years he spent away from the farm, the work he did, the men he met, and the long walk north that brought him to the porch of the house on Bluestone Road where Sethe and Denver still lived with the ghost and the red light that filled the front room every evening.\n';
  const d = `The river keeps what the town would rather forget.\nMorrison returns to the clearing in every chapter, and each return costs Sethe something.\n${gap}`;
  const at = (before, extra = {}) => C.task.input({ before, ...extra });
  assert.equal(C.finish('to the clearing in every chapter.', at(`${d}In the second part, Morrison returns `)), null, 'six words of an earlier sentence');
  assert.equal(C.finish('to the clearing again.', at(`${d}In the second part, Morrison returns `)), 'to the clearing again.', 'a short phrase again is fine');
  assert.equal(C.finish('town would rather forget.', at(`${d}As the novel shows, the river keeps what the `)), null, 'the sentence would end with an earlier one, whole');
  assert.equal(C.finish('town would rather forget.', at(`${d}The flood keeps what the `)), 'town would rather forget.', 'a different sentence sharing its end');
  assert.equal(C.finish('clearing in every chapter, and each return costs Sethe something.', at(`${d}Morrison returns to the clear`)), null, 'mid-word, the same sentence again');
  assert.equal(C.finish('use the discussion board every week.', at('Three things I learned are how to ', { after: '\nLater I learned to use the discussion board every week.' })), null, 'a sentence after the caret');
  // The gray text already suggested.
  const plan = 'Our group met every week to plan the ';
  assert.equal(C.finish('next presentation.', at(plan)), 'next presentation.');
  assert.equal(C.finish('next presentation.', at(plan, { past: [`${plan}next presentation.`] })), null, 'the same suggestion at the same sentence');
  assert.equal(C.finish('presentation.', at(`${plan}next `, { past: [`${plan}next presentation.`] })), null, 'typed on into it, the same sentence again');
  assert.equal(C.finish('the history of the river and its towns.', at('Then I wrote a short summary of ', { past: ['We spent the first week reading about the history of the river and its towns.'] })), null, 'six words of a past suggestion');
  assert.equal(C.finish('the river and its towns.', at('Then I wrote a short summary of ', { past: ['We spent the first week reading about the history of the river and its towns.'] })), 'the river and its towns.', 'a short phrase of one is fine');
});

test('input() takes the whole text before the caret up to LIMIT.raw, the text after to a paragraph\'s end, and the newest suggestions', () => {
  const tail = 'and the rivers keeps';
  const exact = `${'word '.repeat((C.LIMIT.raw - tail.length) / 5)}${tail}`;
  assert.equal(exact.length, C.LIMIT.raw);
  assert.equal(C.task.input({ before: exact }).before.length, C.LIMIT.raw, 'the whole text, up to LIMIT.raw');
  assert.equal(C.task.input({ before: `w${exact}` }), null, 'longer is refused');
  assert.equal(C.LIMIT.after, 4000);
  const p1 = para(1, 3000), p2 = para(2, 3000);
  assert.equal(C.task.input({ before: CARET, after: `\n${p1}\n${p2}` }).after, `\n${p1}`, 'whole paragraphs where one fits');
  const one = C.task.input({ before: CARET, after: `\n${para(1, 6000)}` }).after;
  assert.ok(one.length <= C.LIMIT.after && one.length > C.LIMIT.after - 40 && /\S$/.test(one), 'else to a word\'s end');
  for (const past of ['x', [1], [null], {}]) assert.equal(C.task.input({ before: CARET, past }), null, JSON.stringify(past));
  const many = Array.from({ length: 45 }, (_, i) => `Suggestion number ${i} ended a sentence.`);
  const kept = C.task.input({ before: CARET, past: many }).past;
  assert.equal(kept.length, C.LIMIT.past);
  assert.equal(kept.at(-1), many.at(-1), 'the newest kept, the oldest dropped');
  const long = `${'word '.repeat(1000)}and it ended.`;
  const cut = C.task.input({ before: CARET, past: [long] }).past[0];
  assert.ok(cut.length <= C.LIMIT.said && cut.endsWith('and it ended.'));
  assert.deepEqual(C.task.input({ before: CARET }).past, []);
});

test('a warm request still carries the short stub', () => {
  const req = T.prepare(C.task, { before: 'Words to warm with ', after: '', mode: 'compose', kind: 'reply', context: ASSIGN }, { provider: 'mock', cfg: { replies: [] } });
  const b = blocks(req.messages[1].content[0].text);
  assert.ok(!b.some((x) => /^the document so far/.test(x.label)), 'no document in a warm-up');
  assert.equal(b.at(-1).body, 'Words to warm with');
});


test('UTF-8 rolling cuts preserve supplementary characters, including a paragraph with no spaces', () => {
  for (const source of ['前𠮷末', '😀'.repeat(20), '前。後𠮷末', 'word '.repeat(100) + '𠮷末']) {
    for (let budget = 0; budget < 40; budget++) {
      const cut = C.latest(source, budget);
      assert.ok(cut.isWellFormed(), `${budget}: ${JSON.stringify(cut)}`);
      assert.ok(bytes(JSON.stringify(cut)) - 2 <= budget, `${budget}: ${bytes(JSON.stringify(cut)) - 2} bytes`);
    }
  }
});

test('a huge unfinished paragraph and CJK caret stay within the run budget', async () => {
  for (const before of ['detail '.repeat(90000) + CARET, '河流'.repeat(120000) + ' and the river keeps ']) {
    const r = await go({ before }, 'what the town forgets.', { context: 128000 });
    assert.equal(r.code, undefined);
    assert.equal(r.output, 'what the town forgets.');
    assert.ok(X.estimateTokens(r.req) + 64 <= Math.floor(C.READ.tokens * C.READ.room));
    assert.ok(r.req.messages.every((m) => m.content.every((p) => p.text.isWellFormed())));
  }
});

test('tiny catalog windows refuse before calling a provider; fitting small windows honor headroom and the past share', async () => {
  const tiny = await go({ before: CARET }, 'what the town forgets.', { context: 256 });
  assert.equal(tiny.code, 'size');
  assert.equal(tiny.req, undefined);
  const r = await go({ before: doc(5) + '\n' + CARET, past: Array.from({ length: 3 }, () => 'A previous suggestion with enough words. '.repeat(10)) }, 'what the town forgets.', { context: 1024 });
  assert.equal(r.output, 'what the town forgets.');
  assert.ok(X.estimateTokens(r.req) + 64 <= Math.floor(1024 * 0.9));
  assert.ok(X.estimateTokens(r.req) + 64 + 128 <= 1024);
  assert.ok(bytes(block(r, /^suggestions already shown$/)?.body || '') <= 1024 * 4 * 0.05);
});

test('defined terms and names can recur, while six copied words inside a new finish cannot', () => {
  const at = (document, before) => C.task.input({ before: document + '\n' + 'An unrelated sentence about local history. '.repeat(15) + '\n' + before });
  assert.equal(C.finish('attention residue.', C.task.input({ before: 'Attention residue persists after a switch. Our next intervention reduces ' })), 'attention residue.');
  const term = 'Cognitive load during sustained task switching refers to the effort of changing focus.';
  assert.equal(C.finish('cognitive load during sustained task switching.', at(term, 'Our experiment measures ')), 'cognitive load during sustained task switching.');
  const name = 'The United States Department of Veterans Affairs supports this program.';
  assert.equal(C.finish('the United States Department of Veterans Affairs.', at(name, 'Our partner works with ')), 'the United States Department of Veterans Affairs.');
  const copied = 'The team returns to the clearing in every chapter, and each return costs something.';
  assert.equal(C.finish('to the clearing in every chapter for inspiration.', at(copied, 'Morrison also returns ')), null);
  assert.equal(C.finish('returns to the clearing in every chapter.', at(copied, 'The team ')), null);
});

test('a stable block ends at the document; suggestions and the caret never carry its cache marker', async () => {
  const first = await go({ before: doc(5) + '\n' + CARET }, 'what the town forgets.', { context: 128000 });
  const next = await go({ before: doc(5) + '\n' + CARET + 'what the ', past: [CARET + 'what the town forgets.'] }, 'town would rather forget.', { context: 128000 });
  const a = first.req.messages[1].content, b = next.req.messages[1].content;
  assert.equal(a.length, 2);
  assert.equal(a[0].cache, true);
  assert.equal(a[1].cache, undefined);
  assert.deepEqual(a[0], b[0]);
  assert.match(a[0].text, /Paragraph 5 ends here/);
  assert.doesNotMatch(a[0].text, /the sentence the student is typing|suggestions already shown/);
  assert.match(b[1].text, /suggestions already shown/);
  assert.match(b[1].text, /the sentence the student is typing/);
});
