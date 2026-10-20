// Current Ultra assessment columns, using structures observed on the overview and attempt/create pages.
// No account or external network. Editor text and all action handlers are local stubs.
// Hold /private/tmp/claude-501/glaze-heavy.lock; NODE_PATH=<playwright> nice -n 15 node scripts/sidebar-assessment-check.js [screenshots]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(process.env.EXT || path.join(__dirname, '..')), out = process.argv[2];
let checks = 0, fails = 0;
const check = (v, label) => { checks++; fails += !v; console.log(`${v ? 'ok' : 'FAIL'} ${label}`); };
const overview = (toc) => `<section class="assessment-overview-modern-panel routed-page route-view-container bb-offcanvas-container"><content-page-header>Course / Assessment</content-page-header><learning-module-panel-view class="routed-page-body"><div class="table-of-contents-${toc}"><div class="panel-content-body"><div class="root-learning-module-panel"><div id="learningModulePanelContainerId" class="content-item-container"><h1>A fictional assignment</h1><div class="content-item-container-children"><content-body><div class="base-body"><div class="content-root"><div class="standard-content-body"><div class="assessment-overview-grid">
  <div class="overview-section overview-description-section main-section-container"><h2>Description</h2><p>Assignment instructions stay in the main column.</p><div class="main-tail"></div></div>
  <div class="overview-section overview-due-date-section main-section-container"><h2>Details</h2><p>Due Sunday</p></div>
  <div class="overview-section overview-attempts-section overview-attempts-section-container"><h2 id="grades-attempts-header" class="section-label">Grades / Attempts</h2><p>Maximum points: 5</p><p>Attempts: Unlimited</p><a id="native-action" class="button button-attempt js-multiple" href="#instructions">View instructions</a></div>
  <div class="overview-section assessment-details-section main-section-container"><h2>Assessment details</h2><a href="#rubric">View rubric</a></div>
  </div></div></div></div></content-body></div></div></div></div></div></learning-module-panel-view></section>`;
const attempt = `<section class="routed-page route-view-container bb-offcanvas-container"><content-page-header>Course / Attempt</content-page-header><div class="routed-page-body"><bb-assignment-attempt-authoring-panel class="react-container"><div><div class="makeStylespanelRoot-0-2-1056"><div class="makeStylesbaseBody-0-2-1059">
  <div class="makeStylesheaderRoot-0-2-1062"><h1>A fictional assignment</h1></div><div class="makeStylescontentRoot-0-2-1064"><div class="makeStylesbody-0-2-1120"><div class="makeStylescontainer-0-2-1034">
  <div class="makeStylesauthoring-0-2-1036"><h2>Assignment instructions</h2><p>Instructions and the submission editor stay here.</p><div id="bb-editorassignment-attempt-authoring-submission" role="textbox" contenteditable="true">Untouched draft</div><div class="main-tail"></div></div>
  <div class="makeStylesdetails-0-2-1037"><div class="makeStylessidePanelContentMarginFix-0-2-1049"><h2>Details &amp; Information</h2><p>Assessment due date: Sunday</p><p>Attempts: Unlimited</p><a id="native-action" href="#rubric">This item is graded with a rubric</a></div><div><h3>Grading</h3><p>Maximum points: 5</p><h3>Description</h3><p>Read the assignment instructions.</p></div></div>
  </div></div></div><div class="makeStylesfooterWrapper-0-2-1068"><footer class="makeStylesfooterRoot-0-2-1140"><button id="save" type="button">Save and Close</button><button id="submit" type="button">Submit</button></footer></div>
  </div></div></div></bb-assignment-attempt-authoring-panel></div></section>`;
