const {test,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const dataDir=path.join(__dirname,'private','test-'+crypto.randomUUID());
process.env.CRM_DATA_DIR=dataDir;process.env.PORT='4188';process.env.APP_ORIGIN='http://localhost:4188';
const {server,sql}=require('./api-server.cjs');
let actualPort;const ready=new Promise(r=>server.listen(0,'127.0.0.1',()=>{actualPort=server.address().port;r()}));
after(async()=>{await new Promise(r=>server.close(r));sql.close()});
const accounts=fs.readFileSync(path.join(dataDir,'initial-accounts.csv'),'utf8').trim().split(/\r?\n/).slice(1).map(line=>{const [username,name,role,password]=line.split(',');return {username,name,role,password}});
async function call(url,method='GET',data,session={},extra={}){
 await ready;return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:actualPort,path:'/api'+url,method,headers:{Host:'localhost:4188',Origin:'http://localhost:4188','Content-Type':'application/json',...(session.cookie?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),...extra}},res=>{let chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}))});req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data))})
}
async function login(a,p=a.password){let r=await call('/login','POST',{username:a.username,password:p});assert.equal(r.status,200);assert.match(r.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);return {cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.csrf,user:r.body.user}}
async function activate(a){let s=await login(a),p=crypto.randomBytes(18).toString('hex');assert.equal((await call('/state','GET',undefined,s)).status,403);assert.equal((await call('/password','POST',{current:a.password,password:p},s)).status,200);assert.equal((await call('/me','GET',undefined,s)).status,401);return login(a,p)}
let manager,staff1,staff2,customer,deal,task;
test('20 unique accounts, salted password hashes, no plaintext in database',()=>{assert.equal(accounts.length,20);assert.equal(new Set(accounts.map(a=>a.password)).size,20);assert.equal(accounts.filter(a=>a.role==='主管').length,1);const rows=sql.prepare('SELECT * FROM users').all();assert.equal(new Set(rows.map(r=>r.salt)).size,20);for(let i=0;i<20;i++){assert.notEqual(rows[i].hash,accounts[i].password);assert.equal(rows[i].must_change,1)}});
test('unauthenticated access, wrong password and cross-origin requests are rejected',async()=>{assert.equal((await call('/state')).status,401);assert.equal((await call('/login','POST',{username:'manager01',password:'wrong'})).status,401);assert.equal((await call('/login','POST',{username:'manager01',password:'wrong'},{},{Origin:'https://evil.example'})).status,403)});
test('first login requires password change; session rotates and old session stops working',async()=>{manager=await activate(accounts[0]);staff1=await activate(accounts[1]);staff2=await activate(accounts[2]);assert.equal((await call('/state','GET',undefined,manager)).body.users.length,20)});
test('CSRF, account escalation and audit access are enforced on server',async()=>{assert.equal((await call('/clients','POST',{},manager,{'X-CSRF-Token':''})).status,403);assert.equal((await call('/users/staff01','POST',{name:'evil',role:'manager',active:true},staff1)).status,403);assert.equal((await call('/audit','GET',undefined,staff1)).status,403);assert.equal((await call('/users/manager01','POST',{name:'主管',role:'staff',active:true},manager)).status,400)});
test('staff cannot reset passwords, disable accounts or change another user role',async()=>{
 for(const [url,data] of [
  ['/users/staff02/reset',{}],
  ['/users/staff02',{name:'同事02',role:'staff',active:false}],
  ['/users/staff02',{name:'同事02',role:'manager',active:true}],
  ['/users/manager01/reset',{}]
 ])assert.equal((await call(url,'POST',data,staff1)).status,403);
 assert.equal((await call('/state','GET',undefined,staff2)).status,200);
 assert.equal((await call('/me','GET',undefined,staff2)).body.user.role,'staff');
});
test('legacy import is manager-only, atomic, one-time and maps former team members',async()=>{
 const old={clients:[{id:'legacy',name:'舊客戶',contact:'舊聯絡人',owner:'小安',status:'跟進中'}],deals:[],tasks:[],notes:[]};
 assert.equal((await call('/import','POST',old,staff1)).status,403);
 assert.equal((await call('/import','POST',{...old,notes:[{id:'bad',client:'missing',text:'錯誤關聯'}]},manager)).status,400);
 assert.equal((await call('/state','GET',undefined,manager)).body.clients.length,0);
 assert.equal((await call('/import','POST',old,manager)).status,200);
 assert.equal((await call('/state','GET',undefined,staff1)).body.clients[0].owner,'staff01');
 assert.equal((await call('/import','POST',old,manager)).status,409);
 // Remove only the isolated fixture to keep later test counts meaningful.
 sql.prepare("DELETE FROM records WHERE id='legacy'").run();
});
test('manager can assign a client; another colleague cannot read or modify it',async()=>{let r=await call('/clients','POST',{name:'隔離測試客戶',contact:'測試',owner:'staff01',status:'新客戶'},manager);assert.equal(r.status,201);customer=r.body;assert.equal((await call('/state','GET',undefined,staff1)).body.clients.length,1);assert.equal((await call('/state','GET',undefined,staff2)).body.clients.length,0);assert.equal((await call('/clients/'+customer.id,'PATCH',{name:'越權',version:1},staff2)).status,403);assert.equal((await call('/clients/'+customer.id,'PATCH',{owner:'staff02',version:1},staff1)).status,403)});
test('staff can update own records, versions prevent overwrites, notes identify the real author',async()=>{let r=await call('/deals','POST',{client:customer.id,title:'合作案',amount:60000,stage:'需求確認'},staff1);assert.equal(r.status,201);deal=r.body;assert.equal((await call('/deals/'+deal.id,'PATCH',{stage:'報價提案',version:1},staff1)).status,200);assert.equal((await call('/deals/'+deal.id,'PATCH',{stage:'已成交',version:1},staff1)).status,409);assert.equal((await call('/deals','POST',{client:customer.id,title:'越權',amount:1,stage:'初步接洽'},staff2)).status,403);r=await call('/notes','POST',{client:customer.id,text:'聯繫記錄',author:'manager01'},staff1);assert.equal(r.body.author,'staff01');assert.equal((await call('/state','GET',undefined,staff2)).body.notes.length,0)});
test('assigned tasks can be completed without exposing customer data',async()=>{let r=await call('/tasks','POST',{client:customer.id,title:'交接工作',owner:'staff02',due:'2026-11-16'},manager);assert.equal(r.status,201);task=r.body;let state=(await call('/state','GET',undefined,staff2)).body;assert.equal(state.tasks.length,1);assert.equal(state.clients.length,0);assert.equal(state.deals.length,0);assert.equal(state.notes.length,0);assert.equal((await call('/tasks/'+task.id,'PATCH',{done:true,version:1},staff2)).status,200);assert.equal((await call('/tasks/'+task.id,'PATCH',{title:'不應修改',version:2},staff2)).status,403);assert.equal((await call('/tasks','POST',{client:customer.id,title:'轉派',owner:'staff02',due:'2026-11-16'},staff1)).status,403)});
test('invalid values and attempts to create privileged fields are rejected or ignored',async()=>{assert.equal((await call('/deals','POST',{client:customer.id,title:'無效金額',amount:-1,stage:'需求確認'},staff1)).status,400);assert.equal((await call('/tasks','POST',{client:customer.id,title:'無效日期',owner:'staff01',due:'2026-02-30'},staff1)).status,400);let r=await call('/clients','POST',{name:'自己的客戶',contact:'自己',owner:'staff02',status:'新客戶',role:'manager'},staff2);assert.equal(r.status,201);assert.equal(r.body.role,undefined)});
test('journals keep the real author, are private to colleagues and readable but not editable by managers',async()=>{
 let r=await call('/journals','POST',{date:'2026-11-13',title:'工作成果',content:'完成客戶訪談',nextStep:'寄送報價',client:customer.id,author:'manager01'},staff1);assert.equal(r.status,201);const j=r.body;assert.equal(j.author,'staff01');assert.ok(j.createdAt);assert.equal((await call('/state','GET',undefined,staff1)).body.journals.length,1);assert.equal((await call('/state','GET',undefined,staff2)).body.journals.length,0);assert.equal((await call('/state','GET',undefined,manager)).body.journals.length,1);
 assert.equal((await call('/journals/'+j.id,'PATCH',{content:'主管冒改',version:1},manager)).status,403);assert.equal((await call('/journals/'+j.id,'PATCH',{content:'同事冒改',version:1},staff2)).status,403);
 r=await call('/journals/'+j.id,'PATCH',{content:'已寄送報價',author:'staff02',version:1},staff1);assert.equal(r.status,200);assert.equal(r.body.author,'staff01');assert.equal(r.body.createdAt,j.createdAt);assert.equal((await call('/journals/'+j.id,'PATCH',{content:'舊版覆蓋',version:1},staff1)).status,409);
 assert.equal((await call('/journals','POST',{date:'2026-02-30',title:'錯誤日期',content:'內容'},staff1)).status,400);assert.equal((await call('/journals','POST',{date:'2026-11-13',title:'過長內容',content:'字'.repeat(5001)},staff1)).status,400);
 assert.equal((await call('/journals','POST',{date:'2026-11-13',title:'無權客戶',content:'測試',client:customer.id},staff2)).status,403);
 assert.equal((await call('/journals','POST',{date:'2026-11-13',title:'內部工作',content:'整理提案'},staff2)).status,201);
 assert.equal((await call('/state','GET',undefined,staff2)).body.journals.length,1);assert.equal((await call('/state','GET',undefined,manager)).body.journals.length,2);
});
let announcement;
test('only managers publish, edit and pin announcements; all colleagues can read them',async()=>{
 const body={title:'團隊公告',content:'週會準備事項',pinned:true,author:'staff01'};
 assert.equal((await call('/announcements','POST',body,staff1)).status,403);
 let r=await call('/announcements','POST',body,manager);assert.equal(r.status,201);announcement=r.body;assert.equal(announcement.author,'manager01');assert.equal(announcement.pinned,true);
 for(const session of [staff1,staff2]){const state=(await call('/state','GET',undefined,session)).body;assert.equal(state.announcements.length,1);assert.equal(state.announcements[0].id,announcement.id)}
 assert.equal((await call('/announcements/'+announcement.id,'PATCH',{pinned:false,version:1},staff1)).status,403);
 r=await call('/announcements/'+announcement.id,'PATCH',{content:'更新週會準備事項',author:'staff02',pinned:false,version:1},manager);assert.equal(r.status,200);assert.equal(r.body.author,'manager01');assert.equal(r.body.updatedBy,'manager01');assert.equal(r.body.createdAt,announcement.createdAt);
 assert.equal((await call('/announcements/'+announcement.id,'PATCH',{content:'舊版覆蓋',version:1},manager)).status,409);
 assert.equal((await call('/announcements','POST',{...body,title:' '},manager)).status,400);
 assert.equal((await call('/announcements','POST',{...body,pinned:'true'},manager)).status,400);
});
test('announcement comments use the real identity, persist for the team, validate parent and reject overwrites',async()=>{
 let r=await call('/comments','POST',{announcement:announcement.id,text:'收到，請問需要哪些資料？',author:'manager01',createdAt:'fake'},staff1);assert.equal(r.status,201);assert.equal(r.body.author,'staff01');assert.notEqual(r.body.createdAt,'fake');const comment=r.body;
 const state=(await call('/state','GET',undefined,staff2)).body;assert.equal(state.comments.length,1);assert.equal(state.comments[0].text,comment.text);
 for(const s of [staff1,manager])assert.equal((await call('/comments/'+comment.id,'PATCH',{text:'冒改留言',version:1},s)).status,405);
 assert.equal((await call('/comments','POST',{announcement:'missing',text:'測試'},staff1)).status,404);
 assert.equal((await call('/comments','POST',{announcement:announcement.id,text:' '},staff1)).status,400);
 assert.equal((await call('/comments','POST',{announcement:announcement.id,text:'字'.repeat(2001)},staff1)).status,400);
 assert.equal((await call('/comments','POST',{announcement:announcement.id,text:'未登入留言'})).status,401);
 const {DatabaseSync}=require('node:sqlite'),other=new DatabaseSync(path.join(dataDir,'crm.sqlite'));assert.equal(other.prepare("SELECT COUNT(*) n FROM records WHERE kind='announcements'").get().n,1);assert.equal(other.prepare("SELECT COUNT(*) n FROM records WHERE kind='comments'").get().n,1);other.close();
});
test('role changes, disabling and resets invalidate sessions; persisted records survive database reopening',async()=>{assert.equal((await call('/users/staff02','POST',{name:'同事02',role:'staff',active:false},manager)).status,200);assert.equal((await call('/me','GET',undefined,staff2)).status,401);let r=await call('/users/staff01/reset','POST',{},manager);assert.equal(r.status,200);assert.ok(r.body.password.length>=12);assert.equal((await call('/state','GET',undefined,staff1)).status,401);let newSession=await login(accounts[1],r.body.password);assert.equal(newSession.user.mustChange,true);const {DatabaseSync}=require('node:sqlite'),other=new DatabaseSync(path.join(dataDir,'crm.sqlite'));assert.equal(other.prepare("SELECT COUNT(*) n FROM records WHERE kind='clients'").get().n,2);assert.equal(other.prepare("SELECT COUNT(*) n FROM records WHERE kind='journals'").get().n,2);other.close();assert.equal((await call('/audit','GET',undefined,manager)).status,200)});
test('logout revokes session and clears cookie',async()=>{assert.equal((await call('/logout','POST',{},manager)).status,200);assert.equal((await call('/state','GET',undefined,manager)).status,401)});
