const {test}=require("node:test");const assert=require("node:assert/strict");
const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
process.env.JWT_SECRET="fase2-pruebas-locales";process.env.ENCRYPTION_KEY="ab".repeat(32);
const {fuente}=require("./fixtures/fase2");
const {analizarJson,importarJson}=require("../src/database/importacion");
const {transaccion}=require("../src/database/transaccion");
test("Importador: resumen exacto sin fabricar respuesta, consentimiento o inventario",()=>{
 const d=fuente();const previo=JSON.stringify(d);const r=analizarJson(d);
 assert.deepEqual(r.resumen,{usuarios:1,perfiles:1,productos:1,categorias:1,conversaciones:1,mensajesUsuario:1,mensajesAsistente:0,interacciones:1,auditoria:1,inventario:0});
 assert.equal(JSON.stringify(d),previo);
});
test("Importador: rechaza UUID, hashes, cifrado, duplicados y relaciones inválidas",()=>{
 const cambios=[d=>d.usuarios[0].id="no-uuid",d=>d.usuarios.push({...d.usuarios[0]}),d=>d.usuarios[0].passwordHash="texto-plano",d=>d.usuarios[0].perfilSalud.alergias="dato-sin-cifrar",d=>d.consultas[0].clienteId=require("node:crypto").randomUUID(),d=>d.interacciones[0].clienteId=require("node:crypto").randomUUID(),d=>d.productos[0].precio=123,d=>d.consultas[0].estado="INVENTADO",d=>d.versionEsquema=1,d=>d.interacciones.push({...d.interacciones[0],id:require("node:crypto").randomUUID()})];
 for(const cambiar of cambios){const d=fuente();cambiar(d);assert.throws(()=>analizarJson(d),/^Error: JSON_[A-Z_]+$/);}
});
test("Importador: una respuesta real incrementa solo el mensaje ASISTENTE esperado",()=>{
 const d=fuente();d.consultas[0].estado="RESPONDIDA";d.interacciones[0].respuestaIA=require("../src/security/crypto").cifrar("Respuesta ficticia");
 assert.equal(analizarJson(d).resumen.mensajesAsistente,1);
});
test("Transacción: mismo cliente, COMMIT y liberación",async()=>{
 const pasos=[];const cliente={query:async s=>pasos.push(s),release:v=>pasos.push(["release",v])};
 const resultado=await transaccion({connect:async()=>cliente},async c=>{assert.equal(c,cliente);await c.query("OPERACION");return 7;});
 assert.equal(resultado,7);assert.deepEqual(pasos,["BEGIN","OPERACION","COMMIT",["release",false]]);
});
test("Transacción: ROLLBACK ante fallo de operación o de COMMIT; descarta conexión si falla rollback",async()=>{
 for(const fallo of ["operacion","COMMIT","ROLLBACK"]){
  const pasos=[];const cliente={query:async s=>{pasos.push(s);if(s===fallo)throw new Error("simulado");},release:v=>pasos.push(["release",v])};
  await assert.rejects(transaccion({connect:async()=>cliente},async()=>{if(fallo!=="COMMIT")throw new Error("simulado");}));
  assert.ok(pasos.includes("ROLLBACK"));assert.deepEqual(pasos.at(-1),["release",fallo==="ROLLBACK"]);
 }
});
test("Consultas PostgreSQL separan valores maliciosos del SQL",async()=>{
 const enviados=[];const pool={query:async(sql,params)=>{enviados.push({sql,params});return {rows:[],rowCount:0};}};
 const ataque="' OR 1=1; DROP TABLE usuarios; --";
 const {RepositorioUsuarios}=require("../src/repositories/postgres/usuarios");
 await new RepositorioUsuarios(pool,{}).buscarPorCorreo(ataque);
 assert.equal(enviados[0].params[0],ataque);assert.ok(!enviados[0].sql.includes(ataque));assert.match(enviados[0].sql,/\$1/);
});
test("Fallo PostgreSQL no escribe en JSON y devuelve error controlado",async()=>{
 let escrituras=0;
 const pool={query:async()=>{throw Object.assign(new Error("detalle privado"),{code:"ECONNREFUSED"});},end:async()=>{}};
 const sistema=require("../src/services/sistema").crearSistema({pool,store:{insertar(){escrituras++;}}});
 await assert.rejects(sistema.catalogo.listar(),{codigo:"DB_NO_DISPONIBLE",status:503});assert.equal(escrituras,0);
});
test("Configuración PostgreSQL incompleta falla sin adivinar credenciales",()=>{
 const env=require("../src/config/env");const anterior=env.db;env.db={};
 try{assert.throws(()=>require("../src/database/pool").crearPool(),{codigo:"DB_NO_CONFIGURADA"});}finally{env.db=anterior;}
});
test("JSON inválido no abre transacción ni crea respaldo",async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"nv-import-unit-"));
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith("nv-import-unit-"));fs.rmSync(dir,{recursive:true,force:true});});
 const archivo=path.join(dir,"db.json");fs.writeFileSync(archivo,"{");let conexiones=0;
 await assert.rejects(importarJson({connect:async()=>{conexiones++;}},archivo,{backupDir:path.join(dir,"backup")}),/JSON_INVALIDO/);
 assert.equal(conexiones,0);assert.equal(fs.existsSync(path.join(dir,"backup")),false);
});
