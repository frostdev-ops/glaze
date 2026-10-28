// Word files for Glaze Writer's import, built the way Word 16 (Mac) writes them: the parts, elements and attributes are
// copied from a real student paper saved from MLA.dotx (docDefaults, Normal with no pPr, the Hyperlink and Header styles,
// a right-aligned header with a PAGE field in a page-number content control, the paragraphs' and runs' properties, the
// section), and from Word's own default styles for what that paper doesn't use (Title, Heading 1-2, List Paragraph, Quote,
// No Spacing, Strong, Emphasis, the 2013 Office theme). The words are generated: no real paper's text is here.
// Each file exercises structure the importer must keep: spacing, line rules, indents, tabs, page breaks, keep options,
// the header and footer, page size and margins, fonts through the theme. scripts/writer-import-fidelity.js writes them out
// and lays them out in Word and in Writer.
// → { files: { id: { parts } }, bytes(id) → Buffer, text(n, seed) }
const Z = require('../../lib/zip.js');

// ---- words: a fixed stream of plain English, so every run of the file is the same text
const WORDS = ('the a of to and in that is for it as with on by this be are from at or an was which can their have more not but '
  + 'they has one all would there been many also when other what these some time into only most new people may such than its '
  + 'like over first after where much through very used work how should could each between both those under while same year '
  + 'water river city garden market morning letter window table bridge station paper school field house street music story '
  + 'small large early late quiet bright simple careful common open public local final careful steady gentle narrow wide '
  + 'walk carry build follow write read listen notice gather measure change remember choose answer explain return describe '
  + 'season weather harbor valley island forest mountain village lantern kitchen library theater museum orchard meadow '
  + 'student teacher reader writer painter farmer traveler neighbor builder visitor').split(' ');
const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
// n words of sentences (a capital first, a full stop every 9 to 22 words).
const text = (n, seed = 1) => {
  const r = rng(seed), out = [];
  let left = 0;
  for (let i = 0; i < n; i++) {
    if (left <= 0) left = 9 + Math.floor(r() * 14);
    let w = WORDS[Math.floor(r() * WORDS.length)];
    if (left === 9 + 99 || out.length === 0 || /\.$/.test(out.at(-1))) w = w[0].toUpperCase() + w.slice(1);
    left--;
    if (left === 0 || i === n - 1) w += '.';
    else if (r() < 0.06) w += ',';
    out.push(w);
  }
  return out.join(' ');
};

