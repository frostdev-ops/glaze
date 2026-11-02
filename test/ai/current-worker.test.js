const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const worker = require('../helpers/worker-env.cjs');
const K = require('../../extension/ai/ask.js');
const page = 'https://school.instructure.com/courses/25/assignments/7';
const sender = { id:'glaze',frameId:0,documentId:'doc',url:page,origin:new URL(page).origin,tab:{id:4,url:page} };
const live = (w) => { w.context.chrome.tabs.get=async()=>sender.tab; w.context.chrome.scripting.executeScript=async()=>[{documentId:'doc',frameId:0,result:vm.runInContext('JSON.parse',w.context)(JSON.stringify({href:page,origin:sender.origin,ancestors:[],capture:{current:{site:'canvas',view:'assignment',course:{id:'25'},assignment:{id:'7'}},currentPage:page},account:'5'}))}]; };
test('Ask current is live capture, not caller supplied authority, and goes stale on navigation/account change', async()=>{
 const w=worker({store:{sync:{version:2,enabled:true,enhance:{}},local:{},session:{}}}); live(w);
 const snapshot=await vm.runInContext('rimeCurrent',w.context)(sender,{current:{site:'canvas',view:'assignment',course:{id:'999'}},currentPage:page});
 assert.equal(snapshot.current.course.id,'25'); assert.equal(snapshot.current.assignment.id,'7');
 assert.equal(await snapshot.valid(),true);
 w.context.chrome.scripting.executeScript=async()=>[{documentId:'doc',frameId:0,result:{href:page,origin:sender.origin,ancestors:[],account:'6'}}];
 assert.equal(await snapshot.valid(),false,'account changes revoke current');
});
test('Ask episode propagates current into every model and measurement turn, including corrective turns', async()=>{
 const current={site:'canvas',view:'assignment',course:{id:'25'},assignment:{id:'7'}}, runs=[],counts=[]; let n=0;
 const result=await K.episode({question:'When is this due?',tools:['todo_list'],locale:'en',now:1,zone:'UTC',first:true,current,measure:async(t,i)=>{counts.push(i);return null;},call:async()=>({result:{items:[]}}),run:async(t,i)=>{runs.push(i);n++;if(n<3)return{call:{name:'todo_list',arguments:{},kind:'read'},answer:null};return{call:null,answer:{text:'No date.',quotes:[]}};}});
 assert.ok(result.answer); assert.equal(runs.length,3); for(const i of [...runs,...counts])assert.deepEqual(i.current,current);
});
test('deictic coursework questions route using live resource context while first-turn reads remain mandatory',()=>{
 const current={site:'canvas',view:'assignment',course:{id:'25'},assignment:{id:'7'}};
 const r=K.route('What do I do here?',{level:3,current}); assert.equal(r.task,'study.help');assert.ok(r.read.includes('assignment_read'));
 assert.ok(K.route('When is this due?',{level:3,current}).tools.includes('assignment_read'));
 const content=K.route('Explain this',{level:3,current:{site:'canvas',view:'content',course:{id:'25'},content:{id:'8',kind:'page'}}}); assert.ok(content.read.includes('content_read'));
});
test('Ask alone admits a positively classified Ultra assignment; all ancestors and document identity remain required',async()=>{
 const url='https://school.blackboard.com/ultra/courses/_25_1/assessment/_7_1/attempt/create',origin=new URL(url).origin;
 const s={id:'glaze',frameId:0,documentId:'doc',url,origin,tab:{id:4,url}};
 const w=worker({store:{sync:{version:2,enabled:true,enhance:{}},local:{ultra:[origin]},session:{}}});
 w.context.chrome.tabs.get=async()=>s.tab;
 let doc='doc',ancestors=[];
 w.context.chrome.scripting.executeScript=async()=>[{documentId:doc,frameId:0,result:{href:url,origin,ancestors,attemptKind:'assignment'}}];
 const gate=vm.runInContext('aiSender',w.context);
 assert.equal(await gate(s,{feature:'ask',op:'run'}),false);
 assert.deepEqual(await w.send({type:'glaze:attempt-kind',kind:'assignment'},s),{ok:true});
 assert.equal(await gate(s,{feature:'ask',op:'run'}),true);
 assert.equal(await gate(s,{feature:'writing',op:'run'}),false,'no other AI feature admission is broadened');
 doc='replacement'; assert.equal(await gate(s,{feature:'ask',op:'run'}),false); doc='doc';
 ancestors=[origin+'/ultra/courses/_25_1/assessment/_9_1/overview']; assert.equal(await gate(s,{feature:'ask',op:'run'}),false);ancestors=[];
 assert.deepEqual(await w.send({type:'glaze:attempt-kind',kind:'unknown'},s),{ok:true}); assert.equal(await gate(s,{feature:'ask',op:'run'}),false);
});
test('active-ID account binding uses fresh account only and preserves independent cross-account grounding',async()=>{
 const w=worker({store:{sync:{version:2,enabled:true,enhance:{}},local:{},session:{}}}); live(w);
 const snap=await vm.runInContext('rimeCurrent',w.context)(sender,{currentPage:page});
 const A=w.context.GZ_AI_TASK_AGENT_TOOLS, inp=A.task.input(vm.runInContext('JSON.parse',w.context)(JSON.stringify({question:'When is this due?',tools:['assignment_read'],current:snap.current,steps:[],first:true,now:1,zone:'UTC'})));
 const call={name:'assignment_read',arguments:{course:'25',assignment:'7'},kind:'read'};
 assert.equal(snap.bind(call,inp).arguments.account,sender.origin+'/5');
 assert.throws(()=>snap.bind({...call,arguments:{...call.arguments,account:sender.origin+'/6'}},inp),/changed/);
 inp.question='Read assignment 7 in course 25 from the other account';
 assert.equal(snap.bind({...call,arguments:{...call.arguments,account:sender.origin+'/6'}},inp).arguments.account,sender.origin+'/6');
 assert.equal(await vm.runInContext('rimeCurrent',w.context)(sender,{currentPage:page+'/old'}),null);
});
test('Writer current is tied to exact host, token and revision with agent access off; raw key never reaches current',async()=>{
 const w=worker({store:{sync:{version:2,enabled:true,enhance:{}},local:{},session:{}}}); live(w);
 const binding={token:'a'.repeat(32),revision:3}, key='doc:00000000-0000-4000-8000-000000000000';
 const makeResult=()=>vm.runInContext('JSON.parse',w.context)(JSON.stringify({href:page,origin:sender.origin,ancestors:[],capture:{current:{site:'canvas',view:'assignment',course:{id:'25'},assignment:{id:'7'}},currentPage:page,writer:binding},account:'5'}));
 w.context.chrome.scripting.executeScript=async()=>[{documentId:'doc',frameId:0,result:makeResult()}];
 const writerSender={id:'glaze',frameId:3,documentId:'writer-doc',url:'chrome-extension://x/writer.html',origin:'chrome-extension://x',tab:sender.tab};
 await vm.runInContext('aiFrameHost',w.context)(writerSender,sender);
 const {port,say}=w.connect('glaze:ask-writer',writerSender); let revision=3;
 port.postMessage=(m)=>{port.posted.push(m);queueMicrotask(()=>say({id:m.id,value:{...binding,revision,key,context:{kind:'assignment'},title:'Draft',text:'Draft:\nUnsaved words',truncated:false}}));};
 await w.settle();
 const snap=await vm.runInContext('rimeCurrent',w.context)(sender,{currentPage:page,writer:binding});
 assert.match(snap.current.document.id,/^document:[a-f0-9]{32}$/);assert.equal(snap.current.document.revision,3);
 assert.equal(snap.current.material.text,'Draft:\nUnsaved words');assert.ok(!JSON.stringify(snap.current).includes(key));assert.equal(w.store.local.mcp,undefined);
 assert.equal(await snap.valid(),true); revision=4; assert.equal(await snap.valid(),false);
});
