// Real unpacked extension, synthetic student assignments, GETs only. No account or outside network.
// NODE_PATH=<playwright> nice -n 10 node scripts/rubric-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test', canvas = 'https://rubric.instructure.com';
const assessment = '/ultra/courses/_101_1/assessment/_8120_1/overview';
const html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-assessment-rubric.html'), 'utf8');
const out = process.argv[2], shots = process.env.RUBRIC_SHOTS || '/tmp/gz-rubric-shots', lock = require('./check-env.js').lockPath();
const checks = [], requests = [], nativeRequests = [], errors = []; let passed = false;
const run = name => !process.env.RUBRIC_CASE || process.env.RUBRIC_CASE.split(',').includes(name);
const pause = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const definition = {
  id: '_600_1', title: 'Evidence and reasoning', description: '<p>Read the full grading guidance.</p><script>window.__rubricUnsafe=1</script><img src="https://outside.invalid/description" onerror="window.__rubricUnsafe=1">', courseId: '_101_1', rubricType: 'PERCENTAGE',
  columnHeaders: ['Excellent', 'Developing', 'Beginning'].map((header, i) => ({ id: `_${610+i}_1`, header, position: i })),
  rows: ['Evidence', 'Reasoning'].map((header, r) => ({ id: `_${620+r}_1`, header, percentage: 50, position: r,
    cells: [100, 50, 0].map((percentage, c) => ({ id: `_${630+r*3+c}_1`, rubricRowId: `_${620+r}_1`, rubricColumnId: `_${610+c}_1`, position: c, percentage,
      description: `<p>${header} level ${c+1}. <strong>Readable detail</strong></p><script>window.__rubricUnsafe=1</script><img src="https://outside.invalid/leak" onerror="window.__rubricUnsafe=1">` })) })),
};
const association = { id: '_500_1', entityId: '_300_1', rubricId: '_600_1', percentOfGrade: 100, displayBefore: true, displayAfter: false, displayGraded: true, isWithEvaluations: true, rubricDefinition: definition };
// Ultra's own shapes for a graded attempt: the evaluation unpublished and without a userId, the row's status GRADED.
const evaluation = { id: '_700_1', attemptId: '_400_1', rubricAssociationId: '_500_1', userId: null, submitted: true, published: false, completed: true, editable: false, maxScore: 20, totalScore: 15,
  cells: [{ id: '_710_1', rubricRowId: '_620_1', rubricCellId: '_630_1', selectedPercent: 100, feedback: { rawText: '<p>Strong evidence.</p>' } }] };
// NUMERIC: rows carry rowPoints, levels numericPoints, and an evaluation cell's selectedPercent is the level's points.
const numeric = { ...definition, rubricType: 'NUMERIC', columnHeaders: ['Excellent', 'Good', 'Fair', 'Weak', 'Missing'].map((header, i) => ({ id: `_${610+i}_1`, header, position: i })),
  rows: ['Evidence', 'Reasoning'].map((header, r) => ({ id: `_${620+r}_1`, header, percentage: 50, rowPoints: 10, position: r,
    cells: [10, 8, 6, 4, 0].map((n, c) => ({ id: `_${630+r*5+c}_1`, rubricRowId: `_${620+r}_1`, rubricColumnId: `_${610+c}_1`, position: c, numericPoints: n, normalizedPoints: n, percentage: n * 10,
      weightedPercent: n / 20, startPointRange: 0, endPointRange: 0, percentageMin: 0, percentageMax: 0, description: `<p>${header} ${n} points.</p>` })) })) };
const numericEvaluation = { ...evaluation, totalScore: 18, cells: [{ id: '_710_1', rubricRowId: '_620_1', rubricCellId: '_631_1', selectedPercent: 8, feedback: { rawText: '<p>Strong evidence.</p>' } }, { id: '_711_1', rubricRowId: '_621_1', rubricCellId: '_635_1', selectedPercent: 10, feedback: { rawText: '' } }] };
const grade = { id: '_510_1', courseId: '_101_1', userId: '_42_1', columnId: '_300_1', lastAttemptId: '_400_1', column: { id: '_300_1', contentId: '_8120_1', possible: 20 }, lastAttempt: { id: '_400_1', status: 'COMPLETED' }, submissionStatus: { status: 'GRADED' } };
const assignment = { id: '22', course_id: '11', name: 'Evidence and reasoning', restrict_quantitative_data: false, use_rubric_for_grading: true,
  rubric_settings: { id: '33', title: 'Evidence and reasoning', points_possible: 20, hide_points: false, hide_score_total: false },
  rubric: ['Evidence', 'Reasoning'].map((description, r) => ({ id: `c${r}`, points: 10, description, long_description: 'Readable criterion', ratings: [10,5,0].map((points, i) => ({ id: `r${r}${i}`, points, description: ['Excellent','Developing','Beginning'][i], long_description: 'Readable detail' })) })) };
