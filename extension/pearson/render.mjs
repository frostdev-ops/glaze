import { convertLatexToMarkup, convertLatexToMathMl, validateLatex } from '../vendor/mathlive/mathlive.mjs';

// The renderer's output stays inert, even if a site's LaTeX contains HTML, links, styles or resource commands.
const tags = new Set(['SPAN','svg','g','path','line','rect']);
const properties = new Set(['height','width','min-width','max-width','top','bottom','left','right','position','display','vertical-align',
  'margin-left','margin-right','margin-top','margin-bottom','padding-left','padding-right','font-size','font-style','font-weight','line-height',
  'border-top-width','border-bottom-width','border-left-width','border-right-width','box-sizing','transform','transform-origin']);
const bounded = (latex) => {
  if (typeof latex !== 'string' || latex.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(latex)
    || /\\(?:href|url|html\w*|class|css\w*|style|includegraphics|unicode|[gx]?def|(?:re)?newcommand|require|input|include|rule|[hv]space|m?kern|raise|lower)(?![a-zA-Z])/i.test(latex)) return false;
  if ((latex.match(/\\[a-zA-Z]+/g) || []).length > 128) return false;
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    if (latex[i] === '\\') { if (++i === latex.length) return false; continue; }
    if (latex[i] === '{' && ++depth > 32) return false;
    if (latex[i] === '}' && --depth < 0) return false;
  }
  return depth === 0;
};
export function render(latex) { try {
  if (!bounded(latex) || validateLatex(latex).length) return null;
  const markup = convertLatexToMarkup(latex, { displayMode: true });
  if (markup.length > 200000) return null;
  const template = document.createElement('template'); template.innerHTML = markup;
  if (template.content.querySelector('.ML__error')) return null;
  for (const node of template.content.querySelectorAll('*')) {
    if (!tags.has(node.tagName)) return null;
    for (const a of [...node.attributes]) {
      if (a.name === 'class' && a.value.split(/\s+/).every((v) => /^[\w-]+$/.test(v))) continue;
      if (a.name === 'style') {
        for (const p of [...node.style]) if (!properties.has(p) || /url|expression|[<>\\]/i.test(node.style.getPropertyValue(p))) node.style.removeProperty(p);
        continue;
      }
      if (['viewBox','viewbox','width','height','x','y','x1','x2','y1','y2','stroke-width'].includes(a.name) && /^[-+\d.eE\s,%]+$/.test(a.value)) continue;
      if (a.name === 'd' && /^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+$/.test(a.value)) continue;
      if (['fill','stroke'].includes(a.name) && ['none','currentColor'].includes(a.value)) continue;
      if (a.name === 'preserveAspectRatio' && /^[\w\s]+$/.test(a.value)) continue;
      node.removeAttribute(a.name);
    }
  }
  return template.content;
} catch { return null; } }

// Compare structure, not typography: redundant groups and scalable fences do not change a value.
// Keep each fraction/script/root argument separate. This deliberately refuses uncertain conversions.
export function signature(latex) { try {
  if (!bounded(latex) || validateLatex(latex).length) return null;
  const markup = convertLatexToMathMl(latex);
  if (markup.length > 200000) return null;
  const doc = new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML">${markup}</math>`, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const walk = (n) => {
    if (['annotation','annotation-xml'].includes(n.localName)) return [];
    const attrs = [...n.attributes].filter(a => !['xmlns','display','displaystyle','scriptlevel','stretchy','fence','separator'].includes(a.name))
      .map(a => [a.name,a.value]).sort((a,b) => a[0].localeCompare(b[0]));
    if (!attrs.length && ['math','mrow','mstyle','semantics'].includes(n.localName)) return [...n.children].flatMap(walk);
    if (['mi','mn','mo','mtext'].includes(n.localName)) {
      const value = n.textContent.replace(/[\u200b-\u200d\u2061\u2062\s]/g, '');
      return value ? [[n.localName, attrs, value]] : [];
    }
    if (n.localName === 'mspace') return [];
    return [[n.localName, attrs, [...n.children].map(walk)]];
  };
  return JSON.stringify(walk(doc.documentElement));
} catch { return null; } }
