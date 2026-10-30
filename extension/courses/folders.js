// Device-only outline visibility: Ultra's folders (ids _1_1) and Canvas's modules (plain numbers, also on a local http Canvas).
// The worker serializes single-folder edits across tabs.
var GZ_FOLDERS = (() => {
  const ID = /^(?:_\d{1,18}_\d{1,18}|\d{1,18})$/;
  const KEY = /^hiddenFolders:(?:https:\/\/[a-z\d.-]+(?::\d{1,5})?\/_\d{1,18}_\d{1,18}\/_\d{1,18}_\d{1,18}|https?:\/\/[a-z\d.-]+(?::\d{1,5})?\/\d{1,18}\/\d{1,18})$/i;
  const MAX_IDS = 500, MAX_KEYS = 200, MAX_BYTES = 262144;
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const key = (origin, user, course) => {
    if (![origin, user, course].every((v) => typeof v === 'string')) return '';
    const k = `hiddenFolders:${origin}/${user}/${course}`;
    return KEY.test(k) ? k : '';
  };
  const clean = (v) => ({ ids: [...new Set((Array.isArray(v?.ids) ? v.ids : []).filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, MAX_IDS), show: v?.show === true });
  const fits = (records) => Object.keys(records).length <= MAX_KEYS && new TextEncoder().encode(JSON.stringify(records)).length <= MAX_BYTES;
  const backup = (raw) => {
    const out = {};
    for (const [k, v] of obj(raw) ? Object.entries(raw) : []) {
      if (!KEY.test(k) || !obj(v) || !Array.isArray(v.ids) || v.ids.length > MAX_IDS || v.ids.some((id) => typeof id !== 'string' || !ID.test(id)) || typeof v.show !== 'boolean') continue;
      const next = { ...out, [k]: clean(v) };
      if (!fits(next)) break;
      out[k] = next[k];
    }
    return out;
  };
  const change = async (m, { local }) => {
    if (typeof m?.key !== 'string' || !KEY.test(m.key) || (m.show !== undefined && typeof m.show !== 'boolean') || (m.id !== undefined && (typeof m.id !== 'string' || !ID.test(m.id) || typeof m.hidden !== 'boolean'))) return { ok: false, error: 'bad' };
    const all = await local.get(null);
    const before = clean(all[m.key]);
    const ids = new Set(before.ids);
    if (m.id !== undefined) { if (m.hidden) ids.add(m.id); else ids.delete(m.id); }
    if (ids.size > MAX_IDS) return { ok: false, error: 'cap' };
    const data = { ids: [...ids], show: m.show ?? before.show };
    const records = { ...Object.fromEntries(Object.entries(all).filter(([k]) => KEY.test(k))), [m.key]: data };
    if (!fits(records)) return { ok: false, error: 'cap' };
    return await local.set({ [m.key]: data }) ? { ok: true, data } : { ok: false, error: 'write' };
  };
  const restore = async (raw, area, todo, extra = {}) => {
    if (!obj(raw?.settings)) return { ok: false, error: 'bad' };
    const folders = backup(raw.folders), all = await area.local.get(null);
    if (!fits({ ...Object.fromEntries(Object.entries(all).filter(([k]) => KEY.test(k))), ...folders })) return { ok: false, error: 'cap' };
    const tasks = Object.fromEntries(Object.entries(obj(raw.tasks) ? raw.tasks : {}).filter(([k]) => todo.STORE_KEY.test(k)).map(([k, v]) => [k, todo.clean(v)]));
    return todo.restore({ ...tasks, ...folders, ...extra }, raw.settings, area.local, area.sync);
  };
  return { ID, KEY, MAX_IDS, MAX_KEYS, MAX_BYTES, key, clean, backup, change, restore };
})();
if (typeof module !== 'undefined') module.exports = GZ_FOLDERS; else GZ_FOLDERS;
