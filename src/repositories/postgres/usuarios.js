const { Base,iso }=require("./base");
const { Usuario,Cliente,Empleado,Administrador,PerfilCliente }=require("../../domain/modelos");
const { normalizarRol }=require("../../domain/roles");
const { randomUUID }=require("node:crypto");
const { ErrorAplicacion }=require("../../errors/ErrorAplicacion");
// FASE 9A: consentimientos independientes. Solo TRUE autoriza; NULL/FALSE/ausente = no autorizado.
const CONSENTIMIENTOS={autorizaContextoIA:{columna:"autoriza_contexto_ia",evento:"perfil"},autorizaHistorialIA:{columna:"autoriza_historial_ia",evento:"historial"}};
const leerConsentimientos=p=>({autorizaContextoIA:p?.autoriza_contexto_ia===true,autorizaHistorialIA:p?.autoriza_historial_ia===true});
const TIPOS={condicionesMedicas:"CONDICION_DECLARADA",alergias:"ALERGIA_DECLARADA",objetivoNutricional:"OBJETIVO_GENERAL"};
// FASE 9B-2: datos alimentarios estructurados en la MISMA tabla preferencias_cliente (sin migración): una fila por grupo
// (tipos de catalogoAlimentacion.js) con la lista de códigos en JSON cifrado (AES-256-GCM, version_cifrado=2).
// guardar() solo reemplaza los 3 tipos de TIPOS, por lo que estas filas nunca se pierden al editar el perfil libre.
const {TIPOS_ALIMENTACION,GRUPOS,CATALOGO,vacia}=require("../../services/catalogoAlimentacion");
class RepositorioUsuarios extends Base {
 async hidratar(r){
  if(!r)return null;
  const p=(await this.query("SELECT * FROM perfil_cliente WHERE id_usuario=$1",[r.id_usuario])).rows[0];
  let perfil=null;
  if(p){
   const prefs=(await this.query("SELECT tipo,descripcion,version_cifrado FROM preferencias_cliente WHERE id_usuario=$1 AND activa=TRUE ORDER BY id_preferencia",[r.id_usuario])).rows;
   const datos={id:p.id_perfil};
   for(const [campo,tipo] of Object.entries(TIPOS)){
    const actual=prefs.filter(x=>x.tipo===tipo).at(-1);
    datos[campo]=actual?(actual.version_cifrado===2?this.seguridad.descifrarDatoSensible(actual.descripcion):actual.descripcion):this.seguridad.descifrarDatoSensible(p.datos_legado?.[campo]);
   }
   perfil=new PerfilCliente(datos);
  }
  const Clase={CLIENTE:Cliente,EMPLEADO:Empleado,ADMINISTRADOR:Administrador}[r.rol]||Usuario;
  const usuario=new Clase({id:r.id_usuario,nombre:r.nombre,correo:r.correo,passwordHash:r.password_hash,rol:r.rol,createdAt:iso(r.fecha_creacion),area:r.datos_legado?.area,perfilSalud:perfil});
  // El origen histórico nunca se convierte en permisos.
  Object.assign(usuario,leerConsentimientos(p));
  return usuario;
 }
 async buscarPorId(id){ return this.hidratar((await this.query("SELECT u.*,r.nombre AS rol FROM usuarios u JOIN roles r USING(id_rol) WHERE id_usuario=$1 AND u.estado=TRUE",[id])).rows[0]); }
 async buscarPorCorreo(correo){return this.hidratar((await this.query("SELECT u.*,r.nombre AS rol FROM usuarios u JOIN roles r USING(id_rol) WHERE lower(btrim(correo))=lower(btrim($1)) AND u.estado=TRUE",[correo])).rows[0]);}
 async listar(){return Promise.all((await this.query("SELECT u.*,r.nombre AS rol FROM usuarios u JOIN roles r USING(id_rol) ORDER BY id_usuario")).rows.map(r=>this.hidratar(r)));}
 async obtenerConsentimientos(idUsuario){
  return leerConsentimientos((await this.query("SELECT * FROM perfil_cliente WHERE id_usuario=$1",[idUsuario])).rows[0]);
 }
 // Actualiza SOLO los consentimientos indicados, en una transacción con bloqueo de fila (dos solicitudes
 // concurrentes no se sobrescriben entre sí) y registra en la MISMA transacción la auditoría de cada cambio
 // efectivo. Nunca crea TRUE implícitos: si no existía perfil, se crea con ambos consentimientos en NULL.
 async actualizarConsentimientos(idUsuario,cambios){
  try{
   return await this.tx(async db=>{
    await db.query("INSERT INTO perfil_cliente(id_perfil,id_usuario,fecha_actualizacion) VALUES($1,$2,CURRENT_TIMESTAMP) ON CONFLICT(id_usuario) DO NOTHING",[randomUUID(),idUsuario]);
    const actual=(await db.query("SELECT * FROM perfil_cliente WHERE id_usuario=$1 FOR UPDATE",[idUsuario])).rows[0];
    if(!Object.prototype.hasOwnProperty.call(actual,"autoriza_historial_ia"))
     throw new ErrorAplicacion("La gestión de consentimientos requiere aplicar la migración 007.",503,"MIGRACION_007_PENDIENTE");
    const antes=leerConsentimientos(actual),efectivos=[];
    for(const [campo,valor] of Object.entries(cambios)){
     if(!CONSENTIMIENTOS[campo]||typeof valor!=="boolean")throw new ErrorAplicacion("Consentimiento no válido.",400,"DATOS_INVALIDOS");
     if(antes[campo]!==valor)efectivos.push([campo,valor]);
    }
    if(efectivos.length){
     await db.query(`UPDATE perfil_cliente SET ${efectivos.map(([c],i)=>`${CONSENTIMIENTOS[c].columna}=$${i+2}`).join(",")},fecha_actualizacion=CURRENT_TIMESTAMP WHERE id_usuario=$1`,
      [idUsuario,...efectivos.map(([,v])=>v)]);
     // Auditoría: solo acción, actor, recurso y fecha (sin contenido del perfil ni compras).
     for(const [campo,valor] of efectivos)
      await db.query("INSERT INTO auditoria(id_auditoria,id_usuario,accion,recurso_accedido,fecha) VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)",
       [randomUUID(),idUsuario,`consentimiento_${CONSENTIMIENTOS[campo].evento}_ia_${valor?"otorgado":"revocado"}`,`usuarios/${idUsuario}`]);
    }
    return {consentimientos:leerConsentimientos({...actual,...Object.fromEntries(efectivos.map(([c,v])=>[CONSENTIMIENTOS[c].columna,v]))}),
     cambios:efectivos.map(([c])=>c)};
   });
  }catch(err){ if(err.code==="42703")throw new ErrorAplicacion("La gestión de consentimientos requiere aplicar la migración 007.",503,"MIGRACION_007_PENDIENTE"); throw err; }
 }
 // Lectura propia del cliente o del flujo de IA (este último SOLO con autoriza_contexto_ia === true; lo decide el servicio).
 // Devuelve únicamente códigos del catálogo; un registro ilegible no se ignora en silencio (podría ocultar una alergia).
 async obtenerAlimentacion(idUsuario,db=null){
  const filas=(await (db||this).query("SELECT tipo,descripcion,version_cifrado FROM preferencias_cliente WHERE id_usuario=$1 AND tipo=ANY($2::text[]) AND activa=TRUE ORDER BY id_preferencia",
   [idUsuario,Object.values(TIPOS_ALIMENTACION)])).rows;
  const datos=vacia();
  for(const g of GRUPOS){
   const fila=filas.filter(f=>f.tipo===TIPOS_ALIMENTACION[g]).at(-1);
   if(!fila)continue;
   let lista;
   try{lista=JSON.parse(fila.version_cifrado===2?this.seguridad.descifrarDatoSensible(fila.descripcion):fila.descripcion);}catch{lista=null;}
   if(!Array.isArray(lista))throw new ErrorAplicacion("No se pudieron leer los datos alimentarios guardados.",500,"ALIMENTACION_ILEGIBLE");
   datos[g]=[...new Set(lista.filter(c=>typeof c==="string"&&CATALOGO[g][c]))];
  }
  return datos;
 }
 // Reemplazo POR GRUPO: solo los grupos presentes en `cambios` se reemplazan ([] los borra); los omitidos no se tocan.
 // Transacción con bloqueo de la fila del usuario (serializa actualizaciones concurrentes: sin duplicados) y auditoría
 // en la MISMA transacción, solo con los nombres de los grupos (nunca los valores). No toca perfil_cliente ni consentimientos.
 async actualizarAlimentacion(idUsuario,cambios){
  return this.tx(async db=>{
   const u=(await db.query("SELECT id_usuario FROM usuarios WHERE id_usuario=$1 AND estado=TRUE FOR UPDATE",[idUsuario])).rows[0];
   if(!u)throw new ErrorAplicacion("Usuario no encontrado.",404,"NO_ENCONTRADO");
   const grupos=GRUPOS.filter(g=>Object.prototype.hasOwnProperty.call(cambios,g));
   for(const g of grupos){
    const lista=[...new Set(cambios[g])];
    await db.query("DELETE FROM preferencias_cliente WHERE id_usuario=$1 AND tipo=$2",[idUsuario,TIPOS_ALIMENTACION[g]]);
    if(lista.length)await db.query(`INSERT INTO preferencias_cliente(id_usuario,tipo,descripcion,version_cifrado,fecha_creacion) VALUES($1,$2,$3,2,CURRENT_TIMESTAMP)`,
     [idUsuario,TIPOS_ALIMENTACION[g],this.seguridad.cifrarDatoSensible(JSON.stringify(lista))]);
   }
   await db.query("INSERT INTO auditoria(id_auditoria,id_usuario,accion,recurso_accedido,datos_nuevos,fecha) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)",
    [randomUUID(),idUsuario,"actualizacion_alimentacion_perfil",`usuarios/${idUsuario}`,JSON.stringify({grupos})]);
   return this.obtenerAlimentacion(idUsuario,db);
  });
 }
 async guardar(u){
  await this.tx(async db=>{
   await db.query(`INSERT INTO usuarios(id_usuario,id_rol,nombre,correo,password_hash,fecha_creacion)
    VALUES($1,(SELECT id_rol FROM roles WHERE nombre=$2),$3,$4,$5,$6)
    ON CONFLICT(id_usuario) DO UPDATE SET nombre=EXCLUDED.nombre,correo=EXCLUDED.correo,password_hash=EXCLUDED.password_hash,fecha_actualizacion=CURRENT_TIMESTAMP`,
    [u.id,normalizarRol(u.rol),u.nombre,u.correo,u.passwordHash,u.createdAt]);
   if(u.perfilSalud){
    const p=u.perfilSalud;
    await db.query(`INSERT INTO perfil_cliente(id_perfil,id_usuario,fecha_actualizacion) VALUES($1,$2,CURRENT_TIMESTAMP)
     ON CONFLICT(id_usuario) DO UPDATE SET fecha_actualizacion=CURRENT_TIMESTAMP`,[p.id,u.id]);
    await db.query("DELETE FROM preferencias_cliente WHERE id_usuario=$1 AND tipo=ANY($2::text[])",[u.id,Object.values(TIPOS)]);
    for(const [campo,tipo] of Object.entries(TIPOS)) await db.query(`INSERT INTO preferencias_cliente(id_usuario,tipo,descripcion,version_cifrado,fecha_creacion)
     VALUES($1,$2,$3,2,CURRENT_TIMESTAMP)`,[u.id,tipo,this.seguridad.cifrarDatoSensible(p[campo])||""]);
   }
  });
  return u;
 }
}
module.exports={RepositorioUsuarios};
