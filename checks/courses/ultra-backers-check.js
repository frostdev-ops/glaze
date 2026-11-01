// Text over a Look's background: every line Ultra writes outside its own panels gets a Glaze surface under it, so it reads
// on a light or busy picture. Shapes are copied from a student account's live Ultra (Safari, 2026-11-01): an assignment's
// SafeAssign list, the Courses and Organizations toolbar and term headings, the Activity filter and Show more, the Grades
// term heading, a course gradebook's Current Grade, course Messages, the roster's member filter and the Dashboard's bar.
// Text is fictional. Glaze's own To Do ticks must show through Ultra's rule that hides every native checkbox.
//   glaze-remote -o <dir> -- node checks/courses/ultra-backers-check.js /out   (EXT=<extension dir> checks another copy)
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.EXT || path.join(__dirname, '../../extension')), out = process.argv[2];
let checks = 0, fails = 0;
const check = (v, label) => { checks++; fails += !v; console.log(`${v ? 'ok' : 'FAIL'} ${label}`); };

// The Look's values as content.js wrote them on <html> in that session (a dark scene).
const TOKENS = '--gz-accent:#27cdf1;--gz-accent-hi:#a6efff;--gz-accent-soft:#123b54;--gz-accent-ink:#03131e;--gz-surface:#102338;--gz-surface-2:#060d18;--gz-ink:#ecf5fa;--gz-ink-muted:#aec4d5;--gz-ink-faint:#829eb5;--gz-line:#2b465d;--gz-line-strong:#4d6f8a;--gz-ok:#78dfc0;--gz-warn:#ffd18c;--gz-err:#ffa7b2;color-scheme:dark;--gz-radius:16px;--gz-scale:1;--gz-leading:1.5;--gz-glass:18px;--gz-surface-opacity:90%;--gz-glass-mix:90%;--gz-shadow-strength:35%;--gz-surface-grain:none;--gz-space:1';

