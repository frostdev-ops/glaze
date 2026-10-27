// lib/writer-schema.js: compose serializes to the HTML Ultra's Quill keeps, Quill-shaped and pasted HTML parse into the
// schemas (and nothing outside the allowlist survives), paper holds a whole paper, and text() maps UTF-16 offsets to
// document positions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../lib/writer-schema.js');

const root = path.join(__dirname, '..');
const C = S.compose, P = S.paper;
const out = (html, schema = C) => S.serialize(schema, S.parse(schema, html));
const sorted = (h) => h.replace(/class="([^"]*)"/g, (_, c) => `class="${c.split(' ').sort().join(' ')}"`);

// _note (2026-10-27): each input, then what real quill@1.3.7 (npm, sha512-hG/DVzh/TiknWtE6QmWAF/pxoZKYxfe3J/d/+ShUWkDvvkZQVTPeVmUJVu1uE6DDooC4fWTiCLh84ul89oNz5g==)
// rendered in headless Chromium from setContents(delta(parse(input))): byte for byte serialize(parse(input)). The same
// Quill's setContents(clipboard.convert(that HTML)) gave it back too, up to the order of a block's two classes (Quill
// itself flips ql-indent/ql-align order on every pass), with the clipboard's block margins at 0. With a browser's
// default margins, Quill 1.3.7's matchSpacing adds an empty line before a list or pre that follows a paragraph (3 of
// these), so delta() is the exact way in. Inputs are Quill's own output, pastes, and markup Quill or Ultra drop.
const QUILL = [
  ["<p>plain</p>", "<p>plain</p>"],
  ["<p><strong>b</strong><em>i</em><u>u</u><s>s</s><sup>x</sup><sub>y</sub></p>", "<p><strong>b</strong><em>i</em><u>u</u><s>s</s><sup>x</sup><sub>y</sub></p>"],
  ["<p><a href=\"https://a.com/x?y=1&amp;z=2\"><strong><em>bi</em></strong></a></p>", "<p><a href=\"https://a.com/x?y=1&amp;z=2\" rel=\"noopener noreferrer\" target=\"_blank\"><strong><em>bi</em></strong></a></p>"],
  ["<p><em><strong>x</strong></em></p>", "<p><strong><em>x</em></strong></p>"],
  ["<p><u><s><em><strong>x</strong></em></s></u></p>", "<p><strong><em><s><u>x</u></s></em></strong></p>"],
  ["<p><strong><sup>x</sup></strong><sup><em>y</em></sup></p>", "<p><sup><strong>x</strong><em>y</em></sup></p>"],
  ["<p><a href=\"https://a.com\">a<strong>b</strong></a></p>", "<p><a href=\"https://a.com\" rel=\"noopener noreferrer\" target=\"_blank\">a<strong>b</strong></a></p>"],
  ["<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5>", "<h3>H1</h3><h3>H2</h3><h3>H3</h3><h4>H4</h4><h4>H5</h4>"],
  ["<ol><li>a</li><li class=\"ql-indent-1\">b</li></ol><ul><li>c</li></ul>", "<ol><li>a</li><li class=\"ql-indent-1\">b</li></ol><ul><li>c</li></ul>"],
  ["<ol><li>a</li></ol><ol><li>b</li></ol>", "<ol><li>a</li><li>b</li></ol>"],
  ["<ol><li>a</li></ol><ul><li class=\"ql-indent-1\">b</li></ul><ol><li>c</li></ol>", "<ol><li>a</li></ol><ul><li class=\"ql-indent-1\">b</li></ul><ol><li>c</li></ol>"],
  ["<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>", "<ul><li>a</li><li class=\"ql-indent-1\">b</li></ul><ol><li class=\"ql-indent-2\">c</li></ol><ul><li>d</li></ul>"],
  ["<p class=\"ql-align-center ql-indent-2\">x</p><p class=\"ql-indent-1 ql-align-right\">y</p><p class=\"ql-align-justify\">z</p>", "<p class=\"ql-indent-2 ql-align-center\">x</p><p class=\"ql-indent-1 ql-align-right\">y</p><p class=\"ql-align-justify\">z</p>"],
  ["<ol><li class=\"ql-align-center ql-indent-1\">x</li></ol><h3 class=\"ql-align-right\">h</h3>", "<ol><li class=\"ql-indent-1 ql-align-center\">x</li></ol><h3 class=\"ql-align-right\">h</h3>"],
  ["<pre class=\"ql-syntax\" spellcheck=\"false\">a &lt; b\n  c\n</pre>", "<pre class=\"ql-syntax\" spellcheck=\"false\">a &lt; b\n  c\n</pre>"],
  ["<pre>x\ny</pre><p>after</p>", "<pre class=\"ql-syntax\" spellcheck=\"false\">x\ny\n</pre><p>after</p>"],
  ["<p><br></p>", "<p><br></p>"],
  ["", "<p><br></p>"],
  ["<p>a<br>b</p><p>c<br></p><p>d<br><br>e</p>", "<p>a</p><p>b</p><p>c</p><p>d</p><p><br></p><p>e</p>"],
  ["<p>&lt;a&gt; &amp; \"q\" 'x' &nbsp;y</p>", "<p>&lt;a&gt; &amp; \"q\" 'x' y</p>"],
  ["<p>a  b   c</p><p> lead</p><p>trail </p><p>a&nbsp;&nbsp;b</p>", "<p>a b c</p><p>lead</p><p>trail</p><p>a&nbsp;&nbsp;b</p>"],
  ["<p>a \u00a0b</p>", "<p>a b</p>"],
  ["<p><a href=\"javascript:alert(1)\">js</a> <a href=\"/rel\">rel</a> <a href=\"mailto:a@b.c\">m</a></p>", "<p>js rel <a href=\"mailto:a@b.c\" rel=\"noopener noreferrer\" target=\"_blank\">m</a></p>"],
  ["<p><strong>a</strong><strong>b</strong></p>", "<p><strong>ab</strong></p>"],
  ["<p>emoji 😀 👩\u200d👩\u200d👧 ok</p>", "<p>emoji 😀 👩\u200d👩\u200d👧 ok</p>"],
  ["<blockquote>q</blockquote>", "<p class=\"ql-indent-1\">q</p>"],
  ["<p><span style=\"font-weight:bold\">sb</span> <span style=\"font-style:italic\">si</span> <b>b</b> <i>i</i> <strike>st</strike> <del>d</del></p>", "<p><strong>sb</strong> <em>si</em> <strong>b</strong> <em>i</em> <s>st</s> <s>d</s></p>"],
  ["<div>div</div><p>p</p>", "<p>div</p><p>p</p>"],
  ["text only", "<p>text only</p>"],
  ["<p><a href=\"https://a.com\"><sup>1</sup></a></p>", "<p><a href=\"https://a.com\" rel=\"noopener noreferrer\" target=\"_blank\"><sup>1</sup></a></p>"],
  ["<p><em>quote</em></p>", "<p><em>quote</em></p>"],
  ["<ul><li><br></li></ul>", "<ul><li><br></li></ul>"],
  ["<p>a</p>\n<p>b</p>", "<p>a</p><p>b</p>"],
  ["<pre>x\ny</pre><p>after</p>", "<pre class=\"ql-syntax\" spellcheck=\"false\">x\ny\n</pre><p>after</p>"],
  ["<p><br></p>", "<p><br></p>"],
  ["<pre class=\"ql-syntax\" spellcheck=\"false\">a\n\nb  \n</pre>", "<pre class=\"ql-syntax\" spellcheck=\"false\">a\n\nb  \n</pre>"],
  ["<pre class=\"ql-syntax\" spellcheck=\"false\">\n</pre>", "<p><br></p>"],
  ["<h3><br></h3><ol><li class=\"ql-indent-1\"><br></li></ol>", "<h3><br></h3><ol><li class=\"ql-indent-1\"><br></li></ol>"],
  ["<p>a\u00a0\u00a0b</p><p>\u00a0lead</p><p>trail\u00a0</p><p>a \u00a0 b</p><p>x\u00a0 y</p>", "<p>a&nbsp;&nbsp;b</p><p>&nbsp;lead</p><p>trail&nbsp;</p><p>a b</p><p>x y</p>"],
  ["<p><a href=\"https://a.com\">a</a><a href=\"https://b.com\">b</a></p>", "<p><a href=\"https://a.com\" rel=\"noopener noreferrer\" target=\"_blank\">a</a><a href=\"https://b.com\" rel=\"noopener noreferrer\" target=\"_blank\">b</a></p>"],
  ["<p><a href=\"https://a.com/?q=&quot;x&quot;&amp;b=&lt;\">q</a> 1 &gt; 0</p>", "<p><a href=\"https://a.com/?q=&quot;x&quot;&amp;b=&lt;\" rel=\"noopener noreferrer\" target=\"_blank\">q</a> 1 &gt; 0</p>"],
  ["<p class=\"ql-indent-1\"><em>The quoted line.</em></p><p class=\"ql-indent-1\">— Ada Lovelace</p>", "<p class=\"ql-indent-1\"><em>The quoted line.</em></p><p class=\"ql-indent-1\">— Ada Lovelace</p>"],
  ["<p><strong>a </strong><em> b</em></p>", "<p><strong>a </strong><em> b</em></p>"],
  ["<p>x<strong> </strong>y</p>", "<p>x<strong> </strong>y</p>"],
  ["<ol><li>a</li></ol><p>mid</p><ol><li>b</li></ol>", "<ol><li>a</li></ol><p>mid</p><ol><li>b</li></ol>"],
  ["<p class=\"ql-indent-9\">nine</p><p class=\"ql-indent-8\">eight</p>", "<p>nine</p><p class=\"ql-indent-8\">eight</p>"],
  ["<h4 class=\"ql-indent-1 ql-align-center\">h</h4>", "<h4 class=\"ql-indent-1 ql-align-center\">h</h4>"],
  ["<p><sub>a</sub><sup>b</sup></p>", "<p><sub>a</sub><sup>b</sup></p>"],
  ["<p>tab\there</p>", "<p>tab\there</p>"],
  ["<p><a href=\"tel:+15551234\">t</a> <a href=\"http://x.y\">h</a> <a href=\"HTTPS://X.Y\">u</a></p>", "<p><a href=\"tel:+15551234\" rel=\"noopener noreferrer\" target=\"_blank\">t</a> <a href=\"http://x.y\" rel=\"noopener noreferrer\" target=\"_blank\">h</a> <a href=\"HTTPS://X.Y\" rel=\"noopener noreferrer\" target=\"_blank\">u</a></p>"],
  ["<p class=\"ql-indent-2 ql-align-center\"><a href=\"https://x.y\"><strong>b</strong> <sup>1</sup></a> tail</p><ol><li class=\"ql-indent-1 ql-align-right\">x</li><li><br></li></ol><h3 class=\"ql-indent-1\">h</h3><h4><br></h4>", "<p class=\"ql-indent-2 ql-align-center\"><a href=\"https://x.y\" rel=\"noopener noreferrer\" target=\"_blank\"><strong>b</strong> <sup>1</sup></a> tail</p><ol><li class=\"ql-indent-1 ql-align-right\">x</li><li><br></li></ol><h3 class=\"ql-indent-1\">h</h3><h4><br></h4>"],
  ["<ol><li>a</li></ol><pre class=\"ql-syntax\" spellcheck=\"false\">x\n</pre><ul><li>b</li></ul><p>end</p>", "<ol><li>a</li></ol><pre class=\"ql-syntax\" spellcheck=\"false\">x\n</pre><ul><li>b</li></ul><p>end</p>"],
  ["<p>a</p><pre>code</pre><p>b</p>", "<p>a</p><pre class=\"ql-syntax\" spellcheck=\"false\">code\n</pre><p>b</p>"],
  ["<p>emoji 😀 and <em>👩\u200d👩\u200d👧</em></p><p>   </p><p>&nbsp;</p>", "<p>emoji 😀 and <em>👩\u200d👩\u200d👧</em></p><p><br></p><p>&nbsp;</p>"],
  ["<p><strong>a </strong><em> b</em></p>", "<p><strong>a </strong><em> b</em></p>"],
  ["<p><strong> lead</strong> mid  two </p>", "<p><strong> lead</strong> mid two</p>"],
  ["<ul><li><p>gdocs item</p></li><li>x<br>y</li></ul>", "<ul><li>gdocs item</li><li>x</li><li>y</li></ul>"],
  ["<p>10&nbsp;km and a&nbsp;&nbsp;&nbsp;b</p>", "<p>10 km and a&nbsp;&nbsp;&nbsp;b</p>"],
];

