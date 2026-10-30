// A small macro-enabled workbook (.xlsm) as Excel writes one: the macro-enabled main part, a sheet with A1 "Macro" and
// B1 42, and its VBA project (xl/vbaProject.bin, opaque bytes kept verbatim). For test/sheet-kind.test.js and
// scripts/sheets-check.js.
const Z = require('../../lib/zip.js');
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const VBA = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x56, 0x42, 0x41]);
const rels = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${RT}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const PARTS = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS}><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'vbaProject', 'vbaProject.bin']]),
  'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Macro</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>`,
  'xl/vbaProject.bin': VBA,
};
const enc = new TextEncoder();
const xlsm = () => new Uint8Array(Buffer.concat(Z.zip(Object.entries(PARTS).map(([name, s]) => ({ name, data: typeof s === 'string' ? enc.encode(s) : s, date: new Date(2026, 0, 1) })))));
module.exports = { xlsm, VBA, MIME: 'application/vnd.ms-excel.sheet.macroEnabled.12' };
