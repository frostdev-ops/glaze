// Appearance and an explicit, local equation composer. Native answers stay visible and usable throughout.
var GZ_PEARSON_MATH = globalThis.GZ_PEARSON_MATH || (() => {
  const doc = globalThis.__gzPearsonMathDoc ||= crypto.randomUUID();
  const ownOrigin = new URL(chrome.runtime.getURL('')).origin;
  const rendered = new Map(), buttons = new Map();
  const words = ['Equation editor','Pearson input','Use equation','Mathematical symbols','Mathematical expression','Fraction','Power','Square root','Nth root','Absolute value','Union','Intersection','Infinity','Pi',
    'Finish the expression or use Pearson input.','Pearson cannot import this expression.','The Pearson answer changed. Reopen the equation editor.','Pearson could not use this expression.'];
  const t = (key) => GZ_I18N.t(key,{},GZ_I18N.ui());
  let enabled = false, running = false, again = false, timer = 0, generation = 0, opening = 0, library = null, composer = null, fonts = [];
  const request = (value) => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if(!done){done=true;clearTimeout(timeout);resolve(v || {error:'unavailable'});} };
    const timeout = setTimeout(()=>finish({error:'unavailable'}),10000);
    try { chrome.runtime.sendMessage({type:'glaze:pearson-math',doc,deadline:Date.now()+9000,...value},(r)=>{
      if(done&&value.op==='open'&&r?.token)request({op:'close',token:r.token});
      finish(chrome.runtime.lastError?{error:'unavailable'}:r);
    }); }
    catch { finish({error:'unavailable'}); }
  });
  const appearance = () => {
    const s = getComputedStyle(document.documentElement), vars = {};
    for (const key of s) if (/^--gz-[\w-]+$/.test(key)) { const v=s.getPropertyValue(key).trim();if(v.length<1000&&!/url\s*\(/i.test(v))vars[key]=v; }
    return {type:'theme',vars,fonts,lang:GZ_I18N.ui(),calm:document.documentElement.getAttribute('data-gz-motion')==='off'||document.documentElement.hasAttribute('data-gz-no-trans')};
  };
  const restore = (element, record) => {
    if(record.original.style.getPropertyValue('display')==='none'&&!record.original.style.getPropertyPriority('display')){
      if(record.before)record.original.style.setProperty('display',...record.before);else record.original.style.removeProperty('display');
    }
    record.node.remove();element.removeAttribute('data-gz-modern-math');
  };
  const close = () => {
    opening++;
    const c=composer;if(!c)return;composer=null;c.closed=true;clearTimeout(c.timeout);c.port?.close();c.host.remove();
    c.button.disabled=false;c.button.removeAttribute('aria-expanded');
    request({op:'close',token:c.token});
  };
  const clearView = () => {
    close();for(const [el,r]of rendered)restore(el,r);rendered.clear();for(const b of buttons.values())b.remove();buttons.clear();
  };
  const open = async (element,button) => {
    if(!enabled||composer?.busy)return;
    close();button.disabled=true;const at=generation,order=++opening;
    const r=await request({op:'open',id:element.id});
    if(!enabled||at!==generation||order!==opening||!element.isConnected||r.error){button.disabled=false;if(r.token)request({op:'close',token:r.token});return;}
    const host=document.createElement('div');host.className='gz-pearson-math-composer';
    const frame=document.createElement('iframe');frame.title=t('Equation editor');frame.referrerPolicy='origin';frame.src=chrome.runtime.getURL('pearson-math.html');
    host.append(frame);const holder=element.closest('.contentHolder')||element.parentElement;holder.append(host);
    const c=composer={host,frame,button,element,token:r.token,latex:r.latex,closed:false,busy:false,ready:false,port:null,timeout:0};
    frame.addEventListener('error',()=>{if(composer===c)close();});
    button.disabled=false;button.setAttribute('aria-expanded','true');
    c.timeout=setTimeout(()=>{if(composer===c&&!c.ready)close();},10000);
  };
  addEventListener('message',(event)=>{
    const c=composer;
    if(!enabled||!c||event.source!==c.frame.contentWindow||event.origin!==ownOrigin||event.data?.gzPearsonMathReady!==true)return;
    if(c.port){close();return;} // A reloaded frame must reopen against a fresh native answer snapshot.
    const channel=new MessageChannel();c.port=channel.port1;
    c.port.onmessageerror=()=>{if(composer===c)close();};
    c.port.onmessage=async(e)=>{
      if(composer!==c||c.closed||!enabled)return;
      const m=e.data || {};
      if(m.type==='ready'){c.ready=true;clearTimeout(c.timeout);return;}
      if(m.type==='size'&&Number.isFinite(m.height)){c.frame.style.height=`${Math.max(180,Math.min(700,m.height))}px`;return;}
      if(m.type==='close'&&!c.busy){close();(c.element.querySelector('.focusNode')||c.button).focus();return;}
      if(m.type==='done'&&c.busy){close();c.element.querySelector('.focusNode')?.focus();return;}
      if(m.type==='prepare'&&!c.busy&&Number.isSafeInteger(m.revision)&&m.revision>=0&&typeof m.latex==='string'&&m.latex.length<=8192){
        const r=await request({op:'prepare',token:c.token,latex:m.latex});
        if(composer===c&&!c.closed)c.port.postMessage({type:'prepared',revision:m.revision,...r});return;
      }
      if(m.type==='apply'&&!c.busy&&typeof m.stage==='string'&&m.stage.length===36){
        c.busy=true;const r=await request({op:'apply',token:c.token,stage:m.stage});
        if(composer===c&&!c.closed){if(r.error)c.busy=false;c.port.postMessage({type:'applied',...r});}
      }
    };
    c.port.start();c.frame.contentWindow.postMessage({...appearance(),type:'glaze:pearson-math:init',words:Object.fromEntries(words.map(k=>[k,t(k)])),latex:c.latex},ownOrigin,[channel.port2]);
  });
  const refresh = async () => {
    clearTimeout(timer);if(!enabled)return;if(running){again=true;return;}
    running=true;const at=generation;
    try {
      const r=await request({op:'scan'});if(!enabled||at!==generation)return;if(r.error){clearView();return;}
      library ||= import(chrome.runtime.getURL('pearson/render.mjs'));
      const lib=await library;if(!enabled||at!==generation)return;
      const keep=new Set();
      for(const item of r.labels || []) {
        const element=document.getElementById(item.id),original=element?.querySelector('.eqDocument');if(!original)continue;
        keep.add(element);const old=rendered.get(element);
        if(old?.latex===item.latex&&old.original===original&&old.node.isConnected&&original.style.getPropertyValue('display')==='none'&&!original.style.getPropertyPriority('display'))continue;
        if(old){restore(element,old);rendered.delete(element);}
        if(getComputedStyle(original).display==='none')continue;
        const content=lib.render(item.latex);if(!content)continue;
        const node=document.createElement('span');node.className='gz-pearson-render';node.setAttribute('role','math');node.setAttribute('aria-label',item.latex);node.append(content);element.append(node);
        const before=original.style.getPropertyValue('display')?[original.style.getPropertyValue('display'),original.style.getPropertyPriority('display')]:null;
        const record={latex:item.latex,original,node,before};original.style.setProperty('display','none');
        if(getComputedStyle(original).display!=='none'){restore(element,record);continue;}
        element.setAttribute('data-gz-modern-math','');rendered.set(element,record);
      }
      for(const [element,r]of rendered)if(!keep.has(element)||!element.isConnected){restore(element,r);rendered.delete(element);}
      const inputs=new Set();
      for(const item of r.inputs || []) {
        const element=document.getElementById(item.id);if(!element)continue;inputs.add(element);
        if(buttons.get(element)?.isConnected)continue;
        const button=document.createElement('button');button.type='button';button.className='gz-pearson-math-edit';button.textContent=t('Equation editor');
        button.addEventListener('click',()=>open(element,button));element.after(button);buttons.set(element,button);
      }
      for(const [element,button]of buttons)if(!inputs.has(element)||!element.isConnected){button.remove();buttons.delete(element);if(composer?.element===element)close();}
      if(composer&&(!composer.element.isConnected||!composer.host.isConnected||!composer.frame.isConnected))close();
    } catch { library=null;clearView(); /* unsupported renderer or native widget retains its original presentation */ }
    finally { running=false;if(again){again=false;schedule();} }
  };
  const schedule = () => {clearTimeout(timer);if(enabled)timer=setTimeout(refresh,100);};
  const observer=new MutationObserver((records)=>{
    if(enabled&&composer&&(!composer.host.isConnected||!composer.frame.isConnected)){schedule();return;}
    if(enabled&&records.some(r=>{
      const target=r.target.nodeType===1?r.target:r.target.parentElement;
      if(target?.closest('.gz-pearson-render,.gz-pearson-math-composer,.gz-pearson-math-edit'))return false;
      if(r.type==='attributes')return true;
      const nodes=[...r.addedNodes,...r.removedNodes];
      if(nodes.length&&nodes.every(n=>n.nodeType===1&&n.matches?.('.gz-pearson-render,.gz-pearson-math-composer,.gz-pearson-math-edit')))return false;
      if(target?.closest('.eqLabel')&&!target.closest('.inputField'))return true;
      return nodes.some(n=>n.nodeType===1);
    }))schedule();
  });
  const update = (on,look) => {
    if(look)fonts=[look.font,look.head==='auto'?look.font:look.head];
    for(const button of buttons.values())button.textContent=t('Equation editor');
    if(enabled===on){if(on&&composer?.port)composer.port.postMessage(appearance());return;}
    generation++;enabled=on;document.documentElement.toggleAttribute('data-gz-pearson-math',on);
    if(on){observer.observe(document.documentElement,{childList:true,characterData:true,attributes:true,attributeFilter:['class','id','disabled','readonly','aria-disabled'],subtree:true});schedule();}
    else {observer.disconnect();clearTimeout(timer);clearView();}
  };
  addEventListener('pagehide',()=>update(false));
  return {update};
})();
