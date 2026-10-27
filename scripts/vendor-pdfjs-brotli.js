// Rewrites the Brotli decoder in pdf.js's worker (external/brotli/decode.js) so it ships no packed data.
// pdf.js carries Brotli's dictionary (RFC 7932, appendix A) as one long string, XORed back into bytes at start-up, and
// two small tables as characters offset from numbers. Packed strings decoded at run time are how hidden code is
// usually smuggled, and the Chrome Web Store reviews Glaze for obfuscation (2026-10-26). Written out as text, the
// dictionary would not do either: it is cut from web pages, so it is full of "javascript:", "<iframe src=" and
// "document.write(". So the dictionary becomes a data file, lib/pdfjs/brotli-dictionary.bin (google/brotli's own
// dictionary.bin, which scripts/vendor-pdfjs.sh fetches by a pinned hash), read when the worker starts, the way pdf.js
// already reads its image decoders from files beside it; the tables become their numbers. Without the file only
// Brotli-compressed streams fail. The rewrite proves itself before writing: the file is byte for byte the dictionary
// pdf.js packs, and the old and new decoders both turn Node's own Brotli output back into the original bytes.
// Usage (from scripts/vendor-pdfjs.sh): node scripts/vendor-pdfjs-brotli.js lib/pdfjs/pdf.worker.mjs lib/pdfjs/brotli-dictionary.bin
const fs = require('node:fs');
const vm = require('node:vm');
const zlib = require('node:zlib');

const START = '\nlet makeBrotliDecode = () => {\n';
const END = '\nlet BrotliDecode = makeBrotliDecode();';
const fail = (what) => { throw new Error(`vendor-pdfjs-brotli: ${what}; pdf.js's Brotli decoder changed, update this rewrite`); };
const once = (src, find, what) => { if (src.split(find).length !== 2) fail(what); return src.indexOf(find); };
const block = (src, name) => {
  const i = once(src, `\n  function ${name}(`, `function ${name}`);
  const j = src.indexOf('\n  }\n', i);
  if (j < 0) fail(`the end of ${name}`);
  return src.slice(i, j + 4);
};
const wrap = (items, indent, width = 118) => {
  const lines = [];
  let line = '';
  for (const item of items) {
    if (line && indent.length + line.length + item.length + 2 > width) { lines.push(indent + line.trimEnd()); line = ''; }
    line += `${item}, `;
  }
  if (line) lines.push(indent + line.trimEnd());
  return lines.join('\n');
};
const numbers = (literal) => [...vm.runInNewContext(literal)].map((c) => c.charCodeAt(0) - 32);

// The dictionary the decoder builds, built the way it builds it.
const packed = (decoder) => {
  const call = decoder.match(/\n  unpackDictionaryData\(dictionaryData, ([\s\S]*?)\);\n/) || fail('the dictionary call');
  const ctx = vm.createContext({ dictionaryData: new Int8Array(122784), dictionarySizeBits: new Int32Array(25) });
  vm.runInContext(`${block(decoder, 'toUsAsciiBytes')}${block(decoder, 'toUtf8Runes')}${block(decoder, 'unpackDictionaryData')}
    unpackDictionaryData(dictionaryData, ${call[1]});`, ctx);
  return { bytes: Buffer.from(ctx.dictionaryData.buffer), sizeBits: [...ctx.dictionarySizeBits], call: call[0] };
};

const LOAD = `
// Brotli's built-in dictionary (RFC 7932, appendix A): brotli-dictionary.bin beside this module, google/brotli's
// dictionary.bin, read once here. scripts/vendor-pdfjs-brotli.js put it there in place of the packed string pdf.js
// ships. Without it, only Brotli-compressed streams fail.
let BROTLI_DICTIONARY = null;
try {
  const response = await fetch(new URL("./brotli-dictionary.bin", import.meta.url));
  if (response.ok) {
    BROTLI_DICTIONARY = new Uint8Array(await response.arrayBuffer());
  }
} catch {}
if (BROTLI_DICTIONARY?.length !== 122784) {
  BROTLI_DICTIONARY = null;
}`;

