const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const N=require('../../extension/pearson/notation.js'),native=require('../../extension/pearson/native.js');
const fs=require('node:fs'),path=require('node:path');
const fixture=()=>{
 const listeners=new Set();let notifications=0,active=true,connected=true;
 class Editor{
  constructor(options={}){this.initializationParameters=options;this.value='';this.undo=[];this.domNode={addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)}}
  setLatex(value){if(value.includes('\\foo'))throw Error('unsupported');this.value=value}
  getLatex(){return this.value}getEqText(){return JSON.stringify({native:this.value})}isEmpty(){return !this.value}
  replaceEqText(value){this.undo.push(this.value);this.setEqText(value)}setEqText(value){this.value=JSON.parse(value).native}
  doChange(){notifications++;for(const fn of listeners)fn()}destroy(){}getDisabled(){return false}getReadOnly(){return false}
 }
 const e=new Editor();e.value='draft';
 const node={id:'S1',get isConnected(){return connected},closest:()=>true,classList:{contains:k=>k==='inputField'}};
 const w={_editor:e,domNode:node};
 const sandbox={crypto,location:{origin:'https://tdx.acs.pearson.com',pathname:'/Player/Player.aspx'},document:{
  documentElement:{hasAttribute:()=>active},querySelector:()=>true,getElementById:id=>id==='S1'?node:null,
  createTreeWalker:()=>{let i=0;return {nextNode:()=>i++===0?node:null}},
  querySelectorAll:selector=>selector.includes('.eqLabel')?[]:[node]
 },dijit:{byNode:n=>n===node?w:null},request:null};
 const context=vm.createContext(sandbox);const call=request=>{sandbox.request=request;return vm.runInContext(`(${native.toString()})(request)`,context)};
 return {e,w,node,sandbox,call,listeners,notifications:()=>notifications,active:v=>active=v,connected:v=>connected=v};
};
test('notation normalizes presentation aliases while rejecting unsupported or active markup',()=>{
 assert.equal(N.prepare(String.raw`\dfrac{x}{2}\leq 3`),String.raw`\frac{x}{2}\le 3`);
 assert.equal(N.prepare(String.raw`(-\infty,2)\cup(3,\infty)`),String.raw`(-\infty,2)\cup(3,\infty)`);
 assert.equal(N.prepare(''),'');
 for(const value of [String.raw`\placeholder{}`,String.raw`\href{https://bad.test}{x}`,String.raw`\htmlStyle{color:red}{x}`,String.raw`\begin{matrix}x\end{matrix}`,String.raw`\int x dx`,String.raw`\sum_{i=1}^n i`,'x'.repeat(8193),{},null])assert.equal(N.prepare(value),null,String(value));
});
test('open and prepare do not mutate the native answer',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x+1'});
 assert.equal(prepared.latex,'x+1');assert.equal(f.e.value,'draft');assert.equal(f.notifications(),0);assert.ok(prepared.stage);
});
test('apply uses a prepared native value once and retains native undo',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x+1'});
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).ok,true);
 assert.equal(f.e.value,'x+1');assert.deepEqual(f.e.undo,['draft']);assert.equal(f.notifications(),1);
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'expired');
});
// Native infinity serialization observed in detached MyLab editors; all interval values here are invented.
const infinityFixture=()=>{
 const f=fixture(),Base=f.e.constructor;
 class NativeEditor extends Base{
  setLatex(value){this.value=value.replace(/\\(?:left|right)/g,'').replaceAll('\\infty','&infin;').replaceAll('\\cup','&cup;')}
  getLatex(){return this.value.replaceAll('&infin;','{\\infty}').replaceAll('&inf;','{\\infty_}').replaceAll('&cup;','{\\cup}')}
  getEqText(){return this.value}setEqText(value){this.value=value}
  replaceEqText(value){this.undo.push(this.value);this.setEqText(value)}
 }
 Object.setPrototypeOf(f.e,NativeEditor.prototype);return f;
};
test('interval imports stage Pearson native infinity tokens without mutating the opening answer',()=>{
 const f=infinityFixture(),opened=f.call({op:'open',id:'S1'});
 const latex=String.raw`\left(-\infty,-7\right)\cup\left(-7,7\right)\cup\left(7,\infty\right)`;
 const prepared=f.call({op:'prepare',token:opened.token,latex});
 assert.ok(prepared.stage);assert.equal(f.e.value,'draft');assert.equal(f.notifications(),0);
 assert.ok(prepared.latex.includes('{\\infty}'));assert.ok(!prepared.latex.includes('\\infty_'));
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).ok,true);
 assert.equal(f.e.getEqText(),'(-&inf;,-7)&cup;(-7,7)&cup;(7,&inf;)');
 assert.deepEqual(f.e.undo,['draft']);assert.equal(f.notifications(),1);
});
test('an existing native interval reopens and round-trips without turning infinity into an empty subscript',()=>{
 const f=infinityFixture(),before='(-&inf;,-7)&cup;(7,&inf;)';f.e.value=before;
 const opened=f.call({op:'open',id:'S1'});
 assert.equal(opened.latex,String.raw`(-{\infty},-7){\cup}(7,{\infty})`);
 assert.equal(f.e.getEqText(),before);
 const prepared=f.call({op:'prepare',token:opened.token,latex:String.raw`(-\infty,-7)\cup(7,\infty)`});
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).ok,true);assert.equal(f.e.getEqText(),before);
});
test('native label exports normalize only the exact internal infinity alias and preserve actual subscripts',()=>{
 const f=infinityFixture(),label={id:'L1',classList:{contains:k=>k==='eqLabel'},closest:()=>null};
 f.sandbox.document.createTreeWalker=()=>{let done=false;return {nextNode:()=>done?null:(done=true,label)}};
 f.sandbox.dijit.byNode=()=>({getEqDoc:()=>({getLatex:()=>String.raw`{\infty_}+{\infty}_{k}+{\infty_{k}}+\{\infty_}+\\{\infty_}+\\\{\infty_}`})});
 assert.equal(f.call({op:'scan'}).labels[0].latex,String.raw`{\infty}+{\infty}_{k}+{\infty_{k}}+\{\infty_}+\\{\infty}+\\\{\infty_}`);
});
test('native infinity exports are bounded before normalization in scan, open and prepare',()=>{
 for(const length of [8192,8193]){
  const alias=String.raw`{\infty_}`,latex='x'.repeat(length-alias.length)+alias;
  const scan=infinityFixture(),label={id:'L1',classList:{contains:k=>k==='eqLabel'},closest:()=>null};
  scan.sandbox.document.createTreeWalker=()=>{let done=false;return {nextNode:()=>done?null:(done=true,label)}};
  scan.sandbox.dijit.byNode=()=>({getEqDoc:()=>({getLatex:()=>latex})});
  const open=infinityFixture();open.e.getLatex=()=>latex;
  const prepare=infinityFixture(),opened=prepare.call({op:'open',id:'S1'}),Base=prepare.e.constructor;
  prepare.e.constructor=class extends Base{getLatex(){return latex}};
  const results=[scan.call({op:'scan'}).labels.length,open.call({op:'open',id:'S1'}).error||'ok',
   prepare.call({op:'prepare',token:opened.token,latex:String.raw`\infty`}).error||'ok'];
  assert.deepEqual(results,length===8192?[1,'ok','ok']:[0,'unavailable','unsupported'],`raw native length ${length}`);
 }
});
test('infinity canonicalization preserves escaped entities and every unrelated native byte',()=>{
 const f=infinityFixture(),Base=f.e.constructor;
 const parsed='(&infin;,&inf;)&cup;&amp;infin;+&infinite;+&Infin;+&#8734;+&infin';
 f.e.constructor=class extends Base{setLatex(){this.value=parsed}};
 const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:String.raw`\infty`});
 assert.ok(prepared.stage);assert.equal(f.e.value,'draft');
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).ok,true);
 assert.equal(f.e.value,'(&inf;,&inf;)&cup;&amp;infin;+&infinite;+&Infin;+&#8734;+&infin');
});
test('an infinity import is refused if native reparsing cannot retain its canonical serialization',()=>{
 const f=infinityFixture(),Base=f.e.constructor;
 f.e.constructor=class extends Base{setEqText(value){this.value=value.replaceAll('&inf;','&infin;')}};
 const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:String.raw`(-\infty,7)`});
 assert.equal(prepared.error,'unsupported');assert.equal(f.e.value,'draft');assert.equal(f.notifications(),0);
});
test('canonical infinity scratch is destroyed after staging, readback failure and parser exceptions',()=>{
 for(const mode of ['ok','mismatch','throw','empty']){
  const f=infinityFixture(),Base=f.e.constructor;let scratch,destroyed=0;
  f.e.constructor=class extends Base{
   constructor(options){super(options);scratch=this}
   setEqText(value){if(mode==='throw')throw Error('parse');super.setEqText(mode==='mismatch'?value+'x':value)}
   isEmpty(){return mode==='empty'}
   destroy(){destroyed++}
  };
  const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:String.raw`(-\infty,7)`});
  if(mode==='ok')assert.ok(prepared.stage);else{assert.equal(prepared.error,'unsupported');assert.equal(prepared.stage,undefined)}
  assert.notEqual(scratch,f.e);assert.equal(destroyed,1);assert.equal(f.e.value,'draft');assert.equal(f.notifications(),0);
  assert.equal(f.sandbox.__gzPearsonMathSessions.get(opened.token).stages.size,mode==='ok'?1:0);
 }
});
test('native events emitted by a setter are not emitted a second time',()=>{
 const f=fixture(),set=f.e.replaceEqText.bind(f.e);f.e.replaceEqText=value=>{set(value);f.e.doChange()};
 const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).ok,true);assert.equal(f.notifications(),1);
});
test('unsupported syntax and forged stages preserve the native answer',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'});
 assert.equal(f.call({op:'prepare',token:opened.token,latex:String.raw`\foo{x}`}).error,'unsupported');
 assert.equal(f.call({op:'apply',token:opened.token,stage:crypto.randomUUID()}).error,'expired');
 assert.equal(f.e.value,'draft');assert.equal(f.notifications(),0);
});
test('an answer edited after opening is never overwritten',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 f.e.value='new draft';assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'changed');assert.equal(f.e.value,'new draft');
});
test('a replaced native widget and disconnected question invalidate the composer',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'});f.w._editor={...f.e};
 assert.equal(f.call({op:'prepare',token:opened.token,latex:'x'}).error,'changed');
 f.connected(false);assert.equal(f.call({op:'prepare',token:opened.token,latex:'x'}).error,'expired');
});
test('native imports are refused outside active homework; disabling can still discard a session',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'});f.active(false);
 assert.equal(f.call({op:'prepare',token:opened.token,latex:'x'}).error,'inactive');
 assert.equal(f.call({op:'close',token:opened.token}).ok,true);f.active(true);
 f.sandbox.location.origin='https://tdx.acs.pearson.com.evil.test';assert.equal(f.call({op:'open',id:'S1'}).error,'inactive');
});
test('a native setter failure restores the original answer',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 f.e.replaceEqText=()=>{f.e.value='partial';throw Error('failed')};
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'unavailable');assert.equal(f.e.value,'draft');
});
test('native edits that return to the opening answer still invalidate the session and release listeners',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 f.e.value='other';f.e.doChange();f.e.value='draft';f.e.doChange();
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'changed');
 assert.equal(f.e.value,'draft');f.call({op:'close',token:opened.token});assert.equal(f.listeners.size,0);
});
test('scratch parsing preserves data settings without sharing nested state or binding validation to the answer',()=>{
 const f=fixture();f.e.initializationParameters={decimalSeparator:',',docSettings:{nested:{precision:4}},domNode:f.node};
 const Base=f.e.constructor;
 f.e.constructor=class extends Base {
  constructor(options){super(options);assert.equal(options.decimalSeparator,',');assert.equal(options.domNode,undefined);options.docSettings.nested.precision=9;}
  setLatex(value){this.isValidCharCode(65);super.setLatex(value)}
 };
 f.e.isValidCharCode=function(){this.validationCalls=(this.validationCalls||0)+1;return true};
 const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 assert.ok(prepared.stage);assert.equal(f.e.initializationParameters.docSettings.nested.precision,4);assert.equal(f.e.validationCalls,undefined);
});
test('changing native construction settings invalidates a prepared import',()=>{
 const f=fixture();f.e.initializationParameters={docSettings:{decimalSeparator:'.'}};
 const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 f.e.initializationParameters.docSettings.decimalSeparator=',';
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'changed');assert.equal(f.e.value,'draft');
});
test('moving a reused answer widget to a different question invalidates its composer',()=>{
 const f=fixture();let holder={};f.node.closest=selector=>selector==='.contentHolder'?holder:true;
 const opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});holder={};
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'changed');assert.equal(f.e.value,'draft');
});
test('scratch parsing cannot mutate a native filter configuration',()=>{
 const f=fixture(),Base=f.e.constructor;f.e.filterEqText={allow:['x']};f.e.constructor=class extends Base{setLatex(v){this.filterEqText.allow.push('y');super.setLatex(v)}};
 const opened=f.call({op:'open',id:'S1'});assert.ok(f.call({op:'prepare',token:opened.token,latex:'x'}).stage);assert.deepEqual(f.e.filterEqText.allow,['x']);
});
test('native imports cannot mutate answers after the requesting UI deadline',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage,deadline:Date.now()-1}).error,'expired');assert.equal(f.e.value,'draft');
});
test('a failed native import is consumed and its event observer is released',()=>{
 const f=fixture(),opened=f.call({op:'open',id:'S1'}),prepared=f.call({op:'prepare',token:opened.token,latex:'x'});
 const set=f.e.replaceEqText;f.e.replaceEqText=()=>{throw Error('failed')};
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'unavailable');f.e.replaceEqText=set;
 assert.equal(f.call({op:'apply',token:opened.token,stage:prepared.stage}).error,'expired');assert.equal(f.listeners.size,0);
});
test('native scans bound visits even when most widgets cannot be used',()=>{
 const f=fixture();let visited=0;
 const unusable=()=>({get id(){visited++;return ''},closest:()=>false,classList:{contains:()=>true}});
 f.sandbox.document.querySelectorAll=()=>Array.from({length:10000},unusable);
 f.sandbox.document.createTreeWalker=()=>({nextNode:unusable});
 const result=f.call({op:'scan'});assert.equal(result.labels.length,0);assert.equal(result.inputs.length,0);assert.ok(visited<=512,`visited ${visited}`);
});
test('native scans bound DOM traversal and the total formula payload',()=>{
 const f=fixture();let walks=0;const nodes=Array.from({length:10000},(_,i)=>({id:'L'+i,classList:{contains:k=>k==='eqLabel'},closest:()=>null}));
 f.sandbox.document.createTreeWalker=()=>({nextNode:()=>{walks++;return nodes[walks-1]}});
 f.sandbox.document.querySelectorAll=()=>{throw Error('unbounded DOM collection')};
 f.sandbox.dijit.byNode=()=>({getEqDoc:()=>({getLatex:()=> 'x'.repeat(8192)})});
 const result=f.call({op:'scan'});assert.ok(walks<=2048);assert.ok(result.labels.reduce((sum,v)=>sum+v.latex.length,0)<=32768);
});
test('notation preserves control-word boundaries and refuses pathological nesting and unfinished syntax',()=>{
 assert.equal(N.prepare(String.raw`\sin\,x+\pi\ x`),String.raw`\sin x+\pi x`);
 assert.equal(N.prepare(String.raw`x\leq2`),String.raw`x\le2`);
 for(const value of ['{'.repeat(100)+'x'+'}'.repeat(100),'\\sqrt '.repeat(200)+'x','x\\','{x','x}'])assert.equal(N.prepare(value),null);
});
const brokerFixture=({enhance={pearsonMath:true},held=[...require('../../extension/pearson/embed.js').hosts],afterProbe=()=>{}}={})=>{
 const source=fs.readFileSync(path.join(__dirname,'../../extension/background/pearson.js'),'utf8');
 const calls=[];let listener;
 const sandbox={URL,GZ_PEARSON_NATIVE:native,GZ_PEARSON_NOTATION:N,GZ_PEARSON_EMBED_LIB:require('../../extension/pearson/embed.js'),reachable:async h=>held.includes(h),switchOn:async k=>require('../../extension/content/defaults.js').GZ_SANITIZE({enhance}).enhance[k],chrome:{runtime:{id:'own',onMessage:{addListener:fn=>listener=fn}},storage:{sync:{get:async()=>({enabled:true,enhance})}},scripting:{executeScript:async value=>{calls.push(value);if(value.world!=='MAIN')afterProbe(held);return [{frameId:2,documentId:'original',result:value.world==='MAIN'?{ok:true}:true}]}}}};
 vm.runInNewContext(source,sandbox);
 const sender={id:'own',tab:{id:7},frameId:2,url:'https://tdx.acs.pearson.com/Player/Player.aspx',documentId:'original'};
 const run=(s=sender,m={type:'glaze:pearson-math',op:'scan',doc:'test',deadline:Date.now()+9000})=>new Promise(resolve=>listener(m,s,resolve));
 return {calls,sandbox,sender,run};
};
test('math requests require their switch and all hosts through the final native operation',async()=>{
 const hosts=require('../../extension/pearson/embed.js').hosts;
 for(const enhance of [{},{pearsonEmbed:true},{pearsonViewer:true}]){
  const f=brokerFixture({enhance});assert.equal((await f.run()).error,'inactive');assert.equal(f.calls.length,0);
 }
 for(const missing of hosts)for(const op of ['scan','open','prepare','apply']){
  const f=brokerFixture({held:hosts.filter(h=>h!==missing)});
  assert.equal((await f.run(f.sender,{type:'glaze:pearson-math',op,doc:'test',deadline:Date.now()+9000,id:'field',token:crypto.randomUUID(),stage:crypto.randomUUID(),latex:'x'})).error,'inactive');
  assert.equal(f.calls.length,0,`${missing}: ${op}`);
 }
 const f=brokerFixture({afterProbe:held=>held.pop()});
 assert.equal((await f.run()).error,'inactive');assert.ok(!f.calls.some(c=>c.world==='MAIN'));
 const cleanup=brokerFixture({held:[],enhance:{}});
 assert.equal((await cleanup.run(cleanup.sender,{type:'glaze:pearson-math',op:'close',doc:'test',token:crypto.randomUUID()})).ok,true,'cleanup can still release an existing session');
});
test('the broker admits only its own exact player document and pins script execution',async()=>{
 const {calls,sender,run}=brokerFixture();
 for(const bad of [{...sender,id:'foreign'},{...sender,url:'https://tdx.acs.pearson.com.evil.test/Player/Player.aspx'},{...sender,url:'https://tdx.acs.pearson.com/assignment/assignmentplayer.aspx'},{...sender,tab:null}])assert.equal((await run(bad)).error,'sender');
 assert.equal(calls.length,0);assert.equal((await run(sender)).ok,true);
 assert.deepEqual([...calls[0].target.documentIds],['original']);assert.deepEqual([...calls[1].target.documentIds],['original']);assert.equal(calls[1].world,'MAIN');
 assert.equal((await run(sender,{type:'glaze:pearson-math',op:'save',doc:'test'})).error,'request');
});
test('the broker refuses MAIN execution when its probe cannot pin one exact document',async()=>{
 for(const probe of [[{frameId:2,result:true}],[{frameId:3,documentId:'other',result:true}],[{frameId:2,documentId:'other',result:true}]]){
  const f=brokerFixture();f.sandbox.chrome.scripting.executeScript=async v=>{f.calls.push(v);return probe};
  assert.ok((await f.run()).error);assert.equal(f.calls.length,1);
 }
 const f=brokerFixture();assert.equal((await f.run({...f.sender,documentId:undefined})).ok,true);
 assert.deepEqual([...f.calls[0].target.frameIds],[2]);assert.deepEqual([...f.calls[1].target.documentIds],['original']);
});
test('the broker carries the UI deadline through asynchronous probes to native execution',async()=>{
 const f=brokerFixture(),deadline=Date.now()+9000;
 assert.equal((await f.run(f.sender,{type:'glaze:pearson-math',op:'scan',doc:'test',deadline})).ok,true);
 assert.equal(f.calls[1].args[0].deadline,deadline);
 const g=brokerFixture();assert.equal((await g.run(g.sender,{type:'glaze:pearson-math',op:'apply',doc:'test',token:crypto.randomUUID(),stage:crypto.randomUUID(),deadline:Date.now()-1})).error,'expired');assert.equal(g.calls.length,0);
});

