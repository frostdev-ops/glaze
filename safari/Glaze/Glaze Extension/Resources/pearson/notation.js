// The notation shared by the local editor and its native Pearson adapter. No evaluation or simplification.
var GZ_PEARSON_NOTATION = globalThis.GZ_PEARSON_NOTATION || (() => {
  const MAX = 8192;
  const aliases = { dfrac: 'frac', tfrac: 'frac', leq: 'le', geq: 'ge', neq: 'ne', lvert: '|', rvert: '|' };
  const commands = new Set(('frac sqrt left right infty cup cap pi alpha beta gamma delta epsilon theta mu sigma lambda ' +
    'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln exp abs le ge ne lt gt cdot times div pm ' +
    'emptyset in notin subset subseteq supset supseteq prime circ degree vert mid').split(' '));
  const prepare = (value) => {
    if (typeof value !== 'string' || value.length > MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return null;
    // MathLive's presentation choices do not change the value sent to Pearson.
    let latex = value.replace(/\\(dfrac|tfrac|leq|geq|neq|lvert|rvert)(?![a-zA-Z])/g, (_, k) => aliases[k] === '|' ? '|' : `\\${aliases[k]}`)
      .replace(/\\[,;! ]/g, ' ').replace(/\\(?:displaystyle|textstyle)(?![a-zA-Z])/g, ' ').trim();
    if (/\\(?:placeholder|prompt)\b/.test(latex)) return null;
    const found = [...latex.matchAll(/\\([a-zA-Z]+|.)/g)];
    if (found.length > 128 || found.some((m) => !commands.has(m[1]) && !/^[{}|]$/.test(m[1]))) return null;
    let depth = 0;
    for (let i = 0; i < latex.length; i++) {
      if (latex[i] === '\\') { if (++i === latex.length) return null; continue; }
      if (latex[i] === '{' && ++depth > 32) return null;
      if (latex[i] === '}' && --depth < 0) return null;
    }
    if (depth) return null;
    if (/[#$%&]/.test(latex)) return null;
    return latex;
  };
  return { MAX, prepare };
})();
if (typeof module !== 'undefined') module.exports = GZ_PEARSON_NOTATION;