test('compose serializes to the HTML real Quill 1.3.7 renders, and that HTML is a fixed point', () => {
  for (const [input, quill] of QUILL) {
    assert.equal(out(input), quill, input);
    assert.equal(out(quill), quill, `stable: ${quill}`);
  }
});

test("Quill's own HTML comes back as it is, except headings and quotes Ultra's Quill doesn't have", () => {
  const kept = [
    '<p>plain</p>', '<p><strong><em><s><u>x</u></s></em></strong></p>', '<p><sup><strong>x</strong><em>y</em></sup></p>',
    '<ol><li>a</li><li class="ql-indent-1">b</li></ol><ul><li>c</li></ul>', '<ol><li>a</li></ol><ul><li class="ql-indent-1">b</li></ul><ol><li>c</li></ol>',
    '<p class="ql-indent-2 ql-align-center">x</p><p class="ql-align-justify">z</p>', '<h3 class="ql-align-right">h</h3><h4><br></h4>',
    '<pre class="ql-syntax" spellcheck="false">a &lt; b\n  c\n</pre>', '<p><br></p>', '<ul><li><br></li></ul>',
    '<p>a&nbsp;&nbsp;b</p><p>&nbsp;lead</p><p>trail&nbsp;</p>', '<p><strong>a </strong><em> b</em></p>', '<p>tab\there</p>',
    '<p><a href="https://a.com/?q=&quot;x&quot;&amp;b=&lt;" rel="noopener noreferrer" target="_blank">q</a> 1 &gt; 0</p>',
    '<p><a href="https://a.com" rel="noopener noreferrer" target="_blank">a</a><a href="https://b.com" rel="noopener noreferrer" target="_blank">b</a></p>',
    '<p class="ql-indent-1"><em>The quoted line.</em></p><p class="ql-indent-1">— Ada Lovelace</p>',
  ];
  for (const h of kept) assert.equal(sorted(out(h)), sorted(h), h);
  assert.equal(out('<h1>a</h1><h2>b</h2><h5>c</h5><h6>d</h6>'), '<h3>a</h3><h3>b</h3><h4>c</h4><h4>d</h4>');
  assert.equal(out('<blockquote><p>q</p><ul><li>i</li></ul></blockquote>'), '<p class="ql-indent-1">q</p><ul><li class="ql-indent-1">i</li></ul>');
  assert.equal(out('<p class="ql-indent-9">nine</p>'), '<p>nine</p>', 'Quill keeps indents 1 to 8');
});

