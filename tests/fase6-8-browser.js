// FASES 6–8: recorrido real en navegador (Chrome/Edge headless vía DevTools Protocol).
// Datos sintéticos en un esquema temporal nv_test_* de DB_TEST_NAME; no toca nutrivida_db.
// NutriVida AI usa Ollama REAL (OLLAMA_BASE_URL/OLLAMA_MODEL de .env); si no está disponible,
// esa comprobación se reporta como OMITIDA, nunca como aprobada. El error controlado con
// Ollama apagado se verifica siempre con un segundo servidor sin proveedor alcanzable.
// Opcional: CHROME_PATH=<ejecutable> y CHROME_ARGS="--no-sandbox ..." para otros sistemas.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-fase6-8-sintetico';process.env.ENCRYPTION_KEY='cd'.repeat(32);
const env=require('../src/config/env');
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador,Empleado}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth');
const {ServicioIA}=require('../src/services/iaService'),{OllamaProvider}=require('../src/services/ollamaProvider');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
const evid=n=>path.join(__dirname,'../docs/evidencias',n);
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH) para esta prueba.');
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,serverOff,browser,ws,creados=false;
 const resultados=[];const ok=(fase,nombre)=>{resultados.push({fase,nombre,estado:'APROBADA'});console.log(`✔ [${fase}] ${nombre}`);};
 const omitida=(fase,nombre,motivo)=>{resultados.push({fase,nombre,estado:'OMITIDA',motivo});console.log(`↷ [${fase}] ${nombre} — OMITIDA: ${motivo}`);};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool}),hash=await hashPassword('Clave12345');
  const admin=new Administrador({nombre:'Admin navegador',correo:'admin@example.test',passwordHash:hash}),empleado=new Empleado({nombre:'Empleado navegador',correo:'empleado@example.test',passwordHash:hash});
  await sistema.repositorios.usuarios.guardar(admin);await sistema.repositorios.usuarios.guardar(empleado);
  await sistema.registrar({nombre:'Cliente Uno',correo:'cliente@example.test',password:'Clave12345'});
  await sistema.registrar({nombre:'Cliente Dos',correo:'cliente2@example.test',password:'Clave12345'});
  const cat=await sistema.catalogoComercial.guardar(admin.id,'categorias',null,{nombre:'Snacks sintéticos'});
  for(const [nombre,precio,stock] of [['Granola sintética','25.00',10],['Barra sintética','10.00',6]]){
   const p=await sistema.catalogoComercial.guardar(admin.id,'productos',null,{nombre,categoriaId:cat.id,precio,estado:true,stockMinimo:2,descripcion:'Ficha sintética de prueba.'});
   await sistema.inventario.registrar(admin.id,{productoId:p.id,tipo:'AJUSTE',cantidad:stock,motivo:'Stock sintético navegador'});
  }
  server=crearApp(sistema).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const sistemaOff=crearSistema({pool,ia:new ServicioIA({ollamaProvider:new OllamaProvider({baseUrl:'http://127.0.0.1:9',model:env.ollamaModel||'modelo-apagado',timeoutMs:2000})})});
  serverOff=crearApp(sistemaOff).listen(0,'127.0.0.1');await new Promise(r=>serverOff.once('listening',r));const baseOff=`http://127.0.0.1:${serverOff.address().port}`;
  const extra=(process.env.CHROME_ARGS||'').split(' ').filter(Boolean);
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+dir,...extra,'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(dir,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(portFile);i++)await pausa(100);assert.ok(fs.existsSync(portFile),'Chrome no inició DevTools');
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(5000)})).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let sec=0;const pendientes=new Map(),errores=[];
  ws.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const r=pendientes.get(d.id);pendientes.delete(d.id);if(r)d.error?r.reject(new Error(d.error.message)):r.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown')errores.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]||'Excepción JavaScript');else if(d.method==='Log.entryAdded'&&d.params.entry.source==='security'&&d.params.entry.level==='error')errores.push('Bloqueo CSP');});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++sec;const timer=setTimeout(()=>{pendientes.delete(i);reject(new Error('Tiempo de espera CDP: '+method));},15000);pendientes.set(i,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:i,method,params}));});
  const evaluar=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('Error en comprobación de interfaz: '+r.exceptionDetails.text+' :: '+expression);return r.result.value;};
  const esperar=async(expr,ms=8000)=>{const fin=Date.now()+ms;while(Date.now()<fin){if(await evaluar(expr))return;await pausa(80);}throw new Error('No se cumplió: '+expr+'; errores JS: '+JSON.stringify(errores));};
  const campo=(i,v)=>evaluar(`(()=>{const e=document.getElementById(${JSON.stringify(i)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input'));})()`);
  const click=i=>evaluar(`document.getElementById(${JSON.stringify(i)}).click()`);
  const nav=v=>evaluar(`document.querySelector('[data-vista="${v}"]').click()`);
  const login=async correo=>{await campo('loginCorreo',correo);await campo('loginPassword','Clave12345');await evaluar("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");};
  const logout=async()=>{await click('logoutBtn');await esperar("document.getElementById('appNav').classList.contains('hidden')");};
  const foto=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.dirname(evid(n)),{recursive:true});fs.writeFileSync(evid(n),Buffer.from(s.data,'base64'));};
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1366,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function' && !!document.getElementById('loginForm')");

  // ---------- FASE 6: CLIENTE Login → Catálogo → Agregar → Mi carrito → Crear pedido → Mis pedidos
  await login('cliente@example.test');
  const menu=await evaluar("[...document.querySelectorAll('#appNav button')].map(b=>b.textContent)");
  assert.deepEqual(menu,['Inicio','Catálogo','Mi carrito','Mis pedidos','Mi consumo','NutriVida AI','Mi perfil']);
  assert.ok(await evaluar("!document.getElementById('logoutBtn').classList.contains('hidden')"));ok('F6','Navegación CLIENTE completa (7 vistas + Cerrar sesión)');
  await nav('catalog');await esperar("document.querySelectorAll('.product-card').length===2");
  await evaluar("[...document.querySelectorAll('.product-card')].find(c=>c.textContent.includes('Granola')).querySelector('button:last-of-type').click()");
  await esperar("document.getElementById('catalogMsg').textContent.includes('agregado')");
  await evaluar("[...document.querySelectorAll('.product-card')].find(c=>c.textContent.includes('Granola')).querySelector('button:last-of-type').click()");
  await evaluar("[...document.querySelectorAll('.product-card')].find(c=>c.textContent.includes('Barra')).querySelector('button:last-of-type').click()");ok('F6','Catálogo → Agregar al carrito');
  await nav('cart');await esperar("document.querySelectorAll('#cartItemsList article').length===2");
  assert.equal(await evaluar("document.getElementById('cartTotalText').textContent"),'Q 60.00');await foto('fase6-carrito.png');ok('F6','Mi carrito muestra 2 productos y total Q 60.00');
  await click('cartCheckoutBtn');await esperar("!document.getElementById('ordersPanel').classList.contains('hidden') && document.querySelectorAll('#pedidosList article').length===1");
  const pid=await evaluar("document.querySelector('#pedidosList article').dataset.pedido");
  assert.ok(await evaluar("document.querySelector('#pedidosList article').textContent.includes('PENDIENTE') && document.querySelector('#pedidosList article').textContent.includes('Q 60.00')"));
  assert.deepEqual(await evaluar("[...document.querySelectorAll('#pedidosList article button')].map(b=>b.textContent)"),['Ver detalles','Cancelar']);
  await foto('fase6-mis-pedidos.png');ok('F6',`Crear pedido → Mis pedidos (#${pid} PENDIENTE, sin controles operativos)`);
  await logout();await login('cliente2@example.test');await nav('cart');await esperar("document.getElementById('cartTotalText').textContent==='Q 0.00'");
  await nav('orders');await esperar("document.getElementById('pedidosList').textContent.includes('No hay pedidos')");ok('F6','Carrito y pedidos aislados entre cuentas');await logout();

  // ---------- FASE 6: EMPLEADO y ADMINISTRADOR → Pedidos → CONFIRMADO → EN_PREPARACION → LISTO → ENTREGADO
  const avanzar=async(estado)=>{await evaluar(`[...document.querySelector('#pedidosList [data-pedido="${pid}"]').querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(estado)}).click()`);await esperar(`document.querySelector('#pedidosList [data-pedido="${pid}"]')?.textContent.includes(${JSON.stringify(estado)}) && document.getElementById('pedidosMsg').textContent.includes('actualizado')`);};
  await login('empleado@example.test');assert.deepEqual(await evaluar("[...document.querySelectorAll('#appNav button')].map(b=>b.textContent)"),['Catálogo','Inventario','Pedidos']);
  await nav('orders');await esperar(`!!document.querySelector('#pedidosList [data-pedido="${pid}"]')`);
  await avanzar('CONFIRMADO');await avanzar('EN_PREPARACION');ok('F6','EMPLEADO: Pedidos → CONFIRMADO → EN_PREPARACION');await logout();
  await login('admin@example.test');await nav('orders');await esperar(`!!document.querySelector('#pedidosList [data-pedido="${pid}"]')`);
  await avanzar('LISTO');await avanzar('ENTREGADO');await foto('fase6-gestion-pedidos.png');
  assert.equal(await evaluar(`[...document.querySelector('#pedidosList [data-pedido="${pid}"]').querySelectorAll('button')].map(b=>b.textContent).join('|')`),'Ver detalles');
  ok('F6','ADMINISTRADOR: LISTO → ENTREGADO; sin acciones tras ENTREGADO');await logout();

  // ---------- FASE 7: CLIENTE → Mi consumo → pedido entregado visible
  await login('cliente@example.test');await nav('consumption');await esperar("document.querySelectorAll('#consumoList article').length===2");
  const consumo=await evaluar("document.getElementById('consumoList').textContent");
  assert.ok(consumo.includes('Granola sintética')&&consumo.includes('2 unidades · 1 compras')&&consumo.includes('Snacks sintéticos')&&consumo.includes('Último pedido (fecha de creación)'));
  assert.ok(await evaluar("document.getElementById('consumoResumen').textContent.startsWith('1 compras · 3 unidades')"));
  await foto('fase7-mi-consumo.png');ok('F7','Mi consumo: pedido ENTREGADO visible; 1 compra global con 2 productos');

  // ---------- FASE 8: CLIENTE → NutriVida AI → consulta → respuesta real Ollama
  const consultar=async texto=>{await nav('ai');await campo('consultaTexto',texto);await evaluar("document.getElementById('consultaForm').requestSubmit()");
   await esperar("!document.getElementById('respuestaBox').classList.contains('hidden') && document.getElementById('consultaBtn').textContent==='Enviar consulta'",Math.max(env.ollamaTimeoutMs,15000)+10000);
   return evaluar("({texto:document.getElementById('respuestaBox').textContent,error:document.getElementById('respuestaBox').classList.contains('error-box'),tarjetas:[...document.querySelectorAll('#recomendacionesIA .ia-card h3')].map(h=>h.textContent)})");};
  const salud=await new OllamaProvider().comprobarSalud();
  if(salud.disponible&&salud.tieneModeloConfigurado){
   const inicio=Date.now();const r=await consultar('¿Qué snack me recomiendas para la mañana?');
   assert.equal(r.error,false,'Ollama real devolvió error: '+r.texto);
   assert.match(r.texto,/profesional de la salud|explorar el catálogo/);
   if(r.texto.startsWith('Opciones del catálogo'))assert.ok(/Granola sintética|Barra sintética/.test(r.texto));
   // Tarjetas: solo productos resueltos en PostgreSQL y mencionados en el texto; sin recomendación → sin tarjetas.
   // Consulta específica ("snack" coincide con la categoría "Snacks sintéticos"): con el respaldo del backend
   // debe terminar SIEMPRE con al menos una tarjeta, aunque el modelo devuelva ORIENTACION_GENERAL con [].
   assert.ok(r.texto.startsWith('Opciones del catálogo'),'Consulta específica sin recomendación: '+r.texto);
   assert.ok(r.tarjetas.length>0);for(const n of r.tarjetas)assert.ok(r.texto.includes(n),'Tarjeta no mencionada: '+n);
   await esperar("document.getElementById('historialList').textContent.includes('RESPONDIDA')");await foto('fase8-nutrivida-ai-ollama.png');
   ok('F8',`NutriVida AI con Ollama REAL (${env.ollamaModel}, ${Date.now()-inicio} ms, ${r.tarjetas.length} tarjeta(s)): "${r.texto.slice(0,90)}"`);
  }else omitida('F8','NutriVida AI con Ollama REAL',!salud.disponible?`OLLAMA_NO_DISPONIBLE en ${env.ollamaBaseUrl}`:`modelo "${env.ollamaModel||'(vacío)'}" no instalado`);
  await logout();

  // ---------- FASE 8: Ollama apagado → error controlado; el resto del sistema sigue
  await send('Page.navigate',{url:baseOff});await esperar("typeof apiFetch==='function' && !!document.getElementById('loginForm')");
  await login('cliente@example.test');const rOff=await consultar('Hola');
  assert.equal(rOff.error,true);assert.match(rOff.texto,/no está disponible temporalmente/);assert.doesNotMatch(rOff.texto,/127\.0\.0\.1|ECONNREFUSED|stack/i);
  await esperar("document.getElementById('historialList').textContent.includes('ERROR')");await foto('fase8-ollama-apagado.png');
  await nav('orders');await esperar("document.querySelectorAll('#pedidosList article').length===1");await nav('consumption');await esperar("document.querySelectorAll('#consumoList article').length===2");
  ok('F8','Ollama apagado: error controlado; pedidos y consumo siguen disponibles');
  assert.deepEqual(errores,[]);ok('F6-8','Sin excepciones JavaScript ni bloqueos CSP');
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(500);}for(const s of [server,serverOff])if(s)await new Promise(r=>s.close(r));await pool.end();
  try{if(creados){assert.match(schema,/^nv_test_[a-f0-9]+$/);await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  assert.ok(path.basename(dir).startsWith('nv-browser-'));fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  const t={total:resultados.length,aprobadas:resultados.filter(r=>r.estado==='APROBADA').length,omitidas:resultados.filter(r=>r.estado==='OMITIDA').length};
  console.log(JSON.stringify({navegador:path.basename(chrome||''),...t,fallidas:process.exitCode?1:0,datos:'sintéticos en DB_TEST_NAME (esquema temporal)'}));
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
