// Synthetic OOXML only. No student documents or network resources are used.
const X = require('../../lib/writer-docx.js');
const S = require('../../lib/writer-schema.js');
const Z = require('../../lib/zip.js');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const r = (s) => `<w:r><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
const p = (s, pr = '') => `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${r(s)}</w:p>`;
const pack = (body, extras = {}) => {
  const parts = X.exportDocx(S.paper.node('doc', null, [S.paper.node('paragraph')])).parts;
  parts['word/document.xml'] = parts['word/document.xml'].replace(/<w:body>[\s\S]*?(<w:sectPr>)/, `<w:body>${body}$1`);
  Object.assign(parts, extras);
  return Buffer.concat(Z.zip(Object.entries(parts).map(([name, text]) => ({ name, data: new TextEncoder().encode(text) }))));
};
const list = (s, level = 0) => p(s, `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`);
const numbering = '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1">' + [0, 1, 2].map((i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${i + 1}."/></w:lvl>`).join('') + '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';
const table = (body) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${body}</w:tc></w:tr></w:tbl>`;
const fixtures = {
  'lists-in-table': () => ({ bytes: pack(table(list('Outer') + list('Inner', 1) + list('Deep', 2)), { 'word/numbering.xml': numbering }), text: 'OuterInnerDeep', levels: [0, 1, 2] }),
  'notes-in-quote': () => ({ bytes: pack(`<w:p><w:pPr><w:pStyle w:val="BlockQuote"/></w:pPr>${r('Quoted')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`, { 'word/footnotes.xml': '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1">' + p('Note é 🧑🏽‍💻') + '</w:footnote></w:footnotes>' }), text: 'Quoted', note: 'Note é 🧑🏽‍💻' }),
  'picture-and-table': () => { const doc = S.parse(S.paper, '<p>Before<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Dot" width="24"></p><table><tr><td>Beside</td></tr></table><p>After</p>'); return { bytes: X.exportDocx(doc).bytes, text: 'BeforeBesideAfter', images: 1 }; },
  'forty-two-pages': () => ({ bytes: pack(Array.from({ length: 42 }, (_, i) => p(`Page ${i + 1}`, i ? '<w:pageBreakBefore/>' : '')).join('')), text: Array.from({ length: 42 }, (_, i) => `Page ${i + 1}`).join(''), breaks: 41 }),
  'rtl-runs': () => ({ bytes: pack(`<w:p>${r('English ')}<w:r><w:rPr><w:rtl/></w:rPr><w:t>مرحبا بالعالم</w:t></w:r>${r(' end')}</w:p>`), text: 'English مرحبا بالعالم end' }),
  'unicode': () => ({ bytes: pack(p('é 👨‍👩‍👧‍👦 🏳️‍🌈 𝕬 𐐀 क्षि A\u200fB')), text: 'é 👨‍👩‍👧‍👦 🏳️‍🌈 𝕬 𐐀 क्षि A\u200fB' }),
  'ten-thousand-words': () => { const text = Array.from({ length: 10000 }, (_, i) => `word${i}`).join(' '); return { bytes: pack(p(text)), text }; },
  'all-headings': () => ({ bytes: pack(Array.from({ length: 6 }, (_, i) => p(`Heading ${i + 1}`, `<w:pStyle w:val="Heading${i + 1}"/>`)).join(''), { 'word/styles.xml': '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/></w:style>`).join('') + '</w:styles>' }), text: Array.from({ length: 6 }, (_, i) => `Heading ${i + 1}`).join(''), headings: [1, 2, 3, 4, 5, 6] }),
  'docs-suggestions-comments': () => ({ bytes: pack(`<w:p>${r('Kept ')}<w:del>${r('Deleted')}</w:del><w:ins>${r('inserted')}</w:ins><w:commentRangeStart w:id="0"/>${r(' commented')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p><w:ins>${p('Added paragraph')}</w:ins><w:del>${p('Removed paragraph')}</w:del>`, { 'word/comments.xml': '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0">' + p('Private comment') + '</w:comment></w:comments>' }), text: 'Kept inserted commentedAdded paragraph', warnings: ['Tracked changes were accepted.', 'Comments were left out.'] }),
  'macros-external': () => ({ bytes: pack(p('Safe text'), { 'word/vbaProject.bin': 'INERT MACRO FIXTURE', 'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://invalid.test/template.dotm" TargetMode="External"/></Relationships>' }), text: 'Safe text', stripped: true }),
  'custom-xml-block': () => ({ bytes: pack(`<w:customXml w:uri="urn:glaze:fixture" w:element="section">${p('Tagged paragraph')}${table(p('Tagged cell'))}</w:customXml>${p('After tagged block')}`), text: 'Tagged paragraphTagged cellAfter tagged block' }),
  'body-content-control': () => ({ bytes: pack(`<w:sdt><w:sdtPr/><w:sdtContent>${p('Controlled')}${table(p('Nested'))}</w:sdtContent></w:sdt>${p('End')}`), text: 'ControlledNestedEnd' }),
  'field-with-picture': () => { const img = X.exportDocx(S.parse(S.paper, '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="></p>')).parts; const draw = /<w:drawing>[\s\S]*?<\/w:drawing>/.exec(img['word/document.xml'])[0]; return { bytes: pack(`<w:p><w:r>${draw}</w:r>${r('Before ')}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r('7')}<w:r><w:fldChar w:fldCharType="end"/></w:r>${r('After')}</w:p>`), text: 'Before After' }; },
};
module.exports = { fixtures, pack, p, r, table };
