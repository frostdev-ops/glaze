const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const worker = require('../helpers/worker-env.cjs');
const K = require('../../extension/ai/ask.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const S = require('../../extension/ai/schema.js');
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

const writerFixture = async () => {
  const w = worker();
  const binding = { token: 'b'.repeat(32), revision: 3 };
  const key = 'doc:00000000-0000-4000-8000-000000000000';
  const state = { binding, key, revision: 3 };
  const realm = (value) => vm.runInContext('JSON.parse', w.context)(JSON.stringify(value));
  w.context.chrome.tabs.get = async () => sender.tab;
  w.context.chrome.scripting.executeScript = async () => [{ documentId: 'doc', frameId: 0, result: realm({
    href: page, origin: sender.origin, ancestors: [], account: '5',
    capture: { currentPage: page, current: { site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '7' } }, writer: state.binding },
  }) }];
  const writerSender = { id: 'glaze', frameId: 3, documentId: 'writer-doc', url: 'chrome-extension://x/writer.html', origin: 'chrome-extension://x', tab: sender.tab };
  await vm.runInContext('aiFrameHost', w.context)(writerSender, sender);
  const reconnect = () => {
    const channel = w.connect('glaze:ask-writer', writerSender);
    channel.port.postMessage = (m) => queueMicrotask(() => channel.say({ id: m.id, value: {
      ...binding, revision: state.revision, key: state.key, context: { kind: state.kind || 'assignment' }, ...(state.mode && { mode: state.mode }), ...(state.kind && { kind: state.kind }), ...(state.owner && { owner: state.owner }), title: 'Draft', text: 'Draft:\nUnsaved words',
    } }));
    return channel;
  };
  const channel = reconnect();
  await w.settle();
  return { w, state, binding, channel, realm, reconnect, capture: (pin = binding) => vm.runInContext('rimeCurrent', w.context)(sender, { currentPage: page, writer: pin }) };
};

test('current document reads retain their document scope without an invalid account argument', async () => {
  const h = await writerFixture();
  const snap = await h.capture();
  for (const name of ['document_read', 'document_assignment']) {
    const call = { name, arguments: { document: snap.current.document.id }, kind: 'read' };
    const input = h.w.context.GZ_AI_TASK_AGENT_TOOLS.task.input(h.realm({ question: 'Read my draft', tools: [name], steps: [], now: 1, zone: 'UTC', current: snap.current }));
    const bound = snap.bind(call, input);
    assert.deepEqual(S.validate(bound.arguments, A.SPECS.find((s) => s.name === name).parameters), [], name);
    assert.deepEqual(bound.arguments, call.arguments);
  }
});

test('a missing, mismatched or stale Writer pin cannot fall back to the surrounding assignment', async () => {
  const h = await writerFixture();
  assert.equal(await h.capture({ ...h.binding, revision: 2 }), null, 'the page and question must agree');
  h.state.revision = 4;
  assert.equal(await h.capture(), null, 'the live editor must still hold the requested revision');
  h.state.revision = 3;
  h.state.key = 'school.instructure.com|6|25|7';
  assert.equal(await h.capture(), null, 'another account cannot supply the draft');
  h.channel.close();
  assert.equal(await h.capture(), null, 'a closed editor cannot supply the draft');
});

test('Writer pins compare fields independently of serialization order and keep the exact key throughout the turn', async () => {
  const h = await writerFixture();
  const snap = await h.capture({ revision: 3, token: h.binding.token });
  assert.ok(snap?.current?.document, 'equivalent pins are accepted');
  h.state.key = 'doc:11111111-1111-4111-8111-111111111111';
  assert.equal(await snap.valid(), false, 'even an unchanged token and revision cannot switch the pinned key');
});