const canvasHTML = (kind) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Assignment</title><link rel="stylesheet" href="/dist/brandable_css/rubric.css"><style>body{margin:0;padding:1rem;font:1rem/1.5 system-ui}*{box-sizing:border-box}</style></head><body class="assignments show"><div id="application" class="ic-app"><header id="header"></header><nav id="section-tabs"></nav><main id="content"><h1>A fictional assessment</h1><div id="assignments-2-student-header"></div>${kind === 'observer' ? '<div id="observer-picker-mountpoint"></div>' : ''}<section data-testid="rubric-tab"><button id="native-rubric" data-testid="fill-out-rubric-toggle" aria-expanded="${kind === 'visible'}">View Rubric</button><div data-testid="rubric-preview" ${kind === 'visible' ? '' : 'hidden'}>Native rubric</div></section></main></div><script>window.ENV={current_user_id:'42',ISOBSERVER:${kind === 'observer'},peer_review_mode_enabled:${kind === 'peer'},restrict_quantitative_data:false};window.__nativeRubricClicks=0;document.getElementById('native-rubric').addEventListener('click',function(){window.__nativeRubricClicks++;this.setAttribute('aria-expanded','true');document.querySelector('[data-testid="rubric-preview"]').hidden=false;});</script></body></html>`;
// The other two pages with Ultra's rubric link, in the real pages' shapes (2026-10-26): a discussion's Details panel beside
// the thread, and the attempt page View instructions opens (React; the link known only by its analytics id).
const hostHTML = (kind) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="/ultra/"><title>Blackboard Learn</title><style>
* { box-sizing:border-box; } body { margin:0; font:1rem/1.5 system-ui; } content-page-header { display:block; padding:1rem 1.5rem; border-bottom:1px solid; }
.course-main-container, .makeStylescontainer-0-2-1034 { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:24px; padding:24px; } #native-rubric-panel { padding:1rem; border:1px solid; }
</style></head><body><div id="site-wrap">${kind === 'discussion'
  ? '<section class="routed-page route-view-container"><content-page-header>Synthetic course / Discussion</content-page-header><div class="routed-page-body"><section class="panel-content"><div id="discussions-tabpanel"><div class="panel-content-inner"><div id="full-discussions" class="full course-discussion js-course-skip-link-target"><div class="course-main-container"><div class="thread"><h1>A fictional discussion</h1><p>The thread, with replies.</p></div><div class="layer-details"><div><bb-discussion-settings><div class="full-panel-details"><div class="discussion-settings student-details"><div class="full-panel-details-info"><h3>Details &amp; Information</h3><div class="element-card discussion-info-list"><div class="element-details discussion-info-details"><span>Grading rubric</span><div class="settings-link"><a id="native-rubric" class="rubric-title" href="javascript:void(0);" analytics-id="components.directives.discussionSettings.gradedWithRubric.li">This item is graded with a rubric</a></div></div></div></div></div></div></bb-discussion-settings></div></div></div></div></div></div></section></div></section>'
  : '<section class="routed-page route-view-container bb-offcanvas-container"><content-page-header>Synthetic course / Attempt</content-page-header><div class="routed-page-body"><bb-assignment-attempt-authoring-panel class="react-container"><div><div class="makeStylespanelRoot-0-2-1056"><div class="makeStylesbaseBody-0-2-1059"><div class="makeStylesheaderRoot-0-2-1062"><h1>A fictional assignment</h1></div><div class="makeStylescontentRoot-0-2-1064"><div class="makeStylesbody-0-2-1120"><div class="makeStylescontainer-0-2-1034"><div class="makeStylesauthoring-0-2-1036"><h2>Assignment instructions</h2><p>Explain how you evaluated the evidence.</p><div id="bb-editorassignment-attempt-authoring-submission" role="textbox" contenteditable="true">Untouched draft</div></div><div class="makeStylesdetails-0-2-1037"><div class="makeStylessidePanelContentMarginFix-0-2-1049"><h2>Details &amp; Information</h2><div class="makeStyleslistWrapper-0-2-204"><div class="makeStylesroot-0-2-205"><div class="makeStylescontentRoot-0-2-206"><span>Grading rubric</span><a id="native-rubric" class="MuiTypography-root MuiLink-root MuiLink-underlineAlways" data-analytics-id="assignment.attempt.authoring.rubric.view.link" href="/ultra/courses/_101_1/assessment/_8120_1/attempt/create">This item is graded with a rubric</a></div></div></div></div><div><h3>Grading</h3><p>Maximum points: 20</p></div></div></div></div></div><div class="makeStylesfooterWrapper-0-2-1068"><footer class="makeStylesfooterRoot-0-2-1140"><button id="save" type="button">Save and Close</button><button id="submit" type="button">Submit</button></footer></div></div></div></div></bb-assignment-attempt-authoring-panel></div></section>'}</div>
<script>window.__nativeRubricClicks=0;document.getElementById('native-rubric').addEventListener('click',e=>{e.preventDefault();window.__nativeRubricClicks++;if(!document.getElementById('native-rubric-panel')){const p=document.createElement('section');p.id='native-rubric-panel';p.textContent='Native rubric';document.body.append(p);}});</script></body></html>`;
const find = (node, test) => {
  if (test(node)) return node;
  for (const n of [...node.children || [], ...node.shadowRoots || [], ...(node.contentDocument ? [node.contentDocument] : [])]) { const v = find(n, test); if (v) return v; }
};
const attr = (n, k) => { const a = n.attributes || []; const i = a.indexOf(k); return i < 0 ? undefined : a[i+1]; };
// CDP reaches closed roots without changing production shadow mode or patching the page's prototypes.
const shadowCall = async (cdp, hostId, selector, fn) => {
  const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const host = find(doc, n => attr(n, 'id') === hostId);
  const node = host && find(host, n => selector === 'table' ? n.nodeName === 'TABLE' : n.nodeName === 'DIALOG');
  if (!node) return null;
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: node.nodeId });
  try { const r = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: fn.toString(), returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; }
  finally { await cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
};
const tableInfo = function () {
  let scroll = this.parentElement;
  while (scroll && !['auto','scroll'].includes(getComputedStyle(scroll).overflowX)) scroll = scroll.parentElement;
  let r = this.getRootNode(); while (!r.querySelector('dialog') && r.host?.getRootNode().host) r = r.host.getRootNode();
  const d = r.querySelector('dialog'), box = d?.getBoundingClientRect();
  return { text: this.textContent, caption: this.caption?.textContent, rows: this.querySelectorAll('th[scope="row"]').length, cols: this.querySelectorAll('th[scope="col"]').length,
    selected: this.querySelectorAll('[aria-current="true"]').length, unsafe: !!this.querySelector('script,iframe,[onerror],img[src^="https://outside.invalid"]'),
    scroll: !!scroll, scrollable: !!scroll && scroll.scrollWidth > scroll.clientWidth + 1, labelled: !!scroll && !!(scroll.getAttribute('aria-label') || scroll.getAttribute('aria-labelledby')),
    focusable: !!scroll && scroll.tabIndex === 0, pageFits: document.documentElement.scrollWidth <= innerWidth + 1,
    dialogFits: !d || box.left >= -1 && box.right <= innerWidth + 1, bodyFits: !d || d.querySelector('.body').scrollWidth <= d.querySelector('.body').clientWidth + 1,
    focused: !d || r.activeElement === d || d.contains(r.activeElement), animations: d ? d.getAnimations().filter(a => a.playState === 'running').map(a => a.effect.getTiming().duration) : [],
    fontSize: parseFloat(getComputedStyle(this).fontSize), surfaceText: this.getRootNode().querySelector('section')?.textContent, surfaceUnsafe: !!this.getRootNode().querySelector('section')?.querySelector('script,iframe,[onerror],img[src^="https://outside.invalid"]'), foreground: getComputedStyle(this).color, background: getComputedStyle(d || r.host).backgroundColor };
};
(async () => {
  let context, held = false, tmp, ext, releaseSlow;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock,'owner'), `${process.pid}\nrubric-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[rubric-check] waiting for heavy lock'); await pause(5000); }
    }
    ext = require('./check-env.js').staged(root, [`${site}/*`, `${canvas}/*`]); tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-rubric-'));
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp,'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width:1440,height:900 }, args: [`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--host-resolver-rules=MAP * ~NOTFOUND','--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(10000);
    let scenario = 'normal', slowSeen = false;
    await context.route('**/*', async r => {
      const req = r.request(), u = new URL(req.url()); if (u.protocol === 'chrome-extension:') return r.continue();
      if (scenario === 'review' && req.isNavigationRequest() && u.origin === 'https://annotate-us.foundations.blackboard.com') {
        nativeRequests.push(req.url()); return r.abort();
      }
      requests.push({ method: req.method(), origin:u.origin, path:u.pathname, query:u.search });
      if (req.method() !== 'GET' || ![site,canvas].includes(u.origin)) return r.abort();
      if (u.origin === site && u.pathname === '/frame-shell') return r.fulfill({ contentType:'text/html',body:`<!doctype html><style>body{margin:0}iframe{width:100%;height:900px;border:0}</style><iframe name="gz-ctab:_101_1" src="${site}${assessment}"></iframe>` });
      if (req.isNavigationRequest() && u.origin === site && /\/(discussion|attempt)\//.test(u.pathname)) return r.fulfill({ contentType:'text/html',body:hostHTML(u.pathname.includes('/discussion/') ? 'discussion' : 'attempt') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType:'text/html',body:u.origin === canvas ? canvasHTML(scenario) : scenario === 'review' ? fs.readFileSync(path.join(__dirname,'../test/fixtures/ultra-docreview.html'),'utf8').replace('<head>','<head><base href="/ultra/">') : html });
      if (u.pathname.endsWith('/rubric.css')) return r.fulfill({contentType:'text/css',body:''});
      let data = { results:[] };
      if (u.pathname.endsWith('/users/me') || u.pathname.endsWith('/users/self/profile')) data = { id:u.origin === canvas ? '42' : '_42_1',name:'Synthetic student' };
      else if (u.pathname.includes('/gradebook/grades')) { const row={...grade}; if(scenario==='unopened')for(const k of ['lastAttemptId','lastAttempt','status','submissionStatus'])delete row[k]; if(['submitted','released-ungraded'].includes(scenario))Object.assign(row,{lastAttempt:{id:'_400_1',status:scenario==='submitted'?'NEEDS_GRADING':'COMPLETED'},submissionStatus:{status:'SUBMITTED'}}); data={results:[row]}; }
      else if (u.pathname.includes('/contents/')) data = { id:'_8120_1', contentDetail:{'resource/x-bb-asmt-test-link':{test:{gradingColumn:{id:'_300_1'},assessment:{gradableItemId:'_300_1'}}}} };
      else if (u.pathname.includes('/gradebook/columns/_300_1')) {
        if (scenario === 'forbidden') return r.fulfill({status:403,contentType:'application/json',body:'{}'});
        if (scenario === 'slow') { slowSeen = true; await new Promise(done => { releaseSlow = done; }); }
        data = { id:'_300_1',courseId:'_101_1',contentId:'_8120_1',possible:20,gradesReleased:scenario==='released-ungraded',rubricAssociations:[scenario==='numeric'?{...association,rubricDefinition:numeric}:scenario==='graded-hidden'?{...association,displayGraded:false}:association] };
      } else if (u.pathname.includes('/gradebook/attempts/')) data = { id:'_400_1',courseId:'_101_1',columnId:'_300_1',userId:'_42_1',status:scenario==='submitted'?'NEEDS_GRADING':'COMPLETED',rubricEvaluation:{...(scenario==='numeric'?numericEvaluation:evaluation),...(scenario==='submitted'?{published:true,userId:'_42_1'}:scenario==='foreign-user'?{userId:'_43_1'}:scenario==='foreign-attempt'?{attemptId:'_401_1'}:scenario==='foreign-association'?{rubricAssociationId:'_501_1'}:{})} };
      else if (u.origin === canvas && /\/assignments\/22\/submissions\/self$/.test(u.pathname)) data = { assignment_id:'22',user_id:'42',rubric_assessment:{c0:{rating_id:'r00',points:10,comments:'Strong evidence.'}} };
      else if (u.origin === canvas && /\/assignments\/22$/.test(u.pathname)) data = assignment;
      return r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root,'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar:{on:false},footer:false,enhance:Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map(k=>[k,false])),rubric:{show:'auto',inline:true},popup:{anim:'genie'} });
    await worker.evaluate(async ({settings,site})=>{await chrome.storage.sync.clear();await chrome.storage.local.clear();await chrome.storage.sync.set(settings);await chrome.storage.local.set({ultra:[site]});},{settings,site});
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts);
    const setMode = async (show='auto',inline=true) => worker.evaluate(async rubric=>chrome.storage.sync.set({rubric}),{show,inline});
    const open = async ({width=1440,kind='normal',url=`${site}${assessment}`,show='auto',inline=true,rtl=false,large=false,reduced=false,light=false,sidebar=false}={}) => {
      // One write per page: chrome.storage.sync allows 120 a minute, and a full run opens dozens of pages.
      const look=light?'Paper':'Frost'; scenario=kind;
      await worker.evaluate(async s=>chrome.storage.sync.set(s),{enhance:{...settings.enhance,sidebar},rubric:{show,inline},preset:look,colors:G.GZ_PRESETS.find(([name])=>name===look)[1]}); const p=await context.newPage(); p.on('pageerror',e=>errors.push(e.message)); await p.setViewportSize({width,height:900}); await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
      const finalRead = show !== 'site' && !['visible','peer','observer','slow','review'].includes(kind) && !url.endsWith('/frame-shell') ? p.waitForResponse(r => url.startsWith(canvas) ? r.url().includes('/submissions/self?') : r.url().includes(['forbidden','unopened'].includes(kind) ? '/gradebook/columns/_300_1?' : '/gradebook/attempts/_400_1?')).then(response=>({response}),error=>({error})) : null;
      await p.goto(url); if (!url.endsWith('/frame-shell')) await p.waitForFunction(()=>document.documentElement.hasAttribute('data-gz-motion')); 
      if(rtl||large) await p.evaluate(({rtl,large})=>{if(rtl)document.documentElement.dir='rtl';if(large)document.documentElement.style.fontSize='24px';},{rtl,large});
      if (finalRead) { const finished=await finalRead; if(finished.error)throw finished.error; await p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))); }
      return {page:p,cdp:await context.newCDPSession(p)};
    };
    const info = (cdp,host='gz-rubric')=>shadowCall(cdp,host,'table',tableInfo);
    const screenshot = async (p,name)=>{fs.mkdirSync(shots,{recursive:true});await pause(450);await p.screenshot({path:path.join(shots,`${name}.png`),fullPage:true});};
    if(run('cache')) {
      const {page,cdp}=await open(); await until(()=>info(cdp),'rubric before mode switches');
      const count=()=>requests.filter(r=>r.path.includes('/gradebook/')).length, before=count();
      await setMode('site'); await until(async()=>!await info(cdp),'native mode');
      await setMode('auto'); await until(()=>info(cdp),'automatic mode');
      await setMode('popup'); await until(async()=>!await info(cdp),'popup mode');
      await setMode('auto'); await until(()=>info(cdp),'automatic mode again');
      for(const width of [390,1440,390,1440]) { await page.setViewportSize({width,height:900}); await until(async()=>!!await info(cdp)===(width===1440),'resized rubric'); }
      check(count()===before,'mode changes and resize flips reuse the same rubric reads'); await page.close();
    }
    if(run('focus-source')) {
      const {page,cdp}=await open({width:390}); await page.locator('#native-rubric').focus();
      await page.setViewportSize({width:1440,height:900}); await pause(250);
      check(await page.evaluate(()=>document.activeElement?.id==='native-rubric')&&!await info(cdp),'resizing preserves focus on the native rubric trigger');
      await page.locator('h1').evaluate(e=>{e.tabIndex=-1;e.focus();}); await until(()=>info(cdp),'inline after focus leaves the trigger'); await page.close();
    }
    if(run('focus-inline')) {
      const {page,cdp}=await open(); await until(()=>info(cdp),'inline before focusing scroll region');
      await shadowCall(cdp,'gz-rubric','table',function(){this.parentElement.focus();});
      await page.setViewportSize({width:390,height:900}); await pause(250);
      check(await page.evaluate(()=>document.activeElement?.id==='gz-rubric')&&!!await info(cdp),'resizing preserves keyboard focus inside the inline rubric');
      await page.locator('h1').evaluate(e=>{e.tabIndex=-1;e.focus();}); await until(async()=>!await info(cdp),'popup mode after focus leaves inline'); await page.close();
    }
    if(run('unopened')) {
      const start=requests.length, {page,cdp}=await open({kind:'unopened'});
      const x=await until(()=>info(cdp),'unopened own assessment rubric');
      check(x.selected===0&&!x.text.includes('Strong evidence.')&&!requests.slice(start).some(r=>r.path.includes('/gradebook/attempts/')),'an unopened own assessment without status fields displays its permitted definition without evaluation');await page.close();
    }
    // Ultra keeps its own rubric link, which opens the rubric, on a submitted item whatever displayAfter says: the
    // definition shows as it does there, and nothing short of a graded row with displayGraded releases selections.
    for (const kind of ['submitted','released-ungraded','graded-hidden']) if(run(kind)) {
      const {page,cdp}=await open({kind}), x=await until(()=>info(cdp),`${kind} rubric definition`);
      check(x.selected===0&&!x.text.includes('Strong evidence.'),`${kind}: the definition shows without selections`);await page.close();
    }
    for (const kind of ['foreign-user','foreign-attempt','foreign-association']) if(run(kind)) {
      const {page,cdp}=await open({kind}), x=await until(()=>info(cdp),'graded rubric with a foreign evaluation');
      check(x.selected===0&&!x.text.includes('Strong evidence.'),`${kind}: an unrelated evaluation shows the graded rubric without its selections`);await page.close();
    }
    if(run('results')) {
      const {page,cdp}=await open(); await until(()=>info(cdp),'rubric before results styles');
      await page.evaluate(()=>{
        document.querySelector('.assessment-overview-grid').append(document.querySelector('#assessment-results-fixture').content.cloneNode(true));
        const other=document.createElement('div');other.id='other-section';other.innerHTML='<div class="section-content">Other content</div>';document.querySelector('#site-wrap').append(other);
      });
      const styles=()=>page.evaluate(()=>{
        const css=s=>getComputedStyle(document.querySelector(s)), body=css('.assessment-results-section > .section-content'), label=css('.assessment-results-header > .section-label'), other=css('#other-section > .section-content');
        return {tag:document.querySelector('.assessment-results-section > .section-content').tagName,radius:body.borderTopLeftRadius,padding:body.paddingInlineStart,border:body.borderTopWidth,fill:body.backgroundColor,blur:body.backdropFilter,labelRadius:label.borderTopLeftRadius,labelDisplay:label.display,otherBorder:other.borderTopWidth};
      });
      const glass=await styles();
      check(glass.tag==='UL'&&parseFloat(glass.radius)>0&&parseFloat(glass.padding)>0&&glass.border==='1px'&&glass.fill!=='rgba(0, 0, 0, 0)','Assessment Results list has a rounded padded surface');
      check(glass.labelRadius==='999px'&&glass.labelDisplay==='inline-flex'&&glass.otherBorder==='0px','the nested Results heading is a pill and unrelated section content has no panel border');
      await page.evaluate(()=>document.documentElement.setAttribute('data-gz-bg','solid'));
      check((await styles()).blur==='none','Assessment Results disables backdrop blur with a solid background');await page.close();
    }
    if(run('numeric')) {
      const {page,cdp}=await open({kind:'numeric'}), x=await until(()=>info(cdp),'graded NUMERIC rubric');
      check(x.cols===6&&x.selected===2&&/Total: 18 \/ 20/.test(x.surfaceText),'a graded NUMERIC rubric shows its selected levels\' points and the total');
      await screenshot(page,'numeric-inline'); await page.close();
    }
    if(run('description')) {
      const {page,cdp}=await open(), x=await until(()=>info(cdp),'rubric description');
      check(x.surfaceText.includes('Read the full grading guidance.')&&!x.surfaceUnsafe&&!await page.evaluate(()=>window.__rubricUnsafe),'the full rubric description is visible through the shared safe HTML path');await page.close();
    }
    if(run('font')) {
      const {page,cdp}=await open();await until(()=>info(cdp),'inline rubric before text-size change');
      await page.evaluate(()=>{document.querySelector('.assessment-details-section').style.fontSize='20px';document.documentElement.setAttribute('data-rubric-font-change','20');});
      await until(async()=>Math.abs((await info(cdp))?.fontSize-20)<.1,'inline text follows a font-size change');
      check(true,'changing text size updates an existing inline rubric without requiring a presentation flip');
      await page.evaluate(()=>{document.querySelector('.assessment-details-section').style.fontSize='32px';document.documentElement.setAttribute('data-rubric-font-change','32');});
      await until(async()=>!await info(cdp),'larger text recomputes available room');check(await page.locator('#native-rubric').isVisible(),'larger text switches to the pop-up trigger when columns no longer fit');await page.close();
    }
    if(run('reopen')) {
      const {page,cdp}=await open({width:390});await page.locator('#native-rubric').click();await until(()=>info(cdp,'gz-popup'),'first rubric pop-up');
      await page.keyboard.press('Escape');await page.keyboard.press('Enter');
      check(await page.locator('#gz-popup').count()===2,'a keyboard activation can reopen the rubric during its closing animation');
      await until(async()=>await page.locator('#gz-popup').count()===1,'the earlier pop-up finishes closing');
      await page.evaluate(()=>{history.pushState(null,'',location.origin+'/ultra/courses/_101_1/outline');dispatchEvent(new PopStateEvent('popstate'));});
      await until(async()=>!await page.locator('#gz-popup').count(),'leaving the route closes the reopened pop-up');check(true,'leaving an assessment closes its reopened rubric after the earlier closing animation finishes');await page.close();
    }
    if(run('bfcache')) {
      const {page,cdp}=await open();await until(()=>info(cdp),'rubric before persisted pagehide');
      await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await until(async()=>!await info(cdp),'persisted hide removes rubric');
      await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await until(()=>info(cdp),'persisted pageshow restores rubric');
      check(true,'a page restored from back-forward cache resumes its rubric');await page.close();
    }
    if(run('desktop')) {
      const {page,cdp}=await open(); const x=await until(()=>info(cdp),'automatic inline rubric');
      check(x.caption && x.rows===2 && x.cols===4,'desktop Automatic renders a captioned table with criterion and level headers');
      check(x.text.includes('Strong evidence.') && x.selected>0,'the graded evaluation\'s feedback and a non-colour selected rating are present');
      check(!x.unsafe && !await page.evaluate(()=>window.__rubricUnsafe),'rubric descriptions use the shared safe HTML path');
      check(x.pageFits && await page.locator('.assessment-details-section #gz-rubric').count()===1,'the inline rubric stays inside Assessment Details without page overflow');
      check(await page.locator('.assessment-overview-grid').evaluate(e=>e.children.length===4),'the assessment grid retains its native children');
      await screenshot(page,'desktop-inline'); await page.close();
    }
    if(run('screenshots')) for(const light of [true,false]) for(const width of [1440,390]) {
      const look=light?'light':'dark', {page,cdp}=await open({light});
      await until(()=>info(cdp),'inline screenshot');
      if(width===390) {
        await shadowCall(cdp,'gz-rubric','table',function(){this.parentElement.focus();});
        await page.setViewportSize({width,height:900});
      }
      await screenshot(page,`inline-${width}-${look}`);
      if(width===390) {
        check(!!await info(cdp),'390px inline stays available while its scroll region has focus');
        await page.locator('h1').evaluate(e=>{e.tabIndex=-1;e.focus();});await until(async()=>!await info(cdp),'390px Automatic popup mode');
        await screenshot(page,`automatic-${width}-${look}`);
      }
      await setMode('popup'); await until(async()=>!await info(cdp),'popup screenshot mode');
      await page.locator('#native-rubric').click(); await until(()=>info(cdp,'gz-popup'),'popup screenshot');
      await page.waitForTimeout(450); await screenshot(page,`popup-${width}-${look}`); await page.close();
    }
    // A discussion's and View instructions' rubric links: Glaze's pop-up, out of the link with the genie, in place of Ultra's
    // Rubric Details; in Glaze's sidebar and in Ultra's own column, light and dark.
    for(const [name,url,kind] of [['discussion',`${site}/ultra/courses/_101_1/discussion/_8120_1`,'normal'],['attempt',`${site}/ultra/courses/_101_1/assessment/_8120_1/attempt/create`,'submitted']].filter(([n])=>run(n))) {
      await worker.evaluate(async motion=>chrome.storage.sync.set({motion}),{...settings.motion,level:'expressive',followSystem:false});
      for(const [sidebar,light] of [[true,false],[true,true],[false,false]]) {
        const where=`${name}${sidebar?' in the sidebar':''}${light?' (light)':''}`, {page,cdp}=await open({url,kind,sidebar,light});
        if(sidebar) await page.waitForSelector('[data-gz-sidebar-host="native"] #native-rubric');
        await page.waitForFunction(()=>document.documentElement.getAttribute('data-gz-motion')==='expressive');
        check(!await page.locator('#gz-rubric').count(),`${where}: nothing goes inline beside Ultra's rubric link`);
        await page.locator('#native-rubric').click(); const x=await until(()=>info(cdp,'gz-popup'),`${where} pop-up`);
        check(x.rows===2&&x.cols===4&&x.selected===(kind==='normal'?1:0)&&x.dialogFits&&x.focused,`${where}: the link opens Glaze's rubric pop-up ${kind==='normal'?'with the graded selection':'with no selections before grading'}`);
        check(x.animations.includes(420),`${where}: the pop-up opens with the genie (${x.animations.join(',')} ms)`);
        check(await page.evaluate(()=>window.__nativeRubricClicks===0&&!document.getElementById('native-rubric-panel'))&&new URL(page.url()).pathname===new URL(url).pathname,`${where}: Ultra's own Rubric Details does not open`);
        if(name==='attempt') check(await page.locator('#bb-editorassignment-attempt-authoring-submission').textContent()==='Untouched draft','the attempt\'s draft is untouched');
        await screenshot(page,`${name}-popup${sidebar?'-sidebar':''}-${light?'light':'dark'}`);
        await page.keyboard.press('Escape'); await until(async()=>!await page.locator('#gz-popup').count(),`${where} pop-up closes`);
        await until(()=>page.evaluate(()=>document.activeElement?.id==='native-rubric'),`${where} focus returns`); check(true,`${where}: closing returns focus to the link`);
        await page.close();
      }
      await worker.evaluate(async motion=>chrome.storage.sync.set({motion}),settings.motion);
    }
    if(run('sidebar')) {
      const {page,cdp}=await open({sidebar:true}); await until(()=>info(cdp),'inline with sidebar');
      await page.waitForSelector('.overview-attempts-section[data-gz-sidebar-host="native"]');
      check(await page.locator('.assessment-overview-grid > .overview-section').count()===4&&!await page.locator('#gz-sidebar').count(),'the active sidebar recognizes and retains the native assessment column beside the inline rubric');
      await page.evaluate(()=>{const li=document.createElement('li');li.innerHTML='<label>Native detail <input id="native-detail" value="Kept"></label>';document.querySelector('ul.section-content').append(li);});
      await setMode('site'); await until(async()=>!await info(cdp),'site mode with native detail');
      await setMode('auto'); await until(()=>info(cdp),'inline with native detail');
      check(await page.locator('#native-detail').isVisible()&&await page.locator('#native-detail').inputValue()==='Kept','unrelated native assessment details remain visible and intact');
      await page.close();
    }
    if(run('docreview')) {
      const start=requests.length, {page}=await open({kind:'review',url:`${site}${assessment}/student-submission-view`});
      await page.waitForSelector('#gz-review-strip',{state:'attached'});
      check(await page.locator('.rubric-inline-container').textContent()==='Rubric grade: 5 / 5Margin settingsProficient'&&!await page.locator('#gz-rubric,#gz-popup').count(),'document review keeps the existing Ultra attempt rubric native');
      check(!requests.slice(start).some(r=>r.path.includes('/gradebook/')),'the native submission rubric makes no assignment-rubric reads'); await page.close();
    }
    for(const spec of [{width:390,light:true},{width:320,rtl:true,large:true,reduced:true}].filter(()=>run('mobile'))) {
      const {page,cdp}=await open(spec); await page.locator('#native-rubric').click();
      const x=await until(()=>info(cdp,'gz-popup'),`${spec.width}px rubric pop-up`);
      check(x.pageFits&&x.dialogFits&&x.bodyFits,`${spec.width}px pop-up fits the page and dialog without sideways overflow`);
      check(x.scroll&&x.scrollable&&x.focusable&&x.labelled,`${spec.width}px table owns a labelled keyboard-accessible horizontal scroll region`);
      check(x.focused,`${spec.width}px pop-up takes focus`);
      await screenshot(page,`popup-${spec.width}`);
      for(let n=0;n<6;n++) await page.keyboard.press('Tab');
      check((await info(cdp,'gz-popup')).focused,`${spec.width}px Tab keeps focus inside the modal`);
      if(spec.reduced) check(x.animations.every(ms=>ms<=120),'reduced motion suppresses the long opening animation');
      check(await page.locator('html').getAttribute('data-gz-dark-theme') === (spec.light ? null : ''),`${spec.width}px pop-up follows its light or dark Look`);
      await page.keyboard.press('Escape'); await until(async()=>!await page.locator('#gz-popup').count(),'Escape closes pop-up');
      check(await page.evaluate(()=>document.activeElement?.id==='native-rubric'),'Escape restores focus to the native rubric trigger');
      await page.locator('#native-rubric').click(); await until(()=>info(cdp,'gz-popup'),'reopened pop-up');
      await page.setViewportSize({width:1440,height:900});
      check(!!await info(cdp,'gz-popup')&&!await info(cdp),'resizing while the modal is open preserves its presentation');
      await page.keyboard.press('Escape'); await until(async()=>!await page.locator('#gz-popup').count(),'resized pop-up closes');
      check(await page.evaluate(()=>document.activeElement?.id==='native-rubric'),'closing after a resize keeps focus on the rubric trigger');
      await page.locator('h1').evaluate(e=>{e.tabIndex=-1;e.focus();}); await until(()=>info(cdp),'resize applies inline after focus leaves the trigger');
      await page.close();
    }
    for(const mode of ['popup','site','inline-off'].filter(()=>run('settings'))) {
      const show = mode === 'inline-off' ? 'auto' : mode;
      const {page,cdp}=await open({show,inline:mode !== 'inline-off'});
      if(mode==='popup') { await page.locator('#native-rubric').click({modifiers:[process.platform === 'darwin' ? 'Meta' : 'Control']}); await page.waitForSelector('#native-rubric-panel'); check(!await page.locator('#gz-popup').count(),'a modified rubric click preserves the native action'); await page.locator('#native-rubric-panel').evaluate(e=>e.remove()); }
      await page.locator('#native-rubric').click();
      if(show!=='site') { await until(()=>info(cdp,'gz-popup'),'forced pop-up'); check(!await info(cdp),`${mode} stays modal even on a wide assignment`); }
      else { await page.waitForSelector('#native-rubric-panel'); check(!await page.locator('#gz-rubric,#gz-popup').count(),'The site\'s own preserves the native rubric action'); }
      await page.close();
    }
    if(run('fallback')) {
      const {page}=await open({kind:'forbidden'}); await until(()=>Promise.resolve(requests.some(r=>r.path.endsWith('/gradebook/columns/_300_1'))),'forbidden rubric read'); await page.locator('#native-rubric').click();
      await page.waitForSelector('#native-rubric-panel'); check(!await page.locator('#gz-rubric,#gz-popup').count(),'a forbidden rubric read leaves the native action available');await page.close();
    }
    if(run('stale')) {
      const {page}=await open({kind:'slow'}); await until(()=>Promise.resolve(slowSeen),'deferred rubric read');
      await page.evaluate(()=>{history.pushState(null,'',location.origin+'/ultra/courses/_101_1/outline');dispatchEvent(new PopStateEvent('popstate'));}); releaseSlow(); releaseSlow=null;
      await page.waitForFunction(()=>location.pathname.endsWith('/outline')); await pause(400);
      check(!await page.locator('#gz-rubric,#gz-popup').count(),'a delayed rubric response cannot mount on a different route'); await page.close();
    }
    for(const kind of ['normal','visible','peer','observer'].filter(()=>run('canvas'))) {
      const {page,cdp}=await open({kind,width:390,url:`${canvas}/courses/11/assignments/22${kind==='peer'?'?reviewee_id=99':''}`}); await page.locator('#native-rubric').click();
      if(kind==='normal'){await until(()=>info(cdp,'gz-popup'),'Canvas collapsed rubric pop-up');check(await page.evaluate(()=>window.__nativeRubricClicks===0),'Canvas own collapsed A2 toggle uses the shared pop-up');}
      else {await page.waitForFunction(()=>window.__nativeRubricClicks===1);check(!await page.locator('#gz-rubric,#gz-popup').count(),`Canvas ${kind} rubric stays native`);}
      await page.close();
    }
    if(run('frame')) {
      const {page,cdp}=await open({url:`${site}/frame-shell`}); const frame=await until(()=>Promise.resolve(page.frames().find(f=>f.name()==='gz-ctab:_101_1')),'course frame');
      await until(()=>info(cdp),'course-frame inline rubric');check(await frame.locator('.assessment-details-section #gz-rubric').count()===1,'a visible course frame renders inside its own Assessment Details');
      await frame.evaluate(()=>document.documentElement.setAttribute('data-gz-ctab-framed',''));
      await until(async()=>!await frame.locator('#gz-rubric').count(),'hidden course frame removes rubric');check(true,'a hidden course frame removes its rubric surface');
      await frame.evaluate(()=>document.documentElement.removeAttribute('data-gz-ctab-framed')); await until(()=>info(cdp),'course frame resumes rubric');
      check(true,'showing a course frame restores its rubric');await screenshot(page,'course-frame');
      await page.setViewportSize({width:390,height:900});await until(async()=>!await info(cdp),'course frame popup mode');
      await frame.locator('#native-rubric').click();await until(()=>info(cdp,'gz-popup'),'course frame modal');
      await frame.evaluate(()=>document.documentElement.setAttribute('data-gz-ctab-framed',''));
      await until(async()=>!await frame.locator('#gz-popup').count(),'hidden course frame closes popup');check(true,'hiding a course frame closes its owned rubric modal');await page.close();
    }
    check(errors.length===0,`no page errors (${errors.join('; ')})`);
    check(requests.every(r=>r.method==='GET'&&[site,canvas].includes(r.origin)),'every observed LMS request is a synthetic GET');
    passed = true; console.log(JSON.stringify({checks:checks.length,requests:requests.length,shots}));
  } finally {
    releaseSlow?.(); await context?.close(); if(tmp)fs.rmSync(tmp,{recursive:true,force:true}); if(ext)fs.rmSync(ext,{recursive:true,force:true});
    if(held)fs.rmSync(lock,{recursive:true,force:true});
    if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({passed,checks,requests,nativeRequests,errors},null,2)+'\n');}
  }
})().catch(e=>{console.error(e);if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'failure.txt'),e.stack+'\n');}process.exitCode=1;});
