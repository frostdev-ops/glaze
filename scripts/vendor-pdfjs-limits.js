// Carry Glaze's optional output byte limit to pdf.js's writer, where its exact size is known before allocation.
// Existing callers omit it. Every replacement must match the pinned build exactly, or the rebuild stops.
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2] || path.join(__dirname, '../lib/pdfjs');
const patchFile = (name, edits) => {
  const file = path.join(dir, name);
  let text = fs.readFileSync(file, 'utf8');
  for (const [before, after, count = 1] of edits) {
    if (text.split(before).length - 1 !== count) throw new Error(`${name}: update the output limit patch for this pdf.js build`);
    text = text.split(before).join(after);
  }
  fs.writeFileSync(file, text);
};
patchFile('pdf.mjs', [
  ['saveDocument(printToPDF) {', 'saveDocument(printToPDF, maxBytes = null) {'],
  ['return this._transport.saveDocument(printToPDF);', 'return this._transport.saveDocument(printToPDF, maxBytes);'],
  ['saveDocument(printToPDF = null) {', 'saveDocument(printToPDF = null, maxBytes = null) {'],
  ['      supportsPrintToPDF: this.#printToPDF !== null,', '      maxBytes,\n      supportsPrintToPDF: this.#printToPDF !== null,'],
  ['extractPages(pageInfos, copyLevels = null) {', 'extractPages(pageInfos, copyLevels = null, maxBytes = null) {', 2],
  ['return this._transport.extractPages(pageInfos, copyLevels);', 'return this._transport.extractPages(pageInfos, copyLevels, maxBytes);'],
  ['    const params = {\n      pageInfos\n    };', '    const params = {\n      pageInfos,\n      maxBytes\n    };'],
]);
patchFile('pdf.worker.mjs', [
  ['async function incrementalUpdate({\n  originalData,', 'async function incrementalUpdate({\n  originalData,\n  maxBytes = null,'],
  ['  const array = new Uint8Array(totalLength);', '  // scripts/vendor-pdfjs-limits.js: refuse the exact output size before allocating its byte buffer.\n  if (maxBytes !== null && totalLength > maxBytes) {\n    throw new Error("PDF output exceeds byte limit");\n  }\n  const array = new Uint8Array(totalLength);'],
  ['async extractPages(pageInfos, annotationStorage, primaryDocument, handler, task) {', 'async extractPages(pageInfos, annotationStorage, primaryDocument, handler, task, maxBytes = null) {'],
  ['    return this.writePDF();', '    return this.writePDF(maxBytes);'],
  ['  async writePDF() {', '  async writePDF(maxBytes = null) {'],
  ['      originalData: header,', '      originalData: header,\n      maxBytes,'],
  ['handler.on("ExtractPages", async function ({\n      pageInfos,\n      annotationStorage', 'handler.on("ExtractPages", async function ({\n      pageInfos,\n      maxBytes,\n      annotationStorage'],
  ['pdfEditor.extractPages(pageInfos, annotationStorage, pdfManager.pdfDocument, handler, task);', 'pdfEditor.extractPages(pageInfos, annotationStorage, pdfManager.pdfDocument, handler, task, maxBytes);'],
  ['        warn(`extractPages: "${reason}".`);', '        if (reason.message === "PDF output exceeds byte limit") {\n          throw reason;\n        }\n        warn(`extractPages: "${reason}".`);'],
  ['      supportsPrintToPDF,\n      filename\n    }) {', '      supportsPrintToPDF,\n      filename,\n      maxBytes\n    }) {'],
  ['        originalData: stream.bytes,', '        originalData: stream.bytes,\n        maxBytes,'],
]);
