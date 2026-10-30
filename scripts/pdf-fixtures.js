// PDFs to test Glaze's PDF documents against, each written object by object so every byte is known: three pages of
// distinct text; turns set on pages and inherited from page-tree nodes; AcroForm fields; a hybrid and a pure XFA form; a
// signature dictionary; a password-locked file and an owner-restricted one (RC4, 128-bit); a scanned page; object and
// cross-reference streams; a broken cross-reference table pdf.js has to rebuild; 300 pages of about 40 MB.
// test/pdf-doc.test.js builds the small ones in memory. As a script it writes the corpus to a folder (default: a new
// temporary one), with a public-domain pure XFA form when --xfa-url and --xfa-sha256 name one, fetched into a folder of
// its own and kept only if its SHA-256 matches; it is read, never run.
// node scripts/pdf-fixtures.js [folder] [--xfa-url URL --xfa-sha256 HEX]
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const bytes = (s) => Buffer.from(s, 'latin1');
const md5 = (...parts) => crypto.createHash('md5').update(Buffer.concat(parts)).digest();

// The standard security handler, revision 3 (ISO 32000-1, 7.6.3): RC4 with a 128-bit key.
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const padded = (password) => Buffer.concat([bytes(password), PAD]).subarray(0, 32);
const rc4 = (key, data) => {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
};
const xorEach = (key, n) => Buffer.from(key.map((b) => b ^ n));
const standardSecurity = ({ user = '', owner, permissions }, id) => {
  let ownerKey = md5(padded(owner || user));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  let O = rc4(ownerKey, padded(user));
  for (let i = 1; i <= 19; i++) O = rc4(xorEach(ownerKey, i), O);
  const P = Buffer.alloc(4);
  P.writeInt32LE(permissions);
  let key = md5(padded(user), O, P, id);
  for (let i = 0; i < 50; i++) key = md5(key);
  let U = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) U = rc4(xorEach(key, i), U);
  U = Buffer.concat([U, Buffer.alloc(16)]);
  const objectKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]));
  return {
    dict: `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${O.toString('hex')}> /U <${U.toString('hex')}> /P ${permissions} >>`,
    encrypt: (num, data) => rc4(objectKey(num), data),
  };
};
// Permission bits (ISO 32000-1, table 22): every one granted but printing (bits 3 and 12); bits 1 and 2 stay clear.
const NO_PRINT = (0xfffffffc & ~0x4 & ~0x800) | 0;

