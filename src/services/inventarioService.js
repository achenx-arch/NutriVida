const {ErrorAplicacion}=require('../errors/ErrorAplicacion');
const {tienePermiso,Permiso}=require('../domain/roles');
const v=require('../security/inventarioValidacion');
class InventarioService {
 constructor(repos){this.repos=repos;}
 async autorizar(id){const u=await this.repos.usuarios.buscarPorId(id);if(!u||u.estado===false)throw new ErrorAplicacion('No autenticado.',401);if(!tienePermiso(u,Permiso.GESTIONAR_INVENTARIO))throw new ErrorAplicacion('No tienes permisos para esta acción.',403);}
 async listar(id,q){await this.autorizar(id);return this.repos.inventario.listar(v.filtros(q));}
 async historial(id,q){await this.autorizar(id);return this.repos.inventario.historial(v.filtros(q,true));}
 async registrar(id,b){await this.autorizar(id);return this.repos.inventario.registrar(id,v.movimiento(b));}
}
module.exports={InventarioService};