// Small DOM and clock doubles keep lifecycle tests in Node, without launching a browser or loading remote code.
class Element {
 constructor(tag='div'){this.nodeType=1;this.tagName=tag.toUpperCase();this.children=[];this.attrs=new Map();this.listeners={};this.disabled=false;this.textContent='';this.styles=new Map();this.style={setProperty:(k,v,p='')=>this.styles.set(k,[v,p]),getPropertyValue:k=>this.styles.get(k)?.[0]||'',getPropertyPriority:k=>this.styles.get(k)?.[1]||'',removeProperty:k=>this.styles.delete(k)};this.contentWindow={postMessage:(...args)=>this.posts.push(args)};this.posts=[];}
 get classList(){return {contains:k=>this.className?.split(' ').includes(k)||false}}
 get isConnected(){return !!(this.root||this.parentElement?.isConnected)}
 matches(s){return s.split(',').some(k=>k[0]==='.'?this.classList.contains(k.slice(1)):k[0]==='#'?this.id===k.slice(1):this.tagName===k.toUpperCase())}
 closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null}
 append(...nodes){for(const n of nodes){n.remove?.();n.parentElement=this;this.children.push(n)}}
 after(n){const p=this.parentElement;n.remove();n.parentElement=p;p.children.splice(p.children.indexOf(this)+1,0,n)}
 remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null}}
 querySelector(s){return this.querySelectorAll(s)[0]||null}
 querySelectorAll(s){return this.children.flatMap(n=>[...(n.matches?.(s)?[n]:[]),...(n.querySelectorAll?.(s)||[])])}
 setAttribute(k,v){this.attrs.set(k,String(v))}getAttribute(k){return this.attrs.get(k)??null}hasAttribute(k){return this.attrs.has(k)}removeAttribute(k){this.attrs.delete(k)}
 toggleAttribute(k,v=!this.hasAttribute(k)){if(v)this.setAttribute(k,'');else this.removeAttribute(k)}
 addEventListener(k,fn){(this.listeners[k]||=[]).push(fn)}dispatch(k,event={}){for(const fn of this.listeners[k]||[])fn(event)}focus(){this.focused=true}
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
const uiFixture=()=>{
 const root=new Element('html');root.root=true;const body=new Element('body');root.append(body);
 const events={},timers=new Map();let clock=0;
 const document={documentElement:root,body,referrer:'https://tdx.acs.pearson.com/Player/Player.aspx',createElement:t=>new Element(t),getElementById:id=>root.querySelector('#'+id),querySelector:s=>root.querySelector(s)};
 const scope={document,URL,crypto,console,GZ_PEARSON_NOTATION:N,GZ_I18N:{ui:()=> 'en',t:k=>k},getComputedStyle:()=>[],
  setTimeout:(fn,ms)=>{timers.set(++clock,{fn,ms});return clock},clearTimeout:id=>timers.delete(id),
  addEventListener:(k,fn)=>(events[k]||=[]).push(fn),MutationObserver:class{constructor(fn){this.fn=fn;scope.observer=this}observe(_,opts){this.options=opts}disconnect(){}},
  MessageChannel:class{constructor(){this.port1={posts:[],postMessage(m){this.posts.push(m)},start(){},close(){this.closed=true}};this.port2={};(scope.channels||=[]).push(this.port1)}}
 };
 const dispatch=(k,e={})=>{for(const fn of events[k]||[])fn(e)};
 const tick=async ms=>{const entry=[...timers].find(([,t])=>t.ms===ms);assert.ok(entry,`timer ${ms} exists`);timers.delete(entry[0]);await entry[1].fn();await settle()};
 return {root,body,scope,document,events,timers,dispatch,tick};
};
const adapterFixture=()=>{
 const f=uiFixture(),player=new Element();player.id='playerViewer';player.className='playmode-homework';f.body.append(player);
 const label=new Element('span');label.id='formula';label.className='eqLabel';const original=new Element('span');original.className='eqDocument';original.style.setProperty('display','inline-block');label.append(original);player.append(label);
 const input=new Element('span');input.id='S1';input.className='inputField';player.append(input);
 const calls=[],pending=[];let reply={labels:[{id:'formula',latex:'x'}],inputs:[{id:'S1'}]};
 f.scope.chrome={runtime:{getURL:p=>'https://extension.test/'+p,sendMessage:(m,cb)=>{calls.push(m);if(m.op==='scan')cb(reply);else if(m.op==='open')cb({token:crypto.randomUUID(),latex:'draft'});else cb({ok:true})}}};
 f.scope.renderer={render:()=>new Element('span')};
 f.scope.getComputedStyle=el=>el===original?{display:original.style.getPropertyValue('display')||'inline-block'}:[];
 const source=fs.readFileSync(path.join(__dirname,'../../extension/pearson/adapter.js'),'utf8').replace("import(chrome.runtime.getURL('pearson/render.mjs'))",'Promise.resolve(renderer)');
 vm.runInNewContext(source,f.scope);
 return {...f,player,label,original,input,calls,pending,reply:v=>reply=v,api:f.scope.GZ_PEARSON_MATH,
  refresh:async()=>{f.scope.GZ_PEARSON_MATH.update(true);await f.tick(100)},
  open:async()=>{input.parentElement.querySelector('.gz-pearson-math-edit').dispatch('click');await settle();return f.root.querySelector('iframe')},
  ready:frame=>f.dispatch('message',{source:frame.contentWindow,origin:'https://extension.test',data:{gzPearsonMathReady:true}})};
};
test('the adapter bounds every worker request with a UI deadline',async()=>{
 const f=adapterFixture();await f.refresh();assert.ok(f.calls[0].deadline>Date.now());assert.ok(f.calls[0].deadline<=Date.now()+10000);f.api.update(false);
});
test('failed scans restore native formulas and dismiss the stale composer',async()=>{
 const f=adapterFixture();await f.refresh();await f.open();f.reply({error:'inactive'});f.scope.observer.fn([{target:f.player,addedNodes:[f.input],removedNodes:[]}]);await f.tick(100);
 assert.equal(f.original.style.getPropertyValue('display'),'inline-block');assert.equal(f.root.querySelector('.gz-pearson-math-composer'),null);assert.equal(f.root.querySelector('.gz-pearson-render'),null);f.api.update(false);
});
test('rendered formulas have an accessible name and allow print styles to restore the native formula',async()=>{
 const f=adapterFixture();await f.refresh();const display=f.label.querySelector('.gz-pearson-render');assert.equal(display.getAttribute('role'),'math');assert.equal(display.getAttribute('aria-label'),'x');assert.notEqual(display.getAttribute('aria-hidden'),'true');assert.equal(f.original.style.getPropertyPriority('display'),'');f.api.update(false);
});
test('modern rendering preserves formulas Pearson hides and later display changes',async()=>{
 const hidden=adapterFixture();hidden.original.style.setProperty('display','none');hidden.scope.getComputedStyle=el=>el===hidden.original?{display:'none'}:[];await hidden.refresh();assert.equal(hidden.root.querySelector('.gz-pearson-render'),null);hidden.api.update(false);
 const f=adapterFixture();await f.refresh();f.original.style.setProperty('display','block','important');f.api.update(false);assert.equal(f.original.style.getPropertyValue('display'),'block');assert.equal(f.original.style.getPropertyPriority('display'),'important');
});
test('a frame that announces itself but fails initialization still times out',async()=>{
 const f=adapterFixture();await f.refresh();const frame=await f.open();f.ready(frame);await f.tick(10000);assert.equal(f.root.querySelector('.gz-pearson-math-composer'),null);assert.ok(f.calls.some(m=>m.op==='close'));f.api.update(false);
});
test('native styles that prevent hiding a formula retain only the native presentation',async()=>{
 const f=adapterFixture();f.scope.getComputedStyle=el=>el===f.original?{display:'inline-block'}:[];await f.refresh();assert.equal(!!f.root.querySelector('.gz-pearson-render'),false);assert.equal(f.original.style.getPropertyValue('display'),'inline-block');f.api.update(false);
});
test('late open responses release sessions after a UI timeout',async()=>{
 const f=adapterFixture();await f.refresh();let answer;
 const send=f.scope.chrome.runtime.sendMessage;f.scope.chrome.runtime.sendMessage=(m,cb)=>{if(m.op==='open'){f.calls.push(m);answer=cb}else send(m,cb)};
 f.root.querySelector('.gz-pearson-math-edit').dispatch('click');await f.tick(10000);const token=crypto.randomUUID();answer({token,latex:'draft'});await settle();assert.ok(f.calls.some(m=>m.op==='close'&&m.token===token));assert.equal(f.root.querySelector('iframe'),null);f.api.update(false);
});
test('Pearson input closes the port and returns focus to the native answer',async()=>{
 const f=adapterFixture(),focus=new Element('input');focus.className='focusNode';f.input.append(focus);await f.refresh();const frame=await f.open();f.ready(frame);const port=f.scope.channels[0];await port.onmessage({data:{type:'close'}});assert.equal(focus.focused,true);assert.equal(port.closed,true);f.api.update(false);
});
test('a detached composer and a reloaded frame release their native sessions and ports',async()=>{
 const f=adapterFixture();await f.refresh();let frame=await f.open();f.ready(frame);const port=f.scope.channels[0];
 f.root.querySelector('.gz-pearson-math-composer').remove();f.scope.observer.fn([{target:f.player,addedNodes:[],removedNodes:[new Element()]}]);await f.tick(100);
 assert.ok(f.calls.some(m=>m.op==='close'));assert.equal(port.closed,true);assert.equal(f.root.querySelector('.gz-pearson-math-edit').getAttribute('aria-expanded'),null);
 frame=await f.open();f.ready(frame);f.ready(frame);assert.equal(f.root.querySelector('.gz-pearson-math-composer'),null);f.api.update(false);
});
test('adapter mutation tracking notices widget settings and ignores its own formula insertion',async()=>{
 const f=adapterFixture();await f.refresh();assert.equal(f.scope.observer.options.attributes,true);
 f.scope.observer.fn([{target:f.label,addedNodes:[f.label.querySelector('.gz-pearson-render')],removedNodes:[]}]);assert.equal([...f.timers.values()].some(t=>t.ms===100),false);f.api.update(false);
});

