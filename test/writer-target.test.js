// Glaze Writer's targets (lib/writer-target.js): the words, sources and replies a discussion prompt asks for, read from the
// ways prompts really say them, and nothing read where a prompt doesn't say it plainly.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/writer-target.js');

const NONE = { minWords: null, maxWords: null, sources: null, replies: null, reply: { minWords: null, maxWords: null, sources: null } };
// The fields a case names, the rest null.
const want = (o) => ({ ...NONE, ...o, reply: { ...NONE.reply, ...o.reply } });
const cases = (list) => {
  const wrong = list.filter(([text, o]) => JSON.stringify(T.parse(text)) !== JSON.stringify(want(o))).map(([text, o]) => `${text}\n    got  ${JSON.stringify(T.parse(text))}\n    want ${JSON.stringify(want(o))}`);
  assert.deepEqual(wrong, []);
};

test('the mockup\'s prompt: at least 250 words, two sources, two classmates', () => {
  cases([['How does Morrison use the river and the clearing as places of memory? Respond in at least 250 words, cite two sources, and reply to two classmates.', { minWords: 250, sources: 2, replies: 2 }]]);
});

test('a minimum, said every way prompts say it', () => {
  cases([
    ['Your initial post should be at least 250 words.', { minWords: 250 }],
    ['Posts must be a minimum of 300 words.', { minWords: 300 }],
    ['Minimum 200 words.', { minWords: 200 }],
    ['Minimum of 150 words', { minWords: 150 }],
    ['250 word minimum', { minWords: 250 }],
    ['250-word minimum.', { minWords: 250 }],
    ['Write 300 words minimum.', { minWords: 300 }],
    ['300+ words', { minWords: 300 }],
    ['Your answer should contain 400 words or more.', { minWords: 400 }],
    ['In 250 words or more, explain the author\'s argument.', { minWords: 250 }],
    ['Your response must be no fewer than 175 words.', { minWords: 175 }],
    ['No less than 200 words, please.', { minWords: 200 }],
    ['Your post should be more than 150 words.', { minWords: 150 }],
    ['Write at least two hundred fifty words.', { minWords: 250 }],
    ['Write at least two hundred and fifty words.', { minWords: 250 }],
    ['at least one thousand words', { minWords: 1000 }],
    ['At least 1,200 words.', { minWords: 1200 }],
    ['AT LEAST 250 WORDS', { minWords: 250 }],
    ['Minimum word count: 300', { minWords: 300 }],
    ['Word count: at least 350', { minWords: 350 }],
  ]);
});

test('a maximum', () => {
  cases([
    ['No more than 500 words.', { maxWords: 500 }],
    ['Keep your post under 400 words.', { maxWords: 400 }],
    ['Do not exceed 750 words.', { maxWords: 750 }],
    ['Your reflection should not exceed 600 words.', { maxWords: 600 }],
    ['Posts that exceed 500 words will be penalized.', { maxWords: 500 }],
    ['Limit your response to 300 words or less.', { maxWords: 300 }],
    ['Up to 200 words.', { maxWords: 200 }],
    ['Maximum 250 words.', { maxWords: 250 }],
    ['A maximum of 1,000 words.', { maxWords: 1000 }],
    ['Word limit: 1,000', { maxWords: 1000 }],
    ['There is a 500-word limit.', { maxWords: 500 }],
    ['Answer in fewer than 100 words.', { maxWords: 100 }],
    ['Your summary should be at most 150 words.', { maxWords: 150 }],
  ]);
});

test('a range', () => {
  cases([
    ['Write 250-300 words.', { minWords: 250, maxWords: 300 }],
    ['Write 250–300 words.', { minWords: 250, maxWords: 300 }],
    ['Your response should be 150 to 200 words in length.', { minWords: 150, maxWords: 200 }],
    ['Posts should be between 400 and 600 words.', { minWords: 400, maxWords: 600 }],
    ['Your post must be between two hundred and fifty and three hundred words.', { minWords: 250, maxWords: 300 }],
    ['Aim for 1000-1200 words.', { minWords: 1000, maxWords: 1200 }],
    ['Word count: 250-350', { minWords: 250, maxWords: 350 }],
    ['Write a minimum of 250 words and a maximum of 400 words.', { minWords: 250, maxWords: 400 }],
    ['Write at least 250 words but no more than 400 words.', { minWords: 250, maxWords: 400 }],
    ['250 words minimum, 400 maximum.', { minWords: 250, maxWords: 400 }],
    ['From 300 to 500 words.', { minWords: 300, maxWords: 500 }],
    ['Your essay should be 500 words to 700 words.', { minWords: 500, maxWords: 700 }],
  ]);
});

