// Glaze Writer's editor tools, declared for a later MCP integration (plan: "editor tools exposed as hooks"): what a model
// could read of the document being written and the two things it could propose, in the AI harness's tool shape
// (lib/ai/tools.js define: name, kind, description, parameters, run, summarize). Nothing offers them to a model yet and
// there is no transport: tools(bridge) builds them over a bridge the page would provide, register(registry, bridge) adds
// them to a lib/ai/tools.js registry.
// bridge: { text() → string (blocks joined by '\n'), outline() → [{ level, text, offset }], issues() → [GZ_WRITER_ISSUES issue
//   with its text], sources() → [source (CSL-JSON subset)], assignment() → { title, instructions, rubric } | null,
//   cite(sourceId, page) → { inText } | null (what insertCitation would put at the caret), insertCitation(sourceId, page) →
//   { ok }, applyFix(issueId, suggestion) → { ok } }.
// read tools answer; confirm tools wait for the student, and what they're shown comes from summarize (Glaze's own words
// built from the bridge), never from the model. Classic script; module.exports for node.
var GZ_WRITER_TOOLS = globalThis.GZ_WRITER_TOOLS || (() => {
  // A page of the document's text, the most issues, sources and outline rows one answer gives.
  const LIMIT = { page: 3000, issues: 200, sources: 200, outline: 200, quote: 200 };
  const str = (description, maxLength = 200) => ({ type: 'string', description, maxLength });
  const int = (description, minimum, maximum) => ({ type: 'integer', description, minimum, maximum });
  const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const pages = (text) => {
    const out = [];
    let cur = '';
    for (const line of String(text).split('\n')) {
      if (cur && cur.length + line.length + 1 > LIMIT.page) { out.push(cur); cur = ''; }
      cur += (cur ? '\n' : '') + line;
    }
    out.push(cur);
    return out;
  };
  const issueOf = (bridge, id) => (bridge.issues() || []).find((i) => i && i.id === id) || null;
  const sourceOf = (bridge, id) => (bridge.sources() || []).find((s) => s && s.id === id) || null;
  const short = (s, n = LIMIT.quote) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  const tools = (bridge) => [
    {
      name: 'document_read', kind: 'read',
      description: 'Read the student\'s document: its text a page at a time (about 3,000 characters a page) and its outline (headings with their level and character offset).',
      parameters: obj({ page: int('Which page of the text, from 1', 1, 10000) }),
      run: ({ page = 1 }) => {
        const all = pages(bridge.text() || '');
        return { page: Math.min(page, all.length), pages: all.length, text: all[Math.min(page, all.length) - 1], outline: (bridge.outline() || []).slice(0, LIMIT.outline) };
      },
    },
    {
      name: 'document_issues', kind: 'read',
      description: 'List the spelling, grammar, style, format and citation issues the editor shows now, each with its id, kind, the words it is about, its message and its suggestions.',
      parameters: obj({}),
      run: () => (bridge.issues() || []).slice(0, LIMIT.issues).map((i) => ({ id: i.id, kind: i.kind, source: i.source, text: short(i.text), message: short(i.message, 300), suggestions: (i.suggestions || []).slice(0, 5) })),
    },
    {
      name: 'document_sources', kind: 'read',
      description: 'List the sources the student has added to this document (CSL-JSON: id, type, title, author, issued, container-title, publisher, page, DOI, URL).',
      parameters: obj({}),
      run: () => (bridge.sources() || []).slice(0, LIMIT.sources),
    },
    {
      name: 'assignment_read', kind: 'read',
      description: 'Read the assignment this document answers: its title, its instructions and its rubric (criteria and levels), or null when it isn\'t an assignment.',
      parameters: obj({}),
      run: () => bridge.assignment() || null,
    },
    {
      name: 'citation_insert', kind: 'confirm',
      description: 'Propose putting an in-text citation of one of the document\'s sources at the student\'s caret, in the document\'s citation style. The student sees it first.',
      parameters: obj({ sourceId: str('The source\'s id, from document_sources'), page: str('The page or pages cited, as the source numbers them', 40) }, ['sourceId']),
      run: ({ sourceId, page }) => (sourceOf(bridge, sourceId) ? bridge.insertCitation(sourceId, page ?? null) : { ok: false, error: 'No such source.' }),
      summarize: ({ sourceId, page }) => {
        const s = sourceOf(bridge, sourceId), c = s && bridge.cite(sourceId, page ?? null);
        return s && c?.inText ? `Insert the citation ${short(c.inText, 120)} for "${short(s.title, 120)}" at the caret.` : 'Insert a citation of a source that isn\'t in this document.';
      },
    },
    {
      name: 'fix_apply', kind: 'confirm',
      description: 'Propose applying one of an issue\'s own suggestions (from document_issues). The student sees the change first.',
      parameters: obj({ issueId: str('The issue\'s id'), suggestion: str('One of that issue\'s suggestions, copied exactly', 300) }, ['issueId', 'suggestion']),
      run: ({ issueId, suggestion }) => {
        const i = issueOf(bridge, issueId);
        return i && (i.suggestions || []).includes(suggestion) ? bridge.applyFix(issueId, suggestion) : { ok: false, error: 'Not one of that issue\'s suggestions.' };
      },
      summarize: ({ issueId, suggestion }) => {
        const i = issueOf(bridge, issueId);
        return i && (i.suggestions || []).includes(suggestion) ? `Change "${short(i.text, 120)}" to "${short(suggestion, 120)}".` : 'Apply a change that isn\'t one of the issue\'s suggestions.';
      },
    },
  ];
  // Adds them to a lib/ai/tools.js registry (its define checks each) → the tools as added.
  const register = (registry, bridge) => tools(bridge).map((t) => registry.add(t));
  return { LIMIT, tools, register, pages };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_TOOLS; else GZ_WRITER_TOOLS;