const PAGES = {
  assessment: `<div class="assessment-overview-grid">
    <div class="overview-section overview-due-date-section main-section-container"><h2 class="section-label">Details</h2><div class="section-content section-well section-content-container"><div class="js-due-date due-date-and-time-limit"><div class="due-date-container"><h3 class="grid-item-label">Assessment due date:</h3><div>Sunday</div></div></div></div></div>
    <div class="overview-section main-section-container" role="region"><h2 class="section-label">Additional Information</h2><ul class="section-content"><li class="details-list-item"><div class="details-list-info"><h3 class="grid-item-label">Originality Report</h3><span class="js-safeAssign-enabled">SafeAssign enabled</span></div></li></ul></div>
  </div>`,
  courses: `<div class="base-courses"><div class="course-list current-term"><section class="course-overview-management-container"><course-overview-management class="course-overview-management"><div class="makeStylescontainer-0-2-107">
    <div class="makeStylestoolbarRow-0-2-108">
      <div class="MuiFormControl-root MuiTextField-root makeStylesfilterDropdown-0-2-110"><label class="MuiFormLabel-root MuiInputLabel-root MuiInputLabel-formControl MuiInputLabel-shrink MuiInputLabel-outlined">Terms</label><div class="MuiInputBase-root MuiOutlinedInput-root"><div class="MuiSelect-select">Current Courses</div><fieldset class="MuiOutlinedInput-notchedOutline"><legend><span>Terms</span></legend></fieldset></div></div>
      <div class="makeStylespaginationSizeSelector-0-2-111"><div class="page-size-component"><div class="makeStylespageSizeContainer-0-2-125 makeStylespagination-0-2-123"><div class="MuiInputBase-root MuiOutlinedInput-root"><div class="MuiSelect-select">25</div></div><label class="MuiFormLabel-root MuiInputLabel-root MuiInputLabel-animated">items per page</label></div></div></div>
    </div>
    <div class="makeStyleschipResultGroup-0-2-132">4 results<div class="MuiButtonBase-root MuiChip-root MuiChip-filled" data-analytics-id="course.overview.management.terms"><span class="MuiChip-label">Current Courses</span></div></div>
  </div></course-overview-management></section>
  <section id="course-columns-current" class="course-columns multi-column-view"><div class="course-org-list">
    <div id="course-card-term-name-_1_1" class="course-card-term-name"><h3 class="favorites-label"><bb-translate>Favorites</bb-translate></h3></div><div class="favorites-group"></div>
    <div id="course-card-term-name-_2_1" class="course-card-term-name"><h3>Fall Term</h3></div><div class="term-group"></div>
  </div></section>
  <section id="course-columns-allTerms" class="course-columns list-column-view"><div class="course-org-list"><div id="course-card-term-name-" class="course-card-term-name"><h3 class="others-label"><bb-translate>Others</bb-translate></h3></div></div></section></div></div>`,
  stream: `<section class="js-base-stream-container route-view-container">
    <div class="stream-available-bar"><bb-ui-async-combobox id="streams-filter"><div class="makeStylescomboboxContainerWidth-0-2-5"><div data-analytics-id="feature.base.stream.filter.dropdown.button.container"><div class="MuiFormControl-root MuiTextField-root makeStylescomboboxReset-0-2-7"><label id="streams-filter-label" class="MuiFormLabel-root MuiInputLabel-root MuiInputLabel-formControl MuiInputLabel-shrink MuiInputLabel-outlined">Filter</label><div class="MuiInputBase-root MuiOutlinedInput-root"><input value="Show All"><fieldset class="MuiOutlinedInput-notchedOutline"><legend><span>Filter</span></legend></fieldset></div></div></div></div></bb-ui-async-combobox></div>
    <div id="body-content" class="base-recent-activity stream-panel-activity-body"><div class="row collapse"><div><div id="activity-stream" class="activity-stream row collapse"><div class="js-upcomingStreamEntries activity-group columns main-column"><button class="js-show-more expand button button--text">Show more upcoming activity</button></div></div></div></div></div>
  </section>`,
  grades: `<div id="body-content" class="base-grades-wrapper"><div class="base-grades"><div class="id_1 carousel"><div id="container-term-current" class="carousel-slide current-slide visible-slide"><div class="grades-list current-term"><div id="grades-list-term-current" class="semester active-term"><ng-switch><h2>Current Courses and Organizations</h2></ng-switch></div></div></div></div></div></div>`,
  gradebook: `<div class="grades-list"><aside class="student-grade-overview course-color-9" role="complementary"><div class="student-grade__header"><div class="student-grade__header__overallGrade overall-grade-running-total-wrapper"><div class="overall-grade-running-total-wrapper__overall-label" id="overall-grade-heading">Current Grade</div><div class="overall-tooltip"><button title="Calculation is based on points earned out of total graded points." aria-label="Overall Grade calculation description"><bb-ui-icon-small-attention class="react-container"></bb-ui-icon-small-attention></button></div><div class="right"><div><a class="no-underline js-overall-grade-link" href="#"><bb-display-grade-pill class="final-grade"><div class="grade-color"><div class="wrapping-input-style readonly pill-style cursor-pointer customGradePill excellent"><div><span class="grade-input-display grade-ellipsis" title="A"><bdi>A</bdi></span></div></div></div></bb-display-grade-pill></a></div></div></div></div></aside></div>`,
  messages: `<section class="route-view-container js-course-skip-link-target"><bb-course-conversations><div class="messages-container color-override no-border">
    <div class="conversation-container"><div class="title-messages"><span>Course Messages</span></div><ul><li class="message-card message-status"><div class="columns small-12"><div class="message-info child-is-invokable"><div class="message-meta-info"><div class="sender-info-container"><div class="sender-content"><span class="content-title participants"><bb-translate>You</bb-translate></span></div><div class="last-activity"><div class="timestamp"><div><bb-datetime>10/9/26, 7:14 PM</bb-datetime></div></div></div></div><div class="recipients-info-container"><div class="recipients"><bb-translate>To:</bb-translate> <participants-preview class="react-container">All students</participants-preview></div></div></div><div class="latest-message"><latest-message-preview class="react-container"><span class="makeStyleslastMessagePreview-0-2-87">Thanks, see you Friday.</span></latest-message-preview></div></div></div></li></ul></div>
    <div class="pagination-container"><div><bb-page-size-selector><div class="page-size-component"><div class="makeStylespageSizeContainer-0-2-77 pageSize"><label class="MuiFormLabel-root MuiInputLabel-root MuiInputLabel-animated">items per page</label></div></div></bb-page-size-selector></div></div>
  </div></bb-course-conversations></section>`,
  roster: `<div class="columns small-10 medium-5 filter-wrapper"><div class="select-wrapper roster-select"><button data-dropdown="rosters-filter" aria-label="Roster Filter"><div class="select-value"><span id="filter-roster-value">All course members (17)</span></div></button></div></div>`,
  dashboard: `<section class="institution-page-container route-view-container"><section id="gz-dash" role="tabpanel" data-board="dash"><div class="gz-dash-bar"><button type="button" class="gz-w-small gz-dash-edit">Edit layout</button><button type="button" class="gz-w-small">What Glaze can do</button></div></section></section>`,
};