test('the compose schema holds only what Quill keeps', () => {
  assert.deepEqual(Object.keys(C.nodes).sort(), ['bullet_list', 'code_block', 'doc', 'heading', 'list_item', 'ordered_list', 'paragraph', 'text']);
  assert.deepEqual(Object.keys(C.marks), ['link', 'sup', 'sub', 'bold', 'italic', 'strike', 'underline'], 'outermost first, as Quill nests them');
  assert.deepEqual(C.nodes.heading.spec.levels, [3, 4]);
  assert.equal(C.nodes.blockquote, undefined, "Ultra's Quill has no blockquote format");
  assert.equal(C.nodes.hard_break, undefined, 'Quill makes a <br> into a new line');
});

test('Ultra-shaped posts parse; what compose would drop is reported, and the text survives', () => {
  // The probe's format list (0b, 2026-10-27): font, size, color, align, lineheight, table, image, latex, attachment.
  const ultra = '<h3>Week 4 reply</h3><p class="ql-align-center"><span class="ql-font-serif" style="color: rgb(230, 0, 0);">Red</span> words</p>'
    + '<p><img src="https://cdn.example/x.png"></p><table><tbody><tr><td>cell</td></tr></tbody></table>'
    + '<div class="attachment" data-bbfile="{}">notes.pdf</div><p><span class="ql-formula" data-value="x^2">x²</span></p>';
  assert.equal(out(ultra), '<h3>Week 4 reply</h3><p class="ql-align-center">Red words</p><p><br></p><p>cell</p><p>notes.pdf</p><p>x²</p>', "an image's line stays, empty");
  assert.deepEqual(S.loses(C, ultra), ['attachment', 'format', 'media', 'table']);
  assert.deepEqual(S.loses(C, '<p><strong>fine</strong> <a href="https://a.b">x</a></p><ol><li class="ql-indent-1">y</li></ol>'), []);
  assert.deepEqual(S.loses(C, '<p>x</p><video src="v.mp4"></video><math><mi>x</mi></math>'), ['math', 'media']);
  assert.deepEqual(S.loses(P, '<p><img src="data:image/png;base64,AAAA"></p><table><tr><td>t</td></tr></table>'), [], 'paper keeps images and tables');
});

