const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const scrypt=require('node:util').promisify(crypto.scrypt);
const root=process.env.CRM_DATA_DIR||path.join(__dirname,'private');fs.mkdirSync(root,{recursive:true});
const sql=new DatabaseSync(path.join(root,'crm.sqlite'));
sql.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,salt TEXT NOT NULL,hash TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,time TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const userBy=n=>sql.prepare('SELECT * FROM users WHERE username=?').get(n);
const publicUser=u=>({username:u.username,name:u.name,role:u.role,active:!!u.active,mustChange:!!u.must_change});
function tx(fn){sql.exec('BEGIN IMMEDIATE');try{let r=fn();sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}
function audit(actor,action,target){sql.prepare('INSERT INTO audit(actor,action,target,time) VALUES(?,?,?,?)').run(actor,action,target,new Date().toISOString())}
const password=()=>crypto.randomBytes(15).toString('base64url')+'aA1!';
const hashSync=(p,s)=>crypto.scryptSync(p,s,64).toString('hex');
if(!sql.prepare('SELECT COUNT(*) n FROM users').get().n){
 const accounts=Array.from({length:20},(_,i)=>({username:i?'staff'+String(i).padStart(2,'0'):'manager01',name:i?'同事'+String(i).padStart(2,'0'):'主管',role:i?'staff':'manager',password:password()}));
 fs.writeFileSync(path.join(root,'initial-accounts.csv'),'\ufeff'+['帳號,顯示名稱,權限,初始密碼',...accounts.map(u=>[u.username,u.name,u.role==='manager'?'主管':'一般同事',u.password].join(','))].join('\r\n'),{mode:0o600});
 tx(()=>{for(const u of accounts){let salt=crypto.randomBytes(16).toString('hex');sql.prepare('INSERT INTO users(username,name,role,salt,hash) VALUES(?,?,?,?,?)').run(u.username,u.name,u.role,salt,hashSync(u.password,salt))}});
}
const stages=['初步接洽','需求確認','報價提案','已成交'];
const records=k=>sql.prepare('SELECT data,version FROM records WHERE kind=? ORDER BY rowid').all(k).map(r=>({...JSON.parse(r.data),version:r.version}));
function record(k,id){let r=sql.prepare('SELECT data,version FROM records WHERE kind=? AND id=?').get(k,id);return r?{...JSON.parse(r.data),version:r.version}:null}
function insert(k,d){sql.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)').run(k,d.id,JSON.stringify(d));return {...d,version:1}}
const canClient=(u,c)=>!!c&&(u.role==='manager'||c.owner===u.username);
function visible(u){let clients=records('clients').filter(c=>canClient(u,c)),ids=new Set(clients.map(c=>c.id));return {clients,deals:records('deals').filter(d=>ids.has(d.client)),tasks:records('tasks').filter(t=>u.role==='manager'||ids.has(t.client)||t.owner===u.username),notes:records('notes').filter(n=>ids.has(n.client)),journals:records('journals').filter(j=>u.role==='manager'||j.author===u.username),announcements:records('announcements'),comments:records('comments')}}
function fail(status,message){throw Object.assign(new Error(message),{status})}
function text(v,name,max=100,optional=false){if(typeof v!=='string'||v.length>max||(!optional&&!v.trim()))fail(400,`${name}格式不正確`);return v.trim()}
function secret(v){if(typeof v!=='string'||!v.length||v.length>256)fail(400,'密碼格式不正確');return v}
function member(n){if(!userBy(n)?.active)fail(400,'請選擇有效的負責同事');return n}
function validate(k,b,u,old){
 if(k==='announcements'){
  if(u.role!=='manager')fail(403,'只有主管可以發布或編輯公告');
  if(typeof b.pinned!=='boolean')fail(400,'置頂狀態不正確');
  const now=new Date().toISOString();return {title:text(b.title,'公告標題',100),content:text(b.content,'公告內容',5000),pinned:b.pinned,author:old?.author||u.username,createdAt:old?.createdAt||now,updatedAt:now,updatedBy:u.username};
 }
 if(k==='comments'){
  const announcement=text(b.announcement,'公告',80);if(!record('announcements',announcement))fail(404,'公告不存在');
  return {announcement,text:text(b.text,'留言',2000),author:u.username,createdAt:new Date().toISOString()};
 }
 if(k==='journals'){
  const date=text(b.date,'工作日期',10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail(400,'工作日期不正確');
  return {date,title:text(b.title,'日誌標題',100),content:text(b.content,'工作內容',5000),nextStep:text(b.nextStep??'','下一步',2000,true),client:text(b.client??'','關聯客戶',80,true),author:old?.author||u.username,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 }
 if(k==='clients'){if(u.role!=='manager'&&b.owner&&b.owner!==u.username)fail(403,'只有主管可以分配客戶');if(!['新客戶','跟進中','合作中'].includes(b.status))fail(400,'客戶狀態不正確');return {name:text(b.name,'公司名稱',60),contact:text(b.contact,'聯絡人',40),phone:text(b.phone??'','電話',30,true),industry:text(b.industry??'','產業',40,true),owner:member(b.owner||u.username),status:b.status}}
 if(k==='notes')return {client:text(b.client,'客戶',80),text:text(b.text,'紀錄',2000),author:u.username,time:new Date().toISOString()};
 if(k==='deals'){let amount=Number(b.amount);if(!Number.isSafeInteger(amount)||amount<0||amount>99999999999||!stages.includes(b.stage))fail(400,'金額或階段不正確');return {client:text(b.client,'客戶',80),title:text(b.title,'商機名稱'),amount,stage:b.stage}}
 if(k==='tasks'){if(!/^\d{4}-\d{2}-\d{2}$/.test(b.due)||!Number.isFinite(Date.parse(b.due))||new Date(b.due).toISOString().slice(0,10)!==b.due)fail(400,'日期不正確');if(u.role!=='manager'&&b.owner&&b.owner!==u.username)fail(403,'只有主管可以指派其他同事');return {client:text(b.client,'客戶',80),title:text(b.title,'待辦內容'),owner:member(b.owner||u.username),due:b.due,done:old?!!old.done:false}}
 fail(404,'找不到資料類型');
}
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/auth.js':'auth.js','/journal.js':'journal.js','/voice.js':'voice.js','/announcements.js':'announcements.js','/style.css':'style.css'},types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const port=Number(process.env.PORT||4173),host=process.env.BIND_HOST||'127.0.0.1';
const origins=new Set((process.env.APP_ORIGIN||`http://localhost:${port},http://127.0.0.1:${port}`).split(','));
const secure=[...origins].every(o=>o.startsWith('https://'));
const cookie=t=>`crm_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`;
const clearCookie='crm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
const attempts=new Map();
function throttle(key,limit){let now=Date.now(),v=attempts.get(key);if(!v||now-v.start>900000)v={start:now,n:0};v.n++;attempts.set(key,v);if(v.n>limit)fail(429,'嘗試次數過多，請於 15 分鐘後再試')}
async function body(req){if(!String(req.headers['content-type']).startsWith('application/json'))fail(415,'僅接受 JSON');let chunks=[],n=0;for await(const c of req){n+=c.length;if(n>1024*1024)fail(413,'資料過大');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{fail(400,'JSON 格式不正確')}}
const server=http.createServer(async(req,res)=>{
 const reply=(status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data))};
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
 try{
  const url=new URL(req.url,'http://localhost');
  if(!origins.has(`${secure?'https':'http'}://${req.headers.host}`))fail(403,'此主機未設定允許存取');
  if(!url.pathname.startsWith('/api/')){let name=files[url.pathname];if(req.method!=='GET'||!name)fail(404,'找不到頁面');res.writeHead(200,{'Content-Type':types[path.extname(name)]});res.end(fs.readFileSync(path.join(__dirname,name)));return}
  if(!['GET','POST','PATCH'].includes(req.method))fail(405,'不支援的操作');
  if(req.method!=='GET'&&(!origins.has(req.headers.origin)||req.headers['sec-fetch-site']==='cross-site'))fail(403,'請從本站操作');
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('crm_session='))?.slice(12);
  const session=raw?sql.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(digest(raw),Date.now()):null,u=session?userBy(session.username):null;
  if(url.pathname==='/api/login'&&req.method==='POST'){
   let b=await body(req),username=text(b.username,'帳號',50),p=secret(b.password);throttle('ip:'+req.socket.remoteAddress,60);throttle('user:'+username,10);
   let found=userBy(username),candidate=await scrypt(p,found?.salt||'0'.repeat(32),64),expected=Buffer.from(found?.hash||'0'.repeat(128),'hex');
   const latest=userBy(username);
   if(!found?.active||!latest?.active||latest.hash!==found.hash||!crypto.timingSafeEqual(candidate,expected))fail(401,'帳號或密碼不正確');
   if(raw)sql.prepare('DELETE FROM sessions WHERE token=?').run(digest(raw));
   let token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),username,csrf,Date.now()+8*3600000);audit(username,'login',username);
   reply(200,{user:publicUser(latest),csrf},{'Set-Cookie':cookie(token)});return;
  }
  if(!u?.active)fail(401,'請先登入');
  if(req.method!=='GET'&&req.headers['x-csrf-token']!==session.csrf)fail(403,'操作驗證失敗，請重新登入');
  if(url.pathname==='/api/me'&&req.method==='GET'){reply(200,{user:publicUser(u),csrf:session.csrf});return}
  if(url.pathname==='/api/logout'&&req.method==='POST'){sql.prepare('DELETE FROM sessions WHERE token=?').run(session.token);reply(200,{ok:true},{'Set-Cookie':clearCookie});return}
  if(url.pathname==='/api/password'&&req.method==='POST'){
   let b=await body(req);throttle('password:'+u.username,10);let current=secret(b.current),next=secret(b.password);
   if(next.length<12||next===current)fail(400,'新密碼需至少 12 字元，且與舊密碼不同');
   if(!crypto.timingSafeEqual(await scrypt(current,u.salt,64),Buffer.from(u.hash,'hex')))fail(400,'目前密碼不正確');
   let salt=crypto.randomBytes(16).toString('hex'),hash=(await scrypt(next,salt,64)).toString('hex');
   tx(()=>{const latest=userBy(u.username);if(!latest?.active||latest.hash!==u.hash||!sql.prepare('SELECT 1 FROM sessions WHERE token=?').get(session.token))fail(401,'帳號狀態已變更，請重新登入');sql.prepare('UPDATE users SET salt=?,hash=?,must_change=0 WHERE username=?').run(salt,hash,u.username);sql.prepare('DELETE FROM sessions WHERE username=?').run(u.username);audit(u.username,'password-change',u.username)});
   reply(200,{ok:true},{'Set-Cookie':clearCookie});return;
  }
  if(u.must_change)fail(403,'首次登入請先變更密碼');
  if(url.pathname==='/api/state'&&req.method==='GET'){reply(200,{...visible(u),users:sql.prepare('SELECT * FROM users ORDER BY username').all().filter(x=>u.role==='manager'||x.active).map(publicUser),user:publicUser(u)});return}
  if(url.pathname==='/api/audit'&&req.method==='GET'){if(u.role!=='manager')fail(403,'僅主管可查看');reply(200,sql.prepare('SELECT actor,action,target,time FROM audit ORDER BY id DESC LIMIT 100').all());return}
  const um=url.pathname.match(/^\/api\/users\/([a-z0-9]+)(\/reset)?$/);
  if(um&&req.method==='POST'){
   if(u.role!=='manager')fail(403,'只有主管可以管理帳號');let target=userBy(um[1]);if(!target)fail(404,'帳號不存在');let b=await body(req);
   if(um[2]){let p=password(),salt=crypto.randomBytes(16).toString('hex');tx(()=>{sql.prepare('UPDATE users SET salt=?,hash=?,must_change=1 WHERE username=?').run(salt,hashSync(p,salt),target.username);sql.prepare('DELETE FROM sessions WHERE username=?').run(target.username);audit(u.username,'password-reset',target.username)});reply(200,{password:p});return}
   let name=text(b.name,'姓名',40),role=b.role,active=b.active;if(!['manager','staff'].includes(role)||typeof active!=='boolean')fail(400,'權限或狀態不正確');
   if(target.username===u.username&&(!active||role!=='manager'))fail(400,'不能停用或降級自己的主管帳號');
   tx(()=>{sql.prepare('UPDATE users SET name=?,role=?,active=? WHERE username=?').run(name,role,Number(active),target.username);sql.prepare('DELETE FROM sessions WHERE username=?').run(target.username);audit(u.username,'user-update',target.username)});reply(200,{ok:true});return;
  }
  if(url.pathname==='/api/import'&&req.method==='POST'){
   if(u.role!=='manager')fail(403,'只有主管可匯入舊資料');if(sql.prepare("SELECT 1 FROM settings WHERE key='imported'").get()||sql.prepare('SELECT COUNT(*) n FROM records').get().n)fail(409,'伺服器已有資料，無法再次匯入');
   let b=await body(req);if(!['clients','deals','tasks','notes'].every(k=>Array.isArray(b[k])&&b[k].length<=1000))fail(400,'舊資料格式不正確');
   let owners={'我':u.username,'小安':'staff01','佳穎':'staff02'},mapOwner=v=>owners[v]||(userBy(v)?.active?v:u.username);
   tx(()=>{let ids=new Set();for(const c of b.clients){let id=text(c.id,'編號',80);if(ids.has(id))fail(400,'客戶編號重複');ids.add(id);insert('clients',{id,...validate('clients',{...c,owner:mapOwner(c.owner)},u)})}
    for(const kind of ['deals','tasks','notes'])for(const r of b[kind]){if(!ids.has(r.client))fail(400,'關聯客戶不存在');let data=validate(kind,{...r,owner:mapOwner(r.owner)},u);if(kind==='tasks')data.done=!!r.done;if(kind==='notes'){data.author=mapOwner(r.author);data.time=Number.isFinite(Date.parse(r.time))?r.time:data.time}insert(kind,{id:text(r.id,'編號',80),...data})}
    sql.prepare("INSERT INTO settings VALUES('imported','1')").run();audit(u.username,'legacy-import','all');});reply(200,{ok:true});return;
  }
  const rm=url.pathname.match(/^\/api\/(clients|deals|tasks|notes|journals|announcements|comments)(?:\/([a-zA-Z0-9_-]+))?$/);
  if(rm&&['POST','PATCH'].includes(req.method)){
   let [,kind,id]=rm,b=await body(req);if(req.method==='POST'&&id||req.method==='PATCH'&&!id)fail(405,'操作不正確');let old=id?record(kind,id):null;if(id&&!old)fail(404,'資料不存在');
   if(kind==='announcements'&&u.role!=='manager')fail(403,'只有主管可以發布或編輯公告');
   if(kind==='comments'&&old)fail(405,'留言建立後不可修改，請新增補充留言');
   if(old){let allowed=kind==='announcements'?u.role==='manager':kind==='journals'?old.author===u.username:kind==='clients'?canClient(u,old):kind==='tasks'?(u.role==='manager'||old.owner===u.username||canClient(u,record('clients',old.client))):canClient(u,record('clients',old.client));if(!allowed)fail(403,'沒有此筆資料的權限');if(b.version!==old.version)fail(409,'資料已由其他人更新，請重新載入後再修改')}
   if(kind==='notes'&&old)fail(405,'紀錄建立後不可修改');let data;
   if(kind==='tasks'&&old&&Object.keys(b).every(k=>['done','version'].includes(k))){if(typeof b.done!=='boolean')fail(400,'完成狀態不正確');data={...old,done:b.done}}
   else{if(old&&kind==='tasks'&&u.role!=='manager'&&!canClient(u,record('clients',old.client)))fail(403,'受指派同事只能更新待辦完成狀態');data=validate(kind,{...old,...b},u,old);const unchangedJournalClient=kind==='journals'&&old&&data.client===old.client;if(!['clients','announcements','comments'].includes(kind)&&!(kind==='journals'&&(!data.client||unchangedJournalClient))&&!canClient(u,record('clients',data.client)))fail(403,'無法存取該客戶')}
   let result;tx(()=>{if(old){let next={...old,...data};delete next.version;sql.prepare('UPDATE records SET data=?,version=version+1 WHERE kind=? AND id=?').run(JSON.stringify(next),kind,id);result={...next,version:old.version+1}}else result=insert(kind,{id:crypto.randomUUID(),...data});audit(u.username,old?'update-'+kind:'create-'+kind,result.id)});reply(old?200:201,result);return;
  }
  fail(404,'找不到操作');
 }catch(e){if(e.status)reply(e.status,{error:e.message});else{console.error('Request failed:',e.code||e.name);reply(500,{error:'伺服器處理失敗，請稍後再試'})}}
});
const cleanup=setInterval(()=>{for(const [k,v]of attempts)if(Date.now()-v.start>900000)attempts.delete(k);sql.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now())},60000);cleanup.unref();
if(require.main===module)server.listen(port,host,()=>console.log(`CRM: http://${host}:${port}; account list: private/initial-accounts.csv`));
module.exports={server,sql};
