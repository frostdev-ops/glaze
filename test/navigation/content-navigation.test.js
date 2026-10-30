const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../lib/coursetabs.js');
const U = require('../lib/ultra.js');
const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a,b) => source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const origin = 'https://bb.school.test';
const redirect = '/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_900_1&parentId=_800_1';

test('search uses the canonical target of a course link instead of the outline or API self id', () => {
  const item = {id:'_999_1',title:'Discussion',availability:{available:'Yes',adaptiveRelease:{}},contentHandler:{id:'resource/x-bb-courselink'},links:[
    {rel:'self',href:'/learn/api/public/v1/courses/_101_1/contents/_999_1'}, {rel:'alternate',href:origin+redirect}]};
  assert.equal(U.contentLink(item,'_101_1',origin),redirect);
  const rows=U.searchItems(U.SEARCH_KINDS[0],[item],{id:'_101_1',name:'Course'},s=>s,Date.now(),origin);
  assert.equal(rows[0].url,redirect);
  for(const href of ['https://other.test'+redirect,'javascript:alert(1)','/learn/api/public/v1/courses/_101_1/contents/_999_1',redirect+'&course_id=_102_1']) {
    assert.equal(U.contentLink({...item,links:[{rel:'alternate',href}]},'_101_1',origin),null,href);
  }
  assert.equal(U.contentLink({...item,links:[]},'_101_1',origin),null,'a course link without a verified destination never invents one');
});

test('redirect course ownership preserves its query and refuses conflicting identifiers', () => {
  assert.equal(L.courseOf('/ultra/redirect',redirect.split('?')[1]),'_101_1');
  assert.equal(L.courseOf('/ultra/redirect','?courseId=_101_1&course_id=_102_1'),null);
  assert.equal(L.courseOf('/ultra/redirect','?contentId=_900_1'),null);
  assert.equal(L.courseOf('/ultra/courses/_101_1/../_102_1/outline'),null);
});

function navigation({framed='',showing='',course='_101_1'}={}) {
  const calls=[];
  const doc={querySelectorAll(){throw Error('navigation must not scan a large outline');}};
  const frame={el:{contentWindow:{location:{assign:u=>calls.push(['native',u])}}}};
  const bar=vm.runInNewContext(part('  const bar = {','  return { sync')+'\nbar;',{
    L,URL,on:true,framed,showing,ctx:{site:'ultra',courseId:()=>course},location:{origin},document:doc,
    frames:new Map([['_101_1',frame]]),toTop:(op,m)=>calls.push([op,m.url]),openAt:(cid,url)=>calls.push(['open',cid,url]),
    route:u=>calls.push(['history',u]),show:c=>calls.push(['show',c])
  });
  return {bar,calls};
}

test('an explicit palette destination uses native navigation, independent of outline size and remember preferences', () => {
  const p=navigation();
  assert.equal(p.bar.open(redirect,{native:true}),false,'the caller performs the native top-level load');
  assert.deepEqual(p.calls,[],'no history-only route claims success');
  const framed=navigation({framed:'_101_1'});
  assert.equal(framed.bar.open(redirect,{native:true}),true,'own-course native loads ask the frame owner to preserve native work');
  assert.deepEqual(framed.calls,[['open',redirect]]);
  const shown=navigation({showing:'_101_1'});
  assert.equal(shown.bar.open(redirect,{native:true}),true);
  assert.deepEqual(shown.calls,[['open','_101_1',redirect]],'the selected course uses its guarded native loader');
  const other=navigation({framed:'_102_1',course:'_102_1'});
  assert.equal(other.bar.open(redirect,{native:true}),true);
  assert.deepEqual(other.calls,[['open',redirect]],'another course is opened by the frame owner');
});

test('Ultra never reads or replays even 100 remembered folders over a 2000-row outline', () => {
  for(const enabled of [false,true]) {
    let clicks=0,queries=0,reads=0;
    const rows=Array.from({length:2000},(_,i)=>({dataset:{contentId:`_${i+10}_1`}}));
    const ui=vm.runInNewContext(fs.readFileSync(require.resolve('../features/place.js'),'utf8'),{
      GZ_CTX:{site:'ultra',settings:()=>({enhance:{place:enabled}}),on:()=>true},
      document:{addEventListener(){},querySelectorAll(){queries++;return rows;}},
      chrome:{storage:{local:{get(){reads++;}}}},setTimeout(){throw Error('no restore timers');},clearTimeout(){},
      Set,Map,URLSearchParams
    });
    ui.sync();ui.stop();
    assert.deepEqual({clicks,queries,reads},{clicks:0,queries:0,reads:0});
    const scrollBack=vm.runInNewContext(part('  const scrollBack = ','  // ---- closing, pinning, moving')+'\nscrollBack;',{
      location:{pathname:'/ultra/courses/_101_1/outline'},ctx:{site:'ultra',settings:()=>({enhance:{place:enabled}})},
      pageScroller(){throw Error('outline scroll is native');}
    });
    scrollBack(90000);
  }
});

