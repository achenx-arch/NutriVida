// Imágenes del catálogo en navegador real (Chrome/Edge headless vía DevTools). Datos sintéticos en esquema temporal.
// Verifica selector con vista previa, tarjetas con imagen, fallback, XSS y diseño responsivo (3/2/1 columnas).
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const DIR=fs.mkdtempSync(path.join(os.tmpdir(),'nv-img-browser-'));
process.env.IMAGENES_PRODUCTOS_DIR=DIR;process.env.JWT_SECRET='navegador-imagenes-sintetico';process.env.ENCRYPTION_KEY='ef'.repeat(32);
const express=require('express');
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones'),{crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador}=require('../src/domain/modelos'),{hashPassword}=require('../src/security/auth');
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
// PNG sintético 160x120 verde (sin dependencias).
function png(w,h,[r,g,b]){const crc=(buf)=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let x=~0;for(const v of buf)x=t[(x^v)&255]^(x>>>8);return (~x)>>>0;};
 const chunk=(tipo,data)=>{const l=Buffer.alloc(4);l.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(tipo),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;const fila=Buffer.concat([Buffer.from([0]),Buffer.from(Array(w).fill([r,g,b]).flat())]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(Array(h).fill(fila)))),chunk('IEND',Buffer.alloc(0))]);}
