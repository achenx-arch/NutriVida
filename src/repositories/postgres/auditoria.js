const {Base,iso}=require("./base");
class RepositorioAuditoria extends Base {
 async guardar(e){
  await this.query("INSERT INTO auditoria(id_auditoria,id_usuario,accion,recurso_accedido,fecha) VALUES($1,$2,$3,$4,$5)",[e.id,e.usuarioId,e.accion,e.recursoAccedido,e.fecha]);return e;
 }
 async sesionRevocada(recurso){return (await this.query("SELECT 1 FROM auditoria WHERE accion='LOGOUT' AND recurso_accedido=$1 LIMIT 1",[recurso])).rowCount>0;}
 async listar(){return (await this.query("SELECT * FROM auditoria ORDER BY fecha DESC")).rows.map(r=>({id:r.id_auditoria,usuarioId:r.id_usuario,accion:r.accion,recursoAccedido:r.recurso_accedido,fecha:iso(r.fecha)}));}
}
module.exports={RepositorioAuditoria};