const frameFixture=(initial='x',normalize=v=>v)=>{
 const f=uiFixture();for(const id of ['editor','field','title','cancel','apply','symbols','status']){const el=new Element();el.id=id;f.body.append(el)}f.document.getElementById('apply').disabled=true;
 const port={posts:[],postMessage(m){this.posts.push(m)},start(){},close(){this.closed=true}};
 const parent={postMessage(){}};
 f.scope.parent=parent;f.scope.window={};f.scope.GZ_FONTS={load(){}};f.scope.ResizeObserver=class{observe(){}disconnect(){}};
 f.scope.MathfieldElement=class extends Element{constructor(){super('math-field');this.value=''}setValue(v){this.value=normalize(v)}getValue(){return this.value}insert(v){this.value+=v}};
 f.scope.render=()=>new Element('span');f.scope.signature=v=>typeof v==='string'&&!v.includes('invalid')?v:null;
 let source=fs.readFileSync(path.join(__dirname,'../../extension/pearson/frame.mjs'),'utf8').replace(/^import .*;$/gm,'').replace('import.meta.url',"'https://extension.test/pearson/frame.mjs'");
 vm.runInNewContext(source,f.scope);f.dispatch('message',{source:parent,origin:'https://tdx.acs.pearson.com',data:{type:'glaze:pearson-math:init',latex:initial},ports:[port]});
 return {...f,port,mf:f.document.getElementById('field').children[0],receive:m=>port.onmessage({data:m}),el:id=>f.document.getElementById(id)};
};
test('opening a lossy MathLive conversion cannot stage an answer',async()=>{
 const f=frameFixture('x+lost',()=> 'x');assert.equal(f.el('apply').disabled,true);assert.equal(f.mf.readOnly,true);assert.ok(f.el('status').textContent);assert.equal([...f.timers.values()].some(t=>t.ms===120),false);
});
test('a failed structural comparison never accepts two invalid signatures',async()=>{
 const f=frameFixture('x');await f.tick(120);f.mf.value='invalid';f.receive({type:'prepared',revision:1,stage:crypto.randomUUID(),latex:'invalid'});assert.equal(f.el('apply').disabled,true);
});
test('Use equation cannot apply a stage for a different visible expression',async()=>{
 const f=frameFixture('x');await f.tick(120);f.receive({type:'prepared',revision:1,stage:crypto.randomUUID(),latex:'x'});assert.equal(f.el('apply').disabled,false);
 f.mf.value='y';f.el('apply').dispatch('click');assert.equal(f.port.posts.some(m=>m.type==='apply'),false);assert.equal(f.el('apply').disabled,true);
});