test('disallowed markup is dropped: scripts, styles, handlers, unsafe links, unknown tags', () => {
  const bad = '<script>alert(1)</script><style>p{color:red}</style><p onclick="steal()" style="position:fixed;background:url(javascript:x)">'
    + '<a href="javascript:alert(1)">js</a> <a href=" JaVaScRiPt:alert(1)">js2</a> <a href="data:text/html,<b>x</b>">data</a> <a href="vbscript:x">vb</a>'
    + ' <a href="/relative">rel</a> <a href="https://ok.example/?a=1&amp;b=2" onmouseover="x()">ok</a> <img src=x onerror="alert(1)">'
    + '<iframe src="https://evil.example">inside</iframe><svg><script>1</script><text>svg</text></svg><custom-tag>kept text</custom-tag>'
    + '<!-- comment --><![CDATA[x]]>&lt;script&gt;</p><noscript><p>ns</p></noscript><template><p>t</p></template><textarea><p>ta</p></textarea>';
  const html = out(bad);
  assert.equal(html, '<p>js js2 data vb rel <a href="https://ok.example/?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">ok</a> kept text&lt;script&gt;</p>');
  assert.equal(out('<p>a<b>bold<i>both</p><p>next'), '<p>a<strong>bold<em>both</em></strong></p><p>next</p>', 'unclosed tags close where a browser would');
  assert.equal(out('<p a="1>2">x</p><p>y < z and w<</p>'), '<p>x</p><p>y &lt; z and w&lt;</p>', 'a quoted > is data; a bare < is text');
  assert.equal(out('<p>&amp;lt; &#60; &#x3c; &copy; &bogus; &#0; &#xD800;</p>'), '<p>&amp;lt; &lt; &lt; © &amp;bogus; \ufffd \ufffd</p>');
  assert.equal(out('<p>a\u0000b\u0007c</p>'), '<p>abc</p>', 'control characters go');
  assert.equal(out('<p><span style="mso-list:Ignore">1.<span>  </span></span>Word item<o:p></o:p></p>'), '<p>Word item</p>', "Word's list numbers go");
});

