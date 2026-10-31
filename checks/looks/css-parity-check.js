// A selector rewrite changes no match and no look: each site's sheets as they ship, against the same sheets at PARITY_BASE (a
// git revision), on every saved Ultra, Canvas and Moodle page in test/fixtures, under Glaze's default <html> attributes and a
// second set that turns on its other modes. Rules pair by position (a rewrite keeps every rule where it was); a pair whose
// selectors differ must match the same elements (each pseudo-element's part on its own), and every element and its
// ::before/::after must compute the same style, and each page must draw the same pixels. Pages only: no extension, no network.
//   PARITY_BASE=<rev> NODE_PATH=<playwright> node checks/looks/css-parity-check.js [report folder]
// PARITY_BREAK=1 drops one selector from the first rewritten rule: the check must then fail.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const base = process.env.PARITY_BASE;
if (!base) throw Error('Set PARITY_BASE to the revision the sheets must match.');
const out = path.resolve(process.argv[2] || path.join(require('node:os').tmpdir(), 'glaze-css-parity'));
const chromeLaunch = require('../../tools/dev/check-env.js').chromeLaunch();
// Each site's sheets in the order content/content.js adopts them, then the two a Look's nav layout and parts add
// (navigation/page/nav.js, looks/page/rules.js).
const LATER = ['navigation/page/navlayout.css', 'looks/page/rules.css'];
const SITES = {
  ultra: ['content/theme.css', 'content/motion.css', 'content/extras.css', 'core/page/apps.css', 'navigation/page/coursetabs.css', 'navigation/page/sidebar.css', 'looks/page/surfaces.css', ...LATER],
  canvas: ['content/canvas.css', 'content/motion.css', 'core/page/apps.css', 'navigation/page/coursetabs.css', 'navigation/page/sidebar.css', 'looks/page/surfaces.css', ...LATER],
  moodle: ['content/moodle.css', 'content/motion.css', 'looks/page/surfaces.css', ...LATER],
};
const now = (f) => fs.readFileSync(path.join(root, 'extension', f), 'utf8');
const shown = {}, then = (f) => (shown[f] ??= execFileSync('git', ['show', `${base}:extension/${f}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }));
const fixtures = fs.readdirSync(path.join(root, 'test/fixtures')).filter((f) => /^(ultra|canvas|moodle)-.*\.html$/.test(f)).sort();
// Glaze's attributes on <html> as it sets them with its defaults on Ultra (test/fixtures/ultra-glaze-outline.html), and a
// set with its other modes on: a picture background, the sidebar open beside the page, icon-only nav, mono code, expressive motion.
const DEFAULTS = fs.readFileSync(path.join(root, 'test/fixtures/ultra-glaze-outline.html'), 'utf8').match(/<html([^>]*)>/)[1];
const OTHER = { 'data-gz-nav-place': 'top', 'data-gz-nav-iconed': '', 'data-gz-bg': 'image', 'data-gz-sidebar': 'expanded', 'data-gz-sb-fixed': '', 'data-gz-nav-labels': 'icons', 'data-gz-font-mono': '', 'data-gz-motion': 'expressive',
  'data-gz-ctabs': 'between page', 'data-gz-instant': '', 'data-gz-navbar': 'top', 'data-gz-light-theme': '', 'data-gz-sb-family': 'discussion', 'data-gz-nav-footer-hidden': '' };

// In the page: rules flattened in order, each style rule's selector parts grouped by the pseudo-element they end in.
function inPage() {
  const split = (text) => { const parts = []; let depth = 0, q = null, start = 0; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; } if (c === '\\') { i++; continue; } if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; else if (c === ',' && !depth) { parts.push(text.slice(start, i).trim()); start = i + 1; } } parts.push(text.slice(start).trim()); return parts; };
  const flat = (rules, nested, acc = []) => { for (const r of rules) { if (r instanceof CSSStyleRule) acc.push({ rule: r, nested }); if (r.cssRules && !(r instanceof CSSKeyframesRule)) flat(r.cssRules, nested || r instanceof CSSStyleRule, acc); } return acc; };
  const PE = /(::?(before|after|backdrop|selection|placeholder|marker|first-line|first-letter|file-selector-button)|::[-\w]+(\([^)]*\))?)$/;
  window.__parity = {
    rules: (set) => [...document.querySelectorAll(`style[data-set="${set}"]`)].map((s) => flat(s.sheet.cssRules, false)),
    groups: (selectorText) => { const g = {}; for (const p of split(selectorText)) { const m = p.match(PE); const pe = m ? m[0] : ''; (g[pe] ||= []).push(m ? p.slice(0, -pe.length) || '*' : p); } return g; },
    use: (set) => { for (const s of document.querySelectorAll('style[data-set]')) s.sheet.disabled = s.dataset.set !== set; },
    style: (el, pe) => { const cs = getComputedStyle(el, pe); let t = ''; for (let i = 0; i < cs.length; i++) t += `${cs[i]}:${cs.getPropertyValue(cs[i])};`; return t; },
  };
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const report = { base, fixtures: [], failures: [] };
  await require('../../tools/dev/wait-for-browser.js')();
  const browser = await chromium.launch({ ...chromeLaunch, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    let body = '';
    await page.route('**/*', (r) => (r.request().url() === 'https://parity.test/' ? r.fulfill({ contentType: 'text/html', body }) : r.abort()));
    for (const fixture of fixtures) {
      const site = fixture.split('-')[0], sheets = SITES[site];
      let html = fs.readFileSync(path.join(root, 'test/fixtures', fixture), 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '');
      const style = (set, f, css) => `<style data-set="${set}" data-src="${f}">${css.replace(/<\/style/gi, '<\\/style')}</style>`;
      let fresh = sheets.map(now);
      if (process.env.PARITY_BREAK) fresh = fresh.map((css, i) => (i ? css : css.replace(/,\n(#site-wrap :where\(\.course-status\)),/, ',')));
      const styles = sheets.map((f, i) => style('base', f, then(f)) + style('head', f, fresh[i])).join('');
      html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${styles}</head>`) : styles + html;
      for (const [variant, attrs] of [['defaults', null], ['other', OTHER]]) {
        // The page's own attributes on <html> first (a repeated name keeps the first), then Glaze's.
        body = /<html\b/i.test(html) ? html.replace(/<html\b([^>]*)>/i, (_, own) => `<html${own}${DEFAULTS}>`) : `<html${DEFAULTS}>${html}`;
        await page.goto('https://parity.test/');
        await page.addScriptTag({ content: `(${inPage})()` });
        if (attrs) await page.evaluate((a) => { for (const [k, v] of Object.entries(a)) document.documentElement.setAttribute(k, v); }, attrs);
        const row = { fixture, variant, elements: 0, pairs: 0, rewritten: 0, styles: 0 };
        // Matches, rule by rule.
        const matchDiffs = await page.evaluate(() => {
          const P = window.__parity, [a, b] = [P.rules('base'), P.rules('head')], diffs = [], all = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
          let pairs = 0, rewritten = 0;
          a.forEach((list, s) => {
            if (list.length !== b[s].length) { diffs.push(`sheet ${s}: ${list.length} rules, now ${b[s].length}`); return; }
            list.forEach(({ rule, nested }, i) => {
              pairs++;
              const r2 = b[s][i].rule;
              if (rule.style.cssText !== r2.style.cssText) diffs.push(`sheet ${s} rule ${i}: declarations differ`);
              if (rule.selectorText === r2.selectorText) return;
              rewritten++;
              if (nested) { diffs.push(`sheet ${s} rule ${i}: nested selector changed`); return; }
              const g1 = P.groups(rule.selectorText), g2 = P.groups(r2.selectorText);
              if (Object.keys(g1).sort().join() !== Object.keys(g2).sort().join()) { diffs.push(`${rule.selectorText} → ${r2.selectorText}: pseudo-elements differ`); return; }
              for (const pe of Object.keys(g1)) {
                const s1 = g1[pe].join(', '), s2 = g2[pe].join(', ');
                for (const el of all) {
                  let m1, m2;
                  try { m1 = el.matches(s1); m2 = el.matches(s2); } catch (e) { diffs.push(`${s1}: ${e.message}`); return; }
                  if (m1 !== m2) { diffs.push(`${s1}${pe} → ${s2}${pe}: ${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')} ${m1 ? 'no longer matches' : 'now matches'}`); break; }
                }
              }
            });
          });
          return { diffs, pairs, rewritten, elements: all.length };
        });
        Object.assign(row, { elements: matchDiffs.elements, pairs: matchDiffs.pairs, rewritten: matchDiffs.rewritten });
        for (const d of matchDiffs.diffs) report.failures.push(`${fixture} (${variant}) match: ${d}`);
        // Matches alone cannot prove cascade specificity: compare styles and pixels in both attribute modes.
        const styles = async (set) => {
          await page.evaluate((x) => window.__parity.use(x), set);
          return page.evaluate(() => [document.documentElement, ...document.documentElement.querySelectorAll('*')].map((el) => {
            const P = window.__parity, own = P.style(el, null), pseudo = ['::before', '::after'].map((pe) => { const c = getComputedStyle(el, pe).content; return c && c !== 'none' && c !== 'normal' ? P.style(el, pe) : ''; });
            return [own, ...pseudo];
          }));
        };
        const s1 = await styles('base'), shot1 = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
        const s2 = await styles('head'), shot2 = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
        row.styles = s1.length;
        const firstDiff = s1.findIndex((x, i) => x.join('|') !== s2[i]?.join('|'));
        if (s1.length !== s2.length || firstDiff >= 0) {
          const at = firstDiff >= 0 ? firstDiff : Math.min(s1.length, s2.length);
          const props = (t) => Object.fromEntries((t || '').split(';').filter(Boolean).map((d) => [d.slice(0, d.indexOf(':')), d.slice(d.indexOf(':') + 1)]));
          const k = [0, 1, 2].find((j) => s1[at]?.[j] !== s2[at]?.[j]), p1 = props(s1[at]?.[k]), p2 = props(s2[at]?.[k]);
          const changed = Object.keys({ ...p1, ...p2 }).filter((p) => p1[p] !== p2[p]).slice(0, 5).map((p) => `${p}: ${p1[p]} → ${p2[p]}`);
          report.failures.push(`${fixture} (${variant}) style: element ${at}${['', '::before', '::after'][k] ?? ''} ${changed.join('; ')}`);
        }
        // A page that draws differently twice with the same sheets (a blurred edge's anti-aliasing) proves nothing by pixels:
        // it is listed, and its computed styles above stand.
        if (!shot1.equals(shot2)) {
          await styles('base');
          const again = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
          if (again.equals(shot1)) { report.failures.push(`${fixture} (${variant}) pixels differ`); fs.writeFileSync(path.join(out, `${fixture}-${variant}-base.png`), shot1); fs.writeFileSync(path.join(out, `${fixture}-${variant}-head.png`), shot2); }
          else if (!again.equals(shot2)) (report.unstable ||= []).push(fixture);
        }
        report.fixtures.push(row);
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'css-parity.json'), JSON.stringify(report, null, 1));
  const total = (k) => report.fixtures.reduce((n, r) => n + r[k], 0);
  console.log(JSON.stringify({ base, pages: fixtures.length, runs: report.fixtures.length, elements: total('elements'), rulePairs: total('pairs'), rewrittenPairs: total('rewritten'), styledElements: total('styles'), unstablePixels: report.unstable || [], failures: report.failures.length }));
  for (const f of report.failures.slice(0, 40)) console.log(f);
  if (report.failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
