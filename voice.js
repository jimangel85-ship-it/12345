// Dictation is opt-in, browser-provided, and always reviewed before insertion.
(() => {
 const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
 let active=null;
 function cancel(){if(!active)return;const a=active;active=null;clearTimeout(a.timer);if(a.recognition){a.recognition.onresult=a.recognition.onend=a.recognition.onerror=a.recognition.onstart=null;try{a.recognition.abort()}catch{}}a.panel.remove();a.button.disabled=false;a.button.setAttribute('aria-expanded','false')}
 function enhance(){
  if(active&&(!active.input.isConnected||(active.input.closest('dialog')&&!active.input.closest('dialog').open)))cancel();
  document.querySelectorAll('#record-form input[type="text"],#record-form input[type="tel"],#note-form textarea,#journal-form input[type="text"],#journal-form textarea,#announcement-form input[type="text"],#announcement-form textarea,#announcement-comment-form textarea').forEach(input=>{
   if(input.dataset.voiceReady||input.closest('.voice-panel'))return;input.dataset.voiceReady='1';
   const label=input.closest('label'),name=label.childNodes[0].textContent.trim();const button=document.createElement('button');button.type='button';button.className='voice-button';button.textContent='◉ 語音輸入';button.setAttribute('aria-label','語音輸入：'+name);button.setAttribute('aria-expanded','false');
   const wrap=document.createElement('div');wrap.className='voice-entry';label.insertAdjacentElement('afterend',wrap);wrap.append(button);
   if(!Recognition||!window.isSecureContext){button.disabled=true;const hint=document.createElement('small');hint.textContent=!Recognition?'此瀏覽器未提供語音辨識，請打字或使用手機鍵盤的麥克風。':'語音需使用 HTTPS 或本機 localhost；目前可用鍵盤輸入。';wrap.append(hint);return}
   button.addEventListener('click',()=>open(input,button,wrap));
  });
 }
 function open(input,button,wrap){
  cancel();const panel=document.createElement('section');panel.className='voice-panel';panel.setAttribute('aria-label','語音輸入面板');
  panel.innerHTML='<p>語音轉文字 · 國語（台灣）</p><small>按下「開始收音」後才會使用麥克風。瀏覽器可能將語音交由其辨識服務處理；本系統不儲存音檔。文字會先顯示在此，確認後才填入欄位。</small><label class="voice-language">辨識語言<select><option value="zh-TW">國語（台灣）</option><option value="en-US">English</option></select></label><div class="voice-status" role="status" aria-live="polite">準備好後，請開始收音。</div><label class="voice-review">辨識文字（可修改）<textarea placeholder="辨識結果會顯示在這裡…" maxlength="6000"></textarea></label><div class="voice-actions"><button type="button" data-action="start" class="secondary">開始收音</button><button type="button" data-action="stop" class="secondary" disabled>停止收音</button><button type="button" data-action="apply" class="primary" disabled>填入欄位</button><button type="button" data-action="cancel" class="text-link">取消</button></div>';
  wrap.append(panel);button.disabled=true;button.setAttribute('aria-expanded','true');
  const a={input,button,panel,recognition:null,timer:null,finals:new Map(),listening:false};active=a;
  const status=panel.querySelector('.voice-status'),review=panel.querySelector('textarea'),language=panel.querySelector('select'),start=panel.querySelector('[data-action="start"]'),stop=panel.querySelector('[data-action="stop"]'),apply=panel.querySelector('[data-action="apply"]');
  const availability=()=>{apply.disabled=a.listening||!review.value.trim();};review.addEventListener('input',availability);
  start.addEventListener('click',()=>{
   if(active!==a)return;a.finals.clear();let prefix=review.value.trim();a.listening=true;start.disabled=true;stop.disabled=false;apply.disabled=true;language.disabled=true;review.readOnly=true;
   let r;try{r=new Recognition()}catch{a.listening=false;start.disabled=false;stop.disabled=true;language.disabled=false;review.readOnly=false;status.textContent='此瀏覽器無法啟動語音辨識，請改用鍵盤輸入。';availability();return}a.recognition=r;r.lang=language.value;r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
   const finish=()=>{if(active!==a||a.recognition!==r)return;clearTimeout(a.timer);a.listening=false;start.disabled=false;stop.disabled=true;language.disabled=false;review.readOnly=false;availability()};
   r.onstart=()=>{if(active===a)status.textContent='正在收音…說完請按「停止收音」。'};
   r.onresult=e=>{if(active!==a||a.recognition!==r)return;let interim=[];for(let i=0;i<e.results.length;i++){const result=e.results[i];if(result.isFinal)a.finals.set(i,result[0].transcript);else interim.push(result[0].transcript)}review.value=[prefix,...[...a.finals.entries()].sort((x,y)=>x[0]-y[0]).map(x=>x[1])].filter(Boolean).join(' ');status.textContent=interim.length?'辨識中：'+interim.join(' '):'已辨識，繼續說話或停止收音。'};
   r.onerror=e=>{if(active!==a||a.recognition!==r)return;const errors={'not-allowed':'麥克風權限未開啟，請由你允許此網站使用麥克風後重試。','service-not-allowed':'瀏覽器未允許語音辨識服務，請改用鍵盤輸入。','audio-capture':'找不到可用的麥克風，請檢查裝置。','network':'語音辨識服務無法連線，請稍後再試或打字。','no-speech':'未聽到語音，請靠近麥克風再試一次。','language-not-supported':'此裝置未支援所選語言，請切換語言或打字。','aborted':'已停止收音。'};status.textContent=errors[e.error]||'語音辨識失敗，已辨識文字仍可修改或填入。';a.error=true;finish()};
   r.onend=()=>{if(active!==a||a.recognition!==r)return;finish();if(!a.error)status.textContent=review.value.trim()?'收音已結束，請檢查文字後按「填入欄位」。':'沒有辨識到文字，可重試或直接打字。';a.recognition=null};
   a.error=false;status.textContent='正在啟動麥克風…';try{r.start();a.timer=setTimeout(()=>{if(active===a&&a.listening){status.textContent='已達單次 60 秒上限，正在結束收音…';r.stop()}},60000)}catch{a.error=true;status.textContent='此瀏覽器無法啟動語音辨識，請改用鍵盤輸入。';finish()}
  });
  stop.addEventListener('click',()=>{if(a.recognition&&a.listening){stop.disabled=true;status.textContent='正在結束收音，等待最後辨識結果…';try{a.recognition.stop()}catch{cancel()}}});
  apply.addEventListener('click',()=>{if(active!==a||a.listening||!input.isConnected)return;const transcript=review.value.trim(),separator=input.tagName==='TEXTAREA'?'\n':' ',next=input.value+(input.value?separator:'')+transcript;
   if(input.maxLength>0&&next.length>input.maxLength){status.textContent=`超過此欄位 ${input.maxLength} 字的限制，請先縮短辨識文字。`;return}
   input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));cancel();input.focus();toast('語音文字已填入，請確認後再儲存資料');
  });
  panel.querySelector('[data-action="cancel"]').addEventListener('click',cancel);
 }
 new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
 document.addEventListener('submit',cancel,true);window.addEventListener('hashchange',cancel);window.addEventListener('pagehide',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});
 enhance();
})();
