// Fachada compatible: respeta el driver seleccionado, nunca instancia JSON directamente.
let acceso;
function repositorio(){
  acceso ||= require("../repositories/crearRepositorios").crearRepositorios();
  return acceso.repositorios.auditoria;
}
module.exports={
 registrarAcceso:(...args)=>new (require("../domain/modelos").BitacoraAuditoria)(repositorio()).registrarAcceso(...args),
 listarAuditoria:()=>repositorio().listar(),
 cerrar:async()=>{if(acceso){await acceso.cerrar();acceso=undefined;}}
};
