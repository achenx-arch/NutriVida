const {ErrorAplicacion}=require("../errors/ErrorAplicacion");
const v=require("../security/catalogoValidacion");
class CatalogoComercialService {
 constructor(repositorios){this.repos=repositorios;}
 async usuario(id,escritura=false){const u=await this.repos.usuarios.buscarPorId(id);if(!u)throw new ErrorAplicacion("No autenticado.",401);if(escritura&&u.rol!=="ADMINISTRADOR")throw new ErrorAplicacion("No tienes permisos para esta acción.",403);return u;}
 async listar(id,q){const u=await this.usuario(id);return this.repos.catalogoComercial.listarProductos(v.filtros(q,u.rol==="ADMINISTRADOR"),u.rol==="ADMINISTRADOR");}
 async detalle(usuario,id){const u=await this.usuario(usuario);return this.repos.catalogoComercial.detalle(v.uuid(id),u.rol==="ADMINISTRADOR");}
 async entidades(usuario,t,q){const u=await this.usuario(usuario);return this.repos.catalogoComercial.listarEntidades(t,v.filtros(q,u.rol==="ADMINISTRADOR",t),u.rol==="ADMINISTRADOR");}
 async guardar(usuario,t,id,d){await this.usuario(usuario,true);const datos=v.ficha(t,d,!id);return t==="productos"?this.repos.catalogoComercial.guardarProducto(id?v.uuid(id):null,datos,usuario):this.repos.catalogoComercial.guardarEntidad(t,id?v.identificador(id):null,datos,usuario);}
}
module.exports={CatalogoComercialService};
