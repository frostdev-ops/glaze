// writer/writer-schema.js's Canvas dialect and plain mode: the canvas schema writes HTML Canvas's Rich Content Editor
// (TinyMCE 5) keeps as it is (no Quill classes: alignment and indent as styles, nested lists, a real <blockquote>, <pre>),
// reads what TinyMCE's frame body holds (its styled spans, padding indents, data-mce-* bookkeeping), and says what a box
// holds that Writer can't keep (loses). plain is the Inbox's: paragraphs of text only.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');

const K = S.canvas, PL = S.plain;
const out = (html, schema = K) => S.serialize(schema, S.parse(schema, html));
const json = (html, schema = K) => JSON.stringify(S.parse(schema, html).toJSON());

test('the canvas schema holds compose\'s blocks and marks, and a blockquote', () => {
  assert.deepEqual(Object.keys(K.nodes).sort(), ['blockquote', 'bullet_list', 'code_block', 'doc', 'heading', 'list_item', 'ordered_list', 'paragraph', 'text']);
  assert.deepEqual(Object.keys(K.marks).sort(), Object.keys(S.compose.marks).sort());
  assert.deepEqual(K.nodes.heading.spec.levels, [3, 4]);
  assert.ok(!S.compose.nodes.blockquote, 'Ultra\'s compose is unchanged: no blockquote');
});

test('Canvas\'s dialect out: styles for alignment and 40px indents, no ql- classes, plain links', () => {
  const cases = [
    ['<p>plain</p>', '<p>plain</p>'],
    ['<p class="ql-align-center ql-indent-2">x</p>', '<p style="text-align: center; padding-left: 80px;">x</p>'],
    ['<p style="text-align: right;">r</p>', '<p style="text-align: right;">r</p>'],
    ['<p style="text-align: left;">l</p>', '<p>l</p>'],
    ['<h3 style="padding-left: 40px;">H</h3><h4 style="text-align: justify;">h</h4>', '<h3 style="padding-left: 40px;">H</h3><h4 style="text-align: justify;">h</h4>'],
    ['<p><strong>b</strong><em>i</em><u>u</u><s>s</s><sup>x</sup><sub>y</sub></p>', '<p><strong>b</strong><em>i</em><u>u</u><s>s</s><sup>x</sup><sub>y</sub></p>'],
    ['<p><a href="https://a.com/x?y=1&amp;z=2" target="_blank" rel="noopener">l</a></p>', '<p><a href="https://a.com/x?y=1&amp;z=2">l</a></p>'],
    ['<p></p>', '<p><br></p>'],
    ['', '<p><br></p>'],
  ];
  for (const [i, o] of cases) {
    assert.equal(out(i), o, i);
    assert.doesNotMatch(out(i), /ql-|class=/, i);
  }
});

