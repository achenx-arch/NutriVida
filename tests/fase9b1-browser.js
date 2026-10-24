// FASE 9B-1 en navegador real (Chrome/Edge headless vía DevTools). Esquema temporal nv_test_* con los 6 productos
// reales (ingredientes declarados) + Ollama simulado que elige TODOS los candidatos recibidos (peor caso: si el
// backend dejara pasar un producto con maní, aparecería como tarjeta). Evidencias: docs/evidencias/fase9b1/.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-fase9b1';process.env.ENCRYPTION_KEY='ab'.repeat(32);
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth'),{ServicioIA,RESTRICCION,AVISO_RESTRICCION,GENERAL,SIN_COINCIDENCIAS_BASE,restriccionAplicada}=require('../src/services/iaService'),{OllamaProvider}=require('../src/services/ollamaProvider');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
const BARRAS='Barras Energéticas Naturales';
const PRODUCTOS=[
 [BARRAS,'Barras y Snacks','Productos nutritivos diseñados para aportar energía de forma rápida y saludable.',['Avena integral','Frutas deshidratadas (pasas, arándanos)','Frutos secos (almendras, maní, nueces)','Miel natural','Semillas (chía, linaza)']],
 ['Bebidas Funcionales (Energéticas Naturales)','Bebidas','Bebidas naturales elaboradas con té verde, jengibre, limón y miel.',['Jengibre','Limón','Miel','Té verde']],
 ['Bebidas Saludables (Jugos Naturales y Smoothies)','Bebidas','Bebidas naturales ricas en vitaminas.',['Agua purificada o leche vegetal','Endulzantes naturales (miel o Stevia)','Frutas frescas (naranja, piña, mango, fresa)']],
 ['Cereales Integrales para Desayuno','Panadería y Cereales','Granos integrales para mañanas nutritivas.',['Avena','Chía','Frutas','Miel','Quinoa']],
 ['Chips Saludables (Plátano, Yuca o Vegetales)','Barras y Snacks','Snacks crujientes horneados, sin grasas saturadas.',['Aceite vegetal mínimo','Plátano, yuca o vegetales','Sal natural']],
 ['Pan Integral Saludable','Panadería y Cereales','Pan elaborado con harinas integrales.',['Agua','Harina integral','Levadura','Semillas']],
];
const PROHIBIDAS=/100\s*%\s*segur|libre de al[eé]rgenos|apto para cel[ií]ac|garantizado sin trazas/i;
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const evid=path.join(__dirname,'../docs/evidencias/fase9b1');fs.mkdirSync(evid,{recursive:true});
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 const prompts=[];let modo='todos';
 // modo 'vacio' = lo que devolvió llama3.1 en Windows para "Soy alérgico al maní": ORIENTACION_GENERAL con [].
 const transporte=async(url,opts)=>{const req=JSON.parse(opts.body);prompts.push(req);const ids=modo==='vacio'?[]:(req.format.properties.productos.items?.properties?.id?.enum||[]);
  return {ok:true,json:async()=>({response:JSON.stringify({tipo:ids.length?'RECOMENDACION':'ORIENTACION_GENERAL',productos:ids.map(id=>({id}))})})};};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool,ia:new ServicioIA({ollamaProvider:new OllamaProvider({model:'modelo-prueba',transporte})})}),hash=await hashPassword('Clave12345');
  const admin=new Administrador({nombre:'Admin',correo:'admin@example.test',passwordHash:hash});await sistema.repositorios.usuarios.guardar(admin);
  await sistema.registrar({nombre:'Cliente 9B-1',correo:'cliente@example.test',password:'Clave12345'});
  const g=(tipo,datos)=>sistema.catalogoComercial.guardar(admin.id,tipo,null,datos);const cats={},ings={},ids={};
  for(const [nombre,cat,desc,lista] of PRODUCTOS){
   cats[cat]??=(await g('categorias',{nombre:cat})).id;const ingredientes=[];for(const n of lista)ingredientes.push({id:ings[n]??=(await g('ingredientes',{nombre:n})).id});
   const p=await g('productos',{nombre,categoriaId:cats[cat],precio:'12.50',estado:true,stockMinimo:1,descripcion:desc,ingredientes});ids[nombre]=p.id;
   await sistema.inventario.registrar(admin.id,{productoId:p.id,tipo:'AJUSTE',cantidad:5,motivo:'Navegador 9B-1'});}
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
  const consultar=async t=>{await ev("document.getElementById('respuestaBox').classList.add('hidden')");await campo('consultaTexto',t);await ev("document.getElementById('consultaForm').requestSubmit()");
   await esperar("!document.getElementById('respuestaBox').classList.contains('hidden') && document.getElementById('consultaBtn').textContent==='Enviar consulta'");};
  const respuesta=()=>ev("document.getElementById('respuestaBox').textContent");
  const tarjetas=()=>ev("[...document.querySelectorAll('#recomendacionesIA .ia-card h3')].map(h=>h.textContent)");
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await tam(1366,1000);
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");
  await campo('loginCorreo','cliente@example.test');await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");
  await ev(`document.querySelector('[data-vista="ai"]').click()`);

  // 1. Hallazgo crítico.
  await consultar('Soy alérgico al maní');
  await esperar("document.querySelectorAll('#recomendacionesIA .ia-card').length>0");
  let t=await tarjetas();assert.ok(!t.includes(BARRAS),'sin tarjeta de producto con maní');
  assert.ok(!prompts.at(-1).prompt.includes(BARRAS)&&!prompts.at(-1).format.properties.productos.items.properties.id.enum.includes(ids[BARRAS]),'Ollama no recibió el producto con maní');
  assert.ok((await respuesta()).includes(AVISO_RESTRICCION.ALERGIA));
  await foto('fase9b1-alergia-mani-desktop.png');ok('"Soy alérgico al maní": tarjetas sin Barras ('+t.length+'), Ollama no recibió el producto y se muestra el aviso de trazas');
  // 2. Producto pedido excluido.
  let n=prompts.length;await consultar('Soy alérgico al maní, ¿qué barras tienen?');
  assert.equal(await respuesta(),RESTRICCION.PRODUCTO_INCOMPATIBLE);assert.deepEqual(await tarjetas(),[]);assert.equal(prompts.length,n);
  await foto('fase9b1-producto-excluido.png');ok('Producto pedido incompatible: mensaje fijo, sin tarjetas y sin llamar al modelo');
  // 3. Alergia ambigua.
  await consultar('Tengo alergias');assert.equal(await respuesta(),RESTRICCION.AMBIGUA);assert.deepEqual(await tarjetas(),[]);assert.equal(prompts.length,n);
  await foto('fase9b1-alergia-ambigua.png');ok('Alergia ambigua: solicita el ingrediente, sin modelo');
  // 4. Información insuficiente.
  await consultar('Sin azúcar');assert.equal(await respuesta(),RESTRICCION.SIN_INFORMACION);assert.deepEqual(await tarjetas(),[]);assert.equal(prompts.length,n);
  await foto('fase9b1-sin-informacion.png');ok('"Sin azúcar": información insuficiente, sin modelo');
  // 5. Dieta.
  await consultar('Soy vegano, busco snacks');t=await tarjetas();assert.deepEqual(t,['Chips Saludables (Plátano, Yuca o Vegetales)']);
  assert.ok((await respuesta()).includes(AVISO_RESTRICCION.DIETA));ok('Dieta vegana: solo el producto permitido y aviso de no certificación');
  // 6. Regresión sin restricciones.
  await consultar('Busco bebidas');t=await tarjetas();assert.equal(t.length,2);assert.ok(!(await respuesta()).includes(AVISO_RESTRICCION.ALERGIA));
  ok('Regresión: "Busco bebidas" conserva sus 2 tarjetas y no muestra aviso');
  // 6b. Revisión manual en Windows: el modelo no elige productos → se explica el filtrado (nunca el texto general).
  modo='vacio';
  for(const [q,esperado] of [['Soy alérgico al maní',restriccionAplicada({incompatibles:1,noVerificables:2,categorias:['Bebidas','Panadería y Cereales']})],
    ['Busco algo sin gluten',restriccionAplicada({incompatibles:0,noVerificables:3,categorias:['Barras y Snacks','Bebidas']})],
    ['Quiero productos veganos',restriccionAplicada({incompatibles:3,noVerificables:1,categorias:['Barras y Snacks','Panadería y Cereales']})]]){
   n=prompts.length;await consultar(q);const t2=await respuesta();
   assert.equal(t2,esperado,q);assert.notEqual(t2,GENERAL);assert.ok(!t2.startsWith(SIN_COINCIDENCIAS_BASE));assert.deepEqual(await tarjetas(),[]);assert.equal(prompts.length,n+1);
   assert.ok(!prompts.at(-1).prompt.includes(BARRAS),'nunca el producto con maní');}
  await foto('fase9b1-restriccion-aplicada.png');
  await consultar('¿Qué bebidas tienen disponibles?');assert.equal((await tarjetas()).length,2,'respaldo sin restricción');modo='todos';
  ok('Modelo sin elección: "Soy alérgico al maní", "sin gluten" y "veganos" explican el filtrado; bebidas conserva 2 tarjetas');
  // 7. Responsive con la respuesta de restricción.
  await consultar('Soy alérgico al maní, quiero bebidas');await tam(390,844,true);await pausa(250);
  assert.ok(await ev('document.documentElement.scrollWidth<=window.innerWidth'),'sin desborde horizontal');
  await foto('fase9b1-alergia-movil.png');await tam(1366,1000);ok('Responsive: 390 px sin desborde');
  // 8. Sin frases prohibidas ni errores.
  assert.doesNotMatch(await ev('document.body.innerText'),PROHIBIDAS);
  assert.deepEqual(errores,[]);ok('Sin frases de garantía, sin excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
