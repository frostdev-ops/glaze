// Glaze's OCR worker (W23), started by the reader (reader.js) for a picture or a scanned PDF page: the Tesseract
// engine (lib/tesseract/, WebAssembly), its models bundled and read from the extension's own files, never fetched
// from anywhere else. Messages: { type: 'start', langs } → 'ready'; { type: 'read', image: PGM bytes } → 'progress'
// (p, 0–1) then 'done' (the engine's JSON, as text); any failure → 'error'. The reader terminates it when the file is read.
importScripts('tesseract/tesseract-core-simd-lstm.js');
let M = null, api = null;
const LANGS = new Set(['eng', 'deu', 'spa', 'fra', 'nld', 'por']);
const here = (f) => new URL(`tesseract/${f}`, location.href).href;

const start = async (langs) => {
  M = await TesseractCore({ locateFile: here, TesseractProgress: (p) => postMessage({ type: 'progress', p: Math.max(0, (p - 30) / 70) }) });
  for (const l of langs) {
    const r = await fetch(here(`${l}.traineddata.gz`));
    if (!r.ok) throw new Error(`no ${l} model`);
    M.FS.writeFile(`${l}.traineddata`, new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()));
  }
  api = new M.TessBaseAPI();
  if (api.Init(null, langs.join('+'), 1) === -1) throw new Error('init'); // 1: LSTM only, all the fast models have
};

// One picture: straightened first (the page's skew, found from its lines, if it is over about 0.3°), then read as one
// block of text (PSM 6), which keeps a table's row on one line where automatic layout splits it into columns (S4).
const read = (image) => {
  M.FS.writeFile('/input', image);
  api.SetVariable('tessedit_pageseg_mode', '3');
  if (api.SetImageFile(1, 0) === 1) throw new Error('image');
  api.FindLines();
  const skew = api.GetGradient();
  api.SetVariable('tessedit_pageseg_mode', '6');
  api.SetImageFile(1, Math.abs(skew) >= 0.005 ? skew : 0);
  api.Recognize(null);
  const json = api.GetJSONText();
  api.Clear();
  return json;
};

onmessage = async ({ data: m }) => {
  try {
    if (m?.type === 'start') { await start((m.langs || []).filter((l) => LANGS.has(l))); postMessage({ type: 'ready' }); }
    else if (m?.type === 'read') postMessage({ type: 'done', json: read(m.image) });
  } catch (e) { postMessage({ type: 'error', why: String(e?.message || e) }); }
};
