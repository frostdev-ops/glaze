import { MathfieldElement } from '../vendor/mathlive/mathlive.mjs';
import { render, signature } from './render.mjs';

// No storage, worker or LMS authority. Only the user's optional appearance fonts may load externally.
// The editor's one channel belongs to its exact Pearson parent; MathLive and its math fonts are packaged.
let origin;
try { origin = new URL(document.referrer).origin; } catch { /* direct opens stay empty */ }
if (origin === 'https://tdx.acs.pearson.com' && parent !== window) {
  MathfieldElement.fontsDirectory = new URL('../vendor/mathlive/fonts', import.meta.url).href;
  MathfieldElement.soundsDirectory = null;
  MathfieldElement.computeEngine = null;
  const $ = (id) => document.getElementById(id);
  let port = null, mf = null, words = {}, revision = 0, stage = null, timer = 0, busy = false, stopped = false, compatible = false;
  const text = (key) => words[key] || key;
  const status = (key = '', error = false) => { $('status').textContent = key ? text(key) : ''; $('status').toggleAttribute('data-error', error); };
  const send = (m) => { if (!stopped) port?.postMessage(m); };
  const theme = (m) => {
    for (const [key,value] of Object.entries(m.vars || {})) if (/^--gz-[\w-]+$/.test(key) && typeof value === 'string' && value.length < 1000 && !/url\s*\(/i.test(value)) document.documentElement.style.setProperty(key,value);
    document.documentElement.toggleAttribute('data-calm',m.calm === true);
    document.documentElement.lang = typeof m.lang === 'string' ? m.lang.slice(0,20) : 'en';
    for(const font of (Array.isArray(m.fonts)?m.fonts:[]).slice(0,2))if(typeof font==='string')GZ_FONTS.load(font);
  };
  const validate = () => {
    clearTimeout(timer); revision++; stage = null; $('apply').disabled = true;
    if (!compatible) { status('Pearson cannot import this expression.',true); return; }
    const latex = GZ_PEARSON_NOTATION.prepare(mf.getValue('latex'));
    if (latex === null || signature(latex) === null) { status('Finish the expression or use Pearson input.',true); return; }
    status();
    const at = revision;
    timer = setTimeout(() => { if (at === revision) send({type:'prepare',revision:at,latex}); },120);
  };
  const close = () => { if (!busy) send({type:'close'}); };
  const receive = (m) => {
    if (m.type === 'theme') { theme(m); return; }
    if (m.type === 'prepared' && m.revision === revision && !busy) {
      const latex = GZ_PEARSON_NOTATION.prepare(mf.getValue('latex'));
      const expected = latex === null ? null : signature(latex), actual = signature(m.latex);
      if (m.error || expected === null || actual === null || expected !== actual || typeof m.stage !== 'string' || m.stage.length !== 36) {
        stage=null;$('apply').disabled=true;status('Pearson cannot import this expression.',true);return;
      }
      stage={id:m.stage,source:expected}; $('apply').disabled=false; status();
    }
    if (m.type === 'applied') {
      busy=false;mf.readOnly=false;
      if (m.error) { stage=null;status(m.error==='changed'?'The Pearson answer changed. Reopen the equation editor.':'Pearson could not use this expression.',true);$('cancel').disabled=false; }
      else send({type:'done'});
    }
  };
  addEventListener('message',(e)=>{
    if (port || e.source!==parent || e.origin!==origin || e.data?.type!=='glaze:pearson-math:init' || e.ports.length!==1) return;
    port=e.ports[0];port.onmessage=(event)=>receive(event.data || {});port.start();
    words=e.data.words || {};theme(e.data);
    $('title').textContent=text('Equation editor');$('cancel').textContent=text('Pearson input');$('apply').textContent=text('Use equation');
    $('symbols').setAttribute('aria-label',text('Mathematical symbols'));
    mf=new MathfieldElement();mf.mathVirtualKeyboardPolicy='manual';mf.smartFence=true;
    mf.setAttribute('aria-label',text('Mathematical expression'));mf.setAttribute('writingsuggestions','false');
    $('field').append(mf);$('editor').hidden=false;mf.menuItems=[];
    // Check the opening conversion too: a native expression may contain notation MathLive silently omits.
    const initial=GZ_PEARSON_NOTATION.prepare(e.data.latex), initialSignature=initial===null?null:signature(initial);
    if(initialSignature!==null){
      try{mf.setValue(initial,{silenceNotifications:true});compatible=signature(mf.getValue('latex'))===initialSignature;}catch{compatible=false;}
    }
    mf.readOnly=!compatible;
    const templates=[
      ['Fraction',String.raw`\frac{\placeholder{}}{\placeholder{}}`,String.raw`\frac{a}{b}`],
      ['Power',String.raw`^{\placeholder{}}`,String.raw`x^n`],
      ['Square root',String.raw`\sqrt{\placeholder{}}`,String.raw`\sqrt{x}`],
      ['Nth root',String.raw`\sqrt[\placeholder{}]{\placeholder{}}`,String.raw`\sqrt[n]{x}`],
      ['Absolute value',String.raw`\left|\placeholder{}\right|`,String.raw`|x|`],
      ['Union',String.raw`\cup`,String.raw`\cup`],['Intersection',String.raw`\cap`,String.raw`\cap`],
      ['Infinity',String.raw`\infty`,String.raw`\infty`],['Pi',String.raw`\pi`,String.raw`\pi`]
    ];
    for (const [name,latex,art] of templates) {
      const b=document.createElement('button');b.type='button';b.title=text(name);b.setAttribute('aria-label',text(name));
      const artwork=render(art);if(artwork)b.append(artwork);else b.textContent=text(name);
      b.disabled=!compatible;b.addEventListener('pointerdown',event=>event.preventDefault());
      b.addEventListener('click',()=>{if(!busy&&compatible){mf.focus();mf.insert(latex,{selectionMode:'placeholder'});validate();}});$('symbols').append(b);
    }
    mf.addEventListener('input',validate);$('cancel').addEventListener('click',close);
    mf.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
    $('apply').addEventListener('click',()=>{
      if(!stage||busy)return;
      const current=GZ_PEARSON_NOTATION.prepare(mf.getValue('latex'));
      if(current===null||signature(current)!==stage.source){validate();return;}
      busy=true;clearTimeout(timer);$('apply').disabled=true;$('cancel').disabled=true;mf.readOnly=true;
      send({type:'apply',stage:stage.id});
    });
    const size=new ResizeObserver(()=>send({type:'size',height:Math.ceil(document.body.getBoundingClientRect().height)}));size.observe(document.body);
    addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);size.disconnect();port?.close();},{once:true});
    send({type:'ready'});validate();mf.focus();
  });
  parent.postMessage({gzPearsonMathReady:true},origin);
}