test('pasted shapes become flat Quill lists, lines and marks', () => {
  // Google Docs wraps everything in <b style="font-weight:normal">, styles runs, and puts <p> inside <li>.
  const gdocs = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38"><span style="font-weight:700">Bold</span>'
    + '<span style="font-style:italic"> it</span><span style="text-decoration:underline"> u</span><span style="vertical-align:super">2</span></p>'
    + '<br><ul><li dir="ltr"><p dir="ltr"><span>one</span></p></li><li><p>two</p><p>two more</p></li></ul></b>';
  assert.equal(out(gdocs), '<p><strong>Bold</strong><em> it</em><u> u</u><sup>2</sup></p><p><br></p><ul><li>one</li><li>two</li><li>two more</li></ul>');
  assert.equal(out('<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>'), '<ul><li>a</li><li class="ql-indent-1">b</li></ul><ol><li class="ql-indent-2">c</li></ol><ul><li>d</li></ul>');
  assert.equal(out('<ol><li data-list="bullet">q2</li><li data-list="ordered">n</li></ol>'), '<ul><li>q2</li></ul><ol><li>n</li></ol>', "Quill 2's list shape");
  assert.equal(out('<div>one</div><div><div>two</div>three</div><section>four</section>'), '<p>one</p><p>two</p><p>three</p><p>four</p>');
  assert.equal(out('<p>a<br>b</p><li>stray</li>'), '<p>a</p><p>b</p><ul><li>stray</li></ul>');
  assert.equal(out('<p style="text-align:center">c</p><p align="right">r</p>'), '<p class="ql-align-center">c</p><p class="ql-align-right">r</p>');
  assert.equal(out('<p>\n   Hello   <b>world</b>\n</p>\n<p>x</p>'), '<p>Hello <strong>world</strong></p><p>x</p>', 'source whitespace collapses as Quill reads it');
  assert.equal(out('<table><tr><td>a</td><td><p>b</p></td></tr></table>'), '<p>a</p><p>b</p>');
  assert.equal(out('<pre><code>x<br>  y</code>\n</pre>'), '<pre class="ql-syntax" spellcheck="false">x\n  y\n</pre>');
});

