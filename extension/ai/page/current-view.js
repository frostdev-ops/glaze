// Per-question page identity. Only explicit, rendered instruction roots contribute material; the page's full text never
// does. Writer's private binding is resolved by the worker against its live editor port, outside model context.
var GZ_ASK_CURRENT = globalThis.GZ_ASK_CURRENT || (() => {
  const LIMIT = 3072;
  const short = (s) => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const visible = (el) => {
    if (!el || !el.getClientRects?.().length || el.closest?.('[hidden], [aria-hidden="true"], [inert]')) return '';
    const style = getComputedStyle(el);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return '';
    // innerText is the rendered-text reader. A textContent fallback would include hidden descendants and answer keys.
    return typeof el.innerText === 'string' ? el.innerText.trim() : '';
  };
  const pin = () => globalThis.GZ_WRITER?.pinCurrent?.();
  const capture = () => {
    const X = globalThis.GZ_CTX, site = X?.site;
    if (!['canvas', 'ultra', 'moodle'].includes(site)) return {};
    let u;
    try { u = new URL(location.href); } catch { return {}; }
    if (!/^https?:$/.test(u.protocol)) return {};
    const path = u.pathname, current = { site, view: 'page', url: u.origin + path };
    const title = short(document.title);
    if (title) current.title = title;
    let root = '', blocked = false;
    if (site === 'canvas') {
      const course = X.canvasCourseId?.();
      if (/^\d{1,20}$/.test(course || '')) current.course = { id: course };
      blocked = /\/quizzes(?:\/|$)/.test(path) || !!document.querySelector('#quiz_show, #questions.assessment_questions, .quiz-taking');
      const assignment = /^\/courses\/\d+\/assignments\/(\d{1,20})(?:\/|$)/.exec(path);
      const discussion = /^\/courses\/\d+\/discussion_topics\/(\d{1,20})(?:\/|$)/.exec(path);
      const file = /^\/courses\/\d+\/files\/(\d{1,20})(?:\/|$)/.exec(path);
      if (!blocked && assignment) { current.view = 'assignment'; current.assignment = { id: assignment[1] }; root = '#assignment_show .description'; }
      else if (discussion) { current.view = 'discussion'; current.content = { id: discussion[1], kind: 'discussion' }; }
      else if (file) { current.view = 'content'; current.content = { id: file[1], kind: 'file' }; }
      else if (/^\/courses\/\d+\/pages\//.test(path)) current.view = 'content';
      else if (/^\/courses\/\d+\/?$/.test(path)) current.view = 'course';
      else if (path === '/') current.view = 'dashboard';
    } else if (site === 'ultra') {
      const course = X.courseId?.();
      if (/^_\d+_\d+$/.test(course || '') && course.length <= 40) current.course = { id: course };
      const assessment = /\/assessment\/(_\d+_\d+)(?:\/|$)/.exec(path);
      if (assessment) {
        // Shared assessment URLs and missing subtype never establish an assignment. The adapter checks the guarded
        // assignment authoring panel and gives test evidence precedence.
        const kind = globalThis.GZ_WRITER_ULTRA?.pageKind?.(document, null, assessment[1]) ||
          (document.querySelector('bb-attempt-canvas') ? 'test' : document.querySelector('bb-assignment-attempt-authoring-panel[ng-if="assessmentAttempt.contentData.courseContent.isAssignment()"]')?.querySelector('#bb-editorassignment-attempt-authoring-submission.ql-editor[contenteditable="true"]') ? 'assignment' : '');
        blocked = kind !== 'assignment';
        if (!blocked) { current.view = 'assignment'; current.assignment = { id: assessment[1] }; root = '#bb-editorassignment-attempt-authoring-instructions'; }
      } else {
        const discussion = /\/discussion\/(_\d+_\d+)(?:\/|$)/.exec(path);
        if (discussion) { current.view = 'discussion'; current.content = { id: discussion[1], kind: 'discussion' }; }
        else if (/^\/ultra\/courses\/_\d+_\d+\/(?:outline)?\/?$/.test(path)) current.view = 'course';
        else if (/^\/ultra\/course\/?$/.test(path)) current.view = 'dashboard';
      }
    }
    if (root && !blocked) {
      const text = visible(document.querySelector(root));
      if (text) current.material = { text: text.slice(0, LIMIT), source: 'instructions', truncated: text.length > LIMIT };
    }
    const writer = !blocked && globalThis.GZ_WRITER?.current?.();
    return { currentPage: u.href, current, ...(writer && { writer }) };
  };
  return { capture, pin };
})();
GZ_ASK_CURRENT;
