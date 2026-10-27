// Glaze test fixture: Glaze Writer papers as paper-schema JSON, synthetic text. Six-page MLA 9, APA 7 and Chicago 17
// papers (headings, a block quote, footnotes, a list page), and a copy of each with one seeded error per format check.
// Used by test/writer-paper*.test.js, scripts/writer-paper-check.js and scripts/writer-word-fidelity.js.
const SENTENCES = [
  'Toni Morrison\'s Beloved treats memory less as a record than as a debt that every character inherits whether or not they consent to it.',
  'The river and the clearing, the novel\'s two great gathering places, are where that debt comes due.',
  'Sethe calls the past "rememory," a word that refuses the comfort of the past tense.',
  'What she remembers is not hers alone; it waits for whoever walks into it, and it does not ask permission.',
  'Critics have often read the clearing as a site of healing, the place where Baby Suggs asks her congregation to love their flesh.',
  'Yet the clearing also works as a ledger, recording what the community owes and what it refuses to pay.',
  'James Baldwin\'s claim that history is "the price of the ticket" helps explain why the novel will not let anyone receive grace without first paying for it.',
  'The community that gathers there is also the community that later refuses to warn Sethe, and the novel insists that both gestures belong to the same place.',
  'The river, by contrast, is where the dead cross back.',
  'Beloved arrives from the water fully dressed, as if the current had kept her waiting, and the townspeople\'s silence is the condition of her return.',
  'Paul D carries his own memories in a tobacco tin where his heart used to be, rusted shut against everything Sweet Home took from him.',
  'Denver, who was born in a boat on the Ohio, learns that the house at 124 Bluestone Road is less a home than an archive with a temper.',
  'Each of these figures discovers that forgetting is not an option the novel offers, only a postponement it occasionally tolerates.',
  'The structure of the book enforces the same lesson, circling back to scenes it has already described and adding a detail each time.',
  'Readers are made to experience memory as Sethe does, in fragments that refuse to stay where they were put.',
  'Morrison once described her task as filling in the blanks that the slave narratives left, the interior lives that their authors could not afford to record.',
  'That task requires a form in which the past is never quite past, and in which every present scene is crowded by the ones behind it.',
  'The novel\'s final pages repeat the phrase "It was not a story to pass on" until its meaning splits in two.',
  'It was not a story to hand down, and it was not a story to pass by; the ambiguity is the inheritance.',
  'To read Beloved closely is to accept that obligation, and to notice how often the novel asks its readers to stay in the clearing a little longer.',
  'Stamp Paid\'s ribbon, the red cardinal feather in a dead girl\'s hair, becomes another entry in a ledger no one asked to keep.',
  'The house itself seems to participate in the accounting, rattling its furniture whenever someone tries to close the books too early.',
];
const BLOCK = { align: null, indent: 0, line: null, first: null };
const p = (text, attrs = {}, marks) => ({ type: 'paragraph', attrs: { ...BLOCK, ...attrs }, ...(text ? { content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] } : {}) });
const runs = (...parts) => parts.filter((x) => x !== '').map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x));
const it = (text) => ({ type: 'text', text, marks: [{ type: 'italic' }] });
const note = (content) => ({ type: 'footnote_ref', attrs: { content } });
const para = (content, attrs = {}) => ({ type: 'paragraph', attrs: { ...BLOCK, ...attrs }, content });
const heading = (level, text) => ({ type: 'heading', attrs: { level, ...BLOCK }, content: [{ type: 'text', text }] });
const C = { align: 'center' };
// n sentences from the bank, starting at k (wrapping).
const take = (k, n) => Array.from({ length: n }, (_, i) => SENTENCES[(k + i) % SENTENCES.length]).join(' ');
const QUOTE = 'Sethe had walked there in the dark, past the stream and the sycamores, carrying the memory of what she had done the way a river carries silt, slowly and without choosing what to keep, so that by the time she reached the clearing she could no longer tell which of the stones beneath her feet she had carried in with her and which had always been there waiting.';
const BODY = (cite) => [
  para(runs(take(0, 4), ' ', cite === 'mla' ? '(Morrison 35)' : cite === 'apa' ? '(Morrison, 1987)' : '', cite === 'chicago' ? note('Toni Morrison, <em>Beloved</em> (New York: Knopf, 1987), 35.') : '', ' ', take(4, 2))),
  p(take(6, 5)),
  p(take(11, 3)),
  ...(cite === 'apa' ? [heading(1, 'The Clearing as Ledger')] : cite === 'chicago' ? [heading(1, 'The Clearing as Ledger')] : []),
  para(runs(take(14, 4), cite === 'chicago' ? note('James Baldwin, <em>The Price of the Ticket</em> (New York: St. Martin\'s, 1985), xix.') : '', ' ', take(18, 2))),
  p(take(20, 6)),
  { type: 'blockquote', content: [p(QUOTE)] },
  para(runs(cite === 'mla' ? '(Morrison 88). ' : cite === 'apa' ? '(Morrison, 1987, p. 88). ' : '', take(4, 5), cite === 'chicago' ? note('Morrison, <em>Beloved</em>, 88.') : '')),
  ...(cite === 'apa' ? [] : [p(take(9, 7))]),
  ...(cite === 'apa' ? [heading(2, 'The River and the Return')] : []),
  p(take(16, 4)),
  para(runs(take(1, 6), cite === 'chicago' ? note('Morrison, <em>Beloved</em>, 274.') : '')),
  p(take(7, 3)),
  p(take(2, 5)),
  para(runs(take(17, 4), cite === 'chicago' ? note('Baldwin, <em>Price of the Ticket</em>, xx.') : '')),
  ...(cite === 'mla' ? [p(take(5, 6))] : []),
];
const ENTRIES = [
  para(runs('Baldwin, James. ', it('The Price of the Ticket: Collected Nonfiction, 1948–1985'), '. St. Martin\'s, 1985.')),
  para(runs('Christian, Barbara. "Beloved, She\'s Ours." ', it('Narrative'), ', vol. 5, no. 1, 1997, pp. 36–49.')),
  para(runs('Morrison, Toni. ', it('Beloved'), '. Knopf, 1987.')),
  para(runs('Rushdy, Ashraf H. A. "Daughters Signifyin(g) History: The Example of Toni Morrison\'s ', it('Beloved'), '." ', it('American Literature'), ', vol. 64, no. 3, 1992, pp. 567–97.')),
];
const NAME = 'Alex Rivera', INSTRUCTOR = 'Professor Okafor', COURSE = 'ENGL 2110: American Literature II', TITLE = 'What the River Keeps: Memory as Inheritance in Beloved';
const papers = {
  mla9: () => ({ type: 'doc', content: [p(NAME, { first: 0 }), p(INSTRUCTOR, { first: 0 }), p(COURSE, { first: 0 }), p('26 October 2026', { first: 0 }), p(TITLE, C), ...BODY('mla'), { type: 'page_break' }, p('Works Cited', C), ...ENTRIES] }),
  apa7: () => ({ type: 'doc', content: [p('', C), p('', C), p('', C), p(TITLE, C, [{ type: 'bold' }]), p('', C), p(NAME, C), p(COURSE, C), p(INSTRUCTOR, C), p('October 26, 2026', C), { type: 'page_break' }, p(TITLE, C, [{ type: 'bold' }]), ...BODY('apa'), { type: 'page_break' }, p('References', C, [{ type: 'bold' }]), ...ENTRIES] }),
  chicago17: () => ({ type: 'doc', content: [...Array.from({ length: 6 }, () => p('', C)), p(TITLE, C), ...Array.from({ length: 7 }, () => p('', C)), p(NAME, C), p(COURSE, C), p(INSTRUCTOR, C), p('October 26, 2026', C), { type: 'page_break' }, ...BODY('chicago'), { type: 'page_break' }, p('Bibliography', C), ...ENTRIES] }),
};