test('discussion body results follow the native content link after the list renders, and user input cancels', () => {
  const script=fs.readFileSync(require.resolve('../features/discussion-nav.js'),'utf8');
  function run({links=[],hidden=false,pathname='/ultra/courses/_101_1/engagement',storage={value:JSON.stringify({cid:'_101_1',title:'Discussion',at:1000})}}={}) {
    let now=1000;
    const calls=[],timers=new Map(),events=new Map();let serial=0;
    const d={documentElement:{hasAttribute:()=>hidden},querySelectorAll:()=>links,
      addEventListener:(type,f)=>events.set(type,f),removeEventListener:type=>events.delete(type)};
    const c={GZ_CTX:{site:'ultra',tabFrame:'_101_1',on:()=>true,settings:()=>({enhance:{search:true}})},document:d,
      location:{origin,pathname,assign:u=>calls.push(u)},
      sessionStorage:{getItem:()=>storage.value,removeItem:()=>storage.value=null},Date:{now:()=>now},URL,Set,
      setTimeout:f=>{timers.set(++serial,f);return serial;},clearTimeout:id=>timers.delete(id)};
    const ui=vm.runInNewContext(script,c);ui.sync();
    return {ui,calls,timers,events,consumed:()=>storage.value===null,advance:ms=>{now+=ms;for(const [id,f]of [...timers]){timers.delete(id);f();}}};
  }
  const a={textContent:'Discussion',href:origin+'/ultra/courses/_101_1/discussion/_900_1?view=discussions'};
  const p=run();assert.equal(p.consumed(),true);assert.equal(p.timers.size,1);
  p.advance(200);assert.deepEqual(p.calls,[]);
  p.events.get('keydown')({isTrusted:true});assert.equal(p.timers.size,0);assert.equal(p.events.size,0);
  const linked=run({links:[a,a]});assert.deepEqual(linked.calls,[a.href],'duplicate DOM copies of one native link are harmless');
  const ambiguous=run({links:[a,{...a,href:a.href.replace('_900_1','_901_1')}]});
  assert.deepEqual(ambiguous.calls,[],'ambiguous titles never select the wrong discussion');ambiguous.advance(15001);assert.equal(ambiguous.timers.size,0);
  const storage={value:JSON.stringify({cid:'_101_1',title:'Discussion',at:1000})};
  const leaving=run({storage,pathname:'/ultra/courses/_102_1/engagement'});
  assert.equal(leaving.consumed(),false,'the course list being left cannot steal another course’s selection');
  assert.equal(leaving.timers.size,0);assert.equal(leaving.events.size,0);
  const destination=run({storage,links:[a],pathname:'/ultra/courses/_101_1/engagement/'});
  assert.deepEqual(destination.calls,[a.href],'the destination consumes the selection, including a trailing slash');
  const hidden=run({links:[a],hidden:true});assert.equal(hidden.consumed(),false,'a hidden same-course document cannot consume another frame’s selection');
});

// Exercise the actual owner-side loader as well as the palette adapter: edited native pages must stay intact.
test('explicit navigation respects native edits and restarts the frame loading lifecycle when clean', () => {
  for (const dirty of [false,true]) {
    const calls=[], f={dirty}, frames=new Map([['_101_1',f]]);
    const bar=vm.runInNewContext(part('  const openAt = ','  // A page outside a course:')+'\n'+part('  const bar = {','  return { sync')+'\nbar;', {
      L,URL,Date,on:true,framed:'',showing:'_101_1',ctx:{site:'ultra',courseId:()=> '_102_1'},location:{origin},frames,
      tabs:[{cid:'_101_1',name:'Course'}],t:s=>s,labelFor:()=> 'Course',say:()=>calls.push('preserved'),
      stamp(){},save(){},reveal(){},load:(cid,frame,url)=>{calls.push(['load',cid,url]);return true;}
    });
    assert.equal(bar.open(redirect,{native:true}),true);
    assert.deepEqual(calls,dirty?['preserved']:[['load','_101_1',redirect]]);
  }
});

test('the shared palette content reader retains course-link identity under the API field projection', async () => {
  const ultra=fs.readFileSync(require.resolve('../content-ultra.js'),'utf8');
  const begin=ultra.indexOf('  const contents = new Map();');
  const end=ultra.indexOf('  // What they',begin);
  const item={id:'_999_1',title:'Linked discussion',contentHandler:{id:'resource/x-bb-courselink',isBbPage:false}};
  const reader=vm.runInNewContext(ultra.slice(begin,end)+'\ncourseItems;', {
    Map,Date,renderNew(){},covered:xs=>xs,reader:async()=>({list:async(path,fields)=>{
      const projected={id:item.id,title:item.title,contentHandler:{isBbPage:false}};
      if(fields.split(',').includes('contentHandler.id'))projected.contentHandler.id=item.contentHandler.id;
      return {items:[projected],complete:true};
    }})
  });
  const rows=await reader('_101_1').p;
  assert.equal(U.contentLink(rows[0],'_101_1',origin),null,'a course link with no canonical alternate never uses its outline id');
});
