// Actual unpacked extension and local MathLive. Invented DOM with the native API shape observed on MyLab, no Pearson traffic.
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const env=require('../../tools/dev/check-env.js');
const ext=require('../../tools/dev/check-env.js').staged(process.env.EXT||path.resolve(__dirname,'../../extension'),require('../../tools/dev/check-env.js').PEARSON_HOSTS);
const id=[...crypto.createHash('sha256').update(ext).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
const D=require('../../extension/content/defaults.js');
const out=process.argv[2],tmp=fs.mkdtempSync(path.join(os.tmpdir(),'glaze-math-check-')),results=[],errors=[],network=[];
const check=(value,label)=>{assert.ok(value,label);results.push(label);console.log('ok '+label)};
const source=String.raw`<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:16px Arial;background:white;color:black}.contentHolder{padding:24px}.eqEditor{display:inline-block;border:1px solid #888}.focusNode{width:100px}.eqDocument{display:inline-block}.equation{font-family:Georgia}button{padding:8px}.contentPanel{width:100%;min-height:600px}
</style></head><body><main id="playerViewer" class="playmode-homework"><div class="mainPanel"><div class="contentPanel"><div class="dijitBorderContainer"><div class="contentHolder"><p>Rewrite the sample expression.</p><span id="formula" class="equation eqLabel" aria-label="Sample formula"><span class="eqDocument">(a+1)/(b-2)</span></span></div><div class="contentHolder"><span id="S1" class="equation inputField"><span class="eqEditor"><input class="focusNode" aria-label="Sample answer" value="draft"><span class="eqDocument">draft</span></span></span><button id="native-check">Check answer</button><button id="native-save">Save</button></div></div></div></div></main><script>
window.answerChanges=0;window.checked=0;window.saved=0;
class Editor {
 constructor(options={}){this.initializationParameters=options;this.domNode=document.createElement('span');this.value='';this.undoValues=[];this.readOnly=false;this.disabled=false;}
 setLatex(latex){if(/\\(?:int|begin|foo)\b/.test(latex))throw 'Unhandled latex command';this.value=(latex.includes('\\cos')?'x':latex).replace(/\\(?:left|right)/g,'').replaceAll('\\infty','&infin;').replaceAll('\\cup','&cup;');}
 getLatex(){return this.value.replaceAll('&infin;','{\\infty}').replaceAll('&inf;','{\\infty_}').replaceAll('&cup;','{\\cup}')}getEqText(){return this.value}getEqDoc(){return this}isEmpty(){return !this.value}
 replaceEqText(value){this.undoValues.push(this.value);this.setEqText(value)}setEqText(value){this.value=value;if(this.node){this.node.querySelector('.eqDocument').textContent=this.value;this.node.querySelector('input').value=this.value}}
 doChange(){this.domNode.dispatchEvent(new CustomEvent('eqeditor_change',{bubbles:true}))}destroy(){this.domNode.remove()}getDisabled(){return this.disabled}getReadOnly(){return this.readOnly}
}
const node=document.getElementById('S1'),editor=new Editor({docSettings:{}});editor.node=node;editor.domNode=node.querySelector('.eqEditor');editor.value='draft';
editor.domNode.addEventListener('eqeditor_change',()=>window.answerChanges++);
window.nativeEditor=editor;window.originalAnswer=node;window.originalFormula=document.querySelector('#formula .eqDocument');
window.dijit={byNode:n=>n.id==='S1'?{_editor:editor,domNode:node}:n.id==='formula'?{getEqDoc:()=>({getLatex:()=>String.raw`+'`'+String.raw`\frac{a+1}{b-2}`+'`'+String.raw`})}:null};
// Registry identity is stable, just as the live Dijit widget is.
const inputWidget=window.dijit.byNode(node);const oldByNode=window.dijit.byNode;window.dijit.byNode=n=>n===node?inputWidget:oldByNode(n);
document.getElementById('native-check').onclick=()=>window.checked++;document.getElementById('native-save').onclick=()=>window.saved++;
</script></body></html>`;
const until=async(fn)=>{for(const end=Date.now()+12000;;await new Promise(r=>setTimeout(r,40))){if(await fn())return;if(Date.now()>end)throw Error('Math adapter did not settle')}};
(async()=>{
 let ctx;
 try{
  await require('../../tools/dev/wait-for-browser.js')();
  ctx=await chromium.launchPersistentContext(path.join(tmp,'profile'),{...require('../../tools/dev/check-env.js').chromeLaunch(),headless:true,viewport:{width:1100,height:850},args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND']});
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(String(e))));
  await ctx.route('**/*',r=>{const u=new URL(r.request().url());if(u.protocol==='chrome-extension:')return r.continue();if(u.origin==='https://tdx.acs.pearson.com')return r.fulfill({contentType:'text/html',body:source});network.push(u.origin+u.pathname);return r.abort()});
  const opts=await ctx.newPage();await opts.goto(`chrome-extension://${id}/options.html`);await env.installed(opts);
  await opts.evaluate(async s=>chrome.storage.sync.set(s),{enabled:true,colors:D.GZ_DEFAULTS.colors,bg:{...D.GZ_DEFAULTS.bg,kind:'solid'},enhance:{...D.GZ_DEFAULTS.enhance,pearsonViewer:false,pearsonMath:true}});
  await require('../../tools/dev/check-env.js').pearsonReady(ctx);
  const page=await ctx.newPage();await page.goto('https://tdx.acs.pearson.com/Player/Player.aspx');
  try{await page.waitForSelector('.gz-pearson-render',{timeout:12000})}catch(e){
   console.log('Math startup:',await page.evaluate(()=>({themed:document.documentElement.getAttribute('data-gz-pearson'),math:document.documentElement.hasAttribute('data-gz-pearson-math'),buttons:document.querySelectorAll('.gz-pearson-math-edit').length,html:document.querySelector('#formula').outerHTML})));
   const worker=ctx.serviceWorkers()[0];console.log('Native worker:',await worker.evaluate(()=>({native:typeof GZ_PEARSON_NATIVE,notation:typeof GZ_PEARSON_NOTATION})));
   const pp=await ctx.newPage();await pp.goto(`chrome-extension://${id}/pearson-math.html`);console.log('Renderer:',await pp.evaluate(async()=>{try{const m=await import('./pearson/render.mjs');return {render:m.render(String.raw`\frac{a+1}{b-2}`)?.childNodes.length}}catch(e){return String(e.stack)}}));throw e;
  }await page.waitForSelector('.gz-pearson-math-edit');
  check(await page.evaluate(()=>document.querySelector('#formula .eqDocument')===window.originalFormula&&getComputedStyle(originalFormula).display==='none'),'the modern display preserves the original native formula node and accessible label');
  check(await page.locator('.gz-pearson-render .ML__frac-line').count()===1,'the problem renders with a real typeset fraction');
  check(await page.locator('.gz-pearson-render[role="math"][aria-label]').count()===1,'the replacement equation exposes an accessible mathematical expression');
  await page.emulateMedia({media:'print'});
  check(await page.evaluate(()=>getComputedStyle(originalFormula).display!=='none'&&getComputedStyle(document.querySelector('.gz-pearson-render')).display==='none'),'printing restores the native formula while hiding the screen renderer');
  await page.emulateMedia({media:'screen'});
  await page.getByRole('button',{name:'Equation editor',exact:true}).click();
  const frame=page.frameLocator('iframe[title="Equation editor"]');
  await frame.locator('math-field').waitFor();await frame.getByRole('button',{name:'Use equation'}).waitFor({state:'visible'});
  check(await page.evaluate(()=>originalAnswer===document.querySelector('#S1')&&nativeEditor.value==='draft'&&answerChanges===0),'opening the modern editor preserves the original unsent answer and native editor');
  const mf=frame.locator('math-field');
  await mf.evaluate(e=>{e.setValue(String.raw`\frac{x+1}{\sqrt{x^{2}+4}}`);e.dispatchEvent(new InputEvent('input',{bubbles:true}))});
  await frame.getByRole('button',{name:'Use equation'}).waitFor({state:'visible'});
  await until(async()=>await frame.getByRole('button',{name:'Use equation'}).isEnabled());
  check(await page.evaluate(()=>nativeEditor.value==='draft'&&answerChanges===0&&checked===0&&saved===0),'preparing an equation changes no answer, score, save or submission state');
  await frame.getByRole('button',{name:'Use equation'}).click();await page.waitForSelector('.gz-pearson-math-composer',{state:'detached'});
  check(await page.evaluate(()=>nativeEditor.value===String.raw`\frac{x+1}{\sqrt{x^{2}+4}}`&&answerChanges===1&&nativeEditor.undoValues[0]==='draft'),'Use equation updates the native model once and preserves its undo history');
  check(await page.evaluate(()=>checked===0&&saved===0),'applying the expression never checks or saves homework');
  await page.evaluate(()=>{nativeEditor.readOnly=true;originalAnswer.setAttribute('aria-disabled','true')});
  await page.waitForSelector('.gz-pearson-math-edit',{state:'detached'});
  check(await page.evaluate(()=>answerChanges===1),'a read-only native editor loses the composer control without changing its answer');
  await page.evaluate(()=>{nativeEditor.readOnly=false;originalAnswer.removeAttribute('aria-disabled')});
  await page.waitForSelector('.gz-pearson-math-edit');
  await page.getByRole('button',{name:'Equation editor',exact:true}).click();await mf.waitFor();
  await mf.evaluate(e=>{e.setValue(String.raw`\int x\,dx`);e.dispatchEvent(new InputEvent('input',{bubbles:true}))});
  await frame.locator('#status[data-error]').waitFor();
  check(await frame.getByRole('button',{name:'Use equation'}).isDisabled()&&await page.evaluate(()=>answerChanges===1),'unsupported notation leaves the native answer intact');
  await mf.evaluate(e=>{e.setValue(String.raw`\cos(x)`);e.dispatchEvent(new InputEvent('input',{bubbles:true}))});
  await until(async()=>await frame.locator('#status').textContent()==='Pearson cannot import this expression.');
  check(await frame.getByRole('button',{name:'Use equation'}).isDisabled(),'a native parser that silently changes an expression is rejected by structural comparison');
  await mf.evaluate(e=>{e.setValue('x+2');e.dispatchEvent(new InputEvent('input',{bubbles:true}))});await until(async()=>await frame.getByRole('button',{name:'Use equation'}).isEnabled());
  await page.evaluate(()=>{nativeEditor.value='new native draft'});await frame.getByRole('button',{name:'Use equation'}).click();
  await until(async()=>await frame.locator('#status').textContent()==='The Pearson answer changed. Reopen the equation editor.');
  check(await page.evaluate(()=>nativeEditor.value==='new native draft'&&answerChanges===1),'a changed native answer cannot be overwritten by an older composer');
  await frame.getByRole('button',{name:'Pearson input',exact:true}).click();await page.waitForSelector('.gz-pearson-math-composer',{state:'detached'});
  check(await page.locator('#S1 .focusNode').evaluate(e=>document.activeElement===e),'Pearson input returns focus to the native answer');
  await page.getByRole('button',{name:'Equation editor',exact:true}).click();await mf.waitFor();
  await page.evaluate(()=>{const iframe=document.querySelector('.gz-pearson-math-composer iframe');iframe.src=iframe.src});
  await page.waitForSelector('.gz-pearson-math-composer',{state:'detached'});
  check(await page.evaluate(()=>nativeEditor.value==='new native draft'&&answerChanges===1),'reloading the extension frame releases its old session without writing the answer');
  await page.getByRole('button',{name:'Equation editor',exact:true}).click();await mf.waitFor();
  await mf.evaluate(e=>{e.setValue('');e.dispatchEvent(new InputEvent('input',{bubbles:true}));e.focus()});
  await frame.locator('.ML__keyboard-sink').evaluate(e=>e.focus());
  await page.keyboard.type('x/2');
  check(await mf.evaluate(e=>e.getValue('latex'))===String.raw`\frac{x}{2}`,'trusted keyboard input creates a structured fraction in the real extension frame');
  await frame.getByRole('button',{name:'Infinity',exact:true}).click();
  check((await mf.evaluate(e=>e.getValue('latex'))).includes('\\infty'),'the local symbol controls insert mathematical notation');
  await opts.evaluate(async()=>{const {enhance}=await chrome.storage.sync.get('enhance');await chrome.storage.sync.set({enhance:{...enhance,pearsonMath:false}})});
  await page.waitForSelector('.gz-pearson-math-edit',{state:'detached'});
  check(await page.locator('.gz-pearson-math-composer,.gz-pearson-render').count()===0&&await page.evaluate(()=>getComputedStyle(originalFormula).display!=='none'),'the setting restores native equations and removes the composer');
  check(await page.evaluate(()=>nativeEditor.value==='new native draft'&&answerChanges===1),'turning the feature off preserves unsent native work');
  await opts.evaluate(async()=>{const {enhance}=await chrome.storage.sync.get('enhance');await chrome.storage.sync.set({enhance:{...enhance,pearsonMath:true}})});
  await page.waitForSelector('.gz-pearson-math-edit');await page.getByRole('button',{name:'Equation editor',exact:true}).click();await mf.waitFor();
  await page.setViewportSize({width:420,height:850});
  await until(async()=>await frame.locator('#symbols button').count()===9);
  check(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'the complete equation editor and palette fit a narrow worksheet');
  await mf.evaluate(e=>{e.setValue(String.raw`\frac{x+1}{\sqrt{x^{2}+4}}`);e.dispatchEvent(new InputEvent('input',{bubbles:true}))});
  await until(async()=>await frame.getByRole('button',{name:'Use equation'}).isEnabled());
  await page.screenshot({path:path.join(out,'math-editor-phone.png'),fullPage:true});
  await page.setViewportSize({width:1100,height:850});await page.screenshot({path:path.join(out,'math-editor-desktop.png'),fullPage:true});
  await page.locator('.gz-pearson-math-composer').screenshot({path:path.join(out,'math-editor.png')});
  // Invented endpoints, with the exact infinity serialization observed in native detached editors.
  await mf.evaluate(e=>{e.setValue(String.raw`\left(-\infty,-7\right)\cup\left(-7,7\right)\cup\left(7,\infty\right)`);e.dispatchEvent(new InputEvent('input',{bubbles:true}))});
  await until(async()=>await frame.getByRole('button',{name:'Use equation'}).isEnabled());
  check(await page.evaluate(()=>nativeEditor.value==='new native draft'&&answerChanges===1),'preparing an interval with infinity leaves the native draft untouched');
  await frame.getByRole('button',{name:'Use equation'}).click();await page.waitForSelector('.gz-pearson-math-composer',{state:'detached'});
  check(await page.evaluate(()=>nativeEditor.getEqText()==='(-&inf;,-7)&cup;(-7,7)&cup;(7,&inf;)'),'interval transfer uses Pearson native infinity tokens while preserving every endpoint and union');
  await page.getByRole('button',{name:'Equation editor',exact:true}).click();await mf.waitFor();
  await until(async()=>await frame.getByRole('button',{name:'Use equation'}).isEnabled());
  check(await mf.evaluate(e=>e.getValue('latex').includes('\\infty')&&!e.getValue('latex').includes('_')),'a canonical native interval reopens without an empty infinity subscript');
  check(await page.evaluate(()=>answerChanges===2&&nativeEditor.undoValues.at(-1)==='new native draft'&&checked===0&&saved===0),'interval transfer retains native undo and notifies once without checking or saving homework');
  await page.evaluate(()=>document.getElementById('playerViewer').className='playmode-test');
  await page.waitForSelector('.gz-pearson-math-edit',{state:'detached'});
  check(await page.locator('.gz-pearson-render,.gz-pearson-math-composer').count()===0,'test mode restores the native renderer and input');
  check(errors.length===0,`no page errors: ${errors.join(' | ')}`);check(network.length===0,'all math code and fonts are packaged with the extension');
  console.log(`${results.length}/${results.length} Pearson math checks passed`);
 }finally{await ctx?.close();fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks:results,errors,network},null,2))}
})().catch(e=>{console.error(e);process.exitCode=1});
