const {Base,iso}=require("./base");
const {Interaccion}=require("../../domain/modelos");
const {ErrorAplicacion}=require("../../errors/ErrorAplicacion");
const SELECT=`SELECT c.*,
 (SELECT contenido FROM mensajes_ia WHERE id_conversacion=c.id_conversacion AND tipo='USUARIO' ORDER BY id_mensaje LIMIT 1) AS pregunta,
 (SELECT contenido FROM mensajes_ia WHERE id_conversacion=c.id_conversacion AND tipo='ASISTENTE' ORDER BY id_mensaje LIMIT 1) AS respuesta
 FROM conversaciones_ia c WHERE c.id_interaccion_origen IS NOT NULL`;
class RepositorioInteracciones extends Base {
 hidratar(r){return r?new Interaccion({id:r.id_interaccion_origen,consultaId:r.id_conversacion,clienteId:r.id_usuario,
  consulta:this.seguridad.descifrarDatoSensible(r.datos_legado?.consultaInteraccionCifrada||r.pregunta),
  respuestaIA:this.seguridad.descifrarDatoSensible(r.respuesta),fecha:r.datos_legado?.fechaInteraccion||iso(r.fecha_inicio),revisada:r.revisada}):null;}
 async listar(){return (await this.query(SELECT+" ORDER BY c.fecha_inicio")).rows.map(r=>this.hidratar(r));}
 async listarPorCliente(id){return (await this.query(SELECT+" AND c.id_usuario=$1 ORDER BY c.fecha_inicio DESC",[id])).rows.map(r=>this.hidratar(r));}
 async registrar(i,c){
  await this.tx(async db=>{
   const actual=(await db.query("SELECT id_usuario,id_interaccion_origen FROM conversaciones_ia WHERE id_conversacion=$1 FOR UPDATE",[c.id])).rows[0];
   if(!actual || actual.id_usuario!==i.clienteId || i.consultaId!==c.id)throw new ErrorAplicacion("La interacción no corresponde a la consulta.",409);
   if(actual.id_interaccion_origen)throw new ErrorAplicacion("La consulta ya tiene una interacción registrada.",409);
   await db.query("UPDATE conversaciones_ia SET estado=$2,revisada=$3,id_interaccion_origen=$4,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id_conversacion=$1",[c.id,c.estado,i.revisada,i.id]);
   if(i.respuestaIA!=null)await db.query("INSERT INTO mensajes_ia(id_conversacion,tipo,contenido,fecha,version_cifrado) VALUES($1,'ASISTENTE',$2,$3,2)",[c.id,this.seguridad.cifrarDatoSensible(i.respuestaIA),i.fecha]);
  });return i;
 }
 async marcarRevisada(id){
  const r=await this.query("UPDATE conversaciones_ia SET revisada=TRUE,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id_conversacion=$1 AND id_interaccion_origen IS NOT NULL RETURNING id_conversacion",[id]);
  return r.rowCount?this.hidratar((await this.query(SELECT+" AND c.id_conversacion=$1",[id])).rows[0]):null;
 }
}
module.exports={RepositorioInteracciones};