test('the paper schema keeps quotes, h1 to h4, page breaks, notes, tables, images, fonts and spacing', () => {
  const paper = '<h1 class="ql-align-center">Title</h1><h4>Four</h4><h6>Six</h6>'
    + '<p class="ql-indent-1" style="line-height:2;text-indent:0.5in">Body<br>line two <sup class="gz-footnote" data-footnote="See &lt;em&gt;Ibid.&lt;/em&gt;"></sup></p>'
    + '<blockquote><p>Quoted</p></blockquote><hr class="gz-page-break"><hr>'
    + '<p><span style="font-family:Tinos;font-size:16px">metric</span> <span style="font-family:Comic Sans MS">no</span></p>'
    + '<table><tr><th>H</th><td colspan="2">C</td></tr></table><p><img src="data:image/png;base64,iVBORw0KGgo=" alt="dot" width="40"><img src="http://x/y.png"><img src="javascript:1"></p>';
  const html = out(paper, P);
  assert.equal(html, '<h1 class="ql-align-center">Title</h1><h4>Four</h4><h4>Six</h4>'
    + '<p class="ql-indent-1" style="line-height:2;text-indent:0.5in">Body<br>line two <sup class="gz-footnote" data-footnote="See &lt;em&gt;Ibid.&lt;/em&gt;"></sup></p>'
    + '<blockquote><p>Quoted</p></blockquote><hr class="gz-page-break">'
    + '<p><span style="font-family:Times New Roman;font-size:12pt">metric</span> no</p>'
    + '<table><tbody><tr><th><p>H</p></th><td colspan="2"><p>C</p></td></tr></tbody></table><p><img src="data:image/png;base64,iVBORw0KGgo=" alt="dot" width="40"></p>');
  assert.equal(out(html, P), html, 'stable');
  const word = '<p class=MsoNormal style="margin-left:.5in;text-indent:-.5in;line-height:200%">Hanging<o:p></o:p></p>';
  assert.equal(out(word, P), '<p class="ql-indent-1" style="line-height:2;text-indent:-0.5in">Hanging</p>', "Word's inches and percentages");
  const doc = S.parse(P, html);
  const note = doc.child(3).lastChild;
  assert.equal(note.type.name, 'footnote_ref');
  assert.equal(note.attrs.content, 'See <em>Ibid.</em>');
  assert.equal(S.inline('<p>a <script>x</script><strong>b</strong></p><p>c<img src=x onerror=y></p>'), 'a <strong>b</strong> c', 'a note keeps marks only');
  assert.equal(out('<p>a<br></p><p><br></p>', P), '<p>a</p><p><br></p>', 'a trailing break shows nothing');
});

test('text() joins blocks with newlines and maps UTF-16 offsets to positions both ways, emoji and nested lists included', () => {
  const doc = S.parse(C, '<p>Hi 😀 there</p><ul><li>one<ul><li>two 👩\u200d👩\u200d👧</li></ul></li></ul><p><br></p><ol><li><strong>b</strong>old</li></ol>');
  const t = S.text(doc);
  assert.equal(t.text, 'Hi 😀 there\none\ntwo 👩\u200d👩\u200d👧\n\nbold');
  assert.equal('😀'.length, 2);
  for (let i = 0; i <= t.text.length; i++) {
    const pos = t.posAt(i);
    assert.equal(t.offsetAt(pos), i, `offset ${i}`);
    if (i < t.text.length && t.text[i] !== '\n') assert.equal(doc.textBetween(pos, pos + 1), t.text[i], `char ${i}`);
  }
  const at = t.text.indexOf('two');
  assert.equal(doc.textBetween(t.posAt(at), t.posAt(at + 3)), 'two');
  assert.equal(doc.resolve(t.posAt(at)).parent.attrs.indent, 1);
  assert.equal(t.offsetAt(0), 0);
  assert.equal(t.offsetAt(doc.content.size), t.text.length);
  assert.deepEqual(t.runs[0], { start: 0, end: 11, pos: 1 });
  const paper = S.parse(P, '<p>a<br>b<sup class="gz-footnote" data-footnote="n"></sup>c</p><table><tr><td>x</td></tr></table>');
  const pt = S.text(paper);
  assert.equal(pt.text, 'a\nbc\nx', 'a hard break is a newline; a note mark is no text');
  for (let i = 0; i <= pt.text.length; i++) assert.equal(pt.offsetAt(pt.posAt(i)), i);
  assert.equal(paper.textBetween(pt.posAt(3), pt.posAt(4)), 'c');
  assert.deepEqual(S.text(S.parse(C, '')).text, '');
});

