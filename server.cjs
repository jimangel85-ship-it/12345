const {server}=require('./api-server.cjs');
server.listen(Number(process.env.PORT||4173),process.env.BIND_HOST||'127.0.0.1',()=>console.log('CRM: http://localhost:'+(process.env.PORT||4173)));
