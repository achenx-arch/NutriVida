const {test}=require("node:test");const assert=require("node:assert/strict");
const fs=require("node:fs");const path=require("node:path");const os=require("node:os");const {randomUUID}=require("node:crypto");
process.env.JWT_SECRET="fase2-pruebas-locales";process.env.ENCRYPTION_KEY="ab".repeat(32);process.env.OLLAMA_MODEL="";
const env=require("../src/config/env");
const {crearPool}=require("../src/database/pool");const {migrar}=require("../src/database/migraciones");
const {transaccion}=require("../src/database/transaccion");
const {importarJson,verificarImportacion}=require("../src/database/importacion");
const {crearSistema}=require("../src/services/sistema");const {crearApp}=require("../src/app");
const {fuente}=require("./fixtures/fase2");
const configurada=[env.db.host,env.db.port,env.db.database,env.db.user,env.db.password,env.db.testDatabase].every(Boolean);
test("PostgreSQL real: migraciones, importación, integridad, repositorios y aplicación",{skip:configurada?false:"Configura DB_* y una DB_TEST_NAME independiente en .env; no se sustituye por mocks."},async t=>{
 const sufijo=randomUUID().replaceAll("-","");const schema="nv_test_"+sufijo;const control="nv_test_control_"+sufijo;
 const gestor=crearPool({pruebas:true});
 await gestor.query(`CREATE SCHEMA ${schema}`);
 const pool=crearPool({pruebas:true,schema});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nv-pg-test-"));
 t.after(async()=>{
  await pool.end();
  assert.match(schema,/^nv_test_[a-f0-9]+$/);assert.match(control,/^nv_test_control_[a-f0-9]+$/);
  try{await gestor.query(`DROP SCHEMA ${schema} CASCADE`);await gestor.query(`DROP SCHEMA IF EXISTS ${control} CASCADE`);}finally{await gestor.end();}
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith("nv-pg-test-"));fs.rmSync(dir,{recursive:true,force:true});
 });
 const datos=fuente();const archivo=path.join(dir,"db.json");fs.writeFileSync(archivo,JSON.stringify(datos));
 const copia=fs.readFileSync(archivo);const opciones={backupDir:path.join(dir,"backup")};
 const sistema=crearSistema({pool});
 let admin,tokenAdmin,tokenCliente,api;
 await t.test("Conexión y migraciones desde esquema vacío; repetición sin cambios",async()=>{
  assert.equal((await pool.query("SELECT 1 AS valor")).rows[0].valor,1);
  const primera=await migrar(pool,{esquemaControl:control});assert.ok(primera.every(r=>r.estado==="aplicada"));
  const segunda=await migrar(pool,{esquemaControl:control});assert.ok(segunda.every(r=>r.estado==="ya_aplicada"));
 });
 await t.test("16 tablas de negocio, tabla técnica, UUID y TIMESTAMPTZ",async()=>{
  const tablas=(await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE'",[schema])).rows.map(r=>r.table_name);
  assert.equal(tablas.length,16);assert.ok(tablas.includes("errores_sistema"));
  assert.ok((await pool.query(`SELECT count(*)::int AS n FROM ${control}.schema_migrations`)).rows[0].n >= 5);
  const campos=(await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='usuarios'",[schema])).rows;
  assert.equal(campos.find(c=>c.column_name==="id_usuario").data_type,"uuid");
  assert.equal(campos.find(c=>c.column_name==="fecha_creacion").data_type,"timestamp with time zone");
 });
 await t.test("Importación atómica y verificación; fuente y respaldo intactos",async()=>{
  const r=await importarJson(pool,archivo,opciones);assert.equal(r.verificada,true);
  assert.deepEqual(fs.readFileSync(archivo),copia);
  const respaldo=path.join(opciones.backupDir,fs.readdirSync(opciones.backupDir)[0]);assert.deepEqual(fs.readFileSync(respaldo),copia);
  assert.equal((await verificarImportacion(pool,archivo)).resumen.conversaciones,1);
 });
 await t.test("UUID, hashes y datos cifrados se conservan exactamente; no se inventa consentimiento",async()=>{
  const u=(await pool.query("SELECT * FROM usuarios WHERE id_usuario=$1",[datos.usuarios[0].id])).rows[0];
  assert.equal(u.password_hash,datos.usuarios[0].passwordHash);assert.equal(u.apellido,null);
  const p=(await pool.query("SELECT * FROM perfil_cliente WHERE id_usuario=$1",[u.id_usuario])).rows[0];
  assert.equal(p.id_perfil,datos.usuarios[0].perfilSalud.id);assert.equal(p.autoriza_contexto_ia,null);
  for(const campo of ["condicionesMedicas","alergias","objetivoNutricional","versionCifrado"])assert.equal(p.datos_legado[campo],datos.usuarios[0].perfilSalud[campo]);
  const mensajes=(await pool.query("SELECT * FROM mensajes_ia WHERE id_conversacion=$1",[datos.consultas[0].id])).rows;
  assert.equal(mensajes.length,1);assert.equal(mensajes[0].contenido,datos.consultas[0].texto);assert.equal(mensajes[0].tipo,"USUARIO");
  const conv=(await pool.query("SELECT * FROM conversaciones_ia WHERE id_conversacion=$1",[datos.consultas[0].id])).rows[0];
  assert.equal(conv.estado,"ERROR");assert.equal(conv.id_interaccion_origen,datos.interacciones[0].id);
  assert.equal(conv.revisada,false);assert.equal(conv.fecha_actualizacion,null);assert.equal(conv.titulo,null);
 });
 await t.test("Productos incompletos inactivos, precio desconocido e inventario ausente",async()=>{
  const p=(await pool.query("SELECT * FROM productos WHERE id_producto=$1",[datos.productos[0].id])).rows[0];
  assert.equal(p.estado,false);assert.equal(p.precio,null);assert.equal(p.stock_minimo,null);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM inventario")).rows[0].n,0);
  assert.deepEqual(await sistema.repositorios.productos.listarDisponiblesIA(),[]);
 });
 await t.test("Reimportación idéntica y conflicto sin escritura parcial",async()=>{
  await importarJson(pool,archivo,opciones);
  const alterados=structuredClone(datos);alterados.usuarios[0].nombre="Nombre diferente";
  const conflicto=path.join(dir,"conflicto.json");fs.writeFileSync(conflicto,JSON.stringify(alterados));
  await assert.rejects(importarJson(pool,conflicto,opciones),/IMPORTACION_CONFLICTO/);
  assert.equal((await verificarImportacion(pool,archivo)).verificada,true);
 });
 await t.test("PK, FK y correo único normalizado",async()=>{
  await assert.rejects(pool.query("INSERT INTO categorias(id_categoria,nombre) SELECT id_categoria,'Duplicada' FROM categorias LIMIT 1"),{code:"23505"});
  await assert.rejects(pool.query("INSERT INTO inventario(id_producto,cantidad) VALUES($1,0)",[randomUUID()]),{code:"23503"});
  await assert.rejects(pool.query("INSERT INTO usuarios(id_usuario,id_rol,nombre,correo,password_hash) SELECT $1,id_rol,nombre,upper(correo),password_hash FROM usuarios LIMIT 1",[randomUUID()]),{code:"23505"});
 });
 await t.test("CHECK de precio, stock, cantidades, estados y tipos; errores sin usuario",async()=>{
  const producto=datos.productos[0].id,usuario=datos.usuarios[0].id;
  for(const precio of [0,-1,"NaN"])await assert.rejects(pool.query("UPDATE productos SET precio=$2 WHERE id_producto=$1",[producto,precio]),{code:"23514"});
  await assert.rejects(pool.query("UPDATE productos SET estado=TRUE WHERE id_producto=$1",[producto]),{code:"23514"});
  await assert.rejects(pool.query("INSERT INTO inventario(id_producto,cantidad) VALUES($1,-1)",[producto]),{code:"23514"});
  await assert.rejects(pool.query("INSERT INTO movimientos_inventario(id_producto,id_usuario,tipo,cantidad,existencia_anterior,existencia_nueva,motivo) VALUES($1,$2,'ENTRADA',0,0,0,'Prueba')",[producto,usuario]),{code:"23514"});
  await assert.rejects(pool.query("INSERT INTO movimientos_inventario(id_producto,id_usuario,tipo,cantidad,existencia_anterior,existencia_nueva,motivo) VALUES($1,$2,'OTRO',1,0,1,'Prueba')",[producto,usuario]),{code:"23514"});
  await assert.rejects(pool.query("INSERT INTO pedidos(id_cliente,estado,subtotal,total) VALUES($1,'OTRO',1,1)",[usuario]),{code:"23514"});
  await assert.rejects(pool.query("INSERT INTO mensajes_ia(id_conversacion,tipo,contenido,version_cifrado) VALUES($1,'OTRO','sintetico',2)",[datos.consultas[0].id]),{code:"23514"});
  await pool.query("INSERT INTO errores_sistema(servicio,codigo,mensaje) VALUES('PRUEBA','PRUEBA','Dato sintético')");
 });
 await t.test("Cardinalidad mínima de pedidos y conversaciones se protege al COMMIT",async()=>{
  await assert.rejects(transaccion(pool,db=>db.query("INSERT INTO pedidos(id_cliente,subtotal,total) VALUES($1,1,1)",[datos.usuarios[0].id])),{code:"23514"});
  await assert.rejects(transaccion(pool,db=>db.query("INSERT INTO conversaciones_ia(id_conversacion,id_usuario,estado) VALUES($1,$2,'PENDIENTE')",[randomUUID(),datos.usuarios[0].id])),{code:"23514"});
 });
 await t.test("COMMIT y ROLLBACK reales sin lógica comercial ficticia",async()=>{
  await transaccion(pool,db=>db.query("INSERT INTO categorias(nombre) VALUES($1)",["Commit sintético"]));
  await assert.rejects(transaccion(pool,async db=>{await db.query("INSERT INTO categorias(nombre) VALUES($1)",["Rollback sintético"]);throw new Error("rollback deliberado");}));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM categorias WHERE nombre=$1",["Commit sintético"])).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM categorias WHERE nombre=$1",["Rollback sintético"])).rows[0].n,0);
 });
 await t.test("Repositorio usuarios: login, hash y rechazo de inyección como dato",async()=>{
  const usuario=await sistema.login({correo:datos.usuarios[0].correo,password:"Clave12345"});assert.equal(usuario.id,datos.usuarios[0].id);
  assert.equal(await sistema.repositorios.usuarios.buscarPorCorreo("' OR 1=1 --"),null);
  assert.equal(usuario.datosPublicos().passwordHash,undefined);
 });
 await t.test("Perfil: nuevos datos normalizados, cifrados y legado inmutable",async()=>{
  const previo=(await pool.query("SELECT datos_legado FROM perfil_cliente WHERE id_usuario=$1",[datos.usuarios[0].id])).rows[0].datos_legado;
  await sistema.perfil.actualizar(datos.usuarios[0].id,{alergias:"Nueva ficticia",objetivoNutricional:"Nuevo ficticio"});
  const perfil=await sistema.perfil.obtener(datos.usuarios[0].id);assert.equal(perfil.alergias,"Nueva ficticia");assert.equal(perfil.condicionesMedicas,"");
  const filas=(await pool.query("SELECT descripcion,version_cifrado FROM preferencias_cliente WHERE id_usuario=$1",[datos.usuarios[0].id])).rows;
  assert.equal(filas.length,3);assert.ok(filas.every(r=>r.version_cifrado===2&&!r.descripcion.includes("fictic")));
  assert.deepEqual((await pool.query("SELECT datos_legado FROM perfil_cliente WHERE id_usuario=$1",[datos.usuarios[0].id])).rows[0].datos_legado,previo);
 });
 await t.test("API PostgreSQL: login, catálogo, historial propio y aislamiento",async()=>{
  const server=crearApp(sistema).listen(0,"127.0.0.1");await new Promise(r=>server.once("listening",r));t.after(()=>new Promise(r=>server.close(r)));
  api=async(method,ruta,body,token)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${ruta}`,{method,headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.status===204?null:await r.json()};};
  const login=await api("POST","/auth/login",{correo:datos.usuarios[0].correo,password:"Clave12345"});assert.equal(login.status,200);tokenCliente=login.data.token;
  assert.equal((await api("GET","/productos",null,tokenCliente)).status,200);
  assert.equal((await api("GET","/consultas",null,tokenCliente)).data.consultas.length,1);
  const otro=await api("POST","/auth/register",{nombre:"Otro sintético",correo:"otro@example.test",password:"Clave12345"});
  assert.equal(otro.status,201);assert.deepEqual((await api("GET","/consultas",null,otro.data.token)).data.consultas,[]);
  assert.equal((await api("GET","/consultas/admin",null,tokenCliente)).status,403);
  assert.equal((await api("GET","/perfil")).status,401);
 });
 await t.test("Sin IA configurada: HTTP 503 controlado y nuevo historial ERROR",async()=>{
  const res=await api("POST","/consultas",{texto:"Consulta sintética"},tokenCliente);
  assert.equal(res.status,503);assert.equal(res.data.codigo,"SERVICIO_IA_NO_CONFIGURADO");
  const historial=(await api("GET","/consultas",null,tokenCliente)).data.consultas;
  assert.equal(historial.length,2);assert.ok(historial.every(c=>c.estado==="ERROR"&&c.respuestaIA===null));
  assert.equal((await api("GET","/perfil",null,tokenCliente)).status,200);
 });
 await t.test("Empleado legado migrado no administra; administrador explícito sí",async()=>{
  const {PersonalNutriVida,Administrador}=require("../src/domain/modelos");const {hashPassword,generarToken}=require("../src/security/auth");
  const hash=await hashPassword("Clave12345");const empleado=new PersonalNutriVida({nombre:"Legado sintético",correo:"legado@example.test",passwordHash:hash});
  await sistema.repositorios.usuarios.guardar(empleado);
  const login=await api("POST","/auth/login",{correo:empleado.correo,password:"Clave12345"});assert.equal(login.data.usuario.rol,"EMPLEADO");assert.deepEqual(login.data.usuario.permisos,["GESTIONAR_INVENTARIO"]);
  assert.equal((await api("GET","/productos",null,login.data.token)).status,200);
  assert.equal((await api("POST","/productos",{nombre:"No autorizado"},login.data.token)).status,403);
  admin=new Administrador({nombre:"Admin sintético",correo:"admin@example.test",passwordHash:hash});await sistema.repositorios.usuarios.guardar(admin);tokenAdmin=generarToken(admin);
  assert.equal((await api("GET","/consultas/admin",null,tokenAdmin)).status,200);
 });
 await t.test("Productos nuevos usan columnas y relaciones; revisión funciona",async()=>{
  const categoria=(await api("POST","/categorias",{nombre:"Prueba comercial"},tokenAdmin)).data.categoria;
  const avena=(await api("POST","/ingredientes",{nombre:"Avena"},tokenAdmin)).data.ingrediente;
  const agua=(await api("POST","/ingredientes",{nombre:"Agua"},tokenAdmin)).data.ingrediente;
  const nuevo=await api("POST","/productos",{nombre:"Nuevo sintético",categoriaId:categoria.id,ingredientes:[{id:avena.id},{id:agua.id}],valoresNutricionales:"Declarados"},tokenAdmin);assert.equal(nuevo.status,201);
  const id=nuevo.data.producto.id;const raw=(await pool.query("SELECT * FROM productos WHERE id_producto=$1",[id])).rows[0];assert.equal(raw.datos_legado,null);assert.equal(raw.estado,false);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM producto_ingrediente WHERE id_producto=$1",[id])).rows[0].n,2);
  assert.equal((await api("PUT",`/productos/${id}`,{nombre:"Actualizado",ingredientes:[]},tokenAdmin)).status,200);
  assert.equal((await api("DELETE",`/productos/${id}`,null,tokenAdmin)).status,204);
  assert.equal((await api("PUT",`/consultas/${datos.consultas[0].id}/revisar`,{},tokenAdmin)).data.consulta.revisada,true);
 });
 await t.test("FASE3 PostgreSQL: auditoría anónima con FK conservada y login identificado",async()=>{
  assert.equal((await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='auditoria' AND column_name='id_usuario'",[schema])).rows[0].is_nullable,"YES");
  const previo=Number((await pool.query("SELECT count(*) AS n FROM auditoria WHERE accion='LOGIN_FALLIDO' AND id_usuario IS NULL")).rows[0].n);
  for(const correo of ["ausente@example.test",datos.usuarios[0].correo])assert.equal((await api("POST","/auth/login",{correo,password:"Incorrecta"})).status,401);
  assert.equal(Number((await pool.query("SELECT count(*) AS n FROM auditoria WHERE accion='LOGIN_FALLIDO' AND id_usuario IS NULL")).rows[0].n),previo+2);
  assert.equal((await api("POST","/auth/login",{correo:datos.usuarios[0].correo,password:"Clave12345"})).status,200);
  assert.ok((await pool.query("SELECT 1 FROM auditoria WHERE accion='LOGIN_EXITOSO' AND id_usuario=$1",[datos.usuarios[0].id])).rowCount>0);
  await assert.rejects(pool.query("INSERT INTO auditoria(id_auditoria,id_usuario,accion) VALUES($1,$2,'PRUEBA')",[randomUUID(),randomUUID()]),{code:"23503"});
  const eventos=(await pool.query("SELECT accion,recurso_accedido,datos_anteriores,datos_nuevos FROM auditoria WHERE accion IN ('LOGIN_FALLIDO','LOGIN_EXITOSO')")).rows;
  assert.ok(!JSON.stringify(eventos).includes("Incorrecta"));assert.ok(eventos.every(e=>e.datos_anteriores===null&&e.datos_nuevos===null));
 });
 await t.test("FASE3 PostgreSQL: desactivación y cambio de rol afectan JWT existentes",async()=>{
  await pool.query("UPDATE usuarios SET estado=FALSE WHERE id_usuario=$1",[datos.usuarios[0].id]);
  assert.equal((await api("GET","/perfil",null,tokenCliente)).status,401);
  assert.equal((await api("POST","/auth/login",{correo:datos.usuarios[0].correo,password:"Clave12345"})).status,401);
  await pool.query("UPDATE usuarios SET estado=TRUE WHERE id_usuario=$1",[datos.usuarios[0].id]);
  await pool.query("UPDATE usuarios SET id_rol=(SELECT id_rol FROM roles WHERE nombre='EMPLEADO') WHERE id_usuario=$1",[admin.id]);
  assert.equal((await api("GET","/consultas/admin",null,tokenAdmin)).status,403);
  await pool.query("UPDATE usuarios SET id_rol=(SELECT id_rol FROM roles WHERE nombre='ADMINISTRADOR') WHERE id_usuario=$1",[admin.id]);
 });
 await t.test("FASE3 PostgreSQL: logout durable sin JWT en auditoría",async()=>{
  assert.equal((await api("POST","/auth/logout",{},tokenCliente)).status,204);
  assert.equal((await api("GET","/perfil",null,tokenCliente)).status,401);
  const evento=(await pool.query("SELECT recurso_accedido FROM auditoria WHERE accion='LOGOUT' AND id_usuario=$1",[datos.usuarios[0].id])).rows[0];
  assert.match(evento.recurso_accedido,/^sesion\/[a-f0-9]{64}$/);assert.ok(!evento.recurso_accedido.includes(tokenCliente));
  const recargado=crearSistema({pool});assert.equal(await recargado.repositorios.auditoria.sesionRevocada(evento.recurso_accedido),true);
  const login=await api("POST","/auth/login",{correo:datos.usuarios[0].correo,password:"Clave12345"});assert.equal((await api("GET","/perfil",null,login.data.token)).status,200);
 });

});
