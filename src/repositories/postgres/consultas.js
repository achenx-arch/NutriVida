const {Base,iso}=require("./base");
const {Consulta}=require("../../domain/modelos");
const SELECT=`SELECT c.*,m.contenido FROM conversaciones_ia c JOIN LATERAL
 (SELECT contenido FROM mensajes_ia WHERE id_conversacion=c.id_conversacion AND tipo='USUARIO' ORDER BY id_mensaje LIMIT 1) m ON TRUE`;
class RepositorioConsultas extends Base {
 hidratar(r){return r?new Consulta({id:r.id_conversacion,clienteId:r.id_usuario,texto:this.seguridad.descifrarDatoSensible(r.contenido),fecha:iso(r.fecha_inicio),estado:r.estado}):null;}
 async crear(c){await this.tx(async db=>{
  await db.query("INSERT INTO conversaciones_ia(id_conversacion,id_usuario,fecha_inicio,estado) VALUES($1,$2,$3,$4)",[c.id,c.clienteId,c.fecha,c.estado]);
  await db.query("INSERT INTO mensajes_ia(id_conversacion,tipo,contenido,fecha,version_cifrado) VALUES($1,'USUARIO',$2,$3,2)",[c.id,this.seguridad.cifrarDatoSensible(c.texto),c.fecha]);
 });return c;}
 async buscarPorId(id){return this.hidratar((await this.query(SELECT+" WHERE c.id_conversacion=$1",[id])).rows[0]);}
 async listar(){return (await this.query(SELECT+" ORDER BY c.fecha_inicio,c.id_conversacion")).rows.map(r=>this.hidratar(r));}
 async listarPorCliente(id){return (await this.query(SELECT+" WHERE c.id_usuario=$1 ORDER BY c.fecha_inicio DESC",[id])).rows.map(r=>this.hidratar(r));}
}
module.exports={RepositorioConsultas};
