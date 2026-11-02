// Real unpacked extension; invented homework in the frame/DOM shape observed in MyLab on 2026-11-02.
// No Pearson requests or real course content. Run with glaze-remote -o <dir> -- node checks/pearson/homework-check.js /out
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const ext = require('../../tools/dev/check-env.js').staged(process.env.EXT || path.resolve(__dirname, '../../extension'), []);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const D = require('../../extension/content/defaults.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pearson-check-'));
const out = process.argv[2], results = [], errors = [];
const check = (yes, label) => { assert.ok(yes, label); results.push(label); console.log(`ok ${label}`); };
const rgb = (hex) => `rgb(${hex.slice(1).match(/../g).map((x) => parseInt(x, 16)).join(', ')})`;
const shell = `<!doctype html><html><head><style>body{margin:0;background:white;color:#252525;font:16px Arial}nav{height:48px;padding:0 20px;display:flex;align-items:center;background:white}iframe{display:block;border:0;width:100%;height:calc(100vh - 48px)}</style></head><body><nav id="mainTopNavContainer"><h1>Sample mathematics</h1></nav><iframe title="Question Viewer" src="https://tdx.acs.pearson.com/assignment/assignmentplayer.aspx"></iframe></body></html>`;
const assignment = `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:white}iframe{border:0;width:100%;height:100%}</style></head><body><div id="assignmentViewer" class="playmode-homework"></div><iframe id="activityFrame" src="https://tdx.acs.pearson.com/Player/Player.aspx"></iframe></body></html>`;
const player = `<!doctype html><html style="--gz-ink: #123456 !important"><head><style>
  body{margin:0;color:#4d4d4d;background:white;font:16px Arial}.statusPanel{height:64px;display:flex;align-items:center;justify-content:space-between;background:#007899;color:white;padding:0 20px}.statusPanel h2{font-size:18px}
  .layout{display:grid;grid-template-columns:220px 1fr;height:calc(100vh - 180px)}.assignmentreviewnavpanel{border-right:1px solid #ccc}.assignmentreviewnavheader{padding:16px}.assignmentreviewnavListContainer ul{padding:0;background:white;list-style:none}.assignmentreviewnavListContainer li{padding:18px;border-left:4px solid transparent}.assignmentreviewnavListContainer li.selected{background:#fff4bb;border-color:#007899}a{color:#007899}
  .framePanel{padding:24px}.rvTxt,.fNormal{color:black}.equation{font-family:Georgia}.fInstructions{color:navy}.eqEditor{display:inline-block;border:1px solid blue}.eqEditor input{width:80px}.controlPanel{height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:linear-gradient(#eee,white)}button{padding:8px 16px;border:1px solid gray}.btn-primary{background:linear-gradient(135deg,coral,deeppink);color:white}.dijitMenu{background:white;color:black}.dijitSplitter{height:2px;background:#ddd}
  </style></head><body><div id="playerViewer" class="playmode-homework"><header class="statusPanel"><h2>Homework: Sample functions</h2><span>Question 3 · Part 1 of 2</span><button class="btn btnClose">Save</button></header><div class="layout"><aside class="assignmentreviewnavpanel"><div class="assignmentreviewnavheader">Question list</div><div class="assignmentreviewnavListContainer"><ul><li><a class="questionLabel" href="#one">Question 1</a></li><li><a class="questionLabel" href="#two">Question 2</a></li><li class="selected"><a class="questionLabel" href="#three">Question 3</a></li></ul></div></aside><main><section class="framePanel" id="top"><div class="contentHolder"><span class="rvTxt fNormal">Evaluate the sample function.</span> <span class="equation eqLabel fNormal"><span class="eqDocument"><span class="eqText">g(x) = 3x + 8</span></span></span><p>Diagram colors</p><svg width="70" height="35"><rect width="70" height="35" fill="#facc15"/></svg><canvas width="30" height="30"></canvas></div></section><div class="dijitSplitter"></div><section class="framePanel" id="bottom"><span class="equation eqEditor"><input aria-label="Sample answer" value="draft"><span class="eqDocument"><span class="eqText">draft</span></span></span> <span class="rvTxt fInstructions">Simplify your answer.</span></section></main></div><footer class="controlPanel"><button class="learningaid-button" type="button">View an example</button><button class="btn btn-primary" type="button" disabled>Check answer</button></footer><div class="dijitMenu" hidden>Menu</div></div></body></html>`;
