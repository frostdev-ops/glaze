const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const worker = require('../helpers/worker-env.cjs');
const K = require('../../extension/ai/ask.js');
const page = 'https://school.instructure.com/courses/25/assignments/7';
const sender = { id:'glaze',frameId:0,documentId:'doc',url:page,origin:new URL(page).origin,tab:{id:4,url:page} };
const live = (w) => { w.context.chrome.tabs.get=async()=>sender.tab; w.context.chrome.scripting.executeScript=async()=>[{documentId:'doc',frameId:0,result:{href:page,origin:sender.origin,ancestors:[],capture:{current:{site:'canvas',view:'assignment',course:{id:'25'},assignment:{id:'7'}},currentPage:page},account:'5'}}]; };
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
