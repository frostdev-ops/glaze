// Snapshot-bound AI outlines. Saved labels describe section contents, never document positions; each draw gives them
// the current anchors and hierarchy. A closed panel, edit, setting change or unload cancels inference.
var GZ_WRITER_OUTLINE = globalThis.GZ_WRITER_OUTLINE || (() => {
  const SCHEMA = 1, VERSION = 'writer-outline-v4', ROLES = ['introduction', 'body', 'conclusion', 'custom'];
  const LIMIT = { sections: 32, entries: 64, content: 124096, saved: 248192 };
  // Keep this boundary contract identical to writer.outline.plan: an authored heading owns its first following block;
  // subsequent natural blocks stand alone. Heading depth affects navigation, not a section's generated label.
  const plan = (blocks) => {
    const sections = []; let authored = null;
    for (const block of blocks) {
      if (block.kind === 'heading') {
        authored = { blocks: [block], heading: block.text, level: block.level || 1 };
        sections.push(authored);
      } else if (authored?.blocks.length === 1) authored.blocks.push(block);
      else sections.push({ blocks: [block], heading: null, level: authored ? Math.min(6, authored.level + 1) : 1 });
    }
    return sections;
  };
  const contentOf = (section) => JSON.stringify(section.blocks.map((b) => [b.kind, b.text]));
  const labelOf = (value, section) => {
    if (!value || !ROLES.includes(value.role) || typeof value.heading !== 'string') return null;
    const heading = value.heading;
    if (section.heading !== null ? heading !== section.heading : (!heading.trim() || heading !== heading.trim() || heading.length > 80
      || !/[\p{L}\p{N}]/u.test(heading) || /[\p{Cc}\p{Bidi_Control}<>]/u.test(heading) || heading.split(/\s+/u).length > 8)) return null;
    return { heading, role: value.role };
  };
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  // Historical rows may not match any current section, so validate their own complete section before retaining them.
  // Neither an arbitrary string identity nor an unchecked title/role can ride along with a later successful save.
  const entryOf = (row) => {
    if (!row || Object.keys(row).some((k) => !['content', 'heading', 'role'].includes(k))
      || typeof row.content !== 'string' || !row.content.length || row.content.length > LIMIT.content
      || typeof row.heading !== 'string' || row.heading.length > 120000 || !ROLES.includes(row.role)) return null;
    let blocks;
    try { blocks = JSON.parse(row.content); } catch { return null; }
    if (!Array.isArray(blocks) || !blocks.length || blocks.length > 2 || JSON.stringify(blocks) !== row.content) return null;
    let text = 0;
    for (const block of blocks) if (!Array.isArray(block) || block.length !== 2
      || !['paragraph', 'heading', 'blockquote', 'bullet_list', 'ordered_list', 'table', 'code_block'].includes(block[0])
      || typeof block[1] !== 'string' || !block[1].trim() || (text += block[1].length) > 120000) return null;
    if (blocks.length === 2 && (blocks[0][0] !== 'heading' || blocks[1][0] === 'heading')) return null;
    const label = labelOf(row, { heading: blocks[0][0] === 'heading' ? blocks[0][1] : null });
    return label ? { content: row.content, ...label } : null;
  };
  const anchor = (label, section) => ({ ...label, level: section.level, start: section.blocks[0].id, end: section.blocks.at(-1).id });
  const checked = (output, sections) => {
    if (!Array.isArray(output?.sections) || output.sections.length !== sections.length || !sections.length || sections.length > LIMIT.sections) return null;
    const result = [];
    for (const [i, section] of sections.entries()) {
      const value = output.sections[i], label = labelOf(value, section), current = label && anchor(label, section);
      if (!current || value.start !== current.start || value.end !== current.end || value.level !== current.level
        || Object.keys(value).some((k) => !['heading', 'role', 'start', 'end', 'level'].includes(k))) return null;
      result.push(current);
    }
    return result;
  };
  const namespace = (snapshot) => typeof snapshot.scope === 'string' && /^(?:[a-z0-9.-]{1,253}(?::\d{1,5})?\|_\d+_\d+\|_\d+_\d+\|_\d+_\d+|doc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.test(snapshot.scope)
    && typeof snapshot.identity === 'string' && snapshot.identity.length > 0 && snapshot.identity.length <= 4096
    && typeof snapshot.language === 'string' && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(snapshot.language)
    ? JSON.stringify([SCHEMA, VERSION, snapshot.scope, snapshot.identity, snapshot.language]) : '';
  const create = ({ generate, changed = () => {}, persist = () => {}, now = Date.now, later = setTimeout, clear = clearTimeout, delay = 1600, interval = 15000 }) => {
    let key = '', result = null, error = false, detail = null, running = false, attempted = false, timer = 0, control = null, turn = 0, last = -Infinity, latest = null, flags = {}, bound = '', reused = [];
    const labels = new Map();
    const cancel = () => { turn++; clear(timer); timer = 0; control?.abort(); control = null; if (running) attempted = false; running = false; };
    const state = () => ({ result, error, running, detail, cached: reused });
    const remember = (content, label) => { labels.delete(content); labels.set(content, label); };
    const saved = (snapshot) => {
      const value = { schema: SCHEMA, version: VERSION, scope: snapshot.scope, identity: snapshot.identity, language: snapshot.language, entries: [] };
      const entries = value.entries; let size = bytes(value);
      for (const [content, label] of [...labels].reverse()) {
        const row = entryOf({ content, ...label });
        if (!row || entries.length >= LIMIT.entries) continue;
        const length = bytes(row) + (entries.length ? 1 : 0);
        if (size + length > LIMIT.saved) continue;
        size += length; entries.push(row);
      }
      return value;
    };
    const update = (raw, options) => {
      const snapshot = { ...raw, blocks: raw.blocks.map((b) => ({ ...b })) }, next = namespace(snapshot);
      latest = snapshot; flags = options;
      if (snapshot.key !== key || next !== bound) {
        cancel(); key = snapshot.key; result = null; reused = []; error = attempted = false; detail = null;
        if (next !== bound || !next) labels.clear();
        bound = next;
      }
      // Metadata is only a hint: cap it, bind every identity component, and recheck each label against current content.
      const stored = snapshot.saved;
      if (bound && stored?.schema === SCHEMA && stored.version === VERSION && namespace(stored) === bound
        && Array.isArray(stored.entries) && stored.entries.length <= LIMIT.entries) {
        let size = 0;
        for (const raw of stored.entries) {
          const row = entryOf(raw);
          if (!row) continue;
          const length = bytes(row);
          if (size + length > LIMIT.saved) continue;
          size += length;
          if (!labels.has(row.content)) labels.set(row.content, { heading: row.heading, role: row.role });
        }
      }
      if (!options.enabled) { cancel(); result = null; reused = []; error = attempted = false; return state(); }
      const sections = plan(snapshot.blocks), cached = [];
      if (bound) for (const section of sections) {
        const label = labelOf(labels.get(contentOf(section)), section);
        if (label) cached.push(anchor(label, section));
      }
      reused = cached;
      if (cached.length === sections.length && sections.length && sections.length <= LIMIT.sections) { result = cached; error = false; detail = null; }
      if (!options.active) { cancel(); return state(); }
      if (result || attempted || running || timer || !snapshot.blocks.length) return state();
      const mine = turn;
      timer = later(async () => {
        timer = 0;
        if (mine !== turn) return;
        control = new AbortController();
        const signal = control.signal;
        attempted = running = true; error = false; last = now(); changed();
        let output = null; detail = null;
        try { output = await generate(snapshot.blocks, { signal, cached, identity: snapshot.identity }); } catch (e) { detail = { error: e?.error, ...(globalThis.GZ_AI_FAILURE?.diagnostic(e) || {}) }; }
        if (mine !== turn || signal.aborted) return;
        control = null; running = false;
        result = checked(output, sections);
        error = !result;
        if (result && bound) {
          for (const [i, section] of sections.entries()) remember(contentOf(section), { heading: result[i].heading, role: result[i].role });
          const value = saved(snapshot);
          labels.clear(); for (const { content, heading, role } of value.entries) labels.set(content, { heading, role });
          try { Promise.resolve(persist(value)).catch(() => {}); } catch { /* a refused cache save never fails inference */ }
        }
        changed();
      }, Math.max(delay, last + interval - now()));
      return state();
    };
    const retry = () => { cancel(); attempted = error = false; last = -Infinity; if (latest) update(latest, flags); changed(); };
    return { update, state, retry, stop: cancel };
  };
  return { create, plan, SCHEMA, VERSION };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_OUTLINE;
