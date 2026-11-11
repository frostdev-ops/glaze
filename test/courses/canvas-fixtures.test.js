// Canvas HTML fixtures (test/fixtures/canvas-*.html): Canvas pages as the student sees them, captured with Glaze off by
// `tools/dev/canvas-shots.js --settings '{enabled:false}' --html test/fixtures name=/path ...`. These tests keep them safe to commit and keep them honest: every class, id and attribute Glaze's
// Canvas code and canvas.css key on must still be found in one, so when a reseed or a Canvas update drops a selector,
// this fails instead of a page quietly losing its theme.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '../fixtures');
const fixtures = fs.readdirSync(dir).filter((f) => /^canvas-.*\.html$/.test(f)).map((f) => ({ f, html: fs.readFileSync(path.join(dir, f), 'utf8') }));
// The DocViewer frame is Instructure's canvadocs app on its own host, not a Canvas page.
const pages = fixtures.filter(({ f }) => f !== 'canvas-docviewer.html');

test('the fixtures are safe to commit: no code, no session, no tokens, Glaze off, small', () => {
  assert.ok(pages.length >= 10, 'the Canvas page fixtures are missing');
  for (const { f, html } of fixtures) {
    assert.match(html, /^<!-- Glaze test fixture: /, `${f}: starts with its provenance note`);
    assert.ok(Buffer.byteLength(html) <= 160 * 1024, `${f}: ${Buffer.byteLength(html)} bytes, over 160 KB`);
    assert.doesNotMatch(html, /<script\b[^>]*>[^<]/, `${f}: a script still has a body`);
    assert.doesNotMatch(html, /<meta[^>]+name="csrf/i, `${f}: the CSRF meta tag is still there`);
    assert.doesNotMatch(html, /eyJ[\w-]{8,}\.[\w-]{8,}\./, `${f}: an unredacted JWT`);
    // A secret parameter's value is the placeholder exactly: nothing of the original may follow it.
    assert.doesNotMatch(html, /(?:[?&]|%3F|%26)(?:amp;)?(?:verifier|sf_verifier|access_token|token|session_token|authenticity_token|_csrf_token|sesskey|logintoken|api_key|key|code|client_secret|x-amz-signature|x-amz-credential|x-amz-security-token|policy|signature|key-pair-id)(?:=|%3D)(?!REDACTED(?:[&"'\s<#]|%26|$))/i, `${f}: an unredacted token, key, code, signature or file verifier`);
    assert.doesNotMatch(html, /"sesskey"\s*:\s*"(?!REDACTED")[^"]/, `${f}: Moodle's session key in M.cfg`);
    assert.doesNotMatch(html, /"(?:email|login_id|sis_user_id)"\s*:\s*(?:"(?!REDACTED")[^"]|\d)/, `${f}: the signed-in student's email or ids in ENV`);
    assert.doesNotMatch(html, /\bBearer\s+(?!REDACTED\b)[\w.~+/=-]{8,}/, `${f}: a bearer token`);
    assert.doesNotMatch(html, /(?:\/|%2F)feeds(?:\/|%2F)[\w-]+(?:\/|%2F)(?!REDACTED(?:\.|%2E|["'\s<?#&]|$))/i, `${f}: a feed address with its code`);
    assert.doesNotMatch(html, /_normandy_session|canvas_session|_csrf_token=|pseudonym_session\[|"csrf_token"|login_session/i, `${f}: a session or CSRF id`);
    assert.doesNotMatch(html, /name="authenticity_token"[^>]*value="(?!REDACTED")[^"]/, `${f}: a form still carries its authenticity token`);
    assert.doesNotMatch(html, /\sdata-gz-|\sid="gz-/, `${f}: captured with Glaze on`);
  }
});

test('the DocViewer fixture is structure only: no code, styles, or anyone else\'s addresses and text', () => {
  const html = fixtures.find(({ f }) => f === 'canvas-docviewer.html').html;
  assert.doesNotMatch(html, /<(script|style|link)\b/i);
  assert.doesNotMatch(html, /\sstyle="/i);
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) assert.match(url, /^https:\/\/example\.com\//, url);
  assert.ok(Buffer.byteLength(html) < 12 * 1024, 'hand-written, so small');
});

test('every Canvas page fixture carries the marker Glaze detects Canvas by', () => {
  for (const { f, html } of pages) {
    const head = html.slice(0, html.indexOf('<body'));
    assert.match(head, /<link[^>]+rel="stylesheet"[^>]+href="[^"]*\/dist\/brandable_css\//, `${f}: no brandable_css stylesheet in <head> (content.js and content/detect.js look for it)`);
    assert.match(html, /<div id="application" class="ic-app/, `${f}: no #application.ic-app wrapper`);
  }
});

test('the capture scrubber takes whole secrets out, wherever they sit', () => {
  const { redact } = require('../../tools/dev/redact.js');
  const cases = [
    ['/files/1/download?verifier=abc123&x=1', '/files/1/download?verifier=REDACTED&x=1'],
    ['/?token=first%2Fsecond', '/?token=REDACTED'],
    // In a plain query an encoded & is part of the value; only inside an encoded URL does it separate parameters.
    ['/?token=first%26second%3Dtail', '/?token=REDACTED'],
    ['/?token=a%26b&next=1', '/?token=REDACTED&next=1'],
    ['<a href="/x?amp;access_token=a.b-c">', '<a href="/x?amp;access_token=REDACTED">'],
    ['url=http%3A%2F%2Fh%2Ff%3Fverifier%3DSECRET%2Fx%26y%3D1', 'url=http%3A%2F%2Fh%2Ff%3Fverifier%3DREDACTED%26y%3D1'],
    ['href="http://h/feeds/calendars/user_AbC123xyz.ics"', 'href="http://h/feeds/calendars/REDACTED.ics"'],
    ['value="/feeds/announcements/enrollment_Q9z.atom"', 'value="/feeds/announcements/REDACTED.atom"'],
    ['%2Ffeeds%2Fusers%2Fuser_Q9z%2Eatom', '%2Ffeeds%2Fusers%2FREDACTED%2Eatom'],
    ['/feeds/forums/course_abc', '/feeds/forums/REDACTED'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-nat_ure', 'REDACTED_JWT'],
  ];
  for (const [raw, want] of cases) assert.equal(redact(raw), want, raw);
  for (const [, want] of cases) assert.equal(redact(want), want, `idempotent: ${want}`);
});

test('the capture scrubber also takes out discussion feed codes, CSRF and session keys, the student\'s identity, signed-URL and API secrets, and bearer tokens', () => {
  const { redact } = require('../../tools/dev/redact.js');
  const cases = [
    // A topic's feed address holds the topic id, then the enrollment code: the code goes, the id stays.
    ['href="/feeds/topics/1234/enrollment_Q9zAbC.atom"', 'href="/feeds/topics/1234/REDACTED.atom"'],
    ['%2Ffeeds%2Ftopics%2F1234%2Fenrollment_Q9zAbC%2Eatom', '%2Ffeeds%2Ftopics%2F1234%2FREDACTED%2Eatom'],
    ['/feeds/topics/1234/enrollment_Q9zAbC.rss', '/feeds/topics/1234/REDACTED.rss'],
    ['/feeds/topics/1234/user_Q9zAbC.atom', '/feeds/topics/1234/REDACTED.atom'],
    ['/feeds/topics/1234.atom', '/feeds/topics/REDACTED.atom'],
    // The CSRF token in the page head and in forms, whichever way round the attributes are written.
    ['<meta name="csrf-token" content="a1b2+c3/d4==">', '<meta name="csrf-token" content="REDACTED">'],
    ['<meta content="a1b2+c3/d4==" name="csrf-token" />', '<meta content="REDACTED" name="csrf-token" />'],
    ['<meta name="csrf-param" content="authenticity_token">', '<meta name="csrf-param" content="authenticity_token">'],
    ['<meta name="viewport" content="width=device-width">', '<meta name="viewport" content="width=device-width">'],
    ['<input type="hidden" name="authenticity_token" value="Zm9vYmFy+/==" autocomplete="off" />', '<input type="hidden" name="authenticity_token" value="REDACTED" autocomplete="off" />'],
    ['<input value="Zm9vYmFy" type="hidden" name="authenticity_token">', '<input value="REDACTED" type="hidden" name="authenticity_token">'],
    ['<input type="hidden" name="authenticity_token" value="" autocomplete="off">', '<input type="hidden" name="authenticity_token" value="" autocomplete="off">'],
    ['<input type="hidden" name="utf8" value="\u2713">', '<input type="hidden" name="utf8" value="\u2713">'],
    // Moodle's page configuration.
    ['M.cfg = {"wwwroot":"http:\\/\\/h","sesskey":"AbC123xyz","themerev":"-1"};', 'M.cfg = {"wwwroot":"http:\\/\\/h","sesskey":"REDACTED","themerev":"-1"};'],
    // Canvas's ENV.current_user.
    ['"current_user":{"id":"7","display_name":"Sam","email":"sam@school.edu","login_id":"sam01","sis_user_id":"S-4421","avatar_image_url":"/a.png"}',
      '"current_user":{"id":"7","display_name":"Sam","email":"REDACTED","login_id":"REDACTED","sis_user_id":"REDACTED","avatar_image_url":"/a.png"}'],
    ['"sis_user_id":4421,"email":null', '"sis_user_id":"REDACTED","email":null'],
    // Signed URLs: S3 and CloudFront.
    ['https://b.s3.amazonaws.com/f?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260101T000000Z&X-Amz-Signature=deadbeef0123&X-Amz-Security-Token=IQoJb3',
      'https://b.s3.amazonaws.com/f?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=REDACTED&X-Amz-Date=20260101T000000Z&X-Amz-Signature=REDACTED&X-Amz-Security-Token=REDACTED'],
    ['href="https://d1.cloudfront.net/f.pdf?Policy=eyJTdGF0ZW1lbnQiOltdfQ__&amp;Signature=ab~cd-ef_&amp;Key-Pair-Id=APKAEXAMPLE"',
      'href="https://d1.cloudfront.net/f.pdf?Policy=REDACTED&amp;Signature=REDACTED&amp;Key-Pair-Id=REDACTED"'],
    ['url=https%3A%2F%2Fb.s3.amazonaws.com%2Ff%3Fx%3D1%26X-Amz-Signature%3Ddeadbeef%26y%3D2', 'url=https%3A%2F%2Fb.s3.amazonaws.com%2Ff%3Fx%3D1%26X-Amz-Signature%3DREDACTED%26y%3D2'],
    // API keys, OAuth codes and client secrets.
    ['/api?api_key=AIzaSy123&key=k-1&code=4%2F0AbC&client_secret=s3cr3t&state=ok', '/api?api_key=REDACTED&key=REDACTED&code=REDACTED&client_secret=REDACTED&state=ok'],
    ['<a href="/login/oauth2/callback?code=abc123&amp;state=x">', '<a href="/login/oauth2/callback?code=REDACTED&amp;state=x">'],
    ['url=http%3A%2F%2Fh%2Ff%3Fkey%3DSECRET%26y%3D1', 'url=http%3A%2F%2Fh%2Ff%3Fkey%3DREDACTED%26y%3D1'],
    ['/search?keyword=x&codeblock=1&course_code=BIO&keys=1', '/search?keyword=x&codeblock=1&course_code=BIO&keys=1'],
    // Bearer tokens in a header dump or JSON.
    ['Authorization: Bearer abc.def-ghi_123~+/=', 'Authorization: Bearer REDACTED'],
    ['{"Authorization":"Bearer 1~AbCdEfGh1234567890"}', '{"Authorization":"Bearer REDACTED"}'],
  ];
  for (const [raw, want] of cases) assert.equal(redact(raw), want, raw);
  for (const [, want] of cases) assert.equal(redact(want), want, `idempotent: ${want}`);
});

test('a fixture is scrubbed whole, its provenance note included', () => {
  const { fixture } = require('../../tools/dev/redact.js');
  const out = fixture('/courses/1/files/2/download?verifier=SECRET1', '<html><a href="/x?token=SECRET2">x</a></html>');
  assert.match(out, /^<!-- Glaze test fixture: \/courses\/1\/files\/2\/download\?verifier=REDACTED /);
  assert.doesNotMatch(out, /SECRET/);
});

test('the scrubber removes complete JSON strings even when the identity contains escaped quotes', () => {
  const { redact } = require('../../tools/dev/redact.js');
  const raw = JSON.stringify({ current_user: { email: '"sam.private"@school.edu', login_id: 'sam"private', sis_user_id: 'id\\"private' } });
  const want = JSON.stringify({ current_user: { email: 'REDACTED', login_id: 'REDACTED', sis_user_id: 'REDACTED' } });
  assert.equal(redact(raw), want);
  assert.equal(redact(want), want);
});

test('CSRF redaction reads the real HTML attributes and preserves unrelated attributes', () => {
  const { redact } = require('../../tools/dev/redact.js');
  const cases = [
    ['<meta name="csrf-token" data-content="metadata" content="SECRET">', '<meta name="csrf-token" data-content="metadata" content="REDACTED">'],
    ['<input name="authenticity_token" data-value="metadata" value="SECRET">', '<input name="authenticity_token" data-value="metadata" value="REDACTED">'],
    ['<meta name = "csrf-token" content = "SECRET">', '<meta name = "csrf-token" content = "REDACTED">'],
    ['<input value="secret\'tail" name="authenticity_token">', '<input value="REDACTED" name="authenticity_token">'],
    ['<meta data-name="csrf-token" name="description" content="ordinary text">', '<meta data-name="csrf-token" name="description" content="ordinary text">'],
    ['<meta name="csrf-token-label" content="ordinary text">', '<meta name="csrf-token-label" content="ordinary text">'],
  ];
  for (const [raw, want] of cases) {
    assert.equal(redact(raw), want, raw);
    assert.equal(redact(want), want, `idempotent: ${want}`);
  }
});

// Addresses outside the local Canvas named in a fixture's provenance note, each on purpose: where it came from.
const PROVENANCE = new Set(['https://canvas.mit.edu/courses/10076/files/1691040', 'https://canvadocs.instructure.com/1/sessions/<session>/view']);

test('every fixture is already scrubbed, and names no outside address but its listed sources', () => {
  const { redact } = require('../../tools/dev/redact.js');
  for (const { f, html } of fixtures) {
    assert.equal(redact(html), html, `${f}: the scrubber would still change it`);
    const note = html.slice(0, html.indexOf('-->'));
    for (const [raw] of note.matchAll(/https?:\/\/[^\s)"]+/g)) {
      const url = raw.replace(/[.,;]$/, '');
      assert.ok(PROVENANCE.has(url), `${f}: ${url} in its note is not a listed source`);
    }
  }
});

// What the fixtures contain, by kind: classes, ids, attribute names, attribute name=value, and name~=word.
const seen = { cls: new Set(), id: new Set(), attr: new Set(), eq: new Set(), word: new Set() };
for (const { html } of fixtures) {
  for (const [, name, value] of html.matchAll(/\s([\w:-]+)="([^"]*)"/g)) {
    seen.attr.add(name);
    seen.eq.add(`${name}=${value}`);
    for (const w of value.split(/\s+/)) {
      seen.word.add(`${name}~${w}`);
      if (name === 'class') seen.cls.add(w);
    }
    if (name === 'id') seen.id.add(value);
  }
}
const present = (s) => {
  if (s[0] === '.') return seen.cls.has(s.slice(1));
  if (s[0] === '#') return seen.id.has(s.slice(1));
  const m = s.match(/^\[([\w:-]+)(?:(~?=)"([^"]*)")?\]$/);
  if (!m) throw new Error(`can't read hook ${s}`);
  return !m[2] ? seen.attr.has(m[1]) : m[2] === '=' ? seen.eq.has(`${m[1]}=${m[3]}`) : seen.word.has(`${m[1]}~${m[3]}`);
};

// The Canvas markup content.js reads (its canvas* helpers, the Canvas branches of the sweep and the extras).
const HOOKS = [
  '#application', '.ic-app', '#breadcrumbs', '#section-tabs', '.user_content',
  // Dashboard cards and the planner (list view): course colours, card grades, new-content counts.
  '.ic-DashboardCard', '.ic-DashboardCard__header', '.ic-DashboardCard__header_hero', '.ic-DashboardCard__header-subtitle',
  '.ic-DashboardCard__header-term', '.planner-grouping', '[data-testid="planner-item-completed-checkbox"]',
  // The To Do sidebar's dates.
  '[data-testid="ToDoSidebarItem__InformationRow"]',
  // Grades: score bars, new-grade badges.
  '#grades_summary', '.assignment_score', '.score_holder', '.unread_dot', '.grade_dot', '.student_grades', '.percent',
  // Assignments and modules: due chips, progress, previews, remember your place, download all.
  '.ig-row', '.score-display', '.assignment-date-due', '[data-item-id]', '#context_modules', '#context_modules_sortable_container',
  '.context_module', '[data-module-id]', '.context_module_item', '.due_date_display', '.expand_module_link', '.collapsed_module',
  // Reading tools and the editor.
  '#assignment_show', '.description', '#wiki_page_show', '.show-content', '.tox-edit-area__iframe',
  // InstUI parts the sweep and canvas.css read.
  '[data-cid~="BaseButton"]', '[data-cid~="IconButton"]', '[data-cid~="TruncateText"]',
  // Calendar chips.
  '.fc-event', '.fc-title',
  // Inbox draft backup.
  '#compose-message-modal', '[data-testid="subject-input"]', '[data-testid="address-book-tag"]',
  // File preview frames (dark file previews).
  '.ef-file-preview-stretch', '.file_preview', '#doc_preview',
];

// The classes and ids canvas.css and core/page/apps.css (what Glaze draws itself, on Canvas and Ultra) key on, read from
// their selectors: Glaze's own gz-* aside, and core/page/apps.css's Ultra markup (ULTRA_CSS).
const ULTRA_CSS = new Set(['#site-wrap', '.todo-panel', '.outline-actions', '.base-header-tools', '.courses-panel', '.course-columns', '.course-banner', '.element-details', '.course-title', '.course-id']);
const cssNames = () => {
  const css = ['content/canvas.css', 'core/page/apps.css'].map((f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.replace(/\{[^{}]*\}/g, '{}').replace(/@[^{]*\{/g, '').replace(/url\([^)]*\)/g, '');
  return new Set([...selectors.matchAll(/([.#])(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1] + m[2]).filter((n) => !/^[.#]gz-/.test(n) && !ULTRA_CSS.has(n)));
};

// Keyed on, but on no fixture: each needs an interaction, a state or content the seed doesn't have. A fixture that
// shows one makes the last test below ask for it to be taken off this list.
const UNSEEN = [
  // Canvas's modules script adds this to an item only once the pointer or focus has touched it (context-modules index.jsx).
  '.context_module_item_hover',
  // Canvas hides its global rail in embedded layouts; its flyout tray exists only after a menu opens.
  '.hide-global-nav', '.tray-with-space-for-global-nav',
  // Canvas's mark after a link to another site: on a Dashboard card only once a course bookmark (W4) links elsewhere.
  '.external_link_icon',
  // TinyMCE's menus, dialogs, swatches and tooltips exist only while one is open.
  '.tox-button', '.tox-button--icon', '.tox-button--naked', '.tox-button--secondary', '.tox-checkbox__icons', '.tox-checkbox__input',
  '.tox-checkbox__label', '.tox-collection__group', '.tox-collection__item', '.tox-collection__item--active',
  '.tox-collection__item--state-disabled', '.tox-collection__item-accessory', '.tox-collection__item-caret', '.tox-collection__item-checkmark',
  '.tox-collection__item-icon', '.tox-collection__item-label', '.tox-custom-editor', '.tox-dialog', '.tox-dialog-wrap__backdrop',
  '.tox-dialog__body', '.tox-dialog__body-content', '.tox-dialog__body-nav', '.tox-dialog__body-nav-item', '.tox-dialog__body-nav-item--active',
  '.tox-dialog__footer', '.tox-dialog__header', '.tox-dialog__title', '.tox-form__group', '.tox-label', '.tox-listbox--select',
  '.tox-listboxfield', '.tox-mbtn--active', '.tox-mbtn--disabled', '.tox-menu', '.tox-notification', '.tox-pop__dialog', '.tox-selected-menu',
  '.tox-selectfield', '.tox-swatch', '.tox-swatches-menu', '.tox-swatches__picker-btn', '.tox-tbtn--disabled', '.tox-tbtn--enabled',
  '.tox-textarea', '.tox-textfield', '.tox-toolbar', '.tox-tooltip__arrow', '.tox-tooltip__body',
  // jQuery UI menus, autocompletes, tooltips, date pickers and hover/focus states: only while open or pointed at.
  '.ui-autocomplete', '.ui-datepicker-header', '.ui-datepicker-title', '.ui-datepicker-today', '.ui-kyle-menu', '.ui-menu', '.ui-menu-carat',
  '.ui-menu-item', '.ui-menu-item-wrapper', '.ui-state-focus', '.ui-state-hover', '.ui-tooltip', '.ui-tooltip-content', '.ui-widget-overlay',
  '.popover', '.changed', '.highlight-discussion', '.highlight-fadeout',
  // Flash messages and account notifications: transient, or set by an admin.
  '.ic-flash-info', '.ic-flash-success', '.ic-flash-warning', '.ic-notification', '.ic-notification--alert', '.ic-notification--danger',
  '.ic-notification--success', '.ic-notification__content', '.ic-notification__icon',
  // Button variants no captured page uses.
  '.Button--danger', '.Button--disabled', '.Button--secondary', '.btn-danger', '.btn-link', '.btn-small', '.btn-success', '.btn-warning', '.icon-only',
  '.disabled',
  // The calendar draws no events: the student's course calendars are unchecked in the seed. The agenda view isn't captured.
  '.fc-event', '.fc-title', '.fc-time', '.fc-more', '.agenda-event__icon', '.agenda-event__title',
  // The Files app's preview overlay and a file's own preview frame (a local Canvas previews through Google's viewer).
  '#file-preview-iframe', '.ef-file-preview-frame', '.ef-file-preview-stretch', '.file_preview',
  // A recipient chip in the inbox's compose dialog (canvas-writer-inbox.html has it open, with no recipient yet).
  '[data-testid="address-book-tag"]',
  // Submission details, annotated and uploaded submissions, rubrics and outcomes the seed doesn't have.
  '.annotated-document-submission', '.file-upload-submission-table', '.rubric-title',
  '.wellBelowMasteryShader',
  // Instructor content features the seed doesn't use.
  '.equation_image', '.course-color-block', '.subtitle',
  // Striped tables: the People and Pages lists, not captured.
  '.ic-Table--striped',
  // A teacher's server-drawn To Do list (Better To Do hides it); the fixtures are the student's pages.
  '.to-do-list',
];

test('every class, id and attribute Glaze keys on appears in a fixture, or is listed as unseen with why', () => {
  const missing = [...new Set([...HOOKS, ...cssNames()])].filter((s) => !present(s) && !UNSEEN.includes(s));
  assert.deepEqual(missing, [], 'Canvas markup Glaze styles or reads is on no fixture: recapture the fixtures (a Canvas change?), or add a fixture for it, or list it in UNSEEN with why');
});

test('nothing on the unseen list is actually seen, or no longer keyed on', () => {
  const keyed = new Set([...HOOKS, ...cssNames()]);
  assert.deepEqual(UNSEEN.filter((s) => present(s)), [], 'a fixture now shows these: take them off UNSEEN');
  assert.deepEqual(UNSEEN.filter((s) => !keyed.has(s)), [], 'neither canvas.css nor HOOKS uses these any more: take them off UNSEEN');
});
