// Ultra's side of the synthetic assignment attempt (test/fixtures/ultra-writer-attempt.html) for the Writer checks
// (writer-submit-check.js, writer-kinds-check.js): Quill 1.3.7 over its box, its file area taking files at its root (input's
// change, or a drop), recording them and listing each after a moment, its footer's Save and Close and Submit disabled
// (Mui-style) while there's no text and no file, and recording clicks; a Submit click shows a stand-in confirmation.
// ?mode=: empty, noinput, gone, never, stuck (writer-submit-check.js says what each does). Served as /gz-check/harness.js.
const SUBMIT = '[data-analytics-id="assignment.attempt.authoring.footer.submit"]', SAVE = '[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]';
const HARNESS = `(() => {
  const mode = new URLSearchParams(location.search).get('mode') || '';
  const log = window.__log = []; window.__uploads = []; window.__clicks = []; window.__picker = 0;
  let q = null;
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id;
    c.innerHTML = '';
    q = new Quill(c, {});
    if (id) q.root.id = id;
    q.root.setAttribute('role', 'textbox');
    if (!mode.includes('empty') && /[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    window.__native = () => q.root.innerHTML;
    window.__text = () => q.getText();
  }
  for (const i of document.querySelectorAll('input[type=file]')) i.addEventListener('click', () => { window.__picker++; });
  document.addEventListener('click', (e) => { const b = e.target.closest('.footer button'); if (b) window.__clicks.push(b.getAttribute('analytics-id')); });
  const panel = document.querySelector('bb-assignment-attempt-authoring-panel');
  if (!panel) return;
  const style = document.createElement('style');
  style.textContent = '.Mui-disabled { pointer-events: none; }';
  document.head.append(style);
  const root = panel.firstElementChild, area = document.querySelector('[class*="makeStylessubmission-"]'), preview = area.querySelector('[class*="makeStylespreview-"]');
  if (mode.includes('gone')) preview.remove();
  if (mode.includes('noinput')) preview.querySelector('input').remove();
  const files = [];
  const footer = { save: document.querySelector('${SAVE}'), submit: document.querySelector('${SUBMIT}') };
  const state = () => {
    const on = !mode.includes('stuck') && (q.getText().trim().length > 0 || files.length > 0);
    for (const b of [footer.save, footer.submit]) { b.disabled = !on; b.classList.toggle('Mui-disabled', !on); b.tabIndex = on ? 0 : -1; }
  };
  q.on('text-change', state);
  state();
  const take = async (list, via) => {
    for (const f of list) { window.__uploads.push({ name: f.name, type: f.type, size: f.size, via, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }); log.push('upload'); }
    if (mode.includes('never')) return;
    setTimeout(() => {
      for (const f of list) {
        files.push(f);
        const row = document.createElement('div'), name = document.createElement('span');
        row.className = 'makeStylesfileRow-0-2-401'; name.className = 'makeStylesfileName-0-2-402'; name.textContent = f.name;
        row.append(name);
        (preview.isConnected ? preview : area).after(row);
      }
      log.push('row');
      state();
    }, 400);
  };
  root.addEventListener('change', (e) => { if (e.target.matches('input[type=file]')) take([...e.target.files], 'input'); });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', (e) => { if (e.target.closest('[class*="makeStylesinputContainer-"]')) { e.preventDefault(); take([...e.dataTransfer.files], 'drop'); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('footer button');
    if (!b) return;
    window.__clicks.push(b.getAttribute('data-analytics-id'));
    log.push('click:' + b.getAttribute('data-analytics-id'));
    if (b === footer.submit) { const d = document.createElement('div'); d.setAttribute('role', 'dialog'); d.id = 'ultra-confirm'; d.textContent = 'Submit this attempt?'; document.body.append(d); }
  });
})();`;

module.exports = HARNESS;
