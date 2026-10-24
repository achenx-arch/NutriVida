// FASE 9A: consentimientos en navegador real (Chrome/Edge headless vía DevTools). Esquema temporal; datos sintéticos.
// No usa nutrivida_db ni cuentas reales. Comprueba que la casilla solo refleja lo que PostgreSQL confirmó.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-fase9a';process.env.ENCRYPTION_KEY='ab'.repeat(32);
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool});
  const cliente=await sistema.registrar({nombre:'Cliente consentimiento',correo:'cliente9a@example.test',password:'Clave12345'});
  const fila=async()=>{const f=(await pool.query('SELECT autoriza_contexto_ia p, autoriza_historial_ia h FROM perfil_cliente WHERE id_usuario=$1',[cliente.id])).rows[0];return {p:f?.p===true,h:f?.h===true};};
  server=crearApp(sistema).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+perfil,...(process.env.CHROME_ARGS||'').split(' ').filter(Boolean),'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(perfil,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(portFile);i++)await pausa(100);assert.ok(fs.existsSync(portFile));
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let sec=0;const pend=new Map(),errores=[],pausadas=[];
  ws.addEventListener('message',ev=>{const d=JSON.parse(ev.data);if(d.id){const r=pend.get(d.id);pend.delete(d.id);if(r)d.error?r.reject(new Error(d.error.message)):r.resolve(d.result);}else if(d.method==='Fetch.requestPaused')pausadas.push(d.params);else if(d.method==='Runtime.exceptionThrown')errores.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]||'Excepción');else if(d.method==='Log.entryAdded'&&d.params.entry.source==='security'&&d.params.entry.level==='error')errores.push('CSP: '+d.params.entry.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++sec;const t=setTimeout(()=>{pend.delete(i);reject(new Error('CDP '+method));},15000);pend.set(i,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' :: '+x);return r.result.value;};
  const esperar=async(x,ms=8000)=>{const fin=Date.now()+ms;while(Date.now()<fin){if(await ev(x))return;await pausa(80);}throw new Error('No se cumplió: '+x+' '+JSON.stringify(errores));};
  const campo=(i,v)=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(i)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input'));})()`);
  const tam=(w,h,mobile=false)=>send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile});
  const foto=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../docs/evidencias',n),Buffer.from(s.data,'base64'));};
  const consultar=async t=>{await campo('consultaTexto',t);await ev("document.getElementById('consultaForm').requestSubmit()");await esperar("!document.getElementById('respuestaBox').classList.contains('hidden') && document.getElementById('consultaBtn').textContent==='Enviar consulta'");};
  const estado=()=>ev("({p:document.getElementById('consentPerfil').checked,h:document.getElementById('consentHistorial').checked,pd:document.getElementById('consentPerfil').disabled,hd:document.getElementById('consentHistorial').disabled,msg:document.getElementById('consentMsg').textContent,err:document.getElementById('consentMsg').classList.contains('msg-error')})");
  const listo="!document.getElementById('consentPerfil').disabled && !document.getElementById('consentHistorial').disabled";
  // Clic REAL del ratón sobre la casilla (no element.click()), como en el navegador del usuario.
  const clicReal=async idEl=>{const c=await ev(`(()=>{const e=document.getElementById(${JSON.stringify(idEl)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:c.x,y:c.y,button:'left',clickCount:1});};
  const abrirPerfil=async()=>{await ev(`document.querySelector('[data-vista="profile"]').click()`);await esperar(listo+" && document.getElementById('consentMsg').textContent===''");};
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');await tam(1366,1000);
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");
  await campo('loginCorreo','cliente9a@example.test');await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/perfil'}]});
  await ev(`document.querySelector('[data-vista="profile"]').click()`);
  for(let i=0;i<100&&!pausadas.length;i++)await pausa(50);assert.equal(pausadas.length,1,'GET /api/perfil interceptado');
  await send('Fetch.fulfillRequest',{requestId:pausadas.shift().requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({perfilSalud:null})).toString('base64')});
  await send('Fetch.disable');
  await esperar("document.getElementById('consentMsg').classList.contains('msg-error')");
  let e=await estado();assert.ok(e.pd&&e.hd,'sin datos válidos no se habilitan');assert.match(e.msg,/No se pudo leer el estado de tus autorizaciones/);
  assert.equal(await ev("document.getElementById('consentReintentar').classList.contains('hidden')"),false,'botón Reintentar visible');
  ok('Reproducción del fallo real (respuesta sin consentimientos): casillas bloqueadas CON aviso claro y Reintentar, no en silencio');
  await ev("document.getElementById('consentReintentar').click()");await esperar(listo+" && document.getElementById('consentMsg').textContent===''");
  assert.equal(await ev("document.getElementById('consentReintentar').classList.contains('hidden')"),true);
  ok('Reintentar con el servidor correcto habilita ambas casillas');
  e=await estado();assert.equal(e.p,false);assert.equal(e.h,false);assert.deepEqual(await fila(),{p:false,h:false});
  ok('Estado inicial leído del servidor: ambos sin autorizar (perfil inexistente / NULL)');

  // Retener la solicitud: la casilla NO debe mostrarse activada antes de la confirmación del servidor.
  await send('Fetch.enable',{patterns:[{urlPattern:'*perfil/consentimiento*'}]});
  await ev("document.getElementById('consentPerfil').click()");
  for(let i=0;i<100&&!pausadas.length;i++)await pausa(50);assert.equal(pausadas.length,1,'solicitud retenida');
  e=await estado();assert.equal(e.p,false,'no activada antes de confirmar');assert.ok(e.pd&&e.hd,'controles bloqueados mientras guarda');assert.match(e.msg,/Guardando/);
  await send('Fetch.continueRequest',{requestId:pausadas.shift().requestId});await send('Fetch.disable');
  await esperar(listo);e=await estado();assert.equal(e.p,true);assert.equal(e.h,false);assert.match(e.msg,/guardada/);assert.deepEqual(await fila(),{p:true,h:false});
  ok('Perfil autorizado solo tras confirmación de PostgreSQL; historial independiente');

  // Teclado: foco + barra espaciadora sobre la casilla de historial.
  await ev("document.getElementById('consentHistorial').focus()");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await esperar(listo+" && document.getElementById('consentHistorial').checked");assert.deepEqual(await fila(),{p:true,h:true});
  ok('Accesible con teclado (Espacio) y guardado real');

  await ev("document.getElementById('consentPerfil').click()");await esperar(listo+" && !document.getElementById('consentPerfil').checked");
  assert.deepEqual(await fila(),{p:false,h:true});assert.match((await estado()).msg,/retirada/);
  ok('Revocación del perfil sin afectar el historial');

  // Fallo de red: la casilla vuelve al estado guardado y se informa el error.
  await send('Network.setBlockedURLs',{urls:['*perfil/consentimiento*']});
  await ev("document.getElementById('consentPerfil').click()");await esperar(listo+" && document.getElementById('consentMsg').classList.contains('msg-error')");
  e=await estado();assert.equal(e.p,false,'sin estado engañoso');assert.match(e.msg,/No se guardó.*no hubo conexión/);assert.deepEqual(await fila(),{p:false,h:true});
  await send('Network.setBlockedURLs',{urls:[]});
  ok('Fallo de red: no muestra una autorización que no se guardó');

  await ev(`document.querySelector('[data-vista="ai"]').click()`);await abrirPerfil();
  e=await estado();assert.equal(e.p,false);assert.equal(e.h,true);
  // Flujo completo con CLIC REAL: desactivar historial, activar solo perfil, activar historial, revocar perfil, recargar.
  await clicReal('consentHistorial');await esperar(listo+" && !document.getElementById('consentHistorial').checked");assert.deepEqual(await fila(),{p:false,h:false});
  await clicReal('consentPerfil');await esperar(listo+" && document.getElementById('consentPerfil').checked");assert.deepEqual(await fila(),{p:true,h:false});
  await clicReal('consentHistorial');await esperar(listo+" && document.getElementById('consentHistorial').checked");assert.deepEqual(await fila(),{p:true,h:true});
  await clicReal('consentPerfil');await esperar(listo+" && !document.getElementById('consentPerfil').checked");assert.deepEqual(await fila(),{p:false,h:true});
  await send('Page.reload',{ignoreCache:true});await esperar("typeof apiFetch==='function' && !document.getElementById('appNav').classList.contains('hidden')");
  await abrirPerfil();e=await estado();assert.equal(e.p,false);assert.equal(e.h,true);assert.ok(!e.pd&&!e.hd);
  const ev2=(await pool.query("SELECT accion FROM auditoria WHERE id_usuario=$1 AND accion LIKE 'consentimiento_%' ORDER BY fecha",[cliente.id])).rows.map(x=>x.accion);
  assert.deepEqual(ev2.slice(-4),['consentimiento_historial_ia_revocado','consentimiento_perfil_ia_otorgado','consentimiento_historial_ia_otorgado','consentimiento_perfil_ia_revocado']);
  ok('Clic real: perfil y historial independientes, persistidos en PostgreSQL, auditados y correctos tras recargar la página');ok('Al volver a la vista se muestra el estado real de PostgreSQL');
  await tam(1366,1000);await ev("document.getElementById('consentimientosIA').scrollIntoView()");await foto('fase9a-consentimientos-desktop.png');
  await tam(390,844,true);await pausa(250);assert.ok(await ev('document.documentElement.scrollWidth<=window.innerWidth'),'sin desborde horizontal');
  await ev("document.getElementById('consentimientosIA').scrollIntoView()");await foto('fase9a-consentimientos-movil.png');ok('Responsive a 390 px sin desborde');
  assert.deepEqual(errores.filter(x=>!/ERR_BLOCKED|Failed to fetch/i.test(x)),[]);ok('Sin excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0,datos:'sintéticos en DB_TEST_NAME (esquema temporal)'}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