test('a worker without a Writer port wakes the editor and awaits its authenticated pinned reply with agent access off', async () => {
  const h = await writerFixture();
  h.channel.close();
  let wakes = 0;
  h.w.context.chrome.runtime.sendMessage = async (m) => {
    assert.equal(m.type, 'glaze:ask-writer');
    assert.equal(m.op, 'wake');
    wakes++;
    setImmediate(h.reconnect);
  };
  const snap = await h.capture();
  assert.ok(snap?.current?.document, 'the reconnecting editor supplies the exact draft');
  assert.equal(snap.current.material.text, 'Draft:\nUnsaved words');
  assert.equal(wakes, 1);
  assert.equal(h.w.store.local.mcp, undefined);
  assert.equal(await snap.valid(), true);
  assert.equal(wakes, 1, 'freshness checks keep the authenticated port');
});

test('active context cannot displace the tools for an explicitly requested action', () => {
  for (const current of [
    { site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '7' } },
    { site: 'canvas', view: 'document', document: { id: 'document:' + 'a'.repeat(32) } },
  ]) {
    const cancel = K.route('Cancel my reminder for this assignment', { level: 3, current });
    assert.ok(cancel.tools.includes('wakes_list'));
    assert.ok(cancel.tools.includes('wake_cancel'), JSON.stringify(cancel));
    const open = K.route('Go to this assignment and highlight the deadline', { level: 3, current });
    for (const name of ['places_list', 'place_open', 'page_highlight']) assert.ok(open.tools.includes(name), name);
    assert.ok(cancel.tools.length <= K.LIMIT.tools && open.tools.length <= K.LIMIT.tools);
  }
});

test('the Writer current port requires an extension Writer page, even with a legacy frame seat', async () => {
  const w = worker();
  live(w);
  // Browsers without a writer documentId cannot let a reused frame id lend the old extension page's seat to an LMS script.
  const frame = { id: 'glaze', frameId: 3, url: 'chrome-extension://x/writer.html', origin: 'chrome-extension://x', tab: sender.tab };
  await vm.runInContext('aiFrameHost', w.context)(frame, sender);
  for (const extra of [
    { url: page, origin: sender.origin },
    { url: 'chrome-extension://x/options.html' },
    { id: 'another-extension' },
  ]) {
    const { port } = w.connect('glaze:ask-writer', { ...frame, ...extra });
    await w.settle();
    assert.equal(port.hungUp, true, JSON.stringify(extra));
  }
});

const until = async (done) => {
  const end = Date.now() + 1000;
  while (!done() && Date.now() < end) await new Promise(setImmediate);
  assert.ok(done(), 'the requested state was reached');
};
const currentPort = (capture, counts = false) => {
  const [pagePort, workerPort] = K.channel(), got = [], sent = [];
  pagePort.onMessage.addListener((m) => got.push(m));
  const env = { allowed: async () => true, current: capture, counts, level: async () => 3, now: () => 1, zone: 'UTC',
    state: async () => ({}), registry: { get: () => null, describe: () => ({}) },
    refresh: async () => null, accounts: async () => [], turn: (f) => f(),
    broker: (p) => p.onMessage.addListener((m) => {
      if (m.op === 'cancel') return;
      sent.push(m);
      p.postMessage(m.op === 'count' ? { id: m.id, type: 'end', used: 1, window: 4096, reserve: 1 } :
        { id: m.id, type: 'end', output: { kind: 'hint', step: null, reply: 'Consider the first step.', followUp: null } });
    }) };
  const connection = K.connect(workerPort, env);
  return { got, sent, env, say: (m) => pagePort.postMessage(m), close: connection.close };
};