test('delta() writes the Quill 1.x ops setContents takes', () => {
  const doc = S.parse(C, '<h3>T</h3><p class="ql-indent-1 ql-align-center"><a href="https://a.b"><strong>x</strong></a><sup>2</sup>&nbsp;&nbsp;y</p>'
    + '<ol><li>o</li></ol><ul><li class="ql-indent-2">u</li></ul><pre class="ql-syntax" spellcheck="false">a\n\nb\n</pre><p><s><u>z</u></s><sub>s</sub></p>');
  assert.deepEqual(S.delta(doc), [
    { insert: 'T' }, { insert: '\n', attributes: { header: 3 } },
    { insert: 'x', attributes: { link: 'https://a.b', bold: true } }, { insert: '2', attributes: { script: 'super' } },
    { insert: '\u00a0\u00a0y' }, { insert: '\n', attributes: { indent: 1, align: 'center' } },
    { insert: 'o' }, { insert: '\n', attributes: { list: 'ordered' } }, { insert: 'u' }, { insert: '\n', attributes: { list: 'bullet', indent: 2 } },
    { insert: 'a' }, { insert: '\n\n', attributes: { 'code-block': true } }, { insert: 'b' }, { insert: '\n', attributes: { 'code-block': true } },
    { insert: 'z', attributes: { strike: true, underline: true } }, { insert: 's', attributes: { script: 'sub' } }, { insert: '\n' },
  ]);
  assert.deepEqual(S.delta(S.parse(C, '')), [{ insert: '\n' }]);
});

test('links: only what Quill keeps, and a bare domain when asked', () => {
  for (const ok of ['https://a.b', 'http://a.b/c?d#e', 'HTTPS://X.Y', 'mailto:a@b.c', 'tel:+1 (555) 123-4567']) assert.equal(S.href(ok), ok);
  for (const bad of ['javascript:x', 'data:text/html,x', '/rel', '//a.b', 'https://', 'ftp://a.b', 'https://a b', `https://a.b/${'x'.repeat(2048)}`, '', null]) assert.equal(S.href(bad), null, String(bad).slice(0, 30));
  assert.equal(S.href('example.com/x', true), 'https://example.com/x');
  assert.equal(S.href('not a url', true), null);
});

test('both files are classic scripts that load after lib/pm.js in a page, once', () => {
  for (const f of ['lib/writer-schema.js', 'lib/writer-editor.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /^\s*(import|export)\s/m, f);
    assert.doesNotMatch(src, /\beval\(|new Function\b|\binnerHTML\s*=|document\.write/, f);
    assert.doesNotMatch(src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n'), /[\u0000-\u0008\u000b-\u001f\u00a0\u00ad\u200b-\u200f\ufeff]/, `${f}: invisible characters are written as escapes`);
  }
  const ctx = vm.createContext({ console });
  for (const f of ['lib/pm.js', 'lib/writer-schema.js', 'lib/writer-editor.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  const first = ctx.GZ_WRITER_SCHEMA;
  assert.equal(typeof first.parse, 'function');
  assert.equal(typeof ctx.GZ_WRITER_EDITOR.create, 'function');
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/writer-schema.js'), 'utf8'), ctx);
  assert.equal(ctx.GZ_WRITER_SCHEMA, first);
  assert.equal(vm.runInContext('GZ_WRITER_SCHEMA.serialize(GZ_WRITER_SCHEMA.compose, GZ_WRITER_SCHEMA.parse(GZ_WRITER_SCHEMA.compose, "<p>x</p>"))', ctx), '<p>x</p>');
});