// The probe run on the live pages: a line of text is backed when it or a container below #site-wrap paints a fill or a blur.
const bare = () => {
  const paints = (cs) => {
    const a = /rgba|\/ /.test(cs.backgroundColor) ? parseFloat((cs.backgroundColor.match(/(?:,|\/)\s*([\d.]+)\s*\)$/) || [0, 1])[1]) : 1;
    return (cs.backgroundColor !== 'transparent' && a > 0.35) || cs.backgroundImage !== 'none' || (cs.backdropFilter && cs.backdropFilter !== 'none');
  };
  const site = document.getElementById('site-wrap'), out = [];
  const tw = document.createTreeWalker(site, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.nodeValue.trim() ? 1 : 3 });
  for (let n; (n = tw.nextNode());) {
    const el = n.parentElement;
    if (el.closest('legend, .gz-ignore')) continue;
    let a = el, backed = false;
    for (; a && a !== site; a = a.parentElement) if (paints(getComputedStyle(a))) { backed = true; break; }
    if (!backed) out.push(n.nodeValue.trim());
  }
  return out;
};

(async () => {
  let browser;
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, ...require('../../tools/dev/check-env.js').chromeLaunch(), args: ['--host-resolver-rules=MAP * ~NOTFOUND'], chromiumSandbox: false });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/') ? r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }) : r.abort());
    for (const bg of ['scene', 'solid']) {
      await page.goto('https://bb.school.test/ultra/course');
      // Ultra's own rules that matter here, from its app sheet (uiv4001.2.0-rel.39): native ticks hidden, labels bold.
      await page.setContent(`<html data-gz-bg="${bg}" style="${TOKENS}"><head><style>
        body { margin:0; font:15px/1.5 system-ui; color:var(--gz-ink); background:linear-gradient(90deg,#e8f1f8,#2c5d9a); }
        label { font-weight:bold; } .select-wrapper button, .overall-tooltip button { background:transparent; border:0; color:inherit; } input[type=checkbox],input[type=radio] { display:inline-block; width:1rem; height:1rem; margin-right:0; margin-bottom:0; opacity:0; }
        #site-wrap > section.page { padding:24px; }
      </style></head><body><div id="site-wrap">${Object.entries(PAGES).map(([k, v]) => `<section class="page" data-page="${k}">${v}</section>`).join('')}
        <aside class="gz-ignore"><div id="gz-todo"><ul><li class="gz-todo-item"><input type="checkbox" data-act="done" aria-label="Done"><div class="gz-todo-main"><a class="gz-todo-title" href="#">Reading response</a></div></li></ul></div></aside>
      </div></body></html>`);
      for (const file of ['content/theme.css', 'content/extras.css', 'core/page/apps.css']) await page.addStyleTag({ path: path.join(root, file) });
      const left = await page.evaluate(bare);
      for (const k of Object.keys(PAGES)) {
        const lines = await page.evaluate((k) => { const s = document.querySelector(`[data-page="${k}"]`); return s.innerText.split('\n').map((t) => t.trim()).filter(Boolean); }, k);
        const unbacked = lines.filter((t) => left.includes(t));
        check(!unbacked.length, `${bg}: ${k} has a surface under every line${unbacked.length ? ` (bare: ${unbacked.join(' | ')})` : ''}`);
      }
      const tick = await page.evaluate(() => { const i = document.querySelector('#gz-todo input[type="checkbox"]'), cs = getComputedStyle(i); return { opacity: cs.opacity, w: i.getBoundingClientRect().width }; });
      check(tick.opacity === '1' && tick.w > 10, `${bg}: the To Do tick shows through Ultra's hidden-checkbox rule (opacity ${tick.opacity})`);
      if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `backers-${bg}.png`), fullPage: true }); }
    }
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  } catch (e) { fails++; console.log(`FAIL ${e.stack || e}`); } finally { await browser?.close(); }
  console.log(fails ? `${fails} failed (${checks} checks)` : `${checks}/${checks} passed`);
  process.exit(fails ? 1 : 0);
})();
