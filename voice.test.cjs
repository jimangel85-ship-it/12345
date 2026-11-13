const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
// Test the browser adapter without capturing a real microphone or calling a recognition service.
function fixture({supported=true,secure=true,maxLength=5000}={}){
 class Element{
  constructor(tag='DIV'){this.tagName=tag;this.listeners={};this.children=[];this.dataset={};this.attrs={};this.value='';this.textContent='';this.isConnected=true;this.disabled=false;this.maxLength=-1}
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
  fire(k){for(const fn of this.listeners[k]||[])fn({target:this})}
  click(){if(!this.disabled)this.fire('click')}
  append(e){e.parent=this;this.children.push(e)}
  insertAdjacentElement(_,e){this.inserted=e}
  setAttribute(k,v){this.attrs[k]=v}
  remove(){this.isConnected=false;this.removed=true}
  focus(){this.focused=true}
  dispatchEvent(e){this.fire(e.type)}
  closest(s){return s==='label'?this.label:null}
  set innerHTML(_){this.parts={'.voice-status':new Element(),'textarea':new Element('TEXTAREA'),'select':new Element('SELECT')};this.parts.select.value='zh-TW';for(const a of ['start','stop','apply','cancel']){this.parts[`[data-action="${a}"]`]=new Element('BUTTON');this.parts[`[data-action="${a}"]`].disabled=['stop','apply'].includes(a)}}
  querySelector(s){return this.parts[s]}
 }
 const label=new Element('LABEL');label.childNodes=[{textContent:'工作內容 *'}];const input=new Element('TEXTAREA');input.label=label;input.maxLength=maxLength;
 const doc=new Element();doc.body=new Element();doc.createElement=t=>new Element(t.toUpperCase());doc.querySelectorAll=()=>[input];
 let recognition,count=0,observer,timer;
 class Recognition{constructor(){recognition=this;count++}start(){this.started=true;this.onstart?.()}stop(){this.stopped=true}abort(){this.aborted=true}result(final,interim){let results=final.map(text=>Object.assign([{transcript:text}],{isFinal:true}));if(interim)results.push(Object.assign([{transcript:interim}],{isFinal:false}));this.onresult?.({results})}end(){this.onend?.()}error(error){this.onerror?.({error})}}
 const win=new Element();win.isSecureContext=secure;if(supported)win.SpeechRecognition=Recognition;
 const context={window:win,document:doc,MutationObserver:class{constructor(fn){observer=fn}observe(){}},setTimeout:fn=>(timer=fn,1),clearTimeout:()=>{},Event:class{constructor(type){this.type=type}},toast:()=>{}};
 vm.runInNewContext(fs.readFileSync('voice.js','utf8'),context);
 const button=label.inserted.children[0];
 return {input,button,win,doc,get panel(){return label.inserted.children.at(-1)},get r(){return recognition},get count(){return count},observer:()=>observer(),timeout:()=>timer()};
}
test('dictation starts only after explicit consent; final text is reviewed and appended without auto-save',()=>{
 const f=fixture();f.input.value='原有紀錄';f.button.click();assert.equal(f.count,0);const p=f.panel;p.querySelector('[data-action="start"]').click();assert.equal(f.count,1);assert.equal(f.r.lang,'zh-TW');f.r.result(['完成拜訪'],'正在安排');assert.equal(f.input.value,'原有紀錄');assert.equal(p.querySelector('textarea').value,'完成拜訪');assert.equal(p.querySelector('[data-action="apply"]').disabled,true);f.r.stop();f.r.end();p.querySelector('textarea').value='完成客戶拜訪';p.querySelector('textarea').fire('input');p.querySelector('[data-action="apply"]').click();assert.equal(f.input.value,'原有紀錄\n完成客戶拜訪');assert.equal(p.removed,true);
});
test('interim results are not inserted and repeated results do not duplicate final text',()=>{
 const f=fixture();f.button.click();const p=f.panel;p.querySelector('[data-action="start"]').click();f.r.result([],'暫時文字');assert.equal(p.querySelector('textarea').value,'');f.r.result(['第一句']);f.r.result(['第一句','第二句']);f.r.result(['第一句','第二句']);f.r.end();assert.equal(p.querySelector('textarea').value,'第一句 第二句');
});
test('permission errors keep typed data, show recovery guidance, and stale end events cannot stop a retry',()=>{
 const f=fixture();f.input.value='手動內容';f.button.click();const p=f.panel;p.querySelector('[data-action="start"]').click();const old=f.r;old.error('not-allowed');assert.match(p.querySelector('.voice-status').textContent,/權限/);assert.equal(f.input.value,'手動內容');p.querySelector('[data-action="start"]').click();old.end();assert.equal(p.querySelector('[data-action="stop"]').disabled,false);f.r.result(['重試成功']);f.r.end();assert.equal(p.querySelector('textarea').value,'重試成功');
});
test('cancel and navigation abort capture; no result is written to a detached field',()=>{
 const f=fixture();f.button.click();const p=f.panel;p.querySelector('[data-action="start"]').click();f.r.result(['不儲存']);f.win.fire('hashchange');assert.equal(f.r.aborted,true);assert.equal(f.input.value,'');assert.equal(p.removed,true);
 const g=fixture();g.button.click();g.panel.querySelector('[data-action="start"]').click();g.input.isConnected=false;g.observer();assert.equal(g.r.aborted,true);
});
test('unsupported or insecure browsers fall back to typing without starting capture',()=>{for(const options of [{supported:false},{secure:false}]){const f=fixture(options);assert.equal(f.button.disabled,true);f.button.click();assert.equal(f.count,0)}});
test('length limits preserve existing text, and capture stops at the time limit',()=>{const f=fixture({maxLength:4});f.input.value='原文';f.button.click();const p=f.panel;p.querySelector('[data-action="start"]').click();f.r.result(['太長的內容']);f.timeout();assert.equal(f.r.stopped,true);f.r.end();p.querySelector('[data-action="apply"]').click();assert.equal(f.input.value,'原文');assert.match(p.querySelector('.voice-status').textContent,/限制/)});