test('a size with no direction is a target', () => {
  cases([
    ['Write a 300-word post.', { minWords: 300 }],
    ['Post a 300 word reflection on the reading.', { minWords: 300 }],
    ['Write approximately 500 words.', { minWords: 500 }],
    ['Your response should be about 250 words.', { minWords: 250 }],
    ['Respond in around 300 words.', { minWords: 300 }],
    ['Respond in 250 words.', { minWords: 250 }],
    ['Length: 500 words', { minWords: 500 }],
    ['Compose an 800-word essay.', { minWords: 800 }],
    ['Write roughly 2 hundred words.', {}],
  ]);
});

test('a penalty turns a comparative around', () => {
  cases([
    ['Posts under 250 words will lose points.', { minWords: 250 }],
    ['Posts with fewer than 200 words will not receive credit.', { minWords: 200 }],
    ['Anything less than 150 words receives a deduction.', { minWords: 150 }],
    ['Posts over 500 words will be penalized.', { maxWords: 500 }],
  ]);
});

test('word counts said of replies stay apart from the post\'s', () => {
  cases([
    ['Your initial post should be 250-300 words. Reply to at least two peers with responses of at least 100 words each.', { minWords: 250, maxWords: 300, replies: 2, reply: { minWords: 100 } }],
    ['Post at least 250 words and reply to two classmates.', { minWords: 250, replies: 2 }],
    ['Your initial post must be at least 300 words and your replies at least 150 words.', { minWords: 300, reply: { minWords: 150 } }],
    ['Each reply should be at least 75 words.', { reply: { minWords: 75 } }],
    ['Reply to two classmates. Responses should be at least 100 words.', { replies: 2, reply: { minWords: 100 } }],
    ['When replying to classmates, write at least 100 words.', { reply: { minWords: 100 } }],
    ['Initial post: minimum 200 words; replies: minimum 75 words.', { minWords: 200, reply: { minWords: 75 } }],
    ['Initial posts: 200-250 words. Replies: 100 words minimum.', { minWords: 200, maxWords: 250, reply: { minWords: 100 } }],
    ['Respond to two classmates, each in 100 words or more.', { replies: 2, reply: { minWords: 100 } }],
    ['Respond to two classmates with at least 100 words each.', { replies: 2, reply: { minWords: 100 } }],
    ['Respond to the prompt in at least 250 words.', { minWords: 250 }],
    ['Your original post (300 words minimum) is due Thursday; respond to two peers by Sunday.', { minWords: 300, replies: 2 }],
  ]);
});

test('sources and citations', () => {
  cases([
    ['Cite at least two scholarly sources.', { sources: 2 }],
    ['Cite at least 2 scholarly references.', { sources: 2 }],
    ['Use two outside sources.', { sources: 2 }],
    ['Include at least 2 peer-reviewed references.', { sources: 2 }],
    ['Support your argument with three credible sources.', { sources: 3 }],
    ['Support your claims with at least two scholarly, peer-reviewed articles.', { sources: 2 }],
    ['Reference at least one of the assigned readings.', { sources: 1 }],
    ['Cite a source for every claim.', { sources: 1 }],
    ['Cite one source from the library database.', { sources: 1 }],
    ['Two scholarly sources are required.', { sources: 2 }],
    ['You must use 2-3 sources.', { sources: 2 }],
    ['Use one or two outside sources.', { sources: 1 }],
    ['Include a minimum of three references in APA format.', { sources: 3 }],
    ['At least 3 references.', { sources: 3 }],
    ['Use at least two in-text citations.', { sources: 2 }],
    ['Draw on at least two of this week\'s readings.', { sources: 2 }],
    ['Integrate two or more scholarly sources.', { sources: 2 }],
    ['Cite two sources in your post and one source in each reply.', { sources: 2, reply: { sources: 1 } }],
  ]);
});

test('replies', () => {
  cases([
    ['Reply to two classmates.', { replies: 2 }],
    ['Respond to at least 2 peers.', { replies: 2 }],
    ['Respond to at least two of your classmates\' posts.', { replies: 2 }],
    ['Reply to a minimum of three peers.', { replies: 3 }],
    ['Comment on two other students\' posts.', { replies: 2 }],
    ['Post two substantive replies.', { replies: 2 }],
    ['Respond to one classmate.', { replies: 1 }],
    ['Reply to a classmate.', { replies: 1 }],
    ['Reply to two or more classmates.', { replies: 2 }],
    ['Engage with at least two classmates.', { replies: 2 }],
    ['Replies: respond to 2-3 peers.', { replies: 2 }],
    ['Complete two peer responses.', { replies: 2 }],
    ['Then respond to the posts of two classmates.', { replies: 2 }],
    ['Reply to at least two different classmates by Sunday at 11:59 PM.', { replies: 2 }],
    ['Respond to three of your peers.', { replies: 3 }],
  ]);
});