// ---- the package's fixed parts
const W = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w14 w15"';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const types = (extra) => `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${extra.map((p) => `<Override PartName="/word/${p}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${p.startsWith('header') ? 'header' : 'footer'}+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
const ROOT_RELS = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;
const CORE = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title></dc:title><dc:creator>Synthetic</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-19T12:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-10-19T12:00:00Z</dcterms:modified></cp:coreProperties>`;
const APP = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Template>Normal.dotm</Template><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion></Properties>`;
const SETTINGS = `${DECL}<w:settings ${W}><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/><w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="enableOpenTypeFeatures" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="doNotFlipMirrorIndents" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/><w:compatSetting w:name="differentiateMultirowTableHeaders" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/></w:compat><w:themeFontLang w:val="en-US"/></w:settings>`;
const FONTS = `${DECL}<w:fonts ${W}><w:font w:name="Times New Roman"><w:panose1 w:val="02020603050405020304"/><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font><w:font w:name="Arial"><w:panose1 w:val="020B0604020202020204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="Calibri"><w:panose1 w:val="020F0502020204030204"/><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font><w:font w:name="Courier New"><w:panose1 w:val="02070309020205020404"/><w:charset w:val="00"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font></w:fonts>`;
// The theme's fonts: Word 2023+ (Aptos) or 2013-2022 (Calibri Light / Calibri). Colours and formats as Office's.
const theme = (major, minor) => `${DECL}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="0E2841"/></a:dk2><a:lt2><a:srgbClr val="E8E8E8"/></a:lt2><a:accent1><a:srgbClr val="156082"/></a:accent1><a:accent2><a:srgbClr val="E97132"/></a:accent2><a:accent3><a:srgbClr val="196B24"/></a:accent3><a:accent4><a:srgbClr val="0F9ED5"/></a:accent4><a:accent5><a:srgbClr val="A02B93"/></a:accent5><a:accent6><a:srgbClr val="4EA72E"/></a:accent6><a:hlink><a:srgbClr val="467886"/></a:hlink><a:folHlink><a:srgbClr val="96607D"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="${major}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${minor}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

// ---- styles.xml: the defaults and the styles a file uses, as Word writes them
const TNR = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>';
const STYLE = {
  Normal: '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>',
  DefaultParagraphFont: '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
  TableNormal: '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
  NoList: '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/></w:style>',
  Hyperlink: '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="467886" w:themeColor="hyperlink"/><w:u w:val="single"/></w:rPr></w:style>',
  Header: '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:link w:val="HeaderChar"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  HeaderChar: '<w:style w:type="character" w:customStyle="1" w:styleId="HeaderChar"><w:name w:val="Header Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Header"/><w:uiPriority w:val="99"/></w:style>',
  Footer: '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:link w:val="FooterChar"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  FooterChar: '<w:style w:type="character" w:customStyle="1" w:styleId="FooterChar"><w:name w:val="Footer Char"/><w:basedOn w:val="DefaultParagraphFont"/><w:link w:val="Footer"/><w:uiPriority w:val="99"/></w:style>',
  Title: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="TitleChar"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>',
  Heading1: '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1Char"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>',
  Heading2: '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading2Char"/><w:uiPriority w:val="9"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="40" w:after="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:eastAsiaTheme="majorEastAsia" w:hAnsiTheme="majorHAnsi" w:cstheme="majorBidi"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>',
  ListParagraph: '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>',
  Quote: '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="QuoteChar"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:spacing w:before="200" w:after="160"/><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040" w:themeColor="text1" w:themeTint="BF"/></w:rPr></w:style>',
  NoSpacing: '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:uiPriority w:val="1"/><w:qFormat/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>',
  Strong: '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="22"/><w:qFormat/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>',
  Emphasis: '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="20"/><w:qFormat/><w:rPr><w:i/><w:iCs/></w:rPr></w:style>',
};
// rPrDefault: the theme's minor font (Word 2013+), a size; pPrDefault: spacing.
const styles = (sz, spacing, ids, rFonts = '<w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorBidi"/>', extra = '') => `${DECL}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${rFonts}<w:kern w:val="2"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${spacing}</w:pPr></w:pPrDefault></w:docDefaults>${extra}${['Normal', 'DefaultParagraphFont', 'TableNormal', 'NoList', ...ids].map((id) => STYLE[id]).join('')}</w:styles>`;

// ---- document.xml pieces
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let paraId = 0x1A2B0000;
const pid = () => (paraId++).toString(16).toUpperCase().padStart(8, '0');
// A paragraph: pPr's inner XML (rPr for the paragraph mark included), and its runs.
const p = (ppr, ...runs) => `<w:p w14:paraId="${pid()}" w14:textId="77777777" w:rsidR="0089487A" w:rsidRDefault="0089487A">${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs.join('')}</w:p>`;
// A run: rPr's inner XML and its content; strings become w:t, '\t' a tab, '\n' a line break.
const r = (rpr, ...content) => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${content.map((c) => (c === '\t' ? '<w:tab/>' : c === '\n' ? '<w:br/>' : c === '\f' ? '<w:br w:type="page"/>' : `<w:t${/^\s|\s$/.test(c) ? ' xml:space="preserve"' : ''}>${esc(c)}</w:t>`)).join('')}</w:r>`;
const mark = (rpr) => `<w:rPr>${rpr}</w:rPr>`;
const PAGE = (rpr) => `<w:r>${rpr ? mark(rpr) : ''}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr ? mark(rpr) : ''}<w:instrText xml:space="preserve"> PAGE   \\* MERGEFORMAT </w:instrText></w:r><w:r>${rpr ? mark(rpr) : ''}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr ? mark(`${rpr}<w:noProof/>`) : '<w:rPr><w:noProof/></w:rPr>'}<w:t>1</w:t></w:r><w:r>${rpr ? mark(`${rpr}<w:noProof/>`) : '<w:rPr><w:noProof/></w:rPr>'}<w:fldChar w:fldCharType="end"/></w:r>`;
const NUMPAGES = (rpr) => `<w:r>${rpr ? mark(rpr) : ''}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rpr ? mark(rpr) : ''}<w:instrText xml:space="preserve"> NUMPAGES   \\* MERGEFORMAT </w:instrText></w:r><w:r>${rpr ? mark(rpr) : ''}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rpr ? mark(rpr) : ''}<w:t>1</w:t></w:r><w:r>${rpr ? mark(rpr) : ''}<w:fldChar w:fldCharType="end"/></w:r>`;
const hdr = (kind, ...paras) => `${DECL}<w:${kind} ${W}>${paras.join('')}</w:${kind}>`;
const sect = (refs, size = 'w:w="12240" w:h="15840"', mar = 'w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"', title = false) => `<w:sectPr w:rsidR="00B103FE">${refs}<w:pgSz ${size}/><w:pgMar ${mar}/><w:cols w:space="720"/>${title ? '<w:titlePg/>' : ''}<w:docGrid w:linePitch="360"/></w:sectPr>`;
const docXML = (body) => `${DECL}<w:document ${W}><w:body>${body}</w:body></w:document>`;

