// Isolated browser QA fixture. Never uses the real team's database.
const path=require('node:path'),crypto=require('node:crypto');
process.env.CRM_DATA_DIR=path.join(__dirname,'private','ui-fixture');process.env.PORT='4174';process.env.APP_ORIGIN='http://localhost:4174';
const {server,sql}=require('./api-server.cjs');
for(const username of ['manager01','staff01']){const salt=crypto.randomBytes(16).toString('hex');sql.prepare('UPDATE users SET salt=?,hash=?,must_change=0 WHERE username=?').run(salt,crypto.scryptSync('UiCheck-Only-2026!',salt,64).toString('hex'),username)}
if(!sql.prepare('SELECT COUNT(*) n FROM records').get().n){const c={id:'ui-client',name:'登入權限測試客戶',contact:'測試窗口',owner:'staff01',phone:'',industry:'測試',status:'新客戶'};sql.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)').run('clients',c.id,JSON.stringify(c))}
server.listen(4174,'127.0.0.1',()=>console.log('Isolated UI fixture: http://localhost:4174'));
