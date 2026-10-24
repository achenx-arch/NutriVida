const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { transaccion } = require("./transaccion");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CIFRADO = /^[a-f0-9]{24}:[a-f0-9]{32}:(?:[a-f0-9]{2})+$/i;
const propias = (obj, campos) => Object.fromEntries(campos.filter(k => Object.hasOwn(obj,k)).map(k => [k,obj[k]]));
function fallo(codigo) { throw new Error(codigo); }
function exigir(ok, codigo) { if (!ok) fallo(codigo); }
function campos(obj, admitidos) { exigir(obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).every(k=>admitidos.includes(k)), "JSON_CAMPOS_NO_ADMITIDOS"); }
function cadena(v,max) { exigir(typeof v === "string" && v.length > 0 && v.length <= max, "JSON_TEXTO_INVALIDO"); }
function fecha(v) { exigir(typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)), "JSON_FECHA_INVALIDA"); return new Date(v).toISOString(); }
function cifrado(v, nullable=false) { exigir((nullable && v===null) || (typeof v === "string" && CIFRADO.test(v)), "JSON_CIFRADO_INVALIDO"); }
function analizarJson(datos) {
  campos(datos,["versionEsquema","usuarios","productos","consultas","interacciones","auditoria"]);
  exigir(datos.versionEsquema===2,"JSON_VERSION_NO_ADMITIDA");
  const nombres=["usuarios","productos","consultas","interacciones","auditoria"];
  const camposPorColeccion={
    usuarios:["id","nombre","correo","passwordHash","rol","createdAt","perfilSalud","area"],
    productos:["id","nombre","categoria","ingredientes","valoresNutricionales"],
    consultas:["id","clienteId","texto","fecha","estado","versionCifrado"],
    interacciones:["id","consultaId","clienteId","consulta","respuestaIA","fecha","revisada","versionCifrado"],
    auditoria:["id","usuarioId","accion","recursoAccedido","fecha"],
  };
  for (const nombre of nombres) {
    exigir(Array.isArray(datos[nombre]),"JSON_COLECCION_INVALIDA");
    const ids=new Set();
    for (const r of datos[nombre]) {
      campos(r,camposPorColeccion[nombre]); exigir(UUID.test(r.id),"JSON_UUID_INVALIDO");
      exigir(!ids.has(r.id),"JSON_UUID_DUPLICADO"); ids.add(r.id);
    }
  }
  const usuarios=new Map(datos.usuarios.map(u=>[u.id,u]));
  const consultas=new Map(datos.consultas.map(q=>[q.id,q]));
  const correos=new Set(), perfiles=new Set();
  for (const u of datos.usuarios) {
    cadena(u.nombre,80); cadena(u.correo,150);
    exigir(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.correo),"JSON_CORREO_INVALIDO");
    const correo=u.correo.trim().toLowerCase(); exigir(!correos.has(correo),"JSON_CORREO_DUPLICADO"); correos.add(correo);
    exigir(/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(u.passwordHash),"JSON_HASH_INVALIDO");
    exigir(["CLIENTE","EMPLEADO","ADMINISTRADOR","PERSONAL_NUTRIVIDA"].includes(u.rol),"JSON_ROL_INVALIDO"); fecha(u.createdAt);
    if (u.area!==undefined) cadena(u.area,150);
    if (u.perfilSalud!=null) {
      const p=u.perfilSalud; campos(p,["id","condicionesMedicas","alergias","objetivoNutricional","versionCifrado"]);
      exigir(UUID.test(p.id)&&!perfiles.has(p.id),"JSON_PERFIL_ID_INVALIDO"); perfiles.add(p.id);
      exigir(p.versionCifrado===2,"JSON_CIFRADO_VERSION_INVALIDA");
      for (const k of ["condicionesMedicas","alergias","objetivoNutricional"]) cifrado(p[k],true);
    }
  }
  for (const p of datos.productos) {
    cadena(p.nombre,120); cadena(p.categoria,80);
    for (const k of ["ingredientes","valoresNutricionales"]) exigir(typeof p[k]==="string","JSON_PRODUCTO_INVALIDO");
  }
  for (const q of datos.consultas) {
    exigir(usuarios.has(q.clienteId),"JSON_CONSULTA_HUERFANA");
    exigir(["PENDIENTE","RESPONDIDA","ERROR"].includes(q.estado),"JSON_ESTADO_INVALIDO");
    exigir(q.versionCifrado===2,"JSON_CIFRADO_VERSION_INVALIDA"); cifrado(q.texto); fecha(q.fecha);
  }
  const porConsulta=new Map();
  for (const i of datos.interacciones) {
    const q=consultas.get(i.consultaId);
    exigir(q && q.clienteId===i.clienteId,"JSON_INTERACCION_HUERFANA");
    exigir(!porConsulta.has(i.consultaId),"JSON_INTERACCION_DUPLICADA"); porConsulta.set(i.consultaId,i);
    exigir(i.versionCifrado===2,"JSON_CIFRADO_VERSION_INVALIDA"); cifrado(i.consulta); cifrado(i.respuestaIA,true); fecha(i.fecha);
    exigir(typeof i.revisada==="boolean","JSON_REVISION_INVALIDA");
  }
  for (const a of datos.auditoria) {
    exigir(usuarios.has(a.usuarioId),"JSON_AUDITORIA_HUERFANA"); cadena(a.accion,80); cadena(a.recursoAccedido,500); fecha(a.fecha);
  }
  const resumen={usuarios:datos.usuarios.length, perfiles:perfiles.size, productos:datos.productos.length,
    categorias:new Set(datos.productos.map(p=>p.categoria)).size, conversaciones:datos.consultas.length,
    mensajesUsuario:datos.consultas.length, mensajesAsistente:datos.interacciones.filter(i=>i.respuestaIA!==null).length,
    interacciones:datos.interacciones.length, auditoria:datos.auditoria.length, inventario:0};
  return { datos, resumen, porConsulta };
}
function leerFuente(archivo) {
  const bytes=fs.readFileSync(archivo);
  let datos;
  try { datos=JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,"")); }
  catch { fallo("JSON_INVALIDO"); }
  return {...analizarJson(datos),bytes,sha256:createHash("sha256").update(bytes).digest("hex")};
}
// Identificadores SQL exclusivamente de esta lista constante. Los valores siempre son parámetros.
const estructuras={
 usuarios:["id_usuario","id_rol","nombre","apellido","correo","password_hash","estado","fecha_creacion","fecha_actualizacion","datos_legado"],
 perfil_cliente:["id_perfil","id_usuario","telefono","fecha_nacimiento","observaciones","autoriza_contexto_ia","fecha_actualizacion","datos_legado"],
 productos:["id_producto","id_categoria","nombre","descripcion","precio","stock_minimo","imagen_url","estado","fecha_creacion","fecha_actualizacion","valores_nutricionales","datos_legado"],
 conversaciones_ia:["id_conversacion","id_usuario","titulo","fecha_inicio","fecha_actualizacion","estado","revisada","id_interaccion_origen","datos_legado"],
 auditoria:["id_auditoria","id_usuario","accion","entidad","id_entidad","recurso_accedido","datos_anteriores","datos_nuevos","ip","fecha"],
};
const normalizar=(v)=>v instanceof Date?v.toISOString():v;
async function fila(db,tabla,esperado,escribir,diferencias=null) {
  const columnas=estructuras[tabla]; exigir(!!columnas,"IMPORTACION_TABLA_INVALIDA");
  const pk=columnas[0];
  const anterior=await db.query(`SELECT ${columnas.join(",")} FROM ${tabla} WHERE ${pk}=$1`,[esperado[pk]]);
  if (anterior.rowCount) {
    const distintos=columnas.filter(k=>!isDeepStrictEqual(normalizar(anterior.rows[0][k]),esperado[k]??null));
    // Importación: estricto. Verificación: se recolectan para clasificarlas después.
    if(distintos.length && diferencias) diferencias.push({tabla,id:String(esperado[pk]),campos:distintos,actual:anterior.rows[0],esperado});
    else exigir(!distintos.length,"IMPORTACION_CONFLICTO");
    return false;
  }
  exigir(escribir,"IMPORTACION_INCOMPLETA");
  await db.query(`INSERT INTO ${tabla} (${columnas.join(",")}) VALUES (${columnas.map((_,i)=>"$"+(i+1)).join(",")})`,columnas.map(k=>esperado[k]??null));
  return true;
}
async function transferir(db,fuente,escribir,diferencias=null) {
  const {datos,porConsulta}=fuente;
  const roles=new Map((await db.query("SELECT nombre,id_rol FROM roles")).rows.map(r=>[r.nombre,r.id_rol]));
  exigir(["CLIENTE","EMPLEADO","ADMINISTRADOR"].every(r=>roles.has(r)),"ROLES_NO_INICIALIZADOS");
  const categorias=new Map();
  for (const nombre of new Set(datos.productos.map(p=>p.categoria))) {
    let r=await db.query("SELECT id_categoria FROM categorias WHERE nombre=$1",[nombre]);
    if(!r.rowCount){
      exigir(escribir,"IMPORTACION_INCOMPLETA");
      r=await db.query("INSERT INTO categorias(nombre,fecha_creacion) VALUES($1,NULL) RETURNING id_categoria",[nombre]);
    }
    categorias.set(nombre,r.rows[0].id_categoria);
  }
  for(const u of datos.usuarios){
    await fila(db,"usuarios",{id_usuario:u.id,id_rol:roles.get(u.rol==="PERSONAL_NUTRIVIDA"?"EMPLEADO":u.rol),nombre:u.nombre,
      correo:u.correo,password_hash:u.passwordHash,estado:true,fecha_creacion:fecha(u.createdAt),
      datos_legado:{...propias(u,["area"]),rol_origen:u.rol}},escribir,diferencias);
    if(u.perfilSalud) await fila(db,"perfil_cliente",{id_perfil:u.perfilSalud.id,id_usuario:u.id,
      datos_legado:propias(u.perfilSalud,["condicionesMedicas","alergias","objetivoNutricional","versionCifrado"])},escribir,diferencias);
  }
  for(const p of datos.productos) await fila(db,"productos",{id_producto:p.id,id_categoria:categorias.get(p.categoria),nombre:p.nombre,estado:false,
    datos_legado:propias(p,["ingredientes","valoresNutricionales"])},escribir,diferencias);
  for(const q of datos.consultas){
    const i=porConsulta.get(q.id);
    const nueva=await fila(db,"conversaciones_ia",{id_conversacion:q.id,id_usuario:q.clienteId,fecha_inicio:fecha(q.fecha),estado:q.estado,
      revisada:i?.revisada??null,id_interaccion_origen:i?.id??null,
      datos_legado:{versionCifrado:q.versionCifrado,...(i?{consultaInteraccionCifrada:i.consulta,fechaInteraccion:i.fecha,versionCifradoInteraccion:i.versionCifrado}:{})}},escribir,diferencias);
    const mensajes=[{tipo:"USUARIO",contenido:q.texto,fecha:fecha(q.fecha),version_cifrado:2}];
    if(i?.respuestaIA!=null) mensajes.push({tipo:"ASISTENTE",contenido:i.respuestaIA,fecha:fecha(i.fecha),version_cifrado:2});
    if(nueva) for(const m of mensajes) await db.query("INSERT INTO mensajes_ia(id_conversacion,tipo,contenido,fecha,version_cifrado) VALUES($1,$2,$3,$4,$5)",[q.id,m.tipo,m.contenido,m.fecha,m.version_cifrado]);
    const guardados=(await db.query("SELECT tipo,contenido,fecha,version_cifrado FROM mensajes_ia WHERE id_conversacion=$1 ORDER BY id_mensaje",[q.id])).rows;
    exigir(isDeepStrictEqual(guardados.map(m=>({...m,fecha:normalizar(m.fecha)})),mensajes),"IMPORTACION_MENSAJES_CONFLICTO");
  }
  for(const a of datos.auditoria){
    const partes=a.recursoAccedido.split("/");
    const simple=partes.length===2 && ["usuarios","productos","consultas"].includes(partes[0]) && UUID.test(partes[1]);
    await fila(db,"auditoria",{id_auditoria:a.id,id_usuario:a.usuarioId,accion:a.accion,recurso_accedido:a.recursoAccedido,
      entidad:simple?partes[0]:null,id_entidad:simple?partes[1]:null,fecha:fecha(a.fecha)},escribir,diferencias);
  }
  // Ninguna existencia debe inventarse durante importación.
  const inventario=await db.query("SELECT count(*)::int AS cantidad FROM inventario WHERE id_producto=ANY($1::uuid[])",[datos.productos.map(p=>p.id)]);
  exigir(inventario.rows[0].cantidad===0,"IMPORTACION_INVENTARIO_CONFLICTO");
  return fuente.resumen;
}
async function importarJson(pool,archivo,{backupDir=path.resolve("data/backups")}={}) {
  const fuente=leerFuente(archivo); // Validación completa antes de cualquier escritura.
  fs.mkdirSync(backupDir,{recursive:true});
  const respaldo=path.join(backupDir,`db-${fuente.sha256}.json`);
  if(!fs.existsSync(respaldo)) fs.writeFileSync(respaldo,fuente.bytes,{flag:"wx"});
  exigir(fs.readFileSync(respaldo).equals(fuente.bytes),"RESPALDO_NO_COINCIDE");
  return transaccion(pool,async db=>{
    await db.query("SELECT pg_advisory_xact_lock(20660202)");
    const resumen=await transferir(db,fuente,true);
    await transferir(db,fuente,false);
    exigir(fs.readFileSync(archivo).equals(fuente.bytes),"JSON_CAMBIO_DURANTE_IMPORTACION");
    return {resumen,verificada:true};
  });
}
// ---- Verificación en dos niveles ----
// A) INTEGRIDAD HISTÓRICA ESTRICTA: UUID, password_hash, fecha_creacion, datos_legado (cifrado
//    heredado), conversaciones y mensajes heredados, auditoría importada y rol salvo CAMBIO_ROL auditado.
// B) CAMBIO_POSTERIOR_AUDITADO: campos mutables por la operación normal, solo con evidencia en auditoría
//    posterior (no importada). Cualquier diferencia sin evidencia sigue siendo IMPORTACION_CONFLICTO.
const VENTANA_MS=5000;
// FASE 9A: los cambios de consentimiento (auditados en la misma transacción) también actualizan perfil_cliente.
const EVENTOS_CONSENTIMIENTO=["consentimiento_perfil_ia_otorgado","consentimiento_perfil_ia_revocado","consentimiento_historial_ia_otorgado","consentimiento_historial_ia_revocado"];
const MODIFICADORAS_USUARIO=["actualizacion_perfil_salud","CAMBIO_ROL",...EVENTOS_CONSENTIMIENTO];
const MUTABLES={
  usuarios:["fecha_actualizacion","id_rol","estado"],
  perfil_cliente:["fecha_actualizacion","telefono","fecha_nacimiento","observaciones","autoriza_contexto_ia"],
  productos:["id_categoria","nombre","descripcion","precio","stock_minimo","imagen_url","estado","fecha_actualizacion","valores_nutricionales"],
  conversaciones_ia:[], auditoria:[],
};
const CAMPOS_REVISION=["revisada","fecha_actualizacion"];
async function evidenciaRevision(db,dif,importadas){
  const {actual,esperado}=dif;
  if(!dif.campos.every(c=>CAMPOS_REVISION.includes(c))) return null;        // 1. solo revisada / fecha_actualizacion
  if(actual.revisada!==true || esperado.revisada===true && dif.campos.includes("revisada")) return null; // 2. false/vacío → true
  if(actual.id_interaccion_origen==null || !actual.fecha_actualizacion) return null;                  // 6. conserva la interacción
  return (await db.query(`SELECT a.accion,a.fecha FROM auditoria a JOIN usuarios u ON u.id_usuario=a.id_usuario JOIN roles r ON r.id_rol=u.id_rol
    WHERE NOT (a.id_auditoria=ANY($1::uuid[])) AND a.accion='revision_consulta'
      AND a.recurso_accedido='consultas/'||$2::text                                                    -- 3. exactamente esta conversación
      AND r.nombre IN ('EMPLEADO','ADMINISTRADOR') AND a.id_usuario<>$3::uuid                          -- 5. personal, no el propietario
      AND a.fecha BETWEEN $4::timestamptz - make_interval(secs=>$5::float8) AND $4::timestamptz + make_interval(secs=>$5::float8) -- 4. ≤ 5 s
    ORDER BY abs(extract(epoch FROM a.fecha-$4::timestamptz)) LIMIT 1`,
    [importadas,dif.id,actual.id_usuario,actual.fecha_actualizacion,VENTANA_MS/1000])).rows[0]||null;
}
async function evidencia(db,dif,importadas,roles){
  const auditoriaPosterior=async(sql,args)=>(await db.query(`SELECT accion,fecha,datos_nuevos FROM auditoria WHERE NOT (id_auditoria=ANY($1::uuid[])) AND ${sql}`,[importadas,...args])).rows;
  const cerca=async(uid,fecha)=>fecha?(await auditoriaPosterior(`(id_usuario::text=$2 OR id_entidad=$2 OR recurso_accedido LIKE '%'||$2||'%') AND accion=ANY($3::text[])
    AND fecha BETWEEN $4::timestamptz - make_interval(secs=>$5::float8) AND $4::timestamptz + make_interval(secs=>$5::float8) ORDER BY fecha LIMIT 1`,[uid,MODIFICADORAS_USUARIO,fecha,VENTANA_MS/1000]))[0]:null;
  const resultado=[];
  // Conversación heredada marcada como revisada por el personal ("Marcar como revisada"): es la ÚNICA
  // excepción para conversaciones_ia; mensajes, contenido, estado, propietario y datos heredados siguen estrictos.
  const revision=dif.tabla==="conversaciones_ia"?await evidenciaRevision(db,dif,importadas):null;
  for(const campo of dif.campos){
    let ev=null;
    if(revision) ev=revision;
    else if(!MUTABLES[dif.tabla].includes(campo)) ev=null; // crítico
    else if(dif.tabla==="usuarios" && campo==="id_rol"){
      const rolActual=[...roles].find(([,id])=>String(id)===String(dif.actual.id_rol))?.[0];
      const ultimo=(await auditoriaPosterior(`accion='CAMBIO_ROL' AND entidad='usuarios' AND id_entidad=$2 ORDER BY fecha DESC LIMIT 1`,[dif.id]))[0];
      ev=ultimo && ultimo.datos_nuevos?.rol===rolActual?ultimo:null;
    } else if(dif.tabla==="usuarios" && campo==="estado") ev=null; // no existe operación auditada de estado
    else if(dif.tabla==="usuarios") ev=await cerca(dif.id,dif.actual.fecha_actualizacion);
    // autoriza_contexto_ia: solo con el ÚLTIMO evento de consentimiento de perfil de ESE usuario y coherente con el valor actual.
    else if(dif.tabla==="perfil_cliente" && campo==="autoriza_contexto_ia"){
      const ultimo=(await auditoriaPosterior(`accion IN ('consentimiento_perfil_ia_otorgado','consentimiento_perfil_ia_revocado') AND recurso_accedido='usuarios/'||$2 ORDER BY fecha DESC LIMIT 1`,[String(dif.actual.id_usuario)]))[0];
      ev=ultimo && (ultimo.accion==="consentimiento_perfil_ia_otorgado")===(dif.actual.autoriza_contexto_ia===true)?ultimo:null;
    }
    else if(dif.tabla==="perfil_cliente") ev=await cerca(String(dif.actual.id_usuario),dif.actual.fecha_actualizacion);
    else if(dif.tabla==="productos") ev=(await auditoriaPosterior(`entidad='productos' AND id_entidad=$2 ORDER BY fecha DESC LIMIT 1`,[dif.id]))[0]||null;
    resultado.push({campo,evidencia:ev?{accion:ev.accion,fecha:normalizar(ev.fecha)}:null});
  }
  return resultado;
}
async function verificarImportacion(pool,archivo){
  const fuente=leerFuente(archivo);
  return transaccion(pool,async db=>{
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const diferencias=[];
    const resumen=await transferir(db,fuente,false,diferencias); // mensajes heredados: siempre estricto
    const importadas=fuente.datos.auditoria.map(a=>a.id);
    const roles=new Map((await db.query("SELECT nombre,id_rol FROM roles")).rows.map(r=>[r.nombre,r.id_rol]));
    const cambiosPosteriores=[],conflictos=[];
    for(const d of diferencias){
      for(const c of await evidencia(db,d,importadas,roles)){
        // Sin valores: solo tabla, id, campo y evidencia (nunca hashes ni datos cifrados).
        if(c.evidencia) cambiosPosteriores.push({clasificacion:"CAMBIO_POSTERIOR_AUDITADO",tabla:d.tabla,id:d.id,campo:c.campo,evidencia:c.evidencia});
        else conflictos.push({tabla:d.tabla,id:d.id,campo:c.campo,critico:!MUTABLES[d.tabla].includes(c.campo)});
      }
    }
    if(conflictos.length){const e=new Error("IMPORTACION_CONFLICTO");e.codigo="IMPORTACION_CONFLICTO";e.conflictos=conflictos;e.cambiosPosteriores=cambiosPosteriores;throw e;}
    return {resumen,verificada:true,integridadHistorica:"OK",cambiosPosteriores};
  });
}
module.exports={analizarJson,leerFuente,importarJson,verificarImportacion};
