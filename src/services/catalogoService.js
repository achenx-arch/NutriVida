const { ErrorAplicacion } = require("../errors/ErrorAplicacion");
function errorHttp(mensaje, status) { return new ErrorAplicacion(mensaje, status); }
const { Permiso, tienePermiso } = require("../domain/roles");

class ModuloCatalogo {
  constructor(repositorios, auditoria) { this.repos = repositorios; this.auditoria = auditoria; }
  async listar() { return this.repos.productos.listar(); }
  async gestionar(usuarioId, accion, datos) {
    const personal = await this.repos.usuarios.buscarPorId(usuarioId);
    if (!tienePermiso(personal, Permiso.GESTIONAR_CATALOGO)) throw errorHttp("No tienes permisos para esta acción.", 403);
    const resultado = await personal.gestionarCatalogo(this.repos.productos, accion, datos);
    if (!resultado) throw errorHttp("Producto no encontrado.", 404);
    const acciones = { crear: "alta_producto", editar: "edicion_producto", eliminar: "baja_producto" };
    await this.auditoria.registrarAcceso(personal, acciones[accion], `productos/${resultado.id || datos.id}`);
    return resultado;
  }
}

module.exports = { ModuloCatalogo };
