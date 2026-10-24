// Tarjetas de NutriVida AI en navegador real (Chrome/Edge headless vía DevTools). Esquema temporal + IA simulada
// determinista (elige todos los candidatos); imágenes reales de public/images/productos/.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
process.env.JWT_SECRET='navegador-ia-tarjetas';process.env.ENCRYPTION_KEY='ab'.repeat(32);
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth'),{ServicioIA,MEDICA}=require('../src/services/iaService'),{OllamaProvider}=require('../src/services/ollamaProvider');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 let llamadas=0;
 const transporte=async(url,opts)=>{llamadas++;const ids=JSON.parse(opts.body).format.properties.productos.items?.properties?.id?.enum||[];return {ok:true,json:async()=>({response:JSON.stringify({tipo:'RECOMENDACION',productos:ids.slice(0,3).map(id=>({id}))})})};};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool,ia:new ServicioIA({ollamaProvider:new OllamaProvider({model:'modelo-prueba',transporte})})}),hash=await hashPassword('Clave12345');
  const admin=new Administrador({nombre:'Admin',correo:'admin@example.test',passwordHash:hash});await sistema.repositorios.usuarios.guardar(admin);
  await sistema.registrar({nombre:'Cliente tarjetas',correo:'cliente@example.test',password:'Clave12345'});
  const cat=(await sistema.catalogoComercial.guardar(admin.id,'categorias',null,{nombre:'Barras y Snacks'})).id;
  for(const [nombre,img,desc] of [['Barras Energéticas Naturales','/images/productos/barras-energeticas-naturales.webp','Productos nutritivos de prueba.'],
    ['Cereales Integrales para Desayuno','/images/productos/cereales-integrales-para-desayuno.webp','Granos integrales para mañanas nutritivas.'],
    ['<img src=x onerror="window.__xss=1">',null,'<script>window.__xss=2</script>']]){
   const p=await sistema.catalogoComercial.guardar(admin.id,'productos',null,{nombre,categoriaId:cat,precio:'10.50',estado:true,stockMinimo:1,descripcion:desc,...(img?{imagenUrl:img}:{})});
   await sistema.inventario.registrar(admin.id,{productoId:p.id,tipo:'AJUSTE',cantidad:5,motivo:'Navegador tarjetas'});}
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
  const foto=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../docs/evidencias',n),Buffer.from(s.data,'base64'));};
  const consultar=async t=>{await campo('consultaTexto',t);await ev("document.getElementById('consultaForm').requestSubmit()");await esperar("!document.getElementById('respuestaBox').classList.contains('hidden') && document.getElementById('consultaBtn').textContent==='Enviar consulta'");};
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await tam(1366,1000);
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");
  await campo('loginCorreo','cliente@example.test');await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");
  await ev(`document.querySelector('[data-vista="ai"]').click()`);
  await consultar('Recomiéndame un snack');
  await esperar("document.querySelectorAll('#recomendacionesIA .ia-card').length===3 && [...document.querySelectorAll('#recomendacionesIA img')].every(i=>i.complete&&i.naturalWidth>0)");
  const tarjetas=await ev("[...document.querySelectorAll('#recomendacionesIA .ia-card')].map(c=>({img:c.querySelector('img').getAttribute('src'),nombre:c.querySelector('h3').textContent,h3hijos:c.querySelector('h3').children.length,cat:c.querySelector('.product-category').textContent,precio:c.querySelector('.product-price').textContent,disp:c.querySelector('.availability').textContent,desc:c.querySelector('.product-desc')?.textContent}))");
  assert.ok(tarjetas.every(t=>t.cat==='Barras y Snacks'&&t.precio==='Q 10.50'&&t.disp==='Disponible'&&t.h3hijos===0));
  assert.ok(tarjetas.some(t=>t.img==='/images/productos/barras-energeticas-naturales.webp'));
  const x=tarjetas.find(t=>t.nombre.startsWith('<img'));assert.equal(x.img,'/images/producto.svg');assert.equal(x.desc,'<script>window.__xss=2</script>');
  assert.equal(await ev('window.__xss??null'),null);
  ok('Respuesta en vivo con 3 tarjetas: imagen, nombre, descripción, categoría, precio y disponibilidad del backend');
  ok('XSS como texto y producto sin imagen con fallback producto.svg');
  await foto('ia-tarjetas-desktop.png');
  await tam(390,844,true);await pausa(250);
  assert.ok(await ev('document.documentElement.scrollWidth<=window.innerWidth'),'sin desborde horizontal');
  assert.equal(await ev("getComputedStyle(document.getElementById('recomendacionesIA')).gridTemplateColumns.split(' ').length"),1);
  await foto('ia-tarjetas-movil.png');ok('Responsive: 1 columna a 390 px sin desborde');
  await tam(1366,1000);const antes=llamadas;await consultar('¿Qué medicamento debo tomar?');
  assert.equal(await ev("document.getElementById('respuestaBox').textContent"),MEDICA);
  assert.equal(await ev("document.getElementById('recomendacionesIA').classList.contains('hidden') && document.querySelectorAll('#recomendacionesIA .ia-card').length===0"),true);
  assert.equal(llamadas,antes);ok('Consulta médica: mensaje seguro, sin tarjetas y sin llamar al modelo');
  await esperar("document.getElementById('historialList').textContent.includes('Opciones del catálogo')");
  assert.equal(await ev("document.querySelectorAll('#historialList img, #historialList .ia-card').length"),0);ok('Historial solo con texto');
  assert.deepEqual(errores,[]);ok('Sin excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