// One seeded error per check. Each entry: [rule the check reports, the paper with that error].
const clone = (x) => JSON.parse(JSON.stringify(x));
const seeded = {
  mla9: () => {
    const base = papers.mla9(), list = base.content.findIndex((n) => n.content?.[0]?.text === 'Works Cited');
    const out = [];
    const edit = (rule, fn) => { const d = clone(base); fn(d.content); out.push([rule, d]); };
    edit('heading-order', (c) => { [c[0], c[3]] = [c[3], c[0]]; });
    edit('heading-instructor', (c) => { c[1] = p('', { first: 0 }); });
    edit('heading-date', (c) => { c[3] = p('October 26, 2026', { first: 0 }); });
    edit('title-bold', (c) => { c[4].content[0].marks = [{ type: 'bold' }]; });
    edit('title-underline', (c) => { c[4].content[0].marks = [{ type: 'underline' }]; });
    edit('title-quoted', (c) => { c[4].content[0].text = `"${TITLE}"`; });
    edit('block-quote', (c) => { c[6] = p(`Morrison writes that "${QUOTE} ${QUOTE}" and the passage does not let go.`); });
    edit('cite-shape', (c) => { c[5].content[0].text += ' (Morrison, 42).'; });
    edit('font', (c) => { c[7].content[0].marks = [{ type: 'text_style', attrs: { font: 'Arial', size: 14 } }]; });
    edit('spacing', (c) => { c[8].attrs.line = 1; });
    edit('list-page', (c) => { c.splice(list - 1, 1); });
    edit('list-hanging', (c) => { c[list + 1].attrs.first = 0.5; });
    edit('list-order', (c) => { [c[list + 1], c[list + 3]] = [c[list + 3], c[list + 1]]; });
    edit('list-missing', (c) => { c.splice(list - 1); });
    edit('header-name', (c) => { c[0] = p('', { first: 0 }); });
    return out;
  },
  apa7: () => {
    const base = papers.apa7(), list = base.content.findIndex((n) => n.content?.[0]?.text === 'References');
    const out = [];
    const edit = (rule, fn) => { const d = clone(base); fn(d.content); out.push([rule, d]); };
    edit('title-plain', (c) => { delete c[3].content[0].marks; });
    edit('title-repeat', (c) => { c.splice(10, 1); });
    edit('heading-align', (c) => { const i = c.findIndex((n) => n.type === 'heading' && n.attrs.level === 1); c[i].attrs.align = 'right'; });
    edit('cite-shape', (c) => { c[12].content[0].text += ' (Morrison 1987).'; });
    edit('block-quote', (c) => { c[13] = p(`As Morrison writes, "${QUOTE}" and the passage does not let go.`); });
    edit('list-bold', (c) => { delete c[list].content[0].marks; });
    edit('list-hanging', (c) => { c[list + 2].attrs.first = 0; });
    return out;
  },
  chicago17: () => {
    const base = papers.chicago17(), list = base.content.findIndex((n) => n.content?.[0]?.text === 'Bibliography');
    const out = [];
    const edit = (rule, fn) => { const d = clone(base); fn(d.content); out.push([rule, d]); };
    edit('cite-note', (c) => { c[19].content[0].text += ' (Morrison 42).'; });
    edit('list-page', (c) => { c.splice(list - 1, 1); });
    edit('list-plain', (c) => { c[list].content[0].marks = [{ type: 'bold' }]; });
    edit('opening', (c) => { c.splice(0, c.findIndex((n) => n.type === 'page_break') + 1); });
    return out;
  },
};
const context = { name: NAME, instructor: INSTRUCTOR, course: COURSE, title: TITLE };
module.exports = { papers, seeded, context, SENTENCES };
