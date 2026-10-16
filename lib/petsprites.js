// Local sprite packages. Import bytes are decoded and re-encoded in the extension, never executed.
var GZ_PET_SPRITES = globalThis.GZ_PET_SPRITES || (() => {
  const COUNTS = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
  const STATES = ['idle', 'running-right', 'running-left', 'waving', 'jumping', 'failed', 'waiting', 'running', 'review'];
  const BUILTIN = { ember: { name: 'Ember', spriteVersionNumber: 2 }, luna: { name: 'Luna', spriteVersionNumber: 2 }, mochi: { name: 'Mochi', spriteVersionNumber: 2 }, sprout: { name: 'Sprout', spriteVersionNumber: 2 }, pebble: { name: 'Pebble', spriteVersionNumber: 2 } };
  const KEY = 'petSprites', MAX_INPUT = 20 * 1024 * 1024, MAX_IMAGE = 2000000, MAX_TOTAL = 4000000, MAX_PETS = 8;
  const ID = /^(?:own:[a-f0-9-]{36}|[a-z][a-z0-9-]{0,30})$/;
  const meta = (raw, width, height) => {
    const version = height === 1872 ? 1 : height === 2288 ? 2 : 0;
    if (width !== 1536 || !version || (raw?.spriteVersionNumber !== undefined && raw.spriteVersionNumber !== version)) throw new Error('Unsupported pet sprite layout.');
    return { name: typeof raw?.name === 'string' ? raw.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) || 'Imported pet' : 'Imported pet',
      description: typeof raw?.description === 'string' ? raw.description.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) : '', spriteVersionNumber: version };
  };
  const frame = (state = 'idle', elapsed = 0, version = 2) => {
    if (state === 'look' && version === 2) {
      const index = ((Math.round(elapsed) % 16) + 16) % 16;
      return { x: index % 8 * 192, y: (9 + Math.floor(index / 8)) * 208, width: 192, height: 208 };
    }
    const row = Math.max(0, STATES.indexOf(state)), index = Math.floor(Math.max(0, elapsed) / 125) % COUNTS[row];
    return { x: index * 192, y: row * 208, width: 192, height: 208 };
  };
  const direction = (dx, dy) => ((Math.round(Math.atan2(dx, -dy) / (Math.PI / 8)) % 16) + 16) % 16;
  const pixels = (rgba, version) => {
    const height = version === 1 ? 1872 : 2288;
    if (![1, 2].includes(version) || rgba.length !== 1536 * height * 4) throw new Error('Invalid sprite pixels.');
    const occupied = Array((height / 208) * 8).fill(0);
    for (let y = 0; y < height; y++) for (let x = 0; x < 1536; x++) if (rgba[(y * 1536 + x) * 4 + 3] > 8) occupied[Math.floor(y / 208) * 8 + Math.floor(x / 192)]++;
    for (let row = 0; row < height / 208; row++) for (let col = 0; col < 8; col++) {
      const n = occupied[row * 8 + col];
      if (col < COUNTS[row] ? !n || n > 192 * 208 * .95 : n) throw new Error('The sprite sheet has missing frames or an opaque background.');
    }
    return true;
  };
  const dataBytes = (data) => {
    if (typeof data !== 'string' || data.length > MAX_IMAGE || !/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)) throw new Error('Invalid pet picture.');
    return Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  };
  const dataURL = (bytes, mime) => {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:${mime};base64,${btoa(raw)}`;
  };
  const normalize = async (input, raw = {}) => {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length || bytes.length > MAX_INPUT) throw new Error('Pet files must be at most 20 MB.');
    const D = globalThis.GZ_DOCTEXT || (typeof require === 'function' && require('./doctext.js'));
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    const webp = new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
    const size = D?.imageSize(bytes);
    if ((!png && !webp) || !size) throw new Error('Choose a PNG or WebP sprite sheet.');
    const info = meta(raw, size.w, size.h);
    const image = await createImageBitmap(new Blob([bytes], { type: png ? 'image/png' : 'image/webp' }));
    try {
      if (image.width !== size.w || image.height !== size.h) throw new Error('Invalid pet dimensions.');
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0); pixels(context.getImageData(0, 0, image.width, image.height).data, info.spriteVersionNumber);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: .9 });
      const data = dataURL(new Uint8Array(await blob.arrayBuffer()), blob.type);
      if (data.length > MAX_IMAGE) throw new Error('This pet is too large after compression.');
      return { ...info, data };
    } finally { image.close(); }
  };
  const clean = (raw) => {
    if (raw === undefined) return {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > MAX_PETS) throw new Error('Pet library could not be read.');
    let total = 0;
    for (const [id, item] of Object.entries(raw)) {
      if (!id.startsWith('own:') || !ID.test(id) || ![1, 2].includes(item?.spriteVersionNumber) || typeof item?.name !== 'string') throw new Error('Pet library could not be read.');
      dataBytes(item.data); total += item.data.length;
    }
    if (total > MAX_TOTAL) throw new Error('Pet library is full.');
    return raw;
  };
  const change = async (m, { local }) => {
    const all = clean((await local.get(KEY))[KEY]);
    if (m.op === 'list') return { ok: true, pets: [...Object.entries(BUILTIN).map(([id, p]) => ({ id, ...p })), ...Object.entries(all).map(([id, p]) => ({ id, name: p.name, spriteVersionNumber: p.spriteVersionNumber }))] };
    if (m.op === 'get') return typeof m.id !== 'string' || !ID.test(m.id) ? { ok: false } : { ok: true, pet: Object.hasOwn(BUILTIN, m.id) ? { ...BUILTIN[m.id], path: `assets/art/pets/${m.id}/spritesheet.webp` } : Object.hasOwn(all, m.id) ? all[m.id] : null };
    if (m.op === 'delete') {
      if (typeof m.id !== 'string' || !m.id.startsWith('own:') || !ID.test(m.id)) return { ok: false };
      const next = { ...all }; delete next[m.id];
      return { ok: await local.set({ [KEY]: next }) };
    }
    if (m.op !== 'import' || Object.keys(all).length >= MAX_PETS) return { ok: false, error: 'full' };
    const pet = await normalize(dataBytes(m.data), m.meta), id = `own:${crypto.randomUUID()}`, next = { ...all, [id]: pet };
    clean(next);
    return { ok: await local.set({ [KEY]: next }), id };
  };
  return { COUNTS, STATES, BUILTIN, KEY, MAX_INPUT, MAX_IMAGE, MAX_TOTAL, MAX_PETS, ID, meta, frame, direction, pixels, normalize, dataBytes, dataURL, clean, change };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_SPRITES; else GZ_PET_SPRITES;