(async () => {
  let browser;
  try {
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), args: ['--host-resolver-rules=MAP * ~NOTFOUND'], chromiumSandbox: false });
    const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/ultra/') ? r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }) : r.abort());
    // Hiding the caret mutates contenteditable.style during screenshots and leaves an empty style attribute behind.
    const shot = async (name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`), caret:'initial' }); } };
    for (const kind of ['overview-enabled', 'overview-disabled', 'attempt'].filter(k=>!process.env.SIDEBAR_ASSESSMENT_KINDS || process.env.SIDEBAR_ASSESSMENT_KINDS.split(',').includes(k))) for (const style of ['float', 'embed']) for (const surface of ['glass', 'solid']) {
      const tag = `${kind} ${style} ${surface}`, isAttempt = kind === 'attempt';
      await page.setViewportSize({ width: 1800, height: 900 });
      await page.goto(`https://bb.school.test/ultra/courses/_101_1/assessment/_7_1/${isAttempt ? 'attempt/create' : 'overview'}`);
      await page.setContent(`<style>
        * { box-sizing:border-box; } html { --gz-font:system-ui; --gz-font-head:system-ui; --gz-surface:#0d1b2e; --gz-ink:#e8f2fa; --gz-ink-muted:#8fa8c0; --gz-line:#24405f; --gz-line-strong:#345576; --gz-radius:16px; --gz-accent:#17c8f4; --gz-accent-ink:#04121f; --gz-shadow:0 8px 24px #0005; }
        body { margin:0; font:15px/1.5 system-ui; color:var(--gz-ink); background:#060d18; } h1 { margin:0; padding:24px 30px; font-size:28px; } h2,h3 { margin:0 0 8px; } button,a { font:inherit; } a { color:var(--gz-accent); } button { padding:8px 16px; border:1px solid var(--gz-line); border-radius:8px; background:var(--gz-surface); color:var(--gz-ink); }
        .routed-page { height:calc(100dvh - 25px); display:flex; flex-direction:column; } content-page-header { display:block; flex:none; height:47px; padding:12px; background:var(--gz-surface); position:relative; z-index:1; } .routed-page-body { position:relative; flex:1; min-height:0; }
        .table-of-contents-enabled,.table-of-contents-disabled,.panel-content-body { position:absolute; inset:0; display:flex; flex-direction:column; } .root-learning-module-panel { display:flex; flex:1; overflow:hidden; } #learningModulePanelContainerId { flex:1; overflow:auto; } .standard-content-body { display:flex; flex-direction:column; padding:30px 60px; }
        .assessment-overview-grid { display:grid; container-type:inline-size; grid-template-columns:minmax(0,1fr) 0 392px; gap:24px; } .assessment-overview-grid > .main-section-container { grid-column:1 / span 2; } .overview-attempts-section { grid-area:1 / 3 / span 2 / span 1; padding:16px; border:1px solid var(--gz-line); border-radius:16px; }
        .main-tail { min-height:2200px; } .makeStylespanelRoot-0-2-1056 { position:absolute; inset:0; display:flex; flex-direction:column; } .makeStylesbaseBody-0-2-1059 { display:flex; flex-direction:column; height:100%; } .makeStylesheaderRoot-0-2-1062 { flex:none; } .makeStylescontentRoot-0-2-1064 { flex:1; min-height:0; overflow:auto; }
        .makeStylesbody-0-2-1120 { padding:30px; } .makeStylescontainer-0-2-1034 { display:flex; gap:24px; } .makeStylesauthoring-0-2-1036 { flex:1; max-width:890px; } .makeStylesdetails-0-2-1037 { flex:none; width:360px; display:flex; flex-direction:column; padding:16px 20px; border:1px solid var(--gz-line); border-radius:16px; background:var(--gz-surface); position:sticky; top:30px; align-self:start; }
        [contenteditable] { min-height:150px; border:1px solid var(--gz-line); padding:16px; } .makeStylesfooterWrapper-0-2-1068 { flex:none; } footer { padding:16px 30px; display:flex; justify-content:flex-end; gap:12px; background:var(--gz-surface); } #gz-footer { position:fixed; bottom:0; height:25px; left:0; right:0; text-align:center; }
      </style><div id="site-wrap">${isAttempt ? attempt : overview(kind.split('-')[1])}</div><div id="gz-footer">Glaze</div>`);
      for (const file of ['features/apps.css', 'features/sidebar.css']) await page.addStyleTag({ path: path.join(root, file) });
      for (const file of ['lib/widgets.js', 'lib/sidebar.js']) await page.addScriptTag({ path: path.join(root, file) });
      await page.evaluate(({ style, surface, isAttempt }) => {
        window.nativeHost = document.querySelector(isAttempt ? '[class*="makeStylesdetails-"]' : '.overview-attempts-section');
        window.nativeAction = document.getElementById('native-action');
        window.nativeMain = document.querySelector(isAttempt ? '[class*="makeStylescontentRoot-"]' : '#learningModulePanelContainerId');
        window.nativeHTML = document.getElementById('site-wrap').outerHTML;
        window.nativeNodes = [...document.querySelectorAll('#site-wrap *')].map((e) => [e, e.parentElement]);
        window.clicks = { action:0, save:0, submit:0 };
        nativeAction.addEventListener('click', (e) => { e.preventDefault(); clicks.action++; });
        for (const id of ['save','submit']) document.getElementById(id)?.addEventListener('click', () => clicks[id]++);
        let rec = GZ_SIDEBAR.clean({ mig:1, width:352, chose:{width:true}, dock:[{id:'notes'}], dest:{notes:'dock'} });
        window.chrome = { storage:{local:{get:(key,cb)=>cb({[key]:rec})},onChanged:{addListener(){},removeListener(){}}},runtime:{sendMessage:(m,cb)=>{if(m.type==='glaze:sidebar')rec=GZ_SIDEBAR.apply(rec,m.ops,{lms:'ultra'});cb({ok:true});}} };
        window.SET = {enhance:{sidebar:true,notes:true,widgets:true},sidebar:{style,surface}};
        window.GZ_CTX = {site:'ultra',t:(s,v)=>s.replace(/\{(\w+)\}/g,(_,k)=>v?.[k]??''),need:async()=>{},account:async()=>'_42_1',courseId:()=>'_101_1',settings:()=>SET};
      }, { style, surface, isAttempt });
      await page.addScriptTag({ path: path.join(root, 'features/sidebar.js') });
      await page.evaluate(async () => { GZ_SIDEBAR_UI.sync(true); await GZ_SIDEBAR_UI.ready(); });
      await page.waitForFunction(() => !!GZ_SIDEBAR_UI.host(), null, { timeout:5000 }).catch(async e => { console.error(await page.evaluate(() => ({active:GZ_SIDEBAR_UI.active(),failed:GZ_SIDEBAR_UI.failed(),context:GZ_SIDEBAR_UI.context()})), errors); throw e; });
      await page.evaluate(() => { const tile=document.createElement('section');tile.className='gz-w';tile.style.minHeight='1500px';tile.innerHTML='<h3>Notes</h3><textarea aria-label="Widget notes">Fictional notes</textarea><button id="widget-end">Widget end</button>';GZ_SIDEBAR_UI.host().widgets.append(tile);GZ_SIDEBAR_UI.drawn(1); });
      await page.waitForTimeout(180);
      check(await page.evaluate(() => GZ_SIDEBAR_UI.host().el === nativeHost && nativeHost.contains(document.getElementById('gz-sb-widgets')) && !document.getElementById('gz-sidebar')), `${tag}: native information and widgets share the host`);
      check(await page.evaluate(() => {const r=nativeHost.getBoundingClientRect();return r.top>=document.querySelector('content-page-header').getBoundingClientRect().bottom && r.bottom<=nativeMain.getBoundingClientRect().bottom+1;}), `${tag}: header and column fit inside the LMS scrollport`);
      check(await page.evaluate(() => {const e=nativeHost.querySelector('.gz-sb-toggle'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}), `${tag}: sidebar controls receive pointer hits`);
      check(await page.evaluate(() => nativeNodes.every(([e,parent])=>e.parentElement===parent)), `${tag}: every native node keeps its parent`);
      await shot(`${kind}-${style}-${surface}-expanded`);
      const box = await page.locator('[data-gz-sidebar-host]').boundingBox();
      await page.mouse.move(box.x+box.width-20,box.y+box.height/2); await page.mouse.wheel(0,500); await page.waitForTimeout(120);
      check(await page.evaluate(() => nativeHost.scrollTop>0 && nativeMain.scrollTop===0), `${tag}: wheel scrolls the shared sidebar independently`);
      await page.locator('#native-action').focus();
      check(await page.evaluate(() => {const r=nativeAction.getBoundingClientRect(),h=nativeHost.getBoundingClientRect(),head=nativeHost.querySelector('.gz-sb-head').getBoundingClientRect();return r.top>=head.bottom && r.bottom<=h.bottom && nativeMain.scrollTop===0;}), `${tag}: keyboard focus reveals the original native action`);
      await page.locator('#native-action').click();
      check(await page.evaluate(() => clicks.action===1 && clicks.submit===0 && clicks.save===0), `${tag}: native action works without activating Save or Submit`);
      await page.mouse.move(100,350); await page.mouse.wheel(0,900); await page.waitForTimeout(150);
      check(await page.evaluate(() => nativeMain.scrollTop>0 && nativeHost.getBoundingClientRect().top>=document.querySelector('content-page-header').getBoundingClientRect().bottom), `${tag}: main scrolling keeps the sidebar below the header`);
      if (isAttempt) {
        check(await page.locator('#bb-editorassignment-attempt-authoring-submission').textContent()==='Untouched draft', `${tag}: editor text stays intact`);
        check(await page.evaluate(() => ['save','submit'].every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return !nativeHost.contains(e)&&e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})), `${tag}: native Save and Submit remain reachable outside the sidebar`);
      }
      await page.locator('.gz-sb-toggle').click(); await page.waitForTimeout(100);
      check(await page.locator('[data-gz-sidebar-host]').evaluate(e=>e.getBoundingClientRect().width===48), `${tag}: collapse reserves only the narrow strip`);
      await page.locator('.gz-sb-toggle').click(); await page.waitForTimeout(100);
      await page.locator('.gz-sb-pagehead button').click();
      check(await page.locator('#native-action').isHidden() && await page.locator('#gz-sb-widgets').isVisible(), `${tag}: folding This page leaves the widgets available`);
      await page.locator('.gz-sb-pagehead button').click();
      await page.setViewportSize({width:900,height:900}); await page.waitForTimeout(120);
      await page.locator('#gz-sb-launch').click(); await page.waitForTimeout(120);
      await page.locator('#native-action').click();
      check(await page.evaluate(()=>clicks.action===2 && nativeHost.contains(document.activeElement)), `${tag}: native action works inside the drawer`);
      check(await page.evaluate(()=>document.elementFromPoint(100,400)?.classList.contains('gz-sb-backdrop')), `${tag}: drawer backdrop intercepts the main content`);
      await page.evaluate(()=>{const d=document.createElement('div');d.id='native-dialog';d.setAttribute('role','dialog');d.style.cssText='position:fixed;z-index:5000;inset:180px 180px;background:#18304b;padding:20px';d.innerHTML='<button id="close-native-dialog">Close native dialog</button>';d.firstElementChild.onclick=()=>d.remove();document.body.append(d);d.firstElementChild.focus();});
      await page.waitForTimeout(80);
      check(await page.locator('.gz-sb-backdrop').isHidden() && await page.locator('#close-native-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return !e.closest('[inert]')&&e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}), `${tag}: native modal keeps focus and pointer routing`);
      await page.locator('#close-native-dialog').click(); await page.waitForTimeout(80);
      check(await page.locator('.gz-sb-backdrop').isVisible(), `${tag}: closing the native modal restores the drawer`);
      await shot(`${kind}-${style}-${surface}-drawer`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      check(await page.locator('html').getAttribute('data-gz-sidebar-open')===null, `${tag}: Escape closes the drawer`);
      await page.setViewportSize({width:390,height:900}); await page.waitForTimeout(100);
      await page.locator('#gz-sb-launch').click(); await page.waitForTimeout(100);
      check(await page.locator('#native-action').isVisible() && await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1), `${tag}: phone drawer retains metadata without horizontal overflow`);
      await page.keyboard.press('Escape');
      await page.emulateMedia({media:'print'});
      check(await page.locator('#native-action').isVisible() && await page.locator('#gz-sb-widgets').isHidden() && await page.locator('.gz-sb-head').isHidden(), `${tag}: print shows native metadata and omits the dock`);
      await page.emulateMedia({media:'screen'});
      await page.evaluate(()=>{SET.sidebar.absorb=false;GZ_SIDEBAR_UI.sync(true);}); await page.waitForTimeout(100);
      check(await page.evaluate(()=>!nativeHost.hasAttribute('data-gz-sidebar-host') && !nativeHost.contains(document.getElementById('gz-sb-widgets')) && nativeNodes.every(([e,parent])=>e.parentElement===parent)), `${tag}: absorption off restores native placement and keeps a separate dock`);
      await page.evaluate(()=>GZ_SIDEBAR_UI.sync(false));
      const restored = await page.evaluate(()=>{const after=document.getElementById('site-wrap').outerHTML;if(after===nativeHTML)return null;let i=0;while(i<after.length&&after[i]===nativeHTML[i])i++;return {at:i,before:nativeHTML.slice(Math.max(0,i-60),i+120),after:after.slice(Math.max(0,i-60),i+120)};});
      check(!restored, `${tag}: disabling restores the native subtree exactly`);
      if (restored) console.error(JSON.stringify(restored));
    }
    check(!errors.length, `no browser errors (${JSON.stringify(errors)})`);
    console.log(JSON.stringify({checks,fails})); process.exitCode=fails?1:0;
  } finally { await browser?.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