const pack = ({ document, styles: st, headers = {}, links = [], major = 'Aptos Display', minor = 'Aptos' }) => {
  const rels = [['rId1', 'styles', 'styles.xml'], ['rId2', 'settings', 'settings.xml'], ['rId3', 'fontTable', 'fontTable.xml'], ['rId4', 'theme', 'theme/theme1.xml'],
    ...Object.keys(headers).map((name, i) => [`rId${10 + i}`, name.startsWith('header') ? 'header' : 'footer', name])];
  return {
    '[Content_Types].xml': types(Object.keys(headers)), '_rels/.rels': ROOT_RELS, 'docProps/core.xml': CORE, 'docProps/app.xml': APP,
    'word/document.xml': document, 'word/styles.xml': st, 'word/settings.xml': SETTINGS, 'word/fontTable.xml': FONTS, 'word/theme/theme1.xml': theme(major, minor),
    'word/_rels/document.xml.rels': `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}${links.map((href, i) => `<Relationship Id="rId${30 + i}" Type="${REL}/hyperlink" Target="${esc(href)}" TargetMode="External"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(Object.entries(headers).map(([name, xml]) => [`word/${name}`, xml])),
  };
};
const rid = (name, files) => `rId${10 + Object.keys(files).indexOf(name)}`;

// ---- the files
const files = {};