test('lists out nested, as TinyMCE nests them: a deeper item inside the item before it, a skipped level in an unmarked item', () => {
  const flat = '<ul><li>a</li><li class="ql-indent-1">b</li><li class="ql-indent-1">c</li><li>d</li></ul>';
  assert.equal(out(flat), '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>');
  assert.equal(out('<ol><li>one</li></ol><ul><li class="ql-indent-1">sub</li></ul><ol><li>two</li></ol>'), '<ol><li>one<ul><li>sub</li></ul></li><li>two</li></ol>');
  assert.equal(out('<ul><li class="ql-indent-2">deep</li></ul>'), '<ul><li style="list-style-type: none;"><ul><li style="list-style-type: none;"><ul><li>deep</li></ul></li></ul></li></ul>');
  assert.equal(out('<ul><li>a</li></ul><ol><li>b</li></ol>'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  assert.equal(out('<ol><li style="text-align: center;">c</li></ol>'), '<ol><li style="text-align: center;">c</li></ol>');
});

test('pre keeps its lines, and a quote is a real blockquote around its blocks', () => {
  assert.equal(out('<pre>a\n  b</pre>'), '<pre>a\n  b</pre>');
  assert.equal(out('<pre>a</pre><pre>b</pre>'), '<pre>a\nb</pre>', 'adjacent code lines are one block, as TinyMCE shows them');
  assert.equal(out('<blockquote><p>q</p><ul><li>i</li></ul></blockquote><p>after</p>'), '<blockquote><p>q</p><ul><li>i</li></ul></blockquote><p>after</p>');
  const doc = S.parse(K, '<blockquote><p>q</p></blockquote>');
  assert.equal(doc.firstChild.type.name, 'blockquote');
  assert.equal(doc.firstChild.firstChild.attrs.indent, 0, 'not Ultra\'s indented stand-in');
});

test('Canvas code blocks keep their trailing and empty lines across repeated saves', () => {
  for (const value of ['', '\n', 'a\n', 'a\n\n', 'a\n  b\n']) {
    const html = `<pre>${value}</pre>`;
    const doc = S.parse(K, html);
    assert.equal(doc.firstChild.type.name, 'code_block');
    assert.equal(doc.firstChild.textContent, value, JSON.stringify(value));
    assert.equal(S.serialize(K, doc), html);
    assert.equal(out(out(html)), html);
  }
});

test('TinyMCE\'s frame body in: styled spans, padding indents, nested lists, its bogus nodes and caret marks', () => {
  const body = '<p style="padding-left: 80px; text-align: center;" data-mce-style="padding-left: 80px; text-align: center;">a <span style="text-decoration: underline;" data-mce-style="text-decoration: underline;">u</span> '
    + '<span style="text-decoration: line-through;">s</span><span id="_mce_caret" data-mce-bogus="1" data-mce-type="format-caret">﻿</span></p>'
    + '<p><br data-mce-bogus="1"></p><ul><li>x<ul><li>y</li></ul></li></ul><div data-mce-bogus="all" class="mce-resizehandle">gone</div>';
  assert.equal(out(body), '<p style="text-align: center; padding-left: 80px;">a <u>u</u> <s>s</s></p><p><br></p><ul><li>x<ul><li>y</li></ul></li></ul>');
  const doc = S.parse(K, body);
  assert.deepEqual([doc.child(0).attrs.indent, doc.child(0).attrs.align], [2, 'center']);
  assert.equal(doc.child(2).child(1).attrs.indent, 1);
  assert.equal(S.text(doc).text, 'a u s\n\nx\ny');
  assert.equal(S.parse(K, '<p style="padding-left: 400px;">far</p>').firstChild.attrs.indent, 8, 'clamped');
  // TinyMCE's getContent() writes an empty block as one no-break space: that is Canvas's empty paragraph, not a space.
  assert.equal(out('<p>a</p>\n<p>&nbsp;</p>\n<h3>&nbsp;</h3>\n<ul><li>&nbsp;</li></ul>'), '<p>a</p><p><br></p><h3><br></h3><ul><li><br></li></ul>');
  assert.equal(out('<p>&nbsp;x</p><p>&nbsp;&nbsp;</p>'), '<p>&nbsp;x</p><p>&nbsp;&nbsp;</p>', 'more than that is text');
});

test('Canvas\'s dialect round trips: what it writes reads back the same, and writes the same again', () => {
  const docs = [
    '<p>one</p><p style="text-align: center;">two</p>', '<h3>T</h3><p style="padding-left: 120px;">deep</p>',
    '<ul><li>a<ol><li>b<ul><li>c</li></ul></li></ol></li><li>d</li></ul>', '<blockquote><p>q <strong>b</strong></p><blockquote><p>inner</p></blockquote></blockquote>',
    '<pre>x\n\ny</pre><p><a href="mailto:a@b.co">m</a> <sup>2</sup></p>', '<p>a&nbsp; b&nbsp;&nbsp;&nbsp;c</p>',
  ];
  for (const d of docs) {
    const once = out(d), twice = out(once);
    assert.equal(twice, once, d);
    assert.equal(json(once), json(d), d);
  }
});

test('Canvas list items refuse unsupported block content without dropping its text on paste', () => {
  const quote = '<ul><li>before<blockquote><p>quoted</p><blockquote><p>inner</p></blockquote></blockquote>after</li></ul>';
  assert.equal(S.text(S.parse(K, quote)).text, 'before\nquoted\ninner\nafter');
  assert.deepEqual(S.loses(K, quote), ['format']);
  assert.deepEqual(S.loses(K, '<ul><li><pre>code</pre></li></ul>'), ['format']);
  assert.deepEqual(S.loses(K, '<blockquote><p>q</p><ul><li>item</li></ul></blockquote>'), []);
});

test('Canvas refuses list nesting beyond the indent level it can preserve', () => {
  const nested = (level) => '<ul><li>'.repeat(level) + 'deep' + '</li></ul>'.repeat(level);
  const supported = nested(S.MAX_INDENT + 1), excessive = nested(S.MAX_INDENT + 2);
  assert.deepEqual(S.loses(K, supported), []);
  assert.equal(out(out(supported)), out(supported));
  assert.deepEqual(S.loses(K, excessive), ['format']);
});

test('Canvas unmarked list items are supported only as containers for skipped nesting levels', () => {
  for (const item of ['text', '<br>', '<strong>text</strong><ul><li>child</li></ul>']) {
    const html = `<ul><li style="list-style-type: none;">${item}</li></ul>`;
    assert.deepEqual(S.loses(K, html), ['format'], html);
  }
  const scaffold = '<ul><li style="list-style-type: none;"><ul><li>child</li></ul></li></ul>';
  assert.deepEqual(S.loses(K, scaffold), []);
  assert.equal(out(scaffold), scaffold);
});

test('loses: what keeps a box Canvas\'s (h2, colours, sizes, tables, pictures, embeds, maths, mentions, file links, rules)', () => {
  const cases = [
    ['<h2>Big</h2>', ['format']], ['<h1>x</h1>', ['format']], ['<h5>x</h5>', ['format']],
    ['<p><span style="color: #e03e2d;">r</span></p>', ['format']], ['<p><span style="font-size: 18pt;">b</span></p>', ['format']],
    ['<p><span style="background-color: yellow;">h</span></p>', ['format']], ['<p style="padding-left: 30px;">o</p>', ['format']],
    ['<p style="padding-left: 360px;">o</p>', ['format']], ['<p class="MsoNormal">w</p>', ['format']], ['<hr>', ['format']],
    ['<table><tbody><tr><td>x</td></tr></tbody></table>', ['table']], ['<p><img src="/x.png" alt="x"></p>', ['media']],
    ['<p><iframe src="https://e.com"></iframe></p>', ['media']], ['<p><img class="equation_image" src="/equation_images/x" alt="x"></p>', ['math', 'media']],
    ['<p><span class="mceNonEditable mention" data-mention="4">@J</span></p>', ['mention']],
    ['<p><a class="instructure_file_link" href="https://e.com/courses/1/files/2">f</a></p>', ['attachment']],
    ['<p dir="rtl">r</p>', ['format']],
  ];
  for (const [h, lost] of cases) assert.deepEqual(S.loses(K, h), lost, h);
  const clean = ['<p><br data-mce-bogus="1"></p>', '<p style="text-align: center; padding-left: 40px;" data-mce-style="x">a <span style="text-decoration: underline;">u</span></p>',
    '<ul><li style="list-style-type: none;"><ol><li style="text-align: right;">x</li></ol></li></ul>', '<blockquote><p>q</p></blockquote><pre>c</pre><h3>h</h3><h4>h</h4>',
    '<p><a href="https://e.com" target="_blank" rel="noopener" data-mce-href="https://e.com">l</a></p>', '<p>a<br>b</p>'];
  for (const h of clean) assert.deepEqual(S.loses(K, h), [], h);
  assert.deepEqual(S.loses(S.compose, '<p style="padding-left: 40px;">x</p>'), ['format'], 'Ultra\'s compose still refuses Canvas\'s indent');
  assert.deepEqual(S.loses(S.compose, '<blockquote><p>q</p></blockquote>'), [], 'and still takes a quote as an indent');
});

test('plain mode: paragraphs of text only, written as the Canvas adapter reads the Inbox', () => {
  assert.deepEqual(Object.keys(PL.nodes).sort(), ['doc', 'paragraph', 'text']);
  assert.deepEqual(Object.keys(PL.marks), []);
  assert.equal(out('<p>Hi &lt;you&gt;</p><p><br></p><p>Second &amp; last</p>', PL), '<p>Hi &lt;you&gt;</p><p><br></p><p>Second &amp; last</p>');
  assert.equal(out('<p><strong>b</strong> and <a href="https://e.com">l</a></p><ul><li>one</li><li>two</li></ul><h3>h</h3>', PL), '<p>b and l</p><p>one</p><p>two</p><p>h</p>');
  assert.equal(out('<p>a  b\tc </p>', PL), '<p>a  b\tc </p>', 'a textarea\'s spaces and tabs as typed');
  assert.equal(out('<p>a&nbsp; b</p>', PL), '<p>a  b</p>');
  assert.equal(S.text(S.parse(PL, '<p>one</p><p></p><p>three</p>')).text, 'one\n\nthree');
  assert.deepEqual(S.loses(PL, '<p><span style="color: red;">x</span></p><table><tr><td>t</td></tr></table>'), []);
});

test('plain mode refuses takeover when its input cannot be parsed within the schema limits', () => {
  for (const html of ['x'.repeat(S.MAX_INPUT + 1), '<p></p>'.repeat(S.MAX_TOKENS),
    '<blockquote>'.repeat(S.MAX_DEPTH + 1) + 'x' + '</blockquote>'.repeat(S.MAX_DEPTH + 1)]) {
    assert.throws(() => S.parse(PL, html), { code: 'WRITER_INPUT_LIMIT' });
    assert.deepEqual(S.loses(PL, html), ['limit']);
  }
});