const rewrite = (src, dictionary) => {
  const s = once(src, START, 'makeBrotliDecode') + 1, e = once(src, END, 'BrotliDecode');
  const before = src.slice(s, e);
  const dict = packed(before);
  if (!dictionary.equals(dict.bytes)) fail('brotli-dictionary.bin is not the dictionary pdf.js packs');

  let after = before.replace(START.slice(1), `${START.slice(1)}  if (!BROTLI_DICTIONARY) {
    return () => {
      throw new Error("Brotli dictionary unavailable");
    };
  }
`);
  const head = '\n  const dictionaryData = new Int8Array(122784);\n  const dictionarySizeBits = new Int32Array(25);';
  once(after, head + dict.call, 'the dictionary set-up');
  after = after.replace(head + dict.call, `
  // The dictionary, and how many words of each length it holds (as powers of two).
  const dictionaryData = new Int8Array(BROTLI_DICTIONARY.buffer, BROTLI_DICTIONARY.byteOffset, BROTLI_DICTIONARY.length);
  const dictionarySizeBits = new Int32Array([${dict.sizeBits.join(', ')}]);
`);
  after = after.replace(block(after, 'unpackDictionaryData'), '\n');

  // The transforms table: 121 triplets (prefix, transform, suffix), shipped as characters 32 above each number.
  const tcall = /(\n  unpackTransforms\(RFC_TRANSFORMS\.prefixSuffixStorage, RFC_TRANSFORMS\.prefixSuffixHeads, RFC_TRANSFORMS\.triplets, "(?:[^"\\]|\\.)*", )("(?:[^"\\]|\\.)*")\);\n/;
  const t = after.match(tcall) || fail('the transforms call');
  const triplets = numbers(t[2]);
  if (triplets.length !== 363) fail('the transforms size');
  const rows = [];
  for (let i = 0; i < triplets.length; i += 3) rows.push(`${triplets[i]}, ${triplets[i + 1]}, ${triplets[i + 2]}`);
  after = after.replace(tcall, `${t[1]}[\n${wrap(rows, '    ')}\n  ]);\n`);
  // The context lookup table: 128 numbers and 19 run lengths, shipped the same way.
  const lcall = /\n  unpackLookupTable\(LOOKUP, ("(?:[^"\\]|\\.)*"), ("(?:[^"\\]|\\.)*")\);\n/;
  const l = after.match(lcall) || fail('the lookup table call');
  const [map, rle] = [numbers(l[1]), numbers(l[2])];
  if (map.length !== 128 || rle.length !== 19) fail('the lookup table size');
  after = after.replace(lcall, `\n  unpackLookupTable(LOOKUP, [\n${wrap(map.map(String), '    ')}\n  ], [${rle.join(', ')}]);\n`);
  for (const [from, to] of [['      transforms[i] = transformsSrc.charCodeAt(i) - 32;', '      transforms[i] = transformsSrc[i];'],
    ['lookup[1024 + i] = 4 * (utfMap.charCodeAt(i) - 32);', 'lookup[1024 + i] = 4 * utfMap[i];'],
    ['const rep = utfRle.charCodeAt(k) - 32;', 'const rep = utfRle[k];']]) {
    once(after, from, 'a table loop');
    after = after.replace(from, to);
  }
  if (/\^ 3;|\^ 236;|charCodeAt\([^)]*\) - \d|unpackDictionaryData/.test(after)) fail('packed data is left');

  // Proof: both decoders undo Node's Brotli, which at its best setting leans on the dictionary and its transforms.
  const decoder = (code, context) => vm.runInNewContext(`(${code.slice(code.indexOf('() =>')).replace(/;\s*$/, '')})()`, context);
  const oldDecode = decoder(before, {}), newDecode = decoder(after, { BROTLI_DICTIONARY: new Uint8Array(dictionary) });
  const samples = [
    'The quick brown fox jumps over the lazy dog. Homework is due on Friday, and the exam covers chapters four to six. ',
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Syllabus</title></head><body><div class="content">Office hours</div></body></html>',
    'Привет, мир. 你好，世界。 नमस्ते दुनिया। Hola, ¿qué tal? Größe, café, naïve, ½ — “quoted”. ',
    Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 251)).toString('latin1'),
  ];
  for (const text of samples) {
    const input = Buffer.from(text.repeat(20), 'utf8');
    const compressed = zlib.brotliCompressSync(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } });
    for (const [name, decode] of [['old', oldDecode], ['new', newDecode]]) {
      const out = decode(new Int8Array(compressed.buffer, compressed.byteOffset, compressed.length));
      if (!Buffer.from(out.buffer, out.byteOffset, out.length).equals(input)) fail(`the ${name} decoder did not undo Node's Brotli`);
    }
  }
  return `${src.slice(0, s - 1)}${LOAD}\n${after}${src.slice(e)}`;
};

if (require.main === module) {
  const [file, dictionary] = process.argv.slice(2);
  fs.writeFileSync(file, rewrite(fs.readFileSync(file, 'utf8'), fs.readFileSync(dictionary)));
}
module.exports = { rewrite };
