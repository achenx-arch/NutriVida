// FASE 9C en navegador real (Chrome/Edge headless vía DevTools): consentimiento de historial de compras (casilla
// existente «Personalización con mis compras anteriores»), su sincronización y su efecto en NutriVida AI.
// Esquema temporal nv_test_*, cliente, catálogo y pedidos SINTÉTICOS; IA simulada que elige todos los candidatos en el
// orden recibido (así el orden de las tarjetas refleja la relevancia del backend). Evidencias: docs/evidencias/fase9c/.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-fase9c';process.env.ENCRYPTION_KEY='ab'.repeat(32);
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth'),{ServicioIA}=require('../src/services/iaService'),{OllamaProvider}=require('../src/services/ollamaProvider');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
const BEBF='Bebidas Funcionales (Energéticas Naturales)',BEBS='Bebidas Saludables (Jugos Naturales y Smoothies)';
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const evid=path.join(__dirname,'../docs/evidencias/fase9c');fs.mkdirSync(evid,{recursive:true});
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 const prompts=[];
 const transporte=async(url,opts)=>{const req=JSON.parse(opts.body);prompts.push(req);const ids=req.format.properties.productos.items?.properties?.id?.enum||[];
  return {ok:true,json:async()=>({response:JSON.stringify({tipo:ids.length?'RECOMENDACION':'ORIENTACION_GENERAL',productos:ids.map(id=>({id}))})})};};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool,ia:new ServicioIA({ollamaProvider:new OllamaProvider({model:'modelo-prueba',transporte})})}),hash=await hashPassword('Clave12345');
  const admin=new Administrador({nombre:'Admin',correo:'admin@example.test',passwordHash:hash});await sistema.repositorios.usuarios.guardar(admin);
  const cliente=await sistema.registrar({nombre:'Cliente 9C',correo:'cliente@example.test',password:'Clave12345'});
  const g=(tipo,datos)=>sistema.catalogoComercial.guardar(admin.id,tipo,null,datos);const cat=(await g('categorias',{nombre:'Bebidas'})).id,ids={};
  for(const [nombre,desc,ing] of [[BEBF,'Bebidas naturales elaboradas con té verde, jengibre, limón y miel.',['Jengibre','Limón','Miel','Té verde']],
    [BEBS,'Bebidas naturales ricas en vitaminas, diseñadas para hidratar y nutrir el cuerpo.',['Agua purificada o leche vegetal','Frutas frescas (naranja, piña, mango, fresa)']]]){
   const ingredientes=[];for(const n of ing)ingredientes.push({id:(await g('ingredientes',{nombre:n})).id});
   const p=await g('productos',{nombre,categoriaId:cat,precio:'12.50',estado:true,stockMinimo:1,descripcion:desc,ingredientes});ids[nombre]=p.id;
   await sistema.inventario.registrar(admin.id,{productoId:p.id,tipo:'AJUSTE',cantidad:20,motivo:'Navegador 9C'});}
  // Pedidos SINTÉTICOS: BEBS entregada 2 veces; BEBF solo en pedidos NO entregados (no cuentan).
  for(const [estado,prod] of [['ENTREGADO',BEBS],['ENTREGADO',BEBS],['PENDIENTE',BEBF],['CANCELADO',BEBF],['LISTO',BEBF]]){
   const db=await pool.connect();try{await db.query('BEGIN');const r=await db.query("INSERT INTO pedidos(id_cliente,estado,subtotal,total,fecha_pedido,fecha_actualizacion) VALUES($1,$2,12.5,12.5,CURRENT_TIMESTAMP - interval '3 days',CURRENT_TIMESTAMP) RETURNING id_pedido",[cliente.id,estado]);
    await db.query('INSERT INTO detalle_pedido(id_pedido,id_producto,cantidad,precio_unitario,subtotal) VALUES($1,$2,1,12.5,12.5)',[r.rows[0].id_pedido,ids[prod]]);await db.query('COMMIT');}
   catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
  server=crearApp(sistema).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+perfil,...(process.env.CHROME_ARGS||'').split(' ').filter(Boolean),'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(perfil,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(portFile);i++)await pausa(100);assert.ok(fs.existsSync(portFile));
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let sec=0;const pend=new Map(),errores=[],pausadas=[];
  ws.addEventListener('message',ev=>{const d=JSON.parse(ev.data);if(d.id){const r=pend.get(d.id);pend.delete(d.id);if(r)d.error?r.reject(new Error(d.error.message)):r.resolve(d.result);}
   else if(d.method==='Fetch.requestPaused')pausadas.push(d.params);
   else if(d.method==='Runtime.exceptionThrown')errores.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]||'Excepción');
   else if(d.method==='Log.entryAdded'&&d.params.entry.source==='security'&&d.params.entry.level==='error')errores.push('CSP: '+d.params.entry.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++sec;const t=setTimeout(()=>{pend.delete(i);reject(new Error('CDP '+method));},15000);pend.set(i,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' :: '+x);return r.result.value;};
  const esperar=async(x,ms=8000)=>{const fin=Date.now()+ms;while(Date.now()<fin){if(await ev(x))return;await pausa(80);}throw new Error('No se cumplió: '+x+' '+JSON.stringify(errores));};
  const esperarPausa=async(filtro,ms=8000)=>{const fin=Date.now()+ms;while(Date.now()<fin){const i=pausadas.findIndex(filtro);if(i>=0)return pausadas.splice(i,1)[0];await pausa(40);}throw new Error('No se retuvo la solicitud esperada');};
  const campo=(i,v)=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(i)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input'));})()`);
  const foto=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evid,n),Buffer.from(s.data,'base64'));};
  const clicReal=async idEl=>{const c=await ev(`(()=>{const e=document.getElementById(${JSON.stringify(idEl)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:c.x,y:c.y,button:'left',clickCount:1});};
  const ui=()=>ev("({hist:document.getElementById('consentHistorial').checked,perfil:document.getElementById('consentPerfil').checked,dis:document.getElementById('consentHistorial').disabled,msg:document.getElementById('consentMsg').textContent,reintentar:!document.getElementById('consentReintentar').classList.contains('hidden'),avisoActivo:document.getElementById('alimentacionEstado').classList.contains('activo')})");
  const bd=async()=>(await pool.query('SELECT autoriza_contexto_ia c, autoriza_historial_ia h FROM perfil_cliente WHERE id_usuario=$1',[cliente.id])).rows[0]||{};
  const listo="!document.getElementById('consentHistorial').disabled && document.getElementById('consentMsg').textContent!=='Cargando tu autorización…'";
  const irA=v=>ev(`document.querySelector('[data-vista="${v}"]').click()`);
  const consultar=async t=>{await ev("document.getElementById('respuestaBox').classList.add('hidden')");await campo('consultaTexto',t);await ev("document.getElementById('consultaForm').requestSubmit()");
   await esperar("!document.getElementById('respuestaBox').classList.contains('hidden') && document.getElementById('consultaBtn').textContent==='Enviar consulta'");};
  const tarjetas=()=>ev("[...document.querySelectorAll('#recomendacionesIA .ia-card h3')].map(h=>h.textContent)");
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");
  await campo('loginCorreo','cliente@example.test');await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");

  // 1. Casilla existente y explicación visible; NULL = no autorizado.
  await irA('profile');await esperar(listo);
  const detalle=await ev("document.getElementById('consentHistorialDetalle').textContent");
  for(const frase of [/entregados/,/90 días/,/no reemplaza tus restricciones alimentarias/,/no.*garantiza que un producto sea seguro frente a alergias/,/retirar el permiso/,/pedidos no se eliminan/])assert.match(detalle,frase);
  let u=await ui();assert.equal(u.hist,false);assert.equal(u.perfil,false);
  assert.equal(await ev("document.querySelectorAll('input[type=checkbox][id^=consent]').length"),2,'sin consentimiento duplicado');
  await ev("document.getElementById('consentimientosIA').scrollIntoView()");await foto('fase9c-consentimiento-historial.png');
  ok('1. Casilla existente «Personalización con mis compras anteriores» con explicación; NULL se muestra como no autorizado');

  // 2. Sin consentimiento: sin personalización (orden por nombre).
  await irA('ai');await consultar('¿Qué bebidas tienen?');assert.deepEqual(await tarjetas(),[BEBF,BEBS]);
  ok('2. Sin consentimiento de historial: recomendaciones sin personalización');

  // 3. Activación en carrera: PUT retenido + nueva carga cuya respuesta es anterior; solo se muestra lo confirmado.
  await irA('profile');await esperar(listo);
  await send('Fetch.enable',{patterns:[{urlPattern:'*perfil/consentimiento*',requestStage:'Request'},{urlPattern:'*/api/perfil',requestStage:'Response'}]});
  await clicReal('consentHistorial');const put=await esperarPausa(p=>p.request.url.includes('consentimiento'));
  u=await ui();assert.equal(u.hist,false,'no se muestra antes de confirmar');assert.ok(u.dis);
  await irA('ai');await irA('profile');const carga=await esperarPausa(p=>p.request.url.endsWith('/api/perfil'));
  await send('Fetch.continueRequest',{requestId:put.requestId});await esperar("document.getElementById('consentMsg').textContent==='Autorización guardada.'");
  await send('Fetch.continueRequest',{requestId:carga.requestId});await send('Fetch.disable');await esperar(listo);await pausa(400);
  u=await ui();assert.equal(u.hist,true,'la respuesta antigua no desmarca lo confirmado');assert.equal(u.perfil,false,'independiente del perfil');assert.equal(u.avisoActivo,false,'«Mi alimentación» sigue sin autorización de perfil');
  assert.deepEqual(await bd(),{c:null,h:true});
  ok('3. Activación en carrera: solo tras confirmación; independiente del consentimiento de perfil y del aviso de «Mi alimentación»');

  // 4. Con consentimiento: el historial ordena (BEBS, 2 pedidos entregados, primero). Ollama no recibe compras.
  await irA('ai');await consultar('¿Qué bebidas tienen?');assert.deepEqual(await tarjetas(),[BEBS,BEBF]);
  assert.doesNotMatch(JSON.stringify(prompts.at(-1)),/pedido|historial|compra|recurrente/i);
  await foto('fase9c-recomendacion-historial.png');
  ok('4. Con consentimiento: el historial entregado ordena las opciones relevantes; Ollama no recibe compras');

  // 5. Fallo al guardar la retirada: no se presenta como guardado; Reintentar consulta el estado real.
  await irA('profile');await esperar(listo);
  await send('Network.setBlockedURLs',{urls:['*perfil/consentimiento*']});await clicReal('consentHistorial');
  await esperar("document.getElementById('consentMsg').classList.contains('msg-error')");await send('Network.setBlockedURLs',{urls:[]});
  u=await ui();assert.equal(u.hist,true,'sigue mostrando lo confirmado');assert.ok(u.reintentar);assert.deepEqual(await bd(),{c:null,h:true});
  await clicReal('consentReintentar');await esperar(listo+" && document.getElementById('consentMsg').textContent===''");
  ok('5. Fallo al retirar: no se muestra como guardado; Reintentar consulta el estado real');

  // 6. Retirada: efecto inmediato en la siguiente consulta; los pedidos se conservan.
  const pedidos=(await pool.query('SELECT count(*)::int n FROM pedidos WHERE id_cliente=$1',[cliente.id])).rows[0].n;
  await clicReal('consentHistorial');await esperar(listo+" && document.getElementById('consentMsg').textContent==='Autorización retirada.'");
  assert.deepEqual(await bd(),{c:null,h:false});
  await irA('ai');await consultar('¿Qué bebidas tienen?');assert.deepEqual(await tarjetas(),[BEBF,BEBS]);
  assert.equal((await pool.query('SELECT count(*)::int n FROM pedidos WHERE id_cliente=$1',[cliente.id])).rows[0].n,pedidos,'retirar no elimina pedidos');
  ok('6. Retirada: la siguiente consulta ya no usa el historial; los pedidos se conservan');

  // 7. Recarga: estado confirmado recuperado de PostgreSQL.
  await irA('profile');await esperar(listo);await clicReal('consentHistorial');await esperar(listo+" && document.getElementById('consentMsg').textContent==='Autorización guardada.'");
  await send('Page.reload',{ignoreCache:true});await esperar("typeof apiFetch==='function' && !document.getElementById('appNav').classList.contains('hidden')",30000);
  await irA('profile');await esperar(listo);u=await ui();assert.equal(u.hist,true);assert.equal(u.perfil,false);
  assert.deepEqual(errores.filter(x=>!/ERR_BLOCKED|Failed to fetch|TypeError/i.test(x)),[]);
  ok('7. Recarga: se recupera el estado confirmado; sin excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0,datos:'sintéticos en DB_TEST_NAME (esquema temporal)'}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