for (const phase of ['capture', 'validation']) test(`Stop releases an Ask turn while current ${phase} is stalled`, async () => {
  let entered = false;
  const pending = () => { entered = true; return new Promise(() => {}); };
  const h = currentPort(phase === 'capture' ? pending : async () => ({ valid: pending }));
  try {
    h.say({ id: 70, op: 'ask', question: 'Explain mitosis' });
    await until(() => entered);
    h.say({ id: 70, op: 'cancel' });
    await until(() => h.got.some((m) => m.id === 70 && m.type === 'error'));
    assert.equal(h.got.find((m) => m.id === 70 && m.type === 'error').error, 'cancelled');
    h.env.current = async () => ({ valid: async () => true });
    h.say({ id: 71, op: 'ask', question: 'Explain mitosis' });
    await until(() => h.got.some((m) => m.id === 71 && ['end', 'error'].includes(m.type)));
    assert.equal(h.got.find((m) => m.id === 71 && ['end', 'error'].includes(m.type)).type, 'end');
  } finally { h.close(); }
});

test('a stale current snapshot is rejected before its first measurement as well as its model run', async () => {
  const h = currentPort(async () => ({ valid: async () => false, current: {
    site: 'canvas', view: 'assignment', course: { id: '25' }, assignment: { id: '7' },
    material: { text: 'Old assignment instructions', source: 'instructions', truncated: false },
  } }), true);
  try {
    h.say({ id: 72, op: 'ask', question: 'When is this due?' });
    await until(() => h.got.some((m) => m.type === 'error'));
    assert.equal(h.got.find((m) => m.type === 'error').error, 'changed');
    assert.deepEqual(h.sent, [], 'stale material never reaches count or run');
  } finally { h.close(); }
});


test('current account lease exists without a resource or Writer, and refreshes outside capture availability', async () => {
  const w = worker(); live(w);
  const snap = await vm.runInContext('rimeCurrent', w.context)(sender);
  assert.equal(snap.account, sender.origin + '/5');
  assert.equal(snap.current, undefined, 'the account lease is separate from visible current');
  const top = {}; top.top = top;
  w.context.window = top; w.context.location = new URL(sender.origin + '/');
  w.context.GZ_CTX = { site: 'canvas' };
  w.context.fetch = async () => ({ ok: true, json: async () => ({ id: 5 }) });
  const read = await vm.runInContext('rimeRead()', w.context);
  assert.equal(read.account, '5'); assert.equal(read.capture, undefined);
});

test('course-only deictic help offers reads without guessing an active assignment', () => {
  const route = K.route('What should I do here?', { level: 3, current: { site: 'canvas', view: 'course', course: { id: '25' } } });
  assert.equal(route.task, 'study.help'); assert.ok(route.read.includes('assignments_list'));
});

test('course fallback does not turn context-only drafts or unrecognized resources into assignment reads', () => {
  for (const surface of [
    { view: 'document', document: { kind: 'discussion', revision: 3 }, material: { text: 'Draft:\nUnsaved words', source: 'writer', truncated: false } },
    { view: 'content' },
    { view: 'page' },
  ]) {
    const route = K.route('Explain this', { level: 3, current: { site: 'canvas', course: { id: '25' }, ...surface } });
    assert.equal(route.task, 'study.help');
    assert.equal(route.read, undefined, surface.view + ' supplies no active assignment');
  }
});

test('compose draft needs original editor owner and never fabricates a document handle', async () => {
  const h = await writerFixture();
  h.state.key = null; h.state.mode = 'compose'; h.state.kind = 'post'; h.state.owner = sender.origin + '/5';
  const snap = await h.capture();
  assert.ok(snap.current.document); assert.equal(snap.current.document.kind, 'discussion');
  assert.equal(snap.current.document.id, undefined); assert.equal(snap.current.material.source, 'writer');
  assert.equal(await snap.valid(), true);
  h.state.owner = sender.origin + '/6'; assert.equal(await snap.valid(), false);
  assert.equal(await h.capture(), null, 'a different original editor account cannot supply this draft');
  delete h.state.owner; assert.equal(await h.capture(), null, 'unknown original owner is not authority');
  h.state.owner = sender.origin + '/5'; h.state.kind = 'unknown'; assert.equal(await h.capture(), null);
});