// The renderer uses a DOMParser in the browser. This XML-only test double parses the small MathML fixtures below.
class MathParser {
 parseFromString(xml){const stack=[],all=[];for(const part of xml.match(/<[^>]+>|[^<]+/g)||[]){if(part.startsWith('</')){stack.pop();continue}if(part.startsWith('<')){
   const attrs=[...part.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,name,value])=>({name,value}));const n={localName:part.match(/^<([\w-]+)/)[1],attributes:attrs,children:[],textContent:''};all.push(n);if(stack.length)stack.at(-1).children.push(n);if(!part.endsWith('/>'))stack.push(n);
  }else for(const n of stack)n.textContent+=part;}
  return {documentElement:all[0],querySelector:()=>null};
 }
}
const rendererFixture=(deps={})=>{
 const source=fs.readFileSync(path.join(__dirname,'../../extension/pearson/render.mjs'),'utf8').replace(/^import .*;$/gm,'').replace(/export function /g,'function ');
 const scope={DOMParser:MathParser,validateLatex:()=>[],convertLatexToMathMl:v=>v==='styled'?'<mi mathvariant="bold">x</mi>':v==='fraction'?'<mfrac><mi>x</mi><mi>y</mi></mfrac>':v==='binomial'?'<mfrac linethickness="0"><mi>x</mi><mi>y</mi></mfrac>':'<mi>x</mi>',...deps};vm.runInNewContext(source,scope);return scope;
};
test('conversion signatures preserve meaning carried by MathML attributes',()=>{
 const f=rendererFixture();assert.notEqual(f.signature('styled'),f.signature('x'));assert.notEqual(f.signature('fraction'),f.signature('binomial'));
});
test('renderer parsing refuses excessive nesting before calling MathLive and contains parser failures',()=>{
 let calls=0;const f=rendererFixture({validateLatex:()=>{calls++;throw Error('parser')}});
 assert.equal(f.signature('{'.repeat(100)+'x'+'}'.repeat(100)),null);assert.equal(calls,0);assert.equal(f.signature('x'),null);assert.equal(f.render('x'),null);
});
test('real packaged MathLive retains native presentation aliases without confusing distinct expressions',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../../extension/vendor/mathlive/mathlive.mjs'),'utf8').replace(/export \{[\s\S]*$/,'').replace(/import\.meta\.url/g,"'https://extension.test/vendor/mathlive/mathlive.mjs'");
 const context={HTMLElement:class{},console:{...console,warn(){},error(){},log(){}}};vm.runInNewContext(source,context);
 const mathlive={validateLatex:context.validateLatex2,convertLatexToMathMl:context.convertLatexToMathMl};
 const f=rendererFixture(mathlive);
 for(const [a,b] of [[String.raw`\frac{x+1}{\sqrt{x^2+4}}`,String.raw`\dfrac{x+1}{\sqrt{x^{2}+4}}`],[String.raw`x\le2`,String.raw`x{\le}2`],[String.raw`\pi`,String.raw`{\pi}`],[String.raw`\left(x\right)`,'(x)']]){
  assert.equal(mathlive.validateLatex(a).length,0);assert.equal(typeof mathlive.convertLatexToMathMl(a),'string');
  assert.notEqual(f.signature(a),null,a);assert.equal(f.signature(a),f.signature(b),`${a} versus ${b}`);
 }
 for(const [a,b] of [[String.raw`\frac{x}{y}`,String.raw`\frac{y}{x}`],['x^2','x_2'],['x+1','x-1']])assert.notEqual(f.signature(a),f.signature(b));
});
