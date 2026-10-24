const {test}=require("node:test");const assert=require("node:assert/strict");const {randomUUID}=require("node:crypto");const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
process.env.JWT_SECRET="fase4-sintetico";process.env.ENCRYPTION_KEY="ab".repeat(32);
const {crearPool}=require("../src/database/pool"),{migrar}=require("../src/database/migraciones"),{importarJson}=require("../src/database/importacion");
const {crearSistema}=require("../src/services/sistema"),{crearApp}=require("../src/app"),{Administrador,Empleado}=require("../src/domain/modelos"),{generarToken}=require("../src/security/auth"),{fuente}=require("./fixtures/fase2");
const {ficha,filtros}=require("../src/security/catalogoValidacion");
test("FASE4 validación: precio exacto, IDs, URLs y payload",()=>{
 for(const precio of [0,-1,"NaN","Infinity","1.001","1e2",true,[],"999999999.99"])assert.throws(()=>ficha("productos",{precio}));
 for(const imagenUrl of ["javascript:alert(1)","http://inseguro.test/a.jpg","//ajeno.test/a.png","https://u:p@example.test/a.jpg","/images/../privado","https://example.test/barra.jpg","/images/producto.svg","/images/productos/x.svg"])assert.throws(()=>ficha("productos",{imagenUrl}));
 assert.equal(ficha("productos",{precio:"12.50"}).precio,"12.50");assert.equal(ficha("productos",{precio:null}).precio,null);
 assert.throws(()=>ficha("productos",{ingredientes:"Avena,Miel"}));assert.throws(()=>ficha("ingredientes",{nombre:"Avena",estado:true}));
 assert.throws(()=>filtros({limit:"101"}));assert.throws(()=>filtros({page:"0"}));assert.throws(()=>filtros({estado:"todos"},false));assert.throws(()=>ficha("productos",{categoriaId:"9223372036854775808"}));
});
test("FASE4 catálogo PostgreSQL real",async t=>{
 const suffix=randomUUID().replaceAll('-',''),schema='nv_test_'+suffix,control='nv_test_control_'+suffix,gestor=crearPool({pruebas:true});await gestor.query(`CREATE SCHEMA ${schema}`);const pool=crearPool({pruebas:true,schema});let server;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nv-fase4-'));
 t.after(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();assert.match(schema,/^nv_test_[a-f0-9]+$/);assert.match(control,/^nv_test_control_[a-f0-9]+$/);try{await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}finally{await gestor.end();}assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('nv-fase4-'));fs.rmSync(dir,{recursive:true,force:true});});
 await migrar(pool,{esquemaControl:control});const datos=fuente();const archivo=path.join(dir,'db.json');fs.writeFileSync(archivo,JSON.stringify(datos));await importarJson(pool,archivo,{backupDir:path.join(dir,'backup')});
 const sistema=crearSistema({pool});const admin=new Administrador({nombre:"Admin sintético",correo:"admin@example.test",passwordHash:datos.usuarios[0].passwordHash}),empleado=new Empleado({nombre:"Empleado sintético",correo:"empleado@example.test",passwordHash:datos.usuarios[0].passwordHash});await sistema.repositorios.usuarios.guardar(admin);await sistema.repositorios.usuarios.guardar(empleado);
 const ta=generarToken(admin),te=generarToken(empleado),tc=generarToken(await sistema.repositorios.usuarios.buscarPorId(datos.usuarios[0].id));
 server=crearApp(sistema).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const api=async(method,ruta,body,token=ta)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,data:r.status===204?null:await r.json()};};
 let categoria,ingrediente,producto,segundo;
 await t.test("Categorías: crear, editar, normalizar duplicados y desactivar",async()=>{
  let r=await api('POST','/categorias',{nombre:' Snacks ',descripcion:'Prueba'});assert.equal(r.status,201);categoria=r.data.categoria;
  assert.equal((await api('POST','/categorias',{nombre:'snacks'})).status,409);
  assert.equal((await api('PUT',`/categorias/${categoria.id}`,{nombre:'Snacks naturales'})).status,200);
  assert.equal((await api('POST','/categorias',{nombre:'  SNACKS   naturales '})).status,409);
  assert.equal((await api('PUT',`/categorias/${categoria.id}/estado`,{estado:false})).data.categoria.estado,false);
  await api('PUT',`/categorias/${categoria.id}/estado`,{estado:true});
 });
 await t.test("Ingredientes: crear, duplicado normalizado, editar y sin estado inventado",async()=>{
  const r=await api('POST','/ingredientes',{nombre:'Avena',descripcion:'Declarada'});assert.equal(r.status,201);ingrediente=r.data.ingrediente;
  assert.equal((await api('POST','/ingredientes',{nombre:' AVENA '})).status,409);
  assert.equal((await api('PUT',`/ingredientes/${ingrediente.id}`,{descripcion:'Descripción editada'})).status,200);
  assert.equal((await api('PUT',`/ingredientes/${ingrediente.id}`,{estado:false})).status,400);
 });
 await t.test("RBAC: cliente/empleado solo lectura; admin escribe",async()=>{
  for(const token of [tc,te])for(const ruta of ['/categorias','/ingredientes','/productos']){
   assert.equal((await api('GET',ruta,undefined,token)).status,200);
   assert.equal((await api('POST',ruta,{nombre:'No autorizado'},token)).status,403);
   assert.equal((await api('PUT',ruta+'/'+(ruta==='/productos'?datos.productos[0].id:categoria.id),{nombre:'No autorizado'},token)).status,403);
  }
  assert.equal((await api('GET','/productos',undefined,null)).status,401);
  await assert.rejects(sistema.catalogoComercial.guardar(empleado.id,'categorias',null,{nombre:'No autorizado'}),e=>e.status===403);
 });
 await t.test("Heredado: visible para admin, oculto para cliente/empleado sin precio ni stock inventado",async()=>{
  assert.ok((await api('GET','/productos')).data.productos.some(p=>p.id===datos.productos[0].id));
  for(const token of [tc,te]){assert.equal((await api('GET','/productos',undefined,token)).data.productos.length,0);assert.equal((await api('GET',`/productos/${datos.productos[0].id}`,undefined,token)).status,404);assert.equal((await api('GET','/productos?estado=todos',undefined,token)).status,400);}
  const r=await api('GET',`/productos/${datos.productos[0].id}`);assert.equal(r.data.producto.estado,false);assert.equal(r.data.producto.precio,null);assert.equal(r.data.producto.disponibilidad,'SIN_CONFIGURAR');
 });
 await t.test("Productos: activo válido y asociación normalizada sin inventario",async()=>{
  const r=await api('POST','/productos',{nombre:'Barra de avena',categoriaId:categoria.id,descripcion:'Producto sintético',precio:'12.50',estado:true,ingredientes:[{id:ingrediente.id,cantidadDescriptiva:'Declarada'}]});
  assert.equal(r.status,201);producto=r.data.producto;assert.equal(producto.estado,true);assert.equal(producto.precio,'12.50');assert.equal(producto.ingredientes[0].id,ingrediente.id);assert.equal(producto.disponibilidad,'SIN_CONFIGURAR');
  assert.equal((await pool.query('SELECT count(*)::int n FROM producto_ingrediente WHERE id_producto=$1',[producto.id])).rows[0].n,1);assert.equal((await pool.query('SELECT count(*)::int n FROM inventario')).rows[0].n,0);
 });
 await t.test("Activación: precio positivo, categoría existente y activa; borradores permitidos",async()=>{
  for(const precio of [-1,0,null])assert.equal((await api('POST','/productos',{nombre:'Inválido',categoriaId:categoria.id,precio,estado:true})).status,400);
  assert.equal((await api('POST','/productos',{nombre:'Inválido',categoriaId:'999999999'})).status,400);
  const c=(await api('POST','/categorias',{nombre:'Inactiva',estado:false})).data.categoria;
  assert.equal((await api('POST','/productos',{nombre:'Inválido',categoriaId:c.id,precio:'1',estado:true})).status,400);
  const borrador=await api('POST','/productos',{nombre:'Borrador',categoriaId:categoria.id});assert.equal(borrador.status,201);assert.equal(borrador.data.producto.estado,false);assert.equal(borrador.data.producto.precio,null);
  assert.equal((await api('PUT',`/categorias/${categoria.id}/estado`,{estado:false})).status,409);
 });
 await t.test("Catálogo: tres roles, filtros combinados, búsqueda y paginación",async()=>{
  segundo=(await api('POST','/productos',{nombre:'Bebida natural',categoriaId:categoria.id,precio:'2',estado:true})).data.producto;
  for(const token of [tc,te,ta]){const r=await api('GET',`/productos?nombre=avena&categoria=${categoria.id}&ingrediente=${ingrediente.id}&page=1&limit=1`,undefined,token);assert.equal(r.status,200);assert.equal(r.data.productos.length,1);assert.equal(r.data.productos[0].id,producto.id);assert.equal(r.data.paginacion.total,1);}
  const r=await api('GET','/productos?page=2&limit=1',undefined,tc);assert.equal(r.data.productos.length,1);assert.equal(r.data.paginacion.total,2);assert.equal(r.data.paginacion.pages,2);
  assert.equal((await api('GET','/productos?page=10&limit=1',undefined,tc)).data.productos.length,0);
  assert.ok(!Object.hasOwn((await api('GET',`/productos/${producto.id}`,undefined,tc)).data.producto,'datosLegado'));
 });
 await t.test("SQL injection y payload inesperado: valores parametrizados, rechazo sin ampliar acceso",async()=>{
  assert.equal((await api('GET',"/productos?nombre="+encodeURIComponent("' OR 1=1 --"),undefined,tc)).data.productos.length,0);
  assert.equal((await api('GET','/productos?nombre=%25',undefined,tc)).data.productos.length,0);
  for(const query of ['limit=101','page=0','categoria=1%20OR%201=1','ingrediente[]=1','rol=ADMINISTRADOR'])assert.equal((await api('GET','/productos?'+query,undefined,tc)).status,400);
  assert.equal((await api('PUT',`/productos/${producto.id}`,{stock:100})).status,400);
  assert.equal((await api('GET','/productos/no-uuid')).status,400);
  assert.equal((await api('POST','/productos',{nombre:'Mal',categoriaId:categoria.id,ingredientes:'avena,miel'})).status,400);
 });
 await t.test("Editar: reemplazar asociaciones, conservar UUID y rechazar ingredientes inexistentes sin cambios parciales",async()=>{
  const r=await api('PUT',`/productos/${producto.id}`,{nombre:'Barra actualizada',ingredientes:[]});assert.equal(r.status,200);assert.equal(r.data.producto.id,producto.id);assert.equal(r.data.producto.ingredientes.length,0);
  assert.equal((await api('PUT',`/productos/${producto.id}`,{nombre:'No guardar',ingredientes:[{id:'999999'}]})).status,400);
  assert.equal((await api('GET',`/productos/${producto.id}`)).data.producto.nombre,'Barra actualizada');
 });
 await t.test("Desactivación lógica conserva producto, relaciones históricas y auditoría",async()=>{
  assert.equal((await api('DELETE',`/productos/${producto.id}`)).status,204);assert.equal((await api('GET',`/productos/${producto.id}`,undefined,tc)).status,404);
  assert.equal((await pool.query('SELECT estado FROM productos WHERE id_producto=$1',[producto.id])).rows[0].estado,false);
  await api('PUT',`/productos/${segundo.id}/estado`,{estado:false});assert.equal((await api('PUT',`/categorias/${categoria.id}/estado`,{estado:false})).status,200);
  const acciones=(await pool.query('SELECT DISTINCT accion FROM auditoria')).rows.map(r=>r.accion);
  for(const a of ['CREAR_CATEGORIA','ACTUALIZAR_CATEGORIA','DESACTIVAR_CATEGORIA','CREAR_INGREDIENTE','ACTUALIZAR_INGREDIENTE','CREAR_PRODUCTO','ACTUALIZAR_PRODUCTO','DESACTIVAR_PRODUCTO','ASOCIAR_INGREDIENTE_PRODUCTO'])assert.ok(acciones.includes(a),a);
 });
 await t.test("Completar heredado no altera los datos legados ni fabrica cantidades",async()=>{
  const previo=(await pool.query('SELECT datos_legado FROM productos WHERE id_producto=$1',[datos.productos[0].id])).rows[0].datos_legado;
  await api('PUT',`/categorias/${categoria.id}/estado`,{estado:true});
  const r=await api('PUT',`/productos/${datos.productos[0].id}`,{categoriaId:categoria.id,precio:'5.00',estado:true,ingredientes:[{id:ingrediente.id}]});assert.equal(r.status,200);assert.equal(r.data.producto.ingredientes[0].cantidadDescriptiva,null);
  assert.deepEqual((await pool.query('SELECT datos_legado FROM productos WHERE id_producto=$1',[datos.productos[0].id])).rows[0].datos_legado,previo);assert.equal((await pool.query('SELECT count(*)::int n FROM inventario')).rows[0].n,0);
 });
 await t.test("Eliminar producto referenciado solo lo desactiva y conserva el detalle histórico",async()=>{
  const {transaccion}=require("../src/database/transaccion");let pedido;
  await transaccion(pool,async db=>{pedido=(await db.query("INSERT INTO pedidos(id_cliente,subtotal,total,estado) VALUES($1,5,5,'ENTREGADO') RETURNING id_pedido",[datos.usuarios[0].id])).rows[0].id_pedido;await db.query("INSERT INTO detalle_pedido(id_pedido,id_producto,cantidad,precio_unitario,subtotal) VALUES($1,$2,1,5,5)",[pedido,datos.productos[0].id]);});
  assert.equal((await api('DELETE',`/productos/${datos.productos[0].id}`)).status,204);
  assert.equal((await pool.query('SELECT count(*)::int n FROM detalle_pedido WHERE id_pedido=$1',[pedido])).rows[0].n,1);
  assert.equal((await pool.query('SELECT estado FROM productos WHERE id_producto=$1',[datos.productos[0].id])).rows[0].estado,false);
 });
 await t.test("Auditoría atómica: fallo de FK revierte la mutación",async()=>{
  await assert.rejects(sistema.repositorios.catalogoComercial.guardarEntidad('ingredientes',null,{nombre:'No persistir'},randomUUID()));assert.equal((await pool.query("SELECT count(*)::int n FROM ingredientes WHERE nombre='No persistir'")).rows[0].n,0);
 });
});
