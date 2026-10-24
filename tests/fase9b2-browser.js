// FASE 9B-2 en navegador real (Chrome/Edge headless vía DevTools): sección «Mi alimentación» y su efecto en NutriVida AI.
// Esquema temporal nv_test_*, cliente y catálogo SINTÉTICOS (mismos ingredientes que el catálogo real) e IA simulada que
// elige TODOS los candidatos recibidos (peor caso). Evidencias: docs/evidencias/fase9b2/.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-fase9b2';process.env.ENCRYPTION_KEY='ab'.repeat(32);
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth'),{ServicioIA,AVISO_RESTRICCION}=require('../src/services/iaService'),{OllamaProvider}=require('../src/services/ollamaProvider');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
const BARRAS='Barras Energéticas Naturales';
const PRODUCTOS=[
 [BARRAS,'Barras y Snacks','Productos nutritivos diseñados para aportar energía.',['Avena integral','Frutas deshidratadas (pasas, arándanos)','Frutos secos (almendras, maní, nueces)','Miel natural']],
 ['Bebidas Funcionales (Energéticas Naturales)','Bebidas','Bebidas naturales elaboradas con té verde, jengibre, limón y miel.',['Jengibre','Limón','Miel','Té verde']],
 ['Bebidas Saludables (Jugos Naturales y Smoothies)','Bebidas','Bebidas naturales ricas en vitaminas.',['Agua purificada o leche vegetal','Frutas frescas (naranja, piña, mango, fresa)']],
 ['Cereales Integrales para Desayuno','Panadería y Cereales','Granos integrales para mañanas nutritivas.',['Avena','Chía','Frutas','Miel','Quinoa']],
 ['Chips Saludables (Plátano, Yuca o Vegetales)','Barras y Snacks','Snacks crujientes horneados.',['Aceite vegetal mínimo','Plátano, yuca o vegetales','Sal natural']],
];
const AVISO_SIN='Las preferencias y restricciones guardadas no se utilizarán automáticamente en las recomendaciones mientras no autorices el uso del contexto de tu perfil. Puedes indicar tus restricciones directamente en cada consulta.';
const PROHIBIDAS=/100\s*%\s*segur|libre de al[eé]rgenos|apto para cel[ií]ac|garantizado sin trazas/i;
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const evid=path.join(__dirname,'../docs/evidencias/fase9b2');fs.mkdirSync(evid,{recursive:true});
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 const prompts=[];
 const transporte=async(url,opts)=>{const req=JSON.parse(opts.body);prompts.push(req);const ids=req.format.properties.productos.items?.properties?.id?.enum||[];
  return {ok:true,json:async()=>({response:JSON.stringify({tipo:ids.length?'RECOMENDACION':'ORIENTACION_GENERAL',productos:ids.map(id=>({id}))})})};};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool,ia:new ServicioIA({ollamaProvider:new OllamaProvider({model:'modelo-prueba',transporte})})}),hash=await hashPassword('Clave12345');
  const admin=new Administrador({nombre:'Admin',correo:'admin@example.test',passwordHash:hash});await sistema.repositorios.usuarios.guardar(admin);
  const cliente=await sistema.registrar({nombre:'Cliente 9B-2',correo:'cliente@example.test',password:'Clave12345'});
  const g=(tipo,datos)=>sistema.catalogoComercial.guardar(admin.id,tipo,null,datos);const cats={},ings={};
  for(const [nombre,cat,desc,lista] of PRODUCTOS){
   cats[cat]??=(await g('categorias',{nombre:cat})).id;const ingredientes=[];for(const n of lista)ingredientes.push({id:ings[n]??=(await g('ingredientes',{nombre:n})).id});
   const p=await g('productos',{nombre,categoriaId:cats[cat],precio:'12.50',estado:true,stockMinimo:1,descripcion:desc,ingredientes});
   await sistema.inventario.registrar(admin.id,{productoId:p.id,tipo:'AJUSTE',cantidad:5,motivo:'Navegador 9B-2'});}
  server=crearApp(sistema).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+perfil,...(process.env.CHROME_ARGS||'').split(' ').filter(Boolean),'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(perfil,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(portFile);i++)await pausa(100);assert.ok(fs.existsSync(portFile));
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let sec=0;const pend=new Map(),errores=[];
  ws.addEventListener('message',ev=>{const d=JSON.parse(ev.data);if(d.id){const r=pend.get(d.id);pend.delete(d.id);if(r)d.error?r.reject(new Error(d.error.message)):r.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown')errores.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]||'Excepción');else if(d.method==='Log.entryAdded'&&d.params.entry.source==='security'&&d.params.entry.level==='error')errores.push('CSP: '+d.params.entry.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++sec;const t=setTimeout(()=>{pend.delete(i);reject(new Error('CDP '+method));},15000);pend.set(i,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' :: '+x);return r.result.value;};
  const esperar=async(x,ms=8000)=>{const fin=Date.now()+ms;while(Date.now()<fin){if(await ev(x))return;await pausa(80);}throw new Error('No se cumplió: '+x+' '+JSON.stringify(errores));};
  const campo=(i,v)=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(i)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input'));})()`);
  const tam=(w,h,mobile=false)=>send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile});
  const foto=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evid,n),Buffer.from(s.data,'base64'));};
  // Clic REAL del ratón (no element.click()).
  const clicReal=async sel=>{const c=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   for(const type of ['mouseMoved','mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,x:c.x,y:c.y,button:'left',clickCount:1});};
  const casilla=(grupo,codigo)=>`#alimentacionIA input[data-grupo="${grupo}"][data-codigo="${codigo}"]`;
  const marcadas=()=>ev("[...document.querySelectorAll('#alimentacionIA input:checked')].map(i=>i.dataset.grupo+':'+i.dataset.codigo).sort()");
  const listoAlim="!document.getElementById('alimentacionGuardar').disabled && document.querySelectorAll('#alimentacionIA input').length>0 && !document.getElementById('consentPerfil').disabled && document.getElementById('alimentacionMsg').textContent===''";
  // Abrir «Mi perfil» y esperar a que TERMINE la carga (GET /perfil y luego GET /perfil/alimentacion): un clic antes de
  // que llegue la respuesta del GET podría verse sobrescrito por ese estado anterior.
  const abrirPerfil=async()=>{await ev("document.getElementById('alimentacionMsg').textContent='(esperando carga)'");
   await ev(`document.querySelector('[data-vista="profile"]').click()`);await esperar(listoAlim);};
  const consultar=async t=>{await ev("document.getElementById('respuestaBox').classList.add('hidden')");await campo('consultaTexto',t);await ev("document.getElementById('consultaForm').requestSubmit()");
   await esperar("!document.getElementById('respuestaBox').classList.contains('hidden') && document.getElementById('consultaBtn').textContent==='Enviar consulta'");};
  const tarjetas=()=>ev("[...document.querySelectorAll('#recomendacionesIA .ia-card h3')].map(h=>h.textContent)");
  const filasBD=async()=>(await pool.query("SELECT tipo,descripcion,version_cifrado FROM preferencias_cliente WHERE id_usuario=$1 AND tipo IN ('PREFERENCIA_ALIMENTARIA','RESTRICCION_DIETETICA','ALERGENO_DECLARADO') ORDER BY tipo",[cliente.id])).rows;
  const consentBD=async()=>(await pool.query('SELECT autoriza_contexto_ia FROM perfil_cliente WHERE id_usuario=$1',[cliente.id])).rows[0]?.autoriza_contexto_ia??null;
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await tam(1366,1000);
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");
  await campo('loginCorreo','cliente@example.test');await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");
  // 1. Carga desde el servidor.
  await abrirPerfil();
  const op=await ev("({p:document.querySelectorAll('#alimPreferencias input').length,r:document.querySelectorAll('#alimRestricciones input').length,a:document.querySelectorAll('#alimAlergenos input').length,dis:[...document.querySelectorAll('#alimentacionIA input:disabled')].map(i=>i.dataset.codigo).sort()})");
  assert.deepEqual(op,{p:4,r:7,a:9,dis:['HUEVO','MARISCOS','PESCADO','SIN_AZUCAR']});assert.deepEqual(await marcadas(),[]);
  await esperar("!document.getElementById('alimentacionEstado').classList.contains('hidden')");
  assert.equal(await ev("document.getElementById('alimentacionEstado').textContent"),AVISO_SIN);
  ok('«Mi alimentación» carga opciones del servidor (4/7/9), deshabilita las no soportadas y muestra el aviso sin consentimiento');
  // 2. Selección con clics reales y guardado.
  await clicReal(casilla('alergenos','MANI'));await clicReal(casilla('preferencias','FRUTAS'));await clicReal(casilla('alergenos','PESCADO'));
  assert.deepEqual(await marcadas(),['alergenos:MANI','preferencias:FRUTAS'],'una opción deshabilitada no se puede marcar');
  await clicReal('#alimentacionGuardar');await esperar("document.getElementById('alimentacionMsg').textContent==='Tu información alimentaria se guardó.'");
  let f=await filasBD();assert.deepEqual(f.map(x=>x.tipo),['ALERGENO_DECLARADO','PREFERENCIA_ALIMENTARIA']);assert.ok(f.every(x=>x.version_cifrado===2&&!/MANI|FRUTAS/.test(x.descripcion)));
  assert.notEqual(await consentBD(),true,'guardar no activa el consentimiento');
  await foto('fase9b2-mi-alimentacion.png');
  ok('Clics reales: guardado cifrado en PostgreSQL; el consentimiento sigue sin activarse');
  // 3. Persistencia tras recargar.
  await send('Page.reload');await esperar("typeof apiFetch==='function' && !document.getElementById('appNav').classList.contains('hidden')");
  await abrirPerfil();
  assert.deepEqual(await marcadas(),['alergenos:MANI','preferencias:FRUTAS']);ok('Recarga: la selección se recupera desde PostgreSQL');
  // 4. Error de red al guardar: no se pierde la selección.
  await clicReal(casilla('restricciones','VEGANO'));
  await ev("window.__fetchOriginal=window.fetch;window.fetch=(u,o)=>String(u).includes('/perfil/alimentacion')&&o&&o.method==='PUT'?Promise.reject(new TypeError('Failed to fetch')):window.__fetchOriginal(u,o)");
  await clicReal('#alimentacionGuardar');await esperar("document.getElementById('alimentacionMsg').classList.contains('msg-error')");
  assert.match(await ev("document.getElementById('alimentacionMsg').textContent"),/No se guardó: no hubo conexión con el servidor/);
  assert.deepEqual(await marcadas(),['alergenos:MANI','preferencias:FRUTAS','restricciones:VEGANO'],'la selección sigue en pantalla');
  assert.equal((await filasBD()).length,2,'nada se guardó');
  await ev("window.fetch=window.__fetchOriginal");await clicReal(casilla('restricciones','VEGANO'));
  await clicReal('#alimentacionGuardar');await esperar("document.getElementById('alimentacionMsg').textContent==='Tu información alimentaria se guardó.'");
  ok('Error al guardar: mensaje claro, selección conservada, nada escrito; el reintento guarda');
  // 5. Recomendaciones SIN consentimiento: lo guardado NO se aplica.
  await ev(`document.querySelector('[data-vista="ai"]').click()`);
  await consultar('¿Qué productos tienen?');assert.ok((await tarjetas()).includes(BARRAS),'sin consentimiento no se filtra por lo guardado');
  ok('Sin consentimiento de perfil: las restricciones guardadas no se aplican');
  // 6. Con consentimiento: se aplica (Barras con maní nunca llega a Ollama ni a una tarjeta).
  await abrirPerfil();
  await clicReal('#consentPerfil');await esperar("document.getElementById('consentPerfil').checked && document.getElementById('alimentacionEstado').classList.contains('activo')");
  assert.equal(await consentBD(),true);
  await foto('fase9b2-consentimiento-activo.png');
  await ev(`document.querySelector('[data-vista="ai"]').click()`);
  await consultar('¿Qué productos tienen?');const t=await tarjetas();
  assert.ok(t.length>0&&!t.includes(BARRAS));assert.ok(!prompts.at(-1).prompt.includes(BARRAS)&&!/MANI|alergeno/i.test(prompts.at(-1).prompt));
  assert.ok((await ev("document.getElementById('respuestaBox').textContent")).includes(AVISO_RESTRICCION.ALERGIA));
  await foto('fase9b2-recomendacion-con-perfil.png');
  ok('Con consentimiento: Barras (maní) excluida antes de Ollama; tarjetas permitidas con aviso de trazas');
  // 7. Revocar: deja de aplicarse en la siguiente consulta.
  await abrirPerfil();
  await clicReal('#consentPerfil');await esperar("!document.getElementById('consentPerfil').checked && !document.getElementById('alimentacionEstado').classList.contains('activo')");
  await ev(`document.querySelector('[data-vista="ai"]').click()`);await consultar('¿Qué productos tienen?');assert.ok((await tarjetas()).includes(BARRAS));
  ok('Revocación: la siguiente consulta ya no usa los datos guardados (que se conservan)');
  // 8. Responsive y sin errores.
  await abrirPerfil();await tam(390,844,true);await pausa(250);
  assert.ok(await ev('document.documentElement.scrollWidth<=window.innerWidth'),'sin desborde horizontal');
  await ev("document.getElementById('alimentacionIA').scrollIntoView()");await foto('fase9b2-mi-alimentacion-movil.png');await tam(1366,1000);
  assert.doesNotMatch(await ev('document.body.innerText'),PROHIBIDAS);assert.deepEqual(errores,[]);
  ok('Responsive 390 px sin desborde; sin frases de garantía, excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0,datos:'sintéticos en DB_TEST_NAME (esquema temporal)'}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
