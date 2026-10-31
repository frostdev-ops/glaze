// Small DOM surface for the PDF panels' asynchronous lifecycle tests. No layout or rendering is simulated.
class Element extends EventTarget {
  constructor(tag) { super(); this.tagName = tag; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.attrs = {}; this.value = ''; this.files = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...xs) { for (const x of xs.flat()) if (x && typeof x === 'object') { x.remove?.(); this.children.push(x); x.parentElement = this; } }
  replaceChildren(...xs) { for (const c of [...this.children]) c.remove(); this.append(...xs); }
  remove() { if (this.parentElement) { const p = this.parentElement; p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
  get childElementCount() { return this.children.length; }
  querySelectorAll(selector) {
    const out = [], attr = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    for (const c of this.children) {
      if (attr ? c.getAttribute(attr[1]) === attr[2] : selector[0] === '.' ? c.className?.split(' ').includes(selector.slice(1)) : c.tagName === selector) out.push(c);
      out.push(...c.querySelectorAll(selector));
    }
    return out;
  }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  focus() {}
  click() { this.dispatchEvent(new Event('click')); }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Event('close')); }
}
const h = (tag, props = {}, ...kids) => {
  const e = new Element(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'hidden' || k === 'disabled') e[k] = true;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids); return e;
};
const btn = (p, ...kids) => h('button', p, ...kids);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(setImmediate);
const install = (t) => {
  const doc = { createElementNS: (_, tag) => new Element(tag), body: h('body') };
  const prior = { document: global.document, IntersectionObserver: global.IntersectionObserver };
  global.document = doc;
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  t.after(() => { for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete global[k]; else global[k] = v; } });
  return doc;
};
module.exports = { Element, h, btn, deferred, tick, install };
