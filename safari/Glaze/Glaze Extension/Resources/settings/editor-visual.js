// Settings' visual choices and paper sample. Bound controls keep their owners in options.html; the sample saves nothing.
var GZ_SETTINGS_VISUAL = globalThis.GZ_SETTINGS_VISUAL || (() => {
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  let settings, translate, paper, ruler, format;
  const render = (s) => {
    if (!settings) return;
    const w = s.writer;
    if (paper) {
      paper.dataset.format = w.format; paper.dataset.light = String(w.lightPage);
      paper.style.setProperty('--paper-zoom', w.zoom === 'fit' ? 1 : Math.min(1.5, Math.max(.75, w.zoom / 100)));
      ruler.hidden = !w.ruler;
      format.textContent = translate(GZ_CHOICES.FORMATS.find(([id]) => id === w.format)?.[1] || 'Blank');
    }
  };
  const mount = ({ t, settings: read }) => {
    settings = read; translate = t;
    // Native motion radios retain their names, labels and keyboard behavior.
    for (const slot of document.querySelectorAll('.motion-art')) slot.replaceChildren(GZ_CHOICES.motionArt(make));
    // One tab stop for the theme grid, with arrows/Home/End choosing and preserving focus through its redraw.
    document.getElementById('looks').addEventListener('keydown', (e) => {
      const all = [...e.currentTarget.querySelectorAll('.look')], at = all.indexOf(document.activeElement);
      if (at < 0) return;
      const cols = Math.max(1, all.filter((b) => b.offsetTop === all[0].offsetTop).length), rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
      const by = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: cols, ArrowUp: -cols, Home: -at, End: all.length - at - 1 }[e.key];
      if (by === undefined) return;
      e.preventDefault(); const b = all[Math.max(0, Math.min(all.length - 1, at + by))]; b.focus(); b.click();
    });
    ruler = make('div', { className: 'sample-ruler', textContent: '1     2     3     4     5     6' });
    format = make('span', { className: 'sample-format' });
    paper = make('article', { className: 'sample-paper' }, make('p', { className: 'sample-heading', textContent: t('Your paper') }),
      make('b', { className: 'sample-title', textContent: t('Title') }), ...Array.from({ length: 5 }, () => make('i', { className: 'sample-line' })));
    const sample = make('div', { className: 'setting-demo paper-demo' }, format, ruler, make('div', { className: 'sample-page' }, paper));
    sample.setAttribute('aria-hidden', 'true'); sample.dataset.settingDemo = 'paper';
    document.querySelector('[data-editor-section="writer/papers"] .section-heading').after(sample);
    // Connection settings stay in their existing, trusted sections, reachable together from School.
    const school = document.querySelector('[data-editor-section="backup/sites"]');
    const links = make('nav', { className: 'related-settings' }); links.setAttribute('aria-label', t('Connections'));
    for (const [route, label] of [['writer/papers', 'Google Drive'], ['sharing/calendar', 'Google Calendar sync'], ['ai/setup', 'AI']]) {
      const a = make('a', { href: `#${route}`, textContent: t(label) }); a.setAttribute('data-editor-alias', ''); links.append(a);
    }
    school.append(links);
    const connectionTargets = ['gdrive', 'sharing-calendar', 'ai'];
    const connections = () => [...links.children].forEach((a, i) => { a.hidden = document.getElementById(connectionTargets[i])?.hidden !== false; });
    const available = new MutationObserver(connections);
    for (const id of connectionTargets) available.observe(document.getElementById(id), { attributes: true, attributeFilter: ['hidden'] });
    connections();
    // Safari's first-run permissions flow is provided by its app, not welcome.html.
    const setup = document.querySelector('.settings-setup');
    setup.hidden = chrome.runtime.getManifest().host_permissions?.includes('<all_urls>') === true;
    render(settings());
  };
  return { mount, render };
})();
if (typeof module !== 'undefined') module.exports = GZ_SETTINGS_VISUAL;