const overview = `<!doctype html><html><head><style>
body{margin:0;background:white;font:16px Arial}.white-background{background:white;width:100%;padding:10px}.pageheader{border-bottom:1px solid #aaa;display:block}.pageheader h2{float:left}.help-items{float:right}.homework{background:white;padding:20px}.row{margin:0 -15px}.col-sm-6{width:50%;float:left}.col-sm-12{width:100%;float:left}.row:after{content:"";display:table;clear:both}.table-homework-details td{padding:10px}.table-score-details ul{display:table;width:100%;padding:0}.table-score-details li{display:table-cell;width:20%;border:1px solid #bbb}.question-details{padding:0;list-style:none}.question-details li{float:left;width:25%;padding:10px}.question-details:after{content:"";display:block;clear:both}.btn{padding:12px 24px;border:1px solid #555;display:inline-block}.dropdown-menu{display:none}.question-status{position:absolute;left:0;top:31px}
</style></head><body><div id="maindiv" class="white-background"><div class="xlbootstrap xlbootstrap3"><div class="xlbootstrap3"><div class="pageheader"><div class="page-assistance"><h2 id="PageHeaderTitle">Do Homework</h2></div><div id="PageHelp"><div class="help-items"><a class="print-icon" href="#print" aria-label="Print this page">P</a><div class="dropdown"><a id="ButtonHelp" class="btn" role="button" aria-expanded="false">Help</a><ul class="dropdown-menu"><li><a href="#help">Sample help</a></li></ul></div></div></div></div></div>
<section class="well homework"><div style="float:right;height:85px"><button id="btnGetPayLoad1" style="display: none">Hidden tutoring</button></div><div class="row"><div class="col-sm-6"><table class="table-homework-details" role="presentation"><tbody><tr id="sample_TrAssignmentName"><td>Name:</td><td><span id="sample_LblName">Sample homework</span></td></tr><tr><td>Due:</td><td>09/18/27 9:30pm</td></tr><tr><td>Last Worked:</td><td>09/02/27 1:15pm</td></tr><tr><td>Current Score:</td><td><span id="CurrentScore">25% (25 points out of 100)</span></td></tr><tr><td>Attempts:</td><td>Unlimited per question</td></tr></tbody></table></div><div class="col-sm-6"><aside class="well homework-reminders" style="display:none">A native reminder</aside></div></div><div class="row"><div id="dvQuestionPanel" class="col-sm-12"><div id="exPanel"><section class="table-score-details" role="presentation"><ul><li class="standardtotal">Questions: 20</li><li class="standardtotal">Scored: 5</li><li class="standardtotal">Correct: 5</li><li class="standardtotal">Partial Credit: 0</li><li class="standardtotal">Incorrect: 0</li></ul></section><section role="presentation"><ul class="question-details question-details-foundations">${Array.from({length:20},(_,i)=>`<li><span style="text-align:right"><img class="question-status" src="${i<5?'https://mylab.pearson.com/synthetic-correct.svg':'https://mylab.pearson.com/synthetic/overview_spacer.gif'}" alt="${i<5?'Correct':''}" width="14" height="14" aria-hidden="true"></span><span style="text-decoration:underline"><a id="sampleQuestion${i+1}" href="javascript:doExercise(${i+1})">Question&nbsp;${i+1}</a></span><span class="pts" style="width:30px"><span>&nbsp;(${i<5?5:0}/5)</span></span><span style="white-space:nowrap"></span></li>`).join('')}<li></li></ul></section></div></div></div></section>
<div id="divOKBtn" style="display:none"><a id="ButtonOK" class="btn" href="#ok">OK</a></div><div id="divStartBtn"><a id="ButtonStart" class="btn" href="#start" style="display:none;float:left">Start</a></div><div id="divResumeBtn"><a id="ButtonReview" class="btn" href="javascript:goHomeworkReview()" style="display:block;float:left">Review</a><a id="ButtonResume" class="btn" href="javascript:getNextQuestionId()" style="display:block;float:left">Resume</a></div></div></div><script>window.doExercise=n=>{window.openedQuestion=n;window.questionOpens=(window.questionOpens||0)+1};window.goHomeworkReview=()=>window.reviewClicks=(window.reviewClicks||0)+1;window.getNextQuestionId=()=>window.resumeClicks=(window.resumeClicks||0)+1;window.overviewLinks=[...document.querySelectorAll('.question-details a')];document.getElementById('ButtonHelp').addEventListener('click',function(){const open=this.getAttribute('aria-expanded')!=='true';this.setAttribute('aria-expanded',String(open));document.querySelector('.dropdown-menu').style.display=open?'block':'none';});</script></body></html>`;
const playerReady = player.replace('</body>', `<script>
  const root=document.getElementById('playerViewer'), old=root.querySelector('.layout'), nav=old.querySelector('aside'), content=old.querySelector('main'), header=root.querySelector('.statusPanel'), footer=root.querySelector('.controlPanel');
  const main=document.createElement('div');main.className='mainPanel';main.style.cssText='position:relative;width:100%;height:calc(100vh - 48px)';
  const headerWrap=document.createElement('div'), bar=document.createElement('div');bar.className='headerbar';bar.append(header);headerWrap.append(bar);
  const panel=document.createElement('div');panel.className='contentPanel';content.className='dijitBorderContainer';panel.append(content);
  const bottom=document.createElement('div');bottom.className='controlpanelholder';bottom.append(footer);
  const navRoot=document.createElement('div');navRoot.className='assignmentreviewnav';navRoot.style.height='775px';
  const navTable=document.createElement('div');navTable.className='assignmentreviewnavtablediv';navTable.style.height='0px';
  const list=nav.querySelector('.assignmentreviewnavListContainer');
  list.querySelector('ul').innerHTML=Array.from({length:20},(_,i)=>'<li tabindex="0" class="'+(i===2?'selected':'')+'"><span class="leftSide"><span class="questionStatusIcon '+(i<2?'correct':'')+'" aria-hidden="true"></span><a class="questionLabel" href="#sample-'+i+'" tabindex="-1">Question '+(i+1)+'</a></span></li>').join('');
  list.addEventListener('click',e=>{const row=e.target.closest('li');if(row){e.preventDefault();window.nativeNavClicks=(window.nativeNavClicks||0)+1;list.querySelector('.selected')?.classList.remove('selected');row.classList.add('selected');}});
  navTable.append(list);navRoot.append(nav.querySelector('.assignmentreviewnavheader'),navTable);nav.append(navRoot);
  const palette=document.createElement('div');palette.className='palettePanel';
  palette.innerHTML='<div class="xlInlineMathPalette"><div class="palette"><div class="keyRow"><button class="btn toolButton iconSynthetic" type="button" aria-label="Insert sample symbol" style="width:44px;height:36px;background-image:url(https://cdn.acs.pearsonprd.tech/synthetic-symbol.svg);background-repeat:no-repeat;background-position:center"></button><button class="btn toolButton iconDiv" type="button" title="Fraction   /">&nbsp;</button><button class="btn toolButton iconSqrt" type="button" title="Square root   \\\\sqrt">&nbsp;</button><button class="btn toolButton iconMoreTools" type="button" title="More">More</button></div></div><div class="palette hidden"><div class="keyRow"><button type="button" class="btn toolButton iconInf" title="Infinity   \\\\inf">&nbsp;</button><button class="btn toolButton iconLessTools" type="button" title="Less">Less</button></div></div></div>';
  palette.querySelector('.iconDiv').addEventListener('click',()=>{window.originalAnswer.value+='/';window.fractionClicks=(window.fractionClicks||0)+1;});
  palette.querySelectorAll('.iconMoreTools,.iconLessTools').forEach(b=>b.addEventListener('click',()=>palette.querySelectorAll('.palette').forEach(p=>p.classList.toggle('hidden'))));
  main.append(headerWrap,nav,panel,palette,bottom);old.remove();root.prepend(main);
  window.originalAnswer=root.querySelector('input');window.originalSymbol=palette.querySelector('button');
  window.originalSymbol.addEventListener('click',()=>{window.originalAnswer.value+='+';window.nativeClicks=(window.nativeClicks||0)+1;});
  const style=document.createElement('style');style.textContent='.mainPanel>.assignmentreviewnavpanel{position:absolute;left:0;top:64px;bottom:110px;width:220px;overflow:auto}.assignmentreviewnav{overflow:hidden}.assignmentreviewnavtablediv{overflow:auto}.palette.hidden{display:none}.contentPanel{position:absolute;left:220px;top:64px;right:0;bottom:110px;overflow:auto}.palettePanel{position:absolute;left:220px;bottom:68px;right:0;height:42px}.controlpanelholder{position:absolute;left:0;bottom:0;right:0}.contentPanel>.dijitBorderContainer{height:100%}';document.head.append(style);
</script></body>`);
const plain = '<!doctype html><html><body style="background:white;color:black"><div id="playerViewer" class="playmode-test">Sample test</div></body></html>';
const color = (frame, selector, prop = 'backgroundColor') => frame.locator(selector).first().evaluate((e, p) => {
  const value = getComputedStyle(e)[p];
  if (!['backgroundColor', 'color'].includes(p) || !value.startsWith('color(')) return value;
  const c = document.createElement('canvas'); c.width = c.height = 1; const ctx = c.getContext('2d'); ctx.fillStyle = value; ctx.fillRect(0,0,1,1);
  return `rgb(${[...ctx.getImageData(0,0,1,1).data].slice(0,3).join(', ')})`;
}, prop);
const themed = (frame, yes = true) => frame.waitForFunction((on) => document.documentElement.hasAttribute('data-gz-pearson') === on, yes);
const until = async (fn) => {
  for (const end = Date.now() + 10000; ; await new Promise((r) => setTimeout(r, 50))) {
    if (await fn()) return;
    if (Date.now() > end) throw Error('Pearson theme did not settle');
  }
};
(async () => {
  let ctx;
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 820 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(String(e))));
    await ctx.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.pathname === '/synthetic-correct.svg') return r.fulfill({ contentType:'image/svg+xml', body:'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="m2 8 4 4 8-9" fill="none" stroke="green" stroke-width="3"/></svg>' });
      if (u.pathname === '/synthetic/overview_spacer.gif') return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"/>'});
      if (u.href === 'https://cdn.acs.pearsonprd.tech/synthetic-symbol.svg') return r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z" fill="black"/></svg>' });
      let body = plain;
      if (u.hostname === 'mylab.pearson.com' && u.pathname === '/Student/PlayerHomework.aspx') body = shell;
      if (u.hostname === 'mylab.pearson.com' && u.pathname === '/Student/OverviewHomework.aspx') body = overview;
      if (u.hostname === 'tdx.acs.pearson.com' && u.pathname === '/assignment/assignmentplayer.aspx') body = assignment;
      if (u.hostname === 'tdx.acs.pearson.com' && u.pathname === '/Player/Player.aspx') body = playerReady;
      if (u.hostname === 'tdx.acs.pearson.com' && u.search === '?test') body = plain;
      if (['mylab.pearson.com', 'tdx.acs.pearson.com', 'pearson.example.test'].includes(u.hostname)) return r.fulfill({ contentType: 'text/html; charset=utf-8', body });
      return r.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${id}/options.html`);
    await env.installed(opts);
    await opts.evaluate(async (s) => { await chrome.storage.sync.set(s); }, { enabled: true, colors: D.GZ_DEFAULTS.colors, auto: D.GZ_DEFAULTS.auto, look: D.GZ_DEFAULTS.look });
    const page = await ctx.newPage();
    await page.goto('https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=101');
    const assigned = page.frame({ url: /\/assignment\/assignmentplayer\.aspx/ });
    const play = page.frame({ url: /\/Player\/Player\.aspx/ });
    for (const f of [page, assigned, play]) await themed(f);
    await until(async()=>await color(play,'.btn-primary')===rgb(D.GZ_DEFAULTS.colors['--gz-accent']));
    check(true, 'the real manifest themes the shell and both nested player documents');
    for (const f of [page, assigned, play]) check(await color(f, 'body') === rgb(D.GZ_DEFAULTS.colors['--gz-surface']), 'each document uses the saved Frost surface');
    check(await color(play, '.rvTxt', 'color') === rgb(D.GZ_DEFAULTS.colors['--gz-ink']), 'hardcoded black question text follows the palette');
    check(await color(play, '.eqText', 'color') === rgb(D.GZ_DEFAULTS.colors['--gz-ink']), 'math glyphs follow the palette');
    check(await play.locator('.assignmentreviewnavListContainer ul').evaluate(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'), 'the native white question-list backing gives way to the themed sidebar');
    check(await color(play, '.selected') === rgb(D.GZ_DEFAULTS.colors['--gz-accent-soft']), 'the current question retains a visible selection');
    await play.locator('.selected').evaluate((e) => { e.style.backgroundImage = 'linear-gradient(rgba(244,217,123,.5),rgba(244,217,123,.5))'; });
    check(await color(play, '.selected', 'backgroundImage') === 'none', 'the native yellow selection gradient cannot wash out the palette');
    await play.locator('.dijitSplitter').evaluate((e) => { e.innerHTML = '<div class="horizontalsplitterHandle" style="background:#f3f5f6"><span class="horizontalHandleSpan2"></span></div><div class="splitterHorizontalLine"></div>'; });
    check(await color(play, '.horizontalsplitterHandle') === rgb(D.GZ_DEFAULTS.colors['--gz-surface-2']), 'the native splitter handle uses the palette');
    check(await color(play, '.btn-primary') === rgb(D.GZ_DEFAULTS.colors['--gz-accent']), 'the check-answer control uses the theme accent');
    check(await color(play, 'svg', 'filter') === 'none' && await color(play, 'canvas', 'filter') === 'none' && await play.locator('svg rect').getAttribute('fill') === '#facc15', 'diagrams and canvas are not inverted or recolored');
    check((await color(play, '.equation', 'fontFamily')).includes('Georgia'), 'native equation fonts are preserved');
    await play.getByLabel('Sample answer').fill('unsent work');
    await play.waitForFunction(() => document.documentElement.hasAttribute('data-gz-pearson-viewer') && document.querySelector('.toolButton[data-gz-pearson-icon]'));
    const rowHit = (el) => { const r=el.getBoundingClientRect();return r.height>0&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); };
    check(await play.locator('.selected').evaluate(rowHit), 'the selected question is visible and receives pointer hits despite Pearson setting its list wrapper to zero height');
    await play.locator('.assignmentreviewnavListContainer li').last().scrollIntoViewIfNeeded();
    check(await play.locator('.assignmentreviewnavListContainer li').last().evaluate(rowHit), 'the final question remains reachable in the independent question-list scroll area');
    await play.locator('.assignmentreviewnavListContainer li').nth(2).scrollIntoViewIfNeeded();
    await play.locator('.assignmentreviewnavListContainer li').nth(2).click();
    check(await play.evaluate(()=>window.nativeNavClicks)===1, 'the original question-row click handler runs exactly once');
    check(await play.evaluate(() => window.originalAnswer === document.querySelector('input') && window.originalSymbol === document.querySelector('.toolButton')), 'the viewer keeps the original input and symbol button nodes');
    const boxes = await Promise.all(['#top', '#bottom'].map((s) => play.locator(s).boundingBox()));
    check(boxes[1].y >= boxes[0].y + boxes[0].height, 'the prompt and answer area form one worksheet without an absolute split');
    const iconPixel = async () => {
      const png = await play.locator('.toolButton').first().screenshot();
      return opts.evaluate(async (png) => {
        const im = new Image(); im.src = `data:image/png;base64,${png}`; await im.decode();
        const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
        return [...ctx.getImageData(Math.floor(im.width / 2), Math.floor(im.height / 2), 1, 1).data].slice(0,3);
      }, png.toString('base64'));
    };
    check((await iconPixel()).every((v,i) => Math.abs(v - [232,242,250][i]) < 3), 'a cross-origin native symbol image is visibly painted in theme ink');
    await play.getByRole('button', { name: 'Insert sample symbol', exact: true }).click();
    check(await play.getByLabel('Sample answer').inputValue() === 'unsent work+' && await play.evaluate(() => window.nativeClicks) === 1, 'the native symbol click handler still inserts exactly once');
    await play.getByLabel('Sample answer').fill('unsent work');
    await play.getByRole('button', { name: 'Questions', exact: true }).click();
    check(!await play.locator('.assignmentreviewnavpanel').isVisible(), 'the question list can collapse without changing the problem');
    await play.getByRole('button', { name: 'Questions', exact: true }).click();
    await play.getByRole('button', { name: 'Pearson layout', exact: true }).click();
    check(await play.locator('html').getAttribute('data-gz-pearson-viewer') === null && await play.getByLabel('Sample answer').inputValue() === 'unsent work', 'the original-layout switch preserves unsent input');
    await play.getByRole('button', { name: 'Problem viewer', exact: true }).click();
    check(await play.locator('.iconDiv .gz-pearson-symbol').count()===1 && await play.locator('.iconDiv').getAttribute('aria-label')==='Fraction /', 'common math templates have crisp vector artwork and a native localized accessible name');
    await play.locator('.xlInlineMathPalette').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    const mathTarget = await play.locator('.iconDiv').boundingBox();
    check(mathTarget.width>=44 && mathTarget.height>=44, 'math symbols have at least a 44-pixel target');
    await play.locator('.iconDiv').click();
    check(await play.getByLabel('Sample answer').inputValue()==='unsent work/' && await play.evaluate(()=>window.fractionClicks)===1, 'the vector symbol overlay leaves the original insertion handler running once');
    await play.locator('.iconDiv').evaluate(e=>{e.textContent='\u00a0';});
    await until(async()=>await play.locator('.iconDiv .gz-pearson-symbol').count()===1);
    check(true, 'Pearson replacing a native button label restores one vector symbol without replacing its button');
    await play.getByLabel('Sample answer').fill('unsent work');
    await play.getByRole('button',{name:'More',exact:true}).click();
    check(await play.locator('.iconInf .gz-pearson-symbol').isVisible(), 'the native More control exposes the restyled extended symbol palette');
    await play.getByRole('button',{name:'Less',exact:true}).click();
    check(await play.locator('.iconInf').isHidden(), 'the native palette still owns which symbols are shown');
    check((await color(play,'.contentPanel > .dijitBorderContainer','animationName'))!=='none', 'problem entrances use Glaze motion');
    await opts.evaluate(async ()=>{await chrome.storage.sync.set({motion:{level:'off',followSystem:false}});});
    await until(async()=>await color(play,'.contentPanel > .dijitBorderContainer','animationName')==='none');
    check(await color(play,'.toolButton','transitionDuration').then(s=>s.split(',').every(t=>parseFloat(t)===0)), 'motion Off stops worksheet entrances and symbol transitions');
    await opts.evaluate(async motion=>chrome.storage.sync.set({motion}), {...D.GZ_DEFAULTS.motion,followSystem:true});
    await page.emulateMedia({reducedMotion:'reduce'});
    await until(async()=>await color(play,'.contentPanel > .dijitBorderContainer','animationName')==='none');
    check(true, 'system reduced motion disables Pearson animations');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await until(async()=>await color(play,'.contentPanel > .dijitBorderContainer','animationName')!=='none');
    await opts.evaluate(async ()=>{await chrome.storage.sync.set({motion:{level:'subtle',enter:false,followSystem:false}});});
    await until(async()=>await color(play,'.contentPanel > .dijitBorderContainer','animationName')==='none');
    check(true, 'the entrance switch is honored independently of the motion level');
    await opts.evaluate(async motion=>chrome.storage.sync.set({motion}),D.GZ_DEFAULTS.motion);
    await play.evaluate(() => {
      const overlay = document.createElement('div'); overlay.className='dijitDialogUnderlay'; overlay.style.cssText='position:fixed;inset:0;background:white;opacity:.7;z-index:199';
      const dialog = document.createElement('div'); dialog.className='dijitDialog feedbackDialog correct'; dialog.style.cssText='position:fixed;top:180px;left:400px;width:360px;z-index:200';
      dialog.innerHTML='<div class="titleBar"><span class="titleText" style="color:#05112a">Sample feedback</span></div><div class="messageHolder"><div class="messageBox" style="background:white">Sample message</div></div><div class="buttonBar" style="background:white"><button type="button" class="btn">OK</button></div>';
      document.body.append(overlay,dialog);
    });
    check(await color(play, '.buttonBar') === rgb(D.GZ_DEFAULTS.colors['--gz-surface']) && await color(play, '.messageBox') === rgb(D.GZ_DEFAULTS.colors['--gz-surface']), 'feedback message and button panels cannot remain white');
    const overlayColor = await color(play, '.dijitDialogUnderlay');
    check(await color(play, '.titleText', 'color') === rgb(D.GZ_DEFAULTS.colors['--gz-ok']) && overlayColor.match(/\d+/g).map(Number).every((v,i) => Math.abs(v - [6,13,24][i]) <= 2), 'feedback title and modal backdrop follow the theme');
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'feedback-frost.png') }); }
    await play.locator('.feedbackDialog,.dijitDialogUnderlay').evaluateAll((es) => es.forEach((e) => e.remove()));
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'homework-frost.png') }); }

    const paper = D.GZ_PRESETS.find(([name]) => name === 'Paper')[1];
    await opts.evaluate(async (colors) => { await chrome.storage.sync.set({ colors }); }, paper);
    await until(async () => (await Promise.all([page, assigned, play].map((f) => color(f, 'body')))).every((c) => c === rgb(paper['--gz-surface'])));
    check(await color(play, '.eqText', 'color') === rgb(paper['--gz-ink']), 'a saved light palette reaches every frame without reload');
    check(await play.getByLabel('Sample answer').inputValue() === 'unsent work', 'theme changes preserve native answer text');
    const lightGlyph = await iconPixel();
    check(lightGlyph.every((v,i) => Math.abs(v - [20,24,31][i]) < 3), `symbol artwork also follows a light palette without losing its glyph (${lightGlyph})`);
    check(await play.locator('.btn-primary').isDisabled(), 'theme changes preserve disabled controls');
    if (out) await page.screenshot({ path: path.join(out, 'homework-paper.png') });
    await opts.evaluate(async () => { await chrome.storage.sync.set({ enabled: false }); });
    for (const f of [page, assigned, play]) await themed(f, false);
    check(await color(play, '.eqText', 'color') === 'rgb(0, 0, 0)', 'Glaze off restores native math ink');
    check(await play.locator('html').evaluate((e) => [e.style.getPropertyValue('--gz-ink'), e.style.getPropertyPriority('--gz-ink')].join('|')) === '#123456|important', 'Glaze off restores preexisting inline variables and priorities');
    check(await play.getByLabel('Sample answer').inputValue() === 'unsent work', 'turning Glaze off preserves native answer text');
    check(await play.locator('.toolButton').first().getAttribute('data-gz-pearson-icon') === null && (await color(play, '.toolButton', 'backgroundImage')).includes('synthetic-symbol.svg'), 'Glaze off restores native symbol artwork');
    check(await play.locator('.gz-pearson-symbol').count()===0 && await play.locator('.iconDiv').getAttribute('aria-label')===null, 'Glaze off removes the symbol decoration and restores native attributes');

    const custom = { ...D.GZ_DEFAULTS.colors, '--gz-surface': '#20212a', '--gz-accent': '#ddbbff' };
    await opts.evaluate(async (colors) => { await chrome.storage.sync.set({ enabled: true, colors }); }, custom);
    await themed(play);
    check(await color(play, 'body') === rgb(custom['--gz-surface']), 'custom colors are honored');
    await opts.evaluate(async () => { const { enhance } = await chrome.storage.sync.get('enhance'); await chrome.storage.sync.set({ enhance: { ...enhance, pearsonViewer: false } }); });
    await play.waitForFunction(() => !document.documentElement.hasAttribute('data-gz-pearson-viewer'));
    check(true, 'the persistent viewer setting turns the new layout off');
    await opts.evaluate(async () => { const { enhance } = await chrome.storage.sync.get('enhance'); await chrome.storage.sync.set({ enhance: { ...enhance, pearsonViewer: true } }); });
    await play.waitForFunction(() => document.documentElement.hasAttribute('data-gz-pearson-viewer'));
    await page.setViewportSize({ width: 390, height: 844 });
    check(await play.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the worksheet fits a narrow viewport');
    await play.getByLabel('Sample answer').scrollIntoViewIfNeeded();
    if (out) await page.screenshot({ path: path.join(out, 'homework-narrow.png') });
    await page.setViewportSize({ width: 1280, height: 820 });
    const look = { ...D.GZ_DEFAULTS.look, surfaceCustom: true, surfaceColor: '#152536', surfaceTint: 15, surfaceBorder: 50, glass: 18, depth: 3, font: 'serif', head: 'mono', scale: 1.15, density: 'roomy' };
    await opts.evaluate(async ({ look, bg }) => { await chrome.storage.sync.set({ look, bg, extras: { pointer: 'aqua', pointerOn: true } }); }, { look, bg: { ...D.GZ_DEFAULTS.bg, kind: 'gradient' } });
    await play.waitForSelector('#gz-pearson-backdrop',{state:'attached'});
    await play.waitForSelector('#gz-pearson-backdrop[data-ready]');
    check(true, 'the background frame is revealed only after its own renderer confirms a theme paint');
    let background;
    await until(async () => { background = play.childFrames().find((f) => f.url().includes('backdrop&saved')); return background && await background.locator('html').getAttribute('data-preview-ready') === 'true'; });
    await play.evaluate(async()=>{
      document.querySelector('#gz-pearson-backdrop').removeAttribute('data-ready');
      await new Promise(resolve=>{addEventListener('message',()=>resolve(),{once:true});postMessage({gzPearsonBackdropReady:true},location.origin);});
    });
    check(await play.locator('#gz-pearson-backdrop').getAttribute('data-ready')===null, 'a readiness message from the Pearson page cannot reveal an unpainted extension frame');
    await background.evaluate(()=>parent.postMessage({gzPearsonBackdropReady:true},new URL(document.referrer).origin));
    await play.waitForSelector('#gz-pearson-backdrop[data-ready]');
    check(await background.locator('html').getAttribute('data-gz-bg') === 'gradient', 'the saved full-Look renderer draws the selected background');
    check(await play.locator('html').evaluate((e) => e.style.getPropertyValue('--gz-surface-color')) === '#152536' && await play.locator('html').getAttribute('data-gz-depth') === '3', 'custom surface color, tint, border and depth settings reach Pearson');
    check((await color(play, '.gz-pearson-controls button', 'fontFamily')).includes('serif') && await play.locator('html').evaluate((e) => e.style.getPropertyValue('--gz-scale')) === '1.15', 'the Look font and scale reach the viewer');
    check(await play.locator('html').getAttribute('data-gz-cursor') !== null, 'the chosen Glaze pointer reaches Pearson');
    await background.evaluate(() => { window.parentProbe = new Promise((resolve) => addEventListener('message', () => resolve(true), { once: true })); });
    await play.locator('#gz-pearson-backdrop').evaluate((e) => e.contentWindow.postMessage({ gzPreview: { enabled: false } }, '*'));
    await background.evaluate(() => window.parentProbe);
    check(await background.locator('html').getAttribute('data-gz-bg') === 'gradient', 'the saved renderer does not take settings from its Pearson parent');
    if (out) await page.screenshot({ path: path.join(out, 'homework-full-look.png') });
    await opts.evaluate(async()=>{await chrome.storage.sync.set({lookX:await GZ_XPARTS.pack({x:{anim:{'page.enter':{ms:350,s:[{at:0,o:0,y:12},{at:100,o:1,y:0}]}}}})});});
    await until(async()=>/gz-x-/.test(await color(play,'.contentPanel > .dijitBorderContainer','animationName')));
    check(true, 'the saved Look’s own page animation reaches the problem viewer');
    for (const [kind, x] of [
      ['scene', null],
      ['shader', { bg: { shader: { src: 'vec4 scene(vec2 uv){return vec4(0.12,0.24,0.36,1.0);}' } } }],
      ['layers', { bg: { layers: [{ k: 'gradient', c: ['accent', 'surface-2'] }] } }],
    ]) {
      await opts.evaluate(async ({ kind, x, bg }) => {
        if (kind === 'shader' && !GZ_GLSL.check(x.bg.shader.src).ok) throw Error('Invalid synthetic shader');
        const lookX = x ? await GZ_XPARTS.pack({ x }) : '';
        await chrome.storage.sync.set({ bg: { ...bg, kind }, lookX });
      }, { kind, x, bg: D.GZ_DEFAULTS.bg });
      await until(async () => await background.locator('html').getAttribute('data-gz-bg') === kind);
      await background.waitForSelector('#gz-scene');
      check(true, `the saved ${kind} background reaches Pearson's renderer`);
    }
    const kept = await opts.evaluate(async (b64) => chrome.runtime.sendMessage({ type: 'glaze:media', op: 'put', kind: 'image', b64 }), fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/media/anim.webp')).toString('base64'));
    check(kept.ok, 'the synthetic media fixture is kept through the normal media broker');
    await opts.evaluate(async ({ h, bg }) => {
      const lookX = await GZ_XPARTS.pack({ x: { bg: { media: { type: 'image', src: `file:${h}`, dim: 0 } } } });
      await chrome.storage.sync.set({ bg: { ...bg, kind: 'media' }, lookX });
    }, { h: kept.h, bg: D.GZ_DEFAULTS.bg });
    await background.waitForFunction(() => document.querySelector('#gz-scene img')?.naturalWidth > 0);
    check(true, "a kept animated-image Look actually decodes in Pearson's background frame");
    await opts.evaluate(async (d) => { await chrome.storage.sync.set({ look: d.look, bg: d.bg, extras: d.extras }); }, D.GZ_DEFAULTS);
    await until(async () => await play.locator('#gz-pearson-backdrop').count() === 0);
    check(true, 'switching back to solid removes the background renderer');
    await page.emulateMedia({ media: 'print' });
    check(await color(play, 'body') === 'rgb(255, 255, 255)' && await color(play, '.eqText', 'color') === 'rgb(0, 0, 0)', 'printing uses native white paper and black math');
    check(await play.locator('.gz-pearson-controls').isHidden() && await play.locator('.gz-pearson-symbol').first().isHidden(), 'printing omits the viewer controls and decorative symbol overlays');
    await page.emulateMedia({ media: 'screen' });
    await play.locator('#playerViewer').evaluate((e) => { e.className = 'playmode-test'; });
    await themed(play, false);
    check(true, 'changing the player to test mode removes the theme');
    await play.locator('#playerViewer').evaluate((e) => { e.className = 'playmode-homework'; });
    await themed(play);
    check(true, 'changing back to homework reapplies the theme');
    await play.locator('#playerViewer').evaluate((e) => { const next = e.cloneNode(true); e.replaceWith(next); });
    await themed(play);
    await until(async () => await play.locator('.gz-pearson-controls').count() === 1);
    check(await play.locator('.toolButton').first().getAttribute('data-gz-pearson-icon') !== null, 'a replaced player gets one functional viewer toolbar and retains symbol artwork');
    await play.locator('#playerViewer').evaluate((e) => { e.className = 'playmode-test'; });
    await themed(play, false);
    check(true, 'a replaced player mode node is observed');

    const mode = await ctx.newPage();
    await mode.goto('https://tdx.acs.pearson.com/Player/Player.aspx?test');
    await mode.waitForLoadState('load');
    check(await mode.locator('html').getAttribute('data-gz-pearson') === null, 'test mode starts with native appearance');
    await mode.locator('#playerViewer').evaluate((e) => e.remove());
    await mode.locator('body').evaluate((e) => { const p = document.createElement('div'); p.id = 'playerViewer'; p.className = 'playmode-homework'; e.append(p); });
    await themed(mode);
    check(true, 'a homework player mounted after load is themed');
    await mode.goto('https://mylab.pearson.com/Student/OverviewHomework.aspx?homeworkId=101');
    await themed(mode);
    check(await color(mode, '#maindiv') === 'rgba(0, 0, 0, 0)', 'the overview leaves room for the saved background around its cards');
    check(await mode.locator('#maindiv').evaluate(e=>e.getBoundingClientRect().width<=1180), 'the overview has a centered readable maximum width');
    check(await mode.locator('.question-details').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)===4, 'desktop overview questions use four balanced columns');
    check(await mode.locator('.question-details a').count()===20 && await mode.locator('.question-details li').last().isHidden(), 'all native question links remain and the native empty trailing row is hidden');
    const nativeOverview=await mode.locator('#CurrentScore').textContent();
    await mode.locator('#exPanel').evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
    check(await mode.locator('.question-details li').first().evaluate(el=>{const a=el.querySelector('a').getBoundingClientRect(),im=el.querySelector('img').getBoundingClientRect();return Math.abs((a.y+a.height/2)-(im.y+im.height/2))<3}), 'native question status icons align with their question labels');
    const firstTile=await mode.locator('.question-details li').first().boundingBox();
    await mode.mouse.click(firstTile.x+firstTile.width-5,firstTile.y+firstTile.height-5);
    await mode.waitForFunction(()=>window.questionOpens===1).catch(async e=>{console.error(await mode.evaluate(({x,y})=>({opened:window.openedQuestion,count:window.questionOpens,handler:typeof window.doExercise,hit:document.elementFromPoint(x,y)?.outerHTML,pseudo:getComputedStyle(document.querySelector('.question-details a'),'::after').cssText}),{x:firstTile.x+firstTile.width-5,y:firstTile.y+firstTile.height-5}));throw e;});
    check(await mode.evaluate(()=>window.openedQuestion===1&&window.questionOpens===1&&window.overviewLinks.every((a,i)=>a===document.querySelectorAll('.question-details a')[i])), 'a question tile’s full area opens its original native link exactly once');
    await mode.locator('#ButtonReview').click();await mode.locator('#ButtonResume').click();
    await mode.waitForFunction(()=>window.reviewClicks===1&&window.resumeClicks===1);
    check(await mode.evaluate(()=>window.reviewClicks===1&&window.resumeClicks===1), 'Review and Resume keep their original native actions');
    check(await mode.locator('#ButtonStart').isHidden()&&await mode.locator('#divOKBtn').isHidden()&&await mode.locator('.homework-reminders').isHidden(), 'overview styling preserves native hidden action and reminder states');
    check(await color(mode,'#ButtonResume')===rgb(custom['--gz-accent'])&&await color(mode,'#ButtonResume','color')===rgb(custom['--gz-accent-ink']), 'Resume has the theme’s primary action colors');
    check((await mode.locator('[id$="_LblName"]').boundingBox()).height>(await mode.locator('.table-homework-details td').last().boundingBox()).height, 'the assignment name has clear visual priority');
    await mode.getByRole('button',{name:'Help',exact:true}).click();
    check(await mode.locator('.dropdown-menu').isVisible()&&await color(mode,'.dropdown-menu')!=='rgb(255, 255, 255)', 'the native Help menu remains usable and themed');
    await mode.getByRole('button',{name:'Help',exact:true}).click();
    if(out)await mode.screenshot({path:path.join(out,'overview-desktop.png')});
    await mode.setViewportSize({width:390,height:844});
    check(await mode.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)&&await mode.locator('.question-details').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length)===2, 'the phone overview uses two question columns without horizontal overflow');
    await mode.locator('.question-details a').last().scrollIntoViewIfNeeded();
    check(await mode.locator('.question-details a').last().evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.y>=0&&r.bottom<=innerHeight}), 'the final question remains reachable on a phone');
    if(out)await mode.screenshot({path:path.join(out,'overview-phone.png')});
    await opts.evaluate(async colors=>chrome.storage.sync.set({colors}),paper);
    await until(async()=>await color(mode,'.table-homework-details td','color')!==rgb(custom['--gz-ink']));
    check(await color(mode,'.table-homework-details td','color')===rgb(paper['--gz-ink-muted'])&&await mode.locator('#CurrentScore').textContent()===nativeOverview, 'overview light-theme changes preserve Pearson’s score content');
    await opts.evaluate(async()=>chrome.storage.sync.set({enabled:false}));await themed(mode,false);
    check(await mode.locator('.question-details').evaluate(e=>getComputedStyle(e).display)!=='grid'&&await mode.locator('#maindiv').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(255, 255, 255)', 'Glaze Off restores the overview’s native layout and appearance');
    await opts.evaluate(async colors=>chrome.storage.sync.set({enabled:true,colors}),custom);
    await mode.setViewportSize({width:1280,height:820});
    await themed(mode);

    for (const url of ['https://mylab.pearson.com/Student/DoAssignments.aspx', 'https://mylab.pearson.com/Student/PlayerHomework.aspx-other', 'https://pearson.example.test/Student/PlayerHomework.aspx']) {
      await mode.goto(url);
      await mode.waitForLoadState('load');
      check(await mode.locator('html').getAttribute('data-gz-pearson') === null && await color(mode, 'body') === 'rgb(255, 255, 255)', `outside homework: ${new URL(url).hostname}${new URL(url).pathname}`);
    }
    const auto = { ...D.GZ_DEFAULTS.auto, on: true, mode: 'device', light: 'Paper', dark: 'Frost' };
    await opts.evaluate(async (auto) => { await chrome.storage.sync.set({ auto }); }, auto);
    await page.emulateMedia({ colorScheme: 'dark' });
    await until(async () => await color(assigned, 'body') === rgb(D.GZ_DEFAULTS.colors['--gz-surface']));
    await page.emulateMedia({ colorScheme: 'light' });
    await until(async () => await color(assigned, 'body') === rgb(paper['--gz-surface']));
    check(true, 'device light/dark changes reach nested documents');
    check(errors.length === 0, `no page errors: ${errors.join(' | ')}`);
    console.log(`${results.length}/${results.length} Pearson homework checks passed`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