test('long real prompts, everything at once', () => {
  cases([
    ['Initial Post: Answer the following questions in a post of at least 300 words. Use at least two scholarly sources and cite them in APA format.\nReplies: Respond to at least two classmates. Each response should be at least 150 words.', { minWords: 300, sources: 2, replies: 2, reply: { minWords: 150 } }],
    ['Discussion 4. Read Chapter 7. In a 250-300 word post, explain the difference between the two theories. Then reply to at least 2 of your classmates.', { minWords: 250, maxWords: 300, replies: 2 }],
    ['Requirements:\n- Minimum 200 words\n- Cite 1 source\n- Respond to 2 peers', { minWords: 200, sources: 1, replies: 2 }],
    ['Week 3 Discussion\n\nPlease write a post of approximately 400 words. Be sure to cite at least one outside source. You will also need to reply to two of your peers by Sunday.', { minWords: 400, sources: 1, replies: 2 }],
  ]);
});

test('nothing is read where a prompt doesn\'t say it plainly', () => {
  cases([
    ['', {}],
    ['Share your thoughts on the reading.', {}],
    ['The article is 3000 words long. Summarize it.', {}],
    ['Chapter 4 discusses the two theories.', {}],
    ['Read the two articles and respond.', {}],
    ['Read the two sources below and discuss.', {}],
    ['Cite your sources in APA format.', {}],
    ['Reply to your classmates.', {}],
    ['Reply to each other\'s posts.', {}],
    ['Use several sources.', {}],
    ['Reply to a few classmates.', {}],
    ['Due on 10/27 at 11:59 PM; worth 20 points.', {}],
    ['Watch the 2 videos (12 minutes total).', {}],
    ['Write between 2 and 300 words.', {}],
  ]);
  for (const v of [null, undefined, 42, {}, ['at least 250 words']]) assert.deepEqual(T.parse(v), NONE);
});

test('two different counts of the same thing leave it unknown', () => {
  cases([
    ['Write at least 250 words. Your post must be at least 300 words.', {}],
    ['Write at least 250 words. Minimum 250 words.', { minWords: 250 }],
    ['Cite two sources. Cite three sources.', {}],
    ['Write at least 500 words but no more than 300 words.', {}],
    ['Write at least 250 words, around 300 words.', { minWords: 250 }],
  ]);
});

test('a box takes what its kind answers to: a reply its replies\' counts, else the post\'s', () => {
  const req = T.parse('Your initial post should be 250-300 words and cite two sources. Reply to two classmates with at least 100 words each.');
  assert.deepEqual(T.forKind(req, 'post'), { minWords: 250, maxWords: 300, sources: 2, replies: 2 });
  assert.deepEqual(T.forKind(req, 'reply'), { minWords: 100, maxWords: null, sources: 2, replies: 2 });
  const mock = T.parse('Respond in at least 250 words, cite two sources, and reply to two classmates.');
  assert.deepEqual(T.forKind(mock, 'reply'), { minWords: 250, maxWords: null, sources: 2, replies: 2 }, 'with none of their own, a reply takes the post\'s');
  assert.deepEqual(T.forKind(null, 'reply'), { minWords: null, maxWords: null, sources: null, replies: null });
});

test('another language is a RULES entry, read by the same matcher', () => {
  const FR = { ...T.RULES.en, units: { un: 1, une: 1, deux: 2, trois: 3 }, tens: { vingt: 20, cinquante: 50 }, hundred: 'cent', thousand: 'mille', and: 'et', one: 'un|une', word: 'mots?', min: 'au moins|minimum', max: 'au plus|maximum', sourceVerb: 'citez|citer', sourceNoun: 'sources?', sourceAdj: 'scientifiques?', sourceOf: '(?:des )', replyVerb: 'répondez|répondre', replyTo: 'à', replyWho: 'camarades?|pairs?', replyWhoAdj: 'autres?' };
  T.RULES.fr = FR;
  try {
    assert.deepEqual(T.parse('Rédigez au moins deux cent cinquante mots, citez deux sources et répondez à deux camarades.', { lang: 'fr-CA' }), want({ minWords: 250, sources: 2, replies: 2 }));
    assert.deepEqual(T.parse('at least 250 words', { lang: 'xx' }), want({ minWords: 250 }), 'a language without rules reads as English');
  } finally { delete T.RULES.fr; }
});