// An MLA paper as Word 16 saves one from MLA.dotx: the heading block and title at the defaults (1.16 lines, 8 pt after),
// the body double-spaced keeping 8 pt after, four paragraphs opened with a tab and one with a first-line indent, empty
// double-spaced lines (one holding a line break) before a centred Works Cited, entries with no space after and a hanging
// indent, each with an italic title and a hyperlink; every run Times New Roman; "Lastname PAGE" at the right of the header.
{
  const rp = TNR, D = '<w:spacing w:line="480" w:lineRule="auto"/>';
  const ppr = (x = '') => `${x}<w:rPr>${rp}</w:rPr>`;
  const headers = { 'header1.xml': hdr('hdr', p(`<w:pStyle w:val="Header"/><w:jc w:val="right"/><w:rPr>${rp}</w:rPr>`, r(rp, 'Rivera'), r(rp, ' '), `<w:sdt><w:sdtPr><w:rPr>${rp}</w:rPr><w:id w:val="712397139"/><w:docPartObj><w:docPartGallery w:val="Page Numbers (Top of Page)"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtEndPr><w:rPr><w:noProof/></w:rPr></w:sdtEndPr><w:sdtContent>${PAGE(rp)}</w:sdtContent></w:sdt>`)) };
  const body = (n, seed, tab = true, first = false) => p(ppr(`${D}${first ? '<w:ind w:firstLine="720"/>' : ''}`), ...(tab ? [r(rp, '\t')] : []), r(rp, text(n, seed)));
  const entry = (lead, title, rest, link) => p(ppr('<w:spacing w:after="0" w:line="480" w:lineRule="auto"/><w:ind w:left="720" w:hanging="720"/>'), r(rp, lead), r(`${rp}<w:i/><w:iCs/>`, title), r(rp, rest), `<w:hyperlink r:id="rId${30 + link}" w:history="1">${r(`<w:rStyle w:val="Hyperlink"/>${rp}`, `https://doi.org/10.5555/${1000 + link * 37}.${20 + link}`)}</w:hyperlink>`, r(rp, '.'));
  const links = [0, 1, 2, 3].map((i) => `https://doi.org/10.5555/${1000 + i * 37}.${20 + i}`);
  const document = docXML([
    p(ppr(), r(rp, 'Alex Rivera')), p(ppr(), r(rp, 'Prof. Okafor')), p(ppr(), r(rp, 'ENG 1100')), p(ppr(), r(rp, '19 October 2026')), p(ppr()),
    p(ppr('<w:jc w:val="center"/>'), r(rp, 'What the River Keeps'), r(rp, ':'), r(rp, ' A Season of Small Changes')),
    body(205, 11), body(330, 12), body(285, 13, false, true), body(228, 14), body(152, 15),
    p(ppr(D), r(rp, '\n')), p(ppr(D)), p(ppr(D)), p(ppr(D)), p(ppr(D)), p(ppr(D)),
    p(ppr(`${D}<w:jc w:val="center"/>`), r(rp, 'Works'), r(rp, ' '), r(rp, 'Cited')),
    entry('Abbott, Lena, and Marcus Hale. “', 'Notes on the Harbor', '.” Journal of Small Places, vol. 12, no. 3, 2024, pp. 41–58, ', 0),
    entry('Brook, Sara. ', 'A Field Guide to Quiet Streets', '. Lantern Press, 2021, ', 1),
    entry('Castillo, Ren, et al. “', 'Measuring the Morning', '.” Review of Common Weather, vol. 7, 2023, ', 2),
    entry('Dunn, Ellis. “', 'The Orchard Ledger', '.” Valley Studies, no. 5, May 2025, pp. 112–29, ', 3),
    p(ppr(D)),
    sect(`<w:headerReference w:type="default" r:id="rId10"/>`),
  ].join(''));
  files['mla-word'] = pack({ document, styles: styles(24, '<w:spacing w:after="160" w:line="278" w:lineRule="auto"/>', ['Hyperlink', 'Header', 'HeaderChar']), headers, links });
}

// Paragraph spacing and line rules through styles and direct formatting, on Word 2013-2022's defaults (Calibri 11 from the
// theme, 8 pt after, 1.08 lines): a Title and headings from the style chain (keep with next, space before), List
// Paragraph's contextual spacing, a Quote with right and left indents, No Spacing, exactly and at-least line heights,
// direct space before and after, a page break inside a paragraph and a page break before, widow control turned off, a
// line break, and character styles and run formatting (bold, italic, underline, strike, superscript, subscript, colour,
// highlight).
{
  const document = docXML([
    p('<w:pStyle w:val="Title"/>', r('', 'Notes on Spacing')),
    p('', r('', text(120, 21))),
    p('<w:pStyle w:val="Heading1"/>', r('', 'Space before a heading')),
    p('', r('', text(90, 22)), r('<w:rStyle w:val="Strong"/>', ' strong words '), r('', text(20, 23)), r('<w:rStyle w:val="Emphasis"/>', ' emphasised words '), r('', text(30, 24))),
    p('<w:pStyle w:val="ListParagraph"/>', r('', text(24, 25))),
    p('<w:pStyle w:val="ListParagraph"/>', r('', text(30, 26))),
    p('<w:pStyle w:val="ListParagraph"/>', r('', text(18, 27))),
    p('<w:pStyle w:val="Quote"/>', r('', text(46, 28))),
    p('<w:spacing w:before="360" w:after="360"/>', r('', text(70, 29))),
    p('<w:spacing w:line="360" w:lineRule="exact"/>', r('', text(80, 30))),
    p('<w:spacing w:line="400" w:lineRule="atLeast"/>', r('', text(40, 31)), r('<w:sz w:val="40"/><w:szCs w:val="40"/>', ' large words '), r('', text(40, 32))),
    p('<w:pStyle w:val="NoSpacing"/>', r('', text(40, 33))),
    p('<w:pStyle w:val="NoSpacing"/>', r('', text(40, 34))),
    p('<w:spacing w:line="480" w:lineRule="auto"/><w:ind w:right="1440"/>', r('', text(60, 35))),
    p('', r('', text(30, 36)), r('<w:b/><w:bCs/>', ' bold '), r('<w:i/><w:iCs/>', 'italic '), r('<w:u w:val="single"/>', 'underlined'), r('', ' '), r('<w:strike/>', 'struck'), r('', ' E = mc'), r('<w:vertAlign w:val="superscript"/>', '2'), r('', ' and H'), r('<w:vertAlign w:val="subscript"/>', '2'), r('', 'O '), r('<w:color w:val="C00000"/>', 'red words'), r('', ' '), r('<w:highlight w:val="yellow"/>', 'highlighted words'), r('', ` ${text(40, 37)}`)),
    p('', r('', text(30, 38), '\n', text(30, 39))),
    p('', r('', text(60, 40)), r('', '\f'), r('', text(60, 41))),
    p('<w:pStyle w:val="Heading2"/>', r('', 'After a break inside a paragraph')),
    p('', r('', text(200, 42))),
    p('<w:pageBreakBefore/>', r('', text(80, 43))),
    p('<w:pStyle w:val="Heading1"/>', r('', 'Kept with the next paragraph')),
    p('', r('', text(260, 44))),
    p('<w:widowControl w:val="0"/>', r('', text(230, 45))),
    p('', r('', text(230, 46))),
    p('<w:keepLines/>', r('', text(160, 47))),
    p('', r('', text(120, 48))),
    sect(''),
  ].join(''));
  files.spacing = pack({ document, styles: styles(22, '<w:spacing w:after="160" w:line="259" w:lineRule="auto"/>', ['Hyperlink', 'Title', 'Heading1', 'Heading2', 'ListParagraph', 'Quote', 'NoSpacing', 'Strong', 'Emphasis']), major: 'Calibri Light', minor: 'Calibri' });
}

// Tabs: Word's default stops (every half inch, from the margin) after text and at a line's start, a paragraph's own
// left, centre, right and decimal stops, a dotted leader to a right stop, a hanging indent whose first tab goes to the
// left indent, and stops cleared from a style. Times New Roman 12 single-spaced, from rPrDefault.
{
  const tabs = (...t) => `<w:tabs>${t.map(([v, pos, leader]) => `<w:tab w:val="${v}"${leader ? ` w:leader="${leader}"` : ''} w:pos="${pos}"/>`).join('')}</w:tabs>`;
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(p(tabs(['left', 1440], ['center', 4680], ['right', 7920], ['decimal', 9000]), r('', `Item ${i + 1}`, '\t', ['north', 'harbor', 'east field', 'the long valley road', 'mill', 'gate'][i], '\t', ['early', 'late', 'quiet morning', 'noon', 'evening', 'night'][i], '\t', ['12', '1,240', '7', '310', '45', '2,006'][i], '\t', ['3.5', '12.25', '0.75', '104.5', '8', '19.125'][i])));
  const document = docXML([
    p('<w:jc w:val="center"/>', r('<w:b/><w:bCs/>', 'Tab Stops')),
    p('', r('', 'Name:', '\t', 'Alex Rivera', '\t', '\t', 'Date:', '\t', '19 October 2026')),
    p('', r('', '\t', text(90, 51))),
    p('', r('', text(9, 52), '\t', text(40, 53), '\t', text(20, 54))),
    ...rows,
    p(tabs(['right', 9350, 'dot']), r('', 'Introduction', '\t', '1')),
    p(tabs(['right', 9350, 'dot']), r('', 'A longer chapter heading for the contents', '\t', '12')),
    p(tabs(['right', 9350, 'dot']), r('', 'Notes', '\t', '104')),
    p('<w:ind w:left="720" w:hanging="360"/>', r('', '1.', '\t', text(50, 55))),
    p('<w:ind w:left="720" w:hanging="360"/>', r('', '2.', '\t', text(42, 56))),
    p('<w:ind w:left="1440" w:hanging="720"/>', r('', 'Term', '\t', text(40, 57))),
    p('<w:pStyle w:val="Header"/>' + tabs(['clear', 4680]), r('', 'Left', '\t', 'skips the cleared centre', '\t', 'right')),
    p('<w:ind w:left="360"/>', r('', 'Indented', '\t', 'to the next default stop', '\t', text(30, 58))),
    p('<w:ind w:firstLine="360"/>', r('', 'First line', '\t', text(60, 59))),
    p('', r('', text(200, 60))),
    sect(''),
  ].join(''));
  files.tabs = pack({ document, styles: styles(24, '', ['Header', 'HeaderChar'], TNR), major: 'Calibri Light', minor: 'Calibri' });
}

// The page: A4, wider side margins and a deeper top one, the header and footer at their own distances, a different
// first-page header (none) and footer, a centred "Page n of m" footer and a header with a title and the page number at
// the right stop; Arial 11 from rPrDefault with 10 pt after and 1.15 lines, runs in Courier New, Calibri and larger
// sizes on some lines.
{
  const A = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
  const headers = {
    'header1.xml': hdr('hdr', p('<w:pStyle w:val="Header"/>', r('', 'Field Notes: The Valley'), r('', '\t'), r('', '\t'), r('', 'Page '), PAGE(''))),
    'footer1.xml': hdr('ftr', p('<w:pStyle w:val="Footer"/><w:jc w:val="center"/>', r('', 'Page '), PAGE(''), r('', ' of '), NUMPAGES(''))),
    'header2.xml': hdr('hdr', p('<w:pStyle w:val="Header"/>')),
    'footer2.xml': hdr('ftr', p('<w:pStyle w:val="Footer"/><w:jc w:val="center"/>', r('<w:i/><w:iCs/>', 'Draft for the class'))),
  };
  const refs = '<w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/><w:headerReference w:type="first" r:id="rId12"/><w:footerReference w:type="first" r:id="rId13"/>';
  const paras = [p('<w:jc w:val="center"/>', r('<w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/>', 'Field Notes: The Valley'))];
  for (let i = 0; i < 16; i++) {
    const runs = [r('', text(70 + (i * 13) % 60, 70 + i))];
    if (i % 4 === 1) runs.push(r('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/>', ' measured at 07:40 '), r('', text(20, 90 + i)));
    if (i % 4 === 2) runs.push(r('<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="28"/><w:szCs w:val="28"/>', ' a larger note '), r('', text(25, 110 + i)));
    if (i % 5 === 3) runs.push(r('<w:sz w:val="18"/><w:szCs w:val="18"/>', ' small print in the margin of the page '), r('', text(15, 130 + i)));
    paras.push(p(i % 6 === 5 ? '<w:jc w:val="both"/>' : '', ...runs));
  }
  const document = docXML([...paras, sect(refs, 'w:w="11906" w:h="16838"', 'w:top="1800" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="567" w:gutter="0"', true)].join(''));
  files.page = pack({ document, styles: styles(22, '<w:spacing w:after="200" w:line="276" w:lineRule="auto"/>', ['Header', 'HeaderChar', 'Footer', 'FooterChar'], A), headers, major: 'Calibri Light', minor: 'Calibri' });
  // The relationship ids above are the order the parts are listed in.
  if (rid('footer2.xml', headers) !== 'rId13') throw Error('writer-docx-import: header ids moved');
}

const bytes = (id) => {
  const parts = files[id], date = new Date('2026-10-19T12:00:00Z');
  return Buffer.concat(Z.zip(Object.entries(parts).map(([name, s]) => ({ name, data: new TextEncoder().encode(s), date }))).map((c) => Buffer.from(c)));
};

module.exports = { files, bytes, text };
