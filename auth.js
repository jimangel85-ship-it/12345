async function api(url,method='GET',data){
 let response;
 try{response=await fetch('/api'+url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(data?{body:JSON.stringify(data)}:{})})}catch{throw new Error('無法連線至伺服器，請確認服務仍在執行')}
 const result=await response.json();
 if(!response.ok){if(response.status===401&&currentUser){signedOut();loginView('登入已過期，請重新登入')}throw Object.assign(new Error(result.error||'操作失敗'),{status:response.status})}
 return result;
}
function signedOut(){authEpoch++;currentUser=null;users=[];csrf='';db={clients:[],deals:[],tasks:[],notes:[],journals:[]};search='';ownerFilter='';statusFilter='';taskFilter='all';journalFrom=journalTo=journalAuthor=journalSearch='';delete names.accounts;if($('#modal').open)$('#modal').close();$('.sidebar nav').innerHTML='';$('.mobile-nav').innerHTML='';$('#identity').textContent='';$('#main').innerHTML=''}
function loginView(message=''){
 document.body.classList.add('auth-mode');
 $('#main').innerHTML=`<section class="login-card"><div class="logo">同</div><p class="eyebrow">TONG BAN · TEAM CRM</p><h1>歡迎回到同伴</h1><p class="subtitle">登入你的工作帳號，接續團隊的每一步。</p><form id="login-form">${field('登入帳號','username','text','','required autocomplete="username" maxlength="50"')}${field('密碼','password','password','','required autocomplete="current-password" maxlength="256"')}<p class="form-error" role="alert">${esc(message)}</p><button class="primary full-width">登入工作台</button></form><small>主管提供帳號與初始密碼；首次登入需更換密碼。</small></section>`;
}
function passwordView(forced=false){
 const html=`<p class="subtitle">${forced?'首次登入，請先設定自己的密碼。':'密碼變更後，所有裝置將登出。'} 新密碼至少 12 字元。</p><form id="password-form">${field('目前密碼','current','password','','required autocomplete="current-password" maxlength="256"')}${field('新密碼','password','password','','required minlength="12" maxlength="256" autocomplete="new-password"')}${field('再次輸入新密碼','confirm','password','','required minlength="12" maxlength="256" autocomplete="new-password"')}<p class="form-error" role="alert"></p><button class="primary full-width">更新密碼並重新登入</button></form>`;
 if(forced){document.body.classList.add('auth-mode');$('#main').innerHTML=`<section class="login-card"><h1>設定登入密碼</h1><p>${esc(currentUser.name)} · ${esc(currentUser.username)}</p>${html}<button class="text-link" id="logout">返回登入</button></section>`}else modal('更改密碼',html);
}
async function refresh(renderPage=true){
 const epoch=authEpoch;const result=await api('/state');if(epoch!==authEpoch)return;
 const {user,users:directory,...records}=result;currentUser=user;users=directory;db=records;
 if(isManager())names.accounts='帳號管理';else delete names.accounts;
 $('#identity').textContent=`${user.name} · ${isManager()?'主管':'一般同事'}`;
 $('.sidebar-bottom').innerHTML=`<span class="avatar">${esc(user.name.slice(0,1))}</span><div>${esc(user.name)}<small>${isManager()?'全隊客戶與帳號管理':'我的客戶與指派待辦'}</small></div>`;
 document.body.classList.remove('auth-mode');if(renderPage)route();
}
function accounts(){return title('PEOPLE & PERMISSIONS','帳號管理','20 個獨立帳號。變更權限、停用或重設密碼後，該帳號需重新登入。')+`<div class="notice">主管可查看、編輯全隊資料並分派工作；一般同事可管理自己的客戶，並完成被指派的待辦。被指派待辦不會開放其他客戶的聯絡資料。初始帳密存於電腦的 private/initial-accounts.csv。</div><div class="toolbar"><button class="secondary" id="import-legacy">匯入本機舊版資料</button><button class="secondary" id="show-audit">查看最近操作</button></div><div class="users-list">${users.map(u=>`<article class="panel user-row"><div><b>${esc(u.name)}</b> <span class="tag ${u.active?'':'red'}">${u.active?'啟用':'已停用'}</span><small>${esc(u.username)} · ${u.role==='manager'?'主管':'一般同事'}${u.mustChange?' · 待首次改密碼':''}</small></div><button class="secondary" data-user="${u.username}">管理帳號</button></article>`).join('')}</div>`}
function editUser(username){const u=users.find(x=>x.username===username);modal('管理帳號 · '+u.username,`<form id="user-form" data-user="${u.username}">${field('顯示名稱','name','text',u.name,'required maxlength="40"')}<label class="field">權限<select name="role"><option value="manager" ${u.role==='manager'?'selected':''}>主管</option><option value="staff" ${u.role==='staff'?'selected':''}>一般同事</option></select></label><label class="field">帳號狀態<select name="active"><option value="true" ${u.active?'selected':''}>啟用</option><option value="false" ${u.active?'':'selected'}>停用</option></select></label><p class="form-error" role="alert"></p><button class="primary">儲存帳號設定</button></form>${u.username!==currentUser.username?`<hr><button class="secondary" data-reset-user="${u.username}">重設此帳號密碼</button><small>重設後，原密碼失效，並立即登出該帳號的所有裝置。</small>`:''}`)}
async function mutate(url,method,data){await api(url,method,data);await refresh();}
document.addEventListener('click',async e=>{
 const el=e.target.closest('[data-add],[data-detail],[data-edit],[data-user],[data-reset-user],#close,#export,#logout,#change-password,#refresh,#import-legacy,#confirm-import,#show-audit,#confirm-reset');if(!el)return;
 try{
  if(el.dataset.add)addForm(el.dataset.add);if(el.dataset.detail)detail(el.dataset.detail);if(el.dataset.edit)addForm('client',el.dataset.edit);if(el.id==='close')$('#modal').close();
  if(el.id==='logout'){await api('/logout','POST',{});signedOut();loginView()}
  if(el.id==='change-password')passwordView();
  if(el.id==='refresh'){await refresh();toast('已取得最新團隊資料')}
  if(el.dataset.user)editUser(el.dataset.user);
  if(el.dataset.resetUser){modal('確認重設密碼',`<p>將立即登出 ${esc(el.dataset.resetUser)} 的所有裝置，並產生新初始密碼。</p><button class="primary" id="confirm-reset" data-username="${el.dataset.resetUser}">確認重設</button>`)}
  if(el.id==='confirm-reset'){el.disabled=true;let r=await api('/users/'+el.dataset.username+'/reset','POST',{});await refresh();modal('新的初始密碼',`<p>帳號：${esc(el.dataset.username)}</p><p>請私下交給該位同事；此密碼只在這裡顯示一次。</p><output class="password-output">${esc(r.password)}</output><small>首次登入必須更換；原始帳號清單不會更新。</small>`)}
  if(el.id==='export'){const {users:directory,...data}=db;let blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`同伴CRM-${currentUser.username}-${today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出你有權查看的資料')}
  if(el.id==='import-legacy'){let legacy;try{legacy=JSON.parse(localStorage.getItem('tongban-crm-v1'))}catch{}if(!legacy){toast('此瀏覽器沒有舊版資料。請回到原先使用的網址與瀏覽器操作。');return}modal('匯入舊版資料',`<p>將匯入此瀏覽器的 ${Array.isArray(legacy.clients)?legacy.clients.length:0} 位客戶與相關紀錄。舊版資料會保留。</p><p>負責人對應：「我」→目前主管、「小安」→staff01、「佳穎」→staff02。其他名稱歸目前主管。僅可在伺服器尚無客戶資料時匯入一次。</p><button class="primary" id="confirm-import">確認匯入</button>`)}
  if(el.id==='confirm-import'){el.disabled=true;await mutate('/import','POST',JSON.parse(localStorage.getItem('tongban-crm-v1')));$('#modal').close();toast('舊版資料已匯入團隊資料庫')}
  if(el.id==='show-audit'){const rows=await api('/audit');modal('最近 100 筆操作',`<div class="audit-list">${rows.map(r=>`<div class="note"><b>${esc(userLabel(r.actor))}</b> · ${esc(r.action)}<small>${esc(r.time)} · ${esc(r.target)}</small></div>`).join('')||'尚無紀錄'}</div>`)}
 }catch(err){toast(err.message);if(el.isConnected)el.disabled=false}
});
document.addEventListener('input',e=>{if(e.target.id==='search'){search=e.target.value.trim();$('#client-list').innerHTML=clientCards()}});
document.addEventListener('change',async e=>{
 const el=e.target;
 try{
  if(el.dataset.check){el.disabled=true;const t=db.tasks.find(x=>x.id===el.dataset.check);await mutate('/tasks/'+t.id,'PATCH',{done:el.checked,version:t.version})}
  if(el.dataset.stage){el.disabled=true;const d=db.deals.find(x=>x.id===el.dataset.stage);await mutate('/deals/'+d.id,'PATCH',{stage:el.value,version:d.version});toast('商機階段已更新')}
  if(el.id==='owner-filter'){ownerFilter=el.value;render()}if(el.id==='status-filter'){statusFilter=el.value;render()}if(el.id==='task-filter'){taskFilter=el.value;render()}
 }catch(err){toast(err.message);if(currentUser&&!currentUser.mustChange)await refresh().catch(()=>{});}
});
document.addEventListener('submit',async e=>{
 const form=e.target;if(!['login-form','password-form','record-form','note-form','user-form'].includes(form.id))return;
 e.preventDefault();if(!form.reportValidity())return;let data=Object.fromEntries(new FormData(form));const btn=form.querySelector('button[type="submit"],button.primary');btn.disabled=true;
 const error=form.querySelector('.form-error');if(error)error.textContent='';
 try{
  if(form.id==='login-form'){let r=await api('/login','POST',data);authEpoch++;currentUser=r.user;csrf=r.csrf;if(currentUser.mustChange)passwordView(true);else await refresh()}
  if(form.id==='password-form'){if(data.password!==data.confirm)throw Error('兩次輸入的新密碼不一致');await api('/password','POST',{current:data.current,password:data.password});signedOut();loginView('密碼已更新，請以新密碼登入。')}
  if(form.id==='record-form'){let k={client:'clients',deal:'deals',task:'tasks'}[form.dataset.type],id=form.dataset.id;if(id)data.version=db[k].find(x=>x.id===id).version;await mutate('/'+k+(id?'/'+id:''),id?'PATCH':'POST',data);$('#modal').close();toast('資料已儲存至團隊資料庫')}
  if(form.id==='note-form'){let id=form.dataset.client;await mutate('/notes','POST',{client:id,text:data.text});detail(id);toast('已記錄實際登入者與聯繫內容')}
  if(form.id==='user-form'){await api('/users/'+form.dataset.user,'POST',{...data,active:data.active==='true'});if(form.dataset.user===currentUser.username){signedOut();loginView('帳號已更新，請重新登入。')}else{await refresh();$('#modal').close();toast('帳號已更新')}}
 }catch(err){if(form.isConnected&&error)error.textContent=err.message;else toast(err.message);if(err.status===409&&currentUser){await refresh().catch(()=>{});if($('#modal').open)$('#modal').close()}}
 finally{if(btn.isConnected)btn.disabled=false}
});
window.addEventListener('hashchange',route);
async function boot(){try{let r=await api('/me');currentUser=r.user;csrf=r.csrf;if(currentUser.mustChange)passwordView(true);else await refresh()}catch(err){signedOut();loginView(err.status===401?'':err.message)}}
setInterval(()=>{if(currentUser&&!currentUser.mustChange&&!$('#modal').open)refresh().catch(()=>{})},30000);
boot();
