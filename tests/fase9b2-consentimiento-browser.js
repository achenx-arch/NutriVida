// FASE 9B-2 — Sincronización del consentimiento de perfil en el navegador (defecto heredado de FASE 9A).
// Reproduce condiciones de carrera reales con el protocolo DevTools: respuestas de carga retenidas y liberadas tarde,
// guardados en vuelo, fallos de red y respuestas perdidas después de que el servidor ya guardó.
// Esquema temporal nv_test_*, cliente SINTÉTICO. Evidencias: docs/evidencias/fase9b2/.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-fase9b2-consentimiento';process.env.ENCRYPTION_KEY='ab'.repeat(32);
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const evid=path.join(__dirname,'../docs/evidencias/fase9b2');fs.mkdirSync(evid,{recursive:true});
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool}),hash=await hashPassword('Clave12345');
  await sistema.repositorios.usuarios.guardar(new Administrador({nombre:'Admin',correo:'admin@example.test',passwordHash:hash}));
  const cliente=await sistema.registrar({nombre:'Cliente sincronización',correo:'cliente@example.test',password:'Clave12345'});
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
  // Estado visible: casilla de perfil, si está deshabilitada, mensaje, botón Reintentar y aviso de «Mi alimentación».
  const ui=()=>ev("(()=>{const c=document.getElementById('consentPerfil'),a=document.getElementById('alimentacionEstado');return {check:c.checked,dis:c.disabled,histDis:document.getElementById('consentHistorial').disabled,msg:document.getElementById('consentMsg').textContent,reintentar:!document.getElementById('consentReintentar').classList.contains('hidden'),avisoVisible:!a.classList.contains('hidden'),avisoActivo:a.classList.contains('activo')};})()");
  const bd=async()=>(await pool.query('SELECT autoriza_contexto_ia FROM perfil_cliente WHERE id_usuario=$1',[cliente.id])).rows[0]?.autoriza_contexto_ia===true;
  // El aviso de «Mi alimentación» y la casilla deben salir del MISMO estado confirmado.
  const sincronizado=async()=>{const u=await ui();assert.equal(u.avisoActivo,u.check,'aviso de Mi alimentación sincronizado con la casilla');return u;};
  const listo="!document.getElementById('consentPerfil').disabled && document.getElementById('consentMsg').textContent!=='Cargando tu autorización…'";
  const irA=v=>ev(`document.querySelector('[data-vista="${v}"]').click()`);
  const interceptar=patterns=>send('Fetch.enable',{patterns});
  const soltar=p=>send('Fetch.continueRequest',{requestId:p.requestId});

  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");
  await campo('loginCorreo','cliente@example.test');await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");

  // 1. Carga normal: casillas deshabilitadas MIENTRAS se carga; luego estado real (NULL = no autorizado).
  await interceptar([{urlPattern:'*/api/perfil',requestStage:'Response'}]);
  await irA('profile');let g=await esperarPausa(()=>true);
  let u=await ui();assert.ok(u.dis&&u.histDis,'deshabilitadas durante la carga');assert.equal(u.msg,'Cargando tu autorización…');
  await soltar(g);await send('Fetch.disable');await esperar(listo);
  u=await sincronizado();assert.equal(u.check,false);assert.equal(u.msg,'');assert.equal(await bd(),false);
  ok('1. Carga normal: casillas deshabilitadas mientras carga; NULL se muestra como no autorizado; aviso sincronizado');

  // 2. Respuesta tardía de una carga ANTERIOR: no sobrescribe el estado de la carga más reciente.
  await irA('ai');await interceptar([{urlPattern:'*/api/perfil',requestStage:'Response'}]);
  await irA('profile');const vieja=await esperarPausa(()=>true);              // calculada con autoriza = NULL
  await sistema.perfil.actualizarConsentimientos(cliente.id,{autorizaContextoIA:true}); // otro dispositivo autoriza
  await irA('ai');await irA('profile');const nueva=await esperarPausa(()=>true); // calculada con autoriza = TRUE
  await soltar(nueva);await esperar(listo+" && document.getElementById('consentPerfil').checked");
  await soltar(vieja);await send('Fetch.disable');await pausa(800);
  u=await sincronizado();assert.equal(u.check,true,'la respuesta antigua (no autorizado) se descartó');assert.equal(await bd(),true);
  ok('2. Respuesta tardía de una carga anterior: descartada; se conserva el estado de la carga más reciente');
  await sistema.perfil.actualizarConsentimientos(cliente.id,{autorizaContextoIA:false});
  await irA('ai');await irA('profile');await esperar(listo+" && !document.getElementById('consentPerfil').checked");

  // 3. Activación durante una condición de carrera: guardado en vuelo + nueva carga cuya respuesta es ANTERIOR al guardado.
  await interceptar([{urlPattern:'*perfil/consentimiento*',requestStage:'Request'},{urlPattern:'*/api/perfil',requestStage:'Response'}]);
  await clicReal('consentPerfil');const put=await esperarPausa(p=>p.request.url.includes('consentimiento'));
  u=await ui();assert.equal(u.check,false,'no se muestra autorizado antes de la confirmación');assert.ok(u.dis);assert.equal(u.msg,'Guardando…');
  await irA('ai');await irA('profile');const carga=await esperarPausa(p=>p.request.url.endsWith('/api/perfil'));   // respuesta calculada con NULL/FALSE
  await soltar(put);await esperar("document.getElementById('consentMsg').textContent==='Autorización guardada.'");
  u=await ui();assert.equal(u.check,true,'confirmado por el servidor');assert.ok(u.dis,'sigue deshabilitada mientras termina la carga');assert.equal(await bd(),true);
  await soltar(carga);await send('Fetch.disable');await esperar(listo);await pausa(500);
  u=await sincronizado();assert.equal(u.check,true,'la respuesta antigua de la carga NO desmarca lo confirmado');assert.equal(u.avisoActivo,true);assert.equal(await bd(),true);
  // Durante la carga tampoco se pueden enviar cambios.
  await interceptar([{urlPattern:'*/api/perfil',requestStage:'Response'}]);await irA('ai');await irA('profile');const c2=await esperarPausa(()=>true);
  await clicReal('consentPerfil');await pausa(400);assert.equal(await bd(),true,'un clic durante la carga no envía nada');assert.equal((await ui()).check,true);
  await soltar(c2);await send('Fetch.disable');await esperar(listo);
  await foto('fase9b2-consentimiento-carrera.png');
  ok('3. Activación en carrera: solo se muestra tras la confirmación; la carga antigua no la sobrescribe; sin clics durante la carga');

  // 4. Desactivación.
  await clicReal('consentPerfil');await esperar(listo+" && document.getElementById('consentMsg').textContent==='Autorización retirada.'");
  u=await sincronizado();assert.equal(u.check,false);assert.equal(await bd(),false);
  ok('4. Desactivación confirmada por el servidor; aviso «no autorizado» sincronizado');

  // 5a. Error de red al guardar: no se presenta como guardado; se ofrece consultar el estado real.
  await send('Network.setBlockedURLs',{urls:['*perfil/consentimiento*']});
  await clicReal('consentPerfil');await esperar("document.getElementById('consentMsg').classList.contains('msg-error')");
  await send('Network.setBlockedURLs',{urls:[]});
  u=await sincronizado();assert.equal(u.check,false);assert.match(u.msg,/No se guardó el cambio: no hubo conexión/);assert.ok(u.reintentar,'botón Reintentar visible');assert.equal(await bd(),false);
  // 5b. El servidor SÍ guardó pero la respuesta se perdió: la interfaz no lo da por guardado y Reintentar muestra el estado real.
  await interceptar([{urlPattern:'*perfil/consentimiento*',requestStage:'Response'}]);
  await clicReal('consentPerfil');const perdida=await esperarPausa(()=>true);
  assert.equal(await bd(),true,'el servidor ya guardó');
  await send('Fetch.failRequest',{requestId:perdida.requestId,errorReason:'ConnectionReset'});await send('Fetch.disable');
  await esperar("document.getElementById('consentMsg').classList.contains('msg-error')");
  u=await sincronizado();assert.equal(u.check,false,'no se presenta como guardado');assert.ok(u.reintentar);
  await foto('fase9b2-consentimiento-error.png');
  await clicReal('consentReintentar');await esperar(listo+" && document.getElementById('consentPerfil').checked");
  u=await sincronizado();assert.equal(u.check,true,'Reintentar muestra el estado real');assert.equal(u.reintentar,false);assert.equal(u.msg,'');
  ok('5. Fallo al guardar: nunca se muestra como guardado; Reintentar recupera el estado real (incluso si el servidor sí guardó)');

  // 6. Sincronización con «Mi alimentación» (en ambos sentidos) y sin activar nada al guardar alimentación.
  await esperar("!document.getElementById('alimentacionGuardar').disabled");
  await ev("document.querySelector('#alimentacionIA input[data-codigo=\"MANI\"]').click()");await ev("document.getElementById('alimentacionGuardar').click()");
  await esperar("document.getElementById('alimentacionMsg').textContent==='Tu información alimentaria se guardó.'");
  u=await sincronizado();assert.equal(u.avisoActivo,true);assert.equal(await bd(),true);
  await clicReal('consentPerfil');await esperar(listo+" && !document.getElementById('consentPerfil').checked");
  u=await sincronizado();assert.equal(u.avisoActivo,false);assert.equal(await bd(),false,'guardar alimentación no activa el consentimiento');
  await clicReal('consentPerfil');await esperar(listo+" && document.getElementById('consentPerfil').checked");
  ok('6. «Mi perfil» y «Mi alimentación» muestran siempre el mismo estado confirmado');

  // 7. Recarga de página después de guardar.
  const t0=Date.now();await send('Page.reload',{ignoreCache:true});
  await esperar("typeof apiFetch==='function' && !document.getElementById('appNav').classList.contains('hidden')",30000);
  await irA('profile');await esperar(listo+" && document.querySelectorAll('#alimentacionIA input').length>0");
  u=await sincronizado();assert.equal(u.check,true);assert.equal(await bd(),true);
  assert.equal(await ev("document.querySelector('#alimentacionIA input[data-codigo=\"MANI\"]').checked"),true);
  await foto('fase9b2-consentimiento-recarga.png');
  ok(`7. Recarga: el estado confirmado en PostgreSQL se recupera (recarga en ${Date.now()-t0} ms)`);

  const ev2=(await pool.query("SELECT accion FROM auditoria WHERE id_usuario=$1 AND accion LIKE 'consentimiento_perfil%' ORDER BY fecha",[cliente.id])).rows.map(x=>x.accion);
  assert.ok(ev2.length>=6,'cada cambio efectivo quedó auditado');
  assert.deepEqual(errores.filter(x=>!/ERR_BLOCKED|Failed to fetch|ERR_CONNECTION_RESET|TypeError/i.test(x)),[]);ok('Sin excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0,datos:'sintéticos en DB_TEST_NAME (esquema temporal)'}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
