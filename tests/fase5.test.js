const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {crearPool}=require('../src/database/pool'),{migrar}=require('../src/database/migraciones');
const {crearSistema}=require('../src/services/sistema'),{crearApp}=require('../src/app');
const {Administrador,Empleado,Cliente}=require('../src/domain/modelos'),{generarToken}=require('../src/security/auth');
const {movimiento,filtros}=require('../src/security/inventarioValidacion');
test('FASE5 validación estricta de movimientos y fechas',()=>{
 const valid={productoId:randomUUID(),tipo:'AJUSTE',cantidad:0,motivo:'Conteo físico'};
 assert.equal(movimiento(valid).cantidad,0);
 for(const cantidad of [-1,1.2,'3',null,true,2147483648,NaN])assert.throws(()=>movimiento({...valid,cantidad}));
 for(const tipo of ['ENTRADA','SALIDA'])assert.throws(()=>movimiento({...valid,tipo}));
 for(const motivo of ['',null,'   ','x'.repeat(251),{}])assert.throws(()=>movimiento({...valid,motivo}));
 for(const b of [{...valid,tipo:'OTRO'},{...valid,productoId:'1'},{...valid,usuarioId:randomUUID()}])assert.throws(()=>movimiento(b));
 for(const q of [{desde:'2026-02-30'},{hasta:'2026-13-01'},{desde:'2026-10-01',hasta:'2026-09-01'},{page:'0'},{limit:'101'},{usuario:'x'},{tipo:'OTRO'},{producto:[]},{desde:['2026-01-01']}])assert.throws(()=>filtros(q,true));
});
test('FASE5 inventario PostgreSQL, API, transacciones y concurrencia',async t=>{
 const id=randomUUID().replaceAll('-',''),schema='nv_test_'+id,control='nv_test_control_'+id;
 const gestor=crearPool({pruebas:true});await gestor.query(`CREATE SCHEMA ${schema}`);const pool=crearPool({pruebas:true,schema});let server;
 t.after(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();assert.match(schema,/^nv_test_[a-f0-9]+$/);assert.match(control,/^nv_test_control_[a-f0-9]+$/);try{await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}finally{await gestor.end();}});
 await migrar(pool,{esquemaControl:control});const sistema=crearSistema({pool});
 const admin=new Administrador({nombre:'Admin',correo:'admin@example.test',passwordHash:'hash-sintetico'}),empleado=new Empleado({nombre:'Empleado',correo:'empleado@example.test',passwordHash:'hash-sintetico'}),cliente=new Cliente({nombre:'Cliente',correo:'cliente@example.test',passwordHash:'hash-sintetico'});
 for(const u of [admin,empleado,cliente])await sistema.repositorios.usuarios.guardar(u);
 const ta=generarToken(admin),te=generarToken(empleado),tc=generarToken(cliente);
 server=crearApp(sistema).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const api=async(method,url,body,token=ta)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${url}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 const categoria=await sistema.catalogoComercial.guardar(admin.id,'categorias',null,{nombre:'Categoría prueba'});
 const producto=async(nombre,estado=true)=>sistema.catalogoComercial.guardar(admin.id,'productos',null,{nombre,categoriaId:categoria.id,estado,precio:estado?'5.00':null,stockMinimo:3});
 const p=await producto('Producto principal'),cero=await producto('Producto cero'),borrador=await producto('Producto incompleto',false);
 const mover=(prod,tipo,cantidad,token=te,motivo='Conteo físico verificado')=>api('POST','/inventario/movimientos',{productoId:prod.id,tipo,cantidad,motivo},token);
 const estado=async prod=>(await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1',[prod.id])).rows[0]?.cantidad;
 const snapshot=async()=>({inv:(await pool.query('SELECT * FROM inventario ORDER BY id_inventario')).rows,mov:(await pool.query('SELECT * FROM movimientos_inventario ORDER BY id_movimiento')).rows,aud:(await pool.query('SELECT * FROM auditoria ORDER BY id_auditoria')).rows});
 await t.test('Nueva migración desde vacío e idempotencia; 16 tablas y cinco versiones',async()=>{
  assert.ok((await pool.query(`SELECT count(*)::int n FROM ${control}.schema_migrations`)).rows[0].n >= 5);
  assert.ok((await migrar(pool,{esquemaControl:control})).every(x=>x.estado==='ya_aplicada'));
  assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",[schema])).rows[0].n,16);
 });
 await t.test('Inventario no configurado: consulta no crea filas ni ceros',async()=>{
  const r=await api('GET','/inventario',undefined,te);assert.equal(r.status,200);assert.equal(r.data.inventario.length,3);assert.ok(r.data.inventario.every(p=>p.existencia===null&&p.estado==='SIN_CONFIGURAR'));assert.equal(await estado(p),undefined);
 });
 await t.test('JWT/RBAC: cliente denegado, empleado sin CRUD de catálogo',async()=>{
  for(const url of ['/inventario','/inventario/movimientos']){assert.equal((await api('GET',url,undefined,tc)).status,403);assert.equal((await api('GET',url,undefined,null)).status,401);}
  assert.equal((await mover(p,'AJUSTE',1,tc)).status,403);assert.equal((await api('POST','/categorias',{nombre:'Prohibida'},te)).status,403);
  for(const u of [cliente])await assert.rejects(sistema.inventario.listar(u.id,{}),e=>e.status===403);
 });
 await t.test('Configuración positiva: AJUSTE, anterior NULL, movimiento y dos eventos atómicos',async()=>{
  const r=await mover(p,'AJUSTE',12);assert.equal(r.status,201);assert.equal(r.data.movimiento.existenciaAnterior,null);assert.equal(r.data.movimiento.existenciaNueva,12);assert.equal(r.data.movimiento.tipo,'AJUSTE');assert.equal(r.data.movimiento.usuarioId,empleado.id);assert.equal(await estado(p),12);
  assert.deepEqual((await pool.query("SELECT accion FROM auditoria WHERE id_entidad=$1 AND entidad='inventario' ORDER BY accion",[p.id])).rows.map(x=>x.accion),['AJUSTE_INVENTARIO','CONFIGURAR_INVENTARIO']);
 });
 await t.test('Configuración cero válida distinta de ausencia',async()=>{
  const r=await mover(cero,'AJUSTE',0,ta);assert.equal(r.status,201);assert.equal(r.data.movimiento.existenciaAnterior,null);assert.equal(await estado(cero),0);
  const l=(await api('GET','/inventario')).data.inventario;assert.equal(l.find(x=>x.productoId===cero.id).estado,'SIN_EXISTENCIA');assert.equal(l.find(x=>x.productoId===borrador.id).existencia,null);
 });
 await t.test('ENTRADA conserva anterior/nueva y usuario administrador',async()=>{
  const r=await mover(p,'ENTRADA',5,ta);assert.equal(r.status,201);assert.equal(r.data.movimiento.existenciaAnterior,12);assert.equal(r.data.movimiento.existenciaNueva,17);assert.equal(await estado(p),17);
 });
 await t.test('SALIDA conserva anterior/nueva',async()=>{
  const r=await mover(p,'SALIDA',3);assert.equal(r.status,201);assert.equal(r.data.movimiento.existenciaAnterior,17);assert.equal(r.data.movimiento.existenciaNueva,14);
 });
 await t.test('AJUSTE absoluto descendente, ascendente y a cero',async()=>{
  for(const [antes,nuevo] of [[14,10],[10,20],[20,0]]){const r=await mover(p,'AJUSTE',nuevo);assert.equal(r.status,201);assert.equal(r.data.movimiento.existenciaAnterior,antes);assert.equal(r.data.movimiento.existenciaNueva,nuevo);assert.equal(r.data.movimiento.cantidad,nuevo);}
 });
 await t.test('Salida excesiva, ajuste repetido, cantidades y motivo inválidos no generan cambios',async()=>{
  const antes=await snapshot();assert.equal((await mover(p,'SALIDA',1)).status,409);assert.equal((await mover(p,'AJUSTE',0)).status,409);
  for(const tipo of ['ENTRADA','SALIDA'])for(const n of [0,-1,1.2,'2',2147483648])assert.equal((await mover(p,tipo,n)).status,400);
  assert.equal((await mover(p,'AJUSTE',-1)).status,400);assert.equal((await mover(p,'AJUSTE',2,te,' ')).status,400);assert.deepEqual(await snapshot(),antes);
 });
 await t.test('Producto incompleto, inexistente, UUID inválido y ENTRADA inicial rechazados',async()=>{
  const antes=await snapshot();assert.equal((await mover(borrador,'AJUSTE',0)).status,409);assert.equal((await mover({id:randomUUID()},'AJUSTE',1)).status,404);assert.equal((await mover({id:'x'},'AJUSTE',1)).status,400);
  const nuevo=await producto('Sin configurar');assert.equal((await mover(nuevo,'ENTRADA',2)).status,409);assert.equal((await mover(nuevo,'SALIDA',2)).status,409);assert.deepEqual((await snapshot()).mov,antes.mov);assert.equal(await estado(nuevo),undefined);
 });
 await t.test('Inactivo bloquea ENTRADA/SALIDA y admite AJUSTE físico con inventario',async()=>{
  await sistema.catalogoComercial.guardar(admin.id,'productos',p.id,{estado:false});const antes=await snapshot();
  assert.equal((await mover(p,'ENTRADA',1)).status,409);assert.equal((await mover(p,'SALIDA',1)).status,409);assert.deepEqual(await snapshot(),antes);
  assert.equal((await mover(p,'AJUSTE',6)).status,201);assert.equal(await estado(p),6);assert.equal((await pool.query('SELECT estado FROM productos WHERE id_producto=$1',[p.id])).rows[0].estado,false);
  await sistema.catalogoComercial.guardar(admin.id,'productos',p.id,{estado:true});
 });
 await t.test('Disponible, bajo stock, agotado y sin configurar en catálogo',async()=>{
  for(const [n,esperado] of [[3,'BAJO_STOCK'],[2,'BAJO_STOCK'],[0,'SIN_EXISTENCIA'],[5,'CON_EXISTENCIA']]){await mover(p,'AJUSTE',n);assert.equal((await api('GET','/productos/'+p.id,undefined,tc)).data.producto.disponibilidad,esperado);}
  await sistema.catalogoComercial.guardar(admin.id,'productos',p.id,{stockMinimo:null});await mover(p,'AJUSTE',1);assert.equal((await api('GET','/productos/'+p.id,undefined,tc)).data.producto.disponibilidad,'CON_EXISTENCIA');
 });
 await t.test('Rollback completo cuando falla auditoría, incluyendo primera configuración',async()=>{
  const nuevo=await producto('Rollback inicial'),antes=await snapshot();
  await pool.query("CREATE FUNCTION fallar_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.entidad='inventario' THEN RAISE EXCEPTION 'fallo sintético'; END IF; RETURN NEW; END $$; CREATE TRIGGER fallo_auditoria BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION fallar_auditoria()");
  try{for(const prod of [nuevo,p]){const r=await mover(prod,'AJUSTE',7);assert.equal(r.status,500);assert.ok(!JSON.stringify(r.data).includes('sintético'));}assert.deepEqual(await snapshot(),antes);}finally{await pool.query('DROP TRIGGER fallo_auditoria ON auditoria; DROP FUNCTION fallar_auditoria()');}
 });
 await t.test('Rollback completo cuando falla inserción del movimiento',async()=>{
  const antes=await snapshot();await pool.query("CREATE FUNCTION fallar_movimiento() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo sintético'; END $$; CREATE TRIGGER fallo_movimiento BEFORE INSERT ON movimientos_inventario FOR EACH ROW EXECUTE FUNCTION fallar_movimiento()");
  try{assert.equal((await mover(p,'AJUSTE',9)).status,500);assert.deepEqual(await snapshot(),antes);}finally{await pool.query('DROP TRIGGER fallo_movimiento ON movimientos_inventario; DROP FUNCTION fallar_movimiento()');}
 });
 await t.test('Dos SALIDAS concurrentes: una confirma, otra rechaza sin negativo ni huérfanos',async()=>{
  await mover(p,'AJUSTE',5);const prev=await snapshot();const r=await Promise.all([mover(p,'SALIDA',4),mover(p,'SALIDA',4)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(await estado(p),1);const post=await snapshot();assert.equal(post.mov.length,prev.mov.length+1);assert.equal(post.aud.length,prev.aud.length+1);
 });
 await t.test('Dos configuraciones concurrentes iguales: solo una fila y un movimiento inicial',async()=>{
  const n=await producto('Configuración concurrente');const r=await Promise.all([mover(n,'AJUSTE',0),mover(n,'AJUSTE',0)]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal((await pool.query('SELECT count(*)::int n FROM movimientos_inventario WHERE id_producto=$1',[n.id])).rows[0].n,1);assert.equal(await estado(n),0);
 });
 await t.test('Desactivación concurrente y entrada se serializan sin permitir entradas posteriores',async()=>{
  const n=await producto('Desactivar simultáneo');await mover(n,'AJUSTE',1);const [r]=await Promise.all([mover(n,'ENTRADA',1),sistema.catalogoComercial.guardar(admin.id,'productos',n.id,{estado:false})]);assert.ok([201,409].includes(r.status));assert.equal(await estado(n),r.status===201?2:1);assert.equal((await mover(n,'ENTRADA',1)).status,409);
 });
 await t.test('PostgreSQL protege cantidad, relaciones de existencias, duplicado inicial y no negativo',async()=>{
  const sql="INSERT INTO movimientos_inventario(id_producto,id_usuario,tipo,cantidad,existencia_anterior,existencia_nueva,motivo) VALUES($1,$2,$3,$4,$5,$6,'Prueba')";
  for(const values of [['ENTRADA',0,1,1],['SALIDA',2,1,-1],['ENTRADA',2,null,2],['AJUSTE',2,1,3],['AJUSTE',2,2,2],['ENTRADA',2147483647,2147483647,1]])await assert.rejects(pool.query(sql,[p.id,admin.id,...values]),e=>e.code==='23514');
  await assert.rejects(pool.query(sql,[p.id,admin.id,'AJUSTE',0,null,0]),e=>e.code==='23505');await assert.rejects(pool.query('UPDATE inventario SET cantidad=-1 WHERE id_producto=$1',[p.id]),e=>e.code==='23514');
 });
 await t.test('Límite INTEGER no desborda y no deja cambios parciales',async()=>{
  await mover(cero,'AJUSTE',2147483647);const antes=await snapshot();assert.equal((await mover(cero,'ENTRADA',1)).status,409);assert.deepEqual(await snapshot(),antes);
 });
 await t.test('Historial filtrado por producto/tipo/usuario/fecha, paginación SQL y parámetros inválidos',async()=>{
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guatemala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const query=`producto=${p.id}&tipo=ENTRADA&usuario=${admin.id}&desde=${day}&hasta=${day}`;
  const r=await api('GET','/inventario/movimientos?'+query,undefined,te);assert.equal(r.status,200);assert.ok(r.data.movimientos.length>0);assert.ok(r.data.movimientos.every(m=>m.productoId===p.id&&m.tipo==='ENTRADA'&&m.usuarioId===admin.id));
  const a=(await api('GET','/inventario/movimientos?limit=1&page=1')).data,b=(await api('GET','/inventario/movimientos?limit=1&page=2')).data;assert.equal(a.movimientos.length,1);assert.notEqual(a.movimientos[0].id,b.movimientos[0].id);assert.equal(a.paginacion.total,b.paginacion.total);
  assert.equal((await api('GET','/inventario/movimientos?desde=1900-01-01&hasta=1900-01-02')).data.movimientos.length,0);
  for(const q of ['usuario=x','producto=x','tipo=OTRO','desde=2026-02-30','limit=101'])assert.equal((await api('GET','/inventario/movimientos?'+q)).status,400);
  assert.equal((await api('GET','/inventario?nombre='+encodeURIComponent("' OR 1=1 --"))).data.inventario.length,0);
 });
 await t.test('Historial reconstruye existencias; auditoría mínima sin credenciales ni motivos duplicados',async()=>{
  const filas=(await pool.query('SELECT * FROM movimientos_inventario ORDER BY id_movimiento')).rows,map=new Map();
  for(const m of filas){assert.equal(m.existencia_anterior,map.get(m.id_producto)??null);map.set(m.id_producto,m.existencia_nueva);}
  for(const [id,n] of map)assert.equal((await pool.query('SELECT cantidad FROM inventario WHERE id_producto=$1',[id])).rows[0].cantidad,n);
  const eventos=(await pool.query("SELECT * FROM auditoria WHERE entidad='inventario'")).rows;
  for(const action of ['CONFIGURAR_INVENTARIO','ENTRADA_INVENTARIO','SALIDA_INVENTARIO','AJUSTE_INVENTARIO'])assert.ok(eventos.some(e=>e.accion===action));
  for(const ev of eventos){assert.deepEqual(Object.keys(ev.datos_anteriores),['existencia']);assert.deepEqual(Object.keys(ev.datos_nuevos).sort(),['existencia','movimientoId']);assert.ok(filas.some(m=>String(m.id_movimiento)===ev.datos_nuevos.movimientoId));}
  const r=await api('GET','/inventario/movimientos');assert.ok(!JSON.stringify(r.data).includes('password'));assert.ok(!JSON.stringify(r.data).includes('hash-sintetico'));
 });
});