// A PDF from its objects: objects[i] is object i + 1, either a dictionary's text or { dict, stream } with the stream's
// bytes (its /Length is written here). A dictionary given as a function gets str(text), which writes a string, encrypted
// when the file is. Options: info (the document information strings), encrypt ({ user, owner, permissions }),
// objectStreams (every object that is not a stream goes in one object stream, with a cross-reference stream),
// misplaceXref (every offset in the table points a few bytes off), version.
const write = (objects, { info, encrypt, objectStreams = false, misplaceXref = false, version = '1.7', id = 'glaze' } = {}) => {
  if (encrypt && objectStreams) throw new Error('an encrypted fixture keeps a plain cross-reference table');
  const fileId = md5(bytes(id));
  const security = encrypt && standardSecurity(encrypt, fileId);
  const all = objects.slice();
  const extra = {};
  if (info) {
    extra.info = all.length + 1;
    all.push((str) => `<< ${Object.entries(info).map(([k, v]) => `/${k} ${str(v)}`).join(' ')} >>`);
  }
  if (security) { extra.encrypt = all.length + 1; all.push({ dict: security.dict, plain: true }); }
  const parts = [bytes(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`)];
  let length = parts[0].length;
  const push = (b) => { parts.push(b); length += b.length; };
  const offsets = [], packed = [];
  all.forEach((object, i) => {
    const num = i + 1;
    const { dict, stream, plain } = typeof object === 'string' || typeof object === 'function' ? { dict: object } : object;
    const crypt = (data) => (security && !plain ? security.encrypt(num, data) : data);
    const text = typeof dict === 'function' ? dict((s) => `<${crypt(bytes(s)).toString('hex')}>`) : dict;
    if (stream === undefined && objectStreams) { packed.push({ num, text }); return; }
    offsets[num] = length;
    if (stream === undefined) { push(bytes(`${num} 0 obj\n${text}\nendobj\n`)); return; }
    const data = crypt(Buffer.isBuffer(stream) ? stream : bytes(stream));
    push(bytes(`${num} 0 obj\n${text.replace(/>>\s*$/, `/Length ${data.length} >>`)}\nstream\n`));
    push(data);
    push(bytes('\nendstream\nendobj\n'));
  });
  const trailer = `/Root 1 0 R${extra.info ? ` /Info ${extra.info} 0 R` : ''}${extra.encrypt ? ` /Encrypt ${extra.encrypt} 0 R` : ''} /ID [<${fileId.toString('hex')}> <${fileId.toString('hex')}>]`;
  if (!objectStreams) {
    const xref = length, shift = misplaceXref ? 7 : 0;
    const rows = Array.from({ length: all.length }, (_, i) => `${String(offsets[i + 1] + shift).padStart(10, '0')} 00000 n \n`);
    push(bytes(`xref\n0 ${all.length + 1}\n0000000000 65535 f \n${rows.join('')}trailer\n<< /Size ${all.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`));
    return new Uint8Array(Buffer.concat(parts));
  }
  // Every dictionary in one object stream, then the cross-reference stream: type 1 rows (offsets) for the streams, type
  // 2 rows (object stream, index) for the packed objects.
  const streamNum = all.length + 1, xrefNum = all.length + 2;
  let body = '', header = '';
  for (const { num, text } of packed) { header += `${num} ${body.length} `; body += `${text}\n`; }
  const data = zlib.deflateSync(bytes(header + body));
  offsets[streamNum] = length;
  push(bytes(`${streamNum} 0 obj\n<< /Type /ObjStm /N ${packed.length} /First ${header.length} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`));
  push(data);
  push(bytes('\nendstream\nendobj\n'));
  offsets[xrefNum] = length;
  const rows = [Buffer.from([0, 0, 0, 0, 0, 255, 255])];
  for (let num = 1; num <= xrefNum; num++) {
    const row = Buffer.alloc(7);
    const at = packed.findIndex((p) => p.num === num);
    if (at >= 0) { row[0] = 2; row.writeUInt32BE(streamNum, 1); row.writeUInt16BE(at, 5); } else { row[0] = 1; row.writeUInt32BE(offsets[num], 1); }
    rows.push(row);
  }
  const table = zlib.deflateSync(Buffer.concat(rows));
  push(bytes(`${xrefNum} 0 obj\n<< /Type /XRef /Size ${xrefNum + 1} /W [1 4 2] /Filter /FlateDecode ${trailer} /Length ${table.length} >>\nstream\n`));
  push(table);
  push(bytes(`\nendstream\nendobj\nstartxref\n${offsets[xrefNum]}\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
};

// A page tree of pages, each { label, rotate, size, annots, resources, content } (label: the text printed on it), with
// tree: { rotate } on the root, or groups: [[first, count, rotate]] putting pages under an inner node with its own turn.
// Returns the objects, the page objects' numbers and a function adding objects (for fields and their like).
const pagesOf = (pages, { rotate: treeRotate, groups = [], catalog = '' } = {}) => {
  const objects = [`<< /Type /Catalog /Pages 2 0 R${catalog} >>`, null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
  const add = (o) => objects.push(o);
  const refs = [];
  for (const { label = '', rotate, size = [300, 200], annots = '', resources = '', content } of pages) {
    const text = content ?? (label ? `BT /F1 16 Tf 24 90 Td (${label}) Tj ET` : '');
    const contents = add({ dict: '<< >>', stream: text });
    refs.push(add(null));
    objects[refs.at(-1) - 1] = `<< /Type /Page /Parent %PARENT% /MediaBox [0 0 ${size.join(' ')}] /Resources << /Font << /F1 3 0 R >>${resources} >> /Contents ${contents} 0 R${rotate === undefined ? '' : ` /Rotate ${rotate}`}${annots} >>`;
  }
  const kids = [];
  for (let i = 0; i < refs.length;) {
    const group = groups.find(([first]) => first === i);
    if (!group) { objects[refs[i] - 1] = objects[refs[i] - 1].replace('%PARENT%', '2 0 R'); kids.push(refs[i++]); continue; }
    const [, count, rotate] = group;
    const node = add(null);
    const inner = refs.slice(i, i + count);
    for (const r of inner) objects[r - 1] = objects[r - 1].replace('%PARENT%', `${node} 0 R`);
    objects[node - 1] = `<< /Type /Pages /Parent 2 0 R /Kids [${inner.map((r) => `${r} 0 R`).join(' ')}] /Count ${count}${rotate === undefined ? '' : ` /Rotate ${rotate}`} >>`;
    kids.push(node);
    i += count;
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((r) => `${r} 0 R`).join(' ')}] /Count ${refs.length}${treeRotate === undefined ? '' : ` /Rotate ${treeRotate}`} >>`;
  return { objects, refs, add };
};

const LABELS = ['Alpha page one', 'Bravo page two', 'Charlie page three'];
const PASSWORDS = { user: 'glaze-user', owner: 'glaze-owner' };

// A text field's widget: its name, value and box, on the page whose object number is page.
const textField = (name, value, rect, page) => `<< /Type /Annot /Subtype /Widget /FT /Tx /T (${name}) /V (${value}) /Rect [${rect.join(' ')}] /P ${page} 0 R /F 4 /DA (/Helv 10 Tf 0 g) >>`;
const formDict = (fields, extra = '') => `<< /Fields [${fields.map((f) => `${f} 0 R`).join(' ')}] /DA (/Helv 10 Tf 0 g) /DR << /Font << /Helv 3 0 R >> >>${extra} >>`;

// Fields on two pages: a text field on the first, a ticked check box and a choice on the second.
const acroform = (opts) => {
  const { objects, refs, add } = pagesOf(LABELS.map((label) => ({ label })), { catalog: ' /AcroForm %FORM%' });
  const name = add(textField('name', 'Ada Lovelace', [24, 30, 200, 50], refs[0]));
  const look = '<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] >>';
  const yes = add({ dict: look, stream: '0 0 1 rg 2 2 10 10 re f' });
  const off = add({ dict: look, stream: '' });
  const agree = add(`<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /V /Yes /AS /Yes /Rect [24 30 38 44] /P ${refs[1]} 0 R /F 4 /AP << /N << /Yes ${yes} 0 R /Off ${off} 0 R >> >> >>`);
  const term = add(`<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (term) /Opt [(Fall) (Spring)] /V (Spring) /Rect [60 30 160 50] /P ${refs[1]} 0 R /F 4 /DA (/Helv 10 Tf 0 g) >>`);
  const form = add(formDict([name, agree, term]));
  objects[0] = objects[0].replace('%FORM%', `${form} 0 R`);
  objects[refs[0] - 1] = objects[refs[0] - 1].replace(/ >>$/, ` /Annots [${name} 0 R] >>`);
  objects[refs[1] - 1] = objects[refs[1] - 1].replace(/ >>$/, ` /Annots [${agree} 0 R ${term} 0 R] >>`);
  return write(objects, { id: 'acroform', ...opts });
};

// An XFA form: its packets as streams named in the AcroForm's /XFA. Hybrid: the AcroForm also has the field
// (form1[0].name[0], whose value the datasets packet holds); pure: no AcroForm fields, so only an XFA reader shows it.
const xfaForm = (hybrid) => {
  const fallback = hybrid ? null : 'Please wait... If this message is not eventually replaced by the proper contents of the document, your PDF viewer may not be able to display this type of document.';
  const { objects, refs, add } = pagesOf([{ content: fallback ? `BT /F1 6 Tf 10 100 Td (${fallback}) Tj ET` : `BT /F1 16 Tf 24 90 Td (${LABELS[0]}) Tj ET` }],
    { catalog: ` /AcroForm %FORM%${hybrid ? '' : ' /NeedsRendering true'}` });
  const packet = (text) => add({ dict: '<< >>', stream: text });
  const preamble = packet('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">');
  const template = packet('<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="form1" layout="tb"><pageSet><pageArea name="Page1"><contentArea x="0" y="0" w="300pt" h="200pt"/><medium stock="custom" short="300pt" long="200pt"/></pageArea></pageSet><subform><field name="name" w="150pt" h="20pt"><ui><textEdit/></ui></field></subform></subform></template>');
  const datasets = packet('<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><form1><name>Ada Lovelace</name></form1></xfa:data></xfa:datasets>');
  const postamble = packet('</xdp:xdp>');
  const xfa = ` /XFA [(preamble) ${preamble} 0 R (template) ${template} 0 R (datasets) ${datasets} 0 R (postamble) ${postamble} 0 R]`;
  let fields = [];
  if (hybrid) {
    const parent = add(null);
    const kid = add(`<< /Type /Annot /Subtype /Widget /FT /Tx /Parent ${parent} 0 R /T (name[0]) /V (Ada Lovelace) /Rect [24 30 200 50] /P ${refs[0]} 0 R /F 4 /DA (/Helv 10 Tf 0 g) >>`);
    objects[parent - 1] = `<< /T (form1[0]) /Kids [${kid} 0 R] >>`;
    objects[refs[0] - 1] = objects[refs[0] - 1].replace(/ >>$/, ` /Annots [${kid} 0 R] >>`);
    fields = [parent];
  }
  const form = add(formDict(fields, xfa));
  objects[0] = objects[0].replace('%FORM%', `${form} 0 R`);
  return write(objects, { id: hybrid ? 'hybrid-xfa' : 'pure-xfa' });
};

// A signed form's shape: SigFlags 3, a signature field whose /V is a signature dictionary, its ByteRange around its
// /Contents. The PKCS#7 bytes are zeros: readers see a signature that does not verify.
const signed = () => {
  const { objects, refs, add } = pagesOf(LABELS.map((label) => ({ label })), { catalog: ' /AcroForm %FORM%' });
  const range = '[0 0000000000 0000000000 0000000000]';
  const contents = `<${'0'.repeat(2048)}>`;
  const sig = add(`<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (Glaze Fixture) /M (D:20261030120000Z) /ByteRange ${range} /Contents ${contents} >>`);
  const field = add(`<< /Type /Annot /Subtype /Widget /FT /Sig /T (signature) /V ${sig} 0 R /Rect [180 20 280 60] /P ${refs[2]} 0 R /F 132 >>`);
  const form = add(formDict([field], ' /SigFlags 3'));
  objects[0] = objects[0].replace('%FORM%', `${form} 0 R`);
  objects[refs[2] - 1] = objects[refs[2] - 1].replace(/ >>$/, ` /Annots [${field} 0 R] >>`);
  const out = Buffer.from(write(objects, { id: 'signed' }));
  const text = out.toString('latin1');
  const start = text.indexOf(contents), end = start + contents.length;
  const filled = `[0 ${String(start).padStart(10, '0')} ${String(end).padStart(10, '0')} ${String(out.length - end).padStart(10, '0')}]`;
  out.write(filled, text.indexOf(range), 'latin1');
  return new Uint8Array(out);
};

// A scan: one page that is only a picture (grey stripes and a box), no text.
const scanned = () => {
  const [w, h] = [300, 200];
  const pixels = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = (y % 20 < 3) || (x > 40 && x < 120 && y > 60 && y < 140) ? 40 : 235;
  const { objects, refs, add } = pagesOf([{ content: `q ${w} 0 0 ${h} 0 0 cm /Im1 Do Q`, resources: ' /XObject << /Im1 %IMG% >>' }]);
  const image = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`, stream: zlib.deflateSync(pixels) });
  objects[refs[0] - 1] = objects[refs[0] - 1].replace('%IMG%', `${image} 0 R`);
  return write(objects, { id: 'scanned' });
};

// count pages, each its label and a picture of noise (which does not compress), so the file comes to about `size` bytes.
const large = ({ count = 300, size = 40e6 } = {}) => {
  const side = Math.floor(Math.sqrt(size / count));
  const pages = Array.from({ length: count }, (_, i) => ({ label: `Page ${i + 1} of ${count}`, content: `q 200 0 0 120 50 10 cm /Im1 Do Q BT /F1 16 Tf 24 150 Td (Page ${i + 1} of ${count}) Tj ET`, resources: ' /XObject << /Im1 %IMG% >>' }));
  const { objects, refs, add } = pagesOf(pages);
  for (const ref of refs) {
    const image = add({ dict: `<< /Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceGray /BitsPerComponent 8 >>`, stream: crypto.randomBytes(side * side) });
    objects[ref - 1] = objects[ref - 1].replace('%IMG%', `${image} 0 R`);
  }
  return write(objects, { id: 'large' });
};

const FIXTURES = {
  // Three pages of distinct text, nothing else.
  three: () => write(pagesOf(LABELS.map((label) => ({ label }))).objects, { id: 'three' }),
  // Turns from the root of the page tree (90), a page's own (270), an inner node's (180) and the root's again.
  rotated: () => write(pagesOf([{ label: LABELS[0] }, { label: LABELS[1], rotate: 270 }, { label: LABELS[2] }, { label: 'Delta page four' }],
    { rotate: 90, groups: [[2, 1, 180]] }).objects, { id: 'rotated' }),
  acroform,
  hybridXfa: () => xfaForm(true),
  pureXfa: () => xfaForm(false),
  signed,
  // Opens only with the user password.
  encrypted: () => write(pagesOf(LABELS.map((label) => ({ label }))).objects, { id: 'encrypted', info: { Title: 'Locked fixture' }, encrypt: { user: PASSWORDS.user, owner: PASSWORDS.owner, permissions: -4 } }),
  // Opens without a password; its owner allows everything but printing.
  restricted: () => write(pagesOf(LABELS.map((label) => ({ label }))).objects, { id: 'restricted', info: { Title: 'Restricted fixture' }, encrypt: { owner: PASSWORDS.owner, permissions: NO_PRINT } }),
  scanned,
  xrefStream: () => write(pagesOf(LABELS.map((label) => ({ label }))).objects, { id: 'xref-stream', objectStreams: true }),
  brokenXref: () => write(pagesOf(LABELS.map((label) => ({ label }))).objects, { id: 'broken-xref', misplaceXref: true }),
};

module.exports = { write, pagesOf, FIXTURES, LABELS, PASSWORDS, NO_PRINT, large, acroform };

// The corpus, as files: every fixture above, the 300-page one, and the pure XFA download when one is named.
const main = async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
  const [url, sha] = [flag('--xfa-url'), flag('--xfa-sha256')];
  const dir = path.resolve(args[0] || fs.mkdtempSync(path.join(os.tmpdir(), 'gz-pdf-fixtures-')));
  fs.mkdirSync(dir, { recursive: true });
  const written = {};
  for (const [name, build] of Object.entries(FIXTURES)) written[name] = build();
  written.large = large();
  for (const [name, data] of Object.entries(written)) fs.writeFileSync(path.join(dir, `${name}.pdf`), data);
  if (url) {
    if (!/^[0-9a-f]{64}$/.test(sha || '')) throw new Error('--xfa-url needs --xfa-sha256 with the file\'s SHA-256');
    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-pdf-download-'));
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 50e6) {
        await response.body?.cancel();
        throw new Error(response.ok ? 'The XFA download exceeds 50 MB' : `${url}: HTTP ${response.status}`);
      }
      const file = path.join(box, 'download.pdf'), digest = crypto.createHash('sha256');
      fs.writeFileSync(file, '');
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 50e6) throw new Error('The XFA download exceeds 50 MB');
        digest.update(chunk);
        fs.appendFileSync(file, chunk);
      }
      const got = digest.digest('hex');
      if (got !== sha) throw new Error(`${url}: SHA-256 ${got}, expected ${sha}`);
      fs.copyFileSync(file, path.join(dir, 'publicXfa.pdf'));
      written.publicXfa = { length };
    } finally { fs.rmSync(box, { recursive: true, force: true }); }
  }
  for (const [name, data] of Object.entries(written)) console.log(`${name}.pdf\t${data.length} bytes`);
  console.log(dir);
};
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
