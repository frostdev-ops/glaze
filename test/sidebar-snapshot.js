// Frozen legacy DOM snapshots use the pre-sidebar widget renderer (7860886e) on the shared page fixtures.
const snapshot = (p, selectors) => {
  const node = (e) => {
    if (!e.tagName) return e.textContent;
    const attrs = { ...e.attrs, ...(e.id && { id: e.id }), ...(e.className && { class: e.className }), ...(e.hidden && { hidden: '' }),
      ...Object.fromEntries(Object.entries(e.dataset).map(([k, v]) => ['data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), v])) };
    const style = Object.fromEntries(Object.entries(e.style).filter(([, v]) => typeof v !== 'function'));
    return [e.tagName, attrs, style, ...(e._html ? [e._html] : e.children.map(node))];
  };
  return { html: node({ ...p.doc.root, children: [], tagName: 'HTML' }), nodes: selectors.map((s) => [s, p.$(s) ? node(p.$(s)) : null]) };
};
module.exports = snapshot;
