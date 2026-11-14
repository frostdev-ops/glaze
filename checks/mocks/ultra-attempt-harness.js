// Ultra's side of the synthetic assignment attempt (test/fixtures/ultra-writer-attempt.html) for the Writer checks
// (writer-submit-check.js, writer-kinds-check.js): Quill 1.3.7 over its box, its file area taking files at its root (input's
// change, or a drop), recording them and listing each after a moment, its editor turned off (contenteditable false) from
// the upload until a moment after the listing, as live Ultra does while it saves the attempt's files (4001.4, 2026-11-14); its
// text saved a moment after each edit, the footer's status a spinner until "Last saved" is drawn anew; and a first save made
// by a file (no draft yet) redrawing the whole submission editor, Writer's frame with it, as live Ultra does; its footer's Save and Close and Submit disabled
// (Mui-style) while there's no text and no file, and recording clicks; a Submit click shows a stand-in confirmation.
// ?mode=: empty, noinput, gone, never, stuck (writer-submit-check.js says what each does). Served as /gz-check/harness.js.
const SUBMIT = '[data-analytics-id="assignment.attempt.authoring.footer.submit"]', SAVE = '[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]';
const HARNESS = `(() => {
  const mode = new URLSearchParams(location.search).get('mode') || '';
  const log = window.__log = []; window.__uploads = []; window.__clicks = []; window.__picker = 0;
  let q = null, draft = false;
  const mount = (c, html) => {
    const id = c.querySelector('.ql-editor')?.id;
    c.innerHTML = '';
    q = new Quill(c, {});
    if (id) q.root.id = id;
    q.root.setAttribute('role', 'textbox');
    if (/[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    window.__native = () => q.root.innerHTML;
    window.__text = () => q.getText();
  };
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const html = mode.includes('empty') ? '' : c.querySelector('.ql-editor').innerHTML;
    mount(c, html);
    draft = /[^\\s]/.test(html.replace(/<[^>]*>/g, ''));
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
  const status = document.querySelector('footer [class*="makeStylesstatus-"]');
  let saving = null;
  const save = () => {
    clearTimeout(saving);
    status.innerHTML = '<div role="status" aria-label="Saving"><div class="makeStylescircleContainer-0-2-259"></div></div>';
    saving = setTimeout(() => { draft = true; log.push('saved'); status.innerHTML = ''; const d = document.createElement('div'); d.setAttribute('role', 'status'); d.setAttribute('aria-live', 'polite'); d.textContent = 'Last saved ' + new Date().toLocaleTimeString(); status.append(d); }, 300);
  };
  const listen = () => q.on('text-change', (delta, old, source) => { state(); if (source === 'user') save(); });
  // Ultra's first save by a file: the submission editor drawn anew (its frame, Writer's, gone with the old one).
  const redraw = () => {
    const wrap = q.root.closest('.bb-editor-wrapper'), html = q.root.innerHTML, fresh = wrap.cloneNode(true);
    for (const f of fresh.querySelectorAll('iframe')) f.remove();
    for (const e of fresh.querySelectorAll('[data-gz-writer], [data-gz-writer-id]')) { e.removeAttribute('data-gz-writer'); e.removeAttribute('data-gz-writer-id'); }
    wrap.replaceWith(fresh);
    mount(fresh.querySelector('.ql-container'), html);
    listen();
    log.push('redrawn');
  };
  listen();
  state();
  const take = async (list, via) => {
    for (const f of list) { window.__uploads.push({ name: f.name, type: f.type, size: f.size, via, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }); log.push('upload'); }
    if (!draft && !files.length) { draft = true; redraw(); }
    q.disable(); log.push('disabled');
    const enable = (ms) => setTimeout(() => { q.enable(); log.push('enabled'); }, ms);
    if (mode.includes('never')) { enable(750); return; }
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
      enable(300);
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
