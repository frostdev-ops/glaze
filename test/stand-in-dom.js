// A small stand-in for the DOM, for the tests that run a feature's page code in a VM (notes-ui, ultra-panel): elements
// with children, attributes, simple selectors and listeners; doc.fire dispatches like the DOM (capture, then bubbling).
// No tests here.
// Simple selectors only: tag (a custom element's too), #id, .class and [attr], [attr="v"] or [attr*="v"] compounds, joined by spaces or > (both as descendant).
const one = (el, part) => {
  const m = part.match(/^([a-z0-9]+(?:-[a-z0-9]+)*|\*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/i);
  if (!m || !el.tagName || (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase())) return false;
  return (m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || []).every((x) => {
    if (x[0] === '#') return el.id === x.slice(1);
    if (x[0] === '.') return String(el.className).split(/\s+/).includes(x.slice(1));
    const [, k, star, v] = x.match(/^\[([\w-]+)(?:(\*?)="([^"]*)")?\]$/);
    const a = el.getAttribute(k);
    return a != null && (v == null || (star ? a.includes(v) : a === v));
  });
};
const matches = (el, sel) => sel.split(',').some((alt) => {
  const parts = alt.trim().split(/\s*>\s*|\s+/);
  if (!one(el, parts.at(-1))) return false;
  let i = parts.length - 2;
  for (let p = el.parentNode; i >= 0 && p; p = p.parentNode) if (one(p, parts[i])) i--;
  return i < 0;
});
// An element's style: its properties as set (left, top…), and custom properties through setProperty.
const style = () => ({ setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] ?? ''; }, removeProperty(k) { delete this[k]; } });
const camel = (k) => k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class El {
  constructor(tag, doc) { Object.assign(this, { tagName: tag.toUpperCase(), doc, children: [], parentNode: null, attrs: {}, dataset: {}, listeners: [], className: '', id: '', hidden: false, _html: '', style: style() }); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.root; }
  kids(list) { return list.filter((k) => k != null && k !== false).map((k) => (k instanceof El ? k : { nodeType: 3, textContent: String(k) })); }
  adopt(k) { if (k instanceof El && k.parentNode) k.parentNode.children.splice(k.parentNode.children.indexOf(k), 1); k.parentNode = this; return k; }
  append(...k) { for (const x of this.kids(k)) this.children.push(this.adopt(x)); }
  prepend(...k) { this.children.unshift(...this.kids(k).map((x) => this.adopt(x))); }
  replaceChildren(...k) { for (const c of this.children) c.parentNode = null; this.children = []; this._html = ''; this.append(...k); }
  after(x) { const p = this.parentNode, k = this.kids([x])[0]; p.adopt(k); p.children.splice(p.children.indexOf(this) + 1, 0, k); }
  before(x) { const p = this.parentNode, k = this.kids([x])[0]; p.adopt(k); p.children.splice(p.children.indexOf(this), 0, k); }
  get parentElement() { return this.parentNode instanceof El ? this.parentNode : null; }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  replaceWith(...k) { const p = this.parentNode, at = p.children.indexOf(this); this.remove(); p.children.splice(at, 0, ...this.kids(k).map((x) => p.adopt(x))); }
  get previousElementSibling() { const s = this.parentNode?.children || []; return s.slice(0, s.indexOf(this)).filter((x) => x instanceof El).at(-1) || null; }
  get lastChild() { return this.children.at(-1) || null; }
  get firstElementChild() { return this.children.find((x) => x instanceof El) || null; }
  get lastElementChild() { return this.children.filter((x) => x instanceof El).at(-1) || null; }
  get nextElementSibling() { const s = this.parentNode?.children || []; return s.slice(s.indexOf(this) + 1).find((x) => x instanceof El) || null; }
  toggleAttribute(k, on) { if (on ?? !this.hasAttribute(k)) this.setAttribute(k, ''); else this.removeAttribute(k); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = String(v); else if (k.startsWith('data-')) this.dataset[camel(k)] = String(v); else this.attrs[k] = String(v); }
  getAttribute(k) { if (k === 'id') return this.id || null; if (k === 'class') return this.className || null; if (k === 'hidden') return this.hidden ? '' : null; if (k.startsWith('data-')) return this.dataset[camel(k)] ?? null; return this.attrs[k] ?? null; }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  removeAttribute(k) { if (k === 'style') this.style = style(); if (k.startsWith('data-')) delete this.dataset[camel(k)]; else delete this.attrs[k]; }
  get textContent() { return this._html ? this._html.replace(/<[^>]*>/g, '') : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) ? [String(v)] : [])); }
  get innerHTML() { return this._html || this.children.map((c) => (c instanceof El ? `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>` : c.textContent)).join(''); }
  set innerHTML(v) { this.replaceChildren(); this._html = String(v); }
  get value() { return this.tagName === 'SELECT' ? (this._value ?? (this.children.find((o) => o.selected) || this.children[0])?.value ?? '') : this._value ?? ''; }
  set value(v) { this._value = v; }
  cloneNode() { const c = new El(this.tagName, this.doc); c._html = this.innerHTML; return c; }
  all() { return this.children.filter((c) => c instanceof El).flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let p = this; p && p.tagName; p = p.parentNode) if (matches(p, sel)) return p; return null; }
  contains(e) { for (let p = e; p; p = p.parentNode) if (p === this) return true; return false; }
  addEventListener(type, f, capture) { this.listeners.push({ type, f, capture: !!capture }); }
  removeEventListener(type, f) { this.listeners = this.listeners.filter((l) => l.type !== type || l.f !== f); }
  dispatchEvent(ev) { for (const l of this.listeners.filter((x) => x.type === ev.type)) l.f(ev); return true; }
  focus() { this.doc.activeElement = this; }
  scrollIntoView() {}
  click() { this.doc.fire(this, 'click', { trusted: false }); }
  show() { this.open = true; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); }
  // A test can give an element a box ({ left, top, width, height }), or the document a boxOf(el) that lays elements out;
  // without either, every element is the same small box.
  get layoutBox() { return this.box || this.doc.boxOf?.(this) || null; }
  getBoundingClientRect() { const b = this.layoutBox; return b ? { ...b, right: b.left + b.width, bottom: b.top + b.height } : { left: 0, right: 100, top: 0, bottom: 20 }; }
  get clientWidth() { return this.layoutBox?.width ?? 0; }
  get clientHeight() { return this.layoutBox?.height ?? 0; }
  get offsetWidth() { return this.layoutBox?.width ?? 0; }
  get offsetHeight() { return this.layoutBox?.height ?? 0; }
  get scrollHeight() { return this.layoutBox?.height ?? 0; }
  setPointerCapture() {}
  // A shadow root as a child list; tests reach a closed one through shadowForTest, as a page script cannot.
  attachShadow({ mode }) { const r = new El('#shadow-root', this.doc); r.host = this; this.shadowForTest = r; if (mode === 'open') this.shadowRoot = r; return r; }
}
module.exports = { El, matches };
