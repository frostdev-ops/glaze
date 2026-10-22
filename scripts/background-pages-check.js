// Real unpacked extension and renderer on routed Ultra page fixtures; no account or external network.
// NODE_PATH=<playwright> nice -n 15 node scripts/background-pages-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.resolve(__dirname, '..'));
const G = require(path.join(root, 'defaults.js'));
const id = [...crypto.createHash('sha256').update(root).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
const origin = 'https://bb.school.test', uid = '_42_1', out = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'glaze-background-pages-'));
const fixture = fs.readFileSync(path.join(root,'test/fixtures/ultra-course.html'),'utf8').replace('</style>', `
  .course-content-container > .panel-wrap { top:var(--gz-navbar-top,0px); left:var(--gz-navbar-left,0px); }
  </style>`);
const lock = require('./check-env.js').lockPath();
let ctx, held=false; const results=[], errors=[];
const until = async fn => { const end=Date.now()+15000; while(Date.now()<end) { const v=await fn(); if(v)return v; await new Promise(r=>setTimeout(r,100)); } throw Error('background did not settle'); };
const check = (value,label) => { assert.ok(value,label); results.push(label); };
(async()=>{
  try {
    fs.mkdirSync(lock); held=true; fs.writeFileSync(path.join(lock,'owner'),`${process.pid}\nbackground-pages-check\n`);
    await require('./wait-for-browser.js')();
    ctx=await chromium.launchPersistentContext(path.join(tmp,'profile'),{headless:true,...require('./check-env.js').chromeLaunch(),viewport:{width:1800,height:1000},reducedMotion:'reduce',args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`,'--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});
    await ctx.route('**/*',r=>{
      const u=new URL(r.request().url());
      if(u.protocol==='chrome-extension:')return r.continue();
      if(u.origin===origin && u.pathname.startsWith('/ultra'))return r.fulfill({contentType:'text/html',body:fixture});
      if(u.origin===origin && u.pathname.endsWith('/users/me'))return r.fulfill({json:{id:uid}});
      if(u.origin===origin && u.pathname.includes('/learn/api/'))return r.fulfill({json:{results:[]}});
      if(u.origin==='https://cdn.school.test' && u.pathname.endsWith('.css'))return r.fulfill({contentType:'text/css',body:''});
      return r.abort();
    });
    const opts=await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const settings={...G.GZ_DEFAULTS,navbar:{...G.GZ_DEFAULTS.navbar,on:true,place:'top',style:'float'},bg:{...G.GZ_DEFAULTS.bg,kind:'scene',scene:'contours'},motion:{...G.GZ_DEFAULTS.motion,level:'off'},enhance:Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map(k=>[k,['sidebar','notes','widgets','tabs','place'].includes(k)]))};
    await opts.evaluate(async({settings,origin,uid})=>{
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ultra:[origin],[`sidebar:ultra:${origin}/${uid}`]:{v:1,rev:1,mig:1,dock:[{id:'notes'}],dest:{notes:'dock'}},[`ctabs:${origin}:${uid}`]:{tabs:[101,102].map((n,i)=>({cid:`_${n}_1`,name:`Course ${n}`,path:`/ultra/courses/_${n}_1/outline`,top:0,at:i,pin:true}))}});
    },{settings,origin,uid});
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.text().startsWith('[Glaze] Background'))console.error(m.text());});
    const paths=['institution-page','course','stream','calendar','grades','messages',...['outline','calendar','announcements','engagement','grades','messages','groups/enrollments','achievements','document/_8110_1?view=content&state=view','assessment/_8120_1/overview','assessment/_8121_1/overview','outline/edit/document/_9001_1','outline/assessment/_9002_1/overview','outline/discussion/_9003_1'].map(p=>`courses/_101_1/${p}`)];
    for(const p of process.env.BG_RETAINED_ONLY ? [] : paths){
      await page.goto(`${origin}/ultra/${p}`);
      await until(()=>page.evaluate(()=>{const c=document.querySelector('#gz-scene');return c && c.width>0 && !document.querySelector('.spinner') && document.querySelector('[data-gz-scene-host]');}).then(Boolean));
      await page.waitForTimeout(250);
      const state=await page.evaluate(()=>{const c=document.querySelector('#gz-scene'),host=c.parentElement;return {count:document.querySelectorAll('#gz-scene').length,host:host.className || host.tagName,marked:host.hasAttribute('data-gz-scene-host'),w:c.width,h:c.height,badInner:[...host.querySelectorAll('.panel-wrap')].some(e=>getComputedStyle(e,'::before').content!=='none'),sidebar:!!document.querySelector('[data-gz-sidebar-host]')};});
      check(state.count===1 && state.marked && state.w>0 && state.h>0 && !state.badInner,`${p}: one rendered shell backdrop (${JSON.stringify(state)})`);
      console.log(`ok ${p}: ${state.host}`);
      await page.locator('.panel-wrap').evaluateAll(es=>es.forEach(e=>e.scrollTop=200));
      check(await page.locator('#gz-scene').count()===1,`${p}: scrolling retains one scene`);
      if(out && ['courses/_101_1/outline','courses/_101_1/grades','courses/_101_1/outline/discussion/_9003_1'].includes(p)){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,`${p.includes('discussion')?'discussion':p.endsWith('grades')?'gradebook':'outline'}.png`)});}
    }
    // Course-tab frames use the same shell ownership; their parent still paints behind the shared bar.
    await page.goto(`${origin}/ultra/courses/_101_1/outline`);
    await page.locator('#gz-navbar').getByRole('button',{name:'Course 102, pinned',exact:true}).click();
    const frame=await until(()=>Promise.resolve(page.frames().find(f=>f.name()==='gz-ctab:_102_1')));
    await until(()=>frame.locator('#gz-scene').count().then(Boolean));
    check(await page.locator('[data-gz-scene-host] > #gz-scene').count()===1,'retained course: parent keeps the shared navbar backdrop');
    check(await frame.locator('.course-content-container[data-gz-scene-host] > #gz-scene').count()===1,'retained course: foreground frame paints its full course shell');
    if(out)await page.screenshot({path:path.join(out,'retained-course.png')});
    await frame.locator('.js-course-grades-tool').click();
    await until(()=>frame.evaluate(()=>location.pathname.endsWith('/grades') && !document.querySelector('.spinner')));
    await until(()=>page.evaluate(()=>document.querySelector('#gz-scene')?.width>300));
    await page.waitForTimeout(250);
    check(await frame.locator('.course-content-container[data-gz-scene-host] > #gz-scene').count()===1,'retained Gradebook: narrowed tool content keeps the full course backdrop');
    check(await page.locator('[data-gz-scene-host] > #gz-scene').count()===1,'retained Gradebook: the outer navbar keeps its backdrop');
    const backdrop=await page.locator('#gz-scene').evaluate(c=>{const r=c.getBoundingClientRect();return {width:c.width,height:c.height,rect:[r.x,r.y,r.width,r.height],ancestors:[c,...function*(e){while(e){yield e;e=e.parentElement;}}(c.parentElement)].map(e=>({tag:e.tagName,cls:e.className,display:getComputedStyle(e).display,visible:getComputedStyle(e).visibility,clip:getComputedStyle(e).clipPath}))};});
    if(out)fs.writeFileSync(path.join(out,'retained-backdrop.json'),JSON.stringify(backdrop,null,2));
    check(backdrop.rect[1]<=0 && backdrop.rect[1]+backdrop.rect[3]>=1000 && backdrop.ancestors.every(a=>a.display!=='none' && a.visible==='visible'),`retained Gradebook: the painted parent canvas covers the navbar viewport (${JSON.stringify(backdrop)})`);
    if(out)await page.screenshot({path:path.join(out,'retained-gradebook.png')});
    await opts.evaluate(async()=>chrome.storage.sync.set({bg:{kind:'solid'}}));
    await until(()=>page.locator('#gz-scene').count().then(n=>n===0));
    check(await page.locator('[data-gz-scene-host]').count()===0,'switching to solid removes shell ownership');
    check(errors.length===0,`no page errors (${JSON.stringify(errors)})`);
  } finally {await ctx?.close();fs.rmSync(tmp,{recursive:true,force:true});if(held)fs.rmSync(lock,{recursive:true});}
  if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}
  console.log(`${results.length} real-extension background checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
