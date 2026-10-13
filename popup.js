// Popup: the quick controls. Every change saves at once (the popup closes the moment focus
// leaves it, so a pending timer would die with it); the content script listens for the change.
const $ = (sel) => document.querySelector(sel);
// In the browser's language (lib/i18n.js).
GZ_I18N.page();
const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
const hint = (msg) => { $('#hint').textContent = msg || t('Changes apply to open Blackboard Ultra tabs immediately.'); $('#hint').classList.toggle('err', !!msg); };

GZ_UI.load().then((s) => {
  const save = (keys) => GZ_UI.save(s, keys, hint);

  const render = () => {
    GZ_UI.paint(s);
    $('#enabled').checked = s.enabled;
    document.body.classList.toggle('off', !s.enabled);
    // inert, not just dimmed: body.off alone leaves the controls reachable by keyboard.
    for (const sec of document.querySelectorAll('section:not(:last-of-type)')) sec.inert = !s.enabled;
    GZ_UI.swatches($('#presets'), s, (name, colors) => { save(GZ_UI.pickPreset(s, name, colors)); render(); });
    for (const r of document.querySelectorAll('[name=motion]')) r.checked = r.value === s.motion.level;
    if (s.auto.on) hint(t('Auto light/dark is on. Picking a palette turns it off.'));
  };

  $('#enabled').addEventListener('change', (e) => { s.enabled = e.target.checked; save(['enabled']); render(); });
  $('#motion').addEventListener('change', (e) => { s.motion.level = e.target.value; save(['motion']); });
  // openOptionsPage reuses an editor tab that is already open, but Chrome sometimes refuses it
  // ("Could not create an options page"); a plain tab always opens. Promise.resolve: not every
  // browser returns a promise here.
  $('#editor').addEventListener('click', () => {
    const tab = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    try { Promise.resolve(chrome.runtime.openOptionsPage()).catch(tab); } catch { tab(); }
  });
  GZ_NEWS.check((notes) => {
    if (!notes.length) return;
    $('#editor').classList.add('new');
    $('#editor').title = t('New in {version}', { version: notes[0][0] });
    $('#editor').setAttribute('aria-label', t('Open the editor (new in {version})', { version: notes[0][0] }));

  });
  render();
});