fs.writeFileSync(path.join(DIR,'prueba-verde.png'),png(160,120,[115,144,103]));
fs.writeFileSync(path.join(DIR,'prueba-crema.png'),png(160,120,[244,241,230]));
(async()=>{
 const chrome=[process.env.CHROME_PATH,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(p=>fs.existsSync(p));
 assert.ok(chrome,'Se requiere Chrome/Edge local (o CHROME_PATH).');
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id,gestor=crearPool({pruebas:true}),pool=crearPool({pruebas:true,schema});
 const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'nv-browser-'));let server,browser,ws,creados=false;const res=[];const ok=n=>{res.push(n);console.log('✔ '+n);};
 try{
  await gestor.query(`CREATE SCHEMA ${schema}`);creados=true;await migrar(pool,{esquemaControl:control});
  const sistema=crearSistema({pool}),hash=await hashPassword('Clave12345');
  const admin=new Administrador({nombre:'Admin imágenes',correo:'admin@example.test',passwordHash:hash});await sistema.repositorios.usuarios.guardar(admin);
  await sistema.registrar({nombre:'Cliente imágenes',correo:'cliente@example.test',password:'Clave12345'});
  const cat=await sistema.catalogoComercial.guardar(admin.id,'categorias',null,{nombre:'Snacks sintéticos'});
  const crear=async(nombre,extra={})=>{const p=await sistema.catalogoComercial.guardar(admin.id,'productos',null,{nombre,categoriaId:cat.id,precio:'10.00',estado:true,stockMinimo:1,...extra});await sistema.inventario.registrar(admin.id,{productoId:p.id,tipo:'AJUSTE',cantidad:5,motivo:'Sintético'});return p;};
  await crear('Producto con imagen',{descripcion:'Descripción sintética larga para comprobar el recorte a tres líneas en la tarjeta del catálogo. '.repeat(4),imagenUrl:'/images/productos/prueba-crema.png'});
  await crear('Producto sin imagen');
  const roto=await crear('Producto imagen eliminada',{imagenUrl:'/images/productos/prueba-verde.png'});
  await crear('<img src=x onerror="window.__xss=1">',{descripcion:'<script>window.__xss=2</script>'});
  for(let i=1;i<=2;i++)await crear('Relleno '+i);
  // El archivo de "roto" se elimina después: la tarjeta debe usar el fallback.
  fs.writeFileSync(path.join(DIR,'temporal-borrar.png'),png(10,10,[1,2,3]));await pool.query("UPDATE productos SET imagen_url='/images/productos/temporal-borrar.png' WHERE id_producto=$1",[roto.id]);fs.rmSync(path.join(DIR,'temporal-borrar.png'));
  const outer=express();outer.use('/images/productos',express.static(DIR,{dotfiles:'deny',index:false}));outer.use(crearApp(sistema));
  server=outer.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  browser=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--no-proxy-server','--remote-debugging-port=0','--user-data-dir='+perfil,...(process.env.CHROME_ARGS||'').split(' ').filter(Boolean),'about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(perfil,'DevToolsActivePort');for(let i=0;i<150&&!fs.existsSync(portFile);i++)await pausa(100);assert.ok(fs.existsSync(portFile));
  const port=fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let sec=0;const pend=new Map(),errores=[];
  ws.addEventListener('message',ev=>{const d=JSON.parse(ev.data);if(d.id){const r=pend.get(d.id);pend.delete(d.id);if(r)d.error?r.reject(new Error(d.error.message)):r.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown')errores.push(d.params.exceptionDetails.exception?.description?.split('\n')[0]||'Excepción');else if(d.method==='Log.entryAdded'&&d.params.entry.source==='security'&&d.params.entry.level==='error')errores.push('CSP: '+d.params.entry.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const i=++sec;const t=setTimeout(()=>{pend.delete(i);reject(new Error('CDP '+method));},15000);pend.set(i,{resolve:r=>{clearTimeout(t);resolve(r);},reject:e=>{clearTimeout(t);reject(e);}});ws.send(JSON.stringify({id:i,method,params}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text+' :: '+x);return r.result.value;};
  const esperar=async(x,ms=8000)=>{const fin=Date.now()+ms;while(Date.now()<fin){if(await ev(x))return;await pausa(80);}throw new Error('No se cumplió: '+x+' '+JSON.stringify(errores));};
  const campo=(i,v)=>ev(`(()=>{const e=document.getElementById(${JSON.stringify(i)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));})()`);
  const nav=v=>ev(`document.querySelector('[data-vista="${v}"]').click()`);
  const login=async c=>{await campo('loginCorreo',c);await campo('loginPassword','Clave12345');await ev("document.getElementById('loginForm').requestSubmit()");await esperar("!document.getElementById('appNav').classList.contains('hidden')");};
  const tam=async(w,h,mobile=false)=>send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile});
  const foto=async n=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(__dirname,'../docs/evidencias'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../docs/evidencias',n),Buffer.from(s.data,'base64'));};
  await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await tam(1366,1000);
  await send('Page.navigate',{url:base});await esperar("typeof apiFetch==='function'");

  // ADMINISTRADOR: selector + vista previa + guardar
  await login('admin@example.test');await nav('products');await esperar("document.querySelectorAll('#comercialImagen option').length===3");
  assert.deepEqual(await ev("[...document.querySelectorAll('#comercialImagen option')].map(o=>o.value)"),['','/images/productos/prueba-crema.png','/images/productos/prueba-verde.png']);
  await campo('comercialImagen','/images/productos/prueba-verde.png');await esperar("document.getElementById('comercialImagenPreview').src.endsWith('/images/productos/prueba-verde.png') && document.getElementById('comercialImagenPreview').complete && document.getElementById('comercialImagenPreview').naturalWidth===160");
  ok('Administración: selector lista solo imágenes locales válidas y muestra vista previa');
  await campo('comercialNombre','Producto desde selector');await campo('comercialCategoria',cat.id);await campo('comercialPrecio','8.50');await ev("document.getElementById('comercialEstado').checked=true;document.getElementById('comercialForm').requestSubmit()");
  await esperar("document.getElementById('comercialMsg').textContent==='Producto guardado.'");
  assert.equal((await pool.query("SELECT imagen_url FROM productos WHERE nombre='Producto desde selector'")).rows[0].imagen_url,'/images/productos/prueba-verde.png');
  await esperar("document.getElementById('comercialImagen').value==='' && document.getElementById('comercialImagenPreview').src.endsWith('/images/producto.svg')");
  ok('Guardar producto con imagen seleccionada; el formulario vuelve a "Sin imagen"');
  await foto('imagenes-admin-selector.png');await ev("document.getElementById('logoutBtn').click()");await esperar("document.getElementById('appNav').classList.contains('hidden')");

  // CLIENTE: tarjetas, fallback, XSS y responsive
  await login('cliente@example.test');assert.equal(await ev("!!document.querySelector('[data-vista=\"products\"]')"),false);
  await nav('catalog');await esperar("document.querySelectorAll('.product-card').length===7");
  await esperar("[...document.querySelectorAll('.product-card img')].every(i=>i.complete&&i.naturalWidth>0)");
  const tarjeta=n=>`[...document.querySelectorAll('.product-card')].find(c=>c.querySelector('h2').textContent===${JSON.stringify(n)})`;
  assert.ok(await ev(`${tarjeta('Producto con imagen')}.querySelector('img').src.endsWith('/images/productos/prueba-crema.png')`));
  assert.ok(await ev(`${tarjeta('Producto sin imagen')}.querySelector('img').src.endsWith('/images/producto.svg')`));
  await esperar(`${tarjeta('Producto imagen eliminada')}.querySelector('img').src.endsWith('/images/producto.svg')`);
  ok('Tarjetas: imagen local, sin imagen → fallback, archivo eliminado → fallback');
  const card=await ev(`(()=>{const c=${tarjeta('Producto con imagen')};const d=c.querySelector('.product-desc');return {desc:!!d,clamp:getComputedStyle(d).webkitLineClamp,alto:d.getBoundingClientRect().height,linea:parseFloat(getComputedStyle(d).lineHeight),precio:c.querySelector('.product-price').textContent,disp:c.querySelector('.availability').textContent,alt:c.querySelector('img').alt,ratio:getComputedStyle(c.querySelector('img')).aspectRatio,fit:getComputedStyle(c.querySelector('img')).objectFit};})()`);
  assert.ok(card.desc&&card.clamp==='3'&&card.alto<=card.linea*3+2,JSON.stringify(card));assert.equal(card.precio,'Q 10.00');assert.equal(card.disp,'Disponible');assert.equal(card.alt,'Producto con imagen');assert.equal(card.fit,'contain');
  ok('Tarjeta: imagen, nombre, descripción corta (3 líneas), precio, disponibilidad y alt accesible');
  const xss=await ev(`(()=>{const c=${tarjeta('<img src=x onerror="window.__xss=1">')};return {h2:c.querySelector('h2').children.length,desc:c.querySelector('.product-desc').textContent,imgs:c.querySelectorAll('img').length,flag:window.__xss??null};})()`);
  assert.deepEqual(xss,{h2:0,desc:'<script>window.__xss=2</script>',imgs:1,flag:null});ok('XSS: nombre y descripción con HTML se muestran como texto');
  await foto('imagenes-catalogo-desktop.png');
  const columnas=async()=>ev("getComputedStyle(document.querySelector('.product-grid')).gridTemplateColumns.split(' ').length");
  assert.equal(await columnas(),3);await tam(820,1000);await pausa(200);assert.equal(await columnas(),2);
  await tam(390,844,true);await pausa(250);assert.equal(await columnas(),1);
  assert.ok(await ev('document.documentElement.scrollWidth<=window.innerWidth'),'sin desborde horizontal');
  assert.ok(await ev("[...document.querySelectorAll('.product-card img')].every(i=>i.getBoundingClientRect().width<=window.innerWidth)"));
  await foto('imagenes-catalogo-movil.png');ok('Responsive: 3 columnas (1366), 2 (820), 1 (390) sin desborde horizontal');
  await ev(`${tarjeta('Producto con imagen')}.querySelector('button').click()`);await esperar("document.getElementById('productDetail').open && document.querySelector('#detailContent img').complete");
  assert.ok(await ev("document.querySelector('#detailContent img').src.endsWith('/images/productos/prueba-crema.png')"));ok('Detalle del producto muestra la imagen');
  assert.deepEqual(errores,[]);ok('Sin excepciones JavaScript ni bloqueos CSP');
  console.log(JSON.stringify({navegador:path.basename(chrome),aprobadas:res.length,fallidas:0}));
 }finally{
  if(ws)ws.close();if(browser){browser.kill();await pausa(400);}if(server)await new Promise(r=>server.close(r));await pool.end();
  try{if(creados){await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}}finally{await gestor.end();}
  fs.rmSync(perfil,{recursive:true,force:true,maxRetries:10,retryDelay:200});fs.rmSync(DIR,{recursive:true,force:true});
 }
})().catch(e=>{console.error('✘ FALLÓ:',e.message);process.exitCode=1;});
