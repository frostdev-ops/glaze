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
const grade = { id: '_510_1', courseId: '_101_1', userId: '_42_1', columnId: '_300_1', lastAttemptId: '_400_1', column: { id: '_300_1', contentId: '_8120_1', possible: 20 }, lastAttempt: { id: '_400_1', status: 'COMPLETED' }, submissionStatus: { status: 'GRADED' } };
const assignment = { id: '22', course_id: '11', name: 'Evidence and reasoning', restrict_quantitative_data: false, use_rubric_for_grading: true,
  rubric_settings: { id: '33', title: 'Evidence and reasoning', points_possible: 20, hide_points: false, hide_score_total: false },
  rubric: ['Evidence', 'Reasoning'].map((description, r) => ({ id: `c${r}`, points: 10, description, long_description: 'Readable criterion', ratings: [10,5,0].map((points, i) => ({ id: `r${r}${i}`, points, description: ['Excellent','Developing','Beginning'][i], long_description: 'Readable detail' })) })) };
const canvasHTML = (kind) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Assignment</title><link rel="stylesheet" href="/dist/brandable_css/rubric.css"><style>body{margin:0;padding:1rem;font:1rem/1.5 system-ui}*{box-sizing:border-box}</style></head><body class="assignments show"><div id="application" class="ic-app"><header id="header"></header><nav id="section-tabs"></nav><main id="content"><h1>A fictional assessment</h1><div id="assignments-2-student-header"></div>${kind === 'observer' ? '<div id="observer-picker-mountpoint"></div>' : ''}<section data-testid="rubric-tab"><button id="native-rubric" data-testid="fill-out-rubric-toggle" aria-expanded="${kind === 'visible'}">View Rubric</button><div data-testid="rubric-preview" ${kind === 'visible' ? '' : 'hidden'}>Native rubric</div></section></main></div><script>window.ENV={current_user_id:'42',ISOBSERVER:${kind === 'observer'},peer_review_mode_enabled:${kind === 'peer'},restrict_quantitative_data:false};window.__nativeRubricClicks=0;document.getElementById('native-rubric').addEventListener('click',function(){window.__nativeRubricClicks++;this.setAttribute('aria-expanded','true');document.querySelector('[data-testid="rubric-preview"]').hidden=false;});</script></body></html>`;
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
      if (req.isNavigationRequest()) return r.fulfill({ contentType:'text/html',body:u.origin === canvas ? canvasHTML(scenario) : scenario === 'review' ? fs.readFileSync(path.join(__dirname,'../test/fixtures/ultra-docreview.html'),'utf8').replace('<head>','<head><base href="/ultra/">') : html });
      if (u.pathname.endsWith('/rubric.css')) return r.fulfill({contentType:'text/css',body:''});
      let data = { results:[] };
      if (u.pathname.endsWith('/users/me') || u.pathname.endsWith('/users/self/profile')) data = { id:u.origin === canvas ? '42' : '_42_1',name:'Synthetic student' };
      else if (u.pathname.includes('/gradebook/grades')) { const row={...grade}; if(scenario==='unopened')for(const k of ['lastAttemptId','lastAttempt','status','submissionStatus'])delete row[k]; if(scenario==='submitted')Object.assign(row,{lastAttempt:{id:'_400_1',status:'NEEDS_GRADING'},submissionStatus:{status:'SUBMITTED'}}); data={results:[row]}; }
      else if (u.pathname.includes('/contents/')) data = { id:'_8120_1', contentDetail:{'resource/x-bb-asmt-test-link':{test:{gradingColumn:{id:'_300_1'},assessment:{gradableItemId:'_300_1'}}}} };
      else if (u.pathname.includes('/gradebook/columns/_300_1')) {
        if (scenario === 'forbidden') return r.fulfill({status:403,contentType:'application/json',body:'{}'});
        if (scenario === 'slow') { slowSeen = true; await new Promise(done => { releaseSlow = done; }); }
        data = { id:'_300_1',courseId:'_101_1',contentId:'_8120_1',possible:20,rubricAssociations:[association] };
      } else if (u.pathname.includes('/gradebook/attempts/')) data = { id:'_400_1',courseId:'_101_1',columnId:'_300_1',userId:'_42_1',status:scenario==='submitted'?'NEEDS_GRADING':'COMPLETED',rubricEvaluation:{...evaluation,...(scenario==='submitted'?{published:true,userId:'_42_1'}:scenario==='foreign-user'?{userId:'_43_1'}:{})} };
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
      await worker.evaluate(async enhance=>chrome.storage.sync.set({enhance}),{...settings.enhance,sidebar});
      scenario=kind; await setMode(show,inline); await worker.evaluate(async ({preset,colors})=>chrome.storage.sync.set({preset,colors}), {preset:light?'Paper':'Frost',colors:G.GZ_PRESETS.find(([name])=>name===(light?'Paper':'Frost'))[1]}); const p=await context.newPage(); p.on('pageerror',e=>errors.push(e.message)); await p.setViewportSize({width,height:900}); await p.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
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
    if(run('submitted')) {
      const {page}=await open({kind:'submitted'});
      check(!await page.locator('#gz-rubric,#gz-popup').count(),'a published evaluation of an ungraded submission cannot promote after-submission rubric visibility');
      await page.locator('#native-rubric').click();await page.waitForSelector('#native-rubric-panel');check(true,'an unavailable after-submission rubric retains its native control');await page.close();
    }
    if(run('foreign-user')) {
      const {page,cdp}=await open({kind:'foreign-user'}), x=await until(()=>info(cdp),'graded rubric with a foreign evaluation');
      check(x.selected===0&&!x.text.includes('Strong evidence.'),'an evaluation naming another user shows the graded rubric without its selections');await page.close();
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
