const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const L = require('../../extension/pearson/embed.js');
const host = 'https://school.blackboard.com/ultra/courses/_101_1/lti/launchFrame';
const pass = target => 'https://school.blackboard.com/webapps/blackboard/execute/ultraFramePassThrough?redirectTo='+encodeURIComponent(target);
const target = 'https://school.blackboard.com/webapps/blackboard/execute/blti/launchLink?course_id=_101_1&content_id=_202_1&from_ultra=true';
test('native MyLab launch frames retain their expected tdx destination after redirects',()=>{
  assert.equal(L.child('https://mylab.pearson.com/Service/PlayerLaunch.ashx?synthetic_launch=one'),null,'only final homework documents activate the bridge');
  assert.equal(L.frameOrigin('https://mylab.pearson.com/Service/PlayerLaunch.ashx?synthetic_launch=one'),L.tdx);
  assert.equal(L.frameOrigin('https://tdx.acs.pearson.com/Player/Player.aspx'),L.tdx);
  for(const value of ['https://mylab.pearson.com.evil.test/Service/PlayerLaunch.ashx','https://mylab.pearson.com/Service/KeepSession.aspx','https://mylab.pearson.com/Service/OtherLaunch.ashx','https://name:secret@mylab.pearson.com/Service/PlayerLaunch.ashx','https://mylab.pearson.com:8443/Service/PlayerLaunch.ashx'])assert.equal(L.frameOrigin(value),null,value);
});
const homeworkFrames = ({standalone=false,frames=[],mode=null,href=L.mylab+'/Student/PlayerHomework.aspx?homeworkId=101'}={}) => {
  const events=new Map(),attrs=new Map(),sent=[],observers=[];
  const listen=(key,fn)=>events.set(key,[...(events.get(key)||[]),fn]);
  const parent={postMessage:(message,origin)=>sent.push({message,origin})};
  const html={toggleAttribute:(key,on)=>on?attrs.set(key,''):attrs.delete(key)};
  const document={documentElement:html,getElementsByTagName:()=>frames,querySelector:selector=>selector==='#playerViewer,#assignmentViewer'?mode:null,
    createElement:()=>({isConnected:false,remove(){this.isConnected=false;}}),head:{append(node){node.isConnected=true;}}};
  let enabled=true,pearsonAccess=true,enhance={pearsonViewer:true};
  const context=vm.createContext({document,parent,URL,GZ_PEARSON_EMBED_LIB:L,location:new URL(href),
    MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}},addEventListener:listen,
    chrome:{storage:{sync:{get:async()=>({enabled,enhance})},local:{get:async()=>({pearsonAccess})},onChanged:{addListener:fn=>listen('storage',e=>fn(e.changes,e.area))}}}});
  context.window=context;context.top=standalone?context:{};
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../extension/pearson/embedded.js'),'utf8'),context);
  const fire=(key,e)=>{for(const fn of events.get(key)||[])fn(e);};
  return {sent,attrs,parent,message:(data,{source=parent,origin=L.socket}={})=>fire('message',{data,source,origin}),
    enabled:async value=>{enabled=value;fire('storage',{changes:{enabled:{newValue:value}},area:'sync'});await new Promise(setImmediate);},
    access:async value=>{pearsonAccess=value;fire('storage',{changes:{pearsonAccess:{newValue:value}},area:'local'});await new Promise(setImmediate);},
    switches:async value=>{enhance=value;fire('storage',{changes:{enhance:{newValue:value}},area:'sync'});await new Promise(setImmediate);},settle:()=>new Promise(setImmediate),event:fire,
    mutate:()=>observers.forEach(fn=>fn([]))};
};
const nativeFrame = (src,original=null) => {
  const attrs=new Map(original===null?[]:[['data-gz-pearson-child',original]]),sent=[];
  return {src,sent,isConnected:true,contentWindow:{postMessage:(message,origin)=>sent.push({message,origin})},
    getAttribute:key=>attrs.get(key)??null,setAttribute:(key,value)=>attrs.set(key,String(value)),removeAttribute:key=>attrs.delete(key),
    toggleAttribute:(key,on)=>on?attrs.set(key,''):attrs.delete(key)};
};
test('open homework restores native child frames after a host is revoked or the last switch goes off',async()=>{
  const question=nativeFrame(L.mylab+'/Service/PlayerLaunch.ashx?synthetic_launch=one','native');
  const h=homeworkFrames({standalone:true,frames:[question]});await h.settle();
  assert.equal(question.getAttribute('data-gz-pearson-child'),'');
  await h.access(false);assert.equal(question.getAttribute('data-gz-pearson-child'),'native');
  await h.access(true);assert.equal(question.getAttribute('data-gz-pearson-child'),'');
  await h.switches({});assert.equal(question.getAttribute('data-gz-pearson-child'),'native');
});
test('standalone and awaiting-context homework expose only native child canvases and restore their markers',async()=>{
  for(const standalone of [true,false]){
    const question=nativeFrame(L.mylab+'/Service/PlayerLaunch.ashx?synthetic_launch=one','native'),unrelated=nativeFrame(L.mylab+'/Service/KeepSession.aspx');
    const h=homeworkFrames({standalone,frames:[question,unrelated]});await h.settle();
    assert.equal(question.getAttribute('data-gz-pearson-child'),'','the known native iframe must reveal the top-level canvas before context exists');
    assert.equal(unrelated.getAttribute('data-gz-pearson-child'),null);
    assert.equal(question.sent.length,0,'a standalone or unverified document cannot send context');
    await h.enabled(false);assert.equal(question.getAttribute('data-gz-pearson-child'),'native','global off restores the original marker');
    await h.enabled(true);assert.equal(question.getAttribute('data-gz-pearson-child'),'');
    h.event('pagehide',{persisted:false});assert.equal(question.getAttribute('data-gz-pearson-child'),'native','teardown restores the original marker');
    if(standalone)assert.equal(h.sent.length,0,'standalone canvas support does not start an embedding handshake');
  }
});
test('native child canvas markers follow homework mode and restore when a frame leaves the supported flow',async()=>{
  let homework=true;
  const activity=nativeFrame(L.tdx+'/Player/Player.aspx'),mode={classList:{contains:name=>name==='playmode-homework'&&homework}};
  const h=homeworkFrames({frames:[activity],mode,href:L.tdx+'/assignment/assignmentplayer.aspx'});await h.settle();
  assert.equal(activity.getAttribute('data-gz-pearson-child'),'');
  homework=false;h.mutate();assert.equal(activity.getAttribute('data-gz-pearson-child'),null,'test mode restores the native iframe canvas');
  homework=true;h.mutate();assert.equal(activity.getAttribute('data-gz-pearson-child'),'');
  activity.src=L.tdx+'/Account/SignIn.aspx';h.event('load',{target:{localName:'iframe'}});
  assert.equal(activity.getAttribute('data-gz-pearson-child'),null,'an unrelated native destination regains its original iframe canvas');
});
test('redirected question frames exchange appearance and navigation only with their expected window and origin',async()=>{
  const question=nativeFrame(L.mylab+'/Service/PlayerLaunch.ashx?synthetic_launch=one'),other=nativeFrame(L.mylab+'/Service/KeepSession.aspx');
  const h=homeworkFrames({frames:[question,other]});await h.settle();
  const context={gzPearsonFrame:'context',channel:'00000000-0000-4000-8000-000000000000',theme:{'--gz-ink':'#abcdef','--private':'secret'}};
  h.message(context,{source:{}});h.message(context,{origin:L.mylab});assert.equal(question.sent.length,0);
  h.message(context);assert.equal(question.sent.at(-1).origin,L.tdx);
  assert.deepEqual(JSON.parse(JSON.stringify(question.sent.at(-1).message)),{...context,theme:{'--gz-ink':'#abcdef'}});
  const locate={gzPearsonFrame:'locate',channel:context.channel,request:'11111111-1111-4111-8111-111111111111'};
  h.message(locate);assert.equal(question.sent.at(-1).origin,L.tdx);assert.equal(question.sent.at(-1).message,locate);assert.equal(other.sent.length,0);
  const count=h.sent.length,reply={gzPearsonFrame:'located',channel:context.channel,request:locate.request,question:2};
  for(const source of [other.contentWindow,{}])h.message(reply,{source,origin:L.tdx});
  h.message(reply,{source:question.contentWindow,origin:L.mylab});
  h.message({...reply,channel:locate.request},{source:question.contentWindow,origin:L.tdx});assert.equal(h.sent.length,count);
  h.message(reply,{source:question.contentWindow,origin:L.tdx});
  assert.equal(h.sent.at(-1).message.url,L.mylab+'/Student/PlayerHomework.aspx?homeworkId=101&questionId=2');
  assert.equal(h.sent.at(-1).message.request,locate.request);
});
test('pop-out keeps only bounded native homework navigation metadata',()=>{
  assert.equal(L.homework('https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=101&questionId=2&cId=201&custom_ies_session_token=secret&back=https://evil.test/#credential'), 'https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=101&questionId=2&cId=201');
  for(const u of ['https://mylab.pearson.com.evil.test/Student/PlayerHomework.aspx?homeworkId=101','https://mylab.pearson.com:8443/Student/PlayerHomework.aspx?homeworkId=101','https://name:secret@mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=101','https://mylab.pearson.com/Student/PlayerTest.aspx?homeworkId=101','https://mylab.pearson.com/Student/OverviewHomework.aspx?homeworkId=a','javascript:alert(1)'])assert.equal(L.homework(u),null,u);
});
test('authentication escape rebuilds a same-course native LTI launch instead of copying a callback token',()=>{
  assert.equal(L.launch(pass(target+'&unexpected=secret'),host),pass(target));
  for(const t of [target.replace('_101_1','_999_1'),target.replace('school.blackboard.com','evil.test'),target.replace('/blti/launchLink','/other'),target.replace('_202_1','../token')])assert.equal(L.launch(pass(t),host),null,t);
  assert.equal(L.launch(pass(target).replace('school.blackboard.com','evil.test'),host),null);
});
test('theme handoff contains only known CSS appearance tokens and rejects request-bearing CSS',()=>{
  assert.deepEqual(L.theme({'--gz-ink':'#abcdef','--gz-font':'"Glaze Inter", sans-serif','--gz-surface-fill':'color-mix(in srgb, #123 80%, transparent)','--gz-radius':'12px','--private':'secret'}),{'--gz-ink':'#abcdef','--gz-surface-fill':'color-mix(in srgb, #123 80%, transparent)','--gz-radius':'12px','--gz-font':'"Glaze Inter", sans-serif'});
  for(const bad of ['url(https://evil.test/x)','u\\72l(https://evil.test/x)','image-set("https://evil.test/x" 1x)','-webkit-image-set("https://evil.test/x" 1x)','image("https://evil.test/x")','src("https://evil.test/x")','red;}body{color:red','red;--other:x','@import x','\nred'])assert.deepEqual(L.theme({'--gz-surface-paint':bad}),{},bad);
});
const worker = ({enabled=true,approved=true,probe=true,documentId='pinned',enhance={pearsonEmbed:true},held=L.hosts,afterProbe=()=>{}}={})=>{
  let listener; const calls=[],opened=[];
  const context=vm.createContext({URL,console,GZ_PEARSON_EMBED_LIB:L,reachable:async h=>held.includes(h),switchOn:async k=>require('../../extension/content/defaults.js').GZ_SANITIZE({enabled,enhance}).enabled&&require('../../extension/content/defaults.js').GZ_SANITIZE({enhance}).enhance[k],addressOf:s=>s.url,fromUltra:async s=>approved&&s.url.startsWith('https://school.blackboard.com/ultra/')?'https://school.blackboard.com':null,beside:()=>({openerTabId:7}),
    importScripts:()=>{},chrome:{runtime:{id:'own',onMessage:{addListener:f=>listener=f}},storage:{sync:{get:async()=>({enabled,enhance})}},tabs:{get:async()=>({id:7,url:host}),create:async o=>opened.push(o)},scripting:{executeScript:async o=>{calls.push(o);if(o.func)afterProbe(held);return [{result:probe,...(documentId?{documentId}:{})}];}}}});
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../extension/background/pearson-embed.js'),'utf8'),context);
  return {calls,opened,send:(m,s)=>new Promise(resolve=>listener(m,s,resolve))};
};
const socket={id:'own',tab:{id:7},frameId:4,documentId:'original',url:'https://socket.pearsoned.com/uiservice/opener'};
const request={type:'glaze:pearson-embed',op:'launch',doc:'00000000-0000-4000-8000-000000000000'};
test('launch authorization requires the embedding switch and every host through the final injection',async()=>{
  for(const enhance of [{},{pearsonMath:true},{pearsonViewer:true}]){
    const w=worker({enhance});assert.equal((await w.send(request,socket)).ok,false,'an omitted embedding switch defaults off');assert.equal(w.calls.length,0);
  }
  for(const missing of L.hosts){
    const w=worker({held:L.hosts.filter(h=>h!==missing)});
    assert.equal((await w.send(request,socket)).ok,false,missing);assert.equal(w.calls.length,0,'a surviving opener cannot inject with a partial grant');
  }
  const w=worker({held:[...L.hosts],afterProbe:held=>held.pop()});
  assert.equal((await w.send(request,socket)).ok,false,'revoked while the probe awaited');
  assert.ok(!w.calls.some(o=>o.world==='MAIN'));
});
test('only the approved Blackboard tab can authorize the document-pinned native opener hook',async()=>{
  const w=worker();assert.equal((await w.send(request,socket)).ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls.at(-1))),{target:{tabId:7,documentIds:['pinned']},world:'MAIN',files:['pearson/launch-main.js'],injectImmediately:true});
  for(const change of [{id:'foreign'},{frameId:0},{url:'https://socket.pearsoned.com.evil.test/uiservice/opener'},{url:'https://socket.pearsoned.com/uiservice/other'}])assert.equal((await worker().send(request,{...socket,...change})).ok,false);
  for(const config of [{approved:false},{enabled:false},{enhance:{pearsonEmbed:false}},{probe:false}]){const no=worker(config);assert.equal((await no.send(request,socket)).ok,false);assert.ok(!no.calls.some(o=>o.world==='MAIN'));}
});
test('the opener receives its parent origin from the approved Blackboard tab, independent of redirect referrers',async()=>{
  const reply=await worker().send(request,socket);
  assert.equal(reply.host,new URL(host).origin);
});
test('MAIN injection refuses a frame-only race when the isolated probe cannot identify its document',async()=>{
  const no=worker({documentId:null});
  assert.equal((await no.send(request,{...socket,documentId:undefined})).ok,false);
  assert.ok(!no.calls.some(o=>o.world==='MAIN'));
  const pinned=worker({documentId:null});
  assert.equal((await pinned.send(request,socket)).ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(pinned.calls.at(-1).target)),{tabId:7,documentIds:['original']});
});
test('tab opening is limited to a recognized LTI host and canonical homework or fresh native launch',async()=>{
  const w=worker();const sender={id:'own',tab:{id:7},frameId:0,url:host};
  assert.equal((await w.send({type:request.type,op:'open',url:'https://mylab.pearson.com/Student/OverviewHomework.aspx?homeworkId=101&token=secret'},sender)).ok,true);
  assert.equal(w.opened[0].url,'https://mylab.pearson.com/Student/OverviewHomework.aspx?homeworkId=101');
  assert.equal((await w.send({type:request.type,op:'open',url:'https://evil.test/'},sender)).ok,false);
  assert.equal((await w.send({type:request.type,op:'open',url:pass(target)},sender)).ok,true);
  assert.equal((await w.send({type:request.type,op:'open',url:pass(target)},{...sender,url:'https://school.blackboard.com/ultra/stream'})).ok,false);
});
const launcher = () => {
  const events=new Map(), docEvents=new Map(), timers=new Map(), frames=[], calls=[]; let serial=0;
  const listen=(map,key,fn)=>map.set(key,[...(map.get(key)||[]),fn]), fire=(map,key,e)=>{for(const fn of map.get(key)||[])fn(e);};
  const native=function(model,target){calls.push({model,target});}, adapter={getLaunchAction:native}, model={native:'unchanged'};
  const button={disabled:false,click(){adapter.getLaunchAction(model,'_blank');}};
  const doc={readyState:'complete',hidden:false,documentElement:{setAttribute(){},removeAttribute(){}},getElementById:()=>button,
    createElement:()=>{const f={isConnected:false,setAttribute(){},addEventListener(){},remove(){this.isConnected=false;}};frames.push(f);return f;},
    body:{append(f){f.isConnected=true;}},addEventListener:(key,fn)=>listen(docEvents,key,fn),dispatchEvent:e=>fire(docEvents,e.type,e)};
  const c=vm.createContext({document:doc,location:{origin:L.socket,pathname:'/uiservice/opener'},top:{},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},
    SocketExperienceNamespace:{Adapter:{LaunchAdapter:adapter}},setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id),addEventListener:(key,fn)=>listen(events,key,fn)});
  c.window=c;vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../extension/pearson/launch-main.js'),'utf8'),c);
  return {frames,calls,adapter,native,model,config:enabled=>fire(docEvents,'glaze:pearson-launch-config',{detail:JSON.stringify({channel:request.doc,enabled})}),
    event:(type,e)=>fire(events,type,e),flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
};
test('a prepared opener restores its native handler across back/forward-cache navigation before auto launch',()=>{
  const h=launcher();h.config(true);h.event('pagehide',{persisted:true});h.event('pageshow',{persisted:true});h.flush();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].model,h.model);
  assert.equal(h.frames.filter(f=>f.isConnected).length,1);
  h.config(false);assert.equal(h.adapter.getLaunchAction,h.native);
  assert.equal(h.frames.filter(f=>f.isConnected).length,1,'an already launched session remains mounted');
  h.config(true);h.flush();assert.equal(h.calls.length,1,'re-enabling cannot relaunch or discard unsent work');
});
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
const bridge = ({authorize=async()=>({ok:true,host:new URL(host).origin}),read}={}) => {
  const events=new Map(),docEvents=new Map(),timers=new Map(),frames=[],sent=[],configs=[],requests=[],calls=[];
  let settings={enabled:true,enhance:{pearsonEmbed:true}},pearsonAccess=true,serial=0;
  const listen=(map,key,fn)=>map.set(key,[...(map.get(key)||[]),fn]),fire=(map,key,e)=>{for(const fn of map.get(key)||[])fn(e);};
  const parent={postMessage:(message,origin)=>sent.push({message,origin})},adapter={getLaunchAction(model,target){calls.push({model,target});}};
  const button={disabled:false,click(){adapter.getLaunchAction({},'_blank');}};
  const document={referrer:'https://interop.pearson.com/synthetic/redirect',readyState:'complete',hidden:false,
    documentElement:{setAttribute(){},removeAttribute(){},style:{setProperty(){}}},
    getElementById:id=>id==='btnOpenNewTab'?button:frames.find(f=>f.id===id&&f.isConnected),
    createElement:()=>{const f={isConnected:false,setAttribute(){},addEventListener(){},remove(){this.isConnected=false;},contentWindow:{postMessage(){}}};frames.push(f);return f;},
    body:{append(f){f.isConnected=true;}},addEventListener:(key,fn)=>listen(docEvents,key,fn),
    dispatchEvent:e=>{if(e.type==='glaze:pearson-launch-config')configs.push(JSON.parse(e.detail));fire(docEvents,e.type,e);}};
  const shared={document,location:{origin:L.socket,pathname:'/uiservice/opener'},top:{},parent,URL,
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},
    addEventListener:(key,fn)=>listen(events,key,fn),setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
  const main=vm.createContext({...shared,SocketExperienceNamespace:{Adapter:{LaunchAdapter:adapter}}});main.window=main;
  const context=vm.createContext({...shared,GZ_PEARSON_EMBED_LIB:L,crypto:{randomUUID:()=>request.doc},chrome:{
    runtime:{sendMessage:async message=>{requests.push(message);const reply=await authorize();if(reply?.ok)vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../extension/pearson/launch-main.js'),'utf8'),main);return reply;}},
    storage:{sync:{get:async()=>read?read():settings},local:{get:async()=>({pearsonAccess})},onChanged:{addListener:fn=>{listen(events,'storage',change=>fn(change,'sync'));listen(events,'local',change=>fn(change,'local'));}}}}});context.window=context;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../extension/pearson/launch.js'),'utf8'),context);
  return {parent,sent,configs,requests,calls,frames,event:(type,e)=>fire(events,type,e),
    message:(data,{source=parent,origin=new URL(host).origin}={})=>fire(events,'message',{data,source,origin}),
    settings:value=>{settings=value;fire(events,'storage',Object.fromEntries(Object.entries(value).map(([key,newValue])=>[key,{newValue}])));},
    access:async value=>{pearsonAccess=value;fire(events,'local',{pearsonAccess:{newValue:value}});await new Promise(setImmediate);},
    changed:()=>fire(events,'storage',{enabled:{newValue:false}}),
    settle:()=>new Promise(setImmediate),flush(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}};
};
const hostContext={gzPearsonEmbed:'context',channel:request.doc,enabled:true,theme:{}};
test('a prepared opener restores its native handler when any host is revoked',async()=>{
  const h=bridge();await h.settle();h.message(hostContext);
  await h.access(false);h.flush();
  assert.equal(h.calls.length,0,'revocation cancels the pending native launch');
  assert.equal(h.frames.filter(f=>f.isConnected).length,0);
});
test('redirect bootstrap waits for worker authorization and an enabled context from the verified direct parent',async()=>{
  const pending=deferred(),h=bridge({authorize:()=>pending.promise});await h.settle();
  h.message(hostContext);assert.equal(h.sent.length,0);assert.equal(h.configs.length,0);
  pending.resolve({ok:true,host:new URL(host).origin});await h.settle();
  assert.deepEqual(h.sent.map(s=>({op:s.message.gzPearsonEmbed,origin:s.origin})),[{op:'hello',origin:new URL(host).origin}]);
  h.flush();assert.equal(h.calls.length,0,'worker authorization alone leaves the MAIN hook inert');
  h.message(hostContext,{origin:'https://interop.pearson.com'});h.message(hostContext,{source:{}});h.flush();
  assert.equal(h.configs.length,0,'redirect and sibling messages have no authority');
  h.message({...hostContext,enabled:false});h.flush();assert.equal(h.calls.length,0);
  h.message(hostContext);h.flush();assert.equal(h.calls.length,1);
});
test('a cached opener suspends prepared launch consent until fresh authorization and parent context',async()=>{
  const denied=deferred();let attempts=0;const h=bridge({authorize:()=>++attempts===1?Promise.resolve({ok:true,host:new URL(host).origin}):denied.promise});
  await h.settle();h.message(hostContext);
  h.event('pagehide',{persisted:true});h.event('pageshow',{persisted:true});h.flush();
  assert.equal(h.calls.length,0,'restoration cannot replay the old enabled MAIN configuration');
  await h.settle();assert.equal(h.requests.length,2,'restoration revalidates the current tab and consent');
  h.message(hostContext);denied.resolve({ok:false});await h.settle();h.flush();
  assert.equal(h.calls.length,0,'a rejected restoration keeps the native opener');
  assert.equal(h.sent.length,1,'failed reauthorization cannot post to an unverified host');
});
test('an authorization reply from before pagehide cannot authorize a restored opener',async()=>{
  const old=deferred(),fresh=deferred();let attempts=0;const h=bridge({authorize:()=>++attempts===1?old.promise:fresh.promise});
  await h.settle();h.event('pagehide',{persisted:true});h.event('pageshow',{persisted:true});await h.settle();
  old.resolve({ok:true,host:new URL(host).origin});await h.settle();
  assert.equal(h.sent.length,0,'a stale successful reply cannot announce a trusted host');
  assert.equal(h.requests.length,2);
  fresh.resolve({ok:true,host:new URL(host).origin});await h.settle();
  h.message(hostContext);h.flush();assert.equal(h.calls.length,1);
});
test('a stale consent read cannot override a newer disabled preference during bootstrap',async()=>{
  const old=deferred();let reads=0;const h=bridge({read:()=>++reads===1?old.promise:Promise.resolve({enabled:false})});
  h.changed();await h.settle();old.resolve({enabled:true});await h.settle();
  assert.equal(h.requests.length,0,'the newer disabled preference prevents authorization');
});
test('revoking consent during bootstrap leaves the native opener and can be re-enabled',async()=>{
  const pending=deferred(),h=bridge({authorize:()=>pending.promise});await h.settle();
  h.settings({enabled:false});await h.settle();pending.resolve({ok:true,host:new URL(host).origin});await h.settle();
  h.message(hostContext);h.flush();assert.equal(h.calls.length,0);
  h.settings({enabled:true,enhance:{pearsonEmbed:true}});await h.settle();h.message(hostContext);h.flush();assert.equal(h.calls.length,1);
});
test('a disable notification blocks a pending authorization before its storage refresh finishes',async()=>{
  for(const disabled of [{enabled:false},{enhance:{pearsonEmbed:false}}]){
  const consent=deferred(),authorization=deferred();let reads=0;
  const h=bridge({read:()=>++reads===1?Promise.resolve({enabled:true,enhance:{pearsonEmbed:true}}):consent.promise,authorize:()=>authorization.promise});
  await h.settle();h.settings(disabled);authorization.resolve({ok:true,host:new URL(host).origin});await h.settle();
  h.message(hostContext);h.flush();const launches=h.calls.length;
  consent.resolve(disabled);await h.settle();
  assert.equal(launches,0,'the disable notification takes effect before an asynchronous refresh');
  }
});
test('reauthorizing an active cached opener preserves its native session without another launch',async()=>{
  const h=bridge();await h.settle();h.message(hostContext);h.flush();const mounted=h.frames.find(f=>f.isConnected);
  h.event('pagehide',{persisted:true});h.event('pageshow',{persisted:true});await h.settle();h.message(hostContext);h.flush();
  assert.equal(h.calls.length,1);assert.equal(h.frames.find(f=>f.isConnected),mounted);
});
